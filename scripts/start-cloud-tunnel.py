import ctypes
import json
import os
import select
import socket
import subprocess
import sys
import threading
import time
import urllib.request

import paramiko

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

if sys.stdout is None:
    sys.stdout = open(os.devnull, 'w', encoding='utf-8')
if sys.stderr is None:
    sys.stderr = open(os.devnull, 'w', encoding='utf-8')

from deploy_cloud import load_ssh_credentials  # noqa: E402

SECRET_PATH = os.path.join(PROJECT_ROOT, 'data', 'bridge_tunnel.secret.json')
DAEMON_SCRIPT = os.path.join(PROJECT_ROOT, 'server', 'localBridgeDaemon.js')
TUNNEL_LOG_PATH = os.path.join(PROJECT_ROOT, 'data', 'tunnel.log')
DAEMON_LOG_PATH = os.path.join(PROJECT_ROOT, 'data', 'bridge_daemon.log')
PID_PATH = os.path.join(PROJECT_ROOT, 'data', 'tunnel.pid')

daemon_proc = None
_mutex_handle = None
_log_lock = threading.Lock()


def trim_log_if_needed(log_path: str, max_bytes: int = 2 * 1024 * 1024):
    try:
        if os.path.isfile(log_path) and os.path.getsize(log_path) > max_bytes:
            with open(log_path, 'rb') as f:
                f.seek(-max_bytes // 2, os.SEEK_END)
                tail = f.read()
            with open(log_path, 'wb') as f:
                f.write(tail)
    except Exception:
        pass


def log_msg(msg: str):
    ts = time.strftime('%Y-%m-%d %H:%M:%S')
    line = f'[{ts}] {msg}'
    with _log_lock:
        try:
            if sys.stdout is not None:
                print(line, flush=True)
        except Exception:
            pass
        try:
            os.makedirs(os.path.dirname(TUNNEL_LOG_PATH), exist_ok=True)
            trim_log_if_needed(TUNNEL_LOG_PATH)
            with open(TUNNEL_LOG_PATH, 'a', encoding='utf-8', errors='replace') as f:
                f.write(line + '\n')
        except Exception:
            pass


def acquire_single_instance_lock() -> bool:
    global _mutex_handle
    if sys.platform != 'win32':
        return True
    try:
        kernel32 = ctypes.windll.kernel32
        handle = kernel32.CreateMutexW(None, False, 'Local\\StarWhisperCloudTunnelMutex')
        last_err = kernel32.GetLastError()
        if not handle:
            return True
        if last_err == 183:  # ERROR_ALREADY_EXISTS
            kernel32.CloseHandle(handle)
            return False
        _mutex_handle = handle
        try:
            os.makedirs(os.path.dirname(PID_PATH), exist_ok=True)
            with open(PID_PATH, 'w', encoding='utf-8') as f:
                f.write(str(os.getpid()))
        except Exception:
            pass
        return True
    except Exception:
        return True


def load_tunnel_port() -> int:
    if os.path.isfile(SECRET_PATH):
        try:
            with open(SECRET_PATH, 'r', encoding='utf-8') as f:
                cfg = json.load(f)
            return int(cfg.get('port') or 18765)
        except Exception:
            pass
    return 18765


def is_local_bridge_alive(port: int) -> bool:
    try:
        with urllib.request.urlopen(f'http://127.0.0.1:{port}/health', timeout=1.5) as resp:
            return resp.status == 200
    except Exception:
        return False


def ensure_local_bridge_running(port: int) -> bool:
    global daemon_proc
    if is_local_bridge_alive(port):
        return True

    if not os.path.isfile(DAEMON_SCRIPT):
        log_msg(f'[隧道守护] 错误：未找到本机桥接服务脚本 {DAEMON_SCRIPT}')
        return False

    log_msg(f'[隧道守护] 正在启动本机双引擎桥接网关 (127.0.0.1:{port})...')
    creationflags = subprocess.CREATE_NO_WINDOW if sys.platform == 'win32' else 0
    os.makedirs(os.path.dirname(DAEMON_LOG_PATH), exist_ok=True)
    trim_log_if_needed(DAEMON_LOG_PATH)
    log_fp = open(DAEMON_LOG_PATH, 'a', encoding='utf-8', errors='replace')
    daemon_proc = subprocess.Popen(
        ['node', '--no-warnings', DAEMON_SCRIPT],
        cwd=PROJECT_ROOT,
        stdin=subprocess.DEVNULL,
        stdout=log_fp,
        stderr=subprocess.STDOUT,
        creationflags=creationflags
    )

    for _ in range(20):
        time.sleep(0.4)
        if is_local_bridge_alive(port):
            log_msg('[隧道守护] 本机双引擎桥接网关已就绪！')
            return True

    log_msg('[隧道守护] 警告：本机桥接网关启动超时，将在后台继续等待')
    return False


def forward_channel(channel, port: int):
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        sock.settimeout(5)
        sock.connect(('127.0.0.1', port))
        sock.settimeout(None)
    except Exception as err:
        log_msg(f'[隧道转发] 连接本机桥接端口 127.0.0.1:{port} 失败: {err}')
        try:
            channel.close()
        except Exception:
            pass
        try:
            sock.close()
        except Exception:
            pass
        return

    try:
        while True:
            r, _, _ = select.select([sock, channel], [], [], 30)
            if not r:
                continue
            if sock in r:
                data = sock.recv(16384)
                if not data:
                    break
                channel.sendall(data)
            if channel in r:
                data = channel.recv(16384)
                if not data:
                    break
                sock.sendall(data)
    except Exception:
        pass
    finally:
        try:
            channel.close()
        except Exception:
            pass
        try:
            sock.close()
        except Exception:
            pass


def run_tunnel_forever():
    if not acquire_single_instance_lock():
        log_msg('[隧道守护] 检测到隧道守护已在运行中，本次启动安全退出。')
        return

    host, user, pwd = load_ssh_credentials()
    port = load_tunnel_port()

    while True:
        ensure_local_bridge_running(port)
        ssh = None
        try:
            log_msg(f'[隧道守护] 正在连接云服务器 {host} 建立加密反向隧道 (127.0.0.1:{port})...')
            ssh = paramiko.SSHClient()
            ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            ssh.connect(host, username=user, password=pwd, timeout=20, banner_timeout=20, auth_timeout=20)

            # 自动清理因异常断网遗留的云端僵尸 sshd 端口占用，防止 TCP forwarding request denied 死循环
            try:
                cleanup_cmd = (
                    f"pids=$(ss -tlnp 2>/dev/null | grep '127.0.0.1:{port} ' | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u); "
                    f"for p in $pids; do [ \"$p\" != \"$$\" ] && [ \"$p\" != \"$PPID\" ] && kill -9 \"$p\" 2>/dev/null; done"
                )
                _, c_out, _ = ssh.exec_command(cleanup_cmd, timeout=6)
                c_out.channel.recv_exit_status()
                time.sleep(0.3)
            except Exception:
                pass

            transport = ssh.get_transport()
            transport.set_keepalive(15)
            transport.request_port_forward('127.0.0.1', port)
            log_msg(f'[隧道守护] 加密反向隧道已建立！云端请求 127.0.0.1:{port} 将直达本机电脑。')

            while transport.is_active():
                chan = transport.accept(timeout=2)
                if chan is None:
                    if not is_local_bridge_alive(port):
                        ensure_local_bridge_running(port)
                    continue
                t = threading.Thread(target=forward_channel, args=(chan, port), daemon=True)
                t.start()

            log_msg('[隧道守护] SSH 传输通道已断开，3 秒后自动重连...')
        except KeyboardInterrupt:
            log_msg('[隧道守护] 收到退出信号，正在关闭隧道...')
            break
        except Exception as err:
            log_msg(f'[隧道守护] 隧道异常: {err}，3 秒后自动重连...')
        finally:
            if ssh is not None:
                try:
                    ssh.close()
                except Exception:
                    pass
        time.sleep(3)


if __name__ == '__main__':
    if sys.platform == 'win32':
        try:
            if sys.stdout is not None:
                sys.stdout.reconfigure(encoding='utf-8', errors='replace')
            if sys.stderr is not None:
                sys.stderr.reconfigure(encoding='utf-8', errors='replace')
        except Exception:
            pass
    run_tunnel_forever()

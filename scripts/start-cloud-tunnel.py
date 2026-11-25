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

from deploy_cloud import load_ssh_credentials  # noqa: E402

SECRET_PATH = os.path.join(PROJECT_ROOT, 'data', 'bridge_tunnel.secret.json')
DAEMON_SCRIPT = os.path.join(PROJECT_ROOT, 'server', 'localBridgeDaemon.js')

daemon_proc = None


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
        print(f'[隧道守护] 错误：未找到本机桥接服务脚本 {DAEMON_SCRIPT}', flush=True)
        return False

    print(f'[隧道守护] 正在启动本机双引擎桥接网关 (127.0.0.1:{port})...', flush=True)
    creationflags = subprocess.CREATE_NO_WINDOW if sys.platform == 'win32' else 0
    daemon_proc = subprocess.Popen(
        ['node', '--no-warnings', DAEMON_SCRIPT],
        cwd=PROJECT_ROOT,
        creationflags=creationflags
    )

    for _ in range(20):
        time.sleep(0.4)
        if is_local_bridge_alive(port):
            print('[隧道守护] 本机双引擎桥接网关已就绪！', flush=True)
            return True

    print('[隧道守护] 警告：本机桥接网关启动超时，将在后台继续等待', flush=True)
    return False


def forward_channel(channel, port: int):
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        sock.settimeout(5)
        sock.connect(('127.0.0.1', port))
        sock.settimeout(None)
    except Exception as err:
        print(f'[隧道转发] 连接本机桥接端口 127.0.0.1:{port} 失败: {err}', flush=True)
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
    host, user, pwd = load_ssh_credentials()
    port = load_tunnel_port()

    while True:
        ensure_local_bridge_running(port)
        ssh = None
        try:
            print(f'[隧道守护] 正在连接云服务器 {host} 建立加密反向隧道 (127.0.0.1:{port})...', flush=True)
            ssh = paramiko.SSHClient()
            ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            ssh.connect(host, username=user, password=pwd, timeout=20, banner_timeout=20, auth_timeout=20)
            transport = ssh.get_transport()
            transport.set_keepalive(15)
            transport.request_port_forward('127.0.0.1', port)
            print(f'[隧道守护] 加密反向隧道已建立！云端请求 127.0.0.1:{port} 将直达本机电脑。', flush=True)

            while transport.is_active():
                chan = transport.accept(timeout=2)
                if chan is None:
                    if not is_local_bridge_alive(port):
                        ensure_local_bridge_running(port)
                    continue
                t = threading.Thread(target=forward_channel, args=(chan, port), daemon=True)
                t.start()

            print('[隧道守护] SSH 传输通道已断开，3 秒后自动重连...', flush=True)
        except KeyboardInterrupt:
            print('\n[隧道守护] 收到退出信号，正在关闭隧道...', flush=True)
            break
        except Exception as err:
            print(f'[隧道守护] 隧道异常: {err}，3 秒后自动重连...', flush=True)
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
            sys.stdout.reconfigure(encoding='utf-8', errors='replace')
            sys.stderr.reconfigure(encoding='utf-8', errors='replace')
        except Exception:
            pass
    run_tunnel_forever()

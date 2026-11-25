import gzip
import io
import json
import os
import shutil
import subprocess
import sys
import tarfile
import time
import paramiko

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))
LOCAL_CRED_FILE = os.path.join(PROJECT_ROOT, '.deploy.local.json')
KB_DEPLOY_SCRIPT = r'E:\知识库项目\deploy_all_update.py'


def precompress_static_assets():
    build_script = os.path.join(PROJECT_ROOT, 'scripts', 'build-static-assets.mjs')
    node_bin = shutil.which('node')
    if node_bin and os.path.isfile(build_script):
        print('  [构建引擎] 正在执行 CSS/JS 合并压缩与 .gz/.br 双重预压缩...')
        subprocess.run([node_bin, build_script], cwd=PROJECT_ROOT, check=True)
        return

    public_dir = os.path.join(PROJECT_ROOT, 'public')
    exts = {'.js', '.css', '.html', '.svg', '.json'}
    count = 0
    for root, _, files in os.walk(public_dir):
        for f in files:
            if f.endswith('.gz') or f.endswith('.br'):
                continue
            ext = os.path.splitext(f)[1].lower()
            if ext in exts:
                fpath = os.path.join(root, f)
                if os.path.getsize(fpath) < 512:
                    continue
                gz_path = fpath + '.gz'
                try:
                    with open(fpath, 'rb') as f_in, gzip.open(gz_path, 'wb', compresslevel=9) as f_out:
                        shutil.copyfileobj(f_in, f_out)
                    count += 1
                except Exception:
                    pass
    print(f'  [加速引擎] 已完成 {count} 个静态文件的极速 Gzip 预压缩 (.gz) 生成')


def load_ssh_credentials():
    host = os.environ.get('DEPLOY_HOST', '').strip()
    user = os.environ.get('DEPLOY_USER', '').strip()
    pwd = os.environ.get('DEPLOY_PASS', '').strip()
    if host and user and pwd:
        return host, user, pwd

    if os.path.isfile(LOCAL_CRED_FILE):
        with open(LOCAL_CRED_FILE, 'r', encoding='utf-8') as f:
            cfg = json.load(f)
            return cfg['host'], cfg.get('user', 'root'), cfg['password']

    if os.path.isfile(KB_DEPLOY_SCRIPT):
        ns = {}
        with open(KB_DEPLOY_SCRIPT, 'r', encoding='utf-8') as f:
            for line in f:
                if line.startswith(('HOST =', 'USER =', 'PWD =')):
                    exec(line, ns)
        if ns.get('HOST') and ns.get('PWD'):
            return ns['HOST'], ns.get('USER', 'root'), ns['PWD']

    raise RuntimeError('未找到云服务器连接凭据，请配置环境变量或 .deploy.local.json')


def build_release_tar(tar_path: str):
    include_dirs = ['server', 'public', 'examples', 'deploy']
    include_files = ['package.json', 'README.md']

    with tarfile.open(tar_path, 'w:gz') as tar:
        for fname in include_files:
            fpath = os.path.join(PROJECT_ROOT, fname)
            if os.path.isfile(fpath):
                tar.add(fpath, arcname=fname)

        for dname in include_dirs:
            dpath = os.path.join(PROJECT_ROOT, dname)
            if not os.path.isdir(dpath):
                continue
            for root, dirs, files in os.walk(dpath):
                dirs[:] = [d for d in dirs if d not in ('__pycache__', 'node_modules', '.git')]
                for file in files:
                    if file.endswith(('.pyc', '.pyo')):
                        continue
                    full_path = os.path.join(root, file)
                    arcname = os.path.relpath(full_path, PROJECT_ROOT).replace('\\', '/')
                    tar.add(full_path, arcname=arcname)


def main():
    host, user, pwd = load_ssh_credentials()
    tar_name = f'star_whisper_pack_{int(time.time())}.tar.gz'
    tar_path = os.path.join(PROJECT_ROOT, tar_name)

    print('Step 1: 正在生成极速预压缩资产并打包 Persona Chat Studio · 星语恋庭 全栈部署包...')
    precompress_static_assets()
    build_release_tar(tar_path)
    size_mb = os.path.getsize(tar_path) / (1024 * 1024)
    print(f'  打包完成，压缩包体积: {size_mb:.2f} MB')

    print(f'Step 2: 正在连接云服务器 {host} 并上传部署包...')
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    for attempt in range(1, 4):
        try:
            ssh.connect(host, username=user, password=pwd, timeout=30, banner_timeout=30, auth_timeout=30)
            break
        except Exception as err:
            print(f'  SSH 连接第 {attempt} 次尝试失败: {err}')
            if attempt == 3:
                raise
            time.sleep(2)

    remote_tar = f'/root/{tar_name}'

    def progress_cb(transferred, total):
        if total > 0 and (transferred == total or transferred % (1024 * 1024 * 4) < 32768):
            pct = (transferred / total) * 100
            print(f'  上传进度: {transferred / 1048576:.1f} MB / {total / 1048576:.1f} MB ({pct:.1f}%)')

    sftp = ssh.open_sftp()
    sftp.put(tar_path, remote_tar, callback=progress_cb, confirm=False)
    local_env = os.path.join(PROJECT_ROOT, '.env')
    has_local_env = os.path.isfile(local_env)
    if has_local_env:
        sftp.put(local_env, '/root/.star_whisper_env_tmp', confirm=False)
    sftp.close()
    print('  上传完成！')

    bridge_secret_path = os.path.join(PROJECT_ROOT, 'data', 'bridge_tunnel.secret.json')
    custom_endpoints = []
    if os.path.isfile(bridge_secret_path):
        try:
            with open(bridge_secret_path, 'r', encoding='utf-8') as f:
                sec = json.load(f)
            if sec.get('token'):
                t_port = int(sec.get('port') or 18765)
                custom_endpoints.append({
                    'id': 'home_pc_antigravity',
                    'name': '本机电脑 Antigravity 直连',
                    'apiFormat': 'openai',
                    'baseURL': f'http://127.0.0.1:{t_port}/v1/chat/completions',
                    'apiKey': sec['token'],
                    'defaultModel': 'agy-auto',
                    'models': ['agy-auto', 'agy']
                })
        except Exception:
            pass

    bridge_cfg_json = json.dumps({
        'enabled': True,
        'takeoverDemoChannel': True,
        'preferLocalOfflineServer': False,
        'firstTokenTimeoutMs': 60000,
        'defaultReasoningEffort': 'low',
        'knowledgeBaseConfigPaths': ['/opt/coreforge/server/config.json'],
        'localServers': {
            'ollamaBaseUrl': 'http://127.0.0.1:11434',
            'lmStudioBaseUrl': 'http://127.0.0.1:1234'
        },
        'customEndpoints': custom_endpoints
    }, ensure_ascii=False, indent=2)

    print('Step 3: 正在云端部署 /opt/star-whisper、同步内置 API 配置并启动 PM2 + Nginx...')
    remote_cmd = f"""
set -e
mkdir -p /opt/star-whisper/data/tts_cache
rm -rf /opt/star-whisper/public/assets/companions /opt/star-whisper/public/companion3d.* /opt/star-whisper/public/*.tmp /opt/star-whisper/public/dist/*.tmp /opt/star-whisper/public/assets/screenshots/01-auth-gate.png /opt/star-whisper/public/assets/screenshots/03-memory-nurturing.png /opt/star-whisper/public/assets/screenshots/04-story-scripts.png /opt/star-whisper/public/assets/screenshots/05-community-square.png
tar -xzf {remote_tar} -C /opt/star-whisper/
rm -f {remote_tar}
if [ -f /root/.star_whisper_env_tmp ]; then
  mv -f /root/.star_whisper_env_tmp /opt/star-whisper/.env
  chmod 600 /opt/star-whisper/.env
fi
rm -f /opt/star-whisper/data/tts_cache/*.bin /opt/star-whisper/data/tts_cache/*.json 2>/dev/null || true
if ! python3 -c "import edge_tts" >/dev/null 2>&1; then
  python3 -m pip install -i https://pypi.tuna.tsinghua.edu.cn/simple --timeout 20 --break-system-packages -q edge-tts >/dev/null 2>&1 || \
  pip3 install -i https://pypi.tuna.tsinghua.edu.cn/simple --timeout 20 -q edge-tts >/dev/null 2>&1 || true
fi
if ! command -v pdftotext >/dev/null 2>&1; then
  (DEBIAN_FRONTEND=noninteractive apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq poppler-utils >/dev/null 2>&1) || true
fi

# 同步刷新云端 SQLite 中的内置 API 配置：剥离聊天越权调用，聊天大脑全面交由 Antigravity 智能体底座深度承担
node -e '
const {{ db, getRawPlatformConfigInternal, updateAdminPlatformConfig, saveAdminAnnouncement }} = require("/opt/star-whisper/server/db");
db.prepare("DELETE FROM personas WHERE id = \\x27persona_linqi\\x27").run();
db.prepare("UPDATE site_announcements SET enabled = 0").run();
saveAdminAnnouncement("admin", {{
  title: "星语恋庭 v2.5.2 更新：大肥鱼全屏自由漫步上线，头顶气泡实时吐槽天气与暖心安慰你！",
  content: "1. 【全屏自由漫步模式】：大肥鱼活动范围不再局限在边缘！默认开启「🚶漫步」后会在全屏安全范围内自动转身小碎步自由走动，拖放到哪儿就待在哪儿。\\n2. 【头顶对话气泡（天气吐槽 + 暖心鼓励）】：大肥鱼头顶新增圆润对话气泡，自动结合云端实时天气吐槽温度阴晴雨雪，并在你忙碌时弹出温柔安慰与鼓励话语！\\n3. 【整合真实歌声导入 & QQ音乐精确单曲点播】：随身版升级至 v2.5.2 (Build 149)！",
  enabled: true,
  version: 149
}});
db.prepare("UPDATE sessions SET companion_config = NULL").run();
db.prepare("UPDATE user_settings SET value = \\x27demo\\x27 WHERE key = \\x27provider\\x27").run();
const c = getRawPlatformConfigInternal();
db.prepare("DELETE FROM platform_config WHERE key = \\x27deepseek_api_key\\x27").run();
updateAdminPlatformConfig({{
  online_provider_type: "deepseek",
  deepseek_base_url: "",
  deepseek_model: "",
  deepseek_api_key: "",
  clear_deepseek_api_key: true,
  tts_provider: c.tts_provider || "siliconflow",
  tts_api_key: c.tts_api_key || "",
  clear_tts_api_key: !c.tts_api_key,
  tts_endpoint: c.tts_endpoint || "",
  tts_model: c.tts_model || ""
}});
console.log("CLOUD_DB_SYNC_OK: 聊天大脑已成功交还 Antigravity 智能体底座");
'

# 初始化或更新云端 Antigravity 桥接配置，优先接入本机隧道端点，同时保留 /opt/coreforge/server/config.json 兜底
cat > /opt/star-whisper/data/antigravity_bridge.json << 'JSONEOF'
{bridge_cfg_json}
JSONEOF

# 为 star.claudexxb.online / rp.claudexxb.online 签发独立 10 年期 SAN 源站证书（绝不改动 coreforge 原有证书）
if [ ! -f /etc/nginx/ssl_star_claudexxb.crt ]; then
  openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \\
    -keyout /etc/nginx/ssl_star_claudexxb.key \\
    -out /etc/nginx/ssl_star_claudexxb.crt \\
    -subj "/C=CN/ST=GD/L=GZ/O=StarWhisper/CN=star.claudexxb.online" \\
    -addext "subjectAltName=DNS:star.claudexxb.online,DNS:rp.claudexxb.online,DNS:*.claudexxb.online" 2>/dev/null
fi

# 启动 / 重载 PM2 守护进程（与 coreforge 并排独立运行，互不影响）
cd /opt/star-whisper
pm2 delete star-whisper >/dev/null 2>&1 || true
pm2 start /opt/star-whisper/deploy/ecosystem.config.cjs
pm2 save >/dev/null 2>&1 || true

# 挂载独立二级域名 Nginx 站点配置并执行严格语法回滚保护
cp /opt/star-whisper/deploy/nginx-star-whisper.conf /etc/nginx/sites-available/star-whisper
ln -sf /etc/nginx/sites-available/star-whisper /etc/nginx/sites-enabled/star-whisper
if ! nginx -t; then
  echo "Nginx 语法检查未通过，自动撤销新增站点以确保主站安全！"
  rm -f /etc/nginx/sites-enabled/star-whisper
  exit 1
fi
systemctl reload nginx

sleep 2
echo "=== PM2 实时状态 ==="
pm2 list
echo "=== 内存实时余量 ==="
free -m
echo "=== StarWhisper 健康探针 (127.0.0.1:3210) ==="
curl -fsS http://127.0.0.1:3210/api/health
echo ""
echo "=== Nginx HTTPS SNI 路由探针 (star.claudexxb.online) ==="
curl -fsSk --resolve star.claudexxb.online:443:127.0.0.1 https://star.claudexxb.online/api/health
echo ""
echo "=== Nginx HTTP/2 与静态文件零拷贝加速探针 (app.js) ==="
curl -I -sSk --resolve star.claudexxb.online:443:127.0.0.1 -H "Accept-Encoding: gzip" https://star.claudexxb.online/app.js
echo ""
echo "=== 最新随身版 APK 下载探针 (deepseek-studio.apk) ==="
curl -I -sSk --resolve star.claudexxb.online:443:127.0.0.1 https://star.claudexxb.online/downloads/deepseek-studio.apk
echo ""
echo "=== 知识库主站回归探针 (claudexxb.online / 127.0.0.1:3002) ==="
curl -fsS http://127.0.0.1:3002/api/health
echo ""
"""

    _, stdout, stderr = ssh.exec_command(remote_cmd, timeout=120)
    out = stdout.read().decode('utf-8', errors='replace')
    err = stderr.read().decode('utf-8', errors='replace')
    print('\n--- 云端执行输出 ---')
    print(out)
    if err.strip():
        print('--- 云端标准错误/提示 ---')
        print(err)

    ssh.close()
    try:
        if os.path.exists(tar_path):
            os.remove(tar_path)
    except OSError:
        pass

    print('部署圆满完成！')


if __name__ == '__main__':
    main()

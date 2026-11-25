/* ==========================================================================
   Phone Agent 手机端 AI 辅助助理与 dsh-Go 规划循环模块 (v2.5.1)
   1. 高度还原 dsh-Go 控屏内核：snapshotId/ref 精准控屏、ScreenVerdict 非阻塞验证、
      三档 SafetyGate 安全确认 + App 白名单、执行中途随时插话/排队、无障碍内联引导
   2. 高度还原 dsh-Go 交互 UI：运行中流光胶囊 + 完成后自动折叠单行轨迹 + 自然语言回复
   3. 与 DeepSeek 问答模式 / 星语剧场 100% 物理隔离
   ========================================================================== */

(() => {
  const CURRENT_APK_VERSION = '2.5.1';
  const CURRENT_APK_CODE = 148;
  const DEEPSEEK_API_KEYS_URL = 'https://platform.deepseek.com/api_keys';
  const PUBLIC_WEB_ORIGIN = 'https://star.claudexxb.online';
  const GITHUB_RELEASES_URL = 'https://github.com/qts2218346424-cyber/persona-chat-studio/releases';

  const STORAGE_KEYS = {
    execMode: 'pa_exec_mode_v1',
    directModel: 'pa_direct_model_v1',
    directBaseUrl: 'pa_direct_baseurl_v1',
    autoApprove: 'pa_auto_approve_v1',
    confirmPolicy: 'pa_confirm_policy_v2',
    trustedApps: 'pa_trusted_apps_v1',
    edgeGlow: 'pa_edge_glow_v1',
    exclusiveKey: 'pa_exclusive_api_key_v1',
    keyPrimary: 'deepseek_user_api_key',
    keyFallback: 'own_deepseek_api_key',
    taskHistory: 'pa_task_history_v1'
  };

  // 4 大精炼高频快捷指令库（mode: 'exec' 点击即执行 | 'fill' 填入输入框补全参数）
  const LOCAL_COMMAND_CATALOG = [
    {
      id: 'common',
      title: '常用操作',
      items: [
        { label: '回桌面', cmd: '回桌面', mode: 'exec', desc: '返回手机主屏幕' },
        { label: '返回上一页', cmd: '返回', mode: 'exec', desc: '系统全局返回键' },
        { label: '切回上个App', cmd: '切回上个应用', mode: 'exec', desc: '切换上一后台应用' },
        { label: '系统截屏', cmd: '截屏', mode: 'exec', desc: '截取当前手机画面' },
        { label: '读取当前屏幕', cmd: '__inspect_screen__', mode: 'exec', desc: '采集无障碍节点树' },
        { label: '打开任意App...', cmd: '打开 ', mode: 'fill', desc: '输入应用名称直达' }
      ]
    },
    {
      id: 'input',
      title: '输入与搜索',
      items: [
        { label: '打字填入...', cmd: '打字 ', mode: 'fill', desc: '填入当前焦点输入框' },
        { label: '输入并发送...', cmd: '输入并发送 ', mode: 'fill', desc: '填字后自动点发送' },
        { label: '快捷搜索...', cmd: '搜索 ', mode: 'fill', desc: '点搜索框并输入查询' },
        { label: '点击文字...', cmd: '点击 ', mode: 'fill', desc: '按屏幕文字精准点击' },
        { label: '粘贴剪贴板', cmd: '粘贴', mode: 'exec', desc: '粘贴剪贴板内容上屏' },
        { label: '清空输入框', cmd: '清空输入框', mode: 'exec', desc: '清除当前输入框文字' }
      ]
    },
    {
      id: 'system',
      title: '手势与系统',
      items: [
        { label: '向下滑动', cmd: '下滑', mode: 'exec', desc: '向下翻页浏览内容' },
        { label: '向上滑动', cmd: '上滑', mode: 'exec', desc: '向上翻页浏览内容' },
        { label: '回到顶部', cmd: '回到顶部', mode: 'exec', desc: '连续上滑回到顶部' },
        { label: '滑到底部', cmd: '滑到底部', mode: 'exec', desc: '连续下滑直达底部' },
        { label: '音量 +', cmd: '音量加', mode: 'exec', desc: '调高设备媒体音量' },
        { label: '音量 -', cmd: '音量减', mode: 'exec', desc: '调低设备媒体音量' },
        { label: '静音切换', cmd: '静音', mode: 'exec', desc: '切换媒体静音状态' },
        { label: '锁定屏幕', cmd: '锁屏', mode: 'exec', desc: '立即息屏锁屏保护' }
      ]
    },
    {
      id: 'video',
      title: '短视频',
      items: [
        { label: '自动刷视频', cmd: '自动刷视频', mode: 'exec', desc: '每8秒自动上滑切换' },
        { label: '刷抖音连刷', cmd: '打开抖音自动刷20个视频每8秒', mode: 'exec', desc: '开抖音并自动连刷' },
        { label: '下一个视频', cmd: '下一个视频', mode: 'exec', desc: '快速上滑切下一条' },
        { label: '双击点赞', cmd: '双击点赞', mode: 'exec', desc: '屏幕中心双击红心' },
        { label: '打开评论区', cmd: '看评论', mode: 'exec', desc: '智能定位评论按钮' },
        { label: '停止刷视频', cmd: '停止刷视频', mode: 'exec', desc: '立即终止自动连刷' }
      ]
    },
    {
      id: 'phrases',
      title: '常用聊天文字',
      items: []
    },
    {
      id: 'songs',
      title: '肥鱼歌单',
      items: []
    }
  ];

  const DEFAULT_QUICK_PHRASES = [
    '在吗？等我一下下~',
    '收到收到，马上处理！',
    '哈哈哈哈笑死我了',
    '辛苦啦，先去忙会儿~',
    '好的，没问题！',
    '大肥鱼帮你回一句：马上到！'
  ];
  const QUICK_PHRASES_STORAGE_KEY = 'pa_quick_phrases_v1';
  let quickPhraseBatchBoxOpen = false;

  const EMPTY_GUIDE_PRESETS = [
    { label: '打开微信找文件传输助手', sub: '多步自动识屏点按进入', cmd: '打开微信，进入文件传输助手', mode: 'exec' },
    { label: '高德地图搜附近咖啡', sub: '自动开地图并搜索附近地点', cmd: '打开高德地图搜索附近的咖啡店', mode: 'exec' },
    { label: '读取当前屏幕内容', sub: '采集控件树并分析界面', cmd: '__inspect_screen__', mode: 'exec' },
    { label: '打开系统设置看电量', sub: '自动跳转系统电池信息页', cmd: '打开系统设置，查看电池电量信息', mode: 'exec' }
  ];

  // 独立于 DeepSeek 问答会话的手机辅助专属 DOM 消息节点缓存
  let paSessionNodes = [];
  let activeCmdLibCategory = 'common';
  let installedAppsCache = null;
  let activeAbortController = null;
  let emergencyStopRequested = false;
  let isAgentRunning = false;
  let queuedInterjections = [];
  let activeRunContext = null;
  let pendingTaskAfterA11y = '';
  let latestUpdateInfo = null;
  let pendingNativeCheckResolve = null;
  let nativeCheckTimeoutId = null;
  let isDownloadingUpdate = false;

  const $ = (id) => document.getElementById(id);

  function getBridge() {
    return window.AndroidAppBridge || null;
  }

  function isNativeApk() {
    const b = getBridge();
    try {
      return Boolean(b && typeof b.isNativeApk === 'function' && b.isNativeApk());
    } catch {
      return false;
    }
  }

  function isNativeAutoSwiping() {
    if (!isNativeApk()) return false;
    const b = getBridge();
    try {
      return Boolean(b && typeof b.isAutoSwipeRunning === 'function' && b.isAutoSwipeRunning());
    } catch {
      return false;
    }
  }

  function getInstalledVersionInfo() {
    const fallback = { versionName: CURRENT_APK_VERSION, versionCode: CURRENT_APK_CODE };
    if (!isNativeApk()) return fallback;
    const b = getBridge();
    try {
      if (typeof b.getInstalledVersionInfo === 'function') {
        const parsed = JSON.parse(b.getInstalledVersionInfo());
        if (parsed && parsed.versionName) {
          return {
            versionName: String(parsed.versionName).replace(/^v/i, ''),
            versionCode: Number(parsed.versionCode) || 0,
            certSha256: String(parsed.certSha256 || '')
          };
        }
      }
      if (typeof b.getAppVersion === 'function') {
        const rawVer = String(b.getAppVersion() || '').trim();
        if (rawVer) {
          return { versionName: rawVer.replace(/^v/i, ''), versionCode: 0 };
        }
      }
    } catch {}
    return fallback;
  }

  function getInstalledVersionLabel() {
    const info = getInstalledVersionInfo();
    const ver = String(info.versionName || CURRENT_APK_VERSION).replace(/^v/i, '');
    return info.versionCode > 0 ? `v${ver} (${info.versionCode})` : `v${ver}`;
  }

  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function showToast(msg) {
    const toastEl = $('memory-toast');
    if (toastEl) {
      toastEl.textContent = String(msg || '');
      toastEl.classList.remove('hidden');
      clearTimeout(toastEl._paTimer);
      toastEl._paTimer = setTimeout(() => {
        toastEl.classList.add('hidden');
      }, 3200);
    }
    if (isNativeApk() && typeof getBridge()?.showToast === 'function' && String(msg || '').length < 48) {
      try {
        getBridge().showToast(String(msg));
      } catch {}
    }
  }

  function getAuthToken() {
    try {
      if (window.__starAuthStore && typeof window.__starAuthStore.getToken === 'function') {
        const stored = window.__starAuthStore.getToken();
        if (stored) return stored;
      }
      return (
        localStorage.getItem('star_whisper_token') ||
        localStorage.getItem('persona_studio_token') ||
        ''
      );
    } catch {
      return '';
    }
  }

  async function apiPostJson(url, payload, signal) {
    const headers = { 'Content-Type': 'application/json' };
    const tok = getAuthToken();
    if (tok) headers.Authorization = `Bearer ${tok}`;
    try {
      const uid = window.__starAuthStore && typeof window.__starAuthStore.getActiveUserId === 'function'
        ? window.__starAuthStore.getActiveUserId()
        : '';
      if (uid) headers['X-Expected-User-Id'] = uid;
    } catch {}
    const res = await fetch(url, {
      method: 'POST',
      headers,
      credentials: 'same-origin',
      body: JSON.stringify(payload || {}),
      signal
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok && data.ok !== false, status: res.status, data };
  }

  function getExecMode() {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.execMode);
      if (saved === 'api_direct' || saved === 'api_cloud' || saved === 'local') return saved;
    } catch {}
    const cfg = getDirectConfig();
    return cfg.apiKey ? 'api_direct' : 'api_cloud';
  }

  function setExecMode(mode) {
    const next = mode === 'api_cloud' || mode === 'local' ? mode : 'api_direct';
    try {
      localStorage.setItem(STORAGE_KEYS.execMode, next);
    } catch {}
    syncStatus();
    return next;
  }

  function getConfirmPolicy() {
    try {
      const p = localStorage.getItem(STORAGE_KEYS.confirmPolicy);
      if (p === 'ask_every' || p === 'sensitive_only' || p === 'auto_turn') return p;
      if (localStorage.getItem(STORAGE_KEYS.autoApprove) === '1') return 'auto_turn';
    } catch {}
    return 'sensitive_only';
  }

  function setConfirmPolicy(policy) {
    const next = policy === 'ask_every' || policy === 'auto_turn' ? policy : 'sensitive_only';
    try {
      localStorage.setItem(STORAGE_KEYS.confirmPolicy, next);
      localStorage.setItem(STORAGE_KEYS.autoApprove, next === 'auto_turn' ? '1' : '0');
    } catch {}
    syncStatus();
    return next;
  }

  function getPolicyLabel(policy) {
    if (policy === 'ask_every') return '每次确认';
    if (policy === 'auto_turn') return '托管放行';
    return '仅敏感确认';
  }

  function getTrustedApps() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.trustedApps);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr.filter((x) => x && (x.packageName || x.appName)) : [];
    } catch {
      return [];
    }
  }

  function addTrustedApp(appName, packageName) {
    const pkg = String(packageName || '').trim();
    const name = String(appName || pkg).trim();
    if (!pkg && !name) return;
    const list = getTrustedApps().filter((x) => (pkg ? x.packageName !== pkg : x.appName !== name));
    list.unshift({ appName: name, packageName: pkg, ts: Date.now() });
    try {
      localStorage.setItem(STORAGE_KEYS.trustedApps, JSON.stringify(list.slice(0, 30)));
    } catch {}
    syncStatus();
  }

  function removeTrustedApp(key) {
    const list = getTrustedApps().filter((x) => x.packageName !== key && x.appName !== key);
    try {
      localStorage.setItem(STORAGE_KEYS.trustedApps, JSON.stringify(list));
    } catch {}
    syncStatus();
  }

  function isAppTrusted(appName, packageName) {
    const pkg = String(packageName || '').trim();
    const name = String(appName || '').trim();
    return getTrustedApps().some((x) => (pkg && x.packageName === pkg) || (name && x.appName === name));
  }

  function isEdgeGlowEnabled() {
    try {
      return localStorage.getItem(STORAGE_KEYS.edgeGlow) !== '0';
    } catch {
      return true;
    }
  }

  function setEdgeGlowPref(enabled) {
    const flag = Boolean(enabled);
    try {
      localStorage.setItem(STORAGE_KEYS.edgeGlow, flag ? '1' : '0');
    } catch {}
    const b = getBridge();
    if (isNativeApk() && b && typeof b.setEdgeGlowEnabled === 'function') {
      try { b.setEdgeGlowEnabled(flag); } catch {}
    }
    syncStatus();
  }

  function renderTrustedAppsList() {
    const wrap = $('pa-trusted-apps-list');
    if (!wrap) return;
    const list = getTrustedApps();
    if (list.length === 0) {
      wrap.innerHTML = `<span class="pa-trusted-empty">暂无白名单应用（在确认卡点“信任此App”可自动加入）</span>`;
      return;
    }
    wrap.innerHTML = list
      .map((item) => {
        const key = item.packageName || item.appName;
        return `
          <span class="pa-trusted-chip">
            <span>${escapeHtml(item.appName || item.packageName)}</span>
            <button type="button" data-remove-trust="${escapeHtml(key)}" title="移出白名单" aria-label="移出白名单">✕</button>
          </span>
        `;
      })
      .join('');
    wrap.querySelectorAll('button[data-remove-trust]').forEach((btn) => {
      btn.addEventListener('click', () => {
        removeTrustedApp(btn.getAttribute('data-remove-trust') || '');
      });
    });
  }

  function getDirectConfig() {
    let apiKey = '';
    let model = 'deepseek-chat';
    let baseUrl = '';
    let autoApprove = false;
    try {
      apiKey = (
        localStorage.getItem(STORAGE_KEYS.exclusiveKey) ||
        localStorage.getItem(STORAGE_KEYS.keyPrimary) ||
        localStorage.getItem(STORAGE_KEYS.keyFallback) ||
        ''
      ).trim();
      model = (localStorage.getItem(STORAGE_KEYS.directModel) || 'deepseek-chat').trim();
      baseUrl = (localStorage.getItem(STORAGE_KEYS.directBaseUrl) || '').trim();
      autoApprove = localStorage.getItem(STORAGE_KEYS.autoApprove) === '1';
    } catch {}
    return { apiKey, model, baseUrl, autoApprove };
  }

  function setDirectApiKey(key) {
    const clean = String(key || '').trim();
    try {
      if (clean) {
        localStorage.setItem(STORAGE_KEYS.exclusiveKey, clean);
      } else {
        localStorage.removeItem(STORAGE_KEYS.exclusiveKey);
      }
    } catch {}
    const cfgInput = $('pa-cfg-apikey');
    if (cfgInput && cfgInput.value !== clean) cfgInput.value = clean;
    syncStatus();
  }

  function setAutoApprove(val) {
    try {
      localStorage.setItem(STORAGE_KEYS.autoApprove, val ? '1' : '0');
    } catch {}
    const chk = $('pa-cfg-auto-approve');
    if (chk) chk.checked = Boolean(val);
    syncStatus();
  }

  function getEngineLabel(mode) {
    if (mode === 'api_cloud') return '云端 API';
    if (mode === 'local') return '本地免 API';
    return 'DeepSeek API';
  }

  // ========= 独立手机辅助任务历史记录（与 DeepSeek 会话 100% 物理隔离） =========
  function loadTaskHistory() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.taskHistory);
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }

  function recordTaskHistory(cmdText, mode) {
    const clean = String(cmdText || '').trim();
    if (!clean || clean === '__inspect_screen__') return;
    try {
      const prev = loadTaskHistory().filter((item) => item && item.cmd !== clean);
      prev.unshift({
        cmd: clean,
        mode: getEngineLabel(mode || getExecMode()),
        ts: Date.now()
      });
      localStorage.setItem(STORAGE_KEYS.taskHistory, JSON.stringify(prev.slice(0, 30)));
    } catch {}
    renderSidebarHistory();
  }

  function clearTaskHistory() {
    try {
      localStorage.removeItem(STORAGE_KEYS.taskHistory);
    } catch {}
    renderSidebarHistory();
    showToast('已清空手机辅助历史指令记录');
  }

  function renderSidebarHistory() {
    const container = $('pa-task-history-list');
    if (!container) return;
    const list = loadTaskHistory();
    if (list.length === 0) {
      container.innerHTML = `<div class="pa-history-empty">暂无最近执行的手机指令<br/>点击下方指令库或输入口令即可开始</div>`;
      return;
    }
    container.innerHTML = list
      .map((item) => {
        const d = new Date(Number(item.ts) || Date.now());
        const pad = (n) => String(n).padStart(2, '0');
        const timeStr = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
        return `
          <button type="button" class="pa-history-item" data-pa-hist-cmd="${escapeHtml(item.cmd)}">
            <span class="pa-history-cmd">${escapeHtml(item.cmd)}</span>
            <span class="pa-history-meta">${escapeHtml(item.mode || '本地免 API')} · ${timeStr}</span>
          </button>
        `;
      })
      .join('');
    container.querySelectorAll('.pa-history-item').forEach((btn) => {
      btn.addEventListener('click', () => {
        const cmd = btn.getAttribute('data-pa-hist-cmd') || '';
        if (!cmd) return;
        window.__closeMobileDrawers?.();
        executeTaskInChat(cmd);
      });
    });
  }

  function syncWebEnvironmentGates() {
    const native = isNativeApk();
    const shell = document.getElementById('app-shell');
    if (shell) {
      shell.classList.toggle('pa-web-unavailable', !native);
      shell.classList.toggle('in-native-apk', native);
    }
    document.documentElement.classList.toggle('in-native-apk', native);
    $('topbar-apk-download-btn')?.classList.toggle('hidden', native);
    $('sidebar-web-download-wrap')?.classList.toggle('hidden', native);
    if (!native) {
      $('phone-agent-banner')?.classList.add('hidden');
      $('pa-empty-guide')?.classList.add('hidden');
      $('phone-cmd-quick-drawer')?.classList.add('hidden');
    }
    return native;
  }

  function createWebUnavailableCard() {
    const wrap = document.createElement('div');
    wrap.className = 'pa-web-unavailable-wrap';
    wrap.innerHTML = `
      <div class="pa-web-unavailable-card" role="region" aria-label="手机辅助网页端不可用说明">
        <div class="pa-wu-icon" aria-hidden="true">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
            <rect x="5" y="2" width="14" height="20" rx="2.5" ry="2.5"></rect>
            <line x1="12" y1="18" x2="12.01" y2="18"></line>
          </svg>
        </div>
        <span class="pa-wu-badge">仅限 Android App 端开放</span>
        <h2 class="pa-wu-title">手机辅助功能在网页端不可用</h2>
        <p class="pa-wu-desc">
          受限于浏览器安全沙箱，网页端无法读取手机屏幕、调用无障碍服务或开启悬浮窗。请下载安装星语恋庭 Android 随身版 App，在 App 内即可开放使用完整的手机辅助与自动操控功能。
        </p>
        <div class="pa-wu-actions">
          <button type="button" class="pa-wu-primary-btn" id="pa-web-download-app-btn">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="7 10 12 15 17 10"></polyline>
              <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
            <span>立即下载 Android 随身版 App</span>
          </button>
          <button type="button" class="pa-wu-secondary-btn" id="pa-web-back-ds-btn">返回 DeepSeek 对话</button>
        </div>
      </div>
    `;
    wrap.querySelector('#pa-web-download-app-btn')?.addEventListener('click', openModal);
    wrap.querySelector('#pa-web-back-ds-btn')?.addEventListener('click', () => {
      document.getElementById('ws-mode-deepseek')?.click();
    });
    return wrap;
  }

  function syncEmptyGuideVisibility() {
    const guide = $('pa-empty-guide');
    if (!guide) return;
    const native = isNativeApk();
    const isPaMode = document.getElementById('app-shell')?.dataset.uiMode === 'phone-agent';
    guide.classList.toggle('hidden', !native || !isPaMode || paSessionNodes.length > 0);
  }

  function renderWorkspace() {
    const native = syncWebEnvironmentGates();
    const container = $('messages-container');
    if (!container) return;
    container.innerHTML = '';
    if (!native) {
      container.appendChild(createWebUnavailableCard());
      syncEmptyGuideVisibility();
      syncStatus();
      return;
    }
    for (const node of paSessionNodes) {
      container.appendChild(node);
    }
    syncEmptyGuideVisibility();
    renderSidebarHistory();
    syncStatus();
    if (typeof window.__refreshChatQuickNav === 'function') {
      window.__refreshChatQuickNav();
    }
    if (paSessionNodes.length > 0) {
      scrollChatToBottom();
    }
  }

  function resetTaskWorkspace() {
    if (activeAbortController) {
      try {
        activeAbortController.abort();
      } catch {}
    }
    emergencyStopRequested = true;
    paSessionNodes = [];
    const container = $('messages-container');
    if (container) container.innerHTML = '';
    closeControlSheet();
    $('phone-cmd-quick-drawer')?.classList.add('hidden');
    $('pa-open-cmdlib-btn')?.classList.remove('is-active');
    syncEmptyGuideVisibility();
    if (typeof window.__refreshChatQuickNav === 'function') {
      window.__refreshChatQuickNav();
    }
    showToast('已重置手机辅助任务面板');
  }

  function onEnterMode() {
    renderWorkspace();
  }

  // ========= Bottom-Sheet 控制台抽屉 & 分类离线指令库渲染 =========
  function openControlSheet(focusApiKey = false) {
    syncStatus();
    $('pa-sheet-backdrop')?.classList.remove('hidden');
    $('pa-control-sheet')?.classList.remove('hidden');
    $('pa-cfg-toggle-btn')?.setAttribute('aria-expanded', 'true');
    if (focusApiKey) {
      $('pa-inline-config-drawer')?.classList.remove('hidden');
      setTimeout(() => $('pa-cfg-apikey')?.focus(), 80);
    }
  }

  function closeControlSheet() {
    $('pa-sheet-backdrop')?.classList.add('hidden');
    $('pa-control-sheet')?.classList.add('hidden');
    $('pa-cfg-toggle-btn')?.setAttribute('aria-expanded', 'false');
  }

  function renderEmptyGuideTiles() {
    const grid = $('pa-empty-guide-grid');
    if (!grid) return;
    grid.innerHTML = EMPTY_GUIDE_PRESETS.map(
      (item) => `
        <button type="button" class="pa-guide-tile" data-cmd="${escapeHtml(item.cmd)}" data-mode="${escapeHtml(item.mode)}">
          <strong>${escapeHtml(item.label)}</strong>
          <span>${escapeHtml(item.sub)}</span>
        </button>
      `
    ).join('');

    grid.querySelectorAll('.pa-guide-tile').forEach((tile) => {
      tile.addEventListener('click', () => {
        const cmd = tile.getAttribute('data-cmd') || '';
        const mode = tile.getAttribute('data-mode') || 'exec';
        handleCatalogItemTrigger(cmd, mode);
      });
    });
  }

  function parseQuickPhrasesFromText(raw) {
    const clean = String(raw || '').trim();
    if (!clean) return [];
    if (clean.startsWith('[')) {
      try {
        const arr = JSON.parse(clean);
        if (Array.isArray(arr)) {
          const out = [];
          for (const it of arr) {
            const s = String(it || '').trim();
            if (s && !out.includes(s)) out.push(s);
            if (out.length >= 80) break;
          }
          return out;
        }
      } catch {}
    }
    const lines = clean.split(/\r?\n|\|\|\|/);
    const out = [];
    for (const ln of lines) {
      let item = String(ln || '').trim();
      item = item.replace(/^(?:\d+[\.\、\)]\s*|[-*•]\s+)/, '').trim();
      if (item && !out.includes(item)) {
        out.push(item);
        if (out.length >= 80) break;
      }
    }
    return out;
  }

  function loadQuickPhrases() {
    try {
      const bridge = getNativeBridge();
      if (bridge && typeof bridge.getQuickPhrasesJson === 'function') {
        const nativeJson = bridge.getQuickPhrasesJson();
        const parsed = parseQuickPhrasesFromText(nativeJson);
        if (parsed.length > 0) return parsed;
      }
    } catch {}
    try {
      const raw = localStorage.getItem(QUICK_PHRASES_STORAGE_KEY);
      if (raw) {
        const parsed = parseQuickPhrasesFromText(raw);
        if (parsed.length > 0) return parsed;
      }
    } catch {}
    return [...DEFAULT_QUICK_PHRASES];
  }

  function saveQuickPhrases(list) {
    const clean = [];
    for (const s of (Array.isArray(list) ? list : [])) {
      const t = String(s || '').trim();
      if (t && !clean.includes(t)) clean.push(t);
      if (clean.length >= 80) break;
    }
    const json = JSON.stringify(clean);
    try {
      localStorage.setItem(QUICK_PHRASES_STORAGE_KEY, json);
    } catch {}
    try {
      const bridge = getNativeBridge();
      if (bridge && typeof bridge.saveQuickPhrasesJson === 'function') {
        bridge.saveQuickPhrasesJson(json);
      }
    } catch {}
    return clean;
  }

  function loadCustomSongs() {
    try {
      const bridge = getNativeBridge();
      if (bridge && typeof bridge.getCustomSongsJson === 'function') {
        const raw = bridge.getCustomSongsJson();
        const arr = JSON.parse(raw || '[]');
        if (Array.isArray(arr)) return arr;
      }
    } catch {}
    return [];
  }

  window.addEventListener('pa-songs-updated', () => {
    const drawer = $('phone-cmd-quick-drawer');
    if (drawer && !drawer.classList.contains('hidden') && activeCmdLibCategory === 'songs') {
      renderCommandLibraryDrawer();
    }
  });

  function renderCommandLibraryDrawer() {
    const drawer = $('phone-cmd-quick-drawer');
    if (!drawer) return;
    const cat = LOCAL_COMMAND_CATALOG.find((c) => c.id === activeCmdLibCategory) || LOCAL_COMMAND_CATALOG[0];
    const isPhrasesTab = cat.id === 'phrases';
    const isSongsTab = cat.id === 'songs';
    const phrases = isPhrasesTab ? loadQuickPhrases() : [];
    const songs = isSongsTab ? loadCustomSongs() : [];

    let bodyHtml = '';
    if (isSongsTab) {
      const bridge = getNativeBridge();
      const canImportSong = !!(bridge && typeof bridge.openSongImporter === 'function');
      bodyHtml = `
        <div class="pa-phrase-toolbar">
          <button type="button" class="pa-phrase-btn is-primary" id="pa-song-import-btn">🎵 导入手机实际歌声 (MP3/WAV/M4A)</button>
          ${canImportSong ? '<button type="button" class="pa-phrase-btn" id="pa-song-stop-btn">⏹ 停止唱歌</button>' : ''}
        </div>
        <div class="pa-phrase-list">
          ${!canImportSong
            ? '<div class="pa-phrase-empty">请在 Android「DeepSeek · 星语随身版」App 中打开，即可批量导入手机本地真实唱歌音频给大肥鱼献唱</div>'
            : (songs.length === 0
                ? '<div class="pa-phrase-empty">尚未导入外部歌声音频（当前默认内置甜美真人唱词，不再是电子哼调）。点击上方按钮挑几首你喜欢的声音导进来吧！</div>'
                : songs.map((s) => `
                    <div class="pa-phrase-row" data-song-id="${escapeHtml(s.id)}">
                      <button type="button" class="pa-phrase-send-btn pa-song-play-btn" data-song-id="${escapeHtml(s.id)}" title="点击让桌面大肥鱼唱这首">▶ ${escapeHtml(s.title || '未命名歌声')}</button>
                      <button type="button" class="pa-phrase-fill-btn pa-song-rename-btn" data-song-id="${escapeHtml(s.id)}" data-title="${escapeHtml(s.title || '')}" title="改名">改名</button>
                      <button type="button" class="pa-phrase-del-btn pa-song-del-btn" data-song-id="${escapeHtml(s.id)}" title="删除">✕</button>
                    </div>
                  `).join(''))}
        </div>
      `;
    } else if (isPhrasesTab) {
      const bridge = getNativeBridge();
      const canOpenFloatBar = !!(bridge && typeof bridge.openQuickTypingMode === 'function');
      bodyHtml = `
        <div class="pa-phrase-toolbar">
          <button type="button" class="pa-phrase-btn is-primary" id="pa-phrase-add-one">➕ 新增</button>
          <button type="button" class="pa-phrase-btn" id="pa-phrase-import-file">📥 导入TXT文件</button>
          <button type="button" class="pa-phrase-btn" id="pa-phrase-toggle-batch">${quickPhraseBatchBoxOpen ? '收起批量框' : '✏️ 批量粘贴'}</button>
          ${canOpenFloatBar ? '<button type="button" class="pa-phrase-btn is-accent" id="pa-phrase-open-float">⌨️ 桌面快捷条</button>' : ''}
          <input type="file" id="pa-phrase-file-input" accept=".txt,.md,.json,.csv,text/plain,application/json" style="display:none" />
        </div>
        ${quickPhraseBatchBoxOpen ? `
          <div class="pa-phrase-import-box">
            <textarea id="pa-phrase-batch-ta" rows="3" placeholder="每行粘贴一条常用聊天文字（或 JSON 数组），导入后自动同步到桌面大肥鱼悬浮快捷打字条"></textarea>
            <div class="pa-phrase-import-actions">
              <button type="button" class="pa-phrase-btn is-primary" id="pa-phrase-batch-append">追加导入</button>
              <button type="button" class="pa-phrase-btn" id="pa-phrase-batch-replace">覆盖导入</button>
              <button type="button" class="pa-phrase-btn" id="pa-phrase-batch-reset">恢复默认</button>
            </div>
          </div>
        ` : ''}
        <div class="pa-phrase-list">
          ${phrases.length === 0
            ? '<div class="pa-phrase-empty">暂无常用聊天文字，点击上方「导入TXT文件」或「批量粘贴」添加</div>'
            : phrases.map((p, idx) => `
                <div class="pa-phrase-row" data-idx="${idx}">
                  <button type="button" class="pa-phrase-send-btn" data-phrase="${escapeHtml(p)}" title="点击直接打字并发送">${escapeHtml(p)}</button>
                  <button type="button" class="pa-phrase-fill-btn" data-phrase="${escapeHtml(p)}" title="仅填入输入框">填入</button>
                  <button type="button" class="pa-phrase-del-btn" data-idx="${idx}" title="删除此条">✕</button>
                </div>
              `).join('')}
        </div>
      `;
    } else {
      bodyHtml = `
        <div class="pa-cmdlib-grid">
          ${cat.items
            .map(
              (item) => `
                <button type="button" class="pa-cmd-item ${item.mode === 'fill' ? 'is-fill' : ''}" data-cmd="${escapeHtml(item.cmd)}" data-mode="${escapeHtml(item.mode)}">
                  <div class="pa-cmd-item-top">
                    <span>${escapeHtml(item.label)}</span>
                    <em class="pa-cmd-mode-tag ${item.mode === 'fill' ? 'is-fill' : 'is-exec'}">${item.mode === 'fill' ? '需填词' : ''}</em>
                  </div>
                  <small>${escapeHtml(item.desc)}</small>
                </button>
              `
            )
            .join('')}
        </div>
      `;
    }

    drawer.innerHTML = `
      <div class="pa-cmdlib-topbar">
        <span class="pa-cmdlib-title">快捷指令与常用语</span>
        <button type="button" class="pa-cmdlib-close" id="pa-cmdlib-close-btn" title="收起指令库" aria-label="收起指令库">✕</button>
      </div>
      <div class="pa-cmdlib-head">
        <div class="pa-cmdlib-tabs" role="tablist" aria-label="快捷指令分类">
          ${LOCAL_COMMAND_CATALOG.map(
            (c) => `
              <button type="button" class="pa-cmdlib-tab ${c.id === cat.id ? 'active' : ''}" data-cat-id="${escapeHtml(c.id)}" role="tab" aria-selected="${c.id === cat.id}">
                ${escapeHtml(c.title)}
              </button>
            `
          ).join('')}
        </div>
      </div>
      ${bodyHtml}
    `;

    drawer.querySelectorAll('.pa-cmdlib-tab').forEach((tabBtn) => {
      tabBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        activeCmdLibCategory = tabBtn.getAttribute('data-cat-id') || 'common';
        renderCommandLibraryDrawer();
      });
    });

    drawer.querySelector('#pa-cmdlib-close-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      drawer.classList.add('hidden');
      $('pa-open-cmdlib-btn')?.classList.remove('is-active');
      $('mobile-tools-plus-btn')?.classList.remove('is-active');
    });

    if (isSongsTab) {
      drawer.querySelector('#pa-song-import-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        const b = getNativeBridge();
        if (b && typeof b.openSongImporter === 'function') {
          b.openSongImporter();
        } else {
          showToast('请在 Android 随身版 App 中点击导入手机本地真实音频');
        }
      });

      drawer.querySelector('#pa-song-stop-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        const b = getNativeBridge();
        if (b && typeof b.stopCustomSongNow === 'function') {
          b.stopCustomSongNow();
          showToast('已停止大肥鱼歌唱');
        }
      });

      drawer.querySelectorAll('.pa-song-play-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const id = btn.getAttribute('data-song-id') || '';
          const b = getNativeBridge();
          if (b && typeof b.playCustomSongNow === 'function' && id) {
            b.playCustomSongNow(id);
            showToast('大肥鱼已开唱你导入的真实歌声~');
          }
        });
      });

      drawer.querySelectorAll('.pa-song-rename-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const id = btn.getAttribute('data-song-id') || '';
          const curTitle = btn.getAttribute('data-title') || '';
          const nextTitle = window.prompt('请输入新的歌曲显示名称：', curTitle);
          const b = getNativeBridge();
          if (nextTitle && nextTitle.trim() && b && typeof b.renameCustomSong === 'function') {
            b.renameCustomSong(id, nextTitle.trim());
            renderCommandLibraryDrawer();
          }
        });
      });

      drawer.querySelectorAll('.pa-song-del-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const id = btn.getAttribute('data-song-id') || '';
          const b = getNativeBridge();
          if (b && typeof b.deleteCustomSong === 'function' && id) {
            b.deleteCustomSong(id);
            renderCommandLibraryDrawer();
          }
        });
      });
    } else if (isPhrasesTab) {
      drawer.querySelector('#pa-phrase-add-one')?.addEventListener('click', (e) => {
        e.stopPropagation();
        const paInput = $('pa-task-input');
        const chatInput = $('chat-input');
        const currentVal = String((paInput && paInput.offsetParent !== null ? paInput.value : chatInput?.value) || '').trim();
        const text = currentVal || window.prompt('请输入要保存的常用聊天文字：', '');
        if (!text || !String(text).trim()) return;
        const cur = loadQuickPhrases();
        const clean = String(text).trim();
        const next = saveQuickPhrases([clean, ...cur.filter((x) => x !== clean)]);
        showToast(`已保存常用语「${clean}」（共 ${next.length} 条，已同步悬浮窗）`);
        renderCommandLibraryDrawer();
      });

      drawer.querySelector('#pa-phrase-import-file')?.addEventListener('click', (e) => {
        e.stopPropagation();
        drawer.querySelector('#pa-phrase-file-input')?.click();
      });

      drawer.querySelector('#pa-phrase-file-input')?.addEventListener('change', async (e) => {
        const file = e.target?.files?.[0];
        if (!file) return;
        try {
          const text = await file.text();
          const parsed = parseQuickPhrasesFromText(text);
          if (!parsed.length) {
            showToast('文件中未解析到有效聊天文字行');
            return;
          }
          const cur = loadQuickPhrases();
          const merged = saveQuickPhrases([...parsed, ...cur]);
          showToast(`成功从文件导入 ${parsed.length} 条（现共 ${merged.length} 条，已同步大肥鱼）`);
          renderCommandLibraryDrawer();
        } catch {
          showToast('读取文件失败，请确认文件为 UTF-8 文本或 JSON');
        }
      });

      drawer.querySelector('#pa-phrase-toggle-batch')?.addEventListener('click', (e) => {
        e.stopPropagation();
        quickPhraseBatchBoxOpen = !quickPhraseBatchBoxOpen;
        renderCommandLibraryDrawer();
      });

      drawer.querySelector('#pa-phrase-open-float')?.addEventListener('click', (e) => {
        e.stopPropagation();
        const b = getNativeBridge();
        if (b && typeof b.openQuickTypingMode === 'function') {
          drawer.classList.add('hidden');
          b.openQuickTypingMode();
        }
      });

      drawer.querySelector('#pa-phrase-batch-append')?.addEventListener('click', (e) => {
        e.stopPropagation();
        const raw = drawer.querySelector('#pa-phrase-batch-ta')?.value || '';
        const parsed = parseQuickPhrasesFromText(raw);
        if (!parsed.length) {
          showToast('请先输入或粘贴至少一行常用文字');
          return;
        }
        const cur = loadQuickPhrases();
        const next = saveQuickPhrases([...parsed, ...cur]);
        quickPhraseBatchBoxOpen = false;
        showToast(`已追加导入 ${parsed.length} 条（共 ${next.length} 条，已同步桌面悬浮条）`);
        renderCommandLibraryDrawer();
      });

      drawer.querySelector('#pa-phrase-batch-replace')?.addEventListener('click', (e) => {
        e.stopPropagation();
        const raw = drawer.querySelector('#pa-phrase-batch-ta')?.value || '';
        const parsed = parseQuickPhrasesFromText(raw);
        if (!parsed.length) {
          showToast('请先输入或粘贴至少一行常用文字');
          return;
        }
        const next = saveQuickPhrases(parsed);
        quickPhraseBatchBoxOpen = false;
        showToast(`已覆盖导入 ${next.length} 条常用聊天文字`);
        renderCommandLibraryDrawer();
      });

      drawer.querySelector('#pa-phrase-batch-reset')?.addEventListener('click', (e) => {
        e.stopPropagation();
        saveQuickPhrases(DEFAULT_QUICK_PHRASES);
        quickPhraseBatchBoxOpen = false;
        showToast('已恢复默认常用聊天文字');
        renderCommandLibraryDrawer();
      });

      drawer.querySelectorAll('.pa-phrase-send-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const phrase = btn.getAttribute('data-phrase') || '';
          if (phrase) handleCatalogItemTrigger(`打字并发送 ${phrase}`, 'exec');
        });
      });

      drawer.querySelectorAll('.pa-phrase-fill-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const phrase = btn.getAttribute('data-phrase') || '';
          if (!phrase) return;
          const paInput = $('pa-task-input');
          const chatInput = $('chat-input');
          const targetInput = (paInput && paInput.offsetParent !== null) ? paInput : chatInput;
          if (targetInput) {
            targetInput.value = `打字并发送 ${phrase}`;
            targetInput.dispatchEvent(new Event('input', { bubbles: true }));
            targetInput.focus();
          }
          drawer.classList.add('hidden');
          showToast(`已填入「${phrase}」`);
        });
      });

      drawer.querySelectorAll('.pa-phrase-del-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const idx = Number(btn.getAttribute('data-idx'));
          const cur = loadQuickPhrases();
          if (idx >= 0 && idx < cur.length) {
            cur.splice(idx, 1);
            saveQuickPhrases(cur);
            renderCommandLibraryDrawer();
          }
        });
      });
    } else {
      drawer.querySelectorAll('.pa-cmd-item').forEach((itemBtn) => {
        itemBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const cmd = itemBtn.getAttribute('data-cmd') || '';
          const mode = itemBtn.getAttribute('data-mode') || 'exec';
          handleCatalogItemTrigger(cmd, mode);
        });
      });
    }
  }

  function handleCatalogItemTrigger(cmd, mode) {
    if (!cmd) return;
    const drawer = $('phone-cmd-quick-drawer');
    if (drawer) drawer.classList.add('hidden');
    $('pa-open-cmdlib-btn')?.classList.remove('is-active');

    if (cmd === '__inspect_screen__') {
      inspectScreenInChat();
      return;
    }

    const paInput = $('pa-task-input');
    const chatInput = $('chat-input');
    const targetInput = (paInput && paInput.offsetParent !== null) ? paInput : chatInput;

    if (mode === 'fill') {
      if (targetInput) {
        targetInput.value = cmd;
        targetInput.dispatchEvent(new Event('input', { bubbles: true }));
        targetInput.focus();
        try {
          targetInput.setSelectionRange(cmd.length, cmd.length);
        } catch {}
      }
      if (chatInput && chatInput !== targetInput) {
        chatInput.value = cmd;
        chatInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
      showToast(`请补充「${cmd.trim()}」后的文字内容并点击执行`);
      return;
    }

    executeTaskInChat(cmd);
  }

  function appendNativeConsoleLog(text) {
    const logEl = $('phone-agent-log-console');
    if (!logEl) return;
    const now = new Date();
    const ts = now.toTimeString().slice(0, 8);
    logEl.textContent += `[${ts}] ${text}\n`;
    logEl.scrollTop = logEl.scrollHeight;
  }

  function parseSemverTuple(verStr) {
    const clean = String(verStr || '').replace(/^v/i, '').split(/[-+]/)[0];
    return clean.split('.').map((n) => parseInt(n, 10) || 0);
  }

  function isNewerVersion(remoteVer, localVer) {
    const r = parseSemverTuple(remoteVer);
    const l = parseSemverTuple(localVer);
    const len = Math.max(r.length, l.length);
    for (let i = 0; i < len; i++) {
      const rv = r[i] || 0;
      const lv = l[i] || 0;
      if (rv > lv) return true;
      if (rv < lv) return false;
    }
    return false;
  }

  function syncModalEngineAndApkState() {
    const native = isNativeApk();
    const webCard = $('apk-web-download-card');
    const nativeVerCard = $('apk-native-version-card');
    const nativeCtrlBox = $('phone-agent-native-panel');
    const webIntro = $('phone-agent-web-intro');

    if (webCard) webCard.classList.toggle('hidden', native);
    if (nativeVerCard) nativeVerCard.classList.toggle('hidden', !native);
    if (nativeCtrlBox) nativeCtrlBox.classList.toggle('hidden', !native);
    if (webIntro) webIntro.classList.toggle('hidden', native);

    if (native) {
      const b = getBridge();
      const verInfo = getInstalledVersionInfo();
      const verBadge = $('anv-current-version');
      if (verBadge) {
        verBadge.textContent = verInfo.versionCode > 0
          ? `v${verInfo.versionName} (Build ${verInfo.versionCode} 已就绪)`
          : `v${verInfo.versionName} (已就绪)`;
      }

      let a11yOk = false;
      let floatOn = false;
      try {
        a11yOk = Boolean(b.isAccessibilityEnabled && b.isAccessibilityEnabled());
        floatOn = Boolean(b.isFloatAgentRunning && b.isFloatAgentRunning());
      } catch {}

      const a11yTag = $('pa-a11y-status-tag');
      if (a11yTag) {
        a11yTag.className = `phone-agent-status-tag ${a11yOk ? 'active' : 'pending'}`;
        a11yTag.textContent = a11yOk ? '无障碍已授权' : '无障碍未开启';
      }
      const floatTag = $('pa-float-status-tag');
      if (floatTag) {
        floatTag.className = `phone-agent-status-tag ${floatOn ? 'active' : 'disabled'}`;
        floatTag.textContent = floatOn ? '悬浮窗运行中' : '悬浮窗已停用';
      }
      const toggleFloatBtn = $('pa-toggle-float-btn');
      if (toggleFloatBtn) {
        toggleFloatBtn.textContent = floatOn ? '停用多功能悬浮窗' : '开启常驻多功能悬浮窗';
      }
    }
  }

  function syncStatus() {
    const mode = getExecMode();
    const cfg = getDirectConfig();
    const native = syncWebEnvironmentGates();
    const b = getBridge();

    // 1. 控制台抽屉内引擎分段按钮选中态
    document.querySelectorAll('.pa-seg-btn').forEach((btn) => {
      const active = btn.dataset.paMode === mode;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', String(active));
    });

    // 本地免 API 模式下自动折叠 API Key 输入面板，保持抽屉清爽
    const cfgDrawer = $('pa-inline-config-drawer');
    if (cfgDrawer) {
      cfgDrawer.classList.toggle('hidden', mode === 'local');
    }

    // 2. 同步配置抽屉表单默认值
    const keyInp = $('pa-cfg-apikey');
    if (keyInp && !keyInp.matches(':focus')) keyInp.value = cfg.apiKey;
    const modelSel = $('pa-cfg-model');
    if (modelSel && !modelSel.matches(':focus')) modelSel.value = cfg.model || 'deepseek-chat';
    const urlInp = $('pa-cfg-baseurl');
    if (urlInp && !urlInp.matches(':focus')) urlInp.value = cfg.baseUrl || '';
    const autoChk = $('pa-cfg-auto-approve');
    if (autoChk) autoChk.checked = Boolean(cfg.autoApprove);

    // 3. 同步权限状态与顶部单行紧凑栏
    let a11yOk = false;
    let floatOn = false;
    let autoSwiping = false;
    if (native && b) {
      try {
        a11yOk = Boolean(b.isAccessibilityEnabled && b.isAccessibilityEnabled());
        floatOn = Boolean(b.isFloatAgentRunning && b.isFloatAgentRunning());
        autoSwiping = Boolean(b.isAutoSwipeRunning && b.isAutoSwipeRunning());
      } catch {}
    }

    const compactDot = $('pa-compact-dot');
    const compactEngineEl = $('pa-compact-engine-label');
    const compactSubEl = $('pa-compact-status-sub');
    if (compactEngineEl) {
      compactEngineEl.textContent = getEngineLabel(mode);
    }
    if (compactDot && compactSubEl) {
      compactDot.classList.remove('is-active', 'is-pending', 'is-running');
      if (autoSwiping) {
        compactDot.classList.add('is-running');
        compactSubEl.textContent = '自动连刷视频中';
      } else if (!native) {
        compactSubEl.textContent = mode === 'local' ? '离线指令预览' : '网页规划预览';
      } else if (a11yOk) {
        compactDot.classList.add('is-active');
        compactSubEl.textContent = floatOn ? '无障碍+悬浮窗就绪' : '无障碍已就绪';
      } else {
        compactDot.classList.add('is-pending');
        compactSubEl.textContent = '点此开启无障碍';
      }
    }

    const a11yChip = $('pa-banner-a11y-chip');
    const a11yText = $('pa-banner-a11y-text');
    if (a11yChip && a11yText) {
      a11yChip.classList.remove('active', 'pending', 'disabled');
      if (!native) {
        a11yChip.classList.add('disabled');
        a11yText.textContent = '网页预览环境';
      } else if (a11yOk) {
        a11yChip.classList.add('active');
        a11yText.textContent = '无障碍已授权';
      } else {
        a11yChip.classList.add('pending');
        a11yText.textContent = '无障碍未授权 (点此开启)';
      }
    }

    const floatChip = $('pa-banner-float-chip');
    const floatText = $('pa-banner-float-text');
    const bannerFloatBtn = $('pa-banner-toggle-float-btn');
    const floatBtnLabel = $('pa-float-btn-label');
    if (floatChip && floatText) {
      floatChip.classList.remove('active', 'pending', 'disabled');
      if (!native) {
        floatChip.classList.add('disabled');
        floatText.textContent = '悬浮窗 (APK可用)';
      } else if (floatOn) {
        floatChip.classList.add('active');
        floatText.textContent = '悬浮窗运行中';
      } else {
        floatChip.classList.add('disabled');
        floatText.textContent = '悬浮窗未启用';
      }
    }
    if (bannerFloatBtn) {
      bannerFloatBtn.classList.toggle('is-active', floatOn);
    }
    if (floatBtnLabel) {
      floatBtnLabel.textContent = floatOn ? '悬浮中' : '悬浮窗';
    }

    const confirmChip = $('pa-banner-confirm-chip');
    const confirmText = $('pa-banner-confirm-text');
    const policy = getConfirmPolicy();
    const policyLabel = getPolicyLabel(policy);
    if (confirmChip && confirmText) {
      confirmChip.classList.remove('mode-on', 'disabled');
      if (policy === 'auto_turn') {
        confirmChip.classList.add('mode-on');
      } else if (policy === 'ask_every') {
        confirmChip.classList.add('disabled');
      }
      confirmText.textContent = policyLabel;
    }

    const topPolicyLabel = $('pa-policy-pill-label');
    if (topPolicyLabel) topPolicyLabel.textContent = policyLabel;
    const topPolicyPill = $('pa-banner-policy-pill');
    if (topPolicyPill) topPolicyPill.classList.toggle('is-active', policy === 'auto_turn');

    document.querySelectorAll('.pa-policy-card').forEach((card) => {
      const act = card.dataset.paPolicy === policy;
      card.classList.toggle('active', act);
      card.setAttribute('aria-checked', String(act));
    });
    renderTrustedAppsList();

    const edgeGlowChk = $('pa-cfg-edge-glow');
    if (edgeGlowChk) edgeGlowChk.checked = isEdgeGlowEnabled();

    const heroTitle = $('pa-empty-hero-title');
    const heroSub = $('pa-empty-hero-sub');
    if (heroTitle && heroSub) {
      if (native && !a11yOk) {
        heroTitle.textContent = '开启无障碍即可代劳控屏';
        heroSub.textContent = '点上方状态栏前往系统开启「DeepSeek · 星语」无障碍服务';
      } else {
        heroTitle.textContent = 'dsh-Go 手机控屏已就绪';
        heroSub.textContent = '支持三档安全确认，密码、支付与验证码操作始终交还给你';
      }
    }

    const autoSwipeBtn = $('pa-sheet-autoswipe-btn');
    const autoSwipeHint = $('pa-sheet-autoswipe-hint');
    if (autoSwipeBtn) {
      autoSwipeBtn.textContent = autoSwiping ? '停止连刷' : '开始连刷';
      autoSwipeBtn.classList.toggle('danger', autoSwiping);
    }
    if (autoSwipeHint) {
      autoSwipeHint.textContent = autoSwiping
        ? '正在后台自动上滑刷视频，随时可点右侧停止或轻触悬浮球急停'
        : '每 8 秒自动切换下一个视频，支持随时急停';
    }

    const mfsEngineVal = $('mfs-phone-engine-value');
    if (mfsEngineVal) {
      mfsEngineVal.textContent =
        mode === 'api_cloud'
          ? '云端托管 API'
          : mode === 'local'
            ? '本地免 API'
            : 'DeepSeek 直连 API';
    }

    syncModalEngineAndApkState();
  }

  function getScreenSizeObj() {
    if (isNativeApk()) {
      const b = getBridge();
      try {
        if (typeof b.getScreenSize === 'function') {
          const parsed = JSON.parse(b.getScreenSize());
          if (parsed && parsed.width > 0 && parsed.height > 0) return parsed;
        }
      } catch {}
    }
    return {
      width: Math.max(window.screen?.width || 1080, 720),
      height: Math.max(window.screen?.height || 2400, 1280)
    };
  }

  function getInstalledAppsList() {
    if (installedAppsCache && installedAppsCache.length > 0) return installedAppsCache;
    if (isNativeApk()) {
      const b = getBridge();
      try {
        if (typeof b.listInstalledApps === 'function') {
          const list = JSON.parse(b.listInstalledApps());
          if (Array.isArray(list)) {
            installedAppsCache = list;
            return list;
          }
        }
      } catch {}
    }
    return [];
  }

  function readAndFormatSnapshot(includeInvisible = false) {
    if (!isNativeApk()) {
      return {
        snapshotId: '',
        packageName: '',
        appName: '网页预览',
        signature: '',
        hasSensitiveField: false,
        sensitiveReason: '',
        nodes: [],
        screenTreeText: ''
      };
    }
    const b = getBridge();
    try {
      if (typeof b.dumpScreenSnapshot === 'function') {
        const raw = b.dumpScreenSnapshot(Boolean(includeInvisible));
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.nodes)) {
          const lines = parsed.nodes.slice(0, 120).map((n) => {
            const flags = [];
            if (n.clickable) flags.push('clk');
            if (n.editable) flags.push('edt');
            if (n.scrollable) flags.push('scr');
            if (n.checked) flags.push('chk');
            if (n.password) flags.push('pwd');
            const label = [n.text, n.desc].filter(Boolean).join(' / ').slice(0, 48);
            const cx = Array.isArray(n.center) ? n.center[0] : 0;
            const cy = Array.isArray(n.center) ? n.center[1] : 0;
            const flagStr = flags.length ? ` (${flags.join(',')})` : '';
            return `[${n.ref || ''}] ${n.cls || 'View'}${label ? ` "${label}"` : ''}${flagStr} @${cx},${cy}`;
          });
          return {
            snapshotId: String(parsed.snapshotId || ''),
            packageName: String(parsed.packageName || ''),
            appName: String(parsed.appName || parsed.packageName || ''),
            signature: String(parsed.signature || ''),
            hasSensitiveField: Boolean(parsed.hasSensitiveField),
            sensitiveReason: String(parsed.sensitiveReason || ''),
            nodes: parsed.nodes,
            screenTreeText: lines.join('\n')
          };
        }
      }
      if (typeof b.dumpScreenHierarchy === 'function') {
        const raw = b.dumpScreenHierarchy(false);
        const parsed = JSON.parse(raw);
        const nodes = Array.isArray(parsed) ? parsed : (parsed?.nodes || []);
        const refNodes = nodes.slice(0, 120).map((n, idx) => ({ ...n, ref: n.ref || `e${idx + 1}` }));
        const lines = refNodes.map((n) => {
          const cx = Array.isArray(n.center) ? n.center[0] : 0;
          const cy = Array.isArray(n.center) ? n.center[1] : 0;
          const label = [n.text, n.desc].filter(Boolean).join(' / ').slice(0, 48);
          return `[${n.ref}] ${String(n.className || 'View').split('.').pop()}${label ? ` "${label}"` : ''} @${cx},${cy}`;
        });
        return {
          snapshotId: '',
          packageName: String(parsed?.packageName || ''),
          appName: String(parsed?.packageName || ''),
          signature: '',
          hasSensitiveField: false,
          sensitiveReason: '',
          nodes: refNodes,
          screenTreeText: lines.join('\n')
        };
      }
    } catch {}
    return {
      snapshotId: '',
      packageName: '',
      appName: '',
      signature: '',
      hasSensitiveField: false,
      sensitiveReason: '',
      nodes: [],
      screenTreeText: ''
    };
  }

  function readScreenNodes() {
    return readAndFormatSnapshot(false).nodes;
  }

  function readScreenMeta() {
    if (!isNativeApk()) return { ok: false, packageName: '', appName: '', signature: '', hasSensitiveField: false, sensitiveReason: '' };
    const b = getBridge();
    try {
      if (typeof b.getScreenMeta === 'function') {
        return JSON.parse(b.getScreenMeta()) || {};
      }
    } catch {}
    return { ok: false, packageName: '', appName: '', signature: '', hasSensitiveField: false, sensitiveReason: '' };
  }

  async function waitForScreenVerdict(beforeMeta, toolName, signal) {
    if (!isNativeApk() || toolName === 'phone_wait' || toolName === 'done' || toolName === 'ask_user') {
      return { changed: true, fromApp: beforeMeta?.appName || '', toApp: beforeMeta?.appName || '', elapsedMs: 0 };
    }
    const maxWait = toolName === 'phone_open' ? 2400 : (toolName === 'phone_type' ? 1200 : 1500);
    const startAt = Date.now();
    let changed = false;
    let latest = beforeMeta || {};

    while (Date.now() - startAt < maxWait) {
      if (signal?.aborted || emergencyStopRequested) break;
      await sleep(220);
      latest = readScreenMeta();
      if (latest && latest.ok) {
        if (
          (beforeMeta?.packageName && latest.packageName && latest.packageName !== beforeMeta.packageName) ||
          (beforeMeta?.signature && latest.signature && latest.signature !== beforeMeta.signature)
        ) {
          changed = true;
          await sleep(280);
          latest = readScreenMeta();
          break;
        }
      }
    }

    return {
      changed,
      fromApp: beforeMeta?.appName || beforeMeta?.packageName || '',
      toApp: latest?.appName || latest?.packageName || '',
      elapsedMs: Date.now() - startAt,
      hasSensitiveField: Boolean(latest?.hasSensitiveField),
      sensitiveReason: String(latest?.sensitiveReason || '')
    };
  }

  function parseBoundsCenter(node) {
    if (!node) return null;
    if (Array.isArray(node.center) && node.center.length >= 2) {
      return { cx: Number(node.center[0]), cy: Number(node.center[1]) };
    }
    if (Array.isArray(node.bounds) && node.bounds.length >= 4) {
      return {
        cx: Math.round((Number(node.bounds[0]) + Number(node.bounds[2])) / 2),
        cy: Math.round((Number(node.bounds[1]) + Number(node.bounds[3])) / 2)
      };
    }
    const m = String(node.bounds || '').match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
    if (!m) return null;
    return {
      cx: Math.round((Number(m[1]) + Number(m[3])) / 2),
      cy: Math.round((Number(m[2]) + Number(m[4])) / 2)
    };
  }

  function findNodeCenterByText(nodes, text) {
    const clean = String(text || '').trim().toLowerCase();
    if (!clean || !Array.isArray(nodes)) return null;
    for (const n of nodes) {
      const txt = String(n.text || '').trim().toLowerCase();
      const desc = String(n.desc || '').trim().toLowerCase();
      if (txt === clean || desc === clean || txt.includes(clean) || desc.includes(clean)) {
        const c = parseBoundsCenter(n);
        if (c) return c;
      }
    }
    return null;
  }

  function scrollChatToBottom() {
    const vp = $('messages-viewport');
    if (vp) {
      requestAnimationFrame(() => {
        vp.scrollTop = vp.scrollHeight;
        if (typeof window.__refreshChatQuickNav === 'function') {
          window.__refreshChatQuickNav();
        }
      });
    }
  }

  function appendUserMessageRow(text, isInterject = false) {
    const container = $('messages-container');
    if (!container) return;
    document.querySelector('.chat-stage')?.classList.remove('ds-empty-mode');

    const row = document.createElement('div');
    row.className = `msg-row user pa-user-row ${isInterject ? 'pa-interject-row' : ''}`;

    const wrap = document.createElement('div');
    wrap.className = 'user-msg-wrap';

    const bodyEl = document.createElement('div');
    bodyEl.className = 'msg-body';
    bodyEl.textContent = isInterject ? `插话：${String(text || '')}` : String(text || '');

    wrap.appendChild(bodyEl);
    row.appendChild(wrap);
    paSessionNodes.push(row);
    container.appendChild(row);
    syncEmptyGuideVisibility();
    scrollChatToBottom();
  }

  function updateQueueBarUi() {
    const bar = $('pa-queue-bar');
    const txtEl = $('pa-queue-text');
    if (!bar || !txtEl) return;
    if (!isAgentRunning || queuedInterjections.length === 0) {
      bar.classList.add('hidden');
      txtEl.textContent = '';
      return;
    }
    const latest = queuedInterjections[queuedInterjections.length - 1];
    txtEl.textContent = queuedInterjections.length > 1
      ? `${latest.text}（共 ${queuedInterjections.length} 条待注入）`
      : latest.text;
    bar.classList.remove('hidden');
  }

  function createAgentCardRow(taskText, execMode) {
    const container = $('messages-container');
    if (!container) return null;

    const row = document.createElement('div');
    row.className = 'msg-row assistant pa-assistant-row';

    const avatarEl = document.createElement('div');
    avatarEl.className = 'msg-avatar';

    const bodyEl = document.createElement('div');
    bodyEl.className = 'msg-body';

    const card = document.createElement('div');
    card.className = 'pa-dsh-turn';
    card.innerHTML = `
      <div class="pa-trace-accordion is-running">
        <div class="pa-trace-summary" role="button" tabindex="0" aria-expanded="true">
          <div class="pa-trace-sum-left">
            <span class="pa-trace-pulse" aria-hidden="true"></span>
            <span class="pa-trace-sum-text">正在规划：${escapeHtml(taskText)}</span>
          </div>
          <div class="pa-trace-sum-right">
            <span class="pa-trace-meta">${escapeHtml(getEngineLabel(execMode))}</span>
            <button type="button" class="pa-banner-btn subtle pa-card-stop-btn" style="padding:3px 9px;font-size:11px;">停止</button>
            <span class="pa-trace-chevron" aria-hidden="true">▾</span>
          </div>
        </div>
        <div class="pa-trace-body">
          <div class="pa-steps-list pa-trace-list"></div>
          <div class="pa-confirm-slot"></div>
          <div class="pa-fix-slot"></div>
        </div>
      </div>
      <div class="pa-final-reply hidden"></div>
    `;

    const accordion = card.querySelector('.pa-trace-accordion');
    const summaryEl = card.querySelector('.pa-trace-summary');
    summaryEl?.addEventListener('click', (e) => {
      if (e.target.closest('.pa-card-stop-btn')) return;
      const collapsed = accordion.classList.toggle('is-collapsed');
      summaryEl.setAttribute('aria-expanded', String(!collapsed));
    });

    bodyEl.appendChild(card);
    row.appendChild(avatarEl);
    row.appendChild(bodyEl);
    paSessionNodes.push(row);
    container.appendChild(row);
    syncEmptyGuideVisibility();
    scrollChatToBottom();

    return {
      row,
      card,
      accordion,
      summaryEl,
      summaryTextEl: card.querySelector('.pa-trace-sum-text'),
      summaryMetaEl: card.querySelector('.pa-trace-meta'),
      stepsList: card.querySelector('.pa-steps-list'),
      confirmSlot: card.querySelector('.pa-confirm-slot'),
      fixSlot: card.querySelector('.pa-fix-slot'),
      stopBtn: card.querySelector('.pa-card-stop-btn'),
      finalReplyEl: card.querySelector('.pa-final-reply'),
      startedAt: Date.now(),
      stepCount: 0
    };
  }

  function addStepItem(stepsList, stepNum, summary, thought, statusText, isError = false, toolName = 'step') {
    if (!stepsList) return null;
    const item = document.createElement('div');
    item.className = 'pa-trace-step';
    item.innerHTML = `
      <div class="pa-trace-step-head">
        <div class="pa-trace-step-main">
          <span class="pa-tool-badge">${escapeHtml(toolName)}</span>
          <span class="pa-step-desc">${escapeHtml(summary)}</span>
        </div>
        <span class="pa-verdict-badge ${isError ? 'is-error' : 'is-same'}">${escapeHtml(statusText)}</span>
      </div>
      <div class="pa-trace-step-detail">
        ${thought ? `<div class="pa-step-thought">${escapeHtml(thought)}</div>` : '<div class="pa-step-thought"></div>'}
        <div class="pa-step-result ${isError ? 'is-error' : ''}">${escapeHtml(statusText)}</div>
      </div>
    `;
    item.addEventListener('click', () => {
      item.classList.toggle('is-detail-open');
    });
    stepsList.appendChild(item);
    scrollChatToBottom();
    return item;
  }

  function updateStepResult(stepEl, statusText, isError = false, verdictChanged = null) {
    if (!stepEl) return;
    const badgeEl = stepEl.querySelector('.pa-verdict-badge');
    if (badgeEl) {
      badgeEl.classList.remove('is-changed', 'is-same', 'is-error');
      if (isError) {
        badgeEl.classList.add('is-error');
        badgeEl.textContent = '失败';
      } else if (verdictChanged === true) {
        badgeEl.classList.add('is-changed');
        badgeEl.textContent = '画面已更新';
      } else if (verdictChanged === false) {
        badgeEl.classList.add('is-same');
        badgeEl.textContent = '画面未变';
      } else {
        badgeEl.classList.add('is-same');
        badgeEl.textContent = statusText.slice(0, 12);
      }
    }
    const resEl = stepEl.querySelector('.pa-step-result');
    if (resEl) {
      resEl.textContent = statusText;
      resEl.classList.toggle('is-error', Boolean(isError));
    }
    scrollChatToBottom();
  }

  function finalizeAgentTurn(cardCtx, { status = 'done', summaryTitle = '', replyText = '', handoverCb = null }) {
    if (!cardCtx) return;
    const elapsedSec = ((Date.now() - (cardCtx.startedAt || Date.now())) / 1000).toFixed(1);
    const acc = cardCtx.accordion;
    if (acc) {
      acc.classList.remove('is-running', 'is-done', 'is-error');
      acc.classList.add(status === 'error' ? 'is-error' : 'is-done');
      if (status === 'done' && cardCtx.stepCount > 0) {
        acc.classList.add('is-collapsed');
        cardCtx.summaryEl?.setAttribute('aria-expanded', 'false');
      }
    }
    if (cardCtx.summaryTextEl && summaryTitle) {
      cardCtx.summaryTextEl.textContent = summaryTitle;
    }
    if (cardCtx.summaryMetaEl) {
      cardCtx.summaryMetaEl.textContent = `${cardCtx.stepCount || 0} 步 · ${elapsedSec}s`;
    }
    if (cardCtx.stopBtn && !isNativeAutoSwiping()) {
      cardCtx.stopBtn.classList.add('hidden');
    }
    if (cardCtx.finalReplyEl && (replyText || typeof handoverCb === 'function')) {
      cardCtx.finalReplyEl.classList.remove('hidden');
      cardCtx.finalReplyEl.innerHTML = `
        <div>${escapeHtml(replyText)}</div>
        ${typeof handoverCb === 'function' ? `
          <div class="pa-handover-bar">
            <button type="button" class="pa-banner-btn pa-handover-resume-btn">我已完成，继续执行</button>
          </div>
        ` : ''}
      `;
      if (typeof handoverCb === 'function') {
        cardCtx.finalReplyEl.querySelector('.pa-handover-resume-btn')?.addEventListener('click', (e) => {
          e.currentTarget.disabled = true;
          e.currentTarget.textContent = '正在继续…';
          handoverCb();
        });
      }
    }
    scrollChatToBottom();
  }

  function renderA11yGuideCard(taskText) {
    pendingTaskAfterA11y = taskText;
    const cardCtx = createAgentCardRow(taskText, getExecMode());
    if (!cardCtx) return;
    if (cardCtx.accordion) cardCtx.accordion.classList.add('is-collapsed');
    if (cardCtx.summaryTextEl) cardCtx.summaryTextEl.textContent = '需要开启手机无障碍权限';
    if (cardCtx.stopBtn) cardCtx.stopBtn.classList.add('hidden');

    if (cardCtx.finalReplyEl) {
      cardCtx.finalReplyEl.classList.remove('hidden');
      cardCtx.finalReplyEl.innerHTML = `
        <div class="pa-a11y-guide-card" id="pa-inline-a11y-card">
          <div class="pa-a11y-guide-title">请先开启「DeepSeek · 星语」无障碍服务</div>
          <div class="pa-a11y-guide-desc">dsh-Go 需要无障碍权限来读取屏幕元素并替你点按滑动。开启后返回本页面，卡片会自动刷新状态。</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:2px;">
            <button type="button" class="pa-banner-btn pa-guide-open-a11y">前往系统开启无障碍</button>
            <button type="button" class="pa-banner-btn outline pa-guide-resume-task hidden">无障碍已就绪 · 继续执行任务</button>
          </div>
        </div>
      `;
      cardCtx.finalReplyEl.querySelector('.pa-guide-open-a11y')?.addEventListener('click', () => {
        const b = getBridge();
        if (b && typeof b.openAccessibilitySettings === 'function') {
          b.openAccessibilitySettings();
        }
      });
      cardCtx.finalReplyEl.querySelector('.pa-guide-resume-task')?.addEventListener('click', () => {
        const pending = pendingTaskAfterA11y || taskText;
        pendingTaskAfterA11y = '';
        executeTaskInChat(pending);
      });
    }
    scrollChatToBottom();
  }

  function formatActionCodeDesc(plan) {
    const tool = plan?.tool || plan?.action || 'done';
    const p = plan?.args || plan?.params || {};
    if (tool === 'phone_open' || tool === 'launch_app') return `phone.open("${p.appName || ''}")`;
    if (tool === 'phone_tap' || tool === 'click_node') return `phone.tap(ref="${p.ref || p.text || ''}")`;
    if (tool === 'phone_tap_xy' || tool === 'click') return `phone.tap_xy(${p.x || 0}, ${p.y || 0})`;
    if (tool === 'phone_double_tap') return `phone.double_tap(${p.x || 0}, ${p.y || 0})`;
    if (tool === 'phone_long_press' || tool === 'long_click') return `phone.long_press(${p.ref || `${p.x || 0},${p.y || 0}`})`;
    if (tool === 'phone_type' || tool === 'input') return `phone.type("${String(p.text || '').slice(0, 32)}")`;
    if (tool === 'phone_scroll') return `phone.scroll("${p.direction || 'down'}")`;
    if (tool === 'phone_swipe' || tool === 'swipe') return `phone.swipe(${p.x1},${p.y1} -> ${p.x2},${p.y2})`;
    if (tool === 'phone_key') return `phone.key("${p.key || ''}")`;
    if (tool === 'phone_wait' || tool === 'wait') return `phone.wait(${p.ms || 1000}ms)`;
    return `${tool}()`;
  }

  const HARD_SENSITIVE_RE = /(支付|付款|转账|收银台|密码|验证码|指纹|人脸|刷脸|免密|下单|提交订单|确认购买|发红包|银行卡|交易密码|删除|卸载|注销)/;

  function evaluateSafetyGate(plan, snapshot, roundAutoApproved) {
    const tool = plan?.tool || plan?.action || 'done';
    if (tool === 'phone_wait' || tool === 'wait' || tool === 'done' || tool === 'ask_user') {
      return { needConfirm: false, hardSensitive: false, riskLevel: 'read' };
    }
    const p = plan?.args || plan?.params || {};
    const combined = `${plan?.summary || ''} ${plan?.thought || ''} ${p?.text || ''} ${p?.appName || ''}`;
    const hardSensitive = Boolean(snapshot?.hasSensitiveField) || HARD_SENSITIVE_RE.test(combined);
    if (hardSensitive) {
      return { needConfirm: true, hardSensitive: true, riskLevel: 'sensitive' };
    }

    const policy = getConfirmPolicy();
    if (policy === 'auto_turn' || roundAutoApproved) {
      return { needConfirm: false, hardSensitive: false, riskLevel: plan?.risk || 'write' };
    }
    if (isAppTrusted(snapshot?.appName, snapshot?.packageName)) {
      return { needConfirm: false, hardSensitive: false, riskLevel: plan?.risk || 'write' };
    }
    if (policy === 'ask_every') {
      return { needConfirm: true, hardSensitive: false, riskLevel: plan?.risk || 'write' };
    }
    // sensitive_only 模式：仅拦截敏感写操作
    const isSensitiveWrite = plan?.risk === 'sensitive' || Boolean(plan?.needConfirm);
    return {
      needConfirm: isSensitiveWrite,
      hardSensitive: false,
      riskLevel: isSensitiveWrite ? 'sensitive' : 'write'
    };
  }

  let activeConfirmResolver = null;
  window.__onFloatConfirmDecision = (decision) => {
    if (activeConfirmResolver) {
      const fn = activeConfirmResolver;
      activeConfirmResolver = null;
      fn(decision || 'cancel');
    }
  };

  window.__onFloatNormalStop = () => {
    emergencyStopRequested = true;
    if (activeAbortController) {
      try {
        activeAbortController.abort();
      } catch {}
    }
    const b = getBridge();
    if (b && typeof b.dismissUserConfirmation === 'function') {
      try { b.dismissUserConfirmation(); } catch {}
    }
    showToast('已按悬浮窗指令停止当前任务');
  };

  window.__onFloatInterjectTask = (text) => {
    const clean = String(text || '').trim();
    if (!clean) return;
    if (isAgentRunning) {
      queuedInterjections.push({ text: clean, priority: true });
      updateQueueBarUi();
      appendUserMessageRow(clean, true);
      showToast(`已注入插话指令：${clean}`);
    } else {
      executeTaskInChat(clean);
    }
  };

  window.__onNativeResume = () => {
    syncStatus();
    if (pendingTaskAfterA11y && isNativeApk() && getBridge()?.isAccessibilityEnabled?.()) {
      const card = $('pa-inline-a11y-card');
      if (card) {
        card.classList.add('is-ready');
        const title = card.querySelector('.pa-a11y-guide-title');
        const desc = card.querySelector('.pa-a11y-guide-desc');
        const openBtn = card.querySelector('.pa-guide-open-a11y');
        const resumeBtn = card.querySelector('.pa-guide-resume-task');
        if (title) title.textContent = '无障碍服务已开启';
        if (desc) desc.textContent = '权限已就绪，点击下方按钮立即继续执行刚才的任务。';
        if (openBtn) openBtn.classList.add('hidden');
        if (resumeBtn) resumeBtn.classList.remove('hidden');
      }
    }
  };

  function askStepConfirmCard(confirmSlot, plan, signal, gateInfo = {}, snapshot = {}) {
    if (!confirmSlot) return Promise.resolve('allow');
    const b = getBridge();
    const hardSensitive = Boolean(gateInfo?.hardSensitive);
    const riskLevel = gateInfo?.riskLevel || 'write';
    const targetApp = snapshot?.appName || '';

    if (b && typeof b.requestSafetyConfirmation === 'function') {
      try {
        b.requestSafetyConfirmation(
          plan.summary || '执行下一步操作',
          formatActionCodeDesc(plan),
          riskLevel,
          targetApp,
          hardSensitive
        );
      } catch {}
    } else if (b && typeof b.requestUserConfirmation === 'function') {
      try {
        b.requestUserConfirmation(plan.summary || '执行下一步操作', formatActionCodeDesc(plan));
      } catch {}
    }

    return new Promise((resolve) => {
      const dismissNative = () => {
        if (b && typeof b.dismissUserConfirmation === 'function') {
          try { b.dismissUserConfirmation(); } catch {}
        }
      };

      const finish = (decision) => {
        dismissNative();
        activeConfirmResolver = null;
        if (confirmSlot) confirmSlot.innerHTML = '';
        resolve(decision);
      };

      activeConfirmResolver = (decision) => {
        finish(decision);
      };

      confirmSlot.innerHTML = `
        <div class="pa-confirm-card">
          <div class="pa-confirm-title">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
            </svg>
            <span>${hardSensitive ? '高危安全拦截（密码 / 支付 / 验证码）' : 'dsh-Go 安全确认'}</span>
          </div>
          <div class="pa-action-box">
            <div><strong>${escapeHtml(plan.summary || '执行下一步操作')}</strong></div>
            <div style="margin-top:4px;">动作指令：<code>${escapeHtml(formatActionCodeDesc(plan))}</code></div>
            ${snapshot?.sensitiveReason ? `<div style="margin-top:4px;color:#ef4444;font-size:11.5px;">提示：${escapeHtml(snapshot.sensitiveReason)}</div>` : ''}
          </div>
          <div class="pa-confirm-btns">
            <button type="button" class="pa-banner-btn" data-decision="allow">允许一次</button>
            ${hardSensitive
              ? `<button type="button" class="pa-banner-btn outline" data-decision="handover">我来手动操作</button>`
              : `
                <button type="button" class="pa-banner-btn outline" data-decision="auto_turn">本轮允许</button>
                ${targetApp ? `<button type="button" class="pa-banner-btn outline" data-decision="trust_app">信任 ${escapeHtml(targetApp)}</button>` : ''}
              `
            }
            <button type="button" class="pa-banner-btn subtle" data-decision="cancel">拒绝</button>
          </div>
        </div>
      `;
      scrollChatToBottom();

      const onAbort = () => {
        finish('cancel');
      };
      if (signal) {
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener('abort', onAbort, { once: true });
      }

      confirmSlot.querySelectorAll('button[data-decision]').forEach((btn) => {
        btn.addEventListener('click', () => {
          if (signal) signal.removeEventListener('abort', onAbort);
          const d = btn.dataset.decision || 'cancel';
          finish(d);
        });
      });
    });
  }

  function showInlineFixBox(fixSlot, planResp, { onRetryWithMode, onRetryStep }) {
    if (!fixSlot) return;
    const errCode = String(planResp?.code || '');
    const errMsg = String(planResp?.error || '当前规划请求异常');
    const isAuthIssue =
      errCode === 'NO_DIRECT_KEY' ||
      errCode === 'NO_API_KEY' ||
      /401|403|unauthorized|invalid.*key|authentication/i.test(errMsg);

    if (!isAuthIssue && typeof onRetryStep === 'function') {
      fixSlot.innerHTML = `
        <div class="pa-inline-fix-box">
          <div>${escapeHtml(errMsg)}（已保留前序步骤进度，可直接重试当前步）</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
            <button type="button" class="pa-banner-btn pa-fix-retry-step-btn">重试当前步骤</button>
            <button type="button" class="pa-banner-btn outline pa-fix-cloud-btn">改用云端 API</button>
            <button type="button" class="pa-banner-btn subtle pa-fix-local-btn">切换本地免 API</button>
          </div>
        </div>
      `;
      scrollChatToBottom();
      fixSlot.querySelector('.pa-fix-retry-step-btn')?.addEventListener('click', () => {
        fixSlot.innerHTML = '';
        onRetryStep();
      });
    } else {
      fixSlot.innerHTML = `
        <div class="pa-inline-fix-box">
          <div>${escapeHtml(errMsg)}</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
            <input type="password" class="pa-cfg-input pa-fix-key-inp" placeholder="输入手机辅助专属 DeepSeek API Key (sk-...)" style="flex:1 1 180px;height:32px;" />
            <button type="button" class="pa-banner-btn pa-fix-save-btn">保存直连并继续</button>
            <button type="button" class="pa-banner-btn outline pa-fix-cloud-btn">改用云端 API</button>
            <button type="button" class="pa-banner-btn subtle pa-fix-local-btn">切换本地免 API</button>
          </div>
        </div>
      `;
      scrollChatToBottom();
      fixSlot.querySelector('.pa-fix-save-btn')?.addEventListener('click', () => {
        const k = (fixSlot.querySelector('.pa-fix-key-inp')?.value || '').trim();
        if (!k) {
          showToast('请先填入有效的 sk- 密钥');
          return;
        }
        setDirectApiKey(k);
        setExecMode('api_direct');
        fixSlot.innerHTML = '';
        if (typeof onRetryWithMode === 'function') onRetryWithMode('api_direct');
      });
    }

    fixSlot.querySelector('.pa-fix-cloud-btn')?.addEventListener('click', () => {
      setExecMode('api_cloud');
      fixSlot.innerHTML = '';
      if (typeof onRetryWithMode === 'function') onRetryWithMode('api_cloud');
    });
    fixSlot.querySelector('.pa-fix-local-btn')?.addEventListener('click', () => {
      setExecMode('local');
      fixSlot.innerHTML = '';
      if (typeof onRetryWithMode === 'function') onRetryWithMode('local');
    });
  }

  function buildPlanningPromptMessages({ task, snapshot, history, screenSize, installedApps, screenVerdict, interjections, stepIndex }) {
    const sys = [
      '你是星语手机辅助代理（Phone Agent · dsh-Go 规划内核）。',
      `屏幕分辨率: ${screenSize.width}x${screenSize.height}。`,
      '你必须仅返回一个合法 JSON 对象（不要用 Markdown 代码块包裹，也不要附加前后任何解释文字），字段定义：',
      '{"thought":"精炼中文推理(<=50字)","tool":"工具名","args":{},"summary":"面向用户的中文操作简述(<=28字)","risk":"read|write|sensitive","reply":"仅在 done 或 ask_user 时填写自然语言回复"}',
      '可用 tool 与 args：',
      'phone_open:{"appName":"微信"} / phone_tap:{"ref":"e12","snapshotId":"snap_1"} / phone_tap_xy:{"x":540,"y":1200} / phone_double_tap:{"x":540,"y":1000} / phone_long_press:{"ref":"e12","duration":700} / phone_type:{"ref":"e8","text":"你好","clear":false,"submit":true} / phone_scroll:{"direction":"down|up|left|right","amount":0.65} / phone_swipe:{"x1":540,"y1":1600,"x2":540,"y2":600,"duration":320} / phone_key:{"key":"back|home|recents|notifications|quick_settings|enter|screenshot"} / phone_wait:{"ms":1000} / ask_user:{"message":"请手动输入密码或确认"} / done:{"message":"完成总结"}',
      '关键约束：',
      '1. 优先用 phone_open 打开应用；点击屏幕元素首选 phone_tap 并携带 ref 与 snapshotId。',
      '2. 若 screenVerdict 显示连续 2 步画面未变化，禁止重复同一动作或 phone_wait，改用 phone_tap_xy / phone_scroll / phone_key(back) 或 ask_user。',
      '3. 若 interjections 非空，最高优先级立即响应用户中途插话指令。',
      '4. 若 hasSensitiveField=true 或涉及付款/转账/下单/密码/验证码/删除/卸载/发消息，risk 必须为 "sensitive"，支付密码/验证码直接 ask_user 交还人工。'
    ].join('\n');

    const usr = JSON.stringify({
      task,
      stepIndex: stepIndex || (history || []).length + 1,
      snapshotId: snapshot?.snapshotId || '',
      foregroundApp: snapshot?.appName || '',
      packageName: snapshot?.packageName || '',
      hasSensitiveField: Boolean(snapshot?.hasSensitiveField),
      sensitiveReason: snapshot?.sensitiveReason || '',
      screenVerdict: screenVerdict || null,
      interjections: interjections || [],
      recentHistory: (history || []).slice(-8),
      installedApps: (installedApps || []).slice(0, 40).map((a) => (typeof a === 'string' ? a : a.name)),
      screenTreeText: snapshot?.screenTreeText || ''
    });

    return [
      { role: 'system', content: sys },
      { role: 'user', content: usr }
    ];
  }

  function normalizeClientPlan(obj) {
    const toolToLegacy = {
      phone_open: 'launch_app',
      phone_tap: 'click_node',
      phone_tap_xy: 'click',
      phone_double_tap: 'double_tap',
      phone_long_press: 'long_click',
      phone_type: 'input',
      phone_scroll: 'scroll',
      phone_swipe: 'swipe',
      phone_key: 'key',
      phone_wait: 'wait',
      done: 'done',
      ask_user: 'ask_user'
    };
    const legacyToTool = {
      launch_app: 'phone_open',
      click_node: 'phone_tap',
      click: 'phone_tap_xy',
      long_click: 'phone_long_press',
      swipe: 'phone_swipe',
      input: 'phone_type',
      home: 'phone_key',
      back: 'phone_key',
      recents: 'phone_key',
      wait: 'phone_wait',
      done: 'done',
      ask_user: 'ask_user'
    };
    const rawTool = String(obj?.tool || '').trim();
    const rawAction = String(obj?.action || '').trim();
    const tool = rawTool && toolToLegacy[rawTool] ? rawTool : (legacyToTool[rawAction] || 'done');
    const args = (obj?.args && typeof obj.args === 'object')
      ? { ...obj.args }
      : ((obj?.params && typeof obj.params === 'object') ? { ...obj.params } : {});
    if (!rawTool && (rawAction === 'home' || rawAction === 'back' || rawAction === 'recents')) {
      args.key = rawAction;
    }
    const riskRaw = String(obj?.risk || '').trim().toLowerCase();
    const risk = riskRaw === 'read' || riskRaw === 'write' || riskRaw === 'sensitive'
      ? riskRaw
      : (obj?.needConfirm ? 'sensitive' : (tool === 'done' || tool === 'ask_user' || tool === 'phone_wait' ? 'read' : 'write'));
    const reply = String(obj?.reply || args?.message || obj?.summary || '').trim();
    if ((tool === 'done' || tool === 'ask_user') && reply && !args.message) {
      args.message = reply;
    }
    return {
      thought: String(obj?.thought || '').trim(),
      tool,
      args,
      risk,
      reply,
      action: toolToLegacy[tool] || 'done',
      params: args,
      summary: String(obj?.summary || `执行 ${tool}`).trim(),
      needConfirm: risk === 'sensitive' || Boolean(obj?.needConfirm)
    };
  }

  function extractJsonFromText(raw) {
    const cleaned = String(raw || '')
      .replace(/<think>[\s\S]*?<\/think>/gi, '')
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    const tryParseClean = (txt) => {
      try {
        return JSON.parse(txt);
      } catch {
        const noTrailingComma = txt.replace(/,\s*([}\]])/g, '$1');
        return JSON.parse(noTrailingComma);
      }
    };

    if (cleaned) {
      try {
        const directObj = tryParseClean(cleaned);
        if (directObj && typeof directObj === 'object' && !Array.isArray(directObj)) {
          return normalizeClientPlan(directObj);
        }
      } catch {}

      for (let i = 0; i < cleaned.length; i++) {
        if (cleaned[i] !== '{') continue;
        let depth = 0;
        let inStr = false;
        let esc = false;
        for (let j = i; j < cleaned.length; j++) {
          const ch = cleaned[j];
          if (inStr) {
            if (esc) esc = false;
            else if (ch === '\\') esc = true;
            else if (ch === '"') inStr = false;
            continue;
          }
          if (ch === '"') inStr = true;
          else if (ch === '{') depth += 1;
          else if (ch === '}') {
            depth -= 1;
            if (depth === 0) {
              const candidate = cleaned.slice(i, j + 1);
              try {
                const parsed = tryParseClean(candidate);
                if (parsed && typeof parsed === 'object' && (parsed.tool || parsed.action)) {
                  return normalizeClientPlan(parsed);
                }
              } catch {}
              break;
            }
          }
        }
      }
    }

    const err = new Error('模型响应未返回合法 JSON 动作指令');
    err.code = 'JSON_PARSE_ERROR';
    throw err;
  }

  async function requestPlanStep({ execMode, task, snapshot, history, screenSize, installedApps, screenVerdict, interjections, stepIndex, signal }) {
    const cfg = getDirectConfig();
    const screenNodes = snapshot?.nodes || [];
    if (execMode === 'api_direct') {
      if (!cfg.apiKey) {
        return { ok: false, code: 'NO_DIRECT_KEY', error: '手机辅助 DeepSeek API 密钥尚未配置，请填入密钥或切换至云端 API。' };
      }
      const targetUrl = cfg.baseUrl || 'https://api.deepseek.com/v1/chat/completions';
      const targetModel = cfg.model || 'deepseek-chat';
      const baseMessages = buildPlanningPromptMessages({
        task,
        snapshot,
        history,
        screenSize,
        installedApps,
        screenVerdict,
        interjections,
        stepIndex
      });

      const attemptDirectCall = async (modelToUse, extraHint = '') => {
        const msgs = extraHint ? [...baseMessages, { role: 'user', content: extraHint }] : baseMessages;
        const isReasoner = /reasoner|r1/i.test(String(modelToUse || ''));
        const directBody = {
          model: modelToUse,
          messages: msgs,
          temperature: isReasoner ? 0.2 : 0.15,
          max_tokens: isReasoner ? 2048 : 1024,
          stream: false
        };
        if (!isReasoner && (targetUrl.includes('deepseek.com') || /deepseek/i.test(modelToUse))) {
          directBody.response_format = { type: 'json_object' };
        }
        const directRes = await fetch(targetUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${cfg.apiKey}`
          },
          body: JSON.stringify(directBody),
          signal
        });
        if (!directRes.ok) {
          const txt = await directRes.text().catch(() => '');
          const httpErr = new Error(`直连 DeepSeek 返回 (${directRes.status}): ${txt.slice(0, 120)}`);
          httpErr.code = directRes.status === 401 || directRes.status === 403 ? 'DIRECT_AUTH_ERROR' : 'DIRECT_HTTP_ERROR';
          httpErr.status = directRes.status;
          throw httpErr;
        }
        const json = await directRes.json();
        const msgObj = json?.choices?.[0]?.message || {};
        const content = String(msgObj.content || '').trim();
        try {
          return { plan: extractJsonFromText(content), model: modelToUse };
        } catch (parseErr) {
          const reasoning = String(msgObj.reasoning_content || '').trim();
          if (reasoning) {
            return { plan: extractJsonFromText(reasoning), model: modelToUse };
          }
          throw parseErr;
        }
      };

      try {
        let result;
        try {
          result = await attemptDirectCall(targetModel);
        } catch (firstErr) {
          if (firstErr?.name === 'AbortError' || firstErr?.code === 'DIRECT_AUTH_ERROR') {
            throw firstErr;
          }
          if (firstErr?.code === 'JSON_PARSE_ERROR' || /JSON/i.test(String(firstErr?.message || ''))) {
            const retryModel = /reasoner|r1/i.test(targetModel) ? 'deepseek-chat' : targetModel;
            result = await attemptDirectCall(
              retryModel,
              '刚才未返回合法 JSON 动作指令。请严格只输出一个合法 JSON 对象（不要任何 Markdown 或解释文字）。'
            );
          } else {
            throw firstErr;
          }
        }
        return { ok: true, plan: result.plan, model: result.model, engine: 'api_direct' };
      } catch (directErr) {
        if (directErr?.name === 'AbortError') throw directErr;
        if (directErr?.code === 'DIRECT_AUTH_ERROR') {
          return { ok: false, code: 'DIRECT_AUTH_ERROR', error: directErr.message };
        }
        const proxyRes = await apiPostJson(
          '/api/phone-agent/plan',
          {
            task,
            stepIndex,
            snapshotId: snapshot?.snapshotId || '',
            foregroundApp: snapshot?.appName || '',
            packageName: snapshot?.packageName || '',
            hasSensitiveField: Boolean(snapshot?.hasSensitiveField),
            sensitiveReason: snapshot?.sensitiveReason || '',
            screenTreeText: snapshot?.screenTreeText || '',
            screenNodes,
            screenVerdict,
            interjections,
            history,
            screenSize,
            installedApps: (installedApps || []).map((a) => (typeof a === 'string' ? a : a.name)),
            customApiKey: cfg.apiKey,
            customModel: targetModel,
            customBaseUrl: cfg.baseUrl
          },
          signal
        );
        if (proxyRes.ok && proxyRes.data?.plan) {
          return { ok: true, plan: proxyRes.data.plan, model: proxyRes.data.model, engine: 'api_direct_proxy' };
        }
        return {
          ok: false,
          code: proxyRes.data?.code || directErr?.code || 'PROXY_FAILED',
          error: proxyRes.data?.error || directErr?.message || 'DeepSeek API 请求失败'
        };
      }
    }

    const cloudRes = await apiPostJson(
      '/api/phone-agent/plan',
      {
        task,
        stepIndex,
        snapshotId: snapshot?.snapshotId || '',
        foregroundApp: snapshot?.appName || '',
        packageName: snapshot?.packageName || '',
        hasSensitiveField: Boolean(snapshot?.hasSensitiveField),
        sensitiveReason: snapshot?.sensitiveReason || '',
        screenTreeText: snapshot?.screenTreeText || '',
        screenNodes,
        screenVerdict,
        interjections,
        history,
        screenSize,
        installedApps: (installedApps || []).map((a) => (typeof a === 'string' ? a : a.name)),
        customModel: cfg.model || ''
      },
      signal
    );
    if (cloudRes.ok && cloudRes.data?.plan) {
      return { ok: true, plan: cloudRes.data.plan, model: cloudRes.data.model, engine: cloudRes.data.engine || 'api_cloud' };
    }
    return {
      ok: false,
      code: cloudRes.data?.code || 'CLOUD_ERROR',
      error: cloudRes.data?.error || '云端规划接口暂不可用'
    };
  }

  function dispatchNativePlanAction(plan, snapshot) {
    const b = getBridge();
    const tool = plan?.tool || plan?.action || 'done';
    const p = plan?.args || plan?.params || {};
    const latestNodes = snapshot?.nodes || [];
    const snapshotId = p.snapshotId || snapshot?.snapshotId || '';

    if (!isNativeApk() || !b) {
      return { executed: false, simulated: true, text: '网页预览模式已推演该动作（安装随身版 APK 后可在真机自动执行）' };
    }

    const a11yOk = Boolean(b.isAccessibilityEnabled && b.isAccessibilityEnabled());
    if (!a11yOk && tool !== 'phone_open' && tool !== 'launch_app' && tool !== 'phone_wait' && tool !== 'wait' && tool !== 'done' && tool !== 'ask_user') {
      return { executed: false, error: true, text: '系统无障碍权限尚未开启，请先前往开启无障碍服务' };
    }

    try {
      if (tool === 'phone_open' || tool === 'launch_app') {
        const appName = String(p.appName || '').trim();
        if (typeof b.launchAppByName === 'function') {
          const ok = b.launchAppByName(appName);
          return ok
            ? { executed: true, text: `已打开应用「${appName}」` }
            : { executed: false, error: true, text: `未能匹配或拉起应用「${appName}」` };
        }
        const msg = String(b.executeLocalRule(`打开 ${appName}`) || '');
        const okFallback = isLocalRuleSucceeded(msg);
        return { executed: okFallback, error: !okFallback, text: msg || `尝试打开「${appName}」` };
      }

      if (tool === 'phone_tap' || tool === 'click_node') {
        const refId = String(p.ref || '').trim();
        if (refId && typeof b.clickByRef === 'function') {
          const resObj = JSON.parse(b.clickByRef(snapshotId, refId) || '{}');
          return {
            executed: Boolean(resObj.ok),
            error: !resObj.ok,
            text: resObj.message || (resObj.ok ? `已点击控件 ${refId}` : `点击控件 ${refId} 失败`)
          };
        }
        const targetText = String(p.text || '').trim();
        let ok = false;
        if (targetText && typeof b.clickByText === 'function') {
          ok = b.clickByText(targetText);
        }
        if (!ok && targetText && Array.isArray(latestNodes)) {
          const c = findNodeCenterByText(latestNodes, targetText);
          if (c && typeof b.dispatchClick === 'function') {
            ok = b.dispatchClick(c.cx, c.cy);
          }
        }
        return ok
          ? { executed: true, text: `已点击控件「${targetText}」` }
          : { executed: false, error: true, text: `当前界面未找到控件「${targetText || refId}」` };
      }

      if (tool === 'phone_tap_xy' || tool === 'click') {
        const x = Number(p.x) || 540;
        const y = Number(p.y) || 1200;
        const ok = b.dispatchClick(x, y);
        return { executed: Boolean(ok), error: !ok, text: ok ? `已点击坐标 (${x}, ${y})` : '坐标点击派发失败' };
      }

      if (tool === 'phone_double_tap') {
        const x = Number(p.x) || 540;
        const y = Number(p.y) || 1000;
        const ok = typeof b.doubleTapAt === 'function' ? b.doubleTapAt(x, y) : b.dispatchClick(x, y);
        return { executed: Boolean(ok), error: !ok, text: ok ? `已双击坐标 (${x}, ${y})` : '双击派发失败' };
      }

      if (tool === 'phone_long_press' || tool === 'long_click') {
        const refId = String(p.ref || '').trim();
        const dur = Number(p.duration) || 700;
        if (refId && typeof b.longClickByRef === 'function') {
          const resObj = JSON.parse(b.longClickByRef(snapshotId, refId, dur) || '{}');
          return { executed: Boolean(resObj.ok), error: !resObj.ok, text: resObj.message || `已长按 ${refId}` };
        }
        const x = Number(p.x) || 540;
        const y = Number(p.y) || 1200;
        const ok = typeof b.dispatchLongClick === 'function' ? b.dispatchLongClick(x, y, dur) : b.dispatchClick(x, y);
        return { executed: Boolean(ok), error: !ok, text: ok ? `已长按坐标 (${x}, ${y})` : '长按派发失败' };
      }

      if (tool === 'phone_type' || tool === 'input') {
        const txt = String(p.text || '');
        const refId = String(p.ref || '').trim();
        const clearFirst = p.clear !== undefined ? Boolean(p.clear) : !Boolean(p.append);
        const shouldAutoSubmit = Boolean(p.submit || p.autoSubmit);
        if (typeof b.inputByRef === 'function') {
          const resObj = JSON.parse(b.inputByRef(snapshotId, refId, txt, clearFirst, shouldAutoSubmit) || '{}');
          return {
            executed: Boolean(resObj.ok),
            error: !resObj.ok,
            text: resObj.message || (resObj.ok ? `已输入文本「${txt}」` : '未能定位输入框')
          };
        }
        const ok = typeof b.dispatchSmartInput === 'function'
          ? b.dispatchSmartInput(txt, !clearFirst, shouldAutoSubmit)
          : b.dispatchInputText(String(p.viewId || ''), txt);
        return {
          executed: Boolean(ok),
          error: !ok,
          text: ok ? `已向输入框填入「${txt}」` : '未能定位到可编辑输入框'
        };
      }

      if (tool === 'phone_scroll' || tool === 'scroll') {
        const dir = String(p.direction || 'down');
        const ratio = Number(p.amount) || 0.65;
        const ok = typeof b.scrollScreen === 'function'
          ? b.scrollScreen(dir, ratio)
          : b.dispatchSwipe(540, 1600, 540, 650, 340);
        return { executed: Boolean(ok), error: !ok, text: ok ? `已向 ${dir} 滚动页面` : '滚动派发失败' };
      }

      if (tool === 'phone_swipe' || tool === 'swipe') {
        const x1 = Number(p.x1) || 540;
        const y1 = Number(p.y1) || 1650;
        const x2 = Number(p.x2) || 540;
        const y2 = Number(p.y2) || 650;
        const dur = Number(p.duration) || 340;
        const ok = b.dispatchSwipe(x1, y1, x2, y2, dur);
        return { executed: Boolean(ok), error: !ok, text: ok ? `已执行滑动 (${x1},${y1} -> ${x2},${y2})` : '滑动派发失败' };
      }

      if (tool === 'phone_key' || tool === 'home' || tool === 'back' || tool === 'recents' || tool === 'key') {
        const key = String(p.key || tool || 'back').toLowerCase();
        const ok = b.dispatchGlobalAction(key);
        return { executed: Boolean(ok), error: !ok, text: ok ? `已执行系统键 (${key})` : `系统键 ${key} 执行失败` };
      }

      if (tool === 'phone_wait' || tool === 'wait') {
        return { executed: true, text: `等待 ${Number(p.ms) || 1000}ms 界面刷新` };
      }
    } catch (e) {
      return { executed: false, error: true, text: `原生执行异常: ${e?.message || e}` };
    }
    return { executed: true, text: '完成步骤' };
  }

  function isLocalRuleSucceeded(resultText) {
    const t = String(resultText || '').trim();
    if (!t) return false;
    if (
      t.startsWith('UNMATCHED:') ||
      t.includes('未匹配') ||
      t.includes('未就绪') ||
      t.includes('未找到') ||
      t.includes('未开启') ||
      t.includes('失败') ||
      t.startsWith('请输入')
    ) {
      return false;
    }
    return true;
  }

  const COMPOUND_TASK_SPLIT_RE = /(?:然后|接着|之后|并且|[;；])+/;
  const COMPLEX_INTENT_HINT_RE = /(?:然后|接着|之后|并且|[;；]|帮我|查一下|查找|找一下|问一下|询问|发给|发送给|回复给|点外卖|下订单|看看|对比|挑选|总结)/;
  const PURE_TARGET_APP_RE = /^(?:打开|启动|进入|运行)\s*([^\s，。！？,!?]{1,12})$/i;

  function splitCompoundTaskSteps(text) {
    return String(text || '')
      .trim()
      .split(COMPOUND_TASK_SPLIT_RE)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function isPureTargetAppName(appName) {
    const clean = String(appName || '').trim();
    if (!clean || clean.length > 12) return false;
    if (/[\s，。！？,!?]/.test(clean)) return false;
    return !COMPLEX_INTENT_HINT_RE.test(clean);
  }

  // 严格校验单步纯本地原子口令（排除任何夹带复合语义的句子，避免截断大模型规划）
  function isAtomicBuiltInLocalCmd(text) {
    const clean = String(text || '').trim();
    if (!clean || COMPOUND_TASK_SPLIT_RE.test(clean)) return false;

    if (/^(回桌面|桌面|主页|home|返回|后退|上一页|back|最近任务|多任务|后台|切回上个应用|上个应用|切上个app|切换应用|下拉通知|通知栏|通知|控制中心|快捷设置|快捷开关|截屏|截图|屏幕截图|锁屏|息屏|电源菜单|音量\+|音量-|音量加|音量减|调大音量|调小音量|增大音量|降低音量|静音|取消静音|切换静音|下一首|下一首歌|切歌|换首歌|换一首歌|上一首|上一首歌|暂停音乐|停一下音乐|播放音乐|继续播放|继续放歌|读屏幕|读取屏幕|查看屏幕|点中间|点击中间|唱歌|唱首歌|唱一首|唱一首歌|给我唱歌|喂米饭|吃米饭|摸摸头|跳个舞|讲热梗|开启防误触|打开防误触|关闭防误触|解锁防误触|关闭语音尾巴|隐藏语音尾巴|开启语音尾巴|打开语音尾巴|关闭桌面歌词|关闭透明歌词|打开桌面歌词|开启桌面歌词|开启透明歌词)$/i.test(clean)) {
      return true;
    }
    if (/^(?:用qq音乐|在qq音乐|qq音乐)?\s*(?:播放|放一首|放首|点播|我想听|来一首|唱一首|听一下|听一首)\s*.+$/i.test(clean) && !/视频/.test(clean)) {
      const kw = clean.replace(/^(?:用qq音乐|在qq音乐|qq音乐)?\s*(?:播放|放一首|放首|点播|我想听|来一首|唱一首|听一下|听一首)(?:音乐|歌曲|歌)?\s*(?:的)?\s*/i, '').trim();
      if (kw && kw !== '歌' && kw !== '一首歌' && kw !== '首歌' && kw !== '音乐') return true;
    }
    if (!COMPLEX_INTENT_HINT_RE.test(clean) && /^(自动刷|连续刷|连刷|开始刷|定时刷|挂机刷|帮我刷|刷视频|刷抖音|刷快手|刷小红书|刷b站|刷哔哩哔哩|停止刷|别刷|停刷|停止连刷|停止自动|下一个视频|刷下一个|换一个|下一个|下个视频|上一个视频|回看上一个|上一个|上个视频|双击点赞|点赞|点红心|点个赞|喜欢|暂停视频|播放视频|暂停播放|暂停\/播|看评论|打开评论|评论区|点收藏|收藏视频|收藏|点关注|关注作者|分享视频|转发视频|转发)/i.test(clean)) {
      return true;
    }
    if (!COMPLEX_INTENT_HINT_RE.test(clean) && /.*刷\s*\d+\s*(?:个|条).*视频.*/i.test(clean)) {
      return true;
    }
    if (/^(清空输入框|清空输入|清空文字|清除输入|删掉输入|粘贴|粘贴剪贴板|粘贴文字)$/i.test(clean)) {
      return true;
    }
    if (/^(打字并发送|输入并发送|追加输入|接着打字|接着输入|追加|帮我打字|打字|输入|填入|写字|搜索|搜一下|查一下|查找)\s+\S+/i.test(clean) ||
        /^(打字并发送|输入并发送|追加输入|接着打字|接着输入|帮我打字|打字|输入|填入|写字|搜索|搜一下)\S+$/i.test(clean)) {
      if (/^(?:搜索|搜一下|查一下|查找)/.test(clean) && /(?:帮我|发给|回复|看看|挑选|对比)/.test(clean)) {
        return false;
      }
      return true;
    }
    if (/^(发送消息|发消息|回复|评论)\s+\S+/i.test(clean) && !/^(?:发送消息|发消息|回复)\s*(?:给|到|询问)/.test(clean)) {
      return true;
    }
    if (/^(回到顶部|滚到顶部|回顶部|最上面|滑到底部|滚到底部|最下面|(?:连续)?(?:下滑|向下|下翻|上滑|向上|上翻|左滑|向左|右滑|向右)(?:\s*\d+\s*次)?)$/i.test(clean)) {
      return true;
    }
    const appMatch = clean.match(PURE_TARGET_APP_RE);
    if (appMatch && isPureTargetAppName(appMatch[1])) {
      return true;
    }
    if (/^(点击|点一下|按下|点|长按|双击)\s*([^\s，。！？,!?]{1,10})$/i.test(clean) && !COMPLEX_INTENT_HINT_RE.test(clean)) {
      return true;
    }
    return false;
  }

  // 判断是否为可直接命中本地离线指令库的口令（多步任务仅当每一步均严格为原子口令时才整句走本地）
  function isSimpleBuiltInLocalCmd(text) {
    const clean = String(text || '').trim();
    if (!clean) return false;
    const steps = splitCompoundTaskSteps(clean);
    if (steps.length >= 2) {
      return steps.every((step) => isAtomicBuiltInLocalCmd(step));
    }
    return isAtomicBuiltInLocalCmd(clean);
  }

  // 网页预览环境下的本地离线规则解析器（在非 APK 浏览器里也能直观验证离线指令库）
  function simulateWebLocalPreview(cmdText) {
    const clean = String(cmdText || '').trim();
    const lower = clean.toLowerCase();
    if (/(?:然后|接着|[;；])/.test(clean)) {
      const steps = clean.split(/(?:然后|接着|[;；])+/).map((s) => s.trim()).filter(Boolean);
      return `已解析为 ${steps.length} 步离线组合宏：${steps.join(' → ')}（安装随身版 APK 后可在真机免 API 自动连续执行）`;
    }
    if (lower.includes('停止刷') || lower.includes('别刷') || lower.includes('停止连刷')) {
      return '离线引擎预览：立即终止后台自动连刷视频定时器并恢复待命';
    }
    if (lower.includes('刷') && (lower.includes('视频') || lower.includes('抖音') || lower.includes('快手') || lower.includes('小红书') || lower.includes('b站'))) {
      const cnt = (clean.match(/(\d+)\s*(?:个|条)/) || [])[1] || '20';
      const sec = (clean.match(/(?:每|间隔)\s*(\d+)\s*秒/) || [])[1] || '8';
      const like = lower.includes('赞') ? ' + 随机双击点赞' : '';
      return `离线连刷引擎预览：自动循环上滑刷 ${cnt} 条短视频（间隔 ${sec} 秒${like}，悬浮球实时显示进度并支持轻触急停）`;
    }
    if (/^(打字并发送|输入并发送|发消息|回复|评论)/.test(clean)) {
      const body = clean.replace(/^(打字并发送|输入并发送|发消息|回复|评论)\s*/, '');
      return `离线智能打字预览：自动定位底层应用输入框 → 填入「${body}」→ 自动点击「发送/发布」按钮`;
    }
    if (/^(追加输入|接着打字|追加)/.test(clean)) {
      const body = clean.replace(/^(追加输入|接着打字|追加)\s*/, '');
      return `离线追加打字预览：保留原输入框已有文字，在末尾追加「${body}」`;
    }
    if (/^(帮我打字|打字|输入|填入|写字)/.test(clean)) {
      const body = clean.replace(/^(帮我打字|打字|输入|填入|写字)\s*/, '');
      return `离线智能打字预览：自动聚焦当前屏幕可见 EditText 输入框并填入「${body}」（支持剪贴板粘贴兜底）`;
    }
    if (/^(搜索|搜一下|查一下|查找)/.test(clean)) {
      const kw = clean.replace(/^(搜索|搜一下|查一下|查找)\s*/, '');
      return `离线搜索预览：自动点击屏幕搜索栏 → 填入关键词「${kw}」并触发搜索`;
    }
    return `已命中本地离线指令「${clean}」（在安卓随身版 APK 中无需配置 API Key 即可毫秒级直控手机）`;
  }

  function tryExecuteLocalQuickCommand(cmdText) {
    const clean = String(cmdText || '').trim();
    if (!isNativeApk()) {
      return { handled: false, reason: 'not_native' };
    }
    const b = getBridge();
    if (!b) return { handled: false, reason: 'no_bridge' };

    // 0. 鲸鱼娘桌面宠物互动（干饭/摸头/跳舞/唱歌/热梗/防误触/语音尾巴/桌面歌词）优先联动悬浮窗原声与动作
    if (/^(?:喂米饭|吃米饭|喂食|干饭|摸摸头|摸头|跳个舞|跳舞|唱歌|唱首歌|唱一首|唱一首歌|给我唱歌|停唱|别唱了|讲热梗|开启防误触|打开防误触|关闭防误触|解锁防误触|关闭语音尾巴|隐藏语音尾巴|开启语音尾巴|打开语音尾巴|关闭桌面歌词|关闭透明歌词|打开桌面歌词|开启桌面歌词|开启透明歌词)$/i.test(clean) || (clean.includes('米饭') && clean.length <= 10)) {
      if (typeof b.startFloatAgent === 'function' && typeof b.isFloatAgentRunning === 'function' && !b.isFloatAgentRunning()) {
        try { b.startFloatAgent(); } catch {}
      }
      if (typeof b.triggerWhaleAction === 'function') {
        setTimeout(() => { try { b.triggerWhaleAction(clean); } catch {} }, 180);
        return { handled: true, summary: `鲸鱼娘已响应「${clean}」，正在切换姿态并播放原声~` };
      }
    }

    // 1. 先交由原生丰富离线规则引擎处理（支持 QQ 音乐点播/切歌、组合宏、刷视频、智能打字、搜索、音量、截屏等）
    if (typeof b.executeLocalRule === 'function') {
      const msg = String(b.executeLocalRule(clean) || '');
      if (isLocalRuleSucceeded(msg)) {
        setTimeout(syncStatus, 250);
        return { handled: true, summary: msg.replace(/^UNMATCHED:/, '') };
      }
    }

    // 2. 兜底匹配动态打开应用（仅纯目标应用名，避免吞掉复合任务）
    const openMatch = clean.match(PURE_TARGET_APP_RE);
    if (openMatch && isPureTargetAppName(openMatch[1]) && typeof b.launchAppByName === 'function') {
      const appName = openMatch[1].trim();
      const ok = b.launchAppByName(appName);
      if (ok) return { handled: true, summary: `已为您直接拉起「${appName}」` };
    }

    // 3. 兜底识别「点击 XXX」
    const clickMatch = clean.match(/^(?:点击|点一下|按)\s*([^\s，。！？,!?]{1,10})$/);
    if (clickMatch && !COMPLEX_INTENT_HINT_RE.test(clickMatch[1]) && typeof b.clickByText === 'function') {
      const target = clickMatch[1].trim();
      const ok = b.clickByText(target);
      if (ok) return { handled: true, summary: `已点击屏幕上「${target}」` };
    }
    return { handled: false, reason: 'unmatched' };
  }

  async function runReActLoop(taskText, cardCtx, overrideMode = null, resumeOpts = null) {
    const execMode = overrideMode || getExecMode();
    const b = getBridge();
    const native = isNativeApk();
    const isResuming = Boolean(resumeOpts && Array.isArray(resumeOpts.history));

    if (activeAbortController) {
      try {
        activeAbortController.abort();
      } catch {}
    }
    activeAbortController = new AbortController();
    const signal = activeAbortController.signal;
    emergencyStopRequested = false;
    isAgentRunning = true;
    updateQueueBarUi();

    if (native && b && typeof b.resetEmergencyStop === 'function') {
      try { b.resetEmergencyStop(); } catch {}
    }
    if (native && b) {
      try {
        if (typeof b.hasOverlayPermission === 'function' && b.hasOverlayPermission()
            && typeof b.isFloatAgentRunning === 'function' && !b.isFloatAgentRunning()
            && typeof b.startFloatAgent === 'function') {
          b.startFloatAgent();
        }
        if (typeof b.setEdgeGlowEnabled === 'function') {
          b.setEdgeGlowEnabled(isEdgeGlowEnabled());
        }
        if (typeof b.setAgentForegroundActive === 'function') {
          b.setAgentForegroundActive(true, taskText.slice(0, 32));
        }
      } catch {}
    }

    if (cardCtx.stopBtn) {
      cardCtx.stopBtn.disabled = false;
      cardCtx.stopBtn.textContent = '停止';
      cardCtx.stopBtn.onclick = () => {
        emergencyStopRequested = true;
        try { activeAbortController.abort(); } catch {}
        if (native && b && typeof b.stopAutoSwipeVideos === 'function') {
          try { b.stopAutoSwipeVideos(); } catch {}
        }
        if (cardCtx.stopBtn) {
          cardCtx.stopBtn.disabled = true;
          cardCtx.stopBtn.textContent = '已停止';
        }
        if (native && b && typeof b.updateFloatState === 'function') {
          try { b.updateFloatState('idle', 'dsh-Go'); } catch {}
        }
        syncStatus();
      };
    }

    let finalStatus = 'done';
    let finalSummaryTitle = '';
    let finalReplyText = '';
    let handoverCb = null;

    try {
      // 分支 A：本地免 API 模式
      const matchedOffline = isSimpleBuiltInLocalCmd(taskText);
      const shouldTryFullLocal = !isResuming && execMode === 'local';
      if (shouldTryFullLocal) {
        if (!native) {
          cardCtx.stepCount = 1;
          if (matchedOffline) {
            const sim = simulateWebLocalPreview(taskText);
            addStepItem(cardCtx.stepsList, 1, taskText, '网页预览模拟执行', '模拟完成', false, 'local.rule');
            finalSummaryTitle = `已完成本地口令演练 · ${taskText}`;
            finalReplyText = sim;
          } else {
            addStepItem(cardCtx.stepsList, 1, '超出固定离线口令范围', '建议切换至 DeepSeek API / 云端 API 进行多步识屏规划。', '未匹配', true, 'local.rule');
            showInlineFixBox(cardCtx.fixSlot, { error: '复杂多步任务需要大模型识屏规划，可切换至 API 引擎继续：' }, {
              onRetryWithMode: (nextMode) => runReActLoop(taskText, cardCtx, nextMode)
            });
            finalStatus = 'error';
            finalSummaryTitle = '需要切换 API 智能识屏模式';
          }
          finalizeAgentTurn(cardCtx, { status: finalStatus, summaryTitle: finalSummaryTitle, replyText: finalReplyText });
          return;
        }

        const res = tryExecuteLocalQuickCommand(taskText);
        if (res.handled) {
          cardCtx.stepCount = 1;
          addStepItem(cardCtx.stepsList, 1, taskText, '命中本地离线指令库 · 免 API 毫秒级直控', '已完成', false, 'local.rule');
          appendNativeConsoleLog(`本地执行成功: ${taskText} -> ${res.summary}`);
          finalizeAgentTurn(cardCtx, {
            status: 'done',
            summaryTitle: `已执行：${taskText}`,
            replyText: res.summary
          });
          if (isNativeAutoSwiping() && cardCtx.stopBtn) {
            cardCtx.stopBtn.classList.remove('hidden');
            cardCtx.stopBtn.textContent = '停止连刷';
          }
          syncStatus();
          return;
        }

        cardCtx.stepCount = 1;
        addStepItem(cardCtx.stepsList, 1, '本地离线口令未匹配', '可切换至 API 智能识屏规划执行复杂自然语言任务', '未匹配', true, 'local.rule');
        showInlineFixBox(cardCtx.fixSlot, { error: '该任务超出本地离线口令范围，是否切换为 API 智能识屏规划？' }, {
          onRetryWithMode: (nextMode) => runReActLoop(taskText, cardCtx, nextMode)
        });
        finalizeAgentTurn(cardCtx, { status: 'error', summaryTitle: '本地口令未匹配' });
        return;
      }

      // 分支 B：dsh-Go 智能多步 ReAct 循环（支持 ref 控屏、ScreenVerdict、SafetyGate 与中途插话）
      const MAX_STEPS = 20;
      const history = isResuming ? resumeOpts.history.slice() : [];
      const screenSize = getScreenSizeObj();
      const installedApps = getInstalledAppsList();
      let roundAutoApproved =
        resumeOpts && typeof resumeOpts.roundAutoApproved === 'boolean'
          ? resumeOpts.roundAutoApproved
          : (getConfirmPolicy() === 'auto_turn');
      let startStep = isResuming && Number(resumeOpts.startStep) > 0 ? Number(resumeOpts.startStep) : 1;
      let lastScreenVerdict = resumeOpts?.lastScreenVerdict || null;
      let noChangeStreak = 0;

      for (let step = startStep; step <= MAX_STEPS; step++) {
        if (signal.aborted || emergencyStopRequested) {
          addStepItem(cardCtx.stepsList, step, '任务已停止', '', '已中止', true, 'system.stop');
          finalStatus = 'error';
          finalSummaryTitle = '已停止执行';
          break;
        }
        if (native && b && typeof b.isEmergencyStopRequested === 'function' && b.isEmergencyStopRequested()) {
          b.resetEmergencyStop();
          addStepItem(cardCtx.stepsList, step, '悬浮球急停触发', '', '已急停', true, 'system.stop');
          finalStatus = 'error';
          finalSummaryTitle = '已安全急停';
          break;
        }

        // 消费排队插话指令
        const turnInterjections = [];
        while (queuedInterjections.length > 0) {
          const item = queuedInterjections.shift();
          if (item && item.text) turnInterjections.push(item.text);
        }
        updateQueueBarUi();

        if (native && b && typeof b.updateFloatState === 'function') {
          try { b.updateFloatState('thinking', `第 ${step} 步 规划中...`); } catch {}
        }

        const snapshot = readAndFormatSnapshot(false);
        const pendingStepEl = addStepItem(
          cardCtx.stepsList,
          step,
          '正在识别屏幕并规划',
          native ? `当前应用：${snapshot.appName || '桌面'}（${snapshot.nodes.length} 个元素）` : '网页端逻辑推演规划中',
          '规划中',
          false,
          'phone.screen'
        );
        cardCtx.stepCount = step;
        if (cardCtx.summaryTextEl) {
          cardCtx.summaryTextEl.textContent = `第 ${step} 步 · ${snapshot.appName || '读取屏幕'} 规划中`;
        }

        let planResp;
        try {
          planResp = await requestPlanStep({
            execMode,
            task: taskText,
            snapshot,
            history,
            screenSize,
            installedApps,
            screenVerdict: lastScreenVerdict,
            interjections: turnInterjections,
            stepIndex: step,
            signal
          });
        } catch (err) {
          if (err?.name === 'AbortError' || signal.aborted) {
            updateStepResult(pendingStepEl, '已取消', true);
            finalStatus = 'error';
            finalSummaryTitle = '已取消当前任务';
            break;
          }
          updateStepResult(pendingStepEl, '网络异常', true);
          finalStatus = 'error';
          finalSummaryTitle = `规划网络异常：${err?.message || err}`;
          break;
        }

        if (!planResp.ok || !planResp.plan) {
          updateStepResult(pendingStepEl, '规划失败', true);
          showInlineFixBox(cardCtx.fixSlot, planResp, {
            onRetryWithMode: (nextMode) =>
              runReActLoop(
                taskText,
                cardCtx,
                nextMode,
                nextMode === 'local' ? null : { history, startStep: step, roundAutoApproved, lastScreenVerdict }
              ),
            onRetryStep: () =>
              runReActLoop(taskText, cardCtx, execMode, {
                history,
                startStep: step,
                roundAutoApproved,
                lastScreenVerdict
              })
          });
          finalStatus = 'error';
          finalSummaryTitle = planResp.error || '未能获取有效规划指令';
          break;
        }

        const plan = planResp.plan;
        const toolName = plan.tool || plan.action || 'step';
        const badgeEl = pendingStepEl?.querySelector('.pa-tool-badge');
        if (badgeEl) badgeEl.textContent = toolName;
        const descEl = pendingStepEl?.querySelector('.pa-step-desc');
        if (descEl) descEl.textContent = plan.summary || toolName;
        const thoughtEl = pendingStepEl?.querySelector('.pa-step-thought');
        if (thoughtEl && plan.thought) thoughtEl.textContent = plan.thought;
        if (cardCtx.summaryTextEl) {
          cardCtx.summaryTextEl.textContent = `${toolName} · ${plan.summary || '执行中'}`;
        }

        if (toolName === 'done') {
          const doneMsg = plan.reply || plan.args?.message || plan.summary || '全部任务步骤已顺利完成';
          updateStepResult(pendingStepEl, '已完成', false);
          appendNativeConsoleLog(`AI 任务完成: ${doneMsg}`);
          finalStatus = 'done';
          finalSummaryTitle = `已完成 ${step} 步手机操控${snapshot.appName ? ` · ${snapshot.appName}` : ''}`;
          finalReplyText = doneMsg;
          break;
        }

        if (toolName === 'ask_user') {
          const askMsg = plan.reply || plan.args?.message || plan.summary || '请手动完成当前页面操作后再继续';
          updateStepResult(pendingStepEl, '等待人工', false);
          finalStatus = 'done';
          finalSummaryTitle = '等待你的手动操作';
          finalReplyText = askMsg;
          handoverCb = () =>
            runReActLoop(taskText, cardCtx, execMode, {
              history: [...history, { step, tool: 'ask_user', summary: askMsg, result: '用户已手动处理' }],
              startStep: step + 1,
              roundAutoApproved,
              lastScreenVerdict: null
            });
          break;
        }

        const gateInfo = evaluateSafetyGate(plan, snapshot, roundAutoApproved);
        if (gateInfo.needConfirm) {
          updateStepResult(pendingStepEl, '待确认', false);
          const decision = await askStepConfirmCard(cardCtx.confirmSlot, plan, signal, gateInfo, snapshot);
          if (decision === 'cancel') {
            updateStepResult(pendingStepEl, '已拒绝', true);
            finalStatus = 'error';
            finalSummaryTitle = '用户已取消该操作';
            break;
          }
          if (decision === 'handover') {
            updateStepResult(pendingStepEl, '交还人工', false);
            finalStatus = 'done';
            finalSummaryTitle = '已交还给你手动操作';
            finalReplyText = '请直接在手机屏幕完成敏感操作，完成后点击下方按钮即可让 AI 接力继续。';
            handoverCb = () =>
              runReActLoop(taskText, cardCtx, execMode, {
                history: [...history, { step, tool: 'handover', summary: plan.summary, result: '用户已手动接管完成' }],
                startStep: step + 1,
                roundAutoApproved,
                lastScreenVerdict: null
              });
            break;
          }
          if (decision === 'auto_turn' || decision === 'auto') {
            roundAutoApproved = true;
          } else if (decision === 'trust_app') {
            addTrustedApp(snapshot.appName, snapshot.packageName);
          }
        }

        if (native && b && typeof b.updateFloatState === 'function') {
          try { b.updateFloatState('acting', plan.summary || '执行中...'); } catch {}
        }

        const beforeMeta = native ? readScreenMeta() : null;
        const execRes = dispatchNativePlanAction(plan, snapshot);
        const verdict = native
          ? await waitForScreenVerdict(beforeMeta, toolName, signal)
          : { changed: true, elapsedMs: 0 };

        if (verdict && !verdict.changed && toolName !== 'phone_wait') {
          noChangeStreak += 1;
        } else {
          noChangeStreak = 0;
        }
        lastScreenVerdict = {
          ...verdict,
          noChangeStreak
        };

        updateStepResult(
          pendingStepEl,
          execRes.text,
          Boolean(execRes.error),
          native && !execRes.error && toolName !== 'phone_wait' ? Boolean(verdict.changed) : null
        );
        appendNativeConsoleLog(`第${step}步 [${toolName}]: ${execRes.text}`);

        history.push({
          step,
          tool: toolName,
          summary: plan.summary,
          result: execRes.text,
          changed: Boolean(verdict?.changed)
        });

        if (!native) {
          finalStatus = 'done';
          finalSummaryTitle = '网页端规划演示完成';
          finalReplyText = `已在网页预览完成动作推演：${plan.summary}。安装 Android 随身版 APK 并开启无障碍后，将在真机自动连续执行。`;
          break;
        }

        if (step === MAX_STEPS) {
          finalStatus = 'done';
          finalSummaryTitle = `已执行 ${MAX_STEPS} 步`;
          finalReplyText = '已达到单轮最大步数上限，你可以继续补充指令让我接着操作。';
        }
      }

      finalizeAgentTurn(cardCtx, {
        status: finalStatus,
        summaryTitle: finalSummaryTitle || `已完成 ${cardCtx.stepCount || 0} 步控屏`,
        replyText: finalReplyText,
        handoverCb
      });
    } finally {
      isAgentRunning = false;
      queuedInterjections = [];
      updateQueueBarUi();
      if (native && b && !isNativeAutoSwiping()) {
        try {
          if (typeof b.updateFloatState === 'function') b.updateFloatState('idle', 'dsh-Go');
          if (typeof b.setAgentForegroundActive === 'function') b.setAgentForegroundActive(false, '');
        } catch {}
      }
      syncStatus();
    }
  }

  async function executeTaskInChat(taskText) {
    const clean = String(taskText || '').trim();
    if (!clean) return;

    const shell = document.getElementById('app-shell');
    if (shell && shell.dataset.uiMode !== 'phone-agent') {
      document.getElementById('ws-mode-phone-agent')?.click();
    }

    // 运行中收到新指令 -> 自动进入排队插话模式
    if (isAgentRunning) {
      queuedInterjections.push({ text: clean, priority: false });
      updateQueueBarUi();
      appendUserMessageRow(clean, true);
      showToast('当前任务执行中，已加入插话队列（点「立即插话」优先注入）');
      return;
    }

    const mode = getExecMode();
    recordTaskHistory(clean, mode);
    appendUserMessageRow(clean);

    // 真机 APK 且非纯本地规则时，若无障碍未开启，内联弹出 dsh-go 引导卡
    if (isNativeApk() && mode !== 'local' && !getBridge()?.isAccessibilityEnabled?.()) {
      renderA11yGuideCard(clean);
      return;
    }

    const cardCtx = createAgentCardRow(clean, mode);
    if (!cardCtx) return;
    await runReActLoop(clean, cardCtx, mode);
  }

  function inspectScreenInChat() {
    const native = isNativeApk();
    if (!native) {
      showToast('手机辅助功能仅在 Android 随身版 App 端开放，请先下载安装 App');
      openModal();
      return;
    }
    if (!getBridge()?.isAccessibilityEnabled?.()) {
      renderA11yGuideCard('读取当前屏幕内容');
      return;
    }
    const cardCtx = createAgentCardRow('读取当前屏幕界面无障碍节点', getExecMode());
    if (!cardCtx) return;
    const snap = readAndFormatSnapshot(false);
    const sz = getScreenSizeObj();
    const sample = snap.nodes
      .filter((n) => n.text || n.desc)
      .slice(0, 12)
      .map((n) => n.text || n.desc)
      .join(' / ');
    cardCtx.stepCount = 1;
    addStepItem(
      cardCtx.stepsList,
      1,
      `已捕获 ${snap.nodes.length} 个界面元素（${sz.width}×${sz.height}）`,
      sample ? `可见关键元素：${sample}` : '当前窗口主要为图标或自绘视图',
      '已就绪',
      false,
      'phone.screen'
    );
    finalizeAgentTurn(cardCtx, {
      status: 'done',
      summaryTitle: `已读取 ${snap.appName || '当前屏幕'}（${snap.nodes.length} 个元素）`,
      replyText: sample ? `当前屏幕可见关键内容：${sample}` : '当前屏幕未检测到文字节点，可能为纯图像或自绘界面。'
    });
  }

  // 接收来自原生悬浮窗「交给星语 AI 规划」传回的任务
  window.__receiveFloatAgentTask = (taskText) => {
    const clean = String(taskText || '').trim();
    const shell = document.getElementById('app-shell');
    if (shell && shell.dataset.uiMode !== 'phone-agent') {
      document.getElementById('ws-mode-phone-agent')?.click();
    }
    if (!clean) {
      showToast('已回到 dsh-Go 手机控屏工作台');
      return;
    }
    if (getExecMode() === 'local' && !isSimpleBuiltInLocalCmd(clean)) {
      const cfg = getDirectConfig();
      setExecMode(cfg.apiKey ? 'api_direct' : 'api_cloud');
    }
    executeTaskInChat(clean);
  };

  function formatBytesMb(bytes) {
    const n = Number(bytes) || 0;
    if (n <= 0) return '0 MB';
    return `${(n / (1024 * 1024)).toFixed(2)} MB`;
  }

  function formatSpeed(bps) {
    const n = Number(bps) || 0;
    if (n <= 0) return '-- KB/s';
    if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(2)} MB/s`;
    return `${Math.round(n / 1024)} KB/s`;
  }

  function setUpdateRedDot(hasUpdate) {
    const dot = $('mfs-update-dot');
    if (dot) dot.classList.toggle('hidden', !hasUpdate);
  }

  function openExternalDownloadUrl(rawUrl) {
    const target = String(rawUrl || `${PUBLIC_WEB_ORIGIN}/api/download/apk`).trim();
    const b = getBridge();
    if (isNativeApk() && b && typeof b.openExternalUrl === 'function') {
      b.openExternalUrl(target);
      return;
    }
    window.open(target, '_blank', 'noopener');
  }

  function updateNativeModalProgress(prog) {
    if (!prog || typeof prog !== 'object') return;
    const stage = String(prog.stage || '');
    const wrap = $('upd-progress-wrap');
    const bar = $('upd-progress-bar');
    const statusEl = $('upd-progress-status');
    const pctEl = $('upd-progress-pct');
    const bytesEl = $('upd-progress-bytes');
    const speedEl = $('upd-progress-speed');
    const errBox = $('upd-error-box');
    const primaryBtn = $('upd-primary-btn');
    const cancelBtn = $('upd-cancel-btn');

    if (wrap) wrap.classList.remove('hidden');
    if (errBox && stage !== 'error') errBox.classList.add('hidden');

    const pct = Math.max(0, Math.min(100, Number(prog.percent) || 0));
    if (bar) bar.value = pct;
    if (pctEl) pctEl.textContent = `${pct}%`;
    if (statusEl && prog.message) statusEl.textContent = prog.message;
    if (bytesEl) {
      const dlStr = formatBytesMb(prog.downloadedBytes);
      const totStr = prog.totalBytes > 0 ? formatBytesMb(prog.totalBytes) : '-- MB';
      bytesEl.textContent = `${dlStr} / ${totStr}`;
    }
    if (speedEl) {
      speedEl.textContent = stage === 'downloading' ? formatSpeed(prog.speedBps) : '';
    }

    if (stage === 'downloading') {
      isDownloadingUpdate = true;
      if (primaryBtn) {
        primaryBtn.disabled = true;
        primaryBtn.textContent = `正在下载 (${pct}%)`;
      }
      if (cancelBtn) cancelBtn.textContent = '取消下载';
      return;
    }

    isDownloadingUpdate = false;
    if (cancelBtn) cancelBtn.textContent = '关闭';

    if (stage === 'ready' || stage === 'installing') {
      if (primaryBtn) {
        primaryBtn.disabled = false;
        primaryBtn.textContent = '再次拉起安装';
        primaryBtn.onclick = () => {
          const b = getBridge();
          if (b && typeof b.installDownloadedApk === 'function') {
            const st = b.installDownloadedApk();
            if (st === 'NEED_INSTALL_PERMISSION') {
              showToast('请在系统设置中允许安装未知应用后返回');
            }
          }
        };
      }
    } else if (stage === 'need_permission') {
      if (errBox) {
        errBox.textContent = prog.message || '请在系统设置开启「允许安装未知应用」后返回点击「继续安装」';
        errBox.classList.remove('hidden');
      }
      if (primaryBtn) {
        primaryBtn.disabled = false;
        primaryBtn.textContent = '继续安装';
        primaryBtn.onclick = () => {
          const b = getBridge();
          if (b && typeof b.installDownloadedApk === 'function') {
            b.installDownloadedApk();
          }
        };
      }
    } else if (stage === 'cancelled') {
      if (wrap) wrap.classList.add('hidden');
      if (primaryBtn) {
        primaryBtn.disabled = false;
        primaryBtn.textContent = '立即下载并安装';
        primaryBtn.onclick = () => triggerDownloadFromInfo(latestUpdateInfo);
      }
    } else if (stage === 'error') {
      if (errBox) {
        errBox.textContent = prog.message || '更新下载失败，请重试或改用浏览器备用下载';
        errBox.classList.remove('hidden');
      }
      if (primaryBtn) {
        primaryBtn.disabled = false;
        primaryBtn.textContent = '重试下载';
        primaryBtn.onclick = () => triggerDownloadFromInfo(latestUpdateInfo);
      }
    }
  }

  window.__onNativeUpdateCheckResult = (result) => {
    if (nativeCheckTimeoutId) {
      clearTimeout(nativeCheckTimeoutId);
      nativeCheckTimeoutId = null;
    }
    if (pendingNativeCheckResolve) {
      const resFn = pendingNativeCheckResolve;
      pendingNativeCheckResolve = null;
      resFn(result);
    }
  };

  window.__onNativeUpdateProgress = (prog) => {
    updateNativeModalProgress(prog);
  };

  function triggerDownloadFromInfo(info) {
    if (!info) {
      openExternalDownloadUrl(`${PUBLIC_WEB_ORIGIN}/api/download/apk`);
      return;
    }
    const b = getBridge();
    if (isNativeApk() && b && typeof b.startNativeApkUpdate === 'function' && info.nativeUpdateUrl) {
      updateNativeModalProgress({
        stage: 'downloading',
        percent: 0,
        downloadedBytes: 0,
        totalBytes: info.fileSizeBytes || 0,
        speedBps: 0,
        message: '正在连接更新服务器...'
      });
      b.startNativeApkUpdate(
        String(info.nativeUpdateUrl),
        String(info.sha256 || ''),
        Number(info.fileSizeBytes) || 0
      );
      return;
    }
    const dlUrl = info.fallbackDownloadUrl || info.downloadUrl || `${PUBLIC_WEB_ORIGIN}/api/download/apk`;
    openExternalDownloadUrl(dlUrl);
  }

  function renderUpdateDialogChecking() {
    const dlg = $('app-update-dialog');
    if (!dlg) return;
    const local = getInstalledVersionInfo();
    const iconWrap = $('upd-icon-wrap');
    if (iconWrap) iconWrap.className = 'upd-icon-wrap';
    if ($('upd-title')) $('upd-title').textContent = '检查应用更新';
    if ($('upd-subtitle')) $('upd-subtitle').textContent = '正在直连云端版本服务器核验...';
    if ($('upd-local-ver')) {
      $('upd-local-ver').textContent = local.versionCode > 0 ? `v${local.versionName} (Build ${local.versionCode})` : `v${local.versionName}`;
    }
    if ($('upd-remote-ver')) $('upd-remote-ver').textContent = '检测中...';
    $('upd-meta-strip')?.classList.add('hidden');
    $('upd-changelog-wrap')?.classList.add('hidden');
    $('upd-progress-wrap')?.classList.add('hidden');
    $('upd-error-box')?.classList.add('hidden');

    const primaryBtn = $('upd-primary-btn');
    if (primaryBtn) {
      primaryBtn.disabled = true;
      primaryBtn.textContent = '检测中...';
      primaryBtn.onclick = null;
    }
    const secBtn = $('upd-secondary-btn');
    if (secBtn) {
      secBtn.classList.add('hidden');
    }
    if (!dlg.open) dlg.showModal();
  }

  function renderUpdateDialogResult(info, localInfo) {
    const iconWrap = $('upd-icon-wrap');
    const titleEl = $('upd-title');
    const subEl = $('upd-subtitle');
    const localVerEl = $('upd-local-ver');
    const remoteVerEl = $('upd-remote-ver');
    const metaStrip = $('upd-meta-strip');
    const sizeTag = $('upd-size-tag');
    const shaTag = $('upd-sha-tag');
    const clWrap = $('upd-changelog-wrap');
    const clList = $('upd-changelog-list');
    const errBox = $('upd-error-box');
    const primaryBtn = $('upd-primary-btn');
    const secBtn = $('upd-secondary-btn');

    if (localVerEl) {
      localVerEl.textContent = localInfo.versionCode > 0
        ? `v${localInfo.versionName} (Build ${localInfo.versionCode})`
        : `v${localInfo.versionName}`;
    }

    if (!info || info.ok === false) {
      if (iconWrap) iconWrap.className = 'upd-icon-wrap is-error';
      if (titleEl) titleEl.textContent = '检查更新失败';
      if (subEl) subEl.textContent = '未能取得最新云端版本信息';
      if (remoteVerEl) remoteVerEl.textContent = '获取失败';
      if (errBox) {
        errBox.textContent = info?.error || '网络连接异常，请检查网络设置后重试';
        errBox.classList.remove('hidden');
      }
      if (primaryBtn) {
        primaryBtn.disabled = false;
        primaryBtn.textContent = '重试检查';
        primaryBtn.onclick = () => checkUpdate(false);
      }
      if (secBtn) {
        secBtn.classList.remove('hidden');
        secBtn.textContent = '前往官网手动下载';
        secBtn.onclick = () => openExternalDownloadUrl(PUBLIC_WEB_ORIGIN);
      }
      return;
    }

    latestUpdateInfo = info;
    const remoteVer = String(info.latestVersion || localInfo.versionName).replace(/^v/i, '');
    const remoteCode = Number(info.versionCode) || 0;
    const hasUpdate = typeof info.hasUpdate === 'boolean'
      ? info.hasUpdate
      : ((remoteCode > 0 && localInfo.versionCode > 0 && remoteCode > localInfo.versionCode) || isNewerVersion(remoteVer, localInfo.versionName));

    if (remoteVerEl) {
      remoteVerEl.textContent = remoteCode > 0 ? `v${remoteVer} (Build ${remoteCode})` : `v${remoteVer}`;
    }

    if (metaStrip) {
      metaStrip.classList.remove('hidden');
      if (sizeTag) sizeTag.textContent = `安装包 ${info.fileSize || formatBytesMb(info.fileSizeBytes) || '--'}`;
      if (shaTag) shaTag.textContent = info.sha256 ? `SHA-256 ${String(info.sha256).slice(0, 12)}...` : '签名校验就绪';
    }

    const notes = Array.isArray(info.changelog) ? info.changelog : [];
    if (clWrap && clList && notes.length > 0) {
      clList.innerHTML = notes.map((line) => `<li>${escapeHtml(line)}</li>`).join('');
      clWrap.classList.remove('hidden');
    }

    const native = isNativeApk();
    const canNativeAutoUpdate = native && typeof getBridge()?.startNativeApkUpdate === 'function' && Boolean(info.nativeUpdateUrl);
    const nowStr = new Date().toTimeString().slice(0, 8);
    const dlg = $('app-update-dialog');
    const closeBtn = $('upd-close-btn');
    const cancelBtn = $('upd-cancel-btn');

    if (hasUpdate) {
      const diffGenerations = (remoteCode > 0 && localInfo.versionCode > 0)
        ? Math.max(0, remoteCode - localInfo.versionCode)
        : (info.diffGenerations || 0);
      const isForcedUpdate = Boolean(info.forceUpdate || diffGenerations >= 3);

      if (isForcedUpdate) {
        if (dlg) dlg.dataset.forceUpdate = 'true';
        if (closeBtn) closeBtn.classList.add('hidden');
        if (cancelBtn) cancelBtn.classList.add('hidden');
        if (iconWrap) iconWrap.className = 'upd-icon-wrap is-error';
        if (titleEl) titleEl.textContent = `⚠️ 跨代强制更新：v${remoteVer}`;
        if (subEl) subEl.textContent = `您的版本落后 ${diffGenerations} 代，安全协议与核心功能已升级，必须更新后方可使用。`;
        if (primaryBtn) {
          primaryBtn.disabled = false;
          if (canNativeAutoUpdate) {
            primaryBtn.textContent = info.alreadyDownloaded ? '立即安装已下载包 (必须升级)' : '立即下载并安装 (必须升级)';
            primaryBtn.onclick = () => triggerDownloadFromInfo(info);
          } else {
            primaryBtn.textContent = '立即下载最新版 APK (必须升级)';
            primaryBtn.onclick = () => openExternalDownloadUrl(info.fallbackDownloadUrl || info.downloadUrl || PUBLIC_WEB_ORIGIN);
          }
        }
        if (secBtn) {
          secBtn.classList.remove('hidden');
          secBtn.textContent = '浏览器备用下载通道';
          secBtn.onclick = () => openExternalDownloadUrl(info.fallbackDownloadUrl || `${PUBLIC_WEB_ORIGIN}/api/download/apk`);
        }
      } else {
        if (dlg) dlg.dataset.forceUpdate = 'false';
        if (closeBtn) closeBtn.classList.remove('hidden');
        if (cancelBtn) {
          cancelBtn.classList.remove('hidden');
          cancelBtn.textContent = '暂不更新';
          cancelBtn.onclick = () => {
            try { localStorage.setItem('star_ignore_update_ver', remoteVer); } catch {}
            if (dlg && dlg.open) dlg.close();
          };
        }
        if (iconWrap) iconWrap.className = 'upd-icon-wrap';
        if (titleEl) titleEl.textContent = `发现新版本 v${remoteVer}`;
        if (subEl) subEl.textContent = `发布日期 ${info.releaseDate || '最新'} · 建议立即升级体验`;
        if (primaryBtn) {
          primaryBtn.disabled = false;
          if (canNativeAutoUpdate) {
            primaryBtn.textContent = info.alreadyDownloaded ? '立即安装已下载包' : '立即下载并安装';
            primaryBtn.onclick = () => triggerDownloadFromInfo(info);
          } else {
            primaryBtn.textContent = '前往下载最新版 APK';
            primaryBtn.onclick = () => openExternalDownloadUrl(info.fallbackDownloadUrl || info.downloadUrl || PUBLIC_WEB_ORIGIN);
          }
        }
        if (secBtn) {
          secBtn.classList.remove('hidden');
          secBtn.textContent = '浏览器备用下载';
          secBtn.onclick = () => openExternalDownloadUrl(info.fallbackDownloadUrl || `${PUBLIC_WEB_ORIGIN}/api/download/apk`);
        }
      }
    } else {
      if (dlg) dlg.dataset.forceUpdate = 'false';
      if (closeBtn) closeBtn.classList.remove('hidden');
      if (iconWrap) iconWrap.className = 'upd-icon-wrap is-latest';
      if (titleEl) titleEl.textContent = '当前已是最新版本';
      if (subEl) subEl.textContent = `已与云端同步 (核验时间 ${nowStr})`;
      if (primaryBtn) {
        primaryBtn.disabled = false;
        primaryBtn.textContent = '重新检测';
        primaryBtn.onclick = () => checkUpdate(false);
      }
      if (secBtn) {
        secBtn.classList.remove('hidden');
        secBtn.textContent = '强制重下当前包';
        secBtn.onclick = () => triggerDownloadFromInfo(info);
      }
    }
  }

  function fetchNativeCheckWithFallback(localInfo) {
    return new Promise((resolve) => {
      const b = getBridge();
      if (isNativeApk() && b && typeof b.checkAppUpdateNative === 'function') {
        if (nativeCheckTimeoutId) clearTimeout(nativeCheckTimeoutId);
        pendingNativeCheckResolve = resolve;
        nativeCheckTimeoutId = setTimeout(async () => {
          pendingNativeCheckResolve = null;
          nativeCheckTimeoutId = null;
          const fb = await fetchWebAppVersionDirect(localInfo);
          resolve(fb);
        }, 15000);
        try {
          b.checkAppUpdateNative();
        } catch {
          clearTimeout(nativeCheckTimeoutId);
          pendingNativeCheckResolve = null;
          fetchWebAppVersionDirect(localInfo).then(resolve);
        }
      } else {
        fetchWebAppVersionDirect(localInfo).then(resolve);
      }
    });
  }

  async function fetchWebAppVersionDirect(localInfo) {
    const q = `t=${Date.now()}&curCode=${localInfo.versionCode || 0}&curVer=${encodeURIComponent(localInfo.versionName || '')}`;
    const urls = isNativeApk()
      ? [`${PUBLIC_WEB_ORIGIN}/api/app-version?${q}`, `/api/app-version?${q}`]
      : [`/api/app-version?${q}`, `${PUBLIC_WEB_ORIGIN}/api/app-version?${q}`];

    let lastErr = '无法连接更新服务器';
    for (const u of urls) {
      try {
        const res = await fetch(u, { cache: 'no-store' });
        if (!res.ok) {
          lastErr = `更新服务返回 HTTP ${res.status}`;
          continue;
        }
        const info = await res.json();
        if (info && info.latestVersion) {
          const remoteVer = String(info.latestVersion).replace(/^v/i, '');
          const remoteCode = Number(info.versionCode) || 0;
          const hasUpdate = (remoteCode > 0 && localInfo.versionCode > 0 && remoteCode > localInfo.versionCode) || isNewerVersion(remoteVer, localInfo.versionName);
          return { ...info, ok: true, hasUpdate };
        }
      } catch (err) {
        lastErr = err?.message || '网络请求异常';
      }
    }
    return { ok: false, error: lastErr };
  }

  async function checkUpdate(silent = false) {
    const localInfo = getInstalledVersionInfo();
    if (!silent && !isDownloadingUpdate) {
      renderUpdateDialogChecking();
    }

    const info = await fetchNativeCheckWithFallback(localInfo);
    const titleEl = $('anv-status-title');
    const subEl = $('anv-status-sub');
    const boxEl = $('anv-update-status-box');

    if (info && info.ok !== false && info.latestVersion) {
      const remoteVer = String(info.latestVersion).replace(/^v/i, '');
      const remoteCode = Number(info.versionCode) || 0;
      const hasUpdate = typeof info.hasUpdate === 'boolean'
        ? info.hasUpdate
        : ((remoteCode > 0 && localInfo.versionCode > 0 && remoteCode > localInfo.versionCode) || isNewerVersion(remoteVer, localInfo.versionName));

      latestUpdateInfo = { ...info, hasUpdate };
      setUpdateRedDot(hasUpdate);

      if (hasUpdate) {
        if (titleEl) titleEl.textContent = `发现新版本 v${remoteVer} (${info.fileSize || '安装包'})`;
        if (subEl) {
          const notes = Array.isArray(info.changelog) ? info.changelog[0] : '';
          subEl.textContent = notes || '建议立即升级以获取最新版界面与手机辅助功能。';
        }
        if (boxEl) boxEl.classList.add('has-update');
        if (silent) {
          showToast(`发现新版本 v${remoteVer}，前往「设置 → 检查更新」可一键升级`);
        }
      } else {
        if (titleEl) titleEl.textContent = `当前已是最新版本 (v${localInfo.versionName})`;
        if (subEl) subEl.textContent = `已与云端发布版 v${remoteVer} 保持同步`;
        if (boxEl) boxEl.classList.remove('has-update');
      }
    } else if (!silent) {
      if (titleEl) titleEl.textContent = '检查更新失败';
      if (subEl) subEl.textContent = info?.error || '请检查网络连接后重试';
    }

    if (!silent && !isDownloadingUpdate) {
      renderUpdateDialogResult(info, localInfo);
    }
    return info;
  }

  function openDeepSeekOfficialPage() {
    const b = getBridge();
    if (isNativeApk() && b && typeof b.openExternalUrl === 'function') {
      try {
        b.openExternalUrl(DEEPSEEK_API_KEYS_URL);
        return;
      } catch {}
    }
    window.open(DEEPSEEK_API_KEYS_URL, '_blank', 'noopener,noreferrer');
  }

  function openModal() {
    const dlg = $('apk-download-modal');
    if (!dlg) return;
    syncModalEngineAndApkState();
    if (!dlg.open) dlg.showModal();
  }

  function closeModal() {
    const dlg = $('apk-download-modal');
    if (dlg && dlg.open) dlg.close();
  }

  function toggleCmdLibDrawer() {
    const drawer = $('phone-cmd-quick-drawer');
    if (!drawer) return;
    const isHidden = drawer.classList.toggle('hidden');
    $('pa-open-cmdlib-btn')?.classList.toggle('is-active', !isHidden);
  }

  function bindUiEvents() {
    // 0. 更新弹窗关闭/取消按钮 (#app-update-dialog)
    const closeUpdateDialog = () => {
      if (isDownloadingUpdate) {
        const b = getBridge();
        if (isNativeApk() && b && typeof b.cancelNativeApkUpdate === 'function') {
          b.cancelNativeApkUpdate();
        }
        isDownloadingUpdate = false;
      }
      const dlg = $('app-update-dialog');
      if (dlg && dlg.open) dlg.close();
    };
    $('upd-close-btn')?.addEventListener('click', closeUpdateDialog);
    $('upd-cancel-btn')?.addEventListener('click', closeUpdateDialog);

    // 1. 顶部紧凑栏与 Bottom-Sheet 控制台抽屉开关
    $('pa-open-sheet-btn')?.addEventListener('click', () => openControlSheet(false));
    $('pa-cfg-toggle-btn')?.addEventListener('click', () => {
      const sheet = $('pa-control-sheet');
      if (sheet && !sheet.classList.contains('hidden')) {
        closeControlSheet();
      } else {
        openControlSheet(false);
      }
    });
    $('pa-sheet-close-btn')?.addEventListener('click', closeControlSheet);
    $('pa-sheet-backdrop')?.addEventListener('click', closeControlSheet);
    $('pa-open-cmdlib-btn')?.addEventListener('click', toggleCmdLibDrawer);

    // 左侧栏手机辅助专属按钮
    $('pa-sidebar-new-task-btn')?.addEventListener('click', () => {
      window.__closeMobileDrawers?.();
      resetTaskWorkspace();
    });
    $('pa-sidebar-open-sheet-btn')?.addEventListener('click', () => {
      window.__closeMobileDrawers?.();
      openControlSheet(false);
    });
    $('pa-sidebar-open-cmdlib-btn')?.addEventListener('click', () => {
      window.__closeMobileDrawers?.();
      const drawer = $('phone-cmd-quick-drawer');
      if (drawer) {
        drawer.classList.remove('hidden');
        $('pa-open-cmdlib-btn')?.classList.add('is-active');
      }
    });
    $('pa-clear-history-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      clearTaskHistory();
    });

    // 2. 引擎分段切换 (#pa-mode-api-direct / #pa-mode-api-cloud / #pa-mode-local)
    document.querySelectorAll('.pa-seg-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.paMode;
        setExecMode(mode);
        const cfg = getDirectConfig();
        if (mode === 'api_direct' && !cfg.apiKey) {
          $('pa-inline-config-drawer')?.classList.remove('hidden');
          $('pa-cfg-apikey')?.focus();
          showToast('已切换至 DeepSeek API 直连，请在下方填入密钥并保存');
        } else {
          showToast(`手机辅助已切换至「${getEngineLabel(mode)}」`);
        }
      });
    });

    // 3. 配置保存应用 (#pa-cfg-save-btn) 与官网获取密钥链接 (#pa-open-ds-official-btn)
    $('pa-open-ds-official-btn')?.addEventListener('click', openDeepSeekOfficialPage);
    $('pa-cfg-save-btn')?.addEventListener('click', () => {
      const apiKey = ($('pa-cfg-apikey')?.value || '').trim();
      const model = ($('pa-cfg-model')?.value || 'deepseek-chat').trim();
      const baseUrl = ($('pa-cfg-baseurl')?.value || '').trim();
      const autoApprove = Boolean($('pa-cfg-auto-approve')?.checked);

      setDirectApiKey(apiKey);
      try {
        localStorage.setItem(STORAGE_KEYS.directModel, model);
        localStorage.setItem(STORAGE_KEYS.directBaseUrl, baseUrl);
        localStorage.setItem(STORAGE_KEYS.autoApprove, autoApprove ? '1' : '0');
      } catch {}

      closeControlSheet();
      syncStatus();
      showToast('手机辅助独立参数与确认策略已保存');
    });

    // 4. 权限状态胶囊与悬浮窗/自动刷视频快捷开关
    const handleOpenA11y = () => {
      if (!isNativeApk()) {
        showToast('当前为网页端：请在安卓设备安装随身版 APK 后开启无障碍服务');
        closeControlSheet();
        openModal();
        return;
      }
      const b = getBridge();
      if (typeof b.openAccessibilitySettings === 'function') {
        b.openAccessibilitySettings();
      }
      setTimeout(syncStatus, 1000);
    };
    $('pa-banner-a11y-chip')?.addEventListener('click', handleOpenA11y);
    $('pa-open-a11y-btn')?.addEventListener('click', handleOpenA11y);

    const handleToggleFloat = () => {
      if (!isNativeApk()) {
        showToast('多功能桌面悬浮窗需在 Android 原生随身版 APK 中运行');
        closeControlSheet();
        openModal();
        return;
      }
      const b = getBridge();
      try {
        if (b.isFloatAgentRunning && b.isFloatAgentRunning()) {
          b.stopFloatAgent();
          showToast('已停用桌面多功能悬浮窗');
        } else {
          if (b.hasOverlayPermission && !b.hasOverlayPermission()) {
            b.requestOverlayPermission();
            showToast('请先在系统设置允许「显示在其他应用上层」');
            return;
          }
          b.startFloatAgent();
          showToast('已开启桌面多功能悬浮窗（可刷视频、智能打字、快捷控制）');
        }
      } catch (e) {
        showToast(`操作悬浮窗失败: ${e?.message || e}`);
      }
      setTimeout(syncStatus, 350);
    };
    $('pa-banner-float-chip')?.addEventListener('click', handleToggleFloat);
    $('pa-banner-toggle-float-btn')?.addEventListener('click', handleToggleFloat);
    $('pa-toggle-float-btn')?.addEventListener('click', handleToggleFloat);

    $('pa-banner-confirm-chip')?.addEventListener('click', () => {
      const order = ['ask_every', 'sensitive_only', 'auto_turn'];
      const cur = getConfirmPolicy();
      const next = order[(order.indexOf(cur) + 1) % order.length];
      setConfirmPolicy(next);
      showToast(`已切换为「${getPolicyLabel(next)}」`);
    });

    $('pa-banner-policy-pill')?.addEventListener('click', () => openControlSheet(false));

    document.querySelectorAll('.pa-policy-card').forEach((card) => {
      card.addEventListener('click', () => {
        const p = card.dataset.paPolicy || 'sensitive_only';
        setConfirmPolicy(p);
        showToast(`安全策略已切换：${getPolicyLabel(p)}`);
      });
    });

    $('pa-cfg-edge-glow')?.addEventListener('change', (e) => {
      setEdgeGlowPref(Boolean(e.target.checked));
    });

    $('pa-queue-now-btn')?.addEventListener('click', () => {
      if (queuedInterjections.length > 0) {
        queuedInterjections[queuedInterjections.length - 1].priority = true;
        showToast('已标记优先注入，将在本步完成后立即响应');
      }
    });

    $('pa-queue-cancel-btn')?.addEventListener('click', () => {
      queuedInterjections = [];
      updateQueueBarUi();
      showToast('已取消排队插话');
    });

    $('pa-sheet-autoswipe-btn')?.addEventListener('click', () => {
      closeControlSheet();
      if (isNativeAutoSwiping()) {
        executeTaskInChat('停止刷视频');
      } else {
        executeTaskInChat('自动刷视频');
      }
    });

    // 5. 原生面板弹窗内的绑定 (#apk-download-modal)
    $('more-apk-download-btn')?.addEventListener('click', openModal);
    $('topbar-apk-download-btn')?.addEventListener('click', openModal);
    $('sidebar-apk-download-btn')?.addEventListener('click', openModal);
    $('sidebar-web-download-card')?.addEventListener('click', () => {
      window.__closeMobileDrawers?.();
      openModal();
    });
    $('apk-modal-close-btn')?.addEventListener('click', closeModal);
    $('anv-check-update-btn')?.addEventListener('click', () => checkUpdate(false));

    const copyApkLink = async () => {
      const url = `${window.location.origin}/api/download/apk`;
      await navigator.clipboard?.writeText(url).catch(() => {});
      showToast('已复制安装包下载直链到剪贴板');
    };
    $('apk-copy-link-btn')?.addEventListener('click', copyApkLink);
    $('anv-share-link-btn')?.addEventListener('click', copyApkLink);

    $('pa-run-task-btn')?.addEventListener('click', () => {
      const cmd = ($('pa-task-input')?.value || '').trim();
      if (!cmd) return;
      appendNativeConsoleLog(`下达任务: ${cmd}`);
      closeModal();
      executeTaskInChat(cmd);
    });

    // 手机辅助任务卡片语音听写识别模块（双引擎支持：Web Speech 实时听写 + 后端 ASR 录音转写保底）
    const paVoiceBtn = $('pa-voice-input-btn');
    const paTaskInput = $('pa-task-input');
    if (paVoiceBtn && paTaskInput) {
      let isPaVoiceRecording = false;
      let paActiveMediaRecorder = null;
      let paActiveAudioStream = null;
      let paRecordedChunks = [];
      let paActiveSpeechRec = null;
      let paBaseInput = '';
      let paSpeechFinalText = '';
      let paSpeechInterimText = '';
      let paVoiceTimer = null;
      let paVoiceSec = 0;

      const cleanupPaAudioStream = () => {
        if (paVoiceTimer) {
          clearInterval(paVoiceTimer);
          paVoiceTimer = null;
        }
        if (paActiveAudioStream) {
          try {
            paActiveAudioStream.getTracks().forEach((track) => track.stop());
          } catch {}
          paActiveAudioStream = null;
        }
      };

      const setPaVoiceBtnUi = (recording) => {
        isPaVoiceRecording = recording;
        paVoiceBtn.classList.toggle('recording', recording);
        paVoiceBtn.setAttribute('aria-pressed', String(recording));
        const span = paVoiceBtn.querySelector('span');
        if (span) span.textContent = recording ? '⏹ 00s·点我完成' : '🎙 语音';
        paVoiceBtn.title = recording ? '正在倾听…点击完成语音输入' : '语音输入口令（支持放歌/切歌/控屏/鲸鱼娘互动）';
      };

      const applyPaTextToInput = (textSegment) => {
        const clean = String(textSegment || '').trim();
        if (!clean && !paBaseInput) return;
        const sep = paBaseInput && clean && !/\s$/.test(paBaseInput) ? ' ' : '';
        paTaskInput.value = `${paBaseInput}${sep}${clean}`;
        paTaskInput.dispatchEvent(new Event('input', { bubbles: true }));
      };

      const stopPaVoiceRecording = async () => {
        if (!isPaVoiceRecording) return;
        setPaVoiceBtnUi(false);

        if (paActiveSpeechRec) {
          try { paActiveSpeechRec.stop(); } catch {}
          paActiveSpeechRec = null;
        }

        if (paActiveMediaRecorder && paActiveMediaRecorder.state !== 'inactive') {
          try { paActiveMediaRecorder.stop(); } catch { cleanupPaAudioStream(); }
        } else {
          cleanupPaAudioStream();
          const finalWebSpeech = (paSpeechFinalText + paSpeechInterimText).trim();
          if (finalWebSpeech) {
            applyPaTextToInput(finalWebSpeech);
            paTaskInput.focus();
            showToast('口令语音输入完成');
          }
        }
      };

      const startPaVoiceRecording = async () => {
        if (isPaVoiceRecording) {
          await stopPaVoiceRecording();
          return;
        }

        paBaseInput = paTaskInput.value || '';
        paSpeechFinalText = '';
        paSpeechInterimText = '';
        paRecordedChunks = [];

        const SpeechRecCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
        const canUseRecorder = Boolean(
          navigator.mediaDevices &&
            typeof navigator.mediaDevices.getUserMedia === 'function' &&
            typeof window.MediaRecorder !== 'undefined'
        );

        if (!SpeechRecCtor && !canUseRecorder) {
          showToast('当前浏览器环境不支持麦克风语音输入');
          return;
        }

        let startedEngine = false;

        // 引擎 1：浏览器原生实时听写
        if (SpeechRecCtor) {
          try {
            const rec = new SpeechRecCtor();
            rec.lang = 'zh-CN';
            rec.continuous = true;
            rec.interimResults = true;
            rec.onresult = (e) => {
              let finalS = '';
              let interimS = '';
              for (let i = 0; i < e.results.length; i++) {
                const item = e.results[i];
                const tr = item[0]?.transcript || '';
                if (item.isFinal) finalS += tr;
                else interimS += tr;
              }
              paSpeechFinalText = finalS;
              paSpeechInterimText = interimS;
              applyPaTextToInput(paSpeechFinalText + paSpeechInterimText);
            };
            rec.onerror = (errEv) => {
              if (errEv?.error === 'not-allowed' || errEv?.error === 'service-not-allowed') {
                if (!paActiveMediaRecorder) {
                  setPaVoiceBtnUi(false);
                  showToast('麦克风权限被拒绝，请允许麦克风权限后重试');
                }
              }
            };
            rec.onend = () => {
              if (isPaVoiceRecording && (!paActiveMediaRecorder || paActiveMediaRecorder.state === 'inactive')) {
                setPaVoiceBtnUi(false);
                const combined = (paSpeechFinalText + paSpeechInterimText).trim();
                if (combined) {
                  applyPaTextToInput(combined);
                  paTaskInput.focus();
                  showToast('口令语音输入完成');
                }
              }
            };
            rec.start();
            paActiveSpeechRec = rec;
            startedEngine = true;
          } catch {}
        }

        // 引擎 2：MediaRecorder 录制高精度音频转写兜底
        if (canUseRecorder) {
          try {
            const stream = await navigator.mediaDevices.getUserMedia({
              audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
            });
            paActiveAudioStream = stream;
            const chosenMime = typeof MediaRecorder.isTypeSupported === 'function' && MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
              ? 'audio/webm;codecs=opus'
              : (MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : '');
            const recorder = chosenMime ? new MediaRecorder(stream, { mimeType: chosenMime }) : new MediaRecorder(stream);
            recorder.ondataavailable = (ev) => {
              if (ev.data && ev.data.size > 0) paRecordedChunks.push(ev.data);
            };
            recorder.onstop = async () => {
              cleanupPaAudioStream();
              const webSpeech = (paSpeechFinalText + paSpeechInterimText).trim();
              const audioBlob = new Blob(paRecordedChunks, { type: recorder.mimeType || 'audio/webm' });
              paRecordedChunks = [];
              if (audioBlob.size < 400) {
                if (webSpeech) {
                  applyPaTextToInput(webSpeech);
                  paTaskInput.focus();
                } else {
                  showToast('未检测到有效语音，请靠近麦克风再试');
                }
                return;
              }
              if (!webSpeech) {
                showToast('正在识别口令语音内容…', 1800);
              }
              try {
                const reader = new FileReader();
                reader.readAsDataURL(audioBlob);
                reader.onloadend = async () => {
                  try {
                    const dataUrl = String(reader.result || '');
                    const res = await fetch('/api/asr/transcribe', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ audio_data_url: dataUrl })
                    });
                    if (res.ok) {
                      const j = await res.json();
                      const asrText = String(j?.text || '').trim();
                      if (asrText) {
                        applyPaTextToInput(asrText);
                        paTaskInput.focus();
                        showToast('口令语音识别完成');
                        return;
                      }
                    }
                  } catch {}
                  if (webSpeech) {
                    applyPaTextToInput(webSpeech);
                    paTaskInput.focus();
                  }
                };
              } catch {
                if (webSpeech) {
                  applyPaTextToInput(webSpeech);
                  paTaskInput.focus();
                }
              }
            };
            recorder.start();
            paActiveMediaRecorder = recorder;
            startedEngine = true;
          } catch (permErr) {
            cleanupPaAudioStream();
            if (!startedEngine) {
              setPaVoiceBtnUi(false);
              showToast('请允许麦克风权限以使用语音输入');
              return;
            }
          }
        }

        if (startedEngine) {
          setPaVoiceBtnUi(true);
          paVoiceSec = 0;
          if (paVoiceTimer) clearInterval(paVoiceTimer);
          paVoiceTimer = setInterval(() => {
            if (!isPaVoiceRecording) {
              clearInterval(paVoiceTimer);
              paVoiceTimer = null;
              return;
            }
            paVoiceSec += 1;
            const sp = paVoiceBtn.querySelector('span');
            if (sp) sp.textContent = `⏹ ${String(paVoiceSec).padStart(2, '0')}s·完成`;
            if (paVoiceSec === 5 && !paSpeechFinalText && !paSpeechInterimText) {
              showToast('💡 可试说：“用QQ音乐放晴天”、“下一首”、“喂米饭”、“打开微信”', 2600);
            }
          }, 1000);
          showToast('🎙️ 正在倾听…可试说“用QQ音乐放晴天 / 下一首 / 打开微信”，说完再点一次完成', 3400);
        } else {
          setPaVoiceBtnUi(false);
          showToast('启动麦克风录音失败，请确认浏览器已授予录音权限');
        }
      };

      paVoiceBtn.addEventListener('click', startPaVoiceRecording);
    }

    document.querySelectorAll('.pa-quick-test-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const cmd = btn.dataset.cmd || '';
        if (!cmd) return;
        const res = tryExecuteLocalQuickCommand(cmd);
        if (res.handled) {
          appendNativeConsoleLog(res.summary);
          showToast(res.summary);
        } else {
          appendNativeConsoleLog(`预览指令: ${cmd} -> ${simulateWebLocalPreview(cmd)}`);
          showToast(simulateWebLocalPreview(cmd));
        }
      });
    });

    // 6. ESC 关闭控制台抽屉或指令库
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const sheet = $('pa-control-sheet');
        if (sheet && !sheet.classList.contains('hidden')) {
          closeControlSheet();
        }
        const cmdDrawer = $('phone-cmd-quick-drawer');
        if (cmdDrawer && !cmdDrawer.classList.contains('hidden')) {
          cmdDrawer.classList.add('hidden');
          $('pa-open-cmdlib-btn')?.classList.remove('is-active');
        }
      }
    });

    // 7. 切回应用或获得焦点时刷新权限状态
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        setTimeout(syncStatus, 250);
      }
    });
    window.addEventListener('focus', () => setTimeout(syncStatus, 250));
  }

  function init() {
    syncWebEnvironmentGates();
    renderEmptyGuideTiles();
    renderCommandLibraryDrawer();
    renderSidebarHistory();
    bindUiEvents();

    const updDlg = $('app-update-dialog');
    if (updDlg) {
      updDlg.addEventListener('cancel', (e) => {
        if (updDlg.dataset.forceUpdate === 'true') {
          e.preventDefault();
          return;
        }
        if (isDownloadingUpdate) {
          const b = getBridge();
          if (isNativeApk() && b && typeof b.cancelNativeApkUpdate === 'function') {
            b.cancelNativeApkUpdate();
          }
          isDownloadingUpdate = false;
        }
      });
    }
    syncStatus();
    if (document.getElementById('app-shell')?.dataset.uiMode === 'phone-agent') {
      renderWorkspace();
    }
    setTimeout(() => {
      checkUpdateOnStartup();
    }, 1200);
  }

  async function checkUpdateOnStartup() {
    const localInfo = getInstalledVersionInfo();
    const info = await fetchNativeCheckWithFallback(localInfo);
    if (!info || info.ok === false || !info.latestVersion) return;

    const remoteVer = String(info.latestVersion).replace(/^v/i, '');
    const remoteCode = Number(info.versionCode) || 0;
    const hasUpdate = typeof info.hasUpdate === 'boolean'
      ? info.hasUpdate
      : ((remoteCode > 0 && localInfo.versionCode > 0 && remoteCode > localInfo.versionCode) || isNewerVersion(remoteVer, localInfo.versionName));

    if (!hasUpdate) return;

    const diffGenerations = (remoteCode > 0 && localInfo.versionCode > 0)
      ? Math.max(0, remoteCode - localInfo.versionCode)
      : (info.diffGenerations || 0);
    const isForcedUpdate = Boolean(info.forceUpdate || diffGenerations >= 3);

    let ignoredVer = '';
    try { ignoredVer = localStorage.getItem('star_ignore_update_ver') || ''; } catch {}

    if (isForcedUpdate || ignoredVer !== remoteVer) {
      renderUpdateDialogResult(info, localInfo);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.PhoneAgent = {
    currentVersion: CURRENT_APK_VERSION,
    currentVersionCode: CURRENT_APK_CODE,
    githubReleasesUrl: GITHUB_RELEASES_URL,
    catalog: LOCAL_COMMAND_CATALOG,
    get isNative() {
      return isNativeApk();
    },
    getInstalledVersionInfo,
    getInstalledVersionLabel,
    getExecMode,
    setExecMode,
    setDirectApiKey,
    syncStatus,
    checkUpdate,
    checkUpdateOnStartup,
    executeTaskInChat,
    inspectScreenInChat,
    onEnterMode,
    renderWorkspace,
    resetTaskWorkspace,
    openControlSheet,
    closeControlSheet,
    openDeepSeekOfficialPage,
    openModal,
    closeModal
  };
})();

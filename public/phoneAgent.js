/* ==========================================================================
   Phone Agent 手机端 AI 辅助助理与 dsh-Go 规划循环模块 (v1.9.8)
   1. 与 DeepSeek 问答模式 100% 物理隔离：独立工作台卡片流、独立侧栏任务历史、独立控制台抽屉
   2. 顶部单行紧凑状态条 + Bottom-Sheet 控制台 + 超薄单行胶囊输入舱
   3. 4 大分类精炼快捷指令库：常用操作、输入与搜索、手势与系统、短视频
   4. 接入原生 PackageManager 实时版本读取、签名票据直下、SHA-256 校验与系统安装器拉起
   ========================================================================== */

(() => {
  const CURRENT_APK_VERSION = '1.9.9';
  const CURRENT_APK_CODE = 129;
  const DEEPSEEK_API_KEYS_URL = 'https://platform.deepseek.com/api_keys';
  const PUBLIC_WEB_ORIGIN = 'https://star.claudexxb.online';
  const GITHUB_RELEASES_URL = 'https://github.com/qts2218346424-cyber/persona-chat-studio/releases';

  const STORAGE_KEYS = {
    execMode: 'pa_exec_mode_v1',
    directModel: 'pa_direct_model_v1',
    directBaseUrl: 'pa_direct_baseurl_v1',
    autoApprove: 'pa_auto_approve_v1',
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
    }
  ];

  const EMPTY_GUIDE_PRESETS = [
    { label: '打开任意 App...', sub: '输入应用名快速直达', cmd: '打开 ', mode: 'fill' },
    { label: '快捷搜索...', sub: '打开搜索栏并查询', cmd: '搜索 ', mode: 'fill' },
    { label: '智能代打字...', sub: '自动填入底层输入框', cmd: '打字 ', mode: 'fill' },
    { label: '读取当前屏幕', sub: '查看界面控件上下文', cmd: '__inspect_screen__', mode: 'exec' },
    { label: '系统截屏', sub: '一键截取当前屏幕', cmd: '截屏', mode: 'exec' },
    { label: '自动刷视频', sub: '每8秒自动上滑切换', cmd: '自动刷视频', mode: 'exec' }
  ];

  // 独立于 DeepSeek 问答会话的手机辅助专属 DOM 消息节点缓存
  let paSessionNodes = [];
  let activeCmdLibCategory = 'common';
  let installedAppsCache = null;
  let activeAbortController = null;
  let emergencyStopRequested = false;
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
    return 'local';
  }

  function setExecMode(mode) {
    const next = mode === 'api_cloud' || mode === 'local' ? mode : 'api_direct';
    try {
      localStorage.setItem(STORAGE_KEYS.execMode, next);
    } catch {}
    syncStatus();
    return next;
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

  function renderCommandLibraryDrawer() {
    const drawer = $('phone-cmd-quick-drawer');
    if (!drawer) return;
    const cat = LOCAL_COMMAND_CATALOG.find((c) => c.id === activeCmdLibCategory) || LOCAL_COMMAND_CATALOG[0];

    drawer.innerHTML = `
      <div class="pa-cmdlib-topbar">
        <span class="pa-cmdlib-title">快捷指令</span>
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

    drawer.querySelectorAll('.pa-cmd-item').forEach((itemBtn) => {
      itemBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const cmd = itemBtn.getAttribute('data-cmd') || '';
        const mode = itemBtn.getAttribute('data-mode') || 'exec';
        handleCatalogItemTrigger(cmd, mode);
      });
    });
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
    if (confirmChip && confirmText) {
      confirmChip.classList.remove('mode-on', 'disabled');
      if (cfg.autoApprove) {
        confirmChip.classList.add('mode-on');
        confirmText.textContent = '免确认自动执行';
      } else {
        confirmChip.classList.add('disabled');
        confirmText.textContent = '逐步安全确认';
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

  function readScreenNodes() {
    if (!isNativeApk()) return [];
    const b = getBridge();
    try {
      if (typeof b.dumpScreenHierarchy === 'function') {
        const raw = b.dumpScreenHierarchy(false);
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
        if (parsed && Array.isArray(parsed.nodes)) return parsed.nodes;
        return [];
      }
    } catch {}
    return [];
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

  function appendUserMessageRow(text) {
    const container = $('messages-container');
    if (!container) return;
    document.querySelector('.chat-stage')?.classList.remove('ds-empty-mode');

    const row = document.createElement('div');
    row.className = 'msg-row user pa-user-row';

    const wrap = document.createElement('div');
    wrap.className = 'user-msg-wrap';

    const bodyEl = document.createElement('div');
    bodyEl.className = 'msg-body';
    bodyEl.textContent = String(text || '');

    wrap.appendChild(bodyEl);
    row.appendChild(wrap);
    paSessionNodes.push(row);
    container.appendChild(row);
    syncEmptyGuideVisibility();
    scrollChatToBottom();
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
    card.className = 'pa-agent-card';
    card.innerHTML = `
      <div class="pa-card-head">
        <div class="pa-card-title">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4d6bfe" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <rect x="5" y="2" width="14" height="20" rx="2" ry="2"></rect>
            <line x1="12" y1="18" x2="12.01" y2="18"></line>
          </svg>
          <span>手机辅助 · dsh-Go</span>
        </div>
        <div style="display:flex;align-items:center;gap:6px;">
          <span class="pa-engine-badge">${escapeHtml(getEngineLabel(execMode))}</span>
          <button type="button" class="pa-banner-btn subtle pa-card-stop-btn" style="padding:3px 9px;font-size:11px;">停止</button>
        </div>
      </div>
      <div class="pa-task-echo" style="font-size:12.5px;color:light-dark(#475569,#94a3b8);">任务指令：${escapeHtml(taskText)}</div>
      <div class="pa-steps-list"></div>
      <div class="pa-confirm-slot"></div>
      <div class="pa-fix-slot"></div>
    `;

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
      stepsList: card.querySelector('.pa-steps-list'),
      confirmSlot: card.querySelector('.pa-confirm-slot'),
      fixSlot: card.querySelector('.pa-fix-slot'),
      stopBtn: card.querySelector('.pa-card-stop-btn')
    };
  }

  function addStepItem(stepsList, stepNum, summary, thought, statusText, isError = false) {
    if (!stepsList) return null;
    const item = document.createElement('div');
    item.className = 'pa-step-item';
    item.innerHTML = `
      <div class="pa-step-top">
        <span>第 ${stepNum} 步 · ${escapeHtml(summary)}</span>
      </div>
      ${thought ? `<div class="pa-step-thought">${escapeHtml(thought)}</div>` : ''}
      <div class="pa-step-result ${isError ? 'is-error' : ''}">${escapeHtml(statusText)}</div>
    `;
    stepsList.appendChild(item);
    scrollChatToBottom();
    return item;
  }

  function updateStepResult(stepEl, statusText, isError = false) {
    if (!stepEl) return;
    const resEl = stepEl.querySelector('.pa-step-result');
    if (resEl) {
      resEl.textContent = statusText;
      resEl.classList.toggle('is-error', Boolean(isError));
    }
    scrollChatToBottom();
  }

  function formatActionCodeDesc(plan) {
    const act = plan?.action || 'done';
    const p = plan?.params || {};
    if (act === 'launch_app') return `launch_app("${p.appName || ''}")`;
    if (act === 'click_node') return `click_node("${p.text || p.viewId || ''}")`;
    if (act === 'click') return `click(${p.x || 0}, ${p.y || 0})`;
    if (act === 'long_click') return `long_click(${p.x || 0}, ${p.y || 0})`;
    if (act === 'swipe') return `swipe(${p.x1},${p.y1} -> ${p.x2},${p.y2})`;
    if (act === 'input') return `input("${String(p.text || '').slice(0, 40)}")`;
    if (act === 'wait') return `wait(${p.ms || 1000}ms)`;
    return `${act}()`;
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

  function askStepConfirmCard(confirmSlot, plan, signal) {
    if (!confirmSlot) return Promise.resolve('allow');
    const b = getBridge();
    if (b && typeof b.requestUserConfirmation === 'function') {
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
            <span>dsh-Go 安全确认：即将向系统派发操作</span>
          </div>
          <div class="pa-action-box">
            <div><strong>${escapeHtml(plan.summary || '执行下一步操作')}</strong></div>
            <div style="margin-top:4px;">动作指令：<code>${escapeHtml(formatActionCodeDesc(plan))}</code></div>
          </div>
          <div class="pa-confirm-btns">
            <button type="button" class="pa-banner-btn" data-decision="allow">允许本次</button>
            <button type="button" class="pa-banner-btn outline" data-decision="auto">本轮自动放行</button>
            <button type="button" class="pa-banner-btn subtle" data-decision="cancel">取消</button>
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

  function buildPlanningPromptMessages(task, screenNodes, history, screenSize, installedApps) {
    const sys = [
      '你是星语手机辅助代理（Phone Agent · dsh-Go 规划内核）。',
      `屏幕分辨率: ${screenSize.width}x${screenSize.height}。`,
      '你必须仅返回一个合法 JSON 对象（不要用 Markdown 代码块包裹，也不要附加前后任何解释文字），字段定义：',
      '{"thought":"简短中文判断(<=35字)","action":"launch_app|click_node|click|long_click|swipe|input|home|back|recents|wait|done|ask_user","params":{},"summary":"本步中文说明(<=25字)","needConfirm":false}',
      '常用 action 的 params：',
      'launch_app:{"appName":"微信"} / click_node:{"text":"发送","viewId":""} / click:{"x":540,"y":1200} / long_click:{"x":540,"y":1200} / swipe:{"x1":540,"y1":1600,"x2":540,"y2":600,"duration":350} / input:{"text":"你好","viewId":""} / wait:{"ms":1000} / done:{"message":"完成"} / ask_user:{"message":"请补充信息"}。',
      '打开应用优先使用 launch_app；付款、转账、下单、删除、卸载、发消息等高风险步骤必须设置 needConfirm=true。',
      '关键限制：如果连续 2 次 wait 后屏幕界面节点仍无变化或节点极少（如自绘弹窗/SKU面板），严禁继续 wait 或输出非 JSON 解释，必须尝试 click/swipe 或返回 {"thought":"面板控件未暴露","action":"ask_user","params":{"message":"请手动点选规格后继续"},"summary":"等待手动操作","needConfirm":false}。'
    ].join('\n');

    const compactNodes = (screenNodes || []).slice(0, 120).map((n, idx) => ({
      i: idx,
      t: n.text || '',
      d: n.desc || '',
      id: n.viewId || n.id || '',
      cls: String(n.className || n.cls || '').split('.').pop(),
      clk: Boolean(n.clickable),
      edt: Boolean(n.editable),
      c: n.center || undefined,
      b: n.bounds || ''
    }));

    const usr = JSON.stringify({
      task,
      stepIndex: (history || []).length + 1,
      recentHistory: (history || []).slice(-6),
      installedApps: (installedApps || []).slice(0, 40).map((a) => (typeof a === 'string' ? a : a.name)),
      screenNodes: compactNodes
    });

    return [
      { role: 'system', content: sys },
      { role: 'user', content: usr }
    ];
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
          return directObj;
        }
      } catch {}

      // 平衡大括号扫描（跳过引号内括号），防止前后注释文字干扰 JSON.parse
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
                if (parsed && typeof parsed === 'object' && parsed.action) {
                  return parsed;
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

  async function requestPlanStep({ execMode, task, screenNodes, history, screenSize, installedApps, signal }) {
    const cfg = getDirectConfig();
    if (execMode === 'api_direct') {
      if (!cfg.apiKey) {
        return { ok: false, code: 'NO_DIRECT_KEY', error: '手机辅助 DeepSeek API 密钥尚未配置，请填入密钥或切换至本地免 API / 云端 API。' };
      }
      const targetUrl = cfg.baseUrl || 'https://api.deepseek.com/v1/chat/completions';
      const targetModel = cfg.model || 'deepseek-chat';
      const baseMessages = buildPlanningPromptMessages(task, screenNodes, history, screenSize, installedApps);

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
              '刚才未返回合法 JSON 动作指令。请严格只输出一个合法 JSON 对象（不要任何 Markdown 或解释文字）。若连续等待后界面无新控件，请返回 click/swipe 或 ask_user。'
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
        // 直连网络或解析均受阻时自动回退服务端代理并传入个人 Key
        const proxyRes = await apiPostJson(
          '/api/phone-agent/plan',
          {
            task,
            screenNodes,
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
        screenNodes,
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

  function dispatchNativePlanAction(plan, latestNodes) {
    const b = getBridge();
    const act = plan?.action;
    const p = plan?.params || {};

    if (!isNativeApk() || !b) {
      return { executed: false, simulated: true, text: '网页预览模式已推演该动作（安装随身版 APK 后可在真机自动执行）' };
    }

    const a11yOk = Boolean(b.isAccessibilityEnabled && b.isAccessibilityEnabled());
    if (!a11yOk && act !== 'launch_app' && act !== 'wait' && act !== 'done' && act !== 'ask_user') {
      return { executed: false, error: true, text: '系统无障碍权限尚未开启，请先点上方状态栏开启无障碍服务' };
    }

    try {
      if (act === 'launch_app') {
        const appName = String(p.appName || '').trim();
        if (typeof b.launchAppByName === 'function') {
          const ok = b.launchAppByName(appName);
          return ok
            ? { executed: true, text: `已通过系统启动器打开「${appName}」` }
            : { executed: false, error: true, text: `未能匹配或拉起应用「${appName}」` };
        }
        const msg = String(b.executeLocalRule(`打开 ${appName}`) || '');
        const okFallback = isLocalRuleSucceeded(msg);
        return { executed: okFallback, error: !okFallback, text: msg || `尝试打开「${appName}」` };
      }
      if (act === 'click_node') {
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
          : { executed: false, error: true, text: `当前界面未找到控件「${targetText}」` };
      }
      if (act === 'click') {
        const x = Number(p.x) || 540;
        const y = Number(p.y) || 1200;
        const ok = b.dispatchClick(x, y);
        return { executed: Boolean(ok), error: !ok, text: ok ? `已点击坐标 (${x}, ${y})` : '坐标点击派发失败' };
      }
      if (act === 'long_click') {
        const x = Number(p.x) || 540;
        const y = Number(p.y) || 1200;
        const ok = typeof b.dispatchLongClick === 'function' ? b.dispatchLongClick(x, y, 600) : b.dispatchClick(x, y);
        return { executed: Boolean(ok), error: !ok, text: ok ? `已长按坐标 (${x}, ${y})` : '长按派发失败' };
      }
      if (act === 'swipe') {
        const x1 = Number(p.x1) || 540;
        const y1 = Number(p.y1) || 1650;
        const x2 = Number(p.x2) || 540;
        const y2 = Number(p.y2) || 650;
        const dur = Number(p.duration) || 380;
        const ok = b.dispatchSwipe(x1, y1, x2, y2, dur);
        return { executed: Boolean(ok), error: !ok, text: ok ? `已执行滑动 (${x1},${y1} -> ${x2},${y2})` : '滑动派发失败' };
      }
      if (act === 'input') {
        const txt = String(p.text || '');
        const viewId = String(p.viewId || '');
        const shouldAutoSubmit = Boolean(p.autoSubmit || p.submit || /发送|提交|回复|评论/i.test(p.actionDesc || '') || /发送|提交|回复|评论/i.test(txt));
        const ok = typeof b.dispatchSmartInput === 'function'
          ? b.dispatchSmartInput(txt, false, shouldAutoSubmit)
          : b.dispatchInputText(viewId, txt);
        return {
          executed: Boolean(ok),
          error: !ok,
          text: ok ? (shouldAutoSubmit ? `已向输入框打字并自动点击发送「${txt}」` : `已向输入框填入文本`) : '未能定位到可编辑输入框'
        };
      }
      if (act === 'home' || act === 'back' || act === 'recents') {
        const ok = b.dispatchGlobalAction(act);
        return { executed: Boolean(ok), error: !ok, text: ok ? `已执行全局系统键 (${act})` : `全局键 ${act} 执行失败` };
      }
      if (act === 'wait') {
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

    if (/^(回桌面|桌面|主页|home|返回|后退|上一页|back|最近任务|多任务|后台|切回上个应用|上个应用|切上个app|切换应用|下拉通知|通知栏|通知|控制中心|快捷设置|快捷开关|截屏|截图|屏幕截图|锁屏|息屏|电源菜单|音量\+|音量-|音量加|音量减|调大音量|调小音量|增大音量|降低音量|静音|取消静音|切换静音|下一首|下一首歌|切歌|上一首|上一首歌|暂停音乐|播放音乐|继续播放|读屏幕|读取屏幕|查看屏幕|点中间|点击中间)$/i.test(clean)) {
      return true;
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

    // 1. 先交由原生丰富离线规则引擎处理（支持组合宏、刷视频、智能打字、搜索、音量、截屏、35+应用等）
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

    if (native && b && typeof b.resetEmergencyStop === 'function') {
      try {
        b.resetEmergencyStop();
      } catch {}
    }

    if (cardCtx.stopBtn) {
      cardCtx.stopBtn.disabled = false;
      cardCtx.stopBtn.textContent = '停止';
      cardCtx.stopBtn.onclick = () => {
        emergencyStopRequested = true;
        try {
          activeAbortController.abort();
        } catch {}
        if (native && b && typeof b.stopAutoSwipeVideos === 'function') {
          try {
            b.stopAutoSwipeVideos();
          } catch {}
        }
        if (cardCtx.stopBtn) {
          cardCtx.stopBtn.disabled = true;
          cardCtx.stopBtn.textContent = '已停止';
        }
        if (native && b && typeof b.updateFloatState === 'function') {
          try {
            b.updateFloatState('idle', '星语 AI');
          } catch {}
        }
        syncStatus();
      };
    }

    // 分支 A：本地免 API 模式，或 API 模式下整句 100% 命中内置离线原子指令时直达本地极速引擎
    const matchedOffline = isSimpleBuiltInLocalCmd(taskText);
    const shouldTryFullLocal = !isResuming && (execMode === 'local' || matchedOffline);
    if (shouldTryFullLocal) {
      if (!native) {
        if (matchedOffline) {
          addStepItem(
            cardCtx.stepsList,
            1,
            '命中本地离线指令库',
            '网页预览环境模拟执行（免 API Key）',
            simulateWebLocalPreview(taskText),
            false
          );
        } else {
          addStepItem(
            cardCtx.stepsList,
            1,
            '超出固定离线口令范围',
            '该任务包含复杂动态语义，建议切换至「DeepSeek API / 云端 API」进行多步识屏规划。',
            '也可点击下方按钮切换引擎重试',
            true
          );
          showInlineFixBox(
            cardCtx.fixSlot,
            '复杂多步任务需要大模型识屏规划，可切换至 API 引擎继续：',
            (nextMode) => runReActLoop(taskText, cardCtx, nextMode)
          );
        }
        if (cardCtx.stopBtn) cardCtx.stopBtn.classList.add('hidden');
        return;
      }

      const res = tryExecuteLocalQuickCommand(taskText);
      if (res.handled) {
        addStepItem(cardCtx.stepsList, 1, taskText, '命中本地离线指令库 · 免 API 毫秒级直控', res.summary, false);
        appendNativeConsoleLog(`本地执行成功: ${taskText} -> ${res.summary}`);
        // 若启动了自动连刷视频，保留卡片上的「停止连刷」按钮以便一键叫停
        if (isNativeAutoSwiping() && cardCtx.stopBtn) {
          cardCtx.stopBtn.classList.remove('hidden');
          cardCtx.stopBtn.textContent = '停止连刷';
        } else if (cardCtx.stopBtn) {
          cardCtx.stopBtn.classList.add('hidden');
        }
        syncStatus();
        return;
      }

      if (execMode === 'local') {
        addStepItem(
          cardCtx.stepsList,
          1,
          '本地离线口令未匹配',
          '支持口令：自动刷视频、下一个视频、双击点赞、打字 [内容]、输入并发送 [内容]、搜索 [词]、打开 [应用]、点击 [文字]、截屏、下滑3次，或用“然后”串联多步。',
          '更复杂的跨应用推理任务可切换 API 模式自动识屏规划',
          true
        );
        showInlineFixBox(
          cardCtx.fixSlot,
          '该任务超出本地离线口令范围，是否切换为 API 智能识屏规划？',
          (nextMode) => runReActLoop(taskText, cardCtx, nextMode)
        );
        if (cardCtx.stopBtn) cardCtx.stopBtn.classList.add('hidden');
        return;
      }
    }

    // 分支 B：API 智能多步 ReAct 循环（api_direct 或 api_cloud）
    const MAX_STEPS = 12;
    const history = isResuming ? resumeOpts.history.slice() : [];
    const screenSize = getScreenSizeObj();
    const installedApps = getInstalledAppsList();
    let roundAutoApproved =
      resumeOpts && typeof resumeOpts.roundAutoApproved === 'boolean'
        ? resumeOpts.roundAutoApproved
        : getDirectConfig().autoApprove;
    let startStep = isResuming && Number(resumeOpts.startStep) > 0 ? Number(resumeOpts.startStep) : 1;

    // 混合接力加速：API 模式下若复合任务可拆分为“本地原子首步 + 复杂后续步骤”，
    // 先由本地引擎毫秒级执行首步并记入 history，再由大模型读取新界面接管全部后续步骤（绝不截断！）
    if (!isResuming && execMode !== 'local' && native && !matchedOffline) {
      const steps = splitCompoundTaskSteps(taskText);
      if (steps.length >= 2 && isAtomicBuiltInLocalCmd(steps[0])) {
        const firstStepCmd = steps[0];
        const firstRes = tryExecuteLocalQuickCommand(firstStepCmd);
        if (firstRes.handled) {
          addStepItem(
            cardCtx.stepsList,
            1,
            `本地直控加速 · ${firstStepCmd}`,
            '已完成前置本地动作，后续交由大模型识屏规划推进',
            firstRes.summary,
            false
          );
          appendNativeConsoleLog(`混合接力前置步完成: ${firstStepCmd} -> ${firstRes.summary}`);
          history.push({
            step: 1,
            action: 'local_quick',
            summary: firstStepCmd,
            result: firstRes.summary
          });
          startStep = 2;
          const waitMs = /^(?:打开|启动|进入|运行)/.test(firstStepCmd) ? 1600 : 700;
          await sleep(waitMs);
        }
      }
    }

    for (let step = startStep; step <= MAX_STEPS; step++) {
      if (signal.aborted || emergencyStopRequested) {
        addStepItem(cardCtx.stepsList, step, '任务中止', '', '用户已停止执行', true);
        break;
      }
      if (native && b && typeof b.isEmergencyStopRequested === 'function' && b.isEmergencyStopRequested()) {
        b.resetEmergencyStop();
        addStepItem(cardCtx.stepsList, step, '悬浮球急停触发', '', '已按最高安全优先停止后续操作', true);
        break;
      }

      if (native && b && typeof b.updateFloatState === 'function') {
        try {
          b.updateFloatState('thinking', `第 ${step} 步 AI 规划中...`);
        } catch {}
      }

      const nodes = readScreenNodes();
      const pendingStepEl = addStepItem(
        cardCtx.stepsList,
        step,
        '读取屏幕并请求决策',
        native ? `已采集当前屏幕 ${nodes.length} 个界面节点` : '网页端逻辑推演规划中',
        '等待大模型下发下一步动作...'
      );

      let planResp;
      try {
        planResp = await requestPlanStep({
          execMode,
          task: taskText,
          screenNodes: nodes,
          history,
          screenSize,
          installedApps,
          signal
        });
      } catch (err) {
        if (err?.name === 'AbortError' || signal.aborted) {
          updateStepResult(pendingStepEl, '请求已取消', true);
          break;
        }
        updateStepResult(pendingStepEl, `规划网络异常: ${err?.message || err}`, true);
        break;
      }

      if (!planResp.ok || !planResp.plan) {
        updateStepResult(pendingStepEl, planResp.error || '未能获取有效规划指令', true);
        showInlineFixBox(cardCtx.fixSlot, planResp, {
          onRetryWithMode: (nextMode) =>
            runReActLoop(
              taskText,
              cardCtx,
              nextMode,
              nextMode === 'local' ? null : { history, startStep: step, roundAutoApproved }
            ),
          onRetryStep: () =>
            runReActLoop(taskText, cardCtx, execMode, {
              history,
              startStep: step,
              roundAutoApproved
            })
        });
        break;
      }

      const plan = planResp.plan;
      const topSpan = pendingStepEl?.querySelector('.pa-step-top span');
      if (topSpan) topSpan.textContent = `第 ${step} 步 · ${plan.summary || plan.action}`;
      const thoughtEl = pendingStepEl?.querySelector('.pa-step-thought');
      if (thoughtEl && plan.thought) thoughtEl.textContent = plan.thought;

      if (plan.action === 'done') {
        const doneMsg = plan.params?.message || plan.summary || '全部任务步骤已顺利完成';
        updateStepResult(pendingStepEl, doneMsg, false);
        appendNativeConsoleLog(`AI 任务完成: ${doneMsg}`);
        break;
      }

      if (plan.action === 'ask_user') {
        const askMsg = plan.params?.message || plan.summary || '请手动完成当前页面确认后再继续';
        updateStepResult(pendingStepEl, `等待人工介入：${askMsg}`, false);
        break;
      }

      const needsConfirm = plan.action !== 'wait' && (!roundAutoApproved || plan.needConfirm);
      if (needsConfirm) {
        updateStepResult(pendingStepEl, '等待用户安全确认...', false);
        const decision = await askStepConfirmCard(cardCtx.confirmSlot, plan, signal);
        if (decision === 'cancel') {
          updateStepResult(pendingStepEl, '用户取消该动作，任务结束', true);
          break;
        }
        if (decision === 'auto') {
          roundAutoApproved = true;
        }
      }

      if (native && b && typeof b.updateFloatState === 'function') {
        try {
          b.updateFloatState('acting', plan.summary || '执行动作中...');
        } catch {}
      }

      const execRes = dispatchNativePlanAction(plan, nodes);
      updateStepResult(pendingStepEl, execRes.text, Boolean(execRes.error));
      appendNativeConsoleLog(`第${step}步 [${plan.action}]: ${execRes.text}`);

      history.push({
        step,
        action: plan.action,
        summary: plan.summary,
        result: execRes.text
      });

      if (!native) {
        addStepItem(
          cardCtx.stepsList,
          step + 1,
          '网页端规划演示完成',
          '当前环境未连接真机无障碍界面',
          '安装安卓随身版 APK 并授权后，将继续多步循环直至完成整个任务。',
          false
        );
        break;
      }

      const waitTime = plan.action === 'wait' ? Math.min(3500, Math.max(400, Number(plan.params?.ms) || 1000)) : 800;
      await sleep(waitTime);
    }

    if (native && b && typeof b.updateFloatState === 'function' && !isNativeAutoSwiping()) {
      try {
        b.updateFloatState('idle', '星语 AI');
      } catch {}
    }
    if (cardCtx.stopBtn && !isNativeAutoSwiping()) {
      cardCtx.stopBtn.classList.add('hidden');
    }
    syncStatus();
  }

  async function executeTaskInChat(taskText) {
    const clean = String(taskText || '').trim();
    if (!clean) return;

    // 确保处于手机辅助模式
    const shell = document.getElementById('app-shell');
    if (shell && shell.dataset.uiMode !== 'phone-agent') {
      document.getElementById('ws-mode-phone-agent')?.click();
    }
    const mode = getExecMode();
    recordTaskHistory(clean, mode);
    appendUserMessageRow(clean);
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
    const cardCtx = createAgentCardRow('读取当前屏幕界面无障碍节点', getExecMode());
    if (!cardCtx) return;
    const nodes = readScreenNodes();
    const sz = getScreenSizeObj();
    const sample = nodes
      .filter((n) => n.text || n.desc)
      .slice(0, 12)
      .map((n) => n.text || n.desc)
      .join(' / ');
    addStepItem(
      cardCtx.stepsList,
      1,
      `已捕获 ${nodes.length} 个界面控件（${sz.width}×${sz.height}）`,
      sample ? `可见关键元素：${sample}` : '当前窗口主要为图标或自绘视图',
      '屏幕上下文已就绪，可直接下达下一步操作任务',
      false
    );
    cardCtx.stopBtn?.classList.add('hidden');
  }

  // 接收来自原生悬浮窗「交给星语 AI 规划」传回的任务
  window.__receiveFloatAgentTask = (taskText) => {
    const clean = String(taskText || '').trim();
    const shell = document.getElementById('app-shell');
    if (shell && shell.dataset.uiMode !== 'phone-agent') {
      document.getElementById('ws-mode-phone-agent')?.click();
    }
    if (!clean) {
      showToast('已回到星语手机辅助工作台');
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
      const nextVal = !getDirectConfig().autoApprove;
      setAutoApprove(nextVal);
      showToast(
        nextVal
          ? '已开启 dsh-Go 免确认自动执行'
          : '已切换为逐步安全确认模式'
      );
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

      const cleanupPaAudioStream = () => {
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
        if (span) span.textContent = recording ? '正在倾听…' : '语音';
        paVoiceBtn.title = recording ? '正在倾听…点击完成语音输入' : '语音输入口令（点击开始说话，再次点击完成）';
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
          showToast('正在倾听…说出你想执行的口令，说完了再次点击此按钮');
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

/* ==========================================================================
   Phone Agent 手机端 AI 辅助助理与 dsh-Go 规划循环模块 (v1.9.0)
   1. 对齐 myui 极简规范与零 Emoji 标准，支持 DeepSeek 直连 / 云端 API / 本地免 API 三档切换
   2. 实现真实 ReAct 多步屏幕节点感知与 dsh-Go 操作安全确认卡 (允许本次 / 本轮放行 / 取消)
   3. 统一在设置页与更新卡呈现版本状态，不向主顶栏暴露多余版本号标签
   ========================================================================== */

(() => {
  const CURRENT_APK_VERSION = '1.9.0';
  const CURRENT_APK_CODE = 120;
  const GITHUB_RELEASES_URL = 'https://github.com/ccch1mneyyy/dsh-Go/releases';

  const STORAGE_KEYS = {
    execMode: 'pa_exec_mode_v1',
    directModel: 'pa_direct_model_v1',
    directBaseUrl: 'pa_direct_baseurl_v1',
    autoApprove: 'pa_auto_approve_v1',
    keyPrimary: 'deepseek_user_api_key',
    keyFallback: 'own_deepseek_api_key'
  };

  let installedAppsCache = null;
  let activeAbortController = null;
  let emergencyStopRequested = false;

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
    if (isNativeApk() && typeof getBridge().showToast === 'function' && String(msg || '').length < 48) {
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
    return 'api_direct';
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
        localStorage.setItem(STORAGE_KEYS.keyPrimary, clean);
        localStorage.setItem(STORAGE_KEYS.keyFallback, clean);
      } else {
        localStorage.removeItem(STORAGE_KEYS.keyPrimary);
        localStorage.removeItem(STORAGE_KEYS.keyFallback);
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
      let ver = CURRENT_APK_VERSION;
      try {
        if (typeof b.getAppVersion === 'function') ver = b.getAppVersion() || ver;
      } catch {}
      const verBadge = $('anv-current-version');
      if (verBadge) verBadge.textContent = `v${String(ver).replace(/^v/i, '')} (已就绪)`;

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
        floatTag.textContent = floatOn ? '悬浮球运行中' : '悬浮球已停用';
      }
      const toggleFloatBtn = $('pa-toggle-float-btn');
      if (toggleFloatBtn) {
        toggleFloatBtn.textContent = floatOn ? '停用悬浮控制球' : '开启常驻悬浮控制球';
      }
    }
  }

  function syncStatus() {
    const mode = getExecMode();
    const cfg = getDirectConfig();
    const native = isNativeApk();
    const b = getBridge();

    // 1. 引擎分段按钮选中态
    document.querySelectorAll('#phone-agent-banner .pa-seg-btn').forEach((btn) => {
      const active = btn.dataset.paMode === mode;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', String(active));
    });

    // 2. 同步配置抽屉表单默认值
    const keyInp = $('pa-cfg-apikey');
    if (keyInp && !keyInp.matches(':focus')) keyInp.value = cfg.apiKey;
    const modelSel = $('pa-cfg-model');
    if (modelSel && !modelSel.matches(':focus')) modelSel.value = cfg.model || 'deepseek-chat';
    const urlInp = $('pa-cfg-baseurl');
    if (urlInp && !urlInp.matches(':focus')) urlInp.value = cfg.baseUrl || '';
    const autoChk = $('pa-cfg-auto-approve');
    if (autoChk) autoChk.checked = Boolean(cfg.autoApprove);

    // 3. 同步三个状态圆点胶囊 (#pa-banner-a11y-chip / #pa-banner-float-chip / #pa-banner-confirm-chip)
    let a11yOk = false;
    let floatOn = false;
    if (native && b) {
      try {
        a11yOk = Boolean(b.isAccessibilityEnabled && b.isAccessibilityEnabled());
        floatOn = Boolean(b.isFloatAgentRunning && b.isFloatAgentRunning());
      } catch {}
    }

    const a11yChip = $('pa-banner-a11y-chip');
    const a11yText = $('pa-banner-a11y-text');
    if (a11yChip && a11yText) {
      a11yChip.classList.remove('active', 'pending', 'disabled');
      if (!native) {
        a11yChip.classList.add('disabled');
        a11yText.textContent = '网页规划演示';
      } else if (a11yOk) {
        a11yChip.classList.add('active');
        a11yText.textContent = '无障碍已授权';
      } else {
        a11yChip.classList.add('pending');
        a11yText.textContent = '无障碍未授权';
      }
    }

    const floatChip = $('pa-banner-float-chip');
    const floatText = $('pa-banner-float-text');
    const bannerFloatBtn = $('pa-banner-toggle-float-btn');
    if (floatChip && floatText) {
      floatChip.classList.remove('active', 'pending', 'disabled');
      if (!native) {
        floatChip.classList.add('disabled');
        floatText.textContent = '原生可用';
      } else if (floatOn) {
        floatChip.classList.add('active');
        floatText.textContent = '悬浮球运行中';
      } else {
        floatChip.classList.add('disabled');
        floatText.textContent = '悬浮球未启用';
      }
    }
    if (bannerFloatBtn) {
      bannerFloatBtn.textContent = floatOn ? '停用悬浮球' : '悬浮球';
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
        confirmText.textContent = '需确认执行';
      }
    }

    // 4. 同步全屏设置副文本（如有显示）
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
      });
    }
  }

  function appendUserMessageRow(text) {
    const container = $('messages-container');
    if (!container) return;
    document.querySelector('.chat-stage')?.classList.remove('ds-empty-mode');

    const row = document.createElement('div');
    row.className = 'msg-row user';

    const wrap = document.createElement('div');
    wrap.className = 'user-msg-wrap';

    const bodyEl = document.createElement('div');
    bodyEl.className = 'msg-body';
    bodyEl.textContent = String(text || '');

    wrap.appendChild(bodyEl);
    row.appendChild(wrap);
    container.appendChild(row);
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
          <span>手机辅助规划 · dsh-Go</span>
        </div>
        <div style="display:flex;align-items:center;gap:6px;">
          <span class="pa-engine-badge">${escapeHtml(getEngineLabel(execMode))}</span>
          <button type="button" class="pa-banner-btn subtle pa-card-stop-btn" style="padding:3px 9px;font-size:11px;">停止</button>
        </div>
      </div>
      <div class="pa-task-echo" style="font-size:12.5px;color:light-dark(#475569,#94a3b8);">任务目标：${escapeHtml(taskText)}</div>
      <div class="pa-steps-list"></div>
      <div class="pa-confirm-slot"></div>
      <div class="pa-fix-slot"></div>
    `;

    bodyEl.appendChild(card);
    row.appendChild(avatarEl);
    row.appendChild(bodyEl);
    container.appendChild(row);
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

  function askStepConfirmCard(confirmSlot, plan, signal) {
    if (!confirmSlot) return Promise.resolve('allow');
    return new Promise((resolve) => {
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
        confirmSlot.innerHTML = '';
        resolve('cancel');
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
          confirmSlot.innerHTML = '';
          resolve(d);
        });
      });
    });
  }

  function showInlineFixBox(fixSlot, messageText, onRetryWithMode) {
    if (!fixSlot) return;
    fixSlot.innerHTML = `
      <div class="pa-inline-fix-box">
        <div>${escapeHtml(messageText)}</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
          <input type="password" class="pa-cfg-input pa-fix-key-inp" placeholder="输入 DeepSeek API Key (sk-...)" style="flex:1 1 180px;height:32px;" />
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
      '你必须仅返回一个合法 JSON 对象（不要用 Markdown 代码块包裹），字段定义：',
      '{"thought":"简短中文判断(<=35字)","action":"launch_app|click_node|click|long_click|swipe|input|home|back|recents|wait|done|ask_user","params":{},"summary":"本步中文说明(<=25字)","needConfirm":false}',
      '常用 action 的 params：',
      'launch_app:{"appName":"微信"} / click_node:{"text":"发送","viewId":""} / click:{"x":540,"y":1200} / long_click:{"x":540,"y":1200} / swipe:{"x1":540,"y1":1600,"x2":540,"y2":600,"duration":350} / input:{"text":"你好","viewId":""} / wait:{"ms":1000} / done:{"message":"完成"} / ask_user:{"message":"请补充信息"}。',
      '打开应用优先使用 launch_app；付款、转账、下单、删除、卸载、发消息等高风险步骤必须设置 needConfirm=true。'
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
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
    try {
      return JSON.parse(cleaned);
    } catch {
      const s = cleaned.indexOf('{');
      const e = cleaned.lastIndexOf('}');
      if (s >= 0 && e > s) {
        return JSON.parse(cleaned.slice(s, e + 1));
      }
      throw new Error('模型响应未返回合法 JSON 动作指令');
    }
  }

  async function requestPlanStep({ execMode, task, screenNodes, history, screenSize, installedApps, signal }) {
    const cfg = getDirectConfig();
    if (execMode === 'api_direct') {
      if (!cfg.apiKey) {
        return { ok: false, code: 'NO_DIRECT_KEY', error: '个人 DeepSeek API 密钥尚未配置，请在上方填入密钥或切换至云端 API。' };
      }
      const targetUrl = cfg.baseUrl || 'https://api.deepseek.com/v1/chat/completions';
      const targetModel = cfg.model || 'deepseek-chat';
      const messages = buildPlanningPromptMessages(task, screenNodes, history, screenSize, installedApps);

      // 优先由客户端沙盒直连；如遇浏览器/WebView CORS 或 TLS 代理阻断，则经本地托管网关安全透传（不落盘）
      try {
        const directBody = {
          model: targetModel,
          messages,
          temperature: 0.15,
          max_tokens: 600,
          stream: false
        };
        if (targetUrl.includes('deepseek.com') || /deepseek/i.test(targetModel)) {
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
          return {
            ok: false,
            code: 'DIRECT_HTTP_ERROR',
            error: `直连 DeepSeek 返回 (${directRes.status}): ${txt.slice(0, 120)}`
          };
        }
        const json = await directRes.json();
        const content = json?.choices?.[0]?.message?.content || '';
        const plan = extractJsonFromText(content);
        return { ok: true, plan, model: targetModel, engine: 'api_direct' };
      } catch (directErr) {
        if (directErr?.name === 'AbortError') throw directErr;
        // CORS / 网络受限自动透传后端代理（Key 仅当前请求透传）
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
          code: proxyRes.data?.code || 'PROXY_FAILED',
          error: proxyRes.data?.error || directErr?.message || 'DeepSeek API 请求失败'
        };
      }
    }

    // 云端 API 模式
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
      return { executed: false, error: true, text: '系统无障碍权限尚未开启，请先点上方「无障碍未授权」去开启服务' };
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
        const ok = b.dispatchInputText(viewId, txt);
        return { executed: Boolean(ok), error: !ok, text: ok ? `已向输入框填入文本` : '未能定位到可编辑输入框' };
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

  function tryExecuteLocalQuickCommand(cmdText) {
    const clean = String(cmdText || '').trim();
    if (!isNativeApk()) {
      return { handled: false, reason: 'not_native' };
    }
    const b = getBridge();
    if (!b) return { handled: false, reason: 'no_bridge' };

    // 1. 若明确是「打开 XXX」且原生支持动态应用匹配，优先拉起全量已安装应用
    const openMatch = clean.match(/^(?:打开|启动|进入|运行)\s*(.+)$/);
    if (openMatch && typeof b.launchAppByName === 'function') {
      const appName = openMatch[1].trim();
      const ok = b.launchAppByName(appName);
      if (ok) return { handled: true, summary: `已为您直接拉起「${appName}」` };
    }

    // 2. 执行原生本地指令集（全局系统键、滑动手势、点击文字、输入框填字）
    if (typeof b.executeLocalRule === 'function') {
      const msg = String(b.executeLocalRule(clean) || '');
      if (isLocalRuleSucceeded(msg)) {
        return { handled: true, summary: msg.replace(/^UNMATCHED:/, '') };
      }
    }

    // 3. 兜底识别「点击 XXX」
    const clickMatch = clean.match(/^(?:点击|点一下|按)\s*(.+)$/);
    if (clickMatch && typeof b.clickByText === 'function') {
      const target = clickMatch[1].trim();
      const ok = b.clickByText(target);
      if (ok) return { handled: true, summary: `已点击屏幕上「${target}」` };
    }
    return { handled: false, reason: 'unmatched' };
  }

  function isSimpleBuiltInLocalCmd(text) {
    return /^(回桌面|桌面|返回|后退|下滑|向下|上滑|向上|左滑|右滑|最近任务|多任务|下拉通知|通知栏|打开微信|微信|打开设置|设置)$/.test(
      String(text || '').trim()
    );
  }

  async function runReActLoop(taskText, cardCtx, overrideMode = null) {
    const execMode = overrideMode || getExecMode();
    const b = getBridge();
    const native = isNativeApk();

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
        if (cardCtx.stopBtn) {
          cardCtx.stopBtn.disabled = true;
          cardCtx.stopBtn.textContent = '已停止';
        }
        if (native && b && typeof b.updateFloatState === 'function') {
          try {
            b.updateFloatState('idle', '任务已手动中止');
          } catch {}
        }
      };
    }

    // 分支 A：本地免 API 模式，或者明确点击内置无参手势快捷按钮时直达本地极速引擎
    if (execMode === 'local' || isSimpleBuiltInLocalCmd(taskText)) {
      if (!native) {
        addStepItem(
          cardCtx.stepsList,
          1,
          '本地口令检测',
          '当前处于浏览器环境，无法直接触达手机无障碍服务。',
          '请在安卓设备上安装星语随身版 APK，或在上方切换「DeepSeek API」进行云端规划推演。',
          false
        );
        if (cardCtx.stopBtn) cardCtx.stopBtn.classList.add('hidden');
        return;
      }
      const res = tryExecuteLocalQuickCommand(taskText);
      if (res.handled) {
        addStepItem(cardCtx.stepsList, 1, taskText, '命中本地离线指令库，毫秒级直控', res.summary, false);
        appendNativeConsoleLog(`本地执行成功: ${taskText}`);
        if (cardCtx.stopBtn) cardCtx.stopBtn.classList.add('hidden');
        return;
      }
      if (execMode === 'local') {
        addStepItem(
          cardCtx.stepsList,
          1,
          '本地口令未匹配',
          '「本地免 API」仅支持固定手势与「打开 应用名 / 点击 文字 / 输入 内容」。',
          '复杂多步任务需要大模型识屏决策',
          true
        );
        showInlineFixBox(
          cardCtx.fixSlot,
          '该复杂任务超出本地固定口令范围，建议立即切换为 API 智能规划：',
          (nextMode) => runReActLoop(taskText, cardCtx, nextMode)
        );
        if (cardCtx.stopBtn) cardCtx.stopBtn.classList.add('hidden');
        return;
      }
    }

    // 分支 B：API 智能多步 ReAct 循环（api_direct 或 api_cloud）
    const MAX_STEPS = 12;
    const history = [];
    const screenSize = getScreenSizeObj();
    const installedApps = getInstalledAppsList();
    let roundAutoApproved = getDirectConfig().autoApprove;

    for (let step = 1; step <= MAX_STEPS; step++) {
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
        showInlineFixBox(
          cardCtx.fixSlot,
          planResp.error || '当前 API 不可用，您可以填入密钥或切换引擎后继续：',
          (nextMode) => runReActLoop(taskText, cardCtx, nextMode)
        );
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

      // dsh-Go 安全确认关口：非 wait 动作在未开启免确认模式时，弹窗请求人工确认
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

      // 网页端单次演示推演完成后即止，防止无意义的真机死循环
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

    if (native && b && typeof b.updateFloatState === 'function') {
      try {
        b.updateFloatState('idle', '待命');
      } catch {}
    }
    if (cardCtx.stopBtn) {
      cardCtx.stopBtn.classList.add('hidden');
    }
  }

  async function executeTaskInChat(taskText) {
    const clean = String(taskText || '').trim();
    if (!clean) return;
    appendUserMessageRow(clean);
    const mode = getExecMode();
    const cardCtx = createAgentCardRow(clean, mode);
    if (!cardCtx) return;
    await runReActLoop(clean, cardCtx, mode);
  }

  function inspectScreenInChat() {
    const native = isNativeApk();
    const cardCtx = createAgentCardRow('读取当前屏幕界面无障碍节点', getExecMode());
    if (!cardCtx) return;
    if (!native) {
      addStepItem(
        cardCtx.stepsList,
        1,
        '非原生 APK 环境',
        '浏览器无法读取系统桌面或其他应用屏幕控件。',
        '请在 Android 手机安装随身版 APK 并开启无障碍权限后点击「读取屏幕」。',
        false
      );
      cardCtx.stopBtn?.classList.add('hidden');
      return;
    }
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

  async function checkUpdate(silent = false) {
    const titleEl = $('anv-status-title');
    const subEl = $('anv-status-sub');
    const boxEl = $('anv-update-status-box');
    const isNative = isNativeApk();
    let localVer = CURRENT_APK_VERSION;
    if (isNative && typeof getBridge().getAppVersion === 'function') {
      try {
        localVer = getBridge().getAppVersion() || CURRENT_APK_VERSION;
      } catch {}
    }

    try {
      const res = await fetch(`/api/app-version?t=${Date.now()}`, { credentials: 'same-origin' });
      const info = await res.json();
      if (!info || !info.latestVersion) throw new Error('版本信息解析异常');

      const hasNew = isNewerVersion(info.latestVersion, localVer);
      if (hasNew) {
        if (titleEl) titleEl.textContent = `发现新版本 v${info.latestVersion} (${info.fileSize || '安装包'})`;
        if (subEl) {
          const notes = Array.isArray(info.changelog) ? info.changelog[0] : '';
          subEl.textContent = notes || '建议立即升级以获取最新版界面与手机辅助功能。';
        }
        if (boxEl) boxEl.classList.add('has-update');
        if (!silent) {
          const go = confirm(`检测到新版本 v${info.latestVersion}！\n${(info.changelog || []).slice(0, 3).join('\n')}\n\n是否立即下载更新安装包？`);
          if (go) {
            window.open(info.downloadUrl || '/api/download/apk', '_blank');
          }
        }
      } else {
        if (titleEl) titleEl.textContent = `当前已是最新版本 (v${String(localVer).replace(/^v/i, '')})`;
        if (subEl) subEl.textContent = `已与云端发布版 v${info.latestVersion} 保持同步`;
        if (boxEl) boxEl.classList.remove('has-update');
        if (!silent) showToast(`当前已是最新版本 v${String(localVer).replace(/^v/i, '')}`);
      }
      return info;
    } catch (err) {
      if (!silent) showToast(`检查更新失败：${err?.message || '请稍后再试'}`);
      return null;
    }
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

  function bindUiEvents() {
    // 1. 引擎分段切换 (#pa-mode-api-direct / #pa-mode-api-cloud / #pa-mode-local)
    document.querySelectorAll('#phone-agent-banner .pa-seg-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.paMode;
        setExecMode(mode);
        const cfg = getDirectConfig();
        if (mode === 'api_direct' && !cfg.apiKey) {
          const drawer = $('pa-inline-config-drawer');
          const toggle = $('pa-cfg-toggle-btn');
          if (drawer) drawer.classList.remove('hidden');
          if (toggle) toggle.setAttribute('aria-expanded', 'true');
          $('pa-cfg-apikey')?.focus();
          showToast('已切换到 DeepSeek API 直连，请先填入密钥并保存');
        } else {
          showToast(`手机辅助已切换至「${getEngineLabel(mode)}」`);
        }
      });
    });

    // 2. 配置抽屉展开/收起 (#pa-cfg-toggle-btn)
    $('pa-cfg-toggle-btn')?.addEventListener('click', () => {
      const drawer = $('pa-inline-config-drawer');
      const btn = $('pa-cfg-toggle-btn');
      if (!drawer) return;
      const isHidden = drawer.classList.toggle('hidden');
      if (btn) btn.setAttribute('aria-expanded', String(!isHidden));
      if (!isHidden) {
        const cfg = getDirectConfig();
        if ($('pa-cfg-apikey')) $('pa-cfg-apikey').value = cfg.apiKey;
        if ($('pa-cfg-model')) $('pa-cfg-model').value = cfg.model;
        if ($('pa-cfg-baseurl')) $('pa-cfg-baseurl').value = cfg.baseUrl;
        if ($('pa-cfg-auto-approve')) $('pa-cfg-auto-approve').checked = cfg.autoApprove;
      }
    });

    // 3. 配置保存应用 (#pa-cfg-save-btn)
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

      $('pa-inline-config-drawer')?.classList.add('hidden');
      $('pa-cfg-toggle-btn')?.setAttribute('aria-expanded', 'false');
      syncStatus();
      showToast('手机辅助 API 参数与确认策略已保存并生效');
    });

    // 4. 三大状态胶囊与右侧快捷按钮联动
    const handleOpenA11y = () => {
      if (!isNativeApk()) {
        showToast('当前为网页端：请先在安卓设备安装随身版 APK 后再开启无障碍服务');
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
    $('pa-banner-open-a11y-btn')?.addEventListener('click', handleOpenA11y);
    $('pa-open-a11y-btn')?.addEventListener('click', handleOpenA11y);

    const handleToggleFloat = () => {
      if (!isNativeApk()) {
        showToast('悬浮控球功能需在 Android 原生随身版 APK 中运行');
        openModal();
        return;
      }
      const b = getBridge();
      try {
        if (b.isFloatAgentRunning && b.isFloatAgentRunning()) {
          b.stopFloatAgent();
          showToast('已停用桌面悬浮控球');
        } else {
          if (b.hasOverlayPermission && !b.hasOverlayPermission()) {
            b.requestOverlayPermission();
            showToast('请先在系统设置允许「显示在其他应用上层」');
            return;
          }
          b.startFloatAgent();
          showToast('已开启桌面悬浮控制球');
        }
      } catch (e) {
        showToast(`操作悬浮球失败: ${e?.message || e}`);
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
          ? '已开启 dsh-Go 免确认自动执行（敏感高风险步仍建议留心）'
          : '已切换为逐步安全确认模式'
      );
    });

    // 5. 快捷指令芯片组 (#phone-agent-banner .pa-quick-chip)
    document.querySelectorAll('#phone-agent-banner .pa-quick-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        const cmd = chip.dataset.cmd || '';
        if (!cmd) return;
        if (cmd === '__inspect_screen__') {
          inspectScreenInChat();
        } else {
          executeTaskInChat(cmd);
        }
      });
    });

    // 6. 原生面板弹窗内的绑定 (#apk-download-modal)
    $('more-apk-download-btn')?.addEventListener('click', openModal);
    $('topbar-apk-download-btn')?.addEventListener('click', openModal);
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

    document.querySelectorAll('.pa-quick-test-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const cmd = btn.dataset.cmd || '';
        if (!cmd) return;
        const res = tryExecuteLocalQuickCommand(cmd);
        if (res.handled) {
          appendNativeConsoleLog(res.summary);
          showToast(res.summary);
        } else {
          appendNativeConsoleLog(`未命中本地直控或未在原生环境: ${cmd}`);
          showToast('请在原生环境打开无障碍后测试，或在手机辅助聊天页运行');
        }
      });
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
    bindUiEvents();
    syncStatus();
    // 原生 APK 启动时静默检查一次更新（仅同步最新标记，不打断操作）
    if (isNativeApk()) {
      setTimeout(() => checkUpdate(true), 2500);
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
    get isNative() {
      return isNativeApk();
    },
    getExecMode,
    setExecMode,
    setDirectApiKey,
    syncStatus,
    checkUpdate,
    executeTaskInChat,
    inspectScreenInChat,
    openModal,
    closeModal
  };
})();

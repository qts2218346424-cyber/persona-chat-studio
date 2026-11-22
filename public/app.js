(() => {
  let initialUiMode = 'deepseek';
  let initialScriptId = 'script_classic';
  try {
    const searchParams = new URLSearchParams(window.location.search);
    const qMode = searchParams.get('mode');
    const isDemoUrl = searchParams.get('demo') === '1' || searchParams.get('demo') === 'true';
    const savedMode = localStorage.getItem('ui_mode_v5');
    if (qMode === 'roleplay' || qMode === 'deepseek' || qMode === 'phone-agent') {
      initialUiMode = qMode;
    } else if (isDemoUrl) {
      initialUiMode = 'roleplay';
    } else if (savedMode === 'roleplay' || savedMode === 'deepseek' || savedMode === 'phone-agent') {
      initialUiMode = savedMode;
    }
    if (localStorage.getItem('simple_v6_upgraded') !== '1') {
      localStorage.setItem('simple_v6_upgraded', '1');
      localStorage.setItem('active_script_id', 'script_classic');
    } else {
      const savedSc = localStorage.getItem('active_script_id');
      if (savedSc) initialScriptId = savedSc;
    }
  } catch {}

  const state = {
    uiMode: initialUiMode, // 'roleplay' | 'deepseek' | 'phone-agent'
    scripts: [],
    activeScriptId: initialScriptId,
    squareItems: [],
    squareFilterType: 'all',
    workshopFocus: 'balanced',
    workshopFilename: '',
    workshopDraft: null,
    user: null,
    personas: [],
    sessions: [],
    settings: {},
    membership: {
      tier: 'free',
      card_type: 'none',
      tier_name: '普通旅人',
      online_credits: 0,
      points: 0,
      is_vip: false,
      has_active_card: false,
      can_use_online: false
    },
    wallet: null,
    selectedCashierProduct: null,
    adminDashboard: null,
    adminActiveTab: 'atab-overview',
    adminCodes: [],
    activeSessionId: null,
    activeSession: null,
    activePersona: null,
    messages: [],
    memories: [],
    lorebooks: [],
    recalledIds: new Set(),
    triggeredLoreIds: new Set(),
    nurturing: null,
    companion: null,
    telemetry: null,
    streamingAbort: null,
    isStreaming: false,
    pendingHistoryFile: null,
    pendingAttachments: [],
    dsBalance: null,
    lastSandboxCode: '',
    proactiveIdleCount: 0,
    lastInteractionAt: Date.now(),
    hasMoreMessages: false,
    totalMessages: 0,
    oldestMessageId: 0,
    appVersion: '2.0.2',
    tourIndex: 0,
    tourActive: false,
    llmMode: localStorage.getItem('user_llm_mode') || 'local_antigravity',
    localModel: localStorage.getItem('user_local_model') || 'DeepSeek-V4.1-Flash',
    antigravityStatus: { available: true, models: [], default_model: 'DeepSeek-V4.1-Flash', checked: false }
  };

  // ================= 会话内存 LRU 缓存与 0ms 首屏 SWR 本地快照引擎 =================
  const SESSION_CACHE_MAX = 15;
  const BOOT_SNAPSHOT_KEY = 'star_boot_snapshot_v1';
  const BOOT_SNAPSHOT_TTL_MS = 7 * 24 * 3600 * 1000;
  const sessionDetailCache = new Map();
  let userManualSessionSwitchAt = 0;
  let bootEnterStartedAt = 0;

  function setSessionCache(sessionId, payload) {
    if (!sessionId || !payload || !payload.session) return;
    if (sessionDetailCache.has(sessionId)) {
      sessionDetailCache.delete(sessionId);
    } else if (sessionDetailCache.size >= SESSION_CACHE_MAX) {
      const oldestKey = sessionDetailCache.keys().next().value;
      if (oldestKey) sessionDetailCache.delete(oldestKey);
    }
    sessionDetailCache.set(sessionId, {
      ...payload,
      cachedAt: Date.now()
    });
  }

  function getSessionCache(sessionId) {
    if (!sessionId) return null;
    const hit = sessionDetailCache.get(sessionId);
    if (!hit) return null;
    // LRU 刷新热度
    sessionDetailCache.delete(sessionId);
    sessionDetailCache.set(sessionId, hit);
    return hit;
  }

  function invalidateSessionCache(sessionId) {
    if (!sessionId) return;
    sessionDetailCache.delete(sessionId);
  }

  function syncActiveSessionToCache() {
    const sid = state.activeSessionId;
    if (!sid || !state.activeSession) return;
    setSessionCache(sid, {
      session: state.activeSession,
      persona: state.activePersona,
      messages: Array.isArray(state.messages) ? state.messages.slice() : [],
      has_more_messages: Boolean(state.hasMoreMessages),
      total_messages: Number(state.totalMessages || (state.messages || []).length),
      oldest_message_id: Number(state.oldestMessageId || state.messages?.[0]?.id || 0),
      memories: Array.isArray(state.memories) ? state.memories.slice() : [],
      lorebooks: Array.isArray(state.lorebooks) ? state.lorebooks.slice() : [],
      nurturing: state.nurturing,
      companion: state.companion,
      telemetry: state.telemetry,
      membership: state.membership
    });
  }

  function clearBootSnapshot() {
    try {
      localStorage.removeItem(BOOT_SNAPSHOT_KEY);
    } catch {}
  }

  function getPreferredSessionStorageKey(mode = state.uiMode) {
    return `last_active_session_${mode === 'deepseek' ? 'deepseek' : 'roleplay'}`;
  }

  function buildBootstrapQueryParams(checkAuth = false) {
    const qs = new URLSearchParams();
    qs.set('lite', '1');
    qs.set('msg_limit', '60');
    if (checkAuth) qs.set('check_auth', '1');
    if (state.uiMode) qs.set('ui_mode', state.uiMode);
    if (state.activeScriptId) qs.set('active_script_id', state.activeScriptId);
    try {
      const lastSid = localStorage.getItem(getPreferredSessionStorageKey(state.uiMode));
      if (lastSid) qs.set('preferred_session_id', lastSid);
    } catch {}
    return qs.toString();
  }

  function trimMessagesForSnapshot(msgs, maxCount) {
    return (Array.isArray(msgs) ? msgs : []).slice(-maxCount).map((m) => ({
      id: m.id,
      session_id: m.session_id,
      role: m.role,
      content: String(m.content || '').slice(0, 6000),
      reasoning: m.reasoning ? String(m.reasoning).slice(0, 2000) : '',
      duration_ms: m.duration_ms,
      recalled_count: m.recalled_count,
      meta: m.meta,
      created_at: m.created_at
    }));
  }

  function saveBootSnapshot() {
    try {
      if (!state.user || !state.user.id) return;
      const liteScripts = (state.scripts || []).map((sc) => ({
        id: sc.id,
        title: sc.title,
        subtitle: sc.subtitle,
        cover_emoji: sc.cover_emoji,
        genre: sc.genre,
        badge: sc.badge
      }));
      const litePersonas = (state.personas || []).map((p) => ({
        id: p.id,
        user_id: p.user_id,
        script_id: p.script_id,
        name: p.name,
        avatar: p.avatar,
        tagline: p.tagline,
        backstory: String(p.backstory || '').slice(0, 400),
        starter_prompts: Array.isArray(p.starter_prompts) ? p.starter_prompts.slice(0, 4) : []
      }));

      const buildSnapshotObj = (msgLimit) => {
        const initPayload = state.activeSession
          ? {
              session: state.activeSession,
              persona: state.activePersona,
              messages: trimMessagesForSnapshot(state.messages, msgLimit),
              total_messages: Number(state.totalMessages || (state.messages || []).length),
              has_more_messages:
                Boolean(state.hasMoreMessages) ||
                (Array.isArray(state.messages) && state.messages.length > msgLimit),
              oldest_message_id: Number(
                (Array.isArray(state.messages) && state.messages.length > msgLimit
                  ? state.messages[state.messages.length - msgLimit]?.id
                  : state.oldestMessageId || state.messages?.[0]?.id) || 0
              ),
              memories: Array.isArray(state.memories) ? state.memories.slice(0, 16) : [],
              lorebooks: Array.isArray(state.lorebooks) ? state.lorebooks.slice(0, 12) : [],
              nurturing: state.nurturing,
              companion: state.companion,
              telemetry: state.telemetry,
              membership: state.membership
            }
          : null;
        return {
          savedAt: Date.now(),
          app_version: state.appVersion,
          userId: state.user.id,
          uiMode: state.uiMode,
          activeScriptId: state.activeScriptId,
          activeSessionId: state.activeSessionId,
          user: state.user,
          scripts: liteScripts,
          personas: litePersonas,
          sessions: Array.isArray(state.sessions) ? state.sessions.slice(0, 40) : [],
          settings: state.settings || {},
          membership: state.membership,
          wallet: state.wallet,
          initial_session_id: initPayload ? state.activeSessionId : null,
          initial_session_payload: initPayload
        };
      };

      let json = JSON.stringify(buildSnapshotObj(25));
      if (json.length > 420 * 1024) {
        json = JSON.stringify(buildSnapshotObj(10));
      }
      if (json.length > 480 * 1024) {
        json = JSON.stringify(buildSnapshotObj(4));
      }
      if (json.length <= 512 * 1024) {
        localStorage.setItem(BOOT_SNAPSHOT_KEY, json);
      }
    } catch {}
  }

  function loadBootSnapshot() {
    try {
      const raw = localStorage.getItem(BOOT_SNAPSHOT_KEY);
      if (!raw) return null;
      const snap = JSON.parse(raw);
      if (!snap || !snap.userId || !snap.user?.id || snap.user.id !== snap.userId) {
        clearBootSnapshot();
        return null;
      }
      if (!snap.savedAt || Date.now() - snap.savedAt > BOOT_SNAPSHOT_TTL_MS) {
        clearBootSnapshot();
        return null;
      }
      const localActiveUid = window.__starAuthStore?.getActiveUserId();
      if (localActiveUid && localActiveUid !== snap.userId) {
        clearBootSnapshot();
        return null;
      }
      return snap;
    } catch {
      return null;
    }
  }

  function syncWebVersionBadges(verStr) {
    const raw = String(verStr || state.appVersion || '2.0.2').trim().replace(/^v/i, '');
    if (!raw) return;
    const vLabel = `v${raw}`;
    const isNativeApk = Boolean(
      window.AndroidAppBridge ||
        window.location.protocol === 'file:' ||
        window.location.hostname === 'appassets.androidplatform.net'
    );

    const sidebarTag = document.getElementById('sidebar-web-version-tag');
    if (sidebarTag) sidebarTag.textContent = vLabel;

    const modalPill = document.getElementById('apk-modal-version-pill');
    if (modalPill) {
      modalPill.textContent = `版本 ${vLabel} (支持 60fps 极速流式、语音输入与可靠自动更新)`;
    }

    if (!isNativeApk) {
      const mfsVer = document.getElementById('mfs-version-value');
      if (mfsVer) mfsVer.textContent = vLabel;
      const anvVer = document.getElementById('anv-current-version');
      if (anvVer) anvVer.textContent = `${vLabel} (已就绪)`;
      const updLocal = document.getElementById('upd-local-ver');
      if (updLocal) updLocal.textContent = vLabel;
    }
  }

  // 登录门扉 DOM
  const authGate = document.getElementById('auth-gate');
  const tabSigninBtn = document.getElementById('tab-signin-btn');
  const tabSignupBtn = document.getElementById('tab-signup-btn');
  const signinForm = document.getElementById('signin-form');
  const signupForm = document.getElementById('signup-form');
  const authErrorBox = document.getElementById('auth-error-box');
  const quickDemoLoginBtn = document.getElementById('quick-demo-login-btn');
  const freshGuestLoginBtn = document.getElementById('fresh-guest-login-btn');

  // 主工作台 DOM
  const appShell = document.getElementById('app-shell');
  const navUserAvatar = document.getElementById('nav-user-avatar');
  const navUserNickname = document.getElementById('nav-user-nickname');
  const navUserRoleLabel = document.getElementById('nav-user-role-label');
  const logoutBtn = document.getElementById('logout-btn');

  const toggleLeftBtn = document.getElementById('toggle-left-btn');
  const expandLeftBtn = document.getElementById('expand-left-btn');
  const toggleRightBtn = document.getElementById('toggle-right-btn');
  const closeRightBtn = document.getElementById('close-right-btn');
  const memoryStatusPill = document.getElementById('memory-status-pill');

  const personaListEl = document.getElementById('persona-list');
  const sessionListEl = document.getElementById('session-list');
  const messagesViewport = document.getElementById('messages-viewport');
  const messagesContainer = document.getElementById('messages-container');
  const memoryToastEl = document.getElementById('memory-toast');

  const topbarAvatar = document.getElementById('topbar-avatar');
  const topbarName = document.getElementById('topbar-name');
  const topbarTagline = document.getElementById('topbar-tagline');
  const bondLevelTag = document.getElementById('bond-level-tag');
  const memoryPillText = document.getElementById('memory-pill-text');
  const gatewaySummaryText = document.getElementById('gateway-summary-text');

  const chatForm = document.getElementById('chat-form');
  const chatInput = document.getElementById('chat-input');
  const sendBtn = document.getElementById('send-button');
  const stopStreamBtn = document.getElementById('stop-stream-btn');
  const toggleThoughtBtn = document.getElementById('toggle-thought-btn');
  const toggleAutoMemBtn = document.getElementById('toggle-automem-btn');

  const inlinePersonaForm = document.getElementById('inline-persona-form');
  const rollingSummaryInput = document.getElementById('rolling-summary-input');
  const saveSummaryBtn = document.getElementById('save-summary-btn');
  const compressNowBtn = document.getElementById('compress-now-btn');
  const addMemoryForm = document.getElementById('add-memory-form');
  const newMemoryInput = document.getElementById('new-memory-input');
  const newMemoryPin = document.getElementById('new-memory-pin');
  const memoryCardsList = document.getElementById('memory-cards-list');
  const memoryCountLabel = document.getElementById('memory-count-label');

  // 新手向导浮窗 DOM
  const tourPopover = document.getElementById('onboarding-tour-popover');
  const tourStepBadge = document.getElementById('tour-step-badge');
  const tourStepTitle = document.getElementById('tour-step-title');
  const tourStepDesc = document.getElementById('tour-step-desc');
  const tourDotsEl = document.getElementById('tour-dots');
  const tourPrevBtn = document.getElementById('tour-prev-btn');
  const tourNextBtn = document.getElementById('tour-next-btn');
  const tourSkipBtn = document.getElementById('tour-skip-btn');

  // 模态对话框
  const personaDialog = document.getElementById('persona-dialog');
  const importHistoryDialog = document.getElementById('import-history-dialog');
  const settingsDialog = document.getElementById('settings-dialog');
  const userPersonaDialog = document.getElementById('user-persona-dialog');
  const plazaDialog = document.getElementById('plaza-dialog');
  const theaterDialog = document.getElementById('theater-dialog');
  const quoteCardDialog = document.getElementById('quote-card-dialog');
  const fimDialog = document.getElementById('fim-dialog');
  const codePreviewDialog = document.getElementById('code-preview-dialog');
  const attachmentPreviewDialog = document.getElementById('attachment-preview-dialog');
  const dsShareDialog = document.getElementById('ds-share-dialog');
  const adminConsoleDialog = document.getElementById('admin-console-dialog');

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function parseMsgMeta(msg) {
    if (!msg) return {};
    if (msg._parsedMeta) return msg._parsedMeta;
    if (msg.meta && typeof msg.meta === 'object') {
      msg._parsedMeta = msg.meta;
      return msg.meta;
    }
    if (typeof msg.meta_json === 'string' && msg.meta_json.trim()) {
      try {
        msg._parsedMeta = JSON.parse(msg.meta_json);
        return msg._parsedMeta;
      } catch {}
    }
    return {};
  }

  // 遵循 single-line-overflow 规范：不在 JS 截断文件名字符，仅分离主干与后缀交由 CSS 弹性省略
  function renderFilenameHtml(fullName) {
    const str = String(fullName || 'document.txt');
    const dotIdx = str.lastIndexOf('.');
    if (dotIdx > 0 && dotIdx < str.length - 1) {
      const stem = str.slice(0, dotIdx);
      const ext = str.slice(dotIdx);
      return `<span class="ds-filename"><span>${escapeHtml(stem)}</span>${escapeHtml(ext)}</span>`;
    }
    return `<span class="ds-filename"><span>${escapeHtml(str)}</span></span>`;
  }

  // 主线程分片让出（遵循 performance 指南：优先 scheduler.yield）与防抖工具
  function yieldToMain() {
    if ('scheduler' in window && typeof window.scheduler?.yield === 'function') {
      return window.scheduler.yield();
    }
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  function debounce(fn, delay = 120) {
    let timer = 0;
    return function debounced(...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay);
    };
  }

  // 代码块内容注册池（用于一键复制、下载文件与右侧 Artifacts 实时预览）
  const codeSnippetStore = new Map();
  let codeSeq = 0;

  // 有界 LRU Markdown 渲染缓存（仅缓存非流式完成态消息，加速会话切换与二次渲染）
  const MARKDOWN_CACHE_LIMIT = 160;
  const markdownRenderCache = new Map();

  function getCachedMarkdownResult(cacheKey) {
    const cached = markdownRenderCache.get(cacheKey);
    if (!cached) return null;
    markdownRenderCache.delete(cacheKey);
    markdownRenderCache.set(cacheKey, cached);
    if (Array.isArray(cached.snippets)) {
      for (const [cid, entry] of cached.snippets) {
        codeSnippetStore.set(cid, entry);
      }
    }
    return cached.html;
  }

  function setCachedMarkdownResult(cacheKey, html, snippets) {
    if (!cacheKey || typeof html !== 'string') return;
    if (markdownRenderCache.size >= MARKDOWN_CACHE_LIMIT) {
      const oldestKey = markdownRenderCache.keys().next().value;
      if (oldestKey !== undefined) markdownRenderCache.delete(oldestKey);
    }
    markdownRenderCache.set(cacheKey, { html, snippets });
  }

  // 单遍零依赖代码语法着色引擎（先从源码切词再分别转义，杜绝 HTML 属性二次污染）
  const CODE_KEYWORDS_SET = new Set([
    'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'do', 'switch', 'case',
    'break', 'continue', 'try', 'catch', 'finally', 'throw', 'async', 'await', 'class', 'extends', 'new',
    'import', 'export', 'from', 'default', 'typeof', 'instanceof', 'in', 'of', 'true', 'false', 'null',
    'undefined', 'def', 'elif', 'lambda', 'yield', 'with', 'as', 'pass', 'None', 'True', 'False', 'self',
    'fn', 'pub', 'struct', 'enum', 'impl', 'match', 'mut', 'use', 'package', 'func', 'interface', 'type',
    'select', 'where', 'insert', 'into', 'update', 'delete', 'create', 'table', 'join', 'order', 'by', 'group'
  ]);

  function highlightCodeSyntax(rawCode, lang) {
    const src = String(rawCode || '');
    if (!src || src.length > 28000) return escapeHtml(src);

    if (lang === 'html' || lang === 'htm' || lang === 'xml' || lang === 'svg' || lang === 'vue') {
      const htmlTokRe = /(<!--[\s\S]*?-->)|(<\/?[a-zA-Z0-9:-]+)|(\s+[a-zA-Z_:][-a-zA-Z0-9_:.]*(?==))|("[^"]*"|'[^']*')/g;
      let res = '';
      let last = 0;
      let m;
      while ((m = htmlTokRe.exec(src)) !== null) {
        if (m.index > last) res += escapeHtml(src.slice(last, m.index));
        if (m[1]) res += `<span class="tok-com">${escapeHtml(m[1])}</span>`;
        else if (m[2]) res += `<span class="tok-tag">${escapeHtml(m[2])}</span>`;
        else if (m[3]) res += `<span class="tok-attr">${escapeHtml(m[3])}</span>`;
        else if (m[4]) res += `<span class="tok-str">${escapeHtml(m[4])}</span>`;
        last = htmlTokRe.lastIndex;
      }
      if (last < src.length) res += escapeHtml(src.slice(last));
      return res;
    }

    const tokenRe =
      /(\/\/[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\/)|(`(?:\\[\s\S]|[^\\`])*`|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')|\b(\d+(?:\.\d+)?)\b|\b([a-zA-Z_$][\w$]*)(?=\s*\()|\b([a-zA-Z_]\w*)\b/g;
    let out = '';
    let lastIdx = 0;
    let match;
    while ((match = tokenRe.exec(src)) !== null) {
      if (match.index > lastIdx) {
        out += escapeHtml(src.slice(lastIdx, match.index));
      }
      const [full, com, str, num, fnName, word] = match;
      if (com) {
        out += `<span class="tok-com">${escapeHtml(com)}</span>`;
      } else if (str) {
        out += `<span class="tok-str">${escapeHtml(str)}</span>`;
      } else if (num) {
        out += `<span class="tok-num">${escapeHtml(num)}</span>`;
      } else if (fnName) {
        if (CODE_KEYWORDS_SET.has(fnName)) {
          out += `<span class="tok-kw">${escapeHtml(fnName)}</span>`;
        } else {
          out += `<span class="tok-fn">${escapeHtml(fnName)}</span>`;
        }
      } else if (word && CODE_KEYWORDS_SET.has(word)) {
        out += `<span class="tok-kw">${escapeHtml(word)}</span>`;
      } else {
        out += escapeHtml(full);
      }
      lastIdx = tokenRe.lastIndex;
    }
    if (lastIdx < src.length) out += escapeHtml(src.slice(lastIdx));
    return out;
  }

  // 零依赖 LaTeX 数学公式转语义 HTML 排版引擎
  const LATEX_SYMBOLS_MAP = {
    '\\alpha': 'α', '\\beta': 'β', '\\gamma': 'γ', '\\delta': 'δ', '\\epsilon': 'ϵ', '\\varepsilon': 'ε',
    '\\zeta': 'ζ', '\\eta': 'η', '\\theta': 'θ', '\\iota': 'ι', '\\kappa': 'κ', '\\lambda': 'λ',
    '\\mu': 'μ', '\\nu': 'ν', '\\xi': 'ξ', '\\pi': 'π', '\\rho': 'ρ', '\\sigma': 'σ', '\\tau': 'τ',
    '\\upsilon': 'υ', '\\phi': 'ϕ', '\\varphi': 'φ', '\\chi': 'χ', '\\psi': 'ψ', '\\omega': 'ω',
    '\\Gamma': 'Γ', '\\Delta': 'Δ', '\\Theta': 'Θ', '\\Lambda': 'Λ', '\\Xi': 'Ξ', '\\Pi': 'Π',
    '\\Sigma': 'Σ', '\\Phi': 'Φ', '\\Psi': 'Ψ', '\\Omega': 'Ω',
    '\\infty': '∞', '\\partial': '∂', '\\nabla': '∇', '\\pm': '±', '\\mp': '∓', '\\times': '×',
    '\\cdot': '·', '\\div': '÷', '\\neq': '≠', '\\ne': '≠', '\\leq': '≤', '\\le': '≤', '\\geq': '≥',
    '\\ge': '≥', '\\approx': '≈', '\\equiv': '≡', '\\sim': '∼', '\\propto': '∝', '\\in': '∈',
    '\\notin': '∉', '\\subset': '⊂', '\\subseteq': '⊆', '\\cup': '∪', '\\cap': '∩', '\\emptyset': '∅',
    '\\forall': '∀', '\\exists': '∃', '\\rightarrow': '→', '\\to': '→', '\\leftarrow': '←',
    '\\Rightarrow': '⇒', '\\implies': '⟹', '\\Leftrightarrow': '⇔', '\\iff': '⟺', '\\dots': '…',
    '\\cdots': '⋯', '\\ldots': '…', '\\mathbb{R}': 'ℝ', '\\mathbb{N}': 'ℕ', '\\mathbb{Z}': 'ℤ',
    '\\mathbb{Q}': 'ℚ', '\\mathbb{C}': 'ℂ', '\\mathbb{E}': '𝔼'
  };

  function renderLatexMathToHtml(rawTex, isBlock = false) {
    let s = escapeHtml(String(rawTex || '').trim());
    s = s
      .replace(/\\left\s*([()[\]|])/g, '$1')
      .replace(/\\right\s*([()[\]|])/g, '$1')
      .replace(/\\left\\\{/g, '{')
      .replace(/\\right\\\}/g, '}')
      .replace(/\\,/g, '&thinsp;')
      .replace(/\\;/g, '&ensp;')
      .replace(/\\quad/g, '&emsp;')
      .replace(/\\text\{([^{}]*)\}/g, '<span>$1</span>')
      .replace(/\\mathbf\{([^{}]*)\}/g, '<strong>$1</strong>')
      .replace(/\\mathrm\{([^{}]*)\}/g, '<span>$1</span>')
      .replace(/\\mathcal\{([^{}]*)\}/g, '<i>$1</i>')
      .replace(/\\operatorname\{([^{}]*)\}/g, '<span>$1</span>');

    s = s
      .replace(/\\sum\b/g, '<span class="ds-math-op">∑</span>')
      .replace(/\\prod\b/g, '<span class="ds-math-op">∏</span>')
      .replace(/\\iint\b/g, '<span class="ds-math-op">∬</span>')
      .replace(/\\int\b/g, '<span class="ds-math-op">∫</span>');

    for (const [cmd, glyph] of Object.entries(LATEX_SYMBOLS_MAP)) {
      s = s.split(cmd).join(glyph);
    }

    for (let pass = 0; pass < 3; pass++) {
      s = s.replace(
        /\\frac\{([^{}]*)\}\{([^{}]*)\}/g,
        '<span class="ds-math-frac"><span class="ds-math-num">$1</span><span class="ds-math-den">$2</span></span>'
      );
      s = s.replace(
        /\\sqrt\[([^\]]+)\]\{([^{}]*)\}/g,
        '<span class="ds-math-sqrt"><sup>$1</sup>√<span class="ds-math-radicand">$2</span></span>'
      );
      s = s.replace(
        /\\sqrt\{([^{}]*)\}/g,
        '<span class="ds-math-sqrt">√<span class="ds-math-radicand">$1</span></span>'
      );
    }

    s = s
      .replace(/\^\{([^{}]+)\}/g, '<sup>$1</sup>')
      .replace(/_\{([^{}]+)\}/g, '<sub>$1</sub>')
      .replace(/\^([a-zA-Z0-9+\-])/g, '<sup>$1</sup>')
      .replace(/_([a-zA-Z0-9+\-])/g, '<sub>$1</sub>');

    return isBlock
      ? `<div class="ds-math-block" role="math">${s}</div>`
      : `<span class="ds-math-inline" role="math">${s}</span>`;
  }

  function resolveCodeFileExt(lang) {
    const map = {
      javascript: 'js', js: 'js', typescript: 'ts', ts: 'ts', python: 'py', py: 'py',
      html: 'html', htm: 'html', svg: 'svg', css: 'css', json: 'json', sql: 'sql',
      bash: 'sh', sh: 'sh', shell: 'sh', cpp: 'cpp', c: 'c', java: 'java', go: 'go', rust: 'rs', markdown: 'md'
    };
    return map[lang] || 'txt';
  }

  function renderNativeDeepSeekMarkdown(rawText, searchResults = [], options = {}) {
    if (!rawText) return '';
    const isStreaming = Boolean(options?.isStreaming);
    const streamPrefix = options?.streamKeyPrefix || 'stream_cb';
    let workingRaw = String(rawText);

    const srKey =
      Array.isArray(searchResults) && searchResults.length > 0
        ? searchResults.map((s) => `${s?.index ?? ''}:${s?.url || ''}`).join('|')
        : '';
    const canCache = !isStreaming && workingRaw.length <= 40000;
    const cacheKey = canCache ? `ds\x00${srKey}\x00${workingRaw}` : '';
    if (cacheKey) {
      const cachedHtml = getCachedMarkdownResult(cacheKey);
      if (cachedHtml !== null) return cachedHtml;
    }

    // 流式输出过程中若围栏代码块尚未闭合，自动临时闭合以避免流式打字跳变
    const fenceCount = (workingRaw.match(/```/g) || []).length;
    if (fenceCount % 2 === 1) {
      workingRaw += '\n```';
    }

    const codeBlocks = [];
    const mathBlocks = [];
    const capturedSnippets = canCache ? [] : null;

    // 1) 保护围栏代码块（从源码走语法高亮，提供右侧预览/自动换行/下载/无障碍复制）
    workingRaw = workingRaw.replace(/```([a-zA-Z0-9_+-]*)\r?\n?([\s\S]*?)```/g, (_, langRaw, rawCodeBody) => {
      const lang = (langRaw || 'text').trim().toLowerCase();
      const rawCode = String(rawCodeBody || '').replace(/\s+$/, '');
      const lineCount = rawCode ? rawCode.split(/\r?\n/).length : 1;
      const idx = codeBlocks.length;
      const codeId = isStreaming ? `${streamPrefix}_${idx}` : `cb_${++codeSeq}`;
      const snippetEntry = { code: rawCode, lang };
      codeSnippetStore.set(codeId, snippetEntry);
      if (capturedSnippets) capturedSnippets.push([codeId, snippetEntry]);

      const canPreview =
        lang === 'html' ||
        lang === 'htm' ||
        lang === 'svg' ||
        /<!doctype html>|<html|<canvas|<svg/i.test(rawCode);

      const highlighted = highlightCodeSyntax(rawCode, lang);
      codeBlocks.push(`
        <div class="ds-code-block" data-block-id="${codeId}">
          <div class="ds-code-header">
            <div class="ds-code-meta">
              <span class="ds-code-lang">${escapeHtml(lang || 'text')}</span>
              <span class="ds-code-lines-tag">${lineCount} 行</span>
            </div>
            <div class="ds-code-actions">
              ${
                canPreview
                  ? `<button type="button" class="ds-code-btn run-btn" data-run-code="${codeId}" title="在右侧伴生分栏实时运行预览">▶ 右侧预览</button>`
                  : ''
              }
              <button type="button" class="ds-code-btn" data-wrap-code="${codeId}" title="切换代码自动换行">换行</button>
              <button type="button" class="ds-code-btn" data-dl-code="${codeId}" title="下载为本地代码文件">下载</button>
              <span class="ds-copy-wrap">
                <button type="button" class="ds-code-btn ds-copy-btn-std" data-copy-code="${codeId}">复制代码</button>
                <span class="ds-copy-live-tip" role="status"></span>
              </span>
            </div>
          </div>
          <pre tabindex="0"><code>${highlighted}</code></pre>
        </div>
      `);
      return `\n@@DSCODE_${idx}@@\n`;
    });

    // 2) 提取块级公式 $$...$$ 与 \[...\]
    workingRaw = workingRaw.replace(/\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]/g, (_, m1, m2) => {
      const idx = mathBlocks.length;
      mathBlocks.push(renderLatexMathToHtml(m1 || m2, true));
      return `\n@@DSMATHB_${idx}@@\n`;
    });

    // 3) 提取行内公式 $...$ 与 \(...\)
    const inlineMathList = [];
    workingRaw = workingRaw.replace(/\\\(([^\n]+?)\\\)|\$(?!\s)([^\n$]+?)(?<!\s)\$/g, (full, p1, p2) => {
      const expr = p1 !== undefined ? p1 : p2;
      if (!expr || /^\d+(?:[.,]\d+)?$/.test(expr.trim())) return full;
      const idx = inlineMathList.length;
      inlineMathList.push(renderLatexMathToHtml(expr, false));
      return `@@DSMATHI_${idx}@@`;
    });

    let safe = escapeHtml(workingRaw);

    const refMap = new Map();
    if (Array.isArray(searchResults)) {
      for (const sr of searchResults) {
        if (sr && sr.index && sr.url) refMap.set(Number(sr.index), sr);
      }
    }

    const formatInline = (line) => {
      const inlineCodes = [];
      let str = line.replace(/`([^`\n]+)`/g, (_, c) => {
        const ci = inlineCodes.length;
        inlineCodes.push(`<code>${c}</code>`);
        return `@@DSIC_${ci}@@`;
      });

      str = str.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/gi, (_, label, url) => {
        const cleanUrl = url.replace(/&amp;/g, '&');
        return `<a class="ds-md-link" href="${escapeHtml(cleanUrl)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
      });

      str = str
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/(^|[^*])\*([^*\s][^*\n]*?)\*(?!\*)/g, '$1<em>$2</em>')
        .replace(/~~([^~]+)~~/g, '<del>$1</del>');

      if (refMap.size > 0) {
        str = str.replace(/\[(\d{1,2})\]/g, (full, numStr) => {
          const item = refMap.get(Number(numStr));
          if (!item) return full;
          const tip = `[${item.index}] ${item.title}${item.site ? ` (${item.site})` : ''}`;
          return `<a class="ds-citation-badge" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(tip)}">${item.index}</a>`;
        });
      }

      inlineCodes.forEach((codeHtml, idx) => {
        str = str.replace(`@@DSIC_${idx}@@`, () => codeHtml);
      });
      inlineMathList.forEach((mathHtml, idx) => {
        str = str.replace(`@@DSMATHI_${idx}@@`, () => mathHtml);
      });
      return str;
    };

    const cleanedSafe = safe.replace(/^&lt;think&gt;[\s\S]*?&lt;\/think&gt;\s*/i, '');
    const lines = cleanedSafe.split(/\r?\n/);
    const out = [];
    let i = 0;

    // 判断第 idx 行起是否穿过连续空行紧接着匹配目标正则（解决正版 DeepSeek 列表项之间空行导致 <ol> 重置为 1. 的问题）
    const peekNextNonEmpty = (startIdx) => {
      let k = startIdx;
      while (k < lines.length && !lines[k].trim()) k++;
      return k < lines.length ? { index: k, raw: lines[k], trimmed: lines[k].trim() } : null;
    };

    while (i < lines.length) {
      const line = lines[i];
      const trimmed = line.trim();

      if (!trimmed) {
        i++;
        continue;
      }

      if (/^@@DSCODE_\d+@@$/.test(trimmed) || /^@@DSMATHB_\d+@@$/.test(trimmed)) {
        out.push(trimmed);
        i++;
        continue;
      }

      if (/^(?:---|\*\*\*|___)\s*$/.test(trimmed)) {
        out.push('<hr class="ds-md-hr" />');
        i++;
        continue;
      }

      const hMatch = trimmed.match(/^(#{1,4})\s+(.+)$/);
      if (hMatch) {
        const lv = hMatch[1].length;
        out.push(`<h${lv}>${formatInline(hMatch[2])}</h${lv}>`);
        i++;
        continue;
      }

      if (trimmed.startsWith('|') && i + 1 < lines.length && /^\|\s*[:\-| ]+\|$/.test(lines[i + 1].trim())) {
        const parseRow = (r) =>
          r
            .trim()
            .replace(/^\||\|$/g, '')
            .split('|')
            .map((c) => formatInline(c.trim()));
        const headers = parseRow(trimmed);
        i += 2;
        const bodyRows = [];
        while (i < lines.length && lines[i].trim().startsWith('|')) {
          bodyRows.push(parseRow(lines[i]));
          i++;
        }
        out.push(`
          <div class="ds-md-table-wrap" tabindex="0" role="region" aria-label="数据表格">
            <table class="ds-md-table">
              <thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead>
              <tbody>${bodyRows
                .map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`)
                .join('')}</tbody>
            </table>
          </div>
        `);
        continue;
      }

      if (trimmed.startsWith('&gt;')) {
        const qLines = [];
        while (i < lines.length && lines[i].trim().startsWith('&gt;')) {
          qLines.push(formatInline(lines[i].trim().replace(/^&gt;\s?/, '')));
          i++;
        }
        out.push(`<blockquote>${qLines.join('<br/>')}</blockquote>`);
        continue;
      }

      if (/^[-*]\s+/.test(trimmed)) {
        const items = [];
        while (i < lines.length) {
          const curTrim = lines[i].trim();
          if (!/^[-*]\s+/.test(curTrim)) break;
          const itemBody = curTrim.replace(/^[-*]\s+/, '');
          const taskMatch = itemBody.match(/^\[([ xX])\]\s+(.+)$/);
          i++;

          const subBullets = [];
          while (i < lines.length && /^\s{2,}(?:[-*]|\d+\.)\s+/.test(lines[i])) {
            subBullets.push(`<li>${formatInline(lines[i].trim().replace(/^(?:[-*]|\d+\.)\s+/, ''))}</li>`);
            i++;
          }
          const subHtml = subBullets.length > 0 ? `<ul>${subBullets.join('')}</ul>` : '';

          if (taskMatch) {
            const checked = taskMatch[1].toLowerCase() === 'x';
            items.push(
              `<li class="ds-task-item"><input type="checkbox" disabled ${checked ? 'checked' : ''} /><span>${formatInline(
                taskMatch[2]
              )}${subHtml}</span></li>`
            );
          } else {
            items.push(`<li>${formatInline(itemBody)}${subHtml}</li>`);
          }

          const nextPeek = peekNextNonEmpty(i);
          if (nextPeek && nextPeek.index > i && /^[-*]\s+/.test(nextPeek.trimmed) && !/^\s{2,}/.test(nextPeek.raw)) {
            i = nextPeek.index;
          }
        }
        out.push(`<ul>${items.join('')}</ul>`);
        continue;
      }

      const firstOlMatch = trimmed.match(/^(\d+)\.\s+(.+)$/);
      if (firstOlMatch) {
        const startNum = parseInt(firstOlMatch[1], 10) || 1;
        const items = [];
        while (i < lines.length) {
          const curTrim = lines[i].trim();
          const olMatch = curTrim.match(/^(\d+)\.\s+(.+)$/);
          if (!olMatch) break;
          let liContent = formatInline(olMatch[2]);
          i++;

          const subItems = [];
          while (i < lines.length) {
            const subRaw = lines[i];
            const subTrim = subRaw.trim();
            if (!subTrim) {
              const peekSub = peekNextNonEmpty(i);
              if (peekSub && /^\s{2,}[-*]\s+/.test(peekSub.raw)) {
                i = peekSub.index;
                continue;
              }
              break;
            }
            if (/^\s{2,}[-*]\s+/.test(subRaw)) {
              subItems.push(`<li>${formatInline(subTrim.replace(/^[-*]\s+/, ''))}</li>`);
              i++;
            } else if (/^\s{2,}(?!\d+\.\s+)/.test(subRaw) && !/^@@DS/.test(subTrim)) {
              liContent += `<br/>${formatInline(subTrim)}`;
              i++;
            } else {
              break;
            }
          }
          if (subItems.length > 0) {
            liContent += `<ul>${subItems.join('')}</ul>`;
          }
          items.push(`<li>${liContent}</li>`);

          const nextOlPeek = peekNextNonEmpty(i);
          if (nextOlPeek && nextOlPeek.index > i && /^\d+\.\s+/.test(nextOlPeek.trimmed) && !/^\s{2,}/.test(nextOlPeek.raw)) {
            i = nextOlPeek.index;
          }
        }
        out.push(startNum > 1 ? `<ol start="${startNum}">${items.join('')}</ol>` : `<ol>${items.join('')}</ol>`);
        continue;
      }

      const pLines = [];
      while (
        i < lines.length &&
        lines[i].trim() &&
        !/^@@DSCODE_\d+@@$/.test(lines[i].trim()) &&
        !/^@@DSMATHB_\d+@@$/.test(lines[i].trim()) &&
        !/^(?:---|\*\*\*|___)\s*$/.test(lines[i].trim()) &&
        !/^(#{1,4})\s+/.test(lines[i].trim()) &&
        !lines[i].trim().startsWith('&gt;') &&
        !/^[-*]\s+/.test(lines[i].trim()) &&
        !/^\d+\.\s+/.test(lines[i].trim())
      ) {
        pLines.push(formatInline(lines[i]));
        i++;
      }
      out.push(`<p>${pLines.join('<br/>')}</p>`);
    }

    let joined = out.join('');
    mathBlocks.forEach((mb, idx) => {
      joined = joined.replace(`@@DSMATHB_${idx}@@`, () => mb);
    });
    codeBlocks.forEach((cb, idx) => {
      joined = joined.replace(`@@DSCODE_${idx}@@`, () => cb);
    });
    if (cacheKey) {
      setCachedMarkdownResult(cacheKey, joined, capturedSnippets);
    }
    return joined;
  }

  function renderMessageMarkdown(rawText, searchResults = [], options = {}) {
    if (state.uiMode === 'deepseek' || state.uiMode === 'phone-agent') {
      return renderNativeDeepSeekMarkdown(rawText, searchResults, options);
    }
    if (!rawText) return '';
    const isStreaming = Boolean(options?.isStreaming);
    const textStr = String(rawText);
    const canCache = !isStreaming && textStr.length <= 40000;
    const cacheKey = canCache ? `rp\x00${textStr}` : '';
    if (cacheKey) {
      const cached = getCachedMarkdownResult(cacheKey);
      if (cached !== null) return cached;
    }
    const html = renderRoleplayMarkdown(textStr);
    if (cacheKey) {
      setCachedMarkdownResult(cacheKey, html, null);
    }
    return html;
  }

  function renderRoleplayMarkdown(rawText) {
    if (!rawText) return '';
    const codeBlocks = [];
    let safe = escapeHtml(rawText);

    safe = safe.replace(/```([\s\S]*?)```/g, (_, code) => {
      const idx = codeBlocks.length;
      codeBlocks.push(`<pre><code>${code.trim()}</code></pre>`);
      return `@@CODEBLOCK_${idx}@@`;
    });

    safe = safe
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*\n]+)\*/g, '<em class="rp-action">$1</em>')
      .replace(/“([^”\n]+)”/g, '<span class="rp-speech">“$1”</span>')
      .replace(/`([^`\n]+)`/g, '<code>$1</code>');

    const blocks = safe.split(/\n{2,}/);
    const htmlBlocks = blocks.map((block) => {
      const trimmed = block.trim();
      if (!trimmed) return '';
      if (/^@@CODEBLOCK_\d+@@$/.test(trimmed)) return trimmed;
      if (trimmed.startsWith('&gt;')) {
        const quoteClean = trimmed
          .split('\n')
          .map((l) => l.replace(/^&gt;\s?/, ''))
          .join('<br/>');
        return `<blockquote>${quoteClean}</blockquote>`;
      }
      return `<p>${trimmed.replace(/\n/g, '<br/>')}</p>`;
    });

    let joined = htmlBlocks.join('');
    codeBlocks.forEach((cb, idx) => {
      joined = joined.replace(`@@CODEBLOCK_${idx}@@`, cb);
    });
    return joined;
  }

  function getPersonaPronoun(persona = state.activePersona) {
    if (!persona) return '他';
    const explicitGender = String(persona.gender || '').trim().toLowerCase();
    if (explicitGender === 'female' || explicitGender === '女' || explicitGender === 'f') return '她';
    if (explicitGender === 'male' || explicitGender === '男' || explicitGender === 'm') return '他';

    const femaleIds = new Set([
      'persona_nagisa_sakura',
      'persona_kagaribi_kyou',
      'persona_ichinose_kotomi',
      'persona_makise_sei',
      'persona_asagiri_mio',
      'persona_violet_eve',
      'persona_suwanqing',
      'persona_yunzhiyao',
      'persona_xia_ningmeng',
      'persona_yan_feiyu'
    ]);
    const maleIds = new Set([
      'persona_shenxinghui',
      'persona_luchen',
      'persona_xieqingyan',
      'persona_jiangyubai',
      'persona_jiran',
      'persona_guxiuyuan',
      'persona_shiraishi_rin',
      'persona_hodgins_landon',
      'persona_frieren_shuer',
      'persona_stark_fer'
    ]);
    if (femaleIds.has(persona.id)) return '她';
    if (maleIds.has(persona.id)) return '他';

    const desc = `${persona.name || ''} ${persona.category_tag || ''} ${persona.tagline || ''} ${persona.personality || ''} ${persona.greeting || ''}`;
    if (/女执政官|神女|师姐|学妹|学姐|御姐|甜妹|歌姬|大小姐|巫女|修女|女王|公主|名伶|女家主|少女|女生|女孩|姐姐|仙子|双马尾/.test(desc) && !/少年|公子|先生|学弟|男主|剑尊/.test(desc)) {
      return '她';
    }
    const sheCnt = (desc.match(/她/g) || []).length;
    const heCnt = (desc.match(/他/g) || []).length;
    if (sheCnt > heCnt) return '她';
    if (/[妍婷薇柔婉菲瑶晴柠汐琴奈澪琳樱雪莉娜茜媛妃姝娴]/.test(persona.name || '') && heCnt === 0) {
      return '她';
    }
    return '他';
  }

  
  // ================= 艺术字与质感头像引擎（告别 Emoji，极简高级质感） =================
  function extractCoreGlyph(name, fallback = '星') {
    if (!name) return fallback;
    const clean = String(name).trim();
    const baseName = clean.split(/[·\s(（]/)[0].trim() || clean;
    if (/^[A-Za-z0-9]/.test(baseName)) {
      return baseName.charAt(0).toUpperCase();
    }
    if (baseName.length >= 2) {
      return baseName.charAt(baseName.length - 1);
    }
    return baseName.charAt(0) || fallback;
  }

  const AVATAR_PALETTES = [
    'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
    'linear-gradient(135deg, #0284c7 0%, #2563eb 100%)',
    'linear-gradient(135deg, #e11d48 0%, #f43f5e 100%)',
    'linear-gradient(135deg, #059669 0%, #10b981 100%)',
    'linear-gradient(135deg, #d97706 0%, #f59e0b 100%)',
    'linear-gradient(135deg, #9333ea 0%, #c084fc 100%)',
    'linear-gradient(135deg, #0891b2 0%, #06b6d4 100%)',
    'linear-gradient(135deg, #db2777 0%, #f472b6 100%)'
  ];

  function getAvatarGradient(key) {
    if (!key) return AVATAR_PALETTES[0];
    let hash = 0;
    const str = String(key);
    for (let i = 0; i < str.length; i++) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash |= 0;
    }
    const idx = Math.abs(hash) % AVATAR_PALETTES.length;
    return AVATAR_PALETTES[idx];
  }

  window.__getActiveUserAvatarConfig = function () {
    return state.user?.avatar_config || null;
  };

  function renderSmartAvatarHtml(avatarRaw, nameRaw, sizeClass = 'size-md', isUser = false, avatarConfig = null) {
    if (window.AppearanceSystem && typeof window.AppearanceSystem.renderSmartAvatarHtml === 'function') {
      return window.AppearanceSystem.renderSmartAvatarHtml(
        avatarRaw,
        nameRaw,
        sizeClass,
        isUser,
        avatarConfig || (isUser ? state.user?.avatar_config : null)
      );
    }
    const raw = String(avatarRaw || '').trim();
    if (raw.startsWith('http://') || raw.startsWith('https://') || raw.startsWith('data:image/') || raw.startsWith('/')) {
      return `<img src="${escapeHtml(raw)}" class="avatar-img ${sizeClass}" alt="${escapeHtml(nameRaw || '')}" loading="lazy" decoding="async" />`;
    }
    if (!isUser && (nameRaw?.includes('DeepSeek') || raw === '🐋')) {
      return `<span class="art-badge-avatar ${sizeClass}" style="background: linear-gradient(135deg, #1d4ed8 0%, #3b82f6 100%);">${DS_WHALE_AVATAR_SVG}</span>`;
    }
    if (isUser) {
      const glyph = extractCoreGlyph(nameRaw || state.user?.nickname || '我', '我');
      const bg = 'linear-gradient(135deg, #2563eb 0%, #4f46e5 100%)';
      return `<span class="art-badge-avatar ${sizeClass}" style="background: ${bg};">${escapeHtml(glyph)}</span>`;
    }
    const glyph = extractCoreGlyph(nameRaw, '角');
    const bg = getAvatarGradient(nameRaw || glyph);
    return `<span class="art-badge-avatar ${sizeClass}" style="background: ${bg};">${escapeHtml(glyph)}</span>`;
  }

  function replaceClientMacros(rawStr) {
    const s = String(rawStr || '');
    if (!s) return '';
    const uNick =
      state.user?.nickname && !/^星[语屿]旅人/.test(state.user.nickname)
        ? state.user.nickname
        : '你';
    const cName = (state.activePersona?.name || '').split(/[·\s]/)[0] || '对方';
    return s.replace(/\{\{\s*user\s*\}\}/gi, uNick).replace(/\{\{\s*char\s*\}\}/gi, cName);
  }

  let isDismissingSplash = false;
  function dismissBootSplash(immediate = false) {
    if (window.__bootSafetyTimer) {
      clearTimeout(window.__bootSafetyTimer);
      window.__bootSafetyTimer = null;
    }
    const splash = document.getElementById('boot-splash');
    if (!splash || splash.classList.contains('hidden')) return;
    if (immediate) {
      splash.classList.add('hidden');
      splash.classList.remove('leaving');
      splash.style.display = 'none';
      splash.style.pointerEvents = 'none';
      return;
    }
    if (isDismissingSplash) return;
    isDismissingSplash = true;
    splash.classList.add('leaving');
    splash.style.pointerEvents = 'none';
    setTimeout(() => {
      splash.classList.add('hidden');
      splash.classList.remove('leaving');
      splash.style.display = 'none';
      isDismissingSplash = false;
    }, 360);
  }
  window.__dismissBootSplash = dismissBootSplash;
  window.__showAppToast = (msg, dur) => showToast(msg, dur);

  let toastTimer = null;
  let topToastTimer = null;
  let walletBannerTimer = null;
  let adminBannerTimer = null;
  memoryToastEl?.addEventListener('click', () => {
    clearTimeout(toastTimer);
    memoryToastEl.classList.add('hidden');
  });
  function cleanUiEmojiText(raw) {
    if (!raw) return '';
    const s = String(raw);
    return s
      .replace(/[\u{1F300}-\u{1F9FF}\u{1FA00}-\u{1FAFF}\u{2600}-\u{27BF}\u{2300}-\u{23FF}\u{2B50}-\u{2B55}\u{3030}\u{303D}\u{3297}\u{3299}]/gu, '')
      .replace(/\uFE0F/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  function showToast(text, durationMs = 3000) {
    const cleanText = cleanUiEmojiText(text);
    memoryToastEl.textContent = cleanText;
    memoryToastEl.title = '点击可立即收起提示';
    memoryToastEl.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      memoryToastEl.classList.add('hidden');
    }, durationMs);

    // 同步渲染至浏览器 Top Layer (popover="manual")，确保在任何模态 <dialog> 打开时依然 100% 清晰可见
    const topToast = document.getElementById('global-top-toast');
    if (topToast) {
      topToast.textContent = cleanText;
      try {
        if (typeof topToast.showPopover === 'function' && !topToast.matches(':popover-open')) {
          topToast.showPopover();
        }
      } catch {}
      clearTimeout(topToastTimer);
      topToastTimer = setTimeout(() => {
        try {
          if (typeof topToast.hidePopover === 'function' && topToast.matches(':popover-open')) {
            topToast.hidePopover();
          }
        } catch {}
      }, durationMs);
    }

    const adminBanner = document.getElementById('admin-feedback-banner');
    if (adminBanner && adminConsoleDialog?.open) {
      adminBanner.textContent = text;
      adminBanner.classList.remove('hidden');
      clearTimeout(adminBannerTimer);
      adminBannerTimer = setTimeout(() => {
        adminBanner.classList.add('hidden');
      }, 5000);
    }
  }

  async function apiJson(url, options = {}) {
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 401 && data.code === 'AUTH_REQUIRED') {
        clearBootSnapshot();
        resetClientWorkspaceState();
        window.__starAuthStore?.clearTabSession(false);
        showAuthScreen();
      } else if (res.status === 409 && data.code === 'ACCOUNT_MISMATCH') {
        clearBootSnapshot();
        resetClientWorkspaceState();
        await enterWorkspace();
      }
      const err = new Error(data.error || `请求失败 (${res.status})`);
      err.code = data.code;
      throw err;
    }
    return data;
  }

  // 彻底清理前端当前账户的工作区内存与 DOM 残留，确保多账户切换 100% 物理级隔离
  function resetClientWorkspaceState() {
    if (state.isStreaming && state.streamingAbort) {
      try {
        state.streamingAbort.abort();
      } catch {}
    }
    state.streamingAbort = null;
    state.isStreaming = false;
    state.user = null;
    window.__STAR_CURRENT_USER__ = null;
    state.personas = [];
    state.sessions = [];
    state.settings = {};
    state.membership = {
      tier: 'free',
      card_type: 'none',
      tier_name: '普通旅人',
      online_credits: 0,
      points: 0,
      is_vip: false,
      has_active_card: false,
      can_use_online: false
    };
    state.wallet = null;
    state.selectedCashierProduct = null;
    state.adminDashboard = null;
    state.adminCodes = [];
    state.activeSessionId = null;
    state.activeSession = null;
    state.activePersona = null;
    state.messages = [];
    state.hasMoreMessages = false;
    state.totalMessages = 0;
    state.oldestMessageId = 0;
    state.memories = [];
    state.lorebooks = [];
    state.recalledIds = new Set();
    state.triggeredLoreIds = new Set();
    state.nurturing = null;
    state.companion = null;
    state.telemetry = null;
    state.pendingHistoryFile = null;
    state.pendingAttachments = [];
    state.dsBalance = null;
    state.lastSandboxCode = '';
    codeSnippetStore.clear();
    codeSeq = 0;
    markdownRenderCache.clear();
    sessionDetailCache.clear();
    window.__activeSessionId = null;
    window.__isAdminUser = false;
    window.dispatchEvent(new CustomEvent('user-role-changed'));

    if (messagesContainer) messagesContainer.innerHTML = '';
    if (sessionListEl) sessionListEl.innerHTML = '';
    if (personaListEl) personaListEl.innerHTML = '';
    if (memoryCardsList) memoryCardsList.innerHTML = '';
    if (adminConsoleDialog) adminConsoleDialog.innerHTML = '';
    if (chatInput) chatInput.value = '';
    const prefixInp = document.getElementById('ds-prefix-input');
    if (prefixInp) prefixInp.value = '';
    document.getElementById('ds-prefix-bar')?.classList.add('hidden');
    document.getElementById('open-admin-console-btn')?.classList.add('hidden');
    document.getElementById('ds-menu-admin-btn')?.classList.add('hidden');

    [
      personaDialog,
      importHistoryDialog,
      settingsDialog,
      userPersonaDialog,
      plazaDialog,
      theaterDialog,
      quoteCardDialog,
      fimDialog,
      codePreviewDialog,
      adminConsoleDialog
    ]
      .filter(Boolean)
      .forEach((dlg) => {
        if (dlg.open) dlg.close();
      });
  }

  function applyAuthLoginPayload(authRes, { persistDefault = true, rememberGuest = false } = {}) {
    if (authRes?.token) {
      window.__starAuthStore?.setToken(authRes.token, persistDefault);
    }
    if (authRes?.user?.id) {
      window.__starAuthStore?.setActiveUserId(authRes.user.id);
      if (rememberGuest && authRes.user.id.startsWith('user_guest_')) {
        window.__starAuthStore?.setGuestUserId(authRes.user.id);
      }
    }
    if (window.AndroidAppBridge && typeof window.AndroidAppBridge.saveAuthCredentials === 'function' && authRes?.user) {
      try {
        window.AndroidAppBridge.saveAuthCredentials(authRes.token || '', JSON.stringify(authRes.user));
      } catch {}
    }
  }

  function readFileAsText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('读取本地文件失败'));
      reader.readAsText(file, 'utf-8');
    });
  }

  // ================= 1. 登录与注册门扉控制 =================
  function setAuthError(msg) {
    if (!msg) {
      authErrorBox.classList.add('hidden');
      authErrorBox.textContent = '';
    } else {
      authErrorBox.textContent = msg;
      authErrorBox.classList.remove('hidden');
    }
  }

  function switchAuthTab(mode) {
    const isSignin = mode === 'signin';
    tabSigninBtn.classList.toggle('active', isSignin);
    tabSigninBtn.setAttribute('aria-selected', String(isSignin));
    tabSignupBtn.classList.toggle('active', !isSignin);
    tabSignupBtn.setAttribute('aria-selected', String(!isSignin));
    signinForm.classList.toggle('hidden', !isSignin);
    signupForm.classList.toggle('hidden', isSignin);
    setAuthError('');
  }

  tabSigninBtn.addEventListener('click', () => switchAuthTab('signin'));
  tabSignupBtn.addEventListener('click', () => switchAuthTab('signup'));

  // 密码显示与隐藏按钮（遵循 autofill-sign-in/up-form & forms aria-pressed 规范）
  document.querySelectorAll('.pwd-eye-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.dataset.target);
      if (!input) return;
      const isPwd = input.type === 'password';
      input.type = isPwd ? 'text' : 'password';
      btn.setAttribute('aria-pressed', String(isPwd));
      btn.textContent = isPwd ? '隐藏' : '显示';
    });
  });

  function showAuthScreen() {
    closeOnboardingTour(false);

    // 强行物理关闭所有可能被激发的模态弹窗、侧栏抽屉与浮层，彻底杜绝任何穿透与重叠
    try {
      document.querySelectorAll('dialog[open]').forEach((dlg) => {
        try { dlg.close(); } catch (e) { dlg.removeAttribute('open'); }
      });
      document.getElementById('mobile-drawer-backdrop')?.classList.add('hidden');
      document.getElementById('phone-cmd-quick-drawer')?.classList.add('hidden');
      document.getElementById('mobile-fullscreen-settings')?.classList.add('hidden');
      document.querySelectorAll('[popover]').forEach((p) => {
        try { if (typeof p.hidePopover === 'function') p.hidePopover(); } catch (e) {}
      });
    } catch (e) {}

    appShell.classList.add('hidden');
    appShell.style.removeProperty('display');

    authGate.classList.remove('hidden', 'auth-gate-opening');
    authGate.style.removeProperty('display');
    setAuthError('');
    dismissBootSplash();
  }
  window.__showAuthScreen = showAuthScreen;

  const signinBtn = document.getElementById('signin-submit-btn');
  const signinSpinner = document.getElementById('signin-btn-spinner');
  const signinBtnText = document.getElementById('signin-btn-text');
  const signupBtn = document.getElementById('signup-submit-btn');
  const signupSpinner = document.getElementById('signup-btn-spinner');
  const signupBtnText = document.getElementById('signup-btn-text');
  const quickExpBtn = document.getElementById('quick-exp-btn');
  const fillAdminCredsBtn = document.getElementById('fill-admin-creds-btn');

  if (fillAdminCredsBtn) {
    fillAdminCredsBtn.addEventListener('click', () => {
      switchAuthTab('signin');
      const emailInput = document.getElementById('signin-email');
      const pwdInput = document.getElementById('signin-password');
      if (emailInput) {
        emailInput.value = 'admin@star.love';
        emailInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
      if (pwdInput) {
        pwdInput.value = 'admin123456';
        pwdInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
      setAuthError('');
      showToast('已自动填入内置站长管理凭据！点击「登录进入恋庭」即可进入后台');
      const submitBtn = document.getElementById('signin-submit-btn');
      if (submitBtn) {
        submitBtn.focus();
        submitBtn.style.transition = 'box-shadow 0.25s ease, transform 0.25s ease';
        submitBtn.style.boxShadow = '0 0 0 4px rgba(245, 158, 11, 0.45)';
        submitBtn.style.transform = 'scale(1.02)';
        setTimeout(() => {
          submitBtn.style.boxShadow = '';
          submitBtn.style.transform = '';
        }, 1200);
      }
    });
  }

  signinForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    setAuthError('');
    if (signinBtn) signinBtn.disabled = true;
    if (signinSpinner) signinSpinner.classList.remove('hidden');
    if (signinBtnText) signinBtnText.textContent = '正在推门进入…';
    try {
      resetClientWorkspaceState();
      const res = await apiJson('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: document.getElementById('signin-email').value,
          password: document.getElementById('signin-password').value
        })
      });
      clearBootSnapshot();
      applyAuthLoginPayload(res, { persistDefault: true, rememberGuest: false });
      signinForm.reset();
      await enterWorkspace();
      if (res.user?.is_admin || res.user?.role === 'admin') {
        showToast('👑 欢迎归来，站长！管理后台与全局特权已就绪');
      }
    } catch (err) {
      setAuthError(err.message || '登录失败，请检查账号密码');
    } finally {
      if (signinBtn) signinBtn.disabled = false;
      if (signinSpinner) signinSpinner.classList.add('hidden');
      if (signinBtnText) signinBtnText.textContent = '登录进入恋庭';
    }
  });

  signupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    setAuthError('');
    if (signupBtn) signupBtn.disabled = true;
    if (signupSpinner) signupSpinner.classList.remove('hidden');
    if (signupBtnText) signupBtnText.textContent = '正在创建并进入…';
    try {
      resetClientWorkspaceState();
      const res = await apiJson('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          avatar: document.getElementById('signup-avatar').value,
          nickname: document.getElementById('signup-name').value,
          email: document.getElementById('signup-email').value,
          password: document.getElementById('signup-password').value
        })
      });
      clearBootSnapshot();
      applyAuthLoginPayload(res, { persistDefault: true, rememberGuest: false });
      signupForm.reset();
      document.getElementById('signup-avatar').value = '星';
      await enterWorkspace();
      showToast('新账号创建成功！现在就可以开始体验角色扮演与智能对话！');
    } catch (err) {
      setAuthError(err.message || '注册失败，请检查填写内容');
    } finally {
      if (signupBtn) signupBtn.disabled = false;
      if (signupSpinner) signupSpinner.classList.add('hidden');
      if (signupBtnText) signupBtnText.textContent = '创建专属账号（永久保存聊天与记忆）';
    }
  });

  if (quickExpBtn) {
    quickExpBtn.addEventListener('click', async () => {
      setAuthError('');
      const textEl = quickExpBtn.querySelector('.quick-exp-text strong');
      const origText = textEl ? textEl.textContent : '免密极速体验';
      quickExpBtn.disabled = true;
      if (textEl) textEl.textContent = '正在开启随身极速体验…';
      try {
        resetClientWorkspaceState();
        let authRes = null;
        const isStandalone = Boolean(window.__isStaticLiveDemo) || window.location.protocol === 'file:' || Boolean(window.AndroidAppBridge);
        if (isStandalone) {
          let nickname = '星语漫游者';
          if (window.AndroidAppBridge && typeof window.AndroidAppBridge.getAuthUserJson === 'function') {
            try {
              const prevUser = JSON.parse(window.AndroidAppBridge.getAuthUserJson() || '{}');
              if (prevUser?.nickname) nickname = prevUser.nickname;
            } catch {}
          }
          const guestUser = {
            id: 'user_exp_' + Math.random().toString(36).slice(2, 10),
            nickname: nickname,
            avatar: '星',
            email: 'experience@star.local',
            role: 'user',
            membership: {
              tier: 'standard',
              card_type: 'standard',
              tier_name: '🌟 星语旅人',
              is_vip: true,
              has_active_card: true,
              can_bind_own_api: true,
              can_use_online: true,
              free_experience_mode: true,
              billing_enabled: false,
              remaining_text: ''
            }
          };
          authRes = {
            authenticated: true,
            user: guestUser,
            token: 'star_exp_token_' + Date.now()
          };
        } else {
          try {
            authRes = await apiJson('/api/auth/demo-login', {
              method: 'POST',
              body: JSON.stringify({ guest_user_id: '' })
            });
          } catch (netErr) {
            authRes = {
              authenticated: true,
              user: {
                id: 'user_exp_' + Math.random().toString(36).slice(2, 10),
                nickname: '星语漫游者',
                avatar: '星',
                email: 'experience@star.local',
                role: 'user',
                membership: {
                  tier: 'standard',
                  tier_name: '🌟 体验旅人',
                  is_vip: true,
                  free_experience_mode: true
                }
              },
              token: 'star_exp_token_' + Date.now()
            };
          }
        }
        if (authRes && authRes.user) {
          clearBootSnapshot();
          applyAuthLoginPayload(authRes, { persistDefault: true, rememberGuest: true });
          await enterWorkspace();
          showToast('✨ 欢迎来到星语恋庭随身版！已为你开启免密体验');
        }
      } catch (err) {
        setAuthError(err.message || '免密体验启动失败，请稍后重试');
      } finally {
        quickExpBtn.disabled = false;
        if (textEl && origText) textEl.textContent = origText;
      }
    });
  }

  if (quickDemoLoginBtn) {
    quickDemoLoginBtn.addEventListener('click', async () => {
      setAuthError('系统已启用严格注册模式，请注册正式账号后登录进入');
    });
  }

  if (freshGuestLoginBtn) {
    freshGuestLoginBtn.addEventListener('click', async () => {
      setAuthError('');
      const origLabel = freshGuestLoginBtn.textContent;
      freshGuestLoginBtn.disabled = true;
      freshGuestLoginBtn.textContent = '正在创建全新独立访客号，请稍候…';
      try {
        resetClientWorkspaceState();
        const res = await apiJson('/api/auth/demo-login', {
          method: 'POST',
          body: JSON.stringify({ guest_user_id: '' })
        });
        // 新开测试访客仅绑定当前浏览器标签页，不影响其他打开的标签页账户
        applyAuthLoginPayload(res, { persistDefault: false, rememberGuest: false });
        await enterWorkspace();
        showToast('已开启全新独立访客号，与之前的聊天记录完全隔离！');
      } catch (err) {
        setAuthError(err.message);
      } finally {
        freshGuestLoginBtn.disabled = false;
        freshGuestLoginBtn.textContent = origLabel;
      }
    });
  }

  let isSwitchingAccountOverlay = false;

  function dismissAccountSwitchOverlay() {
    if (!isSwitchingAccountOverlay || !state.user) return false;
    isSwitchingAccountOverlay = false;
    authGate.classList.add('hidden');
    appShell.classList.remove('hidden');
    document.getElementById('auth-back-to-chat-btn')?.classList.add('hidden');
    document.getElementById('auth-close-x-btn')?.classList.add('hidden');
    document.getElementById('auth-confirm-signout-btn')?.classList.add('hidden');
    setAuthError('');
    showToast('已回到刚才的聊天对话');
    return true;
  }

  async function performAccountLogout() {
    window.__closeMobileDrawers?.();
    if (state.user) {
      // 无损打开账号切换面板：不提前吊销原登录令牌、不卸载当前聊天，随时可按 Esc / ✕ / 返回键一键回到原对话
      isSwitchingAccountOverlay = true;
      setAuthError('');
      appShell.classList.add('hidden');
      authGate.classList.remove('hidden');
      document.getElementById('auth-back-to-chat-btn')?.classList.remove('hidden');
      document.getElementById('auth-close-x-btn')?.classList.remove('hidden');
      document.getElementById('auth-confirm-signout-btn')?.classList.remove('hidden');
      if (!window.matchMedia('(max-width: 860px)').matches) {
        document.getElementById('signin-email')?.focus();
      }
      return;
    }
    showAuthScreen();
  }

  document.getElementById('auth-back-to-chat-btn')?.addEventListener('click', () => {
    dismissAccountSwitchOverlay();
  });
  document.getElementById('auth-close-x-btn')?.addEventListener('click', () => {
    dismissAccountSwitchOverlay();
  });
  document.getElementById('auth-confirm-signout-btn')?.addEventListener('click', async () => {
    const curNick = state.user?.nickname || '当前账号';
    const ok = await askUserConfirm({
      title: '确认退出当前账号',
      message: `确定要退出「${curNick}」的登录状态吗？`,
      confirmText: '确认退出登录',
      danger: true
    });
    if (!ok) return;
    isSwitchingAccountOverlay = false;
    try {
      sessionStorage.setItem('manual_account_switch', '1');
    } catch {}
    await apiJson('/api/auth/logout', { method: 'POST' }).catch(() => {});
    if (window.AndroidAppBridge && typeof window.AndroidAppBridge.clearAuthCredentials === 'function') {
      try { window.AndroidAppBridge.clearAuthCredentials(); } catch {}
    }
    clearBootSnapshot();
    resetClientWorkspaceState();
    window.__starAuthStore?.clearTabSession(true);
    document.getElementById('auth-confirm-signout-btn')?.classList.add('hidden');
    document.getElementById('auth-close-x-btn')?.classList.add('hidden');
    showAuthScreen();
    showToast('已安全退出登录，可登录其他账号或免注册畅玩');
  });

  // 全局 Escape 保底关闭：支持按 Esc 随时退出账号切换层，并确保所有模态弹窗（含内部搜索框聚焦时）均可按 Esc 关闭
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const openDialogs = Array.from(document.querySelectorAll('dialog[open]'));
    if (openDialogs.length > 0) {
      const topDialog = openDialogs[openDialogs.length - 1];
      e.preventDefault();
      topDialog.close();
      return;
    }
    if (isSwitchingAccountOverlay && !authGate.classList.contains('hidden')) {
      e.preventDefault();
      dismissAccountSwitchOverlay();
    }
  });

  logoutBtn.addEventListener('click', performAccountLogout);
  document.getElementById('ds-menu-logout-btn')?.addEventListener('click', () => {
    const pop = document.getElementById('ds-user-popover');
    if (pop && typeof pop.hidePopover === 'function') {
      try {
        pop.hidePopover();
      } catch {}
    }
    performAccountLogout();
  });

  // ================= 2. 4 步零门槛新手引导模式（全白话说明，首次进入自动弹出） =================
  const TOUR_STEPS = [
    {
      anchorId: 'tour-anchor-persona',
      ensureLeftOpen: true,
      title: '第一步：选一位喜欢的角色（或自己创建）',
      desc: '点击左侧任意角色就能直接开聊！也可以点上方的「换剧本」体验多幕互动剧，或点「+ 创建新角色」定制专属伴侣。'
    },
    {
      anchorId: 'tour-anchor-composer',
      ensureLeftOpen: false,
      title: '第二步：直接打字聊天 & 帮我回一句',
      desc: '像平时聊天一样输入文字即可发送；不知道聊什么时，点左下角「帮我回一句」就能插入台词灵感或让对方主动找话题。'
    },
    {
      anchorId: 'tour-anchor-tools',
      ensureLeftOpen: false,
      title: '第三步：查看好感度日记、记忆与专属设定',
      desc: '点击右上角「养成·记忆·设定」，可以偷看角色为你写的私密日记、管理 TA 记住的事，或给当前对话写专属设定。'
    },
    {
      anchorId: 'user-profile-bar',
      ensureLeftOpen: true,
      title: '第四步：改一个你在故事里的名字',
      desc: '点击左下角个人卡片修改你的名字，所有角色都会立刻改口叫你！点旁边的 还能选配音、关闭/开启接话选项或绑定个人密钥。'
    }
  ];

  const supportsNativePopover = Object.hasOwn(HTMLElement.prototype, 'popover');

  function clearTourSpotlight() {
    document.querySelectorAll('.tour-spotlight-target').forEach((el) => {
      el.classList.remove('tour-spotlight-target');
    });
  }

  function renderTourStep() {
    const total = TOUR_STEPS.length;
    const step = TOUR_STEPS[state.tourIndex];
    if (!step) return;

    const isNarrowViewport = window.matchMedia('(max-width: 860px)').matches;
    if (!isNarrowViewport && step.ensureLeftOpen && appShell.classList.contains('left-collapsed')) {
      appShell.classList.remove('left-collapsed');
      expandLeftBtn.classList.add('hidden');
    }

    clearTourSpotlight();
    const targetEl = document.getElementById(step.anchorId);
    if (targetEl && (!isNarrowViewport || !targetEl.closest('#left-sidebar'))) {
      targetEl.classList.add('tour-spotlight-target');
      targetEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }

    tourStepBadge.textContent = `新手向导 ${state.tourIndex + 1} / ${total}`;
    tourStepTitle.textContent = step.title;
    tourStepDesc.textContent = step.desc;

    tourDotsEl.innerHTML = TOUR_STEPS.map(
      (_, i) => `<span class="tour-dot ${i === state.tourIndex ? 'active' : ''}"></span>`
    ).join('');

    tourPrevBtn.disabled = state.tourIndex === 0;
    tourPrevBtn.style.visibility = state.tourIndex === 0 ? 'hidden' : 'visible';
    tourNextBtn.textContent = state.tourIndex === total - 1 ? '开始心动之旅 ' : '下一步 ▸';

    // 将程序焦点引导至向导主操作按钮（遵循 persistent-app-tours 无障碍要求）
    tourNextBtn.focus();
  }

  function startOnboardingTour() {
    if (!tourPopover) return;
    hidePopoverSafe('topbar-more-popover');
    state.tourIndex = 0;
    state.tourActive = true;
    if (supportsNativePopover && typeof tourPopover.showPopover === 'function') {
      try {
        tourPopover.showPopover();
      } catch {
        tourPopover.classList.add('tour-manual-open');
      }
    } else {
      tourPopover.classList.add('tour-manual-open');
    }
    renderTourStep();
  }

  async function closeOnboardingTour(markDone = true) {
    state.tourActive = false;
    clearTourSpotlight();
    if (supportsNativePopover && typeof tourPopover?.hidePopover === 'function') {
      try {
        tourPopover.hidePopover();
      } catch {}
    }
    tourPopover?.classList.remove('tour-manual-open');

    if (markDone && state.user) {
      chatInput.focus();
      if (!state.user.onboarding_done) {
        try {
          const res = await apiJson('/api/auth/onboarding', {
            method: 'POST',
            body: JSON.stringify({ done: true })
          });
          state.user = res.user;
        } catch {}
      }
    }
  }

  document.getElementById('start-tour-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    hidePopoverSafe('topbar-more-popover');
    setTimeout(() => startOnboardingTour(), 20);
  });
  tourPrevBtn.addEventListener('click', () => {
    if (state.tourIndex > 0) {
      state.tourIndex -= 1;
      renderTourStep();
    }
  });
  tourNextBtn.addEventListener('click', () => {
    if (state.tourIndex < TOUR_STEPS.length - 1) {
      state.tourIndex += 1;
      renderTourStep();
    } else {
      closeOnboardingTour(true);
      showToast('向导已完成！现在试着给角色发第一句话，或点击快捷灵感吧');
    }
  });
  tourSkipBtn.addEventListener('click', (e) => {
    e.preventDefault();
    closeOnboardingTour(true);
  });

  // 快捷互动灵感小魔法点击插入（仅插入带有模板文本的胶囊）
  document.querySelectorAll('.magic-chip[data-tpl]').forEach((chip) => {
    chip.addEventListener('click', () => {
      const tpl = chip.dataset.tpl || '';
      chatInput.value = chatInput.value ? `${chatInput.value}${tpl}` : tpl;
      syncComposerEmptyState();
      chatInput.focus();
    });
  });

  // ================= 3. 模态框点击遮罩回退（遵循 dialog 指南防拖拽选字误关） =================
  function setupDialogLightDismiss(dialog) {
    if (!dialog || 'closedBy' in HTMLDialogElement.prototype) return;
    const isOutside = (event) => {
      const rect = dialog.getBoundingClientRect();
      return (
        event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom
      );
    };
    let pressedOutside = false;
    dialog.addEventListener('pointerdown', (event) => {
      pressedOutside = event.target === dialog && isOutside(event);
    });
    dialog.addEventListener('pointerup', (event) => {
      if (pressedOutside && event.target === dialog && isOutside(event)) {
        dialog.close();
      }
      pressedOutside = false;
    });
  }
  const confirmActionDialog = document.getElementById('confirm-action-dialog');
  [
    personaDialog,
    importHistoryDialog,
    settingsDialog,
    userPersonaDialog,
    plazaDialog,
    theaterDialog,
    quoteCardDialog,
    fimDialog,
    codePreviewDialog,
    attachmentPreviewDialog,
    dsShareDialog,
    adminConsoleDialog,
    confirmActionDialog
  ]
    .filter(Boolean)
    .forEach(setupDialogLightDismiss);

  // 通用高风险操作二次确认模态框（返回 Promise<boolean>）
  let pendingConfirmResolver = null;
  function resolvePendingConfirm(result) {
    if (pendingConfirmResolver) {
      const fn = pendingConfirmResolver;
      pendingConfirmResolver = null;
      fn(Boolean(result));
    }
    if (confirmActionDialog?.open) {
      confirmActionDialog.close();
    }
  }
  document.getElementById('close-confirm-dialog')?.addEventListener('click', () => resolvePendingConfirm(false));
  document.getElementById('cancel-confirm-dialog')?.addEventListener('click', () => resolvePendingConfirm(false));
  document.getElementById('ok-confirm-dialog')?.addEventListener('click', () => resolvePendingConfirm(true));
  confirmActionDialog?.addEventListener('close', () => {
    if (pendingConfirmResolver) {
      const fn = pendingConfirmResolver;
      pendingConfirmResolver = null;
      fn(false);
    }
  });

  function askUserConfirm({
    title = '请确认本次操作',
    message = '确定要继续执行此操作吗？',
    confirmText = '确认执行',
    danger = true
  } = {}) {
    if (!confirmActionDialog || typeof confirmActionDialog.showModal !== 'function') {
      return Promise.resolve(window.confirm(message));
    }
    if (pendingConfirmResolver) {
      resolvePendingConfirm(false);
    }
    const titleEl = document.getElementById('confirm-dialog-title');
    const msgEl = document.getElementById('confirm-dialog-message');
    const okBtn = document.getElementById('ok-confirm-dialog');
    if (titleEl) titleEl.textContent = title;
    if (msgEl) msgEl.textContent = message;
    if (okBtn) {
      okBtn.textContent = confirmText;
      okBtn.classList.toggle('danger-confirm-btn', danger !== false);
    }
    return new Promise((resolve) => {
      pendingConfirmResolver = resolve;
      confirmActionDialog.showModal();
      document.getElementById('cancel-confirm-dialog')?.focus();
    });
  }

  // 全局中文表单必填与格式校验提示（消除浏览器英文 "Please fill out this field."）
  function resolveFieldLabelText(field) {
    if (!field) return '此必填项';
    if (field.id) {
      const lbl = document.querySelector(`label[for="${CSS.escape(field.id)}"]`);
      if (lbl) {
        return lbl.textContent.replace(/\*/g, '').replace(/（.*?）/g, '').trim() || '此必填项';
      }
    }
    return field.getAttribute('aria-label') || field.placeholder || '此必填项';
  }

  document.addEventListener(
    'invalid',
    (e) => {
      const el = e.target;
      if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)) {
        return;
      }
      el.setCustomValidity('');
      const v = el.validity;
      const name = resolveFieldLabelText(el);
      if (v.valueMissing) {
        el.setCustomValidity(`请填写「${name}」`);
      } else if (v.typeMismatch && el.type === 'email') {
        el.setCustomValidity(`请输入格式正确的邮箱地址（例如 name@example.com）`);
      } else if (v.tooShort && el.minLength > 0) {
        el.setCustomValidity(`「${name}」至少需要输入 ${el.minLength} 个字符`);
      } else if (v.tooLong && el.maxLength > 0) {
        el.setCustomValidity(`「${name}」不能超过 ${el.maxLength} 个字符`);
      }
    },
    true
  );

  document.addEventListener(
    'input',
    (e) => {
      const el = e.target;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
        if (el.validationMessage) el.setCustomValidity('');
      }
    },
    true
  );

  // 确定性 Popover 触发器接管：彻底消除按 Esc 关闭 <dialog> 后首次点击被吞，并保证视口内精准贴靠显示
  // 确定性 Popover 触发器接管：原生 Top-Layer + 精确固定坐标双保险，彻底杜绝任何视口挤压或被吞点击
  function positionPopoverNearTrigger(triggerEl, popEl) {
    if (!triggerEl || !popEl) return;
    const tRect = triggerEl.getBoundingClientRect();
    const pRect = popEl.getBoundingClientRect();
    const vw = window.innerWidth || document.documentElement.clientWidth;
    const vh = window.innerHeight || document.documentElement.clientHeight;

    popEl.style.position = 'fixed';
    popEl.style.margin = '0';
    popEl.style.inset = 'auto';
    popEl.style.positionAnchor = 'unset';
    popEl.style.positionArea = 'none';

    const popW = Math.min(Math.max(pRect.width || 228, 204), vw - 16);
    const popH = Math.min(pRect.height || 340, vh - 24);

    let left = tRect.right - popW;
    if (tRect.left < vw * 0.45) {
      left = tRect.left;
    }
    left = Math.max(8, Math.min(vw - popW - 8, left));

    let top = tRect.bottom + 8;
    if (tRect.top > vh * 0.55 || top + popH > vh - 8) {
      top = Math.max(8, tRect.top - popH - 8);
    }
    popEl.style.left = `${Math.round(left)}px`;
    popEl.style.top = `${Math.round(top)}px`;
  }

  function bindDeterministicPopoverTrigger(triggerEl, popoverId) {
    const popEl = document.getElementById(popoverId);
    if (!triggerEl || !popEl) return;
    triggerEl.removeAttribute('popovertarget');
    triggerEl.setAttribute('aria-expanded', 'false');
    popEl.addEventListener('toggle', (ev) => {
      const openNow = ev.newState === 'open';
      popEl.classList.toggle('manual-popover-open', openNow);
      triggerEl.setAttribute('aria-expanded', openNow ? 'true' : 'false');
    });
    triggerEl.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const isOpen = popEl.matches(':popover-open') || popEl.classList.contains('manual-popover-open');
      if (isOpen) {
        popEl.classList.remove('manual-popover-open');
        triggerEl.setAttribute('aria-expanded', 'false');
        try {
          popEl.hidePopover?.();
        } catch {}
      } else {
        popEl.classList.add('manual-popover-open');
        triggerEl.setAttribute('aria-expanded', 'true');
        try {
          popEl.showPopover?.();
        } catch {}
        positionPopoverNearTrigger(triggerEl, popEl);
      }
    });
  }

  document.addEventListener('click', (ev) => {
    const target = ev.target;
    if (!(target instanceof Element)) return;
    ['topbar-more-popover', 'magic-quick-popover', 'ds-user-popover', 'attach-picker-popover'].forEach((pid) => {
      const pEl = document.getElementById(pid);
      if (!pEl || !pEl.classList.contains('manual-popover-open')) return;
      if (pEl.contains(target)) return;
      if (
        (pid === 'topbar-more-popover' && target.closest('#topbar-more-btn')) ||
        (pid === 'magic-quick-popover' && target.closest('#magic-menu-trigger-btn')) ||
        (pid === 'ds-user-popover' && (target.closest('#ds-profile-btn') || target.closest('.ds-dots-btn'))) ||
        (pid === 'attach-picker-popover' && target.closest('#attach-file-btn'))
      ) {
        return;
      }
      hidePopoverSafe(pid);
    });
  });
  bindDeterministicPopoverTrigger(document.getElementById('topbar-more-btn'), 'topbar-more-popover');
  bindDeterministicPopoverTrigger(document.getElementById('magic-menu-trigger-btn'), 'magic-quick-popover');
  bindDeterministicPopoverTrigger(document.getElementById('ds-profile-btn'), 'ds-user-popover');
  bindDeterministicPopoverTrigger(document.getElementById('attach-file-btn'), 'attach-picker-popover');
  document.querySelectorAll('.ds-dots-btn[popovertarget="ds-user-popover"]').forEach((btn) => {
    bindDeterministicPopoverTrigger(btn, 'ds-user-popover');
  });

  let lastCompositionEndAt = null;
  chatInput.addEventListener('compositionend', (event) => {
    lastCompositionEndAt = event.timeStamp;
  });

  chatInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (event.isComposing || event.keyCode === 229) return;
      if (lastCompositionEndAt !== null && Math.abs(event.timeStamp - lastCompositionEndAt) < 50) {
        return;
      }
      if (state.isStreaming) {
        showToast('正在生成回复中，请稍候或点击「轻声止步」后再发送（草稿已为你保留）');
        return;
      }
      if (!chatInput.value.trim() && state.pendingAttachments.length === 0) {
        return;
      }
      chatForm.requestSubmit();
    }
  });

  // ================= 4. 三态主题切换（遵循 modern-web-guidance: dark-mode，同步 html.style.colorScheme 并监听系统变化） =================
  const darkMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

  function applyColorSchemeValue(val) {
    const meta = document.querySelector('meta[name="color-scheme"]');
    const cssScheme = val === 'light' || val === 'dark' ? val : 'light dark';
    try {
      if (val === 'system') localStorage.removeItem('color-scheme');
      else localStorage.setItem('color-scheme', val);
    } catch {}
    if (meta) meta.content = cssScheme;
    document.documentElement.style.colorScheme = cssScheme;
    syncThemeControls();
  }

  function syncThemeControls() {
    const meta = document.querySelector('meta[name="color-scheme"]');
    let stored = null;
    try {
      stored = localStorage.getItem('color-scheme');
    } catch {}
    const currentVal = stored === 'light' || stored === 'dark' ? stored : 'system';
    const sysDark = darkMediaQuery.matches;
    const isEffectiveDark = currentVal === 'dark' || (currentVal === 'system' && sysDark);
    const sysLabel = document.getElementById('theme-system-label');
    if (sysLabel) {
      sysLabel.textContent = `跟随系统（当前${sysDark ? '深色' : '浅色'}）`;
    }
    document.querySelectorAll('input[name="theme-scheme"]').forEach((radio) => {
      radio.checked = radio.value === currentVal;
    });
    const cssScheme = stored === 'light' || stored === 'dark' ? stored : 'light dark';
    if (meta) meta.content = cssScheme;
    document.documentElement.style.colorScheme = cssScheme;

    const quickThemeBtn = document.getElementById('ds-quick-theme-btn');
    if (quickThemeBtn) {
      quickThemeBtn.innerHTML = isEffectiveDark
      ? '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>'
      : '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>';
      quickThemeBtn.title = isEffectiveDark ? '当前深色模式 · 点击切换为纯净浅色' : '当前浅色模式 · 点击切换为极客深色';
    }
    const dsMenuThemeLbl = document.getElementById('ds-menu-theme-label');
    if (dsMenuThemeLbl) {
      const modeName = currentVal === 'light' ? '浅色纯白' : currentVal === 'dark' ? '极客深色' : '跟随系统';
      dsMenuThemeLbl.textContent = `外观主题：${modeName}（点此切换）`;
    }
  }

  document.querySelectorAll('input[name="theme-scheme"]').forEach((radio) => {
    radio.addEventListener('change', (e) => {
      applyColorSchemeValue(e.target.value);
    });
  });

  darkMediaQuery.addEventListener('change', () => syncThemeControls());
  window.addEventListener('storage', (e) => {
    if (e.key === 'color-scheme') syncThemeControls();
  });
  syncThemeControls();

  document.getElementById('ds-quick-theme-btn')?.addEventListener('click', () => {
    let stored = null;
    try {
      stored = localStorage.getItem('color-scheme');
    } catch {}
    const curDark = stored === 'dark' || (stored !== 'light' && darkMediaQuery.matches);
    const next = curDark ? 'light' : 'dark';
    applyColorSchemeValue(next);
    showToast(next === 'dark' ? '已切换至 DeepSeek 官方极客深色主题' : '已切换至 DeepSeek 官方纯净浅色主题');
  });

  document.getElementById('ds-menu-theme-cycle-btn')?.addEventListener('click', () => {
    let stored = null;
    try {
      stored = localStorage.getItem('color-scheme');
    } catch {}
    const order = ['light', 'dark', 'system'];
    const cur = stored === 'light' || stored === 'dark' ? stored : 'system';
    const next = order[(order.indexOf(cur) + 1) % order.length];
    applyColorSchemeValue(next);
    const labelMap = { light: '浅色纯白', dark: '极客深色', system: '跟随系统' };
    showToast(`已切换外观主题为：${labelMap[next]}`);
  });

  // ================= 5. 侧栏与抽屉控制（持久化折叠状态 + 顶栏兜底入口 + 宽屏默认展开右侧面板） =================
  const collapsedQuickNav = document.getElementById('collapsed-quick-nav');
  function setLeftSidebarCollapsed(collapsed, persist = true) {
    const isMobileViewport = window.matchMedia('(max-width: 860px)').matches;
    if (isMobileViewport && !collapsed && !appShell.classList.contains('right-collapsed')) {
      appShell.classList.add('right-collapsed');
      appShell.classList.remove('artifacts-wide');
      toggleRightBtn?.classList.remove('active');
    }
    appShell.classList.toggle('left-collapsed', collapsed);
    expandLeftBtn.classList.toggle('hidden', !collapsed);
    expandLeftBtn.setAttribute('aria-expanded', String(!collapsed));
    collapsedQuickNav?.classList.toggle('hidden', !collapsed);
    if (isMobileViewport) {
      const bothClosed = collapsed && appShell.classList.contains('right-collapsed');
      document.getElementById('mobile-drawer-backdrop')?.classList.toggle('hidden', bothClosed);
    } else if (persist) {
      try {
        localStorage.setItem('left_sidebar_collapsed_v1', collapsed ? '1' : '0');
      } catch {}
    }
  }

  function setRightPanelCollapsed(collapsed, persist = true) {
    const isMobileViewport = window.matchMedia('(max-width: 860px)').matches;
    if (isMobileViewport && !collapsed && !appShell.classList.contains('left-collapsed')) {
      appShell.classList.add('left-collapsed');
      expandLeftBtn.classList.remove('hidden');
      expandLeftBtn.setAttribute('aria-expanded', 'false');
      collapsedQuickNav?.classList.remove('hidden');
    }
    appShell.classList.toggle('right-collapsed', collapsed);
    if (collapsed) {
      appShell.classList.remove('artifacts-wide');
    }
    toggleRightBtn?.classList.toggle('active', !collapsed);
    const rightPanelEl = document.getElementById('right-panel');
    if (rightPanelEl) {
      if (isMobileViewport) {
        if (!collapsed) {
          rightPanelEl.style.setProperty('transform', 'translate3d(0, 0, 0)', 'important');
          rightPanelEl.style.setProperty('pointer-events', 'auto', 'important');
          rightPanelEl.style.setProperty('visibility', 'visible', 'important');
          rightPanelEl.style.setProperty('opacity', '1', 'important');
        } else {
          rightPanelEl.style.setProperty('transform', 'translate3d(105%, 0, 0)', 'important');
          rightPanelEl.style.setProperty('pointer-events', 'none', 'important');
        }
      } else {
        rightPanelEl.style.removeProperty('transform');
        rightPanelEl.style.removeProperty('pointer-events');
        rightPanelEl.style.removeProperty('visibility');
        rightPanelEl.style.removeProperty('opacity');
      }
    }
    if (isMobileViewport) {
      const bothClosed = collapsed && appShell.classList.contains('left-collapsed');
      document.getElementById('mobile-drawer-backdrop')?.classList.toggle('hidden', bothClosed);
    } else if (persist) {
      try {
        localStorage.setItem('right_panel_collapsed_v1', collapsed ? '1' : '0');
      } catch {}
    }
  }

  // 初始化恢复桌面端左侧栏折叠状态
  try {
    if (!window.matchMedia('(max-width: 860px)').matches) {
      const savedLeft = localStorage.getItem('left_sidebar_collapsed_v1') === '1';
      setLeftSidebarCollapsed(savedLeft, false);
    }
  } catch {}

  toggleLeftBtn.addEventListener('click', () => setLeftSidebarCollapsed(true, true));
  expandLeftBtn.addEventListener('click', () => setLeftSidebarCollapsed(false, true));

  // 左侧栏收起时的顶栏兜底快捷入口绑定
  document.getElementById('topbar-collapsed-new-chat-btn')?.addEventListener('click', () => {
    if (state.uiMode === 'phone-agent') {
      window.PhoneAgent?.resetTaskWorkspace?.();
    } else if (state.uiMode === 'deepseek') {
      document.getElementById('ds-new-chat-btn')?.click();
    } else {
      document.getElementById('new-chat-btn')?.click();
    }
  });
  document.getElementById('topbar-collapsed-create-persona-btn')?.addEventListener('click', () => {
    openPersonaModalForCreate();
  });
  document.getElementById('topbar-collapsed-plaza-btn')?.addEventListener('click', () => {
    document.getElementById('open-plaza-btn')?.click();
  });
  document.getElementById('topbar-collapsed-settings-btn')?.addEventListener('click', () => {
    openSettingsModal(false);
  });
  document.getElementById('topbar-collapsed-account-btn')?.addEventListener('click', () => {
    performAccountLogout();
  });
  document.getElementById('more-create-persona-btn')?.addEventListener('click', () => {
    hidePopoverSafe('topbar-more-popover');
    openPersonaModalForCreate();
  });
  document.getElementById('more-new-chat-btn')?.addEventListener('click', () => {
    hidePopoverSafe('topbar-more-popover');
    if (state.uiMode === 'phone-agent') {
      window.PhoneAgent?.resetTaskWorkspace?.();
    } else if (state.uiMode === 'deepseek') {
      document.getElementById('ds-new-chat-btn')?.click();
    } else {
      document.getElementById('new-chat-btn')?.click();
    }
  });
  document.getElementById('more-switch-account-btn')?.addEventListener('click', () => {
    hidePopoverSafe('topbar-more-popover');
    performAccountLogout();
  });
  document.getElementById('more-open-square-btn')?.addEventListener('click', () => {
    hidePopoverSafe('topbar-more-popover');
    document.getElementById('open-plaza-btn')?.click();
  });

  function openRightTab(tabId, persist = true) {
    const isDs = state.uiMode === 'deepseek' || state.uiMode === 'phone-agent';
    let safeTabId = tabId;
    if (isDs && safeTabId === 'nurture-tab') {
      safeTabId = 'memory-tab';
    } else if (!isDs && (safeTabId === 'ds-artifacts-tab' || safeTabId === 'ds-suite-tab')) {
      safeTabId = 'nurture-tab';
    }
    setRightPanelCollapsed(false, persist);
    appShell.classList.toggle('artifacts-wide', isDs && safeTabId === 'ds-artifacts-tab');
    document.querySelectorAll('.tab-btn').forEach((btn) => {
      const active = btn.dataset.tab === safeTabId;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', String(active));
    });
    const nurtureEl = document.getElementById('nurture-tab');
    const memoryEl = document.getElementById('memory-tab');
    const personaEl = document.getElementById('persona-tab');
    const dsSuiteEl = document.getElementById('ds-suite-tab');
    const dsArtEl = document.getElementById('ds-artifacts-tab');
    if (nurtureEl) nurtureEl.classList.toggle('hidden', safeTabId !== 'nurture-tab');
    if (memoryEl) memoryEl.classList.toggle('hidden', safeTabId !== 'memory-tab');
    if (personaEl) personaEl.classList.toggle('hidden', safeTabId !== 'persona-tab');
    if (dsSuiteEl) dsSuiteEl.classList.toggle('hidden', safeTabId !== 'ds-suite-tab');
    if (dsArtEl) dsArtEl.classList.toggle('hidden', safeTabId !== 'ds-artifacts-tab');

    // 打开面板时立即同步最新数据并复位滚动条，杜绝移动端抽屉打开后内容空白或停留在不可见偏移处
    try {
      if (safeTabId === 'nurture-tab') {
        renderNurturingAndDiary();
        if (nurtureEl) nurtureEl.scrollTop = 0;
      } else if (safeTabId === 'memory-tab') {
        renderTelemetryAndMemories();
        renderLorebooks();
        if (memoryEl) memoryEl.scrollTop = 0;
      } else if (safeTabId === 'persona-tab') {
        populatePersonaEditor();
        if (personaEl) personaEl.scrollTop = 0;
      } else if (safeTabId === 'ds-suite-tab') {
        renderDeepSeekSuiteTelemetry();
        if (dsSuiteEl) dsSuiteEl.scrollTop = 0;
      }
    } catch {}
  }

  toggleRightBtn.addEventListener('click', () => {
    if (appShell.classList.contains('right-collapsed')) {
      const nurtureHidden = document.getElementById('nurture-tab')?.classList.contains('hidden');
      const memHidden = document.getElementById('memory-tab')?.classList.contains('hidden');
      const perHidden = document.getElementById('persona-tab')?.classList.contains('hidden');
      if (state.uiMode === 'roleplay' && nurtureHidden && memHidden && perHidden) {
        openRightTab('nurture-tab');
        return;
      }
      if (state.uiMode === 'roleplay') {
        openRightTab('nurture-tab');
      } else {
        openRightTab('memory-tab');
      }
    } else {
      setRightPanelCollapsed(true, true);
    }
  });
  closeRightBtn.addEventListener('click', () => {
    setRightPanelCollapsed(true, true);
  });
  memoryStatusPill.addEventListener('click', () => openRightTab('memory-tab'));
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => openRightTab(btn.dataset.tab));
  });

  // ================= 6. 用户资料、通道状态与选项偏好开关 =================
  function formatDateTimeShort(ts) {
    if (!ts) return '-';
    const d = new Date(Number(ts));
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function isShowFollowUpsEnabled() {
    try {
      return localStorage.getItem('pref_show_followups') !== '0';
    } catch {
      return true;
    }
  }

  function syncFollowUpsToggleUi() {
    const enabled = isShowFollowUpsEnabled();
    const moreBtn = document.getElementById('toggle-followups-btn');
    if (moreBtn) {
      moreBtn.textContent = enabled ? '回复选项：开启' : '回复选项：已关闭';
      moreBtn.setAttribute('aria-pressed', String(enabled));
    }
    const chk = document.getElementById('st-show-followups-chk');
    if (chk) {
      chk.checked = enabled;
    }
  }

  function setShowFollowUpsEnabled(nextVal, notify = false) {
    const on = Boolean(nextVal);
    try {
      localStorage.setItem('pref_show_followups', on ? '1' : '0');
    } catch {}
    syncFollowUpsToggleUi();
    if (!on && typeof followUpsEl !== 'undefined' && followUpsEl) {
      followUpsEl.innerHTML = '';
      followUpsEl.classList.add('hidden');
    }
    if (notify) {
      showToast(on ? '已开启每轮结尾推荐选项' : '已关闭每轮结尾推荐选项，随时可在右上角「⋯」或设置重新开启');
    }
  }

  function renderUserAndMembership() {
    const isAdmin = Boolean(state.user?.is_admin || state.user?.role === 'admin');
    window.__isAdminUser = isAdmin;
    window.dispatchEvent(new CustomEvent('user-role-changed'));

    // 全触点全端管理员入口显隐同步（顶栏、更多菜单、移动端设置、桌面设置弹窗与侧栏）
    document.getElementById('open-admin-console-btn')?.classList.toggle('hidden', !isAdmin);
    document.getElementById('ds-menu-admin-btn')?.classList.toggle('hidden', !isAdmin);
    document.getElementById('topbar-admin-btn')?.classList.toggle('hidden', !isAdmin);
    document.getElementById('more-admin-console-btn')?.classList.toggle('hidden', !isAdmin);
    document.getElementById('mfs-item-admin')?.classList.toggle('hidden', !isAdmin);
    document.getElementById('settings-open-admin-btn')?.classList.toggle('hidden', !isAdmin);
    document.getElementById('settings-admin-card')?.classList.toggle('hidden', !isAdmin);

    if (!isAdmin && adminConsoleDialog) {
      if (adminConsoleDialog.open) adminConsoleDialog.close();
      adminConsoleDialog.innerHTML = '';
    }

    if (state.user) {
      const fullNick = state.user.nickname || (isAdmin ? '恋庭主理人' : '星语旅人');
      if (navUserAvatar) navUserAvatar.innerHTML = renderSmartAvatarHtml(state.user.avatar || (isAdmin ? '👑' : '我'), fullNick, 'size-md', true);
      if (navUserNickname) {
        navUserNickname.textContent = isAdmin ? `${fullNick} 👑` : fullNick;
        navUserNickname.title = isAdmin ? `${fullNick} (超级管理员)` : fullNick;
      }
      const dsAv = document.getElementById('ds-nav-avatar');
      const dsNick = document.getElementById('ds-nav-nickname');
      if (dsAv) dsAv.innerHTML = renderSmartAvatarHtml(state.user.avatar || (isAdmin ? '👑' : '我'), fullNick, 'size-md', true);
      if (dsNick) {
        dsNick.textContent = isAdmin ? `${fullNick} 👑` : fullNick;
        dsNick.title = isAdmin ? `${fullNick} (超级管理员)` : fullNick;
      }
      const rawRole = state.user.user_persona?.role || '';
      const curSc =
        state.scripts.find((s) => s.id === state.activeScriptId) || state.scripts[0];
      const effectiveRole =
        !rawRole || rawRole === '命中注定的重逢旅人'
          ? curSc?.player_role || '剧中主角'
          : rawRole;
      const roleStr = isAdmin ? '👑 站长管理' : effectiveRole;
      if (navUserRoleLabel) {
        navUserRoleLabel.textContent = `${roleStr} ▸`;
        navUserRoleLabel.title = roleStr;
      }
      const userBtnEl = document.getElementById('open-user-persona-btn');
      if (userBtnEl) {
        userBtnEl.title = `${fullNick} · ${roleStr}（点击修改我在剧中的名字与身份）`;
      }
    }

    const theaterBtn = document.getElementById('open-theater-btn');
    const theaterLbl = document.getElementById('theater-pill-label');
    if (theaterBtn && theaterLbl) {
      if (state.uiMode !== 'roleplay') {
        theaterBtn.style.setProperty('display', 'none', 'important');
      } else {
        theaterBtn.style.removeProperty('display');
      }
      const hasNote = Boolean(state.activeSession?.director_note && state.activeSession.director_note.trim());
      theaterBtn.classList.toggle('active', hasNote);
      theaterLbl.textContent = hasNote ? '幕次演绎中' : '本剧幕次';
    }

    const p = state.settings.provider || 'demo';
    const hasOwnKey = Boolean(state.settings.has_own_deepseek_key);
    const rawOwnModel = state.settings.own_deepseek_model || 'deepseek-flash';
    const rawLeaf = rawOwnModel.split('/').pop();
    const shortModel = /^deepseek[-_]?flash$/i.test(rawLeaf) ? 'V4.1-Flash' : rawLeaf;

    const dsComposerChip = document.getElementById('ds-composer-api-chip');
    if (dsComposerChip) {
      if (p === 'own_deepseek' && hasOwnKey) {
        dsComposerChip.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"></path></svg><span>我的密钥 (${escapeHtml(shortModel)})</span>`;
      } else if (hasOwnKey) {
        dsComposerChip.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"></path></svg><span>切回我的密钥</span>`;
      } else {
        dsComposerChip.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg><span>聊天设置</span>`;
      }
    }

    const dsOwnBadge = document.getElementById('ds-suite-own-api-badge');
    const dsOwnDesc = document.getElementById('ds-suite-own-api-desc');
    const dsOwnBtn = document.getElementById('ds-suite-own-api-btn');
    if (dsOwnBadge && dsOwnDesc && dsOwnBtn) {
      dsOwnBadge.textContent = hasOwnKey
        ? p === 'own_deepseek'
          ? '正在使用'
          : '已存密钥'
        : '可选配置';
      dsOwnDesc.textContent = hasOwnKey
        ? `已保存您的密钥（${state.settings.own_deepseek_key_masked || 'sk-••••'} · 当前模型 ${shortModel}），DeepSeek 与剧本模式都能直接用！`
        : '直接使用内置通道即可，也可在此绑定自己的 DeepSeek 或硅基流动 API 密钥与自定义模型。';
      dsOwnBtn.textContent = hasOwnKey
        ? '修改或更换我的密钥'
        : '打开聊天设置 / 绑定密钥';
    }

    const proBtn = document.getElementById('toggle-proactive-btn');
    if (proBtn) {
      const proOn = state.activeSession?.proactive_enabled !== 0;
      proBtn.classList.toggle('active', proOn);
      proBtn.setAttribute('aria-pressed', String(proOn));
      proBtn.textContent = proOn ? '主动关怀: 开' : '主动关怀: 关';
    }

    syncFollowUpsToggleUi();

    const dsTitleEl = document.getElementById('ds-topbar-title');
    const dsModelPill = document.getElementById('ds-model-pill');
    const dsThinkOn = state.activeSession ? state.activeSession.ds_thinking !== 0 : true;
    const dsSearchOn = state.activeSession ? state.activeSession.ds_search === 1 : false;
    const dsJsonOn = state.activeSession ? state.activeSession.ds_json_mode === 1 : false;
    const dsToolsOn = state.activeSession ? state.activeSession.ds_tools_enabled !== 0 : true;

    if (dsTitleEl) {
      dsTitleEl.textContent = state.uiMode === 'phone-agent'
        ? '手机辅助'
        : (state.activeSession?.title || '新对话');
    }

    syncLlmModeUi();

    const btnDsThink = document.getElementById('ds-toggle-think');
    const btnDsSearch = document.getElementById('ds-toggle-search');
    const btnDsJson = document.getElementById('ds-toggle-json');
    const chkDsTools = document.getElementById('ds-tools-enable-chk');
    if (btnDsThink) {
      btnDsThink.classList.toggle('active', dsThinkOn);
      btnDsThink.setAttribute('aria-pressed', String(dsThinkOn));
    }
    if (btnDsSearch) {
      btnDsSearch.classList.toggle('active', dsSearchOn);
      btnDsSearch.setAttribute('aria-pressed', String(dsSearchOn));
    }
    if (btnDsJson) {
      btnDsJson.classList.toggle('active', dsJsonOn);
      btnDsJson.setAttribute('aria-pressed', String(dsJsonOn));
    }
    if (chkDsTools) chkDsTools.checked = dsToolsOn;

    if (gatewaySummaryText) {
      if (p === 'demo') {
        gatewaySummaryText.textContent = '内置轻量演绎模式（也可切在线或绑定密钥）';
      } else if (p === 'own_deepseek') {
        gatewaySummaryText.textContent = hasOwnKey ? `我的密钥 (${shortModel})` : '待粘贴我的密钥';
      } else {
        gatewaySummaryText.textContent = '星耀在线模型';
      }
    }
  }

  // ================= DeepSeek 本地直连 与 云端/官方 API 调度引擎 =================
  function syncLlmModeUi() {
    const activeLlmMode = state.llmMode || state.activeSession?.llm_mode || 'local_antigravity';
    const isLocal = activeLlmMode === 'local_antigravity';
    const btnLlmMode = document.getElementById('ds-toggle-llm-mode');
    const labelLlmMode = document.getElementById('ds-llm-mode-label');
    const modeIconSlot = document.getElementById('ds-mode-icon-slot');
    const dsModelPill = document.getElementById('ds-model-pill');
    const dsThinkOn = state.activeSession ? state.activeSession.ds_thinking !== 0 : true;

    const p = state.settings?.provider || 'online';
    const isDsOwn = p === 'own_deepseek';
    const isCustomCloud = p === 'custom_cloud';

    if (btnLlmMode) {
      btnLlmMode.classList.toggle('active', isLocal);
      btnLlmMode.classList.toggle('mode-api', !isLocal);
      btnLlmMode.setAttribute('aria-pressed', String(isLocal));
      if (modeIconSlot) {
        modeIconSlot.innerHTML = isLocal
          ? `<svg class="ds-pill-icon ds-mode-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>`
          : `<svg class="ds-pill-icon ds-mode-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"></path></svg>`;
      }
      if (labelLlmMode) {
        if (isLocal) {
          labelLlmMode.textContent = '本地直连';
        } else if (isCustomCloud) {
          labelLlmMode.textContent = '云端 API';
        } else if (isDsOwn) {
          labelLlmMode.textContent = 'DeepSeek API';
        } else {
          labelLlmMode.textContent = '云端 API';
        }
      }
      btnLlmMode.title = isLocal
        ? '当前为【本地极速直连模式（DeepSeek · 深度思考）】\n点击切换为【API 模式】'
        : `当前为【${isDsOwn ? 'DeepSeek 官方 API' : isCustomCloud ? '云端自定义 API' : '云端 API'}】\n点击切换为【本地直连模式】`;
    }

    if (dsModelPill) {
      if (isLocal) {
        dsModelPill.innerHTML = `<span class="ds-badge-dot"></span><span id="ds-model-pill-text">DeepSeek-V4.1-Flash${dsThinkOn ? ' · 深度思考' : ''}</span>`;
        dsModelPill.title = '当前为【本地极速直连模式（DeepSeek · 深度思考）】点击可切换至【API 模式】';
      } else {
        let basePillName = 'DeepSeek-V4.1-Flash';
        if (isCustomCloud) {
          const rawCloudModel = state.settings?.custom_cloud_model || '';
          basePillName = rawCloudModel.replace(/^.*\//, '') || '云端定制模型';
        } else if (isDsOwn) {
          basePillName = 'DeepSeek-V4.1-Flash';
        }
        dsModelPill.innerHTML = `<span class="ds-badge-dot mode-api"></span><span id="ds-model-pill-text">${dsThinkOn ? `${basePillName} · 深度思考` : basePillName}</span>`;
        dsModelPill.title = `当前为【${isDsOwn ? 'DeepSeek 官方直连' : isCustomCloud ? '自定义云端 API' : '云端模式'}】点击可切换至【本地直连】`;
      }
    }
  }

  async function toggleLlmMode() {
    const currentMode = state.llmMode || state.activeSession?.llm_mode || 'local_antigravity';
    const nextMode = currentMode === 'local_antigravity' ? 'api' : 'local_antigravity';
    state.llmMode = nextMode;
    if (state.activeSession) {
      state.activeSession.llm_mode = nextMode;
    }
    if (state.activeSessionId) {
      const cached = getSessionCache(state.activeSessionId);
      if (cached && cached.session) {
        cached.session.llm_mode = nextMode;
      }
    }
    try {
      localStorage.setItem('user_llm_mode', nextMode);
    } catch {}

    // 立即刷新前端状态指示与按钮外观，杜绝回弹
    syncLlmModeUi();

    const isNextLocal = nextMode === 'local_antigravity';

    let switchNotice = '';
    if (isNextLocal) {
      if (state.antigravityStatus?.checked && state.antigravityStatus.available === false) {
        switchNotice = '已切换至【本地直连模式】。未检测到本地引擎环境，建议切换为「云端 API 模式」';
      } else {
        switchNotice = '已切换至：本地极速直连模式 (DeepSeek-V4.1-Flash)';
      }
    } else {
      const hasApiKey = Boolean(state.settings?.own_deepseek_api_key_masked || state.settings?.has_own_deepseek_key);
      const isOwnProvider = state.settings?.provider === 'own_deepseek';
      if (isOwnProvider && !hasApiKey) {
        switchNotice = '已切换至【云端 API 模式】。您尚未配置 API 密钥，请在「设置」中填入密钥，或随时切回「本地直连模式」开箱即用';
      } else {
        switchNotice = '已切换至：云端 API 模式';
      }
    }

    if (state.activeSessionId) {
      await patchActiveSessionFlag({ llm_mode: nextMode }, switchNotice);
    } else {
      showToast(switchNotice, 3600);
    }
    syncLlmModeUi();
  }

  window.__dsToggleLlmMode = () => {
    toggleLlmMode();
  };
  window.__dsOpenSettings = () => {
    const btn =
      document.getElementById('open-settings-btn') ||
      document.getElementById('ds-topbar-mobile-settings-btn') ||
      document.getElementById('ds-topbar-settings-btn') ||
      document.getElementById('settings-btn');
    if (btn) btn.click();
  };

  async function checkLocalAntigravityStatus() {
    try {
      const res = await fetch('/api/antigravity/status');
      if (res.ok) {
        const data = await res.json();
        state.antigravityStatus = data;
        if (data.default_model && !state.localModel) {
          state.localModel = data.default_model;
        }
        syncLlmModeUi();
      }
    } catch (err) {
      console.warn('[Antigravity] 探测本地底座状态异常:', err);
    }
  }

  // 遵循 modern-web-guidance: copy-button 无障碍剪贴板复制引擎
  const copyFeedbackTimers = new WeakMap();
  let lastCopyAnnouncement = '';

  function fallbackLegacyCopy(text) {
    const field = Object.assign(document.createElement('textarea'), { value: text });
    field.setAttribute('readonly', '');
    field.style.cssText = 'position:fixed;inset-block-start:0;opacity:0';
    document.body.append(field);
    field.select();
    try {
      return document.execCommand('copy');
    } finally {
      field.remove();
    }
  }

  function reportCopyOutcome(button, ok) {
    const tip = button.nextElementSibling;
    clearTimeout(copyFeedbackTimers.get(button));
    button.removeAttribute('data-copied');
    button.removeAttribute('data-failed');
    button.classList.remove('is-copied');
    let msg = ok ? '已复制' : '复制失败';
    if (msg === lastCopyAnnouncement) msg += '\u00A0';
    lastCopyAnnouncement = msg;

    if (ok && button.classList.contains('ds-code-btn')) {
      if (!button.dataset.origLabel) button.dataset.origLabel = button.textContent;
      button.classList.add('is-copied');
      button.textContent = '✓ 已复制';
    }

    if (tip && tip.getAttribute('role') === 'status') {
      tip.textContent = '';
      void button.offsetWidth;
      button.setAttribute(ok ? 'data-copied' : 'data-failed', '');
      requestAnimationFrame(() => {
        tip.textContent = msg;
      });
    } else {
      button.setAttribute(ok ? 'data-copied' : 'data-failed', '');
    }

    copyFeedbackTimers.set(
      button,
      setTimeout(() => {
        button.removeAttribute('data-copied');
        button.removeAttribute('data-failed');
        button.classList.remove('is-copied');
        if (button.dataset.origLabel && button.classList.contains('ds-code-btn')) {
          button.textContent = button.dataset.origLabel;
        }
        if (tip && tip.getAttribute('role') === 'status') tip.textContent = '';
      }, 1800)
    );
  }

  async function executeCopyCommand(button, targetEl) {
    if (!button || !targetEl) return;
    const text = targetEl.matches('input, textarea')
      ? targetEl.value.trim()
      : (targetEl.innerText || targetEl.textContent || '').trim();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      reportCopyOutcome(button, true);
    } catch {
      const ok = fallbackLegacyCopy(text);
      reportCopyOutcome(button, ok);
    }
  }

  if ('CommandEvent' in window) {
    document.addEventListener(
      'command',
      (event) => {
        if (event.command && event.command.startsWith('--copy')) {
          executeCopyCommand(event.source, event.target);
        }
      },
      true
    );
  } else {
    document.addEventListener('click', (event) => {
      const button = event.target.closest('button[command^="--copy"]');
      if (!button) return;
      const target = document.getElementById(button.getAttribute('commandfor'));
      if (target) executeCopyCommand(button, target);
    });
  }

  // 原钱包/签到弹窗逻辑已移除（全站无积分/无付费门槛）
  async function refreshWalletOverview() {}

  // ================= 6.5 站长专属管理后台（仅 is_admin === true 时动态渲染，普通用户静态零暴露） =================
  function ensureAdminModalStructure() {
    if (!adminConsoleDialog || !state.user?.is_admin) return false;
    if (adminConsoleDialog.querySelector('.modal-inner')) return true;

    adminConsoleDialog.innerHTML = `
      <div class="modal-inner">
        <div class="modal-header">
          <div class="wallet-head-group">
            <h2 id="admin-console-title">星语恋庭 · 站长管理控制台</h2>
            <span class="account-isolation-pill">站长最高权限已鉴权</span>
          </div>
          <button type="button" class="icon-btn" id="close-admin-console-btn" aria-label="关闭站长后台"></button>
        </div>

        <div class="wallet-feedback-banner hidden" id="admin-feedback-banner" role="status" aria-live="polite"></div>

        <div class="vip-status-hero wallet-hero-grid admin-stats-hero" id="admin-stats-hero">
          <div class="vip-hero-left">
            <div class="wallet-tier-row">
              <span class="vip-current-tag">全站运营与安全网关中心</span>
            </div>
            <p class="vip-hero-desc">
              所有在线模型密钥与商业配音密钥均由服务端加密掩码托管，<strong>永不向前端明文回显</strong>；普通用户仅可见个人偏好与对话记录，无法访问本后台任何接口。
            </p>
          </div>
          <div class="wallet-metrics-group" id="admin-kpi-cards">
            <div class="vip-hero-quota"><span class="quota-num" id="adm-kpi-users">0</span><span class="quota-unit">注册用户</span></div>
          </div>
        </div>

        <div class="wallet-tabs-shell">
          <div class="wallet-tablist" id="admin-tablist" role="tablist" aria-label="站长管理模块切换">
            <button type="button" role="tab" class="wallet-tab" id="atab-overview" data-apanel="apanel-overview" aria-selected="true" tabindex="0">
              <span>独立账户总览</span>
            </button>
            <button type="button" role="tab" class="wallet-tab" id="atab-gateway" data-apanel="apanel-gateway" aria-selected="false" tabindex="-1">
              <span>平台模型 &amp; 语音网关</span>
            </button>
            <button type="button" role="tab" class="wallet-tab" id="atab-security" data-apanel="apanel-security" aria-selected="false" tabindex="-1">
              <span>站长安全凭据</span>
            </button>
            <button type="button" role="tab" class="wallet-tab" id="atab-announcement" data-apanel="apanel-announcement" aria-selected="false" tabindex="-1">
              <span>📢 全站公告发布</span>
            </button>
          </div>

          <div class="wallet-panels-stack">
            <!-- 站长面板 1：用户全生命周期权限与账户管理 -->
            <div role="tabpanel" id="apanel-overview" aria-labelledby="atab-overview">
              <div class="wpanel-inner">
                <div class="block-title-row" style="margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
                  <h3 class="sub-sec-title" id="adm-users-heading">全站注册用户与权限管理中心</h3>
                  <div style="display: flex; gap: 8px; align-items: center;">
                    <input type="search" id="adm-users-search-input" placeholder="搜索昵称或邮箱..." style="padding: 5px 12px; border-radius: 6px; border: 1px solid var(--border, #cbd5e1); font-size: 13px; min-width: 180px;" />
                    <button type="button" class="mini-btn" id="adm-refresh-dash-btn">刷新列表</button>
                  </div>
                </div>
                <div tabindex="0" role="region" aria-labelledby="adm-users-heading" class="responsive-table-wrap">
                  <table class="wallet-data-table" style="--col-2:'状态'; --col-3:'角色'; --col-4:'统计'; --col-5:'操作';">
                    <caption class="visually-hidden">全站注册用户管理概览表</caption>
                    <thead>
                      <tr>
                        <th scope="col">用户身份与邮箱</th>
                        <th scope="col">状态</th>
                        <th scope="col">权限角色</th>
                        <th scope="col">积分 / 会话</th>
                        <th scope="col" style="min-width: 220px; text-align: center;">账户全生命周期管理</th>
                      </tr>
                    </thead>
                    <tbody id="adm-users-tbody"></tbody>
                  </table>
                </div>
              </div>
            </div>

            <!-- 站长面板 2：平台托管大模型网关 & 商业配音音源配置 -->
            <div role="tabpanel" id="apanel-gateway" aria-labelledby="atab-gateway" hidden>
              <div class="wpanel-inner">
                <form id="adm-platform-cfg-form" class="stack-form">
                  <div class="admin-gen-form stack-form">
                    <div class="block-title-row">
                      <span>全站「星耀高阶在线通道」上游大模型网关（含防 SSRF 保护）</span>
                      <button type="button" class="mini-btn" id="adm-check-balance-btn">查询官方 API 余额</button>
                    </div>
                    <div class="ds-balance-detail-box hidden" id="adm-balance-box"></div>

                    <div class="field-group">
                      <label for="adm-online-provider">在线高阶通道上游类型</label>
                      <select id="adm-online-provider">
                        <option value="deepseek">DeepSeek 官方 / 兼容 API 网关</option>
                        <option value="custom_gateway">自定义第三方 OpenAI 兼容聚合网关</option>
                      </select>
                    </div>

                    <div id="adm-pane-ds" class="stack-form">
                      <div class="inline-row">
                        <div class="field-group flex-1">
                          <label for="adm-ds-url">DeepSeek 接口地址（禁止内网环回地址）</label>
                          <input id="adm-ds-url" type="url" placeholder="https://api.deepseek.com/v1/chat/completions" />
                        </div>
                        <div class="field-group flex-1">
                          <label for="adm-ds-model">默认模型标识</label>
                          <input id="adm-ds-model" type="text" placeholder="deepseek-flash" />
                        </div>
                      </div>
                      <div class="field-group">
                        <label for="adm-ds-key">平台托管 DeepSeek API Key <span class="muted-count" id="adm-ds-key-mask-status"></span></label>
                        <div class="inline-row">
                          <input id="adm-ds-key" class="flex-1" type="password" autocomplete="new-password" placeholder="留空保持现有密钥不变；输入新 sk-... 则覆盖更新" />
                          <label class="pin-check-label"><input type="checkbox" id="adm-clear-ds-key" /><span>清空密钥</span></label>
                        </div>
                      </div>
                    </div>

                    <div id="adm-pane-custom" class="stack-form hidden">
                      <div class="inline-row">
                        <div class="field-group flex-1">
                          <label for="adm-custom-url">自定义网关完整地址（禁止内网环回地址）</label>
                          <input id="adm-custom-url" type="url" placeholder="https://api.openai.com/v1/chat/completions" />
                        </div>
                        <div class="field-group flex-1">
                          <label for="adm-custom-model">模型标识名</label>
                          <input id="adm-custom-model" type="text" placeholder="gpt-4o-mini" />
                        </div>
                      </div>
                      <div class="field-group">
                        <label for="adm-custom-token">自定义网关 Bearer 令牌 <span class="muted-count" id="adm-custom-token-mask-status"></span></label>
                        <div class="inline-row">
                          <input id="adm-custom-token" class="flex-1" type="password" autocomplete="new-password" placeholder="留空保持现有令牌不变；输入新令牌则覆盖更新" />
                          <label class="pin-check-label"><input type="checkbox" id="adm-clear-custom-token" /><span>清空令牌</span></label>
                        </div>
                      </div>
                      <div class="field-group">
                        <label for="adm-custom-headers">附加请求头 JSON（可选）</label>
                        <textarea id="adm-custom-headers" rows="2" placeholder="{}"></textarea>
                      </div>
                    </div>

                    <div class="inline-row">
                      <button type="button" class="secondary-btn" id="adm-test-llm-btn">测试上游大模型网关连通性</button>
                    </div>
                  </div>

                  <div class="admin-gen-form stack-form">
                    <div class="block-title-row">
                      <span>全站高拟真商业配音音源配置 &amp; 声纹复刻</span>
                    </div>
                    <div class="field-group">
                      <label for="adm-tts-provider">全站默认配音引擎</label>
                      <select id="adm-tts-provider">
                        <option value="qwen3_otome">通义千问 Qwen3-TTS 1.7B 声优大模型（默认贴耳气声）</option>
                        <option value="dashscope">阿里云百炼 Qwen3-TTS（需密钥）</option>
                        <option value="minimax">MiniMax 海螺语音（需密钥）</option>
                        <option value="siliconflow">硅基流动 CosyVoice2 / IndexTTS-2（需密钥）</option>
                        <option value="fish_audio">Fish Audio 二次元声优库（需密钥）</option>
                        <option value="volcengine">火山引擎 · 豆包漫剧配音（需密钥）</option>
                        <option value="openai_tts">标准在线语音网关（需密钥）</option>
                        <option value="offline_kokoro">离线轻量基础语音</option>
                      </select>
                    </div>

                    <div class="inline-row">
                      <div class="field-group flex-1">
                        <label for="adm-tts-key">配音平台 API Key <span class="muted-count" id="adm-tts-key-mask-status"></span></label>
                        <div class="inline-row">
                          <input id="adm-tts-key" class="flex-1" type="password" autocomplete="new-password" placeholder="留空保持原密钥不变" />
                          <label class="pin-check-label"><input type="checkbox" id="adm-clear-tts-key" /><span>清空</span></label>
                        </div>
                      </div>
                      <div class="field-group flex-1">
                        <label for="adm-tts-group">GroupId / AppId（MiniMax 或火山选填）</label>
                        <input id="adm-tts-group" type="text" placeholder="选填编号" />
                      </div>
                    </div>

                    <div class="inline-row">
                      <div class="field-group flex-1">
                        <label for="adm-tts-cool-voice">高冷男神音色 ID（留空用精选默认）</label>
                        <input id="adm-tts-cool-voice" type="text" placeholder="留空自动匹配" />
                      </div>
                      <div class="field-group flex-1">
                        <label for="adm-tts-cute-voice">少年/软萌音色 ID（留空用精选默认）</label>
                        <input id="adm-tts-cute-voice" type="text" placeholder="留空自动匹配" />
                      </div>
                    </div>

                    <div class="inline-row">
                      <div class="field-group flex-1">
                        <label for="adm-tts-model">语音模型名（可选）</label>
                        <input id="adm-tts-model" type="text" placeholder="留空自动匹配" />
                      </div>
                      <div class="field-group flex-1">
                        <label for="adm-tts-endpoint">自定义语音地址（可选，禁内网地址）</label>
                        <input id="adm-tts-endpoint" type="url" placeholder="https://..." />
                      </div>
                    </div>

                    <div class="voice-clone-box">
                      <div class="block-title-row">
                        <span>站长专属：上传 8~15 秒参考男音一键复刻全站男主声纹</span>
                        <input type="file" id="adm-clone-audio-file" accept=".mp3,.wav,audio/*" class="visually-hidden" />
                        <button type="button" class="mini-btn" id="adm-pick-clone-btn">选择男音样片</button>
                      </div>
                      <div class="inline-row">
                        <div class="field-group flex-1">
                          <label for="adm-clone-ref-text" class="visually-hidden">参考音频原话</label>
                          <input id="adm-clone-ref-text" type="text" placeholder="填入该段参考干音的原话台词" />
                        </div>
                        <button type="button" class="secondary-btn" id="adm-run-clone-btn">复刻并写入配置</button>
                      </div>
                      <span class="muted-count" id="adm-clone-status">尚未选择参考音频</span>
                    </div>

                    <div class="inline-row">
                      <button type="button" class="secondary-btn" id="adm-test-tts-cool-btn">试听男神音源</button>
                      <button type="button" class="secondary-btn" id="adm-test-tts-cute-btn">试听少年/软萌音源</button>
                    </div>
                  </div>

                  <div class="test-result-box hidden" id="adm-gateway-result-box" role="status"></div>

                  <div class="form-footer-row">
                    <button type="submit" class="primary-btn full-width">保存全站模型与语音网关配置</button>
                  </div>
                </form>
              </div>
            </div>

            <!-- 站长面板 3：站长登录邮箱与强密码修改 -->
            <div role="tabpanel" id="apanel-security" aria-labelledby="atab-security" hidden>
              <div class="wpanel-inner">
                <form id="adm-security-form" class="admin-gen-form stack-form">
                  <h3 class="sub-sec-title">修改站长登录邮箱与高强度密码</h3>
                  <p class="sub-sec-hint">
                    为防止站长后台被暴力猜解，建议首次部署后立即修改初始密码（新密码至少 8 位）。修改成功后将自动吊销其他设备上的旧站长会话令牌。
                  </p>
                  <div class="field-group">
                    <label for="adm-sec-email">站长登录邮箱</label>
                    <input id="adm-sec-email" type="email" autocomplete="username" required />
                  </div>
                  <div class="field-group">
                    <label for="adm-sec-cur-pwd">当前站长密码（必填校验）</label>
                    <input id="adm-sec-cur-pwd" type="password" autocomplete="current-password" placeholder="请输入当前站长密码以确认身份" required />
                  </div>
                  <div class="field-group">
                    <label for="adm-sec-new-pwd">新强密码（至少 8 位，仅改邮箱可留空）</label>
                    <input id="adm-sec-new-pwd" type="password" autocomplete="new-password" minlength="8" placeholder="建议包含字母、数字与符号，至少 8 位" />
                  </div>
                  <div class="form-footer-row">
                    <button type="submit" class="primary-btn">验证并更新站长安全凭据</button>
                  </div>
                </form>
              </div>
            </div>

            <!-- 站长面板 4：全站系统公告管理与主动发布中心 -->
            <div role="tabpanel" id="apanel-announcement" aria-labelledby="atab-announcement" hidden>
              <div class="wpanel-inner">
                <form id="adm-ann-form" class="stack-form">
                  <div class="block-title-row">
                    <span>📢 全站系统公告主动发布与下发管理中心</span>
                    <span class="user-role-badge">实时生效至开屏弹窗</span>
                  </div>
                  <p class="section-lead-note" style="margin:4px 0 10px 0;font-size:12.5px;color:var(--text-sub);">
                    超级管理员可在此主动发布全站公告（支持分段多行排版）。更新后所有用户在打开网页或启动手机版时会自动弹出开屏展示。
                  </p>
                  <div class="field-group">
                    <label for="adm-ann-title">公告标题 *</label>
                    <input id="adm-ann-title" type="text" placeholder="例：星语 v1.9.9 手机辅助全新升级公告" required />
                  </div>
                  <div class="field-group">
                    <label for="adm-ann-content">公告正文内容 * (支持分段说明)</label>
                    <textarea id="adm-ann-content" rows="6" style="resize:vertical;font-size:13px;line-height:1.6;" placeholder="请输入全站公告正文内容..." required></textarea>
                  </div>
                  <div class="inline-row" style="margin-top:6px;align-items:center;">
                    <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-weight:600;font-size:13px;">
                      <input type="checkbox" id="adm-ann-enabled" checked />
                      <span>全站立即启用并向所有用户展示</span>
                    </label>
                  </div>
                  <div class="form-footer-row" style="margin-top:12px;display:flex;gap:10px;">
                    <button type="submit" class="primary-btn" id="adm-ann-publish-btn">🚀 立即发布 / 更新全站公告</button>
                    <button type="button" class="mini-btn" id="adm-ann-offline-btn" style="padding:7px 14px;">下线并停用公告</button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    bindAdminModalEvents();
    return true;
  }

  function selectAdminTab(tabId) {
    if (!adminConsoleDialog) return;
    const tabs = Array.from(adminConsoleDialog.querySelectorAll('#admin-tablist .wallet-tab'));
    const panels = tabs.map((b) => document.getElementById(b.dataset.apanel)).filter(Boolean);
    const selectedBtn = tabs.find((b) => b.id === tabId) || tabs[0];
    if (!selectedBtn) return;

    state.adminActiveTab = selectedBtn.id;
    for (const tab of tabs) {
      const active = tab === selectedBtn;
      tab.setAttribute('aria-selected', String(active));
      tab.setAttribute('tabindex', active ? '0' : '-1');
    }
    for (const panel of panels) {
      panel.hidden = panel.id !== selectedBtn.dataset.apanel;
    }
  }

  function collectAdminPlatformDraft() {
    const draft = {
      free_experience_mode: true,
      register_gift_vip: true,
      register_gift_days: '365',
      online_provider_type: document.getElementById('adm-online-provider')?.value || 'deepseek',
      deepseek_base_url: document.getElementById('adm-ds-url')?.value.trim() || '',
      deepseek_model: document.getElementById('adm-ds-model')?.value.trim() || '',
      custom_gateway_url: document.getElementById('adm-custom-url')?.value.trim() || '',
      custom_gateway_model: document.getElementById('adm-custom-model')?.value.trim() || '',
      custom_gateway_headers: document.getElementById('adm-custom-headers')?.value.trim() || '{}',
      tts_provider: document.getElementById('adm-tts-provider')?.value || 'qwen3_otome',
      tts_group_id: document.getElementById('adm-tts-group')?.value.trim() || '',
      tts_cool_voice: document.getElementById('adm-tts-cool-voice')?.value.trim() || '',
      tts_cute_voice: document.getElementById('adm-tts-cute-voice')?.value.trim() || '',
      tts_model: document.getElementById('adm-tts-model')?.value.trim() || '',
      tts_endpoint: document.getElementById('adm-tts-endpoint')?.value.trim() || ''
    };
    const dsKey = document.getElementById('adm-ds-key')?.value.trim() || '';
    const customTok = document.getElementById('adm-custom-token')?.value.trim() || '';
    const ttsKey = document.getElementById('adm-tts-key')?.value.trim() || '';

    if (document.getElementById('adm-clear-ds-key')?.checked) {
      draft.deepseek_api_key = '';
      draft.clear_deepseek_api_key = true;
    } else if (dsKey) {
      draft.deepseek_api_key = dsKey;
    }

    if (document.getElementById('adm-clear-custom-token')?.checked) {
      draft.custom_gateway_token = '';
      draft.clear_custom_gateway_token = true;
    } else if (customTok) {
      draft.custom_gateway_token = customTok;
    }

    if (document.getElementById('adm-clear-tts-key')?.checked) {
      draft.tts_api_key = '';
      draft.clear_tts_api_key = true;
    } else if (ttsKey) {
      draft.tts_api_key = ttsKey;
    }
    return draft;
  }

  function applyPlatformConfigToAdminForm(cfg) {
    if (!cfg || !adminConsoleDialog) return;

    const provSel = document.getElementById('adm-online-provider');
    if (provSel) provSel.value = cfg.online_provider_type || 'deepseek';
    document.getElementById('adm-pane-ds')?.classList.toggle('hidden', provSel?.value === 'custom_gateway');
    document.getElementById('adm-pane-custom')?.classList.toggle('hidden', provSel?.value !== 'custom_gateway');

    const setVal = (id, v) => {
      const el = document.getElementById(id);
      if (el) el.value = v || '';
    };
    setVal('adm-ds-url', cfg.deepseek_base_url);
    setVal('adm-ds-model', cfg.deepseek_model);
    setVal('adm-ds-key', '');
    setVal('adm-custom-url', cfg.custom_gateway_url);
    setVal('adm-custom-model', cfg.custom_gateway_model);
    setVal('adm-custom-token', '');
    setVal('adm-custom-headers', cfg.custom_gateway_headers || '{}');
    setVal('adm-tts-provider', cfg.tts_provider || 'qwen3_otome');
    setVal('adm-tts-key', '');
    setVal('adm-tts-group', cfg.tts_group_id);
    setVal('adm-tts-cool-voice', cfg.tts_cool_voice);
    setVal('adm-tts-cute-voice', cfg.tts_cute_voice);
    setVal('adm-tts-model', cfg.tts_model);
    setVal('adm-tts-endpoint', cfg.tts_endpoint);

    ['adm-clear-ds-key', 'adm-clear-custom-token', 'adm-clear-tts-key'].forEach((chkId) => {
      const c = document.getElementById(chkId);
      if (c) c.checked = false;
    });

    const dsMask = document.getElementById('adm-ds-key-mask-status');
    if (dsMask) {
      dsMask.textContent = cfg.has_deepseek_key
        ? `（已安全托管：${cfg.deepseek_api_key_masked}）`
        : '（当前未配置）';
    }
    const custMask = document.getElementById('adm-custom-token-mask-status');
    if (custMask) {
      custMask.textContent = cfg.has_custom_token
        ? `（已安全托管：${cfg.custom_gateway_token_masked}）`
        : '（当前未配置）';
    }
    const ttsMask = document.getElementById('adm-tts-key-mask-status');
    if (ttsMask) {
      ttsMask.textContent = cfg.has_tts_key
        ? `（已安全托管：${cfg.tts_api_key_masked}）`
        : '（当前免密钥默认）';
    }
  }

  let adminUsersSearchKeyword = '';

  function renderAdminDashboardView() {
    const dash = state.adminDashboard;
    if (!dash || !adminConsoleDialog) return;

    const stats = dash.stats || {};
    const setTxt = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = String(val);
    };
    setTxt('adm-kpi-users', stats.total_users ?? 0);

    const rawUsers = Array.isArray(dash.users) ? dash.users : [];
    const kw = String(adminUsersSearchKeyword || '').trim().toLowerCase();
    const users = kw
      ? rawUsers.filter(u =>
          String(u.nickname || '').toLowerCase().includes(kw) ||
          String(u.email || '').toLowerCase().includes(kw) ||
          String(u.id || '').toLowerCase().includes(kw)
        )
      : rawUsers;

    const usersTbody = document.getElementById('adm-users-tbody');
    if (usersTbody) {
      if (users.length === 0) {
        usersTbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:24px;color:var(--text-muted,#94a3b8);">' + (kw ? '未找到匹配「' + escapeHtml(kw) + '」的用户' : '暂无注册用户') + '</td></tr>';
      } else {
        usersTbody.innerHTML = users
          .map((u) => {
            const isSelf = state.user && state.user.id === u.id;
            const isProtected = u.id === 'user_admin' || isSelf;
            const isBanned = Boolean(u.is_banned);
            const statusHtml = isBanned
              ? '<span class="status-pill status-banned" style="display:inline-flex;align-items:center;gap:5px;background:rgba(239,68,68,0.12);color:#ef4444;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600;"><span style="width:6px;height:6px;border-radius:50%;background:#ef4444;display:inline-block;"></span>已封禁</span>'
              : '<span class="status-pill status-active" style="display:inline-flex;align-items:center;gap:5px;background:rgba(16,185,129,0.12);color:#10b981;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600;"><span style="width:6px;height:6px;border-radius:50%;background:#10b981;display:inline-block;"></span>正常</span>';
            const roleBadge = u.role === 'admin'
              ? '<span style="color:#d97706;font-weight:600;">管理员</span>'
              : '<span style="color:var(--text-muted,#64748b);">普通用户</span>';
            const dateStr = u.created_at ? new Date(u.created_at).toLocaleDateString() : '-';

            let actionButtons = '';
            if (isProtected) {
              actionButtons = `<span style="font-size:12px;color:var(--text-muted,#94a3b8);">${u.id === 'user_admin' ? '系统主站长 (受保护)' : '当前登录账号'}</span>`;
            } else {
              actionButtons = `
                <div style="display:flex;gap:6px;justify-content:center;flex-wrap:wrap;">
                  <button type="button" class="mini-btn" data-action="reset-pwd" data-uid="${escapeHtml(u.id)}" data-name="${escapeHtml(u.nickname)}" title="为该用户重置新密码">改密</button>
                  <button type="button" class="mini-btn" data-action="toggle-ban" data-uid="${escapeHtml(u.id)}" data-name="${escapeHtml(u.nickname)}" data-banned="${isBanned ? '1' : '0'}" style="${isBanned ? 'color:#10b981;font-weight:600;' : 'color:#ef4444;'}" title="${isBanned ? '解封此账号' : '立即封禁此账号并踢下线'}">${isBanned ? '解封' : '封禁'}</button>
                  <button type="button" class="mini-btn" data-action="toggle-role" data-uid="${escapeHtml(u.id)}" data-role="${escapeHtml(u.role || 'user')}" title="变更账号角色">${u.role === 'admin' ? '降为用户' : '设为管理'}</button>
                  <button type="button" class="mini-btn" data-action="delete-user" data-uid="${escapeHtml(u.id)}" data-name="${escapeHtml(u.nickname)}" style="color:#ef4444;" title="彻底删除此用户及全部数据">删除</button>
                </div>
              `;
            }

            return `
              <tr style="${isBanned ? 'opacity:0.65;background:rgba(239,68,68,0.03);' : ''}">
                <th scope="row">
                  <div><strong>${escapeHtml(u.nickname)}</strong></div>
                  <div class="muted-count" style="font-size:12px;color:var(--text-muted,#64748b);">${escapeHtml(u.email)}</div>
                  <div style="font-size:11px;color:var(--text-muted,#94a3b8);margin-top:2px;">注册时间: ${dateStr}</div>
                </th>
                <td style="vertical-align:middle;">${statusHtml}</td>
                <td style="vertical-align:middle;">${roleBadge}</td>
                <td style="vertical-align:middle;">
                  <div>${u.session_count || 0} 个会话</div>
                  <div style="font-size:12px;color:var(--text-muted,#64748b);">积分: ${u.points || 0}</div>
                </td>
                <td style="vertical-align:middle;text-align:center;">
                  ${actionButtons}
                </td>
              </tr>
            `;
          })
          .join('');
      }
    }

    const secEmail = document.getElementById('adm-sec-email');
    if (secEmail && state.user?.email) {
      secEmail.value = state.user.email;
    }
  }

  async function refreshAdminDashboard(updateGatewayForm = false) {
    if (!state.user?.is_admin) return;
    const data = await apiJson('/api/admin/dashboard');
    state.adminDashboard = data.dashboard;
    renderAdminDashboardView();
    if (updateGatewayForm && data.platform_config) {
      applyPlatformConfigToAdminForm(data.platform_config);
    }
  }

  function bindAdminModalEvents() {
    if (!adminConsoleDialog) return;
    document.getElementById('close-admin-console-btn')?.addEventListener('click', () => {
      adminConsoleDialog.close();
    });

    const tabs = Array.from(adminConsoleDialog.querySelectorAll('#admin-tablist .wallet-tab'));
    tabs.forEach((btn, idx) => {
      btn.addEventListener('click', () => selectAdminTab(btn.id));
      btn.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          e.preventDefault();
          const dir = e.key === 'ArrowRight' ? 1 : -1;
          const nextBtn = tabs[(idx + dir + tabs.length) % tabs.length];
          selectAdminTab(nextBtn.id);
          nextBtn.focus();
        }
      });
    });

    document.getElementById('adm-refresh-dash-btn')?.addEventListener('click', async () => {
      await refreshAdminDashboard(false);
      showToast('全站账户列表已同步刷新');
    });

    // 站长全站系统公告发布与管理
    async function loadAdminAnnouncementData() {
      try {
        const res = await apiJson('/api/admin/announcement');
        if (res && res.current) {
          const t = document.getElementById('adm-ann-title');
          const c = document.getElementById('adm-ann-content');
          const en = document.getElementById('adm-ann-enabled');
          if (t && !t.value) t.value = res.current.title || '';
          if (c && !c.value) c.value = res.current.content || '';
          if (en) en.checked = Boolean(res.current.enabled);
        }
      } catch {}
    }
    loadAdminAnnouncementData();

    document.getElementById('adm-ann-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const title = document.getElementById('adm-ann-title')?.value?.trim();
      const content = document.getElementById('adm-ann-content')?.value?.trim();
      const enabled = document.getElementById('adm-ann-enabled')?.checked;
      if (!title || !content) {
        showToast('请完整填写公告标题与内容');
        return;
      }
      try {
        await apiJson('/api/admin/announcement', {
          method: 'POST',
          body: JSON.stringify({ title, content, enabled, version: Date.now() })
        });
        showToast('全站公告已成功发布并实时生效！');
      } catch (err) {
        showToast('发布公告失败: ' + err.message);
      }
    });

    document.getElementById('adm-ann-offline-btn')?.addEventListener('click', async () => {
      const title = document.getElementById('adm-ann-title')?.value?.trim() || '公告已下线';
      const content = document.getElementById('adm-ann-content')?.value?.trim() || '当前无最新公告';
      try {
        await apiJson('/api/admin/announcement', {
          method: 'POST',
          body: JSON.stringify({ title, content, enabled: false, version: Date.now() })
        });
        const en = document.getElementById('adm-ann-enabled');
        if (en) en.checked = false;
        showToast('全站公告已下线停用');
      } catch (err) {
        showToast('下线公告失败: ' + err.message);
      }
    });

    const searchInput = document.getElementById('adm-users-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        adminUsersSearchKeyword = e.target.value;
        renderAdminDashboardView();
      });
    }

    const usersTbody = document.getElementById('adm-users-tbody');
    if (usersTbody) {
      usersTbody.addEventListener('click', async (e) => {
        const btn = e.target.closest('button[data-action]');
        if (!btn) return;
        const action = btn.dataset.action;
        const uid = btn.dataset.uid;
        const name = btn.dataset.name || '该用户';

        if (action === 'reset-pwd') {
          const newPwd = prompt(`【管理员重置密码】\n请输入用户「${name}」的新密码（不少于 6 位）：`, '');
          if (!newPwd || !newPwd.trim()) return;
          if (newPwd.trim().length < 6) {
            alert('新密码长度不能少于 6 位');
            return;
          }
          try {
            await apiJson(`/api/admin/users/${encodeURIComponent(uid)}/reset-password`, {
              method: 'POST',
              body: JSON.stringify({ new_password: newPwd.trim() })
            });
            showToast(`已成功为用户「${name}」重置密码！历史登录已强制下线。`);
            await refreshAdminDashboard(false);
          } catch (err) {
            alert('重置密码失败：' + (err.message || '网络或权限异常'));
          }
        } else if (action === 'toggle-ban') {
          const isBanned = btn.dataset.banned === '1';
          const shouldBan = !isBanned;
          const confirmText = shouldBan
            ? `确定要封禁用户「${name}」吗？\n封禁后该用户将立即强制下线，且无法再次登录。`
            : `确定要解封用户「${name}」吗？\n解封后该用户可正常登录使用。`;
          if (!confirm(confirmText)) return;
          try {
            await apiJson(`/api/admin/users/${encodeURIComponent(uid)}/toggle-ban`, {
              method: 'POST',
              body: JSON.stringify({ ban: shouldBan })
            });
            showToast(shouldBan ? `已封禁用户「${name}」` : `已解封用户「${name}」`);
            await refreshAdminDashboard(false);
          } catch (err) {
            alert('操作失败：' + (err.message || '网络异常'));
          }
        } else if (action === 'toggle-role') {
          const curRole = btn.dataset.role || 'user';
          const nextRole = curRole === 'admin' ? 'user' : 'admin';
          const confirmText = nextRole === 'admin'
            ? `确定要将用户「${name}」提升为【管理员】吗？该用户将获得管理控制台权限。`
            : `确定要将用户「${name}」降级为【普通用户】吗？`;
          if (!confirm(confirmText)) return;
          try {
            await apiJson(`/api/admin/users/${encodeURIComponent(uid)}/set-role`, {
              method: 'POST',
              body: JSON.stringify({ role: nextRole })
            });
            showToast(`用户「${name}」角色已变更为：${nextRole === 'admin' ? '管理员' : '普通用户'}`);
            await refreshAdminDashboard(false);
          } catch (err) {
            alert('修改角色失败：' + (err.message || '网络异常'));
          }
        } else if (action === 'delete-user') {
          const confirmText = `【高危操作警告】\n您正在永久删除用户「${name}」！\n此操作将彻底销毁该用户的所有账号资料、会话、聊天记录与记忆，且无法恢复。\n\n确定执行删除吗？`;
          if (!confirm(confirmText)) return;
          try {
            await apiJson(`/api/admin/users/${encodeURIComponent(uid)}`, {
              method: 'DELETE'
            });
            showToast(`用户「${name}」及其全部数据已成功删除！`);
            await refreshAdminDashboard(false);
          } catch (err) {
            alert('删除用户失败：' + (err.message || '网络异常'));
          }
        }
      });
    }

    document.getElementById('adm-online-provider')?.addEventListener('change', (e) => {
      const isCustom = e.target.value === 'custom_gateway';
      document.getElementById('adm-pane-ds')?.classList.toggle('hidden', isCustom);
      document.getElementById('adm-pane-custom')?.classList.toggle('hidden', !isCustom);
    });

    document.getElementById('adm-check-balance-btn')?.addEventListener('click', async () => {
      const balBox = document.getElementById('adm-balance-box');
      if (!balBox) return;
      balBox.classList.remove('hidden');
      balBox.textContent = '正在查询平台 DeepSeek 官方账户余额…';
      try {
        const data = await apiJson('/api/admin/balance');
        const firstInfo = Array.isArray(data.balance_infos) && data.balance_infos[0];
        if (!data.configured) {
          balBox.textContent = '当前尚未在平台网关中配置真实 DeepSeek API Key（在线通道将使用内置高拟真引擎兜底）。';
        } else if (firstInfo) {
          const curSym = firstInfo.currency === 'USD' ? '$' : '¥';
          balBox.innerHTML = `状态：<strong>${
            data.is_available ? '正常可用' : '余额不足'
          }</strong> ｜ 可用总余额：<strong>${escapeHtml(
            curSym + firstInfo.total_balance
          )}</strong>（赠金 ${escapeHtml(curSym + (firstInfo.granted_balance || '0.00'))} / 充值 ${escapeHtml(
            curSym + (firstInfo.topped_up_balance || '0.00')
          )}）`;
        } else {
          balBox.textContent = data.message || '查询已完成';
        }
      } catch (err) {
        balBox.textContent = `${err.message}`;
      }
    });

    document.getElementById('adm-test-llm-btn')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const resBox = document.getElementById('adm-gateway-result-box');
      btn.disabled = true;
      btn.textContent = '正在握手测试…';
      if (resBox) resBox.classList.add('hidden');
      try {
        const res = await apiJson('/api/admin/test-gateway', {
          method: 'POST',
          body: JSON.stringify(collectAdminPlatformDraft())
        });
        if (resBox) {
          resBox.className = 'test-result-box ok';
          resBox.textContent = res.message;
          resBox.classList.remove('hidden');
        }
      } catch (err) {
        if (resBox) {
          resBox.className = 'test-result-box err';
          resBox.textContent = `${err.message}`;
          resBox.classList.remove('hidden');
        }
      } finally {
        btn.disabled = false;
        btn.textContent = '测试上游大模型网关连通性';
      }
    });

    document.getElementById('adm-test-tts-cool-btn')?.addEventListener('click', (e) => {
      window.__runAdminTtsPreview?.(
        'cool',
        e.currentTarget,
        collectAdminPlatformDraft(),
        document.getElementById('adm-gateway-result-box')
      );
    });
    document.getElementById('adm-test-tts-cute-btn')?.addEventListener('click', (e) => {
      window.__runAdminTtsPreview?.(
        'cute',
        e.currentTarget,
        collectAdminPlatformDraft(),
        document.getElementById('adm-gateway-result-box')
      );
    });

    let admCloneAudioDataUrl = '';
    const admCloneInput = document.getElementById('adm-clone-audio-file');
    const admCloneStatus = document.getElementById('adm-clone-status');
    document.getElementById('adm-pick-clone-btn')?.addEventListener('click', () => {
      admCloneInput?.click();
    });
    admCloneInput?.addEventListener('change', (e) => {
      const f = e.target.files?.[0];
      e.target.value = '';
      if (!f) return;
      if (f.size > 5.5 * 1024 * 1024) {
        if (admCloneStatus) admCloneStatus.textContent = '请选择小于 5.5MB 的清晰人声样片';
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        admCloneAudioDataUrl = String(reader.result || '');
        if (admCloneStatus) admCloneStatus.textContent = `已载入样片：${f.name}`;
      };
      reader.readAsDataURL(f);
    });

    document.getElementById('adm-run-clone-btn')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const resBox = document.getElementById('adm-gateway-result-box');
      if (!admCloneAudioDataUrl) {
        showToast('请先选择一段 8~15 秒的参考男音音频文件');
        return;
      }
      btn.disabled = true;
      btn.textContent = '正在复刻…';
      try {
        const res = await apiJson('/api/tts/clone-voice', {
          method: 'POST',
          body: JSON.stringify({
            audio_data_url: admCloneAudioDataUrl,
            ref_text: document.getElementById('adm-clone-ref-text')?.value.trim() || '',
            custom_name: 'otome-male-lead',
            settings: collectAdminPlatformDraft()
          })
        });
        if (res.platform_config) applyPlatformConfigToAdminForm(res.platform_config);
        if (resBox) {
          resBox.className = 'test-result-box ok';
          resBox.textContent = res.message || '声纹复刻成功并已写入平台网关配置';
          resBox.classList.remove('hidden');
        }
        showToast('全站专属声纹复刻已保存生效！');
      } catch (err) {
        showToast(`${err.message}`);
      } finally {
        btn.disabled = false;
        btn.textContent = '复刻并写入配置';
      }
    });

    document.getElementById('adm-platform-cfg-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const res = await apiJson('/api/admin/platform-config', {
          method: 'PUT',
          body: JSON.stringify(collectAdminPlatformDraft())
        });
        if (res.platform_config) applyPlatformConfigToAdminForm(res.platform_config);
        showToast('全站模型与商业语音网关配置已加密保存（密钥已自动掩码隐藏）！');
      } catch (err) {
        showToast(`${err.message}`);
      }
    });

    document.getElementById('adm-security-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('adm-sec-email')?.value.trim() || '';
      const currentPassword = document.getElementById('adm-sec-cur-pwd')?.value || '';
      const newPassword = document.getElementById('adm-sec-new-pwd')?.value || '';
      try {
        const res = await apiJson('/api/admin/security/credentials', {
          method: 'POST',
          body: JSON.stringify({
            new_email: email,
            current_password: currentPassword,
            new_password: newPassword
          })
        });
        if (res.user) state.user = res.user;
        if (res.token) {
          window.__starAuthStore?.setToken(res.token, true);
        }
        document.getElementById('adm-sec-cur-pwd').value = '';
        document.getElementById('adm-sec-new-pwd').value = '';
        renderUserAndMembership();
        showToast('站长安全凭据已更新，其他设备上的旧登录令牌已自动吊销！');
      } catch (err) {
        showToast(`${err.message}`);
      }
    });
  }

  async function openAdminConsoleModal(initialTab = 'atab-overview') {
    if (!state.user?.is_admin) {
      showToast('权限不足：仅站长管理员可进入后台');
      return;
    }
    if (state.tourActive) closeOnboardingTour(false);
    if (!ensureAdminModalStructure()) return;
    document.getElementById('admin-feedback-banner')?.classList.add('hidden');
    selectAdminTab(initialTab);
    if (!adminConsoleDialog.open) {
      adminConsoleDialog.showModal();
    }
    try {
      await refreshAdminDashboard(true);
    } catch (err) {
      showToast(`${err.message}`);
    }
  }

  document.getElementById('open-admin-console-btn')?.addEventListener('click', () => {
    openAdminConsoleModal('atab-overview');
  });
  document.getElementById('ds-menu-admin-btn')?.addEventListener('click', () => {
    hidePopoverSafe('ds-user-popover');
    openAdminConsoleModal('atab-overview');
  });
  // 顶栏专属管理员胶囊按钮
  document.getElementById('topbar-admin-btn')?.addEventListener('click', () => {
    openAdminConsoleModal('atab-overview');
  });
  // 顶栏更多弹出层管理员项
  document.getElementById('more-admin-console-btn')?.addEventListener('click', () => {
    hidePopoverSafe('topbar-more-popover');
    openAdminConsoleModal('atab-overview');
  });
  // 移动端全屏设置抽屉中管理员条目
  document.getElementById('mfs-item-admin')?.addEventListener('click', () => {
    document.getElementById('mobile-fullscreen-settings')?.classList.add('hidden');
    openAdminConsoleModal('atab-overview');
  });
  // 桌面端设置弹窗头部管理后台按钮
  document.getElementById('settings-open-admin-btn')?.addEventListener('click', () => {
    if (settingsDialog?.open) settingsDialog.close();
    openAdminConsoleModal('atab-overview');
  });
  // 桌面端设置弹窗内更多面板站长卡片按钮
  document.getElementById('settings-admin-card-btn')?.addEventListener('click', () => {
    if (settingsDialog?.open) settingsDialog.close();
    openAdminConsoleModal('atab-overview');
  });

  // ================= 7. 剧本 ➔ 本剧专属人设 ➔ 本剧故事存档（三级纯净隔离） =================
  function getActiveScriptObj() {
    return (
      state.scripts.find((s) => s.id === state.activeScriptId) ||
      state.scripts[0] || {
        id: 'script_clannad',
        icon: '剧',
        title: '樱坂坡道上的风',
        subtitle: '青春催泪群像剧',
        player_role: '樱坂高中同级生',
        chapters: []
      }
    );
  }

  function resolvePersonaScriptId(personaObj) {
    if (!personaObj) return 'script_classic';
    return personaObj.script_id || 'script_classic';
  }

  function syncActiveScriptVisuals() {
    const curScript = getActiveScriptObj();
    const iconEl = document.getElementById('sidebar-script-icon');
    const titleEl = document.getElementById('sidebar-script-title');
    if (iconEl) iconEl.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>';
    if (titleEl) titleEl.textContent = curScript.title || '选择剧本';

    if (state.uiMode === 'roleplay' && chatInput) {
      syncChatInputPlaceholder();
    }
  }

  async function selectOrStartPersona(personaId, forceNew = false) {
    if (state.isStreaming || !personaId) return;
    if (!forceNew && state.activePersona?.id === personaId && state.uiMode === 'roleplay') {
      return;
    }
    if (!forceNew) {
      const existingSess = state.sessions.find(
        (s) => s.persona_id === personaId && s.session_mode !== 'deepseek_native'
      );
      if (existingSess) {
        await loadSession(existingSess.id);
        return;
      }
    }
    await startSessionWithPersona(personaId);
  }

  async function switchActiveScript(scriptId, preferredPersonaId = null) {
    if (!scriptId) return;
    if (state.isStreaming) {
      showToast('角色正在回应中，请稍候或点击「轻声止步」后再切换剧本');
      return;
    }
    state.activeScriptId = scriptId;
    try {
      localStorage.setItem('active_script_id', scriptId);
    } catch {}

    if (state.uiMode !== 'roleplay') {
      applyUiModeVisuals('roleplay');
    }

    syncActiveScriptVisuals();
    renderPersonaList();
    renderSessionList();

    if (preferredPersonaId) {
      await selectOrStartPersona(preferredPersonaId, false);
    } else {
      const scriptSessions = state.sessions.filter((s) => {
        if (s.session_mode === 'deepseek_native') return false;
        const p = state.personas.find((x) => x.id === s.persona_id);
        return (s.script_id || resolvePersonaScriptId(p)) === scriptId;
      });
      if (scriptSessions.length > 0) {
        await loadSession(scriptSessions[0].id);
      } else {
        const firstCast = state.personas.find(
          (p) => p.id !== 'persona_deepseek_official' && resolvePersonaScriptId(p) === scriptId
        );
        if (firstCast) {
          await startSessionWithPersona(firstCast.id);
        }
      }
    }

    const scObj = getActiveScriptObj();
    showToast(`${scObj.icon || ''} 已进入剧本《${scObj.title}》`);
  }

  function renderPersonaList() {
    const allRoleplayPersonas = state.personas.filter((p) => p.id !== 'persona_deepseek_official');
    const scriptCast = allRoleplayPersonas.filter(
      (p) => resolvePersonaScriptId(p) === state.activeScriptId
    );
    const displayCast = scriptCast.length > 0 ? scriptCast : allRoleplayPersonas;

    const headLabel = document.getElementById('persona-section-heading');
    if (headLabel) {
      headLabel.textContent = `本剧登场人设（${displayCast.length}）`;
    }

    const frag = document.createDocumentFragment();
    for (const p of displayCast) {
      const isActivePersona = Boolean(state.activePersona && state.activePersona.id === p.id);
      const isCustomOwned = Boolean(state.user?.id && p.user_id === state.user.id);
      const item = document.createElement('div');
      item.className = `persona-card-item ${isActivePersona ? 'active' : ''}`;
      item.setAttribute('role', 'listitem');
      item.tabIndex = 0;
      if (isActivePersona) {
        item.setAttribute('aria-current', 'true');
      }
      const shortName = (p.name || '').split('·')[0].trim();
      const routeTag = isCustomOwned ? '自建角色' : p.category_tag || '角色线';
      const subText = p.tagline || p.backstory || '点击切入角色故事线';
      const customActionsHtml = isCustomOwned
        ? `<div class="persona-card-actions">
             <button type="button" class="persona-mini-act-btn p-edit-btn" title="编辑自建角色设定" aria-label="编辑角色 ${escapeHtml(shortName)}">
               <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
             </button>
             <button type="button" class="persona-mini-act-btn danger p-del-btn" title="删除此自建角色" aria-label="删除角色 ${escapeHtml(shortName)}">
               <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
             </button>
           </div>`
        : '';
      item.innerHTML = `
        <span class="p-avatar">${renderSmartAvatarHtml(p.avatar, p.name, "size-md")}</span>
        <div class="p-meta">
          <div class="p-name-row">
            <span class="p-name" title="${escapeHtml(p.name || shortName)}">${escapeHtml(shortName)}</span>
            <span class="p-route-pill">${escapeHtml(routeTag)}</span>
            ${customActionsHtml}
          </div>
          <div class="p-sub" title="${escapeHtml(subText)}">${escapeHtml(subText)}</div>
        </div>
      `;
      item.addEventListener('click', (e) => {
        if (e.target.closest('.persona-card-actions')) return;
        selectOrStartPersona(p.id, false);
      });
      item.addEventListener('keydown', (e) => {
        if (e.target !== item) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          selectOrStartPersona(p.id, false);
        }
      });
      if (isCustomOwned) {
        item.querySelector('.p-edit-btn')?.addEventListener('click', (e) => {
          e.stopPropagation();
          openPersonaModalForEdit(p);
        });
        item.querySelector('.p-del-btn')?.addEventListener('click', async (e) => {
          e.stopPropagation();
          await deleteCustomPersona(p);
        });
      }
      frag.appendChild(item);
    }
    personaListEl.replaceChildren(frag);

    // 同步原生 DeepSeek 侧栏助手标识（与剧本扮演角色列表严格隔离）
    const soulSelect = document.getElementById('ds-soul-select');
    if (soulSelect && soulSelect.value !== 'persona_deepseek_official') {
      soulSelect.innerHTML = '<option value="persona_deepseek_official">DeepSeek 官方问答助手</option>';
      soulSelect.value = 'persona_deepseek_official';
    }
  }

  // 会话浮动上下文菜单（置顶、重命名、分享、删除）
  let activeSessionCtxMenu = null;
  function closeSessionContextMenu() {
    if (activeSessionCtxMenu) {
      activeSessionCtxMenu.menuEl.remove();
      activeSessionCtxMenu.rowEl?.classList.remove('menu-open');
      activeSessionCtxMenu = null;
    }
  }
  document.addEventListener('click', (e) => {
    if (activeSessionCtxMenu && !e.target.closest('.ds-session-ctx-menu') && !e.target.closest('.ds-session-more-btn')) {
      closeSessionContextMenu();
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && activeSessionCtxMenu) closeSessionContextMenu();
  });

  function getDsTimelineBounds() {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    return {
      startOfToday,
      startOfYesterday: startOfToday - 86400000,
      sevenDaysAgo: startOfToday - 7 * 86400000,
      thirtyDaysAgo: startOfToday - 30 * 86400000
    };
  }

  function resolveDsTimelineGroup(session, bounds = null) {
    if (session.pinned === 1) return '置顶';
    const b = bounds || getDsTimelineBounds();
    const ts = Number(session.updated_at || Date.now());

    if (ts >= b.startOfToday) return '今天';
    if (ts >= b.startOfYesterday) return '昨天';
    if (ts >= b.sevenDaysAgo) return '7 天内';
    if (ts >= b.thirtyDaysAgo) return '30 天内';
    const dt = new Date(ts);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
  }

  function startInlineSessionRename(itemEl, sessionObj) {
    const titleSpan = itemEl.querySelector('.session-title-text');
    if (!titleSpan) return;
    const oldTitle = sessionObj.title || '新对话';
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.className = 'ds-session-rename-input';
    inp.value = oldTitle;
    inp.maxLength = 42;
    titleSpan.replaceWith(inp);
    inp.focus();
    inp.select();

    let committed = false;
    const finish = async (save) => {
      if (committed) return;
      committed = true;
      const nextTitle = inp.value.trim();
      if (save) {
        if (!nextTitle) {
          showToast('对话标题不能为空，已为你保留原标题');
        } else if (nextTitle !== oldTitle) {
          try {
            const res = await apiJson(`/api/sessions/${encodeURIComponent(sessionObj.id)}`, {
              method: 'PATCH',
              body: JSON.stringify({ title: nextTitle, title_locked: true })
            });
            state.sessions = res.sessions || state.sessions;
            if (state.activeSessionId === sessionObj.id && state.activeSession) {
              state.activeSession.title = nextTitle;
              renderUserAndMembership();
            }
            showToast(`对话已重命名为「${nextTitle}」`);
          } catch (err) {
            showToast(`重命名失败：${err.message || '请稍后重试'}`);
          }
        }
      }
      renderSessionList();
    };

    inp.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        finish(true);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        finish(false);
      }
    });
    inp.addEventListener('click', (e) => e.stopPropagation());
    inp.addEventListener('blur', () => finish(true));
  }

  function openSessionContextMenu(btnEl, itemEl, sessionObj) {
    closeSessionContextMenu();
    itemEl.classList.add('menu-open');
    const isPinned = sessionObj.pinned === 1;
    const isDsSess = sessionObj.session_mode === 'deepseek_native' || state.uiMode === 'deepseek' || state.uiMode === 'phone-agent';
    const menu = document.createElement('div');
    menu.className = 'ds-session-ctx-menu';
    menu.setAttribute('role', 'menu');
    menu.innerHTML = `
      <button type="button" class="ds-ctx-item" data-act="rename" role="menuitem">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M12 20h9"></path>
          <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
        </svg>
        <span>重命名</span>
      </button>
      <button type="button" class="ds-ctx-item" data-act="pin" role="menuitem">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <line x1="12" y1="17" x2="12" y2="22"></line>
          <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a1 1 0 0 0 0-2H8a1 1 0 0 0 0 2h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17z"></path>
        </svg>
        <span>${isPinned ? '取消置顶' : '置顶会话'}</span>
      </button>

      <div class="ds-ctx-divider" role="separator"></div>

      <button type="button" class="ds-ctx-item" data-act="share" role="menuitem">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="18" cy="5" r="3"></circle>
          <circle cx="6" cy="12" r="3"></circle>
          <circle cx="18" cy="19" r="3"></circle>
          <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line>
          <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line>
        </svg>
        <span>分享与导出</span>
      </button>
      <button type="button" class="ds-ctx-item" data-act="export-md" role="menuitem">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
          <polyline points="14 2 14 8 20 8"></polyline>
          <line x1="12" y1="18" x2="12" y2="12"></line>
          <polyline points="9 15 12 18 15 15"></polyline>
        </svg>
        <span>导出为 .md</span>
      </button>
      <button type="button" class="ds-ctx-item" data-act="import-md" role="menuitem">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
          <polyline points="14 2 14 8 20 8"></polyline>
          <line x1="12" y1="12" x2="12" y2="18"></line>
          <polyline points="9 15 12 12 15 15"></polyline>
        </svg>
        <span>导入记忆档案</span>
      </button>
      <button type="button" class="ds-ctx-item" data-act="session-setting" role="menuitem">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="3"></circle>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
        </svg>
        <span>${isDsSess ? '系统提示词设定' : '专属人设设定'}</span>
      </button>

      <div class="ds-ctx-divider" role="separator"></div>

      <button type="button" class="ds-ctx-item danger" data-act="delete" role="menuitem">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <polyline points="3 6 5 6 21 6"></polyline>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          <line x1="10" y1="11" x2="10" y2="17"></line>
          <line x1="14" y1="11" x2="14" y2="17"></line>
        </svg>
        <span>删除会话</span>
      </button>
    `;
    document.body.appendChild(menu);

    const rect = btnEl.getBoundingClientRect();
    const top = Math.min(window.innerHeight - 300, rect.bottom + 4);
    const left = Math.min(window.innerWidth - 205, Math.max(8, rect.left));
    menu.style.top = `${Math.max(8, top)}px`;
    menu.style.left = `${left}px`;

    menu.addEventListener('click', async (e) => {
      e.stopPropagation();
      const actBtn = e.target.closest('[data-act]');
      if (!actBtn) return;
      const act = actBtn.dataset.act;
      closeSessionContextMenu();

      if (act === 'export-md') {
        await exportSessionMarkdownById(sessionObj.id);
      } else if (act === 'import-md') {
        if (state.activeSessionId !== sessionObj.id) {
          await loadSession(sessionObj.id);
        }
        openImportHistoryModal();
      } else if (act === 'session-setting') {
        if (state.activeSessionId !== sessionObj.id) {
          await loadSession(sessionObj.id);
        }
        openRightTab('persona-tab');
      } else if (act === 'pin') {
        const res = await apiJson(`/api/sessions/${encodeURIComponent(sessionObj.id)}`, {
          method: 'PATCH',
          body: JSON.stringify({ pinned: !isPinned })
        });
        state.sessions = res.sessions || state.sessions;
        renderSessionList();
        showToast(!isPinned ? '已置顶该对话' : '已取消置顶');
      } else if (act === 'rename') {
        startInlineSessionRename(itemEl, sessionObj);
      } else if (act === 'share') {
        if (state.activeSessionId !== sessionObj.id) {
          await loadSession(sessionObj.id);
        }
        openDsShareModal();
      } else if (act === 'delete') {
        if (!state.isStreaming) await deleteSession(sessionObj.id);
      }
    });

    activeSessionCtxMenu = { menuEl: menu, rowEl: itemEl };
  }

  function renderSessionList() {
    closeSessionContextMenu();
    const isDsUi = state.uiMode === 'deepseek' || state.uiMode === 'phone-agent';
    const headingEl = document.getElementById('session-list-heading');
    if (headingEl) {
      headingEl.textContent = isDsUi ? '历史对话' : '本剧故事存档';
    }

    const searchKw = (document.getElementById('ds-session-search-input')?.value || '')
      .trim()
      .toLowerCase();

    const filtered = state.sessions.filter((s) => {
      const modeMatch = isDsUi
        ? s.session_mode === 'deepseek_native'
        : s.session_mode !== 'deepseek_native';
      if (!modeMatch) return false;
      if (!isDsUi) {
        const pObj = state.personas.find((x) => x.id === s.persona_id);
        const sScript = s.script_id || resolvePersonaScriptId(pObj);
        if (state.scripts.length > 0 && sScript !== state.activeScriptId) return false;
      }
      if (
        isDsUi &&
        s.title === '新对话' &&
        (s.message_count || 0) === 0 &&
        !s.pinned &&
        !s.has_custom_setting &&
        s.id !== state.activeSessionId
      ) {
        return false;
      }
      if (isDsUi && searchKw) {
        return String(s.title || '')
          .toLowerCase()
          .includes(searchKw);
      }
      return true;
    });

    const timelineBounds = getDsTimelineBounds();
    const frag = document.createDocumentFragment();
    let lastGroup = '';

    for (const s of filtered) {
      let grp = resolveDsTimelineGroup(s, timelineBounds);
      if (!isDsUi && grp !== '置顶' && grp !== '今天' && grp !== '昨天' && grp !== '7 天内') {
        grp = '星语存档';
      } else if (!isDsUi && (grp === '今天' || grp === '昨天')) {
        grp = '今日';
      } else if (!isDsUi && grp === '7 天内') {
        grp = '近 7 日';
      }
      if (grp !== lastGroup) {
        lastGroup = grp;
        const grpEl = document.createElement('div');
        grpEl.className = 'session-group-label session-time-group-header';
        grpEl.innerHTML = `<span>${escapeHtml(grp)}</span>`;
        frag.appendChild(grpEl);
      }

      const isActiveSession = s.id === state.activeSessionId;
      const item = document.createElement('div');
      item.className = `session-item ${isActiveSession ? 'active' : ''}`;
      item.setAttribute('role', 'listitem');
      item.tabIndex = 0;
      if (isActiveSession) {
        item.setAttribute('aria-current', 'true');
      }
      const pinSvg = `<span class="ds-pin-glyph" title="已置顶" aria-hidden="true">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="12" y1="17" x2="12" y2="22"></line>
          <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a1 1 0 0 0 0-2H8a1 1 0 0 0 0 2h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17z"></path>
        </svg>
      </span>`;
      const prefixSpan = isDsUi
        ? s.pinned === 1
          ? pinSvg
          : ''
        : `${s.pinned === 1 ? pinSvg : ''}<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="session-icon-glyph" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>`;

      const hasCustomSetting = Boolean(
        s.has_custom_setting ||
          s.custom_persona_override ||
          (s.session_prompt && String(s.session_prompt).trim())
      );
      const customBadgeHtml = hasCustomSetting
        ? '<span class="session-custom-badge" title="该对话框配置了独立的专属设定">独立设定</span>'
        : '';

      item.innerHTML = `
        <div class="session-title-wrap">
          ${prefixSpan}
          <span class="session-title-text" title="${escapeHtml(s.title || '新对话')}（双击可快速重命名）">${escapeHtml(s.title)}</span>
          ${customBadgeHtml}
        </div>
        <div class="session-row-actions">
          <button type="button" class="ds-session-more-btn" title="更多操作" aria-label="对话更多操作">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="1.5"></circle>
              <circle cx="19" cy="12" r="1.5"></circle>
              <circle cx="5" cy="12" r="1.5"></circle>
            </svg>
          </button>
        </div>
      `;

      item.addEventListener('click', (e) => {
        if (
          e.target.closest('.session-del-btn') ||
          e.target.closest('.ds-session-more-btn') ||
          e.target.closest('.ds-session-rename-input')
        ) {
          return;
        }
        userManualSessionSwitchAt = Date.now();
        loadSession(s.id);
      });

      item.addEventListener('keydown', (e) => {
        if (e.target !== item) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          userManualSessionSwitchAt = Date.now();
          loadSession(s.id);
        }
      });

      item.querySelector('.session-title-text')?.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        startInlineSessionRename(item, s);
      });

      const moreBtn = item.querySelector('.ds-session-more-btn');
      if (moreBtn) {
        moreBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          openSessionContextMenu(moreBtn, item, s);
        });
      }

      frag.appendChild(item);
    }
    sessionListEl.replaceChildren(frag);
  }

  function updateBondBadge() {
    const n = state.nurturing;
    const liveMoodEl = document.getElementById('live-mood-chip');
    if (n && n.stage) {
      bondLevelTag.textContent = cleanUiEmojiText(n.stage.badge);
      if (liveMoodEl) liveMoodEl.textContent = n.current_mood || '专注倾听';
    } else {
      bondLevelTag.textContent = '初遇微光 Lv.1';
    }
  }

  let nurturingCapsuleTimer = null;
  function showNurturingMicroCapsule({ personaName, deltas = {}, mood = '', moodChanged = false }) {
    if (state.uiMode !== 'roleplay') return;
    const dAff = Number(deltas.affection) || 0;
    const dTrust = Number(deltas.trust) || 0;
    const dInt = Number(deltas.intimacy) || 0;
    if (!moodChanged && dAff <= 0 && dTrust <= 0 && dInt <= 0) return;

    document.querySelectorAll('.theater-nurturing-capsule').forEach((el) => el.remove());
    clearTimeout(nurturingCapsuleTimer);

    const shortName = String(personaName || 'TA').split(/[·\s]/)[0] || 'TA';
    const deltaTags = [];
    if (dAff > 0) deltaTags.push(`好感 +${dAff}`);
    if (dTrust > 0) deltaTags.push(`信任 +${dTrust}`);
    if (dInt > 0) deltaTags.push(`默契 +${dInt}`);

    const cleanMood = String(mood || '').replace(/^[^\u4e00-\u9fa5a-zA-Z]+/, '').trim();
    const moodSegment = moodChanged && cleanMood ? `心境转为「${cleanMood}」` : cleanMood ? `心境 · ${cleanMood}` : '关系升温';

    const cap = document.createElement('div');
    cap.className = 'theater-nurturing-capsule';
    cap.setAttribute('role', 'status');
    cap.innerHTML = `
      <span>✦ ${escapeHtml(shortName)} · ${escapeHtml(moodSegment)}</span>
      ${deltaTags.length > 0 ? `<span class="capsule-deltas">${escapeHtml(deltaTags.join(' · '))}</span>` : ''}
    `;
    document.body.appendChild(cap);
    requestAnimationFrame(() => cap.classList.add('is-visible'));

    nurturingCapsuleTimer = setTimeout(() => {
      cap.classList.remove('is-visible');
      setTimeout(() => cap.remove(), 380);
    }, 3600);
  }

  function showDreamLetterRitual(diary, persona) {
    if (!diary || state.uiMode !== 'roleplay') return;
    document.querySelectorAll('.theater-dream-letter-overlay').forEach((el) => el.remove());

    const shortName = String(persona?.name || 'TA').split(/[·\s]/)[0] || '他';
    const overlay = document.createElement('div');
    overlay.className = 'theater-dream-letter-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.innerHTML = `
      <div class="theater-dream-letter-card">
        <div class="theater-dream-seal" aria-hidden="true">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 1.5L14.4 9.6L22.5 12L14.4 14.4L12 22.5L9.6 14.4L1.5 12L9.6 9.6Z"/></svg>
        </div>
        <h3 class="theater-dream-title">昨晚 ${escapeHtml(shortName)} 为你写了一篇私密手札</h3>
        <p class="theater-dream-sub">${escapeHtml(diary.date || '星夜手札')} · ${escapeHtml(diary.mood || '静谧守候')}</p>
        <div class="theater-dream-body hidden" id="dream-ritual-letter-body">${escapeHtml(diary.content || '')}</div>
        <div class="theater-dream-actions">
          <button type="button" class="mini-primary-btn" id="dream-ritual-open-btn">拆阅信笺</button>
          <button type="button" class="secondary-btn" id="dream-ritual-close-btn">稍后再看</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const openBtn = overlay.querySelector('#dream-ritual-open-btn');
    const closeBtn = overlay.querySelector('#dream-ritual-close-btn');
    const bodyBox = overlay.querySelector('#dream-ritual-letter-body');
    let opened = false;

    openBtn?.addEventListener('click', () => {
      if (!opened) {
        opened = true;
        bodyBox?.classList.remove('hidden');
        openBtn.textContent = '收进日记本';
      } else {
        overlay.remove();
        openRightTab('nurture-tab');
      }
    });
    closeBtn?.addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });
  }

  function playChapterCurtainTransition(chapterInfo) {
    if (!chapterInfo || !chapterInfo.chapter || state.uiMode !== 'roleplay') return;
    document.querySelectorAll('.theater-chapter-curtain').forEach((el) => el.remove());

    const romans = ['I', 'II', 'III', 'IV', 'V'];
    const actNum = Math.max(1, Number(chapterInfo.act_number) || 2);
    const roman = romans[actNum - 1] || String(actNum);
    const chap = chapterInfo.chapter;
    const cleanTitle = String(chap.title || `第 ${actNum} 幕`).replace(/^[^\u4e00-\u9fa5a-zA-Z0-9]+/, '').trim();
    const cleanNote = String(chap.note || '').replace(/\{\{\s*user\s*\}\}/gi, state.user?.nickname || '你');

    const curtain = document.createElement('div');
    curtain.className = 'theater-chapter-curtain';
    curtain.innerHTML = `
      <div class="theater-curtain-act">ACT ${escapeHtml(roman)} · 开幕</div>
      <div class="theater-curtain-line"></div>
      <h2 class="theater-curtain-title">${escapeHtml(cleanTitle)}</h2>
      ${cleanNote ? `<p class="theater-curtain-note">${escapeHtml(cleanNote)}</p>` : ''}
    `;
    document.body.appendChild(curtain);
    requestAnimationFrame(() => curtain.classList.add('is-visible'));

    const dismiss = () => {
      curtain.classList.remove('is-visible');
      setTimeout(() => curtain.remove(), 550);
    };
    curtain.addEventListener('click', dismiss, { once: true });
    setTimeout(dismiss, 2800);
  }

  function renderNurturingAndDiary() {
    const n = state.nurturing || {
      affection: 22,
      trust: 26,
      intimacy: 18,
      current_mood: '温柔浅笑',
      stage: { badge: '初识破冰 Lv.1', playerDesc: '' },
      secret_diary: []
    };
    updateBondBadge();
    const pronoun = getPersonaPronoun();

    document.getElementById('nurture-stage-badge').textContent = cleanUiEmojiText(n.stage?.badge || '初识破冰 Lv.1');
    document.getElementById('nurture-mood-text').textContent = `心境：${n.current_mood || '温柔浅笑'}`;
    const descEl = document.getElementById('nurture-stage-desc');
    if (descEl) {
      if (n.stage?.playerDesc) {
        descEl.textContent = n.stage.playerDesc;
      } else {
        descEl.textContent = `随着好感、信任与默契提升，${pronoun}对你的称呼、语气亲密度与互动细节都会自然升温。`;
      }
    }
    const diarySecTitle = document.getElementById('diary-section-title');
    if (diarySecTitle) {
      diarySecTitle.textContent = `${pronoun}的私密日记`;
    }

    const pAff = document.getElementById('prog-affection');
    const pTrust = document.getElementById('prog-trust');
    const pInt = document.getElementById('prog-intimacy');
    pAff.value = n.affection;
    pTrust.value = n.trust;
    pInt.value = n.intimacy;
    document.getElementById('val-affection').textContent = `${n.affection} / 100`;
    document.getElementById('val-trust').textContent = `${n.trust} / 100`;
    document.getElementById('val-intimacy').textContent = `${n.intimacy} / 100`;

    // 更新剧场模式三环同心星轨仪
    const updateAstrolabeRing = (ringId, valId, score, radius) => {
      const ringEl = document.getElementById(ringId);
      const valEl = document.getElementById(valId);
      const clamped = Math.max(0, Math.min(100, Number(score) || 0));
      if (ringEl) {
        const circ = 2 * Math.PI * radius;
        ringEl.setAttribute('stroke-dasharray', circ.toFixed(2));
        ringEl.setAttribute('stroke-dashoffset', (circ * (1 - clamped / 100)).toFixed(2));
      }
      if (valEl) {
        valEl.textContent = `${clamped} / 100`;
      }
    };
    updateAstrolabeRing('astrolabe-ring-affection', 'astrolabe-val-affection', n.affection, 46);
    updateAstrolabeRing('astrolabe-ring-trust', 'astrolabe-val-trust', n.trust, 35);
    updateAstrolabeRing('astrolabe-ring-intimacy', 'astrolabe-val-intimacy', n.intimacy, 24);

    const diaryListEl = document.getElementById('diary-list');
    diaryListEl.innerHTML = '';
    const diaries = Array.isArray(n.secret_diary) ? n.secret_diary : [];
    if (diaries.length === 0) {
      diaryListEl.innerHTML = `<div class="diary-card">点击上方「整理记忆 &amp; 写日记」，偷看${pronoun}在心底为你写下的私密日记吧。</div>`;
    } else {
      const sealSvg = '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 1.5L14.4 9.6L22.5 12L14.4 14.4L12 22.5L9.6 14.4L1.5 12L9.6 9.6Z"/></svg>';
      for (const d of diaries) {
        const card = document.createElement('div');
        card.className = 'diary-card';
        const cleanDiaryText = String(d.content || '').replace(/。{2,}/g, '。');
        card.innerHTML = `
          <div class="diary-meta-row">
            <span class="diary-wax-seal">${sealSvg}<span>${escapeHtml(d.date || '星夜信笺')}</span></span>
            <span>${escapeHtml(d.mood || '')}</span>
          </div>
          <div>${escapeHtml(cleanDiaryText)}</div>
        `;
        diaryListEl.appendChild(card);
      }
    }
  }

  function renderLorebooks() {
    const listEl = document.getElementById('lore-cards-list');
    const countEl = document.getElementById('lorebook-count-label');
    if (!listEl) return;
    countEl.textContent = `${state.lorebooks.length} 条`;

    const frag = document.createDocumentFragment();
    for (const lb of state.lorebooks) {
      const hit = state.triggeredLoreIds.has(lb.id);
      const card = document.createElement('div');
      card.className = `lore-card ${hit ? 'triggered' : ''}`;
      const canDel = lb.user_id !== 'system';
      card.innerHTML = `
        <div class="lore-top">
          <span class="lore-title-tag">${escapeHtml(lb.title)}${hit ? ' · 本轮触发' : ''}</span>
          ${canDel ? '<button type="button" class="mem-act-btn del-lore-btn">移除</button>' : '<span class="lore-keys">预置秘闻</span>'}
        </div>
        <div class="lore-keys">触发关键词：${escapeHtml(lb.keywords)}</div>
        <div>${escapeHtml(lb.content)}</div>
      `;
      const delBtn = card.querySelector('.del-lore-btn');
      if (delBtn) {
        delBtn.addEventListener('click', async () => {
          const res = await apiJson(`/api/lorebooks/${encodeURIComponent(lb.id)}`, { method: 'DELETE' });
          state.lorebooks = res.lorebooks;
          renderLorebooks();
        });
      }
      frag.appendChild(card);
    }
    listEl.replaceChildren(frag);
  }

  function syncSessionIsolationBadges() {
    const sess = state.activeSession;
    const hasPrompt = Boolean(sess?.session_prompt && String(sess.session_prompt).trim());
    let hasOverride = false;
    if (sess?.custom_persona_override) {
      try {
        const ov = JSON.parse(sess.custom_persona_override);
        hasOverride = Boolean(ov && typeof ov === 'object' && Object.values(ov).some((v) => typeof v === 'string' && v.trim()));
      } catch {}
    }
    // 仅当用户真正填写保存了本对话专属设定或自定义角色覆盖时才显示生效中（排除幕次自动场景注）
    const hasCustom = hasPrompt || hasOverride;

    const statusBadge = document.getElementById('session-prompt-status-badge');
    if (statusBadge) {
      statusBadge.textContent = hasCustom ? '已生效' : '仅本对话生效';
    }
    const dsSettingPill = document.getElementById('ds-session-setting-pill');
    if (dsSettingPill) {
      const memCnt = Array.isArray(state.memories) ? state.memories.length : 0;
      const shouldShow = hasCustom || memCnt > 0;
      dsSettingPill.classList.toggle('hidden', !shouldShow);
      if (shouldShow) {
        dsSettingPill.textContent = hasCustom
          ? `已配置系统指令${memCnt > 0 ? ` · 记忆 ${memCnt} 条` : ''}`
          : `长期记忆 ${memCnt} 条`;
      }
    }
  }

  function populatePersonaEditor() {
    const p = state.activePersona;
    if (!p) return;
    topbarAvatar.innerHTML = renderSmartAvatarHtml(p.avatar, p.name, 'size-lg');
    topbarName.textContent = p.name;
    topbarTagline.textContent = replaceClientMacros(
      (state.activeSession?.session_prompt && String(state.activeSession.session_prompt).trim().slice(0, 48)) ||
        p.tagline ||
        p.backstory?.slice(0, 48) ||
        ''
    );
    updateBondBadge();

    document.getElementById('ip-avatar').value = p.avatar || '角';
    document.getElementById('ip-name').value = p.name || '';
    document.getElementById('ip-tagline').value = replaceClientMacros(p.tagline || '');
    document.getElementById('ip-personality').value = replaceClientMacros(p.personality || '');
    document.getElementById('ip-backstory').value = replaceClientMacros(p.backstory || '');
    document.getElementById('ip-style').value = replaceClientMacros(p.speaking_style || '');

    const sessionPromptEl = document.getElementById('session-prompt-input');
    if (sessionPromptEl) {
      sessionPromptEl.value = state.activeSession?.session_prompt || '';
    }

    const globalSyncWrap = document.getElementById('ip-global-sync-wrap');
    const globalSyncChk = document.getElementById('ip-sync-global-chk');
    const isCustomUserPersona = Boolean(p.user_id && p.user_id !== 'system' && p.user_id !== 'system_ds');
    if (globalSyncWrap) {
      globalSyncWrap.classList.toggle('hidden', !isCustomUserPersona);
    }
    if (globalSyncChk) {
      globalSyncChk.checked = false;
    }

    syncSessionIsolationBadges();

    // 剧场模式「一人一色温」角色主色动态漫反射环境光
    const personaGlowPalette = [
      'rgba(124, 92, 255, 0.17)',
      'rgba(229, 193, 133, 0.16)',
      'rgba(99, 179, 237, 0.15)',
      'rgba(232, 155, 180, 0.15)',
      'rgba(110, 203, 185, 0.14)'
    ];
    const nameKey = String(p.id || p.name || '');
    let nameHash = 0;
    for (let i = 0; i < nameKey.length; i++) {
      nameHash = (nameHash * 31 + nameKey.charCodeAt(i)) >>> 0;
    }
    const glowColor = personaGlowPalette[nameHash % personaGlowPalette.length];
    if (appShell) appShell.style.setProperty('--theater-persona-glow', glowColor);
    document.documentElement.style.setProperty('--theater-persona-glow', glowColor);
  }

  function renderConstellationCompass(memories, recalledIds) {
    const svgEl = document.getElementById('constellation-svg');
    const summaryEl = document.getElementById('constellation-summary');
    if (!svgEl) return;

    const list = Array.isArray(memories) ? memories : [];
    const maxNodes = 12;
    const shown = list.slice(0, maxNodes);
    const recalledNodes = [];

    const cx = 160;
    const cy = 66;
    let parts = [
      `<circle cx="${cx}" cy="${cy}" r="54" fill="none" stroke="rgba(229,193,133,0.14)" stroke-width="1" stroke-dasharray="3 4"/>`,
      `<circle cx="${cx}" cy="${cy}" r="32" fill="none" stroke="rgba(180,151,255,0.18)" stroke-width="1"/>`,
      `<line x1="20" y1="${cy}" x2="300" y2="${cy}" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>`,
      `<line x1="${cx}" y1="8" x2="${cx}" y2="124" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>`
    ];

    const coords = shown.map((mem, idx) => {
      const angle = (idx / Math.max(1, shown.length)) * Math.PI * 2 - Math.PI / 2;
      const radiusX = idx % 2 === 0 ? 112 : 68;
      const radiusY = idx % 2 === 0 ? 48 : 32;
      const x = Math.round((cx + Math.cos(angle) * radiusX) * 10) / 10;
      const y = Math.round((cy + Math.sin(angle) * radiusY) * 10) / 10;
      const lit = mem.pinned === 1 || (recalledIds && recalledIds.has(mem.id));
      if (lit) recalledNodes.push({ x, y });
      return { x, y, lit, title: mem.content || '' };
    });

    for (let i = 1; i < recalledNodes.length; i++) {
      const prev = recalledNodes[i - 1];
      const curr = recalledNodes[i];
      parts.push(
        `<line x1="${prev.x}" y1="${prev.y}" x2="${curr.x}" y2="${curr.y}" stroke="rgba(229,193,133,0.52)" stroke-width="1.2"/>`
      );
    }

    for (const node of coords) {
      if (node.lit) {
        parts.push(
          `<circle cx="${node.x}" cy="${node.y}" r="6.5" fill="rgba(229,193,133,0.22)"/>`,
          `<circle cx="${node.x}" cy="${node.y}" r="3.2" fill="#F2D6A2"/>`
        );
      } else {
        parts.push(`<circle cx="${node.x}" cy="${node.y}" r="2.2" fill="rgba(180,151,255,0.45)"/>`);
      }
    }

    if (coords.length === 0) {
      parts.push(`<circle cx="${cx}" cy="${cy}" r="3" fill="rgba(229,193,133,0.45)"/>`);
    }

    svgEl.innerHTML = parts.join('');
    if (summaryEl) {
      if (list.length === 0) {
        summaryEl.textContent = '星盘尚在静候，写下第一份共同回忆即可点亮星辰';
      } else {
        summaryEl.textContent = `星盘已点亮 ${recalledNodes.length} 颗核心羁绊 · 共珍藏 ${list.length} 段回忆`;
      }
    }
  }

  function renderTelemetryAndMemories() {
    const t = state.telemetry || {
      tier1PersonaTokens: 0,
      tier2MemoryTokens: 0,
      tier3WindowTokens: 0,
      totalTokens: 0,
      recalledMemoryCount: 0
    };

    const total = Math.max(1, t.totalTokens);
    const w1 = Math.max(8, Math.round((t.tier1PersonaTokens / total) * 100));
    const w2 = Math.max(6, Math.round((t.tier2MemoryTokens / total) * 100));
    const w3 = Math.max(8, 100 - w1 - w2);

    document.getElementById('bar-tier1').style.width = `${w1}%`;
    document.getElementById('bar-tier2').style.width = `${w2}%`;
    document.getElementById('bar-tier3').style.width = `${w3}%`;

    document.getElementById('val-tier1').textContent = t.tier1PersonaTokens;
    document.getElementById('val-tier2').textContent = t.tier2MemoryTokens;
    document.getElementById('val-tier3').textContent = t.tier3WindowTokens;
    document.getElementById('telemetry-total-label').textContent = `约 ${t.totalTokens} 字`;

    memoryPillText.textContent = `唤醒记忆 ${t.recalledMemoryCount} 条`;

    if (state.activeSession) {
      rollingSummaryInput.value = state.activeSession.rolling_summary || '';
      const thoughtOn = state.activeSession.enable_inner_thought === 1;
      const autoMemOn = state.activeSession.enable_auto_memory === 1;
      if (toggleThoughtBtn) {
        toggleThoughtBtn.classList.toggle('active', thoughtOn);
        toggleThoughtBtn.setAttribute('aria-pressed', String(thoughtOn));
      }
      if (toggleAutoMemBtn) {
        toggleAutoMemBtn.classList.toggle('active', autoMemOn);
        toggleAutoMemBtn.setAttribute('aria-pressed', String(autoMemOn));
      }
    }

    memoryCountLabel.textContent = `${state.memories.length} 条`;
    syncSessionIsolationBadges();
    renderConstellationCompass(state.memories, state.recalledIds);

    const isDsUi = state.uiMode === 'deepseek' || state.uiMode === 'phone-agent';
    const catLabel = isDsUi
      ? {
          Pinned: '核心约束',
          relation: '个人偏好',
          fact: '关键信息',
          event: '对话要点'
        }
      : {
          Pinned: '核心羁绊',
          relation: '专属称呼',
          fact: '心意细节',
          event: '共同回忆'
        };

    const memFrag = document.createDocumentFragment();
    for (const mem of state.memories) {
      const isRecalled = mem.pinned === 1 || state.recalledIds.has(mem.id);
      const retPct = mem.retention_pct !== undefined ? mem.retention_pct : 100;
      const recallCnt = mem.recall_count || 0;
      const card = document.createElement('div');
      card.className = `mem-card ${isRecalled ? 'recalled' : ''}`;
      card.innerHTML = `
        <div class="mem-card-top">
          <span class="mem-tag ${mem.pinned === 1 ? 'pinned' : ''}">
            ${escapeHtml(catLabel[mem.category] || (isDsUi ? '记忆' : '记忆'))}${isRecalled ? ' · 已点亮' : ''}
          </span>
          <div class="mem-card-actions">
            <span class="retention-pill" title="基于艾宾浩斯遗忘曲线，被提及唤醒越多越不易遗忘">鲜活 ${retPct}% · 唤醒 ${recallCnt}次</span>
            <button type="button" class="mem-act-btn pin-btn">${mem.pinned === 1 ? '取消置顶' : '置顶'}</button>
            <button type="button" class="mem-act-btn del-btn">移除</button>
          </div>
        </div>
        <div class="mem-card-text">${escapeHtml(mem.content)}</div>
      `;

      card.querySelector('.pin-btn').addEventListener('click', async () => {
        const res = await apiJson(`/api/memories/${encodeURIComponent(mem.id)}`, {
          method: 'PATCH',
          body: JSON.stringify({ pinned: mem.pinned !== 1 })
        });
        state.memories = res.memories;
        renderTelemetryAndMemories();
      });

      card.querySelector('.del-btn').addEventListener('click', async () => {
        const res = await apiJson(`/api/memories/${encodeURIComponent(mem.id)}`, {
          method: 'DELETE'
        });
        state.memories = res.memories;
        renderTelemetryAndMemories();
      });

      memFrag.appendChild(card);
    }
    memoryCardsList.replaceChildren(memFrag);
  }

  // ================= 8. 对话流渲染、智能防抢滚与流式通信 =================
  let userManuallyScrolledUp = false;
  let lastScrollBtnVisible = null;
  let scrollReadRaf = 0;
  let scrollBottomRaf = 0;
  let pendingForceScroll = false;
  const scrollBottomBtn = document.getElementById('ds-scroll-bottom-btn');
  const chatQuickNavEl = document.getElementById('chat-quick-nav');
  const chatScrollTopBtn = document.getElementById('chat-scroll-top-btn');
  const chatLocateBtn = document.getElementById('chat-locate-btn');

  function updateScrollBottomBtnVisibility(distOverride = null) {
    if (!messagesViewport) return;
    const dist =
      distOverride !== null
        ? distOverride
        : messagesViewport.scrollHeight - messagesViewport.scrollTop - messagesViewport.clientHeight;
    const isPaUnavailable = Boolean(
      state.uiMode === 'phone-agent' && !(window.PhoneAgent && window.PhoneAgent.isNative)
    );
    const msgDomCount = messagesContainer ? messagesContainer.querySelectorAll('.msg-row').length : 0;
    const hasChatContent = !isPaUnavailable && (state.messages.length > 0 || msgDomCount > 0);
    const canScroll = messagesViewport.scrollHeight - messagesViewport.clientHeight > 60;

    if (scrollBottomBtn) {
      const shouldShow = hasChatContent && dist > 150;
      if (shouldShow !== lastScrollBtnVisible) {
        lastScrollBtnVisible = shouldShow;
        scrollBottomBtn.classList.toggle('hidden', !shouldShow);
      }
    }

    const showTopBtn = hasChatContent && messagesViewport.scrollTop > 180;
    const showLocateBtn = hasChatContent && (msgDomCount >= 2 || canScroll);
    if (chatScrollTopBtn) chatScrollTopBtn.classList.toggle('hidden', !showTopBtn);
    if (chatLocateBtn) chatLocateBtn.classList.toggle('hidden', !showLocateBtn);
    if (chatQuickNavEl) chatQuickNavEl.classList.toggle('hidden', !showTopBtn && !showLocateBtn);

    if (dist < 60) {
      userManuallyScrolledUp = false;
    }
  }
  window.__refreshChatQuickNav = () => updateScrollBottomBtnVisibility();

  messagesViewport.addEventListener(
    'scroll',
    () => {
      if (scrollReadRaf) return;
      scrollReadRaf = requestAnimationFrame(() => {
        scrollReadRaf = 0;
        const dist = messagesViewport.scrollHeight - messagesViewport.scrollTop - messagesViewport.clientHeight;
        if (dist > 150) {
          userManuallyScrolledUp = true;
        } else if (dist < 50) {
          userManuallyScrolledUp = false;
        }
        updateScrollBottomBtnVisibility(dist);
      });
    },
    { passive: true }
  );

  scrollBottomBtn?.addEventListener('click', () => {
    userManuallyScrolledUp = false;
    messagesViewport.scrollTo({ top: messagesViewport.scrollHeight, behavior: 'smooth' });
  });

  chatScrollTopBtn?.addEventListener('click', () => {
    userManuallyScrolledUp = true;
    messagesViewport.scrollTo({ top: 0, behavior: 'smooth' });
  });

  // ========= 「定位聊天」消息目录检索与高亮定位抽屉 =========
  (function initChatLocatorSheet() {
    const sheet = document.getElementById('chat-locator-sheet');
    const backdrop = document.getElementById('chat-locator-backdrop');
    const closeBtn = document.getElementById('chat-locator-close');
    const searchInp = document.getElementById('chat-locator-search');
    const listEl = document.getElementById('chat-locator-list');
    const topBtn = document.getElementById('chat-locator-top-btn');
    const bottomBtn = document.getElementById('chat-locator-bottom-btn');
    const filterBtns = Array.from(document.querySelectorAll('.chat-loc-filter-btn'));
    if (!sheet || !listEl) return;

    let activeFilter = 'all';
    let cachedEntries = [];

    const collectEntries = () => {
      if (!messagesContainer) return [];
      const rows = Array.from(messagesContainer.querySelectorAll('.msg-row'));
      return rows.map((rowEl, idx) => {
        const isUser = rowEl.classList.contains('user');
        const isPa = rowEl.classList.contains('pa-assistant-row');
        let roleLabel = 'AI 回复';
        if (isUser) {
          roleLabel = '我的提问';
        } else if (isPa) {
          roleLabel = '手机辅助';
        } else if (state.uiMode === 'deepseek') {
          roleLabel = 'DeepSeek';
        } else if (state.activePersona?.name) {
          roleLabel = state.activePersona.name;
        }

        let textSource = '';
        if (isPa) {
          const taskTitle = rowEl.querySelector('.pa-card-task')?.textContent?.trim() || '';
          const stepTexts = Array.from(rowEl.querySelectorAll('.pa-step-top span'))
            .map((s) => s.textContent?.trim())
            .filter(Boolean)
            .slice(-2)
            .join(' · ');
          textSource = [taskTitle, stepTexts].filter(Boolean).join(' — ');
        } else {
          const contentEl = rowEl.querySelector('.msg-content, .msg-body') || rowEl;
          textSource = contentEl.textContent || '';
        }
        const snippet = String(textSource || '').replace(/\s+/g, ' ').trim() || '（空消息内容）';
        return { index: idx + 1, isUser, roleLabel, snippet, el: rowEl };
      });
    };

    const renderList = () => {
      const kw = String(searchInp?.value || '').trim().toLowerCase();
      const filtered = cachedEntries.filter((item) => {
        if (activeFilter === 'user' && !item.isUser) return false;
        if (activeFilter === 'assistant' && item.isUser) return false;
        if (kw && !item.snippet.toLowerCase().includes(kw) && !item.roleLabel.toLowerCase().includes(kw)) {
          return false;
        }
        return true;
      });

      if (filtered.length === 0) {
        listEl.innerHTML = `<div class="chat-loc-empty">${kw ? '未找到包含该关键词的对话记录' : '当前对话暂无消息记录'}</div>`;
        return;
      }

      listEl.innerHTML = filtered
        .map(
          (item) => `
          <button type="button" class="chat-loc-item" data-loc-floor="${item.index}" role="listitem">
            <div class="chat-loc-item-meta">
              <span class="chat-loc-role${item.isUser ? ' is-user' : ''}">${escapeHtml(item.roleLabel)}</span>
              <span class="chat-loc-floor">第 ${item.index} 条</span>
            </div>
            <div class="chat-loc-snippet">${escapeHtml(item.snippet.slice(0, 140))}</div>
          </button>`
        )
        .join('');

      listEl.querySelectorAll('.chat-loc-item').forEach((btn) => {
        btn.addEventListener('click', () => {
          const floor = Number(btn.getAttribute('data-loc-floor'));
          const entry = cachedEntries.find((x) => x.index === floor);
          sheet.classList.add('hidden');
          if (entry && entry.el && document.body.contains(entry.el)) {
            userManuallyScrolledUp = true;
            entry.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            entry.el.classList.remove('chat-locate-highlight');
            void entry.el.offsetWidth;
            entry.el.classList.add('chat-locate-highlight');
            setTimeout(() => entry.el.classList.remove('chat-locate-highlight'), 1900);
          }
        });
      });
    };

    const openLocator = () => {
      cachedEntries = collectEntries();
      if (searchInp) searchInp.value = '';
      renderList();
      sheet.classList.remove('hidden');
      setTimeout(() => searchInp?.focus(), 60);
    };

    const closeLocator = () => sheet.classList.add('hidden');

    chatLocateBtn?.addEventListener('click', openLocator);
    closeBtn?.addEventListener('click', closeLocator);
    backdrop?.addEventListener('click', closeLocator);
    searchInp?.addEventListener('input', renderList);

    filterBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        activeFilter = btn.getAttribute('data-loc-filter') || 'all';
        filterBtns.forEach((b) => b.classList.toggle('active', b === btn));
        renderList();
      });
    });

    topBtn?.addEventListener('click', () => {
      closeLocator();
      userManuallyScrolledUp = true;
      messagesViewport.scrollTo({ top: 0, behavior: 'smooth' });
    });

    bottomBtn?.addEventListener('click', () => {
      closeLocator();
      userManuallyScrolledUp = false;
      messagesViewport.scrollTo({ top: messagesViewport.scrollHeight, behavior: 'smooth' });
    });
  })();

  function scrollToBottom(force = false) {
    if (force) {
      userManuallyScrolledUp = false;
      messagesViewport.scrollTop = messagesViewport.scrollHeight;
      updateScrollBottomBtnVisibility(0);
      return;
    }
    if (!userManuallyScrolledUp) {
      messagesViewport.scrollTop = messagesViewport.scrollHeight;
      updateScrollBottomBtnVisibility(0);
      return;
    }
    updateScrollBottomBtnVisibility();
  }

  function scheduleScrollToBottom(force = false) {
    if (force) pendingForceScroll = true;
    if (scrollBottomRaf) return;
    scrollBottomRaf = requestAnimationFrame(() => {
      scrollBottomRaf = 0;
      const shouldForce = pendingForceScroll;
      pendingForceScroll = false;
      scrollToBottom(shouldForce);
    });
  }

  // 广播剧级温柔语音合成（优先路由至 24kHz Kokoro 神经网络帅气/可爱声线引擎）
  let activeSpeakBtn = null;
  function speakDialogueOnly(rawContent, btnEl) {
    if (typeof window.playCompanionNeuralTts === 'function') {
      window.playCompanionNeuralTts(rawContent, btnEl);
      return;
    }
    if (!('speechSynthesis' in window)) {
      showToast('当前浏览器环境暂不支持原生语音合成');
      return;
    }
    if (window.speechSynthesis.speaking && activeSpeakBtn === btnEl) {
      window.speechSynthesis.cancel();
      btnEl.classList.remove('speaking');
      btnEl.textContent = '听声';
      activeSpeakBtn = null;
      return;
    }
    window.speechSynthesis.cancel();
    if (activeSpeakBtn) {
      activeSpeakBtn.classList.remove('speaking');
      activeSpeakBtn.textContent = '听声';
    }

    const spokenText = String(rawContent || '')
      .replace(/^>.*$/gm, '') // 过滤底部提示块
      .replace(/\*[^*]+\*/g, '，') // 静音旁白神态描写，仅保留自然停顿
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\s+/g, ' ')
      .trim();

    if (!spokenText) {
      showToast('这段回应是纯无声神态动作描写哦');
      return;
    }

    const utter = new SpeechSynthesisUtterance(spokenText);
    utter.lang = 'zh-CN';
    utter.rate = 0.96;
    utter.pitch = 0.94;
    const voices = window.speechSynthesis.getVoices();
    const zhVoice =
      voices.find((v) => v.lang.includes('zh') && /Yunxi|Yunjian|Kangkang|Male/i.test(v.name)) ||
      voices.find((v) => v.lang.includes('zh'));
    if (zhVoice) utter.voice = zhVoice;

    activeSpeakBtn = btnEl;
    btnEl.classList.add('speaking');
    btnEl.textContent = '停止';

    utter.onend = () => {
      btnEl.classList.remove('speaking');
      btnEl.textContent = '听声';
      if (activeSpeakBtn === btnEl) activeSpeakBtn = null;
    };
    utter.onerror = utter.onend;
    window.speechSynthesis.speak(utter);
  }

  // 附件与剪贴板图片预览弹窗触发器
  function openAttachmentPreviewModal(att) {
    if (!att || !attachmentPreviewDialog) return;
    const titleEl = document.getElementById('att-preview-title');
    const bodyEl = document.getElementById('att-preview-body');
    if (titleEl) {
      titleEl.textContent = `${att.is_image ? '图片预览' : '文档预览'} · ${att.name || '附件'}`;
    }
    if (bodyEl) {
      if (att.is_image && att.data_url) {
        bodyEl.innerHTML = `<img src="${escapeHtml(att.data_url)}" alt="${escapeHtml(att.name || '上传图片')}" />`;
      } else {
        const txt = String(att.content || '（该历史附件仅保存了元信息摘要）');
        bodyEl.innerHTML = `<pre>${escapeHtml(txt)}</pre>`;
      }
    }
    attachmentPreviewDialog.showModal();
  }

  // 原地精修台词编辑器（用户消息支持「发送并重新生成」分支重跑）
  function mountInlineEditor(containerEl, msg, onSaved, allowResubmit = false) {
    if (containerEl.querySelector('.inline-edit-box')) return;
    const isDsUi = state.uiMode === 'deepseek' || state.uiMode === 'phone-agent';
    const box = document.createElement('div');
    box.className = 'inline-edit-box';
    box.innerHTML = `
      <textarea rows="3">${escapeHtml(msg.content)}</textarea>
      <div class="right-btns" style="justify-content: flex-end; gap: 6px;">
        <button type="button" class="secondary-btn cancel-edit-btn">取消</button>
        <button type="button" class="secondary-btn save-edit-btn">${allowResubmit ? '仅改文字' : '保存润色'}</button>
        ${
          allowResubmit && msg.id
            ? `<button type="button" class="${isDsUi ? 'ds-primary-btn' : 'primary-btn'} resubmit-edit-btn">发送并重新生成</button>`
            : ''
        }
      </div>
    `;
    box.querySelector('.cancel-edit-btn').addEventListener('click', () => box.remove());
    box.querySelector('.save-edit-btn').addEventListener('click', async () => {
      const nextVal = box.querySelector('textarea').value.trim();
      if (!nextVal) return;
      if (msg.id) {
        await apiJson(`/api/messages/${msg.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ content: nextVal })
        });
      }
      msg.content = nextVal;
      box.remove();
      onSaved();
      syncActiveSessionToCache();
      saveBootSnapshot();
      showToast('内容已保存');
    });
    const resubmitBtn = box.querySelector('.resubmit-edit-btn');
    if (resubmitBtn) {
      resubmitBtn.addEventListener('click', async () => {
        const nextVal = box.querySelector('textarea').value.trim();
        if (!nextVal || state.isStreaming) return;
        box.remove();
        await sendStreamMessage(nextVal, false, msg.id);
      });
    }
    containerEl.appendChild(box);
    box.querySelector('textarea')?.focus();
  }

  const DS_WHALE_AVATAR_SVG = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path fill="#4D6BFE" fill-rule="evenodd" clip-rule="evenodd" d="M23.748 4.482c-.254-.124-.364.113-.512.234-.051.039-.094.09-.137.136-.372.397-.806.657-1.373.626-.829-.046-1.537.214-2.163.848-.133-.782-.575-1.248-1.247-1.548-.352-.156-.708-.311-.955-.65-.172-.241-.219-.51-.305-.774-.055-.16-.11-.323-.293-.35-.2-.031-.278.136-.356.276-.313.572-.434 1.202-.422 1.84.027 1.436.633 2.58 1.838 3.393.137.093.172.187.129.323-.082.28-.18.552-.266.833-.055.179-.137.217-.329.14a5.526 5.526 0 0 1-1.736-1.18c-.857-.828-1.631-1.742-2.597-2.458a11.365 11.365 0 0 0-.689-.471c-.985-.957.13-1.743.388-1.836.27-.098.093-.432-.779-.428-.872.004-1.67.295-2.687.684a3.055 3.055 0 0 1-.465.137 9.597 9.597 0 0 0-2.883-.102c-1.885.21-3.39 1.102-4.497 2.623C.082 8.606-.231 10.684.152 12.85c.403 2.284 1.569 4.175 3.36 5.653 1.858 1.533 3.997 2.284 6.438 2.14 1.482-.085 3.133-.284 4.994-1.86.47.234.962.327 1.78.397.63.059 1.236-.03 1.705-.128.735-.156.684-.837.419-.961-2.155-1.004-1.682-.595-2.113-.926 1.096-1.296 2.746-2.642 3.392-7.003.05-.347.007-.565 0-.845-.004-.17.035-.237.23-.256a4.173 4.173 0 0 0 1.545-.475c1.396-.763 1.96-2.015 2.093-3.517.02-.23-.004-.467-.247-.588zM11.581 18c-2.089-1.642-3.102-2.183-3.52-2.16-.392.024-.321.471-.235.763.09.288.207.486.371.739.114.167.192.416-.113.603-.673.416-1.842-.14-1.897-.167-1.361-.802-2.5-1.86-3.301-3.307-.774-1.393-1.224-2.887-1.298-4.482-.02-.386.093-.522.477-.592a4.696 4.696 0 0 1 1.529-.039c2.132.312 3.946 1.265 5.468 2.774.868.86 1.525 1.887 2.202 2.891.72 1.066 1.494 2.082 2.48 2.914.348.292.625.514.891.677-.802.09-2.14.11-3.054-.614zm1-6.44a.306.306 0 0 1 .415-.287.302.302 0 0 1 .2.288.306.306 0 0 1-.31.307.303.303 0 0 1-.304-.308zm3.11 1.596c-.2.081-.399.151-.59.16a1.245 1.245 0 0 1-.798-.254c-.274-.23-.47-.358-.552-.758a1.73 1.73 0 0 1 .129-.933c.27-.611.832-1.047 1.411-1.428.16-.106.321-.219.493-.309.223-.117.434-.055.536.18.114.262.149.544.157.828.019.805-.285 1.487-.876 2.026z"/></svg>`;

  // 官方正版 DeepSeek 已思考微型折叠指示器（Chevron、四环交叠思考徽标）
  const DS_THINK_CHEVRON_SVG = `<svg class="ds-think-chevron-svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"></polyline></svg>`;
  const DS_THINK_BADGE_SVG = `<svg class="ds-think-badge-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8.6" cy="8.6" r="4.3"></circle><circle cx="15.4" cy="8.6" r="4.3"></circle><circle cx="8.6" cy="15.4" r="4.3"></circle><circle cx="15.4" cy="15.4" r="4.3"></circle></svg>`;
  const DS_THINK_ATOM_SVG = DS_THINK_BADGE_SVG;

  const DS_GLOBE_SEARCH_SVG = `<svg class="ds-inline-status-svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><line x1="3.6" y1="9" x2="20.4" y2="9"></line><line x1="3.6" y1="15" x2="20.4" y2="15"></line><path d="M11.5 3a14 14 0 0 0 0 18"></path><path d="M12.5 3a14 14 0 0 1 0 18"></path></svg>`;

  function formatDsReasoningHtml(rawReasoning) {
    const cleaned = String(rawReasoning || '')
      .replace(/^<think>\s*/i, '')
      .replace(/\s*<\/think>$/i, '')
      .trim();
    if (!cleaned) return '';
    return cleaned
      .split(/\n{2,}|\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((p) => `<p class="ds-thought-para">${escapeHtml(p)}</p>`)
      .join('');
  }

  function populateAssistantAvatar(avatarEl, isDsUi) {
    if (isDsUi) {
      const isPure = !state.activePersona || state.activePersona.id === 'persona_deepseek_official';
      if (isPure) {
        avatarEl.classList.add('ds-svg-avatar');
        avatarEl.innerHTML = DS_WHALE_AVATAR_SVG;
        return;
      }
      avatarEl.innerHTML = renderSmartAvatarHtml(state.activePersona?.avatar, state.activePersona?.name, 'size-md');
    } else {
      avatarEl.innerHTML = renderSmartAvatarHtml(state.activePersona?.avatar, state.activePersona?.name, 'size-md');
    }
  }

  function createAssistantMessageDom(msg, isLastAssistant) {
    const isDsUi = state.uiMode === 'deepseek' || state.uiMode === 'phone-agent';
    const meta = parseMsgMeta(msg);
    const row = document.createElement('div');
    row.className = 'msg-row assistant';

    const avatarEl = document.createElement('div');
    avatarEl.className = 'msg-avatar';
    populateAssistantAvatar(avatarEl, isDsUi);

    const bodyEl = document.createElement('div');
    bodyEl.className = 'msg-body';

    // 1. 主动发起消息标识徽章
    if (meta.is_proactive) {
      const proBadge = document.createElement('div');
      proBadge.className = 'proactive-msg-badge';
      proBadge.textContent = isDsUi
        ? '延伸思考 · 主动跟进'
        : `${state.activePersona?.name?.split(/[·\s]/)[0] || '他'}的主动搭话`;
      bodyEl.appendChild(proBadge);
    }

    // 2. 联网搜索与 URL 阅读参考来源折叠栏（1:1 复刻正版 DeepSeek 官网联网折叠头）
    if (Array.isArray(meta.search_results) && meta.search_results.length > 0) {
      const urlReadCnt = meta.search_results.filter((s) => s.is_url_read).length;
      const foldSummaryText =
        urlReadCnt > 0 && urlReadCnt === meta.search_results.length
          ? `已阅读 ${urlReadCnt} 个网页链接`
          : `已阅读 ${meta.search_results.length} 个网页`;
      const sDetails = document.createElement('details');
      sDetails.className = 'ds-fold-details';
      sDetails.innerHTML = `
        <summary class="ds-fold-summary">
          ${DS_GLOBE_SEARCH_SVG}
          <span>${escapeHtml(foldSummaryText)}</span>
        </summary>
        <div class="ds-search-list">
          ${meta.search_results
            .map(
              (s) => `
              <div class="ds-search-item">
                <div>
                  <a href="${escapeHtml(s.url)}" target="_blank" rel="noopener noreferrer">[${
                s.index
              }] ${escapeHtml(s.title)}</a>
                  ${s.site ? `<span class="ds-url-site-pill">${escapeHtml(s.site)}</span>` : ''}
                </div>
                <span class="ds-search-snippet">${escapeHtml(s.snippet)}</span>
              </div>`
            )
            .join('')}
        </div>
      `;
      bodyEl.appendChild(sDetails);
    }

    // 3. Function Calling 工具调用轨迹胶囊
    if (Array.isArray(meta.tool_calls) && meta.tool_calls.length > 0) {
      const toolBar = document.createElement('div');
      toolBar.className = 'ds-tool-pill-list';
      toolBar.innerHTML = meta.tool_calls
        .map(
          (tc) =>
            `<span class="ds-tool-badge">已调用工具 <code>${escapeHtml(tc.name)}</code> · ${escapeHtml(
              tc.summary || ''
            )}</span>`
        )
        .join('');
      bodyEl.appendChild(toolBar);
    }

    // 4. 思维链 / 心声独白折叠框（准确匹配角色性别「她的心声独白 / 他的心声独白」）
    const pPronoun = getPersonaPronoun(state.activePersona);
    function isSystemPlaceholderReasoning(text) {
      const t = String(text || '').trim();
      if (!t) return true;
      return /^已载入「.*」的性格羁绊与世界观设定/.test(t);
    }

    if (msg.reasoning && !isSystemPlaceholderReasoning(msg.reasoning)) {
      const secNum = Math.max(1, Math.round((msg.duration_ms || 1200) / 1000));
      const summaryLabel = isDsUi
        ? `已思考（用时 ${secNum} 秒）`
        : `${pPronoun}的心绪潜流 · 内心独白`;
      const rpSparkSvg = '<svg class="thought-spark-icon" width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 1.5L14.4 9.6L22.5 12L14.4 14.4L12 22.5L9.6 14.4L1.5 12L9.6 9.6Z"/></svg>';
      const details = document.createElement('details');
      details.className = 'thought-details';
      details.open = false; // 深度思考过程默认不展开，只有用户点击 summary 主动展开时才展开
      details.innerHTML = `
        <summary class="thought-summary">
          ${isDsUi ? DS_THINK_CHEVRON_SVG : rpSparkSvg}
          ${isDsUi ? DS_THINK_BADGE_SVG : ''}
          <span class="thought-label">${escapeHtml(summaryLabel)}</span>
          ${!isDsUi ? '<span class="thought-chevron">▼</span>' : ''}
        </summary>
        <div class="thought-content">${isDsUi ? formatDsReasoningHtml(msg.reasoning) : escapeHtml(msg.reasoning)}</div>
      `;
      bodyEl.appendChild(details);
    }

    // 5. 正文 Markdown 渲染（兼容识别孤立 "*" 历史中断残留）
    const rawTrimmedMsg = String(msg.content || '').trim();
    const isOrphanStar = /^[*＊]$/.test(rawTrimmedMsg);
    const displayContent = isOrphanStar
      ? '*（上次生成在刷新或网络中断时止步，可点击下方按钮继续或重演）*'
      : msg.content;
    const isInterruptedMsg = Boolean(
      meta.interrupted ||
        meta.partial_recovered ||
        isOrphanStar ||
        /\*\((?:已停止生成|生成已中断)\)\*$/.test(rawTrimmedMsg)
    );

    const prose = document.createElement('div');
    prose.className = 'assistant-prose';
    prose.innerHTML = renderMessageMarkdown(displayContent, meta.search_results || []);
    bodyEl.appendChild(prose);

    if (isInterruptedMsg && isLastAssistant && !state.isStreaming) {
      const intrBar = document.createElement('div');
      intrBar.className = 'msg-interrupted-bar';
      intrBar.innerHTML = `
        <span>生成已中断（已生成内容已为你完整保留）</span>
        <div class="msg-interrupted-actions">
          <button type="button" class="mini-primary-btn intr-continue-btn">▶️ 接着往下写</button>
          <button type="button" class="mini-btn intr-regen-btn">重新生成</button>
        </div>
      `;
      intrBar.querySelector('.intr-continue-btn')?.addEventListener('click', () => {
        if (!state.isStreaming) {
          sendStreamMessage('请紧接着你刚才中断的地方自然继续往下说，不要重复前面已经说过的内容。', false);
        }
      });
      intrBar.querySelector('.intr-regen-btn')?.addEventListener('click', () => {
        if (!state.isStreaming) {
          sendStreamMessage('', true);
        }
      });
      bodyEl.appendChild(intrBar);
    }

    // 6. 底部操作栏（原生 DeepSeek 模式采用官方线性 SVG 工具栏 + < 1 / 2 > 多版本切换器）
    let cacheTagHtml = '';
    if (isDsUi && meta.usage) {
      const u = meta.usage;
      const hit = u.prompt_cache_hit_tokens || 0;
      const miss = u.prompt_cache_miss_tokens || 0;
      const totalP = Math.max(1, hit + miss);
      const hitPct = Math.round((hit / totalP) * 100);
      const rTok = u.reasoning_tokens ? ` · 思考 ${u.reasoning_tokens} tokens` : '';
      cacheTagHtml = `<span class="ds-cache-hit-tag" style="margin-left:auto;" title="DeepSeek Context Caching 前缀缓存统计 (Hit ${hit} / Miss ${miss})">缓存命中 ${hitPct}%${escapeHtml(
        rTok
      )}</span>`;
    } else if (!isDsUi) {
      cacheTagHtml = `<span class="msg-recall-tag">呼应 ${msg.recalled_count || 0} 处</span>`;
    }

    const versions = Array.isArray(meta.versions) ? meta.versions : [];
    const totalVers = versions.length;
    const curVerIdx = totalVers > 1 ? Math.min(totalVers - 1, Math.max(0, Number(meta.active_version ?? totalVers - 1))) : 0;
    const verSwitcherHtml =
      totalVers > 1
        ? `<div class="ds-version-switcher" aria-label="切换生成版本">
             <button type="button" class="ds-ver-nav-btn ver-prev-btn" ${curVerIdx <= 0 ? 'disabled' : ''} aria-label="上一版本">&lt;</button>
             <span>${curVerIdx + 1} / ${totalVers}</span>
             <button type="button" class="ds-ver-nav-btn ver-next-btn" ${curVerIdx >= totalVers - 1 ? 'disabled' : ''} aria-label="下一版本">&gt;</button>
           </div>`
        : '';

    const footer = document.createElement('div');
    footer.className = 'msg-footer-bar';
    const canRegen = isLastAssistant && state.messages.some((m) => m.role === 'user');

    if (isDsUi) {
      const fb = meta.feedback || '';
      footer.innerHTML = `
        ${verSwitcherHtml}
        <span class="ds-copy-wrap">
          <button type="button" class="ds-icon-action-btn ds-copy-btn-std copy-btn" title="复制回答全文" aria-label="复制回答全文">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
          </button>
          <span class="ds-copy-live-tip" role="status"></span>
        </span>
        ${
          canRegen
            ? `<button type="button" class="ds-icon-action-btn regen-btn" title="重新生成（保留历史版本可对比）" aria-label="重新生成">
                 <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>
               </button>`
            : ''
        }
        <button type="button" class="ds-icon-action-btn ds-speak-btn tts-btn" title="朗读此条回答" aria-label="朗读此条回答">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>
        </button>
        <button type="button" class="ds-icon-action-btn edit-msg-btn" title="编辑修改本条回复" aria-label="编辑回复">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 20h9"></path><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"></path></svg>
        </button>
        <button type="button" class="ds-icon-action-btn branch-btn" title="从这一刻创建平行对话分支" aria-label="创建对话分支">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><line x1="6" y1="3" x2="6" y2="15"></line><circle cx="18" cy="6" r="3"></circle><circle cx="6" cy="18" r="3"></circle><path d="M18 9a9 9 0 0 1-9 9"></path></svg>
        </button>
        <button type="button" class="ds-icon-action-btn share-turn-btn" title="分享或导出对话长图" aria-label="分享对话">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"></path><polyline points="16 6 12 2 8 6"></polyline><line x1="12" y1="2" x2="12" y2="15"></line></svg>
        </button>
        <button type="button" class="ds-icon-action-btn fb-up-btn ${fb === 'up' ? 'liked' : ''}" title="回答有帮助" aria-label="回答有帮助" aria-pressed="${fb === 'up'}">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M7 10v12"></path><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z"></path></svg>
        </button>
        <button type="button" class="ds-icon-action-btn fb-down-btn ${fb === 'down' ? 'disliked' : ''}" title="回答待改进" aria-label="回答待改进" aria-pressed="${fb === 'down'}">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M17 14V2"></path><path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z"></path></svg>
        </button>
        ${cacheTagHtml}
      `;
    } else {
      footer.innerHTML = `
        ${cacheTagHtml}
        ${verSwitcherHtml}
        <span class="tts-wave-wrap">
          <span class="theater-wave-bars" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
          <button type="button" class="msg-tool-btn tts-btn" title="自动静音旁白，仅用温柔声线朗读角色对白">听声</button>
        </span>
        <button type="button" class="msg-tool-btn copy-btn">复制</button>
        ${canRegen ? `<button type="button" class="msg-tool-btn regen-btn" title="换一种剧情回答">重演</button>` : ''}
        <span class="msg-more-tools">
          <button type="button" class="msg-tool-btn snap-btn" title="生成唯美心动语录珍藏海报">语录签</button>
          <button type="button" class="msg-tool-btn branch-btn" title="从这一刻创建对话分支">分支</button>
          <button type="button" class="msg-tool-btn edit-msg-btn" title="编辑修改本条回复">编辑</button>
        </span>
        <button type="button" class="msg-tool-btn more-tools-btn" title="更多操作" aria-label="更多操作" aria-expanded="false">⋯</button>
      `;
      const moreBtn = footer.querySelector('.more-tools-btn');
      if (moreBtn) {
        moreBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const open = footer.classList.toggle('show-more');
          moreBtn.setAttribute('aria-expanded', String(open));
        });
      }
    }

    // 绑定 < 1 / 2 > 多版本切换（原地替换单条消息 DOM）
    const switchVersionTo = async (targetVerIdx) => {
      if (!versions[targetVerIdx] || state.isStreaming) return;
      const v = versions[targetVerIdx];
      msg.content = v.content || msg.content;
      msg.reasoning = v.reasoning || '';
      msg.duration_ms = v.duration_ms || 0;
      meta.active_version = targetVerIdx;
      if (Array.isArray(v.search_results)) meta.search_results = v.search_results;
      if (Array.isArray(v.tool_calls)) meta.tool_calls = v.tool_calls;
      if (v.usage !== undefined) meta.usage = v.usage;
      msg._parsedMeta = meta;
      if (msg.id) {
        try {
          await apiJson(`/api/messages/${msg.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ active_version: targetVerIdx })
          });
        } catch {}
      }
      renderDeepSeekSuiteTelemetry();
      if (row.isConnected) {
        let lastAst = -1;
        for (let k = state.messages.length - 1; k >= 0; k--) {
          if (state.messages[k]?.role === 'assistant') {
            lastAst = k;
            break;
          }
        }
        const isCurLast = state.messages.indexOf(msg) === lastAst;
        row.replaceWith(createAssistantMessageDom(msg, isCurLast));
        syncArtifactsIndicator();
      } else {
        renderMessages();
      }
    };

    footer.querySelector('.ver-prev-btn')?.addEventListener('click', () => switchVersionTo(curVerIdx - 1));
    footer.querySelector('.ver-next-btn')?.addEventListener('click', () => switchVersionTo(curVerIdx + 1));

    const ttsBtn = footer.querySelector('.tts-btn');
    if (ttsBtn) {
      ttsBtn.addEventListener('click', (e) => speakDialogueOnly(msg.content, e.currentTarget));
    }
    const snapBtn = footer.querySelector('.snap-btn');
    if (snapBtn) {
      snapBtn.addEventListener('click', () => openQuoteSnapModal(msg));
    }
    footer.querySelector('.share-turn-btn')?.addEventListener('click', () => openDsShareModal());

    const bindFeedback = (selector, targetVal) => {
      const btn = footer.querySelector(selector);
      if (!btn) return;
      btn.addEventListener('click', async () => {
        const nextFb = meta.feedback === targetVal ? '' : targetVal;
        meta.feedback = nextFb;
        msg._parsedMeta = meta;
        const upBtn = footer.querySelector('.fb-up-btn');
        const downBtn = footer.querySelector('.fb-down-btn');
        if (upBtn) {
          upBtn.classList.toggle('liked', nextFb === 'up');
          upBtn.setAttribute('aria-pressed', String(nextFb === 'up'));
        }
        if (downBtn) {
          downBtn.classList.toggle('disliked', nextFb === 'down');
          downBtn.setAttribute('aria-pressed', String(nextFb === 'down'));
        }
        if (msg.id) {
          try {
            await apiJson(`/api/messages/${msg.id}`, {
              method: 'PATCH',
              body: JSON.stringify({ feedback: nextFb })
            });
          } catch {}
        }
        if (nextFb === 'up') showToast('感谢反馈，已标记该回答有帮助');
        else if (nextFb === 'down') showToast('已记录反馈，你也可以点击「重新生成」获取另一版本对比');
      });
    };
    bindFeedback('.fb-up-btn', 'up');
    bindFeedback('.fb-down-btn', 'down');

    footer.querySelector('.branch-btn').addEventListener('click', async () => {
      if (state.isStreaming || !state.activeSessionId) return;
      const res = await apiJson(
        `/api/sessions/${encodeURIComponent(state.activeSessionId)}/branch`,
        {
          method: 'POST',
          body: JSON.stringify({ upto_message_id: msg.id || 0 })
        }
      );
      state.sessions = res.sessions;
      await loadSession(res.session_id);
      showToast('已从该节点开启独立对话分支');
    });

    footer.querySelector('.edit-msg-btn').addEventListener('click', () => {
      mountInlineEditor(bodyEl, msg, () => {
        prose.innerHTML = renderMessageMarkdown(msg.content, meta.search_results || []);
      });
    });

    footer.querySelector('.copy-btn').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      let ok = false;
      try {
        await navigator.clipboard.writeText(msg.content);
        ok = true;
      } catch {
        ok = fallbackLegacyCopy(msg.content);
      }
      if (isDsUi) {
        reportCopyOutcome(btn, ok);
      } else if (ok) {
        btn.textContent = '已复制';
        setTimeout(() => {
          btn.textContent = '复制';
        }, 1200);
      }
    });

    const regenBtn = footer.querySelector('.regen-btn');
    if (regenBtn) {
      regenBtn.addEventListener('click', () => {
        if (!state.isStreaming) sendStreamMessage('', true);
      });
    }

    bodyEl.appendChild(footer);

    // 7. 最新一条回复下方渲染「接话建议 / 追问」引导胶囊（受「剧情接话选项」开关控制，默认开启，随时可关）
    const effectiveFollowUps =
      isShowFollowUpsEnabled() && Array.isArray(meta.follow_ups) && meta.follow_ups.length > 0
        ? meta.follow_ups
        : [];
    if (isLastAssistant && !state.isStreaming && effectiveFollowUps.length > 0) {
      const fRow = document.createElement('div');
      fRow.className = 'follow-ups-row';
      for (const q of effectiveFollowUps) {
        const branchMatch = String(q).match(/^(?:🎬|🔍|💭)\s*(.+)$/);
        const iconGlyph = '›';
        const cleanQuery = branchMatch ? branchMatch[1] : String(q);
        const prettyChipHtml = escapeHtml(cleanQuery).replace(
          /\*([^*\n]+)\*/g,
          '<em class="rp-action">（$1）</em>'
        );
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'followup-chip';
        chip.innerHTML = `<span class="followup-arrow">${iconGlyph}</span><span>${prettyChipHtml}</span>`;
        chip.addEventListener('click', () => {
          if (!state.isStreaming) sendStreamMessage(cleanQuery, false);
        });
        fRow.appendChild(chip);
      }
      const hideBtn = document.createElement('button');
      hideBtn.type = 'button';
      hideBtn.className = 'followup-hide-chip';
      hideBtn.title = '关闭每句话后的选项胶囊（可在「更多」或「设置」重新打开）';
      hideBtn.textContent = '关闭选项';
      hideBtn.addEventListener('click', () => setShowFollowUpsEnabled(false, true));
      fRow.appendChild(hideBtn);
      bodyEl.appendChild(fRow);
    }

    row.appendChild(avatarEl);
    row.appendChild(bodyEl);
    return row;
  }

  function syncChatInputPlaceholder() {
    if (!chatInput) return;
    const isPhoneAgent = state.uiMode === 'phone-agent';
    const isDs = state.uiMode === 'deepseek';
    const hasChatted = isPhoneAgent
      ? Boolean(messagesContainer && messagesContainer.querySelector('.msg-row, .pa-msg-row'))
      : Boolean(Array.isArray(state.messages) && state.messages.some((m) => m.role === 'user'));

    if (hasChatted) {
      if (chatInput.placeholder !== '') chatInput.placeholder = '';
      return;
    }

    const isNarrowViewport = window.matchMedia('(max-width: 860px)').matches;
    let nextPlaceholder = '';
    if (isPhoneAgent) {
      nextPlaceholder = isNarrowViewport
        ? '输入手机控制指令或任务…'
        : '输入自然语言手机任务或本地口令（如：打开微信、回桌面、点击 设置）…';
    } else if (isDs) {
      nextPlaceholder = isNarrowViewport
        ? '给 DeepSeek 发送消息…'
        : '给 DeepSeek 发送消息（支持深度思考、联网搜索、代码生成与网页预览）…';
    } else {
      const pShort = (state.activePersona?.name || '').split(/[·\s]/)[0] || '';
      const curScript = typeof getActiveScriptObj === 'function' ? getActiveScriptObj() : { title: '' };
      if (isNarrowViewport) {
        nextPlaceholder = pShort
          ? `对「${pShort}」说点什么（可用 *写动作）…`
          : `和${getPersonaPronoun(state.activePersona)}说点什么（可用 *写动作）…`;
      } else if (pShort && curScript?.title) {
        nextPlaceholder = `输入台词或行动（可用 *星号* 写动作），与「${pShort}」推进《${curScript.title}》剧情…`;
      } else {
        nextPlaceholder = `和${getPersonaPronoun(state.activePersona)}说点什么吧…（可用 *星号* 描写动作细节，Enter 发送）`;
      }
    }
    if (chatInput.placeholder !== nextPlaceholder) {
      chatInput.placeholder = nextPlaceholder;
    }
  }

  let lastComposerEmpty = null;
  let lastSendDisabled = null;
  function syncComposerEmptyState() {
    syncChatInputPlaceholder();
    const isEmpty = !chatInput.value.trim() && state.pendingAttachments.length === 0;
    const isDisabled = Boolean(state.isStreaming || isEmpty);
    if (isEmpty !== lastComposerEmpty) {
      lastComposerEmpty = isEmpty;
      chatForm.classList.toggle('input-empty', isEmpty);
    }
    if (sendBtn && isDisabled !== lastSendDisabled) {
      lastSendDisabled = isDisabled;
      sendBtn.disabled = isDisabled;
    }
  }

  function createUserMessageDom(msg, idx) {
    const uMeta = parseMsgMeta(msg);
    const rawAtts = Array.isArray(uMeta.attachments_full)
      ? uMeta.attachments_full
      : Array.isArray(uMeta.attachments)
      ? uMeta.attachments
      : [];
    const imgAtts = rawAtts.filter((a) => a && a.is_image && a.data_url);
    const docAtts = rawAtts.filter((a) => a && !(a.is_image && a.data_url));

    const imgGridHtml =
      imgAtts.length > 0
        ? `<div class="msg-user-images">
            ${imgAtts
              .map(
                (a, imgIdx) =>
                  `<img src="${escapeHtml(a.data_url)}" alt="${escapeHtml(
                    a.name
                  )}" class="msg-user-img-card" loading="lazy" decoding="async" data-preview-img-idx="${imgIdx}" title="点击查看大图：${escapeHtml(
                    a.name
                  )}" />`
              )
              .join('')}
          </div>`
        : '';

    const attHtml =
      docAtts.length > 0
        ? `<div class="msg-attachments-row">
            ${docAtts
              .map((a, docIdx) => {
                const fMeta = inferClientFileBadge(a.name, a.badge, a.color);
                const subInfo = a.char_count
                  ? `已提取 ${Number(a.char_count).toLocaleString()} 字`
                  : formatFileByteSize(a.size || (a.content ? a.content.length : 0));
                return `<span class="ds-file-card clickable-att" data-preview-doc-idx="${docIdx}" title="点击查看文件内容：${escapeHtml(
                  a.name
                )}">
                  <span class="ds-file-badge ${escapeHtml(fMeta.color)}">${escapeHtml(fMeta.badge)}</span>
                  <span class="ds-file-meta">
                    <span class="ds-file-name">${escapeHtml(a.name)}</span>
                    <span class="ds-file-sub">${escapeHtml(subInfo)}</span>
                  </span>
                </span>`;
              })
              .join('')}
          </div>`
        : '';

    const row = document.createElement('div');
    row.className = 'msg-row user';
    const wrap = document.createElement('div');
    wrap.className = 'user-msg-wrap';
    const renderedUserHtml = escapeHtml(msg.content).replace(
      /\*([^*\n]+)\*/g,
      '<em class="rp-action">$1</em>'
    );
    wrap.innerHTML = `
      ${imgGridHtml}
      ${attHtml}
      <div class="msg-body user-bubble">${renderedUserHtml}</div>
      <div class="user-msg-tools">
        <button type="button" class="msg-tool-btn u-copy-btn">复制</button>
        <button type="button" class="msg-tool-btn u-edit-btn">编辑</button>
        ${msg.id ? '<button type="button" class="msg-tool-btn u-rewind-btn" title="删除此句之后的内容重走对话">回溯至此</button>' : ''}
      </div>
    `;

    wrap.querySelectorAll('[data-preview-img-idx]').forEach((imgEl) => {
      imgEl.addEventListener('click', () => {
        openAttachmentPreviewModal(imgAtts[Number(imgEl.dataset.previewImgIdx)]);
      });
    });
    wrap.querySelectorAll('[data-preview-doc-idx]').forEach((chipEl) => {
      chipEl.addEventListener('click', () => {
        openAttachmentPreviewModal(docAtts[Number(chipEl.dataset.previewDocIdx)]);
      });
    });

    wrap.querySelector('.u-copy-btn')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      try {
        await navigator.clipboard.writeText(msg.content);
      } catch {
        fallbackLegacyCopy(msg.content);
      }
      btn.textContent = '已复制';
      setTimeout(() => {
        btn.textContent = '复制';
      }, 1100);
    });

    wrap.querySelector('.u-edit-btn').addEventListener('click', () => {
      mountInlineEditor(
        wrap,
        msg,
        () => {
          wrap.querySelector('.msg-body').textContent = msg.content;
        },
        true
      );
    });
    const rwBtn = wrap.querySelector('.u-rewind-btn');
    if (rwBtn) {
      rwBtn.addEventListener('click', async () => {
        if (state.isStreaming || !msg.id) return;
        const curIdx = state.messages.indexOf(msg);
        const effectiveIdx = curIdx !== -1 ? curIdx : idx;
        const subsequentCount = Math.max(0, state.messages.length - 1 - effectiveIdx);
        const confirmed = await askUserConfirm({
          title: '确认回溯对话进度',
          message:
            subsequentCount > 0
              ? `确定要回溯到这句话吗？\n此句之后的 ${subsequentCount} 条后续对话记录将被永久清除且无法恢复（如需保留原线，可先点回复下方的「分支」开启新周目）。`
              : '确定要重置此节点状态吗？',
          confirmText: '确认回溯并清除后续',
          danger: true
        });
        if (!confirmed) return;
        await apiJson(`/api/messages/${msg.id}/rewind`, { method: 'POST' });
        await loadSession(state.activeSessionId);
        showToast('已回溯到该对话节点');
      });
    }
    row.appendChild(wrap);
    return row;
  }

  function syncArtifactsIndicator() {
    const isDsUi = state.uiMode === 'deepseek';
    const artDot = document.getElementById('ds-artifacts-count-dot');
    if (isDsUi) {
      const runButtons = messagesContainer.querySelectorAll('[data-run-code]');
      if (artDot) {
        artDot.classList.toggle('hidden', runButtons.length === 0);
      }
      if (runButtons.length > 0 && !state.lastSandboxCode) {
        const latestBtn = runButtons[runButtons.length - 1];
        const entry = codeSnippetStore.get(latestBtn.dataset.runCode);
        const raw = typeof entry === 'string' ? entry : entry?.code || '';
        if (raw) populateSideArtifactSandbox(raw, false);
      }
    } else if (artDot) {
      artDot.classList.add('hidden');
    }
  }

  function trimPreviousLastAssistantDecorations() {
    if (!messagesContainer) return;
    const starterGrid = messagesContainer.querySelector('.starter-prompts-grid');
    if (starterGrid) starterGrid.remove();
    const assistantRows = messagesContainer.querySelectorAll('.msg-row.assistant');
    for (const r of assistantRows) {
      r.querySelector('.follow-ups-row')?.remove();
      r.querySelector('.regen-btn')?.remove();
    }
  }

  let loadingEarlierMsgs = false;
  async function loadEarlierMessages() {
    if (loadingEarlierMsgs || !state.activeSessionId || !state.oldestMessageId) return;
    const targetSid = state.activeSessionId;
    loadingEarlierMsgs = true;
    const btn = document.getElementById('load-earlier-msgs-btn');
    if (btn) {
      btn.disabled = true;
      btn.textContent = '正在加载更早的对话…';
    }
    const prevScrollHeight = messagesViewport ? messagesViewport.scrollHeight : 0;
    const prevScrollTop = messagesViewport ? messagesViewport.scrollTop : 0;
    try {
      const res = await apiJson(
        `/api/sessions/${encodeURIComponent(targetSid)}?before_id=${encodeURIComponent(state.oldestMessageId)}&limit=60`
      );
      if (state.activeSessionId !== targetSid) return;
      const older = Array.isArray(res.messages) ? res.messages : [];
      if (older.length > 0) {
        const existIds = new Set(state.messages.map((m) => m.id).filter(Boolean));
        const uniqueOlder = older.filter((m) => !m.id || !existIds.has(m.id));
        state.messages = [...uniqueOlder, ...state.messages];
      }
      state.hasMoreMessages = Boolean(res.has_more_messages);
      if (res.total_messages !== undefined) state.totalMessages = Number(res.total_messages);
      state.oldestMessageId = Number(res.oldest_message_id || older[0]?.id || state.oldestMessageId || 0);
      syncActiveSessionToCache();
      renderMessages({ preserveScroll: true });
      if (messagesViewport) {
        const delta = messagesViewport.scrollHeight - prevScrollHeight;
        messagesViewport.scrollTop = Math.max(0, prevScrollTop + delta);
      }
    } catch (err) {
      showToast(err?.message || '加载更早消息失败');
      if (btn) {
        btn.disabled = false;
        btn.textContent = `加载更早的对话记录（共 ${state.totalMessages || state.messages.length} 条）`;
      }
    } finally {
      loadingEarlierMsgs = false;
    }
  }

  function renderMessages(opts = {}) {
    const preserveScroll = Boolean(opts && opts.preserveScroll);
    codeSnippetStore.clear();
    const p = state.activePersona;
    const isDsUi = state.uiMode === 'deepseek';
    const isPhoneAgentUi = state.uiMode === 'phone-agent';
    const chatStageEl = document.querySelector('.chat-stage');
    const paEmptyGuide = document.getElementById('pa-empty-guide');
    const frag = document.createDocumentFragment();

    if (isDsUi) {
      if (paEmptyGuide) paEmptyGuide.classList.add('hidden');
      const isEmpty = state.messages.length === 0;
      if (chatStageEl) chatStageEl.classList.toggle('ds-empty-mode', isEmpty);
      const greetTitleEl = document.getElementById('ds-greeting-title');
      const greetSubEl = document.getElementById('ds-greeting-subtitle');
      if (greetTitleEl) {
        const hour = new Date().getHours();
        let timeTitle = '今天有什么可以帮到你？';
        let timeSub = '星轨静谧，随时开启深度思考或沉浸剧场';
        if (hour >= 22 || hour < 5) {
          timeTitle = '星轨静谧，今晚想聊点什么？';
          timeSub = '夜深人静时分，适合代码调试、长程推演或推开剧场门扉';
        } else if (hour >= 5 && hour < 11) {
          timeTitle = '晨光微熹，今天从哪一件事开始？';
          timeSub = '全新一天的灵感与待办已就绪';
        } else if (hour >= 11 && hour < 14) {
          timeTitle = '午间时分，需要一起拆解什么问题？';
          timeSub = '喝口温水，随时告诉我你的想法';
        } else if (hour >= 14 && hour < 18) {
          timeTitle = '午后流光，有什么新点子想验证？';
          timeSub = '支持代码预览、结构化推演与多幕剧情互动';
        } else {
          timeTitle = '暮色温柔，今晚想推进哪一件事？';
          timeSub = '星语随身工作台已为你准备妥当';
        }
        greetTitleEl.textContent = timeTitle;
        if (greetSubEl) greetSubEl.textContent = timeSub;
      }
      syncComposerEmptyState();
    } else if (isPhoneAgentUi) {
      messagesContainer.replaceChildren();
      if (chatStageEl) chatStageEl.classList.remove('ds-empty-mode');
      if (window.PhoneAgent && typeof window.PhoneAgent.renderWorkspace === 'function') {
        window.PhoneAgent.renderWorkspace();
      } else if (paEmptyGuide) {
        paEmptyGuide.classList.remove('hidden');
      }
      syncComposerEmptyState();
      return;
    } else {
      if (paEmptyGuide) paEmptyGuide.classList.add('hidden');
      if (chatStageEl) chatStageEl.classList.remove('ds-empty-mode');
      if (p) {
        const banner = document.createElement('div');
        banner.className = 'persona-story-banner';
        const hasUserTurn = state.messages.some((m) => m.role === 'user');
        const promptsHtml =
          !hasUserTurn && Array.isArray(p.starter_prompts) && p.starter_prompts.length > 0
            ? `<div class="starter-prompts-grid">
                ${p.starter_prompts
                  .map((sp) => {
                    const prettySp = escapeHtml(sp).replace(
                      /\*([^*\n]+)\*/g,
                      '<em class="rp-action">（$1）</em>'
                    );
                    return `<button type="button" class="starter-chip" data-raw-prompt="${escapeHtml(sp)}">${prettySp}</button>`;
                  })
                  .join('')}
              </div>`
            : '';

        const userNickStr = state.user?.nickname || '你';
        const cleanBackstory = String(p.backstory || p.tagline || '可在右侧设定书查看详细背景')
          .replace(/\{\{user\}\}/gi, userNickStr)
          .replace(/\{\{char\}\}/gi, (p.name || '').split('·')[0].trim());
        const cleanNote = String(state.activeSession?.director_note || '')
          .replace(/\{\{user\}\}/gi, userNickStr)
          .trim();

        const directorHtml = cleanNote
          ? `<div style="margin-top:8px;font-size:12px;color:var(--brand-primary);font-weight:600;">当前幕次情境：${escapeHtml(
              cleanNote
            )}</div>`
          : '';

        const curSc = getActiveScriptObj();
        banner.innerHTML = `
          <div class="banner-title"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-2px;margin-right:5px;" aria-hidden="true"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg><span>剧本《${escapeHtml(curSc.title)}》 · 序章背景</span></div>
          <div>${escapeHtml(cleanBackstory)}</div>
          ${directorHtml}
          ${promptsHtml}
        `;

        banner.querySelectorAll('.starter-chip').forEach((chip) => {
          chip.addEventListener('click', () => {
            if (!state.isStreaming) {
              const rawSp = chip.getAttribute('data-raw-prompt') || chip.textContent.replace(/^✦\s*/, '');
              sendStreamMessage(rawSp, false);
            }
          });
        });

        frag.appendChild(banner);
      }
    }

    if (state.hasMoreMessages && state.messages.length > 0 && state.oldestMessageId > 0) {
      const moreWrap = document.createElement('div');
      moreWrap.className = 'load-earlier-msgs-wrap';
      moreWrap.style.cssText = 'display:flex;justify-content:center;margin:10px 0 14px;';
      const moreBtn = document.createElement('button');
      moreBtn.type = 'button';
      moreBtn.id = 'load-earlier-msgs-btn';
      moreBtn.className = 'load-earlier-msgs-btn';
      moreBtn.style.cssText = 'padding:6px 14px;border-radius:999px;border:1px solid var(--border-subtle,rgba(148,163,184,0.28));background:var(--bg-elevated,rgba(255,255,255,0.7));color:var(--text-secondary,#64748b);font-size:12px;font-weight:600;cursor:pointer;';
      const totalLbl = state.totalMessages > state.messages.length ? `（共 ${state.totalMessages} 条）` : '';
      moreBtn.textContent = `加载更早的对话记录${totalLbl}`;
      moreBtn.addEventListener('click', loadEarlierMessages);
      moreWrap.appendChild(moreBtn);
      frag.appendChild(moreWrap);
    }

    let lastAssistantIdx = -1;
    state.messages.forEach((m, idx) => {
      if (m.role === 'assistant') lastAssistantIdx = idx;
    });

    state.messages.forEach((msg, idx) => {
      if (msg.role === 'user') {
        frag.appendChild(createUserMessageDom(msg, idx));
      } else {
        frag.appendChild(createAssistantMessageDom(msg, idx === lastAssistantIdx));
      }
    });

    messagesContainer.replaceChildren(frag);
    syncArtifactsIndicator();
    updateBondBadge();
    syncComposerEmptyState();
    if (!preserveScroll) {
      scrollToBottom(true);
    } else {
      updateScrollBottomBtnVisibility();
    }
  }

  function setStreamingUi(streaming) {
    state.isStreaming = streaming;
    syncComposerEmptyState();
    stopStreamBtn.classList.toggle('hidden', !streaming);
    const stopLbl = document.getElementById('stop-btn-label');
    if (stopLbl) stopLbl.textContent = (state.uiMode === 'deepseek' || state.uiMode === 'phone-agent') ? '停止生成' : '轻声止步';
  }

  stopStreamBtn.addEventListener('click', () => {
    if (state.streamingAbort) {
      state.userStoppedStream = true;
      state.streamingAbort.abort('user_stop');
    }
  });

  async function sendStreamMessage(text, regenerate = false, editMessageId = 0, _retried404 = false) {
    if (state.isStreaming) return;
    let trimmed = (text || '').trim();

    // 仅在「手机辅助」工作台模式下由 Phone Agent 独立引擎全权接管，绝不创建或混用 DeepSeek 会话
    if (!regenerate && !editMessageId && state.uiMode === 'phone-agent' && window.PhoneAgent && typeof window.PhoneAgent.executeTaskInChat === 'function') {
      if (!trimmed) return;
      chatInput.value = '';
      syncComposerEmptyState();
      await window.PhoneAgent.executeTaskInChat(trimmed);
      return;
    }

    if (!state.activeSessionId) {
      if (state.uiMode === 'deepseek') {
        await startNativeDeepSeekSession('persona_deepseek_official');
      } else {
        const firstRp = state.personas.find((p) => p.id !== 'persona_deepseek_official');
        if (firstRp) await startSessionWithPersona(firstRp.id);
      }
      if (!state.activeSessionId) return;
    }
    const isDsUi = state.uiMode === 'deepseek';
    if (!regenerate && !editMessageId && state.pendingAttachments.some((a) => a.parsing)) {
      showToast('文件正在读取解析中，请稍候片刻再发送');
      return;
    }
    const stagedFiles = !regenerate && !editMessageId ? [...state.pendingAttachments] : [];

    if (regenerate && !state.messages.some((m) => m.role === 'user')) {
      showToast('请先和 TA 说上一句话，就能随时点击「重演」换不同回答啦');
      chatInput.focus();
      return;
    }

    if (!regenerate && !trimmed && stagedFiles.length === 0) return;

    const activeLlmMode = state.llmMode || state.activeSession?.llm_mode || 'local_antigravity';
    if (activeLlmMode === 'api') {
      const isOwnProvider = state.settings?.provider === 'own_deepseek';
      const hasKey = Boolean(state.settings?.own_deepseek_api_key_masked || state.settings?.has_own_deepseek_key);
      if (isOwnProvider && !hasKey) {
        showToast('⚠️ 您当前处于【云端 API 模式】，但尚未配置 API 密钥。已为您打开「设置」，填入密钥或切回「本地直连」即可开始对话', 5000);
        window.__dsOpenSettings();
        return;
      }
    }

    state.lastInteractionAt = Date.now();
    state.proactiveIdleCount = 0;

    const prefixInputEl = document.getElementById('ds-prefix-input');
    const prefixBarEl = document.getElementById('ds-prefix-bar');
    const assistantPrefix =
      prefixBarEl && !prefixBarEl.classList.contains('hidden') && prefixInputEl
        ? prefixInputEl.value.trim()
        : '';

    if (editMessageId > 0) {
      const targetIdx = state.messages.findIndex((m) => Number(m.id) === Number(editMessageId));
      if (targetIdx !== -1) {
        state.messages[targetIdx].content = trimmed;
        state.messages.splice(targetIdx + 1);
      }
      renderMessages();
    } else if (!regenerate) {
      if (!trimmed && stagedFiles.length > 0) {
        trimmed = `请帮我详细解析并总结上传的附件：${stagedFiles.map((a) => a.name).join('、')}`;
      }
      chatInput.value = '';
      state.pendingAttachments = [];
      renderPendingAttachments();
      const userMsgObj = {
        role: 'user',
        content: trimmed,
        meta: stagedFiles.length > 0 ? { attachments: stagedFiles, attachments_full: stagedFiles } : {}
      };
      state.messages.push(userMsgObj);
      const chatStageEl = document.querySelector('.chat-stage');
      if (chatStageEl) chatStageEl.classList.remove('ds-empty-mode');
      document.getElementById('pa-empty-guide')?.classList.add('hidden');
      trimPreviousLastAssistantDecorations();
      messagesContainer.appendChild(createUserMessageDom(userMsgObj, state.messages.length - 1));
      syncComposerEmptyState();
    } else if (
      state.messages.length > 0 &&
      state.messages[state.messages.length - 1].role === 'assistant'
    ) {
      state.messages.pop();
      const lastDomRow = messagesContainer.querySelector('.msg-row.assistant:last-of-type');
      if (lastDomRow) {
        lastDomRow.remove();
      } else {
        renderMessages();
      }
    }

    const originSessionId = state.activeSessionId;
    const originIsDsUi = isDsUi;
    const isStillOriginSession = () => state.activeSessionId === originSessionId;

    const liveRow = document.createElement('div');
    liveRow.className = 'msg-row assistant awaiting-first-token';

    const avatarEl = document.createElement('div');
    avatarEl.className = 'msg-avatar';
    populateAssistantAvatar(avatarEl, isDsUi);

    const bodyEl = document.createElement('div');
    bodyEl.className = 'msg-body';

    const liveSearchSlot = document.createElement('div');
    const liveToolSlot = document.createElement('div');
    liveToolSlot.className = 'ds-tool-pill-list hidden';

    const thoughtDetails = document.createElement('details');
    thoughtDetails.className = 'thought-details hidden';
    thoughtDetails.open = false; // 默认不展开，只有用户主动点击时才展开
    const rpLiveSparkSvg = '<svg class="thought-spark-icon" width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 1.5L14.4 9.6L22.5 12L14.4 14.4L12 22.5L9.6 14.4L1.5 12L9.6 9.6Z"/></svg>';
    thoughtDetails.innerHTML = `
      <summary class="thought-summary">
        ${isDsUi ? DS_THINK_CHEVRON_SVG : rpLiveSparkSvg}
        ${isDsUi ? DS_THINK_BADGE_SVG : ''}
        <span class="live-thought-label">${isDsUi ? '思考中... (0.0s)' : '正在倾听并揣摩心绪潜流…'}</span>
        ${!isDsUi ? '<span class="thought-chevron">▼</span>' : ''}
      </summary>
      <div class="thought-content streaming-cursor"></div>
    `;

    const proseEl = document.createElement('div');
    proseEl.className = 'assistant-prose streaming-cursor';
    proseEl.innerHTML = `<span class="shimmer-thinking-wrap"><span class="shimmer-thinking-text">${
      isDsUi ? '正在思考并组织回答…' : '正在聆听并组织回应…'
    }</span></span>`;

    bodyEl.appendChild(liveSearchSlot);
    bodyEl.appendChild(liveToolSlot);
    bodyEl.appendChild(thoughtDetails);
    bodyEl.appendChild(proseEl);
    liveRow.appendChild(avatarEl);
    liveRow.appendChild(bodyEl);
    messagesContainer.appendChild(liveRow);
    scrollToBottom(true);

    const thoughtContentEl = thoughtDetails.querySelector('.thought-content');
    const thoughtLabelEl = thoughtDetails.querySelector('.live-thought-label');

    const abortController = new AbortController();
    state.streamingAbort = abortController;
    state.streamingSessionId = originSessionId;
    state.userStoppedStream = false;
    setStreamingUi(true);

    const thinkStartedAt = Date.now();
    let thinkDoneSec = null;
    const thinkTimer = setInterval(() => {
      if (originIsDsUi && isStillOriginSession() && thinkDoneSec === null && !thoughtDetails.classList.contains('hidden')) {
        const sec = ((Date.now() - thinkStartedAt) / 1000).toFixed(1);
        thoughtLabelEl.textContent = `思考中... (${sec}s)`;
      }
    }, 250);

    let accReasoning = '';
    let accContent = '';
    let liveSearchResults = [];
    let liveToolCalls = [];
    let streamRenderRafId = 0;
    let reasoningDirty = false;
    let contentDirty = false;

    const flushLiveStreamDom = () => {
      streamRenderRafId = 0;
      if (!isStillOriginSession()) return;
      if (reasoningDirty) {
        reasoningDirty = false;
        thoughtDetails.classList.remove('hidden');
        if (originIsDsUi) {
          thoughtContentEl.innerHTML = formatDsReasoningHtml(accReasoning);
        } else {
          thoughtContentEl.textContent = accReasoning;
        }
      }
      if (contentDirty) {
        contentDirty = false;
        thoughtContentEl.classList.remove('streaming-cursor');
        if (accReasoning) {
          const livePronoun = getPersonaPronoun(state.activePersona);
          thoughtLabelEl.textContent = originIsDsUi
            ? `已思考（用时 ${thinkDoneSec || 1} 秒）`
            : `${livePronoun}的心绪潜流 · 内心独白`;
        }
        proseEl.innerHTML = renderMessageMarkdown(accContent, liveSearchResults, {
          isStreaming: true,
          streamKeyPrefix: 'live_cb'
        });
      }
      scheduleScrollToBottom(false);
    };

    const scheduleLiveStreamFlush = () => {
      if (!streamRenderRafId) {
        streamRenderRafId = requestAnimationFrame(flushLiveStreamDom);
      }
    };

    try {
      const response = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: originSessionId,
          content: trimmed,
          regenerate,
          edit_message_id: editMessageId || 0,
          attachments: stagedFiles,
          assistant_prefix: assistantPrefix,
          include_follow_ups: isShowFollowUpsEnabled(),
          llm_mode: activeLlmMode,
          local_model: state.localModel || state.activeSession?.local_model || 'DeepSeek-V4.1-Flash'
        }),
        signal: abortController.signal
      });

      if (!response.ok || !response.body) {
        const errObj = await response.json().catch(() => ({}));
        if (response.status === 401) {
          showAuthScreen();
          return;
        }
        if (response.status === 404 && !_retried404 && !regenerate && !editMessageId) {
          clearInterval(thinkTimer);
          state.streamingAbort = null;
          setStreamingUi(false);
          liveRow.remove();
          state.pendingAttachments = stagedFiles;
          if (isDsUi) {
            await startNativeDeepSeekSession('persona_deepseek_official');
          } else {
            const firstRp = state.personas.find((p) => p.id !== 'persona_deepseek_official');
            if (firstRp) await startSessionWithPersona(firstRp.id);
          }
          if (state.activeSessionId) {
            await sendStreamMessage(trimmed, false, 0, true);
          }
          return;
        }
        if (errObj.membership) {
          state.membership = errObj.membership;
          renderUserAndMembership();
        }
        if (errObj.code === 'API_KEY_REQUIRED' || errObj.code === 'OWN_KEY_MISSING') {
          showToast('⚠️ 未检测到有效 API 密钥，已为您呼出设置窗口', 3500);
          window.__dsOpenSettings();
        } else if (errObj.code === 'LOCAL_SERVICE_BUSY') {
          showToast('⚠️ 当前本地服务繁忙或未响应，建议点击左下角切换为「云端 API 模式」', 4000);
        }
        throw new Error(errObj.error || `流式请求失败 (${response.status})`);
      }

      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let receivedDoneEvent = false;
      let chapterCurtainShown = false;

      const handleSseBlock = (rawBlock) => {
        const lines = rawBlock.split(/\r?\n/);
        let eventName = 'message';
        let dataStr = '';
        for (const l of lines) {
          if (l.startsWith(':')) continue; // 忽略 SSE keepalive 心跳注释帧
          if (l.startsWith('event:')) eventName = l.slice(6).trim();
          else if (l.startsWith('data:')) dataStr += l.slice(5).trim();
        }
        if (!dataStr) return;

        let payload = {};
        try {
          payload = JSON.parse(dataStr);
        } catch {
          return;
        }

        if (!isStillOriginSession()) {
          if (eventName === 'done' && Array.isArray(payload.sessions)) {
            state.sessions = payload.sessions;
            renderSessionList();
          }
          return;
        }

        if (eventName === 'search_results' && Array.isArray(payload.items)) {
            liveRow.classList.remove('awaiting-first-token');
            liveSearchResults = payload.items;
            liveSearchSlot.innerHTML = `
              <details class="ds-fold-details" open>
                <summary class="ds-fold-summary">${DS_GLOBE_SEARCH_SVG}<span>已阅读 ${payload.items.length} 个网页</span></summary>
                <div class="ds-search-list">
                  ${payload.items
                    .map(
                      (s) =>
                        `<div class="ds-search-item"><div><a href="${escapeHtml(
                          s.url
                        )}" target="_blank" rel="noopener noreferrer">[${s.index}] ${escapeHtml(
                          s.title
                        )}</a>${s.site ? `<span class="ds-url-site-pill">${escapeHtml(s.site)}</span>` : ''}</div><span class="ds-search-snippet">${escapeHtml(s.snippet)}</span></div>`
                    )
                    .join('')}
                </div>
              </details>
            `;
            scheduleScrollToBottom(false);
          } else if (eventName === 'tool_call') {
            liveRow.classList.remove('awaiting-first-token');
            liveToolCalls.push(payload);
            liveToolSlot.classList.remove('hidden');
            const badge = document.createElement('span');
            badge.className = 'ds-tool-badge';
            badge.innerHTML = `调用 <code>${escapeHtml(payload.name)}</code> · ${escapeHtml(
              payload.summary || ''
            )}`;
            liveToolSlot.appendChild(badge);
            scheduleScrollToBottom(false);
          } else if (eventName === 'memory_extracted' && Array.isArray(payload.items)) {
            const firstItem = payload.items[0];
            showToast(
              firstItem.updated_existing
                ? `已更新记忆：${firstItem.content}`
                : `已镌刻新记忆：${firstItem.content}`,
              2400
            );
          } else if (eventName === 'nurturing_updated' && payload.snapshot) {
            state.nurturing = payload.snapshot;
            renderNurturingAndDiary();
            const d = payload.deltas || {};
            if (!originIsDsUi) {
              showNurturingMicroCapsule({
                personaName: state.activePersona?.name || 'TA',
                deltas: d,
                mood: payload.snapshot.current_mood,
                moodChanged: Boolean(payload.mood_changed)
              });
            }
          } else if (eventName === 'chapter_advanced' && payload.chapter) {
            if (!originIsDsUi && !chapterCurtainShown) {
              chapterCurtainShown = true;
              playChapterCurtainTransition(payload);
            }
          } else if (eventName === 'telemetry') {
            state.telemetry = payload.telemetry;
            state.recalledIds = new Set((payload.recalled_memories || []).map((m) => m.id));
            const trigLores = payload.triggered_lorebooks || [];
            state.triggeredLoreIds = new Set(trigLores.map((l) => l.id));
            if (trigLores.length > 0 && !originIsDsUi) {
              showToast(`已触发关键词设定：【${trigLores[0].title}】`, 2200);
            }
            if (payload.nurturing) {
              state.nurturing = payload.nurturing;
              renderNurturingAndDiary();
            }
            if (state.activeSession && payload.rolling_summary !== undefined) {
              state.activeSession.rolling_summary = payload.rolling_summary;
            }
            renderLorebooks();
            renderTelemetryAndMemories();
          } else if (eventName === 'reasoning') {
            liveRow.classList.remove('awaiting-first-token');
            accReasoning += payload.delta || '';
            reasoningDirty = true;
            scheduleLiveStreamFlush();
          } else if (eventName === 'content') {
            liveRow.classList.remove('awaiting-first-token');
            if (thinkDoneSec === null) {
              thinkDoneSec = Math.max(1, Math.round((Date.now() - thinkStartedAt) / 1000));
            }
            accContent += payload.delta || '';
            contentDirty = true;
            scheduleLiveStreamFlush();
          } else if (eventName === 'done') {
            if (streamRenderRafId) {
              cancelAnimationFrame(streamRenderRafId);
              streamRenderRafId = 0;
            }
            receivedDoneEvent = true;
            const finalAssistantMsg = {
              id: payload.message_id,
              role: 'assistant',
              reasoning: accReasoning,
              content: accContent || (originIsDsUi ? '*(生成已完成)*' : '*（温柔地注视着你）*'),
              duration_ms: payload.duration_ms,
              recalled_count: payload.recalled_count,
              meta: payload.meta || {
                search_results: liveSearchResults,
                tool_calls: liveToolCalls
              }
            };
            state.messages.push(finalAssistantMsg);
            if (Array.isArray(payload.memories)) state.memories = payload.memories;
            if (payload.nurturing) state.nurturing = payload.nurturing;
            if (Array.isArray(payload.sessions)) {
              state.sessions = payload.sessions;
              const cur = state.sessions.find((s) => s.id === originSessionId);
              if (cur && state.activeSession) state.activeSession.title = cur.title;
            }
            if (payload.membership) state.membership = payload.membership;
            setStreamingUi(false);
            trimPreviousLastAssistantDecorations();
            const wasThoughtUserOpened = Boolean(liveRow?.querySelector('.thought-details')?.open);
            const finalRow = createAssistantMessageDom(finalAssistantMsg, true);
            if (wasThoughtUserOpened) {
              const finalDetails = finalRow.querySelector('.thought-details');
              if (finalDetails) finalDetails.open = true;
            }
            if (liveRow.parentNode) {
              liveRow.replaceWith(finalRow);
            } else {
              messagesContainer.appendChild(finalRow);
            }
            syncArtifactsIndicator();
            updateBondBadge();
            syncComposerEmptyState();
            scheduleScrollToBottom(false);
            renderUserAndMembership();
            renderSessionList();
            renderNurturingAndDiary();
            renderLorebooks();
            renderTelemetryAndMemories();
            renderDeepSeekSuiteTelemetry();
            if (typeof state.totalMessages === 'number') {
              state.totalMessages = Math.max(state.totalMessages + 2, state.messages.length);
            }
            syncActiveSessionToCache();
            saveBootSnapshot();
            window.DeepSeekMonitorPlugin?.sync({
              settings: state.settings,
              messages: state.messages,
              forceBalanceRefresh: true
            });
            if (payload.chapter_advanced && !originIsDsUi && !chapterCurtainShown) {
              chapterCurtainShown = true;
              playChapterCurtainTransition(payload.chapter_advanced);
            }
            // 角色回复自动真声配音（零配置开箱即集成）
            if (
              !originIsDsUi &&
              accContent.trim() &&
              localStorage.getItem('auto_tts_reply') !== '0' &&
              typeof window.playCompanionNeuralTts === 'function'
            ) {
              window.playCompanionNeuralTts(accContent, null);
            }
          } else if (eventName === 'error') {
            throw new Error(payload.message || '流式推演中断');
          }
      };

      for await (const chunk of response.body) {
        if (!isStillOriginSession()) break;
        buffer += decoder.decode(chunk, { stream: true });
        const events = buffer.split(/\r?\n\r?\n/);
        buffer = events.pop() || '';
        for (const rawBlock of events) {
          handleSseBlock(rawBlock);
        }
      }

      if (isStillOriginSession()) {
        const tail = decoder.decode();
        if (tail) buffer += tail;
        if (buffer.trim()) {
          for (const rawBlock of buffer.split(/\r?\n\r?\n/)) {
            handleSseBlock(rawBlock);
          }
        }
      }

      // 若连接提前结束且未收到 done，但仍在原会话且已有部分生成内容，主动重拉会话对齐服务端抢救落库记录
      if (isStillOriginSession() && !receivedDoneEvent && (accContent.trim() || accReasoning.trim())) {
        await loadSession(originSessionId).catch(() => {});
      }
    } catch (err) {
      if (streamRenderRafId) {
        cancelAnimationFrame(streamRenderRafId);
        streamRenderRafId = 0;
      }
      // 若已切换至其他会话，绝不触碰当前新会话的任何数据或界面
      if (!isStillOriginSession()) {
        return;
      }
      if (err.name === 'AbortError' || abortController.signal.aborted) {
        liveRow.classList.remove('awaiting-first-token');
        thoughtContentEl.classList.remove('streaming-cursor');
        proseEl.classList.remove('streaming-cursor');
        const substantivePartial = accContent.replace(/^[\s*＊…—\-()（）「」『』【】]+$/g, '').trim();
        const trimmedAcc = accContent.trim();
        const balancedAcc =
          substantivePartial && (trimmedAcc.match(/\*/g) || []).length % 2 === 1
            ? `${trimmedAcc}*`
            : trimmedAcc;
        const preservedText = substantivePartial
          ? `${balancedAcc}\n\n（已停止生成）`
          : '*（已停止生成，可点击下方按钮继续或重演）*';
        const abortedMsg = {
          role: 'assistant',
          reasoning: accReasoning,
          content: preservedText,
          duration_ms: Date.now() - thinkStartedAt,
          recalled_count: state.recalledIds?.size || 0,
          meta: {
            interrupted: true,
            aborted_by_user: true,
            partial_recovered: Boolean(substantivePartial),
            search_results: liveSearchResults,
            tool_calls: liveToolCalls
          }
        };
        state.messages.push(abortedMsg);
        setStreamingUi(false);
        trimPreviousLastAssistantDecorations();
        const abortedRow = createAssistantMessageDom(abortedMsg, true);
        if (liveRow.parentNode) {
          liveRow.replaceWith(abortedRow);
        } else {
          messagesContainer.appendChild(abortedRow);
        }
        syncArtifactsIndicator();
        updateBondBadge();
        syncComposerEmptyState();
        showToast('已停止生成，已输出的内容已为您完整保留');
        // 延迟静默对齐服务端记录（防止旧快照覆盖刚保留的半段回复）
        const localCountAfterStop = state.messages.length;
        setTimeout(async () => {
          if (state.activeSessionId !== originSessionId || state.isStreaming) return;
          try {
            const syncData = await apiJson(`/api/sessions/${encodeURIComponent(originSessionId)}`);
            if (state.activeSessionId !== originSessionId || state.isStreaming) return;
            if (Array.isArray(syncData.messages) && syncData.messages.length >= localCountAfterStop) {
              const lastSrv = syncData.messages[syncData.messages.length - 1];
              if (lastSrv?.role === 'assistant') {
                state.messages[state.messages.length - 1].id = lastSrv.id;
              }
            }
          } catch {}
        }, 500);
      } else if (accContent.trim()) {
        liveRow.classList.remove('awaiting-first-token');
        proseEl.classList.remove('streaming-cursor');
        proseEl.innerHTML =
          renderMessageMarkdown(accContent, liveSearchResults) +
          `<p style="color: var(--accent-danger); margin-top: 8px; font-size: 13px;">网络波动提示：${escapeHtml(
            err?.message || '连接中断'
          )}（以上已生成正文已为你保留）</p>`;
        await loadSession(originSessionId).catch(() => {});
      } else {
        liveRow.classList.remove('awaiting-first-token');
        proseEl.classList.remove('streaming-cursor');
        const rawErrText = err?.message || '网络连接暂时中断，请稍后重试';
        const isLocalBusy = /本地服务|本地直连|极速直连|服务繁忙/i.test(rawErrText);
        const isKeyMissing = /API 密钥|API Key|OWN_KEY_MISSING|API_KEY_REQUIRED/i.test(rawErrText);

        let actionHtml = '';
        if (isLocalBusy) {
          actionHtml = `
            <div class="ds-error-tip-card" style="margin-top: 10px; padding: 12px 14px; background: rgba(245, 158, 11, 0.08); border: 1px solid rgba(245, 158, 11, 0.3); border-radius: 10px;">
              <div style="font-weight: 600; color: #d97706; margin-bottom: 4px;">⚡ 本地服务繁忙提示</div>
              <div style="font-size: 13px; color: var(--text-secondary); margin-bottom: 10px;">当前本地极速直连引擎服务繁忙或未响应。您可以稍后重试，或一键切换为云端 API 模式继续对话：</div>
              <button type="button" class="soft-tool-btn" style="padding: 5px 14px; font-size: 12.5px; cursor: pointer; border-radius: 6px; background: #3b82f6; color: #ffffff; border: none; font-weight: 600;" onclick="window.__dsToggleLlmMode()">☁️ 一键切换为云端 API 模式</button>
            </div>
          `;
        } else if (isKeyMissing) {
          actionHtml = `
            <div class="ds-error-tip-card" style="margin-top: 10px; padding: 12px 14px; background: rgba(59, 130, 246, 0.08); border: 1px solid rgba(59, 130, 246, 0.3); border-radius: 10px;">
              <div style="font-weight: 600; color: #2563eb; margin-bottom: 4px;">🔑 API 密钥待配置</div>
              <div style="font-size: 13px; color: var(--text-secondary); margin-bottom: 10px;">您当前处于云端 API 模式，尚未配置可用 API Key。请在「设置」中填入密钥，或直接切回本地直连模式开箱即用：</div>
              <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                <button type="button" class="soft-tool-btn" style="padding: 5px 14px; font-size: 12.5px; cursor: pointer; border-radius: 6px; background: #3b82f6; color: #ffffff; border: none; font-weight: 600;" onclick="window.__dsOpenSettings()">⚙️ 前往配置密钥</button>
                <button type="button" class="soft-tool-btn" style="padding: 5px 14px; font-size: 12.5px; cursor: pointer; border-radius: 6px; background: var(--bg-surface-hover); color: var(--text-primary); border: 1px solid var(--border-strong); font-weight: 600;" onclick="window.__dsToggleLlmMode()">⚡ 切回本地直连模式</button>
              </div>
            </div>
          `;
        }

        proseEl.innerHTML = `<p style="color: var(--accent-danger); font-size: 14px; line-height: 1.6;">提示：${escapeHtml(rawErrText)}</p>${actionHtml}`;
      }
    } finally {
      if (streamRenderRafId) {
        cancelAnimationFrame(streamRenderRafId);
        streamRenderRafId = 0;
      }
      clearInterval(thinkTimer);
      if (state.streamingAbort === abortController) {
        state.streamingAbort = null;
        state.streamingSessionId = null;
        setStreamingUi(false);
      }
      state.lastInteractionAt = Date.now();
    }
  }

  chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const val = (chatInput.value || '').trim();
    if (!val) return;

    // dsh-Go 手机辅助聊天模式分流：仅在当前处于手机辅助模式时交由 Phone Agent 调度，不干预 DeepSeek 与剧场对话
    if (state.uiMode === 'phone-agent') {
      chatInput.value = '';
      chatInput.style.height = 'auto';
      if (window.PhoneAgent && typeof window.PhoneAgent.executeTaskInChat === 'function') {
        window.PhoneAgent.executeTaskInChat(val);
      }
      return;
    }

    sendStreamMessage(chatInput.value, false);
  });

  // ================= 9. 人设文档上传与历史对话导入导出 =================
  function bindDropzone(zoneEl, onFileSelected) {
    zoneEl.addEventListener('dragover', (e) => {
      e.preventDefault();
      zoneEl.classList.add('dragover');
    });
    zoneEl.addEventListener('dragleave', () => zoneEl.classList.remove('dragover'));
    zoneEl.addEventListener('drop', (e) => {
      e.preventDefault();
      zoneEl.classList.remove('dragover');
      const file = e.dataTransfer?.files?.[0];
      if (file) onFileSelected(file);
    });
  }

  const quickPersonaFile = document.getElementById('quick-persona-file');
  document.getElementById('quick-upload-persona-btn').addEventListener('click', () => {
    quickPersonaFile.click();
  });
  quickPersonaFile.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const content = await readFileAsText(file);
      const res = await apiJson('/api/personas/parse-doc', {
        method: 'POST',
        body: JSON.stringify({ filename: file.name, content, auto_create: true })
      });
      state.personas.unshift(res.persona);
      await startSessionWithPersona(res.persona.id);
      showToast(`已从文档导入角色「${res.persona.name}」并开启初遇篇章！`);
    } catch (err) {
      showToast(`文档解析失败：${err.message}`);
    }
  });

  const modalPersonaFile = document.getElementById('modal-persona-file');
  document.getElementById('modal-select-persona-doc-btn').addEventListener('click', () => {
    modalPersonaFile.click();
  });
  async function fillCreateModalFromDoc(file) {
    try {
      const content = await readFileAsText(file);
      const res = await apiJson('/api/personas/parse-doc', {
        method: 'POST',
        body: JSON.stringify({ filename: file.name, content, auto_create: false })
      });
      const p = res.parsed;
      document.getElementById('cp-avatar').value = p.avatar || '角';
      document.getElementById('cp-name').value = p.name || '';
      document.getElementById('cp-tagline').value = p.tagline || '';
      document.getElementById('cp-personality').value = p.personality || '';
      document.getElementById('cp-backstory').value = p.backstory || '';
      document.getElementById('cp-style').value = p.speaking_style || '';
      document.getElementById('cp-greeting').value = p.greeting || '';
      document.getElementById('cp-prompts').value = (p.starter_prompts || []).join('\n');
      showToast(`已从「${file.name}」自动提取人设字段，核对后点击下方按钮即可缔结！`);
    } catch (err) {
      showToast(`${err.message}`);
    }
  }
  modalPersonaFile.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) fillCreateModalFromDoc(file);
  });
  bindDropzone(document.getElementById('modal-persona-dropzone'), fillCreateModalFromDoc);

  const inlinePersonaFile = document.getElementById('inline-persona-file');
  document.getElementById('trigger-inline-doc-btn').addEventListener('click', () => {
    inlinePersonaFile.click();
  });
  async function fillInlineEditorFromDoc(file) {
    try {
      const content = await readFileAsText(file);
      const res = await apiJson('/api/personas/parse-doc', {
        method: 'POST',
        body: JSON.stringify({ filename: file.name, content, auto_create: false })
      });
      const p = res.parsed;
      document.getElementById('ip-avatar').value = p.avatar || '角';
      document.getElementById('ip-name').value = p.name || '';
      document.getElementById('ip-tagline').value = p.tagline || '';
      document.getElementById('ip-personality').value = p.personality || '';
      document.getElementById('ip-backstory').value = p.backstory || '';
      document.getElementById('ip-style').value = p.speaking_style || '';
      showToast(`已载入文档「${file.name}」，点击底部「保存设定」即可对当前角色生效`);
    } catch (err) {
      showToast(`${err.message}`);
    }
  }
  inlinePersonaFile.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) fillInlineEditorFromDoc(file);
  });
  bindDropzone(document.getElementById('inline-persona-dropzone'), fillInlineEditorFromDoc);

  const historyFileInput = document.getElementById('history-file-input');
  const historyPasteArea = document.getElementById('history-paste-area');
  const historyFileBadge = document.getElementById('history-file-badge');

  function buildClientSessionMemoryMarkdown(bundle = {}) {
    if (bundle.markdown && typeof bundle.markdown === 'string' && bundle.markdown.trim()) {
      return bundle.markdown;
    }
    const isNative = (bundle.session_mode || state.activeSession?.session_mode) === 'deepseek_native';
    const personaObj = bundle.persona || state.activePersona || {};
    const personaName = bundle.persona_name || personaObj.name || (isNative ? 'DeepSeek 官方助手' : '未命名角色');
    const title = (bundle.title || state.activeSession?.title || personaName || '对话记录').trim();
    const memories = Array.isArray(bundle.memories) ? bundle.memories : state.memories || [];
    const messages = Array.isArray(bundle.messages) ? bundle.messages : state.messages || [];
    const sessionPrompt = String(bundle.session_prompt ?? state.activeSession?.session_prompt ?? '').trim();
    const directorNote = String(bundle.director_note ?? state.activeSession?.director_note ?? '').trim();
    const rollingSummary = String(bundle.rolling_summary ?? state.activeSession?.rolling_summary ?? '').trim();
    const modeLabel = isNative ? 'DeepSeek 原生对话模式' : '星语恋庭 · 角色扮演模式';
    const isPureOfficial =
      personaObj.id === 'persona_deepseek_official' &&
      !bundle.persona_override &&
      !state.activeSession?.custom_persona_override;

    const lines = [
      `# ${title} · 聊天记录与专属记忆档案`,
      ``,
      `> - **对话模式**：${modeLabel}`,
      `> - **角色 / 助手名称**：${personaName}`,
      `> - **导出时间**：${new Date().toLocaleString('zh-CN', { hour12: false })}`,
      `> - **记忆条数 / 消息轮数**：独立记忆 ${memories.length} 条 · 历史消息 ${messages.length} 条`,
      `> - **跨对话记忆说明**：本文件包含当前对话框独立的专属设定、长期记忆锚点、前情浓缩手札与完整聊天记录，可直接导入其他对话框或外部平台作为记忆使用。`,
      ``,
      `## 本对话专属设定`,
      `- **角色 / 身份名称**：${personaName}`
    ];
    if (personaObj.avatar) lines.push(`- **专属徽记**：${personaObj.avatar}`);
    if (!isPureOfficial) {
      if (personaObj.tagline) lines.push(`- **一句话定位**：${String(personaObj.tagline).trim()}`);
      if (personaObj.personality) {
        lines.push(`- **性格特质**：${String(personaObj.personality).trim().replace(/\r?\n/g, ' / ')}`);
      }
      if (personaObj.speaking_style) {
        lines.push(`- **语言风格**：${String(personaObj.speaking_style).trim().replace(/\r?\n/g, ' / ')}`);
      }
      if (personaObj.backstory) {
        lines.push(`- **背景与世界观设定**：\n${String(personaObj.backstory).trim()}`);
      }
    }
    lines.push(
      sessionPrompt
        ? `- **本对话独立设定指令**：\n${sessionPrompt}`
        : `- **本对话独立设定指令**：_（未额外指定，使用当前对话基础设定）_`
    );
    if (directorNote) lines.push(`- **当前场景氛围指引**：\n${directorNote}`);
    lines.push(``);

    const catMap = { Pinned: '核心记忆', relation: '专属称呼', fact: '已知心意', event: '共同回忆' };
    lines.push(`## 长期记忆锚点`);
    if (memories.length > 0) {
      for (const m of memories) {
        if (!m || !String(m.content || '').trim()) continue;
        const pin = m.pinned ? '[重点] ' : '';
        const cat = catMap[m.category] || '记忆条目';
        const imp = Number(m.importance) || 4;
        lines.push(`- ${pin}[${cat} | 重要度 ${imp}] ${String(m.content).trim().replace(/\r?\n+/g, ' ')}`);
      }
    } else {
      lines.push(`_（当前对话暂无已归档的长期记忆条目）_`);
    }
    lines.push(``);

    lines.push(`## 前情浓缩手札`);
    lines.push(rollingSummary || `_（暂无前情浓缩摘要）_`);
    lines.push(``);

    lines.push(`## 完整聊天记录`);
    lines.push(``);
    if (messages.length > 0) {
      const assistantName = isNative && isPureOfficial ? 'DeepSeek' : personaName;
      for (const m of messages) {
        const body = String(m.content || '').trim();
        const r = String(m.reasoning || '').trim();
        if (!body && !r) continue;
        if (m.role === 'user') {
          lines.push(`### 我：\n\n${body}\n`);
        } else {
          lines.push(`### ${assistantName}：\n`);
          if (r) {
            lines.push(`<details><summary>思考与心声过程</summary>\n\n${r}\n\n</details>\n`);
          }
          lines.push(`${body}\n`);
        }
      }
    } else {
      lines.push(`_（当前对话暂无历史消息记录）_\n`);
    }
    return lines.join('\n');
  }

  function triggerBrowserDownload(contentStr, mimeType, rawFilename) {
    const safeName = String(rawFilename || '对话记忆档案').replace(/[\\/:*?"<>|]/g, '_');
    const blob = new Blob([contentStr], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = safeName;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    // 延迟释放 ObjectURL，避免现代浏览器异步启动下载流前被同步吊销导致首次点击不下载
    setTimeout(() => {
      a.remove();
      URL.revokeObjectURL(url);
    }, 15000);
  }

  async function exportSessionMarkdownById(targetSessionId) {
    const sid = targetSessionId || state.activeSessionId;
    if (!sid) return;
    // 若导出的正是当前已加载会话，在用户点击同步手势帧内 0ms 立即触发浏览器下载，杜绝云浏览器拦截异步下载
    if (sid === state.activeSessionId && state.activeSession && Array.isArray(state.messages)) {
      const mdNow = buildCurrentSessionMarkdown();
      const titleNow = (state.activeSession.title || state.activePersona?.name || '对话记录').slice(0, 28);
      triggerBrowserDownload(mdNow, 'text/markdown;charset=utf-8', `${titleNow}_聊天与记忆档案.md`);
      showToast(`已开始下载「${titleNow}_聊天与记忆档案.md」！`);
      return;
    }
    try {
      const data = await apiJson(`/api/sessions/${encodeURIComponent(sid)}/export`);
      const md = buildClientSessionMemoryMarkdown(data);
      const baseTitle = (data.title || data.persona_name || '对话记录').slice(0, 28);
      triggerBrowserDownload(md, 'text/markdown;charset=utf-8', `${baseTitle}_聊天与记忆档案.md`);
      showToast(`已开始下载「${baseTitle}_聊天与记忆档案.md」！`);
    } catch (err) {
      showToast(`导出 .md 失败：${err.message}`);
    }
  }

  async function exportSessionJsonById(targetSessionId) {
    const sid = targetSessionId || state.activeSessionId;
    if (!sid) return;
    try {
      const data = await apiJson(`/api/sessions/${encodeURIComponent(sid)}/export`);
      const baseTitle = (data.title || '回忆篇章').slice(0, 28);
      triggerBrowserDownload(
        JSON.stringify(data, null, 2),
        'application/json;charset=utf-8',
        `${baseTitle}_聊天与记忆备份.json`
      );
      showToast('已导出当前对话完整 JSON 备份文件');
    } catch (err) {
      showToast(`导出失败：${err.message}`);
    }
  }

  function syncImportReplaceDangerWarning() {
    const mode = document.querySelector('input[name="import-mode"]:checked')?.value || 'append';
    document.getElementById('import-replace-warning')?.classList.toggle('hidden', mode !== 'replace');
  }
  document.querySelectorAll('input[name="import-mode"]').forEach((radio) => {
    radio.addEventListener('change', syncImportReplaceDangerWarning);
  });

  function openImportHistoryModal() {
    hidePopoverSafe('topbar-more-popover');
    hidePopoverSafe('ds-user-popover');
    state.pendingHistoryFile = null;
    historyPasteArea.value = '';
    historyFileBadge.textContent = '支持 .md 记忆档案 / .txt / .json / .jsonl';
    const appendRadio = document.querySelector('input[name="import-mode"][value="append"]');
    if (appendRadio) appendRadio.checked = true;
    syncImportReplaceDangerWarning();
    const applySetChk = document.getElementById('import-apply-setting-chk');
    const repMemChk = document.getElementById('import-replace-memories-chk');
    if (applySetChk) applySetChk.checked = false;
    if (repMemChk) repMemChk.checked = false;
    importHistoryDialog.showModal();
  }

  document.getElementById('open-import-history-btn')?.addEventListener('click', openImportHistoryModal);
  document.getElementById('sidebar-import-history-btn')?.addEventListener('click', openImportHistoryModal);
  document.getElementById('ds-menu-import-md-btn')?.addEventListener('click', openImportHistoryModal);
  document.getElementById('memtab-import-md-btn')?.addEventListener('click', openImportHistoryModal);
  document.getElementById('close-import-dialog').addEventListener('click', () => importHistoryDialog.close());
  document.getElementById('cancel-import-dialog').addEventListener('click', () => importHistoryDialog.close());
  document.getElementById('select-history-file-btn').addEventListener('click', () => historyFileInput.click());

  async function stageHistoryFile(file) {
    try {
      const content = await readFileAsText(file);
      state.pendingHistoryFile = { filename: file.name, content };
      historyFileBadge.textContent = `已选定文件：${file.name}`;
      historyPasteArea.value = content.slice(0, 4000);
    } catch (err) {
      showToast(`${err.message}`);
    }
  }
  historyFileInput.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) stageHistoryFile(file);
  });
  bindDropzone(document.getElementById('history-dropzone'), stageHistoryFile);

  document.getElementById('import-history-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!state.activeSessionId) return;

    const pasted = historyPasteArea.value.trim();
    const content = state.pendingHistoryFile ? state.pendingHistoryFile.content : pasted;
    const filename = state.pendingHistoryFile ? state.pendingHistoryFile.filename : 'pasted_memory.md';

    if (!content) {
      showToast('请先选择 .md / .json 记忆文件或在文本框中粘贴内容');
      return;
    }

    const mode = document.querySelector('input[name="import-mode"]:checked')?.value || 'append';
    const importSetting = Boolean(document.getElementById('import-apply-setting-chk')?.checked);
    const replaceMemories = Boolean(document.getElementById('import-replace-memories-chk')?.checked);
    if (mode === 'replace' && state.messages.length > 0) {
      const confirmed = await askUserConfirm({
        title: '确认覆盖当前对话历史',
        message: `当前对话已有 ${state.messages.length} 条消息记录。\n执行「覆盖」导入将永久删除这些现有记录并替换为导入内容，确定继续吗？`,
        confirmText: '确认覆盖现有历史',
        danger: true
      });
      if (!confirmed) return;
    }
    try {
      const res = await apiJson(
        `/api/sessions/${encodeURIComponent(state.activeSessionId)}/import-history`,
        {
          method: 'POST',
          body: JSON.stringify({
            filename,
            content,
            mode,
            import_setting: importSetting,
            replace_memories: replaceMemories
          })
        }
      );
      state.sessions = res.sessions || state.sessions;
      importHistoryDialog.close();
      await loadSession(state.activeSessionId);
      const settingHint = res.applied_setting ? '（已同步应用专属设定）' : '';
      const memCnt = Number(res.extracted_memories) || 0;
      const msgCnt = Number(res.imported_count) || 0;
      if (msgCnt > 0 && memCnt > 0) {
        showToast(`导入成功：已载入 ${msgCnt} 条对话，并记住了 ${memCnt} 件重要小事${settingHint}！`);
      } else if (msgCnt > 0) {
        showToast(`导入成功：已载入 ${msgCnt} 条对话记录${settingHint}！`);
      } else if (memCnt > 0) {
        showToast(`导入成功：已添加 ${memCnt} 条记忆条目${settingHint}！`);
      } else {
        showToast(`内容已成功导入当前对话${settingHint}！`);
      }
    } catch (err) {
      showToast(`导入失败：${err.message}`);
    }
  });

  document.getElementById('export-md-memory-btn')?.addEventListener('click', () => {
    hidePopoverSafe('topbar-more-popover');
    exportSessionMarkdownById(state.activeSessionId);
  });
  document.getElementById('ds-menu-export-md-btn')?.addEventListener('click', () => {
    hidePopoverSafe('ds-user-popover');
    exportSessionMarkdownById(state.activeSessionId);
  });
  document.getElementById('memtab-export-md-btn')?.addEventListener('click', () => {
    exportSessionMarkdownById(state.activeSessionId);
  });
  document.getElementById('export-history-btn')?.addEventListener('click', () => {
    hidePopoverSafe('topbar-more-popover');
    exportSessionJsonById(state.activeSessionId);
  });

  // ================= 10. 会话管理、梦境整理手账与世界书操作 =================
  let loadSessionSeq = 0;

  async function applySessionDetailPayload(sessionId, data, opts = {}) {
    if (!sessionId || !data || !data.session) return;
    const reqSeq = opts.reqSeq !== undefined ? opts.reqSeq : loadSessionSeq;
    const fromCache = Boolean(opts.fromCache);
    const silentReconcile = Boolean(opts.silentReconcile);

    if (reqSeq !== loadSessionSeq) return;
    if (silentReconcile && state.activeSessionId && state.activeSessionId !== sessionId) return;
    if (silentReconcile && state.isStreaming) return;

    const srvMsgs = Array.isArray(data.messages) ? data.messages : [];
    const srvHasMore = Boolean(data.has_more_messages);
    const srvTotal = data.total_messages !== undefined ? Number(data.total_messages) : srvMsgs.length;
    const srvOldestId = Number(data.oldest_message_id || srvMsgs[0]?.id || 0);

    let shouldRenderMessages = true;
    let shouldPreserveExistingOlder = false;
    if (silentReconcile && state.activeSessionId === sessionId) {
      const localMsgs = Array.isArray(state.messages) ? state.messages : [];
      const localLast = localMsgs[localMsgs.length - 1];
      const srvLast = srvMsgs[srvMsgs.length - 1];
      const tailSame =
        localLast &&
        srvLast &&
        String(localLast.id || '') === String(srvLast.id || '') &&
        String(localLast.content || '').length === String(srvLast.content || '').length;

      if (
        localMsgs.length === srvMsgs.length &&
        tailSame &&
        Boolean(state.hasMoreMessages) === srvHasMore
      ) {
        shouldRenderMessages = false;
      } else if (localMsgs.length > srvMsgs.length && tailSame && localMsgs.length <= srvTotal) {
        // 本地已翻页加载过更早消息，且末尾最新消息未变，保留本地完整上下文，避免被默认60条分页覆盖
        shouldRenderMessages = false;
        shouldPreserveExistingOlder = true;
      }
    }

    state.activeSessionId = sessionId;
    state.activeSession = data.session;
    state.activePersona = data.persona;
    const userPrefLlmMode = localStorage.getItem('user_llm_mode');
    if (userPrefLlmMode) {
      state.llmMode = userPrefLlmMode;
      if (data.session) data.session.llm_mode = userPrefLlmMode;
    } else if (data.session?.llm_mode) {
      state.llmMode = data.session.llm_mode;
    }
    if (data.session?.local_model) {
      state.localModel = data.session.local_model;
    }
    syncLlmModeUi();
    if (!shouldPreserveExistingOlder) {
      state.messages = srvMsgs;
      state.hasMoreMessages = srvHasMore;
      state.totalMessages = srvTotal;
      state.oldestMessageId = srvOldestId;
    } else {
      state.totalMessages = Math.max(srvTotal, state.messages.length);
    }
    state.memories = data.memories || [];
    state.lorebooks = data.lorebooks || [];
    state.nurturing = data.nurturing || null;
    state.companion = data.companion || null;
    state.telemetry = data.telemetry;
    state.proactiveIdleCount = 0;
    state.lastInteractionAt = Date.now();
    if (!silentReconcile && typeof resetSideArtifactSandbox === 'function') {
      resetSideArtifactSandbox();
    }
    if (data.membership) state.membership = data.membership;

    const sessMode = data.session?.session_mode === 'deepseek_native' ? 'deepseek' : 'roleplay';
    if (!silentReconcile) {
      if (sessMode === 'roleplay') {
        if (state.uiMode !== 'roleplay') applyUiModeVisuals('roleplay');
      } else {
        if (state.uiMode !== 'deepseek') applyUiModeVisuals('deepseek');
      }
    }
    if (sessMode === 'roleplay' && data.persona?.script_id) {
      state.activeScriptId = data.persona.script_id;
      try {
        localStorage.setItem('active_script_id', state.activeScriptId);
      } catch {}
    }
    try {
      localStorage.setItem(getPreferredSessionStorageKey(sessMode), sessionId);
    } catch {}

    if (!fromCache && !shouldPreserveExistingOlder) {
      setSessionCache(sessionId, data);
    } else if (!fromCache && shouldPreserveExistingOlder) {
      syncActiveSessionToCache();
    }

    if (shouldRenderMessages) {
      codeSnippetStore.clear();
      syncActiveScriptVisuals();
      renderSessionList();
      renderMessages();
    } else {
      updateBondBadge();
    }

    await yieldToMain();
    if (reqSeq !== loadSessionSeq) return;

    renderUserAndMembership();
    renderPersonaList();
    populatePersonaEditor();
    renderNurturingAndDiary();
    window.__activeSessionId = state.activeSessionId;
    window.dispatchEvent(new CustomEvent('companion-updated', { detail: state.companion }));
    renderLorebooks();
    renderTelemetryAndMemories();
    renderDeepSeekSuiteTelemetry();

    // 同步右上角更多菜单中「自动主动搭话」按钮显示态
    const proBtnEl = document.getElementById('toggle-proactive-btn');
    if (proBtnEl) {
      const proOn =
        localStorage.getItem('pref_auto_proactive') === '1' &&
        Number(data.session?.proactive_enabled) === 1;
      proBtnEl.classList.toggle('active', proOn);
      proBtnEl.setAttribute('aria-pressed', String(proOn));
      proBtnEl.textContent = proOn
        ? '角色安静时自动搭话：已开启'
        : '角色安静时自动搭话：已关闭';
    }

    if (!fromCache) {
      saveBootSnapshot();
    }

    // 离线超过 6 小时自动夜间做梦：弹出拆阅手札仪式
    if (!fromCache && sessMode === 'roleplay' && data.auto_dream_diary) {
      setTimeout(() => {
        if (state.activeSessionId === sessionId && state.uiMode === 'roleplay') {
          showDreamLetterRitual(data.auto_dream_diary, state.activePersona);
        }
      }, 450);
    }

    // 深夜跨时段重逢（23:00–04:00 且距上次互动超过 4 小时）自动发起带语音的深夜问候
    let scheduledLateNightGreeting = false;
    if (!fromCache && sessMode === 'roleplay' && state.messages.length > 0) {
      const hour = new Date().getHours();
      const isNight = hour >= 23 || hour < 4;
      const lastMsg = state.messages[state.messages.length - 1];
      const lastMeta = parseMsgMeta(lastMsg);
      const idleMs = Date.now() - (lastMsg.created_at || Date.now());
      const nightKey = `late_night_greet_${sessionId}_${new Date().toDateString()}`;
      let alreadySentNight = false;
      try {
        alreadySentNight = sessionStorage.getItem(nightKey) === '1';
      } catch {}
      if (isNight && idleMs >= 4 * 3600 * 1000 && !lastMeta.is_proactive && !alreadySentNight) {
        scheduledLateNightGreeting = true;
        try {
          sessionStorage.setItem(nightKey, '1');
        } catch {}
        setTimeout(() => {
          if (state.activeSessionId === sessionId && state.uiMode === 'roleplay' && !state.isStreaming) {
            triggerProactiveMessage('late_night_return', { autoSpeak: true });
          }
        }, 1100);
      }
    }

    // 久别重逢检测：仅在用户显式开启主动搭话时触发（默认保持安静不打扰）
    if (
      !scheduledLateNightGreeting &&
      !fromCache &&
      sessMode === 'roleplay' &&
      state.messages.length > 0 &&
      localStorage.getItem('pref_auto_proactive') === '1' &&
      Number(data.session?.proactive_enabled) === 1
    ) {
      const lastMsg = state.messages[state.messages.length - 1];
      const lastMeta = parseMsgMeta(lastMsg);
      const idleMs = Date.now() - (lastMsg.created_at || Date.now());
      if (idleMs > 35 * 60 * 1000 && !lastMeta.is_proactive) {
        setTimeout(() => {
          if (state.activeSessionId === sessionId && state.uiMode === 'roleplay' && !state.isStreaming) {
            triggerProactiveMessage('return');
          }
        }, 900);
      }
    }
  }

  async function loadSession(sessionId, opts = {}) {
    if (!sessionId) return;
    // 若正在另一个会话中流式生成，切换会话时立即中止旧流以彻底杜绝跨会话串台污染
    if (state.isStreaming && state.streamingSessionId && state.streamingSessionId !== sessionId) {
      state.userStoppedStream = false;
      try {
        state.streamingAbort?.abort('session_switch');
      } catch {}
      state.streamingAbort = null;
      state.streamingSessionId = null;
      setStreamingUi(false);
    }

    const reqSeq = ++loadSessionSeq;
    const isSwitching = Boolean(state.activeSessionId && state.activeSessionId !== sessionId);
    const forceNetwork = Boolean(opts && opts.forceNetwork) || !isSwitching;
    const cached = !forceNetwork ? getSessionCache(sessionId) : null;

    if (cached) {
      // 命中内存缓存：0ms 瞬开对话内容，随后在后台静默拉取最新状态对账
      await applySessionDetailPayload(sessionId, cached, { reqSeq, fromCache: true });
      apiJson(`/api/sessions/${encodeURIComponent(sessionId)}?limit=60`)
        .then((freshData) => {
          if (reqSeq !== loadSessionSeq || state.activeSessionId !== sessionId) return;
          applySessionDetailPayload(sessionId, freshData, { reqSeq, silentReconcile: true });
        })
        .catch(() => {});
      return;
    }

    if (isSwitching) {
      state.activeSessionId = sessionId;
      renderSessionList();
      if (messagesContainer) {
        messagesContainer.innerHTML = '<div class="session-loading-banner" role="status">正在载入对话记录与专属记忆…</div>';
      }
    }

    let data;
    try {
      data = await apiJson(`/api/sessions/${encodeURIComponent(sessionId)}?limit=60`);
    } catch (err) {
      if (/未找到|不存在|404/i.test(err?.message || '')) {
        console.warn(`[Session] 会话 ${sessionId} 不存在，自动切换到有效会话`);
        invalidateSessionCache(sessionId);
        state.activeSessionId = null;
        state.activeSession = null;
        state.sessions = (state.sessions || []).filter((s) => s.id !== sessionId);
        renderSessionList();
        if (state.sessions.length > 0) {
          return loadSession(state.sessions[0].id);
        } else {
          return startNativeDeepSeekSession('persona_deepseek_official');
        }
      }
      throw err;
    }
    if (reqSeq !== loadSessionSeq) return;
    await applySessionDetailPayload(sessionId, data, { reqSeq, fromCache: false });
  }

  document.getElementById('run-dream-btn').addEventListener('click', async (e) => {
    if (!state.activeSessionId) return;
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = '正在织梦写信…';
    try {
      const res = await apiJson(`/api/sessions/${encodeURIComponent(state.activeSessionId)}/dream`, {
        method: 'POST'
      });
      state.nurturing = res.nurturing;
      state.memories = res.memories || state.memories;
      if (state.activeSession && res.rolling_summary !== undefined) {
        state.activeSession.rolling_summary = res.rolling_summary;
      }
      renderNurturingAndDiary();
      renderTelemetryAndMemories();
      const dPronoun = getPersonaPronoun(state.activePersona);
      showToast(`${dPronoun}刚刚写下了一篇新的私密日记，快在上方查看吧！`);
    } catch (err) {
      showToast(`${err.message}`);
    } finally {
      btn.disabled = false;
      btn.textContent = '整理记忆 & 写日记';
    }
  });

  document.getElementById('add-lorebook-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!state.activePersona) return;
    const titleEl = document.getElementById('lore-title-input');
    const keysEl = document.getElementById('lore-keys-input');
    const contentEl = document.getElementById('lore-content-input');
    try {
      const res = await apiJson(
        `/api/personas/${encodeURIComponent(state.activePersona.id)}/lorebooks`,
        {
          method: 'POST',
          body: JSON.stringify({
            title: titleEl.value.trim(),
            keywords: keysEl.value.trim(),
            content: contentEl.value.trim()
          })
        }
      );
      titleEl.value = '';
      keysEl.value = '';
      contentEl.value = '';
      state.lorebooks = res.lorebooks || [];
      renderLorebooks();
      showToast('已添加关键词设定，聊天提到触发词时角色会自动想起来！');
    } catch (err) {
      showToast(`${err.message}`);
    }
  });

  let creatingSessionLock = false;
  async function startSessionWithPersona(personaId, customTitle = '') {
    if (state.isStreaming || creatingSessionLock) return;
    creatingSessionLock = true;
    const newChatBtnEl = document.getElementById('new-chat-btn');
    if (newChatBtnEl) newChatBtnEl.disabled = true;
    try {
      if (state.uiMode !== 'roleplay') {
        applyUiModeVisuals('roleplay');
      }
      const res = await apiJson('/api/sessions', {
        method: 'POST',
        body: JSON.stringify({
          persona_id: personaId,
          session_mode: 'roleplay',
          llm_mode: state.llmMode || 'local_antigravity',
          local_model: state.localModel || 'DeepSeek-V4.1-Flash',
          ...(customTitle ? { title: customTitle } : {})
        })
      });
      state.sessions = res.sessions;
      await loadSession(res.session_id);
    } finally {
      creatingSessionLock = false;
      if (newChatBtnEl) newChatBtnEl.disabled = false;
    }
  }

  async function startNativeDeepSeekSession(personaId = 'persona_deepseek_official') {
    if (state.isStreaming || creatingSessionLock) return;
    // 若当前已在空白新对话中且绑定角色一致，直接聚焦输入框避免连点产生多个空白会话
    if (
      (state.uiMode === 'deepseek' || state.uiMode === 'phone-agent') &&
      state.activeSession?.session_mode === 'deepseek_native' &&
      state.messages.length === 0 &&
      (state.activePersona?.id || 'persona_deepseek_official') === personaId
    ) {
      chatInput.focus();
      showToast('当前已是全新空白对话，直接输入即可开始');
      return;
    }
    creatingSessionLock = true;
    const dsNewBtnEl = document.getElementById('ds-new-chat-btn');
    if (dsNewBtnEl) dsNewBtnEl.disabled = true;
    try {
      if (state.uiMode !== 'deepseek' && state.uiMode !== 'phone-agent') {
        applyUiModeVisuals('deepseek');
      }
      const res = await apiJson('/api/sessions', {
        method: 'POST',
        body: JSON.stringify({
          persona_id: personaId,
          session_mode: 'deepseek_native',
          ds_thinking: true,
          ds_search: false,
          llm_mode: state.llmMode || 'local_antigravity',
          local_model: state.localModel || 'DeepSeek-V4.1-Flash'
        })
      });
      state.sessions = res.sessions;
      await loadSession(res.session_id);
    } finally {
      creatingSessionLock = false;
      if (dsNewBtnEl) dsNewBtnEl.disabled = false;
    }
  }

  async function deleteSession(sessionId, skipConfirm = false) {
    const targetObj = state.sessions.find((s) => s.id === sessionId);
    const titleLabel = targetObj?.title || '该段对话';
    if (!skipConfirm) {
      const confirmed = await askUserConfirm({
        title: '确认删除对话存档',
        message: `确定要永久删除对话「${titleLabel}」及其专属记忆吗？\n删除后将无法恢复（如需留存可先点 导出 .md 记忆档案）。`,
        confirmText: '确认删除',
        danger: true
      });
      if (!confirmed) return;
    }
    const res = await apiJson(`/api/sessions/${encodeURIComponent(sessionId)}`, {
      method: 'DELETE'
    });
    invalidateSessionCache(sessionId);
    state.sessions = res.sessions;
    if (state.activeSessionId === sessionId) {
      const isDsUi = state.uiMode === 'deepseek' || state.uiMode === 'phone-agent';
      const sameMode = state.sessions.filter((s) =>
        isDsUi ? s.session_mode === 'deepseek_native' : s.session_mode !== 'deepseek_native'
      );
      if (sameMode.length > 0) {
        await loadSession(sameMode[0].id);
      } else if (isDsUi) {
        await startNativeDeepSeekSession('persona_deepseek_official');
      } else {
        const firstRp = state.personas.find((p) => p.id !== 'persona_deepseek_official');
        if (firstRp) await startSessionWithPersona(firstRp.id);
      }
    } else {
      renderSessionList();
    }
    showToast(`已删除对话「${titleLabel}」`);
  }

  document.getElementById('new-chat-btn').addEventListener('click', async () => {
    if (state.isStreaming || creatingSessionLock) return;
    const pid = state.activePersona?.id || state.personas[0]?.id;
    if (!pid) return;
    // 若当前会话已经是该角色的全新初遇空局（尚无任何用户发言），直接复用并提示，防止连点生出多个重复同名空存档
    const hasUserMsg = state.messages.some((m) => m.role === 'user');
    if (
      state.uiMode === 'roleplay' &&
      state.activePersona?.id === pid &&
      !hasUserMsg &&
      !state.activeSession?.session_prompt
    ) {
      chatInput.focus();
      showToast('当前已是全新初遇开局，直接发送第一句话即可开启故事');
      return;
    }
    const pObj = state.personas.find((x) => x.id === pid) || state.activePersona;
    const shortName = (pObj?.name || '角色').split(/[·\s]/)[0];
    if (hasUserMsg) {
      const ok = await askUserConfirm({
        title: `与「${shortName}」开启一段新对话`,
        message: `要和「${shortName}」新开一局故事吗？\n（放心，当前这段聊天记录已自动保存在左侧「聊天记录」列表里，不会丢失，随时可以点回来继续聊）`,
        confirmText: '开启新故事',
        danger: false
      });
      if (!ok) return;
    }
    const existingCount = state.sessions.filter(
      (s) => s.persona_id === pid && s.session_mode !== 'deepseek_native'
    ).length;
    const roundTitle =
      existingCount >= 1 ? `与${shortName}的心动篇章 · 第 ${existingCount + 1} 周目` : '';
    await startSessionWithPersona(pid, roundTitle);
    showToast(`已开启${roundTitle || `与${shortName}的全新篇章`}`);
  });

  toggleThoughtBtn?.addEventListener('click', async () => {
    if (!state.activeSession) return;
    const next = state.activeSession.enable_inner_thought !== 1;
    const res = await apiJson(`/api/sessions/${encodeURIComponent(state.activeSessionId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ enable_inner_thought: next })
    });
    state.activeSession = res.session;
    renderTelemetryAndMemories();
  });

  toggleAutoMemBtn?.addEventListener('click', async () => {
    if (!state.activeSession) return;
    const next = state.activeSession.enable_auto_memory !== 1;
    const res = await apiJson(`/api/sessions/${encodeURIComponent(state.activeSessionId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ enable_auto_memory: next })
    });
    state.activeSession = res.session;
    renderTelemetryAndMemories();
  });

  document.querySelectorAll('.session-preset-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const inp = document.getElementById('session-prompt-input');
      if (!inp) return;
      inp.value = chip.dataset.preset || '';
      inp.focus();
    });
  });

  document.getElementById('save-session-prompt-btn')?.addEventListener('click', async () => {
    if (!state.activeSessionId) return;
    const val = (document.getElementById('session-prompt-input')?.value || '').trim();
    const res = await apiJson(`/api/sessions/${encodeURIComponent(state.activeSessionId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ session_prompt: val })
    });
    state.activeSession = res.session;
    state.sessions = res.sessions || state.sessions;
    populatePersonaEditor();
    renderSessionList();
    showToast(val ? '本对话独立设定已保存（仅当前对话生效，与其他对话隔离）' : '已清空本对话附加设定');
  });

  document.getElementById('clear-session-prompt-btn')?.addEventListener('click', async () => {
    if (!state.activeSessionId) return;
    const inp = document.getElementById('session-prompt-input');
    if (inp && inp.value.trim().length > 0) {
      const confirmed = await askUserConfirm({
        title: '确认清空本对话专属设定',
        message: '确定要清空当前对话框填写的专属附加设定吗？',
        confirmText: '确认清空',
        danger: true
      });
      if (!confirmed) return;
    }
    if (inp) inp.value = '';
    const res = await apiJson(`/api/sessions/${encodeURIComponent(state.activeSessionId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ session_prompt: '' })
    });
    state.activeSession = res.session;
    state.sessions = res.sessions || state.sessions;
    populatePersonaEditor();
    renderSessionList();
    showToast('↺ 已清空本对话专属设定');
  });

  document.getElementById('reset-persona-override-btn')?.addEventListener('click', async () => {
    if (!state.activeSessionId) return;
    const confirmed = await askUserConfirm({
      title: '↺ 恢复角色默认初始卡',
      message: '确定要清除本对话对角色卡片的独立修改，恢复为角色的初始基础设定吗？',
      confirmText: '确认恢复初始卡',
      danger: true
    });
    if (!confirmed) return;
    const res = await apiJson(`/api/sessions/${encodeURIComponent(state.activeSessionId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ clear_persona_override: true })
    });
    state.activeSession = res.session;
    state.activePersona = res.persona || state.activePersona;
    state.sessions = res.sessions || state.sessions;
    await loadSession(state.activeSessionId);
    showToast('↺ 已恢复为角色卡的默认基础设定');
  });

  inlinePersonaForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!state.activePersona) return;
    const applyGlobal = Boolean(document.getElementById('ip-sync-global-chk')?.checked);
    const sessionPromptVal = document.getElementById('session-prompt-input')?.value ?? '';
    const payload = {
      session_id: state.activeSessionId,
      apply_to_global: applyGlobal,
      session_prompt: sessionPromptVal,
      avatar: document.getElementById('ip-avatar').value,
      name: document.getElementById('ip-name').value,
      tagline: document.getElementById('ip-tagline').value,
      personality: document.getElementById('ip-personality').value,
      backstory: document.getElementById('ip-backstory').value,
      speaking_style: document.getElementById('ip-style').value
    };
    const res = await apiJson(`/api/personas/${encodeURIComponent(state.activePersona.id)}`, {
      method: 'PUT',
      body: JSON.stringify(payload)
    });
    if (res.scope === 'global') {
      const idx = state.personas.findIndex((p) => p.id === res.persona.id);
      if (idx !== -1 && res.persona.user_id !== 'system' && res.persona.user_id !== 'system_ds') {
        state.personas[idx] = res.persona;
      }
    }
    if (res.sessions) state.sessions = res.sessions;
    await loadSession(state.activeSessionId);
    showToast(
      res.scope === 'global'
        ? '已同步更新自建角色卡与本对话设定！'
        : '已保存为「当前对话独立设定」，不影响其他对话框，下一句立即生效！'
    );
  });

  saveSummaryBtn.addEventListener('click', async () => {
    if (!state.activeSessionId) return;
    const res = await apiJson(`/api/sessions/${encodeURIComponent(state.activeSessionId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ rolling_summary: rollingSummaryInput.value })
    });
    state.activeSession = res.session;
    await loadSession(state.activeSessionId);
    showToast('前情提要已保存');
  });

  compressNowBtn.addEventListener('click', async () => {
    if (!state.activeSessionId) return;
    const origLabel = compressNowBtn.textContent;
    compressNowBtn.disabled = true;
    compressNowBtn.textContent = '正在总结…';
    try {
      const res = await apiJson(`/api/sessions/${encodeURIComponent(state.activeSessionId)}/compress`, {
        method: 'POST'
      });
      await loadSession(state.activeSessionId);
      showToast(res.message || '已将近期对话总结进「前情提要」');
    } catch (err) {
      showToast(`${err.message || '总结失败，请稍后重试'}`);
    } finally {
      compressNowBtn.disabled = false;
      compressNowBtn.textContent = origLabel;
    }
  });

  addMemoryForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const content = newMemoryInput.value.trim();
    if (!content || !state.activeSessionId) return;
    const res = await apiJson(`/api/sessions/${encodeURIComponent(state.activeSessionId)}/memories`, {
      method: 'POST',
      body: JSON.stringify({ content, pinned: newMemoryPin.checked })
    });
    newMemoryInput.value = '';
    state.memories = res.memories;
    await loadSession(state.activeSessionId);
    showToast('已记住这件事，聊天时会自然回应');
  });

  // 创建角色时联动性别单选框自动推荐对应头像图标
  document.querySelectorAll('input[name="cp-gender"]').forEach((rad) => {
    rad.addEventListener('change', () => {
      const avInp = document.getElementById('cp-avatar');
      if (!avInp) return;
      if (rad.value === 'male' && (avInp.value === '角' || avInp.value === '她')) avInp.value = '他';
      else if (rad.value === 'female' && avInp.value === '他') avInp.value = '她';
    });
  });

  const cpBackstoryEl = document.getElementById('cp-backstory');
  const cpBackstoryCountEl = document.getElementById('cp-backstory-count');
  function syncPersonaBackstoryCounter() {
    if (!cpBackstoryEl || !cpBackstoryCountEl) return;
    cpBackstoryCountEl.textContent = `${cpBackstoryEl.value.length} / 4000`;
  }
  cpBackstoryEl?.addEventListener('input', syncPersonaBackstoryCounter);

  function openPersonaModalForCreate() {
    window.__closeMobileDrawers?.();
    const formEl = document.getElementById('create-persona-form');
    formEl?.reset();
    const editIdEl = document.getElementById('cp-editing-id');
    if (editIdEl) editIdEl.value = '';
    const avEl = document.getElementById('cp-avatar');
    if (avEl) avEl.value = '她';
    const femRad = document.getElementById('cp-gender-female');
    if (femRad) femRad.checked = true;
    const titleEl = document.getElementById('persona-dialog-title');
    if (titleEl) titleEl.textContent = '创建属于你的新角色';
    const submitBtn = document.getElementById('submit-persona-dialog-btn');
    if (submitBtn) submitBtn.textContent = '创建角色并开始聊天';
    syncPersonaBackstoryCounter();
    setTimeout(() => {
      if (!personaDialog.open) personaDialog.showModal();
    }, 15);
  }

  function openPersonaModalForEdit(p) {
    if (!p) return;
    window.__closeMobileDrawers?.();
    const editIdEl = document.getElementById('cp-editing-id');
    if (editIdEl) editIdEl.value = p.id;
    document.getElementById('cp-avatar').value = p.avatar || '角';
    document.getElementById('cp-name').value = p.name || '';
    const isMaleEdit = p.gender === 'male' || (!p.gender && getPersonaPronoun(p) === '他');
    const genderRadio = document.getElementById(isMaleEdit ? 'cp-gender-male' : 'cp-gender-female');
    if (genderRadio) genderRadio.checked = true;
    document.getElementById('cp-tagline').value = p.tagline || '';
    document.getElementById('cp-personality').value = p.personality || '';
    document.getElementById('cp-backstory').value = p.backstory || '';
    document.getElementById('cp-style').value = p.speaking_style || '';
    document.getElementById('cp-greeting').value = p.greeting || '';
    document.getElementById('cp-prompts').value = Array.isArray(p.starter_prompts)
      ? p.starter_prompts.join('\n')
      : '';
    const titleEl = document.getElementById('persona-dialog-title');
    if (titleEl) titleEl.textContent = `编辑自建角色「${(p.name || '').split('·')[0].trim()}」`;
    const submitBtn = document.getElementById('submit-persona-dialog-btn');
    if (submitBtn) submitBtn.textContent = '保存角色设定';
    syncPersonaBackstoryCounter();
    if (!personaDialog.open) personaDialog.showModal();
  }

  async function deleteCustomPersona(p) {
    if (!p || !p.id) return;
    const shortName = (p.name || '该角色').split('·')[0].trim();
    const confirmed = await askUserConfirm({
      title: '确认删除自建角色',
      message: `确定要永久删除自建角色「${shortName}」及其关联的对话存档吗？\n此操作不可恢复。`,
      confirmText: '确认删除角色',
      danger: true
    });
    if (!confirmed) return;
    try {
      const res = await apiJson(`/api/personas/${encodeURIComponent(p.id)}`, {
        method: 'DELETE'
      });
      state.personas = state.personas.filter((x) => x.id !== p.id);
      if (Array.isArray(res.sessions)) {
        state.sessions = res.sessions;
      } else {
        state.sessions = state.sessions.filter((s) => s.persona_id !== p.id);
      }
      if (state.activePersona?.id === p.id) {
        const nextRoleplaySess = state.sessions.find((s) => s.session_mode !== 'deepseek_native');
        if (nextRoleplaySess) {
          await loadSession(nextRoleplaySess.id);
        } else {
          const fallbackPersona = state.personas.find((x) => x.id !== 'persona_deepseek_official');
          if (fallbackPersona) {
            await startSessionWithPersona(fallbackPersona.id);
          }
        }
      } else {
        renderPersonaList();
        renderSessionList();
      }
      showToast(`已删除自建角色「${shortName}」`);
    } catch (err) {
      showToast(`删除失败：${err.message}`);
    }
  }

  document.getElementById('create-persona-btn').addEventListener('click', openPersonaModalForCreate);
  document.getElementById('close-persona-dialog').addEventListener('click', () => personaDialog.close());
  document.getElementById('cancel-persona-dialog').addEventListener('click', () => personaDialog.close());

  document.getElementById('create-persona-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const editingId = (document.getElementById('cp-editing-id')?.value || '').trim();
    const rawPrompts = document.getElementById('cp-prompts').value || '';
    const starterPrompts = rawPrompts
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    const pickedGender =
      document.querySelector('input[name="cp-gender"]:checked')?.value || 'female';
    const bodyPayload = {
      script_id: state.activeScriptId || 'script_classic',
      gender: pickedGender,
      avatar: document.getElementById('cp-avatar').value.trim() || '角',
      name: document.getElementById('cp-name').value.trim(),
      tagline: document.getElementById('cp-tagline').value.trim(),
      personality: document.getElementById('cp-personality').value.trim(),
      backstory: document.getElementById('cp-backstory').value.trim(),
      speaking_style: document.getElementById('cp-style').value.trim(),
      greeting: document.getElementById('cp-greeting').value.trim(),
      starter_prompts: starterPrompts
    };

    if (!bodyPayload.name || !bodyPayload.backstory) {
      showToast('请填写角色姓名与世界观背景故事');
      return;
    }

    if (editingId) {
      const res = await apiJson(`/api/personas/${encodeURIComponent(editingId)}`, {
        method: 'PUT',
        body: JSON.stringify({ ...bodyPayload, apply_to_global: true })
      });
      const idx = state.personas.findIndex((x) => x.id === editingId);
      if (idx !== -1 && res.persona) state.personas[idx] = res.persona;
      if (Array.isArray(res.sessions)) state.sessions = res.sessions;
      personaDialog.close();
      renderPersonaList();
      renderSessionList();
      if (state.activePersona?.id === editingId && state.activeSessionId) {
        await loadSession(state.activeSessionId);
      }
      showToast(`已保存角色「${res.persona?.name || bodyPayload.name}」的更新设定`);
      return;
    }

    const res = await apiJson('/api/personas', {
      method: 'POST',
      body: JSON.stringify(bodyPayload)
    });
    state.personas.unshift(res.persona);
    personaDialog.close();
    e.target.reset();
    document.getElementById('cp-avatar').value = '她';
    syncPersonaBackstoryCounter();
    await startSessionWithPersona(res.persona.id);
    showToast(`已创建角色「${res.persona.name}」，现在就开始聊天吧！`);
  });

  // ================= 11. 个人 API 自由接入与聊天偏好设置（DeepSeek 原生 & 角色扮演双模式通用） =================
  const providerSelect = document.getElementById('st-provider');
  const testResultBox = document.getElementById('test-result-box');

  function isMemberOwnApiUnlocked() {
    return true;
  }

  // 设置弹窗顶部三标签页切换控制器（遵循 modern-web-guidance: tabs 规范）
  const settingsTabs = Array.from(document.querySelectorAll('#settings-tablist [role="tab"]'));
  function activateSettingsTab(targetTabId, focusTab = false) {
    settingsTabs.forEach((tab) => {
      const isSelected = tab.id === targetTabId;
      tab.setAttribute('aria-selected', String(isSelected));
      tab.tabIndex = isSelected ? 0 : -1;
      const panelId = tab.dataset.spanel;
      const panel = panelId ? document.getElementById(panelId) : null;
      if (panel) {
        panel.hidden = !isSelected;
      }
      if (isSelected && focusTab) {
        tab.focus();
      }
    });
  }

  settingsTabs.forEach((tab, idx) => {
    tab.addEventListener('click', () => activateSettingsTab(tab.id, false));
    tab.addEventListener('keydown', (e) => {
      let nextIdx = -1;
      if (e.key === 'ArrowRight') nextIdx = (idx + 1) % settingsTabs.length;
      else if (e.key === 'ArrowLeft') nextIdx = (idx - 1 + settingsTabs.length) % settingsTabs.length;
      else if (e.key === 'Home') nextIdx = 0;
      else if (e.key === 'End') nextIdx = settingsTabs.length - 1;
      if (nextIdx >= 0) {
        e.preventDefault();
        activateSettingsTab(settingsTabs[nextIdx].id, true);
      }
    });
  });

  function switchProviderPane(provider) {
    const isDsOwn = provider === 'own_deepseek';
    const isCloud = provider === 'custom_cloud';
    const isFree = !isDsOwn && !isCloud;

    document.getElementById('pane-demo')?.classList.toggle('hidden', provider !== 'demo');
    document.getElementById('pane-online')?.classList.toggle('hidden', provider !== 'online');

    document.getElementById('mode-card-free')?.classList.toggle('active', isFree);
    document.getElementById('mode-card-own')?.classList.toggle('active', isDsOwn);
    document.getElementById('mode-card-cloud')?.classList.toggle('active', isCloud);

    document.getElementById('free-peace-card')?.classList.toggle('hidden', !isFree);
    document.getElementById('member-own-api-box')?.classList.toggle('hidden', !isDsOwn);
    document.getElementById('member-custom-cloud-box')?.classList.toggle('hidden', !isCloud);

    testResultBox?.classList.add('hidden');
  }

  document.getElementById('mode-card-free')?.addEventListener('click', () => {
    providerSelect.value = 'online';
    switchProviderPane('online');
  });

  document.getElementById('mode-card-own')?.addEventListener('click', () => {
    providerSelect.value = 'own_deepseek';
    switchProviderPane('own_deepseek');
    setTimeout(() => {
      document.getElementById('st-own-ds-key')?.focus();
    }, 30);
  });

  document.getElementById('mode-card-cloud')?.addEventListener('click', () => {
    providerSelect.value = 'custom_cloud';
    switchProviderPane('custom_cloud');
    setTimeout(() => {
      document.getElementById('st-custom-cloud-key')?.focus();
    }, 30);
  });

  providerSelect.addEventListener('change', (e) => switchProviderPane(e.target.value));

  // 当用户在 DeepSeek 官方密钥框输入密钥时，自动为其切到「DeepSeek 官方 API」档位
  document.getElementById('st-own-ds-key')?.addEventListener('input', (e) => {
    if (isMemberOwnApiUnlocked() && e.target.value.trim().length >= 3) {
      providerSelect.value = 'own_deepseek';
      switchProviderPane('own_deepseek');
    }
  });

  // 当用户在云端 API 密钥框输入密钥时，自动为其切到「云端 API」档位
  document.getElementById('st-custom-cloud-key')?.addEventListener('input', (e) => {
    if (isMemberOwnApiUnlocked() && e.target.value.trim().length >= 3) {
      providerSelect.value = 'custom_cloud';
      switchProviderPane('custom_cloud');
    }
  });

  // 云端 API 预设芯片点击事件：填入建议地址与模型，同时允许用户自由二次编辑
  document.querySelectorAll('#cloud-api-preset-bar .api-preset-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('#cloud-api-preset-bar .api-preset-chip').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      const url = chip.dataset.cloudUrl;
      const model = chip.dataset.cloudModel;
      if (url) {
        const urlInp = document.getElementById('st-custom-cloud-url');
        if (urlInp) urlInp.value = url;
      }
      if (model) {
        const modelInp = document.getElementById('st-custom-cloud-model');
        if (modelInp) modelInp.value = model;
      }
    });
  });

  function syncOwnApiPrivilegeUi() {
    const s = state.settings || {};
    const hasSavedDsKey = Boolean(s.has_own_deepseek_key);
    const hasSavedCloudKey = Boolean(s.has_custom_cloud_key);

    document.getElementById('own-api-unlocked-view')?.classList.remove('hidden');

    const optOwn = document.getElementById('st-opt-own-deepseek');
    if (optOwn) {
      optOwn.disabled = false;
      optOwn.textContent = 'DeepSeek 官方 API（默认官网与 V4.1 Flash，仅需填 Key）';
    }

    const optCloud = document.getElementById('st-opt-custom-cloud');
    if (optCloud) {
      optCloud.disabled = false;
      optCloud.textContent = '云端 API（自由指定接口地址与模型名称）';
    }

    // 1. 回填 DeepSeek 官方卡片状态与输入框
    const dsMaskBadge = document.getElementById('own-api-mask-badge');
    if (dsMaskBadge) {
      dsMaskBadge.textContent = hasSavedDsKey
        ? `已配好 (${s.own_deepseek_key_masked || 'sk-••••'})`
        : 'V4.1 Flash';
    }

    const clearDsWrap = document.getElementById('clear-own-ds-key-wrap');
    const clearDsChk = document.getElementById('st-clear-own-ds-key');
    if (clearDsWrap) clearDsWrap.classList.toggle('hidden', !hasSavedDsKey);
    if (clearDsChk) clearDsChk.checked = false;

    const dsKeyInp = document.getElementById('st-own-ds-key');
    if (dsKeyInp) {
      dsKeyInp.value = '';
      dsKeyInp.type = 'password';
      const eyeBtn = dsKeyInp.parentElement?.querySelector('.pwd-eye-btn');
      if (eyeBtn) {
        eyeBtn.textContent = '显示';
        eyeBtn.setAttribute('aria-pressed', 'false');
      }
      dsKeyInp.placeholder = hasSavedDsKey
        ? `已保存官方密钥 ${s.own_deepseek_key_masked}（留空保持不变，粘贴新 Key 覆盖）`
        : '粘贴 sk-... 开头的 DeepSeek 官网密钥，点保存即可';
    }

    // 2. 回填云端 API 卡片状态与输入框（自由填写）
    const cloudMaskBadge = document.getElementById('custom-cloud-mask-badge');
    if (cloudMaskBadge) {
      cloudMaskBadge.textContent = hasSavedCloudKey
        ? `已配置 (${s.custom_cloud_key_masked || '••••'})`
        : '自由定制';
    }

    const clearCloudWrap = document.getElementById('clear-custom-cloud-key-wrap');
    const clearCloudChk = document.getElementById('st-clear-custom-cloud-key');
    if (clearCloudWrap) clearCloudWrap.classList.toggle('hidden', !hasSavedCloudKey);
    if (clearCloudChk) clearCloudChk.checked = false;

    const cloudKeyInp = document.getElementById('st-custom-cloud-key');
    if (cloudKeyInp) {
      cloudKeyInp.value = '';
      cloudKeyInp.type = 'password';
      const eyeBtn = cloudKeyInp.parentElement?.querySelector('.pwd-eye-btn');
      if (eyeBtn) {
        eyeBtn.textContent = '显示';
        eyeBtn.setAttribute('aria-pressed', 'false');
      }
      cloudKeyInp.placeholder = hasSavedCloudKey
        ? `已保存云端密钥 ${s.custom_cloud_key_masked}（留空保持不变，粘贴新 Key 覆盖）`
        : '粘贴第三方服务商提供的 API 密钥';
    }

    const cloudUrlInp = document.getElementById('st-custom-cloud-url');
    if (cloudUrlInp) {
      cloudUrlInp.value = s.custom_cloud_api_url || 'https://api.siliconflow.cn/v1/chat/completions';
    }

    const cloudModelInp = document.getElementById('st-custom-cloud-model');
    if (cloudModelInp) {
      cloudModelInp.value = s.custom_cloud_model || 'deepseek-ai/DeepSeek-V4.1-Flash';
    }

    // 站内已配好免填密钥时的温和提示
    const envBanner = document.getElementById('builtin-env-ready-banner');
    if (envBanner) {
      if (s.builtin_api_ready || s.builtin_tts_ready) {
        envBanner.textContent = '本站已为您配好免填密钥的对话与语音服务，不填下面各项也能直接畅聊！';
        envBanner.classList.remove('hidden');
      } else {
        envBanner.classList.add('hidden');
      }
    }

    window.__preferCloudAsr =
      String(s.custom_cloud_api_url || '').toLowerCase().includes('siliconflow.cn') ||
      String(s.builtin_chat_label || '').includes('硅基流动');
  }

  function normalizeSettingsUrlInput(rawUrl) {
    const clean = String(rawUrl || '').trim();
    if (!clean) return '';
    if (!/^https?:\/\//i.test(clean) && /^[a-z0-9.-]+\.[a-z]{2,}(?:\/.*)?$/i.test(clean)) {
      return `https://${clean}`;
    }
    return clean;
  }

  function collectSettingsPayload() {
    const unlocked = isMemberOwnApiUnlocked();
    const safeWin = Math.min(120, Math.max(4, parseInt(document.getElementById('st-window')?.value || '40', 10) || 40));
    const safeRec = Math.min(40, Math.max(2, parseInt(document.getElementById('st-recall')?.value || '16', 10) || 16));
    const safeTemp = Math.min(2.0, Math.max(0.1, parseFloat(document.getElementById('st-temp')?.value || '0.7') || 0.7));

    let chosenProvider = providerSelect.value;
    if (chosenProvider !== 'own_deepseek' && chosenProvider !== 'custom_cloud') {
      chosenProvider = 'online';
    }

    const payload = {
      provider: chosenProvider,
      sliding_window_turns: String(safeWin),
      max_recalled_memories: String(safeRec),
      temperature: String(Number(safeTemp.toFixed(2)))
    };

    // DeepSeek 官方配置独立处理（固定官网端点与 V4.1 Flash，仅存 API Key）
    const clearDs = Boolean(document.getElementById('st-clear-own-ds-key')?.checked);
    if (clearDs) {
      payload.clear_own_deepseek_key = true;
      if (payload.provider === 'own_deepseek') {
        payload.provider = 'online';
      }
    } else if (unlocked) {
      const ownKeyVal = document.getElementById('st-own-ds-key')?.value.trim() || '';
      if (ownKeyVal) {
        payload.own_deepseek_api_key = ownKeyVal;
      }
    }

    // 云端 API 自定义配置独立处理（自由指定接口地址与模型名称）
    const clearCloud = Boolean(document.getElementById('st-clear-custom-cloud-key')?.checked);
    if (clearCloud) {
      payload.clear_custom_cloud_key = true;
      if (payload.provider === 'custom_cloud') {
        payload.provider = 'online';
      }
    } else if (unlocked) {
      const cloudKeyVal = document.getElementById('st-custom-cloud-key')?.value.trim() || '';
      if (cloudKeyVal) {
        payload.custom_cloud_api_key = cloudKeyVal;
      }
      const cloudUrlVal = normalizeSettingsUrlInput(document.getElementById('st-custom-cloud-url')?.value);
      if (cloudUrlVal) {
        payload.custom_cloud_api_url = cloudUrlVal;
      }
      const cloudModelVal = document.getElementById('st-custom-cloud-model')?.value.trim();
      if (cloudModelVal) {
        payload.custom_cloud_model = cloudModelVal;
      }
    }

    return payload;
  }

  function syncEasyVibeSelection() {
    const win = String(document.getElementById('st-window')?.value || '40');
    const tempNum = parseFloat(document.getElementById('st-temp')?.value || '0.7');
    let activeKey = 'balanced';
    if (Number(win) >= 72 || Number(win) === 24) {
      activeKey = 'deep_memory';
    } else if (tempNum >= 0.95) {
      activeKey = 'dramatic';
    }
    document.querySelectorAll('.easy-vibe-card').forEach((card) => {
      card.classList.toggle('active', card.dataset.vibe === activeKey);
    });
  }

  document.querySelectorAll('.easy-vibe-card').forEach((card) => {
    card.addEventListener('click', () => {
      document.getElementById('st-window').value = card.dataset.win || '40';
      document.getElementById('st-recall').value = card.dataset.rec || '16';
      document.getElementById('st-temp').value = card.dataset.temp || '0.7';
      document.querySelectorAll('.easy-vibe-card').forEach((c) => c.classList.toggle('active', c === card));
    });
  });

  let settingsInitialSnapshot = null;
  let settingsSavedFlag = false;

  function captureSettingsSnapshot() {
    let storedTheme = 'system';
    try {
      const st = localStorage.getItem('color-scheme');
      if (st === 'light' || st === 'dark') storedTheme = st;
    } catch {}
    return {
      themeScheme: storedTheme,
      autoTts: localStorage.getItem('auto_tts_reply') !== '0',
      autoProactive: localStorage.getItem('pref_auto_proactive') === '1',
      showFollowups: isShowFollowUpsEnabled()
    };
  }

  function restoreSettingsSnapshot(snap) {
    if (!snap) return;
    applyColorSchemeValue(snap.themeScheme);
    try {
      localStorage.setItem('auto_tts_reply', snap.autoTts ? '1' : '0');
      localStorage.setItem('pref_auto_proactive', snap.autoProactive ? '1' : '0');
    } catch {}
    const autoTtsChk = document.getElementById('st-auto-tts-chk');
    if (autoTtsChk) autoTtsChk.checked = snap.autoTts;
    const autoProChk = document.getElementById('st-auto-proactive-chk');
    if (autoProChk) autoProChk.checked = Boolean(snap.autoProactive);
    setShowFollowUpsEnabled(snap.showFollowups !== false, false);
  }

  settingsDialog?.addEventListener('close', () => {
    if (!settingsSavedFlag && settingsInitialSnapshot) {
      restoreSettingsSnapshot(settingsInitialSnapshot);
    }
    settingsInitialSnapshot = null;
  });

  function openSettingsModal(focusOwnApi = false) {
    settingsSavedFlag = false;
    settingsInitialSnapshot = captureSettingsSnapshot();
    const s = state.settings || {};
    const unlocked = isMemberOwnApiUnlocked();
    const settingsFormEl = document.getElementById('settings-form');
    if (settingsFormEl) settingsFormEl.noValidate = true;
    testResultBox?.classList.add('hidden');
    syncOwnApiPrivilegeUi();

    if (s.provider === 'own_deepseek' && unlocked) {
      providerSelect.value = 'own_deepseek';
    } else if (s.provider === 'custom_cloud' && unlocked) {
      providerSelect.value = 'custom_cloud';
    } else if (s.provider === 'online' || s.provider === 'own_deepseek' || s.provider === 'custom_cloud') {
      providerSelect.value = 'online';
    } else {
      providerSelect.value = 'demo';
    }

    const winEl = document.getElementById('st-window');
    const recEl = document.getElementById('st-recall');
    const tmpEl = document.getElementById('st-temp');
    if (winEl) {
      winEl.min = '4';
      winEl.max = '120';
      winEl.value = String(Math.min(120, Math.max(4, parseInt(s.sliding_window_turns || '40', 10) || 40)));
    }
    if (recEl) {
      recEl.min = '2';
      recEl.max = '40';
      recEl.value = String(Math.min(40, Math.max(2, parseInt(s.max_recalled_memories || '16', 10) || 16)));
    }
    if (tmpEl) {
      tmpEl.step = 'any';
      tmpEl.min = '0.1';
      tmpEl.max = '2.0';
      tmpEl.value = String(Math.min(2.0, Math.max(0.1, parseFloat(s.temperature || '0.7') || 0.7)));
    }
    syncEasyVibeSelection();

    const advFold = document.getElementById('advanced-tech-settings-fold');
    if (advFold) advFold.open = false;

    if (focusOwnApi === 'custom_cloud' && unlocked) {
      providerSelect.value = 'custom_cloud';
    } else if ((focusOwnApi === true || focusOwnApi === 'own_deepseek') && unlocked) {
      providerSelect.value = 'own_deepseek';
    }
    switchProviderPane(providerSelect.value);
    syncThemeControls();
    const autoTtsChk = document.getElementById('st-auto-tts-chk');
    if (autoTtsChk) {
      autoTtsChk.checked = localStorage.getItem('auto_tts_reply') !== '0';
    }
    syncFollowUpsToggleUi();
    activateSettingsTab('stab-key', false);
    setTimeout(() => {
      // 📱 移动端 1:1 DeepSeek 正版全屏设置页面分流（对应官方 App 截屏 1）
      if (window.innerWidth <= 860 || window.PhoneAgent?.isNative) {
        openMobileFullscreenSettings(focusOwnApi);
        return;
      }
      if (!settingsDialog.open) settingsDialog.showModal();
      if (focusOwnApi === true && unlocked) {
        document.getElementById('st-own-ds-key')?.focus();
      }
    }, 10);
  }

  function openMobileFullscreenSettings(focusOwnApi = false) {
    const mfs = document.getElementById('mobile-fullscreen-settings');
    if (!mfs) {
      if (!settingsDialog.open) settingsDialog.showModal();
      return;
    }
    mfs.classList.remove('hidden');

    // 1. 同步账户昵称与角色
    const accountLabel = document.getElementById('mfs-account-label');
    const accountSub = document.getElementById('mfs-account-sub');
    const isAdm = Boolean(state.user?.role === 'admin' || state.user?.is_admin);
    if (accountLabel) {
      accountLabel.textContent = state.user?.nickname || state.user?.username || '星语AI (点我打字)';
    }
    if (accountSub) {
      accountSub.textContent = isAdm ? '👑 站长超级管理员' : (state.user?.email || '已就绪');
    }
    document.getElementById('mfs-item-admin')?.classList.toggle('hidden', !isAdm);

    // 2. 同步外观
    const themeVal = document.getElementById('mfs-theme-value');
    if (themeVal) {
      const curScheme = localStorage.getItem('color-scheme') || 'system';
      themeVal.textContent = curScheme === 'dark' ? '深色' : (curScheme === 'light' ? '浅色' : '系统');
    }

    // 3. 同步字体大小
    const fontVal = document.getElementById('mfs-fontsize-value');
    if (fontVal) {
      const curFont = localStorage.getItem('mfs_font_size') || 'normal';
      fontVal.textContent = curFont === 'large' ? '大' : (curFont === 'small' ? '小' : '标准');
    }

    // 4. 同步个人 API 密钥
    const keyVal = document.getElementById('mfs-apikey-value');
    const keyInput = document.getElementById('mfs-apikey-input');
    const savedKey = localStorage.getItem('deepseek_user_api_key') || localStorage.getItem('own_deepseek_api_key') || '';
    if (keyVal) {
      keyVal.textContent = savedKey ? '已配置 (sk-...)' : '点击直连';
    }
    if (keyInput) {
      keyInput.value = savedKey;
    }
    document.getElementById('mfs-apikey-drawer')?.classList.add('hidden');
    if (focusOwnApi) {
      setTimeout(() => {
        if (typeof window.__openMfsApiKeySheet === 'function') {
          window.__openMfsApiKeySheet();
        }
      }, 40);
    }

    // 5. 按当前工作台模式隔离手机辅助设置项（在 DeepSeek/剧场模式下隐藏手机辅助专有项，防止串台）
    const isPhoneAgentMode = state.uiMode === 'phone-agent';
    document.getElementById('mfs-item-phoneagent')?.classList.toggle('hidden', !isPhoneAgentMode);
    document.getElementById('mfs-item-phone-engine')?.classList.toggle('hidden', !isPhoneAgentMode);
    const paVal = document.getElementById('mfs-phoneagent-value');
    if (paVal) {
      const isNative = window.AndroidAppBridge && window.AndroidAppBridge.isNativeApk();
      if (isNative) {
        const floatRunning = window.AndroidAppBridge.isFloatAgentRunning();
        paVal.textContent = floatRunning ? '悬浮打字球运行中' : '无障碍已就绪';
      } else {
        paVal.textContent = '网页预览模式';
      }
    }

    const engineVal = document.getElementById('mfs-phone-engine-value');
    if (engineVal) {
      const execMode =
        (window.PhoneAgent && typeof window.PhoneAgent.getExecMode === 'function'
          ? window.PhoneAgent.getExecMode()
          : localStorage.getItem('pa_exec_mode_v1')) || 'api_direct';
      engineVal.textContent =
        execMode === 'api_cloud'
          ? '云端托管 API'
          : execMode === 'local'
            ? '本地免 API'
            : 'DeepSeek 直连 API';
    }

    // 6. 同步自动语音播报开关
    const ttsVal = document.getElementById('mfs-tts-toggle-value');
    if (ttsVal) {
      ttsVal.textContent = localStorage.getItem('auto_tts_reply') !== '0' ? '已开启' : '已关闭';
    }

    // 6.5 同步外观工坊状态摘要
    const skinVal = document.getElementById('mfs-skin-value');
    if (skinVal && window.AppearanceSystem?.getCurrentSkin) {
      const curSkin = window.AppearanceSystem.getCurrentSkin();
      const presetNames = {
        default: '系统默认',
        obsidian_gold: '曜石流金',
        morning_mist: '晨雾丝绸',
        cherry_blossom: '朝雾樱白',
        crimson_scroll: '绯红古卷',
        cyber_neon: '赛博霓虹',
        e_ink: '极简墨水屏'
      };
      const bubbleNames = {
        soft: '柔光圆润',
        'im-bubble': '逐句分段',
        glass: '玻璃拟态',
        outline: '极简细框',
        letter: '复古信纸'
      };
      const pName = presetNames[curSkin.preset] || '精选皮肤';
      const bName = bubbleNames[curSkin.bubbleStyle] || '气泡';
      skinVal.textContent = pName;
    }

    // 7. 同步版本号（原生环境优先由 PackageManager 实时读取，不在主界面透出）
    const verVal = document.getElementById('mfs-version-value');
    if (verVal) {
      if (window.PhoneAgent && typeof window.PhoneAgent.getInstalledVersionLabel === 'function') {
        verVal.textContent = window.PhoneAgent.getInstalledVersionLabel();
      } else {
        const verStr = state.appVersion || (window.PhoneAgent && window.PhoneAgent.currentVersion) || '2.0.2';
        verVal.textContent = verStr.startsWith('v') ? verStr : `v${verStr}`;
      }
    }
  }

  function openDeepSeekOfficialKeyPage() {
    if (window.PhoneAgent && typeof window.PhoneAgent.openDeepSeekOfficialPage === 'function') {
      window.PhoneAgent.openDeepSeekOfficialPage();
      return;
    }
    const url = 'https://platform.deepseek.com/api_keys';
    const b = window.AndroidAppBridge;
    if (b && typeof b.isNativeApk === 'function' && b.isNativeApk() && typeof b.openExternalUrl === 'function') {
      try {
        b.openExternalUrl(url);
        return;
      } catch {}
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  function openMobileSkinStudio() {
    openMfsSubSheet({
      title: '🎨 免费皮肤与外观工坊',
      subtitle: '7套精选主题 · 壁纸取色 · 气泡风格 · 全部免费',
      bodyHtml: `
        <div class="mfs-skin-scroll-box" style="padding: 4px 0 24px 0;">
          <div id="mfs-skin-mount-root"></div>
        </div>
      `,
      onMount: ({ bodyEl }) => {
        const mountTarget = bodyEl.querySelector('#mfs-skin-mount-root');
        if (window.AppearanceSystem?.initSkinStudio && mountTarget) {
          window.AppearanceSystem.initSkinStudio(mountTarget);
        }
      }
    });
  }

  function openMobileAvatarStudio() {
    if (!window.AppearanceSystem?.openAvatarStudio) {
      showToast('头像工坊组件加载中，请稍候');
      return;
    }
    window.AppearanceSystem.openAvatarStudio({
      initialAvatar: state.user?.avatar || '我',
      initialConfig: state.user?.avatar_config || null,
      nickname: state.user?.nickname || '我',
      onApply: async ({ avatar, avatar_config }) => {
        try {
          const resp = await fetch('/api/user/profile', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              nickname: state.user?.nickname || '我',
              avatar,
              avatar_config: JSON.stringify(avatar_config)
            })
          });
          const data = await resp.json();
          if (resp.ok && data?.user) {
            state.user = data.user;
            renderUserAndMembership();
            showToast('头像装扮与捏脸已保存生效！');
          }
        } catch {
          showToast('头像装扮已更新');
        }
      }
    });
  }

  function closeMfsSubSheet() {
    document.getElementById('mfs-sub-sheet')?.classList.add('hidden');
  }

  function openMfsSubSheet({ title, subtitle = '', bodyHtml = '', footerHtml = '', onMount = null }) {
    const sheet = document.getElementById('mfs-sub-sheet');
    const titleEl = document.getElementById('mfs-sub-title');
    const subEl = document.getElementById('mfs-sub-subtitle');
    const bodyEl = document.getElementById('mfs-sub-body');
    const footerEl = document.getElementById('mfs-sub-footer');
    if (!sheet || !titleEl || !bodyEl || !footerEl) return;

    titleEl.textContent = title || '设置';
    if (subEl) {
      subEl.textContent = subtitle;
      subEl.classList.toggle('hidden', !subtitle);
    }
    bodyEl.innerHTML = bodyHtml;
    footerEl.innerHTML = footerHtml;
    footerEl.classList.toggle('hidden', !footerHtml);
    sheet.classList.remove('hidden');

    if (typeof onMount === 'function') {
      onMount({ sheet, bodyEl, footerEl, close: closeMfsSubSheet });
    }
  }

  function renderMfsOptionListHtml(options, selectedId) {
    const checkSvg = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
    return `<div class="mfs-opt-list">${options
      .map(
        (opt) => `
        <button type="button" class="mfs-opt-item${opt.id === selectedId ? ' is-selected' : ''}" data-opt-id="${escapeHtml(opt.id)}">
          <div class="mfs-opt-main">
            <span class="mfs-opt-title">${escapeHtml(opt.title)}</span>
            ${opt.desc ? `<span class="mfs-opt-desc">${escapeHtml(opt.desc)}</span>` : ''}
          </div>
          <span class="mfs-opt-check" aria-hidden="true">${checkSvg}</span>
        </button>`
      )
      .join('')}</div>`;
  }

  function initMobileFullscreenSettings() {
    const mfs = document.getElementById('mobile-fullscreen-settings');
    if (!mfs) return;

    document.getElementById('mfs-back-btn')?.addEventListener('click', () => {
      closeMfsSubSheet();
      mfs.classList.add('hidden');
    });
    document.getElementById('mfs-sub-backdrop')?.addEventListener('click', closeMfsSubSheet);
    document.getElementById('mfs-sub-close')?.addEventListener('click', closeMfsSubSheet);

    const openMfsApiKeySheet = () => {
      const savedKey = localStorage.getItem('deepseek_user_api_key') || localStorage.getItem('own_deepseek_api_key') || '';
      const eyeOpenSvg = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;
      const eyeOffSvg = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`;
      openMfsSubSheet({
        title: '个人 API 密钥',
        subtitle: '使用你自己的 DeepSeek 官网密钥直连推理，密钥仅存本地沙盒',
        bodyHtml: `
          <div class="mfs-official-guide-box">
            <ol class="mfs-official-steps">
              <li>打开 DeepSeek 官方控制台，在左侧「API keys」创建并复制 <code>sk-...</code> 密钥；</li>
              <li>粘贴到下方输入框并保存，即可解锁直连对话与手机辅助规划。</li>
            </ol>
            <button type="button" class="mfs-official-link-btn" id="mfs-sheet-official-btn">
              <span>前往 DeepSeek 官网获取密钥 (platform.deepseek.com) ↗</span>
            </button>
          </div>
          <div class="mfs-field-block">
            <label class="mfs-field-label" for="mfs-sheet-apikey-input">DeepSeek API Key</label>
            <div class="mfs-sheet-input-wrap">
              <input type="password" class="mfs-sheet-input" id="mfs-sheet-apikey-input" value="${escapeHtml(savedKey)}" placeholder="粘贴 sk-... 开头的官网密钥" autocomplete="off" />
              <button type="button" class="mfs-sheet-eye-btn" id="mfs-sheet-eye-btn" aria-label="显示或隐藏密钥">${eyeOpenSvg}</button>
            </div>
          </div>`,
        footerHtml: `
          <button type="button" class="mfs-sheet-btn-secondary" id="mfs-sheet-key-clear">清除密钥</button>
          <button type="button" class="mfs-sheet-btn-primary" id="mfs-sheet-key-save">保存直连密钥</button>`,
        onMount: ({ bodyEl, footerEl, close }) => {
          const inp = bodyEl.querySelector('#mfs-sheet-apikey-input');
          const eyeBtn = bodyEl.querySelector('#mfs-sheet-eye-btn');
          bodyEl.querySelector('#mfs-sheet-official-btn')?.addEventListener('click', openDeepSeekOfficialKeyPage);
          eyeBtn?.addEventListener('click', () => {
            if (!inp) return;
            const show = inp.type === 'password';
            inp.type = show ? 'text' : 'password';
            eyeBtn.innerHTML = show ? eyeOffSvg : eyeOpenSvg;
          });
          const applyKey = (val) => {
            const clean = String(val || '').trim();
            if (clean) {
              localStorage.setItem('deepseek_user_api_key', clean);
              localStorage.setItem('own_deepseek_api_key', clean);
            } else {
              localStorage.removeItem('deepseek_user_api_key');
              localStorage.removeItem('own_deepseek_api_key');
            }
            const desktopInput = document.getElementById('st-own-ds-key');
            if (desktopInput) desktopInput.value = clean;
            const oldInput = document.getElementById('mfs-apikey-input');
            if (oldInput) oldInput.value = clean;
            const keyVal = document.getElementById('mfs-apikey-value');
            if (keyVal) keyVal.textContent = clean ? '已配置 (sk-...)' : '点击直连';
            if (window.PhoneAgent && typeof window.PhoneAgent.setDirectApiKey === 'function') {
              window.PhoneAgent.setDirectApiKey(clean);
            }
            close();
            showToast(clean ? 'DeepSeek 官方 API 密钥已保存至本地沙盒' : '已清除个人 API 密钥');
          };
          footerEl.querySelector('#mfs-sheet-key-clear')?.addEventListener('click', () => applyKey(''));
          footerEl.querySelector('#mfs-sheet-key-save')?.addEventListener('click', () => applyKey(inp?.value || ''));
          setTimeout(() => inp?.focus(), 60);
        }
      });
    };
    window.__openMfsApiKeySheet = openMfsApiKeySheet;

    // 1. 账户点击：修改昵称
    document.getElementById('mfs-item-profile')?.addEventListener('click', () => {
      const curName = state.user?.nickname || state.user?.username || '';
      openMfsSubSheet({
        title: '修改用户昵称',
        subtitle: '角色与系统将记住你的专属称呼',
        bodyHtml: `
          <div class="mfs-field-block">
            <label class="mfs-field-label" for="mfs-sheet-nickname-input">当前昵称</label>
            <input type="text" class="mfs-sheet-input" id="mfs-sheet-nickname-input" maxlength="24" value="${escapeHtml(curName)}" placeholder="输入新的昵称" />
          </div>`,
        footerHtml: `
          <button type="button" class="mfs-sheet-btn-secondary" id="mfs-sheet-nick-cancel">取消</button>
          <button type="button" class="mfs-sheet-btn-primary" id="mfs-sheet-nick-save">保存昵称</button>`,
        onMount: ({ bodyEl, footerEl, close }) => {
          const inp = bodyEl.querySelector('#mfs-sheet-nickname-input');
          footerEl.querySelector('#mfs-sheet-nick-cancel')?.addEventListener('click', close);
          footerEl.querySelector('#mfs-sheet-nick-save')?.addEventListener('click', async () => {
            const nextName = (inp?.value || '').trim();
            if (!nextName) {
              showToast('请输入有效的昵称');
              return;
            }
            if (nextName === curName) {
              close();
              return;
            }
            try {
              const res = await apiJson('/api/auth/profile', {
                method: 'PATCH',
                body: JSON.stringify({ nickname: nextName })
              });
              const finalName = res.ok && res.user ? res.user.nickname || res.user.username : nextName;
              if (res.ok && res.user) state.user = res.user;
              const accountLabel = document.getElementById('mfs-account-label');
              if (accountLabel) accountLabel.textContent = finalName;
              showToast('昵称已更新为：' + finalName);
            } catch {
              const accountLabel = document.getElementById('mfs-account-label');
              if (accountLabel) accountLabel.textContent = nextName;
              showToast('已在本地更新昵称：' + nextName);
            }
            close();
          });
          setTimeout(() => inp?.focus(), 60);
        }
      });
    });

    // 2. 语言选择
    document.getElementById('mfs-item-lang')?.addEventListener('click', () => {
      openMfsSubSheet({
        title: '界面语言',
        subtitle: '设置应用界面与提示的默认显示语言',
        bodyHtml: renderMfsOptionListHtml(
          [{ id: 'zh-CN', title: '中文 (简体中文)', desc: '全中文沉浸对话界面与专属本地化提示' }],
          'zh-CN'
        ),
        onMount: ({ bodyEl, close }) => {
          bodyEl.querySelectorAll('.mfs-opt-item').forEach((btn) => {
            btn.addEventListener('click', () => {
              close();
              showToast('当前系统已使用 中文 (简体中文)');
            });
          });
        }
      });
    });

    // 2.5 移动端专属皮肤与外观工坊
    document.getElementById('mfs-item-skin-studio')?.addEventListener('click', () => {
      openMobileSkinStudio();
    });

    // 2.6 移动端专属捏脸与头像工坊
    document.getElementById('mfs-item-avatar-studio')?.addEventListener('click', () => {
      openMobileAvatarStudio();
    });

    // 3. 浅色 / 深色外观
    document.getElementById('mfs-item-theme')?.addEventListener('click', () => {
      const curScheme = localStorage.getItem('color-scheme') || 'system';
      openMfsSubSheet({
        title: '外观主题',
        subtitle: '选择浅色、深色或跟随设备系统自动切换',
        bodyHtml:
          renderMfsOptionListHtml(
            [
              { id: 'system', title: '跟随系统', desc: '自动匹配设备当前的浅色与深色外观' },
              { id: 'light', title: '浅色模式', desc: '明亮通透画布，适合白天阅读与创作' },
              { id: 'dark', title: '深色模式', desc: '低眩光柔和暗调，夜间阅读更护眼' }
            ],
            curScheme
          ) +
          `
          <div class="mfs-skin-promo-card" id="mfs-promo-open-skin" style="margin-top: 14px; padding: 12px 14px; border-radius: 12px; background: linear-gradient(135deg, rgba(236, 72, 153, 0.12), rgba(139, 92, 246, 0.12)); border: 1px solid rgba(236, 72, 153, 0.3); display: flex; align-items: center; justify-content: space-between; cursor: pointer;">
            <div>
              <strong style="color: var(--text-primary); font-size: 13.5px; display: block; margin-bottom: 2px;">🎨 打开完整皮肤与外观工坊</strong>
              <span style="font-size: 11.5px; color: var(--text-secondary);">7 套主题皮肤 · 壁纸取色 · 逐句分段气泡 · 模糊度调节</span>
            </div>
            <span style="color: #ec4899; font-weight: 700; font-size: 18px; margin-left: 8px;">›</span>
          </div>
        `,
        onMount: ({ bodyEl, close }) => {
          const labelMap = { system: '系统', light: '浅色', dark: '深色' };
          bodyEl.querySelectorAll('.mfs-opt-item').forEach((btn) => {
            btn.addEventListener('click', () => {
              const nextScheme = btn.dataset.optId || 'system';
              localStorage.setItem('color-scheme', nextScheme);
              const metaEl = document.querySelector('meta[name="color-scheme"]');
              if (metaEl) metaEl.content = nextScheme === 'system' ? 'light dark' : nextScheme;
              document.documentElement.style.colorScheme = nextScheme === 'system' ? 'light dark' : nextScheme;
              const themeVal = document.getElementById('mfs-theme-value');
              if (themeVal) themeVal.textContent = labelMap[nextScheme] || '系统';
              close();
              showToast('已切换外观为：' + (nextScheme === 'dark' ? '深色模式' : nextScheme === 'light' ? '浅色模式' : '跟随系统'));
            });
          });
          bodyEl.querySelector('#mfs-promo-open-skin')?.addEventListener('click', () => {
            close();
            openMobileSkinStudio();
          });
        }
      });
    });

    // 4. 字体大小（含实时预览卡片）
    document.getElementById('mfs-item-fontsize')?.addEventListener('click', () => {
      let draftFont = localStorage.getItem('mfs_font_size') || 'normal';
      const pxMap = { small: '14px', normal: '15px', large: '17px' };
      const labelMap = { small: '小', normal: '标准', large: '大' };
      openMfsSubSheet({
        title: '字体大小',
        subtitle: '调整对话消息与正文的全局阅读字号',
        bodyHtml: `
          <div class="mfs-font-preview-card">
            <span class="mfs-font-preview-tag">效果实时预览</span>
            <p class="mfs-font-preview-text" id="mfs-font-preview-text" style="font-size:${pxMap[draftFont] || '15px'};">星语恋庭：调整合适的字号，让每一次对话与故事阅读都舒适自然。</p>
          </div>
          ${renderMfsOptionListHtml(
            [
              { id: 'small', title: '小号 (14px)', desc: '单屏显示更多行，信息更紧凑' },
              { id: 'normal', title: '标准 (15px)', desc: '官方默认舒适字阶，推荐日常使用' },
              { id: 'large', title: '大号 (17px)', desc: '文字更大更醒目，长时间阅读更轻松' }
            ],
            draftFont
          )}`,
        footerHtml: `
          <button type="button" class="mfs-sheet-btn-secondary" id="mfs-font-cancel">取消</button>
          <button type="button" class="mfs-sheet-btn-primary" id="mfs-font-apply">应用字号</button>`,
        onMount: ({ bodyEl, footerEl, close }) => {
          const previewEl = bodyEl.querySelector('#mfs-font-preview-text');
          bodyEl.querySelectorAll('.mfs-opt-item').forEach((btn) => {
            btn.addEventListener('click', () => {
              draftFont = btn.dataset.optId || 'normal';
              bodyEl.querySelectorAll('.mfs-opt-item').forEach((o) => o.classList.toggle('is-selected', o === btn));
              if (previewEl) previewEl.style.fontSize = pxMap[draftFont] || '15px';
            });
          });
          footerEl.querySelector('#mfs-font-cancel')?.addEventListener('click', close);
          footerEl.querySelector('#mfs-font-apply')?.addEventListener('click', () => {
            localStorage.setItem('mfs_font_size', draftFont);
            document.documentElement.style.fontSize = pxMap[draftFont] || '15px';
            const fontVal = document.getElementById('mfs-fontsize-value');
            if (fontVal) fontVal.textContent = labelMap[draftFont] || '标准';
            close();
            showToast(`已应用${labelMap[draftFont] || '标准'}号字体`);
          });
        }
      });
    });

    // 5. 个性化设定
    document.getElementById('mfs-item-persona')?.addEventListener('click', () => {
      const curPrompt = localStorage.getItem('ds_custom_sys_prompt') || '';
      const presets = [
        { label: '简洁直给', text: '请用简洁、条理清晰的中文直接给出结论和可执行方案，减少客套废话。' },
        { label: '温暖陪伴', text: '请保持温和、体贴与鼓励的语气交流，回复细腻有温度。' },
        { label: '严谨专业', text: '请从工程严谨性出发，给出分步骤分析、边界条件与风险提示。' }
      ];
      openMfsSubSheet({
        title: 'DeepSeek 个性化指令',
        subtitle: '自定义回答语气、风格或专属系统偏好，留空则使用官方默认',
        bodyHtml: `
          <div class="mfs-field-block">
            <span class="mfs-field-label">快捷风格模板（点击填入）</span>
            <div class="mfs-preset-chips">
              ${presets.map((p, idx) => `<button type="button" class="mfs-preset-chip" data-preset-idx="${idx}">${escapeHtml(p.label)}</button>`).join('')}
            </div>
          </div>
          <div class="mfs-field-block">
            <label class="mfs-field-label" for="mfs-sheet-persona-input">自定义系统指令</label>
            <textarea class="mfs-sheet-textarea" id="mfs-sheet-persona-input" placeholder="例如：回复尽量分点归纳，重点内容加粗提醒…">${escapeHtml(curPrompt)}</textarea>
          </div>`,
        footerHtml: `
          <button type="button" class="mfs-sheet-btn-secondary" id="mfs-persona-reset">恢复默认</button>
          <button type="button" class="mfs-sheet-btn-primary" id="mfs-persona-save">保存指令</button>`,
        onMount: ({ bodyEl, footerEl, close }) => {
          const area = bodyEl.querySelector('#mfs-sheet-persona-input');
          bodyEl.querySelectorAll('.mfs-preset-chip').forEach((chip) => {
            chip.addEventListener('click', () => {
              const idx = Number(chip.dataset.presetIdx);
              if (area && presets[idx]) area.value = presets[idx].text;
            });
          });
          footerEl.querySelector('#mfs-persona-reset')?.addEventListener('click', () => {
            localStorage.removeItem('ds_custom_sys_prompt');
            close();
            showToast('已恢复默认 DeepSeek 官方通用人设');
          });
          footerEl.querySelector('#mfs-persona-save')?.addEventListener('click', () => {
            const val = (area?.value || '').trim();
            if (val) {
              localStorage.setItem('ds_custom_sys_prompt', val);
              showToast('已保存专属个性化指令！');
            } else {
              localStorage.removeItem('ds_custom_sys_prompt');
              showToast('已恢复默认 DeepSeek 官方通用人设');
            }
            close();
          });
          setTimeout(() => area?.focus(), 60);
        }
      });
    });

    // 6. 个人 API 密钥（带官网直达入口）
    document.getElementById('mfs-item-apikey')?.addEventListener('click', openMfsApiKeySheet);

    // 7. 手机端 Phone Agent 控制入口（轻量开关悬浮球 / 无障碍检测）
    document.getElementById('mfs-item-phoneagent')?.addEventListener('click', () => {
      const isNative = window.AndroidAppBridge && window.AndroidAppBridge.isNativeApk();
      if (!isNative) {
        showToast('当前运行在网页端，安装星语随身版 APK 即可开启无障碍与悬浮控制');
        return;
      }
      const bridge = window.AndroidAppBridge;
      const isFloat = bridge.isFloatAgentRunning();
      if (isFloat) {
        bridge.stopFloatAgent();
        showToast('已收起悬浮打字控制球');
      } else {
        bridge.startFloatAgent();
        showToast('已开启常驻悬浮打字控制球，轻触左侧胶囊即可实时操作');
      }
      openMobileFullscreenSettings();
    });

    // 8. 手机辅助默认执行引擎选择器
    document.getElementById('mfs-item-phone-engine')?.addEventListener('click', () => {
      const cur =
        (window.PhoneAgent && typeof window.PhoneAgent.getExecMode === 'function'
          ? window.PhoneAgent.getExecMode()
          : localStorage.getItem('pa_exec_mode_v1')) || 'api_direct';
      const labelMap = {
        api_direct: 'DeepSeek 直连 API',
        api_cloud: '云端托管 API',
        local: '本地免 API'
      };
      openMfsSubSheet({
        title: '手机辅助默认引擎',
        subtitle: '复合任务支持「本地首步加速 + 大模型接力规划」',
        bodyHtml: renderMfsOptionListHtml(
          [
            { id: 'api_direct', title: 'DeepSeek 直连 API', desc: '使用个人官网密钥直连 DeepSeek 模型识屏规划，响应极快' },
            { id: 'api_cloud', title: '云端托管 API', desc: '免填个人密钥，由云端服务托管智能规划识屏操作' },
            { id: 'local', title: '本地免 API 指令', desc: '零网络依赖，纯离线毫秒级直控刷视频、打字与手势宏' }
          ],
          cur
        ),
        onMount: ({ bodyEl, close }) => {
          bodyEl.querySelectorAll('.mfs-opt-item').forEach((btn) => {
            btn.addEventListener('click', () => {
              const next = btn.dataset.optId || 'api_direct';
              if (window.PhoneAgent && typeof window.PhoneAgent.setExecMode === 'function') {
                window.PhoneAgent.setExecMode(next);
              } else {
                localStorage.setItem('pa_exec_mode_v1', next);
              }
              close();
              openMobileFullscreenSettings();
              showToast(`手机辅助默认引擎已切换为：${labelMap[next] || next}`);
            });
          });
        }
      });
    });

    // 9. 自动语音播报总开关
    document.getElementById('mfs-item-tts-toggle')?.addEventListener('click', () => {
      const curOn = localStorage.getItem('auto_tts_reply') !== '0';
      const nextOn = !curOn;
      localStorage.setItem('auto_tts_reply', nextOn ? '1' : '0');
      const autoTtsChk = document.getElementById('st-auto-tts-chk');
      if (autoTtsChk) autoTtsChk.checked = nextOn;
      openMobileFullscreenSettings();
      showToast(nextOn ? '已开启回复自动语音播报' : '已关闭回复自动语音播报');
    });

    // 10. 朗读音色面板
    document.getElementById('mfs-item-voice')?.addEventListener('click', () => {
      const ttsOn = localStorage.getItem('auto_tts_reply') !== '0';
      openMfsSubSheet({
        title: '朗读音色设置',
        subtitle: '角色与问答回复均默认使用高清真声合成',
        bodyHtml: `
          ${renderMfsOptionListHtml(
            [{ id: 'xiaoxiao', title: '微软晓晓 (官方真声)', desc: '自然清亮女声，支持情感语调与长文本流式播报' }],
            'xiaoxiao'
          )}
          <div class="mfs-info-block">
            <h4>当前自动播报状态</h4>
            <p>${ttsOn ? '已开启「自动语音播报」，收到回复后将自动朗读。' : '当前处于静音状态，可在上方开关随时开启自动朗读。'}</p>
          </div>`,
        footerHtml: `<button type="button" class="mfs-sheet-btn-primary" id="mfs-voice-ok">知道了</button>`,
        onMount: ({ footerEl, close }) => {
          footerEl.querySelector('#mfs-voice-ok')?.addEventListener('click', close);
        }
      });
    });

    // 11. 检查更新
    document.getElementById('mfs-item-checkupdate')?.addEventListener('click', () => {
      if (window.PhoneAgent) {
        window.PhoneAgent.checkUpdate(false);
      }
    });

    // 12. 服务协议与开源参考
    document.getElementById('mfs-item-dshgo')?.addEventListener('click', () => {
      openMfsSubSheet({
        title: '服务协议与开源参考',
        subtitle: '星语恋庭 · 安全沙盒与 dsh-Go 架构声明',
        bodyHtml: `
          <div class="mfs-info-block">
            <h4>1. 本地沙盒与密钥隐私</h4>
            <p>您配置的个人 DeepSeek API Key 与个性化偏好均保存在设备本地沙盒，不会用于其他无关用途。</p>
          </div>
          <div class="mfs-info-block">
            <h4>2. dsh-Go 手机辅助安全架构</h4>
            <p>手机端辅助参考 dsh-Go 规划循环架构设计，支持「逐步安全确认 / 免确认」切换，并通过悬浮球急停随时中止操作。</p>
          </div>
          <div class="mfs-info-block">
            <h4>3. 内容生成免责提示</h4>
            <p>所有对话与自动化建议均由 AI 生成，仅供学习、效率辅助与沉浸剧情体验参考。</p>
          </div>`,
        footerHtml: `<button type="button" class="mfs-sheet-btn-primary" id="mfs-dshgo-ok">关闭</button>`,
        onMount: ({ footerEl, close }) => {
          footerEl.querySelector('#mfs-dshgo-ok')?.addEventListener('click', close);
        }
      });
    });

    // 13. 数据管理（导出历史记录确认卡片）
    document.getElementById('mfs-item-datamanage')?.addEventListener('click', () => {
      openMfsSubSheet({
        title: '数据与会话导出',
        subtitle: '将当前对话历史备份导出为本地 Markdown (.md) 文档',
        bodyHtml: `
          <div class="mfs-info-block">
            <h4>导出说明</h4>
            <p>导出文件将完整保留角色人设名称、消息时间戳与正文，便于长期保存或在其他对话中重新导入。</p>
          </div>`,
        footerHtml: `
          <button type="button" class="mfs-sheet-btn-secondary" id="mfs-export-cancel">取消</button>
          <button type="button" class="mfs-sheet-btn-primary" id="mfs-export-confirm">导出 Markdown</button>`,
        onMount: ({ footerEl, close }) => {
          footerEl.querySelector('#mfs-export-cancel')?.addEventListener('click', close);
          footerEl.querySelector('#mfs-export-confirm')?.addEventListener('click', () => {
            close();
            document.getElementById('export-history-btn')?.click();
          });
        }
      });
    });

    // 14. 帮助与反馈（结构化指令手册）
    document.getElementById('mfs-item-help')?.addEventListener('click', () => {
      openMfsSubSheet({
        title: '帮助与手机辅助口令手册',
        subtitle: '支持 API 识屏规划、本地免 API 直控与混合接力执行',
        bodyHtml: `
          <div class="mfs-info-block">
            <h4>AI 大模型规划 & 混合接力</h4>
            <p>在「DeepSeek API / 云端 API」模式下，输入复杂任务（如“打开微信然后给张三发一条晚安”），系统将先用本地秒执行前置动作，再由大模型读取屏幕逐步推进直到完成。</p>
          </div>
          <div class="mfs-info-block">
            <h4>本地免 API · 短视频直控</h4>
            <div class="mfs-help-tags">
              <span class="mfs-help-tag">自动刷视频</span>
              <span class="mfs-help-tag">下一个视频</span>
              <span class="mfs-help-tag">双击点赞</span>
              <span class="mfs-help-tag">看评论</span>
              <span class="mfs-help-tag">停止刷视频</span>
            </div>
          </div>
          <div class="mfs-info-block">
            <h4>本地免 API · 智能打字与搜索</h4>
            <div class="mfs-help-tags">
              <span class="mfs-help-tag">打字 [内容]</span>
              <span class="mfs-help-tag">输入并发送 [内容]</span>
              <span class="mfs-help-tag">搜索 [关键词]</span>
              <span class="mfs-help-tag">粘贴</span>
              <span class="mfs-help-tag">清空输入框</span>
            </div>
          </div>
          <div class="mfs-info-block">
            <h4>系统手势与多步组合宏</h4>
            <div class="mfs-help-tags">
              <span class="mfs-help-tag">回桌面 / 返回</span>
              <span class="mfs-help-tag">截屏 / 锁屏</span>
              <span class="mfs-help-tag">音量加 / 减</span>
              <span class="mfs-help-tag">打开 微信/抖音/淘宝</span>
              <span class="mfs-help-tag">打开抖音然后自动刷视频</span>
            </div>
          </div>`,
        footerHtml: `<button type="button" class="mfs-sheet-btn-primary" id="mfs-help-ok">我了解了</button>`,
        onMount: ({ footerEl, close }) => {
          footerEl.querySelector('#mfs-help-ok')?.addEventListener('click', close);
        }
      });
    });

    // 15. 退出登录高危二次确认 Sheet
    document.getElementById('mfs-logout-btn')?.addEventListener('click', () => {
      openMfsSubSheet({
        title: '退出当前账号',
        subtitle: '确认后将清除本机登录会话凭证',
        bodyHtml: `
          <div class="mfs-danger-hero">
            <div class="mfs-danger-icon" aria-hidden="true">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
            </div>
            <p>退出登录后需要重新登录账号才可继续云端对话；本地个人 API 密钥仍可在下次登录后重新配置或使用。</p>
          </div>`,
        footerHtml: `
          <button type="button" class="mfs-sheet-btn-secondary" id="mfs-logout-cancel">取消</button>
          <button type="button" class="mfs-sheet-btn-danger" id="mfs-logout-confirm">确认退出登录</button>`,
        onMount: ({ footerEl, close }) => {
          footerEl.querySelector('#mfs-logout-cancel')?.addEventListener('click', close);
          footerEl.querySelector('#mfs-logout-confirm')?.addEventListener('click', () => {
            close();
            mfs.classList.add('hidden');
            if (typeof logoutUser === 'function') {
              logoutUser();
            } else {
              localStorage.removeItem('star_whisper_token');
              localStorage.removeItem('persona_studio_token');
              window.location.reload();
            }
          });
        }
      });
    });
  }

  // 顶栏移动端专属控件绑定
  function initMobileTopbarControls() {
    // 1. 声音静音切换（截屏 2 右侧静音图标）
    const muteBtn = document.getElementById('ds-topbar-mute-btn');
    if (muteBtn) {
      let isMuted = localStorage.getItem('ds_tts_muted') === '1';
      const syncMuteIcon = () => {
        muteBtn.innerHTML = isMuted
          ? `<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg>`
          : `<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>`;
        muteBtn.title = isMuted ? '已静音（点击开启朗读）' : '朗读开启（点击静音）';
      };
      syncMuteIcon();
      muteBtn.addEventListener('click', () => {
        isMuted = !isMuted;
        localStorage.setItem('ds_tts_muted', isMuted ? '1' : '0');
        syncMuteIcon();
        showToast(isMuted ? '已开启静音模式' : '已开启 AI 语音自动播报');
      });
    }

    // 2. 新对话按钮（按模式严格分流：phone-agent 下仅清空辅助面板，绝不新建 DeepSeek 会话）
    document.getElementById('ds-topbar-new-btn')?.addEventListener('click', () => {
      if (state.uiMode === 'phone-agent') {
        window.PhoneAgent?.resetTaskWorkspace?.();
        return;
      }
      document.getElementById('ds-new-chat-btn')?.click();
    });

    // 3. 全屏设置按钮（phone-agent 下直接弹出手机辅助专属控制台抽屉）
    document.getElementById('ds-topbar-mobile-settings-btn')?.addEventListener('click', () => {
      if (state.uiMode === 'phone-agent') {
        window.PhoneAgent?.openControlSheet?.();
        return;
      }
      openMobileFullscreenSettings();
    });

    // 4. 输入舱更多工具加号按钮（仅在手机辅助模式 phone-agent 下可见，展开分类离线指令库抽屉）
    const plusBtn = document.getElementById('mobile-tools-plus-btn');
    const quickDrawer = document.getElementById('phone-cmd-quick-drawer');
    if (plusBtn && quickDrawer) {
      plusBtn.addEventListener('click', () => {
        if (state.uiMode !== 'phone-agent') {
          quickDrawer.classList.add('hidden');
          return;
        }
        const isHidden = quickDrawer.classList.toggle('hidden');
        plusBtn.classList.toggle('is-active', !isHidden);
        document.getElementById('pa-open-cmdlib-btn')?.classList.toggle('is-active', !isHidden);
      });
    }

    // 5. 语音输入按钮（双引擎混合架构：浏览器原生 Web Speech 实时听写 + 麦克风录音转硅基流动 Qwen3-ASR-1.7B 高精度转写）
    const voiceBtn = document.getElementById('voice-input-btn');
    if (voiceBtn) {
      let isVoiceRecording = false;
      let activeMediaRecorder = null;
      let activeAudioStream = null;
      let recordedChunks = [];
      let activeSpeechRec = null;
      let baseInputBeforeVoice = '';
      let liveSpeechFinalText = '';
      let liveSpeechInterimText = '';
      let pressStartTs = 0;

      const cleanupAudioStream = () => {
        if (activeAudioStream) {
          try {
            activeAudioStream.getTracks().forEach((track) => track.stop());
          } catch {}
          activeAudioStream = null;
        }
      };

      const setVoiceBtnUi = (recording) => {
        isVoiceRecording = recording;
        voiceBtn.classList.toggle('recording', recording);
        voiceBtn.setAttribute('aria-pressed', String(recording));
        voiceBtn.title = recording ? '正在倾听…点击完成语音输入' : '语音输入（点击开始说话，再次点击完成）';
      };

      const applyRecognizedTextToInput = (newSegment) => {
        const cleanSeg = String(newSegment || '').trim();
        if (!cleanSeg && !baseInputBeforeVoice) return;
        const sep = baseInputBeforeVoice && cleanSeg && !/\s$/.test(baseInputBeforeVoice) ? ' ' : '';
        chatInput.value = `${baseInputBeforeVoice}${sep}${cleanSeg}`;
        syncComposerEmptyState();
      };

      const blobToDataUrl = (blob) =>
        new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(String(reader.result || ''));
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });

      const stopVoiceRecording = async () => {
        if (!isVoiceRecording) return;
        setVoiceBtnUi(false);

        if (activeSpeechRec) {
          try {
            activeSpeechRec.stop();
          } catch {}
          activeSpeechRec = null;
        }

        if (activeMediaRecorder && activeMediaRecorder.state !== 'inactive') {
          try {
            activeMediaRecorder.stop();
          } catch {
            cleanupAudioStream();
          }
        } else {
          cleanupAudioStream();
          const finalWebSpeech = (liveSpeechFinalText + liveSpeechInterimText).trim();
          if (finalWebSpeech) {
            applyRecognizedTextToInput(finalWebSpeech);
            chatInput.focus();
            showToast('语音输入已完成');
          }
        }
      };

      const startVoiceRecording = async () => {
        if (isVoiceRecording) {
          await stopVoiceRecording();
          return;
        }

        baseInputBeforeVoice = chatInput.value || '';
        liveSpeechFinalText = '';
        liveSpeechInterimText = '';
        recordedChunks = [];

        const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
        const canUseMediaRecorder = Boolean(
          navigator.mediaDevices &&
            typeof navigator.mediaDevices.getUserMedia === 'function' &&
            typeof window.MediaRecorder !== 'undefined'
        );

        if (!SpeechRecognitionCtor && !canUseMediaRecorder) {
          showToast('当前浏览器环境不支持麦克风语音识别，请使用 Chrome / Edge / 系统自带浏览器或开启 HTTPS 访问');
          return;
        }

        let startedAnyEngine = false;

        // 引擎 1：尝试启动浏览器原生实时语音听写（边说边出字，零延迟预览）
        if (SpeechRecognitionCtor) {
          try {
            const rec = new SpeechRecognitionCtor();
            rec.lang = 'zh-CN';
            rec.continuous = true;
            rec.interimResults = true;
            rec.onresult = (event) => {
              let finalStr = '';
              let interimStr = '';
              for (let i = 0; i < event.results.length; i++) {
                const res = event.results[i];
                const transcript = res[0]?.transcript || '';
                if (res.isFinal) finalStr += transcript;
                else interimStr += transcript;
              }
              liveSpeechFinalText = finalStr;
              liveSpeechInterimText = interimStr;
              applyRecognizedTextToInput(liveSpeechFinalText + liveSpeechInterimText);
            };
            rec.onerror = (errEv) => {
              if (errEv?.error === 'not-allowed' || errEv?.error === 'service-not-allowed') {
                if (!activeMediaRecorder) {
                  setVoiceBtnUi(false);
                  showToast('麦克风权限被拒绝，请在浏览器地址栏左侧或系统设置中允许麦克风访问');
                }
              }
            };
            rec.onend = () => {
              // 若仅依赖 WebSpeech 且未启动 MediaRecorder，则在语音自然结束时同步收起状态
              if (isVoiceRecording && (!activeMediaRecorder || activeMediaRecorder.state === 'inactive')) {
                setVoiceBtnUi(false);
                const combined = (liveSpeechFinalText + liveSpeechInterimText).trim();
                if (combined) {
                  applyRecognizedTextToInput(combined);
                  chatInput.focus();
                  showToast('语音听写完成');
                }
              }
            };
            rec.start();
            activeSpeechRec = rec;
            startedAnyEngine = true;
          } catch {}
        }

        // 引擎 2：启动 MediaRecorder 录制高保真音频，结束时交由后端 Qwen3-ASR-1.7B 转写兜底/精修
        if (canUseMediaRecorder) {
          try {
            const stream = await navigator.mediaDevices.getUserMedia({
              audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
              }
            });
            activeAudioStream = stream;
            const mimeCandidates = [
              'audio/webm;codecs=opus',
              'audio/webm',
              'audio/mp4',
              'audio/ogg;codecs=opus'
            ];
            let chosenMime = '';
            for (const m of mimeCandidates) {
              if (typeof MediaRecorder.isTypeSupported === 'function' && MediaRecorder.isTypeSupported(m)) {
                chosenMime = m;
                break;
              }
            }
            const recorder = chosenMime
              ? new MediaRecorder(stream, { mimeType: chosenMime })
              : new MediaRecorder(stream);

            recorder.ondataavailable = (ev) => {
              if (ev.data && ev.data.size > 0) {
                recordedChunks.push(ev.data);
              }
            };

            recorder.onstop = async () => {
              cleanupAudioStream();
              const webSpeechText = (liveSpeechFinalText + liveSpeechInterimText).trim();
              const audioBlob = new Blob(recordedChunks, {
                type: recorder.mimeType || chosenMime || 'audio/webm'
              });
              recordedChunks = [];

              if (audioBlob.size < 400) {
                if (webSpeechText) {
                  applyRecognizedTextToInput(webSpeechText);
                  chatInput.focus();
                } else {
                  showToast('未检测到有效语音，请靠近麦克风再试一次');
                }
                return;
              }

              // 若 WebSpeech 已经实时识别出结果，先保留在输入框中；同时尝试调用后端硅基流动 ASR 获取更精准标点与结果
              if (!webSpeechText) {
                showToast('正在识别语音内容…', 1800);
              }

              try {
                const dataUrl = await blobToDataUrl(audioBlob);
                const res = await apiJson('/api/asr/transcribe', {
                  method: 'POST',
                  body: JSON.stringify({ audio_data_url: dataUrl })
                });
                const asrText = String(res?.text || '').trim();
                if (res?.ok && asrText) {
                  applyRecognizedTextToInput(asrText);
                  chatInput.focus();
                  showToast('语音识别完成');
                  return;
                }
              } catch (asrErr) {
                if (!webSpeechText) {
                  showToast('未能识别出清晰语音，请靠近麦克风再试一次');
                  return;
                }
              }

              if (webSpeechText) {
                applyRecognizedTextToInput(webSpeechText);
                chatInput.focus();
                showToast('语音输入已完成');
              } else {
                showToast('未能识别出清晰语音，请靠近麦克风再试一次');
              }
            };

            recorder.start();
            activeMediaRecorder = recorder;
            startedAnyEngine = true;
          } catch (permErr) {
            cleanupAudioStream();
            if (!startedAnyEngine) {
              setVoiceBtnUi(false);
              const isDenied =
                permErr?.name === 'NotAllowedError' || permErr?.name === 'PermissionDeniedError';
              showToast(
                isDenied
                  ? '麦克风权限被拒绝，请在浏览器地址栏左侧或系统应用权限中允许使用麦克风'
                  : `无法启动麦克风录音：${permErr?.message || '请检查麦克风设备'}`
              );
              return;
            }
          }
        }

        if (startedAnyEngine) {
          setVoiceBtnUi(true);
          showToast('正在倾听您说话…说完后再次点击麦克风按钮即可填入');
        }
      };

      voiceBtn.addEventListener('pointerdown', () => {
        pressStartTs = Date.now();
      });

      voiceBtn.addEventListener('pointerup', (e) => {
        // 兼容用户长按说话习惯：若按住超过 450ms 后松开且当前正在录音，则松手即完成识别
        if (isVoiceRecording && pressStartTs > 0 && Date.now() - pressStartTs > 450) {
          e.preventDefault();
          pressStartTs = 0;
          stopVoiceRecording();
        }
      });

      voiceBtn.addEventListener('click', (e) => {
        e.preventDefault();
        if (isVoiceRecording) {
          stopVoiceRecording();
        } else {
          startVoiceRecording();
        }
      });
    }
  }

  initMobileFullscreenSettings();
  initMobileTopbarControls();

  document.getElementById('ds-suite-own-api-btn')?.addEventListener('click', () => {
    openSettingsModal(true);
  });

  // DeepSeek 官方 API 连接与余额测试（锁定官网端点与最新 V4.1 Flash，用户仅需填 Key）
  document.getElementById('verify-own-ds-key-btn')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const origText = btn.textContent;
    btn.disabled = true;
    btn.textContent = '正在帮您测试连接…';
    testResultBox?.classList.add('hidden');
    try {
      const draftKey = document.getElementById('st-own-ds-key')?.value.trim() || '';
      const res = await apiJson('/api/settings/verify-own-key', {
        method: 'POST',
        body: JSON.stringify({
          provider: 'own_deepseek',
          own_deepseek_api_key: draftKey
        })
      });
      if (testResultBox) {
        testResultBox.className = 'test-result-box ok';
        testResultBox.textContent = res.message;
        testResultBox.classList.remove('hidden');
      }
      if (draftKey && providerSelect.value !== 'own_deepseek') {
        providerSelect.value = 'own_deepseek';
        switchProviderPane('own_deepseek');
      }
    } catch (err) {
      if (testResultBox) {
        testResultBox.className = 'test-result-box err';
        testResultBox.textContent = `${err.message}`;
        testResultBox.classList.remove('hidden');
      }
    } finally {
      btn.disabled = false;
      btn.textContent = origText;
    }
  });

  // 云端 API 连接测试（用户可自由指定接口地址与模型名称）
  document.getElementById('verify-custom-cloud-key-btn')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const origText = btn.textContent;
    btn.disabled = true;
    btn.textContent = '正在测试云端连接…';
    testResultBox?.classList.add('hidden');
    try {
      const draftKey = document.getElementById('st-custom-cloud-key')?.value.trim() || '';
      const draftUrl = document.getElementById('st-custom-cloud-url')?.value.trim() || 'https://api.siliconflow.cn/v1/chat/completions';
      const draftModel = document.getElementById('st-custom-cloud-model')?.value.trim() || 'deepseek-ai/DeepSeek-V4.1-Flash';
      const res = await apiJson('/api/settings/verify-own-key', {
        method: 'POST',
        body: JSON.stringify({
          provider: 'custom_cloud',
          custom_cloud_api_key: draftKey,
          custom_cloud_api_url: draftUrl,
          custom_cloud_model: draftModel
        })
      });
      if (testResultBox) {
        testResultBox.className = 'test-result-box ok';
        testResultBox.textContent = res.message;
        testResultBox.classList.remove('hidden');
      }
      if (draftKey && providerSelect.value !== 'custom_cloud') {
        providerSelect.value = 'custom_cloud';
        switchProviderPane('custom_cloud');
      }
    } catch (err) {
      if (testResultBox) {
        testResultBox.className = 'test-result-box err';
        testResultBox.textContent = `${err.message}`;
        testResultBox.classList.remove('hidden');
      }
    } finally {
      btn.disabled = false;
      btn.textContent = origText;
    }
  });

  window.__openCommercialTtsSettings = () => {
    if (state.user?.is_admin) {
      openAdminConsoleModal('atab-gateway');
    } else {
      openSettingsModal(true);
    }
  };
  window.__collectSettingsDraft = collectSettingsPayload;

  document.getElementById('open-settings-btn').addEventListener('click', () => openSettingsModal(false));
  document.getElementById('ds-topbar-settings-btn')?.addEventListener('click', () => openSettingsModal(false));
  document.getElementById('st-quick-export-md-btn')?.addEventListener('click', () => {
    settingsDialog.close();
    if (state.activeSessionId) {
      exportSessionMarkdownById(state.activeSessionId);
    }
  });
  document.getElementById('st-quick-import-md-btn')?.addEventListener('click', () => {
    settingsDialog.close();
    openImportHistoryModal();
  });
  document.getElementById('st-quick-fim-btn')?.addEventListener('click', () => {
    settingsDialog.close();
    document.getElementById('more-open-fim-btn')?.click();
  });
  document.getElementById('st-quick-tour-btn')?.addEventListener('click', () => {
    settingsDialog.close();
    document.getElementById('start-tour-btn')?.click();
  });
  document.getElementById('close-settings-dialog').addEventListener('click', () => settingsDialog.close());
  document.getElementById('cancel-settings-dialog').addEventListener('click', () => settingsDialog.close());

  const settingsFormNode = document.getElementById('settings-form');
  if (settingsFormNode) {
    settingsFormNode.noValidate = true;
    settingsFormNode.addEventListener('submit', async (e) => {
      e.preventDefault();
      const submitBtn =
        document.getElementById('save-settings-submit-btn') ||
        settingsFormNode.querySelector('button[type="submit"]');
      const origBtnLabel = submitBtn ? submitBtn.textContent : '保存设置';
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = '正在保存…';
      }
      testResultBox?.classList.add('hidden');

      try {
        const draftPayload = collectSettingsPayload();
        const abortCtrl = new AbortController();
        const timeoutId = setTimeout(() => abortCtrl.abort(), 12000);
        let res;
        try {
          res = await apiJson('/api/settings', {
            method: 'POST',
            body: JSON.stringify(draftPayload),
            signal: abortCtrl.signal
          });
        } finally {
          clearTimeout(timeoutId);
        }

        state.settings = res.settings;
        settingsSavedFlag = true;
        settingsInitialSnapshot = null;
        const autoTtsChk = document.getElementById('st-auto-tts-chk');
        if (autoTtsChk) {
          try {
            localStorage.setItem('auto_tts_reply', autoTtsChk.checked ? '1' : '0');
          } catch {}
        }
        const showFollowChk = document.getElementById('st-show-followups-chk');
        if (showFollowChk) {
          setShowFollowUpsEnabled(Boolean(showFollowChk.checked), false);
        }
        const autoProChk = document.getElementById('st-auto-proactive-chk');
        if (autoProChk) {
          const wantPro = Boolean(autoProChk.checked);
          try {
            localStorage.setItem('pref_auto_proactive', wantPro ? '1' : '0');
          } catch {}
          if (state.activeSessionId) {
            try {
              await patchActiveSessionFlag({ proactive_enabled: wantPro }, '');
            } catch (sessErr) {
              console.warn('[Settings] 活跃会话状态同步跳过（不阻断全局设置保存）:', sessErr?.message);
            }
          }
        }
        renderUserAndMembership();
        window.DeepSeekMonitorPlugin?.sync({
          settings: state.settings,
          messages: state.messages,
          forceBalanceRefresh: true
        });
        settingsDialog.close();

        if (res.settings.provider === 'own_deepseek') {
          showToast('您的个人 API 直连已保存生效！DeepSeek 原生对话与角色扮演剧场均可直连畅聊！');
        } else {
          showToast('游戏画面与语音偏好设置已保存');
        }

        if (state.activeSessionId) {
          loadSession(state.activeSessionId).catch(() => {});
        }
      } catch (err) {
        const friendlyMsg =
          err?.name === 'AbortError'
            ? '保存请求超时，请检查网络连接后重试'
            : err?.message || '保存设置失败';
        if (testResultBox) {
          testResultBox.className = 'test-result-box err';
          testResultBox.textContent = `${friendlyMsg}`;
          testResultBox.classList.remove('hidden');
          testResultBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
        showToast(`${friendlyMsg}`);
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = origBtnLabel;
        }
      }
    });
  }

  // ================= 12. 同类标杆增强模块：主控人设、角色广场、番外小剧场与心动语录签 =================

  // A. 🎀 我的主控人设（User Persona）
  function syncRelPresetChipState() {
    const curRole = (document.getElementById('up-role')?.value || '').trim();
    document.querySelectorAll('.rel-preset-chip').forEach((chip) => {
      const matched = chip.textContent.trim() === curRole;
      chip.classList.toggle('active', matched);
      chip.setAttribute('aria-pressed', String(matched));
    });
  }

  function refreshUpAvatarPreview() {
    const previewEl = document.getElementById('up-avatar-preview');
    if (!previewEl) return;
    const avVal = document.getElementById('up-avatar')?.value || state.user?.avatar || '我';
    const nickVal = document.getElementById('up-nickname')?.value || state.user?.nickname || '我';
    let cfg = null;
    try {
      const rawCfg = document.getElementById('up-avatar-config')?.value;
      cfg = rawCfg ? JSON.parse(rawCfg) : null;
    } catch {}
    previewEl.innerHTML = renderSmartAvatarHtml(avVal, nickVal, 'size-xl', true, cfg);
  }

  document.getElementById('open-user-persona-btn').addEventListener('click', () => {
    if (!state.user) return;
    const curAv = state.user.avatar || '我';
    const curCfg = state.user.avatar_config || null;
    document.getElementById('up-avatar').value = curAv;
    const cfgInput = document.getElementById('up-avatar-config');
    if (cfgInput) cfgInput.value = curCfg ? JSON.stringify(curCfg) : '';
    const quickGlyph = document.getElementById('up-avatar-quick-glyph');
    if (quickGlyph) {
      quickGlyph.value =
        curAv.startsWith('/api/') || curAv.startsWith('data:') || curAv.startsWith('svg:')
          ? (curCfg?.glyph || '星')
          : curAv;
    }
    document.getElementById('up-nickname').value = state.user.nickname || '';
    document.getElementById('up-role').value = state.user.user_persona?.role || '';
    document.getElementById('up-appearance').value = state.user.user_persona?.appearance || '';
    document.getElementById('up-bio').value = state.user.user_persona?.bio || '';
    syncRelPresetChipState();
    refreshUpAvatarPreview();
    userPersonaDialog.showModal();
  });
  document.getElementById('close-up-dialog').addEventListener('click', () => userPersonaDialog.close());
  document.getElementById('cancel-up-dialog').addEventListener('click', () => userPersonaDialog.close());

  document.getElementById('up-avatar-quick-glyph')?.addEventListener('input', (e) => {
    const val = e.target.value.trim().slice(0, 4) || '我';
    document.getElementById('up-avatar').value = val;
    const cfgInput = document.getElementById('up-avatar-config');
    let curCfg = {};
    try {
      curCfg = cfgInput?.value ? JSON.parse(cfgInput.value) : {};
    } catch {}
    curCfg = Object.assign({}, curCfg, { type: 'glyph', glyph: val });
    if (cfgInput) cfgInput.value = JSON.stringify(curCfg);
    refreshUpAvatarPreview();
  });

  document.getElementById('open-avatar-studio-btn')?.addEventListener('click', () => {
    if (!window.AppearanceSystem?.openAvatarStudio) return;
    let curCfg = null;
    try {
      const raw = document.getElementById('up-avatar-config')?.value;
      curCfg = raw ? JSON.parse(raw) : state.user?.avatar_config || null;
    } catch {}
    window.AppearanceSystem.openAvatarStudio({
      initialAvatar: document.getElementById('up-avatar')?.value || state.user?.avatar || '我',
      initialConfig: curCfg,
      nickname: document.getElementById('up-nickname')?.value || state.user?.nickname || '我',
      onApply: ({ avatar, avatar_config }) => {
        document.getElementById('up-avatar').value = avatar;
        const cfgInput = document.getElementById('up-avatar-config');
        if (cfgInput) cfgInput.value = avatar_config ? JSON.stringify(avatar_config) : '';
        const quickGlyph = document.getElementById('up-avatar-quick-glyph');
        if (quickGlyph && avatar_config?.type === 'glyph') {
          quickGlyph.value = avatar_config.glyph || avatar;
        }
        refreshUpAvatarPreview();
      }
    });
  });

  document.getElementById('up-role')?.addEventListener('input', syncRelPresetChipState);
  document.querySelectorAll('.rel-preset-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      document.getElementById('up-role').value = chip.textContent.trim();
      syncRelPresetChipState();
    });
  });

  document.getElementById('user-persona-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const nickInp = document.getElementById('up-nickname');
    const cleanNick = (nickInp?.value || '').trim();
    if (!cleanNick) {
      showToast('你在故事里的名字不能为空哦，请填写希望角色对你的称呼');
      nickInp?.focus();
      return;
    }
    let avatarConfigPayload = undefined;
    const rawCfgStr = document.getElementById('up-avatar-config')?.value;
    if (rawCfgStr) {
      try { avatarConfigPayload = JSON.parse(rawCfgStr); } catch {}
    }
    try {
      const res = await apiJson('/api/auth/user-persona', {
        method: 'PUT',
        body: JSON.stringify({
          avatar: document.getElementById('up-avatar').value.trim() || '我',
          avatar_config: avatarConfigPayload,
          nickname: cleanNick,
          role: document.getElementById('up-role').value.trim(),
          appearance: document.getElementById('up-appearance').value.trim(),
          bio: document.getElementById('up-bio').value.trim()
        })
      });
      state.user = res.user;
      userPersonaDialog.close();
      renderUserAndMembership();

      // 立即在本地记忆列表中同步更新「我在故事里的名字」置顶记忆，确保零延迟显示
      if (Array.isArray(state.memories)) {
        const nickContent = `我在故事里的名字是「${res.user.nickname}」，请称呼我为「${res.user.nickname}」`;
        const existMem = state.memories.find((m) => m.slot_key === 'user_nickname');
        if (existMem) {
          existMem.content = nickContent;
          existMem.pinned = 1;
        } else {
          state.memories.unshift({
            id: Date.now(),
            category: 'profile',
            slot_key: 'user_nickname',
            content: nickContent,
            pinned: 1,
            importance: 5,
            retention: 100
          });
        }
        renderTelemetryAndMemories();
      }
      renderMessages();

      showToast(`已保存！现在所有角色都会称呼你为「${res.user.nickname}」`);
      if (state.activeSessionId && state.sessions.some((s) => s.id === state.activeSessionId)) {
        await loadSession(state.activeSessionId).catch(() => {});
      }
    } catch (err) {
      showToast(`${err.message}`);
    }
  });

  // B. 📖 剧本与共创中心（我的剧本库 ｜ 上传与 AI 改剧本 ｜ 共创设计广场）
  const WORKSHOP_SAMPLE_DRAFTS = {
    piano: `# 《旧音乐室的雨夜四重奏》
【世界观背景】
海滨小镇的青叶高中即将拆除五十年前建成的木造旧音乐馆。每逢傍晚落雨，三楼上锁的旧琴房里总会传出半首未弹完的肖邦夜曲，却没人见过弹琴的人。

【登场人物】
角色1：白川诗织 —— 高三休学中的天才钢琴少女，因为一年前挚友转学失联而患上舞台失语症，每天傍晚偷偷从天台楼梯潜入旧琴房，试图补完两人当年合写的毕业曲。外表清冷寡言，其实一旦有人听懂她的琴声就会眼眶泛红。
角色2：夏目阳葵 —— 元气爽朗的广播部二年级学妹，手里攥着一台录下神秘琴声的旧磁带录音机，拉着你成立“旧校舍不可思议调查团”，嘴上说想做独家广播专题，其实一直默默担心白川学姐的身体。

【故事草稿】
第一天放学下起暴雨，夏目阳葵拽着我去旧音乐馆躲雨录音，我们意外推开了三楼琴房的木门，撞见淋湿校服的白川诗织正对着泛黄乐谱发呆。距离旧音乐馆正式断电拆除只剩最后七天，我们决定帮她在拆除前办一场只有三个人的黄昏告别演奏会，找回乐谱丢失的最后一页……`,
    train: `# 《银河铁道末班车的守望人》
【世界观背景】
在海平面上升后的雾港群岛，子夜零点有一列只在退潮时浮现轨道的水上蒸汽列车「白鸟号」，专门搭载放不下遗憾的旅人前往记忆尽头的灯塔站。

【登场人物】
角色1：诺亚 —— 白鸟号列车的银发检票员少年，戴着单边怀表链眼镜，说话礼貌克制却带点冷幽默。他已经在列车上守望了整整一百年，怀表里藏着一张早已褪色的双人车票。
角色2：星野萤 —— 提着旧煤油灯登车的神秘少女画师，声称自己弄丢了最重要的“某人的名字”，一路上在车窗雾气上画下沿途闪过的星座，性格温柔天然却在接近终点站时越来越透明。

【故事草稿】
我在雨夜旧站台捡到一枚发光的黄铜车票，误登上了子夜发车的白鸟号。检票员诺亚看清我手里的车票后神色剧变，破例允许我留在餐车同行；而在第三节车厢画画的少女星野萤却微笑着喊出了我小时候才用过的小名……天亮之前列车即将抵达终点灯塔，我必须在靠站前查清车票背后的百年契约。`
  };

  function switchHubTab(targetTabId = 'hub-tab-library') {
    const tablist = document.getElementById('hub-tablist');
    if (!tablist) return;
    const tabs = [...tablist.querySelectorAll('[role="tab"]')];
    tabs.forEach((tab) => {
      const isSelected = tab.id === targetTabId;
      tab.setAttribute('aria-selected', String(isSelected));
      tab.tabIndex = isSelected ? 0 : -1;
      const panelId = tab.dataset.hpanel;
      const panel = panelId ? document.getElementById(panelId) : null;
      if (panel) {
        panel.hidden = !isSelected;
      }
    });

    if (targetTabId === 'hub-tab-library') {
      renderPlazaModal();
    } else if (targetTabId === 'hub-tab-square') {
      populateSquarePublishTargets();
      renderSquareCards();
      refreshSquareItemsSilent();
    }
  }

  // 绑定 tablist 点击与左右方向键无障碍切换（Roving tabindex）
  const hubTablistEl = document.getElementById('hub-tablist');
  if (hubTablistEl) {
    hubTablistEl.addEventListener('click', (e) => {
      const btn = e.target.closest('[role="tab"]');
      if (!btn) return;
      switchHubTab(btn.id);
    });
    hubTablistEl.addEventListener('keydown', (e) => {
      const tabs = [...hubTablistEl.querySelectorAll('[role="tab"]')];
      const idx = tabs.indexOf(document.activeElement);
      if (idx === -1) return;
      let nextIdx = -1;
      if (e.key === 'ArrowRight') nextIdx = (idx + 1) % tabs.length;
      else if (e.key === 'ArrowLeft') nextIdx = (idx - 1 + tabs.length) % tabs.length;
      else if (e.key === 'Home') nextIdx = 0;
      else if (e.key === 'End') nextIdx = tabs.length - 1;
      if (nextIdx !== -1) {
        e.preventDefault();
        tabs[nextIdx].focus();
        switchHubTab(tabs[nextIdx].id);
      }
    });
  }

  function openScriptSelectModal(defaultTabId = 'hub-tab-library') {
    const tabId = typeof defaultTabId === 'string' && defaultTabId.startsWith('hub-tab-')
      ? defaultTabId
      : 'hub-tab-library';
    switchHubTab(tabId);
    if (!plazaDialog.open) {
      plazaDialog.showModal();
    }
  }

  // ---------- 页签 1：📚 我的剧本库 ----------
  function renderPlazaModal() {
    const grid = document.getElementById('plaza-cards-grid');
    if (!grid) return;
    grid.innerHTML = '';

    const scriptsList = state.scripts.length > 0 ? state.scripts : [getActiveScriptObj()];
    const cardAuras = [
      'rgba(229, 193, 133, 0.16)',
      'rgba(180, 151, 255, 0.16)',
      'rgba(110, 203, 185, 0.14)',
      'rgba(232, 155, 180, 0.15)'
    ];
    let scIdx = 0;

    for (const sc of scriptsList) {
      const auraColor = cardAuras[scIdx % cardAuras.length];
      scIdx += 1;
      const isCurrent = sc.id === state.activeScriptId;
      const isCustom = Boolean(sc.is_custom);
      const fromSquare = Boolean(sc.source_share_id);
      const castList = state.personas.filter(
        (p) => p.id !== 'persona_deepseek_official' && resolvePersonaScriptId(p) === sc.id
      );

      const castHtml = castList
        .map((p) => {
          const shortName = (p.name || '').split('·')[0].trim();
          return `
            <button type="button" class="script-cast-chip" data-pid="${escapeHtml(p.id)}" title="直接以「${escapeHtml(
            p.name
          )}」进入本剧本">
              <span>${escapeHtml(p.avatar)}</span>
              <strong>${escapeHtml(shortName)}</strong>
              <small>${escapeHtml(p.category_tag || '')}</small>
            </button>
          `;
        })
        .join('');

      const badgeHtml = [
        isCustom
          ? `<span class="ssc-custom-badge">${fromSquare ? '广场获取' : '我的原创'}</span>`
          : '',
        isCurrent ? '<span class="ssc-active-badge">当前剧本</span>' : ''
      ]
        .filter(Boolean)
        .join('');

      const card = document.createElement('div');
      card.className = `script-select-card ${isCurrent ? 'active' : ''}`;
      card.style.setProperty('--card-aura', auraColor);
      card.innerHTML = `
        <div class="ssc-top">
          <div class="ssc-title-group">
            <span class="ssc-icon">${escapeHtml(sc.icon || '剧')}</span>
            <div>
              <div class="ssc-title">${escapeHtml(sc.title)}</div>
              <div class="ssc-sub">${escapeHtml(sc.subtitle || '')}</div>
            </div>
          </div>
          <div class="ssc-badges-right">${badgeHtml}</div>
        </div>

        <p class="ssc-synopsis">${escapeHtml(sc.synopsis || '')}</p>

        <div class="ssc-role-line">
          <span>你的剧中身份：<strong>${escapeHtml(sc.player_role || '故事主角')}</strong></span>
          <span>共 ${(sc.chapters || []).length || 4} 幕主线</span>
        </div>

        <div class="ssc-cast-block">
          <span class="ssc-cast-label">本剧专属人设（点击角色直接开演）：</span>
          <div class="ssc-cast-list">${castHtml || '<span class="muted-count">暂无角色</span>'}</div>
        </div>

        <div class="ssc-footer-row">
          <button type="button" class="primary-btn enter-script-btn">
            ${isCurrent ? '继续体验本剧本' : `进入《${escapeHtml(sc.title)}》 ▸`}
          </button>
          <button type="button" class="secondary-btn ssc-share-btn" title="将该剧本连同登场人设一键分享到共创设计广场">
            分享到广场
          </button>
          ${
            isCustom
              ? '<button type="button" class="secondary-btn ssc-del-btn" title="从我的剧本库移除此自建剧本" aria-label="移除自建剧本"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path></svg></button>'
              : ''
          }
        </div>
      `;

      card.querySelectorAll('.script-cast-chip').forEach((chip) => {
        chip.addEventListener('click', async (e) => {
          e.stopPropagation();
          plazaDialog.close();
          await switchActiveScript(sc.id, chip.dataset.pid);
        });
      });

      card.querySelector('.enter-script-btn').addEventListener('click', async () => {
        plazaDialog.close();
        if (!isCurrent) {
          await switchActiveScript(sc.id, null);
        }
      });

      card.querySelector('.ssc-share-btn').addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        try {
          const res = await apiJson('/api/square/publish', {
            method: 'POST',
            body: JSON.stringify({
              share_type: 'script',
              target_id: sc.id,
              tags: '剧本共享,多幕群像'
            })
          });
          if (Array.isArray(res.items)) state.squareItems = res.items;
          showToast(`已将《${sc.title}》打包发布到共创设计广场！`);
          switchHubTab('hub-tab-square');
        } catch (err) {
          showToast(err.message || '分享失败，请稍后再试');
        } finally {
          btn.disabled = false;
        }
      });

      const delBtn = card.querySelector('.ssc-del-btn');
      if (delBtn) {
        delBtn.addEventListener('click', async () => {
          const confirmed = await askUserConfirm({
            title: '确认删除自创剧本',
            message: `确定要永久删除剧本《${sc.title}》吗？此操作无法撤销。`,
            confirmText: '确认删除剧本',
            danger: true
          });
          if (!confirmed) return;
          delBtn.disabled = true;
          try {
            const res = await apiJson(`/api/scripts/${encodeURIComponent(sc.id)}`, {
              method: 'DELETE'
            });
            state.scripts = res.scripts || state.scripts;
            state.personas = res.personas || state.personas;
            if (state.activeScriptId === sc.id && state.scripts[0]) {
              await switchActiveScript(state.scripts[0].id, null);
            } else {
              renderPersonaList();
            }
            renderPlazaModal();
            showToast(`已移除剧本《${sc.title}》`);
          } catch (err) {
            showToast(err.message || '移除失败');
            delBtn.disabled = false;
          }
        });
      }

      grid.appendChild(card);
    }
  }

  document.getElementById('lib-jump-workshop-btn')?.addEventListener('click', () => {
    switchHubTab('hub-tab-workshop');
  });
  document.getElementById('lib-jump-square-btn')?.addEventListener('click', () => {
    switchHubTab('hub-tab-square');
  });

  // ---------- 页签 2：🪄 上传剧本 · AI 辅助优化改进与提取人设工坊 ----------
  const wsFileInput = document.getElementById('ws-file-input');
  const wsDropzone = document.getElementById('ws-dropzone');
  const wsRawTextarea = document.getElementById('ws-raw-textarea');
  const wsFileStatusTitle = document.getElementById('ws-file-status-title');
  const wsAnalyzeBtn = document.getElementById('ws-analyze-btn');
  const wsResultZone = document.getElementById('ws-result-zone');

  async function handleWorkshopFilePicked(file) {
    if (!file) return;
    const text = await file.text();
    state.workshopFilename = file.name || 'uploaded_script.txt';
    if (wsRawTextarea) wsRawTextarea.value = text;
    if (wsFileStatusTitle) {
      wsFileStatusTitle.textContent = `已载入剧本文件：${file.name}（共 ${text.length} 字，点下方按钮即可 AI 优化提取）`;
    }
    showToast(`已读取《${file.name}》，点击下方按钮开始 AI 优化与提取人设`);
  }

  document.getElementById('ws-select-file-btn')?.addEventListener('click', () => {
    wsFileInput?.click();
  });
  wsFileInput?.addEventListener('change', (e) => {
    const f = e.target.files?.[0];
    if (f) handleWorkshopFilePicked(f);
    wsFileInput.value = '';
  });

  if (wsDropzone) {
    wsDropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      wsDropzone.classList.add('drag-over');
    });
    wsDropzone.addEventListener('dragleave', () => {
      wsDropzone.classList.remove('drag-over');
    });
    wsDropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      wsDropzone.classList.remove('drag-over');
      const f = e.dataTransfer?.files?.[0];
      if (f) handleWorkshopFilePicked(f);
    });
  }

  document.querySelectorAll('.ws-sample-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.sample;
      const sampleText = WORKSHOP_SAMPLE_DRAFTS[key] || WORKSHOP_SAMPLE_DRAFTS.piano;
      state.workshopFilename = key === 'train' ? '银河铁道末班车的守望人.md' : '旧音乐室的雨夜四重奏.md';
      if (wsRawTextarea) wsRawTextarea.value = sampleText;
      if (wsFileStatusTitle) {
        wsFileStatusTitle.textContent = `已填入示例草稿：${state.workshopFilename}（可直接点击下方 AI 优化按钮体验）`;
      }
    });
  });

  document.getElementById('ws-clear-raw-btn')?.addEventListener('click', async () => {
    const curVal = wsRawTextarea?.value || '';
    if (curVal.trim().length > 0) {
      const confirmed = await askUserConfirm({
        title: '确认清空剧本草稿内容',
        message: `当前剧本框内已有 ${curVal.length} 字内容，清空后将无法恢复，确定清空吗？`,
        confirmText: '确认清空',
        danger: true
      });
      if (!confirmed) return;
    }
    if (wsRawTextarea) wsRawTextarea.value = '';
    state.workshopFilename = '';
    if (wsFileStatusTitle) {
      wsFileStatusTitle.textContent = '上传本地剧本 / 小说 / 设定稿文件（.txt / .md / .json）';
    }
  });

  document.querySelectorAll('.ws-focus-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      state.workshopFocus = chip.dataset.focus || 'balanced';
      document.querySelectorAll('.ws-focus-chip').forEach((c) => {
        const active = c === chip;
        c.classList.toggle('active', active);
        c.setAttribute('aria-pressed', String(active));
      });
    });
  });

  function renderWorkshopPersonaCardDom(pObj, index) {
    const card = document.createElement('div');
    card.className = 'ws-persona-edit-card';
    card.innerHTML = `
      <div class="ws-pcard-head">
        <input type="text" class="ws-pcard-avatar" value="${escapeHtml(pObj.avatar || '角')}" maxlength="4" aria-label="角色头像徽记" />
        <input type="text" class="ws-pcard-name" value="${escapeHtml(pObj.name || `登场角色 ${index + 1}`)}" placeholder="角色姓名 · 头衔" aria-label="角色姓名与头衔" />
        <input type="text" class="ws-pcard-tag" value="${escapeHtml(pObj.category_tag || '核心主线')}" placeholder="路线标签" aria-label="角色路线标签" />
        <button type="button" class="fim-clear-mini ws-remove-pcard-btn" title="移除该角色">移除</button>
      </div>
      <input type="text" class="ws-pcard-tagline" value="${escapeHtml(pObj.tagline || '')}" placeholder="一句话记忆点简介…" aria-label="一句话简介" />
      <textarea class="ws-pcard-personality" rows="2" placeholder="性格反差与背景细节…" aria-label="性格与背景">${escapeHtml(
        pObj.personality || ''
      )}</textarea>
      <input type="hidden" class="ws-pcard-backstory" value="${escapeHtml(pObj.backstory || '')}" />
      <input type="hidden" class="ws-pcard-style" value="${escapeHtml(pObj.speaking_style || '')}" />
      <input type="hidden" class="ws-pcard-prompts" value="${escapeHtml(
        JSON.stringify(Array.isArray(pObj.starter_prompts) ? pObj.starter_prompts : [])
      )}" />
      <label class="muted-count">初遇第一句开场白：</label>
      <textarea class="ws-pcard-greeting" rows="3" placeholder="*场景神态描写* 第一句对白…" aria-label="初遇开场白">${escapeHtml(
        pObj.greeting || ''
      )}</textarea>
    `;
    card.querySelector('.ws-remove-pcard-btn').addEventListener('click', () => {
      const container = document.getElementById('ws-personas-editor-grid');
      if (container && container.children.length <= 1) {
        showToast('至少需要保留 1 位登场人设哦');
        return;
      }
      card.remove();
      updateWorkshopPersonaCountLabel();
    });
    return card;
  }

  function updateWorkshopPersonaCountLabel() {
    const grid = document.getElementById('ws-personas-editor-grid');
    const lbl = document.getElementById('ws-personas-count-title');
    if (grid && lbl) {
      lbl.textContent = `自动从剧本提取的专属登场人设（共 ${grid.children.length} 位，可直接修改）`;
    }
  }

  function renderWorkshopAnalysisResult(data) {
    state.workshopDraft = data;
    wsResultZone?.classList.remove('hidden');

    const engineBadge = document.getElementById('ws-engine-badge');
    if (engineBadge) {
      engineBadge.textContent =
        data.engine === 'llm' ? 'AI 编剧大模型深度精修' : '智能剧本引擎拆解完成';
    }

    const critiqueList = document.getElementById('ws-critique-list');
    if (critiqueList) {
      critiqueList.innerHTML = (data.critique || [])
        .map((item) => `<li>${escapeHtml(item)}</li>`)
        .join('');
    }

    const sc = data.script || {};
    document.getElementById('ws-sc-icon').value = sc.icon || '剧';
    document.getElementById('ws-sc-title').value = sc.title || '未命名互动剧本';
    document.getElementById('ws-sc-subtitle').value = sc.subtitle || '玩家原创多幕互动剧';
    document.getElementById('ws-sc-role').value = sc.player_role || '卷入故事核心的同行者';
    document.getElementById('ws-sc-synopsis').value = sc.synopsis || '';

    const chapGrid = document.getElementById('ws-chapters-editor-list');
    if (chapGrid) {
      chapGrid.innerHTML = '';
      (sc.chapters || []).forEach((ch, idx) => {
        const div = document.createElement('div');
        div.className = 'ws-chap-edit-card';
        div.innerHTML = `
          <input type="text" class="ws-ch-title" value="${escapeHtml(ch.title || `第 ${idx + 1} 幕`)}" aria-label="幕次标题" />
          <textarea class="ws-ch-note" rows="2" aria-label="本幕剧情导引">${escapeHtml(ch.note || '')}</textarea>
          <input type="text" class="ws-ch-opener" value="${escapeHtml(ch.opener || '')}" placeholder="切入本幕的首句行动台词" aria-label="切入台词" />
        `;
        chapGrid.appendChild(div);
      });
    }

    const pGrid = document.getElementById('ws-personas-editor-grid');
    if (pGrid) {
      pGrid.innerHTML = '';
      (data.personas || []).forEach((p, idx) => {
        pGrid.appendChild(renderWorkshopPersonaCardDom(p, idx));
      });
      updateWorkshopPersonaCountLabel();
    }

    wsResultZone?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  document.getElementById('ws-add-persona-card-btn')?.addEventListener('click', () => {
    const pGrid = document.getElementById('ws-personas-editor-grid');
    if (!pGrid) return;
    const scTitle = document.getElementById('ws-sc-title')?.value?.trim() || '本剧本';
    pGrid.appendChild(
      renderWorkshopPersonaCardDom(
        {
          avatar: '伴',
          name: `新角色 · 《${scTitle}》同行者`,
          category_tag: '新增支线',
          tagline: '与你在故事中并肩前行的关键人物',
          personality: '细腻真诚，嘴硬心软，在关键剧情节点与你共同进退。',
          backstory: `【所属剧本：《${scTitle}》】与{{user}}在事件中结下羁绊的重要伙伴。`,
          speaking_style: '自然生动，善用星号描写动作与神态细节',
          greeting: `*微风拂过，对方停下脚步转头看向走近的你。*\n\n你也来啦？正好，我们一起去看看前面有什么线索吧。`,
          starter_prompts: ['“好呀，我们一起过去看看！”']
        },
        pGrid.children.length
      )
    );
    updateWorkshopPersonaCountLabel();
  });

  let wsAnalyzeAbortCtrl = null;
  document.getElementById('ws-cancel-analyze-btn')?.addEventListener('click', () => {
    if (wsAnalyzeAbortCtrl) {
      wsAnalyzeAbortCtrl.abort();
      wsAnalyzeAbortCtrl = null;
    }
  });

  wsAnalyzeBtn?.addEventListener('click', async () => {
    const content = (wsRawTextarea?.value || '').trim();
    if (!content) {
      showToast('请先上传剧本文件、粘贴草稿，或点一下上方的「示例草稿」按钮');
      wsRawTextarea?.focus();
      return;
    }
    const origText = wsAnalyzeBtn.textContent;
    const progCard = document.getElementById('ws-progress-card');
    const progBar = document.getElementById('ws-progress-bar');
    const progLbl = document.getElementById('ws-progress-label');

    wsAnalyzeBtn.disabled = true;
    wsAnalyzeBtn.textContent = 'AI 正在阅读诊断剧本…';
    if (progCard) progCard.classList.remove('hidden');
    if (progBar) progBar.value = 10;

    let pct = 10;
    const stages = [
      '正在阅读剧本草稿并梳理人物关系（1/3）…',
      '正在拆分四幕互动剧情与转折点（2/3）…',
      '正在提取登场角色的开场白与设定（3/3，即将完成）…'
    ];
    const progTimer = setInterval(() => {
      pct = Math.min(92, pct + (pct < 55 ? 5 : 2));
      if (progBar) progBar.value = pct;
      if (progLbl) {
        progLbl.textContent = pct < 40 ? stages[0] : pct < 72 ? stages[1] : stages[2];
      }
    }, 900);

    wsAnalyzeAbortCtrl = new AbortController();
    try {
      const res = await apiJson('/api/workshop/analyze', {
        method: 'POST',
        signal: wsAnalyzeAbortCtrl.signal,
        body: JSON.stringify({
          filename: state.workshopFilename,
          content,
          focus_mode: state.workshopFocus
        })
      });
      if (progBar) progBar.value = 100;
      renderWorkshopAnalysisResult(res);
      showToast(`已完成剧本优化并提取出 ${(res.personas || []).length} 位专属角色！`);
    } catch (err) {
      if (err?.name === 'AbortError') {
        showToast('已取消本次剧本 AI 诊断');
      } else {
        showToast(err.message || '剧本解析失败，请稍后重试');
      }
    } finally {
      clearInterval(progTimer);
      wsAnalyzeAbortCtrl = null;
      if (progCard) progCard.classList.add('hidden');
      wsAnalyzeBtn.disabled = false;
      wsAnalyzeBtn.textContent = origText;
    }
  });

  document.getElementById('ws-save-and-play-btn')?.addEventListener('click', async (e) => {
    const saveBtn = e.currentTarget;
    const scTitle = document.getElementById('ws-sc-title')?.value?.trim();
    if (!scTitle) {
      showToast('请填写剧本标题');
      return;
    }

    const chapters = [...document.querySelectorAll('#ws-chapters-editor-list .ws-chap-edit-card')].map((el) => ({
      title: el.querySelector('.ws-ch-title')?.value?.trim() || '新章节',
      note: el.querySelector('.ws-ch-note')?.value?.trim() || '',
      opener: el.querySelector('.ws-ch-opener')?.value?.trim() || '我们继续往前推进剧情吧。'
    }));

    const personas = [...document.querySelectorAll('#ws-personas-editor-grid .ws-persona-edit-card')].map((el) => {
      let starterPrompts = [];
      try {
        starterPrompts = JSON.parse(el.querySelector('.ws-pcard-prompts')?.value || '[]');
      } catch {}
      const pName = el.querySelector('.ws-pcard-name')?.value?.trim() || '原创角色';
      const pPers = el.querySelector('.ws-pcard-personality')?.value?.trim() || '';
      const rawBack = el.querySelector('.ws-pcard-backstory')?.value?.trim() || '';
      return {
        avatar: el.querySelector('.ws-pcard-avatar')?.value?.trim() || '角',
        name: pName,
        category_tag: el.querySelector('.ws-pcard-tag')?.value?.trim() || '核心主线',
        tagline: el.querySelector('.ws-pcard-tagline')?.value?.trim() || '',
        personality: pPers,
        backstory: rawBack || `【所属剧本：《${scTitle}》】\n${pPers}`,
        speaking_style: el.querySelector('.ws-pcard-style')?.value?.trim() || '自然沉浸，带细腻神态动作描写',
        greeting: el.querySelector('.ws-pcard-greeting')?.value?.trim() || '',
        starter_prompts: starterPrompts
      };
    });

    const publishToSquare = Boolean(document.getElementById('ws-sync-square-chk')?.checked);
    saveBtn.disabled = true;
    const oldText = saveBtn.textContent;
    saveBtn.textContent = '正在创建剧本与专属人设…';

    try {
      const res = await apiJson('/api/workshop/save', {
        method: 'POST',
        body: JSON.stringify({
          script: {
            icon: document.getElementById('ws-sc-icon')?.value?.trim() || '剧',
            title: scTitle,
            subtitle: document.getElementById('ws-sc-subtitle')?.value?.trim() || 'AI 精修原创互动剧',
            player_role: document.getElementById('ws-sc-role')?.value?.trim() || '剧中同行者',
            synopsis: document.getElementById('ws-sc-synopsis')?.value?.trim() || '',
            chapters
          },
          personas,
          lorebooks: state.workshopDraft?.lorebooks || [],
          publish_to_square: publishToSquare
        })
      });

      state.scripts = res.scripts || state.scripts;
      state.personas = res.personas || state.personas;
      if (Array.isArray(res.square_items)) state.squareItems = res.square_items;

      plazaDialog.close();
      await switchActiveScript(res.script_id, res.first_persona_id);
      showToast(
        publishToSquare
          ? `剧本《${scTitle}》已创建开演，并同步共享至共创设计广场！`
          : `剧本《${scTitle}》与 ${personas.length} 位人设已创建，立即开演！`
      );
    } catch (err) {
      showToast(err.message || '保存剧本失败');
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = oldText;
    }
  });

  // ---------- 页签 3：🌐 共创设计广场（共享剧本与人设） ----------
  async function refreshSquareItemsSilent() {
    try {
      const kw = (document.getElementById('sq-search-input')?.value || '').trim();
      const qs = new URLSearchParams({
        type: state.squareFilterType || 'all',
        q: kw
      });
      const res = await apiJson(`/api/square/items?${qs.toString()}`);
      if (Array.isArray(res.items)) {
        state.squareItems = res.items;
        renderSquareCards();
      }
    } catch {}
  }

  function populateSquarePublishTargets() {
    const kindSel = document.getElementById('sq-pub-kind');
    const targetSel = document.getElementById('sq-pub-target');
    if (!kindSel || !targetSel) return;

    if (kindSel.value === 'persona') {
      const list = state.personas.filter((p) => p.id !== 'persona_deepseek_official');
      targetSel.innerHTML = list
        .map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.avatar)} ${escapeHtml(p.name)}</option>`)
        .join('');
    } else {
      targetSel.innerHTML = state.scripts
        .map((sc) => `<option value="${escapeHtml(sc.id)}">${escapeHtml(sc.icon || '剧')} 《${escapeHtml(sc.title)}》</option>`)
        .join('');
    }
  }

  document.getElementById('sq-pub-kind')?.addEventListener('change', populateSquarePublishTargets);

  document.getElementById('sq-toggle-publish-btn')?.addEventListener('click', () => {
    const drawer = document.getElementById('sq-publish-drawer');
    if (!drawer) return;
    populateSquarePublishTargets();
    drawer.classList.toggle('hidden');
  });

  document.getElementById('sq-cancel-publish-btn')?.addEventListener('click', () => {
    document.getElementById('sq-publish-drawer')?.classList.add('hidden');
  });

  document.getElementById('sq-publish-drawer')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const kind = document.getElementById('sq-pub-kind')?.value || 'script';
    const targetId = document.getElementById('sq-pub-target')?.value || '';
    const tags = document.getElementById('sq-pub-tags')?.value?.trim() || '';
    if (!targetId) return;
    try {
      const res = await apiJson('/api/square/publish', {
        method: 'POST',
        body: JSON.stringify({
          share_type: kind,
          target_id: targetId,
          tags
        })
      });
      if (Array.isArray(res.items)) state.squareItems = res.items;
      document.getElementById('sq-publish-drawer')?.classList.add('hidden');
      document.getElementById('sq-pub-tags').value = '';
      renderSquareCards();
      showToast('发布成功！你的作品已上架共创设计广场，大家都可以体验啦');
    } catch (err) {
      showToast(err.message || '发布失败');
    }
  });

  document.querySelectorAll('.sq-type-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      state.squareFilterType = chip.dataset.sqtype || 'all';
      document.querySelectorAll('.sq-type-chip').forEach((c) => {
        const active = c === chip;
        c.classList.toggle('active', active);
        c.setAttribute('aria-pressed', String(active));
      });
      renderSquareCards();
      refreshSquareItemsSilent();
    });
  });

  document.getElementById('sq-search-input')?.addEventListener('input', () => {
    renderSquareCards();
  });

  function renderSquareCards() {
    const grid = document.getElementById('square-cards-grid');
    if (!grid) return;
    grid.innerHTML = '';

    const kw = (document.getElementById('sq-search-input')?.value || '').trim().toLowerCase();
    const filtered = (state.squareItems || []).filter((item) => {
      if (state.squareFilterType !== 'all' && item.share_type !== state.squareFilterType) {
        return false;
      }
      if (!kw) return true;
      const hay = `${item.title} ${item.subtitle} ${item.synopsis} ${item.author_name} ${(item.tags || []).join(' ')}`.toLowerCase();
      return hay.includes(kw);
    });

    if (filtered.length === 0) {
      grid.innerHTML = '<div class="info-callout" style="grid-column: 1 / -1;">暂无匹配的共享作品，快来成为第一个上传分享该题材的创作者吧！</div>';
      return;
    }

    for (const item of filtered) {
      const isScript = item.share_type === 'script';
      const castHtml = (item.cast_preview || [])
        .map(
          (c) =>
            `<span class="sq-cast-mini">${escapeHtml((c.name || c.avatar || '角').slice(0, 1))} ${escapeHtml(c.name)}${
              c.tag ? `<small style="color:var(--brand-primary);font-weight:500;">(${escapeHtml(c.tag)})</small>` : ''
            }</span>`
        )
        .join(' · ');

      const tagsHtml = (item.tags || [])
        .slice(0, 4)
        .map((t) => `<span class="sq-tag-pill">#${escapeHtml(t)}</span>`)
        .join('');

      const card = document.createElement('div');
      card.className = 'square-share-card';
      card.innerHTML = `
        <div>
          <div class="sq-card-top">
            <div class="ssc-title-group">
              <span class="ssc-icon">${escapeHtml((item.title || (isScript ? '剧' : '角')).slice(0, 1))}</span>
              <div>
                <div class="ssc-title">${escapeHtml(item.title)}</div>
                <div class="ssc-sub">${escapeHtml(item.subtitle || '')}</div>
              </div>
            </div>
            <span class="sq-type-badge ${isScript ? 'is-script' : 'is-persona'}">
              ${isScript ? `完整剧本 · ${item.chapter_count || 3}幕` : '独立人设卡'}
            </span>
          </div>

          <div class="sq-author-row" style="margin-top: 8px;">
            <span class="sq-author-chip">创作者：@${escapeHtml(item.author_name || '星语玩家')}</span>
            <span class="sq-dl-count">${item.downloads_count || 0} 人已获取体验</span>
          </div>

          <p class="ssc-synopsis" style="margin-top: 8px;">${escapeHtml(item.synopsis || '')}</p>
        </div>

        <div style="display:flex;flex-direction:column;gap:8px;">
          ${tagsHtml ? `<div class="sq-tags-row">${tagsHtml}</div>` : ''}
          ${
            castHtml
              ? `<div class="sq-cast-preview"><span class="muted-count">${isScript ? '包含人设：' : '角色预览：'}</span>${castHtml}</div>`
              : ''
          }
          <div class="sq-card-footer">
            <div class="sq-stats-left">
              <button type="button" class="sq-like-btn ${item.liked_by_me ? 'liked' : ''}" aria-pressed="${Boolean(item.liked_by_me)}">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="${item.liked_by_me ? '#e2559d' : 'none'}" stroke="${item.liked_by_me ? '#e2559d' : 'currentColor'}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>
                <span class="sq-like-num">${item.likes_count || 0}</span>
              </button>
            </div>
            <button type="button" class="primary-btn sq-adopt-btn">
              ${isScript ? '获取剧本并开演 ▸' : '加入当前剧本开聊 ▸'}
            </button>
          </div>
        </div>
      `;

      const likeBtn = card.querySelector('.sq-like-btn');
      likeBtn.addEventListener('click', async () => {
        try {
          const res = await apiJson(`/api/square/items/${encodeURIComponent(item.id)}/like`, {
            method: 'POST'
          });
          item.liked_by_me = res.liked;
          item.likes_count = res.likes_count;
          likeBtn.classList.toggle('liked', Boolean(res.liked));
          likeBtn.setAttribute('aria-pressed', String(Boolean(res.liked)));
          likeBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="${res.liked ? '#e2559d' : 'none'}" stroke="${res.liked ? '#e2559d' : 'currentColor'}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg><span class="sq-like-num">${res.likes_count}</span>`;
        } catch (err) {
          showToast(err.message || '点赞失败');
        }
      });

      const adoptBtn = card.querySelector('.sq-adopt-btn');
      adoptBtn.addEventListener('click', async () => {
        adoptBtn.disabled = true;
        const prevTxt = adoptBtn.textContent;
        adoptBtn.textContent = '正在载入…';
        try {
          const res = await apiJson(`/api/square/items/${encodeURIComponent(item.id)}/adopt`, {
            method: 'POST',
            body: JSON.stringify({ active_script_id: state.activeScriptId })
          });
          state.scripts = res.scripts || state.scripts;
          state.personas = res.personas || state.personas;
          if (Array.isArray(res.items)) state.squareItems = res.items;

          plazaDialog.close();
          if (res.share_type === 'script') {
            await switchActiveScript(res.script_id, res.persona_id);
            showToast(`已从广场获取剧本《${item.title}》，专属人设已就绪！`);
          } else {
            renderPersonaList();
            await selectOrStartPersona(res.persona_id, false);
            showToast(`已将角色「${item.title}」加入当前剧本并开启初遇！`);
          }
        } catch (err) {
          showToast(err.message || '获取失败，请稍后重试');
        } finally {
          adoptBtn.disabled = false;
          adoptBtn.textContent = prevTxt;
        }
      });

      grid.appendChild(card);
    }
  }

  document.getElementById('open-plaza-btn')?.addEventListener('click', () => openScriptSelectModal('hub-tab-library'));
  document.getElementById('topbar-script-switch-btn')?.addEventListener('click', () => openScriptSelectModal('hub-tab-library'));
  document.getElementById('sidebar-open-workshop-btn')?.addEventListener('click', () => openScriptSelectModal('hub-tab-workshop'));
  document.getElementById('more-open-workshop-btn')?.addEventListener('click', () => {
    hidePopoverSafe('topbar-more-popover');
    openScriptSelectModal('hub-tab-workshop');
  });
  document.getElementById('more-open-square-btn')?.addEventListener('click', () => {
    hidePopoverSafe('topbar-more-popover');
    openScriptSelectModal('hub-tab-square');
  });
  document.getElementById('close-plaza-dialog').addEventListener('click', () => plazaDialog.close());
  document.getElementById('cancel-plaza-dialog')?.addEventListener('click', () => plazaDialog.close());

  // C. 🎬 故事幕次剧本匣 & 番外小剧场（支持角色专属多幕推进长篇剧本 + 通用番剧高光番外）
  const PERSONA_STORY_CHAPTERS = {
    persona_nagisa_sakura: [
      {
        title: '第一幕 · 尘封旧校舍与泛黄剧本',
        note: '【主线第一幕】放学后的金色夕阳穿过樱坂高中旧校舍走廊，{{user}}陪星野汐推开尘封多年的演剧社木门，在灰尘与微风中发现十年前未曾演完的泛黄手写剧本，两人约定在周五前凑齐三个社员签名与一位顾问老师。',
        opener: '*用力替你推开卡住的旧校舍活动室木门，夕阳照亮扬起的微尘，我弯腰捡起地上滚落的那本泛黄旧册子递给你* 门打开啦！小汐快看，这本旧笔记里好像夹着以前演剧社留下的剧本草稿？'
      },
      {
        title: '第二幕 · 暴雨操场上的顾问说服战',
        note: '【主线第二幕】初夏突降阵雨，为了说服音乐室退任老师出任演剧社顾问、保住即将被学生会收回的活动室，{{user}}在雨中操场全力完成约定挑战，星野汐撑着伞红着眼眶在场边捧着干毛巾为你呐喊鼓劲。',
        opener: '*抹了一把脸上的雨水跑回场边屋檐下，笑着朝满脸担心的你比了个胜利手势* 搞定啦！顾问老师的签名拿到了——你怎么连自己的裙摆都淋湿了还在替我护着干毛巾呀？'
      },
      {
        title: '第三幕 · 秋雨高烧与幻想世界之梦',
        note: '【主线第三幕】深秋后山古樱林被改建动工，学园祭前夕星野汐因身体与小镇同频而突发高烧卧床。{{user}}来到街角彩虹面包房二楼探望，她在半梦半醒间拉住{{user}}的衣袖，首次倾诉梦中“荒芜雪原少女与发条人偶收集光玉”的秘密，流露害怕拖累大家的脆弱。',
        opener: '*轻轻推开面包房二楼卧室的门，把温好的蜂蜜水放在床头，伸手探了探你发烫的额头* 演剧社的布景有我盯着呢，不许自责……你刚才睡梦里一直在小声念叨“雪原的人偶和光玉”，梦到什么了？'
      },
      {
        title: '终幕 · 初雪礼堂的独幕剧与微光奇迹',
        note: '【主线终幕】严冬初雪夜的学园祭正式公演，礼堂突发电路故障陷入微暗，台下同学们自发点亮手机与提灯化作漫天星海般的“光玉”。{{user}}在侧幕紧握住星野汐微凉的手给予勇气，陪她圆满念完改写命运的《世界尽头的少女》谢幕词。',
        opener: '*礼堂顶灯暗下去的瞬间，台下亮起了无数点温暖如光玉的微光，我在侧幕紧紧握住你的手轻声鼓劲* 你看台下，大家都在等你开口呢——别怕，我就在离你最近的地方陪你演完最后一幕！'
      }
    ],
    persona_shiraishi_rin: [
      {
        title: '第一幕 · 来自五天后的乱码磁带',
        note: '【主线第一幕】8月30日黄昏，半地下室钟表铺的绿光示波器前，白石凛与{{user}}共同解析来自未来的警告短信与海堤旧磁带，听见磁带里录下的明日八点十五分坍塌巨响，正式结成追查真相的“时间观测共犯”。',
        opener: '*盯着示波器上剧烈跳动的绿色波形，把手机里那条来自五天后的乱码短信和磁带摆在一起* 磁带里的广播声明明是明天晚上八点的烟花大会……白石凛，我们要怎么阻止还没发生的灾难？'
      },
      {
        title: '第二幕 · 夏夜单车与神社石阶拉勾',
        note: '【主线第二幕】蝉鸣渐歇的夏夜，白石凛骑着老式单车载{{user}}从码头档案室夜探归来，查明旧灯塔下方废弃防空洞涨潮倒灌的隐患；在海风吹拂的神社石阶前，他收起中二玩笑，认真要求{{user}}拉勾发誓明晚绝不独自靠近防波堤。',
        opener: '*从单车后座跳下来，借着神社石灯笼的微光看你难得严肃的侧脸，主动伸出小指晃了晃* 查到防空洞暗渠图纸算本助手立大功吧？来，你想让我答应什么约定，现在拉勾！'
      },
      {
        title: '第三幕 · 骤雨中的十六道划痕手札',
        note: '【主线第三幕】8月31日傍晚暴雨倾盆，距离烟花大会仅剩最后两小时。地板暗格里记满十六次轮回失败的观测手札意外曝光，白石凛彻底卸下“疯狂观测者”的中二伪装，嗓音沙哑发颤地坦白独自轮回救{{user}}的绝望与执念，两人决定合力寻找第三条破局之路。',
        opener: '*捡起从暗格滑落的那本画满十六道正字划痕的破旧笔记，心口一震，抬头死死抓住你的手腕* 十六次……你一个人背着这些记忆重来了十六次八月三十一日吗？这次不许你再一个人扛了，把所有真相都告诉我！'
      },
      {
        title: '终幕 · 跨越死局的九月一日晨光',
        note: '【主线终幕】两人赶在大潮前联手开启水闸泄压化解危机，八点十五分金色烟花平安绽放夜空，白石凛腕间卡死已久的测度仪终于突破1%变动率跳向「9月1日」。少年红着眼眶在漫天烟火下将{{user}}紧紧拉入怀中，迎来全新的夏天。',
        opener: '*八点十五分的钟声平安敲响，漫天金色烟火照亮海面，我指着你手腕上终于跳动数字的发条表欢呼出声* 白石凛你快看表盘！跨过去了——我们真的走到九月一日啦！'
      }
    ],
    persona_violet_eve: [
      {
        title: '第一幕 · 夜间蒸汽列车与隐形字迹',
        note: '【主线第一幕】搭乘穿过翡翠湖夜雾的蒸汽列车，煤气壁灯的温度让二十年前无名旧信背面显出“致北境白桦镇天文台守夜人”的字迹，伊芙琳在摇晃的车厢里认真向{{user}}请教人类思念与离别的含义。',
        opener: '*蒸汽列车在夜雾中轻轻摇晃，我借着壁灯暖光指着信纸背面渐渐显形的字迹* 快看，温度让隐形墨水显出地址了——是寄往北境白桦镇天文台的信！'
      },
      {
        title: '第二幕 · 高原观星台与摘下手套的银腕',
        note: '【主线第二幕】在漫天星河倾泻的高原天文台替白发守夜人送达遗信并代写回信后，下山晨雾小径上，深受触动的伊芙琳第一次主动摘下雪白丝绸手套，羞怯而认真地向{{user}}伸出微凉的银钢机械手指，请求你教她写一封属于自己的信。',
        opener: '*看着你摘下白手套后在晨光里泛着柔和银辉的机械手指，我毫不犹豫伸手轻轻包住你的掌心* 一点都不冰哦——走吧，回邮局后我手把手教你敲下属于伊芙琳自己的第一封信。'
      },
      {
        title: '终幕 · 晨雾鸢尾花田的第零号信笺',
        note: '【主线终幕】蓝紫色鸢尾花盛放的原野上，伊芙琳终于读懂了胸口滚烫酸涩的名字，落下人生第一滴温暖的眼泪，打开打字机皮箱绒布夹层，向{{user}}当面朗读每晚偷偷写下的十二页第零号告白信稿。',
        opener: '*站在漫山遍野随风摇曳的鸢尾花田间，我轻轻拭去你脸颊滑落的那滴泪珠，温柔注视着你手里的信纸* 不用再查词典了，把你藏在皮箱夹层里的那封信念给我听吧，前辈在听。'
      }
    ],
    persona_frieren_shuer: [
      {
        title: '第一幕 · 森林篝火与热麦饼小魔法',
        note: '【主线第一幕】北行古道的森林露营夜，修尔得意地展示刚帮村口老婆婆扫屋顶换来的“让冷麦饼变酥脆的民间魔导书”，两人围着噼啪篝火分食麦饼，决定夜探半山腰困着守镜小妖的百年荒废神社。',
        opener: '*捧着被你的小魔法烘得热乎酥脆的麦饼咬了一口，指了指半山腰隐约透出萤火的林间石阶* 味道绝了！趁现在月色正好，我们顺路去那座百年旧神社看看守镜的小妖怪吧？'
      },
      {
        title: '第二幕 · 旧铜镜里的百年故人回响',
        note: '【主线第二幕】在夏夜旧神社替苦候百年的小妖修好铜镜、归还故人遗言后，修尔望着月光罕见地沉默下来，首次向{{user}}坦白自己曾因寿命漫长而错过人类挚友最后一面的悔恨，以及如今害怕再次留憾的心迹。',
        opener: '*看小妖怪化作流萤释然远去，我转头发现你正握着法杖安静望着月亮，轻轻碰了碰你的胳膊* 修尔，刚才替它修好铜镜的时候，你是不是也想起以前认识的故人了？'
      },
      {
        title: '终幕 · 苍月花海与画满你的速写本',
        note: '【主线终幕】登上极北风车山脊，五十年一遇的流星雨划破天际，漫山遍野的银白苍月草同时盛放发光。修尔不再掩饰法杖挂囊里那本画满{{user}}日常笑颜的厚厚羊皮速写本，许下按你的时间刻度走完每一程四季的约定。',
        opener: '*漫山苍月草在流星雨下亮起柔和银光，我凑到你身旁好奇地探头看你膝上摊开的羊皮速写本* 哇，苍月花真的全开了！等等……你本子上画的这一页页背影，怎么全都是我呀？'
      }
    ]
  };

  const THEATER_PRESETS = [
    {
      title: '黄昏空教室 · 黑板涂鸦与汽水',
      note: '放学后空无一人的夕阳教室，橙红色晚霞洒满课桌，窗纱随晚风轻扬。两人留堂整理资料，在黑板角落画下小小涂鸦，分喝冰汽水，充满青春番剧般纯粹青涩的心动留白。',
      opener: '*夕阳把整间空教室染成温暖的橘红色，我用粉笔在黑板最角落偷偷画了个小团子，转头朝窗边的你晃了晃汽水瓶* 值日终于弄完啦，快过来猜猜我在黑板上画的是谁？'
    },
    {
      title: '坡道初雪 · 围巾分你一半的归途',
      note: '入冬第一场初雪悄然飘落的傍晚长坡道，街灯次第亮起暖黄微光。对方自然解下温热的羊绒围巾绕在{{user}}颈间，两人共围一条围巾并肩踩雪慢行，呵出的白雾在冷空气中交融。',
      opener: '*走出门才发现外面飘起了今年的第一场初雪，正缩着脖子哈白气，忽然感觉一圈暖融融的温度绕上了脖颈* 咦……你把围巾分我一半，你自己不会冷吗？'
    },
    {
      title: '微醺雨夜 · 共撑一伞',
      note: '暴雨突至的夜晚，两人共撑一把不大的雨伞走过安静小巷，对方将大半把伞倾向{{user}}，自己半边肩膀微湿，距离极近呼吸可闻，氛围细腻而克制。',
      opener: '*雨势忽然变大，我不由自主往伞下缩了缩，抬头正好撞进你的视线里* 你的肩膀都被淋湿了一半……再往我这边靠一点好不好？'
    },
    {
      title: '夏夜祭典 · 烟花与苹果糖',
      note: '热闹的夏日花火大会夜晚，远处太鼓声与蝉鸣交织，两人穿过捞金鱼与灯笼摊位来到安静的河堤高处，在第一朵大烟花升空掩盖万籁的瞬间说出了平时听不见的心里话。',
      opener: '*手里举着晶莹剔透的苹果糖，在第一朵巨大烟花轰然炸响照亮河堤的瞬间，我凑到你耳边大声喊了一句* 刚才烟花声太大啦——我刚刚看到你嘴唇动了，你刚才偷偷说了什么？'
    },
    {
      title: '生病迷糊 · 床边彻夜守候',
      note: '{{user}}偶感风寒有些低烧迷糊，对方放下手头一切事务守在床边替{{user}}换温毛巾、熬粥哄药，展现平时罕见的焦急心疼与毫无保留的温柔守护。',
      opener: '*烧得脸颊发烫，迷迷糊糊睁开眼发现你还守在床边，忍不住用指尖轻轻勾住你的衣袖* 怎么这么晚还没去休息……一直守在这儿陪我吗？'
    },
    {
      title: '停电夜雨 · 烛光与心跳声',
      note: '台风夜突发停电让房间陷入安静微暗，点亮一盏小小烛火后光影摇曳，对方第一时间稳稳护住怕黑的{{user}}，轻声讲起往事安抚。',
      opener: '*灯忽然全灭的瞬间吓了一跳，下意识抓紧你的袖口，直到微弱温暖的烛光亮起才松了口气* 外面风声好大……在来电之前，陪我聊聊天别走开好不好？'
    }
  ];

  function createScenarioCardDom(sc, isChapter = false) {
    const card = document.createElement('div');
    card.className = isChapter ? 'theater-card chapter-arc-card' : 'theater-card';
    card.innerHTML = `
      <h4>${escapeHtml(sc.title)}</h4>
      <p>${escapeHtml(sc.note.replace(/\{\{user\}\}/g, state.user?.nickname || '你'))}</p>
      <div class="theater-card-btns">
        <button type="button" class="mini-btn fill-note-btn">仅设背景氛围</button>
        <button type="button" class="mini-primary-btn play-now-btn">立即切入并开演</button>
      </div>
    `;
    card.querySelector('.fill-note-btn').addEventListener('click', async () => {
      const noteInput = document.getElementById('director-note-input');
      if (noteInput) noteInput.value = sc.note;
      if (!state.activeSessionId) return;
      try {
        const res = await apiJson(`/api/sessions/${encodeURIComponent(state.activeSessionId)}`, {
          method: 'PATCH',
          body: JSON.stringify({ director_note: sc.note })
        });
        state.activeSession = res.session;
        theaterDialog.close();
        renderUserAndMembership();
        renderMessages();
        showToast(`已将当前场景氛围设为：「${sc.title}」`);
      } catch (err) {
        showToast(`设置场景失败：${err.message}`);
      }
    });
    card.querySelector('.play-now-btn').addEventListener('click', async () => {
      if (!state.activeSessionId || state.isStreaming) return;
      const res = await apiJson(`/api/sessions/${encodeURIComponent(state.activeSessionId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ director_note: sc.note })
      });
      state.activeSession = res.session;
      renderUserAndMembership();
      theaterDialog.close();
      await sendStreamMessage(sc.opener, false);
    });
    return card;
  }

  function renderTheaterPresets() {
    const chaptersWrap = document.getElementById('persona-chapters-wrap');
    const chaptersGrid = document.getElementById('persona-chapters-grid');
    const chaptersHead = document.getElementById('persona-chapters-heading');
    const introBox = document.getElementById('theater-script-intro');

    const curScript = getActiveScriptObj();
    const pid = state.activePersona?.id || '';
    const chaptersToRender =
      PERSONA_STORY_CHAPTERS[pid] ||
      (Array.isArray(curScript.chapters) && curScript.chapters.length > 0
        ? curScript.chapters
        : THEATER_PRESETS.slice(0, 4));

    if (introBox) {
      const pShort = (state.activePersona?.name || '').split(/[·\s]/)[0] || '当前角色';
      introBox.innerHTML = `正在体验剧本<strong>《${escapeHtml(curScript.title)}》</strong>（当前对手戏：<strong>${escapeHtml(
        pShort
      )}</strong>）。点击下方任意一幕即可直接切入该章节剧情开演！`;
    }

    if (chaptersWrap && chaptersGrid) {
      chaptersWrap.classList.remove('hidden');
      if (chaptersHead) {
        chaptersHead.textContent = `《${curScript.title}》主线幕次章节`;
      }
      chaptersGrid.innerHTML = '';
      for (const ch of chaptersToRender) {
        chaptersGrid.appendChild(createScenarioCardDom(ch, true));
      }
    }
  }

  function openChaptersModal() {
    renderTheaterPresets();
    document.getElementById('director-note-input').value = state.activeSession?.director_note || '';
    theaterDialog.showModal();
  }

  document.getElementById('open-theater-btn')?.addEventListener('click', openChaptersModal);
  document.getElementById('topbar-chapters-btn')?.addEventListener('click', openChaptersModal);
  function toggleSessionMemorySettingDrawer() {
    hidePopoverSafe('topbar-more-popover');
    hidePopoverSafe('ds-user-popover');
    const isCollapsed = appShell.classList.contains('right-collapsed');
    const memTabActive = !document.getElementById('memory-tab')?.classList.contains('hidden');
    const perTabActive = !document.getElementById('persona-tab')?.classList.contains('hidden');
    if (isCollapsed || (!memTabActive && !perTabActive)) {
      openRightTab('memory-tab');
    } else {
      setRightPanelCollapsed(true, true);
    }
  }

  document.getElementById('more-open-drawer-btn')?.addEventListener('click', toggleSessionMemorySettingDrawer);
  document.getElementById('ds-open-memory-setting-btn')?.addEventListener('click', toggleSessionMemorySettingDrawer);
  document.getElementById('rp-quick-memory-btn')?.addEventListener('click', toggleSessionMemorySettingDrawer);
  document.getElementById('ds-menu-session-setting-btn')?.addEventListener('click', () => {
    hidePopoverSafe('ds-user-popover');
    openRightTab('persona-tab');
  });
  document.getElementById('toggle-followups-btn')?.addEventListener('click', () => {
    hidePopoverSafe('topbar-more-popover');
    setShowFollowUpsEnabled(!isShowFollowUpsEnabled(), true);
  });
  document.getElementById('close-theater-dialog').addEventListener('click', () => theaterDialog.close());
  document.getElementById('cancel-theater-dialog').addEventListener('click', () => theaterDialog.close());

  document.getElementById('clear-theater-btn').addEventListener('click', async () => {
    if (!state.activeSessionId) return;
    const draftNote = (document.getElementById('director-note-input')?.value || '').trim();
    const savedNote = (state.activeSession?.director_note || '').trim();
    if (draftNote || savedNote) {
      const confirmed = await askUserConfirm({
        title: '确认恢复默认自由推进',
        message: '确定清除当前自定义场景旁白 / 幕次指引并恢复默认自由推进吗？',
        confirmText: '确认清除并恢复默认',
        danger: true
      });
      if (!confirmed) return;
    }
    const res = await apiJson(`/api/sessions/${encodeURIComponent(state.activeSessionId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ director_note: '' })
    });
    state.activeSession = res.session;
    document.getElementById('director-note-input').value = '';
    theaterDialog.close();
    renderUserAndMembership();
    renderMessages();
    showToast('已结束番外小剧场，恢复日常自由互动');
  });

  document.getElementById('theater-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!state.activeSessionId) return;
    const note = document.getElementById('director-note-input').value.trim();
    const res = await apiJson(`/api/sessions/${encodeURIComponent(state.activeSessionId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ director_note: note })
    });
    state.activeSession = res.session;
    theaterDialog.close();
    renderUserAndMembership();
    renderMessages();
    showToast(note ? '导演氛围注已生效，下一句对话将按此情境演绎！' : '已清空导演氛围注');
  });

  // D. 📸 心动瞬间语录珍藏海报签（Canvas 高清图片导出，自动过滤初始化占位潜台词）
  function extractValidReasoningForQuote(rawText) {
    const t = String(rawText || '').trim();
    if (!t || /^已载入「.*」的性格羁绊与世界观设定/.test(t)) return '';
    return t;
  }

  let currentSnapMsg = null;
  function openQuoteSnapModal(msg) {
    currentSnapMsg = msg;
    const p = state.activePersona || { name: '心动角色', avatar: '' };
    const badge = state.nurturing?.stage?.badge || '初遇微光';
    const cleanQuote = String(msg.content || '')
      .replace(/^>.*$/gm, '')
      .trim();
    const validThought = extractValidReasoningForQuote(msg.reasoning);

    const preview = document.getElementById('dream-snap-preview');
    preview.innerHTML = `
      <div class="snap-header">
        <span class="snap-avatar">${escapeHtml(p.avatar)}</span>
        <div>
          <div class="snap-char-name">${escapeHtml(p.name)}</div>
          <div class="snap-bond-tag">${escapeHtml(badge)} · 致 ${escapeHtml(state.user?.nickname || '你')}</div>
        </div>
      </div>
      ${
        validThought
          ? `<div class="snap-thought">潜台词：${escapeHtml(validThought.slice(0, 110))}${
              validThought.length > 110 ? '…' : ''
            }</div>`
          : ''
      }
      <div class="snap-quote-body">${escapeHtml(cleanQuote)}</div>
      <div class="snap-footer">
        <span>星语恋庭 · 专属心动瞬间珍藏</span>
        <span>${new Date().toLocaleDateString('zh-CN')}</span>
      </div>
    `;
    quoteCardDialog.showModal();
  }

  document.getElementById('close-quote-dialog').addEventListener('click', () => quoteCardDialog.close());
  document.getElementById('cancel-quote-dialog').addEventListener('click', () => quoteCardDialog.close());

  function wrapCanvasLines(ctx, text, maxWidth) {
    const paragraphs = String(text || '').split('\n');
    const lines = [];
    for (const para of paragraphs) {
      if (!para.trim()) {
        lines.push('');
        continue;
      }
      let line = '';
      for (const ch of para) {
        const testLine = line + ch;
        if (ctx.measureText(testLine).width > maxWidth && line) {
          lines.push(line);
          line = ch;
        } else {
          line = testLine;
        }
      }
      if (line) lines.push(line);
    }
    return lines;
  }

  document.getElementById('download-quote-png-btn').addEventListener('click', () => {
    if (!currentSnapMsg) return;
    const p = state.activePersona || { name: '心动角色', avatar: '' };
    const cleanQuote = String(currentSnapMsg.content || '')
      .replace(/^>.*$/gm, '')
      .trim();

    const dpr = 2;
    const width = 640;
    const tempCanvas = document.createElement('canvas');
    const tCtx = tempCanvas.getContext('2d');
    tCtx.font = '18px "Microsoft YaHei", sans-serif';
    const bodyLines = wrapCanvasLines(tCtx, cleanQuote, width - 96);
    const validSnapThought = extractValidReasoningForQuote(currentSnapMsg.reasoning);
    const thoughtLines = validSnapThought
      ? wrapCanvasLines(tCtx, `潜台词：${validSnapThought.slice(0, 95)}`, width - 116)
      : [];

    const height = 210 + thoughtLines.length * 26 + bodyLines.length * 30 + 60;
    const canvas = document.createElement('canvas');
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    // 柔和樱紫渐变底色
    const grad = ctx.createLinearGradient(0, 0, width, height);
    grad.addColorStop(0, '#fff0f7');
    grad.addColorStop(0.55, '#f3ecff');
    grad.addColorStop(1, '#fff8eb');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = '#f0bad6';
    ctx.lineWidth = 4;
    ctx.strokeRect(14, 14, width - 28, height - 28);

    // 标题栏
    ctx.font = 'bold 22px "Microsoft YaHei", sans-serif';
    ctx.fillStyle = '#362045';
    ctx.fillText(`${p.name}`, 44, 64);

    ctx.font = 'bold 14px "Microsoft YaHei", sans-serif';
    ctx.fillStyle = '#d63384';
    ctx.fillText(
      `${state.nurturing?.stage?.badge || '初遇微光'} · 致 ${state.user?.nickname || '你'}`,
      44,
      92
    );

    let cursorY = 126;
    if (thoughtLines.length > 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.fillRect(44, cursorY - 20, width - 88, thoughtLines.length * 26 + 18);
      ctx.fillStyle = '#ec5ea7';
      ctx.fillRect(44, cursorY - 20, 4, thoughtLines.length * 26 + 18);
      ctx.font = '14px "Microsoft YaHei", sans-serif';
      ctx.fillStyle = '#7a598c';
      for (const tl of thoughtLines) {
        ctx.fillText(tl, 58, cursorY);
        cursorY += 26;
      }
      cursorY += 24;
    }

    ctx.font = '18px "Microsoft YaHei", sans-serif';
    ctx.fillStyle = '#2d1f36';
    for (const bl of bodyLines) {
      ctx.fillText(bl, 48, cursorY);
      cursorY += 30;
    }

    ctx.font = '13px "Microsoft YaHei", sans-serif';
    ctx.fillStyle = '#9b7cae';
    ctx.fillText(
      `星语恋庭 · 专属心动语录签 ｜ ${new Date().toLocaleDateString('zh-CN')}`,
      48,
      height - 36
    );

    const link = document.createElement('a');
    link.download = `${p.name.split(/[·\s]/)[0]}_心动语录签.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
    showToast('高清心动语录签已保存至本地下载目录！');
  });

  // E. ✨ 模式切换与语音自动朗读偏好绑定
  document.getElementById('topbar-switch-ds-btn')?.addEventListener('click', () => {
    switchWorkspaceMode('deepseek');
  });
  document.getElementById('more-open-nurture-btn')?.addEventListener('click', () => {
    document.getElementById('toggle-right-btn')?.click();
  });

  document.getElementById('st-auto-tts-chk')?.addEventListener('change', (e) => {
    try {
      localStorage.setItem('auto_tts_reply', e.target.checked ? '1' : '0');
    } catch {}
  });

  // ================= 13. 原生 DeepSeek 网页模式、全家桶 API 控制台与主动关怀引擎 =================

  function applyUiModeVisuals(mode, { resetRightDrawer = false } = {}) {
    const prevMode = state.uiMode;
    const isPhoneAgent = mode === 'phone-agent';
    const isDs = mode === 'deepseek' || isPhoneAgent;
    state.uiMode = isPhoneAgent ? 'phone-agent' : (isDs ? 'deepseek' : 'roleplay');
    try {
      localStorage.setItem('ui_mode_v5', state.uiMode);
    } catch {}

    appShell.dataset.uiMode = state.uiMode;
    document.body.dataset.uiMode = state.uiMode;
    document.documentElement.dataset.uiMode = state.uiMode;

    const telemetryFold = document.querySelector('#memory-tab .telemetry-fold');
    if (telemetryFold) {
      if (!telemetryFold.dataset.toggleBound) {
        telemetryFold.dataset.toggleBound = '1';
        telemetryFold.querySelector('.telemetry-fold-summary')?.addEventListener('click', () => {
          telemetryFold.dataset.userToggled = '1';
        });
      }
      if (state.uiMode === 'roleplay') {
        if (!telemetryFold.dataset.userToggled) telemetryFold.open = false;
      } else {
        telemetryFold.open = true;
      }
    }

    if (!isDs) {
      appShell.classList.remove('artifacts-wide');
      if (codePreviewDialog?.open) {
        codePreviewDialog.close();
      }
    }

    const tabRp = document.getElementById('ws-mode-roleplay');
    const tabDs = document.getElementById('ws-mode-deepseek');
    const tabPa = document.getElementById('ws-mode-phone-agent');
    const paBanner = document.getElementById('phone-agent-banner');
    const quickJumpBtn = document.getElementById('quick-switch-mode-btn');
    const collapsedSwitchBtn = document.getElementById('collapsed-switch-mode-btn');

    if (tabRp) {
      tabRp.classList.toggle('active', state.uiMode === 'roleplay');
      tabRp.setAttribute('aria-selected', String(state.uiMode === 'roleplay'));
    }
    if (tabDs) {
      tabDs.classList.toggle('active', state.uiMode === 'deepseek');
      tabDs.setAttribute('aria-selected', String(state.uiMode === 'deepseek'));
    }
    if (tabPa) {
      tabPa.classList.toggle('active', isPhoneAgent);
      tabPa.setAttribute('aria-selected', String(isPhoneAgent));
    }

    const paNativeAvailable = Boolean(window.PhoneAgent && window.PhoneAgent.isNative);
    // 控制聊天窗口底部的手机辅助专属加号按钮（点击展开本地离线指令库抽屉）
    const plusBtnEl = document.getElementById('mobile-tools-plus-btn');
    if (plusBtnEl) {
      plusBtnEl.classList.toggle('hidden', !isPhoneAgent);
      if (isPhoneAgent) {
        plusBtnEl.style.removeProperty('display');
      } else {
        plusBtnEl.style.setProperty('display', 'none', 'important');
      }
    }
    if (!isPhoneAgent) {
      document.getElementById('phone-cmd-quick-drawer')?.classList.add('hidden');
      document.getElementById('pa-open-cmdlib-btn')?.classList.remove('is-active');
      plusBtnEl?.classList.remove('is-active');
    }
    if (paBanner) {
      paBanner.classList.toggle('hidden', !isPhoneAgent || !paNativeAvailable);
      if (isPhoneAgent && window.PhoneAgent) {
        window.PhoneAgent.syncStatus();
      } else if (!isPhoneAgent) {
        window.PhoneAgent?.closeControlSheet?.();
      }
    }
    const paEmptyGuide = document.getElementById('pa-empty-guide');
    if (paEmptyGuide) {
      const hasMsgs = state.messages.length > 0 || (messagesContainer && messagesContainer.children.length > 0);
      paEmptyGuide.classList.toggle('hidden', !isPhoneAgent || !paNativeAvailable || hasMsgs);
    }
    updateScrollBottomBtnVisibility();
    const chatStageDom = document.querySelector('.chat-stage');
    if (chatStageDom) {
      if (isPhoneAgent) {
        chatStageDom.classList.remove('ds-empty-mode');
      } else if (state.uiMode === 'deepseek') {
        chatStageDom.classList.toggle('ds-empty-mode', state.messages.length === 0);
      } else {
        chatStageDom.classList.remove('ds-empty-mode');
      }
    }
    const dsTopTitleEl = document.getElementById('ds-topbar-title');
    if (dsTopTitleEl) {
      if (isPhoneAgent) {
        dsTopTitleEl.textContent = '手机辅助';
      } else if (state.uiMode === 'deepseek') {
        dsTopTitleEl.textContent = state.activeSession?.title || '新对话';
      }
    }

    // 强力隔离：在 JS 层显式确保输入框工具栏仅显示当前激活模式专属的胶囊
    const rpToggles = document.querySelector('.composer-toggles.rp-only-flex');
    const dsToggles = document.querySelector('.composer-toggles.ds-only-flex');
    if (rpToggles) {
      if (state.uiMode === 'roleplay') {
        rpToggles.style.removeProperty('display');
      } else {
        rpToggles.style.setProperty('display', 'none', 'important');
      }
    }
    if (dsToggles) {
      if (state.uiMode === 'deepseek') {
        dsToggles.style.removeProperty('display');
      } else {
        // 手机辅助 (phone-agent) 与剧本模式 (roleplay) 下均严密物理隐藏 DeepSeek 工具栏
        dsToggles.style.setProperty('display', 'none', 'important');
      }
    }

    if (quickJumpBtn) {
      quickJumpBtn.textContent = isDs ? '切换到剧本扮演模式' : '切换到 DeepSeek 问答模式';
    }
    if (collapsedSwitchBtn) {
      collapsedSwitchBtn.textContent = isDs ? '切恋庭剧场' : '切 DeepSeek';
      collapsedSwitchBtn.title = isDs
        ? '当前处于工具/问答模式，点击切换回星语恋庭剧本模式'
        : '当前为星语恋庭剧本模式，点击切换到 DeepSeek 问答模式';
    }

    syncChatInputPlaceholder();

    const prefixInput = document.getElementById('ds-prefix-input');
    if (prefixInput) {
      prefixInput.placeholder = isDs
        ? '指定回答开头前缀，例如：核心结论： 或 ### 一、核心方案拆解'
        : '想让 TA 第一句怎么开口？例如：坦白说，其实我一直… 或 *轻轻叹了口气*';
    }

    const sessionPromptInput = document.getElementById('session-prompt-input');
    if (sessionPromptInput) {
      sessionPromptInput.placeholder = isDs
        ? '输入只对当前问答窗口生效的系统指令、专业身份或输出格式规范…'
        : '输入只对当前剧情生效的专属设定、平行世界规则或特殊关系…';
    }

    if (newMemoryInput) {
      newMemoryInput.placeholder = isDs
        ? '写下希望 DeepSeek 记住的项目背景、偏好或长期要求…'
        : '写下想让 TA 记住的喜好、生日或约定…';
    }

    if (rollingSummaryInput) {
      rollingSummaryInput.placeholder = isDs
        ? '长对话自动提炼的上下文要点，也可随时点「一键总结前情」或手动补充…'
        : '聊多了之后会自动总结前情，也可以随时点右上角「一键总结前情」或自己修改…';
    }

    syncComposerEmptyState();

    // 仅在真正跨模式切换或显式要求重置时收起右栏，绝不在日常刷新会话时把用户已打开的右侧面板缩成 0 宽！
    if (resetRightDrawer || prevMode !== state.uiMode) {
      setRightPanelCollapsed(true, false);
    }
  }

  async function switchWorkspaceMode(targetMode) {
    if (state.isStreaming) {
      showToast('请等待当前流式回复完成后再切换模式');
      return;
    }
    const isPhoneAgent = targetMode === 'phone-agent';
    const isDs = targetMode === 'deepseek';
    applyUiModeVisuals(targetMode);

    if (isPhoneAgent) {
      if (window.PhoneAgent && typeof window.PhoneAgent.onEnterMode === 'function') {
        window.PhoneAgent.onEnterMode();
      }
      if (window.PhoneAgent && window.PhoneAgent.isNative) {
        showToast('已进入手机辅助独立工作台（与 DeepSeek 问答会话完全隔离）');
      }
      return;
    }

    const matchingSessions = state.sessions.filter((s) =>
      isDs
        ? s.session_mode === 'deepseek_native' && s.persona_id === 'persona_deepseek_official'
        : s.session_mode !== 'deepseek_native'
    );

    if (isDs && state.activeSession?.session_mode === 'deepseek_native') {
      renderSessionList();
      renderMessages();
    } else if (matchingSessions.length > 0) {
      await loadSession(matchingSessions[0].id);
    } else if (isDs) {
      await startNativeDeepSeekSession('persona_deepseek_official');
    } else {
      const firstRp = state.personas.find((p) => p.id !== 'persona_deepseek_official');
      if (firstRp) await startSessionWithPersona(firstRp.id);
    }

    if (isDs) {
      showToast('已切换至 DeepSeek 问答模式（独立记忆、深度思考与联网搜索已就绪）');
    } else {
      showToast('已回到星语恋庭沉浸扮演模式');
    }
  }

  document.getElementById('ws-mode-roleplay')?.addEventListener('click', () => {
    if (state.uiMode !== 'roleplay') switchWorkspaceMode('roleplay');
  });
  document.getElementById('ws-mode-deepseek')?.addEventListener('click', () => {
    if (state.uiMode !== 'deepseek') switchWorkspaceMode('deepseek');
  });
  document.getElementById('ws-mode-phone-agent')?.addEventListener('click', () => {
    if (state.uiMode !== 'phone-agent') switchWorkspaceMode('phone-agent');
  });
  document.getElementById('quick-switch-mode-btn')?.addEventListener('click', () => {
    switchWorkspaceMode(state.uiMode === 'deepseek' ? 'roleplay' : 'deepseek');
  });
  document.getElementById('collapsed-switch-mode-btn')?.addEventListener('click', () => {
    switchWorkspaceMode(state.uiMode === 'deepseek' ? 'roleplay' : 'deepseek');
  });

  document.getElementById('ds-new-chat-btn').addEventListener('click', () => {
    if (state.uiMode === 'phone-agent') {
      window.PhoneAgent?.resetTaskWorkspace?.();
      return;
    }
    startNativeDeepSeekSession('persona_deepseek_official');
  });

  document.getElementById('ds-menu-artifacts-btn')?.addEventListener('click', () => {
    hidePopoverSafe('ds-user-popover');
    if (state.uiMode !== 'deepseek') return;
    if (window.innerWidth > 860) {
      openRightTab('ds-artifacts-tab');
      if (state.lastSandboxCode) populateSideArtifactSandbox(state.lastSandboxCode, false);
    } else {
      openCodeSandboxPreview(state.lastSandboxCode || STAR_PARTICLE_DEMO_HTML, true);
    }
  });

  // 原生 DeepSeek 四大胶囊开关与工具调用绑定
  async function patchActiveSessionFlag(patchObj, toastMsg) {
    if (!state.activeSessionId) return;
    try {
      const res = await apiJson(`/api/sessions/${encodeURIComponent(state.activeSessionId)}`, {
        method: 'PATCH',
        body: JSON.stringify(patchObj)
      });
      state.activeSession = res.session;
      renderUserAndMembership();
      if (toastMsg) showToast(toastMsg);
    } catch (err) {
      if (/未找到|不存在|404/i.test(err?.message || '')) {
        console.warn(`[Session] 当前活跃会话 ${state.activeSessionId} 已不存在，自动重置`);
        state.activeSessionId = null;
        state.activeSession = null;
        state.sessions = (state.sessions || []).filter((s) => s.id !== state.activeSessionId);
        renderSessionList();
      } else {
        throw err;
      }
    }
  }

  document.getElementById('ds-toggle-llm-mode')?.addEventListener('click', toggleLlmMode);
  document.getElementById('ds-model-pill')?.addEventListener('click', toggleLlmMode);

  document.getElementById('ds-toggle-think').addEventListener('click', () => {
    const next = state.activeSession?.ds_thinking === 0;
    patchActiveSessionFlag(
      { ds_thinking: next },
      next ? '已开启深度思考模式（DeepSeek V4.1 Flash）' : '已切换为极速直出模式（DeepSeek V4.1 Flash）'
    );
  });

  document.getElementById('ds-toggle-search').addEventListener('click', () => {
    const next = state.activeSession?.ds_search !== 1;
    patchActiveSessionFlag(
      { ds_search: next },
      next ? '已开启实时联网搜索增强' : '已关闭联网搜索'
    );
  });

  document.getElementById('ds-toggle-json')?.addEventListener('click', () => {
    const next = state.activeSession?.ds_json_mode !== 1;
    patchActiveSessionFlag(
      { ds_json_mode: next },
      next ? '已开启结构清单整理格式' : '已恢复自然对话格式'
    );
  });

  document.getElementById('ds-tools-enable-chk').addEventListener('change', (e) => {
    patchActiveSessionFlag(
      { ds_tools_enabled: e.target.checked },
      e.target.checked ? '已开启自动时间与计算小助手' : '已关闭自动小助手'
    );
  });

  // 全格式文件上传（PDF / Word / Excel / PPT / 压缩包 / 源码 / 文本 / 图片）、拖拽与剪贴板 Ctrl+V 粘贴支持
  const dsDocAttachmentInput = document.getElementById('ds-doc-attachment-input');
  const dsAttachmentInput = document.getElementById('ds-attachment-input');
  const dsImageAttachmentInput = document.getElementById('ds-image-attachment-input');
  const composerAttachmentsBar = document.getElementById('composer-attachments-bar');

  document.getElementById('close-att-preview-dialog')?.addEventListener('click', () => attachmentPreviewDialog?.close());
  document.getElementById('done-att-preview-btn')?.addEventListener('click', () => attachmentPreviewDialog?.close());

  function inferClientFileBadge(filename = '', savedBadge = '', savedColor = '') {
    if (savedBadge && savedColor) return { badge: savedBadge, color: savedColor };
    const ext = (String(filename).split('.').pop() || '').toLowerCase();
    if (ext === 'pdf') return { badge: 'PDF', color: 'pdf' };
    if (['docx', 'doc', 'rtf', 'odt', 'epub'].includes(ext)) return { badge: ext === 'epub' ? 'EPUB' : 'WORD', color: 'word' };
    if (['xlsx', 'xls', 'csv', 'tsv', 'ods'].includes(ext)) return { badge: ext === 'csv' ? 'CSV' : 'EXCEL', color: 'excel' };
    if (['pptx', 'ppt', 'odp'].includes(ext)) return { badge: 'PPT', color: 'ppt' };
    if (['zip', 'tar', 'gz'].includes(ext)) return { badge: 'ZIP', color: 'zip' };
    if (['md', 'markdown', 'txt', 'log', 'srt', 'vtt'].includes(ext)) return { badge: ext.toUpperCase().slice(0, 4), color: 'txt' };
    if (
      [
        'js', 'mjs', 'ts', 'tsx', 'jsx', 'vue', 'py', 'ipynb', 'java', 'kt',
        'c', 'h', 'cpp', 'cs', 'go', 'rs', 'php', 'rb', 'swift', 'sql',
        'html', 'htm', 'css', 'scss', 'json', 'jsonl', 'xml', 'yaml', 'yml', 'toml', 'ini', 'sh', 'ps1', 'bat'
      ].includes(ext)
    ) {
      return { badge: ext.toUpperCase().slice(0, 5), color: 'code' };
    }
    return { badge: (ext || 'FILE').toUpperCase().slice(0, 5), color: 'file' };
  }

  function formatFileByteSize(bytes) {
    const n = Number(bytes) || 0;
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(2)} MB`;
  }

  function renderPendingAttachments() {
    if (!composerAttachmentsBar) return;
    if (state.pendingAttachments.length === 0) {
      composerAttachmentsBar.classList.add('hidden');
      composerAttachmentsBar.innerHTML = '';
      syncComposerEmptyState();
      return;
    }
    composerAttachmentsBar.classList.remove('hidden');
    composerAttachmentsBar.innerHTML = state.pendingAttachments
      .map((att, idx) => {
        if (att.is_image && att.data_url) {
          return `
            <span class="attachment-chip clickable-att" data-stage-preview-idx="${idx}" title="点击预览图片：${escapeHtml(
              att.name
            )} (${att.dimensions || '图片'})">
              <img src="${escapeHtml(att.data_url)}" alt="${escapeHtml(att.name)}" class="att-thumb-img" />
              ${renderFilenameHtml(att.name)}
              <button type="button" class="att-remove-btn" data-att-idx="${idx}" aria-label="移除附件"></button>
            </span>
          `;
        }
        const fMeta = inferClientFileBadge(att.name, att.badge, att.color);
        const subText = att.parsing
          ? '正在读取文件内容…'
          : att.char_count > 0
          ? `${formatFileByteSize(att.size)} · 已读 ${Number(att.char_count).toLocaleString()} 字`
          : formatFileByteSize(att.size);
        return `
          <span class="ds-file-card clickable-att" data-stage-preview-idx="${idx}" title="点击预览解析内容：${escapeHtml(
            att.name
          )}">
            <span class="ds-file-badge ${escapeHtml(fMeta.color)}">${escapeHtml(fMeta.badge)}</span>
            <span class="ds-file-meta">
              <span class="ds-file-name">${escapeHtml(att.name)}</span>
              <span class="ds-file-sub">${escapeHtml(subText)}</span>
            </span>
            <button type="button" class="att-remove-btn" data-att-idx="${idx}" aria-label="移除附件"></button>
          </span>
        `;
      })
      .join('');

    composerAttachmentsBar.querySelectorAll('[data-stage-preview-idx]').forEach((chip) => {
      chip.addEventListener('click', (e) => {
        if (e.target.closest('.att-remove-btn')) return;
        const att = state.pendingAttachments[Number(chip.dataset.stagePreviewIdx)];
        if (att && !att.parsing) openAttachmentPreviewModal(att);
      });
    });

    composerAttachmentsBar.querySelectorAll('.att-remove-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const i = Number(btn.dataset.attIdx);
        state.pendingAttachments.splice(i, 1);
        renderPendingAttachments();
      });
    });
    syncComposerEmptyState();
  }

  function readImageFileCompressed(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('读取图片失败'));
      reader.onload = () => {
        const rawUrl = String(reader.result || '');
        if (file.type === 'image/svg+xml') {
          resolve({ dataUrl: rawUrl.slice(0, 320000), dimensions: 'SVG 矢量图' });
          return;
        }
        const img = new Image();
        img.onerror = () => resolve({ dataUrl: rawUrl.slice(0, 320000), dimensions: '' });
        img.onload = () => {
          const origW = img.naturalWidth || img.width;
          const origH = img.naturalHeight || img.height;
          const maxSide = 1280;
          let targetW = origW;
          let targetH = origH;
          if (origW > maxSide || origH > maxSide) {
            const ratio = Math.min(maxSide / origW, maxSide / origH);
            targetW = Math.round(origW * ratio);
            targetH = Math.round(origH * ratio);
          }
          const c = document.createElement('canvas');
          c.width = targetW;
          c.height = targetH;
          const ctx = c.getContext('2d');
          ctx.drawImage(img, 0, 0, targetW, targetH);
          const outUrl = c.toDataURL('image/jpeg', 0.82);
          resolve({
            dataUrl: outUrl,
            dimensions: `${origW}×${origH}`
          });
        };
        img.src = rawUrl;
      };
      reader.readAsDataURL(file);
    });
  }

  async function parseDocumentFileUniversal(file) {
    const headers = {
      'Content-Type': 'application/octet-stream',
      'X-File-Name': encodeURIComponent(file.name || '未命名文件'),
      'X-File-Mime': file.type || ''
    };
    const tok = window.__starAuthStore?.getToken?.() || '';
    if (tok) headers.Authorization = `Bearer ${tok}`;

    try {
      const resp = await fetch('/api/files/parse', {
        method: 'POST',
        headers,
        body: file
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data && data.ok && typeof data.content === 'string') return data;
      } else if (resp.status === 413) {
        throw new Error('单个文件请控制在 20MB 以内');
      }
    } catch (err) {
      if (String(err?.message || '').includes('20MB')) throw err;
    }

    // 移动端 WebView / 代理不兼容 raw File body 时的 Base64 JSON 回退解析
    try {
      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let binary = '';
      const chunkLen = 0x8000;
      for (let i = 0; i < bytes.length; i += chunkLen) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkLen));
      }
      const dataBase64 = btoa(binary);
      const jsonHeaders = {
        'Content-Type': 'application/json',
        'X-File-Name': encodeURIComponent(file.name || '未命名文件'),
        'X-File-Mime': file.type || ''
      };
      if (tok) jsonHeaders.Authorization = `Bearer ${tok}`;
      const jsonResp = await fetch('/api/files/parse', {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({
          name: file.name || '未命名文件',
          mime: file.type || '',
          data_base64: dataBase64
        })
      });
      if (jsonResp.ok) {
        const jData = await jsonResp.json();
        if (jData && jData.ok && typeof jData.content === 'string') return jData;
      } else if (jsonResp.status === 413) {
        throw new Error('单个文件请控制在 20MB 以内');
      }
    } catch (err) {
      if (String(err?.message || '').includes('20MB')) throw err;
    }

    // 离线 / 独立前端兜底解码（自动兼容 UTF-8 与中文 GB18030）
    const buf = await file.arrayBuffer();
    let decoded = '';
    try {
      decoded = new TextDecoder('utf-8', { fatal: true }).decode(buf);
    } catch {
      try {
        decoded = new TextDecoder('gb18030').decode(buf);
      } catch {
        decoded = await readFileAsText(file).catch(() => '');
      }
    }
    const cleanText = decoded.replace(/\x00/g, '').trim();
    const fMeta = inferClientFileBadge(file.name);
    return {
      ok: true,
      name: file.name,
      size: file.size || buf.byteLength,
      badge: fMeta.badge,
      color: fMeta.color,
      char_count: cleanText.length,
      content: cleanText
        ? cleanText.slice(0, 60000)
        : `【已附带文件】${file.name}（大小 ${formatFileByteSize(file.size)}）`
    };
  }

  async function ingestAttachmentFiles(fileList) {
    const files = Array.from(fileList || []).slice(0, 8);
    if (files.length === 0) return;

    let added = 0;
    for (const f of files) {
      if (state.pendingAttachments.length >= 8) {
        showToast('单次最多同时上传 8 份文件');
        break;
      }
      if (f.size > 20 * 1024 * 1024) {
        showToast(`文件「${f.name}」超过 20MB 上限，请精简后再传`);
        continue;
      }

      try {
        const isImg =
          Boolean(f.type && f.type.startsWith('image/')) ||
          /\.(png|jpe?g|webp|gif|bmp|svg)$/i.test(f.name || '');

        if (isImg) {
          const { dataUrl, dimensions } = await readImageFileCompressed(f);
          let svgSource = '';
          if (f.type === 'image/svg+xml' || /\.svg$/i.test(f.name || '')) {
            svgSource = (await readFileAsText(f).catch(() => '')).slice(0, 24000);
          }
          state.pendingAttachments.push({
            name: f.name || `粘贴图片_${new Date().toTimeString().slice(0, 8).replace(/:/g, '')}.png`,
            size: f.size || dataUrl.length,
            is_image: true,
            mime: f.type || 'image/jpeg',
            dimensions,
            data_url: dataUrl,
            content: svgSource || `图像文件 ${f.name || 'image'}（分辨率 ${dimensions || '未知'}）`
          });
          added++;
          renderPendingAttachments();
        } else {
          const fMeta = inferClientFileBadge(f.name);
          const slot = {
            name: f.name || '未命名文件',
            size: f.size || 0,
            badge: fMeta.badge,
            color: fMeta.color,
            char_count: 0,
            is_image: false,
            parsing: true,
            content: ''
          };
          state.pendingAttachments.push(slot);
          renderPendingAttachments();

          const parsed = await parseDocumentFileUniversal(f);
          slot.parsing = false;
          slot.badge = parsed.badge || fMeta.badge;
          slot.color = parsed.color || fMeta.color;
          slot.char_count = Number(parsed.char_count) || 0;
          slot.content = String(parsed.content || '').slice(0, 60000);
          added++;
          renderPendingAttachments();
        }
      } catch (err) {
        state.pendingAttachments = state.pendingAttachments.filter((item) => !item.parsing);
        renderPendingAttachments();
        showToast(`读取文件「${f.name}」失败：${err.message || '请重试'}`);
      }
    }

    if (added > 0) {
      showToast(`已添加 ${added} 份文件（点击卡片可预览解析内容）`);
    }
  }

  function handleAttachmentInputChange(e) {
    const picked = Array.from(e.target.files || []);
    e.target.value = '';
    hidePopoverSafe('attach-picker-popover');
    if (picked.length > 0) ingestAttachmentFiles(picked);
  }
  dsDocAttachmentInput?.addEventListener('change', handleAttachmentInputChange);
  dsAttachmentInput?.addEventListener('change', handleAttachmentInputChange);
  dsImageAttachmentInput?.addEventListener('change', handleAttachmentInputChange);

  document.querySelectorAll('#attach-picker-popover label[for]').forEach((lbl) => {
    lbl.addEventListener('click', () => {
      setTimeout(() => hidePopoverSafe('attach-picker-popover'), 320);
    });
    lbl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const targetId = lbl.getAttribute('for');
        const inp = targetId ? document.getElementById(targetId) : null;
        if (inp) inp.click();
        setTimeout(() => hidePopoverSafe('attach-picker-popover'), 320);
      }
    });
  });
  chatForm.addEventListener('dragover', (e) => {
    e.preventDefault();
    chatForm.classList.add('drag-over-active');
  });
  chatForm.addEventListener('dragleave', (e) => {
    if (!chatForm.contains(e.relatedTarget)) {
      chatForm.classList.remove('drag-over-active');
    }
  });
  chatForm.addEventListener('drop', (e) => {
    chatForm.classList.remove('drag-over-active');
    if (e.dataTransfer?.files?.length) {
      e.preventDefault();
      ingestAttachmentFiles(e.dataTransfer.files);
    }
  });
  chatInput.addEventListener('paste', (e) => {
    const items = Array.from(e.clipboardData?.items || []);
    const pastedFiles = items
      .filter((it) => it.kind === 'file')
      .map((it) => it.getAsFile())
      .filter(Boolean);
    if (pastedFiles.length > 0) {
      e.preventDefault();
      ingestAttachmentFiles(pastedFiles);
    }
  });

  // 右侧伴生分栏 Artifacts 实时预览工作台 + 代码块全功能事件委托
  function buildCompleteSandboxHtml(rawCode) {
    const isFullHtml = /<!doctype html>|<html/i.test(rawCode);
    return isFullHtml
      ? rawCode
      : `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;padding:16px;font-family:system-ui,sans-serif;}</style></head><body>${rawCode}</body></html>`;
  }

  function resetSideArtifactSandbox() {
    state.lastSandboxCode = '';
    const sideIframe = document.getElementById('ds-side-sandbox-iframe');
    const emptyBox = document.getElementById('ds-artifacts-empty');
    const sourceCodeEl = document.getElementById('ds-side-source-code');
    const sourcePreEl = document.getElementById('ds-side-source-pre');
    if (sideIframe) {
      sideIframe.srcdoc = '';
      sideIframe.classList.add('hidden');
    }
    if (sourceCodeEl) sourceCodeEl.textContent = '';
    if (sourcePreEl) sourcePreEl.classList.add('hidden');
    if (emptyBox) emptyBox.classList.remove('hidden');
    document.getElementById('ds-artifacts-count-dot')?.classList.add('hidden');
  }

  function populateSideArtifactSandbox(rawCode, openPane = true) {
    if (state.uiMode !== 'deepseek') return;
    state.lastSandboxCode = rawCode;
    const htmlDoc = buildCompleteSandboxHtml(rawCode);
    const sideIframe = document.getElementById('ds-side-sandbox-iframe');
    const emptyBox = document.getElementById('ds-artifacts-empty');
    const sourceCodeEl = document.getElementById('ds-side-source-code');
    const sourcePreEl = document.getElementById('ds-side-source-pre');

    if (emptyBox) emptyBox.classList.add('hidden');
    if (sourceCodeEl) sourceCodeEl.textContent = rawCode;
    if (sideIframe) {
      sideIframe.srcdoc = htmlDoc;
      if (sourcePreEl?.classList.contains('hidden') !== false) {
        sideIframe.classList.remove('hidden');
      }
    }
    document.getElementById('ds-artifacts-count-dot')?.classList.remove('hidden');
    if (openPane) {
      openRightTab('ds-artifacts-tab');
    }
  }

  function openCodeSandboxPreview(rawCode, forceModal = false) {
    if (state.uiMode !== 'deepseek') return;
    state.lastSandboxCode = rawCode;
    const htmlDoc = buildCompleteSandboxHtml(rawCode);
    if (!forceModal && window.innerWidth > 860) {
      populateSideArtifactSandbox(rawCode, true);
      return;
    }
    const iframe = document.getElementById('ds-sandbox-iframe');
    if (iframe) iframe.srcdoc = htmlDoc;
    codePreviewDialog.showModal();
  }

  // 右侧伴生预览工具栏事件（仅 DeepSeek 问答模式生效）
  document.getElementById('open-ds-artifacts-btn')?.addEventListener('click', () => {
    if (state.uiMode !== 'deepseek') return;
    const artTabEl = document.getElementById('ds-artifacts-tab');
    const isVisible = !appShell.classList.contains('right-collapsed') && artTabEl && !artTabEl.classList.contains('hidden');
    if (isVisible) {
      setRightPanelCollapsed(true, true);
    } else {
      openRightTab('ds-artifacts-tab');
      if (state.lastSandboxCode) populateSideArtifactSandbox(state.lastSandboxCode, false);
    }
  });

  document.getElementById('ds-art-view-preview')?.addEventListener('click', (e) => {
    e.currentTarget.classList.add('active');
    document.getElementById('ds-art-view-code')?.classList.remove('active');
    document.getElementById('ds-side-source-pre')?.classList.add('hidden');
    if (state.lastSandboxCode) {
      document.getElementById('ds-side-sandbox-iframe')?.classList.remove('hidden');
    }
  });

  document.getElementById('ds-art-view-code')?.addEventListener('click', (e) => {
    e.currentTarget.classList.add('active');
    document.getElementById('ds-art-view-preview')?.classList.remove('active');
    document.getElementById('ds-side-sandbox-iframe')?.classList.add('hidden');
    if (state.lastSandboxCode) {
      document.getElementById('ds-side-source-pre')?.classList.remove('hidden');
    }
  });

  document.getElementById('ds-art-viewport-btn')?.addEventListener('click', (e) => {
    const stage = document.getElementById('ds-artifacts-stage');
    if (!stage) return;
    const isMobile = stage.classList.toggle('mobile-viewport');
    e.currentTarget.textContent = isMobile ? '手机' : '桌面';
  });

  document.getElementById('ds-art-reload-btn')?.addEventListener('click', () => {
    if (state.lastSandboxCode) populateSideArtifactSandbox(state.lastSandboxCode, false);
  });

  document.getElementById('ds-art-download-btn')?.addEventListener('click', () => {
    if (!state.lastSandboxCode) return;
    const blob = new Blob([buildCompleteSandboxHtml(state.lastSandboxCode)], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `deepseek_artifact_${Date.now()}.html`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('已下载单文件交互网页 (.html)');
  });

  document.getElementById('ds-art-fullscreen-btn')?.addEventListener('click', () => {
    if (state.lastSandboxCode) openCodeSandboxPreview(state.lastSandboxCode, true);
  });

  const STAR_PARTICLE_DEMO_HTML = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><style>body{margin:0;overflow:hidden;background:radial-gradient(circle at center,#16122e,#080614);font-family:system-ui,sans-serif;color:#fff}#tip{position:fixed;top:14px;left:16px;font-size:13px;background:rgba(255,255,255,.1);padding:6px 12px;border-radius:99px;backdrop-filter:blur(8px);pointer-events:none}</style></head><body><div id="tip">移动或点击鼠标体验星际引力粒子牵引</div><canvas id="c"></canvas><script>const c=document.getElementById('c'),x=c.getContext('2d');let w,h,m={x:-999,y:-999,down:false};const r=()=>{w=c.width=innerWidth;h=c.height=innerHeight};r();onresize=r;onpointermove=e=>{m.x=e.clientX;m.y=e.clientY};onpointerdown=()=>m.down=true;onpointerup=()=>m.down=false;const p=Array.from({length:110},()=>({x:Math.random()*w,y:Math.random()*h,vx:(Math.random()-.5)*1.2,vy:(Math.random()-.5)*1.2,s:Math.random()*2.2+1,c:['#f472b6','#a78bfa','#60a5fa','#fde047'][Math.random()*4|0]}));(function f(){x.fillStyle='rgba(8,6,20,0.22)';x.fillRect(0,0,w,h);for(const a of p){const dx=m.x-a.x,dy=m.y-a.y,d=Math.hypot(dx,dy);if(d<220&&d>1){const g=(m.down?0.22:0.06)*(1-d/220);a.vx+=dx/d*g;a.vy+=dy/d*g}a.vx*=0.985;a.vy*=0.985;a.x=(a.x+a.vx+w)%w;a.y=(a.y+a.vy+h)%h;x.beginPath();x.arc(a.x,a.y,a.s,0,7);x.fillStyle=a.c;x.fill()}requestAnimationFrame(f)})()</script></body></html>`;

  document.getElementById('more-open-artifacts-btn')?.addEventListener('click', () => {
    hidePopoverSafe('topbar-more-popover');
    if (state.uiMode !== 'deepseek') return;
    setTimeout(() => {
      openCodeSandboxPreview(state.lastSandboxCode || STAR_PARTICLE_DEMO_HTML, false);
    }, 20);
  });

  document.getElementById('ds-art-try-demo-btn')?.addEventListener('click', () => {
    if (state.uiMode !== 'deepseek') return;
    populateSideArtifactSandbox(STAR_PARTICLE_DEMO_HTML, true);
    if (!state.isStreaming) {
      sendStreamMessage('请帮我写一个单文件 HTML5 Canvas 星际引力粒子交互网页，支持鼠标牵引效果', false);
    } else {
      showToast('已在预览窗为您运行星际引力粒子交互网页！');
    }
  });

  // ✍️ 指定开头（双模式通用展开与预设填入）
  function togglePrefixBar() {
    const bar = document.getElementById('ds-prefix-bar');
    const inp = document.getElementById('ds-prefix-input');
    if (!bar) return;
    const isNowOpen = bar.classList.toggle('hidden') === false;
    document.getElementById('rp-toggle-prefix-btn')?.classList.toggle('active', isNowOpen);
    document.getElementById('rp-toggle-prefix-btn')?.setAttribute('aria-pressed', String(isNowOpen));
    document.getElementById('ds-toggle-prefix')?.classList.toggle('active', isNowOpen);
    document.getElementById('ds-toggle-prefix')?.setAttribute('aria-pressed', String(isNowOpen));
    if (isNowOpen && inp) {
      inp.focus();
    }
  }
  document.getElementById('rp-toggle-prefix-btn')?.addEventListener('click', togglePrefixBar);
  document.getElementById('ds-toggle-prefix')?.addEventListener('click', togglePrefixBar);
  document.querySelectorAll('.ds-mini-preset').forEach((btn) => {
    btn.addEventListener('click', () => {
      const inp = document.getElementById('ds-prefix-input');
      if (inp) {
        inp.value = btn.dataset.prefix || '';
        inp.focus();
      }
    });
  });

  messagesContainer.addEventListener('click', async (e) => {
    const copyBtn = e.target.closest('[data-copy-code]');
    if (copyBtn) {
      const entry = codeSnippetStore.get(copyBtn.dataset.copyCode);
      const code = typeof entry === 'string' ? entry : entry?.code || '';
      let ok = false;
      try {
        await navigator.clipboard.writeText(code);
        ok = true;
      } catch {
        ok = fallbackLegacyCopy(code);
      }
      reportCopyOutcome(copyBtn, ok);
      return;
    }

    const wrapBtn = e.target.closest('[data-wrap-code]');
    if (wrapBtn) {
      const block = wrapBtn.closest('.ds-code-block');
      if (block) {
        const wrapped = block.classList.toggle('wrap-lines');
        wrapBtn.classList.toggle('active', wrapped);
      }
      return;
    }

    const dlBtn = e.target.closest('[data-dl-code]');
    if (dlBtn) {
      const entry = codeSnippetStore.get(dlBtn.dataset.dlCode);
      const code = typeof entry === 'string' ? entry : entry?.code || '';
      const lang = typeof entry === 'object' && entry?.lang ? entry.lang : 'txt';
      const ext = resolveCodeFileExt(lang);
      const blob = new Blob([code], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `snippet_${Date.now()}.${ext}`;
      a.click();
      URL.revokeObjectURL(url);
      showToast(`代码已保存为 .${ext} 文件`);
      return;
    }

    const runBtn = e.target.closest('[data-run-code]');
    if (runBtn) {
      const entry = codeSnippetStore.get(runBtn.dataset.runCode);
      const code = typeof entry === 'string' ? entry : entry?.code || '';
      if (code) openCodeSandboxPreview(code, false);
    }
  });

  document.getElementById('close-code-preview-dialog').addEventListener('click', () => codePreviewDialog.close());
  document.getElementById('done-code-preview-btn').addEventListener('click', () => codePreviewDialog.close());
  document.getElementById('reload-code-preview-btn').addEventListener('click', () => {
    if (state.lastSandboxCode) openCodeSandboxPreview(state.lastSandboxCode, true);
  });

  // DeepSeek 问答模式空对话欢迎态：场景化毛玻璃灵感卡片
  document.querySelectorAll('.ds-inspiration-card').forEach((card) => {
    card.addEventListener('click', () => {
      const action = card.dataset.action;
      if (action === 'roleplay') {
        const rpBtn = document.getElementById('ws-mode-roleplay');
        if (rpBtn) rpBtn.click();
        else switchWorkspaceMode('roleplay');
        return;
      }
      const prompt = card.dataset.prompt || '';
      if (prompt) {
        chatInput.value = prompt;
        syncComposerEmptyState();
        chatInput.focus();
      }
    });
  });

  // DeepSeek 问答模式空对话欢迎态：4 大原生问答快捷功能胶囊（与剧本扮演模式彻底分离）
  document.querySelectorAll('.ds-quick-scene-pill').forEach((pill) => {
    pill.addEventListener('click', () => {
      if (state.uiMode !== 'deepseek') return;
      const sc = pill.dataset.dsScene;
      if (sc === 'web-preview') {
        chatInput.value = '请用单文件 HTML + Canvas 写一个带物理碰撞和鼠标引力场的星际粒子交互网页，方便我直接右侧实时预览。';
        syncComposerEmptyState();
        chatInput.focus();
        if (window.innerWidth > 860) {
          openRightTab('ds-artifacts-tab');
        }
        return;
      }
      if (sc === 'deep-think') {
        if (state.activeSession && state.activeSession.ds_thinking === 0) {
          patchActiveSessionFlag({ ds_thinking: true });
        }
        chatInput.value = '请开启深度思考，帮我系统推演并对比：';
        syncComposerEmptyState();
        chatInput.focus();
        return;
      }
      if (sc === 'web-search') {
        if (state.activeSession && state.activeSession.ds_search !== 1) {
          patchActiveSessionFlag({ ds_search: true }, '已开启智能联网搜索，请输入你想检索的问题');
        } else {
          showToast('智能联网搜索已就绪，请直接输入问题');
        }
        chatInput.focus();
        return;
      }
    });
  });

  // 📤 双模式通用对话记录与独立记忆档案 (.md) 导出与分享长图引擎
  function buildCurrentSessionMarkdown() {
    return buildClientSessionMemoryMarkdown({
      title: state.activeSession?.title,
      session_mode: state.activeSession?.session_mode,
      persona: state.activePersona,
      persona_name: state.activePersona?.name,
      session_prompt: state.activeSession?.session_prompt,
      director_note: state.activeSession?.director_note,
      rolling_summary: state.activeSession?.rolling_summary,
      memories: state.memories,
      messages: state.messages
    });
  }

  async function openDsShareModal() {
    if (!dsShareDialog) return;
    let exportSnapshot = {
      title: state.activeSession?.title,
      session_mode: state.activeSession?.session_mode,
      persona: state.activePersona,
      session_prompt: state.activeSession?.session_prompt,
      memories: state.memories || [],
      messages: state.messages || []
    };
    if (state.activeSessionId) {
      try {
        const srvExport = await apiJson(`/api/sessions/${encodeURIComponent(state.activeSessionId)}/export`);
        if (srvExport && typeof srvExport === 'object') {
          exportSnapshot = {
            ...exportSnapshot,
            ...srvExport,
            memories: Array.isArray(srvExport.memories) ? srvExport.memories : exportSnapshot.memories,
            messages: Array.isArray(srvExport.messages) ? srvExport.messages : exportSnapshot.messages
          };
        }
      } catch {}
    }

    const msgList = exportSnapshot.messages || [];
    const memList = exportSnapshot.memories || [];
    const hasMsgs = msgList.length > 0;
    const hasMems = memList.length > 0;
    const hasPrompt = Boolean(exportSnapshot.session_prompt && String(exportSnapshot.session_prompt).trim());
    if (!hasMsgs && !hasMems && !hasPrompt) {
      showToast('当前对话还没有消息或记忆条目，先聊两句或写入专属设定再来导出吧');
      return;
    }
    const card = document.getElementById('ds-share-preview-card');
    const isNative = exportSnapshot.session_mode === 'deepseek_native';
    const personaObj = exportSnapshot.persona || state.activePersona;
    const brandName = isNative ? 'deepseek' : personaObj?.name || '星语恋庭';
    const brandIcon = isNative
      ? DS_WHALE_AVATAR_SVG
      : `<span style="font-size:16px;font-weight:700;">${escapeHtml((personaObj?.name || '星').slice(0, 1))}</span>`;
    const title = exportSnapshot.title || '对话与记忆精选';
    const recentTurns = msgList.slice(-8);
    const countSummaryText = hasMsgs
      ? `对话消息 ${msgList.length} 条 · 独立记忆 ${memList.length} 条`
      : `专属设定与记忆包（记忆 ${memList.length} 条）`;
    const memSummaryHtml = hasMems
      ? `<div class="ds-share-thought-note">本对话独立记忆（共 ${memList.length} 条）：${escapeHtml(
          memList
            .slice(0, 2)
            .map((x) => x.content)
            .join(' ｜ ')
            .slice(0, 110)
        )}${memList.length > 2 ? '…' : ''}</div>`
      : '';
    if (card) {
      card.innerHTML = `
        <div class="ds-share-head">
          <span class="ds-share-brand">${brandIcon}<span>${escapeHtml(brandName)} · ${escapeHtml(title)}</span></span>
          <span class="muted-count">${new Date().toLocaleDateString('zh-CN')} · ${escapeHtml(countSummaryText)}</span>
        </div>
        ${memSummaryHtml}
        ${
          recentTurns.length > 0
            ? recentTurns
                .map((m) => {
                  const cleanR = extractValidReasoningForQuote(m.reasoning);
                  return m.role === 'user'
                    ? `<div class="ds-share-turn"><div class="ds-share-user-q">${escapeHtml(m.content)}</div></div>`
                    : `<div class="ds-share-turn">
                         ${
                           cleanR
                             ? `<div class="ds-share-thought-note">思考与心声：${escapeHtml(
                                 cleanR.replace(/\s+/g, ' ').slice(0, 95)
                               )}…</div>`
                             : ''
                         }
                         <div class="ds-share-ai-a">${escapeHtml(String(m.content || '').slice(0, 480))}${
                        String(m.content || '').length > 480 ? '…' : ''
                      }</div>
                       </div>`;
                })
                .join('')
            : '<div class="ds-share-thought-note">当前包含本对话独立设定与记忆锚点，下载 .md 后可直接导入任意新对话框复用。</div>'
        }
      `;
    }
    dsShareDialog.showModal();
  }

  document.getElementById('ds-share-session-btn')?.addEventListener('click', () => openDsShareModal());
  document.getElementById('more-open-share-btn')?.addEventListener('click', () => {
    hidePopoverSafe('topbar-more-popover');
    openDsShareModal();
  });
  document.getElementById('ds-menu-share-btn')?.addEventListener('click', () => {
    hidePopoverSafe('ds-user-popover');
    openDsShareModal();
  });
  document.getElementById('close-ds-share-dialog')?.addEventListener('click', () => dsShareDialog?.close());
  document.getElementById('cancel-ds-share-dialog')?.addEventListener('click', () => dsShareDialog?.close());

  document.getElementById('ds-copy-markdown-btn')?.addEventListener('click', async (e) => {
    const copyBtn = e.currentTarget;
    const origHtml = copyBtn.innerHTML;
    let md = '';
    try {
      if (state.activeSessionId) {
        const data = await apiJson(`/api/sessions/${encodeURIComponent(state.activeSessionId)}/export`);
        md = buildClientSessionMemoryMarkdown(data);
      } else {
        md = buildCurrentSessionMarkdown();
      }
    } catch {
      md = buildCurrentSessionMarkdown();
    }
    try {
      await navigator.clipboard.writeText(md);
    } catch {
      fallbackLegacyCopy(md);
    }
    copyBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg><span>已复制 .md</span>`;
    setTimeout(() => {
      copyBtn.innerHTML = origHtml;
    }, 2200);
    showToast('已复制完整对话与记忆 Markdown，可直接粘贴使用！');
  });

  document.getElementById('ds-export-md-file-btn')?.addEventListener('click', () => {
    exportSessionMarkdownById(state.activeSessionId);
  });

  document.getElementById('ds-export-json-file-btn')?.addEventListener('click', () => {
    exportSessionJsonById(state.activeSessionId);
  });

  document.getElementById('ds-download-share-png-btn')?.addEventListener('click', (e) => {
    const dlBtn = e.currentTarget;
    const turns = state.messages.slice(-6);
    if (turns.length === 0) {
      showToast('当前对话还没有聊天记录，先和角色聊上两句再来生成对话长图吧！');
      return;
    }
    const origBtnHtml = dlBtn.innerHTML;
    dlBtn.innerHTML = `<span>正在生成长图…</span>`;
    const dpr = 2;
    const width = 680;
    const tmp = document.createElement('canvas');
    const tCtx = tmp.getContext('2d');
    const blocks = [];
    let totalH = 130;

    for (const m of turns) {
      if (m.role === 'user') {
        tCtx.font = 'bold 16px "Microsoft YaHei", sans-serif';
        const qLines = wrapCanvasLines(tCtx, `提问：${m.content}`, width - 110).slice(0, 8);
        blocks.push({ type: 'user', lines: qLines });
        totalH += qLines.length * 26 + 28;
      } else {
        if (m.reasoning) {
          tCtx.font = '13px "Microsoft YaHei", sans-serif';
          const rLines = wrapCanvasLines(
            tCtx,
            `深度思考：${m.reasoning.replace(/\s+/g, ' ').slice(0, 140)}${m.reasoning.length > 140 ? '…' : ''}`,
            width - 116
          );
          blocks.push({ type: 'thought', lines: rLines });
          totalH += rLines.length * 22 + 16;
        }
        tCtx.font = '15px "Microsoft YaHei", sans-serif';
        const cleanAns = m.content.replace(/```[\s\S]*?```/g, '[代码块详见原对话]').slice(0, 520);
        const aLines = wrapCanvasLines(tCtx, cleanAns, width - 110).slice(0, 18);
        blocks.push({ type: 'ai', lines: aLines });
        totalH += aLines.length * 25 + 28;
      }
    }
    totalH += 56;

    const canvas = document.createElement('canvas');
    canvas.width = width * dpr;
    canvas.height = totalH * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, totalH);
    ctx.strokeStyle = '#e5e7eb';
    ctx.lineWidth = 2;
    ctx.strokeRect(12, 12, width - 24, totalH - 24);

    const isDsShare = state.uiMode === 'deepseek' || state.uiMode === 'phone-agent';
    const shareBrandText = state.uiMode === 'phone-agent'
      ? '星语 · 手机辅助'
      : isDsShare
        ? 'deepseek'
        : `${(state.activePersona?.name || '星语恋庭').split(/[·\s]/)[0]}`;
    const shareFooterSource = state.uiMode === 'phone-agent'
      ? 'Phone Agent 手机辅助'
      : isDsShare
        ? 'DeepSeek 问答模式'
        : '星语恋庭 · 剧本扮演模式';

    ctx.font = 'bold 22px "Microsoft YaHei", sans-serif';
    ctx.fillStyle = isDsShare ? '#4d6bfe' : '#e2559d';
    ctx.fillText(shareBrandText, 42, 56);
    ctx.font = 'bold 16px "Microsoft YaHei", sans-serif';
    ctx.fillStyle = '#1f2329';
    ctx.fillText(` · ${(state.activeSession?.title || '对话精选').slice(0, 22)}`, 176, 56);
    ctx.strokeStyle = '#f1f3f5';
    ctx.beginPath();
    ctx.moveTo(42, 76);
    ctx.lineTo(width - 42, 76);
    ctx.stroke();

    let y = 108;
    for (const b of blocks) {
      if (b.type === 'user') {
        const boxH = b.lines.length * 26 + 16;
        ctx.fillStyle = isDsShare ? '#eff6ff' : '#fff0f7';
        ctx.fillRect(42, y - 18, width - 84, boxH);
        ctx.font = 'bold 15px "Microsoft YaHei", sans-serif';
        ctx.fillStyle = isDsShare ? '#1e3a8a' : '#7a2858';
        for (const ln of b.lines) {
          ctx.fillText(ln, 56, y + 2);
          y += 26;
        }
        y += 24;
      } else if (b.type === 'thought') {
        ctx.fillStyle = '#6b7280';
        ctx.font = '13px "Microsoft YaHei", sans-serif';
        for (const ln of b.lines) {
          ctx.fillText(ln, 52, y);
          y += 22;
        }
        y += 12;
      } else {
        ctx.fillStyle = isDsShare ? '#4d6bfe' : '#e2559d';
        ctx.fillRect(42, y - 14, 3, b.lines.length * 25 + 6);
        ctx.font = '15px "Microsoft YaHei", sans-serif';
        ctx.fillStyle = '#1f2329';
        for (const ln of b.lines) {
          ctx.fillText(ln, 56, y);
          y += 25;
        }
        y += 24;
      }
    }

    ctx.font = '12px "Microsoft YaHei", sans-serif';
    ctx.fillStyle = '#8f959e';
    ctx.fillText(`生成于 ${shareFooterSource} · ${new Date().toLocaleString('zh-CN')}`, 42, totalH - 28);

    const link = document.createElement('a');
    link.download = `${(state.activeSession?.title || 'DeepSeek对话').slice(0, 18)}_分享长图.png`;
    link.href = canvas.toDataURL('image/png');
    document.body.appendChild(link);
    link.click();
    link.remove();
    dlBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg><span>长图已下载</span>`;
    setTimeout(() => {
      dlBtn.innerHTML = origBtnHtml;
    }, 2200);
    showToast('高清对话分享长图已生成并开始下载！');
  });

  // 「🪄 帮我回一句」一键直接结合当前最新剧情填入输入框（点完一轮再点自动向后台换新一批）
  let cachedSuggestedReplies = [];
  let cachedSuggestSessionId = '';
  let cachedSuggestMsgLen = -1;
  let suggestCursor = 0;

  async function fillSmartSuggestedReply(triggerBtn) {
    if (!state.activeSessionId) return;
    const draftMenuBtn = document.getElementById('magic-ai-draft-btn');
    const mainMagicBtn = document.getElementById('magic-popover-btn');
    const curMsgLen = state.messages.length;
    const isSameTurn =
      cachedSuggestSessionId === state.activeSessionId &&
      cachedSuggestMsgLen === curMsgLen;
    const needFetchNew =
      !isSameTurn ||
      cachedSuggestedReplies.length === 0 ||
      suggestCursor >= cachedSuggestedReplies.length;
    const excludeList = isSameTurn ? cachedSuggestedReplies.slice(-9) : [];

    try {
      if (needFetchNew) {
        if (draftMenuBtn) draftMenuBtn.textContent = '正在结合最新剧情想台词…';
        if (triggerBtn === mainMagicBtn && mainMagicBtn) {
          mainMagicBtn.disabled = true;
        }
        const res = await apiJson(`/api/sessions/${encodeURIComponent(state.activeSessionId)}/suggest-replies`, {
          method: 'POST',
          body: JSON.stringify({
            exclude: excludeList,
            nonce: Date.now()
          })
        });
        cachedSuggestedReplies = Array.isArray(res.replies) && res.replies.length > 0 ? res.replies : [];
        cachedSuggestSessionId = state.activeSessionId;
        cachedSuggestMsgLen = curMsgLen;
        suggestCursor = 0;
      }
      if (cachedSuggestedReplies.length > 0) {
        const picked = cachedSuggestedReplies[suggestCursor];
        suggestCursor += 1;
        chatInput.value = picked;
        syncComposerEmptyState();
        hidePopoverSafe('magic-quick-popover');
        chatInput.focus();
        const isLastInBatch = suggestCursor >= cachedSuggestedReplies.length;
        showToast(
          isLastInBatch
            ? `已填入第 ${suggestCursor}/${cachedSuggestedReplies.length} 句（再点将按当前剧情重生成新一句）`
            : `已结合剧情写好回复（第 ${suggestCursor}/${cachedSuggestedReplies.length} 句，再点换下一句）`,
          2400
        );
      }
    } catch {
      const lastAiMsg = [...state.messages].reverse().find((m) => m.role === 'assistant');
      const snippet = String(lastAiMsg?.content || '')
        .replace(/\*[^*]*\*/g, '')
        .replace(/[「」"'“”\n]/g, ' ')
        .trim()
        .slice(0, 14);
      const dynamicFallbacks = snippet
        ? [
            `“你刚才说‘${snippet}…’是指现在就要这样决定吗？”`,
            `*停下步子看向你* 所以关于“${snippet}”，你心里其实早有打算了？`,
            `先把这句接住——那接下来呢，我们要怎么算？`
          ]
        : [
            `先把刚才那件事说清楚，我可没打算就这么敷衍过去。`,
            `*抬眼直视着你* 你先别急着下结论，听我把话说完好不好？`,
            `行，那就按你说的试试看，不过条件得由我来挑。`
          ];
      chatInput.value = dynamicFallbacks[suggestCursor % dynamicFallbacks.length];
      suggestCursor += 1;
      syncComposerEmptyState();
      hidePopoverSafe('magic-quick-popover');
      chatInput.focus();
      showToast('已为你填入一句回复，可直接发送或按喜好微调！', 2400);
    } finally {
      if (draftMenuBtn) {
        draftMenuBtn.textContent = '帮我想一句回复填入输入框（可连点换一句）';
      }
      if (mainMagicBtn) {
        mainMagicBtn.disabled = false;
      }
    }
  }

  document.getElementById('magic-popover-btn')?.addEventListener('click', (e) => {
    e.preventDefault();
    fillSmartSuggestedReply(e.currentTarget);
  });

  document.getElementById('magic-ai-draft-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    fillSmartSuggestedReply(e.currentTarget);
  });

  const autoProactiveChk = document.getElementById('st-auto-proactive-chk');
  if (autoProactiveChk) {
    autoProactiveChk.checked = localStorage.getItem('pref_auto_proactive') === '1';
  }

  // 全局生产力快捷键（Ctrl/Cmd + K 搜索历史对话，Alt + N 开启新对话）
  document.addEventListener('keydown', (e) => {
    if ((state.uiMode !== 'deepseek' && state.uiMode !== 'phone-agent') || !state.user) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (appShell.classList.contains('left-collapsed')) {
        appShell.classList.remove('left-collapsed');
        expandLeftBtn.classList.add('hidden');
      }
      const wrap = document.getElementById('ds-session-search-wrap');
      const inp = document.getElementById('ds-session-search-input');
      if (wrap && inp) {
        wrap.classList.remove('hidden');
        inp.focus();
        inp.select();
      }
    } else if (e.altKey && e.key.toLowerCase() === 'n') {
      e.preventDefault();
      document.getElementById('ds-new-chat-btn')?.click();
    }
  });

  // 全家桶面板：盘古磁盘缓存汇总、账户余额查询 (/user/balance) 与快捷绑 Key
  function renderDeepSeekSuiteTelemetry() {
    let sumHit = 0;
    let sumMiss = 0;
    let sumReason = 0;
    for (const m of state.messages) {
      if (m.role !== 'assistant') continue;
      const meta = parseMsgMeta(m);
      if (meta.usage) {
        sumHit += meta.usage.prompt_cache_hit_tokens || 0;
        sumMiss += meta.usage.prompt_cache_miss_tokens || 0;
        sumReason += meta.usage.reasoning_tokens || 0;
      }
    }
    const totalP = Math.max(1, sumHit + sumMiss);
    const rate = sumHit + sumMiss > 0 ? Math.round((sumHit / totalP) * 100) : 0;
    const hitW = sumHit + sumMiss > 0 ? Math.max(8, rate) : 50;

    const rateBadge = document.getElementById('ds-cache-rate-badge');
    const barHit = document.getElementById('bar-ds-hit');
    const barMiss = document.getElementById('bar-ds-miss');
    if (rateBadge) rateBadge.textContent = `命中率 ${rate}%`;
    if (barHit) barHit.style.width = `${hitW}%`;
    if (barMiss) barMiss.style.width = `${100 - hitW}%`;

    const elHit = document.getElementById('val-ds-hit');
    const elMiss = document.getElementById('val-ds-miss');
    const elReason = document.getElementById('val-ds-reason');
    if (elHit) elHit.textContent = sumHit;
    if (elMiss) elMiss.textContent = sumMiss;
    if (elReason) elReason.textContent = sumReason;

    window.DeepSeekMonitorPlugin?.sync({
      settings: state.settings,
      messages: state.messages,
      forceBalanceRefresh: false
    });
  }

  window.__openOwnApiSettings = () => openSettingsModal(true);

  document.getElementById('open-ds-inspector-btn')?.addEventListener('click', () => {
    if (appShell.classList.contains('right-collapsed')) {
      openRightTab('ds-suite-tab');
      renderDeepSeekSuiteTelemetry();
    } else {
      setRightPanelCollapsed(true, true);
    }
  });
  document.getElementById('ds-composer-api-chip')?.addEventListener('click', () => {
    openSettingsModal(true);
  });
  document.getElementById('ds-menu-own-api-quick-btn')?.addEventListener('click', () => {
    hidePopoverSafe('ds-user-popover');
    openSettingsModal(true);
  });
  document.getElementById('more-open-own-api-btn')?.addEventListener('click', () => {
    hidePopoverSafe('topbar-more-popover');
    openSettingsModal(true);
  });
  document.getElementById('more-open-prefs-btn')?.addEventListener('click', () => {
    hidePopoverSafe('topbar-more-popover');
    openSettingsModal(false);
  });

  // ✨ 灵感补写小助手（面向纯小白的零门槛开箱即用剧情搭桥器）
  const fimPromptInput = document.getElementById('fim-prompt-input');
  const fimSuffixInput = document.getElementById('fim-suffix-input');
  const fimOutputWrap = document.getElementById('fim-output-wrap');
  const fimResultPre = document.getElementById('fim-result-pre');
  let latestFimMerged = '';
  let currentFimTone = 'gentle';
  let fimVariantCounter = 0;

  const FIM_STORY_PRESETS = {
    rain: {
      prompt: '窗外的雨越下越大，我们在老街屋檐下意外重逢。四目相对的那一刻，空气仿佛安静了下来。',
      suffix: '他终于轻轻叹了口气，把带着余温的外套披在了我的肩上。'
    },
    prose: {
      prompt: '展信佳。原本以为离开雾港之后，许多旧事都会随着海风慢慢淡去。\n',
      suffix: '\n所以今夜路过钟楼时，我还是忍不住停下脚步给你写了这封信。'
    },
    tsundere: {
      prompt: '“我才不是专程在楼下等你的，只是恰好顺路经过而已。”我别过脸小声嘴硬道。',
      suffix: '最后还是没忍住弯起嘴角，把手里的热奶茶塞进了他的掌心。'
    },
    persona: {
      prompt: '在旁人眼中，他是白塔里最清冷孤高、从不近人情的首席执行官。',
      suffix: '唯独面对你时，他才会卸下所有防备，露出笨拙又温柔的一面。'
    }
  };

  const FIM_TONE_LABELS = {
    gentle: '细腻温柔',
    tension: '暧昧拉扯',
    vivid: '画面感拉满',
    concise: '简短自然'
  };

  function applyFimPreset(presetKey) {
    const item = FIM_STORY_PRESETS[presetKey] || FIM_STORY_PRESETS.rain;
    fimPromptInput.value = item.prompt;
    fimSuffixInput.value = item.suffix;
    fimOutputWrap.classList.add('hidden');
    document.querySelectorAll('.fim-preset-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.preset === presetKey);
    });
  }

  function openFimLab() {
    if (!fimPromptInput.value.trim() && !fimSuffixInput.value.trim()) {
      applyFimPreset('rain');
    }
    // 下一宏任务打开，避免从 Popover 点击时被浏览器原生 closedby="any" 误判为外部点击秒关
    setTimeout(() => {
      if (!fimDialog.open) fimDialog.showModal();
    }, 20);
  }

  document.getElementById('open-fim-dialog-btn')?.addEventListener('click', openFimLab);
  document.getElementById('inspector-open-fim-btn')?.addEventListener('click', openFimLab);
  document.getElementById('inspector-open-memory-btn')?.addEventListener('click', () => {
    openRightTab('memory-tab');
    renderTelemetryAndMemories();
  });
  document.getElementById('ds-menu-memory-btn')?.addEventListener('click', () => {
    hidePopoverSafe('ds-user-popover');
    openRightTab('memory-tab');
    renderTelemetryAndMemories();
  });
  document.getElementById('more-open-ds-memory-btn')?.addEventListener('click', () => {
    hidePopoverSafe('topbar-more-popover');
    openRightTab('memory-tab');
    renderTelemetryAndMemories();
  });
  document.getElementById('more-ds-memory-btn')?.addEventListener('click', () => {
    hidePopoverSafe('topbar-more-popover');
    openRightTab('memory-tab');
    renderTelemetryAndMemories();
  });
  document.getElementById('more-ds-suite-btn')?.addEventListener('click', () => {
    hidePopoverSafe('topbar-more-popover');
    openRightTab('ds-suite-tab');
    renderDeepSeekSuiteTelemetry();
  });
  document.getElementById('inspector-mem-export-btn')?.addEventListener('click', () => {
    document.getElementById('more-open-share-btn')?.click();
  });
  document.getElementById('inspector-mem-import-btn')?.addEventListener('click', () => {
    openImportHistoryModal();
  });
  document.getElementById('inspector-suite-export-btn')?.addEventListener('click', () => {
    document.getElementById('more-open-share-btn')?.click();
  });
  document.getElementById('inspector-suite-import-btn')?.addEventListener('click', () => {
    openImportHistoryModal();
  });
  document.getElementById('more-open-fim-btn')?.addEventListener('click', () => {
    hidePopoverSafe('topbar-more-popover');
    openFimLab();
  });
  document.getElementById('magic-open-fim-chip')?.addEventListener('click', () => {
    hidePopoverSafe('magic-quick-popover');
    openFimLab();
  });
  document.getElementById('close-fim-dialog').addEventListener('click', () => fimDialog.close());
  document.getElementById('cancel-fim-dialog').addEventListener('click', () => fimDialog.close());

  document.querySelectorAll('.fim-preset-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      applyFimPreset(btn.dataset.preset || 'rain');
    });
  });

  // 一键把当前正在聊的最新内容带入补写框，真正实现与角色扮演无缝联动
  document.getElementById('fim-from-chat-btn')?.addEventListener('click', () => {
    document.querySelectorAll('.fim-preset-btn').forEach((b) => b.classList.remove('active'));
    const actorName = (state.activePersona?.name || '').split(/[·\s]/)[0] || '他';
    const cleanActor = actorName === 'DeepSeek' ? '对方' : actorName;
    const draftInBox = chatInput.value.trim();

    if (draftInBox) {
      fimPromptInput.value = draftInBox;
      fimSuffixInput.value = `听完我的话，${cleanActor}的眼神渐渐柔和下来，轻轻握住了我的指尖。`;
      showToast('已带入你输入框里写了一半的草稿，点右下角即可帮你接上！');
    } else if (state.messages.length > 0) {
      const lastMsg = state.messages[state.messages.length - 1];
      const snippet = String(lastMsg.content || '')
        .replace(/^>.*$/gm, '')
        .trim()
        .slice(-140);
      fimPromptInput.value = snippet || `看着眼前的${cleanActor}，我一时不知道该怎么开口接话。`;
      fimSuffixInput.value = `我深吸了一口气，终于抬起眼眸认真地回应了${cleanActor}的心意。`;
      showToast('已自动带入当前聊天的最新进展，可直接生成过渡回复！');
    } else {
      const intro = state.activePersona?.tagline || '微风吹过安静的街角，我们的目光刚好撞在一起。';
      fimPromptInput.value = intro;
      fimSuffixInput.value = `${cleanActor}率先打破了沉默，朝我露出了温柔的浅笑。`;
      showToast('已结合当前角色设定生成开头与结尾，点右下角试试吧！');
    }
    fimOutputWrap.classList.add('hidden');
  });

  // 一键切换补写氛围感觉（无需小白调温度或字数参数）
  document.querySelectorAll('.fim-tone-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      currentFimTone = chip.dataset.tone || 'gentle';
      document.querySelectorAll('.fim-tone-chip').forEach((c) => {
        const isSel = c === chip;
        c.classList.toggle('active', isSel);
        c.setAttribute('aria-pressed', String(isSel));
      });
    });
  });

  // 左右文本框便捷清空按钮（长内容防误触确认）
  document.querySelectorAll('.fim-clear-mini[data-clear-target]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const targetEl = document.getElementById(btn.dataset.clearTarget);
      if (!targetEl) return;
      if (targetEl.value.trim().length > 20) {
        const confirmed = await askUserConfirm({
          title: '确认清空输入内容',
          message: '确定要清空此文本框内已编写的内容吗？',
          confirmText: '确认清空',
          danger: true
        });
        if (!confirmed) return;
      }
      targetEl.value = '';
      targetEl.focus();
    });
  });

  let fimAbortCtrl = null;
  document.getElementById('cancel-fim-stream-btn')?.addEventListener('click', () => {
    if (fimAbortCtrl) {
      fimAbortCtrl.abort();
      fimAbortCtrl = null;
    }
  });

  async function executeFimCompletion(isRerun = false) {
    const runBtn = document.getElementById('run-fim-btn');
    const rerunBtn = document.getElementById('rerun-fim-btn');
    const progCard = document.getElementById('fim-progress-card');
    const progBar = document.getElementById('fim-progress-bar');
    const progLbl = document.getElementById('fim-progress-label');

    if (isRerun) {
      fimVariantCounter += 1;
    }
    runBtn.disabled = true;
    if (rerunBtn) rerunBtn.disabled = true;
    runBtn.textContent = '正在为你构思过渡情节…';
    if (progCard) progCard.classList.remove('hidden');
    if (progBar) progBar.value = 15;

    let pct = 15;
    const fimTimer = setInterval(() => {
      pct = Math.min(92, pct + 6);
      if (progBar) progBar.value = pct;
      if (progLbl) {
        progLbl.textContent =
          pct < 55
            ? '正在结合开头与结尾构思自然衔接细节…'
            : '正在润色人物动作与语气，马上就好…';
      }
    }, 800);

    fimAbortCtrl = new AbortController();
    try {
      const res = await apiJson('/api/deepseek/fim', {
        method: 'POST',
        signal: fimAbortCtrl.signal,
        body: JSON.stringify({
          prompt: fimPromptInput.value,
          suffix: fimSuffixInput.value,
          tone: currentFimTone,
          persona_name: state.activePersona?.name || '',
          variant: fimVariantCounter,
          max_tokens: 512
        })
      });
      if (progBar) progBar.value = 100;
      latestFimMerged = res.merged || '';
      fimResultPre.innerHTML = `${escapeHtml(fimPromptInput.value)}<mark class="fim-mid-highlight">${escapeHtml(
        res.completion
      )}</mark>${escapeHtml(fimSuffixInput.value)}`;
      fimOutputWrap.classList.remove('hidden');
      const toneLabel = FIM_TONE_LABELS[currentFimTone] || '细腻温柔';
      document.getElementById('fim-usage-hint').textContent = `已按「${toneLabel}」感觉补齐 ${
        (res.completion || '').trim().length
      } 字 · 点上方「一键填入聊天框」即可直接使用`;
    } catch (err) {
      if (err?.name === 'AbortError') {
        showToast('已取消本次灵感补写');
      } else {
        showToast(`${err.message}`);
      }
    } finally {
      clearInterval(fimTimer);
      fimAbortCtrl = null;
      if (progCard) progCard.classList.add('hidden');
      runBtn.disabled = false;
      if (rerunBtn) rerunBtn.disabled = false;
      runBtn.textContent = '帮我补齐中间剧情';
    }
  }

  document.getElementById('fim-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    await executeFimCompletion(false);
  });

  document.getElementById('rerun-fim-btn')?.addEventListener('click', () => {
    executeFimCompletion(true);
  });

  document.getElementById('copy-fim-merged-btn').addEventListener('click', async () => {
    if (!latestFimMerged) return;
    await navigator.clipboard.writeText(latestFimMerged).catch(() => {});
    showToast('已复制整段内容，随时可粘贴使用');
  });

  document.getElementById('send-fim-to-chat-btn')?.addEventListener('click', () => {
    if (!latestFimMerged) return;
    chatInput.value = latestFimMerged;
    syncComposerEmptyState();
    fimDialog.close();
    chatInput.focus();
    showToast('已填入下方聊天框，可直接发送或按喜好微调哦！');
  });

  // 🌟 多一点主动性核心引擎：仅在恋庭沉浸扮演模式下发起主动关怀（锁定发起会话 ID 严防串台）
  async function triggerProactiveMessage(triggerReason = 'manual', opts = {}) {
    if (state.isStreaming || !state.activeSessionId) return;
    if (state.uiMode === 'deepseek' || state.uiMode === 'phone-agent' || state.activeSession?.session_mode === 'deepseek_native') return;
    const originSessionId = state.activeSessionId;
    const isStillOriginSession = () => state.activeSessionId === originSessionId;
    const isDsUi = false;

    // 退出空对话居中态以便流式展示主动消息
    document.querySelector('.chat-stage')?.classList.remove('ds-empty-mode');
    const welcomeHero = messagesContainer.querySelector('.ds-welcome-hero');
    if (welcomeHero) welcomeHero.remove();

    const liveRow = document.createElement('div');
    liveRow.className = 'msg-row assistant awaiting-first-token';

    const avatarEl = document.createElement('div');
    avatarEl.className = 'msg-avatar';
    populateAssistantAvatar(avatarEl, isDsUi);

    const bodyEl = document.createElement('div');
    bodyEl.className = 'msg-body';

    const proBadge = document.createElement('div');
    proBadge.className = 'proactive-msg-badge';
    proBadge.textContent = isDsUi
      ? '延伸思考 · 主动跟进'
      : `${state.activePersona?.name?.split(/[·\s]/)[0] || '他'}正在主动向你搭话…`;
    bodyEl.appendChild(proBadge);

    const thoughtDetails = document.createElement('details');
    thoughtDetails.className = 'thought-details hidden';
    thoughtDetails.open = false; // 默认不展开
    thoughtDetails.innerHTML = `
      <summary class="thought-summary">
        ${isDsUi ? DS_THINK_CHEVRON_SVG : ''}
        ${isDsUi ? DS_THINK_BADGE_SVG : ''}
        <span class="live-thought-label">${isDsUi ? '思考中...' : '主动搭话前的潜台词…'}</span>
        ${!isDsUi ? '<span class="thought-chevron">▼</span>' : ''}
      </summary>
      <div class="thought-content streaming-cursor"></div>
    `;

    const proseEl = document.createElement('div');
    proseEl.className = 'assistant-prose streaming-cursor';
    proseEl.innerHTML = '<span class="shimmer-thinking-wrap"><span class="shimmer-thinking-text">正在走近你…</span></span>';

    bodyEl.appendChild(thoughtDetails);
    bodyEl.appendChild(proseEl);
    liveRow.appendChild(avatarEl);
    liveRow.appendChild(bodyEl);
    messagesContainer.appendChild(liveRow);
    scrollToBottom(true);

    const thoughtContentEl = thoughtDetails.querySelector('.thought-content');
    const abortController = new AbortController();
    state.streamingAbort = abortController;
    state.streamingSessionId = originSessionId;
    state.userStoppedStream = false;
    setStreamingUi(true);

    let accReasoning = '';
    let accContent = '';
    let proactiveRafId = 0;
    let proReasoningDirty = false;
    let proContentDirty = false;

    const flushProactiveDom = () => {
      proactiveRafId = 0;
      if (!isStillOriginSession()) return;
      if (proReasoningDirty) {
        proReasoningDirty = false;
        thoughtDetails.classList.remove('hidden');
        if (isDsUi) {
          thoughtContentEl.innerHTML = formatDsReasoningHtml(accReasoning);
        } else {
          thoughtContentEl.textContent = accReasoning;
        }
      }
      if (proContentDirty) {
        proContentDirty = false;
        thoughtContentEl.classList.remove('streaming-cursor');
        proseEl.innerHTML = renderMessageMarkdown(accContent, [], {
          isStreaming: true,
          streamKeyPrefix: 'pro_live_cb'
        });
      }
      scheduleScrollToBottom(false);
    };

    const scheduleProactiveFlush = () => {
      if (!proactiveRafId) {
        proactiveRafId = requestAnimationFrame(flushProactiveDom);
      }
    };

    try {
      const response = await fetch('/api/chat/proactive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: originSessionId,
          trigger_reason: triggerReason,
          include_follow_ups: isShowFollowUpsEnabled()
        }),
        signal: abortController.signal
      });

      if (!response.ok || !response.body) {
        liveRow.remove();
        return;
      }

      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let receivedDoneEvent = false;

      const handleSseBlock = (rawBlock) => {
        if (!isStillOriginSession()) return;
        const lines = rawBlock.split(/\r?\n/);
        let eventName = 'message';
        let dataStr = '';
        for (const l of lines) {
          if (l.startsWith(':')) continue;
          if (l.startsWith('event:')) eventName = l.slice(6).trim();
          else if (l.startsWith('data:')) dataStr += l.slice(5).trim();
        }
        if (!dataStr) return;
        let payload = {};
        try {
          payload = JSON.parse(dataStr);
        } catch {
          return;
        }

        if (eventName === 'reasoning') {
          liveRow.classList.remove('awaiting-first-token');
          accReasoning += payload.delta || '';
          proReasoningDirty = true;
          scheduleProactiveFlush();
        } else if (eventName === 'content') {
          liveRow.classList.remove('awaiting-first-token');
          accContent += payload.delta || '';
          proContentDirty = true;
          scheduleProactiveFlush();
        } else if (eventName === 'done') {
          if (proactiveRafId) {
            cancelAnimationFrame(proactiveRafId);
            proactiveRafId = 0;
          }
          receivedDoneEvent = true;
          const proMsg = {
            id: payload.message_id,
            role: 'assistant',
            reasoning: accReasoning,
            content: accContent,
            duration_ms: payload.duration_ms,
            recalled_count: payload.recalled_count,
            meta: payload.meta || { is_proactive: true }
          };
          state.messages.push(proMsg);
          if (Array.isArray(payload.sessions)) state.sessions = payload.sessions;
          setStreamingUi(false);
          trimPreviousLastAssistantDecorations();
          const wasProThoughtUserOpened = Boolean(liveRow?.querySelector('.thought-details')?.open);
          const finalProRow = createAssistantMessageDom(proMsg, true);
          if (wasProThoughtUserOpened) {
            const finalProDetails = finalProRow?.querySelector('.thought-details');
            if (finalProDetails) finalProDetails.open = true;
          }
          if (liveRow.parentNode) {
            liveRow.replaceWith(finalProRow);
          } else {
            messagesContainer.appendChild(finalProRow);
          }
          syncArtifactsIndicator();
          updateBondBadge();
          syncComposerEmptyState();
          scheduleScrollToBottom(false);
          renderSessionList();
          if (triggerReason === 'idle') {
            showToast('看你安静了一会儿，TA 主动给你发来了一条新消息');
          } else if (triggerReason === 'return' || triggerReason === 'late_night_return') {
            showToast(
              triggerReason === 'late_night_return'
                ? '夜深重逢，TA 轻声向你发来了一段问候'
                : '欢迎回来！TA 一看到你就主动迎上来打招呼啦'
            );
          }
          if (opts && opts.autoSpeak && accContent.trim()) {
            const ttsBtn = finalProRow?.querySelector('.tts-btn') || null;
            speakDialogueOnly(accContent, ttsBtn);
          }
        }
      };

      for await (const chunk of response.body) {
        if (!isStillOriginSession()) break;
        buffer += decoder.decode(chunk, { stream: true });
        const events = buffer.split(/\r?\n\r?\n/);
        buffer = events.pop() || '';
        for (const rawBlock of events) {
          handleSseBlock(rawBlock);
        }
      }
      if (isStillOriginSession()) {
        buffer += decoder.decode();
        if (buffer.trim() && !receivedDoneEvent) {
          handleSseBlock(buffer);
        }
      }
    } catch {
      liveRow.remove();
    } finally {
      if (proactiveRafId) {
        cancelAnimationFrame(proactiveRafId);
        proactiveRafId = 0;
      }
      if (state.streamingAbort === abortController) {
        state.streamingAbort = null;
        state.streamingSessionId = null;
        setStreamingUi(false);
      }
      state.lastInteractionAt = Date.now();
    }
  }

  document.getElementById('proactive-now-btn').addEventListener('click', () => {
    triggerProactiveMessage('manual');
  });

  const magicProChip = document.getElementById('magic-proactive-chip');
  if (magicProChip) {
    magicProChip.addEventListener('click', () => triggerProactiveMessage('manual'));
  }

  document.getElementById('toggle-proactive-btn').addEventListener('click', async () => {
    const curEnabled =
      localStorage.getItem('pref_auto_proactive') === '1' &&
      Number(state.activeSession?.proactive_enabled) === 1;
    const next = !curEnabled;
    try {
      localStorage.setItem('pref_auto_proactive', next ? '1' : '0');
    } catch {}
    const autoProChk = document.getElementById('st-auto-proactive-chk');
    if (autoProChk) autoProChk.checked = next;
    const proBtnEl = document.getElementById('toggle-proactive-btn');
    if (proBtnEl) {
      proBtnEl.classList.toggle('active', next);
      proBtnEl.setAttribute('aria-pressed', String(next));
      proBtnEl.textContent = next
        ? '角色安静时自动搭话：已开启'
        : '角色安静时自动搭话：已关闭';
    }
    await patchActiveSessionFlag(
      { proactive_enabled: next },
      next
        ? '已开启空闲主动搭话（停顿较久时角色会主动开口找你）'
        : '已关闭自动主动搭话（默认安静不打断，可随时点「让 TA 开口」）'
    );
  });

  chatInput.addEventListener('keydown', () => {
    state.lastInteractionAt = Date.now();
  });
  chatInput.addEventListener('input', syncComposerEmptyState);

  // 原生侧栏搜索历史与左下角 ⋯ 菜单动作绑定
  const dsSearchBtn = document.getElementById('ds-search-sessions-btn');
  const dsSearchWrap = document.getElementById('ds-session-search-wrap');
  const dsSearchInput = document.getElementById('ds-session-search-input');
  if (dsSearchBtn && dsSearchWrap && dsSearchInput) {
    dsSearchBtn.addEventListener('click', () => {
      const open = dsSearchWrap.classList.toggle('hidden') === false;
      if (open) {
        dsSearchInput.focus();
      } else {
        dsSearchInput.value = '';
        renderSessionList();
      }
    });
    dsSearchInput.addEventListener(
      'input',
      debounce(() => renderSessionList(), 120)
    );
  }

  function hidePopoverSafe(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('manual-popover-open');
    if (id === 'topbar-more-popover') {
      document.getElementById('topbar-more-btn')?.setAttribute('aria-expanded', 'false');
    } else if (id === 'magic-quick-popover') {
      document.getElementById('magic-menu-trigger-btn')?.setAttribute('aria-expanded', 'false');
    } else if (id === 'ds-user-popover') {
      document.getElementById('ds-profile-btn')?.setAttribute('aria-expanded', 'false');
    }
    if (typeof el.hidePopover === 'function') {
      try {
        el.hidePopover();
      } catch {}
    }
  }

  document.getElementById('ds-menu-proactive-btn')?.addEventListener('click', () => {
    hidePopoverSafe('ds-user-popover');
    triggerProactiveMessage('manual');
  });
  document.getElementById('ds-pop-proactive-btn')?.addEventListener('click', () => {
    hidePopoverSafe('ds-adv-popover');
    triggerProactiveMessage('manual');
  });
  document.getElementById('ds-menu-api-btn')?.addEventListener('click', () => {
    hidePopoverSafe('ds-user-popover');
    openRightTab('ds-suite-tab');
    renderDeepSeekSuiteTelemetry();
  });
  document.getElementById('ds-menu-fim-btn')?.addEventListener('click', () => {
    hidePopoverSafe('ds-user-popover');
    openFimLab();
  });
  document.getElementById('ds-pop-fim-btn')?.addEventListener('click', () => {
    hidePopoverSafe('ds-adv-popover');
    openFimLab();
  });
  document.getElementById('ds-menu-switch-rp-btn')?.addEventListener('click', () => {
    hidePopoverSafe('ds-user-popover');
    switchWorkspaceMode('roleplay');
  });
  document.getElementById('ds-menu-settings-btn')?.addEventListener('click', () => {
    hidePopoverSafe('ds-user-popover');
    openSettingsModal();
  });
  document.getElementById('ds-menu-skin-studio-btn')?.addEventListener('click', () => {
    hidePopoverSafe('ds-user-popover');
    openMobileSkinStudio();
  });
  document.getElementById('ds-menu-avatar-studio-btn')?.addEventListener('click', () => {
    hidePopoverSafe('ds-user-popover');
    openMobileAvatarStudio();
  });
  document.getElementById('sidebar-skin-studio-btn')?.addEventListener('click', () => {
    openMobileSkinStudio();
  });

  // 静默陪伴自动搭话心跳检查（默认严格关闭，仅在用户显式开启 pref_auto_proactive 且会话允许时生效）
  setInterval(() => {
    if (
      !state.user ||
      !state.activeSessionId ||
      state.uiMode === 'deepseek' ||
      state.uiMode === 'phone-agent' ||
      state.activeSession?.session_mode === 'deepseek_native' ||
      state.isStreaming ||
      state.tourActive ||
      localStorage.getItem('pref_auto_proactive') !== '1' ||
      Number(state.activeSession?.proactive_enabled) !== 1 ||
      state.proactiveIdleCount >= 1 ||
      chatInput.value.trim().length > 0
    ) {
      return;
    }
    const idleSec = (Date.now() - state.lastInteractionAt) / 1000;
    const thresholdSec = Math.max(180, parseInt(state.settings.proactive_idle_sec || '300', 10));
    if (idleSec >= thresholdSec) {
      state.proactiveIdleCount += 1;
      triggerProactiveMessage('idle');
    }
  }, 10000);

  // ================= 14. 进入工作台与首次登录检测 =================
  async function enterWorkspace(prefetchedBoot = null, opts = {}) {
    const silentReconcile = Boolean(opts && opts.silentReconcile);
    const fromSwr = Boolean(opts && opts.fromSwr);
    if (!silentReconcile) {
      bootEnterStartedAt = Date.now();
    }

    isSwitchingAccountOverlay = false;
    document.getElementById('auth-back-to-chat-btn')?.classList.add('hidden');
    document.getElementById('auth-close-x-btn')?.classList.add('hidden');
    document.getElementById('auth-confirm-signout-btn')?.classList.add('hidden');
    try {
      sessionStorage.removeItem('manual_account_switch');
    } catch {}
    if (!authGate.classList.contains('hidden')) {
      authGate.classList.add('auth-gate-opening');
      setTimeout(() => {
        authGate.classList.add('hidden');
        authGate.classList.remove('auth-gate-opening');
        authGate.style.removeProperty('display');
      }, 280);
    } else {
      authGate.classList.add('hidden');
      authGate.style.removeProperty('display');
    }
    appShell.classList.remove('hidden');
    appShell.style.removeProperty('display');
    dismissBootSplash();

    const boot = prefetchedBoot || (await apiJson(`/api/bootstrap?${buildBootstrapQueryParams(false)}`));
    if (!boot || !boot.user) return;

    state.user = boot.user;
    window.__STAR_CURRENT_USER__ = boot.user;
    window.__showAuthScreen = showAuthScreen;
    window.__STAR_ENTER_WORKSPACE__ = enterWorkspace;
    if (boot.user?.id) {
      window.__starAuthStore?.setActiveUserId(boot.user.id);
    }
    state.scripts = boot.scripts || [];
    if (Array.isArray(boot.square_items) && (boot.square_items.length > 0 || state.squareItems.length === 0)) {
      state.squareItems = boot.square_items;
    }
    state.personas = boot.personas || [];
    state.sessions = boot.sessions || [];
    state.settings = boot.settings || {};
    if (boot.local_antigravity_status) {
      state.antigravityStatus = { ...boot.local_antigravity_status, checked: true };
      syncLlmModeUi();
    }
    if (window.AppearanceSystem) {
      window.AppearanceSystem.syncFromServer(state.settings.skin_config);
      window.AppearanceSystem.initSkinStudio('skin-studio-root');
    }
    state.membership = boot.membership || state.membership;
    state.wallet = boot.wallet || null;
    if (boot.app_version) {
      state.appVersion = String(boot.app_version).replace(/^v/i, '');
    }
    syncWebVersionBadges(state.appVersion);

    if (state.scripts.length > 0 && !state.scripts.some((s) => s.id === state.activeScriptId)) {
      state.activeScriptId = state.scripts[0].id;
    }

    if (!silentReconcile) {
      applyUiModeVisuals(state.uiMode);
      // 桌面宽屏下恢复或默认展开恋庭右侧面板（展示 💞养成 / 🧠记忆 / 🎯设定）
      try {
        const isDesktopWide = window.matchMedia('(min-width: 1180px)').matches;
        const savedRightPref = localStorage.getItem('right_panel_collapsed_v1');
        if (state.uiMode === 'roleplay' && isDesktopWide && savedRightPref !== '1') {
          openRightTab('nurture-tab', false);
        } else if (savedRightPref === '0' && !window.matchMedia('(max-width: 860px)').matches) {
          openRightTab(state.uiMode === 'roleplay' ? 'nurture-tab' : 'memory-tab', false);
        }
      } catch {}
    }

    syncActiveScriptVisuals();
    renderUserAndMembership();
    if (state.wallet && typeof refreshWalletOverview === 'function') {
      Promise.resolve(refreshWalletOverview()).catch(() => {});
    }
    renderPersonaList();
    renderSessionList();

    // 若后台对账返回期间用户已主动切换了其他会话或正在流式回复，仅更新侧栏列表，不覆盖当前会话
    const userMovedAway = silentReconcile && (userManualSessionSwitchAt > bootEnterStartedAt || state.isStreaming);
    if (!userMovedAway) {
      const isPhoneAgentBoot = state.uiMode === 'phone-agent';
      const isDsBoot = state.uiMode === 'deepseek';
      const preferredSessions = state.sessions.filter((s) =>
        isDsBoot ? s.session_mode === 'deepseek_native' : s.session_mode !== 'deepseek_native'
      );

      const inlinePayload = boot.initial_session_payload;
      const inlineModeMatch =
        inlinePayload &&
        inlinePayload.session &&
        !isPhoneAgentBoot &&
        (isDsBoot
          ? inlinePayload.session.session_mode === 'deepseek_native'
          : inlinePayload.session.session_mode !== 'deepseek_native');

      if (isPhoneAgentBoot) {
        if (!silentReconcile) {
          applyUiModeVisuals('phone-agent');
          if (window.PhoneAgent && typeof window.PhoneAgent.onEnterMode === 'function') {
            window.PhoneAgent.onEnterMode();
          }
        }
      } else if (inlineModeMatch) {
        await applySessionDetailPayload(inlinePayload.session.id, inlinePayload, {
          fromCache: fromSwr,
          silentReconcile
        });
      } else if (isDsBoot) {
        const reusableBlank =
          preferredSessions.find((s) => s.title === '新对话' && s.persona_id === 'persona_deepseek_official') ||
          preferredSessions[0];
        if (reusableBlank) {
          await loadSession(reusableBlank.id);
        } else if (!fromSwr) {
          await startNativeDeepSeekSession('persona_deepseek_official');
        }
      } else {
        // 优先进入当前所选剧本下的会话或首位主角（新默认直接进入《樱坂坡道上的风》）
        const activeScriptSess = preferredSessions.find((s) => {
          const pObj = state.personas.find((x) => x.id === s.persona_id);
          return (s.script_id || resolvePersonaScriptId(pObj)) === state.activeScriptId;
        });
        if (activeScriptSess) {
          await loadSession(activeScriptSess.id);
        } else if (!fromSwr) {
          const firstCast = state.personas.find(
            (p) => p.id !== 'persona_deepseek_official' && resolvePersonaScriptId(p) === state.activeScriptId
          );
          if (firstCast) {
            await startSessionWithPersona(firstCast.id);
          } else if (preferredSessions.length > 0) {
            await loadSession(preferredSessions[0].id);
          }
        }
      }
    }

    if (fromSwr) return;

    const urlParams = new URLSearchParams(window.location.search);
    const isLiveDemoEntry =
      urlParams.get('demo') === '1' ||
      urlParams.get('demo') === 'true' ||
      window.location.hash === '#demo' ||
      Boolean(window.__isStaticLiveDemo);

    // 新访客/新用户首次进入恋庭模式时自动启动 4 步贴心新手引导（支持随时跳过或在更多菜单重看）
    if (
      state.uiMode === 'roleplay' &&
      state.user &&
      !state.user.onboarding_done &&
      !sessionStorage.getItem(`tour_shown_${state.user.id}`)
    ) {
      try {
        sessionStorage.setItem(`tour_shown_${state.user.id}`, '1');
      } catch {}
      setTimeout(() => {
        if (state.user && !state.user.onboarding_done && !state.tourActive) {
          startOnboardingTour();
        }
      }, 450);
    } else if (isLiveDemoEntry) {
      if (!sessionStorage.getItem('star_demo_welcomed')) {
        sessionStorage.setItem('star_demo_welcomed', '1');
        showToast('欢迎来到星语恋庭 · 点击左侧任意角色即可开启沉浸对话与真声陪伴');
      }
    }

    setTimeout(() => {
      checkAnnouncementOnStartup();
      checkLocalAntigravityStatus();
    }, 800);
  }

  async function checkAnnouncementOnStartup() {
    try {
      const res = await apiJson('/api/announcement');
      const ann = res?.announcement;
      if (!ann || !ann.enabled || !ann.title || !ann.content) return;

      const lastRead = localStorage.getItem('star_last_read_ann_id');
      const annKey = `${ann.id}_${ann.updated_at || ann.version || 1}`;
      if (lastRead === annKey) return;

      const dlg = document.getElementById('site-announcement-dialog');
      if (!dlg) return;

      const tEl = document.getElementById('site-ann-title');
      const timeEl = document.getElementById('site-ann-time');
      const cEl = document.getElementById('site-ann-content');
      if (tEl) tEl.textContent = ann.title;
      if (timeEl && ann.updated_at) {
        timeEl.textContent = new Date(ann.updated_at).toLocaleDateString('zh-CN', {
          year: 'numeric',
          month: 'long',
          day: 'numeric'
        });
      }
      if (cEl) {
        cEl.innerHTML = ann.content
          .split('\n')
          .filter(Boolean)
          .map((p) => `<p style="margin:0 0 8px 0;line-height:1.65;">${escapeHtml(p)}</p>`)
          .join('');
      }

      const closeAnn = () => {
        try { localStorage.setItem('star_last_read_ann_id', annKey); } catch {}
        if (dlg.open) dlg.close();
      };

      document.getElementById('site-ann-close-btn')?.addEventListener('click', closeAnn, { once: true });
      document.getElementById('site-ann-confirm-btn')?.addEventListener('click', closeAnn, { once: true });

      if (!dlg.open) dlg.showModal();
    } catch {}
  }

  async function bootCheck() {
    // 优雅防卡死安全锁：确保异常情况下首屏遮罩最终平滑移出
    const safetySplashTimer = setTimeout(() => {
      dismissBootSplash();
      if (appShell.classList.contains('hidden') && authGate.classList.contains('hidden')) {
        showAuthScreen();
      }
    }, 2800);

    const urlParams = new URLSearchParams(window.location.search);
    const needLoginMsg = urlParams.get('msg') === 'download_login_required' || urlParams.get('auth') === 'login';
    let hasLocalToken = Boolean(window.__starAuthStore?.getToken());

    // 优先同步检测并恢复 Android 原生凭证（解决原生冷启动时 SharedPreferences 已持久化凭证却因异步注入晚于首屏而未生效的问题）
    if (!hasLocalToken && window.AndroidAppBridge && typeof window.AndroidAppBridge.getAuthToken === 'function') {
      try {
        const nTok = window.AndroidAppBridge.getAuthToken();
        const nUserJson = window.AndroidAppBridge.getAuthUserJson();
        if (nTok && nUserJson) {
          const nUser = JSON.parse(nUserJson);
          if (nUser && (nUser.nickname || nUser.id)) {
            window.__starAuthStore?.setToken(nTok, true);
            if (nUser.id) window.__starAuthStore?.setActiveUserId(nUser.id);
            hasLocalToken = true;
          }
        }
      } catch {}
    }

    const isStandaloneDemo = Boolean(window.__isStaticLiveDemo) || window.location.protocol === 'file:';

    // 1. 离线单机演示模式
    if (isStandaloneDemo) {
      try {
        const boot = await apiJson('/api/bootstrap');
        if (boot && boot.authenticated !== false && boot.user) {
          applyAuthLoginPayload(
            { authenticated: true, user: boot.user, token: boot.token },
            { persistDefault: false, rememberGuest: false }
          );
          await enterWorkspace(boot);
          dismissBootSplash();
          return;
        }
        resetClientWorkspaceState();
        showAuthScreen();
      } catch {
        resetClientWorkspaceState();
        showAuthScreen();
      } finally {
        clearTimeout(safetySplashTimer);
        dismissBootSplash();
      }
      return;
    }

    // 2. 若本地已有令牌：立即尝试 0ms SWR 快照秒开，同时并发 1 次聚合请求无感对账
    let snapshotApplied = false;
    if (hasLocalToken) {
      const snap = loadBootSnapshot();
      if (snap) {
        snapshotApplied = true;
        applyAuthLoginPayload({ authenticated: true, user: snap.user }, { persistDefault: false, rememberGuest: false });
        await enterWorkspace(snap, { fromSwr: true });
        dismissBootSplash();
        clearTimeout(safetySplashTimer);
      }
    } else {
      // 无本地凭证：短暂展示开屏动效后平滑切换至登录门扉，兼顾首屏仪式感与手机端唤醒速度
      resetClientWorkspaceState();
      setTimeout(() => {
        if (!state.user && appShell.classList.contains('hidden')) {
          showAuthScreen();
        }
      }, 380);
    }

    try {
      const abortCtrl = new AbortController();
      const timeoutId = setTimeout(() => abortCtrl.abort(), 8000);
      let boot;
      try {
        boot = await apiJson(`/api/bootstrap?${buildBootstrapQueryParams(true)}`, { signal: abortCtrl.signal });
      } finally {
        clearTimeout(timeoutId);
      }

      if (!hasLocalToken && state.user) {
        // 请求期间用户可能已通过登录表单手动登入，避免旧探针覆盖新账号态
        return;
      }

      if (boot && boot.authenticated !== false && boot.user) {
        applyAuthLoginPayload(
          {
            authenticated: true,
            user: boot.user,
            token: boot.token || window.__starAuthStore?.getToken()
          },
          { persistDefault: false, rememberGuest: false }
        );
        await enterWorkspace(boot, { silentReconcile: snapshotApplied });
        dismissBootSplash();
        return;
      }

      // 服务端明确返回未认证：清理快照；若已在登录门扉且未显示登录工作台，避免重置用户正在输入的表单/错误提示
      clearBootSnapshot();
      if (!appShell.classList.contains('hidden') || authGate.classList.contains('hidden')) {
        resetClientWorkspaceState();
        showAuthScreen();
      }
      dismissBootSplash();
      if (needLoginMsg) {
        setTimeout(() => {
          setAuthError('【严格安全提示】请先注册或登录正式账号，以获取 APK 客户端下载权限');
        }, 100);
      }
    } catch (bootErr) {
      console.warn('[BootCheck] bootstrap sync error:', bootErr);
      if (!hasLocalToken && state.user) return;
      if (snapshotApplied && state.user) {
        showToast('当前网络较慢，已优先展示本地缓存对话');
        return;
      }
      if (!appShell.classList.contains('hidden') || authGate.classList.contains('hidden')) {
        resetClientWorkspaceState();
        showAuthScreen();
      }
      dismissBootSplash();
      if (needLoginMsg) {
        setTimeout(() => {
          setAuthError('【严格安全提示】请先注册或登录正式账号，以获取 APK 客户端下载权限');
        }, 100);
      }
    } finally {
      clearTimeout(safetySplashTimer);
      dismissBootSplash();
    }
  }

  // 点击顶栏更多面板或灵感面板内的动作按钮后，自动轻柔收起 Popover
  ['topbar-more-popover', 'magic-quick-popover'].forEach((popId) => {
    const popEl = document.getElementById(popId);
    if (!popEl) return;
    popEl.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn || btn.id === 'toggle-proactive-btn') return;
      hidePopoverSafe(popId);
    });
  });

  // 全局模态弹窗点击背景遮罩自闭交互（仅当 pointerdown 与 click 均落在遮罩本身时关闭，防止手机端滑动/选字手指移出弹窗误关）
  document.querySelectorAll('dialog.modal-dialog').forEach((dlg) => {
    let pointerDownOnBackdrop = false;
    dlg.addEventListener('pointerdown', (e) => {
      pointerDownOnBackdrop = e.target === dlg;
    });
    dlg.addEventListener('click', (e) => {
      const shouldClose = pointerDownOnBackdrop && e.target === dlg;
      pointerDownOnBackdrop = false;
      if (shouldClose) {
        if (typeof dlg.close === 'function') {
          dlg.close();
        } else {
          dlg.removeAttribute('open');
        }
      }
    });
  });

  window.__STAR_ENTER_WORKSPACE__ = enterWorkspace;
  bootCheck();
})();

(() => {
  let initialUiMode = 'roleplay';
  let initialScriptId = 'script_clannad';
  try {
    const qMode = new URLSearchParams(window.location.search).get('mode');
    const savedMode = localStorage.getItem('ui_mode_v5');
    if (qMode === 'roleplay' || qMode === 'deepseek') {
      initialUiMode = qMode;
    } else if (savedMode === 'roleplay' || savedMode === 'deepseek') {
      initialUiMode = savedMode;
    }
    const savedSc = localStorage.getItem('active_script_id');
    if (savedSc) initialScriptId = savedSc;
  } catch {}

  const state = {
    uiMode: initialUiMode, // 'roleplay' | 'deepseek'
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
    tourIndex: 0,
    tourActive: false
  };

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
  const composerChannelBadge = document.getElementById('composer-channel-badge');

  const sidebarVipTier = document.getElementById('sidebar-vip-tier');
  const sidebarVipCta = document.getElementById('sidebar-vip-cta');
  const sidebarVipCredits = document.getElementById('sidebar-vip-credits');
  const vipModalTier = document.getElementById('vip-modal-tier');
  const vipModalDesc = document.getElementById('vip-modal-desc');
  const vipModalCredits = document.getElementById('vip-modal-credits');

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

  // 十大模态对话框
  const personaDialog = document.getElementById('persona-dialog');
  const importHistoryDialog = document.getElementById('import-history-dialog');
  const membershipDialog = document.getElementById('membership-dialog');
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

  // 代码块内容注册池（用于一键复制、下载文件与右侧 Artifacts 实时预览）
  const codeSnippetStore = new Map();
  let codeSeq = 0;

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

  function renderNativeDeepSeekMarkdown(rawText, searchResults = []) {
    if (!rawText) return '';
    let workingRaw = String(rawText);

    // 流式输出过程中若围栏代码块尚未闭合，自动临时闭合以避免流式打字跳变
    const fenceCount = (workingRaw.match(/```/g) || []).length;
    if (fenceCount % 2 === 1) {
      workingRaw += '\n```';
    }

    const codeBlocks = [];
    const mathBlocks = [];

    // 1) 保护围栏代码块（从源码走语法高亮，提供右侧预览/自动换行/下载/无障碍复制）
    workingRaw = workingRaw.replace(/```([a-zA-Z0-9_+-]*)\r?\n?([\s\S]*?)```/g, (_, langRaw, rawCodeBody) => {
      const lang = (langRaw || 'text').trim().toLowerCase();
      const rawCode = String(rawCodeBody || '').replace(/\s+$/, '');
      const lineCount = rawCode ? rawCode.split(/\r?\n/).length : 1;
      const codeId = `cb_${++codeSeq}`;
      codeSnippetStore.set(codeId, { code: rawCode, lang });

      const canPreview =
        lang === 'html' ||
        lang === 'htm' ||
        lang === 'svg' ||
        /<!doctype html>|<html|<canvas|<svg/i.test(rawCode);

      const highlighted = highlightCodeSyntax(rawCode, lang);
      const idx = codeBlocks.length;
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
    return joined;
  }

  function renderMessageMarkdown(rawText, searchResults = []) {
    return state.uiMode === 'deepseek'
      ? renderNativeDeepSeekMarkdown(rawText, searchResults)
      : renderRoleplayMarkdown(rawText);
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
      .replace(/\*([^*\n]+)\*/g, '<em class="rp-action">*$1*</em>')
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

  let toastTimer = null;
  let walletBannerTimer = null;
  let adminBannerTimer = null;
  function showToast(text) {
    memoryToastEl.textContent = text;
    memoryToastEl.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      memoryToastEl.classList.add('hidden');
    }, 3800);

    const walletBanner = document.getElementById('wallet-feedback-banner');
    if (walletBanner && membershipDialog?.open) {
      walletBanner.textContent = text;
      walletBanner.classList.remove('hidden');
      clearTimeout(walletBannerTimer);
      walletBannerTimer = setTimeout(() => {
        walletBanner.classList.add('hidden');
      }, 4500);
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
        resetClientWorkspaceState();
        window.__starAuthStore?.clearTabSession(false);
        showAuthScreen();
      } else if (res.status === 409 && data.code === 'ACCOUNT_MISMATCH') {
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
    window.__activeSessionId = null;
    window.__isAdminUser = false;
    window.dispatchEvent(new CustomEvent('user-role-changed'));

    if (messagesContainer) messagesContainer.innerHTML = '';
    if (sessionListEl) sessionListEl.innerHTML = '';
    if (personaListEl) personaListEl.innerHTML = '';
    if (memoryCardsList) memoryCardsList.innerHTML = '';
    if (adminConsoleDialog) adminConsoleDialog.innerHTML = '';
    document.getElementById('open-admin-console-btn')?.classList.add('hidden');
    document.getElementById('ds-menu-admin-btn')?.classList.add('hidden');

    [
      personaDialog,
      importHistoryDialog,
      membershipDialog,
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
    appShell.classList.add('hidden');
    authGate.classList.remove('hidden');
    setAuthError('');
  }

  signinForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    setAuthError('');
    try {
      resetClientWorkspaceState();
      const res = await apiJson('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: document.getElementById('signin-email').value,
          password: document.getElementById('signin-password').value
        })
      });
      applyAuthLoginPayload(res, { persistDefault: true, rememberGuest: false });
      signinForm.reset();
      await enterWorkspace();
    } catch (err) {
      setAuthError(err.message);
    }
  });

  signupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    setAuthError('');
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
      applyAuthLoginPayload(res, { persistDefault: true, rememberGuest: false });
      signupForm.reset();
      document.getElementById('signup-avatar').value = '🎀';
      await enterWorkspace();
      const giftDays = res.gifted_days || 30;
      showToast(
        res.gifted_vip !== false
          ? `🎉 注册成功！已自动赠送您「${giftDays} 天星月会员」礼包，全站角色扮演与个人 API 接入全免费畅玩！`
          : '🎉 新账户创建成功！欢迎开启心动初遇'
      );
    } catch (err) {
      setAuthError(err.message);
    }
  });

  quickDemoLoginBtn.addEventListener('click', async () => {
    setAuthError('');
    try {
      resetClientWorkspaceState();
      const savedGuestId = window.__starAuthStore?.getGuestUserId() || '';
      const res = await apiJson('/api/auth/demo-login', {
        method: 'POST',
        body: JSON.stringify({ guest_user_id: savedGuestId })
      });
      applyAuthLoginPayload(res, { persistDefault: true, rememberGuest: true });
      await enterWorkspace();
      if (res.is_new_guest) {
        showToast(`🎀 已为您开启独立访客账号「${res.user.nickname}」，已赠畅享会员，支持免费自由接入个人 API！`);
      }
    } catch (err) {
      setAuthError(err.message);
    }
  });

  if (freshGuestLoginBtn) {
    freshGuestLoginBtn.addEventListener('click', async () => {
      setAuthError('');
      try {
        resetClientWorkspaceState();
        const res = await apiJson('/api/auth/demo-login', {
          method: 'POST',
          body: JSON.stringify({ guest_user_id: '' })
        });
        // 新开测试访客仅绑定当前浏览器标签页，不影响其他打开的标签页账户
        applyAuthLoginPayload(res, { persistDefault: false, rememberGuest: false });
        await enterWorkspace();
        showToast(`🔒 已在当前窗口开启全新独立账户「${res.user.nickname}」，与其他账号会话完全隔离！`);
      } catch (err) {
        setAuthError(err.message);
      }
    });
  }

  async function performAccountLogout() {
    await apiJson('/api/auth/logout', { method: 'POST' }).catch(() => {});
    resetClientWorkspaceState();
    window.__starAuthStore?.clearTabSession(true);
    showAuthScreen();
  }

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

  // ================= 2. 4 步零门槛新手引导模式（遵循 persistent-app-tours） =================
  const TOUR_STEPS = [
    {
      anchorId: 'tour-anchor-persona',
      ensureLeftOpen: true,
      title: '🌸 第一步：选一位心动角色，或上传人设文档',
      desc: '点击左侧任意角色即可开启一段新故事！如果你手里有写好的人物小传文件（.txt / .md / .json），点旁边的「📄 上传文档」就能一秒生成专属角色。'
    },
    {
      anchorId: 'tour-anchor-composer',
      ensureLeftOpen: false,
      title: '💭 第二步：直接发消息聊天 & 偷听他的潜台词',
      desc: '不知怎么开头？点输入框上方的「🪄 快捷灵感」试试！开启「💭 偷听心声独白」还能像翻看日记一样，看到他开口前藏在心底的小心思。'
    },
    {
      anchorId: 'tour-anchor-tools',
      ensureLeftOpen: false,
      title: '📥 第三步：随时改背景故事 & 导入旧聊天记录',
      desc: '你在聊天里提过的名字、喜好和约定，他都会自动记在心里！点右上角「📥 导入对话」还能把以前的聊天记录导进来无缝接着聊，点「🎀 人设与记忆匣」可随时修改设定。'
    },
    {
      anchorId: 'tour-anchor-vip',
      ensureLeftOpen: true,
      title: '🔑 第四步：全免费畅玩 & 自由接入个人 API',
      desc: '当前全站已开启全免费畅玩模式，新用户注册即送会员！点击左下角设置或输入框旁的「🔑 接入个人 API」，即可把您自己的 API 自由接入到 DeepSeek 原生对话与角色扮演剧场中！'
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

    if (step.ensureLeftOpen && appShell.classList.contains('left-collapsed')) {
      appShell.classList.remove('left-collapsed');
      expandLeftBtn.classList.add('hidden');
    }

    clearTourSpotlight();
    const targetEl = document.getElementById(step.anchorId);
    if (targetEl) {
      targetEl.classList.add('tour-spotlight-target');
      targetEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }

    tourStepBadge.textContent = `🧭 新手向导 ${state.tourIndex + 1} / ${total}`;
    tourStepTitle.textContent = step.title;
    tourStepDesc.textContent = step.desc;

    tourDotsEl.innerHTML = TOUR_STEPS.map(
      (_, i) => `<span class="tour-dot ${i === state.tourIndex ? 'active' : ''}"></span>`
    ).join('');

    tourPrevBtn.disabled = state.tourIndex === 0;
    tourPrevBtn.style.visibility = state.tourIndex === 0 ? 'hidden' : 'visible';
    tourNextBtn.textContent = state.tourIndex === total - 1 ? '开始心动之旅 ✨' : '下一步 ▸';

    // 将程序焦点引导至向导主操作按钮（遵循 persistent-app-tours 无障碍要求）
    tourNextBtn.focus();
  }

  function startOnboardingTour() {
    state.tourIndex = 0;
    state.tourActive = true;
    if (supportsNativePopover && typeof tourPopover.showPopover === 'function') {
      try {
        tourPopover.showPopover();
      } catch {}
    } else {
      tourPopover.classList.add('tour-manual-open');
    }
    renderTourStep();
  }

  async function closeOnboardingTour(markDone = true) {
    state.tourActive = false;
    clearTourSpotlight();
    if (supportsNativePopover && typeof tourPopover.hidePopover === 'function') {
      try {
        tourPopover.hidePopover();
      } catch {}
    }
    tourPopover.classList.remove('tour-manual-open');

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

  document.getElementById('start-tour-btn').addEventListener('click', startOnboardingTour);
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
      showToast('🌸 向导已完成！现在试着给角色发第一句话，或点击快捷灵感吧');
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
  [
    personaDialog,
    importHistoryDialog,
    membershipDialog,
    settingsDialog,
    userPersonaDialog,
    plazaDialog,
    theaterDialog,
    quoteCardDialog,
    fimDialog,
    codePreviewDialog,
    attachmentPreviewDialog,
    dsShareDialog,
    adminConsoleDialog
  ]
    .filter(Boolean)
    .forEach(setupDialogLightDismiss);

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
      quickThemeBtn.textContent = isEffectiveDark ? '☀️' : '🌙';
      quickThemeBtn.title = isEffectiveDark ? '当前深色模式 · 点击切换为纯净浅色' : '当前浅色模式 · 点击切换为极客深色';
    }
    const dsMenuThemeLbl = document.getElementById('ds-menu-theme-label');
    if (dsMenuThemeLbl) {
      const modeName = currentVal === 'light' ? '浅色纯白' : currentVal === 'dark' ? '极客深色' : '跟随系统';
      dsMenuThemeLbl.textContent = `🌗 外观主题：${modeName}（点此切换）`;
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
    showToast(next === 'dark' ? '🌙 已切换至 DeepSeek 官方极客深色主题' : '☀️ 已切换至 DeepSeek 官方纯净浅色主题');
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
    const labelMap = { light: '☀️ 浅色纯白', dark: '🌙 极客深色', system: '🖥️ 跟随系统' };
    showToast(`已切换外观主题为：${labelMap[next]}`);
  });

  // ================= 5. 侧栏与抽屉控制 =================
  toggleLeftBtn.addEventListener('click', () => {
    appShell.classList.add('left-collapsed');
    expandLeftBtn.classList.remove('hidden');
  });
  expandLeftBtn.addEventListener('click', () => {
    appShell.classList.remove('left-collapsed');
    expandLeftBtn.classList.add('hidden');
  });

  function openRightTab(tabId) {
    appShell.classList.remove('right-collapsed');
    appShell.classList.toggle('artifacts-wide', tabId === 'ds-artifacts-tab');
    document.querySelectorAll('.tab-btn').forEach((btn) => {
      const active = btn.dataset.tab === tabId;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', String(active));
    });
    document.getElementById('nurture-tab').classList.toggle('hidden', tabId !== 'nurture-tab');
    document.getElementById('memory-tab').classList.toggle('hidden', tabId !== 'memory-tab');
    document.getElementById('persona-tab').classList.toggle('hidden', tabId !== 'persona-tab');
    const dsSuiteEl = document.getElementById('ds-suite-tab');
    if (dsSuiteEl) dsSuiteEl.classList.toggle('hidden', tabId !== 'ds-suite-tab');
    const dsArtEl = document.getElementById('ds-artifacts-tab');
    if (dsArtEl) dsArtEl.classList.toggle('hidden', tabId !== 'ds-artifacts-tab');
  }

  toggleRightBtn.addEventListener('click', () => {
    if (appShell.classList.contains('right-collapsed')) {
      const dsTabVisible = !document.getElementById('ds-suite-tab')?.classList.contains('hidden');
      if (state.uiMode === 'roleplay' && dsTabVisible) {
        openRightTab('nurture-tab');
        return;
      }
      appShell.classList.remove('right-collapsed');
    } else {
      appShell.classList.add('right-collapsed');
      appShell.classList.remove('artifacts-wide');
    }
  });
  closeRightBtn.addEventListener('click', () => {
    appShell.classList.add('right-collapsed');
    appShell.classList.remove('artifacts-wide');
  });
  memoryStatusPill.addEventListener('click', () => openRightTab('memory-tab'));
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => openRightTab(btn.dataset.tab));
  });

  // ================= 6. 用户资料、签到任务积分、日卡/月卡收银台、兑换码与站长发卡台 =================
  function formatDateTimeShort(ts) {
    if (!ts) return '-';
    const d = new Date(Number(ts));
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function renderUserAndMembership() {
    const isAdmin = Boolean(state.user?.is_admin);
    window.__isAdminUser = isAdmin;
    window.dispatchEvent(new CustomEvent('user-role-changed'));

    document.getElementById('open-admin-console-btn')?.classList.toggle('hidden', !isAdmin);
    document.getElementById('ds-menu-admin-btn')?.classList.toggle('hidden', !isAdmin);
    if (!isAdmin && adminConsoleDialog) {
      if (adminConsoleDialog.open) adminConsoleDialog.close();
      adminConsoleDialog.innerHTML = '';
    }

    if (state.user) {
      navUserAvatar.textContent = state.user.avatar || '🎀';
      navUserNickname.textContent = state.user.nickname || '星语旅人';
      const dsAv = document.getElementById('ds-nav-avatar');
      const dsNick = document.getElementById('ds-nav-nickname');
      if (dsAv) dsAv.textContent = state.user.avatar || '🍀';
      if (dsNick) dsNick.textContent = state.user.nickname || '星语旅人';
      const rawRole = state.user.user_persona?.role || '';
      const curSc =
        state.scripts.find((s) => s.id === state.activeScriptId) || state.scripts[0];
      const effectiveRole =
        !rawRole || rawRole === '命中注定的重逢旅人'
          ? curSc?.player_role || '剧中主角'
          : rawRole;
      const roleStr = isAdmin ? '🛡️ 站长账户' : effectiveRole;
      if (navUserRoleLabel) {
        navUserRoleLabel.textContent = `${roleStr.slice(0, 11)} ▸`;
      }
      const isoBadge = document.getElementById('wallet-account-badge');
      if (isoBadge) {
        isoBadge.textContent = `🔒 独立账户：${state.user.nickname} (${state.user.email})`;
      }
    }

    const theaterBtn = document.getElementById('open-theater-btn');
    const theaterLbl = document.getElementById('theater-pill-label');
    if (theaterBtn && theaterLbl) {
      const hasNote = Boolean(state.activeSession?.director_note && state.activeSession.director_note.trim());
      theaterBtn.classList.toggle('active', hasNote);
      theaterLbl.textContent = hasNote ? '幕次演绎中' : '本剧幕次';
    }

    const m = state.membership || {
      tier: 'moon',
      card_type: 'month',
      tier_name: '🌙 星月月卡会员',
      online_credits: 30,
      points: 100,
      is_vip: true,
      has_active_card: true,
      can_bind_own_api: true,
      can_use_online: true,
      free_experience_mode: true,
      billing_enabled: false
    };
    const isFreeMode = m.free_experience_mode !== false && m.billing_enabled !== true;
    const p = state.settings.provider || 'demo';

    sidebarVipTier.textContent = isAdmin ? '🛡️ 站长尊享' : m.tier_name || '🌙 星月会员';
    sidebarVipTier.classList.toggle('is-vip', Boolean(isAdmin || m.has_active_card || isFreeMode));
    sidebarVipCta.textContent = m.checked_in_today
      ? m.remaining_text
        ? `${m.remaining_text} ▸`
        : '免费福利 ▸'
      : '📅 今日可签到 ▸';
    const sidebarPtsEl = document.getElementById('sidebar-user-points');
    if (sidebarPtsEl) sidebarPtsEl.textContent = String(m.points ?? 0);
    sidebarVipCredits.textContent = isAdmin || isFreeMode
      ? '全免费畅玩'
      : m.has_active_card
      ? `畅聊 (${m.online_credits || 0}次)`
      : `${m.online_credits || 0} 次`;

    if (vipModalTier) {
      vipModalTier.textContent = isAdmin ? '🛡️ 站长尊享账户' : m.tier_name || '🌙 星月会员';
    }
    const expChip = document.getElementById('vip-modal-expire-chip');
    if (expChip) {
      const showExp = Boolean((m.has_active_card || isFreeMode) && m.remaining_text);
      expChip.classList.toggle('hidden', !showExp);
      if (showExp) expChip.textContent = `⏳ ${m.remaining_text}`;
    }
    const ptsModalEl = document.getElementById('vip-modal-points');
    if (ptsModalEl) ptsModalEl.textContent = String(m.points ?? 0);
    if (vipModalCredits) vipModalCredits.textContent = String(m.online_credits ?? 0);
    const streakEl = document.getElementById('vip-modal-streak');
    if (streakEl) streakEl.textContent = String(m.checkin_streak ?? 0);
    const shopPtsEl = document.getElementById('shop-points-indicator');
    if (shopPtsEl) shopPtsEl.textContent = `可用星光积分：${m.points ?? 0}`;

    if (vipModalDesc) {
      if (isFreeMode) {
        vipModalDesc.innerHTML = `🎉 当前全站处于<strong>全免费开放体验期</strong>（收费模式已关闭）！您的账户身份为<strong>${escapeHtml(
          m.tier_name || '🌙 星月会员'
        )}</strong>（${escapeHtml(
          m.remaining_text || '生效中'
        )}），所有剧本角色扮演、DeepSeek 原生对话与<strong>个人 API 自由接入</strong>均全程免费免扣次（累计已对话 ${
          m.total_used || 0
        } 次）！`;
      } else {
        vipModalDesc.innerHTML = m.has_active_card
          ? `当前正处于<strong>${escapeHtml(m.tier_name)}</strong>有效期内（${escapeHtml(
              m.remaining_text || '生效中'
            )}），在线高阶对话<strong>全程免扣次数无限畅聊</strong>！备用对话次数与积分永久保留（累计已对话 ${
              m.total_used || 0
            } 次）。`
          : `每日签到与做互动任务可免费赢取<strong>星光积分</strong>，积分商城可直兑对话次数或畅聊会员卡！`;
      }
    }

    composerChannelBadge.classList.remove('online-locked', 'online-ready');
    const ownApiUnlocked = Boolean(
      isFreeMode || isAdmin || m.has_active_card || m.can_bind_own_api || state.settings.vip_own_api_unlocked
    );
    const hasOwnKey = Boolean(state.settings.has_own_deepseek_key);
    const rawOwnModel = state.settings.own_deepseek_model || 'deepseek-flash';
    const rawLeaf = rawOwnModel.split('/').pop();
    const shortModel = /^deepseek[-_]?flash$/i.test(rawLeaf) ? 'V4.1-Flash' : rawLeaf;
    const dsComposerChip = document.getElementById('ds-composer-api-chip');
    if (dsComposerChip) {
      if (p === 'own_deepseek' && ownApiUnlocked && hasOwnKey) {
        dsComposerChip.textContent = `🔑 我的密钥 (${shortModel})`;
      } else if (hasOwnKey) {
        dsComposerChip.textContent = '🔑 切回我的密钥';
      } else {
        dsComposerChip.textContent = '⚙️ 聊天设置';
      }
    }

    // 同步原生右侧抽屉「🔑 绑定我自己的密钥」状态卡片
    const dsOwnBadge = document.getElementById('ds-suite-own-api-badge');
    const dsOwnDesc = document.getElementById('ds-suite-own-api-desc');
    const dsOwnBtn = document.getElementById('ds-suite-own-api-btn');
    if (dsOwnBadge && dsOwnDesc && dsOwnBtn) {
      if (ownApiUnlocked) {
        dsOwnBadge.textContent = hasOwnKey
          ? p === 'own_deepseek'
            ? '✅ 正在使用'
            : '🔓 已存密钥'
          : '免费开放';
        dsOwnDesc.textContent = hasOwnKey
          ? `已安全保存您的密钥（${state.settings.own_deepseek_key_masked || 'sk-••••'} · 当前模型 ${shortModel}），DeepSeek 与角色扮演都能直接用！`
          : '不填任何东西也能直接免费聊！如果您有自己的 DeepSeek 或硅基流动密钥，粘贴后即可直连最新 DeepSeek V4.1 Flash。';
        dsOwnBtn.textContent = hasOwnKey
          ? '⚙️ 修改或更换我的密钥'
          : '⚙️ 打开聊天设置 / 绑定密钥';
      } else {
        dsOwnBadge.textContent = '🔒 会员专属';
        dsOwnDesc.textContent = '使用每日签到积分免费兑换会员卡后，即可绑定您自己的密钥直连使用。';
        dsOwnBtn.textContent = '👑 前往积分兑卡解锁 ▸';
      }
    }

    const proBtn = document.getElementById('toggle-proactive-btn');
    if (proBtn) {
      const proOn = state.activeSession?.proactive_enabled !== 0;
      proBtn.classList.toggle('active', proOn);
      proBtn.setAttribute('aria-pressed', String(proOn));
      proBtn.textContent = proOn ? '💓 主动关怀: 开' : '💤 主动关怀: 关';
    }

    const dsTitleEl = document.getElementById('ds-topbar-title');
    const dsModelPill = document.getElementById('ds-model-pill');
    const dsSoulPill = document.getElementById('ds-soul-active-pill');
    const dsThinkOn = state.activeSession ? state.activeSession.ds_thinking !== 0 : true;
    const dsSearchOn = state.activeSession ? state.activeSession.ds_search === 1 : false;
    const dsJsonOn = state.activeSession ? state.activeSession.ds_json_mode === 1 : false;
    const dsToolsOn = state.activeSession ? state.activeSession.ds_tools_enabled !== 0 : true;

    if (dsTitleEl) dsTitleEl.textContent = state.activeSession?.title || '新对话';
    if (dsModelPill) {
      const isCustomThirdModel =
        p === 'own_deepseek' &&
        hasOwnKey &&
        !/deepseek|flash/i.test(rawOwnModel);
      const basePillName = isCustomThirdModel ? shortModel : 'DeepSeek-V4.1-Flash';
      dsModelPill.textContent = dsThinkOn ? `${basePillName} · 深度思考` : basePillName;
    }
    if (dsSoulPill) {
      const isPure = !state.activePersona || state.activePersona.id === 'persona_deepseek_official';
      dsSoulPill.classList.toggle('hidden', isPure);
      if (!isPure && state.activePersona) {
        dsSoulPill.textContent = `🎭 挂载：${state.activePersona.name.split(/[·\s]/)[0]}`;
      }
    }

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

    if (p === 'demo') {
      gatewaySummaryText.textContent = '免费畅聊模式（可绑定个人密钥）';
      composerChannelBadge.textContent = hasOwnKey
        ? '✨ 免费畅聊（点此切我的密钥）'
        : '✨ 免费畅聊 · 设置';
    } else if (p === 'own_deepseek') {
      if (ownApiUnlocked && hasOwnKey) {
        gatewaySummaryText.textContent = `我的密钥 (${shortModel})`;
        composerChannelBadge.textContent = `🔑 我的密钥 (${shortModel})`;
        composerChannelBadge.classList.add('online-ready');
      } else if (!ownApiUnlocked) {
        gatewaySummaryText.textContent = '需会员解锁个人密钥';
        composerChannelBadge.textContent = '🔒 解锁个人密钥';
        composerChannelBadge.classList.add('online-locked');
      } else {
        gatewaySummaryText.textContent = '待粘贴我的密钥';
        composerChannelBadge.textContent = '🔑 点此粘贴密钥';
        composerChannelBadge.classList.add('online-locked');
      }
    } else {
      const chName = '星耀在线模型';
      if (isAdmin) {
        gatewaySummaryText.textContent = `${chName} · 站长免扣畅聊`;
        composerChannelBadge.textContent = `🛡️ 站长尊享 · 在线畅聊`;
        composerChannelBadge.classList.add('online-ready');
      } else if (isFreeMode) {
        gatewaySummaryText.textContent = `${chName} · 全免费畅玩中`;
        composerChannelBadge.textContent = `💎 ${chName} · 全免费畅玩`;
        composerChannelBadge.classList.add('online-ready');
      } else if (m.has_active_card) {
        gatewaySummaryText.textContent = `${chName} · ${m.tier_name}免扣畅聊`;
        composerChannelBadge.textContent = `☀️ ${m.tier_name} · 免扣畅聊`;
        composerChannelBadge.classList.add('online-ready');
      } else if ((m.online_credits || 0) > 0) {
        gatewaySummaryText.textContent = `${chName} · 剩余 ${m.online_credits} 次`;
        composerChannelBadge.textContent = `💎 ${chName} · 剩 ${m.online_credits} 次`;
        composerChannelBadge.classList.add('online-ready');
      } else if ((m.points || 0) >= 10) {
        gatewaySummaryText.textContent = `${chName} · 积分抵扣畅聊 (${m.points}分)`;
        composerChannelBadge.textContent = `✨ ${chName} · 积分可抵扣`;
        composerChannelBadge.classList.add('online-ready');
      } else {
        gatewaySummaryText.textContent = `${chName} · 签到领分畅聊`;
        composerChannelBadge.textContent = `✨ ${chName} · 签到领分`;
        composerChannelBadge.classList.add('online-locked');
      }
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
    let msg = ok ? '已复制' : '复制失败';
    if (msg === lastCopyAnnouncement) msg += '\u00A0';
    lastCopyAnnouncement = msg;

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
        if (tip && tip.getAttribute('role') === 'status') tip.textContent = '';
      }, 2000)
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

  // 遵循 modern-web-guidance: tabs 横向滚动渐隐回退 & focusgroup 选中跟随焦点 + beforematch
  const walletTablistEl = document.getElementById('wallet-tablist');
  const walletTabBtns = Array.from(document.querySelectorAll('#wallet-tablist .wallet-tab'));
  const walletPanels = walletTabBtns
    .map((btn) => document.getElementById(btn.dataset.wpanel))
    .filter(Boolean);

  if (walletTablistEl && !CSS.supports('animation-timeline', 'scroll()') && 'IntersectionObserver' in window) {
    const firstTab = walletTablistEl.firstElementChild;
    const lastTab = walletTablistEl.lastElementChild;
    if (firstTab && lastTab) {
      const scrollerObs = new IntersectionObserver(
        (entries) => {
          for (const { target, intersectionRatio } of entries) {
            walletTablistEl.classList.toggle(
              target === firstTab ? 'more-start' : 'more-end',
              intersectionRatio < 1
            );
          }
        },
        { root: walletTablistEl, threshold: 1, rootMargin: '1px' }
      );
      scrollerObs.observe(firstTab);
      scrollerObs.observe(lastTab);
    }
  }

  function selectWalletTab(tabId) {
    const visibleTabs = walletTabBtns.filter((b) => !b.classList.contains('hidden'));
    const fallbackBtn = visibleTabs[0] || walletTabBtns[0];
    const requestedBtn = walletTabBtns.find((b) => b.id === tabId && !b.classList.contains('hidden'));
    const selectedBtn = requestedBtn || fallbackBtn;
    if (!selectedBtn) return;

    for (const tab of walletTabBtns) {
      const active = tab === selectedBtn;
      tab.setAttribute('aria-selected', String(active));
      tab.setAttribute('tabindex', active ? '0' : '-1');
    }

    for (const panel of walletPanels) {
      const match = panel.id === selectedBtn.dataset.wpanel;
      panel.hidden = !match;
    }

    try {
      selectedBtn.scrollIntoView({ block: 'nearest', inline: 'nearest', container: 'nearest' });
    } catch {
      selectedBtn.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }

  walletTabBtns.forEach((btn) => {
    btn.addEventListener('click', () => selectWalletTab(btn.id));
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        const visibleTabs = walletTabBtns.filter((b) => !b.classList.contains('hidden'));
        if (visibleTabs.length === 0) return;
        e.preventDefault();
        const dir = e.key === 'ArrowRight' ? 1 : -1;
        const curIdx = Math.max(0, visibleTabs.indexOf(btn));
        const nextBtn = visibleTabs[(curIdx + dir + visibleTabs.length) % visibleTabs.length];
        selectWalletTab(nextBtn.id);
        nextBtn.focus();
      }
    });
  });

  walletPanels.forEach((panel) => {
    panel.addEventListener('beforematch', () => {
      const ownerTab = walletTabBtns.find((b) => b.dataset.wpanel === panel.id);
      if (ownerTab) selectWalletTab(ownerTab.id);
    });
  });

  function renderWalletOverview() {
    const w = state.wallet;
    if (!w) return;
    if (w.membership) state.membership = w.membership;
    if (state.user && typeof w.is_admin === 'boolean') {
      state.user.is_admin = w.is_admin;
    }
    const billingEnabled = Boolean(w.billing_enabled === true && w.free_experience_mode === false);
    const rechargeTabBtn = document.getElementById('wtab-recharge');
    if (rechargeTabBtn) {
      rechargeTabBtn.classList.toggle('hidden', !billingEnabled);
      if (!billingEnabled && rechargeTabBtn.getAttribute('aria-selected') === 'true') {
        selectWalletTab('wtab-checkin');
      }
    }
    document.getElementById('wallet-orders-section')?.classList.toggle('hidden', !billingEnabled);
    renderUserAndMembership();

    // 1. 7日连续签到网格
    const chk = w.checkin || { checked_in_today: false, streak_days: 0, calendar: [] };
    const chkBtn = document.getElementById('do-checkin-btn');
    if (chkBtn) {
      chkBtn.disabled = Boolean(chk.checked_in_today);
      chkBtn.textContent = chk.checked_in_today
        ? `✅ 今日已签到（已连签 ${chk.streak_days || 1} 天）`
        : '✨ 立即签到领积分';
    }

    const chkGrid = document.getElementById('checkin-days-grid');
    if (chkGrid && Array.isArray(chk.calendar)) {
      chkGrid.innerHTML = chk.calendar
        .map(
          (item) => `
            <div class="checkin-day-cell ${item.completed ? 'done' : ''} ${
            item.is_today_target ? 'today-target' : ''
          }" role="listitem">
              <span class="chk-day-num">第 ${item.day} 天</span>
              <span class="chk-pts-val">${item.completed ? '✓ 已领' : `+${item.points}分`}</span>
              ${
                item.credits > 0
                  ? `<span class="chk-extra-tag">+${item.credits}次对话</span>`
                  : `<span class="chk-day-num">${escapeHtml(item.label)}</span>`
              }
            </div>
          `
        )
        .join('');
    }

    // 2. 每日任务与成长里程碑任务
    const allTasks = Array.isArray(w.tasks) ? w.tasks : [];
    const dailyTasks = allTasks.filter((t) => t.type === 'daily');
    const growthTasks = allTasks.filter((t) => t.type === 'growth');

    const renderTaskRows = (list, containerId, labelId) => {
      const el = document.getElementById(containerId);
      const lbl = document.getElementById(labelId);
      if (lbl) {
        const claimedCnt = list.filter((t) => t.claimed).length;
        lbl.textContent = `${claimedCnt} / ${list.length} 已领`;
      }
      if (!el) return;
      el.innerHTML = list
        .map((t) => {
          const rewardStr = `+${t.reward_points}积分${
            t.reward_credits > 0 ? ` +${t.reward_credits}次` : ''
          }`;
          const btnClass = t.claimed ? 'claimed' : t.claimable ? 'ready' : '';
          const btnLabel = t.claimed ? '✓ 已领取' : t.claimable ? '🎁 领取奖励' : '去完成 ▸';
          return `
            <div class="task-item-row">
              <div class="task-info-col">
                <div class="task-title-line">
                  <span>${escapeHtml(t.icon || '✨')} ${escapeHtml(t.title)}</span>
                  <span class="task-reward-pill">${escapeHtml(rewardStr)}</span>
                </div>
                <div class="task-desc-line">${escapeHtml(t.desc)}</div>
              </div>
              <div class="task-act-col">
                <span class="task-prog-text">进度 ${t.current} / ${t.target}</span>
                <button
                  type="button"
                  class="task-claim-btn ${btnClass}"
                  data-task-key="${escapeHtml(t.key)}"
                  data-task-state="${t.claimed ? 'claimed' : t.claimable ? 'ready' : 'go'}"
                  ${t.claimed ? 'disabled' : ''}
                >
                  ${btnLabel}
                </button>
              </div>
            </div>
          `;
        })
        .join('');

      el.querySelectorAll('.task-claim-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const tKey = btn.dataset.taskKey;
          const tState = btn.dataset.taskState;
          if (tState === 'claimed') return;
          if (tState === 'go') {
            membershipDialog.close();
            if (tKey === 'once_user_persona') {
              document.getElementById('open-user-persona-btn')?.click();
            } else if (tKey === 'once_create_persona') {
              personaDialog.showModal();
            } else if (tKey === 'once_add_lorebook' || tKey === 'daily_memory_dream') {
              openRightTab('memory-tab');
            } else if (tKey === 'daily_interactive') {
              document.getElementById('open-theater-btn')?.click();
            } else {
              chatInput.focus();
            }
            return;
          }
          btn.disabled = true;
          try {
            const res = await apiJson('/api/wallet/tasks/claim', {
              method: 'POST',
              body: JSON.stringify({ task_key: tKey })
            });
            state.wallet = res.wallet;
            state.membership = res.membership;
            if (res.settings) state.settings = res.settings;
            renderWalletOverview();
            showToast(
              `🎉 任务达成奖励已入账：+${res.task.reward_points} 星光积分${
                res.task.reward_credits ? `、+${res.task.reward_credits} 次对话额度` : ''
              }！`
            );
          } catch (err) {
            btn.disabled = false;
            showToast(`⚠️ ${err.message}`);
          }
        });
      });
    };

    renderTaskRows(dailyTasks, 'daily-tasks-list', 'daily-tasks-progress-label');
    renderTaskRows(growthTasks, 'growth-tasks-list', 'growth-tasks-progress-label');

    // 3. 充值日卡、月卡、季卡与对话次数包商品网格
    const prodGrid = document.getElementById('recharge-products-grid');
    if (prodGrid && Array.isArray(w.products)) {
      prodGrid.innerHTML = w.products
        .map(
          (prod) => `
            <div class="vip-plan-card ${prod.featured ? 'featured' : ''}">
              <div class="plan-ribbon ${prod.featured ? 'hot' : ''}">${escapeHtml(prod.badge || '精选特惠')}</div>
              <h3>${escapeHtml(prod.name)}</h3>
              <div class="plan-price">¥${escapeHtml(prod.price_yuan)} <small>${
            prod.days === 1
              ? '/ 24小时'
              : prod.days > 1
              ? `/ ${prod.days}天`
              : '/ 永久有效'
          }</small></div>
              <ul class="plan-perks">
                ${(prod.perks || []).map((pk) => `<li>✦ ${escapeHtml(pk)}</li>`).join('')}
              </ul>
              <button type="button" class="primary-btn full-width open-cashier-btn" data-prod-key="${escapeHtml(
                prod.key
              )}">
                ${prod.days > 0 ? `⚡ 立即开通${prod.days === 1 ? '日卡' : prod.days === 30 ? '月卡' : '畅聊卡'}` : '💎 立即充值对话包'}
              </button>
            </div>
          `
        )
        .join('');

      prodGrid.querySelectorAll('.open-cashier-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const prod = w.products.find((x) => x.key === btn.dataset.prodKey);
          if (!prod) return;
          state.selectedCashierProduct = prod;
          document.getElementById('cashier-product-title').textContent = prod.name;
          document.getElementById('cashier-product-perks').textContent = (prod.perks || []).join(' ｜ ');
          document.getElementById('cashier-price-val').textContent = `¥${prod.price_yuan}`;
          const cashierBox = document.getElementById('cashier-box');
          cashierBox.classList.remove('hidden');
          cashierBox.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        });
      });
    }

    // 4. 积分免充兑换商城
    const exGrid = document.getElementById('exchange-items-grid');
    const curPts = state.membership?.points ?? 0;
    if (exGrid && Array.isArray(w.exchange_items)) {
      exGrid.innerHTML = w.exchange_items
        .map((item) => {
          const affordable = curPts >= item.cost_points;
          return `
            <div class="exchange-item-card">
              <div>
                <div class="ex-item-title">${escapeHtml(item.name)}</div>
                <div class="ex-item-desc">${escapeHtml(item.desc)}</div>
              </div>
              <div class="ex-item-foot">
                <span class="ex-cost-badge">✨ ${item.cost_points} 积分</span>
                <button
                  type="button"
                  class="${affordable ? 'mini-primary-btn' : 'mini-btn'} ex-buy-btn"
                  data-item-key="${escapeHtml(item.key)}"
                >
                  ${affordable ? '立即兑换' : '积分不足'}
                </button>
              </div>
            </div>
          `;
        })
        .join('');

      exGrid.querySelectorAll('.ex-buy-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
          try {
            const res = await apiJson('/api/wallet/exchange', {
              method: 'POST',
              body: JSON.stringify({ item_key: btn.dataset.itemKey })
            });
            state.wallet = res.wallet;
            state.membership = res.membership;
            if (res.settings) state.settings = res.settings;
            renderWalletOverview();
            showToast(`🎁 积分兑换成功：已激活「${res.item.name}」！`);
          } catch (err) {
            showToast(`⚠️ ${err.message}`);
          }
        });
      });
    }

    // 5. 充值订单与积分变动流水表格
    const ordersTbody = document.getElementById('wallet-orders-tbody');
    if (ordersTbody) {
      const orders = Array.isArray(w.orders) ? w.orders : [];
      ordersTbody.innerHTML =
        orders.length === 0
          ? '<tr><th scope="row">暂无充值订单</th><td>-</td><td>-</td><td>-</td><td>-</td></tr>'
          : orders
              .map(
                (o) => `
                  <tr>
                    <th scope="row"><code>${escapeHtml(o.order_no)}</code></th>
                    <td>${escapeHtml(o.product_name)}（${escapeHtml(o.reward_summary || '')}）</td>
                    <td>¥${(Number(o.amount_fen || 0) / 100).toFixed(2)} (${
                  o.pay_channel === 'alipay' ? '支付宝' : '微信支付'
                })</td>
                    <td>✅ 已入账</td>
                    <td>${formatDateTimeShort(o.paid_at || o.created_at)}</td>
                  </tr>
                `
              )
              .join('');
    }

    const ledgerTbody = document.getElementById('wallet-ledger-tbody');
    if (ledgerTbody) {
      const ledger = Array.isArray(w.ledger) ? w.ledger : [];
      ledgerTbody.innerHTML =
        ledger.length === 0
          ? '<tr><th scope="row">暂无积分流水</th><td>-</td><td>-</td><td>-</td><td>-</td></tr>'
          : ledger
              .map((l) => {
                const pSign = l.delta_points > 0 ? `+${l.delta_points}` : String(l.delta_points);
                const cStr =
                  l.delta_credits > 0
                    ? `+${l.delta_credits}次`
                    : l.delta_credits < 0
                    ? `${l.delta_credits}次`
                    : '-';
                return `
                  <tr>
                    <th scope="row">${escapeHtml(l.title)}</th>
                    <td><strong>${escapeHtml(pSign)} 分</strong></td>
                    <td>${escapeHtml(cStr)}</td>
                    <td>${l.balance_after} 分</td>
                    <td>${formatDateTimeShort(l.created_at)}</td>
                  </tr>
                `;
              })
              .join('');
    }
  }

  async function refreshWalletOverview() {
    try {
      const data = await apiJson('/api/wallet/overview');
      state.wallet = data;
      renderWalletOverview();
    } catch {}
  }

  async function openWalletModal(initialTabId = 'wtab-checkin') {
    if (state.tourActive) {
      closeOnboardingTour(false);
    }
    document.getElementById('wallet-feedback-banner')?.classList.add('hidden');
    selectWalletTab(initialTabId);
    renderWalletOverview();
    if (!membershipDialog.open) {
      membershipDialog.showModal();
    }
    await refreshWalletOverview();
  }

  composerChannelBadge.addEventListener('click', () => {
    openSettingsModal(true);
  });

  document.getElementById('open-vip-btn').addEventListener('click', () => {
    const defaultTab = state.membership?.checked_in_today ? 'wtab-redeem' : 'wtab-checkin';
    openWalletModal(defaultTab);
  });
  document.getElementById('ds-menu-wallet-btn')?.addEventListener('click', () => {
    const pop = document.getElementById('ds-user-popover');
    if (pop && typeof pop.hidePopover === 'function') {
      try {
        pop.hidePopover();
      } catch {}
    }
    openWalletModal(state.membership?.checked_in_today ? 'wtab-redeem' : 'wtab-checkin');
  });
  document.getElementById('close-vip-dialog').addEventListener('click', () => membershipDialog.close());

  document.getElementById('do-checkin-btn')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const res = await apiJson('/api/wallet/checkin', { method: 'POST' });
      state.wallet = res.wallet;
      state.membership = res.membership;
      renderWalletOverview();
      showToast(
        `📅 第 ${res.streak_days} 天签到成功！获得 +${res.points_awarded} 星光积分${
          res.bonus_credits > 0 ? `、+${res.bonus_credits} 次对话额度` : ''
        }`
      );
    } catch (err) {
      btn.disabled = Boolean(state.membership?.checked_in_today);
      showToast(`⚠️ ${err.message}`);
    }
  });

  document.getElementById('cancel-cashier-btn')?.addEventListener('click', () => {
    state.selectedCashierProduct = null;
    document.getElementById('cashier-box')?.classList.add('hidden');
  });

  document.getElementById('confirm-cashier-pay-btn')?.addEventListener('click', async (e) => {
    if (!state.selectedCashierProduct) return;
    const btn = e.currentTarget;
    btn.disabled = true;
    const payChannel =
      document.querySelector('input[name="cashier-channel"]:checked')?.value || 'wechat';
    try {
      const res = await apiJson('/api/wallet/recharge', {
        method: 'POST',
        body: JSON.stringify({
          product_key: state.selectedCashierProduct.key,
          pay_channel: payChannel
        })
      });
      state.wallet = res.wallet;
      state.membership = res.membership;
      if (res.settings) state.settings = res.settings;
      document.getElementById('cashier-box')?.classList.add('hidden');
      state.selectedCashierProduct = null;
      renderWalletOverview();
      showToast(
        `🎉 充值支付成功（订单号 ${res.order.order_no}）！当前身份：${res.membership.tier_name}`
      );
    } catch (err) {
      showToast(`⚠️ ${err.message}`);
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById('redeem-code-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('redeem-code-input');
    const code = input.value.trim();
    if (!code) return;
    try {
      const res = await apiJson('/api/membership/redeem', {
        method: 'POST',
        body: JSON.stringify({ code })
      });
      input.value = '';
      state.membership = res.membership;
      if (res.settings) state.settings = res.settings;
      if (res.wallet) state.wallet = res.wallet;
      renderWalletOverview();
      showToast(`🎁 兑换码核销成功：${res.gift_label}`);
    } catch (err) {
      showToast(`⚠️ ${err.message}`);
    }
  });

  // ================= 6.5 站长专属管理后台（仅 is_admin === true 时动态渲染，普通用户静态零暴露） =================
  function ensureAdminModalStructure() {
    if (!adminConsoleDialog || !state.user?.is_admin) return false;
    if (adminConsoleDialog.querySelector('.modal-inner')) return true;

    adminConsoleDialog.innerHTML = `
      <div class="modal-inner">
        <div class="modal-header">
          <div class="wallet-head-group">
            <h2 id="admin-console-title">🛡️ 星语恋庭 · 站长管理控制台</h2>
            <span class="account-isolation-pill">🔐 站长最高权限已鉴权</span>
          </div>
          <button type="button" class="icon-btn" id="close-admin-console-btn" aria-label="关闭站长后台">✕</button>
        </div>

        <div class="wallet-feedback-banner hidden" id="admin-feedback-banner" role="status" aria-live="polite"></div>

        <div class="vip-status-hero wallet-hero-grid admin-stats-hero" id="admin-stats-hero">
          <div class="vip-hero-left">
            <div class="wallet-tier-row">
              <span class="vip-current-tag">🛡️ 全站运营与安全网关中心</span>
            </div>
            <p class="vip-hero-desc">
              所有在线模型密钥与商业配音密钥均由服务端加密掩码托管，<strong>永不向前端明文回显</strong>；普通用户仅可见个人偏好与权益，无法访问本后台任何接口。
            </p>
          </div>
          <div class="wallet-metrics-group" id="admin-kpi-cards">
            <div class="vip-hero-quota"><span class="quota-num" id="adm-kpi-users">0</span><span class="quota-unit">👥 注册用户</span></div>
            <div class="vip-hero-quota"><span class="quota-num" id="adm-kpi-vips">0</span><span class="quota-unit">☀️ 在期会员</span></div>
            <div class="vip-hero-quota"><span class="quota-num" id="adm-kpi-revenue">¥0</span><span class="quota-unit">💰 累计营收</span></div>
            <div class="vip-hero-quota"><span class="quota-num" id="adm-kpi-codes">0</span><span class="quota-unit">🎫 有效卡密</span></div>
          </div>
        </div>

        <div class="wallet-tabs-shell">
          <div class="wallet-tablist" id="admin-tablist" role="tablist" aria-label="站长管理模块切换">
            <button type="button" role="tab" class="wallet-tab" id="atab-overview" data-apanel="apanel-overview" aria-selected="true" tabindex="0">
              <span>📊 用户管理 &amp; 订单</span>
            </button>
            <button type="button" role="tab" class="wallet-tab" id="atab-codes" data-apanel="apanel-codes" aria-selected="false" tabindex="-1">
              <span>🎫 高熵卡密发卡台</span>
            </button>
            <button type="button" role="tab" class="wallet-tab" id="atab-gateway" data-apanel="apanel-gateway" aria-selected="false" tabindex="-1">
              <span>🔌 平台模型 &amp; 语音网关</span>
            </button>
            <button type="button" role="tab" class="wallet-tab" id="atab-security" data-apanel="apanel-security" aria-selected="false" tabindex="-1">
              <span>🔐 站长安全凭据</span>
            </button>
          </div>

          <div class="wallet-panels-stack">
            <!-- 站长面板 1：用户配额调账与全站订单 -->
            <div role="tabpanel" id="apanel-overview" aria-labelledby="atab-overview">
              <div class="wpanel-inner">
                <form id="adm-adjust-user-form" class="admin-gen-form" style="margin-bottom: 14px;">
                  <div class="block-title-row">
                    <span>🎁 指定账户资产调账 / 补发权益</span>
                    <button type="button" class="mini-btn" id="adm-refresh-dash-btn">🔄 刷新全站数据</button>
                  </div>
                  <div class="inline-row">
                    <div class="field-group flex-1">
                      <label for="adm-adj-user-select">目标账户</label>
                      <select id="adm-adj-user-select" required></select>
                    </div>
                    <div class="field-group avatar-field">
                      <label for="adm-adj-points">增减积分</label>
                      <input id="adm-adj-points" type="number" min="-10000" max="10000" value="100" />
                    </div>
                    <div class="field-group avatar-field">
                      <label for="adm-adj-credits">增减次数</label>
                      <input id="adm-adj-credits" type="number" min="-5000" max="5000" value="10" />
                    </div>
                    <div class="field-group avatar-field">
                      <label for="adm-adj-days">赠卡天数</label>
                      <input id="adm-adj-days" type="number" min="0" max="365" value="0" title="填1赠送24小时日卡，填30赠送月卡" />
                    </div>
                  </div>
                  <div class="inline-row">
                    <div class="field-group flex-1">
                      <label for="adm-adj-reason">账单流水备注</label>
                      <input id="adm-adj-reason" type="text" value="站长后台人工发放权益" maxlength="40" />
                    </div>
                    <div style="display:flex; align-items:flex-end;">
                      <button type="submit" class="primary-btn">⚡ 立即执行调账</button>
                    </div>
                  </div>
                </form>

                <h3 class="sub-sec-title" id="adm-users-heading">👥 全站独立账户列表（会话与密码哈希已安全隔离）</h3>
                <div tabindex="0" role="region" aria-labelledby="adm-users-heading" class="responsive-table-wrap" style="margin-bottom: 16px;">
                  <table class="wallet-data-table" style="--col-2:'身份与畅聊卡'; --col-3:'积分 / 次数'; --col-4:'会话 / 累计消耗'; --col-5:'快捷管理';">
                    <caption class="visually-hidden">全站注册与访客账户资产管理表</caption>
                    <thead>
                      <tr>
                        <th scope="col">账户昵称与邮箱</th>
                        <th scope="col">身份与畅聊卡</th>
                        <th scope="col">积分 / 次数</th>
                        <th scope="col">会话 / 消耗</th>
                        <th scope="col">快捷管理</th>
                      </tr>
                    </thead>
                    <tbody id="adm-users-tbody"></tbody>
                  </table>
                </div>

                <h3 class="sub-sec-title" id="adm-orders-heading">💳 全站近期充值订单明细</h3>
                <div tabindex="0" role="region" aria-labelledby="adm-orders-heading" class="responsive-table-wrap">
                  <table class="wallet-data-table" style="--col-2:'购买用户'; --col-3:'套餐内容'; --col-4:'实付金额'; --col-5:'成交时间';">
                    <caption class="visually-hidden">全站近期充值成交记录</caption>
                    <thead>
                      <tr>
                        <th scope="col">订单号</th>
                        <th scope="col">购买用户</th>
                        <th scope="col">套餐内容</th>
                        <th scope="col">实付金额</th>
                        <th scope="col">成交时间</th>
                      </tr>
                    </thead>
                    <tbody id="adm-orders-tbody"></tbody>
                  </table>
                </div>
              </div>
            </div>

            <!-- 站长面板 2：64-bit 高熵加密卡密发卡台 -->
            <div role="tabpanel" id="apanel-codes" aria-labelledby="atab-codes" hidden>
              <div class="wpanel-inner">
                <form id="admin-gen-codes-form" class="admin-gen-form">
                  <div class="inline-row">
                    <div class="field-group flex-1">
                      <label for="adm-preset-type">卡密权益类型</label>
                      <select id="adm-preset-type">
                        <option value="day_card">☀️ 24小时对话日卡 (+10次额度)</option>
                        <option value="month_card">🌙 30天对话月卡 (+100次额度)</option>
                        <option value="quarter_card">🌸 90天繁花季卡 (+360次额度)</option>
                        <option value="credits">💬 纯对话次数充值码</option>
                        <option value="points">✨ 星光积分礼包码</option>
                      </select>
                    </div>
                    <div class="field-group avatar-field">
                      <label for="adm-gen-count">生成张数</label>
                      <input id="adm-gen-count" type="number" min="1" max="50" value="5" required />
                    </div>
                    <div class="field-group avatar-field">
                      <label for="adm-max-uses">单码可兑人数</label>
                      <input id="adm-max-uses" type="number" min="1" max="9999" value="1" required />
                    </div>
                  </div>
                  <div class="inline-row">
                    <div class="field-group flex-1">
                      <label for="adm-batch-name">批次备注名</label>
                      <input id="adm-batch-name" type="text" placeholder="例如：发卡网日卡首批 / 社群活动" value="站长直发卡密" />
                    </div>
                    <div class="field-group avatar-field">
                      <label for="adm-custom-prefix">卡密前缀</label>
                      <input id="adm-custom-prefix" type="text" maxlength="8" placeholder="自动" />
                    </div>
                    <div class="field-group avatar-field">
                      <label for="adm-add-credits">附加次数</label>
                      <input id="adm-add-credits" type="number" min="0" max="5000" value="10" />
                    </div>
                    <div class="field-group avatar-field">
                      <label for="adm-add-points">附加积分</label>
                      <input id="adm-add-points" type="number" min="0" max="10000" value="0" />
                    </div>
                  </div>
                  <div class="form-footer-row">
                    <button type="submit" class="primary-btn">⚡ 批量生成 64-bit 高熵加密卡密</button>
                  </div>
                </form>

                <div class="admin-latest-batch hidden" id="admin-latest-batch">
                  <div class="block-title-row">
                    <span>🎉 本批新生成卡密（64-bit 密码学随机防穷举，可直接复制发卡）</span>
                    <span class="copy-wrap">
                      <button type="button" class="secondary-btn copy-cmd-btn" command="--copy" commandfor="admin-batch-output">
                        📋 一键复制整批卡密
                      </button>
                      <span class="copy-tip" role="status"></span>
                    </span>
                  </div>
                  <textarea id="admin-batch-output" class="summary-textarea" rows="3" readonly></textarea>
                </div>

                <div style="margin-top: 12px;">
                  <div class="block-title-row">
                    <h3 class="sub-sec-title" id="admin-codes-heading">📦 卡密库存与核销状态表</h3>
                    <button type="button" class="mini-btn" id="refresh-admin-codes-btn">🔄 刷新列表</button>
                  </div>
                  <div tabindex="0" role="region" aria-labelledby="admin-codes-heading" class="responsive-table-wrap">
                    <table class="wallet-data-table" style="--col-2:'包含权益'; --col-3:'已核销/上限'; --col-4:'状态与批次'; --col-5:'操作';">
                      <caption class="visually-hidden">站长卡密库存与兑换核销记录</caption>
                      <thead>
                        <tr>
                          <th scope="col">兑换码卡密</th>
                          <th scope="col">包含权益</th>
                          <th scope="col">已核销/上限</th>
                          <th scope="col">状态与批次</th>
                          <th scope="col">操作</th>
                        </tr>
                      </thead>
                      <tbody id="admin-codes-tbody"></tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>

            <!-- 站长面板 3：平台托管大模型网关 & 商业配音音源配置 -->
            <div role="tabpanel" id="apanel-gateway" aria-labelledby="atab-gateway" hidden>
              <div class="wpanel-inner">
                <form id="adm-platform-cfg-form" class="stack-form">
                  <div class="admin-gen-form stack-form">
                    <div class="block-title-row">
                      <span>🎁 全站运营策略：免费畅玩开关 &amp; 新用户注册送会员</span>
                    </div>
                    <div class="inline-row" style="flex-wrap: wrap; gap: 14px;">
                      <label class="pin-check-label">
                        <input type="checkbox" id="adm-free-exp-mode" checked />
                        <span><strong>开启全站免费畅玩模式</strong>（关闭收费收银台，全员免扣次 &amp; 自由接入个人 API）</span>
                      </label>
                      <label class="pin-check-label">
                        <input type="checkbox" id="adm-reg-gift-vip" checked />
                        <span><strong>新用户注册立赠会员</strong></span>
                      </label>
                    </div>
                    <div class="field-group" style="max-width: 260px;">
                      <label for="adm-reg-gift-days">注册赠送会员时长（天）</label>
                      <input id="adm-reg-gift-days" type="number" min="1" max="3650" value="30" />
                    </div>
                  </div>

                  <div class="admin-gen-form stack-form">
                    <div class="block-title-row">
                      <span>💎 全站「星耀高阶在线通道」上游大模型网关（含防 SSRF 保护）</span>
                      <button type="button" class="mini-btn" id="adm-check-balance-btn">💰 查询官方 API 余额</button>
                    </div>
                    <div class="ds-balance-detail-box hidden" id="adm-balance-box"></div>

                    <div class="field-group">
                      <label for="adm-online-provider">在线高阶通道上游类型</label>
                      <select id="adm-online-provider">
                        <option value="deepseek">🐋 DeepSeek 官方 / 兼容 API 网关</option>
                        <option value="custom_gateway">🌐 自定义第三方 OpenAI 兼容聚合网关</option>
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
                      <button type="button" class="secondary-btn" id="adm-test-llm-btn">⚡ 测试上游大模型网关连通性</button>
                    </div>
                  </div>

                  <div class="admin-gen-form stack-form">
                    <div class="block-title-row">
                      <span>🎙️ 全站高拟真商业配音音源配置 &amp; 声纹复刻</span>
                    </div>
                    <div class="field-group">
                      <label for="adm-tts-provider">全站默认配音引擎</label>
                      <select id="adm-tts-provider">
                        <option value="qwen3_otome">✨ 通义千问 Qwen3-TTS 1.7B 声优大模型（默认贴耳气声）</option>
                        <option value="dashscope">⚡ 阿里云百炼 Qwen3-TTS（需密钥）</option>
                        <option value="minimax">🌟 MiniMax 海螺语音（需密钥）</option>
                        <option value="siliconflow">🎧 硅基流动 CosyVoice2 / IndexTTS-2（需密钥）</option>
                        <option value="fish_audio">🐟 Fish Audio 二次元声优库（需密钥）</option>
                        <option value="volcengine">🔥 火山引擎 · 豆包漫剧配音（需密钥）</option>
                        <option value="openai_tts">🌐 标准在线语音网关（需密钥）</option>
                        <option value="offline_kokoro">🛡️ 离线轻量基础语音</option>
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
                        <label for="adm-tts-cool-voice">❄️ 高冷男神音色 ID（留空用精选默认）</label>
                        <input id="adm-tts-cool-voice" type="text" placeholder="留空自动匹配" />
                      </div>
                      <div class="field-group flex-1">
                        <label for="adm-tts-cute-voice">🐾 少年/软萌音色 ID（留空用精选默认）</label>
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
                        <span>🎬 站长专属：上传 8~15 秒参考男音一键复刻全站男主声纹</span>
                        <input type="file" id="adm-clone-audio-file" accept=".mp3,.wav,audio/*" class="visually-hidden" />
                        <button type="button" class="mini-btn" id="adm-pick-clone-btn">📂 选择男音样片</button>
                      </div>
                      <div class="inline-row">
                        <div class="field-group flex-1">
                          <label for="adm-clone-ref-text" class="visually-hidden">参考音频原话</label>
                          <input id="adm-clone-ref-text" type="text" placeholder="填入该段参考干音的原话台词" />
                        </div>
                        <button type="button" class="secondary-btn" id="adm-run-clone-btn">✨ 复刻并写入配置</button>
                      </div>
                      <span class="muted-count" id="adm-clone-status">尚未选择参考音频</span>
                    </div>

                    <div class="inline-row">
                      <button type="button" class="secondary-btn" id="adm-test-tts-cool-btn">🔊 试听男神音源</button>
                      <button type="button" class="secondary-btn" id="adm-test-tts-cute-btn">🔊 试听少年/软萌音源</button>
                    </div>
                  </div>

                  <div class="test-result-box hidden" id="adm-gateway-result-box" role="status"></div>

                  <div class="form-footer-row">
                    <button type="submit" class="primary-btn full-width">💾 保存全站模型与语音网关配置</button>
                  </div>
                </form>
              </div>
            </div>

            <!-- 站长面板 4：站长登录邮箱与强密码修改 -->
            <div role="tabpanel" id="apanel-security" aria-labelledby="atab-security" hidden>
              <div class="wpanel-inner">
                <form id="adm-security-form" class="admin-gen-form stack-form">
                  <h3 class="sub-sec-title">🔐 修改站长登录邮箱与高强度密码</h3>
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
                    <button type="submit" class="primary-btn">🔐 验证并更新站长安全凭据</button>
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
      free_experience_mode: document.getElementById('adm-free-exp-mode')?.checked !== false,
      register_gift_vip: document.getElementById('adm-reg-gift-vip')?.checked !== false,
      register_gift_days: document.getElementById('adm-reg-gift-days')?.value.trim() || '30',
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
    const freeChk = document.getElementById('adm-free-exp-mode');
    if (freeChk) freeChk.checked = cfg.free_experience_mode !== false;
    const giftChk = document.getElementById('adm-reg-gift-vip');
    if (giftChk) giftChk.checked = cfg.register_gift_vip !== false;
    const giftDaysInp = document.getElementById('adm-reg-gift-days');
    if (giftDaysInp) giftDaysInp.value = String(cfg.register_gift_days || 30);

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

  function renderAdminCodesTable() {
    const tbody = document.getElementById('admin-codes-tbody');
    if (!tbody) return;
    const list = Array.isArray(state.adminCodes) ? state.adminCodes : [];
    tbody.innerHTML =
      list.length === 0
        ? '<tr><th scope="row">暂无卡密</th><td>-</td><td>-</td><td>-</td><td>-</td></tr>'
        : list
            .map((c, idx) => {
              const codeDomId = `adm-code-val-${idx}`;
              const isDisabled = c.status === 'disabled';
              const statusTag = isDisabled ? '🚫 已停用' : c.used_count >= c.max_uses ? '✅ 已兑完' : '🟢 有效';
              return `
                <tr>
                  <th scope="row"><code id="${codeDomId}">${escapeHtml(c.code)}</code></th>
                  <td>${escapeHtml(c.label || c.reward_type)}</td>
                  <td>${c.used_count} / ${c.max_uses >= 99999 ? '无限' : c.max_uses}</td>
                  <td>${statusTag} · ${escapeHtml(c.batch_name || '系统')}</td>
                  <td>
                    <span class="copy-wrap">
                      <button
                        type="button"
                        class="mini-btn copy-cmd-btn"
                        command="--copy"
                        commandfor="${codeDomId}"
                        aria-label="复制卡密 ${escapeHtml(c.code)}"
                      >复制</button>
                      <span class="copy-tip" role="status"></span>
                    </span>
                    ${
                      !isDisabled
                        ? `<button type="button" class="mem-act-btn adm-del-code-btn" data-del-code="${escapeHtml(
                            c.code
                          )}">作废</button>`
                        : ''
                    }
                  </td>
                </tr>
              `;
            })
            .join('');

    tbody.querySelectorAll('.adm-del-code-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          const res = await apiJson(
            `/api/admin/redeem-codes/${encodeURIComponent(btn.dataset.delCode)}`,
            { method: 'DELETE' }
          );
          state.adminCodes = res.codes || [];
          renderAdminCodesTable();
          showToast('🗑️ 已作废该兑换码');
        } catch (err) {
          showToast(`⚠️ ${err.message}`);
        }
      });
    });
  }

  function renderAdminDashboardView() {
    const dash = state.adminDashboard;
    if (!dash || !adminConsoleDialog) return;

    const stats = dash.stats || {};
    const setTxt = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = String(val);
    };
    setTxt('adm-kpi-users', stats.total_users ?? 0);
    setTxt('adm-kpi-vips', stats.active_vip_users ?? 0);
    setTxt('adm-kpi-revenue', `¥${stats.paid_revenue_yuan || '0.00'}`);
    setTxt('adm-kpi-codes', stats.active_codes_count ?? 0);

    const users = Array.isArray(dash.users) ? dash.users : [];
    const userSel = document.getElementById('adm-adj-user-select');
    if (userSel) {
      const prevVal = userSel.value;
      userSel.innerHTML = users
        .map(
          (u) =>
            `<option value="${escapeHtml(u.id)}">${escapeHtml(u.nickname)} (${escapeHtml(
              u.email
            )}) · ${u.points}分 / ${u.online_credits}次</option>`
        )
        .join('');
      if (prevVal && users.some((u) => u.id === prevVal)) {
        userSel.value = prevVal;
      }
    }

    const usersTbody = document.getElementById('adm-users-tbody');
    if (usersTbody) {
      usersTbody.innerHTML =
        users.length === 0
          ? '<tr><th scope="row">暂无用户</th><td>-</td><td>-</td><td>-</td><td>-</td></tr>'
          : users
              .map((u) => {
                const roleTag = u.is_admin ? '🛡️ 站长' : '🌙 普通用户';
                const cardTag = u.has_active_card
                  ? `${escapeHtml(u.tier_name)} (${escapeHtml(u.remaining_text)})`
                  : '无畅聊卡';
                return `
                  <tr>
                    <th scope="row">
                      <div><strong>${escapeHtml(u.avatar || '🎀')} ${escapeHtml(u.nickname)}</strong></div>
                      <div class="muted-count">${escapeHtml(u.email)}</div>
                    </th>
                    <td><div>${roleTag}</div><div class="muted-count">${cardTag}</div></td>
                    <td><strong>${u.points} 分</strong> / ${u.online_credits} 次</td>
                    <td>${u.session_count} 会话 / 已聊 ${u.total_used} 次</td>
                    <td>
                      <button type="button" class="mini-btn adm-quick-gift-btn" data-uid="${escapeHtml(u.id)}" title="快捷赠送 +100积分 与 +10次对话">+100分/10次</button>
                      ${
                        !u.is_admin
                          ? `<button type="button" class="mem-act-btn adm-quick-zero-btn" data-uid="${escapeHtml(
                              u.id
                            )}" title="将该测试账户重置为0积分0次数无卡状态">清零配额</button>`
                          : ''
                      }
                    </td>
                  </tr>
                `;
              })
              .join('');

      usersTbody.querySelectorAll('.adm-quick-gift-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
          try {
            await apiJson(`/api/admin/users/${encodeURIComponent(btn.dataset.uid)}/adjust`, {
              method: 'POST',
              body: JSON.stringify({
                delta_points: 100,
                delta_credits: 10,
                reason: '站长快捷发放福利'
              })
            });
            await refreshAdminDashboard();
            showToast('🎁 已为该账户发放 +100 积分与 +10 次对话额度！');
          } catch (err) {
            showToast(`⚠️ ${err.message}`);
          }
        });
      });

      usersTbody.querySelectorAll('.adm-quick-zero-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
          try {
            await apiJson(`/api/admin/users/${encodeURIComponent(btn.dataset.uid)}/adjust`, {
              method: 'POST',
              body: JSON.stringify({ reset_zero: true })
            });
            await refreshAdminDashboard();
            showToast('🔄 已将该普通账户重置为 0 积分 / 0 次数 / 无畅聊卡状态');
          } catch (err) {
            showToast(`⚠️ ${err.message}`);
          }
        });
      });
    }

    const ordersTbody = document.getElementById('adm-orders-tbody');
    if (ordersTbody) {
      const orders = Array.isArray(dash.recent_orders) ? dash.recent_orders : [];
      ordersTbody.innerHTML =
        orders.length === 0
          ? '<tr><th scope="row">暂无全站充值记录</th><td>-</td><td>-</td><td>-</td><td>-</td></tr>'
          : orders
              .map(
                (o) => `
                  <tr>
                    <th scope="row"><code>${escapeHtml(o.order_no)}</code></th>
                    <td>${escapeHtml(o.nickname || '用户')} (${escapeHtml(o.email || '-')})</td>
                    <td>${escapeHtml(o.product_name)}</td>
                    <td>¥${(Number(o.amount_fen || 0) / 100).toFixed(2)}</td>
                    <td>${formatDateTimeShort(o.paid_at || o.created_at)}</td>
                  </tr>
                `
              )
              .join('');
    }

    const secEmail = document.getElementById('adm-sec-email');
    if (secEmail && state.user?.email) {
      secEmail.value = state.user.email;
    }

    renderAdminCodesTable();
  }

  async function refreshAdminDashboard(updateGatewayForm = false) {
    if (!state.user?.is_admin) return;
    const data = await apiJson('/api/admin/dashboard');
    state.adminDashboard = data.dashboard;
    state.adminCodes = data.codes || [];
    renderAdminDashboardView();
    if (updateGatewayForm && data.platform_config) {
      applyPlatformConfigToAdminForm(data.platform_config);
    }
    if (state.wallet) {
      refreshWalletOverview();
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
      showToast('🔄 全站运营数据已同步刷新');
    });

    document.getElementById('adm-adjust-user-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const targetUid = document.getElementById('adm-adj-user-select')?.value;
      if (!targetUid) return;
      try {
        await apiJson(`/api/admin/users/${encodeURIComponent(targetUid)}/adjust`, {
          method: 'POST',
          body: JSON.stringify({
            delta_points: Number(document.getElementById('adm-adj-points')?.value || 0),
            delta_credits: Number(document.getElementById('adm-adj-credits')?.value || 0),
            add_days: Number(document.getElementById('adm-adj-days')?.value || 0),
            reason: document.getElementById('adm-adj-reason')?.value || '站长后台发放权益'
          })
        });
        await refreshAdminDashboard(false);
        showToast('✅ 目标账户权益调账已实时生效！');
      } catch (err) {
        showToast(`⚠️ ${err.message}`);
      }
    });

    document.getElementById('adm-preset-type')?.addEventListener('change', (e) => {
      const val = e.target.value;
      const credInp = document.getElementById('adm-add-credits');
      const ptsInp = document.getElementById('adm-add-points');
      if (!credInp || !ptsInp) return;
      if (val === 'day_card') {
        credInp.value = '10';
        ptsInp.value = '0';
      } else if (val === 'month_card') {
        credInp.value = '100';
        ptsInp.value = '0';
      } else if (val === 'quarter_card') {
        credInp.value = '360';
        ptsInp.value = '0';
      } else if (val === 'credits') {
        credInp.value = '50';
        ptsInp.value = '0';
      } else if (val === 'points') {
        credInp.value = '0';
        ptsInp.value = '200';
      }
    });

    document.getElementById('admin-gen-codes-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const res = await apiJson('/api/admin/redeem-codes/generate', {
          method: 'POST',
          body: JSON.stringify({
            preset_type: document.getElementById('adm-preset-type').value,
            count: document.getElementById('adm-gen-count').value,
            max_uses: document.getElementById('adm-max-uses').value,
            batch_name: document.getElementById('adm-batch-name').value,
            prefix: document.getElementById('adm-custom-prefix').value,
            add_credits: document.getElementById('adm-add-credits').value,
            add_points: document.getElementById('adm-add-points').value
          })
        });
        state.adminCodes = res.codes || [];
        renderAdminCodesTable();
        const batchBox = document.getElementById('admin-latest-batch');
        const batchOut = document.getElementById('admin-batch-output');
        if (batchBox && batchOut) {
          batchOut.value = (res.generated_codes || []).join('\n');
          batchBox.classList.remove('hidden');
        }
        await refreshAdminDashboard(false);
        showToast(`⚡ 已成功生成 ${res.generated_codes.length} 张「${res.label}」高熵卡密！`);
      } catch (err) {
        showToast(`⚠️ ${err.message}`);
      }
    });

    document.getElementById('refresh-admin-codes-btn')?.addEventListener('click', async () => {
      await refreshAdminDashboard(false);
      showToast('🔄 卡密库存已刷新');
    });

    document.getElementById('adm-online-provider')?.addEventListener('change', (e) => {
      const isCustom = e.target.value === 'custom_gateway';
      document.getElementById('adm-pane-ds')?.classList.toggle('hidden', isCustom);
      document.getElementById('adm-pane-custom')?.classList.toggle('hidden', !isCustom);
    });

    document.getElementById('adm-check-balance-btn')?.addEventListener('click', async () => {
      const balBox = document.getElementById('adm-balance-box');
      if (!balBox) return;
      balBox.classList.remove('hidden');
      balBox.textContent = '⏳ 正在查询平台 DeepSeek 官方账户余额…';
      try {
        const data = await apiJson('/api/admin/balance');
        const firstInfo = Array.isArray(data.balance_infos) && data.balance_infos[0];
        if (!data.configured) {
          balBox.textContent = '当前尚未在平台网关中配置真实 DeepSeek API Key（在线通道将使用内置高拟真引擎兜底）。';
        } else if (firstInfo) {
          const curSym = firstInfo.currency === 'USD' ? '$' : '¥';
          balBox.innerHTML = `状态：<strong>${
            data.is_available ? '✅ 正常可用' : '⚠️ 余额不足'
          }</strong> ｜ 可用总余额：<strong>${escapeHtml(
            curSym + firstInfo.total_balance
          )}</strong>（赠金 ${escapeHtml(curSym + (firstInfo.granted_balance || '0.00'))} / 充值 ${escapeHtml(
            curSym + (firstInfo.topped_up_balance || '0.00')
          )}）`;
        } else {
          balBox.textContent = data.message || '查询已完成';
        }
      } catch (err) {
        balBox.textContent = `⚠️ ${err.message}`;
      }
    });

    document.getElementById('adm-test-llm-btn')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const resBox = document.getElementById('adm-gateway-result-box');
      btn.disabled = true;
      btn.textContent = '⏳ 正在握手测试…';
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
          resBox.textContent = `❌ ${err.message}`;
          resBox.classList.remove('hidden');
        }
      } finally {
        btn.disabled = false;
        btn.textContent = '⚡ 测试上游大模型网关连通性';
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
        if (admCloneStatus) admCloneStatus.textContent = '⚠️ 请选择小于 5.5MB 的清晰人声样片';
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        admCloneAudioDataUrl = String(reader.result || '');
        if (admCloneStatus) admCloneStatus.textContent = `✅ 已载入样片：${f.name}`;
      };
      reader.readAsDataURL(f);
    });

    document.getElementById('adm-run-clone-btn')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const resBox = document.getElementById('adm-gateway-result-box');
      if (!admCloneAudioDataUrl) {
        showToast('⚠️ 请先选择一段 8~15 秒的参考男音音频文件');
        return;
      }
      btn.disabled = true;
      btn.textContent = '⏳ 正在复刻…';
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
          resBox.textContent = res.message || '✅ 声纹复刻成功并已写入平台网关配置';
          resBox.classList.remove('hidden');
        }
        showToast('🎙️ 全站专属声纹复刻已保存生效！');
      } catch (err) {
        showToast(`⚠️ ${err.message}`);
      } finally {
        btn.disabled = false;
        btn.textContent = '✨ 复刻并写入配置';
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
        showToast('💾 全站模型与商业语音网关配置已加密保存（密钥已自动掩码隐藏）！');
      } catch (err) {
        showToast(`⚠️ ${err.message}`);
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
        showToast('🔐 站长安全凭据已更新，其他设备上的旧登录令牌已自动吊销！');
      } catch (err) {
        showToast(`⚠️ ${err.message}`);
      }
    });
  }

  async function openAdminConsoleModal(initialTab = 'atab-overview') {
    if (!state.user?.is_admin) {
      showToast('⛔ 权限不足：仅站长管理员可进入后台');
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
      showToast(`⚠️ ${err.message}`);
    }
  }

  document.getElementById('open-admin-console-btn')?.addEventListener('click', () => {
    openAdminConsoleModal('atab-overview');
  });
  document.getElementById('ds-menu-admin-btn')?.addEventListener('click', () => {
    hidePopoverSafe('ds-user-popover');
    openAdminConsoleModal('atab-overview');
  });

  // ================= 7. 剧本 ➔ 本剧专属人设 ➔ 本剧故事存档（三级纯净隔离） =================
  function getActiveScriptObj() {
    return (
      state.scripts.find((s) => s.id === state.activeScriptId) ||
      state.scripts[0] || {
        id: 'script_clannad',
        icon: '🌸',
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
    if (iconEl) iconEl.textContent = curScript.icon || '📖';
    if (titleEl) titleEl.textContent = curScript.title || '选择剧本';

    if (state.uiMode !== 'deepseek' && chatInput) {
      const pShort = (state.activePersona?.name || '').split(/[·\s]/)[0] || '角色';
      chatInput.placeholder = `输入台词或行动（可用 *星号* 写动作），与「${pShort}」推进《${curScript.title}》剧情…`;
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
    if (!scriptId || state.isStreaming) return;
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
    showToast(`${scObj.icon || '📖'} 已进入剧本《${scObj.title}》`);
  }

  function renderPersonaList() {
    personaListEl.innerHTML = '';
    const allRoleplayPersonas = state.personas.filter((p) => p.id !== 'persona_deepseek_official');
    const scriptCast = allRoleplayPersonas.filter(
      (p) => resolvePersonaScriptId(p) === state.activeScriptId
    );
    const displayCast = scriptCast.length > 0 ? scriptCast : allRoleplayPersonas;

    const headLabel = document.getElementById('persona-section-heading');
    if (headLabel) {
      headLabel.textContent = `🎭 本剧登场人设（${displayCast.length}）`;
    }

    for (const p of displayCast) {
      const item = document.createElement('div');
      item.className = `persona-card-item ${
        state.activePersona && state.activePersona.id === p.id ? 'active' : ''
      }`;
      item.setAttribute('role', 'listitem');
      const shortName = (p.name || '').split('·')[0].trim();
      const routeTag = p.category_tag || '角色线';
      item.innerHTML = `
        <span class="p-avatar">${escapeHtml(p.avatar)}</span>
        <div class="p-meta">
          <div class="p-name-row">
            <span class="p-name">${escapeHtml(shortName)}</span>
            <span class="p-route-pill">${escapeHtml(routeTag)}</span>
          </div>
          <div class="p-sub">${escapeHtml(p.tagline || p.backstory || '点击切入角色故事线')}</div>
        </div>
      `;
      item.addEventListener('click', () => selectOrStartPersona(p.id, false));
      personaListEl.appendChild(item);
    }

    // 同步原生 DeepSeek 侧栏角色切换下拉框（面向小白直观文案）
    const soulSelect = document.getElementById('ds-soul-select');
    if (soulSelect) {
      const currentPid = state.activePersona?.id || 'persona_deepseek_official';
      soulSelect.innerHTML = [
        '<option value="persona_deepseek_official">✨ 自由剧本扮演（按本对话设定开演）</option>',
        ...allRoleplayPersonas.map(
          (p) =>
            `<option value="${escapeHtml(p.id)}">🎭 扮演角色 · ${escapeHtml(
              p.name.split(/[·\s]/)[0]
            )}</option>`
        )
      ].join('');
      if ([...soulSelect.options].some((o) => o.value === currentPid)) {
        soulSelect.value = currentPid;
      }
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

  function resolveDsTimelineGroup(session) {
    if (session.pinned === 1) return '📌 已置顶';
    const ts = Number(session.updated_at || Date.now());
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const startOfYesterday = startOfToday - 86400000;
    const sevenDaysAgo = startOfToday - 7 * 86400000;
    const thirtyDaysAgo = startOfToday - 30 * 86400000;

    if (ts >= startOfToday) return '今天';
    if (ts >= startOfYesterday) return '昨天';
    if (ts >= sevenDaysAgo) return '7 天内';
    if (ts >= thirtyDaysAgo) return '30 天内';
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
      if (save && nextTitle && nextTitle !== oldTitle) {
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
          showToast('✏️ 对话标题已重命名并锁定');
        } catch {}
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
    const menu = document.createElement('div');
    menu.className = 'ds-session-ctx-menu';
    menu.setAttribute('role', 'menu');
    menu.innerHTML = `
      <button type="button" class="ds-ctx-item" data-act="export-md" role="menuitem">
        <span>📄 导出聊天与记忆 (.md)</span>
      </button>
      <button type="button" class="ds-ctx-item" data-act="import-md" role="menuitem">
        <span>📥 导入 .md 记忆到此对话</span>
      </button>
      <button type="button" class="ds-ctx-item" data-act="session-setting" role="menuitem">
        <span>🎭 本对话独立设定与记忆</span>
      </button>
      <button type="button" class="ds-ctx-item" data-act="share" role="menuitem">
        <span>📤 分享长图 / 多格式导出</span>
      </button>
      <button type="button" class="ds-ctx-item" data-act="pin" role="menuitem">
        <span>${isPinned ? '📍 取消置顶' : '📌 置顶对话'}</span>
      </button>
      <button type="button" class="ds-ctx-item" data-act="rename" role="menuitem">
        <span>✏️ 重命名</span>
      </button>
      <button type="button" class="ds-ctx-item danger" data-act="delete" role="menuitem">
        <span>🗑️ 删除对话</span>
      </button>
    `;
    document.body.appendChild(menu);

    const rect = btnEl.getBoundingClientRect();
    const top = Math.min(window.innerHeight - 280, rect.bottom + 4);
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
        showToast(!isPinned ? '📌 已置顶该对话' : '📍 已取消置顶');
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
    sessionListEl.replaceChildren();
    const isDsUi = state.uiMode === 'deepseek';
    const headingEl = document.getElementById('session-list-heading');
    if (headingEl) {
      headingEl.textContent = isDsUi ? '历史对话' : '📜 本剧故事存档';
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

    let lastGroup = '';

    for (const s of filtered) {
      if (isDsUi) {
        const grp = resolveDsTimelineGroup(s);
        if (grp !== lastGroup) {
          lastGroup = grp;
          const grpEl = document.createElement('div');
          grpEl.className = 'session-group-label';
          grpEl.innerHTML = `<span>${escapeHtml(grp)}</span>`;
          sessionListEl.appendChild(grpEl);
        }
      }

      const item = document.createElement('div');
      item.className = `session-item ${s.id === state.activeSessionId ? 'active' : ''}`;
      item.setAttribute('role', 'listitem');
      const prefixSpan = isDsUi
        ? s.pinned === 1
          ? '<span class="ds-pin-glyph" aria-hidden="true">📌</span>'
          : ''
        : `${s.pinned === 1 ? '<span class="ds-pin-glyph" aria-hidden="true">📌</span>' : ''}<span>${escapeHtml(
            s.persona_avatar || '🌸'
          )}</span>`;

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
          <span class="session-title-text" title="双击可快速重命名">${escapeHtml(s.title)}</span>
          ${customBadgeHtml}
        </div>
        <div class="session-row-actions">
          <button type="button" class="session-export-quick-btn" title="导出此对话的聊天记录与记忆 (.md)" aria-label="导出此对话为 Markdown 记忆文件">📄</button>
          <button type="button" class="ds-session-more-btn" title="导出 .md 记忆、导入记忆、独立设定、置顶或删除" aria-label="对话更多操作">···</button>
        </div>
      `;

      item.addEventListener('click', (e) => {
        if (
          e.target.closest('.session-del-btn') ||
          e.target.closest('.session-export-quick-btn') ||
          e.target.closest('.ds-session-more-btn') ||
          e.target.closest('.ds-session-rename-input')
        ) {
          return;
        }
        loadSession(s.id);
      });

      item.querySelector('.session-title-text')?.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        startInlineSessionRename(item, s);
      });

      item.querySelector('.session-export-quick-btn')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        await exportSessionMarkdownById(s.id);
      });

      const moreBtn = item.querySelector('.ds-session-more-btn');
      if (moreBtn) {
        moreBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          openSessionContextMenu(moreBtn, item, s);
        });
      }

      sessionListEl.appendChild(item);
    }
  }

  function updateBondBadge() {
    const n = state.nurturing;
    const liveMoodEl = document.getElementById('live-mood-chip');
    if (n && n.stage) {
      bondLevelTag.textContent = n.stage.badge;
      if (liveMoodEl) liveMoodEl.textContent = n.current_mood || '✨ 专注倾听';
    } else {
      bondLevelTag.textContent = '🌱 初遇微光 Lv.1';
    }
  }

  function renderNurturingAndDiary() {
    const n = state.nurturing || {
      affection: 22,
      trust: 26,
      intimacy: 18,
      current_mood: '温柔浅笑',
      stage: { badge: '🌱 初遇微光 Lv.1', promptDirective: '' },
      secret_diary: []
    };
    updateBondBadge();

    document.getElementById('nurture-stage-badge').textContent = n.stage?.badge || '🌱 初遇微光 Lv.1';
    document.getElementById('nurture-mood-text').textContent = `心境：${n.current_mood || '温柔浅笑'}`;
    if (n.stage?.promptDirective) {
      document.getElementById('nurture-stage-desc').textContent = n.stage.promptDirective.replace(
        /^【[^】]+】/,
        ''
      );
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

    const diaryListEl = document.getElementById('diary-list');
    diaryListEl.innerHTML = '';
    const diaries = Array.isArray(n.secret_diary) ? n.secret_diary : [];
    if (diaries.length === 0) {
      diaryListEl.innerHTML =
        '<div class="diary-card">点击上方「🌙 梦境整理 &amp; 写日记」，偷看他在心底为你写下的私密手札吧。</div>';
    } else {
      for (const d of diaries) {
        const card = document.createElement('div');
        card.className = 'diary-card';
        card.innerHTML = `
          <div class="diary-meta-row">
            <span>${escapeHtml(d.date || '星夜手札')}</span>
            <span>${escapeHtml(d.mood || '')}</span>
          </div>
          <div>${escapeHtml(d.content)}</div>
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
    listEl.innerHTML = '';

    for (const lb of state.lorebooks) {
      const hit = state.triggeredLoreIds.has(lb.id);
      const card = document.createElement('div');
      card.className = `lore-card ${hit ? 'triggered' : ''}`;
      const canDel = lb.user_id !== 'system';
      card.innerHTML = `
        <div class="lore-top">
          <span class="lore-title-tag">📖 ${escapeHtml(lb.title)}${hit ? ' · ✨ 本轮触发' : ''}</span>
          ${canDel ? '<button type="button" class="mem-act-btn del-lore-btn">移除</button>' : '<span class="lore-keys">预置秘闻</span>'}
        </div>
        <div class="lore-keys">🔑 触发关键词：${escapeHtml(lb.keywords)}</div>
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
      listEl.appendChild(card);
    }
  }

  function syncSessionIsolationBadges() {
    const sess = state.activeSession;
    const hasPrompt = Boolean(sess?.session_prompt && String(sess.session_prompt).trim());
    const hasOverride = Boolean(sess?.custom_persona_override);
    const hasDirector = Boolean(sess?.director_note && String(sess.director_note).trim());
    const hasCustom = hasPrompt || hasOverride || hasDirector;

    const statusBadge = document.getElementById('session-prompt-status-badge');
    if (statusBadge) {
      statusBadge.textContent = hasCustom ? '🎯 专属设定生效中' : '仅本对话生效';
    }
    const dsSettingPill = document.getElementById('ds-session-setting-pill');
    if (dsSettingPill) {
      const memCnt = Array.isArray(state.memories) ? state.memories.length : 0;
      const shouldShow = hasCustom || memCnt > 0;
      dsSettingPill.classList.toggle('hidden', !shouldShow);
      if (shouldShow) {
        dsSettingPill.textContent = hasCustom
          ? `🎯 独立设定${memCnt > 0 ? ` · 记忆 ${memCnt}` : ''}`
          : `🧠 独立记忆 ${memCnt} 条`;
      }
    }
  }

  function populatePersonaEditor() {
    const p = state.activePersona;
    if (!p) return;
    topbarAvatar.textContent = p.avatar || '🌸';
    topbarName.textContent = p.name;
    topbarTagline.textContent =
      (state.activeSession?.session_prompt && String(state.activeSession.session_prompt).trim().slice(0, 48)) ||
      p.tagline ||
      p.backstory?.slice(0, 48) ||
      '';
    updateBondBadge();

    document.getElementById('ip-avatar').value = p.avatar || '🌸';
    document.getElementById('ip-name').value = p.name || '';
    document.getElementById('ip-tagline').value = p.tagline || '';
    document.getElementById('ip-personality').value = p.personality || '';
    document.getElementById('ip-backstory').value = p.backstory || '';
    document.getElementById('ip-style').value = p.speaking_style || '';

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
    document.getElementById('telemetry-total-label').textContent = `约 ${t.totalTokens} 词元`;

    memoryPillText.textContent = `唤醒记忆 ${t.recalledMemoryCount} 条`;

    if (state.activeSession) {
      rollingSummaryInput.value = state.activeSession.rolling_summary || '';
      const thoughtOn = state.activeSession.enable_inner_thought === 1;
      const autoMemOn = state.activeSession.enable_auto_memory === 1;
      toggleThoughtBtn.classList.toggle('active', thoughtOn);
      toggleThoughtBtn.setAttribute('aria-pressed', String(thoughtOn));
      toggleAutoMemBtn.classList.toggle('active', autoMemOn);
      toggleAutoMemBtn.setAttribute('aria-pressed', String(autoMemOn));
    }

    memoryCountLabel.textContent = `${state.memories.length} 条`;
    memoryCardsList.replaceChildren();
    syncSessionIsolationBadges();

    const catLabel = {
      Pinned: '📌 核心羁绊',
      relation: '💕 专属称呼',
      fact: '🌸 心意细节',
      event: '📖 共同回忆'
    };

    for (const mem of state.memories) {
      const isRecalled = mem.pinned === 1 || state.recalledIds.has(mem.id);
      const retPct = mem.retention_pct !== undefined ? mem.retention_pct : 100;
      const recallCnt = mem.recall_count || 0;
      const card = document.createElement('div');
      card.className = `mem-card ${isRecalled ? 'recalled' : ''}`;
      card.innerHTML = `
        <div class="mem-card-top">
          <span class="mem-tag ${mem.pinned === 1 ? 'pinned' : ''}">
            ${escapeHtml(catLabel[mem.category] || '🌸 记忆')}${isRecalled ? ' · 已点亮' : ''}
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

      memoryCardsList.appendChild(card);
    }
  }

  // ================= 8. 对话流渲染、智能防抢滚与流式通信 =================
  let userManuallyScrolledUp = false;
  const scrollBottomBtn = document.getElementById('ds-scroll-bottom-btn');

  function updateScrollBottomBtnVisibility() {
    if (!messagesViewport || !scrollBottomBtn) return;
    const dist = messagesViewport.scrollHeight - messagesViewport.scrollTop - messagesViewport.clientHeight;
    const shouldShow = state.messages.length > 0 && dist > 150;
    scrollBottomBtn.classList.toggle('hidden', !shouldShow);
    if (dist < 60) {
      userManuallyScrolledUp = false;
    }
  }

  messagesViewport.addEventListener('scroll', () => {
    const dist = messagesViewport.scrollHeight - messagesViewport.scrollTop - messagesViewport.clientHeight;
    if (dist > 150) {
      userManuallyScrolledUp = true;
    } else if (dist < 50) {
      userManuallyScrolledUp = false;
    }
    updateScrollBottomBtnVisibility();
  });

  scrollBottomBtn?.addEventListener('click', () => {
    userManuallyScrolledUp = false;
    messagesViewport.scrollTo({ top: messagesViewport.scrollHeight, behavior: 'smooth' });
  });

  function scrollToBottom(force = false) {
    if (force) {
      userManuallyScrolledUp = false;
      messagesViewport.scrollTop = messagesViewport.scrollHeight;
      updateScrollBottomBtnVisibility();
      return;
    }
    if (!userManuallyScrolledUp) {
      messagesViewport.scrollTop = messagesViewport.scrollHeight;
    }
    updateScrollBottomBtnVisibility();
  }

  // 广播剧级温柔语音合成（优先路由至 24kHz Kokoro 神经网络帅气/可爱声线引擎）
  let activeSpeakBtn = null;
  function speakDialogueOnly(rawContent, btnEl) {
    if (typeof window.playCompanionNeuralTts === 'function') {
      window.playCompanionNeuralTts(rawContent, btnEl);
      return;
    }
    if (!('speechSynthesis' in window)) {
      showToast('⚠️ 当前浏览器环境暂不支持原生语音合成');
      return;
    }
    if (window.speechSynthesis.speaking && activeSpeakBtn === btnEl) {
      window.speechSynthesis.cancel();
      btnEl.classList.remove('speaking');
      btnEl.textContent = '🔊 听声';
      activeSpeakBtn = null;
      return;
    }
    window.speechSynthesis.cancel();
    if (activeSpeakBtn) {
      activeSpeakBtn.classList.remove('speaking');
      activeSpeakBtn.textContent = '🔊 听声';
    }

    const spokenText = String(rawContent || '')
      .replace(/^>.*$/gm, '') // 过滤底部提示块
      .replace(/\*[^*]+\*/g, '，') // 静音旁白神态描写，仅保留自然停顿
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\s+/g, ' ')
      .trim();

    if (!spokenText) {
      showToast('🌸 这段回应是纯无声神态动作描写哦');
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
    btnEl.textContent = '⏹ 停止';

    utter.onend = () => {
      btnEl.classList.remove('speaking');
      btnEl.textContent = '🔊 听声';
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
      titleEl.textContent = `${att.is_image ? '🖼️ 图片预览' : '📄 文档预览'} · ${att.name || '附件'}`;
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
    const isDsUi = state.uiMode === 'deepseek';
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
      showToast('✏️ 内容已保存');
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

  const DS_THINK_ATOM_SVG = `<svg class="ds-inline-status-svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" aria-hidden="true"><circle cx="12" cy="12" r="2.2"></circle><ellipse cx="12" cy="12" rx="9" ry="3.8" transform="rotate(30 12 12)"></ellipse><ellipse cx="12" cy="12" rx="9" ry="3.8" transform="rotate(-30 12 12)"></ellipse></svg>`;

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
      avatarEl.textContent = state.activePersona?.avatar || '🎭';
    } else {
      avatarEl.textContent = state.activePersona?.avatar || '🌸';
    }
  }

  function createAssistantMessageDom(msg, isLastAssistant) {
    const isDsUi = state.uiMode === 'deepseek';
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
        : `💌 ${state.activePersona?.name?.split(/[·\s]/)[0] || '他'}的主动搭话`;
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

    // 4. 思维链 / 心声独白折叠框（原生模式严格采用正版线性原子图标 +「已深度思考（用时 X 秒）」）
    const femaleIds = new Set([
      'persona_nagisa_sakura',
      'persona_kagaribi_kyou',
      'persona_ichinose_kotomi',
      'persona_makise_sei',
      'persona_asagiri_mio',
      'persona_violet_eve'
    ]);
    const pPronoun =
      femaleIds.has(state.activePersona?.id) ||
      (/少女|学妹|女主|女生|女孩|青梅|巫女/.test(`${state.activePersona?.name || ''} ${state.activePersona?.tagline || ''}`) &&
        !/少年|公子|先生|学弟|家主|剑士/.test(`${state.activePersona?.name || ''} ${state.activePersona?.tagline || ''}`))
        ? '她'
        : '他';
    if (msg.reasoning && msg.reasoning.trim()) {
      const secNum = Math.max(1, Math.round((msg.duration_ms || 1200) / 1000));
      const summaryLabel = isDsUi
        ? `已深度思考（用时 ${secNum} 秒）`
        : `💭 ${pPronoun}的心声独白${msg.duration_ms ? `（心动推演 ${(msg.duration_ms / 1000).toFixed(1)}s）` : ''}`;
      const details = document.createElement('details');
      details.className = 'thought-details';
      if (isDsUi && isLastAssistant) details.open = true;
      details.innerHTML = `
        <summary class="thought-summary">
          ${isDsUi ? DS_THINK_ATOM_SVG : ''}
          <span>${escapeHtml(summaryLabel)}</span>
          <span class="thought-chevron">▼</span>
        </summary>
        <div class="thought-content">${isDsUi ? formatDsReasoningHtml(msg.reasoning) : escapeHtml(msg.reasoning)}</div>
      `;
      bodyEl.appendChild(details);
    }

    // 5. 正文 Markdown 渲染（传入联网参考来源以激活 [1] 引用角标）
    const prose = document.createElement('div');
    prose.className = 'assistant-prose';
    prose.innerHTML = renderMessageMarkdown(msg.content, meta.search_results || []);
    bodyEl.appendChild(prose);

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
      cacheTagHtml = `<span>✨ 呼应 ${msg.recalled_count || 0} 处</span>`;
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
          isLastAssistant
            ? `<button type="button" class="ds-icon-action-btn regen-btn" title="重新生成（保留历史版本可对比）" aria-label="重新生成">
                 <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>
               </button>`
            : ''
        }
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
        <button type="button" class="msg-tool-btn tts-btn" title="自动静音旁白，仅用温柔声线朗读角色对白">🔊 听声</button>
        <button type="button" class="msg-tool-btn snap-btn" title="生成唯美心动语录珍藏海报">📸 语录签</button>
        <button type="button" class="msg-tool-btn branch-btn" title="从这一刻创建对话分支">🌿 分支</button>
        <button type="button" class="msg-tool-btn edit-msg-btn" title="编辑修改本条回复">✏️ 编辑</button>
        <button type="button" class="msg-tool-btn copy-btn">复制</button>
        ${isLastAssistant ? `<button type="button" class="msg-tool-btn regen-btn">重演</button>` : ''}
      `;
    }

    // 绑定 < 1 / 2 > 多版本切换
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
      renderMessages();
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
        if (msg.id) {
          try {
            await apiJson(`/api/messages/${msg.id}`, {
              method: 'PATCH',
              body: JSON.stringify({ feedback: nextFb })
            });
          } catch {}
        }
        renderMessages();
        if (nextFb === 'up') showToast('👍 感谢反馈，已标记该回答有帮助');
        else if (nextFb === 'down') showToast('📝 已记录反馈，你也可以点击「重新生成」获取另一版本对比');
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
      showToast('🌿 已从该节点开启独立对话分支');
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

    // 7. 最新一条回复下方渲染 3 条「主动追问 / 剧情推进」引导胶囊
    if (isLastAssistant && !state.isStreaming && Array.isArray(meta.follow_ups) && meta.follow_ups.length > 0) {
      const fRow = document.createElement('div');
      fRow.className = 'follow-ups-row';
      for (const q of meta.follow_ups) {
        const branchMatch = String(q).match(/^(🎬|🔍|💭)\s*(.+)$/);
        const iconGlyph = branchMatch ? branchMatch[1] : isDsUi ? '→' : '✨';
        const cleanQuery = branchMatch ? branchMatch[2] : q;
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'followup-chip';
        chip.innerHTML = `<span class="followup-arrow">${iconGlyph}</span><span>${escapeHtml(cleanQuery)}</span>`;
        chip.addEventListener('click', () => {
          if (!state.isStreaming) sendStreamMessage(cleanQuery, false);
        });
        fRow.appendChild(chip);
      }
      bodyEl.appendChild(fRow);
    }

    row.appendChild(avatarEl);
    row.appendChild(bodyEl);
    return row;
  }

  function syncComposerEmptyState() {
    const isEmpty = !chatInput.value.trim() && state.pendingAttachments.length === 0;
    chatForm.classList.toggle('input-empty', isEmpty);
  }

  function renderMessages() {
    messagesContainer.innerHTML = '';
    const p = state.activePersona;
    const isDsUi = state.uiMode === 'deepseek';
    const chatStageEl = document.querySelector('.chat-stage');

    if (isDsUi) {
      const isEmpty = state.messages.length === 0;
      if (chatStageEl) chatStageEl.classList.toggle('ds-empty-mode', isEmpty);
      const greetTitleEl = document.getElementById('ds-greeting-title');
      if (greetTitleEl) {
        const isPure = !p || p.id === 'persona_deepseek_official';
        greetTitleEl.textContent = isPure
          ? '欢迎回来，随时开始吧'
          : `欢迎回来，与${p.name.split(/[·\s]/)[0]}随时开始吧`;
      }
      syncComposerEmptyState();
    } else {
      if (chatStageEl) chatStageEl.classList.remove('ds-empty-mode');
      if (p) {
      const banner = document.createElement('div');
      banner.className = 'persona-story-banner';
      const hasUserTurn = state.messages.some((m) => m.role === 'user');
      const promptsHtml =
        !hasUserTurn && Array.isArray(p.starter_prompts) && p.starter_prompts.length > 0
          ? `<div class="starter-prompts-grid">
              ${p.starter_prompts
                .map((sp) => `<button type="button" class="starter-chip">✦ ${escapeHtml(sp)}</button>`)
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
        ? `<div style="margin-top:8px;font-size:12px;color:var(--brand-primary);font-weight:600;">🎬 当前幕次情境：${escapeHtml(
            cleanNote
          )}</div>`
        : '';

      const curSc = getActiveScriptObj();
      banner.innerHTML = `
        <div class="banner-title">${escapeHtml(curSc.icon || '📖')} 剧本《${escapeHtml(curSc.title)}》 · 序章背景</div>
        <div>${escapeHtml(cleanBackstory)}</div>
        ${directorHtml}
        ${promptsHtml}
      `;

      banner.querySelectorAll('.starter-chip').forEach((chip) => {
        chip.addEventListener('click', () => {
          if (!state.isStreaming) {
            sendStreamMessage(chip.textContent.replace(/^✦\s*/, ''), false);
          }
        });
      });

      messagesContainer.appendChild(banner);
      }
    }

    let lastAssistantIdx = -1;
    state.messages.forEach((m, idx) => {
      if (m.role === 'assistant') lastAssistantIdx = idx;
    });

    state.messages.forEach((msg, idx) => {
      if (msg.role === 'user') {
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
                      )}" class="msg-user-img-card" data-preview-img-idx="${imgIdx}" title="点击查看大图：${escapeHtml(
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
                  .map(
                    (a, docIdx) =>
                      `<span class="attachment-chip clickable-att" data-preview-doc-idx="${docIdx}" title="点击预览：${escapeHtml(
                        a.name
                      )}">📎 ${renderFilenameHtml(a.name)}</span>`
                  )
                  .join('')}
              </div>`
            : '';

        const row = document.createElement('div');
        row.className = 'msg-row user';
        const wrap = document.createElement('div');
        wrap.className = 'user-msg-wrap';
        wrap.innerHTML = `
          ${imgGridHtml}
          ${attHtml}
          <div class="msg-body">${escapeHtml(msg.content)}</div>
          <div class="user-msg-tools">
            <button type="button" class="msg-tool-btn u-copy-btn">复制</button>
            <button type="button" class="msg-tool-btn u-edit-btn">✏️ 编辑</button>
            ${msg.id ? '<button type="button" class="msg-tool-btn u-rewind-btn" title="删除此句之后的内容重走对话">⏪ 回溯至此</button>' : ''}
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
            await apiJson(`/api/messages/${msg.id}/rewind`, { method: 'POST' });
            await loadSession(state.activeSessionId);
            showToast('⏪ 已回溯到该对话节点');
          });
        }
        row.appendChild(wrap);
        messagesContainer.appendChild(row);
      } else {
        messagesContainer.appendChild(createAssistantMessageDom(msg, idx === lastAssistantIdx));
      }
    });

    // 同步顶栏「🖥️ 实时预览」蓝点指示器
    const runButtons = messagesContainer.querySelectorAll('[data-run-code]');
    const artDot = document.getElementById('ds-artifacts-count-dot');
    if (artDot) {
      artDot.classList.toggle('hidden', runButtons.length === 0);
    }
    if (runButtons.length > 0 && !state.lastSandboxCode) {
      const latestBtn = runButtons[runButtons.length - 1];
      const entry = codeSnippetStore.get(latestBtn.dataset.runCode);
      const raw = typeof entry === 'string' ? entry : entry?.code || '';
      if (raw) populateSideArtifactSandbox(raw, false);
    }

    updateBondBadge();
    scrollToBottom(true);
  }

  function setStreamingUi(streaming) {
    state.isStreaming = streaming;
    sendBtn.disabled = streaming;
    stopStreamBtn.classList.toggle('hidden', !streaming);
    const stopLbl = document.getElementById('stop-btn-label');
    if (stopLbl) stopLbl.textContent = state.uiMode === 'deepseek' ? '停止生成' : '轻声止步';

    const figCard = document.getElementById('companion-poke-area');
    const statusEl = document.getElementById('comp-live-status');
    if (figCard) figCard.classList.toggle('speaking-glow', streaming);
    if (statusEl) {
      statusEl.textContent = streaming
        ? '💬 正在轻声回应你的心意…'
        : `${state.companion?.label || '✨ 正温柔守候在你身旁'}`;
    }
  }

  stopStreamBtn.addEventListener('click', () => {
    if (state.streamingAbort) state.streamingAbort.abort();
  });

  async function sendStreamMessage(text, regenerate = false, editMessageId = 0, _retried404 = false) {
    if (state.isStreaming) return;
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
    let trimmed = (text || '').trim();
    const stagedFiles = !regenerate && !editMessageId ? [...state.pendingAttachments] : [];

    if (!regenerate && !trimmed && stagedFiles.length === 0) return;

    const hasOwnKey = Boolean(
      (state.settings.deepseek_api_key && state.settings.deepseek_api_key.trim()) ||
        (state.settings.custom_gateway_token && state.settings.custom_gateway_token.trim())
    );
    const isOnline = (state.settings.provider || 'demo') !== 'demo';

    if (!isDsUi && isOnline && !hasOwnKey && !state.membership.can_use_online) {
      showToast('👑 在线通道需有效「对话日卡/月卡」、对话次数或至少 10 星光积分（可每日签到做任务免费获取）');
      await openWalletModal(state.membership.checked_in_today ? 'wtab-recharge' : 'wtab-checkin');
      return;
    }

    state.lastInteractionAt = Date.now();
    state.proactiveIdleCount = 0;

    const prefixInputEl = document.getElementById('ds-prefix-input');
    const prefixBarEl = document.getElementById('ds-prefix-bar');
    const assistantPrefix =
      isDsUi && prefixBarEl && !prefixBarEl.classList.contains('hidden')
        ? prefixInputEl.value
        : '';

    if (editMessageId > 0) {
      const targetIdx = state.messages.findIndex((m) => Number(m.id) === Number(editMessageId));
      if (targetIdx !== -1) {
        state.messages[targetIdx].content = trimmed;
        state.messages.splice(targetIdx + 1);
      }
    } else if (!regenerate) {
      if (!trimmed && stagedFiles.length > 0) {
        trimmed = `请帮我详细解析并总结上传的附件：${stagedFiles.map((a) => a.name).join('、')}`;
      }
      chatInput.value = '';
      state.pendingAttachments = [];
      renderPendingAttachments();
      state.messages.push({
        role: 'user',
        content: trimmed,
        meta: stagedFiles.length > 0 ? { attachments: stagedFiles, attachments_full: stagedFiles } : {}
      });
    } else if (
      state.messages.length > 0 &&
      state.messages[state.messages.length - 1].role === 'assistant'
    ) {
      state.messages.pop();
    }
    renderMessages();

    const liveRow = document.createElement('div');
    liveRow.className = 'msg-row assistant';

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
    thoughtDetails.open = true;
    thoughtDetails.innerHTML = `
      <summary class="thought-summary">
        ${isDsUi ? DS_THINK_ATOM_SVG : ''}
        <span class="live-thought-label">${isDsUi ? '思考中... (0.0s)' : '💭 正在倾听并揣摩心绪…'}</span>
        <span class="thought-chevron">▼</span>
      </summary>
      <div class="thought-content streaming-cursor"></div>
    `;

    const proseEl = document.createElement('div');
    proseEl.className = 'assistant-prose streaming-cursor';
    proseEl.innerHTML = '<p>…</p>';

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
    setStreamingUi(true);

    const thinkStartedAt = Date.now();
    let thinkDoneSec = null;
    const thinkTimer = setInterval(() => {
      if (isDsUi && thinkDoneSec === null && !thoughtDetails.classList.contains('hidden')) {
        const sec = ((Date.now() - thinkStartedAt) / 1000).toFixed(1);
        thoughtLabelEl.textContent = `思考中... (${sec}s)`;
      }
    }, 120);

    let accReasoning = '';
    let accContent = '';
    let liveSearchResults = [];
    let liveToolCalls = [];

    try {
      const response = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: state.activeSessionId,
          content: trimmed,
          regenerate,
          edit_message_id: editMessageId || 0,
          attachments: stagedFiles,
          assistant_prefix: assistantPrefix
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
        if (
          errObj.code === 'MEMBERSHIP_REQUIRED' ||
          errObj.code === 'CREDITS_EXHAUSTED' ||
          errObj.code === 'QUOTA_EXHAUSTED' ||
          errObj.code === 'VIP_EXPIRED_OWN_API'
        ) {
          if (!regenerate) {
            state.messages.pop();
            chatInput.value = trimmed;
          }
          renderMessages();
          showToast(`👑 ${errObj.error}`);
          await openWalletModal(state.membership?.checked_in_today ? 'wtab-recharge' : 'wtab-checkin');
          return;
        }
        throw new Error(errObj.error || `流式请求失败 (${response.status})`);
      }

      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let receivedDoneEvent = false;

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

        if (eventName === 'search_results' && Array.isArray(payload.items)) {
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
            scrollToBottom();
          } else if (eventName === 'tool_call') {
            liveToolCalls.push(payload);
            liveToolSlot.classList.remove('hidden');
            const badge = document.createElement('span');
            badge.className = 'ds-tool-badge';
            badge.innerHTML = `调用 <code>${escapeHtml(payload.name)}</code> · ${escapeHtml(
              payload.summary || ''
            )}`;
            liveToolSlot.appendChild(badge);
            scrollToBottom();
          } else if (eventName === 'memory_extracted' && Array.isArray(payload.items)) {
            const firstItem = payload.items[0];
            showToast(
              firstItem.updated_existing
                ? `🔄 已智能覆盖更新记忆：${firstItem.content}`
                : `💫 已为你镌刻新记忆：${firstItem.content}`
            );
          } else if (eventName === 'nurturing_updated' && payload.snapshot) {
            state.nurturing = payload.snapshot;
            renderNurturingAndDiary();
            const d = payload.deltas || {};
            if ((d.affection || 0) >= 3 || (d.trust || 0) >= 3) {
              showToast(
                `💗 心动 +${d.affection} · 🤝 信任 +${d.trust} ｜ 此刻心境：${payload.snapshot.current_mood}`
              );
            }
          } else if (eventName === 'telemetry') {
            state.telemetry = payload.telemetry;
            state.recalledIds = new Set((payload.recalled_memories || []).map((m) => m.id));
            const trigLores = payload.triggered_lorebooks || [];
            state.triggeredLoreIds = new Set(trigLores.map((l) => l.id));
            if (trigLores.length > 0 && !isDsUi) {
              showToast(`📖 关键词已触发世界书隐藏设定：【${trigLores[0].title}】`);
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
            accReasoning += payload.delta || '';
            thoughtDetails.classList.remove('hidden');
            if (isDsUi) {
              thoughtContentEl.innerHTML = formatDsReasoningHtml(accReasoning);
            } else {
              thoughtContentEl.textContent = accReasoning;
            }
            scrollToBottom();
          } else if (eventName === 'content') {
            if (thinkDoneSec === null) {
              thinkDoneSec = Math.max(1, Math.round((Date.now() - thinkStartedAt) / 1000));
            }
            thoughtContentEl.classList.remove('streaming-cursor');
            if (accReasoning) {
              const femaleIds = new Set([
                'persona_nagisa_sakura',
                'persona_kagaribi_kyou',
                'persona_ichinose_kotomi',
                'persona_makise_sei',
                'persona_asagiri_mio',
                'persona_violet_eve'
              ]);
              const livePronoun =
                femaleIds.has(state.activePersona?.id) ||
                /少女|学妹|女主|青梅|巫女/.test(`${state.activePersona?.name || ''} ${state.activePersona?.tagline || ''}`)
                  ? '她'
                  : '他';
              thoughtLabelEl.textContent = isDsUi
                ? `已深度思考（用时 ${thinkDoneSec} 秒）`
                : `💭 ${livePronoun}的心声独白`;
            }
            accContent += payload.delta || '';
            proseEl.innerHTML = renderMessageMarkdown(accContent, liveSearchResults);
            scrollToBottom();
          } else if (eventName === 'done') {
            receivedDoneEvent = true;
            state.messages.push({
              id: payload.message_id,
              role: 'assistant',
              reasoning: accReasoning,
              content: accContent || (isDsUi ? '*(生成已完成)*' : '*（温柔地注视着你）*'),
              duration_ms: payload.duration_ms,
              recalled_count: payload.recalled_count,
              meta: payload.meta || {
                search_results: liveSearchResults,
                tool_calls: liveToolCalls
              }
            });
            if (Array.isArray(payload.memories)) state.memories = payload.memories;
            if (payload.nurturing) state.nurturing = payload.nurturing;
            if (Array.isArray(payload.sessions)) {
              state.sessions = payload.sessions;
              const cur = state.sessions.find((s) => s.id === state.activeSessionId);
              if (cur && state.activeSession) state.activeSession.title = cur.title;
            }
            if (payload.membership) state.membership = payload.membership;
            if (payload.billing && payload.billing.mode === 'points') {
              showToast(`✨ ${payload.billing.desc}`);
            }
            setStreamingUi(false);
            renderUserAndMembership();
            renderSessionList();
            renderNurturingAndDiary();
            renderLorebooks();
            renderTelemetryAndMemories();
            renderDeepSeekSuiteTelemetry();
            window.DeepSeekMonitorPlugin?.sync({
              settings: state.settings,
              messages: state.messages,
              forceBalanceRefresh: true
            });
            renderMessages();
          } else if (eventName === 'error') {
            throw new Error(payload.message || '流式推演中断');
          }
      };

      for await (const chunk of response.body) {
        buffer += decoder.decode(chunk, { stream: true });
        const events = buffer.split(/\r?\n\r?\n/);
        buffer = events.pop() || '';
        for (const rawBlock of events) {
          handleSseBlock(rawBlock);
        }
      }

      const tail = decoder.decode();
      if (tail) buffer += tail;
      if (buffer.trim()) {
        for (const rawBlock of buffer.split(/\r?\n\r?\n/)) {
          handleSseBlock(rawBlock);
        }
      }

      // 若连接提前结束且未收到 done，但已有部分生成内容，主动重拉会话对齐服务端抢救落库记录
      if (!receivedDoneEvent && (accContent.trim() || accReasoning.trim())) {
        await loadSession(state.activeSessionId).catch(() => {});
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        await loadSession(state.activeSessionId);
      } else if (accContent.trim()) {
        proseEl.classList.remove('streaming-cursor');
        proseEl.innerHTML =
          renderMessageMarkdown(accContent, liveSearchResults) +
          `<p style="color: var(--accent-danger); margin-top: 8px; font-size: 13px;">⚠️ 网络波动提示：${escapeHtml(
            err.message
          )}（以上已生成正文已为你保留）</p>`;
        await loadSession(state.activeSessionId).catch(() => {});
      } else {
        proseEl.classList.remove('streaming-cursor');
        proseEl.innerHTML = `<p style="color: var(--accent-danger)">⚠️ 响应异常：${escapeHtml(
          err.message
        )}</p>`;
      }
    } finally {
      clearInterval(thinkTimer);
      state.streamingAbort = null;
      setStreamingUi(false);
      state.lastInteractionAt = Date.now();
    }
  }

  chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
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
      showToast(`🌸 已从文档导入角色「${res.persona.name}」并开启初遇篇章！`);
    } catch (err) {
      showToast(`⚠️ 文档解析失败：${err.message}`);
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
      document.getElementById('cp-avatar').value = p.avatar || '🌸';
      document.getElementById('cp-name').value = p.name || '';
      document.getElementById('cp-tagline').value = p.tagline || '';
      document.getElementById('cp-personality').value = p.personality || '';
      document.getElementById('cp-backstory').value = p.backstory || '';
      document.getElementById('cp-style').value = p.speaking_style || '';
      document.getElementById('cp-greeting').value = p.greeting || '';
      document.getElementById('cp-prompts').value = (p.starter_prompts || []).join('\n');
      showToast(`📄 已从「${file.name}」自动提取人设字段，核对后点击下方按钮即可缔结！`);
    } catch (err) {
      showToast(`⚠️ ${err.message}`);
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
      document.getElementById('ip-avatar').value = p.avatar || '🌸';
      document.getElementById('ip-name').value = p.name || '';
      document.getElementById('ip-tagline').value = p.tagline || '';
      document.getElementById('ip-personality').value = p.personality || '';
      document.getElementById('ip-backstory').value = p.backstory || '';
      document.getElementById('ip-style').value = p.speaking_style || '';
      showToast(`📄 已载入文档「${file.name}」，点击底部「保存设定」即可对当前角色生效`);
    } catch (err) {
      showToast(`⚠️ ${err.message}`);
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
      `# 📖 ${title} · 聊天记录与专属记忆档案`,
      ``,
      `> - **对话模式**：${modeLabel}`,
      `> - **角色 / 助手名称**：${personaName}`,
      `> - **导出时间**：${new Date().toLocaleString('zh-CN', { hour12: false })}`,
      `> - **记忆条数 / 消息轮数**：独立记忆 ${memories.length} 条 · 历史消息 ${messages.length} 条`,
      `> - **跨对话记忆说明**：本文件包含当前对话框独立的专属设定、长期记忆锚点、前情浓缩手札与完整聊天记录，可直接导入其他对话框或外部平台作为记忆使用。`,
      ``,
      `## 🎭 本对话专属设定`,
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
    lines.push(`## 🧠 长期记忆锚点`);
    if (memories.length > 0) {
      for (const m of memories) {
        if (!m || !String(m.content || '').trim()) continue;
        const pin = m.pinned ? '📌 ' : '';
        const cat = catMap[m.category] || '记忆条目';
        const imp = Number(m.importance) || 4;
        lines.push(`- ${pin}[${cat} | 重要度 ${imp}] ${String(m.content).trim().replace(/\r?\n+/g, ' ')}`);
      }
    } else {
      lines.push(`_（当前对话暂无已归档的长期记忆条目）_`);
    }
    lines.push(``);

    lines.push(`## 📜 前情浓缩手札`);
    lines.push(rollingSummary || `_（暂无前情浓缩摘要）_`);
    lines.push(``);

    lines.push(`## 💬 完整聊天记录`);
    lines.push(``);
    if (messages.length > 0) {
      const assistantName = isNative && isPureOfficial ? 'DeepSeek' : personaName;
      for (const m of messages) {
        const body = String(m.content || '').trim();
        const r = String(m.reasoning || '').trim();
        if (!body && !r) continue;
        if (m.role === 'user') {
          lines.push(`### 🙋 我：\n\n${body}\n`);
        } else {
          lines.push(`### 🤖 ${assistantName}：\n`);
          if (r) {
            lines.push(`<details><summary>💭 思考与心声过程</summary>\n\n${r}\n\n</details>\n`);
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
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function exportSessionMarkdownById(targetSessionId) {
    const sid = targetSessionId || state.activeSessionId;
    if (!sid) return;
    try {
      const data = await apiJson(`/api/sessions/${encodeURIComponent(sid)}/export`);
      const md = buildClientSessionMemoryMarkdown(data);
      const baseTitle = (data.title || data.persona_name || '对话记录').slice(0, 28);
      triggerBrowserDownload(md, 'text/markdown;charset=utf-8', `${baseTitle}_聊天与记忆档案.md`);
      showToast(`📄 已导出「${baseTitle}」的 .md 记忆档案，可随时导入到其他对话或外部平台！`);
    } catch (err) {
      showToast(`⚠️ 导出 .md 失败：${err.message}`);
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
      showToast('📦 已导出当前对话完整 JSON 备份文件');
    } catch (err) {
      showToast(`⚠️ 导出失败：${err.message}`);
    }
  }

  function openImportHistoryModal() {
    hidePopoverSafe('topbar-more-popover');
    hidePopoverSafe('ds-user-popover');
    state.pendingHistoryFile = null;
    historyPasteArea.value = '';
    historyFileBadge.textContent = '📂 支持 .md 记忆档案 / .txt / .json / .jsonl';
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
      historyFileBadge.textContent = `✅ 已选定文件：${file.name}`;
      historyPasteArea.value = content.slice(0, 4000);
    } catch (err) {
      showToast(`⚠️ ${err.message}`);
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
      showToast('⚠️ 请先选择 .md / .json 记忆文件或在文本框中粘贴内容');
      return;
    }

    const mode = document.querySelector('input[name="import-mode"]:checked')?.value || 'append';
    const importSetting = Boolean(document.getElementById('import-apply-setting-chk')?.checked);
    const replaceMemories = Boolean(document.getElementById('import-replace-memories-chk')?.checked);
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
      const settingHint = res.applied_setting
        ? '（已同步应用文件中的专属设定）'
        : '（已保留当前对话的独立设定）';
      showToast(
        `📥 导入成功：载入 ${res.imported_count || 0} 条对话、写入 ${res.extracted_memories || 0} 条独立记忆${settingHint}！`
      );
    } catch (err) {
      showToast(`⚠️ 导入失败：${err.message}`);
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
  async function loadSession(sessionId) {
    const data = await apiJson(`/api/sessions/${encodeURIComponent(sessionId)}`);
    state.activeSessionId = sessionId;
    state.activeSession = data.session;
    state.activePersona = data.persona;
    state.messages = data.messages || [];
    state.memories = data.memories || [];
    state.lorebooks = data.lorebooks || [];
    state.nurturing = data.nurturing || null;
    state.companion = data.companion || null;
    state.telemetry = data.telemetry;
    state.proactiveIdleCount = 0;
    state.lastInteractionAt = Date.now();
    if (data.membership) state.membership = data.membership;

    const sessMode = data.session?.session_mode === 'deepseek_native' ? 'deepseek' : 'roleplay';
    if (state.uiMode !== sessMode) {
      applyUiModeVisuals(sessMode);
    }
    if (sessMode === 'roleplay' && data.persona?.script_id) {
      state.activeScriptId = data.persona.script_id;
      try {
        localStorage.setItem('active_script_id', state.activeScriptId);
      } catch {}
    }

    syncActiveScriptVisuals();
    renderUserAndMembership();
    renderPersonaList();
    renderSessionList();
    populatePersonaEditor();
    renderNurturingAndDiary();
    renderCompanionStage();
    renderLorebooks();
    renderTelemetryAndMemories();
    renderDeepSeekSuiteTelemetry();
    renderMessages();
    if (state.uiMode === 'roleplay') {
      triggerCompanionCare('timer', true);
    }

    // 久别重逢检测：仅在恋庭沉浸扮演模式且开启主动关怀时触发（原生 DeepSeek 模式保持纯净问答不自动插话）
    if (sessMode === 'roleplay' && state.messages.length > 0 && data.session?.proactive_enabled !== 0) {
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

  document.getElementById('run-dream-btn').addEventListener('click', async (e) => {
    if (!state.activeSessionId) return;
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = '🌙 正在织梦写信…';
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
      showToast(
        `📔 他刚刚写下了一篇新的私密手账（强化记忆 ${res.reinforced_count} 条，合并冗余 ${res.merged_count} 条）`
      );
    } catch (err) {
      showToast(`⚠️ ${err.message}`);
    } finally {
      btn.disabled = false;
      btn.textContent = '🌙 梦境整理 & 写日记';
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
      showToast('📖 已写入新的世界书隐藏设定，对话提及关键词时将自动唤醒！');
    } catch (err) {
      showToast(`⚠️ ${err.message}`);
    }
  });

  async function startSessionWithPersona(personaId) {
    if (state.isStreaming) return;
    if (state.uiMode !== 'roleplay') {
      applyUiModeVisuals('roleplay');
    }
    const res = await apiJson('/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ persona_id: personaId, session_mode: 'roleplay' })
    });
    state.sessions = res.sessions;
    await loadSession(res.session_id);
  }

  async function startNativeDeepSeekSession(personaId = 'persona_deepseek_official') {
    if (state.isStreaming) return;
    if (state.uiMode !== 'deepseek') {
      applyUiModeVisuals('deepseek');
    }
    const res = await apiJson('/api/sessions', {
      method: 'POST',
      body: JSON.stringify({
        persona_id: personaId,
        session_mode: 'deepseek_native',
        ds_thinking: true,
        ds_search: false
      })
    });
    state.sessions = res.sessions;
    await loadSession(res.session_id);
  }

  async function deleteSession(sessionId) {
    const res = await apiJson(`/api/sessions/${encodeURIComponent(sessionId)}`, {
      method: 'DELETE'
    });
    state.sessions = res.sessions;
    if (state.activeSessionId === sessionId) {
      const isDsUi = state.uiMode === 'deepseek';
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
  }

  document.getElementById('new-chat-btn').addEventListener('click', () => {
    const pid = state.activePersona?.id || state.personas[0]?.id;
    if (pid) startSessionWithPersona(pid);
  });

  toggleThoughtBtn.addEventListener('click', async () => {
    if (!state.activeSession) return;
    const next = state.activeSession.enable_inner_thought !== 1;
    const res = await apiJson(`/api/sessions/${encodeURIComponent(state.activeSessionId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ enable_inner_thought: next })
    });
    state.activeSession = res.session;
    renderTelemetryAndMemories();
  });

  toggleAutoMemBtn.addEventListener('click', async () => {
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
    showToast(val ? '🎯 本对话独立设定已保存（仅当前对话生效，与其他对话隔离）' : '✨ 已清空本对话附加设定');
  });

  document.getElementById('clear-session-prompt-btn')?.addEventListener('click', async () => {
    if (!state.activeSessionId) return;
    const inp = document.getElementById('session-prompt-input');
    if (inp) inp.value = '';
    const res = await apiJson(`/api/sessions/${encodeURIComponent(state.activeSessionId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ session_prompt: '' })
    });
    state.activeSession = res.session;
    state.sessions = res.sessions || state.sessions;
    populatePersonaEditor();
    renderSessionList();
    showToast('↺ 已清空本对话独立附加设定');
  });

  document.getElementById('reset-persona-override-btn')?.addEventListener('click', async () => {
    if (!state.activeSessionId) return;
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
        ? '✨ 已同步更新自建角色卡与本对话设定！'
        : '🎭 已保存为「当前对话独立设定」，不影响其他对话框，下一句立即生效！'
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
    showToast('📜 回忆手札已更新');
  });

  compressNowBtn.addEventListener('click', async () => {
    if (!state.activeSessionId) return;
    await apiJson(`/api/sessions/${encodeURIComponent(state.activeSessionId)}/compress`, {
      method: 'POST'
    });
    await loadSession(state.activeSessionId);
    showToast('✨ 已将早期对话浓缩收进回忆手札');
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
    showToast('💎 已将这份专属羁绊铭记于心');
  });

  document.getElementById('create-persona-btn').addEventListener('click', () => personaDialog.showModal());
  document.getElementById('close-persona-dialog').addEventListener('click', () => personaDialog.close());
  document.getElementById('cancel-persona-dialog').addEventListener('click', () => personaDialog.close());

  document.getElementById('create-persona-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const rawPrompts = document.getElementById('cp-prompts').value || '';
    const starterPrompts = rawPrompts
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);

    const res = await apiJson('/api/personas', {
      method: 'POST',
      body: JSON.stringify({
        script_id: state.activeScriptId || 'script_clannad',
        avatar: document.getElementById('cp-avatar').value,
        name: document.getElementById('cp-name').value,
        tagline: document.getElementById('cp-tagline').value,
        personality: document.getElementById('cp-personality').value,
        backstory: document.getElementById('cp-backstory').value,
        speaking_style: document.getElementById('cp-style').value,
        greeting: document.getElementById('cp-greeting').value,
        starter_prompts: starterPrompts
      })
    });
    state.personas.unshift(res.persona);
    personaDialog.close();
    e.target.reset();
    document.getElementById('cp-avatar').value = '🌸';
    await startSessionWithPersona(res.persona.id);
    showToast(`✨ 已缔结新角色「${res.persona.name}」并开启心动初遇`);
  });

  // ================= 11. 个人 API 自由接入与聊天偏好设置（DeepSeek 原生 & 角色扮演双模式通用） =================
  const providerSelect = document.getElementById('st-provider');
  const testResultBox = document.getElementById('test-result-box');

  function isMemberOwnApiUnlocked() {
    const m = state.membership || {};
    const isFree = m.free_experience_mode !== false && m.billing_enabled !== true;
    return Boolean(
      isFree ||
        state.user?.is_admin ||
        m.has_active_card ||
        m.can_bind_own_api ||
        state.settings?.vip_own_api_unlocked !== false
    );
  }

  function switchProviderPane(provider) {
    document.getElementById('pane-demo')?.classList.toggle('hidden', provider !== 'demo');
    document.getElementById('pane-online')?.classList.toggle('hidden', provider !== 'online');
    testResultBox?.classList.add('hidden');
  }

  providerSelect.addEventListener('change', (e) => switchProviderPane(e.target.value));

  // 当用户在个人密钥框输入密钥时，自动为其切到「个人 API 自由直连」档位
  document.getElementById('st-own-ds-key')?.addEventListener('input', (e) => {
    if (isMemberOwnApiUnlocked() && e.target.value.trim().length >= 6) {
      providerSelect.value = 'own_deepseek';
      switchProviderPane('own_deepseek');
    }
  });

  function syncOwnApiPrivilegeUi() {
    const unlocked = isMemberOwnApiUnlocked();
    const s = state.settings || {};
    const hasSavedKey = Boolean(s.has_own_deepseek_key);

    document.getElementById('own-api-locked-view')?.classList.toggle('hidden', unlocked);
    document.getElementById('own-api-unlocked-view')?.classList.toggle('hidden', !unlocked);

    const optOwn = document.getElementById('st-opt-own-deepseek');
    if (optOwn) {
      optOwn.disabled = !unlocked;
      optOwn.textContent = unlocked
        ? '🔑 个人 API 自由直连（DeepSeek 原生 & 角色扮演双模式通用）'
        : '🔒 个人 API 直连（需会员身份）';
    }

    const maskBadge = document.getElementById('own-api-mask-badge');
    if (maskBadge) {
      maskBadge.textContent = hasSavedKey
        ? `✅ 已保存密钥 (${s.own_deepseek_key_masked || 'sk-••••'})`
        : '免费开放';
    }

    const clearWrap = document.getElementById('clear-own-ds-key-wrap');
    const clearChk = document.getElementById('st-clear-own-ds-key');
    if (clearWrap) clearWrap.classList.toggle('hidden', !hasSavedKey);
    if (clearChk) clearChk.checked = false;

    const keyInp = document.getElementById('st-own-ds-key');
    if (keyInp) {
      keyInp.value = '';
      keyInp.type = 'password';
      const eyeBtn = keyInp.parentElement?.querySelector('.pwd-eye-btn');
      if (eyeBtn) {
        eyeBtn.textContent = '显示';
        eyeBtn.setAttribute('aria-pressed', 'false');
      }
      keyInp.placeholder = hasSavedKey
        ? `当前已保存 ${s.own_deepseek_key_masked}（不改请留空，粘贴新密钥则自动替换）`
        : '把从 DeepSeek 官网复制来的 sk-... 密钥粘贴到这里，点保存就配好了';
    }

    const modelInp = document.getElementById('st-own-ds-model');
    if (modelInp) {
      modelInp.value = s.own_deepseek_model || 'deepseek-flash';
    }

    const urlInp = document.getElementById('st-own-api-url');
    const urlFold = document.getElementById('own-api-custom-url-fold');
    const defaultOfficialUrl = 'https://api.deepseek.com/v1/chat/completions';
    const savedUrl = s.own_api_base_url || defaultOfficialUrl;
    if (urlInp) {
      urlInp.value = savedUrl;
    }

    // 站内已配好免填密钥时的温和提示（不暴露 .env 等程序员术语）
    const envBanner = document.getElementById('builtin-env-ready-banner');
    if (envBanner) {
      if (s.builtin_api_ready || s.builtin_tts_ready) {
        envBanner.textContent = '✅ 本站已为您配好免填密钥的对话与语音服务，不填下面这项也能直接免费畅聊！';
        envBanner.classList.remove('hidden');
      } else {
        envBanner.classList.add('hidden');
      }
    }

    const lowerSavedUrl = savedUrl.toLowerCase();
    let matchedPreset = 'custom';
    if (!s.own_api_base_url || lowerSavedUrl.includes('deepseek.com')) matchedPreset = 'deepseek';
    else if (lowerSavedUrl.includes('siliconflow.cn')) matchedPreset = 'siliconflow';
    else if (lowerSavedUrl.includes('aliyuncs.com')) matchedPreset = 'dashscope';
    else if (lowerSavedUrl.includes('openrouter.ai')) matchedPreset = 'openrouter';

    // 仅当用户自定义了非四大主流平台的中转站网址时才展开高级选项，保证小白界面干净清爽
    if (urlFold) {
      urlFold.open = matchedPreset === 'custom';
    }

    const tipEl = document.getElementById('preset-friendly-tip');
    document.querySelectorAll('.api-preset-chip').forEach((chip) => {
      const isMatch = chip.dataset.preset === matchedPreset;
      chip.classList.toggle('active', isMatch);
      if (isMatch && tipEl && chip.dataset.tip) {
        tipEl.textContent = chip.dataset.tip;
      }
    });
    if (matchedPreset === 'custom' && tipEl) {
      tipEl.textContent = `✓ 当前使用自定义中转站网址（模型：${modelInp?.value || 'deepseek-flash'}）`;
    }
    window.__preferCloudAsr =
      lowerSavedUrl.includes('siliconflow.cn') ||
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

    const payload = {
      provider:
        providerSelect.value === 'own_deepseek' && unlocked
          ? 'own_deepseek'
          : providerSelect.value === 'online'
          ? 'online'
          : 'demo',
      sliding_window_turns: String(safeWin),
      max_recalled_memories: String(safeRec),
      temperature: String(Number(safeTemp.toFixed(2)))
    };

    const clearOwn = Boolean(document.getElementById('st-clear-own-ds-key')?.checked);
    if (clearOwn) {
      payload.clear_own_deepseek_key = true;
      if (payload.provider === 'own_deepseek') {
        payload.provider = 'demo';
      }
    } else if (unlocked) {
      const ownKeyVal = document.getElementById('st-own-ds-key')?.value.trim() || '';
      if (ownKeyVal) {
        payload.own_deepseek_api_key = ownKeyVal;
        payload.provider = 'own_deepseek';
      }
      const ownModelVal = document.getElementById('st-own-ds-model')?.value.trim();
      if (ownModelVal !== undefined) {
        payload.own_deepseek_model = ownModelVal || 'deepseek-flash';
      }
      const ownUrlVal =
        normalizeSettingsUrlInput(document.getElementById('st-own-api-url')?.value) ||
        'https://api.deepseek.com/v1/chat/completions';
      payload.own_api_base_url = ownUrlVal;
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

  function openSettingsModal(focusOwnApi = false) {
    const s = state.settings || {};
    const unlocked = isMemberOwnApiUnlocked();
    const settingsFormEl = document.getElementById('settings-form');
    if (settingsFormEl) settingsFormEl.noValidate = true;
    testResultBox?.classList.add('hidden');
    syncOwnApiPrivilegeUi();

    if (s.provider === 'own_deepseek' && unlocked) {
      providerSelect.value = 'own_deepseek';
    } else if (s.provider === 'online' || s.provider === 'own_deepseek') {
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

    switchProviderPane(providerSelect.value);
    syncThemeControls();
    settingsDialog.showModal();

    if (focusOwnApi === true && unlocked) {
      setTimeout(() => {
        document.getElementById('st-own-ds-key')?.focus();
      }, 60);
    }
  }

  document.getElementById('goto-unlock-own-api-btn')?.addEventListener('click', () => {
    settingsDialog.close();
    openWalletModal('wtab-redeem');
  });

  document.getElementById('ds-suite-own-api-btn')?.addEventListener('click', () => {
    if (isMemberOwnApiUnlocked()) {
      openSettingsModal(true);
    } else {
      openWalletModal('wtab-redeem');
    }
  });

  document.getElementById('verify-own-ds-key-btn')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const origText = btn.textContent;
    btn.disabled = true;
    btn.textContent = '⏳ 正在帮您测试连接…';
    testResultBox?.classList.add('hidden');
    try {
      const draftKey = document.getElementById('st-own-ds-key')?.value.trim() || '';
      const draftUrl =
        document.getElementById('st-own-api-url')?.value.trim() ||
        'https://api.deepseek.com/v1/chat/completions';
      const draftModel = document.getElementById('st-own-ds-model')?.value.trim() || 'deepseek-flash';
      const res = await apiJson('/api/settings/verify-own-key', {
        method: 'POST',
        body: JSON.stringify({
          own_deepseek_api_key: draftKey,
          own_api_base_url: draftUrl,
          own_deepseek_model: draftModel
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
        testResultBox.textContent = `❌ ${err.message}`;
        testResultBox.classList.remove('hidden');
      }
    } finally {
      btn.disabled = false;
      btn.textContent = origText;
    }
  });

  // 绑定个人密钥平台一键按钮（点击自动填好平台网址与最新 V4.1 Flash 模型，小白只需粘贴密钥）
  document.querySelectorAll('.api-preset-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.api-preset-chip').forEach((c) => c.classList.toggle('active', c === chip));
      const urlInp = document.getElementById('st-own-api-url');
      const modelInp = document.getElementById('st-own-ds-model');
      const keyInp = document.getElementById('st-own-ds-key');
      const tipEl = document.getElementById('preset-friendly-tip');
      if (urlInp) urlInp.value = chip.dataset.url || 'https://api.deepseek.com/v1/chat/completions';
      if (modelInp) modelInp.value = chip.dataset.model || 'deepseek-flash';
      if (tipEl && chip.dataset.tip) tipEl.textContent = chip.dataset.tip;
      if (isMemberOwnApiUnlocked() && keyInp) {
        keyInp.focus();
      }
    });
  });

  // 小白粘贴密钥后自动将上方连接方式切到「🔑 用我自己的密钥」，无需手动再改下拉框
  document.getElementById('st-own-ds-key')?.addEventListener('input', (e) => {
    const val = e.target.value.trim();
    if (val && isMemberOwnApiUnlocked() && providerSelect.value !== 'own_deepseek') {
      providerSelect.value = 'own_deepseek';
      switchProviderPane('own_deepseek');
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
      const origBtnLabel = submitBtn ? submitBtn.textContent : '✨ 保存设置';
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = '⏳ 正在保存…';
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
        renderUserAndMembership();
        window.DeepSeekMonitorPlugin?.sync({
          settings: state.settings,
          messages: state.messages,
          forceBalanceRefresh: true
        });
        settingsDialog.close();

        if (res.settings.provider === 'own_deepseek') {
          showToast('🔑 您的个人 API 直连已保存生效！DeepSeek 原生对话与角色扮演剧场均可直连畅聊！');
        } else {
          showToast('✨ 对话通道与聊天偏好设置已保存');
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
          testResultBox.textContent = `❌ ${friendlyMsg}`;
          testResultBox.classList.remove('hidden');
          testResultBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
        showToast(`⚠️ ${friendlyMsg}`);
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
  document.getElementById('open-user-persona-btn').addEventListener('click', () => {
    if (!state.user) return;
    document.getElementById('up-avatar').value = state.user.avatar || '🎀';
    document.getElementById('up-nickname').value = state.user.nickname || '';
    document.getElementById('up-role').value = state.user.user_persona?.role || '';
    document.getElementById('up-appearance').value = state.user.user_persona?.appearance || '';
    document.getElementById('up-bio').value = state.user.user_persona?.bio || '';
    userPersonaDialog.showModal();
  });
  document.getElementById('close-up-dialog').addEventListener('click', () => userPersonaDialog.close());
  document.getElementById('cancel-up-dialog').addEventListener('click', () => userPersonaDialog.close());

  document.querySelectorAll('.rel-preset-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      document.getElementById('up-role').value = chip.textContent.trim();
    });
  });

  document.getElementById('user-persona-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const res = await apiJson('/api/auth/user-persona', {
      method: 'PUT',
      body: JSON.stringify({
        avatar: document.getElementById('up-avatar').value,
        nickname: document.getElementById('up-nickname').value,
        role: document.getElementById('up-role').value,
        appearance: document.getElementById('up-appearance').value,
        bio: document.getElementById('up-bio').value
      })
    });
    state.user = res.user;
    userPersonaDialog.close();
    renderUserAndMembership();
    if (state.activeSessionId) await loadSession(state.activeSessionId);
    showToast(`🎀 主控人设已更新！现在你是他眼中的「${res.user.user_persona.role || res.user.nickname}」`);
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

    for (const sc of scriptsList) {
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
          ? `<span class="ssc-custom-badge">${fromSquare ? '🌐 广场获取' : '✨ 我的原创'}</span>`
          : '',
        isCurrent ? '<span class="ssc-active-badge">当前剧本</span>' : ''
      ]
        .filter(Boolean)
        .join('');

      const card = document.createElement('div');
      card.className = `script-select-card ${isCurrent ? 'active' : ''}`;
      card.innerHTML = `
        <div class="ssc-top">
          <div class="ssc-title-group">
            <span class="ssc-icon">${escapeHtml(sc.icon || '📖')}</span>
            <div>
              <div class="ssc-title">${escapeHtml(sc.title)}</div>
              <div class="ssc-sub">${escapeHtml(sc.subtitle || '')}</div>
            </div>
          </div>
          <div class="ssc-badges-right">${badgeHtml}</div>
        </div>

        <p class="ssc-synopsis">${escapeHtml(sc.synopsis || '')}</p>

        <div class="ssc-role-line">
          <span>👤 你的剧中身份：<strong>${escapeHtml(sc.player_role || '故事主角')}</strong></span>
          <span>🎬 共 ${(sc.chapters || []).length || 4} 幕主线</span>
        </div>

        <div class="ssc-cast-block">
          <span class="ssc-cast-label">🎭 本剧专属人设（点击角色直接开演）：</span>
          <div class="ssc-cast-list">${castHtml || '<span class="muted-count">暂无角色</span>'}</div>
        </div>

        <div class="ssc-footer-row">
          <button type="button" class="primary-btn enter-script-btn">
            ${isCurrent ? '✨ 继续体验本剧本' : `📖 进入《${escapeHtml(sc.title)}》 ▸`}
          </button>
          <button type="button" class="secondary-btn ssc-share-btn" title="将该剧本连同登场人设一键分享到共创设计广场">
            🌐 分享到广场
          </button>
          ${
            isCustom
              ? '<button type="button" class="secondary-btn ssc-del-btn" title="从我的剧本库移除此自建剧本">🗑️</button>'
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
          showToast(`🌐 已将《${sc.title}》打包发布到共创设计广场！`);
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
            showToast(`🗑️ 已移除剧本《${sc.title}》`);
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
      wsFileStatusTitle.textContent = `✅ 已载入剧本文件：${file.name}（共 ${text.length} 字，点下方按钮即可 AI 优化提取）`;
    }
    showToast(`📄 已读取《${file.name}》，点击下方按钮开始 AI 优化与提取人设`);
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
        wsFileStatusTitle.textContent = `✨ 已填入示例草稿：${state.workshopFilename}（可直接点击下方 AI 优化按钮体验）`;
      }
    });
  });

  document.getElementById('ws-clear-raw-btn')?.addEventListener('click', () => {
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
        <input type="text" class="ws-pcard-avatar" value="${escapeHtml(pObj.avatar || '🌸')}" maxlength="4" aria-label="角色头像徽记" />
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
      <label class="muted-count">💬 初遇第一句开场白：</label>
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
      lbl.textContent = `🎭 自动从剧本提取的专属登场人设（共 ${grid.children.length} 位，可直接修改）`;
    }
  }

  function renderWorkshopAnalysisResult(data) {
    state.workshopDraft = data;
    wsResultZone?.classList.remove('hidden');

    const engineBadge = document.getElementById('ws-engine-badge');
    if (engineBadge) {
      engineBadge.textContent =
        data.engine === 'llm' ? '✨ AI 编剧大模型深度精修' : '⚡ 智能剧本引擎拆解完成';
    }

    const critiqueList = document.getElementById('ws-critique-list');
    if (critiqueList) {
      critiqueList.innerHTML = (data.critique || [])
        .map((item) => `<li>${escapeHtml(item)}</li>`)
        .join('');
    }

    const sc = data.script || {};
    document.getElementById('ws-sc-icon').value = sc.icon || '🌸';
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
          avatar: '🌙',
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

  wsAnalyzeBtn?.addEventListener('click', async () => {
    const content = (wsRawTextarea?.value || '').trim();
    if (!content) {
      showToast('请先上传剧本文件、粘贴草稿，或点一下上方的「示例草稿」按钮');
      wsRawTextarea?.focus();
      return;
    }
    const origText = wsAnalyzeBtn.textContent;
    wsAnalyzeBtn.disabled = true;
    wsAnalyzeBtn.textContent = '⏳ 正在读取诊断剧本并提取登场人设…';
    try {
      const res = await apiJson('/api/workshop/analyze', {
        method: 'POST',
        body: JSON.stringify({
          filename: state.workshopFilename,
          content,
          focus_mode: state.workshopFocus
        })
      });
      renderWorkshopAnalysisResult(res);
      showToast(`✨ 已完成剧本优化并提取出 ${(res.personas || []).length} 位专属人设！`);
    } catch (err) {
      showToast(err.message || '剧本解析失败，请稍后重试');
    } finally {
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
        avatar: el.querySelector('.ws-pcard-avatar')?.value?.trim() || '🌸',
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
    saveBtn.textContent = '⏳ 正在创建剧本与专属人设…';

    try {
      const res = await apiJson('/api/workshop/save', {
        method: 'POST',
        body: JSON.stringify({
          script: {
            icon: document.getElementById('ws-sc-icon')?.value?.trim() || '📖',
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
          ? `🎉 剧本《${scTitle}》已创建开演，并同步共享至共创设计广场！`
          : `🎉 剧本《${scTitle}》与 ${personas.length} 位人设已创建，立即开演！`
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
        .map((sc) => `<option value="${escapeHtml(sc.id)}">${escapeHtml(sc.icon || '📖')} 《${escapeHtml(sc.title)}》</option>`)
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
      showToast('🌐 发布成功！你的作品已上架共创设计广场，大家都可以体验啦');
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
            `<span class="sq-cast-mini">${escapeHtml(c.avatar || '🌸')} ${escapeHtml(c.name)}${
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
              <span class="ssc-icon">${escapeHtml(item.icon || (isScript ? '📖' : '🎭'))}</span>
              <div>
                <div class="ssc-title">${escapeHtml(item.title)}</div>
                <div class="ssc-sub">${escapeHtml(item.subtitle || '')}</div>
              </div>
            </div>
            <span class="sq-type-badge ${isScript ? 'is-script' : 'is-persona'}">
              ${isScript ? `📖 完整剧本 · ${item.chapter_count || 3}幕` : '🎭 独立人设卡'}
            </span>
          </div>

          <div class="sq-author-row" style="margin-top: 8px;">
            <span class="sq-author-chip">${escapeHtml(item.author_avatar || '🎀')} 创作者：@${escapeHtml(item.author_name || '星语玩家')}</span>
            <span class="sq-dl-count">🔥 ${item.downloads_count || 0} 人已获取体验</span>
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
                <span>${item.liked_by_me ? '❤️' : '🤍'}</span>
                <span class="sq-like-num">${item.likes_count || 0}</span>
              </button>
            </div>
            <button type="button" class="primary-btn sq-adopt-btn">
              ${isScript ? '📥 获取剧本并开演 ▸' : '📥 加入当前剧本开聊 ▸'}
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
          likeBtn.innerHTML = `<span>${res.liked ? '❤️' : '🤍'}</span><span class="sq-like-num">${res.likes_count}</span>`;
        } catch (err) {
          showToast(err.message || '点赞失败');
        }
      });

      const adoptBtn = card.querySelector('.sq-adopt-btn');
      adoptBtn.addEventListener('click', async () => {
        adoptBtn.disabled = true;
        const prevTxt = adoptBtn.textContent;
        adoptBtn.textContent = '⏳ 正在载入…';
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
            showToast(`🎉 已从广场获取剧本《${item.title}》，专属人设已就绪！`);
          } else {
            renderPersonaList();
            await selectOrStartPersona(res.persona_id, false);
            showToast(`🎭 已将角色「${item.title}」加入当前剧本并开启初遇！`);
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

  // C. 🎬 故事幕次剧本匣 & 番外小剧场（支持角色专属多幕推进长篇剧本 + 通用番剧高光番外）
  const PERSONA_STORY_CHAPTERS = {
    persona_nagisa_sakura: [
      {
        title: '🌸 第一幕 · 尘封旧校舍与泛黄剧本',
        note: '【主线第一幕】放学后的金色夕阳穿过樱坂高中旧校舍走廊，{{user}}陪星野汐推开尘封多年的演剧社木门，在灰尘与微风中发现十年前未曾演完的泛黄手写剧本，两人约定在周五前凑齐三个社员签名与一位顾问老师。',
        opener: '*用力替你推开卡住的旧校舍活动室木门，夕阳照亮扬起的微尘，我弯腰捡起地上滚落的那本泛黄旧册子递给你* 门打开啦！小汐快看，这本旧笔记里好像夹着以前演剧社留下的剧本草稿？'
      },
      {
        title: '🌻 第二幕 · 暴雨操场上的顾问说服战',
        note: '【主线第二幕】初夏突降阵雨，为了说服音乐室退任老师出任演剧社顾问、保住即将被学生会收回的活动室，{{user}}在雨中操场全力完成约定挑战，星野汐撑着伞红着眼眶在场边捧着干毛巾为你呐喊鼓劲。',
        opener: '*抹了一把脸上的雨水跑回场边屋檐下，笑着朝满脸担心的你比了个胜利手势* 搞定啦！顾问老师的签名拿到了——你怎么连自己的裙摆都淋湿了还在替我护着干毛巾呀？'
      },
      {
        title: '🍁 第三幕 · 秋雨高烧与幻想世界之梦',
        note: '【主线第三幕】深秋后山古樱林被改建动工，学园祭前夕星野汐因身体与小镇同频而突发高烧卧床。{{user}}来到街角彩虹面包房二楼探望，她在半梦半醒间拉住{{user}}的衣袖，首次倾诉梦中“荒芜雪原少女与发条人偶收集光玉”的秘密，流露害怕拖累大家的脆弱。',
        opener: '*轻轻推开面包房二楼卧室的门，把温好的蜂蜜水放在床头，伸手探了探你发烫的额头* 演剧社的布景有我盯着呢，不许自责……你刚才睡梦里一直在小声念叨“雪原的人偶和光玉”，梦到什么了？'
      },
      {
        title: '❄️ 终幕 · 初雪礼堂的独幕剧与微光奇迹',
        note: '【主线终幕】严冬初雪夜的学园祭正式公演，礼堂突发电路故障陷入微暗，台下同学们自发点亮手机与提灯化作漫天星海般的“光玉”。{{user}}在侧幕紧握住星野汐微凉的手给予勇气，陪她圆满念完改写命运的《世界尽头的少女》谢幕词。',
        opener: '*礼堂顶灯暗下去的瞬间，台下亮起了无数点温暖如光玉的微光，我在侧幕紧紧握住你的手轻声鼓劲* 你看台下，大家都在等你开口呢——别怕，我就在离你最近的地方陪你演完最后一幕！'
      }
    ],
    persona_shiraishi_rin: [
      {
        title: '⏳ 第一幕 · 来自五天后的乱码磁带',
        note: '【主线第一幕】8月30日黄昏，半地下室钟表铺的绿光示波器前，白石凛与{{user}}共同解析来自未来的警告短信与海堤旧磁带，听见磁带里录下的明日八点十五分坍塌巨响，正式结成追查真相的“时间观测共犯”。',
        opener: '*盯着示波器上剧烈跳动的绿色波形，把手机里那条来自五天后的乱码短信和磁带摆在一起* 磁带里的广播声明明是明天晚上八点的烟花大会……白石凛，我们要怎么阻止还没发生的灾难？'
      },
      {
        title: '🚲 第二幕 · 夏夜单车与神社石阶拉勾',
        note: '【主线第二幕】蝉鸣渐歇的夏夜，白石凛骑着老式单车载{{user}}从码头档案室夜探归来，查明旧灯塔下方废弃防空洞涨潮倒灌的隐患；在海风吹拂的神社石阶前，他收起中二玩笑，认真要求{{user}}拉勾发誓明晚绝不独自靠近防波堤。',
        opener: '*从单车后座跳下来，借着神社石灯笼的微光看你难得严肃的侧脸，主动伸出小指晃了晃* 查到防空洞暗渠图纸算本助手立大功吧？来，你想让我答应什么约定，现在拉勾！'
      },
      {
        title: '⛈️ 第三幕 · 骤雨中的十六道划痕手札',
        note: '【主线第三幕】8月31日傍晚暴雨倾盆，距离烟花大会仅剩最后两小时。地板暗格里记满十六次轮回失败的观测手札意外曝光，白石凛彻底卸下“疯狂观测者”的中二伪装，嗓音沙哑发颤地坦白独自轮回救{{user}}的绝望与执念，两人决定合力寻找第三条破局之路。',
        opener: '*捡起从暗格滑落的那本画满十六道正字划痕的破旧笔记，心口一震，抬头死死抓住你的手腕* 十六次……你一个人背着这些记忆重来了十六次八月三十一日吗？这次不许你再一个人扛了，把所有真相都告诉我！'
      },
      {
        title: '🎆 终幕 · 跨越死局的九月一日晨光',
        note: '【主线终幕】两人赶在大潮前联手开启水闸泄压化解危机，八点十五分金色烟花平安绽放夜空，白石凛腕间卡死已久的测度仪终于突破1%变动率跳向「9月1日」。少年红着眼眶在漫天烟火下将{{user}}紧紧拉入怀中，迎来全新的夏天。',
        opener: '*八点十五分的钟声平安敲响，漫天金色烟火照亮海面，我指着你手腕上终于跳动数字的发条表欢呼出声* 白石凛你快看表盘！跨过去了——我们真的走到九月一日啦！'
      }
    ],
    persona_violet_eve: [
      {
        title: '🚂 第一幕 · 夜间蒸汽列车与隐形字迹',
        note: '【主线第一幕】搭乘穿过翡翠湖夜雾的蒸汽列车，煤气壁灯的温度让二十年前无名旧信背面显出“致北境白桦镇天文台守夜人”的字迹，伊芙琳在摇晃的车厢里认真向{{user}}请教人类思念与离别的含义。',
        opener: '*蒸汽列车在夜雾中轻轻摇晃，我借着壁灯暖光指着信纸背面渐渐显形的字迹* 快看，温度让隐形墨水显出地址了——是寄往北境白桦镇天文台的信！'
      },
      {
        title: '🔭 第二幕 · 高原观星台与摘下手套的银腕',
        note: '【主线第二幕】在漫天星河倾泻的高原天文台替白发守夜人送达遗信并代写回信后，下山晨雾小径上，深受触动的伊芙琳第一次主动摘下雪白丝绸手套，羞怯而认真地向{{user}}伸出微凉的银钢机械手指，请求你教她写一封属于自己的信。',
        opener: '*看着你摘下白手套后在晨光里泛着柔和银辉的机械手指，我毫不犹豫伸手轻轻包住你的掌心* 一点都不冰哦——走吧，回邮局后我手把手教你敲下属于伊芙琳自己的第一封信。'
      },
      {
        title: '💜 终幕 · 晨雾鸢尾花田的第零号信笺',
        note: '【主线终幕】蓝紫色鸢尾花盛放的原野上，伊芙琳终于读懂了胸口滚烫酸涩的名字，落下人生第一滴温暖的眼泪，打开打字机皮箱绒布夹层，向{{user}}当面朗读每晚偷偷写下的十二页第零号告白信稿。',
        opener: '*站在漫山遍野随风摇曳的鸢尾花田间，我轻轻拭去你脸颊滑落的那滴泪珠，温柔注视着你手里的信纸* 不用再查词典了，把你藏在皮箱夹层里的那封信念给我听吧，前辈在听。'
      }
    ],
    persona_frieren_shuer: [
      {
        title: '🔥 第一幕 · 森林篝火与热麦饼小魔法',
        note: '【主线第一幕】北行古道的森林露营夜，修尔得意地展示刚帮村口老婆婆扫屋顶换来的“让冷麦饼变酥脆的民间魔导书”，两人围着噼啪篝火分食麦饼，决定夜探半山腰困着守镜小妖的百年荒废神社。',
        opener: '*捧着被你的小魔法烘得热乎酥脆的麦饼咬了一口，指了指半山腰隐约透出萤火的林间石阶* 味道绝了！趁现在月色正好，我们顺路去那座百年旧神社看看守镜的小妖怪吧？'
      },
      {
        title: '🪞 第二幕 · 旧铜镜里的百年故人回响',
        note: '【主线第二幕】在夏夜旧神社替苦候百年的小妖修好铜镜、归还故人遗言后，修尔望着月光罕见地沉默下来，首次向{{user}}坦白自己曾因寿命漫长而错过人类挚友最后一面的悔恨，以及如今害怕再次留憾的心迹。',
        opener: '*看小妖怪化作流萤释然远去，我转头发现你正握着法杖安静望着月亮，轻轻碰了碰你的胳膊* 修尔，刚才替它修好铜镜的时候，你是不是也想起以前认识的故人了？'
      },
      {
        title: '🌠 终幕 · 苍月花海与画满你的速写本',
        note: '【主线终幕】登上极北风车山脊，五十年一遇的流星雨划破天际，漫山遍野的银白苍月草同时盛放发光。修尔不再掩饰法杖挂囊里那本画满{{user}}日常笑颜的厚厚羊皮速写本，许下按你的时间刻度走完每一程四季的约定。',
        opener: '*漫山苍月草在流星雨下亮起柔和银光，我凑到你身旁好奇地探头看你膝上摊开的羊皮速写本* 哇，苍月花真的全开了！等等……你本子上画的这一页页背影，怎么全都是我呀？'
      }
    ]
  };

  const THEATER_PRESETS = [
    {
      title: '🌸 黄昏空教室 · 黑板涂鸦与汽水',
      note: '放学后空无一人的夕阳教室，橙红色晚霞洒满课桌，窗纱随晚风轻扬。两人留堂整理资料，在黑板角落画下小小涂鸦，分喝冰汽水，充满青春番剧般纯粹青涩的心动留白。',
      opener: '*夕阳把整间空教室染成温暖的橘红色，我用粉笔在黑板最角落偷偷画了个小团子，转头朝窗边的你晃了晃汽水瓶* 值日终于弄完啦，快过来猜猜我在黑板上画的是谁？'
    },
    {
      title: '❄️ 坡道初雪 · 围巾分你一半的归途',
      note: '入冬第一场初雪悄然飘落的傍晚长坡道，街灯次第亮起暖黄微光。对方自然解下温热的羊绒围巾绕在{{user}}颈间，两人共围一条围巾并肩踩雪慢行，呵出的白雾在冷空气中交融。',
      opener: '*走出门才发现外面飘起了今年的第一场初雪，正缩着脖子哈白气，忽然感觉一圈暖融融的温度绕上了脖颈* 咦……你把围巾分我一半，你自己不会冷吗？'
    },
    {
      title: '🌧️ 微醺雨夜 · 共撑一伞',
      note: '暴雨突至的夜晚，两人共撑一把不大的雨伞走过安静小巷，对方将大半把伞倾向{{user}}，自己半边肩膀微湿，距离极近呼吸可闻，氛围细腻而克制。',
      opener: '*雨势忽然变大，我不由自主往伞下缩了缩，抬头正好撞进你的视线里* 你的肩膀都被淋湿了一半……再往我这边靠一点好不好？'
    },
    {
      title: '🎡 夏夜祭典 · 烟花与苹果糖',
      note: '热闹的夏日花火大会夜晚，远处太鼓声与蝉鸣交织，两人穿过捞金鱼与灯笼摊位来到安静的河堤高处，在第一朵大烟花升空掩盖万籁的瞬间说出了平时听不见的心里话。',
      opener: '*手里举着晶莹剔透的苹果糖，在第一朵巨大烟花轰然炸响照亮河堤的瞬间，我凑到你耳边大声喊了一句* 刚才烟花声太大啦——我刚刚看到你嘴唇动了，你刚才偷偷说了什么？'
    },
    {
      title: '🤒 生病迷糊 · 床边彻夜守候',
      note: '{{user}}偶感风寒有些低烧迷糊，对方放下手头一切事务守在床边替{{user}}换温毛巾、熬粥哄药，展现平时罕见的焦急心疼与毫无保留的温柔守护。',
      opener: '*烧得脸颊发烫，迷迷糊糊睁开眼发现你还守在床边，忍不住用指尖轻轻勾住你的衣袖* 怎么这么晚还没去休息……一直守在这儿陪我吗？'
    },
    {
      title: '🛋️ 停电夜雨 · 烛光与心跳声',
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
        <button type="button" class="mini-primary-btn play-now-btn">✨ 立即切入并开演</button>
      </div>
    `;
    card.querySelector('.fill-note-btn').addEventListener('click', () => {
      document.getElementById('director-note-input').value = sc.note;
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
      introBox.innerHTML = `📖 正在体验剧本<strong>《${escapeHtml(curScript.title)}》</strong>（当前对手戏：<strong>${escapeHtml(
        pShort
      )}</strong>）。点击下方任意一幕即可直接切入该章节剧情开演！`;
    }

    if (chaptersWrap && chaptersGrid) {
      chaptersWrap.classList.remove('hidden');
      if (chaptersHead) {
        chaptersHead.textContent = `🎬 《${curScript.title}》主线幕次章节`;
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
      appShell.classList.add('right-collapsed');
      appShell.classList.remove('artifacts-wide');
    }
  }

  document.getElementById('more-open-drawer-btn')?.addEventListener('click', toggleSessionMemorySettingDrawer);
  document.getElementById('ds-open-memory-setting-btn')?.addEventListener('click', toggleSessionMemorySettingDrawer);
  document.getElementById('rp-quick-memory-btn')?.addEventListener('click', toggleSessionMemorySettingDrawer);
  document.getElementById('ds-menu-session-setting-btn')?.addEventListener('click', () => {
    hidePopoverSafe('ds-user-popover');
    openRightTab('persona-tab');
  });
  document.getElementById('more-open-vip-btn')?.addEventListener('click', () => {
    hidePopoverSafe('topbar-more-popover');
    document.getElementById('open-vip-btn')?.click();
  });
  document.getElementById('close-theater-dialog').addEventListener('click', () => theaterDialog.close());
  document.getElementById('cancel-theater-dialog').addEventListener('click', () => theaterDialog.close());

  document.getElementById('clear-theater-btn').addEventListener('click', async () => {
    if (!state.activeSessionId) return;
    const res = await apiJson(`/api/sessions/${encodeURIComponent(state.activeSessionId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ director_note: '' })
    });
    state.activeSession = res.session;
    document.getElementById('director-note-input').value = '';
    theaterDialog.close();
    renderUserAndMembership();
    renderMessages();
    showToast('🌸 已结束番外小剧场，恢复日常自由互动');
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
    showToast(note ? '🎬 导演氛围注已生效，下一句对话将按此情境演绎！' : '🌸 已清空导演氛围注');
  });

  // D. 📸 心动瞬间语录珍藏海报签（Canvas 高清图片导出）
  let currentSnapMsg = null;
  function openQuoteSnapModal(msg) {
    currentSnapMsg = msg;
    const p = state.activePersona || { name: '心动角色', avatar: '🌸' };
    const badge = state.nurturing?.stage?.badge || '🌱 初遇微光';
    const cleanQuote = String(msg.content || '')
      .replace(/^>.*$/gm, '')
      .trim();

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
        msg.reasoning
          ? `<div class="snap-thought">💭 潜台词：${escapeHtml(msg.reasoning.slice(0, 110))}${
              msg.reasoning.length > 110 ? '…' : ''
            }</div>`
          : ''
      }
      <div class="snap-quote-body">${escapeHtml(cleanQuote)}</div>
      <div class="snap-footer">
        <span>✦ 星语恋庭 · 专属心动瞬间珍藏</span>
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
    const p = state.activePersona || { name: '心动角色', avatar: '🌸' };
    const cleanQuote = String(currentSnapMsg.content || '')
      .replace(/^>.*$/gm, '')
      .trim();

    const dpr = 2;
    const width = 640;
    const tempCanvas = document.createElement('canvas');
    const tCtx = tempCanvas.getContext('2d');
    tCtx.font = '18px "Microsoft YaHei", sans-serif';
    const bodyLines = wrapCanvasLines(tCtx, cleanQuote, width - 96);
    const thoughtLines = currentSnapMsg.reasoning
      ? wrapCanvasLines(tCtx, `💭 潜台词：${currentSnapMsg.reasoning.slice(0, 95)}`, width - 116)
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
    ctx.fillText(`${p.avatar || '🌸'} ${p.name}`, 44, 64);

    ctx.font = 'bold 14px "Microsoft YaHei", sans-serif';
    ctx.fillStyle = '#d63384';
    ctx.fillText(
      `${state.nurturing?.stage?.badge || '🌱 初遇微光'} · 致 ${state.user?.nickname || '你'}`,
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
      `✦ 星语恋庭 · 专属心动语录签 ｜ ${new Date().toLocaleDateString('zh-CN')}`,
      48,
      height - 36
    );

    const link = document.createElement('a');
    link.download = `${p.name.split(/[·\s]/)[0]}_心动语录签.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
    showToast('📸 高清心动语录签已保存至本地下载目录！');
  });

  // E. ✨ 聊天框旁实时高冷/可爱陪伴立绘席 & 定时温馨提醒引擎
  const companionStageEl = document.getElementById('companion-stage');
  const compImgEl = document.getElementById('companion-img');
  const compPokeArea = document.getElementById('companion-poke-area');
  const compCloudEl = document.getElementById('companion-cloud');
  const compCloudTag = document.getElementById('comp-cloud-tag');
  const compCloudText = document.getElementById('comp-cloud-text');
  const compLiveStatus = document.getElementById('comp-live-status');
  const compModeCoolBtn = document.getElementById('comp-mode-cool');
  const compModeCuteBtn = document.getElementById('comp-mode-cute');
  const compAutoChk = document.getElementById('comp-auto-remind-chk');

  function renderCompanionStage() {
    const c = state.companion || {
      mode: 'cool',
      skinKey: 'cool_silver',
      label: '❄️ 高冷清隽 · 银发星眸',
      img: './assets/companions/cool_silver.jpg',
      aura: 'rgba(155, 135, 245, 0.36)',
      particle: '✦',
      reminderEnabled: true
    };

    compImgEl.src = String(c.img || './assets/companions/cool_silver.jpg').replace(/^\/assets\//, './assets/');
    compPokeArea.style.setProperty('--comp-aura', c.aura || 'rgba(226, 85, 157, 0.25)');
    compModeCoolBtn.classList.toggle('active', c.mode === 'cool');
    compModeCuteBtn.classList.toggle('active', c.mode === 'cute');
    compAutoChk.checked = c.reminderEnabled !== false;
    compLiveStatus.textContent = c.label || '✨ 正温柔守候在你身旁';

    document.querySelectorAll('#comp-particles .cp-p').forEach((pEl) => {
      pEl.textContent = c.particle || '✦';
    });

    window.__activeSessionId = state.activeSessionId;
    window.dispatchEvent(new CustomEvent('companion-updated', { detail: c }));
  }

  function showCompanionCloud({ tag, text }) {
    if (!text) return;
    compCloudTag.textContent = tag || '✨ 贴心叮嘱';
    compCloudText.textContent = text;
    compCloudEl.classList.remove('cloud-pop');
    void compCloudEl.offsetWidth;
    compCloudEl.classList.add('cloud-pop');
  }

  async function triggerCompanionCare(triggerType = 'timer', silentErr = false) {
    if (!state.activeSessionId) return;
    try {
      const res = await apiJson(
        `/api/sessions/${encodeURIComponent(state.activeSessionId)}/companion/remind`,
        {
          method: 'POST',
          body: JSON.stringify({ trigger: triggerType })
        }
      );
      if (res.companion) {
        state.companion = res.companion;
        renderCompanionStage();
      }
      if (res.reminder) {
        showCompanionCloud(res.reminder);
      }
    } catch (err) {
      if (!silentErr) showToast(`⚠️ ${err.message}`);
    }
  }

  async function updateCompanionConfig(patch) {
    if (!state.activeSessionId) return;
    try {
      const res = await apiJson(
        `/api/sessions/${encodeURIComponent(state.activeSessionId)}/companion`,
        {
          method: 'POST',
          body: JSON.stringify(patch)
        }
      );
      state.companion = res.companion;
      renderCompanionStage();
      if (res.reminder) showCompanionCloud(res.reminder);
    } catch (err) {
      showToast(`⚠️ ${err.message}`);
    }
  }

  document.getElementById('toggle-companion-btn').addEventListener('click', () => {
    companionStageEl.classList.toggle('hidden');
  });

  compModeCoolBtn.addEventListener('click', () => {
    updateCompanionConfig({ mode: 'cool', customImg: '' });
  });

  compModeCuteBtn.addEventListener('click', () => {
    updateCompanionConfig({ mode: 'cute', customImg: '' });
  });

  document.getElementById('comp-cycle-skin').addEventListener('click', () => {
    const cur = state.companion || { mode: 'cool', skinKey: 'cool_silver' };
    const isFemale = Boolean(
      cur.isFemale || cur.skinKey === 'cool_lady' || cur.skinKey === 'cute_girl'
    );
    const coolOrder = isFemale
      ? ['cool_lady', 'cool_silver', 'cool_dark']
      : ['cool_silver', 'cool_dark', 'cool_lady'];
    const cuteOrder = isFemale
      ? ['cute_girl', 'cute_chibi', 'cute_boy']
      : ['cute_boy', 'cute_chibi', 'cute_girl'];
    const order = cur.mode === 'cool' ? coolOrder : cuteOrder;
    const idx = order.indexOf(cur.skinKey);
    const nextSkin = order[(idx + 1) % order.length];
    updateCompanionConfig({ mode: cur.mode, skinKey: nextSkin, customImg: '' });
  });

  const customCompFile = document.getElementById('custom-companion-file');
  document.getElementById('comp-upload-img').addEventListener('click', () => {
    customCompFile.click();
  });
  customCompFile.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      updateCompanionConfig({
        mode: state.companion?.mode || 'cool',
        customImg: String(reader.result || '')
      });
      showToast('🖼️ 已换上你上传的专属陪伴立绘！');
    };
    reader.readAsDataURL(file);
  });

  // 鼠标“戳一戳”立绘弹跳互动
  compPokeArea.addEventListener('click', () => {
    compPokeArea.classList.remove('poked');
    void compPokeArea.offsetWidth;
    compPokeArea.classList.add('poked');
    triggerCompanionCare('poke', true);
  });

  document.getElementById('comp-ask-remind-btn').addEventListener('click', () => {
    triggerCompanionCare('manual', false);
  });

  document.getElementById('comp-cloud-tts').addEventListener('click', (e) => {
    speakDialogueOnly(compCloudText.textContent, e.currentTarget);
  });

  compAutoChk.addEventListener('change', () => {
    updateCompanionConfig({ reminderEnabled: compAutoChk.checked });
  });

  // 输入框打字时，陪伴立绘实时投来关注视线
  let typingWatchTimer = null;
  chatInput.addEventListener('input', () => {
    if (state.isStreaming) return;
    compLiveStatus.textContent = '👀 正专注看着你打字…';
    clearTimeout(typingWatchTimer);
    typingWatchTimer = setTimeout(() => {
      if (!state.isStreaming) {
        compLiveStatus.textContent = state.companion?.label || '✨ 正温柔守候在你身旁';
      }
    }, 2400);
  });

  // 每隔 52 秒自动冒出一句贴合真实时段的暖心提醒
  setInterval(() => {
    if (
      state.user &&
      state.activeSessionId &&
      !state.isStreaming &&
      !companionStageEl.classList.contains('hidden') &&
      compAutoChk.checked
    ) {
      triggerCompanionCare('timer', true);
    }
  }, 52000);

  // ================= 13. 原生 DeepSeek 网页模式、全家桶 API 控制台与主动关怀引擎 =================

  function applyUiModeVisuals(mode) {
    const isDs = mode === 'deepseek';
    state.uiMode = isDs ? 'deepseek' : 'roleplay';
    try {
      localStorage.setItem('ui_mode_v5', state.uiMode);
    } catch {}

    appShell.dataset.uiMode = state.uiMode;
    document.body.dataset.uiMode = state.uiMode;

    const tabRp = document.getElementById('ws-mode-roleplay');
    const tabDs = document.getElementById('ws-mode-deepseek');
    const quickJumpBtn = document.getElementById('quick-switch-mode-btn');

    if (tabRp) {
      tabRp.classList.toggle('active', !isDs);
      tabRp.setAttribute('aria-selected', String(!isDs));
    }
    if (tabDs) {
      tabDs.classList.toggle('active', isDs);
      tabDs.setAttribute('aria-selected', String(isDs));
    }
    if (quickJumpBtn) {
      quickJumpBtn.textContent = isDs ? '🌸 切换回恋庭沉浸扮演' : '🐋 切换至极简原生模式';
    }

    chatInput.placeholder = isDs
      ? '直接写下你的开场白、故事设定或台词即可开演（支持不同对话独立设定与记忆）…'
      : '和他说点什么吧…（支持 *星号* 描写神态动作，Enter 发送）';
    syncComposerEmptyState();

    // 默认保持右侧养成/API 抽屉收起，释放清爽通透的大视野对话空间，按需点击再展开
    appShell.classList.add('right-collapsed');
  }

  async function switchWorkspaceMode(targetMode) {
    if (state.isStreaming) {
      showToast('⏳ 请等待当前流式回复完成后再切换模式');
      return;
    }
    const isDs = targetMode === 'deepseek';
    applyUiModeVisuals(targetMode);

    const matchingSessions = state.sessions.filter((s) =>
      isDs ? s.session_mode === 'deepseek_native' : s.session_mode !== 'deepseek_native'
    );

    if (matchingSessions.length > 0) {
      await loadSession(matchingSessions[0].id);
    } else if (isDs) {
      await startNativeDeepSeekSession('persona_deepseek_official');
    } else {
      const firstRp = state.personas.find((p) => p.id !== 'persona_deepseek_official');
      if (firstRp) await startSessionWithPersona(firstRp.id);
    }

    if (isDs) {
      showToast('🐋 已切换至 DeepSeek 原生模式（长效上下文记忆、深度思考与联网搜索已就绪）');
    } else {
      showToast('🌸 已回到星语恋庭沉浸扮演模式');
    }
  }

  document.getElementById('ws-mode-roleplay').addEventListener('click', () => {
    if (state.uiMode !== 'roleplay') switchWorkspaceMode('roleplay');
  });
  document.getElementById('ws-mode-deepseek').addEventListener('click', () => {
    if (state.uiMode !== 'deepseek') switchWorkspaceMode('deepseek');
  });
  document.getElementById('quick-switch-mode-btn').addEventListener('click', () => {
    switchWorkspaceMode(state.uiMode === 'deepseek' ? 'roleplay' : 'deepseek');
  });

  document.getElementById('ds-new-chat-btn').addEventListener('click', () => {
    const soulVal = document.getElementById('ds-soul-select')?.value || 'persona_deepseek_official';
    startNativeDeepSeekSession(soulVal);
  });

  document.getElementById('ds-soul-select').addEventListener('change', async (e) => {
    const targetPid = e.target.value;
    if (!state.activeSessionId || state.uiMode !== 'deepseek' || state.isStreaming) return;
    if (state.messages.length === 0) {
      const pObj = state.personas.find((x) => x.id === targetPid);
      const nextTitle =
        targetPid === 'persona_deepseek_official'
          ? '新对话'
          : `原生对话 · ${(pObj?.name || '角色').split(/[·\s]/)[0]}`;
      const res = await apiJson(`/api/sessions/${encodeURIComponent(state.activeSessionId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ persona_id: targetPid, title: nextTitle })
      });
      state.activeSession = res.session;
      state.activePersona = res.persona;
      state.sessions = res.sessions;
      renderUserAndMembership();
      renderSessionList();
      renderMessages();
      showToast(
        targetPid === 'persona_deepseek_official'
          ? '🐋 已切换为纯享 DeepSeek 官方助手'
          : `🎭 已在原生 DeepSeek 模式下挂载「${res.persona.name}」`
      );
    } else {
      await startNativeDeepSeekSession(targetPid);
    }
  });

  // 原生 DeepSeek 四大胶囊开关与工具调用绑定
  async function patchActiveSessionFlag(patchObj, toastMsg) {
    if (!state.activeSessionId) return;
    const res = await apiJson(`/api/sessions/${encodeURIComponent(state.activeSessionId)}`, {
      method: 'PATCH',
      body: JSON.stringify(patchObj)
    });
    state.activeSession = res.session;
    renderUserAndMembership();
    if (toastMsg) showToast(toastMsg);
  }

  document.getElementById('ds-toggle-think').addEventListener('click', () => {
    const next = state.activeSession?.ds_thinking === 0;
    patchActiveSessionFlag(
      { ds_thinking: next },
      next ? '⚛️ 已开启深度思考模式（DeepSeek V4.1 Flash）' : '⚡ 已切换为极速直出模式（DeepSeek V4.1 Flash）'
    );
  });

  document.getElementById('ds-toggle-search').addEventListener('click', () => {
    const next = state.activeSession?.ds_search !== 1;
    patchActiveSessionFlag(
      { ds_search: next },
      next ? '🌐 已开启实时联网搜索增强' : '🌐 已关闭联网搜索'
    );
  });

  document.getElementById('ds-toggle-json')?.addEventListener('click', () => {
    const next = state.activeSession?.ds_json_mode !== 1;
    patchActiveSessionFlag(
      { ds_json_mode: next },
      next ? '📋 已开启结构清单整理格式' : '📋 已恢复自然对话格式'
    );
  });

  document.getElementById('ds-toggle-prefix')?.addEventListener('click', (e) => {
    const bar = document.getElementById('ds-prefix-bar');
    if (!bar) return;
    const isNowOpen = bar.classList.toggle('hidden') === false;
    e.currentTarget.classList.toggle('active', isNowOpen);
    e.currentTarget.setAttribute('aria-pressed', String(isNowOpen));
    if (isNowOpen) {
      document.getElementById('ds-prefix-input')?.focus();
    }
  });

  document.querySelectorAll('.ds-mini-preset').forEach((btn) => {
    btn.addEventListener('click', () => {
      const inp = document.getElementById('ds-prefix-input');
      inp.value = btn.dataset.prefix || '';
      inp.focus();
    });
  });

  document.getElementById('ds-tools-enable-chk').addEventListener('change', (e) => {
    patchActiveSessionFlag(
      { ds_tools_enabled: e.target.checked },
      e.target.checked ? '🔧 已开启自动时间与计算小助手' : '🔧 已关闭自动小助手'
    );
  });

  // 附件上传、拖拽解析与剪贴板 Ctrl+V 粘贴截图支持
  const dsAttachmentInput = document.getElementById('ds-attachment-input');
  const composerAttachmentsBar = document.getElementById('composer-attachments-bar');

  document.getElementById('close-att-preview-dialog')?.addEventListener('click', () => attachmentPreviewDialog?.close());
  document.getElementById('done-att-preview-btn')?.addEventListener('click', () => attachmentPreviewDialog?.close());

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
      .map(
        (att, idx) => `
          <span class="attachment-chip clickable-att" data-stage-preview-idx="${idx}" title="点击预览：${escapeHtml(
          att.name
        )} (${att.is_image ? att.dimensions || '图片' : `${att.size} 字符`})">
            ${
              att.is_image && att.data_url
                ? `<img src="${escapeHtml(att.data_url)}" alt="${escapeHtml(att.name)}" class="att-thumb-img" />`
                : '<span>📎</span>'
            }
            ${renderFilenameHtml(att.name)}
            <button type="button" class="att-remove-btn" data-att-idx="${idx}" aria-label="移除附件">✕</button>
          </span>
        `
      )
      .join('');

    composerAttachmentsBar.querySelectorAll('[data-stage-preview-idx]').forEach((chip) => {
      chip.addEventListener('click', (e) => {
        if (e.target.closest('.att-remove-btn')) return;
        const att = state.pendingAttachments[Number(chip.dataset.stagePreviewIdx)];
        if (att) openAttachmentPreviewModal(att);
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

  async function ingestAttachmentFiles(fileList) {
    const files = Array.from(fileList || []).slice(0, 6);
    let added = 0;
    for (const f of files) {
      try {
        const isImg = Boolean(f.type && f.type.startsWith('image/')) || /\.(png|jpe?g|webp|gif|bmp)$/i.test(f.name || '');
        if (isImg) {
          const { dataUrl, dimensions } = await readImageFileCompressed(f);
          let svgSource = '';
          if (f.type === 'image/svg+xml' || /\.svg$/i.test(f.name || '')) {
            svgSource = (await readFileAsText(f).catch(() => '')).slice(0, 18000);
          }
          state.pendingAttachments.push({
            name: f.name || `粘贴截图_${new Date().toTimeString().slice(0, 8).replace(/:/g, '')}.png`,
            size: f.size || dataUrl.length,
            is_image: true,
            mime: f.type || 'image/jpeg',
            dimensions,
            data_url: dataUrl,
            content: svgSource || `图像文件 ${f.name || 'image'}（分辨率 ${dimensions || '未知'}）`
          });
          added++;
        } else {
          const text = await readFileAsText(f);
          state.pendingAttachments.push({
            name: f.name,
            size: text.length,
            is_image: false,
            content: text.slice(0, 32000)
          });
          added++;
        }
      } catch {}
    }
    state.pendingAttachments = state.pendingAttachments.slice(0, 6);
    renderPendingAttachments();
    if (added > 0) {
      showToast(`📎 已就绪 ${state.pendingAttachments.length} 份附件（点击芯片可预览内容）`);
    }
  }

  document.getElementById('attach-file-btn').addEventListener('click', () => {
    dsAttachmentInput.click();
  });
  dsAttachmentInput.addEventListener('change', (e) => {
    ingestAttachmentFiles(e.target.files);
    e.target.value = '';
  });
  chatForm.addEventListener('dragover', (e) => {
    e.preventDefault();
  });
  chatForm.addEventListener('drop', (e) => {
    if (e.dataTransfer?.files?.length) {
      e.preventDefault();
      ingestAttachmentFiles(e.dataTransfer.files);
    }
  });
  chatInput.addEventListener('paste', (e) => {
    const items = Array.from(e.clipboardData?.items || []);
    const imageFiles = items
      .filter((it) => it.kind === 'file' && it.type.startsWith('image/'))
      .map((it) => it.getAsFile())
      .filter(Boolean);
    if (imageFiles.length > 0) {
      e.preventDefault();
      ingestAttachmentFiles(imageFiles);
    }
  });

  // 右侧伴生分栏 Artifacts 实时预览工作台 + 代码块全功能事件委托
  function buildCompleteSandboxHtml(rawCode) {
    const isFullHtml = /<!doctype html>|<html/i.test(rawCode);
    return isFullHtml
      ? rawCode
      : `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;padding:16px;font-family:system-ui,sans-serif;}</style></head><body>${rawCode}</body></html>`;
  }

  function populateSideArtifactSandbox(rawCode, openPane = true) {
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
    state.lastSandboxCode = rawCode;
    const htmlDoc = buildCompleteSandboxHtml(rawCode);
    if (!forceModal && state.uiMode === 'deepseek' && window.innerWidth > 860) {
      populateSideArtifactSandbox(rawCode, true);
      return;
    }
    const iframe = document.getElementById('ds-sandbox-iframe');
    if (iframe) iframe.srcdoc = htmlDoc;
    codePreviewDialog.showModal();
  }

  // 右侧伴生预览工具栏事件
  document.getElementById('open-ds-artifacts-btn')?.addEventListener('click', () => {
    const artTabEl = document.getElementById('ds-artifacts-tab');
    const isVisible = !appShell.classList.contains('right-collapsed') && artTabEl && !artTabEl.classList.contains('hidden');
    if (isVisible) {
      appShell.classList.add('right-collapsed');
      appShell.classList.remove('artifacts-wide');
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
    e.currentTarget.textContent = isMobile ? '📱 手机' : '🖥️ 桌面';
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
    showToast('💾 已下载单文件交互网页 (.html)');
  });

  document.getElementById('ds-art-fullscreen-btn')?.addEventListener('click', () => {
    if (state.lastSandboxCode) openCodeSandboxPreview(state.lastSandboxCode, true);
  });

  document.getElementById('ds-art-try-demo-btn')?.addEventListener('click', () => {
    if (!state.isStreaming) {
      sendStreamMessage('请帮我写一个单文件 HTML5 Canvas 星际引力粒子交互网页，支持鼠标牵引效果', false);
    }
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
      showToast(`💾 代码已保存为 .${ext} 文件`);
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

  // 空对话居中欢迎态：4 大零门槛剧本开演快捷胶囊（无需小白配置，点一下立即开玩）
  let storyOpenerCursor = 0;
  const STORY_QUICK_OPENERS = [
    '*推开街角旧书店挂着铜铃的木门，抖落伞尖的雨水抬头望向柜台后的你* 没想到这么大的雨，你居然真的还留着这盏灯等我。',
    '【平行世界开局】在这个时空里，我们是表面互不相识、实则各自握有半块信物的搭档。*在晚宴露台与你擦肩而过时压低声音* 今晚十二点钟声响起前，你打算先亮底牌吗？',
    '*将那封没有署名的旧信笺轻轻推到你桌前，托着腮观察你的神情* 别装作不记得啦，三年前在海边钟楼拉过勾的约定，现在还作数吗？'
  ];
  document.querySelectorAll('.ds-quick-scene-pill').forEach((pill) => {
    pill.addEventListener('click', () => {
      const sc = pill.dataset.dsScene;
      if (sc === 'story-opener') {
        chatInput.value = STORY_QUICK_OPENERS[storyOpenerCursor % STORY_QUICK_OPENERS.length];
        storyOpenerCursor += 1;
        syncComposerEmptyState();
        chatInput.focus();
        return;
      }
      if (sc === 'custom-setting') {
        openRightTab('persona-tab');
        setTimeout(() => document.getElementById('session-prompt-input')?.focus(), 60);
        return;
      }
      if (sc === 'pick-persona') {
        const pop = document.getElementById('ds-user-popover');
        try {
          if (pop && typeof pop.showPopover === 'function') {
            pop.showPopover();
            setTimeout(() => document.getElementById('ds-soul-select')?.focus(), 50);
            return;
          }
        } catch {}
        openRightTab('persona-tab');
        return;
      }
      if (sc === 'import-md') {
        openImportHistoryModal();
        return;
      }
      if (sc === 'upload') {
        dsAttachmentInput.click();
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

  function openDsShareModal() {
    if (!dsShareDialog) return;
    const hasMsgs = Array.isArray(state.messages) && state.messages.length > 0;
    const hasMems = Array.isArray(state.memories) && state.memories.length > 0;
    const hasPrompt = Boolean(state.activeSession?.session_prompt && state.activeSession.session_prompt.trim());
    if (!hasMsgs && !hasMems && !hasPrompt) {
      showToast('💡 当前对话还没有消息或记忆条目，先聊两句或写入专属设定再来导出吧');
      return;
    }
    const card = document.getElementById('ds-share-preview-card');
    const isNative = state.activeSession?.session_mode === 'deepseek_native';
    const brandName = isNative ? 'deepseek' : state.activePersona?.name || '星语恋庭';
    const brandIcon = isNative
      ? DS_WHALE_AVATAR_SVG
      : `<span style="font-size:18px">${escapeHtml(state.activePersona?.avatar || '🌸')}</span>`;
    const title = state.activeSession?.title || '对话与记忆精选';
    const recentTurns = (state.messages || []).slice(-8);
    const memSummaryHtml = hasMems
      ? `<div class="ds-share-thought-note">🧠 本对话独立记忆（共 ${state.memories.length} 条）：${escapeHtml(
          state.memories
            .slice(0, 2)
            .map((x) => x.content)
            .join(' ｜ ')
            .slice(0, 110)
        )}${state.memories.length > 2 ? '…' : ''}</div>`
      : '';
    if (card) {
      card.innerHTML = `
        <div class="ds-share-head">
          <span class="ds-share-brand">${brandIcon}<span>${escapeHtml(brandName)} · ${escapeHtml(title)}</span></span>
          <span class="muted-count">${new Date().toLocaleDateString('zh-CN')} · 记忆 ${
            (state.memories || []).length
          } 条 · 消息 ${(state.messages || []).length} 条</span>
        </div>
        ${memSummaryHtml}
        ${
          recentTurns.length > 0
            ? recentTurns
                .map((m) =>
                  m.role === 'user'
                    ? `<div class="ds-share-turn"><div class="ds-share-user-q">${escapeHtml(m.content)}</div></div>`
                    : `<div class="ds-share-turn">
                         ${
                           m.reasoning
                             ? `<div class="ds-share-thought-note">💭 思考与心声：${escapeHtml(
                                 m.reasoning.replace(/\s+/g, ' ').slice(0, 95)
                               )}…</div>`
                             : ''
                         }
                         <div class="ds-share-ai-a">${escapeHtml(m.content.slice(0, 480))}${
                        m.content.length > 480 ? '…' : ''
                      }</div>
                       </div>`
                )
                .join('')
            : '<div class="ds-share-thought-note">当前仅包含独立设定与记忆条目，点击下方按钮可直接下载 .md 记忆档案。</div>'
        }
      `;
    }
    dsShareDialog.showModal();
  }

  document.getElementById('ds-share-session-btn')?.addEventListener('click', openDsShareModal);
  document.getElementById('ds-menu-share-btn')?.addEventListener('click', () => {
    hidePopoverSafe('ds-user-popover');
    openDsShareModal();
  });
  document.getElementById('close-ds-share-dialog')?.addEventListener('click', () => dsShareDialog?.close());

  document.getElementById('ds-copy-markdown-btn')?.addEventListener('click', async () => {
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
    showToast('📋 已复制完整对话与独立记忆 Markdown（可直接粘贴导入到其他地方）');
  });

  document.getElementById('ds-export-md-file-btn')?.addEventListener('click', () => {
    exportSessionMarkdownById(state.activeSessionId);
  });

  document.getElementById('ds-export-json-file-btn')?.addEventListener('click', () => {
    exportSessionJsonById(state.activeSessionId);
  });

  document.getElementById('ds-download-share-png-btn')?.addEventListener('click', () => {
    const turns = state.messages.slice(-6);
    if (turns.length === 0) return;
    const dpr = 2;
    const width = 680;
    const tmp = document.createElement('canvas');
    const tCtx = tmp.getContext('2d');
    const blocks = [];
    let totalH = 130;

    for (const m of turns) {
      if (m.role === 'user') {
        tCtx.font = 'bold 16px "Microsoft YaHei", sans-serif';
        const qLines = wrapCanvasLines(tCtx, `🙋 提问：${m.content}`, width - 110).slice(0, 8);
        blocks.push({ type: 'user', lines: qLines });
        totalH += qLines.length * 26 + 28;
      } else {
        if (m.reasoning) {
          tCtx.font = '13px "Microsoft YaHei", sans-serif';
          const rLines = wrapCanvasLines(
            tCtx,
            `⚛️ 深度思考：${m.reasoning.replace(/\s+/g, ' ').slice(0, 140)}${m.reasoning.length > 140 ? '…' : ''}`,
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

    ctx.font = 'bold 22px "Microsoft YaHei", sans-serif';
    ctx.fillStyle = '#4d6bfe';
    ctx.fillText('🐋 deepseek', 42, 56);
    ctx.font = 'bold 16px "Microsoft YaHei", sans-serif';
    ctx.fillStyle = '#1f2329';
    ctx.fillText(` · ${(state.activeSession?.title || '智能对话精选').slice(0, 22)}`, 176, 56);
    ctx.strokeStyle = '#f1f3f5';
    ctx.beginPath();
    ctx.moveTo(42, 76);
    ctx.lineTo(width - 42, 76);
    ctx.stroke();

    let y = 108;
    for (const b of blocks) {
      if (b.type === 'user') {
        const boxH = b.lines.length * 26 + 16;
        ctx.fillStyle = '#eff6ff';
        ctx.fillRect(42, y - 18, width - 84, boxH);
        ctx.font = 'bold 15px "Microsoft YaHei", sans-serif';
        ctx.fillStyle = '#1e3a8a';
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
        ctx.fillStyle = '#4d6bfe';
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
    ctx.fillText(`生成于 DeepSeek 原生工作台 · ${new Date().toLocaleString('zh-CN')}`, 42, totalH - 28);

    const link = document.createElement('a');
    link.download = `${(state.activeSession?.title || 'DeepSeek对话').slice(0, 18)}_分享长图.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
    showToast('🖼️ 高清对话分享长图已生成并保存！');
  });

  // 全局生产力快捷键（Ctrl/Cmd + K 搜索历史对话，Alt + N 开启新对话）
  document.addEventListener('keydown', (e) => {
    if (state.uiMode !== 'deepseek' || !state.user) return;
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
      appShell.classList.add('right-collapsed');
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
    fimDialog.showModal();
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
      showToast('💬 已带入你输入框里写了一半的草稿，点右下角即可帮你接上！');
    } else if (state.messages.length > 0) {
      const lastMsg = state.messages[state.messages.length - 1];
      const snippet = String(lastMsg.content || '')
        .replace(/^>.*$/gm, '')
        .trim()
        .slice(-140);
      fimPromptInput.value = snippet || `看着眼前的${cleanActor}，我一时不知道该怎么开口接话。`;
      fimSuffixInput.value = `我深吸了一口气，终于抬起眼眸认真地回应了${cleanActor}的心意。`;
      showToast('💬 已自动带入当前聊天的最新进展，可直接生成过渡回复！');
    } else {
      const intro = state.activePersona?.tagline || '微风吹过安静的街角，我们的目光刚好撞在一起。';
      fimPromptInput.value = intro;
      fimSuffixInput.value = `${cleanActor}率先打破了沉默，朝我露出了温柔的浅笑。`;
      showToast('🌸 已结合当前角色设定生成开头与结尾，点右下角试试吧！');
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

  // 左右文本框便捷清空按钮
  document.querySelectorAll('.fim-clear-mini').forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetEl = document.getElementById(btn.dataset.clearTarget);
      if (targetEl) {
        targetEl.value = '';
        targetEl.focus();
      }
    });
  });

  async function executeFimCompletion(isRerun = false) {
    const runBtn = document.getElementById('run-fim-btn');
    const rerunBtn = document.getElementById('rerun-fim-btn');
    if (isRerun) {
      fimVariantCounter += 1;
    }
    runBtn.disabled = true;
    if (rerunBtn) rerunBtn.disabled = true;
    runBtn.textContent = '⏳ 正在为你构思过渡情节…';

    try {
      const res = await apiJson('/api/deepseek/fim', {
        method: 'POST',
        body: JSON.stringify({
          prompt: fimPromptInput.value,
          suffix: fimSuffixInput.value,
          tone: currentFimTone,
          persona_name: state.activePersona?.name || '',
          variant: fimVariantCounter,
          max_tokens: 512
        })
      });
      latestFimMerged = res.merged || '';
      fimResultPre.innerHTML = `${escapeHtml(fimPromptInput.value)}<mark class="fim-mid-highlight">${escapeHtml(
        res.completion
      )}</mark>${escapeHtml(fimSuffixInput.value)}`;
      fimOutputWrap.classList.remove('hidden');
      const toneLabel = FIM_TONE_LABELS[currentFimTone] || '细腻温柔';
      document.getElementById('fim-usage-hint').textContent = `✨ 已按「${toneLabel}」感觉补齐 ${
        (res.completion || '').trim().length
      } 字 · 点上方「一键填入聊天框」即可直接使用`;
    } catch (err) {
      showToast(`🌸 ${err.message}`);
    } finally {
      runBtn.disabled = false;
      if (rerunBtn) rerunBtn.disabled = false;
      runBtn.textContent = '✨ 帮我补齐中间剧情';
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
    showToast('✅ 已复制整段内容，随时可粘贴使用');
  });

  document.getElementById('send-fim-to-chat-btn')?.addEventListener('click', () => {
    if (!latestFimMerged) return;
    chatInput.value = latestFimMerged;
    syncComposerEmptyState();
    fimDialog.close();
    chatInput.focus();
    showToast('💬 已填入下方聊天框，可直接发送或按喜好微调哦！');
  });

  // 🌟 多一点主动性核心引擎：仅在恋庭沉浸扮演模式下发起主动关怀（DeepSeek 原生模式保持纯粹上下文零干扰）
  async function triggerProactiveMessage(triggerReason = 'manual') {
    if (state.isStreaming || !state.activeSessionId) return;
    if (state.uiMode === 'deepseek' || state.activeSession?.session_mode === 'deepseek_native') return;
    const isDsUi = false;
    const isPure = !state.activePersona || state.activePersona.id === 'persona_deepseek_official';

    // 退出空对话居中态以便流式展示主动消息
    document.querySelector('.chat-stage')?.classList.remove('ds-empty-mode');
    const welcomeHero = messagesContainer.querySelector('.ds-welcome-hero');
    if (welcomeHero) welcomeHero.remove();

    const liveRow = document.createElement('div');
    liveRow.className = 'msg-row assistant';

    const avatarEl = document.createElement('div');
    avatarEl.className = 'msg-avatar';
    populateAssistantAvatar(avatarEl, isDsUi);

    const bodyEl = document.createElement('div');
    bodyEl.className = 'msg-body';

    const proBadge = document.createElement('div');
    proBadge.className = 'proactive-msg-badge';
    proBadge.textContent = isDsUi
      ? '延伸思考 · 主动跟进'
      : `💌 ${state.activePersona?.name?.split(/[·\s]/)[0] || '他'}正在主动向你搭话…`;
    bodyEl.appendChild(proBadge);

    const thoughtDetails = document.createElement('details');
    thoughtDetails.className = 'thought-details hidden';
    thoughtDetails.open = true;
    thoughtDetails.innerHTML = `
      <summary class="thought-summary">
        ${isDsUi ? DS_THINK_ATOM_SVG : ''}
        <span class="live-thought-label">${isDsUi ? '思考中...' : '💭 主动搭话前的潜台词…'}</span>
        <span class="thought-chevron">▼</span>
      </summary>
      <div class="thought-content streaming-cursor"></div>
    `;

    const proseEl = document.createElement('div');
    proseEl.className = 'assistant-prose streaming-cursor';
    proseEl.innerHTML = '<p>…</p>';

    bodyEl.appendChild(thoughtDetails);
    bodyEl.appendChild(proseEl);
    liveRow.appendChild(avatarEl);
    liveRow.appendChild(bodyEl);
    messagesContainer.appendChild(liveRow);
    scrollToBottom(true);

    const thoughtContentEl = thoughtDetails.querySelector('.thought-content');
    const abortController = new AbortController();
    state.streamingAbort = abortController;
    setStreamingUi(true);

    let accReasoning = '';
    let accContent = '';

    try {
      const response = await fetch('/api/chat/proactive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: state.activeSessionId,
          trigger_reason: triggerReason
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

        if (eventName === 'reasoning') {
          accReasoning += payload.delta || '';
          thoughtDetails.classList.remove('hidden');
          if (isDsUi) {
            thoughtContentEl.innerHTML = formatDsReasoningHtml(accReasoning);
          } else {
            thoughtContentEl.textContent = accReasoning;
          }
          scrollToBottom();
        } else if (eventName === 'content') {
          thoughtContentEl.classList.remove('streaming-cursor');
          accContent += payload.delta || '';
          proseEl.innerHTML = renderMessageMarkdown(accContent);
          scrollToBottom();
        } else if (eventName === 'done') {
          receivedDoneEvent = true;
          state.messages.push({
            id: payload.message_id,
            role: 'assistant',
            reasoning: accReasoning,
            content: accContent,
            duration_ms: payload.duration_ms,
            recalled_count: payload.recalled_count,
            meta: payload.meta || { is_proactive: true }
          });
          if (Array.isArray(payload.sessions)) state.sessions = payload.sessions;
          setStreamingUi(false);
          renderSessionList();
          renderMessages();
          if (triggerReason === 'idle') {
            showToast('💌 看你安静了一会儿，TA 主动给你发来了一条新消息');
          } else if (triggerReason === 'return') {
            showToast('💌 欢迎回来！TA 一看到你就主动迎上来打招呼啦');
          }
        }
      };

      for await (const chunk of response.body) {
        buffer += decoder.decode(chunk, { stream: true });
        const events = buffer.split(/\r?\n\r?\n/);
        buffer = events.pop() || '';
        for (const rawBlock of events) {
          handleSseBlock(rawBlock);
        }
      }
      buffer += decoder.decode();
      if (buffer.trim() && !receivedDoneEvent) {
        handleSseBlock(buffer);
      }
    } catch {
      liveRow.remove();
    } finally {
      state.streamingAbort = null;
      setStreamingUi(false);
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

  document.getElementById('toggle-proactive-btn').addEventListener('click', () => {
    const next = state.activeSession?.proactive_enabled === 0;
    patchActiveSessionFlag(
      { proactive_enabled: next },
      next
        ? '💓 已开启静默主动关怀（停留片刻或重返时 TA 会主动开口）'
        : '💤 已暂停自动主动搭话（仍可随时点「👋 让 TA 主动开口」）'
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
    dsSearchInput.addEventListener('input', () => renderSessionList());
  }

  function hidePopoverSafe(id) {
    const el = document.getElementById(id);
    if (el && typeof el.hidePopover === 'function') {
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

  // 静默陪伴自动搭话心跳检查（仅在恋庭沉浸扮演模式下生效，DeepSeek 原生模式严格保持零插话与角色交替稳定）
  setInterval(() => {
    if (
      !state.user ||
      !state.activeSessionId ||
      state.uiMode === 'deepseek' ||
      state.activeSession?.session_mode === 'deepseek_native' ||
      state.isStreaming ||
      state.tourActive ||
      state.activeSession?.proactive_enabled === 0 ||
      state.proactiveIdleCount >= 1 ||
      chatInput.value.trim().length > 0
    ) {
      return;
    }
    const idleSec = (Date.now() - state.lastInteractionAt) / 1000;
    const thresholdSec = Math.max(35, parseInt(state.settings.proactive_idle_sec || '55', 10));
    if (idleSec >= thresholdSec) {
      state.proactiveIdleCount += 1;
      triggerProactiveMessage('idle');
    }
  }, 10000);

  // ================= 14. 进入工作台与首次登录检测 =================
  async function enterWorkspace() {
    authGate.classList.add('hidden');
    appShell.classList.remove('hidden');

    const boot = await apiJson('/api/bootstrap');
    state.user = boot.user;
    if (boot.user?.id) {
      window.__starAuthStore?.setActiveUserId(boot.user.id);
    }
    state.scripts = boot.scripts || [];
    state.squareItems = boot.square_items || [];
    state.personas = boot.personas || [];
    state.sessions = boot.sessions || [];
    state.settings = boot.settings || {};
    state.membership = boot.membership || state.membership;
    state.wallet = boot.wallet || null;

    if (state.scripts.length > 0 && !state.scripts.some((s) => s.id === state.activeScriptId)) {
      state.activeScriptId = state.scripts[0].id;
    }

    applyUiModeVisuals(state.uiMode);
    syncActiveScriptVisuals();
    renderUserAndMembership();
    if (state.wallet) renderWalletOverview();
    renderPersonaList();
    renderSessionList();

    const isDs = state.uiMode === 'deepseek';
    const preferredSessions = state.sessions.filter((s) =>
      isDs ? s.session_mode === 'deepseek_native' : s.session_mode !== 'deepseek_native'
    );

    if (isDs) {
      const reusableBlank = preferredSessions.find((s) => s.title === '新对话');
      if (reusableBlank) {
        await loadSession(reusableBlank.id);
      } else {
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
      } else {
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

    const urlParams = new URLSearchParams(window.location.search);
    const isLiveDemoEntry =
      urlParams.get('demo') === '1' ||
      urlParams.get('demo') === 'true' ||
      window.location.hash === '#demo' ||
      Boolean(window.__isStaticLiveDemo);

    if (isLiveDemoEntry) {
      if (!sessionStorage.getItem('star_demo_welcomed')) {
        sessionStorage.setItem('star_demo_welcomed', '1');
        showToast('🌐 在线展示 Demo 已就绪 · 免注册畅玩四大剧本，亦可在设置中绑定自有 DeepSeek Key');
      }
    } else if (state.user && !state.user.onboarding_done && state.uiMode === 'roleplay') {
      setTimeout(() => {
        startOnboardingTour();
      }, 450);
    }
  }

  async function bootCheck() {
    const urlParams = new URLSearchParams(window.location.search);
    const wantQuickDemo =
      urlParams.get('demo') === '1' ||
      urlParams.get('demo') === 'true' ||
      window.location.hash === '#demo';

    try {
      const me = await apiJson('/api/auth/me');
      if (me.authenticated && me.user) {
        applyAuthLoginPayload(me, { persistDefault: false, rememberGuest: false });
        await enterWorkspace();
        return;
      }
      if (wantQuickDemo) {
        const savedGuestId = window.__starAuthStore?.getGuestUserId() || '';
        const demoRes = await apiJson('/api/auth/demo-login', {
          method: 'POST',
          body: JSON.stringify({ guest_user_id: savedGuestId })
        });
        applyAuthLoginPayload(demoRes, { persistDefault: true, rememberGuest: true });
        await enterWorkspace();
        return;
      }
      resetClientWorkspaceState();
      showAuthScreen();
    } catch {
      resetClientWorkspaceState();
      showAuthScreen();
    }
  }

  // 点击顶栏更多面板或灵感面板内的动作按钮后，自动轻柔收起 Popover
  ['topbar-more-popover', 'magic-quick-popover'].forEach((popId) => {
    const popEl = document.getElementById(popId);
    if (!popEl) return;
    popEl.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn || btn.id === 'toggle-proactive-btn') return;
      if (typeof popEl.hidePopover === 'function') {
        try {
          popEl.hidePopover();
        } catch {}
      }
    });
  });

  bootCheck();
})();

/**
 * @license MIT
 * Open-Source Plugin: DeepSeek API Billing, Token & Balance Monitor (v2.0.0)
 * 实时监测 DeepSeek / 云端兼容 API 每一轮对话与手机辅助消耗的 Token、估算费用（¥）、缓存命中省费与账户实时余额。
 */
(() => {
  const PLUGIN_STYLE_ID = 'oss-ds-monitor-plugin-style';
  const POPOVER_ID = 'oss-ds-monitor-popover';
  const TRIGGER_BTN_ID = 'oss-ds-monitor-trigger-btn';
  const RECORDS_STORAGE_KEY = 'ds_billing_records_v1';
  const PUBLIC_WEB_ORIGIN = 'https://star.claudexxb.online';

  const monitorState = {
    enabled: false,
    popoverOpen: false,
    loadingBalance: false,
    providerLabel: 'DeepSeek 官方 API',
    isOfficialDeepSeek: true,
    balanceSupported: false,
    isAvailable: true,
    symbol: '¥',
    totalBalance: null,
    toppedUpBalance: '0.00',
    grantedBalance: '0.00',
    model: 'deepseek-v4.1-flash',
    lastBalanceFetchAt: 0,
    sessionHitTokens: 0,
    sessionMissTokens: 0,
    sessionCompletionTokens: 0,
    lastTurnHitRate: null,
    lastTurnUsage: null,
    records: [],
    phoneAgentAuth: { apiKey: '', baseUrl: '', execMode: '' },
    errorMsg: ''
  };

  function loadStoredRecords() {
    try {
      const raw = localStorage.getItem(RECORDS_STORAGE_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr.slice(0, 30) : [];
    } catch {
      return [];
    }
  }

  function saveStoredRecords(records) {
    try {
      localStorage.setItem(RECORDS_STORAGE_KEY, JSON.stringify((records || []).slice(0, 30)));
    } catch {}
  }

  monitorState.records = loadStoredRecords();

  /**
   * 按 DeepSeek 官方阶梯单价估算每轮人民币费用（¥）
   * - reasoner / r1：缓存命中 ¥1.00/1M，未命中 ¥4.00/1M，输出 ¥16.00/1M
   * - V4.1 Flash / chat / 默认：缓存命中 ¥0.20/1M，未命中 ¥2.00/1M，输出 ¥3.00/1M
   */
  function estimateTurnCostCny(usage = {}, model = '') {
    const u = usage || {};
    const promptTokens = Math.max(0, Number(u.prompt_tokens) || 0);
    const hitTokens = Math.max(0, Number(u.prompt_cache_hit_tokens) || 0);
    const missTokens = u.prompt_cache_miss_tokens !== undefined
      ? Math.max(0, Number(u.prompt_cache_miss_tokens) || 0)
      : Math.max(0, promptTokens - hitTokens);
    const completionTokens = Math.max(0, Number(u.completion_tokens) || 0);
    const totalTokens = Math.max(Number(u.total_tokens) || 0, hitTokens + missTokens + completionTokens);

    const isReasoner = /reasoner|r1/i.test(String(model || ''));
    const hitRatePer1M = isReasoner ? 1.0 : 0.2;
    const missRatePer1M = isReasoner ? 4.0 : 2.0;
    const outRatePer1M = isReasoner ? 16.0 : 3.0;

    const costCny =
      (hitTokens / 1e6) * hitRatePer1M +
      (missTokens / 1e6) * missRatePer1M +
      (completionTokens / 1e6) * outRatePer1M;
    const savedCny = (hitTokens / 1e6) * (missRatePer1M - hitRatePer1M);

    return {
      promptTokens: hitTokens + missTokens,
      hitTokens,
      missTokens,
      completionTokens,
      totalTokens,
      costCny: Number(costCny.toFixed(6)),
      savedCny: Number(savedCny.toFixed(6))
    };
  }

  function formatCny(val, digits = 4) {
    const n = Number(val) || 0;
    if (n > 0 && n < 0.0001) return '<¥0.0001';
    return `¥${n.toFixed(digits)}`;
  }

  function formatCompactInt(n) {
    const num = Number(n) || 0;
    if (num >= 10000) return `${(num / 1000).toFixed(1)}k`;
    return String(num);
  }

  function injectPluginStyles() {
    if (typeof document === 'undefined' || !document.head) return;
    if (document.getElementById(PLUGIN_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = PLUGIN_STYLE_ID;
    style.textContent = `
      .oss-ds-composer-bar {
        width: min(760px, 100%);
        margin: 0 auto 6px;
        display: flex;
        align-items: center;
        justify-content: flex-end;
        padding: 0 4px;
      }
      .oss-ds-composer-bar.hidden {
        display: none !important;
      }
      .oss-ds-monitor-pill {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        height: 24px;
        padding: 0 9px;
        border-radius: 999px;
        border: 1px solid light-dark(rgba(77, 107, 254, 0.2), rgba(147, 197, 253, 0.22));
        background: light-dark(rgba(248, 250, 252, 0.86), rgba(30, 41, 59, 0.72));
        color: light-dark(#475569, #cbd5e1);
        font: inherit;
        font-size: 11.5px;
        font-weight: 500;
        line-height: 1;
        cursor: pointer;
        white-space: nowrap;
        flex-shrink: 0;
        backdrop-filter: blur(8px);
        transition: border-color 0.14s ease, color 0.14s ease, background-color 0.14s ease;
      }
      .oss-ds-monitor-pill:hover {
        border-color: #4d6bfe;
        color: light-dark(#1e3a8a, #f8fafc);
        background: light-dark(rgba(239, 246, 255, 0.96), rgba(30, 41, 59, 0.92));
      }
      .oss-ds-monitor-pill.hidden {
        display: none !important;
      }
      .oss-ds-monitor-pill .oss-sep {
        opacity: 0.35;
      }
      .oss-ds-monitor-pill .oss-cache-tag {
        color: light-dark(#2563eb, #93c5fd);
        font-weight: 600;
      }
      .oss-ds-monitor-pill .oss-pill-caret {
        opacity: 0.55;
        font-size: 12px;
      }
      .oss-ds-monitor-pill.low-balance {
        border-color: rgba(239, 68, 68, 0.48);
        color: light-dark(#b91c1c, #fca5a5);
      }

      .oss-ds-monitor-popover {
        position: fixed;
        bottom: 130px;
        right: 16px;
        margin: 0;
        width: min(352px, calc(100vw - 24px));
        max-height: min(460px, calc(100dvh - 140px));
        overflow-y: auto;
        padding: 14px;
        border-radius: 16px;
        border: 1px solid light-dark(rgba(15, 23, 42, 0.1), rgba(255, 255, 255, 0.14));
        background: light-dark(#ffffff, #171b28);
        color: var(--text-primary, #1f2329);
        box-shadow: 0 18px 44px rgba(15, 23, 42, 0.22);
        z-index: 1280;
        display: none;
        flex-direction: column;
        gap: 10px;
      }
      .oss-ds-monitor-popover.is-open {
        display: flex;
      }

      .oss-mon-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }
      .oss-mon-title {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 13.5px;
        font-weight: 800;
      }
      .oss-mon-refresh-btn {
        padding: 3px 9px;
        border-radius: 8px;
        border: 1px solid var(--border-subtle, rgba(148, 163, 184, 0.3));
        background: transparent;
        color: var(--text-secondary, #64748b);
        font: inherit;
        font-size: 11.5px;
        cursor: pointer;
      }
      .oss-mon-refresh-btn:hover {
        color: #4d6bfe;
        border-color: #4d6bfe;
      }

      .oss-mon-card {
        padding: 10px 12px;
        border-radius: 12px;
        background: light-dark(#f8fafc, rgba(255, 255, 255, 0.04));
        border: 1px solid light-dark(rgba(15, 23, 42, 0.06), rgba(255, 255, 255, 0.08));
        display: flex;
        flex-direction: column;
        gap: 7px;
      }
      .oss-mon-bal-row {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 8px;
      }
      .oss-mon-bal-num {
        font-size: 21px;
        font-weight: 800;
        letter-spacing: -0.02em;
        color: light-dark(#0f172a, #f8fafc);
      }
      .oss-mon-status-dot {
        font-size: 11.5px;
        font-weight: 700;
        color: light-dark(#059669, #34d399);
      }
      .oss-mon-status-dot.warn {
        color: #ef4444;
      }
      .oss-mon-sub-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 6px;
        font-size: 11.5px;
        color: var(--text-secondary, #64748b);
      }
      .oss-mon-sub-grid b {
        color: var(--text-primary, #1f2329);
      }

      .oss-mon-bar-track {
        height: 7px;
        border-radius: 999px;
        background: light-dark(#e2e8f0, #334155);
        overflow: hidden;
        display: flex;
      }
      .oss-mon-bar-hit {
        height: 100%;
        background: linear-gradient(90deg, #10b981, #34d399);
        transition: width 0.28s ease;
      }
      .oss-mon-metrics-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 6px;
      }
      .oss-mon-metric-item {
        padding: 6px 8px;
        border-radius: 8px;
        background: light-dark(#ffffff, rgba(15, 23, 42, 0.45));
        border: 1px solid light-dark(rgba(15, 23, 42, 0.05), rgba(255, 255, 255, 0.06));
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .oss-mon-metric-item span {
        font-size: 11px;
        color: var(--text-secondary, #64748b);
      }
      .oss-mon-metric-item strong {
        font-size: 12.5px;
        font-weight: 700;
      }

      .oss-mon-records-list {
        max-height: 150px;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 5px;
      }
      .oss-mon-rec-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 6px;
        padding: 5px 8px;
        border-radius: 8px;
        background: light-dark(#ffffff, rgba(255, 255, 255, 0.03));
        font-size: 11px;
        color: var(--text-secondary, #64748b);
      }
      .oss-mon-rec-row strong {
        color: light-dark(#1e3a8a, #93c5fd);
        font-weight: 700;
      }

      .oss-mon-foot {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding-top: 2px;
        font-size: 11px;
        color: var(--text-muted, #94a3b8);
      }
      .oss-mon-link-btn {
        border: none;
        background: transparent;
        color: #4d6bfe;
        font: inherit;
        font-size: 11.5px;
        font-weight: 600;
        cursor: pointer;
        padding: 2px 4px;
      }
      .oss-mon-link-btn:hover {
        text-decoration: underline;
      }
    `;
    document.head.appendChild(style);
  }

  function closePopover() {
    monitorState.popoverOpen = false;
    const pop = document.getElementById(POPOVER_ID);
    if (pop) pop.classList.remove('is-open');
  }

  function positionPopoverNearTrigger(btn, pop) {
    if (!btn || !pop || typeof btn.getBoundingClientRect !== 'function') return;
    const rect = btn.getBoundingClientRect();
    if (!rect.width && !rect.height) return;
    const vh = window.innerHeight || 800;
    const vw = window.innerWidth || 1200;
    const bottom = Math.max(72, vh - rect.top + 8);
    const right = Math.max(12, vw - rect.right);
    pop.style.top = 'auto';
    pop.style.bottom = `${bottom}px`;
    pop.style.right = `${right}px`;
  }

  function openPopover() {
    const nodes = ensureDomMounted();
    if (!nodes) return;
    monitorState.popoverOpen = true;
    positionPopoverNearTrigger(nodes.btn, nodes.pop);
    nodes.pop.classList.add('is-open');
    renderMonitorUi();
  }

  function ensureDomMounted() {
    if (typeof document === 'undefined' || !document.body) return null;
    injectPluginStyles();
    const chatForm = document.getElementById('chat-form');
    const composerDock = document.getElementById('tour-anchor-composer');
    const hostParent = chatForm?.parentNode || composerDock;
    if (!hostParent) return null;

    let bar = document.getElementById('oss-ds-composer-bar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'oss-ds-composer-bar';
      bar.className = 'oss-ds-composer-bar hidden';
      if (chatForm && chatForm.parentNode === hostParent && typeof hostParent.insertBefore === 'function') {
        hostParent.insertBefore(bar, chatForm);
      } else {
        hostParent.appendChild(bar);
      }
    }

    let btn = document.getElementById(TRIGGER_BTN_ID);
    if (!btn) {
      btn = document.createElement('button');
      btn.id = TRIGGER_BTN_ID;
      btn.type = 'button';
      btn.className = 'oss-ds-monitor-pill hidden';
      btn.title = '查看 DeepSeek 实时消耗 Token、估算费用与剩余额度';
      bar.appendChild(btn);
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (monitorState.popoverOpen) closePopover();
        else openPopover();
      });
    }

    let pop = document.getElementById(POPOVER_ID);
    if (!pop) {
      pop = document.createElement('div');
      pop.id = POPOVER_ID;
      pop.className = 'oss-ds-monitor-popover';
      pop.setAttribute('role', 'dialog');
      pop.setAttribute('aria-label', 'DeepSeek 实时计费与余额监测');
      pop.innerHTML = `
        <div class="oss-mon-head">
          <div class="oss-mon-title" id="oss-mon-provider-title">DeepSeek 实时计费监控</div>
          <div style="display:flex;gap:6px;align-items:center;">
            <button type="button" class="oss-mon-refresh-btn" id="oss-mon-refresh-btn">刷新余额</button>
            <button type="button" class="oss-mon-refresh-btn" id="oss-mon-close-btn">✕</button>
          </div>
        </div>
        <div class="oss-mon-card">
          <div class="oss-mon-bal-row">
            <span class="oss-mon-bal-num" id="oss-mon-bal-num">--</span>
            <span class="oss-mon-status-dot" id="oss-mon-bal-status">计费就绪</span>
          </div>
          <div class="oss-mon-sub-grid" id="oss-mon-bal-sub"></div>
        </div>
        <div class="oss-mon-card">
          <div class="oss-mon-bal-row">
            <span style="font-size:12px;font-weight:700;">本轮最新消耗</span>
            <span style="font-size:11.5px;color:#4d6bfe;font-weight:700;" id="oss-mon-last-model">deepseek-v4.1-flash</span>
          </div>
          <div class="oss-mon-metrics-grid">
            <div class="oss-mon-metric-item"><span>本轮 Token</span><strong id="oss-mon-last-tokens">0</strong></div>
            <div class="oss-mon-metric-item"><span>本轮估算费用</span><strong id="oss-mon-last-cost">¥0.0000</strong></div>
          </div>
        </div>
        <div class="oss-mon-card">
          <div class="oss-mon-bal-row">
            <span style="font-size:12px;font-weight:700;">累计统计与缓存省费</span>
            <span style="font-size:11.5px;font-weight:700;color:#10b981;" id="oss-mon-hit-rate-label">等待首轮</span>
          </div>
          <div class="oss-mon-bar-track"><div class="oss-mon-bar-hit" id="oss-mon-bar-hit" style="width:0%"></div></div>
          <div class="oss-mon-metrics-grid">
            <div class="oss-mon-metric-item"><span>累计总 Token</span><strong id="oss-mon-total-tokens">0</strong></div>
            <div class="oss-mon-metric-item"><span>累计总费用</span><strong id="oss-mon-total-cost">¥0.0000</strong></div>
            <div class="oss-mon-metric-item"><span>缓存命中 / 未命中</span><strong id="oss-mon-hit-miss">0 / 0</strong></div>
            <div class="oss-mon-metric-item"><span>缓存已省费用</span><strong id="oss-mon-saved-cny">¥0.0000</strong></div>
          </div>
        </div>
        <div class="oss-mon-card">
          <div class="oss-mon-bal-row">
            <span style="font-size:12px;font-weight:700;">最近每轮消耗明细</span>
            <button type="button" class="oss-mon-link-btn" id="oss-mon-clear-btn">清零统计</button>
          </div>
          <div class="oss-mon-records-list" id="oss-mon-records-list"></div>
        </div>
        <div class="oss-mon-foot">
          <span>按 DeepSeek 官方阶梯单价实时估算</span>
          <span>v2.0.0</span>
        </div>
      `;
      document.body.appendChild(pop);
      pop.addEventListener('click', (e) => e.stopPropagation());
      pop.querySelector('#oss-mon-refresh-btn')?.addEventListener('click', () => refreshBalance(true));
      pop.querySelector('#oss-mon-close-btn')?.addEventListener('click', closePopover);
      pop.querySelector('#oss-mon-clear-btn')?.addEventListener('click', () => {
        clearBillingRecords();
      });

      document.addEventListener('click', () => {
        if (monitorState.popoverOpen) closePopover();
      });
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && monitorState.popoverOpen) closePopover();
      });
    }

    return { bar, btn, pop };
  }

  function parseMessageUsage(msg) {
    if (!msg || msg.role !== 'assistant') return null;
    if (msg.meta && typeof msg.meta === 'object' && msg.meta.usage) return msg.meta.usage;
    if (msg._parsedMeta && msg._parsedMeta.usage) return msg._parsedMeta.usage;
    if (typeof msg.meta_json === 'string' && msg.meta_json) {
      try {
        const parsed = JSON.parse(msg.meta_json);
        return parsed?.usage || null;
      } catch {}
    }
    return null;
  }

  function recomputeCacheMetrics(messages = []) {
    let hit = 0;
    let miss = 0;
    let comp = 0;
    let lastRate = null;

    for (const m of messages) {
      const u = parseMessageUsage(m);
      if (!u) continue;
      const h = Number(u.prompt_cache_hit_tokens) || 0;
      const ms =
        u.prompt_cache_miss_tokens !== undefined
          ? Number(u.prompt_cache_miss_tokens) || 0
          : Math.max(0, (Number(u.prompt_tokens) || 0) - h);
      const c = Number(u.completion_tokens) || 0;
      hit += h;
      miss += ms;
      comp += c;
      if (h + ms > 0) {
        lastRate = Math.round((h / (h + ms)) * 100);
      }
    }

    monitorState.sessionHitTokens = hit;
    monitorState.sessionMissTokens = miss;
    monitorState.sessionCompletionTokens = comp;
    monitorState.lastTurnHitRate = lastRate;
  }

  function aggregateRecords() {
    let totalTokens = 0;
    let totalCost = 0;
    let totalSaved = 0;
    let hit = 0;
    let miss = 0;
    for (const r of monitorState.records) {
      totalTokens += Number(r.totalTokens) || 0;
      totalCost += Number(r.costCny) || 0;
      totalSaved += Number(r.savedCny) || 0;
      hit += Number(r.hitTokens) || 0;
      miss += Number(r.missTokens) || 0;
    }
    if (monitorState.records.length === 0) {
      totalTokens = monitorState.sessionHitTokens + monitorState.sessionMissTokens + monitorState.sessionCompletionTokens;
      hit = monitorState.sessionHitTokens;
      miss = monitorState.sessionMissTokens;
    }
    return { totalTokens, totalCost, totalSaved, hit, miss };
  }

  function renderMonitorUi() {
    const nodes = ensureDomMounted();
    if (!nodes) return;
    const { bar, btn, pop } = nodes;

    if (!monitorState.enabled) {
      if (bar) bar.classList.add('hidden');
      btn.classList.add('hidden');
      closePopover();
      return;
    }

    if (bar) bar.classList.remove('hidden');
    btn.classList.remove('hidden');

    const agg = aggregateRecords();
    const lastRec = monitorState.records[0] || monitorState.lastTurnUsage || null;
    const totalPrompt = agg.hit + agg.miss;
    const hitRate = totalPrompt > 0 ? Math.round((agg.hit / totalPrompt) * 100) : null;

    const tokNum = lastRec ? lastRec.totalTokens : agg.totalTokens;
    const tokPart = `<span class="oss-cache-tag">${formatCompactInt(tokNum)} tok</span>`;
    const quotaPart = monitorState.loadingBalance && monitorState.totalBalance === null
      ? '查额度…'
      : (monitorState.balanceSupported && monitorState.totalBalance !== null)
      ? `余 ${monitorState.symbol}${monitorState.totalBalance}`
      : formatCny(lastRec ? lastRec.costCny : agg.totalCost, 4);

    const isLow =
      monitorState.balanceSupported &&
      monitorState.totalBalance !== null &&
      Number(monitorState.totalBalance) <= 1.0;
    btn.classList.toggle('low-balance', isLow);
    btn.innerHTML = `${tokPart}<span class="oss-sep">·</span><span>${quotaPart}</span><span class="oss-pill-caret">›</span>`;

    const titleEl = pop.querySelector('#oss-mon-provider-title');
    if (titleEl) {
      titleEl.textContent = `${monitorState.providerLabel || 'DeepSeek API'} · 实时计费`;
    }

    const balNumEl = pop.querySelector('#oss-mon-bal-num');
    const balStatusEl = pop.querySelector('#oss-mon-bal-status');
    const balSubEl = pop.querySelector('#oss-mon-bal-sub');
    if (monitorState.balanceSupported && monitorState.totalBalance !== null) {
      if (balNumEl) balNumEl.textContent = `${monitorState.symbol} ${monitorState.totalBalance}`;
      if (balStatusEl) {
        balStatusEl.textContent = monitorState.isAvailable ? '余额充足可用' : '余额不足';
        balStatusEl.classList.toggle('warn', !monitorState.isAvailable);
      }
      if (balSubEl) {
        balSubEl.innerHTML = `
          <span>充值余额：<b>${monitorState.symbol}${monitorState.toppedUpBalance}</b></span>
          <span>赠金余额：<b>${monitorState.symbol}${monitorState.grantedBalance}</b></span>
        `;
      }
    } else {
      if (balNumEl) balNumEl.textContent = formatCny(agg.totalCost, 4);
      if (balStatusEl) {
        balStatusEl.textContent = monitorState.loadingBalance ? '查询中…' : '累计估算支出';
        balStatusEl.classList.remove('warn');
      }
      if (balSubEl) {
        balSubEl.innerHTML = `<span style="grid-column: 1 / -1;">${
          monitorState.errorMsg || '当前网关未返回余额数值，可点击右上角「刷新余额」或正常查看 Token 与费用统计'
        }</span>`;
      }
    }

    const lastModelEl = pop.querySelector('#oss-mon-last-model');
    const lastTokEl = pop.querySelector('#oss-mon-last-tokens');
    const lastCostEl = pop.querySelector('#oss-mon-last-cost');
    if (lastModelEl) lastModelEl.textContent = lastRec?.model || monitorState.model || 'deepseek-v4.1-flash';
    if (lastTokEl) {
      lastTokEl.textContent = lastRec
        ? `${formatCompactInt(lastRec.totalTokens)}（入 ${formatCompactInt(lastRec.promptTokens)} / 出 ${formatCompactInt(lastRec.completionTokens)}）`
        : '0';
    }
    if (lastCostEl) lastCostEl.textContent = lastRec ? formatCny(lastRec.costCny, 5) : '¥0.0000';

    const rateLabelEl = pop.querySelector('#oss-mon-hit-rate-label');
    const barHitEl = pop.querySelector('#oss-mon-bar-hit');
    const totalTokEl = pop.querySelector('#oss-mon-total-tokens');
    const totalCostEl = pop.querySelector('#oss-mon-total-cost');
    const hitMissEl = pop.querySelector('#oss-mon-hit-miss');
    const savedCnyEl = pop.querySelector('#oss-mon-saved-cny');

    if (rateLabelEl) rateLabelEl.textContent = hitRate !== null ? `缓存命中 ${hitRate}%` : '等待首轮回复';
    if (barHitEl) barHitEl.style.width = `${hitRate !== null ? Math.max(4, hitRate) : 0}%`;
    if (totalTokEl) totalTokEl.textContent = formatCompactInt(agg.totalTokens);
    if (totalCostEl) totalCostEl.textContent = formatCny(agg.totalCost, 4);
    if (hitMissEl) hitMissEl.textContent = `${formatCompactInt(agg.hit)} / ${formatCompactInt(agg.miss)}`;
    if (savedCnyEl) savedCnyEl.textContent = formatCny(agg.totalSaved, 4);

    const recListEl = pop.querySelector('#oss-mon-records-list');
    if (recListEl) {
      if (monitorState.records.length === 0) {
        recListEl.innerHTML = '<div class="oss-mon-rec-row"><span>暂无消费记录，发送任意消息后自动统计</span></div>';
      } else {
        recListEl.innerHTML = monitorState.records.slice(0, 12).map((r) => {
          const d = new Date(r.ts || Date.now());
          const tm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
          return `<div class="oss-mon-rec-row"><span>${tm} · ${r.source || '对话'}</span><strong>${formatCompactInt(r.totalTokens)} tok · ${formatCny(r.costCny, 4)}</strong></div>`;
        }).join('');
      }
    }
  }

  function recordTurnUsage({ usage, model = '', source = '对话', apiKey = '', baseUrl = '', provider = '' } = {}) {
    if (!usage || typeof usage !== 'object') return null;
    const cleanProv = String(provider || '').trim().toLowerCase();
    if (cleanProv === 'custom_cloud' || cleanProv === 'api_cloud' || cleanProv === 'local' || cleanProv === 'local_antigravity' || cleanProv === 'demo') {
      return null;
    }
    if (!monitorState.enabled && cleanProv !== 'own_deepseek') {
      return null;
    }
    const lowerBase = String(baseUrl || '').trim().toLowerCase();
    if (lowerBase && !lowerBase.includes('deepseek.com')) {
      return null;
    }
    const usedModel = String(model || monitorState.model || 'deepseek-v4.1-flash').trim();
    const calc = estimateTurnCostCny(usage, usedModel);
    if (calc.totalTokens <= 0) return null;

    const record = {
      ts: Date.now(),
      source: String(source || '对话'),
      model: usedModel,
      ...calc
    };
    monitorState.enabled = true;
    monitorState.model = usedModel;
    monitorState.lastTurnUsage = record;
    monitorState.records.unshift(record);
    if (monitorState.records.length > 30) {
      monitorState.records = monitorState.records.slice(0, 30);
    }
    saveStoredRecords(monitorState.records);

    if (apiKey) {
      monitorState.phoneAgentAuth = { apiKey, baseUrl, execMode: monitorState.phoneAgentAuth.execMode || 'api_direct' };
    }
    renderMonitorUi();
    return record;
  }

  function clearBillingRecords() {
    monitorState.records = [];
    monitorState.lastTurnUsage = null;
    monitorState.sessionHitTokens = 0;
    monitorState.sessionMissTokens = 0;
    monitorState.sessionCompletionTokens = 0;
    saveStoredRecords([]);
    renderMonitorUi();
  }

  async function refreshBalance(force = false) {
    if (!monitorState.enabled && !monitorState.phoneAgentAuth.apiKey) return;
    if (monitorState.loadingBalance) return;
    if (!force && Date.now() - monitorState.lastBalanceFetchAt < 6000) return;

    monitorState.loadingBalance = true;
    const refreshBtn = typeof document !== 'undefined' ? document.getElementById('oss-mon-refresh-btn') : null;
    if (refreshBtn) refreshBtn.textContent = '查询中…';
    renderMonitorUi();

    try {
      const headers = { 'Content-Type': 'application/json' };
      const activeToken =
        window.__starAuthStore?.getToken?.() ||
        window.__starAuthStore?.getActiveToken?.() ||
        localStorage.getItem('star_whisper_token') ||
        localStorage.getItem('star_auth_token') ||
        '';
      if (activeToken) headers.Authorization = `Bearer ${activeToken}`;

      let data = null;
      if (monitorState.phoneAgentAuth?.apiKey) {
        const body = JSON.stringify({
          customApiKey: monitorState.phoneAgentAuth.apiKey,
          customBaseUrl: monitorState.phoneAgentAuth.baseUrl || ''
        });
        let res = await fetch('/api/deepseek/check-balance', { method: 'POST', headers, body }).catch(() => null);
        if (!res || !res.ok) {
          res = await fetch(`${PUBLIC_WEB_ORIGIN}/api/deepseek/check-balance`, { method: 'POST', headers, body }).catch(() => null);
        }
        if (res && res.ok) data = await res.json().catch(() => null);
      } else {
        const res = await fetch('/api/deepseek/my-balance', { headers }).catch(() => null);
        if (res && res.ok) data = await res.json().catch(() => null);
      }

      if (data) {
        monitorState.lastBalanceFetchAt = Date.now();
        if (data.enabled) {
          monitorState.providerLabel = data.provider_label || 'DeepSeek 官方 API';
          monitorState.isOfficialDeepSeek = Boolean(data.is_official_deepseek);
          monitorState.balanceSupported = Boolean(data.balance_supported && data.total_balance !== null);
          monitorState.isAvailable = data.is_available !== false;
          monitorState.symbol = data.symbol || '¥';
          monitorState.totalBalance = data.total_balance ?? null;
          monitorState.toppedUpBalance = data.topped_up_balance ?? '0.00';
          monitorState.grantedBalance = data.granted_balance ?? '0.00';
          monitorState.model = data.model || monitorState.model;
          monitorState.errorMsg = data.error || '';
        }
      }
    } catch {
      monitorState.errorMsg = '网络波动，稍后可点右上角重试';
    } finally {
      monitorState.loadingBalance = false;
      if (refreshBtn) refreshBtn.textContent = '刷新余额';
      renderMonitorUi();
    }
  }

  function syncFromHost({ scopeProvider, settings, messages, forceBalanceRefresh = false } = {}) {
    const prov = String(scopeProvider || settings?.provider || '').trim().toLowerCase();
    const isUsingDeepSeek = prov === 'own_deepseek';
    const prevEnabled = monitorState.enabled;
    monitorState.enabled = isUsingDeepSeek;
    if (!isUsingDeepSeek) {
      monitorState.phoneAgentAuth = { apiKey: '', baseUrl: '', execMode: '' };
    }
    if (isUsingDeepSeek && settings?.own_deepseek_model) {
      monitorState.model = settings.own_deepseek_model;
    }
    monitorState.providerLabel = 'DeepSeek 官方 API';

    if (Array.isArray(messages)) {
      recomputeCacheMetrics(messages);
    }

    renderMonitorUi();

    if (isUsingDeepSeek && settings?.has_own_deepseek_key && (!prevEnabled || forceBalanceRefresh || monitorState.totalBalance === null)) {
      refreshBalance(forceBalanceRefresh);
    }
  }

  function syncPhoneAgent({ execMode = '', apiKey = '', baseUrl = '', model = '' } = {}) {
    const lowerBase = String(baseUrl || '').trim().toLowerCase();
    const isDeepSeekDirect = execMode === 'api_direct' && (!lowerBase || lowerBase.includes('deepseek.com'));
    const prevKey = monitorState.phoneAgentAuth.apiKey;
    monitorState.phoneAgentAuth = {
      apiKey: isDeepSeekDirect ? String(apiKey || '') : '',
      baseUrl: isDeepSeekDirect ? String(baseUrl || '') : '',
      execMode: String(execMode || '')
    };
    monitorState.enabled = isDeepSeekDirect;
    if (model && isDeepSeekDirect) monitorState.model = model;
    monitorState.providerLabel = 'DeepSeek API · 手机辅助';
    renderMonitorUi();
    if (isDeepSeekDirect && apiKey && (monitorState.totalBalance === null || prevKey !== apiKey)) {
      refreshBalance(false);
    }
  }

  window.DeepSeekMonitorPlugin = {
    version: '2.0.0',
    license: 'MIT',
    sync: syncFromHost,
    syncPhoneAgent,
    recordTurnUsage,
    refreshBalance,
    clearBillingRecords,
    estimateTurnCostCny,
    openPopover,
    closePopover,
    getState: () => ({ ...monitorState, aggregate: aggregateRecords() })
  };

  window.addEventListener('deepseek:monitor-sync', (e) => {
    syncFromHost(e.detail || {});
  });
})();

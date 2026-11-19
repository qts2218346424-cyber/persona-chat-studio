/**
 * @license MIT
 * Open-Source Plugin: DeepSeek Official API Balance & Context Cache Monitor (v1.1.0)
 * 专为绑定个人 DeepSeek 官方 API (api.deepseek.com) 及兼容接口设计的轻量级实时余额与硬盘缓冲命中率监控插件。
 *
 * 特性：
 * 1. 对免配置剧本玩家 100% 隐形零打扰，仅在启用个人 API (own_deepseek) 时自动唤醒；
 * 2. 对接 DeepSeek 官方 /user/balance 实时展示总余额、充值余额与赠金明细；
 * 3. 实时解析每次流式对话返回的 prompt_cache_hit_tokens / prompt_cache_miss_tokens，精确计算缓冲命中率与省钱比例。
 */
(() => {
  const PLUGIN_STYLE_ID = 'oss-ds-monitor-plugin-style';
  const POPOVER_ID = 'oss-ds-monitor-popover';
  const TRIGGER_BTN_ID = 'oss-ds-monitor-trigger-btn';

  const monitorState = {
    enabled: false,
    loadingBalance: false,
    providerLabel: 'DeepSeek 官方 API',
    isOfficialDeepSeek: true,
    balanceSupported: false,
    isAvailable: true,
    symbol: '¥',
    totalBalance: null,
    toppedUpBalance: '0.00',
    grantedBalance: '0.00',
    model: 'deepseek-flash',
    lastBalanceFetchAt: 0,
    sessionHitTokens: 0,
    sessionMissTokens: 0,
    sessionCompletionTokens: 0,
    lastTurnHitRate: null,
    errorMsg: ''
  };

  function injectPluginStyles() {
    if (document.getElementById(PLUGIN_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = PLUGIN_STYLE_ID;
    style.textContent = `
      .oss-ds-monitor-pill {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 5px 11px;
        border-radius: 999px;
        border: 1px solid light-dark(rgba(77, 107, 254, 0.28), rgba(96, 165, 250, 0.34));
        background: light-dark(rgba(239, 246, 255, 0.92), rgba(30, 41, 59, 0.85));
        color: light-dark(#1e3a8a, #dbeafe);
        font: inherit;
        font-size: 12.5px;
        font-weight: 600;
        line-height: 1.2;
        cursor: pointer;
        white-space: nowrap;
        transition: transform 0.14s ease, border-color 0.14s ease, box-shadow 0.14s ease;
      }
      .oss-ds-monitor-pill:hover {
        transform: translateY(-1px);
        border-color: #4d6bfe;
        box-shadow: 0 4px 12px rgba(77, 107, 254, 0.16);
      }
      .oss-ds-monitor-pill .oss-sep {
        opacity: 0.42;
      }
      .oss-ds-monitor-pill .oss-cache-tag {
        color: light-dark(#047857, #34d399);
        font-weight: 700;
      }
      .oss-ds-monitor-pill.low-balance {
        border-color: rgba(239, 68, 68, 0.45);
        color: light-dark(#b91c1c, #fca5a5);
      }

      .oss-ds-monitor-popover {
        position: fixed;
        inset: auto;
        top: 56px;
        right: 18px;
        margin: 0;
        width: min(348px, calc(100vw - 24px));
        padding: 14px;
        border-radius: 16px;
        border: 1px solid light-dark(rgba(15, 23, 42, 0.1), rgba(255, 255, 255, 0.12));
        background: light-dark(#ffffff, #1a1f2e);
        color: var(--text-primary, #1f2329);
        box-shadow: 0 16px 40px rgba(15, 23, 42, 0.18);
        z-index: 950;
      }
      .oss-ds-monitor-popover:not(:is(:popover-open, .\\:popover-open)) {
        display: none;
      }
      .oss-ds-monitor-popover:is(:popover-open, .\\:popover-open) {
        display: flex;
        flex-direction: column;
        gap: 12px;
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
        padding: 11px 12px;
        border-radius: 12px;
        background: light-dark(#f8fafc, rgba(255, 255, 255, 0.04));
        border: 1px solid light-dark(rgba(15, 23, 42, 0.06), rgba(255, 255, 255, 0.07));
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .oss-mon-bal-row {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 8px;
      }
      .oss-mon-bal-num {
        font-size: 22px;
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
        height: 8px;
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
        gap: 7px;
      }
      .oss-mon-metric-item {
        padding: 6px 8px;
        border-radius: 8px;
        background: light-dark(#ffffff, rgba(15, 23, 42, 0.45));
        border: 1px solid light-dark(rgba(15, 23, 42, 0.05), rgba(255, 255, 255, 0.05));
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

  function formatCompactInt(n) {
    const num = Number(n) || 0;
    if (num >= 10000) return `${(num / 1000).toFixed(1)}k`;
    return String(num);
  }

  function ensureDomMounted() {
    // 顶栏保持极简克制，不再往右上角 #tour-anchor-tools 注入额外余额胶囊；
    // 引擎与缓存监控入口已统一整合至「⋯ -> ⚡ 引擎与缓存状态」右侧面板中。
    return null;
  }

  function positionPopoverNearTrigger(btn, pop) {
    const rect = btn.getBoundingClientRect();
    if (!rect.width && !rect.height) return;
    const top = Math.min(window.innerHeight - 360, Math.max(10, rect.bottom + 8));
    const right = Math.max(12, window.innerWidth - rect.right);
    pop.style.top = `${top}px`;
    pop.style.right = `${right}px`;
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

  function renderMonitorUi() {
    const nodes = ensureDomMounted();
    if (!nodes) return;
    const { btn, pop } = nodes;

    if (!monitorState.enabled) {
      btn.classList.add('hidden');
      try {
        if (pop.matches(':popover-open') && typeof pop.hidePopover === 'function') {
          pop.hidePopover();
        }
      } catch {}
      return;
    }

    btn.classList.remove('hidden');

    const totalPrompt = monitorState.sessionHitTokens + monitorState.sessionMissTokens;
    const hitRate = totalPrompt > 0 ? Math.round((monitorState.sessionHitTokens / totalPrompt) * 100) : null;

    const balPart = monitorState.loadingBalance && monitorState.totalBalance === null
      ? '🐋 查余额…'
      : monitorState.balanceSupported && monitorState.totalBalance !== null
      ? `🐋 ${monitorState.symbol}${monitorState.totalBalance}`
      : '🔑 个人API';

    const cachePart =
      hitRate !== null
        ? `<span class="oss-cache-tag">⚡ 缓冲 ${hitRate}%</span>`
        : '<span class="oss-cache-tag">⚡ 缓冲就绪</span>';

    const isLow =
      monitorState.balanceSupported &&
      monitorState.totalBalance !== null &&
      Number(monitorState.totalBalance) <= 0.5;
    btn.classList.toggle('low-balance', isLow);
    btn.innerHTML = `<span>${balPart}</span><span class="oss-sep">·</span>${cachePart}`;

    const titleEl = pop.querySelector('#oss-mon-provider-title');
    if (titleEl) {
      titleEl.textContent = `🐋 ${monitorState.providerLabel} 实时监控`;
    }

    const balNumEl = pop.querySelector('#oss-mon-bal-num');
    const balStatusEl = pop.querySelector('#oss-mon-bal-status');
    const balSubEl = pop.querySelector('#oss-mon-bal-sub');
    if (monitorState.balanceSupported && monitorState.totalBalance !== null) {
      if (balNumEl) balNumEl.textContent = `${monitorState.symbol} ${monitorState.totalBalance}`;
      if (balStatusEl) {
        balStatusEl.textContent = monitorState.isAvailable ? '🟢 余额充足可用' : '🔴 余额不足';
        balStatusEl.classList.toggle('warn', !monitorState.isAvailable);
      }
      if (balSubEl) {
        balSubEl.innerHTML = `
          <span>充值余额：<b>${monitorState.symbol}${monitorState.toppedUpBalance}</b></span>
          <span>赠金余额：<b>${monitorState.symbol}${monitorState.grantedBalance}</b></span>
        `;
      }
    } else {
      if (balNumEl) balNumEl.textContent = monitorState.model || '直连就绪';
      if (balStatusEl) {
        balStatusEl.textContent = monitorState.loadingBalance ? '⏳ 同步中…' : '🟢 个人密钥生效中';
        balStatusEl.classList.remove('warn');
      }
      if (balSubEl) {
        balSubEl.innerHTML = `<span style="grid-column: 1 / -1;">${
          monitorState.errorMsg || '当前兼容接口未开放余额数字查询，下方实时统计硬盘缓冲命中率'
        }</span>`;
      }
    }

    const rateLabelEl = pop.querySelector('#oss-mon-hit-rate-label');
    const barHitEl = pop.querySelector('#oss-mon-bar-hit');
    const hitTokEl = pop.querySelector('#oss-mon-hit-tokens');
    const missTokEl = pop.querySelector('#oss-mon-miss-tokens');
    const compTokEl = pop.querySelector('#oss-mon-comp-tokens');
    const savedPctEl = pop.querySelector('#oss-mon-saved-pct');

    if (rateLabelEl) {
      rateLabelEl.textContent =
        hitRate !== null
          ? `${hitRate}%${monitorState.lastTurnHitRate !== null ? ` (本轮 ${monitorState.lastTurnHitRate}%)` : ''}`
          : '等待首轮回复';
    }
    if (barHitEl) {
      barHitEl.style.width = `${hitRate !== null ? Math.max(4, hitRate) : 0}%`;
    }
    if (hitTokEl) hitTokEl.textContent = `${formatCompactInt(monitorState.sessionHitTokens)}`;
    if (missTokEl) missTokEl.textContent = `${formatCompactInt(monitorState.sessionMissTokens)}`;
    if (compTokEl) compTokEl.textContent = `${formatCompactInt(monitorState.sessionCompletionTokens)}`;

    if (savedPctEl) {
      if (totalPrompt > 0 && monitorState.sessionHitTokens > 0) {
        // DeepSeek 官方硬盘缓存命中单价约为未命中单价的 10%（省 90% 命中部分费用）
        const savedRatio = Math.round(((monitorState.sessionHitTokens * 0.9) / totalPrompt) * 100);
        savedPctEl.textContent = `已省约 ${savedRatio}% 输入费`;
      } else if (totalPrompt > 0) {
        savedPctEl.textContent = '首轮已建立缓冲前缀';
      } else {
        savedPctEl.textContent = '多轮对话自动省费';
      }
    }
  }

  async function refreshBalance(force = false) {
    if (!monitorState.enabled) return;
    if (monitorState.loadingBalance) return;
    if (!force && Date.now() - monitorState.lastBalanceFetchAt < 6000) return;

    monitorState.loadingBalance = true;
    const refreshBtn = document.getElementById('oss-mon-refresh-btn');
    if (refreshBtn) refreshBtn.textContent = '⏳ 查询中…';
    renderMonitorUi();

    try {
      const headers = {};
      const activeToken = window.__starAuthStore?.getActiveToken?.() || localStorage.getItem('star_auth_token') || '';
      if (activeToken) headers.Authorization = `Bearer ${activeToken}`;

      const res = await fetch('/api/deepseek/my-balance', { headers });
      if (res.ok) {
        const data = await res.json();
        monitorState.lastBalanceFetchAt = Date.now();
        if (!data.enabled) {
          monitorState.enabled = false;
        } else {
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
      if (refreshBtn) refreshBtn.textContent = '🔄 刷新余额';
      renderMonitorUi();
    }
  }

  function syncFromHost({ settings, messages, forceBalanceRefresh = false } = {}) {
    const isUsingOwnKey = Boolean(
      settings && settings.provider === 'own_deepseek' && settings.has_own_deepseek_key
    );
    const prevEnabled = monitorState.enabled;
    monitorState.enabled = isUsingOwnKey;
    if (settings?.own_deepseek_model) {
      monitorState.model = settings.own_deepseek_model;
    }

    if (Array.isArray(messages)) {
      recomputeCacheMetrics(messages);
    }

    renderMonitorUi();

    if (isUsingOwnKey && (!prevEnabled || forceBalanceRefresh || monitorState.totalBalance === null)) {
      refreshBalance(forceBalanceRefresh);
    }
  }

  window.DeepSeekMonitorPlugin = {
    version: '1.1.0',
    license: 'MIT',
    sync: syncFromHost,
    refreshBalance
  };

  window.addEventListener('deepseek:monitor-sync', (e) => {
    syncFromHost(e.detail || {});
  });
})();

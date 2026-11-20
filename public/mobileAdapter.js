/**
 * 移动端响应式交互控制器与默认 DeepSeek 模式引导器 (Mobile Responsive & Default DeepSeek Adapter)
 * 职责：
 * 1. 确保每次新打开网页默认进入 DeepSeek 原生纯净模式（支持 ?mode=roleplay 显式直达恋庭模式）；
 * 2. 管理窄屏/手机端（<=860px）左右覆层抽屉、半透明毛玻璃遮罩、点击外侧/选会话自动收起与滑动关闭手势；
 * 3. 增强移动端顶栏快捷操作（一键开启新对话、一键切换恋庭剧场、2.5D 伴侣浮窗收起）并同步无障碍状态。
 */
(() => {
  const MOBILE_MQ = window.matchMedia('(max-width: 860px)');

  // 1. 打开网页默认模式初始化（与 app.js 统一使用 ui_mode_v5，尊重玩家上次选择的模式）
  function resolveInitialDefaultMode() {
    try {
      const params = new URLSearchParams(window.location.search);
      const queryMode = params.get('mode');
      if (queryMode === 'roleplay' || queryMode === 'deepseek' || queryMode === 'phone-agent') {
        localStorage.setItem('ui_mode_v5', queryMode);
        return queryMode;
      }
      if (params.get('demo') === '1' || params.get('demo') === 'true') {
        localStorage.setItem('ui_mode_v5', 'roleplay');
        return 'roleplay';
      }
      const currentSaved = localStorage.getItem('ui_mode_v5');
      if (currentSaved === 'roleplay' || currentSaved === 'deepseek' || currentSaved === 'phone-agent') {
        return currentSaved;
      }
    } catch {}
    return 'deepseek';
  }

  const bootMode = resolveInitialDefaultMode();
  document.documentElement.dataset.uiMode = bootMode;
  if (document.body) {
    document.body.dataset.uiMode = bootMode;
  }

  const appShell = document.getElementById('app-shell');
  const leftSidebar = document.getElementById('left-sidebar');
  const rightPanel = document.getElementById('right-panel');
  const expandLeftBtn = document.getElementById('expand-left-btn');

  if (!appShell) return;

  appShell.dataset.uiMode = bootMode;

  // 2. 幂等挂载移动端遮罩层与顶栏/浮窗增强控件
  let backdrop = document.getElementById('mobile-drawer-backdrop');
  if (!backdrop) {
    backdrop = document.createElement('div');
    backdrop.id = 'mobile-drawer-backdrop';
    backdrop.className = 'mobile-drawer-backdrop hidden';
    backdrop.setAttribute('aria-hidden', 'true');
    appShell.insertBefore(backdrop, appShell.firstChild);
  }

  // 为顶栏已有按钮包裹长短响应式文案（窄屏自动切换精简短词，防止挤压标题）
  function applyResponsiveButtonLabels(btnId, fullText, shortText) {
    const btn = document.getElementById(btnId);
    if (!btn || btn.querySelector('.btn-short-lbl')) return;
    btn.innerHTML = `<span class="btn-full-lbl">${fullText}</span><span class="btn-short-lbl">${shortText}</span>`;
  }

  applyResponsiveButtonLabels('topbar-script-switch-btn', '换剧本', '剧本');
  applyResponsiveButtonLabels('toggle-right-btn', '养成', '养成');
  applyResponsiveButtonLabels('topbar-companion-btn', '立绘', '立绘');
  applyResponsiveButtonLabels('topbar-switch-ds-btn', 'DeepSeek', 'DS');
  applyResponsiveButtonLabels('topbar-more-btn', '⋯', '⋯');

  // 顶栏左侧移动端空状态轻量品牌字标
  const topbarLeft = document.querySelector('.stage-topbar .topbar-left');
  if (topbarLeft && !topbarLeft.querySelector('.ds-mobile-empty-brand')) {
    const brandSpan = document.createElement('span');
    brandSpan.className = 'ds-mobile-empty-brand ds-only-inline';
    brandSpan.setAttribute('aria-hidden', 'true');
    brandSpan.textContent = 'deepseek';
    topbarLeft.appendChild(brandSpan);
  }

  // 顶栏右侧注入 DeepSeek 模式快捷切换恋庭胶囊与手机端一键新对话图标
  const topbarRight = document.getElementById('tour-anchor-tools');
  const moreBtn = document.getElementById('topbar-more-btn');
  if (topbarRight && moreBtn) {
    const firstDsToolBtn =
      document.getElementById('open-ds-artifacts-btn') ||
      document.getElementById('ds-open-memory-setting-btn') ||
      moreBtn;

    [
      'ds-open-memory-setting-btn',
      'open-ds-inspector-btn',
      'ds-share-session-btn',
      'ds-quick-theme-btn'
    ].forEach((id) => {
      document.getElementById(id)?.classList.add('ds-desktop-tool');
    });

    // 模式切换入口已全站统一在左侧栏顶部（以及收起态左上角兜底按钮），不再向右上角顶栏注入切模式胶囊

    if (!document.getElementById('ds-topbar-new-btn')) {
      const newChatIconBtn = document.createElement('button');
      newChatIconBtn.type = 'button';
      newChatIconBtn.id = 'ds-topbar-new-btn';
      newChatIconBtn.className = 'icon-btn ds-only-inline ds-topbar-new-icon';
      newChatIconBtn.title = '开启新对话';
      newChatIconBtn.setAttribute('aria-label', '开启新对话');
      newChatIconBtn.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" aria-hidden="true">
          <circle cx="12" cy="12" r="9"></circle>
          <line x1="12" y1="8" x2="12" y2="16"></line>
          <line x1="8" y1="12" x2="16" y2="12"></line>
        </svg>
      `;
      newChatIconBtn.addEventListener('click', () => {
        if (appShell.dataset.uiMode === 'phone-agent') {
          window.PhoneAgent?.resetTaskWorkspace?.();
          return;
        }
        document.getElementById('ds-new-chat-btn')?.click();
      });
      topbarRight.insertBefore(newChatIconBtn, moreBtn);
    }

    if (!document.getElementById('ds-topbar-mobile-settings-btn')) {
      const mobSettingsBtn = document.createElement('button');
      mobSettingsBtn.type = 'button';
      mobSettingsBtn.id = 'ds-topbar-mobile-settings-btn';
      mobSettingsBtn.className = 'icon-btn ds-topbar-mobile-settings';
      mobSettingsBtn.title = '设置与 API 密钥';
      mobSettingsBtn.setAttribute('aria-label', '设置');
      mobSettingsBtn.innerHTML = `
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="3"></circle>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
        </svg>
      `;
      mobSettingsBtn.addEventListener('click', () => {
        if (appShell.dataset.uiMode === 'phone-agent') {
          window.PhoneAgent?.openControlSheet?.();
          return;
        }
        document.getElementById('open-settings-btn')?.click();
      });
      topbarRight.insertBefore(mobSettingsBtn, moreBtn);
    }
  }

  // 保持 ⋯ 更多菜单极简纯净
  const morePopover = document.getElementById('topbar-more-popover');

  // 陪伴立绘移动端悬浮卡片右上角收起按钮
  const compStyleBar = document.querySelector('#companion-stage .companion-Style-bar');
  const companionStage = document.getElementById('companion-stage');
  if (compStyleBar && companionStage && !document.getElementById('comp-mobile-close-btn')) {
    const closeCompBtn = document.createElement('button');
    closeCompBtn.type = 'button';
    closeCompBtn.id = 'comp-mobile-close-btn';
    closeCompBtn.className = 'comp-icon-btn comp-mobile-close-btn';
    closeCompBtn.title = '收起陪伴立绘';
    closeCompBtn.setAttribute('aria-label', '收起陪伴立绘');
    closeCompBtn.textContent = '✕';
    closeCompBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      companionStage.classList.add('hidden');
      document.getElementById('topbar-companion-btn')?.classList.remove('active');
    });
    compStyleBar.appendChild(closeCompBtn);
  }

  // 3. 登录门扉与网页标题随模式动态同步（始终保留「星语恋庭」品牌标识）
  function syncBrandAndTitleByMode(mode) {
    const normalized = mode === 'phone-agent' ? 'phone-agent' : (mode === 'deepseek' ? 'deepseek' : 'roleplay');
    document.documentElement.dataset.uiMode = normalized;
    if (document.body) {
      document.body.dataset.uiMode = normalized;
    }
    document.title = normalized === 'phone-agent'
      ? '星语恋庭 · 手机辅助模式'
      : (normalized === 'deepseek'
        ? '星语恋庭 · DeepSeek 原生助手模式'
        : '星语恋庭 · 互动剧本与沉浸角色扮演馆');

    const authHeading = document.getElementById('auth-brand-heading');
    const authSub = document.getElementById('auth-brand-subtitle') || document.querySelector('.auth-hero p');
    const signinSubmit = document.querySelector('#signin-form .auth-submit-btn');
    if (authHeading) {
      authHeading.textContent = '星语恋庭';
    }
    if (authSub) {
      authSub.textContent = '沉浸互动剧本 · 立体陪伴配音 · 长效记忆对话馆';
    }
    if (signinSubmit) {
      signinSubmit.textContent = '登录进入星语恋庭';
    }
  }

  syncBrandAndTitleByMode(bootMode);

  // 4. 移动端左右抽屉互斥控制、遮罩同步与初始收起
  function isMobile() {
    return MOBILE_MQ.matches;
  }

  function closeLeftDrawer() {
    if (!appShell.classList.contains('left-collapsed')) {
      appShell.classList.add('left-collapsed');
    }
    if (expandLeftBtn) {
      if (expandLeftBtn.classList.contains('hidden')) {
        expandLeftBtn.classList.remove('hidden');
      }
      if (expandLeftBtn.getAttribute('aria-expanded') !== 'false') {
        expandLeftBtn.setAttribute('aria-expanded', 'false');
      }
    }
  }

  function closeRightDrawer() {
    if (!appShell.classList.contains('right-collapsed')) {
      appShell.classList.add('right-collapsed');
    }
  }

  function closeAllMobileDrawers() {
    if (!isMobile()) return;
    closeLeftDrawer();
    closeRightDrawer();
    if (!backdrop.classList.contains('hidden')) {
      backdrop.classList.add('hidden');
    }
  }

  window.__closeMobileDrawers = closeAllMobileDrawers;

  // 首屏若处于手机视口，立即收起两侧抽屉与悬浮立绘，确保首帧呈现 100% 全宽无遮挡主对话区（点顶栏 ✨ 立绘 随时展开）
  if (isMobile()) {
    closeLeftDrawer();
    closeRightDrawer();
    if (companionStage && !companionStage.classList.contains('hidden')) {
      companionStage.classList.add('hidden');
      document.getElementById('topbar-companion-btn')?.classList.remove('active');
    }
  }

  let lastLeftOpen = !appShell.classList.contains('left-collapsed');
  let lastRightOpen = !appShell.classList.contains('right-collapsed');
  let lastSyncedMode = appShell.dataset.uiMode || '';
  let internalSyncing = false;

  function syncDrawerStateAndBackdrop() {
    if (internalSyncing) return;
    const curMode = appShell.dataset.uiMode || 'roleplay';
    let leftOpen = !appShell.classList.contains('left-collapsed');
    let rightOpen = !appShell.classList.contains('right-collapsed');

    if (curMode === lastSyncedMode && leftOpen === lastLeftOpen && rightOpen === lastRightOpen) {
      return;
    }

    internalSyncing = true;
    try {
      if (curMode !== lastSyncedMode) {
        lastSyncedMode = curMode;
        syncBrandAndTitleByMode(curMode);
        try {
          localStorage.setItem('ui_mode_v5', curMode);
        } catch {}
      }

      if (!isMobile()) {
        if (!backdrop.classList.contains('hidden')) {
          backdrop.classList.add('hidden');
        }
        lastLeftOpen = leftOpen;
        lastRightOpen = rightOpen;
        return;
      }

      // 手机端左右抽屉互斥：新打开一侧时自动收起另一侧
      if (leftOpen && rightOpen) {
        if (!lastRightOpen && rightOpen) {
          closeLeftDrawer();
          leftOpen = false;
        } else {
          closeRightDrawer();
          rightOpen = false;
        }
      }

      if (expandLeftBtn) {
        if (expandLeftBtn.classList.contains('hidden')) {
          expandLeftBtn.classList.remove('hidden');
        }
        const expStr = String(leftOpen);
        if (expandLeftBtn.getAttribute('aria-expanded') !== expStr) {
          expandLeftBtn.setAttribute('aria-expanded', expStr);
        }
      }

      const anyOpen = leftOpen || rightOpen;
      if (backdrop.classList.contains('hidden') === anyOpen) {
        backdrop.classList.toggle('hidden', !anyOpen);
      }

      lastLeftOpen = leftOpen;
      lastRightOpen = rightOpen;
    } finally {
      internalSyncing = false;
    }
  }

  const shellObserver = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.attributeName === 'class' || m.attributeName === 'data-ui-mode') {
        syncDrawerStateAndBackdrop();
        break;
      }
    }
  });
  shellObserver.observe(appShell, { attributes: true, attributeFilter: ['class', 'data-ui-mode'] });

  // 点击半透明遮罩或按 Escape 关闭抽屉
  backdrop.addEventListener('click', () => {
    closeAllMobileDrawers();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isMobile()) {
      const leftOpen = !appShell.classList.contains('left-collapsed');
      const rightOpen = !appShell.classList.contains('right-collapsed');
      if (leftOpen || rightOpen) {
        closeAllMobileDrawers();
      }
    }
  });

  // 视口跨过 860px 断点（如手机横竖屏切换或浏览器窗口缩放）时平滑自适应
  MOBILE_MQ.addEventListener('change', (e) => {
    if (e.matches) {
      closeAllMobileDrawers();
      if (companionStage) {
        companionStage.classList.add('hidden');
        document.getElementById('topbar-companion-btn')?.classList.remove('active');
      }
    } else {
      backdrop.classList.add('hidden');
      let savedLeftCollapsed = false;
      try {
        savedLeftCollapsed = localStorage.getItem('left_sidebar_collapsed_v1') === '1';
      } catch {}
      appShell.classList.toggle('left-collapsed', savedLeftCollapsed);
      if (expandLeftBtn) expandLeftBtn.classList.toggle('hidden', !savedLeftCollapsed);
      document.getElementById('collapsed-quick-nav')?.classList.toggle('hidden', !savedLeftCollapsed);
    }
  });

  // 点击左侧栏「收起」按钮或右侧栏「关闭」按钮时，立即同步隐藏移动端半透明遮罩层
  document.getElementById('toggle-left-btn')?.addEventListener('click', () => {
    if (isMobile()) {
      closeLeftDrawer();
      if (appShell.classList.contains('right-collapsed')) {
        backdrop.classList.add('hidden');
      }
    }
  });
  document.getElementById('close-right-btn')?.addEventListener('click', () => {
    if (isMobile()) {
      closeRightDrawer();
      if (appShell.classList.contains('left-collapsed')) {
        backdrop.classList.add('hidden');
      }
    }
  });

  // 手机端在左侧导航栏内点击会话、角色或弹窗入口后自动轻柔收起抽屉
  if (leftSidebar) {
    leftSidebar.addEventListener('click', (e) => {
      if (!isMobile()) return;
      const target = e.target;
      if (!(target instanceof Element)) return;

      // 忽略搜索按钮、搜索输入框、删除单条会话按钮及底部菜单展开触发器自身
      if (
        target.closest('#ds-search-sessions-btn') ||
        target.closest('#ds-session-search-wrap') ||
        target.closest('.session-del-btn') ||
        target.closest('#ds-profile-btn') ||
        target.closest('.ds-dots-btn') ||
        target.closest('#ds-soul-select') ||
        target.closest('.ds-menu-soul-box')
      ) {
        return;
      }

      if (
        target.closest('#open-plaza-btn') ||
        target.closest('#sidebar-open-workshop-btn') ||
        target.closest('#create-persona-btn') ||
        target.closest('#sidebar-import-history-btn') ||
        target.closest('#open-user-persona-btn') ||
        target.closest('#open-settings-btn') ||
        target.closest('#open-admin-console-btn') ||
        target.closest('#logout-btn') ||
        target.closest('.persona-mini-act-btn')
      ) {
        closeLeftDrawer();
        backdrop.classList.add('hidden');
        return;
      }

      if (
        target.closest('.ws-mode-btn') ||
        target.closest('.session-item') ||
        target.closest('.persona-card-item') ||
        target.closest('#ds-new-chat-btn') ||
        target.closest('#new-chat-btn') ||
        target.closest('#ds-user-popover .popover-action-item')
      ) {
        setTimeout(() => closeLeftDrawer(), 40);
      }
    });
  }

  // 5. 移动端原生级单手边缘轻扫关闭抽屉手势（左抽屉左滑关闭 / 右抽屉右滑关闭）
  function attachSwipeToClose(panelEl, direction, closeFn) {
    if (!panelEl) return;
    let startX = 0;
    let startY = 0;
    let tracking = false;

    panelEl.addEventListener(
      'touchstart',
      (e) => {
        if (!isMobile() || e.touches.length !== 1) return;
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        tracking = true;
      },
      { passive: true }
    );

    panelEl.addEventListener(
      'touchend',
      (e) => {
        if (!tracking || !isMobile() || e.changedTouches.length !== 1) return;
        tracking = false;
        const dx = e.changedTouches[0].clientX - startX;
        const dy = e.changedTouches[0].clientY - startY;
        if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.35) {
          if (direction === 'left' && dx < -48) closeFn();
          if (direction === 'right' && dx > 48) closeFn();
        }
      },
      { passive: true }
    );
  }

  attachSwipeToClose(leftSidebar, 'left', closeLeftDrawer);
  attachSwipeToClose(rightPanel, 'right', closeRightDrawer);
})();

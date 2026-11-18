/**
 * 移动端响应式交互控制器与默认 DeepSeek 模式引导器 (Mobile Responsive & Default DeepSeek Adapter)
 * 职责：
 * 1. 确保每次新打开网页默认进入 DeepSeek 原生纯净模式（支持 ?mode=roleplay 显式直达恋庭模式）；
 * 2. 管理窄屏/手机端（<=860px）左右覆层抽屉、半透明毛玻璃遮罩、点击外侧/选会话自动收起与滑动关闭手势；
 * 3. 增强移动端顶栏快捷操作（一键开启新对话、一键切换恋庭剧场、2.5D 伴侣浮窗收起）并同步无障碍状态。
 */
(() => {
  const MOBILE_MQ = window.matchMedia('(max-width: 860px)');

  // 1. 打开网页默认模式初始化（新开标签页默认进入 DeepSeek 模式，支持 URL ?mode= 覆盖）
  function resolveInitialDefaultMode() {
    try {
      const params = new URLSearchParams(window.location.search);
      const queryMode = params.get('mode');
      if (queryMode === 'roleplay' || queryMode === 'deepseek') {
        localStorage.setItem('ui_mode_v3', queryMode);
        localStorage.setItem('ui_mode_v4', queryMode);
        sessionStorage.setItem('star_tab_ui_booted_v4', '1');
        return queryMode;
      }

      if (!sessionStorage.getItem('star_tab_ui_booted_v4')) {
        localStorage.setItem('ui_mode_v3', 'deepseek');
        localStorage.setItem('ui_mode_v4', 'deepseek');
        sessionStorage.setItem('star_tab_ui_booted_v4', '1');
        return 'deepseek';
      }

      const currentSaved = localStorage.getItem('ui_mode_v3');
      if (currentSaved === 'roleplay' || currentSaved === 'deepseek') {
        return currentSaved;
      }
      localStorage.setItem('ui_mode_v3', 'deepseek');
      localStorage.setItem('ui_mode_v4', 'deepseek');
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

  applyResponsiveButtonLabels('topbar-script-switch-btn', '📖 剧本与广场', '📖 剧本');
  applyResponsiveButtonLabels('topbar-chapters-btn', '🎬 选幕次', '🎬 幕次');
  applyResponsiveButtonLabels('topbar-more-btn', '⋯ 更多', '⋯');

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
      document.getElementById('open-fim-dialog-btn') ||
      moreBtn;

    [
      'open-ds-artifacts-btn',
      'open-fim-dialog-btn',
      'open-ds-inspector-btn',
      'ds-share-session-btn',
      'ds-quick-theme-btn'
    ].forEach((id) => {
      document.getElementById(id)?.classList.add('ds-desktop-tool');
    });

    if (!document.getElementById('ds-topbar-rp-btn')) {
      const rpJumpBtn = document.createElement('button');
      rpJumpBtn.type = 'button';
      rpJumpBtn.id = 'ds-topbar-rp-btn';
      rpJumpBtn.className = 'soft-tool-btn ds-only-inline ds-switch-rp-pill';
      rpJumpBtn.title = '一键切换至「星语恋庭」番剧角色扮演沉浸剧场';
      rpJumpBtn.innerHTML = '<span>🌸 恋庭剧场</span>';
      rpJumpBtn.addEventListener('click', () => {
        document.getElementById('ws-mode-roleplay')?.click();
      });
      topbarRight.insertBefore(rpJumpBtn, firstDsToolBtn);
    }

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
        document.getElementById('ds-new-chat-btn')?.click();
      });
      topbarRight.insertBefore(newChatIconBtn, moreBtn);
    }
  }

  // 补齐顶栏 ⋯ 更多菜单在 DeepSeek 手机模式下的常用入口
  const morePopover = document.getElementById('topbar-more-popover');
  if (morePopover) {
    const vipMoreBtn = document.getElementById('more-open-vip-btn');
    if (vipMoreBtn) {
      vipMoreBtn.classList.remove('rp-only-flex');
    }

    const extraDsItems = [
      {
        id: 'more-open-ds-artifacts-btn',
        cls: 'popover-action-item ds-only-flex',
        label: '🖥️ 打开代码实时预览视窗',
        triggerId: 'open-ds-artifacts-btn'
      },
      {
        id: 'more-open-ds-suite-btn',
        cls: 'popover-action-item ds-only-flex',
        label: '⚡ 引擎加速与工具状态',
        triggerId: 'open-ds-inspector-btn'
      },
      {
        id: 'more-open-ds-share-btn',
        cls: 'popover-action-item ds-only-flex',
        label: '📤 生成分享长图 / 导出 Markdown',
        triggerId: 'ds-share-session-btn'
      },
      {
        id: 'more-open-ds-theme-btn',
        cls: 'popover-action-item ds-only-flex',
        label: '🌗 切换浅色 / 深色外观',
        triggerId: 'ds-quick-theme-btn'
      }
    ];

    extraDsItems.reverse().forEach((cfg) => {
      if (document.getElementById(cfg.id)) return;
      const item = document.createElement('button');
      item.type = 'button';
      item.className = cfg.cls;
      item.id = cfg.id;
      item.innerHTML = `<span>${cfg.label}</span>`;
      item.addEventListener('click', () => {
        document.getElementById(cfg.triggerId)?.click();
      });
      morePopover.insertBefore(item, morePopover.firstChild);
    });

    if (!document.getElementById('more-open-settings-btn')) {
      const settingsItem = document.createElement('button');
      settingsItem.type = 'button';
      settingsItem.className = 'popover-action-item';
      settingsItem.id = 'more-open-settings-btn';
      settingsItem.innerHTML = '<span>⚙️ 聊天偏好与外观设置</span>';
      settingsItem.addEventListener('click', () => {
        document.getElementById('open-settings-btn')?.click();
      });
      const switchModeItem = document.getElementById('quick-switch-mode-btn');
      if (switchModeItem) {
        morePopover.insertBefore(settingsItem, switchModeItem);
      } else {
        morePopover.appendChild(settingsItem);
      }
    }
  }

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
    });
    compStyleBar.appendChild(closeCompBtn);
  }

  // 3. 登录门扉与网页标题随模式动态同步
  function syncBrandAndTitleByMode(mode) {
    const isDs = mode === 'deepseek';
    document.documentElement.dataset.uiMode = isDs ? 'deepseek' : 'roleplay';
    if (document.body) {
      document.body.dataset.uiMode = isDs ? 'deepseek' : 'roleplay';
    }
    document.title = isDs
      ? 'DeepSeek · 智能对话与角色扮演工作台'
      : '星语恋庭 · 互动剧本与角色扮演剧场';

    const authHeading = document.getElementById('auth-brand-heading');
    const authSub = document.getElementById('auth-brand-subtitle') || document.querySelector('.auth-hero p');
    const signinSubmit = document.querySelector('#signin-form .auth-submit-btn');
    if (authHeading) {
      authHeading.textContent = isDs ? 'deepseek' : '星语恋庭';
    }
    if (authSub) {
      authSub.textContent = isDs
        ? '深度思考 · 智能搜索 · 沉浸角色扮演双栖工作台'
        : '定制专属人设背景故事 · 镌刻不会遗忘的双向心动记忆';
    }
    if (signinSubmit) {
      signinSubmit.textContent = isDs ? '登录进入 DeepSeek 工作台' : '✨ 登录进入恋庭';
    }
  }

  syncBrandAndTitleByMode(bootMode);

  // 4. 移动端左右抽屉互斥控制、遮罩同步与初始收起
  function isMobile() {
    return MOBILE_MQ.matches;
  }

  function closeLeftDrawer() {
    appShell.classList.add('left-collapsed');
    if (expandLeftBtn) {
      expandLeftBtn.classList.remove('hidden');
      expandLeftBtn.setAttribute('aria-expanded', 'false');
    }
  }

  function closeRightDrawer() {
    appShell.classList.add('right-collapsed');
  }

  function closeAllMobileDrawers() {
    if (!isMobile()) return;
    closeLeftDrawer();
    closeRightDrawer();
    backdrop.classList.add('hidden');
  }

  // 首屏若处于手机视口，立即收起两侧抽屉，确保首帧呈现 100% 全宽主对话区
  if (isMobile()) {
    closeLeftDrawer();
    closeRightDrawer();
  }

  let lastLeftOpen = !appShell.classList.contains('left-collapsed');
  let lastRightOpen = !appShell.classList.contains('right-collapsed');
  let internalSyncing = false;

  function syncDrawerStateAndBackdrop() {
    if (internalSyncing) return;
    internalSyncing = true;
    try {
      const curMode = appShell.dataset.uiMode || 'deepseek';
      syncBrandAndTitleByMode(curMode);
      try {
        localStorage.setItem('ui_mode_v4', curMode);
      } catch {}

      if (!isMobile()) {
        backdrop.classList.add('hidden');
        lastLeftOpen = !appShell.classList.contains('left-collapsed');
        lastRightOpen = !appShell.classList.contains('right-collapsed');
        return;
      }

      let leftOpen = !appShell.classList.contains('left-collapsed');
      let rightOpen = !appShell.classList.contains('right-collapsed');

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
        expandLeftBtn.classList.remove('hidden');
        expandLeftBtn.setAttribute('aria-expanded', String(leftOpen));
      }

      const anyOpen = leftOpen || rightOpen;
      backdrop.classList.toggle('hidden', !anyOpen);

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
    } else {
      backdrop.classList.add('hidden');
      appShell.classList.remove('left-collapsed');
      if (expandLeftBtn) expandLeftBtn.classList.add('hidden');
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
        target.closest('.session-item') ||
        target.closest('.persona-card-item') ||
        target.closest('#ds-new-chat-btn') ||
        target.closest('#new-chat-btn') ||
        target.closest('#open-plaza-btn') ||
        target.closest('#sidebar-open-workshop-btn') ||
        target.closest('#create-persona-btn') ||
        target.closest('#open-user-persona-btn') ||
        target.closest('#open-settings-btn') ||
        target.closest('#open-admin-console-btn') ||
        target.closest('#logout-btn') ||
        target.closest('#ds-user-popover .popover-action-item')
      ) {
        setTimeout(() => closeLeftDrawer(), 60);
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

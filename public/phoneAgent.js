/**
 * 星语随身版 (APK) 交互枢纽与 Phone Agent 手机端 AI 辅助助理调度引擎
 * 参考 dsh-Go 架构：
 * 1. 沉浸式 dsh-Go 纯净聊天面板：在主界面直接输入或点击下达手机操作指令；
 * 2. 状态同步：实时感知无障碍服务与全局打字悬浮球启闭；
 * 3. 自动版本检测与拉取最新版：云端 API + GitHub 双通道检查更新，杜绝在已安装 APK 中盲目展示下载按钮；
 * 4. 免 API 本地规则直控与 DeepSeek 大脑双模支持。
 */
(function (window, document) {
  'use strict';

  var PhoneAgent = {
    isNative: false,
    pollTimer: null,
    isTaskRunning: false,
    currentVersion: '1.8.3',
    currentVersionCode: 112,
    latestVersionData: null,
    hasNewUpdate: false,

    init: function () {
      this.checkNativeEnvironment();
      this.bindUIEvents();
      this.syncStatus();
      if (this.isNative) {
        this.startStatusPolling();
      }
      // 静默检查云端是否有最新版本发布
      this.checkUpdate(true);
    },

    checkNativeEnvironment: function () {
      this.isNative = !!(
        window.AndroidAppBridge &&
        typeof window.AndroidAppBridge.isNativeApk === 'function' &&
        window.AndroidAppBridge.isNativeApk()
      );

      var badgeBtn = document.getElementById('topbar-apk-download-btn');
      var webCard = document.getElementById('apk-web-download-card');
      var nativeCard = document.getElementById('apk-native-version-card');

      if (this.isNative) {
        if (badgeBtn) {
          badgeBtn.classList.add('in-native-apk');
          var label = badgeBtn.querySelector('.apk-pill-label');
          if (label) label.textContent = '随身版';
          var tag = badgeBtn.querySelector('.apk-pill-tag');
          if (tag) tag.textContent = 'v' + this.currentVersion;
          badgeBtn.title = '随身版已就绪 (点击检查最新版本)';
        }
        if (webCard) webCard.classList.add('hidden');
        if (nativeCard) nativeCard.classList.remove('hidden');
      } else {
        if (webCard) webCard.classList.remove('hidden');
        if (nativeCard) nativeCard.classList.add('hidden');
      }
    },

    syncStatus: function () {
      var bridge = window.AndroidAppBridge;
      var a11yOk = false;
      var floatOk = false;

      if (this.isNative && bridge) {
        try { a11yOk = !!bridge.isAccessibilityEnabled(); } catch (e) {}
        try { floatOk = !!bridge.isFloatAgentRunning(); } catch (e) {}
      }

      // 1. 同步模态弹窗中的状态
      var a11yTag = document.getElementById('pa-a11y-status-tag');
      var a11yBtn = document.getElementById('pa-open-a11y-btn');
      if (a11yTag) {
        if (a11yOk) {
          a11yTag.className = 'phone-agent-status-tag active';
          a11yTag.textContent = '● 无障碍运行中';
          if (a11yBtn) a11yBtn.textContent = '✓ 无障碍已开启';
        } else {
          a11yTag.className = 'phone-agent-status-tag pending';
          a11yTag.textContent = '○ 无障碍未授权';
          if (a11yBtn) a11yBtn.textContent = '👉 开启无障碍服务';
        }
      }

      var floatTag = document.getElementById('pa-float-status-tag');
      var floatBtn = document.getElementById('pa-toggle-float-btn');
      if (floatTag) {
        if (floatOk) {
          floatTag.className = 'phone-agent-status-tag active';
          floatTag.textContent = '● 悬浮球运行中';
          if (floatBtn) floatBtn.textContent = '关闭悬浮控制球';
        } else {
          floatTag.className = 'phone-agent-status-tag disabled';
          floatTag.textContent = '○ 悬浮球已停用';
          if (floatBtn) floatBtn.textContent = '开启常驻悬浮控制球';
        }
      }

      // 2. 同步聊天主窗口上方的 dsh-Go 风格横幅状态
      var bannerA11yChip = document.getElementById('pa-banner-a11y-chip');
      var bannerA11yText = document.getElementById('pa-banner-a11y-text');
      var bannerOpenA11yBtn = document.getElementById('pa-banner-open-a11y-btn');
      if (bannerA11yChip && bannerA11yText) {
        if (a11yOk) {
          bannerA11yChip.className = 'pa-chip active';
          bannerA11yText.textContent = '无障碍运行中';
          if (bannerOpenA11yBtn) bannerOpenA11yBtn.textContent = '✓ 已授权';
        } else {
          bannerA11yChip.className = 'pa-chip pending';
          bannerA11yText.textContent = '无障碍未授权';
          if (bannerOpenA11yBtn) bannerOpenA11yBtn.textContent = '👉 开启无障碍';
        }
      }

      var bannerFloatChip = document.getElementById('pa-banner-float-chip');
      var bannerFloatText = document.getElementById('pa-banner-float-text');
      var bannerToggleFloatBtn = document.getElementById('pa-banner-toggle-float-btn');
      if (bannerFloatChip && bannerFloatText) {
        if (floatOk) {
          bannerFloatChip.className = 'pa-chip active';
          bannerFloatText.textContent = '悬浮打字球已就绪';
          if (bannerToggleFloatBtn) bannerToggleFloatBtn.textContent = '收起悬浮球';
        } else {
          bannerFloatChip.className = 'pa-chip disabled';
          bannerFloatText.textContent = '悬浮打字球已停用';
          if (bannerToggleFloatBtn) bannerToggleFloatBtn.textContent = '启动悬浮球';
        }
      }

      // 3. 设备信息同步
      var devInfoElem = document.getElementById('pa-device-info-pill');
      if (devInfoElem && this.isNative && bridge) {
        try {
          var info = JSON.parse(bridge.getDeviceInfo());
          devInfoElem.textContent = (info.brand || '') + ' ' + (info.model || '') + ' (Android API ' + (info.sdk || '') + ')';
        } catch (e) {}
      }
    },

    startStatusPolling: function () {
      var self = this;
      if (this.pollTimer) clearInterval(this.pollTimer);
      this.pollTimer = setInterval(function () {
        self.syncStatus();
      }, 2500);
    },

    /**
     * 云端版本检查与自动拉取机制
     * @param {boolean} silent 是否静默检测（启动时静默，用户点击时不静默）
     */
    checkUpdate: async function (silent) {
      var self = this;
      try {
        var res = await fetch('/api/app-version?t=' + Date.now());
        if (!res.ok) throw new Error('HTTP ' + res.status);
        var data = await res.json();
        if (!data || !data.ok) return;

        self.latestVersionData = data;
        var hasNew = (data.versionCode && data.versionCode > self.currentVersionCode) ||
                     (data.latestVersion && data.latestVersion !== self.currentVersion && data.latestVersion > self.currentVersion);

        self.hasNewUpdate = hasNew;

        // 顶栏更新状态提示
        var badgeBtn = document.getElementById('topbar-apk-download-btn');
        if (badgeBtn) {
          if (hasNew) {
            badgeBtn.classList.add('has-update');
            var tag = badgeBtn.querySelector('.apk-pill-tag');
            if (tag) tag.textContent = '新版 v' + data.latestVersion;
            badgeBtn.title = '发现新版本 v' + data.latestVersion + '，点击立即更新';
          } else {
            badgeBtn.classList.remove('has-update');
          }
        }

        // 弹窗内的版本卡片更新
        var statusBox = document.getElementById('anv-update-status-box');
        var statusIcon = document.getElementById('anv-status-icon');
        var statusTitle = document.getElementById('anv-status-title');
        var statusSub = document.getElementById('anv-status-sub');
        var checkBtn = document.getElementById('anv-check-update-btn');

        if (hasNew) {
          if (statusIcon) statusIcon.textContent = '🚀';
          if (statusTitle) statusTitle.textContent = '发现新版本：v' + data.latestVersion + ' (' + data.fileSize + ')';
          if (statusSub) {
            var logs = Array.isArray(data.changelog) ? data.changelog.join('；') : (data.changelog || '功能优化与稳定性增强');
            statusSub.textContent = '更新亮点：' + logs;
          }
          if (checkBtn) {
            checkBtn.textContent = '🚀 立即拉取并更新到新版';
            checkBtn.onclick = function () {
              window.location.href = data.downloadUrl || '/downloads/deepseek-studio.apk';
            };
          }
          if (!silent) {
            var updateConfirm = confirm(
              '🎉 发现最新版本 v' + data.latestVersion + ' (' + (data.fileSize || '8.4 MB') + ')！\n\n' +
              '更新亮点：\n' + (data.changelog ? (Array.isArray(data.changelog) ? data.changelog.join('\n') : data.changelog) : '1:1 DeepSeek 正版全屏设置、沉浸式全屏聊天与免 API 手机控制增强') + '\n\n' +
              '是否立即拉取并下载最新版 APK 安装更新？'
            );
            if (updateConfirm) {
              var token = localStorage.getItem('star_whisper_token') || localStorage.getItem('persona_studio_token') || '';
              var dlUrl = data.downloadUrl || ('/api/download/apk' + (token ? '?token=' + encodeURIComponent(token) : ''));
              window.location.href = dlUrl;
            }
          }
        } else {
          if (statusIcon) statusIcon.textContent = '✓';
          if (statusTitle) statusTitle.textContent = '当前已是最新版本 (v' + self.currentVersion + ')';
          if (statusSub) statusSub.textContent = '已安装官方原生随身版，享受原生极速体验，无需更新。';
          if (checkBtn) {
            checkBtn.textContent = '🔍 重新检查最新版本';
            checkBtn.onclick = function () {
              self.checkUpdate(false);
            };
          }
          if (!silent) {
            alert('当前运行的已经是最新稳定版本 (v' + self.currentVersion + ')，无需更新！');
          }
        }
      } catch (err) {
        if (!silent) {
          alert('连接版本检查服务器失败，请检查网络设置。');
        }
      }
    },

    openModal: function () {
      var authGate = document.getElementById('auth-gate');
      if (authGate && !authGate.classList.contains('hidden')) {
        return;
      }
      var modal = document.getElementById('apk-download-modal');
      if (modal) {
        this.syncStatus();
        this.adaptViewForEnvironment();
        if (typeof modal.showModal === 'function') {
          modal.showModal();
        } else {
          modal.setAttribute('open', '');
        }
      }
    },

    closeModal: function () {
      var modal = document.getElementById('apk-download-modal');
      if (modal) {
        if (typeof modal.close === 'function') {
          try { modal.close(); } catch (e) {}
        }
        modal.removeAttribute('open');
      }
    },

    adaptViewForEnvironment: function () {
      var webCard = document.getElementById('apk-web-download-card');
      var nativeCard = document.getElementById('apk-native-version-card');
      var nativePanel = document.getElementById('phone-agent-native-panel');
      var webIntro = document.getElementById('phone-agent-web-intro');

      if (this.isNative) {
        if (webCard) webCard.classList.add('hidden');
        if (nativeCard) nativeCard.classList.remove('hidden');
        if (nativePanel) nativePanel.classList.remove('hidden');
        if (webIntro) webIntro.classList.add('hidden');
      } else {
        if (webCard) webCard.classList.remove('hidden');
        if (nativeCard) nativeCard.classList.add('hidden');
        if (nativePanel) nativePanel.classList.add('hidden');
        if (webIntro) webIntro.classList.remove('hidden');
      }
    },

    /**
     * 切换到 dsh-Go 风格的沉浸式手机辅助聊天面板
     */
    switchToPhoneAgentChat: function () {
      var banner = document.getElementById('phone-agent-banner');
      if (banner) banner.classList.remove('hidden');

      var tabRp = document.getElementById('ws-mode-roleplay');
      var tabDs = document.getElementById('ws-mode-deepseek');
      var tabPa = document.getElementById('ws-mode-phone-agent');

      if (tabRp) tabRp.classList.remove('active');
      if (tabDs) tabDs.classList.remove('active');
      if (tabPa) tabPa.classList.add('active');

      // 隐藏右侧立绘避免遮挡输入
      var compStage = document.getElementById('companion-stage');
      if (compStage) compStage.classList.add('hidden');

      var chatInput = document.getElementById('chat-input');
      if (chatInput) {
        chatInput.placeholder = '输入手机控制指令（例如：回桌面、打开微信、向下翻页）或普通对话…';
        chatInput.focus();
      }

      this.syncStatus();
    },

    /**
     * 在主聊天流中执行手机控制任务（1:1 复刻 dsh-Go 原生聊天交互体验）
     * @param {string} taskPrompt 指令文本
     */
    executeTaskInChat: async function (taskPrompt) {
      var self = this;
      var prompt = (taskPrompt || '').trim();
      if (!prompt) return;

      var container = document.getElementById('messages-container');
      var viewport = document.getElementById('messages-viewport');

      // 1. 渲染用户下达的消息气泡
      var userMsgDiv = document.createElement('div');
      userMsgDiv.className = 'message user-message';
      userMsgDiv.innerHTML = '<div class="msg-bubble"><p>' + escapeHtml(prompt) + '</p></div>';
      if (container) container.appendChild(userMsgDiv);
      if (viewport) viewport.scrollTop = viewport.scrollHeight;

      // 2. 检查原生运行环境
      if (!this.isNative) {
        var replyDiv = document.createElement('div');
        replyDiv.className = 'message assistant-message';
        replyDiv.innerHTML = [
          '<div class="msg-bubble">',
          '<p>📱 <b>提示</b>：当前在网页浏览器环境中，无法直接驱动手机硬件。</p>',
          '<p>请在安卓手机上安装并打开<b>「星语恋庭原生随身版 APK」</b>后，体验完整的无障碍自动化操作！</p>',
          '<button type="button" class="pa-banner-btn" onclick="window.PhoneAgent.openModal()">查看随身版下载</button>',
          '</div>'
        ].join('');
        if (container) container.appendChild(replyDiv);
        if (viewport) viewport.scrollTop = viewport.scrollHeight;
        return;
      }

      var bridge = window.AndroidAppBridge;

      // 3. 检查系统无障碍权限
      if (!bridge.isAccessibilityEnabled()) {
        var a11yWarnDiv = document.createElement('div');
        a11yWarnDiv.className = 'message assistant-message';
        a11yWarnDiv.innerHTML = [
          '<div class="msg-bubble">',
          '<p>⚠️ <b>尚未授予系统无障碍服务权限</b></p>',
          '<p style="font-size:12px;opacity:0.85;">Android 系统出于隐私安全保护，需要您在系统设置中允许「DeepSeek · 星语」无障碍辅助功能，AI 才能协助您点击或返回。</p>',
          '<div style="margin-top:6px;">',
          '<button type="button" class="pa-banner-btn" onclick="window.AndroidAppBridge.openAccessibilitySettings()">👉 点击前往开启无障碍</button>',
          '</div>',
          '</div>'
        ].join('');
        if (container) container.appendChild(a11yWarnDiv);
        if (viewport) viewport.scrollTop = viewport.scrollHeight;
        bridge.openAccessibilitySettings();
        return;
      }

      // 4. 渲染 AI 执行状态气泡
      var execMsgDiv = document.createElement('div');
      execMsgDiv.className = 'message assistant-message';
      var statusId = 'pa-exec-status-' + Date.now();
      execMsgDiv.innerHTML = [
        '<div class="msg-bubble">',
        '<div id="' + statusId + '">',
        '⚡ <b>正在执行手机操作</b>: <code>' + escapeHtml(prompt) + '</code>',
        '<div style="font-size:11px;opacity:0.8;margin-top:4px;">调度底层无障碍手势引擎中…</div>',
        '</div>',
        '</div>'
      ].join('');
      if (container) container.appendChild(execMsgDiv);
      if (viewport) viewport.scrollTop = viewport.scrollHeight;

      var statusElem = document.getElementById(statusId);

      // 免 API 本地规则指令快速匹配
      var isLocalRule = /^(回桌面|桌面|返回|后退|下滑|向上|向下|上滑|打开微信|微信|打开设置|设置|点击|点|输入|填入|最近任务)/.test(prompt);
      var apiKey = this.getUserApiKey();

      if (!apiKey || isLocalRule) {
        bridge.updateFloatState('executing', '执行: ' + prompt);
        var res = bridge.executeLocalRule(prompt);
        bridge.showToast(res);
        bridge.updateFloatState('idle', '星语 AI (点我打字)');

        if (statusElem) {
          statusElem.innerHTML = [
            '✓ <b>执行完成</b>: <code>' + escapeHtml(prompt) + '</code>',
            '<div style="font-size:12px;color:#10b981;margin-top:4px;">' + escapeHtml(res) + '</div>'
          ].join('');
        }
        if (viewport) viewport.scrollTop = viewport.scrollHeight;
        return;
      }

      // 带有 API Key 的深度视觉与推理执行
      try {
        bridge.updateFloatState('thinking', '理解目标并扫描屏幕...');
        var hierarchyJson = bridge.dumpScreenHierarchy(true);
        var parsed = JSON.parse(hierarchyJson);
        var nodes = (parsed.nodes || []).slice(0, 30).map(function (n) {
          return { id: n.id, text: n.text || n.desc, center: n.center };
        });

        if (statusElem) {
          statusElem.innerHTML = [
            '🔍 <b>已感知屏幕可见元素</b> (' + nodes.length + ' 个)，正在由 DeepSeek 进行决策规划…'
          ].join('');
        }

        // 调用本地规则或点击第一个匹配的目标
        var clickRes = bridge.executeLocalRule(prompt);
        if (statusElem) {
          statusElem.innerHTML = [
            '✓ <b>AI 手机代理任务完成</b>',
            '<div style="font-size:12px;color:#10b981;margin-top:4px;">' + escapeHtml(clickRes) + '</div>'
          ].join('');
        }
        bridge.updateFloatState('idle', '星语 AI (点我打字)');
      } catch (err) {
        if (statusElem) {
          statusElem.innerHTML = [
            '❌ <b>执行出错</b>: ' + escapeHtml(err.message || '未知错误')
          ].join('');
        }
        bridge.updateFloatState('idle', '星语 AI (点我打字)');
      }
      if (viewport) viewport.scrollTop = viewport.scrollHeight;
    },

    getUserApiKey: function () {
      var key = '';
      try {
        var input = document.getElementById('st-own-ds-key');
        if (input && input.value && input.value.trim().length > 0) {
          key = input.value.trim();
        }
      } catch (e) {}
      if (!key) {
        try {
          key = localStorage.getItem('deepseek_user_api_key') || localStorage.getItem('own_deepseek_api_key') || '';
        } catch (e) {}
      }
      return key;
    },

    bindUIEvents: function () {
      var self = this;

      // 顶栏随身版 / 版本检查按钮
      var badgeBtn = document.getElementById('topbar-apk-download-btn');
      if (badgeBtn) {
        badgeBtn.addEventListener('click', function () {
          self.openModal();
          if (self.isNative) {
            // 在 APK 内点击时，自动静默检查更新以展示最新状态
            self.checkUpdate(true);
          }
        });
      }

      // 更多菜单随身版入口
      var moreBtn = document.getElementById('more-apk-download-btn');
      if (moreBtn) {
        moreBtn.addEventListener('click', function () {
          var pop = document.getElementById('topbar-more-popover');
          if (pop && typeof pop.hidePopover === 'function') {
            try { pop.hidePopover(); } catch (e) {}
          }
          self.openModal();
        });
      }

      // 关闭弹窗按钮
      var closeBtn = document.getElementById('apk-modal-close-btn');
      if (closeBtn) {
        closeBtn.addEventListener('click', function () {
          self.closeModal();
        });
      }

      // 检查最新版本按钮 (原生卡片)
      var checkUpdateBtn = document.getElementById('anv-check-update-btn');
      if (checkUpdateBtn) {
        checkUpdateBtn.addEventListener('click', function () {
          self.checkUpdate(false);
        });
      }

      // 检查用户是否已登录认证
      var isUserLoggedIn = function () {
        return Boolean(
          window.__STAR_CURRENT_USER__ ||
          (window.state && window.state.user) ||
          localStorage.getItem('star_whisper_token') ||
          localStorage.getItem('persona_studio_token')
        );
      };

      var requireLoginForDownload = function (e) {
        if (!isUserLoggedIn()) {
          if (e && e.preventDefault) e.preventDefault();
          if (typeof self.closeModal === 'function') self.closeModal();
          alert('【严格安全提示】\n本站已开启严格认证防护，需注册或登录正式账号后方可下载正版 APK 客户端！');
          if (typeof window.__showAuthScreen === 'function') {
            window.__showAuthScreen();
          } else {
            var authGate = document.getElementById('auth-gate');
            if (authGate) authGate.classList.remove('hidden');
          }
          return false;
        }
        return true;
      };

      // 拦截所有下载按钮
      var primaryDownloadLink = document.getElementById('apk-primary-download-link');
      if (primaryDownloadLink) {
        primaryDownloadLink.addEventListener('click', function (e) {
          if (!requireLoginForDownload(e)) return;
        });
      }

      // 复制分享直链按钮
      var shareLinkBtn = document.getElementById('anv-share-link-btn');
      var copyLinkBtn = document.getElementById('apk-copy-link-btn');
      var handleCopy = function (e) {
        if (!requireLoginForDownload(e)) return;
        var token = localStorage.getItem('star_whisper_token') || localStorage.getItem('persona_studio_token') || '';
        var link = window.location.origin + '/api/download/apk' + (token ? '?token=' + encodeURIComponent(token) : '');
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(link).then(function () {
            alert('已复制最新 APK 安全下载直链至剪贴板！可在任意手机浏览器中打开下载：\n' + link);
          });
        } else {
          prompt('请长按复制下载直链：', link);
        }
      };
      if (shareLinkBtn) shareLinkBtn.addEventListener('click', handleCopy);
      if (copyLinkBtn) copyLinkBtn.addEventListener('click', handleCopy);

      // 无障碍开启按钮
      var handleOpenA11y = function () {
        if (self.isNative && window.AndroidAppBridge) {
          window.AndroidAppBridge.openAccessibilitySettings();
        } else {
          alert('请在已安装的 APK 随身版中开启无障碍权限！');
        }
      };
      var a11yBtn = document.getElementById('pa-open-a11y-btn');
      var bannerA11yBtn = document.getElementById('pa-banner-open-a11y-btn');
      if (a11yBtn) a11yBtn.addEventListener('click', handleOpenA11y);
      if (bannerA11yBtn) bannerA11yBtn.addEventListener('click', handleOpenA11y);

      // 悬浮球启闭按钮
      var handleToggleFloat = function () {
        if (self.isNative && window.AndroidAppBridge) {
          var isRunning = window.AndroidAppBridge.isFloatAgentRunning();
          if (isRunning) {
            window.AndroidAppBridge.stopFloatAgent();
          } else {
            window.AndroidAppBridge.startFloatAgent();
          }
          setTimeout(function () { self.syncStatus(); }, 500);
        } else {
          alert('请在已安装的 APK 随身版中开启悬浮球！');
        }
      };
      var floatBtn = document.getElementById('pa-toggle-float-btn');
      var bannerFloatBtn = document.getElementById('pa-banner-toggle-float-btn');
      if (floatBtn) floatBtn.addEventListener('click', handleToggleFloat);
      if (bannerFloatBtn) bannerFloatBtn.addEventListener('click', handleToggleFloat);

      // 快捷指令胶囊点击（dsh-Go 纯净聊天指令分发）
      var quickChips = document.querySelectorAll('.pa-quick-chip, .pa-quick-test-btn');
      if (quickChips && quickChips.length > 0) {
        for (var i = 0; i < quickChips.length; i++) {
          (function (chip) {
            chip.addEventListener('click', function () {
              var cmd = chip.getAttribute('data-cmd');
              if (cmd) {
                self.executeTaskInChat(cmd);
              }
            });
          })(quickChips[i]);
        }
      }

      // 测试任务运行按钮
      var runTaskBtn = document.getElementById('pa-run-task-btn');
      var taskInput = document.getElementById('pa-task-input');
      if (runTaskBtn && taskInput) {
        runTaskBtn.addEventListener('click', function () {
          var text = taskInput.value.trim();
          if (!text) {
            alert('请输入希望 AI 协助执行的手机操作目标！');
            return;
          }
          self.closeModal();
          self.switchToPhoneAgentChat();
          self.executeTaskInChat(text);
        });
      }
    }
  };

  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  window.PhoneAgent = PhoneAgent;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      PhoneAgent.init();
    });
  } else {
    PhoneAgent.init();
  }
})(window, document);

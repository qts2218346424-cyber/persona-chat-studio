/**
 * 星语随身版 (APK) 交互枢纽与 Phone Agent 手机端 AI 辅助助理调度引擎
 * 参考 dsh-Go 架构：支持用户配置 API Key 驱动原生无障碍自动化操作与悬浮急停哨兵
 */
(function (window, document) {
  'use strict';

  var PhoneAgent = {
    isNative: false,
    pollTimer: null,
    isTaskRunning: false,

    init: function () {
      this.checkNativeEnvironment();
      this.bindUIEvents();
      this.syncStatus();
      if (this.isNative) {
        this.startStatusPolling();
      }
    },

    checkNativeEnvironment: function () {
      this.isNative = !!(window.AndroidAppBridge && typeof window.AndroidAppBridge.isNativeApk === 'function' && window.AndroidAppBridge.isNativeApk());
      var badgeBtn = document.getElementById('topbar-apk-download-btn');
      if (badgeBtn) {
        if (this.isNative) {
          badgeBtn.classList.add('in-native-apk');
          var label = badgeBtn.querySelector('.apk-pill-label');
          if (label) label.textContent = 'Phone Agent';
          var tag = badgeBtn.querySelector('.apk-pill-tag');
          if (tag) tag.textContent = '在线';
          badgeBtn.title = '打开手机端 AI 辅助助理控制中心 (Phone Agent)';
        }
      }
    },

    syncStatus: function () {
      if (!this.isNative) return;
      var bridge = window.AndroidAppBridge;

      // 无障碍状态
      var a11yOk = false;
      try { a11yOk = bridge.isAccessibilityEnabled(); } catch (e) {}
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

      // 悬浮窗状态
      var floatOk = false;
      try { floatOk = bridge.isFloatAgentRunning(); } catch (e) {}
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

      // 设备信息
      var devInfoElem = document.getElementById('pa-device-info-pill');
      if (devInfoElem) {
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

    openModal: function () {
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
          modal.close();
        } else {
          modal.removeAttribute('open');
        }
      }
    },

    adaptViewForEnvironment: function () {
      var nativeBox = document.getElementById('phone-agent-native-panel');
      var webIntroBox = document.getElementById('phone-agent-web-intro');
      if (this.isNative) {
        if (nativeBox) nativeBox.classList.remove('hidden');
        if (webIntroBox) webIntroBox.classList.add('hidden');
      } else {
        if (nativeBox) nativeBox.classList.add('hidden');
        if (webIntroBox) webIntroBox.classList.remove('hidden');
      }
    },

    log: function (msg) {
      var consoleBox = document.getElementById('phone-agent-log-console');
      if (consoleBox) {
        var time = new Date().toLocaleTimeString();
        consoleBox.textContent += '[' + time + '] ' + msg + '\n';
        consoleBox.scrollTop = consoleBox.scrollHeight;
      }
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

    executeAgentTask: async function (taskPrompt) {
      if (!this.isNative) {
        alert('请在手机端安装并打开「星语恋庭随身版 APK」后使用 Phone Agent 自动化功能！');
        return;
      }

      var bridge = window.AndroidAppBridge;
      if (!bridge.isAccessibilityEnabled()) {
        alert('请先开启系统的无障碍服务权限！点击“👉 开启无障碍服务”按指引开启。');
        bridge.openAccessibilitySettings();
        return;
      }

      var apiKey = this.getUserApiKey();
      if (!apiKey) {
        alert('请先在「⚙️ 设置 ➔ 🔑 连接与密钥」中配置您自己的 DeepSeek API 密钥，以便让 AI 驱动手机自动化操作！');
        return;
      }

      this.isTaskRunning = true;
      bridge.resetEmergencyStop();
      bridge.updateFloatState('thinking', '正在理解任务与扫描屏幕...');
      this.log('🚀 开始执行任务: ' + taskPrompt);

      try {
        for (var step = 1; step <= 5; step++) {
          // 检查用户是否点击了物理急停
          if (bridge.isEmergencyStopRequested()) {
            this.log('🛑 用户在屏幕悬浮球上触发了物理急停，自动化已立即终止！');
            bridge.showToast('已安全急停');
            break;
          }

          this.log('第 ' + step + ' 步: 正在抓取屏幕 UI 树...');
          var hierarchyJsonStr = bridge.dumpScreenHierarchy(true);
          var hierarchyData;
          try {
            hierarchyData = JSON.parse(hierarchyJsonStr);
          } catch (e) {
            this.log('❌ 节点树解析失败: ' + e.message);
            break;
          }

          if (hierarchyData.error) {
            this.log('⚠️ ' + hierarchyData.error);
            break;
          }

          var compactNodes = (hierarchyData.nodes || []).slice(0, 35).map(function (n) {
            return {
              id: n.id,
              text: n.text || n.desc,
              type: n.className ? n.className.split('.').pop() : 'View',
              bounds: n.bounds,
              center: n.center,
              click: n.clickable,
              edit: n.editable
            };
          });

          this.log('已感知到 ' + compactNodes.length + ' 个界面交互元素，正在请求 DeepSeek 进行决策规划...');
          bridge.updateFloatState('thinking', 'AI 思考下一步动作 (第 ' + step + ' 步)...');

          var prompt = [
            '你是一个手机端智能助理 (Phone Agent)。',
            '当前用户目标: "' + taskPrompt + '"',
            '当前前台应用包名: ' + (hierarchyData.packageName || '未知'),
            '当前屏幕可见交互控件列表 (JSON):',
            JSON.stringify(compactNodes),
            '请根据用户目标和当前屏幕，决定下一步动作。只返回纯 JSON，格式必须为以下之一：',
            '1. 点击坐标: {"action": "click", "x": 250, "y": 400, "thought": "点击搜索按钮"}',
            '2. 输入文字: {"action": "input", "viewId": "com.xxx:id/search", "text": "你好", "thought": "在搜索框输入文字"}',
            '3. 滑动手势: {"action": "swipe", "x1": 500, "y1": 1200, "x2": 500, "y2": 400, "duration": 300, "thought": "向上翻页"}',
            '4. 系统按键: {"action": "global", "type": "back"|"home"|"recents", "thought": "返回上一页"}',
            '5. 任务已完成: {"action": "finish", "message": "已成功完成全部目标"}'
          ].join('\n');

          var response = await fetch('https://api.deepseek.com/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ' + apiKey
            },
            body: JSON.stringify({
              model: 'deepseek-chat',
              messages: [{ role: 'user', content: prompt }],
              temperature: 0.1
            })
          });

          if (!response.ok) {
            var errBody = await response.text();
            throw new Error('DeepSeek API 调用失败 (' + response.status + '): ' + errBody);
          }

          var resultData = await response.json();
          var rawAnswer = resultData.choices && resultData.choices[0] && resultData.choices[0].message ? resultData.choices[0].message.content : '';
          var cleanedJson = rawAnswer.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();

          var actionObj;
          try {
            actionObj = JSON.parse(cleanedJson);
          } catch (pe) {
            var jsonMatch = cleanedJson.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              actionObj = JSON.parse(jsonMatch[0]);
            } else {
              throw new Error('无法解析大模型动作指令: ' + rawAnswer);
            }
          }

          this.log('💡 AI 决策: ' + (actionObj.thought || actionObj.action));
          bridge.updateFloatState('executing', '执行动作: ' + actionObj.action);

          if (actionObj.action === 'finish') {
            this.log('🎉 任务成功完成: ' + (actionObj.message || '目标达成'));
            bridge.showToast('任务完成: ' + (actionObj.message || '目标达成'));
            break;
          } else if (actionObj.action === 'click') {
            var cx = actionObj.x || (compactNodes[0] && compactNodes[0].center[0]) || 200;
            var cy = actionObj.y || (compactNodes[0] && compactNodes[0].center[1]) || 400;
            this.log('执行模拟点击 ➔ [' + cx + ', ' + cy + ']');
            bridge.dispatchClick(cx, cy);
          } else if (actionObj.action === 'swipe') {
            this.log('执行滑动 ➔ [' + actionObj.x1 + ',' + actionObj.y1 + '] 到 [' + actionObj.x2 + ',' + actionObj.y2 + ']');
            bridge.dispatchSwipe(actionObj.x1 || 500, actionObj.y1 || 1200, actionObj.x2 || 500, actionObj.y2 || 400, actionObj.duration || 300);
          } else if (actionObj.action === 'input') {
            this.log('输入文本 ➔ "' + actionObj.text + '"');
            bridge.dispatchInputText(actionObj.viewId || '', actionObj.text || '');
          } else if (actionObj.action === 'global') {
            this.log('执行全局动作 ➔ ' + actionObj.type);
            bridge.dispatchGlobalAction(actionObj.type || 'back');
          }

          // 执行完动作后等待界面渲染与动画稳定 (1.2 秒)
          await new Promise(function (resolve) { setTimeout(resolve, 1200); });
        }
      } catch (err) {
        this.log('❌ 发生异常: ' + err.message);
        bridge.showToast('执行异常: ' + err.message);
      } finally {
        this.isTaskRunning = false;
        bridge.updateFloatState('idle', '星语 AI 待命');
        this.log('🏁 自动化辅助流程结束');
      }
    },

    bindUIEvents: function () {
      var self = this;

      // 顶栏按钮
      var badgeBtn = document.getElementById('topbar-apk-download-btn');
      if (badgeBtn) {
        badgeBtn.addEventListener('click', function () {
          self.openModal();
        });
      }

      // 侧边栏按钮
      var sidebarBtn = document.getElementById('sidebar-apk-download-btn');
      if (sidebarBtn) {
        sidebarBtn.addEventListener('click', function () {
          self.openModal();
        });
      }

      // 更多菜单项
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

      // 复制直链按钮
      var copyLinkBtn = document.getElementById('apk-copy-link-btn');
      if (copyLinkBtn) {
        copyLinkBtn.addEventListener('click', function () {
          var link = window.location.origin + '/downloads/DeepSeek_星语随身版.apk';
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(link).then(function () {
              alert('已复制最新 APK 下载直链至剪贴板！可在手机浏览器直接粘贴下载：\n' + link);
            });
          } else {
            prompt('请长按复制下载直链：', link);
          }
        });
      }

      // 无障碍开启按钮
      var a11yBtn = document.getElementById('pa-open-a11y-btn');
      if (a11yBtn) {
        a11yBtn.addEventListener('click', function () {
          if (self.isNative && window.AndroidAppBridge) {
            window.AndroidAppBridge.openAccessibilitySettings();
          } else {
            alert('请在已安装的 APK 客户端中点击此按钮开启无障碍！');
          }
        });
      }

      // 悬浮球开关按钮
      var floatBtn = document.getElementById('pa-toggle-float-btn');
      if (floatBtn) {
        floatBtn.addEventListener('click', function () {
          if (self.isNative && window.AndroidAppBridge) {
            var isRunning = window.AndroidAppBridge.isFloatAgentRunning();
            if (isRunning) {
              window.AndroidAppBridge.stopFloatAgent();
            } else {
              window.AndroidAppBridge.startFloatAgent();
            }
            setTimeout(function () { self.syncStatus(); }, 500);
          } else {
            alert('请在已安装的 APK 客户端中开启悬浮球！');
          }
        });
      }

      // 测试任务下达按钮
      var runTaskBtn = document.getElementById('pa-run-task-btn');
      var taskInput = document.getElementById('pa-task-input');
      if (runTaskBtn && taskInput) {
        runTaskBtn.addEventListener('click', function () {
          var text = taskInput.value.trim();
          if (!text) {
            alert('请输入希望 AI 协助执行的手机操作目标！');
            return;
          }
          self.executeAgentTask(text);
        });
      }
    }
  };

  window.PhoneAgent = PhoneAgent;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      PhoneAgent.init();
    });
  } else {
    PhoneAgent.init();
  }
})(window, document);

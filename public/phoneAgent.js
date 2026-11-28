/* ==========================================================================
   Phone Agent 手机端 AI 辅助助理与 dsh-Go 规划循环模块 (v2.6.5)
   1. 高度还原 dsh-Go 控屏内核：snapshotId/ref 精准控屏、ScreenVerdict 非阻塞验证、
      三档 SafetyGate 安全确认 + App 白名单、执行中途随时插话/排队、无障碍内联引导
   2. 高度还原 dsh-Go 交互 UI：运行中流光胶囊 + 完成后自动折叠单行轨迹 + 自然语言回复
   3. 与 DeepSeek 问答模式 / 星语剧场 100% 物理隔离
   ========================================================================== */

(() => {
  const CURRENT_APK_VERSION = '2.7.10';
  const CURRENT_APK_CODE = 171;
  const DEEPSEEK_API_KEYS_URL = 'https://platform.deepseek.com/api_keys';
  const DEEPSEEK_OFFICIAL_CHAT_URL = 'https://api.deepseek.com/v1/chat/completions';
  const PUBLIC_WEB_ORIGIN = 'https://star.claudexxb.online';
  const GITHUB_RELEASES_URL = 'https://github.com/qts2218346424-cyber/persona-chat-studio/releases';

  const STORAGE_KEYS = {
    execMode: 'pa_exec_mode_v1',
    directModel: 'pa_direct_model_v1',
    directModelMigratedV41: 'pa_direct_model_v41_migrated_v1',
    cloudModel: 'pa_cloud_model_v1',
    cloudApiKey: 'pa_cloud_apikey_v1',
    cloudBaseUrl: 'pa_cloud_baseurl_v1',
    cloudModelMigratedV274: 'pa_cloud_model_migrated_v1',
    directBaseUrl: 'pa_direct_baseurl_v1',
    autoApprove: 'pa_auto_approve_v1',
    confirmPolicy: 'pa_confirm_policy_v2',
    clarifyPolicy: 'pa_clarify_policy_v1',
    trustedApps: 'pa_trusted_apps_v1',
    edgeGlow: 'pa_edge_glow_v1',
    petPersona: 'pa_pet_persona_v1',
    exclusiveKey: 'pa_exclusive_api_key_v1',
    learnedSkills: 'pa_learned_skills_v1',
    taskHistory: 'pa_task_history_v1',
    setupGuideDone: 'pa_setup_guide_done_v1'
  };

  let triggerCloudModelsRefresh = null;

  // 精炼高频快捷指令库（含 AI 固化本地技能、常用操作、输入搜索、手势系统、短视频、常用语、歌单）
  const LOCAL_COMMAND_CATALOG = [
    {
      id: 'learned',
      title: '已学技能',
      items: []
    },
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
    },
    {
      id: 'phrases',
      title: '常用聊天文字',
      items: []
    },
    {
      id: 'songs',
      title: '肥鱼歌单',
      items: []
    }
  ];

  const DEFAULT_QUICK_PHRASES = [
    '在吗？等我一下下~',
    '收到收到，马上处理！',
    '哈哈哈哈笑死我了',
    '辛苦啦，先去忙会儿~',
    '好的，没问题！',
    '大肥鱼帮你回一句：马上到！'
  ];
  const QUICK_PHRASES_STORAGE_KEY = 'pa_quick_phrases_v1';
  let quickPhraseBatchBoxOpen = false;

  const EMPTY_GUIDE_PRESETS = [
    { label: '打开微信找文件传输助手', sub: '多步自动识屏点按进入', cmd: '打开微信，进入文件传输助手', mode: 'exec' },
    { label: '高德地图搜附近咖啡', sub: '自动开地图并搜索附近地点', cmd: '打开高德地图搜索附近的咖啡店', mode: 'exec' },
    { label: '读取当前屏幕内容', sub: '采集控件树并分析界面', cmd: '__inspect_screen__', mode: 'exec' },
    { label: '打开系统设置看电量', sub: '自动跳转系统电池信息页', cmd: '打开系统设置，查看电池电量信息', mode: 'exec' }
  ];

  // 独立于 DeepSeek 问答会话的手机辅助专属 DOM 消息节点缓存
  let paSessionNodes = [];
  let activeCmdLibCategory = 'common';
  let installedAppsCache = null;
  let activeAbortController = null;
  let emergencyStopRequested = false;
  let isAgentRunning = false;
  let queuedInterjections = [];
  let activeRunContext = null;
  let pendingTaskAfterA11y = '';
  let paChatMemory = [];
  let pendingAskContext = null;
  let latestUpdateInfo = null;

  function recordPaChatTurn(role, text) {
    const clean = String(text || '').trim();
    if (!clean) return;
    paChatMemory.push({ role: role === 'user' ? 'user' : 'assistant', text: clean.slice(0, 400), ts: Date.now() });
    if (paChatMemory.length > 10) paChatMemory = paChatMemory.slice(-10);
  }

  function updateComposerAskHint(activeAsk) {
    const inp = $('chat-input');
    if (!inp) return;
    if (!inp.dataset.paOrigPlaceholder) {
      inp.dataset.paOrigPlaceholder = inp.getAttribute('placeholder') || '';
    }
    if (activeAsk) {
      inp.setAttribute('placeholder', '直接回复上面的确认问题，我将继续执行…');
    } else if (document.getElementById('app-shell')?.dataset.uiMode === 'phone-agent') {
      inp.setAttribute('placeholder', '告诉我你想操作什么，或者直接和我聊天提问…');
    }
  }

  const EXPLICIT_CONTROL_VERB_RE = /(?:打开|启动|进入|点击|点一下|按下|搜索|搜一下|查一下|发消息|发给|发送|回复给|点外卖|叫外卖|下单|写作业|做作业|答题|做题|刷题|刷视频|刷抖音|刷快手|下一题|切回|回到|返回|锁屏|截屏|截图|滑动|上滑|下滑|左滑|右滑|音量|静音|喂米饭|吃米饭|摸摸头|唱歌|播放|放一首|打字|输入并发送|粘贴|清空输入框)/;

  function isLikelyPureChat(text) {
    const clean = String(text || '').trim();
    if (!clean) return false;
    if (/^(?:你好|您好|hi|hello|在吗|早上好|中午好|晚上好|早安|午安|晚安|谢谢|多谢|辛苦了|再见|拜拜|哈哈|你是谁|你能干嘛|你能做什么|介绍一下你自己|怎么用|有什么功能)[！!？?。.～~]*$/i.test(clean)) {
      return true;
    }
    if (/(?:怎么开|如何开|在哪开|怎么用|教程|指引|引导|是什么|干嘛用|功能)/.test(clean) && /(?:无障碍|悬浮窗|大肥鱼|api|密钥|key|技能|手机辅助|本地)/i.test(clean)) {
      return true;
    }
    if (/^[\d\s+\-*/().（）×÷=？?]+$/.test(clean) && /\d/.test(clean) && /[+\-*/×÷]/.test(clean)) {
      return true;
    }
    if (/(?:帮我算|算一下|计算|等于几|等于多少)/.test(clean) && /\d/.test(clean)) {
      return true;
    }
    if (/(?:现在几点|几点了|今天几号|星期几|今天星期|今天日期|多少个技能|有什么技能|已学技能|权限状态|无障碍开了吗|悬浮窗开了吗|当前版本|版本号)/.test(clean)) {
      return true;
    }
    if (/(?:好累|累了|无聊|难过|开心|睡不着|安慰|夸夸|吃什么|推荐|笑话|冷笑话|请假条|自我介绍|道歉|祝福|陪我聊|聊聊|聊聊天|心情)/.test(clean)) {
      return true;
    }
    if (EXPLICIT_CONTROL_VERB_RE.test(clean)) return false;
    if (/(?:为什么|怎么回事|原理|是什么|是什么意思|怎么办|帮我解释|帮我分析|聊一聊|聊聊|讲个|觉得呢|好不好|是不是|能不能)[？?！!。]*$/.test(clean) || /[？?]$/.test(clean)) {
      return true;
    }
    return !isSimpleBuiltInLocalCmd(clean) && clean.length <= 42;
  }

  function safeEvalArithmetic(rawExpr) {
    const expr = String(rawExpr || '')
      .replace(/[×xX]/g, '*')
      .replace(/[÷]/g, '/')
      .replace(/（/g, '(')
      .replace(/）/g, ')')
      .replace(/[^0-9+\-*/().]/g, '');
    if (!expr || expr.length > 64 || !/\d/.test(expr) || !/[+\-*/]/.test(expr)) return null;
    const tokens = [];
    let i = 0;
    while (i < expr.length) {
      const ch = expr[i];
      if (/\d|\./.test(ch)) {
        let numStr = '';
        let dots = 0;
        while (i < expr.length && /[\d.]/.test(expr[i])) {
          if (expr[i] === '.') dots += 1;
          if (dots > 1) return null;
          numStr += expr[i++];
        }
        const val = Number(numStr);
        if (!Number.isFinite(val)) return null;
        tokens.push({ type: 'num', val });
      } else if ('+-*/()'.includes(ch)) {
        tokens.push({ type: 'op', val: ch });
        i += 1;
      } else {
        return null;
      }
    }
    let pos = 0;
    const peek = () => tokens[pos] || null;
    const next = () => tokens[pos++] || null;
    const parseExpr = () => {
      let left = parseTerm();
      if (left === null) return null;
      while (peek() && peek().type === 'op' && (peek().val === '+' || peek().val === '-')) {
        const op = next().val;
        const right = parseTerm();
        if (right === null) return null;
        left = op === '+' ? left + right : left - right;
      }
      return left;
    };
    const parseTerm = () => {
      let left = parseFactor();
      if (left === null) return null;
      while (peek() && peek().type === 'op' && (peek().val === '*' || peek().val === '/')) {
        const op = next().val;
        const right = parseFactor();
        if (right === null) return null;
        if (op === '/' && right === 0) return null;
        left = op === '*' ? left * right : left / right;
      }
      return left;
    };
    const parseFactor = () => {
      const t = peek();
      if (!t) return null;
      if (t.type === 'op' && (t.val === '+' || t.val === '-')) {
        next();
        const f = parseFactor();
        return f === null ? null : (t.val === '-' ? -f : f);
      }
      if (t.type === 'op' && t.val === '(') {
        next();
        const inner = parseExpr();
        if (!peek() || peek().val !== ')') return null;
        next();
        return inner;
      }
      if (t.type === 'num') {
        next();
        return t.val;
      }
      return null;
    };
    const res = parseExpr();
    if (res === null || pos !== tokens.length || !Number.isFinite(res)) return null;
    return Number.isInteger(res) ? res : Number(res.toFixed(6));
  }

  function buildLocalSmartChatReply(text) {
    const clean = String(text || '').trim();
    const perms = getSetupPermissionsState();
    const skills = loadLearnedSkills();

    // 1. 权限与新手指引咨询
    if (/(?:无障碍|悬浮窗|大肥鱼|怎么开|如何开|在哪开|新手指引|教程)/.test(clean)) {
      const a11yLine = perms.a11yOk ? '✅ 无障碍服务已开启' : '⚠️ 无障碍服务尚未开启';
      const floatLine = perms.floatOn ? '✅ 悬浮窗运行中' : (perms.overlayOk ? '⚪ 已授权悬浮窗，可随时一键启动' : '⚠️ 悬浮窗权限未开启');
      return {
        thought: '用户在咨询无障碍或悬浮窗开启方法，已结合当前设备权限状态整理引导。',
        reply: `开启权限只需两步：\n1. **无障碍服务**（${a11yLine}）：系统设置 → 无障碍 → 已下载的应用 → 打开「DeepSeek · 星语」。\n2. **桌面悬浮窗**（${floatLine}）：点击下方按钮一键前往授权，开启后可在任意 App 表面随时呼出大肥鱼或紧急叫停。`,
        actionType: 'open_setup_guide'
      };
    }

    // 2. API 配置 / 技能固化咨询
    if (/(?:api|密钥|key|切换引擎|直连|云端|技能固化|学习操作)/i.test(clean)) {
      return {
        thought: '用户在咨询引擎配置或操作技能固化方式，整理当前可用方案。',
        reply: `手机辅助支持三种引擎自由切换：\n• **本地免 API**：零费用毫秒执行常用系统口令、已学技能、计算与日常对话；\n• **DeepSeek API**：填入你自己的 Key，智能识屏完成复杂多步任务；\n• **云端 API**：直接使用平台内置托管智能体。\n用 API 跑通固定流程后，点击结果卡片下方的「✨ 固化为本地技能」，以后在本地免 API 模式也能一键免消耗复用！`,
        actionType: 'open_settings'
      };
    }

    // 3. 本地安全数学计算
    const mathVal = safeEvalArithmetic(clean);
    if (mathVal !== null) {
      return {
        thought: '识别为本地四则算术表达式，使用安全解析器直接离线算出结果。',
        reply: `我帮你算好啦，结果是：**${mathVal}**`,
        actionType: ''
      };
    }

    // 4. 时间、日期查询
    if (/(?:几点|几号|星期几|礼拜几|哪天|日期|现在时间|今天星期|今天是几|今天几号)/.test(clean) && !/(?:天气|快递|外卖)/.test(clean)) {
      const now = new Date();
      const weekDays = ['日', '一', '二', '三', '四', '五', '六'];
      const pad = (n) => String(n).padStart(2, '0');
      return {
        thought: '读取本机实时时钟回答时间与日期问题。',
        reply: `现在是 **${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 星期${weekDays[now.getDay()]} ${pad(now.getHours())}:${pad(now.getMinutes())}**~`,
        actionType: ''
      };
    }

    // 5. 状态、技能清单与版本查询
    if (/(?:技能|状态|版本|开了吗|就绪)/.test(clean)) {
      const skillNames = skills.slice(0, 6).map((s) => `「${s.name || s.trigger}」`).join('、');
      return {
        thought: '汇总当前本地技能库、设备权限状态与客户端版本。',
        reply: `当前版本 **v${CURRENT_APK_VERSION} (Build ${CURRENT_APK_CODE})**：\n• 无障碍：${perms.a11yOk ? '已开启 ✅' : '未开启 ⚠️'}\n• 悬浮窗：${perms.floatOn ? '运行中 ✅' : '未开启 ⚪'}\n• 已学本地技能：${skills.length} 个${skillNames ? `（${skillNames}）` : ''}`,
        actionType: (!perms.a11yOk || !perms.overlayOk) ? 'open_setup_guide' : ''
      };
    }

    // 6. 实用日常文案模板
    if (/(?:请假条|请假)/.test(clean)) {
      return {
        thought: '用户需要请假文案模板，提供简洁得体的离线参考模板。',
        reply: `给你准备了一段可以直接复制使用的请假条模板：\n\n「老师/领导您好，因身体略有不适（或家中有急事需处理），今天需请假一天休息调整，期间工作/作业已提前安排妥当，返岗后第一时间补齐进度，望批准！」`,
        actionType: ''
      };
    }
    if (/(?:晚安|早安|午安)/.test(clean)) {
      const replyMap = {
        晚安: '晚安呀🌙 今天也辛苦了，早点放下手机好好休息，明天见~',
        早安: '早安☀️ 新的一天元气满满！需要我帮你打开应用、放首歌还是看看消息？',
        午安: '午安~ 记得按时吃饭、小憩一会儿再继续哦！'
      };
      const hit = Object.keys(replyMap).find((k) => clean.includes(k));
      return {
        thought: '响应日常问候，送上温暖回应。',
        reply: replyMap[hit] || '你好呀，我一直都在！',
        actionType: ''
      };
    }
    if (/(?:吃什么|推荐.*吃|午饭|晚饭|夜宵)/.test(clean)) {
      const foods = ['热腾腾的番茄肥牛米线', '香喷喷的黄焖鸡米饭', '鲜香微辣的柳州螺蛳粉', '清爽低脂的照烧鸡排饭', '料足味美的砂锅麻辣烫', '皮薄馅大的鲜肉小笼包配紫菜蛋汤'];
      const pick = foods[(clean.length + paChatMemory.length) % foods.length];
      return {
        thought: '根据日常美食库离线随机挑选高好评餐品推荐。',
        reply: `今天试试 **${pick}** 怎么样？如果想让我直接打开外卖软件帮你选，切换「DeepSeek API」后跟我说「帮我点外卖」就行~`,
        actionType: ''
      };
    }
    if (/(?:笑话|开心一下|无聊|讲个)/.test(clean)) {
      const jokes = [
        '刚才大肥鱼问我为什么手机越用越烫，我说：因为你在屏幕里游太快，把算力摩擦生热啦🐋',
        '程序员去买西瓜：看到“如果看见卖西瓜的，买一个；如果看见卖番茄的，买四个”，于是最后买了四个西瓜回来……',
        '今天我学会了一个超厉害的省电技巧：只要把手机屏幕朝下扣在桌子上，它就会假装自己已经充好电了（并不）。'
      ];
      const joke = jokes[(paChatMemory.length + new Date().getMinutes()) % jokes.length];
      return {
        thought: '用户想放松一下，分享一条轻松幽默的段子。',
        reply: joke,
        actionType: ''
      };
    }
    if (/(?:好累|累了|难过|压力|睡不着|安慰|夸夸)/.test(clean)) {
      return {
        thought: '感受到用户有些疲惫或需要鼓励，给予温暖安抚。',
        reply: '抱抱你~ 已经坚持做完这么多事很了不起啦！先深呼吸放松一下肩颈，把繁琐的手机操作交给我来代劳就好。想休息的话，也可以让我帮你「用QQ音乐放一首轻音乐」或「刷几个短视频」~',
        actionType: ''
      };
    }

    // 7. 自我介绍与能力清单
    if (/^(?:你好|您好|hi|hello|在吗|你是谁|你能干嘛|你能做什么|介绍一下你自己|怎么用|有什么功能)/i.test(clean)) {
      return {
        thought: '识别为问候与能力咨询，清晰介绍本地免 API 能力与智能 API 区别。',
        reply: `你好呀，我是 **dsh-Go · 鲸语控屏助手** 🐋！\n在当前的「本地免 API」模式下，我已经能直接帮你：\n1. **快捷控屏**：打开应用、回桌面、返回、截屏、音量/静音、刷视频、打字发送、QQ音乐点歌；\n2. **离线对话小助手**：算术计算、查时间/权限状态、日常文案、陪聊解闷；\n3. **本地已学技能**：零消耗回放你固化保存的多步流程。\n如果要让我自己看懂复杂屏幕（如连续写作业、点外卖、跨应用操作），点上方「控制台 → DeepSeek API」即可！`,
        actionType: (!perms.a11yOk || !perms.overlayOk) ? 'open_setup_guide' : ''
      };
    }

    // 8. 通用自然兜底回复（绝不报红错）
    return {
      thought: '识别为自由聊天，当前处于本地离线模式，给予自然友好的回应。',
      reply: `收到你说的话啦~ 当前处于「本地免 API」离线对话模式，如果只是日常聊天、算算数、查时间和权限指引我都随时在线；要是想让我展开深度知识解答，或者看懂手机屏幕帮你做复杂任务，可以在右上角切换为 **DeepSeek API** 或 **云端 API** 哦！`,
      actionType: ''
    };
  }
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

  let nativeReqSeq = 0;
  const pendingNativeHttp = new Map();
  const pendingNativeSleeps = new Map();
  const pendingNativeVerdicts = new Map();

  function nextNativeReqId(prefix) {
    nativeReqSeq += 1;
    return `${prefix}_${Date.now()}_${nativeReqSeq}`;
  }

  window.__onNativeHttpResult = (reqId, payloadStr) => {
    const entry = pendingNativeHttp.get(reqId);
    if (!entry) return;
    pendingNativeHttp.delete(reqId);
    try {
      entry.resolve(typeof payloadStr === 'string' ? JSON.parse(payloadStr) : payloadStr);
    } catch {
      entry.resolve({ ok: false, status: 0, body: '', error: '原生 HTTP 响应解析失败' });
    }
  };

  window.__onNativeSleepDone = (reqId) => {
    const entry = pendingNativeSleeps.get(reqId);
    if (!entry) return;
    pendingNativeSleeps.delete(reqId);
    entry.resolve();
  };

  window.__onNativeVerdictResult = (reqId, payloadStr) => {
    const entry = pendingNativeVerdicts.get(reqId);
    if (!entry) return;
    pendingNativeVerdicts.delete(reqId);
    try {
      entry.resolve(typeof payloadStr === 'string' ? JSON.parse(payloadStr) : payloadStr);
    } catch {
      entry.resolve({ changed: false, elapsedMs: 0, prefetchedSnapshot: null });
    }
  };

  function nativeSleep(ms, signal = null) {
    const delayMs = Math.max(0, Number(ms) || 0);
    if (delayMs === 0) return Promise.resolve();
    const b = getBridge();
    if (!isNativeApk() || !b || typeof b.nativeSleepAsync !== 'function') {
      if (!signal) return sleep(delayMs);
      return new Promise((resolve) => {
        if (signal.aborted) {
          resolve();
          return;
        }
        const timer = setTimeout(() => {
          signal.removeEventListener('abort', onAbort);
          resolve();
        }, delayMs);
        const onAbort = () => {
          clearTimeout(timer);
          resolve();
        };
        signal.addEventListener('abort', onAbort, { once: true });
      });
    }

    return new Promise((resolve) => {
      if (signal?.aborted) {
        resolve();
        return;
      }
      const reqId = nextNativeReqId('slp');
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        clearTimeout(guardTimer);
        if (signal) signal.removeEventListener('abort', onAbort);
        resolve();
      };
      const onAbort = () => {
        pendingNativeSleeps.delete(reqId);
        try { b.cancelNativeSleep?.(reqId); } catch {}
        done();
      };
      const guardTimer = setTimeout(() => {
        pendingNativeSleeps.delete(reqId);
        done();
      }, delayMs + 2500);
      pendingNativeSleeps.set(reqId, { resolve: done });
      if (signal) signal.addEventListener('abort', onAbort, { once: true });
      try {
        b.nativeSleepAsync(reqId, delayMs);
      } catch {
        pendingNativeSleeps.delete(reqId);
        clearTimeout(guardTimer);
        if (signal) signal.removeEventListener('abort', onAbort);
        sleep(delayMs).then(done);
      }
    });
  }

  async function nativeHttpPostJson(url, headersObj, bodyObj, { timeoutMs = 12000, signal = null } = {}) {
    const b = getBridge();
    const bodyStr = JSON.stringify(bodyObj || {});
    if (isNativeApk() && b && typeof b.nativeHttpPostAsync === 'function') {
      return new Promise((resolve, reject) => {
        if (signal?.aborted) {
          const ae = new Error('请求已取消');
          ae.name = 'AbortError';
          reject(ae);
          return;
        }
        const reqId = nextNativeReqId('http');
        let settled = false;
        const cleanup = () => {
          clearTimeout(guardTimer);
          if (signal) signal.removeEventListener('abort', onAbort);
        };
        const onAbort = () => {
          if (settled) return;
          settled = true;
          pendingNativeHttp.delete(reqId);
          cleanup();
          try { b.cancelNativeHttp?.(reqId); } catch {}
          const ae = new Error('请求已取消');
          ae.name = 'AbortError';
          reject(ae);
        };
        const guardTimer = setTimeout(() => {
          if (settled) return;
          settled = true;
          pendingNativeHttp.delete(reqId);
          if (signal) signal.removeEventListener('abort', onAbort);
          try { b.cancelNativeHttp?.(reqId); } catch {}
          const te = new Error('原生 HTTP 请求超时');
          te.name = 'AbortError';
          reject(te);
        }, timeoutMs + 2000);

        pendingNativeHttp.set(reqId, {
          resolve: (resObj) => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve({
              ok: Boolean(resObj?.ok),
              status: Number(resObj?.status) || 0,
              bodyText: String(resObj?.body || ''),
              error: String(resObj?.error || ''),
              fromNative: true
            });
          }
        });
        if (signal) signal.addEventListener('abort', onAbort, { once: true });

        try {
          b.nativeHttpPostAsync(reqId, String(url), JSON.stringify(headersObj || {}), bodyStr, timeoutMs);
        } catch (err) {
          if (!settled) {
            settled = true;
            pendingNativeHttp.delete(reqId);
            cleanup();
            reject(err);
          }
        }
      });
    }

    const timeoutCtrl = new AbortController();
    const timeoutTimer = setTimeout(() => {
      try { timeoutCtrl.abort(); } catch {}
    }, timeoutMs);
    const onOuterAbort = () => {
      try { timeoutCtrl.abort(); } catch {}
    };
    if (signal) {
      if (signal.aborted) timeoutCtrl.abort();
      else signal.addEventListener('abort', onOuterAbort, { once: true });
    }
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(headersObj || {}) },
        body: bodyStr,
        signal: timeoutCtrl.signal
      });
      const bodyText = await resp.text().catch(() => '');
      return { ok: resp.ok, status: resp.status, bodyText, error: resp.ok ? '' : bodyText, fromNative: false };
    } finally {
      clearTimeout(timeoutTimer);
      if (signal) signal.removeEventListener('abort', onOuterAbort);
    }
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
    const cfg = getDirectConfig();
    return cfg.apiKey ? 'api_direct' : 'api_cloud';
  }

  function setExecMode(mode) {
    const next = mode === 'api_cloud' || mode === 'local' ? mode : 'api_direct';
    try {
      localStorage.setItem(STORAGE_KEYS.execMode, next);
    } catch {}
    syncStatus();
    return next;
  }

  function getConfirmPolicy() {
    try {
      const p = localStorage.getItem(STORAGE_KEYS.confirmPolicy);
      if (p === 'ask_every' || p === 'sensitive_only' || p === 'auto_turn') return p;
      if (localStorage.getItem(STORAGE_KEYS.autoApprove) === '1') return 'auto_turn';
    } catch {}
    return 'sensitive_only';
  }

  function setConfirmPolicy(policy) {
    const next = policy === 'ask_every' || policy === 'auto_turn' ? policy : 'sensitive_only';
    try {
      localStorage.setItem(STORAGE_KEYS.confirmPolicy, next);
      localStorage.setItem(STORAGE_KEYS.autoApprove, next === 'auto_turn' ? '1' : '0');
    } catch {}
    syncStatus();
    return next;
  }

  function getPolicyLabel(policy) {
    if (policy === 'ask_every') return '每次确认';
    if (policy === 'auto_turn') return '托管放行';
    return '仅敏感确认';
  }

  function getClarifyPolicy() {
    try {
      const p = localStorage.getItem(STORAGE_KEYS.clarifyPolicy);
      if (p === 'smart' || p === 'always' || p === 'off') return p;
    } catch {}
    return 'smart';
  }

  function setClarifyPolicy(policy) {
    const next = policy === 'always' || policy === 'off' ? policy : 'smart';
    try {
      localStorage.setItem(STORAGE_KEYS.clarifyPolicy, next);
    } catch {}
    syncStatus();
    return next;
  }

  function getClarifyPolicyLabel(policy) {
    if (policy === 'always') return '每次先确认';
    if (policy === 'off') return '直接执行';
    return '智能确认';
  }

  function getTrustedApps() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.trustedApps);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr.filter((x) => x && (x.packageName || x.appName)) : [];
    } catch {
      return [];
    }
  }

  function addTrustedApp(appName, packageName) {
    const pkg = String(packageName || '').trim();
    const name = String(appName || pkg).trim();
    if (!pkg && !name) return;
    const list = getTrustedApps().filter((x) => (pkg ? x.packageName !== pkg : x.appName !== name));
    list.unshift({ appName: name, packageName: pkg, ts: Date.now() });
    try {
      localStorage.setItem(STORAGE_KEYS.trustedApps, JSON.stringify(list.slice(0, 30)));
    } catch {}
    syncStatus();
  }

  function removeTrustedApp(key) {
    const list = getTrustedApps().filter((x) => x.packageName !== key && x.appName !== key);
    try {
      localStorage.setItem(STORAGE_KEYS.trustedApps, JSON.stringify(list));
    } catch {}
    syncStatus();
  }

  function isAppTrusted(appName, packageName) {
    const pkg = String(packageName || '').trim();
    const name = String(appName || '').trim();
    return getTrustedApps().some((x) => (pkg && x.packageName === pkg) || (name && x.appName === name));
  }

  function isEdgeGlowEnabled() {
    try {
      return localStorage.getItem(STORAGE_KEYS.edgeGlow) !== '0';
    } catch {
      return true;
    }
  }

  function setEdgeGlowPref(enabled) {
    const flag = Boolean(enabled);
    try {
      localStorage.setItem(STORAGE_KEYS.edgeGlow, flag ? '1' : '0');
    } catch {}
    const b = getBridge();
    if (isNativeApk() && b && typeof b.setEdgeGlowEnabled === 'function') {
      try { b.setEdgeGlowEnabled(flag); } catch {}
    }
    syncStatus();
  }

  function normalizePetPersona(personaId) {
    return personaId === 'nailong' ? 'nailong' : 'feiyu';
  }

  function getPetPersona() {
    try {
      return normalizePetPersona(localStorage.getItem(STORAGE_KEYS.petPersona));
    } catch {
      return 'feiyu';
    }
  }

  function applyPetPersonaWebTheme(personaId) {
    const id = normalizePetPersona(personaId);
    const bgLayer = $('pa-whale-bg-layer');
    if (bgLayer) {
      if (bgLayer.dataset) bgLayer.dataset.petPersona = id;
      if (typeof bgLayer.setAttribute === 'function') {
        bgLayer.setAttribute('data-pet-persona', id);
      }
    }
    const appShell = $('app-shell');
    if (appShell) {
      if (appShell.dataset) appShell.dataset.petPersona = id;
      if (typeof appShell.setAttribute === 'function') {
        appShell.setAttribute('data-pet-persona', id);
      }
    }
    if (typeof document?.querySelectorAll === 'function') {
      document.querySelectorAll('.pa-pet-card').forEach((card) => {
        const active = card?.dataset?.paPet === id;
        card?.classList?.toggle('active', active);
        if (typeof card?.setAttribute === 'function') {
          card.setAttribute('aria-checked', String(active));
        }
      });
    }
  }

  function setPetPersona(personaId, { syncNative = true, notify = false } = {}) {
    const id = normalizePetPersona(personaId);
    try {
      localStorage.setItem(STORAGE_KEYS.petPersona, id);
    } catch {}
    applyPetPersonaWebTheme(id);
    if (syncNative) {
      const b = getBridge();
      if (isNativeApk() && b && typeof b.setFloatPetPersona === 'function') {
        try { b.setFloatPetPersona(id); } catch {}
      }
    }
    syncStatus();
    if (notify) {
      showToast(id === 'nailong' ? '已切换悬浮窗形象：🐲 奶龙（暖金守护）' : '已切换悬浮窗形象：🐳 大肥鱼（海蓝守护）');
    }
    return id;
  }

  function syncPetPersonaFromNative() {
    const b = getBridge();
    if (isNativeApk() && b && typeof b.getFloatPetPersona === 'function') {
      try {
        const nativeId = normalizePetPersona(b.getFloatPetPersona());
        localStorage.setItem(STORAGE_KEYS.petPersona, nativeId);
        applyPetPersonaWebTheme(nativeId);
        return nativeId;
      } catch {}
    }
    const localId = getPetPersona();
    applyPetPersonaWebTheme(localId);
    return localId;
  }

  if (typeof window !== 'undefined') {
    window.__onNativePetPersonaChanged = (personaId) => {
      setPetPersona(personaId, { syncNative: false, notify: false });
    };
  }

  function inferToolActionLabel(toolName, summary = '') {
    const raw = String(toolName || '').trim();
    const map = {
      'phone.screen': '读取屏幕',
      phone_tap: '点击控件',
      phone_tap_xy: '坐标点击',
      click_node: '点击控件',
      click: '点击',
      phone_type: '文本输入',
      input: '文本输入',
      phone_scroll: '页面滚动',
      scroll: '页面滚动',
      phone_swipe: '滑动手势',
      swipe: '滑动手势',
      phone_open: '打开应用',
      launch_app: '打开应用',
      phone_key: '系统按键',
      key: '系统按键',
      back: '返回上页',
      home: '回到桌面',
      phone_wait: '等待加载',
      wait: '等待加载',
      ask_user: '请求确认',
      done: '完成任务',
      chat: '直接回复'
    };
    if (map[raw]) return map[raw];
    if (raw.startsWith('skill.')) return '离线技能';
    return String(summary || raw || '执行操作').slice(0, 12);
  }

  function syncNativeFloatProgress(payload = {}) {
    const b = getBridge();
    if (!isNativeApk() || !b) return;
    const state = payload.state || 'idle';
    const phase = payload.phase || 'thinking';
    const step = Number(payload.step) || 0;
    const appName = String(payload.appName || '').slice(0, 32);
    const toolName = String(payload.toolName || '').slice(0, 32);
    const summary = String(payload.summary || '').slice(0, 96);
    const thought = String(payload.thought || '').slice(0, 220);
    const verdictText = String(payload.verdictText || '').slice(0, 96);
    if (typeof b.updateFloatProgress === 'function') {
      try {
        b.updateFloatProgress(JSON.stringify({
          state,
          phase,
          step,
          appName,
          toolName,
          summary,
          thought,
          verdictText
        }));
        return;
      } catch {}
    }
    if (typeof b.updateFloatState === 'function') {
      try {
        b.updateFloatState(state, summary || thought || 'dsh-Go');
      } catch {}
    }
  }

  function renderTrustedAppsList() {
    const wrap = $('pa-trusted-apps-list');
    if (!wrap) return;
    const list = getTrustedApps();
    if (list.length === 0) {
      wrap.innerHTML = `<span class="pa-trusted-empty">暂无白名单应用（在确认卡点“信任此App”可自动加入）</span>`;
      return;
    }
    wrap.innerHTML = list
      .map((item) => {
        const key = item.packageName || item.appName;
        return `
          <span class="pa-trusted-chip">
            <span>${escapeHtml(item.appName || item.packageName)}</span>
            <button type="button" data-remove-trust="${escapeHtml(key)}" title="移出白名单" aria-label="移出白名单">✕</button>
          </span>
        `;
      })
      .join('');
    wrap.querySelectorAll('button[data-remove-trust]').forEach((btn) => {
      btn.addEventListener('click', () => {
        removeTrustedApp(btn.getAttribute('data-remove-trust') || '');
      });
    });
  }

  function cleanApiKey(rawKey) {
    let clean = String(rawKey || '').trim().replace(/[\r\n\t]+/g, '');
    if (/^Bearer\s+/i.test(clean)) {
      clean = clean.replace(/^Bearer\s+/i, '').trim();
    }
    return clean;
  }

  function normalizeChatCompletionsUrl(rawUrl) {
    let s = String(rawUrl || '').trim();
    if (!s) return 'https://api.deepseek.com/v1/chat/completions';
    if (!/^https?:\/\//i.test(s) && /^[a-z0-9.-]+\.[a-z]{2,}(?:\/.*)?$/i.test(s)) {
      s = `https://${s}`;
    }
    s = s.replace(/\/+$/, '');
    if (/\/chat\/completions$/i.test(s)) return s;
    if (/\/(?:v1|v1beta\/openai|compatible-mode\/v1|api\/v1)$/i.test(s)) {
      return `${s}/chat/completions`;
    }
    try {
      const u = new URL(s);
      if (!u.pathname || u.pathname === '/') return `${s}/v1/chat/completions`;
    } catch {}
    return `${s}/v1/chat/completions`;
  }

  function getDirectConfig() {
    let apiKey = '';
    let model = 'deepseek-v4.1-flash';
    let autoApprove = false;
    try {
      apiKey = cleanApiKey(localStorage.getItem(STORAGE_KEYS.exclusiveKey) || '');
      const rawStored = (localStorage.getItem(STORAGE_KEYS.directModel) || '').trim();
      const migrated = localStorage.getItem(STORAGE_KEYS.directModelMigratedV41) === '1';
      if (!migrated) {
        localStorage.setItem(STORAGE_KEYS.directModelMigratedV41, '1');
        if (!rawStored || rawStored === 'deepseek-chat' || rawStored === 'deepseek-flash') {
          localStorage.setItem(STORAGE_KEYS.directModel, 'deepseek-v4.1-flash');
          model = 'deepseek-v4.1-flash';
        } else {
          model = rawStored;
        }
      } else {
        model = rawStored || 'deepseek-v4.1-flash';
      }
      autoApprove = localStorage.getItem(STORAGE_KEYS.autoApprove) === '1';
    } catch {}
    return { apiKey, model, baseUrl: DEEPSEEK_OFFICIAL_CHAT_URL, autoApprove };
  }

  function getCloudConfig() {
    let apiKey = '';
    let baseUrl = '';
    let model = '';
    let autoApprove = false;
    try {
      apiKey = cleanApiKey(localStorage.getItem(STORAGE_KEYS.cloudApiKey) || '');
      baseUrl = (localStorage.getItem(STORAGE_KEYS.cloudBaseUrl) || '').trim();
      const migrated = localStorage.getItem(STORAGE_KEYS.cloudModelMigratedV274) === '1';
      const storedModel = (localStorage.getItem(STORAGE_KEYS.cloudModel) || '').trim();
      if (!migrated) {
        localStorage.setItem(STORAGE_KEYS.cloudModelMigratedV274, '1');
        if (storedModel === 'deepseek-v4.1-flash') {
          localStorage.removeItem(STORAGE_KEYS.cloudModel);
          model = '';
        } else {
          model = storedModel;
        }
      } else {
        model = storedModel;
      }
      autoApprove = localStorage.getItem(STORAGE_KEYS.autoApprove) === '1';
    } catch {}
    return { apiKey, baseUrl, model, autoApprove };
  }

  function setCloudConfig({ apiKey, baseUrl, model, autoApprove } = {}) {
    try {
      if (apiKey !== undefined) {
        const cleanK = cleanApiKey(apiKey);
        if (cleanK) localStorage.setItem(STORAGE_KEYS.cloudApiKey, cleanK);
        else localStorage.removeItem(STORAGE_KEYS.cloudApiKey);
      }
      if (baseUrl !== undefined) {
        const cleanU = String(baseUrl || '').trim();
        if (cleanU) localStorage.setItem(STORAGE_KEYS.cloudBaseUrl, cleanU);
        else localStorage.removeItem(STORAGE_KEYS.cloudBaseUrl);
      }
      if (model !== undefined) {
        const cleanM = String(model || '').trim();
        if (cleanM) localStorage.setItem(STORAGE_KEYS.cloudModel, cleanM);
        else localStorage.removeItem(STORAGE_KEYS.cloudModel);
        localStorage.setItem(STORAGE_KEYS.cloudModelMigratedV274, '1');
      }
      if (autoApprove !== undefined) {
        localStorage.setItem(STORAGE_KEYS.autoApprove, autoApprove ? '1' : '0');
      }
    } catch {}
    return getCloudConfig();
  }

  function getCloudModel() {
    return getCloudConfig().model;
  }

  function setCloudModel(model) {
    return setCloudConfig({ model }).model;
  }

  function resolveDirectModelForUrl(rawModel, targetUrl = '') {
    const m = String(rawModel || 'deepseek-v4.1-flash').trim() || 'deepseek-v4.1-flash';
    const lowerUrl = String(targetUrl || '').toLowerCase();
    if ((!lowerUrl || lowerUrl.includes('deepseek.com')) && /^deepseek[-_]?v?4(?:\.1)?[-_]?flash$/i.test(m)) {
      return 'deepseek-flash';
    }
    return m;
  }

  function setDirectApiKey(key) {
    const clean = cleanApiKey(key);
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
    maybeAutoShowSetupGuide();
  }

  function resetTaskWorkspace() {
    if (activeAbortController) {
      try {
        activeAbortController.abort();
      } catch {}
    }
    emergencyStopRequested = true;
    paSessionNodes = [];
    paChatMemory = [];
    pendingAskContext = null;
    updateComposerAskHint(false);
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
    const curMode = getExecMode();
    if (curMode === 'api_cloud' && typeof triggerCloudModelsRefresh === 'function') {
      setTimeout(() => triggerCloudModelsRefresh(false), 120);
    }
    if (focusApiKey && curMode === 'api_direct') {
      $('pa-inline-config-drawer')?.classList.remove('hidden');
      setTimeout(() => $('pa-cfg-apikey')?.focus(), 80);
    } else if (focusApiKey && curMode === 'api_cloud') {
      $('pa-cloud-model-box')?.classList.remove('hidden');
      setTimeout(() => ($('pa-cloud-baseurl')?.value ? $('pa-cloud-apikey') : $('pa-cloud-baseurl'))?.focus(), 80);
    }
  }

  function closeControlSheet() {
    $('pa-sheet-backdrop')?.classList.add('hidden');
    $('pa-control-sheet')?.classList.add('hidden');
    $('pa-cfg-toggle-btn')?.setAttribute('aria-expanded', 'false');
  }

  function syncLearnedSkillsToNative(list) {
    try {
      const b = getBridge();
      if (isNativeApk() && b && typeof b.saveLearnedSkillsSummary === 'function') {
        const summary = (Array.isArray(list) ? list : []).slice(0, 12).map((s) => ({
          id: String(s.id || ''),
          name: String(s.name || '').slice(0, 24),
          trigger: String(s.trigger || s.name || '').slice(0, 24),
          stepCount: Array.isArray(s.steps) ? s.steps.length : 0,
          targetApp: String(s.targetApp || '')
        }));
        b.saveLearnedSkillsSummary(JSON.stringify(summary));
      }
    } catch {}
  }

  function loadLearnedSkills() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.learnedSkills);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr.filter((s) => s && s.id && s.name && Array.isArray(s.steps)) : [];
    } catch {
      return [];
    }
  }

  function saveLearnedSkills(list) {
    const clean = (Array.isArray(list) ? list : [])
      .filter((s) => s && s.id && s.name && Array.isArray(s.steps))
      .slice(0, 40);
    try {
      localStorage.setItem(STORAGE_KEYS.learnedSkills, JSON.stringify(clean));
    } catch {}
    syncLearnedSkillsToNative(clean);
    renderEmptyGuideLearnedSkills();
    return clean;
  }

  function upsertLearnedSkill(skill) {
    const list = loadLearnedSkills();
    const id = String(skill.id || `skill_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);
    const nextSkill = {
      id,
      name: String(skill.name || '未命名本地技能').trim().slice(0, 32),
      trigger: String(skill.trigger || skill.name || '').trim().slice(0, 40),
      sourceTask: String(skill.sourceTask || '').trim().slice(0, 120),
      targetApp: String(skill.targetApp || '').trim(),
      targetPackage: String(skill.targetPackage || '').trim(),
      steps: Array.isArray(skill.steps) ? skill.steps.slice(0, 60) : [],
      runCount: Number(skill.runCount) || 0,
      createdAt: Number(skill.createdAt) || Date.now(),
      updatedAt: Date.now()
    };
    const idx = list.findIndex((x) => x.id === id);
    if (idx >= 0) list[idx] = nextSkill;
    else list.unshift(nextSkill);
    saveLearnedSkills(list);
    return nextSkill;
  }

  function deleteLearnedSkill(id) {
    const list = loadLearnedSkills().filter((x) => x.id !== id);
    saveLearnedSkills(list);
  }

  function findMatchingLearnedSkill(inputText) {
    const raw = String(inputText || '').trim();
    if (!raw) return null;
    const list = loadLearnedSkills();
    if (!list.length) return null;

    const idPrefix = raw.match(/^(?:skill:|运行技能[:：]\s*)([a-zA-Z0-9_-]+)/i);
    if (idPrefix) {
      const byId = list.find((s) => s.id === idPrefix[1]);
      if (byId) return byId;
    }

    const norm = (str) => String(str || '').trim().toLowerCase().replace(/[，。！？、\s]+/g, '');
    const targetNorm = norm(raw.replace(/^(?:运行技能|执行技能|执行|运行|重放|回放)\s*[:：]?\s*/i, ''));
    if (!targetNorm) return null;

    // 1. 精确匹配触发口令或技能名
    const exact = list.find((s) => norm(s.trigger) === targetNorm || norm(s.name) === targetNorm);
    if (exact) return exact;

    // 2. 包含匹配（口令长度 >= 2）
    return (
      list.find((s) => {
        const t = norm(s.trigger);
        const n = norm(s.name);
        return (t.length >= 2 && targetNorm.includes(t)) || (n.length >= 2 && targetNorm.includes(n));
      }) || null
    );
  }

  function captureRecordableStep(subAct, snapshot, execRes, screenSize) {
    if (!subAct || execRes?.error) return null;
    const tool = subAct.tool || subAct.action || '';
    const args = { ...(subAct.args || subAct.params || {}) };
    if (!tool || tool === 'done' || tool === 'ask_user') return null;

    const SELF_PKG = 'com.deepseek.starwhisper.studio';
    if (snapshot?.packageName === SELF_PKG && tool !== 'phone_open' && tool !== 'launch_app') {
      return null;
    }

    const w = Math.max(360, Number(screenSize?.width) || 1080);
    const h = Math.max(640, Number(screenSize?.height) || 2400);
    const clampR = (v) => Math.max(0.01, Math.min(0.99, Number((Number(v) || 0.5).toFixed(4))));

    let targetNode = null;
    if (args.ref && Array.isArray(snapshot?.nodes)) {
      targetNode = snapshot.nodes.find((n) => n && n.ref === args.ref) || null;
    }

    let rx = null;
    let ry = null;
    if (targetNode && Array.isArray(targetNode.center) && targetNode.center.length >= 2) {
      rx = clampR(targetNode.center[0] / w);
      ry = clampR(targetNode.center[1] / h);
    } else if (Number(execRes?.x) > 0 && Number(execRes?.y) > 0) {
      rx = clampR(execRes.x / w);
      ry = clampR(execRes.y / h);
    } else if (Number(args.x) > 0 && Number(args.y) > 0) {
      rx = clampR(args.x / w);
      ry = clampR(args.y / h);
    }

    return {
      tool,
      summary: String(subAct.summary || formatActionCodeDesc(subAct) || tool).slice(0, 64),
      args: {
        appName: args.appName || '',
        text: args.text !== undefined ? String(args.text) : (targetNode?.text || ''),
        desc: targetNode?.desc || '',
        viewId: targetNode?.viewId || args.viewId || '',
        direction: args.direction || '',
        amount: args.amount !== undefined ? Number(args.amount) : undefined,
        key: args.key || '',
        clear: args.clear,
        submit: Boolean(args.submit || args.autoSubmit),
        ms: args.ms !== undefined ? Number(args.ms) : undefined,
        rx,
        ry,
        rx1: args.x1 !== undefined ? clampR(args.x1 / w) : undefined,
        ry1: args.y1 !== undefined ? clampR(args.y1 / h) : undefined,
        rx2: args.x2 !== undefined ? clampR(args.x2 / w) : undefined,
        ry2: args.y2 !== undefined ? clampR(args.y2 / h) : undefined,
        duration: args.duration !== undefined ? Number(args.duration) : undefined
      },
      targetApp: String(snapshot?.appName || ''),
      targetPackage: String(snapshot?.packageName || ''),
      delayMs: tool === 'phone_open' ? 750 : tool === 'phone_type' ? 280 : 220
    };
  }

  function renderEmptyGuideLearnedSkills() {
    const box = $('pa-learned-skills-box');
    if (!box) return;
    const skills = loadLearnedSkills();
    if (skills.length === 0) {
      box.innerHTML = `
        <div class="pa-learned-head">
          <span class="pa-learned-title">本地已学技能（免 API 离线复用）</span>
          <button type="button" class="pa-learned-manage-btn" id="pa-empty-open-learned-btn">新建 / 导入</button>
        </div>
        <div class="pa-learned-empty-tip">
          使用 API 跑通任意重复任务后，点击结果卡片下方「✨ 固化为本地技能」，即可保存在本地，下次在「本地免 API」模式零消耗直连执行。
        </div>
      `;
    } else {
      box.innerHTML = `
        <div class="pa-learned-head">
          <span class="pa-learned-title">本地已学技能 · 一键零 API 运行 (${skills.length})</span>
          <button type="button" class="pa-learned-manage-btn" id="pa-empty-open-learned-btn">管理技能库</button>
        </div>
        <div class="pa-learned-chips">
          ${skills.slice(0, 6).map((s) => `
            <button type="button" class="pa-skill-chip" data-run-skill-id="${escapeHtml(s.id)}" title="口令：${escapeHtml(s.trigger || s.name)}（${s.steps.length} 步）">
              <span class="pa-skill-chip-dot"></span>
              <span class="pa-skill-chip-name">${escapeHtml(s.name)}</span>
              <span class="pa-skill-chip-meta">${s.steps.length}步</span>
            </button>
          `).join('')}
        </div>
      `;
    }

    box.querySelector('#pa-empty-open-learned-btn')?.addEventListener('click', () => {
      activeCmdLibCategory = 'learned';
      const drawer = $('phone-cmd-quick-drawer');
      if (drawer) {
        drawer.classList.remove('hidden');
        $('pa-open-cmdlib-btn')?.classList.add('is-active');
        renderCommandLibraryDrawer();
      }
    });

    box.querySelectorAll('[data-run-skill-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const sid = btn.getAttribute('data-run-skill-id') || '';
        if (sid) executeLearnedSkillOffline(sid);
      });
    });
  }

  function openSaveSkillModal({ sourceTask = '', recordedSteps = [], existingSkill = null } = {}) {
    document.getElementById('pa-skill-save-modal')?.remove();
    let draftSteps = (existingSkill?.steps || recordedSteps || []).map((st) => ({
      ...st,
      args: { ...(st.args || {}) }
    }));

    const modal = document.createElement('div');
    modal.id = 'pa-skill-save-modal';
    modal.className = 'pa-skill-modal-backdrop';
    const defaultName = existingSkill?.name || String(sourceTask || '自定义本地技能').slice(0, 20) || '自定义本地技能';
    const defaultTrigger = existingSkill?.trigger || defaultName;

    const renderStepsHtml = () => {
      if (draftSteps.length === 0) {
        return '<div class="pa-skill-step-empty">暂无动作步骤，请至少保留 1 步或点击下方「新增步」</div>';
      }
      return draftSteps.map((st, idx) => `
        <div class="pa-skill-step-row" data-step-idx="${idx}">
          <span class="pa-skill-step-num">${idx + 1}</span>
          <div class="pa-skill-step-info">
            <div class="pa-skill-step-top">
              <span class="pa-tool-badge">${escapeHtml(st.tool)}</span>
              <span class="pa-skill-step-sum">${escapeHtml(st.summary || st.args?.text || st.args?.appName || st.tool)}</span>
            </div>
            ${st.tool === 'phone_type' || st.tool === 'input' ? `
              <input type="text" class="pa-skill-step-input" data-edit-text="${idx}" value="${escapeHtml(st.args?.text || '')}" placeholder="输入文本内容" />
            ` : ''}
          </div>
          <button type="button" class="pa-skill-step-del" data-del-step="${idx}" title="移除此步">✕</button>
        </div>
      `).join('');
    };

    modal.innerHTML = `
      <div class="pa-skill-modal" role="dialog" aria-modal="true" aria-label="固化为本地免 API 技能">
        <div class="pa-skill-modal-head">
          <div>
            <h4>${existingSkill ? '编辑本地技能' : '固化为本地技能（免 API 离线复用）'}</h4>
            <p>保存后可在「本地免 API」模式与悬浮窗中零消耗直接运行</p>
          </div>
          <button type="button" class="pa-sheet-close-btn" id="pa-skill-modal-close" aria-label="关闭">✕</button>
        </div>
        <div class="pa-skill-modal-body">
          <div class="pa-cfg-row-2">
            <div class="pa-cfg-field">
              <label for="pa-skill-name-inp">技能名称</label>
              <input type="text" id="pa-skill-name-inp" class="pa-cfg-input" value="${escapeHtml(defaultName)}" maxlength="32" placeholder="如：自动签到领积分" />
            </div>
            <div class="pa-cfg-field">
              <label for="pa-skill-trigger-inp">语音 / 快捷触发口令</label>
              <input type="text" id="pa-skill-trigger-inp" class="pa-cfg-input" value="${escapeHtml(defaultTrigger)}" maxlength="40" placeholder="说出此口令即可本地直达" />
            </div>
          </div>
          <div class="pa-skill-steps-head">
            <span>固化动作序列（共 <strong id="pa-skill-step-count">${draftSteps.length}</strong> 步）</span>
            <button type="button" class="pa-learned-manage-btn" id="pa-skill-add-wait-btn">+ 等待 1 秒</button>
          </div>
          <div class="pa-skill-steps-list" id="pa-skill-steps-list">
            ${renderStepsHtml()}
          </div>
        </div>
        <div class="pa-skill-modal-foot">
          <button type="button" class="pa-banner-btn subtle" id="pa-skill-modal-cancel">取消</button>
          <button type="button" class="pa-banner-btn" id="pa-skill-modal-save">保存本地技能</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    const rebindStepEvents = () => {
      const listEl = modal.querySelector('#pa-skill-steps-list');
      const countEl = modal.querySelector('#pa-skill-step-count');
      if (countEl) countEl.textContent = String(draftSteps.length);
      if (!listEl) return;
      listEl.innerHTML = renderStepsHtml();
      listEl.querySelectorAll('[data-del-step]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const i = Number(btn.getAttribute('data-del-step'));
          if (!Number.isNaN(i)) {
            draftSteps.splice(i, 1);
            rebindStepEvents();
          }
        });
      });
      listEl.querySelectorAll('[data-edit-text]').forEach((inp) => {
        inp.addEventListener('input', () => {
          const i = Number(inp.getAttribute('data-edit-text'));
          if (draftSteps[i]) {
            draftSteps[i].args = { ...(draftSteps[i].args || {}), text: inp.value };
          }
        });
      });
    };
    rebindStepEvents();

    const closeModalBox = () => modal.remove();
    modal.querySelector('#pa-skill-modal-close')?.addEventListener('click', closeModalBox);
    modal.querySelector('#pa-skill-modal-cancel')?.addEventListener('click', closeModalBox);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModalBox();
    });
    modal.querySelector('#pa-skill-add-wait-btn')?.addEventListener('click', () => {
      draftSteps.push({ tool: 'phone_wait', summary: '等待 1000ms 页面加载', args: { ms: 1000 }, delayMs: 200 });
      rebindStepEvents();
    });
    modal.querySelector('#pa-skill-modal-save')?.addEventListener('click', () => {
      const name = (modal.querySelector('#pa-skill-name-inp')?.value || '').trim();
      const trigger = (modal.querySelector('#pa-skill-trigger-inp')?.value || name).trim();
      if (!name) {
        showToast('请填写技能名称');
        return;
      }
      if (draftSteps.length === 0) {
        showToast('请至少保留 1 个动作步骤');
        return;
      }
      const firstExt = draftSteps.find((s) => s.targetPackage && s.targetPackage !== 'com.deepseek.starwhisper.studio');
      const saved = upsertLearnedSkill({
        ...(existingSkill || {}),
        name,
        trigger: trigger || name,
        sourceTask: existingSkill?.sourceTask || sourceTask,
        targetApp: existingSkill?.targetApp || firstExt?.targetApp || '',
        targetPackage: existingSkill?.targetPackage || firstExt?.targetPackage || '',
        steps: draftSteps
      });
      closeModalBox();
      if (activeCmdLibCategory === 'learned') renderCommandLibraryDrawer();
      showToast(`已固化本地技能「${saved.name}」，免 API 模式直接可用！`);
    });
  }

  async function replayLearnedSkill(skill, cardCtx, signal) {
    const b = getBridge();
    const native = isNativeApk();
    const steps = Array.isArray(skill?.steps) ? skill.steps : [];
    if (!steps.length) {
      addStepItem(cardCtx.stepsList, 1, '技能步骤为空', '', '失败', true, 'skill.empty');
      return { status: 'error', summaryTitle: '该本地技能没有可执行步骤', replyText: '' };
    }

    if (cardCtx.summaryTextEl) {
      cardCtx.summaryTextEl.textContent = `本地技能回放：${skill.name} (0/${steps.length})`;
    }

    if (native && b && steps[0].tool !== 'phone_open' && steps[0].tool !== 'launch_app') {
      const initSnap = readAndFormatSnapshot(false);
      if (initSnap.packageName === 'com.deepseek.starwhisper.studio' && typeof b.returnToLastExternalApp === 'function') {
        if (b.returnToLastExternalApp()) {
          addStepItem(cardCtx.stepsList, 0, '切回目标应用准备离线回放', '免 API 本地技能回放', '已切回', false, 'skill.prep');
          await nativeSleep(320, signal);
        }
      }
    }

    const screenSize = getScreenSizeObj();
    const scrW = Math.max(360, Number(screenSize?.width) || 1080);
    const scrH = Math.max(640, Number(screenSize?.height) || 2400);

    for (let i = 0; i < steps.length; i++) {
      if (signal?.aborted || emergencyStopRequested || (native && b && typeof b.isEmergencyStopRequested === 'function' && b.isEmergencyStopRequested())) {
        if (native && b && typeof b.resetEmergencyStop === 'function') {
          try { b.resetEmergencyStop(); } catch {}
        }
        addStepItem(cardCtx.stepsList, i + 1, '本地技能回放已停止', '', '已中止', true, 'system.stop');
        return { status: 'error', summaryTitle: `已中止技能「${skill.name}」`, replyText: '' };
      }

      const st = steps[i];
      const args = st.args || {};
      const stepLabel = st.summary || st.tool;
      cardCtx.stepCount = i + 1;
      if (cardCtx.summaryTextEl) {
        cardCtx.summaryTextEl.textContent = `离线技能 [${i + 1}/${steps.length}]：${stepLabel}`;
      }
      updateThinkingPhase(cardCtx, 'act');
      const thoughtStepEl = appendThoughtItem(
        cardCtx,
        `技能第 ${i + 1}/${steps.length} 步`,
        `正在离线回放动作：${stepLabel}`,
        '',
        { stepNum: i + 1, appName: skill.name || '离线技能', toolName: st.tool, actionSummary: stepLabel }
      );
      syncNativeFloatProgress({
        state: 'acting',
        phase: 'planned',
        step: i + 1,
        appName: skill.name || '离线技能',
        toolName: st.tool,
        summary: `${i + 1}/${steps.length} · ${stepLabel}`,
        thought: `正在离线回放固化技能「${skill.name}」第 ${i + 1} 步`
      });

      const rowEl = addStepItem(cardCtx.stepsList, i + 1, stepLabel, '零 API 本地固化技能回放', native ? '执行中' : '演练中', false, `skill.${st.tool}`);

      if (!native) {
        await sleep(220);
        updateStepResult(rowEl, '演练完成', false, true);
        updateThoughtOutcome(thoughtStepEl, '✓ 演练完成', true, false);
        updateThinkingPhase(cardCtx, 'verify');
        continue;
      }

      let ok = false;
      let detailMsg = '已完成';
      try {
        if (st.tool === 'phone_open' || st.tool === 'launch_app') {
          ok = typeof b.launchAppByName === 'function' ? b.launchAppByName(String(args.appName || '')) : false;
          detailMsg = ok ? `已打开「${args.appName}」` : `打开「${args.appName}」失败`;
        } else if (st.tool === 'phone_tap' || st.tool === 'click_node' || st.tool === 'phone_tap_xy' || st.tool === 'click') {
          const targetTxt = String(args.text || '').trim();
          const targetVid = String(args.viewId || '').trim();
          if (targetTxt && targetTxt.length <= 24 && typeof b.clickByText === 'function') {
            ok = b.clickByText(targetTxt);
            if (ok) detailMsg = `按文本点击「${targetTxt}」`;
          }
          if (!ok && (targetVid || targetTxt || args.desc)) {
            const snap = readAndFormatSnapshot(false);
            const matched = (snap.nodes || []).find((n) =>
              (targetVid && n.viewId === targetVid) ||
              (targetTxt && (n.text === targetTxt || n.desc === targetTxt)) ||
              (args.desc && n.desc === args.desc)
            );
            if (matched && Array.isArray(matched.center) && typeof b.dispatchClick === 'function') {
              ok = b.dispatchClick(matched.center[0], matched.center[1]);
              if (ok) detailMsg = `语义定位点击「${matched.text || matched.desc || targetVid}」`;
            }
          }
          if (!ok && args.rx && args.ry && typeof b.dispatchClick === 'function') {
            const px = Math.round(Number(args.rx) * scrW);
            const py = Math.round(Number(args.ry) * scrH);
            ok = b.dispatchClick(px, py);
            if (ok) detailMsg = `按记忆坐标 (${px}, ${py}) 点击`;
          }
        } else if (st.tool === 'phone_type' || st.tool === 'input') {
          const txt = String(args.text || '');
          ok = typeof b.dispatchSmartInput === 'function'
            ? b.dispatchSmartInput(txt, false, Boolean(args.submit))
            : b.dispatchInputText(String(args.viewId || ''), txt);
          detailMsg = ok ? `已填入「${txt.slice(0, 20)}」` : '输入失败';
        } else if (st.tool === 'phone_scroll' || st.tool === 'scroll') {
          ok = typeof b.scrollScreen === 'function'
            ? b.scrollScreen(String(args.direction || 'down'), Number(args.amount) || 0.65)
            : b.dispatchSwipe(Math.round(scrW * 0.5), Math.round(scrH * 0.72), Math.round(scrW * 0.5), Math.round(scrH * 0.28), 320);
          detailMsg = ok ? `向 ${args.direction || 'down'} 滚动` : '滚动失败';
        } else if (st.tool === 'phone_swipe' || st.tool === 'swipe') {
          const x1 = Math.round((Number(args.rx1) || 0.5) * scrW);
          const y1 = Math.round((Number(args.ry1) || 0.72) * scrH);
          const x2 = Math.round((Number(args.rx2) || 0.5) * scrW);
          const y2 = Math.round((Number(args.ry2) || 0.28) * scrH);
          ok = b.dispatchSwipe(x1, y1, x2, y2, Number(args.duration) || 340);
          detailMsg = ok ? '滑动完成' : '滑动失败';
        } else if (st.tool === 'phone_key' || st.tool === 'key' || st.tool === 'back' || st.tool === 'home') {
          ok = b.dispatchGlobalAction(String(args.key || st.tool || 'back'));
          detailMsg = ok ? `系统键 (${args.key || st.tool})` : '系统键失败';
        } else if (st.tool === 'phone_wait' || st.tool === 'wait') {
          ok = true;
          const ms = Math.min(8000, Math.max(150, Number(args.ms) || 650));
          await nativeSleep(ms, signal);
          detailMsg = `等待 ${ms}ms`;
        } else {
          ok = true;
        }
      } catch (err) {
        ok = false;
        detailMsg = `异常：${err?.message || err}`;
      }

      updateStepResult(rowEl, detailMsg, !ok, ok);
      if (cardCtx.lastThoughtItemEl) {
        updateThoughtOutcome(cardCtx.lastThoughtItemEl, ok ? `✓ ${detailMsg}` : `✕ ${detailMsg}`, ok, !ok);
      }
      updateThinkingPhase(cardCtx, 'verify');
      syncNativeFloatProgress({
        state: 'acting',
        phase: 'verified',
        step: i + 1,
        appName: skill.name || '离线技能',
        toolName: st.tool,
        summary: `${i + 1}/${steps.length} · ${stepLabel}`,
        thought: detailMsg,
        verdictText: ok ? `✓ ${detailMsg}` : `✕ ${detailMsg}`
      });
      await nativeSleep(Math.min(1800, Math.max(150, Number(st.delayMs) || 240)), signal);
    }

    upsertLearnedSkill({ ...skill, runCount: (Number(skill.runCount) || 0) + 1 });
    return {
      status: 'done',
      summaryTitle: `离线技能「${skill.name}」执行完成 (${steps.length} 步)`,
      replyText: native
        ? `已通过本地固化技能「${skill.name}」零 API 离线完成全部 ${steps.length} 步操作。`
        : `已在网页端完成本地技能「${skill.name}」的 ${steps.length} 步离线流程演练（安装随身版 APK 后可在真机免 API 自动执行）。`
    };
  }

  async function executeLearnedSkillOffline(skillId) {
    const skill = loadLearnedSkills().find((s) => s.id === skillId);
    if (!skill) {
      showToast('未找到该本地技能');
      return;
    }
    const label = `执行本地技能：${skill.name}`;
    addUserBubble(label);
    const cardCtx = createAgentCardRow(label, 'local');
    if (!cardCtx) return;

    if (activeAbortController) {
      try { activeAbortController.abort(); } catch {}
    }
    activeAbortController = new AbortController();
    const signal = activeAbortController.signal;
    emergencyStopRequested = false;
    isAgentRunning = true;
    cardCtx.isSkillReplay = true;

    let skillReplaySucceeded = false;
    try {
      const res = await replayLearnedSkill(skill, cardCtx, signal);
      skillReplaySucceeded = res?.status === 'done';
      finalizeAgentTurn(cardCtx, {
        status: res.status,
        summaryTitle: res.summaryTitle,
        replyText: res.replyText,
        isSkillReplay: true
      });
      if (skillReplaySucceeded) {
        syncNativeFloatProgress({
          state: 'idle',
          phase: 'done',
          step: cardCtx.stepCount || 0,
          appName: skill.name || '离线技能',
          toolName: 'done',
          summary: res.summaryTitle || `技能「${skill.name}」完成`,
          thought: (res.replyText || '').slice(0, 120)
        });
      }
    } finally {
      isAgentRunning = false;
      const b = getBridge();
      if (isNativeApk() && b && !skillReplaySucceeded && typeof b.updateFloatState === 'function') {
        try { b.updateFloatState('idle', 'dsh-Go'); } catch {}
      }
      syncStatus();
    }
  }

  function renderEmptyGuideTiles() {
    renderEmptyGuideLearnedSkills();
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

  function parseQuickPhrasesFromText(raw) {
    const clean = String(raw || '').trim();
    if (!clean) return [];
    if (clean.startsWith('[')) {
      try {
        const arr = JSON.parse(clean);
        if (Array.isArray(arr)) {
          const out = [];
          for (const it of arr) {
            const s = String(it || '').trim();
            if (s && !out.includes(s)) out.push(s);
            if (out.length >= 80) break;
          }
          return out;
        }
      } catch {}
    }
    const lines = clean.split(/\r?\n|\|\|\|/);
    const out = [];
    for (const ln of lines) {
      let item = String(ln || '').trim();
      item = item.replace(/^(?:\d+[\.\、\)]\s*|[-*•]\s+)/, '').trim();
      if (item && !out.includes(item)) {
        out.push(item);
        if (out.length >= 80) break;
      }
    }
    return out;
  }

  function loadQuickPhrases() {
    try {
      const bridge = getNativeBridge();
      if (bridge && typeof bridge.getQuickPhrasesJson === 'function') {
        const nativeJson = bridge.getQuickPhrasesJson();
        const parsed = parseQuickPhrasesFromText(nativeJson);
        if (parsed.length > 0) return parsed;
      }
    } catch {}
    try {
      const raw = localStorage.getItem(QUICK_PHRASES_STORAGE_KEY);
      if (raw) {
        const parsed = parseQuickPhrasesFromText(raw);
        if (parsed.length > 0) return parsed;
      }
    } catch {}
    return [...DEFAULT_QUICK_PHRASES];
  }

  function saveQuickPhrases(list) {
    const clean = [];
    for (const s of (Array.isArray(list) ? list : [])) {
      const t = String(s || '').trim();
      if (t && !clean.includes(t)) clean.push(t);
      if (clean.length >= 80) break;
    }
    const json = JSON.stringify(clean);
    try {
      localStorage.setItem(QUICK_PHRASES_STORAGE_KEY, json);
    } catch {}
    try {
      const bridge = getNativeBridge();
      if (bridge && typeof bridge.saveQuickPhrasesJson === 'function') {
        bridge.saveQuickPhrasesJson(json);
      }
    } catch {}
    return clean;
  }

  function loadCustomSongs() {
    try {
      const bridge = getNativeBridge();
      if (bridge && typeof bridge.getCustomSongsJson === 'function') {
        const raw = bridge.getCustomSongsJson();
        const arr = JSON.parse(raw || '[]');
        if (Array.isArray(arr)) return arr;
      }
    } catch {}
    return [];
  }

  window.addEventListener('pa-songs-updated', () => {
    const drawer = $('phone-cmd-quick-drawer');
    if (drawer && !drawer.classList.contains('hidden') && activeCmdLibCategory === 'songs') {
      renderCommandLibraryDrawer();
    }
  });

  function renderCommandLibraryDrawer() {
    const drawer = $('phone-cmd-quick-drawer');
    if (!drawer) return;
    const cat = LOCAL_COMMAND_CATALOG.find((c) => c.id === activeCmdLibCategory) || LOCAL_COMMAND_CATALOG[0];
    const isLearnedTab = cat.id === 'learned';
    const isPhrasesTab = cat.id === 'phrases';
    const isSongsTab = cat.id === 'songs';
    const learnedSkills = isLearnedTab ? loadLearnedSkills() : [];
    const phrases = isPhrasesTab ? loadQuickPhrases() : [];
    const songs = isSongsTab ? loadCustomSongs() : [];

    let bodyHtml = '';
    if (isLearnedTab) {
      bodyHtml = `
        <div class="pa-phrase-toolbar">
          <button type="button" class="pa-phrase-btn is-primary" id="pa-learned-new-btn">➕ 手动新建本地技能</button>
        </div>
        <div class="pa-phrase-list">
          ${learnedSkills.length === 0
            ? '<div class="pa-phrase-empty">还没有固化的本地技能。用 API 模式让 AI 跑通一次工作流后，点击结果卡片下方「✨ 固化为本地技能」即可永久保存在本地免 API 复用！</div>'
            : learnedSkills.map((s) => `
                <div class="pa-phrase-row pa-learned-row" data-skill-id="${escapeHtml(s.id)}">
                  <button type="button" class="pa-phrase-send-btn pa-learned-run-btn" data-skill-id="${escapeHtml(s.id)}" title="口令：${escapeHtml(s.trigger || s.name)}">
                    ▶ ${escapeHtml(s.name)} <small style="opacity:0.7;font-weight:500;">(${s.steps.length}步${s.targetApp ? ` · ${escapeHtml(s.targetApp)}` : ''})</small>
                  </button>
                  <button type="button" class="pa-phrase-fill-btn pa-learned-edit-btn" data-skill-id="${escapeHtml(s.id)}" title="编辑技能">编辑</button>
                  <button type="button" class="pa-phrase-del-btn pa-learned-del-btn" data-skill-id="${escapeHtml(s.id)}" title="删除技能">✕</button>
                </div>
              `).join('')}
        </div>
      `;
    } else if (isSongsTab) {
      const bridge = getNativeBridge();
      const canImportSong = !!(bridge && typeof bridge.openSongImporter === 'function');
      bodyHtml = `
        <div class="pa-phrase-toolbar">
          <button type="button" class="pa-phrase-btn is-primary" id="pa-song-import-btn">🎵 导入手机实际歌声 (MP3/WAV/M4A)</button>
          ${canImportSong ? '<button type="button" class="pa-phrase-btn" id="pa-song-stop-btn">⏹ 停止唱歌</button>' : ''}
        </div>
        <div class="pa-phrase-list">
          ${!canImportSong
            ? '<div class="pa-phrase-empty">请在 Android「DeepSeek · 星语随身版」App 中打开，即可批量导入手机本地真实唱歌音频给大肥鱼献唱</div>'
            : (songs.length === 0
                ? '<div class="pa-phrase-empty">尚未导入外部歌声音频（当前默认内置甜美真人唱词，不再是电子哼调）。点击上方按钮挑几首你喜欢的声音导进来吧！</div>'
                : songs.map((s) => `
                    <div class="pa-phrase-row" data-song-id="${escapeHtml(s.id)}">
                      <button type="button" class="pa-phrase-send-btn pa-song-play-btn" data-song-id="${escapeHtml(s.id)}" title="点击让桌面大肥鱼唱这首">▶ ${escapeHtml(s.title || '未命名歌声')}</button>
                      <button type="button" class="pa-phrase-fill-btn pa-song-rename-btn" data-song-id="${escapeHtml(s.id)}" data-title="${escapeHtml(s.title || '')}" title="改名">改名</button>
                      <button type="button" class="pa-phrase-del-btn pa-song-del-btn" data-song-id="${escapeHtml(s.id)}" title="删除">✕</button>
                    </div>
                  `).join(''))}
        </div>
      `;
    } else if (isPhrasesTab) {
      const bridge = getNativeBridge();
      const canOpenFloatBar = !!(bridge && typeof bridge.openQuickTypingMode === 'function');
      bodyHtml = `
        <div class="pa-phrase-toolbar">
          <button type="button" class="pa-phrase-btn is-primary" id="pa-phrase-add-one">➕ 新增</button>
          <button type="button" class="pa-phrase-btn" id="pa-phrase-import-file">📥 导入TXT文件</button>
          <button type="button" class="pa-phrase-btn" id="pa-phrase-toggle-batch">${quickPhraseBatchBoxOpen ? '收起批量框' : '✏️ 批量粘贴'}</button>
          ${canOpenFloatBar ? '<button type="button" class="pa-phrase-btn is-accent" id="pa-phrase-open-float">⌨️ 桌面快捷条</button>' : ''}
          <input type="file" id="pa-phrase-file-input" accept=".txt,.md,.json,.csv,text/plain,application/json" style="display:none" />
        </div>
        ${quickPhraseBatchBoxOpen ? `
          <div class="pa-phrase-import-box">
            <textarea id="pa-phrase-batch-ta" rows="3" placeholder="每行粘贴一条常用聊天文字（或 JSON 数组），导入后自动同步到桌面大肥鱼悬浮快捷打字条"></textarea>
            <div class="pa-phrase-import-actions">
              <button type="button" class="pa-phrase-btn is-primary" id="pa-phrase-batch-append">追加导入</button>
              <button type="button" class="pa-phrase-btn" id="pa-phrase-batch-replace">覆盖导入</button>
              <button type="button" class="pa-phrase-btn" id="pa-phrase-batch-reset">恢复默认</button>
            </div>
          </div>
        ` : ''}
        <div class="pa-phrase-list">
          ${phrases.length === 0
            ? '<div class="pa-phrase-empty">暂无常用聊天文字，点击上方「导入TXT文件」或「批量粘贴」添加</div>'
            : phrases.map((p, idx) => `
                <div class="pa-phrase-row" data-idx="${idx}">
                  <button type="button" class="pa-phrase-send-btn" data-phrase="${escapeHtml(p)}" title="点击直接打字并发送">${escapeHtml(p)}</button>
                  <button type="button" class="pa-phrase-fill-btn" data-phrase="${escapeHtml(p)}" title="仅填入输入框">填入</button>
                  <button type="button" class="pa-phrase-del-btn" data-idx="${idx}" title="删除此条">✕</button>
                </div>
              `).join('')}
        </div>
      `;
    } else {
      bodyHtml = `
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
    }

    drawer.innerHTML = `
      <div class="pa-cmdlib-topbar">
        <span class="pa-cmdlib-title">快捷指令与常用语</span>
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
      ${bodyHtml}
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

    if (isLearnedTab) {
      drawer.querySelector('#pa-learned-new-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        openSaveSkillModal({
          sourceTask: '新建本地技能',
          recordedSteps: [{ tool: 'phone_open', summary: '打开目标应用', args: { appName: '微信' }, delayMs: 1100 }]
        });
      });
      drawer.querySelectorAll('.pa-learned-run-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const sid = btn.getAttribute('data-skill-id') || '';
          drawer.classList.add('hidden');
          $('pa-open-cmdlib-btn')?.classList.remove('is-active');
          if (sid) executeLearnedSkillOffline(sid);
        });
      });
      drawer.querySelectorAll('.pa-learned-edit-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const sid = btn.getAttribute('data-skill-id') || '';
          const sk = loadLearnedSkills().find((x) => x.id === sid);
          if (sk) openSaveSkillModal({ existingSkill: sk });
        });
      });
      drawer.querySelectorAll('.pa-learned-del-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const sid = btn.getAttribute('data-skill-id') || '';
          if (sid) {
            deleteLearnedSkill(sid);
            renderCommandLibraryDrawer();
            showToast('已删除该本地技能');
          }
        });
      });
    } else if (isSongsTab) {
      drawer.querySelector('#pa-song-import-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        const b = getNativeBridge();
        if (b && typeof b.openSongImporter === 'function') {
          b.openSongImporter();
        } else {
          showToast('请在 Android 随身版 App 中点击导入手机本地真实音频');
        }
      });

      drawer.querySelector('#pa-song-stop-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        const b = getNativeBridge();
        if (b && typeof b.stopCustomSongNow === 'function') {
          b.stopCustomSongNow();
          showToast('已停止大肥鱼歌唱');
        }
      });

      drawer.querySelectorAll('.pa-song-play-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const id = btn.getAttribute('data-song-id') || '';
          const b = getNativeBridge();
          if (b && typeof b.playCustomSongNow === 'function' && id) {
            b.playCustomSongNow(id);
            showToast('大肥鱼已开唱你导入的真实歌声~');
          }
        });
      });

      drawer.querySelectorAll('.pa-song-rename-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const id = btn.getAttribute('data-song-id') || '';
          const curTitle = btn.getAttribute('data-title') || '';
          const nextTitle = window.prompt('请输入新的歌曲显示名称：', curTitle);
          const b = getNativeBridge();
          if (nextTitle && nextTitle.trim() && b && typeof b.renameCustomSong === 'function') {
            b.renameCustomSong(id, nextTitle.trim());
            renderCommandLibraryDrawer();
          }
        });
      });

      drawer.querySelectorAll('.pa-song-del-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const id = btn.getAttribute('data-song-id') || '';
          const b = getNativeBridge();
          if (b && typeof b.deleteCustomSong === 'function' && id) {
            b.deleteCustomSong(id);
            renderCommandLibraryDrawer();
          }
        });
      });
    } else if (isPhrasesTab) {
      drawer.querySelector('#pa-phrase-add-one')?.addEventListener('click', (e) => {
        e.stopPropagation();
        const paInput = $('pa-task-input');
        const chatInput = $('chat-input');
        const currentVal = String((paInput && paInput.offsetParent !== null ? paInput.value : chatInput?.value) || '').trim();
        const text = currentVal || window.prompt('请输入要保存的常用聊天文字：', '');
        if (!text || !String(text).trim()) return;
        const cur = loadQuickPhrases();
        const clean = String(text).trim();
        const next = saveQuickPhrases([clean, ...cur.filter((x) => x !== clean)]);
        showToast(`已保存常用语「${clean}」（共 ${next.length} 条，已同步悬浮窗）`);
        renderCommandLibraryDrawer();
      });

      drawer.querySelector('#pa-phrase-import-file')?.addEventListener('click', (e) => {
        e.stopPropagation();
        drawer.querySelector('#pa-phrase-file-input')?.click();
      });

      drawer.querySelector('#pa-phrase-file-input')?.addEventListener('change', async (e) => {
        const file = e.target?.files?.[0];
        if (!file) return;
        try {
          const text = await file.text();
          const parsed = parseQuickPhrasesFromText(text);
          if (!parsed.length) {
            showToast('文件中未解析到有效聊天文字行');
            return;
          }
          const cur = loadQuickPhrases();
          const merged = saveQuickPhrases([...parsed, ...cur]);
          showToast(`成功从文件导入 ${parsed.length} 条（现共 ${merged.length} 条，已同步大肥鱼）`);
          renderCommandLibraryDrawer();
        } catch {
          showToast('读取文件失败，请确认文件为 UTF-8 文本或 JSON');
        }
      });

      drawer.querySelector('#pa-phrase-toggle-batch')?.addEventListener('click', (e) => {
        e.stopPropagation();
        quickPhraseBatchBoxOpen = !quickPhraseBatchBoxOpen;
        renderCommandLibraryDrawer();
      });

      drawer.querySelector('#pa-phrase-open-float')?.addEventListener('click', (e) => {
        e.stopPropagation();
        const b = getNativeBridge();
        if (b && typeof b.openQuickTypingMode === 'function') {
          drawer.classList.add('hidden');
          b.openQuickTypingMode();
        }
      });

      drawer.querySelector('#pa-phrase-batch-append')?.addEventListener('click', (e) => {
        e.stopPropagation();
        const raw = drawer.querySelector('#pa-phrase-batch-ta')?.value || '';
        const parsed = parseQuickPhrasesFromText(raw);
        if (!parsed.length) {
          showToast('请先输入或粘贴至少一行常用文字');
          return;
        }
        const cur = loadQuickPhrases();
        const next = saveQuickPhrases([...parsed, ...cur]);
        quickPhraseBatchBoxOpen = false;
        showToast(`已追加导入 ${parsed.length} 条（共 ${next.length} 条，已同步桌面悬浮条）`);
        renderCommandLibraryDrawer();
      });

      drawer.querySelector('#pa-phrase-batch-replace')?.addEventListener('click', (e) => {
        e.stopPropagation();
        const raw = drawer.querySelector('#pa-phrase-batch-ta')?.value || '';
        const parsed = parseQuickPhrasesFromText(raw);
        if (!parsed.length) {
          showToast('请先输入或粘贴至少一行常用文字');
          return;
        }
        const next = saveQuickPhrases(parsed);
        quickPhraseBatchBoxOpen = false;
        showToast(`已覆盖导入 ${next.length} 条常用聊天文字`);
        renderCommandLibraryDrawer();
      });

      drawer.querySelector('#pa-phrase-batch-reset')?.addEventListener('click', (e) => {
        e.stopPropagation();
        saveQuickPhrases(DEFAULT_QUICK_PHRASES);
        quickPhraseBatchBoxOpen = false;
        showToast('已恢复默认常用聊天文字');
        renderCommandLibraryDrawer();
      });

      drawer.querySelectorAll('.pa-phrase-send-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const phrase = btn.getAttribute('data-phrase') || '';
          if (phrase) handleCatalogItemTrigger(`打字并发送 ${phrase}`, 'exec');
        });
      });

      drawer.querySelectorAll('.pa-phrase-fill-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const phrase = btn.getAttribute('data-phrase') || '';
          if (!phrase) return;
          const paInput = $('pa-task-input');
          const chatInput = $('chat-input');
          const targetInput = (paInput && paInput.offsetParent !== null) ? paInput : chatInput;
          if (targetInput) {
            targetInput.value = `打字并发送 ${phrase}`;
            targetInput.dispatchEvent(new Event('input', { bubbles: true }));
            targetInput.focus();
          }
          drawer.classList.add('hidden');
          showToast(`已填入「${phrase}」`);
        });
      });

      drawer.querySelectorAll('.pa-phrase-del-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const idx = Number(btn.getAttribute('data-idx'));
          const cur = loadQuickPhrases();
          if (idx >= 0 && idx < cur.length) {
            cur.splice(idx, 1);
            saveQuickPhrases(cur);
            renderCommandLibraryDrawer();
          }
        });
      });
    } else {
      drawer.querySelectorAll('.pa-cmd-item').forEach((itemBtn) => {
        itemBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const cmd = itemBtn.getAttribute('data-cmd') || '';
          const mode = itemBtn.getAttribute('data-mode') || 'exec';
          handleCatalogItemTrigger(cmd, mode);
        });
      });
    }
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
    const cloudCfg = getCloudConfig();
    const native = syncWebEnvironmentGates();
    const b = getBridge();

    // 1. 控制台抽屉内引擎分段按钮选中态
    document.querySelectorAll('.pa-seg-btn').forEach((btn) => {
      const active = btn.dataset.paMode === mode;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', String(active));
    });

    // 三模式表单严格互斥：本地免 API 展示安心状态卡；云端 API 展示接口地址+Key+拉取模型抽屉；DeepSeek API 展示官方直连 Key+V4.1 Flash 抽屉
    const cfgDrawer = $('pa-inline-config-drawer');
    if (cfgDrawer) {
      cfgDrawer.classList.toggle('hidden', mode !== 'api_direct');
    }
    const cloudModelBox = $('pa-cloud-model-box');
    if (cloudModelBox) {
      cloudModelBox.classList.toggle('hidden', mode !== 'api_cloud');
    }
    const cloudUrlInp = $('pa-cloud-baseurl');
    if (cloudUrlInp && !cloudUrlInp.matches(':focus')) {
      cloudUrlInp.value = cloudCfg.baseUrl || '';
    }
    const cloudKeyInp = $('pa-cloud-apikey');
    if (cloudKeyInp && !cloudKeyInp.matches(':focus')) {
      cloudKeyInp.value = cloudCfg.apiKey || '';
    }
    const cloudAutoChk = $('pa-cloud-auto-approve');
    if (cloudAutoChk) {
      cloudAutoChk.checked = Boolean(cloudCfg.autoApprove);
    }
    document.querySelectorAll('#pa-cloud-preset-bar .api-preset-chip').forEach((chip) => {
      const u = String(chip.dataset.paCloudUrl || '').trim();
      chip.classList.toggle('active', Boolean(u && cloudCfg.baseUrl && normalizeChatCompletionsUrl(cloudCfg.baseUrl) === normalizeChatCompletionsUrl(u)));
    });
    const cloudModelSel = $('pa-cloud-model-select');
    if (cloudModelSel && !cloudModelSel.matches(':focus')) {
      const cm = cloudCfg.model;
      if (cm && !Array.from(cloudModelSel.options).some((o) => o.value === cm)) {
        const extraOpt = document.createElement('option');
        extraOpt.value = cm;
        extraOpt.textContent = cm;
        cloudModelSel.appendChild(extraOpt);
      }
      if (Array.from(cloudModelSel.options).some((o) => o.value === cm)) {
        cloudModelSel.value = cm;
      } else if (Array.from(cloudModelSel.options).some((o) => o.value === '')) {
        cloudModelSel.value = '';
      }
    }
    const localPeaceCard = $('pa-local-peace-card');
    if (localPeaceCard) {
      localPeaceCard.classList.toggle('hidden', mode !== 'local');
      const cntEl = $('pa-local-peace-skill-count');
      if (cntEl) cntEl.textContent = String(loadLearnedSkills().length);
    }

    // 2. 同步 DeepSeek 官方直连配置抽屉表单默认值（无需接口地址）
    const keyInp = $('pa-cfg-apikey');
    if (keyInp && !keyInp.matches(':focus')) keyInp.value = cfg.apiKey;
    const modelSel = $('pa-cfg-model');
    if (modelSel && !modelSel.matches(':focus')) modelSel.value = cfg.model || 'deepseek-v4.1-flash';
    try {
      const currentUiMode = document.getElementById('app-shell')?.dataset?.uiMode || '';
      if (currentUiMode === 'phone-agent') {
        window.DeepSeekMonitorPlugin?.syncPhoneAgent?.({
          execMode: mode,
          apiKey: mode === 'api_direct' ? cfg.apiKey : '',
          baseUrl: mode === 'api_direct' ? DEEPSEEK_OFFICIAL_CHAT_URL : '',
          model: mode === 'api_cloud' ? cloudCfg.model : cfg.model
        });
      }
    } catch {}
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
    const policy = getConfirmPolicy();
    const policyLabel = getPolicyLabel(policy);
    if (confirmChip && confirmText) {
      confirmChip.classList.remove('mode-on', 'disabled');
      if (policy === 'auto_turn') {
        confirmChip.classList.add('mode-on');
      } else if (policy === 'ask_every') {
        confirmChip.classList.add('disabled');
      }
      confirmText.textContent = policyLabel;
    }

    const topPolicyLabel = $('pa-policy-pill-label');
    if (topPolicyLabel) topPolicyLabel.textContent = policyLabel;
    const topPolicyPill = $('pa-banner-policy-pill');
    if (topPolicyPill) topPolicyPill.classList.toggle('is-active', policy === 'auto_turn');

    document.querySelectorAll('.pa-policy-card:not(.pa-clarify-card)').forEach((card) => {
      const act = card.dataset.paPolicy === policy;
      card.classList.toggle('active', act);
      card.setAttribute('aria-checked', String(act));
    });
    const clarifyPolicy = getClarifyPolicy();
    document.querySelectorAll('.pa-clarify-card').forEach((card) => {
      const act = card.dataset.paClarify === clarifyPolicy;
      card.classList.toggle('active', act);
      card.setAttribute('aria-checked', String(act));
    });
    renderTrustedAppsList();

    const edgeGlowChk = $('pa-cfg-edge-glow');
    if (edgeGlowChk) edgeGlowChk.checked = isEdgeGlowEnabled();
    const activePersona = getPetPersona();
    applyPetPersonaWebTheme(activePersona);

    const heroTitle = $('pa-empty-hero-title');
    const heroSub = $('pa-empty-hero-sub');
    if (heroTitle && heroSub) {
      if (native && !a11yOk) {
        heroTitle.textContent = '开启无障碍即可代劳控屏';
        heroSub.textContent = '点上方状态栏前往系统开启「DeepSeek · 星语」无障碍服务';
      } else if (activePersona === 'nailong') {
        heroTitle.textContent = 'dsh-Go 手机控屏已就绪 · 🐲 奶龙护航中';
        heroSub.textContent = '透明思考推演与跨应用浮窗同步，密码与支付操作始终交还给你';
      } else {
        heroTitle.textContent = 'dsh-Go 手机控屏已就绪 · 🐳 大肥鱼护航中';
        heroSub.textContent = '支持三档安全确认，密码、支付与验证码操作始终交还给你';
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
    refreshSetupGuideStatus();
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

  function formatParsedSnapshot(parsed) {
    if (!parsed || !Array.isArray(parsed.nodes)) return null;
    const limitedNodes = parsed.nodes.slice(0, 160);
    const formatNodeCompact = (n) => {
      const flags = [];
      if (n.clickable) flags.push('clk');
      if (n.editable) flags.push('edt');
      if (n.scrollable) flags.push('scr');
      if (n.checked) flags.push('chk');
      if (n.selected) flags.push('sel');
      if (n.password) flags.push('pwd');
      const label = [n.text, n.desc].filter(Boolean).join(' / ').slice(0, 48);
      const cx = Array.isArray(n.center) ? n.center[0] : 0;
      const cy = Array.isArray(n.center) ? n.center[1] : 0;
      const flagStr = flags.length ? ` (${flags.join(',')})` : '';
      return `[${n.ref || ''}] ${n.cls || 'View'}${label ? ` "${label}"` : ''}${flagStr} @${cx},${cy}`;
    };

    const rowGroups = [];
    let curRow = null;
    for (const n of limitedNodes) {
      const cy = Array.isArray(n.center) ? Number(n.center[1]) : 0;
      const rowKey = Number(n.row) > 0 ? Number(n.row) : 0;
      if (!curRow || (rowKey > 0 ? curRow.rowKey !== rowKey : Math.abs(cy - curRow.anchorY) > 38)) {
        curRow = { rowKey, anchorY: cy, items: [n] };
        rowGroups.push(curRow);
      } else {
        curRow.items.push(n);
      }
    }

    const lines = rowGroups.map((grp, rIdx) => {
      const sortedItems = grp.items.slice().sort((a, b) => {
        const ax = Array.isArray(a.center) ? Number(a.center[0]) : 0;
        const bx = Array.isArray(b.center) ? Number(b.center[0]) : 0;
        return ax - bx;
      });
      return `R${rIdx + 1}: ${sortedItems.map(formatNodeCompact).join(' | ')}`;
    });

    return {
      snapshotId: String(parsed.snapshotId || ''),
      packageName: String(parsed.packageName || ''),
      appName: String(parsed.appName || parsed.packageName || ''),
      signature: String(parsed.signature || ''),
      eventSeq: Number(parsed.eventSeq) || 0,
      hasSensitiveField: Boolean(parsed.hasSensitiveField),
      sensitiveReason: String(parsed.sensitiveReason || ''),
      nodes: parsed.nodes,
      screenTreeText: lines.join('\n')
    };
  }

  function readAndFormatSnapshot(includeInvisible = false) {
    if (!isNativeApk()) {
      return {
        snapshotId: '',
        packageName: '',
        appName: '网页预览',
        signature: '',
        hasSensitiveField: false,
        sensitiveReason: '',
        nodes: [],
        screenTreeText: ''
      };
    }
    const b = getBridge();
    try {
      if (typeof b.dumpScreenSnapshot === 'function') {
        const raw = b.dumpScreenSnapshot(Boolean(includeInvisible));
        const parsed = JSON.parse(raw);
        const formatted = formatParsedSnapshot(parsed);
        if (formatted) return formatted;
      }
      if (typeof b.dumpScreenHierarchy === 'function') {
        const raw = b.dumpScreenHierarchy(false);
        const parsed = JSON.parse(raw);
        const nodes = Array.isArray(parsed) ? parsed : (parsed?.nodes || []);
        const refNodes = nodes.slice(0, 120).map((n, idx) => ({ ...n, ref: n.ref || `e${idx + 1}` }));
        const lines = refNodes.map((n) => {
          const cx = Array.isArray(n.center) ? n.center[0] : 0;
          const cy = Array.isArray(n.center) ? n.center[1] : 0;
          const label = [n.text, n.desc].filter(Boolean).join(' / ').slice(0, 48);
          return `[${n.ref}] ${String(n.className || 'View').split('.').pop()}${label ? ` "${label}"` : ''} @${cx},${cy}`;
        });
        return {
          snapshotId: '',
          packageName: String(parsed?.packageName || ''),
          appName: String(parsed?.packageName || ''),
          signature: '',
          hasSensitiveField: false,
          sensitiveReason: '',
          nodes: refNodes,
          screenTreeText: lines.join('\n')
        };
      }
    } catch {}
    return {
      snapshotId: '',
      packageName: '',
      appName: '',
      signature: '',
      hasSensitiveField: false,
      sensitiveReason: '',
      nodes: [],
      screenTreeText: ''
    };
  }

  function readScreenNodes() {
    return readAndFormatSnapshot(false).nodes;
  }

  function readScreenMeta() {
    if (!isNativeApk()) return { ok: false, packageName: '', appName: '', signature: '', hasSensitiveField: false, sensitiveReason: '' };
    const b = getBridge();
    try {
      if (typeof b.getScreenMeta === 'function') {
        return JSON.parse(b.getScreenMeta()) || {};
      }
    } catch {}
    return { ok: false, packageName: '', appName: '', signature: '', hasSensitiveField: false, sensitiveReason: '' };
  }

  function readTopPackageFast() {
    if (!isNativeApk()) return '';
    const b = getBridge();
    try {
      if (typeof b.getTopPackageFast === 'function') {
        return String(b.getTopPackageFast() || '');
      }
    } catch {}
    return readScreenMeta().packageName || '';
  }

  function readScreenEventSeq() {
    if (!isNativeApk()) return { seq: 0, pkg: '', ts: 0 };
    const b = getBridge();
    try {
      if (typeof b.getScreenEventSeq === 'function') {
        return JSON.parse(b.getScreenEventSeq()) || { seq: 0, pkg: '', ts: 0 };
      }
    } catch {}
    return { seq: 0, pkg: '', ts: 0 };
  }

  async function waitForScreenVerdict(beforeMeta, toolName, signal, customMaxWait = 0) {
    if (!isNativeApk() || toolName === 'phone_wait' || toolName === 'done' || toolName === 'ask_user') {
      return { changed: true, fromApp: beforeMeta?.appName || '', toApp: beforeMeta?.appName || '', elapsedMs: 0 };
    }
    const maxWait = customMaxWait > 0
      ? customMaxWait
      : (toolName === 'phone_open'
        ? 1100
        : (toolName === 'phone_type'
          ? 420
          : (toolName === 'phone_scroll' || toolName === 'phone_swipe' ? 380 : 420)));
    const b = getBridge();

    // 原生事件驱动屏变检测 + 单次采树缓存（彻底消除 WebView 后台 1000ms 定时器节流与重复扫树）
    if (b && typeof b.waitForScreenVerdictAsync === 'function') {
      const startAt = Date.now();
      return new Promise((resolve) => {
        if (signal?.aborted || emergencyStopRequested) {
          resolve({
            changed: false,
            fromApp: beforeMeta?.appName || '',
            toApp: beforeMeta?.appName || '',
            elapsedMs: 0,
            prefetchedSnapshot: null
          });
          return;
        }
        const reqId = nextNativeReqId('vrd');
        let settled = false;
        const finish = (resObj) => {
          if (settled) return;
          settled = true;
          clearTimeout(guardTimer);
          if (signal) signal.removeEventListener('abort', onAbort);
          const formattedPrefetch = resObj?.prefetchedSnapshot ? formatParsedSnapshot(resObj.prefetchedSnapshot) : null;
          resolve({
            changed: Boolean(resObj?.changed),
            fromApp: beforeMeta?.appName || beforeMeta?.packageName || '',
            toApp: String(resObj?.toApp || resObj?.packageName || beforeMeta?.appName || ''),
            elapsedMs: Number(resObj?.elapsedMs) || (Date.now() - startAt),
            hasSensitiveField: Boolean(resObj?.hasSensitiveField),
            sensitiveReason: String(resObj?.sensitiveReason || ''),
            prefetchedSnapshot: formattedPrefetch
          });
        };
        const onAbort = () => {
          pendingNativeVerdicts.delete(reqId);
          try { b.cancelWaitForScreenVerdict?.(reqId); } catch {}
          finish({ changed: false, elapsedMs: Date.now() - startAt, prefetchedSnapshot: null });
        };
        const guardTimer = setTimeout(() => {
          pendingNativeVerdicts.delete(reqId);
          try { b.cancelWaitForScreenVerdict?.(reqId); } catch {}
          finish({ changed: false, elapsedMs: Date.now() - startAt, prefetchedSnapshot: null });
        }, maxWait + 1200);

        pendingNativeVerdicts.set(reqId, { resolve: finish });
        if (signal) signal.addEventListener('abort', onAbort, { once: true });

        try {
          b.waitForScreenVerdictAsync(
            reqId,
            String(beforeMeta?.packageName || ''),
            String(beforeMeta?.signature || ''),
            Number(beforeMeta?.eventSeq) || 0,
            String(toolName || ''),
            maxWait
          );
        } catch {
          pendingNativeVerdicts.delete(reqId);
          clearTimeout(guardTimer);
          if (signal) signal.removeEventListener('abort', onAbort);
          finish({ changed: false, elapsedMs: Date.now() - startAt, prefetchedSnapshot: null });
        }
      });
    }

    const startAt = Date.now();
    const beforeSeq = Number(beforeMeta?.eventSeq) || 0;
    const hasEventSeqApi = typeof getBridge()?.getScreenEventSeq === 'function';
    let changed = false;
    let latest = beforeMeta || {};
    let checkedMetaOnce = false;

    while (Date.now() - startAt < maxWait) {
      if (signal?.aborted || emergencyStopRequested) break;
      await nativeSleep(55, signal);
      const elapsed = Date.now() - startAt;
      if (hasEventSeqApi && beforeSeq > 0) {
        const ev = readScreenEventSeq();
        if (Number(ev.seq) === beforeSeq && elapsed < 260) {
          continue;
        }
        if (Number(ev.seq) !== beforeSeq) {
          await nativeSleep(toolName === 'phone_open' ? 140 : 50, signal);
          latest = readScreenMeta();
          checkedMetaOnce = true;
          if (
            latest &&
            latest.ok &&
            ((beforeMeta?.packageName && latest.packageName && latest.packageName !== beforeMeta.packageName) ||
              (beforeMeta?.signature && latest.signature && latest.signature !== beforeMeta.signature))
          ) {
            changed = true;
            break;
          }
          continue;
        }
      }
      if (!checkedMetaOnce || elapsed >= maxWait - 100) {
        latest = readScreenMeta();
        checkedMetaOnce = true;
        if (latest && latest.ok) {
          if (
            (beforeMeta?.packageName && latest.packageName && latest.packageName !== beforeMeta.packageName) ||
            (beforeMeta?.signature && latest.signature && latest.signature !== beforeMeta.signature)
          ) {
            changed = true;
            await nativeSleep(50, signal);
            latest = readScreenMeta();
            break;
          }
        }
      }
    }

    if (!checkedMetaOnce) {
      latest = readScreenMeta();
      if (
        latest &&
        latest.ok &&
        ((beforeMeta?.packageName && latest.packageName && latest.packageName !== beforeMeta.packageName) ||
          (beforeMeta?.signature && latest.signature && latest.signature !== beforeMeta.signature))
      ) {
        changed = true;
      }
    }

    return {
      changed,
      fromApp: beforeMeta?.appName || beforeMeta?.packageName || '',
      toApp: latest?.appName || latest?.packageName || '',
      elapsedMs: Date.now() - startAt,
      hasSensitiveField: Boolean(latest?.hasSensitiveField),
      sensitiveReason: String(latest?.sensitiveReason || '')
    };
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

  function appendUserMessageRow(text, isInterject = false) {
    const container = $('messages-container');
    if (!container) return;
    document.querySelector('.chat-stage')?.classList.remove('ds-empty-mode');

    const row = document.createElement('div');
    row.className = `msg-row user pa-user-row ${isInterject ? 'pa-interject-row' : ''}`;

    const wrap = document.createElement('div');
    wrap.className = 'user-msg-wrap';

    const bodyEl = document.createElement('div');
    bodyEl.className = 'msg-body';
    bodyEl.textContent = isInterject ? `插话：${String(text || '')}` : String(text || '');

    wrap.appendChild(bodyEl);
    row.appendChild(wrap);
    paSessionNodes.push(row);
    container.appendChild(row);
    syncEmptyGuideVisibility();
    scrollChatToBottom();
  }

  function updateQueueBarUi() {
    const bar = $('pa-queue-bar');
    const txtEl = $('pa-queue-text');
    if (!bar || !txtEl) return;
    if (!isAgentRunning || queuedInterjections.length === 0) {
      bar.classList.add('hidden');
      txtEl.textContent = '';
      return;
    }
    const latest = queuedInterjections[queuedInterjections.length - 1];
    txtEl.textContent = queuedInterjections.length > 1
      ? `${latest.text}（共 ${queuedInterjections.length} 条待注入）`
      : latest.text;
    bar.classList.remove('hidden');
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
    card.className = 'pa-dsh-turn';
    card.innerHTML = `
      <div class="pa-thinking-box is-thinking">
        <div class="pa-thinking-head" role="button" tabindex="0" aria-expanded="true">
          <span class="pa-thinking-dot" aria-hidden="true"></span>
          <span class="pa-thinking-title">正在深度思考…</span>
          <span class="pa-thinking-timer">0.0s</span>
          <span class="pa-thinking-chevron" aria-hidden="true">▾</span>
        </div>
        <div class="pa-phase-strip" aria-label="执行阶段进度">
          <span class="pa-phase-pill is-active" data-phase="inspect">1 识屏</span>
          <span class="pa-phase-pill" data-phase="think">2 思考</span>
          <span class="pa-phase-pill" data-phase="act">3 执行</span>
          <span class="pa-phase-pill" data-phase="verify">4 核验</span>
        </div>
        <div class="pa-thinking-list"></div>
      </div>
      <div class="pa-trace-accordion is-running">
        <div class="pa-trace-summary" role="button" tabindex="0" aria-expanded="true">
          <div class="pa-trace-sum-left">
            <span class="pa-trace-pulse" aria-hidden="true"></span>
            <span class="pa-trace-sum-text">正在规划：${escapeHtml(taskText)}</span>
          </div>
          <div class="pa-trace-sum-right">
            <span class="pa-trace-meta">${escapeHtml(getEngineLabel(execMode))}</span>
            <button type="button" class="pa-banner-btn subtle pa-card-stop-btn" style="padding:3px 9px;font-size:11px;">停止</button>
            <span class="pa-trace-chevron" aria-hidden="true">▾</span>
          </div>
        </div>
        <div class="pa-trace-body">
          <div class="pa-steps-list pa-trace-list"></div>
          <div class="pa-confirm-slot"></div>
          <div class="pa-fix-slot"></div>
        </div>
      </div>
      <div class="pa-final-reply hidden"></div>
    `;

    const thinkingBox = card.querySelector('.pa-thinking-box');
    const thinkingHead = card.querySelector('.pa-thinking-head');
    thinkingHead?.addEventListener('click', () => {
      const collapsed = thinkingBox.classList.toggle('is-collapsed');
      thinkingHead.setAttribute('aria-expanded', String(!collapsed));
    });

    const accordion = card.querySelector('.pa-trace-accordion');
    const summaryEl = card.querySelector('.pa-trace-summary');
    summaryEl?.addEventListener('click', (e) => {
      if (e.target.closest('.pa-card-stop-btn')) return;
      const collapsed = accordion.classList.toggle('is-collapsed');
      summaryEl.setAttribute('aria-expanded', String(!collapsed));
    });

    bodyEl.appendChild(card);
    row.appendChild(avatarEl);
    row.appendChild(bodyEl);
    paSessionNodes.push(row);
    container.appendChild(row);
    syncEmptyGuideVisibility();
    scrollChatToBottom();

    const startedAt = Date.now();
    const thinkingTimerEl = card.querySelector('.pa-thinking-timer');
    let timerHandle = null;
    if (typeof window !== 'undefined' && typeof requestAnimationFrame === 'function' && thinkingTimerEl) {
      timerHandle = setInterval(() => {
        if (!card.isConnected) {
          clearInterval(timerHandle);
          return;
        }
        thinkingTimerEl.textContent = `${((Date.now() - startedAt) / 1000).toFixed(1)}s`;
      }, 250);
      timerHandle?.unref?.();
    }

    return {
      row,
      card,
      thinkingBox,
      thinkingHead,
      thinkingTitleEl: card.querySelector('.pa-thinking-title'),
      thinkingTimerEl,
      phaseStripEl: card.querySelector('.pa-phase-strip'),
      thinkingList: card.querySelector('.pa-thinking-list'),
      accordion,
      summaryEl,
      summaryTextEl: card.querySelector('.pa-trace-sum-text'),
      summaryMetaEl: card.querySelector('.pa-trace-meta'),
      stepsList: card.querySelector('.pa-steps-list'),
      confirmSlot: card.querySelector('.pa-confirm-slot'),
      fixSlot: card.querySelector('.pa-fix-slot'),
      stopBtn: card.querySelector('.pa-card-stop-btn'),
      finalReplyEl: card.querySelector('.pa-final-reply'),
      startedAt,
      timerHandle,
      lastThoughtItemEl: null,
      stepCount: 0,
      thoughtCount: 0
    };
  }

  const PA_PHASE_ORDER = ['inspect', 'think', 'act', 'verify'];

  function updateThinkingPhase(cardCtx, activePhase = 'inspect') {
    if (!cardCtx) return;
    if (cardCtx.thinkingTimerEl && cardCtx.startedAt) {
      cardCtx.thinkingTimerEl.textContent = `${((Date.now() - cardCtx.startedAt) / 1000).toFixed(1)}s`;
    }
    if (!cardCtx.phaseStripEl || typeof cardCtx.phaseStripEl.querySelectorAll !== 'function') return;
    const targetIdx = activePhase === 'done_all' ? PA_PHASE_ORDER.length : PA_PHASE_ORDER.indexOf(activePhase);
    cardCtx.phaseStripEl.querySelectorAll('.pa-phase-pill').forEach((pill) => {
      const p = pill?.dataset?.phase || '';
      const idx = PA_PHASE_ORDER.indexOf(p);
      pill.classList.remove('is-active', 'is-done');
      if (activePhase === 'done_all') {
        pill.classList.add('is-done');
      } else if (idx >= 0 && targetIdx >= 0) {
        if (idx < targetIdx) pill.classList.add('is-done');
        else if (idx === targetIdx) pill.classList.add('is-active');
      }
    });
  }

  function appendThoughtItem(cardCtx, stepLabel, thoughtText, reasoningText = '', meta = {}) {
    if (!cardCtx || !cardCtx.thinkingList) return null;
    const cleanThought = String(thoughtText || '').trim();
    const cleanReason = String(reasoningText || '').trim();
    if (!cleanThought && !cleanReason) return null;

    cardCtx.thoughtCount = (cardCtx.thoughtCount || 0) + 1;
    if (cardCtx.thinkingBox) cardCtx.thinkingBox.classList.remove('hidden');
    const appChip = String(meta?.appName || '').trim();
    const toolName = String(meta?.toolName || '').trim();
    const actionSummary = String(meta?.actionSummary || '').trim();
    const intentLabel = toolName ? inferToolActionLabel(toolName, actionSummary) : '';

    if (cardCtx.thinkingTitleEl) {
      cardCtx.thinkingTitleEl.textContent = appChip
        ? `正在思考 · ${appChip} · 第 ${cardCtx.thoughtCount} 步`
        : `思考过程 · 第 ${cardCtx.thoughtCount} 步`;
    }
    if (cardCtx.thinkingTimerEl && cardCtx.startedAt) {
      cardCtx.thinkingTimerEl.textContent = `${((Date.now() - cardCtx.startedAt) / 1000).toFixed(1)}s`;
    }

    const item = document.createElement('div');
    item.className = 'pa-thinking-item';
    item.innerHTML = `
      <span class="pa-tl-node" aria-hidden="true"></span>
      <div class="pa-thought-meta-row">
        <span class="pa-thinking-step-tag">${escapeHtml(stepLabel || `推理 ${cardCtx.thoughtCount}`)}</span>
        ${appChip ? `<span class="pa-thought-app-chip">${escapeHtml(appChip)}</span>` : ''}
        ${intentLabel ? `<span class="pa-thought-intent">${escapeHtml(intentLabel)}</span>` : ''}
      </div>
      <div class="pa-thinking-text">${escapeHtml(cleanThought || cleanReason.slice(0, 220))}</div>
      ${cleanReason && cleanThought && cleanReason !== cleanThought
        ? `<div class="pa-thinking-raw">${escapeHtml(cleanReason.slice(0, 500))}</div>`
        : ''}
      <div class="pa-thought-outcome hidden"></div>
    `;
    cardCtx.thinkingList.appendChild(item);
    cardCtx.lastThoughtItemEl = item;
    while (cardCtx.thinkingList.children.length > 20) {
      cardCtx.thinkingList.firstElementChild?.remove();
    }
    scrollChatToBottom();
    return item;
  }

  function updateThoughtOutcome(thoughtEl, outcomeText, changed = null, isError = false) {
    if (!thoughtEl || typeof thoughtEl.querySelector !== 'function') return;
    const outcomeEl = thoughtEl.querySelector('.pa-thought-outcome');
    if (!outcomeEl) return;
    const clean = String(outcomeText || '').trim();
    if (!clean) return;
    outcomeEl.classList.remove('hidden', 'is-changed', 'is-same', 'is-error');
    if (isError) {
      outcomeEl.classList.add('is-error');
    } else if (changed === true) {
      outcomeEl.classList.add('is-changed');
    } else {
      outcomeEl.classList.add('is-same');
    }
    outcomeEl.textContent = clean;
  }

  function addStepItem(stepsList, stepNum, summary, thought, statusText, isError = false, toolName = 'step') {
    if (!stepsList) return null;
    const item = document.createElement('div');
    item.className = 'pa-trace-step';
    item.innerHTML = `
      <div class="pa-trace-step-head">
        <div class="pa-trace-step-main">
          <span class="pa-tool-badge">${escapeHtml(toolName)}</span>
          <span class="pa-step-desc">${escapeHtml(summary)}</span>
        </div>
        <span class="pa-verdict-badge ${isError ? 'is-error' : 'is-same'}">${escapeHtml(statusText)}</span>
      </div>
      <div class="pa-trace-step-detail">
        ${thought ? `<div class="pa-step-thought">${escapeHtml(thought)}</div>` : '<div class="pa-step-thought"></div>'}
        <div class="pa-step-result ${isError ? 'is-error' : ''}">${escapeHtml(statusText)}</div>
      </div>
    `;
    item.addEventListener('click', () => {
      item.classList.toggle('is-detail-open');
    });
    stepsList.appendChild(item);
    while (stepsList.children.length > 24) {
      const oldestVisible = Array.from(stepsList.children).find((el) => !el.classList.contains('hidden'));
      if (!oldestVisible || oldestVisible === item) break;
      oldestVisible.classList.add('hidden');
      if (stepsList.querySelectorAll(':scope > :not(.hidden)').length <= 24) break;
    }
    scrollChatToBottom();
    return item;
  }

  function updateStepResult(stepEl, statusText, isError = false, verdictChanged = null) {
    if (!stepEl) return;
    const badgeEl = stepEl.querySelector('.pa-verdict-badge');
    if (badgeEl) {
      badgeEl.classList.remove('is-changed', 'is-same', 'is-error');
      if (isError) {
        badgeEl.classList.add('is-error');
        badgeEl.textContent = '失败';
      } else if (verdictChanged === true) {
        badgeEl.classList.add('is-changed');
        badgeEl.textContent = '画面已更新';
      } else if (verdictChanged === false) {
        badgeEl.classList.add('is-same');
        badgeEl.textContent = '画面未变';
      } else {
        badgeEl.classList.add('is-same');
        badgeEl.textContent = statusText.slice(0, 12);
      }
    }
    const resEl = stepEl.querySelector('.pa-step-result');
    if (resEl) {
      resEl.textContent = statusText;
      resEl.classList.toggle('is-error', Boolean(isError));
    }
    scrollChatToBottom();
  }

  function finalizeAgentTurn(cardCtx, { status = 'done', summaryTitle = '', replyText = '', handoverCb = null, recordedSteps = null, sourceTask = '', isSkillReplay = false, isChatOnly = false, quickAction = null } = {}) {
    if (!cardCtx) return;
    if (cardCtx.timerHandle) {
      clearInterval(cardCtx.timerHandle);
      cardCtx.timerHandle = null;
    }
    const elapsedSec = ((Date.now() - (cardCtx.startedAt || Date.now())) / 1000).toFixed(1);
    if (cardCtx.thinkingTimerEl) {
      cardCtx.thinkingTimerEl.textContent = `${elapsedSec}s`;
    }
    updateThinkingPhase(cardCtx, status === 'done' ? 'done_all' : '');
    if (cardCtx.thinkingBox) {
      cardCtx.thinkingBox.classList.remove('is-thinking');
      if ((cardCtx.thoughtCount || 0) === 0) {
        cardCtx.thinkingBox.classList.add('hidden');
      } else if (cardCtx.thinkingTitleEl) {
        cardCtx.thinkingTitleEl.textContent = `已完成思考（${cardCtx.thoughtCount} 步推理 · ${elapsedSec}s）`;
      }
    }
    const acc = cardCtx.accordion;
    if (acc) {
      if (isChatOnly) {
        acc.classList.add('hidden');
      } else {
        acc.classList.remove('is-running', 'is-done', 'is-error');
        acc.classList.add(status === 'error' ? 'is-error' : 'is-done');
        if (status === 'done' && cardCtx.stepCount > 0) {
          acc.classList.add('is-collapsed');
          cardCtx.summaryEl?.setAttribute('aria-expanded', 'false');
        }
      }
    }
    if (cardCtx.summaryTextEl && summaryTitle) {
      cardCtx.summaryTextEl.textContent = summaryTitle;
    }
    if (cardCtx.summaryMetaEl) {
      cardCtx.summaryMetaEl.textContent = `${cardCtx.stepCount || 0} 步 · ${elapsedSec}s`;
    }
    if (cardCtx.stopBtn && !isNativeAutoSwiping()) {
      cardCtx.stopBtn.classList.add('hidden');
    }
    const validSteps = Array.isArray(recordedSteps) ? recordedSteps : [];
    const canSaveSkill = !isSkillReplay && !isChatOnly && validSteps.length >= 1;
    const hasQuickAction = Boolean(quickAction && quickAction.label && typeof quickAction.onClick === 'function');
    if (cardCtx.finalReplyEl && (replyText || typeof handoverCb === 'function' || canSaveSkill || hasQuickAction)) {
      cardCtx.finalReplyEl.classList.remove('hidden');
      cardCtx.finalReplyEl.classList.toggle('pa-chat-reply', Boolean(isChatOnly));
      cardCtx.finalReplyEl.innerHTML = `
        ${replyText ? `<div class="pa-reply-prose">${escapeHtml(replyText).replace(/\n/g, '<br/>')}</div>` : ''}
        ${hasQuickAction ? `
          <div class="pa-local-action-bar">
            <button type="button" class="pa-banner-btn outline pa-local-quick-action-btn">${escapeHtml(quickAction.label)}</button>
          </div>
        ` : ''}
        ${typeof handoverCb === 'function' ? `
          <div class="pa-handover-bar">
            <button type="button" class="pa-banner-btn pa-handover-resume-btn">我已完成，继续执行</button>
          </div>
        ` : ''}
        ${canSaveSkill ? `
          <div class="pa-save-skill-bar">
            <button type="button" class="pa-save-skill-btn">✨ 固化为本地技能（免 API 离线可复用 · ${validSteps.length} 步）</button>
          </div>
        ` : ''}
      `;
      if (hasQuickAction) {
        cardCtx.finalReplyEl.querySelector('.pa-local-quick-action-btn')?.addEventListener('click', () => {
          quickAction.onClick();
        });
      }
      if (typeof handoverCb === 'function') {
        cardCtx.finalReplyEl.querySelector('.pa-handover-resume-btn')?.addEventListener('click', (e) => {
          e.currentTarget.disabled = true;
          e.currentTarget.textContent = '正在继续…';
          handoverCb();
        });
      }
      if (canSaveSkill) {
        cardCtx.finalReplyEl.querySelector('.pa-save-skill-btn')?.addEventListener('click', () => {
          openSaveSkillModal({
            sourceTask: sourceTask || cardCtx.sourceTask || '',
            recordedSteps: validSteps
          });
        });
      }
    }
    scrollChatToBottom();
  }

  function renderA11yGuideCard(taskText) {
    pendingTaskAfterA11y = taskText;
    const cardCtx = createAgentCardRow(taskText, getExecMode());
    if (!cardCtx) return;
    if (cardCtx.accordion) cardCtx.accordion.classList.add('is-collapsed');
    if (cardCtx.summaryTextEl) cardCtx.summaryTextEl.textContent = '需要开启手机无障碍权限';
    if (cardCtx.stopBtn) cardCtx.stopBtn.classList.add('hidden');

    if (cardCtx.finalReplyEl) {
      cardCtx.finalReplyEl.classList.remove('hidden');
      cardCtx.finalReplyEl.innerHTML = `
        <div class="pa-a11y-guide-card" id="pa-inline-a11y-card">
          <div class="pa-a11y-guide-title">请先开启「DeepSeek · 星语」无障碍服务</div>
          <div class="pa-a11y-guide-desc">dsh-Go 需要无障碍权限来读取屏幕元素并替你点按滑动。开启后返回本页面，卡片会自动刷新状态。</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:2px;">
            <button type="button" class="pa-banner-btn pa-guide-open-a11y">前往系统开启无障碍</button>
            <button type="button" class="pa-banner-btn outline pa-guide-resume-task hidden">无障碍已就绪 · 继续执行任务</button>
          </div>
        </div>
      `;
      cardCtx.finalReplyEl.querySelector('.pa-guide-open-a11y')?.addEventListener('click', () => {
        const b = getBridge();
        if (b && typeof b.openAccessibilitySettings === 'function') {
          b.openAccessibilitySettings();
        }
      });
      cardCtx.finalReplyEl.querySelector('.pa-guide-resume-task')?.addEventListener('click', () => {
        const pending = pendingTaskAfterA11y || taskText;
        pendingTaskAfterA11y = '';
        executeTaskInChat(pending);
      });
    }
    scrollChatToBottom();
  }

  function getSetupPermissionsState() {
    const native = isNativeApk();
    const b = getBridge();
    if (!native || !b) {
      return { native: false, a11yOk: false, overlayOk: false, floatOn: false };
    }
    let a11yOk = false;
    let overlayOk = true;
    let floatOn = false;
    try {
      a11yOk = Boolean(b.isAccessibilityEnabled && b.isAccessibilityEnabled());
      if (typeof b.hasOverlayPermission === 'function') {
        overlayOk = Boolean(b.hasOverlayPermission());
      }
      floatOn = Boolean(b.isFloatAgentRunning && b.isFloatAgentRunning());
    } catch {}
    return { native: true, a11yOk, overlayOk, floatOn };
  }

  let setupGuideCurrentStep = 1;
  let setupGuideAutoTriggered = false;

  function refreshSetupGuideStatus(showReadyToast = false) {
    const modal = document.getElementById('pa-onboarding-guide-modal');
    if (!modal) return;
    const perms = getSetupPermissionsState();

    const step1Pill = modal.querySelector('[data-guide-step="1"]');
    const step2Pill = modal.querySelector('[data-guide-step="2"]');
    const step3Pill = modal.querySelector('[data-guide-step="3"]');
    if (step1Pill) step1Pill.classList.toggle('is-done', perms.a11yOk);
    if (step2Pill) step2Pill.classList.toggle('is-done', perms.overlayOk && perms.floatOn);

    const s1Status = modal.querySelector('#pa-guide-s1-status');
    if (s1Status) {
      s1Status.className = `pa-guide-status-bar ${perms.a11yOk ? 'is-ok' : 'is-pending'}`;
      s1Status.innerHTML = perms.native
        ? (perms.a11yOk ? '<span>✅ 无障碍服务已开启，可以读取并操作屏幕</span>' : '<span>⚠️ 无障碍服务尚未开启（必须开启后才能代劳控屏）</span>')
        : '<span>ℹ️ 当前为网页端预览；在安卓随身版 APK 中可一键直达系统设置</span>';
    }

    const s2Status = modal.querySelector('#pa-guide-s2-status');
    if (s2Status) {
      const ok = perms.overlayOk && perms.floatOn;
      s2Status.className = `pa-guide-status-bar ${ok ? 'is-ok' : (perms.overlayOk ? 'is-ok' : 'is-pending')}`;
      s2Status.innerHTML = perms.native
        ? (perms.floatOn
            ? '<span>✅ 悬浮窗权限已授权，桌面悬浮球正在运行</span>'
            : (perms.overlayOk
                ? '<span>✅ 已允许悬浮窗权限，点击下方按钮即可启动悬浮球</span>'
                : '<span>⚠️ 悬浮窗权限尚未授权（用于跨 App 弹窗确认与急停）</span>'))
        : '<span>ℹ️ 当前为网页端预览；在安卓随身版 APK 中可一键开启桌面悬浮窗</span>';
    }

    if (showReadyToast && setupGuideCurrentStep === 1 && perms.a11yOk) {
      showToast('无障碍服务已开启！可点击「下一步」继续开启悬浮窗');
    }
    if (step3Pill && perms.a11yOk && perms.overlayOk) {
      step3Pill.classList.add('is-done');
    }
  }

  function openSetupGuideWizard(initialStep = 1) {
    document.getElementById('pa-onboarding-guide-modal')?.remove();
    const perms = getSetupPermissionsState();
    let step = Number(initialStep) || (perms.native && perms.a11yOk && !perms.overlayOk ? 2 : 1);
    if (step < 1 || step > 3) step = 1;
    setupGuideCurrentStep = step;

    const modal = document.createElement('div');
    modal.id = 'pa-onboarding-guide-modal';
    modal.className = 'pa-modal-backdrop';

    const markGuideDone = () => {
      try { localStorage.setItem(STORAGE_KEYS.setupGuideDone, '1'); } catch {}
    };

    const closeWizard = () => {
      markGuideDone();
      modal.remove();
    };

    const renderStepBody = () => {
      setupGuideCurrentStep = step;
      const p = getSetupPermissionsState();
      modal.querySelectorAll('.pa-guide-step-pill').forEach((el) => {
        const s = Number(el.getAttribute('data-guide-step'));
        el.classList.toggle('is-active', s === step);
      });

      const bodyEl = modal.querySelector('#pa-guide-modal-body');
      const footEl = modal.querySelector('#pa-guide-modal-foot');
      if (!bodyEl || !footEl) return;

      if (step === 1) {
        bodyEl.innerHTML = `
          <div class="pa-guide-status-bar ${p.a11yOk ? 'is-ok' : 'is-pending'}" id="pa-guide-s1-status"></div>
          <div class="pa-modal-title">第 1 步：开启「DeepSeek · 星语」无障碍服务</div>
          <ol class="pa-guide-steps-ol">
            <li>点击下方<strong>「前往系统无障碍设置」</strong>按钮直达设置页面。</li>
            <li>在列表中找到<strong>「已下载的应用」</strong>或<strong>「已安装的服务」</strong>。</li>
            <li>点进<strong>「DeepSeek · 星语」</strong>，打开开关并点击允许。</li>
            <li>返回星语 App，此处状态会自动变绿 ✅。</li>
          </ol>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button type="button" class="pa-banner-btn" id="pa-guide-go-a11y">前往系统无障碍设置</button>
            <button type="button" class="pa-banner-btn outline" id="pa-guide-recheck-1">刷新检测状态</button>
          </div>
        `;
        footEl.innerHTML = `
          <button type="button" class="pa-banner-btn subtle" id="pa-guide-skip-btn">暂不设置</button>
          <button type="button" class="pa-banner-btn" id="pa-guide-next-btn">下一步：悬浮窗 →</button>
        `;
        bodyEl.querySelector('#pa-guide-go-a11y')?.addEventListener('click', () => {
          const b = getBridge();
          if (p.native && b && typeof b.openAccessibilitySettings === 'function') {
            b.openAccessibilitySettings();
          } else {
            showToast('当前为网页端；请在 Android 随身版 APK 中点击直达无障碍设置');
          }
        });
        bodyEl.querySelector('#pa-guide-recheck-1')?.addEventListener('click', () => {
          syncStatus();
          refreshSetupGuideStatus(true);
        });
      } else if (step === 2) {
        bodyEl.innerHTML = `
          <div class="pa-guide-status-bar ${(p.overlayOk && p.floatOn) ? 'is-ok' : 'is-pending'}" id="pa-guide-s2-status"></div>
          <div class="pa-modal-title">第 2 步：开启桌面悬浮窗（强烈推荐）</div>
          <ol class="pa-guide-steps-ol">
            <li>悬浮窗权限允许星语在你使用微信、学习软件或外卖软件时，<strong>直接在当前屏幕上方弹出确认框或急停球</strong>。</li>
            <li>若尚未授权，点击下方<strong>「前往授权悬浮窗」</strong>并打开允许开关。</li>
            <li>授权后点击<strong>「立即启动悬浮窗」</strong>，大肥鱼悬浮球就会常驻在屏幕侧边。</li>
          </ol>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button type="button" class="pa-banner-btn" id="pa-guide-go-overlay">${p.overlayOk ? '立即启动悬浮窗' : '前往授权并开启悬浮窗'}</button>
            <button type="button" class="pa-banner-btn outline" id="pa-guide-recheck-2">刷新检测状态</button>
          </div>
        `;
        footEl.innerHTML = `
          <button type="button" class="pa-banner-btn outline" id="pa-guide-prev-btn">← 上一步</button>
          <button type="button" class="pa-banner-btn" id="pa-guide-next-btn">下一步：使用技巧 →</button>
        `;
        bodyEl.querySelector('#pa-guide-go-overlay')?.addEventListener('click', () => {
          const b = getBridge();
          const cur = getSetupPermissionsState();
          if (!cur.native || !b) {
            showToast('当前为网页端；请在 Android 随身版 APK 中开启悬浮窗');
            return;
          }
          if (!cur.overlayOk && typeof b.requestOverlayPermission === 'function') {
            b.requestOverlayPermission();
            showToast('请在系统设置中允许「显示在其他应用上层」后返回');
          } else if (typeof b.startFloatAgent === 'function') {
            b.startFloatAgent();
            showToast('已启动桌面多功能悬浮窗！');
            setTimeout(() => { syncStatus(); refreshSetupGuideStatus(false); }, 300);
          }
        });
        bodyEl.querySelector('#pa-guide-recheck-2')?.addEventListener('click', () => {
          syncStatus();
          refreshSetupGuideStatus(false);
        });
      } else {
        bodyEl.innerHTML = `
          <div class="pa-modal-title">第 3 步：30 秒上手 · 让 AI 顺畅干活</div>
          <div class="pa-guide-tip-grid">
            <div class="pa-guide-tip-item"><strong>1. 模糊任务先确认再跳走：</strong>发「帮我点外卖 / 写作业」时，AI 会先停在当前页向你确认细节，确认完再顺畅切 App。</div>
            <div class="pa-guide-tip-item"><strong>2. 卡顿会主动问你：</strong>如果中途遇到按钮点不动或页面来回跳，AI 会自动暂停并弹窗问你的指示，不会死循环瞎点。</div>
            <div class="pa-guide-tip-item"><strong>3. 本地免 API 也能聊天：</strong>问时间、算算数、聊日常或点「打开微信/音量加/截屏」无需消耗任何 API 额度。</div>
          </div>
        `;
        footEl.innerHTML = `
          <button type="button" class="pa-banner-btn outline" id="pa-guide-prev-btn">← 上一步</button>
          <button type="button" class="pa-banner-btn" id="pa-guide-finish-btn">完成，开始使用</button>
        `;
      }

      footEl.querySelector('#pa-guide-skip-btn')?.addEventListener('click', closeWizard);
      footEl.querySelector('#pa-guide-prev-btn')?.addEventListener('click', () => {
        step = Math.max(1, step - 1);
        renderStepBody();
      });
      footEl.querySelector('#pa-guide-next-btn')?.addEventListener('click', () => {
        step = Math.min(3, step + 1);
        renderStepBody();
      });
      footEl.querySelector('#pa-guide-finish-btn')?.addEventListener('click', () => {
        closeWizard();
        showToast('新手指引已完成，随时可以在控制台重新查看~');
      });

      refreshSetupGuideStatus(false);
    };

    modal.innerHTML = `
      <div class="pa-modal-dialog" role="dialog" aria-modal="true" aria-label="手机辅助新手指引">
        <div class="pa-modal-head">
          <div class="pa-modal-badge is-info">手机辅助 · 新手指引</div>
          <button type="button" class="pa-sheet-close-btn" id="pa-guide-close-x" aria-label="关闭新手指引">✕</button>
        </div>
        <div style="padding:12px 16px 0;">
          <div class="pa-guide-stepper">
            <button type="button" class="pa-guide-step-pill" data-guide-step="1">1. 无障碍</button>
            <button type="button" class="pa-guide-step-pill" data-guide-step="2">2. 悬浮窗</button>
            <button type="button" class="pa-guide-step-pill" data-guide-step="3">3. 上手技巧</button>
          </div>
        </div>
        <div class="pa-modal-body" id="pa-guide-modal-body"></div>
        <div class="pa-modal-foot" id="pa-guide-modal-foot"></div>
      </div>
    `;
    document.body.appendChild(modal);

    modal.querySelectorAll('.pa-guide-step-pill').forEach((btn) => {
      btn.addEventListener('click', () => {
        step = Number(btn.getAttribute('data-guide-step')) || 1;
        renderStepBody();
      });
    });
    modal.querySelector('#pa-guide-close-x')?.addEventListener('click', closeWizard);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeWizard();
    });

    renderStepBody();
  }

  function maybeAutoShowSetupGuide() {
    if (setupGuideAutoTriggered) return;
    if (!isNativeApk()) return;
    try {
      if (localStorage.getItem(STORAGE_KEYS.setupGuideDone) === '1') return;
    } catch {}
    const perms = getSetupPermissionsState();
    if (perms.a11yOk && perms.overlayOk) return;
    setupGuideAutoTriggered = true;
    setTimeout(() => {
      const shell = document.getElementById('app-shell');
      if (shell && shell.dataset.uiMode === 'phone-agent' && !document.getElementById('pa-onboarding-guide-modal')) {
        openSetupGuideWizard(perms.a11yOk ? 2 : 1);
      }
    }, 650);
  }

  function formatActionCodeDesc(plan) {
    const tool = plan?.tool || plan?.action || 'done';
    const p = plan?.args || plan?.params || {};
    if (tool === 'phone_open' || tool === 'launch_app') return `phone.open("${p.appName || ''}")`;
    if (tool === 'phone_tap' || tool === 'click_node') return `phone.tap(ref="${p.ref || p.text || ''}")`;
    if (tool === 'phone_tap_xy' || tool === 'click') return `phone.tap_xy(${p.x || 0}, ${p.y || 0})`;
    if (tool === 'phone_double_tap') return `phone.double_tap(${p.x || 0}, ${p.y || 0})`;
    if (tool === 'phone_long_press' || tool === 'long_click') return `phone.long_press(${p.ref || `${p.x || 0},${p.y || 0}`})`;
    if (tool === 'phone_type' || tool === 'input') return `phone.type("${String(p.text || '').slice(0, 32)}")`;
    if (tool === 'phone_scroll') return `phone.scroll("${p.direction || 'down'}")`;
    if (tool === 'phone_swipe' || tool === 'swipe') return `phone.swipe(${p.x1},${p.y1} -> ${p.x2},${p.y2})`;
    if (tool === 'phone_key') return `phone.key("${p.key || ''}")`;
    if (tool === 'phone_wait' || tool === 'wait') return `phone.wait(${p.ms || 1000}ms)`;
    return `${tool}()`;
  }

  const HARD_SENSITIVE_RE = /(支付|付款|转账|收银台|密码|验证码|指纹|人脸|刷脸|免密|下单|提交订单|确认购买|发红包|银行卡|交易密码|删除|卸载|注销)/;

  function evaluateSafetyGate(plan, snapshot, roundAutoApproved) {
    const tool = plan?.tool || plan?.action || 'done';
    if (tool === 'phone_wait' || tool === 'wait' || tool === 'done' || tool === 'ask_user') {
      return { needConfirm: false, hardSensitive: false, riskLevel: 'read' };
    }
    const p = plan?.args || plan?.params || {};
    const combined = `${plan?.summary || ''} ${plan?.thought || ''} ${p?.text || ''} ${p?.appName || ''}`;
    const hardSensitive = Boolean(snapshot?.hasSensitiveField) || HARD_SENSITIVE_RE.test(combined);
    if (hardSensitive) {
      return { needConfirm: true, hardSensitive: true, riskLevel: 'sensitive' };
    }

    const policy = getConfirmPolicy();
    if (policy === 'auto_turn' || roundAutoApproved) {
      return { needConfirm: false, hardSensitive: false, riskLevel: plan?.risk || 'write' };
    }
    if (isAppTrusted(snapshot?.appName, snapshot?.packageName)) {
      return { needConfirm: false, hardSensitive: false, riskLevel: plan?.risk || 'write' };
    }
    if (policy === 'ask_every') {
      return { needConfirm: true, hardSensitive: false, riskLevel: plan?.risk || 'write' };
    }
    // sensitive_only 模式：仅拦截敏感写操作
    const isSensitiveWrite = plan?.risk === 'sensitive' || Boolean(plan?.needConfirm);
    return {
      needConfirm: isSensitiveWrite,
      hardSensitive: false,
      riskLevel: isSensitiveWrite ? 'sensitive' : 'write'
    };
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
    emergencyStopRequested = true;
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

  window.__onFloatInterjectTask = (text) => {
    const clean = String(text || '').trim();
    if (!clean) return;
    if (isAgentRunning) {
      queuedInterjections.push({ text: clean, priority: true });
      updateQueueBarUi();
      appendUserMessageRow(clean, true);
      showToast(`已注入插话指令：${clean}`);
    } else {
      executeTaskInChat(clean);
    }
  };

  window.__onNativeResume = () => {
    syncStatus();
    refreshSetupGuideStatus(true);
    if (pendingTaskAfterA11y && isNativeApk() && getBridge()?.isAccessibilityEnabled?.()) {
      const card = $('pa-inline-a11y-card');
      if (card) {
        card.classList.add('is-ready');
        const title = card.querySelector('.pa-a11y-guide-title');
        const desc = card.querySelector('.pa-a11y-guide-desc');
        const openBtn = card.querySelector('.pa-guide-open-a11y');
        const resumeBtn = card.querySelector('.pa-guide-resume-task');
        if (title) title.textContent = '无障碍服务已开启';
        if (desc) desc.textContent = '权限已就绪，点击下方按钮立即继续执行刚才的任务。';
        if (openBtn) openBtn.classList.add('hidden');
        if (resumeBtn) resumeBtn.classList.remove('hidden');
      }
    }
  };

  function askStepConfirmCard(confirmSlot, plan, signal, gateInfo = {}, snapshot = {}) {
    const b = getBridge();
    const hardSensitive = Boolean(gateInfo?.hardSensitive);
    const riskLevel = gateInfo?.riskLevel || 'write';
    const targetApp = snapshot?.appName || '';
    const isInExternalApp =
      isNativeApk() &&
      snapshot?.packageName &&
      snapshot.packageName !== 'com.deepseek.starwhisper.studio';

    if (isInExternalApp && b && typeof b.requestSafetyConfirmation === 'function') {
      try {
        b.requestSafetyConfirmation(
          plan.summary || '执行下一步操作',
          formatActionCodeDesc(plan),
          riskLevel,
          targetApp,
          hardSensitive
        );
      } catch {}
    }

    return new Promise((resolve) => {
      document.getElementById('pa-center-confirm-modal')?.remove();
      const dismissNative = () => {
        if (b && typeof b.dismissUserConfirmation === 'function') {
          try { b.dismissUserConfirmation(); } catch {}
        }
      };

      const modal = document.createElement('div');
      modal.id = 'pa-center-confirm-modal';
      modal.className = 'pa-modal-backdrop';

      const finish = (decision) => {
        dismissNative();
        activeConfirmResolver = null;
        modal.remove();
        if (confirmSlot) confirmSlot.innerHTML = '';
        resolve(decision);
      };

      activeConfirmResolver = (decision) => {
        finish(decision);
      };

      modal.innerHTML = `
        <div class="pa-modal-dialog" role="dialog" aria-modal="true" aria-label="dsh-Go 安全确认">
          <div class="pa-modal-head">
            <div class="pa-modal-badge ${hardSensitive ? 'is-danger' : 'is-warn'}">
              ${hardSensitive ? '高危安全拦截（密码 / 支付 / 验证码）' : 'dsh-Go 操作确认'}
            </div>
            <button type="button" class="pa-sheet-close-btn" data-decision="cancel" aria-label="拒绝并关闭">✕</button>
          </div>
          <div class="pa-modal-body">
            ${plan.thought ? `<div class="pa-modal-thought">💭 ${escapeHtml(plan.thought)}</div>` : ''}
            <div class="pa-modal-title">${escapeHtml(plan.summary || '执行下一步操作')}</div>
            <div class="pa-modal-code">动作指令：<code>${escapeHtml(formatActionCodeDesc(plan))}</code></div>
            ${snapshot?.sensitiveReason ? `<div class="pa-modal-alert">${escapeHtml(snapshot.sensitiveReason)}</div>` : ''}
          </div>
          <div class="pa-modal-foot">
            <button type="button" class="pa-banner-btn" data-decision="allow">允许一次</button>
            ${hardSensitive
              ? `<button type="button" class="pa-banner-btn outline" data-decision="handover">我来手动操作</button>`
              : `
                <button type="button" class="pa-banner-btn outline" data-decision="auto_turn">本轮允许</button>
                ${targetApp ? `<button type="button" class="pa-banner-btn outline" data-decision="trust_app">信任 ${escapeHtml(targetApp)}</button>` : ''}
              `
            }
            <button type="button" class="pa-banner-btn subtle" data-decision="cancel">拒绝</button>
          </div>
        </div>
      `;

      // 在自身界面或网页端优先展示居中弹窗；若在外部任务屏，优先以系统悬浮弹窗呈现在任务画面上
      if (!isInExternalApp || !b || typeof b.requestSafetyConfirmation !== 'function') {
        document.body.appendChild(modal);
      } else if (confirmSlot) {
        confirmSlot.innerHTML = `<div class="pa-confirm-hint-pill">已在当前任务画面弹出确认窗口，请直接点击确认…</div>`;
      }

      const onAbort = () => finish('cancel');
      if (signal) {
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener('abort', onAbort, { once: true });
      }

      modal.querySelectorAll('button[data-decision]').forEach((btn) => {
        btn.addEventListener('click', () => {
          if (signal) signal.removeEventListener('abort', onAbort);
          finish(btn.dataset.decision || 'cancel');
        });
      });
    });
  }

  function askUserClarifyPrompt({ title = 'dsh-Go 需要你确认', thought = '', question = '', options = [], signal = null, snapshot = {} } = {}) {
    const b = getBridge();
    const cleanOpts = Array.isArray(options) ? options.map((x) => String(x || '').trim()).filter(Boolean).slice(0, 4) : [];
    const isInExternalApp =
      isNativeApk() &&
      snapshot?.packageName &&
      snapshot.packageName !== 'com.deepseek.starwhisper.studio';
    const canNativeAskOverlay =
      isInExternalApp &&
      b &&
      typeof b.requestAskUserOverlay === 'function' &&
      (!b.hasOverlayPermission || b.hasOverlayPermission());

    if (canNativeAskOverlay) {
      return new Promise((resolve) => {
        const finish = (decision) => {
          activeConfirmResolver = null;
          if (typeof b.dismissUserConfirmation === 'function') {
            try { b.dismissUserConfirmation(); } catch {}
          }
          if (decision === '__back_to_chat__') {
            resolve({ mode: 'back_to_chat' });
          } else if (typeof decision === 'string' && decision.startsWith('reply:')) {
            resolve({ mode: 'reply', text: decision.slice(6).trim() });
          } else {
            resolve({ mode: 'cancel' });
          }
        };
        activeConfirmResolver = finish;
        try {
          b.requestAskUserOverlay(title, thought, question, JSON.stringify(cleanOpts));
        } catch {
          activeConfirmResolver = null;
          resolve({ mode: 'back_to_chat' });
          return;
        }
        if (signal) {
          if (signal.aborted) finish('cancel');
          else signal.addEventListener('abort', () => finish('cancel'), { once: true });
        }
      });
    }

    // 自身界面 / 网页端 / 无悬浮权限：优先居中毛玻璃弹窗确认（无需切页）
    return new Promise((resolve) => {
      document.getElementById('pa-ask-clarify-modal')?.remove();
      const modal = document.createElement('div');
      modal.id = 'pa-ask-clarify-modal';
      modal.className = 'pa-modal-backdrop';

      const finish = (res) => {
        modal.remove();
        resolve(res);
      };

      modal.innerHTML = `
        <div class="pa-modal-dialog" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
          <div class="pa-modal-head">
            <div class="pa-modal-badge is-info">${escapeHtml(title)}</div>
            <button type="button" class="pa-sheet-close-btn" id="pa-ask-modal-close" aria-label="稍后在聊天框回复">✕</button>
          </div>
          <div class="pa-modal-body">
            ${thought ? `<div class="pa-modal-thought">💭 ${escapeHtml(thought)}</div>` : ''}
            <div class="pa-modal-question">${escapeHtml(question || '请补充或确认接下来的操作')}</div>
            ${cleanOpts.length > 0 ? `
              <div class="pa-modal-options">
                ${cleanOpts.map((opt) => `<button type="button" class="pa-modal-opt-btn" data-opt="${escapeHtml(opt)}">${escapeHtml(opt)}</button>`).join('')}
              </div>
            ` : ''}
            <div class="pa-modal-input-row">
              <input type="text" id="pa-ask-modal-inp" class="pa-cfg-input" placeholder="直接输入你的答复或选择上方选项…" />
              <button type="button" class="pa-banner-btn" id="pa-ask-modal-send">确认继续</button>
            </div>
          </div>
          <div class="pa-modal-foot">
            <button type="button" class="pa-banner-btn subtle" id="pa-ask-modal-cancel">取消本次任务</button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);

      modal.querySelectorAll('.pa-modal-opt-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          finish({ mode: 'reply', text: btn.getAttribute('data-opt') || '' });
        });
      });

      const inp = modal.querySelector('#pa-ask-modal-inp');
      const submitTxt = () => {
        const val = (inp?.value || '').trim();
        finish({ mode: 'reply', text: val || '继续执行' });
      };
      modal.querySelector('#pa-ask-modal-send')?.addEventListener('click', submitTxt);
      inp?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          submitTxt();
        }
      });
      modal.querySelector('#pa-ask-modal-close')?.addEventListener('click', () => finish({ mode: 'back_to_chat' }));
      modal.querySelector('#pa-ask-modal-cancel')?.addEventListener('click', () => finish({ mode: 'cancel' }));
      setTimeout(() => inp?.focus(), 60);

      if (signal) {
        if (signal.aborted) finish({ mode: 'cancel' });
        else signal.addEventListener('abort', () => finish({ mode: 'cancel' }), { once: true });
      }
    });
  }

  const AMBIGUOUS_PREFLIGHT_RE = /^(?:帮我|请|麻烦|去|我要|我想)?(?:点个?外卖|叫个?外卖|点餐|买吃的|写作业|做作业|刷题|答题|做题|发消息|发微信|回消息|联系一下|通知一下|买票|订票|订酒店|买东西|购物|逛淘宝|刷视频)[！!。.\s]*$/;

  function isClearlyExplicitTask(clean) {
    if (!clean) return false;
    if (isAtomicBuiltInLocalCmd(clean)) return true;
    if (AMBIGUOUS_PREFLIGHT_RE.test(clean)) return false;
    // “帮我点外卖...” 仅在不含具体菜品/店铺/搜索词且很短时才视为模糊
    if (/点外卖|叫外卖/.test(clean) && clean.length <= 12 && !/(?:买|点|搜|吃|来份|来一份|螺蛳粉|奶茶|咖啡|汉堡|米线|面|饭|炸鸡)/.test(clean)) {
      return false;
    }
    if (/^(?:帮我|继续|开始)?(?:写作业|做作业|答题|做题|刷题)$/.test(clean)) {
      return false;
    }
    if (/^(?:帮我)?(?:发消息|发微信|回消息)/.test(clean) && !/(?:给|向|发|内容|说)/.test(clean.slice(4))) {
      return false;
    }
    // 明确包含应用与后续操作目标 / 明确动作宾语 / 继续当前任务
    if (/^(?:打开|启动|进入|去|切到|用)\s*[^\s，。！？,!?]{1,12}/.test(clean) && clean.length >= 4) {
      return true;
    }
    if (/(?:给\S{1,12}(?:发|回|说)|搜一下|搜索\S+|查找\S+|查看\S+|继续把|把当前|把这套|不要交卷|不交卷)/.test(clean)) {
      return true;
    }
    return false;
  }

  function shouldSkipPreFlightClarify(taskText, clarifyPolicy, resumeOpts) {
    if (resumeOpts && Array.isArray(resumeOpts.history)) return true;
    if (clarifyPolicy === 'off') return true;
    const clean = String(taskText || '').trim();
    if (!clean) return true;
    if (isLikelyPureChat(clean)) return true;
    if (/^(?:直接执行|不用问|别问了|马上执行|立刻执行)/.test(clean)) return true;
    if (clarifyPolicy === 'smart' && isClearlyExplicitTask(clean)) return true;
    return false;
  }

  function buildLocalFallbackPreFlight(taskText, clarifyPolicy) {
    const clean = String(taskText || '').trim();
    if (isLikelyPureChat(clean)) {
      return { intent: 'chat', ready: true, thought: '识别为自然对话，无需跳转控屏。', planPreview: '', question: '', options: [] };
    }
    if (/^(?:帮我|去|我要)?(?:点外卖|点个外卖|叫外卖|买吃的|点餐)[！!。.]*$/.test(clean) || (/点外卖/.test(clean) && clean.length <= 10)) {
      return {
        intent: 'task',
        ready: false,
        thought: '点外卖缺少具体想吃的品类、平台或预算偏好，先确认再跳转。',
        planPreview: '确认想吃的品类与平台后，自动打开对应外卖软件搜索下单（支付环节交还你确认）。',
        question: '你想吃什么、用哪个外卖平台，或者有预算/忌口要求吗？',
        options: ['美团外卖搜附近评分高的', '饿了么搜附近优惠套餐', '帮我点一份螺蛳粉/米粉', '帮我点一杯奶茶/咖啡']
      };
    }
    if (/^(?:帮我|继续|开始)?(?:写作业|做作业|答题|做题|刷题)[！!。.]*$/.test(clean)) {
      return {
        intent: 'task',
        ready: false,
        thought: '答题任务需要确认是在当前学习软件继续，还是指定科目及是否自动交卷。',
        planPreview: '确认后切回学习软件，逐题读取选项并连续作答下一题，直到整套题完成。',
        question: '请确认一下作业执行方式（避免切错页面或误交卷）：',
        options: ['在刚才的学习软件继续全部做完（不自动交卷）', '只做选择题，主观题留给我', '先帮我检查当前这页题目']
      };
    }
    if (/^(?:帮我)?(?:发消息|发微信|回消息|联系一下|通知一下)[^，。！？]{0,6}$/.test(clean)) {
      return {
        intent: 'task',
        ready: false,
        thought: '发送消息缺少明确的联系人与具体要发送的内容。',
        planPreview: '确认收件人和消息内容后，自动打开聊天软件定位联系人并填入内容。',
        question: '请告诉我你要发给谁，以及具体想发什么内容？',
        options: ['发给文件传输助手', '打开微信让我自己选联系人']
      };
    }
    if (clarifyPolicy === 'always') {
      return {
        intent: 'task',
        ready: false,
        thought: '当前已开启「每次先确认」，执行前先核对任务要求。',
        planPreview: `将按指令「${clean.slice(0, 36)}」识别屏幕并分步执行。`,
        question: '确认按当前理解开始执行吗？如有补充要求可直接输入：',
        options: ['确认无误，立即开始', '先打开目标页面让我看看']
      };
    }
    return { intent: 'task', ready: true, thought: '指令目标明确，可直接开始执行。', planPreview: '', question: '', options: [] };
  }

  async function requestPreFlightCheck({ execMode, task, clarifyPolicy, lastExternalApp, installedApps, signal }) {
    if (execMode === 'local') {
      return { ok: true, preflight: buildLocalFallbackPreFlight(task, clarifyPolicy) };
    }

    const cfg = getDirectConfig();
    const cloudCfg = getCloudConfig();
    const compactApps = (installedApps || []).slice(0, 30).map((a) => (typeof a === 'string' ? a : a.name));

    const runByokPreFlight = async ({ apiKey, targetUrl, targetModel, allowDeepSeekMonitor = false }) => {
      const cleanKey = cleanApiKey(apiKey);
      if (!cleanKey) {
        return null;
      }
      const isOfficialDsUrl = String(targetUrl || '').toLowerCase().includes('deepseek.com');
      const preSys = [
        '你是星语手机辅助代理（Phone Agent · dsh-Go 任务前需求预检助手）。',
        '快速判断指令是否清晰完整，仅输出严格合法 JSON：',
        '{"intent":"chat|task","ready":true|false,"thought":"简短分析(<=36字)","planPreview":"1句拟定步骤","question":"若ready=false的简短中文提问","options":["快捷选项1","快捷选项2"]}',
        '规则：1.闲聊设intent="chat",ready=true。2.目标App/上下文明确且无关键缺口在smart模式设intent="task",ready=true。3.明显缺关键对象或clarifyPolicy==="always"设intent="task",ready=false并给2~4个快捷options。'
      ].join('\n');
      const preUser = JSON.stringify({
        task,
        clarifyPolicy,
        lastExternalApp: lastExternalApp || getLastExternalAppInfo(),
        conversationMemory: paChatMemory.slice(-4),
        installedAppsPreview: compactApps
      });

      try {
        const bodyObj = {
          model: targetModel,
          messages: [
            { role: 'system', content: preSys },
            { role: 'user', content: preUser }
          ],
          temperature: 0.2,
          max_tokens: 280,
          stream: false
        };
        if (isOfficialDsUrl) {
          bodyObj.response_format = { type: 'json_object' };
        }
        const nRes = await nativeHttpPostJson(
          targetUrl,
          { Authorization: `Bearer ${cleanKey}` },
          bodyObj,
          { timeoutMs: 4500, signal }
        );
        if (nRes.ok && nRes.bodyText) {
          const j = JSON.parse(nRes.bodyText);
          if (allowDeepSeekMonitor && isOfficialDsUrl && j?.usage) {
            try {
              window.DeepSeekMonitorPlugin?.recordTurnUsage?.({
                usage: j.usage,
                model: targetModel,
                source: '手机辅助·预检',
                apiKey: cleanKey,
                baseUrl: targetUrl,
                provider: 'own_deepseek'
              });
            } catch {}
          }
          const content = String(j?.choices?.[0]?.message?.content || '').trim();
          const cleaned = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
          const obj = JSON.parse(cleaned);
          const intent = obj?.intent === 'chat' ? 'chat' : 'task';
          const ready = intent === 'chat' ? true : (clarifyPolicy === 'always' ? false : Boolean(obj?.ready));
          return {
            ok: true,
            preflight: {
              intent,
              ready,
              thought: String(obj?.thought || '').trim(),
              planPreview: String(obj?.planPreview || '').trim(),
              question: String(obj?.question || '').trim(),
              options: Array.isArray(obj?.options) ? obj.options.map((x) => String(x || '').trim()).filter(Boolean).slice(0, 4) : []
            }
          };
        }
      } catch {}

      // 若直连受限，走云端 /api/phone-agent/plan preflight 兜底
      try {
        const pPayload = {
          phase: 'preflight',
          task,
          clarifyPolicy,
          lastExternalApp: lastExternalApp || getLastExternalAppInfo(),
          installedApps: compactApps,
          conversationMemory: paChatMemory.slice(-6),
          customApiKey: cleanKey,
          customModel: targetModel,
          customBaseUrl: targetUrl
        };
        let pRes = await apiPostJson('/api/phone-agent/plan', pPayload, signal).catch(() => ({ ok: false, data: {} }));
        if (!pRes.ok && !signal?.aborted) {
          const cResp = await fetch(`${PUBLIC_WEB_ORIGIN}/api/phone-agent/plan`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(pPayload),
            signal
          }).catch(() => null);
          if (cResp && cResp.ok) {
            const cData = await cResp.json().catch(() => ({}));
            if (cData?.preflight) pRes = { ok: true, data: cData };
          }
        }
        if (pRes.ok && pRes.data?.preflight) {
          if (allowDeepSeekMonitor && isOfficialDsUrl && pRes.data?.usage) {
            try {
              window.DeepSeekMonitorPlugin?.recordTurnUsage?.({
                usage: pRes.data.usage,
                model: pRes.data.model || targetModel,
                source: '手机辅助·预检',
                apiKey: cleanKey,
                baseUrl: targetUrl,
                provider: 'own_deepseek'
              });
            } catch {}
          }
          return { ok: true, preflight: pRes.data.preflight };
        }
      } catch {}
      return null;
    };

    if (execMode === 'api_direct') {
      const cleanKey = cleanApiKey(cfg.apiKey);
      if (!cleanKey) {
        return { ok: true, preflight: buildLocalFallbackPreFlight(task, clarifyPolicy) };
      }
      const rawModel = String(cfg.model || 'deepseek-v4.1-flash').trim() || 'deepseek-v4.1-flash';
      const targetModel = /reasoner|r1/i.test(rawModel) ? 'deepseek-chat' : resolveDirectModelForUrl(rawModel, DEEPSEEK_OFFICIAL_CHAT_URL);
      const res = await runByokPreFlight({ apiKey: cleanKey, targetUrl: DEEPSEEK_OFFICIAL_CHAT_URL, targetModel, allowDeepSeekMonitor: true });
      if (res) return res;
      return { ok: true, preflight: buildLocalFallbackPreFlight(task, clarifyPolicy) };
    }

    // 云端 API 模式 preflight：若用户填了云端独立 Key 与地址，直接按自定义网关直连/代理执行；否则走平台云端接口
    if (cloudCfg.apiKey) {
      const targetCloudUrl = normalizeChatCompletionsUrl(cloudCfg.baseUrl || 'https://api.siliconflow.cn/v1/chat/completions');
      const fallbackFirstOpt = Array.from($('pa-cloud-model-select')?.options || []).find((o) => String(o.value || '').trim())?.value || '';
      const targetCloudModel = cloudCfg.model || fallbackFirstOpt;
      if (targetCloudModel) {
        const res = await runByokPreFlight({ apiKey: cloudCfg.apiKey, targetUrl: targetCloudUrl, targetModel: targetCloudModel });
        if (res) return res;
      }
    }

    try {
      const cRes = await apiPostJson('/api/phone-agent/plan', {
        phase: 'preflight',
        task,
        clarifyPolicy,
        lastExternalApp: lastExternalApp || getLastExternalAppInfo(),
        installedApps: compactApps,
        conversationMemory: paChatMemory.slice(-6),
        customModel: cloudCfg.model || ''
      }, signal);
      if (cRes.ok && cRes.data?.preflight) {
        return { ok: true, preflight: cRes.data.preflight };
      }
    } catch {}
    return { ok: true, preflight: buildLocalFallbackPreFlight(task, clarifyPolicy) };
  }

  function askPreFlightClarifyModal({ taskText = '', thought = '', planPreview = '', question = '', options = [], signal = null } = {}) {
    const cleanOpts = Array.isArray(options) ? options.map((x) => String(x || '').trim()).filter(Boolean).slice(0, 4) : [];
    return new Promise((resolve) => {
      document.getElementById('pa-preflight-clarify-modal')?.remove();
      const modal = document.createElement('div');
      modal.id = 'pa-preflight-clarify-modal';
      modal.className = 'pa-modal-backdrop';

      const finish = (res) => {
        modal.remove();
        resolve(res);
      };

      modal.innerHTML = `
        <div class="pa-modal-dialog" role="dialog" aria-modal="true" aria-label="执行前需求确认">
          <div class="pa-modal-head">
            <div class="pa-modal-badge is-info">执行前需求确认</div>
            <button type="button" class="pa-sheet-close-btn" id="pa-pre-modal-close" aria-label="取消本次任务">✕</button>
          </div>
          <div class="pa-modal-body">
            ${taskText ? `<div class="pa-modal-task-quote">原指令：${escapeHtml(taskText)}</div>` : ''}
            ${thought ? `<div class="pa-modal-thought">💭 ${escapeHtml(thought)}</div>` : ''}
            ${planPreview ? `<div class="pa-modal-plan-preview">📋 拟定思路：${escapeHtml(planPreview)}</div>` : ''}
            <div class="pa-modal-question">${escapeHtml(question || '在跳转执行前，请先确认一下具体需求或补充关键细节：')}</div>
            ${cleanOpts.length > 0 ? `
              <div class="pa-modal-options">
                ${cleanOpts.map((opt) => `<button type="button" class="pa-modal-opt-btn" data-opt="${escapeHtml(opt)}">${escapeHtml(opt)}</button>`).join('')}
              </div>
            ` : ''}
            <div class="pa-modal-input-row">
              <input type="text" id="pa-pre-modal-inp" class="pa-cfg-input" placeholder="补充具体要求（如品类、联系人、条件）…" />
              <button type="button" class="pa-banner-btn" id="pa-pre-modal-send">确认并开始</button>
            </div>
          </div>
          <div class="pa-modal-foot">
            <button type="button" class="pa-banner-btn outline" id="pa-pre-modal-proceed">按当前理解直接执行</button>
            <button type="button" class="pa-banner-btn subtle" id="pa-pre-modal-cancel">取消</button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);

      modal.querySelectorAll('.pa-modal-opt-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          finish({ mode: 'reply', text: btn.getAttribute('data-opt') || '' });
        });
      });

      const inp = modal.querySelector('#pa-pre-modal-inp');
      const submitTxt = () => {
        const val = (inp?.value || '').trim();
        if (!val) {
          finish({ mode: 'proceed' });
          return;
        }
        finish({ mode: 'reply', text: val });
      };
      modal.querySelector('#pa-pre-modal-send')?.addEventListener('click', submitTxt);
      inp?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          submitTxt();
        }
      });
      modal.querySelector('#pa-pre-modal-proceed')?.addEventListener('click', () => finish({ mode: 'proceed' }));
      modal.querySelector('#pa-pre-modal-close')?.addEventListener('click', () => finish({ mode: 'cancel' }));
      modal.querySelector('#pa-pre-modal-cancel')?.addEventListener('click', () => finish({ mode: 'cancel' }));
      setTimeout(() => inp?.focus(), 60);

      if (signal) {
        if (signal.aborted) finish({ mode: 'cancel' });
        else signal.addEventListener('abort', () => finish({ mode: 'cancel' }), { once: true });
      }
    });
  }

  function summarizePlanArgs(plan) {
    const tool = plan?.tool || plan?.action || '';
    const args = plan?.args || plan?.params || {};
    if (tool === 'phone_open' || tool === 'launch_app') return `app=${args.appName || ''}`;
    if (tool === 'phone_tap' || tool === 'click_node') return args.ref ? `ref=${args.ref}` : `text=${args.text || ''}`;
    if (tool === 'phone_tap_xy' || tool === 'click' || tool === 'phone_double_tap') return `xy=(${Math.round(Number(args.x) || 0)},${Math.round(Number(args.y) || 0)})`;
    if (tool === 'phone_long_press' || tool === 'long_click') return args.ref ? `ref=${args.ref}` : `xy=(${Math.round(Number(args.x) || 0)},${Math.round(Number(args.y) || 0)})`;
    if (tool === 'phone_type' || tool === 'input') return `text="${String(args.text || '').slice(0, 18)}"`;
    if (tool === 'phone_scroll' || tool === 'scroll') return `dir=${args.direction || 'down'}`;
    if (tool === 'phone_swipe' || tool === 'swipe') return `swipe(${Math.round(Number(args.x1) || 0)},${Math.round(Number(args.y1) || 0)}->${Math.round(Number(args.x2) || 0)},${Math.round(Number(args.y2) || 0)})`;
    if (tool === 'phone_key' || tool === 'key' || tool === 'back' || tool === 'home') return `key=${args.key || tool}`;
    if (tool === 'phone_wait' || tool === 'wait') return `ms=${Number(args.ms) || 1000}`;
    return '';
  }

  function getActionFingerprint(plan, snapshot) {
    const tool = plan?.tool || plan?.action || '';
    const args = plan?.args || plan?.params || {};
    if (tool === 'phone_tap' || tool === 'click_node') {
      const refId = String(args.ref || '').trim();
      let nodeLabel = String(args.text || '').trim();
      if (!nodeLabel && refId && Array.isArray(snapshot?.nodes)) {
        const hit = snapshot.nodes.find((n) => n.ref === refId);
        if (hit) nodeLabel = String(hit.text || hit.desc || '').trim().slice(0, 24);
      }
      return `tap:${refId}:${nodeLabel}`;
    }
    if (tool === 'phone_tap_xy' || tool === 'click' || tool === 'phone_double_tap') {
      const qx = Math.round((Number(args.x) || 0) / 24) * 24;
      const qy = Math.round((Number(args.y) || 0) / 24) * 24;
      return `${tool}:${qx},${qy}`;
    }
    if (tool === 'phone_scroll' || tool === 'scroll') return `scroll:${args.direction || 'down'}`;
    if (tool === 'phone_swipe' || tool === 'swipe') {
      const qx1 = Math.round((Number(args.x1) || 0) / 36) * 36;
      const qy1 = Math.round((Number(args.y1) || 0) / 36) * 36;
      const qx2 = Math.round((Number(args.x2) || 0) / 36) * 36;
      const qy2 = Math.round((Number(args.y2) || 0) / 36) * 36;
      return `swipe:${qx1},${qy1}->${qx2},${qy2}`;
    }
    if (tool === 'phone_open' || tool === 'launch_app') return `open:${String(args.appName || '').trim().toLowerCase()}`;
    if (tool === 'phone_key' || tool === 'key' || tool === 'back' || tool === 'home') return `key:${String(args.key || tool).toLowerCase()}`;
    if (tool === 'phone_type' || tool === 'input') return `type:${args.ref || ''}:${String(args.text || '').slice(0, 20)}`;
    if (tool === 'phone_wait' || tool === 'wait') return 'wait';
    return `${tool}:${summarizePlanArgs(plan)}`;
  }

  function findPopupDismissNode(nodes, taskText = '') {
    if (!Array.isArray(nodes) || nodes.length === 0) return null;
    const dismissRe = /^(?:跳过|跳过广告|关闭|以后再说|暂不更新|暂不|知道了|我知道了|残忍拒绝|暂不开启|不再提示|稍后再说|忽略|取消)$/;
    const taskLower = String(taskText || '').toLowerCase();
    for (const n of nodes) {
      const txt = String(n.text || n.desc || '').trim();
      if (!txt || txt.length > 8) continue;
      if (!dismissRe.test(txt)) continue;
      if (taskLower && taskLower.includes(txt.toLowerCase())) continue;
      if (n.clickable || (Array.isArray(n.center) && n.center[0] > 0 && n.center[1] > 0)) {
        return n;
      }
    }
    return null;
  }

  function detectOscillation(recentPageSigs) {
    if (!Array.isArray(recentPageSigs) || recentPageSigs.length < 4) return false;
    const n = recentPageSigs.length;
    if (
      recentPageSigs[n - 1] &&
      recentPageSigs[n - 1] === recentPageSigs[n - 3] &&
      recentPageSigs[n - 2] === recentPageSigs[n - 4] &&
      recentPageSigs[n - 1] !== recentPageSigs[n - 2]
    ) {
      return true;
    }
    const tail6 = recentPageSigs.slice(-6);
    const counts = new Map();
    for (const sig of tail6) {
      if (!sig) continue;
      counts.set(sig, (counts.get(sig) || 0) + 1);
      if (counts.get(sig) >= 3 && tail6.length >= 5) return true;
    }
    return false;
  }

  function showInlineFixBox(fixSlot, planResp, { currentMode = '', onRetryWithMode, onRetryStep } = {}) {
    const modeNow = currentMode || getExecMode();
    const errCode = String(planResp?.code || '');
    const errMsg = String(planResp?.error || '当前规划请求异常');
    const isAuthIssue =
      errCode === 'NO_DIRECT_KEY' ||
      errCode === 'NO_API_KEY' ||
      /401|403|unauthorized|invalid.*key|authentication/i.test(errMsg);
    const hasSavedDirectKey = Boolean(getDirectConfig().apiKey);

    const openSwitchModal = () => {
      document.getElementById('pa-engine-switch-modal')?.remove();
      const modal = document.createElement('div');
      modal.id = 'pa-engine-switch-modal';
      modal.className = 'pa-modal-backdrop';

      const needDirectKeyInput = modeNow === 'local' ? !hasSavedDirectKey : (modeNow === 'api_direct' && isAuthIssue);
      const showDirectSwitch = modeNow === 'local' || modeNow === 'api_cloud' || (modeNow === 'api_direct' && isAuthIssue);
      const showCloudSwitch = modeNow === 'local' || modeNow === 'api_direct';

      modal.innerHTML = `
        <div class="pa-modal-dialog" role="dialog" aria-modal="true" aria-label="选择控屏执行引擎">
          <div class="pa-modal-head">
            <div class="pa-modal-badge is-warn">${modeNow === 'local' ? '超出本地免 API 指令范围' : '需要调整执行引擎'}</div>
            <button type="button" class="pa-sheet-close-btn" id="pa-eng-modal-close" aria-label="关闭">✕</button>
          </div>
          <div class="pa-modal-body">
            <div class="pa-modal-question">${escapeHtml(errMsg)}</div>
            ${needDirectKeyInput ? `
              <div class="pa-cfg-field" style="margin-top:6px;">
                <label for="pa-eng-modal-key">手机辅助专属 DeepSeek API Key</label>
                <input type="password" id="pa-eng-modal-key" class="pa-cfg-input" placeholder="粘贴 sk-... 密钥（仅存手机辅助沙盒）" autocomplete="off" />
              </div>
            ` : ''}
          </div>
          <div class="pa-modal-foot" style="flex-wrap:wrap;">
            ${showDirectSwitch ? `
              <button type="button" class="pa-banner-btn" id="pa-eng-modal-direct">
                ${needDirectKeyInput ? '保存并切换 DeepSeek API 继续' : '切换 DeepSeek API 模式'}
              </button>
            ` : ''}
            ${showCloudSwitch ? `
              <button type="button" class="pa-banner-btn outline" id="pa-eng-modal-cloud">切换云端 API 模式</button>
            ` : ''}
            ${modeNow !== 'local' && !isAuthIssue && typeof onRetryStep === 'function' ? `
              <button type="button" class="pa-banner-btn outline" id="pa-eng-modal-retry">重试当前步骤</button>
            ` : ''}
            <button type="button" class="pa-banner-btn subtle" id="pa-eng-modal-cancel">取消</button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);

      const closeM = () => modal.remove();
      modal.querySelector('#pa-eng-modal-close')?.addEventListener('click', closeM);
      modal.querySelector('#pa-eng-modal-cancel')?.addEventListener('click', closeM);
      modal.addEventListener('click', (e) => {
        if (e.target === modal) closeM();
      });
      modal.querySelector('#pa-eng-modal-direct')?.addEventListener('click', () => {
        if (needDirectKeyInput) {
          const k = (modal.querySelector('#pa-eng-modal-key')?.value || '').trim();
          if (!k) {
            showToast('请先输入有效的 sk- 密钥，或点击「切换云端 API 模式」');
            modal.querySelector('#pa-eng-modal-key')?.focus();
            return;
          }
          setDirectApiKey(k);
        }
        setExecMode('api_direct');
        closeM();
        if (fixSlot) fixSlot.innerHTML = '';
        if (typeof onRetryWithMode === 'function') onRetryWithMode('api_direct');
      });
      modal.querySelector('#pa-eng-modal-cloud')?.addEventListener('click', () => {
        setExecMode('api_cloud');
        closeM();
        if (fixSlot) fixSlot.innerHTML = '';
        if (typeof onRetryWithMode === 'function') onRetryWithMode('api_cloud');
      });
      modal.querySelector('#pa-eng-modal-retry')?.addEventListener('click', () => {
        closeM();
        if (fixSlot) fixSlot.innerHTML = '';
        if (typeof onRetryStep === 'function') onRetryStep();
      });
    };

    if (fixSlot) {
      fixSlot.innerHTML = `
        <div class="pa-fix-compact-row">
          <span>${escapeHtml(errMsg)}</span>
          <button type="button" class="pa-learned-manage-btn pa-reopen-fix-modal-btn">选择切换引擎</button>
        </div>
      `;
      fixSlot.querySelector('.pa-reopen-fix-modal-btn')?.addEventListener('click', openSwitchModal);
    }
    openSwitchModal();
  }

  function getLastExternalAppInfo() {
    if (!isNativeApk()) return { packageName: '', appName: '' };
    const b = getBridge();
    try {
      if (typeof b.getLastExternalApp === 'function') {
        return JSON.parse(b.getLastExternalApp()) || { packageName: '', appName: '' };
      }
    } catch {}
    return { packageName: '', appName: '' };
  }

  function buildPlanningPromptMessages({ task, snapshot, history, screenSize, installedApps, screenVerdict, loopDiagnostics, interjections, stepIndex, lastExternalApp }) {
    const sys = [
      '你是星语手机辅助代理（Phone Agent · dsh-Go 规划内核），根据任务、屏幕快照(ref)、ScreenVerdict 与历史步骤输出唯一精确的下一步动作。',
      `屏幕分辨率: ${screenSize.width}x${screenSize.height}。`,
      '仅输出严格合法 JSON（禁止 Markdown 代码块与多余解释），将 tool 与 args 放最前面以加速响应：',
      '{"tool":"工具名","args":{},"thought":"简短中文判断(<=30字)","summary":"简述(<=16字)","risk":"read|write|sensitive","reply":"chat/done/ask_user时的中文回复"}',
      '可用 tool 与 args：',
      'chat:{"message":"无需操作手机，直接对话回答"} / phone_open:{"appName":"微信"} / phone_tap:{"ref":"e12","snapshotId":"snap_1"} / phone_tap_xy:{"x":540,"y":1200} / phone_double_tap:{"x":540,"y":1000} / phone_long_press:{"ref":"e12","duration":650} / phone_type:{"ref":"e8","text":"你好","clear":false,"submit":true} / phone_scroll:{"direction":"down|up|left|right","amount":0.65} / phone_swipe:{"x1":540,"y1":1600,"x2":540,"y2":600,"duration":240} / phone_key:{"key":"back|home|recents|notifications|quick_settings|enter|screenshot"} / phone_wait:{"ms":600} / ask_user:{"message":"向用户追问或请求确认的问题","reason":"clarify|confirm|sensitive|manual","options":["推荐选项1","选项2"]} / done:{"message":"完成总结"}',
      '关键规则：',
      '0. 闲聊/提问/只读屏幕解答直接返回 tool="chat"，严禁瞎点。',
      '0.5 缺收件人/内容/规格等关键参数或重要提交/删除/付款时，严禁瞎猜，立即返回 ask_user 并尽量给 2~4 个快捷 options。',
      '1. 打开应用首选 phone_open；点控件首选 phone_tap(ref, snapshotId)。',
      '2. 防卡死铁律：严禁连续 2 步 phone_wait；若 blockedActions 非空或 noChangeStreak>=1、errorStreak>=1，必须立刻更换完全不同的控件/坐标/路径；oscillationDetected=true 时立即换路、phone_key(back) 或 ask_user。',
      '2.5 遇开屏广告/更新/权限弹窗，优先点击跳过/关闭/以后再说清理。',
      '3. 同屏明确无歧义的 2~3 个连贯非敏感微动作（如先选答案再点下一题）可附带 `"actions":[{"tool":"phone_tap","args":{"ref":"e10"}},{"tool":"phone_tap","args":{"ref":"e24"}}]`。',
      '4. 严禁操作控制端自身(packageName="com.deepseek.starwhisper.studio")；说“继续写作业/答题”且未提 DeepSeek 时切回 lastExternalApp。',
      '5. screenTreeText 每行 `R1: ... | ...` 为同一水平行；做题须核对同行字母与文字，带 (sel)/(chk) 表示已选中，已选对直接点“下一题”。',
      '6. 连续做题/多页任务只要还有“下一题”或题号未达最后且未出现得分/提交成功页，严禁提前 done，须连贯做完。',
      '7. interjections 非空时最高优先级响应用户插话。',
      '8. hasSensitiveField=true 或付款/转账/下单/删除/密码/验证码设 risk="sensitive"，密码/验证码/刷脸直接 ask_user 交还人工。'
    ].join('\n');

    const recentHistory = (history || []).slice(-6).map((h) => ({
      step: h.step,
      tool: h.tool || h.action,
      args: h.argsSummary || '',
      result: h.result,
      changed: h.changed === undefined ? null : Boolean(h.changed),
      page: h.page || ''
    }));
    const lastHist = recentHistory.length ? recentHistory[recentHistory.length - 1] : null;
    const pkgLower = String(snapshot?.packageName || '').toLowerCase();
    const appLower = String(snapshot?.appName || '').toLowerCase();
    const needAppsList =
      (Number(stepIndex) || 1) <= 2 ||
      !pkgLower ||
      pkgLower.includes('launcher') ||
      appLower.includes('桌面') ||
      (lastHist && lastHist.tool === 'phone_open' && String(lastHist.result || '').includes('未能'));

    const usrObj = {
      selfPackageName: 'com.deepseek.starwhisper.studio',
      lastExternalApp: lastExternalApp || getLastExternalAppInfo()
    };
    if (needAppsList) {
      usrObj.installedApps = (installedApps || []).slice(0, 40).map((a) => (typeof a === 'string' ? a : a.name));
    }
    usrObj.task = task;
    usrObj.stepIndex = stepIndex || (history || []).length + 1;
    usrObj.snapshotId = snapshot?.snapshotId || '';
    usrObj.foregroundApp = snapshot?.appName || '';
    usrObj.packageName = snapshot?.packageName || '';
    usrObj.hasSensitiveField = Boolean(snapshot?.hasSensitiveField);
    if (snapshot?.sensitiveReason) usrObj.sensitiveReason = snapshot.sensitiveReason;
    if (screenVerdict) usrObj.screenVerdict = screenVerdict;
    if (loopDiagnostics) usrObj.loopDiagnostics = loopDiagnostics;
    if (interjections && interjections.length) usrObj.interjections = interjections;
    if (paChatMemory.length) usrObj.conversationMemory = paChatMemory.slice(-4);
    if (recentHistory.length) usrObj.recentHistory = recentHistory;
    usrObj.screenTreeText = snapshot?.screenTreeText || '';

    const usr = JSON.stringify(usrObj);

    return [
      { role: 'system', content: sys },
      { role: 'user', content: usr }
    ];
  }

  function normalizeClientPlan(obj) {
    const toolToLegacy = {
      phone_open: 'launch_app',
      phone_tap: 'click_node',
      phone_tap_xy: 'click',
      phone_double_tap: 'double_tap',
      phone_long_press: 'long_click',
      phone_type: 'input',
      phone_scroll: 'scroll',
      phone_swipe: 'swipe',
      phone_key: 'key',
      phone_wait: 'wait',
      chat: 'chat',
      done: 'done',
      ask_user: 'ask_user'
    };
    const legacyToTool = {
      launch_app: 'phone_open',
      click_node: 'phone_tap',
      click: 'phone_tap_xy',
      long_click: 'phone_long_press',
      swipe: 'phone_swipe',
      input: 'phone_type',
      home: 'phone_key',
      back: 'phone_key',
      recents: 'phone_key',
      wait: 'phone_wait',
      chat: 'chat',
      done: 'done',
      ask_user: 'ask_user'
    };
    const rawTool = String(obj?.tool || '').trim();
    const rawAction = String(obj?.action || '').trim();
    const tool = rawTool && toolToLegacy[rawTool] ? rawTool : (legacyToTool[rawAction] || 'done');
    const args = (obj?.args && typeof obj.args === 'object')
      ? { ...obj.args }
      : ((obj?.params && typeof obj.params === 'object') ? { ...obj.params } : {});
    if (!rawTool && (rawAction === 'home' || rawAction === 'back' || rawAction === 'recents')) {
      args.key = rawAction;
    }
    const riskRaw = String(obj?.risk || '').trim().toLowerCase();
    const risk = riskRaw === 'read' || riskRaw === 'write' || riskRaw === 'sensitive'
      ? riskRaw
      : (obj?.needConfirm ? 'sensitive' : (tool === 'chat' || tool === 'done' || tool === 'ask_user' || tool === 'phone_wait' ? 'read' : 'write'));
    const reply = String(obj?.reply || args?.message || obj?.summary || '').trim();
    if ((tool === 'chat' || tool === 'done' || tool === 'ask_user') && reply && !args.message) {
      args.message = reply;
    }
    if (Array.isArray(args.options)) {
      args.options = args.options.map((x) => String(x || '').trim()).filter(Boolean).slice(0, 4);
    }

    const rawActions = Array.isArray(obj?.actions) ? obj.actions.slice(0, 3) : [];
    const normalizedActions = [];
    if (risk !== 'sensitive' && tool !== 'chat' && tool !== 'done' && tool !== 'ask_user' && tool !== 'phone_open') {
      for (const sub of rawActions) {
        if (!sub || typeof sub !== 'object') continue;
        const stRaw = String(sub.tool || sub.action || '').trim();
        const st = stRaw && toolToLegacy[stRaw] ? stRaw : (legacyToTool[stRaw] || '');
        if (!st || st === 'chat' || st === 'done' || st === 'ask_user' || st === 'phone_open') continue;
        const sArgs = (sub.args && typeof sub.args === 'object') ? { ...sub.args } : ((sub.params && typeof sub.params === 'object') ? { ...sub.params } : {});
        normalizedActions.push({
          tool: st,
          args: sArgs,
          risk: 'write',
          summary: String(sub.summary || `执行 ${st}`).trim(),
          needConfirm: false
        });
      }
    }

    return {
      thought: String(obj?.thought || '').trim(),
      tool,
      args,
      actions: normalizedActions.length >= 2 ? normalizedActions : undefined,
      risk,
      reply,
      action: toolToLegacy[tool] || 'done',
      params: args,
      summary: String(obj?.summary || `执行 ${tool}`).trim(),
      needConfirm: risk === 'sensitive' || Boolean(obj?.needConfirm)
    };
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
          return normalizeClientPlan(directObj);
        }
      } catch {}

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
                if (parsed && typeof parsed === 'object' && (parsed.tool || parsed.action)) {
                  return normalizeClientPlan(parsed);
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

  async function requestPlanStep({ execMode, task, snapshot, history, screenSize, installedApps, screenVerdict, loopDiagnostics, interjections, extraRecoveryHint = '', stepIndex, lastExternalApp, signal }) {
    const cfg = getDirectConfig();
    const cloudCfg = getCloudConfig();
    const lastExt = lastExternalApp || getLastExternalAppInfo();
    const screenTreeText = String(snapshot?.screenTreeText || '');
    const screenNodes = screenTreeText ? [] : (snapshot?.nodes || []);
    const pkgLower = String(snapshot?.packageName || '').toLowerCase();
    const appLower = String(snapshot?.appName || '').toLowerCase();
    const lastHist = Array.isArray(history) && history.length ? history[history.length - 1] : null;
    const needApps =
      (Number(stepIndex) || 1) <= 2 ||
      !pkgLower ||
      pkgLower.includes('launcher') ||
      appLower.includes('桌面') ||
      (lastHist && lastHist.tool === 'phone_open' && String(lastHist.result || '').includes('未能'));
    const compactInstalledApps = needApps
      ? (installedApps || []).map((a) => (typeof a === 'string' ? a : a.name))
      : [];
    const compactHistory = (history || []).slice(-10).map((h) => ({
      step: h.step,
      tool: h.tool || h.action,
      argsSummary: h.argsSummary || '',
      summary: h.summary,
      result: h.result,
      changed: h.changed === undefined ? null : Boolean(h.changed),
      page: h.page || ''
    }));
    const finalInterjections = extraRecoveryHint
      ? [...(interjections || []), extraRecoveryHint]
      : (interjections || []);

    const executeByokPlanCall = async ({ apiKey, targetUrl, targetModel, modeTag, allowDeepSeekMonitor }) => {
      const cleanKey = cleanApiKey(apiKey);
      const isOfficialDsUrl = String(targetUrl || '').toLowerCase().includes('deepseek.com');
      const baseMessages = buildPlanningPromptMessages({
        task,
        snapshot,
        history: compactHistory,
        screenSize,
        installedApps,
        screenVerdict,
        loopDiagnostics,
        interjections: finalInterjections,
        stepIndex,
        lastExternalApp: lastExt
      });

      const attemptDirectCall = async (modelToUse, extraHint = '', allowJsonFormat = true) => {
        const msgs = extraHint ? [...baseMessages, { role: 'user', content: extraHint }] : baseMessages;
        const isReasoner = /reasoner|r1/i.test(String(modelToUse || ''));
        const directBody = {
          model: modelToUse,
          messages: msgs,
          temperature: isReasoner ? 0.2 : 0.15,
          max_tokens: isReasoner ? 2048 : 420,
          stream: false
        };
        if (allowJsonFormat && !isReasoner && isOfficialDsUrl) {
          directBody.response_format = { type: 'json_object' };
        }
        const nRes = await nativeHttpPostJson(
          targetUrl,
          { Authorization: `Bearer ${cleanKey}` },
          directBody,
          { timeoutMs: 12000, signal }
        );
        if (!nRes.ok) {
          const txt = String(nRes.bodyText || nRes.error || '');
          const httpErr = new Error(nRes.status ? `直连 API 返回 (${nRes.status}): ${txt.slice(0, 120)}` : `直连请求失败: ${txt.slice(0, 120)}`);
          httpErr.code = nRes.status === 401 || nRes.status === 403 ? 'DIRECT_AUTH_ERROR' : 'DIRECT_HTTP_ERROR';
          httpErr.status = nRes.status;
          httpErr.fromNative = nRes.fromNative;
          throw httpErr;
        }
        const json = JSON.parse(nRes.bodyText || '{}');
        const msgObj = json?.choices?.[0]?.message || {};
        const content = String(msgObj.content || '').trim();
        const rawReasoning = String(msgObj.reasoning_content || '').trim();
        try {
          const parsedPlan = extractJsonFromText(content);
          if (rawReasoning && !parsedPlan.reasoning) parsedPlan.reasoning = rawReasoning;
          return { plan: parsedPlan, model: modelToUse, usage: json?.usage || null };
        } catch (parseErr) {
          if (rawReasoning) {
            return { plan: extractJsonFromText(rawReasoning), model: modelToUse, usage: json?.usage || null };
          }
          throw parseErr;
        }
      };

      try {
        let result;
        try {
          result = await attemptDirectCall(targetModel, '', true);
        } catch (firstErr) {
          if (signal?.aborted || firstErr?.code === 'DIRECT_AUTH_ERROR') {
            throw firstErr;
          }
          if (firstErr?.code === 'JSON_PARSE_ERROR' || Number(firstErr?.status) === 400 || Number(firstErr?.status) === 422 || /JSON|response_format|model/i.test(String(firstErr?.message || ''))) {
            const isModelErr = /model.*not.*exist|invalid.*model|does not exist/i.test(String(firstErr?.message || ''));
            const retryModel = (isOfficialDsUrl && (/reasoner|r1/i.test(targetModel) || isModelErr)) ? 'deepseek-chat' : targetModel;
            result = await attemptDirectCall(
              retryModel,
              '刚才未返回合法 JSON 动作指令。请严格只输出一个合法 JSON 对象（不要任何 Markdown 或解释文字）。',
              false
            );
          } else if (firstErr?.name === 'AbortError' || Number(firstErr?.status) >= 500 || (firstErr?.fromNative && /timeout|reset|eof/i.test(String(firstErr?.message || '')))) {
            await nativeSleep(120, signal);
            result = await attemptDirectCall(targetModel, '', false);
          } else {
            throw firstErr;
          }
        }
        try {
          if (allowDeepSeekMonitor && result.usage && isOfficialDsUrl) {
            window.DeepSeekMonitorPlugin?.recordTurnUsage?.({
              usage: result.usage,
              model: result.model,
              source: '手机辅助·直连',
              apiKey: cleanKey,
              baseUrl: targetUrl,
              provider: 'own_deepseek'
            });
          }
        } catch {}
        return { ok: true, plan: result.plan, model: result.model, engine: modeTag };
      } catch (directErr) {
        if (signal?.aborted) throw directErr;
        if (directErr?.code === 'DIRECT_AUTH_ERROR') {
          return { ok: false, code: 'DIRECT_AUTH_ERROR', error: directErr.message };
        }
        const proxyPayload = {
          task,
          stepIndex,
          lastExternalApp: lastExt,
          snapshotId: snapshot?.snapshotId || '',
          foregroundApp: snapshot?.appName || '',
          packageName: snapshot?.packageName || '',
          hasSensitiveField: Boolean(snapshot?.hasSensitiveField),
          sensitiveReason: snapshot?.sensitiveReason || '',
          screenTreeText,
          screenNodes,
          screenVerdict,
          loopDiagnostics: loopDiagnostics || null,
          interjections: finalInterjections,
          conversationMemory: paChatMemory.slice(-6),
          history: compactHistory,
          screenSize,
          installedApps: compactInstalledApps,
          customApiKey: cleanKey,
          customModel: targetModel,
          customBaseUrl: targetUrl
        };
        let proxyRes = await apiPostJson('/api/phone-agent/plan', proxyPayload, signal).catch(() => ({ ok: false, status: 0, data: {} }));
        if ((!proxyRes.ok || !proxyRes.data?.plan) && !signal?.aborted) {
          try {
            const cloudFallback = await fetch(`${PUBLIC_WEB_ORIGIN}/api/phone-agent/plan`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(proxyPayload),
              signal
            });
            const cData = await cloudFallback.json().catch(() => ({}));
            if (cloudFallback.ok && cData?.plan) {
              proxyRes = { ok: true, status: cloudFallback.status, data: cData };
            } else if (cData?.error) {
              proxyRes = { ok: false, status: cloudFallback.status, data: cData };
            }
          } catch {}
        }
        if (proxyRes.ok && proxyRes.data?.plan) {
          try {
            if (allowDeepSeekMonitor && proxyRes.data?.usage && isOfficialDsUrl) {
              window.DeepSeekMonitorPlugin?.recordTurnUsage?.({
                usage: proxyRes.data.usage,
                model: proxyRes.data.model || targetModel,
                source: '手机辅助·代理',
                apiKey: cleanKey,
                baseUrl: targetUrl,
                provider: 'own_deepseek'
              });
            }
          } catch {}
          return { ok: true, plan: proxyRes.data.plan, model: proxyRes.data.model, engine: `${modeTag}_proxy` };
        }
        return {
          ok: false,
          code: proxyRes.data?.code || directErr?.code || 'PROXY_FAILED',
          error: proxyRes.data?.error || directErr?.message || '自定义 API 请求失败'
        };
      }
    };

    if (execMode === 'api_direct') {
      const cleanKey = cleanApiKey(cfg.apiKey);
      if (!cleanKey) {
        return { ok: false, code: 'NO_DIRECT_KEY', error: '手机辅助 DeepSeek 官方 API 密钥尚未配置，请填入密钥或切换至云端 API。' };
      }
      const rawModelCfg = String(cfg.model || 'deepseek-v4.1-flash').trim() || 'deepseek-v4.1-flash';
      const targetModel = resolveDirectModelForUrl(rawModelCfg, DEEPSEEK_OFFICIAL_CHAT_URL);
      return executeByokPlanCall({
        apiKey: cleanKey,
        targetUrl: DEEPSEEK_OFFICIAL_CHAT_URL,
        targetModel,
        modeTag: 'api_direct',
        allowDeepSeekMonitor: true
      });
    }

    if (cloudCfg.apiKey) {
      const targetCloudUrl = normalizeChatCompletionsUrl(cloudCfg.baseUrl || 'https://api.siliconflow.cn/v1/chat/completions');
      const fallbackFirstOpt = Array.from($('pa-cloud-model-select')?.options || []).find((o) => String(o.value || '').trim())?.value || '';
      const chosenCloudModel = cloudCfg.model || fallbackFirstOpt;
      if (!chosenCloudModel) {
        return { ok: false, code: 'CLOUD_MODEL_REQUIRED', error: '请先点击控制台中的「拉取模型」并选择一个可调用的云端模型。' };
      }
      return executeByokPlanCall({
        apiKey: cloudCfg.apiKey,
        targetUrl: targetCloudUrl,
        targetModel: chosenCloudModel,
        modeTag: 'api_cloud',
        allowDeepSeekMonitor: false
      });
    }

    let cloudRes = await apiPostJson(
      '/api/phone-agent/plan',
      {
        task,
        stepIndex,
        lastExternalApp: lastExt,
        snapshotId: snapshot?.snapshotId || '',
        foregroundApp: snapshot?.appName || '',
        packageName: snapshot?.packageName || '',
        hasSensitiveField: Boolean(snapshot?.hasSensitiveField),
        sensitiveReason: snapshot?.sensitiveReason || '',
        screenTreeText,
        screenNodes,
        screenVerdict,
        loopDiagnostics: loopDiagnostics || null,
        interjections: finalInterjections,
        history: compactHistory,
        screenSize,
        installedApps: compactInstalledApps,
        customModel: cloudCfg.model
      },
      signal
    );
    if (!cloudRes.ok && !signal?.aborted && (cloudRes.status >= 500 || cloudRes.status === 0)) {
      await nativeSleep(150, signal);
      cloudRes = await apiPostJson(
        '/api/phone-agent/plan',
        {
          task,
          stepIndex,
          lastExternalApp: lastExt,
          snapshotId: snapshot?.snapshotId || '',
          foregroundApp: snapshot?.appName || '',
          packageName: snapshot?.packageName || '',
          hasSensitiveField: Boolean(snapshot?.hasSensitiveField),
          sensitiveReason: snapshot?.sensitiveReason || '',
          screenTreeText,
          screenNodes,
          screenVerdict,
          loopDiagnostics: loopDiagnostics || null,
          interjections: finalInterjections,
          history: compactHistory,
          screenSize,
          installedApps: compactInstalledApps,
          customModel: cloudCfg.model
        },
        signal
      );
    }
    if (cloudRes.ok && cloudRes.data?.plan) {
      return { ok: true, plan: cloudRes.data.plan, model: cloudRes.data.model, engine: cloudRes.data.engine || 'api_cloud' };
    }
    return {
      ok: false,
      code: cloudRes.data?.code || 'CLOUD_ERROR',
      error: cloudRes.data?.error || '云端规划接口暂不可用'
    };
  }

  function dispatchNativePlanAction(plan, snapshot, opts = {}) {
    const b = getBridge();
    const tool = plan?.tool || plan?.action || 'done';
    const p = plan?.args || plan?.params || {};
    const latestNodes = snapshot?.nodes || [];
    const snapshotId = p.snapshotId || snapshot?.snapshotId || '';
    const forceGesture = Boolean(opts?.forceGesture);
    const taskLower = String(opts?.taskText || '').toLowerCase();

    if (!isNativeApk() || !b) {
      return { executed: false, simulated: true, text: '网页预览模式已推演该动作（安装随身版 APK 后可在真机自动执行）' };
    }

    const a11yOk = Boolean(b.isAccessibilityEnabled && b.isAccessibilityEnabled());
    if (!a11yOk && tool !== 'phone_open' && tool !== 'launch_app' && tool !== 'phone_wait' && tool !== 'wait' && tool !== 'done' && tool !== 'ask_user') {
      return { executed: false, error: true, text: '系统无障碍权限尚未开启，请先前往开启无障碍服务' };
    }

    // 代码级防自套娃硬拦截：严禁对控制端自身界面点击/打字，也禁止任务未提 DeepSeek 时误打开 DeepSeek
    const SELF_PKG = 'com.deepseek.starwhisper.studio';
    const curPkg = String(snapshot?.packageName || '').trim();
    const isSelfScreen = curPkg === SELF_PKG;
    const isDirectUiInteract =
      tool === 'phone_tap' ||
      tool === 'click_node' ||
      tool === 'phone_tap_xy' ||
      tool === 'click' ||
      tool === 'phone_double_tap' ||
      tool === 'phone_long_press' ||
      tool === 'long_click' ||
      tool === 'phone_type' ||
      tool === 'input';

    if (isSelfScreen && isDirectUiInteract) {
      const switched = typeof b.returnToLastExternalApp === 'function'
        ? b.returnToLastExternalApp()
        : b.dispatchGlobalAction('switch_last_app');
      return {
        executed: Boolean(switched),
        error: !switched,
        text: switched ? '已拦截对控制端自身的误操作，自动切回目标应用' : '当前位于控制端界面，切回目标应用失败'
      };
    }

    if ((tool === 'phone_open' || tool === 'launch_app') && /deepseek|星语/i.test(String(p.appName || '')) && !/deepseek|星语/i.test(taskLower)) {
      const switched = typeof b.returnToLastExternalApp === 'function'
        ? b.returnToLastExternalApp()
        : b.dispatchGlobalAction('switch_last_app');
      return {
        executed: Boolean(switched),
        error: !switched,
        text: switched ? '已跳过误打开 DeepSeek，自动切回上一个目标应用' : '未能切回目标应用'
      };
    }

    try {
      if (tool === 'phone_open' || tool === 'launch_app') {
        const appName = String(p.appName || '').trim();
        if (typeof b.launchAppByName === 'function') {
          const ok = b.launchAppByName(appName);
          return ok
            ? { executed: true, text: `已打开应用「${appName}」` }
            : { executed: false, error: true, text: `未能匹配或拉起应用「${appName}」` };
        }
        const msg = String(b.executeLocalRule(`打开 ${appName}`) || '');
        const okFallback = isLocalRuleSucceeded(msg);
        return { executed: okFallback, error: !okFallback, text: msg || `尝试打开「${appName}」` };
      }

      if (tool === 'phone_tap' || tool === 'click_node') {
        const refId = String(p.ref || '').trim();
        if (refId && (typeof b.clickByRefGesture === 'function' || typeof b.clickByRef === 'function')) {
          const rawRes = forceGesture && typeof b.clickByRefGesture === 'function'
            ? b.clickByRefGesture(snapshotId, refId)
            : b.clickByRef(snapshotId, refId);
          const resObj = JSON.parse(rawRes || '{}');
          if (!resObj.ok && Array.isArray(latestNodes) && typeof b.dispatchClick === 'function') {
            const matchedNode = latestNodes.find((n) => n.ref === refId);
            const fallbackCenter = parseBoundsCenter(matchedNode);
            if (fallbackCenter && fallbackCenter.cx > 0 && fallbackCenter.cy > 0) {
              const coordOk = b.dispatchClick(fallbackCenter.cx, fallbackCenter.cy);
              if (coordOk) {
                return {
                  executed: true,
                  error: false,
                  method: 'gesture_fallback',
                  x: fallbackCenter.cx,
                  y: fallbackCenter.cy,
                  text: `已通过坐标兜底点击控件 ${refId} (${fallbackCenter.cx}, ${fallbackCenter.cy})`
                };
              }
            }
          }
          return {
            executed: Boolean(resObj.ok),
            error: !resObj.ok,
            method: resObj.method || (forceGesture ? 'gesture' : 'node'),
            x: Number(resObj.x) || 0,
            y: Number(resObj.y) || 0,
            text: resObj.message || (resObj.ok ? `已点击控件 ${refId}` : `点击控件 ${refId} 失败`)
          };
        }
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
          : { executed: false, error: true, text: `当前界面未找到控件「${targetText || refId}」` };
      }

      if (tool === 'phone_tap_xy' || tool === 'click') {
        const x = Number(p.x) || 540;
        const y = Number(p.y) || 1200;
        const ok = b.dispatchClick(x, y);
        return { executed: Boolean(ok), error: !ok, text: ok ? `已点击坐标 (${x}, ${y})` : '坐标点击派发失败' };
      }

      if (tool === 'phone_double_tap') {
        const x = Number(p.x) || 540;
        const y = Number(p.y) || 1000;
        const ok = typeof b.doubleTapAt === 'function' ? b.doubleTapAt(x, y) : b.dispatchClick(x, y);
        return { executed: Boolean(ok), error: !ok, text: ok ? `已双击坐标 (${x}, ${y})` : '双击派发失败' };
      }

      if (tool === 'phone_long_press' || tool === 'long_click') {
        const refId = String(p.ref || '').trim();
        const dur = Number(p.duration) || 700;
        if (refId && typeof b.longClickByRef === 'function') {
          const resObj = JSON.parse(b.longClickByRef(snapshotId, refId, dur) || '{}');
          return { executed: Boolean(resObj.ok), error: !resObj.ok, text: resObj.message || `已长按 ${refId}` };
        }
        const x = Number(p.x) || 540;
        const y = Number(p.y) || 1200;
        const ok = typeof b.dispatchLongClick === 'function' ? b.dispatchLongClick(x, y, dur) : b.dispatchClick(x, y);
        return { executed: Boolean(ok), error: !ok, text: ok ? `已长按坐标 (${x}, ${y})` : '长按派发失败' };
      }

      if (tool === 'phone_type' || tool === 'input') {
        const txt = String(p.text || '');
        const refId = String(p.ref || '').trim();
        const clearFirst = p.clear !== undefined ? Boolean(p.clear) : !Boolean(p.append);
        const shouldAutoSubmit = Boolean(p.submit || p.autoSubmit);
        if (typeof b.inputByRef === 'function') {
          const resObj = JSON.parse(b.inputByRef(snapshotId, refId, txt, clearFirst, shouldAutoSubmit) || '{}');
          return {
            executed: Boolean(resObj.ok),
            error: !resObj.ok,
            text: resObj.message || (resObj.ok ? `已输入文本「${txt}」` : '未能定位输入框')
          };
        }
        const ok = typeof b.dispatchSmartInput === 'function'
          ? b.dispatchSmartInput(txt, !clearFirst, shouldAutoSubmit)
          : b.dispatchInputText(String(p.viewId || ''), txt);
        return {
          executed: Boolean(ok),
          error: !ok,
          text: ok ? `已向输入框填入「${txt}」` : '未能定位到可编辑输入框'
        };
      }

      if (tool === 'phone_scroll' || tool === 'scroll') {
        const dir = String(p.direction || 'down');
        const ratio = Number(p.amount) || 0.65;
        const ok = typeof b.scrollScreen === 'function'
          ? b.scrollScreen(dir, ratio)
          : b.dispatchSwipe(540, 1600, 540, 650, 340);
        return { executed: Boolean(ok), error: !ok, text: ok ? `已向 ${dir} 滚动页面` : '滚动派发失败' };
      }

      if (tool === 'phone_swipe' || tool === 'swipe') {
        const x1 = Number(p.x1) || 540;
        const y1 = Number(p.y1) || 1650;
        const x2 = Number(p.x2) || 540;
        const y2 = Number(p.y2) || 650;
        const dur = Number(p.duration) || 340;
        const ok = b.dispatchSwipe(x1, y1, x2, y2, dur);
        return { executed: Boolean(ok), error: !ok, text: ok ? `已执行滑动 (${x1},${y1} -> ${x2},${y2})` : '滑动派发失败' };
      }

      if (tool === 'phone_key' || tool === 'home' || tool === 'back' || tool === 'recents' || tool === 'key') {
        const key = String(p.key || tool || 'back').toLowerCase();
        const ok = b.dispatchGlobalAction(key);
        return { executed: Boolean(ok), error: !ok, text: ok ? `已执行系统键 (${key})` : `系统键 ${key} 执行失败` };
      }

      if (tool === 'phone_wait' || tool === 'wait') {
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

    if (/^(回桌面|桌面|主页|home|返回|后退|上一页|back|最近任务|多任务|后台|切回上个应用|上个应用|切上个app|切换应用|下拉通知|通知栏|通知|控制中心|快捷设置|快捷开关|截屏|截图|屏幕截图|锁屏|息屏|电源菜单|音量\+|音量-|音量加|音量减|调大音量|调小音量|增大音量|降低音量|静音|取消静音|切换静音|下一首|下一首歌|切歌|换首歌|换一首歌|上一首|上一首歌|暂停音乐|停一下音乐|播放音乐|继续播放|继续放歌|读屏幕|读取屏幕|查看屏幕|点中间|点击中间|唱歌|唱首歌|唱一首|唱一首歌|给我唱歌|喂米饭|吃米饭|摸摸头|跳个舞|讲热梗|开启防误触|打开防误触|关闭防误触|解锁防误触|关闭语音尾巴|隐藏语音尾巴|开启语音尾巴|打开语音尾巴|关闭桌面歌词|关闭透明歌词|打开桌面歌词|开启桌面歌词|开启透明歌词)$/i.test(clean)) {
      return true;
    }
    if (/^(?:用qq音乐|在qq音乐|qq音乐)?\s*(?:播放|放一首|放首|点播|我想听|来一首|唱一首|听一下|听一首)\s*.+$/i.test(clean) && !/视频/.test(clean)) {
      const kw = clean.replace(/^(?:用qq音乐|在qq音乐|qq音乐)?\s*(?:播放|放一首|放首|点播|我想听|来一首|唱一首|听一下|听一首)(?:音乐|歌曲|歌)?\s*(?:的)?\s*/i, '').trim();
      if (kw && kw !== '歌' && kw !== '一首歌' && kw !== '首歌' && kw !== '音乐') return true;
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

    // 0. 鲸鱼娘桌面宠物互动（干饭/摸头/跳舞/唱歌/热梗/防误触/语音尾巴/桌面歌词）优先联动悬浮窗原声与动作
    if (/^(?:喂米饭|吃米饭|喂食|干饭|摸摸头|摸头|跳个舞|跳舞|唱歌|唱首歌|唱一首|唱一首歌|给我唱歌|停唱|别唱了|讲热梗|开启防误触|打开防误触|关闭防误触|解锁防误触|关闭语音尾巴|隐藏语音尾巴|开启语音尾巴|打开语音尾巴|关闭桌面歌词|关闭透明歌词|打开桌面歌词|开启桌面歌词|开启透明歌词)$/i.test(clean) || (clean.includes('米饭') && clean.length <= 10)) {
      if (typeof b.startFloatAgent === 'function' && typeof b.isFloatAgentRunning === 'function' && !b.isFloatAgentRunning()) {
        try { b.startFloatAgent(); } catch {}
      }
      if (typeof b.triggerWhaleAction === 'function') {
        setTimeout(() => { try { b.triggerWhaleAction(clean); } catch {} }, 180);
        return { handled: true, summary: `鲸鱼娘已响应「${clean}」，正在切换姿态并播放原声~` };
      }
    }

    // 1. 先交由原生丰富离线规则引擎处理（支持 QQ 音乐点播/切歌、组合宏、刷视频、智能打字、搜索、音量、截屏等）
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
    isAgentRunning = true;
    updateQueueBarUi();

    if (native && b && typeof b.resetEmergencyStop === 'function') {
      try { b.resetEmergencyStop(); } catch {}
    }
    if (native && b) {
      try {
        if (typeof b.hasOverlayPermission === 'function' && b.hasOverlayPermission()
            && typeof b.isFloatAgentRunning === 'function' && !b.isFloatAgentRunning()
            && typeof b.startFloatAgent === 'function') {
          b.startFloatAgent();
        }
        if (typeof b.setEdgeGlowEnabled === 'function') {
          b.setEdgeGlowEnabled(isEdgeGlowEnabled());
        }
        if (typeof b.setAgentForegroundActive === 'function') {
          b.setAgentForegroundActive(true, taskText.slice(0, 32));
        }
      } catch {}
    }

    if (cardCtx.stopBtn) {
      cardCtx.stopBtn.disabled = false;
      cardCtx.stopBtn.textContent = '停止';
      cardCtx.stopBtn.onclick = () => {
        emergencyStopRequested = true;
        try { activeAbortController.abort(); } catch {}
        if (native && b && typeof b.stopAutoSwipeVideos === 'function') {
          try { b.stopAutoSwipeVideos(); } catch {}
        }
        if (cardCtx.stopBtn) {
          cardCtx.stopBtn.disabled = true;
          cardCtx.stopBtn.textContent = '已停止';
        }
        if (native && b && typeof b.updateFloatState === 'function') {
          try { b.updateFloatState('idle', 'dsh-Go'); } catch {}
        }
        syncStatus();
      };
    }

    let finalStatus = 'done';
    let finalSummaryTitle = '';
    let finalReplyText = '';
    let handoverCb = null;
    let isChatOnlyTurn = false;
    let lastHudVerdictText = '';
    let sentDoneHudNotice = false;

    try {
      // 分支 A：本地免 API 模式（优先匹配已固化的 AI 学习技能，再匹配内置离线口令）
      const matchedSkill = !isResuming ? findMatchingLearnedSkill(taskText) : null;
      if (matchedSkill && (execMode === 'local' || /^skill:/i.test(String(taskText || '').trim()))) {
        const skillRes = await replayLearnedSkill(matchedSkill, cardCtx, signal);
        finalizeAgentTurn(cardCtx, {
          status: skillRes.status,
          summaryTitle: skillRes.summaryTitle,
          replyText: skillRes.replyText,
          isSkillReplay: true
        });
        if (skillRes?.status === 'done') {
          sentDoneHudNotice = true;
          syncNativeFloatProgress({
            state: 'idle',
            phase: 'done',
            step: cardCtx.stepCount || 0,
            appName: matchedSkill.name || '离线技能',
            toolName: 'done',
            summary: skillRes.summaryTitle || `技能「${matchedSkill.name}」完成`,
            thought: (skillRes.replyText || '').slice(0, 120)
          });
        }
        syncStatus();
        return;
      }

      const matchedOffline = isSimpleBuiltInLocalCmd(taskText);
      const shouldTryFullLocal = !isResuming && execMode === 'local';
      if (shouldTryFullLocal) {
        if (isLikelyPureChat(taskText) && !matchedOffline) {
          const smart = buildLocalSmartChatReply(taskText);
          appendThoughtItem(cardCtx, '本地思考', smart.thought || '识别为自然聊天或咨询提问，无需操控手机。');
          recordPaChatTurn('assistant', smart.reply);
          const quickAction = smart.actionType === 'open_setup_guide'
            ? { label: '打开无障碍与悬浮窗新手指引', onClick: () => openSetupGuideWizard(1) }
            : (smart.actionType === 'open_settings'
                ? { label: '打开控制台切换 / 配置引擎', onClick: () => openControlSheet(false) }
                : null);
          finalizeAgentTurn(cardCtx, { status: 'done', replyText: smart.reply, isChatOnly: true, quickAction });
          return;
        }

        if (!native) {
          cardCtx.stepCount = 1;
          if (matchedOffline) {
            const sim = simulateWebLocalPreview(taskText);
            addStepItem(cardCtx.stepsList, 1, taskText, '网页预览模拟执行', '模拟完成', false, 'local.rule');
            finalSummaryTitle = `已完成本地口令演练 · ${taskText}`;
            finalReplyText = sim;
          } else if (!EXPLICIT_CONTROL_VERB_RE.test(taskText)) {
            const smart = buildLocalSmartChatReply(taskText);
            appendThoughtItem(cardCtx, '本地思考', smart.thought);
            recordPaChatTurn('assistant', smart.reply);
            const quickAction = smart.actionType === 'open_setup_guide'
              ? { label: '打开无障碍与悬浮窗新手指引', onClick: () => openSetupGuideWizard(1) }
              : null;
            finalizeAgentTurn(cardCtx, { status: 'done', replyText: smart.reply, isChatOnly: true, quickAction });
            return;
          } else {
            addStepItem(cardCtx.stepsList, 1, '超出固定离线口令范围', '建议切换至 DeepSeek API 或云端 API 进行智能识屏规划。', '未匹配', true, 'local.rule');
            showInlineFixBox(cardCtx.fixSlot, { error: '该任务超出本地免 API 固定口令范围，请选择要切换的智能引擎继续：' }, {
              currentMode: 'local',
              onRetryWithMode: (nextMode) => runReActLoop(taskText, cardCtx, nextMode)
            });
            finalStatus = 'error';
            finalSummaryTitle = '需要切换 API 智能识屏模式';
          }
          finalizeAgentTurn(cardCtx, { status: finalStatus, summaryTitle: finalSummaryTitle, replyText: finalReplyText });
          return;
        }

        const res = tryExecuteLocalQuickCommand(taskText);
        if (res.handled) {
          cardCtx.stepCount = 1;
          addStepItem(cardCtx.stepsList, 1, taskText, '命中本地离线指令库 · 免 API 毫秒级直控', '已完成', false, 'local.rule');
          appendNativeConsoleLog(`本地执行成功: ${taskText} -> ${res.summary}`);
          finalizeAgentTurn(cardCtx, {
            status: 'done',
            summaryTitle: `已执行：${taskText}`,
            replyText: res.summary
          });
          sentDoneHudNotice = true;
          syncNativeFloatProgress({
            state: 'idle',
            phase: 'done',
            step: 1,
            appName: '',
            toolName: 'local.rule',
            summary: `已执行：${taskText}`,
            thought: (res.summary || '').slice(0, 120)
          });
          if (isNativeAutoSwiping() && cardCtx.stopBtn) {
            cardCtx.stopBtn.classList.remove('hidden');
            cardCtx.stopBtn.textContent = '停止连刷';
          }
          syncStatus();
          return;
        }

        if (!EXPLICIT_CONTROL_VERB_RE.test(taskText)) {
          const smart = buildLocalSmartChatReply(taskText);
          appendThoughtItem(cardCtx, '本地思考', smart.thought);
          recordPaChatTurn('assistant', smart.reply);
          const quickAction = smart.actionType === 'open_setup_guide'
            ? { label: '打开无障碍与悬浮窗新手指引', onClick: () => openSetupGuideWizard(1) }
            : (smart.actionType === 'open_settings'
                ? { label: '打开控制台切换 / 配置引擎', onClick: () => openControlSheet(false) }
                : null);
          finalizeAgentTurn(cardCtx, { status: 'done', replyText: smart.reply, isChatOnly: true, quickAction });
          return;
        }

        cardCtx.stepCount = 1;
        addStepItem(cardCtx.stepsList, 1, '本地离线口令未匹配', '可切换至 DeepSeek API 或云端 API 执行复杂任务', '未匹配', true, 'local.rule');
        showInlineFixBox(cardCtx.fixSlot, { error: '该任务超出本地免 API 固定口令范围，请选择要切换的智能引擎继续：' }, {
          currentMode: 'local',
          onRetryWithMode: (nextMode) => runReActLoop(taskText, cardCtx, nextMode)
        });
        finalizeAgentTurn(cardCtx, { status: 'error', summaryTitle: '本地口令未匹配' });
        return;
      }

      // 分支 B：dsh-Go 智能多步 ReAct 循环（支持任务前需求确认、ref 控屏、死循环自愈、微序列动作与弹窗确认）
      let activeTaskText = taskText;
      const MAX_STEPS = 80;
      const history = isResuming ? resumeOpts.history.slice() : [];
      const recordedSteps = Array.isArray(resumeOpts?.recordedSteps) ? resumeOpts.recordedSteps.slice() : [];
      const screenSize = getScreenSizeObj();
      const installedApps = getInstalledAppsList();
      let roundAutoApproved =
        resumeOpts && typeof resumeOpts.roundAutoApproved === 'boolean'
          ? resumeOpts.roundAutoApproved
          : (getConfirmPolicy() === 'auto_turn');
      let startStep = isResuming && Number(resumeOpts.startStep) > 0 ? Number(resumeOpts.startStep) : 1;
      let lastScreenVerdict = resumeOpts?.lastScreenVerdict || null;
      let prefetchedSnap = null;
      let noChangeStreak = 0;
      let earlyDoneIntercepts = 0;
      let autoContinueHint = Array.isArray(resumeOpts?.initialInterjections)
        ? resumeOpts.initialInterjections.join('；')
        : '';
      const loopState = {
        noChangeStreak: 0,
        errorStreak: 0,
        waitStreak: 0,
        recoveryAttempts: 0,
        lastStuckReason: '',
        failedActionMap: new Map(),
        failedActionLabels: new Map(),
        pageStepCounts: new Map(),
        recentPageSigs: [],
        recentActionFingerprints: []
      };

      const lastExtApp = native ? (resumeOpts?.lastExternalApp || getLastExternalAppInfo()) : { packageName: '', appName: '' };
      let preflightSkipAutoReturn = false;

      // 任务前需求澄清门控：在切走当前界面前，主动核对模糊任务并让用户确认
      const clarifyPolicy = getClarifyPolicy();
      if (!shouldSkipPreFlightClarify(activeTaskText, clarifyPolicy, resumeOpts)) {
        const preStepEl = addStepItem(
          cardCtx.stepsList,
          0,
          '正在核对任务需求',
          '检查是否需要补充细节，暂不切换当前界面',
          '需求预检中',
          false,
          'pre.check'
        );
        if (cardCtx.summaryTextEl) {
          cardCtx.summaryTextEl.textContent = '正在核对需求细节…';
        }
        const preRes = await requestPreFlightCheck({
          execMode,
          task: activeTaskText,
          clarifyPolicy,
          lastExternalApp: lastExtApp,
          installedApps,
          signal
        });
        const pf = preRes?.preflight || { intent: 'task', ready: true };
        if (pf.intent === 'chat') {
          preflightSkipAutoReturn = true;
          updateStepResult(preStepEl, '识别为对话', false);
        } else if (!pf.ready || clarifyPolicy === 'always') {
          updateStepResult(preStepEl, '等待需求确认', false);
          const clarifyRes = await askPreFlightClarifyModal({
            taskText: activeTaskText,
            thought: pf.thought,
            planPreview: pf.planPreview,
            question: pf.question,
            options: pf.options,
            signal
          });
          if (clarifyRes.mode === 'cancel') {
            updateStepResult(preStepEl, '已取消', true);
            finalizeAgentTurn(cardCtx, {
              status: 'error',
              summaryTitle: '已取消本次任务',
              replyText: '好的，已取消执行，你可以重新输入更具体的需求~',
              sourceTask: taskText
            });
            return;
          }
          if (clarifyRes.mode === 'reply' && clarifyRes.text) {
            appendUserMessageRow(clarifyRes.text);
            recordPaChatTurn('user', clarifyRes.text);
            activeTaskText = `${taskText}\n【用户已确认的具体需求】：${clarifyRes.text}`;
            updateStepResult(preStepEl, `已确认：${clarifyRes.text.slice(0, 14)}`, false);
          } else {
            updateStepResult(preStepEl, '直接按原指令执行', false);
          }
        } else {
          updateStepResult(preStepEl, '需求明确 · 立即执行', false);
        }
      }

      const isBatchContinuousTask =
        /(?:写作业|做作业|答题|做题|刷题|练习|测试|继续|接着|全部|整套|所有)/.test(activeTaskText) &&
        !/(?:只做(?:这)?[一1]题|做完这[一1]题就停)/.test(activeTaskText);

      // 第 0 步自动跳回目标 App（仅在需求确认后、且明确为继续上一个应用任务时才切回）
      if (native && !preflightSkipAutoReturn && !isLikelyPureChat(activeTaskText) && (!isResuming || resumeOpts?.returnToExternalFirst)) {
        const initSnap = readAndFormatSnapshot(false);
        const SELF_PKG = 'com.deepseek.starwhisper.studio';
        const explicitNewAppMatch = String(activeTaskText || '').trim().match(/(?:打开|启动|进入|去|切到|用)\s*([^\s，。！？,!?]{2,12})/);
        const explicitlyContinuePrev = Boolean(resumeOpts?.returnToExternalFirst) || /(?:继续|接着|回到|切回|上一题|下一题|这道题|当前页面|当前屏幕)/.test(activeTaskText);
        const wantsReturnToPrev = explicitlyContinuePrev && !explicitNewAppMatch;
        if (initSnap.packageName === SELF_PKG && wantsReturnToPrev && (lastExtApp.packageName || typeof b.dispatchGlobalAction === 'function')) {
          const switchedOk = typeof b.returnToLastExternalApp === 'function'
            ? b.returnToLastExternalApp()
            : b.dispatchGlobalAction('switch_last_app');
          if (switchedOk) {
            const label = lastExtApp.appName || '上一个应用';
            addStepItem(cardCtx.stepsList, 0, `自动切回「${label}」继续执行`, '防止在控制端自身界面误操作', '已切回', false, 'phone.open');
            await nativeSleep(320, signal);
          }
        } else if (initSnap.packageName && initSnap.packageName !== SELF_PKG && Array.isArray(initSnap.nodes) && initSnap.nodes.length > 0) {
          prefetchedSnap = initSnap;
        }
      }

      for (let step = startStep; step <= MAX_STEPS; step++) {
        if (signal.aborted || emergencyStopRequested) {
          addStepItem(cardCtx.stepsList, step, '任务已停止', '', '已中止', true, 'system.stop');
          finalStatus = 'error';
          finalSummaryTitle = '已停止执行';
          break;
        }
        if (native && b && typeof b.isEmergencyStopRequested === 'function' && b.isEmergencyStopRequested()) {
          b.resetEmergencyStop();
          addStepItem(cardCtx.stepsList, step, '悬浮球急停触发', '', '已急停', true, 'system.stop');
          finalStatus = 'error';
          finalSummaryTitle = '已安全急停';
          break;
        }

        // 消费排队插话指令与连续做题防早退提醒
        const turnInterjections = [];
        if (autoContinueHint) {
          turnInterjections.push(autoContinueHint);
          autoContinueHint = '';
        }
        while (queuedInterjections.length > 0) {
          const item = queuedInterjections.shift();
          if (item && item.text) turnInterjections.push(item.text);
        }
        updateQueueBarUi();

        updateThinkingPhase(cardCtx, 'inspect');
        const snapshot = prefetchedSnap || readAndFormatSnapshot(false);
        prefetchedSnap = null;
        syncNativeFloatProgress({
          state: 'thinking',
          phase: 'thinking',
          step,
          appName: snapshot.appName || '桌面',
          toolName: 'phone.screen',
          summary: `第 ${step} 步 识屏规划`,
          thought: native
            ? `正在读取「${snapshot.appName || '当前界面'}」(${snapshot.nodes?.length || 0} 个元素) 并推理下一步…`
            : '网页端正在进行逻辑推演规划…',
          verdictText: lastHudVerdictText
        });
        const currentPageKey = `${snapshot.packageName || ''}::${snapshot.signature || ''}`;
        if (native && currentPageKey !== '::') {
          loopState.recentPageSigs.push(currentPageKey);
          if (loopState.recentPageSigs.length > 8) loopState.recentPageSigs = loopState.recentPageSigs.slice(-8);
          loopState.pageStepCounts.set(currentPageKey, (loopState.pageStepCounts.get(currentPageKey) || 0) + 1);
        }
        const oscDetected = native ? detectOscillation(loopState.recentPageSigs) : false;
        const blockedLabels = loopState.failedActionLabels.get(currentPageKey) || [];
        const currentPageVisitsTotal = loopState.pageStepCounts.get(currentPageKey) || 0;
        const loopDiagnostics = {
          noChangeStreak: loopState.noChangeStreak,
          errorStreak: loopState.errorStreak,
          waitStreak: loopState.waitStreak,
          oscillationDetected: oscDetected,
          recoveryAttempts: loopState.recoveryAttempts,
          blockedActions: blockedLabels.slice(-8),
          samePageVisits: currentPageVisitsTotal
        };

        const beforeEventSeq = native ? (Number(snapshot.eventSeq) || Number(readScreenEventSeq().seq) || 0) : 0;
        const pendingStepEl = addStepItem(
          cardCtx.stepsList,
          step,
          '正在识别屏幕并规划',
          native ? `当前应用：${snapshot.appName || '桌面'}（${snapshot.nodes.length} 个元素）` : '网页端逻辑推演规划中',
          '规划中',
          false,
          'phone.screen'
        );
        cardCtx.stepCount = step;
        if (cardCtx.summaryTextEl) {
          cardCtx.summaryTextEl.textContent = `第 ${step} 步 · ${snapshot.appName || '读取屏幕'} 规划中`;
        }

        updateThinkingPhase(cardCtx, 'think');
        let planResp;
        try {
          planResp = await requestPlanStep({
            execMode,
            task: activeTaskText,
            snapshot,
            history,
            screenSize,
            installedApps,
            screenVerdict: lastScreenVerdict,
            loopDiagnostics,
            interjections: turnInterjections,
            stepIndex: step,
            lastExternalApp: lastExtApp,
            signal
          });
        } catch (err) {
          if (err?.name === 'AbortError' || signal.aborted) {
            updateStepResult(pendingStepEl, '已取消', true);
            finalStatus = 'error';
            finalSummaryTitle = '已取消当前任务';
            break;
          }
          updateStepResult(pendingStepEl, '网络异常', true);
          finalStatus = 'error';
          finalSummaryTitle = `规划网络异常：${err?.message || err}`;
          break;
        }

        if (!planResp.ok || !planResp.plan) {
          updateStepResult(pendingStepEl, '规划失败', true);
          showInlineFixBox(cardCtx.fixSlot, planResp, {
            currentMode: execMode,
            onRetryWithMode: (nextMode) =>
              runReActLoop(
                activeTaskText,
                cardCtx,
                nextMode,
                nextMode === 'local' ? null : { history, recordedSteps, startStep: step, roundAutoApproved, lastScreenVerdict }
              ),
            onRetryStep: () =>
              runReActLoop(activeTaskText, cardCtx, execMode, {
                history,
                recordedSteps,
                startStep: step,
                roundAutoApproved,
                lastScreenVerdict
              })
          });
          finalStatus = 'error';
          finalSummaryTitle = planResp.error || '未能获取有效规划指令';
          break;
        }

        let plan = planResp.plan;
        let toolName = plan.tool || plan.action || 'step';

        // Level 2 & Level 3 死循环/卡死硬拦截与卡顿主动询问用户防循环引擎
        if (native && toolName !== 'chat' && toolName !== 'done' && toolName !== 'ask_user') {
          let fp = getActionFingerprint(plan, snapshot);
          const pageBlockedSet = loopState.failedActionMap.get(currentPageKey);
          const isRepeatedFail = Boolean(pageBlockedSet && pageBlockedSet.has(fp));
          const isRepeatedRecent =
            loopState.noChangeStreak >= 1 &&
            loopState.recentActionFingerprints.slice(-2).includes(fp);
          const isWaitLoop = (toolName === 'phone_wait' || toolName === 'wait') && loopState.waitStreak >= 1;
          const needLoopIntercept =
            isWaitLoop ||
            isRepeatedFail ||
            isRepeatedRecent ||
            oscDetected ||
            loopState.noChangeStreak >= 2 ||
            loopState.errorStreak >= 2 ||
            (!isBatchContinuousTask && currentPageVisitsTotal >= 5);

          const buildStuckAskPlan = (reasonText) => ({
            thought: `检测到执行卡顿（${reasonText}），为防止陷入死循环，已主动暂停并向你请示指示。`,
            tool: 'ask_user',
            args: {
              message: `我在「${snapshot.appName || '当前界面'}」出现卡顿（${reasonText}），为防止陷入死循环已暂停。请直接输入指示告诉我点哪里/怎么做，或选择下方方案：`,
              reason: 'confirm',
              options: ['帮我跳过这步换个方法', '返回上一页重新找', '我已手动操作，继续执行', '先停止本次任务']
            },
            risk: 'read',
            summary: '遇到卡顿 · 请给指示防循环',
            reply: `我在「${snapshot.appName || '当前界面'}」出现卡顿（${reasonText}），请给指示。`
          });

          if (needLoopIntercept) {
            const stuckReason = loopState.errorStreak >= 2
              ? `连续 ${loopState.errorStreak} 步操作执行失败`
              : (loopState.noChangeStreak >= 2
                  ? `连续 ${loopState.noChangeStreak} 步画面无变化`
                  : (oscDetected
                      ? '页面在两个界面间反复跳转'
                      : (isWaitLoop
                          ? '连续等待界面仍无响应'
                          : (!isBatchContinuousTask && currentPageVisitsTotal >= 5
                              ? `在同一页面停留 ${currentPageVisitsTotal} 步未推进`
                              : `动作 ${toolName}(${summarizePlanArgs(plan)}) 重复失效`))));
            loopState.lastStuckReason = stuckReason;

            const shouldProactiveAskUser =
              loopState.noChangeStreak >= 2 ||
              loopState.errorStreak >= 2 ||
              (loopState.recoveryAttempts >= 1 && (isRepeatedFail || isRepeatedRecent || oscDetected || isWaitLoop)) ||
              (!isBatchContinuousTask && currentPageVisitsTotal >= 5);

            if (!shouldProactiveAskUser && loopState.recoveryAttempts < 1) {
              // Level 2：仅允许 1 次无感自愈（清理遮挡弹窗 或 换路重规划）
              loopState.recoveryAttempts += 1;
              const dismissNode = findPopupDismissNode(snapshot.nodes, activeTaskText);
              const dismissFp = dismissNode ? `tap:${dismissNode.ref || ''}:${String(dismissNode.text || dismissNode.desc || '').slice(0, 24)}` : '';
              if (dismissNode && (!pageBlockedSet || !pageBlockedSet.has(dismissFp))) {
                const dismissLabel = String(dismissNode.text || dismissNode.desc || '弹窗按钮').slice(0, 12);
                plan = {
                  thought: `检测到页面可能被弹窗遮挡导致卡顿，自动点击「${dismissLabel}」清理遮挡后继续。`,
                  tool: 'phone_tap',
                  args: { ref: dismissNode.ref, snapshotId: snapshot.snapshotId },
                  risk: 'write',
                  summary: `自动清理遮挡弹窗「${dismissLabel}」`
                };
                toolName = 'phone_tap';
                appendNativeConsoleLog(`第${step}步触发自动纠偏：清理遮挡弹窗「${dismissLabel}」`);
              } else {
                const recoveryHint = `【系统死循环自动纠偏】${stuckReason}。当前页面禁用动作列表：${blockedLabels.join('；') || fp}。请立即更换完全不同的策略（如换控件、改用坐标、滚动查找、phone_key(back) 或 ask_user）！`;
                const rePlanResp = await requestPlanStep({
                  execMode,
                  task: activeTaskText,
                  snapshot,
                  history,
                  screenSize,
                  installedApps,
                  screenVerdict: lastScreenVerdict,
                  loopDiagnostics: { ...loopDiagnostics, recoveryAttempts: loopState.recoveryAttempts },
                  interjections: turnInterjections,
                  extraRecoveryHint: recoveryHint,
                  stepIndex: step,
                  lastExternalApp: lastExtApp,
                  signal
                }).catch(() => null);
                if (rePlanResp && rePlanResp.ok && rePlanResp.plan) {
                  const candPlan = rePlanResp.plan;
                  const candFp = getActionFingerprint(candPlan, snapshot);
                  if (!pageBlockedSet?.has(candFp) && candFp !== fp) {
                    plan = candPlan;
                    toolName = plan.tool || plan.action || 'step';
                    appendNativeConsoleLog(`第${step}步触发死循环纠偏重规划 -> ${toolName}`);
                  } else {
                    plan = buildStuckAskPlan(stuckReason);
                    toolName = 'ask_user';
                  }
                } else {
                  plan = buildStuckAskPlan(stuckReason);
                  toolName = 'ask_user';
                }
              }
            } else {
              // Level 3：立即主动询问用户，防止死循环
              plan = buildStuckAskPlan(stuckReason);
              toolName = 'ask_user';
            }
          }
        }
        const currentThoughtEl = appendThoughtItem(
          cardCtx,
          `第 ${step} 步`,
          plan.thought,
          plan.reasoning,
          {
            stepNum: step,
            appName: snapshot.appName || '',
            toolName,
            actionSummary: plan.summary || ''
          }
        );
        updateThinkingPhase(cardCtx, toolName === 'done' || toolName === 'chat' ? 'verify' : 'act');

        const badgeEl = pendingStepEl?.querySelector('.pa-tool-badge');
        if (badgeEl) badgeEl.textContent = Array.isArray(plan.actions) && plan.actions.length >= 2 ? `${toolName}×${plan.actions.length}` : toolName;
        const descEl = pendingStepEl?.querySelector('.pa-step-desc');
        if (descEl) descEl.textContent = plan.summary || toolName;
        const thoughtEl = pendingStepEl?.querySelector('.pa-step-thought');
        if (thoughtEl && plan.thought) thoughtEl.textContent = plan.thought;
        if (cardCtx.summaryTextEl) {
          cardCtx.summaryTextEl.textContent = `${toolName} · ${plan.summary || '执行中'}`;
        }

        if (toolName === 'chat') {
          const chatMsg = plan.reply || plan.args?.message || plan.summary || '好的，我在听。';
          updateThoughtOutcome(currentThoughtEl, '✓ 对话已回复', true, false);
          recordPaChatTurn('assistant', chatMsg);
          isChatOnlyTurn = true;
          finalStatus = 'done';
          finalSummaryTitle = '对话完成';
          finalReplyText = chatMsg;
          break;
        }

        if (toolName === 'done') {
          const treeTxt = String(snapshot?.screenTreeText || '');
          const progM = treeTxt.match(/(?:^|[^\d])(\d{1,3})\s*\/\s*(\d{1,3})(?:[^\d]|$)/);
          const hasRemainingProgress = Boolean(progM && Number(progM[1]) < Number(progM[2]) && Number(progM[2]) <= 300);
          const hasNextBtn = /(?:下一题|下1题|继续答题|下一道)/.test(treeTxt);
          const isFinishedScreen = /(?:交卷成功|提交成功|已完成全部|答题报告|本次得分|成绩单|正确率|查看解析|再练一次)/.test(treeTxt);

          if (native && isBatchContinuousTask && earlyDoneIntercepts < 8 && !isFinishedScreen && (hasNextBtn || hasRemainingProgress)) {
            earlyDoneIntercepts += 1;
            autoContinueHint = '【系统强提醒】检测到当前屏幕仍有未完成题目（存在“下一题”按钮或进度未到最后一题），严禁提前返回 done！请立刻作答当前屏幕题目（或若已选中正确答案则直接点击“下一题”），持续推进直到整套题全部做完。';
            updateStepResult(pendingStepEl, '继续下一题', false);
            updateThoughtOutcome(currentThoughtEl, '↻ 检测到仍有题目，继续作答', false, false);
            history.push({
              step,
              tool: 'continue_next',
              summary: '检测到未完成全部题目，自动继续作答下一题',
              result: '已拦截提前结束，继续推进',
              changed: false
            });
            prefetchedSnap = null;
            await nativeSleep(80, signal);
            continue;
          }

          const doneMsg = plan.reply || plan.args?.message || plan.summary || '全部任务步骤已顺利完成';
          recordPaChatTurn('assistant', doneMsg);
          updateStepResult(pendingStepEl, '已完成', false);
          updateThoughtOutcome(currentThoughtEl, '✓ 任务已完成', true, false);
          appendNativeConsoleLog(`AI 任务完成: ${doneMsg}`);
          finalStatus = 'done';
          finalSummaryTitle = `已完成 ${step} 步手机操控${snapshot.appName ? ` · ${snapshot.appName}` : ''}`;
          finalReplyText = doneMsg;
          break;
        }

        if (toolName === 'ask_user') {
          const askMsg = plan.reply || plan.args?.message || plan.summary || '请确认或补充接下来的操作说明';
          const askOpts = Array.isArray(plan.args?.options) ? plan.args.options : [];
          updateStepResult(pendingStepEl, '等待确认', false);

          const askResult = await askUserClarifyPrompt({
            cardCtx,
            title: '需要你确认或补充',
            thought: plan.thought,
            question: askMsg,
            options: askOpts,
            signal,
            snapshot
          });

          if (askResult.mode === 'reply' && askResult.text) {
            const replyClean = askResult.text.trim();
            if (/先停止本次任务|停止任务|取消/.test(replyClean)) {
              updateStepResult(pendingStepEl, '已停止', false);
              finalStatus = 'done';
              finalSummaryTitle = '已按你的要求停止任务';
              finalReplyText = '已停止当前任务，随时告诉我下一步安排~';
              break;
            }
            appendUserMessageRow(replyClean);
            recordPaChatTurn('user', replyClean);
            loopState.noChangeStreak = 0;
            loopState.errorStreak = 0;
            loopState.waitStreak = 0;
            loopState.recoveryAttempts = 0;
            loopState.lastStuckReason = '';
            loopState.recentPageSigs = [];
            loopState.pageStepCounts.delete(currentPageKey);

            if (/帮我跳过这步换个方法/.test(replyClean)) {
              autoContinueHint = '【用户现场指示】跳过刚才卡住的目标与方式，严格避开当前页面禁用动作列表，更换其他入口、滚动查找或搜索框继续完成任务！';
            } else if (/返回上一页/.test(replyClean)) {
              if (native && b && typeof b.dispatchGlobalAction === 'function') {
                try { b.dispatchGlobalAction('back'); } catch {}
                await nativeSleep(260, signal);
              }
              autoContinueHint = '【用户现场指示】已返回上一页，请换一条全新路径重新查找目标。';
            } else if (/我已手动操作/.test(replyClean)) {
              loopState.failedActionMap.delete(currentPageKey);
              loopState.failedActionLabels.delete(currentPageKey);
              autoContinueHint = '【用户已手动处理】请直接基于最新屏幕状态继续下一步。';
            } else {
              loopState.failedActionMap.delete(currentPageKey);
              loopState.failedActionLabels.delete(currentPageKey);
              autoContinueHint = `【用户现场指示（最高优先级执行）】：${replyClean}`;
            }

            updateStepResult(pendingStepEl, `已确认：${replyClean.slice(0, 14)}`, false);
            history.push({
              step,
              tool: 'ask_user',
              argsSummary: '',
              summary: askMsg,
              result: `用户回复确认：${replyClean}`,
              changed: true,
              page: snapshot.appName || snapshot.packageName || ''
            });
            prefetchedSnap = null;
            await nativeSleep(80, signal);
            continue;
          }

          if (askResult.mode === 'back_to_chat') {
            recordPaChatTurn('assistant', askMsg);
            pendingAskContext = {
              originalTask: taskText,
              askMessage: askMsg,
              history: [...history, { step, tool: 'ask_user', summary: askMsg, result: '等待用户在聊天框回复确认' }],
              recordedSteps,
              startStep: step + 1,
              execMode,
              roundAutoApproved,
              lastExternalApp: lastExtApp
            };
            updateComposerAskHint(true);
            if (native && b && typeof b.bringSelfToFront === 'function') {
              try { b.bringSelfToFront('有需要确认的问题，已为你切回星语聊天界面'); } catch {}
            }
            finalStatus = 'done';
            finalSummaryTitle = '等待你的确认答复';
            finalReplyText = `${askMsg}\n（你可以直接在下方输入框回复我，我将自动继续执行）`;
            handoverCb = () =>
              runReActLoop(taskText, cardCtx, execMode, {
                history: [...history, { step, tool: 'ask_user', summary: askMsg, result: '用户已手动处理' }],
                recordedSteps,
                startStep: step + 1,
                roundAutoApproved,
                lastScreenVerdict: null,
                returnToExternalFirst: true,
                lastExternalApp: lastExtApp
              });
            break;
          }

          finalStatus = 'error';
          finalSummaryTitle = '用户已取消确认';
          finalReplyText = '已取消本次待确认操作。';
          break;
        }

        const rawActionQueue = Array.isArray(plan.actions) && plan.actions.length >= 2
          ? plan.actions
          : [{ tool: toolName, args: plan.args || plan.params || {}, risk: plan.risk, summary: plan.summary, needConfirm: plan.needConfirm }];
        const actionQueue = (loopState.noChangeStreak >= 1 || loopState.errorStreak >= 1 || oscDetected)
          ? rawActionQueue.slice(0, 1)
          : rawActionQueue;

        let abortedByUser = false;
        let handedOver = false;
        let gateRejected = false;
        for (const subAction of actionQueue) {
          const gateInfo = evaluateSafetyGate(subAction, snapshot, roundAutoApproved);
          if (gateInfo.needConfirm) {
            updateStepResult(pendingStepEl, '待确认', false);
            const decision = await askStepConfirmCard(cardCtx.confirmSlot, subAction, signal, gateInfo, snapshot);
            if (decision === 'cancel') {
              updateStepResult(pendingStepEl, '已拒绝', true);
              finalStatus = 'error';
              finalSummaryTitle = '用户已取消该操作';
              gateRejected = true;
              break;
            }
            if (decision === 'handover') {
              updateStepResult(pendingStepEl, '交还人工', false);
              finalStatus = 'done';
              finalSummaryTitle = '已交还给你手动操作';
              finalReplyText = '请直接在手机屏幕完成敏感操作，完成后点击下方按钮即可让 AI 接力继续。';
              handoverCb = () =>
                runReActLoop(taskText, cardCtx, execMode, {
                  history: [...history, { step, tool: 'handover', summary: subAction.summary || plan.summary, result: '用户已手动接管完成' }],
                  startStep: step + 1,
                  roundAutoApproved,
                  lastScreenVerdict: null
                });
              handedOver = true;
              break;
            }
            if (decision === 'auto_turn' || decision === 'auto') {
              roundAutoApproved = true;
            } else if (decision === 'trust_app') {
              addTrustedApp(snapshot.appName, snapshot.packageName);
            }
          }
        }
        if (gateRejected || handedOver) break;

        syncNativeFloatProgress({
          state: 'acting',
          phase: 'planned',
          step,
          appName: snapshot.appName || '当前界面',
          toolName,
          summary: plan.summary || inferToolActionLabel(toolName),
          thought: plan.thought || plan.reasoning || '',
          verdictText: lastHudVerdictText
        });

        const preActionSeq = native ? (Number(readScreenEventSeq().seq) || beforeEventSeq) : 0;
        const beforeMeta = native
          ? {
              ok: true,
              packageName: snapshot.packageName || '',
              appName: snapshot.appName || '',
              signature: snapshot.signature || '',
              eventSeq: preActionSeq
            }
          : null;

        let execRes = { executed: false, text: '' };
        const forceGestureClick = noChangeStreak >= 1;
        const execTexts = [];
        for (let ai = 0; ai < actionQueue.length; ai++) {
          if (signal.aborted || emergencyStopRequested || (native && b && typeof b.isEmergencyStopRequested === 'function' && b.isEmergencyStopRequested())) {
            abortedByUser = true;
            break;
          }
          const subAct = actionQueue[ai];
          if (ai > 0 && native) {
            const livePkg = readTopPackageFast();
            if (livePkg && snapshot.packageName && livePkg !== snapshot.packageName) {
              execTexts.push('页面已切换，提前结束本批微动作');
              break;
            }
          }
          execRes = dispatchNativePlanAction(subAct, snapshot, { forceGesture: forceGestureClick, taskText: activeTaskText });
          execTexts.push(execRes.text);
          if (!execRes.error) {
            const cap = captureRecordableStep(subAct, snapshot, execRes, screenSize);
            if (cap) recordedSteps.push(cap);
          }
          if (execRes.error || !native) break;
          if (ai < actionQueue.length - 1) {
            await nativeSleep(subAct.tool === 'phone_tap' ? 85 : 100, signal);
          }
        }
        if (abortedByUser) {
          updateStepResult(pendingStepEl, '已停止', true);
          finalStatus = 'error';
          finalSummaryTitle = '已停止执行';
          break;
        }

        const lastSubTool = actionQueue[actionQueue.length - 1]?.tool || toolName;
        let verdict = native
          ? await waitForScreenVerdict(
              beforeMeta,
              lastSubTool,
              signal,
              actionQueue.length === 1 && execRes.method === 'node' && (lastSubTool === 'phone_tap' || lastSubTool === 'click_node') ? 260 : 0
            )
          : { changed: true, elapsedMs: 0 };

        // 零往返自动物理补点：如果 node ACTION_CLICK 报成功但 260ms 内画面无反应，自动以真实坐标手势补点一次
        if (
          native &&
          actionQueue.length === 1 &&
          !execRes.error &&
          execRes.method === 'node' &&
          verdict &&
          !verdict.changed &&
          execRes.x > 0 &&
          execRes.y > 0 &&
          typeof b?.dispatchClick === 'function'
        ) {
          const fallbackTapped = b.dispatchClick(execRes.x, execRes.y);
          if (fallbackTapped) {
            execTexts[0] = `${execRes.text}（已物理补点）`;
            verdict = await waitForScreenVerdict(beforeMeta, lastSubTool, signal, 320);
          }
        }

        // 将原生事件等待器顺带采集的最新快照直接缓存供下一步复用，省去重复 Binder 全树扫描
        const nextCachedSnap = verdict?.prefetchedSnapshot && verdict.prefetchedSnapshot.packageName
          ? verdict.prefetchedSnapshot
          : null;
        if (verdict && 'prefetchedSnapshot' in verdict) {
          delete verdict.prefetchedSnapshot;
        }
        prefetchedSnap = nextCachedSnap;

        const finalExecText = execTexts.join(' -> ') || execRes.text;
        const stepFp = getActionFingerprint(plan, snapshot);
        loopState.recentActionFingerprints.push(stepFp);
        if (loopState.recentActionFingerprints.length > 8) {
          loopState.recentActionFingerprints = loopState.recentActionFingerprints.slice(-8);
        }

        if (lastSubTool === 'phone_wait' || lastSubTool === 'wait') {
          loopState.waitStreak += 1;
        } else {
          loopState.waitStreak = 0;
        }

        if (execRes.error) {
          loopState.errorStreak += 1;
        } else {
          loopState.errorStreak = 0;
        }

        if ((verdict && !verdict.changed && lastSubTool !== 'phone_wait') || execRes.error) {
          noChangeStreak += 1;
          loopState.noChangeStreak += 1;
          if (native && stepFp) {
            if (!loopState.failedActionMap.has(currentPageKey)) {
              loopState.failedActionMap.set(currentPageKey, new Set());
            }
            loopState.failedActionMap.get(currentPageKey).add(stepFp);
            const labelList = loopState.failedActionLabels.get(currentPageKey) || [];
            const labelDesc = `${toolName}(${summarizePlanArgs(plan)})`;
            if (!labelList.includes(labelDesc)) {
              labelList.push(labelDesc);
              loopState.failedActionLabels.set(currentPageKey, labelList.slice(-10));
            }
          }
        } else {
          noChangeStreak = 0;
          loopState.noChangeStreak = 0;
          loopState.errorStreak = 0;
          if (verdict && verdict.changed && !oscDetected) {
            loopState.recoveryAttempts = 0;
            loopState.lastStuckReason = '';
            earlyDoneIntercepts = 0;
          }
        }
        lastScreenVerdict = {
          ...verdict,
          noChangeStreak: loopState.noChangeStreak
        };

        const stepChanged = native && !execRes.error && lastSubTool !== 'phone_wait' ? Boolean(verdict.changed) : null;
        updateStepResult(
          pendingStepEl,
          finalExecText,
          Boolean(execRes.error),
          stepChanged
        );
        const hudOutcomeMsg = execRes.error
          ? `✕ ${String(finalExecText || '执行失败').slice(0, 36)}`
          : (stepChanged === true
              ? `✓ 画面已更新${verdict?.elapsedMs ? ` (${verdict.elapsedMs}ms)` : ''}`
              : (lastSubTool === 'phone_wait' ? `⏱ ${finalExecText}` : '• 画面未变，继续观察'));
        updateThoughtOutcome(currentThoughtEl, hudOutcomeMsg, stepChanged === true, Boolean(execRes.error));
        updateThinkingPhase(cardCtx, 'verify');
        lastHudVerdictText = hudOutcomeMsg;
        syncNativeFloatProgress({
          state: 'acting',
          phase: 'verified',
          step,
          appName: snapshot.appName || '当前界面',
          toolName: lastSubTool || toolName,
          summary: plan.summary || inferToolActionLabel(toolName),
          thought: plan.thought || '',
          verdictText: lastHudVerdictText
        });
        appendNativeConsoleLog(`第${step}步 [${toolName}]: ${finalExecText}`);

        history.push({
          step,
          tool: toolName,
          argsSummary: summarizePlanArgs(plan),
          summary: plan.summary,
          result: finalExecText,
          changed: Boolean(verdict?.changed),
          page: snapshot.appName || snapshot.packageName || ''
        });

        if (!native) {
          finalStatus = 'done';
          finalSummaryTitle = '网页端规划演示完成';
          finalReplyText = `已在网页预览完成动作推演：${plan.summary}。安装 Android 随身版 APK 并开启无障碍后，将在真机自动连续执行。`;
          break;
        }

        if (step === MAX_STEPS) {
          finalStatus = 'done';
          finalSummaryTitle = `已连续执行 ${MAX_STEPS} 步`;
          finalReplyText = `已连续执行 ${MAX_STEPS} 步，点击下方按钮可继续执行下一批步骤。`;
          handoverCb = () =>
            runReActLoop(taskText, cardCtx, execMode, {
              history,
              startStep: step + 1,
              roundAutoApproved,
              lastScreenVerdict
            });
        }
      }

      finalizeAgentTurn(cardCtx, {
        status: finalStatus,
        summaryTitle: finalSummaryTitle || `已完成 ${cardCtx.stepCount || 0} 步控屏`,
        replyText: finalReplyText,
        handoverCb,
        recordedSteps,
        sourceTask: taskText,
        isChatOnly: isChatOnlyTurn
      });
      if (native && finalStatus === 'done' && !isChatOnlyTurn && (cardCtx.stepCount || 0) > 0 && !handoverCb) {
        sentDoneHudNotice = true;
        syncNativeFloatProgress({
          state: 'idle',
          phase: 'done',
          step: cardCtx.stepCount || 0,
          appName: lastExtApp || '',
          toolName: 'done',
          summary: finalSummaryTitle || `已完成 ${cardCtx.stepCount || 0} 步控屏`,
          thought: (finalReplyText || '').slice(0, 120)
        });
      }
    } finally {
      isAgentRunning = false;
      queuedInterjections = [];
      updateQueueBarUi();
      if (native && b && !isNativeAutoSwiping()) {
        try {
          if (!sentDoneHudNotice && typeof b.updateFloatState === 'function') b.updateFloatState('idle', 'dsh-Go');
          if (typeof b.setAgentForegroundActive === 'function') b.setAgentForegroundActive(false, '');
        } catch {}
      }
      syncStatus();
    }
  }

  async function executeTaskInChat(taskText) {
    const clean = String(taskText || '').trim();
    if (!clean) return;

    const shell = document.getElementById('app-shell');
    if (shell && shell.dataset.uiMode !== 'phone-agent') {
      document.getElementById('ws-mode-phone-agent')?.click();
    }

    const skillIdMatch = clean.match(/^skill:([a-zA-Z0-9_-]+)$/i);
    if (skillIdMatch) {
      await executeLearnedSkillOffline(skillIdMatch[1]);
      return;
    }

    // 如果有待用户确认的追问上下文，优先消费该答复并无缝续跑
    if (pendingAskContext && !isAgentRunning) {
      const ctx = pendingAskContext;
      pendingAskContext = null;
      updateComposerAskHint(false);
      appendUserMessageRow(clean);
      recordPaChatTurn('user', clean);

      if (/^(?:取消|算了|不用了|不用|停止|不做了)[！!。.]*$/.test(clean)) {
        const cancelCard = createAgentCardRow('取消任务', ctx.execMode || getExecMode());
        if (cancelCard) {
          finalizeAgentTurn(cancelCard, {
            status: 'done',
            replyText: '好的，已取消刚才的操作，随时告诉我新的需求~',
            isChatOnly: true
          });
        }
        return;
      }

      const resumeCard = createAgentCardRow(ctx.originalTask, ctx.execMode || getExecMode());
      if (!resumeCard) return;
      await runReActLoop(ctx.originalTask, resumeCard, ctx.execMode || getExecMode(), {
        history: [...(ctx.history || []), { step: ctx.startStep - 1, tool: 'user_reply', summary: '用户补充确认', result: clean }],
        recordedSteps: ctx.recordedSteps || [],
        startStep: ctx.startStep || 1,
        roundAutoApproved: ctx.roundAutoApproved,
        lastScreenVerdict: null,
        initialInterjections: [`【用户回复确认】${clean}`],
        returnToExternalFirst: true,
        lastExternalApp: ctx.lastExternalApp
      });
      return;
    }

    // 运行中收到新指令 -> 自动进入排队插话模式
    if (isAgentRunning) {
      queuedInterjections.push({ text: clean, priority: false });
      updateQueueBarUi();
      appendUserMessageRow(clean, true);
      showToast('当前任务执行中，已加入插话队列（点「立即插话」优先注入）');
      return;
    }

    const mode = getExecMode();
    recordTaskHistory(clean, mode);
    recordPaChatTurn('user', clean);
    appendUserMessageRow(clean);

    // 真机 APK 且非纯本地规则时，若无障碍未开启，内联弹出 dsh-go 引导卡
    if (isNativeApk() && mode !== 'local' && !getBridge()?.isAccessibilityEnabled?.()) {
      renderA11yGuideCard(clean);
      return;
    }

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
    if (!getBridge()?.isAccessibilityEnabled?.()) {
      renderA11yGuideCard('读取当前屏幕内容');
      return;
    }
    const cardCtx = createAgentCardRow('读取当前屏幕界面无障碍节点', getExecMode());
    if (!cardCtx) return;
    const snap = readAndFormatSnapshot(false);
    const sz = getScreenSizeObj();
    const sample = snap.nodes
      .filter((n) => n.text || n.desc)
      .slice(0, 12)
      .map((n) => n.text || n.desc)
      .join(' / ');
    cardCtx.stepCount = 1;
    addStepItem(
      cardCtx.stepsList,
      1,
      `已捕获 ${snap.nodes.length} 个界面元素（${sz.width}×${sz.height}）`,
      sample ? `可见关键元素：${sample}` : '当前窗口主要为图标或自绘视图',
      '已就绪',
      false,
      'phone.screen'
    );
    finalizeAgentTurn(cardCtx, {
      status: 'done',
      summaryTitle: `已读取 ${snap.appName || '当前屏幕'}（${snap.nodes.length} 个元素）`,
      replyText: sample ? `当前屏幕可见关键内容：${sample}` : '当前屏幕未检测到文字节点，可能为纯图像或自绘界面。'
    });
  }

  // 接收来自原生悬浮窗「交给星语 AI 规划」传回的任务
  window.__receiveFloatAgentTask = (taskText) => {
    const clean = String(taskText || '').trim();
    const shell = document.getElementById('app-shell');
    if (shell && shell.dataset.uiMode !== 'phone-agent') {
      document.getElementById('ws-mode-phone-agent')?.click();
    }
    if (!clean) {
      showToast('已回到 dsh-Go 手机控屏工作台');
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

  function renderUpdateDialogResult(info, localInfo, opts = {}) {
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

    const shouldOpen = opts?.openDialog !== false;
    if (shouldOpen && dlg && !dlg.open) {
      try { dlg.showModal(); } catch {}
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

    // 3. 配置保存应用与测试连接（DeepSeek 官方直连免填地址 + 云端 API 自定义密钥与地址拉取模型）
    $('pa-open-ds-official-btn')?.addEventListener('click', openDeepSeekOfficialPage);

    async function runConnectionTest({ btn, apiKey, baseUrl, model, okLabel, missingKeyMsg, focusEl, allowManagedCloudFallback = false }) {
      const cleanK = cleanApiKey(apiKey);
      if (!cleanK && !allowManagedCloudFallback) {
        showToast(missingKeyMsg || '请先输入 API Key 再测试连接');
        focusEl?.focus();
        return;
      }
      const origTxt = btn ? btn.textContent : '测试连接';
      if (btn) { btn.disabled = true; btn.textContent = '测试中…'; }
      try {
        let ok = false;
        let errTxt = '';
        if (cleanK) {
          try {
            const directRes = await fetch(baseUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cleanK}` },
              body: JSON.stringify({ model, messages: [{ role: 'user', content: 'hi' }], max_tokens: 8 })
            });
            if (directRes.ok) ok = true;
            else errTxt = `HTTP ${directRes.status}`;
          } catch (e) {
            errTxt = e?.message || '直连跨域或网络异常';
          }
        }
        if (!ok) {
          const proxyBody = cleanK
            ? {
                task: '测试连接：请回复 {"thought":"ok","tool":"chat","args":{"message":"ok"},"summary":"测试","risk":"read","reply":"ok"}',
                customApiKey: cleanK,
                customModel: model,
                customBaseUrl: baseUrl
              }
            : {
                task: '测试连接：请回复 {"thought":"ok","tool":"chat","args":{"message":"ok"},"summary":"测试","risk":"read","reply":"ok"}',
                customModel: model || ''
              };
          let pRes = await apiPostJson('/api/phone-agent/plan', proxyBody).catch(() => ({ ok: false, data: {} }));
          if (!pRes.ok && cleanK) {
            const cRes = await fetch(`${PUBLIC_WEB_ORIGIN}/api/phone-agent/plan`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(proxyBody)
            }).catch(() => null);
            if (cRes) {
              const cd = await cRes.json().catch(() => ({}));
              pRes = { ok: cRes.ok && cd?.ok !== false, data: cd };
            }
          }
          if (pRes.ok && pRes.data?.plan) {
            ok = true;
          } else if (pRes.data?.error) {
            errTxt = pRes.data.error;
          }
        }
        if (ok) {
          showToast(okLabel || `✅ 连接成功！模型 ${model || '云端默认'} 可正常驱动手机辅助`);
        } else {
          showToast(`❌ 连接失败：${errTxt || '请检查密钥、接口地址与模型名'}`);
        }
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = origTxt; }
      }
    }

    $('pa-cfg-test-btn')?.addEventListener('click', () => {
      const apiKey = cleanApiKey($('pa-cfg-apikey')?.value || '');
      const model = ($('pa-cfg-model')?.value || 'deepseek-v4.1-flash').trim() || 'deepseek-v4.1-flash';
      runConnectionTest({
        btn: $('pa-cfg-test-btn'),
        apiKey,
        baseUrl: DEEPSEEK_OFFICIAL_CHAT_URL,
        model: resolveDirectModelForUrl(model, DEEPSEEK_OFFICIAL_CHAT_URL),
        missingKeyMsg: '请先输入 DeepSeek API Key 再测试连接',
        focusEl: $('pa-cfg-apikey'),
        okLabel: `✅ DeepSeek 官方连接成功！模型 ${model} 已就绪`
      });
    });

    $('pa-cloud-test-btn')?.addEventListener('click', () => {
      const cloudCfg = getCloudConfig();
      const apiKey = cleanApiKey($('pa-cloud-apikey')?.value || cloudCfg.apiKey);
      const rawUrl = ($('pa-cloud-baseurl')?.value || cloudCfg.baseUrl).trim();
      const baseUrl = normalizeChatCompletionsUrl(rawUrl || 'https://api.siliconflow.cn/v1/chat/completions');
      const selEl = $('pa-cloud-model-select');
      const firstOptModel = Array.from(selEl?.options || []).find((o) => String(o.value || '').trim())?.value || '';
      const model = ($('pa-cloud-model-select')?.value || cloudCfg.model || firstOptModel).trim();
      if (apiKey && !rawUrl) {
        showToast('请先填写云端接口地址 (Base URL)');
        $('pa-cloud-baseurl')?.focus();
        return;
      }
      if (apiKey && !model) {
        showToast('请先点击「拉取模型」并选择一个可调用模型');
        return;
      }
      runConnectionTest({
        btn: $('pa-cloud-test-btn'),
        apiKey,
        baseUrl,
        model,
        allowManagedCloudFallback: !apiKey,
        focusEl: $('pa-cloud-apikey'),
        okLabel: `✅ 云端 API 连接成功！${model ? `模型 ${model}` : '智能默认渠道'}已就绪`
      });
    });

    $('pa-cloud-model-select')?.addEventListener('change', (e) => {
      const m = setCloudModel(e.target.value || '');
      showToast(m ? `云端 API 已切换模型：${m}` : '云端 API 已切换为智能默认模型');
      syncStatus();
    });

    let paCloudModelsFetched = false;
    let lastCloudModelsSig = '';
    async function fetchPhoneAgentCloudModels(force = false) {
      const sel = $('pa-cloud-model-select');
      const statusEl = $('pa-cloud-models-status');
      const btn = $('pa-cloud-fetch-models-btn');
      if (!sel) return;

      const cloudCfg = getCloudConfig();
      const domUrl = ($('pa-cloud-baseurl')?.value ?? cloudCfg.baseUrl ?? '').trim();
      const domKey = cleanApiKey($('pa-cloud-apikey')?.value ?? cloudCfg.apiKey ?? '');
      const normalizedUrl = domUrl ? normalizeChatCompletionsUrl(domUrl) : '';
      const sig = `${normalizedUrl}|${domKey}`;
      if (!force && paCloudModelsFetched && sig === lastCloudModelsSig) return;
      if (domUrl && !domKey && force) {
        showToast('请先填入对应的云端 API Key，再点击拉取可用模型');
        $('pa-cloud-apikey')?.focus();
        return;
      }

      if (statusEl) statusEl.textContent = '（拉取中…）';
      if (btn) btn.disabled = true;
      try {
        const reqPayload = domKey
          ? {
              apiKey: domKey,
              baseUrl: normalizedUrl || 'https://api.siliconflow.cn/v1/chat/completions'
            }
          : {};

        let res = await apiPostJson('/api/cloud/models', reqPayload).catch(() => ({ ok: false, data: {} }));
        if ((!res.ok || !Array.isArray(res.data?.models) || !res.data.models.length) && (isNativeApk() || domKey)) {
          const r2 = await fetch(`${PUBLIC_WEB_ORIGIN}/api/cloud/models`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(reqPayload)
          }).catch(() => null);
          if (r2 && r2.ok) {
            const d2 = await r2.json().catch(() => ({}));
            if (d2?.ok && Array.isArray(d2.models)) res = { ok: true, data: d2 };
            else if (d2?.error && !res.data?.error) res = { ok: false, data: d2 };
          }
        }
        // 第三重：若填了自定义地址与 Key 且服务端代理无法直达，尝一试浏览器直连 /models
        if ((!res.ok || !Array.isArray(res.data?.models) || !res.data.models.length) && domKey) {
          const targetChat = normalizedUrl || 'https://api.siliconflow.cn/v1/chat/completions';
          const directModelsUrl = targetChat.replace(/\/chat\/completions$/i, '') + '/models';
          try {
            const r3 = await fetch(directModelsUrl, {
              method: 'GET',
              headers: { Accept: 'application/json', Authorization: `Bearer ${domKey}` }
            });
            if (r3.ok) {
              const d3 = await r3.json().catch(() => ({}));
              const list3 = Array.isArray(d3?.data) ? d3.data : (Array.isArray(d3?.models) ? d3.models : []);
              const parsed3 = list3
                .map((x) => (typeof x === 'string' ? x : (x?.id || x?.name || '')).trim())
                .filter(Boolean);
              if (parsed3.length > 0) {
                res = { ok: true, data: { ok: true, models: parsed3 } };
              }
            }
          } catch {}
        }

        const models = Array.isArray(res.data?.models) ? res.data.models : [];
        if (models.length > 0) {
          paCloudModelsFetched = true;
          lastCloudModelsSig = sig;
          const prev = getCloudModel();
          sel.innerHTML = '';
          const defaultOpt = document.createElement('option');
          defaultOpt.value = '';
          defaultOpt.textContent = domKey ? '请选择模型（或自动选首项）' : '云端智能默认（自动拉取适配）';
          sel.appendChild(defaultOpt);
          for (const m of models) {
            const opt = document.createElement('option');
            opt.value = m;
            opt.textContent = m;
            sel.appendChild(opt);
          }
          if (prev && models.includes(prev)) {
            sel.value = prev;
          } else if (domKey) {
            sel.value = models[0];
            setCloudModel(models[0]);
          } else {
            sel.value = '';
            setCloudModel('');
          }
          if (statusEl) statusEl.textContent = `（已拉取 ${models.length} 个可用模型）`;
          if (force) showToast(`✅ 已成功拉取 ${models.length} 个可用云端模型`);
        } else if (res.data?.error && domKey) {
          if (statusEl) statusEl.textContent = `（拉取失败：${String(res.data.error).slice(0, 24)}）`;
          if (force) showToast(`拉取模型失败：${res.data.error}`);
        } else if (statusEl) {
          statusEl.textContent = domKey ? '（请检查地址/Key 后点拉取）' : '（填完地址与 Key 自动拉取）';
        }
      } catch {
        if (statusEl) statusEl.textContent = '（填完地址与 Key 自动拉取）';
      } finally {
        if (btn) btn.disabled = false;
      }
    }
    triggerCloudModelsRefresh = fetchPhoneAgentCloudModels;
    $('pa-cloud-fetch-models-btn')?.addEventListener('click', () => fetchPhoneAgentCloudModels(true));
    $('pa-mode-api-cloud')?.addEventListener('click', () => setTimeout(() => fetchPhoneAgentCloudModels(false), 120));

    let paCloudDebounceTimer = null;
    const scheduleAutoFetchCloudModels = () => {
      clearTimeout(paCloudDebounceTimer);
      paCloudDebounceTimer = setTimeout(() => {
        const u = ($('pa-cloud-baseurl')?.value || '').trim();
        const k = cleanApiKey($('pa-cloud-apikey')?.value || '');
        if (u && k) {
          fetchPhoneAgentCloudModels(true);
        }
      }, 650);
    };
    $('pa-cloud-baseurl')?.addEventListener('blur', () => {
      const u = ($('pa-cloud-baseurl')?.value || '').trim();
      const k = cleanApiKey($('pa-cloud-apikey')?.value || '');
      if (u && k) fetchPhoneAgentCloudModels(true);
    });
    $('pa-cloud-apikey')?.addEventListener('blur', () => {
      const u = ($('pa-cloud-baseurl')?.value || '').trim();
      const k = cleanApiKey($('pa-cloud-apikey')?.value || '');
      if (u && k) fetchPhoneAgentCloudModels(true);
    });
    $('pa-cloud-baseurl')?.addEventListener('input', scheduleAutoFetchCloudModels);
    $('pa-cloud-apikey')?.addEventListener('input', scheduleAutoFetchCloudModels);

    document.querySelectorAll('#pa-cloud-preset-bar .api-preset-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        const u = String(chip.dataset.paCloudUrl || '').trim();
        const urlInp = $('pa-cloud-baseurl');
        if (urlInp && u) urlInp.value = u;
        document.querySelectorAll('#pa-cloud-preset-bar .api-preset-chip').forEach((c) => {
          c.classList.toggle('active', c === chip);
        });
        const k = cleanApiKey($('pa-cloud-apikey')?.value || '');
        if (k) {
          fetchPhoneAgentCloudModels(true);
        } else {
          $('pa-cloud-apikey')?.focus();
          showToast(`已填入「${chip.textContent.trim()}」接口地址，请填写 API Key 自动拉取模型`);
        }
      });
    });

    $('pa-cloud-save-btn')?.addEventListener('click', () => {
      const apiKey = cleanApiKey($('pa-cloud-apikey')?.value || '');
      const baseUrl = ($('pa-cloud-baseurl')?.value || '').trim();
      const model = ($('pa-cloud-model-select')?.value || '').trim();
      const autoApprove = Boolean($('pa-cloud-auto-approve')?.checked);

      if (apiKey && !baseUrl) {
        showToast('请填写云端 API 接口地址 (Base URL)');
        $('pa-cloud-baseurl')?.focus();
        return;
      }

      setCloudConfig({
        apiKey,
        baseUrl: baseUrl ? normalizeChatCompletionsUrl(baseUrl) : '',
        model,
        autoApprove
      });
      closeControlSheet();
      syncStatus();
      showToast('云端 API 接口与模型配置已保存并应用');
    });

    $('pa-cfg-save-btn')?.addEventListener('click', () => {
      const apiKey = cleanApiKey($('pa-cfg-apikey')?.value || '');
      const model = ($('pa-cfg-model')?.value || 'deepseek-v4.1-flash').trim() || 'deepseek-v4.1-flash';
      const autoApprove = Boolean($('pa-cfg-auto-approve')?.checked);

      setDirectApiKey(apiKey);
      try {
        localStorage.setItem(STORAGE_KEYS.directModel, model);
        localStorage.setItem(STORAGE_KEYS.directModelMigratedV41, '1');
        localStorage.setItem(STORAGE_KEYS.autoApprove, autoApprove ? '1' : '0');
      } catch {}

      closeControlSheet();
      syncStatus();
      showToast('DeepSeek 官方直连参数与确认策略已保存');
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
    $('pa-empty-setup-guide-btn')?.addEventListener('click', () => openSetupGuideWizard(1));
    $('pa-open-setup-guide-btn')?.addEventListener('click', () => {
      closeControlSheet();
      openSetupGuideWizard(1);
    });

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
      const order = ['ask_every', 'sensitive_only', 'auto_turn'];
      const cur = getConfirmPolicy();
      const next = order[(order.indexOf(cur) + 1) % order.length];
      setConfirmPolicy(next);
      showToast(`已切换为「${getPolicyLabel(next)}」`);
    });

    $('pa-banner-policy-pill')?.addEventListener('click', () => openControlSheet(false));

    document.querySelectorAll('.pa-policy-card:not(.pa-clarify-card)').forEach((card) => {
      card.addEventListener('click', () => {
        const p = card.dataset.paPolicy || 'sensitive_only';
        setConfirmPolicy(p);
        showToast(`安全策略已切换：${getPolicyLabel(p)}`);
      });
    });

    document.querySelectorAll('.pa-clarify-card').forEach((card) => {
      card.addEventListener('click', () => {
        const cp = card.dataset.paClarify || 'smart';
        setClarifyPolicy(cp);
        showToast(`任务前需求确认已切换为：${getClarifyPolicyLabel(cp)}`);
      });
    });

    $('pa-cfg-edge-glow')?.addEventListener('change', (e) => {
      setEdgeGlowPref(Boolean(e.target.checked));
    });

    document.querySelectorAll('.pa-pet-card').forEach((card) => {
      card.addEventListener('click', () => {
        const petId = card.dataset?.paPet || 'feiyu';
        setPetPersona(petId, { syncNative: true, notify: true });
      });
    });

    $('pa-queue-now-btn')?.addEventListener('click', () => {
      if (queuedInterjections.length > 0) {
        queuedInterjections[queuedInterjections.length - 1].priority = true;
        showToast('已标记优先注入，将在本步完成后立即响应');
      }
    });

    $('pa-queue-cancel-btn')?.addEventListener('click', () => {
      queuedInterjections = [];
      updateQueueBarUi();
      showToast('已取消排队插话');
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
      let paVoiceTimer = null;
      let paVoiceSec = 0;

      const cleanupPaAudioStream = () => {
        if (paVoiceTimer) {
          clearInterval(paVoiceTimer);
          paVoiceTimer = null;
        }
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
        if (span) span.textContent = recording ? '⏹ 00s·点我完成' : '🎙 语音';
        paVoiceBtn.title = recording ? '正在倾听…点击完成语音输入' : '语音输入口令（支持放歌/切歌/控屏/鲸鱼娘互动）';
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
          paVoiceSec = 0;
          if (paVoiceTimer) clearInterval(paVoiceTimer);
          paVoiceTimer = setInterval(() => {
            if (!isPaVoiceRecording) {
              clearInterval(paVoiceTimer);
              paVoiceTimer = null;
              return;
            }
            paVoiceSec += 1;
            const sp = paVoiceBtn.querySelector('span');
            if (sp) sp.textContent = `⏹ ${String(paVoiceSec).padStart(2, '0')}s·完成`;
            if (paVoiceSec === 5 && !paSpeechFinalText && !paSpeechInterimText) {
              showToast('💡 可试说：“用QQ音乐放晴天”、“下一首”、“喂米饭”、“打开微信”', 2600);
            }
          }, 1000);
          showToast('🎙️ 正在倾听…可试说“用QQ音乐放晴天 / 下一首 / 打开微信”，说完再点一次完成', 3400);
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

    // 7. 切回应用或获得焦点时刷新权限状态，并在间隔 >3 分钟后静默复检版本更新
    let lastStartupUpdateCheckAt = Date.now();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        setTimeout(syncStatus, 250);
        if (Date.now() - lastStartupUpdateCheckAt > 180000) {
          lastStartupUpdateCheckAt = Date.now();
          setTimeout(checkUpdateOnStartup, 600);
        }
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
    syncPetPersonaFromNative();
    syncStatus();
    syncLearnedSkillsToNative(loadLearnedSkills());
    if (document.getElementById('app-shell')?.dataset.uiMode === 'phone-agent') {
      renderWorkspace();
    } else {
      maybeAutoShowSetupGuide();
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
    setUpdateRedDot(true);

    const diffGenerations = (remoteCode > 0 && localInfo.versionCode > 0)
      ? Math.max(0, remoteCode - localInfo.versionCode)
      : (info.diffGenerations || 0);
    const isForcedUpdate = Boolean(info.forceUpdate || diffGenerations >= 3);

    let ignoredVer = '';
    try { ignoredVer = localStorage.getItem('star_ignore_update_ver') || ''; } catch {}

    if (isForcedUpdate || ignoredVer !== remoteVer) {
      renderUpdateDialogResult(info, localInfo, { openDialog: true });
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
    getCloudConfig,
    setCloudConfig,
    getCloudModel,
    setCloudModel,
    getPetPersona,
    setPetPersona,
    getConfig: () => ({ execMode: getExecMode(), ...getDirectConfig() }),
    setExecMode,
    setDirectApiKey,
    loadLearnedSkills,
    executeLearnedSkillOffline,
    openSaveSkillModal,
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
    openSetupGuideWizard,
    openDeepSeekOfficialPage,
    openModal,
    closeModal,
    __testHooks: {
      isLikelyPureChat,
      safeEvalArithmetic,
      buildLocalSmartChatReply,
      detectOscillation,
      findPopupDismissNode,
      getActionFingerprint,
      shouldSkipPreFlightClarify,
      requestPreFlightCheck,
      summarizePlanArgs,
      runReActLoop,
      openSetupGuideWizard,
      getSetupPermissionsState,
      getPetPersona,
      setPetPersona,
      inferToolActionLabel,
      syncNativeFloatProgress,
      appendThoughtItem,
      updateThoughtOutcome,
      updateThinkingPhase
    }
  };
})();

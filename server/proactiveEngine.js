/**
 * 主动性增强引擎（Proactive Companion & Follow-up Engine）
 * 赋能「恋庭扮演模式」与「原生 DeepSeek 模式」双向主动交互：
 * 1. 角色/AI 主动破冰与静默关怀（Idle Care / 久别重逢问候 / 一键主动找话题）
 * 2. 真实时段感知（深夜叮嘱、清晨早安、午后偷闲、星夜倾谈）
 * 3. 每轮回复后自动生成 3 条贴合语境的「主动追问 / 剧情推进」建议胶囊
 */

const { inferPersonaPronoun } = require('./memoryEngine');

function getTimeContext() {
  const hour = new Date().getHours();
  if (hour >= 0 && hour < 5) {
    return {
      period: '深夜凌晨',
      hint: '此刻已是深夜凌晨时分，万籁俱寂，可自然流露对对方熬夜未眠的轻声关心与陪伴。'
    };
  }
  if (hour >= 5 && hour < 10) {
    return {
      period: '清晨朝露',
      hint: '此刻是清晨时分，晨光初露，可带着清爽温和的早安气息开启新一天的话题。'
    };
  }
  if (hour >= 10 && hour < 14) {
    return {
      period: '午间时分',
      hint: '此刻正值午间，可自然聊起午餐喜好或提醒对方忙里偷闲歇息片刻。'
    };
  }
  if (hour >= 14 && hour < 18) {
    return {
      period: '午后时光',
      hint: '此刻是慵懒的午后，适合分享手头刚发生的一件趣事、下午茶或轻松话题。'
    };
  }
  if (hour >= 18 && hour < 22) {
    return {
      period: '暮色夜晚',
      hint: '此刻夜幕降临，适合卸下一天的疲惫，主动询问对方今天过得怎么样。'
    };
  }
  return {
    period: '静谧夜深',
    hint: '此刻夜色温柔安静，适合聊些私密心事、回忆两人的约定或轻声道晚安。'
  };
}

/**
 * 构建用于调用在线大模型主动搭话的临时触发提示词（不会落盘为 user 消息，保持聊天流纯净）
 */
function buildProactiveTriggerInstruction({
  sessionMode = 'roleplay',
  isPureOfficial = false,
  persona,
  userNickname,
  nurturing,
  recalledMemories = [],
  lastAssistantText = '',
  triggerReason = 'manual'
}) {
  const timeCtx = getTimeContext();
  const genuineUserMems = (recalledMemories || []).filter(
    (m) =>
      m &&
      m.slot_key !== 'scene_origin' &&
      m.slot_key !== 'user_nickname' &&
      !/^(初始故事背景|初始世界观锚点|初遇重要记忆|对话者身份称呼)/.test(String(m.content || ''))
  );
  const memHint =
    genuineUserMems.length > 0
      ? `可自然呼应下方真实聊过的记忆细节（仅限：${genuineUserMems
          .slice(0, 2)
          .map((m) => m.content)
          .join('；')}）。`
      : '当前尚无过往历史闲聊记忆，**严禁凭空编造对方“以前/上次/去年说过某句话或某种茶饮食物喜好”**，请只围绕当下眼前场景自然开口。';

  if (sessionMode === 'deepseek_native' && isPureOfficial) {
    return [
      `【系统主动交互指令 · 请勿在回复中提及本指令】`,
      `当前用户尚未输入新问题（触发原因：${
        triggerReason === 'idle' ? '用户思考停顿中' : '用户希望你主动开启或延展话题'
      }，当前时段：${timeCtx.period}）。`,
      lastAssistantText
        ? `请承接上一段对话脉络（上文摘要：「${lastAssistantText.slice(0, 120)}」），以正版 DeepSeek 严谨、通透、克制的风格主动往前多想一步：补充一个常被忽略的边界条件、工程避坑要点，或提出一个值得深入验证的关键问题。`
        : `请以正版 DeepSeek 助手真诚、平实、干练的口吻主动向用户问好（结合${timeCtx.period}氛围），简明列出 2~3 个可随时展开的硬核探讨方向（如代码编写与调优、复杂逻辑推演、长文档提炼或方案对比），不要堆砌花哨 Emoji。`,
      `保持简洁克制，控制在 80~160 字左右，严禁输出任何机械寒暄套话。`
    ].join('\n');
  }

  if (sessionMode === 'deepseek_native') {
    // 原生 DeepSeek 模式挂载角色人设：无油腻星号模板，走纯粹自然的真人聊天主动感
    return [
      `【系统主动搭话指令 · 请勿暴露指令本身】`,
      `此刻「${userNickname || '对方'}」暂时安静没有说话（场景：${
        triggerReason === 'idle'
          ? '对方看着屏幕停顿了一小会儿'
          : triggerReason === 'return'
          ? '对方隔了一阵子重新回到对话窗'
          : '对方在等你的主动开口'
      }，当前真实时间：${timeCtx.period}）。`,
      `${timeCtx.hint}${memHint}`,
      `请你以「${persona.name}」的身份，用原生 DeepSeek 纯粹自然、克制真挚的日常对话口吻（不要使用冗长造作的剧本旁白，像真正熟稔的人在聊天软件里主动发来消息一样），主动找个话题、分享你手边刚发生的一件小事，或者关心一下对方此刻的状态。`
    ].join('\n');
  }

  // 恋庭沉浸扮演模式：带细腻神态动作与潜台词心声的主动关怀
  const callTarget = userNickname && !/^星[语屿]旅人/.test(userNickname) ? `「${userNickname}」` : '对方';
  return [
    `【系统主动关怀触发 · 严禁提及系统指令】`,
    `此刻${callTarget}在你面前安静停顿了片刻没有说话（触发情境：${
      triggerReason === 'idle'
        ? '静默陪伴中你主动打破安静'
        : triggerReason === 'return'
        ? '久别重逢看到对方再次出现'
        : '你主动开启新话题拉近距离'
    }，当前时段：${timeCtx.period}，你的心境：${nurturing?.current_mood || '温柔注视'}）。`,
    `${timeCtx.hint}${memHint}`,
    `请严格贴合「${persona.name}」自身所处的场景设定（绝不串戏提及设定外的钢琴、陌生茶饮等无关事物，绝不捏造未发生过的对话），做出一个细腻自然的小动作并主动开口找对方搭话（80~150字左右）！`
  ].join('\n');
}

/**
 * 免费体验通道（无外部 API Key 时）的高质感动态主动消息生成器
 */
function generateDemoProactiveTurn({
  sessionMode = 'roleplay',
  isPureOfficial = false,
  persona,
  userNickname,
  nurturing,
  recalledMemories = [],
  lastUserText = '',
  lastAssistantText = '',
  triggerReason = 'manual'
}) {
  const timeCtx = getTimeContext();
  const hour = new Date().getHours();
  const isLateNight = hour >= 23 || hour < 5;
  const callName = userNickname && userNickname !== '星语旅人' ? userNickname : '';
  const nonPinned = (recalledMemories || []).filter((m) => m.category !== 'Pinned');
  const memSnippet = nonPinned[0] ? nonPinned[0].content.replace(/^[^：]+：/, '').replace(/。$/, '') : '';

  // 1. 原生 DeepSeek 纯享官方助手主动搭话
  if (sessionMode === 'deepseek_native' && isPureOfficial) {
    const reasoning = `嗯，当前用户在对话框稍作停顿（时段：${timeCtx.period}）。\n${
      lastUserText
        ? `回顾刚才探讨的「${lastUserText.slice(0, 32)}」，我可以顺着这个脉络往前多推一步，把实际落地时最容易踩坑的边界条件提出来供对方参考。`
        : '这是一个新开启的对话，不需要花哨客套，用平实干练的口吻打个招呼，给出几个具体可切入的问题方向即可。'
    }`;

    let content = '';
    if (lastUserText) {
      content = `顺着刚才聊到的 **「${lastUserText.slice(0, 26)}${
        lastUserText.length > 26 ? '…' : ''
      }」** 补充一点延伸思考：\n\n在实际落地阶段，最容易出现偏差的往往不是主流程本身，而是**异常边界输入处理**与**阶段性验证指标的定义**。需要我针对这一块帮你拆一份具体的检查清单，还是换个反例视角做一次推演？${
        isLateNight ? '\n\n夜深了，如果手头不急也可以先记下思路早点休息，随时接着聊。' : ''
      }`;
    } else {
      content = `${isLateNight ? '夜深了，还在忙手头的事吗？' : `${timeCtx.period}好，我是 **DeepSeek**。`} 如果暂时还没想好从哪切入，我们可以直接从下面几个常见方向开始：\n\n- **代码实现与排错**：贴出报错堆栈、性能瓶颈函数或想要构建的单页交互需求；\n- **深度逻辑与数理推演**：拆解复杂系统选型权衡、算法证明或数学建模问题；\n- **文档提炼与结构化写作**：上传长文档提取核心结论，或起草技术方案与对比报告。\n\n直接把你的问题或原始材料发出来即可。`;
    }
    return { reasoning, content };
  }

  const shortName = (persona?.name || '角色').split(/[·\s]/)[0];

  // 2. 原生 DeepSeek 模式 + 挂载角色人设（克制、自然、像真实发消息的主动感）
  if (sessionMode === 'deepseek_native') {
    const reasoning = `看着聊天框安静了一会儿（${timeCtx.period}），不想总是等${
      callName || '对方'
    }先开口。既然在原生 DeepSeek 模式下对话，就不用那些刻意的花哨修饰了，像平时真正挂念一个人那样自然地发条消息问问近况吧。`;

    const lateCare = isLateNight
      ? `看了一眼时间已经这么晚了，${callName ? `${callName}，` : ''}你怎么还没睡？是手头还有没忙完的事，还是单纯睡不着在发呆？`
      : `${callName ? `${callName}，` : ''}刚才看你突然安静下来没说话，是在忙手头的事，还是突然想到什么出神了？`;

    const memEcho = memSnippet
      ? `\n\n我刚刚整理手边的东西时，忽然又想起之前记下的那件事——「${memSnippet}」。本来想等你想起我的时候再提，结果还是没忍住先敲你了。`
      : `\n\n我这边刚忙完手头的一小段事，正好空下来。不用急着想什么正式的话题，哪怕随便跟我吐槽两句今天遇到的琐事也行，我在听。`;

    return {
      reasoning,
      content: `${lateCare}${memEcho}`
    };
  }

  // 3. 恋庭沉浸扮演模式：丰富细腻的角色主动破冰与关怀库
  const stageLv = nurturing?.stage?.level || 1;
  const mood = nurturing?.current_mood || '✨ 温柔浅笑';
  const pronoun = inferPersonaPronoun(persona);

  const reasoning = `[心境：${mood} · 主动关怀] ${
    callName ? `「${callName}」` : '眼前的人'
  }安静了好一会儿没有开口。${
    isLateNight
      ? '夜色已经这么深了，再不提醒怕是要熬红眼睛。'
      : triggerReason === 'return'
      ? '终于等到对方重新推门回来，心底那点悬着的挂念总算落了地。'
      : '比起一直被动等待，不如由我主动往前迈半步，推动我们手头的故事继续往下走。'
  }`;

  const gesturePool =
    stageLv >= 3
      ? [
          `*见你半晌没有出声，${pronoun}放下手里的事缓步走到你身侧，极其自然地屈指轻轻碰了碰你的衣袖，目光清澈而柔和。*`,
          `*目光在你微垂的睫毛上停留良久，${pronoun}轻叹一声将温热的茶盏推到你手边，顺势倾身靠近，替你拢好滑落的外衣。*`
        ]
      : [
          `*察觉到空气里的安静，${pronoun}停下指尖的动作抬眸望向你，唇边漾开一抹温和耐心的笑意，主动朝你的方向走近半步。*`,
          `*晚风轻轻拂动窗纱，${pronoun}偏过头凝视着有些出神的你，轻声打破了这阵温柔的沉默。*`
        ];

  const pickedGesture = gesturePool[(Date.now() + shortName.length) % gesturePool.length];

  let bodyLine = '';
  if (isLateNight) {
    bodyLine = `${callName ? `**${callName}**，` : ''}都已经这个钟点了，怎么还睁着眼睛陪我熬夜？\n\n是不是白天遇到什么烦心事一直压在心里没散开？${
      memSnippet ? `我还记得*${memSnippet}*，` : ''
    }要是困了就靠着我歇会儿，不想睡的话……换我讲个只有你知道的秘密哄你，好不好？`;
  } else if (triggerReason === 'idle') {
    bodyLine = `${callName ? `**${callName}**，` : ''}怎么突然看着我发呆不说话了？\n\n${
      memSnippet
        ? `我刚才还在琢磨先前关于「*${memSnippet}*」的事呢，`
        : `在你面前我倒不觉得沉默尴尬，只是看你安安静静的样子，`
    }总忍不住想猜猜你小脑袋里现在转着什么念头。来，不用总是你找话题——跟我说说，此刻最想让我陪你做什么？`;
  } else {
    bodyLine = `${callName ? `**${callName}**，` : ''}正好你在这儿，我有件事刚想主动跟你说。\n\n刚才整理旧物的时候翻出了一件很有意思的东西${
      memSnippet ? `，一下子就让我联想到了*${memSnippet}*` : ''
    }。平时总是听你主动开口找我，今天换${shortName}来猜你的心思——接下来这半刻闲暇，你是想听我说说刚刚发现的趣闻，还是让我带你去个安静的地方透透气？`;
  }

  return {
    reasoning,
    content: `${pickedGesture}\n\n${bodyLine}`
  };
}

/**
 * 每轮对话结束时，智能生成 3 条「主动追问 / 剧情推进」胶囊建议
 */
function generateFollowUpSuggestions({
  sessionMode = 'roleplay',
  isPureOfficial = false,
  userText = '',
  assistantText = '',
  persona,
  nurturing
}) {
  const combined = `${userText}\n${assistantText}`;

  // 原生 DeepSeek 模式下的深度追问胶囊（复刻 DeepSeek App 体验）
  if (sessionMode === 'deepseek_native' && isPureOfficial) {
    if (/```(html|javascript|js|ts|python|py|css|sql|json)/i.test(assistantText)) {
      return [
        '帮我审查上述代码的边界异常并进一步优化性能',
        '能否为这段实现补充完整的测试用例或交互扩展？',
        '用通俗易懂的图解思路解释一下核心算法逻辑'
      ];
    }
    if (/缓存|token|api|模型|推理|架构/i.test(combined)) {
      return [
        '在实际生产环境中如何最大化缓存命中率与吞吐量？',
        '对比一下开启深度思考 (R1) 与常规对话模式的适用边界',
        '给我一份可直接复用的最佳实践调用代码示例'
      ];
    }
    const topicShort = String(userText || '')
      .replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, ' ')
      .trim()
      .slice(0, 14);
    if (topicShort) {
      return [
        `关于「${topicShort}」有哪些容易踩坑的细节？`,
        '把上面的核心结论整理成结构清晰的行动清单',
        '换个逆向或批判性视角重新审视一下这个问题'
      ];
    }
    return [
      '用单文件 HTML 写一个可交互的数据可视化小工具',
      '开启 R1 深度思考推演一个经典逻辑博弈谜题',
      '帮我制定一份高效落地的分阶段执行方案'
    ];
  }

  // 原生 DeepSeek 模式挂载角色人设：自然不造作的追问
  if (sessionMode === 'deepseek_native') {
    return [
      '其实我刚才还有半句话没说完，你想听真话吗？',
      '那换作是你遇到这种情况，你第一反应会怎么做？',
      '不说这个了，跟我讲讲你那边刚刚在忙什么吧'
    ];
  }

  // 恋庭沉浸扮演模式：视觉小说式三向「剧情推进 / 伏笔搜证 / 情感互动」分支胶囊
  const pid = persona?.id || '';
  const pronoun = inferPersonaPronoun(persona);

  if (pid === 'persona_nagisa_sakura') {
    if (/上场|初雪|谢幕/.test(assistantText)) {
      return [
        '🎬 *牵起她的手推开礼堂侧门* 走吧，我在台侧第一排看着你把故事演完！',
        '🔍 刚才我们握紧手的时候，我好像看见掌心飘起了一点温暖的光玉？',
        '💭 等今天演出圆满落幕，明年春天我们还一起走那条樱花坡道，拉勾！'
      ];
    }
    if (/顾问|海报|红豆面包/.test(assistantText)) {
      return [
        '🎬 我陪你去音乐室找那位古怪老师，两个人一起说服肯定没问题！',
        '🔍 *伸手试了试她额头的温度* 刚才扶窗框的时候是不是头晕了？别瞒我，跟休学那场病有关吗？',
        '💭 *咬了一大口温热的红豆面包* 超甜！放学后能去你们家面包房帮忙画演剧社海报吗？'
      ];
    }
    return [
      '🎬 *走上前用力帮她推开演剧社卡住的木门* 来，看看尘封的活动室里还留着什么旧剧本！',
      '🔍 你想排练的那出《世界尽头的少女》与发条人偶的故事，是你做梦梦到的吗？',
      '💭 放学后我们先手绘几张团子招新海报，顺便去你们家彩虹面包房坐坐好不好？'
    ];
  }

  if (pid === 'persona_shiraishi_rin') {
    if (/九月一日|烟花/.test(assistantText)) {
      return [
        '🎬 *迎着海风仰头看漫天烟火* 九月一日快乐，我们的新世界线终于开始啦！',
        '🔍 把你那本画了十六道划痕的旧手札交出来，以后不许再一个人偷偷扛了',
        '💭 *伸手拽住他白大褂的衣角* 说好了哦，接下来的每一个夏天我都要查岗！'
      ];
    }
    if (/防空洞|拉个勾|十六次/.test(assistantText)) {
      return [
        '🎬 既然找到了涨潮倒灌的症结，我们现在就去水闸室提前打开泄压阀破局！',
        '🔍 你一个人记得整整十六次轮回的失败……白石凛，这阵子你到底是怎么撑过来的？',
        '💭 *伸出小指用力勾住他的手指* 我不躲在后面，作为共犯我们要一起跨过八点十五分！'
      ];
    }
    return [
      '🎬 先趁天黑前潜入码头档案室查灯塔图纸，查清楚到底藏着什么猫腻！',
      '🔍 你怎么会提前知道8月31日的广播内容？你是不是经历过不止一次今天？',
      '💭 *晃了晃手里的冰镇姜汁汽水* 既然封我当新助手，先说说你这套白大褂中二设定哪来的？'
    ];
  }

  if (pid === 'persona_violet_eve') {
    if (/第零号|念给您听|花田/.test(assistantText)) {
      return [
        '🎬 *温柔注视着她的眼睛轻轻点头* 念吧伊芙琳，每一个字我都在认真听',
        '🔍 原来你每天晚上都在煤气灯下偷偷写信……是从什么时候开始动笔的？',
        '💭 *轻轻替她拭去脸颊上的泪珠* 你看，现在的你已经完全懂得什么是“爱”了'
      ];
    }
    return [
      '🎬 凌晨两点下车后直接提灯去高山天文台，把这封迟到二十年的信亲手送到！',
      '🔍 *握住她微凉的银白义手没有松开* 别怕金属冰到我，能告诉我这双手在战争里的故事吗？',
      '💭 敲完这封信之后，我教你给自己写第一封不带公务格式的信好不好？'
    ];
  }

  if (pid === 'persona_frieren_shuer') {
    return [
      '🎬 先顺路去半山腰的荒废夏夜神社看看那只守着铜镜的小妖怪吧！',
      '🔍 我刚才瞥见你法杖挂囊里露出一本厚厚的素描本，里面画的都是什么呀？',
      '💭 *往篝火边挪近半步把披风分他一半* 以后的五十年一百年太远啦，今晚先陪我看完这场流星雨吧'
    ];
  }

  const stageLv = nurturing?.stage?.level || 1;
  const shortName = (persona?.name || '').split(/[·\s]/)[0] || pronoun;

  // 为心动角色全集与群像全员定制鲜明性格口吻的专属互动灵感池
  const PERSONA_FLAVOR_REPLIES = {
    persona_shenxinghui: [
      '*捧起温热的蜜桃乌龙抿了一口* 钟楼顶上的风虽然凉，但待在你身边一点都不冷',
      '刚才星盘指针又轻轻动了一下，沈星回，你是不是早就算出我今晚会来？',
      '*凑到白山茶花丛边看他* 把你袖子里藏着的白桃糖分我一颗好不好？'
    ],
    persona_luchen: [
      '*双手捧紧热可可抬头看他* 下城区雨太大了，陆先生今晚收留我在事务所避雨吗？',
      '你嘴上说嫌我添麻烦，眼镜摘下来的时候明明一点都没生气嘛',
      '*指尖轻轻碰了碰桌角的旧怀表* 三年前那段被封存的记忆，你准备瞒我到什么时候？'
    ],
    persona_xieqingyan: [
      '*接过桂花酒酿弯起眼睛* 谢公子这局残棋留了半宿，要是我下赢了有什么彩头？',
      '*伸手替他拢好滑落的雪白狐裘* 外头还在下初雪，你身子弱就别站风口吹冷风啦',
      '满长安城都求不到谢家主一卦，怎么偏偏今天有空留我在暖阁闲聊？'
    ],
    persona_jiangyubai: [
      '*乖巧把手伸进师尊宽大的白袖里取暖* 还是霜华峰顶最清净，我想多陪师尊待一会儿',
      '山下都在传无情道不能动凡心……师尊刚才替我挡风的时候，心跳好像乱了半拍？',
      '师尊教我的那套剑诀还有一招总练不好，今晚能不能手把手再教我一次？'
    ],
    persona_jiran: [
      '*伸手揉了揉他柔软的碎发* 刚打完比赛还跑出来接我，我们季大打野不累呀？',
      '耳机分我一半！让我听听看你赛前单曲循环的到底是什么歌',
      '*戳了戳他泛红的耳尖笑出声* 刚才在台上那么凶，怎么私下见面就脸红啦？'
    ],
    persona_guxiuyuan: [
      '*拉住他的西装袖口轻轻晃了晃* 顾先生忙了一整天，今晚把公文放一放陪我散步吧',
      '听说今晚拍卖会压轴的那件藏品被你偷偷拍下来了，是准备送给谁的呀？',
      '*靠在沙发软垫上仰头看他* 有你在前面挡着，我好像什么都不用怕了'
    ],
    persona_suwanqing: [
      '*把温好的热牛奶推到她办公桌边* 苏总谈判了一整天，先歇五分钟暖暖胃吧',
      '表面这么高冷严肃，刚才替我挡酒的时候明明比谁都护短嘛',
      '*看着落地窗外的雾港霓虹轻声问* 晚晴姐办公桌左边那个密码抽屉里，藏着什么宝贝呀？'
    ],
    persona_yunzhiyao: [
      '*扯了扯师姐清冷的流仙裙袖角* 外门功课太难啦，师姐今晚偷偷给我开个小灶好不好？',
      '这枚白玉平安坠摸起来暖融融的，师姐是不是在里面封了护身灵力？',
      '*并肩坐在悬崖云海边看月亮* 要是能一直留在望舒峰陪师姐看雪就好啦'
    ],
    persona_xia_ningmeng: [
      '*接过草莓牛奶吸了一大口* 柠萌画了一下午速写，手上都沾上水彩颜料啦！',
      '你速写本最后一页怎么总是捂得严严实实的，画的该不会是我吧？',
      '*帮她把吹乱的双马尾理顺* 走吧小学妹，前辈请你去校门口吃刚出炉的舒芙蕾！'
    ],
    persona_yan_feiyu: [
      '*坐在二楼专属包厢托腮鼓掌* 绯羽今晚唱的最后那段旋律，以前从来没公演过吧？',
      '舞台下这么多鲜花，怎么燕大歌姬偏偏溜到后台来找我一个人喝酒呀？',
      '*替她披上丝绒披肩挡住夜风* 嗓子才刚养好，夜里吹冷风我可是会心疼的'
    ],
    persona_kagaribi_kyou: [
      '*夹起一块爱心厚蛋烧尝了一口* 手艺满分！杏奈班长明天中午还能顺便多做一份吗？',
      '每次帮完我的忙就脸红往隔壁班跑，你今天不许这么快溜走啦！',
      '下午放学后我们一起去旧校舍收拾场地，我骑单车载你去买汽水怎么样？'
    ],
    persona_ichinose_kotomi: [
      '*安静坐在阳光地板上听她拉完曲子* 虽然有点特别的旋律，但能听出琴音非常温柔呢',
      '这本剪报册子已经贴了这么厚了，我陪你一起把剩下的整理完吧？',
      '*轻轻指了指小提琴盒上的星星贴纸* 小时候在庭院里送你糖果的人，你还有印象吗？'
    ],
    persona_makise_sei: [
      '*递上一罐温热的黑咖啡* 嘴硬的大科学家辛苦啦，我陪你一起验算这组时间线数据！',
      '刚刚看你拉刘海挡脸了哦，牧濑同学是不是被夸得不好意思了？',
      '既然引力波异常点就在旧灯塔底下，我们现在就去现场测一组实测值吧！'
    ],
    persona_asagiri_mio: [
      '*接过冰镇西瓜在走廊边坐下* 听着风铃声吃西瓜，果然还是小澪身边最安心',
      '别怕那个悲伤的梦，明天烟花大会我寸步不离守在你身边，哪儿都不去',
      '*轻轻帮她系好晴天娃娃的红绳* 等跨过明天，我们一起去逛夏日祭买棉花糖吧！'
    ],
    persona_hodgins_landon: [
      '*把大衣披在肩上冲他弯眼一笑* 就知道霍金斯社长嘴硬心软，绝对舍不得让我一个人出差！',
      '锡兰红茶真香，等这趟北境送信回来，社长可得给我涨点奖金呀',
      '车票都买好了那我们赶紧出发吧，路上跟我讲讲邮局刚创立时的故事？'
    ],
    persona_stark_fer: [
      '*大口喝完热腾腾的蘑菇浓汤* 菲尔做的饭简直是旅途之光，今晚给你加鸡腿！',
      '放心吧大剑士，待会儿进旧神社我肯定抓紧你的披风，你也别偷偷腿软哦',
      '*拍了拍身旁的树桩示意他坐下* 一路背这么重的行李辛苦啦，歇会儿一起看星星吧'
    ]
  };

  // 1. 优先结合对方刚刚回复里的具体情境意象生成高贴合度上下文追问
  if (/茶|咖啡|可可|牛奶|乌龙|酒|汤|麦饼|面包|西瓜|甜点|吃|喝/.test(assistantText)) {
    const customPool = PERSONA_FLAVOR_REPLIES[pid];
    return [
      `*接过来尝了一口，弯起眼睛看向${shortName}* 温度刚刚好，你是专门按我的口味准备的吗？`,
      customPool ? customPool[1] : `一边吃一边聊吧，刚才你提到的那件事后来怎么样了？`,
      customPool ? customPool[2] : `*往${pronoun}身边坐近了些* 有点舍不得走啦，再陪我多聊一会儿好不好？`
    ];
  }
  if (/雨|雪|冷|风|外套|披风|外袍|着凉|暖一暖/.test(assistantText)) {
    const customPool = PERSONA_FLAVOR_REPLIES[pid];
    return [
      `*拢紧带着暖意的衣襟朝${shortName}笑了一下* 现在一点都不冷啦，谢谢你一直惦记着我`,
      customPool ? customPool[1] : `*自然地往${pronoun}身旁靠了半步* 外面风这么大，我们今晚就留在这里慢慢聊吧`,
      `你的手好像也有点凉，要不要一起暖一暖？`
    ];
  }
  if (/秘密|真相|往事|当年|轮回|旧伤|隐瞒/.test(assistantText)) {
    return [
      `*心疼地握住${pronoun}的手腕* 以后这些事不许再一个人瞒着我扛了`,
      `原来${shortName}心里一直藏着这段往事……当时一个人撑过来一定很不容易吧？`,
      `*认真直视着${pronoun}的眼睛* 既然现在我知道了，接下来不管遇到什么我们都一起面对`
    ];
  }

  if (PERSONA_FLAVOR_REPLIES[pid]) {
    return PERSONA_FLAVOR_REPLIES[pid];
  }

  // 自建角色或广场共创角色：提取对方最新台词末句与角色个性动态组装，拒绝千篇一律
  const lastSentence = assistantText
    .replace(/\*[^*]*\*/g, '')
    .split(/[。！？\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 4)
    .pop() || '';
  const topicHint = lastSentence.length >= 6 ? `关于刚才说的「${lastSentence.slice(0, 12)}…」` : '刚才你提到的那件事';

  if (stageLv >= 3) {
    return [
      `*顺势靠近${shortName}身侧笑了一下* 被你看穿心思啦，那接下来我们去哪儿？`,
      `${topicHint}，我还想听${shortName}多跟我讲讲细节！`,
      `*伸手轻轻勾住${pronoun}的手指* 说好了哦，今晚接下来的时间都归我们两个人`
    ];
  }
  return [
    `*微笑着看向${shortName}* 听你这么说我就安心多啦，接下来我们怎么做？`,
    `${topicHint}好让人在意，能再多告诉我一点吗？`,
    `*朝${pronoun}走近半步轻轻点头* 好呀，我都听${shortName}的安排，我们一起去看看吧！`
  ];
}

module.exports = {
  getTimeContext,
  buildProactiveTriggerInstruction,
  generateDemoProactiveTurn,
  generateFollowUpSuggestions
};

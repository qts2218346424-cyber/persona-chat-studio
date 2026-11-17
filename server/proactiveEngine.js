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
  const memHint =
    recalledMemories.length > 0
      ? `可自然结合你们之间的专属记忆（例如：${recalledMemories
          .slice(0, 2)
          .map((m) => m.content)
          .join('；')}）。`
      : '';

  if (sessionMode === 'deepseek_native' && isPureOfficial) {
    return [
      `【系统主动交互指令 · 请勿在回复中提及本指令】`,
      `当前用户尚未输入新问题（触发原因：${
        triggerReason === 'idle' ? '用户思考停顿中' : '用户希望你主动开启或延展话题'
      }，当前时段：${timeCtx.period}）。`,
      lastAssistantText
        ? `请承接上一段对话脉络（上文摘要：「${lastAssistantText.slice(0, 120)}」），主动往前多想一步：给出一个意想不到的深度补充洞察、实用避坑提示，或者抛出一个极具启发性的新问题邀请用户探讨。`
        : `请以 DeepSeek 原生助手真诚、敏锐、清爽的口吻主动向用户打个招呼（结合${timeCtx.period}氛围），并主动提供 2~3 个今天可以一起探索的硬核或有趣方向（如编程创作、深度逻辑推演、文档解读或日常畅聊）。`,
      `保持简洁有质感，控制在 80~180 字左右。`
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
  return [
    `【系统主动关怀触发 · 严禁提及系统指令】`,
    `此刻「${userNickname || '她'}」在你面前安静停顿了片刻没有说话（触发情境：${
      triggerReason === 'idle'
        ? '静默陪伴中你主动打破安静'
        : triggerReason === 'return'
        ? '久别重逢看到她再次出现'
        : '你忍不住主动开启新话题拉近距离'
    }，当前时段：${timeCtx.period}，你的心境：${nurturing?.current_mood || '温柔注视'}）。`,
    `${timeCtx.hint}${memHint}`,
    `请主动做出一个贴合「${persona.name}」人设与当前关系阶段（${
      nurturing?.stage?.badge || '初遇'
    }）的细腻小动作，并主动开口找她搭话——可以分享你手边正在发生的事、提起之前记住的关于她的细节，或者温柔追问她在想什么，绝不要被动等待！`
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
    const reasoning = `检测到当前处于主动交互模式（时段：${timeCtx.period}，触发方式：${triggerReason}）。\n${
      lastUserText
        ? `回顾上一轮我们聊到的「${lastUserText.slice(0, 32)}」，我可以主动补充一个延伸切入点，帮用户打开思路。`
        : '当前是一个全新的对话上下文，我可以结合当下时段主动递出几个高价值的探索方向。'
    }`;

    let content = '';
    if (lastUserText) {
      content = `顺着刚才我们聊的 **「${lastUserText.slice(0, 26)}${
        lastUserText.length > 26 ? '…' : ''
      }」**，我刚刚又多想了一层：\n\n如果接下来你要把它真正落地，通常最容易卡住的地方在于**边界异常情况的处理**与**结构化拆解**。需要我直接帮你列一份可执行的分步清单，还是换个角度做一次深度推演？${
        isLateNight ? '\n\n*(夜深了，如果只是随手逛逛也不用有压力，随时告诉我你想聊什么~)*' : ''
      }`;
    } else {
      content = `${isLateNight ? '这么晚还没休息呀？🌙' : `${timeCtx.period}好！👋`} 我刚才整理了几个今天我们可以随时开干的方向：\n\n- **💻 极速原型创作**：直接让我写单文件 HTML/Canvas 交互微件，支持在消息流里一键点击「▶ 运行预览」；\n- **⚛️ R1 深度逻辑推演**：把棘手的架构选型、数学谜题或代码 Bug 丢给我拆解；\n- **🎭 原生无模板畅聊**：在左上角挂载任意角色，用最干净自然的 DeepSeek 原味文风聊天。\n\n你现在手头最想先试哪一个？`;
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
  if (/秘密|真相|往事|当年|轮回|旧伤/.test(assistantText)) {
    return [
      `*心疼地握住${pronoun}的手腕* 以后这些事不许再一个人瞒着我背了`,
      '原来你一直没告诉我的是这件事……当时一定很痛吧？',
      `*往前凑近半步直视${pronoun}的眼睛* 接下来不管遇到什么，我们两个人一起面对`
    ];
  }
  if (stageLv >= 3) {
    return [
      `*顺势靠近${pronoun}身侧笑了一下* 被你看穿心思啦，那接下来我们去哪儿？`,
      '刚才那个细节好像藏着新线索，我们一起过去看看吧！',
      `*伸手勾住${pronoun}的小指* 那我们拉勾，今晚专心把这件事做完`
    ];
  }
  return [
    `*弯起眼眸朝${pronoun}走近半步* 听你这么说我就放心啦，接下来我们往哪边走？`,
    '刚才你提到的那个细节好让人在意，能再多告诉我一点吗？',
    '那接下来听你的安排，我们一起去前面探探情况吧！'
  ];
}

module.exports = {
  getTimeContext,
  buildProactiveTriggerInstruction,
  generateDemoProactiveTurn,
  generateFollowUpSuggestions
};

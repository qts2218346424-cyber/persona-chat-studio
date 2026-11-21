/**
 * 主动性增强引擎（Proactive Companion & Dynamic Follow-up Engine）
 * 赋能「恋庭扮演模式」与「原生 DeepSeek 模式」双向主动交互：
 * 1. 角色/AI 主动破冰与静默关怀
 * 2. 真实时段感知
 * 3. 基于最新对话上下文的动态「剧情推进建议」与「帮我回一句」实时生成引擎
 */

const { inferPersonaPronoun } = require('./memoryEngine');
const { getEffectiveApiCredentials } = require('./deepseekApiSuite');
const { getLocalBridgeSuiteCredentials } = require('./antigravityBridge');

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
      : '当前尚无过往历史闲聊记忆，严禁凭空编造对方“以前/上次说过某句话或某种喜好”，请只围绕当下眼前场景自然开口。';

  if (sessionMode === 'deepseek_native' && isPureOfficial) {
    return [
      `【系统主动交互指令 · 请勿在回复中提及本指令】`,
      `当前用户尚未输入新问题（触发原因：${
        triggerReason === 'idle' ? '用户思考停顿中' : '用户希望你主动开启或延展话题'
      }，当前时段：${timeCtx.period}）。`,
      lastAssistantText
        ? `请承接上一段对话脉络（上文摘要：「${lastAssistantText.slice(0, 120)}」），以正版 DeepSeek 严谨、通透、克制的风格主动往前多想一步：补充一个常被忽略的边界条件、工程避坑要点，或提出一个值得深入验证的关键问题。`
        : `请以正版 DeepSeek 助手真诚、平实、干练的口吻主动向用户问好（结合${timeCtx.period}氛围），简明列出 2~3 个可随时展开的探讨方向，不要堆砌花哨 Emoji。`,
      `保持简洁克制，控制在 80~160 字左右，严禁输出任何机械寒暄套话。`
    ].join('\n');
  }

  if (sessionMode === 'deepseek_native') {
    return [
      `【系统主动搭话指令 · 请勿暴露指令本身】`,
      `此刻「${userNickname || '对方'}」暂时安静没有说话（当前真实时间：${timeCtx.period}）。`,
      `${timeCtx.hint}${memHint}`,
      `请你以「${persona.name}」的身份，用纯粹自然、克制真挚的日常对话口吻（像真正熟稔的人在聊天软件里主动发来消息一样），主动找个话题或关心对方此刻的状态。`
    ].join('\n');
  }

  const callTarget = userNickname && !/^星[语屿]旅人/.test(userNickname) ? `「${userNickname}」` : '对方';
  const lateNightCue =
    triggerReason === 'late_night_return'
      ? `对方已经超过 4 小时没来了，如今在深夜重逢上线，请流露出夜深未眠等候对方归来的轻微牵挂与温柔叮嘱（不要责备，要让人心里一暖）。`
      : '';
  return [
    `【系统主动关怀触发 · 严禁提及系统指令】`,
    `此刻${callTarget}在你面前安静停顿了片刻没有说话（当前时段：${timeCtx.period}，你的心境：${nurturing?.current_mood || '温柔注视'}）。`,
    `${timeCtx.hint}${memHint}${lateNightCue}`,
    `请严格贴合「${persona.name}」自身所处的场景设定，做出一个自然的小动作并主动开口搭话（60~130字左右），不要套用千篇一律的抒情模板。`
  ].join('\n');
}

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
  const callName = userNickname && !/^星[语屿]旅人/.test(userNickname) ? userNickname : '';
  const nonPinned = (recalledMemories || []).filter((m) => m.category !== 'Pinned');
  const memSnippet = nonPinned[0] ? nonPinned[0].content.replace(/^[^：]+：/, '').replace(/。$/, '') : '';

  if (sessionMode === 'deepseek_native' && isPureOfficial) {
    const reasoning = `当前用户在对话框稍作停顿（时段：${timeCtx.period}），顺着刚才的话题给出一两个具体的深入切入点。`;
    const content = lastUserText
      ? `顺着刚才聊到的 **「${lastUserText.slice(0, 26)}${lastUserText.length > 26 ? '…' : ''}」** 补充一点延伸思考：\n\n在实际落地阶段，最容易忽略的往往是**边界异常输入**与**阶段验证指标**。需要我针对这一块帮你拆一份检查清单，还是换个反例视角做一次推演？`
      : `${isLateNight ? '夜深了，还在忙手头的事吗？' : `${timeCtx.period}好，我是 **DeepSeek**。`} 直接把你想探讨的代码、文档或问题发出来即可。`;
    return { reasoning, content };
  }

  const shortName = (persona?.name || '角色').split(/[·\s]/)[0];
  if (sessionMode === 'deepseek_native') {
    return {
      reasoning: `看着聊天框安静了一会儿（${timeCtx.period}），自然问问对方近况。`,
      content: `${isLateNight ? `这么晚了${callName ? `，${callName}` : ''}怎么还没睡？` : `${callName ? `${callName}，` : ''}看你突然停下来没说话，在忙什么呢？`}${
        memSnippet ? `\n\n刚刚忽然想起你提过的「${memSnippet}」，现在怎么样了？` : '\n\n哪怕只是随便聊两句日常琐事也行，我在听呢。'
      }`
    };
  }

  const pronoun = inferPersonaPronoun(persona);
  const mood = nurturing?.current_mood || '✨ 温柔浅笑';
  const snippet = String(lastAssistantText || '').replace(/\*[^*]*\*/g, '').trim().slice(0, 24);
  return {
    reasoning: `[心境：${mood}] 对方安静了一会儿，主动说点什么打破沉默。`,
    content: isLateNight
      ? `*抬头看了眼窗外夜色，${pronoun}轻轻把视线挪回你身上：*\n\n${callName ? `**${callName}**，` : ''}已经这么晚了，怎么还在硬撑着不休息？困了的话随时告诉我。`
      : `*察觉到你半天没出声，${pronoun}偏过头轻声问了一句：*\n\n${callName ? `**${callName}**，` : ''}刚才聊${snippet ? `「${snippet}」` : '到一半'}怎么突然发呆啦？在想什么呢，说给我听听？`
  };
}

function extractCoreQuestionOrNoun(text) {
  const clean = String(text || '')
    .replace(/\*[^*]*\*/g, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return { sentence: '', question: '', noun: '' };

  const sentences = clean
    .split(/[。！？!?\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 4);
  const lastSentence = sentences[sentences.length - 1] || clean.slice(0, 32);
  const question = [...sentences].reverse().find((s) => /[?？]|(?:吗|呢|怎么|哪|谁|什么|好不好|行不行|愿意)/.test(s)) || '';

  const nounMatches = clean.match(/「([^」]{2,14})」|《([^》]{2,14})》/g) || [];
  const noun = nounMatches.length > 0 ? nounMatches[nounMatches.length - 1].replace(/[「」《》]/g, '') : '';

  return {
    sentence: lastSentence.slice(0, 26),
    question: question.slice(0, 28),
    noun: noun.slice(0, 14)
  };
}

/**
 * 上下文动态本地建议生成器（杜绝写死不变的固定选项池，随每轮对话内容与刷新批次实时变化）
 */
function generateFollowUpSuggestions({
  sessionMode = 'roleplay',
  isPureOfficial = false,
  userText = '',
  assistantText = '',
  persona,
  nurturing,
  excludeReplies = [],
  nonce = 0
}) {
  const excludedSet = new Set((Array.isArray(excludeReplies) ? excludeReplies : []).map((s) => String(s || '').trim()));
  const { sentence, question, noun } = extractCoreQuestionOrNoun(assistantText);
  const userShort = extractCoreQuestionOrNoun(userText).sentence.slice(0, 16);
  const shortName = (persona?.name || 'TA').split(/[·\s]/)[0] || 'TA';
  const pronoun = inferPersonaPronoun(persona);

  if (sessionMode === 'deepseek_native' && isPureOfficial) {
    const candidates = [];
    if (/```(html|javascript|js|ts|python|py|css|sql|json)/i.test(assistantText)) {
      candidates.push(
        '帮我检查上面这段代码有没有边界 bug 或性能瓶颈',
        '给这段实现补充一套边界测试用例',
        '把核心实现思路精简成几行伪代码说明',
        '如果数据量扩大 100 倍，这段逻辑需要怎么重构？'
      );
    }
    if (noun) {
      candidates.push(
        `深入展开讲讲「${noun}」在实际场景中的限制条件`,
        `对比一下「${noun}」与其他常见替代方案的优缺点`
      );
    }
    if (sentence) {
      candidates.push(
        `针对你刚提到的「${sentence.slice(0, 14)}」，能举个具体反例吗？`,
        `把「${sentence.slice(0, 14)}」这一步拆成可直接执行的步骤`
      );
    }
    if (userShort) {
      candidates.push(
        `围绕「${userShort}」还有哪些容易忽略的坑？`,
        `换一个完全相反的角度重新评估「${userShort}」`
      );
    }
    candidates.push(
      '把上面的结论整理成一页简洁的行动检查清单',
      '总结一下这件事最关键的 1~2 个决定性约束是什么',
      '如果时间/预算减半，最精简的保底方案怎么选？'
    );
    const filtered = candidates.filter((c) => !excludedSet.has(c));
    const pool = filtered.length >= 3 ? filtered : candidates;
    const offset = Math.abs(Number(nonce) || 0) % pool.length;
    return [0, 1, 2].map((i) => pool[(offset + i) % pool.length]);
  }

  if (sessionMode === 'deepseek_native') {
    const topicRef = noun ? `「${noun}」` : sentence ? `你说的「${sentence.slice(0, 12)}」` : '刚才那件事';
    const pool = [
      `听你提到${topicRef}，我倒是更好奇你当时的真实想法`,
      `那按现在这个情况，你接下来打算怎么处理？`,
      `别光顾着说这个了，你那边现在忙完没有？`,
      `如果换成是我遇上${topicRef}，可能早就坐不住了`,
      `话说回来，你刚才那句话是不是还藏着半截没说？`,
      `行，那咱们先把眼下这步敲定再往下聊`
    ];
    const filtered = pool.filter((c) => !excludedSet.has(c));
    const src = filtered.length >= 3 ? filtered : pool;
    const offset = (Math.abs(Number(nonce) || 0) + (assistantText.length % 5)) % src.length;
    return [0, 1, 2].map((i) => src[(offset + i) % src.length]);
  }

  // 恋庭剧本扮演模式：紧扣刚才 AI 最新一句的具体问法/实体/情绪动态构造 3 个不同维度选项
  const candidates = [];
  const topicTag = noun ? `「${noun}」` : sentence ? `「${sentence.slice(0, 13)}」` : '这件事';

  if (question) {
    candidates.push(
      `关于你问的——我选后者，不过我有个条件要先说好`,
      `*笑着迎上${pronoun}的视线* 怎么忽然这么问？其实我心里早就已经有答案了`,
      `先别急着让我做选择嘛，${shortName}你自己心里更偏向哪一边？`
    );
  }
  if (/？|\?|为什么|怎么|吗|呢/.test(assistantText)) {
    candidates.push(
      `*认真思考了一秒才抬头看${pronoun}* ${noun ? `提到「${noun}」` : '老实说'}，我刚才其实有另一层打算`,
      `要是我偏不按常理出牌呢，${shortName}打算怎么接招？`
    );
  }
  if (sentence) {
    candidates.push(
      `*顺着${pronoun}的话走近半步* 听你说到${topicTag}，我突然想起个有意思的细节`,
      `等等，刚才那句「${sentence.slice(0, 12)}」……你是不是还有事瞒着我？`,
      `*轻轻挑眉笑了一声* 原来${shortName}一直都是这么想的呀，那接下来听我的安排？`
    );
  }
  const stageLv = nurturing?.stage?.level || 1;
  if (stageLv >= 3) {
    candidates.push(
      `*极其自然地伸手扯住${pronoun}的衣袖* 少岔开话题了，快老实交代刚才那句话是什么意思`,
      `*凑近到能听清呼吸的距离低声开口* 好呀，既然你这么说了，我可当真了`
    );
  } else {
    candidates.push(
      `*微微笑了笑朝${pronoun}点头* 既然方向差不多定下来了，我们现在就动身吧`,
      `先歇一口气再继续吧，刚才一直紧绷着你不累吗？`
    );
  }
  candidates.push(
    `*停下脚步转头看向${shortName}* 换个思路怎么样？我觉得没必要硬按原本的计划走`,
    `有意思……那我们先去现场确认一下真假，免得在这里瞎猜`
  );

  const unique = [...new Set(candidates)];
  const filtered = unique.filter((c) => !excludedSet.has(c));
  const src = filtered.length >= 3 ? filtered : unique;
  const seed = Math.abs(Number(nonce) || 0) + assistantText.length + userText.length;
  const start = seed % src.length;
  return [0, 1, 2].map((i) => src[(start + i) % src.length]);
}

function parseFollowUpJsonArray(rawText) {
  const clean = String(rawText || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .trim();
  if (!clean) return null;
  const arrMatch = clean.match(/\[[\s\S]*\]/);
  if (arrMatch) {
    try {
      const arr = JSON.parse(arrMatch[0]);
      if (Array.isArray(arr)) {
        const items = arr
          .map((x) => String(x || '').replace(/^[\d.\-•\s]+/, '').trim())
          .filter((x) => x.length >= 4 && x.length <= 75);
        if (items.length >= 2) return items.slice(0, 3);
      }
    } catch {}
  }
  const lines = clean
    .split(/\r?\n/)
    .map((l) => l.replace(/^[\d.\-•*"'\s]+/, '').replace(/["',]+$/, '').trim())
    .filter((l) => l.length >= 4 && l.length <= 75);
  return lines.length >= 2 ? lines.slice(0, 3) : null;
}

/**
 * 调用当前可用大模型根据最新剧情实时生成 3 条各具角度的后续选项 / 「帮我回一句」台词
 * 若无可用在线模型或超时，则自动无缝降级到动态上下文生成器
 */
async function generateDynamicFollowUpsWithLLM({
  settings = {},
  sessionMode = 'roleplay',
  isPureOfficial = false,
  persona = {},
  nurturing = null,
  userNickname = '',
  recentMessages = [],
  userText = '',
  assistantText = '',
  excludeReplies = [],
  nonce = 0,
  timeoutMs = 5000
}) {
  const userCred = getEffectiveApiCredentials(settings);
  const bridgeCred = !userCred.hasKey ? getLocalBridgeSuiteCredentials() : null;
  const cred = userCred.hasKey
    ? userCred
    : bridgeCred && bridgeCred.hasBridgeKey
    ? {
        hasKey: true,
        apiKey: bridgeCred.apiKey,
        headers: bridgeCred.headers,
        endpoints: { chatUrl: bridgeCred.chatUrl, isOfficialDeepSeek: bridgeCred.isOfficialDeepSeek },
        preferredModel: bridgeCred.preferredModel
      }
    : null;

  if (!cred || !cred.hasKey || !cred.endpoints?.chatUrl) {
    return generateFollowUpSuggestions({
      sessionMode,
      isPureOfficial,
      userText,
      assistantText,
      persona,
      nurturing,
      excludeReplies,
      nonce
    });
  }

  try {
    const historySnippet = (recentMessages || [])
      .slice(-6)
      .filter((m) => m && m.content)
      .map((m) => `${m.role === 'user' ? '用户' : '对方'}: ${String(m.content).slice(0, 200)}`)
      .join('\n');

    const excludeHint =
      Array.isArray(excludeReplies) && excludeReplies.length > 0
        ? `\n【绝对禁止重复以下已用过的句子】：\n${excludeReplies.slice(-6).map((s) => `- ${s}`).join('\n')}`
        : '';

    let sysPrompt = '';
    let userPrompt = '';

    if (sessionMode === 'deepseek_native' && isPureOfficial) {
      sysPrompt = '你是对话追问建议生成器。请根据最新对话内容，生成 3 条用户下一步最想追问的简短自然问题（每条 10~32 字），角度互不相同（如深挖原理、实操步骤、反例/避坑）。只输出一个 JSON 字符串数组，不要输出任何额外解释或 markdown 代码块标记。';
      userPrompt = `最近对话：\n${historySnippet || `用户：${userText}\nAI：${assistantText.slice(0, 300)}`}${excludeHint}\n\n请输出 3 条全新的追问 JSON 数组：`;
    } else if (sessionMode === 'deepseek_native') {
      sysPrompt = `你正在帮用户「${userNickname || '我'}」拟定回复「${persona.name || '对方'}」的台词。请紧扣对方最新说的那句话，用自然真实的聊天口吻写 3 条不同走向的简短回复（10~36 字，不堆砌星号动作）。只输出 JSON 字符串数组。`;
      userPrompt = `最近对话：\n${historySnippet || `对方：${assistantText.slice(0, 300)}`}${excludeHint}\n\n请输出 3 条全新回复的 JSON 数组：`;
    } else {
      sysPrompt = `你是互动剧情的「玩家台词实时提示器」。对方角色是「${persona.name || '角色'}」（性格：${(persona.personality || '').slice(0, 60)}），玩家称呼为「${userNickname || '你'}」。
请严格站在**玩家第一人称（我）**视角，紧扣对话最新一轮刚发生的具体事情、对方刚问的问题或情绪氛围，写出 3 条玩家此刻可以回复的全新话语（每条 12~40 字）：
1. 第 1 条：直接顺着对方刚才话里的核心细节接话或追问；
2. 第 2 条：带一点简短自然的 \`*动作描写*\` 的亲近或情绪回应；
3. 第 3 条：意料之外的调侃、反对、转移方向或推动新剧情的动作。
绝对禁止抄袭套话、禁止跨戏无关道具、禁止重复历史已给出的句子！只输出包含 3 个字符串的纯 JSON 数组。`;
      userPrompt = `当前最新剧情片段：\n${historySnippet || `对方：${assistantText.slice(0, 320)}`}${excludeHint}\n\n请紧扣最后一句话输出 3 条全新玩家回复 JSON 数组（随机偏移编号 #${nonce}）：`;
    }

    const chatUrl = cred.endpoints.chatUrl;
    const lowerUrl = chatUrl.toLowerCase();
    let targetModel = cred.preferredModel || 'deepseek-flash';
    if (lowerUrl.includes('deepseek.com') && targetModel === 'deepseek-reasoner') {
      targetModel = 'deepseek-chat';
    }

    const reqBody = {
      model: targetModel,
      messages: [
        { role: 'system', content: sysPrompt },
        { role: 'user', content: userPrompt }
      ],
      max_tokens: 240,
      temperature: 0.96,
      stream: false
    };
    if (/flash/i.test(targetModel)) {
      if (lowerUrl.includes('deepseek.com')) reqBody.thinking = { type: 'disabled' };
      else if (lowerUrl.includes('siliconflow.cn') || lowerUrl.includes('aliyuncs.com')) reqBody.enable_thinking = false;
    }

    const resp = await fetch(chatUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(cred.headers || { Authorization: `Bearer ${cred.apiKey}` })
      },
      body: JSON.stringify(reqBody),
      signal: AbortSignal.timeout(timeoutMs)
    });

    if (resp.ok) {
      const json = await resp.json();
      const raw = json?.choices?.[0]?.message?.content || '';
      const parsed = parseFollowUpJsonArray(raw);
      if (parsed && parsed.length > 0) {
        return parsed;
      }
    }
  } catch {}

  return generateFollowUpSuggestions({
    sessionMode,
    isPureOfficial,
    userText,
    assistantText,
    persona,
    nurturing,
    excludeReplies,
    nonce
  });
}

module.exports = {
  getTimeContext,
  buildProactiveTriggerInstruction,
  generateDemoProactiveTurn,
  generateFollowUpSuggestions,
  parseFollowUpJsonArray,
  generateDynamicFollowUpsWithLLM
};

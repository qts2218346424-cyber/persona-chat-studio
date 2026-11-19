/**
 * 云端与体验模型流式网关适配器（已接入本地 Antigravity 双核智能体桥接底座，在线模型受星月会员次数校验管控）
 * 支持通道：
 * 1. demo: 梦境轻语体验引擎（开启本地 Antigravity 双核桥接时自动传给本地联动底座推演并流式回传，离线自动无感降级）
 * 2. deepseek: 星耀在线大模型（自带密钥直连 / 平台托管双核底座推理 · 会员计次）
 * 3. custom_gateway: 专属云端令牌网关（自定义在线流式网关 + Bearer/会话令牌 · 会员计次）
 */

const { tryStreamViaAntigravityBridge } = require('./antigravityBridge');
const { inferPersonaPronoun, normalizeMessagesForStrictLLM } = require('./memoryEngine');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class StreamThinkSplitter {
  constructor({ onReasoning, onContent, enableThought }) {
    this.onReasoning = onReasoning;
    this.onContent = onContent;
    this.enableThought = enableThought;
    this.buffer = '';
    this.mode = 'detect';
    this.sawNativeReasoning = false;
  }

  feedNativeReasoning(chunk) {
    if (!chunk) return;
    this.sawNativeReasoning = true;
    this.onReasoning(chunk);
  }

  feedContent(chunk) {
    if (!chunk) return;
    if (!this.enableThought && !this.sawNativeReasoning) {
      this.onContent(chunk);
      return;
    }

    this.buffer += chunk;

    if (this.mode === 'detect') {
      const trimmed = this.buffer.trimStart();
      if (trimmed.length === 0) return;

      if ('<think>'.startsWith(trimmed) && trimmed.length < 7) {
        return;
      }

      if (trimmed.startsWith('<think>')) {
        this.mode = 'in_think';
        const idx = this.buffer.indexOf('<think>');
        this.buffer = this.buffer.slice(idx + 7);
      } else {
        this.mode = 'in_content';
        const out = this.buffer;
        this.buffer = '';
        this.onContent(out);
        return;
      }
    }

    if (this.mode === 'in_think') {
      const closeIdx = this.buffer.indexOf('</think>');
      if (closeIdx !== -1) {
        const thoughtPart = this.buffer.slice(0, closeIdx);
        if (thoughtPart && !this.sawNativeReasoning) {
          this.onReasoning(thoughtPart);
        }
        let rest = this.buffer.slice(closeIdx + 8);
        rest = rest.replace(/^\s+/, '');
        this.buffer = '';
        this.mode = 'in_content';
        if (rest) this.onContent(rest);
      } else if (!this.sawNativeReasoning) {
        const safeLen = Math.max(0, this.buffer.length - 8);
        if (safeLen > 0) {
          const emitPart = this.buffer.slice(0, safeLen);
          this.buffer = this.buffer.slice(safeLen);
          this.onReasoning(emitPart);
        }
      }
      return;
    }

    if (this.mode === 'in_content') {
      const out = this.buffer;
      this.buffer = '';
      this.onContent(out);
    }
  }

  flush() {
    if (!this.buffer) return;
    if (this.mode === 'in_think') {
      if (!this.sawNativeReasoning) {
        this.onReasoning(this.buffer);
      }
    } else {
      this.onContent(this.buffer);
    }
    this.buffer = '';
  }
}

function extractUserTopicPhrase(text) {
  const clean = String(text || '')
    .replace(/\*[^*]*\*/g, ' ')
    .replace(/[“”"「」『』()（）]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return '';
  const stripped = clean
    .replace(/^(嗯+|啊+|哦+|那|可是|但是|其实|我觉得|我想|请问|那个|喂|嘿)[，,、\s]*/g, '')
    .trim();
  return (stripped || clean).slice(0, 26);
}

function buildResponsiveDemoTurn({ persona, pronoun, shortName, userText, greetingCall, recalledMemories = [], directorNote = '', totalHistoryCount = 1 }) {
  const clean = String(userText || '').trim();
  const actionMatch = clean.match(/\*([^*]+)\*/);
  const spoken = clean.replace(/\*[^*]*\*/g, '').trim();
  const topic = extractUserTopicPhrase(spoken);
  const styleHint = `${persona?.personality || ''} ${persona?.speaking_style || ''}`;
  const isTsundere = /傲娇|毒舌|嘴硬|高冷|清冷|禁欲/.test(styleHint);
  const isPlayful = /元气|可爱|呆萌|活泼|幽默/.test(styleHint);
  const isNegativeOrRefuse = /^(不要|不去|不行|不想|算了|没兴趣|拒绝|才不要|才不|别)/i.test(spoken) || /不想去|不想聊|换个|换话题|别提|不要去|懒得/.test(spoken);
  const isQuestion = /[?？]$/.test(spoken) || /^(为什么|怎么|难道|真的|是不是|什么|哪里|谁|吗|呢)/.test(spoken) || /(?:吗|呢|怎么|为什么|啥|什么意思)[?？]?$/.test(spoken);
  const isPhysicalAffection = /牵|握|抱|靠|摸|拂去|拍拍|披上|蹭|亲|贴|拉住/.test(clean);
  const isSweetOrConfess = /喜欢|好温柔|想你|陪我|答应|约定|拉勾|在意|心疼|可爱|帅/.test(clean);
  const memEcho = recalledMemories.find((m) => m.category !== 'Pinned' && m.slot_key !== 'scene_origin');

  if (actionMatch && !spoken) {
    const actDesc = actionMatch[1].trim();
    return {
      thought: `他突然「${actDesc.slice(0, 22)}」，一时竟有些反应不过来，心跳都漏了一拍。`,
      reply: isTsundere
        ? `*被你这突如其来的举动弄得微微一僵，偏过头掩饰地轻咳了一声，视线却又很快转回来。*\n\n${greetingCall}突然${actDesc}做什么……话先说在前头，我可没有被你吓到。`
        : `*注意到你的小动作，${pronoun}眉眼瞬间柔和下来，顺势接住了你的节奏。*\n\n${greetingCall}怎么不声不响地就${actDesc}呀？有什么话想对我说，不用藏着，直接开口就好。`
    };
  }

  if (isPhysicalAffection) {
    return {
      thought: `离得这么近，原本想好的说辞全被这一瞬间的温度打乱了。`,
      reply: isTsundere
        ? `*动作顿了一瞬，耳廓悄悄泛起一点热意，却没有躲开，只把视线别向一旁低声开口：*\n\n${greetingCall}……你这家伙，未免也太不懂保持距离了。${topic ? `刚还在说「${topic}」，` : ''}怎么一转眼就动手动脚的？`
        : `*感受到你的温度，${pronoun}睫毛轻颤了一下，唇角自然弯起温软的弧度。*\n\n${greetingCall}突然靠过来这么近……${topic ? `刚才说「${topic}」的时候，我还以为你又要逗我呢。` : '我还挺喜欢这样的。'}`
    };
  }

  if (isNegativeOrRefuse) {
    return {
      thought: `哎呀，看样子刚才那个提议他并不买账——也对，强按头可不行，顺着他的意思改换方向吧。`,
      reply: isTsundere
        ? `*挑了挑眉打量你一眼，双手抱在胸前哼了一声，语气却顺着你的意思退了一步：*\n\n${greetingCall}行行行，听你的就是了，谁稀罕非按原计划走不可。既然你说「${topic || '不要'}」，那你说说看，现在打算怎么安排？`
        : `*听你这么直接地拒绝，${pronoun}先是微微一怔，随后忍不住笑出了声，干脆地把刚才的提议放到一边：*\n\n${greetingCall}好呀，既然你不喜欢那样，那我们就照你说的来！说说看，你现在更想做点什么，我都陪着你。`
    };
  }

  if (isQuestion) {
    const qCore = topic ? `「${topic}」` : '这件事';
    return {
      thought: `他忽然追问起${qCore}，还挺敏锐的……不能糊弄过去，得认真给个说法才行。`,
      reply: isTsundere
        ? `*听到你的发问，${pronoun}微微扬起下颌看了你两秒，似乎在斟酌怎么开口才不显得太刻意：*\n\n${greetingCall}你问${qCore}？……其实也没有你想得那么复杂。真要细说起来，大概是因为当时根本没料到你也会在意这种小细节吧。怎么，你对这个答案还满意？`
        : `*被你认真地这么一问，${pronoun}也收起了玩笑的神色，往前凑近半步看着你的眼睛：*\n\n${greetingCall}关于你问的${qCore}……其实我刚才也一直在琢磨。坦白讲，我现在心里最真实的想法就是想把眼前的事陪你一起弄明白，你觉得我的判断对不对？`
    };
  }

  if (isSweetOrConfess) {
    return {
      thought: `怎么突然说出这么直白的话……就算心里已经开心得不行，表面上也差点没绷住。`,
      reply: isPlayful
        ? `*听到这句话，${pronoun}眼睛一下子亮了起来，忍不住往前蹭了半步笑眯眯地盯着你：*\n\n${greetingCall}哇，这话可是你自己亲口说的哦！「${topic || '这句话'}」我可要用小本本记一辈子，不许偷偷反悔！`
        : `*脚步轻轻一停，${pronoun}转过头定定望向你，眼底那点平时藏得很深的温柔终于彻底漾开来：*\n\n${greetingCall}……你明明知道，听到你说「${topic || '这样的话'}」时，我是最没有抵抗力的。谢谢你愿意这么坦率地告诉我。`
    };
  }

  const memNote = memEcho ? `（顺便一提，我还记得你提过「${memEcho.content.replace(/^[^：]+：/, '')}」）` : '';
  const sceneText = directorNote && directorNote.trim() ? `眼下${directorNote.trim().slice(0, 24)}，` : '';
  const variants = [
    `*听完你说「${topic || clean.slice(0, 18)}」，${pronoun}眉梢微动，顺手接过话茬：*\n\n${greetingCall}原来你是这个意思啊——我还以为你会换个更保守的说法呢。${sceneText}${memNote}不过照你现在这个思路往下走，下一步我倒是想到一个挺有意思的切入点，要不要听听看？`,
    `*${pronoun}侧过脸认真听你把话说完，嘴角轻轻挑起一点笑意：*\n\n${greetingCall}「${topic || clean.slice(0, 18)}」……这话从你嘴里说出来，倒意外地很有说服力。${memNote}那接下来就按你的想法试试看吧，真出了什么岔子，有我兜着呢。`,
    `*神情松弛下来，${pronoun}朝你的方向挪近了些，目光顺着你的话继续往下探：*\n\n${greetingCall}难怪你刚才那么说，听到「${topic || clean.slice(0, 18)}」这一句，我算是彻底明白你的顾虑了。换作平时我肯定还要再犹豫两步，但今天既然有你在，我听你的判断。`
  ];
  return {
    thought: `听着${greetingCall ? greetingCall.replace(/[*，]/g, '') : '眼前人'}提到「${topic || clean.slice(0, 20)}」，心里一下明白了对方的真实想法，得顺着这份心意自然接上去。`,
    reply: variants[(clean.length + totalHistoryCount) % variants.length]
  };
}

async function streamSmartDemoEngine({
  persona,
  userNickname = '',
  nurturing,
  directorNote,
  triggeredLorebooks,
  recalledMemories,
  rollingSummary,
  latestUserText,
  totalHistoryCount = 1,
  enableThought,
  channelTier = 'demo',
  onReasoning,
  onContent,
  signal
}) {
  const shortName = persona.name.split(/[·\s]/)[0] || persona.name;
  const pronoun = inferPersonaPronoun(persona);
  const userText = (latestUserText || '').trim();
  const moodTag = nurturing?.current_mood || '✨ 专注倾听';

  let rememberedUserName =
    userNickname && !/^星[语屿]旅人/.test(String(userNickname).trim())
      ? String(userNickname).trim()
      : '';
  const nonPinnedFacts = [];
  for (const m of recalledMemories || []) {
    const nameMatch = m.content.match(/对方(?:自称|现在的名字叫)「([^」]+)」/);
    if (nameMatch && !rememberedUserName && !/^星[语屿]旅人/.test(nameMatch[1])) {
      rememberedUserName = nameMatch[1];
    }
    if (m.category !== 'Pinned') nonPinnedFacts.push(m.content);
  }

  const storySentences = (persona.backstory || '')
    .split(/[。！？\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 6 && !s.startsWith('【'));

  const hitLore = Array.isArray(triggeredLorebooks) && triggeredLorebooks.length > 0 ? triggeredLorebooks[0] : null;
  const isMemoryCheck = /我是谁|我叫什么|记得我|刚才说了什么|之前说的|还记得/.test(userText);
  const isAskBackstory = /你是谁|你的过去|你的故事|你的背景|经历|介绍一下你/.test(userText);

  let thoughtText = '';
  let replyText = '';
  const addressPrefix = rememberedUserName ? `「${rememberedUserName}」` : '眼前的人';
  const greetingCall = rememberedUserName ? `**${rememberedUserName}**，` : '';

  if (hitLore) {
    const loreClean = hitLore.content.replace(/^【[^】]+】：?/, '');
    thoughtText = `[心境：${moodTag}] ${addressPrefix}竟然敏锐地触碰到了「${hitLore.title}」的线索……`;
    replyText = `*听到你提起「${hitLore.title}」，${pronoun}动作微顿，目光专注地望向你。*\n\n${greetingCall}很少有人能察觉到这背后的隐情——${loreClean}\n\n知道了这些之后，你还想继续往下追问吗？`;
  } else if (isMemoryCheck) {
    thoughtText = `[心境：${moodTag}] ${addressPrefix}在考我的记性呢，当然记得清清楚楚。`;
    if (rememberedUserName || nonPinnedFacts.length > 0) {
      const detailStr = nonPinnedFacts.map((f) => f.replace(/^[^：]+：/, '')).join('，还有');
      replyText = `*忍不住弯起嘴角看你：*\n\n跟${shortName}待在一起还怕被忘记呀？${greetingCall}${detailStr ? `你提过的「${detailStr}」我都好好记在心里呢。` : '你的名字我可一直记在心上呢。'}`;
    } else {
      replyText = `*轻轻偏过头看你：*\n\n你还没正式把自己的名字交给我保管呢，怎么就先考起我来了？快告诉我，我想记住你。`;
    }
  } else if (isAskBackstory) {
    thoughtText = `[心境：${moodTag}] ${addressPrefix}想听听我的过往，那便认真说给对方听吧。`;
    replyText = `*目光柔了下来，顺势靠在近处开口：*\n\n既然你想听，那便说说吧——${storySentences.join('。') || persona.tagline}。${greetingCall}听完这些，接下来换你讲讲你自己的故事怎么样？`;
  } else {
    const respTurn = buildResponsiveDemoTurn({
      persona,
      pronoun,
      shortName,
      userText,
      greetingCall,
      recalledMemories: recalledMemories || [],
      directorNote,
      totalHistoryCount
    });
    thoughtText = `[心境：${moodTag}] ${respTurn.thought}`;
    replyText = respTurn.reply;
  }

  if (enableThought && thoughtText) {
    const chars = Array.from(thoughtText);
    for (let i = 0; i < chars.length; i += 2) {
      if (signal?.aborted) return;
      onReasoning(chars.slice(i, i + 2).join(''));
      await sleep(16);
    }
    await sleep(100);
  }

  const replyChars = Array.from(replyText);
  for (let i = 0; i < replyChars.length; i += 3) {
    if (signal?.aborted) return;
    onContent(replyChars.slice(i, i + 3).join(''));
    await sleep(15);
  }
}

async function streamHttpEndpoint({
  url,
  model,
  headers,
  messagesPayload,
  temperature,
  enableThought,
  onReasoning,
  onContent,
  signal
}) {
  const safeMessages = normalizeMessagesForStrictLLM(messagesPayload);
  let resolvedModel = model || 'deepseek-flash';
  const lowerUrl = String(url || '').toLowerCase();
  if (lowerUrl.includes('deepseek.com') && /^deepseek[-_]?v?4(?:\.1)?[-_]?flash$/i.test(resolvedModel)) {
    resolvedModel = 'deepseek-flash';
  }
  const isV4Flash = /deepseek-flash|v4(?:\.1)?[-_]?flash/i.test(resolvedModel);

  const reqBody = {
    model: resolvedModel,
    messages: safeMessages,
    stream: true,
    stream_options: { include_usage: true }
  };
  if (isV4Flash) {
    if (lowerUrl.includes('deepseek.com')) {
      reqBody.thinking = { type: enableThought ? 'enabled' : 'disabled' };
    } else if (lowerUrl.includes('siliconflow.cn') || lowerUrl.includes('aliyuncs.com')) {
      reqBody.enable_thinking = Boolean(enableThought);
    }
    if (!enableThought) {
      reqBody.temperature = Number(temperature) || 0.9;
    }
  } else if (resolvedModel !== 'deepseek-reasoner') {
    reqBody.temperature = Number(temperature) || 0.9;
  }

  let response = null;
  let lastFetchErr = null;
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (signal?.aborted) throw new Error('请求已取消');
    const connectAbort = new AbortController();
    const onOuterAbort = () => connectAbort.abort();
    signal?.addEventListener('abort', onOuterAbort, { once: true });
    const connectTimer = setTimeout(() => connectAbort.abort(new Error('CONNECT_TIMEOUT')), 28000);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...headers
        },
        body: JSON.stringify(reqBody),
        signal: connectAbort.signal
      });

      clearTimeout(connectTimer);
      signal?.removeEventListener('abort', onOuterAbort);

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        // 兼容不支持 stream_options 的第三方网关自动剥离重试
        if (res.status === 400 && reqBody.stream_options && /stream_options/i.test(errText)) {
          delete reqBody.stream_options;
          continue;
        }
        const isModelMissing =
          (res.status === 400 || res.status === 404) &&
          /model.*not.*found|does not exist|unknown model|invalid.*model/i.test(errText) &&
          /flash/i.test(String(reqBody.model || ''));
        if (isModelMissing && attempt < maxAttempts && !signal?.aborted) {
          reqBody.model = lowerUrl.includes('siliconflow.cn')
            ? (enableThought ? 'deepseek-ai/DeepSeek-R1' : 'deepseek-ai/DeepSeek-V3.2')
            : lowerUrl.includes('aliyuncs.com')
            ? (enableThought ? 'deepseek-r1' : 'deepseek-v3')
            : lowerUrl.includes('openrouter.ai')
            ? (enableThought ? 'deepseek/deepseek-r1' : 'deepseek/deepseek-chat')
            : (enableThought ? 'deepseek-reasoner' : 'deepseek-chat');
          delete reqBody.thinking;
          delete reqBody.enable_thinking;
          continue;
        }
        const retryable = [408, 429, 500, 502, 503, 504].includes(res.status);
        lastFetchErr = new Error(
          `在线模型网关返回异常 (${res.status}): ${errText.slice(0, 220) || res.statusText}`
        );
        if (retryable && attempt < maxAttempts && !signal?.aborted) {
          await sleep(600 * attempt);
          continue;
        }
        throw lastFetchErr;
      }

      if (!res.body) {
        throw new Error('在线网关未返回流式数据');
      }

      response = res;
      break;
    } catch (err) {
      clearTimeout(connectTimer);
      signal?.removeEventListener('abort', onOuterAbort);
      if (signal?.aborted) throw err;
      lastFetchErr = err;
      if (attempt < maxAttempts && !/返回异常 \(40[0134]\)/.test(String(err.message || ''))) {
        await sleep(650 * attempt);
        continue;
      }
      throw err;
    }
  }

  if (!response || !response.body) {
    throw lastFetchErr || new Error('在线网关连接失败');
  }

  const splitter = new StreamThinkSplitter({ onReasoning, onContent, enableThought });
  const decoder = new TextDecoder('utf-8');
  let lineBuffer = '';
  let capturedUsage = null;
  let actualModel = resolvedModel;

  const processLine = (rawLine) => {
    const line = rawLine.trim();
    if (!line) return;

    if (line.startsWith('data:')) {
      const dataStr = line.slice(5).trim();
      if (dataStr === '[DONE]') return;
      try {
        const parsed = JSON.parse(dataStr);
        if (parsed.model) actualModel = parsed.model;
        if (parsed.usage) capturedUsage = parsed.usage;
        const choice = parsed.choices && parsed.choices[0];
        const delta = (choice && (choice.delta || choice.message)) || {};
        if (delta.reasoning_content) {
          splitter.feedNativeReasoning(delta.reasoning_content);
        }
        if (delta.content) {
          splitter.feedContent(delta.content);
        }
      } catch {}
    } else if (line.startsWith('{')) {
      try {
        const parsed = JSON.parse(line);
        if (parsed.usage) capturedUsage = parsed.usage;
        if (parsed.choices && parsed.choices[0]?.message?.content) {
          splitter.feedContent(parsed.choices[0].message.content);
        }
      } catch {}
    }
  };

  for await (const chunk of response.body) {
    if (signal?.aborted) break;
    lineBuffer += decoder.decode(chunk, { stream: true });
    const lines = lineBuffer.split(/\r?\n/);
    lineBuffer = lines.pop() || '';
    for (const rawLine of lines) {
      processLine(rawLine);
    }
  }

  lineBuffer += decoder.decode();
  if (lineBuffer.trim()) {
    for (const rawLine of lineBuffer.split(/\r?\n/)) {
      processLine(rawLine);
    }
  }

  splitter.flush();

  let normalizedUsage = null;
  if (capturedUsage && typeof capturedUsage === 'object') {
    const promptTokens = Number(capturedUsage.prompt_tokens) || 0;
    const completionTokens = Number(capturedUsage.completion_tokens) || 0;
    const hitTokens =
      capturedUsage.prompt_cache_hit_tokens !== undefined
        ? Number(capturedUsage.prompt_cache_hit_tokens) || 0
        : Number(capturedUsage.prompt_tokens_details?.cached_tokens) || 0;
    const missTokens =
      capturedUsage.prompt_cache_miss_tokens !== undefined
        ? Number(capturedUsage.prompt_cache_miss_tokens) || 0
        : Math.max(0, promptTokens - hitTokens);
    const reasoningTokens =
      Number(capturedUsage.reasoning_tokens ?? capturedUsage.completion_tokens_details?.reasoning_tokens) || 0;
    normalizedUsage = {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: Number(capturedUsage.total_tokens) || promptTokens + completionTokens,
      prompt_cache_hit_tokens: hitTokens,
      prompt_cache_miss_tokens: missTokens,
      reasoning_tokens: reasoningTokens
    };
  }

  return {
    model: actualModel,
    simulated: false,
    usage: normalizedUsage
  };
}

async function streamPersonaChat({
  settings,
  contextBundle,
  latestUserText,
  onReasoning,
  onContent,
  signal
}) {
  const provider = settings.provider || 'demo';
  const enableThought = contextBundle.session.enable_inner_thought === 1;
  const temperature = parseFloat(settings.temperature || '0.85');

  if (provider === 'demo' || provider === 'antigravity' || provider === 'local_antigravity') {
    try {
      const handledByBridge = await tryStreamViaAntigravityBridge({
        channel: provider === 'demo' ? 'demo' : 'antigravity',
        contextBundle,
        temperature,
        enableThought,
        SplitterClass: StreamThinkSplitter,
        onReasoning,
        onContent,
        signal
      });
      if (handledByBridge) return;
    } catch (err) {
      if (signal?.aborted) return;
      if (provider !== 'demo') throw err;
    }

    await streamSmartDemoEngine({
      persona: contextBundle.persona,
      userNickname: contextBundle.userNickname,
      nurturing: contextBundle.nurturing,
      directorNote: contextBundle.session.session_prompt || contextBundle.session.director_note,
      triggeredLorebooks: contextBundle.triggeredLorebooks,
      recalledMemories: contextBundle.recalledMemories,
      rollingSummary: contextBundle.rollingSummary,
      latestUserText,
      totalHistoryCount: contextBundle.telemetry?.totalHistoryCount || 1,
      enableThought,
      onReasoning,
      onContent,
      signal
    });
    return;
  }

  if (provider === 'deepseek') {
    const ownKey = (settings.deepseek_api_key || '').trim();
    const platformKey = (process.env.PLATFORM_DEEPSEEK_API_KEY || '').trim();
    const effectiveKey = ownKey || platformKey;
    if (!effectiveKey) {
      try {
        const handledByBridge = await tryStreamViaAntigravityBridge({
          channel: 'deepseek',
          contextBundle,
          temperature,
          enableThought,
          SplitterClass: StreamThinkSplitter,
          onReasoning,
          onContent,
          signal
        });
        if (handledByBridge) return;
      } catch (err) {
        if (signal?.aborted) return;
      }

      await streamSmartDemoEngine({
        persona: contextBundle.persona,
        userNickname: contextBundle.userNickname,
        nurturing: contextBundle.nurturing,
        directorNote: contextBundle.session.session_prompt || contextBundle.session.director_note,
        triggeredLorebooks: contextBundle.triggeredLorebooks,
        recalledMemories: contextBundle.recalledMemories,
        rollingSummary: contextBundle.rollingSummary,
        latestUserText,
        totalHistoryCount: contextBundle.telemetry?.totalHistoryCount || 1,
        enableThought,
        channelTier: 'online_hosted',
        onReasoning,
        onContent,
        signal
      });
      return;
    }
    return await streamHttpEndpoint({
      url: (settings.deepseek_base_url || 'https://api.deepseek.com/v1/chat/completions').trim(),
      model: (settings.deepseek_model || 'deepseek-chat').trim(),
      headers: { Authorization: `Bearer ${effectiveKey}` },
      messagesPayload: contextBundle.messagesPayload,
      temperature,
      enableThought,
      onReasoning,
      onContent,
      signal
    });
  }

  if (provider === 'custom_gateway') {
    const url = (settings.custom_gateway_url || '').trim();
    const token = (settings.custom_gateway_token || '').trim();
    if (!token && (!url || url === 'https://api.openai.com/v1/chat/completions')) {
      try {
        const handledByBridge = await tryStreamViaAntigravityBridge({
          channel: 'custom_gateway',
          contextBundle,
          temperature,
          enableThought,
          SplitterClass: StreamThinkSplitter,
          onReasoning,
          onContent,
          signal
        });
        if (handledByBridge) return;
      } catch (err) {
        if (signal?.aborted) return;
      }

      await streamSmartDemoEngine({
        persona: contextBundle.persona,
        userNickname: contextBundle.userNickname,
        nurturing: contextBundle.nurturing,
        directorNote: contextBundle.session.session_prompt || contextBundle.session.director_note,
        triggeredLorebooks: contextBundle.triggeredLorebooks,
        recalledMemories: contextBundle.recalledMemories,
        rollingSummary: contextBundle.rollingSummary,
        latestUserText,
        totalHistoryCount: contextBundle.telemetry?.totalHistoryCount || 1,
        enableThought,
        channelTier: 'online_hosted',
        onReasoning,
        onContent,
        signal
      });
      return;
    }
    if (!url) {
      throw new Error('自定义在线网关地址不能为空，请在网关设置中填写完整的 HTTPS/HTTP 流式接口地址。');
    }
    const headers = {};
    if (token) {
      headers.Authorization = token.startsWith('Bearer ') ? token : `Bearer ${token}`;
    }
    if (settings.custom_gateway_headers) {
      try {
        const extra = JSON.parse(settings.custom_gateway_headers);
        if (extra && typeof extra === 'object') {
          Object.assign(headers, extra);
        }
      } catch {
        throw new Error('附加请求头 JSON 格式不正确，请检查网关设置。');
      }
    }
    return await streamHttpEndpoint({
      url,
      model: (settings.custom_gateway_model || 'default').trim(),
      headers,
      messagesPayload: contextBundle.messagesPayload,
      temperature,
      enableThought,
      onReasoning,
      onContent,
      signal
    });
  }

  throw new Error(`不支持的模型通道: ${provider}`);
}

module.exports = {
  streamPersonaChat
};

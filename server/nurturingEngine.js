const { db, genId } = require('./db');

function clampStat(val) {
  return Math.max(0, Math.min(100, Math.round(Number(val) || 0)));
}

function getTimePeriodSnapshot(now = new Date()) {
  const hour = now.getHours();
  if (hour >= 0 && hour < 5) {
    return { period: '深夜凌晨', key: 'late_night', energyHint: '夜深了，人容易犯困或卸下防备说真话' };
  }
  if (hour >= 5 && hour < 9) {
    return { period: '清晨', key: 'morning', energyHint: '刚醒不久，带着一点早起后的松弛或微倦' };
  }
  if (hour >= 9 && hour < 12) {
    return { period: '上午', key: 'forenoon', energyHint: '精力逐渐集中，手头常有点零碎事务' };
  }
  if (hour >= 12 && hour < 14) {
    return { period: '午间', key: 'noon', energyHint: '午休或刚吃完午饭，节奏略微懒散' };
  }
  if (hour >= 14 && hour < 18) {
    return { period: '午后', key: 'afternoon', energyHint: '午后时光容易走神，适合闲聊或晒太阳' };
  }
  if (hour >= 18 && hour < 22) {
    return { period: '傍晚夜晚', key: 'evening', energyHint: '一天忙完大半，适合放松吐槽或约着见面' };
  }
  return { period: '夜深', key: 'night', energyHint: '夜色静下来，语气会更柔和、私密一些' };
}

const WEATHER_OPTIONS = {
  morning: ['☀️ 晨光清朗 · 微风舒适', '🌤️ 多云微凉 · 空气清新', '🌫️ 晨雾薄凉 · 略带湿气', '🌧️ 清晨细雨 · 路面湿润'],
  forenoon: ['☀️ 晴朗微风 · 阳光正好', '⛅ 多云舒爽 · 不冷不热', '🌧️ 绵绵小雨 · 窗外滴答'],
  noon: ['☀️ 午阳温暖 · 微风轻拂', '🌤️ 晴间多云 · 略带暖意', '⛈️ 闷热阴沉 · 似要下雨'],
  afternoon: ['🌤️ 午后暖阳 · 懒洋洋的', '⛅ 阴云微风 · 凉意渐起', '🌧️ 午后阵雨 · 雨丝斜落', '⛈️ 雷雨骤至 · 窗外雨声哗啦'],
  evening: ['🌇 晚霞微醺 · 晚风温柔', '🌬️ 傍晚起风 · 微微发凉', '🌧️ 暮色细雨 · 街灯映水', '☁️ 阴沉微冷 · 夜色渐浓'],
  night: ['🌙 夜空清朗 · 微凉静谧', '🌬️ 晚风微寒 · 适合待在室内', '🌧️ 夜雨淅沥 · 窗玻璃起雾', '☁️ 多云夜静 · 空气微潮'],
  late_night: ['🌌 深夜静寂 · 夜露微凉', '🌧️ 深夜听雨 · 寒意渐重', '🌬️ 凌晨冷风 · 宜早点休息']
};

function detectWeatherFromUserText(text) {
  const s = String(text || '');
  if (!s) return '';
  if (/暴雨|雷阵雨|打雷|闪电|暴风雨|大雨/.test(s)) return '⛈️ 雷雨交加 · 窗外雨声急促';
  if (/下雨|细雨|小雨|淋雨|撑伞|打伞|雨夜|雨天/.test(s)) return '🌧️ 细雨绵绵 · 空气湿润微凉';
  if (/下雪|飘雪|大雪|好冷|冻死|寒潮|结冰/.test(s)) return '❄️ 寒风微凛 · 带着冬日冷意';
  if (/好热|闷热|晒死|大太阳|烈日/.test(s)) return '☀️ 晴热明亮 · 阳光有些晃眼';
  if (/晴天|出太阳|天气真好|万里无云|阳光/.test(s)) return '☀️ 晴朗微风 · 暖阳刚好';
  if (/刮风|起风|大风|好凉/.test(s)) return '🌬️ 晚风微凉 · 吹得衣角轻晃';
  if (/起雾|大雾/.test(s)) return '🌫️ 薄雾氤氲 · 视线朦胧';
  return '';
}

function buildDynamicCharacterState({ persona, weather, mood, timeInfo, userText = '' }) {
  const s = String(userText || '');
  const styleText = `${persona?.tagline || ''} ${persona?.personality || ''} ${persona?.backstory || ''}`;
  const isAncient = /古风|师尊|侯爷|少帅|殿下|剑尊|宗门|仙|世子|朝堂|江湖/.test(styleText);
  const isRainy = /雨|雾/.test(weather);
  const isCold = /寒|冷|凉|雪|风/.test(weather);
  const isSunny = /晴|暖阳|晨光|晚霞/.test(weather);
  const isTiredMood = /疲惫|犯困|微倦|垂眸|冷淡|撇嘴/.test(mood);
  const isHappyMood = /雀跃|愉悦|心跳|耳尖|宠溺|松弛/.test(mood);

  if (/早点睡|去睡|晚安|休息吧/.test(s)) {
    return isAncient ? '吹熄了案头半盏灯火，正准备歇息' : '刚洗漱完靠在床头，准备睡了';
  }
  if (/出门|出去|散步|逛逛|见面|吃饭|喝奶茶|喝咖啡/.test(s)) {
    return isAncient ? '刚理好袖口起身，准备随你出门走走' : '已经顺手拿起外套和钥匙，准备出门';
  }

  if (isAncient) {
    if (isRainy) return isTiredMood ? '独自坐在廊下听雨，指尖还留着茶盏余温' : '靠在雕花窗边看细雨落瓦檐，难得清闲';
    if (isCold) return '披了件外袍在手炉旁暖手，神色比平时更沉静几分';
    if (timeInfo.key === 'late_night' || timeInfo.key === 'night') return '案前灯影微晃，刚批完手头琐事，稍作歇息';
    if (isHappyMood && isSunny) return '难得兴致不错，站在庭院树影下乘凉';
    return '闲坐在一旁沏茶消磨光阴，听着你的动静';
  }

  if (isTiredMood || timeInfo.key === 'late_night') {
    return isRainy
      ? '靠在窗边听雨，眼皮有点沉，手里握着温水杯'
      : '刚忙完手头的事，靠在椅背上发呆，精力剩一半';
  }
  if (/冷淡|撇嘴/.test(mood)) {
    return '抱着胳膊靠在旁边刷手机，表面镇定其实心里挂着小脾气';
  }
  if (isRainy) {
    return isHappyMood
      ? '窝在室内听着窗外雨声，刚冲好热饮，心情懒洋洋的'
      : '被雨天困在屋里，随手翻着消息，有点懒得动弹';
  }
  if (isCold) {
    return '缩在暖和的外套里揣着手，鼻尖有点微凉';
  }
  if (isSunny && isHappyMood) {
    return '被好天气晒得心情挺轻快，闲不住地想拉你聊几句';
  }
  if (timeInfo.key === 'noon') return '刚解决完午饭，正犯食困慢悠悠歇着';
  if (timeInfo.key === 'evening') return '刚忙完今天的大半件事，卸下劲来松了口气';
  return '正闲着刷手机顺便等你消息，手边放着半杯水';
}

function pickRelatedEvent({ persona, weather, mood, stageLevel, userText = '', currentEvent = '', recalledMemories = [] }) {
  const styleText = `${persona?.tagline || ''} ${persona?.personality || ''} ${persona?.backstory || ''}`;
  const isAncient = /古风|师尊|侯爷|少帅|殿下|剑尊|宗门|仙|世子|朝堂|江湖/.test(styleText);
  const isRainy = /雨|雷/.test(weather);
  const isCold = /寒|冷|雪|风/.test(weather);
  const memSample = (recalledMemories || []).find(
    (m) => m && m.category !== 'Pinned' && m.slot_key !== 'scene_origin' && m.slot_key !== 'user_nickname'
  );

  // 若对话已主动回应当前事件或刚聊过相关词汇，允许自然结束旧事件
  if (currentEvent && userText) {
    const keywords = currentEvent.match(/[\u4e00-\u9fa5]{2,4}/g) || [];
    if (keywords.some((kw) => kw.length >= 2 && userText.includes(kw))) {
      return '';
    }
  }

  if (isAncient) {
    const ancientPool = [
      isRainy ? '廊下飞檐滴水溅湿了衣摆，正巧有只避雨的野雀落上栏杆' : '书案边压着一封刚拆开的旧信笺，墨迹还没干透',
      isCold ? '茶炉上的炭火快熄了，壶里的桂花茶还冒着最后一缕热气' : '院里那株花昨晚刚开了几朵，风一吹满袖清香',
      stageLevel >= 3 ? '袖中一直揣着上次你留下的小物件，刚才整理衣襟时滑了出来' : '刚巧有下人送来一碟还温热的酥点'
    ];
    return ancientPool[Math.floor(Math.random() * ancientPool.length)];
  }

  const modernPool = [];
  if (isRainy) {
    modernPool.push(
      '楼下便利店门口缩着一只躲雨的小橘猫，刚才顺手喂了半根火腿肠',
      '刚才下楼拿东西没带伞，发梢被雨丝打湿了一点',
      '窗外忽然劈过一道闷雷，屋里灯光跟着闪了半下'
    );
  }
  if (isCold) {
    modernPool.push(
      '路过面包店买了个刚出炉的热红薯/热拿铁，正好还烫手',
      '风太大把阳台上的空塑料瓶吹倒了，吓了一跳'
    );
  }
  if (memSample) {
    const cleanFact = String(memSample.content || '').replace(/^[^：]+：/, '').slice(0, 18);
    if (cleanFact) {
      modernPool.push(`刚才突然想起你之前提过的「${cleanFact}」，顺嘴有点好奇后续`);
    }
  }
  if (stageLevel >= 3) {
    modernPool.push(
      '刚才整理桌面翻出你之前顺手塞给我的小东西，忍不住看了两眼',
      '耳机里正好切到一首挺好听的歌，总觉得你会喜欢'
    );
  }
  modernPool.push(
    '点外卖的时候商家多送了一小份甜点，一个人吃不太完',
    '刚才差点把杯子里的水碰洒在桌上，手忙脚乱抢救了一下',
    '手机刚弹了一条有点离谱的热搜/群消息，正想找人吐槽两句',
    '刚才楼道里邻居家的狗突然叫了两声，紧接着安静下来'
  );
  if (/疲惫|犯困/.test(mood)) {
    modernPool.push('昨晚没太睡沉，刚才差点对着屏幕走神打瞌睡');
  }
  return modernPool[Math.floor(Math.random() * modernPool.length)];
}

function getRelationshipStage({ affection = 22, trust = 26, intimacy = 18 }) {
  const composite = Math.round(affection * 0.45 + trust * 0.35 + intimacy * 0.2);

  if (composite >= 80) {
    return {
      level: 4,
      badge: '命定挚爱 Lv.4',
      composite,
      playerDesc: '你们已经心意笃定、彼此信赖，TA 在你面前毫无保留，眼神与话语里满是独属于你的偏爱。',
      promptDirective:
        '【关系阶段：Lv.4 命定羁绊】你们早已彼此笃定。面对对方时毫无外人前的防备与客套，随口一两句就带着天然偏爱与默契，偶尔还会毫不掩饰地撒娇、护短或直白吐露心意。'
    };
  }
  if (composite >= 50) {
    return {
      level: 3,
      badge: '心意相通 Lv.3',
      composite,
      playerDesc: '你已走进 TA 心里最柔软的角落，TA 愿意向你袒露心事、偏心护短，相处亲近自然。',
      promptDirective:
        '【关系阶段：Lv.3 心意相通】对方已住进你心里。你会卸下伪装，在 TA 面前流露真实小脾气、护短偏心、口是心非或碎碎念，说话不用刻意端着。'
    };
  }
  if (composite >= 25) {
    return {
      level: 2,
      badge: '渐生好感 Lv.2',
      composite,
      playerDesc: 'TA 对你的好感正在悄悄升温，比初见时柔和了许多，总会不自觉留意你的冷暖与喜恶。',
      promptDirective:
        '【关系阶段：Lv.2 渐生情愫】对对方已有好感。比刚认识时松弛柔和不少，会接梗打趣、暗暗记挂对方的冷暖，但偶尔仍会嘴硬或留点小心思。'
    };
  }
  return {
    level: 1,
    badge: '初识破冰 Lv.1',
    composite,
    playerDesc: '刚刚相识的试探期，交谈间还带着几分礼貌与好奇，多聊聊彼此的喜好能让关系更快升温。',
    promptDirective:
      '【关系阶段：Lv.1 初遇试探】你们还处于初识阶段。不要一上来就莫名其妙深情长篇告白，请保持人设原本的边界感与分寸（高冷的继续惜字如金、慢热的略带客气试探），通过日常几句一来一回慢慢熟络。'
  };
}

function parseDiaryList(rawJson) {
  try {
    const arr = JSON.parse(rawJson || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function ensureAndEvolveWorldContext(session, persona = {}, userText = '', totalTurns = 0) {
  if (!session) {
    const t = getTimePeriodSnapshot();
    return {
      timePeriod: t.period,
      timeKey: t.key,
      energyHint: t.energyHint,
      weather: '🌤️ 多云微风 · 温度舒适',
      characterState: '正闲着，随手看着消息',
      activeEvent: '',
      changed: false
    };
  }

  const now = Date.now();
  const timeInfo = getTimePeriodSnapshot(new Date(now));
  const stage = getRelationshipStage({
    affection: session.affection ?? 22,
    trust: session.trust ?? 26,
    intimacy: session.intimacy ?? 18
  });

  let weather = String(session.world_weather || '').trim();
  let characterState = String(session.character_state || '').trim();
  let activeEvent = String(session.active_event || '').trim();
  let lastUpdated = Number(session.world_state_updated_at || 0);
  let changed = false;

  // 1. 玩家发言主动提及天气时立刻同步世界天气
  const userWeather = detectWeatherFromUserText(userText);
  if (userWeather && userWeather !== weather) {
    weather = userWeather;
    changed = true;
  } else if (!weather || (lastUpdated > 0 && now - lastUpdated > 35 * 60 * 1000)) {
    const pool = WEATHER_OPTIONS[timeInfo.key] || WEATHER_OPTIONS.afternoon;
    weather = pool[Math.floor(Math.random() * pool.length)];
    changed = true;
  }

  // 2. 人物状态初始化或按心情/时段/玩家动作自然演进
  const hasStateTrigger = /早点睡|去睡|晚安|休息吧|出门|出去|散步|逛逛|见面|吃饭|喝奶茶|喝咖啡|下雨|好冷|好热/.test(
    String(userText || '')
  );
  if (!characterState || hasStateTrigger || (lastUpdated > 0 && now - lastUpdated > 18 * 60 * 1000)) {
    const nextState = buildDynamicCharacterState({
      persona,
      weather,
      mood: session.current_mood || '温柔浅笑',
      timeInfo,
      userText
    });
    if (nextState && nextState !== characterState) {
      characterState = nextState;
      changed = true;
    }
  }

  // 3. 事件关联：约每 3~4 轮、初始空值或玩家刚聊完旧事件时自然流转一个贴合当前天气/好感的微事件
  let recentMems = [];
  try {
    recentMems = db
      .prepare('SELECT content, category, slot_key FROM memories WHERE session_id = ? AND superseded_by IS NULL ORDER BY updated_at DESC LIMIT 6')
      .all(session.id);
  } catch {}

  const shouldRollEvent =
    !activeEvent ||
    (userText && (totalTurns % 4 === 0 || (lastUpdated > 0 && now - lastUpdated > 25 * 60 * 1000)));
  if (shouldRollEvent) {
    const nextEvent = pickRelatedEvent({
      persona,
      weather,
      mood: session.current_mood || '温柔浅笑',
      stageLevel: stage.level,
      userText,
      currentEvent: activeEvent,
      recalledMemories: recentMems
    });
    if (nextEvent !== activeEvent) {
      activeEvent = nextEvent;
      changed = true;
    }
  }

  if (changed && session.id) {
    try {
      db.prepare(`
        UPDATE sessions
        SET world_weather = ?, character_state = ?, active_event = ?, world_state_updated_at = ?
        WHERE id = ?
      `).run(weather, characterState, activeEvent, now, session.id);
      session.world_weather = weather;
      session.character_state = characterState;
      session.active_event = activeEvent;
      session.world_state_updated_at = now;
    } catch {}
  }

  return {
    timePeriod: timeInfo.period,
    timeKey: timeInfo.key,
    energyHint: timeInfo.energyHint,
    weather,
    characterState,
    activeEvent,
    changed
  };
}

/**
 * 动态“活人味”回复节奏控制器：
 * 结合用户输入篇幅/情绪 + 人物心情 + 好感度阶段 + 当前状态 + 天气 + 事件关联，决定本轮该短则短、该长才长。
 */
function computeDynamicReplyPacing({
  session,
  persona,
  nurturing,
  worldContext,
  userText = '',
  hasTriggeredLore = false,
  hasRecalledMemories = false,
  isCharacterChat = false
}) {
  const cleanUser = String(userText || '').replace(/\*[^*]*\*/g, '').trim();
  const userLen = cleanUser.replace(/\s+/g, '').length;
  const mood = String(nurturing?.current_mood || session?.current_mood || '温柔浅笑');
  const stageLevel = Number(nurturing?.stage?.level || 1);
  const stateStr = String(worldContext?.characterState || session?.character_state || '');
  const weatherStr = String(worldContext?.weather || session?.world_weather || '');
  const eventStr = String(worldContext?.activeEvent || session?.active_event || '');
  const styleHint = `${persona?.personality || ''} ${persona?.speaking_style || ''}`;
  const isTaciturn = /高冷|清冷|禁欲|寡言|毒舌|傲娇|慢热/.test(styleHint);

  const isDeepTopic =
    userLen >= 34 ||
    hasTriggeredLore ||
    /为什么|怎么回事|发生了什么|你的过去|你的故事|秘密|约定|怎么了|发生啥|难过|委屈|压力|失眠|喜欢你|告白|认真/.test(
      cleanUser
    );
  const isBriefPing =
    userLen <= 9 &&
    !/[？?]$/.test(cleanUser) &&
    !/为什么|怎么|故事|讲讲|说说|秘密/.test(cleanUser);
  const isLowEnergyOrCoolMood = /冷淡|撇嘴|疲惫|犯困|微倦|垂眸|打瞌睡|困/.test(mood + ' ' + stateStr);
  const isExcitedMood = /雀跃|心跳|耳尖|愉悦|欢快|分享|吐槽/.test(mood + ' ' + eventStr);

  // 如果用户明确提到了天气、状态或事件里的某件事，标记本轮需要“顺势接住关联”
  const eventKeywords = (eventStr.match(/[\u4e00-\u9fa5]{2,4}/g) || []).filter((w) => w.length >= 2);
  const userTouchesEvent = eventKeywords.some((kw) => cleanUser.includes(kw));
  const userTouchesWeather = /雨|雪|风|冷|热|晒|天气|伞|降温/.test(cleanUser);

  let mode = 'casual';
  let minChars = 22;
  let maxChars = 65;
  let sentenceGuide = '1~2句';
  let styleNote = '';

  if (isDeepTopic) {
    mode = 'deep';
    minChars = isCharacterChat ? 55 : 75;
    maxChars = isCharacterChat ? 135 : 175;
    sentenceGuide = '3~4句';
    styleNote =
      '对方抛出了走心话题、长段倾诉或触发了核心设定/关键回忆，请真正把话聊透、接住情绪与事件因果，有细节也有温度，但仍禁止堆砌空洞废话。';
  } else if (isLowEnergyOrCoolMood && userLen <= 20) {
    mode = 'brief';
    minChars = 6;
    maxChars = 28;
    sentenceGuide = '仅1句短话（甚至三五个字）';
    styleNote =
      `你此刻状态/心情偏向「${mood} / ${stateStr}」，话不想多说，就像真人在累、犯困或闹小别扭时那样言简意赅、留白带点小情绪，绝对不要凑长段落！`;
  } else if (isBriefPing && !userTouchesEvent && Math.random() < (isTaciturn || stageLevel === 1 ? 0.78 : 0.55)) {
    mode = 'brief';
    minChars = 5;
    maxChars = 28;
    sentenceGuide = '仅1句极简短句';
    styleNote =
      '对方只发来一句极短的日常招呼或随口一说，真人绝对不会回一大段！直接用 1 句干净利落的话接住即可（可以不写动作，或只写极简 4~8 字微神态），把聊天留给一来一回。';
  } else if (
    (stageLevel >= 3 && (isExcitedMood || userTouchesEvent || hasRecalledMemories)) ||
    userLen >= 18
  ) {
    mode = 'normal';
    minChars = 40;
    maxChars = isCharacterChat ? 95 : 115;
    sentenceGuide = '2~3句';
    styleNote =
      '当下氛围顺畅且有具体可聊的事件或情绪，可以自然聊开 2~3 句，顺嘴带出眼下的天气/手头状态或刚发生的小事，像活人一样有来有往。';
  } else {
    mode = 'casual';
    minChars = 16;
    maxChars = isCharacterChat ? 55 : 68;
    sentenceGuide = '1~2句';
    styleNote =
      '保持日常随聊节奏：1~2 句轻快收住即可，偶尔可顺带吐槽天气、提一句手头在干嘛，绝不写成小作文。';
  }

  const contextHints = [];
  if (userTouchesWeather || /雨|雪|冷|热|风/.test(weatherStr)) {
    contextHints.push(`天气影响（${weatherStr}）`);
  }
  if (eventStr && (userTouchesEvent || mode !== 'brief')) {
    contextHints.push(`当前小事件（${eventStr}）`);
  }

  const promptDirective = [
    `## 本轮「活人感」篇幅与节奏铁律（务必严格执行，打破AI长文模板）`,
    `- **本轮篇幅档位**：\`${mode.toUpperCase()}\` —— **总字数严格控制在 ${minChars}~${maxChars} 字（${sentenceGuide}）**，宁短勿长、禁止注水！`,
    `- **节奏依据**：${styleNote}`,
    `- **五维状态自然联动**（严禁生硬念状态词，要像真人一样顺势流露）：`,
    `  1) **心情**：${mood}（决定你这句的语气温度：开心就松弛爱接梗，疲惫/犯困就懒洋洋短句，略冷淡/撇嘴就带点小别扭或惜字如金）。`,
    `  2) **好感度**：${nurturing?.stage?.badge || '初识破冰 Lv.1'}（${stageLevel <= 1 ? '保持分寸与克制，别突然自来熟长篇大论' : stageLevel === 2 ? '微带好感但留点矜持' : '亲近自然，敢吐槽、偏心或直白露情绪'}）。`,
    `  3) **人物状态**：${stateStr || '正常闲聊中'}（说话语气受此刻在做的事/精力影响）。`,
    `  4) **天气与时段**：${worldContext?.timePeriod || '此刻'} · ${weatherStr}（下雨/降温/夜深时自然顺口关心或懒散几句，晴天可轻快些）。`,
    eventStr
      ? `  5) **关联事件**：${eventStr}（若契合当前对话，可像真人随口分享或抱怨那样自然带上一嘴，或作为话题引子；若对方正聊别的事，不必强塞）。`
      : `  5) **记忆与事件关联**：顺着对话前情自然回应，若能自然接上过往记忆细节会更有真实感。`,
    isCharacterChat
      ? `- **表达格式**：纯口语短消息，禁止 \`*动作*\` 和小说体旁白。`
      : `- **去八股排版提醒**：不要每轮都固定写“*环境+微动作* + 一大段台词 + 二选一反问”！当本轮字数要求很短时，**可以直接只说一句带引号的话，或极简 4~10 字微动作 + 1 句短话**，不要硬凑画面描写。`
  ].join('\n');

  return {
    mode,
    minChars,
    maxChars,
    sentenceGuide,
    contextHints,
    promptDirective
  };
}

function formatNurturingSnapshot(session) {
  const affection = clampStat(session.affection ?? 22);
  const trust = clampStat(session.trust ?? 26);
  const intimacy = clampStat(session.intimacy ?? 18);
  const stage = getRelationshipStage({ affection, trust, intimacy });
  const timeInfo = getTimePeriodSnapshot();
  return {
    affection,
    trust,
    intimacy,
    current_mood: session.current_mood || '温柔浅笑',
    character_state: session.character_state || '',
    world_weather: session.world_weather || '',
    active_event: session.active_event || '',
    time_period: timeInfo.period,
    stage,
    secret_diary: parseDiaryList(session.secret_diary)
  };
}

/**
 * 根据本轮玩家输入动态演进角色的情感维度与实时心境、天气、状态、事件（拒绝机械每句 +1）
 */
function evaluateTurnNurturing(sessionId, userText) {
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
  if (!session) return null;

  const text = String(userText || '').trim();
  const plainLen = text.replace(/[\s\p{P}*＊]/gu, '').length;
  const prevMood = session.current_mood || '温柔浅笑';
  const stageBefore = getRelationshipStage({
    affection: session.affection ?? 22,
    trust: session.trust ?? 26,
    intimacy: session.intimacy ?? 18
  });

  let dAff = 0;
  let dTrust = 0;
  let dInt = 0;
  let reason = '';
  let nextMood = prevMood;

  // 反刷分防抖
  let isSpamOrDuplicate = false;
  try {
    const recentUsers = db
      .prepare("SELECT content, created_at FROM messages WHERE session_id = ? AND role = 'user' ORDER BY id DESC LIMIT 2")
      .all(sessionId);
    if (recentUsers.length >= 2) {
      const cur = recentUsers[0];
      const prev = recentUsers[1];
      const dt = Math.abs((cur.created_at || 0) - (prev.created_at || 0));
      const normA = String(cur.content || '').replace(/\s+/g, '').slice(0, 40);
      const normB = String(prev.content || '').replace(/\s+/g, '').slice(0, 40);
      if ((dt < 15000 && normA && normA === normB) || (dt < 8000 && plainLen > 45 && normA.slice(0, 12) === normB.slice(0, 12))) {
        isSpamOrDuplicate = true;
      }
    }
  } catch {}

  const hour = new Date().getHours();
  const isLateNight = hour >= 23 || hour < 5;

  if (/滚|烦死|闭嘴|真无聊|讨厌你|别烦我/.test(text)) {
    dAff = stageBefore.level >= 3 ? -1 : -2;
    dTrust = -1;
    dInt = 0;
    nextMood = stageBefore.level >= 3 ? '😒 嘴硬别扭' : '🌫️ 略显冷淡';
    reason = '话语带刺让气氛有些变冷';
  } else if (/^(?:嗯+|哦+|行吧|随便|无所谓|啊\?|？+|\.+)$/.test(text)) {
    dAff = 0;
    dTrust = 0;
    dInt = 0;
    nextMood = stageBefore.level >= 3 ? '🤨 微微撇嘴' : '🌫️ 略显冷淡';
  } else if (/(?:\*[^*]*(?:牵|抱|靠|拉住|挽|蹭|摸|握|凝视|凑近|轻触)[^*]*\*)|喜欢你|想你了|好温柔|陪着我|心动|离不开/.test(text)) {
    dAff = 3;
    dInt = 2;
    reason = '亲昵互动让心动升温';
    nextMood = '💓 耳尖微热';
  } else if (/送你|给你带|请你吃|尝尝|多穿|注意身体|别太累|心疼你|替你|照顾好|早点睡|盖好/.test(text)) {
    dAff = 2;
    dTrust = 2;
    reason = '贴心关怀拉近信任';
    nextMood = '🌸 温柔松弛';
  } else if (/难过|委屈|不开心|害怕|累了|秘密|只告诉你|拉勾|约定|答应我|相信你|失眠/.test(text)) {
    dTrust = 3;
    dInt = 2;
    reason = '坦诚心事加深羁绊';
    nextMood = '🥺 心疼护短';
  } else if (/哈哈|笑死|搞笑|笨蛋|打赌|骗人|吃醋|故意|哼|坏心眼|试探|猜猜/.test(text)) {
    dAff = 1;
    dInt = 2;
    reason = '默契打趣拉近距离';
    nextMood = '🦊 愉悦打趣';
  } else if (/好开心|太棒|发财|请客|好天气|出去玩|真好吃|开心/.test(text)) {
    dAff = 1;
    dInt = 1;
    reason = '轻快分享感染情绪';
    nextMood = '☀️ 眉眼雀跃';
  } else if (/\*[^*]{2,}\*/.test(text) || plainLen >= 18) {
    dTrust = 1;
    dInt = plainLen >= 30 ? 1 : 0;
    reason = '认真交流增进了解';
    nextMood = isLateNight ? '🌙 夜色温柔' : '✨ 专注倾听';
  } else {
    nextMood = isLateNight ? '😪 略微犯困' : prevMood && !/冷淡|撇嘴/.test(prevMood) ? prevMood : '☕ 闲适随聊';
  }

  if (isSpamOrDuplicate) {
    dAff = 0;
    dTrust = 0;
    dInt = 0;
    reason = '';
  }

  const newAff = clampStat((session.affection ?? 22) + dAff);
  const newTrust = clampStat((session.trust ?? 26) + dTrust);
  const newInt = clampStat((session.intimacy ?? 18) + dInt);

  db.prepare(`
    UPDATE sessions
    SET affection = ?, trust = ?, intimacy = ?, current_mood = ?, updated_at = ?
    WHERE id = ?
  `).run(newAff, newTrust, newInt, nextMood, Date.now(), sessionId);

  let persona = {};
  try {
    persona = db.prepare('SELECT * FROM personas WHERE id = ?').get(session.persona_id) || {};
  } catch {}
  let totalTurns = 0;
  try {
    totalTurns = Number(db.prepare('SELECT COUNT(*) AS cnt FROM messages WHERE session_id = ?').get(sessionId)?.cnt || 0);
  } catch {}

  const updatedAfterMood = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
  const worldCtx = ensureAndEvolveWorldContext(updatedAfterMood, persona, text, totalTurns);
  const updated = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);

  return {
    deltas: { affection: dAff, trust: dTrust, intimacy: dInt },
    prev_mood: prevMood,
    mood_changed: Boolean(nextMood && nextMood !== prevMood),
    world_changed: Boolean(worldCtx.changed),
    reason,
    snapshot: formatNurturingSnapshot(updated)
  };
}

/**
 * 梦境记忆整理周期（Sleep Consolidation）与角色私密心动手账生成
 */
function runDreamConsolidation({ sessionId, persona, userNickname }) {
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
  if (!session) throw new Error('未找到会话');

  const shortName = (persona.name || '角色').split(/[·\s]/)[0];
  const allMems = db
    .prepare('SELECT * FROM memories WHERE session_id = ? AND superseded_by IS NULL ORDER BY importance DESC, updated_at DESC')
    .all(sessionId);

  const seenNormalized = new Map();
  let mergedCount = 0;
  let reinforcedCount = 0;

  const delStmt = db.prepare('DELETE FROM memories WHERE id = ?');
  const boostStmt = db.prepare(
    'UPDATE memories SET strength = MIN(12.0, strength + 1.2), pinned = CASE WHEN recall_count >= 4 THEN 1 ELSE pinned END WHERE id = ?'
  );

  for (const m of allMems) {
    const key = (m.slot_key || m.content.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '').slice(0, 18)).toLowerCase();
    if (seenNormalized.has(key) && m.pinned !== 1) {
      delStmt.run(m.id);
      mergedCount += 1;
    } else {
      seenNormalized.set(key, m.id);
      if ((m.recall_count || 0) >= 1 || m.importance >= 4) {
        boostStmt.run(m.id);
        reinforcedCount += 1;
      }
    }
  }

  const recentUserMsgs = db
    .prepare("SELECT content FROM messages WHERE session_id = ? AND role = 'user' ORDER BY id DESC LIMIT 3")
    .all(sessionId);

  const cleanNick = String(userNickname || '').trim();
  const isDefaultGuest = !cleanNick || /^星[语屿]旅人/.test(cleanNick);
  const callName = isDefaultGuest ? '那个人' : `「${cleanNick}」`;
  const snapshot = formatNurturingSnapshot(session);
  const recentQuote = recentUserMsgs[0]?.content
    ? `尤其是${callName}刚才对我说「${recentUserMsgs[0].content.replace(/\s+/g, ' ').slice(0, 28)}」的时候，`
    : `回想刚才和${callName}待在一起的片刻，`;

  const nonPinnedFact = allMems.find((m) => m.category !== 'Pinned');
  const rawFactBody = nonPinnedFact
    ? nonPinnedFact.content.replace(/^[^：]+：/, '').replace(/[。！？.!?…\s]+$/g, '')
    : '';
  const factMention = rawFactBody
    ? `我又在日记里把这件事认真记了下来——${rawFactBody}。`
    : '关于对方的每一个小习惯，我都想慢慢收集齐全。';
  const weatherMention = snapshot.world_weather ? `外面是${snapshot.world_weather.replace(/^[^\u4e00-\u9fa5]+/, '').trim()}，` : '';

  let diaryTone = '';
  if (snapshot.stage.level >= 3) {
    diaryTone = `${weatherMention}${recentQuote}心跳比平时快了半拍。${factMention}其实我比表面看起来更贪心一点，希望往后的每一个夜晚，推门进来的人都只会是${callName}。`;
  } else if (snapshot.stage.level === 2) {
    diaryTone = `${weatherMention}${recentQuote}竟有些舍不得对话太快结束。${factMention}不知道下次见面时，${callName}会不会察觉到我藏在目光里的偏爱？`;
  } else {
    diaryTone = `${weatherMention}${recentQuote}原本平静的日常忽然泛起了一点温柔的涟漪。${factMention}属于我们两个人的故事，似乎才刚刚翻开序章。`;
  }

  const nowDate = new Date();
  const dateStr = `${nowDate.getMonth() + 1}月${nowDate.getDate()}日 ${String(
    nowDate.getHours()
  ).padStart(2, '0')}:${String(nowDate.getMinutes()).padStart(2, '0')} · ${shortName}的私密手札`;

  const diaryList = parseDiaryList(session.secret_diary);
  const newEntry = {
    id: genId('diary'),
    date: dateStr,
    mood: snapshot.current_mood,
    stage_badge: snapshot.stage.badge,
    content: diaryTone
  };
  diaryList.unshift(newEntry);
  const trimmedDiary = diaryList.slice(0, 12);

  const nextIntimacy = clampStat((session.intimacy ?? 18) + 3);
  const dreamTs = Date.now();
  db.prepare(`
    UPDATE sessions SET secret_diary = ?, intimacy = ?, last_dream_at = ?, updated_at = ? WHERE id = ?
  `).run(JSON.stringify(trimmedDiary), nextIntimacy, dreamTs, dreamTs, sessionId);

  const refreshed = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
  return {
    merged_count: mergedCount,
    reinforced_count: reinforcedCount,
    new_diary: newEntry,
    nurturing: formatNurturingSnapshot(refreshed)
  };
}

module.exports = {
  getRelationshipStage,
  getTimePeriodSnapshot,
  ensureAndEvolveWorldContext,
  computeDynamicReplyPacing,
  formatNurturingSnapshot,
  evaluateTurnNurturing,
  runDreamConsolidation
};

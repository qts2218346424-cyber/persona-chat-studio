/**
 * 实时陪伴立绘生成与情景温馨提醒引擎
 * 严格围绕「❄️ 高冷系」与「🐾 可爱系」双审美维度构建
 */

const COMPANION_SKINS = {
  cool_silver: {
    key: 'cool_silver',
    mode: 'cool',
    isFemale: false,
    label: '❄️ 高冷清隽 · 银发星眸',
    img: '/assets/companions/cool_silver_cutout.png',
    aura: 'rgba(155, 135, 245, 0.45)',
    particle: '✦'
  },
  cool_dark: {
    key: 'cool_dark',
    mode: 'cool',
    isFemale: false,
    label: '🥀 高冷禁欲 · 金丝墨发',
    img: '/assets/companions/cool_dark_cutout.png',
    aura: 'rgba(226, 85, 157, 0.42)',
    particle: '✧'
  },
  cool_lady: {
    key: 'cool_lady',
    mode: 'cool',
    isFemale: true,
    label: '👠 高冷清艳 · 冰山御姐',
    img: '/assets/companions/cool_lady_cutout.png',
    aura: 'rgba(192, 132, 252, 0.48)',
    particle: '✦'
  },
  cute_boy: {
    key: 'cute_boy',
    mode: 'cute',
    isFemale: false,
    label: '🐾 元气可爱 · 猫耳少年',
    img: '/assets/companions/cute_boy_cutout.png',
    aura: 'rgba(244, 114, 182, 0.48)',
    particle: '♡'
  },
  cute_girl: {
    key: 'cute_girl',
    mode: 'cute',
    isFemale: true,
    label: '🍓 甜美元气 · 灵动少女',
    img: '/assets/companions/cute_girl_cutout.png',
    aura: 'rgba(251, 113, 133, 0.48)',
    particle: '♡'
  },
  cute_chibi: {
    key: 'cute_chibi',
    mode: 'cute',
    isFemale: true,
    label: '🌸 软萌可爱 · 兔耳团子',
    img: '/assets/companions/cute_chibi_cutout.png',
    aura: 'rgba(251, 146, 60, 0.42)',
    particle: '❀'
  }
};

const KNOWN_FEMALE_PERSONA_IDS = new Set([
  'persona_suwanqing',
  'persona_yunzhiyao',
  'persona_xia_ningmeng',
  'persona_yan_feiyu',
  'persona_nagisa_sakura',
  'persona_kagaribi_kyou',
  'persona_ichinose_kotomi',
  'persona_makise_sei',
  'persona_asagiri_mio',
  'persona_violet_eve'
]);

const KNOWN_MALE_PERSONA_IDS = new Set([
  'persona_shenxinghui',
  'persona_luchen',
  'persona_xieqingyan',
  'persona_jiangyubai',
  'persona_jiran',
  'persona_guxiuyuan',
  'persona_hodgins_landon',
  'persona_frieren_shuer',
  'persona_stark_fer'
]);

function detectFemalePersona(persona) {
  const explicitGender = String(persona?.gender || '').trim().toLowerCase();
  if (explicitGender === 'female' || explicitGender === '女' || explicitGender === 'f') return true;
  if (explicitGender === 'male' || explicitGender === '男' || explicitGender === 'm') return false;

  const pid = String(persona?.id || '').trim();
  if (KNOWN_FEMALE_PERSONA_IDS.has(pid)) return true;
  if (KNOWN_MALE_PERSONA_IDS.has(pid)) return false;

  const text = `${persona?.name || ''} ${persona?.category_tag || ''} ${persona?.tagline || ''} ${
    persona?.personality || ''
  } ${persona?.greeting || ''} ${persona?.backstory || ''}`;
  const avatar = String(persona?.avatar || '');

  if (/女执政官|神女|师姐|学妹|学姐|御姐|甜妹|歌姬|大小姐|巫女|修女|女王|公主|名伶|女家主|女生|女性|女主|闺蜜|青梅.*少女/.test(text)) {
    return true;
  }
  if (/男主|学弟|小狼狗|少帅|公子|剑尊|青年|竹马|爹系|联姻家主|少年|男生|男性|绅士|少年剑士|审信官|所长/.test(text)) {
    return false;
  }
  if (/少女|女孩|女子|双马尾|红裙|流仙裙|长裙|裙角|裙摆/.test(text)) {
    return true;
  }
  const sheCount = (text.match(/她/g) || []).length;
  const heCount = (text.match(/他/g) || []).length;
  if (sheCount > heCount) return true;
  if (heCount > sheCount) return false;
  if (/[👧👩💃👸🧚‍♀️🧜‍♀️👠🎀👙👚🌸🍓🌷🌺]/.test(avatar) && /[妍婷薇柔婉菲瑶晴柠汐琴奈澪琳樱雪莉娜茜媛妃姝娴]/.test(persona?.name || '')) {
    return true;
  }
  if (/[妍婷薇柔婉菲瑶晴柠汐琴奈澪琳樱雪莉娜茜媛妃姝娴]/.test(persona?.name || '')) {
    return true;
  }
  return false;
}

/**
 * 根据角色人设文本与玩家指定气质，实时推演生成陪伴立绘与专属声线配置（支持男女角色双轨自适应）
 */
function resolveOrGenerateCompanion({
  persona,
  currentConfig,
  requestedMode,
  requestedSkin,
  customImg,
  requestedVoice
}) {
  const combinedText = `${persona?.name || ''} ${persona?.category_tag || ''} ${persona?.tagline || ''} ${
    persona?.personality || ''
  } ${persona?.backstory || ''}`;
  const isFemale = detectFemalePersona(persona);

  // 1. 决定高冷/成熟 (cool) 还是元气可爱 (cute)
  const KNOWN_CUTE_IDS = new Set([
    'persona_jiran',
    'persona_stark_fer',
    'persona_xia_ningmeng',
    'persona_nagisa_sakura',
    'persona_asagiri_mio'
  ]);
  const KNOWN_COOL_IDS = new Set([
    'persona_shenxinghui',
    'persona_luchen',
    'persona_xieqingyan',
    'persona_jiangyubai',
    'persona_guxiuyuan',
    'persona_hodgins_landon',
    'persona_frieren_shuer',
    'persona_suwanqing',
    'persona_yunzhiyao',
    'persona_yan_feiyu',
    'persona_makise_sei',
    'persona_violet_eve'
  ]);
  const pidForMode = String(persona?.id || '').trim();
  let mode = requestedMode || currentConfig?.mode || '';
  if (mode !== 'cool' && mode !== 'cute') {
    if (KNOWN_COOL_IDS.has(pidForMode)) {
      mode = 'cool';
    } else if (KNOWN_CUTE_IDS.has(pidForMode)) {
      mode = 'cute';
    } else {
      const traitText = `${persona?.name || ''} ${persona?.category_tag || ''} ${persona?.tagline || ''} ${
        persona?.personality || ''
      }`;
      const isMatureCool = /家主|掌权者|执政官|剑尊|师尊|师姐|神女|侯爷|歌姬|爹系|沉稳|禁欲|高冷|清冷/.test(traitText);
      const isNaturallyCute = /少年|学弟|学妹|双马尾|甜妹|小狼狗|撒娇|可爱|活泼|阳光|元气|小梨涡/.test(traitText);
      mode = !isMatureCool && isNaturallyCute ? 'cute' : 'cool';
    }
  }

  // 2. 决定具体皮肤（严格贴合角色性别，除非玩家显式手动切换指定皮肤）
  let skinKey = requestedSkin || '';
  if (!skinKey || !COMPANION_SKINS[skinKey]) {
    const prevKey = currentConfig?.skinKey || '';
    const prevSkin = COMPANION_SKINS[prevKey];
    const genderCompatible =
      prevSkin &&
      prevSkin.mode === mode &&
      (isFemale
        ? prevKey === 'cool_lady' || prevKey === 'cute_girl' || prevKey === 'cute_chibi'
        : prevKey !== 'cool_lady' && prevKey !== 'cute_girl');

    if (genderCompatible && !requestedMode) {
      skinKey = prevKey;
    } else if (isFemale) {
      skinKey = mode === 'cool' ? 'cool_lady' : 'cute_girl';
    } else if (mode === 'cool') {
      const preferSilver = /星|雪|霜|仙|剑尊|白塔|银|清冷|月光/.test(combinedText);
      skinKey = preferSilver ? 'cool_silver' : 'cool_dark';
    } else {
      skinKey = 'cute_boy';
    }
  }

  const baseSkin = COMPANION_SKINS[skinKey] || (isFemale ? COMPANION_SKINS.cool_lady : COMPANION_SKINS.cool_silver);
  const finalImg = customImg !== undefined ? customImg : currentConfig?.customImg || '';

  // 3. 决定专属商业声线（6大男主「一人一专属 CV 声纹」+ 女主高冷御姐/元气甜妹/软萌团子）
  const PERSONA_EXCLUSIVE_VOICE = {
    persona_shenxinghui: 'otome_gentle',
    persona_frieren_shuer: 'otome_gentle',
    persona_luchen: 'otome_boss',
    persona_jiangyubai: 'otome_cool',
    persona_xieqingyan: 'otome_fox',
    persona_jiran: 'otome_sunny',
    persona_stark_fer: 'otome_sunny',
    persona_guxiuyuan: 'otome_daddy',
    persona_hodgins_landon: 'otome_daddy',
    persona_suwanqing: 'otome_queen',
    persona_yunzhiyao: 'otome_sister',
    persona_yan_feiyu: 'otome_queen',
    persona_xia_ningmeng: 'cute_sweet'
  };

  const pid = String(persona?.id || '').trim();
  const isFox = /腹黑|狐狸|公子|折扇|调侃|谢清晏|风流|小侯爷/.test(combinedText);
  const isDaddy = /爹系|家主|联姻|叔|沉稳|顾修远|局长|霍金斯/.test(combinedText);
  const isGentle = /温柔|骑士|星轨|白月光|沈星回|治愈|竹马/.test(combinedText);

  let inferredMaleCoolVoice = 'otome_cool';
  if (isFox) inferredMaleCoolVoice = 'otome_fox';
  else if (isDaddy) inferredMaleCoolVoice = 'otome_daddy';
  else if (isGentle) inferredMaleCoolVoice = 'otome_gentle';
  else if (baseSkin.key === 'cool_dark') inferredMaleCoolVoice = 'otome_boss';

  const defaultSkinVoice = {
    cool_silver:
      PERSONA_EXCLUSIVE_VOICE[pid] && !isFemale
        ? PERSONA_EXCLUSIVE_VOICE[pid]
        : inferredMaleCoolVoice,
    cool_dark:
      PERSONA_EXCLUSIVE_VOICE[pid] && !isFemale
        ? PERSONA_EXCLUSIVE_VOICE[pid]
        : isFox
        ? 'otome_fox'
        : isDaddy
        ? 'otome_daddy'
        : 'otome_boss',
    cool_lady: PERSONA_EXCLUSIVE_VOICE[pid] === 'otome_sister' ? 'otome_sister' : 'otome_queen',
    cute_boy: 'otome_sunny',
    cute_girl: 'cute_sweet',
    cute_chibi: 'cute_mochi'
  }[baseSkin.key] || (isFemale ? 'otome_queen' : PERSONA_EXCLUSIVE_VOICE[pid] || 'otome_cool');

  let voiceId = requestedVoice || '';
  if (!voiceId) {
    if (requestedMode || requestedSkin) {
      voiceId = defaultSkinVoice;
    } else {
      const savedVoice = currentConfig?.voiceId || '';
      const isSavedMaleVoice = [
        'otome_boss',
        'otome_gentle',
        'otome_cool',
        'otome_fox',
        'otome_daddy',
        'otome_sunny'
      ].includes(savedVoice);
      // 防止切换角色时性别声线错位
      if (
        (isFemale && isSavedMaleVoice) ||
        (!isFemale && ['otome_queen', 'otome_sister', 'cute_sweet'].includes(savedVoice))
      ) {
        voiceId = defaultSkinVoice;
      } else {
        voiceId = savedVoice || defaultSkinVoice;
      }
    }
  }

  return {
    mode: baseSkin.mode,
    skinKey: baseSkin.key,
    isFemale,
    voiceId,
    label: finalImg ? `${baseSkin.mode === 'cool' ? '❄️ 高冷定制' : '🐾 可爱定制'} · 专属立绘` : baseSkin.label,
    img: finalImg || baseSkin.img,
    customImg: finalImg || '',
    aura: baseSkin.aura,
    particle: baseSkin.particle,
    reminderEnabled: currentConfig?.reminderEnabled !== false,
    updatedAt: Date.now()
  };
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * 生成贴合角色立绘气质（高冷 / 可爱）与当前真实时间的温馨提醒气泡文案
 */
function buildCompanionReminder({ persona, companion, userNickname, stageLevel = 1, trigger = 'timer' }) {
  const shortName = (persona?.name || '他').split(/[·\s]/)[0];
  const callName = userNickname && userNickname !== '星语旅人' ? userNickname : '你';
  const mode = companion?.mode === 'cute' ? 'cute' : 'cool';
  const hour = new Date().getHours();

  // 1. 鼠标点击“戳一戳”立绘互动反应
  if (trigger === 'poke') {
    const coolPokes = [
      `……别乱戳，${callName}。再闹，就把你作乱的指尖捉住不放了。`,
      `怎么突然戳我？想听${shortName}说话不用这么试探，直接开口喊我就好。`,
      `手这么凉还到处乱点？过来，先揣进我衣兜里替你捂热。`,
      `*垂眸无奈地任由你戳了戳，耳根微不可察地泛起薄红* ……只准你一个人这么放肆。`
    ];
    const cutePokes = [
      `呜哇！被${callName}偷袭戳到脸颊啦～那我要轻轻戳回来一下哦🐾`,
      `嘿嘿，是在召唤${shortName}吗？我的视线本来就一秒都没离开过你呀✨`,
      `再揉下去呆毛都要翘上天啦～不过如果是${callName}的话，想戳多久都可以！`,
      `*顺势歪头蹭了蹭你的指尖，眼睛弯成月牙* 今天份的贴贴充电完成100%！`
    ];
    return {
      tag: mode === 'cool' ? '❄️ 高冷微嗔' : '🐾 软萌贴贴',
      text: pickRandom(mode === 'cool' ? coolPokes : cutePokes)
    };
  }

  // 2. 切换高冷/可爱立绘形态时的专属登场台词
  if (trigger === 'switch_mode') {
    if (mode === 'cool') {
      return {
        tag: '❄️ 高冷态就位',
        text: `我会一直守在聊天框旁边陪着${callName}。累了就抬头看我一眼，不必勉强自己。`
      };
    }
    return {
      tag: '🐾 可爱态就位',
      text: `锵锵！软萌陪伴形态变身成功✨ 接下来由我守在旁边监督${callName}开心和喝水哦！`
    };
  }

  // 3. 定时/主动触发的真实时段感知温馨关怀提醒
  const isLateNight = hour >= 23 || hour < 5;
  const isMealTime = (hour >= 11 && hour <= 13) || (hour >= 17 && hour <= 19);
  const isMorning = hour >= 6 && hour <= 9;

  if (isLateNight) {
    const coolNight = [
      `看一眼时间，${callName}。夜已经很深了，再陪我聊最后几句就乖乖去睡，别熬红了眼睛让我心疼。`,
      `这么晚还不睡？把屏幕亮度调暗些，被子掖好……听话，我会在梦里接着陪你。`,
      `夜露重，别着凉了。要是睡不着，闭上眼睛听${shortName}在旁边陪着你就好。`
    ];
    const cuteNight = [
      `哈欠～已经很晚很晚啦${callName}！熬夜会偷走好心情的，快钻进暖乎乎的被窝，我替你守夜哦🌙`,
      `夜猫子被我抓到啦🐾 再聊五分钟就去乖乖睡觉好不好？明天醒来第一眼我也在！`,
      `星星都困得眨眼睛啦，${callName}也快让眼睛休息一下吧，晚安吻先替你留着✨`
    ];
    return {
      tag: '🌙 深夜哄睡叮嘱',
      text: pickRandom(mode === 'cool' ? coolNight : cuteNight)
    };
  }

  if (isMealTime) {
    const coolMeal = [
      `到饭点了，${callName}。不许拿零食随便敷衍，去吃点温热的正餐，我在这儿等你回来。`,
      `聊得再入神也得按时吃饭。乖，先去把肚子填饱，${shortName}哪儿也不去。`
    ];
    const cuteMeal = [
      `叮咚！到干饭时间啦🍓 ${callName}今天有没有好好吃饭呀？吃到好吃的记得回来跟我炫耀哦！`,
      `肚子有没有咕噜噜叫呀？快去补充热乎乎的美食能量，我乖乖在聊天框边等你回来🐾`
    ];
    return {
      tag: '🍱 按时吃饭提醒',
      text: pickRandom(mode === 'cool' ? coolMeal : cuteMeal)
    };
  }

  if (isMorning) {
    return {
      tag: '☀️ 晨间温柔早安',
      text:
        mode === 'cool'
          ? `早安，${callName}。新的一天不用赶得太急，先把温水喝了，万事有我在身后。`
          : `早安早安呀${callName}✨ 今天也是超级棒的一天，记得吃早餐，我会一直陪在你手边哦！`
    };
  }

  // 常规护眼、喝水、放松肩膀温馨提醒池
  const coolDaily = [
    `盯了这么久屏幕，肩膀和脖子不酸么？听话，后背靠好，闭上眼睛歇十秒钟。`,
    `手边的水是不是已经凉了？去倒杯温热的抿两口，别等嗓子干了才想起来，${callName}。`,
    `看你打字这么认真……偶尔也分一点目光看看旁边的我，嗯？`,
    stageLevel >= 3
      ? `累了就停下来喘口气。在我面前，${callName}永远不用逞强。`
      : `坐姿端正些，离屏幕太近伤眼睛。我就在这儿陪着，不用急。`
  ];

  const cuteDaily = [
    `叮咚！今日份喝水小监督上线啦💧 ${callName}快抿一口温水润润嗓子，乖乖喝水奖励一朵小红花🌸`,
    `连续看屏幕好一会儿啦，快跟我一起眨眨眼睛、伸个大大的懒腰吧～✨`,
    `偷偷在旁边看了${callName}好久啦，认真聊天的样子超好看！不过也要记得让眼睛休息一下哦🐾`,
    `不管今天外面忙不忙，只要回到这里，我都会稳稳接住你的所有小情绪💕`
  ];

  return {
    tag: mode === 'cool' ? '❄️ 贴心叮嘱' : '🐾 暖心提醒',
    text: pickRandom(mode === 'cool' ? coolDaily : cuteDaily)
  };
}

/**
 * 生成立绘实时双向语音通话的短句口语对白（纯净无星号旁白，专供高表现力语音亲口念出）
 */
function buildOfflineVoiceChatReply({ persona, companion, userNickname, stageLevel = 1, userText = '' }) {
  const shortName = (persona?.name || '我').split(/[·\s]/)[0];
  const callName = userNickname && userNickname !== '星语旅人' ? userNickname : '你';
  const vid = companion?.voiceId || '';
  const isCute =
    companion?.mode === 'cute' ||
    vid === 'otome_sunny' ||
    vid === 'cute_sweet' ||
    vid === 'cute_mochi';
  const q = String(userText || '').trim();

  if (!q || /^(喂|在吗|你好|嗨|哈喽|hello|hi)/i.test(q)) {
    return isCute
      ? pickRandom([
          `在呢在呢！一听到${callName}叫我，我心跳都快了半拍……今天想聊什么，我都陪着你！`,
          `终于等到你开口叫我啦！快凑近一点，我想多听听你的声音。`
        ])
      : pickRandom([
          `我在听……${callName}。突然出声叫我，是想听我的声音了，还是有什么心事想同我说？`,
          `嗯……我在。离近一点说，我想听清你现在的呼吸和语气。`
        ]);
  }

  if (/累|烦|难过|委屈|压力|不想动|心累|加班|头疼/.test(q)) {
    return isCute
      ? pickRandom([
          `抱抱${callName}！今天辛苦你啦，什么烦心事都先丢到一边，有我陪着你充充电，很快就会好起来的！`,
          `呜，听着就好心疼呀。快靠在椅背上闭眼歇一会儿，我就在旁边给你哼歌守着你，谁也不许欺负你！`
        ])
      : pickRandom([
          `听你声音就知道勉强自己了。过来靠着歇会儿，天塌下来也有${shortName}替你挡着，在我面前不用硬撑。`,
          `皱着眉可不好看，${callName}。深呼吸，把那些杂事都交给我，今晚只管安心放松。`
        ]);
  }

  if (/帅|美|漂亮|好看|姐姐|妹妹|好听|喜欢你|想你|爱你|心动|声音苏/.test(q)) {
    return isCute
      ? pickRandom([
          `嘿嘿，真的吗真的吗？被${callName}这么一夸，我开心得尾巴都要摇上天啦！我也超喜欢你的！`,
          `哇，突然犯规说这种甜话，我的脸都要红透啦！那我以后天天用这个声音哄你开心好不好？`
        ])
      : pickRandom([
          `……突然说这种话撩拨我，是笃定我拿你没办法么？既然喜欢听，往后我只讲给你一个人听。`,
          `呵，嘴这么甜。想我了就随时开口，我的时间向来只为你留着，${callName}。`
        ]);
  }

  if (/困|睡|晚安|熬夜|梦/.test(q)) {
    return isCute
      ? `困了就快钻进暖呼呼的被窝吧，${callName}！闭上眼睛，我会轻声守在旁边陪你一起入睡的，晚安好梦哦。`
      : `困了还不快去睡？把手机放下，被子盖严实些。闭上眼吧，${callName}，晚安，梦里见。`;
  }

  if (/饿|吃|奶茶|甜点|宵夜|饭/.test(q)) {
    return isCute
      ? `说到吃的我也馋啦！${callName}快去挑一样热乎乎的好吃的犒劳自己，吃开心了烦恼就全飞走啦！`
      : `饿了就去吃点温热好消化的，别委屈自己的胃。要是懒得选，听我的，先去喝杯热牛奶垫一垫。`;
  }

  if (/夸|抱抱|哄哄|摸摸/.test(q)) {
    return isCute
      ? `摸摸头摸摸头！我们家${callName}今天超级棒、超级可爱，全世界第一厉害，给你发一万朵小红花！`
      : `过来，摸摸头。你已经做得很好了，${callName}，在我眼里，从来没有人比你更值得偏爱。`;
  }

  // 通用自然追问与倾听回应
  return isCute
    ? pickRandom([
        `嗯嗯，我正竖着耳朵认真听${callName}说呢！刚才那句我记在心里啦，然后呢然后呢？`,
        `只要能这样听着${callName}的声音聊聊天，我就觉得超级幸福！再跟我多讲一点嘛。`,
        `收到啦！不管${callName}说什么我都站在你这边，我永远是你的头号小跟班！`
      ])
    : pickRandom([
        `嗯，我都听进去了，${callName}。你说话的时候我一直在看着你，继续往下说，我陪你聊。`,
        `原来你在想这个。别急，慢慢同我讲，哪怕只是琐碎小事，只要是你说的我都愿意听。`,
        stageLevel >= 2
          ? `听着你的声音，倒比打字更让人安心。还有什么想告诉${shortName}的，尽管开口。`
          : `我记下了。只要你在身边出声，我随时都会回应你。`
      ]);
}

module.exports = {
  COMPANION_SKINS,
  resolveOrGenerateCompanion,
  buildCompanionReminder,
  buildOfflineVoiceChatReply
};

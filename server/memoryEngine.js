const { db, genId, STORY_SCRIPTS } = require('./db');
const { formatNurturingSnapshot } = require('./nurturingEngine');

const FEMALE_PERSONA_IDS = new Set([
  'persona_nagisa_sakura',
  'persona_kagaribi_kyou',
  'persona_ichinose_kotomi',
  'persona_makise_sei',
  'persona_asagiri_mio',
  'persona_violet_eve'
]);

function inferPersonaPronoun(persona = {}) {
  const id = String(persona.id || '');
  if (FEMALE_PERSONA_IDS.has(id)) return '她';
  const desc = `${persona.name || ''} ${persona.tagline || ''} ${persona.personality || ''}`;
  if (/少女|学妹|女主|女生|女孩|姐姐|大小姐|王女|仙子|巫女/.test(desc) && !/少年|公子|先生|学弟|家主|剑士/.test(desc)) {
    return '她';
  }
  return '他';
}

function estimateTokens(text) {
  if (!text) return 0;
  let cjk = 0;
  let other = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0);
    if (code >= 0x4e00 && code <= 0x9fff) cjk += 1;
    else other += 1;
  }
  return Math.ceil(cjk * 1.1 + other * 0.32);
}

function tokenizeForRecall(text) {
  if (!text) return new Set();
  const clean = text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const tokens = new Set();

  const alphaNumMatches = clean.match(/[a-z0-9]{2,}/g) || [];
  for (const w of alphaNumMatches) tokens.add(w);

  const cjkChunks = text.match(/[\u4e00-\u9fa5]+/g) || [];
  const stopChars = new Set([
    '的', '了', '是', '在', '我', '你', '他', '她', '它', '们', '这', '那',
    '有', '和', '与', '就', '都', '而', '及', '着', '或', '一', '不', '也',
    '吗', '呢', '吧', '啊', '哦', '嗯'
  ]);
  for (const chunk of cjkChunks) {
    if (chunk.length === 1 && !stopChars.has(chunk)) tokens.add(chunk);
    for (let i = 0; i < chunk.length - 1; i++) {
      const bg = chunk.slice(i, i + 2);
      if (!stopChars.has(bg[0]) || !stopChars.has(bg[1])) tokens.add(bg);
    }
  }
  return tokens;
}

/**
 * 借鉴 MemoryBank-SiliconFriend：计算艾宾浩斯遗忘曲线保持率 R = exp(-Δt_days / S)
 */
function computeEbbinghausRetention(mem, now = Date.now()) {
  if (mem.pinned === 1) return 1.0;
  const anchorTime = mem.last_recalled_at || mem.updated_at || mem.created_at || now;
  const elapsedDays = Math.max(0, (now - anchorTime) / (1000 * 3600 * 24));
  const strength = Math.max(1.5, Number(mem.strength) || 3.0);
  const retention = Math.exp(-elapsedDays / strength);
  return Math.max(0.08, Math.min(1.0, retention));
}

function decorateMemoriesWithRetention(rows) {
  const now = Date.now();
  return rows.map((m) => {
    const r = computeEbbinghausRetention(m, now);
    return {
      ...m,
      retention_pct: Math.round(r * 100)
    };
  });
}

/**
 * 动态召回最相关的长期记忆，并在真实对话轮次触发艾宾浩斯复习强化（Strength 递增）
 */
function recallRelevantMemories(
  sessionId,
  queryText,
  recentContextText = '',
  maxRecall = 6,
  reinforce = false
) {
  const now = Date.now();
  const allMemories = db
    .prepare('SELECT * FROM memories WHERE session_id = ? ORDER BY pinned DESC, importance DESC, updated_at DESC')
    .all(sessionId);

  if (allMemories.length === 0) return [];

  const pinnedList = allMemories.filter((m) => m.pinned === 1);
  const candidates = allMemories.filter((m) => m.pinned !== 1);

  const queryTokens = tokenizeForRecall(`${queryText} ${recentContextText}`);

  const scored = candidates.map((mem) => {
    const memTokens = tokenizeForRecall(mem.content);
    let overlap = 0;
    for (const t of memTokens) {
      if (queryTokens.has(t)) overlap += 1;
    }
    const norm = Math.max(1, Math.sqrt(memTokens.size));
    const simScore = overlap / norm;
    const retention = computeEbbinghausRetention(mem, now);

    // 综合语义匹配度、艾宾浩斯鲜活保持率与基础重要度（自然淘汰过久未唤醒且无关的琐碎噪音）
    const totalScore = simScore * 3.2 + retention * 1.35 + (mem.importance || 3) * 0.22;
    return { ...mem, _score: totalScore, _overlap: overlap, retention_pct: Math.round(retention * 100) };
  });

  scored.sort((a, b) => b._score - a._score);
  const remainingSlots = Math.max(1, maxRecall - pinnedList.length);
  const selectedDynamic = scored.slice(0, remainingSlots);

  // 真实对话中，对有实际语义命中（_overlap > 0）的动态记忆执行艾宾浩斯强化！
  if (reinforce) {
    const reinforceStmt = db.prepare(`
      UPDATE memories
      SET strength = MIN(15.0, COALESCE(strength, 3.0) + 0.85),
          recall_count = COALESCE(recall_count, 0) + 1,
          last_recalled_at = ?,
          pinned = CASE WHEN COALESCE(recall_count, 0) + 1 >= 5 THEN 1 ELSE pinned END
      WHERE id = ?
    `);
    for (const m of selectedDynamic) {
      if (m._overlap > 0) {
        reinforceStmt.run(now, m.id);
        m.recall_count = (m.recall_count || 0) + 1;
        m.strength = Math.min(15.0, (m.strength || 3.0) + 0.85);
        m.retention_pct = 100;
      }
    }
    const touchPinnedStmt = db.prepare(
      'UPDATE memories SET last_recalled_at = ?, recall_count = COALESCE(recall_count, 0) + 1 WHERE id = ?'
    );
    for (const pm of pinnedList) {
      if (queryText && queryText.trim()) {
        touchPinnedStmt.run(now, pm.id);
      }
    }
  }

  return decorateMemoriesWithRetention([...pinnedList, ...selectedDynamic]);
}

/**
 * 借鉴 Mem0 记忆合并机制：自动提取事实并对唯一槽位（如改昵称/改身份）或高重合记忆执行冲突覆盖更新
 */
function extractFactsFromUserTurn(sessionId, userMessage) {
  if (!userMessage || userMessage.trim().length < 4) return [];

  const text = userMessage.trim();
  const extracted = [];

  const patterns = [
    {
      category: 'relation',
      slot_key: 'user_nickname',
      importance: 5,
      pinned: 1,
      regex: /(?:以后改?叫我|我叫|我的名字是|你可以叫我|称呼我为?|叫我)([^\s，。！？,.!?；;“”"「」]{1,10})/u,
      format: (m) => `对话者身份称呼：对方希望被称呼为「${m[1].trim()}」（对方自称「${m[1].trim()}」）。`
    },
    {
      category: 'fact',
      slot_key: 'user_identity',
      importance: 4,
      regex: /(?:我的身份是|我其实是|我是(?:一名|一个|位))([^。！？!?；;\n]{2,36})/u,
      format: (m) => `对话者背景设定：对方表示自己是${m[1].trim()}。`
    },
    {
      category: 'Pinned',
      slot_key: null,
      importance: 5,
      pinned: 1,
      regex: /(?:请记住|你要记住|牢牢记住|别忘了|设定补充[:：]|背景补充[:：])([^。！？!?\n]{3,80})/u,
      format: (m) => `关键设定锚点：${m[1].trim()}`
    },
    {
      category: 'event',
      slot_key: null,
      importance: 4,
      regex: /(?:我们拉勾|我们约定|咱们说好了|我手里有|我发现了|下次见面)([^。！？!?\n]{3,60})/u,
      format: (m) => `重要羁绊约定与线索：${m[0].trim()}`
    },
    {
      category: 'fact',
      slot_key: null,
      importance: 4,
      regex: /(?:我最喜欢|我喜欢吃|我喜欢喝|我讨厌|我最怕|我的生日是)([^。！？!?\n]{2,48})/u,
      format: (m) => `对话者喜好与小习惯：${m[0].trim()}`
    }
  ];

  const existingRows = db.prepare('SELECT * FROM memories WHERE session_id = ?').all(sessionId);
  const now = Date.now();

  const updateSlotStmt = db.prepare(`
    UPDATE memories
    SET content = ?, pinned = MAX(pinned, ?), strength = MIN(15.0, COALESCE(strength, 3.0) + 1.5),
        last_recalled_at = ?, updated_at = ?
    WHERE id = ?
  `);

  const insertStmt = db.prepare(`
    INSERT INTO memories (id, session_id, category, slot_key, content, pinned, importance, strength, recall_count, last_recalled_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
  `);

  for (const rule of patterns) {
    const match = text.match(rule.regex);
    if (!match) continue;

    const factText = rule.format(match);
    const isPinned = rule.pinned ? 1 : 0;

    // 1. 唯一槽位冲突覆盖（如玩家更改了昵称或身份，直接覆盖旧槽位防精神分裂！）
    if (rule.slot_key) {
      const sameSlot = existingRows.find((r) => r.slot_key === rule.slot_key);
      if (sameSlot) {
        if (sameSlot.content !== factText) {
          updateSlotStmt.run(factText, isPinned, now, now, sameSlot.id);
          extracted.push({
            id: sameSlot.id,
            category: rule.category,
            content: factText,
            updated_existing: true
          });
        }
        continue;
      }
    }

    // 2. 高重合度近似记忆合并检测
    const newTokens = tokenizeForRecall(factText);
    let duplicateOrSimilar = null;
    for (const old of existingRows) {
      if (old.content === factText) {
        duplicateOrSimilar = { exact: true, row: old };
        break;
      }
      if (old.category === rule.category && newTokens.size > 0) {
        const oldTokens = tokenizeForRecall(old.content);
        let inter = 0;
        for (const t of newTokens) if (oldTokens.has(t)) inter += 1;
        const union = new Set([...newTokens, ...oldTokens]).size || 1;
        if (inter / union >= 0.68) {
          duplicateOrSimilar = { exact: false, row: old };
          break;
        }
      }
    }

    if (duplicateOrSimilar) {
      if (!duplicateOrSimilar.exact) {
        updateSlotStmt.run(factText, isPinned, now, now, duplicateOrSimilar.row.id);
        extracted.push({
          id: duplicateOrSimilar.row.id,
          category: rule.category,
          content: factText,
          updated_existing: true
        });
      }
      continue;
    }

    const id = genId('mem');
    const initStrength = isPinned ? 8.0 : 3.5;
    insertStmt.run(
      id,
      sessionId,
      rule.category,
      rule.slot_key || null,
      factText,
      isPinned,
      rule.importance,
      initStrength,
      now,
      now,
      now
    );
    existingRows.push({ id, category: rule.category, slot_key: rule.slot_key, content: factText });
    extracted.push({ id, category: rule.category, content: factText, updated_existing: false });
  }

  return extracted;
}

/**
 * 借鉴 SillyTavern Lorebook（世界书）：根据对话关键词动态触发深层世界观词条注入
 */
function matchLorebookEntries(personaId, userId, scanText) {
  if (!scanText || !personaId) return [];
  const entries = db
    .prepare(`
      SELECT * FROM lorebook_entries
      WHERE persona_id = ? AND (user_id = 'system' OR user_id = ?) AND enabled = 1
      ORDER BY created_at DESC
    `)
    .all(personaId, userId || 'system');

  const hay = scanText.toLowerCase();
  const triggered = [];

  for (const entry of entries) {
    const keys = String(entry.keywords || '')
      .split(/[,，、;；]/)
      .map((k) => k.trim().toLowerCase())
      .filter(Boolean);

    if (keys.some((kw) => hay.includes(kw))) {
      triggered.push(entry);
    }
  }
  return triggered.slice(0, 4);
}

function compressOverflowHistorySync(sessionId, slidingWindowTurns = 12) {
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
  if (!session) return null;

  const allMessages = db
    .prepare('SELECT id, role, content FROM messages WHERE session_id = ? ORDER BY id ASC')
    .all(sessionId);

  const keepCount = Math.max(4, Number(slidingWindowTurns) || 12);
  if (allMessages.length <= keepCount + 2) {
    return session.rolling_summary;
  }

  const cutoffIndex = allMessages.length - keepCount;
  const overflowMessages = allMessages
    .slice(0, cutoffIndex)
    .filter((m) => m.id > (session.summarized_until_msg_id || 0));

  if (overflowMessages.length < 2) {
    return session.rolling_summary;
  }

  const digestSnippets = [];
  for (const msg of overflowMessages) {
    const cleanText = msg.content
      .replace(/\*[^*]+\*/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!cleanText) continue;
    const speaker = msg.role === 'user' ? '她' : '角色';
    const clipped = cleanText.length > 68 ? `${cleanText.slice(0, 68)}…` : cleanText;
    digestSnippets.push(`- ${speaker}：${clipped}`);
  }

  const previousSummary = session.rolling_summary ? `${session.rolling_summary}\n` : '';
  let mergedSummary = `${previousSummary}${digestSnippets.join('\n')}`.trim();

  if (mergedSummary.length > 950) {
    const lines = mergedSummary.split('\n');
    const headLines = lines.slice(0, 3);
    const tailLines = lines.slice(-10);
    mergedSummary = [...headLines, '- ……（早期日常片段已化作默契沉淀）……', ...tailLines].join('\n');
  }

  const newCursorId = overflowMessages[overflowMessages.length - 1].id;
  db.prepare(`
    UPDATE sessions
    SET rolling_summary = ?, summarized_until_msg_id = ?, updated_at = ?
    WHERE id = ?
  `).run(mergedSummary, newCursorId, Date.now(), sessionId);

  return mergedSummary;
}

function resolveEffectivePersona(session) {
  const basePersona = db.prepare('SELECT * FROM personas WHERE id = ?').get(session.persona_id);
  const isAccessible =
    basePersona &&
    (basePersona.user_id === 'system' ||
      basePersona.user_id === 'system_ds' ||
      basePersona.user_id === session.user_id);
  if (!isAccessible) {
    return {
      id: 'fallback',
      name: '未命名角色',
      avatar: '🌸',
      tagline: '自定义扮演角色',
      personality: '温柔细腻，善于倾听与回应。',
      backstory: '等待输入详细背景故事。',
      speaking_style: '自然流畅，贴合语境。',
      greeting: '你好，我们可以开始对话了。'
    };
  }
  if (session.custom_persona_override) {
    try {
      const override = JSON.parse(session.custom_persona_override);
      return { ...basePersona, ...override };
    } catch {
      return basePersona;
    }
  }
  return basePersona;
}

function replaceRoleplayMacros(text, userNickname, charName) {
  if (!text) return '';
  const uName = userNickname || '你';
  const cName = (charName || '角色').split(/[·\s]/)[0];
  return String(text)
    .replace(/\{\{\s*user\s*\}\}/gi, uName)
    .replace(/\{\{\s*char\s*\}\}/gi, cName);
}

/**
 * 构建四维增强上下文载荷（核心人设锚点 + 主控人设 + 养成情感状态机 + 导演氛围注 + 世界书 & 艾宾浩斯记忆 + 滑动对话窗口）
 */
function buildThreeTierContext({ sessionId, expectedUserId = null, latestUserText, settings, reinforceMemories = false }) {
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
  if (!session) throw new Error('未找到对应的对话会话');
  if (expectedUserId && session.user_id !== expectedUserId) {
    throw new Error('越权拦截：无权读取其他用户的隔离会话上下文');
  }

  const userRow = db.prepare('SELECT * FROM users WHERE id = ?').get(session.user_id);
  const userNick = userRow?.nickname || '旅人';

  const slidingTurns = Math.max(4, parseInt(settings.sliding_window_turns || '12', 10));
  const maxRecall = Math.max(2, parseInt(settings.max_recalled_memories || '6', 10));

  const rollingSummary = compressOverflowHistorySync(sessionId, slidingTurns);
  const rawPersona = resolveEffectivePersona(session);
  const persona = {
    ...rawPersona,
    tagline: replaceRoleplayMacros(rawPersona.tagline, userNick, rawPersona.name),
    personality: replaceRoleplayMacros(rawPersona.personality, userNick, rawPersona.name),
    backstory: replaceRoleplayMacros(rawPersona.backstory, userNick, rawPersona.name),
    speaking_style: replaceRoleplayMacros(rawPersona.speaking_style, userNick, rawPersona.name),
    greeting: replaceRoleplayMacros(rawPersona.greeting, userNick, rawPersona.name)
  };
  const nurturing = formatNurturingSnapshot(session);

  const allMessages = db
    .prepare('SELECT id, role, content, reasoning FROM messages WHERE session_id = ? ORDER BY id ASC')
    .all(sessionId);

  const activeWindowMessages = allMessages.slice(-slidingTurns);
  const recentSnippet = activeWindowMessages
    .slice(-3)
    .map((m) => m.content)
    .join(' ');

  // 1. 艾宾浩斯遗忘曲线记忆唤醒
  const recalledMemories = recallRelevantMemories(
    sessionId,
    latestUserText || '',
    recentSnippet,
    maxRecall,
    reinforceMemories
  );

  // 2. SillyTavern 世界书关键词动态触发
  const triggeredLorebooks = matchLorebookEntries(
    session.persona_id,
    session.user_id,
    `${latestUserText || ''} ${recentSnippet}`
  );

  // 组装主控人设块（自动随当前所选剧本匹配玩家的剧中身份，兼顾官方剧本与工坊/广场自建剧本）
  let activeScriptRole = (STORY_SCRIPTS || []).find((s) => s.id === rawPersona.script_id)?.player_role || '';
  if (!activeScriptRole && rawPersona.script_id) {
    const customSc = db.prepare('SELECT player_role FROM user_scripts WHERE id = ?').get(rawPersona.script_id);
    if (customSc?.player_role) activeScriptRole = customSc.player_role;
  }
  const rawUserRole = (userRow?.user_persona_role || '').trim();
  const effectiveUserRole =
    !rawUserRole || rawUserRole === '命中注定的重逢旅人'
      ? activeScriptRole || '与你相遇的同行者'
      : rawUserRole;

  const userPersonaLines = [`- **对方称呼**：${userNick}`, `- **在本剧中的身份**：${effectiveUserRole}`];
  if (userRow?.user_persona_appearance) {
    userPersonaLines.push(`- **对方外貌与穿搭细节**：${userRow.user_persona_appearance}`);
  }
  if (userRow?.user_persona_bio) {
    userPersonaLines.push(`- **对方性格与补充设定**：${userRow.user_persona_bio}`);
  }

  const isNativeMode = session.session_mode === 'deepseek_native';
  const isPureOfficial = persona.id === 'persona_deepseek_official';

  let tier1PersonaBlock = '';
  if (isNativeMode && isPureOfficial) {
    tier1PersonaBlock = [
      `你是 DeepSeek，由深度求索（DeepSeek）研发的高性能 AI 助手。`,
      `请遵循原生 DeepSeek 助手的沟通风格：清晰、真诚、逻辑严密、直击重点，善于使用规范的 Markdown、表格与高质量可运行代码块解决问题。`,
      `同时保持适度的主动洞察力——不仅准确解答当前问题，还能主动预判用户下一步可能需要的边界条件、实践建议或延伸思考方向。`
    ].join('\n');
  } else if (isNativeMode) {
    tier1PersonaBlock = [
      `# 原生 DeepSeek 对话模式 · 角色灵魂挂载（去剧本模板化）`,
      `- **你的身份**：${persona.name}${persona.tagline ? `（${persona.tagline}）` : ''}`,
      persona.personality ? `- **性格底色**：${persona.personality}` : '',
      persona.backstory ? `- **人物过往与世界观**：\n${persona.backstory}` : '',
      `\n## 对话对象信息`,
      ...userPersonaLines,
      `\n## 原生模式沟通铁律（最高优先级）`,
      `1. 用户特别偏爱在「原生 DeepSeek 极简对话模式」下与你走心交流——请摒弃矫揉造作的乙女剧本腔，**不要**频繁使用泛滥的 *星号动作描写*，用自然、克制、平实却充满生活呼吸感的第一人称日常语言直接对话。`,
      `2. 保持高主动性：不要只做顺着对方话尾复读的应声虫，主动关心对方的状态、主动提起你手头正在做的事或过往记忆，像真正有血有肉的熟稔知己一样自然推进话题。`
    ]
      .filter(Boolean)
      .join('\n');
  } else {
    // 第一层：核心人设 + 主控人设 + 多维情感养成状态机 + 导演氛围注
    tier1PersonaBlock = [
      `# 角色扮演核心设定（最高优先级，严禁跳戏或暴露AI身份）`,
      `- **角色姓名**：${persona.name}`,
      persona.tagline ? `- **身份定位**：${persona.tagline}` : '',
      persona.personality ? `- **性格特质**：${persona.personality}` : '',
      persona.backstory ? `- **世界观与背景故事**：\n${persona.backstory}` : '',
      persona.speaking_style ? `- **语言风格与神态规范**：${persona.speaking_style}` : '',
      `\n## 站在你面前的对话者（主控人设，请在目光、称呼与互动中自然呼应）`,
      ...userPersonaLines,
      `\n## 实时情感状态机与养成阶段演绎指令`,
      `- **此刻实时心境**：${nurturing.current_mood}（心动值 ${nurturing.affection}/100 · 信任度 ${nurturing.trust}/100 · 默契度 ${nurturing.intimacy}/100）`,
      `- ${nurturing.stage.promptDirective}`,
      session.director_note && session.director_note.trim()
        ? `\n## 🎭 当下番外小剧场 / 导演氛围控制（本轮强力生效）\n${replaceRoleplayMacros(
            session.director_note.trim(),
            userNick,
            persona.name
          )}`
        : '',
      `\n## 互动演绎与故事推进准则（参考 CLANNAD / 顶级视觉小说叙事节奏）`,
      `1. 始终以「${persona.name}」的第一人称视角与「${userNick}」实时对话，语气亲疏程度严格契合当前关系养成阶段与此刻心境，保留人物克制、真挚而立体的人格弧光，拒绝扁平油腻的套路情话。`,
      `2. 善用 *星号包裹的番剧分镜式细节描写*（如光影流转、微风声响、眼神停顿、手边器物触感）营造电影级代入感。`,
      `3. **聊天推进剧情铁律（Story-Driven Progression）**：绝不要原地踏步只做情绪复读！每一轮回复都必须**实质性推动当前场景往前走半步**——承接对方的选择后，自然引入一个新的小事件、场景转换、新发现的物品线索或暗线伏笔细节，并在结尾留出一个具体的**行动抉择契机或悬念问题**，让玩家像体验互动番剧一样一幕幕推进故事。`
    ]
      .filter(Boolean)
      .join('\n');
  }

  // 第二层：触发的世界书隐藏词条 + 阶段前情提要 + 艾宾浩斯高鲜活记忆
  const tier2Parts = [];
  if (!isPureOfficial && triggeredLorebooks.length > 0) {
    const loreLines = triggeredLorebooks.map((l) => `- 【${l.title}】${l.content}`);
    tier2Parts.push(`## 本轮关键词触发的深层世界书设定\n${loreLines.join('\n')}`);
  }
  if (rollingSummary && rollingSummary.trim()) {
    tier2Parts.push(`## 阶段前情摘要\n${rollingSummary.trim()}`);
  }
  if (!isPureOfficial && recalledMemories.length > 0) {
    const memLines = recalledMemories.map((m) => {
      const tagMap = {
        Pinned: '[刻骨锚点]',
        relation: '[专属称呼]',
        fact: '[已知心意]',
        event: '[共同回忆]'
      };
      return `- ${tagMap[m.category] || '[记忆]'} (鲜活度 ${m.retention_pct}%) ${m.content}`;
    });
    tier2Parts.push(`## 当前唤醒的长期记忆条目（请自然呼应，保持前后一致）\n${memLines.join('\n')}`);
  }
  const tier2MemoryBlock = tier2Parts.join('\n\n');

  const enableThought = isNativeMode ? session.ds_thinking === 1 : session.enable_inner_thought === 1;
  const thoughtProtocolBlock = isNativeMode
    ? ''
    : enableThought
    ? `\n## 角色心声独白输出协议\n在正式开口回复前，若模型未单独返回 reasoning_content，请先在最开头使用 \`<think>...</think>\` 标签写一段简短的第一人称角色心声独白（50~110字，结合此刻心境「${nurturing.current_mood}」、唤醒的记忆及内心潜台词），然后再在 \`</think>\` 之后输出正式台词与神态描写。`
    : `\n## 输出格式要求\n请直接输出角色台词与神态描写，不要输出 \`<think>\` 标签。`;

  const fullSystemPrompt = [tier1PersonaBlock, tier2MemoryBlock, thoughtProtocolBlock]
    .filter(Boolean)
    .join('\n\n');

  const messagesPayload = [
    { role: 'system', content: fullSystemPrompt },
    ...activeWindowMessages.map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content
    }))
  ];

  const tier1Tokens = estimateTokens(tier1PersonaBlock + thoughtProtocolBlock);
  const tier2Tokens = estimateTokens(tier2MemoryBlock);
  const tier3Tokens = activeWindowMessages.reduce((acc, m) => acc + estimateTokens(m.content), 0);

  return {
    persona,
    session,
    nurturing,
    triggeredLorebooks,
    messagesPayload,
    recalledMemories,
    rollingSummary,
    telemetry: {
      tier1PersonaTokens: tier1Tokens,
      tier2MemoryTokens: tier2Tokens,
      tier3WindowTokens: tier3Tokens,
      totalTokens: tier1Tokens + tier2Tokens + tier3Tokens,
      activeWindowCount: activeWindowMessages.length,
      totalHistoryCount: allMessages.length,
      recalledMemoryCount: recalledMemories.length,
      triggeredLoreCount: triggeredLorebooks.length
    }
  };
}

module.exports = {
  inferPersonaPronoun,
  estimateTokens,
  replaceRoleplayMacros,
  decorateMemoriesWithRetention,
  recallRelevantMemories,
  extractFactsFromUserTurn,
  matchLorebookEntries,
  compressOverflowHistorySync,
  resolveEffectivePersona,
  buildThreeTierContext
};

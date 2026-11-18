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
 * 严格大模型对话消息序列自愈归一化管线：
 * 1. 聚合所有 system 消息为单一置顶 system 消息（最大化 DeepSeek 磁盘前缀缓存命中率，兼容所有严格网关）；
 * 2. 过滤空消息，修复首条非 system 消息为 assistant（如开场白残留）的场景；
 * 3. 自动无损合并连续同角色消息（user+user 或 assistant+assistant），100% 杜绝 deepseek-reasoner / Anthropic 报 400 交替错误。
 */
function normalizeMessagesForStrictLLM(rawMessages = []) {
  if (!Array.isArray(rawMessages) || rawMessages.length === 0) return [];

  const systemParts = [];
  const dialogue = [];

  for (const msg of rawMessages) {
    if (!msg || typeof msg.content !== 'string') continue;
    const trimmed = msg.content.trim();
    if (!trimmed && !Array.isArray(msg.tool_calls)) continue;

    if (msg.role === 'system') {
      systemParts.push(trimmed);
      continue;
    }

    if (msg.role === 'tool') {
      dialogue.push({ ...msg });
      continue;
    }

    const normRole = msg.role === 'assistant' ? 'assistant' : 'user';
    dialogue.push({
      ...msg,
      role: normRole,
      content: msg.content
    });
  }

  // 若对话区第一条是 assistant（例如剧本角色开场白），将其融合进背景引导或补齐前置 user 轮，保证严格以 user 起始
  if (dialogue.length > 0 && dialogue[0].role === 'assistant' && !dialogue[0].tool_calls) {
    const openingGreeting = dialogue.shift().content.trim();
    if (openingGreeting) {
      systemParts.push(`## 对话开场已发生的上下文前情\n你在开场时刚刚说过：\n「${openingGreeting}」`);
    }
  }

  // 合并相邻同角色普通文本消息（不含 tool_calls 的连续 user 或连续 assistant）
  const alternated = [];
  for (const item of dialogue) {
    const prev = alternated[alternated.length - 1];
    if (
      prev &&
      prev.role === item.role &&
      (item.role === 'user' || item.role === 'assistant') &&
      !prev.tool_calls &&
      !item.tool_calls &&
      !prev.prefix &&
      !item.prefix
    ) {
      prev.content = `${prev.content.trim()}\n\n${item.content.trim()}`;
    } else {
      alternated.push(item);
    }
  }

  const result = [];
  if (systemParts.length > 0) {
    result.push({
      role: 'system',
      content: systemParts.join('\n\n')
    });
  }
  result.push(...alternated);
  return result;
}

/**
 * 计算艾宾浩斯遗忘曲线保持率 R = exp(-Δt_days / S)
 * 升级：提高基础记忆强度下限（4.5）与保持率底线（0.18），使关键长期记忆更加牢靠不易丢失
 */
function computeEbbinghausRetention(mem, now = Date.now()) {
  if (mem.pinned === 1) return 1.0;
  const anchorTime = mem.last_recalled_at || mem.updated_at || mem.created_at || now;
  const elapsedDays = Math.max(0, (now - anchorTime) / (1000 * 3600 * 24));
  const strength = Math.max(4.5, Number(mem.strength) || 6.0);
  const retention = Math.exp(-elapsedDays / strength);
  return Math.max(0.18, Math.min(1.0, retention));
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
 * 动态召回长期记忆并触发艾宾浩斯复习强化：
 * 1. 所有置顶核心记忆（pinned = 1）100% 全量保底召回，绝不被动态配额挤压；
 * 2. 动态记忆独立享有 maxRecall 个召回槽位，语义命中满 3 次自动晋升为永久置顶锚点！
 */
function recallRelevantMemories(
  sessionId,
  queryText,
  recentContextText = '',
  maxRecall = 16,
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

    // 近期更新过的记忆额外赋予近因加成，确保刚聊过几轮的新事实稳稳命中
    const ageHours = Math.max(0, (now - (mem.updated_at || mem.created_at || now)) / (1000 * 3600));
    const recencyBoost = ageHours < 24 ? 0.65 : ageHours < 72 ? 0.3 : 0;

    const totalScore = simScore * 3.5 + retention * 1.4 + (mem.importance || 3) * 0.28 + recencyBoost;
    return { ...mem, _score: totalScore, _overlap: overlap, retention_pct: Math.round(retention * 100) };
  });

  scored.sort((a, b) => b._score - a._score);
  const dynamicQuota = Math.min(32, Math.max(6, Number(maxRecall) || 16));
  const selectedDynamic = scored.slice(0, dynamicQuota);

  if (reinforce) {
    const reinforceStmt = db.prepare(`
      UPDATE memories
      SET strength = MIN(30.0, COALESCE(strength, 6.0) + 1.5),
          recall_count = COALESCE(recall_count, 0) + 1,
          last_recalled_at = ?,
          pinned = CASE WHEN COALESCE(recall_count, 0) + 1 >= 3 THEN 1 ELSE pinned END
      WHERE id = ?
    `);
    for (const m of selectedDynamic) {
      if (m._overlap > 0) {
        reinforceStmt.run(now, m.id);
        m.recall_count = (m.recall_count || 0) + 1;
        m.strength = Math.min(30.0, (m.strength || 6.0) + 1.5);
        if (m.recall_count >= 3) m.pinned = 1;
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
 * 双模通用事实与关键约束自动提取引擎（同时覆盖 DeepSeek 生产力工程约束与角色扮演羁绊事实）：
 * 支持多句分段扫描、唯一槽位冲突覆盖（如改称呼/换技术栈）与近似去重。
 */
function extractFactsFromUserTurn(sessionId, userMessage) {
  if (!userMessage || userMessage.trim().length < 4) return [];

  const rawFull = userMessage.trim();
  // 剥离大段代码块后再做个人事实与约束扫描，避免误把代码注释当成用户自述
  const strippedCode = rawFull.replace(/```[\s\S]*?```/g, ' ').trim();
  if (!strippedCode) return [];

  const fullSentences = strippedCode
    .split(/[。！？!?\n；;]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 4)
    .slice(0, 12);

  const subClauses = strippedCode
    .split(/[，,。！？!?\n；;]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 3)
    .slice(0, 24);

  const segments = [...new Set([...fullSentences, ...subClauses])];

  const isInterrogativeSegment = (seg, fullMsg) => {
    const hasExplicitPinDirective = /(?:请记住|你要记住|牢牢记住|帮我记住|记一下|设定补充|背景补充)/.test(seg);
    if (hasExplicitPinDirective) return false;
    if (/[?？]|(?:吗|呢|么)$/.test(seg)) return true;
    if (/(?:什么|啥|谁|哪(?:里|儿|个)|还记得|你记得|你知道|忘了吗|猜猜|是怎么)/.test(seg)) return true;
    if (/^(?:你还记得|你记得|请问|帮我看看)/.test(fullMsg) && !hasExplicitPinDirective) return true;
    return false;
  };

  const patterns = [
    {
      category: 'relation',
      slot_key: 'user_nickname',
      importance: 5,
      pinned: 1,
      regex: /(?:以后改?叫我|我叫|我的名字是|我的昵称是|你可以叫我|称呼我为?|叫我)\s*([^\s，,。！？.!?；;、：“”"「」『』()（）]{1,12})/u,
      validate: (m) => {
        const val = (m[1] || '').trim();
        return (
          val.length >= 1 &&
          !/^(?:什么|啥|谁|哪|名字|昵称|怎么|大师|老板)$/.test(val) &&
          !/(?:什么|名字|项目|记得|知道)/.test(val)
        );
      },
      format: (m) => `用户称呼：对方希望被称呼为「${m[1].trim()}」（对方自称「${m[1].trim()}」）。`
    },
    {
      category: 'fact',
      slot_key: 'user_identity',
      importance: 5,
      pinned: 1,
      regex: /(?:我的身份是|我的职业是|我的岗位是|我其实是|我是(?:一名|一个|位|做))\s*([^，,。！？!?；;、\n]{2,42})/u,
      format: (m) => `用户身份与背景：对方表示自己是${m[1].trim()}。`
    },
    {
      category: 'fact',
      slot_key: 'project_context',
      importance: 5,
      pinned: 1,
      regex: /(?:我的项目(?:是|叫)|当前项目(?:是|叫)|(?:我)?正在(?:开发|做|写|维护|重构|推进))\s*([^，,。！？!?；;\n]{3,68})/u,
      format: (m) => `当前推进项目/任务背景：正在处理「${m[1].trim()}」。`
    },
    {
      category: 'fact',
      slot_key: 'tech_stack',
      importance: 5,
      pinned: 1,
      regex: /(?:技术栈|开发环境|操作系统|后端|前端|框架|数据库|编程语言)(?:用的是|使用|采用|是|基于|用)?\s*([^。！？!?；;\n]{2,68})/u,
      format: (m) => `技术栈与环境约束：${m[0].trim()}。`
    },
    {
      category: 'Pinned',
      slot_key: null,
      importance: 5,
      pinned: 1,
      regex: /(?:请记住|你要记住|牢牢记住|记住[:：]?|帮我记住|记一下[:：]?|别忘了|以后都(?:要|用|按)|后续都(?:要|用|按)|统一(?:使用|采用)|默认(?:使用|采用)|千万不要|严禁使用|设定补充[:：]|背景补充[:：])\s*([^。！？!?\n]{3,110})/u,
      format: (m) => `核心长期约束锚点：${m[0].trim()}`
    },
    {
      category: 'event',
      slot_key: null,
      importance: 4,
      pinned: 0,
      regex: /(?:我们拉勾|我们约定|咱们说好了|我的目标是|最终需求是|核心诉求是|我手里有|我发现了|下次见面)\s*([^。！？!?\n]{3,75})/u,
      format: (m) => `关键目标与约定：${m[0].trim()}`
    },
    {
      category: 'fact',
      slot_key: null,
      importance: 4,
      pinned: 0,
      regex: /(?:我最喜欢|我喜欢吃|我喜欢喝|我习惯用|我偏好|我讨厌|我最怕|我的生日是)\s*([^。！？!?\n]{2,56})/u,
      format: (m) => `个人偏好与习惯：${m[0].trim()}`
    }
  ];

  const existingRows = db.prepare('SELECT * FROM memories WHERE session_id = ?').all(sessionId);
  const now = Date.now();
  const extracted = [];

  const updateSlotStmt = db.prepare(`
    UPDATE memories
    SET content = ?, pinned = MAX(pinned, ?), strength = MIN(30.0, COALESCE(strength, 6.0) + 2.5),
        last_recalled_at = ?, updated_at = ?
    WHERE id = ?
  `);

  const insertStmt = db.prepare(`
    INSERT INTO memories (id, session_id, category, slot_key, content, pinned, importance, strength, recall_count, last_recalled_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
  `);

  for (const seg of segments) {
    if (isInterrogativeSegment(seg, strippedCode)) continue;
    for (const rule of patterns) {
      const match = seg.match(rule.regex);
      if (!match) continue;
      if (typeof rule.validate === 'function' && !rule.validate(match)) continue;

      const factText = rule.format(match);
      const isPinned = rule.pinned ? 1 : 0;

      // 1. 唯一槽位冲突覆盖（如修改称呼、切换当前技术栈，直接平滑覆盖旧槽位）
      if (rule.slot_key) {
        const sameSlot = existingRows.find((r) => r.slot_key === rule.slot_key);
        if (sameSlot) {
          if (sameSlot.content !== factText) {
            updateSlotStmt.run(factText, isPinned, now, now, sameSlot.id);
            sameSlot.content = factText;
            sameSlot.pinned = Math.max(sameSlot.pinned || 0, isPinned);
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
          duplicateOrSimilar.row.content = factText;
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
      const initStrength = isPinned ? 12.0 : 6.0;
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
      existingRows.push({ id, category: rule.category, slot_key: rule.slot_key, content: factText, pinned: isPinned });
      extracted.push({ id, category: rule.category, content: factText, updated_existing: false });
    }
  }

  return extracted;
}

/**
 * 根据对话关键词动态触发深层世界书词条注入
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
  return triggered.slice(0, 5);
}

/**
 * 提炼单条溢出历史消息的高密度结构化摘要（保留核心结论、关键参数与代码块特征）
 */
function summarizeSingleMessageForRolling(msg, isNativeMode) {
  const raw = String(msg.content || '').trim();
  if (!raw) return '';

  // 提取代码块语言与首行特征，防止滑出窗口后丢失曾经写过的关键代码上下文
  const codeTags = [];
  const withoutCode = raw.replace(/```([a-zA-Z0-9_+-]*)\r?\n([\s\S]*?)```/g, (_, lang, body) => {
    const firstMeaningful = String(body || '')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l && !l.startsWith('//') && !l.startsWith('#'));
    const sig = firstMeaningful ? `: ${firstMeaningful.slice(0, 42)}` : '';
    codeTags.push(`[代码 ${lang || 'snippet'}${sig}]`);
    return ' ';
  });

  const cleanText = withoutCode
    .replace(/\*[^*\n]+\*/g, (m) => (isNativeMode ? m : ''))
    .replace(/<image_attachment[^>]*>[\s\S]*?<\/image_attachment>/gi, '[图片附件]')
    .replace(/<attachment\s+name="([^"]+)"[^>]*>[\s\S]*?<\/attachment>/gi, '[文档附件: $1]')
    .replace(/\s+/g, ' ')
    .trim();

  const suffix = codeTags.length > 0 ? ` ${codeTags.slice(0, 2).join(' ')}` : '';
  if (!cleanText && !suffix) return '';

  const maxLen = msg.role === 'user' ? 180 : 240;
  let core = cleanText;
  if (cleanText.length > maxLen) {
    const head = cleanText.slice(0, Math.floor(maxLen * 0.72));
    const tail = cleanText.slice(-Math.floor(maxLen * 0.25));
    core = `${head} … ${tail}`;
  }
  return `${core}${suffix}`.trim();
}

/**
 * 高保真分层滚动摘要压缩器（容量扩容至 4800 字，自动修复回溯游标，绝不粗暴丢弃关键脉络）
 */
function compressOverflowHistorySync(sessionId, slidingWindowTurns = 40) {
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
  if (!session) return null;

  const isNativeMode = session.session_mode === 'deepseek_native';
  const allMessages = db
    .prepare('SELECT id, role, content FROM messages WHERE session_id = ? ORDER BY id ASC')
    .all(sessionId);

  if (allMessages.length === 0) return session.rolling_summary || '';

  // 自愈保护：若此前执行过消息回溯或编辑重发删除了尾部消息，导致游标大于现存最大消息 ID，自动回拨游标
  const maxExistingId = allMessages[allMessages.length - 1].id;
  let safeCursor = Number(session.summarized_until_msg_id) || 0;
  if (safeCursor > maxExistingId) {
    safeCursor = allMessages.length > slidingWindowTurns
      ? allMessages[allMessages.length - slidingWindowTurns - 1].id
      : 0;
    db.prepare('UPDATE sessions SET summarized_until_msg_id = ? WHERE id = ?').run(safeCursor, sessionId);
  }

  const keepCount = Math.max(8, Number(slidingWindowTurns) || 40);
  if (allMessages.length <= keepCount + 2) {
    return session.rolling_summary;
  }

  const cutoffIndex = allMessages.length - keepCount;
  const overflowMessages = allMessages
    .slice(0, cutoffIndex)
    .filter((m) => m.id > safeCursor);

  if (overflowMessages.length < 2) {
    return session.rolling_summary;
  }

  const userLabel = isNativeMode ? '用户' : '对方';
  const aiLabel = isNativeMode ? 'DeepSeek' : '回复';

  const digestSnippets = [];
  for (const msg of overflowMessages) {
    const summaryLine = summarizeSingleMessageForRolling(msg, isNativeMode);
    if (!summaryLine) continue;
    const speaker = msg.role === 'user' ? userLabel : aiLabel;
    digestSnippets.push(`- ${speaker}：${summaryLine}`);
  }

  const previousSummary = session.rolling_summary ? `${session.rolling_summary.trim()}\n` : '';
  let mergedSummary = `${previousSummary}${digestSnippets.join('\n')}`.trim();

  // 容量从旧版 950 字大幅提升至 4800 字；超出时保留最早开篇锚点 + 高密度中段关键提问 + 完整近期摘要
  const MAX_SUMMARY_CHARS = 4800;
  if (mergedSummary.length > MAX_SUMMARY_CHARS) {
    const lines = mergedSummary.split('\n').filter(Boolean);
    const headLines = lines.slice(0, 6);
    const tailLines = lines.slice(-24);
    const middleLines = lines.slice(6, -24);
    const condensedMiddle = middleLines
      .filter((l) => l.startsWith(`- ${userLabel}：`) || /\[代码|结论|约定|方案|架构/.test(l))
      .map((l) => (l.length > 96 ? `${l.slice(0, 96)}…` : l))
      .slice(-14);

    mergedSummary = [
      ...headLines,
      ...(condensedMiddle.length > 0 ? ['### 中期关键脉络留存', ...condensedMiddle] : []),
      '### 近期前情衔接',
      ...tailLines
    ].join('\n');
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
 * 按轮次上限与 Token 预算双重守护截取活跃对话原话窗口：
 * 既支持默认 40~48 条超长完整对话记忆，又防止单条万字日志意外撑爆小容量网关上下文上限。
 */
function selectBudgetedActiveWindow(allMessages, maxTurns = 40, maxTokenBudget = 36000) {
  if (!Array.isArray(allMessages) || allMessages.length === 0) return [];
  const sliced = allMessages.slice(-Math.max(6, maxTurns));
  const chosen = [];
  let accTokens = 0;

  for (let i = sliced.length - 1; i >= 0; i--) {
    const msg = sliced[i];
    const est = estimateTokens(msg.content || '');
    // 保底至少保留最近 6 条消息（3 轮问答），其余在 36K Token 预算内尽可能全量保留
    if (chosen.length >= 6 && accTokens + est > maxTokenBudget) {
      break;
    }
    chosen.push(msg);
    accTokens += est;
  }

  chosen.reverse();
  // 尽量保持从 user 轮对齐切片起点，避免把上一轮的提问切掉只留孤零零的回答
  if (chosen.length > 2 && chosen[0].role === 'assistant') {
    chosen.shift();
  }
  return chosen;
}

/**
 * 构建四维长效上下文载荷（核心设定锚点 + 永久置顶/艾宾浩斯长期记忆 + 高保真分层滚动摘要 + Token 预算守护长滑动窗口）
 */
function buildThreeTierContext({ sessionId, expectedUserId = null, latestUserText, settings, reinforceMemories = false }) {
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
  if (!session) throw new Error('未找到对应的对话会话');
  if (expectedUserId && session.user_id !== expectedUserId) {
    throw new Error('越权拦截：无权读取其他用户的隔离会话上下文');
  }

  const userRow = db.prepare('SELECT * FROM users WHERE id = ?').get(session.user_id);
  const userNick = userRow?.nickname || '旅人';

  const isNativeMode = session.session_mode === 'deepseek_native';
  const configuredTurns = Math.max(6, parseInt(settings.sliding_window_turns || '40', 10));
  // DeepSeek 原生模式默认启用更深的长上下文记忆窗口（至少 48 条完整消息，除非用户手动调得更高）
  const slidingTurns = isNativeMode ? Math.max(48, configuredTurns) : configuredTurns;
  const maxRecall = Math.max(6, parseInt(settings.max_recalled_memories || '16', 10));

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

  const activeWindowMessages = selectBudgetedActiveWindow(allMessages, slidingTurns, 36000);
  const recentSnippet = activeWindowMessages
    .slice(-5)
    .map((m) => m.content)
    .join(' ');

  // 1. 艾宾浩斯遗忘曲线 + 置顶铁律记忆全模式唤醒（包含 DeepSeek 原生模式！）
  const recalledMemories = recallRelevantMemories(
    sessionId,
    latestUserText || '',
    recentSnippet,
    maxRecall,
    reinforceMemories
  );

  // 2. 世界书关键词动态触发
  const triggeredLorebooks = matchLorebookEntries(
    session.persona_id,
    session.user_id,
    `${latestUserText || ''} ${recentSnippet}`
  );

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

  let hasCustomPersonaOverride = false;
  if (session.custom_persona_override) {
    try {
      const parsedOv = JSON.parse(session.custom_persona_override);
      hasCustomPersonaOverride = Boolean(
        parsedOv &&
          typeof parsedOv === 'object' &&
          Object.values(parsedOv).some((v) => typeof v === 'string' && v.trim())
      );
    } catch {}
  }

  const isPureOfficial = persona.id === 'persona_deepseek_official' && !hasCustomPersonaOverride;
  const rawSessionPrompt = String(session.session_prompt || '').trim();
  const renderedSessionPrompt = rawSessionPrompt
    ? replaceRoleplayMacros(rawSessionPrompt, userNick, persona.name)
    : '';
  const rawDirectorNote = String(session.director_note || '').trim();
  const renderedDirectorNote = rawDirectorNote
    ? replaceRoleplayMacros(rawDirectorNote, userNick, persona.name)
    : '';

  let tier1PersonaBlock = '';
  let dynamicTailStatusBlock = '';

  if (isNativeMode && isPureOfficial) {
    tier1PersonaBlock = [
      `你是 DeepSeek，当前运行在「极简沉浸剧本与智能对话双栖模式」（开箱即适配剧本扮演、平行设定推演与日常对谈，无需用户手动配置参数）：`,
      renderedSessionPrompt
        ? `\n## 🎯 本对话专属独立设定与剧本规则（最高优先级，仅在当前对话框内生效）\n${renderedSessionPrompt}`
        : '',
      renderedDirectorNote
        ? `\n## 🎬 当前对话场景氛围与补充指令\n${renderedDirectorNote}`
        : '',
      ``,
      `## 一、默认剧本扮演优先准则（零配置自动生效）`,
      `1. **遇到故事、设定或对白立即沉浸开演**：只要用户给出了角色/世界观设定、写下故事开场白、导入了过往记忆，或以对话台词/动作与你互动，请**立即以高代入感的沉浸式剧本笔触回应**——自然融合细腻克制的 \`*星号环境光影与神态动作细节*\` 与鲜活立体的人物台词，拒绝跳戏、拒绝AI客服腔，每轮自然推进半步剧情并留出互动契机。`,
      `2. **一对话一设定、一对话一记忆**：严格遵循当前对话框独立的专属设定、长期记忆锚点与前情浓缩摘要，前后人设性格、称呼与伏笔保持 100% 连贯一致。`,
      `3. **兼顾日常交流**：仅当用户未设定任何剧本背景、单纯询问日常客观问题时，采用干净平实、直击本质的自然段落作答，拒绝空洞套话与多余寒暄。`
    ]
      .filter(Boolean)
      .join('\n');
  } else if (isNativeMode) {
    tier1PersonaBlock = [
      `# DeepSeek 极简界面 · 角色剧本沉浸扮演核心设定（最高优先级，严禁跳戏）`,
      `- **你的身份**：${persona.name}${persona.tagline ? `（${persona.tagline}）` : ''}`,
      persona.personality ? `- **性格特质**：${persona.personality}` : '',
      persona.backstory ? `- **世界观与背景故事**：\n${persona.backstory}` : '',
      persona.speaking_style ? `- **语言风格与神态基调**：${persona.speaking_style}` : '',
      `\n## 站在你面前的对话者（主控人设）`,
      ...userPersonaLines,
      renderedSessionPrompt
        ? `\n## 🎯 本对话专属独立设定与平行世界规则（最高优先级，仅当前对话生效）\n${renderedSessionPrompt}`
        : '',
      renderedDirectorNote
        ? `\n## 🎬 当前对话场景补充指引\n${renderedDirectorNote}`
        : '',
      `\n## 剧本演绎与记忆一致性准则`,
      `1. **沉浸式剧本代入感**：始终以「${persona.name}」的第一人称视角实时演绎，贴合性格底色与人物弧光，适度运用细腻自然的 \`*星号神态与环境分镜描写*\` 营造真实故事氛围，每轮回复实质性推进当前剧情。`,
      `2. **牢记本对话独立记忆与设定**：严格呼应当前对话框专属的长期记忆条目、前情摘要与独立设定中的约定、称呼与伏笔，绝不遗忘或串戏。`
    ]
      .filter(Boolean)
      .join('\n');
  } else {
    // 静态核心人设放在最前部，保持第 0 Token 起的系统前缀完全稳定，最大化 DeepSeek 官方硬盘缓存 (Context Caching) 命中率！
    tier1PersonaBlock = [
      `# 角色扮演核心设定（最高优先级，严禁跳戏或暴露AI身份）`,
      `- **角色姓名**：${persona.name}`,
      persona.tagline ? `- **身份定位**：${persona.tagline}` : '',
      persona.personality ? `- **性格特质**：${persona.personality}` : '',
      persona.backstory ? `- **世界观与背景故事**：\n${persona.backstory}` : '',
      persona.speaking_style ? `- **语言风格与神态规范**：${persona.speaking_style}` : '',
      `\n## 站在你面前的对话者（主控人设，请在目光、称呼与互动中自然呼应）`,
      ...userPersonaLines,
      renderedSessionPrompt
        ? `\n## 🎯 本对话专属独立设定 / 平行世界规则（仅当前存档独立生效，优先级高于通用背景）\n${renderedSessionPrompt}`
        : '',
      `\n## 互动演绎与故事推进准则（参考 CLANNAD / 顶级视觉小说叙事节奏）`,
      `1. 始终以「${persona.name}」的第一人称视角与「${userNick}」实时对话，语气亲疏程度契合当前关系养成阶段与本对话独立设定，牢记本对话长期记忆与前情摘要中的一切细节约定。`,
      `2. 善用 *星号包裹的番剧分镜式细节描写*（如光影流转、微风声响、眼神停顿、手边器物触感）营造电影级代入感。`,
      `3. **聊天推进剧情铁律（Story-Driven Progression）**：每一轮回复都必须实质性推动当前场景往前走半步，承接对方选择后自然引入新的事件线索或伏笔，并在结尾留出具体的行动抉择契机。`
    ]
      .filter(Boolean)
      .join('\n');

    dynamicTailStatusBlock = [
      `## 实时关系阶段与场景心境指引`,
      `- ${nurturing.stage.promptDirective}`,
      `- 此刻心境基调：${nurturing.current_mood}`,
      renderedDirectorNote ? `- 当下场景导演提示：${renderedDirectorNote}` : ''
    ]
      .filter(Boolean)
      .join('\n');
  }

  // 固定输出协议置于静态前缀后紧接位置，防止因动态记忆增减导致前缀漂移
  const enableThought = isNativeMode ? session.ds_thinking === 1 : session.enable_inner_thought === 1;
  const thoughtProtocolBlock = isNativeMode
    ? ''
    : enableThought
    ? `## 角色心声独白输出协议\n在正式开口回复前，若模型未单独返回 reasoning_content，请先在最开头使用 \`<think>...</think>\` 标签写一段简短的第一人称角色心声独白（50~110字，结合当前关系心境、唤醒的记忆及内心潜台词），然后再在 \`</think>\` 之后输出正式台词与神态描写。`
    : `## 输出格式要求\n请直接输出角色台词与神态描写，不要输出 \`<think>\` 标签。`;

  // 第二层：会话级独立长期记忆锚点 + 分层滚动前情摘要 + 世界书词条（去除每轮浮动的鲜活度百分比数字以稳定缓存前缀）
  const tier2Parts = [];
  const pinnedMems = recalledMemories.filter((m) => m.pinned === 1);
  const dynamicMems = recalledMemories.filter((m) => m.pinned !== 1);

  if (pinnedMems.length > 0) {
    const pinLines = pinnedMems.map((m) => `- [核心记忆] ${m.content}`);
    tier2Parts.push(`## 本对话永久核心记忆锚点（最高一致性，自然融入演绎）\n${pinLines.join('\n')}`);
  }
  if (rollingSummary && rollingSummary.trim()) {
    tier2Parts.push(`## 阶段前情浓缩摘要\n${rollingSummary.trim()}`);
  }
  if (triggeredLorebooks.length > 0) {
    const loreLines = triggeredLorebooks.map((l) => `- 【${l.title}】${l.content}`);
    tier2Parts.push(`## 本轮触发的世界书隐藏设定\n${loreLines.join('\n')}`);
  }
  if (dynamicMems.length > 0) {
    const dynLines = dynamicMems.map((m) => `- [关联记忆] ${m.content}`);
    tier2Parts.push(`## 本轮唤醒的过往记忆细节\n${dynLines.join('\n')}`);
  }
  if (dynamicTailStatusBlock) {
    tier2Parts.push(dynamicTailStatusBlock);
  }
  const tier2MemoryBlock = tier2Parts.join('\n\n');

  const fullSystemPrompt = [tier1PersonaBlock, thoughtProtocolBlock, tier2MemoryBlock]
    .filter(Boolean)
    .join('\n\n');

  const rawPayload = [
    { role: 'system', content: fullSystemPrompt },
    ...activeWindowMessages.map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content
    }))
  ];

  // 执行严格对话交替与空洞自愈，确保发送给任何大模型网关均 100% 稳定无 400 报错
  const messagesPayload = normalizeMessagesForStrictLLM(rawPayload);

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
  normalizeMessagesForStrictLLM,
  decorateMemoriesWithRetention,
  recallRelevantMemories,
  extractFactsFromUserTurn,
  matchLorebookEntries,
  compressOverflowHistorySync,
  resolveEffectivePersona,
  buildThreeTierContext
};

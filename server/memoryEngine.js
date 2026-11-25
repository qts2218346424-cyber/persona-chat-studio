const { db, genId, STORY_SCRIPTS } = require('./db');
const {
  formatNurturingSnapshot,
  ensureAndEvolveWorldContext,
  computeDynamicReplyPacing
} = require('./nurturingEngine');

const FEMALE_PERSONA_IDS = new Set([
  'persona_nagisa_sakura',
  'persona_kagaribi_kyou',
  'persona_ichinose_kotomi',
  'persona_makise_sei',
  'persona_asagiri_mio',
  'persona_violet_eve',
  'persona_suwanqing',
  'persona_yunzhiyao',
  'persona_xia_ningmeng',
  'persona_yan_feiyu'
]);

const MALE_PERSONA_IDS = new Set([
  'persona_shenxinghui',
  'persona_luchen',
  'persona_xieqingyan',
  'persona_jiangyubai',
  'persona_jiran',
  'persona_guxiuyuan',
  'persona_shiraishi_rin',
  'persona_hodgins_landon',
  'persona_frieren_shuer',
  'persona_stark_fer'
]);

function inferPersonaPronoun(persona = {}) {
  const explicitGender = String(persona.gender || '').trim().toLowerCase();
  if (explicitGender === 'female' || explicitGender === '女' || explicitGender === 'f') return '她';
  if (explicitGender === 'male' || explicitGender === '男' || explicitGender === 'm') return '他';

  const id = String(persona.id || '');
  if (FEMALE_PERSONA_IDS.has(id)) return '她';
  if (MALE_PERSONA_IDS.has(id)) return '他';
  const desc = `${persona.name || ''} ${persona.category_tag || ''} ${persona.tagline || ''} ${persona.personality || ''} ${persona.greeting || ''}`;
  if (/女执政官|神女|师姐|学妹|学姐|御姐|甜妹|歌姬|大小姐|巫女|修女|女王|公主|名伶|女家主|少女|女生|女孩|姐姐|仙子|双马尾/.test(desc) && !/少年|公子|先生|学弟|男主|剑尊/.test(desc)) {
    return '她';
  }
  const sheCount = (desc.match(/她/g) || []).length;
  const heCount = (desc.match(/他/g) || []).length;
  if (sheCount > heCount) return '她';
  if (/[妍婷薇柔婉菲瑶晴柠汐琴奈澪琳樱雪莉娜茜媛妃姝娴]/.test(persona.name || '') && heCount === 0) {
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

  // 若对话区第一条是 assistant（例如剧本角色开场白），仅在开局前几轮将其融合进上下文，避免长对话反复锚定开场瞬间
  if (dialogue.length > 0 && dialogue[0].role === 'assistant' && !dialogue[0].tool_calls) {
    const openingGreeting = dialogue.shift().content.trim();
    if (openingGreeting && dialogue.length <= 3) {
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
    .prepare('SELECT * FROM memories WHERE session_id = ? AND superseded_by IS NULL ORDER BY pinned DESC, importance DESC, updated_at DESC')
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
      slot_key: 'pref_drink',
      importance: 4,
      pinned: 0,
      regex: /(?:我?(?:最近|现在|其实)?(?:改喝|只喝|爱喝|喜欢喝|偏爱喝|常喝|戒掉了?|不再喝|不喜欢喝|讨厌喝))\s*([^，,。！？!?\n]{2,36})/u,
      format: (m) => `饮品偏好与变化：${m[0].trim()}`
    },
    {
      category: 'fact',
      slot_key: 'pref_food',
      importance: 4,
      pinned: 0,
      regex: /(?:我?(?:最近|现在|其实)?(?:改吃|只吃|爱吃|喜欢吃|偏爱吃|常吃|不爱吃|不再吃|不喜欢吃|讨厌吃))\s*([^，,。！？!?\n]{2,36})/u,
      format: (m) => `饮食偏好与变化：${m[0].trim()}`
    },
    {
      category: 'fact',
      slot_key: null,
      importance: 4,
      pinned: 0,
      regex: /(?:我?(?:最近|现在|其实)?(?:最喜欢|最爱|挺喜欢|很喜欢|喜欢|习惯用|偏好|不再喜欢|不喜欢|讨厌|最怕|害怕))\s*([^，,。！？!?\n]{2,48})/u,
      validate: (m) => {
        const val = String(m[1] || '').trim();
        return val.length >= 2 && !/^(?:什么|这个|那个|这样|那样|这里|那里)$/.test(val);
      },
      format: (m) => `个人偏好与情感倾向：${m[0].trim()}`
    },
    {
      category: 'fact',
      slot_key: 'mood_status',
      importance: 3,
      pinned: 0,
      regex: /(?:我?(?:最近|现在|其实|今天|这几天)(?:状态|心情|感觉|有点|有些|一直)?(?:很|挺|特别|有点|有些)?(?:累|疲惫|难过|开心|焦虑|失眠|兴奋|开心|紧张|忙|压力大))\s*([^。！？!?\n]{0,36})/u,
      format: (m) => `近期心境与状态：${m[0].trim()}`
    },
    {
      category: 'fact',
      slot_key: 'user_birthday',
      importance: 5,
      pinned: 1,
      regex: /(?:我的生日是|我生日在)\s*([^，,。！？!?\n]{2,32})/u,
      format: (m) => `重要纪念日：${m[0].trim()}`
    }
  ];

  const inferMemoryTopicAndPolarity = (text, slotKey) => {
    const clean = String(text || '').trim();
    const isNeg = /(?:不再喜欢|不喜欢|讨厌|最怕|害怕|戒掉|不爱吃|不再吃|不再喝|讨厌吃|讨厌喝|拒绝)/.test(clean);
    let topic = slotKey || '';
    if (!topic) {
      if (/喝|茶|咖啡|奶茶|拿铁|可乐|酒|水/.test(clean)) topic = 'pref_drink';
      else if (/吃|甜点|火锅|面|蛋糕|水果|辛辣|辣/.test(clean)) topic = 'pref_food';
      else if (/睡|熬夜|累|心情|焦虑|难过|开心|失眠|压力/.test(clean)) topic = 'mood_status';
      else if (/颜色|蓝|红|黑|白|粉|紫|金/.test(clean)) topic = 'pref_color';
      else {
        const subjectMatch = clean.replace(/^[^：]+：/, '').replace(/(?:我|最近|现在|其实|最喜欢|最爱|不再喜欢|不喜欢|讨厌|喜欢|偏好|习惯用|害怕|最怕)/g, '').trim();
        const subjectKey = subjectMatch.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '').slice(0, 6);
        if (subjectKey.length >= 2) topic = `subj_${subjectKey}`;
      }
    }
    return { topic, polarity: isNeg ? -1 : 1 };
  };

  const existingRows = db
    .prepare('SELECT * FROM memories WHERE session_id = ? AND superseded_by IS NULL')
    .all(sessionId);
  const now = Date.now();
  const extracted = [];

  const supersedeOldStmt = db.prepare(`
    UPDATE memories
    SET superseded_by = ?, pinned = 0, updated_at = ?
    WHERE id = ?
  `);

  const updateSlotStmt = db.prepare(`
    UPDATE memories
    SET content = ?, pinned = MAX(pinned, ?), strength = MIN(30.0, COALESCE(strength, 6.0) + 2.5),
        last_recalled_at = ?, updated_at = ?
    WHERE id = ?
  `);

  const insertStmt = db.prepare(`
    INSERT INTO memories (id, session_id, category, slot_key, content, pinned, importance, strength, recall_count, last_recalled_at, superseded_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, NULL, ?, ?)
  `);

  for (const seg of segments) {
    if (isInterrogativeSegment(seg, strippedCode)) continue;
    for (const rule of patterns) {
      const match = seg.match(rule.regex);
      if (!match) continue;
      if (typeof rule.validate === 'function' && !rule.validate(match)) continue;

      const factText = rule.format(match);
      const isPinned = rule.pinned ? 1 : 0;
      const newInfo = inferMemoryTopicAndPolarity(factText, rule.slot_key);
      const effectiveSlot = rule.slot_key || (newInfo.topic ? newInfo.topic : null);

      // 1. 唯一槽位或同主题冲突检测（Memory Superseding）：如旧记忆存在冲突，标记 superseded_by 而非保留打架
      let conflictTarget = null;
      if (effectiveSlot) {
        conflictTarget = existingRows.find(
          (r) => !r.superseded_by && (r.slot_key === effectiveSlot || inferMemoryTopicAndPolarity(r.content, r.slot_key).topic === effectiveSlot)
        );
      }
      if (!conflictTarget && newInfo.topic) {
        const newCoreTokens = tokenizeForRecall(factText.replace(/(?:不再喜欢|不喜欢|讨厌|喜欢|最爱|偏好|其实|最近|现在)/g, ''));
        conflictTarget = existingRows.find((r) => {
          if (r.superseded_by) return false;
          const oldInfo = inferMemoryTopicAndPolarity(r.content, r.slot_key);
          if (oldInfo.topic && oldInfo.topic === newInfo.topic) return true;
          if (oldInfo.polarity !== newInfo.polarity && newCoreTokens.size > 0) {
            const oldTokens = tokenizeForRecall(r.content);
            for (const t of newCoreTokens) {
              if (oldTokens.has(t)) return true;
            }
          }
          return false;
        });
      }

      if (conflictTarget) {
        if (conflictTarget.content === factText) {
          continue;
        }
        const newId = genId('mem');
        const initStrength = isPinned || conflictTarget.pinned === 1 ? 12.0 : 7.0;
        const keepPinned = isPinned || conflictTarget.pinned === 1 ? 1 : 0;
        insertStmt.run(
          newId,
          sessionId,
          rule.category,
          effectiveSlot,
          factText,
          keepPinned,
          rule.importance,
          initStrength,
          now,
          now,
          now
        );
        supersedeOldStmt.run(newId, now, conflictTarget.id);
        conflictTarget.superseded_by = newId;
        existingRows.push({
          id: newId,
          category: rule.category,
          slot_key: effectiveSlot,
          content: factText,
          pinned: keepPinned,
          superseded_by: null
        });
        extracted.push({
          id: newId,
          category: rule.category,
          content: factText,
          superseded_id: conflictTarget.id,
          updated_existing: true
        });
        continue;
      }

      // 2. 高重合度近似记忆合并检测
      const newTokens = tokenizeForRecall(factText);
      let duplicateOrSimilar = null;
      for (const old of existingRows) {
        if (old.superseded_by) continue;
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
        effectiveSlot,
        factText,
        isPinned,
        rule.importance,
        initStrength,
        now,
        now,
        now
      );
      existingRows.push({ id, category: rule.category, slot_key: effectiveSlot, content: factText, pinned: isPinned, superseded_by: null });
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
function compressOverflowHistorySync(sessionId, slidingWindowTurns = 40, options = {}) {
  const forceManual = Boolean(options && options.forceManual);
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

  let overflowMessages = [];
  if (forceManual) {
    // 用户主动点击「一键总结前情」：直接将尚未总结的最新对话提炼为前情提要（不受 40 轮滑窗门槛限制）
    if (allMessages.length < 2) {
      return session.rolling_summary || '';
    }
    const unsummarized = allMessages.filter((m) => m.id > safeCursor);
    overflowMessages = unsummarized.length > 0 ? unsummarized : allMessages.slice(-12);
    if (unsummarized.length === 0) {
      // 若全部已总结过，重新生成一份精炼完整版摘要供用户查看
      safeCursor = 0;
      overflowMessages = allMessages;
    }
  } else {
    const keepCount = Math.max(8, Number(slidingWindowTurns) || 40);
    if (allMessages.length <= keepCount + 2) {
      return session.rolling_summary;
    }

    const cutoffIndex = allMessages.length - keepCount;
    overflowMessages = allMessages
      .slice(0, cutoffIndex)
      .filter((m) => m.id > safeCursor);

    if (overflowMessages.length < 2) {
      return session.rolling_summary;
    }
  }

  const userLabel = isNativeMode ? '用户' : '我';
  const aiLabel = isNativeMode ? 'DeepSeek' : 'TA';

  const digestSnippets = [];
  for (const msg of overflowMessages) {
    const summaryLine = summarizeSingleMessageForRolling(msg, isNativeMode);
    if (!summaryLine) continue;
    const speaker = msg.role === 'user' ? userLabel : aiLabel;
    digestSnippets.push(`- ${speaker}：${summaryLine}`);
  }

  const basePrevious = forceManual && safeCursor === 0 ? '' : session.rolling_summary ? `${session.rolling_summary.trim()}\n` : '';
  let mergedSummary = `${basePrevious}${digestSnippets.join('\n')}`.trim();

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
  if (session.user_id) {
    try {
      const ovAv = db
        .prepare('SELECT avatar_url FROM user_persona_avatars WHERE user_id = ? AND persona_id = ?')
        .get(session.user_id, basePersona.id);
      if (ovAv?.avatar_url) {
        basePersona = { ...basePersona, avatar: ovAv.avatar_url };
      }
    } catch {}
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

function resolveScriptChaptersForSession(session, persona) {
  const scriptId = persona?.script_id || '';
  if (!scriptId) return [];
  const builtin = (STORY_SCRIPTS || []).find((s) => s.id === scriptId);
  if (builtin && Array.isArray(builtin.chapters)) {
    return builtin.chapters;
  }
  try {
    const customSc = db.prepare('SELECT chapters_json FROM user_scripts WHERE id = ?').get(scriptId);
    if (customSc?.chapters_json) {
      const parsed = JSON.parse(customSc.chapters_json);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {}
  return [];
}

function evaluateChapterProgression({ sessionId, persona, userText = '', assistantText = '', triggeredLorebooks = [] }) {
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
  if (!session || session.session_mode === 'deepseek_native') return null;
  const chapters = resolveScriptChaptersForSession(session, persona);
  if (!Array.isArray(chapters) || chapters.length <= 1) return null;

  const currentIdx = Math.max(0, Math.min(chapters.length - 1, Number(session.current_chapter_index) || 0));
  if (currentIdx >= chapters.length - 1) return null;

  const curChap = chapters[currentIdx] || {};
  const nextChap = chapters[currentIdx + 1] || {};
  const combinedTurnText = `${userText || ''} ${assistantText || ''}`;

  // 检查是否已触发该角色全部世界书伏笔
  let allLoreTriggered = false;
  try {
    const totalLoreRows = db
      .prepare("SELECT id FROM lorebook_entries WHERE persona_id = ? AND (user_id = 'system' OR user_id = ?) AND enabled = 1")
      .all(session.persona_id, session.user_id);
    if (totalLoreRows.length > 0) {
      const recentMsgs = db
        .prepare("SELECT content FROM messages WHERE session_id = ? ORDER BY id DESC LIMIT 12")
        .all(sessionId)
        .map((m) => m.content || '')
        .join(' ');
      const matched = matchLorebookEntries(session.persona_id, session.user_id, `${recentMsgs} ${combinedTurnText}`);
      if (matched.length >= totalLoreRows.length) {
        allLoreTriggered = true;
      }
    }
  } catch {}

  const cp = curChap.checkpoint || {};
  const cpKeywords = Array.isArray(cp.keywords) ? cp.keywords.filter(Boolean) : [];
  const nextCueTokens = tokenizeForRecall(`${nextChap.title || ''} ${nextChap.note || ''}`);
  const turnTokens = tokenizeForRecall(combinedTurnText);
  let cueOverlap = 0;
  for (const tok of nextCueTokens) {
    if (turnTokens.has(tok)) cueOverlap += 1;
  }
  const minTurns = Math.max(2, Number(cp.min_turns) || 4);

  const userTurnCount = db
    .prepare("SELECT COUNT(*) AS cnt FROM messages WHERE session_id = ? AND role = 'user'")
    .get(sessionId)?.cnt || 0;

  const hitCheckpointKeyword = cpKeywords.some((kw) => combinedTurnText.includes(String(kw)));
  const hitTransitionCue = cueOverlap >= 2;
  const enoughTurnsAndHint =
    userTurnCount >= (currentIdx + 1) * minTurns &&
    (hitCheckpointKeyword || hitTransitionCue || (triggeredLorebooks && triggeredLorebooks.length > 0));

  if (!allLoreTriggered && !hitCheckpointKeyword && !enoughTurnsAndHint) {
    return null;
  }

  const nextIdx = currentIdx + 1;
  const nextNote = String(nextChap.note || nextChap.title || '').trim();
  db.prepare(`
    UPDATE sessions
    SET current_chapter_index = ?, director_note = ?, updated_at = ?
    WHERE id = ?
  `).run(nextIdx, nextNote, Date.now(), sessionId);

  return {
    advanced: true,
    previous_index: currentIdx,
    current_index: nextIdx,
    act_number: nextIdx + 1,
    total_acts: chapters.length,
    chapter: nextChap
  };
}

/**
 * 构建四维长效上下文载荷（核心设定锚点 + 永久置顶/艾宾浩斯长期记忆 + 高保真分层滚动摘要 + Token 预算守护长滑动窗口）
 */
function buildThreeTierContext({
  sessionId,
  expectedUserId = null,
  latestUserText,
  settings,
  reinforceMemories = false,
  skipSyncCompression = false,
  includeFollowUps = false
}) {
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
  if (!session) throw new Error('未找到对应的对话会话');
  if (expectedUserId && session.user_id !== expectedUserId) {
    throw new Error('越权拦截：无权读取其他用户的隔离会话上下文');
  }

  const userRow = db.prepare('SELECT * FROM users WHERE id = ?').get(session.user_id);
  const userNick = userRow?.nickname || '旅人';

  const isNativeMode = session.session_mode === 'deepseek_native';
  const isCharacterChat = session.session_mode === 'character_chat';
  const configuredTurns = Math.max(6, parseInt(settings.sliding_window_turns || '40', 10));
  // DeepSeek 原生模式默认启用更深的长上下文记忆窗口（至少 48 条完整消息，除非用户手动调得更高）
  const slidingTurns = isNativeMode ? Math.max(48, configuredTurns) : configuredTurns;
  const maxRecall = Math.max(6, parseInt(settings.max_recalled_memories || '16', 10));

  const rollingSummary = skipSyncCompression
    ? session.rolling_summary || ''
    : compressOverflowHistorySync(sessionId, slidingTurns);
  const rawPersona = resolveEffectivePersona(session);
  const persona = {
    ...rawPersona,
    tagline: replaceRoleplayMacros(rawPersona.tagline, userNick, rawPersona.name),
    personality: replaceRoleplayMacros(rawPersona.personality, userNick, rawPersona.name),
    backstory: replaceRoleplayMacros(rawPersona.backstory, userNick, rawPersona.name),
    speaking_style: replaceRoleplayMacros(rawPersona.speaking_style, userNick, rawPersona.name),
    greeting: replaceRoleplayMacros(rawPersona.greeting, userNick, rawPersona.name)
  };
  const allMessages = db
    .prepare('SELECT id, role, content, reasoning FROM messages WHERE session_id = ? ORDER BY id ASC')
    .all(sessionId);

  const worldContext = !isNativeMode
    ? ensureAndEvolveWorldContext(session, persona, latestUserText || '', allMessages.length)
    : null;
  const nurturing = formatNurturingSnapshot(session);

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

  // 2. 世界书关键词动态触发（仅在剧本扮演模式下启用，DeepSeek 问答模式不触发剧本世界书）
  const triggeredLorebooks = !isNativeMode
    ? matchLorebookEntries(
        session.persona_id,
        session.user_id,
        `${latestUserText || ''} ${recentSnippet}`
      )
    : [];

  const isStandaloneUserPersona =
    rawPersona.user_id &&
    rawPersona.user_id !== 'system' &&
    rawPersona.user_id !== 'system_ds' &&
    !/【(?:共创剧本|所属剧本)/.test(String(rawPersona.backstory || ''));

  let activeScriptRole = '';
  if (!isStandaloneUserPersona) {
    activeScriptRole = (STORY_SCRIPTS || []).find((s) => s.id === rawPersona.script_id)?.player_role || '';
    if (!activeScriptRole && rawPersona.script_id) {
      const customSc = db.prepare('SELECT player_role FROM user_scripts WHERE id = ?').get(rawPersona.script_id);
      if (customSc?.player_role) activeScriptRole = customSc.player_role;
    }
  }
  const rawUserRole = (userRow?.user_persona_role || '').trim();
  const effectiveUserRole =
    !rawUserRole || rawUserRole === '命中注定的重逢旅人'
      ? isStandaloneUserPersona
        ? '与你初次相遇的对话者'
        : activeScriptRole || '与你相遇的同行者'
      : rawUserRole;

  const isCustomUserNick = Boolean(userNick && !/^星[语屿]旅人/.test(userNick));
  const userPersonaLines = [
    isCustomUserNick
      ? `- **对方在故事里的名字（最高优先级，请直接这样称呼对方）**：「${userNick}」`
      : `- **对方默认代称**：${userNick}（对方尚未改名时自然用“你”称呼即可）`,
    `- **在本剧中的身份**：${effectiveUserRole}`
  ];
  if (userRow?.user_persona_appearance) {
    userPersonaLines.push(`- **对方外貌与穿搭细节**：${userRow.user_persona_appearance}`);
  }
  if (userRow?.user_persona_bio) {
    userPersonaLines.push(`- **对方性格与补充设定**：${userRow.user_persona_bio}`);
  }

  let hasCustomPersonaOverride = false;
  if (session.user_id) {
    try {
      const ovAv = db
        .prepare('SELECT avatar_url FROM user_persona_avatars WHERE user_id = ? AND persona_id = ?')
        .get(session.user_id, basePersona.id);
      if (ovAv?.avatar_url) {
        basePersona = { ...basePersona, avatar: ovAv.avatar_url };
      }
    } catch {}
  }
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

  if (isNativeMode) {
    tier1PersonaBlock = [
      `你是 DeepSeek，由深度求索（DeepSeek）研发的智能助手，当前运行在「DeepSeek 问答模式」。请严格遵循正版 DeepSeek 的专业回答风格：`,
      renderedSessionPrompt
        ? `\n## 🎯 本对话系统指令 (System Prompt，仅当前对话生效，优先级最高)\n${renderedSessionPrompt}`
        : '',
      ``,
      `## 核心问答规范`,
      `1. **直击本质、拒绝寒暄套话**：严禁使用“好的，没问题！”、“下面我将从以下几个方面展开”等机械开场白。面对知识、技术、代码或分析类问题，首段直接用 1~3 句话给出核心结论或本质定义，再展开细节。`,
      `2. **按需结构化输出**：简单事实与日常问题用清晰简短的自然段落作答；复杂工程设计、数学推导与方案对比请使用严谨的 Markdown 标题、列表、表格与 LaTeX 公式（行内 \`$...$\`，块级 \`$$...$$\`）；前端可视化需求优先提供完整可运行的单文件 HTML/Canvas/SVG 代码以便用户直接右侧实时预览。`,
      `3. **专业克制与上下文一致**：严禁擅自使用剧本扮演的 \`*星号动作描写*\` 或角色扮演腔调；严格遵循本对话长期记忆与前情摘要中的用户偏好与项目背景约束。`
    ]
      .filter(Boolean)
      .join('\n');
  } else if (isCharacterChat) {
    const callName = (rawPersona.user_call_name || '').trim() || (isCustomUserNick ? userNick : '你');
    const cleanField = (txt) =>
      String(txt || '')
        .replace(/【(?:所属剧本|共创剧本)[^】]*】/g, '')
        .trim();
    tier1PersonaBlock = [
      `# 角色演绎 · 真人模拟对话核心协议（最高优先级 · 绝不跳戏、绝不写旁白）`,
      `你就是「${persona.name}」本人，正在与「${callName}」进行真实、自然、生活化的人类日常对话（就像两个熟悉或刚刚熟络起来的真人在微信聊天或面对面随意交谈）。`,
      persona.tagline ? `- **你的日常形象与标签**：${cleanField(persona.tagline)}` : '',
      persona.personality ? `- **你的真实性格与脾气**：${cleanField(persona.personality)}` : '',
      persona.backstory ? `- **你与对方的关系与生活背景**：${cleanField(persona.backstory)}` : '',
      persona.speaking_style ? `- **你的说话风格与口癖**：${cleanField(persona.speaking_style)}` : '',
      `- **你对聊天对象的称呼**：${callName}`,
      renderedSessionPrompt
        ? `\n## 🎯 本对话专属设定（仅当前对话生效，优先级最高）\n${renderedSessionPrompt}`
        : '',
      `\n## 真人模拟对话三大铁律（违者直接失败，务必严格遵守）`,
      `1. **🚫 绝对禁止旁白、动作描写与舞台腔**：**严禁出现 \`*任何星号动作描写*\`、\`（任何括号神态/动作旁白）\`、第三人称心理叙述或小说体环境渲染！** 只输出真人嘴巴里直接说出来的话（或直接发出去的微信消息文字）。`,
      `2. **真实人类聊天节奏与口语呼吸感**：像真人发消息/日常唠嗑一样说话！篇幅完全随心情、关系、状态和话题变化——有时只回三五个字或 1 句话，聊顺了再 2~3 句，走心深聊才展开；自带自然口语词、停顿、调侃、反问或小情绪，禁止写排比抒情小作文，禁止每句末尾强行抛“A还是B”的选择题。`,
      `3. **独立活人感与真实边界**：你有自己的真实生活、即时状态、天气体感、小脾气和独立观点，不是顺从的 AI 客服。必须第一时间接住「${callName}」刚才说的具体话茬做出真实人类反应；严禁暴露 AI 身份、严禁出现“请问有什么可以帮您”等机械词、严禁编造未曾聊过的虚假记忆。`
    ]
      .filter(Boolean)
      .join('\n');

    dynamicTailStatusBlock = [
      `## 此刻真实世界与身心状态`,
      `- **时段与天气**：${worldContext?.timePeriod || ''} · ${worldContext?.weather || '晴朗微风'}`,
      `- **你此刻在干嘛/状态**：${worldContext?.characterState || '正闲着看手机'}`,
      `- **你此刻的心情**：${nurturing.current_mood}`,
      `- **亲密程度与关系基调**：${nurturing.stage.promptDirective}`,
      worldContext?.activeEvent ? `- **手头刚发生/牵挂的小事**：${worldContext.activeEvent}` : '',
      renderedDirectorNote ? `- 当下聊天的补充背景提示：${renderedDirectorNote}` : ''
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
      `\n## 真实活人感与实时互动铁律（最高优先级 · 严禁模板八股）`,
      `1. **先接招，再回应（绝不自说自话）**：你必须读懂「${userNick}」上一句话的真实意思、语气（敷衍/撒娇/试探/认真/吐槽），第一时间做出贴合性格与当下心情的真实人类反应。`,
      `2. **打破AI长文与机械八股**：严禁每轮都凑“*环境描写+微动作* + 一大段深情台词 + 固定二选一反问”！真人相处时而惜字如金只回一句短话，时而心情好或聊深事才多说几句。不要刻意凑字数！`,
      `3. **🚫 严禁串戏与严禁编造记忆红线**：只能引用本提示词中明确列出的【永久核心记忆】【前情浓缩摘要】及下方【真实对话历史】里实际聊过的内容！绝对禁止无中生有编造对方“以前/上次说过某句话或某种喜好”。`
    ]
      .filter(Boolean)
      .join('\n');

    dynamicTailStatusBlock = [
      `## 此刻真实世界与角色状态（请自然融入语气与反应，切勿机械复述标签）`,
      `- **当前时段与天气**：${worldContext?.timePeriod || ''} · ${worldContext?.weather || '微风舒适'}`,
      `- **人物实时状态**：${worldContext?.characterState || '专注注视着你'}`,
      `- **此刻心境基调**：${nurturing.current_mood}`,
      `- ${nurturing.stage.promptDirective}`,
      worldContext?.activeEvent ? `- **当前关联微事件**：${worldContext.activeEvent}` : '',
      isCustomUserNick
        ? `- ⚠️ 最新称呼提醒：对方现在的名字是「${userNick}」，请在回复中自然称呼对方为「${userNick}」（即使上文早期消息中曾出现过「星屿旅人」等旧称呼，也必须立即改口叫「${userNick}」！）`
        : '',
      renderedDirectorNote ? `- 当下场景导演提示：${renderedDirectorNote}` : ''
    ]
      .filter(Boolean)
      .join('\n');
  }

  const pacing = !isNativeMode
    ? computeDynamicReplyPacing({
        session,
        persona,
        nurturing,
        worldContext,
        userText: latestUserText || '',
        hasTriggeredLore: triggeredLorebooks.length > 0,
        hasRecalledMemories: recalledMemories.length > 0,
        isCharacterChat
      })
    : null;

  // 固定输出协议置于静态前缀后紧接位置，防止因动态记忆增减导致前缀漂移
  const enableThought = isNativeMode ? session.ds_thinking === 1 : session.enable_inner_thought === 1;
  const followUpTailProtocol =
    includeFollowUps && !isNativeMode
      ? `\n\n## 隐藏玩家建议协议（严格执行 · 绝不暴露给玩家）\n在整段台词与动作描写完全结束后的最末一行，额外输出一行机器标签：\`<followups>["建议回复1","建议回复2","建议回复3"]</followups>\`，给出 3 条站在玩家视角紧扣本轮剧情的 12~34 字自然回复选项（JSON 字符串数组格式）。严禁在正文中提及该标签。`
      : '';
  const thoughtProtocolBlock = isNativeMode
    ? ''
    : enableThought
    ? isCharacterChat
      ? `## 角色即时内心 OS 协议\n正式回复前先在最开头用 \`<think>...</think>\` 写一小段真实的第一人称内心瞬间念头（15~45字，纯口语化心理波动，不要写动作或规则），然后在 \`</think>\` 后直接自然接上你的口语回复。${followUpTailProtocol}`
      : `## 角色心声独白协议\n正式回复前先在最开头用 \`<think>...</think>\` 写一小段第一人称真实心理反应（25~70字，紧扣对方刚说的话产生即时情绪波动或吐槽，自然口语化、不要总结规则或写八股），然后在 \`</think>\` 后直接自然接上对话与动作。${followUpTailProtocol}`
    : isCharacterChat
    ? `## 输出格式要求\n请直接输出真人口语回复内容，绝不输出 \`<think>\` 标签、星号动作或旁白。${followUpTailProtocol}`
    : `## 输出格式要求\n请直接输出角色台词与神态描写，不要输出 \`<think>\` 标签。${followUpTailProtocol}`;

  // 第二层：会话级独立长期记忆锚点 + 分层滚动前情摘要 + 世界书词条 + 当前剧本幕次导演指引
  const tier2Parts = [];
  const pinnedMems = recalledMemories.filter((m) => m.pinned === 1);
  const dynamicMems = recalledMemories.filter((m) => m.pinned !== 1);

  if (!isNativeMode && !isCharacterChat) {
    const chapters = resolveScriptChaptersForSession(session, rawPersona);
    if (chapters.length > 0) {
      const chapIdx = Math.max(0, Math.min(chapters.length - 1, Number(session.current_chapter_index) || 0));
      const curChap = chapters[chapIdx];
      if (curChap) {
        const cpHint = curChap.checkpoint?.hint ? `\n- 本幕剧情推进锚点：${curChap.checkpoint.hint}` : '';
        tier2Parts.push(
          `## 当前剧本幕次导演指引（第 ${chapIdx + 1} / ${chapters.length} 幕：${curChap.title || ''}）\n- 剧情大纲：${replaceRoleplayMacros(curChap.note || '', userNick, persona.name)}${cpHint}`
        );
      }
    }
  }

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
  if (pacing?.promptDirective) {
    tier2Parts.push(pacing.promptDirective);
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
    userNickname: userNick,
    nurturing,
    worldContext,
    pacing,
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
  resolveScriptChaptersForSession,
  evaluateChapterProgression,
  buildThreeTierContext
};

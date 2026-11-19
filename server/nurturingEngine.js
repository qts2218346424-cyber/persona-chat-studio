const { db, genId } = require('./db');

function clampStat(val) {
  return Math.max(0, Math.min(100, Math.round(Number(val) || 0)));
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
        '【关系养成阶段：Lv.4 命定羁绊】你们早已生死相托、心意笃定。面对对方时你毫无保留，眼神与话语间自然流露深沉的眷恋、唯一偏爱与默契，能听懂对方每一丝未说出口的情绪。'
    };
  }
  if (composite >= 50) {
    return {
      level: 3,
      badge: '心意相通 Lv.3',
      composite,
      playerDesc: '你已走进 TA 心里最柔软的角落，TA 愿意向你袒露心事、偏心护短，相处亲近自然。',
      promptDirective:
        '【关系养成阶段：Lv.3 心意相通】对方已住进你心里最柔软的角落。你会卸下对外人的防备与伪装，愿意向对方展露隐秘心事、偏心护短甚至偶尔流露微妙的心动拉扯，肢体距离亲近自然。'
    };
  }
  if (composite >= 25) {
    return {
      level: 2,
      badge: '渐生好感 Lv.2',
      composite,
      playerDesc: 'TA 对你的好感正在悄悄升温，比初见时柔和了许多，总会不自觉留意你的冷暖与喜恶。',
      promptDirective:
        '【关系养成阶段：Lv.2 渐生情愫】你对对方的好感正在悄然升温。态度比初识时柔和许多，会不自觉留意对方的冷暖喜恶，话语间藏着不易察觉的纵容与期待对方多留片刻的小心思。'
    };
  }
  return {
    level: 1,
    badge: '初识破冰 Lv.1',
    composite,
    playerDesc: '刚刚相识的试探期，交谈间还带着几分礼貌与好奇，多聊聊彼此的喜好能让关系更快升温。',
    promptDirective:
      '【关系养成阶段：Lv.1 初遇微光】你们正处于初识或重逢破冰期。请维持人设原本的分寸感与性格张力，在克制有礼或淡淡试探中留出恰到好处的温柔余地，循序渐进拉近距离。'
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

function formatNurturingSnapshot(session) {
  const affection = clampStat(session.affection ?? 22);
  const trust = clampStat(session.trust ?? 26);
  const intimacy = clampStat(session.intimacy ?? 18);
  const stage = getRelationshipStage({ affection, trust, intimacy });
  return {
    affection,
    trust,
    intimacy,
    current_mood: session.current_mood || '温柔浅笑',
    stage,
    secret_diary: parseDiaryList(session.secret_diary)
  };
}

/**
 * 根据本轮玩家输入动态演进角色的情感维度与实时心境状态机（告别机械每句 +1，仅真实情感互动触发升温）
 */
function evaluateTurnNurturing(sessionId, userText) {
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
  if (!session) return null;

  const text = String(userText || '').trim();
  const plainLen = text.replace(/[\s\p{P}*＊]/gu, '').length;
  let dAff = 0;
  let dTrust = 0;
  let dInt = 0;
  let reason = '';
  let nextMood = session.current_mood || '✨ 专注倾听';

  if (/讨厌|走开|别管我|烦死|滚/.test(text)) {
    dAff = 0;
    dTrust = 0;
    dInt = 0;
    nextMood = '🌙 垂眸微怔';
  } else if (/(?:\*[^*]*(?:牵|抱|靠|拉住|挽|蹭|摸|握|凝视|凑近|轻触)[^*]*\*)|喜欢你|想你了|好温柔|陪着我|心动|离不开/.test(text)) {
    dAff = 3;
    dInt = 2;
    reason = '亲昵互动让心动升温';
    nextMood = '💓 耳尖微热';
  } else if (/送你|给你带|请你吃|尝尝|多穿|注意身体|别太累|心疼你|替你|照顾好/.test(text)) {
    dAff = 2;
    dTrust = 2;
    reason = '贴心关怀拉近信任';
    nextMood = '🌸 温柔宠溺';
  } else if (/难过|委屈|不开心|害怕|累了|秘密|只告诉你|拉勾|约定|答应我|相信你/.test(text)) {
    dTrust = 3;
    dInt = 2;
    reason = '坦诚心事加深羁绊';
    nextMood = '🥺 心疼护短';
  } else if (/打赌|骗人|吃醋|故意|哼|坏心眼|试探|猜猜/.test(text)) {
    dAff = 1;
    dInt = 2;
    reason = '默契打趣拉近距离';
    nextMood = '🦊 愉悦纵容';
  } else if (/\*[^*]{2,}\*/.test(text) || plainLen >= 16) {
    dTrust = 1;
    dInt = plainLen >= 28 ? 1 : 0;
    reason = '认真交流增进了解';
    nextMood = '✨ 专注倾听';
  } else {
    nextMood = '✨ 专注倾听';
  }

  const newAff = clampStat((session.affection ?? 22) + dAff);
  const newTrust = clampStat((session.trust ?? 26) + dTrust);
  const newInt = clampStat((session.intimacy ?? 18) + dInt);

  db.prepare(`
    UPDATE sessions
    SET affection = ?, trust = ?, intimacy = ?, current_mood = ?, updated_at = ?
    WHERE id = ?
  `).run(newAff, newTrust, newInt, nextMood, Date.now(), sessionId);

  const updated = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
  return {
    deltas: { affection: dAff, trust: dTrust, intimacy: dInt },
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
    .prepare('SELECT * FROM memories WHERE session_id = ? ORDER BY importance DESC, updated_at DESC')
    .all(sessionId);

  // 1. 自愈去重并强化高频唤醒记忆（当 recall_count >= 3 自动提升 strength 并晋升重点记忆）
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

  // 2. 摘取最近用户互动与记忆写一篇角色第一人称《私密心动手账》
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

  let diaryTone = '';
  if (snapshot.stage.level >= 3) {
    diaryTone = `${recentQuote}心跳比平时快了半拍。${factMention}其实我比表面看起来更贪心一点，希望往后的每一个夜晚，推门进来的人都只会是${callName}。`;
  } else if (snapshot.stage.level === 2) {
    diaryTone = `${recentQuote}竟有些舍不得对话太快结束。${factMention}不知道下次见面时，${callName}会不会察觉到我藏在目光里的偏爱？`;
  } else {
    diaryTone = `${recentQuote}原本平静的日常忽然泛起了一点温柔的涟漪。${factMention}属于我们两个人的故事，似乎才刚刚翻开序章。`;
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

  // 顺手提升一点默契度奖励
  const nextIntimacy = clampStat((session.intimacy ?? 18) + 3);
  db.prepare(`
    UPDATE sessions SET secret_diary = ?, intimacy = ?, updated_at = ? WHERE id = ?
  `).run(JSON.stringify(trimmedDiary), nextIntimacy, Date.now(), sessionId);

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
  formatNurturingSnapshot,
  evaluateTurnNurturing,
  runDreamConsolidation
};

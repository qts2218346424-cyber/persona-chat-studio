const path = require('node:path');

/**
 * 智能解析上传的人设设定文档（支持 .json / .md / .txt）
 */
function parsePersonaDocument(filename, rawText) {
  const cleanText = String(rawText || '').replace(/^\uFEFF/, '').trim();
  if (!cleanText) {
    throw new Error('上传的人设文档内容为空');
  }

  const ext = path.extname(filename || '').toLowerCase();
  const baseTitle = path.basename(filename || '未命名角色', ext).trim();

  // 1. 尝试按 JSON 角色卡解析（兼容自定义 JSON、中文键名与 Tavern V2 角色卡格式）
  if (ext === '.json' || cleanText.startsWith('{')) {
    try {
      const parsed = JSON.parse(cleanText);
      const src = parsed.data && typeof parsed.data === 'object' ? { ...parsed, ...parsed.data } : parsed;

      const name = String(
        src.name || src.char_name || src.character_name || src['姓名'] || src['角色名'] || baseTitle
      ).trim();

      const avatar = String(src.avatar_emoji || src.avatar || src['图标'] || '🌸').slice(0, 4);
      const tagline = String(
        src.tagline || src.creator_notes || src.summary || src['简介'] || src['定位'] || ''
      )
        .trim()
        .slice(0, 120);

      const personality = String(
        src.personality || src.char_persona || src['性格'] || src['性格特质'] || ''
      ).trim();

      const descParts = [
        src.backstory,
        src.description,
        src.scenario,
        src.world_scenario,
        src['背景故事'],
        src['世界观'],
        src['设定']
      ]
        .filter((x) => typeof x === 'string' && x.trim())
        .map((x) => x.trim());

      const backstory = descParts.join('\n\n') || cleanText.slice(0, 2000);
      const speaking_style = String(
        src.speaking_style || src.style || src.mes_example || src['说话风格'] || src['台词风格'] || ''
      )
        .trim()
        .slice(0, 500);

      const greeting = String(
        src.greeting || src.first_mes || src.char_greeting || src['开场白'] || ''
      ).trim();

      let starter_prompts = [];
      if (Array.isArray(src.starter_prompts || src.alternate_greetings || src['推荐话题'])) {
        starter_prompts = (src.starter_prompts || src.alternate_greetings || src['推荐话题'])
          .map((s) => String(s).trim())
          .filter(Boolean)
          .slice(0, 4);
      }

      return {
        name: name || baseTitle || '新导入角色',
        avatar: avatar.startsWith('http') ? '🌸' : avatar || '🌸',
        tagline: tagline || `${name}的专属人物设定集`,
        personality,
        backstory,
        speaking_style,
        greeting:
          greeting ||
          `*微风拂过书页，${name || '角色'}抬起眼眸望向走近的你。*\n\n既然翻开了我的故事，接下来想聊些什么？`,
        starter_prompts
      };
    } catch {
      if (ext === '.json') {
        throw new Error('JSON 人设卡格式解析失败，请确认文件内容是否为合法 JSON');
      }
    }
  }

  // 2. 按 Markdown / TXT 结构化或自由人物小传解析
  const lines = cleanText.split(/\r?\n/);
  const buckets = {
    name: '',
    avatar: '🌸',
    tagline: '',
    personality: '',
    backstory: '',
    speaking_style: '',
    greeting: '',
    prompts: []
  };

  let currentSection = 'backstory';
  const uncategorizedLines = [];

  const sectionMatchers = [
    { key: 'name', re: /^(?:#+\s*)?(?:【?(?:角色姓名|角色名称|姓名|名字|角色名|Name)】?)\s*[:：]\s*(.*)$/i },
    { key: 'tagline', re: /^(?:#+\s*)?(?:【?(?:一句话简介|角色定位|身份定位|头衔|简介|定位|Tagline)】?)\s*[:：]\s*(.*)$/i },
    { key: 'personality', re: /^(?:#+\s*)?(?:【?(?:性格特质|性格设定|人物性格|性格|人设特点|Personality)】?)\s*[:：]?\s*(.*)$/i },
    { key: 'backstory', re: /^(?:#+\s*)?(?:【?(?:背景故事|世界观与背景|人物背景|世界观|生平经历|故事设定|详细设定|Backstory|Scenario)】?)\s*[:：]?\s*(.*)$/i },
    { key: 'speaking_style', re: /^(?:#+\s*)?(?:【?(?:说话风格|语言风格|台词风格|口吻|语调习惯|Style)】?)\s*[:：]?\s*(.*)$/i },
    { key: 'greeting', re: /^(?:#+\s*)?(?:【?(?:开场白|初遇场景|第一句话|初始对白|Greeting)】?)\s*[:：]?\s*(.*)$/i }
  ];

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();
    if (!trimmed) {
      if (currentSection === 'backstory' || currentSection === 'greeting') {
        buckets[currentSection] += '\n';
      }
      continue;
    }

    // 若第一行是一级标题（如 # 沈星回 · 占星师），提取为名称
    if (i === 0 && /^#\s+(.+)$/.test(trimmed) && !buckets.name) {
      const h1 = trimmed.replace(/^#\s+/, '').replace(/人设文档|角色设定集|人物设定/g, '').trim();
      if (h1 && h1.length <= 28) {
        buckets.name = h1;
        continue;
      }
    }

    let matchedHeader = false;
    for (const m of sectionMatchers) {
      const hit = trimmed.match(m.re);
      if (hit) {
        matchedHeader = true;
        currentSection = m.key === 'name' || m.key === 'tagline' ? currentSection : m.key;
        const inlineVal = (hit[1] || '').trim();
        if (inlineVal) {
          buckets[m.key] = buckets[m.key] ? `${buckets[m.key]}\n${inlineVal}` : inlineVal;
        }
        break;
      }
    }

    if (!matchedHeader) {
      buckets[currentSection] = buckets[currentSection]
        ? `${buckets[currentSection]}\n${rawLine}`
        : rawLine;
      uncategorizedLines.push(trimmed);
    }
  }

  const finalName =
    (buckets.name || '').split('\n')[0].trim() ||
    (baseTitle && baseTitle !== '未命名角色' ? baseTitle : '新羁绊角色');

  const finalBackstory = (buckets.backstory || cleanText).trim();
  const finalTagline =
    (buckets.tagline || '').split('\n')[0].trim() ||
    (uncategorizedLines[0] ? uncategorizedLines[0].slice(0, 42) : `${finalName}的人物设定档案`);

  const finalGreeting =
    (buckets.greeting || '').trim() ||
    `*视线从记忆的扉页缓缓抬起，${finalName.split(/[·\s]/)[0]}望向推门而入的你，唇角浮起浅淡的弧度。*\n\n既然你已经读过我的过往，那属于我们接下来的篇章，你想从哪里开始聊起？`;

  return {
    name: finalName,
    avatar: buckets.avatar || '🌸',
    tagline: finalTagline,
    personality: (buckets.personality || '细腻鲜活，严格贴合背景故事中的人物动机与情感逻辑。').trim(),
    backstory: finalBackstory,
    speaking_style: (buckets.speaking_style || '自然沉浸，善用细腻的神态与动作描写回应互动。').trim(),
    greeting: finalGreeting,
    starter_prompts: []
  };
}

/**
 * 构建单个对话（支持「星语恋庭扮演模式」与「DeepSeek 原生模式」）的可迁移 .md 聊天记录与专属记忆档案
 * 既可直接发给外部 AI 平台作为前置记忆，也可无损导入回本系统任意其他对话框
 */
function buildSessionMemoryMarkdown({ session = {}, persona = {}, memories = [], messages = [], exportedAt }) {
  const isNative = session.session_mode === 'deepseek_native';
  const isPureOfficial = persona.id === 'persona_deepseek_official' && !session.custom_persona_override;
  const modeLabel = isNative ? 'DeepSeek 原生对话模式' : '星语恋庭 · 角色扮演模式';
  const displayPersonaName =
    persona.name || (isNative ? 'DeepSeek 官方助手' : '未命名角色');
  const title = (session.title || displayPersonaName || '对话记录').trim();
  const timeStr = exportedAt || new Date().toLocaleString('zh-CN', { hour12: false });

  const sessionPrompt = String(session.session_prompt || '').trim();
  const directorNote = String(session.director_note || '').trim();

  const lines = [
    `# 📖 ${title} · 聊天记录与专属记忆档案`,
    ``,
    `> - **对话模式**：${modeLabel}`,
    `> - **角色 / 助手名称**：${displayPersonaName}`,
    `> - **导出时间**：${timeStr}`,
    `> - **记忆条数 / 消息轮数**：独立记忆 ${memories.length} 条 · 历史消息 ${messages.length} 条`,
    `> - **跨对话记忆说明**：本文件包含当前对话框独立的专属设定、长期记忆锚点、前情浓缩手札与完整聊天记录，可直接导入其他对话框或外部平台作为记忆使用。`,
    ``
  ];

  // 1. 本对话专属设定区块
  lines.push(`## 🎭 本对话专属设定`);
  lines.push(`- **角色 / 身份名称**：${displayPersonaName}`);
  if (persona.avatar) {
    lines.push(`- **专属徽记**：${persona.avatar}`);
  }
  if (!isPureOfficial) {
    if (persona.tagline && persona.tagline.trim()) {
      lines.push(`- **一句话定位**：${persona.tagline.trim()}`);
    }
    if (persona.personality && persona.personality.trim()) {
      lines.push(`- **性格特质**：${persona.personality.trim().replace(/\r?\n/g, ' / ')}`);
    }
    if (persona.speaking_style && persona.speaking_style.trim()) {
      lines.push(`- **语言风格**：${persona.speaking_style.trim().replace(/\r?\n/g, ' / ')}`);
    }
    if (persona.backstory && persona.backstory.trim()) {
      lines.push(`- **背景与世界观设定**：\n${persona.backstory.trim()}`);
    }
  }
  if (sessionPrompt) {
    lines.push(`- **本对话独立设定指令**：\n${sessionPrompt}`);
  } else {
    lines.push(`- **本对话独立设定指令**：_（未额外指定，使用当前对话基础设定）_`);
  }
  if (directorNote) {
    lines.push(`- **当前场景氛围指引**：\n${directorNote}`);
  }
  lines.push(``);

  // 2. 长期记忆锚点区块
  const catLabelMap = {
    Pinned: '核心记忆',
    relation: '专属称呼',
    fact: '已知心意',
    event: '共同回忆'
  };
  lines.push(`## 🧠 长期记忆锚点`);
  if (Array.isArray(memories) && memories.length > 0) {
    for (const m of memories) {
      if (!m || !String(m.content || '').trim()) continue;
      const pinPrefix = m.pinned ? '📌 ' : '';
      const catText = catLabelMap[m.category] || '记忆条目';
      const imp = Math.min(5, Math.max(1, Number(m.importance) || 4));
      const cleanMem = String(m.content).trim().replace(/\r?\n+/g, ' ');
      lines.push(`- ${pinPrefix}[${catText} | 重要度 ${imp}] ${cleanMem}`);
    }
  } else {
    lines.push(`_（当前对话暂无已归档的长期记忆条目）_`);
  }
  lines.push(``);

  // 3. 前情浓缩手札区块
  lines.push(`## 📜 前情浓缩手札`);
  const summaryText = String(session.rolling_summary || '').trim();
  if (summaryText) {
    lines.push(summaryText);
  } else {
    lines.push(`_（暂无前情浓缩摘要）_`);
  }
  lines.push(``);

  // 4. 完整聊天记录区块
  lines.push(`## 💬 完整聊天记录`);
  lines.push(``);
  if (Array.isArray(messages) && messages.length > 0) {
    const assistantHeaderName = isNative && isPureOfficial ? 'DeepSeek' : displayPersonaName;
    for (const m of messages) {
      if (!m) continue;
      const body = String(m.content || '').trim();
      const reasoning = String(m.reasoning || '').trim();
      if (!body && !reasoning) continue;

      if (m.role === 'user') {
        lines.push(`### 🙋 我：`);
        lines.push(``);
        lines.push(body);
        lines.push(``);
      } else {
        lines.push(`### 🤖 ${assistantHeaderName}：`);
        lines.push(``);
        if (reasoning) {
          lines.push(`<details><summary>💭 思考与心声过程</summary>`);
          lines.push(``);
          lines.push(reasoning);
          lines.push(``);
          lines.push(`</details>`);
          lines.push(``);
        }
        lines.push(body);
        lines.push(``);
      }
    }
  } else {
    lines.push(`_（当前对话暂无历史消息记录）_`);
    lines.push(``);
  }

  return lines.join('\n');
}

/**
 * 从单条助手消息文本中剥离 <details><summary>...</summary>...</details> 思考链折叠块
 */
function extractDetailsReasoningFromMarkdown(rawContent) {
  let content = String(rawContent || '').trim();
  let reasoning = '';
  const detailsRe = /^<details>\s*<summary>[\s\S]*?<\/summary>([\s\S]*?)<\/details>\s*/i;
  const hit = content.match(detailsRe);
  if (hit) {
    reasoning = String(hit[1] || '').trim();
    content = content.slice(hit[0].length).trim();
  }
  return { content, reasoning };
}

/**
 * 解析 Markdown 中的「## 🎭 本对话专属设定」区块
 */
function parseMarkdownSettingSection(sectionText) {
  const raw = String(sectionText || '').trim();
  if (!raw) return null;

  const result = {
    persona_override: {},
    session_prompt: '',
    director_note: ''
  };
  let currentMultiField = null;

  const fieldDefs = [
    { target: 'name', re: /^[-*]\s*\*\*角色\s*\/\s*身份名称\*\*\s*[:：]\s*(.*)$/ },
    { target: 'avatar', re: /^[-*]\s*\*\*专属徽记\*\*\s*[:：]\s*(.*)$/ },
    { target: 'tagline', re: /^[-*]\s*\*\*一句话定位\*\*\s*[:：]\s*(.*)$/ },
    { target: 'personality', re: /^[-*]\s*\*\*性格特质\*\*\s*[:：]\s*(.*)$/ },
    { target: 'speaking_style', re: /^[-*]\s*\*\*语言风格\*\*\s*[:：]\s*(.*)$/ },
    { target: 'backstory', re: /^[-*]\s*\*\*背景与世界观设定\*\*\s*[:：]\s*(.*)$/ },
    { target: 'session_prompt', re: /^[-*]\s*\*\*本对话独立设定指令\*\*\s*[:：]\s*(.*)$/ },
    { target: 'director_note', re: /^[-*]\s*\*\*当前场景氛围指引\*\*\s*[:：]\s*(.*)$/ }
  ];

  for (const rawLine of raw.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    let matched = false;
    for (const def of fieldDefs) {
      const m = trimmed.match(def.re);
      if (m) {
        matched = true;
        const val = String(m[1] || '').trim();
        const isPlaceholder = /^_?（.*未额外.*）_?$/.test(val);
        currentMultiField =
          def.target === 'backstory' || def.target === 'session_prompt' || def.target === 'director_note'
            ? def.target
            : null;

        if (!isPlaceholder && val) {
          if (def.target === 'session_prompt' || def.target === 'director_note') {
            result[def.target] = val;
          } else {
            result.persona_override[def.target] = val;
          }
        }
        break;
      }
    }

    if (!matched && currentMultiField) {
      if (/^_?（.*未额外.*）_?$/.test(trimmed)) continue;
      if (currentMultiField === 'session_prompt' || currentMultiField === 'director_note') {
        result[currentMultiField] = result[currentMultiField]
          ? `${result[currentMultiField]}\n${rawLine}`
          : rawLine;
      } else {
        result.persona_override[currentMultiField] = result.persona_override[currentMultiField]
          ? `${result.persona_override[currentMultiField]}\n${rawLine}`
          : rawLine;
      }
    }
  }

  for (const k of Object.keys(result.persona_override)) {
    result.persona_override[k] = String(result.persona_override[k] || '').trim();
  }
  result.session_prompt = String(result.session_prompt || '').trim();
  result.director_note = String(result.director_note || '').trim();

  // 若导出源只是纯默认「DeepSeek 官方助手」且没有任何实质角色属性，不生成空覆盖对象
  const po = result.persona_override;
  const isDefaultDsOnly =
    (po.name === 'DeepSeek' || po.name === 'DeepSeek 官方助手' || po.name === 'DeepSeek · 官方纯净助手') &&
    !po.personality &&
    !po.backstory &&
    !po.speaking_style;
  if (isDefaultDsOnly) {
    result.persona_override = {};
  }

  const hasPersonaOverride = Object.values(result.persona_override).some(Boolean);
  if (!hasPersonaOverride && !result.session_prompt && !result.director_note) {
    return null;
  }
  return {
    persona_override: hasPersonaOverride ? result.persona_override : null,
    session_prompt: result.session_prompt,
    director_note: result.director_note
  };
}

/**
 * 解析 Markdown 中的「## 🧠 长期记忆锚点」区块
 */
function parseMarkdownMemoriesSection(sectionText) {
  const raw = String(sectionText || '').trim();
  if (!raw) return [];

  const revCatMap = {
    核心记忆: 'Pinned',
    刻骨锚点: 'Pinned',
    专属称呼: 'relation',
    已知心意: 'fact',
    心意细节: 'fact',
    共同回忆: 'event',
    记忆条目: 'fact'
  };

  const memories = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || /^_?（.*暂无.*）_?$/.test(trimmed)) continue;
    const bulletMatch = trimmed.match(/^(?:[-*+]|\d+\.)\s+(.*)$/);
    if (!bulletMatch) continue;

    let body = bulletMatch[1].trim();
    let pinned = 0;
    if (body.startsWith('📌')) {
      pinned = 1;
      body = body.replace(/^📌\s*/, '');
    }

    let category = pinned ? 'Pinned' : 'fact';
    let importance = pinned ? 5 : 4;

    const metaMatch = body.match(/^(?:\*\*)?\[([^\]|]+?)(?:\s*\|\s*重要度\s*(\d+))?\](?:\*\*)?\s*(.*)$/);
    if (metaMatch) {
      const rawCat = String(metaMatch[1] || '').trim();
      if (revCatMap[rawCat]) category = revCatMap[rawCat];
      if (category === 'Pinned') pinned = 1;
      if (metaMatch[2]) {
        importance = Math.min(5, Math.max(1, parseInt(metaMatch[2], 10) || 4));
      }
      body = String(metaMatch[3] || '').trim();
    }

    if (body && !/^_?（.*暂无.*）_?$/.test(body)) {
      memories.push({
        category,
        content: body,
        pinned,
        importance
      });
    }
  }
  return memories;
}

/**
 * 智能解析导入的历史对话记录与跨对话记忆包（支持 .md / .json / .jsonl / .txt）
 */
function parseChatHistoryDocument(filename, rawText, personaName = '') {
  const cleanText = String(rawText || '').replace(/^\uFEFF/, '').trim();
  if (!cleanText) {
    throw new Error('上传的聊天记录或记忆文件内容为空');
  }

  const ext = path.extname(filename || '').toLowerCase();
  const shortPersona = (personaName || '').split(/[·\s]/)[0].trim();

  function normalizeMsgObj(item) {
    if (!item || typeof item !== 'object') return null;
    const content = String(item.content ?? item.mes ?? item.text ?? item.message ?? '').trim();
    if (!content) return null;

    let role = 'assistant';
    if (item.role === 'user' || item.role === 'human' || item.is_user === true) {
      role = 'user';
    } else if (item.role === 'system') {
      return null;
    } else if (typeof item.sender === 'string' || typeof item.name === 'string') {
      const who = String(item.sender || item.name).trim().toLowerCase();
      if (['user', 'me', 'player', '我', '你', '用户', '玩家', '旅人', '主控'].includes(who)) {
        role = 'user';
      }
    }

    const reasoning = String(item.reasoning ?? item.reasoning_content ?? item.thought ?? '').trim();
    return { role, content, reasoning };
  }

  // 1. JSON 数组或导出备份对象
  if (ext === '.json' || cleanText.startsWith('[') || cleanText.startsWith('{')) {
    try {
      const parsed = JSON.parse(cleanText);
      const arr = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed.messages)
        ? parsed.messages
        : Array.isArray(parsed.chat)
        ? parsed.chat
        : Array.isArray(parsed.history)
        ? parsed.history
        : null;

      if (arr || Array.isArray(parsed.memories) || parsed.rolling_summary) {
        const normalized = Array.isArray(arr) ? arr.map(normalizeMsgObj).filter(Boolean) : [];
        const importedMemories = Array.isArray(parsed.memories) ? parsed.memories : [];
        const importedSummary = typeof parsed.rolling_summary === 'string' ? parsed.rolling_summary : '';
        let importedSetting = null;
        if (parsed.persona_override || parsed.session_prompt || parsed.director_note) {
          importedSetting = {
            persona_override:
              parsed.persona_override && typeof parsed.persona_override === 'object'
                ? parsed.persona_override
                : null,
            session_prompt: typeof parsed.session_prompt === 'string' ? parsed.session_prompt : '',
            director_note: typeof parsed.director_note === 'string' ? parsed.director_note : ''
          };
        }

        if (normalized.length > 0 || importedMemories.length > 0 || importedSummary || importedSetting) {
          return {
            messages: normalized,
            imported_summary: importedSummary,
            imported_memories: importedMemories,
            imported_setting: importedSetting
          };
        }
      }
    } catch {
      if (ext === '.json') {
        throw new Error('JSON 历史对话文件格式有误，请检查是否为有效 JSON');
      }
    }
  }

  // 2. JSONL 逐行格式（如 Tavern 聊天记录）
  if (ext === '.jsonl') {
    const msgs = [];
    for (const line of cleanText.split(/\r?\n/)) {
      const t = line.trim();
      if (!t.startsWith('{')) continue;
      try {
        const obj = JSON.parse(t);
        const norm = normalizeMsgObj(obj);
        if (norm) msgs.push(norm);
      } catch {}
    }
    if (msgs.length > 0) {
      return { messages: msgs, imported_summary: '', imported_memories: [], imported_setting: null };
    }
  }

  // 3. Markdown 记忆包 & 聊天记录双向解析（支持标准导出 .md、旧版分享 .md、自由文本对话及纯记忆笔记 .md）
  let importedSetting = null;
  let importedMemories = [];
  let importedSummary = '';
  let chatBodyText = cleanText;
  let hasStructuredSections = false;

  const allLines = cleanText.split(/\r?\n/);
  const secBuckets = {
    preamble: [],
    setting: [],
    memories: [],
    summary: [],
    chat: []
  };
  let activeSec = 'preamble';
  let inTopFence = false;

  for (const rawLine of allLines) {
    const trimmed = rawLine.trim();
    if (/^```/.test(trimmed)) {
      inTopFence = !inTopFence;
    }

    // 仅在进入「完整聊天记录」章节之前且不在代码块中时切分顶层元数据章节，避免误伤 AI 回答里的 Markdown 二级标题
    if (!inTopFence && activeSec !== 'chat') {
      if (/^##\s*(?:🎭\s*)?(?:本对话专属设定|对话专属设定|专属设定|角色设定)\s*$/.test(trimmed)) {
        activeSec = 'setting';
        hasStructuredSections = true;
        continue;
      }
      if (/^##\s*(?:🧠\s*)?(?:长期记忆锚点|长期记忆|核心记忆|专属记忆|记忆库)\s*$/.test(trimmed)) {
        activeSec = 'memories';
        hasStructuredSections = true;
        continue;
      }
      if (/^##\s*(?:📜\s*)?(?:前情浓缩手札|前情摘要|回忆手札|剧情摘要)\s*$/.test(trimmed)) {
        activeSec = 'summary';
        hasStructuredSections = true;
        continue;
      }
      if (/^##\s*(?:💬\s*)?(?:完整聊天记录|历史聊天记录|聊天记录|对话记录)\s*$/.test(trimmed)) {
        activeSec = 'chat';
        hasStructuredSections = true;
        continue;
      }
    }

    secBuckets[activeSec].push(rawLine);
  }

  if (hasStructuredSections) {
    importedSetting = parseMarkdownSettingSection(secBuckets.setting.join('\n'));
    importedMemories = parseMarkdownMemoriesSection(secBuckets.memories.join('\n'));
    const rawSum = secBuckets.summary.join('\n').trim();
    if (rawSum && !/^_?（.*暂无.*）_?$/.test(rawSum)) {
      importedSummary = rawSum;
    }
    chatBodyText = secBuckets.chat.join('\n').trim();
  }

  const userAliases = new Set([
    '我',
    '提问',
    '用户',
    '玩家',
    '旅人',
    '主控',
    '访客',
    'user',
    'human',
    'me',
    'you'
  ]);
  const assistantAliases = new Set([
    '角色',
    '对方',
    '他',
    '她',
    'ai',
    'assistant',
    'bot',
    'char',
    'deepseek',
    'deepseek 回答',
    '回答',
    ...(shortPersona ? [shortPersona.toLowerCase()] : []),
    ...(personaName ? [personaName.toLowerCase()] : [])
  ]);

  // 匹配导出的 Markdown 轮次标题，如：
  // ### 🙋 我： / ### 🤖 星野汐： / ## 🙋 提问 / ## 🐋 DeepSeek 回答
  const mdTurnHeadingRe =
    /^(?:##|###)\s*(?:(🙋|👤)\s*(.*?)|(🤖|🐋|🌸|✨)\s*(.*?))\s*[:：]?\s*$/;
  // 匹配纯文本行级说话人前缀，如：我：你好 / [星野汐]：... / **我**：...
  const inlineSpeakerRe =
    /^(?:\*\*|__)?(?:\[([^\]]{1,24})\]|【([^】]{1,24})】|([^\s:：*#>|`\-0-9][^\s:：*#>|`]{0,19}))(?:\*\*|__)?\s*[:：]\s*(.*)$/;

  const messages = [];
  let currentMsg = null;
  let inCodeFence = false;
  let lockedMarkdownHeadingMode = false;

  function flushCurrentMessage() {
    if (!currentMsg) return;
    if (currentMsg.role === 'assistant') {
      const extracted = extractDetailsReasoningFromMarkdown(currentMsg.content);
      currentMsg.content = extracted.content;
      if (extracted.reasoning && !currentMsg.reasoning) {
        currentMsg.reasoning = extracted.reasoning;
      }
    } else {
      currentMsg.content = String(currentMsg.content || '').trim();
    }
    if (currentMsg.content || currentMsg.reasoning) {
      messages.push(currentMsg);
    }
    currentMsg = null;
  }

  const chatLines = chatBodyText ? chatBodyText.split(/\r?\n/) : [];
  for (const rawLine of chatLines) {
    const trimmed = rawLine.trim();

    if (/^```/.test(trimmed)) {
      inCodeFence = !inCodeFence;
      if (currentMsg) {
        currentMsg.content = currentMsg.content ? `${currentMsg.content}\n${rawLine}` : rawLine;
      }
      continue;
    }

    if (inCodeFence) {
      if (currentMsg) {
        currentMsg.content = currentMsg.content ? `${currentMsg.content}\n${rawLine}` : rawLine;
      }
      continue;
    }

    if (!trimmed) {
      if (currentMsg && currentMsg.content) {
        currentMsg.content += '\n';
      }
      continue;
    }

    // 跳过标准导出文件顶部的文档标题、导出时间引用块与空占位行
    if (!currentMsg) {
      if (/^#\s+/.test(trimmed)) continue;
      if (/^>\s*(?:[-*]\s*)?(?:\*\*)?(?:对话模式|角色\s*\/\s*助手名称|导出时间|记忆条数|跨对话记忆说明)/.test(trimmed)) {
        continue;
      }
      if (/^_?（.*暂无历史消息.*）_?$/.test(trimmed)) continue;
    }

    // 优先匹配 Markdown 显式轮次标题（### 🙋 我： / ### 🤖 角色： / ## 🙋 提问 / ## 🐋 DeepSeek 回答）
    const mdHeadingHit = trimmed.match(mdTurnHeadingRe);
    if (mdHeadingHit) {
      flushCurrentMessage();
      lockedMarkdownHeadingMode = true;
      const isUserTurn = Boolean(mdHeadingHit[1]);
      currentMsg = {
        role: isUserTurn ? 'user' : 'assistant',
        content: '',
        reasoning: ''
      };
      continue;
    }

    // 若未锁定为 Markdown 标题轮次模式，则支持普通行级「我：… / 角色名：…」格式
    if (!lockedMarkdownHeadingMode) {
      const match = trimmed.match(inlineSpeakerRe);
      if (match) {
        const rawSpeaker = (match[1] || match[2] || match[3] || '').trim();
        const speakerLower = rawSpeaker.toLowerCase();
        const bodyPart = (match[4] || '').trim();

        let detectedRole = null;
        if (userAliases.has(speakerLower)) {
          detectedRole = 'user';
        } else if (
          assistantAliases.has(speakerLower) ||
          (shortPersona && rawSpeaker.includes(shortPersona))
        ) {
          detectedRole = 'assistant';
        } else if (
          rawSpeaker.length <= 10 &&
          !/^(?:https?|ftp|file|data|注意|提示|说明|示例|总结|结论|步骤|原因|时间|地点)$/i.test(rawSpeaker)
        ) {
          detectedRole = currentMsg && currentMsg.role === 'assistant' ? 'user' : 'assistant';
        }

        if (detectedRole) {
          flushCurrentMessage();
          currentMsg = {
            role: detectedRole,
            content: bodyPart,
            reasoning: ''
          };
          continue;
        }
      }
    }

    if (currentMsg) {
      currentMsg.content = currentMsg.content ? `${currentMsg.content}\n${rawLine}` : rawLine;
    } else if (!hasStructuredSections) {
      currentMsg = { role: 'user', content: rawLine, reasoning: '' };
    }
  }

  flushCurrentMessage();

  // 智能优化：若粘贴的是无显式「我：/角色：」前缀的多段普通 Markdown，避免把整篇文章硬压成一个大气泡！
  if (!lockedMarkdownHeadingMode && messages.length === 1 && messages[0].role === 'user') {
    const singleRaw = messages[0].content.trim();
    const bulletMems = parseMarkdownMemoriesSection(singleRaw);
    const nonBulletLines = singleRaw
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !/^[-*•]\s+/.test(l) && !/^\d+[.)、]\s+/.test(l) && !/^#+\s+/.test(l));

    // 情况 A：整段几乎全是 Markdown 要点列表（如粘贴的人物记忆清单），直接导入为独立记忆条目
    if (bulletMems.length >= 2 && nonBulletLines.length === 0) {
      messages.length = 0;
      importedMemories.push(...bulletMems);
    } else {
      // 情况 B：按空行或二级标题分段的多段对话/故事文本，自动拆成多条清晰气泡
      const blocks = singleRaw
        .split(/\n\s*\n+|(?=^#{2,4}\s+)/m)
        .map((b) => b.trim())
        .filter(Boolean);
      if (blocks.length >= 2) {
        messages.length = 0;
        blocks.forEach((blk, idx) => {
          const cleanBlk = blk.replace(/^#{2,4}\s+/, '').trim();
          if (!cleanBlk) return;
          // 根据人称与角色名启发式判断归属，否则自然交替为 user / assistant
          let role = idx % 2 === 0 ? 'user' : 'assistant';
          if (shortPersona && cleanBlk.includes(shortPersona) && !/^我/.test(cleanBlk)) {
            role = 'assistant';
          } else if (/^(?:我|“我|「我|\*我)/.test(cleanBlk) && !(shortPersona && cleanBlk.startsWith(shortPersona))) {
            role = 'user';
          } else if (/^(?:\*?(?:他|她)|“|「)/.test(cleanBlk) && idx > 0 && messages[messages.length - 1]?.role === 'user') {
            role = 'assistant';
          }
          messages.push({
            role,
            content: cleanBlk,
            reasoning: ''
          });
        });
      }
    }
  }

  // 若是用户自建的纯记忆笔记 .md（没有对话轮次，但包含要点列表），自动提取为长期记忆导入
  if (
    messages.length === 0 &&
    importedMemories.length === 0 &&
    !importedSummary &&
    !importedSetting &&
    ext === '.md'
  ) {
    const fallbackMems = parseMarkdownMemoriesSection(cleanText);
    if (fallbackMems.length > 0) {
      importedMemories = fallbackMems;
    } else if (cleanText.length <= 1500) {
      importedSummary = cleanText;
    }
  }

  if (
    messages.length === 0 &&
    importedMemories.length === 0 &&
    !importedSummary &&
    !importedSetting
  ) {
    throw new Error('未能从文件中识别出有效的聊天记录或记忆条目，请使用导出的 .md 记忆档案、JSON 或“我：… / 角色：…”文本格式');
  }

  return {
    messages,
    imported_summary: importedSummary,
    imported_memories: importedMemories,
    imported_setting: importedSetting
  };
}

module.exports = {
  parsePersonaDocument,
  parseChatHistoryDocument,
  buildSessionMemoryMarkdown
};

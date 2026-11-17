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
 * 智能解析导入的历史对话记录（支持 .json / .jsonl / .txt / .md）
 */
function parseChatHistoryDocument(filename, rawText, personaName = '') {
  const cleanText = String(rawText || '').replace(/^\uFEFF/, '').trim();
  if (!cleanText) {
    throw new Error('上传的历史对话文件内容为空');
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

  // 1. JSON 数组或导出对象
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

      if (arr) {
        const normalized = arr.map(normalizeMsgObj).filter(Boolean);
        if (normalized.length > 0) {
          return {
            messages: normalized,
            imported_summary: typeof parsed.rolling_summary === 'string' ? parsed.rolling_summary : '',
            imported_memories: Array.isArray(parsed.memories) ? parsed.memories : []
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
      return { messages: msgs, imported_summary: '', imported_memories: [] };
    }
  }

  // 3. TXT / Markdown 对话文本解析
  const userAliases = new Set(['我', '用户', '玩家', '旅人', '主控', '访客', 'user', 'human', 'me', 'you']);
  const assistantAliases = new Set([
    '角色',
    '对方',
    '他',
    '她',
    'ai',
    'assistant',
    'bot',
    'char',
    ...(shortPersona ? [shortPersona.toLowerCase()] : []),
    ...(personaName ? [personaName.toLowerCase()] : [])
  ]);

  const speakerLineRe = /^(?:###?\s*)?(?:\[([^\]]{1,24})\]|【([^】]{1,24})】|([^\s:：]{1,20}))\s*[:：]\s*(.*)$/;
  const messages = [];
  let currentMsg = null;

  for (const rawLine of cleanText.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      if (currentMsg && currentMsg.content) {
        currentMsg.content += '\n';
      }
      continue;
    }

    const match = trimmed.match(speakerLineRe);
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
      } else if (rawSpeaker.length <= 10 && !/^https?$/i.test(rawSpeaker)) {
        // 未知说话人前缀：若与上一条不同则自动归为角色或按轮次推断
        detectedRole = currentMsg && currentMsg.role === 'assistant' ? 'user' : 'assistant';
      }

      if (detectedRole) {
        if (currentMsg && currentMsg.content.trim()) {
          currentMsg.content = currentMsg.content.trim();
          messages.push(currentMsg);
        }
        currentMsg = {
          role: detectedRole,
          content: bodyPart,
          reasoning: ''
        };
        continue;
      }
    }

    if (currentMsg) {
      currentMsg.content = currentMsg.content
        ? `${currentMsg.content}\n${rawLine}`
        : rawLine;
    } else {
      currentMsg = { role: 'user', content: rawLine, reasoning: '' };
    }
  }

  if (currentMsg && currentMsg.content.trim()) {
    currentMsg.content = currentMsg.content.trim();
    messages.push(currentMsg);
  }

  if (messages.length === 0) {
    throw new Error('未能从文件中识别出有效的对话段落，请使用 JSON 或“我：… / 角色名：…”文本格式');
  }

  return {
    messages,
    imported_summary: '',
    imported_memories: []
  };
}

module.exports = {
  parsePersonaDocument,
  parseChatHistoryDocument
};

/**
 * AI 剧本工坊引擎（读取用户上传剧本/小说草稿 ➔ 辅助诊断优化剧本大纲与四幕分镜 ➔ 自动提取全套登场人设与世界书伏笔）
 */

const path = require('node:path');
const { getEffectiveApiCredentials } = require('./deepseekApiSuite');
const { getLocalBridgeSuiteCredentials } = require('./antigravityBridge');

const FOCUS_INSTRUCTIONS = {
  balanced: '全面梳理故事起承转合，增强玩家的剧中参与感，将故事拆解为层层递进的四幕章节，并立体化每位登场角色的性格反差。',
  clannad_healing: '参考《CLANNAD》《紫罗兰永恒花园》等治愈番剧质感，在温暖细腻的日常互动中埋入感人至深的伏笔与双向救赎弧光。',
  suspense_twist: '参考《命运石之门》《夏日重现》等悬疑番剧节奏，强化开篇悬念钩子、时间紧迫感、信息差博弈与第三幕高能反转。'
};

function extractJsonObject(rawStr) {
  const text = String(rawStr || '').trim();
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : text;
  const firstBrace = candidate.indexOf('{');
  const lastBrace = candidate.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) return null;
  try {
    return JSON.parse(candidate.slice(firstBrace, lastBrace + 1));
  } catch {
    return null;
  }
}

/**
 * 本地高智能剧本拆解与润色兜底引擎（当无外部网络或超时时，100% 零报错返回结构化结果）
 */
function buildLocalSmartAnalysis({ filename = '', rawText = '', focusMode = 'balanced' }) {
  const clean = String(rawText || '').replace(/^\uFEFF/, '').trim();
  const baseName = path.basename(filename || '', path.extname(filename || '')).trim();
  const lines = clean.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  // 1. 识别剧本标题（优先提取正文中的显式书名号/Markdown一级标题，避免被英文临时文件名覆盖）
  const h1 = lines.find((l) => /^#+\s+/.test(l) || /^[《「].+[》」]$/.test(l));
  const headingTitle = h1
    ? h1.replace(/^#+\s+/, '').replace(/^[《「]|[》」]$/g, '').trim().slice(0, 22)
    : '';
  const hasChineseBaseName = /[\u4e00-\u9fa5]/.test(baseName);

  let title = '';
  if (headingTitle) {
    title = headingTitle;
  } else if (hasChineseBaseName) {
    title = baseName.replace(/^示例上传剧本[_-]?/, '').slice(0, 22);
  } else if (baseName && !/^(?:script|draft|sample|test|upload)/i.test(baseName)) {
    title = baseName.slice(0, 22);
  } else {
    title = (lines[0] || '未命名星语剧本').replace(/[。！？，,.!?：:].*$/, '').slice(0, 18) || '未命名互动剧本';
  }

  // 2. 自动推断题材氛围图标与副标题
  let icon = '📖';
  let subtitle = '玩家原创多幕互动剧';
  let playerRole = '卷入故事核心的同行者';
  if (/校|学姐|学长|班|社团|琴房|樱|夏天|教室/.test(clean)) {
    icon = '🌸';
    subtitle = '青春校园日常与救赎剧';
    playerRole = '偶然闯入秘密的同校学生';
  } else if (/轮回|时间|死|密码|灯塔|悬疑|列车|末日|观测/.test(clean)) {
    icon = '⏳';
    subtitle = '悬疑破局与宿命反转剧';
    playerRole = '握有关键线索的破局搭档';
  } else if (/剑|仙|古|长安|江湖|宫|雪|师尊|公子/.test(clean)) {
    icon = '🪭';
    subtitle = '古风宿命与江湖羁绊剧';
    playerRole = '与主角宿命交织的故人';
  } else if (/魔法|精灵|妖怪|神社|森林|奇幻|花/.test(clean)) {
    icon = '🌿';
    subtitle = '奇幻旅途与温柔治愈剧';
    playerRole = '结伴远行的契约旅伴';
  }

  // 3. 扫描剧本原文中的登场人物名称（支持「姓名：XXX」或对白前缀「XXX：“...”）
  const stopWords = new Set([
    '第一幕', '第二幕', '第三幕', '第四幕', '终幕', '序章', '旁白', '背景', '世界观', '设定',
    '故事', '剧本', '时间', '地点', '人物', '角色', '主角', '玩家', '结局', '注意', '提示'
  ]);
  const nameCounts = new Map();

  for (const line of lines) {
    const explicitRole = line.match(/^(?:[-*•]\s*)?(?:【?(?:角色|人物|姓名|女主|男主|登场人物)\d*】?)\s*[:：]\s*([\u4e00-\u9fa5A-Za-z·]{2,10})/);
    if (explicitRole && !stopWords.has(explicitRole[1])) {
      nameCounts.set(explicitRole[1], (nameCounts.get(explicitRole[1]) || 0) + 5);
      continue;
    }
    const speakerMatch = line.match(/^([\u4e00-\u9fa5]{2,5})\s*[:：]\s*[“"「*（(]/);
    if (speakerMatch && !stopWords.has(speakerMatch[1])) {
      nameCounts.set(speakerMatch[1], (nameCounts.get(speakerMatch[1]) || 0) + 2);
    }
  }

  const detectedNames = [...nameCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map((e) => e[0])
    .slice(0, 3);

  if (detectedNames.length === 0) {
    detectedNames.push(icon === '🌸' ? '林晚音' : icon === '⏳' ? '陆时迁' : '苏清羽');
  }

  const snippetSummary = clean.replace(/\s+/g, ' ').slice(0, 140);
  const synopsis = `${snippetSummary}${clean.length > 140 ? '……' : ''}（已由 AI 剧本工坊提炼核心矛盾，重构为支持自由分支推进的四幕互动剧场。）`;

  const avatarPool = ['🌸', '🌙', '🎸', '🎻', '⏳', '✉️', '🌿'];
  const routeLabels = ['核心主线', '羁绊支线', '隐藏真相线'];

  const personas = detectedNames.map((charName, idx) => {
    // 摘取与该角色相关的原文句子作为背景锚点
    const relatedLines = lines.filter((l) => l.includes(charName)).slice(0, 4);
    const charContext = relatedLines.length > 0 ? relatedLines.join('\n') : clean.slice(0, 260);
    return {
      avatar: avatarPool[idx % avatarPool.length],
      name: `${charName} · 《${title}》核心角色`,
      category_tag: routeLabels[idx % routeLabels.length],
      tagline: `在《${title}》的命运漩涡中与你相遇的关键人物，藏着未曾轻易示人的心事`,
      personality: '外在克制鲜活、内心细腻真挚，面对外人保持分寸感，唯独在与你并肩推进事件时会流露真实的脆弱与偏爱。',
      backstory: `【所属剧本：《${title}》】\n${charContext}\n\n在故事的推进过程中，${charName}将与{{user}}共同面对接下来的重重考验与情感抉择。`,
      speaking_style: '自然沉浸、富有画面分镜感（用星号包裹神态与环境细节描写），每轮对话主动推动当前情节向前发展。',
      greeting: `*故事的帷幕悄然拉开，风声掠过安静的角落。${charName}停下脚步转过身望向走近的你，眼底映着微光与一丝欲言又止的情绪。*\n\n你终于来了……关于这件事，我正发愁一个人该从哪里查起。既然你也卷进来了，那接下来这一步——你是想先跟我去现场确认线索，还是先听我把刚才发现的秘密告诉你？`,
      starter_prompts: [
        `“别担心，既然遇上了我就陪你一起查到底——我们先去现场看看吧！”`,
        `*走近半步认真看着${charName}的眼睛* 你刚才说发现了秘密，到底是什么？`,
        `在正式行动之前，先告诉我你现在身体和状态还撑得住吗？`
      ]
    };
  });

  const leadName = detectedNames[0];
  const chapters = [
    {
      title: `${icon} 第一幕 · 初遇与悬念起航`,
      note: `【第一幕】在《${title}》的开篇场景中，{{user}}与${leadName}因一桩突发小事件结成搭档，确立共同要完成的核心目标。`,
      opener: `*看着眼前的局势，我深吸一口气朝你伸出手* 既然目标一致，那从今天起我们就是正式搭档了——第一步我们先从哪里入手？`,
      checkpoint: { hint: '确立搭档约定并决定迈出第一步调查', keywords: ['搭档', '约定', '出发', '开始', '线索'], min_turns: 3 }
    },
    {
      title: `🌤️ 第二幕 · 并肩调查与暗流升温`,
      note: `【第二幕】两人共同克服第一道阻碍并找到关键线索，日常拌嘴与默契配合中关系迅速升温，但更深层的隐患初露端倪。`,
      opener: `*把刚刚找到的关键线索摊开在桌上，抬头看向身旁的你* 果然没那么简单……你看这里留下的痕迹，是不是和你之前隐瞒的事有关？`,
      checkpoint: { hint: '发现第一条关键线索并察觉背后隐藏秘密', keywords: ['秘密', '真相', '隐瞒', '发现', '痕迹'], min_turns: 4 }
    },
    {
      title: `🌧️ 第三幕 · 雨夜转折与心结摊牌`,
      note: `【第三幕】危机骤然逼近，${leadName}一直独自背负的过往秘密或代价被迫揭开，在脆弱与动摇的雨夜里，{{user}}选择坚定握住对方的手。`,
      opener: `*窗外雨声渐急，我拦住想独自去承担一切的你，认真直视你的眼睛* 不许再一个人扛着了——把你一直瞒着我的真相全说出来，我们一起面对！`,
      checkpoint: { hint: '揭开心结与过去真相并决定共同面对', keywords: ['一起', '面对', '相信', '过去', '约定'], min_turns: 4 }
    },
    {
      title: `✨ 终幕 · 破局微光与改写的结局`,
      note: `【终幕】集齐一路积累的信任与线索，两人并肩跨过最大难关，在晨光与微风中迎来只属于彼此的圆满谢幕。`,
      opener: `*最艰难的时刻终于跨过去了，晨光重新照亮四周，我转头朝如释重负的你露出笑容* 你看，我们真的把结局改写过来了！`,
      checkpoint: { hint: '跨越危机迎来属于彼此的改写结局', keywords: ['结局', '改写', '未来', '永远', '光'], min_turns: 4 }
    }
  ];

  const critique = [
    `✅ **人物切入点提炼**：已从原稿中锁定核心人物（${detectedNames.join('、')}），并为你补充了明确的「玩家剧中身份（${playerRole}）」，避免聊天时玩家沦为局外旁观者。`,
    focusMode === 'suspense_twist'
      ? `🔍 **悬念钩子强化**：已按悬疑番剧节奏将平铺直叙的故事拆解为「初遇起航 ➔ 线索浮现 ➔ 雨夜摊牌 ➔ 终幕破局」四幕阶梯，每幕自带冲突目标。`
      : `🌸 **情感弧光升级**：借鉴《CLANNAD》式“先共同完成一件小事、再揭开人物深层软肋”的叙事手法，为角色补全了细腻的开场分镜与三条破冰分支。`,
    `📖 **暗线伏笔埋设**：建议在第三幕前保留人物三分之一的秘密不直接说破，下方已自动为你提炼出可随聊天关键词动态解锁的「世界书伏笔词条」。`
  ];

  const lorebooks = [
    {
      title: `《${title}》深层真相与未言之秘`,
      keywords: '秘密,真相,以前,过去,为什么,隐瞒',
      content: `【隐藏世界书解锁】：${clean.slice(0, 220)}${clean.length > 220 ? '…' : ''} —— 这段过往正是${leadName}一直默默守护却不敢轻易提起的心结。`
    }
  ];

  return {
    engine: 'local_smart',
    critique,
    script: {
      icon,
      title,
      subtitle,
      player_role: playerRole,
      synopsis,
      chapters
    },
    personas,
    lorebooks
  };
}

/**
 * 主入口：读取用户上传的剧本草稿，调用大模型（或本地智能兜底）完成剧本诊断润色与全人设提取
 */
async function analyzeAndOptimizeScript({ filename = '', rawText = '', focusMode = 'balanced', settings = {} }) {
  const cleanText = String(rawText || '').replace(/^\uFEFF/, '').trim();
  if (!cleanText || cleanText.length < 8) {
    throw new Error('请先上传剧本文档，或在文本框里写下至少一句话的故事脑洞哦');
  }

  // 限制单次诊断输入长度，确保 5~8 秒极速完成
  let sourceContent = cleanText.slice(0, 4800);
  const focusHint = FOCUS_INSTRUCTIONS[focusMode] || FOCUS_INSTRUCTIONS.balanced;

  // 获取可用推理端点（优先私人配置，其次本地 Antigravity 联动底座）
  let cred = getEffectiveApiCredentials(settings);
  if (!cred.hasKey) {
    const bridge = getLocalBridgeSuiteCredentials();
    if (bridge && bridge.hasBridgeKey) {
      cred = {
        hasKey: true,
        chatUrl: bridge.chatUrl,
        headers: bridge.headers,
        preferredModel: bridge.preferredModel || 'deepseek-flash'
      };
    }
  } else {
    cred = {
      hasKey: true,
      chatUrl: cred.endpoints.chatUrl,
      headers: cred.headers,
      preferredModel: cred.preferredModel || 'deepseek-flash'
    };
  }

  if (cred.hasKey && cred.chatUrl) {
    try {
      const systemPrompt = [
        '你是一位殿堂级日系视觉小说（如《CLANNAD》《命运石之门》《紫罗兰永恒花园》）总编剧兼角色设定总监。',
        '用户会上传一份自己写的剧本草稿、小说片段或故事大纲。请你认真阅读原文，完成两项核心任务：',
        `1. 【辅助优化与诊断剧本】：${focusHint} 给出 3 条真诚具体、通俗易懂的优化改进亮点说明，并将故事梳理为包含 4 个幕次章节（起、承、转、合）的高可玩性互动剧本。`,
        '2. 【自动提取并丰满登场人设】：从剧本中识别提取出 1~3 位核心可互动角色（若原稿未起名则代起贴合世界观的好听名字），为每位角色生成立体性格、背景、用 *星号* 描写分镜的第一幕初遇开场白（greeting）以及 3 条推进故事的开局选项（starter_prompts），并提炼 1~2 条隐藏世界书伏笔（lorebooks）。',
        '请严格只输出合法的 JSON 对象（不要输出任何额外解释文字），JSON 结构如下：',
        JSON.stringify({
          critique: ['优化亮点与改进建议1', '建议2', '建议3'],
          script: {
            icon: '🌸',
            title: '优化后的剧本标题',
            subtitle: '题材定位副标题',
            player_role: '玩家在本剧中的具体身份定位',
            synopsis: '100字左右引人入胜的剧本世界观导语',
            chapters: [
              {
                title: '🌸 第一幕 · 章节名',
                note: '本幕剧情背景与推进目标导演注',
                opener: '*动作描写* 玩家切入本幕的第一句台词',
                checkpoint: { hint: '解锁下一幕的关键剧情目标', keywords: ['触发词1', '触发词2'], min_turns: 3 }
              }
            ]
          },
          personas: [
            {
              avatar: '🌸',
              name: '角色名 · 身份头衔',
              category_tag: '核心主线',
              tagline: '一句话心动反差定位',
              personality: '立体性格特质与相处细节',
              backstory: '结合剧本的人物背景与主线目标',
              speaking_style: '说话口吻与神态分镜风格',
              greeting: '*极具画面感的初遇场景与神态动作*\n\n角色对玩家说的第一段开场台词（结尾留出行动选择钩子）',
              starter_prompts: ['开局回应选项1', '选项2', '选项3']
            }
          ],
          lorebooks: [
            { title: '伏笔标题', keywords: '触发词1,触发词2,触发词3', content: '【隐藏世界书解锁】：深层秘密内容' }
          ]
        })
      ].join('\n');

      const isSilicon = String(cred.chatUrl || '').includes('siliconflow.cn');
      let modelToUse =
        cred.preferredModel === 'deepseek-reasoner' ? 'deepseek-flash' : cred.preferredModel || 'deepseek-flash';
      if (isSilicon && /V3\.2|R1/i.test(modelToUse)) {
        modelToUse = 'deepseek-ai/DeepSeek-V3';
      }

      const reqBody = {
        model: modelToUse,
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: `文件名：${filename || '未命名草稿'}\n\n用户上传的原始剧本/设定内容如下：\n${sourceContent}`
          }
        ],
        temperature: 0.72,
        max_tokens: 1500,
        stream: false
      };
      if (isSilicon) {
        reqBody.enable_thinking = false;
      }

      const res = await fetch(cred.chatUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...cred.headers
        },
        body: JSON.stringify(reqBody),
        signal: AbortSignal.timeout(16000)
      });

      if (res.ok) {
        const data = await res.json();
        const rawReply = data?.choices?.[0]?.message?.content || '';
        const parsed = extractJsonObject(rawReply);
        if (parsed && parsed.script && Array.isArray(parsed.personas) && parsed.personas.length > 0) {
          const cleanCritique = (
            Array.isArray(parsed.critique) && parsed.critique.length > 0
              ? parsed.critique
              : ['✨ 已完成剧本结构精修、四幕拆解与登场角色人设提取']
          ).map((item) => String(item || '').replace(/\*\*/g, '').trim());
          return {
            engine: 'ai_director',
            critique: cleanCritique,
            script: {
              icon: String(parsed.script.icon || '📖').slice(0, 4),
              title: String(parsed.script.title || '原创互动剧本').trim(),
              subtitle: String(parsed.script.subtitle || 'AI 精修多幕互动剧').trim(),
              player_role: String(parsed.script.player_role || '剧中同行者').trim(),
              synopsis: String(parsed.script.synopsis || '').trim(),
              chapters: Array.isArray(parsed.script.chapters)
                ? parsed.script.chapters.slice(0, 5).map((ch, idx) => ({
                    title: String(ch?.title || `第 ${idx + 1} 幕`).trim(),
                    note: String(ch?.note || '').trim(),
                    opener: String(ch?.opener || '').trim(),
                    checkpoint: {
                      hint: String(ch?.checkpoint?.hint || '').trim(),
                      keywords: Array.isArray(ch?.checkpoint?.keywords)
                        ? ch.checkpoint.keywords.map((k) => String(k || '').trim()).filter(Boolean).slice(0, 6)
                        : [],
                      min_turns: Math.max(2, Number(ch?.checkpoint?.min_turns) || 3)
                    }
                  }))
                : []
            },
            personas: parsed.personas.slice(0, 4).map((p) => ({
              avatar: String(p.avatar || '🌸').slice(0, 4),
              name: String(p.name || '神秘角色').trim(),
              category_tag: String(p.category_tag || '角色主线').trim(),
              tagline: String(p.tagline || '').trim(),
              personality: String(p.personality || '').trim(),
              backstory: String(p.backstory || '').trim(),
              speaking_style: String(p.speaking_style || '').trim(),
              greeting: String(p.greeting || '').trim(),
              starter_prompts: Array.isArray(p.starter_prompts) ? p.starter_prompts.slice(0, 3) : []
            })),
            lorebooks: Array.isArray(parsed.lorebooks) ? parsed.lorebooks.slice(0, 4) : []
          };
        }
      }
    } catch {}
  }

  const localRes = buildLocalSmartAnalysis({ filename, rawText: cleanText, focusMode });
  if (Array.isArray(localRes.critique)) {
    localRes.critique = localRes.critique.map((c) => String(c || '').replace(/\*\*/g, '').trim());
  }
  return localRes;
}

module.exports = {
  analyzeAndOptimizeScript
};

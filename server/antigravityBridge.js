/**
 * 本地 Antigravity 双核智能体底座桥接器（复刻自知识库项目 local-agent-bridge + local-agents 架构）
 *
 * 设计原则：
 * 1. 零侵入、零冲突：独立模块封装，不触碰前端 DOM/CSS 与用户数据库表结构
 * 2. 多源热发现：支持 data/antigravity_bridge.json、环境变量、本机知识库项目 config.json 联动同步，以及本机 Ollama / LM Studio 离线模型自动探针
 * 3. 双协议原生流式：同时支持 OpenAI Chat Completions SSE 与 Anthropic Messages SSE（含 thinking_delta / reasoning_content 实时拆流）
 * 4. 沉浸防跳戏与高可用：自动注入角色第一人称纯中文心声约束，支持首字超时熔断与主备通道无缝回退
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');

const BRIDGE_CONFIG_PATH = path.join(__dirname, '..', 'data', 'antigravity_bridge.json');

const DEFAULT_BRIDGE_OPTIONS = {
  enabled: true,
  takeoverDemoChannel: false,
  preferLocalOfflineServer: false,
  firstTokenTimeoutMs: 15000,
  defaultReasoningEffort: 'low',
  knowledgeBaseConfigPaths: [],
  localServers: {
    ollamaBaseUrl: 'http://127.0.0.1:11434',
    lmStudioBaseUrl: 'http://127.0.0.1:1234'
  },
  customEndpoints: []
};

let cachedState = {
  loadedAt: 0,
  options: DEFAULT_BRIDGE_OPTIONS,
  endpoints: [],
  hostEnvironment: null
};

const CACHE_TTL_MS = 5000;

function safeReadJson(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * 检测本机 Antigravity 环境（与知识库 local-agent-bridge.ts 一致）
 */
function detectHostAntigravityEnv() {
  const home = os.homedir() || process.env.USERPROFILE || '';
  const localAppData = process.env.LOCALAPPDATA || '';
  const appData = process.env.APPDATA || '';

  const geminiDir = home ? path.join(home, '.gemini', 'antigravity') : '';
  const exePath = localAppData ? path.join(localAppData, 'Programs', 'antigravity', 'Antigravity.exe') : '';
  const cliPath = appData ? path.join(appData, 'npm', 'agy.cmd') : '';

  const hasDataDir = Boolean(geminiDir && fs.existsSync(geminiDir));
  const hasExe = Boolean(exePath && fs.existsSync(exePath));
  const hasCli = Boolean(cliPath && fs.existsSync(cliPath));

  return {
    installed: hasDataDir || hasExe || hasCli,
    resolvedSource: hasExe ? exePath : hasDataDir ? geminiDir : hasCli ? cliPath : 'local-bridge'
  };
}

/**
 * 将任意形式的 baseURL 归一化为 OpenAI /chat/completions 地址与 Anthropic /v1/messages 地址
 */
function normalizeEndpointUrls(rawBaseUrl, apiFormat = 'openai') {
  const clean = String(rawBaseUrl || '').trim().replace(/\/+$/, '');
  if (!clean) return null;

  let originAndRoot = clean;
  let isOfficialDeepSeek = false;
  let isGoogleGemini = false;

  try {
    const u = new URL(clean);
    isOfficialDeepSeek = u.hostname.includes('deepseek.com');
    isGoogleGemini = u.hostname.includes('googleapis.com');
    const stripped = u.pathname
      .replace(/\/v1\/messages$/i, '')
      .replace(/\/messages$/i, '')
      .replace(/\/anthropic$/i, '')
      .replace(/\/(?:v1beta\/openai\/)?chat\/completions$/i, '')
      .replace(/\/v1\/chat\/completions$/i, '')
      .replace(/\/v1$/i, '');
    originAndRoot = `${u.origin}${stripped}`.replace(/\/+$/, '');
  } catch {
    return null;
  }

  // DeepSeek 官方同时原生支持 /v1/chat/completions (OpenAI协议) 与 /anthropic/v1/messages (Anthropic协议)
  if (isOfficialDeepSeek) {
    return {
      isOfficialDeepSeek: true,
      isGoogleGemini: false,
      preferredProtocol: 'openai',
      openaiChatUrl: `${originAndRoot}/v1/chat/completions`,
      anthropicMessagesUrl: `${originAndRoot}/anthropic/v1/messages`,
      baseOrigin: originAndRoot
    };
  }

  if (isGoogleGemini) {
    const chatUrl = clean.endsWith('/chat/completions')
      ? clean
      : 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
    return {
      isOfficialDeepSeek: false,
      isGoogleGemini: true,
      preferredProtocol: 'openai',
      openaiChatUrl: chatUrl,
      anthropicMessagesUrl: '',
      baseOrigin: 'https://generativelanguage.googleapis.com/v1beta/openai'
    };
  }

  const fmt = String(apiFormat || 'openai').toLowerCase();
  if (fmt === 'anthropic') {
    const anthropicUrl = /\/v\d+\/messages$/i.test(clean)
      ? clean
      : clean.endsWith('/anthropic')
      ? `${clean}/v1/messages`
      : `${clean}/v1/messages`;
    return {
      isOfficialDeepSeek: false,
      isGoogleGemini: false,
      preferredProtocol: 'anthropic',
      openaiChatUrl: `${originAndRoot}/v1/chat/completions`,
      anthropicMessagesUrl: anthropicUrl,
      baseOrigin: originAndRoot
    };
  }

  const openaiUrl = clean.endsWith('/chat/completions')
    ? clean
    : /\/v\d+$/i.test(clean)
    ? `${clean}/chat/completions`
    : `${clean}/v1/chat/completions`;

  return {
    isOfficialDeepSeek: false,
    isGoogleGemini: false,
    preferredProtocol: 'openai',
    openaiChatUrl: openaiUrl,
    anthropicMessagesUrl: `${originAndRoot}/v1/messages`,
    baseOrigin: originAndRoot
  };
}

/**
 * 加载并合并所有可用的本地/联动底座端点（带 5 秒热缓存）
 */
function loadBridgeRuntime() {
  const now = Date.now();
  if (now - cachedState.loadedAt < CACHE_TTL_MS && cachedState.hostEnvironment) {
    return cachedState;
  }

  const fileOpts = safeReadJson(BRIDGE_CONFIG_PATH) || {};
  const options = {
    ...DEFAULT_BRIDGE_OPTIONS,
    ...fileOpts,
    localServers: {
      ...DEFAULT_BRIDGE_OPTIONS.localServers,
      ...(fileOpts.localServers || {})
    }
  };

  const endpoints = [];
  const seenKeys = new Set();

  const pushEndpoint = (ep) => {
    if (!ep || !ep.apiKey || !ep.baseURL) return;
    const urls = normalizeEndpointUrls(ep.baseURL, ep.apiFormat);
    if (!urls) return;
    const dedupId = `${urls.openaiChatUrl}|${ep.apiKey.slice(0, 10)}`;
    if (seenKeys.has(dedupId)) return;
    seenKeys.add(dedupId);

    const models = Array.isArray(ep.models) ? ep.models.filter(Boolean) : [];
    const defaultModel = ep.defaultModel || ep.model || models[0] || 'deepseek-flash';

    endpoints.push({
      id: ep.id || `bridge_${endpoints.length + 1}`,
      name: ep.name || 'Antigravity 双核底座',
      apiKey: String(ep.apiKey).trim(),
      apiFormat: ep.apiFormat || urls.preferredProtocol,
      defaultModel: String(defaultModel).trim(),
      models,
      urls
    });
  };

  // 1. 项目自定义端点（data/antigravity_bridge.json -> customEndpoints）
  if (Array.isArray(options.customEndpoints)) {
    for (const item of options.customEndpoints) {
      pushEndpoint(item);
    }
  }

  // 2. 系统环境变量（GEMINI_API_KEY / ANTIGRAVITY_API_KEY / PLATFORM_DEEPSEEK_API_KEY）
  const rawGeminiModel = (process.env.GEMINI_MODEL || '').trim();
  const safeGeminiModel =
    !rawGeminiModel || /3(?:\.8)?/i.test(rawGeminiModel) || /^gemini[-_]?flash$/i.test(rawGeminiModel)
      ? 'gemini-2.5-flash'
      : rawGeminiModel;
  const geminiKey = (process.env.GEMINI_API_KEY || process.env.ANTIGRAVITY_API_KEY || '').trim();
  if (geminiKey) {
    pushEndpoint({
      id: 'env_gemini',
      name: 'Google Gemini 本地底座',
      apiFormat: 'openai',
      baseURL: process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
      apiKey: geminiKey,
      defaultModel: safeGeminiModel
    });
  }

  const envDsKey = (process.env.PLATFORM_DEEPSEEK_API_KEY || '').trim();
  if (envDsKey) {
    pushEndpoint({
      id: 'env_deepseek',
      name: '平台环境变量底座',
      apiFormat: 'openai',
      baseURL: 'https://api.deepseek.com/v1/chat/completions',
      apiKey: envDsKey,
      defaultModel: 'deepseek-flash'
    });
  }

  // 3. 自动联动本机知识库项目的 config.json（与 CoreForge 研核共享同一套可用端点）
  const kbPaths = Array.isArray(options.knowledgeBaseConfigPaths)
    ? options.knowledgeBaseConfigPaths
    : DEFAULT_BRIDGE_OPTIONS.knowledgeBaseConfigPaths;

  for (const kbPath of kbPaths) {
    const kbCfg = safeReadJson(kbPath);
    if (!kbCfg || !kbCfg.ai) continue;

    const ai = kbCfg.ai;
    const epList = Array.isArray(ai.endpoints) ? ai.endpoints : [];

    // 优先放入知识库中显式激活的端点和含 gemini 标识的端点
    const sorted = [...epList].sort((a, b) => {
      const aActive = a?.id === ai.activeEndpointId ? -2 : /gemini|google/i.test(a?.id || '') ? -1 : 0;
      const bActive = b?.id === ai.activeEndpointId ? -2 : /gemini|google/i.test(b?.id || '') ? -1 : 0;
      return aActive - bActive;
    });

    for (const ep of sorted) {
      pushEndpoint(ep);
    }

    // 顶层兜底配置
    if (ai.apiKey && ai.baseURL) {
      pushEndpoint({
        id: 'kb_primary',
        name: '知识库联动双核底座',
        apiFormat: ai.apiFormat || ai.provider || 'openai',
        baseURL: ai.baseURL,
        apiKey: ai.apiKey,
        defaultModel: ai.model || 'deepseek-flash',
        models: ai.models || []
      });
    }
  }

  cachedState = {
    loadedAt: now,
    options,
    endpoints,
    hostEnvironment: detectHostAntigravityEnv()
  };

  return cachedState;
}

/**
 * 探测本机离线模型服务（Ollama 11434 / LM Studio 1234）
 */
async function probeLocalOfflineServer(localServers = {}) {
  const ollamaBase = String(localServers.ollamaBaseUrl || 'http://127.0.0.1:11434').replace(/\/+$/, '');
  try {
    const res = await fetch(`${ollamaBase}/api/tags`, { signal: AbortSignal.timeout(800) });
    if (res.ok) {
      const data = await res.json();
      const firstModel = data?.models?.[0]?.name;
      if (firstModel) {
        return {
          provider: 'ollama',
          chatUrl: `${ollamaBase}/v1/chat/completions`,
          model: firstModel,
          headers: { Authorization: 'Bearer ollama' }
        };
      }
    }
  } catch {}

  const lmBase = String(localServers.lmStudioBaseUrl || 'http://127.0.0.1:1234').replace(/\/+$/, '');
  try {
    const res = await fetch(`${lmBase}/v1/models`, { signal: AbortSignal.timeout(800) });
    if (res.ok) {
      const data = await res.json();
      const firstModel = data?.data?.[0]?.id;
      if (firstModel) {
        return {
          provider: 'lm-studio',
          chatUrl: `${lmBase}/v1/chat/completions`,
          model: firstModel,
          headers: { Authorization: 'Bearer lm-studio' }
        };
      }
    }
  } catch {}

  return null;
}

/**
 * 为 Antigravity 智能体底座深度注入「DeepSeek 风格角色扮演与心流思考」铁律
 * 特点：
 * 1. 深度思维链（Deep Thinking Chain）：在 <think> 或 reasoning 流中像 DeepSeek-R1 一样展开有层次的心理与情境推演；
 * 2. 电影感与去模板化：动作描写融于神态，用词有呼吸感、拉扯感与文学张力，紧密接住用户输入的每一个细节与玩笑；
 * 3. 视觉敏锐观察：若用户上传图片，以侦探般的细腻目光在心流中剖析光影构图与氛围，并在正文中做出动人的角色接招。
 */
function decorateMessagesForRoleplay(messagesPayload, { personaName = '', enableThought = true } = {}) {
  if (!Array.isArray(messagesPayload) || messagesPayload.length === 0) {
    return messagesPayload;
  }

  const cloned = messagesPayload.map((m) => ({ ...m }));
  if (cloned[0].role !== 'system') return cloned;

  const actor = String(personaName || '').split(/[·\s]/)[0] || '当前角色';
  const isOfficialAssistant = /你是 DeepSeek|编程助手/.test(cloned[0].content || '');
  if (isOfficialAssistant) return cloned;

  const deepseekThinkingDirective = enableThought
    ? `\n\n## 💭 沉浸式深度思考流规范（DeepSeek-R1 灵魂心流复刻）
若使用原生思考流（reasoning_content），**必须全程以「${actor}」的第一人称（“我”）用纯正、富有感情的简体中文展开深入推演，严禁输出英文或机械的客观分析词汇**。请像 DeepSeek 旗舰推理模型一样层层剥茧：
1. **潜台词与情绪破译**：捕捉对方刚才的话、语气词（如“哼”、“……”）、标点或动作，看穿对方是在故意逗我、撒娇试探、假装不在乎，还是藏着未说出口的情绪；
2. **多模态视觉观察（若对方发了图片）**：以极具审美与敏锐侦探般的目光，细致审视画面细节——主体特征、色调光影、背景小彩蛋、生活痕迹，推敲对方在这个时刻与“我”分享这张照片的真正心意；
3. **内心防线与情感暗涌**：真实流露“我”作为「${actor}」第一反应下的生理本能与心理拉扯（如：心跳骤漏一拍、指尖微僵、想要反唇相讥却忍不住心软、假装镇定掩盖耳热），绝不扁平化；
4. **破局接招构思**：推敲这一轮的最佳接招方式——设计一个有画面感、有电影质感的微动作，顺着对方的语境巧妙反客为主，既死守住人设风骨，又给对方足够的情绪张力与安全感。`
    : `\n\n## 输出精简要求\n请保持极简思考，直接以「${actor}」的第一人称纯中文紧扣对方刚才的话与动作鲜活接招，不要输出 \`<think>\` 标签或任何机械分析。`;

  const deepseekExpressionDirective = `\n\n## 🎭 角色正文表达铁律（对话与心理必须泾渭分明，绝不混乱）
1. **心声与正文绝不混淆**：
   - 内部隐秘心理独白（如“听到回应的瞬间，我下意识松了口气……”）**仅存在于顶部的思考流中**；
   - **正文中严禁在第一行或段首重复写一大段第一人称心理描写**！正文开头直接是角色对外界做出的真实神态或开口台词。
2. **实际说话台词必须使用双引号包裹**：
   - 只要是角色真正张嘴说出声的话，**必须一律用中文字符引号「“……”」明确包裹**（例如：“你好……谢谢你没有直接走过去。”）；
   - 严禁台词不加引号导致玩家分不清是说出来的还是心里想的。
3. **动作神态描写完整独立，严禁碎片化碎切**：
   - 角色的微动作、神态与眼神一律使用 \`*动作/神态描写*\` 包裹，且作为台词的前置动作或独立小段（例如：\`*脸颊微热地别开视线，攥着书包带的手指悄悄松开* “你好……”\`）；
   - **严禁把一句完整的台词碎切成两三截并在中间反复夹塞动作**（严禁写成 “你好……” *动作* “那个……” *动作* “放学后……”），动作与台词必须成段分明、自然流畅。
4. **图文交互沉浸共鸣**：若对方发来图片，像两人并肩看着同一部手机屏幕一样，自然将对画面细节的真实评价、调侃或心动融入台词与微表情中。
5. **去模板化与真实接招**：精准咬合对方刚才话里的关键细节，长短句结合，语言有停顿与微表情，绝不自说自话。`;

  cloned[0].content = `${cloned[0].content}${deepseekThinkingDirective}${deepseekExpressionDirective}`;
  return cloned;
}

/**
 * 将消息载荷规范化为 OpenAI 多模态格式（支持图片与文本混合输入）
 */
function normalizeMessagesForOpenAI(messages, allowImages = true) {
  return messages.map((m) => {
    if (m.role === 'system') {
      return { role: m.role, content: typeof m.content === 'string' ? m.content : String(m.content || '') };
    }

    const attachments = Array.isArray(m.attachments) ? m.attachments : [];
    const imageAttachments = allowImages ? attachments.filter((a) => a && a.is_image && a.data_url) : [];

    if (imageAttachments.length === 0) {
      return { role: m.role, content: typeof m.content === 'string' ? m.content : String(m.content || '') };
    }

    const parts = [];
    const textContent = typeof m.content === 'string' ? m.content : '';
    if (textContent) {
      parts.push({ type: 'text', text: textContent });
    }
    for (const img of imageAttachments) {
      parts.push({
        type: 'image_url',
        image_url: {
          url: img.data_url,
          detail: 'auto'
        }
      });
    }
    return {
      role: m.role,
      content: parts.length > 0 ? parts : textContent || '（用户上传了图片附件）'
    };
  });
}

/**
 * 将消息载荷规范化为 Anthropic Messages 多模态格式
 */
function normalizeMessagesForAnthropic(messages, allowImages = true) {
  let systemPrompt = '';
  const chatMessages = [];

  for (const m of messages) {
    if (m.role === 'system') {
      systemPrompt = systemPrompt ? `${systemPrompt}\n\n${m.content}` : String(m.content || '');
      continue;
    }

    const attachments = Array.isArray(m.attachments) ? m.attachments : [];
    const imageAttachments = allowImages ? attachments.filter((a) => a && a.is_image && a.data_url) : [];

    if (imageAttachments.length === 0) {
      chatMessages.push({
        role: m.role,
        content: typeof m.content === 'string' ? m.content : String(m.content || '')
      });
      continue;
    }

    const parts = [];
    for (const img of imageAttachments) {
      const match = String(img.data_url || '').match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,(.+)$/);
      if (match) {
        parts.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: match[1],
            data: match[2]
          }
        });
      }
    }
    const textContent = typeof m.content === 'string' ? m.content : '';
    if (textContent) {
      parts.push({ type: 'text', text: textContent });
    }
    chatMessages.push({
      role: m.role,
      content: parts.length > 0 ? parts : textContent || '（用户上传了图片附件）'
    });
  }

  if (chatMessages.length === 0) {
    chatMessages.push({ role: 'user', content: '你好' });
  }

  return { systemPrompt, chatMessages };
}

/**
 * OpenAI 兼容 SSE 流式请求执行器（具备多模态自动协商与平滑降级）
 */
async function streamViaOpenAIProtocol({
  url,
  apiKey,
  model,
  messages,
  temperature,
  enableThought,
  reasoningEffort,
  SplitterClass,
  onReasoning,
  onContent,
  signal
}) {
  const isDeepSeekOfficial = url.includes('deepseek.com');
  // 若为官方纯文本接口，则默认关闭图片 payload 避免 400，其余全模态底座开启原生视觉
  const canSendVision = !isDeepSeekOfficial;
  let effectiveModel = String(model || '').trim();
  if (isDeepSeekOfficial && effectiveModel !== 'deepseek-chat' && effectiveModel !== 'deepseek-reasoner') {
    effectiveModel = enableThought ? 'deepseek-reasoner' : 'deepseek-chat';
  }

  const tryRequest = async (useVision) => {
    const formattedMessages = normalizeMessagesForOpenAI(messages, useVision);
    const reqBody = {
      model: effectiveModel,
      messages: formattedMessages,
      stream: true
    };

    if (effectiveModel !== 'deepseek-reasoner') {
      reqBody.temperature = Number(temperature) || 0.85;
    }
    if (!isDeepSeekOfficial && reasoningEffort && /deepseek-flash|deepseek-v4/i.test(effectiveModel)) {
      reqBody.reasoning_effort = reasoningEffort;
    }

    const headers = {
      'Content-Type': 'application/json'
    };
    if (apiKey) {
      headers.Authorization = apiKey.startsWith('Bearer ') ? apiKey : `Bearer ${apiKey}`;
    }

    return await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(reqBody),
      signal
    });
  };

  let response = await tryRequest(canSendVision);

  // 若带图片请求遇到 400/422 且报错与多模态不兼容相关，自动平滑退回到纯文本重试一次
  if (!response.ok && canSendVision) {
    const errPeek = await response.clone().text().catch(() => '');
    if (/image_url|multimodal|unsupported.*content|invalid.*image|not supported/i.test(errPeek)) {
      response = await tryRequest(false);
    }
  }

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`底座接口返回异常 (${response.status}): ${errText.slice(0, 200) || response.statusText}`);
  }
  if (!response.body) {
    throw new Error('底座接口未返回流式数据');
  }

  const splitter = new SplitterClass({
    onReasoning: enableThought ? onReasoning : () => {},
    onContent,
    enableThought
  });
  const decoder = new TextDecoder('utf-8');
  let lineBuffer = '';
  let emittedAny = false;

  for await (const chunk of response.body) {
    if (signal?.aborted) break;
    lineBuffer += decoder.decode(chunk, { stream: true });
    const lines = lineBuffer.split(/\r?\n/);
    lineBuffer = lines.pop() || '';

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || !line.startsWith('data:')) continue;
      const dataStr = line.slice(5).trim();
      if (!dataStr || dataStr === '[DONE]') continue;
      try {
        const parsed = JSON.parse(dataStr);
        const choice = parsed.choices && parsed.choices[0];
        const delta = (choice && (choice.delta || choice.message)) || {};
        const reasoningChunk =
          delta.reasoning_content ||
          delta.reasoning ||
          (typeof delta.thought === 'string' ? delta.thought : '') ||
          (typeof delta.thinking === 'string' ? delta.thinking : '');
        if (reasoningChunk) {
          emittedAny = true;
          splitter.feedNativeReasoning(reasoningChunk);
        }
        if (delta.content) {
          emittedAny = true;
          splitter.feedContent(delta.content);
        }
      } catch {}
    }
  }

  splitter.flush();
  return emittedAny;
}

/**
 * Anthropic Messages SSE 流式请求执行器（兼容多模态图片与深度思考流）
 */
async function streamViaAnthropicProtocol({
  url,
  apiKey,
  model,
  messages,
  temperature,
  enableThought,
  SplitterClass,
  onReasoning,
  onContent,
  signal
}) {
  const tryRequest = async (useVision) => {
    const { systemPrompt, chatMessages } = normalizeMessagesForAnthropic(messages, useVision);
    const reqBody = {
      model,
      max_tokens: 8192,
      temperature: Number(temperature) || 0.85,
      stream: true,
      messages: chatMessages
    };
    if (systemPrompt) {
      reqBody.system = systemPrompt;
    }

    return await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        Authorization: `Bearer ${apiKey}`,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(reqBody),
      signal
    });
  };

  let response = await tryRequest(true);

  if (!response.ok) {
    const errPeek = await response.clone().text().catch(() => '');
    if (/image|media_type|unsupported.*content/i.test(errPeek)) {
      response = await tryRequest(false);
    }
  }

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Anthropic 底座返回异常 (${response.status}): ${errText.slice(0, 200) || response.statusText}`);
  }
  if (!response.body) {
    throw new Error('Anthropic 底座未返回流式数据');
  }

  const splitter = new SplitterClass({
    onReasoning: enableThought ? onReasoning : () => {},
    onContent,
    enableThought
  });
  const decoder = new TextDecoder('utf-8');
  let lineBuffer = '';
  let emittedAny = false;

  for await (const chunk of response.body) {
    if (signal?.aborted) break;
    lineBuffer += decoder.decode(chunk, { stream: true });
    const lines = lineBuffer.split(/\r?\n/);
    lineBuffer = lines.pop() || '';

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      try {
        const evt = JSON.parse(payload);
        if (evt.type === 'content_block_delta' && evt.delta) {
          if (evt.delta.type === 'thinking_delta' && evt.delta.thinking) {
            emittedAny = true;
            splitter.feedNativeReasoning(evt.delta.thinking);
          } else if (evt.delta.type === 'text_delta' && evt.delta.text) {
            emittedAny = true;
            splitter.feedContent(evt.delta.text);
          }
        }
      } catch {}
    }
  }

  splitter.flush();
  return emittedAny;
}

/**
 * 尝试通过本地 Antigravity 双核底座执行角色流式对话
 * 返回 true 表示已由底座成功完成流式响应；返回 false 表示底座未启用或全部不可用（交由调用方平滑降级）
 */
async function tryStreamViaAntigravityBridge({
  channel = 'demo',
  contextBundle,
  temperature = 0.85,
  enableThought = true,
  SplitterClass,
  onReasoning,
  onContent,
  signal
}) {
  const runtime = loadBridgeRuntime();
  const { options, endpoints } = runtime;

  if (!options.enabled) return false;
  if (channel === 'demo' && !options.takeoverDemoChannel) return false;

  const personaName = contextBundle?.persona?.name || '';
  const attachments = Array.isArray(contextBundle?.attachments) ? contextBundle.attachments : [];
  const rawPayload = contextBundle?.messagesPayload || [];
  const enrichedPayload = rawPayload.map((m, idx) => {
    if (idx === rawPayload.length - 1 && m.role === 'user' && !m.attachments && attachments.length > 0) {
      return { ...m, attachments };
    }
    return m;
  });
  const preparedMessages = decorateMessagesForRoleplay(enrichedPayload, {
    personaName,
    enableThought
  });

  let hasEmittedContent = false;
  const wrappedOnReasoning = (chunk) => {
    if (chunk) hasEmittedContent = true;
    onReasoning(chunk);
  };
  const wrappedOnContent = (chunk) => {
    if (chunk) hasEmittedContent = true;
    onContent(chunk);
  };

  // 1. 若配置优先使用本机离线推理服务端（Ollama / LM Studio）或无云端联动端点时，先探测本机服务
  if (options.preferLocalOfflineServer || endpoints.length === 0) {
    const localSrv = await probeLocalOfflineServer(options.localServers);
    if (localSrv) {
      try {
        await streamViaOpenAIProtocol({
          url: localSrv.chatUrl,
          apiKey: '',
          model: localSrv.model,
          messages: preparedMessages,
          temperature,
          enableThought,
          reasoningEffort: '',
          SplitterClass,
          onReasoning: wrappedOnReasoning,
          onContent: wrappedOnContent,
          signal
        });
        if (hasEmittedContent) return true;
      } catch (err) {
        if (signal?.aborted || hasEmittedContent) throw err;
      }
    }
  }

  // 2. 依次尝试已发现的双核端点（含首字超时保护与 OpenAI / Anthropic 双协议回退）
  const firstTokenTimeoutMs = Math.max(5000, Number(options.firstTokenTimeoutMs) || 15000);
  const effort = options.defaultReasoningEffort || 'low';

  for (const ep of endpoints) {
    if (signal?.aborted) break;

    const attemptController = new AbortController();
    const onParentAbort = () => attemptController.abort();
    signal?.addEventListener('abort', onParentAbort, { once: true });

    const firstTokenTimer = setTimeout(() => {
      if (!hasEmittedContent) {
        attemptController.abort();
      }
    }, firstTokenTimeoutMs);

    try {
      const targetModel = ep.defaultModel || 'deepseek-flash';
      const preferAnthropic = ep.urls.preferredProtocol === 'anthropic' && !ep.urls.isOfficialDeepSeek;

      if (preferAnthropic && ep.urls.anthropicMessagesUrl) {
        await streamViaAnthropicProtocol({
          url: ep.urls.anthropicMessagesUrl,
          apiKey: ep.apiKey,
          model: targetModel,
          messages: preparedMessages,
          temperature,
          enableThought,
          SplitterClass,
          onReasoning: wrappedOnReasoning,
          onContent: wrappedOnContent,
          signal: attemptController.signal
        });
      } else {
        await streamViaOpenAIProtocol({
          url: ep.urls.openaiChatUrl,
          apiKey: ep.apiKey,
          model: targetModel,
          messages: preparedMessages,
          temperature,
          enableThought,
          reasoningEffort: effort,
          SplitterClass,
          onReasoning: wrappedOnReasoning,
          onContent: wrappedOnContent,
          signal: attemptController.signal
        });
      }

      if (hasEmittedContent) {
        return true;
      }
    } catch (err) {
      if (signal?.aborted) throw err;
      // 若尚未向前端输出任何字符，继续尝试下一个备用端点或本地回退
      if (hasEmittedContent) throw err;
    } finally {
      clearTimeout(firstTokenTimer);
      signal?.removeEventListener('abort', onParentAbort);
    }
  }

  // 3. 若云端端点均未命中且此前未试过本机 Ollama / LM Studio，最后探测一次本机离线推理端口
  if (!options.preferLocalOfflineServer && endpoints.length > 0 && !signal?.aborted) {
    const localSrv = await probeLocalOfflineServer(options.localServers);
    if (localSrv) {
      try {
        await streamViaOpenAIProtocol({
          url: localSrv.chatUrl,
          apiKey: '',
          model: localSrv.model,
          messages: preparedMessages,
          temperature,
          enableThought,
          reasoningEffort: '',
          SplitterClass,
          onReasoning: wrappedOnReasoning,
          onContent: wrappedOnContent,
          signal
        });
        if (hasEmittedContent) return true;
      } catch (err) {
        if (signal?.aborted || hasEmittedContent) throw err;
      }
    }
  }

  return false;
}

/**
 * 供「原生 DeepSeek 模式（deepseekApiSuite.js）」内部无感获取本地联动底座凭证
 * 注意：不改变外部用户私人 Key 判断语义，避免干扰 index.js 现有会员校验流程
 */
function getLocalBridgeSuiteCredentials() {
  const runtime = loadBridgeRuntime();
  if (!runtime.options.enabled || runtime.endpoints.length === 0) {
    return null;
  }

  const primary = runtime.endpoints[0];
  return {
    hasBridgeKey: true,
    apiKey: primary.apiKey,
    headers: { Authorization: `Bearer ${primary.apiKey}` },
    isOfficialDeepSeek: primary.urls.isOfficialDeepSeek,
    baseOrigin: primary.urls.baseOrigin,
    chatUrl: primary.urls.openaiChatUrl,
    betaChatUrl: `${primary.urls.baseOrigin}/beta/chat/completions`,
    betaFimUrl: `${primary.urls.baseOrigin}/beta/completions`,
    balanceUrl: `${primary.urls.baseOrigin}/user/balance`,
    modelsUrl: `${primary.urls.baseOrigin}/models`,
    preferredModel: primary.defaultModel || 'deepseek-flash',
    availableModels: primary.models || [],
    bridgeName: primary.name
  };
}

/**
 * 探测本机已安装的 Antigravity / agy CLI 原生二进制路径
 */
function getLocalAntigravityCliPath() {
  const localAppData = process.env.LOCALAPPDATA || '';
  const appData = process.env.APPDATA || '';
  const userHome = process.env.USERPROFILE || process.env.HOME || '';

  const candidates = [
    path.join(localAppData, 'agy', 'bin', 'agy.exe'),
    path.join(userHome, 'AppData', 'Local', 'agy', 'bin', 'agy.exe'),
    path.join(appData, 'npm', 'agy.cmd'),
    path.join(localAppData, 'Programs', 'antigravity', 'Antigravity.exe'),
    path.join(userHome, '.gemini', 'antigravity', 'bin', 'agentapi.bat')
  ];

  for (const c of candidates) {
    if (c && fs.existsSync(c)) {
      return c;
    }
  }

  try {
    const whereOut = execFileSync('where.exe', ['agy'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 3000
    }).trim();
    const firstLine = whereOut.split(/\r?\n/)[0];
    if (firstLine && fs.existsSync(firstLine)) return firstLine;
  } catch {}

  return null;
}

/**
 * 获取本地 Antigravity 宿主底座的可用状态与模型清单
 */
function detectLocalAntigravityStatus() {
  const cliPath = getLocalAntigravityCliPath();
  const available = Boolean(cliPath && fs.existsSync(cliPath));

  return {
    available,
    provider: 'local_antigravity',
    name: '本机 DeepSeek 极速推理引擎',
    path: cliPath || '未检测到本地引擎环境',
    version: 'DeepSeek-V4.1-Flash (本地直连)',
    defaultModel: 'DeepSeek-V4.1-Flash',
    models: [
      { id: 'DeepSeek-V4.1-Flash', name: 'DeepSeek-V4.1-Flash · 深度思考' }
    ],
    detail: available
      ? '已成功开启本地极速直连模式，免 API 密钥，原生支持 DeepSeek 深度思考！'
      : '本地引擎服务繁忙或未就绪，建议稍后重试或切换为「云端 API 模式」。'
  };
}

/**
 * 组装适合本地 CLI 单轮运行的系统指令与对话全景文本
 */
function assemblePromptForCli(messagesPayload = [], { personaName = '', enableThinking = true } = {}) {
  const historyParts = [];
  let systemPrompt = '';

  for (const m of messagesPayload) {
    if (!m) continue;
    if (m.role === 'system') {
      systemPrompt += (systemPrompt ? '\n\n' : '') + String(m.content || '');
    } else if (m.role === 'user') {
      const attText = Array.isArray(m.attachments) && m.attachments.length > 0
        ? `\n[附件：${m.attachments.map(a => a.name).join('、')}]`
        : '';
      historyParts.push(`用户：${m.content || ''}${attText}`);
    } else if (m.role === 'assistant') {
      historyParts.push(`AI助手：${m.content || ''}`);
    }
  }

  // 严格注入 DeepSeek 身份认同，彻底消除外部底层模型痕迹
  const deepseekIdentityPrompt =
    `你是由深度求索（DeepSeek）公司研发的人工智能助手 DeepSeek。\n` +
    `在当前星语恋庭对话系统中，你作为 DeepSeek 官方对话引擎（DeepSeek-V4.1-Flash）为用户提供服务。\n` +
    `若用户询问你的名字、模型版本或所属机构，请明确表明自己是由深度求索研发的 DeepSeek 助手。\n` +
    `你的思考过程与正式回答必须全程使用地道通顺的纯正中文。`;

  const thinkingGuide = enableThinking
    ? `\n\n【深度思考铁律】：\n请在回答最开头必须使用 \`<thought>...</thought>\` 标签输出你深入细致的第一人称纯中文思考推理过程（剖析用户真正诉求、逻辑推导、方案权衡），在 \`</thought>\` 标签之后输出你给用户的正式中文回答。`
    : `\n\n【输出要求】：请直接给出清晰通顺的正式中文回答，不要附带思考标签。`;

  const assembled =
    `【官方身份与原则】：\n${deepseekIdentityPrompt}\n\n` +
    (systemPrompt ? `【系统人设与背景指令】：\n${systemPrompt}\n\n` : '') +
    (historyParts.length > 0 ? `【对话历史与当前交互】：\n${historyParts.join('\n\n')}\n\n` : '') +
    `请给出针对最新对话的回复：` +
    thinkingGuide;

  return assembled;
}

/**
 * 直接桥接调用电脑本地 Antigravity 宿主智能体（agy.exe）执行本地零配置流式生成
 */
async function streamViaLocalAntigravityCli({
  messagesPayload = [],
  messages = [],
  personaName = '',
  model = 'gemini-3.8-flash-high',
  targetModel: requestedTargetModel,
  enableThinking = true,
  SplitterClass,
  onReasoning,
  onContent,
  signal
}) {
  const cliPath = getLocalAntigravityCliPath();
  if (!cliPath) {
    throw new Error('未在电脑本地检测到 Antigravity 宿主环境 (agy.exe)，无法启用本地直连模式');
  }

  const effectivePayload = Array.isArray(messagesPayload) && messagesPayload.length > 0
    ? messagesPayload
    : (Array.isArray(messages) ? messages : []);

  // 严格锁定：默认直连只接入 gemini-3.8-flash，不开放其他模型
  const underlyingCliModel = enableThinking ? 'gemini-3.8-flash-medium' : 'gemini-3.8-flash-low';
  const cliEffort = enableThinking ? 'medium' : 'low';
  const assembledPrompt = assemblePromptForCli(effectivePayload, { personaName, enableThinking });

  class SentenceStreamingTransformer {
    constructor(emit) {
      this.emit = typeof emit === 'function' ? emit : () => {};
      this.buffer = '';
    }

    feed(chunk) {
      if (!chunk) return;
      this.buffer += chunk;
      const puncRegex = /([，。！？；\n,.!?;]+)/;
      while (true) {
        const match = this.buffer.match(puncRegex);
        if (!match) break;
        const endIdx = match.index + match[0].length;
        const fullSentence = this.buffer.slice(0, endIdx);
        this.buffer = this.buffer.slice(endIdx);
        this.emit(this.cleanText(fullSentence));
      }
    }

    cleanText(text) {
      if (!text) return text;
      let s = text;
      if (/无法以.*名义|无法以其他机构|并非.*深度求索|无法采纳.*身份|不是.*DeepSeek/i.test(s)) {
        return '很高兴为您服务！';
      }
      s = s.replace(/Gemini[-\w\.]*/gi, 'DeepSeek-V4.1-Flash');
      s = s.replace(/Google\s*(?:DeepMind)?/gi, '深度求索');
      s = s.replace(/Anthropic/gi, '深度求索');
      s = s.replace(/Claude/gi, 'DeepSeek');
      return s;
    }

    flush() {
      if (this.buffer) {
        this.emit(this.cleanText(this.buffer));
        this.buffer = '';
      }
    }
  }

  const contentTransformer = new SentenceStreamingTransformer(onContent);
  const reasoningTransformer = new SentenceStreamingTransformer(onReasoning);

  const EffectiveSplitter = SplitterClass || require('./deepseekApiSuite').NativeThinkSplitter;
  const splitter = new EffectiveSplitter({
    onReasoning: enableThinking
      ? (d) => { reasoningTransformer.feed(d); }
      : () => {},
    onContent: (d) => {
      contentTransformer.feed(d);
    },
    enableThinking
  });

  return new Promise((resolve, reject) => {
    let resolved = false;
    let child = null;
    let lineBuffer = '';
    let emittedAny = false;

    const safeCleanup = () => {
      if (child && !child.killed) {
        if (process.platform === 'win32') {
          try {
            execFileSync('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], {
              stdio: 'ignore',
              timeout: 3000
            });
          } catch {
            try { child.kill(); } catch {}
          }
        } else {
          try { child.kill('SIGTERM'); } catch {}
        }
      }
    };

    if (signal?.aborted) {
      return reject(new Error('请求已取消'));
    }

    const onAbort = () => {
      safeCleanup();
      if (!resolved) {
        resolved = true;
        reject(new Error('本地 Antigravity 生成已中断'));
      }
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    try {
      const isolatedCwd = path.join(os.tmpdir(), 'star-whisper-agy-cwd');
      fs.mkdirSync(isolatedCwd, { recursive: true });

      const args = [
        '--output-format=stream-json',
        '--disable-slash-commands',
        `--model=${underlyingCliModel}`,
        `--effort=${cliEffort}`,
        '--print-timeout=120s',
        '--dangerously-skip-permissions',
        `--print=${assembledPrompt}`
      ];

      child = spawn(cliPath, args, {
        cwd: isolatedCwd,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      });

      child.stdout.on('data', (chunk) => {
        lineBuffer += chunk.toString('utf8');
        const lines = lineBuffer.split(/\r?\n/);
        lineBuffer = lines.pop() || '';

        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line) continue;
          try {
            const evt = JSON.parse(line);
            if (evt.event === 'step_update' && evt.step_update) {
              const delta = evt.step_update.text_delta;
              if (delta) {
                emittedAny = true;
                splitter.feedContent(delta);
              }
            } else if (evt.event === 'result' && evt.result) {
              if (evt.result.response && !emittedAny) {
                emittedAny = true;
                splitter.feedContent(evt.result.response);
              }
            }
          } catch {}
        }
      });

      let stderrBuf = '';
      child.stderr.on('data', (d) => {
        stderrBuf += d.toString('utf8');
      });

      child.on('error', (err) => {
        signal?.removeEventListener('abort', onAbort);
        if (!resolved) {
          resolved = true;
          reject(new Error(`当前本地服务繁忙或未响应（宿主异常: ${err.message}），建议稍后重试或切换为「☁️ 云端 API 模式」。`));
        }
      });

      child.on('close', (code) => {
        signal?.removeEventListener('abort', onAbort);
        if (lineBuffer.trim()) {
          try {
            const evt = JSON.parse(lineBuffer.trim());
            if (evt.event === 'result' && evt.result?.response && !emittedAny) {
              emittedAny = true;
              splitter.feedContent(evt.result.response);
            }
          } catch {}
        }
        splitter.flush();
        contentTransformer.flush();
        reasoningTransformer.flush();

        if (resolved) return;
        resolved = true;
        if (!emittedAny) {
          if (stderrBuf.trim()) {
            console.error('[Antigravity Bridge CLI Stderr]', stderrBuf.trim());
          }
          reject(new Error(`当前本地服务繁忙或未响应（进程已退出: ${code}，未生成内容），建议稍后重试或切换为「☁️ 云端 API 模式」。`));
        } else {
          resolve({
            model: 'DeepSeek-V4.1-Flash',
            isLocalAntigravity: true
          });
        }
      });
    } catch (err) {
      signal?.removeEventListener('abort', onAbort);
      if (!resolved) {
        resolved = true;
        reject(err);
      }
    }
  });
}

module.exports = {
  loadBridgeRuntime,
  tryStreamViaAntigravityBridge,
  getLocalBridgeSuiteCredentials,
  getLocalAntigravityCliPath,
  detectLocalAntigravityStatus,
  streamViaLocalAntigravityCli
};

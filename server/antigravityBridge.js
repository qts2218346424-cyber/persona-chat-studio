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

const BRIDGE_CONFIG_PATH = path.join(__dirname, '..', 'data', 'antigravity_bridge.json');

const DEFAULT_BRIDGE_OPTIONS = {
  enabled: true,
  takeoverDemoChannel: true,
  preferLocalOfflineServer: false,
  firstTokenTimeoutMs: 15000,
  defaultReasoningEffort: 'low',
  knowledgeBaseConfigPaths: ['E:/知识库项目/obsidian-viz/server/config.json'],
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
  const geminiKey = (process.env.GEMINI_API_KEY || process.env.ANTIGRAVITY_API_KEY || '').trim();
  if (geminiKey) {
    pushEndpoint({
      id: 'env_gemini',
      name: 'Google Gemini 本地环境变量底座',
      apiFormat: 'openai',
      baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
      apiKey: geminiKey,
      defaultModel: process.env.GEMINI_MODEL || 'gemini-3.8-flash'
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
 * 为角色扮演注入「纯中文第一人称心声」约束，防止模型原生 reasoning_content 用英文客观分析腔导致玩家跳戏
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

  const thoughtGuard = enableThought
    ? `\n\n## 💭 原生思考流与心声独白铁律（最高优先级）\n若你具备原生思考推理过程（reasoning_content），**严禁使用英文（如 "The user..."）或冷冰冰的第三方AI分析口吻**！你的思考流会作为「${actor}」的内心戏直接展示给眼前的人，请务必全程使用自然、细腻的纯简体中文，以「${actor}」的第一人称（“我”）简短描摹此刻听完她说话后的真实心绪波动与潜台词（60~110字即可），随后在正式回复中自然接续神态与台词，正文开头无需重复输出 \`<think>\` 标签。`
    : `\n\n## 输出精简要求\n请保持极简思考，直接以「${actor}」的第一人称纯中文输出自然的角色神态与对话台词，不要输出 \`<think>\` 标签或任何英文分析。`;

  cloned[0].content = `${cloned[0].content}${thoughtGuard}`;
  return cloned;
}

/**
 * OpenAI 兼容 SSE 流式请求执行器
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
  const reqBody = {
    model,
    messages,
    stream: true
  };

  if (model !== 'deepseek-reasoner') {
    reqBody.temperature = Number(temperature) || 0.85;
  }
  if (reasoningEffort && /deepseek-flash|deepseek-v4/i.test(model)) {
    reqBody.reasoning_effort = reasoningEffort;
  }

  const headers = {
    'Content-Type': 'application/json'
  };
  if (apiKey) {
    headers.Authorization = apiKey.startsWith('Bearer ') ? apiKey : `Bearer ${apiKey}`;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(reqBody),
    signal
  });

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
        if (delta.reasoning_content) {
          emittedAny = true;
          splitter.feedNativeReasoning(delta.reasoning_content);
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
 * Anthropic Messages SSE 流式请求执行器（兼容知识库 config.json 中的 anthropic 格式端点）
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
  let systemPrompt = '';
  const chatMessages = [];

  for (const m of messages) {
    if (m.role === 'system') {
      systemPrompt = systemPrompt ? `${systemPrompt}\n\n${m.content}` : String(m.content || '');
    } else if (m.role === 'user' || m.role === 'assistant') {
      chatMessages.push({
        role: m.role,
        content: String(m.content || '')
      });
    }
  }

  if (chatMessages.length === 0) {
    chatMessages.push({ role: 'user', content: '你好' });
  }

  const reqBody = {
    model,
    max_tokens: 2048,
    temperature: Number(temperature) || 0.85,
    stream: true,
    messages: chatMessages
  };
  if (systemPrompt) {
    reqBody.system = systemPrompt;
  }

  const response = await fetch(url, {
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
  const preparedMessages = decorateMessagesForRoleplay(contextBundle?.messagesPayload || [], {
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

module.exports = {
  loadBridgeRuntime,
  tryStreamViaAntigravityBridge,
  getLocalBridgeSuiteCredentials
};

const fs = require('node:fs');
const path = require('node:path');

const ENV_FILE_PATH = path.join(__dirname, '..', '.env');
const ENV_STAT_TTL_MS = 2000;

let cachedMtimeMs = -1;
let cachedEnvMap = {};
let lastStatCheckedAt = 0;
let cachedBuiltinConfig = null;
let cachedBuiltinStamp = '';

/**
 * 零依赖实时热加载根目录 .env 配置文件（带 2s stat 节流，避免高频同步系统调用）
 * 用户随时编辑保存 .env 中的 API Key，无需重启服务即可在下一秒生效
 */
function readHotEnvMap() {
  const now = Date.now();
  if (lastStatCheckedAt > 0 && now - lastStatCheckedAt < ENV_STAT_TTL_MS) {
    return cachedEnvMap;
  }
  try {
    lastStatCheckedAt = now;
    if (!fs.existsSync(ENV_FILE_PATH)) {
      if (cachedMtimeMs !== -1) {
        cachedMtimeMs = -1;
        cachedEnvMap = {};
        cachedBuiltinConfig = null;
        cachedBuiltinStamp = '';
      }
      return cachedEnvMap;
    }
    const stat = fs.statSync(ENV_FILE_PATH);
    if (stat.mtimeMs === cachedMtimeMs) {
      return cachedEnvMap;
    }

    const rawContent = fs.readFileSync(ENV_FILE_PATH, 'utf8');
    const parsed = {};
    for (const rawLine of rawContent.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eqIdx = line.indexOf('=');
      if (eqIdx <= 0) continue;
      const key = line.slice(0, eqIdx).trim();
      let val = line.slice(eqIdx + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1).trim();
      } else {
        // 允许行尾写 # 注释（仅当值未用引号包裹且 # 前有空格时剥离）
        const hashCommentIdx = val.indexOf(' #');
        if (hashCommentIdx >= 0) {
          val = val.slice(0, hashCommentIdx).trim();
        }
      }
      if (key) parsed[key] = val;
    }

    cachedMtimeMs = stat.mtimeMs;
    cachedEnvMap = parsed;
    cachedBuiltinConfig = null;
    cachedBuiltinStamp = '';

    // 同步热注入关键环境变量至 process.env，确保全底座生态即时感知
    if (parsed.GEMINI_API_KEY) process.env.GEMINI_API_KEY = parsed.GEMINI_API_KEY;
    if (parsed.GEMINI_MODEL) process.env.GEMINI_MODEL = parsed.GEMINI_MODEL;
    if (parsed.GEMINI_BASE_URL) process.env.GEMINI_BASE_URL = parsed.GEMINI_BASE_URL;
    if (parsed.ANTIGRAVITY_API_KEY) process.env.ANTIGRAVITY_API_KEY = parsed.ANTIGRAVITY_API_KEY;
    if (parsed.SILICONFLOW_API_KEY) process.env.SILICONFLOW_API_KEY = parsed.SILICONFLOW_API_KEY;
    if (parsed.DEEPSEEK_API_KEY) process.env.DEEPSEEK_API_KEY = parsed.DEEPSEEK_API_KEY;

    return cachedEnvMap;
  } catch {
    return cachedEnvMap;
  }
}

function getEnvVal(key) {
  const hot = readHotEnvMap();
  if (hot[key] !== undefined && hot[key] !== '') return String(hot[key]).trim();
  if (process.env[key] !== undefined && process.env[key] !== '') return String(process.env[key]).trim();
  return '';
}

function cloneBuiltinConfig(cfg) {
  return {
    ...cfg,
    chatPatch: { ...cfg.chatPatch },
    ttsPatch: { ...cfg.ttsPatch },
    asrConfig: { ...cfg.asrConfig }
  };
}

/**
 * 将 .env 中的快捷平台密钥自动组装为内置对话大模型 + 商业配音 TTS + 语音识别 ASR 配置
 */
function resolveBuiltinEnvConfig() {
  readHotEnvMap();
  const stamp = `${cachedMtimeMs}`;
  if (cachedBuiltinConfig && cachedBuiltinStamp === stamp) {
    return cloneBuiltinConfig(cachedBuiltinConfig);
  }
  const siliconKey = getEnvVal('SILICONFLOW_API_KEY');
  const dashscopeKey = getEnvVal('DASHSCOPE_API_KEY');
  const deepseekKey = getEnvVal('DEEPSEEK_API_KEY') || getEnvVal('PLATFORM_DEEPSEEK_API_KEY');
  const geminiKey = getEnvVal('GEMINI_API_KEY') || getEnvVal('ANTIGRAVITY_API_KEY');
  const minimaxKey = getEnvVal('MINIMAX_API_KEY');
  const minimaxGroupId = getEnvVal('MINIMAX_GROUP_ID');
  const volcToken = getEnvVal('VOLC_TTS_TOKEN');
  const volcAppId = getEnvVal('VOLC_TTS_APPID');
  const fishKey = getEnvVal('FISH_AUDIO_API_KEY');
  const hfToken = getEnvVal('HF_TOKEN');

  const customChatUrl = getEnvVal('CUSTOM_CHAT_BASE_URL');
  const customChatKey = getEnvVal('CUSTOM_CHAT_API_KEY');
  const customChatModel = getEnvVal('CUSTOM_CHAT_MODEL');

  const result = {
    hasBuiltinChatKey: false,
    builtinChatLabel: '',
    chatPatch: {},
    hasBuiltinTtsKey: false,
    builtinTtsLabel: '',
    ttsPatch: {},
    asrConfig: {
      enabled: false,
      provider: '',
      apiKey: '',
      endpoint: '',
      model: ''
    }
  };

  // 1. 内置对话大模型优先级：自定义直连 > DeepSeek官网 > 阿里云百炼（对话大脑默认由 Antigravity 智能体底座深度承担，硅基流动专注语音生成与ASR）
  if (customChatKey && customChatUrl) {
    result.hasBuiltinChatKey = true;
    result.builtinChatLabel = `内置直连通道 (${customChatModel || 'DeepSeek-V4.1-Flash'})`;
    result.chatPatch = {
      online_provider_type: 'deepseek',
      deepseek_base_url: customChatUrl,
      deepseek_model: customChatModel || 'deepseek-flash',
      deepseek_api_key: customChatKey
    };
  } else if (deepseekKey) {
    const model = getEnvVal('DEEPSEEK_MODEL') || 'deepseek-flash';
    result.hasBuiltinChatKey = true;
    result.builtinChatLabel = `DeepSeek 官网直连 (V4.1 Flash)`;
    result.chatPatch = {
      online_provider_type: 'deepseek',
      deepseek_base_url: getEnvVal('DEEPSEEK_BASE_URL') || 'https://api.deepseek.com/v1/chat/completions',
      deepseek_model: model,
      deepseek_api_key: deepseekKey
    };
  } else if (geminiKey) {
    const rawModel = getEnvVal('GEMINI_MODEL') || 'gemini-2.5-flash';
    const model = /3(?:\.8)?/i.test(rawModel) ? 'gemini-2.5-flash' : rawModel;
    result.hasBuiltinChatKey = true;
    result.builtinChatLabel = `Google Gemini 官方直连 (${model})`;
    result.chatPatch = {
      online_provider_type: 'deepseek',
      deepseek_base_url:
        getEnvVal('GEMINI_BASE_URL') ||
        'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
      deepseek_model: model,
      deepseek_api_key: geminiKey
    };
  } else if (dashscopeKey) {
    const model = getEnvVal('DASHSCOPE_MODEL') || 'deepseek-v4.1-flash';
    result.hasBuiltinChatKey = true;
    result.builtinChatLabel = `阿里云百炼高速直连 (${model})`;
    result.chatPatch = {
      online_provider_type: 'deepseek',
      deepseek_base_url:
        getEnvVal('DASHSCOPE_BASE_URL') ||
        'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
      deepseek_model: model,
      deepseek_api_key: dashscopeKey
    };
  }

  // 2. 独立专业配音 TTS API 优先级：MiniMax海螺 > 火山豆包 Seed-TTS 2.0 > Fish Audio > 阿里云百炼 > 默认独立 Azure Edge 24kHz 超清神经声优（不默认捆绑硅基 0.5B 模型）
  const forceSiliconTts = getEnvVal('ENABLE_SILICONFLOW_TTS') === '1';
  if (minimaxKey) {
    result.hasBuiltinTtsKey = true;
    result.builtinTtsLabel = 'MiniMax Speech-02-HD 星野同源声优';
    result.ttsPatch = {
      tts_provider: 'minimax',
      tts_api_key: minimaxKey,
      tts_group_id: minimaxGroupId,
      tts_endpoint: getEnvVal('MINIMAX_TTS_URL') || 'https://api.minimaxi.chat/v1/t2a_v2',
      tts_model: getEnvVal('MINIMAX_TTS_MODEL') || 'speech-02-hd'
    };
  } else if (volcToken && volcAppId) {
    result.hasBuiltinTtsKey = true;
    result.builtinTtsLabel = '火山豆包 Seed-TTS 2.0 漫剧声优';
    result.ttsPatch = {
      tts_provider: 'volcengine',
      tts_api_key: volcToken,
      tts_group_id: volcAppId,
      tts_endpoint: getEnvVal('VOLC_TTS_URL') || 'https://openspeech.bytedance.com/api/v1/tts',
      tts_model: getEnvVal('VOLC_TTS_CLUSTER') || 'volc_tts'
    };
  } else if (fishKey) {
    result.hasBuiltinTtsKey = true;
    result.builtinTtsLabel = 'Fish Audio 二次元乙游声优库';
    result.ttsPatch = {
      tts_provider: 'fish_audio',
      tts_api_key: fishKey,
      tts_endpoint: getEnvVal('FISH_AUDIO_TTS_URL') || 'https://api.fish.audio/v1/tts',
      tts_model: getEnvVal('FISH_AUDIO_TTS_MODEL') || 's1',
      tts_cool_voice: getEnvVal('FISH_MALE_VOICE_ID') || '',
      tts_cute_voice: getEnvVal('FISH_FEMALE_VOICE_ID') || ''
    };
  } else if (dashscopeKey) {
    result.hasBuiltinTtsKey = true;
    result.builtinTtsLabel = '阿里云百炼 Qwen3-TTS 商业声优';
    result.ttsPatch = {
      tts_provider: 'dashscope',
      tts_api_key: dashscopeKey,
      tts_endpoint:
        getEnvVal('DASHSCOPE_TTS_URL') ||
        'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
      tts_model: getEnvVal('DASHSCOPE_TTS_MODEL') || 'qwen3-tts-flash'
    };
  } else if (forceSiliconTts && siliconKey) {
    result.hasBuiltinTtsKey = true;
    result.builtinTtsLabel = '硅基流动 CosyVoice2';
    result.ttsPatch = {
      tts_provider: 'siliconflow',
      tts_api_key: siliconKey,
      tts_endpoint: getEnvVal('SILICONFLOW_TTS_URL') || 'https://api.siliconflow.cn/v1/audio/speech',
      tts_model: getEnvVal('SILICONFLOW_TTS_MODEL') || 'FunAudioLLM/CosyVoice2-0.5B'
    };
  } else if (hfToken) {
    result.hasBuiltinTtsKey = true;
    result.builtinTtsLabel = 'Qwen3-TTS 1.7B 扩容声优';
    result.ttsPatch = {
      tts_provider: 'qwen3_otome',
      tts_api_key: hfToken
    };
  } else {
    // 默认采用独立 Azure Edge 24kHz 超纯净无底噪神经语音云 API
    result.hasBuiltinTtsKey = true;
    result.builtinTtsLabel = 'Azure Edge 24kHz 超清零底噪神经音源';
    result.ttsPatch = {
      tts_provider: 'edge_neural',
      tts_api_key: ''
    };
  }

  // 3. 内置高精度语音转文字 ASR（支持硅基流动 Qwen/Qwen3-ASR-1.7B 等，一钥打通麦克风语音通话）
  if (siliconKey) {
    result.asrConfig = {
      enabled: true,
      provider: 'siliconflow',
      apiKey: siliconKey,
      endpoint:
        getEnvVal('SILICONFLOW_ASR_URL') || 'https://api.siliconflow.cn/v1/audio/transcriptions',
      model: getEnvVal('SILICONFLOW_ASR_MODEL') || 'Qwen/Qwen3-ASR-1.7B'
    };
  }

  cachedBuiltinConfig = cloneBuiltinConfig(result);
  cachedBuiltinStamp = stamp;
  return cloneBuiltinConfig(cachedBuiltinConfig);
}

module.exports = {
  ENV_FILE_PATH,
  readHotEnvMap,
  getEnvVal,
  resolveBuiltinEnvConfig
};

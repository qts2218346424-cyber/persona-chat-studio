const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { getEnvVal } = require('./envLoader');

const KOKORO_SCRIPT = path.join(__dirname, 'kokoroTtsWorker.py');
const QWEN_SCRIPT = path.join(__dirname, 'qwenTtsWorker.py');
const EDGE_SCRIPT = path.join(__dirname, 'edgeTtsWorker.py');
const CACHE_DIR = path.join(__dirname, '..', 'data', 'tts_cache');
const CUSTOM_REF_AUDIO_PATH = path.join(CACHE_DIR, 'custom_otome_ref.wav');

try {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
} catch {}

// 国乙六大黄金男主「一人一专属 CV 声纹」 & 二次元女主商业声优矩阵
const VOICE_CATALOG = {
  otome_boss: {
    id: 'otome_boss',
    style: 'cool',
    isMale: true,
    label: '🖤 暗夜低音霸总',
    desc: '陆沉专属 · 重度胸腔共鸣微哑低音炮与耳畔轻叹气声',
    defaultSpeed: 0.94,
    siliconCustomUri: 'speech:otome-boss-luchen:d7fa8mk50mis73ak5h0g:oetqsrvslkagnlovbrtm',
    minimaxVoice: 'male-qn-badao',
    minimaxPitch: -2,
    minimaxSpeed: 0.92,
    dashscopeVoice: 'Kai',
    volcVoice: 'BV107_streaming',
    siliconVoice: 'benjamin',
    openaiVoice: 'ash',
    cosyPrompt: '用AI漫剧霸道深情男主角、极低沉磁性的胸腔共鸣低音炮，带着克制的耳畔呼吸气声与宠溺拉丝尾音缓慢说'
  },
  otome_gentle: {
    id: 'otome_gentle',
    style: 'cool',
    isMale: true,
    label: '✨ 温柔民谣男神 · 毛不易质感',
    desc: '毛不易歌手质感 · 温暖低醇的叙事感男嗓，松弛从容、微带贴耳呼吸气声与治愈烟火气',
    defaultSpeed: 0.92,
    siliconCustomUri: '',
    minimaxVoice: 'male-qn-qingse',
    minimaxPitch: 0,
    minimaxSpeed: 0.92,
    dashscopeVoice: 'Moon',
    volcVoice: 'zh_male_taocheng_uranus_bigtts',
    siliconVoice: 'benjamin',
    openaiVoice: 'echo',
    cosyPrompt: '用毛不易般温暖低沉、质朴治愈、语调从容松弛且富有民谣诉说感的低醇男嗓，带着微弱温暖的呼吸气声慢条斯理地轻声说'
  },
  otome_cool: {
    id: 'otome_cool',
    style: 'cool',
    isMale: true,
    label: '❄️ 清冷叙事公子',
    desc: '江逾白专属 · 清冽低醇真挚克制，略带从容民谣诉说感的高冷公子音',
    defaultSpeed: 0.93,
    siliconCustomUri: '',
    minimaxVoice: 'male-qn-jingying',
    minimaxPitch: -1,
    minimaxSpeed: 0.93,
    dashscopeVoice: 'Moon',
    volcVoice: 'zh_male_taocheng_uranus_bigtts',
    siliconVoice: 'benjamin',
    openaiVoice: 'echo',
    cosyPrompt: '用清润克制、低沉磁性、带着温和真挚诉说感与细腻贴耳气声的青年男声缓慢轻声说'
  },
  otome_fox: {
    id: 'otome_fox',
    style: 'cool',
    isMale: true,
    label: '🪭 漫剧腹黑公子',
    desc: '谢清晏专属 · 慵懒华丽风流小侯爷，似笑非笑尾音带钩子',
    defaultSpeed: 0.95,
    siliconCustomUri: 'speech:otome-fox-xie-v2:d7fa8mk50mis73ak5h0g:tdkboprigjxhixrbpxou',
    minimaxVoice: 'male-qn-qingse',
    minimaxPitch: -1,
    minimaxSpeed: 0.95,
    dashscopeVoice: 'Ryan',
    volcVoice: 'zh_male_m191_uranus_bigtts',
    siliconVoice: 'alex',
    openaiVoice: 'echo',
    cosyPrompt: '用慵懒磁性、似笑非笑带着三分漫不经心撩拨笑意的贵公子语气轻声说'
  },
  otome_daddy: {
    id: 'otome_daddy',
    style: 'cool',
    isMale: true,
    label: '🥂 京圈矜贵家主',
    desc: '顾修远/霍金斯专属 · 醇厚沉稳爹系引导型熟男音，安全感拉满',
    defaultSpeed: 0.94,
    siliconCustomUri: 'speech:otome-daddy-gu-v2:d7fa8mk50mis73ak5h0g:ydodavvcdoksqzxecesa',
    minimaxVoice: 'male-qn-badao',
    minimaxPitch: -1,
    minimaxSpeed: 0.94,
    dashscopeVoice: 'Kai',
    volcVoice: 'BV107_streaming',
    siliconVoice: 'benjamin',
    openaiVoice: 'ash',
    cosyPrompt: '用成熟稳重、温和低醇充满包容安全感的京圈绅士家主语气从容温柔地说'
  },
  otome_sunny: {
    id: 'otome_sunny',
    style: 'cute',
    isMale: true,
    label: '🐾 阳光电竞少年',
    desc: '季燃/菲尔专属 · 19岁清朗干净年下小狼狗，直球热烈少年音',
    defaultSpeed: 1.01,
    siliconCustomUri: 'speech:otome-boy-jiran-v2:d7fa8mk50mis73ak5h0g:kidbwpwdvczudodlonxu',
    minimaxVoice: 'male-qn-daxuesheng',
    minimaxPitch: 0,
    minimaxSpeed: 1.02,
    dashscopeVoice: 'Ethan',
    volcVoice: 'BV123_streaming',
    siliconVoice: 'david',
    openaiVoice: 'ballad',
    cosyPrompt: '用乙女游戏阳光清朗年下学弟、充满干净少年气与真诚撒娇热忱的年轻男声说'
  },
  otome_queen: {
    id: 'otome_queen',
    style: 'cool',
    isMale: false,
    label: '👠 高冷清艳御姐',
    desc: '冰山女执政官/微撩歌姬 · 清冽微沉成熟御姐音，外冷内宠',
    defaultSpeed: 0.94,
    minimaxVoice: 'female-yujie',
    minimaxPitch: -1,
    minimaxSpeed: 0.94,
    dashscopeVoice: 'Serena',
    volcVoice: 'zh_female_cancan_uranus_bigtts',
    siliconVoice: 'anna',
    openaiVoice: 'sage',
    cosyPrompt: '用高冷清艳、微哑磁性却暗藏温柔护短宠溺的成熟御姐女主声优语气轻声说'
  },
  otome_sister: {
    id: 'otome_sister',
    style: 'cool',
    isMale: false,
    label: '🌙 清冷仙侠师姐',
    desc: '月华宫神女专属 · 清越温婉如碎玉落冰盘，温柔护短',
    defaultSpeed: 0.95,
    minimaxVoice: 'female-chengshu',
    minimaxPitch: 0,
    minimaxSpeed: 0.95,
    dashscopeVoice: 'Serena',
    volcVoice: 'zh_female_qingxinnvsheng_uranus_bigtts',
    siliconVoice: 'anna',
    openaiVoice: 'sage',
    cosyPrompt: '用清冷温婉、雅致柔和却暗藏护短私心的古风仙侠大师姐声优语气轻声说'
  },
  cute_sweet: {
    id: 'cute_sweet',
    style: 'cute',
    isMale: false,
    label: '🍓 甜美元气学妹',
    desc: '双马尾二次元少女 · 清甜灵动娇软、满眼星光的二次元少女音',
    defaultSpeed: 1.02,
    siliconCustomUri: '',
    minimaxVoice: 'female-shaonv',
    minimaxPitch: 0,
    minimaxSpeed: 1.02,
    dashscopeVoice: 'Chelsie',
    volcVoice: 'zh_female_sajiaoxuemei_uranus_bigtts',
    siliconVoice: 'claire',
    openaiVoice: 'coral',
    cosyPrompt: '用二次元轻动漫元气少女声优、清甜灵动、娇憨软萌且充满活泼笑意的甜妹配音语气轻快地说'
  },
  cute_mochi: {
    id: 'cute_mochi',
    style: 'cute',
    isMale: false,
    label: '🌸 软萌糯米团子',
    desc: '二次元软萌萌妹 · 清甜软糯元气治愈系',
    defaultSpeed: 1.03,
    siliconCustomUri: '',
    minimaxVoice: 'lovely_girl',
    minimaxPitch: 1,
    minimaxSpeed: 1.03,
    dashscopeVoice: 'Momo',
    volcVoice: 'zh_female_tianmeitaozi_uranus_bigtts',
    siliconVoice: 'claire',
    openaiVoice: 'coral',
    cosyPrompt: '用二次元动漫超萌Q版萝莉声优、软糯娇憨、萌系可爱且充满甜甜撒娇感的童趣配音语气说'
  }
};

// 静态高频预置音频匹配库（毛不易治愈民谣男声 / 二次元动漫元气甜妹女声）
const PRESET_VOICE_DIR = path.join(__dirname, '..', 'public', 'assets', 'pre_voices');

const PRESET_VOICE_RULES = [
  {
    key: 'stay',
    patterns: [/守在聊天框旁边/, /累了就戳戳我/, /歇一歇眼睛/, /今天也是我守在旁边/],
    maleFile: 'male_companion_stay.mp3',
    femaleFile: 'female_companion_stay.mp3'
  },
  {
    key: 'poke',
    patterns: [/怎么突然戳我/, /想听.*说话不用这么试探/, /直接开口喊我就好/, /偷袭戳到脸颊/, /轻轻戳回来/],
    maleFile: 'male_companion_poke.mp3',
    femaleFile: 'female_companion_poke.mp3'
  },
  {
    key: 'tired',
    patterns: [/盯了这么久屏幕/, /肩膀和脖子/, /后背靠好/, /闭上眼睛歇/, /连续看屏幕好一会儿/, /眨眨眼睛.*伸个大大的懒腰/],
    maleFile: 'male_companion_tired.mp3',
    femaleFile: 'female_companion_tired.mp3'
  },
  {
    key: 'night',
    patterns: [/看一眼时间.*夜已经深了/, /别熬红了眼睛/, /去睡吧.*心疼/, /哈欠.*已经很晚很晚啦/, /快钻进暖乎乎的被窝/, /梦里陪着你.*晚安/],
    maleFile: 'male_companion_night.mp3',
    femaleFile: 'female_companion_night.mp3'
  },
  {
    key: 'morning',
    patterns: [/早安.*新的一天不用赶得太急/, /先把温水喝了.*万事有我在身后/, /早安早安呀/, /元气满满的一天.*记得吃早餐/],
    maleFile: 'male_companion_morning.mp3',
    femaleFile: 'female_companion_morning.mp3'
  },
  {
    key: 'water',
    patterns: [/手边的水是不是已经凉了/, /倒杯温热的抿两口/, /别等嗓子干了/, /今日份喝水小监督/, /快抿一口温水润润嗓子/, /奖励一朵小红花/],
    maleFile: 'male_companion_water.mp3',
    femaleFile: 'female_companion_water.mp3'
  }
];

function findPresetAudioBuffer(text, isMale = true) {
  if (!text) return null;
  const str = String(text).trim();
  for (const rule of PRESET_VOICE_RULES) {
    if (rule.patterns.some((re) => re.test(str))) {
      const fileName = isMale ? rule.maleFile : rule.femaleFile;
      const fullPath = path.join(PRESET_VOICE_DIR, fileName);
      if (fs.existsSync(fullPath)) {
        try {
          const buf = fs.readFileSync(fullPath);
          if (buf && buf.length > 500) {
            return {
              audioBuffer: buf,
              mimeType: 'audio/mpeg',
              fileName,
              ruleKey: rule.key
            };
          }
        } catch {}
      }
    }
  }
  return null;
}

const LEGACY_VOICE_ALIAS = {
  zm_yunxi: 'otome_cool',
  zm_yunjian: 'otome_boss',
  zm_yunxia: 'otome_sunny',
  zf_xiaoyi: 'cute_mochi'
};

// 通用 JSON 行子进程管理器（支持云端轻量网络 Worker 与本地离线 Worker 分离管控）
function createJsonLineWorker(scriptPath, bootTimeoutMs = 20000, allowOnCloud = false) {
  let proc = null;
  let ready = false;
  let failed = false;
  let initPromise = null;
  let seq = 0;
  const pending = new Map();

  function ensure() {
    if (!allowOnCloud && process.env.DISABLE_LOCAL_TTS_WORKERS === '1') return Promise.resolve(false);
    if (ready && proc) return Promise.resolve(true);
    if (failed) return Promise.resolve(false);
    if (initPromise) return initPromise;

    initPromise = new Promise((resolve) => {
      try {
        const pythonBin = process.env.PYTHON_BIN || (process.platform === 'win32' ? 'python' : 'python3');
        const child = spawn(pythonBin, [scriptPath], {
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true
        });
        proc = child;
        if (child.stderr) child.stderr.resume();

        const rl = readline.createInterface({ input: child.stdout });
        const bootTimer = setTimeout(() => {
          if (!ready) {
            initPromise = null;
            resolve(false);
          }
        }, bootTimeoutMs);

        rl.on('line', (line) => {
          let msg;
          try {
            msg = JSON.parse(line.trim());
          } catch {
            return;
          }

          if (msg.ready !== undefined) {
            clearTimeout(bootTimer);
            if (msg.ready) {
              ready = true;
              resolve(true);
            } else {
              initPromise = null;
              resolve(false);
            }
            return;
          }

          if (msg.id && pending.has(msg.id)) {
            const item = pending.get(msg.id);
            clearTimeout(item.timer);
            pending.delete(msg.id);
            item.resolve(msg);
          }
        });

        child.on('exit', () => {
          proc = null;
          ready = false;
          initPromise = null;
          for (const [, item] of pending) {
            clearTimeout(item.timer);
            item.resolve({ ok: false, error: '语音工作进程已退出' });
          }
          pending.clear();
        });

        child.on('error', () => {
          clearTimeout(bootTimer);
          failed = true;
          proc = null;
          initPromise = null;
          resolve(false);
        });
      } catch {
        failed = true;
        initPromise = null;
        resolve(false);
      }
    });

    return initPromise;
  }

  async function request(payload, timeoutMs = 36000) {
    const ok = await ensure();
    if (!ok || !proc) return { ok: false, error: '语音进程未就绪' };
    const id = `w_${++seq}`;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        resolve({ ok: false, error: '语音合成响应超时' });
      }, timeoutMs);
      pending.set(id, { resolve, timer });
      proc.stdin.write(`${JSON.stringify({ ...payload, id })}\n`, 'utf8');
    });
  }

  function kill() {
    if (proc) {
      try {
        proc.kill();
      } catch {}
    }
  }

  return { ensure, request, kill };
}

const edgeWorker = createJsonLineWorker(EDGE_SCRIPT, 12000, true);
const qwenWorker = createJsonLineWorker(QWEN_SCRIPT, 22000, false);
const kokoroWorker = createJsonLineWorker(KOKORO_SCRIPT, 15000, false);

function stripTextForCommercialTts(raw) {
  const cleaned = String(raw || '')
    .replace(/^>.*$/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*[^*\n]{1,180}\*/g, '，')
    .replace(/[*＊]+/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[，,。！？!?.、；;：:\s—…-]+/, '')
    .trim()
    .slice(0, 360);
  if (!/[\u4e00-\u9fa5a-zA-Z0-9]/.test(cleaned)) {
    return '';
  }
  return cleaned;
}

function injectMinimaxManjuPauses(text, isMaleLead) {
  if (!isMaleLead) return text;
  return text
    .replace(/(\.{2,}|…+|——)/g, '<#0.36#>')
    .replace(/([？?！!])/g, '$1<#0.18#>');
}

function normalizeVoiceKey(v) {
  if (!v) return '';
  if (VOICE_CATALOG[v]) return v;
  if (LEGACY_VOICE_ALIAS[v]) return LEGACY_VOICE_ALIAS[v];
  return '';
}

function resolveVoiceForCompanion(companion, requestedVoice) {
  const reqNorm = normalizeVoiceKey(requestedVoice);
  if (reqNorm) return VOICE_CATALOG[reqNorm];

  const compNorm = normalizeVoiceKey(companion?.voiceId);
  if (compNorm) return VOICE_CATALOG[compNorm];

  const skin = companion?.skinKey || '';
  if (skin === 'cool_lady') return VOICE_CATALOG.otome_queen;
  if (skin === 'cute_girl') return VOICE_CATALOG.cute_sweet;
  if (skin === 'cool_dark') return VOICE_CATALOG.otome_boss;
  if (skin === 'cute_boy') return VOICE_CATALOG.otome_sunny;
  if (skin === 'cute_chibi') return VOICE_CATALOG.cute_mochi;
  if (companion?.isFemale) {
    return companion?.mode === 'cute' ? VOICE_CATALOG.cute_sweet : VOICE_CATALOG.otome_queen;
  }
  return companion?.mode === 'cute' ? VOICE_CATALOG.otome_sunny : VOICE_CATALOG.otome_cool;
}

function resolveEffectiveTtsApiKey(provider, settings = {}) {
  let apiKey = (settings.tts_api_key || '').trim();
  if (!apiKey && provider === 'siliconflow') {
    apiKey = (getEnvVal('SILICONFLOW_API_KEY') || getEnvVal('TTS_API_KEY') || process.env.SILICONFLOW_API_KEY || process.env.TTS_API_KEY || '').trim();
    if (!apiKey && (settings.deepseek_base_url || '').includes('siliconflow')) {
      apiKey = (settings.deepseek_api_key || '').trim();
    }
  }
  if (!apiKey && provider === 'minimax') {
    apiKey = (getEnvVal('MINIMAX_API_KEY') || process.env.MINIMAX_API_KEY || '').trim();
  }
  return apiKey;
}

function getDiskCachePaths(hashKey) {
  const hash = crypto.createHash('sha1').update(hashKey).digest('hex');
  return {
    binPath: path.join(CACHE_DIR, `${hash}.bin`),
    metaPath: path.join(CACHE_DIR, `${hash}.json`)
  };
}

function readDiskCache(hashKey) {
  try {
    const { binPath, metaPath } = getDiskCachePaths(hashKey);
    if (fs.existsSync(binPath) && fs.existsSync(metaPath)) {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      const buf = fs.readFileSync(binPath);
      if (buf.length > 512) {
        return {
          ok: true,
          audioBuffer: buf,
          wavBuffer: buf,
          mimeType: meta.mimeType || 'audio/wav',
          engineName: meta.engineName || 'Qwen3-TTS 1.7B 声优大模型',
          voice: meta.voice
        };
      }
    }
  } catch {}
  return null;
}

function writeDiskCache(hashKey, outObj) {
  try {
    const { binPath, metaPath } = getDiskCachePaths(hashKey);
    fs.writeFileSync(binPath, outObj.audioBuffer);
    fs.writeFileSync(
      metaPath,
      JSON.stringify({
        mimeType: outObj.mimeType,
        engineName: outObj.engineName,
        voice: outObj.voice
      }),
      'utf8'
    );
  } catch {}
}

/**
 * 上传 8~15 秒乙游 / AI 漫剧参考男音样片，一键复刻专属男主声纹（支持免密钥 Qwen3-TTS 1.7B 克隆！）
 */
async function cloneReferenceVoice({ audioDataUrl, refText, customName = 'otome-male-lead', settings = {} }) {
  const provider = settings.tts_provider || 'qwen3_otome';
  const cleanRefText = String(refText || '').trim();
  if (!audioDataUrl || !audioDataUrl.startsWith('data:audio/')) {
    throw new Error('请先选择一段有效的参考男音音频文件（.mp3 或 .wav）');
  }

  // 1. 默认免密钥 Qwen3-TTS 1.7B 零样本声纹复刻！
  if (provider === 'qwen3_otome') {
    const b64Clean = audioDataUrl.replace(/^data:audio\/[^;]+;base64,/, '');
    const rawBuf = Buffer.from(b64Clean, 'base64');
    fs.writeFileSync(CUSTOM_REF_AUDIO_PATH, rawBuf);
    return {
      ok: true,
      mode: 'qwen_local_ref',
      ref_path: CUSTOM_REF_AUDIO_PATH,
      message:
        '🎬 乙游/漫剧参考男音样片挂载成功！Qwen3-TTS 1.7B 大模型将免密钥为您实时 1:1 复刻该男主声纹（记得点保存配置生效）！'
    };
  }

  if (!cleanRefText) {
    throw new Error('请填写这段参考音频里所说的原话台词，以便精准对齐男主声纹与咬字韵律');
  }

  // 2. 硅基流动 CosyVoice2 官方声纹复刻 API
  if (provider === 'siliconflow') {
    const apiKey = resolveEffectiveTtsApiKey('siliconflow', settings);
    if (!apiKey) throw new Error('请先填入硅基流动 API Key，再点击上传复刻');
    const model = (settings.tts_model || '').trim() || 'FunAudioLLM/CosyVoice2-0.5B';
    const resp = await fetch('https://api.siliconflow.cn/v1/uploads/audio/voice', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        customName: customName.replace(/[^a-zA-Z0-9_-]/g, '') || 'otome-lead',
        audio: audioDataUrl,
        text: cleanRefText
      }),
      signal: AbortSignal.timeout(20000)
    });

    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data.uri) {
      throw new Error(data.message || `硅基流动声纹复刻返回错误 (${resp.status})`);
    }
    return {
      ok: true,
      mode: 'siliconflow_uri',
      uri: data.uri,
      message: `🎬 漫剧/乙游参考男音复刻成功！已生成专属声纹 ID：${data.uri.slice(0, 34)}…`
    };
  }

  // 3. Fish Audio 内联零样本声纹克隆
  if (provider === 'fish_audio') {
    const apiKey = resolveEffectiveTtsApiKey('fish_audio', settings);
    if (!apiKey) throw new Error('请先填入 Fish Audio API Key，再保存参考声纹');
    return {
      ok: true,
      mode: 'fish_inline_ref',
      message: '🎬 已挂载该段漫剧/乙游参考男音样片！Fish Audio 将按此声纹实时零样本克隆发声。'
    };
  }

  throw new Error('一键上传音频克隆支持默认的「Qwen3-TTS 1.7B（免密钥）」、「硅基流动 CosyVoice2」与「Fish Audio」通道');
}

/**
 * 调用 Qwen3-TTS 1.7B 乙游声优设计大模型（免密钥直连，零机械播音腔）
 */
async function callQwen3OtomeCloud({ text, voiceMeta, settings = {} }) {
  const useClone =
    voiceMeta.isMale &&
    settings.tts_ref_text !== '__cleared__' &&
    Boolean(settings.tts_ref_audio || (settings.tts_ref_text && fs.existsSync(CUSTOM_REF_AUDIO_PATH)));

  if (useClone && settings.tts_ref_audio && !fs.existsSync(CUSTOM_REF_AUDIO_PATH)) {
    try {
      const b64Clean = String(settings.tts_ref_audio).replace(/^data:audio\/[^;]+;base64,/, '');
      fs.writeFileSync(CUSTOM_REF_AUDIO_PATH, Buffer.from(b64Clean, 'base64'));
    } catch {}
  }

  const rawKey = (settings.tts_api_key || '').trim();
  const hfToken = rawKey.startsWith('hf_') ? rawKey : '';

  const workerRes = await qwenWorker.request(
    {
      mode: useClone && fs.existsSync(CUSTOM_REF_AUDIO_PATH) ? 'clone' : 'design',
      text,
      voice: voiceMeta.id,
      hf_token: hfToken,
      ref_wav_path: useClone ? CUSTOM_REF_AUDIO_PATH : '',
      ref_text: settings.tts_ref_text || ''
    },
    38000
  );

  if (!workerRes.ok || !workerRes.audio_b64) {
    return { ok: false, error: workerRes.error || 'Qwen3-TTS 公共额度已满' };
  }

  const buf = Buffer.from(workerRes.audio_b64, 'base64');
  return {
    ok: true,
    audioBuffer: buf,
    wavBuffer: buf,
    mimeType: workerRes.mime || 'audio/wav',
    engineName: useClone ? 'Qwen3-TTS 1.7B (参考声纹复刻)' : 'Qwen3-TTS 1.7B 乙游声优大模型',
    voice: voiceMeta
  };
}

/**
 * 调用付费商业 API 配音云音源（MiniMax / 硅基流动 / Fish Audio / 火山豆包 / OpenAI）
 */
async function callCommercialCloudTts({ text, voiceMeta, settings = {}, strictThrow = false }) {
  const provider = settings.tts_provider || 'qwen3_otome';
  if (provider === 'offline_kokoro' || provider === 'local_kokoro' || provider === 'qwen3_otome') {
    return null;
  }

  const isCuteFemale = !voiceMeta.isMale;
  const customVoiceOverride = isCuteFemale
    ? (settings.tts_cute_voice || '').trim()
    : (settings.tts_cool_voice || '').trim();

  const apiKey = resolveEffectiveTtsApiKey(provider, settings);
  if (!apiKey) {
    if (strictThrow) throw new Error('请先填入对应商业配音平台的密钥');
    return null;
  }

  try {
    if (provider === 'minimax') {
      let url = (settings.tts_endpoint || '').trim() || 'https://api.minimaxi.chat/v1/t2a_v2';
      const groupId = (settings.tts_group_id || '').trim();
      if (groupId && !url.includes('GroupId=')) {
        url += `${url.includes('?') ? '&' : '?'}GroupId=${encodeURIComponent(groupId)}`;
      }
      const chosenVoice = customVoiceOverride || voiceMeta.minimaxVoice || 'male-qn-badao';
      const manjuText = injectMinimaxManjuPauses(text, voiceMeta.isMale);

      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: (settings.tts_model || '').trim() || 'speech-02-hd',
          text: manjuText,
          stream: false,
          voice_setting: {
            voice_id: chosenVoice,
            speed: voiceMeta.minimaxSpeed || 0.94,
            vol: 1.0,
            pitch: voiceMeta.minimaxPitch ?? 0
          },
          audio_setting: {
            sample_rate: 32000,
            bitrate: 128000,
            format: 'mp3',
            channel: 1
          },
          output_format: 'hex'
        }),
        signal: AbortSignal.timeout(14000)
      });

      const data = await resp.json();
      if (!resp.ok || data?.base_resp?.status_code > 0 || !data?.data?.audio) {
        throw new Error(data?.base_resp?.status_msg || `MiniMax 接口返回异常 (${resp.status})`);
      }
      return {
        ok: true,
        audioBuffer: Buffer.from(data.data.audio, 'hex'),
        mimeType: 'audio/mpeg',
        engineName: 'MiniMax Speech-02-HD',
        voice: voiceMeta
      };
    }

    if (provider === 'siliconflow') {
      const url = (settings.tts_endpoint || '').trim() || 'https://api.siliconflow.cn/v1/audio/speech';
      const model = (settings.tts_model || '').trim() || 'FunAudioLLM/CosyVoice2-0.5B';

      const requestSiliconAudio = async (targetVoice, useInstructPrompt) => {
        let finalInput = text;
        if (
          useInstructPrompt &&
          !targetVoice.startsWith('speech:') &&
          model.toLowerCase().includes('cosyvoice2') &&
          !text.includes('<|endofprompt|>')
        ) {
          finalInput = `${voiceMeta.cosyPrompt}<|endofprompt|>${text}`;
        }
        return fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model,
            input: finalInput,
            voice: targetVoice,
            response_format: 'mp3',
            sample_rate: 32000,
            speed: voiceMeta.defaultSpeed || 0.95
          }),
          signal: AbortSignal.timeout(15000)
        });
      };

      let primaryVoice = customVoiceOverride;
      if (!primaryVoice) {
        primaryVoice = voiceMeta.siliconCustomUri || `${model}:${voiceMeta.siliconVoice || 'alex'}`;
      } else if (!primaryVoice.includes(':') && !primaryVoice.startsWith('speech:')) {
        primaryVoice = `${model}:${primaryVoice}`;
      }

      let resp = await requestSiliconAudio(primaryVoice, !primaryVoice.startsWith('speech:'));
      // 若其他用户使用了非本账号的 API Key 导致专属 speech: URI 无权限，自动平滑降级到官方预置音色
      if (!resp.ok && !customVoiceOverride && primaryVoice.startsWith('speech:')) {
        const fallbackSysVoice = `${model}:${voiceMeta.siliconVoice || 'alex'}`;
        resp = await requestSiliconAudio(fallbackSysVoice, true);
      }

      if (!resp.ok) {
        const errTxt = await resp.text().catch(() => '');
        throw new Error(`硅基流动语音返回错误 (${resp.status}): ${errTxt.slice(0, 120)}`);
      }
      const arrBuf = await resp.arrayBuffer();
      return {
        ok: true,
        audioBuffer: Buffer.from(arrBuf),
        mimeType: 'audio/mpeg',
        engineName: `SiliconFlow (${model.split('/').pop()})`,
        voice: voiceMeta
      };
    }

    if (provider === 'fish_audio') {
      const url = (settings.tts_endpoint || '').trim() || 'https://api.fish.audio/v1/tts';
      const modelHdr = (settings.tts_model || '').trim() || 's1';
      const payload = {
        text,
        format: 'mp3',
        prosody: { speed: voiceMeta.defaultSpeed || 0.95, volume: 0 }
      };

      if (customVoiceOverride) {
        payload.reference_id = customVoiceOverride;
      } else if (voiceMeta.isMale && settings.tts_ref_audio && settings.tts_ref_text) {
        const b64Clean = String(settings.tts_ref_audio).replace(/^data:audio\/[^;]+;base64,/, '');
        payload.references = [{ audio: b64Clean, text: String(settings.tts_ref_text).trim() }];
      }

      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          model: modelHdr
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15000)
      });

      if (!resp.ok) {
        const errTxt = await resp.text().catch(() => '');
        throw new Error(`Fish Audio 接口返回错误 (${resp.status}): ${errTxt.slice(0, 120)}`);
      }
      const arrBuf = await resp.arrayBuffer();
      return {
        ok: true,
        audioBuffer: Buffer.from(arrBuf),
        mimeType: 'audio/mpeg',
        engineName: 'Fish Audio 漫剧声优引擎',
        voice: voiceMeta
      };
    }

    if (provider === 'dashscope') {
      const url =
        (settings.tts_endpoint || '').trim() ||
        'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation';
      const model = (settings.tts_model || '').trim() || 'qwen3-tts-flash';
      const chosenVoice = customVoiceOverride || voiceMeta.dashscopeVoice || 'Moon';

      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          input: {
            text,
            voice: chosenVoice,
            language_type: 'Chinese'
          }
        }),
        signal: AbortSignal.timeout(14000)
      });

      const data = await resp.json().catch(() => ({}));
      const audioUrl = data?.output?.audio?.url;
      const audioDataB64 = data?.output?.audio?.data;
      if (!resp.ok || (!audioUrl && !audioDataB64)) {
        throw new Error(data?.message || `阿里云百炼语音返回错误 (${resp.status})`);
      }

      let finalBuf;
      let mime = 'audio/wav';
      if (audioDataB64) {
        finalBuf = Buffer.from(audioDataB64, 'base64');
      } else {
        const dl = await fetch(audioUrl, { signal: AbortSignal.timeout(10000) });
        finalBuf = Buffer.from(await dl.arrayBuffer());
        if (audioUrl.includes('.mp3')) mime = 'audio/mpeg';
      }

      return {
        ok: true,
        audioBuffer: finalBuf,
        mimeType: mime,
        engineName: `阿里云百炼 (${chosenVoice})`,
        voice: voiceMeta
      };
    }

    if (provider === 'volcengine') {
      const url = (settings.tts_endpoint || '').trim() || 'https://openspeech.bytedance.com/api/v1/tts';
      const appId = (settings.tts_group_id || '').trim();
      if (!appId) throw new Error('火山引擎豆包语音需同时填写附加编号（AppID）与密钥');
      const cluster = (settings.tts_model || '').trim() || 'volc_tts';
      const voiceType = customVoiceOverride || voiceMeta.volcVoice || 'BV107_streaming';

      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer;${apiKey}`
        },
        body: JSON.stringify({
          app: { appid: appId, token: apiKey, cluster },
          user: { uid: 'star_whisper_player' },
          audio: {
            voice_type: voiceType,
            encoding: 'mp3',
            speed_ratio: voiceMeta.defaultSpeed || 0.95
          },
          request: {
            reqid: crypto.randomUUID(),
            text,
            text_type: 'plain',
            operation: 'query'
          }
        }),
        signal: AbortSignal.timeout(14000)
      });

      const data = await resp.json();
      if (!resp.ok || !data?.data) {
        throw new Error(data?.message || `火山豆包语音返回异常 (${resp.status})`);
      }
      return {
        ok: true,
        audioBuffer: Buffer.from(data.data, 'base64'),
        mimeType: 'audio/mpeg',
        engineName: '火山豆包漫剧大模型',
        voice: voiceMeta
      };
    }

    if (provider === 'openai_tts') {
      const url = (settings.tts_endpoint || '').trim() || 'https://api.openai.com/v1/audio/speech';
      const model = (settings.tts_model || '').trim() || 'gpt-4o-mini-tts';
      const chosenVoice = customVoiceOverride || (voiceMeta.openaiVoice || 'ash').toLowerCase();

      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          input: text,
          voice: chosenVoice,
          instructions: voiceMeta.cosyPrompt,
          response_format: 'mp3'
        }),
        signal: AbortSignal.timeout(14000)
      });

      if (!resp.ok) {
        const errTxt = await resp.text().catch(() => '');
        throw new Error(`语音网关返回错误 (${resp.status}): ${errTxt.slice(0, 120)}`);
      }
      const arrBuf = await resp.arrayBuffer();
      return {
        ok: true,
        audioBuffer: Buffer.from(arrBuf),
        mimeType: 'audio/mpeg',
        engineName: `商业网关 (${model})`,
        voice: voiceMeta
      };
    }
  } catch (err) {
    if (strictThrow) throw err;
  }

  return null;
}

/**
 * 统一语音合成入口：默认优先走免密钥 Qwen3-TTS 1.7B 乙游声优大模型（持久化磁盘缓存秒回）
 */
async function synthesizeNeuralSpeech({ text, voiceId = 'otome_cool', speed, settings = {}, strictCommercial = false }) {
  const normId = normalizeVoiceKey(voiceId) || 'otome_cool';
  const meta = VOICE_CATALOG[normId] || VOICE_CATALOG.otome_cool;
  const cleanedText = stripTextForCommercialTts(text);
  if (!cleanedText) {
    return { ok: false, fallback: true, error: '无可朗读对白文本' };
  }

  // 0. 前置快速命中高保真预置音频（毛不易歌手男声 / 二次元动漫甜妹女声，0延迟零API额度消耗）
  const presetHit = findPresetAudioBuffer(cleanedText, meta.isMale);
  if (presetHit) {
    return {
      ok: true,
      audioBuffer: presetHit.audioBuffer,
      mimeType: presetHit.mimeType,
      engineName: meta.isMale ? '毛不易治愈民谣原声' : '二次元动漫甜妹声优',
      voice: meta,
      preset: true
    };
  }

  const provider = settings.tts_provider || 'edge_neural';
  const cacheKey = `v4:${provider}:${settings.tts_model || ''}:${settings.tts_cool_voice || ''}:${settings.tts_cute_voice || ''}:${settings.tts_ref_text || ''}:${meta.id}:${cleanedText}`;

  if (!strictCommercial) {
    const diskHit = readDiskCache(cacheKey);
    if (diskHit) return diskHit;
  }

  // 1. 若配置了专门的高阶商业漫剧配音 API（MiniMax海螺 / 火山豆包2.0 / Fish Audio / 阿里云百炼），优先走专属商业音源
  if (
    provider !== 'edge_neural' &&
    provider !== 'qwen3_otome' &&
    provider !== 'offline_kokoro' &&
    provider !== 'local_kokoro'
  ) {
    const cloudRes = await callCommercialCloudTts({
      text: cleanedText,
      voiceMeta: meta,
      settings,
      strictThrow: strictCommercial
    });
    if (cloudRes && cloudRes.ok && cloudRes.audioBuffer) {
      writeDiskCache(cacheKey, cloudRes);
      return cloudRes;
    }
  }

  // 2. 若显式指定了 Qwen3-TTS 1.7B 且带 HF Token
  if (provider === 'qwen3_otome') {
    const qwenRes = await callQwen3OtomeCloud({ text: cleanedText, voiceMeta: meta, settings });
    if (qwenRes && qwenRes.ok) {
      writeDiskCache(cacheKey, qwenRes);
      return qwenRes;
    }
    if (strictCommercial) {
      throw new Error(qwenRes?.error || '连接 Qwen3-TTS 声优模型超时');
    }
  }

  // 3. 默认主力音源 API：独立 Azure Edge 24kHz 超纯净无底噪神经语音云（0.35s 极速直出，零电流杂音、零吞字）
  if (provider === 'edge_neural' || !strictCommercial) {
    const edgeRes = await edgeWorker.request(
      {
        text: cleanedText,
        voice: meta.id
      },
      6500
    );
    if (edgeRes && edgeRes.ok && edgeRes.audio_b64) {
      const mp3Buf = Buffer.from(edgeRes.audio_b64, 'base64');
      const outObj = {
        ok: true,
        audioBuffer: mp3Buf,
        mimeType: 'audio/mpeg',
        engineName: 'Azure Edge 24kHz 超清声优',
        voice: meta
      };
      writeDiskCache(cacheKey, outObj);
      return outObj;
    }
  }

  // 4. 断网离线应急保底（仅在完全无法联网或显式选择离线时启用）
  const finalSpeed = speed || meta.defaultSpeed || 0.94;
  const workerResult = await kokoroWorker.request(
    {
      text: cleanedText.slice(0, 260),
      voice: meta.id,
      speed: finalSpeed
    },
    7000
  );

  if (!workerResult.ok || !workerResult.audio_b64) {
    return { ok: false, fallback: true, error: workerResult.error || '语音生成失败' };
  }

  const buf = Buffer.from(workerResult.audio_b64, 'base64');
  return {
    ok: true,
    audioBuffer: buf,
    wavBuffer: buf,
    mimeType: 'audio/wav',
    engineName: '离线应急语音',
    duration: workerResult.duration || 0,
    voice: meta
  };
}

// 启动后立即预热 Azure Edge 24kHz 超清神经语音通道（约 18MB 内存，毫秒级首包响应）
function warmupTtsEngine() {
  setTimeout(() => {
    edgeWorker.ensure().catch(() => {});
  }, 400);
}

process.on('exit', () => {
  edgeWorker.kill();
  qwenWorker.kill();
  kokoroWorker.kill();
});

module.exports = {
  VOICE_CATALOG,
  resolveVoiceForCompanion,
  cloneReferenceVoice,
  synthesizeNeuralSpeech,
  warmupTtsEngine
};

/**
 * 角色对白神经语音合成 (TTS) & 零样本声纹克隆引擎
 * 内置：录音棚近讲声学滤波链 (Proximity Effect EQ) + 10 档漫剧/乙游声线秒切 + 参考男音样片一键复刻
 */
(() => {
  // 彻底连根清除所有旧版语音通话残留节点（防浏览器缓存）
  try {
    const purge = () => {
      document.querySelectorAll('.comp-voice-wrap, .comp-voice-dock, .comp-voice-floating-dock, #comp-voice-open-btn, #comp-voice-dock, #more-voice-call-btn, #topbar-voice-call-btn').forEach(el => el.remove());
    };
    purge();
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', purge);
    }
  } catch {}

  // 角色声线矩阵与播控初始化

  // 国乙六大男主「一人一专属 CV 声纹」 & 二次元女主声线矩阵
  const VOICE_ORDER = [
    {
      id: 'otome_boss',
      style: 'cool',
      isMale: true,
      bassDb: 4.5,
      short: '🖤 暗夜低音霸总',
      btnHint: '🎙️ 陆沉系低音炮',
      sample: '这么晚还没睡？把手伸过来……在我的视线里，不用勉强自己。'
    },
    {
      id: 'otome_gentle',
      style: 'cool',
      isMale: true,
      bassDb: 2.8,
      short: '✨ 毛不易民谣男神',
      btnHint: '🎙️ 毛不易治愈男音',
      sample: '外头起风了，先把我的外袍披好……别在窗口站太久，过来坐会儿吧。'
    },
    {
      id: 'otome_cool',
      style: 'cool',
      isMale: true,
      bassDb: 3.4,
      short: '❄️ 清冷叙事公子',
      btnHint: '🎙️ 清冷叙事男音',
      sample: '夜深露重……手怎么这么凉？坐到火盆旁来，别总不让人省心。'
    },
    {
      id: 'otome_fox',
      style: 'cool',
      isMale: true,
      bassDb: 3.2,
      short: '🪭 漫剧腹黑公子',
      btnHint: '🎙️ 风流微撩男音',
      sample: '小没良心的，来茶楼听戏也不叫上本侯……嗯？'
    },
    {
      id: 'otome_daddy',
      style: 'cool',
      isMale: true,
      bassDb: 4.0,
      short: '🥂 京圈矜贵家主',
      btnHint: '🎙️ 沉稳绅士男音',
      sample: '外头起风了，我让司机绕去南城买了你念叨的板栗酥，过来趁热吃两块。'
    },
    {
      id: 'otome_sunny',
      style: 'cute',
      isMale: true,
      bassDb: 2.0,
      short: '🐾 阳光电竞少年',
      btnHint: '🎙️ 阳光少年男音',
      sample: '手腕一点都不疼啦！只要姐姐在台下看着我，我就能一直赢下去！'
    },
    {
      id: 'otome_queen',
      style: 'cool',
      isMale: false,
      bassDb: 1.2,
      short: '👠 高冷清艳御姐',
      btnHint: '🎙️ 高冷御姐女音',
      sample: '外头风这么大还跑过来……手伸出来，坐到我身边暖一暖。'
    },
    {
      id: 'otome_sister',
      style: 'cool',
      isMale: false,
      bassDb: 0.9,
      short: '🌙 清冷仙侠师姐',
      btnHint: '🎙️ 清冷师姐女音',
      sample: '山门风雪凉，站到我剑气屏障里来，有师姐护着你。'
    },
    {
      id: 'cute_sweet',
      style: 'cute',
      isMale: false,
      bassDb: 0.6,
      short: '🍓 二次元元气甜妹',
      btnHint: '🎙️ 二次元甜妹女音',
      sample: '前辈前辈！刚买的热草莓牛乳给你留着第一口呢，今天也要超开心哦！'
    },
    {
      id: 'cute_mochi',
      style: 'cute',
      isMale: false,
      bassDb: 0.5,
      short: '🌸 二次元软萌团子',
      btnHint: '🎙️ 二次元软萌萌妹',
      sample: '锵锵！软乎乎的小团子正在旁边陪着你哦，今天也要超开心呀！'
    }
  ];

  const LEGACY_MAP = {
    zm_yunxi: 'otome_cool',
    zm_yunjian: 'otome_boss',
    zm_yunxia: 'otome_sunny',
    zf_xiaoyi: 'cute_sweet'
  };

  let currentVoiceId = 'otome_gentle';
  let isCallOpen = false;
  let isBusy = false;
  let audioCtx = null;
  let activeSource = null;
  let activeFallbackBtn = null;
  let rafMeterId = 0;
  let ttsFetchAbort = null;
  let isSynthesizing = false;
  let synthStartedAt = 0;
  let activeObjectUrl = '';

  // 客户端音频内存 LRU 热缓存（同一句对白同一声线二次点击 0ms 秒播，零网络请求）
  const TTS_CLIENT_CACHE_MAX = 30;
  const TTS_CLIENT_CACHE_MAX_BYTES = 12 * 1024 * 1024;
  const clientTtsAudioCache = new Map();
  let clientTtsCacheBytes = 0;
  const inFlightTtsFetches = new Map();

  function getClientTtsCache(key) {
    const hit = clientTtsAudioCache.get(key);
    if (!hit) return null;
    clientTtsAudioCache.delete(key);
    clientTtsAudioCache.set(key, hit);
    return hit;
  }

  function setClientTtsCache(key, buffer, mimeType) {
    if (!key || !buffer || buffer.byteLength <= 512 || buffer.byteLength > 4 * 1024 * 1024) return;
    const prev = clientTtsAudioCache.get(key);
    if (prev) {
      clientTtsCacheBytes = Math.max(0, clientTtsCacheBytes - prev.size);
      clientTtsAudioCache.delete(key);
    }
    while (
      clientTtsAudioCache.size >= TTS_CLIENT_CACHE_MAX ||
      (clientTtsCacheBytes + buffer.byteLength > TTS_CLIENT_CACHE_MAX_BYTES && clientTtsAudioCache.size > 0)
    ) {
      const oldestKey = clientTtsAudioCache.keys().next().value;
      if (oldestKey === undefined) break;
      const oldest = clientTtsAudioCache.get(oldestKey);
      clientTtsAudioCache.delete(oldestKey);
      if (oldest) clientTtsCacheBytes = Math.max(0, clientTtsCacheBytes - oldest.size);
    }
    clientTtsAudioCache.set(key, {
      buffer,
      mimeType: mimeType || 'audio/mpeg',
      size: buffer.byteLength
    });
    clientTtsCacheBytes += buffer.byteLength;
  }

  function getCurrentSpeakerLabel() {
    const raw =
      document.getElementById('topbar-name')?.textContent?.trim() ||
      document.querySelector('.persona-item.active .persona-name')?.textContent?.trim() ||
      '';
    const shortName = raw.split(/[·\s]/)[0].trim();
    return shortName || '角色语音';
  }

  function showDynamicIslandTts(labelText, synthesizing = false) {
    const island = document.getElementById('dynamic-island-tts');
    const lblEl = document.getElementById('island-tts-label');
    if (!island) return;
    if (lblEl) {
      lblEl.textContent = labelText || `${getCurrentSpeakerLabel()} · 正在朗读`;
    }
    island.classList.toggle('is-synthesizing', Boolean(synthesizing));
    island.classList.add('is-active');
    island.setAttribute('aria-hidden', 'false');
  }

  function hideDynamicIslandTts() {
    const island = document.getElementById('dynamic-island-tts');
    if (!island) return;
    island.classList.remove('is-active', 'is-synthesizing');
    island.setAttribute('aria-hidden', 'true');
  }

  document.getElementById('island-tts-stop-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    stopCurrentAudio();
  });

  function notifyUserVoiceStatus(msg) {
    if (typeof window.__showAppToast === 'function') {
      window.__showAppToast(msg);
      return;
    }
    const toastEl = document.getElementById('memory-toast');
    if (toastEl) {
      toastEl.textContent = msg;
      toastEl.classList.remove('hidden');
      clearTimeout(window.__voiceToastTimer);
      window.__voiceToastTimer = setTimeout(() => {
        toastEl.classList.add('hidden');
      }, 2500);
    }
  }

  // 挂载真实 HTMLAudioElement 供跨浏览器播放、移动端兼容与无障碍/自动化状态感知
  let ttsAudioEl = document.getElementById('companion-tts-audio');
  if (!ttsAudioEl) {
    ttsAudioEl = document.createElement('audio');
    ttsAudioEl.id = 'companion-tts-audio';
    ttsAudioEl.preload = 'none';
    ttsAudioEl.setAttribute('aria-hidden', 'true');
    ttsAudioEl.style.display = 'none';
    document.body.appendChild(ttsAudioEl);
  }

  // 聚焦于高质量对白朗读与音色克隆
  window.toggleCompanionVoiceCall = () => {};
  const safeElement = {
    classList: {
      add: () => {},
      remove: () => {},
      toggle: () => {},
      contains: () => false
    },
    textContent: '',
    style: {},
    addEventListener: () => {}
  };
  const waveBars = safeElement;
  const switchVoiceBtn = safeElement;
  const openLabel = safeElement;
  const openBtn = safeElement;
  const dockEl = safeElement;

  function getVoiceMeta(vid) {
    const mapped = LEGACY_MAP[vid] || vid;
    return VOICE_ORDER.find((v) => v.id === mapped) || VOICE_ORDER[1];
  }

  let currentIsFemale = false;

  function syncVoiceUiFromCompanion(comp) {
    if (comp) {
      currentIsFemale = Boolean(
        comp.isFemale || comp.skinKey === 'cool_lady' || comp.skinKey === 'cute_girl'
      );
      const mapped = LEGACY_MAP[comp.voiceId] || comp.voiceId;
      if (mapped && VOICE_ORDER.some((v) => v.id === mapped)) {
        currentVoiceId = mapped;
      } else if (comp.skinKey === 'cool_lady') {
        currentVoiceId = 'otome_queen';
      } else if (comp.skinKey === 'cute_girl') {
        currentVoiceId = 'cute_sweet';
      } else if (comp.skinKey === 'cool_dark') {
        currentVoiceId = 'otome_boss';
      } else if (comp.skinKey === 'cute_boy') {
        currentVoiceId = 'otome_sunny';
      } else if (comp.skinKey === 'cute_chibi') {
        currentVoiceId = 'cute_mochi';
      } else if (currentIsFemale) {
        currentVoiceId = comp.mode === 'cute' ? 'cute_sweet' : 'otome_queen';
      } else {
        currentVoiceId = comp.mode === 'cute' ? 'otome_sunny' : 'otome_gentle';
      }
    }
    const meta = getVoiceMeta(currentVoiceId);
    if (switchVoiceBtn) switchVoiceBtn.textContent = `${meta.short}`;
  }

  window.addEventListener('companion-updated', (e) => {
    syncVoiceUiFromCompanion(e.detail);
  });

  function resetActiveButtonUi(btn) {
    if (!btn) return;
    btn.classList.remove('speaking', 'synthesizing');
    btn.removeAttribute('aria-busy');
    btn.setAttribute('aria-pressed', 'false');
    if (btn.dataset.origHtml !== undefined) {
      btn.innerHTML = btn.dataset.origHtml;
    } else if (btn.dataset.origLabel) {
      btn.textContent = btn.dataset.origLabel;
    }
  }

  function markButtonSpeakingUi(btn) {
    if (!btn) return;
    if (btn.dataset.origHtml === undefined) btn.dataset.origHtml = btn.innerHTML;
    if (!btn.dataset.origLabel) btn.dataset.origLabel = btn.textContent;
    btn.classList.remove('synthesizing');
    btn.classList.add('speaking');
    btn.removeAttribute('aria-busy');
    btn.setAttribute('aria-pressed', 'true');
    btn.textContent = btn.classList.contains('cloud-tts-btn') ? '⏹' : '正在朗读';
  }

  function stopCurrentAudio() {
    cancelAnimationFrame(rafMeterId);
    window.__companionAudioLevel = 0;
    isSynthesizing = false;
    if (waveBars) waveBars.classList.remove('active');
    hideDynamicIslandTts();

    if (ttsFetchAbort) {
      try {
        ttsFetchAbort.abort();
      } catch {}
      ttsFetchAbort = null;
    }
    if (ttsAudioEl) {
      try {
        ttsAudioEl.pause();
        ttsAudioEl.removeAttribute('src');
        ttsAudioEl.load();
      } catch {}
    }
    if (activeObjectUrl) {
      try {
        URL.revokeObjectURL(activeObjectUrl);
      } catch {}
      activeObjectUrl = '';
    }
    if (activeSource) {
      try {
        activeSource.stop();
      } catch {}
      activeSource = null;
    }
    if ('speechSynthesis' in window && (window.speechSynthesis.speaking || window.speechSynthesis.pending)) {
      window.speechSynthesis.cancel();
    }
    if (activeFallbackBtn) {
      resetActiveButtonUi(activeFallbackBtn);
      activeFallbackBtn = null;
    }
  }

  function ensureAudioContext() {
    if (!audioCtx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) audioCtx = new Ctx();
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
    return audioCtx;
  }

  function cleanSpeakableDialogue(rawText) {
    const cleaned = String(rawText || '')
      .replace(/^>.*$/gm, '')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*[^*\n]{1,180}\*/g, '，')
      .replace(/[*＊]+/g, '')
      .replace(/\s+/g, ' ')
      .replace(/^[，,。！？!?.、；;：:\s—…-]+/, '')
      .trim();
    if (!/[\u4e00-\u9fa5a-zA-Z0-9]/.test(cleaned)) {
      return '';
    }
    return cleaned;
  }

  function playBrowserSpeechFallback(rawText, voiceMeta, btnEl) {
    const cleaned = cleanSpeakableDialogue(rawText);
    if (!cleaned) {
      resetActiveButtonUi(btnEl);
      if (activeFallbackBtn === btnEl) activeFallbackBtn = null;
      notifyUserVoiceStatus('💡 该条消息仅含动作神态描写，暂无对白台词可朗读');
      return;
    }
    if (!('speechSynthesis' in window)) {
      resetActiveButtonUi(btnEl);
      if (activeFallbackBtn === btnEl) activeFallbackBtn = null;
      notifyUserVoiceStatus('⚠️ 当前浏览器不支持本地语音朗读，请稍后重试');
      return;
    }

    const utter = new SpeechSynthesisUtterance(cleaned);
    utter.lang = 'zh-CN';
    utter.rate = voiceMeta?.isMale ? 0.94 : 1.05;
    utter.pitch = voiceMeta?.id === 'otome_boss' ? 0.76 : voiceMeta?.isMale ? 0.86 : 1.18;

    const voices = window.speechSynthesis.getVoices();
    const match = voiceMeta?.isMale
      ? voices.find((v) => v.lang.includes('zh') && /Yunxi|Yunjian|Yunyang|Kangkang|Male/i.test(v.name))
      : voices.find((v) => v.lang.includes('zh') && /Xiaoyi|Xiaoxiao/i.test(v.name));
    const fallbackZh = voices.find((v) => v.lang.includes('zh'));
    if (match || fallbackZh) utter.voice = match || fallbackZh;

    markButtonSpeakingUi(btnEl);
    waveBars?.classList.add('active');
    showDynamicIslandTts(`${getCurrentSpeakerLabel()} · 正在朗读`, false);

    utter.onend = () => {
      waveBars?.classList.remove('active');
      hideDynamicIslandTts();
      resetActiveButtonUi(btnEl);
      if (activeFallbackBtn === btnEl) activeFallbackBtn = null;
    };
    utter.onerror = () => {
      waveBars?.classList.remove('active');
      hideDynamicIslandTts();
      resetActiveButtonUi(btnEl);
      if (activeFallbackBtn === btnEl) activeFallbackBtn = null;
      notifyUserVoiceStatus('⚠️ 系统语音引擎暂未响应，请检查浏览器音量或语音包设置');
    };
    window.speechSynthesis.speak(utter);
  }

  /**
   * 优先通过真实 <audio> 元素播放云端神经声优音频，兼顾全平台可听性与音频状态可观测性
   */
  async function playAudioBufferWithStudioEq(arrayBuffer, voiceMeta, btnEl, mimeType = 'audio/mpeg') {
    const blob = new Blob([arrayBuffer], { type: mimeType || 'audio/mpeg' });
    if (activeObjectUrl) {
      try {
        URL.revokeObjectURL(activeObjectUrl);
      } catch {}
    }
    activeObjectUrl = URL.createObjectURL(blob);
    ttsAudioEl.src = activeObjectUrl;
    ttsAudioEl.muted = false;
    ttsAudioEl.volume = 1.0;

    markButtonSpeakingUi(btnEl);
    waveBars?.classList.add('active');

    let pulsePhase = 0;
    function animatePulseLevel() {
      if (ttsAudioEl.paused || ttsAudioEl.ended) return;
      pulsePhase += 0.24;
      window.__companionAudioLevel = 0.35 + Math.abs(Math.sin(pulsePhase)) * 0.55;
      rafMeterId = requestAnimationFrame(animatePulseLevel);
    }

    ttsAudioEl.onended = () => {
      cancelAnimationFrame(rafMeterId);
      window.__companionAudioLevel = 0;
      waveBars?.classList.remove('active');
      hideDynamicIslandTts();
      resetActiveButtonUi(btnEl);
      if (activeFallbackBtn === btnEl) activeFallbackBtn = null;
    };

    ttsAudioEl.onerror = () => {
      cancelAnimationFrame(rafMeterId);
      window.__companionAudioLevel = 0;
      waveBars?.classList.remove('active');
      hideDynamicIslandTts();
      resetActiveButtonUi(btnEl);
      if (activeFallbackBtn === btnEl) activeFallbackBtn = null;
    };

    try {
      await ttsAudioEl.play();
      animatePulseLevel();
      showDynamicIslandTts(`${getCurrentSpeakerLabel()} · 正在朗读`, false);
      return;
    } catch {
      // 若受浏览器策略限制回退 WebAudio 解码播放
    }

    const ctx = ensureAudioContext();
    if (!ctx) return;
    try {
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);
      activeSource = source;
      source.onended = () => {
        if (activeSource === source) {
          activeSource = null;
          window.__companionAudioLevel = 0;
          waveBars?.classList.remove('active');
          hideDynamicIslandTts();
        }
        resetActiveButtonUi(btnEl);
        if (activeFallbackBtn === btnEl) activeFallbackBtn = null;
      };
      source.start(0);
      showDynamicIslandTts(`${getCurrentSpeakerLabel()} · 正在朗读`, false);
    } catch (decodeErr) {
      console.warn('WebAudio fallback error:', decodeErr);
    }
  }

  function base64ToArrayBuffer(b64) {
    const bin = atob(b64);
    const len = bin.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = bin.charCodeAt(i);
    }
    return bytes.buffer;
  }

  // 前端高频静态预置音频快速映射表（毛不易民谣男声 / 二次元动漫甜妹女声）
  const PRESET_FRONTEND_RULES = [
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

  function getPresetAudioUrl(text, isFemale = false) {
    if (!text) return null;
    const str = String(text).trim();
    for (const rule of PRESET_FRONTEND_RULES) {
      if (rule.patterns.some((re) => re.test(str))) {
        const file = isFemale ? rule.femaleFile : rule.maleFile;
        return `./assets/pre_voices/${file}`;
      }
    }
    return null;
  }

  async function playAudioUrlWithStudioEq(audioUrl, voiceMeta, btnEl) {
    if (activeObjectUrl) {
      try {
        URL.revokeObjectURL(activeObjectUrl);
      } catch {}
      activeObjectUrl = '';
    }
    ttsAudioEl.src = audioUrl;
    ttsAudioEl.muted = false;
    ttsAudioEl.volume = 1.0;

    markButtonSpeakingUi(btnEl);
    activeFallbackBtn = btnEl;
    waveBars?.classList.add('active');

    let pulsePhase = 0;
    function animatePulseLevel() {
      if (ttsAudioEl.paused || ttsAudioEl.ended) return;
      pulsePhase += 0.24;
      window.__companionAudioLevel = 0.35 + Math.abs(Math.sin(pulsePhase)) * 0.55;
      rafMeterId = requestAnimationFrame(animatePulseLevel);
    }

    ttsAudioEl.onended = () => {
      cancelAnimationFrame(rafMeterId);
      window.__companionAudioLevel = 0;
      waveBars?.classList.remove('active');
      hideDynamicIslandTts();
      resetActiveButtonUi(btnEl);
      if (activeFallbackBtn === btnEl) activeFallbackBtn = null;
    };

    ttsAudioEl.onerror = () => {
      cancelAnimationFrame(rafMeterId);
      window.__companionAudioLevel = 0;
      waveBars?.classList.remove('active');
      hideDynamicIslandTts();
      resetActiveButtonUi(btnEl);
      if (activeFallbackBtn === btnEl) activeFallbackBtn = null;
    };

    try {
      await ttsAudioEl.play();
      animatePulseLevel();
      showDynamicIslandTts(`${getCurrentSpeakerLabel()} · 正在朗读`, false);
      return true;
    } catch {
      try {
        const resp = await fetch(audioUrl);
        if (resp.ok) {
          const ab = await resp.arrayBuffer();
          await playAudioBufferWithStudioEq(ab, voiceMeta, btnEl, 'audio/mpeg');
          return true;
        }
      } catch {}
    }
    return false;
  }

  window.playCompanionNeuralTts = async function playCompanionNeuralTts(rawText, btnEl) {
    if (btnEl && activeFallbackBtn === btnEl) {
      if (isSynthesizing && Date.now() - synthStartedAt < 1500) {
        showDynamicIslandTts('正在合成专属声线…', true);
        return;
      }
      stopCurrentAudio();
      ensureAudioContext();
      if (ttsAudioEl) {
        try {
          ttsAudioEl.muted = false;
          ttsAudioEl.volume = 1.0;
        } catch {}
      }
      return;
    }
    stopCurrentAudio();
    ensureAudioContext();
    if (ttsAudioEl) {
      try {
        ttsAudioEl.muted = false;
        ttsAudioEl.volume = 1.0;
      } catch {}
    }

    const cleaned = cleanSpeakableDialogue(rawText);
    if (!cleaned) {
      notifyUserVoiceStatus('💡 该条消息主要是动作神态描写，暂无对白台词可朗读');
      return;
    }

    const meta = getVoiceMeta(currentVoiceId);
    const isFemale = Boolean(currentIsFemale || !meta.isMale);

    // 0. 前端优先秒播离线预制高清音频（毛不易歌手男声 / 二次元动漫甜妹女声，0延迟零API等待）
    const presetUrl = getPresetAudioUrl(cleaned, isFemale);
    if (presetUrl) {
      const ok = await playAudioUrlWithStudioEq(presetUrl, meta, btnEl);
      if (ok) return;
    }

    // 0.5 命中客户端 LRU 音频内存缓存：0ms 秒播
    const ttsCacheKey = `${currentVoiceId}::${cleaned}`;
    const cachedAudio = getClientTtsCache(ttsCacheKey);
    if (cachedAudio) {
      await playAudioBufferWithStudioEq(cachedAudio.buffer, meta, btnEl, cachedAudio.mimeType);
      return;
    }

    isSynthesizing = true;
    synthStartedAt = Date.now();
    const myAbort = new AbortController();
    ttsFetchAbort = myAbort;

    if (btnEl) {
      if (btnEl.dataset.origHtml === undefined) btnEl.dataset.origHtml = btnEl.innerHTML;
      if (!btnEl.dataset.origLabel) btnEl.dataset.origLabel = btnEl.textContent;
      btnEl.classList.add('synthesizing');
      btnEl.setAttribute('aria-busy', 'true');
      btnEl.innerHTML = btnEl.classList.contains('cloud-tts-btn')
        ? '<span class="tts-synth-dots" aria-hidden="true"><span></span><span></span><span></span></span>'
        : '<span class="tts-synth-dots" aria-hidden="true"><span></span><span></span><span></span></span><span class="tts-synth-label">合成中</span>';
      activeFallbackBtn = btnEl;
    }
    showDynamicIslandTts(`${getCurrentSpeakerLabel()} · 合成声线中`, true);

    try {
      let fetchTask = inFlightTtsFetches.get(ttsCacheKey);
      if (!fetchTask) {
        fetchTask = fetch('/api/tts/speak', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: cleaned,
            voiceId: currentVoiceId,
            sessionId: window.__activeSessionId || ''
          }),
          signal: myAbort.signal
        })
          .then(async (resp) => {
            const ctype = resp.headers.get('content-type') || '';
            if (resp.ok && ctype.includes('audio/')) {
              const buf = await resp.arrayBuffer();
              setClientTtsCache(ttsCacheKey, buf, ctype);
              return { ok: true, buf, ctype };
            }
            return { ok: false };
          })
          .finally(() => {
            inFlightTtsFetches.delete(ttsCacheKey);
          });
        inFlightTtsFetches.set(ttsCacheKey, fetchTask);
      }

      const result = await fetchTask;
      if (myAbort.signal.aborted) return;
      isSynthesizing = false;
      if (result && result.ok && result.buf) {
        await playAudioBufferWithStudioEq(result.buf, meta, btnEl, result.ctype);
        return;
      }
    } catch (err) {
      if (myAbort.signal.aborted || err?.name === 'AbortError') return;
    } finally {
      if (ttsFetchAbort === myAbort) {
        isSynthesizing = false;
        ttsFetchAbort = null;
      }
    }

    playBrowserSpeechFallback(cleaned, meta, btnEl);
  };

  function updateCloudBubble(_tag, _text) {}

  const ttsGearBtn = document.getElementById('cv-open-tts-cfg-btn');
  function syncAdminGearVisibility() {
    if (!ttsGearBtn) return;
    // 普通小白玩家零配置隐藏音源齿轮，仅站长管理时按需展示
    ttsGearBtn.classList.toggle('hidden', !window.__isAdminUser);
  }
  syncAdminGearVisibility();
  window.addEventListener('user-role-changed', syncAdminGearVisibility);

  ttsGearBtn?.addEventListener('click', () => {
    if (typeof window.__openCommercialTtsSettings === 'function') {
      window.__openCommercialTtsSettings();
    }
  });

  // 按角色性别智能轮换专属声线（女主优先轮换御姐/甜妹/团子，男主优先轮换四大乙游男音）
  switchVoiceBtn?.addEventListener('click', async () => {
    const pool = currentIsFemale
      ? VOICE_ORDER.filter((v) => !v.isMale)
      : VOICE_ORDER.filter((v) => v.isMale || v.id === 'cute_mochi');
    const activePool = pool.length > 0 ? pool : VOICE_ORDER;
    const idx = activePool.findIndex((v) => v.id === currentVoiceId);
    const nextMeta = activePool[(idx + 1) % activePool.length];
    currentVoiceId = nextMeta.id;
    if (openLabel) openLabel.textContent = nextMeta.btnHint;
    if (switchVoiceBtn) switchVoiceBtn.textContent = `${nextMeta.short} ▾`;

    const sid = window.__activeSessionId;
    if (sid) {
      fetch(`/api/sessions/${encodeURIComponent(sid)}/companion`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voiceId: currentVoiceId })
      }).catch(() => {});
    }

    updateCloudBubble(`🎙️ ${nextMeta.short}`, nextMeta.sample);
    window.playCompanionNeuralTts(nextMeta.sample, null);
  });

  // 站长后台专属：商业音源一键试听
  async function runCommercialTtsPreview(style, btnEl, draftOverride = null, resultBoxOverride = null) {
    if (!btnEl) return;
    const origHtml = btnEl.innerHTML;
    btnEl.disabled = true;
    btnEl.innerHTML = '<span class="tts-synth-dots" aria-hidden="true"><span></span><span></span><span></span></span><span class="tts-synth-label">正在合成试听…</span>';
    const resultBox = resultBoxOverride || document.getElementById('adm-gateway-result-box') || document.getElementById('test-result-box');
    if (resultBox) resultBox.classList.add('hidden');

    try {
      ensureAudioContext();
      stopCurrentAudio();
    ensureAudioContext();
    if (ttsAudioEl) {
      try {
        ttsAudioEl.muted = false;
        ttsAudioEl.volume = 1.0;
      } catch {}
    }
      const draftSettings =
        draftOverride ||
        (typeof window.__collectSettingsDraft === 'function' ? window.__collectSettingsDraft() : {});

      const resp = await fetch('/api/tts/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ style, settings: draftSettings })
      });
      const data = await resp.json();
      if (!resp.ok || !data.ok) {
        throw new Error(data.error || '商业音源连接失败');
      }
      if (resultBox) {
        resultBox.className = 'test-result-box ok';
        resultBox.textContent = data.message;
        resultBox.classList.remove('hidden');
      }
      if (data.audio_b64) {
        const buf = base64ToArrayBuffer(data.audio_b64);
        const previewMeta = style === 'cute' ? VOICE_ORDER[3] : VOICE_ORDER[0];
        await playAudioBufferWithStudioEq(buf, previewMeta, null);
      }
    } catch (err) {
      if (resultBox) {
        resultBox.className = 'test-result-box err';
        resultBox.textContent = `❌ ${err.message}`;
        resultBox.classList.remove('hidden');
      }
    } finally {
      btnEl.disabled = false;
      btnEl.innerHTML = origHtml;
    }
  }
  window.__runAdminTtsPreview = runCommercialTtsPreview;

  document.getElementById('test-tts-cool-btn')?.addEventListener('click', (e) => {
    runCommercialTtsPreview('cool', e.currentTarget);
  });
  document.getElementById('test-tts-cute-btn')?.addEventListener('click', (e) => {
    runCommercialTtsPreview('cute', e.currentTarget);
  });

  // 一键播放预录制的 Qwen3-TTS 1.7B 国乙男主贴耳气声真实样音（0% 人机味参照）
  document.getElementById('play-otome-demo-sample-btn')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const orig = btn.textContent;
    btn.disabled = true;
    btn.textContent = '🎧 正在播放国乙男主贴耳真声…';
    const resultBox = document.getElementById('test-result-box');
    try {
      ensureAudioContext();
      stopCurrentAudio();
    ensureAudioContext();
    if (ttsAudioEl) {
      try {
        ttsAudioEl.muted = false;
        ttsAudioEl.volume = 1.0;
      } catch {}
    }
      const resp = await fetch('./assets/voice_demos/otome_male_demo.wav');
      const buf = await resp.arrayBuffer();
      if (resultBox) {
        resultBox.className = 'test-result-box ok';
        resultBox.textContent =
          '🎧 正在播放 Qwen3-TTS 1.7B 真实生成的乙游男主贴耳气声样音（台词：“听你声音就知道勉强自己了。过来靠着我歇会儿，不用硬撑。”）——绑定任意免费密钥后全站即为此品质！';
        resultBox.classList.remove('hidden');
      }
      updateCloudBubble('🎧 乙游男主真声样片', '听你声音就知道勉强自己了。过来靠着我歇会儿，不用硬撑。');
      await playAudioBufferWithStudioEq(buf, VOICE_ORDER[1], null);
    } catch {} finally {
      btn.disabled = false;
      btn.textContent = orig;
    }
  });

  // 设置弹窗内：上传 8~15 秒乙游 / AI 漫剧参考男音样片一键复刻
  let stagedCloneDataUrl = '';
  const cloneFileInput = document.getElementById('st-clone-audio-file');
  const pickCloneBtn = document.getElementById('st-pick-clone-file-btn');
  const cloneStatusEl = document.getElementById('st-clone-file-status');
  const cloneRefTextInput = document.getElementById('st-clone-ref-text');
  const runCloneBtn = document.getElementById('st-run-clone-btn');

  pickCloneBtn?.addEventListener('click', () => cloneFileInput?.click());
  cloneFileInput?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 5.5 * 1024 * 1024) {
      if (cloneStatusEl) cloneStatusEl.textContent = '⚠️ 请选择小于 5.5MB（约 8~20 秒）的清晰男音样片';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      stagedCloneDataUrl = String(reader.result || '');
      if (cloneStatusEl) cloneStatusEl.textContent = `✅ 已载入参考样片：${file.name}（请填写原话后点击右侧复刻）`;
    };
    reader.readAsDataURL(file);
  });

  runCloneBtn?.addEventListener('click', async () => {
    const resultBox = document.getElementById('test-result-box');
    if (!stagedCloneDataUrl) {
      if (resultBox) {
        resultBox.className = 'test-result-box err';
        resultBox.textContent = '❌ 请先点击「📂 选择 8~15秒男音样片」上传一段乙游或漫剧男主干音';
        resultBox.classList.remove('hidden');
      }
      return;
    }
    const refText = cloneRefTextInput?.value.trim() || '';
    const origHtml = runCloneBtn.innerHTML;
    runCloneBtn.disabled = true;
    runCloneBtn.innerHTML = '<span class="tts-synth-dots" aria-hidden="true"><span></span><span></span><span></span></span><span class="tts-synth-label">正在复刻声纹…</span>';

    try {
      const draftSettings =
        typeof window.__collectSettingsDraft === 'function' ? window.__collectSettingsDraft() : {};
      const resp = await fetch('/api/tts/clone-voice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audio_data_url: stagedCloneDataUrl,
          ref_text: refText,
          custom_name: 'otome-male-lead',
          settings: draftSettings
        })
      });
      const data = await resp.json();
      if (!resp.ok || !data.ok) {
        throw new Error(data.error || '声纹复刻失败');
      }
      if (data.uri) {
        const coolVoiceInput = document.getElementById('st-tts-cool-voice');
        if (coolVoiceInput) coolVoiceInput.value = data.uri;
      }
      if (resultBox) {
        resultBox.className = 'test-result-box ok';
        resultBox.textContent = data.message;
        resultBox.classList.remove('hidden');
      }
    } catch (err) {
      if (resultBox) {
        resultBox.className = 'test-result-box err';
        resultBox.textContent = `❌ ${err.message}`;
        resultBox.classList.remove('hidden');
      }
    } finally {
      runCloneBtn.disabled = false;
      runCloneBtn.innerHTML = origHtml;
    }
  });
})();

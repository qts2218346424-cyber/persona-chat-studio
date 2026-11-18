/**
 * 2.5D 立绘乙游四大男主 & AI 漫剧爆款声线双向语音引擎
 * 内置：录音棚近讲声学滤波链 (Proximity Effect EQ) + 5 档漫剧/乙游声线秒切 + 参考男音样片一键复刻
 */
(() => {
  const stageEl = document.getElementById('companion-stage');
  const pokeArea = document.getElementById('companion-poke-area');
  const cloudEl = document.getElementById('companion-cloud');
  const cloudTag = document.getElementById('comp-cloud-tag');
  const cloudText = document.getElementById('comp-cloud-text');
  const footEl = stageEl?.querySelector('.companion-foot');

  if (!stageEl || !pokeArea) return;

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
      short: '✨ 乙游温柔骑士',
      btnHint: '🎙️ 温柔星光男音',
      sample: '星光有点凉，先把我的外袍披好，不管多久我都会在这里守着你。'
    },
    {
      id: 'otome_cool',
      style: 'cool',
      isMale: true,
      bassDb: 3.4,
      short: '❄️ 乙游清冷剑尊',
      btnHint: '🎙️ 清冷禁欲男音',
      sample: '夜深露重……手怎么这么凉？伸过来，我替你捂着。'
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
      short: '🍓 甜美元气学妹',
      btnHint: '🎙️ 元气甜妹女音',
      sample: '前辈前辈！刚买的热草莓牛乳给你留着第一口呢，今天也要超开心哦！'
    },
    {
      id: 'cute_mochi',
      style: 'cute',
      isMale: false,
      bassDb: 0.5,
      short: '🌸 软萌糯米团子',
      btnHint: '🎙️ 软萌团子语音',
      sample: '锵锵！软乎乎的小团子正在旁边陪着你哦，今天也要超开心呀！'
    }
  ];

  const LEGACY_MAP = {
    zm_yunxi: 'otome_cool',
    zm_yunjian: 'otome_boss',
    zm_yunxia: 'otome_sunny',
    zf_xiaoyi: 'cute_mochi'
  };

  let currentVoiceId = 'otome_cool';
  let isCallOpen = false;
  let isBusy = false;
  let audioCtx = null;
  let activeSource = null;
  let activeFallbackBtn = null;
  let rafMeterId = 0;

  const voiceWrap = document.createElement('div');
  voiceWrap.className = 'comp-voice-wrap';
  voiceWrap.innerHTML = `
    <button type="button" class="comp-voice-call-pill" id="comp-voice-open-btn" title="开启与当前角色的实时真声语音通话">
      <span class="voice-dot-live" aria-hidden="true"></span>
      <span id="comp-voice-open-label">🎙️ 语音通话</span>
    </button>

    <div class="comp-voice-dock hidden" id="comp-voice-dock" role="region" aria-label="角色实时语音通话">
      <div class="cv-top-row">
        <span class="cv-live-title" id="cv-live-title">🎧 实时语音通话中</span>
        <button type="button" class="cv-voice-switch hidden" id="cv-voice-switch-btn">
          专属声线
        </button>
        <span class="cv-wave-bars" id="cv-wave-bars" aria-hidden="true">
          <i></i><i></i><i></i><i></i>
        </span>
        <div class="cv-right-icons">
          <button type="button" class="cv-gear-btn hidden" id="cv-open-tts-cfg-btn">
            🎚️音源
          </button>
          <button type="button" class="cv-close-btn" id="cv-close-btn" title="挂断语音通话" aria-label="挂断语音通话">✕</button>
        </div>
      </div>
      <form class="cv-input-row" id="cv-voice-form">
        <button type="button" class="cv-mic-btn" id="cv-mic-btn" title="点击麦克风直接说话" aria-label="麦克风语音输入">
          🎙️
        </button>
        <label for="cv-quick-input" class="visually-hidden">向角色说一句话</label>
        <input
          type="text"
          id="cv-quick-input"
          class="cv-quick-input"
          placeholder="点🎙️说话，或打字回车…"
          autocomplete="off"
        />
      </form>
    </div>
  `;

  if (footEl) {
    stageEl.insertBefore(voiceWrap, footEl);
  } else {
    stageEl.appendChild(voiceWrap);
  }

  const openBtn = document.getElementById('comp-voice-open-btn');
  const openLabel = document.getElementById('comp-voice-open-label');
  const dockEl = document.getElementById('comp-voice-dock');
  const switchVoiceBtn = document.getElementById('cv-voice-switch-btn');
  const waveBars = document.getElementById('cv-wave-bars');
  const closeBtn = document.getElementById('cv-close-btn');
  const voiceForm = document.getElementById('cv-voice-form');
  const micBtn = document.getElementById('cv-mic-btn');
  const quickInput = document.getElementById('cv-quick-input');

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
        currentVoiceId = comp.mode === 'cute' ? 'otome_sunny' : 'otome_cool';
      }
    }
    const meta = getVoiceMeta(currentVoiceId);
    openLabel.textContent = '🎙️ 语音通话';
    switchVoiceBtn.textContent = `${meta.short}`;
  }

  window.addEventListener('companion-updated', (e) => {
    syncVoiceUiFromCompanion(e.detail);
  });

  function stopCurrentAudio() {
    cancelAnimationFrame(rafMeterId);
    window.__companionAudioLevel = 0;
    pokeArea.classList.remove('speaking-glow');
    waveBars.classList.remove('active');

    if (activeSource) {
      try {
        activeSource.stop();
      } catch {}
      activeSource = null;
    }
    if ('speechSynthesis' in window && window.speechSynthesis.speaking) {
      window.speechSynthesis.cancel();
    }
    if (activeFallbackBtn) {
      activeFallbackBtn.classList.remove('speaking');
      if (activeFallbackBtn.dataset.origLabel) {
        activeFallbackBtn.textContent = activeFallbackBtn.dataset.origLabel;
      }
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

  function playBrowserSpeechFallback(rawText, voiceMeta, btnEl) {
    if (!('speechSynthesis' in window)) return;
    const cleaned = String(rawText || '')
      .replace(/^>.*$/gm, '')
      .replace(/\*[^*]+\*/g, '，')
      .trim();
    if (!cleaned) return;

    const utter = new SpeechSynthesisUtterance(cleaned);
    utter.lang = 'zh-CN';
    utter.rate = voiceMeta?.isMale ? 0.92 : 1.06;
    utter.pitch = voiceMeta?.id === 'otome_boss' ? 0.72 : voiceMeta?.isMale ? 0.84 : 1.22;

    const voices = window.speechSynthesis.getVoices();
    const match = voiceMeta?.isMale
      ? voices.find((v) => v.lang.includes('zh') && /Yunxi|Yunjian|Yunyang|Kangkang|Male/i.test(v.name))
      : voices.find((v) => v.lang.includes('zh') && /Xiaoyi|Xiaoxiao/i.test(v.name));
    const fallbackZh = voices.find((v) => v.lang.includes('zh'));
    if (match || fallbackZh) utter.voice = match || fallbackZh;

    pokeArea.classList.add('speaking-glow');
    waveBars.classList.add('active');

    utter.onend = () => {
      pokeArea.classList.remove('speaking-glow');
      waveBars.classList.remove('active');
      if (btnEl) {
        btnEl.classList.remove('speaking');
        if (btnEl.dataset.origLabel) btnEl.textContent = btnEl.dataset.origLabel;
      }
      if (activeFallbackBtn === btnEl) activeFallbackBtn = null;
    };
    utter.onerror = utter.onend;
    window.speechSynthesis.speak(utter);
  }

  /**
   * 串联录音棚「乙游贴耳近讲声学滤波链 (Studio Proximity Effect EQ)」并实时驱动立绘共振
   */
  async function playAudioBufferWithStudioEq(arrayBuffer, voiceMeta, btnEl) {
    const ctx = ensureAudioContext();
    if (!ctx) return;

    const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;

    // 保持 Qwen3-TTS 1.7B 母带级清透呼吸气声，仅施加极轻柔的 140Hz 近讲温暖度润色
    const lowShelf = ctx.createBiquadFilter();
    lowShelf.type = 'lowshelf';
    lowShelf.frequency.value = 140;
    lowShelf.gain.value = voiceMeta?.isMale ? 1.6 : 0.4;

    const airShelf = ctx.createBiquadFilter();
    airShelf.type = 'highshelf';
    airShelf.frequency.value = 7200;
    airShelf.gain.value = 0.8;

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    const dataArray = new Uint8Array(analyser.frequencyBinCount);

    source.connect(lowShelf);
    lowShelf.connect(airShelf);
    airShelf.connect(analyser);
    analyser.connect(ctx.destination);

    activeSource = source;
    pokeArea.classList.add('speaking-glow');
    waveBars.classList.add('active');

    function updateLevel() {
      if (activeSource !== source) return;
      analyser.getByteTimeDomainData(dataArray);
      let sumSq = 0;
      for (let i = 0; i < dataArray.length; i++) {
        const norm = (dataArray[i] - 128) / 128;
        sumSq += norm * norm;
      }
      const rms = Math.sqrt(sumSq / dataArray.length);
      window.__companionAudioLevel = Math.min(1, rms * 4.2);
      rafMeterId = requestAnimationFrame(updateLevel);
    }

    source.onended = () => {
      if (activeSource === source) {
        activeSource = null;
        cancelAnimationFrame(rafMeterId);
        window.__companionAudioLevel = 0;
        pokeArea.classList.remove('speaking-glow');
        waveBars.classList.remove('active');
      }
      if (btnEl) {
        btnEl.classList.remove('speaking');
        if (btnEl.dataset.origLabel) btnEl.textContent = btnEl.dataset.origLabel;
      }
      if (activeFallbackBtn === btnEl) activeFallbackBtn = null;
    };

    source.start(0);
    updateLevel();
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

  window.playCompanionNeuralTts = async function playCompanionNeuralTts(rawText, btnEl) {
    if (btnEl && activeFallbackBtn === btnEl) {
      stopCurrentAudio();
      return;
    }
    stopCurrentAudio();

    const cleaned = String(rawText || '')
      .replace(/^>.*$/gm, '')
      .replace(/\*[^*]+\*/g, '，')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .trim();
    if (!cleaned) return;

    if (btnEl) {
      if (!btnEl.dataset.origLabel) btnEl.dataset.origLabel = btnEl.textContent;
      btnEl.classList.add('speaking');
      btnEl.textContent = btnEl.classList.contains('cloud-tts-btn') ? '⏹' : '⏹ 停止';
      activeFallbackBtn = btnEl;
    }

    const meta = getVoiceMeta(currentVoiceId);
    try {
      const resp = await fetch('/api/tts/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: cleaned,
          voiceId: currentVoiceId,
          sessionId: window.__activeSessionId || ''
        })
      });

      const ctype = resp.headers.get('content-type') || '';
      if (resp.ok && ctype.includes('audio/')) {
        const buf = await resp.arrayBuffer();
        await playAudioBufferWithStudioEq(buf, meta, btnEl);
        return;
      }
    } catch {}

    playBrowserSpeechFallback(cleaned, meta, btnEl);
  };

  function updateCloudBubble(tag, text) {
    if (!cloudEl || !cloudText) return;
    if (cloudTag && tag) cloudTag.textContent = tag;
    cloudText.textContent = text;
    cloudEl.classList.remove('cloud-pop');
    void cloudEl.offsetWidth;
    cloudEl.classList.add('cloud-pop');
  }

  async function sendVoiceTurn(spokenText) {
    const sid = window.__activeSessionId;
    if (!sid) {
      updateCloudBubble('💡 请先选定角色', '请先在左侧点选一位角色进入对话，就能直接语音通话啦！');
      return;
    }
    if (isBusy) {
      updateCloudBubble('🎧 正在回应中', '上一句话正在录制真声回应，请稍等一秒哦～');
      return;
    }

    isBusy = true;
    stopCurrentAudio();
    ensureAudioContext();

    const meta = getVoiceMeta(currentVoiceId);
    quickInput.disabled = true;
    const prevPlaceholder = quickInput.placeholder;
    quickInput.placeholder = '🎧 正在录制声优真声…';
    updateCloudBubble(
      `🎧 ${meta.short} · 真声回应中`,
      spokenText ? `听到你说：「${spokenText.slice(0, 36)}」… 正在贴近耳畔回应你` : '正在轻声开口向你打招呼…'
    );

    try {
      const resp = await fetch(`/api/sessions/${encodeURIComponent(sid)}/companion/voice-chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: spokenText || '',
          voiceId: currentVoiceId
        })
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || '语音回应失败');

      if (data.companion) {
        syncVoiceUiFromCompanion(data.companion);
      }
      const isFallbackLocal = data.tts_engine === '离线应急语音' || data.fallback_tts;
      const bubbleTag = isFallbackLocal
        ? '⚠️ 离线基础音 · 点「🎚️音源」绑免费Key切真声'
        : `✨ ${data.tag || meta.short}`;
      updateCloudBubble(bubbleTag, data.reply_text);

      if (data.audio_b64) {
        const buf = base64ToArrayBuffer(data.audio_b64);
        await playAudioBufferWithStudioEq(buf, meta, null);
      } else {
        playBrowserSpeechFallback(data.reply_text, meta, null);
      }
    } catch {
      updateCloudBubble('✨ 轻声回应', '我一直在这儿听着呢……再靠近一点同我说，嗯？');
    } finally {
      isBusy = false;
      quickInput.disabled = false;
      quickInput.placeholder = prevPlaceholder;
      if (isCallOpen) quickInput.focus();
    }
  }

  openBtn.addEventListener('click', () => {
    isCallOpen = true;
    ensureAudioContext();
    openBtn.classList.add('hidden');
    dockEl.classList.remove('hidden');
    stageEl.classList.add('voice-call-active');
    quickInput.focus();
    sendVoiceTurn('');
  });

  closeBtn.addEventListener('click', () => {
    isCallOpen = false;
    stopCurrentAudio();
    stopMicRecognition();
    dockEl.classList.add('hidden');
    openBtn.classList.remove('hidden');
    stageEl.classList.remove('voice-call-active');
  });

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
  switchVoiceBtn.addEventListener('click', async () => {
    const pool = currentIsFemale
      ? VOICE_ORDER.filter((v) => !v.isMale)
      : VOICE_ORDER.filter((v) => v.isMale || v.id === 'cute_mochi');
    const activePool = pool.length > 0 ? pool : VOICE_ORDER;
    const idx = activePool.findIndex((v) => v.id === currentVoiceId);
    const nextMeta = activePool[(idx + 1) % activePool.length];
    currentVoiceId = nextMeta.id;
    openLabel.textContent = nextMeta.btnHint;
    switchVoiceBtn.textContent = `${nextMeta.short} ▾`;

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
    const origTxt = btnEl.textContent;
    btnEl.disabled = true;
    btnEl.textContent = '⏳ 正在合成试听…';
    const resultBox = resultBoxOverride || document.getElementById('adm-gateway-result-box') || document.getElementById('test-result-box');
    if (resultBox) resultBox.classList.add('hidden');

    try {
      ensureAudioContext();
      stopCurrentAudio();
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
      btnEl.textContent = origTxt;
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
    const origLabel = runCloneBtn.textContent;
    runCloneBtn.disabled = true;
    runCloneBtn.textContent = '⏳ 正在复刻声纹…';

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
      runCloneBtn.textContent = origLabel;
    }
  });

  // 中文输入法安全回车提交
  let lastCompEnd = null;
  quickInput.addEventListener('compositionend', (e) => {
    lastCompEnd = e.timeStamp;
  });
  quickInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      if (e.isComposing || e.keyCode === 229) {
        e.preventDefault();
        return;
      }
      if (lastCompEnd !== null && Math.abs(e.timeStamp - lastCompEnd) < 50) {
        e.preventDefault();
        return;
      }
    }
  });

  voiceForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const val = quickInput.value.trim();
    if (!val || isBusy) return;
    quickInput.value = '';
    sendVoiceTurn(val);
  });

  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognition = null;
  let mediaRecorder = null;
  let mediaChunks = [];
  let activeMicStream = null;
  let isListening = false;

  function stopMicStreamTracks() {
    if (activeMicStream) {
      activeMicStream.getTracks().forEach((t) => {
        try {
          t.stop();
        } catch {}
      });
      activeMicStream = null;
    }
  }

  function stopMicRecognition() {
    isListening = false;
    micBtn.classList.remove('recording');
    if (recognition) {
      try {
        recognition.stop();
      } catch {}
      recognition = null;
    }
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      try {
        mediaRecorder.stop();
      } catch {}
    }
  }

  async function startCloudAsrRecording() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      quickInput.placeholder = '当前环境未开放麦克风权限，可直接打字回车对话…';
      quickInput.focus();
      return;
    }
    try {
      stopCurrentAudio();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      activeMicStream = stream;
      mediaChunks = [];
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';
      mediaRecorder = new MediaRecorder(stream, { mimeType });
      isListening = true;
      micBtn.classList.add('recording');
      quickInput.placeholder = '🎙️ 正在录音（再点🎙️结束并识别）…';

      mediaRecorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) mediaChunks.push(ev.data);
      };

      mediaRecorder.onstop = async () => {
        stopMicStreamTracks();
        isListening = false;
        micBtn.classList.remove('recording');
        if (!mediaChunks.length) {
          quickInput.placeholder = '点🎙️开口说，或打字回车…';
          return;
        }
        quickInput.placeholder = '⏳ Qwen3-ASR 正在识别语音…';
        try {
          const blob = new Blob(mediaChunks, { type: mimeType });
          const dataUrl = await new Promise((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => resolve(String(r.result || ''));
            r.onerror = reject;
            r.readAsDataURL(blob);
          });
          const resp = await fetch('/api/asr/transcribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ audio_data_url: dataUrl })
          });
          const data = await resp.json();
          quickInput.placeholder = '点🎙️开口说，或打字回车…';
          if (resp.ok && data.text) {
            sendVoiceTurn(data.text);
          } else {
            quickInput.placeholder = data.error || '请绑定硅基流动Key启用云端识别，或直接打字回车…';
          }
        } catch {
          quickInput.placeholder = '语音识别未就绪，可直接打字回车…';
        }
      };

      mediaRecorder.start();
      // 最长自动录 15 秒防忘关
      setTimeout(() => {
        if (mediaRecorder && mediaRecorder.state === 'recording') {
          stopMicRecognition();
        }
      }, 15000);
    } catch {
      stopMicStreamTracks();
      isListening = false;
      micBtn.classList.remove('recording');
      quickInput.placeholder = '麦克风未授权，可直接打字回车对话…';
    }
  }

  micBtn.addEventListener('click', () => {
    if (isListening) {
      stopMicRecognition();
      return;
    }

    // 若已配置硅基流动内置/个人 API，或浏览器不支持原生识别，优先走高精度 Qwen3-ASR-1.7B 云端识别
    if (!SpeechRec || window.__preferCloudAsr) {
      startCloudAsrRecording();
      return;
    }

    stopCurrentAudio();
    recognition = new SpeechRec();
    recognition.lang = 'zh-CN';
    recognition.interimResults = true;
    recognition.continuous = false;

    isListening = true;
    micBtn.classList.add('recording');
    quickInput.placeholder = '正在听你说话…';

    let finalTranscript = '';

    recognition.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const txt = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += txt;
        } else {
          interim += txt;
        }
      }
      quickInput.value = finalTranscript || interim;
    };

    recognition.onend = () => {
      const spoken = (finalTranscript || quickInput.value || '').trim();
      isListening = false;
      micBtn.classList.remove('recording');
      quickInput.placeholder = '点🎙️开口说，或打字回车…';
      if (spoken) {
        quickInput.value = '';
        sendVoiceTurn(spoken);
      }
    };

    recognition.onerror = (ev) => {
      isListening = false;
      micBtn.classList.remove('recording');
      // 国内网络下 Chrome WebSpeech 若遇 network 错误，自动标记切换至 Qwen3-ASR-1.7B 云端识别
      if (ev && ev.error === 'network') {
        window.__preferCloudAsr = true;
        startCloudAsrRecording();
        return;
      }
      quickInput.placeholder = '未听到声音，可重试🎙️或直接打字回车…';
    };

    try {
      recognition.start();
    } catch {
      stopMicRecognition();
      startCloudAsrRecording();
    }
  });
})();

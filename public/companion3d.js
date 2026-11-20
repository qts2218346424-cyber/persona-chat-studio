/**
 * 2.5D 破框立体陪伴渲染引擎（Live2D 风格骨骼微切片变形 + 3D 全息透视视差 + 阻尼弹簧触碰物理）
 */
(() => {
  const stageEl = document.getElementById('companion-stage');
  const appShell = document.getElementById('app-shell');
  const pokeArea = document.getElementById('companion-poke-area');
  const sourceImg = document.getElementById('companion-img');
  if (!pokeArea || !sourceImg) return;

  // 构建四层三维立体全息舞台 DOM（保留原有粒子与提示节点）
  const particlesEl = document.getElementById('comp-particles');
  const pokeHintEl = pokeArea.querySelector('.comp-poke-hint');

  const rig = document.createElement('div');
  rig.className = 'holo-3d-rig';
  rig.innerHTML = `
    <div class="holo-back-glow" aria-hidden="true"></div>
    <div class="holo-back-motes" id="holo-back-motes" aria-hidden="true"></div>
    <div class="holo-light-cone" aria-hidden="true"></div>
    <div class="holo-pedestal-3d" aria-hidden="true">
      <div class="pedestal-shadow"></div>
      <div class="pedestal-ring-outer"></div>
      <div class="pedestal-ring-inner"></div>
    </div>
    <canvas id="companion-live-canvas" class="companion-live-canvas" width="492" height="624"></canvas>
    <div class="holo-front-layer" id="holo-front-layer" aria-hidden="true"></div>
  `;

  pokeArea.appendChild(rig);
  if (particlesEl) rig.appendChild(particlesEl);
  if (pokeHintEl) rig.appendChild(pokeHintEl);

  const canvas = document.getElementById('companion-live-canvas');
  const backMotes = document.getElementById('holo-back-motes');
  const frontLayer = document.getElementById('holo-front-layer');
  const pedestalShadowEl = rig.querySelector('.pedestal-shadow');
  const ctx = canvas.getContext('2d');

  // 生成后景 (Z=-18px) 与前景 (Z=+48px) 双层升腾光粒，通过与人物的前后遮挡关系强化立体空间纵深
  const moteSpecs = [
    { layer: backMotes, left: '24%', dur: '4.8s', delay: '0s', drift: '-16px', front: false },
    { layer: backMotes, left: '52%', dur: '5.4s', delay: '1.6s', drift: '12px', front: false },
    { layer: backMotes, left: '74%', dur: '4.4s', delay: '2.9s', drift: '18px', front: false },
    { layer: frontLayer, left: '30%', dur: '5.1s', delay: '0.8s', drift: '-12px', front: true },
    { layer: frontLayer, left: '68%', dur: '4.6s', delay: '2.3s', drift: '15px', front: true },
  ];
  for (const ms of moteSpecs) {
    if (!ms.layer) continue;
    const m = document.createElement('span');
    m.className = ms.front ? 'holo-mote front-mote' : 'holo-mote';
    m.style.left = ms.left;
    m.style.setProperty('--mote-dur', ms.dur);
    m.style.setProperty('--mote-delay', ms.delay);
    m.style.setProperty('--mote-drift', ms.drift);
    ms.layer.appendChild(m);
  }

  // 调度、可见性与矩形缓存状态（彻底避免隐身态后台空跑 rAF 与指针回流）
  let rafId = 0;
  let isRunning = false;
  let isContentSkipped = false;
  let isIntersecting = true;
  let cachedRect = null;
  let lastTiltStr = '';
  let lastShadowStr = '';
  let viewportCenterX = Math.max(260, window.innerWidth * 0.45);
  let viewportCenterY = Math.max(260, window.innerHeight * 0.45);

  function refreshCachedRect() {
    const r = pokeArea.getBoundingClientRect();
    cachedRect = r.width >= 20 && r.height >= 20 ? r : null;
    viewportCenterX = Math.max(260, window.innerWidth * 0.45);
    viewportCenterY = Math.max(260, window.innerHeight * 0.45);
    return cachedRect;
  }

  // 自适应容器尺寸与高分屏 DPR 同步，确保任意屏幕尺寸下清晰锐利且不挤压气泡
  function syncCanvasResolution() {
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 20 || rect.height < 20) return;
    const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    const targetW = Math.round(rect.width * dpr);
    const targetH = Math.round(rect.height * dpr);
    if (Math.abs(canvas.width - targetW) > 2 || Math.abs(canvas.height - targetH) > 2) {
      canvas.width = targetW;
      canvas.height = targetH;
    }
  }

  // 状态与物理变量
  let offscreenSource = null;
  let loadedUrl = '';
  let pointerTargetX = 0; // -1 ~ 1
  let pointerTargetY = 0; // -1 ~ 1
  let smoothX = 0;
  let smoothY = 0;
  let isTypingFocus = false;

  // 戳一戳阻尼弹簧状态
  let springDispX = 0;
  let springVelX = 0;
  let springSquash = 0;
  let springVelSquash = 0;

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  function isStageVisible() {
    if (document.hidden || isContentSkipped || !isIntersecting) return false;
    if (stageEl && stageEl.classList.contains('hidden')) return false;
    if (appShell) {
      if (appShell.classList.contains('hidden')) return false;
      if (appShell.dataset.uiMode && appShell.dataset.uiMode !== 'roleplay') return false;
    }
    const r = refreshCachedRect();
    return Boolean(r && r.width >= 20 && r.height >= 20);
  }

  function normalizeCutoutSrc(rawSrc) {
    if (!rawSrc) return './assets/companions/cool_silver_cutout.png';
    const relSrc = String(rawSrc).replace(/^\/assets\//, './assets/');
    // 自动将旧版矩形 .jpg 路径无缝映射至高精度透明抠图 _cutout.png
    return relSrc.replace(
      /(?:\.?\/)?assets\/companions\/(cool_silver|cool_dark|cool_lady|cute_boy|cute_girl|cute_chibi)\.jpg$/i,
      './assets/companions/$1_cutout.png'
    );
  }

  /**
   * 为玩家自定义上传的普通图片执行轻量四角浅底透明化与底部全息柔化，避免出现生硬方框
   */
  function buildProcessedCanvas(img, isCustomUpload) {
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    const off = document.createElement('canvas');
    off.width = w;
    off.height = h;
    const octx = off.getContext('2d');
    octx.drawImage(img, 0, 0);

    if (!isCustomUpload) return off;

    try {
      const imgData = octx.getImageData(0, 0, w, h);
      const d = imgData.data;
      // 取左上角像素作为背景参考色
      const br = d[0];
      const bg = d[1];
      const bb = d[2];
      const ba = d[3];
      const isLightSolidCorner = ba > 240 && br > 225 && bg > 218 && bb > 222;

      for (let y = 0; y < h; y++) {
        const ny = y / h;
        const bottomFade = ny > 0.86 ? Math.max(0, (0.995 - ny) / 0.135) : 1.0;
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          let a = d[i + 3];
          if (isLightSolidCorner) {
            const dist = Math.hypot(d[i] - br, d[i + 1] - bg, d[i + 2] - bb);
            const edgeDistX = Math.min(x / w, (w - x) / w);
            if (dist < 22 && (edgeDistX < 0.16 || ny < 0.12)) {
              a = Math.min(a, Math.max(0, ((dist - 8) / 14) * 255));
            }
          }
          d[i + 3] = Math.round(a * bottomFade);
        }
      }
      octx.putImageData(imgData, 0, 0);
    } catch {}
    return off;
  }

  function loadCharacterTexture(rawSrc) {
    const targetSrc = normalizeCutoutSrc(rawSrc);
    if (targetSrc === loadedUrl && offscreenSource) return;
    loadedUrl = targetSrc;

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const isCustom = targetSrc.startsWith('data:image/');
      offscreenSource = buildProcessedCanvas(img, isCustom);
      if (isStageVisible()) {
        syncCanvasResolution();
        if (!isRunning) {
          renderFrame(performance.now(), true);
        }
      }
    };
    img.src = targetSrc;
  }

  // 监听 #companion-img 属性变化，实时切换 2.5D 角色纹理
  const observer = new MutationObserver(() => {
    loadCharacterTexture(sourceImg.getAttribute('src') || sourceImg.src);
  });
  observer.observe(sourceImg, { attributes: true, attributeFilter: ['src'] });
  loadCharacterTexture(sourceImg.getAttribute('src') || sourceImg.src);

  // 全局光标视线追踪（纯缓存矩形运算，零同步回流读取）
  window.addEventListener(
    'pointermove',
    (e) => {
      if (!isRunning || !cachedRect || cachedRect.width === 0) return;
      const cx = cachedRect.left + cachedRect.width * 0.5;
      const cy = cachedRect.top + cachedRect.height * 0.36;
      const dx = (e.clientX - cx) / viewportCenterX;
      const dy = (e.clientY - cy) / viewportCenterY;
      pointerTargetX = Math.max(-1, Math.min(1, dx));
      pointerTargetY = Math.max(-1, Math.min(1, dy));
    },
    { passive: true }
  );

  const chatInput = document.getElementById('chat-input');
  if (chatInput) {
    chatInput.addEventListener('focus', () => {
      isTypingFocus = true;
    });
    chatInput.addEventListener('blur', () => {
      isTypingFocus = false;
    });
  }

  // 戳一戳阻尼弹簧冲量与 3D 漂浮心形爆发特效
  pokeArea.addEventListener('click', (e) => {
    springVelX += (Math.random() > 0.5 ? 1 : -1) * 18;
    springVelSquash = -0.085;

    const rect = refreshCachedRect() || pokeArea.getBoundingClientRect();
    const localX = e.clientX - rect.left;
    const localY = e.clientY - rect.top;
    const symbols = ['💗', '✦', '💕', '✧'];

    for (let i = 0; i < 4; i++) {
      const sp = document.createElement('span');
      sp.className = 'poke-burst-heart';
      sp.textContent = symbols[i % symbols.length];
      sp.style.left = `${localX + (i - 1.5) * 12}px`;
      sp.style.top = `${localY - 6}px`;
      sp.style.setProperty('--drift-x', `${(Math.random() - 0.5) * 44}px`);
      frontLayer.appendChild(sp);
      setTimeout(() => sp.remove(), 980);
    }

    if (prefersReducedMotion.matches && isStageVisible()) {
      renderFrame(performance.now(), true);
    }
  });

  // 60FPS Live2D 风格水平微切片骨骼变形渲染循环（28 切片兼顾丝滑变形与 GPU 吞吐）
  const SLICES = 28;
  let lastTime = performance.now();

  function renderFrame(now, singleShot = false) {
    if (!singleShot && !isRunning) return;

    const dt = Math.min(0.05, Math.max(0.001, (now - lastTime) / 1000));
    lastTime = now;

    const t = now * 0.001;
    const isSpeaking = pokeArea.classList.contains('speaking-glow');

    // 若玩家正在输入框打字，视线温柔微向输入框左下方倾注
    const goalX = isTypingFocus ? -0.45 : pointerTargetX;
    const goalY = isTypingFocus ? 0.35 : pointerTargetY;

    smoothX += (goalX - smoothX) * Math.min(1, dt * 6.5);
    smoothY += (goalY - smoothY) * Math.min(1, dt * 6.5);

    // 阻尼胡克弹簧积分
    const stiffness = 175;
    const damping = 11.5;
    springVelX += (-stiffness * springDispX - damping * springVelX) * dt;
    springDispX += springVelX * dt;

    springVelSquash += (-190 * springSquash - 12 * springVelSquash) * dt;
    springSquash += springVelSquash * dt;

    // 驱动三维舞台整体立体透视侧转与底座合成层影移（仅当变化时写入）
    if (!prefersReducedMotion.matches) {
      const tiltY = smoothX * 9.5 + springDispX * 0.35;
      const tiltX = -smoothY * 5.2;
      const tiltStr = `rotateY(${tiltY.toFixed(2)}deg) rotateX(${tiltX.toFixed(2)}deg)`;
      if (tiltStr !== lastTiltStr) {
        rig.style.transform = tiltStr;
        lastTiltStr = tiltStr;
      }
      if (pedestalShadowEl) {
        const sdx = (-smoothX * 8).toFixed(1);
        const sdy = (-smoothY * 4).toFixed(1);
        const shadowStr = `translate3d(${sdx}px, ${sdy}px, -14px)`;
        if (shadowStr !== lastShadowStr) {
          pedestalShadowEl.style.transform = shadowStr;
          lastShadowStr = shadowStr;
        }
      }
    } else if (lastTiltStr !== '') {
      rig.style.transform = '';
      lastTiltStr = '';
      if (pedestalShadowEl && lastShadowStr !== '') {
        pedestalShadowEl.style.transform = '';
        lastShadowStr = '';
      }
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (offscreenSource) {
      const cw = canvas.width;
      const ch = canvas.height;
      const sw = offscreenSource.width;
      const sh = offscreenSource.height;

      // 计算自适应居中比例（留出呼吸与摇摆边距）
      const scale = Math.min((cw * 0.92) / sw, (ch * 0.94) / sh);
      const baseDrawW = sw * scale;
      const baseDrawH = sh * scale;
      const originX = (cw - baseDrawW) * 0.5;
      const originY = ch - baseDrawH - 6;

      // 呼吸与真实语音声波振幅 (AnalyserNode) 共振曲线
      const voiceAmp = prefersReducedMotion.matches ? 0 : Math.min(1, Number(window.__companionAudioLevel || 0));
      const activeTalking = isSpeaking || voiceAmp > 0.03;
      const breathFreq = activeTalking ? 3.2 : 1.65;
      const breathWave = prefersReducedMotion.matches ? 0 : Math.sin(t * breathFreq);
      const talkPulse =
        voiceAmp > 0.02
          ? voiceAmp * 0.022
          : isSpeaking && !prefersReducedMotion.matches
          ? Math.sin(t * 9.5) * 0.009
          : 0;

      const srcSliceH = sh / SLICES;
      const dstSliceH = baseDrawH / SLICES;

      for (let i = 0; i < SLICES; i++) {
        const v = i / SLICES; // 0 = 头顶, 1 = 底部衣摆

        // 1. 头部与上半身跟随鼠标产生 2.5D 立体偏转视差（越靠上偏转越明显，底部锚定在星盘底座）
        const upperWeight = Math.pow(1 - v, 1.45);
        const headTurnOffset = smoothX * 11.5 * upperWeight;
        const idleSway = prefersReducedMotion.matches
          ? 0
          : Math.sin(t * 1.15 + v * 1.2) * 2.6 * upperWeight;

        // 2. 胸肩立体呼吸横向扩展 & 说话时脸颊下颌微律动（v = 0.18 ~ 0.30 为口颌区域）
        const chestBell = Math.exp(-Math.pow((v - 0.5) / 0.22, 2));
        const jawBell = Math.exp(-Math.pow((v - 0.24) / 0.075, 2));
        const breathScaleX =
          1 +
          (breathWave * 0.015 + talkPulse) * chestBell +
          voiceAmp * 0.014 * jawBell +
          springSquash * (1 - v * 0.5);
        const breathLiftY =
          -breathWave * 3.8 * Math.pow(1 - v, 1.1) +
          voiceAmp * 3.6 * jawBell +
          springSquash * 18 * (1 - v);

        // 3. 披肩与下摆微风轻拂流体波（集中在下半部 v > 0.48）
        const clothWeight = Math.max(0, (v - 0.45) / 0.55);
        const breezeWave = prefersReducedMotion.matches
          ? 0
          : Math.sin(t * 2.3 - v * 5.2) * 3.4 * clothWeight * clothWeight;

        // 4. 戳一戳弹簧果冻摇摆
        const pokeOffset = springDispX * Math.sin((1 - v) * Math.PI * 0.85);

        const sliceW = baseDrawW * breathScaleX;
        const dx = originX + (baseDrawW - sliceW) * 0.5 + headTurnOffset + idleSway + breezeWave + pokeOffset;
        const dy = originY + i * dstSliceH + breathLiftY + smoothY * 4.5 * upperWeight;

        // 多绘制 0.9px 重叠以彻底消除切片采样细缝
        ctx.drawImage(
          offscreenSource,
          0,
          i * srcSliceH,
          sw,
          Math.min(sh - i * srcSliceH, srcSliceH + 0.8),
          dx,
          dy,
          sliceW,
          dstSliceH + 0.9
        );
      }
    }

    if (!singleShot && isRunning) {
      rafId = requestAnimationFrame(renderFrame);
    }
  }

  function stopEngine() {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    isRunning = false;
    if (stageEl) stageEl.classList.add('holo-paused');
  }

  function syncEngineLifecycle() {
    const visible = isStageVisible();
    if (!visible) {
      stopEngine();
      return;
    }

    if (stageEl) stageEl.classList.remove('holo-paused');
    syncCanvasResolution();

    const hasSpringMotion =
      Math.abs(springDispX) > 0.05 ||
      Math.abs(springVelX) > 0.05 ||
      Math.abs(springSquash) > 0.002 ||
      Math.abs(springVelSquash) > 0.002;

    if (prefersReducedMotion.matches && !hasSpringMotion) {
      stopEngine();
      if (stageEl) stageEl.classList.remove('holo-paused');
      lastTime = performance.now();
      renderFrame(lastTime, true);
      return;
    }

    if (!isRunning) {
      isRunning = true;
      lastTime = performance.now();
      rafId = requestAnimationFrame(renderFrame);
    }
  }

  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => {
      refreshCachedRect();
      syncCanvasResolution();
      syncEngineLifecycle();
    }).observe(pokeArea);
  }
  window.addEventListener(
    'resize',
    () => {
      refreshCachedRect();
      syncCanvasResolution();
      syncEngineLifecycle();
    },
    { passive: true }
  );

  // 1. 遵循 efficient-background-processing 优先使用 contentvisibilityautostatechange
  if (stageEl) {
    stageEl.addEventListener('contentvisibilityautostatechange', (e) => {
      isContentSkipped = Boolean(e.skipped);
      syncEngineLifecycle();
    });
  }

  // 2. 不支持 content-visibility 的浏览器使用 IntersectionObserver 回退
  if (!('contentVisibility' in document.documentElement.style) && typeof IntersectionObserver !== 'undefined') {
    const visObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          isIntersecting = entry.isIntersecting;
        }
        syncEngineLifecycle();
      },
      { rootMargin: '200px' }
    );
    visObserver.observe(stageEl || pokeArea);
  }

  // 3. 页面切入后台自动暂停
  document.addEventListener('visibilitychange', syncEngineLifecycle);

  // 4. 监听舞台显隐与工作台模式切换（DeepSeek / 手机辅助模式下彻底休眠）
  if (stageEl) {
    new MutationObserver(syncEngineLifecycle).observe(stageEl, {
      attributes: true,
      attributeFilter: ['class', 'style']
    });
  }
  if (appShell) {
    new MutationObserver(syncEngineLifecycle).observe(appShell, {
      attributes: true,
      attributeFilter: ['class', 'data-ui-mode']
    });
  }

  // 5. 监听系统减弱动效偏好切换
  if (typeof prefersReducedMotion.addEventListener === 'function') {
    prefersReducedMotion.addEventListener('change', syncEngineLifecycle);
  }

  syncEngineLifecycle();
})();

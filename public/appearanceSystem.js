(function () {
  'use strict';

  const SKIN_STORAGE_KEY = 'xingyu_skin_v1';

  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function getAuthHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    try {
      const token =
        (typeof window.__starAuthStore?.getToken === 'function' ? window.__starAuthStore.getToken() : '') ||
        localStorage.getItem('star_token') ||
        '';
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const uid =
        (typeof window.__starAuthStore?.getActiveUserId === 'function' ? window.__starAuthStore.getActiveUserId() : '') ||
        window.__STAR_CURRENT_USER__?.id ||
        '';
      if (uid) headers['X-Expected-User-Id'] = uid;
    } catch {}
    return headers;
  }

  function notify(msg) {
    if (typeof window.showToast === 'function') {
      window.showToast(msg);
      return;
    }
    const toast = document.getElementById('global-top-toast');
    if (toast) {
      toast.textContent = msg;
      try { toast.showPopover(); } catch {}
      setTimeout(() => { try { toast.hidePopover(); } catch {} }, 2600);
    }
  }

  /* ========================================================================
     一、头像系统引擎（文字徽章 · 预设矢量 · SVG 捏脸 · 上传裁剪 · 头像框）
     ======================================================================== */

  const AVATAR_BG_GRADIENTS = [
    'linear-gradient(135deg, #2563eb 0%, #4f46e5 100%)',
    'linear-gradient(135deg, #ec4899 0%, #9333ea 100%)',
    'linear-gradient(135deg, #0ea5e9 0%, #2563eb 100%)',
    'linear-gradient(135deg, #f43f5e 0%, #fb7185 100%)',
    'linear-gradient(135deg, #10b981 0%, #0d9488 100%)',
    'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
    'linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%)',
    'linear-gradient(135deg, #06b6d4 0%, #3b82f6 100%)',
    'linear-gradient(135deg, #e11d48 0%, #be123c 100%)',
    'linear-gradient(135deg, #1e293b 0%, #475569 100%)',
    'linear-gradient(135deg, #c084fc 0%, #f472b6 100%)',
    'linear-gradient(135deg, #d97706 0%, #b45309 100%)'
  ];

  const AVATAR_FRAMES = [
    { id: 'none', name: '无边框' },
    { id: 'starlight-gold', name: '星光流金' },
    { id: 'sakura-bloom', name: '初樱漫舞' },
    { id: 'cyber-pulse', name: '赛博脉冲' },
    { id: 'moonlit-silver', name: '银月霜华' },
    { id: 'crimson-seal', name: '绯红朱印' },
    { id: 'aurora-halo', name: '极光幻彩' }
  ];

  const AVATAR_SHAPES = [
    { id: 'circle', name: '正圆' },
    { id: 'squircle', name: '超椭圆' },
    { id: 'rounded', name: '圆角方' },
    { id: 'hex', name: '徽章六边' }
  ];

  const AVATAR_BADGES = ['', '✨', '🌸', '🌙', '💫', '🎀', '🦋', '🔥', '💎', '🐾'];

  const PRESET_AVATARS = [
    {
      id: 'preset_sakura_fox',
      name: '樱影灵狐',
      bg: 'linear-gradient(135deg, #fdf2f8 0%, #fbcfe8 100%)',
      svg: '<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><path d="M14 26 L18 10 L30 20 Z" fill="#f472b6"/><path d="M50 26 L46 10 L34 20 Z" fill="#f472b6"/><circle cx="32" cy="34" r="18" fill="#fff5f7"/><circle cx="25" cy="33" r="2.6" fill="#3b1d36"/><circle cx="39" cy="33" r="2.6" fill="#3b1d36"/><path d="M29 40 Q32 43 35 40" stroke="#e11d48" stroke-width="2" fill="none" stroke-linecap="round"/><circle cx="20" cy="37" r="3" fill="#fda4af" opacity="0.7"/><circle cx="44" cy="37" r="3" fill="#fda4af" opacity="0.7"/></svg>'
    },
    {
      id: 'preset_star_witch',
      name: '星夜魔女',
      bg: 'linear-gradient(135deg, #1e1b4b 0%, #4c1d95 100%)',
      svg: '<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><path d="M12 34 L32 10 L52 34 Z" fill="#6d28d9"/><ellipse cx="32" cy="34" rx="24" ry="5" fill="#4c1d95"/><path d="M20 34 Q32 48 44 34" fill="#fde68a"/><circle cx="44" cy="18" r="2.5" fill="#fef08a"/><circle cx="22" cy="22" r="1.5" fill="#fef08a"/><path d="M32 22 L33.5 26 L37.5 26 L34.2 28.5 L35.5 32.5 L32 30 L28.5 32.5 L29.8 28.5 L26.5 26 L30.5 26 Z" fill="#fbbf24"/></svg>'
    },
    {
      id: 'preset_moon_knight',
      name: '银月微徽',
      bg: 'linear-gradient(135deg, #0f172a 0%, #334155 100%)',
      svg: '<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><path d="M38 14 A18 18 0 1 0 50 44 A14 14 0 1 1 38 14 Z" fill="#e2e8f0"/><circle cx="44" cy="24" r="3" fill="#fbbf24"/><circle cx="36" cy="18" r="1.5" fill="#fde68a"/><circle cx="48" cy="34" r="1.8" fill="#93c5fd"/></svg>'
    },
    {
      id: 'preset_fan_ink',
      name: '朱砂折扇',
      bg: 'linear-gradient(135deg, #291816 0%, #5c241d 100%)',
      svg: '<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><path d="M12 40 A24 24 0 0 1 52 40 L32 48 Z" fill="#f5e6d3"/><path d="M17 39 A19 19 0 0 1 47 39" stroke="#c8563d" stroke-width="2.5" fill="none"/><line x1="32" y1="48" x2="20" y2="28" stroke="#9a3412" stroke-width="1.2"/><line x1="32" y1="48" x2="32" y2="24" stroke="#9a3412" stroke-width="1.2"/><line x1="32" y1="48" x2="44" y2="28" stroke="#9a3412" stroke-width="1.2"/><circle cx="32" cy="48" r="3" fill="#fbbf24"/></svg>'
    },
    {
      id: 'preset_cyber_cat',
      name: '霓虹猫耳',
      bg: 'linear-gradient(135deg, #090e1a 0%, #1e293b 100%)',
      svg: '<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><path d="M16 40 L18 18 L28 26 L36 26 L46 18 L48 40 Q48 50 32 50 Q16 50 16 40 Z" fill="#1e293b" stroke="#22d3ee" stroke-width="2.4"/><rect x="22" y="34" width="7" height="3" rx="1.5" fill="#22d3ee"/><rect x="35" y="34" width="7" height="3" rx="1.5" fill="#f472b6"/><path d="M29 42 L32 44 L35 42" stroke="#a78bfa" stroke-width="2" fill="none" stroke-linecap="round"/></svg>'
    },
    {
      id: 'preset_pearl_shell',
      name: '深海明珠',
      bg: 'linear-gradient(135deg, #0c4a6e 0%, #0284c7 100%)',
      svg: '<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><path d="M12 42 Q12 18 32 18 Q52 18 52 42 Q42 50 32 50 Q22 50 12 42 Z" fill="#e0f2fe"/><circle cx="32" cy="36" r="8" fill="#ffffff"/><circle cx="29" cy="33" r="2.2" fill="#bae6fd"/></svg>'
    },
    {
      id: 'preset_paper_crane',
      name: '千纸信鹤',
      bg: 'linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)',
      svg: '<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><polygon points="10,24 32,36 26,48" fill="#fb7185"/><polygon points="54,22 32,36 38,48" fill="#f43f5e"/><polygon points="26,48 32,20 38,48" fill="#fda4af"/><polygon points="32,20 40,16 34,26" fill="#e11d48"/></svg>'
    },
    {
      id: 'preset_butterfly',
      name: '蝶梦紫翼',
      bg: 'linear-gradient(135deg, #2e1065 0%, #701a75 100%)',
      svg: '<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><path d="M32 32 C18 12, 8 22, 16 34 C10 42, 22 50, 32 38 Z" fill="#c084fc"/><path d="M32 32 C46 12, 56 22, 48 34 C54 42, 42 50, 32 38 Z" fill="#f472b6"/><rect x="30.5" y="22" width="3" height="22" rx="1.5" fill="#fef08a"/></svg>'
    },
    {
      id: 'preset_matcha_bunny',
      name: '云朵兔兔',
      bg: 'linear-gradient(135deg, #dcfce7 0%, #bbf7d0 100%)',
      svg: '<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><ellipse cx="24" cy="20" rx="4.5" ry="12" fill="#ffffff"/><ellipse cx="40" cy="20" rx="4.5" ry="12" fill="#ffffff"/><circle cx="32" cy="38" r="15" fill="#ffffff"/><circle cx="26" cy="37" r="2.2" fill="#334155"/><circle cx="38" cy="37" r="2.2" fill="#334155"/><circle cx="22" cy="41" r="2.5" fill="#fda4af"/><circle cx="42" cy="41" r="2.5" fill="#fda4af"/></svg>'
    },
    {
      id: 'preset_aurora',
      name: '极光星环',
      bg: 'linear-gradient(135deg, #064e3b 0%, #1e3a8a 100%)',
      svg: '<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><circle cx="32" cy="32" r="12" fill="#a7f3d0"/><ellipse cx="32" cy="32" rx="24" ry="8" transform="rotate(-22 32 32)" fill="none" stroke="#38bdf8" stroke-width="3"/><circle cx="48" cy="20" r="2.5" fill="#fef08a"/></svg>'
    },
    {
      id: 'preset_tea',
      name: '清茶幽兰',
      bg: 'linear-gradient(135deg, #f3f4f6 0%, #e5e7eb 100%)',
      svg: '<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><path d="M16 30 H48 V38 A14 14 0 0 1 16 38 Z" fill="#10b981"/><ellipse cx="32" cy="30" rx="16" ry="4" fill="#d1fae5"/><path d="M25 22 Q27 16 25 12" stroke="#6ee7b7" stroke-width="2" fill="none" stroke-linecap="round"/><path d="M35 20 Q37 14 35 10" stroke="#6ee7b7" stroke-width="2" fill="none" stroke-linecap="round"/></svg>'
    },
    {
      id: 'preset_crown',
      name: '星冠荣光',
      bg: 'linear-gradient(135deg, #312e81 0%, #1e1b4b 100%)',
      svg: '<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><polygon points="14,44 18,22 28,32 32,18 36,32 46,22 50,44" fill="#fbbf24"/><rect x="14" y="44" width="36" height="5" rx="2.5" fill="#f59e0b"/><circle cx="32" cy="18" r="2.5" fill="#fef08a"/></svg>'
    }
  ];

  // 分层 SVG 捏脸工坊部件库（类 DiceBear / Picrew）
  const BUILDER_PARTS = {
    bg: [
      { id: 'sakura', label: '浅樱', val: '#fde2f0' },
      { id: 'lavender', label: '浅薰', val: '#e9d5ff' },
      { id: 'sky', label: '晴空', val: '#dbeafe' },
      { id: 'mint', label: '薄荷', val: '#d1fae5' },
      { id: 'peach', label: '蜜桃', val: '#ffedd5' },
      { id: 'night', label: '星夜', val: '#1e1b4b' },
      { id: 'ink', label: '墨玉', val: '#27272a' },
      { id: 'gold', label: '暖金', val: '#fef3c7' }
    ],
    skin: [
      { id: 'fair', label: '瓷白', val: '#fff1e6' },
      { id: 'warm', label: '柔粉', val: '#ffe0cc' },
      { id: 'honey', label: '蜜糖', val: '#f3c6a5' },
      { id: 'tan', label: '小麦', val: '#d9a077' },
      { id: 'pale', label: '月白', val: '#f8fafc' }
    ],
    hair: [
      { id: 'short_bob', label: '柔顺短发', color: '#2b2438' },
      { id: 'long_wave', label: '长卷波浪', color: '#3b2438' },
      { id: 'twin_tails', label: '元气双马尾', color: '#f472b6' },
      { id: 'silver_wolf', label: '银白狼尾', color: '#cbd5e1' },
      { id: 'high_pony', label: '高马尾', color: '#4c1d95' },
      { id: 'ancient_bun', label: '古风双髻', color: '#1f2937' },
      { id: 'fluffy_curl', label: '蓬松卷毛', color: '#92400e' },
      { id: 'parted_gentle', label: '温柔中分', color: '#1e3a8a' }
    ],
    eyes: [
      { id: 'bright', label: '星眸' },
      { id: 'gentle', label: '弯月笑' },
      { id: 'cool', label: '清冷凤眼' },
      { id: 'wink', label: '俏皮眨眼' },
      { id: 'sparkle', label: '星星眼' },
      { id: 'sleepy', label: '慵懒半眯' }
    ],
    mouth: [
      { id: 'smile', label: '甜笑' },
      { id: 'cat', label: '猫嘴 :3' },
      { id: 'calm', label: '淡定' },
      { id: 'happy', label: '开心大笑' },
      { id: 'shy', label: '小巧樱唇' },
      { id: 'smirk', label: '微勾自信' }
    ],
    outfit: [
      { id: 'knit', label: '针织开衫' },
      { id: 'collar', label: '学院领结' },
      { id: 'hanfu', label: '交领汉服' },
      { id: 'hoodie', label: '休闲连帽' },
      { id: 'suit', label: '礼服西装' },
      { id: 'cloak', label: '星夜斗篷' }
    ],
    acc: [
      { id: 'none', label: '无配饰' },
      { id: 'glasses', label: '金丝眼镜' },
      { id: 'ribbon', label: '蝴蝶结发卡' },
      { id: 'catear', label: '猫耳头饰' },
      { id: 'halo', label: '小光环' },
      { id: 'blush', label: '元气腮红' }
    ]
  };

  function buildBuilderSvg(parts = {}) {
    const bgObj = BUILDER_PARTS.bg.find((x) => x.id === parts.bg) || BUILDER_PARTS.bg[0];
    const skinObj = BUILDER_PARTS.skin.find((x) => x.id === parts.skin) || BUILDER_PARTS.skin[0];
    const hairObj = BUILDER_PARTS.hair.find((x) => x.id === parts.hair) || BUILDER_PARTS.hair[0];
    const hairColor = hairObj.color;
    const eyeId = parts.eyes || 'bright';
    const mouthId = parts.mouth || 'smile';
    const outfitId = parts.outfit || 'knit';
    const accId = parts.acc || 'none';

    let hairBack = '';
    let hairFront = '';
    switch (hairObj.id) {
      case 'long_wave':
        hairBack = `<path d="M16 30 Q12 68 20 82 L80 82 Q88 68 84 30 Q74 14 50 14 Q26 14 16 30 Z" fill="${hairColor}"/>`;
        hairFront = `<path d="M24 38 Q36 22 50 28 Q64 22 76 38 Q72 20 50 18 Q28 20 24 38 Z" fill="${hairColor}"/>`;
        break;
      case 'twin_tails':
        hairBack = `<ellipse cx="18" cy="54" rx="9" ry="22" fill="${hairColor}"/><ellipse cx="82" cy="54" rx="9" ry="22" fill="${hairColor}"/>`;
        hairFront = `<path d="M24 40 Q38 22 50 26 Q62 22 76 40 Q72 18 50 18 Q28 18 24 40 Z" fill="${hairColor}"/>`;
        break;
      case 'silver_wolf':
        hairBack = `<path d="M18 32 L12 66 L28 62 L72 62 L88 66 L82 32 Q68 14 50 14 Q32 14 18 32 Z" fill="${hairColor}"/>`;
        hairFront = `<path d="M23 42 L34 26 L44 38 L52 24 L64 38 L77 42 Q72 18 50 16 Q28 18 23 42 Z" fill="${hairColor}"/>`;
        break;
      case 'high_pony':
        hairBack = `<path d="M62 14 Q86 18 82 54 Q70 48 64 30 Z" fill="${hairColor}"/>`;
        hairFront = `<path d="M24 38 Q50 20 76 38 Q72 16 50 16 Q28 16 24 38 Z" fill="${hairColor}"/>`;
        break;
      case 'ancient_bun':
        hairBack = `<circle cx="24" cy="22" r="9" fill="${hairColor}"/><circle cx="76" cy="22" r="9" fill="${hairColor}"/>`;
        hairFront = `<path d="M24 38 Q36 24 50 24 Q64 24 76 38 Q70 18 50 18 Q30 18 24 38 Z" fill="${hairColor}"/>`;
        break;
      case 'fluffy_curl':
        hairBack = `<circle cx="26" cy="30" r="14" fill="${hairColor}"/><circle cx="74" cy="30" r="14" fill="${hairColor}"/><circle cx="50" cy="22" r="16" fill="${hairColor}"/>`;
        hairFront = `<path d="M24 38 Q36 26 50 30 Q64 26 76 38 Q68 20 50 20 Q32 20 24 38 Z" fill="${hairColor}"/>`;
        break;
      case 'parted_gentle':
        hairBack = `<path d="M20 34 Q20 62 28 66 L72 66 Q80 62 80 34 Q70 16 50 16 Q30 16 20 34 Z" fill="${hairColor}"/>`;
        hairFront = `<path d="M24 42 Q34 24 48 22 Q36 34 32 46 Z M76 42 Q66 24 52 22 Q64 34 68 46 Z" fill="${hairColor}"/>`;
        break;
      default:
        hairBack = `<path d="M20 34 Q20 60 28 62 L72 62 Q80 60 80 34 Q70 16 50 16 Q30 16 20 34 Z" fill="${hairColor}"/>`;
        hairFront = `<path d="M24 38 Q42 22 50 28 Q58 22 76 38 Q72 18 50 18 Q28 18 24 38 Z" fill="${hairColor}"/>`;
        break;
    }

    let eyesSvg = '';
    if (eyeId === 'gentle') {
      eyesSvg = '<path d="M33 48 Q38 43 43 48" stroke="#2d1f36" stroke-width="2.6" fill="none" stroke-linecap="round"/><path d="M57 48 Q62 43 67 48" stroke="#2d1f36" stroke-width="2.6" fill="none" stroke-linecap="round"/>';
    } else if (eyeId === 'cool') {
      eyesSvg = '<path d="M32 47 L43 49" stroke="#2d1f36" stroke-width="2.6" stroke-linecap="round"/><circle cx="38" cy="50" r="2.6" fill="#2d1f36"/><path d="M68 47 L57 49" stroke="#2d1f36" stroke-width="2.6" stroke-linecap="round"/><circle cx="62" cy="50" r="2.6" fill="#2d1f36"/>';
    } else if (eyeId === 'wink') {
      eyesSvg = '<circle cx="38" cy="48" r="3.4" fill="#2d1f36"/><circle cx="39" cy="46.8" r="1.2" fill="#ffffff"/><path d="M57 48 Q62 43 67 48" stroke="#2d1f36" stroke-width="2.6" fill="none" stroke-linecap="round"/>';
    } else if (eyeId === 'sparkle') {
      eyesSvg = '<circle cx="38" cy="48" r="4" fill="#2d1f36"/><circle cx="39.2" cy="46.8" r="1.5" fill="#fef08a"/><circle cx="62" cy="48" r="4" fill="#2d1f36"/><circle cx="63.2" cy="46.8" r="1.5" fill="#fef08a"/>';
    } else if (eyeId === 'sleepy') {
      eyesSvg = '<path d="M33 47 H43" stroke="#2d1f36" stroke-width="2.4" stroke-linecap="round"/><circle cx="38" cy="50" r="2.2" fill="#2d1f36"/><path d="M57 47 H67" stroke="#2d1f36" stroke-width="2.4" stroke-linecap="round"/><circle cx="62" cy="50" r="2.2" fill="#2d1f36"/>';
    } else {
      eyesSvg = '<circle cx="38" cy="48" r="3.5" fill="#2d1f36"/><circle cx="39.2" cy="46.7" r="1.2" fill="#ffffff"/><circle cx="62" cy="48" r="3.5" fill="#2d1f36"/><circle cx="63.2" cy="46.7" r="1.2" fill="#ffffff"/>';
    }

    let mouthSvg = '';
    if (mouthId === 'cat') {
      mouthSvg = '<path d="M44 59 Q47 62 50 59 Q53 62 56 59" stroke="#c2416b" stroke-width="2.2" fill="none" stroke-linecap="round"/>';
    } else if (mouthId === 'calm') {
      mouthSvg = '<line x1="46" y1="60" x2="54" y2="60" stroke="#9f5a67" stroke-width="2.2" stroke-linecap="round"/>';
    } else if (mouthId === 'happy') {
      mouthSvg = '<path d="M44 58 Q50 66 56 58 Z" fill="#f43f5e"/>';
    } else if (mouthId === 'shy') {
      mouthSvg = '<circle cx="50" cy="60" r="2.3" fill="#fb7185"/>';
    } else if (mouthId === 'smirk') {
      mouthSvg = '<path d="M45 60 Q51 61 56 57" stroke="#9f5a67" stroke-width="2.2" fill="none" stroke-linecap="round"/>';
    } else {
      mouthSvg = '<path d="M44 58 Q50 63 56 58" stroke="#c2416b" stroke-width="2.2" fill="none" stroke-linecap="round"/>';
    }

    let outfitSvg = '';
    if (outfitId === 'collar') {
      outfitSvg = '<path d="M22 96 Q26 72 50 72 Q74 72 78 96 Z" fill="#312e81"/><polygon points="44,72 50,82 56,72" fill="#ffffff"/><polygon points="50,76 45,80 50,84 55,80" fill="#ec4899"/>';
    } else if (outfitId === 'hanfu') {
      outfitSvg = '<path d="M20 96 Q26 72 50 72 Q74 72 80 96 Z" fill="#b91c1c"/><path d="M36 72 L56 96" stroke="#fde68a" stroke-width="4"/><path d="M64 72 L44 96" stroke="#fef3c7" stroke-width="3"/>';
    } else if (outfitId === 'hoodie') {
      outfitSvg = '<path d="M20 96 Q24 72 50 72 Q76 72 80 96 Z" fill="#0ea5e9"/><path d="M34 72 Q50 82 66 72" stroke="#e0f2fe" stroke-width="3" fill="none"/>';
    } else if (outfitId === 'suit') {
      outfitSvg = '<path d="M20 96 Q24 72 50 72 Q76 72 80 96 Z" fill="#1e293b"/><polygon points="42,72 50,88 58,72" fill="#f8fafc"/><rect x="48.5" y="75" width="3" height="14" fill="#d97706"/>';
    } else if (outfitId === 'cloak') {
      outfitSvg = '<path d="M16 96 Q24 70 50 70 Q76 70 84 96 Z" fill="#4c1d95"/><circle cx="50" cy="78" r="3.5" fill="#fbbf24"/>';
    } else {
      outfitSvg = '<path d="M22 96 Q26 72 50 72 Q74 72 78 96 Z" fill="#f472b6"/><path d="M40 72 Q50 80 60 72" fill="#fff1f2"/>';
    }

    let accSvg = '';
    if (accId === 'glasses') {
      accSvg = '<circle cx="38" cy="48" r="7" fill="none" stroke="#d97706" stroke-width="1.8"/><circle cx="62" cy="48" r="7" fill="none" stroke="#d97706" stroke-width="1.8"/><line x1="45" y1="48" x2="55" y2="48" stroke="#d97706" stroke-width="1.8"/>';
    } else if (accId === 'ribbon') {
      accSvg = '<polygon points="62,22 70,18 68,26" fill="#ec4899"/><polygon points="78,22 70,18 72,26" fill="#ec4899"/><circle cx="70" cy="22" r="2.2" fill="#fbcfe8"/>';
    } else if (accId === 'catear') {
      accSvg = `<polygon points="24,28 28,12 38,24" fill="${hairColor}"/><polygon points="76,28 72,12 62,24" fill="${hairColor}"/><polygon points="27,25 29,16 35,23" fill="#fda4af"/><polygon points="73,25 71,16 65,23" fill="#fda4af"/>`;
    } else if (accId === 'halo') {
      accSvg = '<ellipse cx="50" cy="11" rx="16" ry="4" fill="none" stroke="#fbbf24" stroke-width="2.5"/>';
    } else if (accId === 'blush') {
      accSvg = '<ellipse cx="33" cy="55" rx="4.5" ry="2.2" fill="#fda4af" opacity="0.75"/><ellipse cx="67" cy="55" rx="4.5" ry="2.2" fill="#fda4af" opacity="0.75"/>';
    }

    return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><rect width="100" height="100" fill="${bgObj.val}"/>${hairBack}${outfitSvg}<rect x="44" y="64" width="12" height="12" rx="4" fill="${skinObj.val}"/><circle cx="50" cy="46" r="22" fill="${skinObj.val}"/>${eyesSvg}${mouthSvg}${hairFront}${accSvg}</svg>`;
  }

  function extractCoreGlyph(name, fallback = '星') {
    const clean = String(name || '').replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '');
    if (clean.length > 0) return clean.charAt(0);
    return String(name || fallback).trim().charAt(0) || fallback;
  }

  function renderAvatarCoreHtml(avatarRaw, nameRaw, sizeClass, isUser, avatarConfig) {
    const cfg = avatarConfig && typeof avatarConfig === 'object' ? avatarConfig : null;
    const raw = String(avatarRaw || '').trim();

    if (cfg && cfg.type === 'upload' && cfg.src) {
      return `<img src="${escapeHtml(cfg.src)}" class="avatar-img ${sizeClass}" alt="${escapeHtml(nameRaw || '')}" loading="lazy" decoding="async" />`;
    }
    if (cfg && cfg.type === 'preset' && cfg.presetId) {
      const preset = PRESET_AVATARS.find((p) => p.id === cfg.presetId);
      if (preset) {
        return `<span class="art-badge-avatar ${sizeClass}" style="background: ${preset.bg}; padding: 0;">${preset.svg}</span>`;
      }
    }
    if (cfg && cfg.type === 'svg-builder' && cfg.parts) {
      return `<span class="art-badge-avatar ${sizeClass}" style="padding: 0;">${buildBuilderSvg(cfg.parts)}</span>`;
    }
    if (raw.startsWith('http://') || raw.startsWith('https://') || raw.startsWith('data:image/') || raw.startsWith('/')) {
      return `<img src="${escapeHtml(raw)}" class="avatar-img ${sizeClass}" alt="${escapeHtml(nameRaw || '')}" loading="lazy" decoding="async" />`;
    }
    if (!isUser && (nameRaw?.includes('DeepSeek') || raw === '🐋')) {
      return `<span class="art-badge-avatar ${sizeClass}" style="background: linear-gradient(135deg, #1d4ed8 0%, #3b82f6 100%);">🐋</span>`;
    }
    if (isUser) {
      const glyph = cfg?.glyph || (raw && raw.length <= 4 && !raw.startsWith('svg:') ? raw : extractCoreGlyph(nameRaw || '我', '我'));
      const bg = cfg?.bg || AVATAR_BG_GRADIENTS[0];
      return `<span class="art-badge-avatar ${sizeClass}" style="background: ${escapeHtml(bg)};">${escapeHtml(glyph)}</span>`;
    }
    const glyph = extractCoreGlyph(nameRaw, '角');
    return `<span class="art-badge-avatar ${sizeClass}" style="background: linear-gradient(135deg, #ec4899 0%, #8b5cf6 100%);">${escapeHtml(glyph)}</span>`;
  }

  function renderSmartAvatarHtml(avatarRaw, nameRaw, sizeClass = 'size-md', isUser = false, avatarConfig = null) {
    let resolvedCfg = avatarConfig;
    if (!resolvedCfg && isUser && typeof window.__getActiveUserAvatarConfig === 'function') {
      resolvedCfg = window.__getActiveUserAvatarConfig();
    }
    const coreHtml = renderAvatarCoreHtml(avatarRaw, nameRaw, sizeClass, isUser, resolvedCfg);
    if (!isUser && !resolvedCfg) {
      return coreHtml;
    }
    const frameId = resolvedCfg?.frameId || 'none';
    const shape = resolvedCfg?.shape || 'circle';
    const badge = resolvedCfg?.badge ? `<span class="avatar-badge">${escapeHtml(resolvedCfg.badge)}</span>` : '';
    return `<span class="avatar-wrap ${escapeHtml(sizeClass)}" data-frame="${escapeHtml(frameId)}" data-shape="${escapeHtml(shape)}"><span class="avatar-core">${coreHtml}</span>${badge}</span>`;
  }

  /* ========================================================================
     二、头像工坊弹窗交互（文字徽章 · 预设 · 捏脸 · 裁剪上传 · 头像框）
     ======================================================================== */

  function createDefaultAvatarConfig(currentAvatar, currentName) {
    return {
      type: 'glyph',
      glyph: currentAvatar && !currentAvatar.startsWith('/api/') && !currentAvatar.startsWith('data:') && !currentAvatar.startsWith('svg:')
        ? currentAvatar.slice(0, 4)
        : extractCoreGlyph(currentName || '我', '我'),
      bg: AVATAR_BG_GRADIENTS[0],
      frameId: 'none',
      shape: 'circle',
      badge: '',
      presetId: PRESET_AVATARS[0].id,
      parts: {
        bg: 'sakura',
        skin: 'fair',
        hair: 'long_wave',
        eyes: 'bright',
        mouth: 'smile',
        outfit: 'knit',
        acc: 'none'
      },
      src: ''
    };
  }

  function openAvatarStudio({ initialAvatar, initialConfig, nickname, onApply }) {
    const dialog = document.getElementById('avatar-studio-dialog');
    if (!dialog) return;

    const draft = Object.assign(
      createDefaultAvatarConfig(initialAvatar, nickname),
      initialConfig && typeof initialConfig === 'object' ? JSON.parse(JSON.stringify(initialConfig)) : {}
    );
    if (!draft.parts) {
      draft.parts = createDefaultAvatarConfig(initialAvatar, nickname).parts;
    }
    if (initialAvatar && (initialAvatar.startsWith('/api/uploads/') || initialAvatar.startsWith('data:image/')) && !draft.src) {
      draft.type = 'upload';
      draft.src = initialAvatar;
    }

    let activeTab = draft.type === 'upload' ? 'upload'
      : draft.type === 'svg-builder' ? 'builder'
      : draft.type === 'preset' ? 'preset'
      : 'glyph';

    // Canvas 裁剪状态
    const cropState = {
      img: null,
      scale: 1,
      minScale: 1,
      offsetX: 0,
      offsetY: 0,
      dragging: false,
      lastX: 0,
      lastY: 0
    };

    function renderDialog() {
      const previewHtml = renderSmartAvatarHtml(
        draft.type === 'upload' ? draft.src : draft.glyph,
        nickname || '我',
        'size-xl',
        true,
        draft
      );

      dialog.innerHTML = `
        <div class="modal-inner">
          <div class="modal-header">
            <h2>自定义头像工坊 <span class="skin-free-tag">全部免费开放</span></h2>
            <button type="button" class="icon-btn" id="close-avatar-studio-btn" aria-label="关闭头像工坊">✕</button>
          </div>
          <div class="avatar-studio-shell">
            <div class="avatar-studio-preview-col">
              <div id="as-live-preview">${previewHtml}</div>
              <div style="text-align:center;">
                <div style="font-size:13px;font-weight:600;">实时预览</div>
                <div style="font-size:11.5px;color:var(--text-muted);margin-top:2px;">支持头像框与心情角标</div>
              </div>
              <div style="width:100%;display:flex;flex-direction:column;gap:8px;">
                <div class="builder-parts-title">轮廓形状</div>
                <div class="skin-pills-row">
                  ${AVATAR_SHAPES.map((s) => `<button type="button" class="skin-pill-btn as-shape-btn ${draft.shape === s.id ? 'active' : ''}" data-shape="${s.id}">${s.name}</button>`).join('')}
                </div>
                <div class="builder-parts-title" style="margin-top:4px;">心情角标</div>
                <div class="skin-pills-row">
                  ${AVATAR_BADGES.map((b) => `<button type="button" class="skin-pill-btn as-badge-btn ${draft.badge === b ? 'active' : ''}" data-badge="${escapeHtml(b)}">${b || '无'}</button>`).join('')}
                </div>
              </div>
            </div>

            <div>
              <div class="avatar-studio-tabs" role="tablist">
                <button type="button" class="avatar-studio-tab ${activeTab === 'glyph' ? 'active' : ''}" data-tab="glyph">文字/Emoji</button>
                <button type="button" class="avatar-studio-tab ${activeTab === 'preset' ? 'active' : ''}" data-tab="preset">精美预设</button>
                <button type="button" class="avatar-studio-tab ${activeTab === 'builder' ? 'active' : ''}" data-tab="builder">捏脸工坊</button>
                <button type="button" class="avatar-studio-tab ${activeTab === 'upload' ? 'active' : ''}" data-tab="upload">上传裁剪</button>
                <button type="button" class="avatar-studio-tab ${activeTab === 'frame' ? 'active' : ''}" data-tab="frame">免费头像框</button>
              </div>
              <div class="avatar-studio-panel" id="as-tab-panel"></div>
            </div>
          </div>

          <div class="modal-actions" style="margin-top:16px;">
            <button type="button" class="secondary-btn" id="as-cancel-btn">取消</button>
            <button type="button" class="primary-btn" id="as-apply-btn">应用此头像配置</button>
          </div>
        </div>
      `;

      renderTabBody();
      bindDialogEvents();
    }

    function updatePreviewOnly() {
      const box = dialog.querySelector('#as-live-preview');
      if (!box) return;
      box.innerHTML = renderSmartAvatarHtml(
        draft.type === 'upload' ? draft.src : draft.glyph,
        nickname || '我',
        'size-xl',
        true,
        draft
      );
    }

    function renderTabBody() {
      const panel = dialog.querySelector('#as-tab-panel');
      if (!panel) return;

      if (activeTab === 'glyph') {
        panel.innerHTML = `
          <div class="field-group">
            <label for="as-glyph-input">显示文字或 Emoji（最多 4 字）</label>
            <input id="as-glyph-input" type="text" maxlength="4" value="${escapeHtml(draft.glyph || '我')}" placeholder="例如：星、🎀、旅" />
          </div>
          <div class="builder-parts-group">
            <div class="builder-parts-title">选择底色渐变</div>
            <div class="avatar-choice-grid">
              ${AVATAR_BG_GRADIENTS.map((g, i) => `
                <button type="button" class="avatar-choice-card as-bg-btn ${draft.bg === g && draft.type === 'glyph' ? 'active' : ''}" data-idx="${i}">
                  <span style="width:32px;height:32px;border-radius:50%;background:${g};display:inline-flex;align-items:center;justify-content:center;color:#fff;font-weight:700;">${escapeHtml(draft.glyph || '星')}</span>
                  <span>渐变 ${i + 1}</span>
                </button>
              `).join('')}
            </div>
          </div>
        `;
        const inp = panel.querySelector('#as-glyph-input');
        inp?.addEventListener('input', () => {
          draft.type = 'glyph';
          draft.glyph = inp.value.trim().slice(0, 4) || '我';
          updatePreviewOnly();
        });
        panel.querySelectorAll('.as-bg-btn').forEach((btn) => {
          btn.addEventListener('click', () => {
            draft.type = 'glyph';
            draft.bg = AVATAR_BG_GRADIENTS[Number(btn.dataset.idx)] || AVATAR_BG_GRADIENTS[0];
            renderTabBody();
            updatePreviewOnly();
          });
        });
      } else if (activeTab === 'preset') {
        panel.innerHTML = `
          <div class="avatar-choice-grid" style="grid-template-columns: repeat(auto-fill, minmax(84px, 1fr));">
            ${PRESET_AVATARS.map((p) => `
              <button type="button" class="avatar-choice-card as-preset-btn ${draft.type === 'preset' && draft.presetId === p.id ? 'active' : ''}" data-pid="${p.id}">
                <span style="width:42px;height:42px;border-radius:50%;overflow:hidden;background:${p.bg};display:inline-flex;">${p.svg}</span>
                <span>${p.name}</span>
              </button>
            `).join('')}
          </div>
        `;
        panel.querySelectorAll('.as-preset-btn').forEach((btn) => {
          btn.addEventListener('click', () => {
            draft.type = 'preset';
            draft.presetId = btn.dataset.pid;
            renderTabBody();
            updatePreviewOnly();
          });
        });
      } else if (activeTab === 'builder') {
        const partGroup = (key, title, list) => `
          <div class="builder-parts-group">
            <div class="builder-parts-title">${title}</div>
            <div class="skin-pills-row">
              ${list.map((item) => `
                <button type="button" class="skin-pill-btn as-part-btn ${draft.parts[key] === item.id ? 'active' : ''}" data-key="${key}" data-val="${item.id}">
                  ${item.val ? `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${item.val};margin-right:4px;border:1px solid rgba(0,0,0,0.2);"></span>` : ''}${item.label}
                </button>
              `).join('')}
            </div>
          </div>
        `;
        panel.innerHTML = `
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span style="font-size:12.5px;color:var(--text-secondary);">自由拼接专属矢量角色头像</span>
            <button type="button" class="secondary-btn" id="as-random-builder-btn" style="padding:5px 12px;font-size:12px;">🎲 随机捏脸</button>
          </div>
          ${partGroup('bg', '背景色', BUILDER_PARTS.bg)}
          ${partGroup('skin', '肤色', BUILDER_PARTS.skin)}
          ${partGroup('hair', '发型', BUILDER_PARTS.hair)}
          ${partGroup('eyes', '眼神', BUILDER_PARTS.eyes)}
          ${partGroup('mouth', '神态', BUILDER_PARTS.mouth)}
          ${partGroup('outfit', '服饰', BUILDER_PARTS.outfit)}
          ${partGroup('acc', '配饰', BUILDER_PARTS.acc)}
        `;
        panel.querySelector('#as-random-builder-btn')?.addEventListener('click', () => {
          draft.type = 'svg-builder';
          for (const key of Object.keys(BUILDER_PARTS)) {
            const arr = BUILDER_PARTS[key];
            draft.parts[key] = arr[Math.floor(Math.random() * arr.length)].id;
          }
          renderTabBody();
          updatePreviewOnly();
        });
        panel.querySelectorAll('.as-part-btn').forEach((btn) => {
          btn.addEventListener('click', () => {
            draft.type = 'svg-builder';
            draft.parts[btn.dataset.key] = btn.dataset.val;
            renderTabBody();
            updatePreviewOnly();
          });
        });
      } else if (activeTab === 'upload') {
        panel.innerHTML = `
          <div class="avatar-crop-box">
            <input type="file" id="as-file-input" accept="image/png,image/jpeg,image/webp" hidden />
            <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center;">
              <button type="button" class="secondary-btn" id="as-pick-file-btn">选择本地图片…</button>
              ${cropState.img ? '<button type="button" class="primary-btn" id="as-confirm-upload-btn">裁剪并上传头像</button>' : ''}
            </div>
            <canvas id="as-crop-canvas" class="avatar-crop-canvas" width="220" height="220"></canvas>
            <div style="width:220px;display:flex;flex-direction:column;gap:6px;">
              <label style="font-size:12px;color:var(--text-muted);display:flex;justify-content:space-between;">
                <span>拖动图片调整位置 · 缩放</span>
                <span id="as-zoom-val">${Math.round((cropState.scale / (cropState.minScale || 1)) * 100)}%</span>
              </label>
              <input type="range" id="as-zoom-range" min="1" max="3" step="0.05" value="${cropState.img ? (cropState.scale / cropState.minScale).toFixed(2) : '1'}" ${cropState.img ? '' : 'disabled'} />
            </div>
          </div>
        `;
        setupCropCanvas(panel);
      } else if (activeTab === 'frame') {
        panel.innerHTML = `
          <div class="builder-parts-title">选择免费头像框（全部免费解锁）</div>
          <div class="avatar-choice-grid" style="grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));">
            ${AVATAR_FRAMES.map((f) => {
              const sampleCfg = Object.assign({}, draft, { frameId: f.id });
              const mini = renderSmartAvatarHtml(draft.type === 'upload' ? draft.src : draft.glyph, nickname || '我', 'size-lg', true, sampleCfg);
              return `
                <button type="button" class="avatar-choice-card as-frame-btn ${draft.frameId === f.id ? 'active' : ''}" data-fid="${f.id}">
                  ${mini}
                  <span>${f.name}</span>
                </button>
              `;
            }).join('')}
          </div>
        `;
        panel.querySelectorAll('.as-frame-btn').forEach((btn) => {
          btn.addEventListener('click', () => {
            draft.frameId = btn.dataset.fid;
            renderTabBody();
            updatePreviewOnly();
          });
        });
      }
    }

    function drawCropCanvas(canvas) {
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, 220, 220);
      if (!cropState.img) {
        ctx.fillStyle = 'rgba(148,163,184,0.18)';
        ctx.fillRect(0, 0, 220, 220);
        ctx.fillStyle = '#94a3b8';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('点击上方“选择本地图片”', 110, 114);
        return;
      }
      const w = cropState.img.width * cropState.scale;
      const h = cropState.img.height * cropState.scale;
      const x = 110 - w / 2 + cropState.offsetX;
      const y = 110 - h / 2 + cropState.offsetY;
      ctx.drawImage(cropState.img, x, y, w, h);

      // 绘制半透明圆形取景遮罩
      ctx.save();
      ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
      ctx.beginPath();
      ctx.rect(0, 0, 220, 220);
      ctx.arc(110, 110, 96, 0, Math.PI * 2, true);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(110, 110, 96, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    function setupCropCanvas(panel) {
      const fileInp = panel.querySelector('#as-file-input');
      const pickBtn = panel.querySelector('#as-pick-file-btn');
      const canvas = panel.querySelector('#as-crop-canvas');
      const zoomRange = panel.querySelector('#as-zoom-range');
      const confirmBtn = panel.querySelector('#as-confirm-upload-btn');

      drawCropCanvas(canvas);
      pickBtn?.addEventListener('click', () => fileInp?.click());

      fileInp?.addEventListener('change', (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          const img = new Image();
          img.onload = () => {
            cropState.img = img;
            const fitScale = Math.max(192 / img.width, 192 / img.height);
            cropState.minScale = fitScale;
            cropState.scale = fitScale;
            cropState.offsetX = 0;
            cropState.offsetY = 0;
            renderTabBody();
          };
          img.src = String(reader.result || '');
        };
        reader.readAsDataURL(file);
      });

      zoomRange?.addEventListener('input', () => {
        if (!cropState.img) return;
        const factor = Number(zoomRange.value) || 1;
        cropState.scale = cropState.minScale * factor;
        const lbl = panel.querySelector('#as-zoom-val');
        if (lbl) lbl.textContent = `${Math.round(factor * 100)}%`;
        drawCropCanvas(canvas);
      });

      const onDown = (clientX, clientY) => {
        if (!cropState.img) return;
        cropState.dragging = true;
        cropState.lastX = clientX;
        cropState.lastY = clientY;
      };
      const onMove = (clientX, clientY) => {
        if (!cropState.dragging) return;
        cropState.offsetX += clientX - cropState.lastX;
        cropState.offsetY += clientY - cropState.lastY;
        cropState.lastX = clientX;
        cropState.lastY = clientY;
        drawCropCanvas(canvas);
      };
      const onUp = () => { cropState.dragging = false; };

      canvas?.addEventListener('mousedown', (e) => onDown(e.clientX, e.clientY));
      window.addEventListener('mousemove', (e) => onMove(e.clientX, e.clientY));
      window.addEventListener('mouseup', onUp);
      canvas?.addEventListener('touchstart', (e) => {
        if (e.touches[0]) onDown(e.touches[0].clientX, e.touches[0].clientY);
      }, { passive: true });
      canvas?.addEventListener('touchmove', (e) => {
        if (e.touches[0]) {
          e.preventDefault();
          onMove(e.touches[0].clientX, e.touches[0].clientY);
        }
      }, { passive: false });
      canvas?.addEventListener('touchend', onUp);

      confirmBtn?.addEventListener('click', async () => {
        if (!cropState.img) return;
        confirmBtn.disabled = true;
        confirmBtn.textContent = '上传处理中…';
        try {
          const out = document.createElement('canvas');
          out.width = 256;
          out.height = 256;
          const octx = out.getContext('2d');
          const ratio = 256 / 192; // 裁剪圆直径 192px 映射到 256px
          const w = cropState.img.width * cropState.scale * ratio;
          const h = cropState.img.height * cropState.scale * ratio;
          const x = 128 - w / 2 + cropState.offsetX * ratio;
          const y = 128 - h / 2 + cropState.offsetY * ratio;
          octx.drawImage(cropState.img, x, y, w, h);

          let dataUrl = out.toDataURL('image/webp', 0.86);
          if (!dataUrl.startsWith('data:image/webp')) {
            dataUrl = out.toDataURL('image/jpeg', 0.85);
          }

          let finalSrc = dataUrl;
          try {
            const resp = await fetch('/api/appearance/upload', {
              method: 'POST',
              headers: getAuthHeaders(),
              credentials: 'include',
              body: JSON.stringify({ category: 'avatars', dataUrl })
            });
            const data = await resp.json();
            if (resp.ok && data?.url) {
              finalSrc = data.url;
            }
          } catch {}

          draft.type = 'upload';
          draft.src = finalSrc;
          updatePreviewOnly();
          notify('头像裁剪上传成功，点击“应用此头像配置”即可生效');
        } finally {
          confirmBtn.disabled = false;
          confirmBtn.textContent = '裁剪并上传头像';
        }
      });
    }

    function bindDialogEvents() {
      dialog.querySelector('#close-avatar-studio-btn')?.addEventListener('click', () => dialog.close());
      dialog.querySelector('#as-cancel-btn')?.addEventListener('click', () => dialog.close());
      dialog.querySelectorAll('.avatar-studio-tab').forEach((tab) => {
        tab.addEventListener('click', () => {
          activeTab = tab.dataset.tab;
          renderDialog();
        });
      });
      dialog.querySelectorAll('.as-shape-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          draft.shape = btn.dataset.shape;
          dialog.querySelectorAll('.as-shape-btn').forEach((b) => b.classList.toggle('active', b === btn));
          updatePreviewOnly();
        });
      });
      dialog.querySelectorAll('.as-badge-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          draft.badge = btn.dataset.badge || '';
          dialog.querySelectorAll('.as-badge-btn').forEach((b) => b.classList.toggle('active', b === btn));
          updatePreviewOnly();
        });
      });
      dialog.querySelector('#as-apply-btn')?.addEventListener('click', () => {
        const avatarVal =
          draft.type === 'upload' && draft.src ? draft.src
          : draft.type === 'preset' ? `svg:preset:${draft.presetId}`
          : draft.type === 'svg-builder' ? 'svg:builder'
          : (draft.glyph || '我');
        if (typeof onApply === 'function') {
          onApply({ avatar: avatarVal, avatar_config: draft });
        }
        dialog.close();
      });
    }

    renderDialog();
    if (!dialog.open) dialog.showModal();
  }

  /* ========================================================================
     三、皮肤更换引擎（6 套精选皮肤 · 壁纸/模糊 · 气泡排版 · 取色 · 导入导出）
     ======================================================================== */

  const SKIN_PRESETS = [
    { id: 'default', name: '系统默认', desc: '跟随当前模式原色', bg: 'linear-gradient(135deg,#f8e4f1,#231d3a)', dot: '#e2559d' },
    { id: 'obsidian-gold', name: '曜石流金', desc: '深邃暗夜 · 暖金星轨', bg: '#0d0f14', dot: '#e5c185' },
    { id: 'mist-silk', name: '晨雾丝绸', desc: '柔光浅色 · 莫兰迪棕', bg: '#f6f4f8', dot: '#b88b72' },
    { id: 'sakura-dawn', name: '朝雾樱白', desc: '二次元粉樱 · 轻盈甜暖', bg: '#fff5fa', dot: '#e2559d' },
    { id: 'crimson-scroll', name: '绯红古卷', desc: '古风悬疑 · 朱砂暗调', bg: '#191211', dot: '#d96b52' },
    { id: 'cyber-neon', name: '赛博霓虹', desc: '未来都市 · 青紫微光', bg: '#080d18', dot: '#22d3ee' },
    { id: 'eink-paper', name: '极简墨水屏', desc: '长篇护眼 · 纯净纸感', bg: '#f7f5ef', dot: '#3b3831' }
  ];

  const SKIN_ACCENT_SWATCHES = [
    { name: '樱粉', val: '#e2559d' },
    { name: '流金', val: '#e5c185' },
    { name: '鸢尾紫', val: '#8b5cf6' },
    { name: '霓虹青', val: '#22d3ee' },
    { name: '朱砂红', val: '#d96b52' },
    { name: '翡翠绿', val: '#10b981' },
    { name: '钴蓝', val: '#3b82f6' },
    { name: '琥珀', val: '#f59e0b' }
  ];

  const BUILTIN_WALLPAPERS = [
    { id: 'none', name: '无壁纸', type: 'none', val: '' },
    { id: 'aurora', name: '星夜极光', type: 'gradient', val: 'radial-gradient(circle at 20% 20%, rgba(139,92,246,0.45), transparent 55%), radial-gradient(circle at 80% 75%, rgba(34,211,238,0.35), transparent 55%), #0c1020' },
    { id: 'sakura', name: '樱雾暮云', type: 'gradient', val: 'linear-gradient(135deg, #fde2f3 0%, #e9d5ff 50%, #dbeafe 100%)' },
    { id: 'crimson', name: '朱墨残阳', type: 'gradient', val: 'radial-gradient(circle at 75% 25%, rgba(217,107,82,0.4), transparent 60%), linear-gradient(160deg, #1f1312 0%, #3a1c19 100%)' },
    { id: 'forest', name: '森屿晨曦', type: 'gradient', val: 'radial-gradient(circle at 30% 25%, rgba(16,185,129,0.35), transparent 60%), linear-gradient(135deg, #06281e 0%, #0f172a 100%)' },
    { id: 'gold', name: '碎金穹顶', type: 'gradient', val: 'radial-gradient(circle at 70% 20%, rgba(229,193,133,0.32), transparent 55%), linear-gradient(150deg, #0d0f14 0%, #1c1a17 100%)' },
    { id: 'mist', name: '雪霁青灰', type: 'gradient', val: 'linear-gradient(135deg, #f1f5f9 0%, #e2e8f0 50%, #ede9fe 100%)' }
  ];

  const DEFAULT_SKIN_CONFIG = {
    preset: 'default',
    accentColor: '',
    wallpaperType: 'none',
    wallpaperValue: '',
    scrimOpacity: 35,
    glassBlur: 16,
    bubbleStyle: 'soft',
    fontStyle: 'sans',
    fontScale: 100
  };

  let currentSkin = loadSkinFromStorage();
  let syncTimer = null;
  let mountedStudioRoot = null;

  function loadSkinFromStorage() {
    try {
      const raw = localStorage.getItem(SKIN_STORAGE_KEY);
      if (!raw) return { ...DEFAULT_SKIN_CONFIG };
      return Object.assign({}, DEFAULT_SKIN_CONFIG, JSON.parse(raw));
    } catch {
      return { ...DEFAULT_SKIN_CONFIG };
    }
  }

  function applySkin(configPatch, options = {}) {
    const { persist = true, syncServer = true } = options;
    currentSkin = Object.assign({}, DEFAULT_SKIN_CONFIG, currentSkin, configPatch || {});
    const root = document.documentElement;

    root.dataset.skin = currentSkin.preset || 'default';
    root.dataset.bubbleStyle = currentSkin.bubbleStyle || 'soft';
    root.dataset.fontStyle = currentSkin.fontStyle || 'sans';

    if (currentSkin.accentColor) {
      root.dataset.hasAccent = '1';
      root.style.setProperty('--skin-accent', currentSkin.accentColor);
    } else {
      delete root.dataset.hasAccent;
      root.style.removeProperty('--skin-accent');
    }

    if (currentSkin.wallpaperType === 'image' && currentSkin.wallpaperValue) {
      root.dataset.hasWallpaper = '1';
      root.style.setProperty('--skin-wallpaper-bg', `url("${currentSkin.wallpaperValue.replace(/"/g, '%22')}")`);
    } else if (currentSkin.wallpaperType === 'gradient' && currentSkin.wallpaperValue) {
      root.dataset.hasWallpaper = '1';
      root.style.setProperty('--skin-wallpaper-bg', currentSkin.wallpaperValue);
    } else {
      delete root.dataset.hasWallpaper;
      root.style.setProperty('--skin-wallpaper-bg', 'none');
    }

    root.style.setProperty('--skin-scrim-opacity', String((Number(currentSkin.scrimOpacity) || 0) / 100));
    root.style.setProperty('--skin-glass-blur', `${Number(currentSkin.glassBlur) || 0}px`);
    root.style.setProperty('--skin-font-scale', String((Number(currentSkin.fontScale) || 100) / 100));

    // 若切回 default，恢复原本的明暗 scheme
    if (currentSkin.preset === 'default') {
      try {
        const savedScheme = localStorage.getItem('color-scheme') ?? 'light dark';
        root.style.colorScheme = savedScheme;
      } catch {}
    }

    if (persist) {
      try {
        localStorage.setItem(SKIN_STORAGE_KEY, JSON.stringify(currentSkin));
      } catch {}
    }

    if (syncServer) {
      clearTimeout(syncTimer);
      syncTimer = setTimeout(() => {
        fetch('/api/appearance/skin', {
          method: 'PUT',
          headers: getAuthHeaders(),
          credentials: 'include',
          body: JSON.stringify(currentSkin)
        }).catch(() => {});
      }, 500);
    }

    if (mountedStudioRoot) {
      updateStudioPreviewAndStates(mountedStudioRoot);
    }
  }

  function extractAccentFromImageSrc(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = 24;
          canvas.height = 24;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, 24, 24);
          const data = ctx.getImageData(0, 0, 24, 24).data;
          let r = 0, g = 0, b = 0, count = 0;
          for (let i = 0; i < data.length; i += 4) {
            const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
            if (lum > 35 && lum < 225) {
              r += data[i];
              g += data[i + 1];
              b += data[i + 2];
              count += 1;
            }
          }
          if (!count) return resolve('#e2559d');
          const toHex = (n) => Math.min(255, Math.max(0, Math.round(n / count))).toString(16).padStart(2, '0');
          resolve(`#${toHex(r)}${toHex(g)}${toHex(b)}`);
        } catch {
          resolve('#e2559d');
        }
      };
      img.onerror = () => resolve('#e2559d');
      img.src = src;
    });
  }

  function updateStudioPreviewAndStates(root) {
    const bgEl = root.querySelector('.skin-preview-bg');
    const scrimEl = root.querySelector('.skin-preview-scrim');
    if (bgEl) {
      if (currentSkin.wallpaperType === 'image' && currentSkin.wallpaperValue) {
        bgEl.style.backgroundImage = `url("${currentSkin.wallpaperValue}")`;
        bgEl.style.background = `url("${currentSkin.wallpaperValue}") center/cover no-repeat`;
      } else if (currentSkin.wallpaperType === 'gradient' && currentSkin.wallpaperValue) {
        bgEl.style.background = currentSkin.wallpaperValue;
      } else {
        bgEl.style.background = 'none';
      }
    }
    if (scrimEl) {
      scrimEl.style.background = currentSkin.wallpaperType !== 'none'
        ? `rgba(10, 11, 18, ${(Number(currentSkin.scrimOpacity) || 0) / 100})`
        : 'transparent';
    }
    root.querySelectorAll('.skin-preset-card').forEach((card) => {
      card.classList.toggle('active', card.dataset.preset === currentSkin.preset);
    });
    root.querySelectorAll('.skin-color-dot').forEach((dot) => {
      dot.classList.toggle('active', dot.dataset.color === currentSkin.accentColor);
    });
    root.querySelectorAll('.skin-pill-btn[data-bubble]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.bubble === currentSkin.bubbleStyle);
    });
    root.querySelectorAll('.skin-pill-btn[data-font]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.font === currentSkin.fontStyle);
    });
    const colorInput = root.querySelector('#skin-custom-color-inp');
    if (colorInput && currentSkin.accentColor) colorInput.value = currentSkin.accentColor;
    const scrimVal = root.querySelector('#skin-scrim-val');
    if (scrimVal) scrimVal.textContent = `${currentSkin.scrimOpacity}%`;
    const blurVal = root.querySelector('#skin-blur-val');
    if (blurVal) blurVal.textContent = `${currentSkin.glassBlur}px`;
    const scaleVal = root.querySelector('#skin-scale-val');
    if (scaleVal) scaleVal.textContent = `${currentSkin.fontScale}%`;
  }

  function initSkinStudio(containerId) {
    const container = typeof containerId === 'string' ? document.getElementById(containerId) : containerId;
    if (!container) return;
    mountedStudioRoot = container;

    container.innerHTML = `
      <div class="skin-studio">
        <div class="skin-preview-stage" aria-label="皮肤实时效果预览">
          <div class="skin-preview-bg"></div>
          <div class="skin-preview-scrim"></div>
          <div class="skin-preview-msg ai">「今夜星光很柔和，要不要换一身喜欢的剧场皮肤再继续写我们的故事？」</div>
          <div class="skin-preview-msg user">好呀，把氛围调成专属我们的样子吧 ✨</div>
        </div>

        <div>
          <div class="skin-section-head">
            <span>精选免费皮肤预设</span>
            <span class="skin-free-tag">全部免费开放</span>
          </div>
          <div class="skin-preset-grid">
            ${SKIN_PRESETS.map((p) => `
              <button type="button" class="skin-preset-card" data-preset="${p.id}">
                <div class="skin-swatch-bar" style="background:${p.bg};">
                  <span class="skin-swatch-dot" style="background:${p.dot};"></span>
                </div>
                <span class="skin-preset-name">${p.name}</span>
                <span class="skin-preset-desc">${p.desc}</span>
              </button>
            `).join('')}
          </div>
        </div>

        <div>
          <div class="skin-section-head">
            <span>主强调色（Accent）</span>
            <button type="button" class="skin-pill-btn" id="skin-reset-accent-btn">跟随皮肤默认</button>
          </div>
          <div class="skin-accent-row">
            ${SKIN_ACCENT_SWATCHES.map((c) => `
              <button type="button" class="skin-color-dot" data-color="${c.val}" title="${c.name}" style="background:${c.val};"></button>
            `).join('')}
            <label class="skin-color-picker-wrap">
              <input type="color" id="skin-custom-color-inp" value="${escapeHtml(currentSkin.accentColor || '#e2559d')}" />
              <span>自定义取色</span>
            </label>
          </div>
        </div>

        <div>
          <div class="skin-section-head">
            <span>剧场背景壁纸</span>
            <div style="display:flex;gap:6px;flex-wrap:wrap;">
              <input type="file" id="skin-wall-file-inp" accept="image/png,image/jpeg,image/webp" hidden />
              <button type="button" class="skin-pill-btn" id="skin-upload-wall-btn">上传本地壁纸</button>
              <button type="button" class="skin-pill-btn" id="skin-extract-accent-btn">从壁纸取色</button>
            </div>
          </div>
          <div class="skin-wallpaper-grid">
            ${BUILTIN_WALLPAPERS.map((w) => `
              <button type="button" class="skin-wall-btn" data-wid="${w.id}" style="${w.type === 'gradient' ? `background:${w.val};` : ''}">
                <span>${w.name}</span>
              </button>
            `).join('')}
          </div>
        </div>

        <div class="skin-sliders-grid">
          <div class="skin-slider-item">
            <label for="skin-scrim-range"><span>背景暗角遮罩</span><strong id="skin-scrim-val">${currentSkin.scrimOpacity}%</strong></label>
            <input type="range" id="skin-scrim-range" min="0" max="85" step="5" value="${currentSkin.scrimOpacity}" />
          </div>
          <div class="skin-slider-item">
            <label for="skin-blur-range"><span>毛玻璃模糊度</span><strong id="skin-blur-val">${currentSkin.glassBlur}px</strong></label>
            <input type="range" id="skin-blur-range" min="0" max="28" step="2" value="${currentSkin.glassBlur}" />
          </div>
          <div class="skin-slider-item">
            <label for="skin-scale-range"><span>正文字号缩放</span><strong id="skin-scale-val">${currentSkin.fontScale}%</strong></label>
            <input type="range" id="skin-scale-range" min="90" max="115" step="5" value="${currentSkin.fontScale}" />
          </div>
        </div>

        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;">
          <div>
            <div class="skin-section-head"><span>聊天气泡风格</span></div>
            <div class="skin-pills-row">
              <button type="button" class="skin-pill-btn" data-bubble="soft">柔光圆润</button>
              <button type="button" class="skin-pill-btn" data-bubble="im-bubble">逐句分段</button>
              <button type="button" class="skin-pill-btn" data-bubble="glass">玻璃拟态</button>
              <button type="button" class="skin-pill-btn" data-bubble="outline">极简细框</button>
              <button type="button" class="skin-pill-btn" data-bubble="letter">复古信纸</button>
            </div>
          </div>
          <div>
            <div class="skin-section-head"><span>正文排版字体</span></div>
            <div class="skin-pills-row">
              <button type="button" class="skin-pill-btn" data-font="sans">现代无衬线</button>
              <button type="button" class="skin-pill-btn" data-font="serif">典雅书卷衬线</button>
              <button type="button" class="skin-pill-btn" data-font="rounded">柔和圆润体</button>
            </div>
          </div>
        </div>

        <div class="skin-tools-bar">
          <button type="button" class="secondary-btn" id="skin-export-json-btn">导出皮肤分享码</button>
          <button type="button" class="secondary-btn" id="skin-import-json-btn">导入皮肤分享码</button>
          <button type="button" class="secondary-btn" id="skin-reset-all-btn">恢复出厂默认</button>
        </div>
      </div>
    `;

    // 绑定事件
    container.querySelectorAll('.skin-preset-card').forEach((card) => {
      card.addEventListener('click', () => {
        applySkin({ preset: card.dataset.preset });
      });
    });

    container.querySelectorAll('.skin-color-dot').forEach((dot) => {
      dot.addEventListener('click', () => {
        applySkin({ accentColor: dot.dataset.color });
      });
    });

    container.querySelector('#skin-custom-color-inp')?.addEventListener('input', (e) => {
      applySkin({ accentColor: e.target.value });
    });

    container.querySelector('#skin-reset-accent-btn')?.addEventListener('click', () => {
      applySkin({ accentColor: '' });
    });

    container.querySelectorAll('.skin-wall-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const w = BUILTIN_WALLPAPERS.find((x) => x.id === btn.dataset.wid);
        if (!w) return;
        applySkin({ wallpaperType: w.type, wallpaperValue: w.val });
      });
    });

    const wallInp = container.querySelector('#skin-wall-file-inp');
    container.querySelector('#skin-upload-wall-btn')?.addEventListener('click', () => wallInp?.click());
    wallInp?.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = async () => {
          const maxEdge = 1600;
          const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
          const c = document.createElement('canvas');
          c.width = Math.max(1, Math.round(img.width * scale));
          c.height = Math.max(1, Math.round(img.height * scale));
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          let dataUrl = c.toDataURL('image/webp', 0.84);
          if (!dataUrl.startsWith('data:image/webp')) dataUrl = c.toDataURL('image/jpeg', 0.84);
          let finalUrl = dataUrl;
          try {
            const resp = await fetch('/api/appearance/upload', {
              method: 'POST',
              headers: getAuthHeaders(),
              credentials: 'include',
              body: JSON.stringify({ category: 'wallpapers', dataUrl })
            });
            const data = await resp.json();
            if (resp.ok && data?.url) finalUrl = data.url;
          } catch {}
          applySkin({ wallpaperType: 'image', wallpaperValue: finalUrl });
          notify('剧场壁纸已应用');
        };
        img.src = String(reader.result || '');
      };
      reader.readAsDataURL(file);
    });

    container.querySelector('#skin-extract-accent-btn')?.addEventListener('click', async () => {
      if (currentSkin.wallpaperType === 'image' && currentSkin.wallpaperValue) {
        const color = await extractAccentFromImageSrc(currentSkin.wallpaperValue);
        applySkin({ accentColor: color });
        notify(`已从壁纸提取主色调 ${color}`);
      } else {
        notify('请先上传图片壁纸，再点击“从壁纸取色”');
      }
    });

    container.querySelector('#skin-scrim-range')?.addEventListener('input', (e) => {
      applySkin({ scrimOpacity: Number(e.target.value) });
    });
    container.querySelector('#skin-blur-range')?.addEventListener('input', (e) => {
      applySkin({ glassBlur: Number(e.target.value) });
    });
    container.querySelector('#skin-scale-range')?.addEventListener('input', (e) => {
      applySkin({ fontScale: Number(e.target.value) });
    });

    container.querySelectorAll('.skin-pill-btn[data-bubble]').forEach((btn) => {
      btn.addEventListener('click', () => applySkin({ bubbleStyle: btn.dataset.bubble }));
    });
    container.querySelectorAll('.skin-pill-btn[data-font]').forEach((btn) => {
      btn.addEventListener('click', () => applySkin({ fontStyle: btn.dataset.font }));
    });

    container.querySelector('#skin-export-json-btn')?.addEventListener('click', async () => {
      const text = JSON.stringify(currentSkin);
      try {
        await navigator.clipboard.writeText(text);
        notify('皮肤分享码（JSON）已复制到剪贴板！');
      } catch {
        window.prompt('请复制下方皮肤分享码：', text);
      }
    });

    container.querySelector('#skin-import-json-btn')?.addEventListener('click', () => {
      const raw = window.prompt('请粘贴皮肤分享码（JSON）：');
      if (!raw) return;
      try {
        const parsed = JSON.parse(raw.trim());
        if (!parsed || typeof parsed !== 'object') throw new Error('格式无效');
        applySkin(parsed);
        notify('皮肤分享码导入并应用成功！');
      } catch {
        notify('导入失败：分享码格式不正确');
      }
    });

    container.querySelector('#skin-reset-all-btn')?.addEventListener('click', () => {
      applySkin({ ...DEFAULT_SKIN_CONFIG });
      notify('已恢复出厂默认皮肤设置');
    });

    updateStudioPreviewAndStates(container);
  }

  function syncFromServer(serverSkinConfig) {
    if (serverSkinConfig && typeof serverSkinConfig === 'object') {
      applySkin(serverSkinConfig, { persist: true, syncServer: false });
    }
  }

  // 启动即应用本地缓存皮肤
  applySkin(currentSkin, { persist: false, syncServer: false });

  window.AppearanceSystem = {
    renderSmartAvatarHtml,
    openAvatarStudio,
    initSkinStudio,
    applySkin,
    syncFromServer,
    getCurrentSkin: () => ({ ...currentSkin })
  };
})();

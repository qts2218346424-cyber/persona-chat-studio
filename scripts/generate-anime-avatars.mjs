import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '..', 'public', 'assets', 'avatars');
fs.mkdirSync(OUT_DIR, { recursive: true });

// 21 位角色高美感二次元动漫胸像 SVG 配置表（保留 shenxinghui.jpg / luchen.jpg / suwanqing.jpg 为 AI 真实插画）
const AVATAR_SPECS = [
  {
    key: 'xieqingyan',
    bg: ['#1b1e2e', '#3a2c44', '#5c3c4c'],
    particles: 'plum',
    skin: '#fff1eb',
    hair: '#1f2233',
    hairHi: '#4a5070',
    hairStyle: 'ancient_crown',
    eyes: '#3b4a6b',
    eyeStyle: 'gentle',
    blush: 0.25,
    mouth: 'smirk',
    outfit: 'fur_robe',
    outfitColor: '#f8fafc',
    outfitAccent: '#991b1b',
    acc: 'fan'
  },
  {
    key: 'jiangyubai',
    bg: ['#0f1c2e', '#1e3a5f', '#4f7ca8'],
    particles: 'snow',
    skin: '#fef5f1',
    hair: '#e6eef8',
    hairHi: '#ffffff',
    hairStyle: 'long_straight_male',
    eyes: '#38bdf8',
    eyeStyle: 'cool',
    blush: 0.1,
    mouth: 'calm',
    outfit: 'immortal_robe',
    outfitColor: '#f1f5f9',
    outfitAccent: '#60a5fa',
    acc: 'forehead_mark'
  },
  {
    key: 'jiran',
    bg: ['#18182b', '#2e1f4d', '#ec4899'],
    particles: 'spark',
    skin: '#ffe8dc',
    hair: '#1f2937',
    hairHi: '#4b5563',
    hairStyle: 'spiky_boy',
    eyes: '#f59e0b',
    eyeStyle: 'sharp',
    blush: 0.35,
    mouth: 'grin',
    outfit: 'hoodie',
    outfitColor: '#1e1b4b',
    outfitAccent: '#f43f5e',
    acc: 'headset_neck'
  },
  {
    key: 'guxiuyuan',
    bg: ['#141824', '#262d3d', '#4b453c'],
    particles: 'gold',
    skin: '#fde6d8',
    hair: '#242936',
    hairHi: '#475066',
    hairStyle: 'slick_gentleman',
    eyes: '#64748b',
    eyeStyle: 'calm_sharp',
    blush: 0.12,
    mouth: 'gentle_smile',
    outfit: 'suit',
    outfitColor: '#334155',
    outfitAccent: '#d4af37',
    acc: 'loose_tie'
  },
  {
    key: 'yunzhiyao',
    bg: ['#0d1729', '#1e3252', '#7093bd'],
    particles: 'moon_snow',
    skin: '#fff2ec',
    hair: '#171c2b',
    hairHi: '#3d486b',
    hairStyle: 'ancient_maiden',
    eyes: '#818cf8',
    eyeStyle: 'cool_beauty',
    blush: 0.2,
    mouth: 'calm',
    outfit: 'immortal_dress',
    outfitColor: '#f8fafc',
    outfitAccent: '#93c5fd',
    acc: 'hairpin_moon'
  },
  {
    key: 'xia_ningmeng',
    bg: ['#fff0f6', '#ffd6e7', '#fbcfe8'],
    particles: 'sakura',
    skin: '#fff0e6',
    hair: '#f7a8c4',
    hairHi: '#ffd6e8',
    hairStyle: 'twintails',
    eyes: '#ec4899',
    eyeStyle: 'sparkle',
    blush: 0.55,
    mouth: 'happy_open',
    outfit: 'knit',
    outfitColor: '#fffbeb',
    outfitAccent: '#fb7185',
    acc: 'strawberry_clip'
  },
  {
    key: 'yan_feiyu',
    bg: ['#260a14', '#591127', '#9f1239'],
    particles: 'rose',
    skin: '#ffece5',
    hair: '#1a121b',
    hairHi: '#4c1d3d',
    hairStyle: 'wavy_glam',
    eyes: '#e11d48',
    eyeStyle: 'fox',
    blush: 0.4,
    mouth: 'smirk',
    outfit: 'velvet_dress',
    outfitColor: '#881337',
    outfitAccent: '#fbbf24',
    acc: 'tear_mole'
  },
  {
    key: 'nagisa_sakura',
    bg: ['#fff1f2', '#ffe4e6', '#fecdd3'],
    particles: 'sakura',
    skin: '#ffefe6',
    hair: '#8d5b4c',
    hairHi: '#b88270',
    hairStyle: 'bob_ahoge',
    eyes: '#d97706',
    eyeStyle: 'gentle_big',
    blush: 0.5,
    mouth: 'gentle_smile',
    outfit: 'sailor_uniform',
    outfitColor: '#f8fafc',
    outfitAccent: '#1e3a8a',
    acc: 'ahoge_double'
  },
  {
    key: 'kagaribi_kyou',
    bg: ['#2e1065', '#6b21a8', '#c084fc'],
    particles: 'spark',
    skin: '#ffece2',
    hair: '#7e22ce',
    hairHi: '#c084fc',
    hairStyle: 'long_ribbon',
    eyes: '#a855f7',
    eyeStyle: 'confident',
    blush: 0.4,
    mouth: 'smirk',
    outfit: 'blazer_uniform',
    outfitColor: '#1e293b',
    outfitAccent: '#f43f5e',
    acc: 'side_ribbon'
  },
  {
    key: 'ichinose_kotomi',
    bg: ['#eef2ff', '#ddd6fe', '#c4b5fd'],
    particles: 'dust_light',
    skin: '#fff3ed',
    hair: '#d8dee9',
    hairHi: '#ffffff',
    hairStyle: 'long_hime',
    eyes: '#7c3aed',
    eyeStyle: 'innocent',
    blush: 0.35,
    mouth: 'tiny_o',
    outfit: 'school_sweater',
    outfitColor: '#4c1d95',
    outfitAccent: '#ddd6fe',
    acc: 'book_hairclip'
  },
  {
    key: 'shiraishi_rin',
    bg: ['#0c4a6e', '#0284c7', '#7dd3fc'],
    particles: 'spark',
    skin: '#ffe9dc',
    hair: '#1e293b',
    hairHi: '#475569',
    hairStyle: 'messy_boy',
    eyes: '#0ea5e9',
    eyeStyle: 'sharp',
    blush: 0.15,
    mouth: 'smirk',
    outfit: 'lab_coat',
    outfitColor: '#f8fafc',
    outfitAccent: '#334155',
    acc: 'goggles'
  },
  {
    key: 'makise_sei',
    bg: ['#3b0a18', '#7f1d1d', '#dc2626'],
    particles: 'spark',
    skin: '#fff0e8',
    hair: '#991b1b',
    hairHi: '#ef4444',
    hairStyle: 'long_straight_girl',
    eyes: '#3b82f6',
    eyeStyle: 'confident',
    blush: 0.45,
    mouth: 'tsundere',
    outfit: 'shirt_tie',
    outfitColor: '#ffffff',
    outfitAccent: '#991b1b',
    acc: 'loose_tie'
  },
  {
    key: 'asagiri_mio',
    bg: ['#1e1b4b', '#312e81', '#fbbf24'],
    particles: 'lantern',
    skin: '#ffefe8',
    hair: '#1e1b2e',
    hairHi: '#3f3b5c',
    hairStyle: 'hime_bangs',
    eyes: '#4f46e5',
    eyeStyle: 'gentle_big',
    blush: 0.4,
    mouth: 'gentle_smile',
    outfit: 'miko',
    outfitColor: '#ffffff',
    outfitAccent: '#dc2626',
    acc: 'wind_chime'
  },
  {
    key: 'violet_eve',
    bg: ['#134e4a', '#0f766e', '#99f6e4'],
    particles: 'gold',
    skin: '#fff2ea',
    hair: '#facc15',
    hairHi: '#fef08a',
    hairStyle: 'braid_updo',
    eyes: '#0284c7',
    eyeStyle: 'gentle',
    blush: 0.25,
    mouth: 'calm',
    outfit: 'victorian',
    outfitColor: '#1e3a8a',
    outfitAccent: '#10b981',
    acc: 'red_ribbon'
  },
  {
    key: 'hodgins_landon',
    bg: ['#291810', '#5c3322', '#b45309'],
    particles: 'gold',
    skin: '#f9dfd0',
    hair: '#9a3412',
    hairHi: '#ea580c',
    hairStyle: 'wavy_gentleman',
    eyes: '#d97706',
    eyeStyle: 'gentle',
    blush: 0.15,
    mouth: 'gentle_smile',
    outfit: 'vest_suit',
    outfitColor: '#475569',
    outfitAccent: '#991b1b',
    acc: 'none'
  },
  {
    key: 'frieren_shuer',
    bg: ['#064e3b', '#059669', '#a7f3d0'],
    particles: 'leaf',
    skin: '#fff3ec',
    hair: '#e2e8f0',
    hairHi: '#ffffff',
    hairStyle: 'elf_messy',
    eyes: '#10b981',
    eyeStyle: 'calm',
    blush: 0.2,
    mouth: 'calm',
    outfit: 'mage_cape',
    outfitColor: '#f8fafc',
    outfitAccent: '#d97706',
    acc: 'elf_ears'
  },
  {
    key: 'stark_fer',
    bg: ['#450a0a', '#991b1b', '#f97316'],
    particles: 'spark',
    skin: '#ffe8da',
    hair: '#dc2626',
    hairHi: '#f87171',
    hairStyle: 'spiky_boy',
    eyes: '#ea580c',
    eyeStyle: 'gentle_big',
    blush: 0.35,
    mouth: 'happy_open',
    outfit: 'warrior_coat',
    outfitColor: '#1e293b',
    outfitAccent: '#b91c1c',
    acc: 'none'
  },
  {
    key: 'char_linzhi',
    bg: ['#fef3c7', '#fde68a', '#fb923c'],
    particles: 'dust_light',
    skin: '#ffefe5',
    hair: '#92400e',
    hairHi: '#d97706',
    hairStyle: 'wavy_bob',
    eyes: '#b45309',
    eyeStyle: 'sparkle',
    blush: 0.45,
    mouth: 'smirk',
    outfit: 'hoodie',
    outfitColor: '#fffbeb',
    outfitAccent: '#f97316',
    acc: 'pencil_clip'
  },
  {
    key: 'char_chenmo',
    bg: ['#1e293b', '#334155', '#fbbf24'],
    particles: 'lantern',
    skin: '#fde8db',
    hair: '#1e293b',
    hairHi: '#475569',
    hairStyle: 'neat_boy',
    eyes: '#475569',
    eyeStyle: 'gentle',
    blush: 0.2,
    mouth: 'gentle_smile',
    outfit: 'knit',
    outfitColor: '#e7e5e4',
    outfitAccent: '#78716c',
    acc: 'glasses'
  },
  {
    key: 'char_shiyu',
    bg: ['#e0f2fe', '#bae6fd', '#f5d0fe'],
    particles: 'dust_light',
    skin: '#fff1e8',
    hair: '#1f2937',
    hairHi: '#4b5563',
    hairStyle: 'long_straight_girl',
    eyes: '#3b82f6',
    eyeStyle: 'gentle_big',
    blush: 0.45,
    mouth: 'gentle_smile',
    outfit: 'knit',
    outfitColor: '#eff6ff',
    outfitAccent: '#60a5fa',
    acc: 'earbuds'
  },
  {
    key: 'char_zhouyan',
    bg: ['#0f172a', '#1e293b', '#38bdf8'],
    particles: 'spark',
    skin: '#ffe8da',
    hair: '#18181b',
    hairHi: '#3f3f46',
    hairStyle: 'spiky_boy',
    eyes: '#0284c7',
    eyeStyle: 'confident',
    blush: 0.25,
    mouth: 'grin',
    outfit: 'hoodie',
    outfitColor: '#18181b',
    outfitAccent: '#38bdf8',
    acc: 'none'
  }
];

function renderParticles(type) {
  if (type === 'sakura') {
    return `
      <g opacity="0.72" fill="#fff">
        <ellipse cx="42" cy="52" rx="6" ry="3.2" transform="rotate(-25 42 52)" fill="#fbcfe8"/>
        <ellipse cx="212" cy="64" rx="5.5" ry="2.8" transform="rotate(35 212 64)" fill="#f9a8d4"/>
        <ellipse cx="56" cy="190" rx="5" ry="2.5" transform="rotate(18 56 190)" fill="#fce7f3"/>
        <ellipse cx="218" cy="175" rx="6" ry="3" transform="rotate(-40 218 175)" fill="#fbcfe8"/>
      </g>`;
  }
  if (type === 'snow' || type === 'moon_snow') {
    return `
      <g fill="#ffffff" opacity="0.75">
        ${type === 'moon_snow' ? '<circle cx="204" cy="48" r="22" fill="#fef9c3" opacity="0.32"/>' : ''}
        <circle cx="38" cy="48" r="3"/><circle cx="214" cy="72" r="2.5"/>
        <circle cx="54" cy="145" r="2"/><circle cx="222" cy="156" r="3.2"/>
        <circle cx="76" cy="36" r="1.8"/><circle cx="192" cy="196" r="2.2"/>
      </g>`;
  }
  if (type === 'plum' || type === 'rose') {
    return `
      <g opacity="0.7">
        <circle cx="44" cy="56" r="4" fill="#fda4af"/><circle cx="212" cy="68" r="3.5" fill="#fb7185"/>
        <circle cx="38" cy="178" r="3" fill="#fecdd3"/><circle cx="220" cy="166" r="4.5" fill="#f43f5e"/>
      </g>`;
  }
  if (type === 'leaf') {
    return `
      <g opacity="0.7" fill="#a7f3d0">
        <ellipse cx="44" cy="62" rx="7" ry="3" transform="rotate(-30 44 62)"/>
        <ellipse cx="212" cy="74" rx="6" ry="2.6" transform="rotate(35 212 74)"/>
        <ellipse cx="204" cy="182" rx="5.5" ry="2.4" transform="rotate(-20 204 182)"/>
      </g>`;
  }
  if (type === 'gold' || type === 'lantern' || type === 'spark') {
    return `
      <g fill="#fef08a" opacity="0.72">
        <circle cx="42" cy="54" r="2.6"/><circle cx="214" cy="58" r="3.2"/>
        <circle cx="36" cy="168" r="2"/><circle cx="220" cy="152" r="2.4"/>
        <path d="M198 38 L201 44 L207 47 L201 50 L198 56 L195 50 L189 47 L195 44 Z" opacity="0.85"/>
      </g>`;
  }
  return `
    <g fill="#ffffff" opacity="0.45">
      <circle cx="48" cy="52" r="8"/><circle cx="208" cy="66" r="11"/><circle cx="218" cy="172" r="6"/>
    </g>`;
}

function renderBackHair(spec) {
  const { hair, hairHi, hairStyle } = spec;
  if (['long_straight_girl', 'long_hime', 'ancient_maiden', 'hime_bangs'].includes(hairStyle)) {
    return `
      <path d="M58 95 C46 142 42 204 48 256 L208 256 C214 204 210 142 198 95 C185 45 71 45 58 95 Z" fill="${hair}"/>
      <path d="M68 106 C60 148 56 205 60 245" stroke="${hairHi}" stroke-width="5" stroke-linecap="round" fill="none" opacity="0.38"/>`;
  }
  if (hairStyle === 'wavy_glam') {
    return `
      <path d="M54 92 C36 135 58 175 40 218 C32 238 42 256 48 256 L208 256 C214 256 224 238 216 218 C198 175 220 135 202 92 C188 45 68 45 54 92 Z" fill="${hair}"/>`;
  }
  if (hairStyle === 'twintails') {
    return `
      <path d="M56 96 C26 118 22 178 36 232 C42 246 56 238 56 216 C56 178 62 142 74 114 Z" fill="${hair}"/>
      <path d="M200 96 C230 118 234 178 220 232 C214 246 200 238 200 216 C200 178 194 142 182 114 Z" fill="${hair}"/>
      <circle cx="62" cy="98" r="8" fill="#fb7185"/><circle cx="194" cy="98" r="8" fill="#fb7185"/>`;
  }
  if (hairStyle === 'long_ribbon') {
    return `
      <path d="M56 94 C44 148 42 208 50 256 L206 256 C214 208 212 148 200 94 C186 44 70 44 56 94 Z" fill="${hair}"/>
      <path d="M180 74 L216 62 L208 86 Z" fill="#f43f5e"/><path d="M180 74 L204 98 L190 104 Z" fill="#e11d48"/>`;
  }
  if (hairStyle === 'bob_ahoge' || hairStyle === 'wavy_bob') {
    return `
      <path d="M62 96 C50 138 52 184 68 204 L188 204 C204 184 206 138 194 96 C180 46 76 46 62 96 Z" fill="${hair}"/>`;
  }
  if (hairStyle === 'long_straight_male' || hairStyle === 'ancient_crown' || hairStyle === 'elf_messy') {
    return `
      <path d="M64 96 C54 142 54 198 62 246 L194 246 C202 198 202 142 192 96 C178 46 78 46 64 96 Z" fill="${hair}"/>`;
  }
  return `
    <path d="M64 96 C58 134 64 170 76 188 L180 188 C192 170 198 134 192 96 C180 46 76 46 64 96 Z" fill="${hair}"/>`;
}

function renderFrontHair(spec) {
  const { hair, hairHi, hairStyle } = spec;
  const baseDome = `<path d="M62 104 C62 50 194 50 194 104 C194 74 166 56 128 56 C90 56 62 74 62 104 Z" fill="${hair}"/>`;
  const hiArc = `<path d="M84 78 Q128 64 172 78" stroke="${hairHi}" stroke-width="5" stroke-linecap="round" fill="none" opacity="0.45"/>`;

  if (hairStyle === 'spiky_boy' || hairStyle === 'messy_boy') {
    return `
      ${baseDome}
      <path d="M62 108 L74 72 L90 104 L106 66 L122 102 L140 66 L156 104 L174 70 L194 108 C184 54 72 54 62 108 Z" fill="${hair}"/>
      <path d="M62 100 C56 124 62 146 74 156 L78 118 Z" fill="${hair}"/>
      <path d="M194 100 C200 124 194 146 182 156 L178 118 Z" fill="${hair}"/>
      ${hiArc}`;
  }
  if (hairStyle === 'slick_gentleman' || hairStyle === 'neat_boy') {
    return `
      ${baseDome}
      <path d="M66 106 C76 74 112 66 128 84 C144 64 180 72 190 106 C186 58 70 58 66 106 Z" fill="${hair}"/>
      <path d="M66 102 L76 140 L82 110 Z" fill="${hair}"/>
      <path d="M190 102 L180 140 L174 110 Z" fill="${hair}"/>
      ${hiArc}`;
  }
  if (hairStyle === 'ancient_crown' || hairStyle === 'braid_updo') {
    return `
      ${baseDome}
      <path d="M108 54 C112 34 144 34 148 54 Z" fill="${hair}"/>
      ${hairStyle === 'ancient_crown' ? '<rect x="115" y="40" width="26" height="10" rx="4" fill="#e2e8f0" stroke="#94a3b8" stroke-width="1.5"/>' : ''}
      <path d="M64 108 C78 82 106 78 128 102 C150 78 178 82 192 108 C182 58 74 58 64 108 Z" fill="${hair}"/>
      <path d="M66 104 C62 138 68 168 78 180 L84 124 Z" fill="${hair}"/>
      <path d="M190 104 C194 138 188 168 178 180 L172 124 Z" fill="${hair}"/>
      ${hiArc}`;
  }
  return `
    ${baseDome}
    <path d="M64 110 C72 80 94 74 104 106 C114 78 138 78 148 106 C158 74 184 80 192 110 C186 56 70 56 64 110 Z" fill="${hair}"/>
    <path d="M64 102 C58 134 62 162 74 176 L80 124 Z" fill="${hair}"/>
    <path d="M192 102 C198 134 194 162 182 176 L176 124 Z" fill="${hair}"/>
    ${hiArc}`;
}

function renderEyes(spec) {
  const { eyes, eyeStyle, hair } = spec;
  const isSharp = ['sharp', 'fox', 'cool', 'confident', 'calm_sharp'].includes(eyeStyle);
  const ry = isSharp ? 11 : 13.5;
  const rx = isSharp ? 10 : 10.5;
  const browOffset = isSharp ? -3 : 0;

  return `
    <g>
      <!-- 眉毛 -->
      <path d="M84 ${114 + browOffset} Q98 ${108 + browOffset} 112 114" stroke="${hair}" stroke-width="2.8" stroke-linecap="round" fill="none" opacity="0.88"/>
      <path d="M144 114 Q158 ${108 + browOffset} 172 ${114 + browOffset}" stroke="${hair}" stroke-width="2.8" stroke-linecap="round" fill="none" opacity="0.88"/>

      <!-- 左眼 -->
      <ellipse cx="99" cy="131" rx="${rx + 1.5}" ry="${ry}" fill="#ffffff"/>
      <ellipse cx="99" cy="131.5" rx="${rx - 1.2}" ry="${ry - 1.8}" fill="${eyes}"/>
      <ellipse cx="99" cy="133" rx="${rx - 3.6}" ry="${ry - 4.5}" fill="#0f172a" opacity="0.72"/>
      <circle cx="95" cy="126" r="3.4" fill="#ffffff"/>
      <circle cx="103" cy="136" r="1.8" fill="#ffffff" opacity="0.88"/>
      <path d="M86 ${isSharp ? 124 : 122} Q99 ${isSharp ? 118 : 115} 112 ${isSharp ? 125 : 123}" stroke="#1e1b2e" stroke-width="${isSharp ? 3.5 : 3.2}" stroke-linecap="round" fill="none"/>

      <!-- 右眼 -->
      <ellipse cx="157" cy="131" rx="${rx + 1.5}" ry="${ry}" fill="#ffffff"/>
      <ellipse cx="157" cy="131.5" rx="${rx - 1.2}" ry="${ry - 1.8}" fill="${eyes}"/>
      <ellipse cx="157" cy="133" rx="${rx - 3.6}" ry="${ry - 4.5}" fill="#0f172a" opacity="0.72"/>
      <circle cx="153" cy="126" r="3.4" fill="#ffffff"/>
      <circle cx="161" cy="136" r="1.8" fill="#ffffff" opacity="0.88"/>
      <path d="M144 ${isSharp ? 125 : 123} Q157 ${isSharp ? 118 : 115} 170 ${isSharp ? 124 : 122}" stroke="#1e1b2e" stroke-width="${isSharp ? 3.5 : 3.2}" stroke-linecap="round" fill="none"/>
    </g>`;
}

function renderMouth(type) {
  if (type === 'happy_open' || type === 'grin') {
    return `<path d="M119 160 Q128 169 137 160 Z" fill="#fb7185" stroke="#be123c" stroke-width="1.6" stroke-linejoin="round"/>`;
  }
  if (type === 'tiny_o') {
    return `<ellipse cx="128" cy="162" rx="3.2" ry="4" fill="#fda4af" stroke="#be123c" stroke-width="1.4"/>`;
  }
  if (type === 'smirk') {
    return `<path d="M120 162 Q130 165 138 158" stroke="#9f1239" stroke-width="2" stroke-linecap="round" fill="none"/>`;
  }
  if (type === 'tsundere') {
    return `<path d="M121 163 Q128 159 135 162" stroke="#9f1239" stroke-width="2" stroke-linecap="round" fill="none"/>`;
  }
  if (type === 'calm') {
    return `<path d="M121 162 Q128 163 135 162" stroke="#9f1239" stroke-width="1.8" stroke-linecap="round" fill="none"/>`;
  }
  return `<path d="M119 160 Q128 167 137 160" stroke="#9f1239" stroke-width="2" stroke-linecap="round" fill="none"/>`;
}

function renderOutfit(spec) {
  const { outfit, outfitColor, outfitAccent } = spec;
  if (outfit === 'suit' || outfit === 'vest_suit' || outfit === 'blazer_uniform' || outfit === 'shirt_tie' || outfit === 'lab_coat') {
    return `
      <path d="M48 256 C52 210 86 196 128 196 C170 196 204 210 208 256 Z" fill="${outfitColor}"/>
      <polygon points="104,196 128,242 152,196" fill="#ffffff"/>
      <polygon points="124,204 132,204 134,244 128,252 122,244" fill="${outfitAccent}"/>`;
  }
  if (outfit === 'fur_robe' || outfit === 'immortal_robe' || outfit === 'immortal_dress' || outfit === 'miko') {
    return `
      <path d="M46 256 C52 208 86 195 128 195 C170 195 204 208 210 256 Z" fill="${outfitColor}"/>
      <path d="M92 197 L128 248 L164 197" stroke="${outfitAccent}" stroke-width="8" stroke-linecap="round" fill="none"/>
      ${outfit === 'fur_robe' ? '<ellipse cx="128" cy="204" rx="52" ry="14" fill="#ffffff" opacity="0.92"/>' : ''}`;
  }
  if (outfit === 'sailor_uniform') {
    return `
      <path d="M48 256 C54 210 86 196 128 196 C170 196 202 210 208 256 Z" fill="${outfitColor}"/>
      <polygon points="88,198 128,236 168,198 158,228 128,246 98,228" fill="${outfitAccent}"/>
      <path d="M120 226 L128 242 L136 226 Z" fill="#f43f5e"/>`;
  }
  return `
    <path d="M48 256 C52 210 86 196 128 196 C170 196 204 210 208 256 Z" fill="${outfitColor}"/>
    <path d="M98 198 Q128 220 158 198" stroke="${outfitAccent}" stroke-width="5" stroke-linecap="round" fill="none"/>`;
}

function renderAccessory(spec) {
  const { acc, hair, skin } = spec;
  if (acc === 'glasses') {
    return `
      <g fill="none" stroke="#1e293b" stroke-width="2.6">
        <rect x="82" y="119" width="34" height="23" rx="6"/>
        <rect x="140" y="119" width="34" height="23" rx="6"/>
        <line x1="116" y1="129" x2="140" y2="129"/>
      </g>`;
  }
  if (acc === 'goggles') {
    return `
      <g>
        <rect x="78" y="64" width="44" height="22" rx="8" fill="#38bdf8" fill-opacity="0.45" stroke="#1e293b" stroke-width="3"/>
        <rect x="134" y="64" width="44" height="22" rx="8" fill="#38bdf8" fill-opacity="0.45" stroke="#1e293b" stroke-width="3"/>
        <line x1="122" y1="74" x2="134" y2="74" stroke="#1e293b" stroke-width="3.5"/>
      </g>`;
  }
  if (acc === 'headset_neck') {
    return `
      <g>
        <path d="M84 202 C84 234 172 234 172 202" stroke="#111827" stroke-width="7" fill="none"/>
        <rect x="76" y="196" width="14" height="24" rx="6" fill="#f43f5e"/>
        <rect x="166" y="196" width="14" height="24" rx="6" fill="#f43f5e"/>
      </g>`;
  }
  if (acc === 'earbuds') {
    return `
      <g fill="#ffffff" stroke="#94a3b8" stroke-width="1.2">
        <rect x="70" y="132" width="6" height="16" rx="3"/>
        <rect x="180" y="132" width="6" height="16" rx="3"/>
      </g>`;
  }
  if (acc === 'fan') {
    return `
      <g transform="translate(158 190) rotate(-14)">
        <path d="M0 44 L-26 6 A34 34 0 0 1 28 6 Z" fill="#fef3c7" stroke="#b45309" stroke-width="1.8"/>
        <line x1="0" y1="44" x2="0" y2="2" stroke="#b45309" stroke-width="1.2" opacity="0.6"/>
      </g>`;
  }
  if (acc === 'tear_mole') {
    return `<circle cx="164" cy="144" r="1.9" fill="#4c1d3d"/>`;
  }
  if (acc === 'ahoge_double') {
    return `<path d="M122 52 C112 24 134 20 128 50 C138 24 156 30 134 54" stroke="${hair}" stroke-width="4" stroke-linecap="round" fill="none"/>`;
  }
  if (acc === 'elf_ears') {
    return `
      <polygon points="73,128 46,118 72,146" fill="${skin}"/>
      <polygon points="183,128 210,118 184,146" fill="${skin}"/>`;
  }
  if (acc === 'hairpin_moon') {
    return `<path d="M174 84 A10 10 0 1 1 164 96 A7 7 0 1 0 174 84 Z" fill="#fef08a"/>`;
  }
  if (acc === 'strawberry_clip') {
    return `<circle cx="80" cy="96" r="6" fill="#fb7185"/><circle cx="80" cy="96" r="2.2" fill="#fef08a"/>`;
  }
  if (acc === 'red_ribbon') {
    return `<path d="M118 206 L128 218 L138 206 L138 222 L128 216 L118 222 Z" fill="#dc2626"/>`;
  }
  return '';
}

function buildAvatarSvg(spec) {
  const [c1, c2, c3] = spec.bg;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256">
  <defs>
    <linearGradient id="bg_${spec.key}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${c1}"/>
      <stop offset="52%" stop-color="${c2}"/>
      <stop offset="100%" stop-color="${c3}"/>
    </linearGradient>
    <radialGradient id="glow_${spec.key}" cx="50%" cy="42%" r="50%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.28"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="256" height="256" fill="url(#bg_${spec.key})"/>
  <circle cx="128" cy="112" r="108" fill="url(#glow_${spec.key})"/>
  ${renderParticles(spec.particles)}
  ${renderBackHair(spec)}
  ${renderOutfit(spec)}
  <!-- 颈部与阴影 -->
  <rect x="114" y="170" width="28" height="32" rx="10" fill="${spec.skin}"/>
  <path d="M114 176 Q128 190 142 176 L142 186 Q128 196 114 186 Z" fill="#000000" opacity="0.1"/>
  <!-- 耳朵（非精灵时） -->
  ${spec.acc === 'elf_ears' ? '' : `<ellipse cx="76" cy="134" rx="7" ry="11" fill="${spec.skin}"/><ellipse cx="180" cy="134" rx="7" ry="11" fill="${spec.skin}"/>`}
  <!-- 脸型 -->
  <path d="M77 104 C77 68 179 68 179 104 L179 134 C179 164 150 184 128 184 C106 184 77 164 77 134 Z" fill="${spec.skin}"/>
  <!-- 腮红 -->
  <ellipse cx="94" cy="147" rx="11" ry="5" fill="#fb7185" opacity="${spec.blush}"/>
  <ellipse cx="162" cy="147" rx="11" ry="5" fill="#fb7185" opacity="${spec.blush}"/>
  ${renderEyes(spec)}
  <!-- 鼻尖高光点 -->
  <path d="M127 146 Q129 149 127 151" stroke="#d4a395" stroke-width="1.6" stroke-linecap="round" fill="none"/>
  ${renderMouth(spec.mouth)}
  ${renderFrontHair(spec)}
  ${renderAccessory(spec)}
</svg>`;
}

for (const spec of AVATAR_SPECS) {
  const filePath = path.join(OUT_DIR, `${spec.key}.svg`);
  fs.writeFileSync(filePath, buildAvatarSvg(spec), 'utf8');
}
console.log(`已成功生成 ${AVATAR_SPECS.length} 张二次元定制矢量头像至 ${OUT_DIR}`);

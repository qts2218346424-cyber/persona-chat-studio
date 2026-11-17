/**
 * DeepSeek 官方正版大鲸鱼矢量转换器
 * 输出：
 * 1. Android Adaptive Icon 108dp 无损绝对坐标贝塞尔 VectorDrawable (ic_launcher_foreground.xml)
 * 2. 超采样多边形顶点 JSON 供 GDI+ 渲染全尺寸抗锯齿 PNG 桌面图标
 */
const fs = require('fs');
const path = require('path');

const RAW_WHALE_D =
  'M23.748 4.482c-.254-.124-.364.113-.512.234-.051.039-.094.09-.137.136-.372.397-.806.657-1.373.626-.829-.046-1.537.214-2.163.848-.133-.782-.575-1.248-1.247-1.548-.352-.156-.708-.311-.955-.65-.172-.241-.219-.51-.305-.774-.055-.16-.11-.323-.293-.35-.2-.031-.278.136-.356.276-.313.572-.434 1.202-.422 1.84.027 1.436.633 2.58 1.838 3.393.137.093.172.187.129.323-.082.28-.18.552-.266.833-.055.179-.137.217-.329.14a5.526 5.526 0 0 1-1.736-1.18c-.857-.828-1.631-1.742-2.597-2.458a11.365 11.365 0 0 0-.689-.471c-.985-.957.13-1.743.388-1.836.27-.098.093-.432-.779-.428-.872.004-1.67.295-2.687.684a3.055 3.055 0 0 1-.465.137 9.597 9.597 0 0 0-2.883-.102c-1.885.21-3.39 1.102-4.497 2.623C.082 8.606-.231 10.684.152 12.85c.403 2.284 1.569 4.175 3.36 5.653 1.858 1.533 3.997 2.284 6.438 2.14 1.482-.085 3.133-.284 4.994-1.86.47.234.962.327 1.78.397.63.059 1.236-.03 1.705-.128.735-.156.684-.837.419-.961-2.155-1.004-1.682-.595-2.113-.926 1.096-1.296 2.746-2.642 3.392-7.003.05-.347.007-.565 0-.845-.004-.17.035-.237.23-.256a4.173 4.173 0 0 0 1.545-.475c1.396-.763 1.96-2.015 2.093-3.517.02-.23-.004-.467-.247-.588zM11.581 18c-2.089-1.642-3.102-2.183-3.52-2.16-.392.024-.321.471-.235.763.09.288.207.486.371.739.114.167.192.416-.113.603-.673.416-1.842-.14-1.897-.167-1.361-.802-2.5-1.86-3.301-3.307-.774-1.393-1.224-2.887-1.298-4.482-.02-.386.093-.522.477-.592a4.696 4.696 0 0 1 1.529-.039c2.132.312 3.946 1.265 5.468 2.774.868.86 1.525 1.887 2.202 2.891.72 1.066 1.494 2.082 2.48 2.914.348.292.625.514.891.677-.802.09-2.14.11-3.054-.614zm1-6.44a.306.306 0 0 1 .415-.287.302.302 0 0 1 .2.288.306.306 0 0 1-.31.307.303.303 0 0 1-.304-.308zm3.11 1.596c-.2.081-.399.151-.59.16a1.245 1.245 0 0 1-.798-.254c-.274-.23-.47-.358-.552-.758a1.73 1.73 0 0 1 .129-.933c.27-.611.832-1.047 1.411-1.428.16-.106.321-.219.493-.309.223-.117.434-.055.536.18.114.262.149.544.157.828.019.805-.285 1.487-.876 2.026z';

function arcToCubics(x1, y1, rx, ry, phiDeg, fa, fs, x2, y2) {
  if (x1 === x2 && y1 === y2) return [];
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  if (rx === 0 || ry === 0) {
    return [[x1, y1, x2, y2, x2, y2]];
  }
  const phi = (phiDeg * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);
  const dx2 = (x1 - x2) / 2;
  const dy2 = (y1 - y2) / 2;
  const x1p = cosPhi * dx2 + sinPhi * dy2;
  const y1p = -sinPhi * dx2 + cosPhi * dy2;

  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rx *= s;
    ry *= s;
  }

  const rx2 = rx * rx;
  const ry2 = ry * ry;
  const x1p2 = x1p * x1p;
  const y1p2 = y1p * y1p;
  const num = Math.max(0, rx2 * ry2 - rx2 * y1p2 - ry2 * x1p2);
  const den = rx2 * y1p2 + ry2 * x1p2;
  const coef = (fa === fs ? -1 : 1) * Math.sqrt(den === 0 ? 0 : num / den);
  const cxp = coef * ((rx * y1p) / ry);
  const cyp = coef * ((-ry * x1p) / rx);
  const ccx = cosPhi * cxp - sinPhi * cyp + (x1 + x2) / 2;
  const ccy = sinPhi * cxp + cosPhi * cyp + (y1 + y2) / 2;

  function vecAngle(ux, uy, vx, vy) {
    const dot = ux * vx + uy * vy;
    const len = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    let ang = Math.acos(Math.max(-1, Math.min(1, dot / len)));
    if (ux * vy - uy * vx < 0) ang = -ang;
    return ang;
  }

  const theta1 = vecAngle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dtheta = vecAngle(
    (x1p - cxp) / rx,
    (y1p - cyp) / ry,
    (-x1p - cxp) / rx,
    (-y1p - cyp) / ry
  );
  if (!fs && dtheta > 0) dtheta -= 2 * Math.PI;
  if (fs && dtheta < 0) dtheta += 2 * Math.PI;

  const segCount = Math.max(1, Math.ceil(Math.abs(dtheta) / (Math.PI / 2)));
  const cubics = [];

  function mapPt(ux, uy) {
    const xr = rx * ux;
    const yr = ry * uy;
    return [cosPhi * xr - sinPhi * yr + ccx, sinPhi * xr + cosPhi * yr + ccy];
  }

  for (let s = 0; s < segCount; s++) {
    const a1 = theta1 + (dtheta * s) / segCount;
    const a2 = theta1 + (dtheta * (s + 1)) / segCount;
    const da = a2 - a1;
    const k = (4 / 3) * Math.tan(da / 4);

    const cos1 = Math.cos(a1);
    const sin1 = Math.sin(a1);
    const cos2 = Math.cos(a2);
    const sin2 = Math.sin(a2);

    const [c1x, c1y] = mapPt(cos1 - k * sin1, sin1 + k * cos1);
    const [c2x, c2y] = mapPt(cos2 + k * sin2, sin2 - k * cos2);
    const [ex, ey] = mapPt(cos2, sin2);
    cubics.push([c1x, c1y, c2x, c2y, ex, ey]);
  }
  return cubics;
}

function cubicSample(x0, y0, x1, y1, x2, y2, x3, y3, steps = 28) {
  const pts = [];
  for (let k = 1; k <= steps; k++) {
    const t = k / steps;
    const mt = 1 - t;
    pts.push([
      mt * mt * mt * x0 + 3 * mt * mt * t * x1 + 3 * mt * t * t * x2 + t * t * t * x3,
      mt * mt * mt * y0 + 3 * mt * mt * t * y1 + 3 * mt * t * t * y2 + t * t * t * y3
    ]);
  }
  return pts;
}

const tokens = RAW_WHALE_D.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+)(?:e[-+]?\d+)?/g);
let idx = 0;
let cx = 0;
let cy = 0;
let sx = 0;
let sy = 0;
let cmd = '';

// Android 108dp Adaptive Icon 安全区居中映射 (中心 54,54，主体宽约 55dp)
const SCALE_108 = 2.3;
const TX_108 = 26.4;
const TY_108 = 27.5;
const fmt = (v, isY) => ((isY ? TY_108 : TX_108) + v * SCALE_108).toFixed(3);

const androidPathParts = [];
const subpaths = [];
let curPoly = [];

while (idx < tokens.length) {
  if (/^[a-zA-Z]$/.test(tokens[idx])) {
    cmd = tokens[idx++];
    if (cmd === 'z' || cmd === 'Z') {
      androidPathParts.push('Z');
      if (curPoly.length > 0) {
        subpaths.push(curPoly);
        curPoly = [];
      }
      cx = sx;
      cy = sy;
      continue;
    }
  }

  if (cmd === 'M' || cmd === 'm') {
    const nx = parseFloat(tokens[idx++]);
    const ny = parseFloat(tokens[idx++]);
    cx = cmd === 'm' ? cx + nx : nx;
    cy = cmd === 'm' ? cy + ny : ny;
    sx = cx;
    sy = cy;
    androidPathParts.push(`M ${fmt(cx, false)} ${fmt(cy, true)}`);
    if (curPoly.length > 0) subpaths.push(curPoly);
    curPoly = [[cx, cy]];
    cmd = cmd === 'm' ? 'l' : 'L';
  } else if (cmd === 'C' || cmd === 'c') {
    const x1 = (cmd === 'c' ? cx : 0) + parseFloat(tokens[idx++]);
    const y1 = (cmd === 'c' ? cy : 0) + parseFloat(tokens[idx++]);
    const x2 = (cmd === 'c' ? cx : 0) + parseFloat(tokens[idx++]);
    const y2 = (cmd === 'c' ? cy : 0) + parseFloat(tokens[idx++]);
    const x = (cmd === 'c' ? cx : 0) + parseFloat(tokens[idx++]);
    const y = (cmd === 'c' ? cy : 0) + parseFloat(tokens[idx++]);
    androidPathParts.push(
      `C ${fmt(x1, false)} ${fmt(y1, true)} ${fmt(x2, false)} ${fmt(y2, true)} ${fmt(x, false)} ${fmt(y, true)}`
    );
    curPoly.push(...cubicSample(cx, cy, x1, y1, x2, y2, x, y));
    cx = x;
    cy = y;
  } else if (cmd === 'A' || cmd === 'a') {
    const rx = parseFloat(tokens[idx++]);
    const ry = parseFloat(tokens[idx++]);
    const rot = parseFloat(tokens[idx++]);
    const fa = parseInt(tokens[idx++], 10);
    const fsFlag = parseInt(tokens[idx++], 10);
    const x = (cmd === 'a' ? cx : 0) + parseFloat(tokens[idx++]);
    const y = (cmd === 'a' ? cy : 0) + parseFloat(tokens[idx++]);
    const cubics = arcToCubics(cx, cy, rx, ry, rot, fa, fsFlag, x, y);
    let px = cx;
    let py = cy;
    for (const [x1, y1, x2, y2, ex, ey] of cubics) {
      androidPathParts.push(
        `C ${fmt(x1, false)} ${fmt(y1, true)} ${fmt(x2, false)} ${fmt(y2, true)} ${fmt(ex, false)} ${fmt(ey, true)}`
      );
      curPoly.push(...cubicSample(px, py, x1, y1, x2, y2, ex, ey));
      px = ex;
      py = ey;
    }
    cx = x;
    cy = y;
  }
}
if (curPoly.length > 0) subpaths.push(curPoly);

const fgXmlPath = process.argv[2];
if (fgXmlPath) {
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
    <!-- 1:1 复刻 DeepSeek 官方大鲸鱼无损矢量图标 -->
    <path
        android:fillColor="#4D6BFE"
        android:fillType="evenOdd"
        android:pathData="${androidPathParts.join(' ')}" />
</vector>
`;
  fs.writeFileSync(fgXmlPath, xml, 'utf8');
}

process.stdout.write(JSON.stringify(subpaths));

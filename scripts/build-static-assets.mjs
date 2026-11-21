import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(PROJECT_ROOT, 'public');
const DIST_DIR = path.join(PUBLIC_DIR, 'dist');

const CSS_FILES = [
  'styles.css',
  'clean-ui.css',
  'mobile-responsive.css',
  'phone-agent.css',
  'mobile-deepseek.css',
  'theater-luxury.css',
  'appearance.css',
  'ui-polish-v2.css'
];

const JS_FILES = [
  'standaloneAdapter.js',
  'mobileAdapter.js',
  'plugins/deepseekUsageMonitor.js',
  'appearanceSystem.js',
  'app.js',
  'companionVoice.js',
  'phoneAgent.js'
];

const PRECOMPRESS_EXTS = new Set(['.js', '.css', '.html', '.svg', '.json']);
const PRECOMPRESS_MIN_BYTES = 512;

/**
 * 保守且状态机安全的 CSS 压缩：
 * - 完整保留单/双引号字符串与无引号 url(...) 原样内容
 * - 移除 /* ... *\/ 块注释
 * - 合并连续空白为单个空格，仅收缩 { } ; , 两侧及 : 后空白（不破坏 calc(...) 内部与媒体查询 and (...)）
 * - 移除 } 前多余的分号
 */
function minifyCss(css) {
  const tokens = [];
  const n = css.length;
  let i = 0;

  while (i < n) {
    const ch = css[i];

    // 引号字符串原样保留
    if (ch === '"' || ch === "'") {
      const quote = ch;
      let j = i + 1;
      while (j < n) {
        if (css[j] === '\\') {
          j += 2;
          continue;
        }
        if (css[j] === quote) {
          j += 1;
          break;
        }
        j += 1;
      }
      tokens.push({ raw: true, val: css.slice(i, j) });
      i = j;
      continue;
    }

    // 块注释移除（用空格替换以防相邻 token 粘连）
    if (ch === '/' && css[i + 1] === '*') {
      let j = i + 2;
      while (j < n && !(css[j] === '*' && css[j + 1] === '/')) {
        j += 1;
      }
      i = j < n ? j + 2 : n;
      tokens.push({ raw: false, val: ' ' });
      continue;
    }

    // 无引号 url(...) 原样保留
    if (
      (ch === 'u' || ch === 'U') &&
      css.slice(i, i + 4).toLowerCase() === 'url('
    ) {
      let k = i + 4;
      while (k < n && /\s/.test(css[k])) k += 1;
      if (k < n && css[k] !== '"' && css[k] !== "'") {
        let depth = 1;
        let j = i + 4;
        while (j < n && depth > 0) {
          if (css[j] === '\\') {
            j += 2;
            continue;
          }
          if (css[j] === '(') depth += 1;
          else if (css[j] === ')') depth -= 1;
          j += 1;
        }
        tokens.push({ raw: true, val: css.slice(i, j) });
        i = j;
        continue;
      }
    }

    // 普通代码段收集直到遇到引号、注释或 url(
    let j = i + 1;
    while (j < n) {
      const c = css[j];
      if (c === '"' || c === "'") break;
      if (c === '/' && css[j + 1] === '*') break;
      if ((c === 'u' || c === 'U') && css.slice(j, j + 4).toLowerCase() === 'url(') break;
      j += 1;
    }
    let chunk = css.slice(i, j);
    chunk = chunk.replace(/\s+/g, ' ');
    tokens.push({ raw: false, val: chunk });
    i = j;
  }

  // 在占位符保护下安全收缩非 raw 段中的定界符空白
  const placeholders = [];
  const merged = tokens
    .map((t) => {
      if (!t.raw) return t.val;
      const idx = placeholders.length;
      placeholders.push(t.val);
      return `\u0000RAW_${idx}\u0000`;
    })
    .join('');

  let out = merged
    .replace(/\s+/g, ' ')
    .replace(/\s*([{};,])\s*/g, '$1')
    .replace(/:\s+/g, ':')
    .replace(/;}/g, '}')
    .trim();

  out = out.replace(/\u0000RAW_(\d+)\u0000/g, (_, idxStr) => placeholders[Number(idxStr)]);
  return out;
}

const REGEX_PRECEDING_KEYWORDS = new Set([
  'return', 'throw', 'case', 'default', 'delete', 'void', 'typeof',
  'in', 'instanceof', 'new', 'yield', 'await', 'else', 'do', 'of'
]);

/**
 * 保守且词法状态机安全的 JS 压缩：
 * - 完整识别单/双引号字符串、嵌套模板字符串 (${...})、正则字面量（含字符类 [...]）
 * - 移除 // 单行注释与 /* ... *\/ 块注释
 * - 保留换行符以彻底避免 ASI 自动分号插入语义变化，仅裁剪每行首尾缩进空白与连续空行
 */
function safeMinifyJs(code) {
  const n = code.length;
  let i = 0;
  let out = '';

  // stateStack 中保存：'code' | 'template'
  // template 内部遇到 ${ 时压入 { mode: 'expr', braceDepth: 1 }
  const stateStack = [{ mode: 'code', braceDepth: 0 }];
  let lastSigTokenType = 'start'; // 'start'|'punct'|'kw'|'ident'|'num'|'str'|'regex'|'close'|'incdec'

  const isIdentStart = (c) => /[A-Za-z_$]/.test(c);
  const isIdentPart = (c) => /[A-Za-z0-9_$]/.test(c);
  const canPrecedeRegex = () =>
    lastSigTokenType === 'start' ||
    lastSigTokenType === 'punct' ||
    lastSigTokenType === 'kw';

  while (i < n) {
    const top = stateStack[stateStack.length - 1];

    if (top.mode === 'template') {
      const ch = code[i];
      if (ch === '\\') {
        out += code.slice(i, i + 2);
        i += 2;
        continue;
      }
      if (ch === '$' && code[i + 1] === '{') {
        out += '${';
        i += 2;
        stateStack.push({ mode: 'expr', braceDepth: 1 });
        lastSigTokenType = 'punct';
        continue;
      }
      if (ch === '`') {
        out += '`';
        i += 1;
        stateStack.pop();
        lastSigTokenType = 'str';
        continue;
      }
      out += ch;
      i += 1;
      continue;
    }

    // code 或 expr 模式
    const ch = code[i];

    // 单行注释
    if (ch === '/' && code[i + 1] === '/') {
      let j = i + 2;
      while (j < n && code[j] !== '\n' && code[j] !== '\r') {
        j += 1;
      }
      i = j;
      continue;
    }

    // 块注释
    if (ch === '/' && code[i + 1] === '*') {
      let j = i + 2;
      let hasNewline = false;
      while (j < n && !(code[j] === '*' && code[j + 1] === '/')) {
        if (code[j] === '\n') hasNewline = true;
        j += 1;
      }
      i = j < n ? j + 2 : n;
      out += hasNewline ? '\n' : ' ';
      continue;
    }

    // 正则字面量
    if (ch === '/' && canPrecedeRegex()) {
      let j = i + 1;
      let inCharClass = false;
      let closed = false;
      while (j < n) {
        const rc = code[j];
        if (rc === '\\') {
          j += 2;
          continue;
        }
        if (rc === '\n' || rc === '\r') {
          break;
        }
        if (rc === '[') {
          inCharClass = true;
          j += 1;
          continue;
        }
        if (rc === ']' && inCharClass) {
          inCharClass = false;
          j += 1;
          continue;
        }
        if (rc === '/' && !inCharClass) {
          j += 1;
          while (j < n && /[a-zA-Z]/.test(code[j])) j += 1;
          closed = true;
          break;
        }
        j += 1;
      }
      if (closed) {
        out += code.slice(i, j);
        i = j;
        lastSigTokenType = 'regex';
        continue;
      }
    }

    // 单引号 / 双引号字符串
    if (ch === "'" || ch === '"') {
      const quote = ch;
      let j = i + 1;
      while (j < n) {
        if (code[j] === '\\') {
          j += 2;
          continue;
        }
        if (code[j] === quote) {
          j += 1;
          break;
        }
        if (code[j] === '\n' || code[j] === '\r') {
          break;
        }
        j += 1;
      }
      out += code.slice(i, j);
      i = j;
      lastSigTokenType = 'str';
      continue;
    }

    // 模板字符串起始
    if (ch === '`') {
      out += '`';
      i += 1;
      stateStack.push({ mode: 'template', braceDepth: 0 });
      continue;
    }

    // 空白处理（保留换行以确保 ASI 安全，但跳过行首缩进空白）
    if (ch === '\r') {
      i += 1;
      continue;
    }
    if (ch === '\n') {
      out += '\n';
      i += 1;
      while (i < n && (code[i] === ' ' || code[i] === '\t')) {
        i += 1;
      }
      continue;
    }
    if (ch === ' ' || ch === '\t') {
      let j = i + 1;
      while (j < n && (code[j] === ' ' || code[j] === '\t')) {
        j += 1;
      }
      if (out.length > 0 && out[out.length - 1] !== '\n' && out[out.length - 1] !== ' ') {
        out += ' ';
      }
      i = j;
      continue;
    }

    // 标识符 / 关键字
    if (isIdentStart(ch)) {
      let j = i + 1;
      while (j < n && isIdentPart(code[j])) {
        j += 1;
      }
      const word = code.slice(i, j);
      out += word;
      i = j;
      lastSigTokenType = REGEX_PRECEDING_KEYWORDS.has(word) ? 'kw' : 'ident';
      continue;
    }

    // 数字字面量
    if (/[0-9]/.test(ch)) {
      let j = i + 1;
      while (j < n && /[0-9a-zA-Z_.]/.test(code[j])) {
        j += 1;
      }
      out += code.slice(i, j);
      i = j;
      lastSigTokenType = 'num';
      continue;
    }

    // 自增/自减
    if ((ch === '+' && code[i + 1] === '+') || (ch === '-' && code[i + 1] === '-')) {
      out += code.slice(i, i + 2);
      i += 2;
      lastSigTokenType = 'incdec';
      continue;
    }

    // 大括号（需要跟踪模板表达式嵌套深度）
    if (ch === '{') {
      if (top.mode === 'expr') {
        top.braceDepth += 1;
      }
      out += '{';
      i += 1;
      lastSigTokenType = 'punct';
      continue;
    }
    if (ch === '}') {
      out += '}';
      i += 1;
      if (top.mode === 'expr') {
        top.braceDepth -= 1;
        if (top.braceDepth === 0) {
          stateStack.pop();
          continue;
        }
      }
      lastSigTokenType = 'close';
      continue;
    }

    if (ch === ')' || ch === ']') {
      out += ch;
      i += 1;
      lastSigTokenType = 'close';
      continue;
    }

    out += ch;
    i += 1;
    lastSigTokenType = 'punct';
  }

  // 裁剪每行尾部多余空白并折叠连续空行
  return out
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .filter((line) => line.length > 0)
    .join('\n') + '\n';
}

function walkFiles(dir) {
  const result = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      result.push(...walkFiles(full));
    } else if (entry.isFile()) {
      result.push(full);
    }
  }
  return result;
}

function formatKB(bytes) {
  return `${(bytes / 1024).toFixed(2)} KB`;
}

function buildCssBundle() {
  let rawTotal = 0;
  const parts = [];
  for (const rel of CSS_FILES) {
    const full = path.join(PUBLIC_DIR, rel);
    const content = fs.readFileSync(full, 'utf8');
    rawTotal += Buffer.byteLength(content, 'utf8');
    parts.push(`/* === ${rel} === */\n${content}`);
  }
  const combined = parts.join('\n');
  const minified = minifyCss(combined);
  const outPath = path.join(DIST_DIR, 'app.bundle.css');
  fs.writeFileSync(outPath, minified, 'utf8');
  return {
    outPath,
    rawBytes: rawTotal,
    minifiedBytes: Buffer.byteLength(minified, 'utf8')
  };
}

function buildJsBundle() {
  let rawTotal = 0;
  const rawParts = [];
  for (const rel of JS_FILES) {
    const full = path.join(PUBLIC_DIR, rel);
    const content = fs.readFileSync(full, 'utf8');
    rawTotal += Buffer.byteLength(content, 'utf8');
    // 使用分号与换行隔离不同文件，防止文件末尾缺少分号引发 ASI 粘连
    rawParts.push(content.trimEnd());
  }
  const combinedRaw = rawParts.join('\n;\n') + '\n';

  let finalJs = safeMinifyJs(combinedRaw);
  let fellBack = false;
  try {
    new vm.Script(finalJs, { filename: 'app.bundle.js' });
  } catch (err) {
    console.warn(`[build-static-assets] safeMinifyJs 语法校验失败，自动回退未压缩拼接版: ${err.message}`);
    finalJs = combinedRaw;
    fellBack = true;
    new vm.Script(finalJs, { filename: 'app.bundle.js' });
  }

  const outPath = path.join(DIST_DIR, 'app.bundle.js');
  fs.writeFileSync(outPath, finalJs, 'utf8');
  return {
    outPath,
    rawBytes: rawTotal,
    minifiedBytes: Buffer.byteLength(finalJs, 'utf8'),
    fellBack
  };
}

function precompressPublicAssets() {
  const allFiles = walkFiles(PUBLIC_DIR);
  let count = 0;
  let totalRaw = 0;
  let totalGz = 0;
  let totalBr = 0;

  for (const filePath of allFiles) {
    if (filePath.endsWith('.gz') || filePath.endsWith('.br')) continue;
    const ext = path.extname(filePath).toLowerCase();
    if (!PRECOMPRESS_EXTS.has(ext)) continue;

    const stats = fs.statSync(filePath);
    if (stats.size < PRECOMPRESS_MIN_BYTES) continue;

    const rawBuf = fs.readFileSync(filePath);
    const gzBuf = zlib.gzipSync(rawBuf, { level: 9 });
    const brBuf = zlib.brotliCompressSync(rawBuf, {
      params: {
        [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
        [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT
      }
    });

    const gzPath = `${filePath}.gz`;
    const brPath = `${filePath}.br`;
    try {
      fs.writeFileSync(gzPath, gzBuf);
    } catch (e) {
      try {
        const tmp = `${gzPath}.tmp`;
        fs.writeFileSync(tmp, gzBuf);
        fs.copyFileSync(tmp, gzPath);
        fs.unlinkSync(tmp);
      } catch {}
    }
    try {
      fs.writeFileSync(brPath, brBuf);
    } catch (e) {
      try {
        const tmp = `${brPath}.tmp`;
        fs.writeFileSync(tmp, brBuf);
        fs.copyFileSync(tmp, brPath);
        fs.unlinkSync(tmp);
      } catch {}
    }

    // 保持预压缩产物时间不早于源文件，确保服务端与 Nginx 命中 mtime 校验
    try {
      const targetTime = new Date(Math.max(Date.now(), stats.mtimeMs + 1000));
      fs.utimesSync(gzPath, targetTime, targetTime);
      fs.utimesSync(brPath, targetTime, targetTime);
    } catch {}

    count += 1;
    totalRaw += rawBuf.length;
    totalGz += gzBuf.length;
    totalBr += brBuf.length;
  }

  return { count, totalRaw, totalGz, totalBr };
}

function main() {
  fs.mkdirSync(DIST_DIR, { recursive: true });

  const cssRes = buildCssBundle();
  const jsRes = buildJsBundle();
  const compRes = precompressPublicAssets();

  const cssGz = fs.statSync(`${cssRes.outPath}.gz`).size;
  const cssBr = fs.statSync(`${cssRes.outPath}.br`).size;
  const jsGz = fs.statSync(`${jsRes.outPath}.gz`).size;
  const jsBr = fs.statSync(`${jsRes.outPath}.br`).size;

  console.log('=== 静态资产合并压缩报告 ===');
  console.log(
    `CSS Bundle (6 -> 1): 原始 ${formatKB(cssRes.rawBytes)} -> 压缩后 ${formatKB(cssRes.minifiedBytes)} | Gzip ${formatKB(cssGz)} | Brotli ${formatKB(cssBr)}`
  );
  console.log(
    `JS  Bundle (7 -> 1): 原始 ${formatKB(jsRes.rawBytes)} -> 压缩后 ${formatKB(jsRes.minifiedBytes)} (回退=${jsRes.fellBack}) | Gzip ${formatKB(jsGz)} | Brotli ${formatKB(jsBr)}`
  );
  console.log(
    `预压缩全量产物: ${compRes.count} 个文件已生成 .gz 与 .br (总计原始 ${formatKB(compRes.totalRaw)} -> Gzip ${formatKB(compRes.totalGz)} | Brotli ${formatKB(compRes.totalBr)})`
  );
}

main();

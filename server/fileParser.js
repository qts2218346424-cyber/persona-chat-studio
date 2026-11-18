const zlib = require('node:zlib');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const MAX_EXTRACTED_CHARS = 60000;

/**
 * 智能字节缓冲区转文本（自动识别 BOM、UTF-16LE/BE、UTF-8 与中文 Windows GB18030/GBK 编码）
 */
function decodeSmartBuffer(buf) {
  if (!Buffer.isBuffer(buf) || buf.length === 0) return '';

  // 1. BOM 检测
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return buf.subarray(3).toString('utf8');
  }
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(buf.subarray(2));
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(buf.subarray(2));
  }

  // 2. 优先严格校验 UTF-8
  try {
    const utf8Decoder = new TextDecoder('utf-8', { fatal: true });
    return utf8Decoder.decode(buf);
  } catch {
    // 3. 回退使用 GB18030（兼容 GBK / GB2312 中文编码）
    try {
      const gbkDecoder = new TextDecoder('gb18030', { fatal: false });
      return gbkDecoder.decode(buf);
    } catch {
      return buf.toString('utf8');
    }
  }
}

/**
 * 判断 Buffer 是否大概率为可读文本文件
 */
function looksLikeTextBuffer(buf) {
  if (!Buffer.isBuffer(buf) || buf.length === 0) return true;
  const sampleLen = Math.min(buf.length, 4096);
  let nullCount = 0;
  let ctrlCount = 0;
  for (let i = 0; i < sampleLen; i++) {
    const b = buf[i];
    if (b === 0) nullCount++;
    else if (b < 9 || (b > 13 && b < 32 && b !== 27)) ctrlCount++;
  }
  // 若为 UTF-16 文本可能含交替 0x00，但若前两字节无 BOM 且大量随机控制字符则视为二进制
  if (nullCount > sampleLen * 0.05) return false;
  if (ctrlCount > sampleLen * 0.08) return false;
  return true;
}

/**
 * 解码常见 XML / HTML 实体
 */
function decodeXmlEntities(str) {
  if (!str) return '';
  return String(str)
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
      const code = parseInt(hex, 16);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : '';
    })
    .replace(/&#(\d+);/g, (_, dec) => {
      const code = parseInt(dec, 10);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : '';
    })
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&amp;/gi, '&');
}

/**
 * 纯 Node.js 标准 ZIP Central Directory 解压器（支持 docx / xlsx / pptx / odt / epub / zip）
 */
function readZipEntries(buf) {
  const entries = new Map();
  if (!Buffer.isBuffer(buf) || buf.length < 22) return entries;
  if (buf.readUInt32LE(0) !== 0x04034b50) return entries;

  // 从尾部逆向定位 End of Central Directory (0x06054b50)
  const minOffset = Math.max(0, buf.length - 65558);
  let eocdOffset = -1;
  for (let i = buf.length - 22; i >= minOffset; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) return entries;

  const totalEntries = buf.readUInt16LE(eocdOffset + 10);
  const cdSize = buf.readUInt32LE(eocdOffset + 12);
  const cdOffset = buf.readUInt32LE(eocdOffset + 16);
  if (cdOffset + cdSize > buf.length) return entries;

  let ptr = cdOffset;
  const cdEnd = cdOffset + cdSize;
  for (let idx = 0; idx < totalEntries && ptr + 46 <= cdEnd; idx++) {
    if (buf.readUInt32LE(ptr) !== 0x02014b50) break;
    const compressionMethod = buf.readUInt16LE(ptr + 10);
    const compressedSize = buf.readUInt32LE(ptr + 20);
    const uncompressedSize = buf.readUInt32LE(ptr + 24);
    const fileNameLen = buf.readUInt16LE(ptr + 28);
    const extraLen = buf.readUInt16LE(ptr + 30);
    const commentLen = buf.readUInt16LE(ptr + 32);
    const localHeaderOffset = buf.readUInt32LE(ptr + 42);

    const nameBuf = buf.subarray(ptr + 46, ptr + 46 + fileNameLen);
    const entryName = decodeSmartBuffer(nameBuf);
    ptr += 46 + fileNameLen + extraLen + commentLen;

    if (entryName.endsWith('/')) continue;
    if (localHeaderOffset + 30 > buf.length) continue;
    if (buf.readUInt32LE(localHeaderOffset) !== 0x04034b50) continue;

    const localNameLen = buf.readUInt16LE(localHeaderOffset + 26);
    const localExtraLen = buf.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > buf.length) continue;

    entries.set(entryName, {
      name: entryName,
      compressionMethod,
      compressedSize,
      uncompressedSize,
      extractBuffer() {
        if (uncompressedSize > 25 * 1024 * 1024) {
          throw new Error('单个内嵌条目体积过大');
        }
        const slice = buf.subarray(dataStart, dataEnd);
        if (compressionMethod === 0) return slice;
        if (compressionMethod === 8) return zlib.inflateRawSync(slice);
        throw new Error(`不支持的压缩算法 (${compressionMethod})`);
      },
      extractText() {
        return decodeSmartBuffer(this.extractBuffer());
      }
    });
  }
  return entries;
}

/**
 * 解析 Word (.docx) 文档（还原段落与内置表格）
 */
function parseDocxBuffer(buf) {
  const entries = readZipEntries(buf);
  const targetXmlNames = ['word/document.xml'];
  for (const k of entries.keys()) {
    if (/^word\/(header|footer|footnotes|endnotes)\d*\.xml$/i.test(k)) {
      targetXmlNames.push(k);
    }
  }

  const sections = [];
  for (const xmlName of targetXmlNames) {
    const entry = entries.get(xmlName);
    if (!entry) continue;
    let xml = '';
    try {
      xml = entry.extractText();
    } catch {
      continue;
    }

    // 处理表格行与段落换行的结构化还原
    const normalized = xml
      .replace(/<w:tab\b[^>]*\/>/gi, '\t')
      .replace(/<w:(?:br|cr)\b[^>]*\/>/gi, '\n')
      .replace(/<\/w:tc>/gi, ' | ')
      .replace(/<\/w:tr>/gi, '\n')
      .replace(/<\/w:p>/gi, '\n');

    const textParts = [];
    const wtRegex = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|\n|\t| \| /gi;
    let m;
    while ((m = wtRegex.exec(normalized)) !== null) {
      if (m[1] !== undefined) {
        textParts.push(decodeXmlEntities(m[1]));
      } else {
        textParts.push(m[0]);
      }
    }
    const cleaned = textParts
      .join('')
      .replace(/[ \t]+\|\s*\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    if (cleaned) sections.push(cleaned);
  }
  return sections.join('\n\n').trim();
}

/**
 * 将 Excel 列字母（如 A, B, AA）转换为从 0 开始的列索引
 */
function excelColToIndex(colLetters) {
  let idx = 0;
  for (let i = 0; i < colLetters.length; i++) {
    idx = idx * 26 + (colLetters.charCodeAt(i) - 64);
  }
  return Math.max(0, idx - 1);
}

/**
 * 解析 Excel (.xlsx) 工作簿（还原多工作表名称与 Markdown 表格）
 */
function parseXlsxBuffer(buf) {
  const entries = readZipEntries(buf);
  const sharedStrings = [];
  const ssEntry = entries.get('xl/sharedStrings.xml');
  if (ssEntry) {
    try {
      const ssXml = ssEntry.extractText();
      const siRegex = /<si\b[^>]*>([\s\S]*?)<\/si>/gi;
      let siMatch;
      while ((siMatch = siRegex.exec(ssXml)) !== null) {
        const inner = siMatch[1];
        const tParts = [];
        const tRegex = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/gi;
        let tm;
        while ((tm = tRegex.exec(inner)) !== null) {
          tParts.push(decodeXmlEntities(tm[1]));
        }
        sharedStrings.push(tParts.join(''));
      }
    } catch {}
  }

  // 读取真实工作表名称映射
  const sheetNames = [];
  const wbEntry = entries.get('xl/workbook.xml');
  if (wbEntry) {
    try {
      const wbXml = wbEntry.extractText();
      const shRegex = /<sheet\b[^>]*name="([^"]+)"[^>]*\/?>/gi;
      let sm;
      while ((sm = shRegex.exec(wbXml)) !== null) {
        sheetNames.push(decodeXmlEntities(sm[1]));
      }
    } catch {}
  }

  const sheetFiles = Array.from(entries.keys())
    .filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(k))
    .sort((a, b) => {
      const na = parseInt(a.match(/\d+/)?.[0] || '0', 10);
      const nb = parseInt(b.match(/\d+/)?.[0] || '0', 10);
      return na - nb;
    });

  const outBlocks = [];
  sheetFiles.forEach((sheetPath, sheetIdx) => {
    const entry = entries.get(sheetPath);
    if (!entry) return;
    let xml = '';
    try {
      xml = entry.extractText();
    } catch {
      return;
    }

    const rows = [];
    let maxCols = 0;
    const rowRegex = /<row\b[^>]*>([\s\S]*?)<\/row>/gi;
    let rm;
    while ((rm = rowRegex.exec(xml)) !== null && rows.length < 400) {
      const rowXml = rm[1];
      const cells = [];
      const cellRegex = /<c\b([^>]*)>([\s\S]*?)<\/c>/gi;
      let cm;
      while ((cm = cellRegex.exec(rowXml)) !== null) {
        const attrs = cm[1] || '';
        const body = cm[2] || '';
        const refMatch = attrs.match(/\br="([A-Z]+)\d+"/i);
        const typeMatch = attrs.match(/\bt="([^"]+)"/i);
        const colIdx = refMatch ? excelColToIndex(refMatch[1].toUpperCase()) : cells.length;
        const cellType = typeMatch ? typeMatch[1] : '';

        let val = '';
        if (cellType === 'inlineStr') {
          const tMatch = body.match(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/i);
          val = tMatch ? decodeXmlEntities(tMatch[1]) : '';
        } else {
          const vMatch = body.match(/<v>([\s\S]*?)<\/v>/i);
          const rawV = vMatch ? decodeXmlEntities(vMatch[1]) : '';
          if (cellType === 's') {
            const sIdx = parseInt(rawV, 10);
            val = Number.isFinite(sIdx) && sharedStrings[sIdx] !== undefined ? sharedStrings[sIdx] : rawV;
          } else if (cellType === 'b') {
            val = rawV === '1' ? 'TRUE' : 'FALSE';
          } else {
            val = rawV;
          }
        }
        cells[colIdx] = String(val || '').replace(/\r?\n/g, ' ').trim();
      }
      if (cells.some((c) => c && c.length > 0)) {
        maxCols = Math.max(maxCols, Math.min(cells.length, 30));
        rows.push(cells);
      }
    }

    if (rows.length > 0 && maxCols > 0) {
      const sheetTitle = sheetNames[sheetIdx] || `工作表 ${sheetIdx + 1}`;
      const mdLines = [`### 📊 ${sheetTitle}`];
      const formatRow = (r) => {
        const padded = [];
        for (let c = 0; c < maxCols; c++) {
          padded.push(String(r[c] || '').replace(/\|/g, '\\|'));
        }
        return `| ${padded.join(' | ')} |`;
      };
      mdLines.push(formatRow(rows[0]));
      mdLines.push(`| ${Array(maxCols).fill('---').join(' | ')} |`);
      for (let rIdx = 1; rIdx < rows.length; rIdx++) {
        mdLines.push(formatRow(rows[rIdx]));
      }
      outBlocks.push(mdLines.join('\n'));
    }
  });

  return outBlocks.join('\n\n').trim();
}

/**
 * 解析 PowerPoint (.pptx) 演示文稿
 */
function parsePptxBuffer(buf) {
  const entries = readZipEntries(buf);
  const slideFiles = Array.from(entries.keys())
    .filter((k) => /^ppt\/slides\/slide\d+\.xml$/i.test(k))
    .sort((a, b) => {
      const na = parseInt(a.match(/\d+/)?.[0] || '0', 10);
      const nb = parseInt(b.match(/\d+/)?.[0] || '0', 10);
      return na - nb;
    });

  const pages = [];
  slideFiles.forEach((slidePath, idx) => {
    const entry = entries.get(slidePath);
    if (!entry) return;
    try {
      const xml = entry.extractText().replace(/<\/a:p>/gi, '\n');
      const parts = [];
      const atRegex = /<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>|\n/gi;
      let m;
      while ((m = atRegex.exec(xml)) !== null) {
        parts.push(m[1] !== undefined ? decodeXmlEntities(m[1]) : '\n');
      }
      const slideText = parts.join('').replace(/\n{3,}/g, '\n\n').trim();
      if (slideText) {
        pages.push(`### 📽️ 第 ${idx + 1} 页幻灯片\n${slideText}`);
      }
    } catch {}
  });
  return pages.join('\n\n').trim();
}

/**
 * 解析 OpenDocument (.odt) 与 EPUB 电子书 (.epub)
 */
function parseOdtOrEpubBuffer(buf, ext) {
  const entries = readZipEntries(buf);
  if (ext === 'odt') {
    const contentEntry = entries.get('content.xml');
    if (!contentEntry) return '';
    const xml = contentEntry.extractText().replace(/<\/text:(?:p|h)>/gi, '\n');
    return decodeXmlEntities(xml.replace(/<[^>]+>/g, '')).replace(/\n{3,}/g, '\n\n').trim();
  }
  const htmlFiles = Array.from(entries.keys())
    .filter((k) => /\.(?:xhtml|html|htm)$/i.test(k))
    .sort();
  const chapters = [];
  for (const hf of htmlFiles.slice(0, 40)) {
    try {
      const rawHtml = entries.get(hf).extractText();
      const plain = stripHtmlToReadableText(rawHtml);
      if (plain) chapters.push(plain);
    } catch {}
  }
  return chapters.join('\n\n').trim();
}

/**
 * 解析 ZIP 压缩包目录结构与内部可读文档摘要
 */
function parseZipArchiveBuffer(buf) {
  const entries = readZipEntries(buf);
  if (entries.size === 0) return '';
  const names = Array.from(entries.keys());
  const lines = [
    `### 🗜️ 压缩包文件清单（共 ${names.length} 个文件）`,
    names.slice(0, 80).map((n) => `- ${n}`).join('\n')
  ];

  let budget = MAX_EXTRACTED_CHARS - 2000;
  let extractedFiles = 0;
  for (const [entryName, entry] of entries.entries()) {
    if (extractedFiles >= 12 || budget <= 500) break;
    if (/(?:^|\/)(?:node_modules|\.git|__MACOSX|dist|build)\//i.test(entryName)) continue;
    if (/\.(png|jpe?g|gif|webp|mp4|mp3|wav|exe|dll|so|dylib|bin|woff2?|ttf)$/i.test(entryName)) continue;
    try {
      const innerBuf = entry.extractBuffer();
      const subExt = path.extname(entryName).replace(/^\./, '').toLowerCase();
      let subText = '';
      if (subExt === 'docx') subText = parseDocxBuffer(innerBuf);
      else if (subExt === 'xlsx') subText = parseXlsxBuffer(innerBuf);
      else if (subExt === 'pptx') subText = parsePptxBuffer(innerBuf);
      else if (looksLikeTextBuffer(innerBuf)) subText = decodeSmartBuffer(innerBuf);

      if (subText && subText.trim()) {
        const clipped = subText.trim().slice(0, Math.min(budget, 8000));
        lines.push(`\n#### 📄 包内文件：${entryName}\n${clipped}`);
        budget -= clipped.length;
        extractedFiles++;
      }
    } catch {}
  }
  return lines.join('\n').trim();
}

/**
 * 清理 HTML 为干净可读文本
 */
function stripHtmlToReadableText(html) {
  return decodeXmlEntities(
    String(html || '')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<\/(?:p|div|h[1-6]|li|tr|section|article|br)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * 解析旧版二进制 .doc 或 .rtf
 */
function parseLegacyDocOrRtf(buf, ext) {
  const headAscii = buf.subarray(0, 16).toString('latin1');
  if (ext === 'rtf' || headAscii.startsWith('{\\rtf')) {
    const raw = buf.toString('latin1');
    const hexDecoded = raw.replace(/(?:\\'[0-9a-fA-F]{2})+/g, (seq) => {
      const bytes = seq
        .split("\\'")
        .filter(Boolean)
        .map((h) => parseInt(h, 16));
      return decodeSmartBuffer(Buffer.from(bytes));
    });
    return hexDecoded
      .replace(/\\par\b/g, '\n')
      .replace(/\\[a-zA-Z]+-?\d*\s?/g, '')
      .replace(/[{}]/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  // 旧版二进制 OLE2 .doc：扫描提取连续 UTF-16LE 中文/西文可读文本段与 UTF-8 段落
  const chunks = [];
  let curChars = [];
  for (let i = 0; i + 1 < buf.length; i += 2) {
    const code = buf.readUInt16LE(i);
    const isCjkOrPrintable =
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0x3000 && code <= 0x303f) ||
      (code >= 0xff00 && code <= 0xffef) ||
      (code >= 0x20 && code <= 0x7e) ||
      code === 0x0a ||
      code === 0x0d ||
      code === 0x09;
    if (isCjkOrPrintable) {
      curChars.push(String.fromCharCode(code === 0x0d ? 0x0a : code));
    } else {
      if (curChars.length >= 6) {
        const seg = curChars.join('').trim();
        if (/[\u4e00-\u9fff]|[a-zA-Z]{4,}/.test(seg)) chunks.push(seg);
      }
      curChars = [];
    }
  }
  if (curChars.length >= 6) chunks.push(curChars.join('').trim());
  return chunks.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * 解析 PDF 文档（优先调用系统 pdftotext 工业级排版引擎，纯 Node.js 流解压 + ToUnicode CMap 解析兜底）
 */
function parsePdfBuffer(buf) {
  // 1. 优先尝试系统级 poppler pdftotext（Linux 服务器 / 已装环境 100% 精准支持复杂 CJK 字体映射）
  const tmpId = `sw_pdf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const tmpPdf = path.join(os.tmpdir(), `${tmpId}.pdf`);
  try {
    fs.writeFileSync(tmpPdf, buf);
    const out = execFileSync('pdftotext', ['-enc', 'UTF-8', '-q', tmpPdf, '-'], {
      timeout: 8000,
      maxBuffer: 12 * 1024 * 1024
    });
    const text = decodeSmartBuffer(out).replace(/\f/g, '\n\n').replace(/\n{3,}/g, '\n\n').trim();
    if (text.length > 0) return text;
  } catch {
    // 宿主机未安装 pdftotext 时平滑切换至下方纯 Node.js 原生 PDF 解析引擎
  } finally {
    try {
      if (fs.existsSync(tmpPdf)) fs.unlinkSync(tmpPdf);
    } catch {}
  }

  // 2. 纯 Node.js 原生 PDF 流解压与 ToUnicode CMap + UTF-16BE / 字面量文本提取器
  const rawLatin = buf.toString('latin1');
  const decompressedStreams = [];
  const streamRegex = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let sm;
  while ((sm = streamRegex.exec(rawLatin)) !== null && decompressedStreams.length < 400) {
    const rawStreamBuf = Buffer.from(sm[1], 'latin1');
    let decodedStr = '';
    try {
      decodedStr = zlib.inflateSync(rawStreamBuf).toString('latin1');
    } catch {
      try {
        decodedStr = zlib.inflateRawSync(rawStreamBuf).toString('latin1');
      } catch {
        decodedStr = sm[1];
      }
    }
    decompressedStreams.push(decodedStr);
  }

  // 第一遍扫描所有 ToUnicode CMap 建立 CID -> Unicode 字符字典
  const cmap = new Map();
  for (const s of decompressedStreams) {
    if (!s.includes('beginbfchar') && !s.includes('beginbfrange')) continue;
    const bfcharRegex = /beginbfchar([\s\S]*?)endbfchar/g;
    let bm;
    while ((bm = bfcharRegex.exec(s)) !== null) {
      const pairRegex = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g;
      let pm;
      while ((pm = pairRegex.exec(bm[1])) !== null) {
        const srcHex = pm[1].toUpperCase();
        const dstHex = pm[2];
        const dstChars = decodePdfHexToUnicode(dstHex);
        if (dstChars) cmap.set(srcHex, dstChars);
      }
    }
    const bfrangeRegex = /beginbfrange([\s\S]*?)endbfrange/g;
    let rm;
    while ((rm = bfrangeRegex.exec(s)) !== null) {
      const rangeRegex = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g;
      let rgm;
      while ((rgm = rangeRegex.exec(rm[1])) !== null) {
        const startCode = parseInt(rgm[1], 16);
        const endCode = parseInt(rgm[2], 16);
        let targetCode = parseInt(rgm[3], 16);
        const hexWidth = rgm[1].length;
        for (let c = startCode; c <= endCode && c - startCode < 1024; c++, targetCode++) {
          const key = c.toString(16).toUpperCase().padStart(hexWidth, '0');
          cmap.set(key, String.fromCodePoint(targetCode));
        }
      }
    }
  }

  // 第二遍扫描 BT ... ET 文本绘制指令流
  const pieces = [];
  for (const s of decompressedStreams) {
    if (!s.includes('BT')) continue;
    const btRegex = /\bBT\b([\s\S]*?)\bET\b/g;
    let btm;
    while ((btm = btRegex.exec(s)) !== null) {
      const block = btm[1];
      const tokenRegex = /\((?:\\.|[^\\)])*\)|<([0-9a-fA-F]+)>|\b(?:Td|TD|T\*)\b/g;
      let tm;
      const lineParts = [];
      while ((tm = tokenRegex.exec(block)) !== null) {
        const tok = tm[0];
        if (tok === 'Td' || tok === 'TD' || tok === 'T*') {
          lineParts.push('\n');
        } else if (tok.startsWith('(')) {
          lineParts.push(decodePdfLiteralString(tok.slice(1, -1)));
        } else if (tm[1]) {
          lineParts.push(decodePdfHexWithCmap(tm[1], cmap));
        }
      }
      const joined = lineParts.join('').trim();
      if (joined) pieces.push(joined);
    }
  }

  return pieces.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function decodePdfHexToUnicode(hex) {
  if (!hex || hex.length < 2) return '';
  const padded = hex.length % 4 === 0 ? hex : hex.padStart(4, '0');
  let out = '';
  for (let i = 0; i + 3 < padded.length; i += 4) {
    const code = parseInt(padded.slice(i, i + 4), 16);
    if (code > 0) out += String.fromCharCode(code);
  }
  return out;
}

function decodePdfHexWithCmap(hex, cmap) {
  const upper = hex.toUpperCase();
  if (upper.startsWith('FEFF')) {
    return decodePdfHexToUnicode(upper.slice(4));
  }
  if (cmap.size > 0 && upper.length % 4 === 0) {
    let mapped = '';
    let hitCount = 0;
    for (let i = 0; i + 3 < upper.length; i += 4) {
      const seg = upper.slice(i, i + 4);
      if (cmap.has(seg)) {
        mapped += cmap.get(seg);
        hitCount++;
      } else {
        const code = parseInt(seg, 16);
        if (code >= 0x20 && code <= 0x9fff) mapped += String.fromCharCode(code);
      }
    }
    if (hitCount > 0 || mapped) return mapped;
  }
  if (cmap.size > 0 && upper.length % 2 === 0) {
    let mapped2 = '';
    for (let i = 0; i + 1 < upper.length; i += 2) {
      const seg = upper.slice(i, i + 2);
      if (cmap.has(seg)) mapped2 += cmap.get(seg);
      else {
        const b = parseInt(seg, 16);
        if (b >= 32 && b <= 126) mapped2 += String.fromCharCode(b);
      }
    }
    if (mapped2) return mapped2;
  }
  return decodePdfHexToUnicode(upper);
}

function decodePdfLiteralString(inner) {
  const unescaped = inner
    .replace(/\\([0-7]{1,3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)))
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\\(/g, '(')
    .replace(/\\\)/g, ')')
    .replace(/\\\\/g, '\\');
  const rawBytes = Buffer.from(unescaped, 'latin1');
  if (rawBytes.length >= 2 && rawBytes[0] === 0xfe && rawBytes[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(rawBytes.subarray(2));
  }
  return decodeSmartBuffer(rawBytes);
}

/**
 * 解析 Jupyter Notebook (.ipynb)
 */
function parseIpynbText(rawJson) {
  try {
    const nb = JSON.parse(rawJson);
    if (!Array.isArray(nb.cells)) return rawJson;
    return nb.cells
      .map((cell, idx) => {
        const src = Array.isArray(cell.source) ? cell.source.join('') : String(cell.source || '');
        if (!src.trim()) return '';
        if (cell.cell_type === 'code') {
          return `### [代码单元 ${idx + 1}]\n\`\`\`python\n${src.trim()}\n\`\`\``;
        }
        return src.trim();
      })
      .filter(Boolean)
      .join('\n\n');
  } catch {
    return rawJson;
  }
}

/**
 * 根据文件名识别友好的分类徽章与标签
 */
function classifyFileBadge(filename = '') {
  const ext = path.extname(filename).replace(/^\./, '').toLowerCase();
  if (ext === 'pdf') return { badge: 'PDF', color: 'pdf', label: 'PDF 文档' };
  if (['docx', 'doc', 'rtf', 'odt'].includes(ext)) return { badge: 'WORD', color: 'word', label: 'Word 文档' };
  if (['xlsx', 'xls', 'csv', 'tsv', 'ods'].includes(ext)) return { badge: 'EXCEL', color: 'excel', label: '电子表格' };
  if (['pptx', 'ppt', 'odp'].includes(ext)) return { badge: 'PPT', color: 'ppt', label: '演示文稿' };
  if (['zip', 'tar', 'gz'].includes(ext)) return { badge: 'ZIP', color: 'zip', label: '压缩包' };
  if (['epub'].includes(ext)) return { badge: 'EPUB', color: 'word', label: '电子书' };
  if (['md', 'markdown', 'txt', 'log', 'srt', 'vtt'].includes(ext)) {
    return { badge: ext.toUpperCase().slice(0, 4) || 'TXT', color: 'txt', label: '文本文档' };
  }
  if (
    [
      'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'vue', 'py', 'ipynb', 'java', 'kt',
      'c', 'h', 'cpp', 'hpp', 'cs', 'go', 'rs', 'php', 'rb', 'swift', 'sql',
      'html', 'htm', 'css', 'scss', 'json', 'jsonl', 'xml', 'yaml', 'yml', 'toml', 'ini', 'sh', 'ps1', 'bat'
    ].includes(ext)
  ) {
    return { badge: ext.toUpperCase().slice(0, 5) || 'CODE', color: 'code', label: '代码/数据文件' };
  }
  return { badge: (ext || 'FILE').toUpperCase().slice(0, 5), color: 'file', label: '附件文档' };
}

/**
 * 统一全格式文件解析主入口
 * @param {{ name: string, mime?: string, buffer: Buffer }} input
 */
function parseAnyUploadedFile({ name, mime = '', buffer }) {
  const safeName = String(name || '未命名文件').slice(0, 160);
  const ext = path.extname(safeName).replace(/^\./, '').toLowerCase();
  const meta = classifyFileBadge(safeName);
  const byteSize = Buffer.isBuffer(buffer) ? buffer.length : 0;

  if (!byteSize) {
    return {
      ok: true,
      name: safeName,
      size: 0,
      badge: meta.badge,
      color: meta.color,
      label: meta.label,
      char_count: 0,
      content: `（空文件：${safeName}，0 字节）`
    };
  }

  let extracted = '';
  let parseWarning = '';

  try {
    if (ext === 'pdf' || mime === 'application/pdf') {
      extracted = parsePdfBuffer(buffer);
      if (!extracted) {
        parseWarning = '该 PDF 页面主要为扫描图片（无内嵌文字层），已记录文档元信息。';
      }
    } else if (ext === 'docx') {
      extracted = parseDocxBuffer(buffer);
    } else if (ext === 'doc' || ext === 'rtf') {
      extracted = parseLegacyDocOrRtf(buffer, ext);
    } else if (ext === 'xlsx') {
      extracted = parseXlsxBuffer(buffer);
    } else if (ext === 'pptx') {
      extracted = parsePptxBuffer(buffer);
    } else if (ext === 'odt' || ext === 'epub') {
      extracted = parseOdtOrEpubBuffer(buffer, ext);
    } else if (ext === 'zip') {
      extracted = parseZipArchiveBuffer(buffer);
    } else if (ext === 'ipynb') {
      extracted = parseIpynbText(decodeSmartBuffer(buffer));
    } else if (ext === 'html' || ext === 'htm') {
      const rawHtml = decodeSmartBuffer(buffer);
      extracted = rawHtml.length <= 24000 ? rawHtml : stripHtmlToReadableText(rawHtml);
    } else if (looksLikeTextBuffer(buffer)) {
      extracted = decodeSmartBuffer(buffer);
    } else if (buffer.length >= 4 && buffer.readUInt32LE(0) === 0x04034b50) {
      // 未知后缀但实际是 ZIP 容器格式
      extracted = parseZipArchiveBuffer(buffer);
    } else {
      parseWarning = `二进制格式文件（${meta.badge}，大小 ${(byteSize / 1024).toFixed(1)} KB），暂无法直接提取纯文本字节。`;
    }
  } catch (err) {
    if (looksLikeTextBuffer(buffer)) {
      extracted = decodeSmartBuffer(buffer);
    } else {
      parseWarning = `文件解析提示：${err.message || '包含特殊封装格式'}`;
    }
  }

  const trimmed = String(extracted || '').trim();
  const truncated = trimmed.length > MAX_EXTRACTED_CHARS;
  const finalContent = trimmed
    ? truncated
      ? `${trimmed.slice(0, MAX_EXTRACTED_CHARS)}\n\n…（文档较长，已自动截取前 ${MAX_EXTRACTED_CHARS} 字核心内容供分析）`
      : trimmed
    : `【文件信息】文件名：${safeName}，类型：${meta.label}，文件大小：${(byteSize / 1024).toFixed(1)} KB。${
        parseWarning ? `\n说明：${parseWarning}` : ''
      }`;

  return {
    ok: true,
    name: safeName,
    size: byteSize,
    badge: meta.badge,
    color: meta.color,
    label: meta.label,
    char_count: trimmed.length,
    truncated,
    warning: parseWarning,
    content: finalContent
  };
}

module.exports = {
  parseAnyUploadedFile,
  classifyFileBadge,
  decodeSmartBuffer
};

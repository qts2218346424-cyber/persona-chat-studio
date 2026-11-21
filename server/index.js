const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { URL } = require('node:url');

const {
  db,
  genId,
  STORY_SCRIPTS,
  listScriptsForUser,
  saveWorkshopScriptForUser,
  listCommunityShares,
  publishExistingToSquare,
  toggleLikeShareItem,
  adoptShareItemToUser,
  getSafeClientSettings,
  updateSafeClientSettings,
  getExecutionSettingsForUser,
  canUserBindOwnDeepSeekKey,
  getRawUserOwnDeepSeekConfig,
  validateOfficialDeepSeekApiKey,
  validateSafeUserApiBaseUrl,
  sanitizeUserModelName,
  normalizeModelForEndpoint,
  isFreeExperienceMode,
  OFFICIAL_DEEPSEEK_CHAT_URL,
  getRawPlatformConfigInternal,
  updateAdminPlatformConfig,
  registerUser,
  loginUser,
  loginDemoAccount,
  getUserByToken,
  revokeAuthToken,
  markUserOnboardingDone,
  updateUserPersona,
  getMembership,
  recordUserDailyEvent,
  performDailyCheckin,
  claimTaskReward,
  createAndFulfillRechargeOrder,
  exchangePointsItem,
  redeemMembershipCode,
  resetMembershipToFree,
  verifyOnlineChatAccess,
  consumeOnlineCredit,
  getWalletOverview,
  listAdminRedeemCodes,
  generateAdminRedeemCodes,
  deleteAdminRedeemCode,
  getAdminDashboardData,
  adminAdjustUserAssets,
  updateAdminCredentials,
  adminResetUserPassword,
  adminToggleUserBan,
  adminSetUserRole,
  adminDeleteUser,
  getLatestAnnouncement,
  getAdminAnnouncementsList,
  saveAdminAnnouncement
} = require('./db');
const {
  replaceRoleplayMacros,
  decorateMemoriesWithRetention,
  extractFactsFromUserTurn,
  compressOverflowHistorySync,
  resolveEffectivePersona,
  buildThreeTierContext
} = require('./memoryEngine');
const {
  formatNurturingSnapshot,
  evaluateTurnNurturing,
  runDreamConsolidation
} = require('./nurturingEngine');
const { streamPersonaChat } = require('./llmGateway');
const {
  parsePersonaDocument,
  parseChatHistoryDocument,
  buildSessionMemoryMarkdown
} = require('./docImporter');
const {
  resolveOrGenerateCompanion,
  buildCompanionReminder,
  buildOfflineVoiceChatReply
} = require('./companionEngine');
const {
  VOICE_CATALOG,
  resolveVoiceForCompanion,
  cloneReferenceVoice,
  synthesizeNeuralSpeech,
  warmupTtsEngine
} = require('./ttsService');
const {
  resolveDeepSeekEndpoints,
  getEffectiveApiCredentials,
  resolveSuiteOrBridgeCredentials,
  fetchDeepSeekBalance,
  fetchDeepSeekModels,
  NativeThinkSplitter,
  streamDeepSeekNativeSuite,
  runDeepSeekFimCompletion
} = require('./deepseekApiSuite');
const {
  loadBridgeRuntime,
  detectLocalAntigravityStatus,
  streamViaLocalAntigravityCli,
  getLocalAntigravityCliPath
} = require('./antigravityBridge');
const {
  buildProactiveTriggerInstruction,
  generateDemoProactiveTurn,
  generateFollowUpSuggestions,
  generateDynamicFollowUpsWithLLM
} = require('./proactiveEngine');
const { analyzeAndOptimizeScript } = require('./scriptWorkshop');
const { parseAnyUploadedFile } = require('./fileParser');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const PORT = parseInt(process.env.PORT || '3210', 10);
const COOKIE_NAME = 'star_session';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ico': 'image/x-icon',
  '.apk': 'application/vnd.android.package-archive'
};

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  for (const pair of header.split(';')) {
    const idx = pair.indexOf('=');
    if (idx === -1) continue;
    const k = pair.slice(0, idx).trim();
    const v = pair.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

function buildAuthCookie(token, maxAgeSec = 30 * 24 * 3600) {
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; Path=/; Max-Age=${maxAgeSec}; SameSite=Lax`;
}

function buildClearCookie() {
  return `${COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`;
}

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Permitted-Cross-Domain-Policies': 'none'
};

// 内存滑动窗口防暴力破解限流器（防密码爆破、防卡密穷举、防恶意刷号）
const rateLimitBuckets = new Map();
function checkRateLimit(bucketKey, maxHits, windowMs = 60000) {
  const now = Date.now();
  let record = rateLimitBuckets.get(bucketKey);
  if (!record || record.resetAt <= now) {
    record = { count: 0, resetAt: now + windowMs };
    rateLimitBuckets.set(bucketKey, record);
  }
  record.count += 1;
  if (rateLimitBuckets.size > 5000) {
    for (const [k, v] of rateLimitBuckets.entries()) {
      if (v.resetAt <= now) rateLimitBuckets.delete(k);
    }
  }
  return record.count <= maxHits;
}

function getClientIp(req) {
  const socketIp = String(req.socket?.remoteAddress || '127.0.0.1');
  const isTrustedLocalProxy =
    socketIp === '127.0.0.1' ||
    socketIp === '::1' ||
    socketIp === '::ffff:127.0.0.1';
  if (isTrustedLocalProxy) {
    const cfIp = String(req.headers['cf-connecting-ip'] || '').trim();
    if (cfIp) return cfIp;
    const realIp = String(req.headers['x-real-ip'] || '').trim();
    if (realIp) return realIp;
    const xff = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (xff) return xff;
  }
  return socketIp;
}

// 防 SSRF（服务端请求伪造）：校验站长配置的外部网关 URL 严禁指向内网/环回/云元数据地址
function assertSafeExternalGatewayUrl(rawUrl, fieldLabel = '接口地址') {
  const str = String(rawUrl || '').trim();
  if (!str) return;
  let parsed;
  try {
    parsed = new URL(str);
  } catch {
    throw new Error(`${fieldLabel}格式不合法`);
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`${fieldLabel}仅支持 HTTPS / HTTP 协议`);
  }
  if (parsed.username || parsed.password) {
    throw new Error(`${fieldLabel}禁止内嵌认证凭据`);
  }
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const isPrivateOrLoopback =
    host === 'localhost' ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host);
  if (isPrivateOrLoopback) {
    throw new Error(`安全拦截：${fieldLabel}禁止指向本机环回或私有内网地址`);
  }
}

function sanitizeCustomImageInput(rawImg) {
  const str = String(rawImg || '').trim();
  if (!str) return '';
  if (str.startsWith('/assets/')) return str.slice(0, 260);
  if (/^https:\/\/[^\s"'<>]+$/i.test(str)) return str.slice(0, 500);
  if (/^data:image\/(?:png|jpeg|jpg|webp|gif);base64,[a-zA-Z0-9+/=]+$/i.test(str) && str.length <= 2 * 1024 * 1024) {
    return str;
  }
  throw new Error('仅支持上传 PNG / JPG / WEBP / GIF 格式的安全图片');
}

function sendJson(res, statusCode, payload, extraHeaders = {}) {
  const rawBuf = Buffer.from(JSON.stringify(payload), 'utf8');
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...SECURITY_HEADERS,
    ...extraHeaders
  };
  const hasExplicitEncoding = Object.keys(extraHeaders).some(
    (k) => k.toLowerCase() === 'content-encoding'
  );
  let outBuf = rawBuf;
  if (!hasExplicitEncoding && rawBuf.length >= 1024) {
    const acceptEncoding = String(res._acceptEncoding || '');
    if (/\bbr\b/i.test(acceptEncoding)) {
      outBuf = zlib.brotliCompressSync(rawBuf, {
        params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4 }
      });
      headers['Content-Encoding'] = 'br';
      headers['Vary'] = 'Accept-Encoding';
    } else if (/\bgzip\b/i.test(acceptEncoding)) {
      outBuf = zlib.gzipSync(rawBuf, { level: 6 });
      headers['Content-Encoding'] = 'gzip';
      headers['Vary'] = 'Accept-Encoding';
    }
  }
  headers['Content-Length'] = outBuf.length;
  res.writeHead(statusCode, headers);
  if (res._reqMethod === 'HEAD') {
    res.end();
    return;
  }
  res.end(outBuf);
}

function sanitizePublicErrorMessage(err, fallback = '请求处理失败，请稍后重试') {
  const raw = String(err?.message || '').trim();
  if (!raw) return fallback;
  return raw
    .replace(/sk-[a-zA-Z0-9_-]{6,}/gi, '[已脱敏密钥]')
    .replace(/Bearer\s+[^\s"']+/gi, 'Bearer [已脱敏]')
    .replace(/(?:[A-Za-z]:\\|\/Users\/|\/home\/)[^\s"']+/g, '[内部路径]')
    .slice(0, 180);
}

function readRawBufferBody(req, maxBytes = 20 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let byteLen = 0;
    let tooLarge = false;
    req.on('data', (chunk) => {
      byteLen += chunk.length;
      if (byteLen > maxBytes) {
        tooLarge = true;
        if (byteLen > maxBytes + 2 * 1024 * 1024) {
          req.destroy();
        }
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (tooLarge) {
        return reject(Object.assign(new Error('单个上传文件体积请控制在 20MB 以内'), { statusCode: 413 }));
      }
      resolve(Buffer.concat(chunks));
    });
    req.on('error', reject);
  });
}

function readJsonBody(req, maxBytes = 128 * 1024) {
  return new Promise((resolve, reject) => {
    let raw = '';
    let byteLen = 0;
    let tooLarge = false;
    req.on('data', (chunk) => {
      byteLen += chunk.length;
      if (byteLen > maxBytes) {
        tooLarge = true;
        if (byteLen > maxBytes + 2 * 1024 * 1024) {
          req.destroy();
        }
        return;
      }
      raw += chunk;
    });
    req.on('end', () => {
      if (tooLarge) {
        return reject(Object.assign(new Error('请求载荷体积超出安全上限'), { statusCode: 413 }));
      }
      if (!raw.trim()) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(Object.assign(new Error('无效的 JSON 请求格式'), { statusCode: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function formatPersonaRow(row) {
  if (!row) return null;
  let starterPrompts = [];
  try {
    starterPrompts = JSON.parse(row.starter_prompts || '[]');
  } catch {
    starterPrompts = [];
  }
  return {
    ...row,
    starter_prompts: Array.isArray(starterPrompts) ? starterPrompts : []
  };
}

function listPersonasForUser(userId) {
  const rows = db
    .prepare("SELECT * FROM personas WHERE user_id = ? OR user_id = 'system' ORDER BY CASE WHEN user_id = ? THEN 0 ELSE 1 END, updated_at DESC")
    .all(userId, userId);
  return rows.map(formatPersonaRow);
}

function listSessionsForUser(userId) {
  const rows = db
    .prepare(`
      SELECT s.id, s.user_id, s.persona_id, s.title, s.title_locked, s.session_mode, s.pinned,
             s.affection, s.trust, s.intimacy, s.current_mood, s.proactive_enabled,
             s.enable_inner_thought, s.enable_auto_memory, s.ds_thinking, s.ds_search,
             s.ds_json_mode, s.ds_tools_enabled, s.summarized_until_msg_id,
             s.updated_at, s.created_at, s.custom_persona_override,
             (TRIM(COALESCE(s.session_prompt, '')) != '' OR TRIM(COALESCE(s.director_note, '')) != '') AS has_session_prompt,
             p.name AS persona_name, p.avatar AS persona_avatar, p.script_id AS script_id,
             (SELECT COUNT(*) FROM messages m WHERE m.session_id = s.id) AS message_count,
             (SELECT COUNT(*) FROM memories mem WHERE mem.session_id = s.id) AS memory_count
      FROM sessions s
      LEFT JOIN personas p ON p.id = s.persona_id
      WHERE s.user_id = ?
      ORDER BY COALESCE(s.pinned, 0) DESC, s.updated_at DESC
    `)
    .all(userId);

  return rows.map((row) => {
    let personaName = row.persona_name;
    let personaAvatar = row.persona_avatar;
    let hasOverride = false;
    if (row.custom_persona_override) {
      try {
        const ov = JSON.parse(row.custom_persona_override);
        if (ov && typeof ov === 'object') {
          if (ov.name && String(ov.name).trim()) personaName = String(ov.name).trim();
          if (ov.avatar && String(ov.avatar).trim()) personaAvatar = String(ov.avatar).trim();
          hasOverride = Object.values(ov).some((v) => typeof v === 'string' && v.trim());
        }
      } catch {}
    }
    const { custom_persona_override: _droppedOverride, has_session_prompt: hasSessionPrompt, ...slimRow } = row;
    return {
      ...slimRow,
      persona_name: personaName,
      persona_avatar: personaAvatar,
      has_persona_override: hasOverride,
      has_custom_setting: Boolean(hasOverride || hasSessionPrompt)
    };
  });
}

function buildSessionDetailPayload(session, userId, opts = {}) {
  const safeLimit = Math.min(200, Math.max(10, parseInt(opts.limit || '60', 10) || 60));
  const beforeId = Math.max(0, parseInt(opts.beforeId || '0', 10) || 0);
  const loadAll = Boolean(opts.loadAll);
  const sessionId = session.id;

  const totalMessages = Number(
    db.prepare('SELECT COUNT(*) AS cnt FROM messages WHERE session_id = ?').get(sessionId)?.cnt || 0
  );

  let messages;
  if (loadAll) {
    messages = db
      .prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY id ASC')
      .all(sessionId);
  } else if (beforeId > 0) {
    messages = db
      .prepare('SELECT * FROM (SELECT * FROM messages WHERE session_id = ? AND id < ? ORDER BY id DESC LIMIT ?) ORDER BY id ASC')
      .all(sessionId, beforeId, safeLimit);
  } else {
    messages = db
      .prepare('SELECT * FROM (SELECT * FROM messages WHERE session_id = ? ORDER BY id DESC LIMIT ?) ORDER BY id ASC')
      .all(sessionId, safeLimit);
  }

  const oldestMessageId = messages.length > 0 ? Number(messages[0].id || 0) : 0;
  const hasMoreMessages = !loadAll && oldestMessageId > 0
    ? Boolean(db.prepare('SELECT 1 FROM messages WHERE session_id = ? AND id < ? LIMIT 1').get(sessionId, oldestMessageId))
    : false;

  const persona = formatPersonaRow(resolveEffectivePersona(session));
  const rawMemories = db
    .prepare('SELECT * FROM memories WHERE session_id = ? ORDER BY pinned DESC, importance DESC, updated_at DESC')
    .all(sessionId);
  const lorebooks = db
    .prepare("SELECT * FROM lorebook_entries WHERE persona_id = ? AND (user_id = 'system' OR user_id = ?) ORDER BY created_at DESC")
    .all(session.persona_id, userId);
  const settings = opts.settings || getSafeClientSettings(userId);
  const winLimit = Math.max(8, parseInt(settings.sliding_window_turns || '40', 10) || 40);
  const activeWinMsgs = messages.slice(-winLimit);
  const estLen = (str) => Math.ceil(String(str || '').length * 0.65);
  const tier1Est = estLen(`${persona.name || ''}${persona.personality || ''}${persona.backstory || ''}${persona.speaking_style || ''}${session.session_prompt || ''}`);
  const tier2Est =
    estLen(session.rolling_summary || '') +
    rawMemories.slice(0, 16).reduce((s, m) => s + estLen(m.content), 0);
  const tier3Est = activeWinMsgs.reduce((s, m) => s + estLen(m.content), 0);
  const fastTelemetry = {
    tier1PersonaTokens: tier1Est,
    tier2MemoryTokens: tier2Est,
    tier3WindowTokens: tier3Est,
    totalTokens: tier1Est + tier2Est + tier3Est,
    activeWindowCount: activeWinMsgs.length,
    totalHistoryCount: totalMessages,
    recalledMemoryCount: Math.min(rawMemories.length, parseInt(settings.max_recalled_memories || '16', 10) || 16),
    triggeredLoreCount: 0
  };

  let savedComp = null;
  try {
    if (session.companion_config) savedComp = JSON.parse(session.companion_config);
  } catch {}
  const companion = resolveOrGenerateCompanion({ persona, currentConfig: savedComp });

  return {
    session,
    persona,
    messages,
    total_messages: totalMessages,
    has_more_messages: hasMoreMessages,
    oldest_message_id: oldestMessageId,
    memories: decorateMemoriesWithRetention(rawMemories),
    lorebooks,
    nurturing: formatNurturingSnapshot(session),
    companion,
    telemetry: fastTelemetry,
    membership: opts.membership || getMembership(userId)
  };
}

function extractAuthToken(req, parsedUrl = null) {
  const authHeader = String(req.headers.authorization || '').trim();
  if (/^Bearer\s+/i.test(authHeader)) {
    const bearerToken = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (bearerToken) return bearerToken;
  }
  const cookies = parseCookies(req);
  if (cookies[COOKIE_NAME]) return cookies[COOKIE_NAME];
  if (parsedUrl && parsedUrl.searchParams) {
    const qToken = parsedUrl.searchParams.get('token');
    if (qToken) return qToken.trim();
  }
  return '';
}

const APP_LATEST_VERSION = '2.0.0';
const APP_LATEST_VERSION_CODE = 130;
const APP_OFFICIAL_CERT_SHA256 = '6fd05e32a3cabf327140129d866e55a342fe30daa3384c67aad4b3cbdd98a17b';
const APP_UPDATE_TICKET_SECRET = crypto
  .createHash('sha256')
  .update((process.env.SESSION_SECRET || 'starwhisper_upd_v1') + ':' + APP_OFFICIAL_CERT_SHA256)
  .digest('hex');

let cachedApkMeta = {
  apkPath: '',
  mtimeMs: -1,
  size: -1,
  sha256: ''
};

function getApkFileMeta() {
  const apkPath = path.join(__dirname, '../public/downloads/deepseek-studio.apk');
  try {
    if (!fs.existsSync(apkPath)) {
      return { exists: false, apkPath, size: 0, mtimeMs: 0, sha256: '' };
    }
    const stat = fs.statSync(apkPath);
    if (
      cachedApkMeta.apkPath === apkPath &&
      cachedApkMeta.mtimeMs === stat.mtimeMs &&
      cachedApkMeta.size === stat.size &&
      cachedApkMeta.sha256
    ) {
      return { exists: true, apkPath, size: stat.size, mtimeMs: stat.mtimeMs, sha256: cachedApkMeta.sha256 };
    }
    const hash = crypto.createHash('sha256');
    const fd = fs.openSync(apkPath, 'r');
    try {
      const buf = Buffer.allocUnsafe(65536);
      let bytesRead = 0;
      while ((bytesRead = fs.readSync(fd, buf, 0, buf.length, null)) > 0) {
        hash.update(bytesRead === buf.length ? buf : buf.subarray(0, bytesRead));
      }
    } finally {
      fs.closeSync(fd);
    }
    const sha256 = hash.digest('hex').toLowerCase();
    cachedApkMeta = { apkPath, mtimeMs: stat.mtimeMs, size: stat.size, sha256 };
    return { exists: true, apkPath, size: stat.size, mtimeMs: stat.mtimeMs, sha256 };
  } catch {
    return { exists: false, apkPath, size: 0, mtimeMs: 0, sha256: '' };
  }
}

function signApkUpdateTicket(verCode, ttlMs = 10 * 60 * 1000) {
  const vc = Math.max(1, parseInt(verCode, 10) || 1);
  const exp = Date.now() + ttlMs;
  const data = `${vc}.${exp}`;
  const sig = crypto.createHmac('sha256', APP_UPDATE_TICKET_SECRET).update(data).digest('hex');
  return `${data}.${sig}`;
}

function verifyApkUpdateTicket(ticketStr) {
  const raw = String(ticketStr || '').trim();
  const parts = raw.split('.');
  if (parts.length !== 3) return false;
  const [vcStr, expStr, sigHex] = parts;
  if (!/^\d+$/.test(vcStr) || !/^\d+$/.test(expStr) || !/^[0-9a-f]{64}$/i.test(sigHex)) {
    return false;
  }
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp <= Date.now()) {
    return false;
  }
  const expectedHex = crypto
    .createHmac('sha256', APP_UPDATE_TICKET_SECRET)
    .update(`${vcStr}.${expStr}`)
    .digest('hex');
  const a = Buffer.from(sigHex.toLowerCase(), 'hex');
  const b = Buffer.from(expectedHex, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

const APP_VERSION_CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Range, X-Requested-With',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Content-Disposition, X-APK-SHA256',
  'Cache-Control': 'no-store, no-cache, must-revalidate'
};

async function handleApi(req, res, pathname, parsedUrl) {
  const method = req.method || 'GET';
  const currentToken = extractAuthToken(req, parsedUrl);
  const currentUser = getUserByToken(currentToken);

  // ========= 0. 服务健康探针公开接口 =========
  if (method === 'GET' && pathname === '/api/health') {
    return sendJson(res, 200, {
      ok: true,
      service: 'persona-chat-studio',
      port: PORT,
      uptime: Math.round(process.uptime()),
      ts: Date.now()
    });
  }

  // ========= 0.0 本地 Antigravity 宿主智能体底座状态探针 =========
  if (method === 'GET' && pathname === '/api/antigravity/status') {
    return sendJson(res, 200, detectLocalAntigravityStatus());
  }

  // ========= 0.1 客户端版本更新检查公开接口 =========
  if (method === 'OPTIONS' && (pathname === '/api/app-version' || pathname === '/api/version' || pathname === '/api/app-update/download')) {
    res.writeHead(204, {
      ...APP_VERSION_CORS_HEADERS,
      ...SECURITY_HEADERS
    });
    res.end();
    return;
  }

  if (method === 'GET' && (pathname === '/api/app-version' || pathname === '/api/version')) {
    const apkMeta = getApkFileMeta();
    const apkSizeBytes = apkMeta.exists ? apkMeta.size : 8859467;
    const apkFileName = `DeepSeek_StarWhisper_v${APP_LATEST_VERSION}.apk`;

    const client = String(parsedUrl.searchParams.get('client') || '').trim();
    const curCode = Number(parsedUrl.searchParams.get('curCode') || '0');
    const sig = String(parsedUrl.searchParams.get('sig') || '')
      .replace(/:/g, '')
      .trim()
      .toLowerCase();

    const diffGenerations = curCode > 0 ? Math.max(0, APP_LATEST_VERSION_CODE - curCode) : 0;
    const forceUpdate = curCode > 0 && diffGenerations >= 3;

    const payload = {
      ok: true,
      latestVersion: APP_LATEST_VERSION,
      versionCode: APP_LATEST_VERSION_CODE,
      minSupportedVersion: '1.0.0',
      releaseDate: '2026-11-21',
      fileSize: (apkSizeBytes / (1024 * 1024)).toFixed(2) + ' MB',
      fileSizeBytes: apkSizeBytes,
      sha256: apkMeta.sha256 || '',
      apkFileName,
      downloadUrl: '/api/download/apk',
      fallbackDownloadUrl: 'https://star.claudexxb.online/api/download/apk',
      githubReleasesUrl: 'https://github.com/qts2218346424-cyber/persona-chat-studio/releases',
      serverTime: Date.now(),
      forceUpdate,
      diffGenerations,
      changelog: [
        '手机端登录持久化深度加固：账户信息与真实昵称实现 Android 原生落盘，解决登录后退回默认名字问题',
        '手机辅助执行需确认步骤悬浮窗强提醒：悬浮窗即刻弹出横幅与呼吸灯，支持在其他应用中一键允许或取消',
        '悬浮窗面板新增「停止」按钮：清晰区分常规停止与红色最高优先级安全急停',
        '开屏阶梯式更新与系统公告：落后 3 代强制更新保障核心安全，站长可在线发布全站公告'
      ]
    };

    if (
      client === 'android_apk' &&
      Number.isFinite(curCode) &&
      curCode > 0 &&
      sig === APP_OFFICIAL_CERT_SHA256
    ) {
      const ticket = signApkUpdateTicket(curCode, 10 * 60 * 1000);
      payload.nativeUpdateUrl = `https://star.claudexxb.online/api/app-update/download?ticket=${encodeURIComponent(ticket)}`;
    }

    return sendJson(res, 200, payload, APP_VERSION_CORS_HEADERS);
  }

  // ========= 0.1a 全站公开系统公告查询接口 =========
  if (method === 'GET' && (pathname === '/api/announcement' || pathname === '/api/site-announcement')) {
    const ann = getLatestAnnouncement();
    return sendJson(res, 200, { ok: true, announcement: ann }, APP_VERSION_CORS_HEADERS);
  }

  // ========= 0.1b 原生客户端签名票据专用安全更新下载接口 (支持 HEAD / Range / 流式校验) =========
  if ((method === 'GET' || method === 'HEAD') && pathname === '/api/app-update/download') {
    const ticket = parsedUrl.searchParams.get('ticket') || '';
    const ticketOk = verifyApkUpdateTicket(ticket);
    if (!ticketOk && !currentUser) {
      return sendJson(
        res,
        403,
        { ok: false, error: '更新票据无效或已过期，请重新点击检查更新', code: 'UPDATE_TICKET_INVALID' },
        APP_VERSION_CORS_HEADERS
      );
    }

    const apkMeta = getApkFileMeta();
    if (!apkMeta.exists) {
      return sendJson(res, 404, { ok: false, error: '安装包暂未就绪，请稍后重试' }, APP_VERSION_CORS_HEADERS);
    }

    const totalSize = apkMeta.size;
    const apkFileName = `DeepSeek_StarWhisper_v${APP_LATEST_VERSION}.apk`;
    const commonHeaders = {
      'Content-Type': 'application/vnd.android.package-archive',
      'Content-Disposition': `attachment; filename="${apkFileName}"`,
      'Accept-Ranges': 'bytes',
      'X-APK-SHA256': apkMeta.sha256,
      ...APP_VERSION_CORS_HEADERS,
      ...SECURITY_HEADERS
    };

    if (method === 'HEAD') {
      res.writeHead(200, {
        ...commonHeaders,
        'Content-Length': totalSize
      });
      res.end();
      return;
    }

    const rangeHdr = String(req.headers.range || '').trim();
    if (rangeHdr) {
      const m = rangeHdr.match(/^bytes=(\d*)-(\d*)$/i);
      if (m) {
        let start = m[1] === '' ? 0 : parseInt(m[1], 10);
        let end = m[2] === '' ? totalSize - 1 : parseInt(m[2], 10);
        if (m[1] === '' && m[2] !== '') {
          const suffixLen = parseInt(m[2], 10);
          start = Math.max(0, totalSize - suffixLen);
          end = totalSize - 1;
        }
        if (Number.isFinite(start) && Number.isFinite(end) && start >= 0 && start <= end && end < totalSize) {
          const chunkLen = end - start + 1;
          res.writeHead(206, {
            ...commonHeaders,
            'Content-Range': `bytes ${start}-${end}/${totalSize}`,
            'Content-Length': chunkLen
          });
          fs.createReadStream(apkMeta.apkPath, { start, end }).pipe(res);
          return;
        }
        res.writeHead(416, {
          'Content-Range': `bytes */${totalSize}`,
          ...APP_VERSION_CORS_HEADERS,
          ...SECURITY_HEADERS
        });
        res.end();
        return;
      }
    }

    res.writeHead(200, {
      ...commonHeaders,
      'Content-Length': totalSize
    });
    fs.createReadStream(apkMeta.apkPath).pipe(res);
    return;
  }

  // ========= 0.2 受保护的 APK 官方客户端下载接口（严格鉴权，未注册/未登录拒绝下载） =========
  if (method === 'GET' && (pathname === '/api/download/apk' || pathname === '/downloads/deepseek-studio.apk')) {
    if (!currentUser) {
      const accept = String(req.headers.accept || '');
      if (accept.includes('application/json')) {
        return sendJson(res, 401, {
          error: '请先注册并登录正式账号后，再下载 APK 客户端',
          code: 'LOGIN_REQUIRED'
        });
      }
      // 浏览器直链点击拦截：重定向回首页并唤起注册登录面板
      res.writeHead(302, {
        Location: '/?auth=login&msg=download_login_required',
        ...SECURITY_HEADERS
      });
      res.end();
      return;
    }

    const apkMeta = getApkFileMeta();
    if (!apkMeta.exists) {
      return sendJson(res, 404, { error: 'APK 安装包生成中，请稍后刷新重试' });
    }

    res.writeHead(200, {
      'Content-Type': 'application/vnd.android.package-archive',
      'Content-Length': apkMeta.size,
      'Content-Disposition': `attachment; filename="DeepSeek_StarWhisper_v${APP_LATEST_VERSION}.apk"`,
      'Accept-Ranges': 'bytes',
      'X-APK-SHA256': apkMeta.sha256,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      ...SECURITY_HEADERS
    });
    fs.createReadStream(apkMeta.apkPath).pipe(res);
    return;
  }

  // ========= 1. 账号认证公开接口 =========
  if (method === 'GET' && pathname === '/api/auth/me') {
    if (!currentUser) {
      return sendJson(res, 200, { authenticated: false });
    }
    return sendJson(res, 200, { authenticated: true, user: currentUser, token: currentToken });
  }

  if (method === 'POST' && pathname === '/api/auth/register') {
    const ip = getClientIp(req);
    if (!checkRateLimit(`reg:${ip}`, 12, 60000)) {
      return sendJson(res, 429, { error: '注册请求过于频繁，请 1 分钟后再试' });
    }
    const body = await readJsonBody(req, 32 * 1024);
    try {
      const { user, token, gifted_vip, gifted_days } = registerUser({
        email: body.email,
        nickname: body.nickname,
        password: body.password,
        avatar: body.avatar
      });
      return sendJson(res, 201, { user, token, gifted_vip, gifted_days }, { 'Set-Cookie': buildAuthCookie(token) });
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
  }

  if (method === 'POST' && pathname === '/api/auth/login') {
    const ip = getClientIp(req);
    if (!checkRateLimit(`login_attempt:${ip}`, 12, 60000)) {
      return sendJson(res, 429, { error: '登录尝试过于频繁，请 1 分钟后再试' });
    }
    const body = await readJsonBody(req, 16 * 1024);
    try {
      const { user, token } = loginUser({
        email: body.email,
        password: body.password
      });
      return sendJson(res, 200, { user, token }, { 'Set-Cookie': buildAuthCookie(token) });
    } catch (err) {
      return sendJson(res, 401, { error: err.message || '邮箱账号或密码不正确，请检查后重试' });
    }
  }

  if (method === 'POST' && pathname === '/api/auth/demo-login') {
    return sendJson(res, 401, {
      error: '系统已启用严格注册模式：免注册体验通道已关闭，请先注册正式账号登录后再使用',
      code: 'AUTH_REQUIRED'
    });
  }

  if (method === 'POST' && pathname === '/api/auth/logout') {
    if (currentToken) revokeAuthToken(currentToken);
    return sendJson(res, 200, { ok: true }, { 'Set-Cookie': buildClearCookie() });
  }

  // 允许通过单次 /api/bootstrap?check_auth=1 探明登录态并顺带取回工作台与首会话，消除 auth/me 串行 RTT
  if (method === 'GET' && pathname === '/api/bootstrap' && parsedUrl.searchParams.get('check_auth') === '1' && !currentUser) {
    return sendJson(res, 200, { authenticated: false });
  }

  // ========= 登录态守卫：以下业务接口均需已登录账号 =========
  if (!currentUser) {
    return sendJson(res, 401, { error: '请先登录您的星语恋庭账号', code: 'AUTH_REQUIRED' });
  }

  // 严格防切号串台守卫：若窗口声明的用户 ID 与当前令牌对应用户不一致，立即阻断
  const expectedUserId = String(req.headers['x-expected-user-id'] || '').trim();
  if (expectedUserId && expectedUserId !== currentUser.id) {
    return sendJson(res, 409, {
      error: '检测到当前窗口账户已切换，已自动拦截跨账号操作以保障会话隔离',
      code: 'ACCOUNT_MISMATCH',
      user: currentUser
    });
  }

  const userId = currentUser.id;

  // ========= Phone Agent 手机辅助 dsh-Go 多步规划接口 =========
  if (method === 'POST' && pathname === '/api/phone-agent/plan') {
    const body = await readJsonBody(req);
    const task = String(body.task || '').trim().slice(0, 1000);
    if (!task) {
      return sendJson(res, 400, { ok: false, error: '请提供需要规划的手机操作任务' });
    }

    const screenSize =
      body.screenSize && Number(body.screenSize.width) > 0 && Number(body.screenSize.height) > 0
        ? { width: Number(body.screenSize.width), height: Number(body.screenSize.height) }
        : { width: 1080, height: 2400 };
    const screenNodes = Array.isArray(body.screenNodes) ? body.screenNodes.slice(0, 120) : [];
    const historySteps = Array.isArray(body.history) ? body.history.slice(-10) : [];
    const installedApps = Array.isArray(body.installedApps) ? body.installedApps.slice(0, 80) : [];

    const sysPrompt = [
      '你是星语手机辅助代理（Phone Agent · 参考 dsh-Go 规划架构）。',
      '你的职责是根据用户的目标任务、当前手机屏幕无障碍控件节点树以及历史执行步骤，规划“下一步唯一且精确”的操作。',
      `当前设备屏幕分辨率为 ${screenSize.width}x${screenSize.height}。`,
      '你只能输出一个严格合法的 JSON 对象（不要用 Markdown 代码块包裹，也不要附加前后任何解释文字），格式如下：',
      '{"thought":"简短中文判断依据（35字以内）","action":"动作名","params":{},"summary":"对用户展示的本步中文说明（25字以内）","needConfirm":false}',
      '可用 action 及对应 params 规范：',
      '- launch_app: {"appName":"应用名称，优先参考已安装应用列表"}',
      '- click_node: {"text":"控件精确可见文本或描述","viewId":"可选控件id"}',
      '- click: {"x":像素X,"y":像素Y}',
      '- long_click: {"x":像素X,"y":像素Y}',
      '- swipe: {"x1":起点X,"y1":起点Y,"x2":终点X,"y2":终点Y,"duration":350}',
      '- input: {"text":"要输入的文本","viewId":"可选目标输入框id"}',
      '- home: {}',
      '- back: {}',
      '- recents: {}',
      '- wait: {"ms":1000}',
      '- done: {"message":"任务完成总结"}',
      '- ask_user: {"message":"需要用户手动操作或澄清的问题"}',
      '关键约束：',
      '1. 优先使用 launch_app 打开第三方应用，优先级高于回桌面翻找图标；点选屏幕已有控件时优先用 click_node 或其 bounds 中心点 click。',
      '2. 若控件列表中出现需要向下滚动才能看见的内容，请返回 swipe 向上滑动（例如 y1=1600 -> y2=600）。',
      '3. 若即将触发支付、转账、确认下单、发红包、删除数据、卸载应用、发送消息/邮件/评论、修改系统密码或退出登录等高风险动作，必须将 needConfirm 设为 true。',
      '4. 如果连续 2 次 wait 后屏幕界面节点仍无变化或节点极少（例如自绘弹窗或复杂规格面板），严禁继续返回 wait 或输出纯文字解释，必须尝试 click/swipe 或返回 {"thought":"当前面板控件未暴露","action":"ask_user","params":{"message":"请手动点选规格或完成当前操作后继续"},"summary":"等待手动点选规格","needConfirm":false}。',
      '5. 若处于网页预览或桌面端（无真实屏幕节点，screenNodes 为空且明确说明未在 APK 中运行），可直接给出逻辑演练步骤或 return action="done"。'
    ].join('\n');

    const compactNodes = screenNodes.map((n, idx) => ({
      i: idx,
      t: n.text || '',
      d: n.desc || '',
      id: n.viewId || n.id || '',
      cls: String(n.className || n.cls || '').split('.').pop(),
      clk: Boolean(n.clickable),
      edt: Boolean(n.editable),
      c: n.center || undefined,
      b: n.bounds || ''
    }));

    const userMsg = JSON.stringify({
      task,
      stepIndex: historySteps.length + 1,
      recentHistory: historySteps.map((h) => ({
        step: h.step,
        action: h.action,
        summary: h.summary,
        result: h.result
      })),
      installedAppsPreview: installedApps.map((a) => (typeof a === 'string' ? a : a.name)).slice(0, 40),
      screenNodesCount: compactNodes.length,
      screenNodes: compactNodes
    });

    const extractPlanJson = (raw) => {
      const cleaned = String(raw || '')
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();
      const tryParseClean = (txt) => {
        try {
          return JSON.parse(txt);
        } catch {
          const noTrailingComma = txt.replace(/,\s*([}\]])/g, '$1');
          return JSON.parse(noTrailingComma);
        }
      };
      if (cleaned) {
        try {
          const obj = tryParseClean(cleaned);
          if (obj && typeof obj === 'object' && !Array.isArray(obj)) return obj;
        } catch {}
        for (let i = 0; i < cleaned.length; i++) {
          if (cleaned[i] !== '{') continue;
          let depth = 0;
          let inStr = false;
          let esc = false;
          for (let j = i; j < cleaned.length; j++) {
            const ch = cleaned[j];
            if (inStr) {
              if (esc) esc = false;
              else if (ch === '\\') esc = true;
              else if (ch === '"') inStr = false;
              continue;
            }
            if (ch === '"') inStr = true;
            else if (ch === '{') depth += 1;
            else if (ch === '}') {
              depth -= 1;
              if (depth === 0) {
                const slice = cleaned.slice(i, j + 1);
                try {
                  const obj = tryParseClean(slice);
                  if (obj && typeof obj === 'object' && obj.action) return obj;
                } catch {}
                break;
              }
            }
          }
        }
      }
      throw new Error('模型响应未返回合法 JSON 动作指令');
    };

    const normalizePlan = (obj) => {
      const allowed = new Set([
        'launch_app',
        'click_node',
        'click',
        'long_click',
        'swipe',
        'input',
        'home',
        'back',
        'recents',
        'wait',
        'done',
        'ask_user'
      ]);
      const action = allowed.has(obj?.action) ? obj.action : 'done';
      const params = obj?.params && typeof obj.params === 'object' ? obj.params : {};
      const highRiskKw = /(付款|支付|转账|结算|下单|提交订单|确认购买|发红包|删除|清空|卸载|注销|发送|发布|授权|登录)/;
      const riskText = `${obj?.summary || ''} ${params?.text || ''} ${obj?.thought || ''}`;
      return {
        thought: String(obj?.thought || '已结合当前界面完成分析').slice(0, 160),
        action,
        params,
        summary: String(obj?.summary || `执行 ${action}`).slice(0, 120),
        needConfirm: Boolean(obj?.needConfirm) || (action !== 'done' && action !== 'wait' && action !== 'ask_user' && highRiskKw.test(riskText))
      };
    };

    // 1. 解析凭据来源：若前端显式传递了个人直连 Key（解决 WebView CORS），严格验证并透传且绝不落盘
    const candidates = [];
    const customKeyRaw = String(body.customApiKey || '').trim();
    if (customKeyRaw) {
      try {
        const validKey = validateOfficialDeepSeekApiKey(customKeyRaw);
        const safeUrl = body.customBaseUrl
          ? validateSafeUserApiBaseUrl(body.customBaseUrl)
          : OFFICIAL_DEEPSEEK_CHAT_URL;
        const endpoints = resolveDeepSeekEndpoints(safeUrl);
        const customModel = normalizeModelForEndpoint(
          sanitizeUserModelName(body.customModel || 'deepseek-chat'),
          endpoints.chatUrl
        );
        candidates.push({
          protocol: 'openai',
          url: endpoints.chatUrl,
          apiKey: validKey,
          headers: { Authorization: `Bearer ${validKey}` },
          model: customModel,
          engineName: 'api_direct_proxy'
        });
      } catch (err) {
        return sendJson(res, 400, { ok: false, error: err.message || '个人 API 参数校验失败' });
      }
    } else {
      const execSettings = getExecutionSettingsForUser(userId);
      const suiteCred = resolveSuiteOrBridgeCredentials(execSettings);
      if (suiteCred && suiteCred.hasKey && suiteCred.endpoints?.chatUrl) {
        let modelName = String(body.customModel || suiteCred.preferredModel || 'deepseek-chat').trim();
        if (/reasoner/i.test(modelName) && suiteCred.endpoints.isOfficialDeepSeek) {
          modelName = 'deepseek-chat';
        }
        candidates.push({
          protocol: 'openai',
          url: suiteCred.endpoints.chatUrl,
          apiKey: suiteCred.apiKey,
          headers: suiteCred.headers,
          model: modelName,
          engineName: suiteCred.isLocalBridge ? 'cloud_bridge' : 'cloud_managed'
        });
      }
      // 追加 Antigravity 多协议端点作为云端可用备选
      try {
        const rt = loadBridgeRuntime();
        if (rt?.options?.enabled && Array.isArray(rt.endpoints)) {
          for (const ep of rt.endpoints) {
            const preferAnth = ep.urls?.preferredProtocol === 'anthropic' && !ep.urls?.isOfficialDeepSeek && ep.urls?.anthropicMessagesUrl;
            const epUrl = preferAnth ? ep.urls.anthropicMessagesUrl : ep.urls?.openaiChatUrl;
            if (!epUrl || candidates.some((c) => c.url === epUrl)) continue;
            candidates.push({
              protocol: preferAnth ? 'anthropic' : 'openai',
              url: epUrl,
              apiKey: ep.apiKey,
              headers: preferAnth
                ? { 'x-api-key': ep.apiKey, 'anthropic-version': '2023-06-01' }
                : { Authorization: `Bearer ${ep.apiKey}` },
              model: ep.defaultModel || 'deepseek-flash',
              engineName: ep.name || 'cloud_bridge'
            });
          }
        }
      } catch {}
    }

    if (candidates.length === 0) {
      return sendJson(res, 400, {
        ok: false,
        code: 'NO_API_KEY',
        error: '当前账号未配置可用云端 API 密钥。请在上方切换「DeepSeek API」填写您的个人密钥，或改用「本地免 API」直接下达系统口令。'
      });
    }

    let lastErr = '';
    for (const cand of candidates) {
      try {
        if (cand.protocol === 'anthropic') {
          const resp = await fetch(cand.url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...cand.headers },
            body: JSON.stringify({
              model: cand.model,
              max_tokens: 1024,
              temperature: 0.15,
              system: sysPrompt,
              messages: [{ role: 'user', content: userMsg }]
            }),
            signal: AbortSignal.timeout(25000)
          });
          if (!resp.ok) {
            lastErr = `上游网关 (${resp.status})`;
            continue;
          }
          const data = await resp.json();
          const blocks = Array.isArray(data.content) ? data.content : [];
          const rawText = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
          const parsed = normalizePlan(extractPlanJson(rawText));
          return sendJson(res, 200, { ok: true, plan: parsed, model: cand.model, engine: cand.engineName });
        }

        const isReasonerModel = /reasoner|r1/i.test(String(cand.model || ''));
        const runOpenAiAttempt = async (modelToUse, extraRetryHint = '') => {
          const msgs = [
            { role: 'system', content: sysPrompt },
            { role: 'user', content: userMsg }
          ];
          if (extraRetryHint) {
            msgs.push({ role: 'user', content: extraRetryHint });
          }
          const useReasoner = /reasoner|r1/i.test(String(modelToUse || ''));
          const payload = {
            model: modelToUse,
            messages: msgs,
            temperature: useReasoner ? 0.2 : 0.15,
            max_tokens: useReasoner ? 2048 : 1024,
            stream: false
          };
          if (!useReasoner && (cand.url.includes('deepseek.com') || /deepseek/i.test(modelToUse))) {
            payload.response_format = { type: 'json_object' };
          }
          const resp = await fetch(cand.url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...cand.headers },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(25000)
          });
          if (!resp.ok) {
            const errTxt = await resp.text().catch(() => '');
            throw new Error(`模型网关返回 (${resp.status}): ${errTxt.slice(0, 120)}`);
          }
          const data = await resp.json();
          const msgObj = data?.choices?.[0]?.message || {};
          const rawText = String(msgObj.content || '').trim();
          try {
            return extractPlanJson(rawText);
          } catch (parseErr) {
            const reasonTxt = String(msgObj.reasoning_content || '').trim();
            if (reasonTxt) {
              return extractPlanJson(reasonTxt);
            }
            throw parseErr;
          }
        };

        let rawPlan;
        let usedModel = cand.model;
        try {
          rawPlan = await runOpenAiAttempt(cand.model);
        } catch (firstErr) {
          const fallbackModel = isReasonerModel ? 'deepseek-chat' : cand.model;
          usedModel = fallbackModel;
          rawPlan = await runOpenAiAttempt(
            fallbackModel,
            '请严格只输出一个合法 JSON 动作对象（不要输出任何思考说明），如果连续等待后界面无新控件，请返回 click/swipe 或 ask_user。'
          );
        }
        const parsed = normalizePlan(rawPlan);
        return sendJson(res, 200, { ok: true, plan: parsed, model: usedModel, engine: cand.engineName });
      } catch (err) {
        lastErr = err?.message || '规划请求超时或解析异常';
      }
    }

    return sendJson(res, 502, {
      ok: false,
      code: 'PLAN_FAILED',
      error: lastErr || '手机辅助规划请求暂时不可用，请检查密钥与网络或改用本地免 API 模式'
    });
  }

  if (method === 'POST' && pathname === '/api/auth/onboarding') {
    const body = await readJsonBody(req);
    const updatedUser = markUserOnboardingDone(userId, Boolean(body.done));
    return sendJson(res, 200, { user: updatedUser });
  }

  if (method === 'PUT' && pathname === '/api/auth/user-persona') {
    const body = await readJsonBody(req);
    let updatedUser;
    try {
      updatedUser = updateUserPersona(userId, body);
    } catch (err) {
      return sendJson(res, 400, { error: err.message || '保存个人名字与形象失败' });
    }
    // 彻底同步该用户名下所有会话的称呼记忆槽位（包括清理旧版无 slot_key 的默认称呼记忆并补齐缺失记忆）
    if (updatedUser.nickname) {
      const now = Date.now();
      const newNick = updatedUser.nickname;
      const newMemContent = `对话者身份称呼：对方现在的名字叫「${newNick}」，请直接亲切称呼对方为「${newNick}」。`;
      const userSessions = db
        .prepare("SELECT id, persona_id, session_mode FROM sessions WHERE user_id = ?")
        .all(userId);

      const findNickMems = db.prepare(`
        SELECT id FROM memories
        WHERE session_id = ?
          AND (slot_key = 'user_nickname' OR content LIKE '对话者身份称呼：%' OR content LIKE '%对方自称「%')
      `);
      const updateNickMem = db.prepare(`
        UPDATE memories
        SET slot_key = 'user_nickname', category = 'relation', content = ?, pinned = 1, importance = 5, updated_at = ?
        WHERE id = ?
      `);
      const deleteDupMem = db.prepare('DELETE FROM memories WHERE id = ?');
      const insertNickMem = db.prepare(`
        INSERT INTO memories (id, session_id, category, slot_key, content, pinned, importance, strength, recall_count, last_recalled_at, created_at, updated_at)
        VALUES (?, ?, 'relation', 'user_nickname', ?, 1, 5, 8.0, 1, ?, ?, ?)
      `);

      for (const s of userSessions) {
        if (s.session_mode === 'deepseek_native' && s.persona_id === 'persona_deepseek_official') {
          continue;
        }
        const matched = findNickMems.all(s.id);
        if (matched.length > 0) {
          updateNickMem.run(newMemContent, now, matched[0].id);
          for (let i = 1; i < matched.length; i++) {
            deleteDupMem.run(matched[i].id);
          }
        } else if (!/^星[语屿]旅人/.test(newNick)) {
          insertNickMem.run(genId('mem'), s.id, newMemContent, now, now, now);
        }
      }
    }
    return sendJson(res, 200, { user: updatedUser });
  }

  // ========= 2. 首屏初始化聚合接口（单次往返直出工作台 + 首个会话消息，大幅降低启动等待） =========
  if (method === 'GET' && pathname === '/api/bootstrap') {
    const lite = parsedUrl.searchParams.get('lite') === '1';
    const uiMode = String(parsedUrl.searchParams.get('ui_mode') || '').trim();
    const activeScriptIdParam = String(parsedUrl.searchParams.get('active_script_id') || '').trim();
    const preferredSessionId = String(parsedUrl.searchParams.get('preferred_session_id') || '').trim();
    const msgLimit = Math.min(200, Math.max(20, parseInt(parsedUrl.searchParams.get('msg_limit') || '60', 10) || 60));

    const wallet = getWalletOverview(userId);
    const scripts = listScriptsForUser(userId);
    const personas = listPersonasForUser(userId);
    const sessions = listSessionsForUser(userId);
    const settings = getSafeClientSettings(userId);

    let initialSessionId = null;
    let initialSessionPayload = null;

    if (uiMode !== 'phone-agent' && sessions.length > 0) {
      const isDsBoot = uiMode === 'deepseek';
      const preferredSessions = sessions.filter((s) =>
        isDsBoot ? s.session_mode === 'deepseek_native' : s.session_mode !== 'deepseek_native'
      );
      let targetSessRow = null;
      if (preferredSessionId) {
        targetSessRow = preferredSessions.find((s) => s.id === preferredSessionId) || null;
      }
      if (!targetSessRow) {
        if (isDsBoot) {
          targetSessRow =
            preferredSessions.find((s) => s.title === '新对话' && s.persona_id === 'persona_deepseek_official') ||
            preferredSessions[0] ||
            null;
        } else {
          const effectiveScriptId =
            activeScriptIdParam && scripts.some((sc) => sc.id === activeScriptIdParam)
              ? activeScriptIdParam
              : scripts[0]?.id || '';
          targetSessRow =
            preferredSessions.find((s) => {
              const pObj = personas.find((x) => x.id === s.persona_id);
              return (s.script_id || pObj?.script_id || '') === effectiveScriptId;
            }) ||
            preferredSessions[0] ||
            null;
        }
      }
      if (targetSessRow) {
        const fullSess = db
          .prepare('SELECT * FROM sessions WHERE id = ? AND user_id = ?')
          .get(targetSessRow.id, userId);
        if (fullSess) {
          initialSessionId = fullSess.id;
          initialSessionPayload = buildSessionDetailPayload(fullSess, userId, {
            limit: msgLimit,
            settings,
            membership: wallet.membership
          });
        }
      }
    }

    return sendJson(res, 200, {
      authenticated: true,
      app_version: APP_LATEST_VERSION,
      app_version_code: APP_LATEST_VERSION_CODE,
      user: currentUser,
      token: currentToken,
      scripts,
      square_items: lite ? [] : listCommunityShares({ userId }),
      personas,
      sessions,
      settings,
      membership: wallet.membership,
      wallet,
      initial_session_id: initialSessionId,
      initial_session_payload: initialSessionPayload
    });
  }

  // ========= 2.5 AI 剧本工坊（读取/诊断/精修剧本 + 自动提取人设）与共创设计广场接口 =========
  if (method === 'POST' && pathname === '/api/workshop/analyze') {
    const body = await readJsonBody(req, 512 * 1024);
    const content = String(body.content || '').trim();
    if (!content) {
      return sendJson(res, 400, { error: '请先上传剧本文件或粘贴您的故事草稿' });
    }
    try {
      const execSettings = getExecutionSettingsForUser(userId);
      const analysis = await analyzeAndOptimizeScript({
        filename: String(body.filename || ''),
        rawText: content,
        focusMode: String(body.focus_mode || 'balanced'),
        settings: execSettings
      });
      return sendJson(res, 200, analysis);
    } catch (err) {
      return sendJson(res, 400, { error: sanitizePublicErrorMessage(err, '剧本智能拆解失败，请稍后重试') });
    }
  }

  if (method === 'POST' && pathname === '/api/workshop/save') {
    const body = await readJsonBody(req, 512 * 1024);
    try {
      const saved = saveWorkshopScriptForUser(userId, {
        script: body.script || {},
        personas: Array.isArray(body.personas) ? body.personas : [],
        lorebooks: Array.isArray(body.lorebooks) ? body.lorebooks : [],
        publishToSquare: Boolean(body.publish_to_square)
      });
      return sendJson(res, 201, {
        ok: true,
        ...saved,
        scripts: listScriptsForUser(userId),
        personas: listPersonasForUser(userId),
        square_items: listCommunityShares({ userId })
      });
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
  }

  const customScriptMatch = pathname.match(/^\/api\/scripts\/([^/]+)$/);
  if (customScriptMatch && method === 'DELETE') {
    const scriptId = decodeURIComponent(customScriptMatch[1]);
    const existingSc = db
      .prepare('SELECT id FROM user_scripts WHERE id = ? AND user_id = ?')
      .get(scriptId, userId);
    if (!existingSc) {
      return sendJson(res, 400, { error: '官方精选剧本不可删除，仅可移除自建或获取的剧本' });
    }
    db.transaction(() => {
      db.prepare('DELETE FROM personas WHERE script_id = ? AND user_id = ?').run(scriptId, userId);
      db.prepare('DELETE FROM user_scripts WHERE id = ? AND user_id = ?').run(scriptId, userId);
    })();
    return sendJson(res, 200, {
      ok: true,
      scripts: listScriptsForUser(userId),
      personas: listPersonasForUser(userId)
    });
  }

  if (method === 'GET' && pathname === '/api/square/items') {
    const type = parsedUrl?.searchParams?.get('type') || 'all';
    const q = parsedUrl?.searchParams?.get('q') || '';
    return sendJson(res, 200, {
      items: listCommunityShares({ userId, type, query: q })
    });
  }

  if (method === 'POST' && pathname === '/api/square/publish') {
    const body = await readJsonBody(req, 128 * 1024);
    try {
      const resPub = publishExistingToSquare(userId, {
        shareType: body.share_type === 'persona' ? 'persona' : 'script',
        targetId: String(body.target_id || '').trim(),
        tags: String(body.tags || '').trim()
      });
      return sendJson(res, 201, {
        ok: true,
        ...resPub,
        items: listCommunityShares({ userId })
      });
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
  }

  const squareActionMatch = pathname.match(/^\/api\/square\/items\/([^/]+)\/(like|adopt)$/);
  if (squareActionMatch && method === 'POST') {
    const shareId = decodeURIComponent(squareActionMatch[1]);
    const action = squareActionMatch[2];
    if (action === 'like') {
      try {
        const resLike = toggleLikeShareItem(userId, shareId);
        return sendJson(res, 200, resLike);
      } catch (err) {
        return sendJson(res, 400, { error: err.message });
      }
    }
    if (action === 'adopt') {
      const body = await readJsonBody(req, 32 * 1024);
      try {
        const resAdopt = adoptShareItemToUser(userId, shareId, body.active_script_id || 'script_clannad');
        return sendJson(res, 200, {
          ok: true,
          ...resAdopt,
          scripts: listScriptsForUser(userId),
          personas: listPersonasForUser(userId),
          items: listCommunityShares({ userId })
        });
      } catch (err) {
        return sendJson(res, 400, { error: err.message });
      }
    }
  }

  // ========= 3. 账户积分、签到、任务、日卡/月卡充值、兑换码与站长发卡台接口 =========
  if (method === 'GET' && pathname === '/api/wallet/overview') {
    return sendJson(res, 200, getWalletOverview(userId));
  }

  if (method === 'POST' && pathname === '/api/wallet/checkin') {
    try {
      const resCheckin = performDailyCheckin(userId);
      return sendJson(res, 200, {
        ...resCheckin,
        wallet: getWalletOverview(userId)
      });
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
  }

  if (method === 'POST' && pathname === '/api/wallet/tasks/claim') {
    const body = await readJsonBody(req);
    try {
      const resClaim = claimTaskReward(userId, body.task_key);
      return sendJson(res, 200, {
        ...resClaim,
        wallet: getWalletOverview(userId)
      });
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
  }

  if (method === 'POST' && pathname === '/api/wallet/exchange') {
    const body = await readJsonBody(req);
    try {
      const resEx = exchangePointsItem(userId, body.item_key);
      return sendJson(res, 200, {
        ...resEx,
        settings: getSafeClientSettings(userId),
        wallet: getWalletOverview(userId)
      });
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
  }

  if (method === 'POST' && pathname === '/api/wallet/recharge') {
    return sendJson(res, 200, { ok: true, membership: getMembership(userId) });
  }

  if (method === 'GET' && pathname === '/api/membership') {
    return sendJson(res, 200, { membership: getMembership(userId) });
  }

  if (method === 'POST' && pathname === '/api/membership/subscribe') {
    return sendJson(res, 200, { ok: true, membership: getMembership(userId) });
  }

  if (method === 'POST' && pathname === '/api/membership/redeem') {
    const ip = getClientIp(req);
    if (!checkRateLimit(`redeem:${userId}:${ip}`, 8, 60000)) {
      return sendJson(res, 429, { error: '兑换尝试过于频繁，请 1 分钟后再试' });
    }
    const body = await readJsonBody(req, 8 * 1024);
    try {
      const result = redeemMembershipCode(userId, body.code);
      return sendJson(res, 200, {
        ...result,
        settings: getSafeClientSettings(userId),
        wallet: getWalletOverview(userId)
      });
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
  }

  if (method === 'POST' && pathname === '/api/membership/reset') {
    if (!currentUser.is_admin) {
      return sendJson(res, 403, { error: '权限不足：仅站长管理后台可执行配额重置' });
    }
    const membership = resetMembershipToFree(userId);
    return sendJson(res, 200, { membership, wallet: getWalletOverview(userId) });
  }

  // ========= 3.5 站长管理后台专属接口族（全接口强制 RBAC 鉴权，绝无在线提权后门） =========
  if (pathname.startsWith('/api/admin/')) {
    if (!currentUser.is_admin) {
      return sendJson(res, 403, { error: '权限不足：该功能仅限站长账户访问', code: 'ADMIN_REQUIRED' });
    }

    if (method === 'GET' && pathname === '/api/admin/dashboard') {
      return sendJson(res, 200, getAdminDashboardData());
    }

    if (method === 'GET' && pathname === '/api/admin/announcement') {
      return sendJson(res, 200, {
        ok: true,
        current: getLatestAnnouncement(),
        list: getAdminAnnouncementsList()
      });
    }

    if (method === 'POST' && pathname === '/api/admin/announcement') {
      const body = await readJsonBody(req, 64 * 1024);
      try {
        const ann = saveAdminAnnouncement(userId, body);
        return sendJson(res, 200, { ok: true, announcement: ann });
      } catch (err) {
        return sendJson(res, 400, { error: err.message });
      }
    }

    if (method === 'PUT' && pathname === '/api/admin/platform-config') {
      const body = await readJsonBody(req, 64 * 1024);
      try {
        if (body.deepseek_base_url) assertSafeExternalGatewayUrl(body.deepseek_base_url, '大模型接口地址');
        if (body.custom_gateway_url) assertSafeExternalGatewayUrl(body.custom_gateway_url, '自定义网关地址');
        if (body.tts_endpoint) assertSafeExternalGatewayUrl(body.tts_endpoint, '语音合成接口地址');
        const maskedCfg = updateAdminPlatformConfig(body);
        return sendJson(res, 200, { platform_config: maskedCfg });
      } catch (err) {
        return sendJson(res, 400, { error: err.message });
      }
    }

    if (method === 'GET' && pathname === '/api/admin/balance') {
      const rawPlatform = getRawPlatformConfigInternal();
      const balance = await fetchDeepSeekBalance({
        ...rawPlatform,
        provider: rawPlatform.online_provider_type || 'deepseek'
      });
      return sendJson(res, 200, balance);
    }

    if (method === 'POST' && pathname === '/api/admin/test-gateway') {
      const body = await readJsonBody(req, 64 * 1024);
      try {
        if (body.deepseek_base_url) assertSafeExternalGatewayUrl(body.deepseek_base_url, '大模型接口地址');
        if (body.custom_gateway_url) assertSafeExternalGatewayUrl(body.custom_gateway_url, '自定义网关地址');
        const rawPlatform = getRawPlatformConfigInternal();
        const merged = { ...rawPlatform };
        for (const [k, v] of Object.entries(body || {})) {
          if (v !== undefined && v !== null && String(v).trim() && !String(v).includes('••••')) {
            merged[k] = String(v).trim();
          }
        }
        const testSettings = {
          ...merged,
          provider: merged.online_provider_type === 'custom_gateway' ? 'custom_gateway' : 'deepseek'
        };
        const t0 = Date.now();
        let sampleOut = '';
        await streamPersonaChat({
          settings: testSettings,
          contextBundle: {
            persona: { name: '站长网关探针', tagline: '', personality: '', backstory: '' },
            session: { enable_inner_thought: 0 },
            messagesPayload: [{ role: 'user', content: '请回复“平台网关已连通”七个字。' }],
            recalledMemories: [],
            rollingSummary: ''
          },
          latestUserText: '网关连通性测试',
          onReasoning: () => {},
          onContent: (c) => {
            sampleOut += c;
          },
          signal: AbortSignal.timeout(12000)
        });
        return sendJson(res, 200, {
          ok: true,
          message: `平台网关握手成功（耗时 ${Date.now() - t0}ms）：${sampleOut.slice(0, 40)}`
        });
      } catch (err) {
        return sendJson(res, 400, { ok: false, error: err.message || '网关连接测试失败' });
      }
    }

    const userAdjustMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)\/adjust$/);
    if (userAdjustMatch && method === 'POST') {
      const targetUid = decodeURIComponent(userAdjustMatch[1]);
      const body = await readJsonBody(req, 16 * 1024);
      try {
        const dash = adminAdjustUserAssets(userId, targetUid, body);
        return sendJson(res, 200, dash);
      } catch (err) {
        return sendJson(res, 400, { error: err.message });
      }
    }

    // 管理员重置指定用户密码
    const resetPwdMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)\/reset-password$/);
    if (resetPwdMatch && method === 'POST') {
      const targetUid = decodeURIComponent(resetPwdMatch[1]);
      const body = await readJsonBody(req, 16 * 1024);
      try {
        const dash = adminResetUserPassword(userId, targetUid, body.new_password);
        return sendJson(res, 200, { ok: true, message: '用户密码已重置成功', ...dash });
      } catch (err) {
        return sendJson(res, 400, { error: err.message });
      }
    }

    // 管理员一键切换用户封禁/解封状态
    const toggleBanMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)\/toggle-ban$/);
    if (toggleBanMatch && method === 'POST') {
      const targetUid = decodeURIComponent(toggleBanMatch[1]);
      const body = await readJsonBody(req, 16 * 1024);
      try {
        const dash = adminToggleUserBan(userId, targetUid, Boolean(body.ban));
        return sendJson(res, 200, { ok: true, message: body.ban ? '账号已封禁并强制下线' : '账号已解除封禁', ...dash });
      } catch (err) {
        return sendJson(res, 400, { error: err.message });
      }
    }

    // 管理员设置用户角色 (user / admin)
    const setRoleMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)\/set-role$/);
    if (setRoleMatch && method === 'POST') {
      const targetUid = decodeURIComponent(setRoleMatch[1]);
      const body = await readJsonBody(req, 16 * 1024);
      try {
        const dash = adminSetUserRole(userId, targetUid, body.role);
        return sendJson(res, 200, { ok: true, message: '用户角色已更新', ...dash });
      } catch (err) {
        return sendJson(res, 400, { error: err.message });
      }
    }

    // 管理员删除指定用户账号及所有级联数据
    const deleteUserMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)$/);
    if (deleteUserMatch && method === 'DELETE') {
      const targetUid = decodeURIComponent(deleteUserMatch[1]);
      try {
        const dash = adminDeleteUser(userId, targetUid);
        return sendJson(res, 200, { ok: true, message: '用户账号及所有关联数据已彻底删除', ...dash });
      } catch (err) {
        return sendJson(res, 400, { error: err.message });
      }
    }

    if (method === 'PUT' && pathname === '/api/admin/security/credentials') {
      const body = await readJsonBody(req, 16 * 1024);
      try {
        const updatedAdmin = updateAdminCredentials(userId, body, currentToken);
        return sendJson(res, 200, { user: updatedAdmin });
      } catch (err) {
        return sendJson(res, 400, { error: err.message });
      }
    }

    if (method === 'GET' && pathname === '/api/admin/redeem-codes') {
      return sendJson(res, 200, { codes: listAdminRedeemCodes() });
    }

    if (method === 'POST' && pathname === '/api/admin/redeem-codes/generate') {
      const body = await readJsonBody(req, 16 * 1024);
      try {
        const resGen = generateAdminRedeemCodes(userId, body);
        return sendJson(res, 201, resGen);
      } catch (err) {
        return sendJson(res, 400, { error: err.message });
      }
    }

    const adminCodeDelMatch = pathname.match(/^\/api\/admin\/redeem-codes\/([^/]+)$/);
    if (adminCodeDelMatch && method === 'DELETE') {
      try {
        const codes = deleteAdminRedeemCode(decodeURIComponent(adminCodeDelMatch[1]));
        return sendJson(res, 200, { ok: true, codes });
      } catch (err) {
        return sendJson(res, 400, { error: err.message });
      }
    }

    return sendJson(res, 404, { error: '未找到对应的站长管理接口' });
  }

  // ========= 4. 人设设定文档上传与智能解析接口 =========
  if (method === 'POST' && pathname === '/api/personas/parse-doc') {
    const body = await readJsonBody(req, 4 * 1024 * 1024);
    try {
      const parsed = parsePersonaDocument(body.filename || 'persona.txt', body.content || '');
      if (body.auto_create) {
        const now = Date.now();
        const id = genId('persona');
        db.prepare(`
          INSERT INTO personas (
            id, user_id, script_id, name, avatar, tagline, personality, backstory, speaking_style, greeting, starter_prompts, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          id,
          userId,
          String(body.script_id || 'script_clannad').trim(),
          parsed.name,
          parsed.avatar,
          parsed.tagline,
          parsed.personality,
          parsed.backstory,
          parsed.speaking_style,
          parsed.greeting,
          JSON.stringify(parsed.starter_prompts || []),
          now,
          now
        );
        const created = formatPersonaRow(db.prepare('SELECT * FROM personas WHERE id = ?').get(id));
        return sendJson(res, 201, { persona: created, parsed });
      }
      return sendJson(res, 200, { parsed });
    } catch (err) {
      return sendJson(res, 400, { error: err.message || '人设文档解析失败' });
    }
  }

  // ========= 5. 人设角色卡 CRUD =========
  if (method === 'POST' && pathname === '/api/personas') {
    const body = await readJsonBody(req);
    const name = (body.name || '').trim();
    if (!name) return sendJson(res, 400, { error: '角色名称不能为空' });

    const now = Date.now();
    const id = genId('persona');
    const prompts = Array.isArray(body.starter_prompts)
      ? body.starter_prompts.filter((s) => s && s.trim())
      : [];
    const rawGender = String(body.gender || '').trim().toLowerCase();
    const cleanGender = rawGender === 'female' || rawGender === 'male' ? rawGender : '';
    const defaultAvatar = cleanGender === 'male' ? '✨' : '🌸';
    // 独立自建角色默认归入通用「心动角色全集」，防止误继承其他主题剧本的特定身份导致串戏
    const rawScriptId = String(body.script_id || 'script_classic').trim();
    const isAdoptedScript = Boolean(
      db.prepare('SELECT 1 FROM user_scripts WHERE id = ? AND source_share_id IS NOT NULL').get(rawScriptId)
    );
    const safeScriptId =
      rawScriptId.startsWith('usc_') && !isAdoptedScript && /【所属剧本/.test(String(body.backstory || ''))
        ? rawScriptId
        : 'script_classic';

    db.prepare(`
      INSERT INTO personas (
        id, user_id, script_id, gender, name, avatar, tagline, personality, backstory, speaking_style, greeting, starter_prompts, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      userId,
      safeScriptId,
      cleanGender,
      name,
      (body.avatar || defaultAvatar).trim(),
      (body.tagline || '').trim(),
      (body.personality || '').trim(),
      (body.backstory || '').trim(),
      (body.speaking_style || '').trim(),
      (body.greeting || '').trim(),
      JSON.stringify(prompts),
      now,
      now
    );

    recordUserDailyEvent(userId, 'persona_created');
    const created = formatPersonaRow(db.prepare('SELECT * FROM personas WHERE id = ?').get(id));
    return sendJson(res, 201, { persona: created });
  }

  const personaMatch = pathname.match(/^\/api\/personas\/([^/]+)$/);
  if (personaMatch) {
    const personaId = decodeURIComponent(personaMatch[1]);
    const existing = db
      .prepare("SELECT * FROM personas WHERE id = ? AND (user_id = ? OR user_id = 'system' OR user_id = 'system_ds')")
      .get(personaId, userId);
    if (!existing) return sendJson(res, 404, { error: '未找到该角色人设' });

    if (method === 'PUT' || method === 'PATCH') {
      const body = await readJsonBody(req);
      const now = Date.now();
      const isSystemPersona = existing.user_id === 'system' || existing.user_id === 'system_ds';
      const applyToGlobal = Boolean(body.apply_to_global) && !isSystemPersona && existing.user_id === userId;

      // 默认按「会话级独立设定」保存至 sessions.custom_persona_override，确保不同对话框可拥有完全不同的设定而不互相污染
      if (body.session_id && !applyToGlobal) {
        const overrideData = {
          avatar: (body.avatar ?? existing.avatar).trim() || '🌸',
          name: (body.name ?? existing.name).trim() || existing.name,
          tagline: (body.tagline ?? existing.tagline).trim(),
          personality: (body.personality ?? existing.personality).trim(),
          backstory: (body.backstory ?? existing.backstory).trim(),
          speaking_style: (body.speaking_style ?? existing.speaking_style).trim()
        };
        if (body.session_prompt !== undefined) {
          db.prepare(`
            UPDATE sessions SET custom_persona_override = ?, session_prompt = ?, updated_at = ?
            WHERE id = ? AND user_id = ?
          `).run(JSON.stringify(overrideData), String(body.session_prompt || '').trim(), now, body.session_id, userId);
        } else {
          db.prepare(`
            UPDATE sessions SET custom_persona_override = ?, updated_at = ?
            WHERE id = ? AND user_id = ?
          `).run(JSON.stringify(overrideData), now, body.session_id, userId);
        }

        return sendJson(res, 200, {
          scope: 'session',
          persona: formatPersonaRow({ ...existing, ...overrideData }),
          sessions: listSessionsForUser(userId)
        });
      }

      if (existing.user_id !== userId) {
        return sendJson(res, 403, { error: '官方预设角色仅支持按对话独立覆盖设定，不可修改全局模板' });
      }

      if (body.name !== undefined && !String(body.name).trim()) {
        return sendJson(res, 400, { error: '角色名称不能为空' });
      }

      const prompts = Array.isArray(body.starter_prompts)
        ? JSON.stringify(body.starter_prompts.filter((s) => s && s.trim()))
        : existing.starter_prompts;
      const nextScriptId =
        body.script_id !== undefined ? String(body.script_id).trim() || existing.script_id : existing.script_id;
      const nextGender =
        body.gender !== undefined
          ? ['female', 'male'].includes(String(body.gender).trim().toLowerCase())
            ? String(body.gender).trim().toLowerCase()
            : ''
          : existing.gender || '';
      const nextCategoryTag =
        body.category_tag !== undefined
          ? String(body.category_tag).trim() || existing.category_tag || '温柔治愈'
          : existing.category_tag || '温柔治愈';

      db.prepare(`
        UPDATE personas
        SET script_id = ?, gender = ?, category_tag = ?, name = ?, avatar = ?, tagline = ?, personality = ?, backstory = ?, speaking_style = ?, greeting = ?, starter_prompts = ?, updated_at = ?
        WHERE id = ?
      `).run(
        nextScriptId,
        nextGender,
        nextCategoryTag,
        (body.name ?? existing.name).trim() || existing.name,
        (body.avatar ?? existing.avatar).trim() || '🌸',
        (body.tagline ?? existing.tagline).trim(),
        (body.personality ?? existing.personality).trim(),
        (body.backstory ?? existing.backstory).trim(),
        (body.speaking_style ?? existing.speaking_style).trim(),
        (body.greeting ?? existing.greeting).trim(),
        prompts,
        now,
        personaId
      );

      // 若在会话内同时勾选了「同步更新全局卡」，也清理或同步当前会话的覆盖并保存 session_prompt
      if (body.session_id) {
        if (body.session_prompt !== undefined) {
          db.prepare(`
            UPDATE sessions SET custom_persona_override = NULL, session_prompt = ?, updated_at = ?
            WHERE id = ? AND user_id = ?
          `).run(String(body.session_prompt || '').trim(), now, body.session_id, userId);
        } else {
          db.prepare(`
            UPDATE sessions SET custom_persona_override = NULL, updated_at = ?
            WHERE id = ? AND user_id = ?
          `).run(now, body.session_id, userId);
        }
      }

      const updated = formatPersonaRow(db.prepare('SELECT * FROM personas WHERE id = ?').get(personaId));
      return sendJson(res, 200, {
        scope: 'global',
        persona: updated,
        sessions: listSessionsForUser(userId)
      });
    }

    if (method === 'DELETE') {
      if (existing.user_id !== userId) {
        return sendJson(res, 400, { error: '官方基础角色卡不可删除' });
      }
      const ownedSessions = db
        .prepare('SELECT id FROM sessions WHERE persona_id = ? AND user_id = ?')
        .all(personaId, userId);
      for (const s of ownedSessions) {
        db.prepare('DELETE FROM messages WHERE session_id = ?').run(s.id);
        db.prepare('DELETE FROM memories WHERE session_id = ?').run(s.id);
      }
      db.prepare('DELETE FROM lorebook_entries WHERE persona_id = ? AND user_id = ?').run(personaId, userId);
      db.prepare('DELETE FROM sessions WHERE persona_id = ? AND user_id = ?').run(personaId, userId);
      db.prepare('DELETE FROM personas WHERE id = ? AND user_id = ?').run(personaId, userId);
      const latestPersonas = db
        .prepare("SELECT * FROM personas WHERE (user_id = 'system' OR user_id = ?) ORDER BY CASE WHEN user_id = 'system' THEN 0 ELSE 1 END, created_at ASC")
        .all(userId)
        .map(formatPersonaRow);
      return sendJson(res, 200, { ok: true, personas: latestPersonas, sessions: listSessionsForUser(userId) });
    }
  }

  // ========= 6. 会话创建、导入历史记录与导出 =========
  if (method === 'POST' && pathname === '/api/sessions') {
    const body = await readJsonBody(req);
    const sessionMode = body.session_mode === 'deepseek_native' ? 'deepseek_native' : 'roleplay';
    const personaId =
      sessionMode === 'deepseek_native'
        ? 'persona_deepseek_official'
        : body.persona_id || 'persona_shenxinghui';

    const persona = db
      .prepare(
        "SELECT * FROM personas WHERE id = ? AND (user_id = ? OR user_id = 'system' OR user_id = 'system_ds')"
      )
      .get(personaId, userId);
    if (!persona) return sendJson(res, 404, { error: '未找到所选角色，请刷新后重试' });

    const now = Date.now();
    const sessionId = genId('sess');
    const shortPersonaName = persona.name.split(/[·\s]/)[0] || persona.name;
    const isPureOfficial = persona.id === 'persona_deepseek_official';
    const defaultTitle =
      sessionMode === 'deepseek_native'
        ? isPureOfficial
          ? '新对话'
          : `问答对话 · ${shortPersonaName}`
        : `与${shortPersonaName}的心动篇章`;
    const title = (body.title || defaultTitle).trim();
    const dsThinking = body.ds_thinking !== undefined ? (body.ds_thinking ? 1 : 0) : 1;
    const dsSearch = body.ds_search !== undefined ? (body.ds_search ? 1 : 0) : 0;
    const initProactive = body.proactive_enabled === true ? 1 : 0;

    const llmMode = body.llm_mode === 'api' ? 'api' : 'local_antigravity';
    const localModel = String(body.local_model || 'gemini-3.8-flash-high').trim();

    db.prepare(`
      INSERT INTO sessions (
        id, user_id, persona_id, title, session_mode, ds_thinking, ds_search, ds_json_mode, ds_tools_enabled, proactive_enabled,
        llm_mode, local_model,
        rolling_summary, summarized_until_msg_id, enable_inner_thought, enable_auto_memory,
        affection, trust, intimacy, current_mood, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?, ?, '', 0, 1, 1, 22, 26, 18, '温柔浅笑', ?, ?)
    `).run(sessionId, userId, personaId, title, sessionMode, dsThinking, dsSearch, initProactive, llmMode, localModel, now, now);

    // 原生 DeepSeek 模式保持官方 App 纯净新对话欢迎态；仅在恋庭沉浸模式注入初遇开场白与贴合人设的初遇心声独白
    if (sessionMode !== 'deepseek_native' && persona.greeting && persona.greeting.trim()) {
      const userNickCall = (currentUser.nickname || '你').replace(/^星语旅人·.*$/, '你');
      const renderedGreeting = replaceRoleplayMacros(
        persona.greeting.trim(),
        currentUser.nickname,
        persona.name
      );
      const shortRoleName = (persona.name || '').split(/[·\s]/)[0].trim();
      const personaTraitHint = (persona.personality || persona.tagline || '温柔守候').split(/[，。；]/)[0].trim();
      const openingThought = `终于把${userNickCall === '星屿旅人' ? '你' : `「${userNickCall}」`}盼来了……平时别人总觉得${shortRoleName || '我'}${personaTraitHint}，可一看到你推门进来，心里早就悄悄软了下来，得先把准备好的暖意递给你才行。`;
      db.prepare(`
        INSERT INTO messages (session_id, role, reasoning, content, duration_ms, recalled_count, created_at)
        VALUES (?, 'assistant', ?, ?, 350, 1, ?)
      `).run(
        sessionId,
        openingThought,
        renderedGreeting,
        now
      );
    }

    const insertMem = db.prepare(`
      INSERT INTO memories (id, session_id, category, slot_key, content, pinned, importance, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    if (!isPureOfficial && (persona.tagline || persona.backstory)) {
      const anchorSummary = replaceRoleplayMacros(
        (persona.tagline || persona.backstory.slice(0, 60)).trim(),
        currentUser.nickname,
        persona.name
      );
      insertMem.run(genId('mem'), sessionId, 'Pinned', 'scene_origin', `初始故事背景：${anchorSummary}`, 1, 5, now, now);
    }

    if (!isPureOfficial && currentUser.nickname && !/^星[语屿]旅人/.test(currentUser.nickname)) {
      insertMem.run(
        genId('mem'),
        sessionId,
        'relation',
        'user_nickname',
        `对话者身份称呼：对方现在的名字叫「${currentUser.nickname}」，请直接亲切称呼对方为「${currentUser.nickname}」。`,
        1,
        5,
        now,
        now
      );
    }

    return sendJson(res, 201, { session_id: sessionId, sessions: listSessionsForUser(userId) });
  }

  // 「🪄 帮我回一句」专用：结合最近多轮真实对话与当前最新台词，实时生成 3 条全新的玩家回复草稿
  const suggestReplyMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/suggest-replies$/);
  if (suggestReplyMatch && method === 'POST') {
    const sessionId = decodeURIComponent(suggestReplyMatch[1]);
    const sess = db.prepare('SELECT * FROM sessions WHERE id = ? AND user_id = ?').get(sessionId, userId);
    if (!sess) return sendJson(res, 404, { error: '会话不存在' });
    const body = await readJsonBody(req, 32 * 1024).catch(() => ({}));
    const excludeReplies = Array.isArray(body?.exclude) ? body.exclude : [];
    const nonce = Number(body?.nonce) || Date.now();
    const persona = resolveEffectivePersona(sess);
    const nurturing = formatNurturingSnapshot(sess);
    const recentMsgs = db
      .prepare('SELECT role, content FROM messages WHERE session_id = ? ORDER BY id DESC LIMIT 6')
      .all(sessionId)
      .reverse();
    const lastAst = [...recentMsgs].reverse().find((m) => m.role === 'assistant');
    const lastUsr = [...recentMsgs].reverse().find((m) => m.role === 'user');
    const settings = getExecutionSettingsForUser(userId);
    const suggestions = await generateDynamicFollowUpsWithLLM({
      settings,
      sessionMode: sess.session_mode || 'roleplay',
      isPureOfficial: persona.id === 'persona_deepseek_official',
      persona,
      nurturing,
      userNickname: currentUser.nickname,
      recentMessages: recentMsgs,
      userText: lastUsr?.content || '',
      assistantText: lastAst?.content || persona.greeting || '',
      excludeReplies,
      nonce,
      timeoutMs: 5500
    });
    return sendJson(res, 200, { replies: suggestions });
  }

  const sessionImportMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/import-history$/);
  if (sessionImportMatch && method === 'POST') {
    const sessionId = decodeURIComponent(sessionImportMatch[1]);
    const session = db
      .prepare('SELECT * FROM sessions WHERE id = ? AND user_id = ?')
      .get(sessionId, userId);
    if (!session) return sendJson(res, 404, { error: '目标会话不存在' });

    const body = await readJsonBody(req, 6 * 1024 * 1024);
    const persona = resolveEffectivePersona(session);

    try {
      const parsed = parseChatHistoryDocument(
        body.filename || 'history.md',
        body.content || '',
        persona.name
      );

      if (body.mode === 'replace') {
        db.prepare('DELETE FROM messages WHERE session_id = ?').run(sessionId);
        db.prepare("UPDATE sessions SET rolling_summary = '', summarized_until_msg_id = 0 WHERE id = ?").run(
          sessionId
        );
        if (body.replace_memories) {
          db.prepare('DELETE FROM memories WHERE session_id = ?').run(sessionId);
        }
      }

      const now = Date.now();
      const insertMsg = db.prepare(`
        INSERT INTO messages (session_id, role, reasoning, content, duration_ms, recalled_count, created_at)
        VALUES (?, ?, ?, ?, 0, 0, ?)
      `);

      let extractedCount = 0;
      parsed.messages.forEach((m, idx) => {
        insertMsg.run(sessionId, m.role, m.reasoning || '', m.content, now + idx);
        if (m.role === 'user') {
          const facts = extractFactsFromUserTurn(sessionId, m.content);
          extractedCount += facts.length;
        }
      });

      let importedMemoriesCount = 0;
      if (Array.isArray(parsed.imported_memories) && parsed.imported_memories.length > 0) {
        const existingMemContents = new Set(
          db
            .prepare('SELECT content FROM memories WHERE session_id = ?')
            .all(sessionId)
            .map((r) => String(r.content || '').trim())
        );
        const insertMem = db.prepare(`
          INSERT OR IGNORE INTO memories (id, session_id, category, content, pinned, importance, strength, recall_count, last_recalled_at, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
        `);
        for (const mem of parsed.imported_memories) {
          const cleanContent = mem && mem.content ? String(mem.content).trim() : '';
          if (cleanContent && !existingMemContents.has(cleanContent)) {
            const isPinned = mem.pinned ? 1 : 0;
            const imp = Math.min(5, Math.max(1, Number(mem.importance) || (isPinned ? 5 : 4)));
            insertMem.run(
              genId('mem'),
              sessionId,
              mem.category || (isPinned ? 'Pinned' : 'fact'),
              cleanContent,
              isPinned,
              imp,
              isPinned ? 8.0 : 4.5,
              now,
              now,
              now
            );
            existingMemContents.add(cleanContent);
            importedMemoriesCount += 1;
          }
        }
      }

      // 可选：同步将 .md / .json 记忆包里的「专属设定」应用到当前对话框（默认仅当勾选 import_setting 时生效，不污染其他对话）
      let appliedSetting = false;
      if (body.import_setting === true && parsed.imported_setting) {
        const sObj = parsed.imported_setting;
        let nextOverrideJson = session.custom_persona_override;
        if (sObj.persona_override && typeof sObj.persona_override === 'object') {
          let prevOv = {};
          try {
            if (session.custom_persona_override) prevOv = JSON.parse(session.custom_persona_override) || {};
          } catch {}
          nextOverrideJson = JSON.stringify({ ...prevOv, ...sObj.persona_override });
          appliedSetting = true;
        }
        const nextSessionPrompt =
          sObj.session_prompt ? sObj.session_prompt : session.session_prompt || '';
        const nextDirectorNote =
          sObj.director_note ? sObj.director_note : session.director_note || '';
        if (sObj.session_prompt || sObj.director_note) appliedSetting = true;

        if (appliedSetting) {
          db.prepare(`
            UPDATE sessions
            SET custom_persona_override = ?, session_prompt = ?, director_note = ?, updated_at = ?
            WHERE id = ? AND user_id = ?
          `).run(nextOverrideJson, nextSessionPrompt, nextDirectorNote, now, sessionId, userId);
        }
      }

      if (parsed.imported_summary) {
        const prevSum =
          body.mode === 'append' && session.rolling_summary && session.rolling_summary.trim()
            ? `${session.rolling_summary.trim()}\n${parsed.imported_summary.trim()}`
            : parsed.imported_summary.trim();
        db.prepare('UPDATE sessions SET rolling_summary = ?, updated_at = ? WHERE id = ?').run(
          prevSum.slice(-4800),
          now,
          sessionId
        );
      } else if (parsed.messages.length > 0) {
        const settings = getSafeClientSettings(userId);
        compressOverflowHistorySync(sessionId, parseInt(settings.sliding_window_turns || '40', 10));
      }

      db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(Date.now(), sessionId);

      return sendJson(res, 200, {
        imported_count: parsed.messages.length,
        imported_memories_count: importedMemoriesCount,
        extracted_memories: extractedCount + importedMemoriesCount,
        applied_setting: appliedSetting,
        sessions: listSessionsForUser(userId)
      });
    } catch (err) {
      return sendJson(res, 400, { error: err.message || '历史对话或记忆导入失败' });
    }
  }

  const sessionExportMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/export$/);
  if (sessionExportMatch && method === 'GET') {
    const sessionId = decodeURIComponent(sessionExportMatch[1]);
    const session = db
      .prepare('SELECT * FROM sessions WHERE id = ? AND user_id = ?')
      .get(sessionId, userId);
    if (!session) return sendJson(res, 404, { error: '未找到会话' });

    const persona = resolveEffectivePersona(session);
    const messages = db
      .prepare('SELECT role, reasoning, content, created_at FROM messages WHERE session_id = ? ORDER BY id ASC')
      .all(sessionId);
    const memories = db
      .prepare(
        'SELECT category, content, pinned, importance FROM memories WHERE session_id = ? ORDER BY pinned DESC, importance DESC, updated_at DESC'
      )
      .all(sessionId);

    let personaOverrideObj = null;
    if (session.custom_persona_override) {
      try {
        personaOverrideObj = JSON.parse(session.custom_persona_override);
      } catch {}
    }

    const exportedAtIso = new Date().toISOString();
    const exportedAtLocal = new Date().toLocaleString('zh-CN', { hour12: false });
    const markdown = buildSessionMemoryMarkdown({
      session,
      persona,
      memories,
      messages,
      exportedAt: exportedAtLocal
    });

    if (parsedUrl.searchParams.get('format') === 'md') {
      const safeFileTitle = String(session.title || persona.name || '聊天记忆档案')
        .replace(/[\\/:*?"<>|]/g, '_')
        .slice(0, 40);
      res.writeHead(200, {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`${safeFileTitle}_记忆档案.md`)}`,
        ...SECURITY_HEADERS
      });
      res.end(markdown);
      return;
    }

    return sendJson(res, 200, {
      session_id: session.id,
      title: session.title,
      session_mode: session.session_mode || 'roleplay',
      persona_name: persona.name,
      persona_override: personaOverrideObj,
      session_prompt: session.session_prompt || '',
      director_note: session.director_note || '',
      rolling_summary: session.rolling_summary || '',
      exported_at: exportedAtIso,
      memories,
      messages,
      markdown
    });
  }

  const sessionCompressMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/compress$/);
  if (sessionCompressMatch && method === 'POST') {
    const sessionId = decodeURIComponent(sessionCompressMatch[1]);
    const session = db
      .prepare('SELECT * FROM sessions WHERE id = ? AND user_id = ?')
      .get(sessionId, userId);
    if (!session) return sendJson(res, 404, { error: '会话不存在' });

    const msgCnt = db.prepare('SELECT COUNT(*) AS cnt FROM messages WHERE session_id = ?').get(sessionId).cnt;
    if (msgCnt < 2) {
      return sendJson(res, 200, {
        rolling_summary: session.rolling_summary || '',
        session,
        condensed: false,
        message: '先和角色聊上两句，就能一键总结前情提要啦～'
      });
    }

    const summary = compressOverflowHistorySync(sessionId, 4, { forceManual: true });
    const updatedSession = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
    return sendJson(res, 200, {
      rolling_summary: summary,
      session: updatedSession,
      condensed: true,
      message: '✨ 已为您将近期对话整理进「前情提要」！'
    });
  }

  // ========= 世界书词条 CRUD 与梦境记忆整理接口 =========
  const personaLoreMatch = pathname.match(/^\/api\/personas\/([^/]+)\/lorebooks$/);
  if (personaLoreMatch && method === 'POST') {
    const personaId = decodeURIComponent(personaLoreMatch[1]);
    const accessiblePersona = db
      .prepare("SELECT id FROM personas WHERE id = ? AND (user_id = ? OR user_id = 'system' OR user_id = 'system_ds')")
      .get(personaId, userId);
    if (!accessiblePersona) {
      return sendJson(res, 404, { error: '未找到目标角色卡或无权访问' });
    }
    const body = await readJsonBody(req);
    const title = String(body.title || '').trim();
    const keywords = String(body.keywords || '').trim();
    const content = String(body.content || '').trim();
    if (!title || !keywords || !content) {
      return sendJson(res, 400, { error: '世界书词条名称、触发关键词与内容均不能为空' });
    }
    const id = genId('lore');
    db.prepare(`
      INSERT INTO lorebook_entries (id, persona_id, user_id, title, keywords, content, enabled, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?)
    `).run(id, personaId, userId, title, keywords, content, Date.now());

    const lorebooks = db
      .prepare("SELECT * FROM lorebook_entries WHERE persona_id = ? AND (user_id = 'system' OR user_id = ?) ORDER BY created_at DESC")
      .all(personaId, userId);
    return sendJson(res, 201, { lorebooks });
  }

  const loreItemMatch = pathname.match(/^\/api\/lorebooks\/([^/]+)$/);
  if (loreItemMatch && method === 'DELETE') {
    const loreId = decodeURIComponent(loreItemMatch[1]);
    const existing = db.prepare('SELECT * FROM lorebook_entries WHERE id = ?').get(loreId);
    if (!existing) return sendJson(res, 404, { error: '未找到该世界书词条' });
    if (existing.user_id === 'system') {
      return sendJson(res, 400, { error: '角色预置核心世界书词条不可删除' });
    }
    if (existing.user_id !== userId) {
      return sendJson(res, 403, { error: '无权删除该词条' });
    }
    db.prepare('DELETE FROM lorebook_entries WHERE id = ?').run(loreId);
    const lorebooks = db
      .prepare("SELECT * FROM lorebook_entries WHERE persona_id = ? AND (user_id = 'system' OR user_id = ?) ORDER BY created_at DESC")
      .all(existing.persona_id, userId);
    return sendJson(res, 200, { lorebooks });
  }

  const sessionDreamMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/dream$/);
  if (sessionDreamMatch && method === 'POST') {
    const sessionId = decodeURIComponent(sessionDreamMatch[1]);
    const session = db
      .prepare('SELECT * FROM sessions WHERE id = ? AND user_id = ?')
      .get(sessionId, userId);
    if (!session) return sendJson(res, 404, { error: '未找到该会话' });

    const persona = resolveEffectivePersona(session);
    compressOverflowHistorySync(sessionId, 6);
    const result = runDreamConsolidation({
      sessionId,
      persona,
      userNickname: currentUser.nickname
    });
    recordUserDailyEvent(userId, 'dream_consolidated');
    const rawMems = db
      .prepare('SELECT * FROM memories WHERE session_id = ? ORDER BY pinned DESC, importance DESC, updated_at DESC')
      .all(sessionId);
    const updatedSession = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
    return sendJson(res, 200, {
      ...result,
      rolling_summary: updatedSession.rolling_summary,
      memories: decorateMemoriesWithRetention(rawMems)
    });
  }

  const sessionMemoriesMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/memories$/);
  if (sessionMemoriesMatch && method === 'POST') {
    const sessionId = decodeURIComponent(sessionMemoriesMatch[1]);
    const session = db
      .prepare('SELECT * FROM sessions WHERE id = ? AND user_id = ?')
      .get(sessionId, userId);
    if (!session) return sendJson(res, 404, { error: '会话不存在' });

    const body = await readJsonBody(req);
    const content = (body.content || '').trim();
    if (!content) return sendJson(res, 400, { error: '记忆内容不能为空' });

    const now = Date.now();
    const id = genId('mem');
    const pinned = body.pinned ? 1 : 0;
    const category = pinned ? 'Pinned' : body.category || 'fact';
    const importance = Math.min(5, Math.max(1, parseInt(body.importance || (pinned ? 5 : 4), 10)));
    const initStrength = pinned ? 8.0 : 4.0;

    db.prepare(`
      INSERT INTO memories (id, session_id, category, content, pinned, importance, strength, recall_count, last_recalled_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
    `).run(id, sessionId, category, content, pinned, importance, initStrength, now, now, now);

    const memories = decorateMemoriesWithRetention(
      db
        .prepare('SELECT * FROM memories WHERE session_id = ? ORDER BY pinned DESC, importance DESC, updated_at DESC')
        .all(sessionId)
    );
    return sendJson(res, 201, { memories });
  }

  // ========= 实时陪伴立绘生成与情景温馨提醒接口 =========
  const companionRemindMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/companion\/remind$/);
  if (companionRemindMatch && method === 'POST') {
    const sessionId = decodeURIComponent(companionRemindMatch[1]);
    const session = db
      .prepare('SELECT * FROM sessions WHERE id = ? AND user_id = ?')
      .get(sessionId, userId);
    if (!session) return sendJson(res, 404, { error: '会话不存在' });

    const body = await readJsonBody(req);
    const persona = resolveEffectivePersona(session);
    let savedComp = null;
    try {
      if (session.companion_config) savedComp = JSON.parse(session.companion_config);
    } catch {}
    const companion = resolveOrGenerateCompanion({ persona, currentConfig: savedComp });
    const nurturing = formatNurturingSnapshot(session);

    const reminder = buildCompanionReminder({
      persona,
      companion,
      userNickname: currentUser.nickname,
      stageLevel: nurturing.stage?.level || 1,
      trigger: body.trigger || 'timer'
    });
    if (body.trigger && body.trigger !== 'timer') {
      recordUserDailyEvent(userId, 'companion_interacted');
    }
    return sendJson(res, 200, { reminder, companion });
  }

  const companionCfgMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/companion$/);
  if (companionCfgMatch && method === 'POST') {
    const sessionId = decodeURIComponent(companionCfgMatch[1]);
    const session = db
      .prepare('SELECT * FROM sessions WHERE id = ? AND user_id = ?')
      .get(sessionId, userId);
    if (!session) return sendJson(res, 404, { error: '会话不存在' });

    const body = await readJsonBody(req, 6 * 1024 * 1024);
    let safeCustomImg;
    if (body.customImg !== undefined) {
      try {
        safeCustomImg = sanitizeCustomImageInput(body.customImg);
      } catch (err) {
        return sendJson(res, 400, { error: err.message });
      }
    }

    const persona = resolveEffectivePersona(session);
    let prevComp = null;
    try {
      if (session.companion_config) prevComp = JSON.parse(session.companion_config);
    } catch {}

    const nextComp = resolveOrGenerateCompanion({
      persona,
      currentConfig: prevComp,
      requestedMode: body.mode,
      requestedSkin: body.skinKey,
      customImg: safeCustomImg,
      requestedVoice: body.voiceId
    });
    if (body.reminderEnabled !== undefined) {
      nextComp.reminderEnabled = Boolean(body.reminderEnabled);
    }

    db.prepare('UPDATE sessions SET companion_config = ?, updated_at = ? WHERE id = ?').run(
      JSON.stringify(nextComp),
      Date.now(),
      sessionId
    );
    recordUserDailyEvent(userId, 'companion_interacted');

    const nurturing = formatNurturingSnapshot(session);
    const reminder = buildCompanionReminder({
      persona,
      companion: nextComp,
      userNickname: currentUser.nickname,
      stageLevel: nurturing.stage?.level || 1,
      trigger: 'switch_mode'
    });

    return sendJson(res, 200, {
      companion: nextComp,
      voice: resolveVoiceForCompanion(nextComp),
      voices: Object.values(VOICE_CATALOG),
      reminder
    });
  }

  // ========= 实时神经语音合成 (TTS) & 立绘双向语音对话接口 =========
  if (method === 'POST' && pathname === '/api/tts/speak') {
    const body = await readJsonBody(req);
    const text = String(body.text || '').trim();
    if (!text) return sendJson(res, 400, { error: '朗读文本不能为空' });

    let companion = null;
    if (body.sessionId) {
      const sess = db
        .prepare('SELECT * FROM sessions WHERE id = ? AND user_id = ?')
        .get(body.sessionId, userId);
      if (sess) {
        try {
          if (sess.companion_config) companion = JSON.parse(sess.companion_config);
        } catch {}
        companion = resolveOrGenerateCompanion({
          persona: resolveEffectivePersona(sess),
          currentConfig: companion
        });
      }
    }

    const voiceMeta = resolveVoiceForCompanion(companion, body.voiceId);
    const ttsRes = await synthesizeNeuralSpeech({
      text,
      voiceId: voiceMeta.id,
      settings: getExecutionSettingsForUser(userId)
    });

    const outBuf = ttsRes.audioBuffer || ttsRes.wavBuffer;
    if (!ttsRes.ok || !outBuf) {
      return sendJson(res, 200, { ok: false, fallback: true, voice: voiceMeta });
    }

    res.writeHead(200, {
      'Content-Type': ttsRes.mimeType || 'audio/wav',
      'Content-Length': outBuf.length,
      'Cache-Control': 'no-store',
      'X-Voice-Id': voiceMeta.id,
      'X-Tts-Engine': encodeURIComponent(ttsRes.engineName || 'local'),
      ...SECURITY_HEADERS
    });
    res.end(outBuf);
    return;
  }

  // 高精度语音转文字 (ASR) 接口：内置支持硅基流动 Qwen/Qwen3-ASR-1.7B 等兼容端点
  if (method === 'POST' && pathname === '/api/asr/transcribe') {
    const body = await readJsonBody(req, 8 * 1024 * 1024);
    const dataUrl = String(body.audio_data_url || '').trim();
    const match = dataUrl.match(/^data:(audio\/[^;]+)(?:;[^,]*)?;base64,(.+)$/i);
    if (!match) {
      return sendJson(res, 400, { ok: false, error: '未收到有效录音音频数据' });
    }

    const execSettings = getExecutionSettingsForUser(userId);
    const asrCfg = execSettings._builtin_asr;
    if (!asrCfg || !asrCfg.enabled || !asrCfg.apiKey) {
      return sendJson(res, 400, {
        ok: false,
        error: '填入硅基流动 API Key 后即可自动启用 Qwen3-ASR-1.7B 语音识别'
      });
    }

    try {
      const mime = match[1].toLowerCase();
      const ext = mime.includes('mp4') ? 'm4a' : mime.includes('wav') ? 'wav' : 'webm';
      const audioBuf = Buffer.from(match[2], 'base64');
      const form = new FormData();
      form.append('model', asrCfg.model || 'Qwen/Qwen3-ASR-1.7B');
      form.append('file', new Blob([audioBuf], { type: mime }), `voice_input.${ext}`);

      const resp = await fetch(asrCfg.endpoint || 'https://api.siliconflow.cn/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${asrCfg.apiKey}`
        },
        body: form,
        signal: AbortSignal.timeout(15000)
      });

      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        return sendJson(res, 400, {
          ok: false,
          error: sanitizePublicErrorMessage(new Error(data?.message || `语音识别返回异常 (${resp.status})`))
        });
      }
      return sendJson(res, 200, {
        ok: true,
        text: String(data?.text || '').trim(),
        model: asrCfg.model || 'Qwen/Qwen3-ASR-1.7B'
      });
    } catch (err) {
      return sendJson(res, 400, {
        ok: false,
        error: sanitizePublicErrorMessage(err, '语音识别请求超时，请重试或直接打字')
      });
    }
  }

  // 测试商业配音音源连通性并返回试听音频（严格限站长访问）
  if (method === 'POST' && pathname === '/api/tts/test') {
    if (!currentUser.is_admin) {
      return sendJson(res, 403, { ok: false, error: '权限不足：音源网关配置与调试仅限站长访问' });
    }
    const body = await readJsonBody(req);
    const incoming = { ...(body.settings || {}) };
    if (incoming.tts_api_key && String(incoming.tts_api_key).includes('••')) {
      delete incoming.tts_api_key;
    }
    try {
      if (incoming.tts_endpoint) {
        assertSafeExternalGatewayUrl(incoming.tts_endpoint, '语音合成网关地址');
      }
    } catch (err) {
      return sendJson(res, 400, { ok: false, error: err.message });
    }

    const mergedSettings = { ...getExecutionSettingsForUser(userId), ...incoming };
    const isCute = body.style === 'cute';
    const sampleText = isCute
      ? '锵锵！听到我的声音了吗？以后我就用这个专属商业音源天天陪在你身边啦！'
      : '听清楚我的声音了么？靠过来些……往后你想听什么，我都只讲给你一个人听。';

    try {
      const ttsRes = await synthesizeNeuralSpeech({
        text: sampleText,
        voiceId: isCute ? 'otome_sunny' : 'otome_boss',
        settings: mergedSettings,
        strictCommercial: mergedSettings.tts_provider !== 'offline_kokoro'
      });
      const outBuf = ttsRes.audioBuffer || ttsRes.wavBuffer;
      if (!ttsRes.ok || !outBuf) {
        return sendJson(res, 400, { ok: false, error: sanitizePublicErrorMessage(new Error(ttsRes.error || '配音合成失败')) });
      }
      return sendJson(res, 200, {
        ok: true,
        engine: ttsRes.engineName || '本地引擎',
        mime_type: ttsRes.mimeType || 'audio/wav',
        audio_b64: outBuf.toString('base64'),
        message: `✅ 音源握手成功（引擎：${ttsRes.engineName}），正在为您播放试听语音！`
      });
    } catch (err) {
      return sendJson(res, 400, {
        ok: false,
        error: sanitizePublicErrorMessage(err, '商业配音接口连接失败，请核对 API Key 与参数')
      });
    }
  }

  // 上传 8~15 秒乙游 / AI 漫剧男音参考样片，一键复刻专属男主声纹（严格限站长访问）
  if (method === 'POST' && pathname === '/api/tts/clone-voice') {
    if (!currentUser.is_admin) {
      return sendJson(res, 403, { ok: false, error: '权限不足：平台声纹复刻仅限站长操作' });
    }
    const body = await readJsonBody(req, 10 * 1024 * 1024);
    const incoming = { ...(body.settings || {}) };
    if (incoming.tts_api_key && String(incoming.tts_api_key).includes('••')) {
      delete incoming.tts_api_key;
    }
    try {
      if (incoming.tts_endpoint) {
        assertSafeExternalGatewayUrl(incoming.tts_endpoint, '语音合成网关地址');
      }
      const mergedSettings = { ...getExecutionSettingsForUser(userId), ...incoming };
      const resClone = await cloneReferenceVoice({
        audioDataUrl: body.audio_data_url || '',
        refText: body.ref_text || '',
        customName: body.custom_name || 'otome-male-lead',
        settings: mergedSettings
      });

      const patch = {};
      if (resClone.mode === 'siliconflow_uri' && resClone.uri) {
        patch.tts_cool_voice = resClone.uri;
      } else if (resClone.mode === 'fish_inline_ref') {
        patch.tts_ref_audio = body.audio_data_url || '';
        patch.tts_ref_text = body.ref_text || '';
      } else if (resClone.mode === 'qwen_local_ref') {
        patch.tts_ref_text = body.ref_text || '参考男主声纹';
      }
      const platformConfig = updateAdminPlatformConfig({ ...(body.settings || {}), ...patch });

      return sendJson(res, 200, {
        ok: true,
        ...resClone,
        platform_config: platformConfig
      });
    } catch (err) {
      return sendJson(res, 400, {
        ok: false,
        error: sanitizePublicErrorMessage(err, '参考男音复刻失败')
      });
    }
  }

  const companionVoiceChatMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/companion\/voice-chat$/);
  if (companionVoiceChatMatch && method === 'POST') {
    const sessionId = decodeURIComponent(companionVoiceChatMatch[1]);
    const session = db
      .prepare('SELECT * FROM sessions WHERE id = ? AND user_id = ?')
      .get(sessionId, userId);
    if (!session) return sendJson(res, 404, { error: '会话不存在' });

    const body = await readJsonBody(req);
    const userSpoken = String(body.text || '').trim();
    const persona = resolveEffectivePersona(session);

    let prevComp = null;
    try {
      if (session.companion_config) prevComp = JSON.parse(session.companion_config);
    } catch {}

    const companion = resolveOrGenerateCompanion({
      persona,
      currentConfig: prevComp,
      requestedVoice: body.voiceId
    });

    if (body.voiceId && body.voiceId !== prevComp?.voiceId) {
      db.prepare('UPDATE sessions SET companion_config = ?, updated_at = ? WHERE id = ?').run(
        JSON.stringify(companion),
        Date.now(),
        sessionId
      );
    }

    if (userSpoken && session.enable_auto_memory) {
      extractFactsFromUserTurn(sessionId, userSpoken);
    }

    const nurturingBefore = formatNurturingSnapshot(session);
    const voiceMeta = resolveVoiceForCompanion(companion, body.voiceId);
    const isCuteVoice = voiceMeta.style === 'cute' || companion.mode === 'cute';

    let replyText = '';
    const settings = getExecutionSettingsForUser(userId);
    const cred = getEffectiveApiCredentials(settings);
    recordUserDailyEvent(userId, 'companion_interacted');

    const chatEndpoint = cred.endpoints?.chatUrl || cred.baseUrl;
    if (cred.hasKey && cred.apiKey && chatEndpoint) {
      try {
        const sysPrompt = `你现在正站在聊天框旁与「${currentUser.nickname || '你'}」进行实时面对面语音通话。
你的人设：${persona.name}（${persona.personality || persona.tagline || ''}）。
当前声线气质：${isCuteVoice ? '软萌元气可爱、亲昵撒娇、灵动治愈' : '清冷低沉帅气、磁性苏感、外冷内热宠溺'}。
【绝对规则】：
1. 只输出你要亲口说出口的 1~2 句自然口语对白（严格控制在 25~65 个汉字以内）！
2. 严禁出现任何星号动作描写（如 *轻笑*）、严禁括号旁白、严禁 Emoji 表情符号，必须是 100% 纯净可朗读的人声台词！`;

        const llmResp = await fetch(chatEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(cred.headers || { Authorization: `Bearer ${cred.apiKey}` })
          },
          body: JSON.stringify({
            model: cred.preferredModel || cred.chatModel || 'deepseek-flash',
            messages: [
              { role: 'system', content: sysPrompt },
              { role: 'user', content: userSpoken || '（轻轻开口叫了你一声）' }
            ],
            max_tokens: 120,
            temperature: 0.85,
            stream: false
          }),
          signal: AbortSignal.timeout(7000)
        });
        if (llmResp.ok) {
          const llmJson = await llmResp.json();
          const rawOut = llmJson.choices?.[0]?.message?.content || '';
          replyText = rawOut.replace(/\*[^*]*\*/g, '').replace(/（[^）]*）|\([^)]*\)/g, '').trim();
        }
      } catch {}
    }

    if (!replyText) {
      replyText = buildOfflineVoiceChatReply({
        persona,
        companion: { ...companion, mode: isCuteVoice ? 'cute' : 'cool' },
        userNickname: currentUser.nickname,
        stageLevel: nurturingBefore.stage?.level || 1,
        userText: userSpoken
      });
    }

    // 语音亲密互动微幅提升好感与默契
    const nextAff = Math.min(100, (session.affection ?? 22) + 1);
    const nextInt = Math.min(100, (session.intimacy ?? 18) + 1);
    db.prepare('UPDATE sessions SET affection = ?, intimacy = ?, updated_at = ? WHERE id = ?').run(
      nextAff,
      nextInt,
      Date.now(),
      sessionId
    );
    const updatedSess = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);

    const ttsRes = await synthesizeNeuralSpeech({
      text: replyText,
      voiceId: voiceMeta.id,
      settings
    });
    const outBuf = ttsRes.audioBuffer || ttsRes.wavBuffer;

    return sendJson(res, 200, {
      ok: true,
      user_text: userSpoken,
      reply_text: replyText,
      tag: isCuteVoice ? `🎙️ ${voiceMeta.label}` : `🎙️ ${voiceMeta.label}`,
      voice: voiceMeta,
      voices: Object.values(VOICE_CATALOG),
      tts_engine: ttsRes.engineName || 'local',
      audio_mime: ttsRes.mimeType || 'audio/wav',
      audio_b64: ttsRes.ok && outBuf ? outBuf.toString('base64') : null,
      fallback_tts: !ttsRes.ok,
      duration: ttsRes.duration || 0,
      companion,
      nurturing: formatNurturingSnapshot(updatedSess)
    });
  }

  const sessionDetailMatch = pathname.match(/^\/api\/sessions\/([^/]+)$/);
  if (sessionDetailMatch) {
    const sessionId = decodeURIComponent(sessionDetailMatch[1]);
    const session = db
      .prepare('SELECT * FROM sessions WHERE id = ? AND user_id = ?')
      .get(sessionId, userId);
    if (!session) return sendJson(res, 404, { error: '未找到该会话' });

    if (method === 'GET') {
      const msgLimit = Math.min(200, Math.max(10, parseInt(parsedUrl.searchParams.get('limit') || '60', 10) || 60));
      const beforeId = Math.max(0, parseInt(parsedUrl.searchParams.get('before_id') || '0', 10) || 0);
      const loadAll = parsedUrl.searchParams.get('all') === '1';
      return sendJson(
        res,
        200,
        buildSessionDetailPayload(session, userId, { limit: msgLimit, beforeId, loadAll })
      );
    }

    if (method === 'PATCH') {
      const body = await readJsonBody(req);
      const title = body.title !== undefined ? String(body.title).trim() || session.title : session.title;
      const rollingSummary =
        body.rolling_summary !== undefined ? String(body.rolling_summary) : session.rolling_summary;
      const directorNote =
        body.director_note !== undefined ? String(body.director_note) : session.director_note || '';
      const sessionPrompt =
        body.session_prompt !== undefined ? String(body.session_prompt) : session.session_prompt || '';
      const nextCustomOverride = body.clear_persona_override
        ? null
        : session.custom_persona_override;
      const enableThought =
        body.enable_inner_thought !== undefined
          ? body.enable_inner_thought
            ? 1
            : 0
          : session.enable_inner_thought;
      const enableAutoMem =
        body.enable_auto_memory !== undefined
          ? body.enable_auto_memory
            ? 1
            : 0
          : session.enable_auto_memory;
      const nextMode =
        body.session_mode !== undefined
          ? body.session_mode === 'deepseek_native'
            ? 'deepseek_native'
            : 'roleplay'
          : session.session_mode || 'roleplay';
      const dsThinking =
        body.ds_thinking !== undefined ? (body.ds_thinking ? 1 : 0) : session.ds_thinking ?? 1;
      const dsSearch =
        body.ds_search !== undefined ? (body.ds_search ? 1 : 0) : session.ds_search ?? 0;
      const dsJsonMode =
        body.ds_json_mode !== undefined ? (body.ds_json_mode ? 1 : 0) : session.ds_json_mode ?? 0;
      const dsTools =
        body.ds_tools_enabled !== undefined
          ? body.ds_tools_enabled
            ? 1
            : 0
          : session.ds_tools_enabled ?? 1;
      const proactiveEnabled =
        body.proactive_enabled !== undefined
          ? body.proactive_enabled
            ? 1
            : 0
          : session.proactive_enabled ?? 1;
      const pinned =
        body.pinned !== undefined ? (body.pinned ? 1 : 0) : session.pinned ?? 0;
      const titleLocked =
        body.title_locked !== undefined
          ? body.title_locked
            ? 1
            : 0
          : body.title !== undefined && String(body.title).trim() && String(body.title).trim() !== '新对话'
          ? 1
          : session.title_locked ?? 0;

      // 纯切换置顶/重命名时保留原 updated_at，避免取消置顶后打乱原有历史时间分组
      const isMetaOnlyPatch =
        Object.keys(body || {}).every((k) => k === 'pinned' || k === 'title' || k === 'title_locked');
      const nextUpdatedAt = isMetaOnlyPatch ? session.updated_at : Date.now();

      let nextPersonaId = session.persona_id;
      if (body.persona_id) {
        const checkP = db
          .prepare(
            "SELECT id FROM personas WHERE id = ? AND (user_id = ? OR user_id = 'system' OR user_id = 'system_ds')"
          )
          .get(body.persona_id, userId);
        if (checkP) nextPersonaId = checkP.id;
      }

      const nextLlmMode =
        body.llm_mode !== undefined
          ? (body.llm_mode === 'api' ? 'api' : 'local_antigravity')
          : session.llm_mode || 'local_antigravity';
      const nextLocalModel =
        body.local_model !== undefined ? String(body.local_model).trim() : session.local_model || 'gemini-3.8-flash-high';

      db.prepare(`
        UPDATE sessions
        SET title = ?, title_locked = ?, pinned = ?, persona_id = ?, session_mode = ?, ds_thinking = ?, ds_search = ?, ds_json_mode = ?, ds_tools_enabled = ?,
            proactive_enabled = ?, rolling_summary = ?, director_note = ?, session_prompt = ?, custom_persona_override = ?, enable_inner_thought = ?, enable_auto_memory = ?,
            llm_mode = ?, local_model = ?, updated_at = ?
        WHERE id = ? AND user_id = ?
      `).run(
        title,
        titleLocked,
        pinned,
        nextPersonaId,
        nextMode,
        dsThinking,
        dsSearch,
        dsJsonMode,
        dsTools,
        proactiveEnabled,
        rollingSummary,
        directorNote,
        sessionPrompt,
        nextCustomOverride,
        enableThought,
        enableAutoMem,
        nextLlmMode,
        nextLocalModel,
        nextUpdatedAt,
        sessionId,
        userId
      );

      if (body.director_note && String(body.director_note).trim()) {
        recordUserDailyEvent(userId, 'theater_used');
      }

      const updated = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
      return sendJson(res, 200, {
        session: updated,
        persona: formatPersonaRow(resolveEffectivePersona(updated)),
        sessions: listSessionsForUser(userId)
      });
    }

    if (method === 'DELETE') {
      db.prepare('DELETE FROM sessions WHERE id = ? AND user_id = ?').run(sessionId, userId);
      return sendJson(res, 200, { ok: true, sessions: listSessionsForUser(userId) });
    }
  }

  // ========= 6.5 平行时空剧情分支 & 单条消息精修回溯 =========
  const sessionBranchMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/branch$/);
  if (sessionBranchMatch && method === 'POST') {
    const srcSessionId = decodeURIComponent(sessionBranchMatch[1]);
    const srcSession = db
      .prepare('SELECT * FROM sessions WHERE id = ? AND user_id = ?')
      .get(srcSessionId, userId);
    if (!srcSession) return sendJson(res, 404, { error: '原会话不存在' });

    const body = await readJsonBody(req);
    const uptoMsgId = Number(body.upto_message_id || 0);

    const now = Date.now();
    const newSessionId = genId('sess');
    const cleanBaseTitle = srcSession.title.replace(/^🌿【平行线】/, '');
    const branchTitle = `🌿【平行线】${cleanBaseTitle}`.slice(0, 26);

    db.prepare(`
      INSERT INTO sessions (
        id, user_id, persona_id, title, session_mode, ds_thinking, ds_search, ds_json_mode, ds_tools_enabled, proactive_enabled,
        custom_persona_override, rolling_summary, summarized_until_msg_id,
        enable_inner_thought, enable_auto_memory, affection, trust, intimacy, current_mood, secret_diary, director_note, session_prompt, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      newSessionId,
      userId,
      srcSession.persona_id,
      branchTitle,
      srcSession.session_mode || 'roleplay',
      srcSession.ds_thinking ?? 1,
      srcSession.ds_search ?? 0,
      srcSession.ds_json_mode ?? 0,
      srcSession.ds_tools_enabled ?? 1,
      srcSession.proactive_enabled ?? 1,
      srcSession.custom_persona_override,
      srcSession.rolling_summary || '',
      srcSession.enable_inner_thought,
      srcSession.enable_auto_memory,
      srcSession.affection ?? 22,
      srcSession.trust ?? 26,
      srcSession.intimacy ?? 18,
      srcSession.current_mood || '温柔浅笑',
      srcSession.secret_diary || '[]',
      srcSession.director_note || '',
      srcSession.session_prompt || '',
      now,
      now
    );

    const srcMsgs = uptoMsgId > 0
      ? db.prepare('SELECT * FROM messages WHERE session_id = ? AND id <= ? ORDER BY id ASC').all(srcSessionId, uptoMsgId)
      : db.prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY id ASC').all(srcSessionId);

    const copyMsgStmt = db.prepare(`
      INSERT INTO messages (session_id, role, reasoning, content, meta_json, duration_ms, recalled_count, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const m of srcMsgs) {
      copyMsgStmt.run(
        newSessionId,
        m.role,
        m.reasoning || '',
        m.content,
        m.meta_json || null,
        m.duration_ms || 0,
        m.recalled_count || 0,
        m.created_at
      );
    }

    const srcMems = db.prepare('SELECT * FROM memories WHERE session_id = ?').all(srcSessionId);
    const copyMemStmt = db.prepare(`
      INSERT INTO memories (id, session_id, category, slot_key, content, pinned, importance, strength, recall_count, last_recalled_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const mem of srcMems) {
      copyMemStmt.run(
        genId('mem'),
        newSessionId,
        mem.category,
        mem.slot_key || null,
        mem.content,
        mem.pinned,
        mem.importance,
        mem.strength || 3.0,
        mem.recall_count || 1,
        mem.last_recalled_at || now,
        now,
        now
      );
    }

    recordUserDailyEvent(userId, 'branch_created');
    return sendJson(res, 201, {
      session_id: newSessionId,
      sessions: listSessionsForUser(userId)
    });
  }

  const msgRewindMatch = pathname.match(/^\/api\/messages\/(\d+)\/rewind$/);
  if (msgRewindMatch && method === 'POST') {
    const msgId = Number(msgRewindMatch[1]);
    const msgRow = db
      .prepare(`
        SELECT m.*, s.user_id FROM messages m
        JOIN sessions s ON s.id = m.session_id
        WHERE m.id = ? AND s.user_id = ?
      `)
      .get(msgId, userId);
    if (!msgRow) return sendJson(res, 404, { error: '未找到该条消息' });

    db.prepare('DELETE FROM messages WHERE session_id = ? AND id > ?').run(msgRow.session_id, msgId);
    return sendJson(res, 200, { ok: true });
  }

  const msgEditMatch = pathname.match(/^\/api\/messages\/(\d+)$/);
  if (msgEditMatch && method === 'PATCH') {
    const msgId = Number(msgEditMatch[1]);
    const msgRow = db
      .prepare(`
        SELECT m.*, s.user_id FROM messages m
        JOIN sessions s ON s.id = m.session_id
        WHERE m.id = ? AND s.user_id = ?
      `)
      .get(msgId, userId);
    if (!msgRow) return sendJson(res, 404, { error: '未找到该条消息' });

    const body = await readJsonBody(req);
    let parsedMeta = {};
    try {
      parsedMeta = JSON.parse(msgRow.meta_json || '{}') || {};
    } catch {
      parsedMeta = {};
    }

    let nextContent = msgRow.content;
    let nextReasoning = msgRow.reasoning || '';
    let nextDuration = msgRow.duration_ms || 0;

    // 1) 支持切换多版本回答 (< 1 / 2 >)
    if (body.active_version !== undefined && Array.isArray(parsedMeta.versions)) {
      const idx = Number(body.active_version);
      if (Number.isInteger(idx) && idx >= 0 && idx < parsedMeta.versions.length) {
        const ver = parsedMeta.versions[idx];
        parsedMeta.active_version = idx;
        nextContent = ver.content || nextContent;
        nextReasoning = ver.reasoning || '';
        nextDuration = ver.duration_ms || 0;
        if (Array.isArray(ver.search_results)) parsedMeta.search_results = ver.search_results;
        if (Array.isArray(ver.tool_calls)) parsedMeta.tool_calls = ver.tool_calls;
        if (ver.usage !== undefined) parsedMeta.usage = ver.usage;
      }
    }

    // 2) 支持修改单条消息文本内容（同步更新当前激活版本）
    if (body.content !== undefined) {
      const trimmed = String(body.content || '').trim();
      if (!trimmed) return sendJson(res, 400, { error: '修改后的内容不能为空' });
      nextContent = trimmed;
      if (Array.isArray(parsedMeta.versions)) {
        const curIdx = parsedMeta.active_version ?? parsedMeta.versions.length - 1;
        if (parsedMeta.versions[curIdx]) {
          parsedMeta.versions[curIdx].content = trimmed;
        }
      }
    }

    // 3) 支持保存点赞/点踩质量反馈 ('up' | 'down' | '')
    if (body.feedback !== undefined) {
      const fb = String(body.feedback || '');
      parsedMeta.feedback = fb === 'up' || fb === 'down' ? fb : '';
    }

    const nextMetaStr = Object.keys(parsedMeta).length > 0 ? JSON.stringify(parsedMeta) : null;
    db.prepare(
      'UPDATE messages SET content = ?, reasoning = ?, duration_ms = ?, meta_json = ? WHERE id = ?'
    ).run(nextContent, nextReasoning, nextDuration, nextMetaStr, msgId);

    return sendJson(res, 200, {
      ok: true,
      content: nextContent,
      reasoning: nextReasoning,
      duration_ms: nextDuration,
      meta: parsedMeta
    });
  }

  // ========= 7. 单条记忆更新与删除 =========
  const memItemMatch = pathname.match(/^\/api\/memories\/([^/]+)$/);
  if (memItemMatch) {
    const memId = decodeURIComponent(memItemMatch[1]);
    const existing = db
      .prepare(`
        SELECT m.* FROM memories m
        JOIN sessions s ON s.id = m.session_id
        WHERE m.id = ? AND s.user_id = ?
      `)
      .get(memId, userId);
    if (!existing) return sendJson(res, 404, { error: '未找到该条记忆' });

    if (method === 'PATCH') {
      const body = await readJsonBody(req);
      const pinned = body.pinned !== undefined ? (body.pinned ? 1 : 0) : existing.pinned;
      const content = body.content !== undefined ? String(body.content).trim() || existing.content : existing.content;
      const category = pinned ? 'Pinned' : existing.category === 'Pinned' ? 'fact' : existing.category;

      db.prepare(`
        UPDATE memories SET content = ?, pinned = ?, category = ?, updated_at = ? WHERE id = ?
      `).run(content, pinned, category, Date.now(), memId);

      const memories = decorateMemoriesWithRetention(
        db
          .prepare('SELECT * FROM memories WHERE session_id = ? ORDER BY pinned DESC, importance DESC, updated_at DESC')
          .all(existing.session_id)
      );
      return sendJson(res, 200, { memories });
    }

    if (method === 'DELETE') {
      db.prepare('DELETE FROM memories WHERE id = ?').run(memId);
      const memories = decorateMemoriesWithRetention(
        db
          .prepare('SELECT * FROM memories WHERE session_id = ? ORDER BY pinned DESC, importance DESC, updated_at DESC')
          .all(existing.session_id)
      );
      return sendJson(res, 200, { memories });
    }
  }

  // ========= 8. 网关配置、连通性测试与个人 DeepSeek 官方 API 余额探针（严格物理隔离） =========
  if (method === 'GET' && pathname === '/api/deepseek/my-balance') {
    const safePrefs = getSafeClientSettings(userId);
    const savedOwn = getRawUserOwnDeepSeekConfig(userId);
    const isUsingOwn = safePrefs.provider === 'own_deepseek' && Boolean(savedOwn.apiKey);
    if (!isUsingOwn) {
      return sendJson(res, 200, {
        enabled: false,
        reason: 'not_using_own_key'
      });
    }

    const baseUrl = String(savedOwn.baseUrl || OFFICIAL_DEEPSEEK_CHAT_URL).trim();
    const lowerBase = baseUrl.toLowerCase();
    const modelName = savedOwn.model || 'deepseek-chat';

    // 1) DeepSeek 官方 API 实时余额查询 (GET https://api.deepseek.com/user/balance)
    if (lowerBase.includes('deepseek.com')) {
      try {
        const balData = await fetchDeepSeekBalance({
          provider: 'deepseek',
          deepseek_base_url: baseUrl,
          deepseek_api_key: savedOwn.apiKey
        });
        const infos = Array.isArray(balData.balance_infos) ? balData.balance_infos : [];
        const cnyInfo = infos.find((x) => x.currency === 'CNY') || infos[0] || null;
        const currency = cnyInfo?.currency || 'CNY';
        const symbol = currency === 'USD' ? '$' : '¥';
        return sendJson(res, 200, {
          enabled: true,
          provider_label: 'DeepSeek 官方 API',
          is_official_deepseek: true,
          balance_supported: Boolean(cnyInfo && balData.source === 'live'),
          is_available: balData.is_available !== false,
          currency,
          symbol,
          total_balance: cnyInfo ? String(cnyInfo.total_balance ?? '0.00') : null,
          granted_balance: cnyInfo ? String(cnyInfo.granted_balance ?? '0.00') : '0.00',
          topped_up_balance: cnyInfo ? String(cnyInfo.topped_up_balance ?? '0.00') : '0.00',
          model: modelName,
          checked_at: Date.now()
        });
      } catch (err) {
        return sendJson(res, 200, {
          enabled: true,
          provider_label: 'DeepSeek 官方 API',
          is_official_deepseek: true,
          balance_supported: false,
          model: modelName,
          error: sanitizePublicErrorMessage(err, '暂时无法读取余额')
        });
      }
    }

    // 2) 兼容硅基流动个人 API 余额查询 (GET https://api.siliconflow.cn/v1/user/info)
    if (lowerBase.includes('siliconflow.cn')) {
      try {
        const sfRes = await fetch('https://api.siliconflow.cn/v1/user/info', {
          headers: { Authorization: `Bearer ${savedOwn.apiKey}` },
          signal: AbortSignal.timeout(8000)
        });
        if (sfRes.ok) {
          const sfJson = await sfRes.json().catch(() => ({}));
          const uData = sfJson?.data || {};
          const totalBal = uData.totalBalance ?? uData.balance ?? null;
          if (totalBal !== null && totalBal !== undefined) {
            return sendJson(res, 200, {
              enabled: true,
              provider_label: 'SiliconFlow API',
              is_official_deepseek: false,
              balance_supported: true,
              is_available: Number(totalBal) > 0,
              currency: 'CNY',
              symbol: '¥',
              total_balance: Number(totalBal).toFixed(2),
              granted_balance: uData.balance !== undefined ? Number(uData.balance).toFixed(2) : '0.00',
              topped_up_balance: uData.chargeBalance !== undefined ? Number(uData.chargeBalance).toFixed(2) : '0.00',
              model: modelName,
              checked_at: Date.now()
            });
          }
        }
      } catch {}
    }

    // 3) 其他兼容网关：正常激活插件展示实时 Context Cache 缓冲命中率与 Token 统计
    return sendJson(res, 200, {
      enabled: true,
      provider_label: '个人兼容 API',
      is_official_deepseek: false,
      balance_supported: false,
      is_available: true,
      model: modelName,
      checked_at: Date.now()
    });
  }

  if (method === 'GET' && pathname === '/api/deepseek/balance') {
    if (!currentUser.is_admin) {
      return sendJson(res, 403, { error: '权限不足：平台 API 账户余额仅限站长查看' });
    }
    const balance = await fetchDeepSeekBalance(getRawPlatformConfigInternal());
    return sendJson(res, 200, balance);
  }

  if (method === 'GET' && pathname === '/api/deepseek/models') {
    if (!currentUser.is_admin) {
      return sendJson(res, 403, { error: '权限不足：上游模型探针仅限站长查看' });
    }
    const modelsInfo = await fetchDeepSeekModels(getRawPlatformConfigInternal());
    return sendJson(res, 200, modelsInfo);
  }

  if (method === 'POST' && pathname === '/api/deepseek/fim') {
    const body = await readJsonBody(req);
    const safePrefs = getSafeClientSettings(userId);
    const usingOwnKeyPref = safePrefs.provider === 'own_deepseek' && safePrefs.has_own_deepseek_key;
    const fimAccess =
      safePrefs.provider === 'online'
        ? verifyOnlineChatAccess(userId)
        : { allowed: usingOwnKeyPref };
    const allowCloudFim = Boolean(usingOwnKeyPref || fimAccess.allowed);
    try {
      const result = await runDeepSeekFimCompletion({
        settings: getExecutionSettingsForUser(userId, { forceDemoLlm: !allowCloudFim }),
        prompt: String(body.prompt || '').slice(0, 4000),
        suffix: String(body.suffix || '').slice(0, 2000),
        tone: body.tone || 'gentle',
        personaName: String(body.persona_name || '').slice(0, 60),
        variant: body.variant || 0,
        maxTokens: Math.min(512, Math.max(32, Number(body.max_tokens) || 256)),
        temperature: body.temperature ?? 0.7
      });
      return sendJson(res, 200, result);
    } catch (err) {
      return sendJson(res, 400, { error: sanitizePublicErrorMessage(err, '灵感补写失败，请稍后重试') });
    }
  }

  if ((method === 'PUT' || method === 'POST') && pathname === '/api/settings') {
    const body = await readJsonBody(req);
    try {
      const updated = updateSafeClientSettings(userId, body);
      return sendJson(res, 200, { settings: updated });
    } catch (err) {
      const code = err.statusCode || 400;
      return sendJson(res, code, { error: err.message, code: err.code || 'SETTINGS_ERROR' });
    }
  }

  // 验证个人填写的 API Key 与兼容网关连通性
  if (method === 'POST' && pathname === '/api/settings/verify-own-key') {
    if (!checkRateLimit(`verify-own-key:${userId}`, 12, 60000)) {
      return sendJson(res, 429, { ok: false, error: '验证请求过于频繁，请稍后再试' });
    }

    const body = await readJsonBody(req, 16 * 1024);
    const savedOwn = getRawUserOwnDeepSeekConfig(userId);
    const incomingRaw = String(body.own_deepseek_api_key || '').trim();
    const candidateKey =
      incomingRaw && !incomingRaw.includes('••••') ? incomingRaw : savedOwn.apiKey;

    if (!candidateKey) {
      return sendJson(res, 400, {
        ok: false,
        error: '请先把您的密钥粘贴到输入框里（一般是以 sk- 开头的一串字母数字）'
      });
    }

    let validKey;
    let targetBaseUrl = savedOwn.baseUrl || OFFICIAL_DEEPSEEK_CHAT_URL;
    try {
      validKey = validateOfficialDeepSeekApiKey(candidateKey);
      if (body.own_api_base_url !== undefined) {
        targetBaseUrl = validateSafeUserApiBaseUrl(body.own_api_base_url);
      }
    } catch (err) {
      return sendJson(res, 400, { ok: false, error: err.message });
    }
    const targetModel = normalizeModelForEndpoint(
      sanitizeUserModelName(body.own_deepseek_model || savedOwn.model || 'deepseek-flash'),
      targetBaseUrl
    );

    const isOfficialDs = targetBaseUrl.includes('deepseek.com');
    try {
      if (isOfficialDs) {
        const balData = await fetchDeepSeekBalance({
          provider: 'deepseek',
          deepseek_base_url: targetBaseUrl,
          deepseek_api_key: validKey
        });
        if (balData.source === 'live') {
          const firstInfo = Array.isArray(balData.balance_infos) && balData.balance_infos[0];
          const curSym = firstInfo?.currency === 'USD' ? '$' : '¥';
          const balText = firstInfo ? `${curSym}${firstInfo.total_balance}` : '有效';
          return sendJson(res, 200, {
            ok: true,
            is_available: Boolean(balData.is_available),
            balance_text: balText,
            message: firstInfo
              ? `✅ 连接成功！您的 DeepSeek 官网密钥可以正常使用（已默认接入最新 DeepSeek V4.1 Flash，账户余额：${balText}）${
                  balData.is_available ? '，点右下角「保存设置」就能开始聊天啦！' : ' —— 温馨提醒：当前账户余额为 0，去官网充一点点就能聊啦'
                }`
              : '✅ 连接成功！您的 DeepSeek 密钥已准备就绪，点右下角「保存设置」即可开始聊天！'
          });
        }
      }

      // 通用对话端点握手探测（兼容官方及硅基流动/百炼/OpenRouter等任意平台）
      const t0 = Date.now();
      const lowerProbeUrl = targetBaseUrl.toLowerCase();
      const isGeminiProbe = lowerProbeUrl.includes('googleapis.com') || /gemini/i.test(targetModel);
      const probeBody = {
        model: targetModel,
        messages: [{ role: 'user', content: '你好，请回复“已连接”三个字' }],
        max_tokens: 16,
        stream: false
      };
      if (isGeminiProbe) {
        // Google Gemini 官方 OpenAI 兼容接口：保持干净标准载荷，绝不附带 thinking 专有参数
      } else if (isOfficialDs && targetModel.toLowerCase().includes('flash')) {
        probeBody.thinking = { type: 'disabled' };
      } else if ((lowerProbeUrl.includes('siliconflow.cn') || lowerProbeUrl.includes('aliyuncs.com')) && targetModel.toLowerCase().includes('flash')) {
        probeBody.enable_thinking = false;
      }
      const probeRes = await fetch(targetBaseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${validKey}`
        },
        body: JSON.stringify(probeBody),
        signal: AbortSignal.timeout(12000)
      });

      if (!probeRes.ok) {
        const errTxt = await probeRes.text().catch(() => '');
        const isAuthFail = probeRes.status === 401 || probeRes.status === 403;
        const isModelFail = /model.*not.*found|does not exist|invalid.*model/i.test(errTxt);
        const friendlyErr = isAuthFail
          ? '密钥好像填错啦，或者选错了购买平台（比如硅基流动的密钥要点上面的「硅基流动」按钮哦），请核对后再试'
          : isModelFail
          ? `密钥本身是对的，但该平台暂未开通模型「${targetModel}」，可展开下方「高级选项」更换模型名称`
          : sanitizePublicErrorMessage(
              new Error(`连接未成功 (${probeRes.status})：请检查密钥是否复制完整，或是否选对了平台按钮`)
            );
        return sendJson(res, 400, {
          ok: false,
          error: friendlyErr
        });
      }

      await probeRes.json().catch(() => ({}));
      const voiceBonusTip = lowerProbeUrl.includes('siliconflow.cn')
        ? '（同时已自动为您解锁男女语音朗读与语音输入！）'
        : lowerProbeUrl.includes('aliyuncs.com')
        ? '（同时已自动为您解锁男女语音朗读！）'
        : '';
      return sendJson(res, 200, {
        ok: true,
        is_available: true,
        message: `✅ 连接成功！（用时 ${Date.now() - t0} 毫秒，当前模型：${targetModel}）${voiceBonusTip}记得点右下角「保存设置」生效哦！`
      });
    } catch (err) {
      return sendJson(res, 400, {
        ok: false,
        error: sanitizePublicErrorMessage(err, '暂时连不上这个平台，请检查网络或确认是否选对了平台按钮')
      });
    }
  }

  if (method === 'POST' && pathname === '/api/settings/test') {
    if (!currentUser.is_admin) {
      return sendJson(res, 403, {
        ok: false,
        error: '权限不足：网关连通性探针仅限站长在后台操作'
      });
    }
    const body = await readJsonBody(req);
    const rawPlat = getRawPlatformConfigInternal();
    const incoming = { ...(body || {}) };
    for (const secretKey of ['deepseek_api_key', 'custom_gateway_token', 'tts_api_key']) {
      if (incoming[secretKey] && String(incoming[secretKey]).includes('••')) {
        delete incoming[secretKey];
      }
    }
    try {
      if (incoming.deepseek_base_url) assertSafeExternalGatewayUrl(incoming.deepseek_base_url, 'DeepSeek 接口地址');
      if (incoming.custom_gateway_url) assertSafeExternalGatewayUrl(incoming.custom_gateway_url, '自定义网关地址');
    } catch (err) {
      return sendJson(res, 400, { ok: false, error: err.message });
    }

    const mergedSettings = {
      ...getExecutionSettingsForUser(userId),
      ...rawPlat,
      ...incoming,
      provider:
        (incoming.online_provider_type || rawPlat.online_provider_type) === 'custom_gateway'
          ? 'custom_gateway'
          : 'deepseek'
    };

    const startTime = Date.now();
    let sampleOut = '';
    try {
      await streamPersonaChat({
        settings: mergedSettings,
        contextBundle: {
          persona: { name: '连通测试使者', tagline: '', personality: '', backstory: '' },
          session: { enable_inner_thought: 0 },
          messagesPayload: [{ role: 'user', content: '请回复“星轨已连接”五个字。' }],
          recalledMemories: [],
          rollingSummary: ''
        },
        latestUserText: '连接测试',
        onReasoning: () => {},
        onContent: (chunk) => {
          sampleOut += chunk;
        },
        signal: AbortSignal.timeout(12000)
      });
      const elapsed = Date.now() - startTime;
      return sendJson(res, 200, {
        ok: true,
        message: `在线通道握手成功（耗时 ${elapsed}ms），返回：${sampleOut.slice(0, 40) || '流式就绪'}`
      });
    } catch (err) {
      return sendJson(res, 400, {
        ok: false,
        error: sanitizePublicErrorMessage(err, '连接在线模型网关失败，请检查接口地址或令牌是否正确')
      });
    }
  }

  // ========= 8.9 全格式文档解析接口（支持 PDF / Word / Excel / PPT / 代码 / 压缩包 / 任意文本自动转码提取） =========
  if (method === 'POST' && pathname === '/api/files/parse') {
    const ctype = String(req.headers['content-type'] || '').toLowerCase();
    let fileName = '未命名文件';
    let fileMime = '';
    let fileBuffer = null;

    if (ctype.includes('application/json')) {
      const body = await readJsonBody(req, 22 * 1024 * 1024);
      fileName = String(body.name || '未命名文件');
      fileMime = String(body.mime || '');
      const b64 = String(body.data_base64 || '').replace(/^data:[^;]+;base64,/, '');
      fileBuffer = Buffer.from(b64, 'base64');
    } else {
      const rawHeaderName = String(req.headers['x-file-name'] || '');
      try {
        fileName = rawHeaderName ? decodeURIComponent(rawHeaderName) : '未命名文件';
      } catch {
        fileName = rawHeaderName || '未命名文件';
      }
      fileMime = String(req.headers['x-file-mime'] || ctype || '');
      fileBuffer = await readRawBufferBody(req, 20 * 1024 * 1024);
    }

    const parsed = parseAnyUploadedFile({
      name: fileName,
      mime: fileMime,
      buffer: fileBuffer
    });
    return sendJson(res, 200, parsed);
  }

  // ========= 9. 核心 SSE 实时流式对话端点（同时驱动恋庭沉浸模式 & 原生 DeepSeek 全家桶模式） =========
  if (method === 'POST' && pathname === '/api/chat/stream') {
    const body = await readJsonBody(req, 8 * 1024 * 1024);
    const sessionId = body.session_id;
    const isRegenerate = Boolean(body.regenerate);
    const editMessageId = Number(body.edit_message_id || 0);
    let userContent = (body.content || '').trim();
    const rawAttachments = Array.isArray(body.attachments) ? body.attachments.slice(0, 8) : [];
    const attachments = rawAttachments
      .filter((a) => a && a.name && (typeof a.content === 'string' || a.is_image))
      .map((a) => ({
        name: String(a.name).slice(0, 140),
        size: Number(a.size) || (a.content ? a.content.length : 0),
        badge: a.badge ? String(a.badge).slice(0, 10) : '',
        color: a.color ? String(a.color).slice(0, 16) : '',
        char_count: Number(a.char_count) || 0,
        is_image: Boolean(a.is_image),
        mime: a.mime ? String(a.mime).slice(0, 64) : '',
        dimensions: a.dimensions ? String(a.dimensions).slice(0, 32) : '',
        data_url: a.is_image && typeof a.data_url === 'string' ? a.data_url.slice(0, 420000) : '',
        content: String(a.content || '').slice(0, 60000)
      }));
    const assistantPrefix = String(body.assistant_prefix || '');

    let session = db
      .prepare('SELECT * FROM sessions WHERE id = ? AND user_id = ?')
      .get(sessionId, userId);
    if (!session) return sendJson(res, 404, { error: '会话不存在' });

    const isNativeMode = session.session_mode === 'deepseek_native';
    const includeFollowUps = body.include_follow_ups !== false;
    const settings = getExecutionSettingsForUser(userId);
    const usingMemberOwnKey = Boolean(settings._using_member_own_key);

    const requestedLlmMode = body.llm_mode || session.llm_mode || 'local_antigravity';
    const localCliPath = getLocalAntigravityCliPath();
    const isLocalAvailable = Boolean(localCliPath);
    const usingLocalAntigravity = requestedLlmMode === 'local_antigravity' && isLocalAvailable;

    if (!usingLocalAntigravity && settings._own_key_unavailable_reason === 'KEY_MISSING') {
      return sendJson(res, 400, {
        error: '您已选择个人 API 直连，但尚未填写有效密钥，请先在「⚙️ 设置」中填入您的密钥，或切换为「⚡ 本地直连模式」。',
        code: 'OWN_KEY_MISSING'
      });
    }

    let effectiveAttachments = attachments;
    let priorAssistantVersions = [];

    if (editMessageId > 0) {
      // 用户编辑历史提问并重新提交（复刻 DeepSeek 官网编辑重发能力）
      const targetUserMsg = db
        .prepare("SELECT * FROM messages WHERE id = ? AND session_id = ? AND role = 'user'")
        .get(editMessageId, sessionId);
      if (!targetUserMsg) {
        return sendJson(res, 404, { error: '待编辑的原提问不存在' });
      }
      if (!userContent) {
        return sendJson(res, 400, { error: '修改后的提问内容不能为空' });
      }
      try {
        const uMeta = JSON.parse(targetUserMsg.meta_json || '{}');
        if (Array.isArray(uMeta.attachments_full)) effectiveAttachments = uMeta.attachments_full;
      } catch {}
      db.prepare('UPDATE messages SET content = ? WHERE id = ?').run(userContent, editMessageId);
      db.prepare('DELETE FROM messages WHERE session_id = ? AND id > ?').run(sessionId, editMessageId);
      db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(Date.now(), sessionId);
    } else if (isRegenerate) {
      // 先校验是否存在前序玩家发言，防止在仅有开场白时误删开场白并报技术错误
      const lastUserMsg = db
        .prepare("SELECT * FROM messages WHERE session_id = ? AND role = 'user' ORDER BY id DESC LIMIT 1")
        .get(sessionId);
      if (!lastUserMsg) {
        return sendJson(res, 400, { error: '请先和 TA 说上一句话，再使用「重演」换一种回答哦' });
      }

      const lastMsg = db
        .prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY id DESC LIMIT 1')
        .get(sessionId);
      if (lastMsg && lastMsg.role === 'assistant') {
        try {
          const oldMeta = JSON.parse(lastMsg.meta_json || '{}') || {};
          if (Array.isArray(oldMeta.versions) && oldMeta.versions.length > 0) {
            priorAssistantVersions = oldMeta.versions;
          } else {
            priorAssistantVersions = [
              {
                reasoning: lastMsg.reasoning || '',
                content: lastMsg.content || '',
                duration_ms: lastMsg.duration_ms || 0,
                search_results: oldMeta.search_results || [],
                tool_calls: oldMeta.tool_calls || [],
                usage: oldMeta.usage || null,
                created_at: lastMsg.created_at || Date.now()
              }
            ];
          }
        } catch {}
        db.prepare('DELETE FROM messages WHERE id = ?').run(lastMsg.id);
      }
      userContent = lastUserMsg.content;
      try {
        const uMeta = JSON.parse(lastUserMsg.meta_json || '{}');
        if (Array.isArray(uMeta.attachments_full)) effectiveAttachments = uMeta.attachments_full;
      } catch {}
    } else {
      if (!userContent && effectiveAttachments.length === 0) {
        return sendJson(res, 400, { error: '发送内容或附件不能为空' });
      }
      if (!userContent && effectiveAttachments.length > 0) {
        userContent = `请帮我详细解析并总结上传的附件：${effectiveAttachments.map((a) => a.name).join('、')}`;
      }

      const userMsgCount = db
        .prepare("SELECT COUNT(*) AS cnt FROM messages WHERE session_id = ? AND role = 'user'")
        .get(sessionId).cnt;

      const now = Date.now();
      const userMeta =
        effectiveAttachments.length > 0
          ? JSON.stringify({
              attachments: effectiveAttachments.map((a) => ({
                name: a.name,
                size: a.size,
                is_image: Boolean(a.is_image),
                mime: a.mime || '',
                dimensions: a.dimensions || '',
                data_url: a.is_image ? a.data_url || '' : ''
              })),
              attachments_full: effectiveAttachments
            })
          : null;

      db.prepare(`
        INSERT INTO messages (session_id, role, reasoning, content, meta_json, duration_ms, recalled_count, created_at)
        VALUES (?, 'user', '', ?, ?, 0, 0, ?)
      `).run(sessionId, userContent, userMeta, now);

      if (userMsgCount === 0 && !session.title_locked) {
        const strippedForTitle = userContent
          .replace(/\*[^*]*\*/g, ' ')
          .replace(/https?:\/\/\S+/gi, '网页链接')
          .replace(/^[“"「『（(\s]+|[”"」』）)\s]+$/g, '')
          .replace(/\s+/g, ' ')
          .trim();
        const firstClause = (strippedForTitle.split(/[，。！？；,!?\n]/)[0] || strippedForTitle).trim();
        const cleanTitle = firstClause
          ? firstClause.length > 14
            ? `${firstClause.slice(0, 14)}…`
            : firstClause
          : '新对话';
        db.prepare('UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?').run(
          cleanTitle,
          now,
          sessionId
        );
      } else {
        db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(now, sessionId);
      }
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      ...SECURITY_HEADERS
    });

    const sendEvent = (event, data) => {
      if (!res.writableEnded) {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      }
    };

    // 每 12 秒发送 SSE 注释心跳帧，防止 R1 深度思考期间被 Nginx / Cloudflare / 移动蜂窝网关空闲断流
    const keepAliveTimer = setInterval(() => {
      if (!res.writableEnded) {
        try {
          res.write(': keepalive\n\n');
        } catch {
          // ignore write error on closing socket
        }
      }
    }, 12000);

    const abortController = new AbortController();
    res.on('close', () => {
      clearInterval(keepAliveTimer);
      if (!res.writableEnded) {
        abortController.abort();
      }
    });

    const startedAt = Date.now();
    let fullReasoning = '';
    let fullContent = '';
    let contextBundle = null;
    let nativeMeta = null;

    try {
      let hasCustomOv = false;
      if (session.custom_persona_override) {
        try {
          const ov = JSON.parse(session.custom_persona_override);
          hasCustomOv = Boolean(ov && typeof ov === 'object' && Object.values(ov).some((v) => typeof v === 'string' && v.trim()));
        } catch {}
      }
      const personaObj = resolveEffectivePersona(session);
      const isPureOfficial = personaObj.id === 'persona_deepseek_official' && !hasCustomOv;

      let newlyExtracted = [];
      let nurturingRes = null;
      if (!isRegenerate) {
        if (session.enable_auto_memory === 1) {
          newlyExtracted = extractFactsFromUserTurn(sessionId, userContent);
          if (newlyExtracted.length > 0) {
            sendEvent('memory_extracted', { items: newlyExtracted });
          }
        }
        if (!isPureOfficial && !isNativeMode) {
          nurturingRes = evaluateTurnNurturing(sessionId, userContent);
          if (nurturingRes) {
            sendEvent('nurturing_updated', nurturingRes);
          }
        }
      }

      contextBundle = buildThreeTierContext({
        sessionId,
        expectedUserId: userId,
        latestUserText: userContent,
        settings,
        reinforceMemories: true
      });
      contextBundle.attachments = effectiveAttachments;

      // 若本轮包含上传附件，将附件内容结构化拼接到最后一条 user 消息载荷中供模型完整阅读并挂载多模态数据
      if (effectiveAttachments.length > 0 && contextBundle.messagesPayload.length > 0) {
        const lastIdx = contextBundle.messagesPayload.length - 1;
        if (contextBundle.messagesPayload[lastIdx].role === 'user') {
          contextBundle.messagesPayload[lastIdx].attachments = effectiveAttachments;
          const fileBlocks = effectiveAttachments
            .map((a) =>
              a.is_image
                ? `<image_attachment name="${a.name}" mime="${a.mime || 'image/png'}" dimensions="${
                    a.dimensions || 'unknown'
                  }">${a.content ? `\n${a.content}\n` : '（用户已上传真实图片附件，已接入视觉多模态底座）'}</image_attachment>`
                : `<attachment name="${a.name}">\n${a.content}\n</attachment>`
            )
            .join('\n\n');
          contextBundle.messagesPayload[lastIdx].content = `${fileBlocks}\n\n${contextBundle.messagesPayload[lastIdx].content}`;
        }
      }

      sendEvent('telemetry', {
        telemetry: contextBundle.telemetry,
        recalled_memories: contextBundle.recalledMemories,
        triggered_lorebooks: contextBundle.triggeredLorebooks,
        nurturing: contextBundle.nurturing,
        rolling_summary: contextBundle.rollingSummary,
        provider: settings.provider,
        session_mode: session.session_mode
      });

      if (usingLocalAntigravity) {
        const localTargetModel = body.local_model || session.local_model || 'gemini-3.8-flash-high';
        const enableThinking = isNativeMode
          ? (body.ds_thinking !== undefined ? Boolean(body.ds_thinking) : session.ds_thinking === 1)
          : true;

        nativeMeta = await streamViaLocalAntigravityCli({
          messagesPayload: contextBundle.messagesPayload,
          personaName: contextBundle.persona?.name || (isNativeMode ? 'DeepSeek' : '当前角色'),
          model: localTargetModel,
          enableThinking,
          SplitterClass: NativeThinkSplitter,
          onReasoning: (delta) => {
            fullReasoning += delta;
            sendEvent('reasoning', { delta });
          },
          onContent: (delta) => {
            fullContent += delta;
            sendEvent('content', { delta });
          },
          signal: abortController.signal
        });
      } else if (isNativeMode) {
        const enableThinking =
          body.ds_thinking !== undefined ? Boolean(body.ds_thinking) : session.ds_thinking === 1;
        const enableSearch =
          body.ds_search !== undefined ? Boolean(body.ds_search) : session.ds_search === 1;
        const jsonMode =
          body.ds_json_mode !== undefined ? Boolean(body.ds_json_mode) : session.ds_json_mode === 1;
        const enableTools =
          body.ds_tools_enabled !== undefined
            ? Boolean(body.ds_tools_enabled)
            : session.ds_tools_enabled === 1;

        nativeMeta = await streamDeepSeekNativeSuite({
          settings,
          messagesPayload: contextBundle.messagesPayload,
          userText: userContent,
          persona: contextBundle.persona,
          isPureOfficial,
          enableThinking,
          enableSearch,
          jsonMode,
          enableTools,
          assistantPrefix,
          attachments: effectiveAttachments,
          onSearchResults: (items) => {
            sendEvent('search_results', { items });
          },
          onToolCall: (toolLog) => {
            sendEvent('tool_call', toolLog);
          },
          onReasoning: (delta) => {
            fullReasoning += delta;
            sendEvent('reasoning', { delta });
          },
          onContent: (delta) => {
            fullContent += delta;
            sendEvent('content', { delta });
          },
          signal: abortController.signal
        });
      } else {
        const cleanRpPrefix = String(assistantPrefix || '').trim();
        if (cleanRpPrefix && contextBundle.messagesPayload.length > 0) {
          const lastMsgObj = contextBundle.messagesPayload[contextBundle.messagesPayload.length - 1];
          if (lastMsgObj.role === 'user') {
            lastMsgObj.content = `${lastMsgObj.content}\n\n[系统导演提示：请以「${cleanRpPrefix}」作为你正式回复正文的第一句开头，并自然连贯地往下继续演绎，不要重复输出两遍开头。]`;
          }
        }
        let rpPrefixInjected = false;
        const rpStreamMeta = await streamPersonaChat({
          settings,
          contextBundle,
          latestUserText: userContent,
          onReasoning: (delta) => {
            fullReasoning += delta;
            sendEvent('reasoning', { delta });
          },
          onContent: (delta) => {
            if (cleanRpPrefix && !rpPrefixInjected) {
              rpPrefixInjected = true;
              const trimmedLeading = String(delta || '').trimStart();
              if (!trimmedLeading.startsWith(cleanRpPrefix.slice(0, Math.min(4, cleanRpPrefix.length)))) {
                fullContent += cleanRpPrefix;
                sendEvent('content', { delta: cleanRpPrefix });
              }
            }
            fullContent += delta;
            sendEvent('content', { delta });
          },
          signal: abortController.signal
        });
        if (rpStreamMeta && (rpStreamMeta.usage || rpStreamMeta.model)) {
          nativeMeta = rpStreamMeta;
        }
      }

      const durationMs = Date.now() - startedAt;
      const wasAborted = Boolean(abortController.signal.aborted);
      const substantiveContent = fullContent.replace(/^[\s*＊…—\-()（）「」『』【】]+$/g, '').trim();

      if (wasAborted && !substantiveContent) {
        fullContent = '（⏹ 已暂停生成）';
      }

      let latestMembership = getMembership(userId);
      let billingInfo = null;
      if (substantiveContent) {
        db.prepare('UPDATE users SET total_used = total_used + 1, updated_at = ? WHERE id = ?').run(
          Date.now(),
          userId
        );
        latestMembership = getMembership(userId);
      }

      const recentForFollowUps = [
        ...(contextBundle.messagesPayload || []).filter((m) => m.role === 'user' || m.role === 'assistant').slice(-5),
        { role: 'assistant', content: fullContent }
      ];
      const followUps =
        wasAborted || !includeFollowUps || !substantiveContent
          ? []
          : await generateDynamicFollowUpsWithLLM({
              settings,
              sessionMode: session.session_mode || 'roleplay',
              isPureOfficial,
              persona: contextBundle.persona,
              nurturing: contextBundle.nurturing,
              userNickname: currentUser.nickname,
              recentMessages: recentForFollowUps,
              userText: userContent,
              assistantText: fullContent,
              nonce: Date.now(),
              timeoutMs: 3600
            });

      const now = Date.now();
      const fallbackReply = isNativeMode
        ? '*(生成已完成)*'
        : '*（对方温柔地注视着你，似乎在等待你的下一句话）*';
      const rawTrimmed = fullContent.trim();
      const balancedTrimmed =
        (rawTrimmed.match(/\*/g) || []).length % 2 === 1 ? `${rawTrimmed}*` : rawTrimmed;
      const finalAssistantContent =
        wasAborted && substantiveContent
          ? `${balancedTrimmed}\n\n（⏹ 已停止生成）`
          : substantiveContent
          ? rawTrimmed
          : wasAborted
          ? '（⏹ 已停止生成）'
          : fallbackReply;
      // 若恋庭角色开启了心声独白，而底层非推理在线模型省略了 <think> 标签，自动补齐贴合当前情境与人设的第一人称心声独白
      if (
        !isNativeMode &&
        !isPureOfficial &&
        session.enable_inner_thought === 1 &&
        !wasAborted &&
        substantiveContent &&
        !fullReasoning.trim()
      ) {
        const nickCall = (contextBundle.userNickname || currentUser.nickname || '你').replace(/^星语旅人·.*$/, '你');
        const callStr = nickCall === '星屿旅人' ? '眼前这个人' : `「${nickCall}」`;
        const moodLabel = contextBundle.nurturing?.current_mood || '温柔浅笑';
        const userBrief = String(userContent || '')
          .replace(/\*[^*]*\*/g, '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 22);
        const fallbackInnerThought = userBrief
          ? `听着${callStr}提起「${userBrief}」，心头不禁泛起一阵「${moodLabel}」的涟漪……嘴上虽然保持着平时的分寸，目光却忍不住一直落在${callStr}身上，想回应得更贴心一点。`
          : `看着眼前的${callStr}，此刻心底满是「${moodLabel}」的暖意，只想顺着这份默契好好陪在${callStr}身边。`;
        fullReasoning = fallbackInnerThought;
        sendEvent('reasoning', { delta: fallbackInnerThought });
      }
      const finalAssistantReasoning = fullReasoning.trim();

      const assistantMetaObj = {
        follow_ups: followUps,
        ...(wasAborted
          ? {
              interrupted: true,
              aborted_by_user: true,
              partial_recovered: Boolean(substantiveContent)
            }
          : {}),
        ...(nativeMeta
          ? {
              model: nativeMeta.model,
              simulated: nativeMeta.simulated,
              usage: nativeMeta.usage || null,
              search_results: nativeMeta.searchResults || [],
              tool_calls: nativeMeta.toolCallsLog || [],
              prefix_used: assistantPrefix || ''
            }
          : {})
      };

      if (priorAssistantVersions.length > 0) {
        const mergedVersions = [
          ...priorAssistantVersions,
          {
            reasoning: finalAssistantReasoning,
            content: finalAssistantContent,
            duration_ms: durationMs,
            search_results: assistantMetaObj.search_results || [],
            tool_calls: assistantMetaObj.tool_calls || [],
            usage: assistantMetaObj.usage || null,
            created_at: now
          }
        ];
        assistantMetaObj.versions = mergedVersions;
        assistantMetaObj.active_version = mergedVersions.length - 1;
      }

      const insertRes = db
        .prepare(`
          INSERT INTO messages (session_id, role, reasoning, content, meta_json, duration_ms, recalled_count, created_at)
          VALUES (?, 'assistant', ?, ?, ?, ?, ?, ?)
        `)
        .run(
          sessionId,
          finalAssistantReasoning,
          finalAssistantContent,
          JSON.stringify(assistantMetaObj),
          durationMs,
          contextBundle.recalledMemories.length,
          now
        );

      db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(now, sessionId);

      const allMemories = decorateMemoriesWithRetention(
        db
          .prepare('SELECT * FROM memories WHERE session_id = ? ORDER BY pinned DESC, importance DESC, updated_at DESC')
          .all(sessionId)
      );
      const latestSessionRow = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);

      sendEvent('done', {
        message_id: Number(insertRes.lastInsertRowid),
        duration_ms: durationMs,
        recalled_count: contextBundle.recalledMemories.length,
        meta: assistantMetaObj,
        memories: allMemories,
        nurturing: formatNurturingSnapshot(latestSessionRow),
        sessions: listSessionsForUser(userId),
        membership: latestMembership,
        billing: billingInfo
      });
    } catch (err) {
      // 稳定性兜底：若流传输中途发生网络闪断或客户端中断，自动抢救落库或写入明确中断标记以防丢字及孤立符号
      const isUserAbort = Boolean(abortController.signal.aborted);
      const rescuedSubstantive = fullContent.replace(/^[\s*＊…—\-()（）「」『』【】]+$/g, '').trim();
      if (rescuedSubstantive || fullReasoning.trim() || isUserAbort) {
        try {
          const now = Date.now();
          const durationMs = now - startedAt;
          const suffixNote = isUserAbort
            ? '\n\n（⏹ 已停止生成）'
            : '\n\n（注：网络连接出现短暂波动，以上已生成内容已自动为你妥善保存；如需完整重答可点击「重新生成」）';
          const trimmedPartial = fullContent.trim();
          const balancedPartial =
            (trimmedPartial.match(/\*/g) || []).length % 2 === 1 ? `${trimmedPartial}*` : trimmedPartial;
          const rescuedContent = rescuedSubstantive
            ? `${balancedPartial}${suffixNote}`
            : isUserAbort
            ? '（⏹ 已停止生成）'
            : '（思考已完成，正文传输时遇到网络波动，请点击「重新生成」重试）';
          const rescuedReasoning = fullReasoning.trim();
          const recalledLen = contextBundle?.recalledMemories?.length || 0;
          const rescuedMeta = {
            interrupted: true,
            partial_recovered: Boolean(rescuedSubstantive),
            aborted_by_user: isUserAbort,
            ...(priorAssistantVersions.length > 0
              ? {
                  versions: [
                    ...priorAssistantVersions,
                    {
                      reasoning: rescuedReasoning,
                      content: rescuedContent,
                      duration_ms: durationMs,
                      created_at: now
                    }
                  ],
                  active_version: priorAssistantVersions.length
                }
              : {})
          };

          const insertRes = db
            .prepare(`
              INSERT INTO messages (session_id, role, reasoning, content, meta_json, duration_ms, recalled_count, created_at)
              VALUES (?, 'assistant', ?, ?, ?, ?, ?, ?)
            `)
            .run(
              sessionId,
              rescuedReasoning,
              rescuedContent,
              JSON.stringify(rescuedMeta),
              durationMs,
              recalledLen,
              now
            );
          db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(now, sessionId);

          if (!isUserAbort) {
            sendEvent('content', { delta: suffixNote });
          }
          const allMemories = decorateMemoriesWithRetention(
            db
              .prepare('SELECT * FROM memories WHERE session_id = ? ORDER BY pinned DESC, importance DESC, updated_at DESC')
              .all(sessionId)
          );
          const latestSessionRow = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
          sendEvent('done', {
            message_id: Number(insertRes.lastInsertRowid),
            duration_ms: durationMs,
            recalled_count: recalledLen,
            meta: rescuedMeta,
            memories: allMemories,
            nurturing: formatNurturingSnapshot(latestSessionRow),
            sessions: listSessionsForUser(userId),
            membership: getMembership(userId),
            recovered: true
          });
        } catch {
          sendEvent('error', { message: sanitizePublicErrorMessage(err, '生成回复时发生未知异常') });
        }
      } else {
        sendEvent('error', { message: sanitizePublicErrorMessage(err, '生成回复时发生未知异常') });
      }
    } finally {
      clearInterval(keepAliveTimer);
      if (!res.writableEnded) {
        res.end();
      }
    }
    return;
  }

  // ========= 10. 角色 / AI 主动发起关怀与破冰流式端点（仅手动触发或用户显式开启时运行） =========
  if (method === 'POST' && pathname === '/api/chat/proactive') {
    const body = await readJsonBody(req);
    const sessionId = body.session_id;
    const triggerReason = body.trigger_reason || 'manual'; // 'idle' | 'return' | 'manual'

    const session = db
      .prepare('SELECT * FROM sessions WHERE id = ? AND user_id = ?')
      .get(sessionId, userId);
    if (!session) return sendJson(res, 404, { error: '会话不存在' });
    if (session.session_mode === 'deepseek_native') {
      return sendJson(res, 400, { error: '极简问答模式不启用自动插话，以保障上下文纯粹与稳定' });
    }
    if (triggerReason !== 'manual' && Number(session.proactive_enabled) !== 1) {
      return sendJson(res, 200, { ok: true, skipped: true, reason: 'proactive_disabled' });
    }
    if (triggerReason !== 'manual') {
      if (!global.__proactiveCooldownMap) global.__proactiveCooldownMap = new Map();
      const lastProactiveTs = global.__proactiveCooldownMap.get(sessionId) || 0;
      if (Date.now() - lastProactiveTs < 300 * 1000) {
        return sendJson(res, 200, { ok: true, skipped: true, reason: 'cooldown' });
      }
      global.__proactiveCooldownMap.set(sessionId, Date.now());
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      ...SECURITY_HEADERS
    });

    const sendEvent = (event, data) => {
      if (!res.writableEnded) {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      }
    };

    const abortController = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) {
        abortController.abort();
      }
    });

    try {
      const safePrefs = getSafeClientSettings(userId);
      const usingOwnKeyPref = safePrefs.provider === 'own_deepseek' && safePrefs.has_own_deepseek_key;
      const proactiveAccess =
        safePrefs.provider === 'online'
          ? verifyOnlineChatAccess(userId)
          : { allowed: usingOwnKeyPref };
      const allowCloudProactive = Boolean(usingOwnKeyPref || proactiveAccess.allowed);
      const settings = getExecutionSettingsForUser(userId, { forceDemoLlm: !allowCloudProactive });
      const cred = getEffectiveApiCredentials(settings);
      const contextBundle = buildThreeTierContext({
        sessionId,
        expectedUserId: userId,
        latestUserText: '',
        settings,
        reinforceMemories: false
      });

      const isNativeMode = session.session_mode === 'deepseek_native';
      const isPureOfficial = contextBundle.persona.id === 'persona_deepseek_official';
      const lastUserRow = db
        .prepare("SELECT content FROM messages WHERE session_id = ? AND role = 'user' ORDER BY id DESC LIMIT 1")
        .get(sessionId);
      const lastAstRow = db
        .prepare("SELECT content FROM messages WHERE session_id = ? AND role = 'assistant' ORDER BY id DESC LIMIT 1")
        .get(sessionId);

      const startedAt = Date.now();
      let fullReasoning = '';
      let fullContent = '';
      let usageMeta = null;

      if (cred.hasKey) {
        // 使用真实大模型 API 流式生成自然主动搭话（临时追加场景触发指令，不污染用户消息表）
        const triggerInstruction = buildProactiveTriggerInstruction({
          sessionMode: session.session_mode || 'roleplay',
          isPureOfficial,
          persona: contextBundle.persona,
          userNickname: currentUser.nickname,
          nurturing: contextBundle.nurturing,
          recalledMemories: contextBundle.recalledMemories,
          lastAssistantText: lastAstRow?.content || '',
          triggerReason
        });

        const proactiveMessages = [
          ...contextBundle.messagesPayload,
          { role: 'user', content: triggerInstruction }
        ];

        const resSuite = await streamDeepSeekNativeSuite({
          settings,
          messagesPayload: proactiveMessages,
          userText: '',
          persona: contextBundle.persona,
          isPureOfficial,
          enableThinking: isNativeMode ? session.ds_thinking === 1 : session.enable_inner_thought === 1,
          enableSearch: false,
          jsonMode: false,
          enableTools: false,
          onReasoning: (delta) => {
            fullReasoning += delta;
            sendEvent('reasoning', { delta });
          },
          onContent: (delta) => {
            fullContent += delta;
            sendEvent('content', { delta });
          },
          signal: abortController.signal
        });
        usageMeta = resSuite?.usage || null;
      } else {
        // 免费体验通道：流式输出高细腻度动态主动关怀心声与消息
        const demoTurn = generateDemoProactiveTurn({
          sessionMode: session.session_mode || 'roleplay',
          isPureOfficial,
          persona: contextBundle.persona,
          userNickname: currentUser.nickname,
          nurturing: contextBundle.nurturing,
          recalledMemories: contextBundle.recalledMemories,
          lastUserText: lastUserRow?.content || '',
          lastAssistantText: lastAstRow?.content || '',
          triggerReason
        });

        const showReason = isNativeMode ? session.ds_thinking === 1 : session.enable_inner_thought === 1;
        if (showReason && demoTurn.reasoning) {
          const rChars = Array.from(demoTurn.reasoning);
          for (let i = 0; i < rChars.length; i += 3) {
            if (abortController.signal.aborted) break;
            const d = rChars.slice(i, i + 3).join('');
            fullReasoning += d;
            sendEvent('reasoning', { delta: d });
            await new Promise((r) => setTimeout(r, 15));
          }
        }

        const cChars = Array.from(demoTurn.content);
        for (let i = 0; i < cChars.length; i += 3) {
          if (abortController.signal.aborted) break;
          const d = cChars.slice(i, i + 3).join('');
          fullContent += d;
          sendEvent('content', { delta: d });
          await new Promise((r) => setTimeout(r, 14));
        }
      }

      const wasProactiveAborted = Boolean(abortController.signal.aborted);
      const substantiveProactive = fullContent.replace(/^[\s*＊…—\-()（）「」『』【】]+$/g, '').trim();
      if (!substantiveProactive) {
        res.end();
        return;
      }

      const rawProactiveTrimmed = fullContent.trim();
      const balancedProactive =
        (rawProactiveTrimmed.match(/\*/g) || []).length % 2 === 1
          ? `${rawProactiveTrimmed}*`
          : rawProactiveTrimmed;
      const finalProactiveContent = wasProactiveAborted
        ? `${balancedProactive}\n\n（⏹ 已暂停生成）`
        : balancedProactive;

      const durationMs = Date.now() - startedAt;
      const includeFollowUps = body.include_follow_ups !== false;
      const followUps =
        wasProactiveAborted || !includeFollowUps
          ? []
          : await generateDynamicFollowUpsWithLLM({
              settings,
              sessionMode: session.session_mode || 'roleplay',
              isPureOfficial,
              persona: contextBundle.persona,
              nurturing: contextBundle.nurturing,
              userNickname: currentUser.nickname,
              recentMessages: [
                ...(contextBundle.messagesPayload || []).filter((m) => m.role === 'user' || m.role === 'assistant').slice(-4),
                { role: 'assistant', content: finalProactiveContent }
              ],
              userText: lastUserRow?.content || '',
              assistantText: finalProactiveContent,
              nonce: Date.now(),
              timeoutMs: 3600
            });

      const metaObj = {
        is_proactive: true,
        trigger_reason: triggerReason,
        follow_ups: followUps,
        usage: usageMeta,
        ...(wasProactiveAborted ? { interrupted: true, partial_recovered: true } : {})
      };

      const now = Date.now();
      const insertRes = db
        .prepare(`
          INSERT INTO messages (session_id, role, reasoning, content, meta_json, duration_ms, recalled_count, created_at)
          VALUES (?, 'assistant', ?, ?, ?, ?, ?, ?)
        `)
        .run(
          sessionId,
          fullReasoning.trim(),
          finalProactiveContent,
          JSON.stringify(metaObj),
          durationMs,
          contextBundle.recalledMemories.length,
          now
        );

      db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(now, sessionId);

      sendEvent('done', {
        message_id: Number(insertRes.lastInsertRowid),
        duration_ms: durationMs,
        recalled_count: contextBundle.recalledMemories.length,
        meta: metaObj,
        sessions: listSessionsForUser(userId)
      });
    } catch (err) {
      sendEvent('error', { message: sanitizePublicErrorMessage(err, '主动关怀触发异常') });
    } finally {
      if (!res.writableEnded) {
        res.end();
      }
    }
    return;
  }

  return sendJson(res, 404, { error: '未找到请求的 API 路径' });
}

const STATIC_MEM_CACHE = new Map();
const MAX_STATIC_MEM_CACHE_ENTRIES = 64;
const MAX_STATIC_MEM_CACHE_BYTES = 1024 * 1024;

function getStaticMemCache(key, mtimeStamp) {
  const entry = STATIC_MEM_CACHE.get(key);
  if (!entry) return null;
  if (entry.mtimeStamp !== mtimeStamp) {
    STATIC_MEM_CACHE.delete(key);
    return null;
  }
  STATIC_MEM_CACHE.delete(key);
  STATIC_MEM_CACHE.set(key, entry);
  return entry.buf;
}

function setStaticMemCache(key, mtimeStamp, buf) {
  if (!buf || buf.length > MAX_STATIC_MEM_CACHE_BYTES) return;
  if (STATIC_MEM_CACHE.has(key)) {
    STATIC_MEM_CACHE.delete(key);
  } else if (STATIC_MEM_CACHE.size >= MAX_STATIC_MEM_CACHE_ENTRIES) {
    const oldestKey = STATIC_MEM_CACHE.keys().next().value;
    if (oldestKey !== undefined) STATIC_MEM_CACHE.delete(oldestKey);
  }
  STATIC_MEM_CACHE.set(key, { mtimeStamp, buf });
}

function serveStatic(req, res, pathname) {
  let decodedPath = '/';
  try {
    decodedPath = decodeURIComponent(pathname || '/');
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS });
    res.end('非法的请求路径');
    return;
  }
  if (decodedPath.includes('\0')) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS });
    res.end('非法的请求路径');
    return;
  }

  const safePath = decodedPath === '/' ? 'index.html' : decodedPath.replace(/^[/\\]+/, '');

  // 严格安全限制：禁止未登录用户直接静态下载 APK 文件
  if (safePath.endsWith('.apk') || safePath.startsWith('downloads/')) {
    const token = extractAuthToken(req);
    const user = getUserByToken(token);
    if (!user) {
      res.writeHead(302, {
        Location: '/?auth=login&msg=download_login_required',
        ...SECURITY_HEADERS
      });
      res.end();
      return;
    }
  }

  const resolvedPath = path.resolve(PUBLIC_DIR, safePath);
  const rel = path.relative(PUBLIC_DIR, resolvedPath);

  if (
    rel.startsWith('..') ||
    path.isAbsolute(rel) ||
    rel.split(path.sep).some((seg) => seg.startsWith('.'))
  ) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS });
    res.end('禁止访问');
    return;
  }

  fs.stat(resolvedPath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS });
      res.end('页面未找到');
      return;
    }

    const ext = path.extname(resolvedPath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const isHtml = ext === '.html';
    const isSw = safePath === 'sw.js';
    const hasVersionParam = /[?&]v=[^&]+/.test(req.url || '');

    let cacheHeader = hasVersionParam
      ? 'public, max-age=31536000, immutable'
      : 'public, max-age=2592000, stale-while-revalidate=86400';
    if (isHtml) {
      cacheHeader = 'no-cache, must-revalidate';
    } else if (isSw) {
      cacheHeader = 'no-cache, no-store, must-revalidate';
    }

    const etag = `"${stats.size.toString(16)}-${Math.floor(stats.mtimeMs).toString(16)}"`;
    const fileMtimeSec = Math.floor(stats.mtimeMs / 1000) * 1000;
    const lastModified = new Date(fileMtimeSec).toUTCString();

    const ifNoneMatch = String(req.headers['if-none-match'] || '').trim();
    const ifModifiedSince = String(req.headers['if-modified-since'] || '').trim();
    const etagCore = etag.replace(/^W\//, '');
    const etagMatched = Boolean(
      ifNoneMatch &&
      ifNoneMatch.split(',').some((tag) => {
        const t = tag.trim();
        return t === '*' || t === etag || t.replace(/^W\//, '') === etagCore;
      })
    );
    const imsTime = ifModifiedSince ? Date.parse(ifModifiedSince) : NaN;
    const imsMatched = !Number.isNaN(imsTime) && imsTime >= fileMtimeSec;

    if (etagMatched || imsMatched) {
      res.writeHead(304, {
        'ETag': etag,
        'Last-Modified': lastModified,
        'Cache-Control': cacheHeader,
        ...SECURITY_HEADERS
      });
      res.end();
      return;
    }

    const isHead = req.method === 'HEAD';
    const acceptEncoding = String(req.headers['accept-encoding'] || '');
    const compressible = /^(text\/|application\/(javascript|json)|image\/svg\+xml)/.test(contentType) && stats.size > 512;
    const acceptsBr = compressible && /\bbr\b/i.test(acceptEncoding);
    const acceptsGzip = compressible && /\bgzip\b/i.test(acceptEncoding);

    const headers = {
      'Content-Type': contentType,
      'Cache-Control': cacheHeader,
      'ETag': etag,
      'Last-Modified': lastModified,
      'Vary': 'Accept-Encoding',
      ...SECURITY_HEADERS
    };

    const sendEncodedBufferOrFile = (encoding, filePathToRead, fileSize) => {
      if (encoding) headers['Content-Encoding'] = encoding;
      const cacheKey = `${resolvedPath}|${encoding || 'raw'}`;
      const stamp = `${stats.mtimeMs}:${fileSize}`;
      const cachedBuf = getStaticMemCache(cacheKey, stamp);
      if (cachedBuf) {
        headers['Content-Length'] = cachedBuf.length;
        res.writeHead(200, headers);
        res.end(isHead ? undefined : cachedBuf);
        return;
      }
      headers['Content-Length'] = fileSize;
      res.writeHead(200, headers);
      if (isHead) {
        res.end();
        return;
      }
      if (fileSize <= MAX_STATIC_MEM_CACHE_BYTES) {
        fs.readFile(filePathToRead, (readErr, buf) => {
          if (readErr) {
            if (!res.writableEnded) res.end();
            return;
          }
          setStaticMemCache(cacheKey, stamp, buf);
          res.end(buf);
        });
        return;
      }
      const stream = fs.createReadStream(filePathToRead);
      stream.on('error', () => {
        if (!res.writableEnded) res.end();
      });
      stream.pipe(res);
    };

    const tryGzipOrRaw = () => {
      if (acceptsGzip) {
        const precompressedGzPath = `${resolvedPath}.gz`;
        fs.stat(precompressedGzPath, (gzErr, gzStats) => {
          if (!gzErr && gzStats.isFile() && gzStats.mtimeMs + 2000 >= stats.mtimeMs) {
            sendEncodedBufferOrFile('gzip', precompressedGzPath, gzStats.size);
            return;
          }
          headers['Content-Encoding'] = 'gzip';
          res.writeHead(200, headers);
          if (isHead) {
            res.end();
            return;
          }
          const rawStream = fs.createReadStream(resolvedPath);
          const gzipStream = zlib.createGzip({ level: 6 });
          rawStream.on('error', () => { if (!res.writableEnded) res.end(); });
          gzipStream.on('error', () => { if (!res.writableEnded) res.end(); });
          rawStream.pipe(gzipStream).pipe(res);
        });
        return;
      }
      sendEncodedBufferOrFile('', resolvedPath, stats.size);
    };

    if (acceptsBr) {
      const precompressedBrPath = `${resolvedPath}.br`;
      fs.stat(precompressedBrPath, (brErr, brStats) => {
        if (!brErr && brStats.isFile() && brStats.mtimeMs + 2000 >= stats.mtimeMs) {
          sendEncodedBufferOrFile('br', precompressedBrPath, brStats.size);
          return;
        }
        tryGzipOrRaw();
      });
    } else {
      tryGzipOrRaw();
    }
  });
}

const server = http.createServer(async (req, res) => {
  res._acceptEncoding = String(req.headers['accept-encoding'] || '');
  res._reqMethod = req.method || 'GET';
  try {
    const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = parsedUrl.pathname;

    if (pathname.startsWith('/api/')) {
      await handleApi(req, res, pathname, parsedUrl);
    } else {
      serveStatic(req, res, pathname);
    }
  } catch (err) {
    if (!res.headersSent) {
      const code = err?.statusCode && err.statusCode >= 400 && err.statusCode < 500 ? err.statusCode : 500;
      const msg =
        code === 500
          ? '服务器繁忙，请稍后重试'
          : sanitizePublicErrorMessage(err, '请求格式有误');
      sendJson(res, code, { error: msg });
    } else if (!res.writableEnded) {
      res.end();
    }
  }
});

server.on('clientError', (err, socket) => {
  if (err.code === 'ECONNRESET' || !socket.writable) return;
  socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
});

process.on('uncaughtException', (err) => {
  console.error('[ServerGuard] 捕获未处理异常:', err?.message || err);
});

process.on('unhandledRejection', (reason) => {
  console.error('[ServerGuard] 捕获未处理 Promise 拒绝:', reason?.message || reason);
});

const HOST = process.env.HOST || '127.0.0.1';
server.listen(PORT, HOST, () => {
  console.log(`[StarWhisperStudio] 星语恋庭（含多账号登录与新手向导）已启动: http://${HOST}:${PORT}`);
  warmupTtsEngine();
});

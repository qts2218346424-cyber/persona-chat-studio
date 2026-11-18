const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
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
  updateAdminCredentials
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
const { parsePersonaDocument, parseChatHistoryDocument } = require('./docImporter');
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
  getEffectiveApiCredentials,
  fetchDeepSeekBalance,
  fetchDeepSeekModels,
  streamDeepSeekNativeSuite,
  runDeepSeekFimCompletion
} = require('./deepseekApiSuite');
const {
  buildProactiveTriggerInstruction,
  generateDemoProactiveTurn,
  generateFollowUpSuggestions
} = require('./proactiveEngine');
const { analyzeAndOptimizeScript } = require('./scriptWorkshop');

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
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...SECURITY_HEADERS,
    ...extraHeaders
  });
  res.end(body);
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
  return db
    .prepare(`
      SELECT s.*, p.name AS persona_name, p.avatar AS persona_avatar, p.script_id AS script_id,
             (SELECT COUNT(*) FROM messages m WHERE m.session_id = s.id) AS message_count,
             (SELECT COUNT(*) FROM memories mem WHERE mem.session_id = s.id) AS memory_count
      FROM sessions s
      LEFT JOIN personas p ON p.id = s.persona_id
      WHERE s.user_id = ?
      ORDER BY COALESCE(s.pinned, 0) DESC, s.updated_at DESC
    `)
    .all(userId);
}

function extractAuthToken(req) {
  const authHeader = String(req.headers.authorization || '').trim();
  if (/^Bearer\s+/i.test(authHeader)) {
    const bearerToken = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (bearerToken) return bearerToken;
  }
  const cookies = parseCookies(req);
  return cookies[COOKIE_NAME] || '';
}

async function handleApi(req, res, pathname, parsedUrl) {
  const method = req.method || 'GET';
  const currentToken = extractAuthToken(req);
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
    } catch {
      return sendJson(res, 401, { error: '邮箱账号或密码不正确，请检查后重试' });
    }
  }

  if (method === 'POST' && pathname === '/api/auth/demo-login') {
    const ip = getClientIp(req);
    if (!checkRateLimit(`guest:${ip}`, 15, 60000)) {
      return sendJson(res, 429, { error: '访客创建过于频繁，请稍后再试' });
    }
    const body = await readJsonBody(req, 16 * 1024);
    const { user, token, is_new_guest } = loginDemoAccount(body.guest_user_id || '');
    return sendJson(res, 200, { user, token, is_new_guest }, { 'Set-Cookie': buildAuthCookie(token) });
  }

  if (method === 'POST' && pathname === '/api/auth/logout') {
    if (currentToken) revokeAuthToken(currentToken);
    return sendJson(res, 200, { ok: true }, { 'Set-Cookie': buildClearCookie() });
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

  if (method === 'POST' && pathname === '/api/auth/onboarding') {
    const body = await readJsonBody(req);
    const updatedUser = markUserOnboardingDone(userId, Boolean(body.done));
    return sendJson(res, 200, { user: updatedUser });
  }

  if (method === 'PUT' && pathname === '/api/auth/user-persona') {
    const body = await readJsonBody(req);
    const updatedUser = updateUserPersona(userId, body);
    // 同步更新该用户名下所有会话的昵称记忆槽位
    if (updatedUser.nickname) {
      db.prepare(`
        UPDATE memories
        SET content = ?, updated_at = ?
        WHERE slot_key = 'user_nickname' AND session_id IN (SELECT id FROM sessions WHERE user_id = ?)
      `).run(
        `对话者身份称呼：对方希望被称呼为「${updatedUser.nickname}」（对方自称「${updatedUser.nickname}」）。`,
        Date.now(),
        userId
      );
    }
    return sendJson(res, 200, { user: updatedUser });
  }

  // ========= 2. 首屏初始化聚合接口（严格脱敏，绝不向前端暴露任何网关地址或密钥） =========
  if (method === 'GET' && pathname === '/api/bootstrap') {
    const wallet = getWalletOverview(userId);
    return sendJson(res, 200, {
      user: currentUser,
      scripts: listScriptsForUser(userId),
      square_items: listCommunityShares({ userId }),
      personas: listPersonasForUser(userId),
      sessions: listSessionsForUser(userId),
      settings: getSafeClientSettings(userId),
      membership: wallet.membership,
      wallet
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
    if (isFreeExperienceMode()) {
      return sendJson(res, 400, {
        error: '🎉 当前全站已开启「全免费畅玩模式」，所有角色扮演、DeepSeek 原生对话与个人 API 接入均免费开放，无需任何充值付费！'
      });
    }
    const body = await readJsonBody(req);
    try {
      const resOrder = createAndFulfillRechargeOrder(
        userId,
        body.product_key || body.plan,
        body.pay_channel || 'wechat'
      );
      return sendJson(res, 200, {
        ...resOrder,
        settings: getSafeClientSettings(userId),
        wallet: getWalletOverview(userId)
      });
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
  }

  if (method === 'GET' && pathname === '/api/membership') {
    return sendJson(res, 200, { membership: getMembership(userId) });
  }

  if (method === 'POST' && pathname === '/api/membership/subscribe') {
    if (isFreeExperienceMode()) {
      return sendJson(res, 400, {
        error: '🎉 当前全站已开启「全免费畅玩模式」，所有会员权益与个人 API 接入均免费开放，无需充值付费！'
      });
    }
    const body = await readJsonBody(req);
    try {
      const resOrder = createAndFulfillRechargeOrder(
        userId,
        body.plan,
        body.pay_channel || 'wechat'
      );
      return sendJson(res, 200, {
        membership: resOrder.membership,
        order: resOrder.order,
        settings: getSafeClientSettings(userId),
        wallet: getWalletOverview(userId)
      });
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
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

    db.prepare(`
      INSERT INTO personas (
        id, user_id, script_id, name, avatar, tagline, personality, backstory, speaking_style, greeting, starter_prompts, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      userId,
      String(body.script_id || 'script_clannad').trim(),
      name,
      (body.avatar || '🌸').trim(),
      (body.tagline || '').trim(),
      (body.personality || '').trim(),
      (body.backstory || '').trim(),
      (body.speaking_style || '').trim(),
      (body.greeting || '').trim(),
      JSON.stringify(prompts),
      now,
      now
    );

    const created = formatPersonaRow(db.prepare('SELECT * FROM personas WHERE id = ?').get(id));
    return sendJson(res, 201, { persona: created });
  }

  const personaMatch = pathname.match(/^\/api\/personas\/([^/]+)$/);
  if (personaMatch) {
    const personaId = decodeURIComponent(personaMatch[1]);
    const existing = db
      .prepare("SELECT * FROM personas WHERE id = ? AND (user_id = ? OR user_id = 'system')")
      .get(personaId, userId);
    if (!existing) return sendJson(res, 404, { error: '未找到该角色人设' });

    if (method === 'PUT') {
      const body = await readJsonBody(req);
      const now = Date.now();

      // 若编辑的是公共预设角色且传入了 session_id，则作为该用户当前会话的专属设定覆盖，避免影响其他用户
      if (existing.user_id === 'system' && body.session_id) {
        const overrideData = {
          avatar: (body.avatar ?? existing.avatar).trim() || '🌸',
          name: (body.name ?? existing.name).trim() || existing.name,
          tagline: (body.tagline ?? existing.tagline).trim(),
          personality: (body.personality ?? existing.personality).trim(),
          backstory: (body.backstory ?? existing.backstory).trim(),
          speaking_style: (body.speaking_style ?? existing.speaking_style).trim()
        };
        db.prepare(`
          UPDATE sessions SET custom_persona_override = ?, updated_at = ?
          WHERE id = ? AND user_id = ?
        `).run(JSON.stringify(overrideData), now, body.session_id, userId);

        return sendJson(res, 200, {
          persona: formatPersonaRow({ ...existing, ...overrideData })
        });
      }

      if (existing.user_id !== userId && existing.user_id !== 'system') {
        return sendJson(res, 403, { error: '无权修改他人创建的角色卡' });
      }

      const prompts = Array.isArray(body.starter_prompts)
        ? JSON.stringify(body.starter_prompts.filter((s) => s && s.trim()))
        : existing.starter_prompts;

      db.prepare(`
        UPDATE personas
        SET name = ?, avatar = ?, tagline = ?, personality = ?, backstory = ?, speaking_style = ?, greeting = ?, starter_prompts = ?, updated_at = ?
        WHERE id = ?
      `).run(
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

      const updated = formatPersonaRow(db.prepare('SELECT * FROM personas WHERE id = ?').get(personaId));
      return sendJson(res, 200, { persona: updated });
    }

    if (method === 'DELETE') {
      if (existing.user_id === 'system') {
        return sendJson(res, 400, { error: '官方基础角色卡不可删除' });
      }
      db.prepare('DELETE FROM personas WHERE id = ? AND user_id = ?').run(personaId, userId);
      return sendJson(res, 200, { ok: true });
    }
  }

  // ========= 6. 会话创建、导入历史记录与导出 =========
  if (method === 'POST' && pathname === '/api/sessions') {
    const body = await readJsonBody(req);
    const sessionMode = body.session_mode === 'deepseek_native' ? 'deepseek_native' : 'roleplay';
    const personaId =
      body.persona_id ||
      (sessionMode === 'deepseek_native' ? 'persona_deepseek_official' : 'persona_shenxinghui');

    const persona = db
      .prepare(
        "SELECT * FROM personas WHERE id = ? AND (user_id = ? OR user_id = 'system' OR user_id = 'system_ds')"
      )
      .get(personaId, userId);
    if (!persona) return sendJson(res, 404, { error: '所选人设或模型锚点不存在' });

    const now = Date.now();
    const sessionId = genId('sess');
    const shortPersonaName = persona.name.split(/[·\s]/)[0] || persona.name;
    const isPureOfficial = persona.id === 'persona_deepseek_official';
    const defaultTitle =
      sessionMode === 'deepseek_native'
        ? isPureOfficial
          ? '新对话'
          : `原生对话 · ${shortPersonaName}`
        : `与${shortPersonaName}的心动篇章`;
    const title = (body.title || defaultTitle).trim();
    const dsThinking = body.ds_thinking !== undefined ? (body.ds_thinking ? 1 : 0) : 1;
    const dsSearch = body.ds_search !== undefined ? (body.ds_search ? 1 : 0) : 0;

    db.prepare(`
      INSERT INTO sessions (
        id, user_id, persona_id, title, session_mode, ds_thinking, ds_search, ds_json_mode, ds_tools_enabled, proactive_enabled,
        rolling_summary, summarized_until_msg_id, enable_inner_thought, enable_auto_memory, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1, 1, '', 0, 1, 1, ?, ?)
    `).run(sessionId, userId, personaId, title, sessionMode, dsThinking, dsSearch, now, now);

    // 原生 DeepSeek 模式保持官方 App 纯净新对话欢迎态；仅在恋庭沉浸模式注入初遇开场白
    if (sessionMode !== 'deepseek_native' && persona.greeting && persona.greeting.trim()) {
      const renderedGreeting = replaceRoleplayMacros(
        persona.greeting.trim(),
        currentUser.nickname,
        persona.name
      );
      db.prepare(`
        INSERT INTO messages (session_id, role, reasoning, content, duration_ms, recalled_count, created_at)
        VALUES (?, 'assistant', ?, ?, 350, 1, ?)
      `).run(
        sessionId,
        `已载入「${persona.name}」的性格羁绊与世界观设定，静候「${currentUser.nickname}」的第一句回应。`,
        renderedGreeting,
        now
      );
    }

    const insertMem = db.prepare(`
      INSERT INTO memories (id, session_id, category, content, pinned, importance, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    if (!isPureOfficial && (persona.tagline || persona.backstory)) {
      const anchorSummary = (persona.tagline || persona.backstory.slice(0, 60)).trim();
      insertMem.run(genId('mem'), sessionId, 'Pinned', `初始世界观锚点：${anchorSummary}`, 1, 5, now, now);
    }

    if (!isPureOfficial && currentUser.nickname && currentUser.nickname !== '星语旅人') {
      insertMem.run(
        genId('mem'),
        sessionId,
        'relation',
        `对话者身份称呼：对方自称「${currentUser.nickname}」。`,
        1,
        5,
        now,
        now
      );
    }

    return sendJson(res, 201, { session_id: sessionId, sessions: listSessionsForUser(userId) });
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
        body.filename || 'history.txt',
        body.content || '',
        persona.name
      );

      if (body.mode === 'replace') {
        db.prepare('DELETE FROM messages WHERE session_id = ?').run(sessionId);
        db.prepare("UPDATE sessions SET rolling_summary = '', summarized_until_msg_id = 0 WHERE id = ?").run(
          sessionId
        );
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

      if (Array.isArray(parsed.imported_memories) && parsed.imported_memories.length > 0) {
        const insertMem = db.prepare(`
          INSERT OR IGNORE INTO memories (id, session_id, category, content, pinned, importance, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const mem of parsed.imported_memories) {
          if (mem && mem.content) {
            insertMem.run(
              genId('mem'),
              sessionId,
              mem.category || 'fact',
              String(mem.content).trim(),
              mem.pinned ? 1 : 0,
              mem.importance || 4,
              now,
              now
            );
          }
        }
      }

      if (parsed.imported_summary) {
        db.prepare('UPDATE sessions SET rolling_summary = ?, updated_at = ? WHERE id = ?').run(
          parsed.imported_summary,
          now,
          sessionId
        );
      } else {
        const settings = getSafeClientSettings(userId);
        compressOverflowHistorySync(sessionId, parseInt(settings.sliding_window_turns || '12', 10));
      }

      db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(Date.now(), sessionId);

      return sendJson(res, 200, {
        imported_count: parsed.messages.length,
        extracted_memories: extractedCount,
        sessions: listSessionsForUser(userId)
      });
    } catch (err) {
      return sendJson(res, 400, { error: err.message || '历史对话导入失败' });
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
      .prepare('SELECT category, content, pinned, importance FROM memories WHERE session_id = ?')
      .all(sessionId);

    return sendJson(res, 200, {
      title: session.title,
      persona_name: persona.name,
      rolling_summary: session.rolling_summary,
      exported_at: new Date().toISOString(),
      memories,
      messages
    });
  }

  const sessionCompressMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/compress$/);
  if (sessionCompressMatch && method === 'POST') {
    const sessionId = decodeURIComponent(sessionCompressMatch[1]);
    const session = db
      .prepare('SELECT * FROM sessions WHERE id = ? AND user_id = ?')
      .get(sessionId, userId);
    if (!session) return sendJson(res, 404, { error: '会话不存在' });

    const summary = compressOverflowHistorySync(sessionId, 4);
    const updatedSession = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
    return sendJson(res, 200, { rolling_summary: summary, session: updatedSession });
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
    const safePrefs = getSafeClientSettings(userId);
    const usingOwnKeyPref = safePrefs.provider === 'own_deepseek' && safePrefs.has_own_deepseek_key;
    const voiceOnlineCheck =
      safePrefs.provider === 'online'
        ? verifyOnlineChatAccess(userId)
        : { allowed: usingOwnKeyPref };
    const allowCloudVoiceLlm = Boolean(usingOwnKeyPref || voiceOnlineCheck.allowed);
    const settings = getExecutionSettingsForUser(userId, { forceDemoLlm: !allowCloudVoiceLlm });
    const cred = getEffectiveApiCredentials(settings);
    recordUserDailyEvent(userId, 'companion_interacted');

    // 仅在站长或有效日卡/月卡畅聊期内调用平台云端 API 生成实时耳畔口语，杜绝未授权白嫖
    const chatEndpoint = cred.endpoints?.chatUrl || cred.baseUrl;
    if (allowCloudVoiceLlm && cred.hasKey && cred.apiKey && chatEndpoint) {
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
            model: cred.preferredModel || cred.chatModel || 'deepseek-chat',
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
      const persona = formatPersonaRow(resolveEffectivePersona(session));
      const messages = db
        .prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY id ASC')
        .all(sessionId);
      const rawMemories = db
        .prepare('SELECT * FROM memories WHERE session_id = ? ORDER BY pinned DESC, importance DESC, updated_at DESC')
        .all(sessionId);
      const lorebooks = db
        .prepare("SELECT * FROM lorebook_entries WHERE persona_id = ? AND (user_id = 'system' OR user_id = ?) ORDER BY created_at DESC")
        .all(session.persona_id, userId);
      const settings = getSafeClientSettings(userId);
      const ctx = buildThreeTierContext({
        sessionId,
        expectedUserId: userId,
        latestUserText: '',
        settings,
        reinforceMemories: false
      });

      let savedComp = null;
      try {
        if (session.companion_config) savedComp = JSON.parse(session.companion_config);
      } catch {}
      const companion = resolveOrGenerateCompanion({ persona, currentConfig: savedComp });

      return sendJson(res, 200, {
        session,
        persona,
        messages,
        memories: decorateMemoriesWithRetention(rawMemories),
        lorebooks,
        nurturing: formatNurturingSnapshot(session),
        companion,
        telemetry: ctx.telemetry,
        membership: getMembership(userId)
      });
    }

    if (method === 'PATCH') {
      const body = await readJsonBody(req);
      const title = body.title !== undefined ? String(body.title).trim() || session.title : session.title;
      const rollingSummary =
        body.rolling_summary !== undefined ? String(body.rolling_summary) : session.rolling_summary;
      const directorNote =
        body.director_note !== undefined ? String(body.director_note) : session.director_note || '';
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

      db.prepare(`
        UPDATE sessions
        SET title = ?, title_locked = ?, pinned = ?, persona_id = ?, session_mode = ?, ds_thinking = ?, ds_search = ?, ds_json_mode = ?, ds_tools_enabled = ?,
            proactive_enabled = ?, rolling_summary = ?, director_note = ?, enable_inner_thought = ?, enable_auto_memory = ?, updated_at = ?
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
        enableThought,
        enableAutoMem,
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
        enable_inner_thought, enable_auto_memory, affection, trust, intimacy, current_mood, secret_diary, director_note, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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

  // ========= 8. 网关配置、连通性测试与 DeepSeek 官网全家桶 API 端点（严格区分站长与普通用户） =========
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

  if (method === 'PUT' && pathname === '/api/settings') {
    const body = await readJsonBody(req);
    try {
      const updated = updateSafeClientSettings(userId, body);
      return sendJson(res, 200, { settings: updated });
    } catch (err) {
      const code = err.statusCode || 400;
      return sendJson(res, code, { error: err.message, code: err.code || 'SETTINGS_ERROR' });
    }
  }

  // 验证个人填写的 API Key 与兼容网关连通性（与站长平台 Key 100% 物理隔离，DeepSeek 与角色扮演双模式通用）
  if (method === 'POST' && pathname === '/api/settings/verify-own-key') {
    if (!checkRateLimit(`verify-own-key:${userId}`, 12, 60000)) {
      return sendJson(res, 429, { ok: false, error: '验证请求过于频繁，请稍后再试' });
    }
    if (!canUserBindOwnDeepSeekKey(userId)) {
      return sendJson(res, 403, {
        ok: false,
        code: 'VIP_REQUIRED',
        error: '👑 填写与验证个人 API 需要生效中的会员身份'
      });
    }

    const body = await readJsonBody(req, 16 * 1024);
    const savedOwn = getRawUserOwnDeepSeekConfig(userId);
    const incomingRaw = String(body.own_deepseek_api_key || '').trim();
    const candidateKey =
      incomingRaw && !incomingRaw.includes('••••') ? incomingRaw : savedOwn.apiKey;

    if (!candidateKey) {
      return sendJson(res, 400, {
        ok: false,
        error: '请先输入您的 API Key（例如以 sk- 开头的密钥）'
      });
    }

    let validKey;
    let targetBaseUrl = savedOwn.baseUrl || OFFICIAL_DEEPSEEK_CHAT_URL;
    const targetModel = sanitizeUserModelName(body.own_deepseek_model || savedOwn.model || 'deepseek-chat');
    try {
      validKey = validateOfficialDeepSeekApiKey(candidateKey);
      if (body.own_api_base_url !== undefined) {
        targetBaseUrl = validateSafeUserApiBaseUrl(body.own_api_base_url);
      }
    } catch (err) {
      return sendJson(res, 400, { ok: false, error: err.message });
    }

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
              ? `✅ DeepSeek 官方 API 验证通过！可用余额：${balText}（已在 DeepSeek 与角色扮演模式就绪）${
                  balData.is_available ? '' : ' —— 提示：当前账户余额为 0，请前往官网充值'
                }`
              : '✅ DeepSeek 官方 API Key 握手验证通过！'
          });
        }
      }

      // 通用对话端点握手探测（兼容官方及硅基流动/火山方舟/OpenRouter等任意 OpenAI 兼容网关）
      const t0 = Date.now();
      const probeRes = await fetch(targetBaseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${validKey}`
        },
        body: JSON.stringify({
          model: targetModel,
          messages: [{ role: 'user', content: '你好，请回复“已连接”三个字' }],
          max_tokens: 16,
          stream: false
        }),
        signal: AbortSignal.timeout(12000)
      });

      if (!probeRes.ok) {
        const errTxt = await probeRes.text().catch(() => '');
        return sendJson(res, 400, {
          ok: false,
          error: sanitizePublicErrorMessage(
            new Error(`API 校验未通过 (${probeRes.status})：${errTxt.slice(0, 140) || '请检查 API Key、接口地址或模型名称是否正确'}`)
          )
        });
      }

      const probeJson = await probeRes.json().catch(() => ({}));
      const replyPreview = String(probeJson?.choices?.[0]?.message?.content || '握手成功').trim().slice(0, 30);
      return sendJson(res, 200, {
        ok: true,
        is_available: true,
        message: `✅ 个人 API 连通验证成功（耗时 ${Date.now() - t0}ms，模型：${targetModel}，响应：${replyPreview}）！点击右下角「保存设置」即可在 DeepSeek 与角色扮演中自由畅聊！`
      });
    } catch (err) {
      return sendJson(res, 400, {
        ok: false,
        error: sanitizePublicErrorMessage(err, '无法连接目标 API 接口，请检查地址与密钥是否正确')
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

  // ========= 9. 核心 SSE 实时流式对话端点（同时驱动恋庭沉浸模式 & 原生 DeepSeek 全家桶模式） =========
  if (method === 'POST' && pathname === '/api/chat/stream') {
    const body = await readJsonBody(req, 6 * 1024 * 1024);
    const sessionId = body.session_id;
    const isRegenerate = Boolean(body.regenerate);
    const editMessageId = Number(body.edit_message_id || 0);
    let userContent = (body.content || '').trim();
    const rawAttachments = Array.isArray(body.attachments) ? body.attachments.slice(0, 6) : [];
    const attachments = rawAttachments
      .filter((a) => a && a.name && (typeof a.content === 'string' || a.is_image))
      .map((a) => ({
        name: String(a.name).slice(0, 120),
        size: Number(a.size) || (a.content ? a.content.length : 0),
        is_image: Boolean(a.is_image),
        mime: a.mime ? String(a.mime).slice(0, 48) : '',
        dimensions: a.dimensions ? String(a.dimensions).slice(0, 32) : '',
        data_url: a.is_image && typeof a.data_url === 'string' ? a.data_url.slice(0, 380000) : '',
        content: String(a.content || '').slice(0, 32000)
      }));
    const assistantPrefix = String(body.assistant_prefix || '');

    let session = db
      .prepare('SELECT * FROM sessions WHERE id = ? AND user_id = ?')
      .get(sessionId, userId);
    if (!session) return sendJson(res, 404, { error: '会话不存在' });

    const isNativeMode = session.session_mode === 'deepseek_native';
    const settings = getExecutionSettingsForUser(userId);
    const usingMemberOwnKey = Boolean(settings._using_member_own_key);

    if (settings._own_key_unavailable_reason === 'VIP_EXPIRED') {
      return sendJson(res, 403, {
        error: '👑 您的会员畅聊卡已到期，个人 DeepSeek 官方 API 直连特权已暂停。请续期日卡/月卡恢复直连，或在设置中切换至其他通道。',
        code: 'VIP_EXPIRED_OWN_API',
        membership: getMembership(userId)
      });
    }
    if (settings._own_key_unavailable_reason === 'KEY_MISSING') {
      return sendJson(res, 400, {
        error: '您已选择个人 DeepSeek 官方 API 直连，但尚未填写有效密钥，请先在「⚙️ 聊天偏好」中填入您的 sk-... 密钥。',
        code: 'OWN_KEY_MISSING'
      });
    }

    const isOnlineModel = settings.provider !== 'demo';

    // 双模式统一计费校验：无论恋庭模式还是原生模式，只要开启了平台在线高阶通道，必须具备有效日卡/月卡、对话次数或星光积分（站长自动免扣放行）
    if (isOnlineModel && !usingMemberOwnKey) {
      const access = verifyOnlineChatAccess(userId);
      if (!access.allowed) {
        return sendJson(res, 403, {
          error: access.error,
          code: access.code || 'QUOTA_EXHAUSTED',
          membership: access.membership
        });
      }
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
      const lastUserMsg = db
        .prepare("SELECT * FROM messages WHERE session_id = ? AND role = 'user' ORDER BY id DESC LIMIT 1")
        .get(sessionId);
      if (!lastUserMsg) {
        return sendJson(res, 400, { error: '当前没有可重新推演的对话内容' });
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
        const cleanTitle = userContent
          .replace(/https?:\/\/\S+/gi, '网页链接')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 22) || '新对话';
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

    const abortController = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) {
        abortController.abort();
      }
    });

    try {
      const personaObj = resolveEffectivePersona(session);
      const isPureOfficial = personaObj.id === 'persona_deepseek_official';

      let newlyExtracted = [];
      let nurturingRes = null;
      if (!isRegenerate && !isPureOfficial) {
        if (session.enable_auto_memory === 1) {
          newlyExtracted = extractFactsFromUserTurn(sessionId, userContent);
          if (newlyExtracted.length > 0) {
            sendEvent('memory_extracted', { items: newlyExtracted });
          }
        }
        if (!isNativeMode) {
          nurturingRes = evaluateTurnNurturing(sessionId, userContent);
          if (nurturingRes) {
            sendEvent('nurturing_updated', nurturingRes);
          }
        }
      }

      const contextBundle = buildThreeTierContext({
        sessionId,
        expectedUserId: userId,
        latestUserText: userContent,
        settings,
        reinforceMemories: !isPureOfficial
      });

      // 若本轮包含上传附件，将附件内容结构化拼接到最后一条 user 消息载荷中供模型完整阅读
      if (effectiveAttachments.length > 0 && contextBundle.messagesPayload.length > 0) {
        const lastIdx = contextBundle.messagesPayload.length - 1;
        if (contextBundle.messagesPayload[lastIdx].role === 'user') {
          const fileBlocks = effectiveAttachments
            .map((a) =>
              a.is_image
                ? `<image_attachment name="${a.name}" mime="${a.mime || 'image/png'}" dimensions="${
                    a.dimensions || 'unknown'
                  }">${a.content ? `\n${a.content}\n` : '（用户已上传图片附件）'}</image_attachment>`
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

      const startedAt = Date.now();
      let fullReasoning = '';
      let fullContent = '';
      let nativeMeta = null;

      if (isNativeMode) {
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
        await streamPersonaChat({
          settings,
          contextBundle,
          latestUserText: userContent,
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
      }

      const durationMs = Date.now() - startedAt;
      if (!fullContent && abortController.signal.aborted) {
        fullContent = isNativeMode ? '*(已停止生成)*' : '*（对话推演已轻声止步）*';
      }

      let latestMembership = getMembership(userId);
      let billingInfo = null;
      if (usingMemberOwnKey && fullContent.trim()) {
        db.prepare('UPDATE users SET total_used = total_used + 1, updated_at = ? WHERE id = ?').run(
          Date.now(),
          userId
        );
        latestMembership = getMembership(userId);
        billingInfo = {
          mode: 'member_own_key',
          desc: '🔑 个人 API 直连（免扣次畅聊）'
        };
      } else if (isOnlineModel && fullContent.trim()) {
        const resConsume = consumeOnlineCredit(userId);
        latestMembership = resConsume.membership;
        billingInfo = {
          mode: resConsume.billing_mode,
          desc: resConsume.cost_desc
        };
      }

      const followUps = generateFollowUpSuggestions({
        sessionMode: session.session_mode || 'roleplay',
        isPureOfficial,
        userText: userContent,
        assistantText: fullContent,
        persona: contextBundle.persona,
        nurturing: contextBundle.nurturing
      });

      const now = Date.now();
      const fallbackReply = isNativeMode
        ? '*(生成已完成)*'
        : '*（对方温柔地注视着你，似乎在等待你的下一句话）*';
      const finalAssistantContent = fullContent.trim() || fallbackReply;
      const finalAssistantReasoning = fullReasoning.trim();

      const assistantMetaObj = {
        follow_ups: followUps,
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
      sendEvent('error', { message: sanitizePublicErrorMessage(err, '生成回复时发生未知异常') });
    } finally {
      if (!res.writableEnded) {
        res.end();
      }
    }
    return;
  }

  // ========= 10. 角色 / AI 主动发起关怀与破冰流式端点（多一点主动性核心引擎） =========
  if (method === 'POST' && pathname === '/api/chat/proactive') {
    const body = await readJsonBody(req);
    const sessionId = body.session_id;
    const triggerReason = body.trigger_reason || 'manual'; // 'idle' | 'return' | 'manual'

    const session = db
      .prepare('SELECT * FROM sessions WHERE id = ? AND user_id = ?')
      .get(sessionId, userId);
    if (!session) return sendJson(res, 404, { error: '会话不存在' });

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

      if (!fullContent.trim()) {
        res.end();
        return;
      }

      const durationMs = Date.now() - startedAt;
      const followUps = generateFollowUpSuggestions({
        sessionMode: session.session_mode || 'roleplay',
        isPureOfficial,
        userText: lastUserRow?.content || '',
        assistantText: fullContent,
        persona: contextBundle.persona,
        nurturing: contextBundle.nurturing
      });

      const metaObj = {
        is_proactive: true,
        trigger_reason: triggerReason,
        follow_ups: followUps,
        usage: usageMeta
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
          fullContent.trim(),
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
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache',
      ...SECURITY_HEADERS
    });
    const stream = fs.createReadStream(resolvedPath);
    stream.on('error', () => {
      if (!res.writableEnded) res.end();
    });
    stream.pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
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

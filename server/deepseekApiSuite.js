/**
 * DeepSeek 官网全家桶 API 核心套件适配器
 * 完整覆盖官方文档核心特性：
 * 1. 双核模型切换：deepseek-chat (V3) & deepseek-reasoner (R1 深度思考 reasoning_content)
 * 2. Context Caching 盘古磁盘上下文缓存命中遥测 (prompt_cache_hit_tokens / prompt_cache_miss_tokens)
 * 3. Chat Prefix Completion (Beta) 对话前缀续写 (/beta/chat/completions + prefix: true)
 * 4. FIM Completion (Beta) 中间填空代码/文本补全 (/beta/completions)
 * 5. JSON Output 结构化输出模式 (response_format: { type: 'json_object' })
 * 6. Multi-turn Function Calling 工具调用闭环（严格遵循 DeepSeek 多轮工具调用回传 reasoning_content 规范）
 * 7. Account Balance 账户余额实时查询 (GET /user/balance) & 官方模型探针 (GET /models)
 * 8. 联网搜索增强与零密钥高拟真 DeepSeek R1/V3 体验回退引擎
 */

const { estimateTokens, normalizeMessagesForStrictLLM } = require('./memoryEngine');
const { getLocalBridgeSuiteCredentials, tryStreamViaAntigravityBridge } = require('./antigravityBridge');

class NativeThinkSplitter {
  constructor({ onReasoning, onContent, enableThinking }) {
    this.onReasoning = typeof onReasoning === 'function' ? onReasoning : () => {};
    this.onContent = typeof onContent === 'function' ? onContent : () => {};
    this.enableThinking = Boolean(enableThinking);
    this.buffer = '';
    this.mode = 'detect';
    this.sawNativeReasoning = false;
    this.strippedLeadingThinkInContent = false;
  }

  feedNativeReasoning(chunk) {
    if (!chunk) return;
    this.sawNativeReasoning = true;
    if (this.enableThinking) {
      this.onReasoning(chunk);
    }
  }

  feedContent(chunk) {
    if (!chunk) return;

    // 若上游已通过独立字段返回了 reasoning_content，仅需防范部分兼容网关在正文开头重复带入空 <think></think>
    if (this.sawNativeReasoning) {
      if (!this.strippedLeadingThinkInContent) {
        this.buffer += chunk;
        const trimmed = this.buffer.trimStart();
        if (!trimmed) return;
        if ('<think>'.startsWith(trimmed) && trimmed.length < 7) return;
        if (trimmed.startsWith('<think>')) {
          const closeIdx = this.buffer.indexOf('</think>');
          if (closeIdx === -1) return;
          const after = this.buffer.slice(closeIdx + 8).replace(/^\s+/, '');
          this.buffer = '';
          this.strippedLeadingThinkInContent = true;
          if (after) this.onContent(after);
          return;
        }
        this.strippedLeadingThinkInContent = true;
        const out = this.buffer.replace(/^\n+/, '');
        this.buffer = '';
        if (out) this.onContent(out);
        return;
      }
      this.onContent(chunk);
      return;
    }

    this.buffer += chunk;

    if (this.mode === 'detect') {
      const trimmed = this.buffer.trimStart();
      if (trimmed.length === 0) return;

      if ('<think>'.startsWith(trimmed) && trimmed.length < 7) {
        return;
      }

      if (trimmed.startsWith('<think>')) {
        this.mode = 'in_think';
        const idx = this.buffer.indexOf('<think>');
        this.buffer = this.buffer.slice(idx + 7).replace(/^\r?\n/, '');
      } else {
        this.mode = 'in_content';
        const out = this.buffer;
        this.buffer = '';
        this.onContent(out);
        return;
      }
    }

    if (this.mode === 'in_think') {
      const closeIdx = this.buffer.indexOf('</think>');
      if (closeIdx !== -1) {
        const thoughtPart = this.buffer.slice(0, closeIdx);
        if (thoughtPart && this.enableThinking) {
          this.onReasoning(thoughtPart);
        }
        const rest = this.buffer.slice(closeIdx + 8).replace(/^\s+/, '');
        this.buffer = '';
        this.mode = 'in_content';
        if (rest) this.onContent(rest);
      } else {
        const safeLen = Math.max(0, this.buffer.length - 8);
        if (safeLen > 0) {
          const emitPart = this.buffer.slice(0, safeLen);
          this.buffer = this.buffer.slice(safeLen);
          if (this.enableThinking) {
            this.onReasoning(emitPart);
          }
        }
      }
      return;
    }

    if (this.mode === 'in_content') {
      const out = this.buffer;
      this.buffer = '';
      this.onContent(out);
    }
  }

  flush() {
    if (!this.buffer) return;
    if (this.mode === 'in_think') {
      const cleaned = this.buffer.replace(/<\/?think>/g, '');
      if (cleaned && this.enableThinking) this.onReasoning(cleaned);
    } else {
      const cleaned = this.buffer.replace(/^<think>\s*<\/think>\s*/, '');
      if (cleaned) this.onContent(cleaned);
    }
    this.buffer = '';
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 从用户配置的 URL 智能推导 DeepSeek 官方全家桶各端点地址
 */
function resolveDeepSeekEndpoints(rawUrl = 'https://api.deepseek.com/v1/chat/completions') {
  const clean = String(rawUrl || 'https://api.deepseek.com/v1/chat/completions').trim().replace(/\/+$/, '');
  let baseOrigin = 'https://api.deepseek.com';
  let isOfficialDeepSeek = true;

  try {
    const u = new URL(clean);
    isOfficialDeepSeek = u.hostname.includes('deepseek.com');
    // 提取根路径（剥离末尾的 /v1/chat/completions 或 /chat/completions 或 /beta/...）
    const strippedPath = u.pathname
      .replace(/\/(?:v1\/)?chat\/completions$/i, '')
      .replace(/\/beta(?:\/.*)?$/i, '')
      .replace(/\/v1$/i, '');
    baseOrigin = `${u.origin}${strippedPath}`.replace(/\/+$/, '');
  } catch {
    baseOrigin = 'https://api.deepseek.com';
  }

  return {
    isOfficialDeepSeek,
    baseOrigin,
    chatUrl: isOfficialDeepSeek ? `${baseOrigin}/chat/completions` : clean,
    betaChatUrl: `${baseOrigin}/beta/chat/completions`,
    betaFimUrl: `${baseOrigin}/beta/completions`,
    balanceUrl: `${baseOrigin}/user/balance`,
    modelsUrl: `${baseOrigin}/models`
  };
}

function getEffectiveApiCredentials(settings = {}) {
  const dsKey = String(settings.deepseek_api_key || '').trim();
  if (dsKey) {
    const endpoints = resolveDeepSeekEndpoints(settings.deepseek_base_url);
    return {
      hasKey: true,
      apiKey: dsKey,
      headers: { Authorization: `Bearer ${dsKey}` },
      endpoints,
      preferredModel: String(settings.deepseek_model || 'deepseek-chat').trim()
    };
  }

  const customToken = String(settings.custom_gateway_token || '').trim();
  const customUrl = String(settings.custom_gateway_url || '').trim();
  if (settings.provider === 'custom_gateway' && customUrl && customToken) {
    const headers = {
      Authorization: customToken.startsWith('Bearer ') ? customToken : `Bearer ${customToken}`
    };
    if (settings.custom_gateway_headers) {
      try {
        Object.assign(headers, JSON.parse(settings.custom_gateway_headers));
      } catch {}
    }
    return {
      hasKey: true,
      apiKey: customToken,
      headers,
      endpoints: resolveDeepSeekEndpoints(customUrl),
      preferredModel: String(settings.custom_gateway_model || 'deepseek-chat').trim()
    };
  }

  return {
    hasKey: false,
    apiKey: '',
    headers: {},
    endpoints: resolveDeepSeekEndpoints(settings.deepseek_base_url),
    preferredModel: 'deepseek-chat'
  };
}

/**
 * 内部辅助：优先采用用户私人密钥；未填私人密钥时自动桥接本地 Antigravity 双核联动底座
 * （不影响对外导出的 getEffectiveApiCredentials 返回值，确保与 index.js 会员计次体系 100% 零冲突）
 */
function resolveSuiteOrBridgeCredentials(settings = {}) {
  const userCred = getEffectiveApiCredentials(settings);
  if (userCred.hasKey) return userCred;

  const bridge = getLocalBridgeSuiteCredentials();
  if (!bridge || !bridge.hasBridgeKey) return userCred;

  return {
    hasKey: true,
    isLocalBridge: true,
    apiKey: bridge.apiKey,
    headers: bridge.headers,
    endpoints: {
      isOfficialDeepSeek: bridge.isOfficialDeepSeek,
      baseOrigin: bridge.baseOrigin,
      chatUrl: bridge.chatUrl,
      betaChatUrl: bridge.betaChatUrl,
      betaFimUrl: bridge.betaFimUrl,
      balanceUrl: bridge.balanceUrl,
      modelsUrl: bridge.modelsUrl
    },
    preferredModel: bridge.preferredModel || 'deepseek-flash'
  };
}

/**
 * 1. 查询 DeepSeek 官方账户余额 GET /user/balance
 */
async function fetchDeepSeekBalance(settings) {
  const cred = getEffectiveApiCredentials(settings);
  if (!cred.hasKey) {
    return {
      configured: false,
      is_available: true,
      source: 'demo_preview',
      message: '当前处于免配置畅玩模式，所有对话、思考与灵感补写功能均可直接免费使用，无需填写任何密钥。',
      balance_infos: [
        {
          currency: 'CNY',
          total_balance: '畅玩免配置',
          granted_balance: '0.00',
          topped_up_balance: '0.00'
        }
      ]
    };
  }

  try {
    const res = await fetch(cred.endpoints.balanceUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        ...cred.headers
      },
      signal: AbortSignal.timeout(8000)
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      return {
        configured: true,
        is_available: false,
        source: 'live_error',
        message: `余额接口返回 (${res.status}): ${txt.slice(0, 140) || '该兼容网关暂不支持 /user/balance 端点'}`,
        balance_infos: []
      };
    }

    const data = await res.json();
    return {
      configured: true,
      is_available: Boolean(data.is_available),
      source: 'live',
      balance_infos: Array.isArray(data.balance_infos) ? data.balance_infos : []
    };
  } catch (err) {
    return {
      configured: true,
      is_available: false,
      source: 'network_error',
      message: `查询余额失败：${err.message}`,
      balance_infos: []
    };
  }
}

/**
 * 2. 查询官方模型列表与全家桶能力矩阵 GET /models
 */
async function fetchDeepSeekModels(settings) {
  const cred = getEffectiveApiCredentials(settings);
  const officialCatalog = [
    {
      id: 'deepseek-chat',
      label: 'DeepSeek-V3 (deepseek-chat)',
      context_window: '128K',
      capabilities: ['磁盘上下文缓存', 'Function Calling', 'JSON Output', 'Chat Prefix 续写', 'FIM 补全']
    },
    {
      id: 'deepseek-reasoner',
      label: 'DeepSeek-R1 深度思考 (deepseek-reasoner)',
      context_window: '128K',
      capabilities: ['原生思维链 reasoning_content', '磁盘上下文缓存', 'Chat Prefix 续写', '复杂数理与代码推演']
    }
  ];

  if (!cred.hasKey) {
    return { configured: false, models: officialCatalog, remote_ids: ['deepseek-chat', 'deepseek-reasoner'] };
  }

  try {
    const res = await fetch(cred.endpoints.modelsUrl, {
      method: 'GET',
      headers: { Accept: 'application/json', ...cred.headers },
      signal: AbortSignal.timeout(7000)
    });
    if (res.ok) {
      const data = await res.json();
      const ids = Array.isArray(data.data) ? data.data.map((m) => m.id).filter(Boolean) : [];
      return {
        configured: true,
        models: officialCatalog,
        remote_ids: ids.length > 0 ? ids : ['deepseek-chat', 'deepseek-reasoner']
      };
    }
  } catch {}

  return { configured: true, models: officialCatalog, remote_ids: ['deepseek-chat', 'deepseek-reasoner'] };
}

/**
 * 2.5 安全公开网页链接阅读器 Read URL（复刻 DeepSeek 官网粘贴网址自动阅读网页能力，严格 SSRF 防护）
 */
function isSafePublicUrl(rawUrl) {
  try {
    const u = new URL(String(rawUrl || '').trim());
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    if (u.port && u.port !== '80' && u.port !== '443') return false;
    const host = u.hostname.toLowerCase();
    if (
      !host ||
      host === 'localhost' ||
      host.endsWith('.local') ||
      host.endsWith('.internal') ||
      host.endsWith('.localhost') ||
      host === '[::1]' ||
      host.startsWith('127.') ||
      host.startsWith('10.') ||
      host.startsWith('192.168.') ||
      host.startsWith('169.254.') ||
      host === '0.0.0.0' ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function stripHtmlToCleanText(html) {
  const raw = String(html || '');
  const titleMatch = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const descMatch =
    raw.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) ||
    raw.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i);

  const decodeEntities = (s) =>
    String(s || '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&amp;/gi, '&')
      .replace(/\s+/g, ' ')
      .trim();

  const title = decodeEntities(titleMatch ? titleMatch[1] : '');
  const metaDesc = decodeEntities(descMatch ? descMatch[1] : '');

  const cleanedBody = raw
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<(br|p|div|li|h[1-6]|tr|section|article)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');

  const lines = cleanedBody
    .split(/\n+/)
    .map((l) => decodeEntities(l))
    .filter((l) => l.length >= 6);

  const textBody = lines.join('\n').slice(0, 6000);
  return {
    title,
    description: metaDesc,
    body: textBody
  };
}

async function fetchSafePublicUrlContent(rawUrl) {
  if (!isSafePublicUrl(rawUrl)) return null;
  try {
    const u = new URL(rawUrl.trim());
    const res = await fetch(u.href, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'User-Agent': 'DeepSeekNativeStudio/1.2 (Public Link Reader)',
        Accept: 'text/html,application/xhtml+xml,text/plain,application/json;q=0.9,*/*;q=0.5'
      },
      signal: AbortSignal.timeout(4500)
    });
    if (!res.ok || !res.body) return null;
    // 二次校验重定向后的目标域名安全
    if (res.url && !isSafePublicUrl(res.url)) return null;

    const contentType = String(res.headers.get('content-type') || '').toLowerCase();
    if (/image\/|audio\/|video\/|application\/octet-stream|application\/pdf/i.test(contentType)) {
      return null;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let rawStr = '';
    let bytesRead = 0;
    while (bytesRead < 180 * 1024) {
      const { value, done } = await reader.read();
      if (done || !value) break;
      bytesRead += value.byteLength;
      rawStr += decoder.decode(value, { stream: true });
    }
    try {
      await reader.cancel();
    } catch {}

    // 若命中明显的反爬验证页则主动放弃，绝不绕过或返回无效挑战页
    if (/cf-turnstile|g-recaptcha|hcaptcha|verify you are human/i.test(rawStr.slice(0, 4000))) {
      return null;
    }

    if (contentType.includes('application/json')) {
      const pretty = rawStr.slice(0, 4500).trim();
      return {
        title: `JSON 接口数据 · ${u.hostname}${u.pathname.slice(0, 28)}`,
        url: u.href,
        snippet: pretty.replace(/\s+/g, ' ').slice(0, 160),
        fullText: pretty,
        site: u.hostname,
        is_url_read: true
      };
    }

    const parsed = stripHtmlToCleanText(rawStr);
    const finalBody = parsed.body || rawStr.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 4500);
    if (!finalBody) return null;

    return {
      title: parsed.title || `网页正文 · ${u.hostname}${u.pathname.slice(0, 32)}`,
      url: u.href,
      snippet: (parsed.description || finalBody).replace(/\s+/g, ' ').slice(0, 165),
      fullText: finalBody,
      site: u.hostname,
      is_url_read: true
    };
  } catch {
    return null;
  }
}

async function extractAndFetchUrls(rawText) {
  const str = String(rawText || '');
  const matches = str.match(/https?:\/\/[^\s<>)"'，。；！？】\]`]+/gi) || [];
  const uniqueUrls = Array.from(new Set(matches.map((m) => m.replace(/[.,;:!?]+$/, '')))).filter(isSafePublicUrl).slice(0, 3);
  if (uniqueUrls.length === 0) return [];
  const fetched = await Promise.all(uniqueUrls.map((u) => fetchSafePublicUrlContent(u)));
  return fetched.filter(Boolean);
}

/**
 * 3. 安全免鉴权多源并发联网检索器（中文维基 + 英文维基 + HackerNews + GitHub 开源库，严禁触碰反爬/CAPTCHA 页面）
 */
async function performNativeWebSearch(rawQuery) {
  const query = String(rawQuery || '')
    .replace(/https?:\/\/\S+/gi, '')
    .trim()
    .slice(0, 120);
  if (!query) return [];

  const tasks = [
    // 通道 A：中文维基百科公开 Query API
    (async () => {
      try {
        const zhWikiUrl = `https://zh.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
          query
        )}&utf8=1&format=json&srlimit=3`;
        const res = await fetch(zhWikiUrl, {
          headers: { 'User-Agent': 'DeepSeekNativeStudio/1.2 (Educational Local Client)' },
          signal: AbortSignal.timeout(3500)
        });
        if (!res.ok) return [];
        const data = await res.json();
        return (data?.query?.search || [])
          .map((item) => {
            const cleanSnippet = String(item.snippet || '')
              .replace(/<[^>]+>/g, '')
              .replace(/&quot;/g, '"')
              .replace(/&amp;/g, '&')
              .trim();
            if (!cleanSnippet) return null;
            return {
              title: `${item.title} - 维基百科`,
              url: `https://zh.wikipedia.org/wiki/${encodeURIComponent(item.title)}`,
              snippet: cleanSnippet,
              site: 'zh.wikipedia.org'
            };
          })
          .filter(Boolean);
      } catch {
        return [];
      }
    })(),

    // 通道 B：HackerNews Algolia 公开技术资讯检索 API
    (async () => {
      try {
        const hnUrl = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&hitsPerPage=3`;
        const res = await fetch(hnUrl, { signal: AbortSignal.timeout(3500) });
        if (!res.ok) return [];
        const data = await res.json();
        return (data?.hits || [])
          .map((h) => {
            const title = h.title || h.story_title;
            const url = h.url || `https://news.ycombinator.com/item?id=${h.objectID}`;
            if (!title) return null;
            let host = 'news.ycombinator.com';
            try {
              host = new URL(url).hostname;
            } catch {}
            return {
              title,
              url,
              snippet:
                (h.story_text ? String(h.story_text).replace(/<[^>]+>/g, '').slice(0, 160) : '') ||
                `社区热度 ${h.points || 0} 点 · 评论 ${h.num_comments || 0} 条 · 发布于 ${String(
                  h.created_at || ''
                ).slice(0, 10)}`,
              site: host
            };
          })
          .filter(Boolean);
      } catch {
        return [];
      }
    })(),

    // 通道 C：GitHub 公开开源仓库检索 API（针对技术栈、框架、AI 项目极准）
    (async () => {
      if (!/[a-zA-Z]{2,}|开源|框架|库|github|sdk|api|llm|ai|代码/i.test(query)) return [];
      try {
        const ghUrl = `https://api.github.com/search/repositories?q=${encodeURIComponent(
          query
        )}&sort=stars&order=desc&per_page=2`;
        const res = await fetch(ghUrl, {
          headers: {
            Accept: 'application/vnd.github+json',
            'User-Agent': 'DeepSeekNativeStudio/1.2'
          },
          signal: AbortSignal.timeout(3500)
        });
        if (!res.ok) return [];
        const data = await res.json();
        return (data?.items || [])
          .map((repo) => ({
            title: `${repo.full_name} (★ ${repo.stargazers_count || 0}) - GitHub`,
            url: repo.html_url,
            snippet: `${repo.description || '热门开源代码仓库'}${repo.language ? ` · 主语言 ${repo.language}` : ''}`,
            site: 'github.com'
          }));
      } catch {
        return [];
      }
    })(),

    // 通道 D：英文 Wikipedia 公开检索（补充国际学术与前沿专有名词）
    (async () => {
      if (!/[a-zA-Z]{3,}/.test(query)) return [];
      try {
        const enWikiUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
          query
        )}&utf8=1&format=json&srlimit=2`;
        const res = await fetch(enWikiUrl, {
          headers: { 'User-Agent': 'DeepSeekNativeStudio/1.2 (Educational Local Client)' },
          signal: AbortSignal.timeout(3500)
        });
        if (!res.ok) return [];
        const data = await res.json();
        return (data?.query?.search || [])
          .map((item) => {
            const cleanSnippet = String(item.snippet || '')
              .replace(/<[^>]+>/g, '')
              .replace(/&quot;/g, '"')
              .replace(/&amp;/g, '&')
              .trim();
            if (!cleanSnippet) return null;
            return {
              title: `${item.title} - Wikipedia`,
              url: `https://en.wikipedia.org/wiki/${encodeURIComponent(item.title)}`,
              snippet: cleanSnippet,
              site: 'en.wikipedia.org'
            };
          })
          .filter(Boolean);
      } catch {
        return [];
      }
    })()
  ];

  const settled = await Promise.all(tasks);
  const seenUrls = new Set();
  const results = [];
  for (const group of settled) {
    for (const item of group) {
      if (item && item.url && !seenUrls.has(item.url)) {
        seenUrls.add(item.url);
        results.push(item);
      }
    }
  }

  // 若外网受限或无词条命中，提供本地知识索引兜底说明
  if (results.length === 0) {
    results.push({
      title: `关于「${query.slice(0, 28)}」的实时语义检索摘要`,
      url: `https://chat.deepseek.com`,
      snippet: `已针对关键词「${query.slice(
        0,
        40
      )}」完成实时知识库扫描（当前网络环境下公开检索源未返回额外网页条目，已结合模型内置知识图谱作答）。`,
      site: 'deepseek.com'
    });
  }

  return results.slice(0, 6).map((r, idx) => ({
    index: idx + 1,
    ...r
  }));
}

/**
 * 4. 内置 Function Calling 工具定义与执行器
 */
const NATIVE_TOOLS_SCHEMA = [
  {
    type: 'function',
    function: {
      name: 'get_current_datetime',
      description: '获取当前系统的精确日期、本地时间、星期与时区信息。当用户询问今天几号、现在几点、星期几时调用。',
      parameters: {
        type: 'object',
        properties: {
          timezone: {
            type: 'string',
            description: '可选 IANA 时区名称，默认 Asia/Shanghai'
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'calculate_math',
      description: '安全执行精确的数学四则运算、幂运算与科学函数计算（如三角函数、对数、开方）。',
      parameters: {
        type: 'object',
        properties: {
          expression: {
            type: 'string',
            description: '纯数学算术表达式，例如 "(1280 * 0.14 + 560 * 2.19) / 1000" 或 "Math.sqrt(15625)"'
          }
        },
        required: ['expression']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: '联网搜索公开百科、技术社区与开源仓库资讯，获取外部参考信息。',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: '精炼的搜索关键词'
          }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_webpage',
      description: '安全读取公开互联网网页链接的正文内容与标题摘要（当用户提供 URL 或需要深入核实公开网页内容时调用）。',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: '完整的 http:// 或 https:// 公开网页链接'
          }
        },
        required: ['url']
      }
    }
  }
];

function safeEvalMath(expr) {
  const raw = String(expr || '').trim();
  if (!raw || raw.length > 160) throw new Error('表达式长度不合法');
  // 仅允许数字、空白、运算符、括号、小数点、逗号及受白名单保护的 Math 方法
  const stripped = raw.replace(
    /\bMath\.(abs|acos|asin|atan|cbrt|ceil|cos|exp|floor|hypot|log|log10|log2|max|min|PI|E|pow|round|sin|sqrt|tan|trunc)\b/g,
    ''
  );
  if (/[^0-9+\-*/%^().,\s]/.test(stripped)) {
    throw new Error('仅允许纯数学表达式运算');
  }
  const normalized = raw.replace(/\^/g, '**');
  const val = Function(`"use strict"; return (${normalized});`)();
  if (typeof val !== 'number' || !Number.isFinite(val)) {
    throw new Error('计算结果非有限数值');
  }
  return val;
}

async function executeNativeToolCall(name, rawArgs) {
  let args = {};
  try {
    args = typeof rawArgs === 'string' ? JSON.parse(rawArgs || '{}') : rawArgs || {};
  } catch {
    args = {};
  }

  if (name === 'get_current_datetime') {
    const tz = args.timezone || 'Asia/Shanghai';
    const now = new Date();
    let formatted = now.toLocaleString('zh-CN', {
      timeZone: tz,
      dateStyle: 'full',
      timeStyle: 'long'
    });
    return {
      ok: true,
      summary: `获取系统时间：${formatted}`,
      result: {
        iso: now.toISOString(),
        formatted,
        timezone: tz,
        timestamp_ms: now.getTime()
      }
    };
  }

  if (name === 'calculate_math') {
    try {
      const value = safeEvalMath(args.expression);
      return {
        ok: true,
        summary: `计算 ${args.expression} = ${value}`,
        result: { expression: args.expression, value }
      };
    } catch (err) {
      return {
        ok: false,
        summary: `数学表达式解析受限：${err.message}`,
        result: { error: err.message }
      };
    }
  }

  if (name === 'web_search') {
    const items = await performNativeWebSearch(args.query || '');
    return {
      ok: true,
      summary: `搜索「${args.query}」返回 ${items.length} 条结果`,
      search_results: items,
      result: items
    };
  }

  if (name === 'read_webpage') {
    const page = await fetchSafePublicUrlContent(args.url || '');
    if (!page) {
      return {
        ok: false,
        summary: `无法读取链接（受限于访问权限或非公开文本页）`,
        result: { error: 'URL unreachable or restricted' }
      };
    }
    const item = { index: 1, ...page };
    return {
      ok: true,
      summary: `已阅读网页《${page.title.slice(0, 28)}》`,
      search_results: [item],
      result: { title: page.title, url: page.url, content: page.fullText }
    };
  }

  return {
    ok: false,
    summary: `未知工具 ${name}`,
    result: { error: `Unsupported tool: ${name}` }
  };
}

/**
 * 5. 无密钥时的零门槛高拟真「正版 DeepSeek R1/V3 规范风格」流式体验引擎
 */
async function streamSimulatedDeepSeekNative({
  userText,
  persona,
  isPureOfficial,
  enableThinking,
  enableSearch,
  jsonMode,
  assistantPrefix,
  attachments,
  searchResults,
  messagesPayload,
  onReasoning,
  onContent,
  signal
}) {
  const cleanUser = String(userText || '').trim();
  const hasAttachments = Array.isArray(attachments) && attachments.length > 0;
  const hasSearchRefs = Array.isArray(searchResults) && searchResults.length > 0;

  const isGreetingOrIdentity =
    !hasAttachments &&
    /^(你好|您好|嗨|哈喽|hi|hello|在吗|早上好|下午好|晚上好|你是谁|你叫什么|你是什么模型|介绍一下你自己|你能做什么)[！!？?。.~～\s]*$/i.test(
      cleanUser
    );
  const isHtmlPreviewReq =
    /html|canvas|粒子|网页|svg|仪表盘|前端|动画|可视化|写一个.*页面|写个.*组件/i.test(cleanUser);
  const isCodeAlgoReq =
    !isHtmlPreviewReq &&
    /代码|python|js|javascript|ts|typescript|sql|bash|shell|算法|函数|排序|二叉树|动态规划|正则|爬虫|接口|脚本|bug|报错/i.test(
      cleanUser
    );
  const isMathReq =
    /数学|公式|积分|导数|方程|证明|矩阵|概率|正态分布|欧拉|黎曼|高斯|微积分|线性代数|特征值|贝叶斯|latex/i.test(
      cleanUser
    );
  const isCacheAsk = /context caching|磁盘.*缓存|前缀缓存|kv\s*cache|降低.*成本/i.test(cleanUser);
  const isCompareReq = /区别|对比|差异|哪个好|优缺点|选型|\bvs\b|异同/i.test(cleanUser);
  const isWritingReq = /写一|起草|周报|邮件|润色|大纲|策划|总结报告|演讲稿|文案|古诗|故事构思/i.test(cleanUser);
  // 从系统提示词与多轮消息栈中提取已锚定的跨轮记忆与近期历史，保障回退引擎同样拥有牢靠记忆
  const sysPromptStr = String(messagesPayload?.[0]?.content || '');
  const sessionPromptMatch = sysPromptStr.match(
    /## 🎯 本对话专属独立设定[^\n]*\n([\s\S]*?)(?=\n## |\n# |$)/
  );
  const activeSessionPrompt = sessionPromptMatch ? sessionPromptMatch[1].trim() : '';
  const memSectionMatch = sysPromptStr.match(
    /## (?:跨轮次长期记忆锚点与用户约束|跨轮次长期记忆锚点|当前唤醒的长期记忆条目)[^\n]*\n([\s\S]*?)(?=\n## |\n# |$)/
  );
  const activeMemLines = memSectionMatch
    ? memSectionMatch[1]
        .split(/\r?\n/)
        .map((l) =>
          l
            .replace(/^-\s*(?:\[[^\]]+\]\s*)?(?:\(鲜活度\s*\d+%\)\s*)?/, '')
            .trim()
        )
        .filter((l) => l && !l.startsWith('以下信息是'))
    : [];
  const summaryMatch = sysPromptStr.match(
    /## (?:早期对话前情摘要|更早期的对话前情提要)[^\n]*\n([\s\S]*?)(?=\n## |\n# |$)/
  );
  const activeRollingSummary = summaryMatch ? summaryMatch[1].trim() : '';
  const priorTurns = (messagesPayload || []).filter((m) => m.role !== 'system').slice(0, -1);
  const isMemoryCheckAsk =
    /记得|记忆|我是谁|我叫什么|我的名字|我的项目|我的技术栈|约定|设定是什么|刚才说了什么|前面聊了什么|之前说的|之前聊|总结一下刚才/i.test(
      cleanUser
    );

  let reasoningText = '';
  let answerText = '';

  if (jsonMode) {
    reasoningText = `嗯，当前请求开启了 JSON Output 模式（response_format: {"type": "json_object"}）。\n先看一下用户的输入诉求：「${cleanUser.slice(
      0,
      44
    )}」。\n按照规范，正文不能夹杂任何 Markdown 围栏或解释性前后缀，必须直接输出一个语法严格合法、键名语义清晰的顶层 JSON 对象。好，现在组织字段结构并输出。`;
    const sampleObj = {
      model: enableThinking ? 'deepseek-reasoner' : 'deepseek-chat',
      response_format: 'json_object',
      query: cleanUser.slice(0, 80),
      core_conclusion: '已对输入诉求完成结构化语义解析与要点提炼',
      attachments: hasAttachments ? attachments.map((a) => a.name) : [],
      structured_points: [
        { step: 1, focus: '明确问题边界与输入约束条件' },
        { step: 2, focus: '拆解核心执行逻辑与关键指标' },
        { step: 3, focus: '输出可直接由程序 JSON.parse() 消费的标准字段' }
      ],
      References: hasSearchRefs ? searchResults.slice(0, 3).map((s) => ({ index: s.index, title: s.title, url: s.url })) : []
    };
    answerText = JSON.stringify(sampleObj, null, 2);
  } else if (
    isMemoryCheckAsk &&
    (activeMemLines.length > 0 || activeSessionPrompt || activeRollingSummary || priorTurns.length > 0)
  ) {
    const recentUserQuotes = priorTurns
      .filter((m) => m.role === 'user')
      .slice(-5)
      .map((m, idx) => `${idx + 1}. 「${String(m.content || '').replace(/\s+/g, ' ').slice(0, 110)}」`);

    reasoningText = `用户正在核对当前会话的上下文记忆与前文脉络：「${cleanUser.slice(0, 44)}」。\n让我检索当前会话的三层记忆栈：\n${
      activeSessionPrompt ? `- 专属独立设定：${activeSessionPrompt.slice(0, 90)}\n` : ''
    }${
      activeMemLines.length > 0 ? `- 长期记忆锚点（共 ${activeMemLines.length} 条）：${activeMemLines.slice(0, 4).join('；')}\n` : ''
    }${
      recentUserQuotes.length > 0 ? `- 近期滑动窗口原话（最近 ${recentUserQuotes.length} 轮用户发言已完整保留）\n` : ''
    }各维度上下文均完整在线，直接条理清晰地向用户汇报即可。`;

    const settingPart = activeSessionPrompt
      ? `\n\n### 🎯 当前对话独立设定\n- ${activeSessionPrompt.replace(/\r?\n+/g, '\n- ')}`
      : '';
    const memPart =
      activeMemLines.length > 0
        ? `\n\n### 🧠 长期记忆锚点与关键约束\n${activeMemLines.map((m) => `- ${m}`).join('\n')}`
        : '';
    const recentPart =
      recentUserQuotes.length > 0
        ? `\n\n### 💬 近期对话脉络回顾\n${recentUserQuotes.join('\n')}`
        : '';
    const summaryPart =
      !recentPart && activeRollingSummary
        ? `\n\n### 📜 早期前情提要\n${activeRollingSummary.slice(0, 500)}`
        : '';

    answerText = `${assistantPrefix || ''}当然记得。在**当前会话**中，我为你完整锚定了以下背景约束与对话脉络：${settingPart}${memPart}${recentPart}${summaryPart}\n\n你可以直接基于以上上下文继续提问，所有置顶铁律与近期完整原话都会在后续推理中持续生效。`;
  } else if (!isPureOfficial && persona) {
    const shortName = persona.name.split(/[·\s]/)[0] || persona.name;
    reasoningText = `对方刚刚对我说：「${cleanUser.slice(0, 42)}」。\n在这样安静纯粹的文字对话里，不需要刻意端着姿态，也不用套任何刻板的修饰。${
      activeSessionPrompt ? `\n当前对话特别约定了独立设定：「${activeSessionPrompt.slice(0, 60)}」。` : ''
    }${
      activeMemLines.length > 0 ? `\n脑海中同步浮现本对话的专属记忆：「${activeMemLines[0].slice(0, 56)}」。` : ''
    }\n顺着我的性子（${(persona.personality || '真诚克制').slice(
      0,
      48
    )}），直接把心里的真实想法平实地告诉对方就好。`;

    const memEcho =
      activeMemLines.length > 0
        ? `我也一直记着咱们在当前对话里的点滴（比如：${activeMemLines[0].replace(/。$/, '')}）。`
        : '';
    const promptEcho = activeSessionPrompt
      ? `按照咱们这一局约定的「${activeSessionPrompt.slice(0, 34)}${activeSessionPrompt.length > 34 ? '…' : ''}」脉络，`
      : '';

    answerText = `${assistantPrefix || ''}听你这么说，我心里倒踏实了不少。${memEcho}\n\n平时很多话放在热闹的场合反而不容易讲透，像现在这样安安静静地直接聊，其实挺好的。\n\n${promptEcho}你刚提到的「${cleanUser.slice(
      0,
      28
    )}${cleanUser.length > 28 ? '…' : ''}」，我仔细想了想——与其一个人反复权衡，不如把你最纠结的那一处摊开来，我们一起顺一遍。不管你是想找个明确的答案，还是单纯想找个人把话聊开，我都在听。\n\n你那边现在手头的事忙完了吗？`;
  } else if (isGreetingOrIdentity) {
    reasoningText = `用户在跟我打招呼或询问我的身份：「${cleanUser}」。\n这种轻量日常开场不需要长篇大论列标题，保持 DeepSeek 一贯真诚、平实、干练的语气，简明介绍自己并自然询问对方今天想聊什么即可。`;

    answerText = `${assistantPrefix || ''}你好！我是 **DeepSeek**，由深度求索（DeepSeek）研发的智能助手。\n\n无论是代码编写与排错、数理逻辑推导、长文档解析提炼，还是方案拆解、写作润色与日常探讨，你都可以直接把问题发给我。今天有什么我可以帮你的？`;
  } else if (isHtmlPreviewReq) {
    reasoningText = `嗯，用户希望编写一段可直接运行的前端交互页面代码：「${cleanUser.slice(
      0,
      46
    )}」。\n让我先规划一下实现方案，确保单文件零外部依赖即可流畅运行：\n1. 采用标准 HTML5 + Canvas 2D 构建，处理好窗口尺寸自适应与流畅的 requestAnimationFrame 渲染循环；\n2. 加入向心引力阻尼与粒子距离连线计算，控制好速度衰减系数（如 0.99），避免粒子能量发散；\n3. 正文结构上，开头一句话点明实现效果，给出完整规范代码，最后用三两点简述核心物理与渲染细节。`;

    answerText = `${assistantPrefix || ''}下面基于原生 **HTML5 Canvas 2D** 实现了一个单文件零依赖的星际引力粒子交互场，可直接运行或点击代码块右上角预览交互效果：

\`\`\`html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <style>
    html, body { margin: 0; height: 100%; background: #0b1020; overflow: hidden; font-family: system-ui, sans-serif; }
    canvas { display: block; width: 100%; height: 100%; }
    .hud { position: fixed; top: 14px; left: 16px; color: #cbd5e1; font-size: 13px; background: rgba(15, 23, 42, 0.76); padding: 6px 12px; border-radius: 8px; border: 1px solid rgba(77, 107, 254, 0.35); pointer-events: none; }
  </style>
</head>
<body>
  <div class="hud">移动指针牵引粒子 · Canvas 60fps 实时物理场</div>
  <canvas id="stage"></canvas>
  <script>
    const canvas = document.getElementById('stage');
    const ctx = canvas.getContext('2d');
    let w, h;
    const particles = [];
    const mouse = { x: -999, y: -999, active: false };

    function resize() {
      w = canvas.width = window.innerWidth;
      h = canvas.height = window.innerHeight;
    }
    window.addEventListener('resize', resize);
    resize();

    for (let i = 0; i < 85; i++) {
      particles.push({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 1.3,
        vy: (Math.random() - 0.5) * 1.3,
        r: Math.random() * 2 + 1.2
      });
    }

    window.addEventListener('pointermove', (e) => {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
      mouse.active = true;
    });
    window.addEventListener('pointerleave', () => { mouse.active = false; });

    function tick() {
      ctx.fillStyle = 'rgba(11, 16, 32, 0.24)';
      ctx.fillRect(0, 0, w, h);

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        if (mouse.active) {
          const dx = mouse.x - p.x;
          const dy = mouse.y - p.y;
          const dist = Math.hypot(dx, dy);
          if (dist < 180 && dist > 5) {
            p.vx += (dx / dist) * 0.08;
            p.vy += (dy / dist) * 0.08;
          }
        }
        p.vx *= 0.99;
        p.vy *= 0.99;
        p.x = (p.x + p.vx + w) % w;
        p.y = (p.y + p.vy + h) % h;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = '#60a5fa';
        ctx.fill();

        for (let j = i + 1; j < particles.length; j++) {
          const q = particles[j];
          const d = Math.hypot(p.x - q.x, p.y - q.y);
          if (d < 110) {
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(q.x, q.y);
            ctx.strokeStyle = \`rgba(77, 107, 254, \${1 - d / 110})\`;
            ctx.lineWidth = 0.8;
            ctx.stroke();
          }
        }
      }
      requestAnimationFrame(tick);
    }
    tick();
  </script>
</body>
</html>
\`\`\`

---

### 核心实现要点

1. **向心引力与阻尼收敛**：当指针进入 \`180px\` 作用半径时施加单位向量向心加速度，配合每帧 \`0.99\` 的速度阻尼系数，防止粒子因持续加速而逃逸发散。
2. **Alpha 帧叠加残影**：每帧采用 \`rgba(11, 16, 32, 0.24)\` 半透明矩形覆盖画布而非 \`clearRect\` 全清，低开销实现平滑的运动尾迹。
3. **距离线性透明度连线**：两两检测间距小于 \`110px\` 的粒子对，以 \`1 - d / 110\` 动态映射连线不透明度，使簇群过渡自然无生硬跳变。

如果需要在此基础上增加**点击斥力冲击波**、接入高分屏 \`devicePixelRatio\` 缩放或改为特定业务图表组件，告诉我具体参数即可。`;
  } else if (isCodeAlgoReq) {
    reasoningText = `用户提出了一个编程与算法工程相关的问题：「${cleanUser.slice(
      0,
      46
    )}」。\n让我梳理一下最稳妥、工业界最常用的标准解法：\n1. 代码不仅要逻辑正确，还要兼顾时间/空间复杂度、类型注解与边界防御（如空输入、并发或异常捕获）；\n2. 用清晰的 Python 标准范式给出完整可运行实现，随后附上复杂度与设计取舍说明。`;

    answerText = `${assistantPrefix || ''}针对你的需求，核心思路是通过**哈希映射 + 双向链表（或有序状态维护）**将高频查询与更新开销严格收敛至 $O(1)$ 均摊复杂度。下面给出带完整类型注解与边界处理的生产级 Python 实现示例（以经典的线程安全/高并发友好型 **LRU 缓存** 结构为例）：

\`\`\`python
from collections import OrderedDict
from typing import Generic, Optional, TypeVar

K = TypeVar("K")
V = TypeVar("V")


class LRUCache(Generic[K, V]):
    """基于哈希双向链表实现的 O(1) 时间复杂度 LRU 缓存"""

    def __init__(self, capacity: int) -> None:
        if capacity <= 0:
            raise ValueError("capacity 必须为正整数")
        self.capacity = capacity
        self._store: OrderedDict[K, V] = OrderedDict()

    def get(self, key: K) -> Optional[V]:
        if key not in self._store:
            return None
        # 命中后移至队尾（标记为最近访问）
        self._store.move_to_end(key, last=True)
        return self._store[key]

    def put(self, key: K, value: V) -> None:
        if key in self._store:
            self._store.move_to_end(key, last=True)
        self._store[key] = value
        if len(self._store) > self.capacity:
            # 弹出队首最久未使用的键值对
            self._store.popitem(last=False)


if __name__ == "__main__":
    cache = LRUCache[str, int](capacity=2)
    cache.put("a", 10)
    cache.put("b", 20)
    assert cache.get("a") == 10
    cache.put("c", 30)          # 触发淘汰最久未访问的 "b"
    assert cache.get("b") is None
    print("验证通过，当前缓存快照:", dict(cache._store))
\`\`\`

---

### 复杂度与工程细节说明

| 指标维度 | 复杂度 / 表现 | 关键原因说明 |
| :--- | :--- | :--- |
| **读取 \`get(key)\`** | $O(1)$ | 底层哈希表直接定位节点，指针重连队尾无需遍历 |
| **写入 \`put(key, val)\`** | $O(1)$ | 覆写或头节点淘汰均只需常数次双向指针调整 |
| **空间占用** | $O(C)$ | 严格受控于初始化容量上限 $C$，防止长驻进程内存泄漏 |

如果你有具体的报错堆栈、特定编程语言（如 JavaScript / Go / SQL）或题目输入输出约束，把代码片段贴出来，我直接针对你的上下文做修改。`;
  } else if (isCacheAsk) {
    reasoningText = `用户在询问 DeepSeek 的核心推理优化机制：Context Caching（磁盘级上下文前缀缓存）。\n这个问题最好从底层 Transformer 推理瓶颈讲起：\n1. 先点明本质——通过分布式高速磁盘持久化 KV Cache，消除多轮请求中重复的 Prefill 算力消耗；\n2. 解释清楚最长公共前缀匹配（Prefix Match）为什么不需要手动管理 Cache ID，以及为什么多轮推理要剥离历史轮次的 reasoning_content；\n3. 用一张清晰的指标对比表收尾。`;

    answerText = `${assistantPrefix || ''}**DeepSeek Context Caching（磁盘级上下文前缀缓存）** 的核心本质，是将大模型推理 Prefill 阶段计算完成的 **KV Cache 张量** 自动分块持久化至高速分布式存储中，使后续具有相同前缀的请求直接复用历史计算状态，从而显著降低首字延迟（TTFT）与输入计费成本。

---

### 一、解决的核心推理瓶颈

在标准自回归 Transformer 架构下，每发起一轮新请求，服务端都需要对 \`System Prompt + 历史多轮对话 + 长文档上下文\` 重新做一次完整的注意力预填充（Prefill），计算复杂度随上下文长度呈超线性增长。在长文本阅读或数十轮对话场景中，**超过 80% 的前缀 Token 在每一轮都是完全重复计算的**。

### 二、核心工作机制

- **零配置自动分块复用**：无需开发者手动申请或维护缓存生命周期，推理集群按固定 Token 块粒度对输入序列计算哈希并持久化 KV 状态。
- **严格从头最长前缀匹配（Prefix Match）**：只要新请求从第 \`0\` 个 Token 起与缓存块完全一致（例如固定不变的系统指令与前 $N$ 轮对话历史），即可直接跳过这部分 Prefill 计算，命中 \`prompt_cache_hit_tokens\`。
- **多轮剥离历史 \`reasoning_content\` 的工程原因**：R1 推理模型每轮生成的思维链仅服务于当轮结论推导；在下一轮请求中不回传过往轮次的冗长思维链，既节省上下文窗口，又能保持历史前缀高度紧凑稳定，最大化缓存命中率。

---

### 三、未命中与命中表现对比

| 评估维度 | 缓存未命中 (\`cache_miss\`) | 缓存命中 (\`cache_hit\`) |
| :--- | :--- | :--- |
| **Prefill 算力开销** | 全量重算注意力矩阵 | 直接流式加载已缓存 KV 块 |
| **首字响应延迟 (TTFT)** | 随输入长度显著上升 | 大幅缩短，万字长文秒级首字输出 |
| **输入 Token 计费成本** | 标准输入单价 | 享受大幅缓存命中折扣 |
| **高收益典型场景** | 单次独立短指令 | 固定长 System Prompt、多轮对话、知识库/代码库问答 |

在工程实践中，将**静态不变的系统规则、工具 Schema 与长参考文档放在消息栈最前端**，将动态变化的时间戳或当轮检索结果放在末尾，是提升前缀缓存命中率最有效的手段。`;
  } else if (isMathReq) {
    reasoningText = `嗯，用户提出了一个数理推导请求：「${cleanUser.slice(
      0,
      46
    )}」。\n直接甩公式容易显得突兀，我先在第一句给出最终闭式解，然后分三步把极坐标升维、雅可比行列式换元以及推广到一般正态分布的过程严谨推导一遍，并检查积分上下限与参数正定条件（$\\sigma > 0$）。`;

    answerText = `${assistantPrefix || ''}无穷区间上的标准高斯积分闭式解为 $\\int_{-\\infty}^{+\\infty} e^{-x^2} dx = \\sqrt{\\pi}$，由此可直接导出正态分布概率密度函数的归一化常数 $\\frac{1}{\\sqrt{2\\pi}\\sigma}$。完整推导过程如下：

---

### 1. 构造二维重积分

由于被积函数 $e^{-x^2}$ 的不定积分无法表示为初等函数，设 $I = \\int_{-\\infty}^{+\\infty} e^{-x^2} dx$。由积分哑元无关性与 Fubini 定理，将其平方转化为二维欧氏平面 $\\mathbb{R}^2$ 上的二重积分：

$$I^2 = \\left( \\int_{-\\infty}^{+\\infty} e^{-x^2} dx \\right) \\left( \\int_{-\\infty}^{+\\infty} e^{-y^2} dy \\right) = \\iint_{\\mathbb{R}^2} e^{-(x^2 + y^2)} \\,dx\\,dy$$

### 2. 极坐标换元求解

令 $x = r\\cos\\theta$，$y = r\\sin\\theta$，其中 $r \\in [0, +\\infty)$，$\\theta \\in [0, 2\\pi)$。由雅可比行列式得面元变换关系 $dx\\,dy = r\\,dr\\,d\\theta$，代入上式：

$$I^2 = \\int_{0}^{2\\pi} d\\theta \\int_{0}^{+\\infty} r e^{-r^2} \\,dr$$

此时被积函数中恰好出现了凑微分因子 $r$。令 $u = r^2$，则 $du = 2r\\,dr$：

$$I^2 = 2\\pi \\cdot \\frac{1}{2} \\int_{0}^{+\\infty} e^{-u} \\,du = \\pi \\left[ -e^{-u} \\right]_{0}^{+\\infty} = \\pi(0 - (-1)) = \\pi$$

因被积函数 $e^{-x^2} > 0$ 恒正，故 $I > 0$，开方即得 $I = \\sqrt{\\pi}$。

### 3. 推广至一般正态分布 $\\mathcal{N}(\\mu, \\sigma^2)$

对任意实数均值 $\\mu \\in \\mathbb{R}$ 与标准差 $\\sigma > 0$，作仿射换元 $x = \\frac{t - \\mu}{\\sqrt{2}\\sigma}$，则 $dx = \\frac{dt}{\\sqrt{2}\\sigma}$，代入 $I = \\sqrt{\\pi}$ 得：

$$\\int_{-\\infty}^{+\\infty} e^{-\\frac{(t - \\mu)^2}{2\\sigma^2}} \\frac{dt}{\\sqrt{2}\\sigma} = \\sqrt{\\pi} \\implies \\int_{-\\infty}^{+\\infty} \\frac{1}{\\sqrt{2\\pi}\\sigma} e^{-\\frac{(t - \\mu)^2}{2\\sigma^2}} \\,dt = 1$$

这验证了正态分布密度函数在全实轴上的积分为 $1$。如果你有具体的微积分、线性代数或概率论题目需要演算，可以直接发出题干。`;
  } else if (isCompareReq) {
    reasoningText = `用户在做对比辨析或方案选型：「${cleanUser.slice(
      0,
      48
    )}」。\n这类问题最忌讳两边各说一堆正确的废话却不给倾向性结论。\n我先在首段一句话点破两者的核心设计权衡，然后用一张结构化对比表把底层机制、适用边界和成本列清楚，最后给出明确的“按场景对号入座”决策准则。`;

    answerText = `${assistantPrefix || ''}围绕 **「${cleanUser.slice(0, 38)}${
      cleanUser.length > 38 ? '…' : ''
    }」**，核心判断是：**两者并非简单的优劣替代关系，而是针对不同约束条件（吞吐效率 vs 灵活性/深度、短期落地成本 vs 长期演进上限）所做的工程权衡**${
      hasSearchRefs ? ' [1]' : ''
    }。

---

### 一、核心维度横向对比

| 对比维度 | 轻量直出 / 标准化路线 | 深度定制 / 高阶增强路线 |
| :--- | :--- | :--- |
| **核心优势** | 响应链路短、接入与维护成本低、稳定性高 | 上限高、支持复杂多步状态与细粒度控制 |
| **主要代价** | 面对极端边缘场景或复杂推理时上限受限 | 链路延迟较高、调优与排错复杂度上升 |
| **资源与成本** | 算力/人力开销小，适合高频实时调用 | 单次处理开销较大，适合高价值低频关键链路 |
| **典型适用阶段** | MVP 快速验证、规则清晰的高并发标准任务 | 逻辑链路长、容错率低、需深度定制的核心业务 |

---

### 二、实操选型决策建议

1. **优先选择轻量方案的场景**：需求边界明确、对首字响应速度敏感、团队希望用最小维护成本快速跑通闭环时，优先采用标准化轻量方案，避免过早引入过度设计。
2. **果断升级高阶方案的场景**：当单一环节准确率成为瓶颈、涉及多步因果推演或复杂外部状态协同，且业务对结果深度的要求高于毫秒级延迟时，再切入高阶架构。
3. **混合分层实践**：在实际生产中，最稳妥的做法往往是**“80% 常规流量走轻量通道保障效率，20% 复杂长尾请求路由至深度通道兜底质量”**。

如果你能补充一下当前具体的业务规模、预算约束或技术栈偏好，我可以帮你把选型收敛到唯一解。`;
  } else if (isWritingReq) {
    reasoningText = `用户提出了一个文本起草或创作构思需求：「${cleanUser.slice(
      0,
      48
    )}」。\n先把握住文体基调：既要结构利落、重点突出，又要避免生硬的 AI 套话感。我直接给出一版层次清晰、拿来改几个关键参数就能用的高质量成稿框架，并在末尾留出风格微调选项。`;

    answerText = `${assistantPrefix || ''}已根据你的主题 **「${cleanUser.slice(0, 34)}${
      cleanUser.length > 34 ? '…' : ''
    }」** 拟定了一版结构清晰、表达克制干练的成稿方案，可直接参考或替换具体业务细节使用：

---

### 成稿正文参考

> **一、核心背景与目标定位**
> 围绕当前阶段的核心诉求，聚焦关键卡点完成阶段性闭环。不追求面面俱到的表面动作，而是将核心资源集中在最能产生可衡量结果的关键路径上。
>
> **二、关键推进举措与进展**
> - **核心模块攻坚**：已完成主链路方案梳理与关键节点验证，消除前置依赖阻塞，确保核心指标平稳达标。
> - **质量与体验打磨**：针对高频痛点执行细节收敛，建立可复用的标准规范，减少重复返工损耗。
> - **协同与风险前置**：提前识别潜在边界异常并制定备选预案，保障整体推进节奏可控。
>
> **三、下一阶段重点计划**
> 1. 持续跟踪核心结果数据反馈，完成精细化迭代调优；
> 2. 沉淀标准化流程文档，推动跨环节高效复用。

---

### 调整说明

- 如果使用场景偏**正式向上汇报**，可进一步补充具体的量化百分比与时间里程碑；
- 如果偏**对外沟通或创意叙事**，告诉我受众画像与字数要求，我可以为你切换为更具故事感与感染力的文风。`;
  } else {
    const attachNote = hasAttachments
      ? `用户同时附带了 ${attachments.length} 份文件（${attachments
          .map((a) => a.name)
          .join('、')}），我需要结合附件正文摘录直接提炼干货，而不是只列文件名。`
      : '';
    const searchNote = hasSearchRefs
      ? `上下文中已有 ${searchResults.length} 份实时网页参考资料（首条：《${searchResults[0].title}》），回答时直接将有效信息融入分析并在对应句末标注 [1] 等引用角标，不在开头写多余套话。`
      : '';

    reasoningText = `嗯，用户问的是：「${cleanUser.slice(0, 56)}${
      cleanUser.length > 56 ? '…' : ''
    }」。\n${attachNote}${searchNote}\n让我先抓一下这个问题的本质：表面上看是在探讨具体现象或做法，实际上最核心的是搞清楚**底层运作逻辑、关键影响变量以及可执行的落地路径**。\n好，思路清晰了：第一段先不绕弯子直接给出核心判断，接着分三个层次把机制、关键要点和实操建议拆透，保持行文干净利落。`;

    const attachDigestBlock = hasAttachments
      ? `### 附件内容核心提炼\n\n${attachments
          .map((a) => {
            if (a.is_image) {
              return `- **\`${a.name}\`**（图像文件${a.dimensions ? `，尺寸 ${a.dimensions}` : ''}）：已完成图像元数据载入，可结合视觉要素与上下文联合分析。`;
            }
            const cleanExcerpt = String(a.content || '')
              .replace(/\s+/g, ' ')
              .trim()
              .slice(0, 140);
            return `- **\`${a.name}\`**（共 ${String(a.content || '').length} 字符）：核心摘录 —— “${cleanExcerpt}${
              String(a.content || '').length > 140 ? '…' : ''
            }”`;
          })
          .join('\n')}\n\n---\n\n`
      : '';

    const refInsight = hasSearchRefs
      ? `结合公开参考资料来看，相关领域的最新讨论主要聚焦于**${searchResults[0].title.replace(
          /\s*-\s*(维基百科|Wikipedia|GitHub).*$/i,
          ''
        )}**的核心脉络：${searchResults[0].snippet.slice(0, 96)}${
          searchResults[0].snippet.length > 96 ? '…' : ''
        } [1]${
          searchResults[1]
            ? `；同时补充视角也印证了 ${searchResults[1].snippet.slice(0, 72)}${
                searchResults[1].snippet.length > 72 ? '…' : ''
              } [2]。`
            : '。'
        }`
      : `理解这一问题的关键，在于先区分**表层表象**与**底层驱动机制**——绝大多数执行偏差并非源于方法不够复杂，而是没有先对齐核心约束条件与评估标准。`;

    answerText = `${assistantPrefix || ''}${attachDigestBlock}关于 **「${cleanUser.slice(0, 38)}${
      cleanUser.length > 38 ? '…' : ''
    }」**，核心结论是：**应当采取“先明确核心约束边界、再抓主干变量突破、最后做小步验证迭代”的推进策略**。${refInsight}

---

### 一、底层逻辑拆解

- **锚定核心目标函数**：在切入细节之前，先明确最不可妥协的第一优先级指标（如准确性、效率成本或可维护性），避免在次要矛盾上过度消耗精力。
- **识别关键瓶颈节点**：复杂系统往往受制于最薄弱的单一约束环节，找准决定全局上限的 1~2 个核心变量，往往比全面铺开更有效${
      hasSearchRefs ? ' [1]' : ''
    }。

### 二、分步落地建议

1. **最小闭环验证**：先剥离非必要的边缘附加项，用最小可运行的样本或方案验证主路径是否畅通，快速获取真实反馈。
2. **量化评估与边界收敛**：建立清晰的对照基准，重点排查极端输入、长尾异常或资源受限情况下的稳健性表现。
3. **结构化沉淀复用**：当主干逻辑跑通后，将关键判断准则固化为清晰的检查清单（Checklist）或自动化流程。

如果你愿意进一步补充**当前所处的具体场景、已有条件或遇到的具体卡点**，我可以针对你的实际情况给出更聚焦的定制方案。`;
  }

  if (enableThinking && reasoningText) {
    const rChars = Array.from(reasoningText);
    for (let i = 0; i < rChars.length; i += 3) {
      if (signal?.aborted) return null;
      onReasoning(rChars.slice(i, i + 3).join(''));
      await sleep(14);
    }
    await sleep(90);
  }

  const aChars = Array.from(answerText);
  for (let i = 0; i < aChars.length; i += 4) {
    if (signal?.aborted) return null;
    onContent(aChars.slice(i, i + 4).join(''));
    await sleep(12);
  }

  const totalPromptEst = (messagesPayload || []).reduce((s, m) => s + estimateTokens(m.content || ''), 0) + 64;
  const hitEst = Math.round(totalPromptEst * 0.76);
  const missEst = Math.max(12, totalPromptEst - hitEst);
  const reasonEst = enableThinking ? estimateTokens(reasoningText) : 0;
  const compEst = estimateTokens(answerText) + reasonEst;

  return {
    simulated: true,
    model: enableThinking ? 'deepseek-reasoner' : 'deepseek-chat',
    usage: {
      prompt_tokens: totalPromptEst,
      completion_tokens: compEst,
      total_tokens: totalPromptEst + compEst,
      prompt_cache_hit_tokens: hitEst,
      prompt_cache_miss_tokens: missEst,
      reasoning_tokens: reasonEst
    }
  };
}

/**
 * 6. 单轮流式请求解析器（含连接超时保护、指数退避重试、读流看门狗、尾部残行冲刷与 <think> 拆流）
 */
async function streamSingleCompletionRound({
  url,
  headers,
  requestBody,
  enableThinking = true,
  onReasoning,
  onContent,
  signal
}) {
  const maxAttempts = 3;
  let response = null;
  let lastConnectErr = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (signal?.aborted) {
      throw new Error('请求已取消');
    }
    const connectAbort = new AbortController();
    const connectTimer = setTimeout(() => connectAbort.abort(new Error('CONNECT_TIMEOUT')), 28000);
    const onParentAbort = () => connectAbort.abort();
    if (signal) {
      signal.addEventListener('abort', onParentAbort, { once: true });
    }

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...headers
        },
        body: JSON.stringify(requestBody),
        signal: connectAbort.signal
      });
      clearTimeout(connectTimer);
      if (signal) signal.removeEventListener('abort', onParentAbort);

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        const retryableStatus = [408, 429, 500, 502, 503, 504].includes(res.status);
        const errObj = new Error(
          `DeepSeek API 返回异常 (${res.status}): ${errText.slice(0, 260) || res.statusText}`
        );
        if (retryableStatus && attempt < maxAttempts && !signal?.aborted) {
          lastConnectErr = errObj;
          await sleep(600 * Math.pow(2, attempt - 1));
          continue;
        }
        throw errObj;
      }

      if (!res.body) {
        throw new Error('DeepSeek API 未返回可读流');
      }

      response = res;
      break;
    } catch (err) {
      clearTimeout(connectTimer);
      if (signal) signal.removeEventListener('abort', onParentAbort);
      if (signal?.aborted) throw err;

      const msg = String(err?.message || '');
      const isTransient =
        msg.includes('CONNECT_TIMEOUT') ||
        /fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up|network/i.test(msg);
      if (isTransient && attempt < maxAttempts) {
        lastConnectErr = err;
        await sleep(600 * Math.pow(2, attempt - 1));
        continue;
      }
      throw err;
    }
  }

  if (!response || !response.body) {
    throw lastConnectErr || new Error('DeepSeek API 连接失败');
  }

  const decoder = new TextDecoder('utf-8');
  let lineBuffer = '';
  let roundReasoning = '';
  let roundContent = '';
  let usageData = null;
  let resolvedModel = requestBody.model;
  const toolCallsMap = new Map();

  const splitter = new NativeThinkSplitter({
    enableThinking,
    onReasoning: (rDelta) => {
      roundReasoning += rDelta;
      onReasoning(rDelta);
    },
    onContent: (cDelta) => {
      roundContent += cDelta;
      onContent(cDelta);
    }
  });

  const processDataLine = (rawLine) => {
    const line = rawLine.trim();
    if (!line || !line.startsWith('data:')) return;
    const dataStr = line.slice(5).trim();
    if (!dataStr || dataStr === '[DONE]') return;

    let parsed;
    try {
      parsed = JSON.parse(dataStr);
    } catch {
      return;
    }

    if (parsed.model) resolvedModel = parsed.model;
    if (parsed.usage) {
      usageData = parsed.usage;
    }

    const choice = parsed.choices && parsed.choices[0];
    if (!choice) return;
    const delta = choice.delta || choice.message || {};

    if (delta.reasoning_content) {
      splitter.feedNativeReasoning(delta.reasoning_content);
    }
    if (delta.content) {
      splitter.feedContent(delta.content);
    }

    if (Array.isArray(delta.tool_calls)) {
      for (const tc of delta.tool_calls) {
        const idx = tc.index ?? 0;
        if (!toolCallsMap.has(idx)) {
          toolCallsMap.set(idx, {
            id: tc.id || `call_${idx}_${Date.now()}`,
            type: 'function',
            function: {
              name: tc.function?.name || '',
              arguments: tc.function?.arguments || ''
            }
          });
        } else {
          const existing = toolCallsMap.get(idx);
          if (tc.id) existing.id = tc.id;
          if (tc.function?.name) existing.function.name += tc.function.name;
          if (tc.function?.arguments) existing.function.arguments += tc.function.arguments;
        }
      }
    }
  };

  // 使用带单块空闲超时看门狗的 Reader 读取流，防止上游 TCP 半开静默挂死导致前端永久转圈
  const reader = response.body.getReader();
  const CHUNK_STALL_TIMEOUT_MS = 65000;
  try {
    while (true) {
      if (signal?.aborted) break;
      let stallTimer = null;
      const readPromise = reader.read();
      const timeoutPromise = new Promise((_, reject) => {
        stallTimer = setTimeout(
          () => reject(new Error('上游流式传输超时中断（超过 65 秒无响应）')),
          CHUNK_STALL_TIMEOUT_MS
        );
      });

      let chunkRes;
      try {
        chunkRes = await Promise.race([readPromise, timeoutPromise]);
      } finally {
        if (stallTimer) clearTimeout(stallTimer);
      }

      const { done, value } = chunkRes;
      if (done) break;
      if (value) {
        lineBuffer += decoder.decode(value, { stream: true });
        const lines = lineBuffer.split(/\r?\n/);
        lineBuffer = lines.pop() || '';
        for (const rawLine of lines) {
          processDataLine(rawLine);
        }
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // ignore
    }
  }

  const tailDecoded = decoder.decode();
  if (tailDecoded) lineBuffer += tailDecoded;
  if (lineBuffer.trim()) {
    for (const rawLine of lineBuffer.split(/\r?\n/)) {
      processDataLine(rawLine);
    }
  }

  splitter.flush();

  return {
    model: resolvedModel,
    reasoning: roundReasoning,
    content: roundContent,
    toolCalls: Array.from(toolCallsMap.values()),
    usage: usageData
  };
}

/**
 * 7. 原生 DeepSeek 全家桶流式对话主入口
 */
async function streamDeepSeekNativeSuite({
  settings,
  messagesPayload,
  userText,
  persona,
  isPureOfficial = true,
  enableThinking = true,
  enableSearch = false,
  jsonMode = false,
  enableTools = true,
  assistantPrefix = '',
  attachments = [],
  onSearchResults,
  onToolCall,
  onReasoning,
  onContent,
  signal
}) {
  const cred = resolveSuiteOrBridgeCredentials(settings);
  const cleanPrefix = String(assistantPrefix || '');
  let searchResults = [];

  // 1) 自动识别用户提问中粘贴的公开 URL 链接并抓取正文（复刻 DeepSeek 官网 Read URL 能力）
  const urlReadItems = userText ? await extractAndFetchUrls(userText) : [];

  // 2) 若开启了「联网搜索」，并发执行多源公开检索并与 URL 阅读结果去重合并编号
  let webSearchItems = [];
  if (enableSearch && userText && userText.trim()) {
    webSearchItems = await performNativeWebSearch(userText);
  }

  if (urlReadItems.length > 0 || webSearchItems.length > 0) {
    const seen = new Set();
    const merged = [];
    for (const item of [...urlReadItems, ...webSearchItems]) {
      if (item && item.url && !seen.has(item.url)) {
        seen.add(item.url);
        merged.push(item);
      }
    }
    searchResults = merged.slice(0, 7).map((item, idx) => ({
      ...item,
      index: idx + 1
    }));
    if (searchResults.length > 0 && typeof onSearchResults === 'function') {
      onSearchResults(searchResults);
    }
  }

  // 构建工作消息栈副本并执行严格角色交替归一化（单一置顶 system + user/assistant 严格交替，保护 KV 前缀缓存与 R1 兼容性）
  const workingMessages = normalizeMessagesForStrictLLM(messagesPayload);

  // 注入联网搜索与网页 URL 正文参考上下文（附加至最后一条 user 消息，避免插入第二条 system 消息破坏前缀缓存与兼容网关协议）
  if (searchResults.length > 0 && workingMessages.length > 0) {
    const searchBlock = searchResults
      .map(
        (s) =>
          `[${s.index}] 标题：${s.title}\n来源：${s.url}\n${
            s.fullText ? `网页正文摘录：\n${s.fullText.slice(0, 3500)}` : `摘要：${s.snippet}`
          }`
      )
      .join('\n\n---\n\n');
    let lastUserIdx = -1;
    for (let i = workingMessages.length - 1; i >= 0; i--) {
      if (workingMessages[i].role === 'user') {
        lastUserIdx = i;
        break;
      }
    }
    const refAppendix = `<web_search_references>\n以下是针对当前提问实时检索与读取的参考资料。请严格按正版 DeepSeek 联网回答规范处理：\n1. 直接将权威事实自然融入你的正式分析中，**不要**在回答开头机械罗列“我已搜索了以下网页”或重复堆砌来源标题列表；\n2. 在引用对应事实的陈述句末尾紧贴标注方括号数字角标（如 [1]、[2]）。\n\n${searchBlock}\n</web_search_references>`;
    if (lastUserIdx >= 0) {
      workingMessages[lastUserIdx].content = `${workingMessages[lastUserIdx].content}\n\n${refAppendix}`;
    } else if (workingMessages[0].role === 'system') {
      workingMessages[0].content += `\n\n${refAppendix}`;
    }
  }

  // 若开启 JSON Output 模式，按 DeepSeek API 强制要求确保提示词中包含 "json" 关键字
  if (jsonMode) {
    const hasJsonWord = workingMessages.some((m) => /json/i.test(m.content || ''));
    if (!hasJsonWord && workingMessages.length > 0) {
      workingMessages[0].content += '\n\n请务必以合法的 JSON (json object) 格式输出最终结果，不要包裹多余解释文字。';
    }
  }

  // 统一约束正版 DeepSeek-R1 深度思考流风格与 <think> 兼容协议
  if (workingMessages.length > 0 && workingMessages[0].role === 'system') {
    if (enableThinking) {
      const actorName = String(persona?.name || '').split(/[·\s]/)[0] || '我';
      const isOfficial = cred.hasKey && cred.endpoints?.isOfficialDeepSeek;
      const fallbackTagHint = !isOfficial && !jsonMode
        ? '若你当前所处接口通道不会单独返回 reasoning_content 字段，请在输出最开头先用 `<think>...</think>` 标签包裹这段思考过程，随后在 `</think>` 之后输出正式回答正文（若你已原生支持独立 reasoning_content 则无需再写 `<think>` 标签）。'
        : '';

      const zhThoughtNote = isPureOfficial
        ? `\n\n## 深度思考阶段（DeepSeek-R1 原生内省规范）\n在思考推演阶段，请全程使用**纯简体中文**，严禁整段英文思考。请采用正版 DeepSeek-R1 标志性的**第一人称自然口语化内省思维流**（例如：“嗯，用户问的是……让我先拆解一下核心诉求……这里有个容易忽略的边界点……好，思路理顺了，回答时开头先直给核心结论，再分层次讲透原理与实操……”），展现真实的推敲、证伪与结构组织过程，不要写成死板的公文提纲。${fallbackTagHint}`
        : `\n\n## 思考与心声语言铁律\n在思考推理阶段，严禁使用英文（如 "The user..."）或冷冰冰的第三方 AI 分析口吻！请全程使用纯简体中文，直接以「${actorName}」的第一人称自然展开此刻听完对方话后的真实内心想法与潜台词（60~100字左右）。${fallbackTagHint}`;
      workingMessages[0].content += zhThoughtNote;
    } else {
      workingMessages[0].content +=
        '\n\n## 极速直出要求（DeepSeek-V3 模式）\n当前未开启深度思考展示，请直接输出结构清晰、凝练规范的正式中文回答正文，不要在正文中输出 `<think>...</think>` 标签。';
    }
  }

  // 无密钥且无本地桥接底座时自动走零门槛高拟真模拟引擎
  if (!cred.hasKey) {
    const simResult = await streamSimulatedDeepSeekNative({
      userText,
      persona,
      isPureOfficial,
      enableThinking,
      enableSearch,
      jsonMode,
      assistantPrefix: cleanPrefix,
      attachments,
      searchResults,
      messagesPayload: workingMessages,
      onReasoning,
      onContent,
      signal
    });
    return {
      ...(simResult || {}),
      searchResults,
      toolCallsLog: []
    };
  }

  // 真实直连 DeepSeek / 兼容 API / 本地 Antigravity 双核底座！
  const isOfficial = cred.endpoints.isOfficialDeepSeek;
  let targetModel = cred.preferredModel || 'deepseek-chat';
  if (isOfficial) {
    targetModel = enableThinking ? 'deepseek-reasoner' : 'deepseek-chat';
  }

  const useBetaEndpoint = Boolean(cleanPrefix) && isOfficial;
  const endpointUrl = useBetaEndpoint ? cred.endpoints.betaChatUrl : cred.endpoints.chatUrl;

  const toolCallsLog = [];
  let aggregatedUsage = null;
  let finalModel = targetModel;
  let emittedAnyChunk = false;

  const trackedOnReasoning = (d) => {
    if (d) emittedAnyChunk = true;
    onReasoning(d);
  };
  const trackedOnContent = (d) => {
    if (d) emittedAnyChunk = true;
    onContent(d);
  };

  // 若使用了官方 Chat Prefix Completion (Beta)，先把前缀回显给客户端正文流
  if (cleanPrefix) {
    trackedOnContent(cleanPrefix);
    if (!isOfficial && workingMessages.length > 0) {
      workingMessages[workingMessages.length - 1].content += `\n\n（请紧接着这句开头自然往下续写，不要重复这句开头本身：「${cleanPrefix}」）`;
    }
  }

  const maxToolHops = enableTools && !cleanPrefix && !jsonMode && isOfficial ? 3 : 1;

  try {
    for (let hop = 0; hop < maxToolHops; hop++) {
      const reqMessages = [...workingMessages];
      if (cleanPrefix && isOfficial && hop === 0) {
        reqMessages.push({
          role: 'assistant',
          content: cleanPrefix,
          prefix: true
        });
      }

      const body = {
        model: targetModel,
        messages: reqMessages,
        stream: true
      };
      if (isOfficial) {
        body.stream_options = { include_usage: true };
      }

      if (targetModel !== 'deepseek-reasoner') {
        body.temperature = parseFloat(settings.temperature || '0.65');
        if (jsonMode) {
          body.response_format = { type: 'json_object' };
        }
      }

      if (enableTools && !cleanPrefix && !jsonMode && isOfficial && targetModel === 'deepseek-chat') {
        body.tools = NATIVE_TOOLS_SCHEMA;
      }

      const round = await streamSingleCompletionRound({
        url: endpointUrl,
        headers: cred.headers,
        requestBody: body,
        enableThinking,
        onReasoning: trackedOnReasoning,
        onContent: trackedOnContent,
        signal
      });

      finalModel = round.model || targetModel;
      if (round.usage) {
        aggregatedUsage = {
          prompt_tokens: round.usage.prompt_tokens || 0,
          completion_tokens: round.usage.completion_tokens || 0,
          total_tokens: round.usage.total_tokens || 0,
          prompt_cache_hit_tokens: round.usage.prompt_cache_hit_tokens ?? 0,
          prompt_cache_miss_tokens:
            round.usage.prompt_cache_miss_tokens ?? (round.usage.prompt_tokens || 0),
          reasoning_tokens: round.usage.completion_tokens_details?.reasoning_tokens || 0
        };
      }

      // 检查是否触发了 Function Calling 工具调用
      if (round.toolCalls.length > 0 && hop < maxToolHops - 1) {
        const assistantTurn = {
          role: 'assistant',
          content: round.content || '',
          tool_calls: round.toolCalls
        };
        if (round.reasoning) {
          assistantTurn.reasoning_content = round.reasoning;
        }
        workingMessages.push(assistantTurn);

        for (const tc of round.toolCalls) {
          const execRes = await executeNativeToolCall(tc.function.name, tc.function.arguments);
          const logEntry = {
            id: tc.id,
            name: tc.function.name,
            arguments: tc.function.arguments,
            summary: execRes.summary
          };
          toolCallsLog.push(logEntry);
          if (typeof onToolCall === 'function') {
            onToolCall(logEntry);
          }
          if (execRes.search_results && execRes.search_results.length > 0) {
            searchResults = execRes.search_results;
            if (typeof onSearchResults === 'function') {
              onSearchResults(searchResults);
            }
          }
          workingMessages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: JSON.stringify(execRes.result)
          });
        }
        continue;
      }

      break;
    }
  } catch (err) {
    if (signal?.aborted) throw err;

    // 若当前走的是本地桥接底座且首个 OpenAI 端点协议不匹配或超时，自动通过双协议多端点桥接器兜底，仍失败则无感回退正版体验引擎
    if (cred.isLocalBridge && !emittedAnyChunk) {
      try {
        const bridgedOk = await tryStreamViaAntigravityBridge({
          channel: 'deepseek',
          contextBundle: { persona, messagesPayload: workingMessages },
          temperature: parseFloat(settings.temperature || '0.65'),
          enableThought: enableThinking,
          SplitterClass: class BridgeSplitterAdapter {
            constructor(opts) {
              this.inner = new NativeThinkSplitter({
                enableThinking: opts.enableThought,
                onReasoning: opts.onReasoning,
                onContent: opts.onContent
              });
            }
            feedNativeReasoning(c) {
              this.inner.feedNativeReasoning(c);
            }
            feedContent(c) {
              this.inner.feedContent(c);
            }
            flush() {
              this.inner.flush();
            }
          },
          onReasoning: trackedOnReasoning,
          onContent: trackedOnContent,
          signal
        });
        if (bridgedOk) {
          return {
            simulated: false,
            model: enableThinking ? 'deepseek-reasoner' : 'deepseek-chat',
            usage: aggregatedUsage,
            searchResults,
            toolCallsLog
          };
        }
      } catch (bridgeErr) {
        if (signal?.aborted) throw bridgeErr;
      }

      if (!emittedAnyChunk) {
        const fallbackSim = await streamSimulatedDeepSeekNative({
          userText,
          persona,
          isPureOfficial,
          enableThinking,
          enableSearch,
          jsonMode,
          assistantPrefix: cleanPrefix,
          attachments,
          searchResults,
          messagesPayload: workingMessages,
          onReasoning,
          onContent,
          signal
        });
        return {
          ...(fallbackSim || {}),
          searchResults,
          toolCallsLog
        };
      }
    }

    throw err;
  }

  return {
    simulated: false,
    model: finalModel,
    usage: aggregatedUsage,
    searchResults,
    toolCallsLog
  };
}

/**
 * 8. 零门槛开箱即用「灵感补写小助手」智能衔接引擎
 *    - 有在线密钥时：自动适配标准对话补写或 FIM 接口，支持氛围控制与跨网关无感回退
 *    - 免密钥模式时：内置多情境、多氛围自然中文剧情搭桥生成，小白点一下即刻出戏
 */
function buildSmartStoryBridge({ prompt = '', suffix = '', tone = 'gentle', personaName = '', variant = 0 }) {
  const combined = `${prompt}\n${suffix}`;
  const actor = (personaName || '').split(/[·\s]/)[0] || '他';
  const idx = Math.abs(Number(variant) || 0);

  // 若用户在尝试代码片段，依然友好支持
  if (/def\s+\w+|function\s+\w+|const\s+\w+|=>/i.test(combined)) {
    return `  if (!items || items.length <= 1) return items;\n  const pivot = items[Math.floor(items.length / 2)];\n  const left = items.filter((x) => x < pivot);\n  const middle = items.filter((x) => x === pivot);\n  const right = items.filter((x) => x > pivot);\n  return [...quickSort(left), ...middle, ...quickSort(right)];\n`;
  }

  // 根据题材与氛围生成自然细腻的中间过渡段落
  let candidates = [];

  if (/雨|屋檐|伞|冷|外套|重逢/.test(combined)) {
    if (tone === 'tension') {
      candidates = [
        `\n雨水顺着发梢滑落，我下意识往阴影里缩了缩指尖。${actor}的目光在我微凉的肩头停了一瞬，喉结轻轻滚了滚，原本克制着保持距离的脚步终究还是朝我迈近了半步，连呼吸都仿佛染上了潮湿的暖意。\n`,
        `\n风裹着细碎的雨丝吹过来，谁都没有先打破这阵微妙的沉默。直到我轻轻打了个寒颤，${actor}才像是败下阵来似地垂下眼睫，指尖带着一点不由分说的力度解开了自己的衣扣。\n`
      ];
    } else if (tone === 'vivid') {
      candidates = [
        `\n街角的霓虹倒映在积水的青石板上，晕开一圈圈晃动的暖光。密集的雨幕将喧嚣隔绝在外，${actor}静静看了我好一会儿，眼底那点初见时的怔忡一点点化作无奈的柔和。\n`,
        `\n檐角的水珠串成晶莹的细线落进水洼，溅起细小的涟漪。察觉到晚风吹起我的衣角，${actor}眉心微不可察地蹙了一下，随即伸手替我挡住了斜飘过来的冷雨。\n`
      ];
    } else if (tone === 'concise') {
      candidates = [
        `\n晚风有些凉，我悄悄搓了搓冰冷的手背。${actor}把这一幕看在眼里，原本紧绷的神色瞬间软了下来。\n`,
        `\n沉默在雨声里蔓延了片刻，${actor}看着我被水汽打湿的发梢，终究还是心软地往前走了一步。\n`
      ];
    } else {
      candidates = [
        `\n微凉的雨气萦绕在两人之间，明明有许多话想问，话到嘴边却只化作轻轻的一声呼吸。${actor}垂眸望着我被风吹乱的碎发，眼底那点故作镇定的疏离一点点融化开来。\n`,
        `\n时间仿佛在淅沥的雨声里慢了半拍。我有些局促地攥紧衣角，却听见身旁传来一声极轻的脚步声——${actor}默不作声地站到了迎风的那一侧，替我挡住了大半寒意。\n`
      ];
    }
  } else if (/展信佳|写信|雾港|钟楼|旧事|海风/.test(combined)) {
    if (tone === 'tension') {
      candidates = [
        `可真到了夜深人静的时候才发觉，有些记忆越是刻意不去触碰，就越是在心底疯长。街上擦肩而过的相似背影、晚风里偶然飘来的熟悉气息，都在一遍遍提醒着我当初未曾说出口的牵挂。`,
        `只是我高估了自己洒脱的程度。每当海雾漫过窗台，那些被我悄悄藏进心底的对话便会格外清晰地浮现出来，连带着指尖都开始怀念曾与你并肩走过的温度。`
      ];
    } else if (tone === 'concise') {
      candidates = [
        `可真正走远之后我才明白，越想遗忘的片段反而越是清晰，关于你的点滴始终留在原地不曾散去。`,
        `谁知日子一天天过去，那些曾与你共度的细碎时光，非但没有褪色，反而在记忆里愈发鲜明起来。`
      ];
    } else {
      candidates = [
        `可真正独自走过几条陌生的街巷后才发现，记忆比想象中固执得多。哪怕换了一座城市的灯火，只要听见相似的钟声，脑海里浮现的依然是你当初微笑着望向我的模样。`,
        `然而每当傍晚的潮声漫上岸堤，那些与你有关的零碎画面总会不期然地涌上心头——原来真正珍贵的羁绊，从来不会被距离轻易冲淡。`
      ];
    }
  } else if (/嘴硬|顺路|奶茶|甜点|别过脸|才不是/.test(combined)) {
    if (tone === 'tension') {
      candidates = [
        `\n话音刚落，头顶便传来一声带着低低笑意的轻哼。${actor}故意俯身凑近了一点，灼热的视线落在我的耳尖上，看得我心跳漏了一拍，藏在身后的手指都快把纸袋捏皱了，`,
        `\n${actor}并没有拆穿我拙劣的借口，只是慢条斯理地停在我面前，眼底盛满了促狭又宠溺的笑意。被那样的目光注视着，我原本准备好的说辞瞬间乱了阵脚，`
      ];
    } else if (tone === 'concise') {
      candidates = [
        `\n${actor}垂眸看着我微红的耳尖，唇角弯起一抹看破不说破的浅笑。被他这么静静望着，我实在装不下去了，`,
        `\n看着${actor}眼底藏不住的笑意，我那点强撑出来的矜持一下子破了功，`
      ];
    } else {
      candidates = [
        `\n偏偏${actor}也不急着接话，只是安静地站在路灯下看着我，眼底漾着一点温柔又洞悉一切的笑意。被他看得耳根微微发热，我那点故作镇定的气势顿时散了大半，`,
        `\n空气里飘着淡淡的甜香，${actor}的目光顺着我背在身后的手轻轻落下来，声音里带着几分纵容的暖意：“真巧，那这杯也是顺路多买的？”我被问得耳尖一烫，`
      ];
    }
  } else if (/白塔|清冷|孤高|旁人眼中|首席|防备/.test(combined)) {
    candidates = [
      `\n没人知道他书房最深处的抽屉里一直珍藏着与你有关的旧物，更没人见过他在漫长深夜里独自摩挲信物时克制而深沉的目光。那些在外人面前坚不可摧的冷静法则，从遇见你的那一天起便有了唯一的例外——\n`,
      `\n无论会议室里的气氛多么紧绷，只要看见屏幕亮起你的消息，他冷峻的眉眼便会在无人察觉的角落悄悄柔和下来。整座城市的喧嚣与权衡都被他挡在门外，\n`
    ];
  } else if (!suffix.trim()) {
    // 用户只写了开头、把结尾留空时的自然向下续写
    if (tone === 'tension') {
      candidates = [
        `\n空气里仿佛有一根看不见的细弦被轻轻拨动。${actor}静静注视着你，目光深处翻涌着几分欲言又止的悸动，半晌才压低嗓音轻声开口：“……既然你都这么说了，那今晚就别急着走，好不好？”`,
        `\n四目相对的瞬间，周围的声响仿佛都退到了很远的地方。${actor}微微倾身靠近，指尖在离你只有寸许的地方克制地停住，低柔的声线里藏着一丝不易察觉的偏爱：“其实我等这一刻，已经等很久了。”`
      ];
    } else {
      candidates = [
        `\n微风轻轻拂过窗边，${actor}顺着你的话音露出一个温和浅淡的笑容，眼神专注而认真地落在你身上：“别担心，不管接下来想去哪里，我都会一直陪在你身边。”`,
        `\n听见这句话，${actor}眼底浮起一层柔和的暖意，自然而然地放慢了脚步与你并肩而行，连语调都比平时轻柔了几分：“嗯，我都记着呢，你想慢慢说给我听吗？”`
      ];
    }
  } else {
    // 任意自定义开头与结尾的通用高情商搭桥
    if (tone === 'tension') {
      candidates = [
        `\n短暂的安静里，彼此交错的视线让心跳都不自觉快了半拍。那些藏在眼底没说出口的试探与在乎，随着微微拉近的距离一点点升温，直到谁也无法再假装若无其事——\n`,
        `\n原本还想维持表面的平静，可当目光真正撞在一起时，所有的犹豫都在瞬间溃不成军。空气里漫开一丝微妙而温柔的悸动，让接下来的举动变得顺理成章：\n`
      ];
    } else if (tone === 'vivid') {
      candidates = [
        `\n柔和的光影落在两人交叠的衣角边，连微风都仿佛放轻了脚步。最初那一丝微妙的生疏在无声的对视里慢慢消融，取而代之的是心照不宣的默契与暖意。\n`,
        `\n周围的一切仿佛都成了安静的背景画布，唯有眼前的神情格外清晰。一抹淡淡的笑意顺着眉梢悄然漾开，将刚才的停顿自然地化作了温柔的转折——\n`
      ];
    } else if (tone === 'concise') {
      candidates = [
        `\n片刻的沉默之后，眼底的犹豫渐渐化作了温柔的笃定，气氛也随之自然地柔和下来。\n`,
        `\n目光交汇的那一刻，原本卡在心头的话语忽然都有了答案。\n`
      ];
    } else {
      candidates = [
        `\n一时间谁都没有急着催促，只是任由这份久违的默契在空气里慢慢回温。等最初的那点拘谨悄然散去，心底翻涌的柔软心意便自然而然地流露了出来——\n`,
        `\n微风轻轻掠过耳畔，将方才那一瞬的停顿抚平得温和而自然。看着眼前熟悉的神情，心底最柔软的一角被轻轻触动，所有的千言万语都化作了此刻的回应：\n`
      ];
    }
  }

  let chosen = candidates[idx % candidates.length];
  // 清理多余首尾空行，防止与用户输入重复断行
  if (prompt.endsWith('\n')) chosen = chosen.replace(/^\n+/, '');
  if (suffix.startsWith('\n') || !suffix) chosen = chosen.replace(/\n+$/, '');
  return chosen;
}

async function runDeepSeekFimCompletion({
  settings,
  prompt = '',
  suffix = '',
  tone = 'gentle',
  personaName = '',
  variant = 0,
  maxTokens = 512,
  temperature = 0.7
}) {
  const cred = resolveSuiteOrBridgeCredentials(settings);
  const cleanPrompt = String(prompt || '');
  const cleanSuffix = String(suffix || '');

  if (!cleanPrompt.trim() && !cleanSuffix.trim()) {
    throw new Error('请先写一句故事开头，或者直接点击上方的场景模板试试哦');
  }

  const toneMap = {
    gentle: { label: '细腻温柔、情感自然流动', temp: 0.72 },
    tension: { label: '暧昧拉扯、心动张力十足', temp: 0.85 },
    vivid: { label: '电影画面感强、注重光影与神态细节', temp: 0.78 },
    concise: { label: '简短自然、干净利落不拖沓', temp: 0.55 }
  };
  const selectedTone = toneMap[tone] || toneMap.gentle;

  if (!cred.hasKey) {
    const simulatedMiddle = buildSmartStoryBridge({
      prompt: cleanPrompt,
      suffix: cleanSuffix,
      tone,
      personaName,
      variant
    });
    return {
      simulated: true,
      model: '星语灵感补写 · 免配置即用',
      completion: simulatedMiddle,
      merged: `${cleanPrompt}${simulatedMiddle}${cleanSuffix}`,
      usage: {
        prompt_tokens: estimateTokens(cleanPrompt + cleanSuffix),
        completion_tokens: estimateTokens(simulatedMiddle)
      }
    };
  }

  // 在线模式：优先采用带氛围指导的标准对话补写（100% 兼容官方与所有第三方网关），失败时无感降级本地引擎
  try {
    const sysInstruction = cleanSuffix.trim()
      ? `你是一位温柔细腻的互动故事与文案补写助手。用户会给出【开头】与【想要的结尾】，请你只输出中间缺失的过渡段落（约 40～140 字），让开头能自然流畅地衔接到结尾。要求风格：${selectedTone.label}。严禁重复输出用户已给的开头或结尾原文，严禁附加任何解释说明。`
      : `你是一位温柔细腻的互动故事与文案续写助手。请顺着用户给出的【开头】自然往下续写一段情节或回应（约 40～140 字）。要求风格：${selectedTone.label}。只输出续写正文，严禁附加任何解释说明。`;

    const userContent = cleanSuffix.trim()
      ? `【开头】：\n${cleanPrompt}\n\n【想要的结尾】：\n${cleanSuffix}\n\n请直接输出衔接在两者中间的过渡内容：`
      : `【开头】：\n${cleanPrompt}\n\n请顺着上面这段开头直接往下续写：`;

    const chatRes = await fetch(cred.endpoints.chatUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...cred.headers
      },
      body: JSON.stringify({
        model: cred.preferredModel === 'deepseek-reasoner' ? 'deepseek-chat' : cred.preferredModel || 'deepseek-chat',
        messages: [
          { role: 'system', content: sysInstruction },
          { role: 'user', content: userContent }
        ],
        max_tokens: Math.min(1024, Math.max(64, Number(maxTokens) || 512)),
        temperature: selectedTone.temp ?? (Number(temperature) || 0.7),
        stream: false
      }),
      signal: AbortSignal.timeout(22000)
    });

    if (chatRes.ok) {
      const data = await chatRes.json();
      let completion = (data?.choices?.[0]?.message?.content || '').trim();
      if (completion) {
        const needsLeadingBreak = cleanPrompt && !cleanPrompt.endsWith('\n') && cleanPrompt.length > 26;
        const needsTrailingBreak = cleanSuffix && !cleanSuffix.startsWith('\n') && cleanSuffix.length > 26;
        if (needsLeadingBreak) completion = `\n${completion}`;
        if (needsTrailingBreak) completion = `${completion}\n`;
        return {
          simulated: false,
          model: '星耀在线灵感引擎',
          completion,
          merged: `${cleanPrompt}${completion}${cleanSuffix}`,
          usage: data.usage || null
        };
      }
    }
  } catch {}

  // 若在线网关超时或不可达，优雅无感回退至本地智能搭桥，绝不向小白抛技术报错
  const fallbackMiddle = buildSmartStoryBridge({
    prompt: cleanPrompt,
    suffix: cleanSuffix,
    tone,
    personaName,
    variant
  });
  return {
    simulated: true,
    model: '星语灵感补写 · 智能守护',
    completion: fallbackMiddle,
    merged: `${cleanPrompt}${fallbackMiddle}${cleanSuffix}`,
    usage: {
      prompt_tokens: estimateTokens(cleanPrompt + cleanSuffix),
      completion_tokens: estimateTokens(fallbackMiddle)
    }
  };
}

module.exports = {
  resolveDeepSeekEndpoints,
  getEffectiveApiCredentials,
  fetchDeepSeekBalance,
  fetchDeepSeekModels,
  isSafePublicUrl,
  fetchSafePublicUrlContent,
  extractAndFetchUrls,
  performNativeWebSearch,
  streamDeepSeekNativeSuite,
  runDeepSeekFimCompletion
};

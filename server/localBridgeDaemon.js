/**
 * 本机双引擎桥接网关 (127.0.0.1:18765)
 * 供云端服务器通过加密 SSH 反向隧道直连本机 Antigravity (agy.exe) 与 Google Gemini CLI。
 *
 * 严格安全约束：
 * - 仅监听 127.0.0.1，不暴露公网端口
 * - /v1/models 与 /v1/chat/completions 强制校验 Authorization: Bearer <token>
 * - 绝不硬编码或打印密钥
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn, execFileSync } = require('node:child_process');
const { getLocalAntigravityCliPath } = require('./antigravityBridge');
const { NativeThinkSplitter } = require('./deepseekApiSuite');

const SECRET_PATH = path.join(__dirname, '..', 'data', 'bridge_tunnel.secret.json');
let activeRequests = 0;

function readBridgeSecretConfig() {
  try {
    if (!fs.existsSync(SECRET_PATH)) return {};
    const raw = fs.readFileSync(SECRET_PATH, 'utf8').replace(/^\uFEFF/, '');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function getGeminiCliEntry() {
  const appData = process.env.APPDATA || '';
  const candidates = [
    appData ? path.join(appData, 'npm', 'node_modules', '@google', 'gemini-cli', 'bundle', 'gemini.js') : '',
    appData ? path.join(appData, 'npm', 'node_modules', '@google', 'gemini-cli', 'dist', 'index.js') : ''
  ].filter(Boolean);

  for (const p of candidates) {
    if (fs.existsSync(p)) {
      return { type: 'node', entry: p };
    }
  }

  if (process.platform === 'win32') {
    try {
      const out = execFileSync('where.exe', ['gemini'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 3000
      }).trim();
      const firstLine = out.split(/\r?\n/)[0]?.trim();
      if (firstLine) {
        const dir = path.dirname(firstLine);
        const bundleJs = path.join(dir, 'node_modules', '@google', 'gemini-cli', 'bundle', 'gemini.js');
        if (fs.existsSync(bundleJs)) return { type: 'node', entry: bundleJs };
        const cmdPath = firstLine.endsWith('.cmd') ? firstLine : `${firstLine}.cmd`;
        if (fs.existsSync(cmdPath)) return { type: 'bin', entry: cmdPath };
      }
    } catch {}
  } else {
    try {
      const out = execFileSync('which', ['gemini'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 3000
      }).trim();
      const firstLine = out.split(/\r?\n/)[0]?.trim();
      if (firstLine && fs.existsSync(firstLine)) return { type: 'bin', entry: firstLine };
    } catch {}
  }

  return null;
}

function extractMessageText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const parts = [];
    for (const part of content) {
      if (!part) continue;
      if (typeof part === 'string') {
        parts.push(part);
      } else if (part.type === 'text' && typeof part.text === 'string') {
        parts.push(part.text);
      } else if (part.type === 'image_url') {
        parts.push('[用户发送了一张图片]');
      }
    }
    return parts.join('\n').trim();
  }
  return String(content || '');
}

function assembleBridgePrompt(messages = [], enableThinking = true) {
  const systemParts = [];
  const historyParts = [];

  for (const m of messages) {
    if (!m) continue;
    const txt = extractMessageText(m.content);
    if (!txt) continue;
    if (m.role === 'system') {
      systemParts.push(txt);
    } else if (m.role === 'user') {
      historyParts.push(`用户：${txt}`);
    } else if (m.role === 'assistant') {
      historyParts.push(`助手：${txt}`);
    }
  }

  const systemText = systemParts.join('\n\n');
  const alreadyHasThinkTag = /<(?:thought|think)>/i.test(systemText);
  const thinkingGuide = enableThinking && !alreadyHasThinkTag
    ? '\n\n【思考与输出规范】：请先在回答最开头使用 `<thought>...</thought>` 标签输出简练清晰的第一人称纯中文内心思考，随后在 `</thought>` 后输出正式中文回复。'
    : '';

  return (
    (systemText ? `【系统指令与人设背景】：\n${systemText}\n\n` : '') +
    (historyParts.length > 0 ? `【对话历史与最新消息】：\n${historyParts.join('\n\n')}\n\n` : '') +
    `请直接针对最新消息继续回复：` +
    thinkingGuide
  );
}

function killProcessTree(child) {
  if (!child || child.killed || !child.pid) return;
  if (process.platform === 'win32') {
    try {
      execFileSync('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], {
        stdio: 'ignore',
        timeout: 3000
      });
    } catch {
      try { child.kill(); } catch {}
    }
  } else {
    try { child.kill('SIGTERM'); } catch {}
  }
}

function runAgyEngine({ prompt, model, enableThinking, onReasoning, onContent, signal, onChildSpawned }) {
  return new Promise((resolve, reject) => {
    const cliPath = getLocalAntigravityCliPath();
    if (!cliPath) {
      return reject(new Error('未检测到本机 Antigravity (agy.exe)'));
    }

    const isolatedCwd = path.join(os.tmpdir(), 'star-whisper-agy-cwd');
    fs.mkdirSync(isolatedCwd, { recursive: true });

    const splitter = new NativeThinkSplitter({
      onReasoning: enableThinking ? onReasoning : () => {},
      onContent,
      enableThinking
    });

    const args = [
      '--output-format=stream-json',
      '--disable-slash-commands',
      `--model=${model || 'gemini-3.8-flash-low'}`,
      '--print-timeout=120s',
      '--dangerously-skip-permissions',
      `--print=${prompt}`
    ];

    const child = spawn(cliPath, args, {
      cwd: isolatedCwd,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    if (onChildSpawned) onChildSpawned(child);

    let resolved = false;
    let lineBuffer = '';
    let emittedAny = false;
    let stderrBuf = '';

    const onAbort = () => {
      killProcessTree(child);
      if (!resolved) {
        resolved = true;
        reject(new Error('请求已中断'));
      }
    };
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });

    child.stdout.on('data', (chunk) => {
      lineBuffer += chunk.toString('utf8');
      const lines = lineBuffer.split(/\r?\n/);
      lineBuffer = lines.pop() || '';
      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;
        try {
          const evt = JSON.parse(line);
          if (evt.event === 'step_update' && evt.step_update?.text_delta) {
            emittedAny = true;
            splitter.feedContent(evt.step_update.text_delta);
          } else if (evt.event === 'result' && evt.result?.response && !emittedAny) {
            emittedAny = true;
            splitter.feedContent(evt.result.response);
          }
        } catch {}
      }
    });

    child.stderr.on('data', (d) => {
      stderrBuf += d.toString('utf8');
    });

    child.on('error', (err) => {
      signal?.removeEventListener('abort', onAbort);
      if (!resolved) {
        resolved = true;
        reject(err);
      }
    });

    child.on('close', (code) => {
      signal?.removeEventListener('abort', onAbort);
      if (lineBuffer.trim()) {
        try {
          const evt = JSON.parse(lineBuffer.trim());
          if (evt.event === 'result' && evt.result?.response && !emittedAny) {
            emittedAny = true;
            splitter.feedContent(evt.result.response);
          }
        } catch {}
      }
      splitter.flush();
      if (resolved) return;
      resolved = true;
      if (!emittedAny) {
        reject(new Error(`agy 未输出内容 (code=${code}): ${stderrBuf.trim().slice(0, 200)}`));
      } else {
        resolve({ engine: 'agy', model: model || 'gemini-3.8-flash-low' });
      }
    });
  });
}

function runGeminiCliEngine({ prompt, model, enableThinking, onReasoning, onContent, signal, onChildSpawned }) {
  return new Promise((resolve, reject) => {
    const geminiBin = getGeminiCliEntry();
    if (!geminiBin) {
      return reject(new Error('未检测到本机 @google/gemini-cli'));
    }

    const isolatedCwd = path.join(os.tmpdir(), 'star-whisper-gemini-cwd');
    fs.mkdirSync(isolatedCwd, { recursive: true });

    const splitter = new NativeThinkSplitter({
      onReasoning: enableThinking ? onReasoning : () => {},
      onContent,
      enableThinking
    });

    const cliArgs = [
      '--skip-trust',
      '--output-format', 'stream-json',
      '--model', model || 'gemini-2.5-flash',
      '-p', '请严格依据标准输入(stdin)中的上下文进行回复。'
    ];

    const spawnCmd = geminiBin.type === 'node' ? process.execPath : geminiBin.entry;
    const spawnArgs = geminiBin.type === 'node' ? [geminiBin.entry, ...cliArgs] : cliArgs;

    const child = spawn(spawnCmd, spawnArgs, {
      cwd: isolatedCwd,
      windowsHide: true,
      env: { ...process.env, GEMINI_CLI_TRUST_WORKSPACE: 'true' },
      shell: geminiBin.type === 'bin' && process.platform === 'win32',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    if (onChildSpawned) onChildSpawned(child);

    let resolved = false;
    let lineBuffer = '';
    let emittedAny = false;
    let stderrBuf = '';

    const onAbort = () => {
      killProcessTree(child);
      if (!resolved) {
        resolved = true;
        reject(new Error('请求已中断'));
      }
    };
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });

    try {
      child.stdin.write(prompt, 'utf8');
      child.stdin.end();
    } catch {}

    const handleJsonEvent = (evt) => {
      if (!evt || typeof evt !== 'object') return;
      if (evt.type === 'message' && evt.role === 'assistant' && evt.content) {
        const chunkText = typeof evt.content === 'string' ? evt.content : extractMessageText(evt.content);
        if (chunkText) {
          emittedAny = true;
          splitter.feedContent(chunkText);
        }
      } else if (evt.type === 'result' && evt.response && !emittedAny) {
        emittedAny = true;
        splitter.feedContent(String(evt.response));
      } else if (evt.type === 'error' && evt.message) {
        stderrBuf += `\n${evt.message}`;
      }
    };

    child.stdout.on('data', (chunk) => {
      lineBuffer += chunk.toString('utf8');
      const lines = lineBuffer.split(/\r?\n/);
      lineBuffer = lines.pop() || '';
      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;
        try {
          handleJsonEvent(JSON.parse(line));
        } catch {}
      }
    });

    child.stderr.on('data', (d) => {
      stderrBuf += d.toString('utf8');
    });

    child.on('error', (err) => {
      signal?.removeEventListener('abort', onAbort);
      if (!resolved) {
        resolved = true;
        reject(err);
      }
    });

    child.on('close', (code) => {
      signal?.removeEventListener('abort', onAbort);
      if (lineBuffer.trim()) {
        try {
          handleJsonEvent(JSON.parse(lineBuffer.trim()));
        } catch {}
      }
      splitter.flush();
      if (resolved) return;
      resolved = true;
      if (!emittedAny) {
        const errLower = stderrBuf.toLowerCase();
        if (/auth|login|credentials|oauth|sign in|unauthorized/.test(errLower)) {
          const authMsg = 'Gemini CLI 尚未登录 Google 账号，请在终端执行 gemini 完成一次授权登录';
          console.warn(`[本地桥接] ${authMsg}`);
          return reject(new Error(authMsg));
        }
        reject(new Error(`gemini 未输出内容 (code=${code}): ${stderrBuf.trim().slice(0, 200)}`));
      } else {
        resolve({ engine: 'gemini', model: model || 'gemini-2.5-flash' });
      }
    });
  });
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function checkBearerAuth(req, expectedToken) {
  if (!expectedToken) return false;
  const auth = String(req.headers.authorization || '').trim();
  if (!auth.startsWith('Bearer ')) return false;
  return auth.slice(7).trim() === expectedToken;
}

const server = http.createServer(async (req, res) => {
  const cfg = readBridgeSecretConfig();
  const urlPath = (req.url || '/').split('?')[0];

  if (req.method === 'GET' && urlPath === '/health') {
    const agyPath = getLocalAntigravityCliPath();
    const geminiEntry = getGeminiCliEntry();
    return sendJson(res, 200, {
      ok: true,
      primaryEngine: cfg.primaryEngine || 'agy',
      fallbackEngine: cfg.fallbackEngine || 'gemini',
      engines: {
        agy: { available: Boolean(agyPath), path: agyPath || null },
        gemini: { available: Boolean(geminiEntry), path: geminiEntry ? geminiEntry.entry : null }
      },
      activeRequests
    });
  }

  if (!checkBearerAuth(req, cfg.token)) {
    return sendJson(res, 401, { error: { message: 'Unauthorized: invalid bridge token' } });
  }

  if (req.method === 'GET' && urlPath === '/v1/models') {
    return sendJson(res, 200, {
      object: 'list',
      data: [
        { id: 'agy-auto', object: 'model', owned_by: 'local-bridge' },
        { id: 'agy', object: 'model', owned_by: 'local-antigravity' },
        { id: 'gemini-cli', object: 'model', owned_by: 'google-gemini-cli' }
      ]
    });
  }

  if (req.method === 'POST' && urlPath === '/v1/chat/completions') {
    let body;
    try {
      body = await readJsonBody(req);
    } catch {
      return sendJson(res, 400, { error: { message: 'Invalid JSON body' } });
    }

    const reqStart = Date.now();
    let firstTokenMs = null;
    activeRequests += 1;

    const reqModel = String(body.model || '').trim().toLowerCase();
    const headerEngine = String(req.headers['x-bridge-engine'] || '').trim().toLowerCase();
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const enableThinking = body.reasoning_effort !== 'none';
    const prompt = assembleBridgePrompt(messages, enableThinking);

    const primary = cfg.primaryEngine === 'gemini' ? 'gemini' : 'agy';
    const fallback = primary === 'agy' ? 'gemini' : 'agy';
    let order = [primary, fallback];
    if (reqModel === 'gemini-cli' || headerEngine === 'gemini') {
      order = ['gemini', 'agy'];
    } else if (reqModel === 'agy' || headerEngine === 'agy') {
      order = ['agy', 'gemini'];
    }

    const agyAvailable = Boolean(getLocalAntigravityCliPath());
    const geminiAvailable = Boolean(getGeminiCliEntry());
    order = order.filter((e) => (e === 'agy' ? agyAvailable : geminiAvailable));

    if (order.length === 0) {
      activeRequests = Math.max(0, activeRequests - 1);
      return sendJson(res, 503, { error: { message: '本机无可用的 Antigravity 或 Gemini CLI 引擎' } });
    }

    const abortController = new AbortController();
    let currentChild = null;
    req.on('close', () => {
      if (!res.writableEnded) {
        abortController.abort();
        killProcessTree(currentChild);
      }
    });

    const isStream = body.stream !== false;
    const chatId = `chatcmpl-bridge-${Date.now()}`;
    const createdSec = Math.floor(Date.now() / 1000);
    let headersSent = false;
    let keepAliveTimer = null;
    let fullReasoning = '';
    let fullContent = '';

    const ensureStreamHeaders = (engineName) => {
      if (headersSent || !isStream) return;
      headersSent = true;
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Bridge-Used-Engine': engineName
      });
      keepAliveTimer = setInterval(() => {
        if (!res.writableEnded) {
          try { res.write(': keepalive\n\n'); } catch {}
        }
      }, 3000);
    };

    const writeChunk = (deltaObj) => {
      if (!isStream || res.writableEnded) return;
      const payload = {
        id: chatId,
        object: 'chat.completion.chunk',
        created: createdSec,
        model: body.model || 'agy-auto',
        choices: [{ index: 0, delta: deltaObj, finish_reason: null }]
      };
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    let usedEngine = null;
    let lastError = null;

    try {
      for (const eng of order) {
        if (abortController.signal.aborted) break;
        let hasEmittedThisEngine = false;
        const onReasoning = (delta) => {
          if (!delta) return;
          if (firstTokenMs === null) firstTokenMs = Date.now() - reqStart;
          hasEmittedThisEngine = true;
          ensureStreamHeaders(eng);
          fullReasoning += delta;
          writeChunk({ reasoning_content: delta });
        };
        const onContent = (delta) => {
          if (!delta) return;
          if (firstTokenMs === null) firstTokenMs = Date.now() - reqStart;
          hasEmittedThisEngine = true;
          ensureStreamHeaders(eng);
          fullContent += delta;
          writeChunk({ content: delta });
        };

        try {
          if (eng === 'agy') {
            await runAgyEngine({
              prompt,
              model: cfg.agyModel || 'gemini-3.8-flash-low',
              enableThinking,
              onReasoning,
              onContent,
              signal: abortController.signal,
              onChildSpawned: (c) => { currentChild = c; }
            });
          } else {
            await runGeminiCliEngine({
              prompt,
              model: cfg.geminiModel || 'gemini-2.5-flash',
              enableThinking,
              onReasoning,
              onContent,
              signal: abortController.signal,
              onChildSpawned: (c) => { currentChild = c; }
            });
          }
          usedEngine = eng;
          break;
        } catch (err) {
          lastError = err;
          if (abortController.signal.aborted || hasEmittedThisEngine) {
            throw err;
          }
          console.warn(`[本地桥接] 引擎 ${eng} 失败，尝试回退下一引擎: ${err.message}`);
        }
      }

      if (!usedEngine) {
        throw lastError || new Error('所有本地引擎均未返回有效内容');
      }

      const totalMs = Date.now() - reqStart;
      console.log(`[本地桥接] 收到请求 -> 引擎=${usedEngine} 耗时=${totalMs}ms 首字=${firstTokenMs ?? totalMs}ms 状态=成功`);

      if (isStream) {
        ensureStreamHeaders(usedEngine);
        const stopPayload = {
          id: chatId,
          object: 'chat.completion.chunk',
          created: createdSec,
          model: body.model || 'agy-auto',
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }]
        };
        if (!res.writableEnded) {
          res.write(`data: ${JSON.stringify(stopPayload)}\n\n`);
          res.write('data: [DONE]\n\n');
          res.end();
        }
      } else {
        sendJson(res, 200, {
          id: chatId,
          object: 'chat.completion',
          created: createdSec,
          model: body.model || 'agy-auto',
          choices: [{
            index: 0,
            message: {
              role: 'assistant',
              content: fullContent,
              ...(fullReasoning ? { reasoning_content: fullReasoning } : {})
            },
            finish_reason: 'stop'
          }]
        });
      }
    } catch (err) {
      const totalMs = Date.now() - reqStart;
      console.error(`[本地桥接] 请求失败 耗时=${totalMs}ms 原因=${err.message}`);
      if (!headersSent && !res.writableEnded) {
        sendJson(res, 502, { error: { message: err.message || '本地桥接执行失败' } });
      } else if (!res.writableEnded) {
        res.end();
      }
    } finally {
      if (keepAliveTimer) clearInterval(keepAliveTimer);
      activeRequests = Math.max(0, activeRequests - 1);
    }
    return;
  }

  return sendJson(res, 404, { error: { message: 'Not Found' } });
});

const cfgInit = readBridgeSecretConfig();
const LISTEN_PORT = Number(cfgInit.port) || 18765;
server.listen(LISTEN_PORT, '127.0.0.1', () => {
  console.log(`[本地桥接] 双引擎网关已启动: http://127.0.0.1:${LISTEN_PORT}`);
});

/**
 * 本机 Antigravity 桥接网关 (127.0.0.1:18765)
 * 供云端服务器通过加密 SSH 反向隧道直连本机 Antigravity (agy.exe)。
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
    return sendJson(res, 200, {
      ok: true,
      engine: 'agy',
      available: Boolean(agyPath),
      path: agyPath || null,
      model: cfg.agyModel || 'gemini-3.8-flash-low',
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
        { id: 'agy-auto', object: 'model', owned_by: 'local-antigravity' },
        { id: 'agy', object: 'model', owned_by: 'local-antigravity' }
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

    const messages = Array.isArray(body.messages) ? body.messages : [];
    const enableThinking = body.reasoning_effort !== 'none';
    const prompt = assembleBridgePrompt(messages, enableThinking);

    if (!getLocalAntigravityCliPath()) {
      activeRequests = Math.max(0, activeRequests - 1);
      return sendJson(res, 503, { error: { message: '本机未检测到 Antigravity (agy.exe)' } });
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

    const ensureStreamHeaders = () => {
      if (headersSent || !isStream) return;
      headersSent = true;
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Bridge-Used-Engine': 'agy'
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

    try {
      await runAgyEngine({
        prompt,
        model: cfg.agyModel || 'gemini-3.8-flash-low',
        enableThinking,
        onReasoning: (delta) => {
          if (!delta) return;
          if (firstTokenMs === null) firstTokenMs = Date.now() - reqStart;
          ensureStreamHeaders();
          fullReasoning += delta;
          writeChunk({ reasoning_content: delta });
        },
        onContent: (delta) => {
          if (!delta) return;
          if (firstTokenMs === null) firstTokenMs = Date.now() - reqStart;
          ensureStreamHeaders();
          fullContent += delta;
          writeChunk({ content: delta });
        },
        signal: abortController.signal,
        onChildSpawned: (c) => { currentChild = c; }
      });

      const totalMs = Date.now() - reqStart;
      console.log(`[本地桥接] 收到请求 -> 引擎=agy 耗时=${totalMs}ms 首字=${firstTokenMs ?? totalMs}ms 状态=成功`);

      if (isStream) {
        ensureStreamHeaders();
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
  console.log(`[本地桥接] Antigravity 网关已启动: http://127.0.0.1:${LISTEN_PORT}`);
});

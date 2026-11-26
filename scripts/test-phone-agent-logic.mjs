import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const SOURCE_PATH = path.join(ROOT, 'public', 'phoneAgent.js');

// ========= 轻量可观测 Mock DOM / WebView 环境 =========
class MockClassList {
  constructor(el) {
    this.el = el;
    this.set = new Set();
  }
  _syncFromStr(str) {
    this.set = new Set(String(str || '').split(/\s+/).filter(Boolean));
  }
  _syncToStr() {
    this.el._className = Array.from(this.set).join(' ');
  }
  add(...names) {
    for (const n of names) if (n) this.set.add(n);
    this._syncToStr();
  }
  remove(...names) {
    for (const n of names) this.set.delete(n);
    this._syncToStr();
  }
  toggle(name, force) {
    if (force === true) this.set.add(name);
    else if (force === false) this.set.delete(name);
    else if (this.set.has(name)) this.set.delete(name);
    else this.set.add(name);
    this._syncToStr();
    return this.set.has(name);
  }
  contains(name) {
    return this.set.has(name);
  }
}

class MockElement {
  constructor(tagName = 'div', doc = null) {
    this.tagName = String(tagName || 'div').toUpperCase();
    this.ownerDocument = doc;
    this._id = '';
    this._className = '';
    this.classList = new MockClassList(this);
    this.children = [];
    this.parentNode = null;
    this.attributes = new Map();
    this.dataset = {};
    this.style = {};
    this.listeners = new Map();
    this._innerHTML = '';
    this.textContent = '';
    this.value = '';
    this.checked = false;
    this.disabled = false;
    this.scrollTop = 0;
    this.scrollHeight = 100;
    this.offsetParent = {};
  }
  get id() {
    return this._id;
  }
  set id(v) {
    this._id = String(v || '');
    if (this.ownerDocument && this._id) {
      this.ownerDocument._idMap.set(this._id, this);
    }
  }
  get className() {
    return this._className;
  }
  set className(v) {
    this._className = String(v || '');
    this.classList._syncFromStr(this._className);
  }
  get innerHTML() {
    return this._innerHTML;
  }
  get options() {
    return this.children.filter((c) => c.tagName === 'OPTION');
  }
  set innerHTML(html) {
    this._innerHTML = String(html || '');
    this.children = [];
    if (this.ownerDocument) {
      this._hydrateQuickHtml(this._innerHTML);
    }
  }
  // 解析测试交互需要的按钮/输入框/带 id/class/data-* 的关键节点
  _hydrateQuickHtml(html) {
    const tagRe = /<(button|input|div|span|ol)\b([^>]*)>([\s\S]*?)<\/\1>|<input\b([^>]*)\/?>/gi;
    let m;
    while ((m = tagRe.exec(html)) !== null) {
      const tag = (m[1] || 'input').toLowerCase();
      const attrStr = m[2] || m[4] || '';
      const inner = m[3] || '';
      const child = new MockElement(tag, this.ownerDocument);
      const idM = attrStr.match(/\bid="([^"]*)"/i);
      if (idM) child.id = idM[1];
      const clsM = attrStr.match(/\bclass="([^"]*)"/i);
      if (clsM) child.className = clsM[1];
      const attrRe = /\b(data-[a-z0-9-]+)="([^"]*)"/gi;
      let am;
      while ((am = attrRe.exec(attrStr)) !== null) {
        child.setAttribute(am[1], am[2]);
      }
      child.textContent = inner.replace(/<[^>]+>/g, '').trim();
      child._innerHTML = inner;
      this.appendChild(child);
      if (inner && /<(?:button|input|div|span|ol)\b/i.test(inner)) {
        child._hydrateQuickHtml(inner);
      }
    }
  }
  setAttribute(k, v) {
    this.attributes.set(k, String(v));
    if (k === 'id') this.id = v;
    if (k === 'class') this.className = v;
    if (k.startsWith('data-')) {
      const camel = k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      this.dataset[camel] = String(v);
    }
  }
  getAttribute(k) {
    if (k === 'id') return this._id;
    if (k === 'class') return this._className;
    return this.attributes.has(k) ? this.attributes.get(k) : null;
  }
  get firstChild() {
    return this.children[0] || null;
  }
  insertBefore(el, ref) {
    el.parentNode = this;
    const idx = ref ? this.children.indexOf(ref) : -1;
    if (idx >= 0) this.children.splice(idx, 0, el);
    else this.children.push(el);
    if (this.ownerDocument && el._id) {
      this.ownerDocument._idMap.set(el._id, el);
    }
    return el;
  }
  appendChild(el) {
    el.parentNode = this;
    this.children.push(el);
    if (this.ownerDocument && el._id) {
      this.ownerDocument._idMap.set(el._id, el);
    }
    return el;
  }
  remove() {
    if (this.parentNode) {
      this.parentNode.children = this.parentNode.children.filter((c) => c !== this);
      this.parentNode = null;
    }
    if (this.ownerDocument && this._id && this.ownerDocument._idMap.get(this._id) === this) {
      this.ownerDocument._idMap.delete(this._id);
    }
    for (const ch of [...this.children]) ch.remove();
  }
  addEventListener(ev, fn) {
    if (!this.listeners.has(ev)) this.listeners.set(ev, []);
    this.listeners.get(ev).push(fn);
  }
  removeEventListener(ev, fn) {
    if (!this.listeners.has(ev)) return;
    this.listeners.set(ev, this.listeners.get(ev).filter((f) => f !== fn));
  }
  dispatchEvent(evObj) {
    const ev = evObj || { type: 'event' };
    if (!ev.currentTarget) ev.currentTarget = this;
    if (!ev.target) ev.target = this;
    ev.preventDefault = ev.preventDefault || (() => {});
    ev.stopPropagation = ev.stopPropagation || (() => {});
    const list = this.listeners.get(ev.type) || [];
    for (const fn of [...list]) fn(ev);
  }
  click() {
    if (typeof this.onclick === 'function') this.onclick({ currentTarget: this, target: this });
    this.dispatchEvent({ type: 'click', currentTarget: this, target: this });
  }
  focus() {}
  matches() { return false; }
  _matchSelector(sel) {
    const s = String(sel || '').trim();
    if (!s) return false;
    if (s.startsWith('#')) return this._id === s.slice(1);
    if (s.startsWith('.')) {
      const clsPart = s.split(':')[0].slice(1);
      return this.classList.contains(clsPart);
    }
    const attrM = s.match(/^\[([a-z0-9-]+)="([^"]*)"\]$/i);
    if (attrM) return this.getAttribute(attrM[1]) === attrM[2];
    const btnAttrM = s.match(/^button\[data-decision\]$/i);
    if (btnAttrM) return this.tagName === 'BUTTON' && this.attributes.has('data-decision');
    return this.tagName.toLowerCase() === s.toLowerCase();
  }
  querySelectorAll(sel) {
    const out = [];
    const walk = (node) => {
      for (const ch of node.children) {
        if (ch._matchSelector(sel)) out.push(ch);
        walk(ch);
      }
    };
    walk(this);
    return out;
  }
  querySelector(sel) {
    return this.querySelectorAll(sel)[0] || null;
  }
}

function createHarness(options = {}) {
  const doc = {
    readyState: 'complete',
    _idMap: new Map(),
    listeners: new Map(),
    body: null,
    createElement(tag) {
      return new MockElement(tag, doc);
    },
    getElementById(id) {
      const direct = doc._idMap.get(id);
      if (direct) return direct;
      return doc.body.querySelector(`#${id}`);
    },
    querySelectorAll(sel) {
      return doc.body.querySelectorAll(sel);
    },
    querySelector(sel) {
      return doc.body.querySelector(sel);
    },
    addEventListener(ev, fn) {
      if (!doc.listeners.has(ev)) doc.listeners.set(ev, []);
      doc.listeners.get(ev).push(fn);
    }
  };
  doc.body = new MockElement('body', doc);
  doc.documentElement = new MockElement('html', doc);

  const appShell = doc.createElement('div');
  appShell.id = 'app-shell';
  appShell.dataset.uiMode = 'phone-agent';
  doc.body.appendChild(appShell);

  const msgContainer = doc.createElement('div');
  msgContainer.id = 'messages-container';
  doc.body.appendChild(msgContainer);

  const toastEl = doc.createElement('div');
  toastEl.id = 'memory-toast';
  doc.body.appendChild(toastEl);

  const chatInput = doc.createElement('input');
  chatInput.id = 'chat-input';
  doc.body.appendChild(chatInput);

  if (options.withModePanel) {
    const inlineDrawer = doc.createElement('div');
    inlineDrawer.id = 'pa-inline-config-drawer';
    const cfgModel = doc.createElement('input');
    cfgModel.id = 'pa-cfg-model';
    cfgModel.value = 'deepseek-v4.1-flash';
    inlineDrawer.appendChild(cfgModel);
    doc.body.appendChild(inlineDrawer);

    const cloudBox = doc.createElement('div');
    cloudBox.id = 'pa-cloud-model-box';
    cloudBox.classList.add('hidden');
    const cloudSel = doc.createElement('select');
    cloudSel.id = 'pa-cloud-model-select';
    const optDefault = doc.createElement('option');
    optDefault.value = '';
    optDefault.textContent = '云端智能默认（自动拉取适配）';
    const optGemini = doc.createElement('option');
    optGemini.value = 'gemini-2.5-flash';
    optGemini.textContent = 'Google Gemini 2.5 Flash';
    cloudSel.appendChild(optDefault);
    cloudSel.appendChild(optGemini);
    cloudBox.appendChild(cloudSel);
    doc.body.appendChild(cloudBox);

    const localCard = doc.createElement('div');
    localCard.id = 'pa-local-peace-card';
    localCard.classList.add('hidden');
    doc.body.appendChild(localCard);
  }

  const storage = new Map(Object.entries(options.initialStorage || {}));
  const localStorageMock = {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: (k) => storage.delete(k)
  };

  // 默认模拟真机状态
  const nativeState = {
    isNative: true,
    a11yEnabled: true,
    overlayPermission: true,
    floatRunning: false,
    packageName: 'com.target.app',
    appName: '目标应用',
    signature: 'sig_page_1',
    eventSeq: 1,
    nodes: [
      { ref: 'e1', text: '去结算', cls: 'Button', clickable: true, center: [540, 1200] },
      { ref: 'e2', text: '搜索框', cls: 'EditText', clickable: true, editable: true, center: [540, 300] }
    ],
    actionsLog: [],
    nextClickOk: true,
    onClickHook: null,
    onGlobalActionHook: null
  };

  const bridge = {
    isNativeApk: () => nativeState.isNative,
    isAccessibilityEnabled: () => nativeState.a11yEnabled,
    hasOverlayPermission: () => nativeState.overlayPermission,
    requestOverlayPermission: () => {
      nativeState.actionsLog.push('requestOverlayPermission');
    },
    openAccessibilitySettings: () => {
      nativeState.actionsLog.push('openAccessibilitySettings');
    },
    isFloatAgentRunning: () => nativeState.floatRunning,
    startFloatAgent: () => {
      nativeState.floatRunning = true;
      nativeState.actionsLog.push('startFloatAgent');
      return true;
    },
    stopFloatAgent: () => {
      nativeState.floatRunning = false;
      return true;
    },
    isAutoSwipeRunning: () => false,
    getInstalledVersionInfo: () => JSON.stringify({ versionName: '2.7.5', versionCode: 166 }),
    getScreenSize: () => JSON.stringify({ width: 1080, height: 2400 }),
    getInstalledApps: () => JSON.stringify([{ name: '微信' }, { name: '美团' }]),
    getLastExternalApp: () => JSON.stringify({ packageName: 'com.study.app', appName: '学习通' }),
    returnToLastExternalApp: () => {
      nativeState.actionsLog.push('returnToLastExternalApp');
      nativeState.packageName = 'com.study.app';
      nativeState.appName = '学习通';
      return true;
    },
    dispatchGlobalAction: (key) => {
      nativeState.actionsLog.push(`global:${key}`);
      if (typeof nativeState.onGlobalActionHook === 'function') {
        nativeState.onGlobalActionHook(key, nativeState);
      }
      return true;
    },
    dumpScreenSnapshot: () => JSON.stringify({
      snapshotId: `snap_${nativeState.eventSeq}`,
      packageName: nativeState.packageName,
      appName: nativeState.appName,
      signature: nativeState.signature,
      eventSeq: nativeState.eventSeq,
      hasSensitiveField: false,
      nodes: nativeState.nodes
    }),
    getScreenMeta: () => JSON.stringify({
      ok: true,
      packageName: nativeState.packageName,
      appName: nativeState.appName,
      signature: nativeState.signature
    }),
    getScreenEventSeq: () => JSON.stringify({ seq: nativeState.eventSeq, pkg: nativeState.packageName, ts: Date.now() }),
    clickByRef: (snapId, ref) => {
      nativeState.actionsLog.push(`clickByRef:${ref}`);
      if (typeof nativeState.onClickHook === 'function') {
        return JSON.stringify(nativeState.onClickHook(ref, nativeState));
      }
      return JSON.stringify({ ok: nativeState.nextClickOk, method: 'node', x: 540, y: 1200, message: nativeState.nextClickOk ? `已点击 ${ref}` : '点击失败' });
    },
    clickByRefGesture: (snapId, ref) => {
      nativeState.actionsLog.push(`clickByRefGesture:${ref}`);
      if (typeof nativeState.onClickHook === 'function') {
        return JSON.stringify(nativeState.onClickHook(ref, nativeState));
      }
      return JSON.stringify({ ok: nativeState.nextClickOk, method: 'gesture', x: 540, y: 1200 });
    },
    dispatchClick: (x, y) => {
      nativeState.actionsLog.push(`dispatchClick:${x},${y}`);
      if (typeof nativeState.onClickHook === 'function') {
        const r = nativeState.onClickHook(`xy:${x},${y}`, nativeState);
        return Boolean(r?.ok);
      }
      return nativeState.nextClickOk;
    },
    dispatchSwipe: () => true,
    scrollScreen: () => true,
    launchAppByName: (app) => {
      nativeState.actionsLog.push(`launchApp:${app}`);
      nativeState.packageName = `com.${app}`;
      nativeState.appName = app;
      nativeState.eventSeq += 1;
      nativeState.signature = `sig_${app}`;
      return true;
    },
    executeLocalRule: () => 'UNMATCHED:not_local',
    resetEmergencyStop: () => {},
    isEmergencyStopRequested: () => false,
    updateFloatState: () => {},
    setEdgeGlowEnabled: () => {},
    setAgentForegroundActive: () => {},
    showToast: () => {}
  };

  let fetchHandler = async () => ({ ok: true, status: 200, json: async () => ({ ok: true, plan: { tool: 'done', summary: '完成', reply: '完成' } }) });

  const win = {
    document: doc,
    localStorage: localStorageMock,
    AndroidAppBridge: bridge,
    location: { origin: 'http://127.0.0.1:3000' },
    navigator: {},
    Event: class { constructor(type) { this.type = type; } },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    AbortController,
    fetch: (...args) => fetchHandler(...args),
    addEventListener: () => {}
  };
  win.window = win;

  const code = fs.readFileSync(SOURCE_PATH, 'utf8');
  vm.createContext(win);
  vm.runInContext(code, win);

  return {
    win,
    doc,
    localStorageMock,
    nativeState,
    setFetchHandler(fn) { fetchHandler = fn; },
    hooks: win.PhoneAgent.__testHooks
  };
}

function makeCardCtx(doc) {
  const card = doc.createElement('div');
  const thinkingBox = doc.createElement('div');
  const thinkingTitleEl = doc.createElement('div');
  const thinkingList = doc.createElement('div');
  const accordion = doc.createElement('div');
  const summaryEl = doc.createElement('div');
  const summaryTextEl = doc.createElement('div');
  const summaryMetaEl = doc.createElement('div');
  const stepsList = doc.createElement('div');
  const confirmSlot = doc.createElement('div');
  const fixSlot = doc.createElement('div');
  const finalReplyEl = doc.createElement('div');
  const stopBtn = doc.createElement('button');
  return {
    card, thinkingBox, thinkingTitleEl, thinkingList, accordion,
    summaryEl, summaryTextEl, summaryMetaEl, stepsList, confirmSlot,
    fixSlot, finalReplyEl, stopBtn, startedAt: Date.now(), thoughtCount: 0, stepCount: 0
  };
}

async function waitForModal(doc, id, timeoutMs = 3000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const m = doc.getElementById(id);
    if (m) return m;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`等待弹窗超时: #${id}`);
}

async function runTests() {
  let passed = 0;
  const ok = (cond, msg) => {
    assert.ok(cond, msg);
    passed += 1;
  };

  // ========= 场景 1：本地免 API 智能对话分流与回复 =========
  {
    const h = createHarness();
    const { hooks, doc } = h;
    ok(hooks.isLikelyPureChat('你好') === true, '问候语识别为纯对话');
    ok(hooks.isLikelyPureChat('无障碍怎么开？') === true, '无障碍教程咨询识别为纯对话');
    ok(hooks.isLikelyPureChat('125 * 4 + 100') === true, '算术表达式识别为纯对话');
    ok(hooks.isLikelyPureChat('打开微信') === false, '打开微信识别为控屏指令');
    ok(hooks.safeEvalArithmetic('(12 + 8) * 3 / 2') === 30, '四则算术解析结果正确');
    ok(hooks.safeEvalArithmetic('10 / 0') === null, '除零安全拦截返回 null');

    const guideReply = hooks.buildLocalSmartChatReply('无障碍和悬浮窗怎么开');
    ok(guideReply.actionType === 'open_setup_guide', '权限咨询返回一键打开新手指引动作');
    const mathReply = hooks.buildLocalSmartChatReply('帮我算 25 * 4 + 12');
    ok(mathReply.reply.includes('112'), '算术回复包含正确计算结果 112');
    const timeReply = hooks.buildLocalSmartChatReply('现在几点了');
    ok(timeReply.reply.includes('星期'), '时间查询返回完整日期与星期');
    const comfortReply = hooks.buildLocalSmartChatReply('好累啊求安慰');
    ok(comfortReply.reply.includes('抱抱'), '情绪安慰给予温暖回复');
    const leaveReply = hooks.buildLocalSmartChatReply('帮我写个请假条');
    ok(leaveReply.reply.includes('请假'), '请假条模板正常生成');

    // 本地模式下普通闲聊不报错、不弹切引擎弹窗
    const chatCard = makeCardCtx(doc);
    await hooks.runReActLoop('今天心情不错，聊聊天', chatCard, 'local');
    ok(chatCard.finalReplyEl.innerHTML.includes('本地免 API'), '本地普通闲聊优雅回复不报红错');
    ok(!doc.getElementById('pa-engine-switch-modal'), '本地闲聊不误弹切引擎弹窗');

    // 本地模式下复杂跨 App 控屏指令正确弹出切引擎提示
    const ctrlCard = makeCardCtx(doc);
    await hooks.runReActLoop('打开美团帮我点一份螺蛳粉', ctrlCard, 'local');
    ok(Boolean(doc.getElementById('pa-engine-switch-modal')), '跨 App 控屏指令正确提示切换智能引擎');
    doc.getElementById('pa-engine-switch-modal')?.remove();
  }

  // ========= 场景 2：任务前需求澄清门控 =========
  {
    const h = createHarness();
    const { hooks, doc, nativeState } = h;
    ok(hooks.shouldSkipPreFlightClarify('打开微信', 'smart', null) === true, 'smart 模式下原子口令直接放行');
    ok(hooks.shouldSkipPreFlightClarify('帮我点外卖', 'smart', null) === false, 'smart 模式下模糊任务触发预检');
    ok(hooks.shouldSkipPreFlightClarify('打开微信', 'always', null) === false, 'always 模式下始终预检');
    ok(hooks.shouldSkipPreFlightClarify('帮我点外卖', 'off', null) === true, 'off 模式下直接放行');

    // 模糊任务 preflight 弹窗期间不切走 App，确认后才执行
    h.nativeState.packageName = 'com.deepseek.starwhisper.studio';
    h.nativeState.appName = '星语恋庭';
    let seenClarifiedTask = '';
    h.setFetchHandler(async (_url, opts) => {
      const body = JSON.parse(opts.body);
      if (body.phase === 'preflight') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            preflight: {
              intent: 'task',
              ready: false,
              thought: '缺少具体外卖品类',
              planPreview: '确认想吃的品类后打开外卖软件',
              question: '你想吃什么？',
              options: ['点一份螺蛳粉', '点一杯奶茶']
            }
          })
        };
      }
      seenClarifiedTask = body.task;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          plan: { tool: 'done', thought: '完成', summary: '完成点单准备', reply: '已完成' }
        })
      };
    });

    const card = makeCardCtx(doc);
    const loopPromise = hooks.runReActLoop('帮我点外卖', card, 'api_cloud');
    const preModal = await waitForModal(doc, 'pa-preflight-clarify-modal');
    ok(!nativeState.actionsLog.some((x) => x === 'returnToLastExternalApp' || x.startsWith('launchApp:') || x.startsWith('global:')), '预检弹窗期间绝对未切走当前应用');
    const optBtn = preModal.querySelector('.pa-modal-opt-btn');
    ok(Boolean(optBtn), '预检弹窗包含快捷选项按钮');
    optBtn.click();
    await loopPromise;
    ok(seenClarifiedTask.includes('点一份螺蛳粉'), '用户点击快捷选项后合并补充需求进入主规划');
  }

  // ========= 场景 3：连续 2 步画面无变化 -> 主动询问用户防循环 =========
  {
    const h = createHarness();
    const { hooks, doc } = h;
    let planCallCount = 0;
    let sawUserInterjection = false;

    h.setFetchHandler(async (_url, opts) => {
      const body = JSON.parse(opts.body);
      if (body.phase === 'preflight') {
        return { ok: true, status: 200, json: async () => ({ ok: true, preflight: { intent: 'task', ready: true } }) };
      }
      planCallCount += 1;
      if (Array.isArray(body.interjections) && body.interjections.some((x) => x.includes('点右上角跳过'))) {
        sawUserInterjection = true;
        return { ok: true, status: 200, json: async () => ({ ok: true, plan: { tool: 'done', thought: '按用户指示完成', summary: '已完成', reply: '按指示完成' } }) };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          plan: { tool: 'phone_tap', args: { ref: 'e1', snapshotId: 'snap_1' }, thought: '点击去结算', summary: '点击去结算' }
        })
      };
    });

    const card = makeCardCtx(doc);
    const loopPromise = hooks.runReActLoop('打开美团去结算', card, 'api_cloud');
    const askModal = await waitForModal(doc, 'pa-ask-clarify-modal', 6000);
    ok(askModal.innerHTML.includes('卡顿'), '连续 2 步画面无变化后主动弹出卡顿请示弹窗');
    const inp = askModal.querySelector('#pa-ask-modal-inp');
    inp.value = '点右上角跳过';
    askModal.querySelector('#pa-ask-modal-send').click();
    await loopPromise;
    ok(sawUserInterjection, '用户输入现场指示后立即高优先级注入下一步规划并跳出循环');
    ok(planCallCount >= 2, '卡顿主动介入后未陷入无限死循环');
  }

  // ========= 场景 4：连续 2 步动作报错 -> 主动询问用户 & 跳过换路保留黑名单 =========
  {
    const h = createHarness();
    const { hooks, doc, nativeState } = h;
    nativeState.nextClickOk = false; // 所有点击都返回失败
    let sawBlockedInNextStep = false;

    h.setFetchHandler(async (_url, opts) => {
      const body = JSON.parse(opts.body);
      if (body.phase === 'preflight') {
        return { ok: true, status: 200, json: async () => ({ ok: true, preflight: { intent: 'task', ready: true } }) };
      }
      if (Array.isArray(body.interjections) && body.interjections.some((x) => x.includes('跳过刚才卡住的目标'))) {
        sawBlockedInNextStep = Array.isArray(body.loopDiagnostics?.blockedActions) && body.loopDiagnostics.blockedActions.length > 0;
        return { ok: true, status: 200, json: async () => ({ ok: true, plan: { tool: 'done', thought: '换路完成', summary: '已换路完成', reply: '完成' } }) };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          plan: { tool: 'phone_tap', args: { ref: 'e99' }, thought: '尝试点击', summary: '尝试点击 e99' }
        })
      };
    });

    const card = makeCardCtx(doc);
    const loopPromise = hooks.runReActLoop('打开微信点菜单', card, 'api_cloud');
    const askModal = await waitForModal(doc, 'pa-ask-clarify-modal', 6000);
    ok(/重复失效|失败|卡顿/.test(askModal.innerHTML), '连续动作报错或重复失效后立即主动弹出请示弹窗');
    const skipBtn = askModal.querySelectorAll('.pa-modal-opt-btn').find((b) => b.getAttribute('data-opt')?.includes('跳过'));
    ok(Boolean(skipBtn), '卡顿弹窗提供「帮我跳过这步换个方法」选项');
    skipBtn.click();
    await loopPromise;
    ok(sawBlockedInNextStep, '选跳过换方法后保留当前页失败黑名单传入 loopDiagnostics');
  }

  // ========= 场景 5：A ↔ B 页面振荡检测与返回上一页跳出 =========
  {
    const h = createHarness();
    const { hooks, doc, nativeState } = h;
    ok(hooks.detectOscillation(['app::A', 'app::B', 'app::A', 'app::B']) === true, '准确识别 A↔B 往返振荡');
    ok(hooks.detectOscillation(['app::A', 'app::B', 'app::C', 'app::D']) === false, '正常推进页面不误报振荡');

    let stepNum = 0;
    let backCalled = false;
    nativeState.onClickHook = () => {
      nativeState.eventSeq += 1;
      nativeState.signature = nativeState.signature === 'sig_A' ? 'sig_B' : 'sig_A';
      return { ok: true, method: 'node', x: 100, y: 200 };
    };
    nativeState.onGlobalActionHook = (key) => {
      if (key === 'back') backCalled = true;
    };
    nativeState.signature = 'sig_A';

    h.setFetchHandler(async (_url, opts) => {
      const body = JSON.parse(opts.body);
      if (body.phase === 'preflight') {
        return { ok: true, status: 200, json: async () => ({ ok: true, preflight: { intent: 'task', ready: true } }) };
      }
      if (Array.isArray(body.interjections) && body.interjections.some((x) => x.includes('已返回上一页'))) {
        return { ok: true, status: 200, json: async () => ({ ok: true, plan: { tool: 'done', thought: '跳出振荡完成', summary: '已完成', reply: '完成' } }) };
      }
      stepNum += 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          plan: { tool: 'phone_tap', args: { ref: `e${stepNum}` }, thought: '点击切换', summary: '点击切换' }
        })
      };
    });

    const card = makeCardCtx(doc);
    const loopPromise = hooks.runReActLoop('打开设置查找入口', card, 'api_cloud');
    const askModal = await waitForModal(doc, 'pa-ask-clarify-modal', 6000);
    ok(askModal.innerHTML.includes('反复跳转'), '页面 A↔B 反复振荡触发主动询问弹窗');
    const backOpt = askModal.querySelectorAll('.pa-modal-opt-btn').find((b) => b.getAttribute('data-opt')?.includes('返回上一页'));
    backOpt.click();
    await loopPromise;
    ok(backCalled, '点击「返回上一页重新找」后自动执行系统 back 键并成功跳出循环');
  }

  // ========= 场景 6 & 7：遮挡弹窗自动识别 + 连续 phone_wait 拦截 =========
  {
    const h = createHarness();
    const { hooks, doc } = h;
    const dismissHit = hooks.findPopupDismissNode([
      { ref: 'e1', text: '商品列表', clickable: true, center: [200, 300] },
      { ref: 'e2', text: '跳过广告', clickable: true, center: [920, 120] }
    ], '打开淘宝买衣服');
    ok(dismissHit && dismissHit.ref === 'e2', 'findPopupDismissNode 精准识别广告跳过按钮');

    let waitTries = 0;
    h.setFetchHandler(async (_url, opts) => {
      const body = JSON.parse(opts.body);
      if (body.phase === 'preflight') {
        return { ok: true, status: 200, json: async () => ({ ok: true, preflight: { intent: 'task', ready: true } }) };
      }
      if (Array.isArray(body.interjections) && body.interjections.some((x) => x.includes('停止') || x.includes('手动'))) {
        return { ok: true, status: 200, json: async () => ({ ok: true, plan: { tool: 'done', thought: '完成', summary: '完成', reply: '完成' } }) };
      }
      waitTries += 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, plan: { tool: 'phone_wait', args: { ms: 30 }, thought: '等待刷新', summary: '等待' } })
      };
    });

    const card = makeCardCtx(doc);
    const loopPromise = hooks.runReActLoop('打开应用等待加载', card, 'api_cloud');
    const askModal = await waitForModal(doc, 'pa-ask-clarify-modal', 6000);
    ok(waitTries <= 3, `连续 phone_wait 被及时拦截并主动请示（waitTries=${waitTries}）`);
    const stopOpt = askModal.querySelectorAll('.pa-modal-opt-btn').find((b) => b.getAttribute('data-opt')?.includes('停止'));
    stopOpt.click();
    await loopPromise;
  }

  // ========= 场景 8：3 步交互式无障碍与悬浮窗新手指引 =========
  {
    const h = createHarness();
    const { win, doc, nativeState, localStorageMock, hooks } = h;
    nativeState.a11yEnabled = false;
    nativeState.overlayPermission = false;
    hooks.openSetupGuideWizard(1);
    const modal = doc.getElementById('pa-onboarding-guide-modal');
    ok(Boolean(modal), '新手指引向导弹窗成功打开');
    ok(modal.querySelector('#pa-guide-s1-status').className.includes('is-pending'), '第 1 步初始检测到无障碍未开启');

    // 模拟用户去系统设置开启无障碍后返回
    nativeState.a11yEnabled = true;
    win.__onNativeResume();
    ok(modal.querySelector('#pa-guide-s1-status').className.includes('is-ok'), '切回应用时无障碍状态自动变绿');

    // 进入第 2 步悬浮窗、第 3 步并点完成
    modal.querySelector('#pa-guide-next-btn').click();
    ok(Boolean(modal.querySelector('#pa-guide-s2-status')), '成功切换至第 2 步悬浮窗指引');
    modal.querySelector('#pa-guide-next-btn').click();
    const finishBtn = modal.querySelector('#pa-guide-finish-btn');
    ok(Boolean(finishBtn), '成功切换至第 3 步快速上手');
    finishBtn.click();
    ok(!doc.getElementById('pa-onboarding-guide-modal'), '点击完成后关闭新手指引弹窗');
    ok(localStorageMock.getItem('pa_setup_guide_done_v1') === '1', '记录已完成新手指引标记，不重复打扰');
  }

  // ========= 场景 9：默认模型 V4.1 Flash 与 DeepSeek 实时计费监测插件（仅限 DeepSeek 官方 API） =========
  {
    const h = createHarness();
    const { win, doc, localStorageMock } = h;
    ok(win.PhoneAgent.getConfig().model === 'deepseek-v4.1-flash', 'DeepSeek API 默认模型为 deepseek-v4.1-flash');

    // 准备聊天框表单容器（不再挂在顶栏）并加载真实计费插件
    const chatForm = doc.createElement('form');
    chatForm.id = 'chat-form';
    doc.body.appendChild(chatForm);
    doc.head = doc.createElement('head');
    const monitorCode = fs.readFileSync(path.join(ROOT, 'public', 'plugins', 'deepseekUsageMonitor.js'), 'utf8');
    vm.runInContext(monitorCode, win);

    const plugin = win.DeepSeekMonitorPlugin;
    ok(Boolean(plugin) && plugin.version === '2.0.0', 'DeepSeek 计费监控插件 v2.0.0 加载成功');

    // 校验 V4.1 Flash 阶梯定价计算（命中 1000 * 0.2 + 未命中 1000 * 2.0 + 输出 500 * 3.0） / 1e6 = 0.0037
    const flashCost = plugin.estimateTurnCostCny({
      prompt_tokens: 2000,
      prompt_cache_hit_tokens: 1000,
      prompt_cache_miss_tokens: 1000,
      completion_tokens: 500
    }, 'deepseek-v4.1-flash');
    ok(Math.abs(flashCost.costCny - 0.0037) < 1e-6, `V4.1 Flash 费用估算精确 (${flashCost.costCny})`);
    ok(flashCost.savedCny > 0, 'V4.1 Flash 缓存命中省费计算正确');

    // 校验 R1 推理模型定价（命中 1000 * 1.0 + 未命中 1000 * 4.0 + 输出 500 * 16.0） / 1e6 = 0.013
    const r1Cost = plugin.estimateTurnCostCny({
      prompt_tokens: 2000,
      prompt_cache_hit_tokens: 1000,
      prompt_cache_miss_tokens: 1000,
      completion_tokens: 500
    }, 'deepseek-reasoner');
    ok(Math.abs(r1Cost.costCny - 0.013) < 1e-6, `Reasoner 费用估算精确 (${r1Cost.costCny})`);

    // 1) 云端 API 模式下必须隐藏且不记账
    plugin.sync({ settings: { provider: 'custom_cloud', custom_cloud_model: 'gemini-2.5-flash' } });
    ok(plugin.getState().enabled === false, '云端 custom_cloud 模式下 DeepSeek 计费插件禁用');
    const barAfterCloud = doc.getElementById('oss-ds-composer-bar');
    ok(Boolean(barAfterCloud) && barAfterCloud.classList.contains('hidden'), '云端模式下聊天框计费条隐藏');
    const ignoredCloudUsage = plugin.recordTurnUsage({
      usage: { prompt_tokens: 500, completion_tokens: 100 },
      model: 'gemini-2.5-flash',
      provider: 'custom_cloud'
    });
    ok(ignoredCloudUsage === null, '云端 API 调用 recordTurnUsage 被严格忽略');

    plugin.syncPhoneAgent({ execMode: 'api_cloud', model: 'gemini-2.5-flash' });
    ok(plugin.getState().enabled === false && barAfterCloud.classList.contains('hidden'), '手机辅助云端 API 模式下计费插件保持隐藏');

    // 2) DeepSeek 官方 API 模式下唤醒显示在聊天框附近
    plugin.sync({ settings: { provider: 'own_deepseek', has_own_deepseek_key: true, own_deepseek_model: 'deepseek-v4.1-flash' } });
    ok(plugin.getState().enabled === true, 'DeepSeek 官方 own_deepseek 模式下计费插件正常激活');
    plugin.recordTurnUsage({
      usage: { prompt_tokens: 2000, prompt_cache_hit_tokens: 1000, completion_tokens: 500 },
      model: 'deepseek-v4.1-flash',
      source: 'DeepSeek对话',
      provider: 'own_deepseek'
    });
    const stAfter = plugin.getState();
    ok(stAfter.records.length === 1 && stAfter.aggregate.totalTokens === 2500, 'recordTurnUsage 正确记录单轮 Token 与费用');
    const pill = doc.getElementById('oss-ds-monitor-trigger-btn');
    ok(Boolean(pill) && !pill.classList.contains('hidden') && !barAfterCloud.classList.contains('hidden'), '聊天框附近极简计费胶囊已唤醒显示');

    plugin.clearBillingRecords();
    ok(plugin.getState().records.length === 0 && localStorageMock.getItem('ds_billing_records_v1') === '[]', 'clearBillingRecords 正常清零');
  }

  // ========= 场景 10：手机辅助双模式默认模型矫正、历史遗留迁移与配置面板互斥隔离 =========
  {
    const h = createHarness({
      withModePanel: true,
      initialStorage: {
        pa_exec_mode_v1: 'api_direct',
        pa_direct_model_v1: 'deepseek-chat',
        pa_cloud_model_v1: 'deepseek-v4.1-flash'
      }
    });
    const { win, doc, localStorageMock } = h;

    ok(win.PhoneAgent.getConfig().model === 'deepseek-v4.1-flash', '旧缓存 deepseek-chat 自动迁移为 DeepSeek V4.1 Flash');
    ok(localStorageMock.getItem('pa_direct_model_v1') === 'deepseek-v4.1-flash', 'pa_direct_model_v1 已落盘更新为 deepseek-v4.1-flash');
    ok(win.PhoneAgent.getCloudModel() === '', '误存于云端模式的 deepseek-v4.1-flash 已自动迁回智能默认空值');

    const cfgModelInp = doc.getElementById('pa-cfg-model');
    const inlineDrawer = doc.getElementById('pa-inline-config-drawer');
    const cloudBox = doc.getElementById('pa-cloud-model-box');
    const cloudSel = doc.getElementById('pa-cloud-model-select');

    ok(cfgModelInp.value === 'deepseek-v4.1-flash', 'DeepSeek API 输入框显示 deepseek-v4.1-flash');
    ok(!inlineDrawer.classList.contains('hidden') && cloudBox.classList.contains('hidden'), 'api_direct 模式下仅展示 DeepSeek 直连配置抽屉并隐藏云端选模框');

    // 切换至云端 API 模式：必须隐藏 DeepSeek 直连抽屉，展示云端模型选择框，且不把 DeepSeek V4.1 Flash 强塞作云端默认
    win.PhoneAgent.setExecMode('api_cloud');
    ok(inlineDrawer.classList.contains('hidden') && !cloudBox.classList.contains('hidden'), 'api_cloud 模式下隐藏直连配置抽屉并仅展示云端模型选框');
    ok(cloudSel.value === '', '云端 API 默认选项保持为智能默认（不强制绑定 DeepSeek V4.1 Flash）');

    // 切换至本地免 API 模式：直连与云端均隐藏
    win.PhoneAgent.setExecMode('local');
    ok(inlineDrawer.classList.contains('hidden') && cloudBox.classList.contains('hidden'), 'local 模式下直连抽屉与云端选框均隐藏');
  }

  console.log(`ALL_PHONE_AGENT_LOGIC_TESTS_PASSED (${passed} assertions)`);
}

runTests().catch((err) => {
  console.error('TEST_FAILED:', err);
  process.exit(1);
});

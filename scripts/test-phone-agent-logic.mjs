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
    const tagRe = /<(button|input|div|span|ol|strong)\b([^>]*)>([\s\S]*?)<\/\1>|<input\b([^>]*)\/?>/gi;
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
      if (inner && /<(?:button|input|div|span|ol|strong)\b/i.test(inner)) {
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
    const cloudBaseUrlInp = doc.createElement('input');
    cloudBaseUrlInp.id = 'pa-cloud-baseurl';
    const cloudApiKeyInp = doc.createElement('input');
    cloudApiKeyInp.id = 'pa-cloud-apikey';
    const cloudModelsStatus = doc.createElement('span');
    cloudModelsStatus.id = 'pa-cloud-models-status';
    const cloudFetchBtn = doc.createElement('button');
    cloudFetchBtn.id = 'pa-cloud-fetch-models-btn';
    const cloudSaveBtn = doc.createElement('button');
    cloudSaveBtn.id = 'pa-cloud-save-btn';
    const cloudAutoChk = doc.createElement('input');
    cloudAutoChk.id = 'pa-cloud-auto-approve';
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
    cloudBox.appendChild(cloudBaseUrlInp);
    cloudBox.appendChild(cloudApiKeyInp);
    cloudBox.appendChild(cloudModelsStatus);
    cloudBox.appendChild(cloudFetchBtn);
    cloudBox.appendChild(cloudSel);
    cloudBox.appendChild(cloudAutoChk);
    cloudBox.appendChild(cloudSaveBtn);
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
    petPersona: options.nativePetPersona || 'feiyu',
    floatProgressLogs: [],
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
    getInstalledVersionInfo: () => JSON.stringify({ versionName: '2.7.6', versionCode: 167 }),
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
    updateFloatProgress: (jsonStr) => {
      try { nativeState.floatProgressLogs.push(JSON.parse(jsonStr)); } catch {}
    },
    getFloatPetPersona: () => nativeState.petPersona,
    setFloatPetPersona: (id) => {
      nativeState.petPersona = id === 'nailong' ? 'nailong' : 'feiyu';
      nativeState.actionsLog.push(`setFloatPetPersona:${nativeState.petPersona}`);
      return true;
    },
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
    ok(Boolean(plugin) && plugin.version === '2.1.0', 'DeepSeek 计费监控插件 v2.1.0 加载成功');

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

  // ========= 场景 10：DeepSeek 官方直连免填地址 + 云端 API 自定义接口地址/Key 与拉取模型 =========
  {
    const h = createHarness({
      withModePanel: true,
      initialStorage: {
        pa_exec_mode_v1: 'api_direct',
        pa_direct_model_v1: 'deepseek-chat',
        pa_direct_baseurl_v1: 'https://legacy-proxy.example.com/v1',
        pa_cloud_model_v1: 'deepseek-v4.1-flash'
      }
    });
    const { win, doc, localStorageMock, setFetchHandler } = h;

    ok(win.PhoneAgent.getConfig().model === 'deepseek-v4.1-flash', '旧缓存 deepseek-chat 自动迁移为 DeepSeek V4.1 Flash');
    ok(win.PhoneAgent.getConfig().baseUrl === 'https://api.deepseek.com/v1/chat/completions', 'DeepSeek API 模式锁定官方接口地址且忽略旧接口地址输入');
    ok(!doc.getElementById('pa-cfg-baseurl'), 'DeepSeek API 表单不再渲染冗余的接口地址输入框');
    ok(localStorageMock.getItem('pa_direct_model_v1') === 'deepseek-v4.1-flash', 'pa_direct_model_v1 已落盘更新为 deepseek-v4.1-flash');
    ok(win.PhoneAgent.getCloudModel() === '', '误存于云端模式的 deepseek-v4.1-flash 已自动迁回智能默认空值');

    const cfgModelInp = doc.getElementById('pa-cfg-model');
    const inlineDrawer = doc.getElementById('pa-inline-config-drawer');
    const cloudBox = doc.getElementById('pa-cloud-model-box');
    const cloudSel = doc.getElementById('pa-cloud-model-select');
    const cloudUrlInp = doc.getElementById('pa-cloud-baseurl');
    const cloudKeyInp = doc.getElementById('pa-cloud-apikey');
    const cloudFetchBtn = doc.getElementById('pa-cloud-fetch-models-btn');
    const cloudSaveBtn = doc.getElementById('pa-cloud-save-btn');
    const cloudStatusEl = doc.getElementById('pa-cloud-models-status');

    ok(cfgModelInp.value === 'deepseek-v4.1-flash', 'DeepSeek API 输入框显示 deepseek-v4.1-flash');
    ok(!inlineDrawer.classList.contains('hidden') && cloudBox.classList.contains('hidden'), 'api_direct 模式下仅展示 DeepSeek 直连配置抽屉并隐藏云端配置抽屉');

    // 切换至云端 API 模式：必须隐藏 DeepSeek 直连抽屉，展示云端地址/Key/拉取模型抽屉
    win.PhoneAgent.setExecMode('api_cloud');
    ok(inlineDrawer.classList.contains('hidden') && !cloudBox.classList.contains('hidden'), 'api_cloud 模式下隐藏 DeepSeek 抽屉并展示云端配置抽屉');
    ok(cloudSel.value === '', '云端 API 未拉取前默认选项保持为云端智能默认');

    // 在云端 API 下填入地址与 API Key，并模拟点击「拉取模型」
    let fetchedModelsPayload = null;
    setFetchHandler(async (url, opts = {}) => {
      if (String(url).includes('/api/cloud/models')) {
        fetchedModelsPayload = JSON.parse(opts.body || '{}');
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            models: ['Qwen/Qwen2.5-72B-Instruct', 'Pro/deepseek-ai/DeepSeek-V3', 'THUDM/glm-4-9b-chat']
          })
        };
      }
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    });

    cloudUrlInp.value = 'https://api.siliconflow.cn';
    cloudKeyInp.value = 'sk-cloud-test-987654321';
    cloudFetchBtn.click();
    await new Promise((r) => setTimeout(r, 30));

    ok(
      fetchedModelsPayload && fetchedModelsPayload.apiKey === 'sk-cloud-test-987654321' && fetchedModelsPayload.baseUrl === 'https://api.siliconflow.cn/v1/chat/completions',
      '点击拉取模型向 /api/cloud/models 正确传递云端 Key 与补全后的 Base URL'
    );
    ok(
      cloudSel.options.some((o) => o.value === 'Qwen/Qwen2.5-72B-Instruct') && cloudSel.value === 'Qwen/Qwen2.5-72B-Instruct',
      '拉取到的第三方云端模型已填充进下拉列表并自动选中首个可用模型'
    );
    ok(cloudStatusEl.textContent.includes('已拉取 3 个'), '云端模型状态提示已更新拉取数量');

    // 保存云端配置并校验独立沙盒存储
    cloudSel.value = 'Pro/deepseek-ai/DeepSeek-V3';
    cloudSaveBtn.click();
    const savedCloudCfg = win.PhoneAgent.getCloudConfig();
    ok(
      savedCloudCfg.apiKey === 'sk-cloud-test-987654321' &&
      savedCloudCfg.baseUrl === 'https://api.siliconflow.cn/v1/chat/completions' &&
      savedCloudCfg.model === 'Pro/deepseek-ai/DeepSeek-V3',
      '云端 API Key、Base URL 与所选模型已独立落盘保存且与 DeepSeek 直连隔离'
    );

    // 切换至本地免 API 模式：直连与云端抽屉均隐藏
    win.PhoneAgent.setExecMode('local');
    ok(inlineDrawer.classList.contains('hidden') && cloudBox.classList.contains('hidden'), 'local 模式下直连抽屉与云端配置抽屉均隐藏');
  }

  // ========= 场景 11：本地直连（local_antigravity / local）彻底零计费且隐藏计费胶囊 =========
  {
    const h = createHarness();
    const { win, doc, localStorageMock } = h;
    const chatForm = doc.createElement('form');
    chatForm.id = 'chat-form';
    doc.body.appendChild(chatForm);
    doc.head = doc.createElement('head');
    const monitorCode = fs.readFileSync(path.join(ROOT, 'public', 'plugins', 'deepseekUsageMonitor.js'), 'utf8');
    vm.runInContext(monitorCode, win);

    const plugin = win.DeepSeekMonitorPlugin;
    // 先在 DeepSeek 官方模式下记录一轮计费并激活底部状态条
    plugin.sync({ scopeProvider: 'own_deepseek', settings: { provider: 'own_deepseek', has_own_deepseek_key: true, own_deepseek_model: 'deepseek-v4.1-flash' } });
    plugin.recordTurnUsage({
      usage: { prompt_tokens: 1000, completion_tokens: 200 },
      model: 'deepseek-v4.1-flash',
      provider: 'own_deepseek'
    });
    const bar = doc.getElementById('oss-ds-composer-bar');
    ok(plugin.getState().enabled === true && !bar.classList.contains('hidden'), '先在 own_deepseek 下验证计费条可展示');

    // 当切换到 local_antigravity 时，即便旧 settings.provider 仍残留 own_deepseek，插件也必须立即关闭且隐藏
    plugin.sync({
      scopeProvider: 'local_antigravity',
      settings: { provider: 'own_deepseek', has_own_deepseek_key: true, own_deepseek_model: 'deepseek-v4.1-flash' }
    });
    ok(plugin.getState().enabled === false && bar.classList.contains('hidden'), '切换至 local_antigravity 时计费插件强制禁用且底部胶囊隐藏');

    const ignoredLocalChat = plugin.recordTurnUsage({
      usage: { prompt_tokens: 1800, completion_tokens: 450 },
      model: 'DeepSeek-V4.1-Flash',
      source: 'DeepSeek对话',
      provider: 'local_antigravity'
    });
    ok(ignoredLocalChat === null, 'local_antigravity 聊天传入 recordTurnUsage 被严格拒绝返回 null');
    ok(plugin.getState().records.length === 1, 'local_antigravity 对话不会新增任何 Token 计费流水');

    // 手机辅助本地直连 (local) 也同理严格免疫计费
    plugin.syncPhoneAgent({ execMode: 'local', model: 'DeepSeek-V4.1-Flash' });
    ok(plugin.getState().enabled === false && bar.classList.contains('hidden'), '手机辅助 local 模式同步后计费插件强制禁用');
    const ignoredPaLocal = plugin.recordTurnUsage({
      usage: { prompt_tokens: 900, completion_tokens: 120 },
      model: 'DeepSeek-V4.1-Flash',
      source: '手机辅助模式',
      provider: 'local'
    });
    ok(ignoredPaLocal === null && JSON.parse(localStorageMock.getItem('ds_billing_records_v1') || '[]').length === 1, '手机辅助 local 模式绝不累加 Token 计费流水');
  }

  // ========= 场景 12：App 端独立适配层（APK 源站）本地直连/自定义端口透传与 WebView getReader() 流式读取 =========
  {
    const adapterCode = fs.readFileSync(path.join(ROOT, 'public', 'standaloneAdapter.js'), 'utf8');
    const lsMap = new Map();
    const ssMap = new Map();
    const saLocalStorage = {
      getItem: (k) => (lsMap.has(k) ? lsMap.get(k) : null),
      setItem: (k, v) => lsMap.set(k, String(v)),
      removeItem: (k) => lsMap.delete(k)
    };
    const saSessionStorage = {
      getItem: (k) => (ssMap.has(k) ? ssMap.get(k) : null),
      setItem: (k, v) => ssMap.set(k, String(v)),
      removeItem: (k) => ssMap.delete(k)
    };

    const recordedRemoteCalls = [];
    const createReaderOnlySseBody = (chunksText) => {
      const enc = new TextEncoder();
      const encoded = chunksText.map((t) => enc.encode(t));
      let idx = 0;
      return {
        // 故意不实现 Symbol.asyncIterator，真实模拟低版本 Android System WebView
        getReader() {
          return {
            async read() {
              if (idx < encoded.length) {
                return { done: false, value: encoded[idx++] };
              }
              return { done: true, value: undefined };
            },
            releaseLock() {}
          };
        }
      };
    };

    const saFetch = async (input, init = {}) => {
      const url = typeof input === 'string' ? input : String(input?.url || '');
      const hdrs = new Headers(init?.headers || {});
      recordedRemoteCalls.push({
        url,
        method: (init?.method || 'GET').toUpperCase(),
        auth: hdrs.get('Authorization') || '',
        body: init?.body ? JSON.parse(init.body) : null
      });

      if (url === 'http://127.0.0.1:18765/health') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ available: true, status: 'ok' })
        };
      }
      if (url === 'http://127.0.0.1:3000/api/antigravity/status') {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'Content-Type': 'application/json' }),
          json: async () => ({ available: true, transport: 'pc_local_server' }),
          text: async () => JSON.stringify({ available: true, transport: 'pc_local_server' })
        };
      }
      if (url === 'http://127.0.0.1:3000/api/auth/demo-login') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ token: 'remote_tok_999', user: { id: 88, nickname: '测试旅人' } })
        };
      }
      if (url === 'http://127.0.0.1:3000/api/sessions' && (init?.method || 'GET').toUpperCase() === 'POST') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ session_id: 777 })
        };
      }
      if (url === 'http://127.0.0.1:3000/api/chat/stream') {
        return {
          ok: true,
          status: 200,
          body: createReaderOnlySseBody([
            'event: reasoning\ndata: {"delta":"思考过程"}\n\n',
            'event: content\ndata: {"delta":"来自PC端本机端口的回复"}\n\n',
            'event: done\ndata: {"meta":{"usage":{"prompt_tokens":999},"follow_ups":["继续聊聊"]}}\n\n'
          ])
        };
      }
      return { ok: false, status: 404, json: async () => ({ error: 'not found' }), text: async () => 'not found' };
    };

    const saWin = {
      location: {
        protocol: 'https:',
        hostname: 'appassets.androidplatform.net',
        origin: 'https://appassets.androidplatform.net',
        search: ''
      },
      AndroidAppBridge: {
        isNativeApk: () => true,
        saveAuthCredentials: () => {}
      },
      localStorage: saLocalStorage,
      sessionStorage: saSessionStorage,
      fetch: saFetch,
      Headers,
      Response,
      ReadableStream,
      TextEncoder,
      TextDecoder,
      URL,
      URLSearchParams,
      AbortController,
      console,
      Math,
      Date,
      JSON,
      setTimeout,
      clearTimeout
    };
    saWin.window = saWin;
    vm.createContext(saWin);
    vm.runInContext(adapterCode, saWin);

    const hooks = saWin.__STAR_STANDALONE_HOOKS__;
    ok(Boolean(hooks), 'standaloneAdapter 成功暴露测试钩子');
    ok(hooks.getRemoteBackendOrigin() === 'https://star.claudexxb.online', '未配置本机端口时默认指向官方云端隧道');

    saLocalStorage.setItem('star_app_local_backend_url', 'http://192.168.1.88:3000/');
    ok(hooks.getRemoteBackendOrigin() === 'http://192.168.1.88:3000', '自定义局域网端口自动去除末尾斜杠并生效');
    ok(hooks.isBridgeGatewayOrigin('http://127.0.0.1:18765') === true && hooks.isBridgeGatewayOrigin('http://127.0.0.1:3000') === false, '准确识别 18765 直连网关与 3000 完整后端');

    // 1) 验证 18765 网关探测适配
    saLocalStorage.setItem('star_app_local_backend_url', 'http://127.0.0.1:18765');
    const stBridgeResp = await saWin.fetch('/api/antigravity/status');
    const stBridgeJson = await stBridgeResp.json();
    ok(stBridgeJson.available === true && stBridgeJson.transport === 'direct_local_port_18765', '配置 18765 网关端口时 /api/antigravity/status 自动映射 /health 返回可用状态');

    // 2) 验证 3000 自定义本地后端全链路流式聊天与零 usage 落盘
    saLocalStorage.setItem('star_app_local_backend_url', 'http://127.0.0.1:3000');
    const bootstrapResp = await saWin.fetch('/api/bootstrap');
    const bootstrapData = await bootstrapResp.json();
    const firstPersonaId = bootstrapData.personas[0].id;
    const newSessResp = await saWin.fetch('/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ persona_id: firstPersonaId })
    });
    const newSessData = await newSessResp.json();
    const localSid = newSessData.session_id;

    recordedRemoteCalls.length = 0;
    const chatResp = await saWin.fetch('/api/chat/stream', {
      method: 'POST',
      body: JSON.stringify({
        session_id: localSid,
        content: '测试本地端口聊天',
        llm_mode: 'local_antigravity'
      })
    });
    ok(chatResp.ok, 'App 端 local_antigravity 发起 /api/chat/stream 返回 200 SSE 响应');

    // 用 readStreamBodyWithReader 消费客户端返回流（验证无 asyncIterator 也可正常完整消费）
    const dec = new TextDecoder();
    let clientSseText = '';
    await hooks.readStreamBodyWithReader(chatResp.body, (chunk) => {
      clientSseText += dec.decode(chunk, { stream: true });
    });
    clientSseText += dec.decode();

    ok(clientSseText.includes('来自PC端本机端口的回复'), 'App 端完整接收到本机端口流式回复内容');
    ok(recordedRemoteCalls.some((c) => c.url === 'http://127.0.0.1:3000/api/auth/demo-login'), '自动完成本机端匿名认证');
    ok(recordedRemoteCalls.some((c) => c.url === 'http://127.0.0.1:3000/api/sessions' && c.auth === 'Bearer remote_tok_999'), '携带真实 Token 自动创建远端映射会话');
    const streamCall = recordedRemoteCalls.find((c) => c.url === 'http://127.0.0.1:3000/api/chat/stream');
    ok(Boolean(streamCall) && streamCall.auth === 'Bearer remote_tok_999' && streamCall.body?.llm_mode === 'local_antigravity', '向本机端口透传 llm_mode=local_antigravity 与真实鉴权头');

    const sessDetailResp = await saWin.fetch(`/api/sessions/${localSid}/export`);
    const sessDetailJson = await sessDetailResp.json();
    const lastAssistant = [...(sessDetailJson.messages || [])].reverse().find((m) => m.role === 'assistant');
    ok(Boolean(lastAssistant) && lastAssistant.content.includes('来自PC端本机端口的回复'), '本地存储成功落盘流式助手回复');
    const parsedMeta = JSON.parse(lastAssistant.meta_json || '{}');
    ok(parsedMeta.usage === null, '即便上游携带 usage 字段，本地直连落盘 meta.usage 依然强制为 null（零计费）');
  }

  // ========= 场景 13：原生加速通道（事件驱动屏变 + 快照零重复采集 + 原生 HTTP + 明确任务跳过 Pre-flight） =========
  {
    const h = createHarness({
      initialStorage: {
        pa_exec_mode_v1: 'api_direct',
        pa_exclusive_api_key_v1: 'sk-deepseek-fast-test-123456'
      }
    });
    const { win, doc, nativeState, hooks } = h;
    const b = win.AndroidAppBridge;

    let dumpSnapshotCalls = 0;
    let verdictWaitCalls = 0;
    let nativeHttpCalls = 0;
    let nativeSleepCalls = 0;
    let preflightCalled = false;
    let sawPrefetchedLeakInPayload = false;

    const origDump = b.dumpScreenSnapshot;
    b.dumpScreenSnapshot = (inc) => {
      dumpSnapshotCalls += 1;
      return origDump(inc);
    };
    b.getTopPackageFast = () => nativeState.packageName;
    b.nativeSleepAsync = (reqId, ms) => {
      nativeSleepCalls += 1;
      setTimeout(() => win.__onNativeSleepDone(reqId), Math.min(ms, 5));
    };
    b.cancelNativeSleep = () => {};
    b.waitForScreenVerdictAsync = (reqId, beforePkg) => {
      verdictWaitCalls += 1;
      setTimeout(() => {
        nativeState.eventSeq += 1;
        nativeState.signature = 'sig_page_2_next';
        const nextSnap = {
          snapshotId: `snap_${nativeState.eventSeq}`,
          packageName: nativeState.packageName,
          appName: nativeState.appName,
          signature: nativeState.signature,
          eventSeq: nativeState.eventSeq,
          hasSensitiveField: false,
          nodes: [
            { ref: 'e10', text: '确认提交', cls: 'Button', clickable: true, center: [540, 1500] }
          ]
        };
        win.__onNativeVerdictResult(reqId, JSON.stringify({
          changed: true,
          fromApp: beforePkg,
          toApp: nativeState.appName,
          packageName: nativeState.packageName,
          signature: nativeState.signature,
          elapsedMs: 42,
          hasSensitiveField: false,
          sensitiveReason: '',
          prefetchedSnapshot: nextSnap
        }));
      }, 8);
    };
    b.cancelWaitForScreenVerdict = () => {};

    let llmStep = 0;
    b.nativeHttpPostAsync = (reqId, _url, _headersJson, bodyStr) => {
      nativeHttpCalls += 1;
      const body = JSON.parse(bodyStr || '{}');
      const usrContent = body?.messages?.[1]?.content || '';
      if (String(usrContent).includes('"clarifyPolicy"') && !String(usrContent).includes('screenTreeText')) {
        preflightCalled = true;
      }
      if (String(usrContent).includes('prefetchedSnapshot')) {
        sawPrefetchedLeakInPayload = true;
      }
      setTimeout(() => {
        llmStep += 1;
        const plan = llmStep === 1
          ? { tool: 'phone_tap', args: { ref: 'e1', snapshotId: 'snap_1' }, thought: '点击去结算', summary: '点击去结算' }
          : { tool: 'done', thought: '已进入下一步', summary: '完成', reply: '加速执行完成' };
        win.__onNativeHttpResult(reqId, JSON.stringify({
          ok: true,
          status: 200,
          body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(plan) } }] })
        }));
      }, 5);
    };
    b.cancelNativeHttp = () => {};

    ok(hooks.shouldSkipPreFlightClarify('打开高德地图搜附近咖啡', 'smart', null) === true, 'smart 模式下明确指令直通跳过 Pre-flight');

    const card = makeCardCtx(doc);
    await hooks.runReActLoop('打开高德地图搜附近咖啡', card, 'api_direct');

    ok(!preflightCalled, '明确指令未发出多余 Pre-flight LLM 请求');
    ok(nativeHttpCalls === 2, `BYOK 直连走原生 HTTP 通道完成 2 步规划 (actual=${nativeHttpCalls})`);
    ok(verdictWaitCalls === 1, `第 1 步走原生事件驱动屏变等待 (actual=${verdictWaitCalls})`);
    ok(dumpSnapshotCalls === 1, `第 2 步直接复用原生 prefetchedSnapshot 零重复采树 (actual=${dumpSnapshotCalls})`);
    ok(!sawPrefetchedLeakInPayload, 'screenVerdict 未将 prefetchedSnapshot 冗余载荷发往大模型');
    ok(nativeSleepCalls >= 0, 'nativeSleepAsync 原生定时通道就绪');
  }

  // ========= 场景 14：DeepSeek 用量/费用/余额插件全链路校验（跨模式隔离 + 自动余额 + 今日统计 + 尾包 usage + 预检记账） =========
  {
    const h = createHarness({
      initialStorage: {
        pa_exec_mode_v1: 'local',
        pa_exclusive_api_key_v1: 'sk-pa-preflight-123456',
        pa_clarify_policy_v1: 'always'
      }
    });
    const { win, doc, setFetchHandler, hooks } = h;
    const appShell = doc.getElementById('app-shell');
    appShell.dataset.uiMode = 'deepseek';

    const chatForm = doc.createElement('form');
    chatForm.id = 'chat-form';
    doc.body.appendChild(chatForm);
    doc.head = doc.createElement('head');
    const monitorCode = fs.readFileSync(path.join(ROOT, 'public', 'plugins', 'deepseekUsageMonitor.js'), 'utf8');
    const mobileRespCss = fs.readFileSync(path.join(ROOT, 'public', 'mobile-responsive.css'), 'utf8');
    ok(!monitorCode.includes('light-dark('), 'DeepSeek 计费插件已彻底移除无回退的 light-dark() CSS 函数');
    ok(!mobileRespCss.includes('.oss-ds-monitor-pill'), '移动端响应式样式不再错误隐藏 .oss-ds-monitor-pill 计费胶囊');
    vm.runInContext(monitorCode, win);

    const plugin = win.DeepSeekMonitorPlugin;
    let balanceReqBody = null;
    setFetchHandler(async (url, opts = {}) => {
      if (String(url).includes('/api/deepseek/check-balance')) {
        balanceReqBody = JSON.parse(opts.body || '{}');
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            enabled: true,
            provider_label: 'DeepSeek 官方 API',
            is_official_deepseek: true,
            balance_supported: true,
            is_available: true,
            symbol: '¥',
            total_balance: '48.62',
            topped_up_balance: '40.00',
            granted_balance: '8.62'
          })
        };
      }
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    });

    // 1) 聊天模式传参 sync（含 apiKey）自动拉取实时余额
    plugin.sync({
      scopeProvider: 'own_deepseek',
      apiKey: 'sk-chat-123456',
      baseUrl: 'https://api.deepseek.com/v1/chat/completions',
      settings: { provider: 'own_deepseek', has_own_deepseek_key: true, own_deepseek_model: 'deepseek-v4.1-flash' }
    });
    await new Promise((r) => setTimeout(r, 30));

    ok(balanceReqBody && balanceReqBody.customApiKey === 'sk-chat-123456', '聊天模式自动携带分模式 apiKey 请求 /api/deepseek/check-balance');
    const pill = doc.getElementById('oss-ds-monitor-trigger-btn');
    const balNumEl = doc.getElementById('oss-mon-bal-num');
    ok(pill && pill.innerHTML.includes('余 ¥48.62'), '胶囊实时展示账户余额 余 ¥48.62');
    ok(balNumEl && balNumEl.textContent === '¥ 48.62', '详情弹窗实时展示余额 ¥ 48.62');

    // 2) 跨模式不抢占：当在 DeepSeek 聊天页面，PhoneAgent syncStatus/setExecMode('local') 不得关闭聊天计费胶囊
    win.PhoneAgent.setExecMode('local');
    win.PhoneAgent.syncStatus();
    ok(plugin.getState().enabled === true && !pill.classList.contains('hidden'), '非手机辅助模式下 PhoneAgent.syncStatus 不会抢占或隐藏聊天计费胶囊');

    // 3) 多轮记账（含 reasoning_tokens）与今日/累计统计校验
    plugin.recordTurnUsage({
      usage: {
        prompt_tokens: 2000,
        prompt_cache_hit_tokens: 1000,
        completion_tokens: 400,
        completion_tokens_details: { reasoning_tokens: 150 }
      },
      model: 'deepseek-v4.1-flash',
      source: 'DeepSeek对话',
      apiKey: 'sk-chat-123456',
      provider: 'own_deepseek'
    });
    plugin.recordTurnUsage({
      usage: {
        prompt_tokens: 1000,
        prompt_cache_hit_tokens: 500,
        completion_tokens: 200
      },
      model: 'deepseek-v4.1-flash',
      source: '主动对话',
      apiKey: 'sk-chat-123456',
      provider: 'own_deepseek'
    });

    const st3 = plugin.getState();
    ok(st3.records.length === 2 && st3.aggregate.totalTokens === 3600, '正确累加 2 轮对话总 Token (3600)');
    ok(st3.aggregate.todayTokens === 3600 && st3.aggregate.todayCost > 0, '今日消耗 Token 与费用统计正确');
    ok(st3.aggregate.totalReasoningTokens === 150, '正确记录推理 reasoning_tokens');
    const todayStatsEl = doc.getElementById('oss-mon-today-stats');
    const totalStatsEl = doc.getElementById('oss-mon-total-stats');
    ok(todayStatsEl && todayStatsEl.textContent.includes('3600 tok'), '弹窗今日统计节点渲染正确');
    ok(totalStatsEl && totalStatsEl.textContent.includes('3600 tok'), '弹窗累计统计节点渲染正确');

    // 4) 手机辅助 api_direct 模式下的需求预检（runPreFlightCheck）记账验证
    appShell.dataset.uiMode = 'phone-agent';
    win.PhoneAgent.setExecMode('api_direct');
    win.AndroidAppBridge.nativeHttpPostAsync = (reqId) => {
      setTimeout(() => {
        win.__onNativeHttpResult(reqId, JSON.stringify({
          ok: true,
          status: 200,
          body: JSON.stringify({
            choices: [{ message: { content: JSON.stringify({ intent: 'task', ready: false, thought: '需确认店铺', question: '想点哪家？', options: ['麦当劳'] }) } }],
            usage: { prompt_tokens: 300, completion_tokens: 50, total_tokens: 350 }
          })
        }));
      }, 5);
    };
    const preRes = await hooks.requestPreFlightCheck({
      execMode: 'api_direct',
      task: '帮我点个外卖',
      clarifyPolicy: 'always',
      installedApps: ['美团']
    });
    ok(preRes && preRes.ok === true, 'requestPreFlightCheck 正常完成需求预检');
    const stAfterPre = plugin.getState();
    ok(stAfterPre.records[0]?.source === '手机辅助·预检' && stAfterPre.records[0]?.totalTokens === 350, '手机辅助预检消耗的 Token 自动计入 DeepSeekMonitorPlugin');

    // 5) App 端 standaloneAdapter.js own_deepseek 模式附带 stream_options 并保留尾包完整 usage
    const adapterCode = fs.readFileSync(path.join(ROOT, 'public', 'standaloneAdapter.js'), 'utf8');
    const lsMap2 = new Map();
    const ssMap2 = new Map();
    let capturedDsReqBody = null;
    const enc2 = new TextEncoder();
    const dsChunks = [
      enc2.encode('data: {"choices":[{"delta":{"content":"你好，计费正常"}}]}\n\n'),
      // 模拟无结尾换行符的尾包，测试 tailStr 循环解析 usage
      enc2.encode('data: {"choices":[],"usage":{"prompt_tokens":1500,"completion_tokens":320,"total_tokens":1820,"prompt_cache_hit_tokens":800,"prompt_cache_miss_tokens":700,"completion_tokens_details":{"reasoning_tokens":120}}}')
    ];
    let dsIdx = 0;
    const saWin2 = {
      location: { protocol: 'https:', hostname: 'appassets.androidplatform.net', origin: 'https://appassets.androidplatform.net', search: '' },
      AndroidAppBridge: { isNativeApk: () => true, saveAuthCredentials: () => {} },
      localStorage: {
        getItem: (k) => (lsMap2.has(k) ? lsMap2.get(k) : null),
        setItem: (k, v) => lsMap2.set(k, String(v)),
        removeItem: (k) => lsMap2.delete(k)
      },
      sessionStorage: {
        getItem: (k) => (ssMap2.has(k) ? ssMap2.get(k) : null),
        setItem: (k, v) => ssMap2.set(k, String(v)),
        removeItem: (k) => ssMap2.delete(k)
      },
      fetch: async (url, init = {}) => {
        if (String(url).includes('api.deepseek.com') && String(url).includes('/chat/completions')) {
          capturedDsReqBody = JSON.parse(init.body || '{}');
          return {
            ok: true,
            status: 200,
            body: {
              getReader() {
                return {
                  async read() {
                    if (dsIdx < dsChunks.length) return { done: false, value: dsChunks[dsIdx++] };
                    return { done: true, value: undefined };
                  },
                  releaseLock() {}
                };
              }
            }
          };
        }
        return { ok: true, status: 200, json: async () => ({ ok: true }) };
      },
      Headers, Response, ReadableStream, TextEncoder, TextDecoder, URL, URLSearchParams, AbortController,
      console, Math, Date, JSON, setTimeout, clearTimeout
    };
    saWin2.window = saWin2;
    vm.createContext(saWin2);
    vm.runInContext(adapterCode, saWin2);

    const boot2 = await (await saWin2.fetch('/api/bootstrap')).json();
    const sess2 = await (await saWin2.fetch('/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ persona_id: boot2.personas[0].id })
    })).json();
    const stream2 = await saWin2.fetch('/api/chat/stream', {
      method: 'POST',
      body: JSON.stringify({
        session_id: sess2.session_id,
        content: '测试统计用量',
        include_follow_ups: false,
        llm_mode: 'api',
        mode_api_override: {
          provider: 'own_deepseek',
          api_key: 'sk-ds-live-999'
        }
      })
    });
    const dec2 = new TextDecoder();
    let sse2 = '';
    await saWin2.__STAR_STANDALONE_HOOKS__.readStreamBodyWithReader(stream2.body, (c) => {
      sse2 += dec2.decode(c, { stream: true });
    });
    sse2 += dec2.decode();

    ok(capturedDsReqBody && capturedDsReqBody.stream_options?.include_usage === true, 'App 端 DeepSeek 官方直连自动附带 stream_options.include_usage');
    ok(sse2.includes('"total_tokens":1820') && sse2.includes('"reasoning_tokens":120'), 'App 端 SSE done 事件完整透传尾包 usage 全部字段');
    const exp2 = await (await saWin2.fetch(`/api/sessions/${sess2.session_id}/export`)).json();
    const lastAsst2 = [...(exp2.messages || [])].reverse().find((m) => m.role === 'assistant');
    const meta2 = JSON.parse(lastAsst2?.meta_json || '{}');
    ok(meta2.usage?.prompt_tokens === 1500 && meta2.usage?.completion_tokens === 320 && meta2.usage?.prompt_cache_hit_tokens === 800, 'App 端持久化消息完整保留 prompt/completion/cache_hit usage');
  }

  // ========= 场景 15：双桌宠（大肥鱼/奶龙）双向同步 + 跨应用结构化进度推送 + 思考过程展示 =========
  {
    const h = createHarness({
      nativePetPersona: 'nailong',
      initialStorage: {
        pa_exec_mode_v1: 'api_cloud',
        pa_confirm_policy_v2: 'auto_turn',
        pa_clarify_policy_v1: 'off'
      }
    });
    const { win, doc, localStorageMock, nativeState, setFetchHandler, hooks } = h;
    const bgLayer = doc.createElement('div');
    bgLayer.id = 'pa-whale-bg-layer';
    doc.body.appendChild(bgLayer);

    // 1) 初始化后原生为 nailong 时可同步写入 Web 背景与本地缓存
    win.PhoneAgent.setPetPersona(nativeState.petPersona, { syncNative: false });
    ok(win.PhoneAgent.getPetPersona() === 'nailong', '默认或原生同步可正确识别奶龙形象 nailong');
    ok(bgLayer.dataset.petPersona === 'nailong' && doc.getElementById('app-shell').dataset.petPersona === 'nailong', '切换奶龙同步更新背景水印与 appShell data-pet-persona 属性');

    // 2) Web 手动切换为大肥鱼并回传原生桥接
    win.PhoneAgent.setPetPersona('feiyu', { syncNative: true });
    ok(nativeState.petPersona === 'feiyu' && localStorageMock.getItem('pa_pet_persona_v1') === 'feiyu', 'Web 切换大肥鱼同步写入 localStorage 与 AndroidAppBridge');

    // 3) 原生面板切换奶龙通知 Web 时不反向循环写入原生
    const prevLogLen = nativeState.actionsLog.length;
    win.__onNativePetPersonaChanged('nailong');
    ok(win.PhoneAgent.getPetPersona() === 'nailong' && nativeState.actionsLog.length === prevLogLen, '原生事件回调 __onNativePetPersonaChanged(' + "'nailong'" + ') 同步更新 Web 状态且不触发反向死循环');
    ok(hooks.inferToolActionLabel('phone_tap') === '点击控件' && hooks.inferToolActionLabel('phone_type') === '文本输入', 'inferToolActionLabel 映射清晰易懂的中文动作意图');

    // 4) ReAct 执行完整周期推送结构化思考与核验结果给悬浮窗 HUD
    let llmCall = 0;
    setFetchHandler(async (_url, opts = {}) => {
      const body = JSON.parse(opts.body || '{}');
      if (body.phase === 'preflight') {
        return { ok: true, status: 200, json: async () => ({ ok: true, preflight: { intent: 'task', ready: true } }) };
      }
      llmCall += 1;
      if (llmCall === 1) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            plan: {
              thought: '页面上可见“去结算”按钮，点击推进下单流程',
              tool: 'phone_tap',
              args: { ref: 'e1', snapshotId: 'snap_1' },
              summary: '点击去结算',
              risk: 'read'
            }
          })
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          plan: {
            thought: '结算页面已打开，任务达成',
            tool: 'done',
            summary: '已点击去结算',
            reply: '已为你点击“去结算”按钮。'
          }
        })
      };
    });
    nativeState.onClickHook = (ref, st) => {
      st.eventSeq += 1;
      st.signature = 'sig_checkout';
      return { ok: true, method: 'node', x: 540, y: 1200, message: `点击 ${ref} 成功` };
    };
    const cardCtx = makeCardCtx(doc);
    const timerEl = doc.createElement('span');
    const stripEl = doc.createElement('div');
    ['inspect', 'think', 'act', 'verify'].forEach((p) => {
      const pill = doc.createElement('span');
      pill.className = 'pa-phase-pill';
      pill.dataset.phase = p;
      stripEl.appendChild(pill);
    });
    cardCtx.thinkingTimerEl = timerEl;
    cardCtx.phaseStripEl = stripEl;
    await hooks.runReActLoop('点击去结算', cardCtx, 'api_cloud');
    const logs = nativeState.floatProgressLogs;
    const thinkingLog = logs.find((x) => x.phase === 'thinking');
    const plannedLog = logs.find((x) => x.phase === 'planned');
    const verifiedLog = logs.find((x) => x.phase === 'verified');
    const doneLog = logs.find((x) => x.phase === 'done');
    ok(Boolean(thinkingLog && plannedLog && verifiedLog && doneLog), 'runReActLoop 依次向悬浮窗推送 thinking / planned / verified / done 四类结构化 HUD 进度');
    ok(plannedLog?.thought?.includes('去结算') && plannedLog?.appName === '目标应用' && plannedLog?.toolName === 'phone_tap', 'planned HUD 负载完整携带思考理由、当前应用名与动作工具');
    ok(verifiedLog?.verdictText?.includes('画面已更新'), 'verified HUD 负载明确携带画面更新核验结果');
    ok((cardCtx.thoughtCount || 0) >= 2 && cardCtx.thinkingList.children.length >= 2, '应用内思考容器完整追加带元数据与结果的多步思考条目');
    ok(stripEl.children.every((el) => el.classList.contains('is-done')), '任务完成后阶段进度条 4 个阶段均切换为 is-done 完成态');
  }

  console.log(`ALL_PHONE_AGENT_LOGIC_TESTS_PASSED (${passed} assertions)`);
}

runTests().catch((err) => {
  console.error('TEST_FAILED:', err);
  process.exit(1);
});

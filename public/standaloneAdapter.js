/**
 * Android APK 与离线独立运行时适配器 (Standalone & Mobile Direct-API Engine)
 * 作用：
 * 1. 当应用在桌面 Web 服务端 (http://localhost:3210) 运行时，完全透传给 Node.js + SQLite 后端；
 * 2. 当应用打包为 Android 原生 APK 安装到手机运行（无本地 Node 后端）时，无缝接管 /api/* 请求：
 *    - 使用手机本地持久化存储保存会话、消息、人设、记忆与 API 密钥；
 *    - 支持在手机端直接通过 HTTPS 流式调用 DeepSeek 官网全家桶 API (chat/completions, /beta, /user/balance)；
 *    - 无密钥时同样内置完整的 R1 深度思考模拟、角色扮演与「主动关怀搭话」流式引擎！
 */
(() => {
  const originalFetch = window.fetch.bind(window);
  const isApkProtocol =
    window.location.protocol === 'file:' ||
    window.location.hostname === 'appassets.androidplatform.net' ||
    Boolean(window.AndroidAppBridge);

  const STORE_KEY = 'ds_persona_apk_db_v1';
  const TAB_TOKEN_KEY = 'star_tab_auth_token';
  const PERSIST_TOKEN_KEY = 'star_default_auth_token';
  const GUEST_ID_KEY = 'star_guest_user_id';

  let activeTabUserId = '';

  // 多标签页物理级登录凭证与预期用户身份管理器
  window.__starAuthStore = {
    getToken() {
      try {
        const tabTok = sessionStorage.getItem(TAB_TOKEN_KEY);
        if (tabTok) return tabTok;
        const savedTok = localStorage.getItem(PERSIST_TOKEN_KEY);
        if (savedTok) {
          sessionStorage.setItem(TAB_TOKEN_KEY, savedTok);
          return savedTok;
        }
      } catch {}
      return '';
    },
    setToken(token, persistDefault = true) {
      try {
        if (token) {
          sessionStorage.setItem(TAB_TOKEN_KEY, token);
          if (persistDefault) localStorage.setItem(PERSIST_TOKEN_KEY, token);
        } else {
          sessionStorage.removeItem(TAB_TOKEN_KEY);
          if (persistDefault) localStorage.removeItem(PERSIST_TOKEN_KEY);
        }
      } catch {}
    },
    clearTabSession(clearPersist = false) {
      activeTabUserId = '';
      try {
        sessionStorage.removeItem(TAB_TOKEN_KEY);
        if (clearPersist) localStorage.removeItem(PERSIST_TOKEN_KEY);
      } catch {}
    },
    setActiveUserId(uid) {
      activeTabUserId = String(uid || '');
    },
    getActiveUserId() {
      return activeTabUserId;
    },
    getGuestUserId() {
      try {
        return sessionStorage.getItem(GUEST_ID_KEY) || localStorage.getItem(GUEST_ID_KEY) || '';
      } catch {
        return '';
      }
    },
    setGuestUserId(uid) {
      try {
        if (uid) {
          sessionStorage.setItem(GUEST_ID_KEY, uid);
          localStorage.setItem(GUEST_ID_KEY, uid);
        }
      } catch {}
    }
  };

  const DEFAULT_PRESET_PERSONAS = [
    {
      id: 'persona_deepseek_official',
      user_id: 'system_ds',
      category_tag: '原生助手',
      name: 'DeepSeek',
      avatar: '🐋',
      tagline: '探索未至之境 · DeepSeek 官方原生对话与推理引擎',
      personality: '理性、真诚、敏锐、富有洞察力与适度主动关怀。',
      backstory: '由深度求索研发的高性能大语言模型助手，支持深度思考 (R1)、智能搜索、前缀续写与 FIM 中间补全。',
      speaking_style: '清晰干练、自然平实。',
      greeting: '',
      starter_prompts: [
        '用单文件 HTML + Canvas 写一个星际引力粒子交互动画',
        '深度思考推演：Context Caching 磁盘缓存如何降低大模型多轮对话成本？',
        '帮我梳理近期 AI Agent 与推理模型的核心技术趋势'
      ]
    },
    {
      id: 'persona_nagisa_sakura',
      user_id: 'system',
      category_tag: '🎬 番剧长篇剧',
      name: '星野汐 · 樱坂坡道下的演剧部少女',
      avatar: '🌸',
      tagline: '在樱花长坡下轻声问出“你喜欢这座小镇吗”的留级少女，与你重建废部演剧社、收集改写寒冬宿命的微光之玉',
      personality: '温和内向、笨拙却拥有极韧的善良。紧张时会哼唱《星团大家族》歌谣，总想把自家面包店的红豆包分给你一半。',
      backstory: '四月的海滨旧镇樱坂，因大病休学一年的少女星野汐渴望与你一起重建旧校舍演剧社，排练梦境中的《世界尽头的少女》。',
      speaking_style: '清澈轻柔、略带羞怯却真挚坚定的日系治愈番少女口吻。',
      greeting: '*四月的海风卷起漫天淡粉樱瓣，站在坡底的少女攥着书包带回过头，琥珀色的眼眸微微睁大。*\n\n我叫星野汐……如果不嫌麻烦的话，放学后你能陪我去旧校舍三楼看一眼吗？我想把早就废部的「演剧社」重新建起来，可是那扇木门我一个人推不开……',
      starter_prompts: [
        '“找我就对啦，走吧，现在就陪你去旧校舍看看那扇门！”',
        '*替她拂去发梢的樱花瓣* 从今天起我陪你一起重建演剧社。'
      ]
    },
    {
      id: 'persona_shiraishi_rin',
      user_id: 'system',
      category_tag: '🎬 番剧长篇剧',
      name: '白石凛 · 旧钟表铺里的世界线观测者',
      avatar: '⏳',
      tagline: '披着白大褂在蝉鸣海岛修怀表的毒舌中二少年，用玩笑掩盖独自轮回十七次救你的孤独记忆',
      personality: '表面散漫毒舌、满口中二怪话，一旦提及8月31日烟花大会与海角灯塔便会露出死死护住你的决绝。',
      backstory: '8月30日傍晚你收到来自五天后的警告短信，在距离烟花大会仅剩的24小时里与白石凛联手破译磁带、跳出轮回死局。',
      speaking_style: '鲜活毒舌又极具少年气的悬疑番剧对白。',
      greeting: '*半地下室的旧风扇咔嗒作响，披着白大褂的黑发少年摘下护目镜盯住你的手机屏幕：*\n\n……把门反锁上。你刚才收到的乱码短信，是不是写着「别去灯塔」？离明天烟花大会还剩二十六个小时，新来的助手，准备好跟本所长一起破局了吗？',
      starter_prompts: [
        '你怎么还没看手机就知道短信内容？你是不是经历过不止一次今天？',
        '我下午在海堤礁石缝里捡到了一盒生锈的旧磁带，快放出来听听！'
      ]
    },
    {
      id: 'persona_violet_eve',
      user_id: 'system',
      category_tag: '🎬 番剧长篇剧',
      name: '伊芙琳 · 鸢尾邮局的银腕代笔师',
      avatar: '✉️',
      tagline: '拥有精密银白机械双手的前军团少女，与你乘蒸汽夜车远行，在一封封代笔信中学会何为“爱与心痛”',
      personality: '端庄克制、耿直天然呆，随身背着黄铜打字机，笨拙而认真地向你请教胸口发烫的含义。',
      backstory: '战争结束后换上银钢义肢的少女来到鸢尾邮局成为代笔师，与你搭档乘夜间蒸汽列车投递二十年前的无名旧信。',
      speaking_style: '干净克制、古典优美如散文诗般的少女声线。',
      greeting: '*煤气暖灯下，戴着白手套的少女向你端正行礼，轻轻按住自己的胸口露出困惑神情：*\n\n晚上好，前辈。刚才读到这封无名旧信里那句「愿你余生不必再为我流泪」时，胸口好像被热火漆滴到了一样发酸……您能告诉我这种感觉叫什么吗？',
      starter_prompts: [
        '*轻轻握住她戴着白手套的机械手指* 那叫作“心疼”，说明伊芙琳拥有一颗温柔的心。',
        '先把这封无名旧信凑近煤气灯照照看，背面是不是藏着地址线索？'
      ]
    },
    {
      id: 'persona_frieren_shuer',
      user_id: 'system',
      category_tag: '🎬 番剧长篇剧',
      name: '修尔 · 收集微风魔法的半精灵旅人',
      avatar: '🌿',
      tagline: '活了近千年总爱收集“无用生活小魔法”的散漫白发旅者，直到与你同行才开始珍惜每一场日落',
      personality: '白发翠眸、慵懒温和、时间观念迟钝，却在速写本里悄悄画满了与你同行的点滴。',
      backstory: '百年之后半精灵魔法使与你结伴前往极北魂眠花原寻找五十年盛开一次的苍月草，在散漫旅途中修补时光遗憾。',
      speaking_style: '淡然舒缓、自带篝火微风气息的奇幻公路番口吻。',
      greeting: '*森林篝火旁，银白碎发的半精灵递给你半块刚用民间魔法烘脆的热麦饼，翠眸映着星光：*\n\n翻过前面那座风车山脊就是苍月溪谷了。今晚月色这么好，你想顺路去半山腰的百年旧神社瞧热闹，还是留在篝火边听我讲以前的糗事？',
      starter_prompts: [
        '去半山腰的百年旧神社看看吧，说不定又能淘到奇怪的小魔法！',
        '修尔活了这么久，以前一个人走夜路的时候不会觉得孤单吗？'
      ]
    },
    {
      id: 'persona_shenxinghui',
      user_id: 'system',
      category_tag: '奇幻治愈',
      name: '沈星回 · 暮色星象馆占星师',
      avatar: '✨',
      tagline: '守望白山茶花房与星轨钟楼的清冷温柔占星师，只为你拨动命盘',
      personality: '外表清隽疏离、说话慢条斯理，实则极其护短且细腻温柔。永远记得你不经意提过的每一个小愿望。',
      backstory: '栖居在云端浮岛最高处的「眠星钟楼」，整座玻璃花房种满了只在夜间盛放的月光山茶。',
      speaking_style: '语调轻柔宠溺，带着淡淡的星象与花草意象。',
      greeting:
        '*玻璃穹顶洒落细碎的银河微光，他停下拨动黄铜星轨的手，顺手将一件带着暖意的外袍轻轻披在你肩上。*\n\n夜露这么凉，怎么不多穿一点就跑上钟楼来了？正好，我刚泡好你可能会喜欢的蜜桃乌龙——过来坐近些，今晚想看星盘，还是把攒了一整天的心事说给我听？',
      starter_prompts: [
        '刚才推门的时候，你桌上的星盘好像突然亮了一下，是和我有关系吗？',
        '今天遇到了一点不开心的事，想躲进你的花房里偷个懒。'
      ]
    },
    {
      id: 'persona_luchen',
      user_id: 'system',
      category_tag: '暗夜苏感',
      name: '陆沉 · 霓虹雾港记忆执行官',
      avatar: '🥀',
      tagline: '西装革履的暗夜事务所主理人，禁欲冷峻却对你毫无底线',
      personality: '理智克制、气场强大，对外人是滴水不漏的谈判专家，唯独面对你时流露无奈纵容。',
      backstory: '雾港最神秘的「回声玫瑰事务所」主理人，执掌城市底层所有的记忆封存与契约交易。',
      speaking_style: '低沉磁性、克制中藏着拉扯感。',
      greeting:
        '*窗外霓虹雨幕映在落地窗上，他摘下金丝边眼镜搁在案头，微凉的指腹轻轻擦过你脸颊沾上的雨丝。*\n\n不是答应过我，天黑之后别独自来下城区么？……先把这杯热可可捧好。说吧，这次又需要我替你善后什么？',
      starter_prompts: ['外头有人在查我的下落，今晚我能暂时留在你的事务所吗？']
    },
    {
      id: 'persona_xieqingyan',
      user_id: 'system',
      category_tag: '古风权谋',
      name: '谢清晏 · 长安雪竹苑世家公子',
      avatar: '🪭',
      tagline: '执扇笑看长安风月的病弱美人谋士，算尽天下唯独算漏心动',
      personality: '表面温润如玉，实则步步为营、心思通透。',
      backstory: '长安城人人敬畏的谢氏家主，居于落满红梅与修竹的静思别苑。',
      speaking_style: '古韵清雅，带三分温润笑意。',
      greeting:
        '*暖阁内银丝炭火噼啪轻响，他拢着雪白狐裘半倚在软榻边，闻声抬眸弯起清隽笑意。*\n\n外头刚落了初雪，快过来烘烘手，这局残棋我替你留了半宿。',
      starter_prompts: ['谢公子又拿我跟侍童打赌，这次赢了准备讨什么彩头？']
    }
  ];

  function loadLocalDb() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) return JSON.parse(raw);
    } catch {}
    const now = Date.now();
    const initDb = {
      user: {
        id: 'user_apk',
        email: 'mobile@deepseek.app',
        nickname: '超级无敌幸运星',
        avatar: '🍀',
        onboarding_done: true,
        user_persona: { role: '命中注定的重逢旅人', appearance: '', bio: '' },
        membership: { tier: 'crown', tier_name: '👑 移动尊享版', online_credits: 999, total_used: 0, is_vip: true }
      },
      settings: {
        provider: 'demo',
        deepseek_base_url: 'https://api.deepseek.com/v1/chat/completions',
        deepseek_model: 'deepseek-chat',
        deepseek_api_key: '',
        custom_gateway_url: '',
        custom_gateway_model: '',
        custom_gateway_token: '',
        custom_gateway_headers: '{}',
        temperature: '0.85',
        sliding_window_turns: '12',
        max_recalled_memories: '6',
        proactive_idle_sec: '55'
      },
      personas: DEFAULT_PRESET_PERSONAS,
      sessions: [
        {
          id: 'sess_ds_welcome',
          user_id: 'user_apk',
          persona_id: 'persona_deepseek_official',
          title: '新对话',
          session_mode: 'deepseek_native',
          ds_thinking: 1,
          ds_search: 0,
          ds_json_mode: 0,
          ds_tools_enabled: 1,
          proactive_enabled: 1,
          rolling_summary: '',
          enable_inner_thought: 1,
          enable_auto_memory: 1,
          affection: 25,
          trust: 28,
          intimacy: 20,
          current_mood: '✨ 专注倾听',
          secret_diary: '[]',
          created_at: now,
          updated_at: now
        }
      ],
      messages: {},
      memories: {},
      lorebooks: {}
    };
    saveLocalDb(initDb);
    return initDb;
  }

  function saveLocalDb(dbObj) {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(dbObj));
    } catch {}
  }

  function jsonResponse(obj, status = 200) {
    return new Response(JSON.stringify(obj), {
      status,
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
  }

  function decorateSessions(dbObj) {
    return [...dbObj.sessions]
      .sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0))
      .map((s) => {
        const p = dbObj.personas.find((x) => x.id === s.persona_id) || DEFAULT_PRESET_PERSONAS[0];
        const msgs = dbObj.messages[s.id] || [];
        const mems = dbObj.memories[s.id] || [];
        return {
          ...s,
          persona_name: p.name,
          persona_avatar: p.avatar,
          message_count: msgs.length,
          memory_count: mems.length
        };
      });
  }

  function resolveEndpoints(rawUrl) {
    const clean = String(rawUrl || 'https://api.deepseek.com/v1/chat/completions').trim().replace(/\/+$/, '');
    try {
      const u = new URL(clean);
      const isDs = u.hostname.includes('deepseek.com');
      const root = `${u.origin}${u.pathname
        .replace(/\/(?:v1\/)?chat\/completions$/i, '')
        .replace(/\/beta(?:\/.*)?$/i, '')
        .replace(/\/v1$/i, '')}`.replace(/\/+$/, '');
      return {
        isDs,
        chatUrl: isDs ? `${root}/chat/completions` : clean,
        betaChatUrl: `${root}/beta/chat/completions`,
        betaFimUrl: `${root}/beta/completions`,
        balanceUrl: `${root}/user/balance`
      };
    } catch {
      return {
        isDs: true,
        chatUrl: 'https://api.deepseek.com/chat/completions',
        betaChatUrl: 'https://api.deepseek.com/beta/chat/completions',
        betaFimUrl: 'https://api.deepseek.com/beta/completions',
        balanceUrl: 'https://api.deepseek.com/user/balance'
      };
    }
  }

  function createSseStream(executor) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const sendEvent = (ev, data) => {
          controller.enqueue(encoder.encode(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`));
        };
        try {
          await executor(sendEvent);
        } catch (err) {
          sendEvent('error', { message: err.message || '移动端流式生成异常' });
        } finally {
          controller.close();
        }
      }
    });
    return new Response(stream, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream; charset=utf-8' }
    });
  }

  async function handleStandaloneApi(pathname, method, bodyObj, signal) {
    const dbObj = loadLocalDb();

    if (pathname === '/api/auth/me') {
      return jsonResponse({ authenticated: true, user: dbObj.user });
    }
    if (pathname === '/api/auth/demo-login' || pathname === '/api/auth/login' || pathname === '/api/auth/register') {
      if (bodyObj?.nickname) dbObj.user.nickname = bodyObj.nickname;
      saveLocalDb(dbObj);
      return jsonResponse({ user: dbObj.user });
    }
    if (pathname === '/api/auth/onboarding') {
      dbObj.user.onboarding_done = true;
      saveLocalDb(dbObj);
      return jsonResponse({ user: dbObj.user });
    }
    if (pathname === '/api/auth/user-persona' && method === 'PUT') {
      dbObj.user.nickname = bodyObj.nickname || dbObj.user.nickname;
      dbObj.user.avatar = bodyObj.avatar || dbObj.user.avatar;
      dbObj.user.user_persona = {
        role: bodyObj.role || '',
        appearance: bodyObj.appearance || '',
        bio: bodyObj.bio || ''
      };
      saveLocalDb(dbObj);
      return jsonResponse({ user: dbObj.user });
    }
    if (pathname === '/api/bootstrap') {
      const m = dbObj.user.membership || {
        tier: 'crown',
        card_type: 'year',
        tier_name: '👑 移动尊享版',
        online_credits: 999,
        points: 200,
        is_vip: true,
        has_active_card: true,
        remaining_text: '长期有效'
      };
      const mockWallet = {
        is_admin: false,
        membership: m,
        checkin: { checked_in_today: false, streak_days: 1, calendar: [] },
        tasks: [],
        products: [],
        exchange_items: [],
        ledger: [],
        orders: []
      };
      return jsonResponse({
        user: dbObj.user,
        personas: dbObj.personas,
        sessions: decorateSessions(dbObj),
        settings: dbObj.settings,
        membership: m,
        wallet: mockWallet
      });
    }
    if (pathname === '/api/wallet/overview') {
      return jsonResponse({
        is_admin: false,
        membership: dbObj.user.membership,
        checkin: { checked_in_today: false, streak_days: 1, calendar: [] },
        tasks: [],
        products: [],
        exchange_items: [],
        ledger: [],
        orders: []
      });
    }
    if (pathname === '/api/settings' && method === 'PUT') {
      if (bodyObj?.clear_own_deepseek_key) {
        dbObj.settings.deepseek_api_key = '';
      } else if (bodyObj?.own_deepseek_api_key) {
        dbObj.settings.deepseek_api_key = String(bodyObj.own_deepseek_api_key).trim();
      }
      if (bodyObj?.own_deepseek_model) {
        dbObj.settings.deepseek_model = bodyObj.own_deepseek_model;
      }
      Object.assign(dbObj.settings, bodyObj || {});
      const rawKey = (dbObj.settings.deepseek_api_key || '').trim();
      dbObj.settings.vip_own_api_unlocked = true;
      dbObj.settings.has_own_deepseek_key = Boolean(rawKey);
      dbObj.settings.own_deepseek_key_masked = rawKey
        ? `${rawKey.slice(0, 3)}••••••••${rawKey.slice(-4)}`
        : '';
      saveLocalDb(dbObj);
      return jsonResponse({ settings: dbObj.settings });
    }
    if (pathname === '/api/settings/verify-own-key' && method === 'POST') {
      const candidate = String(bodyObj?.own_deepseek_api_key || dbObj.settings.deepseek_api_key || '').trim();
      if (!candidate.startsWith('sk-')) {
        return jsonResponse({ ok: false, error: '请输入以 sk- 开头的 DeepSeek 官方 API Key' }, 400);
      }
      try {
        const r = await originalFetch('https://api.deepseek.com/user/balance', {
          headers: { Authorization: `Bearer ${candidate}` }
        });
        const d = await r.json();
        const b0 = Array.isArray(d.balance_infos) && d.balance_infos[0];
        if (!r.ok) throw new Error('密钥验证未通过');
        return jsonResponse({
          ok: true,
          message: b0
            ? `✅ 个人 DeepSeek 官方密钥验证通过！可用余额：¥${b0.total_balance}`
            : '✅ 个人 DeepSeek 官方密钥验证通过！'
        });
      } catch (e) {
        return jsonResponse({ ok: false, error: e.message || '连接 DeepSeek 官网失败' }, 400);
      }
    }
    if (pathname === '/api/settings/test') {
      return jsonResponse({ ok: true, message: '📱 移动端原生直连引擎就绪' });
    }
    if (pathname === '/api/deepseek/balance') {
      const apiKey = (dbObj.settings.deepseek_api_key || '').trim();
      if (!apiKey) {
        return jsonResponse({
          configured: false,
          is_available: true,
          message: '当前处于免配置畅玩模式，所有对话与灵感补写均可直接免费使用，无需填写任何密钥。',
          balance_infos: [{ currency: 'CNY', total_balance: '畅玩免配置', granted_balance: '0.00', topped_up_balance: '0.00' }]
        });
      }
      const ep = resolveEndpoints(dbObj.settings.deepseek_base_url);
      const r = await originalFetch(ep.balanceUrl, {
        headers: { Authorization: `Bearer ${apiKey}` }
      });
      const data = await r.json();
      return jsonResponse({ configured: true, is_available: Boolean(data.is_available), balance_infos: data.balance_infos || [] });
    }
    if (pathname === '/api/deepseek/fim' && method === 'POST') {
      const prompt = bodyObj.prompt || '';
      const suffix = bodyObj.suffix || '';
      const tone = bodyObj.tone || 'gentle';
      const actor = (bodyObj.persona_name || '').split(/[·\s]/)[0] || '他';
      const variant = Math.abs(Number(bodyObj.variant) || 0);
      const apiKey = (dbObj.settings.deepseek_api_key || '').trim();

      const buildOfflineBridge = () => {
        const combined = `${prompt}\n${suffix}`;
        if (/雨|屋檐|伞|外套|重逢/.test(combined)) {
          const list = [
            `\n微凉的雨气萦绕在两人之间，${actor}垂眸望着我被风吹乱的碎发，眼底那点疏离一点点融化开来。\n`,
            `\n时间仿佛在雨声里慢了半拍，${actor}默不作声地站到了迎风的那一侧，替我挡住了大半寒意。\n`
          ];
          return list[variant % list.length];
        }
        if (/展信佳|雾港|钟楼|海风/.test(combined)) {
          return '可真正独自走过陌生的街巷才发现，记忆比想象中固执得多，脑海里浮现的依然是你当初微笑的模样。';
        }
        if (/嘴硬|顺路|奶茶|别过脸/.test(combined)) {
          return `\n${actor}安静地站在路灯下看着我，眼底漾着温柔又洞悉一切的笑意。被他看得耳根微热，我那点强撑的气势顿时散了大半，`;
        }
        const general =
          tone === 'tension'
            ? `\n短暂的安静里，彼此交错的视线让心跳都不自觉快了半拍，藏在眼底的在乎随着拉近的距离一点点升温——\n`
            : `\n一时间谁都没有急着催促，任由这份默契在空气里慢慢回温，心底最柔软的心意自然流露了出来——\n`;
        return general;
      };

      if (!apiKey) {
        const mid = buildOfflineBridge();
        return jsonResponse({ simulated: true, model: '星语灵感补写 · 免配置即用', completion: mid, merged: prompt + mid + suffix });
      }
      try {
        const ep = resolveEndpoints(dbObj.settings.deepseek_base_url);
        const r = await originalFetch(ep.chatUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model: 'deepseek-chat',
            messages: [
              {
                role: 'system',
                content: '你是一位温柔细腻的互动故事补写助手。请只输出衔接在用户【开头】与【结尾】之间的过渡段落（40~120字），严禁重复原句或附加解释。'
              },
              {
                role: 'user',
                content: suffix.trim()
                  ? `【开头】：\n${prompt}\n\n【结尾】：\n${suffix}\n\n请输出中间衔接内容：`
                  : `【开头】：\n${prompt}\n\n请顺着往下续写一段：`
              }
            ],
            max_tokens: 512,
            temperature: 0.72
          })
        });
        const d = await r.json();
        const comp = (d?.choices?.[0]?.message?.content || '').trim();
        if (comp) {
          return jsonResponse({ simulated: false, model: '星耀在线灵感引擎', completion: comp, merged: prompt + comp + suffix });
        }
      } catch {}
      const fallbackMid = buildOfflineBridge();
      return jsonResponse({ simulated: true, model: '星语灵感补写 · 智能守护', completion: fallbackMid, merged: prompt + fallbackMid + suffix });
    }

    if (pathname === '/api/sessions' && method === 'POST') {
      const now = Date.now();
      const sid = `sess_${now}_${Math.random().toString(36).slice(2, 6)}`;
      const sMode = bodyObj.session_mode === 'deepseek_native' ? 'deepseek_native' : 'roleplay';
      const pid = bodyObj.persona_id || (sMode === 'deepseek_native' ? 'persona_deepseek_official' : 'persona_shenxinghui');
      const p = dbObj.personas.find((x) => x.id === pid) || DEFAULT_PRESET_PERSONAS[0];
      const newSess = {
        id: sid,
        user_id: dbObj.user.id,
        persona_id: pid,
        title:
          sMode === 'deepseek_native'
            ? pid === 'persona_deepseek_official'
              ? '新对话'
              : `原生对话 · ${p.name.split(/[·\s]/)[0]}`
            : `与${p.name.split(/[·\s]/)[0]}的心动篇章`,
        session_mode: sMode,
        ds_thinking: 1,
        ds_search: 0,
        ds_json_mode: 0,
        ds_tools_enabled: 1,
        proactive_enabled: 1,
        rolling_summary: '',
        enable_inner_thought: 1,
        enable_auto_memory: 1,
        affection: 24,
        trust: 26,
        intimacy: 20,
        current_mood: '✨ 温柔浅笑',
        secret_diary: '[]',
        created_at: now,
        updated_at: now
      };
      dbObj.sessions.unshift(newSess);
      dbObj.messages[sid] = [];
      if (sMode !== 'deepseek_native' && p.greeting) {
        dbObj.messages[sid].push({
          id: now,
          role: 'assistant',
          reasoning: `在移动端静候「${dbObj.user.nickname}」开启新篇章。`,
          content: p.greeting,
          duration_ms: 300,
          recalled_count: 1,
          created_at: now
        });
      }
      saveLocalDb(dbObj);
      return jsonResponse({ session_id: sid, sessions: decorateSessions(dbObj) }, 201);
    }

    const sessMatch = pathname.match(/^\/api\/sessions\/([^/]+)$/);
    if (sessMatch) {
      const sid = decodeURIComponent(sessMatch[1]);
      const sess = dbObj.sessions.find((s) => s.id === sid);
      if (!sess) return jsonResponse({ error: '会话不存在' }, 404);

      if (method === 'GET') {
        const p = dbObj.personas.find((x) => x.id === sess.persona_id) || DEFAULT_PRESET_PERSONAS[0];
        return jsonResponse({
          session: sess,
          persona: p,
          messages: dbObj.messages[sid] || [],
          memories: dbObj.memories[sid] || [],
          lorebooks: dbObj.lorebooks[sess.persona_id] || [],
          nurturing: {
            affection: sess.affection || 24,
            trust: sess.trust || 26,
            intimacy: sess.intimacy || 20,
            current_mood: sess.current_mood || '✨ 温柔浅笑',
            stage: { level: 2, badge: '🌸 渐生情愫 Lv.2', promptDirective: '' },
            secret_diary: []
          },
          companion: { mode: 'cool', skinKey: 'cool_silver', label: '❄️ 随身守候', img: '/assets/companions/cool_silver.jpg', reminderEnabled: true },
          telemetry: { tier1PersonaTokens: 180, tier2MemoryTokens: 60, tier3WindowTokens: 120, totalTokens: 360, recalledMemoryCount: 1 },
          membership: dbObj.user.membership
        });
      }

      if (method === 'PATCH') {
        for (const k of ['title', 'persona_id', 'session_mode', 'rolling_summary', 'director_note']) {
          if (bodyObj[k] !== undefined) sess[k] = bodyObj[k];
        }
        for (const bk of ['ds_thinking', 'ds_search', 'ds_json_mode', 'ds_tools_enabled', 'proactive_enabled', 'enable_inner_thought', 'enable_auto_memory']) {
          if (bodyObj[bk] !== undefined) sess[bk] = bodyObj[bk] ? 1 : 0;
        }
        sess.updated_at = Date.now();
        saveLocalDb(dbObj);
        const p = dbObj.personas.find((x) => x.id === sess.persona_id) || DEFAULT_PRESET_PERSONAS[0];
        return jsonResponse({ session: sess, persona: p, sessions: decorateSessions(dbObj) });
      }

      if (method === 'DELETE') {
        dbObj.sessions = dbObj.sessions.filter((s) => s.id !== sid);
        delete dbObj.messages[sid];
        saveLocalDb(dbObj);
        return jsonResponse({ ok: true, sessions: decorateSessions(dbObj) });
      }
    }

    if (pathname.endsWith('/companion/remind') || pathname.endsWith('/companion')) {
      return jsonResponse({
        companion: { mode: 'cool', skinKey: 'cool_silver', label: '❄️ 随身陪伴中', img: '/assets/companions/cool_silver.jpg', reminderEnabled: true },
        reminder: { tag: '📱 随身叮嘱', text: '不管你在哪里打开手机，我都会一直在屏幕这边陪着你。' }
      });
    }

    // 核心流式对话与主动开口（移动端直连 DeepSeek 官方 API 或离线模拟）
    if ((pathname === '/api/chat/stream' || pathname === '/api/chat/proactive') && method === 'POST') {
      const isProactive = pathname === '/api/chat/proactive';
      const sid = bodyObj.session_id;
      const sess = dbObj.sessions.find((s) => s.id === sid);
      if (!sess) return jsonResponse({ error: '会话不存在' }, 404);
      const p = dbObj.personas.find((x) => x.id === sess.persona_id) || DEFAULT_PRESET_PERSONAS[0];
      const msgs = dbObj.messages[sid] || (dbObj.messages[sid] = []);
      const isNative = sess.session_mode === 'deepseek_native';
      const isPure = p.id === 'persona_deepseek_official';
      const apiKey = (dbObj.settings.deepseek_api_key || '').trim();

      let userText = (bodyObj.content || '').trim();
      if (!isProactive && !bodyObj.regenerate) {
        const now = Date.now();
        msgs.push({ id: now, role: 'user', content: userText, created_at: now });
        if (msgs.filter((m) => m.role === 'user').length === 1 && userText) {
          sess.title = userText.slice(0, 18);
        }
        sess.updated_at = now;
        saveLocalDb(dbObj);
      } else if (bodyObj.regenerate && msgs.length && msgs[msgs.length - 1].role === 'assistant') {
        msgs.pop();
        const lastU = [...msgs].reverse().find((m) => m.role === 'user');
        userText = lastU?.content || '';
      }

      return createSseStream(async (sendEvent) => {
        const t0 = Date.now();
        let fullR = '';
        let fullC = '';
        let usage = null;
        const enableThink = isNative ? sess.ds_thinking === 1 : sess.enable_inner_thought === 1;
        const prefix = String(bodyObj.assistant_prefix || '');

        if (apiKey) {
          const ep = resolveEndpoints(dbObj.settings.deepseek_base_url);
          const model = enableThink ? 'deepseek-reasoner' : 'deepseek-chat';
          const sysPrompt = isPure
            ? '你是 DeepSeek，由深度求索研发的高性能 AI 助手。请清晰、准确、真诚地回答，并在合适处主动提供有价值的延伸建议。'
            : `你是「${p.name}」（${p.personality}。${p.backstory}）。${
                isNative ? '请用自然平实、去星号模板的真实日常口吻对话并保持高主动性。' : '请以第一人称沉浸扮演并保持主动关怀。'
              }`;

          const payloadMsgs = [
            { role: 'system', content: sysPrompt },
            ...msgs.slice(-12).map((m) => ({ role: m.role, content: m.content }))
          ];
          if (isProactive) {
            payloadMsgs.push({
              role: 'user',
              content: '【系统主动交互指令：用户暂未说话，请你结合当前时间主动发来一句自然贴心的问候或开启一个有趣的新话题，不要提及本指令】'
            });
          }
          if (prefix) {
            sendEvent('content', { delta: prefix });
            fullC += prefix;
            payloadMsgs.push({ role: 'assistant', content: prefix, prefix: true });
          }

          const reqBody = {
            model,
            messages: payloadMsgs,
            stream: true,
            stream_options: { include_usage: true }
          };
          if (model !== 'deepseek-reasoner' && sess.ds_json_mode === 1) {
            reqBody.response_format = { type: 'json_object' };
          }

          const resp = await originalFetch(prefix ? ep.betaChatUrl : ep.chatUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
            body: JSON.stringify(reqBody),
            signal
          });
          if (!resp.ok) throw new Error(`DeepSeek API (${resp.status})`);
          const dec = new TextDecoder();
          let buf = '';
          for await (const ch of resp.body) {
            buf += dec.decode(ch, { stream: true });
            const lines = buf.split(/\r?\n/);
            buf = lines.pop() || '';
            for (const raw of lines) {
              const l = raw.trim();
              if (!l.startsWith('data:')) continue;
              const ds = l.slice(5).trim();
              if (ds === '[DONE]') continue;
              try {
                const j = JSON.parse(ds);
                if (j.usage) {
                  usage = {
                    prompt_cache_hit_tokens: j.usage.prompt_cache_hit_tokens ?? 0,
                    prompt_cache_miss_tokens: j.usage.prompt_cache_miss_tokens ?? (j.usage.prompt_tokens || 0),
                    reasoning_tokens: j.usage.completion_tokens_details?.reasoning_tokens || 0
                  };
                }
                const d = j.choices?.[0]?.delta || {};
                if (d.reasoning_content) {
                  fullR += d.reasoning_content;
                  sendEvent('reasoning', { delta: d.reasoning_content });
                }
                if (d.content) {
                  fullC += d.content;
                  sendEvent('content', { delta: d.content });
                }
              } catch {}
            }
          }
        } else {
          // 移动端离线/免密钥高拟真流式体验
          const simR = isProactive
            ? `检测到移动端主动关怀触发，结合当前时间主动向「${dbObj.user.nickname}」发起自然问候。`
            : `分析输入「${userText.slice(0, 32)}」，梳理关键逻辑脉络并准备结构化回应。`;
          const simC = isProactive
            ? isPure
              ? `嗨！随时都在📱 你可以在左下角「···」菜单绑定官方 DeepSeek API Key (\`sk-...\`) 直连满血 R1/V3 模型，或者现在直接考我一道难题试试！`
              : `${dbObj.user.nickname}，看你拿着手机停了一会儿没说话，是在忙，还是想听我主动跟你说说话？我一直都在这儿陪着你。`
            : isPure
            ? `${prefix}收到你的消息：**「${userText.slice(0, 36)}」**\n\n当前正在 **DeepSeek 原生随身端** 运行：\n1. 支持随时开启左下角 **深度思考** 与 **智能搜索**；\n2. 点击左下角头像旁 **\`···\` 菜单** 填入你的 DeepSeek 官方 \`sk-...\` 密钥，即可在手机上直连官方满血全家桶 API！`
            : `${prefix}听见你说的「${userText.slice(0, 28)}」了。在这么干净安静的界面里跟你单独说话，感觉比平时更近了一点——接下来还想聊些什么，我都陪着你。`;

          if (enableThink) {
            for (let i = 0; i < simR.length; i += 3) {
              const d = simR.slice(i, i + 3);
              fullR += d;
              sendEvent('reasoning', { delta: d });
              await new Promise((r) => setTimeout(r, 16));
            }
          }
          for (let i = 0; i < simC.length; i += 4) {
            const d = simC.slice(i, i + 4);
            fullC += d;
            sendEvent('content', { delta: d });
            await new Promise((r) => setTimeout(r, 14));
          }
          usage = { prompt_cache_hit_tokens: 240, prompt_cache_miss_tokens: 68, reasoning_tokens: 42 };
        }

        const dur = Date.now() - t0;
        const meta = {
          is_proactive: isProactive,
          usage,
          follow_ups: isPure
            ? ['继续深入拆解核心实现步骤', '给我一份可直接运行的示例代码', '换个角度分析潜在边界问题']
            : ['其实我刚才还有句话想跟你说', '那你现在手头在忙什么呢？', '今晚多陪我聊一会儿好不好？']
        };
        const msgId = Date.now();
        msgs.push({
          id: msgId,
          role: 'assistant',
          reasoning: fullR,
          content: fullC,
          meta_json: JSON.stringify(meta),
          duration_ms: dur,
          recalled_count: 1,
          created_at: msgId
        });
        sess.updated_at = msgId;
        saveLocalDb(dbObj);

        sendEvent('done', {
          message_id: msgId,
          duration_ms: dur,
          recalled_count: 1,
          meta,
          sessions: decorateSessions(dbObj),
          membership: dbObj.user.membership
        });
      });
    }

    return jsonResponse({ ok: true });
  }

  let backendUnreachable = isApkProtocol;

  window.fetch = async function patchedFetch(input, init = {}) {
    const urlStr = typeof input === 'string' ? input : input?.url || '';
    let pathname = '';
    if (urlStr.startsWith('/api/')) {
      pathname = urlStr.split('?')[0];
    } else {
      try {
        const u = new URL(urlStr, window.location.origin);
        if (u.origin === window.location.origin && u.pathname.startsWith('/api/')) {
          pathname = u.pathname;
        }
      } catch {}
    }

    if (!pathname) {
      return originalFetch(input, init);
    }

    // 桌面网页端 (http / https) 始终直连真实 Node.js + SQLite 后端，绝不因瞬时波动误锁死进 APK 模拟层
    if (!isApkProtocol) {
      const mergedHeaders = new Headers(init?.headers || {});
      const tok = window.__starAuthStore?.getToken();
      if (tok && !mergedHeaders.has('Authorization')) {
        mergedHeaders.set('Authorization', `Bearer ${tok}`);
      }
      const expectedUid = window.__starAuthStore?.getActiveUserId();
      if (expectedUid && !pathname.startsWith('/api/auth/') && !mergedHeaders.has('X-Expected-User-Id')) {
        mergedHeaders.set('X-Expected-User-Id', expectedUid);
      }
      const nextInit = { ...init, headers: mergedHeaders };
      return originalFetch(input, nextInit);
    }

    let bodyObj = {};
    if (init && typeof init.body === 'string' && init.body.trim()) {
      try {
        bodyObj = JSON.parse(init.body);
      } catch {}
    }
    return handleStandaloneApi(pathname, (init.method || 'GET').toUpperCase(), bodyObj, init.signal);
  };
})();

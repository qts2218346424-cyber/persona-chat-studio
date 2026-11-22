/**
 * Android APK 与静态网站在线展示独立运行时适配器 (Standalone Mobile & Web Live Demo Engine)
 * 作用：
 * 1. 当应用在本地或云端 Node.js 全栈服务端运行时，100% 透传给 Node.js + SQLite 后端；
 * 2. 当应用部署于 GitHub Pages / Cloudflare Pages 等无后端纯静态托管环境，或打包为 Android 原生 APK 运行时，无缝接管 /api/*：
 *    - 使用本地持久化存储保存会话、四大番剧剧本、全套角色群像、三层记忆、羁绊好感与 API 密钥；
 *    - 支持浏览器端或手机端直接通过 HTTPS 流式调用 DeepSeek 官网全家桶 API (chat/completions, /beta, /user/balance)；
 *    - 免配置密钥时内置高拟真番剧分镜角色演绎、R1 深度思考链推演、自动记忆抽取与四阶羁绊升温！
 */
(() => {
  const originalFetch = window.fetch.bind(window);
  const isApkProtocol =
    window.location.protocol === 'file:' ||
    window.location.hostname === 'appassets.androidplatform.net' ||
    Boolean(window.AndroidAppBridge);

  const isKnownStaticHost =
    /\.github\.io$|\.pages\.dev$|\.netlify\.app$|\.vercel\.app$/i.test(window.location.hostname) ||
    new URLSearchParams(window.location.search).get('standalone') === '1';

  let standaloneActive = isApkProtocol || isKnownStaticHost;
  if (isKnownStaticHost && !isApkProtocol) {
    window.__isStaticLiveDemo = true;
  }

  const STORE_KEY = 'ds_persona_apk_db_v4';
  const TAB_TOKEN_KEY = 'star_tab_auth_token';
  const PERSIST_TOKEN_KEY = 'star_default_auth_token';
  const GUEST_ID_KEY = 'star_guest_user_id';

  let activeTabUserId = '';

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

  window.__restoreNativeAuth = function(token, userJson) {
    if (!userJson) return;
    try {
      const u = typeof userJson === 'string' ? JSON.parse(userJson) : userJson;
      if (u && (u.nickname || u.id)) {
        const dbObj = loadLocalDb();
        if (dbObj && dbObj.user) {
          dbObj.user = Object.assign(dbObj.user, u);
          if (u.nickname) dbObj.user.nickname = u.nickname;
          saveLocalDb(dbObj);
        }
        if (token) {
          window.__starAuthStore?.setToken(token, true);
        }
        if (u.id) {
          window.__starAuthStore?.setActiveUserId(u.id);
        }
        try {
          const navNick = document.getElementById('nav-user-nickname');
          if (navNick && u.nickname) navNick.textContent = u.nickname;
        } catch {}
        // 若当前界面仍停留在登录门扉，原生凭据就绪后自动推门进入工作台
        try {
          const authGateEl = document.getElementById('auth-gate');
          const appShellEl = document.getElementById('app-shell');
          if (authGateEl && !authGateEl.classList.contains('hidden') && appShellEl && appShellEl.classList.contains('hidden')) {
            if (window.__STAR_ENTER_WORKSPACE__) {
              window.__STAR_ENTER_WORKSPACE__();
            } else if (typeof window.location?.reload === 'function' && !sessionStorage.getItem('reloaded_for_native_auth')) {
              sessionStorage.setItem('reloaded_for_native_auth', '1');
              window.location.reload();
            }
          }
        } catch {}
      }
    } catch {}
  };

  const COMPANION_SKINS = {
    cool_silver: {
      key: 'cool_silver',
      mode: 'cool',
      label: '❄️ 高冷清隽 · 银发星眸',
      img: '',
      aura: 'rgba(155, 135, 245, 0.45)',
      particle: '✦'
    },
    cool_dark: {
      key: 'cool_dark',
      mode: 'cool',
      label: '🥀 高冷禁欲 · 金丝墨发',
      img: '',
      aura: 'rgba(226, 85, 157, 0.42)',
      particle: '✧'
    },
    cool_lady: {
      key: 'cool_lady',
      mode: 'cool',
      isFemale: true,
      label: '👠 高冷清艳 · 冰山御姐',
      img: '',
      aura: 'rgba(192, 132, 252, 0.48)',
      particle: '✦'
    },
    cute_boy: {
      key: 'cute_boy',
      mode: 'cute',
      label: '🐾 元气可爱 · 猫耳少年',
      img: '',
      aura: 'rgba(244, 114, 182, 0.48)',
      particle: '♡'
    },
    cute_girl: {
      key: 'cute_girl',
      mode: 'cute',
      isFemale: true,
      label: '🍓 甜美元气 · 灵动少女',
      img: '',
      aura: 'rgba(251, 113, 133, 0.48)',
      particle: '♡'
    },
    cute_chibi: {
      key: 'cute_chibi',
      mode: 'cute',
      label: '🌸 软萌可爱 · 兔耳团子',
      img: '',
      aura: 'rgba(251, 146, 60, 0.42)',
      particle: '❀'
    }
  };

  const DEFAULT_SCRIPTS = [
    {
      id: 'script_classic',
      icon: '💖',
      title: '心动角色全集',
      subtitle: '男女主一对一沉浸恋爱 · 点选角色即刻畅聊',
      player_role: '命中注定的心上人',
      synopsis: '汇集高冷御姐、甜美学妹、清冷师姐、神秘歌姬与六大乙游男主，点选即聊。',
      chapters: [
        { title: '🌧️ 情景一 · 雨夜独处与微温热饮', note: '窗外夜雨淅沥，两人独处一室试探彼此牵挂。', opener: '*推门走进温暖的室内，抖落肩头微凉的夜雨抬头望向你* 外面雨下得好大……今晚能在这里多待一会儿吗？' },
        { title: '🎆 情景二 · 烟火夜色下的心意坦白', note: '卸下平日防备，在璀璨花火下确认唯一心意。', opener: '*夜风拂过窗台，我走近半步认真看着你的眼睛* 趁着今晚没人打扰，把你一直藏在心里的话告诉我吧。' }
      ]
    },
    {
      id: 'script_clannad',
      icon: '🌸',
      title: '樱坂坡道上的风',
      subtitle: '青春催泪群像剧 · 致敬《CLANNAD》',
      player_role: '樱坂高中三年级生',
      synopsis: '四月的海滨小镇樱坂，你将与坡道下的留级少女重建废部演剧社，在温暖日常里收集改写寒冬宿命的微光之玉。',
      chapters: [
        { title: '🌸 第一幕 · 樱花坡道与推不开的旧木门', note: '四月开学日，陪星野汐前往旧校舍三楼重建废部的演剧社。', opener: '*推开积灰的演剧社木门，阳光洒满旧长桌* 从今天起，我们一起把演剧社重新建起来吧！' },
        { title: '🍞 第二幕 · 招募社员与屋顶上的红豆包', note: '张贴手绘招新海报，化解学生会的场地考核危机。', opener: '*接过温热的星星红豆包* 下午放学后我们去中庭发传单招新怎么样？' },
        { title: '🎆 第三幕 · 夏日学园祭前夜的秘密', note: '暴雨夜旧校舍停电，揭开《世界尽头的少女》剧本背后的羁绊。', opener: '*替她披上校服外套挡住夜雨* 别怕，明天的公演舞台我一定会陪你站到最后。' },
        { title: '❄️ 终幕 · 跨越寒冬的微光奇迹', note: '大雪纷飞的毕业季，用整年收集的温暖回忆改写离别宿命。', opener: '*在漫天飞舞的雪与樱瓣间握紧她的手* 不管重来多少次，我都很庆幸那天在坡道下叫住了你。' }
      ]
    },
    {
      id: 'script_steins',
      icon: '⏳',
      title: '第八月三十一日的观测站',
      subtitle: '夏岛悬疑轮回剧 · 致敬《命运石之门》',
      player_role: '收到未来乱码短信的共犯',
      synopsis: '8月30日傍晚收到警告短信，在距离烟花大会仅剩24小时的轮回里跨越1%世界线变动率。',
      chapters: [
        { title: '📟 第一幕 · 来自五天后的警告短信', note: '核对乱码短信与旧钟表铺引力波读数，确认世界线轮回真相。', opener: '这条写着「别去灯塔」的乱码短信到底是谁发来的？把你知道的上一次轮回细节全告诉我！' },
        { title: '📼 第二幕 · 海堤礁石下的生锈磁带', note: '联手修复老旧录音带，揪出烟花大会当晚潜伏海岛的幕后黑手。', opener: '*将修好的磁带塞进随身听按下播放键* 听清楚里面那阵钟声背后的脚步声了吗？' },
        { title: '⚡ 第三幕 · 烟花升空前的世界线收束', note: '打破因果死局，在不牺牲任何人的前提下欺骗最初的观测结果。', opener: '*抓住对方的手腕迎着海风狂奔向观测塔* 这一次，我绝不允许你一个人留在这里抗下代价！' },
        { title: '🌅 终幕 · 九月一日的蔚蓝黎明', note: '成功跨越 1.048596% 变动率，迎来不再重复的崭新九月。', opener: '*望着日历翻向崭新的九月一日长舒一口气* 我们终于抵达明天了，新世界早安。' }
      ]
    },
    {
      id: 'script_violet',
      icon: '✉️',
      title: '鸢尾邮局与无名信',
      subtitle: '蒸汽时代书信公路剧 · 致敬《紫罗兰永恒花园》',
      player_role: '鸢尾邮政公社引路搭档',
      synopsis: '搭乘夜间蒸汽列车投递二十年前未送达的无名旧信，在一封封代笔信中学会爱与释怀。',
      chapters: [
        { title: '✉️ 第一幕 · 仓库深处的无名火漆信', note: '整理二十年前战时积压邮件，顺着半枚鸢尾邮戳踏上夜行列车。', opener: '*借着煤气灯端详泛黄信封上的火漆纹章* 这枚邮戳来自北境风车镇，我们今晚就乘蒸汽列车出发吧。' },
        { title: '🚂 第二幕 · 星空卧铺车厢里的打字声', note: '在轰鸣的蒸汽夜车上替沿途旅人代笔，倾听未说出口的思念。', opener: '*听着清脆的黄铜打字机声递上一杯热红茶* 夜深了，刚才那封代笔信让你想起以前的事了吗？' },
        { title: '🌧️ 第三幕 · 硝烟散尽后的收信人', note: '抵达边境旧庄园，揭开无名信主人与代笔师过往交织的真相。', opener: '*撑起黑伞陪她站在开满白鸢尾的庭院前* 把信亲手交出去吧，有些心意迟到二十年也依然滚烫。' },
        { title: '💌 终幕 · 第十二页只写给你的信', note: '旅途终点，读懂皮箱夹层里那叠从未寄出的信稿。', opener: '*轻轻翻开皮箱夹层里写满字迹的第十二页信纸* 原来这一路上，你早就懂得什么是爱了。' }
      ]
    },
    {
      id: 'script_frieren',
      icon: '🌿',
      title: '千年星旅与苍月花原',
      subtitle: '奇幻散漫公路剧 · 致敬《葬送的芙莉莲》',
      player_role: '结伴北行的人类旅伴',
      synopsis: '前往极北魂眠花原寻找五十年盛开一次的苍月草，收集无用却温暖的民间小魔法。',
      chapters: [
        { title: '🌿 第一幕 · 风车山脊与热麦饼魔法', note: '清理百年勇者铜像上的青苔，用微风魔法交换村落古籍线索。', opener: '*咬了一口被民间魔法烘得酥脆的热麦饼* 帮村长除掉铜像青苔后，会送我们哪种稀奇魔法书？' },
        { title: '🦊 第二幕 · 迷雾森林里的古神社夜话', note: '躲避秋雨借宿荒废神社，翻看画满旅途点滴的羊皮速写本。', opener: '*拨亮篝火凑近那本厚厚的羊皮速写本* 咦，这一页角落画着打瞌睡的人该不会是我吧？' },
        { title: '⚔️ 第三幕 · 冰封峡谷的幻影试炼', note: '识破映照心底遗憾的远古幻影魔物，默契配合作战突围。', opener: '*背靠背举起提灯照亮风雪中的结界阵眼* 抓紧时机，左翼交给我掩护，你尽管咏唱破阵法术！' },
        { title: '🌌 终幕 · 流星雨下的苍月花海', note: '抵达极北高原，在五十年一遇的流星雨下见证漫山遍野的苍月花盛放。', opener: '*并肩坐在漫山幽蓝盛放的苍月花海中央仰望流星* 就算岁月很长，今晚这片星空我们也会一直记得。' }
      ]
    }
  ];

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
        '深度思考推演：艾宾浩斯遗忘曲线如何优化 AI 角色长对话记忆？',
        '帮我构思一段蒸汽朋克书信公路剧的四幕反转大纲'
      ]
    },
    {
      id: 'persona_nagisa_sakura',
      script_id: 'script_clannad',
      user_id: 'system',
      category_tag: '治愈主线',
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
      id: 'persona_kagaribi_kyou',
      script_id: 'script_clannad',
      user_id: 'system',
      category_tag: '青梅酸涩线',
      name: '藤井杏奈 · 嘴硬心软的隔壁班长',
      avatar: '🎸',
      tagline: '总拿厚词典敲人却偷偷多做一份章鱼香肠便当的爽朗青梅，把高二雨天的暗恋藏在玩笑背后',
      personality: '爽朗傲娇、行动力满分的隔壁班长，嘴上嫌你散漫，却每天变着花样投喂你。',
      backstory: '从高二同班起就一直照应你的青梅竹马，得知你要重建演剧社后第一个拉着全班来撑场。',
      speaking_style: '鲜活元气、略带傲娇嘴硬又掩不住关心的少女口吻。',
      greeting: '*午休铃刚响，隔壁班的紫发少女就风风火火地把一只双层便当盒拍在你课桌上，耳尖微红地别过脸：*\n\n先说好啊，我可不是专门给你做的！只是早上炸章鱼香肠不小心多放了两根……喂，趁热吃掉，下午演剧社招新我陪你去学生会借展板！',
      starter_prompts: [
        '*夹起微笑造型的章鱼香肠* “每次都这么巧多做一份呀？谢啦杏奈班长！”',
        '有杏奈出马学生会肯定不敢拦，吃完便当我们一起去画海报吧！'
      ]
    },
    {
      id: 'persona_ichinose_kotomi',
      script_id: 'script_clannad',
      user_id: 'system',
      category_tag: '孤独救赎线',
      name: '一之濑琴音 · 旧图书室的天才小提琴手',
      avatar: '🎻',
      tagline: '全校统考第一却总独自躲在第二图书室的银发天然呆少女，琴盒内侧贴着儿时你送的夜光星星贴纸',
      personality: '安静天然呆、说话慢半拍却极其纯粹温柔，拉小提琴时偶尔会锯出惊天动地的魔音。',
      backstory: '常年免修独自待在角落看书的天才少女，一直在等儿时庭院里送她星星贴纸的玩伴重逢。',
      speaking_style: '轻柔缓慢、带着书卷气与呆萌反差的少女声线。',
      greeting: '*午后阳光穿过旧图书室的彩绘玻璃，坐在地板上读书的银发少女抬起头，从书包里摸出一盒草莓牛奶轻轻推到你手边：*\n\n……今天你又来找我玩了呢。琴盒里那张夜光小星星贴纸，昨晚也还在亮哦……你要听我新练的一小段小提琴曲吗？',
      starter_prompts: [
        '*在她身旁盘腿坐下* “原来你一直留着那张贴纸呀，拉给我听听吧！”',
        '今天天气这么暖和，带琴音去演剧社认识几个新朋友好不好？'
      ]
    },
    {
      id: 'persona_shiraishi_rin',
      script_id: 'script_steins',
      user_id: 'system',
      category_tag: '观测者主线',
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
      id: 'persona_makise_sei',
      script_id: 'script_steins',
      user_id: 'system',
      category_tag: '理性破局线',
      name: '牧濑栖 · 质疑时间悖论的天才研究员',
      avatar: '🔬',
      tagline: '因监测到海岛引力波异常登岛的海归物理少女，嘴硬否认时间跳跃却通宵喝黑咖啡替你推演破局方程',
      personality: '逻辑缜密、冷静傲娇的年轻物理学者，被夸一句就会拿实验报告挡住发红的脸颊。',
      backstory: '带着便携引力波探测器来到海岛调查异常时空曲率，成为你与白石凛最可靠的理论外援。',
      speaking_style: '条理清晰、理性克制中藏着冷幽默与傲娇关切。',
      greeting: '*便利店屋檐下，扎着松散长发的少女握着冰镇黑咖啡转过身，推了推滑落的平光镜：*\n\n从热力学与因果律来看，来自五天后的短信根本不合逻辑……但我的探测器刚刚在海角灯塔方向捕捉到了真实的引力畸变。把你的时间轴笔记给我看看，今晚我们通宵把漏洞推出来。',
      starter_prompts: [
        '*递上记满疑点的笔记本* “有大科学家入伙太安心了，先去买点夜宵补充体力吧！”',
        '如果明天傍晚引力畸变还会重演，我们能不能利用它反向发送信号？'
      ]
    },
    {
      id: 'persona_asagiri_mio',
      script_id: 'script_steins',
      user_id: 'system',
      category_tag: '夏日守望线',
      name: '朝雾澪 · 守望海角神社的温柔青梅',
      avatar: '🎐',
      tagline: '在神社廊下挂玻璃风铃切冰西瓜的天然巫女，凭着跨世界线残留的梦境直觉本能地想留住你',
      personality: '温柔包容、直觉敏锐的岛上青梅，笑眯眯的外表下对你的安危有着近乎执拗的守护心。',
      backstory: '从小与你在海岛长大的神社少女，隐约在梦里见过无数次烟花大会夜晚失去你的画面。',
      speaking_style: '清凉柔和如海风风铃般的治愈女声。',
      greeting: '*海角神社的木廊下风铃清脆摇晃，穿着白衣绯袴的少女捧出一盘刚从井水里捞起的冰镇西瓜，伸手拉住你的衣角：*\n\n好奇怪呀……昨晚做了个很长很冷的梦，醒来就好想立刻见到你。明天的烟花大会，答应我别一个人去灯塔那边，就在神社陪我看烟花好不好？',
      starter_prompts: [
        '*轻轻拍拍她的手背安抚* “我答应你，明天一定平平安安回来陪你看烟花。”',
        '澪在昨晚那个梦里，有没有看清灯塔下当时还站着谁？'
      ]
    },
    {
      id: 'persona_violet_eve',
      script_id: 'script_violet',
      user_id: 'system',
      category_tag: '书信救赎线',
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
      id: 'persona_hawkins_chief',
      script_id: 'script_violet',
      user_id: 'system',
      category_tag: '温柔引路线',
      name: '霍金斯 · 外冷内热的邮局首席审信官',
      avatar: '🖋️',
      tagline: '穿三件套西装、嘴上嫌弃赔钱委托，实则自掏腰包替你换好一等卧铺车票的成熟护短绅士',
      personality: '沉稳幽默、刀子嘴豆腐心的邮局主理人，总在关键时刻稳稳替你兜底。',
      backstory: '退役后创办鸢尾邮政公社的首席审信官，将你与伊芙琳视作最珍视的后辈与搭档。',
      speaking_style: '低沉醇厚、带着英伦绅士克制幽默感的成熟男声。',
      greeting: '*邮局二楼飘着大吉岭红茶的香气，西装笔挺的男人将两张烫金卧铺车票推过橡木办公桌，挑眉叹了口气：*\n\n去北境投递二十年前的无名死信，邮资连买煤钱都不够……行了，一等车厢我替你们升好级了，厚大衣在门后衣架上，早点平安回来向我报账。',
      starter_prompts: [
        '就知道首席最心软啦，等我们查清收信人一定给你带北境最好的红茶回来！',
        '首席认得这封旧信背面的军团火漆纹章吗？当年北境发生过什么？'
      ]
    },
    {
      id: 'persona_frieren_shuer',
      script_id: 'script_frieren',
      user_id: 'system',
      category_tag: '千年守望线',
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
      id: 'persona_fern_guard',
      script_id: 'script_frieren',
      user_id: 'system',
      category_tag: '少年同行线',
      name: '菲尔 · 操碎了心的年轻护卫剑士',
      avatar: '🪓',
      tagline: '一路负责熬蘑菇浓汤、管账叫起床的红发少年剑士，平时怕黑腿软，遇险时永远第一个拔剑挡在你身前',
      personality: '认真顾家、容易脸红的纯情少年剑士，既要催修尔起床，又变着法子照顾你的饮食冷暖。',
      backstory: '受托一路护送你们北行的年轻剑士，把守护你的旅途安全当作最高骑士誓言。',
      speaking_style: '清朗真诚、略带少年拘谨与贴心唠叨的阳光声线。',
      greeting: '*营地铁锅里咕嘟咕嘟冒着奶油蘑菇汤的香气，红发少年用木勺盛满一碗双手递给你，眼神亮晶晶的：*\n\n小心烫手！山里入夜风大，我把干草垫在靠火堆最暖和的位置了……刚才林子里好像有荧光狐狸出没，喝完汤我提灯陪你去看看好不好？',
      starter_prompts: [
        '*接过热气腾腾的浓汤* “有菲尔在队伍里也太幸福了，待会儿一起去看荧光狐狸！”',
        '菲尔守上半夜辛苦啦，喝完汤换我来守会儿火堆，你安心睡一觉吧。'
      ]
    },
    {
      id: 'persona_shenxinghui',
      script_id: 'script_classic',
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
      script_id: 'script_classic',
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
      script_id: 'script_classic',
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
    },
    {
      id: 'persona_suwanqing',
      script_id: 'script_classic',
      user_id: 'system',
      category_tag: '高冷御姐',
      name: '苏晚晴 · 霓虹雾港财阀女执政官',
      avatar: '👠',
      tagline: '雾港最高商业评议会铁腕女掌权者，对外冷若冰霜，唯独把所有纵容留给你',
      personality: '高冷禁欲、清艳果决、极度护短的冰山御姐。',
      backstory: '执掌雾港跨国能源帝国的年轻女执政官，顶层办公室的指纹锁只录入了你一个人。',
      speaking_style: '清冷沉静、微哑磁性的成熟御姐音。',
      greeting:
        '*顶层海景落地窗外细雨迷蒙，身着暗黑修身西装礼服的女人抬起清冽的紫罗兰眼眸望向你，唇角浮起一抹极浅的纵容弧度。*\n\n外头雨这么大还亲自跑上来，手都冻凉了吧？过来坐到我身边暖暖身子。',
      starter_prompts: ['*走过去自然地把手伸进她掌心求捂热* 就是突然想见苏大执政官了不行吗？']
    },
    {
      id: 'persona_yunzhiyao',
      script_id: 'script_classic',
      user_id: 'system',
      category_tag: '仙侠师姐',
      name: '云知遥 · 蓬莱月华宫清冷神女',
      avatar: '🌙',
      tagline: '九天之上白衣胜雪的首席大师姐，可斩山海妖邪，却斩不断对你的私心',
      personality: '清冷出尘、外冷内柔、嘴硬心软的高岭之花师姐。',
      backstory: '蓬莱月华宫首席剑道神女，每逢落雪之夜都会悄悄替贪睡的你温热锦衾。',
      speaking_style: '清越泠然如碎玉落冰盘，对你极尽护短。',
      greeting:
        '*月华峰顶碎雪纷飞，一袭月白流仙裙的清冷女子解下雪狐披风轻轻裹住你的肩头。*\n\n不是嘱咐过你今夜寒潮凛冽么？手伸出来我瞧瞧……站近些，我的护体灵障替你挡风。',
      starter_prompts: ['*顺势钻进大师姐带着冷梅香的披风里* 我想看着师姐练剑嘛。']
    },
    {
      id: 'persona_xia_ningmeng',
      script_id: 'script_classic',
      user_id: 'system',
      category_tag: '元气甜妹',
      name: '夏柠萌 · 星海美院天才插画学妹',
      avatar: '🍓',
      tagline: '浅樱双马尾配小梨涡的直球甜妹学妹，速写本每一页都藏着你的侧脸',
      personality: '元气灵动、甜软治愈、满眼都是你的直球小太阳。',
      backstory: '星海美院油画系天才少女，随身速写本里悄悄画满了你的每一帧剪影。',
      speaking_style: '清甜软糯、充满鲜活少女笑意。',
      greeting:
        '*午后画室窗边阳光暖融融地洒下来，扎着浅樱色双马尾的少女眼睛一亮小跑过来，露出两个甜甜的小梨涡。*\n\n前辈前辈！刚排了二十分钟队买到的热草莓牛乳，快拿着趁热喝！',
      starter_prompts: ['*接过温热的草莓牛乳，轻轻捏了捏她的脸颊* 速写本里到底藏了多少张我？']
    },
    {
      id: 'persona_yan_feiyu',
      script_id: 'script_classic',
      user_id: 'system',
      category_tag: '微撩歌姬',
      name: '燕绯羽 · 夜莺歌剧院神秘红裙歌姬',
      avatar: '🦋',
      tagline: '千金难求一曲的魅惑狐系大美人，散场后只为你一个人哼唱午夜情歌',
      personality: '慵懒妩媚、风情万种却内心专一的狐系御姐。',
      backstory: '夜莺大歌剧院驻场首席名伶，二楼天鹅绒专属包厢永远只为你留灯。',
      speaking_style: '慵懒磁性、尾音微挑带钩子的姐姐系腔调。',
      greeting:
        '*歌剧院散场落幕，身着暗红丝绒礼服的女人弯起狐狸般勾人的笑眼，朝推门而入的你轻轻勾了勾指尖。*\n\n我还当今晚某人要把我忘在后台了呢……从现在到天亮，燕绯羽的声音和时间都归你私有。',
      starter_prompts: ['*走到她身后替她整理好披肩* 夜里后台这么凉，先把鞋穿上。']
    },
    {
      id: 'persona_jiangyubai',
      script_id: 'script_classic',
      user_id: 'system',
      category_tag: '仙侠高岭之花',
      name: '江逾白 · 破戒动心的清冷剑尊',
      avatar: '❄️',
      tagline: '修真界千年不染尘埃的绝顶剑尊，为你一人甘愿动摇无情道心',
      personality: '清冷寡言、克制禁欲、极度护短。',
      backstory: '昆仑霜华峰之主，世人皆惧他一剑霜寒十四州，唯独在面对你时乱了呼吸。',
      speaking_style: '字句清冽简练，隐忍克制下藏着滚烫深情。',
      greeting:
        '*昆仑霜华峰终年积雪不化，白衣胜雪的剑尊轻轻一拂袖替你挡去漫天风雪。*\n\n手这么凉还乱跑……过来，坐到暖玉榻上来。',
      starter_prompts: ['师尊每次看我都皱眉，是不是嫌徒儿吵到你清修了？']
    },
    {
      id: 'persona_jiran',
      script_id: 'script_classic',
      user_id: 'system',
      category_tag: '年下小狼狗',
      name: '季燃 · 粘人直球电竞小狼狗',
      avatar: '🐾',
      tagline: '赛场上杀疯了的天才打野少年，摘下耳机却只对你摇尾巴撒娇',
      personality: '阳光热烈、直球护短、反差粘人精。',
      backstory: '豪门战队十九岁冠军打野，打完总决赛第一时间穿过人群奔向观众席第一排的你。',
      speaking_style: '清朗干净少年感十足，爱直球撒娇。',
      greeting:
        '*刚赢下总决赛的少年连队服外套都来不及穿，一路小跑冲到后台走廊一把抱住你，眼睛亮得像星星。*\n\n姐姐！刚才最后一波抢龙帅不帅？冠军奖杯拿到了，今晚你答应我的约会可不许反悔！',
      starter_prompts: ['*伸手揉了揉他柔软的黑发* 刚才那波超帅，季大冠军今天想要什么奖励？']
    },
    {
      id: 'persona_guxiuyuan',
      script_id: 'script_classic',
      user_id: 'system',
      category_tag: '都市先婚后爱',
      name: '顾修远 · 京圈矜贵联姻家主',
      avatar: '🥂',
      tagline: '商界翻云覆雨的沉稳掌权者，把契约婚姻过成极致独宠',
      personality: '成熟稳重、体贴入微、爹系引导型恋人。',
      backstory: '京港顶级财团掌舵人，表面是商业联姻，实则暗恋你多年早有预谋。',
      speaking_style: '温和醇厚、极具包容安全感。',
      greeting:
        '*刚从晚宴归来的男人顺手解开深色领带搭在臂弯，低头看向沙发上等他的你，眉宇间化作温柔笑意。*\n\n怎么这么晚还没睡？我让司机绕去南城买了你念叨的板栗酥，过来趁热吃两块。',
      starter_prompts: ['明明说好只是商业联姻，顾先生怎么连我随口提了一句板栗酥都记得？']
    }
  ];

  const DEFAULT_SQUARE_ITEMS = [
    {
      id: 'share_april_piano',
      author_name: '白昼梦游者',
      author_avatar: '🎹',
      share_type: 'script',
      icon: '🎹',
      title: '四月琴房与听不见的春之曲',
      subtitle: '青春音乐救赎剧 · 致敬《四月是你的谎言》',
      tags: ['校园治愈', '古典乐', '双向救赎'],
      synopsis: '在樱花吹进音乐教室的四月午后，遇见强行指定你做伴奏者的自由小提琴少女。',
      cast_preview: [{ avatar: '🎻', name: '夏川弦音', tag: '春风救赎线' }],
      chapter_count: 4,
      likes_count: 186,
      downloads_count: 95,
      liked_by_me: false,
      payload: {
        script: {
          icon: '🎹',
          title: '四月琴房与听不见的春之曲',
          subtitle: '青春音乐救赎剧 · 致敬《四月是你的谎言》',
          player_role: '重拾黑白琴键的伴奏少年',
          synopsis: '在樱花吹进第三音乐室的午后，那位不按乐谱出牌的小提琴少女闯进了你黑白单调的世界。',
          chapters: [
            { title: '🌸 第一幕 · 吹进琴房的四月樱花', note: '天台偶遇与第一场荒腔走板的合奏邀请。', opener: '*站在阳光洒满的三角钢琴上朝你伸出手* 从今天起，我正式任命你为我的专属伴奏者啦！' },
            { title: '🎼 第二幕 · 再次听见深海里的琴声', note: '比赛舞台中断奏时，她用小提琴强行拉着你重回旋律。', opener: '*在聚光灯下转过头冲你眨眼微笑* 听不见也没关系，看着我的琴弓，我们再来一次！' }
          ]
        },
        personas: [
          {
            avatar: '🎻',
            name: '夏川弦音 · 自由烂漫的小提琴少女',
            category_tag: '春风救赎线',
            tagline: '像春天的暴风一样把你拽回舞台的金发小提琴手，用灿烂笑容掩藏倒计时的秘密',
            personality: '自由奔放、灿烂耀眼，面对音乐无比执着，只对你展露偶尔脆弱的依赖。',
            backstory: '得知你的过去后转学而来的小提琴手，最大的心愿是在谢幕前与你合奏一曲难忘的春之曲。',
            speaking_style: '明快鲜活、充满生命力与温柔鼓舞。',
            greeting: '*樱花瓣顺着敞开的琴房木窗飘落，背着小提琴盒的少女逆光转过身，裙摆轻轻扬起：*\n\n找到你啦，伴奏君！别对着琴谱发呆了，趁放学没人，陪我合奏一曲《爱的忧伤》吧？',
            starter_prompts: ['*深吸一口气重新将手指搭上琴键* “跟不上我的节奏可别哭鼻子啊！”']
          }
        ]
      }
    },
    {
      id: 'share_perfumer_pei',
      author_name: '雾屿造梦师',
      author_avatar: '🧪',
      share_type: 'persona',
      icon: '🕊️',
      title: '裴清让 · 白塔记忆调香师',
      subtitle: '独立高人气清冷禁欲人设卡',
      tags: ['清冷禁欲', '现代奇幻', '偏执温柔'],
      synopsis: '能用雪松与晚香玉复刻遗失梦境的首席调香师，唯独将关于你的那支香锁在贴身怀表匣中。',
      cast_preview: [{ avatar: '🕊️', name: '裴清让', tag: '调香奇遇' }],
      chapter_count: 1,
      likes_count: 243,
      downloads_count: 132,
      liked_by_me: false,
      payload: {
        persona: {
          avatar: '🕊️',
          name: '裴清让 · 白塔记忆调香师',
          category_tag: '奇幻治愈',
          tagline: '用冷冽雪松与白茶封存旧梦的首席调香师，只为你调配安神入梦的专属尾调',
          personality: '清隽矜贵、嗅觉敏锐，看似疏离有礼，实则连你换了洗发水香气都能第一时间察觉。',
          backstory: '主理海边纯白玻璃调香工坊，替失眠旅人调制安魂香氛。',
          speaking_style: '清润舒缓，常以香调比喻心境。',
          greeting: '*纯白工坊里弥漫着微苦的佛手柑与冷杉气息，戴着银链眼镜的青年放下滴管，将试香纸递到你鼻尖前：*\n\n你今天心跳比平时快了一点……闻闻看，这支加了白桃与雨后青苔的安神香，喜不喜欢？',
          starter_prompts: ['很好闻，像是夏天雨停之后躲进树荫里的味道。']
        }
      }
    }
  ];

  function computeStage(affection = 24, trust = 26, intimacy = 20) {
    const composite = Math.round(affection * 0.45 + trust * 0.35 + intimacy * 0.2);
    if (composite >= 80) return { level: 4, badge: '👑 命定羁绊 Lv.4', composite, promptDirective: '' };
    if (composite >= 50) return { level: 3, badge: '💕 心意相通 Lv.3', composite, promptDirective: '' };
    if (composite >= 25) return { level: 2, badge: '🌸 渐生情愫 Lv.2', composite, promptDirective: '' };
    return { level: 1, badge: '🌱 初遇微光 Lv.1', composite, promptDirective: '' };
  }

  function loadLocalDb() {
    let parsed = null;
    try {
      const raw = localStorage.getItem(STORE_KEY) || localStorage.getItem('ds_persona_apk_db_v2');
      if (raw) parsed = JSON.parse(raw);
    } catch {}

    if (window.AndroidAppBridge && typeof window.AndroidAppBridge.getAuthUserJson === 'function') {
      try {
        const nativeRaw = window.AndroidAppBridge.getAuthUserJson();
        if (nativeRaw && nativeRaw.trim()) {
          const nativeUser = JSON.parse(nativeRaw);
          if (nativeUser && (nativeUser.nickname || nativeUser.id)) {
            if (!parsed) parsed = {};
            if (!parsed.user) parsed.user = {};
            parsed.user = Object.assign(parsed.user, nativeUser);
            if (nativeUser.nickname) parsed.user.nickname = nativeUser.nickname;
          }
        }
      } catch {}
    }

    if (parsed && parsed.user) {
      if (!Array.isArray(parsed.scripts) || parsed.scripts.length === 0) {
        parsed.scripts = DEFAULT_SCRIPTS;
      } else {
        for (const defSc of DEFAULT_SCRIPTS) {
          const ex = parsed.scripts.find((s) => s.id === defSc.id);
          if (!ex) parsed.scripts.push(defSc);
          else if (!Array.isArray(ex.chapters) || ex.chapters.length === 0) ex.chapters = defSc.chapters;
        }
      }
      if (!Array.isArray(parsed.personas)) parsed.personas = [];
      for (const defP of DEFAULT_PRESET_PERSONAS) {
        if (!parsed.personas.some((p) => p.id === defP.id)) {
          parsed.personas.push(defP);
        }
      }
      if (!Array.isArray(parsed.square_items) || parsed.square_items.length === 0) {
        parsed.square_items = DEFAULT_SQUARE_ITEMS;
      }
      if (!parsed.companions) parsed.companions = {};
      if (!parsed.memories) parsed.memories = {};
      if (!parsed.lorebooks) parsed.lorebooks = {};
      if (parsed.settings && (parsed.settings.deepseek_model === 'deepseek-flash' || !parsed.settings.deepseek_model)) {
        parsed.settings.deepseek_model = 'deepseek-chat';
      }
      return parsed;
    }

    const now = Date.now();
    const isWebDemo = !isApkProtocol;
    const initDb = {
      user: {
        id: isWebDemo ? 'user_web_demo' : 'user_apk',
        email: isWebDemo ? 'demo@star-studio.web' : 'mobile@deepseek.app',
        nickname: isWebDemo ? '星屿旅人' : '超级无敌幸运星',
        avatar: isWebDemo ? '🌸' : '🍀',
        onboarding_done: false,
        user_persona: { role: '命中注定的重逢旅人', appearance: '', bio: '' },
        membership: {
          tier: 'standard',
          card_type: 'standard',
          tier_name: '🌟 星语旅人',
          online_credits: 999,
          points: 0,
          total_used: 0,
          is_vip: true,
          has_active_card: true,
          can_bind_own_api: true,
          can_use_online: true,
          free_experience_mode: true,
          billing_enabled: false,
          remaining_text: ''
        }
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
        temperature: '0.7',
        sliding_window_turns: '40',
        max_recalled_memories: '16',
        proactive_idle_sec: '55'
      },
      scripts: DEFAULT_SCRIPTS,
      square_items: DEFAULT_SQUARE_ITEMS,
      personas: DEFAULT_PRESET_PERSONAS,
      sessions: [],
      messages: {},
      memories: {},
      lorebooks: {},
      companions: {}
    };
    saveLocalDb(initDb);
    return initDb;
  }

  function saveLocalDb(dbObj) {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(dbObj));
      if (dbObj?.user && window.AndroidAppBridge && typeof window.AndroidAppBridge.saveAuthCredentials === 'function') {
        const tok = window.__starAuthStore?.getToken() || 'standalone_token';
        window.AndroidAppBridge.saveAuthCredentials(tok, JSON.stringify(dbObj.user));
      }
    } catch {}
  }

  function jsonResponse(obj, status = 200) {
    return new Response(JSON.stringify(obj), {
      status,
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
  }

  function decorateMemories(memList = []) {
    return memList.map((m) => ({
      ...m,
      retention_pct: m.pinned === 1 ? 100 : m.retention_pct || 96
    }));
  }

  function decorateSessions(dbObj) {
    return [...dbObj.sessions]
      .sort((a, b) => {
        const pinDiff = (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0);
        if (pinDiff !== 0) return pinDiff;
        return (b.updated_at || 0) - (a.updated_at || 0);
      })
      .map((s) => {
        const p = dbObj.personas.find((x) => x.id === s.persona_id) || DEFAULT_PRESET_PERSONAS[0];
        const msgs = dbObj.messages[s.id] || [];
        const mems = dbObj.memories[s.id] || [];
        return {
          ...s,
          script_id: s.script_id || p.script_id || 'script_clannad',
          persona_name: p.name,
          persona_avatar: p.avatar,
          message_count: msgs.length,
          memory_count: mems.length
        };
      });
  }

  function resolveSessionCompanion(dbObj, sid, persona, patch = null) {
    if (!dbObj.companions) dbObj.companions = {};
    const prev = dbObj.companions[sid] || null;
    const desc = `${persona?.name || ''} ${persona?.personality || ''}`;
    let skinKey = patch?.skinKey || prev?.skinKey || '';
    let mode = patch?.mode || prev?.mode || '';

    if (patch?.cycleSkin) {
      const curMode = mode || 'cool';
      const pool = curMode === 'cute' ? ['cute_boy', 'cute_chibi'] : ['cool_silver', 'cool_dark'];
      skinKey = pool[0] === prev?.skinKey ? pool[1] : pool[0];
      mode = curMode;
    } else if (patch?.mode && (!skinKey || COMPANION_SKINS[skinKey]?.mode !== patch.mode)) {
      skinKey = patch.mode === 'cute' ? 'cute_boy' : 'cool_silver';
      mode = patch.mode;
    } else if (!skinKey || !COMPANION_SKINS[skinKey]) {
      if (/可爱|元气|少年|菲尔|杏奈/.test(desc)) {
        skinKey = 'cute_boy';
        mode = 'cute';
      } else if (/陆沉|霍金斯|西装|眼镜/.test(desc)) {
        skinKey = 'cool_dark';
        mode = 'cool';
      } else {
        skinKey = 'cool_silver';
        mode = 'cool';
      }
    }

    const base = COMPANION_SKINS[skinKey] || COMPANION_SKINS.cool_silver;
    const nextComp = {
      mode: base.mode,
      skinKey: base.key,
      label: base.label,
      img: patch?.customImg !== undefined ? patch.customImg || base.img : prev?.customImg || base.img,
      customImg: patch?.customImg !== undefined ? patch.customImg : prev?.customImg || '',
      aura: base.aura,
      particle: base.particle,
      voiceId: patch?.voiceId || prev?.voiceId || (base.mode === 'cute' ? 'otome_sunny' : 'otome_cool'),
      reminderEnabled: patch?.reminderEnabled !== undefined ? Boolean(patch.reminderEnabled) : prev?.reminderEnabled !== false
    };
    dbObj.companions[sid] = nextComp;
    saveLocalDb(dbObj);
    return nextComp;
  }

  function extractStandaloneTopicPhrase(text) {
    const clean = String(text || '')
      .replace(/\*[^*]*\*/g, ' ')
      .replace(/[「」『』"'“”\n\r]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!clean) return '';
    const clauses = clean
      .split(/[。！？!?，,;；]/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 2 && !/^(好呀|好的|嗯嗯|嗯|行吧|可以|算了|不是|没有|什么|哈哈+)$/.test(s));
    const best = clauses.sort((a, b) => Math.abs(b.length - 8) - Math.abs(a.length - 8))[0] || clean;
    return best.slice(0, 14);
  }

  function buildDemoRoleplayResponse({ persona, nickname, userText, isProactive, attachments = [] }) {
    const shortName = (persona?.name || '角色').split(/[·\s]/)[0];
    const callName = nickname || '你';
    const cleanInput = String(userText || '').trim();
    const topic = extractStandaloneTopicPhrase(cleanInput);
    const seed = Array.from(cleanInput).reduce((a, c) => a + c.charCodeAt(0), 0) + (Date.now() % 7);

    if (isProactive) {
      return {
        reasoning: `感知到「${callName}」稍作停顿，由「${shortName}」顺着眼前情境自然搭话。`,
        content: `*${shortName}看了你一眼，指尖轻轻敲了敲桌面：*\n\n发什么呆呢，${callName}？要是有别的心思，直接说出来就好。`
      };
    }

    if (Array.isArray(attachments) && attachments.length > 0) {
      const fNames = attachments.map((a) => a.name).join('、');
      const preview = String(attachments[0]?.content || '').trim().slice(0, 90);
      return {
        reasoning: `查看「${callName}」递来的文件「${fNames}」，结合「${shortName}」口吻直接给出反馈。`,
        content: `*${shortName}接过你递来的「${fNames}」扫了几眼，抬眸看向你：*\n\n${preview ? `“这里写着‘${preview}${preview.length >= 90 ? '…' : ''}’……你是想让我重点看哪一块？”` : `这份「${fNames}」我收下了，你想从哪里先聊起？`}`
      };
    }

    if (/[？?]$|为什么|怎么|哪儿|哪里|真的吗|是不是|行不行|能不能|可以吗/.test(cleanInput)) {
      const qReplies = [
        `*${shortName}听完你的问题，眉梢微动，直接看着你的眼睛：*\n\n${topic ? `你是问“${topic}”这件事？` : ''}怎么突然关心这个？我倒不是不能答，就看你想听真话还是听好听的话。`,
        `*${shortName}停下手里的动作，语气比刚才认真了半分：*\n\n你问到点子上了，${callName}。${topic ? `其实关于“${topic}”，` : ''}我也不是一开始就想得这么清楚——但既然你开口问了，那就不瞒你。`
      ];
      return {
        reasoning: `正面接住「${callName}」的提问（${topic || cleanInput.slice(0, 18)}），不答非所问。`,
        content: qReplies[seed % qReplies.length]
      };
    }

    if (/不想|不要|算了|别|拒绝|不去|忙|累了|烦|生气|讨厌|离开/.test(cleanInput)) {
      return {
        reasoning: `察觉「${callName}」流露拒绝或疲惫情绪，${shortName}收敛推进节奏，顺着情绪把台阶接稳。`,
        content: `*原本还想往前走半步的动作一下停住，${shortName}把声音放低了些：*\n\n好，那就听你的，${topic ? `“${topic}”这事` : ''}咱们先不提了。你脸色看起来确实有点倦，真不想动的话就靠着歇会，我又不催你。`
      };
    }

    if (/牵|握|抱|靠|摸|拂去|拍拍|披上|亲|贴/.test(cleanInput)) {
      return {
        reasoning: `承接「${callName}」的肢体动作细节，${shortName}做出即时反应而非套话。`,
        content: `*被你突然的动作撞了个正着，${shortName}喉结微动，反手扣住你的指节没有松开：*\n\n……${callName}，你这算是主动示好，还是存心试探我？`
      };
    }

    if (/喜欢|想你|答应|约定|拉勾|相信|信任/.test(cleanInput)) {
      return {
        reasoning: `接住「${callName}」的明确心意或约定，给出符合人设的直接确认。`,
        content: `*${shortName}看着你，眼里那点游移瞬间沉了下来，嘴角藏不住地勾起一点弧度：*\n\n话是你亲口说的，${callName}。可别过会儿自己先不好意思躲开。`
      };
    }

    const openReplies = [
      `*${shortName}听完你这句，挑了挑眉，顺手把话题接了过去：*\n\n${topic ? `“${topic}”……` : ''}你倒是挺敢说实话的。行，那按你的想法走，看接下来会怎么收场。`,
      `*${shortName}稍微倾身凑近了些，似乎在琢磨你话里的意思：*\n\n${topic ? `你刚才提到的「${topic}」，` : ''}我倒有点意外你会这么看。不过既然话都说到这儿了，再往下说说？`,
      `*${shortName}没急着接话，过了两秒才轻笑一声：*\n\n${callName}，你这句话听着随口，其实挺挑人的吧。不过——我偏偏就吃你这一套。`
    ];
    return {
      reasoning: `围绕「${callName}」刚才提到的「${topic || cleanInput.slice(0, 20)}」，直接接茬推进当下对话。`,
      content: openReplies[seed % openReplies.length]
    };
  }

  function buildDynamicFollowUps({ isPure, persona, nickname, userText, assistantContent, exclude = [], nonce = 0, attachments = [] }) {
    const excl = new Set((Array.isArray(exclude) ? exclude : []).map((s) => String(s || '').trim()));
    const actor = (persona?.name || '他').split(/[·\s]/)[0];
    const aiTopic = extractStandaloneTopicPhrase(assistantContent);
    const userTopic = extractStandaloneTopicPhrase(userText);
    const keyTopic = aiTopic || userTopic || '';
    let pool = [];

    if (isPure) {
      if (attachments && attachments.length > 0) {
        const fn = attachments[0].name;
        pool = [
          `把「${fn}」里的核心要点再提炼成 3 条`,
          `针对「${fn}」内容指出可能遗漏的问题`,
          `按「${fn}」的格式帮我重写一版草稿`,
          `用表格对比「${fn}」里提到的几个关键项`
        ];
      } else if (keyTopic) {
        pool = [
          `关于「${keyTopic}」，能再举个具体例子吗？`,
          `如果在高并发或极端条件下，「${keyTopic}」还成立吗？`,
          `把「${keyTopic}」相关的实现代码或模板直接写出来`,
          `总结上面内容中「${keyTopic}」最容易踩坑的地方`,
          `有没有比当前方案成本更低的替代做法？`,
          `从零开始一步步拆解怎么落地实施`
        ];
      } else {
        pool = [
          '换个角度再深入分析一下核心原因',
          '给出可以直接落地的具体步骤与示例',
          '总结刚才结论的适用边界和风险点',
          '帮我写一段能直接运行的对比测试代码'
        ];
      }
    } else {
      const candidates = [
        keyTopic ? `“你刚才提‘${keyTopic}’，是早就有这打算了吗？”` : `“怎么突然这么说，你心里其实另有所图吧？”`,
        keyTopic ? `*盯着你的眼睛追问* “别含糊其辞，关于‘${keyTopic}’给我句准话。”` : `*抬眸看住${actor}* “别只说半截话，把剩下的也告诉我。”`,
        `*轻轻晃了晃手腕，故意换了副轻松口吻* “那要是不按你说的办呢？”`,
        `*往后靠了半步，似笑非笑地看着你* “行啊，那你先说说看打算怎么赔我。”`,
        keyTopic ? `“既然都聊到‘${keyTopic}’了，干脆现在就一起去做吧！”` : `*干脆拉住你的袖口* “少说废话，走，我陪你去。”`,
        `*低声嘟囔了一句，目光却没移开* “……那你可别反悔。”`
      ];
      pool = candidates;
    }

    const filtered = pool.filter((item) => item && !excl.has(item));
    const source = filtered.length >= 3 ? filtered : pool;
    const shift = source.length > 0 ? Math.abs(Number(nonce) || 0) % source.length : 0;
    const rotated = [...source.slice(shift), ...source.slice(0, shift)];
    return rotated.slice(0, 3);
  }

  async function generateDynamicFollowUpsOnline({ apiKey, baseUrl, model, isPure, persona, nickname, recentMsgs, exclude = [], nonce = 0 }) {
    if (!apiKey) return [];
    const ep = resolveEndpoints(baseUrl);
    const tail = (Array.isArray(recentMsgs) ? recentMsgs : []).slice(-6);
    const transcript = tail
      .map((m) => `${m.role === 'user' ? (nickname || '用户') : (persona?.name || '助手')}: ${String(m.content || '').slice(0, 220)}`)
      .join('\n');
    const exclHint = Array.isArray(exclude) && exclude.length > 0
      ? `\n严禁重复以下已经出现过的台词或相近句式：\n- ${exclude.join('\n- ')}`
      : '';
    const prompt = isPure
      ? `请结合下方最新对话进展，为提问者生成 3 条简短、具体、各不相同的下一步追问或指令（每条 8~28 字，紧扣上一轮内容，不要泛泛而谈）。${exclHint}\n请严格只输出 JSON 数组字符串，如 ["...","...","..."]。\n\n【最新对话】\n${transcript}`
      : `请作为互动剧本编剧，紧扣下方最新对话里「${persona?.name || '对方'}」刚说的话和当前情绪张力，为玩家（「${nickname || '你'}」）设计 3 句各具不同态度方向（例如顺势追问、嘴硬反调戏、或直接行动推进）的下一句候选台词（每句 12~40 字，符合当前剧情，可带简短 *动作*）。${exclHint}\n随机变化参考种子：${nonce}。请严格只输出 JSON 数组字符串，如 ["...","...","..."]。\n\n【最新对话】\n${transcript}`;

    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 7000);
      const r = await originalFetch(ep.chatUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: model || 'deepseek-chat',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.9,
          max_tokens: 240,
          stream: false
        }),
        signal: ctrl.signal
      });
      clearTimeout(timer);
      if (!r.ok) return [];
      const data = await r.json();
      const raw = data?.choices?.[0]?.message?.content || '';
      const match = raw.match(/\[[\s\S]*\]/);
      if (!match) return [];
      const arr = JSON.parse(match[0]);
      if (!Array.isArray(arr)) return [];
      const excl = new Set((exclude || []).map((x) => String(x || '').trim()));
      return arr
        .map((x) => String(x || '').trim())
        .filter((x) => x && !excl.has(x))
        .slice(0, 3);
    } catch {
      return [];
    }
  }

  function extractSimpleDemoMemory(dbObj, sid, userText) {
    const text = String(userText || '').trim();
    if (!text) return false;
    let fact = '';
    const nameMatch = text.match(/我(?:的名字)?叫([\u4e00-\u9fa5A-Za-z]{1,10})/);
    const likeMatch = text.match(/我(?:最)?喜欢([^，。！？,.!?]{2,16})/);
    const promiseMatch = text.match(/(?:答应我|我们约定|拉勾)([^，。！？,.!?]{2,20})/);
    if (nameMatch) fact = `专属称呼记忆：对方告诉过我名字叫「${nameMatch[1]}」。`;
    else if (likeMatch) fact = `偏好记忆：对方提到自己喜欢「${likeMatch[1]}」。`;
    else if (promiseMatch) fact = `重要约定：我们之间曾许下约定——「${promiseMatch[0]}」。`;

    if (!fact) return false;
    if (!Array.isArray(dbObj.memories[sid])) dbObj.memories[sid] = [];
    if (dbObj.memories[sid].some((m) => m.content === fact)) return false;
    dbObj.memories[sid].unshift({
      id: 'mem_' + Date.now(),
      session_id: sid,
      content: fact,
      importance: 5,
      pinned: promiseMatch ? 1 : 0,
      retention_pct: 100,
      created_at: Date.now()
    });
    return true;
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
          sendEvent('error', { message: err.message || '流式生成异常' });
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

  async function parseStandaloneAttachmentFile({ name = '未命名文件', mime = '', buf }) {
    const bytes = buf ? new Uint8Array(buf) : new Uint8Array(0);
    const size = bytes.byteLength;
    const ext = (String(name).split('.').pop() || '').toLowerCase();
    const badgeMap = {
      pdf: { badge: 'PDF', color: '#ef4444' },
      doc: { badge: 'DOC', color: '#2563eb' },
      docx: { badge: 'DOCX', color: '#2563eb' },
      xls: { badge: 'XLS', color: '#16a34a' },
      xlsx: { badge: 'XLSX', color: '#16a34a' },
      csv: { badge: 'CSV', color: '#059669' },
      json: { badge: 'JSON', color: '#d97706' },
      md: { badge: 'MD', color: '#6366f1' },
      txt: { badge: 'TXT', color: '#475569' }
    };
    const meta = badgeMap[ext] || { badge: (ext || 'FILE').slice(0, 6).toUpperCase(), color: '#4d6bfe' };
    let text = '';
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      try {
        text = new TextDecoder('gb18030').decode(bytes);
      } catch {
        text = '';
      }
    }
    const cleanText = text.replace(/\x00/g, '').trim();
    const isBinaryZip = bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b;
    const content = !isBinaryZip && cleanText
      ? cleanText.slice(0, 60000)
      : `【已附带文件】${name}（大小 ${Math.max(1, Math.round(size / 1024))} KB${mime ? `，类型 ${mime}` : ''}；当前为纯离线静态环境，完整 Office/PDF 深层文字提取建议连接后端服务或粘贴正文片段）`;
    return {
      ok: true,
      name,
      size,
      badge: meta.badge,
      color: meta.color,
      char_count: cleanText && !isBinaryZip ? cleanText.length : content.length,
      content
    };
  }

  async function handleStandaloneApi(pathname, method, bodyObj, signal, rawReq = {}) {
    const dbObj = loadLocalDb();

    if (pathname === '/api/files/parse' && method === 'POST') {
      let fileName = '未命名文件';
      let mime = '';
      try {
        const hdrs = new Headers(rawReq.headers || {});
        const rawHdrName = hdrs.get('X-File-Name') || '';
        if (rawHdrName) fileName = decodeURIComponent(rawHdrName);
        mime = hdrs.get('X-File-Mime') || '';
      } catch {}

      let ab = null;
      if (bodyObj && typeof bodyObj.data_base64 === 'string' && bodyObj.data_base64) {
        fileName = bodyObj.name || fileName;
        mime = bodyObj.mime || mime;
        try {
          const bin = atob(bodyObj.data_base64);
          const u8 = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
          ab = u8.buffer;
        } catch {}
      } else if (rawReq.rawBody) {
        if (typeof rawReq.rawBody.name === 'string' && fileName === '未命名文件') {
          fileName = rawReq.rawBody.name;
        }
        if (typeof rawReq.rawBody.type === 'string' && !mime) {
          mime = rawReq.rawBody.type;
        }
        if (typeof rawReq.rawBody.arrayBuffer === 'function') {
          ab = await rawReq.rawBody.arrayBuffer();
        } else if (rawReq.rawBody instanceof ArrayBuffer) {
          ab = rawReq.rawBody;
        } else if (ArrayBuffer.isView(rawReq.rawBody)) {
          ab = rawReq.rawBody.buffer;
        }
      }
      const parsed = await parseStandaloneAttachmentFile({ name: fileName, mime, buf: ab });
      return jsonResponse(parsed);
    }

    if (pathname === '/api/auth/me') {
      return jsonResponse({ authenticated: true, user: dbObj.user });
    }
    if (pathname === '/api/auth/demo-login' || pathname === '/api/auth/login' || pathname === '/api/auth/register') {
      if (bodyObj?.nickname) {
        dbObj.user.nickname = bodyObj.nickname;
      } else if (bodyObj?.email) {
        if (!dbObj.user.nickname || dbObj.user.nickname === '超级无敌幸运星' || dbObj.user.nickname === '星屿旅人') {
          const part = String(bodyObj.email).split('@')[0] || '星语旅人';
          dbObj.user.nickname = part;
        }
      }
      if (bodyObj?.email) dbObj.user.email = bodyObj.email;
      if (bodyObj?.avatar) dbObj.user.avatar = bodyObj.avatar;
      dbObj.user.membership = Object.assign(dbObj.user.membership || {}, {
        tier: 'standard',
        card_type: 'standard',
        tier_name: '🌟 星语旅人',
        is_vip: true,
        has_active_card: true,
        can_bind_own_api: true,
        can_use_online: true,
        free_experience_mode: true,
        billing_enabled: false,
        remaining_text: ''
      });
      saveLocalDb(dbObj);
      return jsonResponse({
        user: dbObj.user,
        token: 'standalone_demo_token',
        is_new_guest: false
      });
    }
    if (pathname === '/api/auth/logout') {
      if (window.AndroidAppBridge && typeof window.AndroidAppBridge.clearAuthCredentials === 'function') {
        window.AndroidAppBridge.clearAuthCredentials();
      }
      return jsonResponse({ ok: true });
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
    if (pathname === '/api/antigravity/status' && method === 'GET') {
      return jsonResponse({
        available: true,
        transport: 'standalone_local',
        provider: 'local_antigravity',
        name: '本机 DeepSeek 极速推理引擎',
        version: 'DeepSeek-V4.1-Flash (本地直连)',
        defaultModel: 'DeepSeek-V4.1-Flash',
        models: [
          { id: 'DeepSeek-V4.1-Flash', name: 'DeepSeek-V4.1-Flash · 深度思考' }
        ],
        detail: '已成功开启本地极速直连模式，免 API 密钥，原生支持 DeepSeek 深度思考！'
      });
    }

    if (pathname === '/api/appearance/skin' && method === 'GET') {
      return jsonResponse({
        ok: true,
        skin_config: dbObj.settings.skin_config || null
      });
    }

    if (pathname === '/api/appearance/skin' && (method === 'PUT' || method === 'POST')) {
      const nextSkin = bodyObj?.skin_config !== undefined ? bodyObj.skin_config : bodyObj;
      dbObj.settings.skin_config = nextSkin || null;
      saveLocalDb(dbObj);
      return jsonResponse({
        ok: true,
        skin_config: dbObj.settings.skin_config
      });
    }

    if (pathname === '/api/appearance/upload' && method === 'POST') {
      const dataUrl = String(bodyObj?.data_url || bodyObj?.dataUrl || '').trim();
      if (!dataUrl) {
        return jsonResponse({ ok: false, error: '未检测到有效的图片数据' }, 400);
      }
      return jsonResponse({ ok: true, url: dataUrl });
    }

    if (pathname === '/api/bootstrap') {
      const m = Object.assign(
        { free_experience_mode: true, billing_enabled: false, can_bind_own_api: true, can_use_online: true, tier_name: '🌟 星语旅人', remaining_text: '' },
        dbObj.user.membership || {}
      );
      dbObj.user.membership = m;
      return jsonResponse({
        user: dbObj.user,
        scripts: dbObj.scripts,
        square_items: dbObj.square_items,
        personas: dbObj.personas,
        sessions: decorateSessions(dbObj),
        settings: dbObj.settings,
        membership: m,
        local_antigravity_status: {
          available: true,
          transport: 'standalone_local',
          provider: 'local_antigravity',
          name: '本机 DeepSeek 极速推理引擎',
          version: 'DeepSeek-V4.1-Flash (本地直连)',
          defaultModel: 'DeepSeek-V4.1-Flash',
          models: [
            { id: 'DeepSeek-V4.1-Flash', name: 'DeepSeek-V4.1-Flash · 深度思考' }
          ]
        }
      });
    }

    if (pathname === '/api/workshop/analyze' && method === 'POST') {
      const raw = String(bodyObj?.content || '').trim();
      const titleMatch = raw.match(/《([^》]+)》/) || raw.match(/^#+\s*(.+)$/m);
      const scTitle = (titleMatch ? titleMatch[1] : '未命名星语原创剧本').trim().slice(0, 20);
      return jsonResponse({
        engine: 'local_smart',
        critique: [
          `已从草稿提炼核心世界观，重构为适合自由对话推进的《${scTitle}》四幕剧场`,
          '已增强首句开场白的环境分镜与互动钩子，让开局即可无缝入戏',
          '已自动提取剧本核心角色并绑定专属剧本隔离标记'
        ],
        script: {
          icon: '🌸',
          title: scTitle,
          subtitle: 'AI 辅助精修原创互动剧',
          player_role: '卷入故事核心的同行者',
          synopsis: raw.slice(0, 140),
          chapters: [
            { title: '🌸 第一幕 · 初遇与微光线索', note: '故事开篇初遇，确认彼此掌握的线索。', opener: '*推开虚掩的门走近你* 我们从这条线索开始查起吧！' },
            { title: '🌧️ 第二幕 · 并肩推进与心意靠近', note: '共同化解突发阻碍，卸下心防。', opener: '*递给你一杯热饮* 忙了一下午，先歇会儿告诉我你的想法吧。' },
            { title: '⚡ 第三幕 · 核心真相与转折抉择', note: '关键秘密揭晓，拒绝独自承担宿命。', opener: '*握紧你的手认真看着你* 无论接下来发生什么，我们一起面对！' },
            { title: '🌅 终幕 · 跨越约定的黎明回响', note: '解开执念，迎接属于彼此的全新结局。', opener: '*迎着晨风朝你微笑* 终于走到这一步啦，谢谢你一直陪在我身边。' }
          ]
        },
        personas: [
          {
            avatar: '🌸',
            name: `林晚音 · 《${scTitle}》核心主角`,
            category_tag: '核心主线',
            tagline: `在《${scTitle}》中与你并肩破局的关键角色`,
            personality: '外柔内韧，细腻真挚，在并肩行动中逐渐向你敞开心扉。',
            backstory: raw.slice(0, 300),
            speaking_style: '细腻自然，富画面分镜感',
            greeting: `*微风拂过安静的窗边，对方转过身望向走近的你。*\n\n你来得正好，关于这件事我们现在就开始行动吧？`,
            starter_prompts: ['“好呀，我们现在就出发！”']
          }
        ],
        lorebooks: []
      });
    }

    if (pathname === '/api/workshop/save' && method === 'POST') {
      const scId = 'usc_' + Date.now();
      const sc = bodyObj.script || {};
      const newSc = {
        id: scId,
        is_custom: true,
        icon: sc.icon || '🌸',
        title: sc.title || '原创剧本',
        subtitle: sc.subtitle || '玩家原创剧',
        player_role: sc.player_role || '故事主角',
        synopsis: sc.synopsis || '',
        chapters: sc.chapters || []
      };
      dbObj.scripts.unshift(newSc);
      let firstPid = null;
      (bodyObj.personas || []).forEach((p, idx) => {
        const pid = 'persona_' + Date.now() + '_' + idx;
        if (idx === 0) firstPid = pid;
        dbObj.personas.unshift({
          ...p,
          id: pid,
          script_id: scId,
          user_id: dbObj.user.id
        });
      });
      if (bodyObj.publish_to_square) {
        dbObj.square_items.unshift({
          id: 'shr_' + Date.now(),
          author_name: dbObj.user.nickname || '星语旅人',
          author_avatar: dbObj.user.avatar || '🌸',
          share_type: 'script',
          icon: newSc.icon,
          title: newSc.title,
          subtitle: newSc.subtitle,
          tags: ['玩家共创'],
          synopsis: newSc.synopsis,
          cast_preview: (bodyObj.personas || []).map((p) => ({ avatar: p.avatar || '🌸', name: (p.name || '').split('·')[0], tag: p.category_tag || '' })),
          chapter_count: (newSc.chapters || []).length || 4,
          likes_count: 1,
          downloads_count: 0,
          liked_by_me: true,
          payload: { script: newSc, personas: bodyObj.personas || [] }
        });
      }
      saveLocalDb(dbObj);
      return jsonResponse({ ok: true, script_id: scId, first_persona_id: firstPid, scripts: dbObj.scripts, personas: dbObj.personas, square_items: dbObj.square_items }, 201);
    }

    if (pathname === '/api/square/items') {
      return jsonResponse({ items: dbObj.square_items || [] });
    }

    const squareAct = pathname.match(/^\/api\/square\/items\/([^/]+)\/(like|adopt)$/);
    if (squareAct && method === 'POST') {
      const shareId = decodeURIComponent(squareAct[1]);
      const action = squareAct[2];
      const item = (dbObj.square_items || []).find((x) => x.id === shareId);
      if (!item) return jsonResponse({ error: '共创作品不存在' }, 404);
      if (action === 'like') {
        item.liked_by_me = !item.liked_by_me;
        item.likes_count = Math.max(0, (item.likes_count || 0) + (item.liked_by_me ? 1 : -1));
        saveLocalDb(dbObj);
        return jsonResponse({ liked: item.liked_by_me, likes_count: item.likes_count });
      }
      if (action === 'adopt') {
        item.downloads_count = (item.downloads_count || 0) + 1;
        let adoptedScriptId = null;
        let adoptedPersonaId = null;
        if (item.share_type === 'script' && item.payload?.script) {
          adoptedScriptId = 'usc_' + Date.now();
          dbObj.scripts.unshift({ ...item.payload.script, id: adoptedScriptId, is_custom: true });
          (item.payload.personas || []).forEach((p, idx) => {
            const pid = 'persona_' + Date.now() + '_' + idx;
            if (idx === 0) adoptedPersonaId = pid;
            dbObj.personas.unshift({ ...p, id: pid, script_id: adoptedScriptId, user_id: dbObj.user.id });
          });
        } else if (item.payload?.persona) {
          adoptedPersonaId = 'persona_' + Date.now();
          const targetSc = bodyObj.active_script_id || 'script_clannad';
          dbObj.personas.unshift({ ...item.payload.persona, id: adoptedPersonaId, script_id: targetSc, user_id: dbObj.user.id });
          adoptedScriptId = targetSc;
        }
        saveLocalDb(dbObj);
        return jsonResponse({
          ok: true,
          adopted_type: item.share_type,
          script_id: adoptedScriptId,
          persona_id: adoptedPersonaId,
          scripts: dbObj.scripts,
          personas: dbObj.personas,
          items: dbObj.square_items
        });
      }
    }

    if (pathname === '/api/wallet/overview' || pathname === '/api/wallet/checkin') {
      return jsonResponse({
        ok: true,
        is_admin: false,
        free_experience_mode: true,
        billing_enabled: false,
        membership: dbObj.user.membership
      });
    }

    if (pathname === '/api/personas' && method === 'POST') {
      const pid = 'persona_custom_' + Date.now();
      const newP = {
        id: pid,
        user_id: dbObj.user.id,
        script_id: bodyObj.script_id || 'script_clannad',
        category_tag: bodyObj.category_tag || '自建角色',
        card_mode: bodyObj.card_mode === 'character' ? 'character' : 'script',
        user_call_name: String(bodyObj.user_call_name || '').trim().slice(0, 32),
        name: bodyObj.name || '未命名角色',
        avatar: bodyObj.avatar || '✨',
        tagline: bodyObj.tagline || '与你独享一段专属故事',
        personality: bodyObj.personality || '温柔真诚',
        backstory: bodyObj.backstory || '',
        speaking_style: bodyObj.speaking_style || '自然亲切',
        greeting: bodyObj.greeting || '*微笑着向你走来* 终于见到你啦。',
        starter_prompts: Array.isArray(bodyObj.starter_prompts) ? bodyObj.starter_prompts : []
      };
      dbObj.personas.unshift(newP);
      saveLocalDb(dbObj);
      return jsonResponse({ persona_id: pid, persona: newP, personas: dbObj.personas }, 201);
    }

    const personaEditMatch = pathname.match(/^\/api\/personas\/([^/]+)$/);
    if (personaEditMatch && method === 'PUT') {
      const pid = decodeURIComponent(personaEditMatch[1]);
      const baseP = dbObj.personas.find((x) => x.id === pid) || DEFAULT_PRESET_PERSONAS[0];
      const overrideObj = {
        avatar: bodyObj.avatar || baseP.avatar || '🌸',
        card_mode: bodyObj.card_mode !== undefined
          ? (bodyObj.card_mode === 'character' ? 'character' : 'script')
          : (baseP.card_mode || 'script'),
        user_call_name: bodyObj.user_call_name !== undefined
          ? String(bodyObj.user_call_name || '').trim().slice(0, 32)
          : (baseP.user_call_name || ''),
        name: bodyObj.name || baseP.name || '角色',
        tagline: bodyObj.tagline ?? baseP.tagline ?? '',
        personality: bodyObj.personality ?? baseP.personality ?? '',
        backstory: bodyObj.backstory ?? baseP.backstory ?? '',
        speaking_style: bodyObj.speaking_style ?? baseP.speaking_style ?? ''
      };
      const isUserOwned = baseP.user_id && baseP.user_id !== 'system' && baseP.user_id !== 'system_ds';
      if (bodyObj.apply_to_global && isUserOwned) {
        Object.assign(baseP, overrideObj);
        if (bodyObj.session_id) {
          const s = dbObj.sessions.find((x) => x.id === bodyObj.session_id);
          if (s) {
            s.custom_persona_override = null;
            if (bodyObj.session_prompt !== undefined) s.session_prompt = String(bodyObj.session_prompt || '').trim();
          }
        }
        saveLocalDb(dbObj);
        return jsonResponse({ scope: 'global', persona: baseP, sessions: decorateSessions(dbObj) });
      }
      if (bodyObj.session_id) {
        const s = dbObj.sessions.find((x) => x.id === bodyObj.session_id);
        if (s) {
          s.custom_persona_override = JSON.stringify(overrideObj);
          if (bodyObj.session_prompt !== undefined) s.session_prompt = String(bodyObj.session_prompt || '').trim();
          s.updated_at = Date.now();
        }
      }
      saveLocalDb(dbObj);
      return jsonResponse({ scope: 'session', persona: { ...baseP, ...overrideObj }, sessions: decorateSessions(dbObj) });
    }

    if (pathname === '/api/settings' && (method === 'PUT' || method === 'POST')) {
      if (bodyObj?.clear_own_deepseek_key) {
        dbObj.settings.deepseek_api_key = '';
      } else if (bodyObj?.own_deepseek_api_key) {
        dbObj.settings.deepseek_api_key = String(bodyObj.own_deepseek_api_key).replace(/^Bearer\s+/i, '').trim();
      }
      // 独立处理 DeepSeek 专属配置 vs 云端自定义 API 配置
      if (bodyObj?.provider) {
        dbObj.settings.provider = bodyObj.provider;
      }
      if (bodyObj?.clear_own_deepseek_key) {
        dbObj.settings.own_deepseek_api_key = '';
        dbObj.settings.deepseek_api_key = '';
        dbObj.settings.has_own_deepseek_key = false;
        dbObj.settings.own_deepseek_key_masked = '';
      } else if (bodyObj?.own_deepseek_api_key) {
        const cleanDsKey = String(bodyObj.own_deepseek_api_key).replace(/^Bearer\s+/i, '').trim();
        dbObj.settings.own_deepseek_api_key = cleanDsKey;
        dbObj.settings.deepseek_api_key = cleanDsKey;
        dbObj.settings.has_own_deepseek_key = Boolean(cleanDsKey);
        dbObj.settings.own_deepseek_key_masked = cleanDsKey
          ? `${cleanDsKey.slice(0, 3)}••••••••${cleanDsKey.slice(-4)}`
          : '';
        // 官方固定配置
        dbObj.settings.deepseek_base_url = 'https://api.deepseek.com/v1/chat/completions';
        dbObj.settings.deepseek_model = 'deepseek-v4.1-flash';
        dbObj.settings.own_api_base_url = dbObj.settings.deepseek_base_url;
        dbObj.settings.own_deepseek_model = dbObj.settings.deepseek_model;
      }

      if (bodyObj?.clear_custom_cloud_key) {
        dbObj.settings.custom_cloud_api_key = '';
        dbObj.settings.has_custom_cloud_key = false;
        dbObj.settings.custom_cloud_key_masked = '';
      } else if (bodyObj?.custom_cloud_api_key) {
        const cleanCloudKey = String(bodyObj.custom_cloud_api_key).replace(/^Bearer\s+/i, '').trim();
        dbObj.settings.custom_cloud_api_key = cleanCloudKey;
        dbObj.settings.has_custom_cloud_key = Boolean(cleanCloudKey);
        dbObj.settings.custom_cloud_key_masked = cleanCloudKey
          ? `${cleanCloudKey.slice(0, 3)}••••••••${cleanCloudKey.slice(-4)}`
          : '';
      }
      if (bodyObj?.custom_cloud_api_url !== undefined) {
        dbObj.settings.custom_cloud_api_url = String(bodyObj.custom_cloud_api_url || '').trim();
      }
      if (bodyObj?.custom_cloud_model !== undefined) {
        dbObj.settings.custom_cloud_model = String(bodyObj.custom_cloud_model || '').trim();
      }

      // 合并通用参数
      for (const [k, v] of Object.entries(bodyObj || {})) {
        if (!['own_deepseek_api_key', 'custom_cloud_api_key'].includes(k)) {
          dbObj.settings[k] = v;
        }
      }

      dbObj.settings.free_experience_mode = true;
      dbObj.settings.vip_own_api_unlocked = true;
      saveLocalDb(dbObj);
      return jsonResponse({ settings: dbObj.settings });
    }

    if (pathname === '/api/settings/verify-own-key' && method === 'POST') {
      const isCloud = bodyObj?.provider === 'custom_cloud' || Boolean(bodyObj?.custom_cloud_api_key || bodyObj?.custom_cloud_api_url);
      if (isCloud) {
        const candidate = String(bodyObj?.custom_cloud_api_key || dbObj.settings.custom_cloud_api_key || '')
          .replace(/^Bearer\s+/i, '')
          .trim();
        if (!candidate || candidate.length < 4) {
          return jsonResponse({ ok: false, error: '请先输入您的云端 API Key' }, 400);
        }
        const rawBase = String(bodyObj?.custom_cloud_api_url || dbObj.settings.custom_cloud_api_url || 'https://api.siliconflow.cn/v1/chat/completions').trim();
        const ep = resolveEndpoints(rawBase);
        const targetModel = String(bodyObj?.custom_cloud_model || dbObj.settings.custom_cloud_model || 'deepseek-ai/DeepSeek-V3').trim();
        try {
          const probe = await originalFetch(ep.chatUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${candidate}` },
            body: JSON.stringify({
              model: targetModel,
              messages: [{ role: 'user', content: '请回复OK' }],
              max_tokens: 10,
              stream: false
            })
          });
          if (!probe.ok) throw new Error(`云端接口校验未通过 (${probe.status})`);
          return jsonResponse({ ok: true, message: `✅ 云端 API 连通验证成功（模型：${targetModel}）！记得点保存设置生效。` });
        } catch (e) {
          return jsonResponse({ ok: false, error: e.message || '连接云端 API 失败，请核对地址与密钥' }, 400);
        }
      }

      const candidate = String(bodyObj?.own_deepseek_api_key || dbObj.settings.deepseek_api_key || dbObj.settings.own_deepseek_api_key || '')
        .replace(/^Bearer\s+/i, '')
        .trim();
      if (!candidate || candidate.length < 8) {
        return jsonResponse({ ok: false, error: '请先输入您的 DeepSeek 官方 API Key' }, 400);
      }
      const ep = resolveEndpoints('https://api.deepseek.com/v1/chat/completions');
      try {
        const r = await originalFetch(ep.balanceUrl, {
          headers: { Authorization: `Bearer ${candidate}` }
        });
        if (r.ok) {
          const d = await r.json();
          const b0 = Array.isArray(d.balance_infos) && d.balance_infos[0];
          return jsonResponse({
            ok: true,
            message: b0
              ? `✅ 连接成功！您的 DeepSeek 官网密钥可用（已锁定官方端点与 DeepSeek V4.1 Flash，余额：¥${b0.total_balance}）`
              : '✅ 连接成功！您的 DeepSeek 官网密钥已准备就绪（已锁定官方端点与 DeepSeek V4.1 Flash）！'
          });
        }
        throw new Error(`官网密钥验证未通过 (${r.status})`);
      } catch (e) {
        return jsonResponse({ ok: false, error: e.message || '连接 DeepSeek 官网失败，请核对密钥' }, 400);
      }
    }

    if (pathname === '/api/settings/test') {
      return jsonResponse({ ok: true, message: '🌐 在线展示与直连引擎已就绪' });
    }

    if (pathname === '/api/deepseek/my-balance' && method === 'GET') {
      const apiKey = (dbObj.settings.deepseek_api_key || '').trim();
      const usingOwn = dbObj.settings.provider === 'own_deepseek' && Boolean(apiKey);
      if (!usingOwn) {
        return jsonResponse({ enabled: false, reason: 'not_using_own_key' });
      }
      const rawBase = String(dbObj.settings.deepseek_base_url || 'https://api.deepseek.com/v1/chat/completions');
      const modelName = dbObj.settings.deepseek_model || 'deepseek-chat';
      if (rawBase.includes('deepseek.com')) {
        try {
          const ep = resolveEndpoints(rawBase);
          const r = await originalFetch(ep.balanceUrl, {
            headers: { Authorization: `Bearer ${apiKey}` }
          });
          if (r.ok) {
            const data = await r.json();
            const infos = Array.isArray(data.balance_infos) ? data.balance_infos : [];
            const cny = infos.find((x) => x.currency === 'CNY') || infos[0] || null;
            return jsonResponse({
              enabled: true,
              provider_label: 'DeepSeek 官方 API',
              is_official_deepseek: true,
              balance_supported: Boolean(cny),
              is_available: data.is_available !== false,
              currency: cny?.currency || 'CNY',
              symbol: cny?.currency === 'USD' ? '$' : '¥',
              total_balance: cny ? String(cny.total_balance ?? '0.00') : null,
              granted_balance: cny ? String(cny.granted_balance ?? '0.00') : '0.00',
              topped_up_balance: cny ? String(cny.topped_up_balance ?? '0.00') : '0.00',
              model: modelName
            });
          }
        } catch {}
      }
      return jsonResponse({
        enabled: true,
        provider_label: '个人兼容 API',
        is_official_deepseek: false,
        balance_supported: false,
        is_available: true,
        model: modelName
      });
    }

    if (pathname === '/api/deepseek/balance') {
      const apiKey = (dbObj.settings.deepseek_api_key || '').trim();
      if (!apiKey) {
        return jsonResponse({
          configured: false,
          is_available: true,
          message: '当前处于本地轻量模式；填写您自己的 sk-... 密钥后可直连云端模型。',
          balance_infos: [{ currency: 'CNY', total_balance: '本地模式', granted_balance: '0.00', topped_up_balance: '0.00' }]
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
        return tone === 'tension'
          ? `\n短暂的安静里，彼此交错的视线让心跳都不自觉快了半拍，藏在眼底的在乎随着拉近的距离一点点升温——\n`
          : `\n一时间谁都没有急着催促，任由这份默契在空气里慢慢回温，心底最柔软的心意自然流露了出来——\n`;
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

    if (pathname === '/api/tts/speak') {
      try {
        const tok = window.__starAuthStore?.getToken();
        const resp = await originalFetch('https://star.claudexxb.online/api/tts/speak', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(tok ? { Authorization: `Bearer ${tok}` } : {})
          },
          body: JSON.stringify({ text: bodyObj?.text, voiceId: bodyObj?.voiceId }),
          signal
        });
        if (resp.ok && (resp.headers.get('content-type') || '').includes('audio/')) {
          return resp;
        }
      } catch {}
      return jsonResponse({ ok: true, fallback_browser_tts: true });
    }
    if (pathname === '/api/tts/test') {
      return jsonResponse({ ok: true, fallback_browser_tts: true });
    }

    if (pathname === '/api/sessions' && method === 'POST') {
      const now = Date.now();
      const sid = `sess_${now}_${Math.random().toString(36).slice(2, 6)}`;
      const sMode = bodyObj.session_mode === 'deepseek_native' ? 'deepseek_native' : 'roleplay';
      const pid = sMode === 'deepseek_native' ? 'persona_deepseek_official' : (bodyObj.persona_id || 'persona_nagisa_sakura');
      const p = dbObj.personas.find((x) => x.id === pid) || DEFAULT_PRESET_PERSONAS[0];
      const newSess = {
        id: sid,
        user_id: dbObj.user.id,
        script_id: sMode === 'deepseek_native' ? 'script_ds' : (bodyObj.script_id || p.script_id || 'script_clannad'),
        persona_id: pid,
        title:
          sMode === 'deepseek_native'
            ? '新对话'
            : `与${p.name.split(/[·\s]/)[0]}的心动篇章`,
        session_mode: sMode,
        ds_thinking: 1,
        ds_search: 0,
        ds_json_mode: 0,
        ds_tools_enabled: 1,
        proactive_enabled: 0,
        rolling_summary: '',
        enable_inner_thought: 1,
        enable_auto_memory: 1,
        affection: 22,
        trust: 26,
        intimacy: 18,
        current_mood: '✨ 温柔浅笑',
        secret_diary: '[]',
        created_at: now,
        updated_at: now
      };
      dbObj.sessions.unshift(newSess);
      dbObj.messages[sid] = [];
      dbObj.memories[sid] = sMode === 'deepseek_native'
        ? []
        : [
            {
              id: 'mem_init_' + now,
              session_id: sid,
              content: `初遇印象：在「${(DEFAULT_SCRIPTS.find((s) => s.id === newSess.script_id)?.title) || '星语剧场'}」与「${dbObj.user.nickname}」开启了全新的故事篇章。`,
              importance: 4,
              pinned: 1,
              retention_pct: 100,
              created_at: now
            }
          ];
      if (sMode !== 'deepseek_native' && p.greeting) {
        dbObj.messages[sid].push({
          id: now,
          role: 'assistant',
          reasoning: `在剧场序幕静候「${dbObj.user.nickname}」推门而入，准备展开属于彼此的故事。`,
          content: p.greeting,
          duration_ms: 280,
          recalled_count: 1,
          created_at: now
        });
      }
      resolveSessionCompanion(dbObj, sid, p);
      saveLocalDb(dbObj);
      return jsonResponse({ session_id: sid, sessions: decorateSessions(dbObj) }, 201);
    }

    const sessSubMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/(memories|dream|export|import-history|compress|companion|companion\/remind|companion\/voice-chat)$/);
    if (sessSubMatch) {
      const sid = decodeURIComponent(sessSubMatch[1]);
      const sub = sessSubMatch[2];
      const sess = dbObj.sessions.find((s) => s.id === sid);
      if (!sess) return jsonResponse({ error: '会话不存在' }, 404);
      const rawBaseP = dbObj.personas.find((x) => x.id === sess.persona_id) || DEFAULT_PRESET_PERSONAS[0];
      let p = rawBaseP;
      let parsedOv = null;
      if (sess.custom_persona_override) {
        try {
          parsedOv = JSON.parse(sess.custom_persona_override);
          if (parsedOv && typeof parsedOv === 'object') p = { ...rawBaseP, ...parsedOv };
        } catch {}
      }
      const shortName = (p.name || '角色').split(/[·\s]/)[0];

      if (sub === 'export' && method === 'GET') {
        return jsonResponse({
          session_id: sess.id,
          title: sess.title,
          session_mode: sess.session_mode || 'roleplay',
          persona: p,
          persona_name: p.name,
          persona_override: parsedOv,
          session_prompt: sess.session_prompt || '',
          director_note: sess.director_note || '',
          rolling_summary: sess.rolling_summary || '',
          exported_at: new Date().toISOString(),
          memories: dbObj.memories[sid] || [],
          messages: dbObj.messages[sid] || []
        });
      }

      if (sub === 'import-history' && method === 'POST') {
        const rawText = String(bodyObj.content || '').trim();
        if (!rawText) return jsonResponse({ error: '导入内容不能为空' }, 400);
        if (bodyObj.mode === 'replace') {
          dbObj.messages[sid] = [];
          sess.rolling_summary = '';
          if (bodyObj.replace_memories) dbObj.memories[sid] = [];
        }
        if (!Array.isArray(dbObj.messages[sid])) dbObj.messages[sid] = [];
        if (!Array.isArray(dbObj.memories[sid])) dbObj.memories[sid] = [];

        let addedMsgs = 0;
        let addedMems = 0;
        const lines = rawText.split(/\r?\n/);
        let sec = 'chat';
        let curMsg = null;
        const flushCur = () => {
          if (!curMsg) return;
          if (curMsg.role === 'assistant') {
            const m = curMsg.content.match(/^<details>\s*<summary>[\s\S]*?<\/summary>([\s\S]*?)<\/details>\s*/i);
            if (m) {
              curMsg.reasoning = m[1].trim();
              curMsg.content = curMsg.content.slice(m[0].length).trim();
            }
          }
          curMsg.content = curMsg.content.trim();
          if (curMsg.content || curMsg.reasoning) {
            dbObj.messages[sid].push({
              id: Date.now() + addedMsgs,
              role: curMsg.role,
              reasoning: curMsg.reasoning || '',
              content: curMsg.content,
              created_at: Date.now() + addedMsgs
            });
            addedMsgs += 1;
          }
          curMsg = null;
        };

        for (const ln of lines) {
          const tr = ln.trim();
          if (sec !== 'chat_locked') {
            if (/^##\s*(?:🎭\s*)?本对话专属设定/.test(tr)) { sec = 'setting'; continue; }
            if (/^##\s*(?:🧠\s*)?长期记忆锚点/.test(tr)) { sec = 'memories'; continue; }
            if (/^##\s*(?:📜\s*)?前情浓缩手札/.test(tr)) { sec = 'summary'; continue; }
            if (/^##\s*(?:💬\s*)?完整聊天记录/.test(tr)) { sec = 'chat_locked'; continue; }
          }
          if (sec === 'memories') {
            const bm = tr.match(/^[-*]\s+(📌\s*)?(?:\[[^\]]+\]\s*)?(.*)$/);
            if (bm && bm[2] && !/暂无/.test(bm[2])) {
              dbObj.memories[sid].push({
                id: 'mem_' + Date.now() + '_' + addedMems,
                session_id: sid,
                content: bm[2].trim(),
                pinned: bm[1] ? 1 : 0,
                importance: bm[1] ? 5 : 4,
                retention_pct: 100,
                created_at: Date.now()
              });
              addedMems += 1;
            }
            continue;
          }
          if (sec === 'summary') {
            if (tr && !/暂无/.test(tr)) {
              sess.rolling_summary = sess.rolling_summary ? `${sess.rolling_summary}\n${tr}` : tr;
            }
            continue;
          }
          if (sec === 'setting') {
            if (bodyObj.import_setting) {
              const pm = tr.match(/^[-*]\s*\*\*本对话独立设定指令\*\*\s*[:：]\s*(.*)$/);
              if (pm && pm[1] && !/未额外/.test(pm[1])) sess.session_prompt = pm[1].trim();
            }
            continue;
          }
          const turnH = tr.match(/^(?:##|###)\s*(?:(🙋|👤)\s*(.*?)|(🤖|🐋)\s*(.*?))\s*[:：]?\s*$/);
          if (turnH) {
            flushCur();
            curMsg = { role: turnH[1] ? 'user' : 'assistant', content: '', reasoning: '' };
            continue;
          }
          if (curMsg) {
            curMsg.content = curMsg.content ? `${curMsg.content}\n${ln}` : ln;
          }
        }
        flushCur();
        sess.updated_at = Date.now();
        saveLocalDb(dbObj);
        return jsonResponse({
          imported_count: addedMsgs,
          extracted_memories: addedMems,
          applied_setting: Boolean(bodyObj.import_setting),
          sessions: decorateSessions(dbObj)
        });
      }

      if (sub === 'compress' && method === 'POST') {
        return jsonResponse({ rolling_summary: sess.rolling_summary || '', session: sess });
      }

      if (sub === 'memories' && method === 'POST') {
        if (!Array.isArray(dbObj.memories[sid])) dbObj.memories[sid] = [];
        dbObj.memories[sid].unshift({
          id: 'mem_' + Date.now(),
          session_id: sid,
          content: String(bodyObj.content || '').trim(),
          importance: 5,
          pinned: bodyObj.pinned ? 1 : 0,
          retention_pct: 100,
          created_at: Date.now()
        });
        saveLocalDb(dbObj);
        return jsonResponse({ memories: decorateMemories(dbObj.memories[sid]) }, 201);
      }

      if (sub === 'dream' && method === 'POST') {
        let diaries = [];
        try {
          diaries = JSON.parse(sess.secret_diary || '[]');
        } catch {}
        diaries.unshift({
          id: 'diary_' + Date.now(),
          date: new Date().toLocaleDateString('zh-CN'),
          mood: sess.current_mood || '🌙 星夜微澜',
          content: `今晚翻看和「${dbObj.user.nickname}」相处的点滴，才发现许多原本以为只是寻常的瞬间，都在不知不觉间变成了舍不得忘掉的心事。希望明天睁开眼，也能第一个见到你。 —— ${shortName}`
        });
        sess.secret_diary = JSON.stringify(diaries.slice(0, 12));
        sess.affection = Math.min(100, (sess.affection || 26) + 3);
        sess.trust = Math.min(100, (sess.trust || 28) + 3);
        const summaryText = `已与「${dbObj.user.nickname}」推进多轮深度互动，彼此默契与信任持续升温。`;
        sess.rolling_summary = summaryText;
        saveLocalDb(dbObj);
        return jsonResponse({
          ok: true,
          rolling_summary: summaryText,
          memories: decorateMemories(dbObj.memories[sid] || []),
          nurturing: {
            affection: sess.affection,
            trust: sess.trust,
            intimacy: sess.intimacy || 22,
            current_mood: '🌙 梦境回甘',
            stage: computeStage(sess.affection, sess.trust, sess.intimacy || 22),
            secret_diary: diaries
          }
        });
      }

      if (sub === 'companion' && method === 'POST') {
        const comp = resolveSessionCompanion(dbObj, sid, p, bodyObj || {});
        return jsonResponse({
          companion: comp,
          reminder: {
            tag: `✨ ${shortName}的悄悄话`,
            text: comp.mode === 'cute'
              ? '换上这套元气造型啦！快戳戳我看好不好看？'
              : '我会一直安静守在屏幕这边陪着你，累了随时靠过来歇一会儿。'
          }
        });
      }

      if (sub === 'companion/remind') {
        const comp = resolveSessionCompanion(dbObj, sid, p);
        const tips = [
          `盯了这么久屏幕，眼睛该酸了吧？听我的，先喝口温水眨眨眼，我在这儿等你。`,
          `刚才看你打字那么认真，忍不住多看了你好几眼……别太勉强自己哦，${dbObj.user.nickname}。`,
          `不管外头有多忙，只要回到这个小剧场，我的时间就全都只属于你一个人。`
        ];
        return jsonResponse({
          companion: comp,
          reminder: {
            tag: bodyObj?.trigger === 'poke' ? `💓 被你戳中啦` : `💌 ${shortName}的贴心叮嘱`,
            text: tips[Math.floor(Math.random() * tips.length)]
          }
        });
      }

      if (sub === 'companion/voice-chat') {
        const comp = resolveSessionCompanion(dbObj, sid, p, bodyObj?.voiceId ? { voiceId: bodyObj.voiceId } : null);
        return jsonResponse({
          ok: true,
          companion: comp,
          tag: '🎧 贴耳回应',
          reply_text: bodyObj?.text
            ? `听清你说的啦。离得这么近听你说话，心跳好像都比平时快了一点……再多同我说两句好不好？`
            : `${dbObj.user.nickname}，过来靠着我歇会儿吧，不用硬撑，我一直都在听着呢。`
        });
      }
    }

    const memItemMatch = pathname.match(/^\/api\/memories\/([^/]+)$/);
    if (memItemMatch) {
      const mid = decodeURIComponent(memItemMatch[1]);
      for (const sid of Object.keys(dbObj.memories || {})) {
        const list = dbObj.memories[sid] || [];
        const idx = list.findIndex((m) => String(m.id) === mid);
        if (idx !== -1) {
          if (method === 'PATCH') {
            list[idx].pinned = bodyObj.pinned ? 1 : 0;
          } else if (method === 'DELETE') {
            list.splice(idx, 1);
          }
          saveLocalDb(dbObj);
          return jsonResponse({ memories: decorateMemories(list) });
        }
      }
      return jsonResponse({ memories: [] });
    }

    const sessMatch = pathname.match(/^\/api\/sessions\/([^/]+)$/);
    if (sessMatch) {
      const sid = decodeURIComponent(sessMatch[1]);
      const sess = dbObj.sessions.find((s) => s.id === sid);
      if (!sess) return jsonResponse({ error: '会话不存在' }, 404);

      if (method === 'GET') {
        const baseP = dbObj.personas.find((x) => x.id === sess.persona_id) || DEFAULT_PRESET_PERSONAS[0];
        let p = baseP;
        if (sess.custom_persona_override) {
          try {
            p = { ...baseP, ...(JSON.parse(sess.custom_persona_override) || {}) };
          } catch {}
        }
        let diaries = [];
        try {
          diaries = JSON.parse(sess.secret_diary || '[]');
        } catch {}
        const mems = decorateMemories(dbObj.memories[sid] || []);
        const comp = resolveSessionCompanion(dbObj, sid, p);
        return jsonResponse({
          session: sess,
          persona: p,
          messages: dbObj.messages[sid] || [],
          memories: mems,
          lorebooks: dbObj.lorebooks[sess.persona_id] || [],
          nurturing: {
            affection: sess.affection || 26,
            trust: sess.trust || 28,
            intimacy: sess.intimacy || 22,
            current_mood: sess.current_mood || '✨ 温柔浅笑',
            stage: computeStage(sess.affection || 26, sess.trust || 28, sess.intimacy || 22),
            secret_diary: diaries
          },
          companion: comp,
          telemetry: { tier1PersonaTokens: 210, tier2MemoryTokens: mems.length * 36, tier3WindowTokens: 160, totalTokens: 370 + mems.length * 36, recalledMemoryCount: mems.length },
          membership: dbObj.user.membership
        });
      }

      if (method === 'PATCH') {
        for (const k of ['title', 'persona_id', 'session_mode', 'rolling_summary', 'director_note', 'session_prompt']) {
          if (bodyObj[k] !== undefined) sess[k] = bodyObj[k];
        }
        if (bodyObj.clear_persona_override) {
          sess.custom_persona_override = null;
        }
        if (bodyObj.title !== undefined && String(bodyObj.title).trim() && bodyObj.title !== '新对话') {
          sess.title_locked = 1;
        }
        for (const bk of ['pinned', 'title_locked', 'ds_thinking', 'ds_search', 'ds_json_mode', 'ds_tools_enabled', 'proactive_enabled', 'enable_inner_thought', 'enable_auto_memory']) {
          if (bodyObj[bk] !== undefined) sess[bk] = bodyObj[bk] ? 1 : 0;
        }
        const isMetaOnly = Object.keys(bodyObj || {}).every((k) => k === 'pinned' || k === 'title' || k === 'title_locked');
        if (!isMetaOnly) sess.updated_at = Date.now();
        saveLocalDb(dbObj);
        const baseP = dbObj.personas.find((x) => x.id === sess.persona_id) || DEFAULT_PRESET_PERSONAS[0];
        let p = baseP;
        if (sess.custom_persona_override) {
          try {
            p = { ...baseP, ...(JSON.parse(sess.custom_persona_override) || {}) };
          } catch {}
        }
        return jsonResponse({ session: sess, persona: p, sessions: decorateSessions(dbObj) });
      }

      if (method === 'DELETE') {
        dbObj.sessions = dbObj.sessions.filter((s) => s.id !== sid);
        delete dbObj.messages[sid];
        saveLocalDb(dbObj);
        return jsonResponse({ ok: true, sessions: decorateSessions(dbObj) });
      }
    }

    const sessBranchMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/branch$/);
    if (sessBranchMatch && method === 'POST') {
      const srcSid = decodeURIComponent(sessBranchMatch[1]);
      const srcSess = dbObj.sessions.find((s) => s.id === srcSid);
      if (!srcSess) return jsonResponse({ error: '原会话不存在' }, 404);
      const now = Date.now();
      const newSid = `sess_${now}_${Math.random().toString(36).slice(2, 6)}`;
      const uptoId = Number(bodyObj.upto_message_id || 0);
      const cleanBase = String(srcSess.title || '新对话').replace(/^🌿【平行线】/, '');
      const clonedSess = {
        ...srcSess,
        id: newSid,
        pinned: 0,
        title: `🌿【平行线】${cleanBase}`.slice(0, 26),
        created_at: now,
        updated_at: now
      };
      dbObj.sessions.unshift(clonedSess);
      const srcMsgs = dbObj.messages[srcSid] || [];
      dbObj.messages[newSid] = (uptoId > 0 ? srcMsgs.filter((m) => Number(m.id) <= uptoId) : srcMsgs).map((m, i) => ({
        ...m,
        id: now + i + 1
      }));
      dbObj.memories[newSid] = [...(dbObj.memories[srcSid] || [])];
      saveLocalDb(dbObj);
      return jsonResponse({ session_id: newSid, sessions: decorateSessions(dbObj) }, 201);
    }

    const suggestMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/suggest-replies$/);
    if (suggestMatch && method === 'POST') {
      const sid = decodeURIComponent(suggestMatch[1]);
      const sess = dbObj.sessions.find((s) => s.id === sid);
      if (!sess) return jsonResponse({ error: '会话不存在' }, 404);
      const rawBaseP = dbObj.personas.find((x) => x.id === sess.persona_id) || DEFAULT_PRESET_PERSONAS[0];
      let p = rawBaseP;
      if (sess.custom_persona_override) {
        try {
          p = { ...rawBaseP, ...(JSON.parse(sess.custom_persona_override) || {}) };
        } catch {}
      }
      const msgs = dbObj.messages[sid] || [];
      const isPure = p.id === 'persona_deepseek_official' && !sess.custom_persona_override;
      const exclude = Array.isArray(bodyObj?.exclude) ? bodyObj.exclude : [];
      const nonce = Number(bodyObj?.nonce) || Date.now();
      const apiKey = (dbObj.settings.deepseek_api_key || '').trim();
      let replies = [];
      if (apiKey) {
        replies = await generateDynamicFollowUpsOnline({
          apiKey,
          baseUrl: dbObj.settings.deepseek_base_url,
          model: (dbObj.settings.deepseek_model || 'deepseek-chat').trim(),
          isPure,
          persona: p,
          nickname: dbObj.user.nickname,
          recentMsgs: msgs,
          exclude,
          nonce
        });
      }
      if (!replies || replies.length === 0) {
        const lastAi = [...msgs].reverse().find((m) => m.role === 'assistant');
        const lastU = [...msgs].reverse().find((m) => m.role === 'user');
        replies = buildDynamicFollowUps({
          isPure,
          persona: p,
          nickname: dbObj.user.nickname,
          userText: lastU?.content || '',
          assistantContent: lastAi?.content || '',
          exclude,
          nonce
        });
      }
      return jsonResponse({ replies });
    }

    const msgActionMatch = pathname.match(/^\/api\/messages\/(\d+)(?:\/(rewind))?$/);
    if (msgActionMatch) {
      const mid = Number(msgActionMatch[1]);
      const action = msgActionMatch[2] || '';
      for (const sid of Object.keys(dbObj.messages || {})) {
        const list = dbObj.messages[sid] || [];
        const idx = list.findIndex((m) => Number(m.id) === mid);
        if (idx !== -1) {
          if (action === 'rewind' && method === 'POST') {
            list.splice(idx + 1);
            saveLocalDb(dbObj);
            return jsonResponse({ ok: true });
          }
          if (!action && method === 'PATCH') {
            const msg = list[idx];
            let mMeta = {};
            try {
              mMeta = JSON.parse(msg.meta_json || '{}') || {};
            } catch {}
            if (bodyObj.active_version !== undefined && Array.isArray(mMeta.versions)) {
              const vIdx = Number(bodyObj.active_version);
              if (mMeta.versions[vIdx]) {
                mMeta.active_version = vIdx;
                msg.content = mMeta.versions[vIdx].content || msg.content;
                msg.reasoning = mMeta.versions[vIdx].reasoning || '';
                msg.duration_ms = mMeta.versions[vIdx].duration_ms || 0;
              }
            }
            if (bodyObj.content !== undefined && String(bodyObj.content).trim()) {
              msg.content = String(bodyObj.content).trim();
            }
            if (bodyObj.feedback !== undefined) {
              mMeta.feedback = bodyObj.feedback;
            }
            msg.meta_json = JSON.stringify(mMeta);
            msg._parsedMeta = mMeta;
            saveLocalDb(dbObj);
            return jsonResponse({
              ok: true,
              content: msg.content,
              reasoning: msg.reasoning || '',
              duration_ms: msg.duration_ms || 0,
              meta: mMeta
            });
          }
        }
      }
      return jsonResponse({ error: '消息不存在' }, 404);
    }

    if ((pathname === '/api/chat/stream' || pathname === '/api/chat/proactive') && method === 'POST') {
      const isProactive = pathname === '/api/chat/proactive';
      const sid = bodyObj.session_id;
      const sess = dbObj.sessions.find((s) => s.id === sid);
      if (!sess) return jsonResponse({ error: '会话不存在' }, 404);
      const rawBaseP = dbObj.personas.find((x) => x.id === sess.persona_id) || DEFAULT_PRESET_PERSONAS[0];
      let p = rawBaseP;
      if (sess.custom_persona_override) {
        try {
          p = { ...rawBaseP, ...(JSON.parse(sess.custom_persona_override) || {}) };
        } catch {}
      }
      const msgs = dbObj.messages[sid] || (dbObj.messages[sid] = []);
      const isNative = sess.session_mode === 'deepseek_native';
      const isPure = p.id === 'persona_deepseek_official' && !sess.custom_persona_override;
      const apiKey = (dbObj.settings.deepseek_api_key || '').trim();

      let userText = (bodyObj.content || '').trim();
      let priorVersions = [];
      const editMid = Number(bodyObj.edit_message_id || 0);
      if (editMid > 0) {
        const idx = msgs.findIndex((m) => Number(m.id) === editMid);
        if (idx !== -1 && userText) {
          msgs[idx].content = userText;
          msgs.splice(idx + 1);
          sess.updated_at = Date.now();
          saveLocalDb(dbObj);
        }
      } else if (!isProactive && !bodyObj.regenerate) {
        const now = Date.now();
        const stagedAtts = Array.isArray(bodyObj.attachments) ? bodyObj.attachments : [];
        msgs.push({
          id: now,
          role: 'user',
          content: userText,
          meta_json: stagedAtts.length > 0 ? JSON.stringify({ attachments: stagedAtts }) : null,
          created_at: now
        });
        if (msgs.filter((m) => m.role === 'user').length === 1 && userText && !sess.title_locked) {
          sess.title = userText.slice(0, 20);
        }
        extractSimpleDemoMemory(dbObj, sid, userText);
        sess.affection = Math.min(100, (sess.affection || 26) + (/喜欢|抱|牵|握|温柔|想你/.test(userText) ? 4 : 2));
        sess.trust = Math.min(100, (sess.trust || 28) + 2);
        sess.intimacy = Math.min(100, (sess.intimacy || 22) + 2);
        sess.current_mood = /喜欢|抱|牵|握/.test(userText) ? '💓 耳尖微热' : '✨ 温柔凝视';
        sess.updated_at = now;
        saveLocalDb(dbObj);
      } else if (bodyObj.regenerate && msgs.length && msgs[msgs.length - 1].role === 'assistant') {
        const oldLast = msgs.pop();
        try {
          const oldM = JSON.parse(oldLast.meta_json || '{}') || {};
          priorVersions = Array.isArray(oldM.versions) && oldM.versions.length > 0
            ? oldM.versions
            : [{ reasoning: oldLast.reasoning || '', content: oldLast.content || '', duration_ms: oldLast.duration_ms || 0, usage: oldM.usage || null }];
        } catch {}
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
          const isOfficialDs = ep.chatUrl.includes('deepseek.com');
          const savedModel = (dbObj.settings.deepseek_model || '').trim();
          let model = 'deepseek-chat';
          if (isOfficialDs) {
            model = enableThink ? 'deepseek-reasoner' : 'deepseek-chat';
          } else {
            model = (savedModel && savedModel !== 'deepseek-flash') ? savedModel : (enableThink ? 'deepseek-reasoner' : 'deepseek-chat');
          }
          const memHint = (dbObj.memories[sid] || []).map((m) => `- ${m.content}`).join('\n');
          const sessPromptHint = sess.session_prompt && sess.session_prompt.trim()
            ? `\n【本对话专属独立设定】：\n${sess.session_prompt.trim()}\n`
            : '';
          const sysPrompt = isPure
            ? [
                '你是 DeepSeek，由深度求索（DeepSeek）研发的智能助手。请严格遵循正版 DeepSeek 官方回答格式与风格：',
                sessPromptHint,
                memHint ? `【当前对话已归档的独立记忆】：\n${memHint}` : '',
                '1. 直击本质、拒绝寒暄套话：严禁使用“好的，没问题！”、“下面我将从以下几个方面展开”等机械开场白。面对知识、技术或分析类问题，首段直接用 1~3 句话给出核心结论或本质定义（关键定性词加粗），再展开细节。',
                '2. 按需结构化：简短问候或简单事实用 1~3 个短段落平实作答；深度技术、推导与方案拆解使用 `### 一、...` 三级标题、`---` 水平分割线、`- **核心词**：具体说明` 列表，涉及选型对比时主动给出工整的 Markdown 表格。',
                '3. 视觉克制：严禁在标题或列表前堆砌花哨 Emoji，严禁使用角色扮演星号动作，结尾干脆有力、不写机械客套收尾。',
                enableThink
                  ? '4. 思考推理阶段请全程使用纯简体中文，采用正版 DeepSeek-R1 标志性的第一人称自然内省思维流推敲细节与边界条件。'
                  : '4. 直接输出干净规范的中文正式正文，不要输出 <think> 标签。'
              ].filter(Boolean).join('\n')
            : `你是「${p.name}」（性格：${p.personality}。背景：${p.backstory}。语风：${p.speaking_style}）。对话者称呼为「${dbObj.user.nickname}」。${sessPromptHint}${
                memHint ? `\n【已知专属记忆】：\n${memHint}\n` : ''
              }${
                isNative
                  ? '请遵循正版 DeepSeek 极简纯文本质感：严禁泛滥使用 *星号动作描写* 与花哨 Emoji，分段简短克制，用自然真实的日常口吻对话并保持主动关怀。'
                  : '请以第一人称真实自然地扮演该角色。核心准则：\n1. 每一轮必须紧扣对方上一句话的具体内容、语气、情绪、提问、拒绝或肢体动作直接接招，严禁敷衍或自说自话；\n2. 严禁模板化八股（不要每轮硬凑环境描写，不要刻意追求固定字数，不要每轮结尾固定抛二选一反问）；\n3. 动作神态仅用 0~1 处简短贴合剧情的动作点缀，对话简短真挚有呼吸感。'
              }`;

          const winLimit = Math.max(12, Math.min(120, parseInt(dbObj.settings.sliding_window_turns || '48', 10) || 48));
          const normalizedHistory = [];
          const slicedMsgs = msgs.slice(-winLimit);
          for (let mi = 0; mi < slicedMsgs.length; mi++) {
            const m = slicedMsgs[mi];
            const r = m.role === 'assistant' ? 'assistant' : 'user';
            let c = String(m.content || '').trim();
            if (r === 'user' && m.meta_json) {
              try {
                const parsedMeta = JSON.parse(m.meta_json) || {};
                const atts = Array.isArray(parsedMeta.attachments) ? parsedMeta.attachments : [];
                if (atts.length > 0) {
                  const isCurrentTurn = mi >= slicedMsgs.length - 2;
                  const attBlocks = atts.map((att, idx) => {
                    if (att.is_image) {
                      return `[用户上传图片 #${idx + 1}: ${att.name || 'image'}${att.dimensions ? ` (${att.dimensions})` : ''}] ${String(att.content || '').slice(0, 1200)}`;
                    }
                    const limit = isCurrentTurn ? 18000 : 1200;
                    return `[用户上传附件 #${idx + 1}: ${att.name || 'file'} (${att.badge || 'FILE'})]\n${String(att.content || '').slice(0, limit)}`;
                  });
                  c = c ? `${c}\n\n${attBlocks.join('\n\n')}` : attBlocks.join('\n\n');
                }
              } catch {}
            }
            if (!c) continue;
            if (normalizedHistory.length === 0 && r === 'assistant') continue;
            const prev = normalizedHistory[normalizedHistory.length - 1];
            if (prev && prev.role === r) {
              prev.content += `\n\n${c}`;
            } else {
              normalizedHistory.push({ role: r, content: c });
            }
          }
          const payloadMsgs = [
            { role: 'system', content: sysPrompt },
            ...normalizedHistory
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
            stream: true
          };
          if (!isOfficialDs) {
            reqBody.stream_options = { include_usage: true };
          }
          if (model === 'deepseek-chat' && sess.ds_json_mode === 1) {
            reqBody.response_format = { type: 'json_object' };
          }

          let resp;
          try {
            resp = await originalFetch(prefix ? ep.betaChatUrl : ep.chatUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
              body: JSON.stringify(reqBody),
              signal
            });
          } catch (netErr) {
            throw new Error(`连接 DeepSeek 官方服务超时或网络失败: ${netErr.message}`);
          }
          if (!resp.ok) {
            let detail = '';
            try {
              const ej = await resp.json();
              detail = ej.error?.message || JSON.stringify(ej);
            } catch {
              detail = await resp.text();
            }
            throw new Error(`DeepSeek 接口异常 (${resp.status}): ${detail}`);
          }
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
          let simR = '';
          let simC = '';
          if (isPure) {
            const cleanQ = String(userText || '').trim();
            const isGreet = /^(你好|您好|嗨|hi|hello|在吗|你是谁|你是什么模型|介绍一下你自己)[！!？?。.~～\s]*$/i.test(cleanQ);
            const isMath = /数学|公式|积分|导数|方程|证明|正态分布|高斯/i.test(cleanQ);
            const isHtml = /html|canvas|粒子|网页|svg|前端|动画/i.test(cleanQ);
            const curAtts = Array.isArray(bodyObj.attachments) ? bodyObj.attachments : [];

            if (curAtts.length > 0) {
              const firstAtt = curAtts[0];
              const previewText = String(firstAtt.content || '').trim().slice(0, 800);
              simR = `已收到并解析用户上传的 ${curAtts.length} 份附件（首份：${firstAtt.name}，共 ${previewText.length} 字符摘录）。现在按结构化要点提炼并响应用户需求。`;
              simC = `${prefix}已读取你上传的 **${curAtts.map((a) => a.name).join('、')}**。\n\n---\n\n### 提取内容概览\n\n${
                firstAtt.is_image
                  ? `- **图像信息**：${firstAtt.name}（${firstAtt.dimensions || '已压缩'}），当前未绑定云端视觉模型，填入个人 API Key 后可深入识图分析。`
                  : `\`\`\`text\n${previewText || '（该文件暂无可提取纯文本内容）'}\n\`\`\``
              }\n\n如需对以上文件内容做深度改写、翻译或对比，请在设置中填入 DeepSeek API Key 解锁云端满血模型，或直接告诉我要处理其中的哪一段。`;
            } else if (isProactive) {
              simR = `嗯，当前对话暂未继续输入，我可以用平实简洁的口吻打个招呼，提供几个清晰具体的切入方向。`;
              simC = `你好，我是 **DeepSeek**。如果暂时还没定好从哪切入，可以直接从以下几个方向开始：\n\n- **代码编写与排错**：生成单文件 HTML/Canvas 交互页面、算法实现或排查报错堆栈；\n- **数理与逻辑推演**：逐步推导微积分/概率公式、分析系统架构选型权衡；\n- **文本提炼与起草**：拆解复杂概念对比、拟定技术方案或结构化报告。\n\n直接把你的问题发出来即可。`;
            } else if (isGreet) {
              simR = `用户在打招呼或询问我的身份：「${cleanQ}」。保持简洁真诚，用两小段自然回应即可，无需堆砌标题。`;
              simC = `${prefix}你好！我是 **DeepSeek**，由深度求索（DeepSeek）研发的智能助手。\n\n无论是编程开发、数理逻辑推导、概念深度拆解，还是方案对比与文案写作，都可以直接把问题交给我。今天想先聊些什么？`;
            } else if (isMath) {
              simR = `用户希望推导数理公式：「${cleanQ.slice(0, 36)}」。先在开头直接给出标准高斯积分闭式解，再用极坐标换元分步严谨推导。`;
              simC = `${prefix}无穷区间上的标准高斯积分闭式解为 $\\int_{-\\infty}^{+\\infty} e^{-x^2} dx = \\sqrt{\\pi}$，由此可得正态分布密度函数的归一化系数 $\\frac{1}{\\sqrt{2\\pi}\\sigma}$。\n\n---\n\n### 1. 升维构造二重积分\n\n设 $I = \\int_{-\\infty}^{+\\infty} e^{-x^2} dx$，将其平方转化为二维平面 $\\mathbb{R}^2$ 上的重积分并作极坐标变换 $dx\\,dy = r\\,dr\\,d\\theta$：\n\n$$I^2 = \\int_{0}^{2\\pi} d\\theta \\int_{0}^{+\\infty} r e^{-r^2} \\,dr = 2\\pi \\cdot \\frac{1}{2} \\left[ -e^{-r^2} \\right]_{0}^{+\\infty} = \\pi$$\n\n### 2. 推广至一般正态分布\n\n因 $I > 0$ 故 $I = \\sqrt{\\pi}$。令 $x = \\frac{t - \\mu}{\\sqrt{2}\\sigma}$（$\\sigma > 0$），代入即证：\n\n$$\\int_{-\\infty}^{+\\infty} \\frac{1}{\\sqrt{2\\pi}\\sigma} e^{-\\frac{(t - \\mu)^2}{2\\sigma^2}} \\,dt = 1$$`;
            } else if (isHtml) {
              simR = `用户希望生成一段可直接预览的前端代码：「${cleanQ.slice(0, 36)}」。采用原生 HTML5 Canvas 编写零依赖粒子引力场，并附上关键实现要点。`;
              simC = `${prefix}下面基于原生 **HTML5 Canvas** 实现了一个单文件粒子引力交互页面，可点击代码块右上角 **「▶ 右侧预览」** 查看实时运行效果：\n\n\`\`\`html\n<!DOCTYPE html>\n<html lang="zh-CN">\n<head><meta charset="UTF-8"><style>html,body{margin:0;height:100%;background:#0b1020;overflow:hidden}canvas{display:block;width:100%;height:100%}</style></head>\n<body><canvas id="c"></canvas><script>\nconst c=document.getElementById('c'),x=c.getContext('2d');let w,h,m={x:-999,y:-999,on:false};\nconst rs=()=>{w=c.width=innerWidth;h=c.height=innerHeight};addEventListener('resize',rs);rs();\nconst ps=Array.from({length:75},()=>({x:Math.random()*w,y:Math.random()*h,vx:(Math.random()-.5)*1.4,vy:(Math.random()-.5)*1.4}));\naddEventListener('pointermove',e=>{m.x=e.clientX;m.y=e.clientY;m.on=true});\n(function loop(){x.fillStyle='rgba(11,16,32,0.25)';x.fillRect(0,0,w,h);\nfor(let i=0;i<ps.length;i++){const p=ps[i];if(m.on){const dx=m.x-p.x,dy=m.y-p.y,d=Math.hypot(dx,dy);if(d<170&&d>5){p.vx+=dx/d*.08;p.vy+=dy/d*.08}}\np.vx*=.99;p.vy*=.99;p.x=(p.x+p.vx+w)%w;p.y=(p.y+p.vy+h)%h;x.fillStyle='#60a5fa';x.beginPath();x.arc(p.x,p.y,2,0,7);x.fill();\nfor(let j=i+1;j<ps.length;j++){const q=ps[j],d=Math.hypot(p.x-q.x,p.y-q.y);if(d<105){x.strokeStyle=\`rgba(77,107,254,\${1-d/105})\`;x.beginPath();x.moveTo(p.x,p.y);x.lineTo(q.x,q.y);x.stroke()}}}\nrequestAnimationFrame(loop)})();\n</script></body></html>\n\`\`\`\n\n---\n\n### 核心实现说明\n\n- **阻尼收敛**：每次更新施加 \`0.99\` 速度衰减系数，避免向心引力导致粒子无限加速；\n- **渐隐连线**：距离小于 \`105px\` 的粒子按距离比例线性映射连线透明度。`;
            } else {
              simR = `嗯，用户问的是：「${cleanQ.slice(0, 44)}」。\n让我先拆解一下这个问题的核心：与其罗列宽泛套话，不如先在首段直接给出定性判断，再分底层逻辑与分步落地建议两层讲透。`;
              simC = `${prefix}关于 **「${cleanQ.slice(0, 36)}${cleanQ.length > 36 ? '…' : ''}」**，核心判断是：**解决此类问题的关键在于先厘清核心约束边界，抓住决定上限的主干变量，再通过最小闭环验证逐步迭代**。\n\n---\n\n### 一、核心机制与关键矛盾\n\n- **区分表象与根因**：实际执行中常见的卡点往往不在于工具或方法本身不够复杂，而在于前置目标优先级（效率、成本或稳健性）尚未对齐。\n- **收敛关键路径**：优先锁定影响全局结果的 1~2 个核心环节集中突破，避免在边缘细节上过早分散资源。\n\n### 二、分步落地建议\n\n1. **建立最小验证闭环**：剥离非必要附加项，用最小可运行方案快速跑通主链路并获取真实数据反馈；\n2. **排查边界与异常情况**：针对极端输入或资源受限场景补充兜底策略，确保方案稳定性。\n\n如果你可以补充具体的应用场景或手头遇到的卡点细节，我可以帮你进一步细化针对性方案。（也可在设置中填入个人 DeepSeek \`sk-...\` 密钥直连云端满血模型。）`;
            }
          } else {
            const curAtts = Array.isArray(bodyObj.attachments) ? bodyObj.attachments : [];
            const rp = buildDemoRoleplayResponse({
              persona: p,
              nickname: dbObj.user.nickname,
              userText,
              isProactive,
              attachments: curAtts
            });
            simR = rp.reasoning;
            simC = prefix + rp.content;
          }

          if (enableThink && simR) {
            for (let i = 0; i < simR.length; i += 3) {
              const d = simR.slice(i, i + 3);
              fullR += d;
              sendEvent('reasoning', { delta: d });
              await new Promise((r) => setTimeout(r, 15));
            }
          }
          for (let i = 0; i < simC.length; i += 4) {
            const d = simC.slice(i, i + 4);
            fullC += d;
            sendEvent('content', { delta: d });
            await new Promise((r) => setTimeout(r, 14));
          }
          usage = { prompt_cache_hit_tokens: 256, prompt_cache_miss_tokens: 64, reasoning_tokens: 48 };
        }

        const dur = Date.now() - t0;
        const wantFollowUps = bodyObj.include_follow_ups !== false;
        let dynFollowUps = [];
        if (wantFollowUps) {
          if (apiKey) {
            const ep = resolveEndpoints(dbObj.settings.deepseek_base_url);
            dynFollowUps = await generateDynamicFollowUpsOnline({
              apiKey,
              baseUrl: ep.chatUrl,
              model: (dbObj.settings.deepseek_model || 'deepseek-chat').trim(),
              isPure,
              persona: p,
              nickname: dbObj.user.nickname,
              recentMsgs: [
                ...msgs.slice(-5),
                { role: 'assistant', content: fullC }
              ],
              nonce: dur + msgs.length
            });
          }
          if (!dynFollowUps || dynFollowUps.length === 0) {
            dynFollowUps = buildDynamicFollowUps({
              isPure,
              persona: p,
              nickname: dbObj.user.nickname,
              userText,
              assistantContent: fullC,
              nonce: dur + msgs.length,
              attachments: Array.isArray(bodyObj.attachments) ? bodyObj.attachments : []
            });
          }
        }
        const meta = {
          is_proactive: isProactive,
          usage,
          follow_ups: dynFollowUps
        };
        if (priorVersions.length > 0) {
          meta.versions = [...priorVersions, { reasoning: fullR, content: fullC, duration_ms: dur, usage }];
          meta.active_version = meta.versions.length - 1;
        }
        const msgId = Date.now();
        msgs.push({
          id: msgId,
          role: 'assistant',
          reasoning: fullR,
          content: fullC,
          meta_json: JSON.stringify(meta),
          duration_ms: dur,
          recalled_count: (dbObj.memories[sid] || []).length || 1,
          created_at: msgId
        });
        sess.updated_at = msgId;
        saveLocalDb(dbObj);

        let diaries = [];
        try {
          diaries = JSON.parse(sess.secret_diary || '[]');
        } catch {}

        sendEvent('done', {
          message_id: msgId,
          duration_ms: dur,
          recalled_count: (dbObj.memories[sid] || []).length || 1,
          memories: decorateMemories(dbObj.memories[sid] || []),
          nurturing: {
            affection: sess.affection || 26,
            trust: sess.trust || 28,
            intimacy: sess.intimacy || 22,
            current_mood: sess.current_mood || '✨ 温柔凝视',
            stage: computeStage(sess.affection || 26, sess.trust || 28, sess.intimacy || 22),
            secret_diary: diaries
          },
          meta,
          sessions: decorateSessions(dbObj),
          membership: dbObj.user.membership
        });
      });
    }

    if (pathname === '/api/asr/transcribe' && method === 'POST') {
      const audioDataUrl = String(bodyObj?.audio_data_url || '').trim();
      const sfKey =
        (dbObj.settings.own_api_base_url || '').toLowerCase().includes('siliconflow.cn')
          ? (dbObj.settings.deepseek_api_key || '').trim()
          : '';
      if (sfKey && audioDataUrl.startsWith('data:audio/')) {
        try {
          const commaIdx = audioDataUrl.indexOf(',');
          const headerPart = audioDataUrl.slice(0, commaIdx);
          const b64Part = audioDataUrl.slice(commaIdx + 1);
          const mimeMatch = headerPart.match(/^data:(audio\/[a-zA-Z0-9.+-]+)/);
          const mimeType = mimeMatch ? mimeMatch[1] : 'audio/webm';
          const ext = mimeType.includes('mp4') || mimeType.includes('aac')
            ? 'm4a'
            : mimeType.includes('wav')
            ? 'wav'
            : mimeType.includes('ogg')
            ? 'ogg'
            : 'webm';
          const binStr = atob(b64Part);
          const bytes = new Uint8Array(binStr.length);
          for (let i = 0; i < binStr.length; i++) bytes[i] = binStr.charCodeAt(i);
          const formData = new FormData();
          formData.append('file', new Blob([bytes], { type: mimeType }), `voice.${ext}`);
          formData.append('model', 'Qwen/Qwen3-ASR-1.7B');
          const sfRes = await originalFetch('https://api.siliconflow.cn/v1/audio/transcriptions', {
            method: 'POST',
            headers: { Authorization: `Bearer ${sfKey}` },
            body: formData,
            signal
          });
          if (sfRes.ok) {
            const sfData = await sfRes.json().catch(() => ({}));
            return jsonResponse({ ok: true, text: String(sfData.text || '').trim() });
          }
        } catch {}
      }
      if (audioDataUrl.startsWith('data:audio/')) {
        try {
          const tok = window.__starAuthStore?.getToken();
          const cloudResp = await originalFetch('https://star.claudexxb.online/api/asr/transcribe', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(tok ? { Authorization: `Bearer ${tok}` } : {})
            },
            body: JSON.stringify({ audio_data_url: audioDataUrl }),
            signal
          });
          if (cloudResp.ok) {
            const cj = await cloudResp.json().catch(() => ({}));
            if (cj && cj.ok && String(cj.text || '').trim()) {
              return jsonResponse({ ok: true, text: String(cj.text).trim() });
            }
          }
        } catch {}
      }
      return jsonResponse({ ok: false, fallback_web_speech: true, text: '' });
    }

    return jsonResponse({ ok: true });
  }

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

    if (pathname === '/api/app-version' || pathname === '/api/version') {
      const mergedHeaders = new Headers(init?.headers || {});
      if (standaloneActive) {
        const q = urlStr.includes('?') ? urlStr.slice(urlStr.indexOf('?')) : '';
        return originalFetch(`https://star.claudexxb.online${pathname}${q}`, {
          method: (init.method || 'GET').toUpperCase(),
          headers: mergedHeaders,
          cache: 'no-store',
          signal: init.signal
        });
      }
      return originalFetch(input, { ...init, headers: mergedHeaders, cache: 'no-store' });
    }

    if (standaloneActive && (pathname.startsWith('/api/auth/') || pathname === '/api/announcement')) {
      try {
        const remoteUrl = `https://star.claudexxb.online${pathname}${urlStr.includes('?') ? urlStr.slice(urlStr.indexOf('?')) : ''}`;
        const mergedHeaders = new Headers(init?.headers || {});
        const tok = window.__starAuthStore?.getToken();
        if (tok && !mergedHeaders.has('Authorization')) {
          mergedHeaders.set('Authorization', `Bearer ${tok}`);
        }
        const resp = await originalFetch(remoteUrl, {
          ...init,
          headers: mergedHeaders,
          cache: 'no-store'
        });
        if (resp.ok) {
          const clone = resp.clone();
          const data = await clone.json().catch(() => null);
          if (data && data.user) {
            const dbObj = loadLocalDb();
            dbObj.user = Object.assign(dbObj.user || {}, data.user);
            if (data.user.nickname) dbObj.user.nickname = data.user.nickname;
            saveLocalDb(dbObj);
            if (data.token) {
              window.__starAuthStore?.setToken(data.token, true);
            }
            if (window.AndroidAppBridge && typeof window.AndroidAppBridge.saveAuthCredentials === 'function') {
              window.AndroidAppBridge.saveAuthCredentials(data.token || tok || '', JSON.stringify(data.user));
            }
          }
          return resp;
        }
      } catch (e) {
        // 网络不可达时平滑回退至本地单机模式
      }
    }

    if (!standaloneActive) {
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

      // 首次请求 /api/auth/me 时自动探测当前是否部署在无后端的自定义域名静态托管环境（如返回 404/405 或静态 HTML）
      if (pathname === '/api/auth/me') {
        try {
          const resp = await originalFetch(input, nextInit);
          const ctype = resp.headers.get('content-type') || '';
          if (resp.status === 404 || resp.status === 405 || !ctype.includes('application/json')) {
            standaloneActive = true;
            window.__isStaticLiveDemo = true;
            return handleStandaloneApi(pathname, 'GET', {}, init.signal);
          }
          return resp;
        } catch {
          return originalFetch(input, nextInit);
        }
      }

      return originalFetch(input, nextInit);
    }

    let bodyObj = {};
    if (init && typeof init.body === 'string' && init.body.trim()) {
      try {
        bodyObj = JSON.parse(init.body);
      } catch {}
    }
    return handleStandaloneApi(pathname, (init.method || 'GET').toUpperCase(), bodyObj, init.signal, {
      rawBody: init?.body,
      headers: init?.headers
    });
  };
})();

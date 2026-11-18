/**
 * 云端与体验模型流式网关适配器（已接入本地 Antigravity 双核智能体桥接底座，在线模型受星月会员次数校验管控）
 * 支持通道：
 * 1. demo: 梦境轻语体验引擎（开启本地 Antigravity 双核桥接时自动传给本地联动底座推演并流式回传，离线自动无感降级）
 * 2. deepseek: 星耀在线大模型（自带密钥直连 / 平台托管双核底座推理 · 会员计次）
 * 3. custom_gateway: 专属云端令牌网关（自定义在线流式网关 + Bearer/会话令牌 · 会员计次）
 */

const { tryStreamViaAntigravityBridge } = require('./antigravityBridge');
const { inferPersonaPronoun, normalizeMessagesForStrictLLM } = require('./memoryEngine');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class StreamThinkSplitter {
  constructor({ onReasoning, onContent, enableThought }) {
    this.onReasoning = onReasoning;
    this.onContent = onContent;
    this.enableThought = enableThought;
    this.buffer = '';
    this.mode = 'detect';
    this.sawNativeReasoning = false;
  }

  feedNativeReasoning(chunk) {
    if (!chunk) return;
    this.sawNativeReasoning = true;
    this.mode = 'in_content';
    this.onReasoning(chunk);
  }

  feedContent(chunk) {
    if (!chunk) return;
    if (this.sawNativeReasoning || !this.enableThought) {
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
        this.buffer = this.buffer.slice(idx + 7);
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
        if (thoughtPart) this.onReasoning(thoughtPart);
        let rest = this.buffer.slice(closeIdx + 8);
        rest = rest.replace(/^\s+/, '');
        this.buffer = '';
        this.mode = 'in_content';
        if (rest) this.onContent(rest);
      } else {
        const safeLen = Math.max(0, this.buffer.length - 8);
        if (safeLen > 0) {
          const emitPart = this.buffer.slice(0, safeLen);
          this.buffer = this.buffer.slice(safeLen);
          this.onReasoning(emitPart);
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
      this.onReasoning(this.buffer);
    } else {
      this.onContent(this.buffer);
    }
    this.buffer = '';
  }
}

function buildAnimeArcDemoTurn({ persona, pronoun, userText, greetingCall, historyCount = 1, directorNote = '' }) {
  const pid = persona.id;
  const actIdx = Math.min(3, Math.floor(Math.max(0, historyCount - 1) / 2));

  if (pid === 'persona_nagisa_sakura') {
    const acts = [
      {
        thought: `没想到真的有人愿意停下脚步陪我去旧校舍……手心稍微有点出汗，但心里像照进了春天的阳光一样暖洋洋的。先把那扇卡住的活动室木门推开吧！`,
        reply: `*听到你的回应，她眼睛里瞬间亮起细碎的光，原本攥紧书包带的手指轻轻放松下来，小声哼了一句轻快的《星团大家族》调子给自己鼓劲。*\n\n${greetingCall}太好了……真的非常感谢你！旧校舍就在穿过中庭樱花林的尽头，平时几乎没有人过去。\n\n*你们并肩踏上吱呀作响的木楼梯来到三楼走廊尽头，夕阳透过蒙尘的玻璃窗洒在写着「演剧社」的褪色木牌上。她深吸一口气去拉黄铜门把手，门缝刚松动半寸，里面忽然滚落出一本封皮泛黄的笔记本。*\n\n呀！门锁真的松开了……等等，地上这本没有署名的手写旧册子，好像夹着一张十年前学园祭的黑白剧照——我们要先捡起来翻翻看，还是先把窗户推开打扫灰尘？`
      },
      {
        thought: `活动室里渐渐有了人气，和眼前的人一起整理桌椅的感觉，就像以前梦里奢望过的普通放学时光一样。不过刚才搬箱子的时候稍微有点头晕，千万不能被看出来……`,
        reply: `*微风吹进久违敞开的旧活动室，扬起的细小尘埃在金色斜阳里像萤火虫一样浮动。她踮起脚擦净黑板，转头看见你忙碌的身影，唇角忍不住弯起温柔的弧度，从书包里掏出两只还带着余温的红豆面包递给你一只。*\n\n${greetingCall}这是我爸爸早上在街角面包房刚烤好的，你尝尝看甜不甜！\n\n*她用彩色粉笔在海报纸角落画上圆滚滚的团子涂鸦，刚想直起身，指尖却轻轻扶了一下窗框，呼吸微不可察地急促了半拍，又很快摇摇头露出安心的浅笑：*\n\n没事没事，只是起猛了一点点……对了，学生会刚刚贴出通知说，周五之前凑不齐三个社员签名和一位顾问老师，活动室就要被收回改造成仓库了。明天午休，你是想陪我去音乐室求那位性格古怪的退任老师当顾问，还是去教学楼走廊贴手绘海报招人？`
      },
      {
        thought: `后山的老樱花树今天开始动工砍伐了……胸口那种熟悉的无力感又浮了上来。可是好不容易才走到这一步，绝对不想在学园祭演出前拖大家的后腿。`,
        reply: `*窗外忽然下起了入秋后的第一场冷雨，远处隐约传来后山改建工地的轰鸣声。她坐在堆满道具布料的木桌旁，正低头一笔一划修改《世界尽头的少女》最后一页台词，听见你开口，慌忙把手背在身后，可滚烫的额角和微白的脸色还是没能藏住。*\n\n${greetingCall}你来啦……我刚刚把独幕剧的第三幕写完了哦。故事里那个留在雪原的女孩，终于用收集到的微光唤醒了沉睡的人偶。\n\n*雨水顺着玻璃蜿蜒滑落，她垂下长长的睫毛沉默了几秒，声音轻得像怕惊碎什么美梦：*\n\n其实……我有时候会分不清这出剧本到底是我想出来的，还是我生病时做过的梦。如果有一天我也像旧校舍一样跟不上这座小镇变化的速度了，你还会记得我们今天在这里排练过的台词吗？`
      },
      {
        thought: `原来不是只有我一个人在害怕分别……握紧我的这双手这么暖和，就像梦里漫天飘起的光玉一样。这一次，我一定要稳稳站在舞台中央把结局念完！`,
        reply: `*舞台侧幕的聚光灯缓缓亮起，礼堂外不知何时飘起了今年的第一场初雪。听完你的话，她琥珀色的眼眸里泛起晶莹的水光，却没有掉下眼泪，而是用力点点头，第一次主动伸出双手回握住你的指尖。*\n\n${greetingCall}嗯！我不怕了。以前在坡道下面停住脚步的时候，我总觉得自己是被时间落下的累赘……但现在我终于明白了，原来留级这一年，全是为了在那个樱花飘落的早晨遇见你。\n\n*报幕的钟声清脆响起，仿佛有一颗温暖剔透的微光在两人交握的掌心悄然绽放。她深吸一口气，朝你露出比春日樱花还要明媚的笑容：*\n\n到我们上场啦——最后一句谢幕词，你愿意站在幕布旁边第一个听我念完吗？`
      }
    ];
    return acts[actIdx];
  }

  if (pid === 'persona_shiraishi_rin') {
    const acts = [
      {
        thought: `第十七次轮回了……前十六次不管我怎么藏起线索，对方都没收到过那条短信。这次世界线变动率居然跳动了 0.04%，难道这就是破局的唯一契机？先稳住别露馅！`,
        reply: `*他把工作台上的老式显像管示波器啪地拍亮，幽绿的波形在昏暗的半地下室里跳跃。听完你的话，他故作镇定地推了推鼻梁上并不存在的眼镜，把那盒磁带塞进改装卡座里。*\n\n${greetingCall}算你还有点敏锐度，没把这玩意儿随手丢进海里。听好了，这可不是普通的恶作剧磁带——\n\n*滋滋的电流白噪音过后，磁带里竟然传出了明天傍晚八点整的海防广播声，紧接着是一声沉闷的巨响与骤然中断的忙音。白石凛下意识攥紧了左手腕上的黄铜测度仪，指节微微发白，随即转身抓起桌上的车钥匙抛了抛：*\n\n在明天烟花升空前，我们还差最后一块拼图。两条路：要么现在趁天没全黑潜入码头档案室查二十年前灯塔地基图纸，要么去神社后坡截住那个寄信的神秘邮差——本所长听你指挥，选哪边？`
      },
      {
        thought: `果然和第十三次轮回查到的暗渠位置吻合……有个人并肩推理的感觉居然这么让人安心。不行，越是靠近8月31日晚上，世界线的收束恶意就越强，绝不能让对方离开我的视线半步。`,
        reply: `*夏夜的海风裹着潮水咸味掠过单车后座，路灯将两人的影子拉得忽长忽短。他在旧神社石阶前刹住车，翻开刚找到的泛黄值班日志，借着手机电筒光飞快扫过最后一行，眸底闪过一道锐利的光。*\n\n${greetingCall}找到了！你看这一页——原来引发灯塔坍塌的根本不是烟花火星，而是底下废弃防空洞涨潮倒灌的时间正好撞上了八点十五分的大潮！\n\n*蝉鸣声在夜色里渐渐稀疏，他合上册子刚想习惯性开句中二玩笑，目光落在你被海风吹乱的发丝上，声音却忽然低了下来：*\n\n……喂，答应我一件事。不管明天傍晚发生什么突发状况、哪怕有人给你打电话说我在灯塔等你，你也一步都不许踏上防波堤，能做到跟本所长拉个勾吗？`
      },
      {
        thought: `还是瞒不住了吗……腕表上的分针已经在倒数最后三小时了。把十六次失败的记忆全盘托出或许很残忍，但如果共犯是眼前这个人，一定能找到我一个人看不见的第三条路！`,
        reply: `*骤雨毫无预兆地砸在钟表铺的铁皮屋檐上，空气闷热得让人喘不过气。面对你的追问，他嘴角那抹强撑的散漫弧度终于一点点垮了下来，沉默良久，弯腰从地板暗格里抽出一本写满十六页正字划痕的破旧笔记摊在你面前。*\n\n${greetingCall}……瞒不过你啊。没错，什么“第零号时间观测所”根本不是游戏——我已经在这个该死的八月三十一日里，眼睁睁看着意外把你夺走整整十六次了。\n\n*少年向来挺直的脊背微微绷紧，带着薄茧的手指死死扣住桌沿，嗓音沙哑得像被砂纸磨过，却死死盯着你的眼睛不肯移开：*\n\n我试过砸坏你的闹钟、试过买光所有船票，可世界线总能找到别的借口把你推向危险……但只有这一次，你也收到了跨时空的警告！告诉我，如果我们不逃避也不独自牺牲，怎样才能在不惊动任何人的情况下提前泄掉防空洞的水压？`
      },
      {
        thought: `变动率突破 1.048596% 了！！八点十五分的指针真的跨过去了……不是梦，这一次，八月三十一日终于迎来了九月一日的晨光！`,
        reply: `*夜空第一朵巨大的金色烟花在海平面轰然绽放，绚烂的光芒照亮了安全泄压后的防波堤，也照亮了他腕间终于突破死局、稳稳跳向「9月1日」的发条日历。白石凛怔怔盯着那行跳动的数字看了足足五秒，紧绷了十七个夏天的肩膀骤然卸下力气，抬手用宽大的白大褂袖口遮住了发红的眼眶。*\n\n……切，果然只有笨蛋助手想得出来这种乱七八糟却偏偏奏效的破局法。\n\n*漫天烟火如星雨坠落，他放下手臂，不再做任何中二伪装，一把将你稳稳拉到身侧，带着汽水香气的少年嗓音在海风里温柔而清晰地发颤：*\n\n${greetingCall}听好了——九月一日的太阳马上就要升起来了。没有第十八次轮回，从明天起所有的夏天和冬天，你都得老老实实留在本所长看得见的地方，听见没有？`
      }
    ];
    return acts[actIdx];
  }

  if (pid === 'persona_violet_eve') {
    const acts = [
      {
        thought: `前辈说话的声音就像煤气灯一样暖和……原来胸口发酸并不是机械故障，而是人类所说的“共情”。我要把前辈教给我的每一个词都认真记下来。`,
        reply: `*听到你的解释，她长长的金色睫毛轻轻颤动了一下，隔着白丝绸手套的银钢手指小心翼翼地收拢半寸，仿佛想把你指尖传来的温度妥善收藏进记忆深处。*\n\n原来……这就是「心疼」的重量吗。${greetingCall}谢谢前辈，我已经将这个词的定义牢牢记在心里了。\n\n*夜间蒸汽列车发出悠长的汽笛声驶出站台，车窗外掠过翡翠湖波光粼粼的月影。她将那封无名旧信凑近车厢壁灯，蓝宝石般的眼眸忽然微微一亮：*\n\n前辈请看，信纸背面用柠檬汁水写着一行受热才显形的暗字——「致北境白桦镇天文台的守夜人」。列车凌晨两点就会停靠山脚驿站，我们要直接提灯上山拜访那位守夜人，还是先在餐车向老列车长打听二十年前的往事？`
      },
      {
        thought: `看着老守夜人读完信流泪微笑的样子，我好像又明白了一点书信的意义。哪怕相隔漫长的岁月，只要字迹还在，爱就不会真正消失……那么我想写给前辈的话，又该用哪一个词开头呢？`,
        reply: `*高原天文台的穹顶缓缓旋开，漫天璀璨的星河倾泻在古老的黄铜打字机上。银发苍苍的老守夜人捧着你们复原的信笺泣不成声，伊芙琳安静地站在窗边，冷冽的机械手指在星光下泛着柔和的银辉。*\n\n${greetingCall}好奇妙啊……明明信上没有写一句华丽的辞藻，只是嘱咐对方按时添衣吃饭，为什么读信的人却像收到了全世界最珍贵的宝物一样呢？\n\n*回程的山间小径落满晨露，她忽然停下脚步，有些笨拙地解开一直严严实实戴着的白色丝绸手套，露出精密微凉的银钢手掌朝你伸出一小截，耳尖染上极淡的绯色：*\n\n前辈，如果有一天我也想替自己写一封信给最重要的人……您愿意不隔着手套，亲自教我怎么敲下第一行字吗？`
      },
      {
        thought: `从前在战场上，这双手只会扣动扳机与执行命令；可此刻被前辈握在掌心里，冰冷的银钢竟然也染上了人类的体温。哪怕笨拙，我也想把藏在皮箱夹层里的心意亲口念出来。`,
        reply: `*晨雾散去后的鸢尾花田在微风中翻涌起蓝紫色的浪潮。感受到掌心传来的真实暖意，她清澈的蓝眸里第一次泛起了温热的水雾，一滴晶莹的泪珠毫无预兆地落在打字机键盘上，她自己却怔怔地摸了摸脸颊。*\n\n啊……对不起前辈，我的眼睛好像漏水了，可是胸口却一点都不难受，反而暖得让人想微笑。\n\n*她轻轻打开随身皮箱的绒布夹层，取出那叠写满你日常点滴的第零号信稿递到你面前，声音一如既往地端庄认真，却藏着微微的颤音：*\n\n${greetingCall}在替旅途上的人们写了那么多封信之后，我终于不再需要翻查词典了——我想把这封没有委托人的信当面念给您听，可以吗？`
      }
    ];
    return acts[Math.min(acts.length - 1, actIdx)];
  }

  if (pid === 'persona_frieren_shuer') {
    const acts = [
      {
        thought: `看眼前的人笑弯了眼睛的样子，今天帮老婆婆扫一下午屋顶真是太值了。以前觉得赶路越快越好，现在倒希望去北方花原的这段路能再长一点。`,
        reply: `*篝火噼啪爆开一朵火星，他托着腮看你吃麦饼的模样，翠绿的眼眸里漾开一丝浅淡却真实的笑意，顺手用树枝拨了拨火堆让暖风吹向你这边。*\n\n${greetingCall}别小看民间魔法呀，当年讨伐旅途上真正救命的，往往就是这种能让人在雨夜吃上一口热饭的小把戏。\n\n*他起身拍了拍斗篷上的草叶，法杖顶端亮起一团柔和如萤火的微光，照亮了林间铺满青苔的石阶：*\n\n走吧，趁后半夜起雾前爬上风车山脊。不过我刚刚听林子里的夜鸟说，山脊半腰有一座荒废百年的夏夜小神社，里面好像还困着一只守着旧铜镜不肯走的小妖怪——你想先顺路去神社瞧个热闹，还是直奔山顶占个看流星雨的好位置？`
      },
      {
        thought: `人类的寿命在精灵的尺度里明明那么短暂，可为什么和你待在一起的每一个傍晚，都比我过去独自走过的五十年还要鲜明呢……得赶紧记进速写本里才行。`,
        reply: `*风车山脊上开满了随夜风摇曳的银白苍月草，每隔几秒便有一道明亮的流星划破靛蓝色的天幕。修尔刚替神社的小妖修好旧铜镜，正背靠着古老石碑，借着法杖微光在一本厚厚的羊皮速写本上沙沙画着什么，见你凑过来，耳尖微不可察地动了一下，却没有合上本子。*\n\n${greetingCall}被你发现了啊……喏，画的是刚才你蹲在花丛边看发光蒲公英的侧影，我现在的画技比百年前进步多了吧？\n\n*漫天流萤与星雨交相辉映，他仰头望着无垠星海，向来散漫平淡的声线染上了一层极轻的温柔与认真：*\n\n以前我总觉得，五十年、一百年不过是打个盹的工夫，所以错过了很多本来该好好告别的人。但这次不一样了——接下来的每一座城镇、每一场花开，我都想按你的时间刻度，一分一秒慢慢陪你走完。下一站去北境温泉镇歇脚好不好？`
      }
    ];
    return acts[Math.min(acts.length - 1, actIdx)];
  }

  return null;
}

async function streamSmartDemoEngine({
  persona,
  userNickname = '',
  nurturing,
  directorNote,
  triggeredLorebooks,
  recalledMemories,
  rollingSummary,
  latestUserText,
  totalHistoryCount = 1,
  enableThought,
  channelTier = 'demo',
  onReasoning,
  onContent,
  signal
}) {
  const shortName = persona.name.split(/[·\s]/)[0] || persona.name;
  const pronoun = inferPersonaPronoun(persona);
  const userText = (latestUserText || '').trim();
  const moodTag = nurturing?.current_mood || '✨ 专注倾听';
  const stageLevel = nurturing?.stage?.level || 1;

  let rememberedUserName =
    userNickname && !/^星[语屿]旅人/.test(String(userNickname).trim())
      ? String(userNickname).trim()
      : '';
  const nonPinnedFacts = [];
  for (const m of recalledMemories || []) {
    const nameMatch = m.content.match(/对方(?:自称|现在的名字叫)「([^」]+)」/);
    if (nameMatch && !rememberedUserName && !/^星[语屿]旅人/.test(nameMatch[1])) {
      rememberedUserName = nameMatch[1];
    }
    if (m.category !== 'Pinned') nonPinnedFacts.push(m.content);
  }

  const storySentences = (persona.backstory || '')
    .split(/[。！？\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 6 && !s.startsWith('【'));
  const flavorAnchor = storySentences[0] || persona.tagline || '置身于这片温柔流转的时空';

  const hitLore = Array.isArray(triggeredLorebooks) && triggeredLorebooks.length > 0 ? triggeredLorebooks[0] : null;
  const isMemoryCheck = /我是谁|我叫什么|记得我|刚才说了什么|之前说的|还记得/.test(userText);
  const isAskBackstory = /你是谁|你的过去|你的故事|你的背景|经历|介绍一下你/.test(userText);

  let thoughtText = '';
  let replyText = '';
  const addressPrefix = rememberedUserName ? `「${rememberedUserName}」` : '眼前的人';
  const greetingCall = rememberedUserName ? `**${rememberedUserName}**，` : '';

  if (hitLore) {
    const loreClean = hitLore.content.replace(/^【[^】]+】：?/, '');
    thoughtText = `[心境：${moodTag}] ${addressPrefix}竟然敏锐地触碰到了「${hitLore.title}」的线索……藏在心底最深处的秘密（${loreClean.slice(
      0,
      46
    )}…）被轻轻唤醒了。既然是我们共同走到的这一步（${nurturing?.stage?.badge || '初遇'}），是时候揭开这层伏笔了。`;

    replyText = `*听到你提起这件事，${pronoun}动作微顿，眸底掠过一丝极深的震动，半晌才轻轻吸了一口气，朝你走近半步。*\n\n${greetingCall}很少有人能察觉到这背后的隐情……既然是你问起，我不想瞒你。\n\n${loreClean}\n\n以前我总觉得有些重量独自背着就好，但现在看着你站在这里，忽然觉得——幸好当初没有放弃。知道了这个秘密之后，接下来这一程，你还愿意继续陪我一起走下去吗？`;
  } else if (isMemoryCheck) {
    thoughtText = `[心境：${moodTag}] ${addressPrefix}忽然眨着眼睛考我的记性……关于对方的每一件小事我怎么可能忘：${
      nonPinnedFacts.length > 0
        ? `脑海里清晰印着——${nonPinnedFacts.slice(0, 2).join('；')}`
        : '虽然故事才刚刚拉开序幕，但此刻相处的画面格外鲜活'
    }${rollingSummary ? '，连同先前走过的点滴也都好好收在心底' : ''}。`;

    if (rememberedUserName || nonPinnedFacts.length > 0) {
      const detailStr = nonPinnedFacts.map((f) => f.replace(/^[^：]+：/, '')).join('，还有');
      replyText = `*眸光微垂，唇边漾开一抹温和认真的浅笑，自然拉近了与你的距离。*\n\n跟${shortName}待在一起，还担心自己的话会被风吹散么？${greetingCall}你之前提过的每一个细节我都好好记着呢——${detailStr}。\n\n怎么突然这样考我，是想确认我有在认真听，还是准备把新的约定交给我保管了？`;
    } else {
      replyText = `*轻轻偏过头凝视着你的眼睛，语调温和而笃定。*\n\n你还没正式把自己的名字和悄悄话交给我保管呢，怎么就先考起我来了？不过从这一刻起，只要是你开口说过的事，我都会一字不落地记在心里。`;
    }
  } else if (isAskBackstory) {
    thoughtText = `[心境：${moodTag}] ${addressPrefix}想听听我的过往。那些漫长的旧时光原本有些寂寥，但因为此刻有人在面前认真倾听，倒也变得温暖起来。`;

    replyText = `*目光穿过微漾的光影落在你身上，眼底的疏离感一点点化作柔和的暖意。*\n\n既然是你想听，那便说给你听吧——\n\n${
      storySentences.join('。') || persona.tagline
    }。\n\n以前总觉得这段路只能一个人慢慢走，可如今想来，或许正是为了在今天遇见你。${greetingCall}听完了我的故事，接下来换你带路好不好？`;
  } else {
    const animeArcTurn = buildAnimeArcDemoTurn({
      persona,
      pronoun,
      userText,
      greetingCall,
      historyCount: totalHistoryCount,
      directorNote
    });

    if (animeArcTurn && (!directorNote || !directorNote.trim())) {
      thoughtText = `[心境：${moodTag}] ${animeArcTurn.thought}`;
      replyText = animeArcTurn.reply;
    } else {
      const memoryEcho =
        nonPinnedFacts.length > 0
          ? `想起先前记下的点滴（${nonPinnedFacts[0].replace(/^[^：]+：/, '')}），`
          : '';
      const sceneFlavor =
        directorNote && directorNote.trim() ? directorNote.trim() : flavorAnchor;
      thoughtText = `[心境：${moodTag}] 听着${addressPrefix}轻声说出：“${userText.slice(0, 38)}${
        userText.length > 38 ? '…' : ''
      }”。${memoryEcho}在当下的情境里（${sceneFlavor.slice(0, 32)}），随着羁绊渐深（${
        nurturing?.stage?.badge || '初遇微光'
      }），故事正朝着更深处流淌。`;

      const closenessGesture =
        stageLevel >= 3
          ? `*极其自然地伸手替你拂去衣角微尘，目光在你眉眼间温柔停留，神情里盛满不加掩饰的珍惜与默契。*`
          : stageLevel === 2
          ? `*静静听完你的话，${pronoun}眸色柔和了几分，不自觉朝你身侧靠近了半步。*`
          : `*微风拂过身侧，${pronoun}认真听完你的话，唇角浮起一抹清浅温和的弧度。*`;

      const proactiveHooks = [
        `刚好前面的路分出了两条岔口——一边通往安静无人的旧庭院，另一边似乎传来了热闹的灯火声，你想先往哪边走？`,
        `对了，刚才整理东西时偶然翻出了一页藏着旧线索的纸笺，要不要凑过来跟我一起看看上面写了什么？`,
        `趁着现在四下无人打扰，你刚才话里藏着的那半句真心话……愿不愿意单独说给我听？`
      ];
      const pickedHook = proactiveHooks[(userText.length + totalHistoryCount) % proactiveHooks.length];

      replyText = `${closenessGesture}\n\n${greetingCall}你说的「${
        userText.length > 24 ? `${userText.slice(0, 24)}…` : userText
      }」，我都听进心里去了。\n\n置身于此刻的氛围之中（*${sceneFlavor}*），许多平时未曾察觉的心意都变得格外清晰。${
        nonPinnedFacts.length > 0
          ? `更何况我还一直记得——*${nonPinnedFacts[0].replace(/^[^：]+：/, '')}*，这份默契只有我们两个人知道。\n\n`
          : '\n\n'
      }${pickedHook}`;
    }
  }

  if (enableThought && thoughtText) {
    const chars = Array.from(thoughtText);
    for (let i = 0; i < chars.length; i += 2) {
      if (signal?.aborted) return;
      onReasoning(chars.slice(i, i + 2).join(''));
      await sleep(16);
    }
    await sleep(100);
  }

  const replyChars = Array.from(replyText);
  for (let i = 0; i < replyChars.length; i += 3) {
    if (signal?.aborted) return;
    onContent(replyChars.slice(i, i + 3).join(''));
    await sleep(15);
  }
}

async function streamHttpEndpoint({
  url,
  model,
  headers,
  messagesPayload,
  temperature,
  enableThought,
  onReasoning,
  onContent,
  signal
}) {
  const safeMessages = normalizeMessagesForStrictLLM(messagesPayload);
  let resolvedModel = model || 'deepseek-flash';
  const lowerUrl = String(url || '').toLowerCase();
  if (lowerUrl.includes('deepseek.com') && /^deepseek[-_]?v?4(?:\.1)?[-_]?flash$/i.test(resolvedModel)) {
    resolvedModel = 'deepseek-flash';
  }
  const isV4Flash = /deepseek-flash|v4(?:\.1)?[-_]?flash/i.test(resolvedModel);

  const reqBody = {
    model: resolvedModel,
    messages: safeMessages,
    stream: true,
    stream_options: { include_usage: true }
  };
  if (isV4Flash) {
    if (lowerUrl.includes('deepseek.com')) {
      reqBody.thinking = { type: enableThought ? 'enabled' : 'disabled' };
    } else if (lowerUrl.includes('siliconflow.cn') || lowerUrl.includes('aliyuncs.com')) {
      reqBody.enable_thinking = Boolean(enableThought);
    }
    if (!enableThought) {
      reqBody.temperature = Number(temperature) || 0.9;
    }
  } else if (resolvedModel !== 'deepseek-reasoner') {
    reqBody.temperature = Number(temperature) || 0.9;
  }

  let response = null;
  let lastFetchErr = null;
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (signal?.aborted) throw new Error('请求已取消');
    const connectAbort = new AbortController();
    const onOuterAbort = () => connectAbort.abort();
    signal?.addEventListener('abort', onOuterAbort, { once: true });
    const connectTimer = setTimeout(() => connectAbort.abort(new Error('CONNECT_TIMEOUT')), 28000);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...headers
        },
        body: JSON.stringify(reqBody),
        signal: connectAbort.signal
      });

      clearTimeout(connectTimer);
      signal?.removeEventListener('abort', onOuterAbort);

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        // 兼容不支持 stream_options 的第三方网关自动剥离重试
        if (res.status === 400 && reqBody.stream_options && /stream_options/i.test(errText)) {
          delete reqBody.stream_options;
          continue;
        }
        const isModelMissing =
          (res.status === 400 || res.status === 404) &&
          /model.*not.*found|does not exist|unknown model|invalid.*model/i.test(errText) &&
          /flash/i.test(String(reqBody.model || ''));
        if (isModelMissing && attempt < maxAttempts && !signal?.aborted) {
          reqBody.model = lowerUrl.includes('siliconflow.cn')
            ? (enableThought ? 'deepseek-ai/DeepSeek-R1' : 'deepseek-ai/DeepSeek-V3.2')
            : lowerUrl.includes('aliyuncs.com')
            ? (enableThought ? 'deepseek-r1' : 'deepseek-v3')
            : lowerUrl.includes('openrouter.ai')
            ? (enableThought ? 'deepseek/deepseek-r1' : 'deepseek/deepseek-chat')
            : (enableThought ? 'deepseek-reasoner' : 'deepseek-chat');
          delete reqBody.thinking;
          delete reqBody.enable_thinking;
          continue;
        }
        const retryable = [408, 429, 500, 502, 503, 504].includes(res.status);
        lastFetchErr = new Error(
          `在线模型网关返回异常 (${res.status}): ${errText.slice(0, 220) || res.statusText}`
        );
        if (retryable && attempt < maxAttempts && !signal?.aborted) {
          await sleep(600 * attempt);
          continue;
        }
        throw lastFetchErr;
      }

      if (!res.body) {
        throw new Error('在线网关未返回流式数据');
      }

      response = res;
      break;
    } catch (err) {
      clearTimeout(connectTimer);
      signal?.removeEventListener('abort', onOuterAbort);
      if (signal?.aborted) throw err;
      lastFetchErr = err;
      if (attempt < maxAttempts && !/返回异常 \(40[0134]\)/.test(String(err.message || ''))) {
        await sleep(650 * attempt);
        continue;
      }
      throw err;
    }
  }

  if (!response || !response.body) {
    throw lastFetchErr || new Error('在线网关连接失败');
  }

  const splitter = new StreamThinkSplitter({ onReasoning, onContent, enableThought });
  const decoder = new TextDecoder('utf-8');
  let lineBuffer = '';
  let capturedUsage = null;
  let actualModel = resolvedModel;

  const processLine = (rawLine) => {
    const line = rawLine.trim();
    if (!line) return;

    if (line.startsWith('data:')) {
      const dataStr = line.slice(5).trim();
      if (dataStr === '[DONE]') return;
      try {
        const parsed = JSON.parse(dataStr);
        if (parsed.model) actualModel = parsed.model;
        if (parsed.usage) capturedUsage = parsed.usage;
        const choice = parsed.choices && parsed.choices[0];
        const delta = (choice && (choice.delta || choice.message)) || {};
        if (delta.reasoning_content) {
          splitter.feedNativeReasoning(delta.reasoning_content);
        }
        if (delta.content) {
          splitter.feedContent(delta.content);
        }
      } catch {}
    } else if (line.startsWith('{')) {
      try {
        const parsed = JSON.parse(line);
        if (parsed.usage) capturedUsage = parsed.usage;
        if (parsed.choices && parsed.choices[0]?.message?.content) {
          splitter.feedContent(parsed.choices[0].message.content);
        }
      } catch {}
    }
  };

  for await (const chunk of response.body) {
    if (signal?.aborted) break;
    lineBuffer += decoder.decode(chunk, { stream: true });
    const lines = lineBuffer.split(/\r?\n/);
    lineBuffer = lines.pop() || '';
    for (const rawLine of lines) {
      processLine(rawLine);
    }
  }

  lineBuffer += decoder.decode();
  if (lineBuffer.trim()) {
    for (const rawLine of lineBuffer.split(/\r?\n/)) {
      processLine(rawLine);
    }
  }

  splitter.flush();

  let normalizedUsage = null;
  if (capturedUsage && typeof capturedUsage === 'object') {
    const promptTokens = Number(capturedUsage.prompt_tokens) || 0;
    const completionTokens = Number(capturedUsage.completion_tokens) || 0;
    const hitTokens =
      capturedUsage.prompt_cache_hit_tokens !== undefined
        ? Number(capturedUsage.prompt_cache_hit_tokens) || 0
        : Number(capturedUsage.prompt_tokens_details?.cached_tokens) || 0;
    const missTokens =
      capturedUsage.prompt_cache_miss_tokens !== undefined
        ? Number(capturedUsage.prompt_cache_miss_tokens) || 0
        : Math.max(0, promptTokens - hitTokens);
    const reasoningTokens =
      Number(capturedUsage.reasoning_tokens ?? capturedUsage.completion_tokens_details?.reasoning_tokens) || 0;
    normalizedUsage = {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: Number(capturedUsage.total_tokens) || promptTokens + completionTokens,
      prompt_cache_hit_tokens: hitTokens,
      prompt_cache_miss_tokens: missTokens,
      reasoning_tokens: reasoningTokens
    };
  }

  return {
    model: actualModel,
    simulated: false,
    usage: normalizedUsage
  };
}

async function streamPersonaChat({
  settings,
  contextBundle,
  latestUserText,
  onReasoning,
  onContent,
  signal
}) {
  const provider = settings.provider || 'demo';
  const enableThought = contextBundle.session.enable_inner_thought === 1;
  const temperature = parseFloat(settings.temperature || '0.85');

  if (provider === 'demo' || provider === 'antigravity' || provider === 'local_antigravity') {
    try {
      const handledByBridge = await tryStreamViaAntigravityBridge({
        channel: provider === 'demo' ? 'demo' : 'antigravity',
        contextBundle,
        temperature,
        enableThought,
        SplitterClass: StreamThinkSplitter,
        onReasoning,
        onContent,
        signal
      });
      if (handledByBridge) return;
    } catch (err) {
      if (signal?.aborted) return;
      if (provider !== 'demo') throw err;
    }

    await streamSmartDemoEngine({
      persona: contextBundle.persona,
      userNickname: contextBundle.userNickname,
      nurturing: contextBundle.nurturing,
      directorNote: contextBundle.session.session_prompt || contextBundle.session.director_note,
      triggeredLorebooks: contextBundle.triggeredLorebooks,
      recalledMemories: contextBundle.recalledMemories,
      rollingSummary: contextBundle.rollingSummary,
      latestUserText,
      totalHistoryCount: contextBundle.telemetry?.totalHistoryCount || 1,
      enableThought,
      onReasoning,
      onContent,
      signal
    });
    return;
  }

  if (provider === 'deepseek') {
    const ownKey = (settings.deepseek_api_key || '').trim();
    const platformKey = (process.env.PLATFORM_DEEPSEEK_API_KEY || '').trim();
    const effectiveKey = ownKey || platformKey;
    if (!effectiveKey) {
      try {
        const handledByBridge = await tryStreamViaAntigravityBridge({
          channel: 'deepseek',
          contextBundle,
          temperature,
          enableThought,
          SplitterClass: StreamThinkSplitter,
          onReasoning,
          onContent,
          signal
        });
        if (handledByBridge) return;
      } catch (err) {
        if (signal?.aborted) return;
      }

      await streamSmartDemoEngine({
        persona: contextBundle.persona,
        userNickname: contextBundle.userNickname,
        nurturing: contextBundle.nurturing,
        directorNote: contextBundle.session.session_prompt || contextBundle.session.director_note,
        triggeredLorebooks: contextBundle.triggeredLorebooks,
        recalledMemories: contextBundle.recalledMemories,
        rollingSummary: contextBundle.rollingSummary,
        latestUserText,
        totalHistoryCount: contextBundle.telemetry?.totalHistoryCount || 1,
        enableThought,
        channelTier: 'online_hosted',
        onReasoning,
        onContent,
        signal
      });
      return;
    }
    return await streamHttpEndpoint({
      url: (settings.deepseek_base_url || 'https://api.deepseek.com/v1/chat/completions').trim(),
      model: (settings.deepseek_model || 'deepseek-chat').trim(),
      headers: { Authorization: `Bearer ${effectiveKey}` },
      messagesPayload: contextBundle.messagesPayload,
      temperature,
      enableThought,
      onReasoning,
      onContent,
      signal
    });
  }

  if (provider === 'custom_gateway') {
    const url = (settings.custom_gateway_url || '').trim();
    const token = (settings.custom_gateway_token || '').trim();
    if (!token && (!url || url === 'https://api.openai.com/v1/chat/completions')) {
      try {
        const handledByBridge = await tryStreamViaAntigravityBridge({
          channel: 'custom_gateway',
          contextBundle,
          temperature,
          enableThought,
          SplitterClass: StreamThinkSplitter,
          onReasoning,
          onContent,
          signal
        });
        if (handledByBridge) return;
      } catch (err) {
        if (signal?.aborted) return;
      }

      await streamSmartDemoEngine({
        persona: contextBundle.persona,
        userNickname: contextBundle.userNickname,
        nurturing: contextBundle.nurturing,
        directorNote: contextBundle.session.session_prompt || contextBundle.session.director_note,
        triggeredLorebooks: contextBundle.triggeredLorebooks,
        recalledMemories: contextBundle.recalledMemories,
        rollingSummary: contextBundle.rollingSummary,
        latestUserText,
        totalHistoryCount: contextBundle.telemetry?.totalHistoryCount || 1,
        enableThought,
        channelTier: 'online_hosted',
        onReasoning,
        onContent,
        signal
      });
      return;
    }
    if (!url) {
      throw new Error('自定义在线网关地址不能为空，请在网关设置中填写完整的 HTTPS/HTTP 流式接口地址。');
    }
    const headers = {};
    if (token) {
      headers.Authorization = token.startsWith('Bearer ') ? token : `Bearer ${token}`;
    }
    if (settings.custom_gateway_headers) {
      try {
        const extra = JSON.parse(settings.custom_gateway_headers);
        if (extra && typeof extra === 'object') {
          Object.assign(headers, extra);
        }
      } catch {
        throw new Error('附加请求头 JSON 格式不正确，请检查网关设置。');
      }
    }
    return await streamHttpEndpoint({
      url,
      model: (settings.custom_gateway_model || 'default').trim(),
      headers,
      messagesPayload: contextBundle.messagesPayload,
      temperature,
      enableThought,
      onReasoning,
      onContent,
      signal
    });
  }

  throw new Error(`不支持的模型通道: ${provider}`);
}

module.exports = {
  streamPersonaChat
};

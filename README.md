<div align="center">

<a href="https://star.claudexxb.online/">
  <img src="./public/assets/apk-icon-preview.png" alt="星语恋庭 Persona Chat Studio" width="88" height="88" />
</a>

# Persona Chat Studio · 星语恋庭

**「定制专属人设背景故事 · 镌刻不会遗忘的双向心动记忆」**

集 **🐋 仿 DeepSeek 原生生产力工作台** · **🌸 高阶沉浸式角色扮演剧场** · **📱 Android 随身版与 Phone Agent 手机辅助代理** 于一体的零依赖全栈平台。<br/>
内置 **三通道独立隔离连接中心** · **艾宾浩斯三层记忆引擎** · **五大独立世界观剧本** · **AI 编剧拆解工坊** · **玩家共创广场** · **皮肤与头像捏脸工坊** · **十档声优语音**。

<p>
  <a href="https://star.claudexxb.online/">
    <img src="https://img.shields.io/badge/🌐_访问官方在线站-star.claudexxb.online-DB2777?style=for-the-badge" alt="访问官方在线站" />
  </a>
  &nbsp;
  <a href="https://github.com/qts2218346424-cyber/persona-chat-studio/releases/latest">
    <img src="https://img.shields.io/badge/📱_安卓随身版-下载_APK-4D6BFE?style=for-the-badge&logo=android&logoColor=white" alt="下载 Android APK" />
  </a>
</p>

<p>
  <img src="https://img.shields.io/badge/Release-v2.5.2_Build_149-7C3AED?style=flat-square&logo=rocket&logoColor=white" alt="Version v2.5.2" />
  <img src="https://img.shields.io/badge/Node.js-%3E%3D22.5.0-339933?style=flat-square&logo=node.js&logoColor=white" alt="Node.js >= 22.5.0" />
  <img src="https://img.shields.io/badge/Dependencies-0_npm_Packages-FF6B6B?style=flat-square&logo=npm&logoColor=white" alt="Zero npm Dependencies" />
  <img src="https://img.shields.io/badge/Storage-node%3Asqlite-003B57?style=flat-square&logo=sqlite&logoColor=white" alt="Native SQLite" />
  <img src="https://img.shields.io/badge/Assets-Gzip_%2B_Brotli-0EA5E9?style=flat-square" alt="Precompressed" />
</p>

<p>
  <a href="#-v252-最新版本核心特性">🚀 最新特性</a> •
  <a href="#-三大工作台">🌐 三大工作台</a> •
  <a href="#-外观皮肤与头像工坊">🎨 外观工坊</a> •
  <a href="#-五大内置剧本与-20-位角色">🎬 剧本角色</a> •
  <a href="#-连接中心与声优语音">🔌 连接与语音</a> •
  <a href="#-核心架构与记忆引擎">🧠 架构记忆</a> •
  <a href="#-部署与构建">🛠️ 部署</a>
</p>

<a href="https://star.claudexxb.online/" title="点击直达星语恋庭官方在线站">
  <img src="./public/assets/screenshots/06-deepseek-native.png" alt="星语恋庭：仿 DeepSeek 原生工作台" width="100%" />
</a>

</div>

---

## 🚀 v2.5.2 最新版本核心特性

1. **全屏自由漫步 & 头顶对话气泡（实时天气吐槽 + 暖心鼓励）**：大肥鱼不再被吸死在屏幕边缘，可在手机安全工作区内自由转向小碎步散步；头顶新增圆润气泡框，通过 `/api/weather/summary` 感知当地温度阴晴雨雪进行俏皮天气吐槽，并时不时弹出温柔安慰与加油打气话语（可一键切换漫步开关）。
2. **QQ 音乐点歌精准锁定「单曲」列表播放**：搜索结果页自动跳过顶部歌手卡与歌单推荐卡，锁定下方「单曲」分段第一首歌或主动切入「歌曲」Tab 起播，兜底点位精确下移。
3. **鲸鱼娘真实声音歌唱引擎 & 多选音频导入（彻底告别电子哼调）**：内置真人甜美中文少女唱词示例曲，并支持在悬浮面板「📥导歌」或 App「肥鱼歌单」里批量导入手机本地 `.mp3/.m4a/.wav/.ogg/.flac` 实际歌声音频。
4. **悬浮窗外置肥鱼互动条 & 不抢焦点悬浮快捷打字条**：点外面即看大肥鱼立绘动画，支持剪贴板/文件批量导入常用聊天文字并双端同步，升级至 `v2.5.2 (Build 149)`。
5. **三通道独立隔离连接中心与极速预压缩管线**：本地直连 / DeepSeek 官方 API / 自定义云端 API 独立切换，`scripts/build-static-assets.mjs` 全面提供 `.gz` 与 `.br` 极速加载。

---

## 🌐 三大工作台

同一账号下，在左侧栏顶部一键切换：

| 工作台 | 核心能力 |
| :--- | :--- |
| **🐋 DeepSeek 原生助手模式** | 1:1 复刻 `chat.deepseek.com`：深度思考链折叠、联网搜索与 `[1]` 引用角标、URL 自动阅读、图片与多文档解析、右侧 HTML Artifacts 实时预览、`< 1/2 >` 多版本切换、LaTeX 公式、明暗主题与长图分享。 |
| **🌸 星语恋庭沉浸剧场模式** | 「💭 心声独白」潜台词流式推演、星号动作分镜、每轮 3 条剧情推进胶囊；五大剧本、AI 编剧工坊、共创广场、四阶羁绊养成与声优朗读。 |
| **📱 手机辅助模式（Phone Agent）** | Android 随身版专属：常驻悬浮球与一键急停、无障碍屏幕感知与手势模拟、免 API 本地指令（回桌面 / 返回 / 下滑 / 截屏 / 打开应用等）、`dsh-Go` 免确认连续执行。 |

---

## 🎨 外观皮肤与头像工坊

由 `appearanceSystem.js` 与 `appearance.css` 提供，所有项目全部免费开放：

| 模块 | 内容 |
| :--- | :--- |
| **7 套主题皮肤** | 系统默认 · 曜石流金 · 晨雾丝绸 · 朝雾樱白 · 绯红古卷 · 赛博霓虹 · 极简墨水屏 |
| **壁纸与配色** | 7 款内置渐变壁纸、本地壁纸上传、从壁纸智能提取主色、8 色强调色与自定义取色 |
| **排版调节** | 背景暗角遮罩、毛玻璃模糊度、字号缩放；4 种气泡风格（柔光圆润 / 玻璃拟态 / 极简细框 / 复古信纸）；3 种正文字体 |
| **皮肤分享** | JSON 分享码一键导入导出，并随账号同步到服务端 |
| **头像工坊** | 文字徽章渐变 · 12 款矢量预设 · 7 部位分层 SVG 捏脸（含随机）· Canvas 圆形裁剪上传 · 7 款头像框 · 4 种轮廓形状与心情角标 |

---

## 🎬 五大内置剧本与 20 位角色

| 剧本 | 类型 | 登场角色 |
| :--- | :--- | :--- |
| **💖 心动角色全集** | 一对一沉浸恋爱 | 沈星回（星象馆占星师）· 陆沉（雾港记忆执行官）· 谢清晏（长安世家公子）· 江逾白（昆仑清冷剑尊）· 季燃（电竞天才学弟）· 顾修远（京圈联姻家主）· 苏晚晴（财阀女执政官）· 云知遥（蓬莱清冷神女）· 夏柠萌（插画学妹）· 燕绯羽（夜莺歌姬） |
| **🌸 樱坂坡道上的风** | 青春催泪群像 · 致敬《CLANNAD》 | 星野汐 · 藤井杏奈 · 一之濑琴音 |
| **⏳ 第八月三十一日的观测站** | 夏岛悬疑轮回 · 致敬《命运石之门》 | 白石凛 · 牧濑栖 · 朝雾澪 |
| **✉️ 鸢尾邮局与无名信** | 蒸汽时代书信公路 · 致敬《紫罗兰永恒花园》 | 伊芙琳 · 霍金斯 |
| **🌿 千年星旅与苍月花原** | 奇幻散漫公路 · 致敬《葬送的芙莉莲》 | 修尔 · 菲尔 |

- 每部番剧剧本含 3~4 幕互动章节，剧本与角色池两级隔离，不会串戏。
- **AI 编剧工坊**：上传 `.txt / .md` 故事草稿，一键诊断优化、重构为多幕剧并提取登场人设。
- **共创设计广场**：浏览、点赞并一键克隆其他玩家分享的剧本包与人设卡。

---

## 🔌 连接中心与声优语音

### 三通道连接中心
- **本地直连 / 默认引擎**：通过 `antigravityBridge.js` 桥接本机 Antigravity 宿主，支持深度思考流式拆分，免 Key 开箱即用。
- **DeepSeek 官方 API**：只需粘贴 `sk-...` 密钥，自动锁定官方端点，支持测试连接、余额查询与用量监控。
- **云端 API（自定义）**：独立保存接口地址、模型名与密钥，内置硅基流动 / 阿里云百炼 / OpenRouter / Google Gemini 预设。

### 声优语音
- 按角色性别与气质自动匹配十档声线（暗夜低音霸总、治愈民谣男音、清冷叙事公子、腹黑微撩公子、沉稳绅士家主、阳光电竞少年、高冷清艳御姐、清冷仙侠师姐、二次元甜妹、二次元软萌团子）。
- 云端多通道（MiniMax / 通义千问 / 火山豆包 / SiliconFlow / OpenAI）与本地 Edge-TTS / Kokoro / Qwen3-TTS，支持 8~15 秒参考音频音色克隆。

---

## 🧠 核心架构与记忆引擎

```mermaid
flowchart TB
    subgraph Entry["多端入口"]
        Web["官方在线站"]
        Static["GitHub Pages 静态镜像"]
        App["Android 随身版 / Phone Agent"]
    end
    subgraph Core["Node.js >= 22.5.0 零依赖内核"]
        Gateway["SSE 网关 (llmGateway.js)"]
        Memory["三层记忆 (memoryEngine.js)"]
        Nurture["羁绊养成 (nurturingEngine.js)"]
        Workshop["剧本工坊 (scriptWorkshop.js)"]
        TTS["语音服务 (ttsService.js)"]
    end
    subgraph AI["模型底座"]
        Bridge["本地直连 (antigravityBridge.js)"]
        DS["DeepSeek 套件 (deepseekApiSuite.js)"]
        Custom["自定义云端网关"]
    end
    Web <--> Gateway
    Static -.-> DS
    App -.-> Gateway
    Gateway <--> Memory
    Gateway <--> Nurture
    Gateway <--> Workshop
    Web <--> TTS
    Gateway --> Bridge
    Gateway --> DS
    Gateway --> Custom
```

- **核心人设层**：角色卡、世界观规则与玩家身份永久置顶，避免人设崩塌。
- **艾宾浩斯召回层**：按相关度与保持率 `R = exp(-Δt / S)` 召回长期记忆，被提及即强化，多次召回自动固化。
- **事实自动提取**：识别称呼、身份、项目背景等，并按槽位覆盖旧信息、去重。
- **滚动摘要与 `.md` 档案**：超长历史自动压缩，支持导出/导入记忆档案跨会话继承。

---

## 🛠️ 部署与构建

### 在线使用
**[https://star.claudexxb.online/](https://star.claudexxb.online/)**（需注册账号，账号数据严格隔离）

### Android 随身版
👉 **[GitHub Releases 下载最新 APK](https://github.com/qts2218346424-cyber/persona-chat-studio/releases/latest)**，应用内支持检查更新与 SHA-256 校验覆盖安装。

### 本地零依赖部署
需 **Node.js `>= 22.5.0`**，无需 `npm install`：

```bash
git clone https://github.com/qts2218346424-cyber/persona-chat-studio.git
cd persona-chat-studio
npm start
```

浏览器访问 `http://localhost:3210`。修改前端后执行 `npm run build:assets` 重新打包并生成 `.gz` / `.br`。

<details>
<summary><b>📂 工程目录结构与 APK 自编译</b></summary>

```text
persona-chat-studio/
├── .github/workflows/        # GitHub Pages 静态镜像部署
├── scripts/build-static-assets.mjs   # CSS/JS 合并压缩与预压缩
├── public/
│   ├── index.html            # 主视图（三工作台）
│   ├── app.js                # 核心状态、连接配置、工坊与广场
│   ├── appearanceSystem.js   # 皮肤与头像工坊
│   ├── appearance.css / ui-polish-v2.css / theater-luxury.css
│   ├── standaloneAdapter.js  # 静态镜像 / APK 免后端适配
│   ├── mobileAdapter.js      # 移动端抽屉与手势
│   ├── phoneAgent.js         # Phone Agent 调度
│   ├── companionVoice.js     # 声优语音播控与克隆
│   ├── plugins/deepseekUsageMonitor.js
│   ├── dist/                 # 打包产物
│   └── assets/               # 图标、语音样本、截图
├── server/
│   ├── index.js · db.js · envLoader.js
│   ├── antigravityBridge.js · deepseekApiSuite.js · llmGateway.js
│   ├── memoryEngine.js · nurturingEngine.js · proactiveEngine.js
│   ├── scriptWorkshop.js · docImporter.js · fileParser.js
│   ├── companionEngine.js · ttsService.js
│   └── edgeTtsWorker.py · kokoroTtsWorker.py · qwenTtsWorker.py
├── examples/                 # 创作模板
├── deploy/ · deploy_cloud.py # 云端部署
└── android-app/              # WebView + Phone Agent 源码与 build_apk.ps1
```

自编译 APK（需本地 JDK 与 Android SDK）：
```powershell
powershell -ExecutionPolicy Bypass -File .\android-app\build_apk.ps1
```

创作模板：[四大番剧剧本设定集](./examples/四大番剧级互动剧本与玩法设定集.md) · [示例剧本](./examples/示例上传剧本_旧美术室的向日葵与海风.md) · [示例人设](./examples/示例人设_白塔调香师裴清让.md) · [示例历史对话](./examples/示例历史对话_星夜钟楼回忆录.txt)

</details>

---

## 🛡️ 隐私与声明

- 线上平台采用独立账户与会话级隔离；本地部署的 SQLite 数据（`data/*.sqlite`）与 API 密钥均保留在本地，并已加入 `.gitignore`。
- 本项目仅供个人学习、AI 长期记忆与情感交互机制研究及全栈架构交流使用。

<div align="center">

**如果「星语恋庭」曾带给你灵感或温柔时刻，欢迎点亮右上角的 ⭐ Star！**

</div>

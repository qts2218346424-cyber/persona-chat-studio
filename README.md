# Persona Chat Studio · 星语恋庭

> 仿 DeepSeek 网页端的人设扮演实时流式对话与三层上下文记忆互动剧场 —— 集「独立世界观番剧剧本、三层长短期记忆、双向羁绊养成、3D 灵动伴侣、神经语音合成与 Android 随身版客户端」于一体。

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22.5.0-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![SQLite](https://img.shields.io/badge/Storage-node%3Asqlite-003B57?logo=sqlite&logoColor=white)](https://nodejs.org/api/sqlite.html)
[![Android APK](https://img.shields.io/badge/Android_APK-GitHub_Releases-4D6BFE?logo=android&logoColor=white)](https://github.com/qts2218346424-cyber/persona-chat-studio/releases/latest)

---

## 📱 安卓随身版下载

预编译的 Android 客户端安装包（**DeepSeek · 星语随身版**）已发布至 GitHub Releases，可直接下载安装体验：

- 👉 **[前往 GitHub Releases 下载最新 APK 安装包](https://github.com/qts2218346424-cyber/persona-chat-studio/releases/latest)**
- 直链下载：`deepseek-studio.apk`（内置离线独立运行适配器 `standaloneAdapter.js`，支持手机端直连 DeepSeek 官方 API）

---

## ✨ 核心特性

- **💬 仿 DeepSeek 原生流式交互体验**
  采用洁净现代的双主题界面设计（支持亮色 / 暗色自适应切换），基于 SSE（Server-Sent Events）实现丝滑的思考链与角色扮演实时流式输出，支持 DeepSeek 原生接口套件与 FIM 补全能力。
- **🧠 三层上下文记忆系统（`memoryEngine.js`）**
  自动从每轮对话中抽取关键事实记忆，结合记忆保持度衰减修饰与历史溢出自动摘要压缩，构建「核心人设 + 长期事实记忆 + 近期高保真对话」三层上下文，告别长对话失忆与人设崩塌。
- **🌱 双向羁绊养成与主动交互引擎（`nurturingEngine.js` & `proactiveEngine.js`）**
  实时评估每轮互动的情感温度与好感演化，支持「梦境记忆固存（Dream Consolidation）」、角色主动关怀触发以及智能后续追问建议。
- **🎭 四大番剧级独立世界观剧本与剧本工坊（`scriptWorkshop.js` & `docImporter.js`）**
  采用「选剧本 ➔ 专属登场人设群像」两级隔离架构，每部剧本拥有独立世界观容器、默认玩家身份与专属存档，绝不跨剧串戏：
  1. **《樱坂坡道上的风》** —— 青春催泪群像剧
  2. **《第八月三十一日的观测站》** —— 夏岛悬疑轮回剧
  3. **《鸢尾邮局与无名信》** —— 蒸汽时代书信公路剧
  4. **《千年星旅与苍月花原》** —— 奇幻散漫公路剧
  - 同时支持自定义剧本创作，以及一键导入外部 Markdown / TXT 人设设定与历史对话记录。
- **🦋 3D 视差伴侣与神经语音合成（`companion3d.js` & `ttsService.js`）**
  内置多款立绘与 3D 视差互动伴侣，配合本地 Kokoro / Qwen 神经语音合成工作进程（`kokoroTtsWorker.py` / `qwenTtsWorker.py`），支持多音色朗读与参考音频音色克隆。
- **⚡ 零第三方 npm 依赖架构**
  服务端完全基于 Node.js `>= 22.5.0` 原生内置模块（`node:http`、`node:sqlite`、`node:crypto`）构建，无需安装庞大的 `node_modules` 即可开箱即用。

---

## 📂 项目结构

```text
persona-chat-studio/
├── public/                     # 前端静态资源与独立运行适配层
│   ├── index.html              # 主应用界面（登录门扉、对话工作台、剧本与伴侣面板）
│   ├── app.js                  # 前端核心状态管理与流式渲染逻辑
│   ├── standaloneAdapter.js    # 移动端 / 纯静态环境离线运行适配层
│   ├── companion3d.js / .css   # 3D 视差伴侣交互组件
│   ├── companionVoice.js       # 伴侣语音播放与控制模块
│   ├── styles.css / clean-ui.css
│   └── assets/                 # 图标、伴侣立绘与示例音频资源
├── server/                     # Node.js 零依赖原生后端服务
│   ├── index.js                # HTTP 路由、鉴权与 SSE 流式网关入口
│   ├── db.js                   # 基于 node:sqlite 的数据持久化、会员积分与剧本库
│   ├── llmGateway.js           # 大模型请求调度与流式响应解析
│   ├── deepseekApiSuite.js     # DeepSeek 官方 API 套件（余额、模型、原生流式、FIM）
│   ├── memoryEngine.js         # 三层上下文构建、事实抽取与溢出历史压缩
│   ├── nurturingEngine.js      # 好感养成评估与梦境记忆固存
│   ├── proactiveEngine.js      # 主动消息触发与追问建议生成
│   ├── scriptWorkshop.js       # 互动剧本工坊管理
│   ├── docImporter.js          # 外部人设卡与聊天记录文档解析导入
│   ├── companionEngine.js      # 伴侣状态与离线语音回复引擎
│   ├── ttsService.js           # 神经语音合成调度与缓存服务
│   ├── kokoroTtsWorker.py      # Kokoro TTS Python 推理工作进程（可选）
│   └── qwenTtsWorker.py        # Qwen TTS Python 推理工作进程（可选）
├── examples/                   # 示例剧本设定集、示例人设卡与历史对话模板
├── android-app/                # Android 原生 WebView 客户端源码与一键打包脚本
│   ├── AndroidManifest.xml
│   ├── src/                    # Java 主活动源码（MainActivity.java）
│   ├── res/                    # 多分辨率自适应矢量图标与样式资源
│   └── build_apk.ps1           # PowerShell 自动化构建与签名脚本
└── package.json
```

---

## 🚀 快速开始

### 1. 环境要求

- **Node.js**：`>= 22.5.0`（需使用内置 `node:sqlite` 模块）
- **Python 3**（可选）：仅在启用本地 Kokoro / Qwen 神经语音合成时需要

### 2. 启动网页服务端

```bash
# 克隆仓库
git clone https://github.com/qts2218346424-cyber/persona-chat-studio.git
cd persona-chat-studio

# 直接启动服务（零第三方 npm 依赖，无需 npm install）
npm start
```

启动成功后在浏览器打开：

```text
http://localhost:3210
```

> 如需自定义监听端口，可通过环境变量指定，例如 PowerShell 下执行：`$env:PORT=8080; npm start`。
> 在设置面板中填入你的 DeepSeek API Key（或使用管理员后台配置平台密钥）即可开启在线流式对话。

### 3. 构建 Android 安装包（可选）

如果希望自行编译 Android 客户端 APK：

1. 准备本地 JDK 与 Android SDK（`platforms/android-34` 及 `build-tools/35.0.0`），并按需调整 `android-app/build_apk.ps1` 顶部的 `$SdkRoot` 与 `$JdkRoot` 路径。
2. 在 PowerShell 中运行：

```powershell
powershell -ExecutionPolicy Bypass -File .\android-app\build_apk.ps1
```

编译签名完成后，产物将输出至根目录 `DeepSeek_星语随身版.apk` 及 `public/downloads/deepseek-studio.apk`。

---

## 📄 开源说明

本项目仅供个人学习、AI 角色扮演交互研究与全栈架构交流使用。本地运行产生的 SQLite 数据库（`data/*.sqlite`）与 API 密钥配置均已在 `.gitignore` 中排除，不会随代码提交上传。

# Alice Enhanced

<p align="center">
  <img src="public/app_logo.png" width="128" alt="Alice Enhanced 图标" />
</p>

<p align="center">
  <strong>可运行在桌面的开源 AI 助手：支持多模型、语音交互、本地记忆、工具调用与可扩展智能体能力。</strong>
</p>

<p align="center">
  简体中文 · <a href="README_EN.md">English</a>
</p>

> [!NOTE]
> 本项目基于 [pmbstyle/Alice](https://github.com/pmbstyle/Alice)
> 二次开发，不是上游项目的官方发行版。

## 项目简介

Alice Enhanced 是一个基于 Electron、Vue 和 Go 构建的桌面 AI 助手。它既可以连接云端模型，也可以配合 Ollama、LM Studio、本地 Whisper、Piper 和本地向量模型运行，并通过明确的权限确认机制调用文件、命令、搜索、日历等工具。

这个分支在上游 Alice 的基础上进行了大量界面、模型接入、语音、记忆、工具、安全和扩展能力改造。目前仍处于积极开发阶段，部分本地模型与第三方服务可能需要额外配置。

## 功能亮点

### 多模型与多服务商

- OpenAI
- OpenRouter
- ChatGPT Codex 订阅接入
- DeepSeek、Z.ai、MiniMax、API Route
- 自定义 OpenAI 兼容接口
- Ollama 与 LM Studio 本地模型
- 对话模型与总结模型可独立配置

### 语音交互

- 支持语音活动检测、连续对话与播放中断
- STT：OpenAI、Groq、Google、豆包、腾讯云、自定义兼容接口、本地 Whisper
- TTS：OpenAI、Google、豆包、腾讯云、自定义兼容接口、本地 Piper
- 支持唤醒词与识别语言配置
- 本地语音组件按需下载，无需在安装包中预置全部模型

### 记忆与本地知识库

- 临时、会话和长期记忆模式
- 对话摘要与结构化长期记忆
- SQLite、全文检索与向量检索
- 本地文档 RAG，可导入文件或文件夹并重新索引
- 支持本地、OpenAI 等嵌入方案

### 工具与桌面能力

- 文件和目录读取、搜索及受控写入
- 命令执行、剪贴板、截图和应用/链接打开
- 网页搜索、Google Calendar 与 Gmail 集成
- 定时提醒与计划任务
- 图片、文档及聊天附件处理
- 可选的浏览器上下文、Jackett 与 qBittorrent 集成

### 扩展与自定义

- [Agent Skills](docs/skills.md)：扫描、安装、启用和按需加载本地技能
- [自定义工具](docs/custom-tools.md)：通过 JSON Schema 与本地脚本扩展能力
- [自定义助手头像](docs/custom-avatars.md)与待机、思考、说话动画
- MCP 服务配置
- 可调整的人设、模型参数、热键与工具列表

### 安全与体验改进

- 简体中文与英文界面
- 首次运行配置向导
- 独立设置窗口和重新设计的设置导航
- 文件、目录和命令的分级授权
- 一次、本次会话、当前项目和全局授权范围
- 高风险命令不允许永久放行
- IPC 白名单、外部导航保护和受控网络访问
- 凭据优先使用 Electron `safeStorage` 加密保存
- 支持后台只读 Codex 委派任务

## 当前状态

- Windows、macOS 和 Linux 均有构建配置。
- 当前项目仍在开发中，正式 Release 和下载地址将在独立仓库发布后补充。
- 本地推理、语音组件和部分第三方服务仍可能受操作系统、网络及上游接口变化影响。
- 发布构建尚未进行代码签名，系统可能显示未知开发者提示。

## 技术栈

- Electron、Vue 3、TypeScript、Vite
- Pinia、Tailwind CSS、DaisyUI
- Go 本地后端
- SQLite、HNSWlib、ONNX Runtime Web
- Vitest 与 GitHub Actions

## 从源码运行

### 环境要求

- Node.js 22 或更高版本
- npm
- Go 1.23 或更高版本
- Python 3.11 与本机编译工具（部分原生 Node 模块可能需要）

### 安装与启动

```bash
git clone https://github.com/yanglei1826877278/Alice-Enhanced.git
cd Alice-Enhanced
npm install
npm run build:go
npm run dev
```

首次启动后，通过配置向导选择 AI、语音和记忆服务。只有选择对应本地服务时，Whisper、Piper 和嵌入模型才会下载到应用用户数据目录。

### 常用命令

```bash
# 开发模式
npm run dev

# 单元测试
npm run test

# 仅构建前端
npm run build:web

# 构建 Go 后端
npm run build:go

# 生成当前平台安装包
npm run build
```

构建产物位于 `release/<version>/`。

## 配置

大多数服务可以直接在首次运行向导或设置页面中配置。开发环境也可以参考 `.env-example`。

Google 服务集成需要在项目根目录创建不会提交到 Git 的 `app-config.json`：

```json
{
  "VITE_GOOGLE_CLIENT_ID": "",
  "VITE_GOOGLE_CLIENT_SECRET": ""
}
```

请勿提交 API Key、OAuth 密钥、用户设置、数据库或其他个人数据。

## 数据与隐私

- 设置、记忆、对话、RAG 索引和自定义内容默认保存在 Electron 用户数据目录。
- 支持的系统上，敏感凭据会通过 Electron `safeStorage` 使用操作系统能力进行保护。
- 使用云端模型、语音、搜索或集成服务时，相关请求会发送到你选择的第三方服务商。
- 文件访问和命令执行受权限策略控制；授权前仍应确认路径、命令和作用范围。
- 本项目不会让本地模型自动等同于“完全离线”：是否联网取决于所选择的模型、语音、搜索和集成配置。

## 与上游 Alice 的关系

本项目源自 [pmbstyle/Alice](https://github.com/pmbstyle/Alice)，感谢原作者和所有上游贡献者。

当前分支在上游基础上进行了较大范围的继续开发，包括但不限于：

- 中英文界面与首次运行向导
- 更完整的模型、语音和自定义兼容接口
- Codex 订阅与后台委派任务
- Agent Skills、自定义工具和自定义头像
- 权限策略、凭据保护和 IPC/网络安全边界
- 对话、附件、记忆、RAG 与设置体验优化
- 本地 AI 组件按需下载和后台进程管理

为了便于维护，上游遗留的部分内部名称（例如 `aliceIPC`、`AliceSettings` 和 `alice-backend`）暂时保留。它们不代表本项目是上游官方发行版。

## 贡献

欢迎提交 Issue 和 Pull Request。在提交较大的功能改动前，建议先通过 Issue 说明目标、实现范围和兼容性影响。

提交代码前请至少运行：

```bash
npm run test
```

涉及 TypeScript 修改时，建议同时执行：

```bash
npx vue-tsc --noEmit
```

后续会补充更完整的 `CONTRIBUTING.md`、变更日志和发布规范。

## 安全提示

如果发现可能泄露凭据、绕过授权或执行非预期命令的安全问题，请不要在公开 Issue 中粘贴密钥、个人数据或完整利用细节。独立仓库建立后会在 `SECURITY.md` 中提供私下报告方式。

## 许可证

本项目使用 [MIT License](LICENSE)。基于上游 Alice 的代码继续保留原项目的版权与许可证声明；本分支新增修改的版权信息可在正式发布前另行补充。

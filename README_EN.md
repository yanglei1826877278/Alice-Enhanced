# Alice Enhanced

<p align="center">
  <img src="public/app_logo.png" width="128" alt="Alice Enhanced icon" />
</p>

<p align="center">
  <strong>An open-source desktop AI assistant with multiple model providers, voice interaction, local memory, tools, and extensible agent capabilities.</strong>
</p>

<p align="center">
  <a href="README.md">简体中文</a> · English
</p>

> [!NOTE]
> This project is an independent derivative of
> [pmbstyle/Alice](https://github.com/pmbstyle/Alice), not an official upstream release.

## Overview

Alice Enhanced is a desktop AI assistant built with Electron, Vue, and Go. It can connect to cloud models or work with Ollama, LM Studio, local Whisper, Piper, and local embedding models. Its tools can interact with files, commands, search, calendars, and other desktop capabilities through explicit permission controls.

This fork substantially extends the upstream Alice project across its interface, provider support, voice stack, memory, tools, security boundaries, and extension system. It remains under active development, and some local components or third-party integrations require additional configuration.

## Highlights

### Models and providers

- OpenAI
- OpenRouter
- ChatGPT Codex subscription support
- DeepSeek, Z.ai, MiniMax, and API Route
- Custom OpenAI-compatible endpoints
- Local models through Ollama and LM Studio
- Separate assistant and summarization model settings

### Voice interaction

- Voice activity detection, continuous conversation, and interruptible playback
- STT: OpenAI, Groq, Google, Doubao, Tencent Cloud, custom compatible endpoints, and local Whisper
- TTS: OpenAI, Google, Doubao, Tencent Cloud, custom compatible endpoints, and local Piper
- Configurable wake word and recognition language
- On-demand local voice components instead of bundling every model

### Memory and local knowledge

- Temporary, session, and long-term memory modes
- Conversation summaries and structured long-term memories
- SQLite, full-text search, and vector retrieval
- Local document RAG with file/folder import and reindexing
- Local and cloud embedding options

### Tools and desktop capabilities

- Controlled file/directory reading, searching, and writing
- Command execution, clipboard access, screenshots, and opening apps or URLs
- Web search, Google Calendar, and Gmail integrations
- Scheduled reminders and command tasks
- Image, document, and chat attachment handling
- Optional browser context, Jackett, and qBittorrent integrations

### Extensions and customization

- [Agent Skills](docs/skills.md) with scanning, installation, enablement, and on-demand loading
- [Custom tools](docs/custom-tools.md) backed by JSON Schema definitions and local scripts
- [Custom assistant avatars](docs/custom-avatars.md) with standby, thinking, and speaking animations
- MCP server configuration
- Configurable persona, model behavior, hotkeys, and tool availability

### Security and user experience

- Simplified Chinese and English interfaces
- First-run setup wizard
- Separate settings window with redesigned navigation
- Scoped permissions for files, directories, and commands
- One-time, session, project, and global authorization scopes
- High-risk commands cannot be permanently approved
- IPC allowlists, navigation guards, and controlled network access
- Credentials are protected with Electron `safeStorage` where available
- Background read-only Codex delegation

## Project status

- Build configurations are available for Windows, macOS, and Linux.
- The project is still under active development. Official release downloads will be added after the independent repository is ready.
- Local inference, voice components, and third-party services may depend on the operating system, network access, and upstream API compatibility.
- Release builds are currently unsigned and may trigger an unknown-publisher warning.

## Technology stack

- Electron, Vue 3, TypeScript, and Vite
- Pinia, Tailwind CSS, and DaisyUI
- Local Go backend
- SQLite, HNSWlib, and ONNX Runtime Web
- Vitest and GitHub Actions

## Run from source

### Requirements

- Node.js 22 or newer
- npm
- Go 1.23 or newer
- Python 3.11 and native build tools (may be required by native Node modules)

### Install and start

```bash
git clone https://github.com/yanglei1826877278/Alice-Enhanced.git
cd Alice-Enhanced
npm install
npm run build:go
npm run dev
```

Use the first-run wizard to select model, voice, and memory providers. Whisper, Piper, and local embedding assets are downloaded to the application user-data directory only when their corresponding local provider is selected.

### Common commands

```bash
# Development mode
npm run dev

# Unit tests
npm run test

# Build the renderer only
npm run build:web

# Build the Go backend
npm run build:go

# Package the application for the current platform
npm run build
```

Packaged artifacts are written to `release/<version>/`.

## Configuration

Most services can be configured in the first-run wizard or Settings. For development-time environment variables, see `.env-example`.

Google integrations require an untracked `app-config.json` in the project root:

```json
{
  "VITE_GOOGLE_CLIENT_ID": "",
  "VITE_GOOGLE_CLIENT_SECRET": ""
}
```

Never commit API keys, OAuth secrets, user settings, databases, or other personal data.

## Data and privacy

- Settings, memories, conversations, RAG indexes, and user customizations are stored in Electron's user-data directory by default.
- On supported systems, sensitive credentials are protected through the operating system via Electron `safeStorage`.
- Requests are sent to the selected third-party provider when cloud models, voice services, search, or integrations are enabled.
- File access and command execution are governed by permission policies; always review the requested path, command, and scope before approving it.
- Choosing some local components does not automatically make the entire application offline. Network use depends on the selected model, voice, search, and integration settings.

## Relationship to upstream Alice

This project is derived from [pmbstyle/Alice](https://github.com/pmbstyle/Alice). We are grateful to the original author and all upstream contributors.

Major areas of continued development in this fork include:

- Chinese/English UI and a first-run setup wizard
- Expanded model, voice, and custom compatible providers
- Codex subscription support and background delegation
- Agent Skills, custom tools, and custom avatars
- Permission policies, credential protection, and IPC/network boundaries
- Conversation, attachment, memory, RAG, and settings improvements
- On-demand local AI components and background process management

Some inherited internal identifiers, including `aliceIPC`, `AliceSettings`, and `alice-backend`, are intentionally retained for maintainability. They do not imply that this project is an official upstream release.

## Contributing

Issues and pull requests are welcome. For substantial changes, please open an issue first to discuss the goal, scope, and compatibility impact.

Before submitting code, run at least:

```bash
npm run test
```

For TypeScript changes, also consider running:

```bash
npx vue-tsc --noEmit
```

A fuller `CONTRIBUTING.md`, changelog, and release policy will be added later.

## Security

If you discover a potential credential leak, permission bypass, or unintended command-execution issue, do not post secrets, personal data, or complete exploit details in a public issue. A private reporting process will be documented in `SECURITY.md` after the independent repository is created.

## License

This project is distributed under the [MIT License](LICENSE). Copyright and license notices from the upstream Alice project remain in place. Copyright information for modifications in this fork may be added before the first public release.

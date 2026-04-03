# OpenClaw Code Wiki

## 1. 项目整体架构 (Overall Architecture)

OpenClaw 是一个在本地设备上运行的个人 AI 助手。它作为一个多通道（Multi-channel）的 AI 网关，能够连接您日常使用的各种通讯工具（如 WhatsApp, Telegram, Slack 等），并支持跨设备（macOS/iOS/Android）执行任务和进行语音交互。

OpenClaw 采用了**中心化控制平面 (Control Plane) 与分布式节点 (Nodes) 相结合**的架构设计：

- **Gateway (网关/控制平面)**：作为整个系统的核心，Gateway 是一个基于 Node.js 运行的服务。它通过 WebSocket 网络管理所有的会话、通信通道、自动化工具以及系统事件。
- **Agent Runtime (代理运行时)**：系统内置的智能体执行引擎（Pi Agent），负责上下文管理、模型调用、流式处理以及工具分发。
- **Channels (通信通道)**：将外部聊天平台（如 Discord、Slack、微信等）作为输入/输出端点接入网关。
- **Nodes & Companion Apps (节点与配套应用)**：网关不仅可以作为纯后端服务，还可以与 macOS、iOS、Android 上的客户端应用进行连接（设备配对），这些设备节点可以通过 WebSocket 将本地能力（如：摄像头、麦克风、通知、执行本地 Shell 命令等）暴露给核心的 AI 代理。
- **Sandboxing (沙盒机制)**：架构在安全方面支持将执行环境进行隔离（如 Docker 容器化），对来自不同 Channel 的非主要会话（群组或公共聊天）进行沙盒隔离，防止越权操作。

## 2. 主要模块职责 (Main Modules & Responsibilities)

项目采用 Monorepo 结构，主要模块分布在 `src/`、`extensions/` 和 `ui/` 目录下。

### 2.1 核心系统 (`src/`)
- **`src/gateway/`**：控制平面的实现。包含 WebSocket 服务器、状态管理、通道连接管理、Tailscale/SSH 远程穿透集成，以及提供给 Control UI 的 HTTP 路由和 API 端点。
- **`src/agents/`**：AI Agent 的运行时环境。负责连接底层大语言模型（LLMs），处理 Token 流、工具调用、内存上下文（Memory Search），以及运行时的安全防护（沙盒策略、路径限制等）。
- **`src/cli/`**：命令行界面逻辑。定义了丰富的 CLI 指令（如 `openclaw gateway`, `openclaw onboard`, `openclaw agent` 等），负责参数解析和进程启动。
- **`src/tui/`**：终端用户界面 (Terminal UI)。提供了在命令行中与 AI 进行直接对话和展示富文本/状态的能力。
- **`src/auto-reply/`**：自动回复引擎。处理消息防抖、心跳机制、路由规则以及对外部消息触发的自动回复逻辑。
- **`src/plugins/`**：插件 SDK 的核心定义和生命周期管理，允许外部功能动态挂载到网关。

### 2.2 集成插件库 (`extensions/`)
该目录包含了所有官方支持的第三方服务接入插件，分为以下几类：
- **模型 Provider**：如 `openai/`, `anthropic/`, `google/`, `deepseek/`, `ollama/`, `vllm/` 等。负责将各家 API 规范化为 OpenClaw 内部可调用的标准接口。
- **通信 Channels**：如 `discord/`, `slack/`, `telegram/`, `whatsapp/` (基于 Baileys), `matrix/` 等。负责对接各聊天软件的 API、Webhook 或 WebSocket。
- **核心 Tools**：如 `browser/`（Chrome CDP 浏览器控制）, `device-pair/`（设备配对节点通信）等工具集成。

### 2.3 控制面板 (`ui/`)
- 一个基于 Web Components (`Lit`) 和 `Vite` 构建的单页应用。通过浏览器提供可视化的仪表盘，用于配置网关、查看日志、管理技能（Skills）和监控使用量。

## 3. 关键类与函数说明 (Key Classes/Functions)

- **`runCli` ([src/cli/run-main.ts](file:///workspace/src/cli/run-main.ts))**：整个应用的 CLI 入口函数。负责解析命令行参数、加载环境变量 (`.env`)、初始化配置、按需注册子命令以及挂载插件系统。
- **`pi-embedded-runner.ts` / `pi-embedded-subscribe.ts` ([src/agents/](file:///workspace/src/agents))**：Agent 运行时的核心调度逻辑。管理与 `@mariozechner/pi-agent-core` 的集成，处理 LLM 的响应流（Streaming），拦截并执行 Tool Call，以及将最终结果转换并发送回对应的 Channel。
- **`Gateway` / `Boot` ([src/gateway/boot.ts](file:///workspace/src/gateway/boot.ts))**：网关的引导与初始化，包括加载工作区、恢复 Session 状态以及执行启动自检检查（BOOT.md）。
- **`models-config.ts` ([src/agents/models-config.ts](file:///workspace/src/agents/models-config.ts))**：模型选择与故障转移（Failover）的核心逻辑。它实现了复杂的轮询和容灾策略，当首选模型 API 失败时，能够无缝切换到备用模型。

## 4. 依赖关系 (Dependencies)

OpenClaw 构建在一个现代化的 TypeScript 技术栈之上：

- **Agent Core**：深度依赖 `@mariozechner/pi-agent-core` 及相关的 `pi-*` 包，提供底层的 AI 推理和工具注册框架。
- **网络与路由**：`hono` (轻量级 Web 框架，用于构建 API 和 Webhooks)，`express` (部分兼容需要)。
- **存储与内存**：`sqlite-vec` 提供嵌入式的向量数据库支持，用于实现长文本的上下文 Memory 检索与存储。
- **通道 SDKs**：
  - `@whiskeysockets/baileys`：用于实现 WhatsApp 协议。
  - `matrix-js-sdk`：用于 Matrix 协议。
  - `@line/bot-sdk`、`discord.js` 等标准库。
- **校验与类型**：广泛使用 `zod` 和 `@sinclair/typebox` 进行配置验证和模型输入输出（Schema）约束。
- **构建系统**：基于 `pnpm` workspace 管理 Monorepo，使用 `oxlint` / `oxfmt` 进行代码规范，`vitest` 负责测试。

## 5. 项目运行方式 (Run Instructions)

运行环境要求：**Node.js 24 (推荐) 或 Node.js 22.16+**。

### 5.1 生产环境 (作为终端用户)

\`\`\`bash
# 1. 全局安装 OpenClaw
npm install -g openclaw@latest

# 2. 初始化引导 (推荐)，该命令会引导你配置通道和模型，并可选择安装后台守护进程
openclaw onboard --install-daemon

# 3. 启动网关服务 (如果未作为守护进程安装)
openclaw gateway --port 18789 --verbose

# 4. 也可以通过 CLI 发送测试消息
openclaw message send --to +1234567890 --message "Hello from OpenClaw"
openclaw agent --message "帮我写一个发布检查清单"
\`\`\`

### 5.2 本地开发环境 (From Source)

推荐使用 `pnpm` 进行依赖管理。

\`\`\`bash
# 1. 克隆代码库并进入目录
git clone https://github.com/openclaw/openclaw.git
cd openclaw

# 2. 安装依赖 (使用 pnpm)
pnpm install

# 3. 构建 Control UI 和核心代码
pnpm ui:build
pnpm build

# 4. 执行初始化 (引导流程)
pnpm openclaw onboard --install-daemon

# 5. 启动网关的开发模式 (支持代码热重载 Watch)
pnpm gateway:watch
\`\`\`

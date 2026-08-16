# DaSha Agent

> A **fully self-hosted agent operating system** — LLM, tools, memory, sessions, skills, and multi-agent orchestration are all decoupled into pluggable modules. Built with Node.js + TypeScript, **local-first by default (Ollama): zero extra cost, and your data never leaves your machine**. The built-in, network-installable **skill Marketplace** is what sets it apart from most open-source agent frameworks.

English: DaSha Agent is a self-hosted, modular agent OS. Local-first by default (Ollama), pluggable tools/memory/skills, with a built-in skill marketplace.

---

## ⚡ Quick Start · Up and running in 3 minutes

> Prerequisites: Node.js ≥ 20 and npm installed. Optionally install [Ollama](https://ollama.com) to enable local models.

```bash
# 1. Enter the project directory
cd DaShaAgent

# 2. Install dependencies (includes the tsx runtime; no global install needed)
npm install

# 3. Copy the environment template (every variable has a safe default; you can leave all blank)
cp .env.example .env

# 4. Start the server (listens on 3001 by default)
npm start

# 5. Open the console in your browser
#    http://localhost:3001
```

You can run it even without Ollama: set `AH_PROVIDER=cloud` in `.env` with any OpenAI-compatible `AH_CLOUD_KEY`, or set it to `mock` for flow-only verification.

After starting, visit `http://localhost:3001` to see the web console. The skill Marketplace entry is inside the console, where you can install community skills with one click.

---

## 🔒 Security & Exposure · 安全与暴露

> **默认只监听本机（127.0.0.1）。** `npm start` 启动的控制台/API/WebSocket 仅接受来自本机的连接，对局域网/公网不可见，可放心使用。

- **不要裸暴露到局域网/公网。** 若设置 `AH_LAN=1` 或 `AH_BIND_HOST=0.0.0.0`，服务将监听所有网卡，而内置 HTTP API 的多个端点（如 `/api/webhook/message` 会直接执行任务、`/api/plugins` 可注册命令插件、`/api/agent/pause`）**没有鉴权**。除非你额外加了反向代理鉴权，否则切勿在不受信网络开放。
- **`run_code` / 技能脚本在宿主机执行。** 它们经过威胁检测（拦截 `rm -rf /`、fork bomb、`curl|sh` 等），但本质是在你机器上运行代码，仅在本地可信环境启用；`.env` 中 `SANDBOX_ENABLED=true` 是其总开关。
- **`npm run control` / `npm run os` 是演示/遗留控制面**，含未鉴权的 `kill`/`reset`/`webhook` 端点，**仅限本机调试，切勿暴露**。
- 敏感配置（云模型 Key、自定义模型 Key）通过 `/api/config` 读取时已被脱敏为 `***`，不会回显到前端。

---

## ✨ Features

- ✅ **Single Agent Loop** — streaming chat + tool-calling loop (understand → reason → plan → act)
- ✅ **Two / three-tier safety guardrails**: Permission → Threat detection → Audit logging
- ✅ **Long-term memory**: profile / notes / vector recall, persisted as JSON files, never leaves your machine
- ✅ **Two-stage skill loading**: BM25 matching + on-demand Schema instantiation, with Chinese bigram support
- ✅ **Built-in skill Marketplace**: browse, install, and update community skills over the network
- ✅ **Knowledge-base RAG**: drop PDF / txt / md into `data/knowledge` to make them searchable
- ✅ **Parallel multi-agent orchestration**
- ✅ **Scheduled task engine**: queue + scheduler, with manual `triggerNow`
- ✅ **Web UI + WebSocket streaming + activity feed**
- ✅ **Observability layer**: logger + tracer + metrics + cost + replay
- ✅ **Security system**: permission engine + threat detection + command normalization (anti-bypass) + audit

---

## 🏗️ Architecture

```
unified.ts (engine entry · single port 3001)
    │
    ├─ Gateway (HTTP + WebSocket)         web/ + gateway/
    ├─ AgentLoop (orchestration core · main path)   core/agentLoop.ts  ← production engine
    │   ├─ Brain (understand→reason→plan)         brain/
    │   ├─ Executor (action engine)                executor/
    │   ├─ Provider layer (unified LLM interface)  llm/
    │   ├─ Tool registry                           tools/ (fs/docx/pdf/xlsx/pptx/blog/email...)
    │   ├─ Memory layer (profile+notes+RAG)        memory/ + rag/
    │   └─ Skill system (two-stage lazy loading)   skills/
    │
    ├─ Evolution (self-evolution engine)          evolution/
    ├─ Learning (task distillation · auto-learn)   learning/
    ├─ Cognition / Cognitive                      cognition/ + cognitive/
    ├─ Workflow (resident task engine)            workflow/
    ├─ Multi-Agent (orchestration)                multiagent/
    ├─ Security / Sandbox                         security/ + sandbox/
    ├─ Scheduler (cron jobs)                       scheduler/
    ├─ Observability (logs+tracing+metrics+cost)   observability/
    └─ API (REST + admin endpoints)               api/
```

~14k lines of TypeScript, with every module decoupled and individually replaceable.

---

## ⚙️ Configuration

Every variable has a default and can be left blank. See [`.env.example`](.env.example) for the full template.

| Variable | Default | Description |
|---|---|---|
| `AH_PROVIDER` | `ollama` | `ollama` / `cloud` / `mock` |
| `AH_CONTROL_PORT` | `3001` | Service port (Control Center) |
| `AH_OLLAMA_BASE` | `http://127.0.0.1:11434` | Ollama address |
| `AH_OLLAMA_MODEL` | `qwen3.5-9b-tool:q5` | Chat model (must support tools) |
| `AH_OLLAMA_EMBED` | `nomic-embed-text` | Embedding model |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GOOGLE_API_KEY` / `DEEPSEEK_API_KEY` | `` | Fill when enabling the corresponding cloud model |
| `AH_CLOUD_KEY` | `` | OpenAI-compatible cloud key (fill when using `cloud`) |
| `MEMORY_ENABLED` | `true` | Long-term memory switch |
| `SANDBOX_ENABLED` | `true` | Sandbox isolation (driven by the real sandbox in `server/src/sandbox/`) |

---

## 📦 Project Structure

```
DaShaAgent/
├── server/            # TypeScript backend engine (unified.ts is the production entry)
│   ├── src/
│   │   ├── unified.ts        # engine entry, port 3001
│   │   ├── core/            # AgentLoop orchestration core
│   │   ├── tools/           # tool registry (fs/docx/pdf/xlsx/pptx…)
│   │   ├── skills/          # skill system + builtin example skills
│   │   ├── memory/ rag/     # memory and knowledge base
│   │   ├── evolution/       # self-evolution engine
│   │   └── ...              # cognition/learning/security/scheduler/…
├── web/               # static frontend (marketplace.html + app.v3.js)
├── dashboard/         # optional web dashboard (standalone frontend project)
├── skills/            # user-level skill storage (runtime)
├── data/              # runtime data (memory/knowledge/logs), not committed
├── tests/             # deterministic end-to-end tests
├── .env.example       # environment variable template
└── README.md
```

> Note: runtime artifacts such as `data/`, `agent.db`, and `.env` are excluded by `.gitignore` and never enter the repository.

---

## 🧪 Development

```bash
npm run typecheck     # TypeScript type check (zero-error target)
npm test              # deterministic end-to-end tests (MockProvider, no network needed)
npm run dev           # hot-reload start (for development)
```

Adding a skill: create a directory under `server/src/skills/builtin/` following the `SKILL.md` spec and it will be auto-discovered; community skills are distributed via the Marketplace. See [docs/authoring-skills.md](docs/authoring-skills.md).

---

## 🤝 Community & Trust Assets

- **Example agents / skills**: `server/src/skills/builtin/` ships a set of generic example skills (debugging, OCR, memory framework, research, GitHub, etc.) you can use as a starting point.
- **Tutorials & use cases**: docs and use-case videos are being added continuously — tell us in Discussions what you'd like to see.
- **GitHub Discussions**: the home base for questions, suggestions, and showcasing use cases (the Discussions tab).
- **GitHub Issues**: the unified entry for bug reports and security disclosures (for security, use the private Security Advisory — see [SECURITY.md](SECURITY.md)).

> We are committed to keeping the project runnable, well-documented, and the community active.

---

## 💖 Support & Sponsors

If DaSha Agent helps you, you're welcome to:

- ⭐ Star it on GitHub so more people can find it
- 🐛 File Issues / open PRs to build it together
- ☕ Support ongoing maintenance via **GitHub Sponsors** (see the Sponsor button on the repo)
- 🏢 Enterprise needs (private deployment, custom skills, SLA support): contact the maintainers via GitHub Issues.

---

## 📚 Documentation & Governance

Trust assets and supporting docs ship with the repo — please review them before contributing:

- [CONTRIBUTING.md](CONTRIBUTING.md) — environment setup, dev workflow, code standards, skill authoring entry
- [docs/authoring-skills.md](docs/authoring-skills.md) — how to write a skill that gets auto-discovered
- [SECURITY.md](SECURITY.md) — private vulnerability reporting channel & secure-by-default design
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) — community code of conduct (Contributor Covenant 2.1)
- [CHANGELOG.md](CHANGELOG.md) — version changelog
- `.github/` — Issue / PR templates and CI workflows

---

## 📄 License

[MIT](LICENSE) — free to use, modify, and distribute, including commercially.

---

# 中文文档

> 一个**完全属于你自己的智能体运行底座** —— LLM、工具、记忆、会话、技能、多智能体编排全部解耦成可插拔模块。Node.js + TypeScript，**默认本地 Ollama，零额外成本、数据不出本机**。内置可联网安装的**技能市场（Marketplace）**，是它与多数开源 Agent 框架最不一样的地方。

---

## ⚡ 快速开始 · 3 分钟跑起来

> 前置：已装 Node.js ≥ 20 与 npm。可选装 [Ollama](https://ollama.com) 以启用本地模型。

```bash
# 1. 进入项目目录
cd DaShaAgent

# 2. 安装依赖（含 tsx 运行时，无需全局安装）
npm install

# 3. 复制环境变量模板（所有项都有安全默认值，可全部留空）
cp .env.example .env

# 4. 启动服务（默认监听 3001）
npm start

# 5. 浏览器打开控制台
#    http://localhost:3001
```

不想装 Ollama 也能跑：把 `.env` 里 `AH_PROVIDER` 设为 `cloud` 并填入任意一家 OpenAI 兼容 `AH_CLOUD_KEY`，或设为 `mock` 仅做流程验证。

启动后访问 `http://localhost:3001` 即可看到 Web 控制台；技能市场入口在控制台内，可一键安装社区技能。

---

## ✨ 能力矩阵

- ✅ **单 Agent Loop** 流式对话 + 工具调用循环（理解 → 推理 → 规划 → 执行）
- ✅ **两级/三级安全护栏**：Permission（权限）→ Threat（威胁检测）→ Audit（审计日志）
- ✅ **长期记忆**：画像 / 笔记 / 向量召回，JSON 文件持久化，数据不出本机
- ✅ **两阶段技能加载**：BM25 匹配 + Schema 按需实例化，支持中文 bigram
- ✅ **内置技能市场（Marketplace）**：可联网浏览、安装、更新社区技能
- ✅ **知识库 RAG**：把 PDF / txt / md 放进 `data/knowledge` 即可检索
- ✅ **多智能体并行编排**
- ✅ **定时任务引擎**：队列 + 调度，支持手动 `triggerNow`
- ✅ **Web 界面 + WebSocket 流式 + 活动流**
- ✅ **可观测层**：logger + tracer + metrics + cost + replay
- ✅ **安全系统**：权限引擎 + 威胁检测 + 命令规范化防绕过 + 审计

---

## 🏗️ 架构

```
unified.ts (引擎主入口 · 单端口 3001)
    │
    ├─ Gateway (HTTP + WebSocket)         web/ + gateway/
    ├─ AgentLoop (编排核心 · 主路径)      core/agentLoop.ts  ← 生产引擎
    │   ├─ Brain (理解→推理→规划)         brain/
    │   ├─ Executor (行动发动机)          executor/
    │   ├─ Provider 层 (统一 LLM 接口)    llm/
    │   ├─ 工具注册表                     tools/ (fs/docx/pdf/xlsx/pptx/blog/email...)
    │   ├─ 记忆层 (画像+笔记+RAG)         memory/ + rag/
    │   └─ 技能系统 (两阶段延迟加载)      skills/
    │
    ├─ Evolution (自我进化引擎)           evolution/
    ├─ Learning (任务蒸馏·自动学习)       learning/
    ├─ Cognition / Cognitive              cognition/ + cognitive/
    ├─ Workflow (常驻任务引擎)           workflow/
    ├─ Multi-Agent (多智能体编排)         multiagent/
    ├─ Security / Sandbox                security/ + sandbox/
    ├─ Scheduler (定时任务)               scheduler/
    ├─ Observability (日志+追踪+指标+成本) observability/
    └─ API (REST + 管理接口)             api/
```

约 14k 行 TypeScript，模块全部解耦、可单独替换。

---

## ⚙️ 配置

所有变量都有默认值，可全部留空。完整模板见 [`.env.example`](.env.example)。

| 变量 | 默认值 | 说明 |
|---|---|---|
| `AH_PROVIDER` | `ollama` | `ollama` / `cloud` / `mock` |
| `AH_CONTROL_PORT` | `3001` | 服务端口（Control Center） |
| `AH_OLLAMA_BASE` | `http://127.0.0.1:11434` | Ollama 地址 |
| `AH_OLLAMA_MODEL` | `qwen3.5-9b-tool:q5` | 对话模型（需支持 tools） |
| `AH_OLLAMA_EMBED` | `nomic-embed-text` | 嵌入模型 |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GOOGLE_API_KEY` / `DEEPSEEK_API_KEY` | `` | 启用对应云端模型时填写 |
| `AH_CLOUD_KEY` | `` | OpenAI 兼容云端 Key（启用 cloud 时填） |
| `MEMORY_ENABLED` | `true` | 长期记忆开关 |
| `SANDBOX_ENABLED` | `true` | 沙箱隔离（由 `server/src/sandbox/` 下的真实沙箱驱动） |

---

## 📦 目录结构

```
DaShaAgent/
├── server/            # TypeScript 后端引擎（unified.ts 为生产入口）
│   ├── src/
│   │   ├── unified.ts        # 引擎主入口，端口 3001
│   │   ├── core/            # AgentLoop 编排核心
│   │   ├── tools/           # 工具注册表（fs/docx/pdf/xlsx/pptx…）
│   │   ├── skills/          # 技能系统 + builtin 示例技能
│   │   ├── memory/ rag/     # 记忆与知识库
│   │   ├── evolution/       # 自我进化引擎
│   │   └── ...              # cognition/learning/security/scheduler/…
├── web/               # 静态前端（marketplace.html + app.v3.js）
├── dashboard/         # 可选的 Web 仪表盘（独立前端工程）
├── skills/            # 用户级技能存放（运行时）
├── data/              # 运行时数据（记忆/知识库/日志），不入库
├── tests/             # 确定性端到端测试
├── .env.example       # 环境变量模板
└── README.md
```

> 注意：`data/`、`agent.db`、`.env` 等运行时产物已在 `.gitignore` 中排除，不会进入版本库。

---

## 🧪 开发与测试

```bash
npm run typecheck     # TypeScript 类型检查（零错误目标）
npm test              # 确定性端到端测试（MockProvider，无需联网）
npm run dev           # 热重载启动（开发用）
```

新增技能：在 `server/src/skills/builtin/` 下按 `SKILL.md` 规范创建目录即可被自动发现；社区技能通过技能市场分发。详见 [docs/authoring-skills.md](docs/authoring-skills.md)。

---

## 🤝 社区与信任资产

- **示例 Agent / 技能**：`server/src/skills/builtin/` 内置一批通用示例技能（调试、OCR、记忆框架、研究、GitHub 等），可作为你自己的起点。
- **教程与用例**：文档与用例视频正在持续补充，欢迎在 Discussions 提出你想看的场景。
- **GitHub Discussions**：提问、建议、晒用例的主阵地（仓库 Discussions 标签页）。
- **GitHub Issues**：Bug 反馈与安全上报的统一入口（安全问题请走私有 Security Advisory，详见 [SECURITY.md](SECURITY.md)）。

> 我们坚持让项目能跑、文档齐全、社区活跃。

---

## 💖 支持与赞助

如果 DaSha Agent 对你有帮助，欢迎：

- ⭐ 在 GitHub 上 Star，让更多人发现
- 🐛 提 Issue / PR 参与共建
- ☕ 通过 **GitHub Sponsors** 支持持续维护（入口见仓库 Sponsor 按钮）
- 🏢 企业版需求（私有部署、定制技能、SLA 支持）：请通过 GitHub Issues 联系维护者。

---

## 📚 文档与治理

信任资产与配套文档已随仓库分发，参与共建前请过目：

- [CONTRIBUTING.md](CONTRIBUTING.md) —— 环境搭建、开发流程、代码规范、技能编写入口
- [docs/authoring-skills.md](docs/authoring-skills.md) —— 如何编写一个被自动发现的技能
- [SECURITY.md](SECURITY.md) —— 漏洞私有上报渠道与安全设计默认值
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) —— 社区行为准则（Contributor Covenant 2.1）
- [CHANGELOG.md](CHANGELOG.md) —— 版本变更记录
- `.github/` —— Issue / PR 模板与 CI 工作流

---

## 📄 许可证

[MIT](LICENSE) —— 可自由使用、修改、分发，包括商业用途。

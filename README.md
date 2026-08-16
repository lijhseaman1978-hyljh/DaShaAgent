# DaSha Agent · 大沙智能体

> 一个**完全属于你自己的智能体运行底座** —— LLM、工具、记忆、会话、技能、多智能体编排全部解耦成可插拔模块。Node.js + TypeScript，**默认本地 Ollama，零额外成本、数据不出本机**。内置可联网安装的**技能市场（Marketplace）**，是它与多数开源 Agent 框架最不一样的地方。

English: DaSha Agent is a self-hosted, modular agent OS. Local-first by default (Ollama), pluggable tools/memory/skills, with a built-in skill marketplace.

---

## ⚡ Quick Start · 3 分钟跑起来

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

## ✨ Features · 能力矩阵

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

## 🏗️ Architecture · 架构

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

## ⚙️ Configuration · 配置

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
| `SANDBOX_ENABLED` | `true` | 沙箱隔离（接入真实沙箱前仅为声明） |

---

## 📦 Project Structure · 目录结构

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

## 🧪 Development · 开发与测试

```bash
npm run typecheck     # TypeScript 类型检查（零错误目标）
npm test              # 确定性端到端测试（MockProvider，无需联网）
npm run dev           # 热重载启动（开发用）
```

新增技能：在 `server/src/skills/builtin/` 下按 `SKILL.md` 规范创建目录即可被自动发现；社区技能通过技能市场分发。

---

## 🤝 Community & Trust Assets · 社区与信任资产

- **示例 Agent / 技能**：`server/src/skills/builtin/` 内置一批通用示例技能（调试、OCR、记忆框架、研究、GitHub 等），可作为你自己的起点。
- **教程与用例**：文档与用例视频正在持续补充，欢迎在 Discussions 提出你想看的场景。
- **GitHub Discussions**：提问、建议、晒用例的主阵地。
- **Discord**：实时交流频道（链接见仓库 About / 置顶）。

> 我们坚持「先信任、后变现」：先让项目能跑、文档齐全、社区活跃，再谈商业化。

---

## 💖 Support & Sponsors · 支持与赞助

如果 DaSha Agent 对你有帮助，欢迎：

- ⭐ 在 GitHub 上 Star，让更多人发现
- 🐛 提 Issue / PR 参与共建
- ☕ 通过 **GitHub Sponsors** 支持持续维护（入口见仓库 Sponsor 按钮）
- 🏢 企业版需求（私有部署、定制技能、SLA 支持）请联系 <your-enterprise-contact@example.com>

---

## 📄 License

[MIT](LICENSE) —— 可自由使用、修改、分发，包括商业用途。

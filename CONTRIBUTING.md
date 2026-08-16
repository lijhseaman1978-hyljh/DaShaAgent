# Contributing Guide · 贡献指南

感谢你考虑为 **DaSha Agent** 做贡献！本文档帮助你快速搭建环境、了解协作规范。

## 环境要求
- **Node.js ≥ 20**（CI 使用 Node 22；建议本地保持一致以避免差异）
- **npm**（随 Node 附带）
- 可选：[Ollama](https://ollama.com) 用于本地模型验证（非必须，可用 `mock` provider 跑流程）

## 快速上手
```bash
git clone <your-fork>
cd DaShaAgent
npm install
cp .env.example .env      # 所有项均有安全默认值，可全部留空
npm run typecheck         # TypeScript 零错误目标
npm test                  # 确定性端到端测试（MockProvider，无需联网）
```

## 开发工作流
1. **Fork & Branch**：从 `main` 切出特性分支 `feat/xxx` 或修复分支 `fix/xxx`。
2. **编码**：遵循下方规范。
3. **自检**（提交前必须通过）：
   - `npm run typecheck` —— **0 错误**（项目以零类型为硬目标）。
   - `npm test` —— 全部通过；新增能力请补测试。
4. **提交**：采用 Conventional Commits 风格（`feat:` / `fix:` / `docs:` / `refactor:` / `test:` / `chore:`）。
5. **PR**：在 GitHub 发起 Pull Request，模板见 `.github/PULL_REQUEST_TEMPLATE.md`。

## 代码规范
- **TypeScript 严格模式**：不引入 `any` 逃逸（确有必要时局部 `// eslint-disable` 并注释原因）。
- **模块解耦**：引擎各子系统（core / tools / skills / memory / security …）保持独立，新增代码放在对应目录。
- **不破坏公开接口**：`server/src/unified.ts` 生产入口、REST/gateway 路由签名变更须同步更新文档。
- **生产路径零 CORS**：`web.ts` / `controlRoutes.ts` 不得添加跨域响应头（同源安全边界，见 SECURITY.md）。

## 新增 / 修改技能
技能是 DaSha Agent 的一等公民。编写规范见 **[docs/authoring-skills.md](docs/authoring-skills.md)**。
要点：在 `server/src/skills/builtin/` 下新建目录并放入 `SKILL.md`（frontmatter 含 `name` / `description` / `trigger` / `tags`），loader 会自动发现并注册。

## 测试与 CI
- CI（`.github/workflows/ci.yml`）在 Node 22 上运行 `typecheck` 与 `test` 两个 job。
- 本地未通过的检验不会在 CI 通过；请勿用 `--no-verify` 绕过。
- 端到端测试基于 MockProvider，无需真实 LLM 或联网即可运行。

## 文档
- 用户可见改动（配置项、CLI、技能 API）请同步更新 `README.md` 或相关 `docs/`。
- 中文文档优先，鼓励中英双语。

## 行为准则
参与本项目即表示你同意遵守 **[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)**。

---

有问题？来 **GitHub Discussions** 聊聊，或提 Issue。安全相关问题请走 **[SECURITY.md](SECURITY.md)** 私有渠道。

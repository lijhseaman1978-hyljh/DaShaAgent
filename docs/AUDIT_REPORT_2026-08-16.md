# DaShaAgent 全盘安全 / 质量审计报告

> 审计时间：2026-08-16　|　审计对象：`D:\DaShaAgent`（三阶段开源 · 阶段一、二已完成，待阶段三）
> 审计范围：脱敏、安全配置（CORS/控制面/沙箱）、编译测试、运行时冒烟、前端 i18n、文档与 git 整洁度

---

## 一、结论速览

| 维度 | 结论 | 本轮动作 |
|------|------|----------|
| 脱敏 | 仅 1 处真实风险（已修），其余为占位符 | 已于前序修复 |
| 安全配置 | 生产入口**安全**（本机绑定/零 CORS/密钥脱敏/穿越防护） | 本轮补全文档与遗留面警示 |
| 编译测试 | `tsc --noEmit` 0 错误；`npm test` 12/12 通过 | 前序已修复 mock 截断 |
| 运行时 | `/`、`/api/health`、`/api/marketplace/categories`、`/marketplace` 均 200 | 前序冒烟已验证 |
| 前端 i18n | 全站去掉硬编码中文，分类按钮双语跟随语言 | 前序已完成 |
| 文档/git | 发现 3 类隐患 | **本轮已修复** |

**总评**：代码已达到可对外发布的安全水位。剩余项均为「说明/文档/提交规划」级别，无阻断性 bug。

---

## 二、安全配置复核（任务 #331）

### ✅ 生产入口 `unified.ts`（`npm start`）—— 安全

- **绑定地址**：`gateway/web.ts:647` 默认 `127.0.0.1`，不监听 `0.0.0.0`；仅当显式 `AH_LAN=1`/`AH_BIND_HOST` 才暴露局域网。
- **CORS**：生产路径（`web.ts` + `api/controlRoutes.ts`）**不设任何 CORS 头**，纯同源安全模型。
- **密钥脱敏**：`safeConfig()` 把 `cloud.key`、各 `customModels[].key` 回显为 `***`，不泄露到前端。
- **路径穿越防护**：静态文件、`/uploads/`、Dashboard、技能删除等 6 处均有 `decodeURIComponent` + `path.resolve` + `startsWith(base+sep)` 三重防护。
- **畸形 URI 防崩溃**：`safeDecodeComponent()` 捕获 `URIError`，避免被 crashHandlers 放大为进程退出（DoS）。
- **危险命令闸**：`secure_shell` 先过 `security.guard()`（Permission→ThreatDetect→Monitor），再跑进 **Docker 容器**（`SandboxExecutor` + Kill Switch 超时），真实隔离。
- **`/api/admin/restart`**：需 `checkAdminToken` + 来源地址校验（非 `127.0.0.1` 拒绝）。

### ⚠️ 遗留控制面 `controlServer.ts`（`npm run control` / `npm run os`）—— 已脱离生产路径，但需警示

- **现状**：`unified.ts` **未引用** `controlServer`；仅 `control.ts` 与 `kernel/runtime.ts` 自检方法（port:0）引用。即 `npm start` 不会拉起它。
- **风险**：该文件是 Express + `cors` 的并行控制面，含**未鉴权**端点 `/api/agent/kill`、`/api/agent/reset`、`/api/webhook/message`（直接执行任务）。若有人用 `npm run control` 且开了 `AH_LAN`，等于把未鉴权的「杀进程/执行任务」暴露到局域网。
- **处置**：已在 README 明确标注其为「演示/遗留控制面，仅限本机调试」，不计入发布安全面。

### ✅ 危险代码模式扫描

- 全仓**无** `eval(` / `new Function(`。
- `child_process` 均为受控使用：`execFile`（shell 工具显式指定 shell，避免注入）、`spawn`（xlsx/script/office）、`execSync`（进程存活探测）。无来自用户输入的危险拼接。

### 📝 备注（非阻断）

- `run_code` 受 `SANDBOX_ENABLED` 总开关约束，过 ThreatDetector 后**在宿主机**执行（非 Docker 隔离）。命名上 `sandbox` 易让人误以为是容器隔离——已在 README 如实说明「本质是在你机器上运行代码」。功能上合理（本地可信环境 + 威胁拦截），但对外发布时务必讲清。

---

## 三、本轮已修复的高价值问题（任务 #332）

### 修复 1 · `.gitignore` 补漏（防 `git add .` 泄漏运行时数据）　【P1】

`data/` 当前为未跟踪，但原 `.gitignore` 漏了 7 个派生状态，一旦 `git add -A` 会把**会话日志/已安装插件**扫进仓库：

| 已补忽略项 | 风险 |
|-----------|------|
| `data/crash/` `data/evolution/` | 运行时错误/技能注册态 |
| `data/marketplace/` `data/plugins/` | 已安装社区技能与用户命令插件 |
| `data/feedback_log.jsonl` `data/intentions.jsonl` `data/user-model.json` | 行为日志/用户画像 |

已用 `git check-ignore` 验证 7 项全部命中 IGNORED。

### 修复 2 · `README.md` 新增「🔒 安全与暴露」章节　【P1】

补齐此前缺失的局域网暴露警示：默认仅本机、勿裸开 `AH_LAN`、`run_code` 为宿主执行、`npm run control`/`os` 为 demo、Key 已脱敏。

### 修复 3 · `docs/authoring-skills.md` 分类对齐　【P2】

文档原示例 `category: desktop` 及 `github/` 分类目录，与 loader 实际的 8 个标准中文分类（`文档/写作`/`图像/视频`/`代码/开发`/`研究/数据`/`效率/自动化`/`系统/文件`/`社交/通讯`/`其他`）不一致——按旧文档写技能会被错分或归入「其他」。已：
- 明确 8 个标准分类取值约定；
- 示例 `category: desktop` → `category: 系统/文件`；
- 澄清 `github/` 是分组目录而非分类值。

### 修复 4 · `package.json` 加 `"private": true`　【P2】

防止误执行 `npm publish` 把内部仓库推到公共 registry。已用 `node` 校验 JSON 合法。

---

## 四、遗留 / P3 项（不影响发布，建议跟进）

1. **`dashboard/` 子项目未纳入核心构建**：它有自己的 `package-lock.json`，根 `package.json` 无 workspaces 关联，且 `dashboard/dist` 当前不存在 → 控制台 `/dashboard` 走降级（不展示）。若阶段三要卖点包含 Dashboard，需补构建步骤或明确「可选」。
2. **全部改动仍未 git 提交**：当前 `git status` 有大量 `M`（README/package.json/web/*/server/* 等）、`D`（已删脏技能）、`??`（data/、docs/、中文技能目录、i18n.js 等）。建议在发布前做一次干净提交，提交信息按「阶段一清理 / 阶段二信任资产 / 阶段三准备」分组。
3. **`run_code` 命名澄清**：见上 §二备注，文档已说明，代码注释亦可加一句。
4. **`package.json` 缺 `repository`/`homepage`**：公开仓库前补上（或保持 `private: true` 即可）。

---

## 五、阶段三（变现入口）就绪度

- 阶段一（能跑+干净）、阶段二（信任资产：SECURITY/CONTRIBUTING/CODE_OF_CONDUCT/CHANGELOG/Issue&PR 模板/`docs/authoring-skills.md`/技能市场双语/分类 i18n）均已完成。
- 安全与质量闸门（脱敏/编译/测试/运行时/i18n/文档/git）本轮已闭环。
- **建议**：先按 §四-2 做一次干净 git 提交并打 tag（如 `v3.0.0-rc1`），再决定是否挂变现入口（如 GitHub Sponsors / 官网 / 付费技能）。

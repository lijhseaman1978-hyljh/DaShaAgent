# Release Notes — v3.0.0-rc1

> 发布到 GitHub Release 的 Description 框时，把下面整段（中英文）直接粘贴即可。

## v3.0.0-rc1 · First Open-Source Release Candidate

> This is a release candidate for early feedback. Once stable, it will be promoted to v3.0.0 (GA).

### ✨ What's Included
- Phase 1: Removed dead skills and unused code; runs directly with `npm install && npm start` (default http://localhost:3001)
- Phase 2: Bilingual README, governance docs (SECURITY / CONTRIBUTING / CODE_OF_CONDUCT / CHANGELOG), Chinese trust-skill assets, full zh/en i18n, security audit
- Phase 3 (lightweight monetization): GitHub Sponsors button, business / private-deployment / custom-skill consulting page, MkDocs docs site

### 🔒 Security
- Production entry binds 127.0.0.1 (same-origin), zero CORS, secrets masked, path-traversal guards
- `secure_shell` runs in real Docker isolation; no `eval` / `new Function` in the codebase

### 📦 How to Get It
- Source code (zip / tar.gz) in the Assets below
- or `git clone https://github.com/lijhseaman1978-hyljh/DaShaAgent.git`

### 📚 Documentation
https://lijhseaman1978-hyljh.github.io/DaShaAgent/

---

## 中文说明

> 这是候选发布版，用于早期反馈。稳定后转正为 v3.0.0。

### ✨ 包含内容
- 阶段一：清理无用技能与死代码，可直接 `npm install && npm start` 运行（默认 http://localhost:3001）
- 阶段二：双语 README、治理文档（SECURITY / CONTRIBUTING / CODE_OF_CONDUCT / CHANGELOG）、中文信任技能资产、全站中英文 i18n、安全审计
- 阶段三（轻量变现）：GitHub Sponsors 按钮、商业合作 / 私有部署 / 定制技能咨询页、MkDocs 文档站

### 🔒 安全
- 生产入口同源绑定 127.0.0.1、零 CORS、密钥脱敏、路径穿越防护
- `secure_shell` 走 Docker 真隔离，全仓无 eval / new Function

### 📦 获取方式
- 下方 Assets 的 Source code (zip / tar.gz)
- 或 `git clone https://github.com/lijhseaman1978-hyljh/DaShaAgent.git`

### 📚 文档
https://lijhseaman1978-hyljh.github.io/DaShaAgent/

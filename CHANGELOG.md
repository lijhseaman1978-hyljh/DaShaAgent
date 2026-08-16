# Changelog · 更新日志

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/) 规范，版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

---

## [3.0.0] — 2026-08-16 · 首次开源

### Added · 新增
- 完全本地优先的智能体运行底座：LLM / 工具 / 记忆 / 会话 / 技能 / 多智能体编排解耦为可插拔模块。
- 单 Agent Loop 流式对话 + 工具调用循环（理解 → 推理 → 规划 → 执行）。
- 两级 / 三级安全护栏：Permission → Threat → Audit。
- 长期记忆（画像 / 笔记 / 向量召回），JSON 持久化，数据不出本机。
- 两阶段技能加载（BM25 匹配 + Schema 按需实例化），支持中文 bigram。
- 内置技能市场（Marketplace）：可联网浏览、安装、更新社区技能。
- 知识库 RAG：放入 `data/knowledge` 即可检索（PDF / txt / md）。
- 多智能体并行编排、定时任务引擎（队列 + 调度 + `triggerNow`）。
- Web 控制台 + WebSocket 流式 + 活动流。
- 可观测层：logger + tracer + metrics + cost + replay。
- 27 个内置示例技能（调试、OCR、记忆框架、研究、GitHub、浏览器、邮件、办公文档等）。
- 中英双语界面与一键切换。

### Changed · 变更
- 生产入口统一为 `server/src/unified.ts`（单端口，默认 3001）。
- 控制面同源部署：出货路径 `web.ts` / `controlRoutes.ts` 不设置 CORS 头，维持同源安全边界。

### Security · 安全
- 移除全部 PII 与私人凭据；`.env` 永久排除于版本库。
- 默认本地 Ollama，无外部数据出站。
- 清理遗留高危 / 调试脚本与空壳目录（`docker/`、`sandbox/`）。

---

[3.0.0]: 首个公开版本，无前一版本可对比。

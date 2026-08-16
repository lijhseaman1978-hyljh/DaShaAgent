# DaShaAgent Dashboard

V3.0 Phase 3 - Step 2：Agent Web UI + Control Center 的前端（React + TypeScript + Vite）。

## 两种前端，二选一

| 方案 | 位置 | 需要构建 | 何时使用 |
|---|---|---|---|
| 内置控制台（零依赖） | `server/src/api/console.html` | 否 | 默认。启动控制面后直接可用 |
| React Dashboard | 本目录 | 是（`npm run build`） | 需要二次开发 / 组件化扩展时 |

Control Server 启动时会检查 `dashboard/dist/index.html`：存在则托管 React 版，否则回落到内置控制台。两版共用同一套 design token，观感一致。

## 开发

```bash
# 终端 1：启动控制面（默认 127.0.0.1:3001）
cd ..
AH_CONTROL_PORT=3001 npm run control

# 终端 2：前端热更新（/api 与 /ws 已配置代理）
cd dashboard
npm install
npm run dev          # http://localhost:5173
```

## 构建并交给控制面托管

```bash
cd dashboard
npm install
npm run build        # 产出 dashboard/dist
cd .. && npm run control   # 访问 http://127.0.0.1:3001 即为 React 版
```

## 组件对照（计划书 §十~§十五）

| 文件 | 计划书章节 | 职责 |
|---|---|---|
| `src/components/AgentCard.tsx` | §十 | Agent 身份 / 状态 / 任务计数 |
| `src/components/TaskPanel.tsx` | §十、§十五 | 派发任务 + 暂停/恢复/终止/复位 |
| `src/components/LogViewer.tsx` | §十一 | WebSocket 实时事件流 |
| `src/components/MemoryPanel.tsx` | §十二 | `GET /api/memory` 记忆快照 |
| `src/components/SkillPanel.tsx` | §十三 | 团队成员与已装技能 |
| `src/hooks/useAgentSocket.ts` | §十一 | WS 连接 + 自动重连 + 环形缓冲 |
| `src/api/client.ts` | §九 | axios 客户端与类型定义 |

## 说明

本目录的 `node_modules` 与根项目隔离，根 `tsconfig.json` 的 `include` 只覆盖 `server/src` 与 `tests`，因此不装前端依赖也不会影响根项目的 `npm run typecheck`。

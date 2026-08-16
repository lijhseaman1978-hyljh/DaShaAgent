// api/controlServer.ts
// V3 Phase 3 - Step 2 §四/§六/§十二/§十五：Agent Control Server。
//   Browser ──HTTP/WS──> Control Server ──> AgentController ──> Agent Core
//
// 棕地说明（关键）：
//   既有 gateway/web.ts 是 V2 生产网关（node:http + ws，30+ 端点，端口 AH_PORT=8787），
//   本文件是并排新增的 Step 2 控制面（Express + ws，端口 AH_CONTROL_PORT=3001），
//   两者互不干扰、可同时运行。生产入口 server.ts 一行未改。
//
// 前端托管策略：
//   1) dashboard/dist 存在（跑过 npm run build）→ 托管 React 构建产物；
//   2) 否则回落到内置零依赖单文件控制台 console.html —— 保证不装前端依赖也能立刻验证。

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import { AgentController, type ControllableRuntime, type AgentControllerOptions } from './agent.controller';
import { agentEventBus } from '../websocket';
import { logger, metrics, tracer, cost, replay } from '../observability';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(HERE, '../../..');

export interface ControlServerOptions extends AgentControllerOptions {
  port?: number;
  host?: string;
  /** 静默启动：不打印横幅（演示场景用） */
  quiet?: boolean;
}

export interface ControlServerHandle {
  port: number;
  url: string;
  controller: AgentController;
  server: http.Server;
  close(): Promise<void>;
}

export function createControlApp(runtime: ControllableRuntime, opts: AgentControllerOptions = {}) {
  const controller = new AgentController(runtime, opts);
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: '2mb' }));

  // ── §四：状态 ──
  app.get('/api/status', (_req, res) => {
    res.json(controller.status());
  });

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, layer: 'control-center', ts: Date.now() });
  });

  // ── §五：提交任务 ──
  app.post('/api/task', async (req, res) => {
    const task = String(req.body?.task ?? '').trim();
    const isAsync = req.body?.async === true;
    try {
      const out = await controller.execute(task, { async: isAsync });
      res.json(out);
    } catch (e: any) {
      res.status(400).json({ error: String(e?.message ?? e) });
    }
  });

  // 对话端点：直连 LLM，不经过 Planner/Executor 管线
  app.post('/api/chat', async (req, res) => {
    const message = String(req.body?.message ?? '').trim();
    if (!message) return res.status(400).json({ error: 'message required' });
    try {
      const history = Array.isArray(req.body?.history) ? req.body.history : [];
      const out = await controller.chat(message, history);
      res.json(out);
    } catch (e: any) {
      res.status(500).json({ error: String(e?.message ?? e) });
    }
  });

  // ── P3: 邮件 Webhook 入口 ──
  // 让外部系统（邮件转发器/IMAP监控/其他服务）通过 HTTP 给 Agent 发任务
  app.post('/api/webhook/message', async (req, res) => {
    const task = String(req.body?.task ?? req.body?.message ?? '').trim();
    const from = String(req.body?.from ?? req.body?.sender ?? 'webhook').trim();
    if (!task) return res.status(400).json({ error: 'task/message required' });
    try {
      const out = await controller.execute(task, { async: true });
      res.json({ ok: true, from, taskId: (out as any)?.id ?? null, accepted: true });
    } catch (e: any) {
      res.status(500).json({ error: String(e?.message ?? e) });
    }
  });

  // 健康检查（webhook 专用）
  app.get('/api/webhook/health', (_req, res) => {
    res.json({ ok: true, service: 'agent-harness-webhook', ts: Date.now() });
  });

  // 模型列表 + 手动切换
  app.get('/api/chat/models', (_req, res) => res.json(controller.listModels()));
  app.post('/api/chat/model', (req, res) => {
    const provider = String(req.body?.provider ?? '').trim();
    if (!provider) return res.status(400).json({ error: 'provider required' });
    res.json(controller.setChatModel(provider));
  });

  // 8787 V2 生产网关代理（仅当 8787 运行时生效）
  app.use('/api/v2', (req, res) => {
    const targetPath = '/api' + req.originalUrl.replace(/^\/api\/v2/, '');
    const proxyReq = http.request({
      hostname: '127.0.0.1',
      port: 8787,
      path: targetPath + ((req.originalUrl || '').includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : ''),
      method: req.method,
      headers: { ...req.headers, host: '127.0.0.1:8787' },
    }, (proxyRes) => {
      res.writeHead(proxyRes.statusCode ?? 200, proxyRes.headers);
      proxyRes.pipe(res);
    });
    proxyReq.on('error', () => {
      res.status(503).json({ error: 'V2 Gateway (port 8787) 未启动。执行 npm start 启动。' });
    });
    if (req.body && Buffer.isBuffer(req.body)) {
      proxyReq.write(req.body);
    }
    proxyReq.end();
  });

  app.get('/api/tasks', (req, res) => {
    res.json(controller.taskList(Number(req.query.limit ?? 20)));
  });

  app.get('/api/tasks/:id', (req, res) => {
    const t = controller.task(req.params.id);
    if (!t) return res.status(404).json({ error: 'task not found' });
    res.json(t);
  });

  // ── §十二：记忆面板 ──
  app.get('/api/memory', (_req, res) => {
    res.json(controller.memorySnapshot());
  });

  app.get('/api/memory/recall', (req, res) => {
    res.json(controller.memoryRecall(String(req.query.q ?? '')));
  });

  // ── §十三：技能 / 团队面板 ──
  app.get('/api/skills', (_req, res) => res.json(controller.skills()));
  app.get('/api/agents', (_req, res) => res.json(controller.agents()));

  // ── §十一：日志（WS 断线时的 HTTP 兜底）──
  app.get('/api/logs', (req, res) => {
    res.json(controller.logs(Number(req.query.limit ?? 100)));
  });

  // ── Phase 3 - Step 3：Observability 端点（监控/日志/追踪/成本/回放）──
  app.get('/api/observability/logs', (req, res) => {
    const q = {
      level: req.query.level as any,
      component: req.query.component as string | undefined,
      since: req.query.since ? Number(req.query.since) : undefined,
      limit: Number(req.query.limit ?? 200),
    };
    res.json({ count: logger.all().length, logs: logger.query(q) });
  });
  app.get('/api/observability/metrics', (_req, res) => res.json(metrics.snapshot()));
  app.get('/api/observability/traces', (req, res) => res.json(tracer.getRoots(Number(req.query.limit ?? 100))));
  app.get('/api/observability/costs', (req, res) => res.json({
    totalTokens: cost.totalTokens(),
    totalCostUsd: cost.totalCost(),
    byProvider: cost.byProvider(),
    recent: cost.recent(Number(req.query.limit ?? 50)),
  }));
  app.get('/api/observability/replay', (req, res) => res.json(replay.all(Number(req.query.limit ?? 100))));
  app.get('/api/observability/replay/:id', (req, res) => {
    const r = replay.find(req.params.id);
    if (!r) return res.status(404).json({ error: 'replay not found' });
    res.json(r);
  });
  app.get('/api/observability/summary', (_req, res) => res.json(controller.observabilitySummary()));
  app.get('/api/observability/timeline', (_req, res) => {
    const spans = tracer.getRoots(50).flatMap((root) => {
      const walk = (s: any, depth = 0): any[] => [
        { at: s.start, type: 'span-start', name: s.name, duration: s.duration, status: s.status, depth, id: s.id },
        ...(s.children ?? []).flatMap((c: any) => walk(c, depth + 1)),
      ];
      return walk(root);
    });
    const recentLogs = logger.query({ limit: 50 });
    const timeline = [
      ...spans,
      ...recentLogs.map((l) => ({ at: l.timestamp, type: 'log', level: l.level, component: l.component, message: l.message })),
    ].sort((a: any, b: any) => a.at - b.at);
    res.json(timeline.slice(-200));
  });

  // ── Phase 3 - Step 4：Workflow Engine 端点（队列 / 调度 / 事件 / 流程）──
  app.get('/api/workflow/status', (_req, res) => res.json(controller.workflowStatus()));
  app.post('/api/workflow/start', (req, res) => {
    try { res.json(controller.workflowStart(req.body ?? {})); }
    catch (e: any) { res.status(400).json({ error: String(e?.message ?? e) }); }
  });
  app.post('/api/workflow/stop', async (_req, res) => {
    try { res.json(await controller.workflowStop()); }
    catch (e: any) { res.status(400).json({ error: String(e?.message ?? e) }); }
  });
  app.get('/api/workflow/tasks', (req, res) => res.json(controller.workflowTasks(Number(req.query.limit ?? 50))));
  app.post('/api/workflow/tasks', (req, res) => {
    try {
      res.json(controller.workflowSubmit(String(req.body?.goal ?? ''), Number(req.body?.priority ?? 0)));
    } catch (e: any) { res.status(400).json({ error: String(e?.message ?? e) }); }
  });
  app.delete('/api/workflow/tasks/:id', (req, res) => {
    try { res.json(controller.workflowCancel(req.params.id)); }
    catch (e: any) { res.status(400).json({ error: String(e?.message ?? e) }); }
  });

  app.get('/api/workflow/workflows', (_req, res) => res.json(controller.workflowList()));
  app.post('/api/workflow/workflows', (req, res) => {
    try { res.json(controller.workflowRegister(req.body)); }
    catch (e: any) { res.status(400).json({ error: String(e?.message ?? e) }); }
  });
  app.post('/api/workflow/workflows/:id/run', async (req, res) => {
    try { res.json(await controller.workflowRun(req.params.id, Number(req.body?.timeoutMs ?? 120_000))); }
    catch (e: any) { res.status(400).json({ error: String(e?.message ?? e) }); }
  });

  app.get('/api/workflow/runs', (req, res) => res.json(controller.workflowRuns(Number(req.query.limit ?? 20))));
  app.get('/api/workflow/runs/:id', (req, res) => {
    const r = controller.workflowRunDetail(req.params.id);
    if (!r) return res.status(404).json({ error: 'run not found' });
    res.json(r);
  });

  // §八：外部事件注入（file.upload / git.push / cpu.high ...）
  app.post('/api/workflow/events', (req, res) => {
    try { res.json(controller.workflowEmit(String(req.body?.event ?? ''), req.body?.data ?? {})); }
    catch (e: any) { res.status(400).json({ error: String(e?.message ?? e) }); }
  });

  // ── Phase 3 - Step 5：Cognitive Memory API（认知记忆查询 / 召回 / 固化）──
  app.get('/api/cognitive/stats', (_req, res) => {
    try { res.json(controller.cognitiveStats()); }
    catch (e: any) { res.status(500).json({ error: String(e?.message ?? e) }); }
  });

  app.get('/api/cognitive/recall', async (req, res) => {
    const q = String(req.query.q ?? '').trim();
    if (!q) return res.status(400).json({ error: 'query required: ?q=...' });
    try { res.json(await controller.cognitiveRecall(q, Number(req.query.k ?? 5))); }
    catch (e: any) { res.status(500).json({ error: String(e?.message ?? e) }); }
  });

  app.post('/api/cognitive/remember', async (req, res) => {
    const { task, result, lesson, tags } = req.body ?? {};
    if (!task) return res.status(400).json({ error: 'body.task required' });
    try { res.json(await controller.cognitiveRemember({ task, result, lesson, tags })); }
    catch (e: any) { res.status(500).json({ error: String(e?.message ?? e) }); }
  });

  app.post('/api/cognitive/consolidate', (_req, res) => {
    try { res.json(controller.cognitiveConsolidate()); }
    catch (e: any) { res.status(500).json({ error: String(e?.message ?? e) }); }
  });

  app.get('/api/cognitive/preview', (_req, res) => {
    try { res.json(controller.cognitivePreview()); }
    catch (e: any) { res.status(500).json({ error: String(e?.message ?? e) }); }
  });

  app.get('/api/cognitive/search', (req, res) => {
    const q = String(req.query.q ?? '').trim();
    if (!q) return res.status(400).json({ error: 'query required: ?q=...' });
    try { res.json(controller.cognitiveSearch(q, Number(req.query.limit ?? 10))); }
    catch (e: any) { res.status(500).json({ error: String(e?.message ?? e) }); }
  });

  app.get('/api/cognitive/skills', (_req, res) => {
    try { res.json(controller.cognitiveSkills()); }
    catch (e: any) { res.status(500).json({ error: String(e?.message ?? e) }); }
  });

  app.get('/api/cognitive/graph', (_req, res) => {
    try { res.json(controller.cognitiveGraph()); }
    catch (e: any) { res.status(500).json({ error: String(e?.message ?? e) }); }
  });

  // ── §十五：Human Override ──
  app.post('/api/agent/pause', (req, res) => res.json(controller.pause(req.body?.reason)));
  app.post('/api/agent/resume', (req, res) => res.json(controller.resume(req.body?.reason)));
  app.post('/api/agent/kill', (req, res) => res.json(controller.kill(req.body?.reason)));
  app.post('/api/agent/reset', (_req, res) => res.json(controller.reset()));

  // ── 前端托管 ──
  const dist = path.join(PROJECT_ROOT, 'dashboard', 'dist');
  const hasDist = fs.existsSync(path.join(dist, 'index.html'));
  if (hasDist) {
    app.use(express.static(dist));
  }
  const fallback = path.join(HERE, 'console.html');
  app.get(/^\/(?!api\/).*/, (_req, res) => {
    if (hasDist) return res.sendFile(path.join(dist, 'index.html'));
    if (fs.existsSync(fallback)) return res.sendFile(fallback);
    res.status(404).send('dashboard 未构建：cd dashboard && npm install && npm run build');
  });

  return { app, controller, hasDist };
}

export async function startControlServer(
  runtime: ControllableRuntime,
  opts: ControlServerOptions = {}
): Promise<ControlServerHandle> {
  const port = opts.port ?? Number(process.env.AH_CONTROL_PORT || 3001);
  const host = opts.host ?? '127.0.0.1';
  const { app, controller, hasDist } = createControlApp(runtime, opts);

  const server = http.createServer(app);

  // ── §六：WebSocket 实时通道 ──
  const wss = new WebSocketServer({ server, path: '/ws' });
  agentEventBus.bridgeKernelEvents();
  wss.on('connection', (ws) => {
    agentEventBus.connect(ws);
    try { ws.send(JSON.stringify({ type: 'connected', data: controller.status(), timestamp: Date.now() })); } catch { /* 客户端可能瞬断 */ }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', (err: NodeJS.ErrnoException) => {
      // 端口冲突是最常见的启动失败；给一句人话，别丢一坨 stack
      if (err.code === 'EADDRINUSE') {
        reject(
          new Error(
            `端口 ${port} 已被占用。换端口：AH_CONTROL_PORT=3002 npm run control（V2 生产网关默认占用 AH_PORT=8787）`
          )
        );
        return;
      }
      reject(err);
    });
    server.listen(port, host, () => resolve());
  });

  // port 传 0 时由系统分配，必须回读真实端口（演示/测试常用，避免与生产网关抢端口）
  const addr = server.address();
  const actualPort = typeof addr === 'object' && addr ? addr.port : port;
  const url = `http://${host}:${actualPort}`;
  if (!opts.quiet) {
    console.log(`[ControlCenter] ${url}  (WS ${url.replace('http', 'ws')}/ws)  frontend=${hasDist ? 'dashboard/dist' : 'builtin console'}`);
  }

  return {
    port: actualPort,
    url,
    controller,
    server,
    close: () =>
      new Promise<void>((resolve) => {
        for (const c of wss.clients) { try { c.close(); } catch { /* ignore */ } }
        wss.close(() => server.close(() => resolve()));
      }),
  };
}

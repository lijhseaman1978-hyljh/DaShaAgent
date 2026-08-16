// server/src/api/controlRoutes.ts
// 控制台专属路由（2026-08-13 R7：从 unified.ts 的 beforeRoutes 注入块提取）
// 行为与原来完全等价：Dashboard 静态文件、可观测性 API、Admin/Restart、
// Agent 控制、四层自进化 API、Workflow Engine API。
// unified.ts 只负责装配（createControlRoutes + 传入依赖）。

import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { CONFIG } from '../config/system';

// ── 辅助：HTTP 响应 ──
function json200(res: http.ServerResponse, obj: any) {
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}
function jsonErr(res: http.ServerResponse, code: number, msg: string) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ error: msg }));
}
function serveStaticFile(res: http.ServerResponse, filePath: string, mimeType: string) {
  try {
    const data = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': mimeType, 'Cache-Control': 'no-store' });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
}
async function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk: Buffer) => (body += chunk.toString()));
    req.on('end', () => resolve(body));
  });
}

export interface ControlRoutesOptions {
  /** AgentController（控制面） */
  ctrl: any;
  /** observability metrics 单例 */
  metrics: any;
  /** observability logger 单例 */
  logger: any;
  /** observability tracer 单例 */
  tracer: any;
  /** dashboard/dist 绝对路径 */
  dashDir: string;
  /** dashboard 是否已构建 */
  hasDash: boolean;
}

/**
 * 构建控制台路由处理器（unified.ts 传入 startGateway 的 beforeRoutes）。
 * 返回 true = 已处理（跳过 Gateway 主路由）；false = 交给 Gateway。
 */
export function createControlRoutes(opts: ControlRoutesOptions) {
  const { ctrl, metrics: v3metrics, logger: v3logger, tracer: v3tracer, dashDir: DASH_DIR, hasDash } = opts;

  return (req: http.IncomingMessage, res: http.ServerResponse): boolean => {
    const url = (req.url || '/').split('?')[0];

    // Dashboard 静态文件
    if (hasDash && (url === '/dashboard' || url.startsWith('/dashboard/'))) {
      const sub = url.replace(/^\/dashboard\/?/, '') || 'index.html';
      // P4 SECURITY-FIX: 防目录穿越（../ 跳出 dashboard/dist）
      let decodedSub: string;
      try { decodedSub = decodeURIComponent(sub); } catch { jsonErr(res, 400, 'bad request'); return true; }
      decodedSub = decodedSub.replace(/\\/g, '/');
      const normalized = path.normalize(decodedSub);
      if (normalized.startsWith('..') || normalized.includes('../')) {
        jsonErr(res, 403, 'forbidden');
        return true;
      }
      const fp = path.join(DASH_DIR, normalized);
      const ext = path.extname(fp).toLowerCase();
      const mimeMap: Record<string, string> = {
        '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
        '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.png': 'image/png',
      };
      serveStaticFile(res, fp, mimeMap[ext] || 'application/octet-stream');
      return true;
    }

    // 可观测性 API
    if (req.method === 'GET' && url === '/api/cognitive/stats') {
      try { json200(res, ctrl.cognitiveStats()); } catch (e: any) { jsonErr(res, 500, e?.message); }
      return true;
    }
    if (req.method === 'GET' && url === '/api/observability/summary') {
      json200(res, ctrl.observabilitySummary());
      return true;
    }
    if (req.method === 'GET' && url === '/api/observability/metrics') {
      json200(res, v3metrics.snapshot());
      return true;
    }
    if (req.method === 'GET' && url === '/api/observability/traces') {
      json200(res, v3tracer.getRoots(100));
      return true;
    }
    if (req.method === 'GET' && url === '/api/observability/logs') {
      json200(res, { count: v3logger.all().length, logs: v3logger.query({ limit: 200 }) });
      return true;
    }
    if (req.method === 'GET' && url === '/api/status') {
      json200(res, ctrl.status());
      return true;
    }

    // ── 健康检查告警（心跳廉价版自检落盘 health_alerts.jsonl） ──
    if (req.method === 'GET' && url === '/api/health/alerts') {
      try {
        const urlObj = new URL(req.url || '/', 'http://localhost');
        const limit = Math.min(parseInt(urlObj.searchParams.get('limit') || '300', 10) || 300, 2000);
        const file = path.join(CONFIG.DATA_DIR, 'health_alerts.jsonl');
        if (!fs.existsSync(file)) { json200(res, { count: 0, total: 0, alerts: [] }); return true; }
        const lines = fs.readFileSync(file, 'utf-8').split('\n').map(s => s.trim()).filter(Boolean);
        const alerts = [];
        for (let i = lines.length - 1; i >= 0 && alerts.length < limit; i--) {
          try { alerts.push(JSON.parse(lines[i])); } catch { /* skip malformed line */ }
        }
        json200(res, { count: alerts.length, total: lines.length, alerts });
      } catch (e: any) { jsonErr(res, 500, e?.message); }
      return true;
    }

    // ── Admin / Remote Restart API ──
    if (req.method === 'POST' && url === '/api/admin/restart') {
      readBody(req).then(async b => {
        try {
          const body = JSON.parse(b || '{}');
          const { executeRestart, checkAdminToken } = await import('./adminRestart');
          const ra = req.socket.remoteAddress || '';
          const remote = ra !== '127.0.0.1' && ra !== '::1' && ra !== '::ffff:127.0.0.1';
          const auth = checkAdminToken(String(body.token ?? ''), remote);
          if (!auth.ok) { jsonErr(res, 403, auth.reason || 'forbidden'); return; }
          json200(res, await executeRestart({
            token: body.token,
            delaySec: Number(body.delaySec ?? 5),
            force: body.force === true,
            dryRun: body.dryRun === true,
            message: body.message,
          }));
        } catch (e: any) { jsonErr(res, 500, e?.message); }
      });
      return true;
    }
    if (req.method === 'GET' && url === '/api/admin/restart/status') {
      (async () => {
        try {
          const { winrmAvailable } = await import('./adminRestart');
          json200(res, {
            winrm: await winrmAvailable(),
            sshd: false,
            target: process.env.AH_RESTART_TARGET || '127.0.0.1',
            adminTokenConfigured: Boolean(process.env.AH_ADMIN_TOKEN),
          });
        } catch (e: any) { jsonErr(res, 500, e?.message); }
      })();
      return true;
    }

    // Agent 控制
    if (req.method === 'POST' && url === '/api/agent/pause') {
      readBody(req).then(b => {
        try { json200(res, ctrl.pause(JSON.parse(b || '{}').reason)); }
        catch (e: any) { jsonErr(res, 500, e?.message); }
      });
      return true;
    }
    if (req.method === 'POST' && url === '/api/agent/resume') {
      readBody(req).then(b => {
        try { json200(res, ctrl.resume(JSON.parse(b || '{}').reason)); }
        catch (e: any) { jsonErr(res, 500, e?.message); }
      });
      return true;
    }

    // ── 四层自进化 API（Tier 3+4） ──
    if (req.method === 'GET' && url === '/api/self-improve/pattern-check') {
      import('../self-improve').then(({ runPatternCheck }) => {
        try { json200(res, runPatternCheck()); }
        catch (e: any) { jsonErr(res, 500, e?.message); }
      });
      return true;
    }
    if (req.method === 'GET' && url === '/api/self-improve/regression') {
      import('../self-improve').then(async ({ runRegressionCheck, formatRegressionSummary }) => {
        try {
          const results = await runRegressionCheck();
          json200(res, { results, summary: formatRegressionSummary(results) });
        } catch (e: any) { jsonErr(res, 500, e?.message); }
      });
      return true;
    }
    if (req.method === 'GET' && url === '/api/self-improve/rules') {
      import('../self-improve').then(({ extractActiveRules }) => {
        try { json200(res, { rules: extractActiveRules(20) }); }
        catch (e: any) { jsonErr(res, 500, e?.message); }
      });
      return true;
    }

    // ── Workflow Engine API ──
    if (req.method === 'GET' && url === '/api/workflow/status') {
      try { json200(res, ctrl.workflowStatus()); } catch (e: any) { jsonErr(res, 500, e?.message); }
      return true;
    }
    if (req.method === 'POST' && url === '/api/workflow/start') {
      readBody(req).then(b => {
        try { json200(res, ctrl.workflowStart(b ? JSON.parse(b) : {})); }
        catch (e: any) { jsonErr(res, 400, e?.message); }
      });
      return true;
    }
    if (req.method === 'POST' && url === '/api/workflow/stop') {
      (async () => {
        try { json200(res, await ctrl.workflowStop()); }
        catch (e: any) { jsonErr(res, 400, e?.message); }
      })();
      return true;
    }
    if (req.method === 'GET' && url === '/api/workflow/tasks') {
      const urlObj = new URL(req.url || '/', 'http://localhost');
      const limit = parseInt(urlObj.searchParams.get('limit') || '50');
      try { json200(res, ctrl.workflowTasks(limit)); } catch (e: any) { jsonErr(res, 500, e?.message); }
      return true;
    }
    if (req.method === 'POST' && url === '/api/workflow/tasks') {
      readBody(req).then(b => {
        try { json200(res, ctrl.workflowSubmit(String(JSON.parse(b || '{}').goal ?? ''), Number(JSON.parse(b || '{}').priority ?? 0))); }
        catch (e: any) { jsonErr(res, 400, e?.message); }
      });
      return true;
    }
    if (req.method === 'DELETE' && url.startsWith('/api/workflow/tasks/')) {
      const taskId = url.slice('/api/workflow/tasks/'.length);
      try { json200(res, ctrl.workflowCancel(taskId)); } catch (e: any) { jsonErr(res, 400, e?.message); }
      return true;
    }
    if (req.method === 'GET' && url === '/api/workflow/workflows') {
      try { json200(res, ctrl.workflowList()); } catch (e: any) { jsonErr(res, 500, e?.message); }
      return true;
    }
    if (req.method === 'POST' && url === '/api/workflow/workflows') {
      readBody(req).then(b => {
        try { json200(res, ctrl.workflowRegister(JSON.parse(b || '{}'))); }
        catch (e: any) { jsonErr(res, 400, e?.message); }
      });
      return true;
    }
    if (req.method === 'POST' && url.startsWith('/api/workflow/workflows/') && url.endsWith('/run')) {
      const wfId = url.slice('/api/workflow/workflows/'.length, -4);
      readBody(req).then(async b => {
        try { json200(res, await ctrl.workflowRun(wfId, Number(JSON.parse(b || '{}').timeoutMs ?? 120000))); }
        catch (e: any) { jsonErr(res, 400, e?.message); }
      });
      return true;
    }
    if (req.method === 'GET' && url === '/api/workflow/runs') {
      const urlObj = new URL(req.url || '/', 'http://localhost');
      const limit = parseInt(urlObj.searchParams.get('limit') || '20');
      try { json200(res, ctrl.workflowRuns(limit)); } catch (e: any) { jsonErr(res, 500, e?.message); }
      return true;
    }
    if (req.method === 'GET' && url.startsWith('/api/workflow/runs/')) {
      const runId = url.slice('/api/workflow/runs/'.length);
      const detail = ctrl.workflowRunDetail(runId);
      if (!detail) { jsonErr(res, 404, 'run not found'); } else { json200(res, detail); }
      return true;
    }
    if (req.method === 'POST' && url === '/api/workflow/events') {
      readBody(req).then(b => {
        try { json200(res, ctrl.workflowEmit(String(JSON.parse(b || '{}').event ?? ''), JSON.parse(b || '{}').data ?? {})); }
        catch (e: any) { jsonErr(res, 400, e?.message); }
      });
      return true;
    }

    return false; // 交给 Gateway 主路由
  };
}

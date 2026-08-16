import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { CONFIG, ensureDir } from '../config';
import type { Provider } from '../core/types';
import { AgentLoop } from '../core/agentLoop';
import { TeamRunner } from '../team/runner';
import { Scheduler } from '../scheduler';
import { MemoryManager } from '../memory';
import { RAG } from '../rag';
import { ModelManager } from '../models';
import { sessions } from '../core/session';
import { runtime } from '../runtime';
import { getSkills, addSkill, removeSkill } from '../skills/loader';
import { registry } from '../tools/registry';
import { addCustomPlugin, removeCustomPlugin, getCustomPlugins } from '../tools/custom';
import type { HealthResponse } from '../core/apiTypes';

export interface AppDeps {
  provider: Provider;
  memory: MemoryManager;
  rag: RAG;
  loop: AgentLoop;
  team: TeamRunner;
  scheduler: Scheduler;
  // 可选：未传时内部按 `deps.modelManager ?? new ModelManager()` 兜底（见 105/362 行），
  // 类型此前误标为必填，与实际运行契约不一致。
  modelManager?: ModelManager;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const startedAt = Date.now(); // P2-4: uptime 追踪
let lastProviderLatency = -1; // P2-4: 最近一次 provider 延迟

function json(res: http.ServerResponse, code: number, obj: any) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

/** P0-1b: API 密钥脱敏 — 避免 config 中的密钥通过 REST API 泄露 */
function safeConfig(cfg: any) {
  if (!cfg) return cfg;
  const safe = JSON.parse(JSON.stringify(cfg));
  if (safe.cloud?.key) safe.cloud.key = '***';
  if (Array.isArray(safe.customModels)) {
    safe.customModels = safe.customModels.map((m: any) => ({
      ...m,
      key: m.key ? '***' : undefined,
    }));
  }
  return safe;
}

/* ---------- 上传相关：multipart 解析 + 文件类型判定 ---------- */
const MAX_UPLOAD = 500 * 1024 * 1024; // 500MB 上限

function fileKind(mime: string, name: string): string {
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'].includes(ext) || mime.startsWith('image/')) return 'image';
  if (['mp4', 'mov', 'webm', 'mkv', 'avi'].includes(ext) || mime.startsWith('video/')) return 'video';
  if (['mp3', 'wav', 'ogg', 'm4a', 'flac'].includes(ext) || mime.startsWith('audio/')) return 'audio';
  if (ext === 'pdf') return 'pdf';
  if (['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp'].includes(ext)) return 'office';
  if (['txt', 'md', 'json', 'csv', 'tsv', 'xml', 'log', 'yaml', 'yml', 'ini', 'toml', 'html', 'htm', 'css', 'js', 'jsx', 'ts', 'tsx', 'py', 'java', 'c', 'cpp', 'h', 'go', 'rs', 'sh', 'bat', 'ps1', 'sql', 'tex', 'rb', 'php', 'vue'].includes(ext)) return 'text';
  return 'other';
}

// 极简 multipart/form-data 解析（单文件字段 "file" + 可选字段）
function parseMultipart(buf: Buffer, contentType: string): { fields: Record<string, string>; file?: { filename: string; mime: string; data: Buffer } } {
  const b = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType);
  if (!b) return { fields: {} };
  const boundary = b[1] || b[2];
  const sep = Buffer.from('--' + boundary);
  const fields: Record<string, string> = {};
  let file: { filename: string; mime: string; data: Buffer } | undefined;
  let start = buf.indexOf(sep);
  if (start < 0) return { fields };
  start += sep.length;
  while (true) {
    if (buf[start] === 0x2d && buf[start + 1] === 0x2d) break; // "--" 结束标记
    if (buf[start] === 0x0d && buf[start + 1] === 0x0a) start += 2;
    const nextSep = buf.indexOf(sep, start);
    const headerEnd = buf.indexOf(Buffer.from('\r\n\r\n'), start);
    if (headerEnd < 0) break;
    try {
      const headerStr = buf.slice(start, headerEnd).toString('utf8');
      const bodyStart = headerEnd + 4;
      const bodyEnd = (nextSep < 0 ? buf.length : nextSep) - 2;
      const body = buf.slice(bodyStart, Math.max(bodyStart, bodyEnd));
      const cd = /Content-Disposition:[^\r\n]*/i.exec(headerStr);
      const nameM = /name="([^"]+)"/i.exec(cd ? cd[0] : '');
      const fileM = /filename="([^"]*)"/i.exec(cd ? cd[0] : '');
      const mimeM = /Content-Type:\s*([^\r\n]+)/i.exec(headerStr);
      const name = nameM ? nameM[1] : '';
      if (fileM) {
        if (!file) file = { filename: fileM[1], mime: mimeM ? mimeM[1].trim() : 'application/octet-stream', data: body };
      } else {
        fields[name] = body.toString('utf8');
      }
    } catch {
      // 单个 part 畸形不中断整体解析，跳过继续
    }
    if (nextSep < 0) break;
    start = nextSep + sep.length;
  }
  return { fields, file };
}

function mimeOf(fp: string): string {
  const ext = path.extname(fp).toLowerCase();
  return MIME[ext] || 'application/octet-stream';
}

export function startGateway(port: number, deps: AppDeps, opts?: {
  /** 在主路由之前执行的自定义处理器。返回 true 表示已处理，跳过后续 gateway 路由。 */
  beforeRoutes?: (req: http.IncomingMessage, res: http.ServerResponse) => boolean | void;
}) {
  const WEB_DIR = path.join(CONFIG.ROOT, 'web');
  const mm = deps.modelManager ?? new ModelManager();

  const server = http.createServer(async (req, res) => {
    // ── beforeRoutes 钩子：上层（unified.ts）注入专属路由 ──
    if (opts?.beforeRoutes && opts.beforeRoutes(req, res)) return;

    const url = (req.url || '/').split('?')[0];

    // P2-3: /api/v1/* → /api/* 透明代理，保持向后兼容
    const resolvedUrl = url.startsWith('/api/v1/') ? url.replace('/api/v1/', '/api/') : url;

    // ---- Webhook 入口（P3：外部系统给 Agent 发任务）----
    if (req.method === 'GET' && resolvedUrl === '/api/webhook/health') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, service: 'agent-harness-webhook', ts: Date.now() }));
      return;
    }
    if (req.method === 'POST' && resolvedUrl === '/api/webhook/message') {
      let body = '';
      req.on('data', (chunk: Buffer) => { body += chunk.toString('utf8'); });
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body || '{}');
          const task = String(parsed.task ?? parsed.message ?? '').trim();
          const from = String(parsed.from ?? parsed.sender ?? 'webhook').trim();
          if (!task) {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: 'task/message required' }));
            return;
          }
          // 异步执行任务（不阻塞 webhook 响应）
          deps.loop.run({ userInput: task, sessionId: 'webhook_' + Date.now() }).catch(() => {});
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: true, from, task, accepted: true }));
        } catch (e: any) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: String(e?.message || e) }));
        }
      });
      return;
    }

    // ---- REST API ----
    if (req.method === 'GET' && resolvedUrl === '/api/health') {
      // P2-2: ?deep=true → 异步探测 provider 实际延迟
      const qs = (req.url || '').includes('?') ? (req.url || '').split('?')[1] : '';
      const params = new URLSearchParams(qs);
      const deep = params.get('deep') === 'true';

      const mem = process.memoryUsage();
      const h: HealthResponse = {
        ok: true,
        uptime: Math.floor((Date.now() - startedAt) / 1000),
        provider: deps.provider.name,
        providerLatencyMs: lastProviderLatency > 0 ? lastProviderLatency : undefined,
        memory: {
          heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024 * 100) / 100,
          heapTotalMB: Math.round(mem.heapTotal / 1024 / 1024 * 100) / 100,
          rssMB: Math.round(mem.rss / 1024 / 1024 * 100) / 100,
        },
        sessions: sessions.list().length,
        rag: {
          ingested: (deps.rag as any)._ingested || false,
          vectorCount: (deps.rag as any).store?.count?.() ?? 0,
        },
        jobs: deps.scheduler.list().map(j => j.name),
        version: '3.0.0',
      };

      if (deep) {
        // 深度探测：向 provider 发一条轻量 ping
        const start = Date.now();
        try {
          const avail = await deps.provider.isAvailable();
          const lat = Date.now() - start;
          (h as any).providerDeepCheck = {
            available: avail,
            latencyMs: lat,
            testedAt: new Date().toISOString(),
          };
          if (lat > 0) lastProviderLatency = lat;
        } catch (e: any) {
          (h as any).providerDeepCheck = {
            available: false,
            error: String(e?.message || e),
            testedAt: new Date().toISOString(),
          };
        }
      }

      json(res, 200, h);
      return;
    }
    if (req.method === 'GET' && resolvedUrl === '/api/config') {
      json(res, 200, safeConfig(mm.getConfig()));
      return;
    }
    if (req.method === 'GET' && resolvedUrl === '/api/models') {
      const groups = await mm.getModels();
      json(res, 200, { groups, activeModelId: mm.getConfig().activeModelId });
      return;
    }
    if (req.method === 'GET' && resolvedUrl === '/api/sessions') {
      json(res, 200, { sessions: sessions.list() });
      return;
    }
    if (req.method === 'GET' && resolvedUrl === '/api/jobs') {
      json(res, 200, {
        jobs: deps.scheduler.list().map(j => ({ name: j.name, cron: j.cron, prompt: j.prompt, enabled: j.enabled !== false, lastRunAt: j.lastRunAt })),
        results: deps.scheduler.lastResults(),
      });
      return;
    }
    if (req.method === 'GET' && resolvedUrl === '/api/memory') {
      const notes = deps.memory.listNotes().map(name => {
        let preview = '';
        try { preview = fs.readFileSync(path.join(CONFIG.MEMORY_DIR, 'notes', name), 'utf8').slice(0, 400); } catch {}
        return { name, preview };
      });
      json(res, 200, { profile: deps.memory.getProfile(), notes });
      return;
    }
    if (req.method === 'GET' && resolvedUrl === '/api/skills') {
      json(res, 200, getSkills().map(s => ({ name: s.name, description: s.description, trigger: s.trigger })));
      return;
    }
    if (req.method === 'GET' && resolvedUrl === '/api/plugins') {
      const customs = getCustomPlugins();
      const names = new Set(customs.map(c => c.name));
      json(res, 200, {
        tools: registry.list().map(t => ({ name: t.name, description: t.description, custom: names.has(t.name) })),
        custom: customs,
      });
      return;
    }
    if (req.method === 'GET' && resolvedUrl === '/api/logs') {
      json(res, 200, { count: runtime.logs.length, logs: runtime.logs.slice(-300) });
      return;
    }
    if (req.method === 'GET' && resolvedUrl === '/api/metrics') {
      const mem = process.memoryUsage();
      json(res, 200, {
        uptime: process.uptime(),
        startTime: runtime.startTime,
        node: process.version,
        platform: process.platform,
        memory: { rss: mem.rss, heapUsed: mem.heapUsed, heapTotal: mem.heapTotal, external: mem.external },
        wsConnections: runtime.wsConnections,
        config: {
          provider: mm.getConfig().provider,
          activeModelId: mm.getConfig().activeModelId,
          temperature: mm.getConfig().temperature,
        },
      });
      return;
    }
    if (resolvedUrl.startsWith('/api/sessions/') && resolvedUrl.endsWith('/tokens') && req.method === 'GET') {
      const id = resolvedUrl.split('/')[3];
      json(res, 200, sessions.tokenStats(id));
      return;
    }
    if (resolvedUrl === '/api/memory/notes' && req.method === 'GET') {
      const notes = deps.memory.listNoteTopics().map(topic => ({ topic, content: deps.memory.readNote(topic) || '' }));
      json(res, 200, { notes });
      return;
    }
    if (resolvedUrl.startsWith('/api/session/') && req.method === 'GET') {
      const id = resolvedUrl.split('/').pop()!;
      const s = sessions.get(id);
      json(res, s ? 200 : 404, s ? s : { error: 'not found' });
      return;
    }

    // ---- 文件上传（multipart/form-data，单文件字段 file，≤500MB） ----
    // 改进（#8）：请求体边收边落临时文件，不把整文件读进内存（避免 500MB 瞬时占用）。
    if (resolvedUrl === '/api/upload' && req.method === 'POST') {
      try {
        const ct = (req.headers['content-type'] || '') as string;
        if (!ct.includes('multipart/form-data')) { json(res, 400, { error: '需要 multipart/form-data' }); return; }
        const tmp = path.join(CONFIG.DATA_DIR, 'uploads', '.upload_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.tmp');
        ensureDir(path.join(CONFIG.DATA_DIR, 'uploads'));
        let aborted = false;
        await new Promise<void>((resolve, reject) => {
          const ws = fs.createWriteStream(tmp);
          let total = 0;
          req.on('data', (c: Buffer) => {
            total += c.length;
            if (total > MAX_UPLOAD + 2 * 1024 * 1024) { aborted = true; req.destroy(); ws.destroy(); reject(new Error('TOOBIG')); return; }
            ws.write(c);
          });
          req.on('end', () => ws.end(() => resolve()));
          req.on('error', (e) => { ws.destroy(); reject(e); });
          ws.on('error', (e) => { req.destroy(); reject(e); });
        });
        if (aborted) { json(res, 413, { error: '文件超过 500MB 上限' }); try { fs.unlinkSync(tmp); } catch {} return; }
        let parsed: ReturnType<typeof parseMultipart>;
        try {
          const buf = fs.readFileSync(tmp);
          parsed = parseMultipart(buf, ct);
        } catch (e: any) { json(res, 500, { error: '解析失败: ' + e?.message }); try { fs.unlinkSync(tmp); } catch {} return; }
        try { fs.unlinkSync(tmp); } catch {}
        if (!parsed.file) { json(res, 400, { error: '未找到文件字段' }); return; }
        const sess = (parsed.fields.sessionId || 'default').toString().replace(/[^\w-]/g, '');
        const upDir = path.join(CONFIG.DATA_DIR, 'uploads', sess);
        ensureDir(upDir);
        const safe = (parsed.file.filename || ('file_' + Date.now()))
          .replace(/[^\w.\-\u4e00-\u9fa5]+/g, '_').slice(0, 120) || ('file_' + Date.now());
        const fp = path.join(upDir, safe);
        try { fs.writeFileSync(fp, parsed.file.data); } catch (e: any) { json(res, 500, { error: '写入失败: ' + e?.message }); return; }
        const url2 = '/uploads/' + sess + '/' + encodeURIComponent(safe);
        json(res, 200, {
          ok: true, name: safe, path: fp, url: url2, size: parsed.file.data.length,
          mime: parsed.file.mime, kind: fileKind(parsed.file.mime, safe),
        });
        return;
      } catch (e: any) {
        if (e?.message === 'TOOBIG') { json(res, 413, { error: '文件超过 500MB 上限' }); return; }
        json(res, 500, { error: 'upload 异常: ' + (e?.stack || e?.message) });
        return;
      }
    }

    // ---- POST config / custom models ----
    if (req.method === 'POST' || req.method === 'DELETE' || req.method === 'PUT') {
      const body = await readJson(req);
      if (resolvedUrl === '/api/config') {
        if (body.provider) mm.updateConfig({ provider: body.provider });
        if (typeof body.temperature === 'number') mm.setTemperature(body.temperature);
        if (body.activeModelId !== undefined) mm.setActiveModel(body.activeModelId || undefined);
        if (body.ollama) mm.patchOllama(body.ollama);
        if (body.cloud) mm.patchCloud(body.cloud);
        if (body.provider) {
          // 切换主 provider：重建默认 provider 供 team/scheduler 使用
          try {
            const r = await mm.resolveProvider();
            deps.provider = r.provider;
          } catch { /* ignore */ }
        }
        json(res, 200, safeConfig(mm.getConfig()));
        return;
      }
      if (resolvedUrl.startsWith('/api/custom-model')) {
        if (req.method === 'DELETE') {
          const id = resolvedUrl.split('/').pop()!;
          if (!id || id === 'custom-model') { json(res, 400, { error: '缺少模型 id' }); return; }
          mm.removeCustomModel(id);
          json(res, 200, { ok: true });
          return;
        }
        if (req.method === 'PUT') {
          const id = resolvedUrl.split('/').pop()!;
          if (!id || id === 'custom-model') { json(res, 400, { error: '缺少模型 id' }); return; }
          const ok = mm.updateCustomModel(id, body);
          if (!ok) { json(res, 404, { error: '模型不存在' }); return; }
          json(res, 200, { ok: true });
          return;
        }
        if (body && body.id) { mm.addCustomModel(body); json(res, 200, { ok: true }); }
        else json(res, 400, { error: '缺少 id' });
        return;
      }
      if (resolvedUrl === '/api/memory/recall') {
        const q = String(body.query || '').trim();
        if (!q) { json(res, 400, { error: '缺少 query' }); return; }
        const items = await deps.memory.recall(q, 5);
        json(res, 200, { query: q, items });
        return;
      }
      if (resolvedUrl === '/api/memory/note') {
        const topic = String(body.topic || '').trim();
        const content = String(body.content || '');
        if (!topic || !content) { json(res, 400, { error: 'topic 与 content 必填' }); return; }
        const fp = deps.memory.remember(topic, content);
        json(res, 200, { ok: true, path: fp });
        return;
      }
      if (resolvedUrl === '/api/memory/profile') {
        if (typeof body.profile === 'object' && body.profile !== null) {
          const next = deps.memory.setProfile(body.profile);
          json(res, 200, { ok: true, profile: next });
        } else { json(res, 400, { error: 'profile 需为 JSON 对象' }); }
        return;
      }
      if (resolvedUrl === '/api/memory/note/edit') {
        const topic = String(body.topic || '').trim();
        const content = String(body.content ?? '');
        if (!topic) { json(res, 400, { error: 'topic 必填' }); return; }
        const fp = deps.memory.writeNote(topic, content);
        json(res, 200, { ok: true, path: fp });
        return;
      }
      if (resolvedUrl === '/api/memory/note/delete') {
        const topic = String(body.topic || '').trim();
        if (!topic) { json(res, 400, { error: 'topic 必填' }); return; }
        const ok = deps.memory.deleteNote(topic);
        json(res, ok ? 200 : 404, { ok });
        return;
      }
      if (req.method === 'POST' && resolvedUrl === '/api/skills') {
        const name = String(body.name || '').trim();
        if (!name) { json(res, 400, { error: '缺少 name' }); return; }
        const sk = addSkill({ name, description: body.description, trigger: body.trigger, body: body.body });
        json(res, 200, { ok: true, skill: { name: sk.name, dir: sk.dir } });
        return;
      }
      if (req.method === 'DELETE' && resolvedUrl.startsWith('/api/skills/')) {
        const name = safeDecodeComponent(resolvedUrl.split('/').pop() ?? '');
        const ok = removeSkill(name);
        json(res, ok ? 200 : 404, { ok });
        return;
      }
      if (req.method === 'POST' && resolvedUrl === '/api/plugins') {
        const name = String(body.name || '').trim();
        const command = String(body.command || '').trim();
        if (!name || !command) { json(res, 400, { error: 'name 与 command 必填' }); return; }
        const rec = addCustomPlugin({ name, description: body.description || '', command });
        json(res, 200, { ok: true, plugin: rec });
        return;
      }
      if (req.method === 'DELETE' && resolvedUrl.startsWith('/api/plugins/')) {
        const id = safeDecodeComponent(resolvedUrl.split('/').pop() ?? '');
        const ok = removeCustomPlugin(id);
        json(res, ok ? 200 : 404, { ok });
        return;
      }
      if (req.method === 'POST' && resolvedUrl.startsWith('/api/sessions/') && resolvedUrl.endsWith('/rename')) {
        const id = resolvedUrl.split('/')[3];
        const s = sessions.get(id);
        if (!s) { json(res, 404, { error: '会话不存在' }); return; }
        const title = String(body.title || '').trim().slice(0, 80);
        if (!title) { json(res, 400, { error: '标题不能为空' }); return; }
        const ok = sessions.rename(id, title);
        json(res, ok ? 200 : 404, { ok, title });
        return;
      }
      if (req.method === 'POST' && resolvedUrl.startsWith('/api/sessions/') && resolvedUrl.endsWith('/compress')) {
        const id = resolvedUrl.split('/')[3];
        const s = sessions.get(id);
        if (!s) { json(res, 404, { error: '会话不存在' }); return; }
        const history = s.messages.filter(m => ['user', 'assistant'].includes(m.role));
        if (!history.length) { json(res, 400, { error: '没有可压缩的内容' }); return; }
        const historyText = history.map(m => `[${m.role}] ${m.content || ''}`).join('\n\n');
        const sysPrompt = '请将以下对话压缩为一份结构化摘要，保留所有关键事实、决策、用户偏好与未决问题。只输出摘要本身，不要额外解释。';
        // 跟随用户当前选择的模型：优先用请求体里的 modelId 解析对应 Provider，与聊天路径一致；解析失败则回退全局默认 Provider
        const mmLocal = deps.modelManager ?? new ModelManager();
        let provider: any = deps.provider;
        if (body?.modelId) {
          try { const r = await mmLocal.resolveProvider(body.modelId); provider = r.provider; } catch { /* 回退默认 */ }
        }
        console.log('[compress] 使用 Provider:', provider?.name, '| modelId:', body?.modelId || '(未指定→默认)');
        // 模型调用只给 45s：模型不可用/过慢时快速降级本地摘要，避免界面长时间无响应（原 120s 超时实测会卡死前端）
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 45000);
        let summary = '';
        try {
          const resp = await provider.chat({ messages: [{ role: 'system', content: sysPrompt }, { role: 'user', content: historyText }], stream: false, signal: ctrl.signal });
          summary = (resp.content || '').trim();
        } catch { summary = ''; }
        finally { clearTimeout(timer); }
        let fallback = false;
        if (!summary) {
          // 本地兜底摘要：确定性、零依赖，保证「压缩上下文」按钮始终有效
          fallback = true;
          summary = buildLocalSummary(history);
        }
        const ok = sessions.compress(id, summary);
        json(res, 200, { ok, fallback, summary, count: sessions.get(id)?.messages.length });
        return;
      }
      // 创建任务
      if (req.method === 'POST' && resolvedUrl === '/api/jobs') {
        const r = deps.scheduler.addJob({ name: body.name, cron: body.cron, prompt: body.prompt, enabled: body.enabled });
        json(res, r.ok ? 200 : 400, r);
        return;
      }
      if (resolvedUrl.startsWith('/api/jobs/')) {
        const segs = resolvedUrl.split('/'); // ['','api','jobs',<name>,...]
        const name = safeDecodeComponent(segs[3] || '');
        // 编辑任务
        if (segs[4] === 'edit' && req.method === 'POST') {
          const r = deps.scheduler.updateJob(name, { name: body.name, cron: body.cron, prompt: body.prompt, enabled: body.enabled });
          json(res, r.ok ? 200 : 404, r);
          return;
        }
        // 删除任务
        if (req.method === 'DELETE') {
          const r = deps.scheduler.removeJob(name);
          json(res, r.ok ? 200 : 404, r);
          return;
        }
        // 立即运行
        if (req.method === 'POST') {
          const result = await deps.scheduler.triggerNow(name);
          if (result.ok && result.outputPath) {
            try { (result as any).content = fs.readFileSync(result.outputPath, 'utf8').slice(0, 4000); } catch { /* ignore */ }
          }
          json(res, result.ok ? 200 : 500, result);
          return;
        }
      }
      json(res, 404, { error: 'not found' });
      return;
    }

    // ---- 上传文件访问（位于静态目录之外，单独路由） ----
    if (url.startsWith('/uploads/')) {
      const decoded = safeDecodeComponent(url.slice('/uploads/'.length));
      const base = path.resolve(CONFIG.DATA_DIR, 'uploads');
      const fp = path.resolve(base, '.' + path.sep + decoded);
      if (fp !== base && !fp.startsWith(base + path.sep)) { res.writeHead(403); res.end('forbidden'); return; }
      fs.readFile(fp, (err, data) => {
        if (err) { res.writeHead(404); res.end('not found'); return; }
        res.writeHead(200, { 'Content-Type': mimeOf(fp), 'Cache-Control': 'no-store' });
        res.end(data);
      });
      return;
    }

    // ---- 静态文件 ----
    let rel = url === '/' ? '/index.html' : url;
    const decoded = safeDecodeComponent(rel);
    const base = path.resolve(WEB_DIR);
    const fp = path.resolve(base, '.' + path.sep + decoded);
    if (fp !== base && !fp.startsWith(base + path.sep)) { res.writeHead(403); res.end('forbidden'); return; }
    fs.readFile(fp, (err, data) => {
      if (err) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      res.end(data);
    });
  });

  const wss = new WebSocketServer({ server });
  wss.on('connection', (ws: WebSocket) => {
    let busy = false;
    let abort: AbortController | null = null;
    runtime.wsConnections++;
    // 安全加固：连接级错误不应冒泡成未捕获异常（crashHandlers 会 exit(1) 崩进程）
    ws.on('error', () => { /* swallow: 连接异常由上层逻辑处理，不崩进程 */ });
    // 安全加固：仅在连接开放时发送，避免对已关闭 socket 写入抛错
    const send = (obj: unknown) => {
      if (ws.readyState === ws.OPEN) {
        try { ws.send(JSON.stringify(obj)); } catch { /* ignore */ }
      }
    };
    // 显示名：优先用 customModels 的 label，其次 activeModelId，最后兜底 provider.name
    const cfg = deps.modelManager?.getConfig?.();
    let displayName = deps.provider.name;
    if (cfg) {
      const custom = cfg.customModels?.find((m: any) => m.id === cfg.activeModelId);
      displayName = custom?.label || custom?.model || cfg.activeModelId || displayName;
    }
    send({ type: 'ready', provider: displayName });

    ws.on('message', async (raw) => {
      let msg: any;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg.type === 'ping') { send({ type: 'pong' }); return; }
      if (msg.type === 'stop') { if (abort) abort.abort(); return; }
      if (busy) { send({ type: 'busy', message: '上一条还在处理中…' }); return; }
      busy = true;
      abort = new AbortController();
      const signal = abort.signal;
      const sessionId = msg.sessionId || 'default';

      const cb = {
        onToken: (t: string) => send({ type: 'token', text: t }),
        onThought: (t: string) => send({ type: 'thought', text: t }),
        onActivity: (ev: any) => send({ type: 'activity', ev }),
        signal,
      };

      // 解析本次使用的 Provider（模型选择）
      let provider: Provider = deps.provider;
      let temperature = mm.getConfig().temperature;
      if (msg.modelId) {
        try {
          const r = await mm.resolveProvider(msg.modelId);
          provider = r.provider; temperature = r.temperature;
        } catch { /* 回退默认 */ }
      }
      if (typeof msg.temperature === 'number') temperature = msg.temperature;

      try {
        if (msg.type === 'chat') {
          const out = await deps.loop.run({
            userInput: String(msg.content || ''),
            sessionId,
            callbacks: cb,
            temperature,
            provider,
            signal,
            attachments: Array.isArray(msg.attachments) ? msg.attachments : undefined,
          });
          send({ type: 'done', content: out });
        } else if (msg.type === 'team') {
          const results = await deps.team.run(String(msg.task || ''), msg.roles || [], cb);
          const summary = results.map(r => `## ${r.role}\n${r.output}`).join('\n\n');
          send({ type: 'done', content: summary, team: results });
        } else if (msg.type === 'job') {
          const result = await deps.scheduler.triggerNow(String(msg.name), cb);
          send({ type: 'done', content: result.ok ? '任务已完成，输出已写入 ' + result.outputPath : '任务失败: ' + result.error, job: result });
        } else {
          send({ type: 'error', message: '未知消息类型: ' + msg.type });
        }
      } catch (e: any) {
        send({ type: 'error', message: String(e?.message || e) });
      } finally {
        busy = false;
        abort = null;
      }
    });
    ws.on('close', () => { busy = false; if (abort) abort.abort(); if (runtime.wsConnections > 0) runtime.wsConnections--; });
  });

  // 安全加固：默认仅绑回环地址 127.0.0.1，避免裸暴露于局域网/公网被未授权接管。
  // 需要跨机访问时显式设 AH_BIND_HOST=0.0.0.0（或 AH_LAN=1）并接受相应风险。
  const bindHost = process.env.AH_BIND_HOST || (process.env.AH_LAN === '1' ? '0.0.0.0' : '127.0.0.1');
  server.listen(port, bindHost, () => {
    // 端口 0 时是内部代理模式，不打印对外 URL（避免用户误解）
    if (port !== 0) {
      console.log(`[Gateway] Web UI 与 WS 服务已启动： http://${bindHost}:${port}  (ws://${bindHost}:${port}/ws)`);
    } else {
      console.log(`[Gateway] Internal proxy started (port auto-assigned)`);
    }
  });
  return server;
}

// 安全加固：decodeURIComponent 遇畸形 % 序列会抛 URIError，被 crashHandlers 放大为进程崩溃（DoS）。
// 统一走此函数，失败时返回空串，由下游路径安全 403/404，不再崩进程。
function safeDecodeComponent(input: string): string {
  try { return decodeURIComponent(input); } catch { return ''; }
}

async function readJson(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); } catch { resolve({}); }
    });
  });
}

// 本地兜底摘要：当模型不可用/超时时，确定性地把历史压缩为每轮要点预览，零外部依赖，保证「压缩上下文」按钮始终有效。
function buildLocalSummary(messages: { role: string; content?: any }[]): string {
  const lines: string[] = [];
  for (const m of messages) {
    const text = String(m.content || '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const preview = text.length > 120 ? text.slice(0, 120) + '…' : text;
    lines.push(`[${m.role}] ${preview}`);
  }
  return `【对话摘要（本地生成·模型暂不可用）】以下为压缩前 ${messages.length} 条消息的要点：\n` + (lines.join('\n') || '(空)');
}

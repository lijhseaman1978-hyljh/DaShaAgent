// dashboard/src/api/client.ts
// V3 Phase 3 - Step 2 §九：前端 API 客户端（计划书用 axios）。
// baseURL 留空 → 生产由 Control Server 同源托管；dev 由 vite proxy 转发。

import axios from 'axios';

export const http = axios.create({ baseURL: '', timeout: 120_000 });

export interface AgentStatus {
  name: string;
  version: string;
  booted: boolean;
  state: 'idle' | 'busy';
  control: 'running' | 'paused' | 'killed';
  currentTask: { id: string; task: string } | null;
  tasks: { total: number; running: number; completed: number; failed: number };
  wsClients: number;
  uptimeMs: number;
}

export interface TaskRecord {
  id: string;
  task: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  result?: unknown;
  error?: string;
}

export interface MemorySnapshot {
  snapshot: Record<string, unknown>;
  noteTopics: string[];
  noteCount: number;
}

export interface AgentEvent {
  type: string;
  data?: unknown;
  timestamp: number;
}

export interface ObservabilitySummary {
  logs: { total: number };
  metrics: Record<string, { value: number; lastUpdate: number }>;
  traces: { total: number; active: number };
  cost: { totalTokens: number; totalCostUsd: number; byProvider: Record<string, { calls: number; tokens: number; cost: number }> };
  replay: { total: number; active: number };
}

// ── Phase 3 - Step 3：Observability 数据结构（与 server/src/observability 对齐）──

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface AgentLog {
  level: LogLevel;
  component: string;
  message: string;
  data?: unknown;
  timestamp: number;
  traceId?: string;
}

export interface TraceSpan {
  id: string;
  name: string;
  start: number;
  end?: number;
  duration?: number;
  status: 'open' | 'ok' | 'error';
  error?: string;
  children: TraceSpan[];
  meta?: Record<string, unknown>;
}

export interface CostRecord {
  provider: string;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  tokens?: number;
  costUsd?: number;
  latencyMs?: number;
  time: number;
  traceId?: string;
}

export interface CostSummary {
  totalTokens: number;
  totalCostUsd: number;
  byProvider: Record<string, { calls: number; tokens: number; cost: number }>;
  recent: CostRecord[];
}

export interface LogQuery {
  level?: LogLevel | '';
  component?: string;
  since?: number;
  limit?: number;
}

// ── Phase 3 - Step 4：Workflow Engine ──

export interface WorkflowTaskSummary {
  id: string;
  goal: string;
  priority: number;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  source?: string;
  workflowId?: string;
  stepId?: string;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  durationMs?: number;
  attempts?: number;
  maxAttempts?: number;
  error?: string;
}

export interface WorkflowDef {
  id: string;
  name: string;
  description?: string;
  steps: Array<{ id: string; name: string; action: string; dependsOn?: string[]; optional?: boolean }>;
}

export interface WorkflowRunSnapshot {
  runId: string;
  workflowId: string;
  workflowName: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  createdAt: number;
  durationMs?: number;
  error?: string;
  progress: { done: number; total: number; percent: number };
  steps: Array<{ stepId: string; name: string; action: string; status: string; taskId?: string; error?: string }>;
}

export interface WorkflowStatus {
  available: boolean;
  running?: boolean;
  hint?: string;
  lifecycle?: string;
  queue?: { pending: number; running: number; completed: number; failed: number; cancelled: number; archived: number; topPriority: number | null };
  worker?: { name: string; running: boolean; concurrency: number; active: number; processed: number; succeeded: number; failed: number; queueSize: number };
  scheduler?: { running: boolean; jobs: Array<{ id: string; name: string; runs: number; errors: number; lastRunAt?: number }> };
  triggers?: { events: Record<string, number>; recent: Array<{ event: string; at: number; handled: number }> };
  workflows?: Array<{ id: string; name: string; steps: number; description?: string }>;
  runs?: WorkflowRunSnapshot[];
}

// ── Phase 3 - Step 5：Cognitive Memory 数据结构 ──

export interface CognitiveStats {
  available: boolean;
  hint?: string;
  working?: { size: number; capacity: number; goal: string | null };
  episodic?: { total: number; failures: number; successes: number; avgImportance: number };
  semantic?: { total: number; concepts: number; avgConfidence: number };
  vector?: { size: number; capacity: number; dim: number };
  graph?: { nodes: number; edges: number; relationTypes: number };
  learning?: { skills: number; antiPatterns: number; learned: number };
  embedding?: { dim: number; fallbackRatio: number };
}

export const api = {
  status: () => http.get<AgentStatus>('/api/status').then((r) => r.data),
  tasks: (limit = 20) => http.get<TaskRecord[]>(`/api/tasks?limit=${limit}`).then((r) => r.data),
  task: (id: string) => http.get<TaskRecord>(`/api/tasks/${id}`).then((r) => r.data),
  submit: (task: string, isAsync = false) =>
    http.post('/api/task', { task, async: isAsync }).then((r) => r.data),
  memory: () => http.get<MemorySnapshot>('/api/memory').then((r) => r.data),
  skills: () => http.get<Array<{ name: string }>>('/api/skills').then((r) => r.data),
  agents: () => http.get<Array<{ id: string; name: string; role: string }>>('/api/agents').then((r) => r.data),
  logs: (limit = 100) => http.get<AgentEvent[]>(`/api/logs?limit=${limit}`).then((r) => r.data),
  // Phase 3 - Step 3：Observability
  observability: () => http.get<ObservabilitySummary>('/api/observability/summary').then((r) => r.data),
  metrics: () => http.get<Record<string, { value: number; lastUpdate: number }>>('/api/observability/metrics').then((r) => r.data),
  traces: (limit = 50) => http.get<TraceSpan[]>(`/api/observability/traces?limit=${limit}`).then((r) => r.data),
  timeline: () => http.get<unknown[]>('/api/observability/timeline').then((r) => r.data),
  costs: () => http.get<CostSummary>('/api/observability/costs').then((r) => r.data),
  replays: (limit = 50) => http.get<unknown[]>(`/api/observability/replay?limit=${limit}`).then((r) => r.data),
  obsLogs: (q: LogQuery = {}) => {
    const params: Record<string, string | number> = { limit: q.limit ?? 200 };
    if (q.level) params.level = q.level;
    if (q.component) params.component = q.component;
    if (q.since) params.since = q.since;
    return http.get<{ count: number; logs: AgentLog[] }>('/api/observability/logs', { params }).then((r) => r.data);
  },
  // Phase 3 - Step 4：Workflow Engine
  wfStatus: () => http.get<WorkflowStatus>('/api/workflow/status').then((r) => r.data),
  wfStart: (opts: { pollMs?: number; concurrency?: number; tickMs?: number } = {}) =>
    http.post('/api/workflow/start', opts).then((r) => r.data),
  wfStop: () => http.post('/api/workflow/stop', {}).then((r) => r.data),
  wfTasks: (limit = 50) =>
    http
      .get<{ available: boolean; pending: WorkflowTaskSummary[]; running: WorkflowTaskSummary[]; history: WorkflowTaskSummary[] }>(
        `/api/workflow/tasks?limit=${limit}`,
      )
      .then((r) => r.data),
  wfSubmit: (goal: string, priority = 0) => http.post('/api/workflow/tasks', { goal, priority }).then((r) => r.data),
  wfCancel: (id: string) => http.delete(`/api/workflow/tasks/${id}`).then((r) => r.data),
  wfWorkflows: () => http.get<WorkflowDef[]>('/api/workflow/workflows').then((r) => r.data),
  wfRegister: (wf: unknown) => http.post('/api/workflow/workflows', wf).then((r) => r.data),
  wfRun: (id: string, timeoutMs = 120_000) =>
    http.post<WorkflowRunSnapshot>(`/api/workflow/workflows/${id}/run`, { timeoutMs }).then((r) => r.data),
  wfRuns: (limit = 20) => http.get<WorkflowRunSnapshot[]>(`/api/workflow/runs?limit=${limit}`).then((r) => r.data),
  wfEmit: (event: string, data: Record<string, unknown> = {}) =>
    http.post('/api/workflow/events', { event, data }).then((r) => r.data),

  // ── Phase 3 - Step 5：Cognitive Memory ──
  cogStats: () => http.get<CognitiveStats>('/api/cognitive/stats').then((r) => r.data),
  cogRecall: (q: string, k = 5) => http.get('/api/cognitive/recall', { params: { q, k } }).then((r) => r.data),
  cogRemember: (body: { task: string; result?: boolean; lesson?: string; tags?: string[] }) =>
    http.post('/api/cognitive/remember', body).then((r) => r.data),
  cogConsolidate: () => http.post('/api/cognitive/consolidate', {}).then((r) => r.data),
  cogPreview: () => http.get('/api/cognitive/preview').then((r) => r.data),
  cogSearch: (q: string, limit = 10) => http.get('/api/cognitive/search', { params: { q, limit } }).then((r) => r.data),
  cogSkills: () => http.get('/api/cognitive/skills').then((r) => r.data),
  cogGraph: () => http.get('/api/cognitive/graph').then((r) => r.data),

  // 对话：直连 LLM
  chat: (message: string, history: Array<{ role: string; content: string }> = []) =>
    http.post<{ reply: string; model: string; tokens: number; latency: number; mode: string }>('/api/chat', { message, history }).then((r) => r.data),

  // 模型选择
  chatModels: () =>
    http.get<Array<{ id: string; status: string; isDefault: boolean }>>('/api/chat/models').then((r) => r.data),
  chatSetModel: (provider: string) =>
    http.post<{ ok: boolean; model: string }>('/api/chat/model', { provider }).then((r) => r.data),

  // §十五：Human Override
  pause: (reason?: string) => http.post('/api/agent/pause', { reason }).then((r) => r.data),
  resume: (reason?: string) => http.post('/api/agent/resume', { reason }).then((r) => r.data),
  kill: (reason?: string) => http.post('/api/agent/kill', { reason }).then((r) => r.data),
  reset: () => http.post('/api/agent/reset', {}).then((r) => r.data),
};

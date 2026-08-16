// api/agent.controller.ts
// V3 Phase 3 - Step 2 §四/§五：Agent Controller —— Web 层与 Agent Core 之间的唯一入口。
//
// 棕地说明：计划书 §三 的目录是 `server/api/`，本项目源码根在 `server/src/`，
//   故落在 server/src/api/。既有 gateway/web.ts（V2 生产 HTTP+WS 网关，30+ 端点）
//   完全不动；本控制面是并排新增的 Control Center，端口独立（AH_CONTROL_PORT，默认 3001）。

import { agentControl, type ControlState } from '../kernel/control';
import { agentEventBus } from '../websocket';
import { MemoryOS, MemoryManager } from '../memory';
import { OS_VERSION } from '../kernel/version';
import { config } from '../config';
import { logger, metrics, tracer, cost, replay } from '../observability';
import { silentErrorSnapshot } from '../observability/silent';
import type { TraceSpan } from '../observability';
import type { WorkflowEngine, Workflow } from '../workflow';
import type { CognitiveMemoryOS, RecallResult, RememberResult, ConsolidateResult, CognitiveStats } from '../cognitive';
import { llm } from '../llm';

// 用结构化类型而非直接依赖 AgentRuntime 类，控制面因此也能挂到测试替身上
export interface ControllableRuntime {
  run(goal: string): Promise<any>;
  boot?(): Promise<void>;
  isBooted?(): boolean;
  getState?(): any;
  /** Phase 3 - Step 4：常驻引擎懒启动（AgentRuntime 实现；测试替身可不提供） */
  startWorkflowEngine?(opts?: any): WorkflowEngine;
  stopWorkflowEngine?(): Promise<void>;
}

export type TaskStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface TaskRecord {
  id: string;
  task: string;
  status: TaskStatus;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  result?: any;
  error?: string;
}

export interface AgentControllerOptions {
  memory?: MemoryOS;
  notes?: MemoryManager;
  agents?: () => any[];
  skills?: () => any[];
  /** Phase 3 - Step 4：常驻 Workflow Engine 取用器（未启动时返回 null） */
  engine?: () => WorkflowEngine | null;
  /** Phase 3 - Step 5：认知记忆（单例，Web 层只读/触发） */
  cognitive?: () => CognitiveMemoryOS | null;
}

export class AgentController {
  private tasks = new Map<string, TaskRecord>();
  private order: string[] = [];
  private current: TaskRecord | null = null;
  private seq = 0;
  private startedAt = Date.now();
  private memory: MemoryOS;
  private notes: MemoryManager;
  private agentsFn?: () => any[];
  private skillsFn?: () => any[];
  private engineFn?: () => WorkflowEngine | null;
  private cognitiveFn?: () => CognitiveMemoryOS | null;

  constructor(private agent: ControllableRuntime, opts: AgentControllerOptions = {}) {
    this.memory = opts.memory ?? new MemoryOS();
    this.notes = opts.notes ?? new MemoryManager();
    this.agentsFn = opts.agents;
    this.skillsFn = opts.skills;
    this.engineFn = opts.engine;
    this.cognitiveFn = opts.cognitive;
  }

  // ── Phase 3 - Step 4：Workflow Engine 控制面 ──
  // 引擎是懒启动的（runtime.startWorkflowEngine()）；未启动时统一返回 running:false，前端据此显示引导。

  private engine(): WorkflowEngine | null {
    try { return this.engineFn?.() ?? null; } catch { return null; }
  }

  workflowStatus() {
    const e = this.engine();
    if (!e) return { running: false, available: false, hint: '常驻引擎未启动：POST /api/workflow/start' };
    return { available: true, ...e.status() };
  }

  workflowTasks(limit = 50) {
    const e = this.engine();
    if (!e) return { available: false, pending: [], running: [], history: [] };
    return { available: true, ...e.tasks(limit) };
  }

  workflowSubmit(goal: string, priority = 0) {
    const e = this.engine();
    if (!e) throw new Error('常驻引擎未启动');
    if (!goal.trim()) throw new Error('goal 不能为空');
    const task = e.submit(goal.trim(), { priority, source: 'manual' });
    metrics.increment('workflow.api.submit');
    logger.info('Controller', 'Workflow task submitted', { taskId: task.id, goal: task.goal, priority });
    return task;
  }

  workflowList() {
    const e = this.engine();
    return e ? e.listWorkflows() : [];
  }

  workflowRegister(wf: Workflow) {
    const e = this.engine();
    if (!e) throw new Error('常驻引擎未启动');
    return e.registerWorkflow(wf);
  }

  async workflowRun(id: string, timeoutMs?: number) {
    const e = this.engine();
    if (!e) throw new Error('常驻引擎未启动');
    return e.runWorkflow(id, { timeoutMs });
  }

  workflowRuns(limit = 20) {
    const e = this.engine();
    return e ? e.listRuns(limit) : [];
  }

  workflowRunDetail(runId: string) {
    return this.engine()?.getRun(runId) ?? null;
  }

  workflowEmit(event: string, data: any) {
    const e = this.engine();
    if (!e) throw new Error('常驻引擎未启动');
    const handled = e.emit(event, data);
    return { event, handled, data };
  }

  workflowCancel(taskId: string) {
    const e = this.engine();
    if (!e) throw new Error('常驻引擎未启动');
    return { ok: e.queue.cancel(taskId), taskId };
  }

  /** §十：从控制面拉起常驻引擎（Worker + Scheduler + Event 一起待命） */
  workflowStart(opts: { pollMs?: number; concurrency?: number; tickMs?: number } = {}) {
    if (this.engine()) return { ok: true, alreadyRunning: true, ...this.workflowStatus() };
    if (!this.agent.startWorkflowEngine) throw new Error('当前 runtime 不支持常驻引擎');
    this.agent.startWorkflowEngine(opts);
    logger.info('Controller', 'Workflow engine started', opts);
    return { ok: true, alreadyRunning: false, ...this.workflowStatus() };
  }

  async workflowStop() {
    if (!this.agent.stopWorkflowEngine) throw new Error('当前 runtime 不支持常驻引擎');
    await this.agent.stopWorkflowEngine();
    logger.info('Controller', 'Workflow engine stopped', {});
    return { ok: true };
  }

  // ── §四：GET /api/status ──
  status() {
    const sys = config.get();
    return {
      name: sys.agent?.name ?? 'DaShaAgent',
      version: OS_VERSION,
      booted: this.agent.isBooted ? this.agent.isBooted() : true,
      state: this.current ? 'busy' : 'idle',
      control: agentControl.state as ControlState,
      runtimeState: this.agent.getState ? this.agent.getState() : undefined,
      currentTask: this.current ? { id: this.current.id, task: this.current.task } : null,
      tasks: this.counts(),
      wsClients: agentEventBus.clientCount(),
      uptimeMs: Date.now() - this.startedAt,
    };
  }

  // ── 对话：直连 LLM + 智能分流（简单问答→直答，复杂任务→Agent 管线） ──
  private chatModel: string | null = null; // null = 使用配置默认

  async chat(message: string, history: Array<{ role: string; content: string }> = []): Promise<{ reply: string; model: string; tokens: number; latency: number; mode: 'chat' | 'agent' }> {
    const provider = this.chatModel ?? config.getLLM().provider;

    // 判定：是不是"干活"类的指令？
    const actionKeywords = ['分析', '写', '生成', '创建', '查找', '搜索', '处理', '执行', '运行', '帮我', '计算', '转换', '翻译', '总结', '提取', '整理', '检查', '修复', '部署', '构建'];
    const isAction = actionKeywords.some((kw) => message.includes(kw));

    if (isAction) {
      // 复杂任务：走 Agent 管线
      try {
        const result = await this.runAgentTask(message, provider);
        return { reply: result, model: provider, tokens: 0, latency: 0, mode: 'agent' };
      } catch (e: any) {
        // Agent 失败时降级到直答
        const messages = this.buildMessages(message, history);
        const res = await llm.chat(provider, messages);
        return { reply: `[Agent 管线暂时不可用，以下为直接回答]\n\n${res.content}`, model: res.model, tokens: res.tokens, latency: res.latency, mode: 'chat' };
      }
    }

    // 简单问答：直连 LLM
    const messages = this.buildMessages(message, history);
    const res = await llm.chat(provider, messages);
    logger.info('Chat', `LLM response via ${provider}`, { model: res.model, tokens: res.tokens, latency: res.latency });
    return { reply: res.content, model: res.model, tokens: res.tokens, latency: res.latency, mode: 'chat' };
  }

  private buildMessages(message: string, history: Array<{ role: string; content: string }>) {
    return [
      { role: 'system' as const, content: '你是 DaShaAgent 智能助手。用中文回答，简洁专业。' },
      ...history.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      { role: 'user' as const, content: message },
    ];
  }

  /** 走 Agent 管线：分析→推理→执行 */
  private async runAgentTask(task: string, provider: string): Promise<string> {
    // Step 1: 用 LLM 分析任务
    const analyzeRes = await llm.chat(provider, [
      { role: 'system', content: '你是任务分析专家。分析以下任务，提取：1)目标 2)需要的步骤 3)可能需要的工具。简洁回复。' },
      { role: 'user', content: task },
    ]);

    // Step 2: 用 LLM 执行推理
    const executeRes = await llm.chat(provider, [
      { role: 'system', content: '你是 DaShaAgent 执行引擎。根据任务分析结果，生成最终答案。用中文，专业、详细。' },
      { role: 'user', content: `任务：「${task}」\n\n分析结果：${analyzeRes.content}` },
    ]);

    return `**任务分析**\n${analyzeRes.content.slice(0, 400)}\n\n**执行结果**\n${executeRes.content}`;
  }

  /** 获取当前会话的聊天模型 */
  getChatModel(): string {
    return this.chatModel ?? config.getLLM().provider;
  }

  /** 手动切换到指定模型 */
  setChatModel(provider: string): { ok: boolean; model: string; available: string[] } {
    const available = llm.list().filter((p) => {
      const st = llm.get(p).status?.() ?? '';
      return p === provider || !st.includes('no API key');
    });
    if (llm.has(provider)) {
      this.chatModel = provider;
      return { ok: true, model: provider, available };
    }
    return { ok: false, model: this.getChatModel(), available };
  }

  /** 列出可用模型（含状态） */
  listModels(): Array<{ id: string; status: string; isDefault: boolean }> {
    const cfg = config.getLLM();
    return llm.list().map((p) => ({
      id: p,
      status: llm.get(p).status?.() ?? 'unknown',
      isDefault: p === cfg.provider,
    }));
  }
  async execute(task: string, opts: { async?: boolean } = {}) {
    if (!task || !task.trim()) throw new Error('task 不能为空');
    if (agentControl.killed) throw new Error('Agent 已被终止（kill），请先 reset');
    if (this.current) throw new Error(`Agent 正忙：${this.current.task}`);

    const record: TaskRecord = {
      id: `t${++this.seq}-${Date.now().toString(36)}`,
      task,
      status: 'queued',
      createdAt: Date.now(),
    };
    this.tasks.set(record.id, record);
    this.order.push(record.id);
    if (this.order.length > 100) {
      const drop = this.order.shift()!;
      this.tasks.delete(drop);
    }

    const run = this.runTask(record);
    if (opts.async) return { accepted: true, taskId: record.id, status: record.status };
    await run;
    return { accepted: true, taskId: record.id, status: record.status, result: record.result, error: record.error };
  }

  private async runTask(record: TaskRecord): Promise<void> {
    this.current = record;
    record.status = 'running';
    record.startedAt = Date.now();
    metrics.increment('agent.task.started');
    const trace = tracer.start('controller.task', { taskId: record.id, task: record.task });
    logger.info('Controller', 'Task started', { id: record.id, task: record.task }, trace.id);
    agentEventBus.emit('task.started', { id: record.id, task: record.task });
    try {
      if (this.agent.boot && this.agent.isBooted && !this.agent.isBooted()) {
        await this.agent.boot();
      }
      const result = await this.agent.run(record.task);
      record.result = summarize(result);
      record.status = 'completed';
      metrics.increment('agent.task.completed');
      logger.info('Controller', 'Task completed', { id: record.id }, trace.id);
      agentEventBus.emit('task.completed', { id: record.id, result: record.result });
    } catch (e: any) {
      record.error = String(e?.message ?? e);
      record.status = 'failed';
      metrics.increment('agent.task.failed');
      tracer.fail(e, trace);
      logger.error('Controller', 'Task failed', { id: record.id, error: record.error }, trace.id);
      agentEventBus.emit('task.failed', { id: record.id, error: record.error });
    } finally {
      record.finishedAt = Date.now();
      tracer.end(trace, { status: record.status });
      this.current = null;
    }
  }

  taskList(limit = 20): TaskRecord[] {
    return this.order.slice(-limit).map((id) => this.tasks.get(id)!).filter(Boolean).reverse();
  }

  task(id: string): TaskRecord | null {
    return this.tasks.get(id) ?? null;
  }

  // ── §十二：GET /api/memory ──
  memorySnapshot() {
    let snapshot: any = {};
    try { snapshot = this.memory.snapshot(); } catch { snapshot = {}; }
    let topics: string[] = [];
    try { topics = this.notes.listNoteTopics(); } catch { topics = []; }
    return { snapshot, noteTopics: topics, noteCount: topics.length };
  }

  memoryRecall(query: string) {
    try { return this.memory.recall(query) ?? []; } catch { return []; }
  }

  // ── §十三：技能面板数据源 ──
  skills() {
    try { return this.skillsFn ? this.skillsFn() : []; } catch { return []; }
  }

  agents() {
    try { return this.agentsFn ? this.agentsFn() : []; } catch { return []; }
  }

  // ── Phase 3 - Step 5：Cognitive Memory 控制面 ──

  private cognitive(): CognitiveMemoryOS | null {
    try { return this.cognitiveFn?.() ?? null; } catch { return null; }
  }

  cognitiveStats() {
    const cm = this.cognitive();
    if (!cm) return { available: false, hint: '认知记忆未接入' };
    return { available: true, ...cm.stats() };
  }

  async cognitiveRecall(q: string, k = 5) {
    const cm = this.cognitive();
    if (!cm) throw new Error('认知记忆未接入');
    return cm.recall(q, k);
  }

  async cognitiveRemember(body: { task: string; result?: boolean; lesson?: string; tags?: string[] }) {
    const cm = this.cognitive();
    if (!cm) throw new Error('认知记忆未接入');
    return cm.remember(body);
  }

  cognitiveConsolidate() {
    const cm = this.cognitive();
    if (!cm) throw new Error('认知记忆未接入');
    return cm.consolidate();
  }

  cognitivePreview() {
    const cm = this.cognitive();
    if (!cm) throw new Error('认知记忆未接入');
    return cm.previewConsolidate();
  }

  cognitiveSearch(q: string, limit = 10) {
    const cm = this.cognitive();
    if (!cm) throw new Error('认知记忆未接入');
    const eps = cm.episodic.search(q).slice(0, limit);
    const kn = cm.semantic.search(q, limit);
    return { episodic: eps.map(e => ({ id: e.id, task: e.task, outcome: e.outcome, lesson: e.lesson })), knowledge: kn };
  }

  cognitiveSkills() {
    const cm = this.cognitive();
    if (!cm) return { available: false };
    return { available: true, skills: cm.learning.skills, antiPatterns: cm.learning.antiPatterns };
  }

  cognitiveGraph() {
    const cm = this.cognitive();
    if (!cm) return { available: false };
    return { available: true, stats: cm.graph.stats(), dot: cm.graph.toDot() };
  }

  logs(limit = 100) {
    return agentEventBus.history(limit);
  }

  observabilitySummary() {
    return {
      logs: { total: logger.all().length },
      metrics: metrics.snapshot(),
      traces: { total: tracer.getRoots().length, active: tracer.active() ? 1 : 0 },
      cost: { totalTokens: cost.totalTokens(), totalCostUsd: cost.totalCost(), byProvider: cost.byProvider() },
      replay: { total: replay.all().length, active: replay.activeCount() },
      silentErrors: silentErrorSnapshot(),
    };
  }

  // ── §十五：Human Override ──
  pause(reason?: string) {
    const state = agentControl.pause(reason);
    return { ok: true, state, message: '已暂停，Agent Loop 将在下一个安全点挂起' };
  }

  resume(reason?: string) {
    const state = agentControl.resume(reason);
    return { ok: true, state, message: '已恢复' };
  }

  kill(reason?: string) {
    const state = agentControl.kill(reason);
    return { ok: true, state, message: '已发出终止信号，Agent Loop 将在下一个安全点退出' };
  }

  reset() {
    const state = agentControl.reset();
    return { ok: true, state, message: '控制状态已复位' };
  }

  private counts() {
    let running = 0, completed = 0, failed = 0;
    for (const id of this.order) {
      const t = this.tasks.get(id);
      if (!t) continue;
      if (t.status === 'running' || t.status === 'queued') running++;
      else if (t.status === 'completed') completed++;
      else if (t.status === 'failed') failed++;
    }
    return { total: this.order.length, running, completed, failed };
  }
}

// run() 的返回值里可能夹带巨大的对象/循环引用，落到 HTTP 之前先收敛一次
function summarize(result: any): any {
  if (result == null) return null;
  if (typeof result === 'string') return result.length > 4000 ? result.slice(0, 4000) + '…' : result;
  if (typeof result !== 'object') return result;
  try {
    const json = JSON.stringify(result);
    if (json === undefined) return { note: '结果无法序列化' };
    if (json.length > 8000) return { truncated: true, preview: json.slice(0, 4000) + '…' };
    return JSON.parse(json);
  } catch {
    return { note: '结果无法序列化', type: Object.prototype.toString.call(result) };
  }
}

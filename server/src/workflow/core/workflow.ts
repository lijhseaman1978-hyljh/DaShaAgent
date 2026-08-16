// workflow/core/workflow.ts
// V3 Phase 3 - Step 4 §三：Workflow 定义系统。
// Agent 不再只执行一句话，而是执行一条流程：收集数据 → 分析趋势 → 生成报告 → 发送结果。
//
// 棕地说明：V2 已有 agents/collaboration/workflow.ts（Workflow{steps:{agent,task}[]}，
//           面向「哪个 Agent 干哪一步」的多智能体协作编排）。本文件是 Step 4 教程层的
//           「流程即数据」定义（step.action 是自然语言目标，由 Worker 交给 Agent Loop 跑），
//           两者并存：V2 那套解决角色分工，这套解决流程编排 + 长期驻留。

export interface WorkflowStep {
  // ── 计划书 §三 原文字段 ──
  id: string;
  name: string;
  /** 该步骤要达成的目标（自然语言），最终会变成一个 AgentTask.goal */
  action: string;

  // ── 并排扩展 ──
  /** 依赖的前置步骤 id；为空表示可立即执行 */
  dependsOn?: string[];
  /** 该步骤失败时的最大重试次数 */
  retries?: number;
  /** 可选步骤：失败不阻断整条流程 */
  optional?: boolean;
  /** 步骤优先级，进入 TaskQueue 时使用 */
  priority?: number;
}

export interface Workflow {
  // ── 计划书 §三 原文字段 ──
  id: string;
  name: string;
  steps: WorkflowStep[];

  // ── 并排扩展 ──
  description?: string;
  /** 全流程默认优先级 */
  priority?: number;
  createdAt?: number;
}

/** 快速定义一条 Workflow。steps 可省略 id（自动按序号补齐）。 */
export function defineWorkflow(
  def: { id: string; name: string; description?: string; priority?: number; steps: Array<Omit<WorkflowStep, 'id'> & { id?: string }> },
): Workflow {
  return {
    id: def.id,
    name: def.name,
    description: def.description,
    priority: def.priority ?? 0,
    createdAt: Date.now(),
    steps: def.steps.map((s, i) => ({
      id: s.id ?? `${def.id}_s${i + 1}`,
      name: s.name,
      action: s.action,
      dependsOn: s.dependsOn,
      retries: s.retries,
      optional: s.optional,
      priority: s.priority,
    })),
  };
}

/** 链式构造器，便于代码里逐步拼流程。 */
export class WorkflowBuilder {
  private readonly wf: Workflow;

  constructor(id: string, name: string, description?: string) {
    this.wf = { id, name, description, steps: [], priority: 0, createdAt: Date.now() };
  }

  step(name: string, action: string, opts: Partial<Omit<WorkflowStep, 'id' | 'name' | 'action'>> = {}): this {
    this.wf.steps.push({
      id: `${this.wf.id}_s${this.wf.steps.length + 1}`,
      name,
      action,
      ...opts,
    });
    return this;
  }

  priority(p: number): this {
    this.wf.priority = p;
    return this;
  }

  build(): Workflow {
    return this.wf;
  }
}

/**
 * 校验流程：id 唯一、依赖存在、无环。
 * 返回错误列表（空数组即合法）。
 */
export function validateWorkflow(wf: Workflow): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();

  for (const s of wf.steps) {
    if (ids.has(s.id)) errors.push(`重复的步骤 id: ${s.id}`);
    ids.add(s.id);
  }
  for (const s of wf.steps) {
    for (const dep of s.dependsOn ?? []) {
      if (!ids.has(dep)) errors.push(`步骤 ${s.id} 依赖了不存在的步骤 ${dep}`);
    }
  }

  // 环检测（DFS 三色标记）
  const color = new Map<string, 0 | 1 | 2>();
  const byId = new Map(wf.steps.map((s) => [s.id, s]));
  const visit = (id: string): boolean => {
    const c = color.get(id) ?? 0;
    if (c === 1) return true; // 回边 → 有环
    if (c === 2) return false;
    color.set(id, 1);
    for (const dep of byId.get(id)?.dependsOn ?? []) {
      if (byId.has(dep) && visit(dep)) return true;
    }
    color.set(id, 2);
    return false;
  };
  for (const s of wf.steps) {
    if (visit(s.id)) { errors.push(`流程存在循环依赖（涉及步骤 ${s.id}）`); break; }
  }

  return errors;
}

/**
 * 拓扑分层：返回可并行批次数组，每批内的步骤互不依赖。
 * WorkflowEngine 按批次投递 TaskQueue，实现「串行推进 + 批内并发」。
 */
export function topoLayers(wf: Workflow): WorkflowStep[][] {
  const remaining = new Map(wf.steps.map((s) => [s.id, s]));
  const done = new Set<string>();
  const layers: WorkflowStep[][] = [];

  while (remaining.size > 0) {
    const layer = [...remaining.values()].filter((s) =>
      (s.dependsOn ?? []).every((d) => done.has(d) || !remaining.has(d)),
    );
    if (layer.length === 0) {
      // 有环或依赖缺失 —— 剩余步骤作为最后一层兜底，避免死循环
      layers.push([...remaining.values()]);
      break;
    }
    for (const s of layer) { remaining.delete(s.id); done.add(s.id); }
    layers.push(layer);
  }
  return layers;
}

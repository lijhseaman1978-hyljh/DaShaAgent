// cognitive/core/workingMemory.ts
// V3 Phase 3 - Step 5 §四：Working Memory（工作记忆 / 短期上下文）
//
// 计划书原型：
//   class WorkingMemory { private context:any[]=[]; add(); get(); clear(); }
// 本实现保持 add/get/clear 三个方法签名完全兼容，并补齐生产必需能力：
//   · 容量上限（工作记忆按定义就是"短期"的，无上限会退化成日志）
//   · 键值态（计划书示例的 {goal, step, currentFile} 形态）
//   · 注意力焦点 focus() —— 供 Brain 组 prompt
//
// 与既有 memory/working/workingMemory.ts（V2，键值型）并存，互不引用。

export interface WorkingEntry {
  seq: number;
  at: number;
  data: unknown;
}

export interface WorkingSnapshot {
  goal: string | null;
  step: string | null;
  slots: Record<string, unknown>;
  context: unknown[];
  size: number;
  capacity: number;
  evicted: number;
}

export class WorkingMemory {
  private context: WorkingEntry[] = [];
  private slots = new Map<string, unknown>();
  private seq = 0;
  private evicted = 0;

  constructor(private capacity = 50) {}

  // ── 计划书原型 API ──

  /** 压入一条上下文。超出容量时淘汰最旧的（FIFO 环形）。 */
  add(data: unknown): void {
    this.context.push({ seq: ++this.seq, at: Date.now(), data });
    while (this.context.length > this.capacity) {
      this.context.shift();
      this.evicted++;
    }
  }

  /** 取回全部上下文（计划书返回裸数组，此处保持一致）。 */
  get(): unknown[] {
    return this.context.map((e) => e.data);
  }

  /** 清空工作记忆 —— 一个任务结束即清，这是"短期"的含义。 */
  clear(): void {
    this.context = [];
    this.slots.clear();
    this.seq = 0;
    this.evicted = 0;
  }

  // ── 扩展：键值槽位（计划书 §四 示例的 {goal, step, currentFile} 形态）──

  set(key: string, value: unknown): void {
    this.slots.set(key, value);
  }

  slot<T = unknown>(key: string): T | undefined {
    return this.slots.get(key) as T | undefined;
  }

  /** 当前目标 —— Agent 的"注意力焦点"。 */
  focus(): string | null {
    const g = this.slots.get('goal');
    return typeof g === 'string' ? g : null;
  }

  /** 最近 n 条上下文（组 prompt 时通常只要尾部）。 */
  recent(n = 10): unknown[] {
    return this.context.slice(-n).map((e) => e.data);
  }

  get size(): number {
    return this.context.length;
  }

  snapshot(): WorkingSnapshot {
    const goal = this.slots.get('goal');
    const step = this.slots.get('step');
    return {
      goal: typeof goal === 'string' ? goal : null,
      step: typeof step === 'string' ? step : null,
      slots: Object.fromEntries(this.slots.entries()),
      context: this.get(),
      size: this.context.length,
      capacity: this.capacity,
      evicted: this.evicted,
    };
  }

  /** 渲染成可直接塞进 prompt 的文本块。 */
  toPrompt(): string {
    const lines: string[] = [];
    const s = this.snapshot();
    if (s.goal) lines.push(`当前目标：${s.goal}`);
    if (s.step) lines.push(`当前步骤：${s.step}`);
    for (const [k, v] of Object.entries(s.slots)) {
      if (k === 'goal' || k === 'step') continue;
      lines.push(`${k}：${typeof v === 'string' ? v : JSON.stringify(v)}`);
    }
    const rec = this.recent(5);
    if (rec.length) {
      lines.push('最近上下文：');
      for (const r of rec) lines.push(`  - ${typeof r === 'string' ? r : JSON.stringify(r)}`);
    }
    return lines.join('\n');
  }
}

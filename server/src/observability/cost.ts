// observability/cost.ts
// V3 Phase 3 - Step 3 §六：LLM Cost Tracker —— Token / API 成本记录。

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

const DEFAULT_PRICING: Record<string, { input: number; output: number }> = {
  'gpt-4o': { input: 0.0025, output: 0.01 },
  'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
  'claude-3-5-sonnet': { input: 0.003, output: 0.015 },
  'gemini-1.5-flash': { input: 0.000075, output: 0.0003 },
  'deepseek-chat': { input: 0.00014, output: 0.00028 },
  'deepseek-v4-flash': { input: 0.00007, output: 0.00014 },
};

export class CostTracker {
  private records: CostRecord[] = [];
  private limit: number;
  private pricing: Record<string, { input: number; output: number }>;

  constructor(opts: { limit?: number; pricing?: Record<string, { input: number; output: number }> } = {}) {
    this.limit = opts.limit ?? 2000;
    this.pricing = opts.pricing ?? { ...DEFAULT_PRICING };
  }

  /** 动态注册模型定价（B25 修复：不再硬编码） */
  registerPricing(model: string, inputPer1k: number, outputPer1k: number): void {
    this.pricing[model] = { input: inputPer1k, output: outputPer1k };
  }

  /** 批量注册定价 */
  registerPricingMap(map: Record<string, { input: number; output: number }>): void {
    Object.assign(this.pricing, map);
  }

  /** 获取当前定价表 */
  getPricing(): Record<string, { input: number; output: number }> {
    return { ...this.pricing };
  }

  record(data: Omit<CostRecord, 'time'>): CostRecord {
    const rec: CostRecord = { ...data, time: Date.now() };
    if (!rec.costUsd && rec.model) {
      const p = this.pricing[rec.model];
      if (p) {
        if (rec.inputTokens != null && rec.outputTokens != null) {
          // 精确计价（2026-08-13）：输入/输出分别按各自单价
          rec.costUsd = (rec.inputTokens / 1000) * p.input + (rec.outputTokens / 1000) * p.output;
        } else if (rec.tokens) {
          rec.costUsd = (rec.tokens / 1000) * p.output;
        }
      }
    }
    this.records.push(rec);
    if (this.records.length > this.limit) this.records.shift();
    return rec;
  }

  totalTokens(): number {
    return this.records.reduce((a, b) => a + (b.tokens ?? 0), 0);
  }

  totalCost(): number {
    return this.records.reduce((a, b) => a + (b.costUsd ?? 0), 0);
  }

  byProvider(): Record<string, { calls: number; tokens: number; cost: number }> {
    const out: Record<string, { calls: number; tokens: number; cost: number }> = {};
    for (const r of this.records) {
      const p = r.provider || 'unknown';
      const cur = out[p] ?? { calls: 0, tokens: 0, cost: 0 };
      cur.calls++;
      cur.tokens += r.tokens ?? 0;
      cur.cost += r.costUsd ?? 0;
      out[p] = cur;
    }
    return out;
  }

  recent(limit = 50): CostRecord[] {
    return this.records.slice(-limit);
  }

  estimateCost(model: string, tokens: number): number {
    const p = this.pricing[model];
    if (!p) return 0;
    // 无法区分 input/output 时按 output 价保守估算
    return (tokens / 1000) * p.output;
  }

  clear(): void {
    this.records = [];
  }
}

export const cost = new CostTracker();

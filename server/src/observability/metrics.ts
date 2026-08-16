// observability/metrics.ts
// V3 Phase 3 - Step 3 §四：Metrics System —— 性能指标计数器。

export interface MetricValue {
  value: number;
  lastUpdate: number;
}

export class Metrics {
  private data = new Map<string, MetricValue>();

  increment(name: string, delta = 1): void {
    const cur = this.data.get(name);
    this.data.set(name, { value: (cur?.value ?? 0) + delta, lastUpdate: Date.now() });
  }

  decrement(name: string, delta = 1): void {
    this.increment(name, -delta);
  }

  set(name: string, value: number): void {
    this.data.set(name, { value, lastUpdate: Date.now() });
  }

  get(name: string): number {
    return this.data.get(name)?.value ?? 0;
  }

  snapshot(): Record<string, MetricValue> {
    return Object.fromEntries(this.data.entries());
  }

  reset(): void {
    this.data.clear();
  }
}

export const metrics = new Metrics();

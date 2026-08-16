// observability/replay.ts
// V3 Phase 3 - Step 3 §七：Agent Replay —— 任务回放。

import crypto from 'node:crypto';

export interface ReplayRecord {
  id: string;
  goal: string;
  steps: ReplayStep[];
  result?: any;
  error?: string;
  start: number;
  end?: number;
  duration?: number;
}

export interface ReplayStep {
  at: number;
  phase: string;
  action?: string;
  input?: any;
  output?: any;
  error?: string;
}

export class ReplaySystem {
  private records: ReplayRecord[] = [];
  private active: Map<string, ReplayRecord> = new Map();
  private limit: number;

  constructor(opts: { limit?: number } = {}) {
    this.limit = opts.limit ?? 200;
  }

  begin(goal: string, id?: string): ReplayRecord {
    const rec: ReplayRecord = {
      id: id ?? crypto.randomUUID(),
      goal,
      steps: [],
      start: Date.now(),
    };
    this.active.set(rec.id, rec);
    return rec;
  }

  step(id: string, phase: string, payload: { action?: string; input?: any; output?: any; error?: string } = {}): void {
    const rec = this.active.get(id);
    if (!rec) return;
    rec.steps.push({ at: Date.now(), phase, ...payload });
  }

  finish(id: string, result?: any, error?: string): ReplayRecord | null {
    const rec = this.active.get(id);
    if (!rec) return null;
    rec.end = Date.now();
    rec.duration = rec.end - rec.start;
    rec.result = result;
    if (error) rec.error = error;
    this.active.delete(id);
    this.records.push(rec);
    if (this.records.length > this.limit) this.records.shift();
    return rec;
  }

  find(id: string): ReplayRecord | null {
    return this.active.get(id) ?? this.records.find((r) => r.id === id) ?? null;
  }

  all(limit = 100): ReplayRecord[] {
    return this.records.slice(-limit);
  }

  activeCount(): number {
    return this.active.size;
  }

  clear(): void {
    this.records = [];
    this.active.clear();
  }
}

export const replay = new ReplaySystem();

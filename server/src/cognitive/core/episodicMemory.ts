// cognitive/core/episodicMemory.ts
// V3 Phase 3 - Step 5 §五：Episodic Memory（情景记忆 / 发生过什么）
//
// 计划书原型：
//   interface Episode { id; task; actions; result; lesson }
//   class EpisodicMemory { records:Episode[]; save(ep); search(keyword) }
// 本实现保持 records / save / search 完全兼容，并补齐：
//   · 成败标记与耗时（Learning Engine 需要据此区分"经验"与"教训"）
//   · importance + 访问衰减（Consolidation 的清理依据，§十）
//   · 容量上限与索引（避免线性扫描退化）
//
// 与既有 memory/episodic/episodicMemory.ts（V2，写入 MemoryStore）并存。

import fs from 'node:fs';
import path from 'node:path';

export type EpisodeOutcome = 'success' | 'failure' | 'partial' | 'unknown';

export interface Episode {
  id: string;
  task: string;
  actions: unknown[];
  result: unknown;
  lesson: string;
  /** 结果判定 —— Learning Engine 的分流依据 */
  outcome?: EpisodeOutcome;
  /** 0..1，Consolidation 清理时的保留权重 */
  importance?: number;
  tags?: string[];
  durationMs?: number;
  createdAt?: number;
  /** 被 recall 命中的次数 —— 常用记忆不该被清理掉 */
  hits?: number;
  lastAccessAt?: number;
  /** 由 memoryCompressor 合并而来时，记录合并了多少条 */
  mergedCount?: number;
  meta?: Record<string, unknown>;
}

export interface EpisodeStats {
  total: number;
  success: number;
  failure: number;
  partial: number;
  unknown: number;
  avgDurationMs: number;
  topTasks: Array<{ task: string; count: number }>;
}

let epSeq = 0;
function nextEpisodeId(): string {
  return `ep_${Date.now().toString(36)}_${(++epSeq).toString(36)}`;
}

/** 判定结果是成功还是失败 —— 允许调用方只传 result 而不显式给 outcome。 */
export function inferOutcome(result: unknown): EpisodeOutcome {
  if (result === 'success' || result === true) return 'success';
  if (result === 'failure' || result === 'failed' || result === false) return 'failure';
  if (result && typeof result === 'object') {
    const r = result as Record<string, unknown>;
    if (typeof r.success === 'boolean') return r.success ? 'success' : 'failure';
    if (typeof r.status === 'string') {
      if (/^(success|completed|ok|done)$/i.test(r.status)) return 'success';
      if (/^(fail|failed|error|aborted)$/i.test(r.status)) return 'failure';
    }
    if (r.error) return 'failure';
  }
  return 'unknown';
}

export class EpisodicMemory {
  /** 计划书直接暴露 records 数组，保持一致 */
  records: Episode[] = [];

  constructor(private capacity = 2000) {}

  // ── 计划书原型 API ──

  /** 保存一段经历。id / createdAt / outcome 缺省时自动补齐。 */
  save(episode: Partial<Episode> & { task: string }): Episode {
    const ep: Episode = {
      id: episode.id ?? nextEpisodeId(),
      task: episode.task,
      actions: episode.actions ?? [],
      result: episode.result ?? null,
      lesson: episode.lesson ?? '',
      outcome: episode.outcome ?? inferOutcome(episode.result),
      importance: episode.importance ?? defaultImportance(episode),
      tags: episode.tags ?? [],
      durationMs: episode.durationMs,
      createdAt: episode.createdAt ?? Date.now(),
      hits: 0,
      lastAccessAt: undefined,
      mergedCount: episode.mergedCount,
      meta: episode.meta,
    };
    this.records.push(ep);
    if (this.records.length > this.capacity) {
      // 超容时优先丢掉重要性最低且最久未访问的那条
      let worst = 0;
      for (let i = 1; i < this.records.length; i++) {
        if (score(this.records[i]) < score(this.records[worst])) worst = i;
      }
      this.records.splice(worst, 1);
    }
    return ep;
  }

  /** 关键词检索（计划书：task.includes）。此处同时扫 lesson 与 tags，并记命中次数。 */
  search(keyword: string): Episode[] {
    if (!keyword) return [];
    const kw = keyword.toLowerCase();
    const hit = this.records.filter(
      (x) =>
        x.task.toLowerCase().includes(kw) ||
        x.lesson.toLowerCase().includes(kw) ||
        (x.tags ?? []).some((t) => t.toLowerCase().includes(kw)),
    );
    for (const h of hit) this.touch(h);
    return hit;
  }

  // ── 扩展 ──

  byId(id: string): Episode | undefined {
    return this.records.find((r) => r.id === id);
  }

  recent(n = 10): Episode[] {
    return this.records.slice(-n).reverse();
  }

  failures(): Episode[] {
    return this.records.filter((r) => r.outcome === 'failure');
  }

  successes(): Episode[] {
    return this.records.filter((r) => r.outcome === 'success');
  }

  /** 标记一条记忆被用到了 —— 提高其存活权重（§十 清理时参考）。 */
  touch(ep: Episode): void {
    ep.hits = (ep.hits ?? 0) + 1;
    ep.lastAccessAt = Date.now();
  }

  /** 用清理/压缩后的结果整体替换（供 Consolidation 调用）。 */
  replaceAll(next: Episode[]): void {
    this.records = next;
  }

  get size(): number {
    return this.records.length;
  }

  clear(): void {
    this.records = [];
  }

  /** B17 修复：序列化到 JSON 文件 */
  saveToFile(filePath: string): void {
    try {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify(this.records, null, 2), 'utf8');
    } catch { /* 非关键 */ }
  }

  /** B17 修复：从 JSON 文件反序列化 */
  loadFromFile(filePath: string): void {
    try {
      if (!fs.existsSync(filePath)) return;
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (!Array.isArray(raw)) return;
      this.records = raw;
    } catch { /* 文件损坏时静默跳过 */ }
  }

  stats(): EpisodeStats {
    const counts: Record<EpisodeOutcome, number> = { success: 0, failure: 0, partial: 0, unknown: 0 };
    const taskCount = new Map<string, number>();
    let durSum = 0;
    let durN = 0;
    for (const r of this.records) {
      counts[r.outcome ?? 'unknown']++;
      taskCount.set(r.task, (taskCount.get(r.task) ?? 0) + 1);
      if (typeof r.durationMs === 'number') {
        durSum += r.durationMs;
        durN++;
      }
    }
    const topTasks = [...taskCount.entries()]
      .map(([task, count]) => ({ task, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
    return {
      total: this.records.length,
      success: counts.success,
      failure: counts.failure,
      partial: counts.partial,
      unknown: counts.unknown,
      avgDurationMs: durN ? Math.round(durSum / durN) : 0,
      topTasks,
    };
  }
}

/** 失败比成功更值得记住（教训稀缺），有 lesson 的再加权。 */
function defaultImportance(ep: Partial<Episode>): number {
  const outcome = ep.outcome ?? inferOutcome(ep.result);
  let v = outcome === 'failure' ? 0.75 : outcome === 'success' ? 0.55 : 0.4;
  if (ep.lesson && ep.lesson.length > 8) v += 0.15;
  return Math.min(1, Number(v.toFixed(2)));
}

/** 存活评分：重要性 + 命中热度 - 年龄惩罚。 */
function score(ep: Episode): number {
  const ageDays = (Date.now() - (ep.createdAt ?? 0)) / 86_400_000;
  return (ep.importance ?? 0.5) + Math.min(0.5, (ep.hits ?? 0) * 0.05) - Math.min(0.4, ageDays * 0.01);
}

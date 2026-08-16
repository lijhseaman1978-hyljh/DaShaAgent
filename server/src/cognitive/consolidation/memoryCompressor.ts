// cognitive/consolidation/memoryCompressor.ts
// V3 Phase 3 - Step 5 §十：Memory Consolidation —— 压缩器
//
// 计划书原型：
//   class MemoryCompressor {
//     compress(records) { /* 合并重复经验 */ }
//   }
//
// "合并重复经验"的关键是先定义**什么算重复**。这里给两级判定：
//   1. 结构相似：task 归一化后的 token Jaccard 相似度
//   2. 结果一致：outcome 相同（成功和失败绝不能合并成一条）
// 命中即合并为一条"代表记录"，mergedCount 累加，importance 取上界 ——
// 同一件事反复发生，说明它比一次性事件更值得记住。
//
// 合并时保留最有信息量的 lesson（最长的那条），
// actions 取最近一次（最可能是当前有效路径）。

import type { Episode } from '../core/episodicMemory';
import { tokenizeText } from '../vector/embedding';

export interface CompressOptions {
  /** Jaccard 相似度阈值，超过即视为同类经验 */
  similarity?: number;
  /** 只合并同 outcome 的记录，默认 true */
  requireSameOutcome?: boolean;
  /** 单个簇最多吸收多少条，防止把所有东西压成一坨 */
  maxClusterSize?: number;
}

export interface CompressReport {
  compressed: Episode[];
  before: number;
  after: number;
  /** 合并了哪些 id → 代表 id */
  merges: Array<{ into: string; absorbed: string[]; task: string }>;
}

/** 两个 token 集合的 Jaccard 相似度。 */
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

export class MemoryCompressor {
  constructor(private defaults: CompressOptions = {}) {}

  /**
   * 计划书原型 API：压缩情景记忆，返回压缩后的数组。
   */
  compress(records: Episode[], opts: CompressOptions = {}): Episode[] {
    return this.compressEpisodes(records, opts).compressed;
  }

  /** 完整版：带合并明细，便于在 Memory Center 展示"哪几条被归并了"。 */
  compressEpisodes(records: Episode[], opts: CompressOptions = {}): CompressReport {
    const o = { ...this.defaults, ...opts };
    const threshold = o.similarity ?? 0.72;
    const sameOutcome = o.requireSameOutcome !== false;
    const maxCluster = o.maxClusterSize ?? 50;

    // 时间正序，让"代表记录"从最早那条开始，后来的被吸收进去
    const sorted = [...records].sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));

    const reps: Array<{ ep: Episode; tokens: Set<string>; absorbed: string[] }> = [];

    for (const r of sorted) {
      const tokens = new Set(tokenizeText(r.task ?? ''));
      let target: (typeof reps)[number] | undefined;
      let best = 0;

      for (const rep of reps) {
        if (rep.absorbed.length + 1 >= maxCluster) continue;
        if (sameOutcome && (rep.ep.outcome ?? 'unknown') !== (r.outcome ?? 'unknown')) continue;
        const sim = jaccard(tokens, rep.tokens);
        if (sim >= threshold && sim > best) {
          best = sim;
          target = rep;
        }
      }

      if (target) {
        this.mergeInto(target.ep, r);
        target.absorbed.push(r.id);
        for (const t of tokens) target.tokens.add(t);
      } else {
        // 深拷贝一层，避免压缩结果反向污染原数组
        reps.push({ ep: { ...r, tags: r.tags ? [...r.tags] : undefined }, tokens, absorbed: [] });
      }
    }

    const merges = reps
      .filter((r) => r.absorbed.length > 0)
      .map((r) => ({ into: r.ep.id, absorbed: r.absorbed, task: r.ep.task }));

    return {
      compressed: reps.map((r) => r.ep),
      before: records.length,
      after: reps.length,
      merges,
    };
  }

  /** 把 src 的信息量并入 rep（就地修改 rep）。 */
  private mergeInto(rep: Episode, src: Episode): void {
    rep.mergedCount = (rep.mergedCount ?? 1) + (src.mergedCount ?? 1);
    rep.hits = (rep.hits ?? 0) + (src.hits ?? 0);

    // 重要性取上界：反复出现本身就抬升权重
    const boosted = Math.min(1, Math.max(rep.importance ?? 0.5, src.importance ?? 0.5) + 0.05);
    rep.importance = boosted;

    // lesson 取信息量更大的（更长的那条通常更具体）
    if ((src.lesson?.length ?? 0) > (rep.lesson?.length ?? 0)) rep.lesson = src.lesson;

    // actions / result 取最近一次（更可能反映当前有效路径）
    if ((src.createdAt ?? 0) >= (rep.createdAt ?? 0)) {
      rep.actions = src.actions;
      rep.result = src.result;
      rep.lastAccessAt = Math.max(rep.lastAccessAt ?? 0, src.lastAccessAt ?? 0);
    }

    // 耗时取均值，代表这类任务的典型成本
    const a = rep.durationMs;
    const b = src.durationMs;
    if (typeof a === 'number' && typeof b === 'number') rep.durationMs = Math.round((a + b) / 2);
    else rep.durationMs = a ?? b;

    if (src.tags?.length) {
      const set = new Set([...(rep.tags ?? []), ...src.tags]);
      rep.tags = [...set];
    }
  }
}

export const memoryCompressor = new MemoryCompressor();

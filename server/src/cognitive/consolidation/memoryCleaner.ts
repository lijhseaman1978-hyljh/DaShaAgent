// cognitive/consolidation/memoryCleaner.ts
// V3 Phase 3 - Step 5 §十：Memory Consolidation —— 清理器
//
// 计划书原型：
//   class MemoryCleaner {
//     clean(records) { return records.filter(r => r.importance > 0.3) }
//   }
//
// 原型的问题：importance 是**静态**的，写入时打多少分就永远是多少分。
// 真实的记忆固化（睡眠期 consolidation）是三个力的叠加：
//   1. 重要性  —— 本来就关键的事记得牢
//   2. 时间衰减 —— 越久远越淡，指数衰减
//   3. 复述强化 —— 被反复回忆（hits）的会重新变强
// 所以这里用 retentionScore = importance × decay(age) + hitBoost，
// 低于阈值才淘汰。clean() 的签名与计划书保持一致（传入数组、返回保留数组）。
//
// 另有一条硬规则：**失败经验永不自动清理**。
// 教训是最贵的资产，AGENT 靠失败样本才能不重复踩坑。

import type { Episode } from '../core/episodicMemory';
import type { Knowledge } from '../core/semanticMemory';

/** 半衰期：默认 14 天，即 14 天后 decay 系数降到 0.5 */
const DEFAULT_HALF_LIFE_MS = 14 * 24 * 60 * 60 * 1000;

export interface CleanOptions {
  /** 保留阈值，低于此分数被淘汰。计划书默认 0.3 */
  threshold?: number;
  /** 半衰期（毫秒） */
  halfLifeMs?: number;
  /** 是否保护失败经验（教训），默认 true */
  keepFailures?: boolean;
  /** 保底保留最近 N 条，避免冷启动时把刚写入的全清了 */
  keepRecent?: number;
  /** 只算分不真删，用于 Dashboard 预览 */
  dryRun?: boolean;
  /** 评分基准时间，测试可注入 */
  now?: number;
}

export interface CleanReport<T> {
  kept: T[];
  removed: T[];
  /** 每条的评分明细，便于在 Memory Center 里解释"为什么被清理" */
  scores: Array<{ id: string; score: number; reason: string }>;
  before: number;
  after: number;
}

/** 指数衰减：age 每过一个半衰期，系数减半。 */
export function decayFactor(ageMs: number, halfLifeMs = DEFAULT_HALF_LIFE_MS): number {
  if (ageMs <= 0) return 1;
  return Math.pow(0.5, ageMs / halfLifeMs);
}

export class MemoryCleaner {
  constructor(private defaults: CleanOptions = {}) {}

  /**
   * 计划书原型 API：清理情景记忆，返回**保留下来**的记录。
   * 与原型行为一致（返回数组），但评分逻辑升级为动态保留分。
   */
  clean(records: Episode[], opts: CleanOptions = {}): Episode[] {
    return this.cleanEpisodes(records, opts).kept;
  }

  /** 完整版：连同淘汰名单与评分明细一起返回。 */
  cleanEpisodes(records: Episode[], opts: CleanOptions = {}): CleanReport<Episode> {
    const o = { ...this.defaults, ...opts };
    const threshold = o.threshold ?? 0.3;
    const halfLife = o.halfLifeMs ?? DEFAULT_HALF_LIFE_MS;
    const keepFailures = o.keepFailures !== false;
    const keepRecent = o.keepRecent ?? 20;
    const now = o.now ?? Date.now();

    // 最近 N 条一律豁免
    const sortedByTime = [...records].sort(
      (a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0),
    );
    const exempt = new Set(sortedByTime.slice(0, keepRecent).map((r) => r.id));

    const kept: Episode[] = [];
    const removed: Episode[] = [];
    const scores: CleanReport<Episode>['scores'] = [];

    for (const r of records) {
      const score = this.scoreEpisode(r, now, halfLife);

      let keep = score >= threshold;
      let reason = keep ? `score ${score.toFixed(3)} >= ${threshold}` : `score ${score.toFixed(3)} < ${threshold}`;

      if (!keep && keepFailures && r.outcome === 'failure') {
        keep = true;
        reason = 'protected: failure lesson';
      }
      if (!keep && exempt.has(r.id)) {
        keep = true;
        reason = `protected: recent ${keepRecent}`;
      }

      scores.push({ id: r.id, score, reason });
      (keep ? kept : removed).push(r);
    }

    return { kept, removed, scores, before: records.length, after: kept.length };
  }

  /**
   * 保留分 = importance × decay(age) + 命中加成
   * 命中加成用 log 压缩，防止某条被反复 recall 就永远置顶。
   */
  scoreEpisode(r: Episode, now = Date.now(), halfLifeMs = DEFAULT_HALF_LIFE_MS): number {
    const importance = clamp01(r.importance ?? 0.5);
    const age = now - (r.lastAccessAt ?? r.createdAt ?? now);
    const decay = decayFactor(age, halfLifeMs);
    const hitBoost = Math.min(0.35, Math.log2(1 + (r.hits ?? 0)) * 0.12);
    // 被压缩合并过的记录代表"同类事件发生多次"，本身即是重要信号
    const mergeBoost = Math.min(0.2, ((r.mergedCount ?? 1) - 1) * 0.05);
    return clamp01(importance * decay + hitBoost + mergeBoost);
  }

  /**
   * 语义知识的清理：低置信度 + 长期无强化的规则会被遗忘。
   * 知识比事件更值得留，所以阈值默认更低（0.2）。
   */
  cleanKnowledge(items: Knowledge[], opts: CleanOptions = {}): CleanReport<Knowledge> {
    const o = { ...this.defaults, ...opts };
    const threshold = o.threshold ?? 0.2;
    const halfLife = o.halfLifeMs ?? DEFAULT_HALF_LIFE_MS * 3; // 知识衰减更慢
    const now = o.now ?? Date.now();

    const kept: Knowledge[] = [];
    const removed: Knowledge[] = [];
    const scores: CleanReport<Knowledge>['scores'] = [];

    for (const k of items) {
      const decay = decayFactor(now - (k.updatedAt ?? k.createdAt ?? now), halfLife);
      const reinforceBoost = Math.min(0.4, Math.log2(1 + (k.reinforced ?? 0)) * 0.15);
      const score = clamp01(clamp01(k.confidence ?? 0.5) * decay + reinforceBoost);
      const keep = score >= threshold;
      scores.push({
        id: k.id,
        score,
        reason: keep ? `score ${score.toFixed(3)} >= ${threshold}` : `faded below ${threshold}`,
      });
      (keep ? kept : removed).push(k);
    }

    return { kept, removed, scores, before: items.length, after: kept.length };
  }
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

export const memoryCleaner = new MemoryCleaner();

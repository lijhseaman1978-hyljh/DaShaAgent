// learning/memoryConsolidation.ts
// Memory Consolidation — 记忆整合（类似人类睡眠时的记忆整理）
// 短期记忆 → 筛选重要经验 → 长期记忆 → 知识图谱更新
// V5.0 Step 4：Universal Learning Engine

import { logger } from '../observability';

export interface MemoryItem {
  id: string;
  topic: string;
  content: string;
  importance: number;       // 0-1
  accessCount: number;
  createdAt: number;
  lastAccessedAt: number;
  tags: string[];
}

export class MemoryConsolidation {
  private shortTerm: MemoryItem[] = [];    // 短期（24h 内）
  private longTerm: MemoryItem[] = [];     // 长期
  private readonly shortTermRetention = 24 * 3600 * 1000; // 24 小时
  private readonly maxShortTerm = 200;
  private readonly maxLongTerm = 1000;

  /** 添加短期记忆 */
  add(item: Omit<MemoryItem, 'id' | 'accessCount' | 'lastAccessedAt'>) {
    if (this.shortTerm.length >= this.maxShortTerm) {
      // 触发紧急整合
      this.consolidate();
    }

    const memory: MemoryItem = {
      ...item,
      id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      accessCount: 1,
      lastAccessedAt: Date.now(),
    };

    this.shortTerm.push(memory);
  }

  /** 批量添加 */
  addMany(items: Array<Omit<MemoryItem, 'id' | 'accessCount' | 'lastAccessedAt'>>) {
    for (const item of items) this.add(item);
  }

  /** 访问记忆（增加访问计数） */
  access(id: string): MemoryItem | undefined {
    const item = this.shortTerm.find(m => m.id === id) || this.longTerm.find(m => m.id === id);
    if (item) {
      item.accessCount++;
      item.lastAccessedAt = Date.now();
    }
    return item;
  }

  /** 记忆整合：短期 → 长期 */
  consolidate(): number {
    const now = Date.now();
    let moved = 0;

    // 筛选条件：
    // 1. 重要性 > 0.5 的短期记忆 → 移到长期
    // 2. 过期（超过 24h）且重要的短期记忆 → 移到长期
    // 3. 其他过期记忆 → 丢弃

    const toMove: MemoryItem[] = [];
    const toKeep: MemoryItem[] = [];

    for (const item of this.shortTerm) {
      const age = now - item.createdAt;
      const isExpired = age > this.shortTermRetention;

      if (item.importance >= 0.6 || (isExpired && item.importance >= 0.4)) {
        toMove.push(item);
      } else if (!isExpired) {
        toKeep.push(item);
      }
      // 其他：丢弃
    }

    // 移到长期记忆（合并重复）
    for (const item of toMove) {
      const existing = this.longTerm.find(l =>
        l.topic === item.topic && this.overlapTags(l.tags, item.tags) >= 2
      );
      if (existing) {
        // 合并：提升重要性，更新内容
        existing.importance = Math.min(1, (existing.importance + item.importance) / 2 + 0.1);
        existing.accessCount += item.accessCount;
        existing.lastAccessedAt = now;
        existing.tags = [...new Set([...existing.tags, ...item.tags])];
        if (item.content.length > existing.content.length) {
          existing.content = item.content;
        }
      } else {
        this.longTerm.push(item);
      }
    }

    // 长期记忆容量控制
    if (this.longTerm.length > this.maxLongTerm) {
      // 按 "重要性 × 访问频率" 排序，保留前 maxLongTerm
      this.longTerm.sort((a, b) =>
        (b.importance * Math.log(b.accessCount + 1)) -
        (a.importance * Math.log(a.accessCount + 1))
      );
      this.longTerm = this.longTerm.slice(0, this.maxLongTerm);
    }

    this.shortTerm = toKeep;
    moved = toMove.length;
    const discarded = this.shortTerm.length + toMove.length - toKeep.length - moved;

    logger.info('MemoryConsolidation', `Consolidated: ${moved} → long-term, ${toKeep.length} kept, ~${discarded} discarded`);
    return moved;
  }

  /** 搜索记忆 */
  search(query: string): MemoryItem[] {
    const lower = query.toLowerCase();
    const all = [...this.shortTerm, ...this.longTerm];

    return all
      .filter(m =>
        m.topic.toLowerCase().includes(lower) ||
        m.content.toLowerCase().includes(lower) ||
        m.tags.some(t => t.toLowerCase().includes(lower))
      )
      .sort((a, b) => b.importance - a.importance)
      .slice(0, 20);
  }

  /** 按标签搜索 */
  byTag(tag: string): MemoryItem[] {
    const all = [...this.shortTerm, ...this.longTerm];
    return all
      .filter(m => m.tags.some(t => t.toLowerCase().includes(tag.toLowerCase())))
      .sort((a, b) => b.lastAccessedAt - a.lastAccessedAt);
  }

  /** 导出可持久化的数据 */
  export() {
    return {
      shortTerm: this.shortTerm,
      longTerm: this.longTerm,
    };
  }

  /** 导入 */
  import(data: { shortTerm: MemoryItem[]; longTerm: MemoryItem[] }) {
    this.shortTerm = data.shortTerm || [];
    this.longTerm = data.longTerm || [];
  }

  /** 统计 */
  stats() {
    const all = [...this.shortTerm, ...this.longTerm];
    const avgImportance = all.length > 0
      ? all.reduce((s, m) => s + m.importance, 0) / all.length
      : 0;

    const tags = new Map<string, number>();
    for (const m of this.longTerm) {
      for (const t of m.tags) {
        tags.set(t, (tags.get(t) || 0) + 1);
      }
    }
    const topTags = [...tags.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    return {
      shortTerm: this.shortTerm.length,
      longTerm: this.longTerm.length,
      avgImportance: avgImportance.toFixed(2),
      topTags: Object.fromEntries(topTags),
    };
  }

  private overlapTags(a: string[], b: string[]): number {
    const setB = new Set(b);
    return a.filter(t => setB.has(t)).length;
  }
}

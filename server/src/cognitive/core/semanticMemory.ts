// cognitive/core/semanticMemory.ts
// V3 Phase 3 - Step 5 §六：Semantic Memory（语义记忆 / 提炼后的知识）
//
// 计划书对"事件 vs 知识"的界定：
//   事件：我修复过一次 React 卡顿          → Episodic
//   知识：React 性能优化需要减少 state 更新 → Semantic
//
// 计划书原型：
//   class SemanticMemory { knowledge:any[]; add(concept, rule); query(concept) }
// 本实现保持 knowledge / add / query 完全兼容，并补齐：
//   · 置信度累积 —— 同一条规则被反复验证会升信心，这是"经验固化"的关键
//   · 来源溯源 sources[] —— 指回产生该知识的 Episode，可解释
//   · 模糊 search()，因为 query() 是精确匹配 concept
//
// 与既有 memory/semantic/semanticMemory.ts（V2，any[] + JSON 子串匹配）并存。

export interface Knowledge {
  id: string;
  concept: string;
  rule: string;
  /** 0..1，被重复验证会上升，被反例冲击会下降 */
  confidence: number;
  /** 该知识被印证的次数 */
  reinforced: number;
  /** 溯源到的 Episode id */
  sources: string[];
  tags?: string[];
  createdAt: number;
  updatedAt: number;
}

let kSeq = 0;
function nextKnowledgeId(): string {
  return `kn_${Date.now().toString(36)}_${(++kSeq).toString(36)}`;
}

function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

export interface AddKnowledgeOptions {
  confidence?: number;
  sourceId?: string;
  tags?: string[];
}

export class SemanticMemory {
  /** 计划书直接暴露 knowledge 数组，保持一致 */
  knowledge: Knowledge[] = [];

  private index = new Map<string, Knowledge>(); // `${concept}|${rule}` → Knowledge

  // ── 计划书原型 API ──

  /**
   * 加入一条知识。若 (concept, rule) 已存在则**强化**而非重复插入 ——
   * 这正是人类"同一个道理被反复验证后更加确信"的建模。
   */
  add(concept: string, rule: string, opts: AddKnowledgeOptions = {}): Knowledge {
    const key = `${normalize(concept)}|${normalize(rule)}`;
    const existing = this.index.get(key);
    if (existing) {
      existing.reinforced++;
      existing.confidence = Math.min(0.99, Number((existing.confidence + (1 - existing.confidence) * 0.35).toFixed(3)));
      existing.updatedAt = Date.now();
      if (opts.sourceId && !existing.sources.includes(opts.sourceId)) existing.sources.push(opts.sourceId);
      if (opts.tags) for (const t of opts.tags) if (!existing.tags?.includes(t)) (existing.tags ??= []).push(t);
      return existing;
    }
    const k: Knowledge = {
      id: nextKnowledgeId(),
      concept,
      rule,
      confidence: opts.confidence ?? 0.5,
      reinforced: 1,
      sources: opts.sourceId ? [opts.sourceId] : [],
      tags: opts.tags ?? [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.knowledge.push(k);
    this.index.set(key, k);
    return k;
  }

  /** 按概念精确查询（计划书：x.concept === concept）。 */
  query(concept: string): Knowledge[] {
    const c = normalize(concept);
    return this.knowledge.filter((x) => normalize(x.concept) === c);
  }

  // ── 扩展 ──

  /** 模糊检索：concept / rule / tags 任一命中，按置信度排序。 */
  search(text: string, limit = 10): Knowledge[] {
    if (!text) return [];
    const t = normalize(text);
    const words = t.split(' ').filter((w) => w.length > 1);
    return this.knowledge
      .map((k) => {
        const hay = normalize(`${k.concept} ${k.rule} ${(k.tags ?? []).join(' ')}`);
        let s = 0;
        if (hay.includes(t)) s += 2;
        for (const w of words) if (hay.includes(w)) s += 1;
        return { k, s: s * (0.5 + k.confidence / 2) };
      })
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, limit)
      .map((x) => x.k);
  }

  /** 反例冲击：某条知识被证伪时降低置信度，跌破阈值则淘汰。 */
  weaken(id: string, factor = 0.5): boolean {
    const k = this.knowledge.find((x) => x.id === id);
    if (!k) return false;
    k.confidence = Number((k.confidence * factor).toFixed(3));
    k.updatedAt = Date.now();
    if (k.confidence < 0.15) {
      this.remove(id);
      return false;
    }
    return true;
  }

  remove(id: string): boolean {
    const i = this.knowledge.findIndex((x) => x.id === id);
    if (i < 0) return false;
    const [k] = this.knowledge.splice(i, 1);
    this.index.delete(`${normalize(k.concept)}|${normalize(k.rule)}`);
    return true;
  }

  /** 高置信知识 —— 组 prompt 时优先注入这些。 */
  top(n = 10): Knowledge[] {
    return [...this.knowledge].sort((a, b) => b.confidence - a.confidence || b.reinforced - a.reinforced).slice(0, n);
  }

  concepts(): string[] {
    return [...new Set(this.knowledge.map((k) => k.concept))];
  }

  getAll(): Knowledge[] {
    return this.knowledge;
  }

  get size(): number {
    return this.knowledge.length;
  }

  clear(): void {
    this.knowledge = [];
    this.index.clear();
  }
}

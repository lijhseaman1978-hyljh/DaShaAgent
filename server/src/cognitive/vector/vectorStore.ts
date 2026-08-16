// cognitive/vector/vectorStore.ts
// V3 Phase 3 - Step 5 §八：Vector Store（向量库）
//
// 计划书原型：
//   class VectorStore { items:any[]; async add(text, vector); search(vector){ return items.slice(0,5) } }
//   并注明"未来接 Milvus / Qdrant / Chroma / FAISS"。
//
// 计划书的 search 是 slice(0,5)（占位），本实现改为真实 top-k 余弦检索并支持阈值，
// 否则 §十二 的 "Recall Memory" 环节拿到的就是任意 5 条，语义召回名存实亡。
//
// 命名说明：既有 memory/vector.ts 已有一个 VectorStore（文件持久化 + Ollama embed），
// 两者并存、互不引用；本模块在 index 中同时以 CognitiveVectorStore 别名导出以便区分。

import { cosine, hashEmbed } from './embedding';

export interface VectorItem {
  id: string;
  text: string;
  vector: number[];
  meta?: Record<string, unknown>;
  createdAt: number;
}

export interface SearchHit {
  id: string;
  text: string;
  score: number;
  meta?: Record<string, unknown>;
}

export interface VectorSearchOptions {
  k?: number;
  /** 相似度下限，低于此值不返回（默认 0，即不过滤） */
  minScore?: number;
  /** 只在 meta 匹配时命中 */
  filter?: (meta: Record<string, unknown> | undefined) => boolean;
}

let vSeq = 0;
function nextVectorId(): string {
  return `vec_${Date.now().toString(36)}_${(++vSeq).toString(36)}`;
}

export class VectorStore {
  /** 计划书直接暴露 items，保持一致 */
  items: VectorItem[] = [];

  constructor(private capacity = 5000) {}

  // ── 计划书原型 API ──

  /**
   * 写入一条向量。id 缺省时自动生成。
   * 防御：vector 为空/0 维时用 hashEmbed 兜底补全（2026-08-13 修复，
   * 根治 writeNote 传 [] 导致 0 维向量 + CosineWARN 刷屏的问题）。
   */
  async add(text: string, vector: number[], meta?: Record<string, unknown>, id?: string): Promise<VectorItem> {
    let vec = vector;
    if (!vec || vec.length === 0) {
      vec = hashEmbed(text || '');
    }
    const item: VectorItem = {
      id: id ?? nextVectorId(),
      text,
      vector: vec,
      meta,
      createdAt: Date.now(),
    };
    const existing = id ? this.items.findIndex((i) => i.id === id) : -1;
    if (existing >= 0) this.items[existing] = item;
    else this.items.push(item);

    if (this.items.length > this.capacity) this.items.shift();
    return item;
  }

  /** 相似度检索：真 top-k 余弦，而非计划书的 slice(0,5)。 */
  search(vector: number[], opts: VectorSearchOptions | number = {}): SearchHit[] {
    const o: VectorSearchOptions = typeof opts === 'number' ? { k: opts } : opts;
    const k = o.k ?? 5;
    const minScore = o.minScore ?? 0;
    const pool = o.filter ? this.items.filter((i) => o.filter!(i.meta)) : this.items;
    return pool
      .map((i) => ({ id: i.id, text: i.text, score: cosine(vector, i.vector), meta: i.meta }))
      .filter((h) => h.score > minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }

  // ── 扩展 ──

  byId(id: string): VectorItem | undefined {
    return this.items.find((i) => i.id === id);
  }

  remove(id: string): boolean {
    const i = this.items.findIndex((x) => x.id === id);
    if (i < 0) return false;
    this.items.splice(i, 1);
    return true;
  }

  /** 按 meta 谓词批量删除（Consolidation 清理时用）。 */
  removeWhere(pred: (item: VectorItem) => boolean): number {
    const before = this.items.length;
    this.items = this.items.filter((i) => !pred(i));
    return before - this.items.length;
  }

  get size(): number {
    return this.items.length;
  }

  clear(): void {
    this.items = [];
  }

  /** 导出为可 JSON 持久化的结构（未来接 Qdrant/Milvus 时作为迁移源）。 */
  dump(): VectorItem[] {
    return this.items;
  }

  load(items: VectorItem[]): void {
    // 防御：加载时自动修复 0 维/空向量（2026-08-13），保证内存永远无 0 维向量
    this.items = (items || []).map((i) =>
      (!i.vector || i.vector.length === 0) ? { ...i, vector: hashEmbed(i.text || '') } : i
    );
  }

  stats(): { size: number; capacity: number; dim: number } {
    return { size: this.items.length, capacity: this.capacity, dim: this.items[0]?.vector.length ?? 0 };
  }
}

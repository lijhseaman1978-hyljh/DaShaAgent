import fs from 'node:fs';
import path from 'node:path';
import { CONFIG, ensureDir } from '../config';

interface VectorItem {
  id: string;
  text: string;
  vector?: number[];
  meta?: any;
}

// 轻量向量库：优先用外部 embed 函数（Ollama），不可用时退化为关键词重叠评分。
export class VectorStore {
  private file: string;
  private items: VectorItem[] = [];

  constructor(name = 'default') {
    this.file = path.join(CONFIG.VECTOR_DIR, name + '.json');
    this.load();
  }

  private load() {
    try { this.items = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { this.items = []; }
  }
  private save() {
    ensureDir(CONFIG.VECTOR_DIR);
    fs.writeFileSync(this.file, JSON.stringify(this.items, null, 2), 'utf8');
  }

  // 合并写盘：多次 add 在 50ms 内只落一次盘，避免 O(n²) IO（#6）
  private saveScheduled = false;
  private scheduleSave() {
    if (this.saveScheduled) return;
    this.saveScheduled = true;
    setTimeout(() => { this.saveScheduled = false; this.save(); }, 50);
  }

  // 显式落盘（在需要立即持久化的场景调用）
  flush() { this.saveScheduled = false; this.save(); }

  // 去重查询：文本已存在则跳过（2026-08-13，防 RAG 重启重复摄入）
  hasText(text: string): boolean {
    return this.items.some(i => i.text === text);
  }

  async add(text: string, meta: any = {}, embed?: (t: string) => Promise<number[]>): Promise<void> {
    const id = 'v_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    let vector: number[] | undefined;
    if (embed) {
      try {
        vector = await embed(text);
      } catch (err: any) {
        console.warn(`[WARN] VectorStore embed failed for "${text.slice(0, 60)}...": ${err?.message || err}`);
        vector = undefined;
      }
    }
    this.items.push({ id, text, vector, meta });
    this.scheduleSave();
  }

  // 按主题删除所有向量条目（笔记覆盖/删除后保持同步，#5）
  removeByTopic(topic: string) {
    this.items = this.items.filter(i => !(i.meta && i.meta.topic === topic));
    this.scheduleSave();
  }

  async search(query: string, k = 5, embed?: (t: string) => Promise<number[]>): Promise<VectorItem[]> {
    if (!this.items.length) return [];
    let vectorsReady = this.items.every(i => i.vector && i.vector.length);
    if (embed && !vectorsReady) {
      // 尝试补全缺失向量
      for (const it of this.items) if (!it.vector) it.vector = await embed(it.text).catch(() => undefined);
      this.save();
      vectorsReady = this.items.every(i => i.vector && i.vector.length);
    }
    if (embed && vectorsReady) {
      const qv = await embed(query).catch(() => undefined);
      if (qv) {
        const scored = this.items
          .filter(i => i.vector)
          .map(i => ({ i, s: cosine(qv, i.vector!) }))
          .sort((a, b) => b.s - a.s)
          .slice(0, k);
        return scored.map(x => x.i);
      }
    }
    // 关键词兜底
    const qw = tokenize(query);
    const scored = this.items
      .map(i => ({ i, s: overlap(tokenize(i.text), qw) }))
      .filter(x => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, k);
    return scored.map(x => x.i);
  }
}

function tokenize(s: string): string[] {
  return (s.toLowerCase().match(/[a-z0-9\u4e00-\u9fa5]+/g) || []);
}
function overlap(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const set = new Set(a);
  let c = 0;
  for (const w of b) if (set.has(w)) c++;
  return c;
}
function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    console.warn(`[WARN] VectorStore cosine: dimension mismatch (${a.length} vs ${b.length}), returning 0. This may indicate embed model change without re-indexing.`);
    return 0;
  }
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

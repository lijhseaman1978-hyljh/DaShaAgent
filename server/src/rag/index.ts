import fs from 'node:fs';
import path from 'node:path';
import { CONFIG, ensureDir } from '../config';
import { VectorStore } from '../memory/vector';
import type { Provider } from '../core/types';

// 简易 RAG：摄入 data/knowledge 下的 .txt/.md/.json，切块后向量化检索。
export class RAG {
  private store = new VectorStore('rag');
  private provider: Provider | null = null;
  private ingested = false;

  setProvider(p: Provider) { this.provider = p; }

  ingestOnce(): void {
    if (this.ingested) return;
    this.ingested = true;
    const dir = CONFIG.KNOWLEDGE_DIR;
    let files: string[] = [];
    try {
      files = fs.readdirSync(dir).filter(f => /\.(txt|md|json)$/i.test(f));
    } catch { return; }
    const embed = this.provider?.embed?.bind(this.provider);
    let added = 0, skipped = 0;
    for (const f of files) {
      const fp = path.join(dir, f);
      let text = '';
      try { text = fs.readFileSync(fp, 'utf8'); } catch { continue; }
      const chunks = chunkText(text, 600);
      for (const c of chunks) {
        const full = `[${f}] ${c}`;
        // 幂等摄入（2026-08-13）：已存在的文本跳过，避免重启后重复摄入翻倍
        if (this.store.hasText(full)) { skipped++; continue; }
        this.store.add(full, { file: f }, embed).catch(() => {});
        added++;
      }
    }
    console.log(`[RAG] ingestOnce: +${added} 新增, ${skipped} 已存在跳过 (共 ${files.length} 文件)`);
    // 触发一次向量补全（若 embed 可用）
    if (embed) {
      // search 内部会补全缺失向量
      this.store.search('warmup', 1, embed).catch(() => {});
    }
  }

  async retrieve(query: string, k = 4): Promise<string[]> {
    this.ingestOnce();
    const embed = this.provider?.embed?.bind(this.provider);
    const items = await this.store.search(query, k, embed);
    return items.map(i => i.text);
  }
}

function chunkText(text: string, size: number): string[] {
  const paras = text.split(/\n{2,}/).map(s => s.trim()).filter(Boolean);
  const chunks: string[] = [];
  let buf = '';
  let lastPara = '';  // P1-5: 重叠窗口
  for (const p of paras) {
    if ((buf + p).length > size) {
      if (buf) chunks.push(buf);
      buf = lastPara ? lastPara + '\n\n' + p : p;  // 前一末段作为上下文重叠
    } else {
      buf = buf ? buf + '\n\n' + p : p;
    }
    lastPara = p.length > 50 ? p.slice(-50) : p;
  }
  if (buf) chunks.push(buf);
  return chunks.length ? chunks : [text.slice(0, size)];
}

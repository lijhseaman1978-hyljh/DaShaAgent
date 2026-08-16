// cognitive/vector/embedding.ts
// V3 Phase 3 - Step 5 §七：Embedding Service（文本 → 向量）
//
// 计划书原型：
//   class EmbeddingService { async embed(text){ return [Math.random(),Math.random(),Math.random()]; } }
//   并注明"生产环境替换为 OpenAI / Gemini / BGE / M3E"。
//
// ⚠️ 本实现刻意不照抄随机数版本：随机向量之间的余弦相似度是纯噪声，
//    §八 的 similarity search 会退化成随机返回，整个语义召回链路无法自证。
//    因此离线兜底改用**确定性哈希嵌入**（hashing trick + 子词 n-gram），
//    它可复现、无依赖，且真的能反映词面重合度，足以让链路端到端跑通并被验证。
//
// 真实 Provider（Ollama / Cloud 的 embed()）通过 setProvider() 注入后自动优先使用，
// 失败时静默回落到哈希嵌入 —— 离线开发不阻塞。

export type EmbedFn = (text: string) => Promise<number[]>;

export interface EmbeddingStats {
  dim: number;
  calls: number;
  cacheHits: number;
  providerCalls: number;
  providerFailures: number;
  fallbackCalls: number;
  cacheSize: number;
  provider: string | null;
}

export class EmbeddingService {
  private provider: EmbedFn | null = null;
  private providerName: string | null = null;
  private cache = new Map<string, number[]>();

  private calls = 0;
  private cacheHits = 0;
  private providerCalls = 0;
  private providerFailures = 0;
  private fallbackCalls = 0;

  constructor(
    public readonly dim = 64,
    private cacheLimit = 2000,
  ) {}

  /** 注入真实 embedding（例如 provider.embed.bind(provider)）。 */
  setProvider(fn: EmbedFn | null, name = 'provider'): void {
    this.provider = fn;
    this.providerName = fn ? name : null;
    this.cache.clear(); // 换了模型，旧向量维度/语义空间都不同，必须弃用
  }

  hasProvider(): boolean {
    return this.provider != null;
  }

  /** 计划书原型 API：文本 → 向量。 */
  async embed(text: string): Promise<number[]> {
    this.calls++;
    const key = text;
    const cached = this.cache.get(key);
    if (cached) {
      this.cacheHits++;
      return cached;
    }

    let vec: number[] | null = null;
    if (this.provider) {
      this.providerCalls++;
      try {
        const v = await this.provider(text);
        if (Array.isArray(v) && v.length) vec = v;
      } catch {
        this.providerFailures++;
      }
    }
    if (!vec) {
      this.fallbackCalls++;
      vec = hashEmbed(text, this.dim);
    }

    this.remember(key, vec);
    return vec;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map((t) => this.embed(t)));
  }

  private remember(key: string, vec: number[]): void {
    if (this.cache.size >= this.cacheLimit) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(key, vec);
  }

  stats(): EmbeddingStats {
    return {
      dim: this.dim,
      calls: this.calls,
      cacheHits: this.cacheHits,
      providerCalls: this.providerCalls,
      providerFailures: this.providerFailures,
      fallbackCalls: this.fallbackCalls,
      cacheSize: this.cache.size,
      provider: this.providerName,
    };
  }

  clearCache(): void {
    this.cache.clear();
  }
}

// ── 确定性哈希嵌入 ──────────────────────────────────────────────
// 思路：把文本切成 token（中英混排）+ 字符二元组，用 FNV-1a 哈希把每个特征
// 投影到固定维度的桶里，带符号累加后做 L2 归一化。
// 同义不同词无法命中（那需要真模型），但词面相关性可靠且完全可复现。

export function tokenizeText(s: string): string[] {
  const lower = s.toLowerCase();
  const words = lower.match(/[a-z0-9_]+|[\u4e00-\u9fa5]/g) ?? [];
  const grams: string[] = [];
  // 中文单字信息量低，补二元组
  const han = lower.match(/[\u4e00-\u9fa5]{2,}/g) ?? [];
  for (const seg of han) {
    for (let i = 0; i < seg.length - 1; i++) grams.push(seg.slice(i, i + 2));
  }
  return [...words, ...grams];
}

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function hashEmbed(text: string, dim = 64): number[] {
  const vec = new Array<number>(dim).fill(0);
  const tokens = tokenizeText(text);
  if (!tokens.length) return vec;
  for (const t of tokens) {
    const h = fnv1a(t);
    const idx = h % dim;
    const sign = (h >>> 31) & 1 ? -1 : 1; // 有符号哈希，降低桶冲突带来的虚高相似度
    vec[idx] += sign;
  }
  return l2norm(vec);
}

export function l2norm(v: number[]): number[] {
  let n = 0;
  for (const x of v) n += x * x;
  if (n === 0) return v;
  const inv = 1 / Math.sqrt(n);
  return v.map((x) => x * inv);
}

export function cosine(a: number[], b: number[]): number {
  // B22: 维度不匹配时 WARN（静默截断是危险行为）
  if (a.length !== b.length) {
    console.warn(`[CosineWARN] dim mismatch: a=${a.length} b=${b.length} — using min dim`);
  }
  const len = Math.min(a.length, b.length);
  if (!len) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** 全局单例 —— runtime 启动时用真实 provider 覆盖。 */
export const embeddingService = new EmbeddingService();

/**
 * 两阶段工具加载（Deferred Tools + BM25 检索）
 * ────────────────────────────────────────────────────────────────────────────
 * 为什么需要：本 harness 实测 40 个工具、全量 schema 33.8k 字符，其中 27 个 skill_*
 * 就吃掉 25.9k（76%）。把这坨东西每轮都塞给模型有三重代价：
 *   1) 上下文成本：每一次推理往返都白烧 8k+ token；
 *   2) 选择噪声：弱模型在 40 个高度相似的候选里挑，误选率陡增（"读文件却调 skill_xlsx"）；
 *   3) 长上下文衰减：工具描述离用户问题越远，被"看见"的概率越低。
 *
 * 怎么做（对标 WorkBuddy 的 deferred tools 设计）：
 *   Phase 1 —— 只把 core 工具（fs_x / run_code / create_x 等 13 个）+ 命中可靠信号的
 *              deferred 工具 + 一个 `tool_search` 元工具交给模型。
 *              被隐藏的工具不是消失了，而是压缩成一行摘要写进 tool_search 的描述里，
 *              模型"知道它们存在"，只是暂时拿不到完整 schema。
 *   Phase 2 —— 模型判断需要某个能力时调 tool_search，检索命中的工具会被
 *              **激活到本会话**，下一轮就出现在真实 tools 数组里，可以直接 function-call。
 *
 * 检索用自研 BM25 而非 MiniSearch，理由：MiniSearch 默认分词器按空白/标点切词，
 * 对中文查询（"帮我生成一张海报"）会切成一整块，几乎必然召回失败。这里用
 * ASCII 词 + CJK unigram/bigram 混合分词，并复用 loader 里那份人工维护的中英别名表
 * 做查询扩展，中文提问也能命中英文技能描述。
 */
import type { ToolDef, ToolContext } from '../core/types';
import { registry } from './registry';
import { ALIASES } from '../skills/loader';

// ─── 分词 ───────────────────────────────────────────────────────────────────
// ASCII：抓 [a-z][a-z0-9]+，snake_case 天然被拆开（skill_agnes_ai_generation → agnes/ai/generation）
// CJK ：**只出 bigram**（中文检索的标准做法）。最初实现是 unigram+bigram 双发，实测噪声灾难性——
//       "存储空间占用分析" 里的单字"分""析""空"IDF 极低却照样贡献分数，把 email_workflow
//       顶到了 storage_audit 前面。改为纯 bigram 后单字噪声消失，跨词边界的伪 bigram
//       （"储空""间占"）因为 IDF 高、文档里几乎不出现，反而无害。长度为 1 的中文串才退回 unigram。
export function tokenize(text: string): string[] {
  const out: string[] = [];
  const lower = (text || '').toLowerCase();
  for (const m of lower.matchAll(/[a-z][a-z0-9]{1,}/g)) out.push(m[0]);
  for (const m of lower.matchAll(/[0-9]{2,}/g)) out.push(m[0]);
  for (const m of lower.matchAll(/[\u4e00-\u9fa5]+/g)) {
    const run = m[0];
    if (run.length === 1) { out.push(run); continue; }
    for (let i = 0; i + 1 < run.length; i++) out.push(run.slice(i, i + 2));
  }
  return out;
}

// 工具域同义词补充表。loader 的 ALIASES 是"中文意图 → 英文"，这里补两类它覆盖不到的：
//   1) 英文 ↔ 英文（用户说 excel，而 skill_xlsx 全篇只写 spreadsheet —— 实测检索完全落空）
//   2) 办公/系统类中文词（表格、重算、磁盘 等，ALIASES 偏创作向，没有这些）
// 键为 ASCII 时按 token 精确匹配，为中文时按子串包含匹配。
const SYNONYMS: Record<string, string[]> = {
  excel: ['spreadsheet', 'xlsx', 'sheet', 'csv', 'tabular', 'table'],
  word: ['docx', 'document'],
  ppt: ['pptx', 'slide', 'slides', 'presentation', 'deck'],
  sheet: ['spreadsheet', 'xlsx', 'excel'],
  disk: ['storage', 'drive', 'space', 'usage', 'audit'],
  '表格': ['spreadsheet', 'xlsx', 'excel', 'sheet', 'csv', 'tabular', 'table'],
  '重算': ['recalc', 'recalculate', 'formula', 'compute', 'spreadsheet', 'xlsx'],
  '公式': ['formula', 'recalc', 'spreadsheet', 'xlsx'],
  '文档': ['docx', 'document', 'word', 'pdf'],
  '幻灯': ['pptx', 'slide', 'presentation'],
  '演示': ['pptx', 'slide', 'presentation', 'deck'],
  '磁盘': ['disk', 'storage', 'drive', 'space', 'usage'],
  '存储': ['storage', 'disk', 'drive', 'space', 'usage'],
  '空间': ['space', 'storage', 'disk', 'usage'],
  '占用': ['usage', 'space', 'consumption', 'audit'],
  '清理': ['cleanup', 'clean', 'reclaim', 'duplicates'],
  '授权': ['auth', 'authentication', 'login', 'token', 'credential'],
  '登录': ['auth', 'login', 'authentication'],
  '定时': ['cron', 'schedule', 'scheduler', 'timer'],
  '爬虫': ['crawl', 'scrape', 'scraping', 'spider'],
  '浏览器': ['browser', 'playwright', 'selenium', 'chrome'],
};

// 查询扩展：中文意图词 / 英文同义词 → 索引侧真实用词。
// 技能描述基本是英文，用户提问基本是中文，不做这一步"生成图片"永远匹配不到 "image generation"。
function expandQuery(q: string): string[] {
  const toks = tokenize(q);
  const asciiSet = new Set(q.toLowerCase().match(/[a-z][a-z0-9]+/g) || []);
  const extra: string[] = [];
  for (const [zh, ens] of Object.entries(ALIASES)) {
    if (q.includes(zh)) extra.push(...ens);
  }
  for (const [k, vs] of Object.entries(SYNONYMS)) {
    const hit = /^[a-z]+$/.test(k) ? asciiSet.has(k) : q.includes(k);
    if (hit) extra.push(...vs);
  }
  return extra.length ? toks.concat(extra.flatMap((e) => tokenize(e))) : toks;
}

// ─── BM25 ───────────────────────────────────────────────────────────────────
const K1 = 1.2;
const B = 0.75;

interface Doc {
  name: string;
  tf: Map<string, number>;
  len: number;
}

class Bm25Index {
  private docs: Doc[] = [];
  private df = new Map<string, number>();
  private avgdl = 1;

  build(entries: Array<{ name: string; fields: Array<[string, number]> }>) {
    this.docs = [];
    this.df.clear();
    for (const e of entries) {
      const tf = new Map<string, number>();
      let len = 0;
      // 字段加权：把高权重字段的 token 重复计数，等价于 field boost，但不用改 BM25 公式
      for (const [text, weight] of e.fields) {
        for (const t of tokenize(text)) {
          tf.set(t, (tf.get(t) || 0) + weight);
          len += weight;
        }
      }
      this.docs.push({ name: e.name, tf, len });
      for (const t of tf.keys()) this.df.set(t, (this.df.get(t) || 0) + 1);
    }
    const total = this.docs.reduce((s, d) => s + d.len, 0);
    this.avgdl = this.docs.length ? total / this.docs.length : 1;
  }

  private idf(t: string): number {
    const n = this.docs.length;
    const df = this.df.get(t) || 0;
    return Math.log(1 + (n - df + 0.5) / (df + 0.5));
  }

  search(query: string, pool?: Set<string>): Array<{ name: string; score: number }> {
    const qt = expandQuery(query);
    if (!qt.length) return [];
    const seen = new Set<string>();
    const uniq = qt.filter((t) => (seen.has(t) ? false : (seen.add(t), true)));
    const hits: Array<{ name: string; score: number }> = [];
    for (const d of this.docs) {
      if (pool && !pool.has(d.name)) continue;
      let score = 0;
      for (const t of uniq) {
        const f = d.tf.get(t);
        if (!f) continue;
        score += this.idf(t) * ((f * (K1 + 1)) / (f + K1 * (1 - B + (B * d.len) / this.avgdl)));
      }
      if (score > 0) hits.push({ name: d.name, score });
    }
    hits.sort((a, b) => b.score - a.score);
    return hits;
  }
}

// 索引缓存：registry 版本号变化（有工具注册/注销）才重建，避免每轮请求都重新分词 40 个工具
let _index: Bm25Index | null = null;
let _indexedVersion = -1;

function getIndex(): Bm25Index {
  if (_index && _indexedVersion === registry.version) return _index;
  const idx = new Bm25Index();
  idx.build(
    registry.list().map((d) => ({
      name: d.name,
      fields: [
        [d.name.replace(/_/g, ' '), 4] as [string, number],  // 工具名权重最高
        [registry.summaryOf(d.name), 3] as [string, number], // 人工摘要次之
        [d.description, 1] as [string, number],              // 完整描述兜底
      ],
    })),
  );
  _index = idx;
  _indexedVersion = registry.version;
  return idx;
}

export function searchTools(query: string, opts: { limit?: number; pool?: Set<string> } = {}): ToolDef[] {
  const hits = getIndex().search(query, opts.pool).slice(0, opts.limit ?? 3);
  const byName = new Map(registry.list().map((d) => [d.name, d]));
  return hits.map((h) => byName.get(h.name)!).filter(Boolean);
}

// ─── 会话级激活表 ───────────────────────────────────────────────────────────
// tool_search 检索到的工具会被"激活"，下一轮起出现在真实 tools 数组中可直接调用。
// 跨轮保留（模型第二轮不必重新检索），但用 LRU 封顶，防止长会话把 schema 又撑回 33k。
const MAX_ACTIVE = 10;   // 单会话最多常驻几个被激活的 deferred 工具
const MAX_SESSIONS = 200; // 同时跟踪的会话上限，防止长跑服务里这张表无限增长
const _activated = new Map<string, string[]>(); // sessionId → 工具名（尾部为最近）

export function activateTools(sessionId: string, names: string[]): void {
  const cur = _activated.get(sessionId) || [];
  const next = cur.filter((n) => !names.includes(n)).concat(names);
  // 重新 set 会把该会话挪到 Map 迭代顺序末尾（JS Map 保序），天然形成 LRU
  _activated.delete(sessionId);
  _activated.set(sessionId, next.slice(-MAX_ACTIVE));
  while (_activated.size > MAX_SESSIONS) {
    const oldest = _activated.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    _activated.delete(oldest);
  }
}

export function getActivated(sessionId: string): Set<string> {
  return new Set(_activated.get(sessionId) || []);
}

export function clearActivated(sessionId: string): void {
  _activated.delete(sessionId);
}

// ─── 隐藏工具目录（压缩成一行一个，塞进 tool_search 描述）──────────────────
export const CATALOG_BUDGET = 2600; // 字符预算：约 700 token，换掉 25.9k 字符的全量 schema

export function deferredCatalog(defs: ToolDef[], budget = CATALOG_BUDGET): string {
  const lines: string[] = [];
  let used = 0;
  for (const d of defs) {
    const s = registry.summaryOf(d.name).replace(/\s+/g, ' ').trim();
    const line = `${d.name}: ${s.length > 76 ? s.slice(0, 76) + '…' : s}`;
    if (used + line.length + 1 > budget) {
      lines.push(`…（另有 ${defs.length - lines.length} 个未列出，可用 tool_search 按关键词检索）`);
      break;
    }
    lines.push(line);
    used += line.length + 1;
  }
  return lines.join('\n');
}

// ─── tool_search 元工具 ─────────────────────────────────────────────────────
const BASE_DESC =
  '检索并加载当前未展开的工具。下方 <deferred_tools> 列出了本环境存在、但为节省上下文暂未提供完整参数说明的工具；' +
  '它们**现在不能直接调用**，必须先用本工具把需要的那个加载进来，之后才可正常 function-call。\n' +
  '用法：已知工具名 → 传 tool_names（精确、优先）；不确定用哪个 → 传 queries（关键词，支持中文）。\n' +
  '注意：core 工具（fs_read / fs_write / fs_list / run_code / create_* 等）始终可直接调用，不需要也不应该来这里检索。';

export function registerToolSearchTool(): void {
  registry.register(
    {
      name: 'tool_search',
      description: BASE_DESC, // 运行时会被 toolsForRequest 替换成带 <deferred_tools> 目录的动态版本
      parameters: {
        type: 'object',
        properties: {
          tool_names: {
            type: 'array',
            items: { type: 'string' },
            description: '精确工具名列表，如 ["skill_agnes_ai_generation"]。知道名字时优先用这个。',
          },
          queries: {
            type: 'array',
            items: { type: 'string' },
            description: '关键词查询列表，如 ["生成海报","image generation"]。每条查询各自返回 top_k 个结果。',
          },
          top_k: { type: 'number', description: '每条查询返回的最大工具数（默认 3，上限 8）' },
        },
        required: [],
      },
    },
    async (a: any, ctx: ToolContext) => {
      const topK = Math.min(Math.max(Number(a?.top_k) || 3, 1), 8);
      const names: string[] = Array.isArray(a?.tool_names) ? a.tool_names.map(String) : [];
      const queries: string[] = Array.isArray(a?.queries)
        ? a.queries.map(String)
        : typeof a?.queries === 'string' && a.queries.trim()
          ? [a.queries]
          : [];

      if (!names.length && !queries.length) {
        return {
          error: '参数缺失',
          hint: '至少提供 tool_names（精确名）或 queries（关键词）之一。',
          example: { queries: ['生成图片'], top_k: 3 },
        };
      }

      const pool = new Set(registry.deferredNames()); // 只在"未展开"的工具里检索，避免重复返回已可用的 core 工具
      const found = new Map<string, ToolDef>();
      const misses: string[] = [];

      // 1) 精确名查找（允许用户漏写 skill_ 前缀）
      for (const n of names) {
        const d = registry.getDef(n) || registry.getDef('skill_' + n);
        if (d) found.set(d.name, d);
        else misses.push(n);
      }
      // 2) 关键词检索
      for (const q of queries) {
        for (const d of searchTools(q, { limit: topK, pool })) found.set(d.name, d);
      }

      // 名字没查到的，降级为关键词再试一次（模型经常把工具名拼错或凭印象编）
      for (const n of misses.slice()) {
        const alt = searchTools(n.replace(/^skill_/, '').replace(/_/g, ' '), { limit: 2, pool });
        for (const d of alt) found.set(d.name, d);
      }

      const defs = [...found.values()];
      if (!defs.length) {
        const catalog = deferredCatalog(registry.deferredDefs(), 1200);
        return {
          ok: false,
          message: '没有检索到匹配的工具。',
          hint: '可换用更通用的关键词，或直接从下方目录里挑一个用 tool_names 精确加载；若本就是普通文件读写，请直接用 fs_read / fs_write。',
          可选工具目录: catalog,
        };
      }

      activateTools(ctx.sessionId, defs.map((d) => d.name));

      return {
        ok: true,
        已加载: defs.map((d) => d.name),
        说明: '以上工具已加载完毕，从下一步起可以直接调用（无需再次 tool_search）。',
        工具详情: defs.map((d) => ({
          name: d.name,
          description: d.description,
          parameters: d.parameters,
        })),
        未命中: misses.length ? misses : undefined,
      };
    },
    { tier: 'core', summary: '检索并加载未展开的工具（两阶段工具加载入口）' },
  );
}

// ─── 最终工具清单组装（agentLoop 每轮调用）─────────────────────────────────
/**
 * 两阶段合成：
 *   可见 = core 工具
 *        + 命中可靠信号的 deferred 工具（扩展名 / 点名 / curated trigger，registry 负责判定）
 *        + 本会话已被 tool_search 激活的 deferred 工具
 *   隐藏 = 其余 deferred 工具 → 压成一行摘要写进 tool_search 描述
 *
 * 必须每轮重算：模型这一轮调了 tool_search，激活集就变了，下一轮的 tools 数组要跟着变，
 * 否则"检索到了却依然调不动"。
 */
export function composeTools(
  userInput: string,
  attachmentNames: string[] = [],
  sessionId = '',
): ToolDef[] {
  const promoted = registry.toolsForRequest(userInput, attachmentNames); // core + 信号命中的 deferred
  const active = sessionId ? getActivated(sessionId) : new Set<string>();

  const visible = new Map<string, ToolDef>();
  for (const d of promoted) visible.set(d.name, d);
  for (const n of active) {
    if (visible.has(n)) continue;
    const d = registry.getDef(n);
    if (d) visible.set(n, d);
  }

  const hidden = registry.deferredDefs().filter((d) => !visible.has(d.name));

  if (!hidden.length) {
    // 全都展开了，再挂个检索入口只会浪费 token 并诱导模型多跑一次无用调用
    visible.delete('tool_search');
    return [...visible.values()];
  }

  const ts = visible.get('tool_search');
  if (ts) {
    visible.set('tool_search', {
      ...ts,
      description:
        BASE_DESC +
        `\n\n<deferred_tools count="${hidden.length}">\n` +
        deferredCatalog(hidden) +
        '\n</deferred_tools>',
    });
  }
  return [...visible.values()];
}

/** 调试/自检用：返回本次组装的规模数据 */
export function composeStats(userInput: string, attachmentNames: string[] = [], sessionId = '') {
  const tools = composeTools(userInput, attachmentNames, sessionId);
  const chars = tools.reduce((s, d) => s + JSON.stringify(d).length, 0);
  const full = registry.list().reduce((s, d) => s + JSON.stringify(d).length, 0);
  return {
    visible: tools.length,
    hidden: registry.deferredDefs().filter((d) => !tools.some((t) => t.name === d.name)).length,
    chars,
    fullChars: full,
    saved: full - chars,
    names: tools.map((t) => t.name),
  };
}

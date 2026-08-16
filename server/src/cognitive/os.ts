// cognitive/os.ts
// V3 Phase 3 - Step 5 §十二：Cognitive Memory OS —— 认知记忆总装
//
// 计划书 §十二 给出的升级后 Agent Loop：
//   Recall → Search Graph → Plan → Execute → Reflect
//         → Save Episode → Extract Knowledge → Update Skill
//
// 本文件把 Step 5 的六个子系统装成一台可用的机器，对外只暴露两个主动作：
//
//   recall(task)    ← Loop 的前半段（Recall + Search Graph），产出注入 prompt 的上下文
//   remember(ep)    ← Loop 的后半段（Save Episode + Extract Knowledge + Update Skill）
//
// 外加一个离线动作 consolidate()，对应"睡眠期固化"（清理 + 压缩）。
//
// ⚠ 与既有 memory/os.ts（V2 MemoryOS，写 MemoryStore/持久化）**并存不替换**：
//   memory/    = 生产记忆栈，负责持久化与检索
//   cognitive/ = V3 认知层，负责"经验 → 知识 → 技能"的提炼闭环
//   两者互不 import，可独立启停。

import { WorkingMemory } from './core/workingMemory';
import { EpisodicMemory, inferOutcome, type Episode, type EpisodeStats } from './core/episodicMemory';
import { SemanticMemory, type Knowledge } from './core/semanticMemory';
import { EmbeddingService, embeddingService, type EmbedFn } from './vector/embedding';
import { VectorStore, type SearchHit } from './vector/vectorStore';
import { KnowledgeGraph } from './graph/knowledgeGraph';
import { RELATIONS, type Edge } from './graph/relation';
import { MemoryCleaner, type CleanOptions } from './consolidation/memoryCleaner';
import { MemoryCompressor, type CompressOptions } from './consolidation/memoryCompressor';
import {
  LearningEngine,
  skillNameOf,
  type AntiPattern,
  type LearnResult,
  type Skill,
} from './learning/learningEngine';

/**
 * 图谱里 task 节点的统一 ID 生成规则。
 * LearningEngine 与 CognitiveMemoryOS 必须用同一套规则，
 * 否则同一个任务会在图里裂成两个节点（一个截断名、一个原文）。
 */
function taskNodeId(task: string): string {
  return `task:${skillNameOf(task)}`;
}

export interface RecallResult {
  task: string;
  /** 语义相似的历史经历 */
  episodes: Array<{ episode: Episode; score: number }>;
  /** 命中的知识条目 */
  knowledge: Knowledge[];
  /** 可复用技能 */
  skills: Skill[];
  /** 已知的坑 */
  warnings: AntiPattern[];
  /** 知识图谱的 n 跳邻域 */
  graph: Array<{ id: string; label: string; hops: number; via: string }>;
  /** 向量层原始命中，便于调试 */
  hits: SearchHit[];
  tookMs: number;
}

export interface RememberResult {
  episode: Episode;
  learn: LearnResult;
  vectorId?: string;
  relations: number;
}

export interface ConsolidateResult {
  episodes: { before: number; after: number; removed: number; merged: number };
  knowledge: { before: number; after: number; removed: number };
  tookMs: number;
}

/** B20: 固化事件钩子 */
export type ConsolidationHook = (phase: 'before' | 'after', result?: ConsolidateResult) => void | Promise<void>;

export interface CognitiveStats {
  working: { size: number; capacity: number; goal: string | null };
  episodic: EpisodeStats;
  semantic: { total: number; concepts: number; avgConfidence: number };
  vector: { size: number; capacity: number; dim: number };
  graph: { nodes: number; edges: number; relationTypes: number; relations: Record<string, number> };
  learning: ReturnType<LearningEngine['stats']>;
  embedding: ReturnType<EmbeddingService['stats']>;
}

export interface CognitiveOptions {
  workingCapacity?: number;
  episodicCapacity?: number;
  vectorCapacity?: number;
  /** recall 时向量召回条数 */
  recallK?: number;
  /** 相似度下限 */
  minScore?: number;
  /** 图谱扩散深度 */
  graphDepth?: number;
  /** 自动把 episode 写进向量库，默认 true */
  autoIndex?: boolean;
  /** 自动学习（remember 时触发 LearningEngine），默认 true */
  autoLearn?: boolean;
  embedding?: EmbeddingService;
}

export class CognitiveMemoryOS {
  readonly working: WorkingMemory;
  readonly episodic: EpisodicMemory;
  readonly semantic: SemanticMemory;
  readonly vectors: VectorStore;
  readonly graph: KnowledgeGraph;
  readonly cleaner: MemoryCleaner;
  readonly compressor: MemoryCompressor;
  readonly learning: LearningEngine;
  readonly embeddings: EmbeddingService;

  private opts: Required<Omit<CognitiveOptions, 'embedding'>>;
  private recallCount = 0;
  private rememberCount = 0;

  /** Phase 2b (V3吞并V2): 用户画像 — 替代 V2 profile.json */
  profile: Record<string, any> = {};
  /** Phase 2b (V3吞并V2): 长期笔记 — topic→content，替代 V2 notes/*.md */
  notes: Map<string, string> = new Map();

  /** B20: 固化钩子列表 */
  private consolidationHooks: ConsolidationHook[] = [];

  /** B20: 注册固化钩子（before: 清理前通知; after: 清理后通知，携带结果） */
  onConsolidate(hook: ConsolidationHook): void {
    this.consolidationHooks.push(hook);
  }

  private async fireHooks(phase: 'before' | 'after', result?: ConsolidateResult): Promise<void> {
    for (const h of this.consolidationHooks) {
      try { await h(phase, result); } catch { /* 钩子异常不阻断 */ }
    }
  }

  constructor(options: CognitiveOptions = {}) {
    this.opts = {
      workingCapacity: options.workingCapacity ?? 50,
      episodicCapacity: options.episodicCapacity ?? 2000,
      vectorCapacity: options.vectorCapacity ?? 5000,
      recallK: options.recallK ?? 5,
      minScore: options.minScore ?? 0.15,
      graphDepth: options.graphDepth ?? 2,
      autoIndex: options.autoIndex !== false,
      autoLearn: options.autoLearn !== false,
    };

    this.working = new WorkingMemory(this.opts.workingCapacity);
    this.episodic = new EpisodicMemory(this.opts.episodicCapacity);
    this.semantic = new SemanticMemory();
    this.vectors = new VectorStore(this.opts.vectorCapacity);
    this.graph = new KnowledgeGraph();
    this.cleaner = new MemoryCleaner();
    this.compressor = new MemoryCompressor();
    this.embeddings = options.embedding ?? embeddingService;
    this.learning = new LearningEngine({ semantic: this.semantic, graph: this.graph });
  }

  /**
   * 注入真实 embedding provider（Ollama / Cloud 的 provider.embed）。
   * 不注入时走确定性 hash embedding —— 可用但语义弱。
   */
  setEmbeddingProvider(fn: EmbedFn | null, name = 'provider'): void {
    this.embeddings.setProvider(fn, name);
  }

  // ── Phase 2b (V3吞并V2): 用户画像 ──────────────────────────

  getProfile(): Record<string, any> {
    return { ...this.profile };
  }
  updateProfile(patch: Record<string, any>): Record<string, any> {
    this.profile = { ...this.profile, ...patch, updatedAt: Date.now() };
    return { ...this.profile };
  }
  setProfile(obj: Record<string, any>): Record<string, any> {
    this.profile = { ...this.profile, ...obj, updatedAt: Date.now() };
    return { ...this.profile };
  }

  // ── Phase 2b (V3吞并V2): 长期笔记 ─────────────────────────

  listNotes(): string[] {
    return [...this.notes.keys()].map(t => t + '.md');
  }
  listNoteTopics(): string[] {
    return [...this.notes.keys()];
  }
  readNote(topic: string): string | null {
    return this.notes.get(topic) ?? null;
  }
  writeNote(topic: string, content: string): void {
    if (content) this.notes.set(topic, content);
    else this.notes.delete(topic);
    // 异步同步 vector 索引：先用 embeddings 生成（失败时由 VectorStore 哈希兜底），
    // 修复 2026-08-13：原传 [] 空数组会留下 0 维向量，触发 CosineWARN 刷屏。
    const text = `[${topic}] ${content || ''}`;
    this.embeddings.embed(text)
      .then(vec => this.vectors.add(text, vec, { topic }))
      .catch(() => this.vectors.add(text, [], { topic }));
  }
  deleteNote(topic: string): boolean {
    return this.notes.delete(topic);
  }

  // ── Loop 前半段：Recall + Search Graph ──────────────────────

  /**
   * 综合召回：向量找相似经历 → 图谱扩散相关概念 → 技能/坑位提示。
   * 这是塞进 system prompt 之前的全部"记得的东西"。
   */
  async recall(task: string, k = this.opts.recallK): Promise<RecallResult> {
    const t0 = Date.now();
    this.recallCount++;

    // 1. 向量层：语义相似的历史经历
    let hits: SearchHit[] = [];
    if (this.vectors.items.length > 0) {
      const qv = await this.embeddings.embed(task);
      hits = this.vectors.search(qv, { k, minScore: this.opts.minScore });
    }

    const episodes: RecallResult['episodes'] = [];
    for (const h of hits) {
      const epId = typeof h.meta?.episodeId === 'string' ? h.meta.episodeId : h.id;
      const ep = this.episodic.byId(epId);
      if (ep) {
        this.episodic.touch(ep); // 被回忆到就强化，影响后续 consolidation 保留分
        episodes.push({ episode: ep, score: h.score });
      }
    }

    // 关键词兜底：向量层为空或全被过滤时，别让 recall 交白卷
    if (episodes.length === 0) {
      for (const ep of this.episodic.search(task).slice(0, k)) {
        this.episodic.touch(ep);
        episodes.push({ episode: ep, score: 0 });
      }
    }

    // 2. 语义层
    const knowledge = this.semantic.search(task, k);

    // 3. 图谱层：从任务节点向外扩散
    const taskNodeId = `task:${task}`;
    let graph: RecallResult['graph'] = [];
    if (this.graph.has(taskNodeId)) {
      graph = this.graph.related(taskNodeId, this.opts.graphDepth, k * 2);
    } else {
      // 任务节点不存在时，用关键词找最接近的节点再扩散
      const near = this.graph.findNodes(task, 1)[0];
      if (near) graph = this.graph.related(near.id, this.opts.graphDepth, k * 2);
    }

    // 4. 技能与坑
    const skills = this.learning.suggest(task, 3);
    const warnings = this.learning.warnings(task, 3);

    return {
      task,
      episodes,
      knowledge,
      skills,
      warnings,
      graph,
      hits,
      tookMs: Date.now() - t0,
    };
  }

  /** 把召回结果拼成可直接注入 system prompt 的文本块。 */
  async buildContext(task: string, k = this.opts.recallK): Promise<string> {
    const r = await this.recall(task, k);
    const lines: string[] = [];

    const focus = this.working.toPrompt();
    if (focus) lines.push(focus);

    if (r.episodes.length) {
      lines.push('【相关历史经历】');
      for (const { episode, score } of r.episodes) {
        const mark = episode.outcome === 'failure' ? '✗' : episode.outcome === 'success' ? '✓' : '·';
        const sim = score > 0 ? ` (相似度 ${score.toFixed(2)})` : '';
        lines.push(`${mark} ${episode.task}${sim}${episode.lesson ? ` → ${episode.lesson}` : ''}`);
      }
    }

    if (r.knowledge.length) {
      lines.push('【已固化的知识】');
      for (const kn of r.knowledge) {
        lines.push(`- ${kn.concept}：${kn.rule}（置信 ${kn.confidence.toFixed(2)}）`);
      }
    }

    if (r.graph.length) {
      lines.push('【概念关联】');
      for (const g of r.graph.slice(0, 8)) {
        lines.push(`- ${g.label}（${g.hops} 跳，via ${g.via}）`);
      }
    }

    const skillText = this.learning.toPrompt(task);
    if (skillText) lines.push(skillText);

    // ── 为弱模型生成摘要行：提炼最关键的一条教训 ──
    if (r.episodes.length > 0 || r.knowledge.length > 0) {
      const highlights: string[] = [];
      // 优先取失败教训
      const failEp = r.episodes.find(e => e.episode.outcome === 'failure');
      if (failEp && failEp.episode.lesson) {
        highlights.push(`上次类似任务失败原因：${failEp.episode.lesson}`);
      }
      // 取最高置信度知识
      const topK = r.knowledge.sort((a, b) => b.confidence - a.confidence)[0];
      if (topK) {
        highlights.push(`已知规则：${topK.concept} → ${topK.rule}`);
      }
      if (highlights.length > 0) {
        lines.unshift('【经验速览】' + highlights.join('；'));
      }
    }

    return lines.join('\n');
  }

  // ── Loop 后半段：Save Episode + Extract Knowledge + Update Skill ──

  /**
   * 记住一次经历：写情景记忆 → 建索引 → 学习 → 落图谱。
   * 这是 Agent 每完成一个任务后必须调的一步。
   */
  async remember(input: Partial<Episode> & { task: string }): Promise<RememberResult> {
    this.rememberCount++;

    if (!input.outcome && input.result !== undefined) {
      input.outcome = inferOutcome(input.result);
    }

    const episode = this.episodic.save(input);
    this.working.add({ kind: 'episode', task: episode.task, outcome: episode.outcome });

    // 向量索引：拼 task + lesson，让召回既能按任务也能按教训命中
    let vectorId: string | undefined;
    if (this.opts.autoIndex) {
      const text = [episode.task, episode.lesson].filter(Boolean).join(' — ');
      const vec = await this.embeddings.embed(text);
      const item = await this.vectors.add(text, vec, {
        episodeId: episode.id,
        outcome: episode.outcome,
        tags: episode.tags,
      });
      vectorId = item.id;
    }

    // 学习：成功抽技能，失败抽反模式（内部会顺带写 semantic + graph）
    const learn = this.opts.autoLearn
      ? this.learning.learn(episode)
      : ({ mode: 'skipped', reason: 'autoLearn disabled' } as LearnResult);

    // 图谱：episode 节点 + learnedFrom 边，保证知识可溯源
    const relations = this.linkEpisode(episode);

    return { episode, learn, vectorId, relations };
  }

  /** 把 episode 挂到图谱上，返回新增/强化的边数。 */
  private linkEpisode(ep: Episode): number {
    const epNode = `episode:${ep.id}`;
    const taskNode = `task:${ep.task}`;
    this.graph.addNode({ id: epNode, type: 'episode', label: ep.task, props: { outcome: ep.outcome } });
    this.graph.addNode({ id: taskNode, type: 'task', label: ep.task });

    const edges: Edge[] = [
      { from: epNode, to: taskNode, relation: RELATIONS.APPLIES_TO, sources: [ep.id] },
    ];

    for (const tag of ep.tags ?? []) {
      const tagNode = `tag:${tag}`;
      this.graph.addNode({ id: tagNode, type: 'tag', label: tag });
      edges.push({ from: taskNode, to: tagNode, relation: RELATIONS.RELATED_TO, sources: [ep.id] });
    }

    for (const e of edges) this.graph.addRelation(e);
    return edges.length;
  }

  /** 手动登记一条关系（供 LLM 抽取结果或人工录入使用）。 */
  relate(from: string, to: string, relation: string, sourceId?: string): Edge {
    this.graph.addNode({ id: from, type: 'concept', label: from });
    this.graph.addNode({ id: to, type: 'concept', label: to });
    return this.graph.addRelation({
      from,
      to,
      relation,
      sources: sourceId ? [sourceId] : undefined,
    });
  }

  /** 手动固化一条知识。 */
  teach(concept: string, rule: string, confidence = 0.6): Knowledge {
    return this.semantic.add(concept, rule, { confidence });
  }

  // ── 离线：睡眠期固化 ────────────────────────────────────────

  /**
   * 固化：先压缩同类经历，再按保留分清理。顺序不能反 ——
   * 先压缩能让"同一件事发生 5 次"合并成一条高分记录而不是被逐条淘汰。
   */
  async consolidate(opts: { clean?: CleanOptions; compress?: CompressOptions } = {}): Promise<ConsolidateResult> {
    // B20: before hook
    await this.fireHooks('before');

    const t0 = Date.now();
    const beforeEp = this.episodic.records.length;

    const comp = this.compressor.compressEpisodes(this.episodic.records, opts.compress);
    const mergedAway = beforeEp - comp.after;

    const cleaned = this.cleaner.cleanEpisodes(comp.compressed, opts.clean);
    this.episodic.replaceAll(cleaned.kept);

    // 向量库同步：被清掉的 episode 不该继续被召回
    const alive = new Set(cleaned.kept.map((e) => e.id));
    this.vectors.removeWhere((item) => {
      const id = item.meta?.episodeId;
      return typeof id === 'string' && !alive.has(id);
    });

    const beforeKn = this.semantic.knowledge.length;
    const knClean = this.cleaner.cleanKnowledge(this.semantic.knowledge, opts.clean);
    for (const k of knClean.removed) this.semantic.remove(k.id);

    const result: ConsolidateResult = {
      episodes: {
        before: beforeEp,
        after: cleaned.after,
        removed: cleaned.removed.length,
        merged: mergedAway,
      },
      knowledge: {
        before: beforeKn,
        after: knClean.after,
        removed: knClean.removed.length,
      },
      tookMs: Date.now() - t0,
    };

    // B20: after hook
    await this.fireHooks('after', result);
    return result;
  }

  /** 只算不删，给 Dashboard 做"清理预览"。 */
  previewConsolidate(opts: CleanOptions = {}) {
    const comp = this.compressor.compressEpisodes(this.episodic.records);
    const cleaned = this.cleaner.cleanEpisodes(comp.compressed, opts);
    return {
      wouldMerge: comp.merges,
      wouldRemove: cleaned.removed.map((e) => ({ id: e.id, task: e.task, outcome: e.outcome })),
      scores: cleaned.scores.sort((a, b) => a.score - b.score).slice(0, 20),
    };
  }

  // ── 观测 ────────────────────────────────────────────────────

  stats(): CognitiveStats {
    const snap = this.working.snapshot();
    const kn = this.semantic.knowledge;
    const avgConf = kn.length ? kn.reduce((s, k) => s + k.confidence, 0) / kn.length : 0;
    const g = this.graph.stats();

    return {
      working: { size: snap.size, capacity: snap.capacity, goal: snap.goal },
      episodic: this.episodic.stats(),
      semantic: {
        total: kn.length,
        concepts: this.semantic.concepts().length,
        avgConfidence: Number(avgConf.toFixed(3)),
      },
      vector: this.vectors.stats(),
      graph: {
        nodes: g.nodes,
        edges: g.edges,
        relationTypes: Object.keys(g.relations).length,
        relations: g.relations,
      },
      learning: this.learning.stats(),
      embedding: this.embeddings.stats(),
    };
  }

  counters() {
    return { recalls: this.recallCount, remembers: this.rememberCount };
  }

  /** 全量导出，可落盘做持久化。 */
  dump() {
    return {
      version: 'v3-cognitive-1',
      at: Date.now(),
      profile: this.profile,
      notes: [...this.notes.entries()],
      episodes: this.episodic.records,
      knowledge: this.semantic.knowledge,
      vectors: this.vectors.dump(),
      graph: this.graph.dump(),
      skills: this.learning.skills,
      antiPatterns: this.learning.antiPatterns,
    };
  }

  load(data: ReturnType<CognitiveMemoryOS['dump']>): void {
    if (data.profile) this.profile = data.profile;
    if (data.notes) {
      this.notes.clear();
      for (const [k, v] of data.notes) this.notes.set(k, v);
    }
    if (data.episodes) this.episodic.replaceAll(data.episodes);
    if (data.knowledge) {
      this.semantic.clear();
      for (const k of data.knowledge) {
        this.semantic.add(k.concept, k.rule, { confidence: k.confidence, tags: k.tags });
      }
    }
    if (data.vectors) this.vectors.load(data.vectors);
    if (data.graph) this.graph.load(data.graph);
  }

  clear(): void {
    this.working.clear();
    this.episodic.clear();
    this.semantic.clear();
    this.vectors.clear();
    this.graph.clear();
    this.learning.clear();
  }
}

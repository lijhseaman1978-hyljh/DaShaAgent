// cognitive/index.ts
// V3 Phase 3 - Step 5：Cognitive Memory + Knowledge Graph Engine —— 统一出口
//
// ┌──────────────────────────────────────────────────────────────┐
// │  CognitiveMemoryOS                                           │
// │                                                              │
// │   core/      working  ── 当前在想什么（短期上下文）           │
// │              episodic ── 发生过什么（事件流水）               │
// │              semantic ── 懂得了什么（提炼的规则）             │
// │                                                              │
// │   vector/    embedding + vectorStore ── 语义相似召回          │
// │   graph/     relation + knowledgeGraph ── 概念之间怎么连      │
// │                                                              │
// │   consolidation/  cleaner + compressor ── 睡眠期固化          │
// │   learning/       learningEngine ── 经验→技能 / 失败→反模式   │
// └──────────────────────────────────────────────────────────────┘
//
// 使用方式：
//   import { cognitiveMemory } from './cognitive';
//   const ctx = await cognitiveMemory.buildContext(goal);   // Loop 前半段
//   await cognitiveMemory.remember({ task: goal, result, lesson }); // Loop 后半段
//
// 与 memory/（V2 Memory OS）并存不替换 —— 见 os.ts 顶部说明。

// ── 核心三层 ──
export { WorkingMemory } from './core/workingMemory';
export type { WorkingEntry, WorkingSnapshot } from './core/workingMemory';

export { EpisodicMemory, inferOutcome } from './core/episodicMemory';
export type { Episode, EpisodeOutcome, EpisodeStats } from './core/episodicMemory';

export { SemanticMemory } from './core/semanticMemory';
export type { Knowledge, AddKnowledgeOptions } from './core/semanticMemory';

// ── 向量层 ──
export {
  EmbeddingService,
  embeddingService,
  hashEmbed,
  tokenizeText,
  cosine,
  l2norm,
} from './vector/embedding';
export type { EmbedFn, EmbeddingStats } from './vector/embedding';

export { VectorStore, VectorStore as CognitiveVectorStore } from './vector/vectorStore';
export type { VectorItem, SearchHit, VectorSearchOptions } from './vector/vectorStore';

// ── 图谱层 ──
export { RELATIONS, normalizeRelation, inverseOf, describeEdge } from './graph/relation';
export type { Node, Edge, RelationType } from './graph/relation';

export { KnowledgeGraph } from './graph/knowledgeGraph';
export type { GraphPath, GraphStats } from './graph/knowledgeGraph';

// ── 固化层 ──
export { MemoryCleaner, memoryCleaner, decayFactor } from './consolidation/memoryCleaner';
export type { CleanOptions, CleanReport } from './consolidation/memoryCleaner';

export { MemoryCompressor, memoryCompressor, jaccard } from './consolidation/memoryCompressor';
export type { CompressOptions, CompressReport } from './consolidation/memoryCompressor';

// ── 学习层 ──
export { LearningEngine, learningEngine, skillNameOf } from './learning/learningEngine';
export type { Skill, AntiPattern, LearnResult, LearningStats, LearningDeps } from './learning/learningEngine';

// ── 总装 ──
export { CognitiveMemoryOS } from './os';
export type {
  RecallResult,
  RememberResult,
  ConsolidateResult,
  CognitiveStats,
  CognitiveOptions,
} from './os';

import { CognitiveMemoryOS } from './os';

/**
 * 进程级单例。Runtime / Control Center / Workflow 共用同一份认知记忆，
 * 否则 Web 端看到的统计和 Agent 实际用的记忆会对不上。
 */
export const cognitiveMemory = new CognitiveMemoryOS();

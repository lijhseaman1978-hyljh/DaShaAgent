// cognitive/learning/learningEngine.ts
// V3 Phase 3 - Step 5 §十一：Learning Engine（从经验中学习）
//
// 计划书原型：
//   class LearningEngine {
//     learn(episode) {
//       if (episode.result === 'success') return { newSkill: episode.lesson };
//     }
//   }
//
// 原型只处理了成功分支，而**失败才是学习的主要来源**。这里补成双通道：
//
//   成功 → 抽取 Skill（可复用的做法）        → 技能库 + Semantic「怎么做」
//   失败 → 抽取 AntiPattern（要避开的坑）    → Semantic「不要怎么做」+ 图谱 causes 边
//
// 同时做技能**去重与强化**：同一个技能被再次验证时 uses++ / successRate 重算，
// 而不是每成功一次就塞一条新技能进去（否则技能库很快退化成日志）。

import type { Episode } from '../core/episodicMemory';
import type { SemanticMemory, Knowledge } from '../core/semanticMemory';
import type { KnowledgeGraph } from '../graph/knowledgeGraph';
import { RELATIONS } from '../graph/relation';
import { tokenizeText } from '../vector/embedding';

export interface Skill {
  id: string;
  /** 技能名 —— 由 task 归一化而来，作为去重键 */
  name: string;
  /** 具体做法，来自 episode.lesson */
  description: string;
  /** 被验证过的次数 */
  uses: number;
  successes: number;
  failures: number;
  /** successes / uses */
  successRate: number;
  /** 溯源 Episode id */
  sources: string[];
  tags?: string[];
  createdAt: number;
  updatedAt: number;
}

export interface AntiPattern {
  id: string;
  name: string;
  /** 踩了什么坑 */
  pitfall: string;
  /** 观察到的次数 */
  occurrences: number;
  sources: string[];
  createdAt: number;
  updatedAt: number;
}

export interface LearnResult {
  /** 计划书字段：成功时产出的新技能（此处返回结构化 Skill，仍带 lesson 文本） */
  newSkill?: Skill;
  antiPattern?: AntiPattern;
  /** 顺带写进语义记忆的知识 */
  knowledge?: Knowledge;
  /** 是新学的还是强化了已有的 */
  mode: 'created' | 'reinforced' | 'skipped';
  reason?: string;
}

export interface LearningDeps {
  semantic?: SemanticMemory;
  graph?: KnowledgeGraph;
}

export interface LearningStats {
  skills: number;
  antiPatterns: number;
  learned: number;
  skipped: number;
  topSkills: Array<{ name: string; uses: number; successRate: number }>;
}

let sSeq = 0;
const nextId = (p: string) => `${p}_${Date.now().toString(36)}_${(++sSeq).toString(36)}`;

/**
 * 技能的**展示名**：保留人话，只做清洗与截断。
 * （早期版本直接拼 tokenizeText 的结果，中文会被切成 bigram，
 *   产出 "首屏 屏渲 渲染 染性" 这种读不了的名字 —— 而这段文本要进 prompt。）
 */
export function skillNameOf(task: string): string {
  const t = (task ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[。．.!！?？,，、;；:：\s]+$/g, '');
  if (!t) return 'unnamed';
  return t.length > 48 ? `${t.slice(0, 48)}…` : t;
}

/**
 * 技能的**去重键**：token 集合去重排序后拼接。
 * 索引用它而非展示名 —— "部署服务到生产环境" 无论出现几次都归并为一个技能，
 * 而 "首屏渲染" 与 "列表渲染" 因 token 集不同仍保持为两个技能。
 */
export function skillKeyOf(task: string): string {
  const toks = [...new Set(tokenizeText(task))].sort();
  return toks.length > 0 ? toks.join('\u0001') : skillNameOf(task).toLowerCase();
}

export class LearningEngine {
  skills: Skill[] = [];
  antiPatterns: AntiPattern[] = [];

  private skillIndex = new Map<string, Skill>();
  private apIndex = new Map<string, AntiPattern>();
  private learnedCount = 0;
  private skippedCount = 0;

  constructor(private deps: LearningDeps = {}) {}

  /** 允许 CognitiveMemoryOS 在构造之后再注入依赖。 */
  wire(deps: LearningDeps): void {
    this.deps = { ...this.deps, ...deps };
  }

  /**
   * 计划书原型 API：从一条经历中学习。
   * 成功 → newSkill；失败 → antiPattern；没有 lesson 则跳过（无信息量）。
   */
  learn(episode: Episode): LearnResult {
    const lesson = (episode.lesson ?? '').trim();
    if (!lesson) {
      this.skippedCount++;
      return { mode: 'skipped', reason: 'no lesson to extract' };
    }

    const outcome = episode.outcome ?? 'unknown';
    if (outcome === 'success' || outcome === 'partial') {
      return this.learnSkill(episode, lesson, outcome === 'success');
    }
    if (outcome === 'failure') {
      return this.learnAntiPattern(episode, lesson);
    }

    this.skippedCount++;
    return { mode: 'skipped', reason: `outcome=${outcome}, not conclusive` };
  }

  /** 批量学习，返回全部结果（用于对历史 episodes 做一次性回溯学习）。 */
  learnAll(episodes: Episode[]): LearnResult[] {
    return episodes.map((e) => this.learn(e));
  }

  // ── 成功通道 ──────────────────────────────────────────────

  private learnSkill(episode: Episode, lesson: string, fullSuccess: boolean): LearnResult {
    const name = skillNameOf(episode.task);
    const key = skillKeyOf(episode.task);
    const existing = this.skillIndex.get(key);
    const now = Date.now();

    let skill: Skill;
    let mode: LearnResult['mode'];

    if (existing) {
      existing.uses++;
      if (fullSuccess) existing.successes++;
      existing.successRate = existing.successes / Math.max(1, existing.uses);
      existing.updatedAt = now;
      if (!existing.sources.includes(episode.id)) existing.sources.push(episode.id);
      // 更具体的 lesson 覆盖旧的笼统描述
      if (lesson.length > existing.description.length) existing.description = lesson;
      skill = existing;
      mode = 'reinforced';
    } else {
      skill = {
        id: nextId('sk'),
        name,
        description: lesson,
        uses: 1,
        successes: fullSuccess ? 1 : 0,
        failures: 0,
        successRate: fullSuccess ? 1 : 0,
        sources: [episode.id],
        tags: episode.tags ? [...episode.tags] : undefined,
        createdAt: now,
        updatedAt: now,
      };
      this.skills.push(skill);
      this.skillIndex.set(key, skill);
      mode = 'created';
    }

    this.learnedCount++;

    // 沉淀到语义记忆：概念 = 技能名，规则 = 做法
    const knowledge = this.safeSemanticAdd(name, lesson, {
      confidence: fullSuccess ? 0.7 : 0.5,
      sourceId: episode.id,
      tags: episode.tags,
    });

    // 落进知识图谱：task --requires--> skill
    this.linkGraph(episode, name, 'skill');

    return { newSkill: skill, knowledge, mode };
  }

  // ── 失败通道 ──────────────────────────────────────────────

  private learnAntiPattern(episode: Episode, lesson: string): LearnResult {
    const name = skillNameOf(episode.task);
    const key = skillKeyOf(episode.task);
    const now = Date.now();
    const existing = this.apIndex.get(key);

    let ap: AntiPattern;
    let mode: LearnResult['mode'];

    if (existing) {
      existing.occurrences++;
      existing.updatedAt = now;
      if (!existing.sources.includes(episode.id)) existing.sources.push(episode.id);
      if (lesson.length > existing.pitfall.length) existing.pitfall = lesson;
      ap = existing;
      mode = 'reinforced';
    } else {
      ap = {
        id: nextId('ap'),
        name,
        pitfall: lesson,
        occurrences: 1,
        sources: [episode.id],
        createdAt: now,
        updatedAt: now,
      };
      this.antiPatterns.push(ap);
      this.apIndex.set(key, ap);
      mode = 'created';
    }

    this.learnedCount++;

    // 同类技能若存在，失败要拉低它的成功率 —— 这才是闭环
    const sk = this.skillIndex.get(key);
    if (sk) {
      sk.uses++;
      sk.failures++;
      sk.successRate = sk.successes / Math.max(1, sk.uses);
      sk.updatedAt = now;
    }

    const knowledge = this.safeSemanticAdd(name, `避免：${lesson}`, {
      confidence: 0.6,
      sourceId: episode.id,
      tags: [...(episode.tags ?? []), 'anti-pattern'],
    });

    this.linkGraph(episode, name, 'antipattern');

    return { antiPattern: ap, knowledge, mode };
  }

  // ── 图谱联动 ──────────────────────────────────────────────

  private linkGraph(episode: Episode, name: string, kind: 'skill' | 'antipattern'): void {
    const g = this.deps.graph;
    if (!g) return;

    try {
      const taskId = `task:${skillNameOf(episode.task)}`;
      const nodeId = `${kind}:${name}`;

      g.addNode({ id: taskId, type: 'task', label: episode.task });
      g.addNode({ id: nodeId, type: kind, label: name });
      g.addRelation({
        from: taskId,
        to: nodeId,
        relation: kind === 'skill' ? RELATIONS.REQUIRES : RELATIONS.CAUSES,
        sources: [episode.id],
      });
    } catch {
      /* B18: 图谱写入失败不阻断技能学习 */
    }
  }

  /** B18: 安全写入语义记忆，失败时静默跳过 */
  private safeSemanticAdd(name: string, content: string, opts: { confidence: number; sourceId: string; tags?: string[] }): Knowledge | undefined {
    if (!this.deps.semantic) return undefined;
    try {
      return this.deps.semantic.add(name, content, opts);
    } catch {
      return undefined;
    }
  }

  // ── 查询 ──────────────────────────────────────────────────

  /** 为当前任务召回最相关的技能，用于注入 prompt。 */
  suggest(task: string, limit = 3): Skill[] {
    const q = new Set(tokenizeText(task));
    if (q.size === 0) return [];
    return this.skills
      .map((s) => {
        const t = new Set(tokenizeText(`${s.name} ${s.description}`));
        let inter = 0;
        for (const x of q) if (t.has(x)) inter++;
        const overlap = inter / q.size;
        // 成功率高、用得多的技能优先
        return { s, score: overlap * (0.5 + 0.5 * s.successRate) * (1 + Math.log2(1 + s.uses) * 0.1) };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((x) => x.s);
  }

  /** 为当前任务召回相关的坑，用于"别再犯"提示。 */
  warnings(task: string, limit = 3): AntiPattern[] {
    const q = new Set(tokenizeText(task));
    if (q.size === 0) return [];
    return this.antiPatterns
      .map((a) => {
        const t = new Set(tokenizeText(`${a.name} ${a.pitfall}`));
        let inter = 0;
        for (const x of q) if (t.has(x)) inter++;
        return { a, score: (inter / q.size) * (1 + Math.log2(1 + a.occurrences) * 0.15) };
      })
      .filter((x) => x.score > 0)
      .sort((x, y) => y.score - x.score)
      .slice(0, limit)
      .map((x) => x.a);
  }

  /** 组装成可直接塞进 system prompt 的一段文本。 */
  toPrompt(task: string): string {
    const sk = this.suggest(task);
    const wn = this.warnings(task);
    if (sk.length === 0 && wn.length === 0) return '';
    const lines: string[] = [];
    if (sk.length) {
      lines.push('【已掌握的做法】');
      for (const s of sk) {
        lines.push(`- ${s.description}（验证 ${s.uses} 次，成功率 ${(s.successRate * 100).toFixed(0)}%）`);
      }
    }
    if (wn.length) {
      lines.push('【已知的坑】');
      for (const a of wn) lines.push(`- ${a.pitfall}（发生 ${a.occurrences} 次）`);
    }
    return lines.join('\n');
  }

  top(n = 10): Skill[] {
    return [...this.skills]
      .sort((a, b) => b.successRate * b.uses - a.successRate * a.uses)
      .slice(0, n);
  }

  stats(): LearningStats {
    return {
      skills: this.skills.length,
      antiPatterns: this.antiPatterns.length,
      learned: this.learnedCount,
      skipped: this.skippedCount,
      topSkills: this.top(5).map((s) => ({
        name: s.name,
        uses: s.uses,
        successRate: Number(s.successRate.toFixed(2)),
      })),
    };
  }

  clear(): void {
    this.skills = [];
    this.antiPatterns = [];
    this.skillIndex.clear();
    this.apIndex.clear();
    this.learnedCount = 0;
    this.skippedCount = 0;
  }
}

export const learningEngine = new LearningEngine();

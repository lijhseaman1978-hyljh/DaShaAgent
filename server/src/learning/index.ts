// learning/index.ts
// Universal Learning Engine — 统一入口
// 串联 KnowledgeDistiller → SkillDistiller → MemoryConsolidation
// V5.0 Step 4：Universal Learning Engine

import { KnowledgeDistiller, type RawExperience } from './knowledgeDistiller';
import { SkillDistiller } from './skillDistiller';
import { MemoryConsolidation, type MemoryItem } from './memoryConsolidation';
import { logger, metrics } from '../observability';

export class LearningEngine {
  knowledge = new KnowledgeDistiller();
  skills = new SkillDistiller();
  memory = new MemoryConsolidation();

  private autoConsolidateInterval = 3600000; // 每小时自动整合一次
  private autoDistillInterval = 7200000;     // 每两小时自动蒸馏一次
  private timer?: ReturnType<typeof setInterval>;
  /** P3: 蒸馏技能注册目标（SkillManager），由 unified.ts 注入 */
  private skillManager: any = null;

  /** P3: 注入技能管理器，使蒸馏出的技能可被 Agent 调用（激活闭环的关键） */
  setSkillManager(mgr: any): void {
    this.skillManager = mgr;
  }

  /** 从任务结果中学习 */
  learnFromTask(params: {
    taskName: string;
    goal: string;
    result: any;
    success: boolean;
    context?: Record<string, any>;
  }) {
    // 1. 摄入原始经验
    const exp: RawExperience = {
      source: params.taskName,
      timestamp: Date.now(),
      content: `任务：${params.goal}\n结果：${params.success ? '成功' : '失败'}\n详情：${JSON.stringify(params.result).slice(0, 500)}`,
      result: params.success ? 'success' : 'failure',
      context: params.context,
    };
    this.knowledge.ingest(exp);

    // 2. 记录到短期记忆
    this.memory.add({
      topic: params.goal.slice(0, 100),
      content: params.success
        ? `✅ 成功完成：${JSON.stringify(params.result).slice(0, 200)}`
        : `❌ 失败：${JSON.stringify(params.result).slice(0, 200)}`,
      importance: params.success ? 0.5 : 0.8, // 失败经验更重要
      createdAt: Date.now(),
      tags: this.extractTags(params.taskName, params.goal),
    });

    // 3. 成功任务 → 立即尝试蒸馏技能（激活闭环）
    if (params.success) {
      try {
        this.distill();
      } catch { /* 蒸馏失败不影响主流程 */ }
    }

    metrics.increment('learning.experience.ingested');
  }

  /** 从反思结果中学习 */
  learnFromReflection(params: {
    goal: string;
    verification: { verified: boolean; confidence: number; issues: string[] };
    reflection: { needRetry: boolean; reason?: string };
  }) {
    const success = params.verification.verified;
    this.knowledge.ingest({
      source: 'reflection',
      timestamp: Date.now(),
      content: `反思：${params.goal}\n验证通过：${params.verification.verified}\n置信度：${params.verification.confidence}\n问题：${params.verification.issues.join('; ')}`,
      result: success ? 'success' : 'failure',
      context: params,
    });

    // 失败的反思 → 高重要性记忆
    if (!success) {
      this.memory.add({
        topic: `反思：${params.goal.slice(0, 80)}`,
        content: `验证失败（置信度 ${params.verification.confidence}）：${params.verification.issues.slice(0, 3).join('；')}`,
        importance: 0.7,
        createdAt: Date.now(),
        tags: ['reflection', 'failure', ...params.verification.issues.slice(0, 2)],
      });
    }

    metrics.increment('learning.reflection.ingested');
  }

  /** 执行一次完整的蒸馏周期 */
  distill(): { knowledgeCount: number; skillCount: number } {
    // 1. 记忆整合
    const consolidated = this.memory.consolidate();
    logger.info('LearningEngine', `Memory consolidation: ${consolidated} items moved to long-term`);

    // 2. 知识蒸馏（对所有已知领域）
    const domains = ['maritime', 'wechat', 'operations', 'system', 'general'];
    let totalKnowledge = 0;
    for (const domain of domains) {
      const k = this.knowledge.distill(domain);
      totalKnowledge += k.length;
    }

    // 3. 技能蒸馏
    const allKnowledge = this.knowledge.all();
    const newSkills = this.skills.distill(allKnowledge);

    // 4. P3: 激活闭环 —— 蒸馏出的技能注册到 SkillManager，Agent 才能真正调用
    if (newSkills.length > 0 && this.skillManager) {
      for (const s of newSkills) {
        try {
          this.skillManager.install({
            id: s.id,
            name: s.name,
            description: s.description + '（自动蒸馏技能，置信度' + s.confidence.toFixed(2) + '）',
            version: String(s.version),
            capabilities: s.triggers,
            execute: async (task: any) => {
              return {
                result: '【自动蒸馏技能】' + s.name + '\n流程：\n' + s.workflow.map((w, i) => `${i + 1}. ${w}`).join('\n'),
                skillId: s.id,
              };
            },
          });
          logger.info('LearningEngine', `Skill auto-installed: "${s.name}" (${s.id})`);
        } catch (e: any) {
          logger.error('LearningEngine', `Skill install failed: ${s.name}`, { error: String(e) });
        }
      }
    }

    logger.info('LearningEngine', `Distillation: ${totalKnowledge} new knowledge, ${newSkills.length} new skills`);
    metrics.set('learning.knowledge.count', this.knowledge.stats().totalKnowledge);
    metrics.set('learning.skills.count', this.skills.stats().totalSkills);
    // 2026-08-13 R3：distill() 返回值改为知识库/技能库真实总量（原逻辑返回"本次新产出数”，
    // 而 extractKnowledge 的去重合并会让重复轮次产出恒为 0，导致日志长期显示 0/0 的误导）。
    return { knowledgeCount: this.knowledge.stats().totalKnowledge, skillCount: this.skills.stats().totalSkills };
  }

  /** 启动自动学习循环 */
  start() {
    this.timer = setInterval(() => {
      try {
        this.distill();
      } catch (e: any) {
        logger.error('LearningEngine', 'Auto-distill failed', { error: String(e) });
      }
    }, this.autoDistillInterval);

    logger.info('LearningEngine', 'Started auto-learning loop');
    metrics.increment('learning.engine.started');
  }

  /** 停止 */
  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    logger.info('LearningEngine', 'Stopped');
  }

  /** 获取完整状态报告 */
  report() {
    return {
      knowledge: this.knowledge.stats(),
      skills: this.skills.stats(),
      memory: this.memory.stats(),
    };
  }

  // ═══ 辅助 ═══

  private extractTags(taskName: string, goal: string): string[] {
    const text = (taskName + ' ' + goal).toLowerCase();
    const tags: string[] = [];

    const patterns: [RegExp, string][] = [
      [/maritime|航海|船|ship|imo/i, 'maritime'],
      [/wechat|公众号|微信|文章/i, 'wechat'],
      [/cron|定时|scheduler|schedule/i, 'cron'],
      [/blog|博客|post|发布/i, 'blog'],
      [/agent|harness|system|系统/i, 'system'],
      [/learning|self.improve|进化|学习/i, 'learning'],
    ];

    for (const [re, tag] of patterns) {
      if (re.test(text)) tags.push(tag);
    }

    if (tags.length === 0) tags.push('general');
    return [...new Set(tags)].slice(0, 5);
  }

  /** P1-4: 获取最近蒸馏的经验（给 prompt 用） */
  getRecentInsights(n = 3): string[] {
    try {
      const recent = this.knowledge.getRecent(n);
      return recent.map(k => `[${k.domain}] ${k.summary} (置信 ${k.confidence.toFixed(2)})`);
    } catch { return []; }
  }
}

export const learning = new LearningEngine();

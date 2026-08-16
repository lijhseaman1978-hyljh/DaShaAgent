// learning/skillDistiller.ts
// Skill Distiller — 从知识中提炼可复用的技能
// V5.0 Step 4：Universal Learning Engine

import type { DistilledKnowledge } from './knowledgeDistiller';
import { logger } from '../observability';

export interface DistilledSkill {
  id: string;
  name: string;
  description: string;
  version: number;
  triggers: string[];        // 触发条件关键词
  workflow: string[];        // 执行步骤
  preconditions: string[];   // 前置条件
  expectedOutput: string;    // 预期产出
  confidence: number;        // 0-1
  sourceKnowledgeIds: string[];
  usageCount: number;
  successRate: number;
  createdAt: number;
  updatedAt: number;
}

export class SkillDistiller {
  private skills: Map<string, DistilledSkill> = new Map();
  private readonly minKnowledgeForSkill = 3; // 2026-08-13 R3：5→3（单用户个人项目同领域知识积累慢，5 条门槛导致技能蒸馏长期 0 产出）
  private readonly minConfidenceForSkill = 0.6;

  /** 从知识库中蒸馏技能 */
  distill(knowledgeItems: DistilledKnowledge[]): DistilledSkill[] {
    const groups = this.groupByDomain(knowledgeItems);
    const newSkills: DistilledSkill[] = [];

    for (const [domain, items] of groups) {
      if (items.length < this.minKnowledgeForSkill) continue;

      const avgConfidence = items.reduce((s, k) => s + k.confidence, 0) / items.length;
      if (avgConfidence < this.minConfidenceForSkill) continue;

      const skill = this.extractSkill(domain, items);
      if (skill) {
        newSkills.push(skill);
      }
    }

    return newSkills;
  }

  /** 获取所有已蒸馏技能 */
  all(): DistilledSkill[] {
    return [...this.skills.values()]
      .sort((a, b) => b.confidence * b.successRate - a.confidence * a.successRate);
  }

  /** 按领域查询 */
  byTrigger(keyword: string): DistilledSkill[] {
    return [...this.skills.values()]
      .filter(s => s.triggers.some(t => t.toLowerCase().includes(keyword.toLowerCase())));
  }

  /** 记录技能使用结果 */
  recordUsage(skillId: string, success: boolean) {
    const skill = this.skills.get(skillId);
    if (!skill) return;

    skill.usageCount++;
    // 加权平均：新结果占 20%
    const newRate = success ? 1 : 0;
    skill.successRate = skill.successRate * 0.8 + newRate * 0.2;
    skill.updatedAt = Date.now();

    // 成功率过低 → 降低置信度
    if (skill.usageCount >= 3 && skill.successRate < 0.5) {
      skill.confidence *= 0.9;
      logger.warn('SkillDistiller', `Skill "${skill.name}" confidence degraded`, {
        successRate: skill.successRate.toFixed(2),
        newConfidence: skill.confidence.toFixed(2),
      });
    }
  }

  /** 提升技能版本 */
  upgrade(skillId: string, updates: Partial<DistilledSkill>) {
    const skill = this.skills.get(skillId);
    if (!skill) return;

    skill.version++;
    Object.assign(skill, updates, { updatedAt: Date.now() });
    logger.info('SkillDistiller', `Skill "${skill.name}" upgraded to v${skill.version}`);
  }

  /** 导出 */
  export(): DistilledSkill[] {
    return [...this.skills.values()];
  }

  /** 导入 */
  import(skills: DistilledSkill[]) {
    for (const s of skills) this.skills.set(s.id, s);
  }

  /** 统计 */
  stats() {
    return {
      totalSkills: this.skills.size,
      activeSkills: [...this.skills.values()].filter(s => s.confidence >= 0.5).length,
      avgSuccessRate: this.skills.size > 0
        ? [...this.skills.values()].reduce((s, sk) => s + sk.successRate, 0) / this.skills.size
        : 0,
      topSkills: [...this.skills.values()]
        .sort((a, b) => b.confidence * b.usageCount - a.confidence * a.usageCount)
        .slice(0, 3)
        .map(s => ({ name: s.name, confidence: s.confidence, usage: s.usageCount })),
    };
  }

  // ═══ 内部 ═══

  private groupByDomain(items: DistilledKnowledge[]): Map<string, DistilledKnowledge[]> {
    const groups = new Map<string, DistilledKnowledge[]>();
    for (const item of items) {
      const domain = item.domain;
      if (!groups.has(domain)) groups.set(domain, []);
      groups.get(domain)!.push(item);
    }
    return groups;
  }

  private extractSkill(domain: string, items: DistilledKnowledge[]): DistilledSkill | null {
    // 提取共同的工作流步骤
    const triggers = this.extractTriggers(items);
    const workflow = this.extractWorkflow(items);
    const preconditions = this.extractPreconditions(items);

    if (triggers.length === 0 || workflow.length === 0) return null;

    const avgConfidence = items.reduce((s, k) => s + k.confidence, 0) / items.length;
    const successCount = items.filter(k => k.category === 'pattern').length;

    const skill: DistilledSkill = {
      id: `skill_${domain}_${Date.now()}`,
      name: `${domain} 自动化技能`,
      description: `从 ${items.length} 条知识中蒸馏的 ${domain} 领域操作技能`,
      version: 1,
      triggers,
      workflow,
      preconditions,
      expectedOutput: this.inferOutput(domain, items),
      confidence: avgConfidence,
      sourceKnowledgeIds: items.map(k => k.id),
      usageCount: 0,
      successRate: successCount / items.length,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    // 检查是否与已有技能重复
    const existing = this.findSimilar(skill);
    if (existing) {
      this.upgrade(existing.id, {
        triggers: [...new Set([...existing.triggers, ...triggers])],
        workflow: [...new Set([...existing.workflow, ...workflow])],
        confidence: (existing.confidence + avgConfidence) / 2,
        sourceKnowledgeIds: [...new Set([...existing.sourceKnowledgeIds, ...skill.sourceKnowledgeIds])],
      });
      return null;
    }

    this.skills.set(skill.id, skill);
    logger.info('SkillDistiller', `New skill: "${skill.name}" v1 (${items.length} sources, conf=${avgConfidence.toFixed(2)})`);
    return skill;
  }

  private extractTriggers(items: DistilledKnowledge[]): string[] {
    return [...new Set(items.flatMap(k => k.tags).slice(0, 5))];
  }

  private extractWorkflow(items: DistilledKnowledge[]): string[] {
    const steps: string[] = [];
    const patterns = items.filter(k => k.category === 'pattern');

    // 从成功模式中提取步骤
    for (const p of patterns) {
      // 简单启发式：按标点分割
      const sentences = p.detail
        .split(/[。；;]/)
        .filter(s => s.trim().length > 5);
      for (const s of sentences.slice(0, 3)) {
        if (!steps.includes(s.trim())) steps.push(s.trim());
      }
    }

    return steps.slice(0, 7);
  }

  private extractPreconditions(items: DistilledKnowledge[]): string[] {
    const lessons = items.filter(k => k.category === 'lesson');
    return lessons.map(l => `需注意：${l.summary}`).slice(0, 3);
  }

  private inferOutput(domain: string, items: DistilledKnowledge[]): string {
    const outputs: Record<string, string> = {
      maritime: '航海日报 / 报告文档 / 邮件通知',
      wechat: '公众号草稿 / 封面图 / 博客文章',
      operations: '任务执行结果 / 状态报告',
      system: '系统维护完成 / 日志报告',
    };
    return outputs[domain] || '完成指定任务并输出结果';
  }

  private findSimilar(skill: DistilledSkill): DistilledSkill | undefined {
    for (const s of this.skills.values()) {
      const overlap = s.triggers.filter(t => skill.triggers.includes(t)).length;
      if (overlap >= Math.min(2, skill.triggers.length)) return s;
    }
    return undefined;
  }
}

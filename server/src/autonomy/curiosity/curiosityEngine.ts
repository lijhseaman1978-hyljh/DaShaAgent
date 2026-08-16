// autonomy/curiosity/curiosityEngine.ts
// Curiosity Engine — Agent 的好奇心
// 发现知识盲区，生成探索目标
// V5.0 Step 2：Goal Generation Engine + Curiosity System

import { type Goal, type GoalSource, createGoal } from '../goal/types';
import type { Observation } from '../world/worldObserver';
import { logger } from '../../observability';

export interface KnowledgeGap {
  topic: string;
  currentConfidence: number;  // 0-1
  reason: string;
  suggestedQuery: string;
  importance: number;         // 0-1
}

export class CuriosityEngine {
  private knownTopics = new Map<string, number>(); // topic → confidence
  private exploredTopics = new Set<string>();
  private gaps: KnowledgeGap[] = [];

  /** 评估当前知识状态，发现空白领域 */
  evaluate(knowledgeMap: Map<string, number>): KnowledgeGap[] {
    const newGaps: KnowledgeGap[] = [];

    for (const [topic, confidence] of knowledgeMap) {
      this.knownTopics.set(topic, confidence);
      if (confidence < 0.4 && !this.exploredTopics.has(topic)) {
        newGaps.push({
          topic,
          currentConfidence: confidence,
          reason: `对"${topic}"了解不足 (置信度 ${(confidence * 100).toFixed(0)}%)`,
          suggestedQuery: `学习关于：${topic}`,
          importance: 1 - confidence,
        });
      }
    }

    this.gaps = [...this.gaps, ...newGaps].slice(-50);
    return newGaps;
  }

  /** 从观察中发现未知领域 */
  discoverFromObservations(observations: Observation[]): KnowledgeGap[] {
    const newGaps: KnowledgeGap[] = [];

    for (const obs of observations) {
      // 从观察描述中提取可能的未知概念
      const terms = this.extractUnknownTerms(obs.description);
      for (const term of terms) {
        if (!this.knownTopics.has(term) && !this.exploredTopics.has(term)) {
          newGaps.push({
            topic: term,
            currentConfidence: 0.1,
            reason: `观察中发现不熟悉的术语：${term}`,
            suggestedQuery: `什么是${term}？`,
            importance: obs.importance * 0.8,
          });
          this.knownTopics.set(term, 0.1);
        }
      }
    }

    this.gaps = [...this.gaps, ...newGaps].slice(-50);
    return newGaps;
  }

  /** 从知识缺口生成探索目标 */
  generateExplorationGoals(): Goal[] {
    const goals: Goal[] = [];
    const recentGaps = this.gaps
      .filter(g => !this.exploredTopics.has(g.topic))
      .sort((a, b) => b.importance - a.importance)
      .slice(0, 5);

    for (const gap of recentGaps) {
      goals.push(createGoal({
        title: `探索：${gap.topic}`,
        reason: gap.reason,
        source: 'curiosity',
        priority: gap.importance * 0.6,  // 好奇心目标优先级低于紧急修复
        value: 0.7,
        risk: 0.1,
        suggestedAction: gap.suggestedQuery,
        effort: gap.importance > 0.7 ? 'medium' : 'low',
      }));
      this.exploredTopics.add(gap.topic);
    }

    logger.info('CuriosityEngine', `Generated ${goals.length} exploration goals`);
    return goals;
  }

  /** 标记某个主题已学习 */
  markLearned(topic: string, newConfidence: number) {
    this.knownTopics.set(topic, Math.max(newConfidence, this.knownTopics.get(topic) || 0));
    this.exploredTopics.add(topic);
  }

  /** 获取当前知识缺口 */
  getGaps(): KnowledgeGap[] {
    return [...this.gaps].sort((a, b) => b.importance - a.importance);
  }

  /** 统计 */
  stats() {
    return {
      knownTopics: this.knownTopics.size,
      exploredTopics: this.exploredTopics.size,
      openGaps: this.gaps.filter(g => !this.exploredTopics.has(g.topic)).length,
      avgConfidence: this.knownTopics.size > 0
        ? [...this.knownTopics.values()].reduce((s, c) => s + c, 0) / this.knownTopics.size
        : 0,
    };
  }

  // ═══ 辅助 ═══

  private extractUnknownTerms(text: string): string[] {
    // 提取可能是专业术语的片段：中文2-6字、英文2-20字符
    const terms: string[] = [];
    const chineseTerms = text.match(/[\u4e00-\u9fa5]{2,6}/g);
    const englishTerms = text.match(/\b[A-Z][a-zA-Z]{2,20}\b/g);

    if (chineseTerms) {
      // 过滤掉常见停用词
      const stopWords = new Set(['系统', '文件', '数据', '检查', '可以', '需要', '已经', '这个', '一个', '什么', '进行']);
      for (const t of chineseTerms) {
        if (!stopWords.has(t)) terms.push(t);
      }
    }
    if (englishTerms) terms.push(...englishTerms);

    return [...new Set(terms)].slice(0, 10);
  }
}

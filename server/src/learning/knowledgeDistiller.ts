// learning/knowledgeDistiller.ts
// Knowledge Distiller — 从原始经验中提取结构化知识
// V5.0 Step 4：Universal Learning Engine

import { logger } from '../observability';

export interface RawExperience {
  source: string;           // 来源（任务名/观察/对话）
  timestamp: number;
  content: string;          // 原始描述
  result: 'success' | 'failure' | 'partial';
  context?: Record<string, any>;
}

export interface DistilledKnowledge {
  id: string;
  domain: string;           // 领域：maritime/wechat/development/system
  category: 'pattern' | 'lesson' | 'fact' | 'strategy' | 'rule';
  summary: string;          // 一句话总结
  detail: string;           // 详细描述
  confidence: number;       // 0-1
  sourceCount: number;      // 来自多少条原始经验
  relatedTopics: string[];
  createdAt: number;
  updatedAt: number;
  tags: string[];
}

export class KnowledgeDistiller {
  private knowledge: Map<string, DistilledKnowledge> = new Map();
  private experiencePool: RawExperience[] = [];
  private readonly minExperiencesForDistill = 3;

  // 2026-08-13 R3 修复：领域关键词支持中英别名。
  // 此前 distill(domain) 用英文关键词匹配经验内容，而生产任务多为中文
  // （“海事报告”“公众号文章”），导致每 2 小时的学习蒸馏永远 0 产出——
  // 这正是运行数月 0 技能产出的根因。此处补齐中文别名。
  private readonly DOMAIN_KEYWORDS: Record<string, string[]> = {
    maritime: ['maritime', 'ship', 'vessel', '航海', '海事', '船舶', '航运', '港口', 'PSC', 'IMO'],
    wechat: ['wechat', '公众号', '博客', 'blog', '文章', '爆文', '封面'],
    operations: ['operation', '运营', '运维', '任务执行', '工作流', '流程'],
    system: ['system', '系统', '维护', '部署', '安装', '日志'],
    general: ['general', '通用', '报告', '分析', '文档', '整理'],
  };

  /** 摄入原始经验 */
  ingest(exp: RawExperience) {
    this.experiencePool.push({
      ...exp,
      timestamp: exp.timestamp || Date.now(),
    });

    // 保持经验池合理大小
    if (this.experiencePool.length > 500) {
      this.experiencePool = this.experiencePool.slice(-300);
    }

    // 当同类经验积累足够时，自动蒸馏
    this.autoDistillIfReady(exp.source);
  }

  /** 批量摄入 */
  ingestMany(experiences: RawExperience[]) {
    for (const e of experiences) this.ingest(e);
  }

  /** 从经验池中提取指定领域的知识 */
  distill(domain: string): DistilledKnowledge[] {
    const kws = this.DOMAIN_KEYWORDS[domain] || [domain.toLowerCase()];
    const relevant = this.experiencePool.filter(e => {
      const text = (e.content + ' ' + e.source).toLowerCase();
      return kws.some(k => k && text.includes(k.toLowerCase()));
    });

    if (relevant.length < this.minExperiencesForDistill) {
      return [];
    }

    return this.extractKnowledge(domain, relevant);
  }

  /** 获取所有知识 */
  all(): DistilledKnowledge[] {
    return [...this.knowledge.values()]
      .sort((a, b) => b.confidence - a.confidence);
  }

  /** 按领域查询 */
  byDomain(domain: string): DistilledKnowledge[] {
    return [...this.knowledge.values()]
      .filter(k => k.domain === domain)
      .sort((a, b) => b.confidence - a.confidence);
  }

  /** 按标签搜索 */
  byTag(tag: string): DistilledKnowledge[] {
    return [...this.knowledge.values()]
      .filter(k => k.tags.some(t => t.toLowerCase().includes(tag.toLowerCase())));
  }

  /** 导出知识库（可用于持久化） */
  export(): DistilledKnowledge[] {
    return [...this.knowledge.values()];
  }

  /** 导入知识库 */
  import(knowledge: DistilledKnowledge[]) {
    for (const k of knowledge) {
      this.knowledge.set(k.id, k);
    }
  }

  /** P1-4: 获取最近 N 条蒸馏结果（给 prompt 用） */
  getRecent(n = 3): DistilledKnowledge[] {
    return [...this.knowledge.values()]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, n);
  }

  /** 获取统计 */
  stats() {
    const domains = new Map<string, number>();
    for (const k of this.knowledge.values()) {
      domains.set(k.domain, (domains.get(k.domain) || 0) + 1);
    }
    return {
      totalKnowledge: this.knowledge.size,
      totalExperiences: this.experiencePool.length,
      domains: Object.fromEntries(domains),
      avgConfidence: this.knowledge.size > 0
        ? [...this.knowledge.values()].reduce((s, k) => s + k.confidence, 0) / this.knowledge.size
        : 0,
    };
  }

  // ═══ 内部方法 ═══

  private autoDistillIfReady(source: string) {
    const same = this.experiencePool.filter(e => e.source === source);
    if (same.length >= this.minExperiencesForDistill) {
      const domain = this.guessDomain(source);
      const knowledge = this.extractKnowledge(domain, same);
      if (knowledge.length > 0) {
        logger.info('KnowledgeDistiller', `Auto-distilled ${knowledge.length} items from ${same.length} experiences for "${source}"`);
      }
    }
  }

  private guessDomain(source: string): string {
    const lower = source.toLowerCase();
    if (lower.includes('maritime') || lower.includes('ship') || lower.includes('航海')) return 'maritime';
    if (lower.includes('wechat') || lower.includes('公众号') || lower.includes('blog')) return 'wechat';
    if (lower.includes('cron') || lower.includes('scheduler') || lower.includes('task')) return 'operations';
    if (lower.includes('agent') || lower.includes('harness') || lower.includes('system')) return 'system';
    return 'general';
  }

  private extractKnowledge(domain: string, experiences: RawExperience[]): DistilledKnowledge[] {
    const results: DistilledKnowledge[] = [];

    // 2026-08-13 R3 改进：按 source 分组再蒸馏。
    // 原实现把同领域全部经验合成一条粗知识（findSimilar 又按 tags 重叠激进合并），
    // 导致同领域知识条目极少（12 条经验只有 1-2 条），永远够不到技能蒸馏门槛。
    // 按 source 分组后：不同任务类型（source）各自成条，知识粒度更细、技能更具体。
    const bySource = new Map<string, RawExperience[]>();
    for (const e of experiences) {
      const key = e.source || 'general';
      if (!bySource.has(key)) bySource.set(key, []);
      bySource.get(key)!.push(e);
    }

    for (const group of bySource.values()) {
      const item = this.buildKnowledgeItem(domain, group);
      if (!item) continue;
      // 合并已有知识
      const existing = this.findSimilar(item);
      if (existing) {
        existing.confidence = (existing.confidence + item.confidence) / 2;
        existing.sourceCount += item.sourceCount;
        existing.updatedAt = Date.now();
        existing.tags = [...new Set([...existing.tags, ...item.tags])];
        existing.detail += `\n---\n[更新 ${new Date().toISOString().slice(0, 10)}] ${item.summary}`;
      } else {
        this.knowledge.set(item.id, item);
        results.push(item);
      }
    }

    return results;
  }

  /** 由一组同源经验生成一条知识（extractKnowledge 的构建单元） */
  private buildKnowledgeItem(domain: string, experiences: RawExperience[]): DistilledKnowledge | null {
    if (experiences.length === 0) return null;

    // 统计成功率
    const successes = experiences.filter(e => e.result === 'success');
    const successRate = experiences.length > 0 ? successes.length / experiences.length : 0;

    // 提取共同主题
    const tags = this.extractCommonTags(experiences);
    const summary = this.generateSummary(domain, experiences, successRate);

    return {
      id: `dk_${domain}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      domain,
      category: successRate > 0.7 ? 'pattern' : 'lesson',
      summary: summary.title,
      detail: summary.detail,
      confidence: Math.min(0.9, 0.3 + successRate * 0.5 + experiences.length * 0.05),
      sourceCount: experiences.length,
      relatedTopics: this.extractTopics(experiences),
      tags,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  private findSimilar(item: DistilledKnowledge): DistilledKnowledge | undefined {
    for (const k of this.knowledge.values()) {
      if (k.domain === item.domain && k.category === item.category) {
        const overlap = item.tags.filter(t => k.tags.includes(t)).length;
        // 2026-08-13 R3：阈值 2→3，避免不同子任务被激进合并（tags 重叠 2 个即合并不合理）
        if (overlap >= Math.min(3, item.tags.length)) return k;
      }
    }
    return undefined;
  }

  private extractCommonTags(experiences: RawExperience[]): string[] {
    const wordFreq = new Map<string, number>();
    for (const e of experiences) {
      const words = (e.content + ' ' + e.source)
        .replace(/[^\u4e00-\u9fa5a-zA-Z]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 2 && !['the', 'and', 'for', 'with', 'this', 'that'].includes(w.toLowerCase()));
      const seen = new Set(words);
      for (const w of seen) {
        wordFreq.set(w, (wordFreq.get(w) || 0) + 1);
      }
    }
    return [...wordFreq.entries()]
      .filter(([_, c]) => c >= Math.min(2, experiences.length * 0.5))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([w]) => w);
  }

  private extractTopics(experiences: RawExperience[]): string[] {
    // 提取跨经验的主题词
    const allTags = this.extractCommonTags(experiences);
    return allTags.slice(0, 5);
  }

  private generateSummary(domain: string, experiences: RawExperience[], successRate: number): { title: string; detail: string } {
    const count = experiences.length;
    const rateStr = (successRate * 100).toFixed(0);

    if (successRate > 0.8) {
      return {
        title: `${domain} 领域：高效操作模式已确认`,
        detail: `基于 ${count} 次经验，成功率达 ${rateStr}%。该操作模式已被验证为可靠。`,
      };
    } else if (successRate > 0.5) {
      return {
        title: `${domain} 领域：改进空间`,
        detail: `${count} 次操作中 ${rateStr}% 成功。存在优化空间，建议细化步骤。`,
      };
    } else {
      return {
        title: `${domain} 领域：需要重新设计`,
        detail: `${count} 次尝试中仅 ${rateStr}% 成功。当前策略需要根本性改进。`,
      };
    }
  }
}

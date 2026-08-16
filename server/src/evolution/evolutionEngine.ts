// evolution/evolutionEngine.ts
// Phase 4 - Step 1：自我进化引擎（统一入口）
//
// 把三件事串成一个闭环：
//   1. Capability Gap Detector  —— 能力缺口自动捕获（gaps.jsonl）
//   2. Skill Registry           —— 技能注册表（带性能指标 skill-registry.json）
//   3. Skill Factory            —— 自动造技能（基于缺口数据 + 现有 factory）
//
// 数据落地：data/evolution/gaps.jsonl + data/evolution/skill-registry.json

import fs from 'node:fs';
import path from 'node:path';
import { CONFIG, ensureDir } from '../config';
import { recordGap, markGapResolved, listOpenGaps, listAllGaps } from './capabilityGap';
import { registerSkill, recordSkillCall, listSkills, listWeakSkills, findSkillByCapability } from './skillRegistry';

// ============ 1. 能力缺口自动捕获 ============
export { recordGap, markGapResolved, listOpenGaps, listAllGaps };

// ============ 2. Skill 注册表 ============
export { registerSkill, recordSkillCall, listSkills, listWeakSkills, findSkillByCapability };

// ============ 3. Skill Factory（自动造技能）============
//
// 基于"未解决且频次高"的缺口，生成 Skill 元数据并注册。
// 说明：真正的可执行 Skill 需要 LLM 生成代码 + 沙箱验证，这里先落地"元数据层"，
//       生成 skill 骨架并写入注册表，形成"能感知缺口→能登记能力→能生成骨架"的闭环。
//       后续可在 generator 中接入 LLM 生成真正可执行的 execute()。

const GAP_THRESHOLD = 2; // 缺口频次达到该值才触发自动造技能（避免过度生成）

export interface FactoryResult {
  created: string[];
  skipped: string[];
}

/**
 * 扫描未解决缺口，对高频缺口自动生成 Skill 骨架并注册。
 * 返回本次新建/跳过的技能 id 列表。
 */
export function autoFactory(): FactoryResult {
  const openGaps = listOpenGaps();
  const created: string[] = [];
  const skipped: string[] = [];

  for (const gap of openGaps) {
    // 已有技能能覆盖该能力 → 跳过并标记已解决
    const existing = findSkillByCapability(gap.capability);
    if (existing) {
      markGapResolved(gap.capability, existing.id);
      skipped.push(existing.id);
      continue;
    }

    // 频次不足 → 先不生成（等积累）
    if (gap.frequency < GAP_THRESHOLD) {
      skipped.push(gap.capability);
      continue;
    }

    // 生成 Skill 骨架并注册
    const skillId = `auto-${gap.capability.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '-').toLowerCase()}`;
    registerSkill({
      id: skillId,
      name: `${gap.capability} Skill`,
      version: '1.0',
      description: `由 Skill Factory 自动生成，用于补足能力缺口：${gap.capability}`,
      capabilities: [gap.capability],
      createdBy: 'factory',
    });
    markGapResolved(gap.capability, skillId);
    created.push(skillId);
  }

  return { created, skipped };
}

/**
 * 生成一份自我进化报告（Markdown），汇总缺口与技能表现。
 */
export function buildEvolutionReport(): string {
  const gaps = listAllGaps();
  const openGaps = listOpenGaps();
  const skills = listSkills();
  const weak = listWeakSkills();

  const lines: string[] = [];
  lines.push('# 自我进化引擎报告');
  lines.push('');
  lines.push(`> 生成时间：${new Date().toLocaleString('zh-CN', { hour12: false })}`);
  lines.push('');
  lines.push(`## 能力缺口`);
  lines.push('');
  lines.push(`- 累计缺口：${gaps.length} 条`);
  lines.push(`- 未解决：${openGaps.length} 条`);
  lines.push('');
  if (openGaps.length === 0) {
    lines.push('暂无未解决的能力缺口 ✅');
  } else {
    lines.push('| 能力 | 频次 | 分类 | 最近触发 |');
    lines.push('| --- | --- | --- | --- |');
    for (const g of openGaps) {
      const t = new Date(g.ts).toLocaleTimeString('zh-CN', { hour12: false });
      lines.push(`| ${g.capability} | ${g.frequency} | ${g.category} | ${t} |`);
    }
  }
  lines.push('');
  lines.push(`## 技能注册表（${skills.length} 个）`);
  lines.push('');
  if (skills.length === 0) {
    lines.push('暂无技能记录。');
  } else {
    lines.push('| 技能 | 版本 | 成功率 | 调用次数 | 平均延迟 | 平均Token |');
    lines.push('| --- | --- | --- | --- | --- | --- |');
    for (const s of skills) {
      lines.push(`| ${s.name} | ${s.version} | ${(s.successRate * 100).toFixed(1)}% | ${s.usageCount} | ${Math.round(s.avgLatencyMs)}ms | ${Math.round(s.avgTokens)} |`);
    }
  }
  lines.push('');
  lines.push(`## 待优化技能（成功率<70% 或 延迟>5s）`);
  lines.push('');
  if (weak.length === 0) {
    lines.push('暂无待优化技能 ✅');
  } else {
    for (const s of weak) {
      lines.push(`- **${s.name}**：成功率 ${(s.successRate * 100).toFixed(1)}%，延迟 ${Math.round(s.avgLatencyMs)}ms`);
    }
  }
  lines.push('');
  lines.push('---');
  lines.push('_由 DaShaAgent 自我进化引擎自动生成_');

  return lines.join('\n');
}

/**
 * 保存进化报告到 data/evolution/ 目录。
 */
export function saveEvolutionReport(): string {
  const report = buildEvolutionReport();
  const file = path.join(CONFIG.DATA_DIR, 'evolution', `evolution-report-${new Date().toISOString().slice(0, 10)}.md`);
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, report, 'utf8');
  return file;
}
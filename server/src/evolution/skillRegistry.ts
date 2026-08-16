// evolution/skillRegistry.ts
// Phase 4 - Step 1：Skill 注册表（带性能指标）
//
// 目标：把已注册技能统一管起来，每个记录版本号、成功率、调用次数、平均延迟、token消耗。
//       提供统一查询入口，供评估"哪个好用、哪个该优化"。
//
// 数据落地：data/evolution/skill-registry.json（单个 JSON 文件）

import fs from 'node:fs';
import path from 'node:path';
import { CONFIG, ensureDir } from '../config';

export interface SkillStat {
  id: string;              // 技能唯一 ID
  name: string;            // 技能名
  version: string;         // 版本号，如 "1.0"
  description: string;     // 描述
  capabilities: string[];  // 提供的能力
  successRate: number;     // 成功率 0~1
  usageCount: number;      // 调用次数
  avgLatencyMs: number;    // 平均延迟 ms
  totalTokens: number;     // 累计 token 消耗
  avgTokens: number;       // 平均 token 消耗
  createdBy: string;       // 创建者：builtin / factory
  createdAt: number;       // 注册时间
  updatedAt: number;       // 最后更新
}

const REG_FILE = path.join(CONFIG.DATA_DIR, 'evolution', 'skill-registry.json');

function load(): SkillStat[] {
  if (!fs.existsSync(REG_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(REG_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function save(list: SkillStat[]) {
  ensureDir(path.dirname(REG_FILE));
  fs.writeFileSync(REG_FILE, JSON.stringify(list, null, 2), 'utf8');
}

/** 注册或更新一个技能（按 id 去重，已存在则更新元数据，保留累计指标） */
export function registerSkill(skill: Omit<SkillStat, 'successRate' | 'usageCount' | 'avgLatencyMs' | 'totalTokens' | 'avgTokens' | 'createdAt' | 'updatedAt'> & Partial<Pick<SkillStat, 'successRate' | 'usageCount' | 'avgLatencyMs' | 'totalTokens' | 'avgTokens'>>): SkillStat {
  const list = load();
  const existing = list.find((s) => s.id === skill.id);
  const now = Date.now();

  if (existing) {
    // 更新版本与描述，保留累计指标
    existing.name = skill.name;
    existing.version = skill.version;
    existing.description = skill.description;
    existing.capabilities = skill.capabilities;
    existing.updatedAt = now;
    save(list);
    return existing;
  }

  const entry: SkillStat = {
    id: skill.id,
    name: skill.name,
    version: skill.version,
    description: skill.description,
    capabilities: skill.capabilities,
    successRate: skill.successRate ?? 0,
    usageCount: skill.usageCount ?? 0,
    avgLatencyMs: skill.avgLatencyMs ?? 0,
    totalTokens: skill.totalTokens ?? 0,
    avgTokens: skill.avgTokens ?? 0,
    createdBy: skill.createdBy || 'builtin',
    createdAt: now,
    updatedAt: now,
  };
  list.push(entry);
  save(list);
  return entry;
}

/** 记录一次调用结果，更新成功率、调用次数、延迟、token */
export function recordSkillCall(id: string, result: { success: boolean; latencyMs: number; tokens?: number }): SkillStat {
  const list = load();
  let s = list.find((x) => x.id === id);
  if (!s) {
    // 闭环修复：首次调用自动登记（工具名即 id）——生产工具执行处接入后，
    // 所有工具的调用都会产生统计行，listWeakSkills/成功率报表才不再是死数据。
    const now = Date.now();
    s = {
      id, name: id, version: 'runtime', description: `runtime tool: ${id}`, capabilities: [id],
      successRate: 0, usageCount: 0, avgLatencyMs: 0, totalTokens: 0, avgTokens: 0,
      createdBy: 'runtime', createdAt: now, updatedAt: now,
    };
    list.push(s);
  }

  s.usageCount += 1;
  s.avgLatencyMs = (s.avgLatencyMs * (s.usageCount - 1) + result.latencyMs) / s.usageCount;
  if (result.tokens !== undefined) {
    s.totalTokens += result.tokens;
    s.avgTokens = s.totalTokens / s.usageCount;
  }
  // 成功率：加权滑动，历史占 90%，本次占 10%
  s.successRate = s.successRate * 0.9 + (result.success ? 1 : 0) * 0.1;
  s.updatedAt = Date.now();
  save(list);
  return s;
}

/** 查询所有技能（可按成功率/调用次数排序） */
export function listSkills(sortBy?: 'successRate' | 'usageCount' | 'avgLatencyMs'): SkillStat[] {
  const list = load();
  if (!sortBy) return list;
  return list.sort((a, b) => {
    if (sortBy === 'avgLatencyMs') return a.avgLatencyMs - b.avgLatencyMs; // 延迟越低越好
    return (b[sortBy] as number) - (a[sortBy] as number); // 成功率/次数越高越好
  });
}

/** 按 id 查询 */
export function getSkill(id: string): SkillStat | undefined {
  return load().find((s) => s.id === id);
}

/** 按能力反查技能 */
export function findSkillByCapability(capability: string): SkillStat | undefined {
  return load().find((s) => s.capabilities.includes(capability));
}

/** 找出表现差的技能（成功率低 或 延迟高），供优化 */
export function listWeakSkills(thresholdSuccess = 0.7, thresholdLatency = 5000): SkillStat[] {
  return load().filter((s) => s.usageCount > 0 && (s.successRate < thresholdSuccess || s.avgLatencyMs > thresholdLatency));
}
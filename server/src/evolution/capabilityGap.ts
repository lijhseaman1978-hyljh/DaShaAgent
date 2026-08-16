// evolution/capabilityGap.ts
// Phase 4 - Step 1：能力缺口自动捕获模块（Capability Gap Detector）
//
// 目标：当任务失败 / 工具缺失 / 能力不确定时，自动记录一条"能力缺口"，
//       而不是报错就完。积累的数据供 Skill Registry 评估与 Skill Factory 补能力。
//
// 数据落地：data/evolution/gaps.jsonl（追加式日志，每行一条 JSON）

import fs from 'node:fs';
import path from 'node:path';
import { CONFIG, ensureDir } from '../config';

export interface CapabilityGap {
  id: string;              // 唯一 ID（时间戳+随机）
  ts: number;              // 记录时间戳（ms）
  capability: string;      // 缺失的能力描述，如 "PDF 解析"
  category: string;        // 分类：tool_missing / task_failure / uncertain / skill_weak
  task: string;            // 触发时的任务描述（截断）
  context: string;         // 上下文 / 调用链（截断）
  trigger: string;         // 触发条件 / 报错信息
  frequency: number;       // 同类缺口出现次数
  resolved: boolean;       // 是否已被 Skill Factory 补上
  resolvedBy?: string;     // 补上它的 Skill id
}

const GAPS_FILE = path.join(CONFIG.DATA_DIR, 'evolution', 'gaps.jsonl');

function loadGaps(): CapabilityGap[] {
  if (!fs.existsSync(GAPS_FILE)) return [];
  try {
    const lines = fs.readFileSync(GAPS_FILE, 'utf8').split('\n').filter(Boolean);
    return lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch {
    return [];
  }
}

function saveGaps(gaps: CapabilityGap[]) {
  ensureDir(path.dirname(GAPS_FILE));
  fs.writeFileSync(GAPS_FILE, gaps.map((g) => JSON.stringify(g)).join('\n') + '\n', 'utf8');
}

let _seq = 0;    // 进程内序号，防同毫秒碰撞
let _lastTs = 0;

function nextId(): string {
  const ts = Date.now();
  if (ts === _lastTs) _seq++; else _seq = 0;
  _lastTs = ts;
  return `gap-${ts}-${_seq}`;
}

/**
 * 记录一条能力缺口。若同类缺口已存在（capability 相同），则 frequency+1 并更新时间。
 */
export function recordGap(input: {
  capability: string;
  category?: CapabilityGap['category'];
  task?: string;
  context?: string;
  trigger?: string;
}): CapabilityGap {
  const gaps = loadGaps();

  // 去重：同 capability 且未解决 → 累加频次
  const existing = gaps.find((g) => g.capability === input.capability && !g.resolved);
  if (existing) {
    existing.frequency += 1;
    existing.ts = Date.now();
    existing.task = input.task || existing.task;
    existing.trigger = input.trigger || existing.trigger;
    saveGaps(gaps);
    return existing;
  }

  const gap: CapabilityGap = {
    id: nextId(),
    ts: Date.now(),
    capability: input.capability,
    category: input.category || 'task_failure',
    task: (input.task || '').slice(0, 300),
    context: (input.context || '').slice(0, 500),
    trigger: (input.trigger || '').slice(0, 300),
    frequency: 1,
    resolved: false,
  };
  gaps.push(gap);
  saveGaps(gaps);
  return gap;
}

/** 标记某缺口已被某个 Skill 补上 */
export function markGapResolved(capability: string, resolvedBy: string): boolean {
  const gaps = loadGaps();
  const gap = gaps.find((g) => g.capability === capability && !g.resolved);
  if (!gap) return false;
  gap.resolved = true;
  gap.resolvedBy = resolvedBy;
  saveGaps(gaps);
  return true;
}

/** 查询所有未解决的能力缺口（按频次降序），供 Skill Factory 优先补齐 */
export function listOpenGaps(): CapabilityGap[] {
  return loadGaps()
    .filter((g) => !g.resolved)
    .sort((a, b) => b.frequency - a.frequency);
}

/** 全部缺口（含已解决），用于分析报告 */
export function listAllGaps(): CapabilityGap[] {
  return loadGaps();
}
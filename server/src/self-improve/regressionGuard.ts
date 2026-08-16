// self-improve/regressionGuard.ts — Tier 4: 能力回归测试
//
// 每次自我优化后自动跑回归测试，防止退化。
// 如果优化导致某项能力从 ✅ 变成 ❌，自动报告并建议回滚。

import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface CapabilityTest {
  id: string;
  name: string;
  description: string;
  /** 测试方法：返回 true/false */
  check: () => boolean | Promise<boolean>;
}

export interface RegressionResult {
  testId: string;
  name: string;
  before: boolean;
  after: boolean;
  regressed: boolean; // before=true, after=false
}

const LEARNINGS_DIR = join(process.cwd(), 'data', 'workspace', '.learnings');
const REGRESSION_FILE = join(LEARNINGS_DIR, 'REGRESSION.md');

// ── 能力基线 ──
const BASELINE: Record<string, boolean> = {};

// ── 注册测试 ──
const registry: CapabilityTest[] = [];

export function registerCapabilityTest(test: CapabilityTest): void {
  registry.push(test);
}

// ── 运行所有测试，保存基线 ──
export async function runBaseline(): Promise<Record<string, boolean>> {
  const results: Record<string, boolean> = {};
  for (const t of registry) {
    try {
      results[t.id] = await t.check();
    } catch {
      results[t.id] = false;
    }
    BASELINE[t.id] = results[t.id];
  }
  return results;
}

// ── 运行测试并与基线对比 ──
export async function runRegressionCheck(): Promise<RegressionResult[]> {
  const results: RegressionResult[] = [];

  for (const t of registry) {
    let after = false;
    try {
      after = await t.check();
    } catch {
      after = false;
    }

    const before = BASELINE[t.id] ?? true; // 没有基线默认 true
    results.push({
      testId: t.id,
      name: t.name,
      before,
      after,
      regressed: before && !after,
    });
  }

  // 写入回归报告
  writeRegressionReport(results);

  return results;
}

// ── 写入回归报告 ──
function writeRegressionReport(results: RegressionResult[]): void {
  if (!existsSync(LEARNINGS_DIR)) mkdirSync(LEARNINGS_DIR, { recursive: true });

  const regressions = results.filter(r => r.regressed);
  const ts = new Date().toISOString();
  let report = `## ${ts} — 回归测试\n\n`;

  report += '| 测试 | 优化前 | 优化后 | 状态 |\n';
  report += '|------|--------|--------|------|\n';
  for (const r of results) {
    const status = r.regressed ? '🔴 退化' : r.after ? '✅ 正常' : '⚠️ 失败';
    report += `| ${r.name} | ${r.before ? '✅' : '❌'} | ${r.after ? '✅' : '❌'} | ${status} |\n`;
  }

  if (regressions.length > 0) {
    report += `\n⚠️ **发现 ${regressions.length} 项退化！** 建议回滚或修复以下：\n`;
    for (const r of regressions) {
      report += `- ${r.name}: ✅ → ❌\n`;
    }
  } else if (results.some(r => !r.after)) {
    report += '\n⚠️ 部分测试失败（非回归，可能是初始状态即为失败）\n';
  } else {
    report += '\n✅ 全部通过，无退化。\n';
  }

  report += '\n---\n';
  appendFileSync(REGRESSION_FILE, report, 'utf-8');
}

// ── 格式化回归结果 ──
export function formatRegressionSummary(results: RegressionResult[]): string {
  const regressions = results.filter(r => r.regressed);
  const passCount = results.filter(r => r.after).length;
  const total = results.length;

  let summary = `## 📊 能力回归测试: ${passCount}/${total} 通过\n\n`;
  summary += '```\n';
  for (const r of results) {
    const icon = r.regressed ? '🔴 REGRESSED' : r.after ? '✅' : '⚠️ FAIL';
    summary += `${icon}  ${r.name}\n`;
  }
  summary += '```\n';

  if (regressions.length > 0) {
    summary += `\n⚠️ **发现 ${regressions.length} 项退化**：\n`;
    regressions.forEach(r => { summary += `- ${r.name}: 优化前 ✅ → 优化后 ❌\n`; });
    summary += '\n建议立即回滚最近的改动。';
  } else {
    summary += '\n✅ 无能力退化。';
  }

  return summary;
}

// ── 设置默认测试（DaShaAgent 核心能力） ──
export function setupDefaultCapabilityTests(
  checks: {
    toolsAvailable: () => boolean,
    sessionsFileOk: () => boolean,
    skillsLoaded: () => boolean,
    memoryOk: () => boolean,
    configOk: () => boolean,
  }
): void {
  registerCapabilityTest({
    id: 'tools_available',
    name: '工具注册表正常',
    description: 'registry.list() 返回非空数组',
    check: checks.toolsAvailable,
  });
  registerCapabilityTest({
    id: 'sessions_file',
    name: '会话持久化正常',
    description: 'data/memory/sessions.json 存在且可读',
    check: checks.sessionsFileOk,
  });
  registerCapabilityTest({
    id: 'skills_loaded',
    name: '技能加载正常',
    description: '至少加载了基础技能',
    check: checks.skillsLoaded,
  });
  registerCapabilityTest({
    id: 'memory_system',
    name: '记忆系统正常',
    description: 'MemoryManager 可用',
    check: checks.memoryOk,
  });
  registerCapabilityTest({
    id: 'config_valid',
    name: '配置文件有效',
    description: 'config.json 可解析',
    check: checks.configOk,
  });
}

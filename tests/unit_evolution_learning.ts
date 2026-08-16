// 单元测试：evolution + learning + autonomy — 今日接线的自进化/学习/自主闭环
//   recordGap/autoFactory（能力缺口采集→技能工厂）
//   learnFromTask（经验→知识→技能蒸馏的数据源）
//   autonomy goals（待执行目标生成与排序，onAutonomy 钩子的数据源）
// 运行：npx tsx tests/unit_evolution_learning.ts（或 node tests/unit_all.cjs 全量）
//
// 注意：evolution 会落盘 data/evolution/*.jsonl —— 本测试把 CONFIG.DATA_DIR
// 临时重定向到系统临时目录（在动态 import 之前，因 GAPS_FILE 在模块加载时求值），
// 跑完恢复并清理，不污染真实数据。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CONFIG } from '../server/src/config/index.ts';

function assert(cond: any, msg: string) {
  if (!cond) { console.error('FAIL:', msg); process.exit(1); }
}

(async () => {
  const originalDataDir = CONFIG.DATA_DIR;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ah-unit-evo-'));
  CONFIG.DATA_DIR = tmp; // 必须先改再动态 import（模块加载时求值落盘路径）

  try {
    const { recordGap, listAllGaps, listOpenGaps, markGapResolved } = await import('../server/src/evolution/capabilityGap.ts');
    const { autoFactory } = await import('../server/src/evolution/evolutionEngine.ts');
    const { recordSkillCall, listSkills, registerSkill } = await import('../server/src/evolution/skillRegistry.ts');
    const { learning } = await import('../server/src/learning/index.ts');
    const { autonomy } = await import('../server/src/autonomy/index.ts');

    // ── 1. recordGap：记录 + 同能力去重 + 频次累加 + 解决标记（生产 AgentLoop 的采集端）──
    recordGap({ capability: 'unit_test_cap', category: 'tool_missing', task: '测试任务1' });
    recordGap({ capability: 'unit_test_cap', category: 'tool_missing', task: '测试任务2' });
    const mine = listAllGaps().filter(g => g.capability === 'unit_test_cap');
    assert(mine.length === 1, `同 capability 应去重为 1 条, 实际 ${mine.length}`);
    assert(mine[0].frequency === 2, `频次应累加到 2, 实际 ${mine[0].frequency}`);
    assert(listOpenGaps().some(g => g.capability === 'unit_test_cap'), '未解决时应出现在 open');
    markGapResolved('unit_test_cap', 'test-skill');
    assert(!listOpenGaps().some(g => g.capability === 'unit_test_cap'), '解决后不应出现在 open');

    // ── 2. autoFactory：达到频次阈值(GAP_THRESHOLD=2)后生成技能骨架并闭环标记（统一入口消费者）──
    recordGap({ capability: 'unit_factory_cap', category: 'task_failure' });
    recordGap({ capability: 'unit_factory_cap', category: 'task_failure' }); // frequency=2 → 达阈值
    const r = autoFactory();
    assert(r.created.some(id => id.includes('unit-factory-cap')), `autoFactory 应生成技能骨架, created=${r.created.join(',')}`);
    assert(!listOpenGaps().some(g => g.capability === 'unit_factory_cap'), '生成后缺口应标记已解决');

    // ── 3. learnFromTask：经验摄入 → 蒸馏出可检索知识（今日接线的数据源，此前蒸馏空转）──
    // 注：totalKnowledge 统计的是"蒸馏后"知识；单条经验只进经验池(totalExperiences)。
    // 同源经验积累满 3 条会触发 autoDistill → 产出知识 → getRecentInsights 可检索（onLearn 钩子数据）。
    const st0 = learning.knowledge.stats();
    for (let i = 1; i <= 3; i++) {
      learning.learnFromTask({ taskName: 'unit.test', goal: `测试学习闭环${i}`, result: `第${i}次成功`, success: true });
    }
    const st1 = learning.knowledge.stats();
    assert(st1.totalExperiences - st0.totalExperiences === 3,
      `learnFromTask 应摄入 3 条经验: ${st0.totalExperiences}→${st1.totalExperiences}`);
    assert(st1.totalKnowledge >= 1,
      `3 条同源经验应蒸馏出知识: totalKnowledge=${st1.totalKnowledge}`);
    const insights = learning.getRecentInsights(3);
    assert(Array.isArray(insights) && insights.length >= 1,
      `getRecentInsights 应有产出(供 onLearn 注入): ${JSON.stringify(insights)}`);

    // ── 3b. learnFromReflection：反思结果摄入（今日接入 TaskVerifier 修正路径的闭环）──
    const refl0 = learning.knowledge.stats().totalExperiences;
    learning.learnFromReflection({
      goal: '测试反思', verification: { verified: true, confidence: 0.9, issues: [] },
      reflection: { needRetry: false },
    });
    learning.learnFromReflection({
      goal: '测试反思失败', verification: { verified: false, confidence: 0.2, issues: ['文件未找到'] },
      reflection: { needRetry: true, reason: '声称的文件不存在' },
    });
    const refl1 = learning.knowledge.stats().totalExperiences;
    assert(refl1 - refl0 === 2,
      `learnFromReflection 应摄入 2 条反思经验: ${refl0}→${refl1}`);

    // ── 3c. recordSkillCall：工具性能指标（今日接入 AgentLoop 工具执行处的闭环）──
    // 首次调用应自动登记（工具名即 id），后续调用更新成功率/延迟/次数。
    const s1 = recordSkillCall('unit_tool_x', { success: true, latencyMs: 100 });
    assert(s1.usageCount === 1 && s1.avgLatencyMs === 100,
      `首次调用应自动登记: usage=${s1.usageCount} latency=${s1.avgLatencyMs}`);
    assert(s1.successRate > 0, `成功后成功率应>0: ${s1.successRate}`);
    recordSkillCall('unit_tool_x', { success: false, latencyMs: 300 });
    const s2 = listSkills().find(s => s.id === 'unit_tool_x');
    if (!s2) { console.error('FAIL: unit_tool_x 应已自动登记'); process.exit(1); } // 窄化 s2 → SkillStat
    assert(s2.usageCount === 2,
      `两次调用后 usageCount=2: ${s2.usageCount}`);
    assert(s2.successRate < s1.successRate,
      `失败后成功率应下降: ${s1.successRate.toFixed(3)}→${s2.successRate.toFixed(3)}`);
    assert(s2.avgLatencyMs === 200,
      `平均延迟应更新为 200: ${s2.avgLatencyMs}`);

    // ── 3d. 业务技能注册↔调用对齐：registerSkill 注册后，同 id 的 recordSkillCall 指标能累加到技能上 ──
    // （模拟 unified.ts 启动时全量注册业务技能，id='skill_'+slugify(name)，与工具调用名一致）
    registerSkill({ id: 'skill_unit_biz', name: 'unit-biz-skill', version: '1.0', description: '测试业务技能', capabilities: ['biz'], createdBy: 'builtin' });
    recordSkillCall('skill_unit_biz', { success: true, latencyMs: 50 });
    const biz = listSkills().find(s => s.id === 'skill_unit_biz');
    assert(biz && biz.usageCount === 1 && biz.avgLatencyMs === 50,
      `注册后同 id 调用应累加指标: usage=${biz?.usageCount} latency=${biz?.avgLatencyMs}`);
    assert(biz && biz.createdBy === 'builtin', `业务技能应标记 builtin 来源: ${biz?.createdBy}`);
    // 幂等：重复注册不重置累计指标
    registerSkill({ id: 'skill_unit_biz', name: 'unit-biz-skill', version: '1.0', description: '测试业务技能', capabilities: ['biz'], createdBy: 'builtin' });
    const biz2 = listSkills().find(s => s.id === 'skill_unit_biz');
    assert(biz2 && biz2.usageCount === 1, `重复注册应保留累计指标: usage=${biz2?.usageCount}`);

    // ── 4. autonomy goals：生成 + pending 排序 + 状态流转（onAutonomy 钩子的数据源）──
    const goals = autonomy.generator.fromOpportunities([
      { title: '磁盘空间不足', reason: 'D盘剩余不足', priority: 0.9, value: 0.8, effort: 'medium', suggestedAction: '清理临时文件' } as any,
      { title: '进程异常', reason: 'node.exe 消失', priority: 0.5, value: 0.6, effort: 'low', suggestedAction: '重启进程' } as any,
    ]);
    assert(goals.length === 2, `应生成 2 个目标, 实际 ${goals.length}`);
    const pending = autonomy.generator.pending();
    assert(pending.length === 2, `pending 应含 2 个目标, 实际 ${pending.length}`);
    assert(pending[0].priority >= pending[1].priority, 'pending 应按优先级降序');
    assert(pending.every(g => ['new', 'pending'].includes(g.status)), 'pending 仅含 new/pending 状态');
    autonomy.generator.complete(goals[0].id);
    assert(autonomy.generator.active().every(g => g.status !== 'completed'), 'completed 目标不应再出现在 active');

    console.log('PASS: unit_evolution_learning — 能力缺口/技能工厂/经验蒸馏/自主目标全部通过');
  } finally {
    CONFIG.DATA_DIR = originalDataDir; // 恢复真实数据目录
    fs.rmSync(tmp, { recursive: true, force: true }); // 清理临时目录
  }
  process.exit(0);
})().catch(e => { console.error('FAIL:', e); process.exit(1); });

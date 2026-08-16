// tests/unit_learning_skill.ts
// 自进化闭环验收测试（2026-08-13 评估 R3 修复）
// 验证「经历 → 知识 → 技能」蒸馏链路真实可用：注入多样化同领域成功经验样本，
// 触发 distill()，断言知识被蒸馏、技能被产出并被 SkillManager 安装。
// 独立实例运行，不读写真实 data/，不产生任何副作用。

import { LearningEngine } from '../server/src/learning';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra = '') {
  if (cond) { pass++; console.log('  ✅ ' + name + (extra ? '  ' + extra : '')); }
  else { fail++; console.log('  ❌ ' + name + (extra ? '  ' + extra : '')); }
}

async function main() {
  console.log('=== 自进化闭环：经历→知识→技能 ===');
  const eng = new LearningEngine();
  const installed: any[] = [];
  eng.setSkillManager({ install: (s: any) => { installed.push(s); } });

  // 1. 注入多样化的同领域成功经验（不同任务措辞 → 知识不合并 → 同一领域积累足够条目）
  const tasks = [
    '生成海事日报：解析AIS轨迹数据。统计船舶滞留缺陷。输出PDF报告。',
    '分析PSC检查趋势：整理高频缺陷。对比备忘录公告。输出分析文档。',
    '船舶状态查询：读取船位数据。核对到港时间。生成航行简报。',
    '港口延误分析：汇总靠泊记录。计算平均延误。输出统计表格。',
    '航海气象预警：抓取气象报文。评估航线风险。生成预警摘要。',
    '海事法规检索：查找IMO新规。标注生效日期。整理合规要点。',
  ];
  for (let i = 0; i < tasks.length; i++) {
    for (let j = 0; j < 2; j++) { // 每类 2 条 → 12 条
      eng.learnFromTask({
        taskName: 'maritime.task.' + (i % 3),
        goal: tasks[i],
        result: '完成',
        success: true,
        context: { domain: 'maritime' },
      });
    }
  }
  const kStat = eng.knowledge.stats();
  ok('摄入后知识库非空', kStat.totalKnowledge > 0, `knowledge=${kStat.totalKnowledge}`);

  // 2. 显式跑一轮完整蒸馏
  const r = eng.distill();
  ok('知识库蒸馏可见', r.knowledgeCount > 0, `knowledge=${r.knowledgeCount}`);
  ok('技能蒸馏产出', r.skillCount > 0, `skills=${r.skillCount}`);

  // 3. 技能被 SkillManager 安装（激活闭环：蒸馏 → 注册 → 可调用）
  ok('技能已安装到 SkillManager', installed.length > 0, `installed=${installed.length}`);
  const s = installed[0];
  ok('安装的技能有名称与描述', !!(s?.name && s?.description), s?.name || '');
  ok('安装的技能带触发词', Array.isArray(s?.capabilities) && s.capabilities.length > 0,
    JSON.stringify(s?.capabilities || []).slice(0, 60));

  // 4. 技能统计可见（Dashboard 数据源）
  const st = eng.skills.stats();
  ok('SkillRegistry 技能数 > 0', st.totalSkills > 0, `total=${st.totalSkills}`);

  console.log(`\n通过 ${pass} / 失败 ${fail}`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error('测试异常:', e); process.exit(1); });

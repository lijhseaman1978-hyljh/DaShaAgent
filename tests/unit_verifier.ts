// 单元测试：cognition/verifier.ts — TaskVerifier 任务完成验证（今日接入生产 AgentLoop 的模块）
// 运行：npx tsx tests/unit_verifier.ts（或 node tests/unit_all.cjs 全量）
import fs from 'node:fs';
import path from 'node:path';
import { TaskVerifier } from '../server/src/cognition/verifier.ts';
import { CONFIG } from '../server/src/config/index.ts';

function assert(cond: any, msg: string) {
  if (!cond) { console.error('FAIL:', msg); process.exit(1); }
}

(async () => {
  const v = new TaskVerifier();

  // 1. 幻觉检测：声称创建文件但不存在 → verified=false + shouldRetry=true（生产会触发修正轮）
  const fake = v.verify({
    goal: '生成 Word 报告到桌面',
    result: '已生成报告，文件在 C:/Users/your-user/Desktop/__unit_verifier_missing__.docx',
  });
  assert(fake.verified === false, `幻觉应判未通过: issues=${JSON.stringify(fake.issues)}`);
  assert(fake.shouldRetry === true, `幻觉应可重试: shouldRetry=${fake.shouldRetry}`);
  assert(fake.issues.some((i: string) => i.includes('未找到')), 'issues 应含「文件未找到」');

  // 2. 真实文件：WORKSPACE_DIR 下建临时文件（白名单内）→ evidence 含「文件已创建」、不报缺失
  const tmpDir = path.join(CONFIG.WORKSPACE_DIR, 'unit_verifier_tmp');
  const tmpFile = path.join(tmpDir, 'regression_check.docx');
  fs.mkdirSync(tmpDir, { recursive: true });
  fs.writeFileSync(tmpFile, 'unit test content', 'utf8');
  const real = v.verify({ goal: '生成 docx', result: `已生成：${tmpFile}` });
  assert(real.evidence.some((e: string) => e.includes('文件已创建')), `真实文件应进入 evidence: ${JSON.stringify(real.evidence)}`);
  assert(!real.issues.some((i: string) => i.includes('未找到')), '真实文件不应报缺失');
  fs.rmSync(tmpDir, { recursive: true, force: true });

  // 3. 正常问答不应触发修正（生产循环 requires shouldRetry，纯问答绝不能误伤）
  const qa = v.verify({ goal: '你好', result: '你好，有什么可以帮你？' });
  assert(qa.shouldRetry === false, `纯问答不应要求修正: verified=${qa.verified} shouldRetry=${qa.shouldRetry}`);

  // 4. 结构化失败信号：result 带 error 字段 → 判未通过
  const err = v.verify({ goal: '执行任务', result: { error: '执行失败：磁盘已满' } });
  assert(err.verified === false, '结构化 error 应判未通过');

  // 5. 空结果 / 占位符 → 判未通过
  assert(v.verify({ goal: 'x', result: '' }).verified === false, '空结果应判未通过');
  assert(v.verify({ goal: 'x', result: 'N/A' }).verified === false, 'N/A 占位应判未通过');

  // 6. null 结果 → 判未通过
  assert(v.verify({ goal: 'x', result: null as any }).verified === false, 'null 结果应判未通过');

  // 7. 历史记录：record() 写入 history 供 confidence tracker 使用
  v.record(fake);
  assert(v.getHistory().length === 1, 'record 后 history 应为 1 条');

  console.log('PASS: unit_verifier — TaskVerifier 幻觉/文件/空结果检测全部通过');
  process.exit(0);
})().catch(e => { console.error('FAIL:', e); process.exit(1); });

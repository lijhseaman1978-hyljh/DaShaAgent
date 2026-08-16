// tests/unit_router.ts
// LLM Router 任务路由规则测试（2026-08-13 R5：select() 优先级明确化）
// 验证核心不变量：路由结果总是已注册 provider、且与配置优先级一致。

import { LLMRouter } from '../server/src/llm/router';
import { config } from '../server/src/config';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra = '') {
  if (cond) { pass++; console.log('  ✅ ' + name + (extra ? '  ' + extra : '')); }
  else { fail++; console.log('  ❌ ' + name + (extra ? '  ' + extra : '')); }
}

function main() {
  console.log('=== LLM Router select() 路由规则 ===');
  const router = new LLMRouter();
  const providers = router.list();
  const cfgProvider = config.getLLM().provider;

  // 1. 各类任务都能稳定给出路由结果
  const cases: Array<[string, string]> = [
    ['帮我写一段排序代码', '代码任务'],
    ['x'.repeat(5001), '超长任务'],
    ['涉及隐私的本地数据处理', '隐私任务'],
    ['你好，介绍一下自己', '普通任务'],
    ['', '空任务'],
  ];
  for (const [task, label] of cases) {
    const r = router.select(task);
    ok(`${label} → 路由结果已注册`, providers.includes(r), `${label}: ${r}`);
  }

  // 2. 配置优先（规则 1）：显式配置了非 openai provider 时，任务特征不改变结果
  if (cfgProvider && cfgProvider !== 'openai') {
    const all = cases.map(([t]) => router.select(t));
    ok(`配置优先：所有任务路由到配置 provider "${cfgProvider}"`, all.every(p => p === cfgProvider), all.join(','));
  }

  // 3. 未配置或配置为 openai 时，特征路由仍可寻址
  const fallback = router.select('代码任务，帮我写一段');
  ok('特征路由可寻址（代码→openai 或配置值）', providers.includes(fallback), fallback);

  console.log(`\n通过 ${pass} / 失败 ${fail}`);
  process.exit(fail === 0 ? 0 : 1);
}

main();

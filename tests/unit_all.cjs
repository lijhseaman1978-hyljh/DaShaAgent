// 单元测试聚合器：依次运行全部单测文件，任一失败则整体失败（exit≠0）
// 用法：node tests/unit_all.cjs（package.json: "test:unit"）
const { spawnSync } = require('node:child_process');

const files = [
  'tests/unit_retry.ts',
  'tests/unit_verifier.ts',
  'tests/unit_security.ts',
  'tests/unit_evolution_learning.ts',
];

let failed = 0;
for (const f of files) {
  console.log(`\n========== ${f} ==========`);
  const r = spawnSync('npx', ['tsx', f], { stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) {
    console.error(`❌ ${f} 失败 (exit ${r.status})`);
    failed++;
  }
}

console.log(`\n单元测试汇总: ${files.length - failed}/${files.length} 通过`);
process.exit(failed === 0 ? 0 : 1);

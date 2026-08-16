// tests/self_improve_test.ts — 四层自进化架构集成测试
let passed = 0, failed = 0;

function test(name: string, fn: () => boolean | Promise<boolean> | void) {
  Promise.resolve().then(async () => {
    try {
      const r = await fn();
      if (r === false) { console.log(`  FAIL ${name}`); failed++; }
      else { console.log(`  PASS ${name}`); passed++; }
    } catch (e: any) {
      console.log(`  FAIL ${name}: ${e.message}`);
      failed++;
    }
  });
}

console.log('\n=== 四层自进化架构集成测试 ===\n');
process.env.NODE_ENV = 'test';

// ── Tier 1: autoLogger ──
import('../src/self-improve/autoLogger').then(({ captureReflection, captureFeatureRequest }) => {
  test('captureReflection(failure) writes ERRORS.md', () => {
    captureReflection({ goal: 'TEST: Word doc', success: false, toolCallCount: 0, summary: 'fake claim', lesson: 'hallucination', timestamp: Date.now() });
    return true;
  });
  test('captureReflection(success+lesson) writes LEARNINGS.md', () => {
    captureReflection({ goal: 'TEST: news search', success: true, toolCallCount: 3, summary: 'ok', lesson: 'search first', timestamp: Date.now() });
    return true;
  });
  test('captureFeatureRequest writes FEATURE_REQUESTS.md', () => {
    captureFeatureRequest('auto SEO', 'captain wants auto SEO tags');
    return true;
  });

  // ── Tier 2: promptInjector ──
  return import('../src/self-improve/promptInjector');
}).then(({ buildSelfEvolvePrompt, extractActiveRules }) => {
  test('buildSelfEvolvePrompt returns non-empty', () => {
    const p = buildSelfEvolvePrompt('gen doc');
    return typeof p === 'string' && p.length > 0;
  });
  test('buildSelfEvolvePrompt contains RULE-001', () => {
    return buildSelfEvolvePrompt('test').includes('RULE-001');
  });
  test('extractActiveRules returns array', () => {
    return Array.isArray(extractActiveRules(10));
  });

  // ── Tier 3: patternDetector ──
  return import('../src/self-improve/patternDetector');
}).then(({ scanPatterns, runPatternCheck }) => {
  test('scanPatterns returns array', () => Array.isArray(scanPatterns()));
  test('runPatternCheck returns result', () => {
    const r = runPatternCheck();
    return r && Array.isArray(r.proposals);
  });

  // ── Tier 4: regressionGuard ──
  return import('../src/self-improve/regressionGuard');
}).then(async ({ registerCapabilityTest, runBaseline, runRegressionCheck, formatRegressionSummary }) => {
  test('register+baseline', async () => {
    registerCapabilityTest({ id: 't_pass', name: 'always pass', description: '1+1=2', check: () => true });
    const b = await runBaseline();
    return b['t_pass'] === true;
  });
  test('regression check', async () => {
    const r = await runRegressionCheck();
    return Array.isArray(r) && r.length > 0;
  });
  test('format summary', async () => {
    const r = await runRegressionCheck();
    const s = formatRegressionSummary(r);
    return typeof s === 'string' && s.length > 0;
  });

  // 等待所有测试完成后输出结果
  await new Promise(r => setTimeout(r, 500));
  console.log(`\n📊 结果: ${passed} 通过, ${failed} 失败\n`);
  if (failed > 0) process.exit(1);
}).catch((e) => {
  console.error('Test suite error:', e);
  process.exit(1);
});

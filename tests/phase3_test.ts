// Phase 3 Batch A+B 测试——验证本轮新增/修复的组件
// 运行：npx tsx tests/phase3_test.ts

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra = '') {
  if (cond) { pass++; console.log('  ✅ ' + name + (extra ? '  ' + extra : '')); }
  else { fail++; console.log('  ❌ ' + name + (extra ? '  ' + extra : '')); }
}
function section(t: string) { console.log('\n=== ' + t + ' ==='); }

async function main() {
  // ── 1. B24 Tracer spanMap O(1) 查找 ─────────────────────────
  section('1. Tracer (B24)');
  const { tracer } = await import('../server/src/observability/tracer.ts');
  const root = tracer.start('root_trace');
  const child = tracer.start('child_trace');
  ok('根 span 存在', (tracer as any).roots.length >= 1);
  const spanMap = (tracer as any).spanMap as Map<string, any>;
  ok('spanMap O(1) 命中 root', !!spanMap?.get(root.id));
  tracer.end('child_trace');
  tracer.end('root_trace');
  tracer.clear();
  ok('clear 后清空', (tracer as any).roots.length === 0);

  // ── 2. B25 CostTracker registerPricing ────────────────────────
  section('2. CostTracker (B25)');
  const { cost } = await import('../server/src/observability/cost.ts');

  // registerPricing 接受 (model, inputPer1k, outputPer1k)
  const hasRegMethod = typeof (cost as any).registerPricing === 'function';
  ok('registerPricing 方法存在', hasRegMethod);

  // 测试构造注入
  const { CostTracker } = await import('../server/src/observability/cost.ts');
  const ct = new CostTracker();
  ct.registerPricing('test-model', 0.001, 0.002);
  const testPrice = (ct as any).pricing['test-model'];
  ok('构造注入可读写', !!testPrice && testPrice.input === 0.001);

  // ── 3. V3吞并V2 (Phase 2b) ─────────────────────────────────
  section('3. V3吞并V2: profile/notes 一体化');
  const { CognitiveMemoryOS } = await import('../server/src/cognitive/os.ts');
  const { MemoryManager, injectV3 } = await import('../server/src/memory/index.ts');

  const v3 = new CognitiveMemoryOS({ autoIndex: false, autoLearn: false });
  injectV3(v3);
  const v2 = new MemoryManager();

  // Profile
  v2.setProfile({ name: 'your-user', role: '船长' });
  ok('V2→V3 profile 写入', v3.profile.name === 'your-user');
  ok('V2 getProfile 同步', v2.getProfile().role === '船长');

  // Notes
  v2.remember('测试_B1', 'B1双写验证');
  const note = v2.readNote('测试_B1');
  ok('V2→V3 笔记写入', note !== null && note.includes('B1双写验证'));
  ok('V3 notes Map 同步', v3.notes.has('测试_B1'));

  // 删除
  v2.deleteNote('测试_B1');
  ok('V2 deleteNote → V3', !v3.notes.has('测试_B1'));
  ok('V2 readNote 返回 null', v2.readNote('测试_B1') === null);

  // ── 4. B2 MemoryStore 持久化 ──────────────────────────────────
  section('4. MemoryStore 持久化 (B2)');
  const { MemoryStore } = await import('../server/src/memory/core/memoryStore.ts');
  const store = new MemoryStore();
  store.save({
    id: 't1', type: 'episodic', content: { task: '持久化测试' },
    createdAt: Date.now(), importance: 0.8, tags: ['test'],
  });
  const tmpPath = (process.env.TEMP || '/tmp') + '/test_memory_store.json';
  store.saveToFile(tmpPath);
  ok('saveToFile 无异常', true);

  const store2 = new MemoryStore();
  store2.loadFromFile(tmpPath);
  const loaded = store2.findByType('episodic');
  ok('loadFromFile 恢复数据', loaded.length >= 1, `找到 ${loaded.length} 条`);

  // ── 5. B17 EpisodicMemory 持久化 ──────────────────────────────
  section('5. EpisodicMemory (B17)');
  const { EpisodicMemory } = await import('../server/src/cognitive/core/episodicMemory.ts');
  const ep = new EpisodicMemory();
  ep.save({ task: '持久化测试', result: 'success', lesson: '学到了' });
  const epPath = (process.env.TEMP || '/tmp') + '/test_episodes_b17.json';

  ep.saveToFile(epPath);
  const ep2 = new EpisodicMemory();
  ep2.loadFromFile(epPath);
  ok('loadFromFile 恢复', ep2.size === 1);
  ok('内容一致', ep2.records[0].task === '持久化测试');

  // ── 6. B19 KnowledgeGraph writeThrough ─────────────────────────
  section('6. KnowledgeGraph (B19)');
  const { KnowledgeGraph } = await import('../server/src/cognitive/graph/knowledgeGraph.ts');
  const kg = new KnowledgeGraph();
  const kgPath = (process.env.TEMP || '/tmp') + '/test_kg_b19.json';
  kg.enableWriteThrough(kgPath);
  kg.addNode({ id: 'test_node', type: 'concept', label: '测试节点' });
  kg.addRelation({ from: 'test_node', to: 'target_node', relation: 'relatesTo' as any });
  ok('写透无异常', true);

  const kg2 = new KnowledgeGraph();
  kg2.loadFromFile(kgPath);
  ok('loadFromFile 恢复节点', kg2.nodes.length >= 2, `节点: ${kg2.nodes.length}`);
  ok('loadFromFile 恢复边', kg2.edges.length >= 1, `边: ${kg2.edges.length}`);

  // ── 7. B20 Consolidation hooks ────────────────────────────────
  section('7. Consolidation hooks (B20)');
  const hookLog: string[] = [];
  v3.onConsolidate((phase, result) => {
    hookLog.push(phase + (result ? `(${result.episodes.after}ep)` : ''));
  });
  await v3.consolidate();
  ok('before hook 触发', hookLog.some(h => h.startsWith('before')), hookLog.join(','));
  ok('after hook 触发', hookLog.some(h => h.startsWith('after')), hookLog.join(','));

  // ── 8. B18 LearningEngine 错误处理 ─────────────────────────────
  section('8. LearningEngine (B18)');
  const { LearningEngine } = await import('../server/src/cognitive/learning/learningEngine.ts');
  const le = new LearningEngine();
  // 空 lesson 应跳过
  const r1 = le.learn({ id: 'test1', task: '测试', actions: [], result: 'success', lesson: '' });
  ok('空 lesson → skipped', r1.mode === 'skipped');
  // 失败 → antiPattern
  const r3 = le.learn({ id: 'test3', task: '失败操作', actions: [], result: 'failure', outcome: 'failure', lesson: '踩了个坑' });
  ok('失败 → antiPattern', r3.mode === 'created' && !!r3.antiPattern);

  // ── 9. B22 cosine 维度不匹配 WARN ──────────────────────────────
  section('9. Cosine WARN (B22)');
  const { cosine } = await import('../server/src/cognitive/vector/embedding.ts');
  const origWarn = console.warn;
  let warnCalled = false;
  console.warn = (...args: any[]) => {
    if (String(args[0]).includes('CosineWARN')) warnCalled = true;
  };
  const result = cosine([0.1, 0.2, 0.3], [0.4, 0.5]); // 维度不一致：3 vs 2
  console.warn = origWarn;
  ok('维度不匹配触发 WARN', warnCalled);
  ok('降级为 min dim 计算', typeof result === 'number' && !isNaN(result));

  // ── 清理临时文件 ──────────────────────────────────────────────
  try {
    const fs = require('fs');
    [tmpPath, epPath, kgPath].forEach(p => { try { fs.unlinkSync(p); } catch {} });
  } catch {}

  // ── 汇总 ──────────────────────────────────────────────────────
  console.log(`\n${'='.repeat(50)}`);
  console.log(`  通过: ${pass}  失败: ${fail}  总计: ${pass + fail}`);
  if (fail) { console.log('  ⚠ 存在失败项，需排查'); process.exit(1); }
  else console.log('  🎉 Phase 3 Batch A+B 全部通过！');
}

main().catch(e => { console.error(e); process.exit(1); });

// 单元测试：agent/executor/retry.ts — 指数退避重试（今日接入生产 AgentLoop 的模块）
// 运行：npx tsx tests/unit_retry.ts（或 node tests/unit_all.cjs 全量）
import { retry, isRetryableError } from '../server/src/agent/executor/retry.ts';

function assert(cond: any, msg: string) {
  if (!cond) { console.error('FAIL:', msg); process.exit(1); }
}

(async () => {
  // 1. 瞬态失败后成功：fn 前 2 次抛网络错误，第 3 次成功 → 返回结果且共调用 3 次
  let calls = 0;
  const r = await retry(async () => {
    calls++;
    if (calls < 3) { const e: any = new Error('ECONNRESET'); e.code = 'ECONNRESET'; throw e; }
    return 'ok';
  }, 3, { baseDelayMs: 1, maxDelayMs: 10 });
  assert(r === 'ok' && calls === 3, `重试后应成功且调用3次, 实际 calls=${calls} r=${r}`);

  // 2. 始终失败：最终抛原始错误，调用次数 = times
  let calls2 = 0, threw2 = false;
  try {
    await retry(async () => { calls2++; throw new Error('boom'); }, 3, { baseDelayMs: 1, maxDelayMs: 10 });
  } catch (e: any) { threw2 = true; assert(e.message === 'boom', '应抛出原始错误'); }
  assert(threw2 && calls2 === 3, `始终失败应重试3次后抛错: calls=${calls2} threw=${threw2}`);

  // 3. 不可重试错误（401）→ 立即失败，只调 1 次（认证错误重试无意义）
  let calls3 = 0, threw3 = false;
  try {
    await retry(async () => { calls3++; const e: any = new Error('unauthorized'); e.status = 401; throw e; }, 3, { baseDelayMs: 1 });
  } catch { threw3 = true; }
  assert(threw3 && calls3 === 1, `401 应只调1次: calls=${calls3} threw=${threw3}`);

  // 4. 429 限流 → 可重试，第 2 次成功
  let calls4 = 0;
  const r4 = await retry(async () => {
    calls4++;
    if (calls4 === 1) { const e: any = new Error('rate limit'); e.status = 429; throw e; }
    return 'ok429';
  }, 3, { baseDelayMs: 1 });
  assert(r4 === 'ok429' && calls4 === 2, `429 应重试后成功: calls=${calls4}`);

  // 5. 自定义 isRetryable 覆盖：默认可重试的错误被标为不可重试 → 只调 1 次
  let calls5 = 0, threw5 = false;
  try {
    await retry(async () => { calls5++; throw new Error('ECONNRESET'); }, 3, { baseDelayMs: 1, isRetryable: () => false });
  } catch { threw5 = true; }
  assert(threw5 && calls5 === 1, `自定义不可重试应只调1次: calls=${calls5}`);

  // 6. 错误分类 isRetryableError（生产 AgentLoop 据此决定是否重试）
  assert(isRetryableError({ status: 429 }) === true, '429 → 可重试');
  assert(isRetryableError({ status: 401, message: 'unauthorized' }) === false, '401 → 不可重试');
  assert(isRetryableError({ status: 404 }) === false, '404 → 不可重试');
  assert(isRetryableError({ code: 'ECONNRESET' }) === true, 'ECONNRESET → 可重试');
  assert(isRetryableError({ message: 'timeout' }) === true, 'timeout → 可重试');
  assert(isRetryableError({ message: 'rate limit exceeded' }) === true, 'rate limit → 可重试');
  assert(isRetryableError({ message: 'bad request' }) === false, 'bad request → 不可重试');

  // 7. 单轮超时：fn 永不返回，timeoutMs=50 → 快速失败并重试（2 次后仍抛错，耗时 <5s 证明未卡死）
  let calls7 = 0, threw7 = false;
  const t0 = Date.now();
  try {
    await retry(async () => { calls7++; await new Promise(() => {}); }, 2, { baseDelayMs: 1, timeoutMs: 50 });
  } catch { threw7 = true; }
  const elapsed = Date.now() - t0;
  assert(threw7 && calls7 === 2 && elapsed < 5000, `超时应快速失败并重试: calls=${calls7} elapsed=${elapsed}ms`);

  console.log('PASS: unit_retry — 指数退避重试全部通过');
  process.exit(0);
})().catch(e => { console.error('FAIL:', e); process.exit(1); });

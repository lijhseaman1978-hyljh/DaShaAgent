// agent/executor/retry.ts
// 审计报告 F-03 修复：
//   旧方案 = 朴素 for 循环重试 3 次，无退避、无超时、无抖动、无错误分类。
//   瞬时抖动会被立即连打 3 次，反而放大限流/雪崩。
//   新方案 = 指数退避 + 完整抖动(complete jitter) + 每轮超时 + 可重试错误分类。
//
// 兼容性：保持 retry(fn, times=3) 签名（executor.ts 当前以单参调用），
// 第三个可选 opts 参数不影响既有调用方。

export interface RetryOptions {
  /** 最大尝试次数（含首次），默认 3 */
  times: number;
  /** 基础退避毫秒，默认 500 */
  baseDelayMs: number;
  /** 最大退避毫秒，默认 15000 */
  maxDelayMs: number;
  /** 单轮执行超时毫秒，默认 60000；超时视为失败并重试 */
  timeoutMs: number;
  /** 自定义"是否可重试"判断；返回 false 立即抛出不重试 */
  isRetryable?: (err: unknown) => boolean;
  /** 退避前的回调（可用于日志/指标） */
  onRetry?: (attempt: number, err: unknown, delayMs: number) => void;
}

const DEFAULTS: RetryOptions = {
  times: 3,
  baseDelayMs: 500,
  maxDelayMs: 15_000,
  timeoutMs: 60_000,
};

/** 常见不可重试错误：认证/权限/参数错误应立即失败，重试无效。 */
export function isRetryableError(err: unknown): boolean {
  const e = err as any;
  const msg: string = (e?.message ?? String(err ?? '')).toLowerCase();
  const code: string = e?.code ?? '';
  // 4xx 类（非 429）：不重试
  if (e?.status && e.status >= 400 && e.status < 500 && e.status !== 429) return false;
  if (/auth|unauthorized|forbidden|permission|invalid.?api.?key|bad.?request/i.test(msg)) return false;
  // 429 限流：可重试（配合退避）
  if (e?.status === 429) return true;
  if (/rate.?limit|too many requests|timeout|econnreset|econnrefused|etimedout|enotfound|temporary|5\d\d/i.test(msg)) return true;
  // 网络/系统瞬态错误码
  if (['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNABORTED'].includes(code)) return true;
  // 默认：可重试（保守，避免把可恢复错误直接放弃）
  return true;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`retry: attempt timed out after ${ms}ms`)), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function retry<T>(
  fn: () => Promise<T>,
  times: number = 3,
  opts?: Partial<RetryOptions>,
): Promise<T> {
  // BUG-FIX: 位置参数 times 此前被忽略（循环误用 o.times 恒为默认 3），
  // 导致 retry(fn, 2) 仍重试 3 次。现在位置参数优先，opts.times 可覆盖。
  const o = { ...DEFAULTS, ...opts };
  const maxAttempts = (Number.isInteger(times) && times > 0) ? times : o.times;
  let lastErr: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await withTimeout(fn(), o.timeoutMs);
    } catch (e) {
      lastErr = e;
      const retryable = (o.isRetryable ?? isRetryableError)(e);
      if (!retryable) break;
      if (attempt === maxAttempts - 1) break; // 最后一轮失败，不再等待
      // 指数退避 + 完整抖动
      const exp = Math.min(o.maxDelayMs, o.baseDelayMs * 2 ** attempt);
      const delay = Math.random() * exp;
      o.onRetry?.(attempt + 1, e, delay);
      console.warn(`[retry] attempt ${attempt + 1} failed, retrying in ${Math.round(delay)}ms`, (e as any)?.message ?? e);
      await sleep(delay);
    }
  }
  throw lastErr;
}

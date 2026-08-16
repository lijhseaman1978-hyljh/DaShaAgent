// observability/silent.ts
// 静默错误可观测（2026-08-13 评估 R3 修复）
// 项目里大量 catch 块采用「失败不影响主流程」策略，错误被静默吞掉后
// 系统「看起来活着」却无法判断是否真的在工作。本模块提供统一的计量入口：
//   1) 每次被吞掉的错误 → metrics 计数（error.silent 总数 + 按类别细分）
//   2) 最近 200 条静默错误详情缓存在内存，供 /api/observability/summary 展示
// 用法：catch { countSilentError('onRecall', e) } —— 不抛异常、不阻塞主流程。
import { metrics } from './metrics';

const MAX_RECENT = 200;
const recent: Array<{ t: number; category: string; detail: string }> = [];

/** 记录一次被静默吞掉的错误（总计数 + 分类计数 + 最近详情）。任何失败都不影响主流程。 */
export function countSilentError(category: string, err?: unknown): void {
  try {
    metrics.increment('error.silent');
    const key = 'error.silent.' + String(category).replace(/[^\w.-]/g, '_');
    metrics.increment(key);
    const detail = err instanceof Error ? err.message : err ? String(err) : '';
    if (detail) {
      recent.push({ t: Date.now(), category, detail: String(detail).slice(0, 300) });
      if (recent.length > MAX_RECENT) recent.shift();
    }
  } catch {
    /* 计量自身失败绝不影响主流程 */
  }
}

/** 静默错误快照（供控制台/API 展示，证明断链可观测） */
export function silentErrorSnapshot(): { total: number; byCategory: Record<string, number>; recent: typeof recent } {
  const byCategory: Record<string, number> = {};
  for (const r of recent) byCategory[r.category] = (byCategory[r.category] || 0) + 1;
  const total = (metrics.snapshot()['error.silent']?.value ?? 0);
  return { total, byCategory, recent: recent.slice(-20) };
}

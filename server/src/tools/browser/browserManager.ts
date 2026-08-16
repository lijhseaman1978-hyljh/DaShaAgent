// tools/browser/browserManager.ts
// 计划书 Phase 2 - Step 2 §五：Browser Manager（Chromium 生命周期管理）。
//
// 工程加固（相对计划书原型）：
//   1) playwright 采用「动态 import」——未安装 / 未下载浏览器内核时，整个 harness 依然能编译与启动，
//      只是 BrowserTool 返回 available:false，而不是 import 期就把进程炸掉。
//   2) 浏览器实例复用 + 显式 close()，避免每次 execute 都新起一个 Chromium 进程把内存吃干。

export interface BrowserStartResult {
  ok: boolean;
  reason?: string;
}

export class BrowserManager {
  browser: any = null;
  private starting: Promise<BrowserStartResult> | null = null;

  /** 启动（幂等 + 并发安全）。失败时返回原因而不抛错。 */
  async start(): Promise<BrowserStartResult> {
    if (this.browser) return { ok: true };
    if (this.starting) return this.starting;

    this.starting = (async (): Promise<BrowserStartResult> => {
      try {
        const { chromium } = (await import('playwright')) as any;
        this.browser = await chromium.launch({ headless: true });
        return { ok: true };
      } catch (e: any) {
        const msg = e?.message ?? String(e);
        const reason = /Cannot find (module|package)|ERR_MODULE_NOT_FOUND/i.test(msg)
          ? 'playwright not installed — run: npm install playwright'
          : /Executable doesn'?t exist|browserType\.launch/i.test(msg)
            ? 'chromium not downloaded — run: npx playwright install chromium'
            : msg;
        return { ok: false, reason };
      } finally {
        this.starting = null;
      }
    })();

    return this.starting;
  }

  async page(): Promise<any> {
    if (!this.browser) {
      const r = await this.start();
      if (!r.ok) throw new Error(r.reason ?? 'browser unavailable');
    }
    const context = await this.browser.newContext();
    return await context.newPage();
  }

  async close(): Promise<void> {
    if (!this.browser) return;
    try {
      await this.browser.close();
    } catch {
      /* 关闭失败不影响主流程 */
    }
    this.browser = null;
  }

  get running(): boolean {
    return !!this.browser;
  }
}

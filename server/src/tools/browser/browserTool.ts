// tools/browser/browserTool.ts
// 计划书 Phase 2 - Step 2 §六：Browser Tool。
// 计划书「Step 2 目标 ①Browser Agent」要求：打开网页 / 搜索 / 点击 / 输入 / 截图 / 提取信息，
// 因此在 §六 原型（goto + title）基础上，以 action 分派的方式把这 6 项能力补齐。
//
// 权限：["network"] —— 不在 PermissionManager 默认放行集合内，需 Runtime 显式 grant('network')。

import { BrowserManager } from './browserManager';
import { fail } from '../core/tool';

export interface BrowserInput {
  /** 默认 'goto'。可选：goto | click | type | screenshot | extract | search */
  action?: 'goto' | 'click' | 'type' | 'screenshot' | 'extract' | 'search';
  url?: string;
  selector?: string;
  text?: string;
  path?: string;
  query?: string;
  /** 页面用完是否关闭浏览器（默认 true，避免残留 Chromium 进程） */
  keepAlive?: boolean;
}

export const BrowserTool = {
  name: 'browser',
  description: 'Web browsing tool — goto / click / type / screenshot / extract / search',
  permissions: ['network'],
  manager: new BrowserManager(),

  async execute(input: BrowserInput = {}) {
    const started = await this.manager.start();
    if (!started.ok) {
      return fail('browser', started.reason ?? 'browser unavailable', 'BrowserTool degrades gracefully; harness keeps running');
    }

    const action = input.action ?? 'goto';
    const page = await this.manager.page();

    try {
      switch (action) {
        case 'goto': {
          if (!input.url) return fail('browser', 'input.url is required for action=goto');
          await page.goto(input.url, { waitUntil: 'domcontentloaded' });
          return { ok: true, action, url: input.url, title: await page.title() };
        }

        case 'search': {
          const q = input.query ?? input.text ?? '';
          const url = input.url ?? `https://www.bing.com/search?q=${encodeURIComponent(q)}`;
          await page.goto(url, { waitUntil: 'domcontentloaded' });
          const results = await page.$$eval('h2 a', (nodes: any[]) =>
            nodes.slice(0, 5).map((n) => ({ title: n.innerText, href: n.href }))
          );
          return { ok: true, action, query: q, results };
        }

        case 'click': {
          if (!input.url || !input.selector) return fail('browser', 'input.url and input.selector are required');
          await page.goto(input.url, { waitUntil: 'domcontentloaded' });
          await page.click(input.selector);
          return { ok: true, action, selector: input.selector, title: await page.title() };
        }

        case 'type': {
          if (!input.url || !input.selector) return fail('browser', 'input.url and input.selector are required');
          await page.goto(input.url, { waitUntil: 'domcontentloaded' });
          await page.fill(input.selector, input.text ?? '');
          return { ok: true, action, selector: input.selector, typed: input.text ?? '' };
        }

        case 'screenshot': {
          if (!input.url) return fail('browser', 'input.url is required for action=screenshot');
          await page.goto(input.url, { waitUntil: 'domcontentloaded' });
          const path = input.path ?? 'screenshot.png';
          await page.screenshot({ path, fullPage: false });
          return { ok: true, action, path };
        }

        case 'extract': {
          if (!input.url) return fail('browser', 'input.url is required for action=extract');
          await page.goto(input.url, { waitUntil: 'domcontentloaded' });
          const selector = input.selector ?? 'body';
          const text: string = await page.$eval(selector, (el: any) => el.innerText ?? '');
          return { ok: true, action, selector, length: text.length, text: text.slice(0, 2000) };
        }

        default:
          return fail('browser', `unknown action: ${action}`);
      }
    } catch (e: any) {
      return fail('browser', e?.message ?? String(e));
    } finally {
      try {
        await page.close();
      } catch {
        /* ignore */
      }
      if (input.keepAlive !== true) await this.manager.close();
    }
  },
};

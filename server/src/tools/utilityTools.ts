// tools/utilityTools.ts
// 实用工具集：让 DaShaAgent 拥有通用能力（对标 dasha 的常用工具）
// 1. http_request   — HTTP 请求（GET/POST/PUT/DELETE，JSON/文本）
// 2. get_time       — 当前时间/时区
// 3. json_tool      — JSON 格式化/校验/提取
// 4. batch_files    — 批量文件操作（重命名/复制/统计）
// 5. browser_nav    — 浏览器控制（Playwright，用于网页自动化）
// 新增不破坏：独立文件，由 unified.ts 注册

import { registry } from './registry';

export function registerUtilityTools(): void {
  // ── 1. HTTP 请求 ──
  registry.register(
    {
      name: 'http_request',
      description:
        '发起 HTTP 请求（GET/POST/PUT/DELETE）。当需要调用外部 API、下载网页、提交表单时使用。' +
        '返回状态码+响应体。支持 JSON 和文本。',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: '请求 URL' },
          method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'DELETE'], description: '方法，默认GET' },
          headers: { type: 'object', description: '请求头（可选）' },
          body: { type: 'string', description: '请求体（POST/PUT用）' },
          json: { type: 'object', description: 'JSON请求体（POST/PUT用，自动转字符串+设置Content-Type）' },
          timeout: { type: 'number', description: '超时毫秒，默认15000' },
        },
        required: ['url'],
      },
    },
    async (args: any) => {
      const url = String(args.url || '');
      const method = String(args.method || 'GET').toUpperCase();
      const timeout = Number(args.timeout) || 15000;
      const headers: Record<string, string> = args.headers || {};
      let body: string | undefined;
      if (args.json) { body = JSON.stringify(args.json); headers['Content-Type'] = 'application/json'; }
      else if (args.body) { body = String(args.body); }
      try {
        const res = await fetch(url, {
          method,
          headers,
          body,
          signal: AbortSignal.timeout(timeout),
        });
        const text = await res.text();
        // 尝试解析 JSON
        let parsed: any = null;
        try { parsed = JSON.parse(text); } catch { /* 非JSON */ }
        return {
          ok: res.ok,
          status: res.status,
          contentType: res.headers.get('content-type') || '',
          data: parsed ?? text.slice(0, 20000),
        };
      } catch (e: any) {
        return { ok: false, error: String(e?.message || e) };
      }
    },
    { tier: 'core', summary: 'HTTP请求（GET/POST等）' },
  );

  // ── 2. 当前时间 ──
  registry.register(
    {
      name: 'get_time',
      description: '获取当前系统时间和时区。当需要知道"现在几点""今天日期"时使用。',
      parameters: {
        type: 'object',
        properties: {
          timezone: { type: 'string', description: '时区（可选，默认系统时区），如 Asia/Shanghai' },
        },
      },
    },
    async (args: any) => {
      const now = new Date();
      const tz = args.timezone ? new Date(now.toLocaleString('en-US', { timeZone: String(args.timezone) })) : now;
      return {
        iso: now.toISOString(),
        local: now.toLocaleString(),
        timezone: tz ? String(args.timezone) : Intl.DateTimeFormat().resolvedOptions().timeZone,
        unixMs: now.getTime(),
      };
    },
    { tier: 'core', summary: '获取当前时间/时区' },
  );

  // ── 3. JSON 工具 ──
  registry.register(
    {
      name: 'json_tool',
      description:
        'JSON 处理工具：格式化（pretty）、校验（validate）、提取字段（extract）。' +
        '当需要美化 JSON、检查 JSON 是否有效、从 JSON 中取字段时使用。',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['format', 'validate', 'extract'], description: '操作' },
          input: { type: 'string', description: 'JSON字符串' },
          path: { type: 'string', description: 'extract时提取的字段路径，如 data.items[0].name' },
        },
        required: ['action', 'input'],
      },
    },
    async (args: any) => {
      const action = String(args.action || '');
      const input = String(args.input || '');
      try {
        const parsed = JSON.parse(input);
        if (action === 'validate') return { ok: true, valid: true, type: Array.isArray(parsed) ? 'array' : typeof parsed };
        if (action === 'format') return { ok: true, formatted: JSON.stringify(parsed, null, 2) };
        if (action === 'extract') {
          // 简单路径提取：data.items[0].name
          const parts = String(args.path || '').replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
          let cur: any = parsed;
          for (const p of parts) {
            if (cur == null) break;
            cur = cur[p];
          }
          return { ok: cur !== undefined, value: cur === undefined ? null : cur };
        }
        return { ok: false, error: '未知操作: ' + action };
      } catch (e: any) {
        return { ok: false, valid: false, error: 'JSON解析失败: ' + String(e?.message || e) };
      }
    },
    { tier: 'core', summary: 'JSON格式化/校验/提取' },
  );

  // ── 4. 批量文件操作 ──
  registry.register(
    {
      name: 'batch_files',
      description:
        '批量文件操作：统计目录文件数/大小、批量重命名、批量复制。' +
        '当需要"统计这个文件夹有多少文件""批量重命名图片"时使用。',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['count', 'list', 'rename_pattern', 'copy'], description: '操作' },
          dir: { type: 'string', description: '目录路径' },
          pattern: { type: 'string', description: 'rename_pattern: 匹配模式(如 *.jpg)；copy: 目标目录' },
          renameTo: { type: 'string', description: 'rename_pattern: 替换后名称模式(用 {n} 表示序号)' },
          ext: { type: 'string', description: 'list: 过滤扩展名(可选)' },
        },
        required: ['action', 'dir'],
      },
    },
    async (args: any) => {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const dir = String(args.dir || '');
      const action = String(args.action || '');
      try {
        if (!fs.existsSync(dir)) return { ok: false, error: '目录不存在: ' + dir };
        if (action === 'count') {
          const files = fs.readdirSync(dir).filter((f: string) => fs.statSync(path.join(dir, f)).isFile());
          const totalSize = files.reduce((s: number, f: string) => s + fs.statSync(path.join(dir, f)).size, 0);
          return { ok: true, count: files.length, totalBytes: totalSize, totalMB: (totalSize / 1048576).toFixed(2) };
        }
        if (action === 'list') {
          const ext = args.ext ? String(args.ext).toLowerCase() : '';
          const files = fs.readdirSync(dir)
            .filter((f: string) => fs.statSync(path.join(dir, f)).isFile())
            .filter((f: string) => !ext || f.toLowerCase().endsWith(ext))
            .slice(0, 200);
          return { ok: true, files };
        }
        if (action === 'rename_pattern') {
          const pattern = String(args.pattern || '');
          const renameTo = String(args.renameTo || '');
          const files = fs.readdirSync(dir).filter((f: string) => {
            if (!pattern) return true;
            const re = new RegExp('^' + pattern.replace(/\*/g, '.*').replace(/\./g, '\\.') + '$');
            return re.test(f);
          });
          const renamed: string[] = [];
          files.forEach((f: string, i: number) => {
            const ext = path.extname(f);
            const newName = renameTo.replace('{n}', String(i + 1).padStart(2, '0')) + ext;
            fs.renameSync(path.join(dir, f), path.join(dir, newName));
            renamed.push(f + ' → ' + newName);
          });
          return { ok: true, renamed: renamed.length, items: renamed.slice(0, 20) };
        }
        if (action === 'copy') {
          const dest = String(args.pattern || '');
          if (!dest) return { ok: false, error: 'copy需要目标目录(pattern)' };
          fs.mkdirSync(dest, { recursive: true });
          const files = fs.readdirSync(dir).filter((f: string) => fs.statSync(path.join(dir, f)).isFile());
          let copied = 0;
          for (const f of files) {
            fs.copyFileSync(path.join(dir, f), path.join(dest, f));
            copied++;
          }
          return { ok: true, copied };
        }
        return { ok: false, error: '未知操作: ' + action };
      } catch (e: any) {
        return { ok: false, error: String(e?.message || e) };
      }
    },
    { tier: 'core', summary: '批量文件操作（统计/重命名/复制）' },
  );

  // ── 5. 浏览器控制 ──
  registry.register(
    {
      name: 'browser_nav',
      description:
        '打开浏览器访问网页并提取文本内容（Playwright）。当需要"打开某某网站看内容""网页自动化"时使用。' +
        '返回页面标题+可见文本（截断）。注意：此工具需要 Playwright 环境可用，失败会返回提示。',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: '要访问的URL' },
          waitMs: { type: 'number', description: '等待加载毫秒，默认3000' },
        },
        required: ['url'],
      },
    },
    async (args: any) => {
      const url = String(args.url || '');
      const waitMs = Number(args.waitMs) || 3000;
      try {
        // 动态引入 playwright（已装依赖）
        const { chromium } = await import('playwright');
        const browser = await chromium.launch({ headless: true });
        try {
          const page = await browser.newPage();
          await page.goto(url, { timeout: 20000, waitUntil: 'domcontentloaded' });
          await page.waitForTimeout(waitMs);
          const title = await page.title();
          const text = await page.evaluate(() => document.body?.innerText?.slice(0, 12000) || '');
          return { ok: true, url, title, text };
        } finally {
          await browser.close();
        }
      } catch (e: any) {
        return { ok: false, error: '浏览器不可用: ' + String(e?.message || e).slice(0, 200) };
      }
    },
    { tier: 'deferred', summary: '浏览器访问网页（Playwright）' },
  );
}

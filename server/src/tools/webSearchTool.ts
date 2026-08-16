// tools/webSearchTool.ts
// 网页搜索工具：让 DaShaAgent 拥有联网搜索能力（对标 dasha web_search）
// 实现：DuckDuckGo HTML 接口（无需 API Key）+ Jina AI Reader 读取网页正文
// 新增不破坏：独立文件，不影响现有工具

import { registry } from './registry';

async function duckduckgoSearch(query: string, maxResults = 5): Promise<any[]> {
  try {
    const url = 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query);
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return [];
    const html = await res.text();
    const results: any[] = [];
    // 解析 result 块
    const blocks = html.split('<div class="result results_links');
    for (let i = 1; i < blocks.length && results.length < maxResults; i++) {
      const b = blocks[i];
      const titleMatch = b.match(/<a[^>]*class="result__a"[^>]*>(.*?)<\/a>/s);
      const urlMatch = b.match(/<a[^>]*class="result__a"[^>]*href="([^"]*)"/s);
      const snippetMatch = b.match(/<a[^>]*class="result__snippet"[^>]*>(.*?)<\/a>/s);
      if (titleMatch && urlMatch) {
        const strip = (s: string) => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').trim();
        results.push({
          title: strip(titleMatch[1]),
          url: urlMatch[1].replace(/\/\/duckduckgo\.com\/l\/\?uddg=/, ''),
          snippet: snippetMatch ? strip(snippetMatch[1]) : '',
        });
      }
    }
    return results;
  } catch {
    return [];
  }
}

async function jinaRead(url: string): Promise<string> {
  try {
    const res = await fetch('https://r.jina.ai/' + url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return `[读取失败: HTTP ${res.status}]`;
    const text = await res.text();
    return text.slice(0, 12000);
  } catch (e: any) {
    return `[读取失败: ${e?.message || e}]`;
  }
}

export function registerWebSearchTool(): void {
  registry.register(
    {
      name: 'web_search',
      description:
        '联网搜索互联网（DuckDuckGo，无需API Key）。当用户需要查资料、找资讯、获取最新信息时使用。' +
        '返回标题+链接+摘要列表；再用 web_read 读取具体网页正文。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索关键词（支持中文）' },
          max_results: { type: 'number', description: '返回条数，默认5，最大10' },
        },
        required: ['query'],
      },
    },
    async (args: any) => {
      const query = String(args.query || '');
      const max = Math.min(Number(args.max_results) || 5, 10);
      const results = await duckduckgoSearch(query, max);
      if (results.length === 0) return { ok: false, error: '无搜索结果（可能网络受限）', query };
      return { ok: true, query, results };
    },
    { tier: 'deferred', summary: '联网搜索（DuckDuckGo，无需Key）' },
  );

  registry.register(
    {
      name: 'web_read',
      description:
        '读取网页正文内容（Jina AI Reader）。当需要查看搜索结果的具体文章内容时使用。' +
        '返回网页正文（截断至12000字符）。',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: '网页URL' },
        },
        required: ['url'],
      },
    },
    async (args: any) => {
      const url = String(args.url || '');
      const content = await jinaRead(url);
      return { ok: !content.startsWith('[读取失败'), url, content };
    },
    { tier: 'deferred', summary: '读取网页正文（Jina Reader）' },
  );
}

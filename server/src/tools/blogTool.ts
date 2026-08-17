// tools/blogTool.ts

// 博客发布工具：让 DaShaAgent 能发布博客到 YOUR_SITE（MariaDB dasha_web）

// P3 优化6：教会它发博客（对标 dasha publish_blog_with_images.py）

// 用 better-sqlite3 无 MariaDB 驱动？不——用子进程调 PHP CLI 或直接 HTTP。

// 最简单可靠：通过 Windows PHP CLI 执行 SQL（YOUR_SITE 用 WampServer MariaDB）

// 或直接调用 dasha 已有的 publish_blog_with_images.py。



import { registry } from './registry';
import { resolvePython as pythonBin } from './pythonBin';

import { spawnSync } from 'node:child_process';

import fs from 'node:fs';

import path from 'node:path';






function runBlogPublish(args: string[]): { ok: boolean; output: string } {

  const script = process.env.PUBLISH_BLOG_SCRIPT || 'publish_blog_with_images.py';

  if (!fs.existsSync(script)) {

    return { ok: false, output: '未找到 publish_blog_with_images.py: ' + script };

  }

  const r = spawnSync(pythonBin(), [script, ...args], {

    encoding: 'utf8',

    timeout: 60000,

    env: { ...process.env, MSYS2_NO_PATHCONV: '1' },

  });

  return {

    ok: r.status === 0,

    output: (r.stdout || '') + (r.stderr || ''),

  };

}



export function registerBlogTool(): void {

  registry.register(

    {

      name: 'publish_blog',

      description:

        '发布博客文章到 YOUR_SITE 个人网站（含封面图）。参数：title(标题)、content(HTML正文)、cover_path(封面网站路径 /your-site/...)、category(life/nautical/tech/ai/study)。' +

        '内部调用 publish_blog_with_images.py 写入 MariaDB dasha_web。正文必须是纯净HTML（h1/p/img，无外层标签）。',

      parameters: {

        type: 'object',

        properties: {

          title: { type: 'string', description: '文章标题' },

          content: { type: 'string', description: 'HTML正文（h1/p/img标签）' },

          cover_path: { type: 'string', description: '封面图网站路径，如 /your-site/uploads/blog_covers/cover_xxx.jpg' },

          category: { type: 'string', enum: ['life', 'nautical', 'tech', 'ai', 'study'], description: '分类，默认life' },

          tags: { type: 'string', description: '标签，逗号分隔' },

        },

        required: ['title', 'content'],

      },

    },

    async (args: any) => {

      const title = String(args.title || '');

      const content = String(args.content || '');

      const cover = String(args.cover_path || '');

      const category = String(args.category || 'life');

      const tags = String(args.tags || '');



      // 写入临时 HTML 文件（避免命令行参数过长）

      const tmp = path.join(process.env.TEMP || 'C:/Windows/Temp', '_ah_blog_' + Date.now() + '.html');

      fs.writeFileSync(tmp, content, 'utf8');



      const cmdArgs = [

        '--title', title,

        '--content-file', tmp,

        '--category', category,

      ];

      if (cover) cmdArgs.push('--cover-path', cover);

      if (tags) cmdArgs.push('--tags', tags);



      const result = runBlogPublish(cmdArgs);

      try { fs.unlinkSync(tmp); } catch { /* ignore */ }



      if (result.ok && /OK\|/i.test(result.output)) {

        const m = result.output.match(/OK\|(\d+)\|/);

        return { ok: true, blogId: m ? m[1] : null, output: result.output.slice(0, 300) };

      }

      return { ok: false, output: result.output.slice(0, 400) };

    },

    { tier: 'deferred', summary: '发布博客到YOUR_SITE（含封面图）' },

  );

}


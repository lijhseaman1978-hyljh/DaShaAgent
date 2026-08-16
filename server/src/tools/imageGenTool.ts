// tools/imageGenTool.ts
// 图片生成工具：让 DaShaAgent 拥有 AI 生图能力（对标 dasha generate_image）
// 实现：Agnes AI 图片 API（项目已配置 Agnes，复用 agnes-2.5 的密钥环境）
// 新增不破坏：独立文件，不影响现有工具

import { registry } from './registry';
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from '../config';

function getAgnesKey(): string {
  return process.env.AGNES_API_KEY || process.env.AH_CLOUD_KEY || '';
}

// Base URL is configurable; defaults to the Agnes AI gateway the project author uses.
// Override with AGNES_IMAGE_BASE_URL (e.g. any OpenAI-compatible images endpoint).
const IMG_BASE = process.env.AGNES_IMAGE_BASE_URL || 'https://apihub.agnes-ai.com/v1';

export function registerImageGenTool(): void {
  registry.register(
    {
      name: 'generate_image',
      description:
        'AI 生成图片（Agnes agnes-image-2.1-flash）。当用户需要配图、封面、插图、示意图时使用。' +
        '返回图片URL和本地保存路径（保存到 data/output/）。支持指定尺寸（默认1024x768）。',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: '图片描述（英文效果最佳，中文也可）' },
          size: { type: 'string', description: '尺寸 WxH，如 1024x768 或 1200x630，默认1024x768' },
          filename: { type: 'string', description: '可选：保存文件名（不含扩展名），默认自动生成' },
        },
        required: ['prompt'],
      },
    },
    async (args: any) => {
      const key = getAgnesKey();
      if (!key) return { ok: false, error: '未配置 Agnes API Key（AGNES_API_KEY）' };

      const prompt = String(args.prompt || '');
      const size = String(args.size || '1024x768');
      const filename = String(args.filename || `image_${Date.now()}`);

      try {
        const res = await fetch(`${IMG_BASE}/images/generations`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer ' + key,
          },
          body: JSON.stringify({
            model: 'agnes-image-2.1-flash',
            prompt,
            size,
            extra_body: { response_format: 'url' },
          }),
          signal: AbortSignal.timeout(120000),
        });
        if (!res.ok) {
          const errText = await res.text();
          return { ok: false, error: `API HTTP ${res.status}: ${errText.slice(0, 200)}` };
        }
        const data = await res.json();
        const url: string = data?.data?.[0]?.url || '';
        if (!url) return { ok: false, error: 'API未返回图片URL' };

        // 下载到本地
        const imgRes = await fetch(url, { signal: AbortSignal.timeout(60000) });
        if (imgRes.ok) {
          const buf = Buffer.from(await imgRes.arrayBuffer());
          const ext = (url.split('?')[0].split('.').pop() || 'png').slice(0, 5);
          const outDir = path.join(CONFIG.OUTPUT_DIR || path.join(CONFIG.ROOT, 'data', 'output'));
          fs.mkdirSync(outDir, { recursive: true });
          const fp = path.join(outDir, `${filename}.${ext}`);
          fs.writeFileSync(fp, buf);
          return { ok: true, url, localPath: fp, size, bytes: buf.length };
        }
        return { ok: true, url, localPath: null, size };
      } catch (e: any) {
        return { ok: false, error: `生图失败: ${e?.message || e}` };
      }
    },
    { tier: 'deferred', summary: 'AI生成图片（Agnes）' },
  );
}

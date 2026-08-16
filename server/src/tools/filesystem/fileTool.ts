// tools/filesystem/fileTool.ts
// 计划书 Phase 2 - Step 2 §七：File System Agent。
// 计划书目标：创建文件 / 修改代码 / 读取项目 / 生成文档 —— 故在 §七 原型（read/write）之上
// 补齐 append / exists / list / mkdir，覆盖「读取项目」与「生成文档」两项。
//
// 权限：["read","write"] —— 在默认放行集合内。
//
// 棕地说明：tools/fsTool.ts（V2 生产文件工具，含 .pdf/.docx/.xlsx/.pptx 多格式解析）继续保留且更强，
//           本工具是 Step 2 教程层的轻量原生实现，二者并排，互不替代。

import fs from 'fs/promises';
import path from 'path';
import { fail } from '../core/tool';

export interface FileInput {
  action: 'read' | 'write' | 'append' | 'exists' | 'list' | 'mkdir';
  path: string;
  content?: string;
  encoding?: BufferEncoding;
}

export const FileTool = {
  name: 'filesystem',
  description: 'Read and write files — read / write / append / exists / list / mkdir',
  permissions: ['read', 'write'],

  async execute(input: FileInput) {
    if (!input?.path) return fail('filesystem', 'input.path is required');
    const enc: BufferEncoding = input.encoding ?? 'utf8';

    try {
      if (input.action === 'read') {
        return await fs.readFile(input.path, enc);
      }

      if (input.action === 'write') {
        await fs.mkdir(path.dirname(path.resolve(input.path)), { recursive: true });
        await fs.writeFile(input.path, input.content ?? '', enc);
        return 'saved';
      }

      if (input.action === 'append') {
        await fs.mkdir(path.dirname(path.resolve(input.path)), { recursive: true });
        await fs.appendFile(input.path, input.content ?? '', enc);
        return 'appended';
      }

      if (input.action === 'exists') {
        try {
          const st = await fs.stat(input.path);
          return { exists: true, isFile: st.isFile(), isDirectory: st.isDirectory(), size: st.size };
        } catch {
          return { exists: false };
        }
      }

      if (input.action === 'list') {
        const entries = await fs.readdir(input.path, { withFileTypes: true });
        return entries.map((e) => ({ name: e.name, type: e.isDirectory() ? 'dir' : 'file' }));
      }

      if (input.action === 'mkdir') {
        await fs.mkdir(input.path, { recursive: true });
        return 'created';
      }

      return fail('filesystem', `unknown action: ${String((input as any).action)}`);
    } catch (e: any) {
      return fail('filesystem', e?.message ?? String(e));
    }
  },
};

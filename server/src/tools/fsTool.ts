import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CONFIG, ensureDir } from '../config';
import { registry } from './registry';
import { modelSupportsImages } from '../core/modelCaps';
import { pushImage } from '../core/imageBus';

// ── 统一多格式解析器 ──────────────────────────────────────────────────
// read_any.py 一个进程覆盖 pdf/docx/pptx/xlsx/epub/ipynb/html/rtf/eml/csv/zip/image/text。
// 内部魔法字节嗅探真实类型（扩展名只作兜底），并按"语义单元"分页 + Token 预算输出，
// 对齐 WorkBuddy 内核 Read 工具的设计：大文件不是截断放弃，而是回传 next_offset 引导续读。
const ANY_READER = fileURLToPath(new URL('./read_any.py', import.meta.url));

function pythonBin(): string {
  const cands = ['C:/Program Files/Python310/python.exe', process.env.PYTHON_PATH, 'python3', 'python'].filter(Boolean) as string[];
  return cands[0];
}

export interface ReadEnvelope {
  ok: boolean;
  kind: string;
  path: string;
  meta?: Record<string, any>;
  unit?: string;
  total_units?: number;
  offset?: number;
  returned_units?: number;
  next_offset?: number | null;
  truncated?: boolean;
  est_tokens?: number;
  text?: string;
  b64?: string;
  mime?: string;
  error?: string;
}

/** 调用 read_any.py，永远拿到一个结构化信封（解析失败也是信封，不抛异常）。 */
function runReader(fp: string, extra: string[] = [], timeoutMs = 90_000): Promise<ReadEnvelope> {
  return new Promise((resolve) => {
    let out = '', err = '', settled = false;
    const finish = (env: ReadEnvelope) => { if (!settled) { settled = true; resolve(env); } };
    const bad = (code: string, msg: string): ReadEnvelope =>
      ({ ok: false, kind: 'unknown', path: fp, error: code + ': ' + msg, text: '' });

    let child: any;
    try { child = spawn(pythonBin(), [ANY_READER, fp, ...extra], { windowsHide: true }); }
    catch (e: any) { return finish(bad('PYTHON_SPAWN_FAILED', String(e))); }

    // base64 图片可达数 MB，用数组累积后 join，避免字符串反复拷贝
    const chunks: Buffer[] = [];
    child.stdout?.on('data', (d: Buffer) => { chunks.push(d); });
    child.stderr?.on('data', (d: Buffer) => { err += d.toString(); });
    child.on('error', (e: any) => finish(bad('PYTHON_ERROR', String(e))));
    child.on('close', (code: number) => {
      out = Buffer.concat(chunks).toString('utf8');
      if (!out.trim()) return finish(bad('EMPTY_OUTPUT', 'exit ' + code + ' ' + err.slice(0, 400)));
      try { finish(JSON.parse(out) as ReadEnvelope); }
      catch { finish(bad('BAD_JSON', out.slice(0, 300) + ' | ' + err.slice(0, 200))); }
    });
    setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* ignore */ }
      finish(bad('TIMEOUT', '解析超时(' + (timeoutMs / 1000) + 's)，文件可能过大，请用 offset/limit 分段读'));
    }, timeoutMs);
  });
}

// 错误码 → 可执行的纠正建议。给模型「下一步怎么办」，而不是让它对着报错干瞪眼。
const ERROR_HINTS: Record<string, string> = {
  LEGACY_OLE_FORMAT: '这是 97-2003 旧格式。用 run_code 调 LibreOffice 转换：soffice --headless --convert-to docx <file>，或让用户另存为新格式。',
  MSG_UNSUPPORTED: '在 Outlook 里把邮件另存为 .eml 后再读，或用 run_code 安装 extract_msg。',
  BINARY_FILE: '二进制文件无文本可抽。若要看结构，用 run_code 做十六进制转储。',
  MISSING_DEPENDENCY: '缺 Python 库。用 run_code 执行 pip install（注意网络受限，优先国内镜像源）。',
  FILE_NOT_FOUND: '路径不存在。先用 fs_list 列目录确认真实文件名（注意大小写与空格）。',
  IS_DIRECTORY: '这是目录，用 fs_list 列举内容。',
  TIMEOUT: '文件过大。传 limit 参数分段读，例如 limit=20 先读前 20 个单元。',
};

function hintFor(err: string): string {
  const code = (err || '').split(':')[0].trim();
  return ERROR_HINTS[code] || '若为文件损坏或罕见格式，可用 run_code 自写解析脚本处理。';
}

// 全权限模式：不做沙箱限制。
// - 绝对路径（如 C:\Users\your-user\Desktop\x.txt）直接使用，可访问任意位置；
// - 相对路径仍默认落在 WORKSPACE_DIR，便于不写全路径的常规操作；
// - 允许 .. 向上逃逸，不再拦截。
function safeResolve(p: string): string {
  if (path.isAbsolute(p)) return path.resolve(p);
  return path.resolve(CONFIG.WORKSPACE_DIR, p);
}

export function registerFsTools() {
  // 二进制/特殊格式后缀 → 禁止用 fs_write 写入（会生成打不开的损坏文件）。
  // 直接报错并指向正确的生成工具，从源头掐断"用 fs_write 冒充文档而失败→反复重试"的死循环。
  const BINARY_EXT = {
    '.docx': 'create_docx', '.pdf': 'create_pdf', '.xlsx': 'create_xlsx', '.pptx': 'create_pptx',
    '.doc': 'create_docx', '.ppt': 'create_pptx', '.xls': 'create_xlsx',
  };

  registry.register({
    name: 'fs_write',
    description: '写入纯文本文件（.txt/.md/.csv/.json 等）。path 支持绝对路径（如 C:\\Users\\your-user\\Desktop\\x.txt，可写任意位置）或相对路径（相对 data/workspace）。content 为文本内容。【注意】本工具只能写纯文本；若要生成 Office 文档，必须使用专用工具：Word→create_docx、PDF→create_pdf、Excel→create_xlsx、PPT→create_pptx。用 fs_write 写入 .docx/.pdf/.xlsx/.pptx 会被直接拒绝并报错。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '文件绝对或相对路径，如 C:\\\\Users\\\\your-user\\\\Desktop\\\\hello.txt 或 notes/hello.txt' },
        content: { type: 'string', description: '要写入的文本' },
      },
      required: ['path', 'content'],
    },
  }, (args) => {
    const fp = safeResolve(args.path);
    const ext = fp.toLowerCase().replace(/^.*(\.[a-z0-9]+)$/, '$1');
    const correctTool = (BINARY_EXT as Record<string, string>)[ext];
    if (correctTool) {
      return {
        error: '拒绝写入特殊格式文件: ' + args.path,
        reason: 'fs_write 只能写纯文本，写入 ' + ext + ' 会生成打不开的损坏文件。',
        useInstead: correctTool,
        hint: '请用 ' + correctTool + ' 工具生成该文档（path 支持绝对路径，可直接写到桌面等任意位置）。',
      };
    }
    ensureDir(path.dirname(fp));
    fs.writeFileSync(fp, String(args.content ?? ''), 'utf8');
    return { ok: true, path: fp, bytes: String(args.content ?? '').length };
  });

  registry.register({
    name: 'fs_read',
    description:
      '读取任意文件的内容。path 支持绝对路径（任意位置）或相对路径（相对 data/workspace）。\n' +
      '【已内置原生解析，全部一步到位，无需任何技能工具】\n' +
      '  · PDF（.pdf，按页；扫描件自动 pdfplumber 兜底）\n' +
      '  · Word（.docx/.docm/.dotx，段落+表格，标题带 # 标记）\n' +
      '  · PPT（.pptx/.ppsx/.potx，按幻灯片，含备注）\n' +
      '  · Excel（.xlsx/.xlsm，按工作表逐行）\n' +
      '  · 电子书 .epub（按章节）、Notebook .ipynb（按单元格，含输出）\n' +
      '  · 网页 .html/.xml、富文本 .rtf、邮件 .eml、压缩包 .zip（列清单）\n' +
      '  · 图片 .png/.jpg/.webp/.gif/.bmp/.tiff —— 若当前模型支持多模态则**图片直接进模型视野**；不支持时自动退回 OCR 文本\n' +
      '  · 纯文本/.csv/.tsv/.json/.md/源码/字幕 —— 自动识别 UTF-8 / GBK / UTF-16 编码\n' +
      '【大文件怎么读】不会粗暴截断。返回值含 unit（page/slide/row/chapter/line…）、total_units、next_offset。' +
      '内容超预算时 truncated=true 并给出 next_offset，再调一次本工具并把 offset 设成该值即可续读，可反复直到 next_offset 为 null。\n' +
      '【重要】读取"已存在文件的内容"永远用本工具。skill_pdf / skill_docx 之类是用来**生成**文档的，不是用来读的。\n' +
      '【常见失败】①文件不存在→先用 fs_list 确认路径；②编码错误→文件可能是 GBK 编码；③被占用→关闭其他程序后重试。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '文件绝对或相对路径' },
        offset: { type: 'number', description: '起始语义单元序号（1 起）。续读时填上一次返回的 next_offset。默认 1' },
        limit: { type: 'number', description: '最多返回多少个单元（页/行/章…）。默认不限，由 Token 预算自动裁剪' },
        max_tokens: { type: 'number', description: '本次返回的 Token 预算上限，默认 20000。想快速摸底可调小到 2000' },
      },
      required: ['path'],
    },
  }, async (args, ctx) => {
    const fp = safeResolve(args.path);
    if (!fs.existsSync(fp)) {
      return { error: '文件不存在: ' + args.path, hint: ERROR_HINTS.FILE_NOT_FOUND };
    }
    if (fs.statSync(fp).isDirectory()) {
      return { error: '这是目录不是文件: ' + args.path, hint: ERROR_HINTS.IS_DIRECTORY };
    }

    const extra: string[] = [];
    if (args.offset && Number(args.offset) > 1) extra.push('--offset', String(Math.floor(Number(args.offset))));
    if (args.limit && Number(args.limit) > 0) extra.push('--limit', String(Math.floor(Number(args.limit))));
    const budget = Number(args.max_tokens) > 0 ? Math.floor(Number(args.max_tokens)) : 20000;
    extra.push('--max-tokens', String(budget));

    // ── 图片：多模态优先 ────────────────────────────────────────────
    // WorkBuddy 内核的做法是先问"当前模型支不支持图片"，支持就 base64 直读（保真度碾压 OCR），
    // 不支持才退 OCR。这里完全对齐，并且 base64 走旁路总线，不污染工具观察文本。
    const head = (() => { try { const b = Buffer.alloc(16); const fd = fs.openSync(fp, 'r'); fs.readSync(fd, b, 0, 16, 0); fs.closeSync(fd); return b; } catch { return Buffer.alloc(0); } })();
    const isImage =
      head.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ||
      head.slice(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])) ||
      head.slice(0, 6).toString('latin1') === 'GIF87a' || head.slice(0, 6).toString('latin1') === 'GIF89a' ||
      head.slice(0, 2).toString('latin1') === 'BM' ||
      (head.slice(0, 4).toString('latin1') === 'RIFF' && head.slice(8, 12).toString('latin1') === 'WEBP');

    if (isImage) {
      const canSee = await modelSupportsImages();
      if (canSee) {
        const env = await runReader(fp, ['--b64'], 60_000);
        if (env.ok && env.b64) {
          pushImage(ctx.sessionId, {
            b64: env.b64, mime: env.mime || 'image/png', path: fp,
            note: '来自 fs_read: ' + path.basename(fp),
          });
          const m = env.meta || {};
          return {
            ok: true, path: fp, type: 'image', mode: 'vision',
            dimensions: m.width && m.height ? `${m.width}×${m.height}` : undefined,
            bytes: m.bytes, compressed: m.resized_to ? `已等比缩放到 ${m.resized_to.join('×')}` : undefined,
            content: '图片已作为图像输入注入对话，你在下一轮就能直接"看到"它。请基于所见内容继续作答，不要再重复读取这张图。',
          };
        }
        // base64 失败 → 落到 OCR
      }
      const env = await runReader(fp, extra, 60_000);
      if (!env.ok) return { error: '图片读取失败', detail: env.error, hint: hintFor(env.error || '') };
      return {
        ok: true, path: fp, type: 'image', mode: canSee ? 'ocr-fallback' : 'ocr',
        note: canSee ? '图片直读失败，已退回 OCR' : '当前模型不支持图像输入，已用 OCR 提取文字（可能有识别误差）',
        meta: env.meta, content: env.text,
      };
    }

    // ── 其余全部格式：统一解析器 + 语义分页 ────────────────────────
    const env = await runReader(fp, extra);
    if (!env.ok) {
      return {
        error: '读取失败: ' + path.basename(fp),
        kind: env.kind,
        detail: env.error,
        hint: hintFor(env.error || ''),
      };
    }

    const out: Record<string, any> = {
      ok: true,
      path: fp,
      type: env.kind,
      unit: env.unit,
      total_units: env.total_units,
      offset: env.offset,
      returned_units: env.returned_units,
      est_tokens: env.est_tokens,
      meta: env.meta,
      content: env.text,
    };
    if (env.truncated) {
      out.truncated = true;
      out.next_offset = env.next_offset;
      out.continue_hint = env.next_offset
        ? `内容未读完（共 ${env.total_units} 个${env.unit === 'page' ? '页' : env.unit === 'slide' ? '幻灯片' : env.unit === 'row' ? '行' : env.unit === 'chapter' ? '章' : '单元'}，已返回到第 ${(env.offset || 1) + (env.returned_units || 0) - 1} 个）。` +
          `如需继续，再次调用 fs_read 并设 offset=${env.next_offset}。若已够用则直接作答，不必读完。`
        : '内容已按 Token 预算裁剪。';
    }
    return out;
  });

  registry.register({
    name: 'fs_list',
    description: '列出某目录下的文件与子目录。dir 支持绝对路径（任意位置）或相对路径（相对 data/workspace），默认 "."。',
    parameters: {
      type: 'object',
      properties: { dir: { type: 'string', description: '绝对或相对目录，默认 "."' } },
      required: [],
    },
  }, (args) => {
    const dp = safeResolve(args.dir || '.');
    if (!fs.existsSync(dp)) {
      return {
        ok: true, dir: args.dir || '.', entries: [],
        hint: '目录不存在。如需创建文件，直接用 fs_write 写入即可（会自动创建父目录），无需手动创建目录。',
        missingDir: true,
      };
    }
    const entries = fs.readdirSync(dp, { withFileTypes: true }).map(e => ({
      name: e.name,
      type: e.isDirectory() ? 'dir' : 'file',
    }));
    return { ok: true, dir: args.dir || '.', entries };
  });
}

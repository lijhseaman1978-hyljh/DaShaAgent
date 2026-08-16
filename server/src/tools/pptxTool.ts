import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { CONFIG, ensureDir } from '../config';
import { registry } from './registry';

// 生成真正的 .pptx 演示文稿，底层由系统 Python + python-pptx 完成（已确认 python-pptx 1.0.2 可用）。
// 输入 content 支持 Markdown 风格：# 标题 = 一张幻灯片的标题，- 要点 = 该幻灯片的要点；可选 title 作为封面页。
// 这样「生成 PPT」成为真实可用的能力，模型不再退化到用 fs_write 写文本冒充 pptx。

const PY_SCRIPT = `
import sys
from pptx import Presentation
from pptx.util import Pt, Inches

def add_slide(prs, title, bullets):
    layout = prs.slide_layouts[1]  # 标题 + 内容
    slide = prs.slides.add_slide(layout)
    slide.shapes.title.text = title or ''
    if bullets:
        tf = slide.placeholders[1].text_frame
        tf.clear()
        first = True
        for b in bullets:
            p = tf.paragraphs[0] if first else tf.add_paragraph()
            first = False
            p.text = b
            p.font.size = Pt(18)

def build(out, md, title):
    prs = Presentation()
    if title:
        s = prs.slides.add_slide(prs.slide_layouts[0])  # 封面
        s.shapes.title.text = title
    cur = None
    bullets = []
    for line in md.split('\\n'):
        s = line.rstrip()
        if not s.strip():
            continue
        if s.startswith('# '):
            if cur is not None:
                add_slide(prs, cur, bullets)
            cur = s[2:].strip()
            bullets = []
        elif s.startswith('- '):
            bullets.append(s[2:].strip())
        elif s.startswith('* '):
            bullets.append(s[2:].strip())
        else:
            bullets.append(s)
    if cur is not None:
        add_slide(prs, cur, bullets)
    prs.save(out)
    print('OK ' + out)

if __name__ == '__main__':
    md = sys.argv[2] if len(sys.argv) > 2 else ''
    title = sys.argv[3] if len(sys.argv) > 3 else ''
    build(sys.argv[1], md, title)
`;

const SCRIPT_PATH = path.join(CONFIG.WORKSPACE_DIR, '.pptxgen', 'pptxgen.py');

function ensureScript(): void {
  ensureDir(path.dirname(SCRIPT_PATH));
  if (!fs.existsSync(SCRIPT_PATH)) {
    fs.writeFileSync(SCRIPT_PATH, PY_SCRIPT, 'utf8');
  }
}

function pythonBin(): string {
  const candidates = [
    'C:/Program Files/Python310/python.exe',
    process.env.PYTHON_PATH,
    'python3',
    'python',
  ].filter(Boolean) as string[];
  return candidates[0];
}

function runPython(script: string, args: string[]): Promise<{ ok: boolean; out: string; err: string }> {
  return new Promise((resolve) => {
    const bin = pythonBin();
    // out/err 必须提升到 try 之外：spawn 同步抛错时 catch 分支要引用它们（否则 ReferenceError）
    let out = '', err = '';
    try {
      const p = spawn(bin, [script, ...args], { windowsHide: true });
      p.stdout?.on('data', (d: Buffer) => (out += d.toString()));
      p.stderr?.on('data', (d: Buffer) => (err += d.toString()));
      p.on('error', (e) => resolve({ ok: false, out, err: String(e) }));
      p.on('close', (code) => resolve({ ok: code === 0, out, err }));
    } catch (e: any) {
      resolve({ ok: false, out, err: String(e) });
    }
  });
}

export function registerPptxTool() {
  ensureScript();
  registry.register(
    {
      name: 'create_pptx',
      description:
        '生成真正的 PowerPoint (.pptx) 演示文稿并写入磁盘（基于 python-pptx）。path 支持绝对路径（如 C:\\Users\\your-user\\Desktop\\汇报.pptx，可写任意位置）或相对路径（相对 data/workspace）。' +
        'content 支持 Markdown 风格：# 标题 = 一张幻灯片标题、- 要点 = 该幻灯片要点；title 参数作为封面页。' +
        '当用户要求"生成PPT/做演示文稿/做汇报 slides/存成pptx"时必须使用本工具，千万不要用普通文本工具(fs_write)写入 .pptx 文件来冒充——那会生成打不开的损坏文件。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '输出 .pptx 路径，如 C:\\\\Users\\\\your-user\\\\Desktop\\\\汇报.pptx' },
          title: { type: 'string', description: '封面页标题（可选）' },
          content: { type: 'string', description: 'Markdown 内容：# 幻灯片标题，- 要点；每张 # 标题开启新幻灯片' },
        },
        required: ['path', 'content'],
      },
    },
    async (args: any) => {
      let fp = path.isAbsolute(args.path) ? path.resolve(args.path) : path.resolve(CONFIG.WORKSPACE_DIR, args.path);
      if (!fp.toLowerCase().endsWith('.pptx')) fp += '.pptx';
      ensureDir(path.dirname(fp));
      const mdPath = path.join(path.dirname(SCRIPT_PATH), 'input_' + Date.now() + '.md');
      fs.writeFileSync(mdPath, String(args.content || ''), 'utf8');
      const res = await runPython(SCRIPT_PATH, [fp, mdPath, String(args.title || '')]);
      try { fs.unlinkSync(mdPath); } catch { /* ignore */ }
      if (!res.ok) {
        return {
          error: 'PPT 生成失败',
          detail: res.err.slice(0, 500),
          hint: '本环境依赖系统 Python + python-pptx 生成 pptx。若缺失请安装：pip install python-pptx',
        };
      }
      const bytes = fs.existsSync(fp) ? fs.statSync(fp).size : 0;
      return { ok: true, path: fp, bytes, note: '已生成标准 .pptx 文件（可用 PowerPoint / WPS 直接打开）' };
    }
  );
}

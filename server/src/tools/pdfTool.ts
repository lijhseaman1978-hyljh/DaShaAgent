import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { CONFIG, ensureDir } from '../config';
import { registry } from './registry';
import { resolvePython as pythonBin } from './pythonBin';

// 生成真正的 PDF 文档（支持中文），底层由系统 Python + reportlab 完成。
// 选择 reportlab 而非纯 Node 的原因：PDF 标准字体（Helvetica）不含中文字形，
// 纯 Node 生成中文 PDF 需嵌入数 MB 的 CJK 字体；而 reportlab 内置 STSong-Light
// （Adobe GB1 CID 字体，PDF 阅读器自带），无需外部字体文件即可正确渲染中文。
// 这样「生成 PDF」成为真实可用的能力，模型不再退化到用 fs_write 写文本冒充 PDF。

// 内嵌的 Python 生成脚本：简单 Markdown（# 标题 / - 列表 / 空行分段）-> 多页 PDF。
const PY_SCRIPT = `
import sys, re
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.platypus import (SimpleDocTemplate, Paragraph,
                                ListFlowable, ListItem)

CJK = 'STSong-Light'
pdfmetrics.registerFont(UnicodeCIDFont(CJK))

def esc(s):
    return s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')

def strip_md(s):
    # CJK 无独立粗体字体，去掉 ** / * 标记保留文字，避免渲染报错
    return re.sub(r'\\*\\*([^*]+)\\*\\*', r'\\1', s)

def build(out, inp, title):
    styles = {
        'title': ParagraphStyle('t', fontName=CJK, fontSize=20, leading=28, spaceAfter=12),
        'h1': ParagraphStyle('h1', fontName=CJK, fontSize=16, leading=22, spaceBefore=10, spaceAfter=6),
        'h2': ParagraphStyle('h2', fontName=CJK, fontSize=14, leading=19, spaceBefore=8, spaceAfter=4),
        'body': ParagraphStyle('b', fontName=CJK, fontSize=11, leading=18, spaceAfter=6),
    }
    with open(inp, encoding='utf-8') as f:
        text = f.read()
    flow = []
    if title:
        flow.append(Paragraph(esc(strip_md(title)), styles['title']))
    for line in text.split('\\n'):
        s = line.rstrip()
        if not s.strip():
            continue
        if s.startswith('# '):
            flow.append(Paragraph(esc(strip_md(s[2:])), styles['h1']))
        elif s.startswith('## '):
            flow.append(Paragraph(esc(strip_md(s[3:])), styles['h2']))
        elif re.match(r'^[-*]\\\\s+', s):
            item = strip_md(s[2:].strip())
            flow.append(ListFlowable(
                [ListItem(Paragraph(esc(item), styles['body']), leftIndent=14)],
                bulletType='bullet', start='\\u2022', leftIndent=14))
        else:
            flow.append(Paragraph(esc(strip_md(s)), styles['body']))
    doc = SimpleDocTemplate(out, pagesize=A4,
                            leftMargin=20*mm, rightMargin=20*mm,
                            topMargin=18*mm, bottomMargin=18*mm)
    doc.build(flow)
    print('OK ' + out)

if __name__ == '__main__':
    build(sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else '')
`;

const SCRIPT_PATH = path.join(CONFIG.WORKSPACE_DIR, '.pdfgen', 'pdfgen.py');

function ensureScript(): void {
  ensureDir(path.dirname(SCRIPT_PATH));
  if (!fs.existsSync(SCRIPT_PATH)) {
    fs.writeFileSync(SCRIPT_PATH, PY_SCRIPT, 'utf8');
  }
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

export function registerPdfTool() {
  ensureScript();
  registry.register(
    {
      name: 'create_pdf',
      description:
        '生成真正的 PDF 文档并写入磁盘（支持中文，使用 STSong-Light 字体）。path 支持绝对路径（如 C:\\Users\\your-user\\Desktop\\爱情.pdf，可写任意位置）或相对路径（相对 data/workspace）。' +
        'content 支持 Markdown：# 标题、- 列表、空行分段。当用户要求"生成PDF / 导出pdf / 写文章并存成PDF"时必须使用本工具，' +
        '千万不要用普通文本工具(fs_write)写入 .pdf 文件来冒充 PDF——那会生成打不开的损坏文件。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '输出 .pdf 路径，如 C:\\Users\\your-user\\Desktop\\爱情.pdf' },
          title: { type: 'string', description: '文档标题（作为首页大标题）' },
          content: { type: 'string', description: '文档正文，支持 Markdown：# 标题、- 列表、空行分段' },
        },
        required: ['path', 'content'],
      },
    },
    async (args: any) => {
      let fp = path.isAbsolute(args.path) ? path.resolve(args.path) : path.resolve(CONFIG.WORKSPACE_DIR, args.path);
      if (!fp.toLowerCase().endsWith('.pdf')) fp += '.pdf';
      ensureDir(path.dirname(fp));
      const mdPath = path.join(path.dirname(SCRIPT_PATH), 'input_' + Date.now() + '.md');
      fs.writeFileSync(mdPath, String(args.content || ''), 'utf8');
      const res = await runPython(SCRIPT_PATH, [fp, mdPath, String(args.title || '')]);
      try { fs.unlinkSync(mdPath); } catch { /* ignore */ }
      if (!res.ok) {
        return {
          error: 'PDF 生成失败',
          detail: res.err.slice(0, 500),
          hint: '本环境依赖系统 Python + reportlab 生成 PDF。若缺失请安装：pip install reportlab',
        };
      }
      const bytes = fs.existsSync(fp) ? fs.statSync(fp).size : 0;
      return { ok: true, path: fp, bytes, note: '已生成标准 PDF（中文可用）' };
    }
  );
}

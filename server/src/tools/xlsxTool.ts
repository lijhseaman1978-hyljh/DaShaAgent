import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { CONFIG, ensureDir } from '../config';
import { registry } from './registry';

// 生成真正的 .xlsx 文档（数据表格），底层由系统 Python + openpyxl 完成（已确认 openpyxl 3.1.5 可用）。
// 这样「生成 Excel」成为真实可用的能力，模型不再退化到用 fs_write 写文本冒充 xlsx（会生成打不开的损坏文件）。
//
// 输入 content 支持两类写法：
//   1) Markdown 表格：以 | 分隔的表格行，首行作为表头；# 标题会新建一个工作表(sheet)。
//   2) 纯文本行：每行作为一行（单列）；# 标题新建工作表。
// 也可直接传结构化 rows（二维数组字符串）做精确控制。

const PY_SCRIPT = `
import sys, re
from openpyxl import Workbook
from openpyxl.styles import Font, Alignment, PatternFill

def col_letter(n):
    s = ''
    while n > 0:
        n, r = divmod(n - 1, 26)
        s = chr(65 + r) + s
    return s

def is_sep(cells):
    return len(cells) > 0 and all(set(c) <= set('-: ') for c in cells) and any('-' in c for c in cells)

def parse(md):
    sheets = []          # (title, rows)
    cur_title = 'Sheet1'
    cur_rows = []
    in_table = False
    for line in md.split('\\n'):
        s = line.rstrip()
        if not s.strip():
            continue
        if s.startswith('# '):
            if cur_rows:
                sheets.append((cur_title, cur_rows))
            cur_title = s[2:].strip() or 'Sheet1'
            cur_rows = []
            in_table = False
            continue
        if s.startswith('|'):
            cells = [c.strip() for c in s.strip('|').split('|')]
            if is_sep(cells):
                continue
            cur_rows.append(cells)
            in_table = True
            continue
        if not in_table:
            cur_rows.append([s])
    if cur_rows:
        sheets.append((cur_title, cur_rows))
    if not sheets:
        sheets.append(('Sheet1', []))
    return sheets

def build(out, md, title, rows_json):
    wb = Workbook()
    sheets = parse(md) if md and md.strip() else []
    if rows_json:
        import json
        data = json.loads(rows_json)
        if isinstance(data, list) and data and isinstance(data[0], list):
            sheets = [('Sheet1', [[str(c) for c in row] for row in data])]
    first = True
    header_fill = PatternFill('solid', fgColor='1F4E79')
    header_font = Font(bold=True, color='FFFFFF')
    for (stitle, rows) in sheets:
        ws = wb.active if first else wb.create_sheet(title=stitle[:31])
        first = False
        ws.title = stitle[:31]
        for r in rows:
            ws.append([str(c) for c in r])
        if rows:
            for ci in range(1, len(rows[0]) + 1):
                cell = ws.cell(row=1, column=ci)
                cell.font = header_font
                cell.fill = header_fill
                cell.alignment = Alignment(vertical='center')
        # 简单自适应列宽
        for ci in range(1, ws.max_column + 1):
            width = 10
            for ri in range(1, min(ws.max_row, 200) + 1):
                v = ws.cell(row=ri, column=ci).value
                if v is not None:
                    width = max(width, min(60, len(str(v)) + 2))
            ws.column_dimensions[col_letter(ci)].width = width
    if title:
        wb.properties.title = title
    wb.save(out)
    print('OK ' + out)

if __name__ == '__main__':
    # 2026-08-14 修复：argv[2] 是 Markdown 输入文件路径，必须读取其内容再解析；
    # 旧版直接把路径字符串当内容 parse，导致 create_xlsx 生成"仅含一行路径"的坏文件。
    md_path = sys.argv[2] if len(sys.argv) > 2 else ''
    md = ''
    if md_path:
        try:
            with open(md_path, encoding='utf-8') as f:
                md = f.read()
        except Exception as e:
            sys.stderr.write('read md failed: ' + str(e) + '\n')
    title = sys.argv[3] if len(sys.argv) > 3 else ''
    rows_json = sys.argv[4] if len(sys.argv) > 4 else ''
    build(sys.argv[1], md, title, rows_json)
`;

const SCRIPT_PATH = path.join(CONFIG.WORKSPACE_DIR, '.xlsxgen', 'xlsxgen.py');

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

export function registerXlsxTool() {
  ensureScript();
  registry.register(
    {
      name: 'create_xlsx',
      description:
        '生成真正的 Microsoft Excel (.xlsx) 表格文档并写入磁盘（基于 openpyxl，含表头高亮与自适应列宽）。path 支持绝对路径（如 C:\\Users\\your-user\\Desktop\\数据.xlsx，可写任意位置）或相对路径（相对 data/workspace）。' +
        'content 支持 Markdown 表格（| 分隔、首行为表头，# 标题新建工作表）；也可通过 rows 参数传入二维数组做精确控制。' +
        '当用户要求"生成Excel/导出表格/写数据表/存成xlsx"时必须使用本工具，千万不要用普通文本工具(fs_write)写入 .xlsx 文件来冒充——那会生成打不开的损坏文件。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '输出 .xlsx 路径，如 C:\\\\Users\\\\your-user\\\\Desktop\\\\数据.xlsx' },
          title: { type: 'string', description: '工作簿标题（文档属性）' },
          content: { type: 'string', description: 'Markdown 表格内容，如 "| 姓名 | 年龄 |\\n| --- | --- |\\n| 张三 | 30 |"；# 标题可新建工作表' },
          rows: { type: 'array', description: '可选：二维数组（每行一个数组）做精确控制，如 [["姓名","年龄"],["张三",30]]；提供时优先于 content', items: { type: 'array' } },
        },
        required: ['path', 'content'],
      },
    },
    async (args: any) => {
      let fp = path.isAbsolute(args.path) ? path.resolve(args.path) : path.resolve(CONFIG.WORKSPACE_DIR, args.path);
      if (!fp.toLowerCase().endsWith('.xlsx')) fp += '.xlsx';
      ensureDir(path.dirname(fp));
      const mdPath = path.join(path.dirname(SCRIPT_PATH), 'input_' + Date.now() + '.md');
      fs.writeFileSync(mdPath, String(args.content || ''), 'utf8');
      let rowsJson = '';
      if (Array.isArray(args.rows)) {
        try { rowsJson = JSON.stringify(args.rows); } catch { rowsJson = ''; }
      }
      const res = await runPython(SCRIPT_PATH, [fp, mdPath, String(args.title || ''), rowsJson]);
      try { fs.unlinkSync(mdPath); } catch { /* ignore */ }
      if (!res.ok) {
        return {
          error: 'Excel 生成失败',
          detail: res.err.slice(0, 500),
          hint: '本环境依赖系统 Python + openpyxl 生成 xlsx。若缺失请安装：pip install openpyxl',
        };
      }
      const bytes = fs.existsSync(fp) ? fs.statSync(fp).size : 0;
      return { ok: true, path: fp, bytes, note: '已生成标准 .xlsx 文件（可用 Excel / WPS 直接打开）' };
    }
  );
}

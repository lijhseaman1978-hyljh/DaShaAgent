import fs from 'node:fs';
import path from 'node:path';
import { CONFIG, ensureDir } from '../config';
import { registry } from './registry';

// 纯 Node 实现的 .docx 生成器（不依赖任何第三方库 / Python）。
// .docx 本质是 ZIP 包（OOXML），这里用 STORE（不压缩）方式打包必要的 XML 部件，
// 生成 Word/WPS 可直接打开的标准文档。支持标题、列表、加粗、分段。

// ---------- CRC32 ----------
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ---------- 极简 ZIP（STORE 法） ----------
function makeZip(files: { name: string; data: Buffer }[]): Buffer {
  const enc = (s: string) => Buffer.from(s, 'utf8');
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const nameBuf = enc(f.name);
    const crc = crc32(f.data);
    const size = f.data.length;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // 文件名 UTF-8
    local.writeUInt16LE(0, 8); // 压缩方式：store
    local.writeUInt16LE(0, 10); // 时间
    local.writeUInt16LE(0, 12); // 日期
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(size, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, nameBuf, f.data);

    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0x0800, 8);
    c.writeUInt16LE(0, 10);
    c.writeUInt16LE(0, 12);
    c.writeUInt16LE(0, 14);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(size, 20);
    c.writeUInt32LE(size, 24);
    c.writeUInt16LE(nameBuf.length, 28);
    c.writeUInt16LE(0, 30);
    c.writeUInt16LE(0, 32);
    c.writeUInt16LE(0, 34);
    c.writeUInt16LE(0, 36);
    c.writeUInt32LE(0, 38);
    c.writeUInt32LE(offset, 42);
    central.push(c, nameBuf);
    offset += local.length + nameBuf.length + f.data.length;
  }
  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...chunks, centralBuf, eocd]);
}

// ---------- OOXML 部件 ----------
const CT = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const DOC_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
</Relationships>`;

const DOC_START = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>`;
const DOC_END = `<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>`;

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// 行内富文本：支持 **加粗** 与 *斜体*
function runs(text: string): string {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g);
  let out = '';
  for (const p of parts) {
    if (!p) continue;
    if (p.startsWith('**') && p.endsWith('**')) {
      out += `<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${esc(p.slice(2, -2))}</w:t></w:r>`;
    } else if (p.startsWith('*') && p.endsWith('*')) {
      out += `<w:r><w:rPr><w:i/></w:rPr><w:t xml:space="preserve">${esc(p.slice(1, -1))}</w:t></w:r>`;
    } else {
      out += `<w:r><w:t xml:space="preserve">${esc(p)}</w:t></w:r>`;
    }
  }
  return out || `<w:r><w:t xml:space="preserve"></w:t></w:r>`;
}

function para(inner: string, style?: string): string {
  const pPr = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : '';
  return `<w:p>${pPr}${inner}</w:p>`;
}

function renderBody(title: string, content: string): string {
  const paras: string[] = [];
  const t = (title || '').trim();
  if (t) paras.push(para(runs(t), 'Title'));
  const lines = (content || '').split(/\r?\n/);
  let firstChecked = false; // 仅对正文首行做标题去重检查
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) continue;
    if (/^#{1,6}\s+/.test(line)) {
      const lvl = line.match(/^#+/)![0].length;
      const htext = line.replace(/^#+\s+/, '').trim();
      // 去重：若正文首行标题与文档标题相同，跳过以免重复渲染
      if (!firstChecked && t && htext === t) { firstChecked = true; continue; }
      paras.push(para(runs(htext), 'Heading' + Math.min(lvl, 6)));
    } else if (/^[-*]\s+/.test(line)) {
      paras.push(para(runs('• ' + line.replace(/^[-*]\s+/, ''))));
    } else {
      paras.push(para(runs(line)));
    }
    firstChecked = true;
  }
  if (!paras.length) paras.push(para(runs('')));
  return DOC_START + paras.join('') + DOC_END;
}

function buildDocx(title: string, content: string): Buffer {
  const files = [
    { name: '[Content_Types].xml', data: Buffer.from(CT, 'utf8') },
    { name: '_rels/.rels', data: Buffer.from(ROOT_RELS, 'utf8') },
    { name: 'word/document.xml', data: Buffer.from(renderBody(title, content), 'utf8') },
    { name: 'word/_rels/document.xml.rels', data: Buffer.from(DOC_RELS, 'utf8') },
  ];
  return makeZip(files);
}

export function registerDocxTool() {
  registry.register({
    name: 'create_docx',
    description:
      '生成真正的 Microsoft Word (.docx) 文档并写入磁盘。常见失败：①路径无写权限→换到桌面或工作区目录；②中文文件名在特殊系统报错→用拼音文件名；③超时→文档过大，分段生成。（纯文本或 Markdown 均可，支持 # 标题、- 列表、**加粗**、空行分段）。path 支持绝对路径（如 C:\\Users\\your-user\\Desktop\\船舶管理.docx，可写任意位置）或相对路径（相对 data/workspace）。' +
      '当用户要求"生成WORD文档/写报告/导出docx/写文章并存成Word"时必须使用本工具，不要用普通文本文件冒充。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '输出 .docx 路径，如 C:\\\\Users\\\\your-user\\\\Desktop\\\\船舶管理.docx' },
        title: { type: 'string', description: '文档标题（作为正文首段大标题）' },
        content: { type: 'string', description: '文档正文，支持 Markdown：# 标题、- 列表、**加粗**、空行分段' },
      },
      required: ['path', 'content'],
    },
  }, (args: any) => {
    let fp = path.isAbsolute(args.path) ? path.resolve(args.path) : path.resolve(CONFIG.WORKSPACE_DIR, args.path);
    if (!fp.toLowerCase().endsWith('.docx')) fp += '.docx';
    ensureDir(path.dirname(fp));
    const buf = buildDocx(String(args.title || ''), String(args.content || ''));
    fs.writeFileSync(fp, buf);
    return { ok: true, path: fp, bytes: buf.length, note: '已生成标准 .docx 文件（可用 Word / WPS 直接打开）' };
  });
}

// server/src/skills/marketplace/registry.ts
// 技能市场注册中心（2026-08-15 生态扩展）。
//
// 能力：
//  - listMarketplace / getEntry / categories：聚合「内置技能 + 本地注册中心发布 + 已安装市场技能」的统一视图
//  - publishSkill：把现有技能（或新建）打成 .skill 包（tar.gz），sha256 校验 + 危险脚本扫描，写入注册中心
//  - installSkill：校验完整性后解包到 skills/installed/<slug>/，刷新技能缓存（自动进入 use_skill 流）
//  - uninstallSkill：移除 skills/installed/<slug>/，刷新缓存
//  - rateSkill：星级评分（持久化于 registry.json）
//
// 安全硬门槛：
//  - 市场技能默认 trust='sandboxed'（loader 据此在受限沙箱运行）；仅 manifest 显式 trust='trusted' 才放行
//  - 安装前校验 .skill 包 sha256 == 注册中心记录，杜绝传输/存储被篡改
//  - publish/install 时扫描危险脚本（rm -rf /、curl|sh、sudo、eval、child_process.exec 等），标注 dangerFlags 供 UI 警示
//
// 注意：本模块属服务端可信代码，不受市场技能沙箱约束，可调用 tar / fs；网关默认绑 127.0.0.1（B3 整改），
// 写操作另需 AH_MARKETPLACE_TOKEN（若配置）。

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { CONFIG, ensureDir } from '../../config';
import { getSkills, clearSkillCache } from '../loader';
import type { MarketplaceEntry, PublishInput, Rating, DangerFlag, RemoteRef } from './types';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MARKETPLACE_DIR = path.join(CONFIG.DATA_DIR, 'marketplace');
const REGISTRY_FILE = path.join(MARKETPLACE_DIR, 'registry.json');
const PACKAGES_DIR = path.join(MARKETPLACE_DIR, 'packages');
const INSTALLED_DIR = path.join(__dirname, '..', 'installed'); // server/src/skills/installed
const BUILTIN_DIR = path.join(__dirname, '..', 'builtin');

// ── 危险脚本模式（发布/安装扫描） ──
const DANGER_PATTERNS: { re: RegExp; pattern: string; severity: 'high' | 'medium' }[] = [
  { re: /rm\s+-rf\s+\//, pattern: '递归删除根路径 (rm -rf /)', severity: 'high' },
  { re: /rmdir\s+\/s/i, pattern: 'Windows 强制删除 (rmdir /s)', severity: 'high' },
  { re: /del\s+\/[sqf]/i, pattern: 'Windows 强制删除 (del /s/q/f)', severity: 'high' },
  { re: /format\s+[a-z]:/i, pattern: '格式化磁盘 (format C:)', severity: 'high' },
  { re: /shutdown(\.exe)?(\s|$)/i, pattern: '关机命令 (shutdown)', severity: 'high' },
  { re: /mkfs|dd\s+if=\/dev/i, pattern: '破坏磁盘 (mkfs/dd)', severity: 'high' },
  { re: /:\s*\(\)\s*\{.*\|\s*:\s*&/i, pattern: 'fork 炸弹', severity: 'high' },
  { re: /curl\s+[^\n|]*\|\s*(sh|bash)/i, pattern: '管道下载即执行 (curl | sh)', severity: 'high' },
  { re: /wget\s+[^\n|]*\|\s*(sh|bash)/i, pattern: '管道下载即执行 (wget | sh)', severity: 'high' },
  { re: /sudo\s+/i, pattern: '提权执行 (sudo)', severity: 'high' },
  { re: /chmod\s+777/i, pattern: '开放全部权限 (chmod 777)', severity: 'high' },
  { re: /child_process\.exec|os\.system\(|subprocess\.call|subprocess\.run/i, pattern: '执行系统命令 (exec/system/subprocess)', severity: 'high' },
  { re: /eval\s*\(/i, pattern: '动态执行 (eval)', severity: 'medium' },
  { re: /base64\s+-d[^\n]*exec/i, pattern: 'base64 解码后执行', severity: 'high' },
  { re: /nc\s+-e|netcat.*-e/i, pattern: '反弹 shell (nc -e)', severity: 'high' },
  { re: /powershell\s+-enc/i, pattern: 'PowerShell 编码执行', severity: 'high' },
  { re: /curl\s+|wget\s+|requests\.(get|post)|fetch\s*\(/i, pattern: '网络访问 (curl/wget/requests/fetch)', severity: 'medium' },
  { re: /process\.env|fs\.writeFile|fs\.unlink|os\.remove|os\.rmdir/i, pattern: '环境/文件系统写操作', severity: 'medium' },
];

function slugify(name: string): string {
  const s = String(name || '').trim().toLowerCase().replace(/[^\w一-龥]+/g, '_').replace(/^_+|_+$/g, '');
  return s || ('skill_' + Date.now());
}

function ensureDirs(): void {
  ensureDir(MARKETPLACE_DIR);
  ensureDir(PACKAGES_DIR);
  ensureDir(INSTALLED_DIR);
}

// ── 注册中心持久化 ──
function loadRegistry(): MarketplaceEntry[] {
  try {
    if (!fs.existsSync(REGISTRY_FILE)) return [];
    const arr = JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf8'));
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}
function saveRegistry(entries: MarketplaceEntry[]): void {
  ensureDirs();
  fs.writeFileSync(REGISTRY_FILE, JSON.stringify(entries, null, 2), 'utf8');
}

// ── 完整性 ──
function sha256File(fp: string): string {
  const buf = fs.readFileSync(fp);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

// ── .skill 打包 / 解包（纯 Node USTAR tar.gz，跨平台无外部依赖） ──
// 技能包结构浅（SKILL.md + references/ + scripts/），USTAR 100 字节命名上限足够；
// 若路径超长则抛错（实际技能不会触发）。sha256 由调用方计算，完整性另校验。
function collectFiles(dir: string, base: string, out: string[]): void {
  let ents: fs.Dirent[] = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    if (e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    const rel = path.join(base, e.name).replace(/\\/g, '/');
    if (e.isDirectory()) collectFiles(p, rel, out);
    else out.push(rel);
  }
}

function oField(n: number, w: number): string {
  const s = Math.max(0, Math.floor(n)).toString(8);
  return s.padStart(w - 1, '0').slice(0, w - 1) + '\0';
}

function tarHeader(name: string, size: number): Buffer {
  const buf = Buffer.alloc(512);
  if (name.length > 100) throw new Error('技能包内路径过长（>100 字节），无法用 USTAR 打包：' + name);
  buf.write(name, 0, 'utf8');
  buf.write('0000644\0', 100);                       // mode 0644
  buf.write(oField(0, 8), 108);                      // uid
  buf.write(oField(0, 8), 116);                      // gid
  buf.write(oField(size, 12), 124);                  // size
  buf.write(oField(Math.floor(Date.now() / 1000), 12), 136); // mtime
  buf.write('        ', 148);                        // chksum 占位（8 空格，校验和按此算）
  buf[156] = 0x30;                                   // typeflag '0' 普通文件
  buf.write('ustar\0', 257);                         // magic
  buf.write('00', 263);                              // version
  buf.write('ah\0', 265);                            // uname
  buf.write('ah\0', 297);                            // gname
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += buf[i];
  buf.write(Math.floor(sum).toString(8).padStart(6, '0').slice(0, 6) + '\0 ', 148); // 6 位八进制 + NUL + 空格
  return buf;
}

function tarPack(srcDir: string, outFile: string): void {
  const files: string[] = [];
  collectFiles(srcDir, '', files);
  const parts: Buffer[] = [];
  for (const rel of files) {
    const data = fs.readFileSync(path.join(srcDir, rel));
    parts.push(tarHeader(rel, data.length));
    parts.push(data);
    const pad = (512 - (data.length % 512)) % 512;
    if (pad) parts.push(Buffer.alloc(pad));
  }
  parts.push(Buffer.alloc(1024)); // 两个零块：归档结束标记
  fs.writeFileSync(outFile, zlib.gzipSync(Buffer.concat(parts)));
}

function tarUnpack(tarFile: string, outDir: string): void {
  ensureDir(outDir);
  const tarBuf = zlib.gunzipSync(fs.readFileSync(tarFile));
  let off = 0;
  while (off + 512 <= tarBuf.length) {
    const header = tarBuf.subarray(off, off + 512);
    if (header.every(b => b === 0)) break; // 结束标记
    let name = '';
    for (let i = 0; i < 100 && header[i] !== 0; i++) name += String.fromCharCode(header[i]);
    const sizeStr = header.subarray(124, 136).toString('ascii').replace(/\0/g, '').trim();
    const size = parseInt(sizeStr, 8) || 0;
    const typeflag = header[156];
    off += 512;
    if (typeflag === 0x30 || typeflag === 0x00) { // 普通文件
      const data = tarBuf.subarray(off, off + size);
      const dest = path.join(outDir, name);
      ensureDir(path.dirname(dest));
      fs.writeFileSync(dest, data);
    }
    off += size + ((512 - (size % 512)) % 512);
  }
}

// ── 危险脚本扫描 ──
function scanDanger(dir: string): DangerFlag[] {
  const flags: DangerFlag[] = [];
  const SCRIPT_RE = /\.(py|sh|js|ts|bat|ps1|rb|pl)$/i;
  const walk = (d: string) => {
    let ents: fs.Dirent[] = [];
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (e.name.startsWith('.')) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!(SCRIPT_RE.test(p) || e.name.toLowerCase() === 'skill.md')) continue;
      let content = '';
      try { content = fs.readFileSync(p, 'utf8'); } catch { continue }
      const rel = path.relative(dir, p).replace(/\\/g, '/');
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const ln = lines[i];
        for (const dq of DANGER_PATTERNS) {
          if (dq.re.test(ln)) {
            // 去重：同文件同行同模式只记录一次
            if (!flags.some(f => f.file === rel && f.line === i + 1 && f.pattern === dq.pattern)) {
              flags.push({ file: rel, line: i + 1, pattern: dq.pattern, severity: dq.severity });
            }
          }
        }
      }
    }
  };
  try { walk(dir); } catch { /* ignore */ }
  return flags;
}

// ── 递归拷贝（发布暂存用） ──
function copyDir(src: string, dest: string): void {
  ensureDir(dest);
  let ents: fs.Dirent[] = [];
  try { ents = fs.readdirSync(src, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    if (e.name.startsWith('.')) continue;
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function isInstalled(slug: string): boolean {
  return fs.existsSync(path.join(INSTALLED_DIR, slug));
}

// 从 getSkills() 的 Skill 推导注册中心条目（用于内置/已安装技能的展示基底）
function entryFromSkill(name: string, opts: { source?: 'builtin' | 'marketplace'; installed: boolean }): MarketplaceEntry | null {
  const sk = getSkills().find(s => s.name === name);
  if (!sk) {
    // 按 slug 兜底（名称与 slug 可能不同）
    const bySlug = getSkills().find(s => slugify(s.name) === name);
    if (!bySlug) return null;
    return entryFromSkill(bySlug.name, opts);
  }
  const m: any = sk.manifest || {};
  const perms = m.permissions || {};
  return {
    slug: slugify(sk.name),
    name: sk.name,
    version: m.version || (sk.source === 'marketplace' ? '1.0.0' : 'builtin'),
    author: m.author,
    description: sk.description || '',
    tags: sk.tags || [],
    category: sk.category || '其他',
    permissions: {
      network: Boolean(perms.network),
      fileWrite: Boolean(perms.fileWrite),
      shell: Boolean(perms.shell),
    },
    trust: sk.trust || (sk.source === 'marketplace' ? 'sandboxed' : 'trusted'),
    rating: 0,
    ratingsCount: 0,
    ratings: [],
    source: opts.source ? (opts.source === 'marketplace' ? 'local' : opts.source) : (sk.source === 'marketplace' ? 'local' : 'builtin'),
    publishedAt: 0,
    updatedAt: 0,
    sha256: m.sha256 || '',
    packagePath: '',
    installed: opts.installed,
  };
}

// ── 聚合视图 ──
export interface ListQuery {
  q?: string;
  category?: string;
  tag?: string;
  sort?: 'popular' | 'rating' | 'newest' | 'name';
  installedOnly?: boolean;
}

export function listMarketplace(q: ListQuery = {}): MarketplaceEntry[] {
  const map = new Map<string, MarketplaceEntry>();
  // 1) 内置技能基线（始终已安装）
  for (const s of getSkills()) {
    if ((s.source || 'builtin') !== 'builtin') continue;
    const e = entryFromSkill(s.name, { source: 'builtin', installed: true });
    if (e) map.set(e.slug, e);
  }
  // 2) 已安装的市场技能（未发布到注册中心的也展示）
  for (const s of getSkills()) {
    if (s.source !== 'marketplace') continue;
    const e = entryFromSkill(s.name, { source: 'marketplace', installed: true });
    if (e && !map.has(e.slug)) map.set(e.slug, e);
  }
  // 3) 注册中心条目覆盖元数据（ratings/sha256/permissions），installed 取并集
  for (const e of loadRegistry()) {
    const cur = map.get(e.slug);
    const installed = e.installed || (cur?.installed ?? false) || isInstalled(e.slug);
    map.set(e.slug, { ...e, installed });
  }

  let list = [...map.values()];

  // 过滤
  const ql = (q.q || '').trim().toLowerCase();
  if (ql) {
    list = list.filter(e =>
      e.name.toLowerCase().includes(ql) ||
      e.description.toLowerCase().includes(ql) ||
      e.tags.some(t => t.toLowerCase().includes(ql)) ||
      e.category.toLowerCase().includes(ql));
  }
  if (q.category && q.category !== 'all') list = list.filter(e => e.category === q.category);
  if (q.tag) list = list.filter(e => e.tags.includes(q.tag!));
  if (q.installedOnly) list = list.filter(e => e.installed);

  // 排序
  const sort = q.sort || 'popular';
  list.sort((a, b) => {
    if (sort === 'rating') return b.rating - a.rating || b.ratingsCount - a.ratingsCount;
    if (sort === 'newest') return b.updatedAt - a.updatedAt || b.publishedAt - a.publishedAt;
    if (sort === 'name') return a.name.localeCompare(b.name);
    // popular：下载/安装热度近似（已安装 + 评分人数）
    return (Number(b.installed) + b.ratingsCount) - (Number(a.installed) + a.ratingsCount);
  });
  return list;
}

export function getEntry(slug: string): MarketplaceEntry | null {
  return listMarketplace().find(e => e.slug === slug) || null;
}

export function categories(): { categories: string[]; tags: string[] } {
  const cats = new Set<string>();
  const tags = new Set<string>();
  for (const e of listMarketplace()) {
    if (e.category) cats.add(e.category);
    for (const t of e.tags) tags.add(t);
  }
  return { categories: [...cats].sort(), tags: [...tags].sort() };
}

// ── 发布 ──
export async function publishSkill(input: PublishInput): Promise<MarketplaceEntry> {
  ensureDirs();
  let srcDir: string | null = null;
  let stage: string | null = null;
  let baseName = '';
  let baseDesc = '';
  let baseTags: string[] = [];
  let baseCategory = '其他';

  if (input.slug || input.name) {
    const target = input.slug || input.name || '';
    const sk = getSkills().find(s => s.name === target || slugify(s.name) === slugify(target));
    if (sk) {
      srcDir = sk.dir;
      baseName = sk.name;
      baseDesc = sk.description || '';
      baseTags = sk.tags || [];
      baseCategory = sk.category || '其他';
    }
  }
  if (!srcDir && input.body && input.name) {
    // 直接新建：暂存目录写 SKILL.md
    stage = fs.mkdtempSync(path.join(MARKETPLACE_DIR, '.stage-'));
    fs.writeFileSync(path.join(stage, 'SKILL.md'), [
      '---',
      `name: ${input.name}`,
      `description: ${input.description || ''}`,
      '---',
      '',
      input.body.trim(),
    ].join('\n'), 'utf8');
    srcDir = stage;
    baseName = input.name;
    baseDesc = input.description || '';
    baseTags = input.tags || [];
    baseCategory = input.category || '其他';
  }
  if (!srcDir) throw new Error('未找到可发布的技能：请提供已存在的 slug/name，或同时提供 name + body 新建。');

  const slug = slugify(baseName);
  const pkgPath = path.join(PACKAGES_DIR, slug + '.skill');

  // 组装 manifest（合并来源 manifest 与入参覆盖）
  let existingManifest: any = {};
  if (fs.existsSync(path.join(srcDir, 'manifest.json'))) {
    try { existingManifest = JSON.parse(fs.readFileSync(path.join(srcDir, 'manifest.json'), 'utf8')) || {}; } catch { /* ignore */ }
  }
  const manifest = {
    name: baseName,
    version: input.version || existingManifest.version || '1.0.0',
    author: input.author || existingManifest.author || 'local',
    description: input.description || baseDesc || existingManifest.description || '',
    tags: input.tags || baseTags || existingManifest.tags || [],
    category: input.category || baseCategory || existingManifest.category || '其他',
    permissions: {
      network: Boolean((input.permissions?.network ?? existingManifest.permissions?.network ?? false)),
      fileWrite: Boolean((input.permissions?.fileWrite ?? existingManifest.permissions?.fileWrite ?? false)),
      shell: Boolean((input.permissions?.shell ?? existingManifest.permissions?.shell ?? false)),
    },
    trust: (input.trust === 'trusted' ? 'trusted' : 'sandboxed') as 'trusted' | 'sandboxed',
  };

  // 暂存目录（含 manifest.json）后打包；tar -C packSrc . 保证包内为相对路径（无前缀）
  const packSrc = stage || fs.mkdtempSync(path.join(MARKETPLACE_DIR, '.stage-'));
  if (!stage) copyDir(srcDir, packSrc);
  fs.writeFileSync(path.join(packSrc, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

  // 危险脚本扫描（基于暂存目录）
  const dangerFlags = scanDanger(packSrc);

  // 打包 + 校验和
  try { fs.rmSync(pkgPath, { force: true }); } catch { /* ignore */ }
  await tarPack(packSrc, pkgPath);
  const sha = sha256File(pkgPath);
  if (!stage) { try { fs.rmSync(packSrc, { recursive: true, force: true }); } catch { /* ignore */ } }

  // 写入/更新注册中心
  const registry = loadRegistry();
  const idx = registry.findIndex(e => e.slug === slug);
  const prev = idx >= 0 ? registry[idx] : null;
  const now = Date.now();
  const entry: MarketplaceEntry = {
    slug,
    name: baseName,
    version: manifest.version,
    author: manifest.author,
    description: manifest.description,
    tags: manifest.tags,
    category: manifest.category,
    permissions: manifest.permissions,
    trust: manifest.trust,
    rating: prev?.rating || 0,
    ratingsCount: prev?.ratingsCount || 0,
    ratings: prev?.ratings || [],
    source: 'local',
    publishedAt: prev?.publishedAt || now,
    updatedAt: now,
    sha256: sha,
    packagePath: pkgPath,
    installed: isInstalled(slug),
    dangerFlags,
  };
  if (idx >= 0) registry[idx] = entry; else registry.push(entry);
  saveRegistry(registry);
  return entry;
}

// ── 安装 ──
export async function installSkill(slug: string): Promise<MarketplaceEntry> {
  ensureDirs();
  const registry = loadRegistry();
  const entry = registry.find(e => e.slug === slug);
  if (!entry || !entry.packagePath) throw new Error('未找到可安装的技能「' + slug + '」：请先发布到注册中心。');
  if (!fs.existsSync(entry.packagePath)) throw new Error('安装包缺失：' + entry.packagePath);

  // 完整性校验：防篡改
  const sha = sha256File(entry.packagePath);
  if (entry.sha256 && sha !== entry.sha256) {
    throw new Error('完整性校验失败：包 sha256 与注册中心记录不符，疑似被篡改，已拒绝安装。');
  }

  const dest = path.join(INSTALLED_DIR, slug);
  try { fs.rmSync(dest, { recursive: true, force: true }); } catch { /* ignore */ }
  await tarUnpack(entry.packagePath, dest);

  // 确保 manifest.json 落地（沙箱/信任级依据）
  const mfPath = path.join(dest, 'manifest.json');
  if (!fs.existsSync(mfPath)) {
    fs.writeFileSync(mfPath, JSON.stringify({
      name: entry.name, version: entry.version, author: entry.author,
      description: entry.description, tags: entry.tags, category: entry.category,
      permissions: entry.permissions, trust: entry.trust, sha256: entry.sha256,
    }, null, 2), 'utf8');
  }

  clearSkillCache(); // 让 loader 重新扫描 installed，技能立即进入 use_skill 流

  // 更新注册中心 installed 标记
  entry.installed = true;
  const idx = registry.findIndex(e => e.slug === slug);
  if (idx >= 0) { registry[idx] = entry; saveRegistry(registry); }

  // 回读危险标记（若发布时未记录）
  if (!entry.dangerFlags) entry.dangerFlags = scanDanger(dest);
  return entry;
}

// ── 卸载 ──
export function uninstallSkill(slug: string): { ok: boolean; slug: string } {
  const dest = path.join(INSTALLED_DIR, slug);
  let ok = false;
  try { fs.rmSync(dest, { recursive: true, force: true }); ok = true; } catch { /* ignore */ }
  clearSkillCache();
  const registry = loadRegistry();
  const idx = registry.findIndex(e => e.slug === slug);
  if (idx >= 0) { registry[idx].installed = false; saveRegistry(registry); }
  return { ok, slug };
}

// ── 评分 ──
export function rateSkill(slug: string, stars: number, comment?: string, by?: string): MarketplaceEntry {
  const clamped = Math.max(1, Math.min(5, Math.round(stars)));
  const registry = loadRegistry();
  let entry = registry.find(e => e.slug === slug);
  if (!entry) {
    // 内置/已安装但未发布：从聚合视图取基底再落库
    const base = getEntry(slug);
    if (!base) throw new Error('未找到技能「' + slug + '」');
    entry = { ...base, ratings: [], ratingsCount: 0, rating: 0, source: base.source === 'builtin' ? 'builtin' : 'local', publishedAt: base.publishedAt || Date.now(), updatedAt: Date.now(), packagePath: base.packagePath || '', sha256: base.sha256 || '' };
    registry.push(entry);
  }
  const rating: Rating = { stars: clamped, comment, by, at: Date.now() };
  entry.ratings = entry.ratings || [];
  entry.ratings.push(rating);
  entry.ratingsCount = entry.ratings.length;
  entry.rating = entry.ratings.reduce((s, r) => s + r.stars, 0) / entry.ratingsCount;
  entry.updatedAt = Date.now();
  if (!entry.publishedAt) entry.publishedAt = Date.now();
  saveRegistry(registry);
  return entry;
}

// 启动自愈：确保目录存在（供 unified 启动时调用）
export function initMarketplace(): void {
  ensureDirs();
}

/* ════════════════════════════════════════════════════════════════════
 * GitHub 远程注册中心（Phase 2：联网搜索 / 下载 / 安装）
 * ────────────────────────────────────────────────────────────────────
 * 设计：
 *  - 远程仓库（owner/repo）按约定组织技能：仓库内某目录（rootPath 或缺省根）
 *    下每个子目录是一个技能，含 SKILL.md（frontmatter 提供元数据）。
 *  - 也兼容仓库根存在 marketplace.json 索引（可选），优先使用索引以避免逐目录拉取；
 *    无索引则枚举子目录 + 逐技能拉 SKILL.md frontmatter。
 *  - 列表结果缓存 90s（GitHub 匿名限速 60/h，缓存降频）。
 *  - 下载：递归拉取技能目录 → 打 .skill 包 → 写本地注册中心（source='local'）
 *    → 用户可在「本地市场」点「安装」解包，完成 下载→安装 闭环。
 * 安全：仅只读浏览 + 用户主动下载；下载后同样走 sha256 校验 + 危险脚本扫描 + 沙箱默认。
 * ════════════════════════════════════════════════════════════════════ */

const REMOTE_CONFIG_FILE = path.join(MARKETPLACE_DIR, 'remote.json');
const REMOTE_CACHE_TTL = 90_000; // 90s
// GitHub API 基址（可被 AH_GITHUB_API 覆盖，用于 GitHub Enterprise / 镜像）
const GH_API_BASE = (process.env.AH_GITHUB_API || 'https://api.github.com').replace(/\/+$/, '');

export interface RemoteRepo {
  url: string;        // https://github.com/owner/repo 或 owner/repo 或带 /tree/<branch>/<path>
  rootPath?: string;  // 技能所在子目录（缺省仓库根）
  label?: string;
}
export interface RemoteConfig {
  repos: RemoteRepo[];
  token?: string;     // 可选 GitHub token（提升速率上限）；留空则回退 AH_GITHUB_TOKEN
}
interface RemoteCache {
  ts: number;
  skills: MarketplaceEntry[];
  errors: string[];
}

let _remoteCache: RemoteCache | null = null;

function ghToken(cfg?: RemoteConfig): string | undefined {
  return (cfg?.token && cfg.token.trim()) || process.env.AH_GITHUB_TOKEN || undefined;
}

export function getRemoteConfig(): RemoteConfig {
  try {
    if (fs.existsSync(REMOTE_CONFIG_FILE)) {
      const c = JSON.parse(fs.readFileSync(REMOTE_CONFIG_FILE, 'utf8'));
      // 已配置且非空仓库列表：直接采用（用户自定义数据源优先）
      if (c && Array.isArray(c.repos) && c.repos.length) return { repos: c.repos, token: c.token || '' };
    }
  } catch { /* ignore */ }
  // 未配置或仓库列表为空 → 回退到内置默认种子，保证远程市场开箱即有内容（仿 skillhub）
  const def: RemoteConfig = { repos: [{ url: 'anthropics/skills', rootPath: 'skills', label: 'Anthropic Skills' }] };
  setRemoteConfig(def);
  return def;
}
export function setRemoteConfig(cfg: RemoteConfig): void {
  ensureDirs();
  fs.writeFileSync(
    REMOTE_CONFIG_FILE,
    JSON.stringify({ repos: (cfg.repos || []).filter(r => !!r.url), token: (cfg.token || '').trim() }, null, 2),
    'utf8'
  );
  _remoteCache = null; // 配置变更即失效缓存
}

// ── 解析仓库 URL → owner/repo/branch/path ──
function parseRepo(url: string): { owner: string; repo: string; branch?: string; path?: string } | null {
  if (!url) return null;
  let u = url.trim().replace(/^https?:\/\//i, '').replace(/^github\.com\//i, '').replace(/\/+$/, '');
  let branch: string | undefined, sub: string | undefined;
  const treeM = u.match(/\/tree\/([^/]+)\/(.+)$/);
  if (treeM) { branch = treeM[1]; sub = treeM[2]; u = u.replace(/\/tree\/[^/]+\/.*$/, ''); }
  else {
    const blobM = u.match(/\/blob\/([^/]+)\/(.+)$/);
    if (blobM) { branch = blobM[1]; sub = blobM[2]; u = u.replace(/\/blob\/[^/]+\/.*$/, ''); }
  }
  const m = u.match(/^([\w.-]+)\/([\w.-]+)/);
  if (!m) return null;
  return { owner: m[1], repo: m[2], branch, path: sub || undefined };
}

// ── GitHub API 请求（带超时 + token）──
async function ghJson(url: string, token?: string): Promise<any> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  const headers: Record<string, string> = { 'Accept': 'application/vnd.github+json', 'User-Agent': 'DaShaAgent' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  try {
    const r = await fetch(url, { headers, signal: ctrl.signal });
    if (!r.ok) {
      throw new Error('GitHub API ' + r.status + ' @ ' + url);
    }
    return await r.json();
  } finally { clearTimeout(timer); }
}
async function downloadFile(url: string, dest: string, token?: string): Promise<void> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  const headers: Record<string, string> = { 'User-Agent': 'DaShaAgent' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  try {
    const r = await fetch(url, { headers, signal: ctrl.signal });
    if (!r.ok) throw new Error('下载失败 ' + r.status + ' @ ' + url);
    ensureDir(path.dirname(dest));
    const buf = Buffer.from(await r.arrayBuffer());
    fs.writeFileSync(dest, buf);
  } finally { clearTimeout(timer); }
}

// ── 递归下载技能目录（contents API 树遍历）──
async function downloadDirTo(apiBase: string, outDir: string, token?: string): Promise<void> {
  const entries = await ghJson(apiBase, token);
  if (!Array.isArray(entries)) return;
  for (const e of entries) {
    if (e.type === 'file' && e.download_url) {
      await downloadFile(e.download_url, path.join(outDir, e.name), token);
    } else if (e.type === 'dir' && e.url) {
      await downloadDirTo(e.url, path.join(outDir, e.name), token);
    }
  }
}

// ── 解析 SKILL.md frontmatter（轻量 YAML）──
function parseSkillFrontmatter(raw: string): Record<string, any> {
  const m = raw.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const out: Record<string, any> = {};
  for (const ln of m[1].split('\n')) {
    const kv = ln.match(/^([\w.-]+)\s*:\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1];
    let val = kv[2].trim();
    if (val.startsWith('[') && val.endsWith(']')) {
      out[key] = val.slice(1, -1).split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    } else if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      out[key] = val.slice(1, -1);
    } else if (val === '') {
      continue; // 可能多行值，跳过（此处不处理多行）
    } else {
      out[key] = val;
    }
  }
  return out;
}

function permBool(v: any): boolean { return v === true || v === 'true' || v === 1 || v === '1'; }

// ── 枚举单个仓库的技能 → MarketplaceEntry[] ──
async function listRepoSkills(repo: RemoteRepo, token?: string): Promise<MarketplaceEntry[]> {
  const parsed = parseRepo(repo.url);
  if (!parsed) throw new Error('无法解析仓库地址：' + repo.url);
  const { owner, repo: rname, branch } = parsed;
  const rootPath = (repo.rootPath || parsed.path || '').replace(/^\/+|\/+$/g, '');
  const ref = branch ? '?ref=' + encodeURIComponent(branch) : '';

  const base = `${GH_API_BASE}/repos/${owner}/${rname}/contents`;
  const encPath = (p: string) => p.split('/').map(encodeURIComponent).join('/'); // 逐段编码，保留路径斜杠
  const listingUrl = rootPath ? `${base}/${encPath(rootPath)}${ref}` : `${base}${ref}`;

  // 1) 优先读取仓库根 marketplace.json 索引
  let indexEntries: any[] | null = null;
  try {
    const idxUrl = rootPath
      ? `${base}/${encPath(rootPath)}/marketplace.json${ref}`
      : `${base}/marketplace.json${ref}`;
    const idx = await ghJson(idxUrl, token);
    if (idx && idx.content) {
      const txt = Buffer.from(idx.content, 'base64').toString('utf8');
      const arr = JSON.parse(txt);
      if (Array.isArray(arr)) indexEntries = arr;
    }
  } catch { /* 无索引则走枚举 */ }

  const out: MarketplaceEntry[] = [];
  const reg = loadRegistry();
  const regEntry = (slug: string) => reg.find(e => e.slug === slug);

  const makeEntry = (fm: Record<string, any>, dirName: string, remotePath: string): MarketplaceEntry => {
    const slug = slugify(fm.name || dirName);
    const perms = fm.permissions || {};
    const re = regEntry(slug);
    const installed = isInstalled(slug) || (re?.installed ?? false);
    const downloaded = !!re;
    return {
      slug,
      name: fm.name || dirName,
      version: String(fm.version || '1.0.0'),
      author: fm.author || (repo.label || (owner + '/' + rname)),
      description: fm.description || '',
      tags: Array.isArray(fm.tags) ? fm.tags : (fm.tags ? [String(fm.tags)] : []),
      category: fm.category || '其他',
      permissions: { network: permBool(perms.network), fileWrite: permBool(perms.fileWrite), shell: permBool(perms.shell) },
      trust: 'sandboxed',
      rating: 0, ratingsCount: 0, ratings: [],
      source: 'remote',
      publishedAt: 0, updatedAt: 0,
      sha256: '', packagePath: '',
      installed, downloaded,
      remote: { owner, repo: rname, branch, path: remotePath, url: repo.url } as RemoteRef,
    };
  };

  if (indexEntries) {
    for (const item of indexEntries) {
      const dirName = String(item.path || item.slug || item.name || '');
      if (!dirName) continue;
      const remotePath = rootPath ? `${rootPath}/${dirName}` : dirName;
      const fm = { name: item.name, version: item.version, author: item.author, description: item.description, tags: item.tags, category: item.category, permissions: item.permissions } as Record<string, any>;
      out.push(makeEntry(fm, dirName, remotePath));
    }
    return out;
  }

  // 2) 枚举子目录，逐技能拉 SKILL.md
  const listing = await ghJson(listingUrl, token);
  if (!Array.isArray(listing)) return out;
  for (const e of listing) {
    if (e.type !== 'dir') continue;
    const dirName = e.name;
    const remotePath = rootPath ? `${rootPath}/${dirName}` : dirName;
    const skillUrl = `${base}/${encPath(remotePath)}/SKILL.md${ref}`;
    try {
      const sk = await ghJson(skillUrl, token);
      const raw = sk.content ? Buffer.from(sk.content, 'base64').toString('utf8') : '';
      const fm = parseSkillFrontmatter(raw);
      if (!fm.name && !raw) continue; // 无 SKILL.md 内容
      out.push(makeEntry(fm, dirName, remotePath));
    } catch (err: any) { /* 该目录非技能，跳过 */ }
  }
  return out;
}

export interface RemoteQuery { q?: string; category?: string; force?: boolean }
export interface RemoteResult { skills: MarketplaceEntry[]; errors: string[] }

// ── 聚合所有远程仓库的技能（带缓存 + 过滤）──
export async function fetchRemoteSkills(q: RemoteQuery = {}): Promise<RemoteResult> {
  if (!q.force && _remoteCache && Date.now() - _remoteCache.ts < REMOTE_CACHE_TTL) {
    return { skills: filterRemote(_remoteCache.skills, q), errors: _remoteCache.errors };
  }
  const cfg = getRemoteConfig();
  const token = ghToken(cfg);
  const skills: MarketplaceEntry[] = [];
  const errors: string[] = [];
  for (const repo of cfg.repos) {
    try {
      const list = await listRepoSkills(repo, token);
      skills.push(...list);
    } catch (e: any) {
      errors.push((repo.label || repo.url) + '：' + (e?.message || '拉取失败'));
    }
  }
  _remoteCache = { ts: Date.now(), skills, errors };
  return { skills: filterRemote(skills, q), errors };
}

function filterRemote(list: MarketplaceEntry[], q: RemoteQuery): MarketplaceEntry[] {
  let out = list;
  const ql = (q.q || '').trim().toLowerCase();
  if (ql) out = out.filter(e =>
    e.name.toLowerCase().includes(ql) || e.description.toLowerCase().includes(ql) ||
    e.tags.some(t => t.toLowerCase().includes(ql)) || e.category.toLowerCase().includes(ql));
  if (q.category && q.category !== 'all') out = out.filter(e => e.category === q.category);
  return out;
}

// ── 打包并写入本地注册中心（发布/下载共用）──
async function packAndRegister(slug: string, srcDir: string, meta: Record<string, any>): Promise<MarketplaceEntry> {
  ensureDirs();
  // 确保 manifest.json 落地（沙箱/信任级依据）
  const mfPath = path.join(srcDir, 'manifest.json');
  let existing: any = {};
  if (fs.existsSync(mfPath)) { try { existing = JSON.parse(fs.readFileSync(mfPath, 'utf8')) || {}; } catch { /* ignore */ } }
  const manifest = {
    name: meta.name, version: meta.version || existing.version || '1.0.0', author: meta.author || existing.author || 'remote',
    description: meta.description || existing.description || '', tags: meta.tags || existing.tags || [],
    category: meta.category || existing.category || '其他',
    permissions: {
      network: permBool(meta.permissions?.network ?? existing.permissions?.network ?? false),
      fileWrite: permBool(meta.permissions?.fileWrite ?? existing.permissions?.fileWrite ?? false),
      shell: permBool(meta.permissions?.shell ?? existing.permissions?.shell ?? false),
    },
    trust: 'sandboxed' as const,
  };
  fs.writeFileSync(mfPath, JSON.stringify(manifest, null, 2), 'utf8');

  const pkgPath = path.join(PACKAGES_DIR, slug + '.skill');
  const dangerFlags = scanDanger(srcDir);
  try { fs.rmSync(pkgPath, { force: true }); } catch { /* ignore */ }
  await tarPack(srcDir, pkgPath);
  const sha = sha256File(pkgPath);

  const registry = loadRegistry();
  const idx = registry.findIndex(e => e.slug === slug);
  const prev = idx >= 0 ? registry[idx] : null;
  const now = Date.now();
  const entry: MarketplaceEntry = {
    slug, name: manifest.name, version: manifest.version, author: manifest.author,
    description: manifest.description, tags: manifest.tags, category: manifest.category,
    permissions: manifest.permissions, trust: manifest.trust,
    rating: prev?.rating || 0, ratingsCount: prev?.ratingsCount || 0, ratings: prev?.ratings || [],
    source: 'local', publishedAt: prev?.publishedAt || now, updatedAt: now,
    sha256: sha, packagePath: pkgPath, installed: isInstalled(slug), dangerFlags,
  };
  if (idx >= 0) registry[idx] = entry; else registry.push(entry);
  saveRegistry(registry);
  return entry;
}

// ── 一键安装远程技能（下载→安装 原子化，供市场页「安装」按钮调用）──
// 本地已注册过（有 packagePath）则跳过下载直接安装；否则先下载再安装。
export async function installRemoteSkill(slug: string): Promise<MarketplaceEntry> {
  ensureDirs();
  const registry = loadRegistry();
  const existing = registry.find(e => e.slug === slug && e.packagePath && fs.existsSync(e.packagePath));
  if (!existing) {
    await downloadSkill(slug); // 拉取并写本地注册中心
  }
  return installSkill(slug); // 解包启用
}

// ── 下载远程技能到本地注册中心（下载→注册，不自动安装）──
export async function downloadSkill(slug: string): Promise<MarketplaceEntry> {
  ensureDirs();
  // 优先用缓存（用户浏览时已将全部技能路径载入缓存，避免每次下载都重新枚举全仓库 → 省 GitHub 匿名配额）
  let { skills } = await fetchRemoteSkills({});
  let entry = skills.find(e => e.slug === slug);
  if (!entry) {
    const forced = await fetchRemoteSkills({ force: true });
    entry = forced.skills.find(e => e.slug === slug);
  }
  if (!entry || !entry.remote) throw new Error('未在远程仓库找到技能「' + slug + '」');
  const r = entry.remote;
  const cfg = getRemoteConfig();
  const token = ghToken(cfg);
  const base = `${GH_API_BASE}/repos/${r.owner}/${r.repo}/contents`;
  const ref = r.branch ? '?ref=' + encodeURIComponent(r.branch) : '';
  const apiBase = `${base}/${r.path.split('/').map(encodeURIComponent).join('/')}${ref}`;

  const tmp = fs.mkdtempSync(path.join(MARKETPLACE_DIR, '.gh-'));
  try {
    await downloadDirTo(apiBase, tmp, token);
    // 元数据来自远程列表的 frontmatter 解析结果
    const registered = await packAndRegister(slug, tmp, {
      name: entry.name, version: entry.version, author: entry.author,
      description: entry.description, tags: entry.tags, category: entry.category, permissions: entry.permissions,
    });
    return registered;
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

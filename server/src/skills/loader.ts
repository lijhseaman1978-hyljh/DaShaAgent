import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Skill } from '../core/types';
import { ensureDir } from '../config';

// 扫描 skills 目录下的 SKILL.md，解析 frontmatter（name/description/trigger/tags）。
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = path.join(__dirname, 'builtin');
// 市场技能安装目录（2026-08-15 技能市场）：install/uninstall 操作读写此处，
// loader 一并扫描，使市场技能自动进入 use_skill 与系统提示流，无需改调用方。
const INSTALLED_DIR = path.join(__dirname, 'installed');

// 中文意图 → 英文关键词 别名表（用户用中文提问时，把中文意图展开成英文 token 去匹配英文描述的技能）
// （导出供 tools/toolSearch.ts 的 BM25 查询扩展复用，避免两处别名表漂移）
export const ALIASES: Record<string, string[]> = {
  '图片': ['image', 'images', 'img', 'picture', 'photo', 'illustration', 'poster', 'cover', 'avatar', 'generate', 'generation', 'edit', 'editing', 'art'],
  '图像': ['image', 'images', 'img', 'generate', 'generation', 'edit', 'editing'],
  '插画': ['illustration', 'image', 'art', 'generate'],
  '配图': ['image', 'img', 'illustration', 'generate'],
  '海报': ['poster', 'image', 'design'],
  '封面': ['cover', 'image', 'poster'],
  '头像': ['avatar', 'image'],
  '视频': ['video', 'videos', 'animation', 'animate', 'clip', 'movie', 'generate', 'generation'],
  '动画': ['animation', 'animate', 'video', 'motion'],
  '短片': ['video', 'clip', 'movie'],
  '漫画': ['comic', 'comics', 'knowledge-comic'],
  '信息图': ['infographic', 'diagram', 'chart'],
  '图表': ['diagram', 'chart', 'graph', 'infographic'],
  '架构图': ['architecture', 'diagram', 'architecture-diagram'],
  '流程图': ['flowchart', 'diagram', 'flow'],
  '思维导图': ['mindmap', 'mind-map', 'diagram'],
  '线框': ['wireframe', 'design', 'ui'],
  '绘图': ['draw', 'drawing', 'diagram', 'sketch'],
  '搜索': ['search', 'find', 'lookup', 'tavily', 'web', 'retrieve', 'rag'],
  '检索': ['search', 'find', 'lookup', 'retrieve', 'rag'],
  '查找': ['search', 'find', 'lookup', 'locate'],
  '搜': ['search', 'find', 'tavily'],
  '新闻': ['news', 'article', 'web', 'search'],
  '资讯': ['news', 'article', 'information'],
  '网上': ['web', 'online', 'search'],
  '文章': ['article', 'articles', 'writing', 'write', 'blog', 'post', 'content', 'copywriting'],
  '写作': ['writing', 'write', 'article', 'content', 'copywriting'],
  '博客': ['blog', 'article', 'post', 'writing'],
  '文案': ['copywriting', 'content', 'writing', 'article'],
  '爆文': ['article', 'wechat', '公众号', 'content', 'baoyu'],
  '公众号': ['wechat', '公众号', 'wechat-article', 'draft', 'pipeline'],
  '微信': ['wechat', '公众号', 'imessage'],
  '推文': ['post', 'article', 'social', 'twitter', 'x'],
  '总结': ['summarize', 'summary', 'summarization'],
  '摘要': ['summary', 'summarize'],
  '归纳': ['summarize', 'summary'],
  '翻译': ['translate', 'translation'],
  '代码': ['code', 'coding', 'programming', 'script', 'function', 'refactor', 'bug'],
  '编程': ['code', 'coding', 'programming', 'develop'],
  '开发': ['develop', 'development', 'code', 'coding', 'programming'],
  '程序': ['code', 'programming', 'script'],
  '脚本': ['script', 'code', 'automation'],
  '前端': ['frontend', 'front-end', 'web', 'ui', 'html', 'css', 'react', 'vue'],
  '后端': ['backend', 'back-end', 'server', 'api'],
  '网页': ['web', 'website', 'frontend', 'html', 'css'],
  '网站': ['website', 'web', 'frontend'],
  '界面': ['ui', 'ux', 'design', 'interface'],
  '笔记': ['note', 'notes', 'note-taking', 'notebook', 'memo'],
  '备忘': ['memo', 'note', 'notes', 'reminder'],
  '记录': ['record', 'note', 'notes', 'log'],
  '提醒': ['reminder', 'reminders', 'todo', 'task', 'calendar'],
  '待办': ['todo', 'task', 'reminder'],
  '日程': ['calendar', 'schedule', 'reminder'],
  '邮件': ['email', 'mail', 'smtp', 'send'],
  '研究': ['research', 'study', 'analysis', 'analyze'],
  '调研': ['research', 'study', 'analysis'],
  '数据': ['data', 'analysis', 'analytics', 'dataset', 'csv', 'excel', 'pandas'],
  '分析': ['analysis', 'analyze', 'analytics', 'data'],
  '统计': ['statistics', 'stats', 'analysis', 'data'],
  '机器学习': ['machine-learning', 'ml', 'model', 'training', 'train', 'llm', 'ai'],
  '模型': ['model', 'training', 'train', 'ml', 'llm'],
  '训练': ['training', 'train', 'model', 'ml'],
  '大模型': ['llm', 'model', 'ai', 'agent'],
  '部署': ['deploy', 'deployment', 'devops', 'docker', 'kubernetes', 'k8s', 'server'],
  '运维': ['devops', 'deploy', 'docker', 'server', 'ops'],
  '定时': ['cron', 'schedule', 'scheduled', 'job', 'automation'],
  '计划任务': ['cron', 'schedule', 'job', 'automation'],
  '自动化': ['automation', 'automate', 'cron', 'pipeline', 'orchestrator'],
  '记忆': ['memory', 'memory-system', 'long-term', 'recall'],
  '知识库': ['knowledge', 'knowledge-base', 'rag', 'recall'],
  '桌面': ['computer', 'desktop', 'gui', 'click', 'os'],
  '电脑': ['computer', 'desktop', 'os', 'windows', 'macos', 'linux'],
  '点击': ['click', 'computer-use', 'gui', 'desktop'],
  '智能家居': ['smart-home', 'home', 'homekit', 'iot'],
  '家居': ['smart-home', 'home', 'homekit'],
  '音乐': ['music', 'song', 'songwriting', 'lyrics', 'audio'],
  '歌词': ['lyrics', 'song', 'songwriting', 'music'],
  '歌曲': ['song', 'music', 'songwriting'],
  '社交': ['social-media', 'social', 'twitter', 'x', 'post'],
  '安全': ['security', 'red-team', 'red-teaming', 'pentest', 'vulnerability'],
  '红队': ['red-team', 'red-teaming', 'pentest', 'security'],
  '渗透': ['pentest', 'security', 'red-teaming', 'vulnerability'],
  '依赖': ['dependency', 'dependencies', 'package', 'pip', 'install'],
  '苹果': ['apple', 'macos', 'imessage', 'notes', 'reminders', 'findmy'],
  '游戏': ['game', 'gaming'],
  '设计': ['design', 'ui', 'ux', 'figma'],
  '像素': ['pixel', 'ascii', 'p5js'],
  '去AI味': ['humanize', 'humanizer', 'rewrite', 'polish'],
  '润色': ['polish', 'rewrite', 'humanize', 'humanizer'],
  '改写': ['rewrite', 'polish', 'humanize'],
  '文档': ['document', 'doc', 'docx', 'word', 'pdf', 'markdown', 'md'],
  '推理': ['inference', 'infer', 'reasoning'],
  '效率': ['productivity'],
  '仓库': ['repository', 'repo', 'github', 'git'],
};

function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string; tags: string[] } {
  const m = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: raw, tags: [] };
  const fm = m[1];
  const meta: Record<string, string> = {};
  const lines = fm.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const ci = line.indexOf(':');
    if (ci <= 0) continue;
    const key = line.slice(0, ci).trim();
    let val = line.slice(ci + 1).trim();
    // YAML 块标量（`>` 折叠 / `|` 字面，可带 - + 修饰）：真正的值在后续缩进行里。
    // 不处理的话 description 会被解析成字面量 ">-"，该技能在所有检索路径上等于没有描述
    // （实测 8 个内置技能踩了这个坑，如 memory-system / computer-use）。
    if (/^[|>][-+]?\d*$/.test(val)) {
      const fold = val.startsWith('>');
      const keyIndent = (line.match(/^\s*/) || [''])[0].length;
      const buf: string[] = [];
      let j = i + 1;
      for (; j < lines.length; j++) {
        const ln = lines[j];
        if (ln.trim() === '') { buf.push(''); continue; }
        if ((ln.match(/^\s*/) || [''])[0].length <= keyIndent) break; // 缩进回退 → 块结束
        buf.push(ln.replace(/^\s+/, ''));
      }
      val = fold ? buf.join(' ').replace(/\s+/g, ' ').trim() : buf.join('\n').trim();
      i = j - 1;
    }
    meta[key] = val;
  }
  // 解析 tags：支持顶层 `tags: [a, b]` 与 `metadata.dasha.tags: [...]`
  const tags: string[] = [];
  const tagRe = /tags:\s*\[([^\]]*)\]/g;
  let tm: RegExpExecArray | null;
  while ((tm = tagRe.exec(fm))) {
    for (const t of tm[1].split(',')) {
      const tt = t.trim().replace(/^["']|["']$/g, '');
      if (tt) tags.push(tt);
    }
  }
  return { meta, body: m[2], tags };
}

// dir -> 可检索 token 集合（小写），用于懒加载打分（IDF 加权，提升相关性、抑制泛化词）
const _tokens = new Map<string, Set<string>>();
const _df = new Map<string, number>(); // token -> 文档频率（含该 token 的技能数）
let _N = 0; // 技能总数

// 统一分词：英文/数字按词（>=2），中文按连续串。用户查询与技能索引用同一套分词，保证可比对。
function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const m of text.toLowerCase().matchAll(/[a-z0-9_]+/g)) if (m[0].length >= 2) out.push(m[0]);
  for (const m of text.matchAll(/[一-龥]+/g)) out.push(m[0]);
  return out;
}

function buildSearch(s: Skill): string {
  return [s.name, s.description, s.trigger || '', (s.tags || []).join(' '), (s.body || '').slice(0, 600)]
    .join(' \n ');
}

function idf(t: string): number {
  const df = _df.get(t) || 0;
  return Math.log((_N + 1) / (df + 1)) + 1; // 平滑，越稀有的 token 权重越高
}

// 粗分类：把扁平的 141 个技能归到少量可读的桶里，用于在系统提示中做"分组索引"（借鉴 dasha 的
// category-grouped <available_skills> 思路）。纯关键词启发式，允许少量误判——索引只是导航，
// 真实匹配仍由 topSkillFor / list_skills / use_skill 兜底。
const CATEGORY_ORDER = ['文档/写作', '图像/视频', '代码/开发', '研究/数据', '效率/自动化', '系统/文件', '社交/通讯', '其他'];
function categoryOf(s: { name: string; description?: string; tags?: string[] }): string {
  const t = (s.name + ' ' + (s.description || '') + ' ' + (s.tags || []).join(' ')).toLowerCase();
  const has = (...kw: string[]) => kw.some(k => t.includes(k));
  if (has('doc', 'docx', 'word', 'pdf', 'write', 'writing', 'article', 'blog', '文案', '报告', 'report', 'copy', '公众号', 'wechat-article', 'summar', '总结', '摘要', 'resume', '简历', '合同', '邮件模', 'newsletter'))
    return '文档/写作';
  if (has('image', 'img', 'photo', 'poster', 'illustration', 'video', 'animation', 'anim', 'comic', 'gif', '画', '视频', '海报', '插画', '生图', 'generate', 'cover', '封面', 'avatar', '头像'))
    return '图像/视频';
  if (has('code', 'coding', 'program', 'dev', 'develop', 'frontend', 'backend', 'web', 'react', 'vue', 'api', 'refactor', 'bug', '代码', '开发', '前端', '后端', '网页', '软件', 'typescript', 'python', '脚本'))
    return '代码/开发';
  if (has('research', 'data', 'analy', 'ml', 'llm', 'rag', 'search', '检索', '研究', '数据', '分析', '知识库', '论文', 'dataset'))
    return '研究/数据';
  if (has('automation', 'cron', 'schedule', 'workflow', 'productiv', 'orchestrat', '自动化', '定时', '效率', 'pipeline', 'scheduler', '调度'))
    return '效率/自动化';
  if (has('file', 'fs', 'memory', 'note', 'os', 'desktop', 'computer-use', '文件', '记忆', '笔记', '桌面', '系统', 'backup', '备份'))
    return '系统/文件';
  if (has('email', 'mail', 'imessage', 'wechat', 'social', 'telegram', '邮件', '微信', '社交', '消息', 'whatsapp', '公众号'))
    return '社交/通讯';
  return '其他';
}

// 递归扫描：遇到含 SKILL.md 的目录即视为一个技能叶子（不再下钻其内部的 references/scripts），
// 否则继续深入子目录（支持 creative/architecture-diagram 这类分类嵌套结构）。
// source 标记该目录来源（builtin=内置；marketplace=市场安装），用于给技能打信任级与来源标签。
function scan(dir: string, skills: Skill[], source: 'builtin' | 'marketplace' = 'builtin'): void {
  let entries: fs.Dirent[] = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  const self = path.join(dir, 'SKILL.md');
  if (fs.existsSync(self)) {
    const raw = fs.readFileSync(self, 'utf8');
    const { meta, body, tags } = parseFrontmatter(raw);
    // 市场技能：读取同目录 manifest.json，标记 source/trust/manifest（沙箱运行默认）
    let manifest: any | undefined;
    let trust: 'trusted' | 'sandboxed' = 'sandboxed';
    if (source === 'marketplace') {
      const mfPath = path.join(dir, 'manifest.json');
      if (fs.existsSync(mfPath)) {
        try {
          manifest = JSON.parse(fs.readFileSync(mfPath, 'utf8'));
          if (manifest && typeof manifest === 'object') {
            trust = manifest.trust === 'trusted' ? 'trusted' : 'sandboxed';
          }
        } catch { /* manifest 损坏则保持 sandbox 默认，安全优先 */ }
      }
    }
    const skill: Skill = {
      name: meta.name || path.basename(dir),
      description: meta.description || '',
      trigger: meta.trigger,
      body,
      dir,
      tags,
      source,
      trust: source === 'marketplace' ? trust : 'trusted',
      manifest: source === 'marketplace' ? manifest : undefined,
      // categoryOf 仅依据 name/description/tags 归类，不再传入多余字段（避免对象字面量多余属性检查报错）
      category: categoryOf({ name: meta.name || path.basename(dir), description: meta.description || '', tags }),
    };
    skills.push(skill);
    _tokens.set(dir, new Set(tokenize(buildSearch(skill))));
    return;
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (e.name.startsWith('.')) continue; // 跳过 .hub / .curator_backups 等缓存目录
    scan(path.join(dir, e.name), skills, source);
  }
}

export function loadSkills(): Skill[] {
  const scanned: Skill[] = [];
  _tokens.clear();
  _df.clear();
  scan(SKILLS_DIR, scanned, 'builtin');
  // 市场安装目录一并扫描（如不存在则静默跳过）
  scan(INSTALLED_DIR, scanned, 'marketplace');
  // 去重 + 同名优先级：用户显式安装的市场技能（marketplace）覆盖同名内置（builtin），
  // 以支持"市场升级版替换内置"的使用场景；其余同名保留先遇到的。
  const byName = new Map<string, Skill>();
  for (const s of scanned) {
    const prev = byName.get(s.name);
    if (!prev) { byName.set(s.name, s); continue; }
    if (prev.source === 'builtin' && s.source === 'marketplace') byName.set(s.name, s);
  }
  const skills: Skill[] = [...byName.values()];
  // 计算文档频率（DF）用于 IDF 加权（基于去重后的集合）
  _N = skills.length;
  for (const s of skills) {
    for (const t of (_tokens.get(s.dir) || [])) _df.set(t, (_df.get(t) || 0) + 1);
  }
  return skills;
}

let _cache: Skill[] | null = null;
export function getSkills(): Skill[] {
  if (!_cache) _cache = loadSkills();
  return _cache;
}
export function clearSkillCache() { _cache = null; _tokens.clear(); _df.clear(); }

function slugify(name: string): string {
  const s = name.trim().toLowerCase().replace(/[^\w一-龥]+/g, '_').replace(/^_+|_+$/g, '');
  return s || ('skill_' + Date.now());
}

// 创建技能：写入 builtin/<slug>/SKILL.md，返回创建的 Skill
export function addSkill(input: { name: string; description?: string; trigger?: string; body?: string }): Skill {
  const id = slugify(input.name);
  const dir = path.join(SKILLS_DIR, id);
  const target = path.join(dir, 'SKILL.md');
  const fm = [
    '---',
    `name: ${input.name}`,
    `description: ${input.description || ''}`,
    ...(input.trigger ? [`trigger: ${input.trigger}`] : []),
    '---',
    '',
    input.body && input.body.trim() ? input.body.trim() : `# ${input.name}\n\n在此描述该技能的详细执行步骤。`,
  ].join('\n');
  // 幂等注册（2026-08-13）：目标已存在且内容完全一致 → 跳过写盘，避免引擎每次启动
  // 都重写 SKILL.md 造成 mtime 噪音；内容不一致（用户已编辑）→ 不覆盖，保留用户版本。
  if (fs.existsSync(target)) {
    try {
      const old = fs.readFileSync(target, 'utf8');
      if (old === fm) {
        clearSkillCache();
        return getSkills().find(s => s.dir === dir) || getSkills().slice(-1)[0];
      }
      console.log(`[addSkill] 跳过覆盖 ${input.name}：目标已存在且内容被用户修改过，保留现有版本`);
      clearSkillCache();
      return getSkills().find(s => s.dir === dir) || getSkills().slice(-1)[0];
    } catch { /* 读取失败则继续正常写入 */ }
  }
  ensureDir(dir);
  fs.writeFileSync(target, fm, 'utf8');
  clearSkillCache();
  return getSkills().find(s => s.dir === dir) || getSkills().slice(-1)[0];
}

// 按技能名删除
export function removeSkill(name: string): boolean {
  const sk = getSkills().find(s => s.name === name);
  if (!sk) return false;
  try { fs.rmSync(sk.dir, { recursive: true, force: true }); clearSkillCache(); return true; } catch { return false; }
}

// 从用户文本抽取检索 token：英文按词，中文按串并通过别名表展开成英文关键词
function extractUserTokens(text: string): Set<string> {
  const tokens = new Set<string>();
  for (const m of text.toLowerCase().matchAll(/[a-z0-9_]+/g)) {
    if (m[0].length >= 2) tokens.add(m[0]);
  }
  for (const m of text.matchAll(/[一-龥]+/g)) {
    const zh = m[0];
    tokens.add(zh);
    for (const key of Object.keys(ALIASES)) {
      if (zh.includes(key)) for (const sym of ALIASES[key]) tokens.add(sym);
    }
  }
  return tokens;
}

function scoreSkill(s: Skill, tokens: Set<string>): number {
  const toks = _tokens.get(s.dir);
  if (!toks) return 0;
  let score = 0;
  for (const t of tokens) if (toks.has(t)) score += idf(t); // 稀有 token 权重高，抑制 generate/edit 等泛化词
  return score;
}

// 注入到系统提示中的技能索引（渐进式披露 / progressive disclosure，借鉴 dasha）。
// 只注入"名称 + 一句描述"的紧凑索引（按当前请求相关性排序、按粗分类分组、限量），
// 绝不把 141 个技能的正文一股脑灌进上下文（那才是此前"上下文炸弹→模型迷失→fs_* 死循环"的根因）。
// 完整执行步骤通过 use_skill(name) 按需加载为工具结果——这是关键：模型先看到轻量索引，
// 命中后用一次工具调用拿到该技能的详细步骤，而非凭空猜测或反复 fs_read 找参考文件。
const MAX_INJECT = 16;
export function skillsSystemPrompt(userText?: string): string {
  const skills = getSkills();
  if (!skills.length) return '';
  let selected = skills;
  const text = (userText || '').slice(0, 2000);
  if (text.trim()) {
    const tokens = extractUserTokens(text);
    if (tokens.size) {
      const scored = skills
        .map(s => ({ s, score: scoreSkill(s, tokens) }))
        .filter(x => x.score > 0)
        .sort((a, b) => b.score - a.score);
      if (scored.length) {
        const seen = new Set<string>();
        selected = scored
          .slice(0, MAX_INJECT * 2)
          .map(x => x.s)
          .filter(s => { if (seen.has(s.name)) return false; seen.add(s.name); return true; })
          .slice(0, MAX_INJECT);
      } else {
        // 无关键词命中：回退核心技能，避免完全无技能可用
        selected = skills.filter(s => s.trigger || /summar?ize|总结|摘要/i.test(s.name + s.description));
      }
    }
  }

  // 按粗分类分组输出紧凑索引
  const buckets = new Map<string, Skill[]>();
  for (const s of selected) {
    const c = s.category || '其他';
    if (!buckets.has(c)) buckets.set(c, []);
    buckets.get(c)!.push(s);
  }
  const lines: string[] = [];
  for (const c of CATEGORY_ORDER) {
    const arr = buckets.get(c);
    if (!arr || !arr.length) continue;
    lines.push(`- ${c}: ` + arr.map(s => `${s.name}（${s.description}）`).join('；'));
  }
  const indexBlock = lines.join('\n');

  return [
    '',
    '【可用技能（按需选用，共 ' + skills.length + ' 个，下方列出与本次请求可能相关的 ' + selected.length + ' 个；完整清单见 list_skills）】',
    indexBlock,
    '',
    '选用建议：请基于"任务目标 ↔ 技能用途"的匹配来选，而不是被名字里的关键词带偏。带脚本的技能已自动注册为 skill_<slug> 工具（如 skill_pdf / skill_comfyui / skill_arxiv / skill_docx），可直接 function-call 执行，无需先 use_skill；纯方法论类技能仍用 use_skill(名称) 取正文后按步骤执行。',
    '普通文件读写/列目录请用 fs_read / fs_write / fs_list，不要套用技能工具。生成 Office 文档可用 create_docx/create_pdf/create_xlsx/create_pptx；若某 skill_ 工具确属该文档领域则优先用它。',
    '',
  ].join('\n');
}

// 复用已有的 IDF 打分逻辑，返回与用户请求最匹配的技能（模型无关的服务端意图路由）。
// 把"该用哪个技能"这一步从模型大脑挪到服务器——模型无需自己悟出关联，
// 系统提示会直接告诉它"本次最可能匹配的技能"，从而真正"主动调用合适的技能"而非退化到 fs_write。
export function topSkillFor(query: string): { name: string; description: string; score: number } | null {
  const skills = getSkills();
  if (!skills.length) return null;
  const text = (query || '').slice(0, 2000);
  const tokens = extractUserTokens(text);
  if (!tokens.size) return null;
  let best: Skill | null = null;
  let bestScore = 0;
  for (const s of skills) {
    const sc = scoreSkill(s, tokens);
    if (sc > bestScore) { bestScore = sc; best = s; }
  }
  if (!best || bestScore <= 0) return null;
  return { name: best.name, description: best.description, score: bestScore };
}

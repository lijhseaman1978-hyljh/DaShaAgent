import fs from 'node:fs';

import path from 'node:path';

import { registry } from './registry';

import { getSkills } from '../skills/loader';

import { listMarketplace, installSkill, publishSkill } from '../skills/marketplace/registry';

import { fileURLToPath } from 'node:url';



// ESM 兼容（package.json type=module）：Node ESM 无全局 __dirname，

// 必须用 import.meta.url 自行推导（与 skills/loader.ts、config/system.ts 同一模式）。

// 修复 use_skill 报错：技能不在主列表时走 refDir 分支会裸用 __dirname → ReferenceError。

const __dirname = path.dirname(fileURLToPath(import.meta.url));



// 让"技能"成为真正可调用、可执行的工具。

// 之前技能只是作为文本被注入 system prompt，模型看到技能描述却没有任何工具能执行它，

// 导致遇到"生成WORD/用某技能"类任务时无路可走，只能反复调用 fs 工具直到 MAX_ITER。

// 本工具使模型能通过 use_skill(name) 拉取技能的完整执行说明（SKILL.md 正文）与可用脚本，

// 进而按说明用 fs 工具 / 自定义插件 / create_docx 等把任务真正做出来。



// 环境适配说明（与 use_skill 返回的一致）：明确本 harness 可用/不可用工具，避免模型去调不存在的工具或猜路径。

const HARNESS_NOTE =

  '本环境可用工具：fs_read/fs_write/fs_list（文件）、use_skill / list_skills（技能说明）、skill_<名字> 专用技能工具（如 skill_arxiv / skill_docx / skill_agnes_ai_generation，直接执行对应技能，仅在任务确属该技能领域时优先调用）、run_skill_script（低层回退：仅在无对应 skill_ 工具时按名运行某技能脚本）、create_docx/create_pdf/create_xlsx/create_pptx（生成办公文档）、记忆工具（save_note/save_profile）。' +

  '调用优先：任务若由某个 skill_<名字> 工具直接覆盖，请直接调用该 skill_ 工具，不要绕去 run_skill_script。run_skill_script 仅在无对应 skill_ 工具、且明确知道 skill + script 时才用（必须提供这两个参数）。' +

  '注意：为节省上下文，skill_<名字> 工具默认只展开与当前任务相关的少数几个，其余列在 tool_search 描述的 <deferred_tools> 目录里；当前 tools 列表中找不到所需技能工具时，用 tool_search（传 tool_names 或 queries）把它加载进来再调用，不要因为"列表里没有"就判定做不到。' +

  '本技能原指令中若出现 skill_view / terminal / execute_code / session_search / write_file / delegate_task 等工具名，本环境【不存在】，请勿调用。' +

  '需要读取本技能的参考文件，请用 fs_read 打开下面 files 列表中给出的绝对路径；生成 Word 用 create_docx、PDF 用 create_pdf、Excel 用 create_xlsx、PPT 用 create_pptx。' +

  '禁止为寻找参考文件而用不同路径反复 fs_read 猜测——所需路径已在 files 中直接给出。';



// 把 dasha 技能正文里指向"本 harness 不存在的工具"的名字替换成可用等价物，

// 避免模型照着 skill_view / terminal 等名字去调用不存在的工具而卡死或退化到 fs_* 空转。

function adaptBody(body: string): string {

  return (body || '')

    .replace(/\bskill_view\b/g, 'use_skill')

    .replace(/\bexecute_code\b/g, '（本环境请用 run_skill_script 运行技能脚本，或用 create_* 生成文档）')

    .replace(/\bdelegate_task\b/g, '（本环境不支持委派子任务，请直接完成）')

    .replace(/\bsession_search\b/g, '（本环境请用记忆/RAG 工具检索，而非 session_search）')

    .replace(/\bwrite_file\b/g, 'fs_write（仅限纯文本；生成 Office 文档请用 create_*）');

}



// 列出技能目录下所有文件（参考/模板/脚本）的绝对路径，让模型能直接 fs_read 打开，不必猜测。

function listSkillFiles(dir: string): string[] {

  const files: string[] = [];

  const walk = (d: string) => {

    let ents: fs.Dirent[] = [];

    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }

    for (const e of ents) {

      if (e.name.startsWith('.')) continue;

      const p = path.join(d, e.name);

      if (e.isDirectory()) walk(p);

      else files.push(p);

    }

  };

  try { walk(dir); } catch { /* ignore */ }

  return files;

}



// 仅列出顶层脚本（scripts/*.py|sh|js|ts|bat|ps1 或目录根下的脚本），避免把几十个参考文件一股脑灌进上下文。

function listTopLevelScripts(dir: string): string[] {

  const out: string[] = [];

  const pushIfScript = (p: string) => {

    if (/\.(py|sh|js|ts|bat|ps1)$/i.test(p)) out.push(p);

  };

  let ents: fs.Dirent[] = [];

  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }

  for (const e of ents) {

    if (e.name.startsWith('.')) continue;

    const p = path.join(dir, e.name);

    if (e.isDirectory()) {

      if (e.name.toLowerCase() === 'scripts') {

        let sub: fs.Dirent[] = [];

        try { sub = fs.readdirSync(p, { withFileTypes: true }); } catch { continue; }

        for (const s of sub) if (!s.name.startsWith('.')) pushIfScript(path.join(p, s.name));

      }

    } else {

      pushIfScript(p);

    }

  }

  return out;

}



// 供 agentLoop 在检测到办公意图时【自动】把 offline-office 的"环境适配版"极简指引注入系统提示。

// 注意：只注入高信号铁规（署名 / 生成 Word 用 create_docx / 禁用不存在的工具 / 禁猜路径），

// 不灌完整 40KB 正文与 51 条参考路径——避免压垮弱模型导致其放弃 create_docx 而空转。

// 完整说明仍可通过 use_skill('offline-office') 按需获取。

export function getOfflineOfficeGuidance(): string {

  return [

    '【办公套件规则 offline-office（已按用户强制要求自动加载）】',

    HARNESS_NOTE,

    '',

    '关键铁规（来自用户要求，必须遵守）：',

    '1. 生成文档：Word 用 create_docx、PDF 用 create_pdf、Excel 用 create_xlsx、PPT 用 create_pptx（均无需读参考、无需 python，支持 Markdown 结构）。不要用 fs_write 写入这些格式。',

    '2. 本环境【不存在】skill_view / terminal / execute_code / session_search / write_file / delegate_task，请勿调用。若任务由某个 skill_<名字> 工具直接覆盖，优先调用它；仅当无对应 skill_ 工具、且明确知道技能名与脚本名时，才用 run_skill_script（必须传入 skill + script），读参考文件用 fs_read 打开 use_skill 返回的绝对路径。',

    '3. 禁止为寻找参考文件而用不同路径反复 fs_read 猜测——所需路径由 use_skill 直接给出。',

    '4. 署名规则：定时任务发送的邮件/博客统一署名「示例用户」；普通对话任务按用户要求署名。',

    '5. 交付标准：文档须真正保存成功且内容完整（无占位符），不可只说"已生成"而不实际调用工具。',

  ].join('\n');

}



export function registerSkillTool() {

  // 列出全部已安装技能（名称 + 描述）。用于"你有哪些技能 / 你能做什么 / 列出已安装技能"等查询。

  registry.register(

    {

      name: 'list_skills',

      description:

        '列出本智能体已安装的全部技能（名称 + 一句话描述）。当用户询问"你有哪些技能 / 你能做什么 / 列出已安装技能"时使用本工具；系统提示中的【可用技能】列表也可直接回答。',

      parameters: { type: 'object', properties: {}, required: [] },

    },

    () => {

      const skills = getSkills();

      return {

        count: skills.length,

        skills: skills.map(s => ({ name: s.name, description: s.description })),

      };

    }

  );



  registry.register({

    name: 'use_skill',

    description:

      '获取指定技能的完整执行说明（SKILL.md 正文）与可用脚本列表。当某项任务需要使用某个技能（如写作/生图/总结/部署/排版等）但仅靠一句话描述不够时，调用本工具拿到详细步骤，再按步骤用其他工具执行。技能名称见系统提示中的【可用技能】列表。若不传 name，则返回全部已安装技能清单。',

    parameters: {

      type: 'object',

      properties: {

        name: { type: 'string', description: '技能名称（来自系统提示【可用技能】列表，支持精确名或包含匹配）；留空则返回全部技能清单' },

      },

      required: [],

    },

  }, (args: any) => {

    const skills = getSkills();

    const q = String(args.name || '').toLowerCase();

    if (!q) {

      // 未提供技能名：返回已安装技能清单（让"列出/查看已安装技能"成为一次干净的成功调用，

      // 而不必退化到 fs_write 去"把列表写进文件"——那正是此前反复 fs_write 循环的诱因之一）。

      return {

        note: '未提供技能名，返回已安装技能清单。如需某技能的完整执行步骤，请带 name 再次调用。',

        count: skills.length,

        skills: skills.map(s => ({ name: s.name, description: s.description })),

      };

    }

    const s =

      skills.find(x => x.name.toLowerCase() === q) ||

      skills.find(x => x.name.toLowerCase().includes(q));

    if (!s) {

      // P1-2: 技能不在主列表中时，检查是否为工具参考指南（tools/references/）

      const refDir = path.join(path.dirname(__dirname), 'tools', 'references');

      const refName = q.replace(/_/g, '-').replace(/\.md$/, '');

      const refPath = path.join(refDir, refName + '.md');

      try {

        if (fs.existsSync(refPath)) {

          const content = fs.readFileSync(refPath, 'utf-8');

          return {

            name: refName,

            description: '工具参考手册（DaShaAgent 环境适配版）',

            type: 'reference',

            instructions: content,

            note: '以上为此工具/领域的完整使用指南。按指南中的建议选择正确工具和参数。',

          };

        }

      } catch { /* 忽略参考文件读取错误 */ }

      return { error: `未找到技能「${args.name}」`, available: skills.map(x => x.name) };

    }

    // 默认即返回【精简摘要 + 顶层脚本 + 该技能全部参考文件的绝对路径】(files)。

    // 关键：把绝对路径直接交给模型，它就不必用不同路径反复 fs_read 猜测——这正是此前

    // "调用 use_skill 后陷入 fs_read 死循环"的根因。完整 SKILL.md 正文按需用 full:true 获取。

    const scripts = listTopLevelScripts(s.dir);

    const allFiles = listSkillFiles(s.dir);

    const MAX_FILES = 40; // 极端技能可能有几十个参考文件，截断避免压垮上下文

    const files = allFiles.slice(0, MAX_FILES);

    const summary = adaptBody(s.body || '').replace(/\s+/g, ' ').trim().slice(0, 1200);

    const out: any = {

      name: s.name,

      description: s.description,

      dir: s.dir,

      scripts,

      files,

      fileCount: allFiles.length,

      truncatedFiles: allFiles.length > MAX_FILES,

      harnessNote: HARNESS_NOTE,

      summary,

      note: '已直接给出本技能参考文件的绝对路径（files），请用 fs_read 打开其中需要的，不要猜测路径。需要完整 SKILL.md 正文请传 full:true。',

    };

    if (args.full === true || args.full === 'true') {

      out.instructions = adaptBody(s.body);

      out.files = allFiles;

    }

    return out;

  });



  // ── 技能市场工具（2026-08-15 生态扩展）──

  // 让模型能直接浏览/安装/发布社区技能，而无需手写 curl。



  registry.register({

    name: 'marketplace_list',

    description:

      '浏览技能市场（社区分享注册中心）的可用技能列表。支持按关键词 q、分类 category、标签 tag 过滤，按 sort（popular/rating/newest/name）排序，installedOnly 仅看已安装。当用户说"市场里有什么技能 / 社区技能 / 安装个技能 / 看看能装什么"时使用。返回技能条目（含 slug/名称/描述/分类/权限/信任级/是否已安装/危险标记）。',

    parameters: {

      type: 'object',

      properties: {

        q: { type: 'string', description: '关键词（匹配名称/描述/标签/分类）' },

        category: { type: 'string', description: '分类过滤（如 文档/写作、图像/视频）；传 "all" 或留空表示全部' },

        tag: { type: 'string', description: '标签过滤' },

        sort: { type: 'string', description: '排序：popular(默认) | rating | newest | name' },

        installedOnly: { type: 'boolean', description: '仅列出已安装的技能' },

      },

      required: [],

    },

  }, (args: any) => {

    try {

      const list = listMarketplace({

        q: args.q, category: args.category, tag: args.tag,

        sort: args.sort, installedOnly: args.installedOnly === true,

      });

      return {

        count: list.length,

        skills: list.map(e => ({

          slug: e.slug, name: e.name, description: e.description, category: e.category,

          tags: e.tags, trust: e.trust, permissions: e.permissions, installed: e.installed,

          rating: e.rating, ratingsCount: e.ratingsCount, dangerFlags: e.dangerFlags || [],

        })),

      };

    } catch (e: any) { return { error: e?.message }; }

  });



  registry.register({

    name: 'install_skill',

    description:

      '从技能市场安装一个技能到本机（skills/installed/<slug>/），随后自动进入 use_skill 可用列表。须提供 slug（来自 marketplace_list 的 slug 字段）。安装前会校验包完整性 sha256 并扫描危险脚本，市场技能默认以沙箱(sandboxed)信任级运行。当用户说"安装这个技能 / 装一下 XX"时使用。',

    parameters: {

      type: 'object',

      properties: {

        slug: { type: 'string', description: '技能 slug（marketplace_list 返回的 slug）' },

      },

      required: ['slug'],

    },

  }, async (args: any) => {

    if (!args.slug) return { error: 'slug 必填' };

    try {

      const entry = await installSkill(String(args.slug));

      return {

        ok: true, installed: true, slug: entry.slug, name: entry.name, trust: entry.trust,

        permissions: entry.permissions, dangerFlags: entry.dangerFlags || [],

        note: entry.trust === 'sandboxed'

          ? '已以沙箱信任级安装，运行受限（无网络/越界文件写/未授权 shell）。如需放开，请由发布方在 manifest 声明 trust=trusted 并经用户授权。'

          : '已以 trusted 信任级安装。',

      };

    } catch (e: any) { return { error: e?.message }; }

  });



  registry.register({

    name: 'publish_skill',

    description:

      '把一个技能发布到本地技能市场注册中心（打成 .skill 包、sha256 校验、危险脚本扫描并写入 registry.json），供他人 install。可复制已有技能（提供 slug 或 name），或直接新建（提供 name + body）。当用户说"把这个技能发布到市场 / 分享这个技能 / 上传技能"时使用。',

    parameters: {

      type: 'object',

      properties: {

        slug: { type: 'string', description: '要发布的已有技能名/slug（复制模式）' },

        name: { type: 'string', description: '新建模式技能名；复制模式可省略（沿用来源）' },

        version: { type: 'string', description: '版本号，默认 1.0.0' },

        author: { type: 'string', description: '作者标识，默认 local' },

        description: { type: 'string', description: '一句话描述' },

        body: { type: 'string', description: '新建模式：SKILL.md 正文' },

        tags: { type: 'array', description: '标签数组' },

        category: { type: 'string', description: '分类' },

        permissions: { type: 'object', description: '声明能力 {network,fileWrite,shell}（默认全 false）' },

        trust: { type: 'string', description: '信任级 trusted | sandboxed（默认 sandboxed）' },

      },

      required: [],

    },

  }, async (args: any) => {

    try {

      const entry = await publishSkill({

        slug: args.slug, name: args.name, version: args.version, author: args.author,

        description: args.description, body: args.body, tags: args.tags, category: args.category,

        permissions: args.permissions, trust: args.trust,

      });

      return {

        ok: true, slug: entry.slug, name: entry.name, version: entry.version,

        packagePath: entry.packagePath, sha256: entry.sha256, dangerFlags: entry.dangerFlags || [],

        note: entry.dangerFlags?.length

          ? '已发布，但扫描到 ' + entry.dangerFlags.length + ' 处危险脚本标记，安装方会收到警示。'

          : '已发布（未检出危险脚本）。',

      };

    } catch (e: any) { return { error: e?.message }; }

  });

}


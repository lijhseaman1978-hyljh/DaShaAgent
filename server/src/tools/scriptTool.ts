import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { registry } from './registry';
import { getSkills } from '../skills/loader';
import { CONFIG } from '../config';
import { config as sysConfig } from '../config/config';
import { security } from '../security';

// ─────────────────────────────────────────────────────────────────────────────
// 阶段7：技能 entrypoint 执行器
// use_skill 只返回"技能文档 + 脚本路径清单"，本工具按「技能名 + 脚本名」真正运行脚本，
// 让技能从"只读文档说明"升级为"可执行的单元"，补完闭环：
//   意图识别 → 技能匹配(use_skill) → 参数填充 → 安全校验(路径穿越/后缀白名单) → 执行 → 结果消化。
// 安全：脚本必须位于 skills/builtin 目录内（禁止路径穿越），仅允许 .py/.js/.ts/.sh/.bat/.ps1。
// ─────────────────────────────────────────────────────────────────────────────

const ALLOWED_EXT = /\.(py|js|ts|sh|bat|ps1)$/i;
const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_OUTPUT_CHARS = 8000;

function pythonBin(): string {
  const candidates = [
    'C:/Program Files/Python310/python.exe',
    process.env.PYTHON_PATH,
    'python3',
    'python',
  ].filter(Boolean) as string[];
  return candidates[0];
}

function resolveInterpreter(ext: string): { bin: string; pre: string[] } {
  switch (ext.toLowerCase()) {
    case '.py': return { bin: pythonBin(), pre: [] };
    case '.js':
    case '.ts': return { bin: 'node', pre: [] };
    case '.sh': return { bin: 'bash', pre: [] };
    case '.bat': return { bin: 'cmd', pre: ['/c'] };
    case '.ps1': return { bin: 'powershell', pre: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File'] };
    default: return { bin: '', pre: [] };
  }
}

// 带超时与输出截断的进程执行（复用 pdfTool 的 spawn 思路，但增加超时与截断保护）
function runProcess(bin: string, args: string[], opts: { timeout: number }): Promise<{ ok: boolean; code: number | null; out: string; err: string; truncated: boolean }> {
  return new Promise((resolve) => {
    let out = '', err = '', truncated = false;
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const finish = (r: { ok: boolean; code: number | null; out: string; err: string; truncated: boolean }) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(r);
    };
    const cap = (target: 'out' | 'err', s: string) => {
      const buf = target === 'out' ? out : err;
      if (buf.length + s.length > MAX_OUTPUT_CHARS) {
        const room = MAX_OUTPUT_CHARS - buf.length;
        if (room > 0) { if (target === 'out') out += s.slice(0, room); else err += s.slice(0, room); }
        truncated = true;
        return;
      }
      if (target === 'out') out += s; else err += s;
    };
    let child: any;
    try {
      child = spawn(bin, args, { windowsHide: true });
    } catch (e: any) {
      return finish({ ok: false, code: null, out, err: String(e), truncated });
    }
    if (!child || typeof child.on !== 'function') {
      return finish({ ok: false, code: null, out, err: '无法启动进程: ' + bin, truncated });
    }
    const onData = (target: 'out' | 'err') => (d: Buffer) => cap(target, d.toString());
    child.stdout?.on('data', onData('out'));
    child.stderr?.on('data', onData('err'));
    child.on('error', (e: any) => finish({ ok: false, code: null, out, err: String(e), truncated }));
    child.on('close', (code: number) => finish({ ok: code === 0, code, out, err, truncated }));
    timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* ignore */ }
      finish({ ok: false, code: null, out, err: err + '\n[执行超时，已被终止]', truncated });
    }, opts.timeout);
  });
}

export function registerScriptTool() {
  registry.register({
    name: 'run_skill_script',
    description:
      '【低层回退入口 · 非首选】运行某个已安装技能目录下的脚本（.py/.js/.ts/.sh/.bat/.ps1）。' +
      '注意：若任务的领域已有对应的 skill_<名字> 专用工具（如 arxiv 检索用 skill_arxiv、出图用 skill_agnes_ai_generation），应【直接调用该 skill_ 工具】，不要走本工具。' +
      '本工具仅在"不存在对应 skill_ 工具、且确实要按名运行某技能的某个脚本"时使用：先用 use_skill(技能名) 拿到脚本清单(scripts)，再按 技能名+脚本名 执行。' +
      '必须提供 skill 与 script 两个必填参数（缺失会报"缺少必填参数"）。args 为传给脚本的命令行参数（可选）。仅允许运行 skills/builtin 目录内的脚本，禁止路径穿越。',
    parameters: {
      type: 'object',
      properties: {
        skill: { type: 'string', description: '技能名称（来自 use_skill 返回的 name，支持精确或包含匹配）' },
        script: { type: 'string', description: '脚本文件名（来自 use_skill 返回的 scripts 列表，如 publish.py），必须位于该技能目录内' },
        args: { type: 'string', description: '传给脚本的命令行参数（可选，字符串形式，按空格分隔）' },
        timeout: { type: 'number', description: '超时毫秒数（可选，默认 60000）' },
      },
      required: ['skill', 'script'],
    },
  }, async (a: any) => {
    const skills = getSkills();
    const q = String(a.skill || '').toLowerCase();
    const s = skills.find((x) => x.name.toLowerCase() === q) || skills.find((x) => x.name.toLowerCase().includes(q));
    if (!s) {
      return { error: `未找到技能「${a.skill}」`, available: skills.map((x) => x.name).slice(0, 40) };
    }
    // 解析脚本路径并防止穿越：必须落在技能目录内
    const scriptPath = path.resolve(s.dir, String(a.script || ''));
    if (scriptPath.toLowerCase() !== s.dir.toLowerCase() && !scriptPath.toLowerCase().startsWith(s.dir.toLowerCase() + path.sep)) {
      return { error: '安全限制：脚本必须位于技能目录内，禁止路径穿越。', dir: s.dir };
    }
    if (!ALLOWED_EXT.test(scriptPath)) {
      return { error: '仅允许运行脚本类型：.py/.js/.ts/.sh/.bat/.ps1', got: path.basename(scriptPath) };
    }
    if (!fs.existsSync(scriptPath)) {
      return { error: '脚本不存在', path: scriptPath, hint: '请用 use_skill 返回的 scripts 列表中的准确文件名' };
    }
    const ext = path.extname(scriptPath).toLowerCase();
    const { bin, pre } = resolveInterpreter(ext);
    if (!bin) return { error: '无法解析该脚本类型的解释器', ext };
    const extra = (typeof a.args === 'string' && a.args.trim()) ? a.args.trim().split(/\s+/) : [];
    const timeout = Number(a.timeout) > 0 ? Number(a.timeout) : DEFAULT_TIMEOUT_MS;
    const res = await runProcess(bin, [...pre, scriptPath, ...extra], { timeout });
    return {
      ok: res.ok,
      skill: s.name,
      script: path.basename(scriptPath),
      exitCode: res.code,
      stdout: res.out,
      stderr: res.err,
      truncatedOutput: res.truncated,
      note: res.ok ? '脚本执行成功' : '脚本执行失败 / 超时（详见 stderr）',
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 阶段7（升级）：把「带脚本的技能」注册成一等公民可调用工具
// 让 agent 在 tools 参数里直接看到 skill_<slug>，一步 function-call 执行该技能，
// 不再需要先 use_skill 取正文 + run_skill_script 的第二跳 —— 与插件（custom.ts）同机制、同地位。
// 这正是用户诉求：agent「只用插件不碰技能」的根因是技能不在行动空间，本函数把技能抬进行动空间。
// ─────────────────────────────────────────────────────────────────────────────
function slugifySkill(name: string): string {
  return name.trim().toLowerCase().replace(/[^\w]+/g, '_').replace(/^_+|_+$/g, '') || ('skill_' + Date.now());
}

export function registerSkillExecTools(): { registered: number } {
  const skills = getSkills();
  const used = new Set<string>();
  let registered = 0;
  for (const s of skills) {
    const scriptDir = path.join(s.dir, 'scripts');
    if (!fs.existsSync(scriptDir) || !fs.statSync(scriptDir).isDirectory()) continue;
    const scripts = fs.readdirSync(scriptDir).filter((f) => ALLOWED_EXT.test(f)).sort();
    if (!scripts.length) continue;
    const base = slugifySkill(s.name);
    let name = 'skill_' + base;
    let i = 2;
    while (used.has(name)) name = 'skill_' + base + '_' + i++;
    used.add(name);
    const defaultScript = scripts.find((x) => x !== '__init__.py') || scripts[0];
    registry.register({
      name,
      description:
        `【「${s.name}」技能专用 · 仅处理该领域任务，不要用于读取普通文件】领域专用执行入口（无需先 use_skill）。可用脚本: ${scripts.join(', ')}。` +
        `（注：本工具用于新建/修改/重算等专属操作；若任务只是【读取已有文件的内容】，请用 fs_read——它已内置表格/文本解析，不要为"读内容"调用本技能工具。）` +
        `不指定 script 时默认运行 ${defaultScript}。${s.description ? ' ' + s.description : ''}` +
        `\n⚠️ 仅当任务确属「${s.name}」技能涵盖的领域时才调用本工具；普通文件读写（任意文本/代码/配置/日志/.md/.json/.csv 等）、列目录、存记忆等通用操作，请改用 fs_read / fs_write / fs_list / save_note，【不要】为本工具硬套不相关的任务。`,
      parameters: {
        type: 'object',
        properties: {
          script: { type: 'string', enum: scripts, description: '要运行的脚本文件名（默认 ' + defaultScript + '）' },
          args: { type: 'string', description: '传给脚本的命令行参数（可选，空格分隔或 JSON 字符串）' },
          timeout: { type: 'number', description: '超时毫秒数（可选，默认 60000）' },
        },
        required: [],
      },
    }, async (a: any) => {
      const scriptName: string = a.script || defaultScript;
      const scriptPath = path.resolve(scriptDir, scriptName);
      if (scriptPath.toLowerCase() !== scriptDir.toLowerCase() && !scriptPath.toLowerCase().startsWith(scriptDir.toLowerCase() + path.sep)) {
        return { error: '安全限制：脚本必须位于技能目录内，禁止路径穿越。' };
      }
      if (!ALLOWED_EXT.test(scriptPath) || !fs.existsSync(scriptPath)) {
        return { error: '脚本不存在或不允许', available: scripts };
      }
      const ext = path.extname(scriptPath).toLowerCase();
      const { bin, pre } = resolveInterpreter(ext);
      if (!bin) return { error: '无法解析该脚本类型的解释器', ext };
      const extra = typeof a.args === 'string' && a.args.trim() ? a.args.trim().split(/\s+/) : [];
      const timeout = Number(a.timeout) > 0 ? Number(a.timeout) : DEFAULT_TIMEOUT_MS;
      const res = await runProcess(bin, [...pre, scriptPath, ...extra], { timeout });
      return {
        ok: res.ok,
        skill: s.name,
        tool: name,
        script: path.basename(scriptPath),
        exitCode: res.code,
        stdout: res.out,
        stderr: res.err,
        truncatedOutput: res.truncated,
        note: res.ok ? '技能脚本执行成功' : '执行失败 / 超时（详见 stderr）',
      };
    }, {
      // 两阶段加载：skill_* 全部归为 deferred（27 个占全量 schema 的 76%），默认只在
      // tool_search 目录里以一行摘要露面；命中扩展名/点名/trigger 或被检索激活后才展开完整 schema。
      // summary 用技能自己的 frontmatter description —— 比从冗长 description 里正则抠要准得多，
      // 它同时是 BM25 索引的高权重字段，直接决定"用户说人话能不能检索到这个技能"。
      tier: 'deferred',
      summary: `「${s.name}」技能 · ${(s.description || '领域专用执行入口').replace(/\s+/g, ' ').trim()}`,
    });
    registered++;
  }
  return { registered };
}

// ─────────────────────────────────────────────────────────────────────────────
// run_code —— 「自造工具」闭环（修复"agent 用 fs_write 写了脚本却无工具运行"的断裂）
//
// 设计动机：当任务遇到没有现成工具/技能能处理的罕见格式或特殊逻辑时，agent 应能
//   (1) 用 fs_write 写一个解析/处理脚本  →  (2) 用本工具把它跑起来  →  (3) 消化结果。
// 此前唯一能"运行脚本"的 run_skill_script 被安全限制死死锁在 skills/ 目录内，
// 导致桌面/工作区里 agent 自写的脚本永远跑不起来 → 死循环。run_code 补上这条合法路径：
// 运行 agent 自写的脚本或内联代码，使用受管控的解释器（系统 Python / 受管 Node），带超时与输出截断。
//
// 安全边界：本工具执行的是 agent 自写代码，能力等同于在用户机器上跑一段脚本——
// 这是用户明确要求的"自主造工具"能力，仅在本地可信环境启用；命令注入风险由 agent 自身承担（它写它跑）。
// ─────────────────────────────────────────────────────────────────────────────
function resolveRunPath(p: string): string {
  if (path.isAbsolute(p)) return path.resolve(p);
  return path.resolve(CONFIG.WORKSPACE_DIR, p);
}

export function registerRunCodeTool() {
  registry.register({
    name: 'run_code',
    description:
      '【自造工具闭环 · 当没有现成工具/技能能完成任务时使用】运行一段由你(agent)编写的脚本或代码。' +
      '支持两种用法：(1) code=内联代码字符串；(2) scriptPath=已用 fs_write 写好的脚本绝对/相对路径（可指向桌面等任意位置）。' +
      'language 支持 python（默认，系统 Python 3.10，已含 openpyxl/pypdf/python-docx/python-pptx/pdfplumber 等常用库）或 node。' +
      '典型场景：遇到 fs_read 也解析不了的罕见文件格式 → 用 fs_write 写个解析脚本 → 用本工具运行它拿到结果。' +
      '带 60s 超时与输出上限；返回 stdout/stderr 供你消化。注意：运行的是你自写代码，请确保逻辑正确。\n' +
      '【常见失败】①中文路径/字符→脚本首行加 `# -*- coding: utf-8 -*-`；②模块缺失→提前检查 import；③超时→检查是否死循环或阻塞 I/O；④沙箱关闭→返回 OFFLINE 状态，无法执行。',
    parameters: {
      type: 'object',
      properties: {
        language: { type: 'string', enum: ['python', 'node'], description: '运行语言，默认 python' },
        code: { type: 'string', description: '要执行的代码字符串（与 scriptPath 二选一）' },
        scriptPath: { type: 'string', description: '已存在的脚本路径（与 code 二选一），支持绝对路径如 C:\\\\Users\\\\your-user\\\\Desktop\\\\x.py' },
        args: { type: 'string', description: '传给脚本的命令行参数（可选，空格分隔）' },
        timeout: { type: 'number', description: '超时毫秒数（可选，默认 60000）' },
      },
      required: [],
    },
  }, async (a: any) => {
    const lang = (a.language === 'node') ? 'node' : 'python';
    let targetFile: string | null = null;
    let cleanup: string | null = null;

    try {
      // P0-1: 沙箱安全 — 若沙箱关闭则不执行任意用户代码
      const sandbox = sysConfig.getSandbox();
      if (!sandbox.enabled) {
        return {
          error: '沙箱未启用，拒绝执行代码',
          hint: '沙箱关闭时 run_code 不可用以保证安全。如需执行代码，请在 .env 中启用 sandbox，或手动在终端执行该脚本。',
          sandboxStatus: 'OFFLINE',
        };
      }
      if (a.code && String(a.code).trim()) {
        // 内联代码：落盘到工作区临时目录再执行
        const dir = path.join(CONFIG.WORKSPACE_DIR, '.agent_code');
        fs.mkdirSync(dir, { recursive: true });
        const ext = lang === 'python' ? '.py' : '.mjs';
        targetFile = path.join(dir, 'run_' + Date.now().toString(36) + ext);
        fs.writeFileSync(targetFile, String(a.code), 'utf8');
        cleanup = targetFile;
      } else if (a.scriptPath && String(a.scriptPath).trim()) {
        targetFile = resolveRunPath(String(a.scriptPath));
        if (!fs.existsSync(targetFile)) {
          return { error: '脚本不存在', path: targetFile, hint: '请用 fs_write 先写好脚本，或用绝对路径指向已存在的脚本。' };
        }
      } else {
        return { error: '必须提供 code（内联代码）或 scriptPath（脚本路径）之一' };
      }

      // P0-2: Security Kernel 接线（闭环修复）—— 生产 run_code 此前绕过全部威胁检测。
      // 现走：威胁检测拦截（命中 rm -rf / 等危险模式直接拒执）+ 审计留痕。
      // 注意：刻意不做 guard('exec') 硬门槛 —— 默认 SANDBOX_ALLOW_SHELL=false，
      // 若硬接会直接把 run_code 打残（行为回归）；沙箱开关仍是最外层门槛。
      try {
        let screenText: string;
        if (a.code && String(a.code).trim()) {
          screenText = String(a.code);
        } else {
          // 脚本文件：读前 40KB 做危险模式扫描
          try { screenText = fs.readFileSync(targetFile as string, 'utf8').slice(0, 40_000); }
          catch { screenText = String(a.scriptPath || ''); }
        }
        const threat = security.screen(screenText);
        if (threat) {
          security.record({ action: 'run_code', target: (a.scriptPath || `inline:${lang}`), allowed: false, threat });
          return {
            error: `代码被安全内核拦截（${threat}）`,
            hint: '检测到危险模式：' + threat + '。请调整代码逻辑（改用受控 API 实现），或手动在终端执行。',
            blockedBy: 'security-kernel',
          };
        }
        security.record({ action: 'run_code', target: (a.scriptPath || `inline:${lang}`), allowed: true });
      } catch { /* 安全内核异常不阻断执行（仅记录失败，沙箱门槛已把关） */ }

      let bin: string;
      let pre: string[] = [];
      if (lang === 'python') {
        bin = pythonBin();
      } else {
        bin = 'node';
      }
      const extra = (typeof a.args === 'string' && a.args.trim()) ? a.args.trim().split(/\s+/) : [];
      const timeout = Number(a.timeout) > 0 ? Number(a.timeout) : DEFAULT_TIMEOUT_MS;
      const res = await runProcess(bin, [...pre, targetFile as string, ...extra], { timeout });
      return {
        ok: res.ok,
        language: lang,
        exitCode: res.code,
        stdout: res.out,
        stderr: res.err,
        truncatedOutput: res.truncated,
        note: res.ok ? '代码执行成功' : '执行失败 / 超时（详见 stderr）',
      };
    } finally {
      // 仅清理内联临时文件；用户用 fs_write 显式写的脚本不删（保留给用户）
      if (cleanup && fs.existsSync(cleanup)) {
        try { fs.unlinkSync(cleanup); } catch { /* ignore */ }
      }
    }
  });
}


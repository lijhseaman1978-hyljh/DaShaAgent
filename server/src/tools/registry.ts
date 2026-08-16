import type { ToolDef, ToolCall, ToolContext } from '../core/types';
import { validateArgs } from './validate';
import { getSkills } from '../skills/loader';

// 可靠信号 → 文档类 skill 映射（基于文件扩展名，零歧义；这是"候选集收窄"的核心依据）
const EXT_SKILL: Array<{ re: RegExp; skill: string }> = [
  { re: /\.(xlsx|xlsm|csv|tsv)(\b|\s|$)/i, skill: 'skill_xlsx' },
  { re: /\.(docx)(\b|\s|$)/i, skill: 'skill_docx' },
  { re: /\.(pdf)(\b|\s|$)/i, skill: 'skill_pdf' },
  { re: /\.(pptx)(\b|\s|$)/i, skill: 'skill_pptx' },
];

// 工具执行函数签名：接收已解析的参数 + 上下文，返回可序列化的结果对象。
export type ToolFn = (args: any, ctx: ToolContext) => Promise<any> | any;

// 工具分级（两阶段加载的基础，详见 toolSearch.ts）：
//   core     —— 始终出现在模型的 tools 数组里，随时可调（fs_* / run_code / create_* 等）
//   deferred —— 默认只以"一行摘要"形式出现在 tool_search 目录中，需检索加载后才能调用
export type ToolTier = 'core' | 'deferred';

export interface RegisterOpts {
  tier?: ToolTier;
  /** 一句话用途，用于 tool_search 的检索索引与目录展示。不给则从 description 自动提取。 */
  summary?: string;
}

interface RegisteredTool {
  def: ToolDef;
  fn: ToolFn;
  tier: ToolTier;
  summary?: string;
}

// 从冗长的 description 里抠出一句话用途：去掉开头的【…】标注块与括号补充，取首句。
function deriveSummary(desc: string): string {
  let s = (desc || '').replace(/^【[^】]*】/, '').trim();
  s = s.split(/\n/)[0];
  s = s.replace(/（[^）]*）/g, '');
  const m = s.split(/[。;；]/).filter((x) => x.trim().length > 0)[0] || s;
  return m.trim().slice(0, 90);
}

class ToolRegistry {
  private map = new Map<string, RegisteredTool>();
  // 索引失效信号：每次注册/注销自增，供 toolSearch 判断 BM25 索引要不要重建
  private _version = 0;
  get version(): number { return this._version; }

  register(def: ToolDef, fn: ToolFn, opts: RegisterOpts = {}) {
    // 默认分级：skill_* 一律 deferred（27 个占了 76% 的 schema 体积，正是要延后的部分），
    // 其余默认 core。调用方可用 opts.tier 显式覆盖。
    const tier: ToolTier = opts.tier ?? (def.name.startsWith('skill_') ? 'deferred' : 'core');
    this.map.set(def.name, { def, fn, tier, summary: opts.summary });
    this._version++;
  }

  list(): ToolDef[] {
    return [...this.map.values()].map(t => t.def);
  }

  getDef(name: string): ToolDef | undefined { return this.map.get(name)?.def; }

  tierOf(name: string): ToolTier { return this.map.get(name)?.tier ?? 'core'; }

  summaryOf(name: string): string {
    const t = this.map.get(name);
    if (!t) return '';
    if (t.summary === undefined) t.summary = deriveSummary(t.def.description); // 懒计算并缓存
    // 长度封顶：summary 在 BM25 里是 ×3 权重字段，若放任某些技能写 900 字的 description，
    // 文档长度会被撑爆，BM25 的长度归一化反过来狠狠惩罚它——skill_xlsx 检索不到就是这么来的。
    // 截断到 180 字符（描述的头部通常最具辨识度），完整正文仍以 ×1 权重进索引，召回不丢。
    if (t.summary.length > 180) t.summary = t.summary.slice(0, 180).trim() + '…';
    return t.summary;
  }

  deferredNames(): string[] {
    return [...this.map.values()].filter(t => t.tier === 'deferred').map(t => t.def.name);
  }

  deferredDefs(): ToolDef[] {
    return [...this.map.values()].filter(t => t.tier === 'deferred').map(t => t.def);
  }

  // 送进模型的工具清单。设计原则：服务器只提供"能力清单"，**不替模型做优先级决策**。
  // 是否调用某 skill_* 工具，由模型基于"任务目标 ↔ 工具用途"自行推理决定（详见 agentLoop 的思考协议）。
  // 因此这里仅做两件事：(1) 给通用工具/生成工具补一句**自描述**说明（用途边界，而非"优先"指令）；
  // (2) 把 skill_* 工具排在前面仅出于可见性（让模型"看得到"它们），不代表强制优先。
  // 注意：仅返回带说明的副本，原始 def 不动，execute() 内的 validateArgs 仍用未标注的原始 schema。
  listForAgent(): ToolDef[] {
    const tier = (n: string) => (n.startsWith('skill_') ? 0 : 1);
    const SKILL_COUNTERPART: Record<string, string> = {
      create_docx: 'skill_docx', create_pdf: 'skill_pdf',
      create_xlsx: 'skill_xlsx', create_pptx: 'skill_pptx',
    };
    const GENERIC_FILE = new Set(['fs_read', 'fs_write', 'fs_list']);
    const annotated = [...this.map.values()].map(t => {
      const d = t.def;
      let note = '';
      if (SKILL_COUNTERPART[d.name]) {
        note =
          '\n（若任务确为该技能领域，可用对应 ' + SKILL_COUNTERPART[d.name] +
          ' 获得更完整流程；否则本工具直接生成即可，无需先 use_skill）';
      } else if (GENERIC_FILE.has(d.name)) {
        note =
          '\n（默认文件操作工具：读取/写入/列举任意文件都用它；不要用 skill_* 技能工具去读普通文件）';
      }
      // skill_* 工具自身的描述已写明领域边界（如"仅当任务确属本技能领域才调用"），
      // 故此处不再额外盖"优先/按领域选用"的戳——是否调用完全交给模型推理。
      return { ...d, description: d.description + note };
    });
    annotated.sort((a, b) => {
      const ta = tier(a.name);
      const tb = tier(b.name);
      if (ta !== tb) return ta - tb;
      return a.name.localeCompare(b.name);
    });
    return annotated;
  }

  // 【Phase 1 的信号收窄】——两阶段加载的第一段，最终送模型的清单请用 toolSearch.composeTools()。
  // 本函数只负责"哪些 deferred 工具因命中可靠信号而值得直接展开"，不负责隐藏目录与 tool_search 注入。
  //
  // 候选工具集收窄（解决"弱模型面对 37+ 工具无法可靠选工具"的根因）。
  // 服务器**不替模型决定用哪个工具**，只把"明显与本请求无关"的 skill_* 工具从候选清单里移除，
  // 让弱模型在一个可判别的小集合内自行推理。模型仍可用 list_skills / use_skill 发现并调用任意技能。
  // 纳入 skill_* 的可靠信号（任一命中即保留）：
  //   1) 请求/附件含文件扩展名（.xlsx/.docx/.pdf/.pptx/.csv 等，零歧义）
  //   2) 用户显式点名某技能（slug 或全称）
  //   3) 命中该技能自带 curated trigger（技能作者为"何时用我"专门写的短语，远比通用关键词可靠）
  // 通用请求（如"读取一下这个文件"、无扩展名、没点名技能）→ 完全不暴露 skill_*，模型只能用 fs_*。
  toolsForRequest(userInput: string, attachmentNames: string[] = []): ToolDef[] {
    const all = this.listForAgent();
    const nonSkill = all.filter((t) => !t.name.startsWith('skill_'));
    const skills = all.filter((t) => t.name.startsWith('skill_'));
    const text = (userInput + ' ' + attachmentNames.join(' ')).toLowerCase();

    const include = new Set<string>();
    // 1) 默认保留所有非 skill 工具（fs_*、use_skill、list_skills、save_*、run_skill_script、插件工具）
    for (const t of nonSkill) include.add(t.name);

    // 2) 文件扩展名（最可靠）：命中则加入对应文档 skill
    for (const s of skills) {
      for (const e of EXT_SKILL) {
        if (e.skill === s.name && e.re.test(text)) { include.add(s.name); break; }
      }
    }

    // 3) 用户显式点名某技能（slug 或全称，如"用 xlsx 技能"）
    for (const s of skills) {
      const slug = s.name.slice('skill_'.length).replace(/_/g, ' ');
      if (text.includes(s.name.toLowerCase()) || text.includes(slug)) include.add(s.name);
    }

    // 4) 命中技能自带的 curated trigger（技能作者为"何时用我"专门写的短语，远比通用关键词可靠）
    try {
      const byName = new Map<string, string>();
      for (const m of getSkills()) {
        const key = 'skill_' + m.name.trim().toLowerCase().replace(/[^\w]+/g, '_');
        byName.set(key, (m.trigger || '').toLowerCase());
      }
      for (const s of skills) {
        if (include.has(s.name)) continue;
        const trig = byName.get(s.name) || '';
        if (trig && trig.split(/[;；,，、\n]/).some((p) => p.trim().length > 2 && text.includes(p.trim()))) {
          include.add(s.name);
        }
      }
    } catch { /* 忽略：trigger 匹配失败不应影响主流程，非 skill 工具已全保留 */ }

    return all.filter((t) => include.has(t.name));
  }

  has(name: string): boolean { return this.map.has(name); }

  unregister(name: string) { this.map.delete(name); this._version++; }

  async execute(call: ToolCall, ctx: ToolContext): Promise<any> {
    const tool = this.map.get(call.name);
    if (!tool) {
      return { error: '未知工具: ' + call.name };
    }
    // 阶段6：结构化参数校验（必填 / 类型 / 枚举）。失败则直接回报可纠正错误，
    // 不让工具以空/错参数崩溃后无限重试，也不浪费一次昂贵的模型往返。
    const v = validateArgs(tool.def, call.arguments || {});
    if (!v.ok) {
      ctx.emit({ type: 'tool_error', tool: call.name, message: '参数校验失败: ' + (v.error || '') });
      return {
        error: '参数校验失败',
        detail: v.error,
        hint: '请按下方「参数说明」用严格 JSON 对象提供参数（键与字符串值用双引号，不要尾部逗号或 Python 风格）。',
        参数说明: v.schemaSummary,
      };
    }
    ctx.emit({ type: 'tool_start', tool: call.name, message: '调用工具 ' + call.name });
    try {
      const result = await tool.fn(call.arguments || {}, ctx);
      ctx.emit({ type: 'tool_end', tool: call.name, message: '工具 ' + call.name + ' 完成', data: result });
      return result;
    } catch (e: any) {
      ctx.emit({ type: 'tool_error', tool: call.name, message: '工具 ' + call.name + ' 出错: ' + (e?.message || e) });
      return { error: String(e?.message || e) };
    }
  }
}

export const registry = new ToolRegistry();
export type { ToolDef, ToolContext };

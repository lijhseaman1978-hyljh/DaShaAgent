// core/agentLoop.ts
// -- 主 AgentLoop（生产引擎 · 主路径）--
// 被 unified.ts（引擎主入口）导入，是 DaShaAgent 的实际运行引擎。
// 与 kernel/runtime.ts 内联的 AgentLoop（演示桩）是独立实现：core/ 版本服务于 unified.ts 主引擎，
// kernel/runtime.ts 的 AgentLoop 仅用于 npm run os/control 演示与 observability，不进生产对话。
// 改 bug 时请先确认目标路径：unified.ts 为主引擎 → 改 core/agentLoop.ts；
// kernel/runtime.ts 为内核演示层 → 改其内联 AgentLoop（非独立文件）。
// 两者互不 import，可独立修改。
// ------------------------------------------------------------

import { CONFIG } from '../config';
import type { Provider, ChatMessage, ToolCall, RunCallbacks, ActivityEvent } from './types';
import { registry } from '../tools/registry';
import { composeTools } from '../tools/toolSearch';
import { MemoryManager } from '../memory';
import { skillsSystemPrompt } from '../skills/loader';
import { getOfflineOfficeGuidance } from '../tools/skillTool';
import { RAG } from '../rag';
import { sessions } from './session';
import { LoopGuard, systemReminder } from './reminders';
import { setActiveModel } from './modelCaps';
import { drainImages, clearImages } from './imageBus';
import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
// ── 四层自进化架构 ──
import { captureReflection, buildSelfEvolvePrompt } from '../self-improve';
// 2026-08-13 R3：静默错误可观测（错误不再无声消失，全部计入 error.silent 指标）
import { countSilentError } from '../observability/silent';
// ── Phase 7: 三方案进化集成 ──
import { evolveUserModel, buildUserModelPrompt, buildResumeContext, buildResumePrompt, mineSuccess, buildBestPracticesPrompt } from '../evolution';
// ── 自进化完成后自动打 checkpoint（还原点）──
import { gitCheckpoint } from '../git/checkpoint';
// ── 生产路径可靠性接线（闭环修复）──
import { retry, isRetryableError } from '../agent/executor/retry';      // 指数退避重试（agent/executor 优质实现）
import { TaskVerifier } from '../cognition/verifier';                    // 任务完成验证（Meta-Cognition）
import { ConfidenceTracker } from '../cognition/confidence';             // 置信度/诚实度追踪（Meta-Cognition）
import { recordGap } from '../evolution/capabilityGap';                  // 能力缺口采集（自进化数据源）
import { recordSkillCall } from '../evolution/skillRegistry';            // 工具性能指标（成功率/延迟）
import { learning } from '../learning';                                  // 反思→学习闭环（learnFromReflection）

// §15 人工接管：循环内协作式取消（kill/pause 可靠生效）
import { agentControl } from '../kernel/control';

// ── 诚实度追踪：低置信复审落盘（core 改动②：让 ConfidenceTracker 真正驱动行为）──
const CONFIDENCE_RECHECK_FILE = join(CONFIG.DATA_DIR, 'evolution', 'confidence-recheck.jsonl');
function appendConfidenceRecheck(rec: Record<string, unknown>): void {
  try { appendFileSync(CONFIDENCE_RECHECK_FILE, JSON.stringify(rec) + '\n', 'utf8'); } catch { /* 落盘失败不影响主流程 */ }
}

// ── 幻觉防护：检测"零工具调用但声称已完成"的模式 ────────────
// BUG-FIX: 弱模型（尤其本地 Ollama/qwen3.5）在需要多步工具调用时，偶发不生成 tool_calls，
// 却在 content 文本里编造"✅ 已生成 Word 文档""已调用 offline-office"等虚假完成声明。
// 此函数在 finalText 返回前扫描这些模式，命中则注入纠正提醒强制模型真正执行工具。
const FABRICATION_PATTERNS: Array<[RegExp, string]> = [
  [/✅\s*(?:文档|文件|报告|Word|Excel|PPT|PDF|代码|图片)\s*(?:已生成|已保存|已创建|已完成)/i, '文件已生成'],
  [/(?:已生成|已保存|已创建|已写入|已发送)\s*(?:文档|文件|报告|Word|Excel|PPT|PDF)/i, '文件已生成/保存'],
  [/(?:文件|文档|报告)\s*(?:已保存|保存在|保存至|存放于).*\.(?:docx|xlsx|pdf|pptx)/i, '文件已保存到具体路径'],
  [/(?:成功|已)\s*(?:生成|创建|保存|写入|发送)\s*(?:\w+\.(?:docx|xlsx|pdf|pptx))/i, '文件操作已完成'],
  [/调用\s*(?:offline-office|create_docx|create_xlsx|create_pptx|create_pdf)\s*\(/i, '调用了工具（幻觉语法）'],
  [/(?:桌面|Desktop).*\.(?:docx|xlsx|pdf|pptx)/i, '文件保存到桌面'],
  [/文件路径[：:]\s*[A-Z]:\\/i, '提供了文件路径'],
  ] as const;

function detectFabricatedClaims(text: string, toolCallCount: number, currentTurnToolCalls: number): string | null {
  // 本轮有工具调用 → 跳过检测（模型基于工具结果回复）
  if (currentTurnToolCalls > 0) return null;
  // 累计无任何工具调用 + 本轮也无 + 文本声称已完成 → 完全编造（原有逻辑）
  if (toolCallCount === 0) {
    for (const [pattern, label] of FABRICATION_PATTERNS) {
      if (pattern.test(text)) return label;
    }
    return null;
  }
  // 累计有工具调用、但本轮无调用 → 可能在第二轮编造（之前被跳过检测的 bug）
  // 使用更严格的判断：如果本轮声称创建了文件但实际没有调用任何写工具 → 编造
  if (/(?:已生成|已创建|已保存|已写入|保存在)\s*(?:文档|文件|Word|Excel)/.test(text)) {
    return '第二轮编造文件操作声明';
  }
  return null;
}

// ── ReflectionPhase：Agent 自反思与经验积累（审计建议 #2）──
interface ReflectionEntry {
  timestamp: number;
  goal: string;
  success: boolean;
  toolCallCount: number;
  tokensUsed?: number;
  summary: string;
  lesson?: string;
}

const REFLECTION_DIR = join(CONFIG.DATA_DIR, 'reflections');

function ensureReflectionDir() {
  if (!existsSync(REFLECTION_DIR)) mkdirSync(REFLECTION_DIR, { recursive: true });
}

function recordReflection(entry: ReflectionEntry) {
  try {
    ensureReflectionDir();
    const file = join(REFLECTION_DIR, `${new Date().toISOString().slice(0, 10)}.jsonl`);
    appendFileSync(file, JSON.stringify(entry) + '\n', 'utf8');
  } catch {
    // Reflection 落盘失败不应阻断主流程
  }
}

const BASE_SYSTEM = `你是「专属智能体 Harness」中的主助手，一个可靠、果断、以结果交付为先的个人 AI 助理。

【思考方式（最重要）】在调用任何工具前，请先真正理解用户想要什么，再决定怎么做——不要做"关键词匹配→硬套工具"：
1. 理解目标：用户表面说了什么，背后真正想达成什么？（例："读一下这个文件"= 想看到文件内容；"帮我写个 Word 报告"= 想得到一个 .docx 文档）
2. 回忆能力：你手头有哪些工具/技能，各自真正擅长什么（看工具描述里的【用途】和【领域】，而不是名字里有没有相关字）。
3. 目的匹配：选"用途最贴合目标"的那个能力，而不是"名字里含有关键词"的那个。
4. 执行并反思：调用后看结果，不对就换一种能达成的方式，或在有限尝试（≤3 次）后给出结论。

【反模式（务必避免）】
- ❌ 不要因为某工具名/技能名里含有任务相关词就盲目调用（例如看到 skill_xlsx 就以为能"读任意文件"——它只处理 Excel 专属领域）。
- ❌ 不要先做关键词匹配、再硬套工具；也不要看到"技能"二字就觉得任何任务都该走技能。
- ❌ 同一工具反复用不同猜测参数重试（尤其 fs_read 猜路径）；一次失败就换方式。
- ❌ 禁止逐个串行调用无依赖的工具：多个相互独立的调用（读多个文件、列多个目录、并行探测等）必须放在【同一个块】里一起发出（一次回复多个 tool_calls），不要"调一个→等结果→再调一个"。轻量探测/批量读取能用 run_code 一个脚本完成时就合并成一个调用，绝不拆成多次往返。有依赖关系（后一步要用前一步结果）的调用才允许串行。

【硬约束（安全底线，必须遵守）】
- 严禁用 fs_write 写入 .docx/.pdf/.xlsx/.pptx 等二进制/特殊格式（会生成损坏文件）。生成这类文档请用专用工具。
- 严禁编造"工具已执行"的完成声明：如果你没有真正调用过 create_docx / create_xlsx / create_pptx / create_pdf / skill_* 等生成类工具，绝不可声称"文档已生成""文件已保存""已发送邮件"等。必须先调用工具取得真实结果，再汇报摘要。文件路径、文件大小、执行时间等信息，只有工具返回的结果里才有——不要编造。
- 本环境不存在 skill_view / terminal / execute_code / session_search / write_file / delegate_task；技能原指令里出现这些名字时，按能力地图替换为可用工具。
- 严禁为"找参考文件"用不同路径反复 fs_read 猜测；use_skill 已直接返回绝对路径，直接打开即可。

【能力地图（按用途选用，而非按名字）】
- 读/写/列 任意文件 → fs_read / fs_write / fs_list（默认文件工具，无需任何技能）。重点：fs_read 已内置多格式原生解析，【读取已有文件的内容应优先用 fs_read，一步到位、无需任何技能工具】：.xlsx/.xls/.xlsm（openpyxl 抽"行×列"）、.pdf（pypdf 抽每页，扫描件自动 pdfplumber 兜底）、.docx/.docm（python-docx 抽段落+表格）、.pptx/.ppsx（python-pptx 逐张幻灯片抽文本）、普通文本/.csv/.md/.json/代码直接返回。生成类技能（如 skill_pdf）是用来"新建"文档的，不是读的——不要为"读内容"去调用它们。
- 生成 Office 文档：有对应 skill_<名字> 且任务确属其领域 → 用该 skill_ 工具（如 skill_docx 生成 Word）；否则用 create_docx / create_pdf / create_xlsx / create_pptx 直接生成。
- 读取 .xlsx/.xls/.csv 等表格的【内容】→ 直接用 fs_read（已内置表格解析）；只有【新建/修改/重算】Excel 才用 skill_xlsx（其 recalc.py 只重算公式、不输出内容）。不要为"读内容"去调用 skill_xlsx。读取 .pdf/.docx/.pptx 内容同理直接用 fs_read，不要调用生成类技能。
- 某技能专属领域任务（生图、arxiv 检索、ComfyUI、磁盘审计、特定写作风格、部署等）→ 优先直接用对应 skill_<名字> 工具（一步直达）。**当前 tools 列表里没看到它，不代表它不存在**——先用 tool_search 把它捞出来再调用，不要退回 use_skill + run_skill_script 这条两跳老路；只有 tool_search 确实检索不到时，才用 use_skill(名称) 取步骤执行。
- 【工具是分两阶段给你的，务必理解】你当前看到的 tools 列表 = 常用核心工具 + 与本次任务明显相关的技能工具。**其余技能工具并没有消失**，它们被压缩成一行摘要，列在 tool_search 描述里的 <deferred_tools> 目录中。所以：当现有列表里没有能胜任的工具时，正确做法不是放弃、也不是硬套一个不相关的工具，而是先扫一眼那份目录，再用 tool_search 把需要的加载进来——知道名字就传 tool_names，不确定就传 queries 关键词（中文可以，如 ["生成海报"]）。加载后的工具从下一步起可直接调用，**同一个工具只需检索一次，不要反复检索**。反之，普通文件读写永远用 fs_read / fs_write，不需要来这里检索。
- run_skill_script 是低层回退：仅在"无对应 skill_ 工具 且 明确知道 技能名+脚本名"时使用，必须带 skill 与 script 两参数。注意：它只能运行 skills/ 目录内的脚本，【不要】用它去运行你用 fs_write 写到桌面/工作区的脚本——那种情况请用 run_code。
- run_code 是"自造工具"的合法闭环：当遇到没有现成工具/技能能处理的罕见格式或特殊逻辑时，可先用 fs_write 写一个解析/处理脚本，再用 run_code 把它跑起来（支持 python/node，可指向桌面等绝对路径）。这是 agent 自主扩展能力的通道；绝大多数常见文件用 fs_read 已足够，无需走到这一步。
- 列/查已装技能 → list_skills / use_skill；存记忆 → save_note / save_profile。

【其他】
- 用户只询问信息（"你有哪些技能""你能做什么"）就直接回答，不要调工具，更别把答案写进文件。
- 回答简洁、结论先行、用中文（用户用中文时）。
- 信息不足可主动澄清，但不做无意义反问；不编造事实，不确定时说明来源。
- 用户给稳定个人信息或要求"记住/保存记忆"时，必须真实调用 save_profile / save_note 写入，绝不可只回复"已保存"而不实际调用。`;

// 防止单个工具结果（如大文件读取/脚本输出）撑爆上下文：Observation 超长则截断并标注原长。
// 单次工具观察结果最大字符数。
// 现代模型（DeepSeek V4/Claude/Gemini）支持 128K–1M token 上下文窗口，
// 不再需要激进截断。保留此限制仅为防止极端情况（读取超大文件）。
const MAX_OBSERVATION_CHARS = 200_000; // 200KB，约 50K tokens
function truncObservation(s: string): string {
  if (s.length <= MAX_OBSERVATION_CHARS) return s;
  return (
    s.slice(0, MAX_OBSERVATION_CHARS) +
    `\n…[Observation 已截断，原长度 ${s.length} 字符，仅保留前 ${MAX_OBSERVATION_CHARS}]`
  );
}

export interface AgentDeps {
  provider: Provider;        // 默认 Provider（RAG/Embeddings）
  memory: MemoryManager;
  rag: RAG;
}

/** 认知记忆 & 可观测性钩子：AgentLoop 执行周期内由外部注入 */
export interface AgentHooks {
  /** 任务开始前：回忆相关经验 + 知识 + 技能 → 注入到系统提示中 */
  onRecall?: (task: string) => Promise<string>;
  /** 任务开始前：注入最近学到的教训（经历→知识→技能闭环的产物）。已在 buildSystem() 中接线（见 onLearn 调用块）。 */
  onLearn?: (task: string) => Promise<string>;
  /** 任务开始前：注入 Autonomy Engine 生成的待执行目标（自主性闭环的消费者端）。 */
  onAutonomy?: () => Promise<string>;
  /** 任务结束时记录一次经历到认知记忆（经历→知识→技能闭环） */
  onComplete?: (opts: { task: string; result: string; success: boolean }) => Promise<void>;
  /** 任务开始时记录 tracer span */
  onStart?: (opts: { task: string }) => any;
  /** 任务结束/失败 */
  onFinish?: (opts: { span: any; status: 'ok' | 'error'; error?: string }) => void;
}

export class AgentLoop {
  private hooks?: AgentHooks;
  /** 质量兜底：任务完成验证器（Meta-Cognition，验证"没完成说完成了"的幻觉） */
  private verifier = new TaskVerifier();
  /** 置信度/诚实度追踪器（随每次验证记录，可查趋势与易失败模式） */
  private confidence = new ConfidenceTracker();

  constructor(private deps: AgentDeps, hooks?: AgentHooks) {
    this.hooks = hooks;
  }

  // 构建系统提示：基础 + 技能 + 画像 + RAG 召回
  private async buildSystem(userInput: string): Promise<string> {
    // 设计原则：意图理解交给模型自己做，服务器不再用关键词预匹配"替模型决定该用哪个技能"。
    // 只把能力清单（技能索引 + 工具）交给模型，由它基于"目标→用途匹配"自行推理选工具，
    // 从根上消除"对比关键词→盲目套工具"的退化行为。
    let sys = BASE_SYSTEM + skillsSystemPrompt(userInput);
    // 办公/文档意图：自动把用户强制要求的 offline-office 套件（环境适配版）注入提示，
    // 使模型无需先成功调用一次 use_skill 即可拿到规则与正确工具指向（规避思考模型 tool-calling 不稳导致的空转）。
    const OFFICE_RE = /docx|word|\.pdf|文档|文章|报告|简历|合同|表格|邮件|公众号|扫描件|excel|xlsx|ppt|office|办公|海事.*(报告|分析)/i;
    if (OFFICE_RE.test(userInput)) {
      try {
        const off = getOfflineOfficeGuidance();
        if (off) sys += '\n' + off;
      } catch (e) { countSilentError('officeGuidance', e); }
    }
    const profile = this.deps.memory.profilePrompt();
    if (profile) sys += '\n' + profile;

    // ── Tier 2: 自进化规则注入（从过往错误中学习） ──
    try {
      const evolve = buildSelfEvolvePrompt(userInput);
      if (evolve) sys += evolve;
    } catch { /* 自进化规则注入失败不影响主流程 */ }

    // ── 方案一：用户画像注入（自动演化，越用越懂你） ──
    try {
      const { loadUserModel } = await import('../evolution/userModel');
      const userModel = buildUserModelPrompt(loadUserModel());
      if (userModel) sys += userModel;
    } catch { /* 画像注入失败不影响主流程 */ }

    // ── 方案三：最佳实践注入（从成功经验中学习） ──
    try {
      const bestP = buildBestPracticesPrompt();
      if (bestP) sys += bestP;
    } catch { /* 最佳实践注入失败不影响主流程 */ }

    // ── 方案二：跨会话恢复上下文 ──
    try {
      const ctx = buildResumeContext();
      if (ctx.recentSessions.length || ctx.pendingTasks.length) {
        sys += buildResumePrompt(ctx);
      }
    } catch { /* 恢复上下文注入失败不影响主流程 */ }

    // 认知记忆：回忆相关经验 + 知识 + 技能 → Agent 带着经验思考
    try {
      if (this.hooks?.onRecall) {
        const ctx = await this.hooks.onRecall(userInput);
        if (ctx) sys += '\n' + ctx;
      }
    } catch (e) { countSilentError('hook.onRecall', e); }

    // 自进化：把"最近学到的教训"注入系统提示，让 Agent 带着历史经验避坑
    try {
      if (this.hooks?.onLearn) {
        const lessons = await this.hooks.onLearn(userInput);
        if (lessons) sys += '\n' + lessons;
      }
    } catch { /* 教训注入失败不影响主流程 */ }

    // 自主目标：把 Autonomy Engine 生成的待执行目标注入提示，让 Agent 感知并可在任务中顺带执行
    try {
      if (this.hooks?.onAutonomy) {
        const goals = await this.hooks.onAutonomy();
        if (goals) sys += '\n' + goals;
      }
    } catch { /* 目标注入失败不影响主流程 */ }

    // RAG 召回（异步，失败不影响主流程）
    try {
      const hits = await this.deps.rag.retrieve(userInput, 4);
      if (hits.length) {
        sys += '\n【知识库相关片段】\n' + hits.map(h => '- ' + h).join('\n');
      }
    } catch (e) { countSilentError('rag.retrieve', e); }

    return sys;
  }

  async run(opts: {
    userInput: string;
    sessionId: string;
    callbacks?: RunCallbacks;
    systemOverride?: string; // 供多智能体子 Agent 使用
    extraTools?: any[];      // 预留
    temperature?: number;    // 本次调用的温度
    provider?: Provider;     // 指定 Provider（模型切换），缺省用默认
    attachments?: Array<{ name: string; path: string; size: number; mime: string; text?: string }>;
    signal?: AbortSignal;
  }): Promise<string> {
    const { userInput, sessionId, callbacks } = opts;
    const signal = opts.signal;
    // 优先链：opts传入 > 默认 Provider
    let provider = opts.provider || this.deps.provider;
    console.log(`[AgentLoop] provider chain: opts=${!!opts.provider}, default=${!!this.deps.provider}, chosen=${provider?.name}`);
    const emit = (ev: ActivityEvent) => callbacks?.onActivity?.(ev);

    if (signal?.aborted) return '(任务已取消)';

    // 任务开始
    const span = this.hooks?.onStart?.({ task: userInput });

    setActiveModel({
      type: /ollama/i.test(provider.name) ? 'ollama' : 'cloud',
      model: (provider as any).modelName || '',
      base: (provider as any).baseUrl || '',
    });
    clearImages(sessionId); // 清掉上一轮可能残留的待注入图片

    // 组装用户输入：把附件（文本内容或文件引用）并入消息
    let fullInput = userInput || '';
    if (opts.attachments?.length) {
      const blocks = opts.attachments.map(a => {
        if (a.text) return `【附件：${a.name}】\n${a.text}`;
        return `【附件(文件)：${a.name}】 路径: ${a.path}　大小: ${(a.size / 1048576).toFixed(1)}MB　类型: ${a.mime}（需要时可用文件工具读取其内容）`;
      });
      fullInput = blocks.join('\n\n') + (fullInput ? '\n\n' + fullInput : '');
    }

    const systemText = opts.systemOverride || await this.buildSystem(fullInput);
    sessions.append(sessionId, { role: 'user', content: fullInput });

    // 组装消息：system + 历史 + 当前输入
    const history = sessions.toChatMessages(sessionId);
    // 把当前 user 消息替换/追加到末尾（toChatMessages 已含刚 append 的 user）
    const messages: ChatMessage[] = [{ role: 'system', content: systemText }, ...history];
    // 两阶段工具加载（见 tools/toolSearch.ts）：core 工具 + 命中可靠信号的技能工具直接展开，
    // 其余压成一行摘要挂在 tool_search 目录里按需检索。既砍掉大部分 schema token，
    // 又从结构上消除"读文件却调 skill_xlsx"的误选——同时保证任何技能都仍然可被发现和调用。
    const attachNames = (opts.attachments || []).map((a) => a.name);

    // —— 工具调用护栏与预算 ——
    // 关键改造：护栏不再是"一触即熔断"，而是三级响应（提醒 → 拦截 → 终止），详见 reminders.ts。
    // 模型跑偏时先注入 <system-reminder> 给它自我纠正的机会，屡教不改才真正停。
    // 累计工具调用预算（config 可配，0=无限，与 MAX_ITER 同语义）。
    // ⚠️ 2026-08-12 回归事故修复：判断必须带 `> 0` 守卫——用户 .env 设 AH_MAX_TOOL_CALLS=0（无限），
    // 若不守卫，0+1>0 恒真，首次工具调用即被误判超预算、强制关闭工具通道。
    const MAX_TOOL_CALLS = CONFIG.MAX_TOOL_CALLS;
    const guard = new LoopGuard();
    let toolCallCount = 0;
    const toolNames: string[] = [];  // 跟踪实际调用的工具名（用于成功挖掘）
    let recovered = false;       // 最终轮空回复的"收尾补问"是否已用过（只补一次，防空转）
    let verifyCorrections = 0;   // 质量兜底：TaskVerifier 已要求修正的轮数（封顶，防空转）
    let confidenceRecheck = 0;    // 诚实度追踪驱动的低置信复审轮数（封顶，防空转）

    // MAX_ITER=0 表示无限步数（config 注释约定）；正数则按配置上限执行
    const maxIter = CONFIG.MAX_ITER > 0 ? CONFIG.MAX_ITER : Infinity;
    for (let iter = 0; iter < maxIter; iter++) {
      if (callbacks?.signal?.aborted) { emit({ type: 'info', message: '已取消' }); break; }
      // §15 人工接管：kill 在下一个安全点退出；pause 在安全点挂起直到 resume（协作式取消，与 kernel/control.gate() 对齐）
      if (agentControl.killed) { emit({ type: 'info', message: '已终止（人工接管）' }); break; }
      if (agentControl.paused) {
        emit({ type: 'info', message: '已暂停，等待恢复…' });
        const gateResult = await agentControl.gate();
        if (gateResult === 'abort' || agentControl.killed) { emit({ type: 'info', message: '已终止（人工接管）' }); break; }
      }

      // 每轮重算：上一轮若调用了 tool_search，激活集已变，本轮 tools 数组必须跟着变，
      // 否则会出现"检索到了工具却依然无法调用"的死结。
      const tools = composeTools(fullInput, attachNames, sessionId);

      // iter≥1：用精简 system 替代全文，防止 13K 系统提示词淹没工具结果
      if (iter > 0 && messages[0]?.role === 'system') {
        messages[0] = { role: 'system', content: '继续。严格基于上方工具返回的真实结果回答用户，不要编造任何数据或文件内容。' };
      }

      let resp: ChatMessage;
      try {
        // DEBUG: 记录实际发给 LLM 的最后一条 user 消息
        const lastUser = [...messages].reverse().find(m => m.role === 'user');
        const toolMsgs = messages.filter(m => m.role === 'tool');
        console.log(`[AgentLoop:llm] last_user: ${lastUser?.content?.slice(0,80)}, tool_msgs=${toolMsgs.length}, tool_ids=${toolMsgs.map(m=>(m as any).tool_call_id).join(',')}`);
        // 完整消息摘要
        console.log(`[AgentLoop:llm] messages summary:`, messages.map(m => `${m.role}[${(m.content||'').length}c]${(m as any).tool_calls ? ' (+'+ (m as any).tool_calls.length +'tc)' : ''}`).join(' → '));
        // 生产路径重试接线（闭环修复）：瞬时 API 抖动（429/网络瞬断）自动指数退避重试，
        // 认证/参数错误立即失败不重试；用户中止不重试。timeoutMs 放宽到 10 分钟避免误杀长生成。
        resp = await retry(() => provider.chat({
          messages,
          tools,
          stream: true,
          onToken: (t) => callbacks?.onToken?.(t),
          onThought: (t) => callbacks?.onThought?.(t),
          signal: callbacks?.signal,
          temperature: opts.temperature,
        }), 3, {
          timeoutMs: 600_000,
          isRetryable: (e: unknown) => {
            const msg = String((e as any)?.message || (e as any)?.name || '');
            if (/abort|aborted/i.test(msg)) return false;       // 用户中止：不重试
            return isRetryableError(e);
          },
          onRetry: (attempt, err, delay) => {
            console.warn(`[AgentLoop:retry] 模型调用瞬态失败，第 ${attempt} 次重试（${Math.round(delay)}ms 后）`, (err as any)?.message ?? err);
            emit({ type: 'info', message: `模型调用瞬态失败，自动重试中（${attempt}/3）…` });
          },
        });
      } catch (err: any) {
        if (callbacks?.signal?.aborted || /abort/i.test(String(err?.message || err?.name || ''))) {
          emit({ type: 'info', message: '已停止生成' });
          break;
        }
        throw err;
      }

      // 规范化工具调用：保证每个 tool_call_id 永远有效（兼容任意 provider，不依赖其是否返回 id），
      // 并过滤掉缺失名称的无效调用。这一步是"跨模型正确调用工具、不产生 400/错配"的根基。
      const rawCalls = resp.tool_calls || [];
      console.log(`[AgentLoop:resp] tool_calls=${rawCalls.length} content_len=${resp.content?.length||0}`);
      if (rawCalls.length) console.log(`[AgentLoop:resp] tools:`, rawCalls.map((c:any) => `${c.name}(${JSON.stringify(c.arguments).slice(0,80)})`).join(', '));
      const calls = rawCalls
        .map((tc, i) => ({
          id: (tc.id && String(tc.id).trim()) ? String(tc.id) : `call_${Date.now().toString(36)}_${i}`,
          name: String(tc.name || '').trim(),
          arguments: (tc.arguments && typeof tc.arguments === 'object') ? tc.arguments : {},
        }))
        .filter(c => c.name);

      if (calls.length) {
        // 预算超限：强制以「无工具」模式再问一次，要求模型基于已获取的信息直接给出最终答复。
        // 这从结构上保证任何模型都能产出最终结果，而不是空转到 MAX_ITER 才吐废话。
        if (MAX_TOOL_CALLS > 0 && toolCallCount + calls.length > MAX_TOOL_CALLS) {
          messages.push({ role: 'user', content: LoopGuard.budgetExhausted(toolCallCount) });
          const finalResp = await provider.chat({
            messages,
            tools: [],
            stream: true,
            onToken: (t) => callbacks?.onToken?.(t),
            onThought: (t) => callbacks?.onThought?.(t),
            signal: callbacks?.signal,
            temperature: opts.temperature,
          });
          const finalText = (finalResp.content || '').trim() || '（工具调用次数过多，已停止。请参考上方工具返回的结果给出结论。）';
          sessions.append(sessionId, { role: 'assistant', content: finalText });
          return finalText;
        }
        toolCallCount += calls.length;
        for (const c of calls) { toolNames.push(c.name); }

        // 记录 assistant（含 tool_calls）
        sessions.append(sessionId, { role: 'assistant', content: resp.content || '', tool_calls: calls });
        messages.push({ role: 'assistant', content: resp.content || null, tool_calls: calls });
        console.log(`[AgentLoop:msg] pushed assistant+tool_calls: ${calls.map(c=>c.name+'('+c.id+')').join(',')}`);

        // ── 三级护栏：先看这一轮该不该拦 ────────────────────────────
        const verdict = guard.inspect(calls);
        if (verdict.action === 'abort') {
          // 只有屡教不改才走到这里。而且不是直接甩一句"已停止"，
          // 而是关掉工具让模型把已获得的信息整理成答复——用户至少能拿到点东西。
          messages.push({ role: 'user', content: systemReminder('force-conclude', verdict.message) });
          let closing = '';
          try {
            const r = await provider.chat({
              messages, tools: [], stream: true,
              onToken: (t) => callbacks?.onToken?.(t),
              onThought: (t) => callbacks?.onThought?.(t),
              signal: callbacks?.signal,
              temperature: opts.temperature,
            });
            closing = (r.content || '').trim();
          } catch { /* 收尾失败就退回护栏原文 */ }
          const finalText = closing || '（' + verdict.message + '）';
          emit({ type: 'info', message: '循环护栏已终止本轮：' + verdict.message.slice(0, 60) });
          sessions.append(sessionId, { role: 'assistant', content: finalText });
          return finalText;
        }

        // block：这组调用被判定为"确证无意义的重复"，不真正执行，用提醒当作工具结果回灌。
        // 这样模型仍然拿到了一条 tool 消息（协议完整），但内容是纠正指令而非重复的旧数据。
        if (verdict.action === 'block') {
          emit({ type: 'info', message: '拦截重复调用，已注入纠正提醒' });
          for (const tc of calls) {
            const toolMsg: ChatMessage = {
              role: 'tool', name: tc.name,
              content: verdict.reminder,
              tool_call_id: tc.id,
            };
            sessions.append(sessionId, { role: 'tool', content: toolMsg.content, name: tc.name, tool_call_id: tc.id } as any);
            messages.push(toolMsg);
          }
          continue;
        }

        // ── 正常执行 ─────────────────────────────────────────────────
        let argFailVerdict: ReturnType<LoopGuard['checkArgFailure']> | null = null;
        for (const tc of calls) {
          let result: any;
          if ((tc.arguments as any)._argParseError) {
            // 参数解析失败：直接、清晰地回报给模型，让它纠正，而非让工具以空参数崩溃后无限重试。
            result = {
              error: '参数校验失败',
              detail: '工具参数解析失败：' + (tc.arguments as any)._argParseError,
              raw: (tc.arguments as any)._raw || '',
              hint: '请用严格 JSON 对象提供参数（键与字符串值均使用双引号，不要带尾部逗号或 Python 风格）。',
            };
          } else {
            // 自进化数据源接线（闭环修复）：模型调用不存在的工具 = 真实的能力缺口，
            // 记录到 gaps.jsonl 供 Skill Factory 周期补齐（生产路径首次采集）。
            if (!registry.has(tc.name)) {
              try {
                recordGap({
                  capability: tc.name,
                  category: 'tool_missing',
                  task: userInput.slice(0, 200),
                  trigger: 'AgentLoop: 模型调用了未注册工具',
                });
              } catch { /* 缺口记录失败不影响主流程 */ }
            }
            // 工具性能指标接线（闭环修复）：每次真实工具执行都计入 Skill Registry，
            // 供「成功率/延迟/弱技能」报表与 autoFactory 质量反馈使用（此前 recordSkillCall 零调用点）。
            const t0 = Date.now();
            result = await registry.execute(tc as ToolCall, {
              sessionId,
              emit,
              provider: this.deps.provider,
            });
            try {
              recordSkillCall(tc.name, {
                success: !(result && (result.error || result.ok === false)),
                latencyMs: Date.now() - t0,
              });
            } catch { /* 性能记录失败不影响主流程 */ }
          }
          guard.noteResult(tc, result);

          // 关键：tool 结果消息必须带上对应 tool_calls 的真实 id，否则云端（OpenAI 兼容）会因
          // tool_call_id 不匹配返回 400。这里的 tc.id 来自上面规范的归一化结果，永远有效。
          let body = truncObservation(JSON.stringify(result));
          console.log(`[AgentLoop:tool] ${tc.name} result_len=${body.length} preview=${body.slice(0,200)}`);

          // 参数校验连败 → 把纠正提醒直接贴在这条观察后面，模型读观察时顺带就看到了
          const av = guard.checkArgFailure(tc.name);
          if (av.action === 'remind') body += '\n' + av.reminder;
          else if (av.action === 'abort') argFailVerdict = av;

          const toolMsg: ChatMessage = {
            role: 'tool', name: tc.name, content: body, tool_call_id: tc.id,
          };
          console.log(`[AgentLoop:toolmsg] pushing tool msg: name=${tc.name} id=${tc.id} content_len=${body.length}`);
          sessions.append(sessionId, { role: 'tool', content: body, name: tc.name, tool_call_id: tc.id } as any);
          messages.push(toolMsg);
        }

        // remind：照常执行了，但要在观察之后追加一条提醒，把模型拽回正轨。
        // 用 user 角色注入（而非 system）—— 多数模型对话中途只认 user/assistant/tool 三种角色，
        // 中途插 system 在部分 provider 上会被丢弃或报错。
        if (verdict.action === 'remind') {
          emit({ type: 'info', message: '已注入运行时纠偏提醒' });
          messages.push({ role: 'user', content: verdict.reminder });
        }

        // ── 图片注入：fs_read 读到的图片在这里变成模型真正"看得见"的输入 ──
        // 必须放在所有 tool 消息之后（tool 消息要紧跟 assistant 的 tool_calls，中间不能插别的角色）。
        const imgs = drainImages(sessionId);
        if (imgs.length) {
          messages.push({
            role: 'user',
            content: '【以下是刚才 fs_read 读取到的图片，请直接查看】\n' +
              imgs.map((im, i) => `${i + 1}. ${im.path}`).join('\n'),
            images: imgs.map((im) => im.b64),
            imageMimes: imgs.map((im) => im.mime),
          });
          emit({ type: 'info', message: `已注入 ${imgs.length} 张图片供模型直接查看` });
        }

        if (argFailVerdict && argFailVerdict.action === 'abort') {
          const msg = argFailVerdict.message;
          sessions.append(sessionId, { role: 'assistant', content: msg });
          this.hooks?.onComplete?.({ task: userInput, result: msg, success: false });
          this.hooks?.onFinish?.({ span: span, status: 'error', error: msg });
          this.reflect({ goal: userInput, success: false, toolCallCount, toolNames, summary: msg.slice(0, 200), lesson: 'loop_guard_abort' });
          return msg;
        }

        continue; // 携带工具结果再问一次模型
      }

      // 最终文本答复
      let finalText = (resp.content || '').trim();

      // ═══════════════════════════════════════════════════════════
      // 幻觉防护：检测"零工具调用但声称已完成"的编造模式
      // 本轮无 tool_calls + 历史无工具执行（toolCallCount===0）+ 文本声称文件操作已完成
      // → 注入 system-reminder 强制模型真正调用工具，继续循环而非直接返回幻觉文本
      // ═══════════════════════════════════════════════════════════
      const fabrication = detectFabricatedClaims(finalText, toolCallCount, rawCalls.length);
      if (fabrication) {
        emit({ type: 'info', message: `[幻觉防护] 检测到编造声明: "${fabrication}"，注入纠正提醒` });
        messages.push({ role: 'user', content: LoopGuard.hallucinationGuard(fabrication) });
        continue;
      }

      // 工具已执行、但模型在收尾轮返回空内容（本地弱模型读到大工具结果后偶发"空转收尾"）。
      // 多问一轮让它基于已有工具结果给结论，避免把空串直接丢给用户——这是让弱模型也"能用"的关键兜底。
      if (!finalText && toolCallCount > 0) {
        if (!recovered) {
          recovered = true;
          emit({ type: 'info', message: '检测到最后一轮答复为空，触发一次收尾补问' });
          messages.push({ role: 'user', content: '请基于上方工具已返回的结果，直接给出你的最终答复（不要再调用任何工具）。' });
          continue;
        }
        const fb = '（工具已执行完毕，但未能生成文字总结。请查看上方工具返回的结果。）';
        sessions.append(sessionId, { role: 'assistant', content: fb });
        this.hooks?.onComplete?.({ task: userInput, result: fb, success: true });
        this.hooks?.onFinish?.({ span: span, status: 'ok' });
        this.reflect({ goal: userInput, success: true, toolCallCount, toolNames, summary: fb, lesson: 'empty_final_response' });
        return fb;
      }
      // ── 质量兜底：TaskVerifier 验证最终答复是否真的完成任务（闭环修复）──
      // 命中"声称完成但文件缺失 / 输出含失败断言"等严重问题时，注入 retryHint 让模型再修一轮
      // （最多 1 次修正，避免死循环；验证失败/异常不影响主流程）。
      const MAX_VERIFY_CORRECTIONS = 1;
      if (finalText && verifyCorrections < MAX_VERIFY_CORRECTIONS) {
        let v: any = null;
        try {
          v = this.verifier.verify({ goal: userInput, result: finalText });
          this.verifier.record(v);
          this.confidence.log(userInput, v.verified, v.confidence, v.issues);
          // 反思→学习闭环接线（闭环修复）：把每次验证结果喂给 Learning Engine 的
          // learnFromReflection —— 失败反思记高重要性记忆，成功反思沉淀知识。
          // 此前该函数零调用者，「反思→学习」环断裂。
          try {
            learning.learnFromReflection({
              goal: userInput.slice(0, 200),
              verification: { verified: v.verified, confidence: v.confidence, issues: v.issues },
              reflection: { needRetry: v.shouldRetry, reason: v.retryHint },
            });
        } catch { /* 反思学习失败不影响主流程 */ }

      // ── 诚实度追踪驱动低置信复审（core 改动②）──
      // 已通过验证但置信度偏低，或命中 ConfidenceTracker 已知的"易失败模式"时，
      // 触发一次针对性复核（重新让模型自检），封顶 1 次避免死循环。
      const LOW_CONF = 0.6;
      const risky = this.confidence.isRiskyTask(userInput);
      if (v && v.verified && confidenceRecheck < 1 && (v.confidence < LOW_CONF || risky)) {
        confidenceRecheck++;
        emit({ type: 'info', message: `[置信度复审] 验证通过但 confidence=${(v.confidence * 100 | 0)}%${risky ? '，命中已知易失败模式' : ''}，触发一次针对性复核` });
        try {
          appendConfidenceRecheck({ goal: userInput.slice(0, 200), verified: v.verified, confidence: v.confidence, risky, issues: v.issues, at: Date.now() });
        } catch { /* 落盘失败不影响主流程 */ }
        messages.push({ role: 'user', content: '【置信度偏低·请复核】请重新核对你的结论：是否遗漏关键步骤、是否含未经工具验证的编造内容、文件路径与数据是否真实准确。确认无误后再给出最终答复。' });
        continue;
      }
      if (v && !v.verified && v.shouldRetry && v.retryHint) {
            verifyCorrections++;
            emit({ type: 'info', message: `[任务验证] 未通过: ${v.retryHint.slice(0, 60)}` });
            messages.push({
              role: 'user',
              content: '【任务验证未通过】' + v.retryHint +
                '\n请基于上方工具返回的真实结果修正（必要时重新调用工具完成未完成的部分），' +
                '不要声称完成尚未真正完成的操作。完成后直接给出最终答复。',
            });
            continue;
          }
        } catch { /* 验证失败不影响主流程 */ }
      }
      sessions.append(sessionId, { role: 'assistant', content: finalText });
      this.hooks?.onComplete?.({ task: userInput, result: finalText, success: true });
      this.hooks?.onFinish?.({ span: span, status: 'ok' });
      this.reflect({ goal: userInput, success: true, toolCallCount, toolNames, summary: finalText.slice(0, 200) });
      return finalText;
    }

    const fallback = '（已达最大推理步数，未能生成最终答复）';
    this.reflect({ goal: userInput, success: false, toolCallCount, toolNames, summary: fallback, lesson: 'loop_max_steps_exceeded' });
    sessions.append(sessionId, { role: 'assistant', content: fallback });
    this.hooks?.onComplete?.({ task: userInput, result: fallback, success: false });
    this.hooks?.onFinish?.({ span: span, status: 'error', error: fallback });
    return fallback;
  }

  /** ReflectionPhase：任务执行后自反思（审计建议 #2）
   *  同时触发 Tier 1 自动日志捕获 + Phase 7 三方案进化
   *  - 失败 → ERRORS.md
   *  - 成功 → 用户画像演化 + 成功模式挖掘 */
  private async reflect(params: {
    goal: string;
    success: boolean;
    toolCallCount: number;
    summary: string;
    lesson?: string;
    toolNames?: string[];
    tokensUsed?: number;
    durationMs?: number;
  }) {
    const entry: ReflectionEntry = {
      timestamp: Date.now(),
      goal: params.goal,
      success: params.success,
      toolCallCount: params.toolCallCount,
      summary: params.summary.slice(0, 200),
      lesson: params.lesson || (params.success ? undefined : 'task_failed'),
    };
    recordReflection(entry);

    // ── Tier 1: 自动错误捕获 → .learnings/ ──
    try {
      captureReflection({
        goal: params.goal,
        success: params.success,
        toolCallCount: params.toolCallCount,
        summary: params.summary,
        lesson: params.lesson,
        timestamp: Date.now(),
      });
    } catch { /* 自动日志捕获失败不影响主流程 */ }

    // ── 方案一：用户画像演化（每次对话都学习） ──
    try {
      const provider = this.deps.provider;
      evolveUserModel(params.summary, params.goal, params.success, provider).catch(() => {});
    } catch { /* 画像演化失败不影响主流程 */ }

    // ── 方案三：成功经验挖掘 ──
    if (params.success && params.toolCallCount > 0) {
      try {
        mineSuccess({
          goal: params.goal,
          userInput: params.goal,
          toolNames: params.toolNames || [],
          outputFormat: 'paragraph',
          tokensUsed: params.tokensUsed || 0,
          durationMs: params.durationMs || 0,
        });
      } catch { /* 成功挖掘失败不影响主流程 */ }
    }

    // ── 自进化完成后自动打 checkpoint（还原点）──
    // 普通对话不会改动源码 → git status 为空 → 直接跳过（no-op）；
    // 自进化改动源码时自动提交，便于出问题时一键回退。
    try {
      await gitCheckpoint('post-task self-evolution');
    } catch { /* checkpoint 失败绝不影响主流程 */ }
  }
}

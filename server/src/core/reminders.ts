// 运行时纠偏机制（system-reminder）。
//
// ── 为什么要重写护栏 ──────────────────────────────────────────────────
// harness 原先有 6 道护栏（A 完全重复 / B2 组合重复 / B 同工具连发 /
// C 只读空转 / D 连续 fs_write / E 参数校验连败），但它们**全是熔断**：
// 一旦触发就 return 一句"已主动停止"，任务当场失败。
//
// 这有两个致命问题：
//   1) 惩罚过重。模型可能只是第 6 次才走对路，护栏在第 5 次把它枪毙了。
//   2) 模型学不到东西。它收到的是"对话结束"，而不是"你哪里错了、该怎么改"。
//
// WorkBuddy 内核的做法完全不同：在模型偏离时，往上下文里注入一段
// `<system-reminder>`——结构化、带具体纠正指令的运行时提醒，把它拽回正轨，
// 然后**让它继续跑**。只有反复提醒仍不改的情况下才真正终止。
//
// 本模块把 harness 的熔断式护栏改造成三级响应：
//   L1 提醒（remind）  → 注入 system-reminder，正常执行，让模型自己纠正
//   L2 拦截（block）   → 不执行这次调用（已确证无意义），用提醒替代工具结果
//   L3 终止（abort）   → 多次提醒无效才熔断，且给出的是"已获得的信息 + 收尾要求"
//
// 效果：原本 5 次就判死刑的场景，现在有 2~3 次自我纠正的机会。

export type Verdict =
  | { action: 'proceed' }
  | { action: 'remind'; reminder: string }
  | { action: 'block'; reminder: string }
  | { action: 'abort'; message: string };

export interface GuardCall {
  name: string;
  arguments: Record<string, any>;
}

/** 包装成模型能稳定识别的结构化提醒块。 */
export function systemReminder(role: string, body: string): string {
  return `<system-reminder data-role="${role}">\n${body}\n</system-reminder>`;
}

// 只读/查询类工具：只在它们之间打转说明没有产出
const READ_ONLY_TOOLS = new Set(['fs_read', 'fs_list', 'use_skill', 'list_skills', 'tool_search']);

// ── 阈值：提醒早、熔断晚 ─────────────────────────────────────────────
const T = {
  /** 完全相同调用（含参数）重复几次开始拦截 */
  sameCallBlock: 2,
  /** 拦截后仍继续重复，累计几次才终止 */
  sameCallAbort: parseInt(process.env.AH_SAME_CALL_ABORT || '4', 10),
  /** 同一工具连发几次开始提醒 */
  sameToolRemind: parseInt(process.env.AH_SAME_TOOL_REMIND || '4', 10),
  /** 同一工具连发几次终止；0=无限（只提醒不终止，长任务不被截断） */
  sameToolAbort: parseInt(process.env.AH_SAME_TOOL_ABORT || '0', 10),
  /** 无序工具组合重复几轮开始提醒 */
  comboRemind: 2,
  comboAbort: parseInt(process.env.AH_COMBO_ABORT || '4', 10),
  /** 只读工具连续几次开始提醒；0=关闭提醒 */
  readonlyRemind: parseInt(process.env.AH_READONLY_REMIND || '5', 10),
  /** 只读工具连续几次终止；0=无限（只提醒不终止，查询类工具不熔断） */
  readonlyAbort: parseInt(process.env.AH_READONLY_ABORT || '0', 10),
  /** fs_write 连续几次开始提醒 */
  fsWriteRemind: 4,
  fsWriteAbort: parseInt(process.env.AH_FSWRITE_ABORT || '8', 10),
  /** 同一工具参数校验连败几次开始提醒 / 终止 */
  argFailRemind: 2,
  argFailAbort: parseInt(process.env.AH_ARGFAIL_ABORT || '4', 10),
};

export class LoopGuard {
  private callLog: string[] = [];
  private sigCounts = new Map<string, number>();
  private lastSetSig = '';
  private setRepeat = 0;
  private argFail = new Map<string, number>();
  /** 已发出的提醒种类 → 次数。同一类提醒发多了说明模型不听劝，要升级。 */
  private reminded = new Map<string, number>();
  /** 已拦截过的调用签名 → 上次返回结果的摘要，便于提醒时回述 */
  private blockedResults = new Map<string, string>();

  private bump(kind: string): number {
    const n = (this.reminded.get(kind) || 0) + 1;
    this.reminded.set(kind, n);
    return n;
  }

  /** 记录一次工具调用的结果摘要，供重复调用时回述"你上次已经拿到过这个"。 */
  noteResult(call: GuardCall, result: any) {
    const sig = call.name + ':' + JSON.stringify(call.arguments || {});
    let brief = '';
    try {
      const s = typeof result === 'string' ? result : JSON.stringify(result);
      brief = s.length > 300 ? s.slice(0, 300) + '…' : s;
    } catch { brief = String(result); }
    this.blockedResults.set(sig, brief);

    if (result && result.error === '参数校验失败') {
      this.argFail.set(call.name, (this.argFail.get(call.name) || 0) + 1);
    } else {
      this.argFail.delete(call.name);
    }
  }

  /** 参数校验连败的三级响应。在每个工具执行完后调用。 */
  checkArgFailure(toolName: string): Verdict {
    const c = this.argFail.get(toolName) || 0;
    if (c >= T.argFailAbort) {
      return {
        action: 'abort',
        message:
          `工具「${toolName}」参数校验已连续失败 ${c} 次，多次提醒后仍未纠正，本轮到此为止。` +
          '请基于已经获得的信息直接给出结论，或明确告诉我缺什么。',
      };
    }
    if (c >= T.argFailRemind) {
      return {
        action: 'remind',
        reminder: systemReminder('arg-correction',
          `你对工具「${toolName}」的参数已连续 ${c} 次校验失败。请停止用同样的方式重试，改为：\n` +
          '1. 仔细阅读上面返回的「参数说明」，逐个字段核对必填项、类型、枚举值；\n' +
          '2. 参数必须是严格 JSON 对象——键和字符串值都用双引号，不要尾随逗号、不要 Python 的 True/None；\n' +
          '3. 如果你其实不确定这个工具是不是该用的那个，先重新看一遍能力地图。' +
          '读文件用 fs_read、列目录用 fs_list、存记忆用 save_note；' +
          'run_skill_script 只在明确知道 skill + script 两个参数时才用，别对无关任务硬套。'),
      };
    }
    return { action: 'proceed' };
  }

  /**
   * 在执行本轮工具调用之前做检查。
   * 返回 proceed / remind（照常执行但附带提醒）/ block（不执行，用提醒当结果）/ abort。
   */
  inspect(calls: GuardCall[]): Verdict {
    for (const c of calls) this.callLog.push(c.name);
    if (this.callLog.length > 20) this.callLog.splice(0, this.callLog.length - 20);

    // ── 1. 完全相同的调用（工具名 + 参数全同）────────────────────────
    // 这是唯一"确证无意义"的情形：同样的输入必然得到同样的输出。
    // 所以不提醒了事，而是直接拦截——不浪费一次工具执行，把上次结果回述给模型。
    for (const c of calls) {
      const sig = c.name + ':' + JSON.stringify(c.arguments || {});
      const n = (this.sigCounts.get(sig) || 0) + 1;
      this.sigCounts.set(sig, n);

      if (n > T.sameCallAbort) {
        return {
          action: 'abort',
          message:
            `「${c.name}」以完全相同的参数被调用了 ${n} 次，多次提醒后仍在重复，已停止。` +
            '当前可用工具似乎无法完成这个请求。请基于已获得的信息给出结论，或说明还缺什么能力。',
        };
      }
      if (n >= T.sameCallBlock) {
        const prev = this.blockedResults.get(sig) || '(无记录)';
        this.bump('same-call');
        return {
          action: 'block',
          reminder: systemReminder('duplicate-call',
            `你正在用**完全相同的参数**第 ${n} 次调用「${c.name}」。相同输入必然得到相同输出，` +
            '这次调用已被拦截，没有真正执行。\n\n' +
            `上一次的返回是：\n${prev}\n\n` +
            '请换个思路：\n' +
            '· 如果上次结果里有报错和 hint 字段，按 hint 说的做，不要原样重试；\n' +
            '· 如果是路径不对，先用 fs_list 列目录看真实文件名，别靠猜；\n' +
            '· 如果这个工具本来就不适合当前任务，换一个工具；\n' +
            '· 如果信息其实已经够了，直接给出最终答复。'),
        };
      }
    }

    // ── 2. 无序工具组合重复（如反复 [skill_xlsx, fs_write, run_skill_script]）──
    // 注意：只处理"多个不同工具的组合"。单工具连发交给下面第 3 条，
    // 那里能给出针对该工具的具体建议（如 fs_read → 别猜路径、用 next_offset 续读），
    // 比这里的泛化提醒有用得多。
    const names = [...new Set(calls.map((c) => c.name))].sort();
    const setSig = names.join(',');
    if (setSig === this.lastSetSig) this.setRepeat++; else { this.setRepeat = 0; this.lastSetSig = setSig; }
    if (names.length < 2) {
      // 单工具场景跳过组合护栏（但计数已更新，供组合场景恢复时使用）
    } else if (this.setRepeat >= T.comboAbort) {
      return {
        action: 'abort',
        message: `工具组合「${setSig}」已重复 ${this.setRepeat + 1} 轮且没有任何推进，已停止。请基于现有信息作答。`,
      };
    } else if (this.setRepeat >= T.comboRemind) {
      const times = this.bump('combo');
      return {
        action: 'remind',
        reminder: systemReminder('loop-detected',
          `注意：你已经连续 ${this.setRepeat + 1} 轮在重复同一组工具「${setSig}」，但任务没有实质推进。\n` +
          (times >= 2 ? '**这是第 ' + times + ' 次提醒了。** ' : '') +
          '请停下来想一想：\n' +
          '1. 我要的最终产物到底是什么？（一份文档？一个答案？一个文件？）\n' +
          '2. 现在手里已经有哪些信息，够不够直接产出？\n' +
          '3. 如果够了 → 立刻产出，不要再调工具。如果不够 → 缺的那一块该用哪个**不同的**工具拿？\n' +
          '不要再原样重跑这组工具。'),
      };
    }

    // ── 3. 同一工具连发（参数可不同，如反复 fs_read 猜路径）────────────
    const recentSame = T.sameToolAbort > 0 ? this.callLog.slice(-T.sameToolAbort) : [];
    if (T.sameToolAbort > 0 && recentSame.length >= T.sameToolAbort && recentSame.every((n) => n === recentSame[0])) {
      return {
        action: 'abort',
        message: `工具「${recentSame[0]}」已连续调用 ${T.sameToolAbort} 次仍无进展，已停止。请基于已获得的信息给出结论。`,
      };
    }
    const recentR = this.callLog.slice(-T.sameToolRemind);
    if (recentR.length >= T.sameToolRemind && recentR.every((n) => n === recentR[0])) {
      const tool = recentR[0];
      const times = this.bump('same-tool:' + tool);
      if (times <= 3) {
        return {
          action: 'remind',
          reminder: systemReminder('strategy-shift',
            `你已经连续 ${T.sameToolRemind} 次调用「${tool}」。` +
            (tool === 'fs_read'
              ? '如果是在找文件，**别再猜路径了**——用 fs_list 列出目录看真实文件名（注意大小写、空格、中文）。' +
                '如果是在读大文件，用返回值里的 next_offset 续读，而不是换着参数瞎试。'
              : '同一个工具连着用这么多次，通常意味着方法不对。') +
            '\n请换一种手段，或者判断信息是否已经足够、直接产出结果。'),
        };
      }
    }

    // ── 4. 只读工具空转（查了半天没有任何产出动作）────────────────────
    const recentRO = T.readonlyAbort > 0 ? this.callLog.slice(-T.readonlyAbort) : [];
    if (T.readonlyAbort > 0 && recentRO.length >= T.readonlyAbort && recentRO.every((n) => READ_ONLY_TOOLS.has(n))) {
      return {
        action: 'abort',
        message:
          `已连续 ${T.readonlyAbort} 次只调用查询类工具而没有任何产出，已停止。` +
          '请把已经查到的内容整理成答复给用户。',
      };
    }
    const recentRO2 = T.readonlyRemind > 0 ? this.callLog.slice(-T.readonlyRemind) : [];
    if (T.readonlyRemind > 0 && recentRO2.length >= T.readonlyRemind && recentRO2.every((n) => READ_ONLY_TOOLS.has(n))) {
      const times = this.bump('readonly');
      if (times <= 3) {
        return {
          action: 'remind',
          reminder: systemReminder('no-progress',
            `你已经连续 ${T.readonlyRemind} 次都在调用只读/查询类工具（${[...new Set(recentRO2)].join(' / ')}），` +
            '但一直没有产出任何东西。\n' +
            '· 如果用户要的是**一份文档** → 现在就用 create_docx / create_pdf / create_xlsx / create_pptx 生成；\n' +
            '· 如果用户要的是**一个答案** → 现在就直接回答，查到的已经够了；\n' +
            '· 如果确实还缺关键信息 → 说清楚缺什么，别继续无目的地翻。'),
        };
      }
    }

    // ── 5. 连续 fs_write（常见于用纯文本冒充 Office 文档）──────────────
    const recentW = this.callLog.slice(-T.fsWriteAbort);
    if (recentW.length >= T.fsWriteAbort && recentW.every((n) => n === 'fs_write')) {
      return {
        action: 'abort',
        message: `已连续 ${T.fsWriteAbort} 次 fs_write 仍未完成目标，已停止。生成 Office 文档必须用 create_docx / create_pdf / create_xlsx / create_pptx。`,
      };
    }
    const recentW2 = this.callLog.slice(-T.fsWriteRemind);
    if (recentW2.length >= T.fsWriteRemind && recentW2.every((n) => n === 'fs_write')) {
      const times = this.bump('fswrite');
      if (times <= 3) {
        return {
          action: 'remind',
          reminder: systemReminder('wrong-tool',
            `你已经连续 ${T.fsWriteRemind} 次调用 fs_write。请确认你没有在做这两件蠢事：\n` +
            '1. 用 fs_write 写 .docx/.pdf/.xlsx/.pptx —— 那会生成打不开的损坏文件。' +
            'Word 用 create_docx、PDF 用 create_pdf、Excel 用 create_xlsx、PPT 用 create_pptx；\n' +
            '2. 把本该直接回答用户的内容（如"列出你会什么技能"）反复写进文件 —— 纯信息类问题直接回答就行。'),
        };
      }
    }

    return { action: 'proceed' };
  }

  /** 幻觉防护：检测到"零工具调用但声称已完成"时注入的强制纠正提醒。 */
  static hallucinationGuard(claimedAction: string): string {
    return systemReminder('hallucination-guard',
      `【严重】你的回复中声称${claimedAction}，但实际上本轮没有任何工具被执行——这是个幻觉。\n\n` +
      '你必须现在就真正调用工具来完成这个任务：\n' +
      '· 生成 Word 文档 → 用 create_docx\n' +
      '· 生成 Excel 文件 → 用 create_xlsx\n' +
      '· 生成 PDF → 用 create_pdf\n' +
      '· 生成 PPT → 用 create_pptx\n' +
      '· 读写文件 → 用 fs_read / fs_write\n' +
      '· 执行脚本 → 用 run_code\n\n' +
      '⚠️ 在工具真正执行并返回结果之前，禁止宣称任务已完成。\n' +
      '⚠️ 不要编造文件路径或文件大小——只有工具返回的结果里才有真实信息。');
  }

  /** 供预算超限时生成收尾提示。 */
  static budgetExhausted(used: number): string {
    return systemReminder('budget-exhausted',
      `本轮工具调用已达上限（${used} 次），工具通道现已关闭。\n` +
      '请**立刻**基于上文所有工具返回的信息给出最终答复：\n' +
      '· 已经查到/生成的内容，如实总结；\n' +
      '· 没做完的部分，明确说明卡在哪、还差什么；\n' +
      '· 不要再说"我将要去调用某工具"，你已经不能调用了。');
  }
}

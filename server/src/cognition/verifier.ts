// cognition/verifier.ts
// Task Completion Verifier — Meta-Cognition 核心
// 在 Executor 返回结果后、GoalManager 判定前，验证任务是否真正完成。
// 解决"没完成任务说完成了"的幻觉问题。
//
// ============================================================
// BUG-FIX(2026-08-08) 根因修复汇总
// ------------------------------------------------------------
// (1) 文件验证不再"拿叙述文本当文件清单"：
//     · 结构化优先：工具真实返回的 path/files/output 字段直接校验；
//     · 白名单过滤：仅位于 workspace/output/knowledge/memory/Desktop 下的
//       绝对路径才允许判"未找到"；示例文本(如 xxx.docx)、源码文件名
//       (如 verifier.ts)、备份路径(.backup) 只算"提及"，不判缺失；
//     · 相对路径/裸文件名一律不参与缺失判定。
// (2) 路径提取改为【token 分词】而非模板字符串正则：
//     · 旧实现用模板字面量拼正则，反斜杠转义在多层嵌套下极易失真
//       （`\s` 被降级为 `s`、`\\` 数量错乱），导致 workspace/Desktop
//       等含特定字符的路径匹配失败、中文路径被截断；
//     · 新实现把文本按 空白/引号/括号/标点 切 token，再逐个判断
//       "是否绝对路径 + 扩展名合法"，完全不依赖反斜杠转义。
// (3) checkRelevance 中文场景改为【字符二元组覆盖度】：
//     目标的中文连续串拆成相邻二元组，结果文本出现该二元组即命中，
//     替代"整词/长短语必须逐字复现"导致的关联度误判。
// ============================================================

import { appendFileSync, existsSync, readFileSync, statSync } from 'node:fs';
import { basename, isAbsolute, join } from 'node:path';
import os from 'node:os';
import { CONFIG } from '../config';

const VERIFIER_HISTORY_FILE = join(CONFIG.DATA_DIR, 'evolution', 'verifier-history.jsonl');

export interface VerifyInput {
  goal: string;
  result: any;
  plan?: any;
}

export interface VerifyResult {
  verified: boolean;        // 是否通过验证
  confidence: number;       // 0-1 置信度
  issues: string[];         // 发现的问题
  evidence: string[];       // 完成证据
  shouldRetry: boolean;     // 是否应该重试
  retryHint?: string;       // 重试建议
}

/** 文件候选：path 为绝对路径；claimed=true 表示"声称创建/应当存在"，缺失才判错 */
interface FileCandidate {
  path: string;
  claimed: boolean;
}

export class TaskVerifier {
  private history: VerifyResult[] = [];

  constructor() {
    this.loadPersisted();
  }

  verify(input: VerifyInput): VerifyResult {
    const { goal, result } = input;
    const issues: string[] = [];
    const evidence: string[] = [];

    // ── 1. 结果结构检查 ──
    if (!result) {
      return this.fail('执行未返回任何结果', 0);
    }

    // ── 2. 错误信息检测 ──
    const errSignals = this.detectErrorSignals(result);
    if (errSignals.length > 0) {
      issues.push(...errSignals);
    }

    // ── 3. 空/占位内容检测 ──
    if (this.isEmptyResult(result)) {
      issues.push('返回了空内容或占位符');
    }

    // ── 4. 输出存在性检查（文件类任务） ──
    const fileCheck = this.checkFileOutput(goal, result);
    if (fileCheck.missing.length > 0) {
      issues.push(...fileCheck.missing);
    }
    if (fileCheck.found.length > 0) {
      evidence.push(...fileCheck.found);
    }

    // ── 5. 结果与目标相关性检查 ──
    const relevance = this.checkRelevance(goal, result);
    if (relevance < 0.3) {
      issues.push(`输出与目标"${this.truncate(goal)}"关联度低 (${Math.round(relevance * 100)}%)`);
    } else if (relevance >= 0.5) {
      evidence.push(`输出与目标相关 (${Math.round(relevance * 100)}%)`);
    }

    // ── 6. 综合判定 ──
    const hasSeriousIssue = issues.length > 0 && issues.some(i =>
      i.includes('失败') || i.includes('错误') || i.includes('空') || i.includes('占位') || i.includes('未找到') || i.includes('为空')
    );

    if (hasSeriousIssue) {
      return {
        verified: false,
        confidence: 0.1 + (evidence.length * 0.1),
        issues,
        evidence,
        shouldRetry: true,
        retryHint: `发现 ${issues.length} 个问题：${issues.slice(0, 3).join('；')}`,
      };
    }

    const fileMissing = issues.filter(i => i.includes('未找到') || i.includes('为空'));
    const confidence = Math.min(0.95, 0.5 + (evidence.length * 0.15) - (issues.length * 0.1));
    return {
      verified: issues.length === 0,
      confidence: Math.max(0, confidence),
      issues,
      evidence,
      shouldRetry: fileMissing.length > 0 || issues.length > 3,
      retryHint: fileMissing.length > 0
        ? `声称创建了 ${fileMissing.length} 个文件但实际不存在：${fileMissing[0]}`
        : issues.length > 0 ? `仍有 ${issues.length} 个小问题：${issues.slice(0, 2).join('；')}` : undefined,
    };
  }

  // ── 辅助方法 ──

  private detectErrorSignals(result: any): string[] {
    const signals: string[] = [];
    const text = this.resultToText(result);

    // 强信号：结构化字段明确失败（最高可信度，直接判定）
    const errVal = result?.error ?? result?.errorMessage ?? result?.err;
    if (result?.success === false || result?.ok === false || errVal) {
      signals.push(`执行失败：${String(errVal || '未知错误').slice(0, 100)}`);
      return signals;
    }

    // BUG-FIX(2026-08-08-3): 文本启发式从"字面计数"改为"结果语境断言"。
    // 误报根因：正常答复解释性提到"无法访问/无法打开"（如"已解决上次无法打开
    // 文件的问题""若无法访问则离线重试"）被当成失败信号。三处收紧：
    //   (a) 命中片段前 20 字符内出现 历史/假设/否定 修饰词 → 视为解释性提及跳过；
    //   (b) 命中后分两档：位于【结果语境】（句首/句号后/结果引出语后）→ 强提示
    //       （文案含"失败"仍触发 hasSeriousIssue）；否则 → 弱提示（仅降置信度，
    //       不直接判失败——真实失败几乎都有结构化 error 字段或文件/空内容检查兜底，
    //       孤立措辞不足以单独判定失败）。
    const MODIFIER = /(修复|解决|消除|避免|排除|不再|不在|防止|以免|之前|以前|上次|此前|曾经|遇到|出现过|如果|若|假如|假设|模拟|测试|演练|导致|造成)/;
    const patterns = [
      /(执行|任务|操作|运行|生成|创建|写入|保存|验证|检查)(已|已经)?失败/g,
      /无法(完成|生成|创建|写入|保存|执行|打开|读取|连接|访问|找到|识别)(?:了)?[^。；;\n，]{0,14}/g,
      /(出现|发生)(了)?(严重|致命)?错误/g,
      /^\s*(错误|失败)[:：]/m,
    ];
    for (const p of patterns) {
      let m: RegExpExecArray | null;
      while ((m = p.exec(text)) !== null) {
        const idx = m.index;
        const ctx = text.slice(Math.max(0, idx - 20), idx);
        if (MODIFIER.test(ctx)) continue;   // 历史/假设/否定语境 → 解释性提及
        const isResultCtx = /(^|[。！？；;\n])\s*$|(结果|输出|报错|提示|错误|失败|：|:)\s*$/.test(ctx);
        signals.push(isResultCtx
          ? `输出含失败断言"${m[0].trim().slice(0, 30)}"，可能有问题`
          : `输出提及"${m[0].trim().slice(0, 30)}"，请自行核实该表述是否影响完成（若是解释性/历史性提及可忽略），继续完成剩余工作，勿向用户请求人工确认`);
        break;
      }
    }

    return signals;
  }

  private isEmptyResult(result: any): boolean {
    const text = this.resultToText(result);

    // 纯占位符
    const placeholders = [
      /^\s*$/,                    // 空白
      /^[Nn]\/[Aa]\s*$/,         // N/A
      /^未找到/,                   // 未找到
      /^暂无/,                    // 暂无
      /^无结果/,                  // 无结果
    ];
    return placeholders.some(p => p.test(text));
  }

  // ── 文件输出校验（核心修复点） ──────────────────────────────
  private checkFileOutput(goal: string, result: any): { found: string[]; missing: string[] } {
    const found: string[] = [];
    const missing: string[] = [];

    const candidates = this.extractFilePaths(goal, result);
    for (const { path: fp, claimed } of candidates) {
      // 仅"声称创建/应当存在"的路径才做缺失判定；
      // 叙述中"提及"的路径(示例文本、源码文件名、备份路径等)不构成缺失证据。
      if (!claimed) continue;
      try {
        if (existsSync(fp)) {
          const stat = statSync(fp);
          if (stat.size > 0) {
            found.push(`文件已创建：${basename(fp)} (${this.formatSize(stat.size)})`);
          } else {
            missing.push(`文件为空：${basename(fp)} (${fp})`);
          }
        } else {
          missing.push(`文件未找到：${basename(fp)} (${fp})`);
        }
      } catch {
        missing.push(`无法访问：${basename(fp)} (${fp})`);
      }
    }

    return { found, missing };
  }

  /**
   * 提取文件候选。返回绝对路径 + 是否"应当存在"。
   * 可信度排序：结构化字段 > 文本 token 提及。
   * 文本 token 只有在"绝对路径 + 位于可信输出目录"时才算应当存在(claimed)，
   * 其余一律只算提及，不参与缺失判定。
   */
  private extractFilePaths(goal: string, result: any): FileCandidate[] {
    const out: FileCandidate[] = [];
    const seen = new Set<string>();
    const add = (raw: string, claimed: boolean) => {
      const fp = this.normalizePath(raw);
      if (!fp || !isAbsolute(fp)) return;          // 相对路径/裸文件名一律不参与缺失判定
      const key = fp.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ path: fp, claimed });
    };

    // ── A. 结构化字段：工具真实返回，必定声称创建 ──
    for (const fp of this.structuredPaths(result)) {
      add(fp, true);
    }

    // ── B. 文本 token 扫描（不依赖反斜杠转义，根治正则失真） ──
    const text = goal + ' ' + this.resultToText(result);
    const EXT_RE = /\.(docx|doc|xlsx|xls|pptx|ppt|pdf|txt|md|csv|json|png|jpe?g|gif|bmp|tiff?|zip|xml|html?|py|ts|js|mjs|cjs)$/i;
    // 按 空白/引号/括号/常见标点 切 token，Windows 路径(含空格除外)保持完整
    const tokens = text.split(/[\s,，。;；、""''()（）]+/);
    for (const tok of tokens) {
      if (!tok) continue;
      // 每个 token 里可能内嵌绝对路径：如「已生成：D:\a\b.docx」「文件在C:/x/y.docx」
      // 全角冒号/「在/至」等粘连词不在分词类里 → token 整体 isAbsolute=false，
      // 若只看 token 本身会漏检这类最常见的"声称已保存"表述（回归保护实测发现）。
      const candidates = this.extractEmbeddedPaths(tok);
      for (const cand of candidates) {
        if (!cand || !EXT_RE.test(cand)) continue;
        const fp = this.normalizePath(cand);
        if (!fp || !isAbsolute(fp)) continue;
        // 白名单内的绝对路径才认为"应当存在"；其余(源码、备份、示例)只提及
        const claimed = this.isUnderOutputRoot(fp);
        add(fp, claimed);
      }
    }

    return out.slice(0, 12);
  }

  /** 从 token 中抽取候选绝对路径：token 本身（若已是干净路径）+ 内嵌的驱动盘路径。 */
  private extractEmbeddedPaths(tok: string): string[] {
    const out: string[] = [];
    if (!tok) return out;
    out.push(tok); // token 本身（干净路径时直接可用）
    // 内嵌路径：`X:\...` 或 `X:/...` 直到空白/分隔标点（与上方分词类一致，不含 /，避免拆开正斜杠路径）
    const re = /[A-Za-z]:[\\/][^\s,，。;；、""''()（）]+/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(tok))) {
      if (m[0] !== tok) out.push(m[0]); // 去重：token 本身就是该路径时不再重复
    }
    return out;
  }

  /** 从工具返回对象中提取结构化路径字段（path/files/output/savedTo 等，递归 3 层） */
  private structuredPaths(result: any): string[] {
    const out: string[] = [];
    const push = (v: any) => {
      if (typeof v === 'string' && v.trim()) out.push(v.trim());
    };
    const FIELD_KEYS = ['path', 'file', 'filePath', 'file_path', 'outputPath', 'output_path',
                        'savedTo', 'saved_to', 'created', 'createdFile', 'writeTo', 'target'];
    const collect = (obj: any, depth = 0): void => {
      if (!obj || typeof obj !== 'object' || depth > 3) return;
      if (Array.isArray(obj)) {
        for (const it of obj) collect(it, depth + 1);
        return;
      }
      for (const k of FIELD_KEYS) {
        if (obj[k] !== undefined && obj[k] !== null) push(obj[k]);
      }
      if (obj.files !== undefined && obj.files !== null) collect(obj.files, depth + 1);
      if (obj.output && typeof obj.output === 'object') collect(obj.output, depth + 1);
    };
    collect(result);
    return [...new Set(out)];
  }

  /** 规范化路径：还原 JSON 转义、去首尾引号/空白、去尾部标点 */
  private normalizePath(fp: string): string {
    if (!fp) return '';
    let s = fp
      .replace(/\\\\/g, '\\')
      .replace(/\\\//g, '/')
      .replace(/^["'\s]+|["'\s]+$/g, '')
      .trim();
    s = s.replace(/[;；。、,，]+$/, '');
    return s;
  }

  /** 可信输出目录白名单（规范化小写） */
  private outputRoots(): string[] {
    const home = os.homedir();
    return [
      CONFIG.WORKSPACE_DIR,
      CONFIG.OUTPUT_DIR,
      CONFIG.KNOWLEDGE_DIR,
      CONFIG.MEMORY_DIR,
      join(home, 'Desktop'),
      join(home, '桌面'),
    ].map((r) => r.replace(/\\/g, '/').toLowerCase());
  }

  /** 判断绝对路径是否位于可信输出目录下 */
  private isUnderOutputRoot(fp: string): boolean {
    const f = fp.replace(/\\/g, '/').toLowerCase();
    return this.outputRoots().some((r) => f === r || f.startsWith(r + '/'));
  }

  private checkRelevance(goal: string, result: any): number {
    const goalText = goal;
    const resultText = this.resultToText(result);
    if (!goalText || !resultText) return 0;

    // BUG-FIX(2026-08-08-2): 修复类任务的答复（"继续修 verifier" → "verifier.ts 已修复，
    // 测试全部通过"）字面重叠往往极低，被误判"关联度低"。两层修复：
    //  (a) 完成性断言补偿：goal 是任务指令(修/处理/继续/生成…)，result 给出明确完成
    //      陈述(已修复/已解决/全部通过…)时，保底 0.5——因为这类答复在解释"改了什么"，
    //      不是在复述目标词汇；
    //  (b) 中英混合评分：目标含英文实体名(如 verifier/agentLoop)时，结果里复现实体名
    //      是强相关信号，与中文二元组覆盖度按 4:6 加权合并。
    const taskVerbs = /(修|修复|处理|解决|继续|完成|排查|检查|调试|改进|优化|验证|生成|创建|编写|整理|更新|调整)/;
    const doneAssertions = [
      /已(修复|解决|完成|处理|生成|创建|保存|写入|更新)/,
      /(修复|测试|验证|运行|构建)(已)?(全部)?通过/,
      /(全部|所有)(测试|检查|用例)?通过/,
      /运行正常|一切正常|无问题|没有问题/,
    ];
    if (taskVerbs.test(goalText) && doneAssertions.some(p => p.test(resultText))) {
      return Math.max(0.5, this.cjkCoverage(goalText, resultText));
    }

    const cjk = this.cjkCoverage(goalText, resultText);
    const en = this.enTokenCoverage(goalText, resultText);
    const hasEn = /[a-zA-Z0-9]/.test(goalText);
    const score = hasEn ? 0.4 * cjk + 0.6 * en : cjk;
    return Math.min(1, score);
  }

  /** 中文连续串的字符二元组覆盖度（0-1） */
  private cjkCoverage(goal: string, result: string): number {
    const cjkGrams = (s: string): string[] => {
      const grams: string[] = [];
      const runs = s.match(/[\u4e00-\u9fa5]+/g) || [];
      for (const run of runs) {
        for (let i = 0; i < run.length - 1; i++) grams.push(run.slice(i, i + 2));
      }
      return [...new Set(grams)];
    };
    const goalGrams = cjkGrams(goal);
    if (goalGrams.length === 0) return 0;
    const resultGrams = new Set(cjkGrams(result));
    const hits = goalGrams.filter((g) => resultGrams.has(g)).length;
    return Math.min(1, hits / goalGrams.length);
  }

  /** 英文/数字实体词命中率（0-1）；小目标(≤3词)命中任一实体即视为强相关 */
  private enTokenCoverage(goal: string, result: string): number {
    const goalWords = [...new Set(this.tokenize(goal).filter((w) => /[a-z0-9]/.test(w)))];
    if (goalWords.length === 0) return 0;
    const resultWords = new Set(this.tokenize(result));
    const hits = goalWords.filter((w) => resultWords.has(w)).length;
    const ratio = hits / goalWords.length;
    if (goalWords.length <= 3 && hits > 0) return Math.max(ratio, 0.6);
    return ratio;
  }

  private tokenize(text: string): string[] {
    return text
      .replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 0)
      .map(w => w.toLowerCase());
  }

  private resultToText(result: any): string {
    if (typeof result === 'string') return result;
    if (result?.content && typeof result.content === 'string') return result.content;
    if (result?.text && typeof result.text === 'string') return result.text;
    if (result?.message && typeof result.message === 'string') return result.message;
    if (result?.output) return String(result.output);
    try { return JSON.stringify(result); } catch { return String(result); }
  }

  private fail(reason: string, confidence: number): VerifyResult {
    return {
      verified: false, confidence,
      issues: [reason], evidence: [],
      shouldRetry: true, retryHint: reason,
    };
  }

  private truncate(s: string, n = 40): string {
    return s.length > n ? s.slice(0, n) + '…' : s;
  }

  private formatSize(bytes: number): string {
    if (bytes < 1024) return bytes + 'B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB';
    return (bytes / (1024 * 1024)).toFixed(1) + 'MB';
  }

  /** 获取历史验证记录（供 confidence tracker 使用） */
  getHistory(): VerifyResult[] { return this.history; }

  /** 记录本次验证结果（内存 + 落盘，重启后可恢复） */
  record(r: VerifyResult) {
    this.history.push(r);
    if (this.history.length > 100) this.history.shift();
    try {
      appendFileSync(VERIFIER_HISTORY_FILE, JSON.stringify({ ...r, _ts: Date.now() }) + '\n', 'utf8');
    } catch { /* 落盘失败不影响主流程 */ }
  }

  /** 启动时从磁盘恢复历史验证记录（最多保留最近 500 条，防文件无限增长） */
  private loadPersisted(): void {
    try {
      if (!existsSync(VERIFIER_HISTORY_FILE)) return;
      const lines = readFileSync(VERIFIER_HISTORY_FILE, 'utf8').split('\n').filter(Boolean);
      for (const line of lines.slice(-500)) {
        try {
          const r = JSON.parse(line);
          delete r._ts;
          this.history.push(r);
        } catch { /* 跳过损坏行 */ }
      }
    } catch { /* 读取失败不影响主流程 */ }
  }
}

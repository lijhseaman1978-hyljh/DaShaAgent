import fs from 'node:fs';
import path from 'node:path';
import { CONFIG, ensureDir } from '../config';
import type { Provider, RunCallbacks, JobResult } from '../core/types';
import { MemoryManager } from '../memory';
import { RAG } from '../rag';
import { runPerception, scan } from '../cognition/perception';
import { buildIdleContext, processIdleResponse } from '../cognition/idleConsciousness';
import { extractAndLog } from '../cognition/feedbackPipeline';
import { ContextBuilder } from '../brain/contextBuilder';

export interface JobDef {
  name: string;
  cron: string; // 'daily HH:MM' | 'weekly MON HH:MM' | 'monthly D HH:MM' | 'every N'
  prompt: string;
  enabled?: boolean;
  lastRunAt?: number;
  build?: (memory: MemoryManager, rag: RAG) => Promise<string> | string; // 仅内置任务用，序列化时丢弃
}

const JOBS_FILE = path.join(CONFIG.DATA_DIR, 'jobs.json');
const HEARTBEAT_FILE = path.join(CONFIG.DATA_DIR, 'heartbeat.jsonl');

// 心跳文件最多保留行数（约 24h：60s × 1440）
const HEARTBEAT_MAX_LINES = 2000;

const DEFAULT_JOBS: JobDef[] = [
  {
    name: 'perception_loop',
    cron: 'every 240',
    prompt: '感知循环：build 函数处理，此 prompt 仅占位',
    enabled: true,
    build: async () => {
      const report = scan();
      if (!report) return 'FAIL: 感知扫描失败 — 无法读取系统状态';

      const ok = runPerception();
      ContextBuilder.flushPerceptionCache();

      const statusIcon = ok ? 'OK' : 'WRITE_FAIL';
      const parts: string[] = [];
      parts.push(report.time);
      parts.push(`${report.sessionCount}个用户会话`);

      if (report.activeSession) {
        const name = (report.activeSession.title || report.activeSession.id.slice(-12)).slice(0, 40);
        parts.push(`最近: ${name} (${report.activeSession.messages}条/${Math.round(report.activeSession.tokens / 1000)}k)`);
      }

      const onlineCount = report.modelHealth.filter(x => x.status === 'online').length;
      const totalCount = report.modelHealth.length;
      parts.push(`Provider: ${onlineCount}/${totalCount}在线`);

      if (report.warnings.length > 0) {
        parts.push(`⚠️ ${report.warnings.length}条异常`);
      } else {
        parts.push('系统正常');
      }

      return `[感知摘要 · ${statusIcon}] ${parts.join(' | ')}`;
    },
  },
  {
    name: 'idle_loop',
    cron: 'every 480',
    prompt: '',
    enabled: true,
    build: async () => buildIdleContext(),
  },
  {
    name: 'self_learning',
    cron: 'every 720',
    prompt: `## 自学层复盘

你是 DaShaAgent 的自学模块。请从最近对话中自动发现教训并写入 LESSONS.md。

### 第一步：检查是否有新对话
- 读取 \`../memory/sessions.json\`
- 筛选掉系统会话（排除 \`job_\` 开头的 sessionId）
- 读取检查点文件 \`notes/self_learning_checkpoint.md\`
- 对比上一次分析的时间戳，找到新增消息

### 第二步：分析对话质量
- 如果 AI 多次试错才解决 → 提炼诊断类教训
- 如果 AI 犯了铁规里已有但未遵守的错误 → 标注"未遵守铁规"
- 如果用户纠正了 AI → 提炼认知类教训
- 特别关注 feedback 上下文中用户的评价信号

### 第三步：更新 LESSONS.md
- 新教训添加到表格顶部
- 如果已有类似教训，合并而非重复
- 更新检查点

### 第四步：输出摘要
- 用一段话总结：新增几条教训、主要类别、有无趋势变化`, 
    enabled: true,
    build: async () => {
      const fb = extractAndLog();
      return '【反馈管道分析结果】\n' + fb + '\n\n请结合以上反馈信号进行本次自学复盘。';
    },
  },
  {
    name: 'daily_brief',
    cron: 'daily 07:00',
    prompt: '请生成今日《海事简报》，重点关注：IMO 新规动态、全球 PSC 检查趋势、航海气象预警、值得关注的海事新闻。结论先行，分点列出，标注对航行安全的潜在影响。',
    enabled: true,
  },
  {
    name: 'weekly_psc',
    cron: 'weekly MON 09:00',
    prompt: '请生成本周《PSC 检查动态分析》，按地区分类，涵盖：高频缺陷 Top5、当前 CIC 集中检查、典型滞留案例、备忘录公告。用表格呈现，给出船上自查建议。',
    enabled: true,
  },
  {
    name: 'monthly_reg',
    cron: 'monthly 1 10:00',
    prompt: '请生成本月《法规更新综述》，梳理过去一个月生效或即将生效的 IMO/MARPOL/PSC 相关规则变化，标注生效日期、适用船型与合规要点。',
    enabled: true,
  },
];

// ── 调度语义调整（2026-08-08）──────────────────────────────────────────
// 1. 时区：不绑定任何固定时区，全部使用服务器本地时间 new Date()（getHours/getMinutes）。
//    服务器时区变化 → 任务触发时刻自动跟随变化，无需改代码、无需重启改配置。
// 2. 去重：移除「当天是否已运行（lastRunAt）」的持久化去重。
//    - 手动触发（triggerNow / /api/jobs POST）【不】写入 firedKeys → 不影响自动触发。
//    - 只要到达设定 HH:MM，无论当天手动触发过多少次，都会自动触发运行。
//    - 为避免「到点后每分钟重复触发」，改用【进程内】周期级 firedKeys：
//      同一天（daily）/ 同一周（weekly）/ 同月（monthly）只自动触发一次；
//      服务重启后 firedKeys 清空 → 已错过的任务会在下一个 tick 自然补跑（与原设计一致）。
//    - 执行失败自动回滚标记 → 下一轮 tick 可重试。
// 3. lastRunAt 仅作「运行记录」展示，不再参与调度判断。
// 4. every N 格式（2026-08-09）：每 N 分钟触发，firedKey 按周期分钟取模；专用于感知循环等高频后台任务。
// ───────────────────────────────────────────────────────────────────────

// ── 心跳机制（2026-08-11）───────────────────────────────────────────────
// 目的：解决「调度器是否活着 / 何时宕过 / 错过了哪些 daily 任务」这个黑盒问题。
// 设计：Leaky Bucket 轻量版
//   1. 每次 tick() 结束后写一行 JSONL 到 data/heartbeat.jsonl
//   2. 行格式：{ ts, tick, fired:["job1"...], errors:0, memMB }
//   3. 自动截断，保留最近 HEARTBEAT_MAX_LINES 行（约 24h）
//   4. 启动时读取最后一行 → 计算宕机窗口 → 自动补跑错过的 daily 任务
// 开销：每 60s 约 150 字节，日均 216KB，截断后稳定在 ~300KB
// ───────────────────────────────────────────────────────────────────────

function sameDay(ts: number | undefined, d: Date): boolean {
  if (!ts) return false;
  const t = new Date(ts);
  return t.getFullYear() === d.getFullYear() && t.getMonth() === d.getMonth() && t.getDate() === d.getDate();
}

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export class Scheduler {
  private timer: NodeJS.Timeout | null = null;
  private results: JobResult[] = [];
  private jobs: JobDef[] = [];
  private jobsFileMtime = 0;
  private firedKeys = new Set<string>();

  // ── 心跳状态 ──
  private tickCount = 0;
  private lastHeartbeatTs = 0;

  constructor(
    private getProvider: () => Provider,
    private memory: MemoryManager,
    private rag: RAG,
  ) { this.load(); }

  private loop: any = null;
  setLoop(loop: any): void { this.loop = loop; }

  private load() {
    try {
      const arr = JSON.parse(fs.readFileSync(JOBS_FILE, 'utf8'));
      if (Array.isArray(arr)) { this.jobs = arr; this.jobsFileMtime = this.getFileMtime(); this.restoreBuiltinBuilds(); return; }
    } catch {}
    this.jobs = DEFAULT_JOBS.map(j => ({ ...j }));
    this.save();
    this.restoreBuiltinBuilds();
  }

  /** 内置任务的 build 函数在序列化时丢弃，重启后按名称恢复 */
  private restoreBuiltinBuilds() {
    const builtins = new Map<string, (memory: MemoryManager, rag: RAG) => Promise<string> | string>();
    for (const dj of DEFAULT_JOBS) { if (dj.build) builtins.set(dj.name, dj.build); }
    for (const job of this.jobs) {
      const fn = builtins.get(job.name);
      if (fn && !job.build) job.build = fn;
    }
  }

  private getFileMtime(): number {
    try { return fs.statSync(JOBS_FILE).mtimeMs; } catch { return 0; }
  }

  private reloadIfChanged() {
    const current = this.getFileMtime();
    if (current > this.jobsFileMtime) {
      try {
        const arr = JSON.parse(fs.readFileSync(JOBS_FILE, 'utf8'));
        if (Array.isArray(arr)) {
          const oldLen = this.jobs.length;
          this.jobs = arr;
          this.jobsFileMtime = current;
          console.log(`[调度器] 检测到 jobs.json 外部变更，已重载（${oldLen}→${arr.length} 个任务）`);
        }
      } catch { /* 文件暂时不可读，下次再试 */ }
    }
  }

  private save() {
    ensureDir(CONFIG.DATA_DIR);
    fs.writeFileSync(JOBS_FILE, JSON.stringify(this.jobs.map(({ build, ...rest }) => rest), null, 2), 'utf8');
    this.jobsFileMtime = this.getFileMtime();
  }

  // ═══════════════════════════════════════════════════════════════
  // 心跳：文件操作
  // ═══════════════════════════════════════════════════════════════

  /** 读取最后一条心跳记录，用于启动时检测宕机窗口 */
  private readLastHeartbeat(): { ts: number; tick: number } | null {
    try {
      const raw = fs.readFileSync(HEARTBEAT_FILE, 'utf8');
      const lines = raw.trim().split('\n');
      if (lines.length === 0) return null;
      const last = JSON.parse(lines[lines.length - 1]);
      if (typeof last.ts === 'number') return { ts: last.ts, tick: last.tick ?? 0 };
      return null;
    } catch { return null; }
  }

  /** 追加一行心跳 */
  private writeHeartbeat(fired: string[], errors: number) {
    try {
      const memMB = Math.round(process.memoryUsage?.().heapUsed / 1024 / 1024) || 0;
      const line = JSON.stringify({
        ts: Date.now(),
        tick: this.tickCount,
        fired,
        errors,
        memMB,
      });
      fs.appendFileSync(HEARTBEAT_FILE, line + '\n', 'utf8');
      this.lastHeartbeatTs = Date.now();
      this.rotateHeartbeat();
    } catch { /* 心跳写入失败不影响调度主逻辑 */ }
  }

  /** 截断心跳文件，保留最近 HEARTBEAT_MAX_LINES 行 */
  private rotateHeartbeat() {
    try {
      const raw = fs.readFileSync(HEARTBEAT_FILE, 'utf8');
      const lines = raw.trim().split('\n');
      if (lines.length <= HEARTBEAT_MAX_LINES) return;
      const keep = lines.slice(-HEARTBEAT_MAX_LINES);
      fs.writeFileSync(HEARTBEAT_FILE, keep.join('\n') + '\n', 'utf8');
    } catch { /* 截断失败不影响主逻辑 */ }
  }

  /** 返回心跳统计摘要（供外部查询 / API） */
  heartbeatSummary(): { lastTs: number; tickCount: number; downtimeMinutes: number; lineCount: number } {
    const last = this.readLastHeartbeat();
    const downtime = last ? Math.round((Date.now() - last.ts) / 60000) : -1;
    let lineCount = 0;
    try {
      lineCount = fs.readFileSync(HEARTBEAT_FILE, 'utf8').trim().split('\n').length;
    } catch {}
    return {
      lastTs: last?.ts ?? 0,
      tickCount: this.tickCount,
      downtimeMinutes: downtime,
      lineCount,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // 宕机补跑
  // ═══════════════════════════════════════════════════════════════

  /**
   * 启动时检测宕机窗口并补跑错过的 daily/weekly/monthly 任务。
   *
   * 规则：
   *   - 读取最后一条心跳时间 lastTs
   *   - 计算宕机分钟数 = now - lastTs
   *   - 如果宕机 > 目标时间（如 daily 已过今天 HH:MM），补跑
   *   - 补跑前先查 firedKey：如果当天该任务 alreadyFired，跳过（防重复）
   *   - every N 任务不参与补跑（间隔短，重启后自然会触发）
   */
  private async catchupMissedJobs() {
    const last = this.readLastHeartbeat();
    if (!last) {
      console.log('[心跳] 无心跳记录（首次启动或文件缺失），跳过补跑');
      return;
    }

    const now = Date.now();
    const downMs = now - last.ts;
    const downMin = Math.round(downMs / 60000);

    if (downMin < 2) {
      console.log(`[心跳] 上次心跳 ${downMin} 分钟前，宕机窗口短，跳过补跑`);
      return;
    }

    console.log(`[心跳] 检测到宕机窗口：约 ${downMin} 分钟（${new Date(last.ts).toLocaleString()} → ${new Date(now).toLocaleString()}）`);

    const nowDate = new Date(now);
    const today = dateKey(nowDate);
    let caughtUp = 0;

    for (const job of this.jobs) {
      if (job.enabled === false) continue;
      const c = this.parseCron(job.cron);
      if (!c) continue;

      // every N 不补跑：重启后下一个 tick 自然触发
      if (c.freq === 'every') continue;

      const targetMin = c.hour * 60 + c.minute;
      const nowMin = nowDate.getHours() * 60 + nowDate.getMinutes();

      // 检查条件：today 已过目标时间 且 当天未触发过
      if (nowMin >= targetMin) {
        let missed = false;

        if (c.freq === 'daily') {
          missed = true;
        } else if (c.freq === 'weekly') {
          missed = nowDate.getDay() === c.day;
        } else if (c.freq === 'monthly') {
          missed = nowDate.getDate() === c.day;
        }

        if (!missed) continue;

        const key = this.firedKey(job.name, nowDate);
        if (this.firedKeys.has(key)) continue;

        console.log(`[心跳] 补跑任务: ${job.name} (错过 ${c.freq} ${c.hour}:${String(c.minute).padStart(2, '0')})`);
        this.firedKeys.add(key);
        caughtUp++;

        try {
          const result = await this.runJob(job.name);
          if (!result.ok) {
            this.firedKeys.delete(key);
            console.log(`[心跳] 补跑失败: ${job.name} — ${result.error}`);
          } else {
            console.log(`[心跳] 补跑成功: ${job.name} → ${result.outputPath || 'ok'}`);
          }
        } catch (e: any) {
          this.firedKeys.delete(key);
          console.log(`[心跳] 补跑异常: ${job.name} — ${String(e?.message || e)}`);
        }
      }
    }

    if (caughtUp === 0) {
      console.log('[心跳] 无需要补跑的任务（今日已全部触发或时间未到）');
    } else {
      console.log(`[心跳] 补跑完成：${caughtUp} 个任务`);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // 生命周期
  // ═══════════════════════════════════════════════════════════════

  start() {
    this.timer = setInterval(() => { void this.tick(); }, 60_000);
    console.log('[调度器] 已启动，监听 ' + this.jobs.length + ' 个任务：', this.jobs.map(j => j.name).join(', '));

    // 异步补跑，不阻塞 start() 返回
    this.catchupMissedJobs().catch(e => {
      console.log('[心跳] 补跑流程异常:', String(e?.message || e));
    });
  }

  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }

  list(): JobDef[] { this.reloadIfChanged(); return this.jobs; }

  lastResults(): JobResult[] { return this.results; }

  addJob(def: { name: string; cron: string; prompt: string; enabled?: boolean }): { ok: boolean; error?: string; job?: JobDef } {
    const name = String(def.name || '').trim();
    const cron = String(def.cron || '').trim();
    const prompt = String(def.prompt || '').trim();
    if (!name || !cron || !prompt) return { ok: false, error: 'name/cron/prompt 必填' };
    if (!this.parseCron(cron)) return { ok: false, error: 'cron 格式无效，应为 daily HH:MM / weekly MON HH:MM / monthly D HH:MM / every N' };
    if (this.jobs.some(j => j.name === name)) return { ok: false, error: '任务名已存在' };
    const job: JobDef = { name, cron, prompt, enabled: def.enabled !== false };
    this.jobs.push(job);
    this.save();
    return { ok: true, job };
  }

  updateJob(name: string, patch: { name?: string; cron?: string; prompt?: string; enabled?: boolean }): { ok: boolean; error?: string } {
    const i = this.jobs.findIndex(j => j.name === name);
    if (i < 0) return { ok: false, error: '任务不存在' };
    const j = this.jobs[i];
    if (patch.name && patch.name !== name) {
      if (this.jobs.some(x => x.name === patch.name)) return { ok: false, error: '新名称已存在' };
      j.name = patch.name.trim();
    }
    if (patch.cron !== undefined) {
      if (!this.parseCron(patch.cron)) return { ok: false, error: 'cron 格式无效' };
      j.cron = patch.cron.trim();
    }
    if (patch.prompt !== undefined) j.prompt = patch.prompt;
    if (patch.enabled !== undefined) j.enabled = patch.enabled;
    this.jobs[i] = j;
    this.save();
    return { ok: true };
  }

  removeJob(name: string): { ok: boolean } {
    const n = this.jobs.length;
    this.jobs = this.jobs.filter(j => j.name !== name);
    if (this.jobs.length === n) return { ok: false };
    this.save();
    return { ok: true };
  }

  private parseCron(cron: string): { freq: string; day?: number; hour: number; minute: number } | null {
    const parts = cron.trim().split(/\s+/);
    const freq = (parts[0] || '').toLowerCase();

    if (freq === 'every') {
      const n = parseInt(parts[1] || '5', 10);
      if (isNaN(n) || n < 1) return null;
      return { freq: 'every', minute: n, hour: 0 };
    }

    const m = /^(\d{1,2}):(\d{2})$/.exec(parts[parts.length - 1] || '');
    if (!m) return null;
    const hour = +m[1], minute = +m[2];
    if (freq === 'daily') return { freq, hour, minute };
    if (freq === 'weekly') {
      const dayMap: Record<string, number> = { SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 };
      const d = dayMap[(parts[1] || '').toUpperCase()];
      if (d === undefined) return null;
      return { freq, day: d, hour, minute };
    }
    if (freq === 'monthly') {
      const d = parseInt(parts[1] || '1', 10);
      if (isNaN(d) || d < 1 || d > 31) return null;
      return { freq, day: d, hour, minute };
    }
    return null;
  }

  private firedKey(name: string, now: Date): string {
    return `${name}_${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
  }

  private shouldRun(job: JobDef, now: Date): boolean {
    if (job.enabled === false) return false;
    const c = this.parseCron(job.cron);
    if (!c) return false;
    const nowMin = now.getHours() * 60 + now.getMinutes();

    if (c.freq === 'every') {
      const interval = c.minute;
      const periodKey = `${job.name}_${Math.floor(nowMin / interval) * interval}`;
      return !this.firedKeys.has(periodKey);
    }

    const targetMin = c.hour * 60 + c.minute;
    if (nowMin < targetMin) return false;
    const alreadyFired = this.firedKeys.has(this.firedKey(job.name, now));
    if (c.freq === 'daily') return !alreadyFired;
    if (c.freq === 'weekly') return now.getDay() === c.day && !alreadyFired;
    if (c.freq === 'monthly') return now.getDate() === c.day && !alreadyFired;
    return false;
  }

  private async tick() {
    this.reloadIfChanged();
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    this.tickCount++;

    const firedThisTick: string[] = [];
    let errorCount = 0;

    for (const job of this.jobs) {
      if (this.shouldRun(job, now)) {
        console.log('[调度器] 到点自动运行任务:', job.name);
        const c = this.parseCron(job.cron);
        const key = (c?.freq === 'every')
          ? `${job.name}_${Math.floor(nowMin / (c.minute || 5)) * (c.minute || 5)}`
          : this.firedKey(job.name, now);
        this.firedKeys.add(key);
        firedThisTick.push(job.name);

        try {
          const result = await this.runJob(job.name);
          if (!result.ok) {
            this.firedKeys.delete(key);
            errorCount++;
            console.log('[调度器] 任务执行失败，下轮自动重试:', job.name, result.error);
          }
        } catch (e: any) {
          this.firedKeys.delete(key);
          errorCount++;
          console.log('[调度器] 任务执行异常，下轮自动重试:', job.name, String(e?.message || e));
        }
      }
    }

    // 心跳写入（每次 tick 结束）
    this.writeHeartbeat(firedThisTick, errorCount);
  }

  async triggerNow(name: string, callbacks?: RunCallbacks): Promise<JobResult> {
    const job = this.jobs.find(j => j.name === name);
    if (!job) return { name, ranAt: Date.now(), ok: false, error: '未知任务: ' + name };
    return this.runJob(name, callbacks);
  }

  private async runJob(name: string, callbacks?: RunCallbacks): Promise<JobResult> {
    const job = this.jobs.find(j => j.name === name)!;
    const ranAt = Date.now();
    try {
      const extra = job.build ? await job.build(this.memory, this.rag) : '';
      const prompt = extra ? job.prompt + '\n\n【补充上下文】\n' + extra : job.prompt;

      let content = '';
      if (this.loop) {
        content = await this.loop.run({
          userInput: prompt,
          sessionId: 'job_' + name + '_' + ranAt,
          callbacks,
        });
      } else {
        const res = await this.getProvider().chat({
          messages: [{ role: 'user', content: prompt }],
          stream: true,
          onToken: (t) => callbacks?.onToken?.(t),
        });
        content = res.content || '';
      }

      const fp = path.join(CONFIG.OUTPUT_DIR, name + '_' + new Date(ranAt).toISOString().slice(0, 10) + '.md');
      ensureDir(CONFIG.OUTPUT_DIR);
      fs.writeFileSync(fp, '# ' + job.name + ' @ ' + new Date(ranAt).toLocaleString() + '\n\n' + content, 'utf8');
      if (job.name === 'idle_loop') {
        const idleResult = processIdleResponse(content);
        console.log('[主动意识] idle_loop 决策:', idleResult);
      }
      callbacks?.onActivity?.({ type: 'info', message: `任务 ${name} 完成，输出 ${fp}` });
      const result: JobResult = { name, ranAt, ok: true, outputPath: fp };
      this.results.unshift(result);
      job.lastRunAt = ranAt;
      this.save();
      return result;
    } catch (e: any) {
      const result: JobResult = { name, ranAt, ok: false, error: String(e?.message || e) };
      this.results.unshift(result);
      return result;
    }
  }
}

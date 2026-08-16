// autonomy/index.ts
// Autonomy Engine — 自主目标系统的统一入口
// 串联 WorldObserver → OpportunityDetector → GoalGenerator → GoalPrioritizer + Curiosity
// V5.0 Step 2：Goal Generation Engine + Curiosity System

import { WorldObserver, FileSystemSource, DiskSpaceSource, ProcessMonitorSource } from './world/worldObserver';
import { OpportunityDetector } from './opportunity/detector';
import { GoalGenerator } from './goal/goalGenerator';
import { GoalPrioritizer } from './goal/goalPrioritizer';
import { CuriosityEngine } from './curiosity/curiosityEngine';
import type { Goal } from './goal/types';
import type { Observation } from './world/worldObserver';
import { logger, metrics, tracer, replay } from '../observability';

export class AutonomyEngine {
  observer = new WorldObserver();
  detector = new OpportunityDetector();
  generator = new GoalGenerator();
  prioritizer = new GoalPrioritizer();
  curiosity = new CuriosityEngine();

  private scanInterval = 300000; // 5 分钟
  private running = false;
  private timer?: ReturnType<typeof setInterval>;

  /** 初始化：注册默认监控源 */
  initialize(config?: {
    watchPaths?: string[];
    watchDrives?: string[];
    watchProcesses?: string[];
  }) {
    // 文件系统监控
    if (config?.watchPaths && config.watchPaths.length > 0) {
      this.observer.register(new FileSystemSource(config.watchPaths));
    }

    // 磁盘监控
    const drives = config?.watchDrives || ['C:', 'D:'];
    this.observer.register(new DiskSpaceSource(drives, 10));

    // 进程监控
    const processes = config?.watchProcesses || [];
    if (processes.length > 0) {
      this.observer.register(new ProcessMonitorSource(processes));
    }

    logger.info('AutonomyEngine', 'Initialized', {
      sources: ['FileSystem', 'DiskSpace', ...(processes.length > 0 ? ['ProcessMonitor'] : [])],
    });
    metrics.increment('autonomy.engine.initialize');
  }

  /** 执行一次完整的自主循环 */
  async pulse(): Promise<{ observations: number; opportunities: number; goals: Goal[] }> {
    const trace = tracer.start('AutonomyEngine.pulse');

    // 1. 观察
    logger.debug('AutonomyEngine', 'Observing...');
    const observations = await this.observer.observe();
    metrics.set('autonomy.observer.count', observations.length);

    // 2. 好奇心：从观察中发现未知领域
    if (observations.length > 0) {
      this.curiosity.discoverFromObservations(observations);
    }

    // 3. 检测机会
    const opportunities = this.detector.detect(observations);
    metrics.set('autonomy.opportunity.count', opportunities.length);

    // 4. 生成目标
    let goals: Goal[] = [];
    if (opportunities.length > 0) {
      goals = this.generator.fromOpportunities(opportunities);
    }

    // 5. 好奇心目标
    if (Math.random() < 0.3) { // 30% 概率生成好奇心目标（不要太频繁）
      const explorationGoals = this.curiosity.generateExplorationGoals();
      goals.push(...explorationGoals);
    }

    // 6. 排序
    goals = this.prioritizer.rank(goals);

    const summary = {
      observations: observations.length,
      opportunities: opportunities.length,
      goals,
    };

    tracer.end(trace, { goalCount: goals.length });
    logger.info('AutonomyEngine', 'Pulse complete', summary);
    return summary;
  }

  /** 启动自主监控循环 */
  start(intervalMs = 300000) {
    if (this.running) return;
    this.running = true;
    this.scanInterval = intervalMs;

    logger.info('AutonomyEngine', `Started (interval: ${intervalMs}ms)`);
    metrics.increment('autonomy.engine.started');

    // 立即执行一次
    this.pulse().catch(e => logger.error('AutonomyEngine', 'Initial pulse failed', { error: String(e) }));

    // 定时执行
    this.timer = setInterval(() => {
      this.pulse().catch(e => logger.error('AutonomyEngine', 'Pulse failed', { error: String(e) }));
    }, intervalMs);
  }

  /** 停止 */
  stop() {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    logger.info('AutonomyEngine', 'Stopped');
    metrics.increment('autonomy.engine.stopped');
  }

  /** 手动添加知识（给好奇心引擎学习） */
  learn(topic: string, confidence: number) {
    const map = new Map<string, number>();
    map.set(topic, confidence);
    this.curiosity.evaluate(map);
    this.curiosity.markLearned(topic, confidence);
  }

  /** 获取状态摘要 */
  status() {
    return {
      running: this.running,
      scanInterval: this.scanInterval,
      observerSources: 3, // FileSystem + DiskSpace + ProcessMonitor
      activeGoals: this.generator.active().length,
      pendingGoals: this.generator.pending().length,
      curiosity: this.curiosity.stats(),
    };
  }
}

// 单例
export const autonomy = new AutonomyEngine();

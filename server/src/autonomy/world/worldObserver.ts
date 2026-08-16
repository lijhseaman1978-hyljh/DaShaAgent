// autonomy/world/worldObserver.ts
// World Observer — Agent 的"眼睛"
// 持续监控环境变化：文件系统、进程状态、Cron 任务、磁盘空间等
// V5.0 Step 2：Goal Generation Engine + Curiosity System

import { logger, metrics } from '../../observability';

export interface Observation {
  type: 'file_change' | 'disk_alert' | 'process_down' | 'cron_status' | 'custom';
  source: string;
  description: string;
  importance: number;   // 0-1
  data: Record<string, any>;
  timestamp: number;
}

export interface ObserverSource {
  name: string;
  scan(): Promise<Observation[]>;
}

export class WorldObserver {
  private sources: ObserverSource[] = [];
  private observations: Observation[] = [];
  private scanInterval = 60000; // 默认每分钟扫描

  register(source: ObserverSource) {
    this.sources.push(source);
    logger.info('WorldObserver', `Registered source: ${source.name}`);
    metrics.increment('autonomy.observer.source.registered');
  }

  /** 执行一次完整扫描 */
  async observe(): Promise<Observation[]> {
    const allObservations: Observation[] = [];

    for (const source of this.sources) {
      try {
        const results = await source.scan();
        for (const obs of results) {
          obs.source = source.name;
          obs.timestamp = Date.now();
        }
        allObservations.push(...results);
      } catch (e: any) {
        logger.warn('WorldObserver', `Source ${source.name} failed`, { error: String(e) });
      }
    }

    this.observations.push(...allObservations);
    // 只保留最近 1000 条
    if (this.observations.length > 1000) {
      this.observations = this.observations.slice(-500);
    }

    logger.debug('WorldObserver', `Scan complete: ${allObservations.length} observations from ${this.sources.length} sources`);
    return allObservations;
  }

  /** 获取近期观察（默认最近 10 分钟） */
  recent(windowMs = 600000): Observation[] {
    const cutoff = Date.now() - windowMs;
    return this.observations.filter(o => o.timestamp >= cutoff);
  }

  /** 获取高重要度观察 */
  highImportance(threshold = 0.6): Observation[] {
    return this.observations.filter(o => o.importance >= threshold);
  }

  /** 按来源过滤 */
  bySource(sourceName: string): Observation[] {
    return this.observations.filter(o => o.source === sourceName);
  }

  /** 清空历史 */
  clear() { this.observations = []; }
}

// ═══════════════════════════════════════
//  内置 Observer Sources
// ═══════════════════════════════════════

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';

/** 文件系统监控源 — 检查指定目录下的文件变化 */
export class FileSystemSource implements ObserverSource {
  name = 'FileSystem';
  private snapshot: Map<string, number> = new Map(); // path → mtime

  constructor(private watchPaths: string[]) {}

  async scan(): Promise<Observation[]> {
    const obs: Observation[] = [];
    for (const wp of this.watchPaths) {
      try {
        const files = this.listFiles(wp);
        for (const f of files) {
          try {
            const stat = fs.statSync(f);
            const prev = this.snapshot.get(f);
            if (prev && prev !== stat.mtimeMs) {
              obs.push({
                type: 'file_change', source: this.name,
                description: `文件已修改：${path.basename(f)}`,
                importance: 0.4,
                data: { path: f, prevMtime: prev, newMtime: stat.mtimeMs },
                timestamp: Date.now(),
              });
            }
            this.snapshot.set(f, stat.mtimeMs);
          } catch { /* 文件可能已被删除 */ }
        }
      } catch { /* 目录不存在 */ }
    }
    return obs;
  }

  private listFiles(dir: string): string[] {
    const results: string[] = [];
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const e of entries) {
        const fp = path.join(dir, e.name);
        if (e.isFile()) results.push(fp);
        else if (e.isDirectory() && !e.name.startsWith('.') && !e.name.startsWith('node_modules')) {
          results.push(...this.listFiles(fp));
        }
      }
    } catch { /* ignore */ }
    return results;
  }
}


/** 路径校验：判断是否为盘符根目录（如 C:\、C:/） */
function isDriveRoot(p: string): boolean {
  const norm = p.replace(/[\\/]+$/, '');
  return /^[A-Za-z]:$/.test(norm);
}

/** 磁盘空间监控源 */
export class DiskSpaceSource implements ObserverSource {
  name = 'DiskSpace';
  private thresholdPercent = 10; // 低于此百分比则告警

  constructor(private drives = ['C:', 'D:'], thresholdPercent = 10) {
    this.thresholdPercent = thresholdPercent;
  }

  async scan(): Promise<Observation[]> {
    const obs: Observation[] = [];
    // Windows: 使用 wmic 或 fs 检查
    for (const drive of this.drives) {
      try {
        // 路径校验：禁止将测试文件直接写入盘符根目录（如 C:\.qwenpaw_disk_test）。
        // 普通用户对盘符根目录无写权限（EPERM）会导致磁盘误报，检测到即抛出异常并跳过。
        const testDir = path.join(drive + '\\', '.tmp_test');
        const testFile = path.join(testDir, '.qwenpaw_disk_test');
        if (isDriveRoot(path.dirname(testFile))) {
          throw new Error(`refusing to write at drive root: ${path.dirname(testFile)}`);
        }
        // 写入目标改为盘符根目录下的子目录 .tmp_test（自动创建，可写）
        fs.mkdirSync(testDir, { recursive: true });
        fs.writeFileSync(testFile, 'test');
        fs.unlinkSync(testFile);
        // 如果到这里，磁盘可读写
      } catch (e: any) {
        obs.push({
          type: 'disk_alert', source: this.name,
          description: `磁盘 ${drive} 可能空间不足或不可写：${String(e).slice(0, 80)}`,
          importance: 0.8,
          data: { drive, error: String(e) },
          timestamp: Date.now(),
        });
      }
    }
    return obs;
  }
}

/** 进程存活监控源 */
export class ProcessMonitorSource implements ObserverSource {
  name = 'ProcessMonitor';

  constructor(private processNames: string[]) {}

  async scan(): Promise<Observation[]> {
    const obs: Observation[] = [];
    for (const name of this.processNames) {
      try {
        const result = execSync(`tasklist /FI "IMAGENAME eq ${name}" /NH`, {
          encoding: 'utf-8', timeout: 5000,
        });
        if (!result.includes(name)) {
          obs.push({
            type: 'process_down', source: this.name,
            description: `进程未运行：${name}`,
            importance: 0.9,
            data: { process: name },
            timestamp: Date.now(),
          });
        }
      } catch {
        obs.push({
          type: 'process_down', source: this.name,
          description: `无法检查进程：${name}`,
          importance: 0.5,
          data: { process: name, error: 'tasklist failed' },
          timestamp: Date.now(),
        });
      }
    }
    return obs;
  }
}

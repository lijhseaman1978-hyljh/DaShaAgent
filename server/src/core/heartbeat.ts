// core/heartbeat.ts
// Heartbeat — 主动交互引擎
// 每 30 分钟检查 data/HEARTBEAT.md，若有检查项则通过 EventBus 触发 Agent 执行
// 设计理念：Agent 从"等着被叫"变为"主动帮忙"

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { CONFIG } from '../config/system';
import { EventEmitter } from 'node:events';

export interface HeartbeatItem {
  line: string;          // 原始文本行
  intent: string;        // 提取的意图描述
}

export interface HeartbeatResult {
  item: HeartbeatItem;
  timestamp: number;
}

export class Heartbeat extends EventEmitter {
  private timer: NodeJS.Timeout | null = null;
  private intervalMs: number;
  private enabled: boolean;

  constructor(intervalMinutes = 30) {
    super();
    this.intervalMs = intervalMinutes * 60 * 1000;
    this.enabled = false;
  }

  /** 从 HEARTBEAT.md 解析检查项 */
  private parseItems(): HeartbeatItem[] {
    try {
      const p = join(CONFIG.DATA_DIR, 'HEARTBEAT.md');
      if (!existsSync(p)) return [];
      const raw = readFileSync(p, 'utf-8');
      const items: HeartbeatItem[] = [];
      for (const line of raw.split('\n')) {
        const trimmed = line.trim();
        // 匹配 "- 检查..." 或 "- 做..."
        const m = trimmed.match(/^[-*]\s+(.+)/);
        if (m && !trimmed.startsWith('#')) {
          items.push({ line: trimmed, intent: m[1].trim() });
        }
      }
      return items;
    } catch { return []; }
  }

  /** 启动心跳定时器 */
  start(): void {
    if (this.timer) return; // 已启动
    this.enabled = true;
    console.log(`[Heartbeat] Started — interval ${this.intervalMs / 60000}min`);

    // 首次延迟 60 秒后开始（避免启动时立即干扰）
    setTimeout(() => this.tick(), 60_000);

    // 定时循环
    this.timer = setInterval(() => this.tick(), this.intervalMs);
  }

  /** 停止心跳 */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.enabled = false;
    console.log('[Heartbeat] Stopped');
  }

  /** 执行一次心跳检查 */
  private async tick(): Promise<void> {
    if (!this.enabled) return;
    const items = this.parseItems();
    if (items.length === 0) return; // HEARTBEAT.md 为空或不存在

    console.log(`[Heartbeat] Tick — ${items.length} item(s)`);
    for (const item of items) {
      const result: HeartbeatResult = { item, timestamp: Date.now() };
      // 广播事件：前端/Agent 监听 heart:check 事件，按意图处理
      this.emit('heart:check', result);
      console.log(`[Heartbeat]  ${item.intent.slice(0, 80)}`);
    }
  }

  /** 手动触发一次检查（测试用） */
  async manualTick(): Promise<HeartbeatResult[]> {
    const items = this.parseItems();
    const results: HeartbeatResult[] = [];
    for (const item of items) {
      const result: HeartbeatResult = { item, timestamp: Date.now() };
      this.emit('heart:check', result);
      results.push(result);
    }
    return results;
  }
}

// 单例
export const heartbeat = new Heartbeat();

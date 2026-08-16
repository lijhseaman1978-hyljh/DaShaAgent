// config/env.ts
// V3 Phase 1 - Step 2 二、环境管理器
// 统一的环境变量入口：加载 .env → 提供 get / require（缺失即抛错）。
// 额外提供 str/bool/int 三个带默认值的读取器，供 ConfigLoader 消费。

import path from 'node:path';
import fs from 'node:fs';
import dotenv from 'dotenv';
import { CONFIG } from './system';

// 优先读项目根 .env（不依赖进程 cwd，避免从 WSL / 其他目录启动时读不到）；
// 再让 dotenv 兜底扫一次 cwd。两次都不会覆盖已存在的 process.env。
// quiet:true 关闭 dotenv v17 的启动提示，避免污染 OS 启动横幅
const ROOT_ENV = path.join(CONFIG.ROOT, '.env');
if (fs.existsSync(ROOT_ENV)) {
  dotenv.config({ path: ROOT_ENV, quiet: true });
}
dotenv.config({ quiet: true });

export class EnvManager {
  /** 读取环境变量，不存在返回 undefined */
  get(key: string): string | undefined {
    return process.env[key];
  }

  /** 读取必填环境变量，缺失直接抛错（用于 API Key 这类硬依赖） */
  require(key: string): string {
    const value = process.env[key];
    if (!value) {
      throw new Error(`Missing env: ${key}`);
    }
    return value;
  }

  /** 带默认值的字符串读取 */
  str(key: string, fallback: string): string {
    const v = process.env[key];
    return v === undefined || v === '' ? fallback : v;
  }

  /** 带默认值的布尔读取：true/1/yes/on 视为真 */
  bool(key: string, fallback: boolean): boolean {
    const v = process.env[key];
    if (v === undefined || v === '') return fallback;
    return ['1', 'true', 'yes', 'on'].includes(v.trim().toLowerCase());
  }

  /** 带默认值的整数读取 */
  int(key: string, fallback: number): number {
    const v = process.env[key];
    if (v === undefined || v === '') return fallback;
    const n = parseInt(v, 10);
    return Number.isNaN(n) ? fallback : n;
  }

  /** 是否已配置（非空） */
  has(key: string): boolean {
    const v = process.env[key];
    return v !== undefined && v !== '';
  }
}

export const env = new EnvManager();

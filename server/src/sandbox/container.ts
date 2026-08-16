// sandbox/container.ts
// 计划书 Phase 3 - Step 1 §七：Container Manager（隔离容器 + 资源限额）。
//
// 在计划书原型（node:22 / Memory 512MB / CpuQuota 50000）之上补：
//   - 策略驱动的内存上限（SecurityPolicy.maxMemory）
//   - 断网隔离：策略不允许联网时 NetworkMode='none'（这是 Docker 沙箱最核心的一道墙）
//   - destroy() 生命周期回收，避免容器泄漏

import { docker } from './docker';
import { DefaultPolicy, type SecurityPolicy } from '../security/policy';

export interface ContainerOptions {
  image?: string;
  policy?: SecurityPolicy;
  /** 容器空转存活时长（秒） */
  ttl?: number;
}

export class ContainerManager {
  image = 'node:22';
  current: any = null;

  async create(opts: ContainerOptions = {}): Promise<any> {
    const client = await docker.client();
    if (!client) throw new Error('docker unavailable');

    const policy = opts.policy ?? DefaultPolicy;
    const image = opts.image ?? this.image;

    const container = await client.createContainer({
      Image: image,
      Cmd: ['sleep', String(opts.ttl ?? 3600)],
      Tty: false,
      HostConfig: {
        Memory: policy.maxMemory * 1024 * 1024,
        CpuQuota: 50000, // 50% of one CPU（计划书 §七）
        PidsLimit: 256,
        NetworkMode: policy.allowNetwork ? 'bridge' : 'none',
        AutoRemove: false,
        ReadonlyRootfs: false,
      },
    });

    await container.start();
    this.current = container;
    return container;
  }

  /** 复用同一个容器，避免每条命令都冷启动一次。 */
  async ensure(opts: ContainerOptions = {}): Promise<any> {
    if (this.current) {
      try {
        const info = await this.current.inspect();
        if (info?.State?.Running) return this.current;
      } catch {
        this.current = null;
      }
    }
    return this.create(opts);
  }

  async destroy(): Promise<void> {
    if (!this.current) return;
    try {
      await this.current.stop({ t: 2 });
    } catch {
      /* 可能已停止 */
    }
    try {
      await this.current.remove({ force: true });
    } catch {
      /* ignore */
    }
    this.current = null;
  }
}

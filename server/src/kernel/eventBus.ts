// kernel/eventBus.ts
// EventBus：Agent 内部神经系统，模块间通信总线。
// 计划书 Step 1.3：创建 EventBus
// Research Agent 完成后 emit("research.completed")，Writer Agent on() 监听并响应。

type EventHandler = (data: any) => void;

export class EventBus {
  private listeners: Map<string, EventHandler[]>;

  constructor() {
    this.listeners = new Map();
  }

  on(event: string, handler: EventHandler): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(handler);
  }

  emit(event: string, data: any): void {
    const handlers = this.listeners.get(event);
    if (!handlers) return;
    for (const handler of handlers) {
      try {
        handler(data);
      } catch (e) {
        console.error('[EventBus] handler error for event', event, e);
      }
    }
  }

  off(event: string): void {
    this.listeners.delete(event);
  }

  // 清空所有监听（测试/重启用）
  clear(): void {
    this.listeners.clear();
  }
}

// 全局单例总线
export const eventBus = new EventBus();

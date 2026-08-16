// core/apiTypes.ts — P2-2: 类型化 API 响应

export interface HealthResponse {
  ok: boolean;
  uptime: number;            // 进程运行秒数
  provider: string;
  providerLatencyMs?: number; // 最近一次 provider ping 延迟
  memory: {
    heapUsedMB: number;
    heapTotalMB: number;
    rssMB: number;
  };
  sessions: number;          // 活跃会话数
  rag: {
    ingested: boolean;
    vectorCount: number;
  };
  jobs: string[];            // 定时任务名
  version: string;
}

export interface ErrorResponse {
  error: string;
  code?: string;
  detail?: string;
}

export interface ConfigResponse {
  provider: string;
  activeModelId?: string;
  models: Array<{
    id: string;
    label: string;
    type: string;
  }>;
}

// API 辅助：构造错误响应
export function errorResponse(message: string, code?: string, detail?: string): ErrorResponse {
  return { error: message, code, detail };
}

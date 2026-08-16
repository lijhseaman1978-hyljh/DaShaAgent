// sandbox/docker.ts
// 计划书 Phase 3 - Step 1 §六：Docker Client。
//
// 工程加固（相对计划书 `export const docker = new Docker()`）：
//   计划书写法在「未装 dockerode / Docker Desktop 没跑」时会在 import 期就把 OS 启动打断。
//   这里改为「懒加载 + ping 探活」，Docker 不可用时 SecureShellTool 自动降级为宿主受控执行，
//   OS 依然可启动 —— 符合本工程「并排扩展、不删不降级」的棕地规则。

let client: any = null;
let probed: { ok: boolean; reason?: string } | null = null;

async function createClient(): Promise<any> {
  if (client) return client;
  // 非字面量 specifier：dockerode 无内置类型且属可选依赖，避免 TS 静态解析报错。
  const spec = 'dockerode';
  const mod: any = await import(spec);
  const Docker = mod.default ?? mod;
  client = new Docker();
  return client;
}

export const docker = {
  /** 获取 dockerode 客户端；不可用时返回 null。 */
  async client(): Promise<any | null> {
    try {
      return await createClient();
    } catch {
      return null;
    }
  },

  /** 探活（结果缓存）：Docker daemon 是否就绪。 */
  async ping(force = false): Promise<{ ok: boolean; reason?: string }> {
    if (probed && !force) return probed;
    try {
      const c = await createClient();
      await c.ping();
      probed = { ok: true };
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      probed = {
        ok: false,
        reason: /Cannot find (module|package)|ERR_MODULE_NOT_FOUND/i.test(msg)
          ? 'dockerode not installed — run: npm install dockerode'
          : /ENOENT|connect|EPIPE|pipe/i.test(msg)
            ? 'docker daemon not reachable — is Docker Desktop running?'
            : msg,
      };
    }
    return probed;
  },

  get available(): boolean {
    return probed?.ok === true;
  },
};

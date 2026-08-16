// sandbox/executor.ts
// 计划书 Phase 3 - Step 1 §八：安全 Shell Executor（命令在容器里跑，不碰宿主机）。
//
// 计划书原型直接 `return stream`，调用方拿不到可用结果；这里把 Docker 的多路复用流解出来，
// 返回 { stdout, stderr, exitCode }，并加超时 + Kill Switch（§Step1 目标 ⑤）。

export interface SandboxRunResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  killed?: boolean;
}

export class SandboxExecutor {
  async run(container: any, command: string, timeout = 30000): Promise<SandboxRunResult> {
    const exec = await container.exec({
      Cmd: ['bash', '-c', command],
      AttachStdout: true,
      AttachStderr: true,
    });

    const stream = await exec.start({ hijack: true, stdin: false });

    return await new Promise<SandboxRunResult>((resolve) => {
      let stdout = '';
      let stderr = '';
      let done = false;

      // Kill Switch：超时立即终止，防止 Agent 把自己挂死
      const timer = setTimeout(async () => {
        if (done) return;
        done = true;
        try {
          await container.kill();
        } catch {
          /* ignore */
        }
        resolve({ stdout, stderr, exitCode: null, killed: true });
      }, timeout);

      // Docker 多路复用帧：8 字节头（[type,0,0,0, len32]）+ payload
      let buf = Buffer.alloc(0);
      stream.on('data', (chunk: Buffer) => {
        buf = Buffer.concat([buf, chunk]);
        while (buf.length >= 8) {
          const type = buf[0];
          const len = buf.readUInt32BE(4);
          if (buf.length < 8 + len) break;
          const payload = buf.subarray(8, 8 + len).toString('utf8');
          if (type === 2) stderr += payload;
          else stdout += payload;
          buf = buf.subarray(8 + len);
        }
      });

      const finish = async () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        let exitCode: number | null = null;
        try {
          exitCode = (await exec.inspect())?.ExitCode ?? null;
        } catch {
          /* ignore */
        }
        resolve({ stdout, stderr, exitCode });
      };

      stream.on('end', finish);
      stream.on('close', finish);
      stream.on('error', (e: any) => {
        stderr += e?.message ?? String(e);
        void finish();
      });
    });
  }
}

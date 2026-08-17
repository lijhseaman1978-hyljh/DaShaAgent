import { spawnSync } from 'node:child_process';

// 候选解释器列表：
// - 'C:/Program Files/Python310/python.exe' 仅在本机 Windows + 该安装路径时有效；
// - process.env.PYTHON_PATH 允许用户自定义；
// - python3 / python 是 Linux/macOS/CI 的通用选择。
//
// 关键点：不能盲目返回 candidates[0]（那个 Windows 绝对路径在 Linux 上不存在，
// spawn 会直接 ENOENT 崩溃）。必须逐个验证，返回第一个「真正能执行」的二进制。
const CANDIDATES = [
  'C:/Program Files/Python310/python.exe',
  process.env.PYTHON_PATH,
  'python3',
  'python',
].filter(Boolean) as string[];

let cached: string | null = null;
let probed = false;

function probe(bin: string): boolean {
  try {
    const r = spawnSync(bin, ['-c', 'print(1)'], { windowsHide: true, timeout: 5000 });
    return !r.error && r.status === 0;
  } catch {
    return false;
  }
}

/**
 * 跨平台解析一个可用的 Python 解释器。
 * 进程内记忆化：只在首次调用时探测一次，之后直接复用，避免每次文件读取都 spawn 验证。
 * 若所有候选都不可用（极端环境无 Python），兜底返回平台默认命令，交由上层 spawn 报错。
 */
export function resolvePython(): string {
  if (probed) return cached as string;
  probed = true;
  for (const bin of CANDIDATES) {
    if (probe(bin)) {
      cached = bin;
      return bin;
    }
  }
  cached = process.platform === 'win32' ? 'python' : 'python3';
  return cached;
}

import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { CONFIG, ensureDir } from '../config';
import { registry } from './registry';
import type { ToolDef } from '../core/types';

// 自定义插件 = 由用户定义的 shell 命令型工具。
// 模型调用时，参数以 JSON 字符串形式通过环境变量 AH_TOOL_ARGS 传入，并同时写入 stdin；
// 命令的 stdout（前 8000 字符）作为工具结果返回给模型。
// ⚠️ 插件命令以当前进程权限执行，使用前请确认可信。

const PLUGINS_DIR = path.join(CONFIG.DATA_DIR, 'plugins');
ensureDir(PLUGINS_DIR);

export interface CustomPlugin {
  id: string;
  name: string;
  description: string;
  command: string;
}

let _registeredNames: string[] = [];

function readPlugins(): CustomPlugin[] {
  let files: string[] = [];
  try { files = fs.readdirSync(PLUGINS_DIR).filter(f => f.endsWith('.json')); } catch { return []; }
  const out: CustomPlugin[] = [];
  for (const f of files) {
    try {
      const p = JSON.parse(fs.readFileSync(path.join(PLUGINS_DIR, f), 'utf8'));
      if (p && p.name && p.command) out.push(p);
    } catch { /* 忽略损坏文件 */ }
  }
  return out;
}

function runCommand(command: string, argsJson: string): Promise<{ stdout: string; stderr: string; err?: Error }> {
  return new Promise((resolve) => {
    const child = exec(
      command,
      { env: { ...process.env, AH_TOOL_ARGS: argsJson }, timeout: 30000, maxBuffer: 16 * 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => resolve({ stdout: String(stdout || ''), stderr: String(stderr || ''), err: err || undefined }),
    );
    if (child.stdin) { try { child.stdin.end(argsJson); } catch { /* ignore */ } }
  });
}

// 重新加载所有自定义插件（先卸载旧的，再注册当前磁盘上的）
export function loadCustomTools(): CustomPlugin[] {
  for (const n of _registeredNames) registry.unregister(n);
  _registeredNames = [];

  const plugins = readPlugins();
  for (const p of plugins) {
    const def: ToolDef = {
      name: p.name,
      description: p.description || ('自定义插件: ' + p.name),
      parameters: {
        type: 'object',
        properties: { input: { type: 'string', description: '传给插件的参数（JSON 字符串）' } },
        required: [],
      },
    };
    registry.register(def, async (args: any) => {
      const argsJson = JSON.stringify(args || {});
      const { stdout, stderr, err } = await runCommand(p.command, argsJson);
      if (err) return { error: (stderr || err.message || '命令执行失败').slice(0, 2000) };
      return { output: stdout.slice(0, 8000) };
    });
    _registeredNames.push(p.name);
  }
  return plugins;
}

export function addCustomPlugin(p: Omit<CustomPlugin, 'id'>): CustomPlugin {
  const id = 'plugin_' + Date.now().toString(36);
  const rec: CustomPlugin = { id, name: p.name, description: p.description || '', command: p.command };
  fs.writeFileSync(path.join(PLUGINS_DIR, id + '.json'), JSON.stringify(rec, null, 2), 'utf8');
  loadCustomTools();
  return rec;
}

export function removeCustomPlugin(id: string): boolean {
  const fp = path.join(PLUGINS_DIR, id + '.json');
  try { fs.unlinkSync(fp); } catch { return false; }
  loadCustomTools();
  return true;
}

export function getCustomPlugins(): CustomPlugin[] { return readPlugins(); }

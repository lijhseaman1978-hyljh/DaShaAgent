// tools/index.ts
// 计划书 Phase 2 - Step 2 §十：注册所有工具。
//
// 棕地说明：本 barrel 只导出 Step 2 新增的「真实世界工具层」（core + browser/file/shell/database）。
//           V2 生产工具（tools/registry.ts 的 ToolDef 体系、fsTool/docxTool/pdfTool/xlsxTool/pptxTool/
//           scriptTool/skillTool/toolSearch 等）保持原有 import 路径不变，未被本文件覆盖或收编。

export * from './core/tool';
export * from './core/permission';
export * from './core/registry';

export * from './browser/browserManager';
export * from './browser/browserTool';
export * from './filesystem/fileTool';
export * from './shell/shellTool';
export * from './shell/secureShellTool';
export * from './database/databaseTool';

import { ToolRegistry } from './core/registry';
import { BrowserTool } from './browser/browserTool';
import { FileTool } from './filesystem/fileTool';
import { ShellTool } from './shell/shellTool';
import { SecureShell } from './shell/secureShellTool';
import { DatabaseTool } from './database/databaseTool';

/** Step 2 真实世界工具清单（供 Runtime / Executor 批量注册）。 */
export const RealWorldTools = [BrowserTool, FileTool, ShellTool, DatabaseTool];

/** Phase 3 - Step 1 新增：Docker 沙箱安全执行工具（与 ShellTool 并存，不替代）。 */
export const SecureTools = [SecureShell];

/** 预置好的工具注册表：已注册 4 件套，执行时自动过权限闸门。 */
export function createToolRuntime(): ToolRegistry {
  const registry = new ToolRegistry();
  for (const tool of RealWorldTools) registry.register(tool as any);
  return registry;
}

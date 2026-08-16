// server/src/skills/marketplace/types.ts
// 技能市场（2026-08-15 生态扩展）共享类型。
// 市场 = 自托管注册中心：publish（发布）/ install（安装）/ rate（评分）/ uninstall（卸载）。
// 包格式 .skill = tar.gz（SKILL.md + manifest.json + references/ + scripts/）。

import type { SkillManifest } from '../../core/types';

export interface Rating {
  stars: number; // 1-5
  comment?: string;
  by?: string;
  at: number; // epoch ms
}

export interface DangerFlag {
  file: string; // 相对技能目录的路径
  line: number;
  pattern: string; // 命中的危险模式描述
  severity: 'high' | 'medium';
}

// GitHub 远程技能定位（供 downloadSkill 递归下载），source==='remote' 时存在
export interface RemoteRef {
  owner: string;       // GitHub owner
  repo: string;        // GitHub repo
  branch?: string;     // 分支（缺省取默认分支）
  path: string;        // 技能在仓库内的目录路径（相对仓库根，如 skills/pdf）
  url?: string;        // 原始仓库 URL（展示用）
}

export interface MarketplaceEntry {
  slug: string;
  name: string;
  version: string;
  author?: string;
  description: string;
  tags: string[];
  category: string;
  /** 声明的能力/权限（沙箱判定依据） */
  permissions: { network: boolean; fileWrite: boolean; shell: boolean };
  /** 信任级：'trusted' 直接运行；'sandboxed'（默认）受限沙箱运行 */
  trust: 'trusted' | 'sandboxed';
  rating: number; // 平均星级（1-5）
  ratingsCount: number;
  ratings: Rating[];
  /** 来源：builtin=内置已装载；local=本地注册中心已发布；remote=远程注册中心聚合（GitHub 等） */
  source: 'builtin' | 'local' | 'remote';
  /** GitHub 远程来源定位（source==='remote' 时存在，供 downloadSkill 递归下载） */
  remote?: RemoteRef;
  /** 是否已下载到本地注册中心（registry 中存在该 slug，尚未安装亦可） */
  downloaded?: boolean;
  publishedAt: number;
  updatedAt: number;
  /** 包完整性 sha256（.skill 文件校验和） */
  sha256: string;
  /** .skill 包路径（data/marketplace/packages/<slug>.skill） */
  packagePath: string;
  /** 是否已安装到 skills/installed（列表态计算字段） */
  installed: boolean;
  /** 危险脚本扫描结果（安装/发布时产出，供 UI 警示） */
  dangerFlags?: DangerFlag[];
}

export interface PublishInput {
  /** 复制已有技能（builtin 或 installed）并发布 */
  slug?: string;
  /** 或直接新建（与 body 配合） */
  name?: string;
  version?: string;
  author?: string;
  description?: string;
  body?: string; // SKILL.md 正文
  tags?: string[];
  category?: string;
  permissions?: { network?: boolean; fileWrite?: boolean; shell?: boolean };
  trust?: 'trusted' | 'sandboxed';
}

export type { SkillManifest };

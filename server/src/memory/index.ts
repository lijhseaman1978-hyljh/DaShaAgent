// memory/index.ts
// Phase 2b (V3吞并V2): 退化为兼容壳，全部委托给 V3 cognitiveMemory
//
// 原 V2 直接操作 profile.json + notes/*.md 文件，
// 现全部由 V3 CognitiveMemoryOS 管理，dump/load 走 data/cognitive.json 持久化。
// 本文件仅保留接口兼容，所有调用方（tools/unified/scheduler）零改动。

import type { Provider } from '../core/types';
import type { CognitiveMemoryOS } from '../cognitive/os';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { CONFIG } from '../config/system';

let _v3: CognitiveMemoryOS | null = null;

/** 内部设置 V3 引用 — 由 unified.ts 在 boot 时调用 */
export function injectV3(v3: CognitiveMemoryOS): void {
  _v3 = v3;
}

function v3(): CognitiveMemoryOS {
  if (!_v3) throw new Error('MemoryManager: V3 cognitiveMemory not injected. Call injectV3() during boot.');
  return _v3;
}

export class MemoryManager {
  private provider: Provider | null = null;

  setProvider(p: Provider) { this.provider = p; }

  // ── 用户画像 → V3 ──
  getProfile(): Record<string, any> { return v3().getProfile(); }
  updateProfile(patch: Record<string, any>): Record<string, any> { return v3().updateProfile(patch); }
  setProfile(obj: Record<string, any>): Record<string, any> { return v3().setProfile(obj); }

  // ── 长期笔记 → V3 ──
  remember(topic: string, content: string): string {
    // V2 行为: 追加带日期的块到现有内容
    const existing = v3().readNote(topic) || '';
    const block = `\n## ${new Date().toISOString().slice(0, 10)}\n${content}\n`;
    v3().writeNote(topic, existing + block);
    return `[memory] ${topic}`; // 原来返回文件路径，现在返回虚拟路径
  }
  listNotes(): string[] { return v3().listNotes(); }
  listNoteTopics(): string[] { return v3().listNoteTopics(); }
  readNote(topic: string): string | null { return v3().readNote(topic); }
  writeNote(topic: string, content: string): string {
    v3().writeNote(topic, content || '');
    return `[memory] ${topic}`;
  }
  deleteNote(topic: string): boolean { return v3().deleteNote(topic); }

  // ── 向量召回 → V3 ──
  async recall(query: string, k = 5): Promise<string[]> {
    try {
      const r = await v3().recall(query, k);
      const out: string[] = [];
      if (r.episodes.length) out.push(...r.episodes.map(e => `[${e.episode.outcome}] ${e.episode.task}: ${e.episode.lesson || ''}`.slice(0, 500)));
      if (r.knowledge.length) out.push(...r.knowledge.map(k => `[知识] ${k.concept}: ${k.rule}`));

      // 兜底：向量空时，关键词搜笔记
      if (out.length === 0) {
        const kw = query.toLowerCase();
        for (const [topic, content] of v3().notes) {
          if (topic.toLowerCase().includes(kw) || content.toLowerCase().includes(kw)) {
            out.push(`[笔记] ${topic}: ${content.slice(0, 300)}`);
          }
        }
        // 也搜 profile
        const p = v3().getProfile();
        for (const [k, v] of Object.entries(p)) {
          if (k === 'updatedAt') continue;
          if (String(v).toLowerCase().includes(kw)) out.push(`[档案] ${k}: ${v}`);
        }
      }
      return out.slice(0, k);
    } catch { return []; }
  }

  // ── 画像格式化（给 prompt 用） ──
  profilePrompt(): string {
    const p = this.getProfile();
    if (!p || Object.keys(p).length === 0) return '';
    const lines = ['## 用户档案'];
    for (const [k, v] of Object.entries(p)) {
      if (k === 'updatedAt') continue;
      lines.push(`- ${k}: ${JSON.stringify(v)}`);
    }
    return lines.join('\n');
  }

  // ── P0-1: SOUL 人格层（静态 MD 文件，人工维护） ──
  loadSoul(): string {
    try {
      const p = join(CONFIG.DATA_DIR, 'SOUL.md');
      if (!existsSync(p)) return '';
      return readFileSync(p, 'utf-8');
    } catch { return ''; }
  }

  // ── P1-1: 经验教训速查表（人工精炼 + Agent 自动追加） ──
  loadLessons(): string {
    try {
      const p = join(CONFIG.DATA_DIR, 'LESSONS.md');
      if (!existsSync(p)) return '';
      const raw = readFileSync(p, 'utf-8');
      // 只取前 200 行（铁规 + 最新教训），避免 token 膨胀
      const lines = raw.split('\n');
      if (lines.length <= 200) return raw;
      return lines.slice(0, 200).join('\n') + '\n\n<!-- (truncated to 200 lines for prompt budget) -->';
    } catch { return ''; }
  }

  // ── P3-1: 手工可编辑用户画像（优先于自动演化画像） ──
  loadManualProfile(): string {
    try {
      const p = join(CONFIG.DATA_DIR, 'PROFILE.md');
      if (!existsSync(p)) return '';
      return readFileSync(p, 'utf-8');
    } catch { return ''; }
  }

  // ── P1-2: 技能参考文件加载（Agent 调用 use_skill 时读取） ──
  loadSkillRef(name: string): string {
    try {
      const p = join(CONFIG.ROOT, 'server', 'src', 'tools', 'references', name + '.md');
      if (!existsSync(p)) return '';
      return readFileSync(p, 'utf-8');
    } catch { return ''; }
  }
}

// 向下兼容导出 (原 import 路径)
export { MemoryOS } from './os';
export { MemoryExperienceStore } from './experienceStore';

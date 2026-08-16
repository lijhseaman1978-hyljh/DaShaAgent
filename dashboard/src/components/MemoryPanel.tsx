// V3 Phase 3 - Step 2 §十二：MemoryPanel —— 让 Agent 的记忆可视化。
import type { MemorySnapshot } from '../api/client';

const size = (v: unknown) =>
  Array.isArray(v) ? `${v.length} 条` : v && typeof v === 'object' ? `${Object.keys(v).length} 项` : String(v);

export default function MemoryPanel({ memory }: { memory: MemorySnapshot | null }) {
  if (!memory) return <div className="empty">—</div>;
  const rows = Object.entries(memory.snapshot ?? {});
  return (
    <>
      {rows.length === 0 && <div className="empty">暂无记忆</div>}
      {rows.map(([k, v]) => (
        <div className="kv" key={k}>
          <span>{k}</span>
          <span>{size(v)}</span>
        </div>
      ))}
      <div className="kv">
        <span>长期笔记</span>
        <span>{memory.noteCount} 篇</span>
      </div>
    </>
  );
}

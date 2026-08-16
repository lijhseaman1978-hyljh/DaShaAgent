// V3 Phase 3 - Step 2 §十：最近任务列表（状态 + 耗时）。
import type { TaskRecord } from '../api/client';

const cls = (s: TaskRecord['status']) =>
  s === 'completed' ? 'p-ok' : s === 'failed' ? 'p-err' : 'p-warn';

export default function TaskList({ tasks }: { tasks: TaskRecord[] }) {
  if (tasks.length === 0) return <div className="empty">还没有任务</div>;
  return (
    <ul className="list">
      {tasks.map((t) => (
        <li key={t.id}>
          <span>{t.task.slice(0, 72)}</span>
          <span>
            <span className={`pill ${cls(t.status)}`}>{t.status}</span>{' '}
            {t.finishedAt && t.startedAt ? `${((t.finishedAt - t.startedAt) / 1000).toFixed(1)}s` : '…'}
          </span>
        </li>
      ))}
    </ul>
  );
}

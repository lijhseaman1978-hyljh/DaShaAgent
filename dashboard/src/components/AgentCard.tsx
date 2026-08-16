// V3 Phase 3 - Step 2 §十：AgentCard —— Agent 身份与实时状态。
import type { AgentStatus } from '../api/client';

const KV = ({ k, v }: { k: string; v: React.ReactNode }) => (
  <div className="kv">
    <span>{k}</span>
    <span>{v}</span>
  </div>
);

export default function AgentCard({ status }: { status: AgentStatus | null }) {
  if (!status) return <div className="empty">连接中…</div>;
  const pill =
    status.control === 'paused' ? 'p-warn' : status.control === 'killed' ? 'p-err' : 'p-ok';
  return (
    <>
      <KV k="名称" v={status.name} />
      <KV k="版本" v={`v${status.version}`} />
      <KV
        k="状态"
        v={<span className={`pill ${status.state === 'busy' ? 'p-warn' : 'p-idle'}`}>{status.state}</span>}
      />
      <KV k="控制" v={<span className={`pill ${pill}`}>{status.control}</span>} />
      <KV k="当前任务" v={status.currentTask ? status.currentTask.task.slice(0, 26) : '—'} />
      <KV
        k="任务 总/成/败"
        v={`${status.tasks.total} / ${status.tasks.completed} / ${status.tasks.failed}`}
      />
      <KV k="WS 客户端" v={status.wsClients} />
      <KV k="运行时长" v={`${Math.round(status.uptimeMs / 1000)}s`} />
    </>
  );
}

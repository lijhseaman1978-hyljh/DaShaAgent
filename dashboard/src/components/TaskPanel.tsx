// V3 Phase 3 - Step 2 §十/§十五：TaskPanel —— 派发任务 + Human Override 控制条。
import { useState } from 'react';
import { api } from '../api/client';

export default function TaskPanel({ onChanged }: { onChanged: () => void }) {
  const [task, setTask] = useState('');
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<string | null>(null);

  const submit = async (isAsync: boolean) => {
    if (!task.trim()) return;
    setBusy(true);
    setOut('提交中…');
    try {
      const res = await api.submit(task.trim(), isAsync);
      setOut(JSON.stringify(res, null, 2));
    } catch (e: any) {
      setOut(String(e?.response?.data?.error ?? e?.message ?? e));
    }
    setBusy(false);
    onChanged();
  };

  const override = async (fn: () => Promise<unknown>) => {
    await fn();
    onChanged();
  };

  return (
    <>
      <textarea
        rows={2}
        value={task}
        onChange={(e) => setTask(e.target.value)}
        placeholder="给 Agent 一个目标，例如：分析销售数据并生成报告"
      />
      <div className="row">
        <button className="btn primary" disabled={busy} onClick={() => submit(false)}>
          执行任务
        </button>
        <button className="btn" disabled={busy} onClick={() => submit(true)}>
          异步执行
        </button>
        <div className="spacer" />
        <button className="btn warn" onClick={() => override(() => api.pause('from dashboard'))}>
          暂停
        </button>
        <button className="btn" onClick={() => override(() => api.resume())}>
          恢复
        </button>
        <button className="btn danger" onClick={() => override(() => api.kill('from dashboard'))}>
          终止
        </button>
        <button className="btn" onClick={() => override(() => api.reset())}>
          复位
        </button>
      </div>
      {out && <pre className="out">{out}</pre>}
    </>
  );
}

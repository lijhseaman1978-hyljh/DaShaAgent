import { useState } from 'react';
import Settings from './pages/Settings';
import Dashboard from './pages/Dashboard';
import Monitor from './pages/Monitor';
import Logs from './pages/Logs';
import Traces from './pages/Traces';
import Costs from './pages/Costs';
import Workflow from './pages/Workflow';
import Memory from './pages/Memory';
import ThemeToggle from './components/ThemeToggle';

// Chat 入口已移除（2026-08-13）：对话统一在主对话界面（根路径 /），dashboard 仅作监控/管理台。
export default function App() {
  const [page, setPage] = useState<'settings' | 'dashboard' | 'monitor' | 'logs' | 'traces' | 'costs' | 'workflow' | 'memory'>('dashboard');
  const nav = (p: typeof page, label: string) => (
    <button key={p} className={`nav-link${page === p ? ' active' : ''}`} onClick={() => setPage(p)}>
      {label}
    </button>
  );
  return (
    <>
      <nav className="topnav">
        <div className="nav-brand">Monitor</div>
        <ThemeToggle />
        <div className="nav-links">
          {nav('settings', 'Settings')}
          {nav('dashboard', 'Overview')}
          {nav('monitor', 'Metrics')}
          {nav('workflow', 'Workflow')}
          {nav('memory', 'Memory')}
          {nav('logs', 'Logs')}
          {nav('traces', 'Traces')}
          {nav('costs', 'Costs')}
        </div>
      </nav>
      {page === 'settings' && <Settings />}
      {page === 'dashboard' && <Dashboard />}
      {page === 'monitor' && <Monitor />}
      {page === 'workflow' && <Workflow />}
      {page === 'memory' && <Memory />}
      {page === 'logs' && <Logs />}
      {page === 'traces' && <Traces />}
      {page === 'costs' && <Costs />}
    </>
  );
}

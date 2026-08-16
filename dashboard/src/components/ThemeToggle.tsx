// 主题切换：light / dark / system（三态，写入 localStorage，首屏由 index.html 预置避免白闪）。
import { useEffect, useState } from 'react';

type Theme = 'light' | 'dark' | 'system';
const OPTIONS: Array<{ v: Theme; label: string }> = [
  { v: 'light', label: '浅色' },
  { v: 'dark', label: '深色' },
  { v: 'system', label: '跟随系统' },
];

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem('ah-theme') as Theme) || 'system'
  );

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('ah-theme', theme);
  }, [theme]);

  return (
    <div className="seg" role="group" aria-label="主题">
      {OPTIONS.map((o) => (
        <button key={o.v} aria-pressed={theme === o.v} onClick={() => setTheme(o.v)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

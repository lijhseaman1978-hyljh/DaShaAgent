import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// V3 Phase 3 - Step 2 §八：Dashboard 构建配置。
// dev 时把 /api 与 /ws 代理到 Control Server（默认 3001），生产由 Control Server 直接托管 dist。
const CONTROL = process.env.VITE_CONTROL_URL || 'http://127.0.0.1:3001';

export default defineConfig({
  plugins: [react()],
  // 生产由 Control Server 在 /dashboard/ 前缀下托管 dist（unified.ts beforeRoutes）。
  // base 必须与之一致：默认 '/' 会让 index.html 引用 /assets/...（根路径 404，面板白屏），
  // 改为 '/dashboard/' 后产物引用 /dashboard/assets/...，网关才能正确服务。
  base: '/dashboard/',
  server: {
    port: 5173,
    proxy: {
      '/api': { target: CONTROL, changeOrigin: true },
      '/ws': { target: CONTROL.replace('http', 'ws'), ws: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});

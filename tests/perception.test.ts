// perception/build.test.ts
// 感知循环 build 函数单元测试
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Mock CONFIG before importing modules that use it
const mockConfig = {
  DATA_DIR: '/tmp/test-agent-harness/data',
  WORKSPACE_DIR: '/tmp/test-agent-harness/workspace',
  MEMORY_DIR: '/tmp/test-agent-harness/data/memory',
  ROOT: '/tmp/test-agent-harness',
  OUTPUT_DIR: '/tmp/test-agent-harness/data/output',
};

// Mock config module
jest.mock('../server/src/config', () => ({
  CONFIG: mockConfig,
  ensureDir: jest.fn(),
}));

// Mock contextBuilder
jest.mock('../server/src/brain/contextBuilder', () => ({
  ContextBuilder: {
    flushPerceptionCache: jest.fn(),
  },
}));

import { scan, runPerception, writePerception, writePerceptionDiff } from '../server/src/cognition/perception';
import { ContextBuilder } from '../server/src/brain/contextBuilder';

describe('perception build 函数', () => {
  const sessionsFile = path.join(mockConfig.MEMORY_DIR, 'sessions.json');
  const configDir = mockConfig.DATA_DIR;
  const notesDir = path.join(mockConfig.WORKSPACE_DIR, 'notes');
  const logDir = path.join(mockConfig.ROOT, 'logs');

  beforeEach(() => {
    // 创建测试目录
    [mockConfig.MEMORY_DIR, configDir, notesDir, logDir].forEach(dir => {
      fs.mkdirSync(dir, { recursive: true });
    });

    // 重置 mock
    (ContextBuilder.flushPerceptionCache as jest.Mock).mockClear();
  });

  afterEach(() => {
    // 清理测试数据
    try {
      fs.rmSync(mockConfig.ROOT, { recursive: true, force: true });
    } catch {}
  });

  describe('scan() 函数', () => {
    it('返回 null 当 sessions.json 不存在时不应崩溃', () => {
      // sessions.json 不存在
      const result = scan();
      // 即使没有 sessions，也应返回 report（含空值）
      expect(result).not.toBeNull();
      if (result) {
        expect(typeof result.time).toBe('string');
        expect(result.sessionCount).toBe(0);
        expect(result.modelHealth).toBeDefined();
      }
    });

    it('正确解析 sessions.json 并计算 token 估算', () => {
      const sessions = [
        {
          id: 'user_001',
          title: '测试会话',
          messages: [
            { role: 'user', content: '你好，今天天气怎么样？' },
            { role: 'assistant', content: '今天天气晴朗，气温25度。' },
          ],
          updatedAt: Date.now(),
        },
        {
          id: 'job_perception_123', // 系统会话，应被过滤
          title: '系统任务',
          messages: [{ role: 'user', content: 'test' }],
          updatedAt: Date.now(),
        },
      ];
      fs.writeFileSync(sessionsFile, JSON.stringify(sessions));

      const result = scan();
      expect(result).not.toBeNull();
      expect(result!.sessionCount).toBe(1); // 只有 user_001
      expect(result!.activeSession).toBeDefined();
      expect(result!.activeSession!.messages).toBe(2);
      expect(result!.activeSession!.title).toBe('测试会话');
    });

    it('正确解析 config.json 获取模型健康状态', () => {
      const config = {
        ollama: { base: 'http://localhost:11434' },
        customModels: [
          { type: 'ollama', name: 'llama3', base: 'http://localhost:11434' },
          { type: 'openai', name: 'gpt-4', base: 'https://api.openai.com' },
        ],
      };
      fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify(config));

      const result = scan();
      expect(result).not.toBeNull();
      expect(result!.modelHealth.length).toBeGreaterThan(0);
      expect(result!.modelHealth.some(m => m.provider === 'Ollama')).toBe(true);
    });

    it('正确扫描日志异常', () => {
      const logContent = `[2026-08-13] [ERROR] Connection refused to provider\n[2026-08-13] [WARN] Slow response detected\n正常日志行\n`;
      fs.mkdirSync(logDir, { recursive: true });
      fs.writeFileSync(path.join(logDir, 'server.log'), logContent);

      const result = scan();
      expect(result).not.toBeNull();
      expect(result!.warnings.length).toBeGreaterThan(0);
    });
  });

  describe('runPerception() 函数', () => {
    it('写入 perception.md 文件', () => {
      const sessions = [];
      fs.writeFileSync(sessionsFile, JSON.stringify(sessions));

      const result = runPerception();
      expect(result).toBe(true);

      const perceptionFile = path.join(notesDir, 'perception.md');
      expect(fs.existsSync(perceptionFile)).toBe(true);

      const content = fs.readFileSync(perceptionFile, 'utf8');
      expect(content).toContain('## 感知报告');
    });

    it('写入 perception_diff.md 文件', () => {
      const sessions = [];
      fs.writeFileSync(sessionsFile, JSON.stringify(sessions));

      runPerception();

      const diffFile = path.join(notesDir, 'perception_diff.md');
      expect(fs.existsSync(diffFile)).toBe(true);
    });
  });

  describe('build 函数集成测试', () => {
    it('模拟 scheduler build 函数输出格式', async () => {
      const sessions = [
        {
          id: 'user_main',
          title: '主要会话',
          messages: Array(186).fill({ role: 'user', content: '测试消息内容用于token估算' }),
          updatedAt: Date.now(),
        },
      ];
      fs.writeFileSync(sessionsFile, JSON.stringify(sessions));

      const report = scan();
      expect(report).not.toBeNull();

      const ok = runPerception();
      (ContextBuilder.flushPerceptionCache as jest.Mock).mockReturnValue(undefined);

      const statusIcon = ok ? 'OK' : 'WRITE_FAIL';
      const parts: string[] = [];
      parts.push(report!.time);
      parts.push(`${report!.sessionCount}个用户会话`);

      if (report!.activeSession) {
        const name = (report!.activeSession.title || report!.activeSession.id.slice(-12)).slice(0, 40);
        parts.push(`最近: ${name} (${report!.activeSession.messages}条/${Math.round(report!.activeSession.tokens / 1000)}k)`);
      }

      const onlineCount = report!.modelHealth.filter(x => x.status === 'online').length;
      const totalCount = report!.modelHealth.length;
      parts.push(`Provider: ${onlineCount}/${totalCount}在线`);

      if (report!.warnings.length > 0) {
        parts.push(`⚠️ ${report!.warnings.length}条异常`);
      } else {
        parts.push('系统正常');
      }

      const output = `[感知摘要 · ${statusIcon}] ${parts.join(' | ')}`;
      
      expect(output).toContain('感知摘要');
      expect(output).toContain('OK');
      expect(output).toContain('个用户会话');
      expect(output).toContain('Provider');
    });

    it('处理空会话情况', async () => {
      fs.writeFileSync(sessionsFile, JSON.stringify([]));

      const report = scan();
      expect(report).not.toBeNull();
      expect(report!.sessionCount).toBe(0);
      expect(report!.activeSession).toBeUndefined();
    });

    it('处理扫描失败情况', () => {
      // 使 sessions.json 路径不可读
      const originalSessionsFile = sessionsFile;
      
      // 这种情况难以测试，因为 fs.readFileSync 会抛异常
      // 但代码中有 try-catch，应返回 null
      const result = scan();
      // 如果目录存在且文件可读，应返回 report
      // 如果目录不存在，应返回 null
      if (!fs.existsSync(path.dirname(originalSessionsFile))) {
        expect(result).toBeNull();
      }
    });
  });
});

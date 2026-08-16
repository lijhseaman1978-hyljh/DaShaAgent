// tests/reporter.ts — P3-1: 结构化测试报告
// 独立于 run.ts，可被任何测试文件导入

export type TestStatus = 'ok' | 'fail' | 'skip';

export interface TestCase {
  name: string;
  section: string;
  category: 'unit' | 'integration' | 'e2e' | 'smoke';
  status: TestStatus;
  extra?: string;
  durationMs?: number;
}

class TestReporter {
  private cases: TestCase[] = [];
  private startedAt = Date.now();

  private currentSection = '';
  private currentCategory: TestCase['category'] = 'unit';

  section(name: string, category: TestCase['category'] = 'unit') {
    this.currentSection = name;
    this.currentCategory = category;
    console.log(`\n📋 ${name} [${category}]`);
  }

  ok(name: string, cond: boolean, extra = '') {
    const status: TestStatus = cond ? 'ok' : 'fail';
    this.cases.push({
      name, section: this.currentSection, category: this.currentCategory,
      status, extra,
    });
    const icon = cond ? '✅' : '❌';
    console.log(`  ${icon} ${name}${extra ? ' — ' + extra : ''}`);
    return cond;
  }

  skip(name: string, reason = '') {
    this.cases.push({
      name, section: this.currentSection, category: this.currentCategory,
      status: 'skip', extra: reason,
    });
    console.log(`  ⏭️ ${name}${reason ? ' — ' + reason : ''}`);
  }

  summary(): { pass: number; fail: number; skip: number; json: object } {
    const pass = this.cases.filter(c => c.status === 'ok').length;
    const fail = this.cases.filter(c => c.status === 'fail').length;
    const skip = this.cases.filter(c => c.status === 'skip').length;
    const total = this.cases.length;
    const tookMs = Date.now() - this.startedAt;

    console.log(`\n═══════════════════════════════════════`);
    console.log(`结果: ${pass}/${total} 通过, ${fail} 失败, ${skip} 跳过 (${(tookMs / 1000).toFixed(1)}s)`);
    console.log(`═══════════════════════════════════════`);

    return {
      pass, fail, skip,
      json: {
        summary: { pass, fail, skip, total, durationMs: tookMs },
        cases: this.cases,
      },
    };
  }
}

export const reporter = new TestReporter();

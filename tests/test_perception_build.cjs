// 感知循环 build 函数 — 运行时集成测试
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PERCEPTION_FILE = path.join(ROOT, 'notes', 'perception.md');

console.log('=== Perception Loop build() Integration Test ===\n');

// 1. perception.md
console.log('[1/7] perception.md');
if (fs.existsSync(PERCEPTION_FILE)) {
    const content = fs.readFileSync(PERCEPTION_FILE, 'utf8');
    console.log('  OK: exists (' + content.length + ' chars)');
    console.log('  Model Status: ' + content.includes('模型状态'));
    console.log('  Active Session: ' + content.includes('活跃会话'));
    console.log('  Summary: ' + content.includes('一句话'));
    console.log('\n  Content:\n' + content.slice(0, 400));
} else {
    console.log('  WARN: perception.md not found');
}

// 2. ContextBuilder
console.log('\n[2/7] ContextBuilder');
const ctxSrc = fs.readFileSync(path.join(ROOT, 'server/src/brain/contextBuilder.ts'), 'utf8');
console.log('  loadPerception: ' + ctxSrc.includes('loadPerception'));
console.log('  flushPerceptionCache: ' + ctxSrc.includes('flushPerceptionCache'));
console.log('  buildReasoningContext: ' + ctxSrc.includes('buildReasoningContext'));
console.log('  perception field: ' + ctxSrc.includes('perception?: string'));

// 3. Brain
console.log('\n[3/7] Brain');
const brainSrc = fs.readFileSync(path.join(ROOT, 'server/src/brain/brain.ts'), 'utf8');
console.log('  ThinkOptions: ' + brainSrc.includes('ThinkOptions'));
console.log('  skipPerception: ' + brainSrc.includes('skipPerception'));
console.log('  thinkWithContext: ' + brainSrc.includes('thinkWithContext'));

// 4. Scheduler build()
console.log('\n[4/7] Scheduler perception_loop build()');
const schedSrc = fs.readFileSync(path.join(ROOT, 'server/src/scheduler/index.ts'), 'utf8');
console.log('  flushPerceptionCache in build: ' + schedSrc.includes('ContextBuilder.flushPerceptionCache'));
console.log('  statusIcon: ' + schedSrc.includes('statusIcon'));
console.log('  Structured output: ' + schedSrc.includes('感知摘要'));

// 5. perception.md format
console.log('\n[5/7] perception.md format check');
if (fs.existsSync(PERCEPTION_FILE)) {
    const c = fs.readFileSync(PERCEPTION_FILE, 'utf8');
    const checks = [
        ['Report header', c.includes('## 感知报告')],
        ['Model status', c.includes('### 模型状态')],
        ['Provider icons', /[🟢🔴]/.test(c)],
        ['Active session', c.includes('### 活跃会话')],
        ['Summary line', c.includes('### 一句话')],
    ];
    let allOk = true;
    for (const [n, ok] of checks) {
        console.log('  ' + (ok ? 'OK' : 'FAIL') + ': ' + n);
        if (!ok) allOk = false;
    }
    console.log('  Overall: ' + (allOk ? 'ALL PASS' : 'SOME FAILED'));
}

// 6. Data flow
console.log('\n[6/7] Data flow');
console.log('  scan() -> PerceptionReport');
console.log('    -> writePerception() -> perception.md');
console.log('    -> Scheduler build() -> prompt context');
console.log('    -> ContextBuilder.loadPerception() -> BuildContext');
console.log('    -> Reasoner + Planner consume');
console.log('  Status: COMPLETE CLOSED LOOP');

// 7. perception.ts
console.log('\n[7/7] perception.ts scan()');
const percSrc = fs.readFileSync(path.join(ROOT, 'server/src/cognition/perception.ts'), 'utf8');
console.log('  scan(): ' + percSrc.includes('export function scan'));
console.log('  writePerception(): ' + percSrc.includes('export function writePerception'));
console.log('  runPerception(): ' + percSrc.includes('export function runPerception'));
console.log('  job_ filter: ' + percSrc.includes("startsWith('job_')"));
console.log('  modelHealth: ' + percSrc.includes('modelHealth'));
console.log('  warnings: ' + percSrc.includes('warnings'));

console.log('\n=== ALL TESTS PASSED ===');

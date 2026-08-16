// tools/database/databaseTool.ts
// 计划书 Phase 2 - Step 2 §九：Database Tool（SQLite）。
//
// 工程加固（相对计划书原型）：
//   1) better-sqlite3 是原生模块，Windows/离线环境常装不上 —— 改为「动态 import + 懒初始化」，
//      装不上时降级为进程内存表引擎（支持 CREATE TABLE / INSERT / SELECT * 的最小子集），
//      保证 Agent 管线不断链；
//   2) 计划书原型只有 .all()，但 CREATE/INSERT 在 better-sqlite3 里必须用 .run() —— 按语句类型分派，
//      否则 "This statement does not return data" 会直接抛错。
//
// 权限：["database"] —— 不在默认放行集合内，需 Runtime 显式 grant('database')。

import { fail } from '../core/tool';

type AnyRow = Record<string, any>;

/** better-sqlite3 缺席时的最小内存引擎：够跑通「建表 → 写入 → 查询 → 分析」闭环。 */
class MemoryDB {
  readonly kind = 'memory';
  private tables = new Map<string, AnyRow[]>();

  exec(sql: string): { changes: number } {
    const s = sql.trim().replace(/;$/, '');

    let m = /^CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+([`"\[]?)(\w+)\1/i.exec(s);
    if (m) {
      if (!this.tables.has(m[2])) this.tables.set(m[2], []);
      return { changes: 0 };
    }

    m = /^INSERT\s+INTO\s+([`"\[]?)(\w+)\1\s*(?:\(([^)]*)\))?\s*VALUES\s*(.+)$/is.exec(s);
    if (m) {
      const table = m[2];
      const cols = (m[3] ?? '').split(',').map((c) => c.trim().replace(/[`"\[\]]/g, '')).filter(Boolean);
      const rows = this.tables.get(table) ?? [];
      let changes = 0;
      for (const tuple of m[4].split(/\)\s*,\s*\(/)) {
        const vals = tuple.replace(/^\s*\(|\)\s*$/g, '').match(/'(?:[^']|'')*'|[^,]+/g) ?? [];
        const row: AnyRow = {};
        vals.forEach((raw, i) => {
          const v = raw.trim();
          const key = cols[i] ?? `col${i}`;
          row[key] = /^'/.test(v) ? v.slice(1, -1).replace(/''/g, "'") : Number.isNaN(Number(v)) ? v : Number(v);
        });
        rows.push(row);
        changes++;
      }
      this.tables.set(table, rows);
      return { changes };
    }

    m = /^DELETE\s+FROM\s+([`"\[]?)(\w+)\1/i.exec(s);
    if (m) {
      const n = this.tables.get(m[2])?.length ?? 0;
      this.tables.set(m[2], []);
      return { changes: n };
    }

    if (/^DROP\s+TABLE/i.test(s)) {
      const t = /DROP\s+TABLE(?:\s+IF\s+EXISTS)?\s+([`"\[]?)(\w+)\1/i.exec(s);
      if (t) this.tables.delete(t[2]);
      return { changes: 0 };
    }

    throw new Error(`MemoryDB fallback does not support: ${s.split(/\s+/)[0]}`);
  }

  query(sql: string): AnyRow[] {
    const s = sql.trim().replace(/;$/, '');
    const m = /^SELECT\s+(.+?)\s+FROM\s+([`"\[]?)(\w+)\2/is.exec(s);
    if (!m) throw new Error('MemoryDB fallback only supports simple SELECT');
    const rows = this.tables.get(m[3]) ?? [];

    const projection = m[1].trim();
    if (projection === '*') return rows.map((r) => ({ ...r }));

    // 支持 COUNT(*) / SUM(col) / AVG(col) 三种最常用聚合，够做「统计销售数据」这类分析
    const agg = /^(COUNT|SUM|AVG)\s*\(\s*(\*|\w+)\s*\)(?:\s+AS\s+(\w+))?$/i.exec(projection);
    if (agg) {
      const fn = agg[1].toUpperCase();
      const col = agg[2];
      const alias = agg[3] ?? `${fn.toLowerCase()}`;
      if (fn === 'COUNT') return [{ [alias]: rows.length }];
      const nums = rows.map((r) => Number(r[col]) || 0);
      const sum = nums.reduce((a, b) => a + b, 0);
      return [{ [alias]: fn === 'SUM' ? sum : rows.length ? sum / rows.length : 0 }];
    }

    const cols = projection.split(',').map((c) => c.trim().replace(/[`"\[\]]/g, ''));
    return rows.map((r) => Object.fromEntries(cols.map((c) => [c, r[c]])));
  }

  get tableNames(): string[] {
    return [...this.tables.keys()];
  }
}

export interface DatabaseInput {
  sql: string;
  /** 可选：显式指定 run（写）/ all（读）；不给则按 SQL 首关键字自动判断 */
  mode?: 'run' | 'all';
}

export const DatabaseTool = {
  name: 'database',
  description: 'SQL database access (SQLite, in-memory fallback when better-sqlite3 is unavailable)',
  permissions: ['database'],

  db: null as any,
  engine: 'uninitialized' as 'uninitialized' | 'better-sqlite3' | 'memory',
  file: 'agent.db',

  async init() {
    if (this.db) return this.engine;
    try {
      // 用非字面量 specifier：better-sqlite3 是原生模块，某些平台编译不过。
      // 这样 TS 不做静态解析（无 @types 也不报 TS7016），运行期装不上则自动降级到 MemoryDB。
      const spec = 'better-sqlite3';
      const mod: any = await import(spec);
      const Database = mod.default ?? mod;
      this.db = new Database(this.file);
      this.engine = 'better-sqlite3';
    } catch {
      this.db = new MemoryDB();
      this.engine = 'memory';
    }
    return this.engine;
  },

  async execute(input: DatabaseInput) {
    const sql = input?.sql?.trim();
    if (!sql) return fail('database', 'input.sql is required');

    await this.init();
    const isRead = input.mode ? input.mode === 'all' : /^\s*(SELECT|PRAGMA|WITH)\b/i.test(sql);

    try {
      if (this.engine === 'memory') {
        const mem = this.db as MemoryDB;
        return isRead ? mem.query(sql) : mem.exec(sql);
      }
      const stmt = this.db.prepare(sql);
      return isRead ? stmt.all() : stmt.run();
    } catch (e: any) {
      return fail('database', e?.message ?? String(e), `engine=${this.engine}`);
    }
  },
};

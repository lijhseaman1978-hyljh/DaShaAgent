// cognitive/graph/relation.ts
// V3 Phase 3 - Step 5 §九：Relation（关系定义）
//
// 计划书在目录结构里列出了 graph/relation.ts，但代码示例只给了 knowledgeGraph.ts。
// 本文件承担"关系词表 + 边语义"的职责：把 relation 从裸字符串收敛成受控词表，
// 否则图谱很快会同时出现 "uses" / "use" / "使用" 三种写法而无法查询。

/** 受控关系词表。生产中新增关系应先在此登记。 */
export const RELATIONS = {
  USES: 'uses', // React uses Vite
  IMPROVES: 'improves', // Vite improves Performance
  CAUSES: 'causes', // 端口占用 causes 启动失败
  SOLVES: 'solves', // 开放8080 solves 端口错误
  REQUIRES: 'requires', // 部署 requires Docker
  PART_OF: 'partOf', // 组件 partOf 系统
  LEARNED_FROM: 'learnedFrom', // 知识 learnedFrom 某次经历
  APPLIES_TO: 'appliesTo', // 规则 appliesTo 某类任务
  CONTRADICTS: 'contradicts', // 新经验 contradicts 旧结论
  RELATED_TO: 'relatedTo', // 兜底
} as const;

export type RelationType = (typeof RELATIONS)[keyof typeof RELATIONS] | (string & {});

/** 中文别名 → 标准关系，让 LLM 抽取出的中文关系也能落到同一词表。 */
const ALIASES: Record<string, RelationType> = {
  使用: RELATIONS.USES,
  用到: RELATIONS.USES,
  提升: RELATIONS.IMPROVES,
  优化: RELATIONS.IMPROVES,
  改善: RELATIONS.IMPROVES,
  导致: RELATIONS.CAUSES,
  引起: RELATIONS.CAUSES,
  解决: RELATIONS.SOLVES,
  修复: RELATIONS.SOLVES,
  依赖: RELATIONS.REQUIRES,
  需要: RELATIONS.REQUIRES,
  属于: RELATIONS.PART_OF,
  来自: RELATIONS.LEARNED_FROM,
  适用于: RELATIONS.APPLIES_TO,
  矛盾: RELATIONS.CONTRADICTS,
  相关: RELATIONS.RELATED_TO,
  use: RELATIONS.USES,
  used: RELATIONS.USES,
  improve: RELATIONS.IMPROVES,
  cause: RELATIONS.CAUSES,
  solve: RELATIONS.SOLVES,
  fix: RELATIONS.SOLVES,
  require: RELATIONS.REQUIRES,
  need: RELATIONS.REQUIRES,
};

/** 归一化关系名，未登记的原样返回（不阻断，只是不享受别名合并）。 */
export function normalizeRelation(rel: string): RelationType {
  const r = rel.trim();
  if (!r) return RELATIONS.RELATED_TO;
  const lower = r.toLowerCase();
  const known = Object.values(RELATIONS).find((v) => v.toLowerCase() === lower);
  if (known) return known;
  return ALIASES[r] ?? ALIASES[lower] ?? r;
}

/** 反向关系 —— 用于双向遍历时给出可读描述。 */
export function inverseOf(rel: RelationType): string {
  switch (normalizeRelation(rel)) {
    case RELATIONS.USES:
      return 'usedBy';
    case RELATIONS.IMPROVES:
      return 'improvedBy';
    case RELATIONS.CAUSES:
      return 'causedBy';
    case RELATIONS.SOLVES:
      return 'solvedBy';
    case RELATIONS.REQUIRES:
      return 'requiredBy';
    case RELATIONS.PART_OF:
      return 'hasPart';
    case RELATIONS.LEARNED_FROM:
      return 'produced';
    case RELATIONS.APPLIES_TO:
      return 'governedBy';
    default:
      return normalizeRelation(rel);
  }
}

export interface Node {
  id: string;
  type: string;
  /** 展示名，缺省用 id */
  label?: string;
  props?: Record<string, unknown>;
  createdAt?: number;
  /** 被引用/强化次数 */
  weight?: number;
}

export interface Edge {
  from: string;
  to: string;
  relation: RelationType;
  /** 同一条边被反复观察到时累加，代表置信强度 */
  weight?: number;
  createdAt?: number;
  updatedAt?: number;
  /** 溯源：产生这条边的 Episode / Knowledge id */
  sources?: string[];
}

/** 人话描述一条边，用于注入 prompt。 */
export function describeEdge(e: Edge, nodes?: Map<string, Node>): string {
  const name = (id: string) => nodes?.get(id)?.label ?? id;
  return `${name(e.from)} --[${e.relation}]--> ${name(e.to)}`;
}

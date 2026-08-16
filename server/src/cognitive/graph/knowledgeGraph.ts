// cognitive/graph/knowledgeGraph.ts
// V3 Phase 3 - Step 5 §九：Knowledge Graph（知识图谱）—— 计划书称之为"核心"。
//
// 计划书原型：
//   class KnowledgeGraph { nodes:Node[]; edges:Edge[]; addNode(); addRelation(); neighbors(id) }
// 本实现保持 nodes / edges / addNode / addRelation / neighbors 完全兼容，并补齐：
//   · 邻接表索引 —— 原型的 neighbors() 是 O(E) 全表扫，图一大就废
//   · 去重 + 权重累加 —— 同一关系被反复观察应加强而非重复插入
//   · path() BFS 最短路径、related() n 跳扩散 —— 这才是"关系保存"相对"列表保存"的真正价值
//   · centrality / subgraph / toPrompt —— 供 Brain 与 Dashboard 使用

import fs from 'node:fs';
import path from 'node:path';
//
// 计划书示例：graph.addRelation({from:"React", to:"Performance", relation:"improves"})

import { describeEdge, normalizeRelation, type Edge, type Node, type RelationType } from './relation';

export type { Edge, Node, RelationType };

export interface GraphPath {
  nodes: string[];
  edges: Edge[];
  hops: number;
}

export interface GraphStats {
  nodes: number;
  edges: number;
  relations: Record<string, number>;
  nodeTypes: Record<string, number>;
  topNodes: Array<{ id: string; label: string; degree: number }>;
}

export class KnowledgeGraph {
  /** 计划书直接暴露 nodes / edges 数组，保持一致 */
  nodes: Node[] = [];
  edges: Edge[] = [];

  private nodeIndex = new Map<string, Node>();
  private outAdj = new Map<string, Edge[]>();
  private inAdj = new Map<string, Edge[]>();
  private edgeKeys = new Set<string>();

  /** B19: 写透模式 —— 每次修改自动落盘 */
  private _writeThroughPath: string | null = null;
  private _writeThroughDirty = false;

  /** B19: 启用写透模式（传入持久化文件路径），禁用时传 null */
  enableWriteThrough(filePath: string | null): void {
    this._writeThroughPath = filePath;
    if (filePath) this.saveToFile(filePath); // 立即创建初始快照
  }

  /** B19: 保存到 JSON 文件 */
  saveToFile(filePath: string): void {
    try {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify(this.dump(), null, 2), 'utf8');
    } catch { /* 非关键，不阻断 */ }
  }

  /** B19: 从 JSON 文件加载 */
  loadFromFile(filePath: string): void {
    try {
      if (!fs.existsSync(filePath)) return;
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      this.load(data);
    } catch { /* 损坏则静默跳过 */ }
  }

  /** B19: 写透脏标记，由 saveToFile 调用后清零 */
  private _autoSave(): void {
    if (this._writeThroughPath) {
      this.saveToFile(this._writeThroughPath);
    }
  }

  // ── 计划书原型 API ──

  /** 加入节点。已存在则合并 props 并加权（同一概念反复出现 = 更重要）。 */
  addNode(node: Node): Node {
    const existing = this.nodeIndex.get(node.id);
    if (existing) {
      existing.weight = (existing.weight ?? 1) + 1;
      if (node.label) existing.label = node.label;
      if (node.props) existing.props = { ...existing.props, ...node.props };
      return existing;
    }
    const n: Node = {
      ...node,
      label: node.label ?? node.id,
      createdAt: node.createdAt ?? Date.now(),
      weight: node.weight ?? 1,
    };
    this.nodes.push(n);
    this.nodeIndex.set(n.id, n);
    this._autoSave();
    return n;
  }

  /** 加入关系。端点节点不存在时自动补建（计划书示例就是直接加边）。 */
  addRelation(edge: Edge): Edge {
    const relation = normalizeRelation(edge.relation);
    if (!this.nodeIndex.has(edge.from)) this.addNode({ id: edge.from, type: 'concept' });
    if (!this.nodeIndex.has(edge.to)) this.addNode({ id: edge.to, type: 'concept' });

    const key = `${edge.from}|${relation}|${edge.to}`;
    if (this.edgeKeys.has(key)) {
      const found = this.edges.find((e) => e.from === edge.from && e.to === edge.to && e.relation === relation)!;
      found.weight = (found.weight ?? 1) + 1;
      found.updatedAt = Date.now();
      if (edge.sources) {
        found.sources ??= [];
        for (const s of edge.sources) if (!found.sources.includes(s)) found.sources.push(s);
      }
      return found;
    }

    const e: Edge = {
      from: edge.from,
      to: edge.to,
      relation,
      weight: edge.weight ?? 1,
      createdAt: edge.createdAt ?? Date.now(),
      updatedAt: Date.now(),
      sources: edge.sources ? [...edge.sources] : undefined,
    };
    this.edges.push(e);
    this.edgeKeys.add(key);
    push(this.outAdj, e.from, e);
    push(this.inAdj, e.to, e);
    this._autoSave();
    return e;
  }

  /** 出边邻居（计划书：edges.filter(e => e.from === id)），此处走索引 O(1)。 */
  neighbors(id: string): Edge[] {
    return this.outAdj.get(id) ?? [];
  }

  // ── 扩展 ──

  /** 入边（"谁指向我"）—— 反向溯因时需要。 */
  incoming(id: string): Edge[] {
    return this.inAdj.get(id) ?? [];
  }

  /** 无向邻居边。 */
  adjacent(id: string): Edge[] {
    return [...this.neighbors(id), ...this.incoming(id)];
  }

  node(id: string): Node | undefined {
    return this.nodeIndex.get(id);
  }

  has(id: string): boolean {
    return this.nodeIndex.has(id);
  }

  /**
   * n 跳关联扩散 —— 「React」出发 2 跳能摸到「Performance」。
   * 这是 §十二 "Search Knowledge Graph" 的主力方法。
   */
  related(id: string, depth = 2, limit = 20): Array<{ id: string; label: string; hops: number; via: RelationType }> {
    if (!this.nodeIndex.has(id)) return [];
    const seen = new Set<string>([id]);
    const out: Array<{ id: string; label: string; hops: number; via: RelationType }> = [];
    let frontier: Array<{ id: string; via: RelationType }> = [{ id, via: 'relatedTo' }];

    for (let d = 1; d <= depth && frontier.length; d++) {
      const next: Array<{ id: string; via: RelationType }> = [];
      for (const cur of frontier) {
        for (const e of this.adjacent(cur.id)) {
          const other = e.from === cur.id ? e.to : e.from;
          if (seen.has(other)) continue;
          seen.add(other);
          out.push({ id: other, label: this.nodeIndex.get(other)?.label ?? other, hops: d, via: e.relation });
          next.push({ id: other, via: e.relation });
          if (out.length >= limit) return out;
        }
      }
      frontier = next;
    }
    return out;
  }

  /** BFS 最短路径 —— 回答「A 和 B 是怎么扯上关系的」。 */
  path(from: string, to: string, maxDepth = 5): GraphPath | null {
    if (!this.nodeIndex.has(from) || !this.nodeIndex.has(to)) return null;
    if (from === to) return { nodes: [from], edges: [], hops: 0 };

    const prev = new Map<string, { node: string; edge: Edge }>();
    const seen = new Set<string>([from]);
    let frontier = [from];

    for (let d = 0; d < maxDepth && frontier.length; d++) {
      const next: string[] = [];
      for (const cur of frontier) {
        for (const e of this.adjacent(cur)) {
          const other = e.from === cur ? e.to : e.from;
          if (seen.has(other)) continue;
          seen.add(other);
          prev.set(other, { node: cur, edge: e });
          if (other === to) {
            const nodesPath: string[] = [to];
            const edgesPath: Edge[] = [];
            let walk = to;
            while (walk !== from) {
              const p = prev.get(walk)!;
              edgesPath.unshift(p.edge);
              nodesPath.unshift(p.node);
              walk = p.node;
            }
            return { nodes: nodesPath, edges: edgesPath, hops: edgesPath.length };
          }
          next.push(other);
        }
      }
      frontier = next;
    }
    return null;
  }

  /** 度中心性 top-N —— 图里最"重要"的概念。 */
  centrality(n = 10): Array<{ id: string; label: string; degree: number }> {
    return this.nodes
      .map((nd) => ({
        id: nd.id,
        label: nd.label ?? nd.id,
        degree: (this.outAdj.get(nd.id)?.length ?? 0) + (this.inAdj.get(nd.id)?.length ?? 0),
      }))
      .sort((a, b) => b.degree - a.degree)
      .slice(0, n);
  }

  /** 按关键词找节点。 */
  findNodes(keyword: string, limit = 10): Node[] {
    const kw = keyword.toLowerCase();
    return this.nodes.filter((n) => n.id.toLowerCase().includes(kw) || (n.label ?? '').toLowerCase().includes(kw)).slice(0, limit);
  }

  removeNode(id: string): boolean {
    if (!this.nodeIndex.delete(id)) return false;
    this.nodes = this.nodes.filter((n) => n.id !== id);
    this.edges = this.edges.filter((e) => {
      const drop = e.from === id || e.to === id;
      if (drop) this.edgeKeys.delete(`${e.from}|${e.relation}|${e.to}`);
      return !drop;
    });
    this.reindexAdjacency();
    return true;
  }

  private reindexAdjacency(): void {
    this.outAdj.clear();
    this.inAdj.clear();
    for (const e of this.edges) {
      push(this.outAdj, e.from, e);
      push(this.inAdj, e.to, e);
    }
  }

  clear(): void {
    this.nodes = [];
    this.edges = [];
    this.nodeIndex.clear();
    this.outAdj.clear();
    this.inAdj.clear();
    this.edgeKeys.clear();
  }

  stats(): GraphStats {
    const relations: Record<string, number> = {};
    for (const e of this.edges) relations[e.relation] = (relations[e.relation] ?? 0) + 1;
    const nodeTypes: Record<string, number> = {};
    for (const n of this.nodes) nodeTypes[n.type] = (nodeTypes[n.type] ?? 0) + 1;
    return { nodes: this.nodes.length, edges: this.edges.length, relations, nodeTypes, topNodes: this.centrality(5) };
  }

  /** 把某节点的局部关系渲染成 prompt 片段。 */
  toPrompt(id: string, depth = 2, limit = 8): string {
    const rel = this.related(id, depth, limit);
    if (!rel.length) return '';
    const lines = rel.map((r) => `  · ${id} ~${r.via}(${r.hops}跳)~ ${r.label}`);
    return `知识图谱关联（${id}）：\n${lines.join('\n')}`;
  }

  /** Graphviz DOT，方便本地肉眼查图。 */
  toDot(): string {
    const lines = ['digraph knowledge {', '  rankdir=LR;', '  node [shape=box, style=rounded];'];
    for (const n of this.nodes) lines.push(`  "${n.id}" [label="${(n.label ?? n.id).replace(/"/g, "'")}"];`);
    for (const e of this.edges) lines.push(`  "${e.from}" -> "${e.to}" [label="${e.relation}"];`);
    lines.push('}');
    return lines.join('\n');
  }

  describe(e: Edge): string {
    return describeEdge(e, this.nodeIndex);
  }

  /** 导出/导入（持久化与迁移到 Neo4j 等图库时的中间格式）。 */
  dump(): { nodes: Node[]; edges: Edge[] } {
    return { nodes: this.nodes, edges: this.edges };
  }

  load(data: { nodes: Node[]; edges: Edge[] }): void {
    this.clear();
    for (const n of data.nodes) this.addNode(n);
    for (const e of data.edges) this.addRelation(e);
  }
}

function push(map: Map<string, Edge[]>, key: string, e: Edge): void {
  const arr = map.get(key);
  if (arr) arr.push(e);
  else map.set(key, [e]);
}

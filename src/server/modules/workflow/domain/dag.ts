/** Workflow DAG utilities — topological sort + downstream BFS. */

export interface Node {
  id: string;
  type: string;
  data?: Record<string, unknown>;
  agent?: string;
  prompt?: string;
}

export interface Edge {
  source: string;
  target: string;
}

export interface Workflow {
  id: string;
  name: string;
  nodes: Node[];
  edges: Edge[];
  triggerType: string;
  config: Record<string, unknown>;
  status: string;
}

/** Build predecessor map: node_id -> list of predecessor node_ids. */
export function buildPredecessors(nodes: Node[], edges: Edge[]): Map<string, string[]> {
  const preds = new Map<string, string[]>();
  for (const n of nodes) {
    preds.set(n.id, []);
  }
  for (const e of edges) {
    const list = preds.get(e.target) || [];
    list.push(e.source);
    preds.set(e.target, list);
  }
  return preds;
}

/** Kahn's algorithm for topological sort. */
export function topologicalSort(nodes: Node[], edges: Edge[]): string[] {
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();

  for (const n of nodes) {
    inDegree.set(n.id, 0);
    adj.set(n.id, []);
  }
  for (const e of edges) {
    const deg = inDegree.get(e.target) || 0;
    inDegree.set(e.target, deg + 1);
    const out = adj.get(e.source) || [];
    out.push(e.target);
    adj.set(e.source, out);
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  const result: string[] = [];
  let idx = 0;
  while (idx < queue.length) {
    const current = queue[idx++]!;
    result.push(current);
    for (const next of adj.get(current) || []) {
      const newDeg = (inDegree.get(next) || 0) - 1;
      inDegree.set(next, newDeg);
      if (newDeg === 0) queue.push(next);
    }
  }

  if (result.length !== nodes.length) {
    throw new Error("DAG contains a cycle");
  }
  return result;
}

/** Find all downstream nodes from a given start node (BFS). */
export function findDownstream(
  edges: Edge[],
  startNodeId: string
): Set<string> {
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    const out = adj.get(e.source) || [];
    out.push(e.target);
    adj.set(e.source, out);
  }

  const visited = new Set<string>();
  const queue = [startNodeId];
  let idx = 0;
  while (idx < queue.length) {
    const current = queue[idx++]!;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const next of adj.get(current) || []) {
      if (!visited.has(next)) queue.push(next);
    }
  }
  visited.delete(startNodeId);
  return visited;
}

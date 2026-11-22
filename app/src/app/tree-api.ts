import type { Status } from './board-api';

/** Progress as open-backlog's progressOf gives it: story-level items under a node, by status. */
export interface Progress {
  done: number;
  doing: number;
  todo: number;
  total: number;
  percent: number;
  status?: Status;
  estimate: { done: number; total: number };
}

/** One node of GET /api/v1/tree: ob tree --json. Story-level items have no progress. */
export interface TreeNode {
  id: string;
  type: string;
  title: string;
  status: Status | null;
  path: string;
  progress: Progress | null;
  children: TreeNode[];
}

/** The epic that holds unplanned work, one feature per month (spec: epic 0). */
export const UNPLANNED = '0';

export async function loadTree(): Promise<TreeNode[]> {
  const res = await fetch('api/v1/tree');
  const body = (await res.json().catch(() => ({}))) as TreeNode[] | { error?: string };
  if (!res.ok || !Array.isArray(body)) throw new Error((body as { error?: string }).error ?? `the board's server answered ${res.status}`);
  return body;
}

/** The planned work (every top item but epic 0) and epic 0, shown beside it. */
export function split(roots: TreeNode[]): { planned: TreeNode[]; unplanned: TreeNode | null } {
  return { planned: roots.filter(r => r.id !== UNPLANNED), unplanned: roots.find(r => r.id === UNPLANNED) ?? null };
}

/** Capabilities, epics and features: the tree without its stories, bugs, spikes and tasks. */
export const planChildren = (n: TreeNode): TreeNode[] => n.children.filter(c => c.progress !== null);

/** The sum of several nodes' progress, rounded the way open-backlog rounds one node's. */
export function total(nodes: TreeNode[]): Progress {
  const sum = { done: 0, doing: 0, todo: 0, total: 0 };
  for (const n of nodes) {
    const p = n.progress ?? { done: n.status === 'done' ? 1 : 0, doing: n.status === 'doing' ? 1 : 0, todo: n.status === 'todo' ? 1 : 0, total: 1 };
    sum.done += p.done; sum.doing += p.doing; sum.todo += p.todo; sum.total += p.total;
  }
  return { ...sum, percent: sum.total ? Math.round((sum.done / sum.total) * 100) : 0, estimate: { done: 0, total: 0 } };
}

/** The bar's segments, as percentages of the whole width; none when there is nothing to count. */
export function widths(p: Progress): { done: number; doing: number } {
  return p.total ? { done: (p.done / p.total) * 100, doing: (p.doing / p.total) * 100 } : { done: 0, doing: 0 };
}

/** "1 of 2 done (50%)"; an empty feature is "0 of 0 done". */
export function label(p: Progress): string {
  return p.total ? `${p.done} of ${p.total} done (${p.percent}%)` : '0 of 0 done';
}

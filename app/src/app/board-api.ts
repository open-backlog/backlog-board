/**
 * The board's calls to its server (server/api.ts): the columns, a move and a reorder. The server
 * does the work with open-backlog; a refusal comes back with its message.
 */
export type Status = 'todo' | 'doing' | 'done';
export const STATUSES: Status[] = ['todo', 'doing', 'done'];

export interface Card {
  id: string;
  type: string;
  title: string;
  status: Status;
  repo: string[];
  assignee: string | null;
  rank: number | null;
  parent: string | null;
}
export interface Choice { id: string; title: string; parent: string | null }
export interface BoardData {
  columns: Record<Status, Card[]>;
  hiddenDone: number;
  options: { epics: Choice[]; features: Choice[]; repos: string[]; types: string[] };
}
export interface Filters { epic: string; feature: string; repo: string; type: string; all: boolean }
export const NO_FILTERS: Filters = { epic: '', feature: '', repo: '', type: '', all: false };

/** The query for /api/v1/board: a feature narrows more than its epic, so it wins. */
export function boardQuery(f: Filters): string {
  const q = new URLSearchParams();
  const parent = f.feature || f.epic;
  if (parent) q.set('parent', parent);
  if (f.repo) q.set('repo', f.repo);
  if (f.type) q.set('type', f.type);
  if (f.all) q.set('all', '1');
  const s = q.toString();
  return s ? `api/v1/board?${s}` : 'api/v1/board';
}

async function answer<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(body.error ?? `the board's server answered ${res.status}`);
  return body as T;
}

const post = (path: string, body: unknown) =>
  fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export const loadBoard = async (f: Filters) => answer<BoardData>(await fetch(boardQuery(f)));
export const moveCard = async (id: string, status: Status) => answer<unknown>(await post(`api/v1/items/${encodeURIComponent(id)}/move`, { status }));
export const rankCard = async (id: string, after: string | null) => answer<unknown>(await post(`api/v1/items/${encodeURIComponent(id)}/rank`, { after }));

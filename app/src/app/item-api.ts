import type { Status } from './board-api';

/** One item, as the server's GET /api/v1/items/:id gives it: ob show --json plus the description. */
export interface ItemView {
  id: string;
  type: string;
  title: string;
  path: string;
  breadcrumb: string[];
  status: Status | null;
  fields: Record<string, unknown>;
  text: string;
  progress: { done: number; total: number; percent: number; doing: number; todo: number } | null;
  children: { id: string; type: string; title: string; status: Status | null; path: string }[];
  history: { hash: string; date: string; author: string; subject: string }[];
  deleted: unknown;
  sameId: string[];
  comments: { date: string; handle: string; text: string }[];
  /** The body up to ## Comments: what the description editor edits. */
  description: string;
}

/** Fields shown but never edited here: they name the file and its place. */
export const LOCKED = ['id', 'type'];

async function answer<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(body.error ?? `the board's server answered ${res.status}`);
  return body as T;
}
const send = (method: string, path: string, body: unknown) =>
  fetch(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const item = (id: string) => `api/v1/items/${encodeURIComponent(id)}`;

export const loadItem = async (id: string) => answer<ItemView>(await fetch(item(id)));
export const saveItem = async (id: string, change: { fields?: Record<string, unknown>; description?: string }) => answer<{ changed: boolean }>(await send('PATCH', item(id), change));
export const addComment = async (id: string, text: string) => answer<unknown>(await send('POST', `${item(id)}/comments`, { text }));
export const createItem = async (n: { type: string; title: string; parent?: string }) => answer<{ id: string }>(await send('POST', 'api/v1/items', n));

/** A field's value as text in the form: lists joined by commas. */
export function fieldText(v: unknown): string {
  return Array.isArray(v) ? v.join(', ') : v === null || v === undefined ? '' : String(v);
}

/**
 * Text from the form back to a value, keeping the field's kind: a number stays a number, true or
 * false stays a boolean, a list (or repo with commas) a list. Empty removes the field (null).
 */
export function fieldValue(text: string, was: unknown, key: string): unknown {
  const t = text.trim();
  if (t === '') return null;
  if (typeof was === 'number' || ((was === undefined) && (key === 'estimate' || key === 'rank'))) {
    const n = Number(t);
    if (Number.isFinite(n)) return n;
  }
  if (typeof was === 'boolean' && (t === 'true' || t === 'false')) return t === 'true';
  if (Array.isArray(was) || (key === 'repo' && t.includes(','))) return t.split(',').map(s => s.trim()).filter(Boolean);
  return t;
}

/** The ID a breadcrumb file stem names: "1.2-payments" → "1.2". */
export const crumbId = (stem: string) => stem.split('-')[0] ?? stem;

/** "ob: move 2.3.4 to doing" → "doing": a move between columns, in an item's history. */
export function movedTo(subject: string): Status | null {
  const m = /^ob: move \S+ to (todo|doing|done)$/.exec(subject);
  return (m?.[1] as Status | undefined) ?? null;
}

import type { BoardData } from './board-api';
import type { Health } from './health';

/** Test helpers: a stand-in EventSource and a fake server for fetch. Not part of the app's bundle. */
export class FakeEvents {
  static last: FakeEvents | null = null;
  readonly listeners = new Map<string, () => void>();
  closed = false;
  constructor(readonly url: string) { FakeEvents.last = this; }
  addEventListener(type: string, fn: () => void) { this.listeners.set(type, fn); }
  close() { this.closed = true; }
  fire() { this.listeners.get('change')?.(); }
}

export const HEALTH: Health = { board: '0.0.0', core: '0.2.0', spec: '0.1', backlog: { name: 'shop', items: 5 } };

export function boardData(): BoardData {
  const card = (id: string, status: 'todo' | 'doing' | 'done', extra: Partial<BoardData['columns']['todo'][number]> = {}) =>
    ({ id, type: 'story', title: `Story ${id}`, status, repo: [], assignee: null, rank: null, parent: '1.1', ...extra });
  return {
    columns: {
      todo: [card('1.1.1', 'todo', { rank: 10 }), card('1.1.2', 'todo', { repo: ['shop-web', 'shop-ios'], assignee: 'ana' }), card('0.1.1', 'todo', { type: 'bug', parent: '0.1' })],
      doing: [card('1.1.3', 'doing')],
      done: [card('1.1.4', 'done')],
    },
    hiddenDone: 2,
    options: {
      epics: [{ id: '0', title: 'Unplanned', parent: null }, { id: '1', title: 'Checkout', parent: null }],
      features: [{ id: '0.1', title: '2026-11', parent: '0' }, { id: '1.1', title: 'Cart', parent: '1' }],
      repos: ['shop-api', 'shop-web', 'shop-ios'],
      types: ['story', 'bug', 'spike', 'task'],
    },
  };
}

export interface Call { method: string; url: string; body: unknown }

/** A fake server: records each call and answers health, board, and changes (or a refusal). */
export function fakeServer(opts: { refuse?: string; health?: () => Response } = {}) {
  const calls: Call[] = [];
  const fetchFn = async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    calls.push({ method, url, body: init.body ? JSON.parse(String(init.body)) : undefined });
    if (url === 'api/health') return opts.health?.() ?? new Response(JSON.stringify(HEALTH));
    if (url.startsWith('api/board')) return new Response(JSON.stringify(boardData()));
    if (opts.refuse) return new Response(JSON.stringify({ error: opts.refuse }), { status: 409 });
    return new Response(JSON.stringify({ committed: true }));
  };
  return { calls, fetchFn };
}

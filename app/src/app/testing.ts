import type { BoardData } from './board-api';
import type { Health } from './health';
import type { ItemView } from './item-api';
import type { SyncStatus } from './sync-api';
import type { Progress, TreeNode } from './tree-api';

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
      features: [{ id: '0.1', title: '2026-11', parent: '0' }, { id: '1.1', title: 'Cart', parent: '1' }, { id: '1.2', title: 'Pay by card', parent: '1' }],
      repos: ['shop-api', 'shop-web', 'shop-ios'],
      types: ['story', 'bug', 'spike', 'task'],
    },
  };
}

export function itemView(): ItemView {
  return {
    id: '1.1.2', type: 'story', title: 'Card page', path: 'stories/doing/1.1.2-card-page.md',
    breadcrumb: ['1-checkout', '1.1-cart', '1.1.2-card-page'], status: 'doing',
    fields: { id: '1.1.2', type: 'story', title: 'Card page', parent: '1.1', estimate: 3, repo: ['shop-web', 'shop-ios'], customer: 'acme' },
    text: '', progress: null, children: [], deleted: null, sameId: [],
    history: [
      { hash: 'c3', date: '2026-11-21', author: 'Ana', subject: 'ob: edit 1.1.2 estimate' },
      { hash: 'b2', date: '2026-11-20', author: 'Ana', subject: 'ob: move 1.1.2 to doing' },
      { hash: 'a1', date: '2026-11-18', author: 'Raj', subject: 'ob: add 1.1.2 Card page' },
    ],
    comments: [{ date: '2026-11-20', handle: 'ana', text: 'Started' }],
    description: '\n**As a** shopper, **I want to:**\n- pay by card\n\n',
  };
}

/** The T3 example's tree (ob tree --json), with an empty feature 1.3 and a bug filed under epic 0 itself. */
export function treeData(): TreeNode[] {
  const p = (done: number, doing: number, todo: number): Progress => {
    const total = done + doing + todo;
    return { done, doing, todo, total, percent: total ? Math.round((done / total) * 100) : 0, estimate: { done: 0, total: 0 },
      status: total && done === total ? 'done' : done + doing ? 'doing' : 'todo' };
  };
  const story = (id: string, status: 'todo' | 'doing' | 'done', type = 'story'): TreeNode =>
    ({ id, type, title: `Story ${id}`, status, path: `stories/${status}/${id}.md`, progress: null, children: [] });
  const node = (id: string, type: string, title: string, progress: Progress, children: TreeNode[]): TreeNode =>
    ({ id, type, title, status: progress.status ?? null, path: `${type}s/${id}.md`, progress, children });
  return [
    node('C1', 'capability', 'Payments', p(1, 1, 2), [
      node('1', 'epic', 'Checkout', p(1, 1, 2), [
        node('1.1', 'feature', 'Cart', p(1, 1, 0), [story('1.1.1', 'done'), story('1.1.2', 'doing')]),
        node('1.2', 'feature', 'Pay by card', p(0, 0, 2), [story('1.2.1', 'todo'), story('1.2.2', 'todo', 'spike')]),
        node('1.3', 'feature', 'Gift cards', p(0, 0, 0), []),
      ]),
    ]),
    node('0', 'epic', 'Unplanned work', p(1, 0, 2), [
      node('0.1', 'feature', 'Unplanned, 2026-10', p(1, 0, 0), [story('0.1.1', 'done', 'bug')]),
      node('0.2', 'feature', 'Unplanned, 2026-11', p(0, 0, 1), [story('0.2.1', 'todo', 'bug')]),
      story('0.0.1', 'todo', 'bug'),
    ]),
  ];
}

export function syncStatus(over: Partial<SyncStatus> = {}): SyncStatus {
  return {
    git: true, branch: 'main', upstream: 'origin/main', behind: 0, uncommitted: [], conflict: null,
    unshared: [{ hash: 'c3c3c3c', subject: 'ob: comment on 1.1.2' }, { hash: 'b2b2b2b', subject: 'ob: move 1.2.1 to doing' }],
    ...over,
  };
}

export interface Call { method: string; url: string; body: unknown }

/** A fake server: records each call and answers health, board, and changes (or a refusal). */
export function fakeServer(opts: { refuse?: string; health?: () => Response; sync?: () => SyncStatus; syncPost?: () => Response } = {}) {
  const calls: Call[] = [];
  const fetchFn = async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    calls.push({ method, url, body: init.body ? JSON.parse(String(init.body)) : undefined });
    if (url === 'api/v1/health') return opts.health?.() ?? new Response(JSON.stringify(HEALTH));
    if (url === 'api/v1/sync' && method === 'GET') return new Response(JSON.stringify(opts.sync?.() ?? syncStatus()));
    if (url === 'api/v1/sync' && method === 'POST') return opts.syncPost?.() ?? new Response(JSON.stringify({ received: 1, sent: 2, status: syncStatus({ unshared: [] }) }));
    if (url === 'api/v1/tree') return new Response(JSON.stringify(treeData()));
    if (url.startsWith('api/v1/board')) return new Response(JSON.stringify(boardData()));
    if (/^api\/v1\/items\/[^/]+$/.test(url) && method === 'GET') return new Response(JSON.stringify(itemView()));
    if (url === 'api/v1/items' && method === 'POST' && !opts.refuse) return new Response(JSON.stringify({ id: '1.1.9' }), { status: 201 });
    if (opts.refuse) return new Response(JSON.stringify({ error: opts.refuse }), { status: 409 });
    return new Response(JSON.stringify({ committed: true }));
  };
  return { calls, fetchFn };
}

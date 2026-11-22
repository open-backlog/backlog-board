import { TestBed } from '@angular/core/testing';

import { BacklogEvents } from './events';
import { Sync } from './sync';
import { done, toShare } from './sync-api';
import type { Conflict, SyncStatus } from './sync-api';
import { FakeEvents, fakeServer, syncStatus } from './testing';

const CONFLICT: Conflict = {
  kind: 'rebase', files: ['backlog/stories/todo/1.2.1-card-form.md'],
  steps: ['Open the file and keep what\'s right', 'git add backlog/stories/todo/1.2.1-card-form.md', 'git rebase --continue', 'Or, to put everything back as it was before Sync: git rebase --abort'],
};

async function render(opts: Parameters<typeof fakeServer>[0] = {}) {
  const server = fakeServer(opts);
  vi.stubGlobal('EventSource', FakeEvents);
  vi.stubGlobal('fetch', vi.fn(server.fetchFn));
  const fixture = TestBed.createComponent(Sync);
  const settle = async () => {
    for (let i = 0; i < 3; i++) {
      await fixture.whenStable();
      await new Promise(r => setTimeout(r));
      fixture.detectChanges();
    }
  };
  await settle();
  const el = fixture.nativeElement as HTMLElement;
  const text = (sel: string) => el.querySelector(sel)?.textContent?.replace(/\s+/g, ' ').trim();
  const click = async (sel: string) => { (el.querySelector(sel) as HTMLButtonElement).click(); await settle(); };
  return { server, el, text, click, settle };
}

describe('Sync', () => {
  afterEach(() => { TestBed.inject(BacklogEvents).stop(); vi.unstubAllGlobals(); });

  it('shows how many commits aren’t shared, and lists them; nothing is sent until Sync is clicked', async () => {
    const { server, text, click, el } = await render();
    expect(text('.count')).toBe('2 to share');
    expect(text('.go')).toBe('Sync');
    expect(el.querySelector('.list')).toBeNull();
    await click('.count');
    expect(text('.list')).toContain('Sync will send these 2 commits to origin/main');
    expect([...el.querySelectorAll('.list li')].map(l => l.textContent?.trim())).toEqual(['c3c3c3c ob: comment on 1.1.2', 'b2b2b2b ob: move 1.2.1 to doing']);
    expect(server.calls.filter(c => c.method === 'POST')).toEqual([]);
  });

  it('syncs on a click: one POST, then what came and went, and the count is read again', async () => {
    const { server, text, click } = await render();
    await click('.go');
    expect(server.calls.filter(c => c.method === 'POST').map(c => c.url)).toEqual(['api/v1/sync']);
    expect(text('[role="status"]')).toBe('Got 1 change, sent 2 changes.');
    expect(text('.count')).toBe('All shared');
  });

  it('shows a conflict with its files and the commands to finish or undo it, until git says it’s gone', async () => {
    let open: Conflict | null = null;
    const { text, click, el, server } = await render({
      sync: () => syncStatus({ conflict: open }),
      syncPost: () => { open = CONFLICT; return new Response(JSON.stringify({ error: 'Your changes and a teammate\'s change the same lines. Nothing was sent.', conflict: CONFLICT }), { status: 409 }); },
    });
    await click('.go');
    expect(text('#h-conflict')).toBe('Sync stopped: a rebase conflict');
    expect(text('.files')).toBe('backlog/stories/todo/1.2.1-card-form.md');
    expect([...el.querySelectorAll('.steps li')].map(l => l.textContent?.trim())).toEqual(CONFLICT.steps);
    expect(text('.conflict-box')).toContain('Nothing was sent');
    expect(text('.go')).toBe('Conflict');
    expect(text('.count')).toBe('Sync paused');
    await click('.conflict-box button');
    expect(el.querySelector('.conflict-box')).not.toBeNull(); // still there: git still has it
    open = null;
    const before = server.calls.length;
    await click('.conflict-box button');
    expect(server.calls.length).toBe(before + 1);
    expect(el.querySelector('.conflict-box')).toBeNull();
    expect(text('.go')).toBe('Sync');
  });

  it('shows a conflict already open when the board starts, and git’s message for other failures', async () => {
    const first = await render({ sync: () => syncStatus({ conflict: CONFLICT }) });
    expect(first.text('#h-conflict')).toContain('rebase conflict');
    TestBed.inject(BacklogEvents).stop();
    vi.unstubAllGlobals();
    const login = 'git pull: Authentication failed. git couldn\'t log in to origin: check that git pull works in a terminal here. The board uses your own git login and never asks for a password or token.';
    const { text, click, el } = await render({ syncPost: () => new Response(JSON.stringify({ error: login, conflict: null }), { status: 502 }) });
    await click('.go');
    expect(text('.error p')).toBe(login);
    expect(el.querySelector('.conflict-box')).toBeNull();
    await click('.error .link');
    expect(el.querySelector('.error')).toBeNull();
  });

  it('says how to share a branch with no remote yet, and hides itself outside git', async () => {
    const { text, click } = await render({ sync: () => syncStatus({ upstream: null, unshared: [], branch: 'cards' }) });
    await click('.count');
    expect(text('.list')).toContain('git push -u origin cards');
    TestBed.inject(BacklogEvents).stop();
    vi.unstubAllGlobals();
    const none = await render({ sync: () => ({ ...syncStatus(), git: false } as SyncStatus) });
    expect(none.el.querySelector('.sync')).toBeNull();
  });

  it('helpers: done, toShare', () => {
    expect(done({ received: 0, sent: 0, status: syncStatus() })).toBe('Already up to date.');
    expect(done({ received: 0, sent: 1, status: syncStatus() })).toBe('Sent 1 change.');
    expect(done({ received: 3, sent: 0, status: syncStatus() })).toBe('Got 3 changes.');
    expect(toShare(syncStatus({ unshared: [] }))).toBe('All shared');
  });
});

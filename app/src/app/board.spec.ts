import type { CdkDragDrop } from '@angular/cdk/drag-drop';
import { TestBed } from '@angular/core/testing';

import { Board } from './board';
import { boardQuery, NO_FILTERS } from './board-api';
import type { Card, Status } from './board-api';
import { BacklogEvents } from './events';
import { FakeEvents, fakeServer } from './testing';

async function render(opts: Parameters<typeof fakeServer>[0] = {}) {
  const server = fakeServer(opts);
  vi.stubGlobal('EventSource', FakeEvents);
  vi.stubGlobal('fetch', vi.fn(server.fetchFn));
  const fixture = TestBed.createComponent(Board);
  const settle = async () => {
    for (let i = 0; i < 3; i++) {
      await fixture.whenStable();
      await new Promise(r => setTimeout(r));
      fixture.detectChanges();
    }
  };
  await settle();
  const el = fixture.nativeElement as HTMLElement;
  const ids = (s: Status) => [...el.querySelectorAll(`#list-${s} .card`)].map(c => c.getAttribute('data-id'));
  return { server, fixture, el, settle, ids, board: fixture.componentInstance };
}

/** A drop as the CDK reports it. */
function drop(from: Status, to: Status, previousIndex: number, currentIndex: number, card: Card): CdkDragDrop<Status, Status, Card> {
  return { previousContainer: { data: from }, container: { data: to }, previousIndex, currentIndex, item: { data: card } } as unknown as CdkDragDrop<Status, Status, Card>;
}

describe('the board', () => {
  afterEach(() => { TestBed.inject(BacklogEvents).stop(); vi.unstubAllGlobals(); });

  it('shows the three columns in the server order, with each card’s ID, title, type, repo and assignee', async () => {
    const { el, ids } = await render();
    expect([...el.querySelectorAll('.column h2')].map(h => h.textContent?.replace(/\s+/g, ' ').trim())).toEqual(['todo 3', 'doing 1', 'done 1']);
    expect(ids('todo')).toEqual(['1.1.1', '1.1.2', '0.1.1']);
    const card = el.querySelector('[data-id="1.1.2"]')!;
    expect(card.querySelector('.title')?.textContent).toBe('Story 1.1.2');
    expect(card.querySelector('.type')?.textContent).toBe('story');
    expect([...card.querySelectorAll('.repo')].map(r => r.textContent)).toEqual(['shop-web', 'shop-ios']);
    expect(card.querySelector('.who')?.textContent).toBe('@ana');
    expect(el.querySelector('[data-id="0.1.1"] .type.bug')).not.toBeNull();
    expect(el.querySelector('.hidden-done')?.textContent).toContain('2 done more than 30 days ago');
  });

  it('filters: epic, then its features, repo, type and all done; each asks the server again', async () => {
    const { server, board, el, settle } = await render();
    board.set({ epic: '1' });
    await settle();
    expect([...el.querySelectorAll('select')[1]!.querySelectorAll('option')].map(o => o.value)).toEqual(['', '1.1']);
    board.set({ feature: '1.1', repo: 'shop-web', type: 'story' });
    await settle();
    expect(server.calls.at(-1)?.url).toBe('api/board?parent=1.1&repo=shop-web&type=story');
    (el.querySelector('.hidden-done button') as HTMLButtonElement).click();
    await settle();
    expect(server.calls.at(-1)?.url).toBe('api/board?parent=1.1&repo=shop-web&type=story&all=1');
    expect(boardQuery(NO_FILTERS)).toBe('api/board');
    expect(boardQuery({ ...NO_FILTERS, epic: '1' })).toBe('api/board?parent=1');
  });

  it('a drop in another column moves the card there (ob move), then reads the board again', async () => {
    const { server, board } = await render();
    const card = board.columns().todo[1]!;
    const done = board.dropped(drop('todo', 'doing', 1, 0, card));
    // At once, before the server answers: the card is where it was dropped.
    expect(board.columns().doing.map(c => c.id)).toEqual(['1.1.2', '1.1.3']);
    expect(board.columns().todo.map(c => c.id)).toEqual(['1.1.1', '0.1.1']);
    await done;
    const changes = server.calls.filter(c => c.method === 'POST');
    expect(changes).toEqual([{ method: 'POST', url: 'api/items/1.1.2/move', body: { status: 'doing' } }]);
    expect(server.calls.at(-1)?.url).toBe('api/board');
  });

  it('a drop within a column reorders it: the card goes after the one now above it, or to the top', async () => {
    const { server, board } = await render();
    const todo = board.columns().todo;
    await board.dropped(drop('todo', 'todo', 2, 0, todo[2]!));
    await board.dropped(drop('todo', 'todo', 0, 2, todo[0]!));
    await board.dropped(drop('todo', 'todo', 1, 1, todo[1]!));
    expect(server.calls.filter(c => c.method === 'POST')).toEqual([
      { method: 'POST', url: 'api/items/0.1.1/rank', body: { after: null } },
      { method: 'POST', url: 'api/items/1.1.1/rank', body: { after: '0.1.1' } },
    ]);
  });

  it('the ← → buttons move a card without a mouse', async () => {
    const { server, el } = await render();
    const buttons = [...el.querySelectorAll<HTMLButtonElement>('[data-id="1.1.3"] .nav button')];
    expect(buttons.map(b => b.getAttribute('aria-label'))).toEqual(['Move 1.1.3 to todo', 'Move 1.1.3 to done']);
    buttons[1]!.click();
    await new Promise(r => setTimeout(r));
    expect(server.calls.find(c => c.method === 'POST')).toEqual({ method: 'POST', url: 'api/items/1.1.3/move', body: { status: 'done' } });
    expect(el.querySelectorAll('[data-id="1.1.1"] .nav button').length).toBe(1);
  });

  it('shows a refusal with the server’s message and puts the cards back as the server has them', async () => {
    const { board, el, settle } = await render({ refuse: "stories/todo/1.1.2-x.md has changes that aren't committed; commit or undo them first" });
    await board.dropped(drop('todo', 'done', 1, 0, board.columns().todo[1]!));
    await settle();
    expect(el.querySelector('[role="alert"]')?.textContent).toContain("has changes that aren't committed");
    expect(board.columns().todo.map(c => c.id)).toEqual(['1.1.1', '1.1.2', '0.1.1']);
  });

  it("a card's title opens it in the item panel; + New opens the form instead", async () => {
    const { el, fixture, settle } = await render();
    (el.querySelector('[data-id="1.1.2"] .open') as HTMLButtonElement).click();
    await settle();
    expect(el.querySelector('ob-item-panel')).not.toBeNull();
    (el.querySelector('.new') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el.querySelector('ob-item-panel')).toBeNull();
    expect(el.querySelector('ob-new-item')).not.toBeNull();
  });

  it('reads the board again when the backlog changes', async () => {
    const { server, settle } = await render();
    const before = server.calls.length;
    FakeEvents.last?.fire();
    await settle();
    expect(server.calls.slice(before).map(c => c.url)).toEqual(['api/board']);
  });
});

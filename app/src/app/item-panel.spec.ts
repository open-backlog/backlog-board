import { TestBed } from '@angular/core/testing';

import { BacklogEvents } from './events';
import { fieldText, fieldValue, movedTo } from './item-api';
import { ItemPanel } from './item-panel';
import { FakeEvents, fakeServer } from './testing';

async function render(opts: Parameters<typeof fakeServer>[0] = {}) {
  const server = fakeServer(opts);
  vi.stubGlobal('EventSource', FakeEvents);
  vi.stubGlobal('fetch', vi.fn(server.fetchFn));
  const fixture = TestBed.createComponent(ItemPanel);
  fixture.componentRef.setInput('id', '1.1.2');
  const settle = async () => {
    for (let i = 0; i < 3; i++) {
      await fixture.whenStable();
      await new Promise(r => setTimeout(r));
      fixture.detectChanges();
    }
  };
  await settle();
  return { server, fixture, settle, el: fixture.nativeElement as HTMLElement, panel: fixture.componentInstance };
}
const posts = (server: ReturnType<typeof fakeServer>) => server.calls.filter(c => c.method !== 'GET');

describe('the item panel', () => {
  afterEach(() => { TestBed.inject(BacklogEvents).stop(); vi.unstubAllGlobals(); });

  it('shows where it sits, its fields, the description rendered, comments and history with each move', async () => {
    const { el } = await render();
    expect([...el.querySelectorAll('.crumbs button')].map(b => b.textContent)).toEqual(['1-checkout', '1.1-cart']);
    expect(el.querySelector('h2')?.textContent).toBe('Card page');
    expect(el.querySelector('.kind')?.textContent?.replace(/\s+/g, ' ').trim()).toBe('1.1.2 story · doing');
    const fields = Object.fromEntries([...el.querySelectorAll('dl.fields dt')].map(dt => [dt.textContent, dt.nextElementSibling?.textContent]));
    expect(fields).toMatchObject({ estimate: '3', repo: 'shop-web, shop-ios', customer: 'acme' });
    expect(el.querySelector('.md strong')?.textContent).toBe('As a');
    expect(el.querySelector('.md li')?.textContent).toBe('pay by card');
    expect(el.querySelector('.comment')?.textContent).toContain('2026-11-20 @ana');
    const history = [...el.querySelectorAll('.history li')];
    expect(history.map(h => h.querySelector('.when')?.textContent)).toEqual(['2026-11-21', '2026-11-20', '2026-11-18']);
    expect(history.filter(h => h.classList.contains('move')).map(h => h.querySelector('.to')?.textContent)).toEqual(['→ doing']);
  });

  it('edits only the fields that changed, keeping their kind; empty removes; a new field is added', async () => {
    const { server, panel, settle } = await render();
    panel.startFields();
    const rows = panel.rows();
    rows.find(r => r.key === 'estimate')!.text = '5';
    rows.find(r => r.key === 'repo')!.text = 'shop-web';
    rows.find(r => r.key === 'customer')!.text = '';
    panel.addRow();
    panel.rows().at(-1)!.key = 'release';
    panel.rows().at(-1)!.text = '0.3.0';
    await panel.saveFields();
    await settle();
    expect(posts(server)).toEqual([{ method: 'PATCH', url: 'api/items/1.1.2', body: { fields: { estimate: 5, repo: ['shop-web'], customer: null, release: '0.3.0' } } }]);
    expect(panel.editFields()).toBe(false);
  });

  it('edits the description as Markdown, without the comments, and saves it', async () => {
    const { server, panel } = await render();
    panel.startDesc();
    expect(panel.draft()).toBe('**As a** shopper, **I want to:**\n- pay by card');
    panel.draft.set('New text');
    await panel.saveDesc();
    expect(posts(server)).toEqual([{ method: 'PATCH', url: 'api/items/1.1.2', body: { description: 'New text' } }]);
  });

  it('adds a comment, the line ob comment writes, on the server', async () => {
    const { server, panel } = await render();
    panel.newComment.set('Looks good');
    await panel.comment();
    expect(posts(server)).toEqual([{ method: 'POST', url: 'api/items/1.1.2/comments', body: { text: 'Looks good' } }]);
    expect(panel.newComment()).toBe('');
  });

  it('keeps the editor open and shows the reason when the server refuses', async () => {
    const reason = 'OB002 [parent-exists] parent 9.9 is not in this backlog. Fix: set parent to an existing feature.';
    const { panel, el, settle } = await render({ refuse: reason });
    panel.startFields();
    panel.rows().find(r => r.key === 'parent')!.text = '9.9';
    await panel.saveFields();
    await settle();
    expect(panel.editFields()).toBe(true);
    expect(el.querySelector('[role="alert"]')?.textContent).toBe(reason);
    // The server puts the file back, the folder watcher fires, the panel reloads: the reason stays.
    FakeEvents.last?.fire();
    await settle();
    expect(el.querySelector('[role="alert"]')?.textContent).toBe(reason);
    panel.startFields();
    await settle();
    expect(el.querySelector('[role="alert"]')).toBeNull();
  });

  it('field text and values; moves in history', () => {
    expect(fieldText(['a', 'b'])).toBe('a, b');
    expect(fieldValue('7', 3, 'estimate')).toBe(7);
    expect(fieldValue('7', undefined, 'estimate')).toBe(7);
    expect(fieldValue('seven', 3, 'estimate')).toBe('seven');
    expect(fieldValue('false', true, 'x')).toBe(false);
    expect(fieldValue('a, b', undefined, 'repo')).toEqual(['a', 'b']);
    expect(fieldValue('a', ['a', 'b'], 'labels')).toEqual(['a']);
    expect(fieldValue('  ', 'x', 'assignee')).toBe(null);
    expect(movedTo('ob: move 2.3.4 to done')).toBe('done');
    expect(movedTo('ob: edit 2.3.4 rank')).toBe(null);
  });
});

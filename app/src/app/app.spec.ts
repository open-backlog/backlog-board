import { TestBed } from '@angular/core/testing';

import { App, viewOf } from './app';
import { BacklogEvents } from './events';
import { FakeEvents, fakeServer } from './testing';

async function settle(fixture: { whenStable(): Promise<unknown>; detectChanges(): void }) {
  for (let i = 0; i < 3; i++) {
    await fixture.whenStable();
    await new Promise(r => setTimeout(r));
    fixture.detectChanges();
  }
}

describe('the board shell', () => {
  afterEach(() => { TestBed.inject(BacklogEvents).stop(); vi.unstubAllGlobals(); });

  it('shows the backlog it serves, its item count and the board', async () => {
    const server = fakeServer();
    vi.stubGlobal('EventSource', FakeEvents);
    vi.stubGlobal('fetch', vi.fn(server.fetchFn));
    const fixture = TestBed.createComponent(App);
    await settle(fixture);
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('h1')?.textContent).toBe('Open Backlog board');
    expect(el.querySelector('.bar .name')?.textContent).toBe('shop · 5 items');
    expect(el.querySelector('.bar .facts')?.getAttribute('title')).toBe('board 0.0.0 · open-backlog 0.2.0 · spec 0.1');
    expect(el.querySelector('.bar img')?.getAttribute('src')).toBe('board-icon.png');
    expect(el.querySelector('ob-board')).not.toBeNull();
    expect(el.querySelector('.bar ob-sync .count')?.textContent?.trim()).toBe('2 to share');
    expect(FakeEvents.last?.url).toBe('api/v1/events');
    const before = server.calls.filter(c => c.url === 'api/v1/health').length;
    FakeEvents.last?.fire();
    await settle(fixture);
    expect(server.calls.filter(c => c.url === 'api/v1/health').length).toBe(before + 1);
  });

  it('switches between the board and the tree (/#tree), and a feature in the tree opens the board filtered to it', async () => {
    const server = fakeServer();
    vi.stubGlobal('EventSource', FakeEvents);
    vi.stubGlobal('fetch', vi.fn(server.fetchFn));
    history.replaceState(null, '', '/');
    const fixture = TestBed.createComponent(App);
    await settle(fixture);
    const el = fixture.nativeElement as HTMLElement;
    const tab = (name: string) => [...el.querySelectorAll<HTMLButtonElement>('.views button')].find(b => b.textContent === name)!;
    expect(tab('Board').getAttribute('aria-current')).toBe('page');
    tab('Tree').click();
    await settle(fixture);
    expect(location.hash).toBe('#tree');
    expect(el.querySelector('ob-board')).toBeNull();
    expect(tab('Tree').getAttribute('aria-current')).toBe('page');
    (el.querySelector('[data-id="1.2"] > .row button.open') as HTMLButtonElement).click();
    await settle(fixture);
    expect(location.hash).toBe('');
    expect(el.querySelector('ob-tree')).toBeNull();
    expect(server.calls.at(-1)?.url).toBe('api/v1/board?parent=1.2');
    const [epic, feature] = [...el.querySelectorAll<HTMLSelectElement>('.filters select')];
    expect([epic?.value, feature?.value]).toEqual(['1', '1.2']);
    tab('Board').click();
    await settle(fixture);
    expect(server.calls.at(-1)?.url).toBe('api/v1/board');
    expect(viewOf('#tree')).toBe('tree');
    expect(viewOf('')).toBe('board');
    history.replaceState(null, '', '/#tree');
    dispatchEvent(new PopStateEvent('popstate'));
    await settle(fixture);
    expect(el.querySelector('ob-tree')).not.toBeNull();
    history.replaceState(null, '', '/');
  });

  it('says plainly when its server is gone', async () => {
    vi.stubGlobal('EventSource', FakeEvents);
    vi.stubGlobal('fetch', vi.fn(fakeServer({ health: () => new Response('', { status: 502 }) }).fetchFn));
    const fixture = TestBed.createComponent(App);
    await settle(fixture);
    const alert = (fixture.nativeElement as HTMLElement).querySelector('[role="alert"]')?.textContent;
    expect(alert).toContain("the board's server answered 502");
    expect(alert).toContain('ob serve');
  });
});

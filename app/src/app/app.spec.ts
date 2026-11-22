import { TestBed } from '@angular/core/testing';

import { App } from './app';
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
    expect(FakeEvents.last?.url).toBe('api/events');
    const before = server.calls.filter(c => c.url === 'api/health').length;
    FakeEvents.last?.fire();
    await settle(fixture);
    expect(server.calls.filter(c => c.url === 'api/health').length).toBe(before + 1);
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

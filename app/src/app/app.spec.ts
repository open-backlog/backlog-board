import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { App } from './app';
import type { Health } from './health';

const HEALTH: Health = { board: '0.0.0', core: '0.2.0', spec: '0.1', backlog: { name: 'shop', items: 13 } };

/** A stand-in for the browser's EventSource: tests fire its events by hand. */
class FakeEvents {
  static last: FakeEvents | null = null;
  readonly listeners = new Map<string, () => void>();
  closed = false;
  constructor(readonly url: string) { FakeEvents.last = this; }
  addEventListener(type: string, fn: () => void) { this.listeners.set(type, fn); }
  close() { this.closed = true; }
}

async function render(answer: () => Promise<Response>) {
  vi.stubGlobal('EventSource', FakeEvents);
  vi.stubGlobal('fetch', vi.fn(answer));
  const fixture = TestBed.createComponent(App);
  await fixture.whenStable();
  await new Promise(r => setTimeout(r));
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('the board shell', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('shows the backlog it serves, from the server, with the versions', async () => {
    const el = await render(async () => new Response(JSON.stringify(HEALTH), { status: 200 }));
    expect(vi.mocked(fetch)).toHaveBeenCalledWith('api/health');
    expect(el.querySelector('h1')?.textContent).toBe('Open Backlog board');
    expect(el.querySelector('.bar .name')?.textContent).toBe('shop');
    expect(el.querySelector('.lead')?.textContent).toContain('13 items');
    expect(el.querySelector('.facts')?.textContent).toBe('board 0.0.0 · open-backlog 0.2.0 · spec 0.1');
    expect(el.querySelector('.bar img')?.getAttribute('src')).toBe('board-icon.png');
  });

  it('reads the backlog again when the server says it changed, and stops listening when closed', async () => {
    let items = 13;
    const el = await render(async () => new Response(JSON.stringify({ ...HEALTH, backlog: { name: 'shop', items } }), { status: 200 }));
    expect(FakeEvents.last?.url).toBe('api/events');
    items = 14;
    FakeEvents.last?.listeners.get('change')?.();
    await new Promise(r => setTimeout(r));
    TestBed.inject(ApplicationRef).tick();
    expect(el.querySelector('.lead')?.textContent).toContain('14 items');
    TestBed.resetTestingModule();
    expect(FakeEvents.last?.closed).toBe(true);
  });

  it('says plainly when its server is gone', async () => {
    const el = await render(async () => new Response('', { status: 502 }));
    expect(el.querySelector('[role="alert"]')?.textContent).toContain("the board's server answered 502");
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('ob serve');
  });
});

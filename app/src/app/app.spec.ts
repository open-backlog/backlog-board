import { TestBed } from '@angular/core/testing';

import { App } from './app';
import type { Health } from './health';

const HEALTH: Health = { board: '0.0.0', core: '0.2.0', spec: '0.1', backlog: { name: 'shop', items: 13 } };

async function render(answer: () => Promise<Response>) {
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

  it('says plainly when its server is gone', async () => {
    const el = await render(async () => new Response('', { status: 502 }));
    expect(el.querySelector('[role="alert"]')?.textContent).toContain("the board's server answered 502");
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('ob serve');
  });
});

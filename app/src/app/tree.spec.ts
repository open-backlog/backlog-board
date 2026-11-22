import { TestBed } from '@angular/core/testing';

import { BacklogEvents } from './events';
import { FakeEvents, fakeServer, treeData } from './testing';
import { Tree } from './tree';
import type { Focus } from './tree';
import { label, split, total, widths } from './tree-api';

async function render(opts: { fail?: boolean } = {}) {
  const server = fakeServer(opts.fail ? { health: () => new Response('', { status: 502 }) } : {});
  vi.stubGlobal('EventSource', FakeEvents);
  vi.stubGlobal('fetch', vi.fn(opts.fail ? async () => new Response(JSON.stringify({ error: 'the backlog could not be read' }), { status: 500 }) : server.fetchFn));
  const fixture = TestBed.createComponent(Tree);
  const settle = async () => {
    for (let i = 0; i < 3; i++) {
      await fixture.whenStable();
      await new Promise(r => setTimeout(r));
      fixture.detectChanges();
    }
  };
  await settle();
  const el = fixture.nativeElement as HTMLElement;
  const row = (id: string) => el.querySelector(`[data-id="${id}"] > .row`)!;
  const text = (e: Element | null) => e?.textContent?.replace(/\s+/g, ' ').trim();
  return { server, fixture, el, settle, row, text };
}

describe('the tree', () => {
  afterEach(() => { TestBed.inject(BacklogEvents).stop(); vi.unstubAllGlobals(); });

  it('shows capabilities, epics and features nested, with no stories, and epic 0 beside the plan', async () => {
    const { el } = await render();
    const ids = (sel: string) => [...el.querySelectorAll(`${sel} [data-id]`)].map(n => n.getAttribute('data-id'));
    expect(ids('.planned')).toEqual(['C1', '1', '1.1', '1.2', '1.3']);
    expect(ids('.unplanned')).toEqual(['0.1', '0.2']);
    expect(el.querySelector('#h-unplanned')?.textContent).toContain('Unplanned work');
    expect(el.querySelector('[data-id="C1"] > ul > [data-id="1"] > ul > [data-id="1.2"]')).not.toBeNull();
  });

  it('gives each a bar with the numbers ob tree prints; an empty feature is 0 of 0, not an error', async () => {
    const { el, row, text } = await render();
    expect(text(row('C1').querySelector('.count'))).toBe('1 of 4 done (25%), 1 doing');
    expect(text(row('1.1').querySelector('.count'))).toBe('1 of 2 done (50%), 1 doing');
    expect(text(row('1.2').querySelector('.count'))).toBe('0 of 2 done (0%)');
    expect(text(row('1.3').querySelector('.count'))).toBe('0 of 0 done');
    const bar = row('1.1').querySelector('[role="progressbar"]')!;
    expect(bar.getAttribute('aria-valuenow')).toBe('50');
    expect((bar.querySelector('.done') as HTMLElement).style.width).toBe('50%');
    expect((bar.querySelector('.doing') as HTMLElement).style.width).toBe('50%');
    const empty = row('1.3').querySelector('[role="progressbar"]')!;
    expect(empty.getAttribute('aria-valuenow')).toBe('0');
    expect((empty.querySelector('.done') as HTMLElement).style.width).toBe('0%');
    expect(el.querySelector('[role="alert"]')).toBeNull();
  });

  it('shows the whole plan’s progress, and epic 0’s, at the top of each side', async () => {
    const { el, text } = await render();
    expect(text(el.querySelector('.planned .whole .count'))).toBe('1 of 4 done (25%), 1 doing');
    expect(text(el.querySelector('.unplanned .whole .count'))).toBe('1 of 3 done (33%)');
  });

  it('opens the board on a feature (with its epic) or an epic', async () => {
    const { fixture, row, el } = await render();
    const got: Focus[] = [];
    fixture.componentInstance.opened.subscribe(f => got.push(f));
    (row('1.2').querySelector('button.open') as HTMLButtonElement).click();
    (row('0.2').querySelector('button.open') as HTMLButtonElement).click();
    (row('1').querySelector('button.open') as HTMLButtonElement).click();
    (el.querySelector('#h-unplanned button') as HTMLButtonElement).click();
    expect(row('C1').querySelector('button')).toBeNull();
    expect(got).toEqual([{ epic: '1', feature: '1.2' }, { epic: '0', feature: '0.2' }, { epic: '1', feature: '' }, { epic: '0', feature: '' }]);
  });

  it('reads the tree again when the backlog changes, and says why it can’t', async () => {
    const { server, settle } = await render();
    const before = server.calls.filter(c => c.url === 'api/v1/tree').length;
    FakeEvents.last?.fire();
    await settle();
    expect(server.calls.filter(c => c.url === 'api/v1/tree').length).toBe(before + 1);
    vi.unstubAllGlobals();
    TestBed.inject(BacklogEvents).stop();
    const failed = await render({ fail: true });
    expect(failed.el.querySelector('[role="alert"]')?.textContent).toContain('the backlog could not be read');
  });

  it('helpers: split, total, widths, label', () => {
    const { planned, unplanned } = split(treeData());
    expect(planned.map(n => n.id)).toEqual(['C1']);
    expect(unplanned?.id).toBe('0');
    expect(split(planned).unplanned).toBeNull();
    expect(total([...planned, unplanned!])).toMatchObject({ done: 2, doing: 1, todo: 4, total: 7, percent: 29 });
    expect(total([])).toMatchObject({ total: 0, percent: 0 });
    expect(widths(total([]))).toEqual({ done: 0, doing: 0 });
    expect(label(total([]))).toBe('0 of 0 done');
  });
});

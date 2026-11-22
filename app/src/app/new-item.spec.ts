import { TestBed } from '@angular/core/testing';

import { NewItem, PARENTS } from './new-item';
import { boardData, fakeServer } from './testing';

async function render(opts: Parameters<typeof fakeServer>[0] = {}) {
  const server = fakeServer(opts);
  vi.stubGlobal('fetch', vi.fn(server.fetchFn));
  const fixture = TestBed.createComponent(NewItem);
  fixture.componentRef.setInput('epics', boardData().options.epics);
  fixture.componentRef.setInput('features', boardData().options.features);
  await fixture.whenStable();
  fixture.detectChanges();
  return { server, fixture, form: fixture.componentInstance, el: fixture.nativeElement as HTMLElement };
}

describe('the new item form', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('offers features as parents for a story, epics for a feature, none for an epic', async () => {
    const { form, fixture, el } = await render();
    const parents = () => [...el.querySelectorAll('select[aria-label="Parent"] option')].map(o => o.getAttribute('value'));
    expect(parents()).toEqual(['', '0.1', '1.1', '1.2']);
    form.type.set('feature');
    fixture.detectChanges();
    expect(parents()).toEqual(['', '0', '1']);
    form.type.set('epic');
    fixture.detectChanges();
    expect(el.querySelector('select[aria-label="Parent"]')).toBeNull();
    expect(PARENTS['bug']).toEqual({ of: 'feature', optional: true });
  });

  it('creates it on the server and opens it', async () => {
    const { server, form } = await render();
    let opened = '';
    form.created.subscribe(id => { opened = id; });
    form.type.set('bug');
    form.title.set('  Totals off ');
    await form.create();
    expect(server.calls.filter(c => c.method === 'POST')).toEqual([{ method: 'POST', url: 'api/v1/items', body: { type: 'bug', title: 'Totals off' } }]);
    expect(opened).toBe('1.1.9');
  });

  it("shows ob new's reason when it's refused", async () => {
    const { form, fixture, el } = await render({ refuse: 'a story needs --parent <feature>, such as --parent 2.3' });
    form.title.set('Orphan');
    await form.create();
    fixture.detectChanges();
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('needs --parent');
  });
});

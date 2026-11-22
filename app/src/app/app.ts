import { Component, DestroyRef, effect, inject, signal } from '@angular/core';

import { Board } from './board';
import { NO_FILTERS } from './board-api';
import type { Filters } from './board-api';
import { BacklogEvents } from './events';
import { loadHealth } from './health';
import type { Health } from './health';
import { Tree } from './tree';
import type { Focus } from './tree';

export type View = 'board' | 'tree';

/**
 * The board's shell (2.4.1): the header, with the backlog it serves from /api/v1/health, read again
 * whenever the backlog changes (2.4.2), and two views: the board (2.4.3, 2.4.4) and the tree
 * (2.4.5), which opens the board filtered to a feature. The tree is /#tree, so a reload or Back
 * keeps it. Sync (2.4.6) comes next.
 */
@Component({
  selector: 'ob-root',
  imports: [Board, Tree],
  styles: `
    .bar { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem 0.75rem; padding: 0.75rem 1.25rem; border-bottom: 1px solid var(--ob-border); }
    .bar img { width: 28px; height: 28px; border-radius: 6px; }
    .bar h1 { font-size: 1.0625rem; font-weight: var(--ob-weight-bold); margin: 0; }
    .bar .name { font-family: var(--ob-font-mono); font-size: 0.875rem; color: var(--ob-muted); margin-left: auto; }
    .facts { font-family: var(--ob-font-mono); font-size: 0.75rem; color: var(--ob-muted); }
    .views { display: flex; gap: 0.25rem; }
    @media (max-width: 600px) { .bar .facts { display: none; } .bar .name { margin-left: 0; } }
    .views button { background: none; border: 1px solid transparent; border-radius: 6px; padding: 0.25rem 0.75rem; font: inherit; font-size: 0.875rem; color: var(--ob-muted); cursor: pointer; }
    .views button:hover { color: var(--ob-ink); }
    .views button[aria-current="page"] { color: var(--ob-ink); border-color: var(--ob-border); background: var(--ob-subtle); font-weight: var(--ob-weight-bold); }
    .error { border-left: 3px solid var(--ob-brand); padding-left: 0.75rem; margin: 1.5rem 1.25rem; }
  `,
  template: `
    <header class="bar">
      <img src="board-icon.png" alt="">
      <h1>Open Backlog board</h1>
      <nav class="views" aria-label="Views">
        <button type="button" [attr.aria-current]="view() === 'board' ? 'page' : null" (click)="show('board')">Board</button>
        <button type="button" [attr.aria-current]="view() === 'tree' ? 'page' : null" (click)="show('tree')">Tree</button>
      </nav>
      @if (health(); as h) {
        <span class="name">{{ h.backlog.name }} · {{ h.backlog.items }} items</span>
        <span class="facts" [title]="'board ' + h.board + ' · open-backlog ' + h.core + ' · spec ' + h.spec">open-backlog {{ h.core }}</span>
      }
    </header>
    @if (health()) {
      <main>
        @if (view() === 'tree') { <ob-tree (opened)="focus($event)" /> } @else { <ob-board [initial]="start()" /> }
      </main>
    } @else if (error(); as e) {
      <p class="error" role="alert">The board can't reach its server: {{ e }}. Start it again with <code>ob serve</code>.</p>
    }
  `,
})
export class App {
  readonly health = signal<Health | null>(null);
  readonly error = signal<string | null>(null);
  readonly view = signal<View>(viewOf(location.hash));
  /** The board's filters when it opens: none, or the feature or epic picked in the tree. */
  readonly start = signal<Filters>(NO_FILTERS);

  constructor() {
    const back = () => this.view.set(viewOf(location.hash));
    addEventListener('popstate', back);
    inject(DestroyRef).onDestroy(() => removeEventListener('popstate', back));
    const events = inject(BacklogEvents);
    events.start();
    effect(() => {
      events.version();
      this.refresh();
    });
  }

  show(view: View): void {
    if (view === 'board') this.start.set(NO_FILTERS);
    if (view === this.view()) return;
    history.pushState(null, '', view === 'tree' ? '#tree' : location.pathname + location.search);
    this.view.set(view);
  }

  /** The board, filtered to what was clicked in the tree. */
  focus(f: Focus): void {
    history.pushState(null, '', location.pathname + location.search);
    this.start.set({ ...NO_FILTERS, epic: f.epic, feature: f.feature });
    this.view.set('board');
  }

  refresh(): void {
    loadHealth().then(h => { this.health.set(h); this.error.set(null); }, (e: unknown) => this.error.set((e as Error).message));
  }
}

export const viewOf = (hash: string): View => (hash === '#tree' ? 'tree' : 'board');

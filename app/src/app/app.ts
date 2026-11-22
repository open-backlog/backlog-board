import { Component, signal } from '@angular/core';

import { loadHealth } from './health';
import type { Health } from './health';

/**
 * The board's shell (2.4.1): the header, and which backlog it serves, from the server's
 * /api/health. The columns (2.4.3), item editor (2.4.4), tree (2.4.5) and Sync (2.4.6) come next.
 */
@Component({
  selector: 'ob-root',
  styles: `
    .bar { display: flex; align-items: center; gap: 0.75rem; padding: 0.75rem 1.25rem; border-bottom: 1px solid var(--ob-border); }
    .bar img { width: 28px; height: 28px; border-radius: 6px; }
    .bar h1 { font-size: 1.0625rem; font-weight: var(--ob-weight-bold); margin: 0; }
    .bar .name { font-family: var(--ob-font-mono); font-size: 0.875rem; color: var(--ob-muted); margin-left: auto; }
    main { padding: 2rem 1.25rem; max-width: 46rem; }
    .facts { font-family: var(--ob-font-mono); font-size: 0.8125rem; color: var(--ob-muted); }
    .error { border-left: 3px solid var(--ob-brand); padding-left: 0.75rem; }
  `,
  template: `
    <header class="bar">
      <img src="board-icon.png" alt="">
      <h1>Open Backlog board</h1>
      @if (health(); as h) { <span class="name">{{ h.backlog.name }}</span> }
    </header>
    <main>
      @if (health(); as h) {
        <p class="lead">The board for <strong>{{ h.backlog.name }}</strong>: {{ h.backlog.items }} items.</p>
        <p>Columns, the item editor, the plan's progress and Sync are on the way.</p>
        <p class="facts">board {{ h.board }} · open-backlog {{ h.core }} · spec {{ h.spec }}</p>
      } @else if (error(); as e) {
        <p class="error" role="alert">The board can't reach its server: {{ e }}. Start it again with <code>ob serve</code>.</p>
      } @else {
        <p class="facts">Loading…</p>
      }
    </main>
  `,
})
export class App {
  readonly health = signal<Health | null>(null);
  readonly error = signal<string | null>(null);

  constructor() {
    loadHealth().then(h => this.health.set(h), (e: unknown) => this.error.set((e as Error).message));
  }
}

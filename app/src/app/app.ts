import { Component, effect, inject, signal } from '@angular/core';

import { Board } from './board';
import { BacklogEvents } from './events';
import { loadHealth } from './health';
import type { Health } from './health';

/**
 * The board's shell (2.4.1): the header, with the backlog it serves from /api/health, read again
 * whenever the backlog changes (2.4.2), and the board (2.4.3). The item editor (2.4.4), tree
 * (2.4.5) and Sync (2.4.6) come next.
 */
@Component({
  selector: 'ob-root',
  imports: [Board],
  styles: `
    .bar { display: flex; align-items: center; gap: 0.75rem; padding: 0.75rem 1.25rem; border-bottom: 1px solid var(--ob-border); }
    .bar img { width: 28px; height: 28px; border-radius: 6px; }
    .bar h1 { font-size: 1.0625rem; font-weight: var(--ob-weight-bold); margin: 0; }
    .bar .name { font-family: var(--ob-font-mono); font-size: 0.875rem; color: var(--ob-muted); margin-left: auto; }
    .facts { font-family: var(--ob-font-mono); font-size: 0.75rem; color: var(--ob-muted); }
    .error { border-left: 3px solid var(--ob-brand); padding-left: 0.75rem; margin: 1.5rem 1.25rem; }
  `,
  template: `
    <header class="bar">
      <img src="board-icon.png" alt="">
      <h1>Open Backlog board</h1>
      @if (health(); as h) {
        <span class="name">{{ h.backlog.name }} · {{ h.backlog.items }} items</span>
        <span class="facts" [title]="'board ' + h.board + ' · open-backlog ' + h.core + ' · spec ' + h.spec">open-backlog {{ h.core }}</span>
      }
    </header>
    @if (health()) {
      <main><ob-board /></main>
    } @else if (error(); as e) {
      <p class="error" role="alert">The board can't reach its server: {{ e }}. Start it again with <code>ob serve</code>.</p>
    }
  `,
})
export class App {
  readonly health = signal<Health | null>(null);
  readonly error = signal<string | null>(null);

  constructor() {
    const events = inject(BacklogEvents);
    events.start();
    effect(() => {
      events.version();
      this.refresh();
    });
  }

  refresh(): void {
    loadHealth().then(h => { this.health.set(h); this.error.set(null); }, (e: unknown) => this.error.set((e as Error).message));
  }
}

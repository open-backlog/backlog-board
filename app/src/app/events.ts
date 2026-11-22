import { Injectable, signal } from '@angular/core';

/**
 * The server's /api/v1/events (2.4.2), once for the whole app: `version` goes up whenever a file in
 * the backlog changes, from the board or from an editor, and views read their data again.
 */
@Injectable({ providedIn: 'root' })
export class BacklogEvents {
  readonly version = signal(0);
  private source: EventSource | null = null;

  /** Starts listening (once); safe to call from every view that needs it. */
  start(): void {
    if (this.source) return;
    this.source = new EventSource('api/v1/events');
    this.source.addEventListener('change', () => this.version.update(v => v + 1));
  }

  stop(): void {
    this.source?.close();
    this.source = null;
  }
}

import { Component, DestroyRef, effect, inject, signal } from '@angular/core';

import { BacklogEvents } from './events';
import { done, loadSync, runSync, SyncFailure, toShare } from './sync-api';
import type { Conflict, SyncStatus } from './sync-api';

/**
 * Sync (2.4.6) in the header: how many of your commits aren't shared yet (click it to see them),
 * and Sync, which gets your teammates' changes and then sends yours (git pull --rebase, then git
 * push, with your own git). Nothing is shared until you click it. A conflict stays on screen, with
 * its files and the commands to finish or undo it, until git says it's resolved.
 */
@Component({
  selector: 'ob-sync',
  styleUrl: './sync.css',
  template: `
    @if (status(); as s) {
      @if (s.git) {
        <div class="sync">
          <button type="button" class="count" [class.some]="s.unshared.length" [attr.aria-expanded]="showList()" (click)="showList.set(!showList())"
            [title]="s.upstream ? 'Your commits not on ' + s.upstream + ' yet' : 'This branch has no remote branch yet'">{{ toShare(s) }}</button>
          <button type="button" class="go" [class.conflict]="s.conflict" [disabled]="running()" (click)="sync()">
            {{ running() ? 'Syncing…' : s.conflict ? 'Conflict' : 'Sync' }}</button>
        </div>
        <div class="panels">
          @if (message(); as m) { <p class="note" role="status">{{ m }}</p> }
          @if (error(); as e) {
            <div class="error" role="alert"><p>{{ e }}</p><button type="button" class="link" (click)="error.set(null)">Dismiss</button></div>
          }
          @if (conflict(); as c) {
            <section class="conflict-box" role="alert" aria-labelledby="h-conflict">
              <h2 id="h-conflict">Sync stopped: a {{ c.kind }} conflict</h2>
              @if (c.files.length) {
                <p>Your changes and a teammate's change the same lines in:</p>
                <ul class="files">@for (f of c.files; track f) { <li><code>{{ f }}</code></li> }</ul>
              }
              <p>Nothing was sent. In a terminal, in this repository:</p>
              <ol class="steps">@for (step of c.steps; track step) { <li>{{ step }}</li> }</ol>
              <button type="button" (click)="refresh()">Check again</button>
            </section>
          }
          @if (showList()) {
            <section class="list" aria-label="Not shared yet">
              @if (s.unshared.length) {
                <p>Sync will send {{ s.unshared.length === 1 ? 'this commit' : 'these ' + s.unshared.length + ' commits' }} to <code>{{ s.upstream }}</code>:</p>
                <ul>@for (c of s.unshared; track c.hash) { <li><code>{{ c.hash }}</code> {{ c.subject }}</li> }</ul>
              } @else if (s.upstream) {
                <p>Everything is shared with <code>{{ s.upstream }}</code>.</p>
              } @else {
                <p><code>{{ s.branch ?? 'HEAD' }}</code> has no remote branch yet. Share it once from a terminal:
                  <code>git push -u origin {{ s.branch ?? '&lt;branch&gt;' }}</code></p>
              }
              @if (s.behind) { <p class="muted">{{ s.behind }} of your teammates' commits are waiting; Sync gets them.</p> }
            </section>
          }
        </div>
      }
    }
  `,
})
export class Sync {
  readonly status = signal<SyncStatus | null>(null);
  readonly running = signal(false);
  readonly showList = signal(false);
  /** The last Sync's outcome, for a few seconds. */
  readonly message = signal<string | null>(null);
  readonly error = signal<string | null>(null);
  /** From the last Sync, or found on load; cleared only when git no longer has one. */
  readonly conflict = signal<Conflict | null>(null);
  readonly toShare = toShare;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    const events = inject(BacklogEvents);
    events.start();
    effect(() => {
      events.version();
      this.refresh();
    });
    const again = () => this.refresh();
    addEventListener('focus', again);
    inject(DestroyRef).onDestroy(() => { removeEventListener('focus', again); clearTimeout(this.timer); });
  }

  refresh(): void {
    loadSync().then(s => { this.status.set(s); this.conflict.set(s.conflict); }, () => undefined);
  }

  async sync(): Promise<void> {
    this.running.set(true);
    this.error.set(null);
    this.message.set(null);
    try {
      const r = await runSync();
      this.status.set(r.status);
      this.conflict.set(null);
      this.showList.set(false);
      this.message.set(done(r));
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.message.set(null), 6000);
    } catch (e) {
      if (e instanceof SyncFailure && e.conflict) this.conflict.set(e.conflict);
      else this.error.set((e as Error).message);
      this.refresh();
    } finally {
      this.running.set(false);
    }
  }
}

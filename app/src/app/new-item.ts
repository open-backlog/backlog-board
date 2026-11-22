import { Component, computed, input, output, signal } from '@angular/core';

import type { Choice } from './board-api';
import { createItem } from './item-api';

/** What each type is filed under, as ob new requires; bugs and tasks may have none (epic 0). */
export const PARENTS: Record<string, { of: 'feature' | 'epic' | null; optional: boolean }> = {
  story: { of: 'feature', optional: false },
  bug: { of: 'feature', optional: true },
  spike: { of: 'feature', optional: false },
  task: { of: 'feature', optional: true },
  feature: { of: 'epic', optional: false },
  epic: { of: null, optional: true },
};

/**
 * A new story, bug, spike, task, feature or epic (2.4.4), made on the server by open-backlog's
 * addItem, the same as ob new: the next free number, the template, one commit. A wrong parent
 * comes back refused with ob new's reason.
 */
@Component({
  selector: 'ob-new-item',
  styleUrl: './item-panel.css',
  host: { '(document:keydown.escape)': 'closed.emit()' },
  template: `
    <aside class="panel" role="dialog" aria-label="New item">
      <header class="head"><h2>New item</h2><button type="button" class="close" (click)="closed.emit()" aria-label="Close">✕</button></header>
      @if (error(); as e) { <p class="error" role="alert">{{ e }}</p> }
      <form class="fields" (submit)="$event.preventDefault(); create()">
        <label><span class="key">type</span>
          <select [value]="type()" (change)="type.set(val($event)); parent.set('')" aria-label="Type">
            @for (t of types; track t) { <option [value]="t">{{ t }}</option> }
          </select>
        </label>
        <label><span class="key">title</span><input [value]="title()" (input)="title.set(val($event))" aria-label="Title" required></label>
        @if (rule().of; as of) {
          <label><span class="key">parent</span>
            <select [value]="parent()" (change)="parent.set(val($event))" aria-label="Parent">
              <option value="">{{ rule().optional ? 'none: this month in epic 0' : 'choose a ' + of }}</option>
              @for (p of parents(); track p.id) { <option [value]="p.id">{{ p.id }} {{ p.title }}</option> }
            </select>
          </label>
        }
        <div class="actions">
          <span class="hint">One commit, as ob new.</span>
          <button type="button" (click)="closed.emit()">Cancel</button>
          <button type="submit" class="primary" [disabled]="busy() || !title().trim()">Create</button>
        </div>
      </form>
    </aside>
  `,
})
export class NewItem {
  readonly epics = input<Choice[]>([]);
  readonly features = input<Choice[]>([]);
  readonly closed = output<void>();
  readonly created = output<string>();

  readonly types = Object.keys(PARENTS);
  readonly type = signal('story');
  readonly title = signal('');
  readonly parent = signal('');
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly rule = computed(() => PARENTS[this.type()] ?? { of: null, optional: true });
  readonly parents = computed(() => (this.rule().of === 'epic' ? this.epics() : this.rule().of === 'feature' ? this.features() : []));

  val = (e: Event) => (e.target as HTMLInputElement | HTMLSelectElement).value;

  async create(): Promise<void> {
    this.busy.set(true);
    try {
      const r = await createItem({ type: this.type(), title: this.title().trim(), ...(this.parent() ? { parent: this.parent() } : {}) });
      this.created.emit(r.id);
    } catch (e) {
      this.error.set((e as Error).message);
    } finally {
      this.busy.set(false);
    }
  }
}

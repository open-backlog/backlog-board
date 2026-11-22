import { CdkDrag, CdkDragPlaceholder, CdkDropList, CdkDropListGroup, moveItemInArray, transferArrayItem } from '@angular/cdk/drag-drop';
import type { CdkDragDrop } from '@angular/cdk/drag-drop';
import { Component, computed, effect, inject, input, linkedSignal, signal } from '@angular/core';

import { loadBoard, moveCard, NO_FILTERS, rankCard, STATUSES } from './board-api';
import type { BoardData, Card, Filters, Status } from './board-api';
import { BacklogEvents } from './events';
import { ItemPanel } from './item-panel';
import { NewItem } from './new-item';

/**
 * The board (2.4.3): todo, doing and done columns of cards, in column order (rank, then ID).
 * A card's title opens it in the item panel, and + New makes an item (2.4.4). The tree opens it
 * filtered to a feature or an epic (2.4.5).
 * Dragging a card to another column moves it (ob move); dragging it within its column changes
 * its rank alone; the ← → buttons move it without a mouse. Every change is the server's, one
 * commit each, and the columns are read again after it, and whenever the backlog changes.
 */
@Component({
  selector: 'ob-board',
  imports: [CdkDropListGroup, CdkDropList, CdkDrag, CdkDragPlaceholder, ItemPanel, NewItem],
  styleUrl: './board.css',
  template: `
    <form class="filters" aria-label="Filters" (submit)="$event.preventDefault()">
      <label>Epic
        <select [value]="filters().epic" (change)="set({ epic: value($event), feature: '' })">
          <option value="">All</option>
          @for (e of data()?.options?.epics ?? []; track e.id) { <option [value]="e.id" [selected]="e.id === filters().epic">{{ e.id }} {{ e.title }}</option> }
        </select>
      </label>
      <label>Feature
        <select [value]="filters().feature" (change)="set({ feature: value($event) })">
          <option value="">All</option>
          @for (f of features(); track f.id) { <option [value]="f.id" [selected]="f.id === filters().feature">{{ f.id }} {{ f.title }}</option> }
        </select>
      </label>
      @if (data()?.options?.repos?.length) {
        <label>Repo
          <select [value]="filters().repo" (change)="set({ repo: value($event) })">
            <option value="">All</option>
            @for (r of data()!.options.repos; track r) { <option [value]="r" [selected]="r === filters().repo">{{ r }}</option> }
          </select>
        </label>
      }
      <label>Type
        <select [value]="filters().type" (change)="set({ type: value($event) })">
          <option value="">All</option>
          @for (t of data()?.options?.types ?? []; track t) { <option [value]="t" [selected]="t === filters().type">{{ t }}</option> }
        </select>
      </label>
      <label class="check"><input type="checkbox" [checked]="filters().all" (change)="set({ all: checked($event) })"> All done items</label>
      <button type="button" class="new" (click)="creating.set(true); open.set(null)">+ New</button>
    </form>

    @if (error(); as e) { <p class="error" role="alert">{{ e }} <button type="button" (click)="error.set(null)">Dismiss</button></p> }

    <div class="columns" cdkDropListGroup>
      @for (status of statuses; track status) {
        <section class="column" [class]="'column s-' + status" [attr.aria-labelledby]="'h-' + status">
          <h2 [id]="'h-' + status">{{ status }} <span class="count">{{ columns()[status].length }}</span></h2>
          <div class="cards" cdkDropList [id]="'list-' + status" [cdkDropListData]="status" (cdkDropListDropped)="dropped($event)">
            @for (c of columns()[status]; track c.id) {
              <article class="card" cdkDrag [cdkDragData]="c" [attr.data-id]="c.id" [attr.aria-label]="c.id + ' ' + c.title">
                <div class="top">
                  <span class="id">{{ c.id }}</span>
                  <span class="type" [class.bug]="c.type === 'bug'">{{ c.type }}</span>
                </div>
                <p class="title"><button type="button" class="open" (click)="open.set(c.id); creating.set(false)">{{ c.title }}</button></p>
                <div class="meta">
                  @for (r of c.repo; track r) { <span class="repo">{{ r }}</span> }
                  @if (c.assignee) { <span class="who">&#64;{{ c.assignee }}</span> }
                  <span class="nav">
                    @if (left(status); as to) { <button type="button" (click)="move(c, to)" [attr.aria-label]="'Move ' + c.id + ' to ' + to" [title]="'Move to ' + to">←</button> }
                    @if (right(status); as to) { <button type="button" (click)="move(c, to)" [attr.aria-label]="'Move ' + c.id + ' to ' + to" [title]="'Move to ' + to">→</button> }
                  </span>
                </div>
                <div class="slot" *cdkDragPlaceholder></div>
              </article>
            } @empty {
              <p class="empty">Nothing here.</p>
            }
          </div>
          @if (status === 'done' && (data()?.hiddenDone ?? 0) > 0 && !filters().all) {
            <p class="hidden-done">{{ data()!.hiddenDone }} done more than 30 days ago.
              <button type="button" class="link" (click)="set({ all: true })">Show all</button></p>
          }
        </section>
      }
    </div>

    @if (open(); as id) { <ob-item-panel [id]="id" (closed)="open.set(null)" (opened)="open.set($event)" /> }
    @if (creating()) {
      <ob-new-item [epics]="data()?.options?.epics ?? []" [features]="data()?.options?.features ?? []"
        (closed)="creating.set(false)" (created)="creating.set(false); open.set($event)" />
    }
  `,
})
export class Board {
  /** The item open in the panel, if any; a new-item form instead while creating. */
  readonly open = signal<string | null>(null);
  readonly creating = signal(false);
  readonly statuses = STATUSES;
  /** Where the board starts: the tree opens it on a feature or an epic (2.4.5). */
  readonly initial = input<Filters>(NO_FILTERS);
  readonly filters = linkedSignal<Filters>(() => this.initial());
  readonly data = signal<BoardData | null>(null);
  readonly error = signal<string | null>(null);
  /** The columns as shown; a drag changes them at once, and the server's answer replaces them. */
  readonly columns = signal<Record<Status, Card[]>>({ todo: [], doing: [], done: [] });
  readonly features = computed(() => {
    const all = this.data()?.options.features ?? [];
    const epic = this.filters().epic;
    return epic ? all.filter(f => f.parent === epic) : all;
  });

  constructor() {
    const events = inject(BacklogEvents);
    events.start();
    effect(() => {
      events.version();
      void this.reload(this.filters());
    });
  }

  async reload(f: Filters = this.filters()): Promise<void> {
    try {
      const d = await loadBoard(f);
      this.data.set(d);
      this.columns.set(d.columns);
    } catch (e) {
      this.error.set((e as Error).message);
    }
  }

  set(change: Partial<Filters>): void {
    this.filters.update(f => ({ ...f, ...change }));
  }

  value = (e: Event) => (e.target as HTMLSelectElement).value;
  checked = (e: Event) => (e.target as HTMLInputElement).checked;
  left = (s: Status): Status | null => STATUSES[STATUSES.indexOf(s) - 1] ?? null;
  right = (s: Status): Status | null => STATUSES[STATUSES.indexOf(s) + 1] ?? null;

  /** A drop: into another column is a move (it lands in that column's order); within one, a reorder. */
  async dropped(e: CdkDragDrop<Status, Status, Card>): Promise<void> {
    const from = e.previousContainer.data;
    const to = e.container.data;
    const cols = structuredClone(this.columns());
    if (from !== to) {
      transferArrayItem(cols[from], cols[to], e.previousIndex, e.currentIndex);
      this.columns.set(cols);
      return this.change(() => moveCard(e.item.data.id, to));
    }
    if (e.previousIndex === e.currentIndex) return;
    moveItemInArray(cols[to], e.previousIndex, e.currentIndex);
    this.columns.set(cols);
    const after = cols[to][e.currentIndex - 1]?.id ?? null;
    return this.change(() => rankCard(e.item.data.id, after));
  }

  move(c: Card, to: Status): Promise<void> {
    return this.change(() => moveCard(c.id, to));
  }

  /** A change on the server, then the columns as the server has them; a refusal is shown. */
  private async change(call: () => Promise<unknown>): Promise<void> {
    try {
      await call();
      this.error.set(null);
    } catch (e) {
      this.error.set((e as Error).message);
    }
    await this.reload();
  }
}

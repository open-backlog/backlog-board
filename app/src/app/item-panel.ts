import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { Marked } from 'marked';

import { BacklogEvents } from './events';
import { addComment, crumbId, fieldText, fieldValue, loadItem, LOCKED, movedTo, saveItem } from './item-api';
import type { ItemView } from './item-api';

const md = new Marked({ gfm: true, breaks: false });

/**
 * One item (2.4.4): its place in the plan, fields, description (rendered), children, comments and
 * git history, with each move between columns marked. The fields and the description each have
 * an editor; a save is one commit on the server, and a change ob validate would report comes
 * back refused with its message. A comment is the line ob comment writes.
 */
@Component({
  selector: 'ob-item-panel',
  styleUrl: './item-panel.css',
  host: { '(document:keydown.escape)': 'closed.emit()' },
  template: `
    <aside class="panel" role="dialog" aria-modal="false" [attr.aria-label]="item()?.id + ' ' + item()?.title">
      @if (item(); as it) {
        <nav class="crumbs" aria-label="Where it sits">
          @for (c of it.breadcrumb.slice(0, -1); track c) {
            @if (!$first) { <span aria-hidden="true">›</span> }
            <button type="button" class="link" (click)="opened.emit(crumb(c))">{{ c }}</button>
          }
        </nav>
        <header class="head">
          <div>
            <p class="kind"><span class="id">{{ it.id }}</span> {{ it.type }}@if (it.status) { · <span class="status s-{{ it.status }}">{{ it.status }}</span>}</p>
            <h2>{{ it.title }}</h2>
            <p class="path">{{ it.path }}</p>
          </div>
          <button type="button" class="close" (click)="closed.emit()" aria-label="Close">✕</button>
        </header>

        @if (error(); as e) { <p class="error" role="alert">{{ e }}</p> }

        <section aria-labelledby="h-fields">
          <div class="bar"><h3 id="h-fields">Fields</h3>
            @if (!editFields()) { <button type="button" class="edit" (click)="startFields()">Edit</button> }
          </div>
          @if (editFields()) {
            <form class="fields" (submit)="$event.preventDefault(); saveFields()">
              @for (row of rows(); track $index) {
                <label>
                  @if (row.added) { <input class="key" [value]="row.key" (input)="row.key = val($event)" placeholder="field" aria-label="New field name"> }
                  @else { <span class="key">{{ row.key }}</span> }
                  <input [value]="row.text" (input)="row.text = val($event)" [disabled]="locked(row.key)" [attr.aria-label]="row.key || 'New field value'">
                </label>
              }
              <div class="actions">
                <button type="button" class="link" (click)="addRow()">+ Field</button>
                <span class="hint">Empty removes a field.</span>
                <button type="button" (click)="editFields.set(false); error.set(null)">Cancel</button>
                <button type="submit" class="primary" [disabled]="busy()">Save</button>
              </div>
            </form>
          } @else {
            <dl class="fields">
              @for (f of fieldList(); track f.key) { <dt>{{ f.key }}</dt><dd>{{ f.text }}</dd> }
            </dl>
          }
        </section>

        @if (it.progress; as p) {
          <p class="progress">{{ p.done }}/{{ p.total }} done ({{ p.percent }}%), {{ p.doing }} doing, {{ p.todo }} todo</p>
        }

        <section aria-labelledby="h-desc">
          <div class="bar"><h3 id="h-desc">Description</h3>
            @if (!editDesc()) { <button type="button" class="edit" (click)="startDesc()">Edit</button> }
          </div>
          @if (editDesc()) {
            <form (submit)="$event.preventDefault(); saveDesc()">
              <textarea class="md-edit" [value]="draft()" (input)="draft.set(val($event))" rows="12" aria-label="Description (Markdown)"></textarea>
              <div class="actions">
                <span class="hint">Markdown. Comments are kept as they are.</span>
                <button type="button" (click)="editDesc.set(false); error.set(null)">Cancel</button>
                <button type="submit" class="primary" [disabled]="busy()">Save</button>
              </div>
            </form>
          } @else if (html()) {
            <div class="md" [innerHTML]="html()"></div>
          } @else {
            <p class="none">No description yet.</p>
          }
        </section>

        @if (it.children.length) {
          <section aria-labelledby="h-children">
            <h3 id="h-children">Children</h3>
            <ul class="children">
              @for (c of it.children; track c.id) {
                <li><button type="button" class="link" (click)="opened.emit(c.id)">{{ c.id }}</button>
                  <span class="muted">{{ c.status ?? c.type }}</span> {{ c.title }}</li>
              }
            </ul>
          </section>
        }

        <section aria-labelledby="h-comments">
          <h3 id="h-comments">Comments</h3>
          @for (c of it.comments; track $index) {
            <div class="comment"><p class="muted">{{ c.date }} &#64;{{ c.handle }}</p><p class="ctext">{{ c.text }}</p></div>
          } @empty { <p class="none">No comments yet.</p> }
          <form class="add-comment" (submit)="$event.preventDefault(); comment()">
            <textarea [value]="newComment()" (input)="newComment.set(val($event))" rows="2" placeholder="Add a comment" aria-label="New comment"></textarea>
            <button type="submit" class="primary" [disabled]="busy() || !newComment().trim()">Comment</button>
          </form>
        </section>

        <section aria-labelledby="h-history">
          <h3 id="h-history">History</h3>
          <ol class="history">
            @for (h of it.history; track h.hash) {
              <li [class.move]="moved(h.subject)">
                <span class="when">{{ h.date }}</span>
                @if (moved(h.subject); as to) { <span class="to s-{{ to }}">→ {{ to }}</span> }
                <span>{{ h.subject }}</span> <span class="muted">{{ h.author }} · {{ h.hash }}</span>
              </li>
            } @empty { <li class="none">Not committed yet.</li> }
          </ol>
        </section>
      } @else if (error(); as e) {
        <p class="error" role="alert">{{ e }}</p>
        <button type="button" (click)="closed.emit()">Close</button>
      }
    </aside>
  `,
})
export class ItemPanel {
  readonly id = input.required<string>();
  readonly closed = output<void>();
  readonly opened = output<string>();

  readonly item = signal<ItemView | null>(null);
  readonly error = signal<string | null>(null);
  readonly busy = signal(false);
  readonly editFields = signal(false);
  readonly editDesc = signal(false);
  readonly draft = signal('');
  readonly newComment = signal('');
  readonly rows = signal<{ key: string; text: string; was: unknown; added: boolean }[]>([]);

  readonly fieldList = computed(() => Object.entries(this.item()?.fields ?? {}).map(([key, v]) => ({ key, text: fieldText(v) })));
  readonly html = computed(() => {
    const d = this.item()?.description.trim() ?? '';
    return d ? (md.parse(d, { async: false }) as string) : '';
  });

  constructor() {
    const events = inject(BacklogEvents);
    events.start();
    effect(() => {
      const id = this.id();
      events.version();
      void this.load(id);
    });
  }

  async load(id = this.id()): Promise<void> {
    try {
      // A refusal stays on screen: a reload (such as the server putting the file back) keeps it.
      this.item.set(await loadItem(id));
    } catch (e) {
      this.item.set(null);
      this.error.set((e as Error).message);
    }
  }

  val = (e: Event) => (e.target as HTMLInputElement | HTMLTextAreaElement).value;
  locked = (key: string) => LOCKED.includes(key);
  crumb = crumbId;
  moved = movedTo;

  startFields(): void {
    this.error.set(null);
    this.rows.set(Object.entries(this.item()?.fields ?? {}).map(([key, was]) => ({ key, text: fieldText(was), was, added: false })));
    this.editFields.set(true);
  }

  addRow(): void {
    this.rows.update(r => [...r, { key: '', text: '', was: undefined, added: true }]);
  }

  /** Only the fields that changed are sent; an emptied one is removed. */
  async saveFields(): Promise<void> {
    const fields: Record<string, unknown> = {};
    for (const r of this.rows()) {
      const key = r.key.trim();
      if (!key || this.locked(key)) continue;
      const value = fieldValue(r.text, r.was, key);
      if (r.added && value === null) continue;
      if (!r.added && fieldText(r.was) === r.text.trim()) continue;
      fields[key] = value;
    }
    if (!Object.keys(fields).length) return this.editFields.set(false);
    if (await this.save(() => saveItem(this.id(), { fields }))) this.editFields.set(false);
  }

  startDesc(): void {
    this.error.set(null);
    this.draft.set((this.item()?.description ?? '').replace(/^\s*\n/, '').replace(/\s+$/, ''));
    this.editDesc.set(true);
  }

  async saveDesc(): Promise<void> {
    if (await this.save(() => saveItem(this.id(), { description: this.draft() }))) this.editDesc.set(false);
  }

  async comment(): Promise<void> {
    if (await this.save(() => addComment(this.id(), this.newComment()))) this.newComment.set('');
  }

  /** A save on the server; true if it was accepted. A refusal stays on screen with its reason. */
  private async save(call: () => Promise<unknown>): Promise<boolean> {
    this.busy.set(true);
    try {
      await call();
      this.error.set(null);
      await this.load();
      return true;
    } catch (e) {
      this.error.set((e as Error).message);
      return false;
    } finally {
      this.busy.set(false);
    }
  }
}

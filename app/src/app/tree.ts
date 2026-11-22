import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, effect, inject, output, signal } from '@angular/core';

import { BacklogEvents } from './events';
import { label, loadTree, planChildren, split, total, widths } from './tree-api';
import type { Progress, TreeNode } from './tree-api';

/** What the board opens when a feature or an epic in the tree is clicked. */
export interface Focus { epic: string; feature: string }

/**
 * The tree (2.4.5): capabilities, epics and features with a progress bar each, from their
 * stories, as ob tree counts them (GET /api/v1/tree is ob tree --json). The planned work is on
 * the left with its total; epic 0's monthly features are beside it. A feature or an epic opens
 * the board filtered to it.
 */
@Component({
  selector: 'ob-tree',
  imports: [NgTemplateOutlet],
  styleUrl: './tree.css',
  template: `
    <ng-template #bar let-p>
      <span class="meter" role="progressbar" aria-valuemin="0" aria-valuemax="100" [attr.aria-valuenow]="p.percent" [attr.aria-label]="label(p)">
        <span class="done" [style.width.%]="widths(p).done"></span><span class="doing" [style.width.%]="widths(p).doing"></span>
      </span>
      <span class="count">{{ label(p) }}@if (p.doing) {<span class="doing-n">, {{ p.doing }} doing</span>}</span>
    </ng-template>

    <ng-template #node let-n>
      <li [class]="'node t-' + n.type" [attr.data-id]="n.id">
        <div class="row">
          <span class="id">{{ n.id }}</span>
          @if (n.type === 'feature' || n.type === 'epic') {
            <button type="button" class="open" (click)="open(n)" [title]="'Open the board for ' + n.id">{{ n.title }}</button>
          } @else {
            <span class="name">{{ n.title }}</span>
          }
          <ng-container *ngTemplateOutlet="bar; context: { $implicit: n.progress }" />
        </div>
        @if (kids(n).length) {
          <ul>@for (c of kids(n); track c.id) { <ng-container *ngTemplateOutlet="node; context: { $implicit: c }" /> }</ul>
        }
      </li>
    </ng-template>

    @if (error(); as e) { <p class="error" role="alert">{{ e }}</p> }
    @if (roots()) {
      <div class="plan">
        <section class="planned" aria-labelledby="h-planned">
          <div class="head">
            <h2 id="h-planned">The plan</h2>
            <div class="whole"><ng-container *ngTemplateOutlet="bar; context: { $implicit: plannedTotal() }" /></div>
          </div>
          <ul class="tree">@for (n of parts().planned; track n.id) { <ng-container *ngTemplateOutlet="node; context: { $implicit: n }" /> }
            @empty { <li class="empty">No capabilities or epics yet.</li> }</ul>
        </section>
        <section class="unplanned" aria-labelledby="h-unplanned">
          @if (parts().unplanned; as u) {
            <div class="head">
              <h2 id="h-unplanned"><button type="button" class="open" (click)="open(u)">{{ u.title }}</button> <span class="id">epic {{ u.id }}</span></h2>
              <div class="whole"><ng-container *ngTemplateOutlet="bar; context: { $implicit: u.progress }" /></div>
            </div>
            <ul class="tree">@for (f of kids(u); track f.id) { <ng-container *ngTemplateOutlet="node; context: { $implicit: f }" /> }
              @empty { <li class="empty">No monthly features yet.</li> }</ul>
          } @else {
            <h2 id="h-unplanned">Unplanned work</h2>
            <p class="empty">No epic 0 in this backlog.</p>
          }
        </section>
      </div>
    }
  `,
})
export class Tree {
  /** A feature or an epic to open on the board. */
  readonly opened = output<Focus>();
  readonly roots = signal<TreeNode[] | null>(null);
  readonly error = signal<string | null>(null);
  readonly parts = computed(() => split(this.roots() ?? []));
  readonly plannedTotal = computed<Progress>(() => total(this.parts().planned));
  readonly kids = planChildren;
  readonly label = label;
  readonly widths = widths;

  constructor() {
    const events = inject(BacklogEvents);
    events.start();
    effect(() => {
      events.version();
      loadTree().then(r => { this.roots.set(r); this.error.set(null); }, (e: unknown) => this.error.set((e as Error).message));
    });
  }

  /** An epic is its own filter; a feature's epic is the first part of its ID (1.2 → 1). */
  open(n: TreeNode): void {
    this.opened.emit(n.type === 'feature' ? { epic: n.id.split('.')[0] ?? '', feature: n.id } : { epic: n.id, feature: '' });
  }
}

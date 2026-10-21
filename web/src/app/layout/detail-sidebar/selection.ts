import { afterNextRender, computed, type DestroyRef, DOCUMENT, inject, Injectable, Injector, signal } from '@angular/core';
import { Router } from '@angular/router';
import type { Relation, RelationIndex, RelationRef, RelationType } from '../../../../../core/src/relations';
import { queryParamSignal } from '../../shared/query-param';
import { ShellData } from '../shell/shell-data.service';
import { ShellState } from '../shell/shell-state.service';
import type { Tier } from '../shell/tier';

// The selection contract of the planning views (spec 026, T13/T14, ISC-171). Every view that lets the user pick an
// object (tree, Gantt, graph, workspace board, the Specs page's list, the dashboard's Next up and warnings, the ideas)
// follows these four rules:
//
// 1. Address. The selection lives only in the URL as `?sel=<type>:<id>`, a core `RelationRef` (`milestone:<slug>`,
//    `feature:F25`, `spec:025`, `claim:ISC-171`, `idea:<slug>`). Selecting is `DetailSelection.select(ref)` or a link
//    with `[queryParams]="{ sel: ref }" queryParamsHandling="merge"`; every other query param (`?m=` …) stays.
// 2. Object. The element that stands for an object carries `data-ref="<ref>"` (`DATA_REF`) and is focusable (a link,
//    a button, or `tabindex="-1"`/roving `0`). Escape and the close button return focus to the first element in the
//    document that matches `refSelector(ref)`, so the views never pass a trigger to the sidebar.
// 3. Look. The selected object carries `data-selected="row|card|node"` (`selectedLook(selection, ref, look)`), and the
//    view adds `layout/detail-sidebar/selection.css` to its `styleUrl`s: a row `--disp-t` with a 3 px inset `--color-primary`
//    (the prototype's cyan, the app's `disp` family), a card a 2 px `--color-primary` outline at offset 1, a graph node a 2 px `--color-primary` stroke.
// 4. Presentation. A page whose layout has a rail (the tree lens, the workspace's Specs page, the Gantt lens, whose
//    rail the shell opens at wide only while something is selected, spec 038) calls `DetailSelection.dock(destroyRef)`
//    for its lifetime: at wide the sidebar then replaces the rail blocks in `app-rail-slot`. Every other page (the
//    workspace dashboard, which has no rail since spec 058, the graph, the workspace board) docks nothing: the sidebar
//    floats there, a sheet at compact, an overlay at medium and the floating panel at wide (ISC-400). The shell mounts
//    `<app-detail-sidebar slot="float" />` once for the non-docked presentations.

/** The query param that holds the selection. */
export const SEL_PARAM = 'sel';
/** The attribute that names the object an element stands for (rule 2). */
export const DATA_REF = 'data-ref';
/** The children a section shows before its “+N more”. */
export const CHILD_CAP = 5;

const RELATION_TYPES: ReadonlySet<string> = new Set<RelationType>(['milestone', 'feature', 'spec', 'claim', 'idea']);

/** `?sel=`'s value as a relation ref; null when absent or not `<type>:<id>` with one of the five types. */
export function parseSel(value: string | null | undefined): RelationRef | null {
  if (!value) return null;
  const colon = value.indexOf(':');
  if (colon < 1 || colon === value.length - 1) return null;
  return RELATION_TYPES.has(value.slice(0, colon)) ? (value as RelationRef) : null;
}

/** The selector of the element that stands for `ref` (rule 2). */
export const refSelector = (ref: RelationRef): string => `[${DATA_REF}="${ref.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"]`;

/** How the sidebar is shown: in the rail, floating at the right edge, as a non-modal overlay, or as a bottom sheet. */
export type Presentation = 'docked' | 'floating' | 'overlay' | 'sheet';

/** The entry of `ref`, or undefined when the index does not hold it (the index type itself claims every key). */
export const relationAt = (index: RelationIndex, ref: RelationRef): Relation | undefined => index[ref];

/** The presentation per container tier (design.md § Across viewports): docked only at wide on a docking page. */
export function presentationFor(tier: Tier, docks: boolean): Presentation {
  if (tier === 'compact') return 'sheet';
  if (tier === 'medium') return 'overlay';
  return docks ? 'docked' : 'floating';
}

/**
 * The parents the sidebar lists: the index's own, and for a spec or a claim also the milestones of its first feature
 * parent (a spec's main feature, a claim's block), which the index keeps one level up. Each ref once, index order.
 */
export function sidebarParents(index: RelationIndex, entry: Relation): readonly RelationRef[] {
  const parents = [...entry.parents];
  if (entry.type === 'spec' || entry.type === 'claim') {
    const feature = entry.parents.find((ref) => relationAt(index, ref)?.type === 'feature');
    for (const ref of feature ? index[feature].parents : []) {
      if (relationAt(index, ref)?.type === 'milestone' && !parents.includes(ref)) parents.push(ref);
    }
  }
  return parents.filter((ref) => relationAt(index, ref) !== undefined);
}

/** The look a view sets as `data-selected` on the element of `ref` (rule 3); null while `ref` is not selected. */
export type SelectedLook = 'row' | 'card' | 'node';
export const selectedLook = (selection: DetailSelection, ref: RelationRef, look: SelectedLook): SelectedLook | null =>
  selection.selected() === ref ? look : null;

/**
 * The selection of the open workspace, read from the address alone, and where the sidebar shows it. The index is the
 * planning model's `relations`, loaded once per workspace by `ShellData.planning`; nothing is fetched here.
 */
@Injectable({ providedIn: 'root' })
export class DetailSelection {
  private readonly router = inject(Router);
  private readonly doc = inject(DOCUMENT);
  private readonly state = inject(ShellState);
  private readonly data = inject(ShellData);
  private readonly injector = inject(Injector);
  private readonly docks = signal(0);

  private readonly param = queryParamSignal(SEL_PARAM);

  /** The ref in `?sel=`, whether or not the index holds it. */
  readonly selected = computed(() => parseSel(this.param()));
  /**
   * The ref whose own element in the view keeps the focus the sidebar would otherwise move to its title: the tree's
   * arrival row (a `?sel=` deep link or an old-address redirect, ISC-167.1). Null when no view holds one.
   */
  readonly heldFocus = signal<RelationRef | null>(null);
  readonly index = computed<RelationIndex | null>(() => this.data.planningModel()?.relations ?? null);
  /** The selected entry; null without a selection, before the index arrives, or for a ref it does not hold. */
  readonly entry = computed<Relation | null>(() => {
    const ref = this.selected();
    return ref === null ? null : (this.index()?.[ref] ?? null);
  });
  readonly docked = computed(() => this.docks() > 0);
  /** Where the open sidebar shows; null while nothing is shown. */
  readonly presentation = computed<Presentation | null>(() =>
    this.entry() === null ? null : presentationFor(this.state.tier(), this.docked()),
  );

  /** A page with a rail docks the sidebar there at wide until `destroyRef` fires (rule 4). */
  dock(destroyRef: DestroyRef): void {
    this.docks.update((count) => count + 1);
    destroyRef.onDestroy(() => this.docks.update((count) => count - 1));
  }

  /** Selects `ref`: rewrites `?sel=` in place, every other param kept. */
  select(ref: RelationRef): Promise<boolean> {
    return this.router.navigate([], { queryParams: { [SEL_PARAM]: ref }, queryParamsHandling: 'merge', replaceUrl: true });
  }

  /** Closes the sidebar: drops `?sel=`, then focuses the element of the object that was selected (rule 2). */
  async close(): Promise<void> {
    const ref = this.selected();
    if (ref === null) return;
    await this.router.navigate([], { queryParams: { [SEL_PARAM]: null }, queryParamsHandling: 'merge', replaceUrl: true });
    // Focus the object only once the closing render is done, never when the navigation resolves: until that render the
    // view still shows the selection, so a key on the object would act on its selected state (the dashboard row's link
    // still leads to the spec page, ISC-61.1). And the sheet (compact) is a modal dialog: until that render removes it
    // the page is inert, and on its destroy it hands focus back to its opener (the body after a reload).
    afterNextRender(() => this.doc.querySelector<HTMLElement>(refSelector(ref))?.focus(), { injector: this.injector });
  }
}

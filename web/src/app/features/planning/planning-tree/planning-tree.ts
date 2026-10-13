import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  Injector,
  input,
  signal,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import type { PlanningModel } from '../../../../../../core/src/planning';
import type { RelationRef } from '../../../../../../core/src/relations';
import { DetailSelection, refSelector, selectedLook, type SelectedLook } from '../../../layout/detail-sidebar/selection';
import { UiIcon } from '../../../shared/icons/icon';
import { UiIdChip } from '../../../shared/ui/id-chip/id-chip';
import { UiMeter } from '../../../shared/ui/meter/meter';
import { UiTerm } from '../../../shared/ui/term/term';
import { planningCounts } from '../planning-counts';
import { buildTree, pathTo, type TreeKind, type TreeNode } from './tree-nodes';

/** The tree's levels in cascade order, each with its glossary term (ISC-107's `terms.*` hints). */
const LEVELS = [
  { id: 'milestones', term: 'terms.milestone' },
  { id: 'features', term: 'terms.feature' },
  { id: 'specs', term: 'terms.spec' },
  { id: 'claims', term: 'terms.claim' },
] as const;

/** One visible row: the node, where it stands, and the state the template binds without calling back. */
interface TreeRow {
  readonly node: TreeNode;
  readonly kind: TreeKind;
  readonly key: string;
  readonly parentKey: string | null;
  readonly level: number;
  /** One entry per guide line left of the row (`level - 1`). */
  readonly guides: readonly number[];
  readonly expandable: boolean;
  readonly open: boolean;
  readonly look: SelectedLook | null;
  readonly full: boolean;
}

/**
 * The tree lens (spec 026, `/w/:ws/planning/tree`, ISC-168): the cascade Milestone › Feature › Spec › Claim as one
 * WAI-ARIA tree, every number the relation index's own (`buildTree`). Milestones open and features closed by default,
 * the path to `?sel=` open on top and scrolled into view; each row has two targets, the chevron toggles and the rest
 * selects (`DetailSelection.select`). The rows are flat treeitems with `aria-level`, a 16 px indent per level and a
 * 1 px guide line per ancestor; one row holds the roving tab stop, the arrow keys move along the visible rows, Right
 * and Left open, close or step to the child or parent, Enter and Space select. The level headings above keep their
 * glossary hints (ISC-167). The tree is the lens with a rail: it docks the detail sidebar there at wide for its
 * lifetime, so switching to the matrix or the graph undocks it.
 */
@Component({
  selector: 'app-planning-tree',
  imports: [TranslocoPipe, UiIcon, UiIdChip, UiMeter, UiTerm],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-lens': 'tree' },
  styleUrls: ['./planning-tree.css', '../../../layout/detail-sidebar/selection.css'],
  templateUrl: './planning-tree.html',
})
export class PlanningTree {
  readonly model = input.required<PlanningModel>();

  private readonly selection = inject(DetailSelection);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  protected readonly hasMilestones = computed(() => this.model().milestones.length > 0);
  protected readonly levels = computed(() => (this.hasMilestones() ? LEVELS : LEVELS.filter((level) => level.id !== 'milestones')));
  protected readonly counts = computed(() => {
    const counts = planningCounts(this.model());
    return {
      milestones: String(counts.milestones),
      features: String(counts.features),
      specs: String(counts.specs),
      claims: `${String(counts.closed)}/${String(counts.total)}`,
    };
  });

  private readonly roots = computed(() => buildTree(this.model()));
  private readonly path = computed(() => pathTo(this.roots(), this.selection.selected()));
  /** What the user opened or closed by hand, by row key; wins over the default and the selection's path. */
  private readonly overrides = signal<ReadonlyMap<string, boolean>>(new Map());
  /** The row holding the roving tab stop once the user moved it. */
  private readonly focusKey = signal<string | null>(null);

  protected readonly rows = computed<readonly TreeRow[]>(() => {
    const overrides = this.overrides();
    const path = this.path();
    const out: TreeRow[] = [];
    const visit = (node: TreeNode, level: number, parentKey: string | null): void => {
      const expandable = node.children.length > 0;
      const byDefault = node.kind === 'milestone' || node.kind === 'group' || path.has(node.key);
      const open = expandable && (overrides.get(node.key) ?? byDefault);
      out.push({
        node,
        kind: node.kind,
        key: node.key,
        parentKey,
        level,
        guides: Array.from({ length: level - 1 }, (_, i) => i),
        expandable,
        open,
        look: node.ref === null ? null : selectedLook(this.selection, node.ref, 'row'),
        full: node.total > 0 && node.closed === node.total,
      });
      if (open) for (const child of node.children) visit(child, level + 1, node.key);
    };
    for (const root of this.roots()) visit(root, 1, null);
    return out;
  });

  /** The row with the tab stop: the one the user moved to, else the selected one, else the first. */
  protected readonly tabStop = computed(() => {
    const rows = this.rows();
    const moved = this.focusKey();
    if (moved !== null && rows.some((row) => row.key === moved)) return moved;
    return rows.find((row) => row.look !== null)?.key ?? rows.at(0)?.key ?? null;
  });

  private readonly expandableKeys = computed(() => {
    const keys: string[] = [];
    const walk = (node: TreeNode): void => {
      if (node.children.length > 0) keys.push(node.key);
      node.children.forEach(walk);
    };
    this.roots().forEach(walk);
    return keys;
  });
  protected readonly allOpen = computed(() => {
    const open = new Set(this.rows().filter((row) => row.open).map((row) => row.key));
    return this.expandableKeys().every((key) => open.has(key));
  });

  constructor() {
    this.selection.dock(inject(DestroyRef));
    // A deep link (or a selection made elsewhere) opens the path above; once rendered, the row scrolls into view.
    effect(() => {
      const ref = this.selection.selected();
      if (ref === null) return;
      afterNextRender(
        () => {
          const row = this.rowOf(ref);
          // A DOM emulation may lack scrollIntoView; the browser always has it.
          if (row !== null && 'scrollIntoView' in row) row.scrollIntoView({ block: 'nearest' });
        },
        { injector: this.injector },
      );
    });
  }

  protected toggle(row: TreeRow, event?: Event): void {
    event?.stopPropagation();
    if (!row.expandable) return;
    this.setOpen(row.key, !row.open);
  }

  protected toggleAll(): void {
    const open = !this.allOpen();
    this.overrides.set(new Map(this.expandableKeys().map((key) => [key, open])));
  }

  /** The row's own target: select its object; the group, which has none, toggles. */
  protected activate(row: TreeRow): void {
    this.focusKey.set(row.key);
    if (row.node.ref === null) this.toggle(row);
    else void this.selection.select(row.node.ref);
  }

  protected onKey(event: KeyboardEvent): void {
    const rows = this.rows();
    const key = (event.target as HTMLElement | null)?.closest<HTMLElement>('[role="treeitem"]')?.dataset['key'];
    const at = rows.findIndex((row) => row.key === key);
    const row = rows[at];
    if (at < 0) return;
    let next: TreeRow | undefined;
    switch (event.key) {
      case 'ArrowDown':
        next = rows[at + 1];
        break;
      case 'ArrowUp':
        next = rows[at - 1];
        break;
      case 'Home':
        next = rows[0];
        break;
      case 'End':
        next = rows.at(-1);
        break;
      case 'ArrowRight':
        if (row.expandable && !row.open) this.setOpen(row.key, true);
        else if (row.open) next = rows[at + 1];
        break;
      case 'ArrowLeft':
        if (row.open) this.setOpen(row.key, false);
        else next = rows.find((candidate) => candidate.key === row.parentKey);
        break;
      case 'Enter':
      case ' ':
        this.activate(row);
        break;
      default:
        return;
    }
    event.preventDefault();
    if (next !== undefined) this.moveTo(next.key);
  }

  private setOpen(key: string, open: boolean): void {
    this.overrides.update((map) => new Map(map).set(key, open));
  }

  private moveTo(key: string): void {
    this.focusKey.set(key);
    this.host.nativeElement.querySelector<HTMLElement>(`[role="treeitem"][data-key="${CSS.escape(key)}"]`)?.focus();
  }

  private rowOf(ref: RelationRef): HTMLElement | null {
    return this.host.nativeElement.querySelector<HTMLElement>(`[role="treeitem"]${refSelector(ref)}`);
  }
}

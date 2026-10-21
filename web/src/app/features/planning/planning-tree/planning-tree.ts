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
  linkedSignal,
  model,
  signal,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { CDK_DRAG_CONFIG, CdkDrag, type CdkDragDrop, CdkDragHandle, type CdkDragMove, CdkDropList } from '@angular/cdk/drag-drop';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import type { Priority } from '../../../../../../core/src/files';
import type { PlanningModel } from '../../../../../../core/src/planning';
import type { RelationRef } from '../../../../../../core/src/relations';
import { DetailSelection, refSelector, selectedLook, type SelectedLook } from '../../../layout/detail-sidebar/selection';
import { UiIcon } from '../../../shared/icons/icon';
import { UiTime } from '../../../shared/time';
import { UiIdChip } from '../../../shared/ui/id-chip/id-chip';
import { UiMeter } from '../../../shared/ui/meter/meter';
import { UiTerm } from '../../../shared/ui/term/term';
import { UiLiveRegion } from '../../../shared/ui/live-region/live-region';
import { RefusalNotice } from '../../../shared/ui/refusal-notice/refusal-notice';
import { ShellState } from '../../../layout/shell/shell-state.service';
import { beforeFor, edgeBefore, groupOf, positionOf, stepBefore, type Target } from '../../../core/model/backlog-order';
import { featureOrder } from '../../../core/model/feature-order';
import { BacklogWriter, withBacklog } from '../../../layout/shell/backlog-writer.service';
import { PriorityMenu } from '../../../layout/backlog-menu/priority-menu';
import { ReorderMenu, type ReorderStep } from '../../../layout/backlog-menu/reorder-menu';
import { BOARD_DRAG_CONFIG } from '../../../shared/ui/drag-config';
import { hasArchivedSpecs, planningCounts } from '../../../core/model/planning-counts';
import { buildTree, hasDoneOrEmpty, pathTo, withoutDoneAndEmpty, type TreeKind, type TreeNode } from './tree-nodes';

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
  /** A feature's move group (`featureOrder` key): its milestone's row key, or `group`; null for every other kind. */
  readonly group: string | null;
}

/** Where the drop line of a drag stands: before or after a feature row of the dragged one's group. */
interface DropMark {
  readonly key: string;
  readonly side: 'before' | 'after';
}

/**
 * The tree lens (spec 026, `/w/:ws/planning/tree`, ISC-168): the cascade Milestone › Feature › Spec › Claim as one
 * WAI-ARIA tree, every number the relation index's own (`buildTree`). Milestones open and features closed by default,
 * the path to `?sel=` open on top and scrolled into view; each row has two targets, the chevron toggles and the rest
 * selects (`DetailSelection.select`). The rows are flat treeitems with `aria-level`, a 16 px indent per level and a
 * 1 px guide line per ancestor; one row holds the roving tab stop, the arrow keys move along the visible rows, Right
 * and Left open, close or step to the child or parent, Enter and Space select. The level headings above keep their
 * glossary hints (ISC-167). Archived specs stay hidden until the archive toggle shows them; the page shares that
 * toggle across its lenses (`archived`, two-way). A second toggle, the tree's own, hides the specs on done and the
 * features without an open spec row, so the open work stands together (`hideEmpty`, spec 046). The tree is the lens with a rail: it docks the detail sidebar there at wide for its
 * lifetime, so switching to the Gantt or the graph undocks it.
 */
@Component({
  selector: 'app-planning-tree',
  imports: [CdkDrag, CdkDragHandle, CdkDropList, PriorityMenu, RefusalNotice, ReorderMenu, TranslocoPipe, UiIcon, UiIdChip, UiLiveRegion, UiMeter, UiTerm, UiTime],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // The board's drag delays (touch after 350 ms, mouse after 4 px): one feel for every grip of the app (spec 037).
  providers: [{ provide: CDK_DRAG_CONFIG, useValue: BOARD_DRAG_CONFIG }],
  host: { 'data-lens': 'tree' },
  styleUrls: ['./planning-tree.css', '../../../layout/detail-sidebar/selection.css'],
  templateUrl: './planning-tree.html',
})
export class PlanningTree {
  readonly model = input.required<PlanningModel>();
  /** Archived specs shown (the archive toggle), off by default. */
  readonly archived = model(false);

  private readonly selection = inject(DetailSelection);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  protected readonly writer = inject(BacklogWriter);
  private readonly shell = inject(ShellState);
  private readonly transloco = inject(TranslocoService);
  private readonly lang = toSignal(this.transloco.langChanges$, { initialValue: this.transloco.getActiveLang() });
  private readonly live = viewChild(UiLiveRegion);
  private readonly menu = viewChild(ReorderMenu);

  /** The feature a drop holds at its target until the route answers (design decision 3); null otherwise. */
  private readonly dragHeld = signal<string | null>(null);
  /** The group a drag lifted a feature of: every feature row shows its head only while it lasts. */
  protected readonly dragGroup = signal<string | null>(null);
  /** The drop line during a drag; `none` over a position that is no drop target (another milestone or group). */
  protected readonly dropAt = signal<DropMark | 'none' | null>(null);
  /** The row a move just landed, for the confirmation: a tint that fades, a static dot under reduced motion (ISC-200.1). */
  protected readonly moved = signal<string | null>(null);
  /** The feature row whose grip opened "Move". */
  private readonly menuRow = signal<TreeRow | null>(null);

  /** The model the rows show: the input with the drop held at its target while the route has not answered. */
  private readonly shown = computed(() => {
    const model = this.model();
    const held = this.dragHeld();
    const op = held === null ? undefined : this.writer.held().get(held);
    return op === undefined ? model : withBacklog(model, [op]);
  });
  /** The features per milestone and group in rank order, the move groups of the grip, the keys and the menus. */
  private readonly order = computed(() => featureOrder(this.shown()));

  protected readonly hasArchived = computed(() => hasArchivedSpecs(this.model()));
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

  /** Specs on done and features without an open spec hidden (the done-and-empty toggle, spec 046), off by default; the tree's own. */
  protected readonly hideEmpty = signal(false);
  private readonly fullRoots = computed(() => buildTree(this.shown(), this.archived()));
  /** Offered while the tree shows a done spec or an empty feature, and kept while it hides them so the toggle can turn back. */
  protected readonly hasEmpty = computed(() => this.hideEmpty() || hasDoneOrEmpty(this.fullRoots()));
  private readonly roots = computed(() => (this.hideEmpty() ? withoutDoneAndEmpty(this.fullRoots()) : this.fullRoots()));
  /**
   * The rows the selection opens: the path to the selected object, kept when the selection closes, so the row Escape
   * returns focus to is still rendered (ISC-171).
   */
  private readonly path = linkedSignal<ReadonlySet<string>, ReadonlySet<string>>({
    source: computed(() => pathTo(this.roots(), this.selection.selected())),
    computation: (path, previous) => (path.size === 0 && this.selection.selected() === null && previous ? previous.value : path),
  });
  /** What the user opened or closed by hand, by row key; wins over the default and the selection's path. */
  private readonly overrides = signal<ReadonlyMap<string, boolean>>(new Map());
  /** The row holding the roving tab stop once the user moved it. */
  private readonly focusKey = signal<string | null>(null);

  protected readonly rows = computed<readonly TreeRow[]>(() => {
    const overrides = this.overrides();
    const path = this.path();
    const lifted = this.dragGroup() !== null;
    const out: TreeRow[] = [];
    const visit = (node: TreeNode, level: number, parentKey: string | null): void => {
      const expandable = node.children.length > 0;
      const byDefault = node.kind === 'milestone' || node.kind === 'group' || path.has(node.key);
      // While a feature is dragged, every feature shows its head only, so each gap is a feature boundary.
      const open = expandable && !(lifted && node.kind === 'feature') && (overrides.get(node.key) ?? byDefault);
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
        group: node.kind === 'feature' ? (parentKey ?? 'group') : null,
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
    const destroyRef = inject(DestroyRef);
    this.selection.dock(destroyRef);
    destroyRef.onDestroy(() => this.selection.heldFocus.set(null));
    // A deep link (or a selection made elsewhere) opens the path above; once rendered, the row scrolls into view. The
    // selection the tree arrives with, before the user picks a row here (a `?sel=` link, the old `/features#F<n>` and
    // `/milestones#m-<slug>` redirects, ISC-167.1), also takes the focus, and the sidebar leaves it there.
    effect(() => {
      const ref = this.selection.selected();
      if (ref === null) return;
      const arrival = this.arriving;
      this.arriving = false;
      if (arrival) this.selection.heldFocus.set(ref);
      afterNextRender(
        () => {
          const row = this.rowOf(ref);
          if (row === null) return;
          // A DOM emulation may lack scrollIntoView; the browser always has it.
          if ('scrollIntoView' in row) row.scrollIntoView({ block: 'nearest' });
          if (!arrival) return;
          this.focusKey.set(row.dataset['key'] ?? null);
          row.focus({ preventScroll: true });
        },
        { injector: this.injector },
      );
    });
  }

  /** True until the tree sees its first selection or the user picks a row: that selection is the arrival. */
  private arriving = true;

  protected toggle(row: TreeRow, event?: Event): void {
    event?.stopPropagation();
    if (!row.expandable) return;
    this.setOpen(row.key, !row.open);
  }

  protected toggleArchived(): void {
    this.archived.update((on) => !on);
  }

  protected toggleHideEmpty(): void {
    this.hideEmpty.update((on) => !on);
  }

  protected toggleAll(): void {
    const open = !this.allOpen();
    this.overrides.set(new Map(this.expandableKeys().map((key) => [key, open])));
  }

  /** A click on the row selects it, unless it landed on the row's chip or its menu, which are controls of their own. */
  protected onRowClick(row: TreeRow, event: Event): void {
    if ((event.target as HTMLElement | null)?.closest('.prio, .notice')) return;
    this.activate(row);
  }

  /** The row's own target: select its object; the group, which has none, toggles. */
  protected activate(row: TreeRow): void {
    this.arriving = false;
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
    // Alt+↑/↓ moves a feature within its group (ISC-195), at the treeitem and at its grip; it never scrolls the page.
    if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault();
      if (row.kind === 'feature') void this.step(row, event.key === 'ArrowUp' ? 'up' : 'down');
      return;
    }
    // The grip and the chip are buttons: Enter and Space are theirs, not the row's.
    if ((event.key === 'Enter' || event.key === ' ') && event.target !== event.currentTarget) return;
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

  /** The "Move" menu's state for the feature whose grip opened it: its group's name and where it stands. */
  protected readonly menuState = computed(() => {
    const row = this.menuRow();
    if (row?.group == null) return null;
    const order = this.order();
    const at = positionOf(order, row.group, row.node.id);
    return {
      feature: row.node.id,
      group: groupOf(order, row.group)?.name ?? null,
      canUp: at !== null && at.index > 1,
      canDown: at !== null && at.index < at.count,
      position: at?.index ?? null,
      count: at?.count ?? null,
    };
  });

  /** The name of the feature's milestone, for the grip's name; empty for the group. */
  protected menuGroupName(row: TreeRow): string {
    return row.group === null ? '' : (groupOf(this.order(), row.group)?.name ?? '');
  }

  /** A plain click on the grip (no drag) opens "Move" (WCAG 2.5.7), anchored to the grip. */
  protected openMenu(row: TreeRow, grip: HTMLElement, event: Event): void {
    event.stopPropagation();
    this.focusKey.set(row.key);
    this.menuRow.set(row);
    this.menu()?.show(grip);
  }

  protected onStep(step: ReorderStep): void {
    const row = this.menuRow();
    if (row !== null) void this.step(row, step);
  }

  /** T23 · ISC-195: one step of the menu or of Alt+↑/↓; at the group's edge nothing is sent, the live region says so. */
  private async step(row: TreeRow, step: ReorderStep): Promise<void> {
    if (row.group === null) return;
    const order = this.order();
    const id = row.node.id;
    const before = step === 'up' || step === 'down' ? stepBefore(order, row.group, id, step === 'up' ? -1 : 1) : edgeBefore(order, row.group, id, step);
    if (before === 'none') {
      this.announce(step === 'up' || step === 'first' ? 'backlog.tree.atFirst' : 'backlog.tree.atLast', row);
      return;
    }
    await this.send(row, before, false);
  }

  /**
   * The move through the backlog writer, only while no other write is in flight. A drop is held at its target until
   * the answer (design decision 3); the keys and the menu move only after the 200. On success the focus stays on the
   * feature and the live region names its new position.
   */
  private async send(row: TreeRow, before: string | null, held: boolean): Promise<void> {
    const ws = this.shell.ws();
    if (ws === null || this.writer.busy()) return;
    if (held) this.dragHeld.set(row.node.id);
    const outcome = await this.writer.move(ws, row.node.id, before);
    if (held) this.dragHeld.set(null);
    if (outcome !== 'written') return;
    this.moved.set(row.key);
    afterNextRender(
      () => {
        this.moveTo(row.key);
        this.announce('backlog.tree.moved', row, true);
      },
      { injector: this.injector },
    );
  }

  /** T30 · ISC-196: the level picked at the chip, through the writer; the chip shows it after the 200. */
  protected async setPriority(row: TreeRow, priority: Priority): Promise<void> {
    const ws = this.shell.ws();
    if (ws === null || this.writer.busy()) return;
    const outcome = await this.writer.priority(ws, row.node.id, priority);
    if (outcome === 'written') this.live()?.announce(this.transloco.translate('backlog.tree.prioritized', { id: row.node.id, level: priority }, this.lang()));
  }

  private announce(key: string, row: TreeRow, plural = false): void {
    if (row.group === null) return;
    const order = this.order();
    const at = positionOf(order, row.group, row.node.id);
    const name = groupOf(order, row.group)?.name ?? null;
    const params = { id: row.node.id, position: at?.index ?? 0, count: at?.count ?? 0, group: name ?? '' };
    const form = plural ? (params.count === 1 ? '.one' : '.other') : '';
    this.live()?.announce(this.transloco.translate(`${name === null ? `${key}None` : key}${form}`, params, this.lang()));
  }

  protected dragStarted(row: TreeRow): void {
    this.moved.set(null);
    this.dragGroup.set(row.group);
    this.dropAt.set(null);
  }

  protected dragMoved(row: TreeRow, event: CdkDragMove<TreeRow>): void {
    this.dropAt.set(this.dropFor(row, event.pointerPosition.y).mark);
  }

  protected dragEnded(): void {
    this.dragGroup.set(null);
    this.dropAt.set(null);
  }

  /** T23 · ISC-195, ISC-195.1: the drop sends the gap's `before`; another group, an edge or a gap beside the row sends nothing. */
  protected dropped(event: CdkDragDrop<unknown, unknown, TreeRow>): void {
    const row = event.item.data;
    const { before } = this.dropFor(row, event.dropPoint.y);
    this.dragEnded();
    if (before !== 'none') void this.send(row, before, true);
  }

  /**
   * The gap under the pointer, measured on the rows of the dragged feature's own group as they stand now (never from
   * cached positions, so a scrolled page or auto-scroll still lands right): a pointer beyond the group's first or last
   * row by half a row is no target. Rows the empty-feature toggle hides are skipped by mapping the shown gap onto the
   * full group, where `beforeFor` refuses a gap beside the feature itself.
   */
  private dropFor(row: TreeRow, y: number): { before: Target; mark: DropMark | 'none' | null } {
    if (row.group === null) return { before: 'none', mark: null };
    const seen = new Map<string, DOMRect>();
    for (const el of this.host.nativeElement.querySelectorAll<HTMLElement>(`[role="treeitem"][data-kind="feature"][data-group="${CSS.escape(row.group)}"]`)) {
      const rect = el.getBoundingClientRect();
      const key = el.dataset['key'];
      if (key !== undefined && rect.height > 0 && !el.classList.contains('cdk-drag-preview')) seen.set(key, rect);
    }
    const shown = this.rows().filter((candidate) => candidate.group === row.group && seen.has(candidate.key));
    const rects = shown.map((candidate) => seen.get(candidate.key) as DOMRect);
    const first = rects.at(0);
    const last = rects.at(-1);
    if (first === undefined || last === undefined) return { before: 'none', mark: null };
    if (y < first.top - first.height / 2 || y > last.bottom + last.height / 2) return { before: 'none', mark: 'none' };
    const gap = rects.filter((rect) => rect.top + rect.height / 2 < y).length;
    const ids = groupOf(this.order(), row.group)?.ids ?? [];
    const lastShown = shown.at(-1)?.node.id;
    const target = shown.at(gap)?.node.id ?? (lastShown === undefined ? null : (ids.at(ids.indexOf(lastShown) + 1) ?? null));
    const before = beforeFor(this.order(), row.group, row.node.id, target === null ? ids.length : ids.indexOf(target));
    if (before === 'none') return { before, mark: null };
    const mark: DropMark = gap < shown.length ? { key: shown[gap]?.key ?? '', side: 'before' } : { key: shown.at(-1)?.key ?? '', side: 'after' };
    return { before, mark };
  }

  /** The drop line's side on this row, if it stands there. */
  protected dropSide(row: TreeRow): 'before' | 'after' | null {
    const at = this.dropAt();
    return at !== null && at !== 'none' && at.key === row.key ? at.side : null;
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

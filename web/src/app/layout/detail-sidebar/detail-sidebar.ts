import { NgTemplateOutlet } from '@angular/common';
import {
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  computed,
  DOCUMENT,
  ElementRef,
  inject,
  input,
  linkedSignal,
  untracked,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import type { ItemStateInfo } from '../../../../../core/src/files';
import type { Relation, RelationRef } from '../../../../../core/src/relations';
import { boardRowsOf } from '../../core/model/board-rows';
import { UiIcon } from '../../shared/icons/icon';
import type { IconName } from '../../shared/icons/icons';
import { UiButton } from '../../shared/ui/button/button';
import { UiIconButton } from '../../shared/ui/button/icon-button';
import { UiChip } from '../../shared/ui/chip/chip';
import { UiItemState } from '../../shared/ui/item-state/item-state';
import { RELATION_ICON } from '../../shared/ui/chip/chip-icons';
import { nextId } from '../../shared/ui/overlay/ids';
import { UiSheet } from '../../shared/ui/overlay/sheet';
import { UiRing } from '../../shared/ui/ring/ring';
import { UiStarToggle } from '../../shared/ui/star-toggle/star-toggle';
import { releasableRun } from '../run-release/run-release';
import { specLink } from '../shell/areas';
import { ShellData } from '../shell/shell-data.service';
import { ShellState } from '../shell/shell-state.service';
import { IdeaFacts } from './idea-facts';
import { PlanningFacts } from './planning-facts';
import { CHILD_CAP, DetailSelection, relationAt, SEL_PARAM, sidebarParents } from './selection';
import { SidebarActions } from './sidebar-actions';
import { SidebarTasks } from './sidebar-tasks';
import { SpecFacts, specFactsRowOf, type SpecFactsRow } from './spec-facts';

/** Where an instance sits: `rail` inside `app-rail-slot` (the docked presentation), `float` mounted once by the shell. */
export type SidebarSlot = 'rail' | 'float';

/** One linked entry of a section, resolved against the index. */
interface SidebarLink {
  readonly entry: Relation;
  readonly params: Record<string, string>;
  /** The type icon, or `clock` for an open blocker. */
  readonly icon: IconName;
  readonly blocker: boolean;
}

/** The head's favourite star: which set it writes, the key it stars under there, and whether it is on. */
interface SidebarStar {
  readonly kind: 'spec' | 'idea';
  /** The spec folder (`NNN-slug`) or the story slug. */
  readonly key: string;
  readonly pressed: boolean;
}

/**
 * The detail sidebar (spec 026, T13/T14, ISC-171): one component for every planning object and every view. It takes
 * no object as input; it reads `?sel=` through `DetailSelection` and looks the entry up in the planning model's
 * relation index, so a reload shows the same sidebar. Header (neutral type chip, mono id, title, progress, the spec's
 * stage or the archived chip), then Parents, Children (five, “+N more”) and Blockers, every entry a link that selects
 * it, and a footer with “Open spec” for a spec or a claim and Close.
 *
 * Three presentations by the shell's container tier (`presentationFor`), only the shell around the content changes:
 * docked in the rail slot at wide on a docking page (`slot="rail"`), else (`slot="float"`) a floating panel at wide,
 * a non-modal overlay from the right at medium (no scrim, no focus trap), and a modal bottom sheet (`ui-sheet`) at
 * compact. Escape closes in each and returns focus to the selected object's `[data-ref]` element; the selection
 * contract the views follow is in `selection.ts`.
 *
 * Spec 040 (T62, ISC-226): a spec or story whose run is open shows its state line under the header, in every
 * presentation, the compact sheet included; its "Release run" (`app-run-release`) moved into the actions grid
 * (`app-sidebar-actions`, spec 067), which follows the facts, then the open tasks (`app-sidebar-tasks`). The state is
 * the API's: the dashboard row's `state` for a spec, the planning tree's for a story. The API serves an item's newest
 * open run only, so the section holds one button, for that run.
 */
@Component({
  selector: 'app-detail-sidebar',
  imports: [IdeaFacts, NgTemplateOutlet, PlanningFacts, RouterLink, SidebarActions, SidebarTasks, SpecFacts, TranslocoPipe, UiButton, UiChip, UiIcon, UiIconButton, UiItemState, UiRing, UiSheet, UiStarToggle],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './detail-sidebar.html',
  styleUrl: './detail-sidebar.css',
  host: {
    'data-ui': 'detail-sidebar',
    '[attr.data-presentation]': 'shown() ? presentation() : null',
    '(document:keydown.escape)': 'escape($event)',
  },
})
export class DetailSidebar {
  readonly slot = input<SidebarSlot>('float');

  protected readonly selection = inject(DetailSelection);
  private readonly state = inject(ShellState);
  private readonly data = inject(ShellData);
  private readonly doc = inject(DOCUMENT);

  protected readonly presentation = this.selection.presentation;
  /** This instance's entry: the rail instance shows only the docked presentation, the float one every other. */
  protected readonly shown = computed<Relation | null>(() => {
    const presentation = this.presentation();
    if (presentation === null) return null;
    return (presentation === 'docked') === (this.slot() === 'rail') ? this.selection.entry() : null;
  });

  protected readonly titleId = nextId('detail-sidebar-title');
  protected readonly typeIcon = computed(() => {
    const entry = this.shown();
    return entry ? RELATION_ICON[entry.type] : 'file-text';
  });
  protected readonly percent = computed(() => {
    const entry = this.shown();
    return entry && entry.total > 0 ? (entry.closed / entry.total) * 100 : null;
  });

  protected readonly parents = computed(() => {
    const entry = this.shown();
    const index = this.selection.index();
    return entry && index ? this.links(sidebarParents(index, entry)) : [];
  });
  protected readonly children = computed(() => {
    const entry = this.shown();
    return entry ? this.links(entry.children) : [];
  });
  protected readonly blockers = computed(() => {
    const entry = this.shown();
    return entry ? this.links(entry.blockers, true) : [];
  });
  /** Reset to five rows whenever another object is selected. */
  protected readonly allChildren = linkedSignal({ source: this.selection.selected, computation: () => false });
  protected readonly visibleChildren = computed(() => (this.allChildren() ? this.children() : this.children().slice(0, CHILD_CAP)));
  protected readonly hiddenChildren = computed(() => this.children().length - this.visibleChildren().length);
  /** Spec and claim carry edges; their empty Blockers section says so instead of disappearing. */
  protected readonly blockable = computed(() => this.shown()?.type === 'spec' || this.shown()?.type === 'claim');

  /**
   * Spec 067 (T16, ISC-528): the shown spec's active dashboard row, which its facts read; null for every other type,
   * an archived spec and before the dashboard answers, and the shell then shows its own stage chip and progress.
   */
  protected readonly specRow = computed<SpecFactsRow | null>(() => {
    const entry = this.shown();
    const result = this.data.dashboard.value();
    return entry?.type === 'spec' && !entry.archived && result?.kind === 'ok' ? specFactsRowOf(result.body, entry.id) : null;
  });

  /** The shown spec's or story's item while a run line's run is open on it (T62); null otherwise. */
  protected readonly running = computed<ItemStateInfo | null>(() => {
    const entry = this.shown();
    if (entry?.type === 'spec') {
      const result = this.data.dashboard.value();
      const row = result?.kind === 'ok' ? boardRowsOf(result.body).find((r) => r.id === entry.id) : undefined;
      return releasableRun(row?.state) ? (row?.state ?? null) : null;
    }
    if (entry?.type === 'idea') {
      const state = this.ideaItem();
      return releasableRun(state) ? state : null;
    }
    return null;
  });
  /** The shown story's item state as the planning tree serves it (its next step, its run); null for every other type. */
  protected readonly ideaItem = computed<ItemStateInfo | null>(() => {
    const entry = this.shown();
    return entry?.type === 'idea' ? (this.data.ideas().find((idea) => idea.slug === entry.id)?.state ?? null) : null;
  });
  protected readonly ws = computed(() => this.state.ws() ?? '');

  /** The spec page a spec, or a claim through its holding spec, opens; null for the other types. */
  protected readonly specPage = computed(() => {
    const entry = this.shown();
    const ws = this.state.ws();
    if (!entry || ws === null) return null;
    if (entry.type === 'spec') return specLink(ws, entry.id);
    const spec = entry.type === 'claim' ? entry.parents.find((ref) => ref.startsWith('spec:')) : undefined;
    return spec ? specLink(ws, spec.slice('spec:'.length)) : null;
  });

  /** The idea page an idea opens from the foot (ISC-486): at compact the sheet covers the row, so this link leads there. */
  protected readonly ideaPage = computed(() => {
    const entry = this.shown();
    const ws = this.state.ws();
    return entry?.type === 'idea' && ws !== null ? ['/w', ws, 'ideas', entry.id] : null;
  });

  /**
   * Spec 067 (T25, ISC-532): the head's star for a spec or an idea, null for every other type. It reads and writes the
   * favourites `ShellData` holds, so the dashboard row, the idea row and the header select show the same state at
   * once. A spec stars under its folder (`NNN-slug`) from the dashboard row; an archived spec carries no star, as its
   * row does, nor does a spec whose folder no row names yet.
   */
  protected readonly star = computed<SidebarStar | null>(() => {
    const entry = this.shown();
    if (entry?.type === 'spec' && !entry.archived) {
      const key = this.data.specRows().find((row) => row.id === entry.id)?.slug;
      return key === undefined ? null : { kind: 'spec', key, pressed: this.data.isFavorite(key) };
    }
    return entry?.type === 'idea' ? { kind: 'idea', key: entry.id, pressed: this.data.isIdeaFavorite(entry.id) } : null;
  });

  private readonly title = viewChild<ElementRef<HTMLElement>>('title');
  private readonly actions = viewChild(SidebarActions);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  constructor() {
    // A new selection moves focus to the title in the non-modal presentations (the sheet's dialog focuses it itself),
    // unless the view holds the focus on the object's own element (the tree's arrival row, ISC-167.1). Only a ref
    // change moves it: a live refresh after a write (a stage change, a ticked task, a release) re-renders the same
    // ref and leaves the focus where the write left it (spec 067, T36, ISC-537).
    let focused: RelationRef | null = null;
    afterRenderEffect(() => {
      const entry = this.shown();
      const title = this.title();
      if (!entry || !title || this.presentation() === 'sheet' || entry.ref === focused) return;
      focused = entry.ref;
      if (untracked(this.selection.heldFocus) === entry.ref) return;
      title.nativeElement.focus({ preventScroll: true });
    });
  }

  protected close(): void {
    void this.selection.close();
  }

  /**
   * Escape in one order (spec 067, T36, ISC-537): an open dialog first (the release question stacks over every shell
   * and closes itself), then the open stage list, wherever the focus sits in the panel, then the sidebar. The sheet's
   * own dialog closes the compact presentation; the others close here, and any open popover wins. The panel listens
   * itself, so an Escape inside the sheet arrives here before the sheet's dialog, which skips a prevented one
   * (`modalDialog`); the document listener takes an Escape pressed on the page.
   */
  protected escape(event: Event): void {
    if (!this.shown() || event.defaultPrevented) return;
    const sheet = this.host.nativeElement.querySelector('ui-sheet dialog');
    if ([...this.doc.querySelectorAll('dialog[open]')].some((dialog) => dialog !== sheet)) return;
    if (this.actions()?.closeList()) {
      event.preventDefault();
      return;
    }
    if (this.presentation() === 'sheet' || this.openPopover()) return;
    event.preventDefault();
    this.close();
  }

  protected toggleStar(star: SidebarStar): void {
    void (star.kind === 'spec' ? this.data.toggleFavorite(star.key) : this.data.toggleIdeaFavorite(star.key));
  }

  protected sheetChange(open: boolean): void {
    if (!open) this.close();
  }

  private openPopover(): boolean {
    try {
      return this.doc.querySelector(':popover-open') !== null;
    } catch {
      return false;
    }
  }

  private links(refs: readonly RelationRef[], blocker = false): readonly SidebarLink[] {
    const index = this.selection.index();
    if (!index) return [];
    return refs.flatMap((ref) => {
      const entry = relationAt(index, ref);
      return entry ? [{ entry, params: { [SEL_PARAM]: ref }, icon: blocker ? 'clock' : RELATION_ICON[entry.type], blocker }] : [];
    });
  }
}

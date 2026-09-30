import {
  afterNextRender,
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  Injector,
  signal,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import type { PlanningFeature, PlanningHolder } from '../../../../../core/src/planning';
import { NotFound } from '../../layout/not-found/not-found';
import { ShellData } from '../../layout/shell/shell-data.service';
import { ShellState } from '../../layout/shell/shell-state.service';
import { UiIcon } from '../../shared/icons/icon';
import { UiButton } from '../../shared/ui/button/button';
import { UiCard } from '../../shared/ui/card/card';
import { UiEmptyState } from '../../shared/ui/empty-state/empty-state';
import { UiMeter } from '../../shared/ui/meter/meter';
import { UiSkeleton } from '../../shared/ui/skeleton/skeleton';
import { UiTerm } from '../../shared/ui/term/term';
import { fragmentTarget, installArrival, planningPageState, stagesByRow } from './planning-page';
import { SpecChip } from './spec-chip';

/** Past this many holders a compact row shows `COLLAPSED` chips and a "+n more" button (design § Mobile). */
const CHIP_LIMIT = 4;
const COLLAPSED = 3;

/** Main holder first, archived last (design § Features page, ISC-100.1 / ISC-100.3); core's order within each rank. */
const rank = (holder: PlanningHolder): number => (holder.archived ? 2 : holder.main ? 0 : 1);

interface ChipView {
  readonly holder: PlanningHolder;
  /** The holder's own main block, for the accessible name of an `other` chip. */
  readonly mainFeature: string | null;
}

interface RowView {
  readonly feature: PlanningFeature;
  readonly chips: readonly ChipView[];
  readonly complete: boolean;
}

const toggled = (set: ReadonlySet<string>, id: string): ReadonlySet<string> => {
  const next = new Set(set);
  if (!next.delete(id)) next.add(id);
  return next;
};

/**
 * `/w/:ws/features` (spec 003, ISC-103; design.md § Features page at every viewport): one card per feature block of
 * the master, in master order, with its progress across every spec holding its claims, those specs as chips and the
 * claims no spec holds. Every number is the planning tree's as served (`core/src/planning.ts`); nothing is recounted
 * here. The H1 carries `id` and `tabindex="-1"` like the spec list's, and each card's `<article>` is the `#F2` target
 * the breadcrumb and the palette land on: the router's fragment scrolls to it, focuses it and plays the arrival outline.
 *
 * Wide lays a row out as two stacks (`minmax(0,1fr) 240px`); medium and compact dissolve the stacks into one column
 * with the fraction on the heading's row and the meter at full width. Tiers come from `ShellState.tier()` as
 * `data-tier`, like the spec head.
 */
@Component({
  selector: 'app-features-page',
  imports: [TranslocoPipe, NotFound, UiButton, UiCard, UiEmptyState, UiIcon, UiMeter, UiSkeleton, UiTerm, SpecChip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-page': 'features', '[attr.data-tier]': 'tier()' },
  templateUrl: './features-page.html',
  styleUrl: './features-page.css',
})
export class FeaturesPage {
  protected readonly state = inject(ShellState);
  protected readonly data = inject(ShellData);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly injector = inject(Injector);

  protected readonly name = computed(() => this.data.workspaceName(this.state.ws() ?? ''));
  protected readonly tier = this.state.tier;
  protected readonly wide = computed(() => this.tier() === 'wide');
  protected readonly compact = computed(() => this.tier() === 'compact');

  private readonly pageState = planningPageState(this.data);
  protected readonly missing = this.pageState.missing;
  protected readonly unavailable = this.pageState.unavailable;
  protected readonly model = this.data.planningModel;

  private readonly stages = computed(() => stagesByRow(this.data.specRows()));
  /** Each spec's main block: the feature under which its holder entry carries `main`. */
  private readonly mainOf = computed(() => {
    const map = new Map<string, string>();
    for (const feature of this.model()?.features ?? []) {
      for (const holder of feature.holders) if (holder.main) map.set(holder.id, feature.id);
    }
    return map;
  });

  protected readonly rows = computed<readonly RowView[]>(() => {
    const stages = this.stages();
    const mainOf = this.mainOf();
    return (this.model()?.features ?? []).map((feature) => ({
      feature,
      complete: feature.total > 0 && feature.closed === feature.total,
      chips: feature.holders
        .map((holder, index) => ({ holder, index }))
        .sort((a, b) => rank(a.holder) - rank(b.holder) || a.index - b.index)
        .map(({ holder }) => ({
          holder: holder.archived ? holder : { ...holder, stage: stages.get(holder.id) ?? holder.stage },
          mainFeature: mainOf.get(holder.id) ?? null,
        })),
    }));
  });

  /** The master's recount (ISC-100.2); null only without a master, where no row renders and the sum is 0/0 anyway. */
  protected readonly recount = computed(() => this.model()?.recount ?? { closed: 0, total: 0 });
  protected readonly unheld = computed(() => this.rows().reduce((sum, row) => sum + row.feature.unheld.length, 0));

  /** Rows whose chip list was expanded past the compact limit. */
  protected readonly chipsOpen = signal<ReadonlySet<string>>(new Set());
  /** Rows whose Why line is expanded at compact, and rows whose two-line clamp actually cuts it. */
  protected readonly whyOpen = signal<ReadonlySet<string>>(new Set());
  protected readonly whyCut = signal<ReadonlySet<string>>(new Set());

  protected readonly target = fragmentTarget();

  constructor() {
    // Scroll to and focus the row the fragment names once it is rendered; a later fragment lands again.
    installArrival(this.host, this.target, () => this.rows());
    // The Why "more" disclosure shows only at compact and only where the two-line clamp cuts the line (spec head idiom).
    afterRenderEffect(() => {
      this.rows();
      const open = this.whyOpen();
      if (!this.compact()) return;
      const cut = new Set<string>();
      for (const el of this.host.querySelectorAll<HTMLElement>('p.why[data-feature]')) {
        const id = el.dataset['feature'] ?? '';
        if (!open.has(id) && el.scrollHeight > el.clientHeight + 1) cut.add(id);
      }
      const before = this.whyCut();
      if (cut.size !== before.size || [...cut].some((id) => !before.has(id))) this.whyCut.set(cut);
    });
  }

  protected visibleChips(row: RowView): readonly ChipView[] {
    const collapsed = this.compact() && row.chips.length > CHIP_LIMIT && !this.chipsOpen().has(row.feature.id);
    return collapsed ? row.chips.slice(0, COLLAPSED) : row.chips;
  }

  /** Expands the row's chips in place and moves focus to the first chip it revealed, as the button leaves. */
  protected showAllChips(id: string): void {
    this.chipsOpen.update((set) => new Set(set).add(id));
    afterNextRender(
      () => {
        const revealed = [...this.host.querySelectorAll<HTMLElement>(`article[id="${CSS.escape(id)}"] ul.holders a`)];
        revealed.at(COLLAPSED)?.focus();
      },
      { injector: this.injector },
    );
  }

  protected toggleWhy(id: string): void {
    this.whyOpen.update((set) => toggled(set, id));
  }
}

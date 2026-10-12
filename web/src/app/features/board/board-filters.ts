import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { type FilterOption, UiFilterChips } from '../../shared/ui/filter-chips/filter-chips';
import { type SegmentedOption, UiSegmented } from '../../shared/ui/segmented/segmented';
import {
  BOARD_FILTER_KEYS,
  BOARD_GROUPS,
  type BoardFilterKey,
  type BoardGroup,
  type BoardModel,
  type BoardQueryState,
  cardFilterValue,
  NO_FEATURE,
  NO_MILESTONE,
  UNASSIGNED,
} from './board-model';

/** The chip that clears one filter key ("All"); no filter value is blank, so it never collides. */
export const ALL = '';

/** One filter value the chips offer: the value the query carries and how many cards on the board hold it. */
export interface FilterValue {
  readonly value: string;
  readonly count: number;
}

/**
 * The values one filter key offers, in the model's option order (master order for features, target order for
 * milestones, table order for types, id order for assignees), the "none" value (`none` / `unassigned`) last. A value
 * no card holds is left out unless the query selects it, so a chip never filters to nothing by itself and a shared
 * link still shows what it selects.
 */
export function filterValuesOf(board: BoardModel, key: BoardFilterKey): readonly FilterValue[] {
  const counts = new Map<string, number>();
  for (const card of board.cards) {
    const value = cardFilterValue(card, key);
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  const ordered: readonly string[] =
    key === 'feature'
      ? [...board.options.features.map((f) => f.id), NO_FEATURE]
      : key === 'milestone'
        ? [...board.options.milestones, NO_MILESTONE]
        : key === 'type'
          ? board.options.types
          : [...board.options.assignees.map((a) => a.ref.id), UNASSIGNED];
  const selected: readonly string[] = board.query[key];
  const values = [...new Set([...ordered, ...selected])];
  return values.filter((value) => (counts.get(value) ?? 0) > 0 || selected.includes(value)).map((value) => ({ value, count: counts.get(value) ?? 0 }));
}

/**
 * The chip a filter key shows pressed: "All" without a value, the value when exactly one is set, and none when a URL
 * carries several (the model ORs them; the chips pick one, so a click replaces the set).
 */
export function pressedOf(query: BoardQueryState, key: BoardFilterKey): string | undefined {
  const values = query[key];
  return values.length === 0 ? ALL : values.length === 1 ? values[0] : undefined;
}

/** The query with one filter key set to the picked chip (`ALL` clears it); group and column stay. */
export function withFilter(query: BoardQueryState, key: BoardFilterKey, value: string): BoardQueryState {
  return { ...query, [key]: value === ALL ? [] : [value] };
}

/** The query without any filter value; the swimlane group and the visible column are not filters and stay. */
export const withoutFilters = (query: BoardQueryState): BoardQueryState => ({ ...query, feature: [], milestone: [], type: [], assignee: [] });

const isGroup = (value: string): value is BoardGroup => BOARD_GROUPS.some((g) => g === value);

/**
 * The board's filter toolbar (spec 008, T123, ISC-129.1; design 008 § board layout): one `ui-filter-chips` group per
 * filter key (Feature · Milestone · Type · Assignee), the swimlane switch as `ui-segmented` (None · Feature ·
 * Milestone), and while a filter is set "n of m cards" with "Clear filters". It holds no state: every choice is emitted
 * as the whole next query, which the page writes to the URL; the URL is the state.
 */
@Component({
  selector: 'app-board-filters',
  imports: [TranslocoPipe, UiFilterChips, UiSegmented],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { display: grid; gap: 8px; min-inline-size: 0; margin-block-end: 16px; }
    .group { display: grid; grid-template-columns: 96px minmax(0, 1fr); gap: 8px; align-items: center; min-inline-size: 0; }
    .label { color: var(--muted-ink); font-size: 12px; font-weight: 600; line-height: 16px; }
    .lanes { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; min-inline-size: 0; }
    .lanes .group { grid-template-columns: 96px auto; }
    .shown { display: inline-flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 0; color: var(--muted-ink); font-size: 13px; line-height: 20px; }
    .shown span { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
    .clear { color: var(--disp-ink); font-weight: 600; }
    @container shell (width < 640px) {
      .group, .lanes .group { grid-template-columns: minmax(0, 1fr); gap: 4px; }
    }
  `,
  template: `
    @for (key of keys; track key) {
      <div class="group" [attr.data-filter]="key">
        <span class="label" [id]="'filter-' + key">{{ 'board.workspace.filter.' + key | transloco }}</span>
        <ui-filter-chips
          [options]="chips()[key]"
          [value]="pressed(key)"
          [label]="'board.workspace.filter.' + key | transloco"
          (valueChange)="pick(key, $event)"
        />
      </div>
    }
    <div class="lanes">
      <div class="group" data-group>
        <span class="label">{{ 'board.workspace.swimlanes.label' | transloco }}</span>
        <ui-segmented [options]="groupOptions()" [value]="board().query.group" [label]="'board.workspace.swimlanes.label' | transloco" (valueChange)="group($event)" />
      </div>
      @if (board().activeFilters > 0) {
        <p class="shown" data-shown>
          <span>{{ 'board.workspace.filter.shown' | transloco: { shown: board().shown, total: board().total } }}</span>
          <button type="button" class="btn btn-sm btn-ghost clear" data-clear (click)="queryChange.emit(clearAll())">
            {{ 'board.workspace.filter.clearAll' | transloco }}
          </button>
        </p>
      }
    </div>
  `,
})
export class BoardFilters {
  readonly board = input.required<BoardModel>();
  /** The whole next query; the page navigates to it. */
  readonly queryChange = output<BoardQueryState>();

  private readonly transloco = inject(TranslocoService);
  private readonly lang = toSignal(this.transloco.langChanges$, { initialValue: this.transloco.getActiveLang() });

  protected readonly keys = BOARD_FILTER_KEYS;

  protected readonly chips = computed<Readonly<Record<BoardFilterKey, readonly FilterOption[]>>>(() => {
    const lang = this.lang();
    const board = this.board();
    const t = (key: string): string => this.transloco.translate(key, {}, lang);
    const names = new Map(board.options.assignees.map((a) => [a.ref.id, a.name]));
    const labelOf = (key: BoardFilterKey, value: string): string => {
      if (key === 'feature') return value === NO_FEATURE ? t('board.workspace.swimlanes.noFeature') : value;
      if (key === 'milestone') return value === NO_MILESTONE ? t('board.workspace.filter.noMilestone') : value;
      if (key === 'type') return t(`types.${value}`);
      return value === UNASSIGNED ? t('board.workspace.filter.unassigned') : (names.get(value) ?? value);
    };
    const all = t('board.workspace.filter.all');
    const optionsOf = (key: BoardFilterKey): FilterOption[] => [
      { key: ALL, label: all, count: board.total },
      ...filterValuesOf(board, key).map((v) => ({ key: v.value, label: labelOf(key, v.value), count: v.count })),
    ];
    return { feature: optionsOf('feature'), milestone: optionsOf('milestone'), type: optionsOf('type'), assignee: optionsOf('assignee') };
  });

  protected readonly groupOptions = computed<readonly SegmentedOption[]>(() => {
    const lang = this.lang();
    return BOARD_GROUPS.map((g) => ({ key: g, label: this.transloco.translate(`board.workspace.swimlanes.${g}`, {}, lang) }));
  });

  protected pressed(key: BoardFilterKey): string | undefined {
    return pressedOf(this.board().query, key);
  }

  protected pick(key: BoardFilterKey, value: string | undefined): void {
    if (value === undefined) return;
    this.queryChange.emit(withFilter(this.board().query, key, value));
  }

  protected group(value: string | undefined): void {
    if (value === undefined || !isGroup(value) || value === this.board().query.group) return;
    this.queryChange.emit({ ...this.board().query, group: value });
  }

  protected clearAll(): BoardQueryState {
    return withoutFilters(this.board().query);
  }
}

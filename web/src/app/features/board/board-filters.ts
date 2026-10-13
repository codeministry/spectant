import { afterRenderEffect, ChangeDetectionStrategy, Component, computed, ElementRef, inject, input, output, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import type { ActorRef } from '../../../../../core/src/files';
import { UiIcon } from '../../shared/icons/icon';
import { UiButton } from '../../shared/ui/button/button';
import { UiIconButton } from '../../shared/ui/button/icon-button';
import { UiActorChip } from '../../shared/ui/actor-chip/actor-chip';
import { UiPopover, UiPopoverTrigger } from '../../shared/ui/overlay/popover';
import { type SegmentedOption, UiSegmented } from '../../shared/ui/segmented/segmented';
import { type TypeGlyphKind, UiTypeGlyph } from '../../shared/ui/type-glyph/type-glyph';
import {
  BOARD_FILTER_KEYS,
  BOARD_GROUPS,
  type BoardCardType,
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

/**
 * The query with one value of one filter key toggled (T163): a checked value is removed, an unchecked one appended
 * after the values already set, so several values of a key stay OR'ed as before; group and column stay.
 */
export function withToggled(query: BoardQueryState, key: BoardFilterKey, value: string): BoardQueryState {
  const values: readonly string[] = query[key];
  return { ...query, [key]: values.includes(value) ? values.filter((v) => v !== value) : [...values, value] };
}

/** The query without any filter value; the swimlane group and the visible column are not filters and stay. */
/** The query without the toolbar search (`q`). */
export const withoutSearch = (query: BoardQueryState): BoardQueryState => {
  const next: { -readonly [K in keyof BoardQueryState]: BoardQueryState[K] } = { ...query };
  delete next.q;
  return next;
};

export const withoutFilters = (query: BoardQueryState): BoardQueryState => ({ ...withoutSearch(query), feature: [], milestone: [], type: [], assignee: [] });

const isGroup = (value: string): value is BoardGroup => BOARD_GROUPS.some((g) => g === value);

/** One checkbox row of a filter list. */
interface FilterRow {
  readonly value: string;
  readonly label: string;
  readonly count: number;
  readonly checked: boolean;
  /** The assignee's ref (rendered as `ui-actor-chip`); null for every other key and for `unassigned`. */
  readonly actor: ActorRef | null;
  readonly name: string | null;
}

/** A run of rows under an optional heading: the assignee list reads people · agents · unassigned. */
interface FilterSection {
  readonly heading: string | null;
  readonly rows: readonly FilterRow[];
}

interface FilterList {
  readonly key: BoardFilterKey;
  /** The key's word, the popover's name. */
  readonly name: string;
  /** "Feature", or "Feature · 2" with values selected. */
  readonly trigger: string;
  readonly selected: number;
  readonly sections: readonly FilterSection[];
}

/** One active selection as a removable chip. */
interface ActiveChip {
  readonly id: string;
  readonly key: BoardFilterKey;
  readonly value: string;
  readonly label: string;
  readonly mono: boolean;
  readonly remove: string;
}

/**
 * The board's filter toolbar (spec 008, T123 and T163, ISC-129.1, ISC-133.1; design 008 § Desktop, toolbar): one row
 * of four triggers (Feature · Milestone · Type · Assignee), each opening a `ui-popover` (native `popover`, Esc and a
 * light dismiss return focus to the trigger) with a checkbox list of the values the cards carry, several per key; the
 * active selections as removable chips; and at the end the swimlane switch (`ui-segmented`), "n of m cards" and Clear
 * while a filter is set. It holds no state: every choice is emitted as the whole next query, which the page writes to
 * the URL; the URL is the state. Sticky under the shell header at medium and wide (board-filters.css); wrapping in the
 * page flow at compact.
 */
@Component({
  selector: 'app-board-filters',
  imports: [TranslocoPipe, UiActorChip, UiButton, UiIcon, UiIconButton, UiPopover, UiPopoverTrigger, UiSegmented, UiTypeGlyph],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-toolbar': '', '(document:keydown)': 'hotkey($event)' },
  styleUrl: './board-filters.css',
  template: `
    <div class="triggers">
      @for (f of lists(); track f.key) {
        <button
          ui-button
          variant="secondary"
          size="sm"
          class="trigger"
          aria-haspopup="dialog"
          [attr.data-trigger]="f.key"
          [attr.data-active]="f.selected > 0 ? '' : null"
          [uiPopoverTrigger]="pop"
        >
          <span>{{ f.trigger }}</span>
          <ui-icon class="caret" name="chevron-down" [size]="14" />
        </button>
        <ui-popover #pop class="filter-popover" [attr.data-filter]="f.key" [label]="f.name">
          <div class="list">
            @for (s of f.sections; track $index) {
              @if (s.heading; as heading) {
                <p class="section">{{ heading }}</p>
              }
              @for (r of s.rows; track r.value) {
                <label class="row" [attr.data-value]="r.value">
                  <input type="checkbox" [checked]="r.checked" (change)="toggle(f.key, r.value)" />
                  @if (f.key === 'type') {
                    <ui-type-glyph [type]="glyph(r.value)" [size]="14" [decorative]="true" />
                  }
                  @if (r.actor; as actor) {
                    <ui-actor-chip [actor]="actor" [name]="r.name" />
                  } @else if (f.key === 'feature' && r.value !== noFeature) {
                    <span class="fid">{{ r.value }}</span>
                    <span class="name">{{ r.label }}</span>
                  } @else {
                    <span class="name">{{ r.label }}</span>
                  }
                  <span class="n">{{ r.count }}</span>
                </label>
              }
            }
          </div>
        </ui-popover>
      }
    </div>

    <label class="bsearch" data-search>
      <ui-icon name="search" [size]="14" />
      <input
        #search
        type="search"
        [value]="board().query.q ?? ''"
        [placeholder]="'board.workspace.search.placeholder' | transloco"
        [attr.aria-label]="'board.workspace.search.label' | transloco"
        (input)="searchFor(search.value)"
      />
      <kbd aria-hidden="true">f</kbd>
    </label>

    @if (chips().length > 0) {
      <ul class="chips" data-chips [attr.aria-label]="'board.workspace.filter.activeList' | transloco">
        @for (c of chips(); track c.id; let i = $index) {
          <li class="fchip" [attr.data-chip]="c.id">
            @if (c.key === 'type') {
              <ui-type-glyph [type]="glyph(c.value)" [size]="14" [decorative]="true" />
            }
            <span class="cl" [class.mono]="c.mono">{{ c.label }}</span>
            <button ui-icon-button size="sm" icon="x" data-remove [label]="c.remove" (click)="remove(c, i)"></button>
          </li>
        }
      </ul>
    }

    <div class="end">
      <div class="lanes" data-group>
        <span class="label">{{ 'board.workspace.swimlanes.label' | transloco }}</span>
        <ui-segmented [options]="groupOptions()" [value]="board().query.group" [label]="'board.workspace.swimlanes.label' | transloco" (valueChange)="group($event)" />
      </div>
      @if (board().activeFilters > 0) {
        <p class="shown" data-shown>
          <span data-count>{{ 'board.workspace.filter.shown' | transloco: { shown: board().shown, total: board().total } }}</span>
          <button ui-button variant="ghost" size="sm" class="clear" data-clear (click)="queryChange.emit(clearAll())">
            {{ 'board.workspace.filter.clear' | transloco }}
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
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  protected readonly noFeature = NO_FEATURE;
  /** The chip just removed and its index: once it is gone, focus moves to the chip now there (or the key's trigger). */
  private readonly removed = signal<{ readonly chip: ActiveChip; readonly index: number } | null>(null);

  private readonly labels = computed(() => {
    const lang = this.lang();
    const board = this.board();
    const t = (key: string): string => this.transloco.translate(key, {}, lang);
    const features = new Map(board.options.features.map((f) => [f.id, f.name]));
    const names = new Map(board.options.assignees.map((a) => [a.ref.id, a.name]));
    const labelOf = (key: BoardFilterKey, value: string): string => {
      if (key === 'feature') return value === NO_FEATURE ? t('board.workspace.swimlanes.noFeature') : (features.get(value) ?? value);
      if (key === 'milestone') return value === NO_MILESTONE ? t('board.workspace.filter.noMilestone') : value;
      if (key === 'type') return t(`types.${value}`);
      return value === UNASSIGNED ? t('board.workspace.filter.unassigned') : (names.get(value) ?? value);
    };
    return { t, labelOf, names };
  });

  protected readonly lists = computed<readonly FilterList[]>(() => {
    const board = this.board();
    const { t, labelOf, names } = this.labels();
    const refs = new Map(board.options.assignees.map((a) => [a.ref.id, a.ref]));
    return BOARD_FILTER_KEYS.map((key): FilterList => {
      const selected: readonly string[] = board.query[key];
      const rows = filterValuesOf(board, key).map(
        (v): FilterRow => ({
          value: v.value,
          label: labelOf(key, v.value),
          count: v.count,
          checked: selected.includes(v.value),
          actor: key === 'assignee' ? (refs.get(v.value) ?? null) : null,
          name: key === 'assignee' ? (names.get(v.value) ?? null) : null,
        }),
      );
      const name = t(`board.workspace.filter.${key}`);
      const trigger = selected.length > 0 ? this.transloco.translate('board.workspace.filter.active', { label: name, count: selected.length }, this.lang()) : name;
      return { key, name, trigger, selected: selected.length, sections: key === 'assignee' ? assigneeSections(rows, t) : [{ heading: null, rows }] };
    });
  });

  protected readonly chips = computed<readonly ActiveChip[]>(() => {
    const query = this.board().query;
    const lang = this.lang();
    const { labelOf } = this.labels();
    return BOARD_FILTER_KEYS.flatMap((key) =>
      (query[key] as readonly string[]).map((value): ActiveChip => {
        const label = key === 'feature' ? (value === NO_FEATURE ? labelOf(key, value) : value) : labelOf(key, value);
        return {
          id: `${key}:${value}`,
          key,
          value,
          label,
          mono: key === 'feature' && value !== NO_FEATURE,
          remove: this.transloco.translate('board.workspace.filter.remove', { label }, lang),
        };
      }),
    );
  });

  protected readonly groupOptions = computed<readonly SegmentedOption[]>(() => {
    const lang = this.lang();
    return BOARD_GROUPS.map((g) => ({ key: g, label: this.transloco.translate(`board.workspace.swimlanes.${g}`, {}, lang) }));
  });

  constructor() {
    // After a chip's removal: once the new chips are rendered, focus the chip now at its place, else the key's trigger.
    afterRenderEffect(() => {
      const removed = this.removed();
      const chips = this.chips();
      if (removed === null || chips.some((c) => c.id === removed.chip.id)) return;
      const buttons = [...this.host.querySelectorAll<HTMLElement>('[data-chip] button[data-remove]')];
      const target: HTMLElement | null =
        buttons.at(Math.min(removed.index, buttons.length - 1)) ?? this.host.querySelector<HTMLElement>(`[data-trigger="${removed.chip.key}"]`);
      target?.focus();
      untracked(() => this.removed.set(null));
    });
  }

  protected glyph(value: string): TypeGlyphKind {
    return value as BoardCardType;
  }

  protected toggle(key: BoardFilterKey, value: string): void {
    this.queryChange.emit(withToggled(this.board().query, key, value));
  }

  protected remove(chip: ActiveChip, index: number): void {
    this.removed.set({ chip, index });
    this.queryChange.emit(withToggled(this.board().query, chip.key, chip.value));
  }

  protected group(value: string | undefined): void {
    if (value === undefined || !isGroup(value) || value === this.board().query.group) return;
    this.queryChange.emit({ ...this.board().query, group: value });
  }

  /** The toolbar search (spec 024): the whole next query with `q`, blank dropping it. */
  protected searchFor(value: string): void {
    const rest = withoutSearch(this.board().query);
    this.queryChange.emit(value.trim() === '' ? rest : { ...rest, q: value });
  }

  /** `f` outside a text field focuses the search, as the kbd hint says. */
  protected hotkey(event: KeyboardEvent): void {
    if (event.key !== 'f' || event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return;
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (target && (target.isContentEditable || target.closest('input, textarea, select, [contenteditable]'))) return;
    const input = this.host.querySelector<HTMLInputElement>('[data-search] input');
    if (!input) return;
    event.preventDefault();
    input.focus();
  }

  protected clearAll(): BoardQueryState {
    return withoutFilters(this.board().query);
  }
}

/** The assignee rows as people, then agents, then the rest (unknown ids a URL selects, `unassigned` last). */
function assigneeSections(rows: readonly FilterRow[], t: (key: string) => string): readonly FilterSection[] {
  const people = rows.filter((r) => r.actor !== null && (r.actor.kind === 'person' || r.actor.kind === 'legacy'));
  const agents = rows.filter((r) => r.actor !== null && (r.actor.kind === 'agent' || r.actor.kind === 'subagent'));
  const rest = rows.filter((r) => r.actor === null);
  return [
    { heading: t('board.workspace.filter.people'), rows: people },
    { heading: t('board.workspace.filter.agents'), rows: agents },
    { heading: null, rows: rest },
  ].filter((s) => s.rows.length > 0);
}

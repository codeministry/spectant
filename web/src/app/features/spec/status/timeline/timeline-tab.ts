import {
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  linkedSignal,
  resource,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import type { TimelineEntry, TimelineKind } from '../../../../../../../core/src/files';
import { ApiClient } from '../../../../core/api.service';
import { specLink } from '../../../../layout/shell/areas';
import { ShellState } from '../../../../layout/shell/shell-state.service';
import { UiButton } from '../../../../shared/ui/button/button';
import { UiChip } from '../../../../shared/ui/chip/chip';
import { UiEmptyState } from '../../../../shared/ui/empty-state/empty-state';
import { UiDisclosure } from '../../../../shared/ui/overlay/disclosure';
import { UiRovingItem, UiRovingList } from '../../../../shared/ui/roving-list.directive';
import { UiSkeleton } from '../../../../shared/ui/skeleton/skeleton';
import { toneMark } from '../../../../shared/ui/tone';

/** The sources in chip order (design.md § Status, tablet). `Note` and `Agent` join once `TimelineKind` carries them. */
export const TIMELINE_KINDS: readonly TimelineKind[] = ['stage', 'decision', 'round', 'gate', 'commit'];

/** One marker colour per source: stage → disp, decision → ques, round → conc, gate → clos, commit → muted. */
const MARKER: Record<TimelineKind, string> = {
  stage: toneMark('primary'),
  decision: toneMark('secondary'),
  round: 'var(--conc)',
  gate: toneMark('accent'),
  commit: 'var(--muted)',
};

/** The fragment prefix of a deep link to one entry: `#t/<id>`. */
const FRAGMENT = 't/';

export interface TimelineRow {
  readonly entry: TimelineEntry;
  /** `entry.id`, or `<kind>-<index>` when the source gave none (the list still needs a stable key). */
  readonly key: string;
  /** `HH:mm` local, empty for a date-only `ts`; null on an undated entry ("date unknown"). */
  readonly time: string | null;
}

export interface TimelineDay {
  /** `YYYY-MM-DD` in local time, `undated` when no entry before an undated one gives a day. */
  readonly key: string;
  readonly date: Date | null;
  readonly rows: readonly TimelineRow[];
}

const pad = (value: number): string => String(value).padStart(2, '0');
const dayKey = (date: Date): string => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

/** A `ts` as a Date, or null when it is empty or unparsable. A date alone (`2026-03-06`) is read as local midnight. */
function parseTs(ts: string): Date | null {
  if (ts === '') return null;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(ts) ? new Date(`${ts}T00:00:00`) : new Date(ts);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Day groups in list order (newest first, as the API sends them). An entry without a date joins the group of the
 * entry before it, so an undated derived transition stays next to the transition it follows (derived-stages.ts).
 */
export function groupByDay(entries: readonly TimelineEntry[]): TimelineDay[] {
  const days: Array<{ key: string; date: Date | null; rows: TimelineRow[] }> = [];
  entries.forEach((entry, index) => {
    const date = parseTs(entry.ts);
    const time = date === null ? null : entry.ts.includes('T') ? `${pad(date.getHours())}:${pad(date.getMinutes())}` : '';
    const row: TimelineRow = { entry, key: entry.id ?? `${entry.kind}-${index}`, time };
    const key = date === null ? (days.at(-1)?.key ?? 'undated') : dayKey(date);
    const last = days.at(-1);
    if (last?.key === key) last.rows.push(row);
    else days.push({ key, date, rows: [row] });
  });
  return days;
}

/** `?kinds=round,gate` → the known kinds it names; anything else is dropped. */
export function parseKinds(value: string | null): readonly TimelineKind[] {
  if (!value) return [];
  const named = new Set(value.split(','));
  return TIMELINE_KINDS.filter((kind) => named.has(kind));
}

/**
 * T55 · ISC-80 · ISC-36: the Status area's Timeline tab. One strand, newest first, grouped by local day with sticky
 * labels; source filters as toggle chips kept in `?kinds=`; an entry with a body expands in place (round entries add
 * "Open board"); a derived stage transition carries a dashed marker and a `derived` chip; `#t/<id>` scrolls to,
 * highlights and opens that entry. Entries are one roving list: arrows move, Enter toggles the entry's body.
 */
@Component({
  selector: 'app-timeline-tab',
  imports: [NgTemplateOutlet, TranslocoPipe, RouterLink, UiButton, UiChip, UiDisclosure, UiEmptyState, UiRovingItem, UiRovingList, UiSkeleton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './timeline-tab.html',
  styleUrl: './timeline-tab.css',
  host: { 'data-page': 'timeline' },
})
export class TimelineTab {
  private readonly api = inject(ApiClient);
  private readonly state = inject(ShellState);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly transloco = inject(TranslocoService);

  protected readonly kinds = TIMELINE_KINDS;
  protected readonly markerColor = (kind: TimelineKind): string => MARKER[kind];

  readonly timeline = resource({
    params: () => {
      const ws = this.state.ws();
      const id = this.state.specId();
      return ws === null || id === null ? undefined : { ws, id };
    },
    loader: ({ params }) => this.api.timeline(params.ws, params.id),
  });

  private readonly query = toSignal(this.route.queryParamMap, { initialValue: this.route.snapshot.queryParamMap });
  private readonly fragment = toSignal(this.route.fragment, { initialValue: this.route.snapshot.fragment });
  private readonly lang = toSignal(this.transloco.langChanges$, { initialValue: this.transloco.getActiveLang() });

  /** The pressed sources; empty means every source. */
  readonly selected = computed(() => parseKinds(this.query().get('kinds')));
  /** The entry `#t/<id>` names, or null. */
  readonly target = computed(() => {
    const fragment = this.fragment();
    return fragment?.startsWith(FRAGMENT) ? fragment.slice(FRAGMENT.length) : null;
  });

  private readonly result = computed(() => this.timeline.value());
  readonly entries = computed<readonly TimelineEntry[]>(() => {
    const result = this.result();
    return result?.kind === 'ok' ? result.body : [];
  });
  protected readonly counts = computed(() => {
    const counts = Object.fromEntries(TIMELINE_KINDS.map((kind) => [kind, 0])) as Record<TimelineKind, number>;
    for (const entry of this.entries()) counts[entry.kind] += 1;
    return counts;
  });
  readonly days = computed(() => {
    const selected = this.selected();
    const shown = selected.length === 0 ? this.entries() : this.entries().filter((entry) => selected.includes(entry.kind));
    return groupByDay(shown);
  });

  /** `loading` only before the first answer; a reload keeps the list on screen. */
  protected readonly view = computed<'loading' | 'ok' | 'empty' | 'unserved' | 'error'>(() => {
    const result = this.result();
    if (result === undefined) return this.timeline.error() ? 'error' : 'loading';
    if (result.kind === 'ok') return result.body.length === 0 ? 'empty' : 'ok';
    if (result.kind === 'not-found' && !result.served) return 'unserved';
    return 'error';
  });

  /** Open bodies by row key; a deep link opens its target. Reset when the spec changes. */
  private readonly open = linkedSignal<ReadonlySet<string>>(() => {
    const target = this.target();
    return new Set(target === null ? [] : [target]);
  });

  protected readonly boardLink = computed(() => specLink(this.state.ws() ?? '', this.state.specId() ?? '', 'board'));

  private readonly dayFormat = computed(
    () => new Intl.DateTimeFormat(this.lang(), { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }),
  );
  protected dayLabel(day: TimelineDay): string | null {
    return day.date === null ? null : this.dayFormat().format(day.date);
  }

  private scrolledTo: string | null = null;

  constructor() {
    // Scroll a deep-linked entry into view once, after the rows it names have rendered.
    afterRenderEffect(() => {
      const target = this.target();
      if (target === null || this.view() !== 'ok' || this.scrolledTo === target) return;
      const element = this.host.nativeElement.querySelector<HTMLElement>(`[data-id="${CSS.escape(target)}"]`);
      if (element === null) return;
      this.scrolledTo = target;
      // DOM emulations (the unit-test builder) have no scrollIntoView.
      (element as Partial<HTMLElement>).scrollIntoView?.({ block: 'center' });
      element.focus({ preventScroll: true });
    });
  }

  isOpen(key: string): boolean {
    return this.open().has(key);
  }

  setOpen(key: string, open: boolean): void {
    this.open.update((keys) => {
      const next = new Set(keys);
      if (open) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  isPressed(kind: TimelineKind): boolean {
    return this.selected().includes(kind);
  }

  /** Toggles one source in `?kinds=`; the last one released drops the param (every source again). */
  toggleKind(kind: TimelineKind): void {
    const selected = new Set(this.selected());
    if (selected.has(kind)) selected.delete(kind);
    else selected.add(kind);
    const kinds = TIMELINE_KINDS.filter((each) => selected.has(each));
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { kinds: kinds.length === 0 ? null : kinds.join(',') },
      queryParamsHandling: 'merge',
      preserveFragment: true,
      replaceUrl: true,
    });
  }

  clearKinds(): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { kinds: null },
      queryParamsHandling: 'merge',
      preserveFragment: true,
      replaceUrl: true,
    });
  }

  /** Enter on the entry itself (not on a control inside it) toggles its body. */
  onEntryKey(event: KeyboardEvent, row: TimelineRow): void {
    if (event.key !== 'Enter' || event.target !== event.currentTarget || !row.entry.body) return;
    event.preventDefault();
    this.setOpen(row.key, !this.isOpen(row.key));
  }

  /** The body as plain lines (markdown-lite, never HTML). */
  protected lines(body: string): string[] {
    return body.split('\n');
  }

  reload(): void {
    this.timeline.reload();
  }
}

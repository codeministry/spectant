import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import type { Guidance, GuidanceEntry } from '../../../../../../core/src/files';
import type { DashboardRowView as DashboardSpecRow } from '../context-rail/dashboard-view';
import { UiIcon } from '../../../shared/icons/icon';
import { UiCard } from '../../../shared/ui/card/card';
import { UiDisclosure } from '../../../shared/ui/overlay/disclosure';
import { UiSectionHeader } from '../../../shared/ui/section-header/section-header';
import { TRACK_STAGES } from '../../spec/dashboard/dashboard-model';
import { NextUpEntry } from './next-up-entry';

/**
 * `rail` (wide): one card of rows under the eyebrow, each row's sentence above its command and takeable chips, the stage
 * in the title link's name (spec 021, T79); `card` (below wide): one card of rows under the section header.
 */
export type NextUpForm = 'rail' | 'card';

/** One Next up entry: the spec's row and, with guidance, the `guidance.next` entry it stands for (spec 020). */
export interface NextUpItem {
  readonly row: DashboardSpecRow;
  readonly entry: GuidanceEntry | null;
}

/** Entries before "Show all n" when Next up reads `guidance.next`: as many as the model's `nextUp` holds (core NEXT_UP). */
export const NEXT_UP_SHOWN = 3;

/** The id the `g n` sequence moves focus to (DS-APP-35). */
export const NEXT_UP_HEADING = 'next-up';

/**
 * Next up (T64, design.md § Desktop / Mobile / Tablet): the model's `nextUp` ids resolved to their rows, in the model's
 * order; every further row with a next command sits behind "Show all n" in row order. Each entry links to the spec
 * preview (`?spec=<id>`, T69) and carries its next command with copy; the rail form adds the stage (in the link's name)
 * and the first takeable claim. Nothing is counted or ranked here: the order and the commands are the parser's.
 * With nothing to run it says so and, when specs wait on fog, links to the fog filter (`?phase=fog`).
 */
@Component({
  selector: 'app-next-up-list',
  imports: [NextUpEntry, RouterLink, TranslocoPipe, UiCard, UiDisclosure, UiIcon, UiSectionHeader],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './next-up-list.html',
  styleUrl: './next-up-list.css',
  host: { 'data-next-up': '', '[attr.data-form]': 'form()' },
})
export class NextUpList {
  /** The model's active rows (`DashboardModel.specs`), in action order. */
  readonly specs = input.required<readonly DashboardSpecRow[]>();
  /** The model's `nextUp`: the first rows with a next command. */
  readonly ids = input.required<readonly string[]>();
  readonly form = input<NextUpForm>('card');
  /** `DashboardModel.guidance` (spec 020): each entry reads its spec's sentence from it (ISC-237.1). */
  readonly guidance = input<Guidance | undefined>(undefined);

  protected readonly headingId = NEXT_UP_HEADING;
  protected readonly showAll = signal(false);

  private readonly transloco = inject(TranslocoService);
  private readonly lang = toSignal(this.transloco.langChanges$, { initialValue: this.transloco.getActiveLang() });

  /**
   * Spec 020 (T25, ISC-240): with guidance, Next up holds `guidance.next` only, in its order, one entry per spec (the
   * first that names it) and each with its entry; what waits on you moved to `#waiting`. Without guidance (no clock)
   * the model's `nextUp` and every further row with a next command, as before.
   */
  private readonly listed = computed<readonly NextUpItem[]>(() => {
    const byId = new Map(this.specs().map((row) => [row.id, row]));
    const guidance = this.guidance();
    if (!guidance) {
      const shown = new Set(this.ids());
      const rest = this.specs().filter((row) => row.nextCommand !== null && !shown.has(row.id));
      return [...this.ids().flatMap((id) => byId.get(id) ?? []), ...rest].map((row) => ({ row, entry: null }));
    }
    const seen = new Set<string>();
    return guidance.next.flatMap((entry) => {
      const row = byId.get(entry.spec);
      if (!row || seen.has(entry.spec)) return [];
      seen.add(entry.spec);
      return [{ row, entry }];
    });
  });
  /** How many entries stand before the fold: the model's `nextUp` count without guidance, `NEXT_UP_SHOWN` with it. */
  private readonly shown = computed(() => (this.guidance() ? NEXT_UP_SHOWN : this.ids().filter((id) => this.specs().some((row) => row.id === id)).length));
  protected readonly entries = computed(() => this.listed().slice(0, this.shown()));
  protected readonly more = computed(() => this.listed().slice(this.shown()));
  protected readonly total = computed(() => this.entries().length + this.more().length);
  /** Specs with open fog, named only when nothing is ready to build. */
  protected readonly fogWaiting = computed(() => this.specs().filter((row) => row.fog > 0).length);

  protected readonly stageLabels = computed(() => {
    this.lang();
    return TRACK_STAGES.map((stage) => this.transloco.translate(`stages.${stage}`));
  });
}

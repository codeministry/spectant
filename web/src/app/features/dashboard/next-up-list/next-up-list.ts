import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import type { DashboardRowView as DashboardSpecRow } from '../context-rail/dashboard-view';
import { UiCard } from '../../../shared/ui/card/card';
import { UiDisclosure } from '../../../shared/ui/overlay/disclosure';
import { UiSectionHeader } from '../../../shared/ui/section-header/section-header';
import { TRACK_STAGES } from '../../spec/dashboard/dashboard-model';
import { NextUpEntry } from './next-up-entry';

/** `rail`: one compact card per entry with the labelled stage track (wide); `card`: one card of rows (below wide). */
export type NextUpForm = 'rail' | 'card';

/** The id the `g n` sequence moves focus to (DS-APP-35). */
export const NEXT_UP_HEADING = 'next-up';

/**
 * Next up (T64, design.md § Desktop / Mobile / Tablet): the model's `nextUp` ids resolved to their rows, in the model's
 * order; every further row with a next command sits behind "Show all n" in row order. Each entry links to the spec
 * preview (`?spec=<id>`, T69) and carries its next command with copy; the rail form adds the labelled stage track and
 * the first takeable claim. Nothing is counted or ranked here: the order and the commands are the parser's.
 * With nothing to run it says so and, when specs wait on fog, links to the fog filter (`?phase=fog`).
 */
@Component({
  selector: 'app-next-up-list',
  imports: [NextUpEntry, NgTemplateOutlet, RouterLink, TranslocoPipe, UiCard, UiDisclosure, UiSectionHeader],
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

  protected readonly headingId = NEXT_UP_HEADING;
  protected readonly showAll = signal(false);

  private readonly transloco = inject(TranslocoService);
  private readonly lang = toSignal(this.transloco.langChanges$, { initialValue: this.transloco.getActiveLang() });

  protected readonly entries = computed(() => {
    const byId = new Map(this.specs().map((row) => [row.id, row]));
    return this.ids().flatMap((id) => byId.get(id) ?? []);
  });
  protected readonly more = computed(() => {
    const shown = new Set(this.ids());
    return this.specs().filter((row) => row.nextCommand !== null && !shown.has(row.id));
  });
  protected readonly total = computed(() => this.entries().length + this.more().length);
  /** Specs with open fog, named only when nothing is ready to build. */
  protected readonly fogWaiting = computed(() => this.specs().filter((row) => row.fog > 0).length);

  protected readonly stageLabels = computed(() => {
    this.lang();
    return TRACK_STAGES.map((stage) => this.transloco.translate(`stages.${stage}`));
  });
}

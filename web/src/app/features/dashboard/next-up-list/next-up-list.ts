import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import type { Guidance, GuidanceEntry } from '../../../../../../core/src/files';
import type { DashboardRowView as DashboardSpecRow } from '../context-rail/dashboard-view';
import { TRACK_STAGES } from '../../../core/model/stage-track';
import { UiIcon } from '../../../shared/icons/icon';
import { UiCard } from '../../../shared/ui/card/card';
import { UiCommandChip } from '../../../shared/ui/command-chip/command-chip';
import { GuidanceReasonPipe } from '../../../shared/ui/guidance/guidance-reason.pipe';
import { UiSectionHeader } from '../../../shared/ui/section-header/section-header';
import { SpecRow } from '../spec-table/spec-row';
import { SpecTableHead } from '../spec-table/spec-table-head';
import { readSpecRows, type SpecTableRow } from '../spec-table/spec-table-model';

/** One Next up entry: the spec's row and, with guidance, the `guidance.next` entry it stands for (spec 020). */
export interface NextUpItem {
  readonly row: SpecTableRow;
  readonly entry: GuidanceEntry | null;
}

/** The id the `g n` sequence moves focus to (DS-APP-35). */
export const NEXT_UP_HEADING = 'next-up';

/**
 * Next up (T64, design.md § Desktop / Mobile / Tablet): the model's `nextUp` ids resolved to their rows, in the model's
 * order, then every further row with a next command in row order. Nothing is counted or ranked here: the order and the
 * commands are the parser's. Spec 068 (T6, ISC-543): every entry stands directly in one list, with no "Show all n"
 * fold and no cap; the header's count is the number of entries.
 * With nothing to run it says so and, when specs wait on fog, links to the fog filter of the Specs page (`/w/:ws/specs?phase=fog`, spec 058).
 *
 * Spec 068 (T2, T10; ISC-546, ISC-545): each entry is a row of the spec list (`app-spec-row`, variant `next`) under its
 * column headings (`app-spec-table-head`), in one card: the Next ring in the mark column, the title as the row link
 * stretched over the row (to the preview, `?sel=spec:<id>`), and the copy chip in the row's last cell, `command`. The
 * reason sentence is no line of its own but the link's description (`next-why-<id>`, hidden) and tooltip. The rows
 * carry no favorite star; the star's cell stays, empty.
 */
@Component({
  selector: 'app-next-up-list',
  imports: [
    GuidanceReasonPipe,
    NgTemplateOutlet,
    RouterLink,
    SpecRow,
    SpecTableHead,
    TranslocoPipe,
    UiCard,
    UiCommandChip,
    UiIcon,
    UiSectionHeader,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './next-up-list.html',
  styleUrl: './next-up-list.css',
  host: { 'data-next-up': '' },
})
export class NextUpList {
  private readonly transloco = inject(TranslocoService);
  private readonly lang = toSignal(this.transloco.selectTranslation());

  /** The model's active rows (`DashboardModel.specs`), in action order. */
  readonly specs = input.required<readonly DashboardSpecRow[]>();
  /** The model's `nextUp`: the first rows with a next command. */
  readonly ids = input.required<readonly string[]>();
  /** The workspace slug: the empty state's fog link targets the Specs page `/w/:ws/specs?phase=fog` (spec 058, ISC-395). */
  readonly ws = input.required<string>();
  /** `DashboardModel.guidance` (spec 020): each entry reads its spec's sentence from it (ISC-237.1). */
  readonly guidance = input<Guidance | undefined>(undefined);

  protected readonly headingId = NEXT_UP_HEADING;

  /** Spec 068 (T2): the model's rows as the spec list reads them (`readSpecRows`), so `app-spec-row` renders them. */
  private readonly rows = computed(() => readSpecRows({ specs: this.specs() }));

  /**
   * Spec 020 (T25, ISC-240): with guidance, Next up holds `guidance.next` only, in its order, one entry per spec (the
   * first that names it) and each with its entry; what waits on you moved to `#waiting`. Without guidance (no clock)
   * the model's `nextUp` and every further row with a next command, as before.
   */
  protected readonly entries = computed<readonly NextUpItem[]>(() => {
    const byId = new Map(this.rows().map((row) => [row.id, row]));
    const guidance = this.guidance();
    if (!guidance) {
      const shown = new Set(this.ids());
      const rest = this.rows().filter((row) => row.nextCommand !== null && !shown.has(row.id));
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
  /** Specs with open fog, named only when nothing is ready to build. */
  protected readonly fogWaiting = computed(() => this.specs().filter((row) => row.fog > 0).length);

  /** The Specs page as router-link commands, for the fog link of the empty state. */
  protected readonly specsLink = computed(() => ['/w', this.ws(), 'specs']);

  /** Blocker titles by `NNN` for a row's waits chip (spec 025, T24). */
  protected readonly titles = computed<Readonly<Record<string, string>>>(() => Object.fromEntries(this.rows().map((row) => [row.id, row.title])));

  /** The five stage labels of the rows' mini track, translated once. */
  protected readonly stageLabels = computed(() => {
    this.lang();
    return TRACK_STAGES.map((stage) => this.transloco.translate(`stages.${stage}`));
  });

  /** Spec 068 (T10, ISC-545): the row link's tooltip, the title and the reason sentence on its own line when there is one. */
  protected linkTitle(title: string, why: string): string {
    return why ? `${title}\n${why}` : title;
  }
}

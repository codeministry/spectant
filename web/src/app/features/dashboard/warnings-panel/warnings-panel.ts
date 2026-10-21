import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, model } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import type { DashboardView, DashboardRowView as DashboardSpecRow } from '../context-rail/dashboard-view';
import { UiIcon } from '../../../shared/icons/icon';
import { UiCard } from '../../../shared/ui/card/card';
import { UiCommandChip } from '../../../shared/ui/command-chip/command-chip';
import { UiPopover, UiPopoverTrigger } from '../../../shared/ui/overlay/popover';
import { edgeDiagnostic, overlapOf, pathSuffixes } from '../../../core/model/overlap';

/**
 * `section`: the page section `#warnings` under its section header; `callout`: a collapsed `<details>` with the orange
 * edge, rendered only when there is something to say.
 */
export type WarningsForm = 'section' | 'callout';

/** The id the `g w` sequence and the Attention tile move focus to (DS-APP-35). */
export const WARNINGS_HEADING = 'warnings';

/**
 * Warnings (T64, ported in T90 from the prototype's `warningsPanel`): one group per spec with a warning or open fog, in
 * the model's row order — the rows already carry their warnings and fog count, so nothing is regrouped or recounted
 * here. Each warning is one line (alert icon, spec ID link to the preview `?spec=<id>`, text, and the clearing command
 * with copy when it has one); a spec with open fog adds a fog line (cloud icon, violet left edge on the violet tint).
 * The count is the model's `warnings` KPI; "in n specs" counts the specs that carry a warning. The section form heads
 * the card with its heading and the count.
 *
 * Spec 064 (T32, ISC-476): the section form folds. Its heading row is one native button (≥ 44 px, full width) with
 * `aria-expanded` and `aria-controls` on the list region, the summary "n warnings in m specs" (or "No warnings") and a
 * chevron; `open` starts closed, and closed the region is hidden with no card in it. The callout form is unchanged.
 */
@Component({
  selector: 'app-warnings-panel',
  imports: [NgTemplateOutlet, RouterLink, TranslocoPipe, UiCard, UiCommandChip, UiIcon, UiPopover, UiPopoverTrigger],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './warnings-panel.html',
  styleUrl: './warnings-panel.css',
  host: { 'data-warnings': '', 'data-warnings-list': '', '[attr.data-form]': 'form()' },
})
export class WarningsPanel {
  /** The model's active rows (`DashboardModel.specs`), in action order. */
  readonly specs = input.required<readonly DashboardSpecRow[]>();
  /** The model's key numbers; only `warnings` is read. */
  readonly kpis = input.required<DashboardView['kpis']>();
  readonly form = input<WarningsForm>('section');
  /** Whether the section form shows its list; closed by default, two-way (`openChange`) for the page's `?open=`. */
  readonly open = model(false);

  protected readonly headingId = WARNINGS_HEADING;
  protected readonly regionId = `${WARNINGS_HEADING}-region`;
  protected readonly summaryId = `${WARNINGS_HEADING}-summary`;

  protected toggle(): void {
    this.open.update((open) => !open);
  }
  protected readonly groups = computed(() => this.specs().filter((row) => row.warnings.length > 0 || row.fog > 0));
  /** Specs carrying at least one warning, for "in n specs". */
  protected readonly warned = computed(() => this.specs().filter((row) => row.warnings.length > 0).length);
  protected readonly count = computed(() => this.kpis().warnings);

  // Spec 025 (ISC-164.1, ISC-162.4): the spec-overlap and spec-edge lines.
  protected readonly overlapOf = overlapOf;
  protected readonly edgeDiagnostic = edgeDiagnostic;
  protected readonly suffixes = pathSuffixes;
  private readonly titles = computed(() => new Map(this.specs().map((row) => [row.id, row.title] as const)));
  /** The other spec's title for the link's tooltip; the id when the row is not active. */
  protected titleOf(id: string): string {
    return this.titles().get(id) ?? id;
  }

  /**
   * The text lines of a group: its warnings, less the open-fog warning when the spec has a fog line, so open fog is
   * said once, by the fog line (prototype `warningsPanel`: `warn` lines, then one `fog` line).
   */
  protected textLines(spec: DashboardSpecRow): DashboardSpecRow['warnings'] {
    return spec.fog > 0 ? spec.warnings.filter((warning) => warning.kind !== 'fog') : spec.warnings;
  }
}

import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import type { Guidance, GuidanceEntry, SpecPageModel } from '../../../../../core/src/files';
import { UiChip } from '../../shared/ui/chip/chip';
import { UiCard } from '../../shared/ui/card/card';
import { UiCommandChip } from '../../shared/ui/command-chip/command-chip';
import { UiGlyph } from '../../shared/ui/glyph/glyph';
import { guidanceEntryOf } from '../../core/model/guidance-entry';
import { GuidanceReasonPipe } from '../../shared/ui/guidance/guidance-reason.pipe';
import type { AreaId, TabId } from '../shell/areas';
import { specLink } from '../shell/areas';
import { ShellData } from '../shell/shell-data.service';
import { ShellState } from '../shell/shell-state.service';
import { specModel } from '../shell/spec-model';
import type { Tier } from '../shell/tier';

/** The spec page's guidance spot (ISC-239): the spec's next step and the other entries that wait on you. */
export interface SpecGuide {
  /** The spec's own entry (`item: 'spec'`), or null when the guidance names none (running, waiting, done). */
  readonly entry: GuidanceEntry | null;
  /** The spec's own entry is one of `waits`: it waits on you, not on an agent. */
  readonly waiting: boolean;
  /** Every other waiting entry of the spec (manual claims, operator tasks, questions), in core's order. */
  readonly others: readonly GuidanceEntry[];
  /** The next step's command: the entry's, else the model's own next command; null when there is none. */
  readonly command: string | null;
  /** The model's first reason, what reads where the guidance names no entry for the spec. */
  readonly phrase: string;
}

/**
 * The guidance spot of one spec page (spec 020, ISC-239), from its own `guidance` slice: the spec's entry as the next
 * step and the rest of `waits` below it. The spec's own entry is never listed twice, so the next step's chip stands
 * once. Without `guidance` (no clock) the model's next command and its first reason stand in. Pure.
 */
export function specGuide(guidance: Guidance | null | undefined, model: Pick<SpecPageModel, 'head' | 'next'>): SpecGuide {
  const entry = guidanceEntryOf(guidance, model.head.id);
  const waits = guidance?.waits ?? [];
  return {
    entry,
    waiting: entry !== null && waits.includes(entry),
    others: waits.filter((e) => e !== entry),
    command: entry?.command ?? model.next.command ?? null,
    phrase: model.next.reasons[0] ?? '',
  };
}

/**
 * Where the compact guide card stands under the spec head (T21, design.md § Viewport-übergreifend): below 1120 px on
 * every tab but the dashboard (its own full card, T19) and Status (040's status block shows the chip there, so that
 * block is the guidance spot and no second chip is set). From 1120 px the spec rail is the spot (T20), except on the
 * tabs that register no spec rail: the live area (its own board rail) and the Library (no rail).
 */
export function guideCardShown(tier: Tier, area: AreaId | null, tab: TabId | null): boolean {
  if (area === null || area === 'dashboard') return false;
  if (tier === 'wide') return area === 'live' || area === 'library';
  return tab !== 'status';
}

/**
 * T21 · ISC-239: the compact guide card under the spec head: the open ring, the next step's sentence through
 * `guidanceReason` (never cut), its copy chip, the marker "Waits on you" when the spec itself waits, and "+n waiting"
 * to the dashboard tab's `#waiting` when more of the spec waits on you. Renders only where `guideCardShown` says.
 */
@Component({
  selector: 'app-spec-guide',
  imports: [GuidanceReasonPipe, RouterLink, TranslocoPipe, UiCard, UiChip, UiCommandChip, UiGlyph],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './spec-guide.css',
  templateUrl: './spec-guide.html',
})
export class SpecGuideCard {
  private readonly data = inject(ShellData);
  private readonly state = inject(ShellState);

  private readonly model = specModel(this.data);

  /** The guide, only where the card is the tab's guidance spot and something can be said. */
  protected readonly guide = computed<SpecGuide | null>(() => {
    const model = this.model();
    if (model === null || !guideCardShown(this.state.tier(), this.state.area(), this.state.tab())) return null;
    const guide = specGuide(model.guidance, model);
    return guide.entry === null && guide.command === null && guide.phrase === '' ? null : guide;
  });

  protected readonly dashboardLink = computed(() => specLink(this.state.ws() ?? '', this.model()?.head.id ?? this.state.specId() ?? ''));
}

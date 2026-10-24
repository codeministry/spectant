import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import type { WorkingEntry, WorkingRun } from '../../../core/model/working';
import { UiIcon } from '../../icons/icon';
import { UiAgentDot } from '../agent-dot/agent-dot';
import { UiChip } from '../chip/chip';
import { UiGlyph } from '../glyph/glyph';
import { UiRelativeTime } from '../relative-time/relative-time';
import { UiSectionHeader } from '../section-header/section-header';
import { UiFlatTile } from './flat-tile';
import { TILE_LIMIT } from './tiles';

/**
 * The block "In progress" (spec 064, ISC-508, ISC-461, ISC-462; design.md § Across viewports): every spec a session
 * holds a claim of, as `workingOf` reads it off the dashboard body. A section header (`level` 2 on `/w/<ws>`, 3 on `/`)
 * with the `running` item glyph and the total as a `count` chip, then at most `TILE_LIMIT` flat tiles: the agent dot
 * (hidden from assistive tech, the tile's name says it), the id, the spec title cut with an ellipsis (full title as the
 * link's `title`), the agent session (mono, at most 16ch, full value in its `title`) and an empty end column. Each tile
 * links to the spec's live view `/w/<ws>/s/<id>/board`, the live area's first tab (ISC-508). With more entries a 44 px
 * link "Show all n" leads to `/w/<ws>/specs?working=1`.
 * Without an entry the block renders nothing at all: no section, no heading, no space (ISC-462).
 * Spec 070 (C5, ISC-571, ISC-572): a spec with an open run stands here too, once, with or without a held claim; its tile
 * names the run's phase as a chip after the id (`guidance.working.phases`, the command itself for a phase the catalogue
 * has no word for) and, on an `implement` run, its latest step (a `probe` reads as testing), the run's session as the
 * agent and its start as the bare duration in the end column (`ui-relative-time`, `short`).
 */
/** The `/spec` subcommands the catalogue names as a phase (`guidance.working.phases`). */
const PHASES: ReadonlySet<string> = new Set(['init', 'new', 'plan', 'tasks', 'review', 'implement', 'done', 'status', 'drift', 'doc', 'tldr']);
/** The steps of an `implement` run (core's `DashboardRunStep.kind`); `probe` reads as testing. */
const STEPS: ReadonlySet<string> = new Set(['dispatch', 'build', 'patch', 'apply', 'probe']);

@Component({
  selector: 'ui-working-block',
  imports: [RouterLink, TranslocoPipe, UiAgentDot, UiChip, UiFlatTile, UiGlyph, UiIcon, UiRelativeTime, UiSectionHeader],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './working-block.css',
  templateUrl: './working-block.html',
})
export class UiWorkingBlock {
  /** `workingOf(body)`, in served order. */
  readonly entries = input.required<readonly WorkingEntry[]>();
  /** The workspace slug the tiles and the "Show all" link point into. */
  readonly workspace = input.required<string>();
  /** The heading level: 2 on the workspace dashboard, 3 under a workspace column of the start. */
  readonly level = input<2 | 3>(3);
  /** The heading's id, which the section's `aria-labelledby` names; unique per page. */
  readonly headingId = input('working-heading');

  protected readonly shown = computed(() => this.entries().slice(0, TILE_LIMIT));
  protected readonly more = computed(() => this.entries().length > TILE_LIMIT);
  protected readonly specsLink = computed(() => ['/w', this.workspace(), 'specs']);
  protected readonly showAllQuery = { working: '1' } as const;

  /** The catalogue key of a run's phase, or null for a phase it has no word for (the chip then shows the command). */
  protected phaseKey(run: WorkingRun): string | null {
    return run.phase !== null && PHASES.has(run.phase) ? `guidance.working.phases.${run.phase}` : null;
  }

  /** The catalogue key of an `implement` run's latest step, or null without a step the catalogue names. */
  protected stepKey(run: WorkingRun): string | null {
    const kind = run.step?.kind;
    return kind !== undefined && STEPS.has(kind) ? `guidance.working.steps.${kind}` : null;
  }

  protected specLink(entry: WorkingEntry): readonly string[] {
    return ['/w', this.workspace(), 's', entry.id, 'board'];
  }
}

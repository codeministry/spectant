import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { parseActor } from '../../../../../core/src/actor';
import type { ActorRef, ItemRun } from '../../../../../core/src/files';
import type { BoardRow } from '../../core/model/board-rows';
import { UiTime, type UiTimeForm } from '../../shared/time/time';
import { UiActorChip } from '../../shared/ui/actor-chip/actor-chip';
import { UiChip } from '../../shared/ui/chip/chip';
import { UiCommandChip } from '../../shared/ui/command-chip/command-chip';
import { UiPriority } from '../../shared/ui/priority/priority';
import { UiRing } from '../../shared/ui/ring/ring';
import { toneOfStage } from '../../shared/ui/stage-tone';
import { UiTypeGlyph } from '../../shared/ui/type-glyph/type-glyph';
import { specLink } from '../shell/areas';

/**
 * The fields of a dashboard row (`DashboardSpecRow`, `core/src/dashboard.ts`) the spec facts read, re-declared
 * structurally for the reason `board-rows.ts` gives: a served row is assignable to it.
 */
export interface SpecFactsRow extends BoardRow {
  /** The first prose paragraph under `## Goal`, on one line; empty when the spec has none. */
  readonly goal: string;
  /** The main feature `F<n>`; null when the spec names none. */
  readonly feature: string | null;
  /** The master block's name of that feature; null without one. */
  readonly featureName: string | null;
  readonly milestone: string | null;
  /** Live claims, closed over total. */
  readonly progress: { readonly closed: number; readonly total: number };
  /** Null when the spec has no tasks.md. */
  readonly tasks: { readonly landed: number; readonly total: number } | null;
  /** Claims of this spec a lock holds, in claim-ID order. */
  readonly taken: ReadonlyArray<{ readonly id: string; readonly session: string }>;
  readonly warnings: ReadonlyArray<{ readonly kind: string }>;
  /** Frontmatter `updated:`. */
  readonly updated: string | null;
  /** ISO 8601 of the newest `rounds.jsonl` line. */
  readonly lastRound: string | null;
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === 'object' && value !== null;

/**
 * The active row of `id` in a served dashboard body as a `SpecFactsRow`, null when the body lists none. Like
 * `boardRowsOf` the row is passed through as served; a row that lacks the fields the facts read counts as none.
 */
export function specFactsRowOf(body: unknown, id: string): SpecFactsRow | null {
  const specs = isRecord(body) ? body['specs'] : null;
  if (!Array.isArray(specs)) return null;
  const row: unknown = specs.find((entry) => isRecord(entry) && entry['id'] === id);
  return isRecord(row) && typeof row['slug'] === 'string' && isRecord(row['progress']) && Array.isArray(row['taken']) && Array.isArray(row['warnings'])
    ? (row as unknown as SpecFactsRow)
    : null;
}

/** The last change of a spec: the newer of its frontmatter `updated:` and its newest round, with the form that reads it. */
export function lastChangeOf(row: Pick<SpecFactsRow, 'updated' | 'lastRound'>): { readonly value: string; readonly form: UiTimeForm } | null {
  const dated = [row.updated, row.lastRound].filter((value): value is string => value !== null && !Number.isNaN(Date.parse(value)));
  if (dated.length === 0) return null;
  const value = dated.reduce((newest, next) => (Date.parse(next) > Date.parse(newest) ? next : newest));
  // A bare calendar day (`2026-03-08`) reads as that day, never shifted by the zone; an instant as its local date.
  return { value, form: /^\d{4}-\d{2}-\d{2}$/.test(value) ? 'day' : 'date' };
}

/**
 * The facts of a spec in the detail sidebar (spec 067, T16, ISC-528; the next step ISC-531), read from its dashboard
 * row: the meta chips (stage in its tone, priority, type), the goal as prose, the next step (`ui-command-chip` with its
 * reason), the metrics (claims ring with closed/total, tasks landed/total, the warning count as a link to the status
 * tab) and a `dl` of feature (`F<n> · name`), milestone, the agent holding a claim and the last change. A value the
 * spec does not carry has no row, and a group without any value no block. `large` gives the copy box its 44 px (the
 * compact sheet).
 */
@Component({
  selector: 'app-spec-facts',
  imports: [RouterLink, TranslocoPipe, UiActorChip, UiChip, UiCommandChip, UiPriority, UiRing, UiTime, UiTypeGlyph],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './spec-facts.html',
  styleUrl: './spec-facts.css',
  host: { 'data-ui': 'spec-facts' },
})
export class SpecFacts {
  readonly row = input.required<SpecFactsRow>();
  /** The open workspace, for the warnings link. */
  readonly ws = input.required<string>();
  /** The 44 px copy box of the compact sheet. */
  readonly large = input(false);
  /**
   * The run open on the spec (T23, ISC-531), as the sidebar's run line reads it: the next step's chip is locked while
   * it is set, as every command chip of a running item is (spec 040, ISC-225.1).
   */
  readonly lockedBy = input<ItemRun | null>(null);

  protected readonly stageTone = computed(() => toneOfStage(this.row().stage));
  protected readonly goal = computed(() => this.row().goal.trim());
  protected readonly claims = computed(() => {
    const { closed, total } = this.row().progress;
    return total > 0 ? { closed, total, percent: (closed / total) * 100 } : null;
  });
  protected readonly tasks = computed(() => {
    const tasks = this.row().tasks;
    return tasks && tasks.total > 0 ? tasks : null;
  });
  protected readonly warnings = computed(() => this.row().warnings.length);
  protected readonly statusLink = computed(() => specLink(this.ws(), this.row().id, 'status'));
  /** `F<n> · name`, or `F<n>` alone when the master names no block for it. */
  protected readonly feature = computed(() => {
    const { feature, featureName } = this.row();
    return feature === null ? null : featureName ? `${feature} · ${featureName}` : feature;
  });
  /** The session of the first held claim, as the actor grammar reads it; null while no lock holds a claim. */
  protected readonly holder = computed<ActorRef | null>(() => {
    const session = this.row().taken[0]?.session;
    return session ? parseActor(session) : null;
  });
  protected readonly changed = computed(() => lastChangeOf(this.row()));
  /** Whether the `dl` has a row at all, so a spec without any of its facts leaves no empty list. */
  protected readonly anyFact = computed(() => this.feature() !== null || !!this.row().milestone || this.holder() !== null || this.changed() !== null);
}

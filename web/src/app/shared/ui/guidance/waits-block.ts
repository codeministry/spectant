import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, model } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import type { GuidanceEntry } from '../../../../../../core/src/files';
import { waitingEntries } from '../../../core/model/guidance-entry';
import { UiIcon } from '../../icons/icon';
import { UiCard } from '../card/card';
import { UiChip } from '../chip/chip';
import { UiCommandChip } from '../command-chip/command-chip';
import { UiGlyph } from '../glyph/glyph';
import { UiDisclosure } from '../overlay/disclosure';
import { UiPriority } from '../priority/priority';
import { type RelativeFormat, relativeParts, type RelativeUnit, UiRelativeTime } from '../relative-time/relative-time';
import { UiSectionHeader } from '../section-header/section-header';
import { UiFlatTile } from './flat-tile';
import { GuidanceReasonPipe } from './guidance-reason.pipe';
import { TILE_LIMIT } from './tiles';

/** One entry's identity within a `waits` list: spec, item kind and ref name it (core never lists one item twice). */
export const waitsKey = (entry: GuidanceEntry): string => `${entry.spec}:${entry.item}:${entry.ref ?? ''}`;

/** Stands in for a missing part of a tile's name, so the part is dropped whatever the catalogue's word order. */
const ABSENT = '\u0000';

/**
 * The block "Waits on you" (spec 020, ISC-238; design.md § Gemeinsame Bausteine per viewport, § Viewport-übergreifend
 * wins): a section header (level 3 by default, `level` 2 on the dashboard, spec 058) with the total as a `count` chip
 * and the `user-round` icon, never the hourglass of 040's `waiting`. Without an entry the block holds one sentence with
 * the `done` glyph, never an empty card. Two forms:
 *
 * - `stack` (the spec page): the top entry highlighted in a `ui-card` with its side edge in `--ques-ink` (the spec ID as
 *   a link, the title on one clamped line, `ui-priority`, the reason as a whole sentence, the command as
 *   `ui-command-chip`, "waiting 2 d"); up to `limit` more entries follow as links with their reason, each with its own
 *   chip only under `chips`; past them "+n more" links to `moreLink#moreFragment`.
 * - `tiles` (spec 064, ISC-478; design.md § Across viewports; `/` and `/w/<ws>`): every entry the same `ui-flat-tile`
 *   in an `<ol class="tiles">`, none highlighted: the `waiting` glyph, the ID with its kind or ref chip, the spec's
 *   title as the main text (one line, cut with an ellipsis, the full title in the link's `title`), the copy chip where
 *   the entry has a command (its manual hint in the toast), "waiting 2 d". The reason sentence is never visible, only
 *   the tile's accessible description. `TILE_LIMIT` tiles stand; past them `more` `fold` folds the rest behind "Show
 *   all n" with a chevron (`open`, the dashboard's `#waiting`), `more` `link` leads to `moreLink#moreFragment` with an
 *   arrow (the start).
 */
@Component({
  selector: 'ui-waits-block',
  imports: [GuidanceReasonPipe, NgTemplateOutlet, RouterLink, TranslocoPipe, UiCard, UiChip, UiCommandChip, UiDisclosure, UiFlatTile, UiGlyph, UiIcon, UiPriority, UiRelativeTime, UiSectionHeader],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-count]': 'entries().length', '[attr.data-chips]': "chips() ? '' : null" },
  styleUrl: './waits-block.css',
  templateUrl: './waits-block.html',
})
export class UiWaitsBlock {
  private readonly transloco = inject(TranslocoService);

  /** `guidance.waits` of the workspace or the spec, in core's order (ISC-237); shown as it is, never re-sorted. */
  readonly entries = input.required<readonly GuidanceEntry[]>();
  /** The workspace slug the spec links resolve in (`/w/<ws>/s/<id>`). */
  readonly workspace = input.required<string>();
  /** How many entries follow the highlighted one in the `stack` form; null lists them all. */
  readonly limit = input<number | null>(4);
  /** A copy chip on every row of the `stack` form, not only the top entry (the spec page). */
  readonly chips = input(false);
  /** Where "+n more" (`stack`) or "Show all n" (`tiles`, `more` `link`) leads (`/w/<ws>`); null shows no link. */
  readonly moreLink = input<string | null>(null);
  /** The fragment of `moreLink`, the section that lists every entry. */
  readonly moreFragment = input('waiting');
  /**
   * `spec`: the block of one spec's page (spec 020 T20, design.md § Desktop Spec-Seite): each entry names its reference
   * (`ISC-n`, `Tn`, the question's ref) instead of the spec number, with `ui-chip` small "manual", "operator" or
   * "question", and links to its row in the Claims or Tasks tab (`#claim-ISC-n`, `#task-Tn`); a question and the spec
   * itself link to the spec dashboard. `workspace` (the default) names the spec and links to its page.
   */
  readonly scope = input<'workspace' | 'spec'>('workspace');
  /** The id of the block's heading, the section's accessible name; unique on the page. */
  readonly headingId = input('waits-heading');
  /**
   * The level of the block's heading (spec 058, T14): 3, the default, under the spec page's own sections; 2 on the
   * dashboard, where the block is a sibling of the other sections directly under the page's h1.
   */
  readonly level = input<2 | 3>(3);
  /** The block's form: `stack` (the default, the spec page) or `tiles` (spec 064, the start and the dashboard). */
  readonly form = input<'stack' | 'tiles'>('stack');
  /** What follows the `TILE_LIMIT` standing tiles: the fold "Show all n" (the dashboard) or a link (the start). */
  readonly more = input<'fold' | 'link'>('fold');
  /**
   * The spec titles by spec id (`NNN` → title), the tiles' main text (ISC-478). An entry's own `title` is its spec's
   * only for a spec entry (a claim's, task's or question's is its own text), so the caller passes what its body knows;
   * without it a spec entry of the same spec in the list names it, else the entry's own title stands.
   */
  readonly titles = input<Readonly<Partial<Record<string, string>>>>({});
  /** The `tiles` fold's state, two-way: the `#waiting` section opens it on arrival over its fragment. */
  readonly open = model(false);

  protected readonly top = computed(() => this.entries()[0] ?? null);
  protected readonly rest = computed(() => {
    const limit = this.limit();
    return this.entries().slice(1, limit === null ? undefined : 1 + Math.max(0, limit));
  });
  /** The `tiles` form's standing tiles and the rest past `TILE_LIMIT`, in core's order. */
  protected readonly lead = computed(() => this.entries().slice(0, TILE_LIMIT));
  protected readonly folded = computed(() => this.entries().slice(TILE_LIMIT));
  /** The entries past the highlighted one and the listed rows of the `stack` form. */
  protected readonly moreCount = computed(() => Math.max(0, this.entries().length - 1 - this.rest().length));
  /** The spec titles the list's own spec entries carry, those folded under a front entry included (spec 070). */
  private readonly listed = computed(() => new Map(waitingEntries(this.entries()).filter((e) => e.item === 'spec').map((e) => [e.spec, e.title])));

  protected readonly key = waitsKey;
  protected specLink(entry: GuidanceEntry): string[] {
    const page = ['/w', this.workspace(), 's', entry.spec];
    if (this.scope() !== 'spec') return page;
    if (entry.item === 'claim') return [...page, 'claims'];
    return entry.item === 'task' ? [...page, 'tasks'] : page;
  }

  /** The row an entry of the spec scope lands on; none for a spec-wide link. */
  protected fragmentOf(entry: GuidanceEntry): string | undefined {
    if (this.scope() !== 'spec' || entry.ref === null) return undefined;
    if (entry.item === 'claim') return `claim-${entry.ref}`;
    return entry.item === 'task' ? `task-${entry.ref}` : undefined;
  }

  /** The spec number, or in the spec scope the entry's own reference (the spec's own entry keeps its number). */
  protected label(entry: GuidanceEntry): string {
    return this.scope() === 'spec' && entry.ref !== null ? entry.ref : entry.spec;
  }

  /** The kind word of an item entry in the spec scope (`specDashboard.context.kinds.*`); null elsewhere. */
  protected kindKey(entry: GuidanceEntry): 'manual' | 'operator' | 'question' | null {
    if (this.scope() !== 'spec') return null;
    return entry.item === 'claim' ? 'manual' : entry.item === 'task' ? 'operator' : entry.item === 'question' ? 'question' : null;
  }

  /** The title of the entry's spec, a tile's main text and `title`. */
  protected specTitle(entry: GuidanceEntry): string {
    return this.titles()[entry.spec] ?? this.listed().get(entry.spec) ?? entry.title;
  }

  /** A tile's accessible name, "064 <title> · T2 · waiting 2 d", without the ref or the time where it has none. */
  protected tileName(entry: GuidanceEntry): string {
    const since = entry.since === null ? null : relativeParts(new Date(entry.since).getTime(), Date.now());
    const name: string = this.transloco.translate('guidance.waits.tileName', {
      id: this.label(entry),
      title: this.specTitle(entry),
      ref: entry.ref ?? ABSENT,
      time: since ? this.elapsed(since.value, since.unit) : ABSENT,
    });
    return name.split(' · ').filter((part) => !part.includes(ABSENT)).join(' · ');
  }

  /** "2 d", the unit's own word from the catalogue. */
  private elapsed(value: number, unit: RelativeUnit): string {
    const word: string = this.transloco.translate(`claims.units.${unit}`);
    return `${value} ${word}`;
  }

  /** "waiting 2 d" (de „seit 2 d"). */
  protected readonly waiting: RelativeFormat = (value, unit) =>
    this.transloco.translate('guidance.waits.since', { time: this.elapsed(value, unit) });
}

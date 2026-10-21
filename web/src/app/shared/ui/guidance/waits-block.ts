import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, model } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import type { GuidanceEntry } from '../../../../../../core/src/files';
import { UiIcon } from '../../icons/icon';
import { UiCard } from '../card/card';
import { UiChip } from '../chip/chip';
import { UiCommandChip } from '../command-chip/command-chip';
import { UiGlyph } from '../glyph/glyph';
import { UiDisclosure } from '../overlay/disclosure';
import { UiPriority } from '../priority/priority';
import { type RelativeFormat, UiRelativeTime } from '../relative-time/relative-time';
import { UiSectionHeader } from '../section-header/section-header';
import { GuidanceReasonPipe } from './guidance-reason.pipe';

/** One entry's identity within a `waits` list: spec, item kind and ref name it (core never lists one item twice). */
export const waitsKey = (entry: GuidanceEntry): string => `${entry.spec}:${entry.item}:${entry.ref ?? ''}`;

/**
 * The block "Waits on you" (spec 020, ISC-238; design.md § Gemeinsame Bausteine per viewport, § Viewport-übergreifend
 * wins): a section header (level 3 by default, `level` 2 on the dashboard, spec 058) with the total as a `count` chip and the `user-round` icon, never the hourglass of
 * 040's `waiting`. The top entry stands highlighted in a `ui-card` with its side edge in `--ques-ink`: the spec ID as a
 * link, the title on one clamped line, `ui-priority`, the reason as a whole sentence (`guidanceReason`, never cut), the
 * command as `ui-command-chip` and "waiting 2 d" as `ui-relative-time` from `since`. Up to `limit` more entries follow
 * as links to their spec with their reason, each with its own chip only under `chips` (the `#waiting` section and the
 * spec page); past them "+n more" links to `moreLink#moreFragment`, which the caller names. Without an entry the block
 * holds one sentence, never an empty card. Only existing primitives are composed; no new token. With `form`
 * `card-rows` (the dashboard, spec 058 T40, T46) every entry is one 44 px row in one unpadded `ui-card` under
 * hairlines, like Next up's card form: ID, reason and copy chip, no title, priority or "waiting" line; the first
 * `shown` rows stand, the rest fold behind "Show all n" at the bottom of the card.
 */
@Component({
  selector: 'ui-waits-block',
  imports: [GuidanceReasonPipe, NgTemplateOutlet, RouterLink, TranslocoPipe, UiCard, UiChip, UiCommandChip, UiDisclosure, UiGlyph, UiIcon, UiPriority, UiRelativeTime, UiSectionHeader],
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
  /** How many entries follow the highlighted one; null lists them all (the `#waiting` section). */
  readonly limit = input<number | null>(4);
  /** A copy chip on every row, not only the top entry (the `#waiting` section and the spec page). */
  readonly chips = input(false);
  /** Where "+n more" leads (`/w/<ws>`); null shows no link. The caller knows the route. */
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
   * dashboard, where the block is a sibling of Next up and Warnings directly under the page's h1.
   */
  readonly level = input<2 | 3>(3);
  /**
   * The block's form (spec 058, T40, T46, ISC-401, ISC-399): `stack`, the default, the top entry highlighted in a
   * `ui-card` with title, priority and "waiting n d", `limit` rows and "+n more" below it (the start and the spec
   * page); `card-rows` on the dashboard, every entry one 44 px row with ID, reason and copy chip in one card like Next
   * up's, the first `shown` standing and the rest behind the fold "Show all n" at the card's bottom.
   */
  readonly form = input<'stack' | 'card-rows'>('stack');
  /** How many rows stand before the fold in the `card-rows` form (Next up's `NEXT_UP_SHOWN`). */
  readonly shown = input(3);
  /** The `card-rows` fold's state, two-way: the `#waiting` section opens it on arrival over its fragment. */
  readonly open = model(false);

  protected readonly top = computed(() => this.entries()[0] ?? null);
  protected readonly rest = computed(() => {
    const limit = this.limit();
    return this.entries().slice(1, limit === null ? undefined : 1 + Math.max(0, limit));
  });
  /** The `card-rows` form's standing rows and the folded rest, in core's order. */
  protected readonly lead = computed(() => this.entries().slice(0, Math.max(1, this.shown())));
  protected readonly folded = computed(() => this.entries().slice(Math.max(1, this.shown())));
  /** The entries past the highlighted one and the listed rows. */
  protected readonly more = computed(() => Math.max(0, this.entries().length - 1 - this.rest().length));

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

  /** "waiting 2 d" (de „seit 2 d"), the unit's own word from the catalogue. */
  protected readonly waiting: RelativeFormat = (value, unit) => {
    const word: string = this.transloco.translate(`claims.units.${unit}`);
    return this.transloco.translate('guidance.waits.since', { time: `${value} ${word}` });
  };
}

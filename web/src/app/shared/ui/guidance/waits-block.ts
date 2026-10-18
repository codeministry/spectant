import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import type { GuidanceEntry } from '../../../../../../core/src/files';
import { UiIcon } from '../../icons/icon';
import { UiCard } from '../card/card';
import { UiChip } from '../chip/chip';
import { UiCommandChip } from '../command-chip/command-chip';
import { UiGlyph } from '../glyph/glyph';
import { UiPriority } from '../priority/priority';
import { type RelativeFormat, UiRelativeTime } from '../relative-time/relative-time';
import { UiSectionHeader } from '../section-header/section-header';
import { GuidanceReasonPipe } from './guidance-reason.pipe';

/** One entry's identity within a `waits` list: spec, item kind and ref name it (core never lists one item twice). */
export const waitsKey = (entry: GuidanceEntry): string => `${entry.spec}:${entry.item}:${entry.ref ?? ''}`;

/**
 * The block "Waits on you" (spec 020, ISC-238; design.md § Gemeinsame Bausteine per viewport, § Viewport-übergreifend
 * wins): a level-3 section header with the total as a `count` chip and the `user-round` icon, never the hourglass of
 * 040's `waiting`. The top entry stands highlighted in a `ui-card` with its side edge in `--ques-ink`: the spec ID as a
 * link, the title on one clamped line, `ui-priority`, the reason as a whole sentence (`guidanceReason`, never cut), the
 * command as `ui-command-chip` and "waiting 2 d" as `ui-relative-time` from `since`. Up to `limit` more entries follow
 * as links to their spec with their reason, each with its own chip only under `chips` (the `#waiting` section and the
 * spec page); past them "+n more" links to `moreLink#moreFragment`, which the caller names. Without an entry the block
 * holds one sentence, never an empty card. Only existing primitives are composed; no new token.
 */
@Component({
  selector: 'ui-waits-block',
  imports: [GuidanceReasonPipe, RouterLink, TranslocoPipe, UiCard, UiChip, UiCommandChip, UiGlyph, UiIcon, UiPriority, UiRelativeTime, UiSectionHeader],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-count]': 'entries().length' },
  styles: `
    :host { display: block; min-inline-size: 0; }
    ui-section-header { margin-block-end: 8px; }
    .meta { display: inline-flex; gap: 6px; align-items: center; color: var(--ques-ink); }
    .top { --edge: var(--ques-ink); display: grid; gap: 8px; }
    .head { display: flex; gap: 8px; align-items: center; min-inline-size: 0; }
    .id { flex: none; color: var(--ques-ink); font-family: var(--font-mono); font-variant-numeric: tabular-nums; font-weight: 600; }
    .title { flex: 1 1 auto; overflow: hidden; min-inline-size: 0; font-size: 15px; font-weight: 600; line-height: 24px; text-overflow: ellipsis; white-space: nowrap; }
    .reason { margin: 0; overflow-wrap: break-word; }
    .top .reason { font-size: 15px; line-height: 24px; }
    .foot { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: center; justify-content: space-between; margin-block-start: 4px; }
    .since { color: var(--muted-ink); font-size: 12px; line-height: 16px; }
    .rest { margin: 8px 0 0; padding: 0; list-style: none; border-block-start: 1px solid var(--line); }
    .rest li { display: flex; flex-wrap: wrap; gap: 4px 12px; align-items: center; padding-block: 8px; border-block-end: 1px solid var(--line); }
    .rest li:last-child { border-block-end: 0; }
    .row { display: flex; flex: 1 1 24ch; gap: 8px; align-items: flex-start; min-block-size: 44px; min-inline-size: 0; color: inherit; text-decoration: none; }
    .row:hover .reason { text-decoration: underline; }
    .row .id { line-height: 20px; }
    .row .reason { flex: 1 1 auto; min-inline-size: 0; color: var(--muted-ink); font-size: 13px; line-height: 20px; }
    .row ui-icon { flex: none; padding-block-start: 2px; color: var(--muted-ink); }
    .more { display: inline-flex; gap: 4px; align-items: center; min-block-size: 44px; color: var(--disp-ink); font-size: 13px; line-height: 20px; }
    .empty { display: flex; gap: 8px; align-items: center; margin: 0; color: var(--muted-ink); font-size: 13px; line-height: 20px; }
    @media (forced-colors: active) {
      .id, .meta, .more { color: LinkText; }
    }
  `,
  template: `
    <section [attr.aria-labelledby]="headingId()">
      <ui-section-header [heading]="'guidance.waits.label' | transloco" [level]="3" [headingId]="headingId()">
        <span meta class="meta">
          <ui-icon name="user-round" [size]="12" />
          <ui-chip variant="count" tone="secondary">{{ entries().length }}</ui-chip>
        </span>
      </ui-section-header>
      @if (top(); as first) {
        <ui-card class="top" side [padding]="16" data-top>
          <div class="head">
            <a class="id" [routerLink]="specLink(first)">{{ first.spec }}</a>
            @if (first.ref) {
              <ui-chip variant="mono">{{ first.ref }}</ui-chip>
            }
            <span class="title" [title]="first.title">{{ first.title }}</span>
            <ui-priority [value]="first.priority" />
          </div>
          <p class="reason" data-reason>{{ first.reason | guidanceReason }}</p>
          <div class="foot">
            @if (first.command; as cmd) {
              <ui-command-chip
                [command]="cmd"
                [copyLabel]="'common.copyCommand' | transloco"
                [copiedLabel]="'common.copied' | transloco: { command: cmd }"
                [manualHint]="'common.copyFallback' | transloco"
              />
            }
            @if (first.since; as since) {
              <ui-relative-time class="since" [date]="since" [format]="waiting" />
            }
          </div>
        </ui-card>
        @if (rest().length > 0) {
          <ol class="rest">
            @for (entry of rest(); track key(entry)) {
              <li data-row>
                <a class="row" [routerLink]="specLink(entry)">
                  <span class="id">{{ entry.spec }}</span>
                  @if (entry.ref) {
                    <ui-chip variant="mono">{{ entry.ref }}</ui-chip>
                  }
                  <span class="reason" data-reason>{{ entry.reason | guidanceReason }}</span>
                  @if (!chips()) {
                    <ui-icon name="chevron-right" [size]="16" />
                  }
                </a>
                @if (chips() && entry.command; as cmd) {
                  <ui-command-chip
                    [command]="cmd"
                    [copyLabel]="'common.copyCommand' | transloco"
                    [copiedLabel]="'common.copied' | transloco: { command: cmd }"
                    [manualHint]="'common.copyFallback' | transloco"
                  />
                }
              </li>
            }
          </ol>
        }
        @if (more() > 0 && moreLink(); as link) {
          <a class="more" data-more [routerLink]="link" [fragment]="moreFragment()">
            {{ 'guidance.waits.more' | transloco: { n: more() } }}
            <ui-icon name="arrow-right" [size]="12" />
          </a>
        }
      } @else {
        <p class="empty" data-empty>
          <ui-glyph state="done" family="item" [size]="14" />
          {{ 'guidance.waits.empty' | transloco }}
        </p>
      }
    </section>
  `,
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
  /** The id of the block's heading, the section's accessible name; unique on the page. */
  readonly headingId = input('waits-heading');

  protected readonly top = computed(() => this.entries()[0] ?? null);
  protected readonly rest = computed(() => {
    const limit = this.limit();
    return this.entries().slice(1, limit === null ? undefined : 1 + Math.max(0, limit));
  });
  /** The entries past the highlighted one and the listed rows. */
  protected readonly more = computed(() => Math.max(0, this.entries().length - 1 - this.rest().length));

  protected readonly key = waitsKey;
  protected specLink(entry: GuidanceEntry): string[] {
    return ['/w', this.workspace(), 's', entry.spec];
  }

  /** "waiting 2 d" (de „seit 2 d"), the unit's own word from the catalogue. */
  protected readonly waiting: RelativeFormat = (value, unit) => {
    const word: string = this.transloco.translate(`claims.units.${unit}`);
    return this.transloco.translate('guidance.waits.since', { time: `${value} ${word}` });
  };
}

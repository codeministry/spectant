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
 * wins): a section header (level 3 by default, `level` 2 on the dashboard, spec 058) with the total as a `count` chip and the `user-round` icon, never the hourglass of
 * 040's `waiting`. The top entry stands highlighted in a `ui-card` with its side edge in `--ques-ink`: the spec ID as a
 * link, the title on one clamped line, `ui-priority`, the reason as a whole sentence (`guidanceReason`, never cut), the
 * command as `ui-command-chip` and "waiting 2 d" as `ui-relative-time` from `since`. Up to `limit` more entries follow
 * as links to their spec with their reason, each with its own chip only under `chips` (the `#waiting` section and the
 * spec page); past them "+n more" links to `moreLink#moreFragment`, which the caller names. Without an entry the block
 * holds one sentence, never an empty card. Only existing primitives are composed; no new token. With `topForm` `row`
 * (the dashboard, spec 058 T40) the top entry stands as one 44 px row like the folded ones: ID, reason and copy chip,
 * no card, no title, priority or "waiting" line.
 */
@Component({
  selector: 'ui-waits-block',
  imports: [GuidanceReasonPipe, RouterLink, TranslocoPipe, UiCard, UiChip, UiCommandChip, UiGlyph, UiIcon, UiPriority, UiRelativeTime, UiSectionHeader],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-count]': 'entries().length', '[attr.data-chips]': "chips() ? '' : null" },
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
    /* The short list on the start (no chips): the whole row is the 44 px link with 12 px inner padding (design.md § Start: 44 to 64 px a row). */
    :host(:not([data-chips])) .rest li { padding-block: 0; }
    :host(:not([data-chips])) .row { box-sizing: border-box; padding-block: 12px; }
    .row .id { line-height: 20px; }
    .row .reason { flex: 1 1 auto; min-inline-size: 0; color: var(--muted-ink); font-size: 13px; line-height: 20px; }
    /* The top entry as a row (topForm row): the folded rows' markup, 44 px with the text centred, the chip beside it. */
    .top-row { display: flex; flex-wrap: wrap; gap: 4px 12px; align-items: center; }
    .top-row .row { box-sizing: border-box; padding-block: 12px; }
    .row ui-icon { flex: none; padding-block-start: 2px; color: var(--muted-ink); }
    .more { display: inline-flex; gap: 4px; align-items: center; min-block-size: 44px; color: var(--disp-ink); font-size: 13px; line-height: 20px; }
    .empty { display: flex; gap: 8px; align-items: center; margin: 0; color: var(--muted-ink); font-size: 13px; line-height: 20px; }
    @media (forced-colors: active) {
      .id, .meta, .more { color: LinkText; }
    }
  `,
  template: `
    <section [attr.aria-labelledby]="headingId()">
      <ui-section-header [heading]="'guidance.waits.label' | transloco" [level]="level()" [headingId]="headingId()">
        <span meta class="meta">
          <ui-icon name="user-round" [size]="12" />
          <ui-chip variant="count" tone="secondary">{{ entries().length }}</ui-chip>
        </span>
      </ui-section-header>
      @if (top(); as first) {
        @if (topForm() === 'row') {
          <div class="top-row" data-top data-top-row [attr.data-item]="first.item">
            <a class="row" [routerLink]="specLink(first)" [fragment]="fragmentOf(first)">
              <span class="id">{{ label(first) }}</span>
              @if (kindKey(first); as kind) {
                <ui-chip variant="small" data-kind>{{ 'specDashboard.context.kinds.' + kind | transloco }}</ui-chip>
              } @else if (first.ref) {
                <ui-chip variant="mono">{{ first.ref }}</ui-chip>
              }
              <span class="reason" data-reason>{{ first.reason | guidanceReason }}</span>
            </a>
            @if (first.command; as cmd) {
              <ui-command-chip
                [command]="cmd"
                [context]="'orientation.chipContext.waits' | transloco: { what: first.ref ? first.spec + ' ' + first.ref : first.spec }"
                [copyLabel]="'common.copyCommand' | transloco"
                [copiedLabel]="'common.copied' | transloco: { command: cmd }"
                [manualHint]="'common.copyFallback' | transloco"
              />
            }
          </div>
        } @else {
          <ui-card class="top" side [padding]="16" data-top>
            <div class="head">
              <a class="id" [routerLink]="specLink(first)" [fragment]="fragmentOf(first)">{{ label(first) }}</a>
              @if (kindKey(first); as kind) {
                <ui-chip variant="small" data-kind>{{ 'specDashboard.context.kinds.' + kind | transloco }}</ui-chip>
              } @else if (first.ref) {
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
                  [context]="'orientation.chipContext.waits' | transloco: { what: first.ref ? first.spec + ' ' + first.ref : first.spec }"
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
        }
        @if (rest().length > 0) {
          <ol class="rest">
            @for (entry of rest(); track key(entry)) {
              <li data-row [attr.data-item]="entry.item">
                <a class="row" [routerLink]="specLink(entry)" [fragment]="fragmentOf(entry)">
                  <span class="id">{{ label(entry) }}</span>
                  @if (kindKey(entry); as kind) {
                    <ui-chip variant="small" data-kind>{{ 'specDashboard.context.kinds.' + kind | transloco }}</ui-chip>
                  } @else if (entry.ref) {
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
                    [context]="'orientation.chipContext.waits' | transloco: { what: entry.ref ? entry.spec + ' ' + entry.ref : entry.spec }"
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
   * The top entry's form (spec 058, T40, ISC-401): `card`, the default, highlighted in a `ui-card` with title,
   * priority and "waiting n d" (the start and the spec page); `row` on the dashboard, one 44 px row like the folded
   * ones with ID, reason and copy chip, so KPI band, TL;DR, this block and Next up fit one 1440 px screen.
   */
  readonly topForm = input<'card' | 'row'>('card');

  protected readonly top = computed(() => this.entries()[0] ?? null);
  protected readonly rest = computed(() => {
    const limit = this.limit();
    return this.entries().slice(1, limit === null ? undefined : 1 + Math.max(0, limit));
  });
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

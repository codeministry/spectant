import { afterNextRender, ChangeDetectionStrategy, Component, computed, effect, ElementRef, inject, Injector, input, linkedSignal, ViewEncapsulation } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import type { GuidanceEntry } from '../../../../../../core/src/files';
import { UiChip } from '../../../shared/ui/chip/chip';
import { UiCommandChip } from '../../../shared/ui/command-chip/command-chip';
import { GuidanceReasonPipe } from '../../../shared/ui/guidance/guidance-reason.pipe';
import { UiWaitsBlock, waitsKey } from '../../../shared/ui/guidance/waits-block';
import { UiDisclosure } from '../../../shared/ui/overlay/disclosure';

/** The fragment of `/w/:ws` that lists every waiting entry; the start's "+n more" leads here (ISC-238). */
export const WAITING_FRAGMENT = 'waiting';
/**
 * Rows under the highlighted entry before the rest fold (spec 021, ISC-246.1, the P3 short form): none, so the block
 * is its header, the top entry whole and the fold "+n more" right below it.
 */
export const WAITING_SHOWN = 0;

/**
 * The workspace dashboard's section `#waiting` (spec 020 T17, ISC-238; design.md § Workspace-Dashboard), in the short
 * form of spec 021 (ISC-246.1, design.md § P3 heights): the `ui-waits-block` of `guidance.waits` holds the header with
 * the count chip and the top entry whole (spec, reason never shortened, copy chip), since spec 058 (T40, ISC-401) as a
 * 44 px row like the folded ones instead of a card (`topForm` `row`); every other entry sits in core's
 * order behind `ui-disclosure` "+n more" right below it, each row with its reason and its chip. The toggle's
 * accessible name starts with its visible text and names the list ("+6 more · Waits on you, show all 7"). Arriving
 * over `#waiting` opens the disclosure, scrolls the section into view and focuses it (`tabindex="-1"`, DS-APP-35), so
 * the fragment lists every entry. The dashboard has one column without a rail at every width (spec 058): the section
 * follows the KPI band and the TL;DR, before Next up and Warnings, with its heading at level 2 under the page's h1.
 *
 * Unencapsulated (like the Brief) so the fold's toggle can be a 28 px text row instead of the disclosure's 48 px
 * summary; under a coarse pointer a `::before` widens its hit area to 44 px without growing the row. Every selector
 * is scoped by the host element.
 */
@Component({
  selector: 'app-waiting-section',
  imports: [GuidanceReasonPipe, RouterLink, TranslocoPipe, UiChip, UiCommandChip, UiDisclosure, UiWaitsBlock],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  host: { id: WAITING_FRAGMENT, tabindex: '-1', 'data-ui': 'waiting-section', '[attr.data-count]': 'entries().length' },
  styles: `
    app-waiting-section { display: grid; gap: 0; min-inline-size: 0; scroll-margin-block-start: 80px; }
    app-waiting-section .waits-fold > .head .summary { position: relative; min-block-size: 28px; color: var(--disp-ink); font-size: 13px; line-height: 20px; }
    app-waiting-section .waits-visually-hidden { position: absolute; inline-size: 1px; block-size: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
    @media (pointer: coarse) {
      app-waiting-section .waits-fold > .head .summary::before { position: absolute; inset-block: -8px; inset-inline: 0; content: ''; }
    }
    app-waiting-section .waits-rest { margin: 0; padding: 0; list-style: none; border-block-start: 1px solid var(--line); }
    app-waiting-section .waits-rest li { display: flex; flex-wrap: wrap; gap: 4px 12px; align-items: center; padding-block: 8px; border-block-end: 1px solid var(--line); }
    app-waiting-section .waits-rest li:last-child { border-block-end: 0; }
    app-waiting-section .waits-row { display: flex; flex: 1 1 24ch; gap: 8px; align-items: flex-start; min-block-size: 44px; min-inline-size: 0; color: inherit; text-decoration: none; }
    app-waiting-section .waits-row:hover .waits-reason { text-decoration: underline; }
    app-waiting-section .waits-id { flex: none; color: var(--ques-ink); font-family: var(--font-mono); font-variant-numeric: tabular-nums; font-weight: 600; line-height: 20px; }
    app-waiting-section .waits-reason { flex: 1 1 auto; min-inline-size: 0; margin: 0; color: var(--muted-ink); font-size: 13px; line-height: 20px; overflow-wrap: break-word; }
    @media (forced-colors: active) {
      app-waiting-section .waits-id, app-waiting-section .waits-fold > .head .summary { color: LinkText; }
    }
  `,
  template: `
    <ui-waits-block [entries]="entries()" [workspace]="workspace()" [limit]="folds() ? shown : null" [chips]="true" [headingId]="headingId()" [level]="level()" topForm="row" />
    @if (folds()) {
      <ui-disclosure class="waits-fold" data-show-all [(open)]="open">
        <span uiDisclosureSummary data-fold-toggle>
          @if (open()) {
            <span aria-hidden="true" data-visible>{{ 'guidance.waits.fewer' | transloco }}</span>
            <span class="waits-visually-hidden" data-name>{{ 'guidance.waits.fewerName' | transloco }}</span>
          } @else {
            <span aria-hidden="true" data-visible>{{ 'guidance.waits.more' | transloco: { n: folded().length } }}</span>
            <span class="waits-visually-hidden" data-name>{{ 'guidance.waits.foldName' | transloco: { n: folded().length, count: entries().length } }}</span>
          }
        </span>
        <ol class="waits-rest">
          @for (entry of folded(); track key(entry)) {
            <li data-row>
              <a class="waits-row" [routerLink]="['/w', workspace(), 's', entry.spec]">
                <span class="waits-id id">{{ entry.spec }}</span>
                @if (entry.ref) {
                  <ui-chip variant="mono">{{ entry.ref }}</ui-chip>
                }
                <span class="waits-reason" data-reason>{{ entry.reason | guidanceReason }}</span>
              </a>
              @if (entry.command; as cmd) {
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
      </ui-disclosure>
    }
  `,
})
export class WaitingSection {
  /** `guidance.waits` of the workspace, in core's order (ISC-237). */
  readonly entries = input.required<readonly GuidanceEntry[]>();
  /** The workspace slug the spec links resolve in. */
  readonly workspace = input.required<string>();
  /** The block heading's id; unique on the page. */
  readonly headingId = input('waiting-heading');
  /** The block heading's level (spec 058): 2 under the dashboard's h1; 3, the default, as `ui-waits-block` has it. */
  readonly level = input<2 | 3>(3);

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly fragment = toSignal(inject(ActivatedRoute).fragment, { initialValue: null });

  protected readonly shown = WAITING_SHOWN;
  protected readonly key = waitsKey;
  /** More than the top entry and the shown rows: the rest fold. */
  protected readonly folds = computed(() => this.entries().length > 1 + WAITING_SHOWN);
  protected readonly folded = computed(() => this.entries().slice(1 + WAITING_SHOWN));
  /** Open on arrival over `#waiting`, else closed; the user's toggle wins until the fragment changes again. */
  protected readonly open = linkedSignal(() => this.fragment() === WAITING_FRAGMENT);

  constructor() {
    effect(() => {
      if (this.fragment() !== WAITING_FRAGMENT) return;
      afterNextRender(
        () => {
          // Focus scrolls the section into view (its scroll margin clears the sticky header).
          this.host.nativeElement.focus();
        },
        { injector: this.injector },
      );
    });
  }
}

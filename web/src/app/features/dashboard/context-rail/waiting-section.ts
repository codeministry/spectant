import { afterNextRender, ChangeDetectionStrategy, Component, computed, effect, ElementRef, inject, Injector, input, linkedSignal } from '@angular/core';
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
/** Rows under the highlighted entry before the rest fold into "Show all n" (design.md § Desktop: from five entries). */
export const WAITING_SHOWN = 4;

/**
 * The workspace dashboard's section `#waiting` (spec 020 T17, ISC-238; design.md § Workspace-Dashboard): the
 * `ui-waits-block` of `guidance.waits` with a copy chip on every row. Five entries or fewer are listed whole; past
 * them the block shows the top entry and four rows, and the rest sit in `ui-disclosure` "Show all n" in core's order,
 * each row with its reason and its chip. Arriving over `#waiting` opens the disclosure, scrolls the section into view
 * and focuses it (`tabindex="-1"`, DS-APP-35), so the fragment lists every entry. The context rail places it as the
 * rail's first block at wide, the page before the KPI card below wide.
 */
@Component({
  selector: 'app-waiting-section',
  imports: [GuidanceReasonPipe, RouterLink, TranslocoPipe, UiChip, UiCommandChip, UiDisclosure, UiWaitsBlock],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { id: WAITING_FRAGMENT, tabindex: '-1', 'data-ui': 'waiting-section', '[attr.data-count]': 'entries().length' },
  styles: `
    :host { display: grid; gap: 8px; min-inline-size: 0; scroll-margin-block-start: 80px; }
    .rest { margin: 0; padding: 0; list-style: none; }
    .rest li { display: flex; flex-wrap: wrap; gap: 4px 12px; align-items: center; padding-block: 8px; border-block-end: 1px solid var(--line); }
    .rest li:last-child { border-block-end: 0; }
    .row { display: flex; flex: 1 1 24ch; gap: 8px; align-items: flex-start; min-block-size: 44px; min-inline-size: 0; color: inherit; text-decoration: none; }
    .row:hover .reason { text-decoration: underline; }
    .id { flex: none; color: var(--ques-ink); font-family: var(--font-mono); font-variant-numeric: tabular-nums; font-weight: 600; line-height: 20px; }
    .reason { flex: 1 1 auto; min-inline-size: 0; margin: 0; color: var(--muted-ink); font-size: 13px; line-height: 20px; overflow-wrap: break-word; }
    @media (forced-colors: active) {
      .id { color: LinkText; }
    }
  `,
  template: `
    <ui-waits-block [entries]="entries()" [workspace]="workspace()" [limit]="folds() ? shown : null" [chips]="true" [headingId]="headingId()" />
    @if (folds()) {
      <ui-disclosure data-show-all [(open)]="open">
        <span uiDisclosureSummary>{{ 'guidance.waits.showAll' | transloco: { count: entries().length } }}</span>
        <ol class="rest">
          @for (entry of folded(); track key(entry)) {
            <li data-row>
              <a class="row" [routerLink]="['/w', workspace(), 's', entry.spec]">
                <span class="id">{{ entry.spec }}</span>
                @if (entry.ref) {
                  <ui-chip variant="mono">{{ entry.ref }}</ui-chip>
                }
                <span class="reason" data-reason>{{ entry.reason | guidanceReason }}</span>
              </a>
              @if (entry.command; as cmd) {
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

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly fragment = toSignal(inject(ActivatedRoute).fragment, { initialValue: null });

  protected readonly shown = WAITING_SHOWN;
  protected readonly key = waitsKey;
  /** More than the top entry and four rows: the rest fold. */
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

import { afterNextRender, ChangeDetectionStrategy, Component, effect, ElementRef, inject, Injector, input, linkedSignal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import type { GuidanceEntry } from '../../../../../../core/src/files';
import { UiWaitsBlock } from '../../../shared/ui/guidance/waits-block';

/** The fragment of `/w/:ws` that lists every waiting entry; the start's "+n more" leads here (ISC-238). */
export const WAITING_FRAGMENT = 'waiting';

/**
 * The workspace dashboard's section `#waiting` (spec 020 T17, ISC-238; design.md § Workspace-Dashboard): the
 * `ui-waits-block` of `guidance.waits` with the header and its count chip, since spec 064 (T14, ISC-478) in the form
 * `tiles`: every entry the same flat tile (ID, kind or ref, the spec's title from `titles`, copy chip, "waiting n d";
 * the reason only as the tile's description), the first `TILE_LIMIT` standing and every other entry in core's order
 * behind the fold "Show all n" (`more` `fold`). The toggle's accessible name starts with its visible text and names
 * the list ("Show all 7 · Waits on you").
 * Arriving over `#waiting` opens the fold, scrolls the section into view and focuses it (`tabindex="-1"`, DS-APP-35),
 * so the fragment lists every entry. The dashboard has one column without a rail at every width (spec 058): the
 * section follows the KPI band and the TL;DR, before Next up and Warnings, with its heading at level 2 under the h1.
 */
@Component({
  selector: 'app-waiting-section',
  imports: [UiWaitsBlock],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { id: WAITING_FRAGMENT, tabindex: '-1', 'data-ui': 'waiting-section', '[attr.data-count]': 'entries().length' },
  styleUrl: './waiting-section.css',
  templateUrl: './waiting-section.html',
})
export class WaitingSection {
  /** `guidance.waits` of the workspace, in core's order (ISC-237). */
  readonly entries = input.required<readonly GuidanceEntry[]>();
  /** The workspace slug the spec links resolve in. */
  readonly workspace = input.required<string>();
  /** The spec titles by spec id, the tiles' main text (ISC-478); see `UiWaitsBlock.titles`. */
  readonly titles = input<Readonly<Partial<Record<string, string>>>>({});
  /** The block heading's id; unique on the page. */
  readonly headingId = input('waiting-heading');
  /** The block heading's level (spec 058): 2 under the dashboard's h1; 3, the default, as `ui-waits-block` has it. */
  readonly level = input<2 | 3>(3);

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly fragment = toSignal(inject(ActivatedRoute).fragment, { initialValue: null });

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

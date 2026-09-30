import { ChangeDetectionStrategy, Component, computed, inject, input, model, output, ViewEncapsulation } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { renderMarkdown } from '../../../../../../core/src/markdown';
import { UiCard, UiChip, UiCommandChip } from '../../../shared/ui';
import { nextId } from '../../../shared/ui/overlay/ids';

/**
 * The fields of `DashboardBrief` (`core/src/dashboard.ts`) the Brief reads, re-declared structurally on purpose: a type
 * import of that module type-checks its whole value graph under the web tsconfig, which rejects it (see
 * `DashboardBody` in `core/api.service.ts`). The model's `brief` object is assignable as it is; nothing is reshaped.
 */
export interface BriefModel {
  /** tldr.md without its frontmatter. */
  readonly markdown: string;
  /** ISO 8601 from `generated:`; null when absent. */
  readonly generated: string | null;
  /** Core's verdict: a spec changed after `generated:`. */
  readonly stale: boolean;
}

/** The skill command that writes (or refreshes) `specs/tldr.md`. */
export const TLDR_COMMAND = '/spec-tldr';

/**
 * The Brief (T62, ported in T88 from the prototype's `[data-ui="brief"]`, `styles.css:342-349`): the workspace's TL;DR
 * under the KPI band, a card with a violet 3 px left edge. The header reads "TL;DR" (mono), "as of <date>" from
 * `generated:` and, when the model says so, a "stale" chip, with the `/spec-tldr` command chip pushed to the end. The
 * body holds the whole TL;DR, clipped to a few lines until the "More" button (`aria-expanded`, `aria-controls`)
 * expands it; the clip is visual only, so a screen reader reads the full text either way.
 *
 * - Fed only by the dashboard model's `brief` (`core/src/dashboard.ts`); staleness is core's verdict, never recomputed
 *   here. A workspace without `specs/tldr.md` (`brief: null`) renders nothing and the host is `hidden`.
 * - The markdown goes through core's one renderer (`core/src/markdown.ts`), which escapes every string and never
 *   passes raw HTML through; that is why its output may be trusted here, as the Notes and Docs views do.
 * - `open` (expanded) is a two-way model, so the page can bind it to a query param; `copied` passes a copy on for the
 *   page's live region.
 *
 * Not encapsulated: the prose is `[innerHTML]`; every selector in the stylesheet starts with `app-brief`.
 */
@Component({
  selector: 'app-brief',
  imports: [TranslocoPipe, UiCard, UiChip, UiCommandChip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  host: {
    '[attr.hidden]': "brief() ? null : ''",
    '[attr.data-stale]': "brief()?.stale ? '' : null",
  },
  templateUrl: './brief.html',
  styleUrl: './brief.css',
})
export class Brief {
  readonly brief = input.required<BriefModel | null>();
  readonly open = model(false);
  readonly copied = output<string>();

  protected readonly command = TLDR_COMMAND;
  protected readonly bodyId = nextId('brief-body');

  private readonly sanitizer = inject(DomSanitizer);
  private readonly transloco = inject(TranslocoService);
  private readonly lang = toSignal(this.transloco.langChanges$, { initialValue: this.transloco.getActiveLang() });
  private readonly dateFormat = computed(() => new Intl.DateTimeFormat(this.lang(), { dateStyle: 'medium' }));

  /** The `generated:` day in the active language; null when absent or no time (core counts that as stale). */
  protected readonly asOf = computed(() => {
    const generated = this.brief()?.generated ?? null;
    if (generated === null) return null;
    const at = Date.parse(generated);
    return Number.isNaN(at) ? null : { iso: generated, text: this.dateFormat().format(at) };
  });

  protected readonly html = computed<SafeHtml | null>(() => {
    const brief = this.brief();
    if (!brief) return null;
    const { html } = renderMarkdown(brief.markdown, { idPrefix: 'brief-' });
    return this.sanitizer.bypassSecurityTrustHtml(html);
  });

  protected toggle(): void {
    this.open.update((open) => !open);
  }
}

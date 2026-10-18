import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, model, output, ViewEncapsulation } from '@angular/core';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import { TranslocoPipe } from '@jsverse/transloco';
import type { RepoFileSource } from '../../../../../../core/src/files';
import { renderMarkdown } from '../../../../../../core/src/markdown';
import { OpenState } from '../../../shared/open-state';
import { UiTimeLabel } from '../../../shared/time';
import { UiCard, UiChip, UiCommandChip, UiDisclosure, UiSourceChip } from '../../../shared/ui';
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
  /** The spec worktree tldr.md was read from (spec 039, ISC-209); absent when read from the main checkout. */
  readonly source?: RepoFileSource;
  /**
   * Core's markdown per `<!-- section: key -->`, in file order (`DashboardBrief.sections`). With it the card stands on
   * its first section and folds the others (spec 021); without it (a spec's own TL;DR) it clips the whole text.
   */
  readonly sections?: Readonly<Record<string, string>>;
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
 * Spec 021 (T26, ISC-246): a brief with core's `sections` (the workspace TL;DR) stands on its first section
 * (`sections[0]`), whole and unclipped; the other sections sit in a `ui-disclosure` whose one toggle ("Show whole
 * TL;DR", named for the TL;DR) opens them, its state `?open=tldr` (`OpenState`), so a reload keeps it. The toggle
 * and the `/spec-tldr` chip share the footer, the toggle at the start, the chip at the end. The text before the first
 * marker (the file's own title) is not shown: the card's label names it. A brief without sections keeps the clip.
 *
 * Not encapsulated: the prose is `[innerHTML]`; every selector in the stylesheet starts with `app-brief`.
 */
@Component({
  selector: 'app-brief',
  imports: [NgTemplateOutlet, TranslocoPipe, UiCard, UiChip, UiCommandChip, UiDisclosure, UiSourceChip, UiTimeLabel],
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

  /**
   * The `generated:` instant, shown as its local date by `<ui-time-label form="date">` (spec 006); null when absent or
   * no time (core counts that as stale).
   */
  protected readonly asOf = computed(() => {
    const generated = this.brief()?.generated ?? null;
    return generated === null || Number.isNaN(Date.parse(generated)) ? null : generated;
  });

  protected readonly html = computed<SafeHtml | null>(() => {
    const brief = this.brief();
    return brief ? this.render(brief.markdown) : null;
  });

  private readonly openState = inject(OpenState);

  /** The non-empty sections in file order; empty for a brief without core's sections. */
  private readonly parts = computed(() => Object.values(this.brief()?.sections ?? {}).filter((part) => part.trim() !== ''));
  /** The brief stands on its first section (spec 021) instead of clipping the whole text. */
  protected readonly sectioned = computed(() => this.parts().length > 0);
  protected readonly firstHtml = computed<SafeHtml | null>(() => {
    const first = this.parts().at(0);
    return first === undefined ? null : this.render(first);
  });
  /** The sections behind "Show whole TL;DR"; null when there is only one. */
  protected readonly restHtml = computed<SafeHtml | null>(() => {
    const rest = this.parts().slice(1);
    return rest.length === 0 ? null : this.render(rest.join('\n\n'));
  });
  /** "Show whole TL;DR" is open: `?open=tldr` in the address. */
  protected readonly wholeOpen = computed(() => this.openState.isOpen('tldr'));

  protected setWhole(open: boolean): void {
    void this.openState.set('tldr', open);
  }

  private render(markdown: string): SafeHtml {
    const { html } = renderMarkdown(markdown, { idPrefix: 'brief-' });
    return this.sanitizer.bypassSecurityTrustHtml(html);
  }

  protected toggle(): void {
    this.open.update((open) => !open);
  }
}

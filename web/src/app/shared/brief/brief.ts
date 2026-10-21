import { ChangeDetectionStrategy, Component, computed, inject, input, model, signal, ViewEncapsulation } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import { NgTemplateOutlet } from '@angular/common';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import type { RepoFileSource } from '../../../../../core/src/files';
import { renderMarkdown } from '../../../../../core/src/markdown';
import { OpenState } from '../open-state';
import { UiTimeLabel } from '../time';
import { UiCard, UiChip, UiDisclosure, UiSourceChip } from '../ui';
import { nextId } from '../ui/overlay/ids';

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
  /**
   * The brief's primary language from `lang:` in the frontmatter, a BCP 47 tag such as `de` (`DashboardBrief.lang`,
   * spec 021, ISC-247); null or absent when the file names none.
   */
  readonly lang?: string | null;
}

/**
 * The Brief (T62, restyled in T88): the workspace's TL;DR
 * under the KPI band, a card with a violet 3 px left edge. The header reads "TL;DR" (mono), "as of <date>" from
 * `generated:` and, when the model says so, a "stale" chip. No command chip: the Spec plugin has no command that writes
 * `specs/tldr.md` (spec 031, ISC-265), so the card names none. The
 * body holds the whole TL;DR, clipped to a few lines until the "More" button (`aria-expanded`, `aria-controls`)
 * expands it; the clip is visual only, so a screen reader reads the full text either way.
 *
 * - Fed only by the dashboard model's `brief` (`core/src/dashboard.ts`); staleness is core's verdict, never recomputed
 *   here. A workspace without `specs/tldr.md` (`brief: null`) renders nothing and the host is `hidden`.
 * - The markdown goes through core's one renderer (`core/src/markdown.ts`), which escapes every string and never
 *   passes raw HTML through; that is why its output may be trusted here, as the Notes and Docs views do.
 * - `open` (expanded) is a two-way model, so the page can bind it to a query param.
 *
 * Spec 021 (T26, ISC-246): a brief with core's `sections` (the workspace TL;DR) stands on its first section
 * (`sections[0]`), whole and unclipped; the other sections sit in a `ui-disclosure` whose one toggle ("Show whole
 * TL;DR", named for the TL;DR) opens them, its state `?open=tldr` (`OpenState`), so a reload keeps it. The toggle
 * stands alone in the footer. The text before the first
 * marker (the file's own title) is not shown: the card's label names it. A brief without sections keeps the clip.
 *
 * Spec 021 (T29, ISC-247): when the brief's `lang:` differs from the interface language by its primary subtag, a
 * `ui-chip` with the upper-case code ("DE", named by `brief.lang`) stands after the as-of date and before "stale", and
 * every text block carries `lang`, so hyphenation and screen readers know the language. Without `lang:` neither shows.
 *
 * Spec 058 (T15, ISC-392): a stale brief always arrives in its short form. Without sections that is the two-line clip
 * it always had; with them its first section is clamped to two lines too, the others folded, and `?open=tldr` never
 * opens it: its toggle (the fold, or "More" for a single section) opens it on demand, held here, not in the address.
 * The chips `brief-stale` and `brief-as-of` mark it.
 *
 * Not encapsulated: the prose is `[innerHTML]`; every selector in the stylesheet starts with `app-brief`.
 */
@Component({
  selector: 'app-brief',
  imports: [NgTemplateOutlet, TranslocoPipe, UiCard, UiChip, UiDisclosure, UiSourceChip, UiTimeLabel],
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

  protected readonly bodyId = nextId('brief-body');

  private readonly sanitizer = inject(DomSanitizer);
  private readonly transloco = inject(TranslocoService);
  private readonly uiLang = toSignal(this.transloco.langChanges$, { initialValue: this.transloco.getActiveLang() });

  /**
   * The brief's `lang:` when its primary subtag differs from the interface language (spec 021, ISC-247): the card then
   * carries a language chip and its text block the `lang` attribute. Null when it matches (`de-CH` in a German UI) or
   * the file names no language, so neither appears.
   */
  protected readonly textLang = computed(() => {
    const lang = this.brief()?.lang?.trim() ?? '';
    if (lang === '') return null;
    return primarySubtag(lang) === primarySubtag(this.uiLang()) ? null : lang;
  });
  /** The language chip's visible code, upper-case (`DE`). */
  protected readonly langCode = computed(() => this.textLang()?.toUpperCase() ?? null);

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
  /** A stale brief's "Show whole TL;DR", held here: it opens only on demand, never from the address (spec 058). */
  private readonly staleWhole = signal(false);
  /** "Show whole TL;DR" is open: `?open=tldr` in the address, or for a stale brief the toggle pressed here. */
  protected readonly wholeOpen = computed(() => (this.brief()?.stale ? this.staleWhole() : this.openState.isOpen('tldr')));
  /**
   * A stale sectioned brief's first section is clamped to two lines (spec 058, T15) until its toggle opens it: the fold
   * when there are more sections, "More" when there is only one. A fresh one stands whole.
   */
  protected readonly firstClipped = computed(() => {
    if (!this.brief()?.stale) return false;
    return !(this.restHtml() === null ? this.open() : this.wholeOpen());
  });

  protected setWhole(open: boolean): void {
    if (this.brief()?.stale) this.staleWhole.set(open);
    else void this.openState.set('tldr', open);
  }

  private render(markdown: string): SafeHtml {
    const { html } = renderMarkdown(markdown, { idPrefix: 'brief-' });
    return this.sanitizer.bypassSecurityTrustHtml(html);
  }

  protected toggle(): void {
    this.open.update((open) => !open);
  }
}

/** The primary language subtag of a BCP 47 tag, lower-case: `de-CH` → `de`. */
function primarySubtag(tag: string): string {
  return tag.split('-', 1)[0].toLowerCase();
}

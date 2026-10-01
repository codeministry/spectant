import { afterRenderEffect, DestroyRef, Directive, ElementRef, inject, input, signal } from '@angular/core';

/** The mark a cut text ends with. */
export const CLAMP_ELLIPSIS = '…';

/**
 * The longest prefix of `text` that ends at a whole word and, with the ellipsis, still `fits`; the whole text when it
 * fits as it is. Punctuation left dangling before the ellipsis goes. Pure, so the word rule is tested without layout.
 */
export function fitWords(text: string, fits: (candidate: string) => boolean): { readonly shown: string; readonly cut: boolean } {
  const full = text.trim();
  if (fits(full)) return { shown: full, cut: false };
  const words = full.split(/\s+/);
  const prefix = (count: number): string => words.slice(0, count).join(' ').replace(/[\s,;:.–—-]+$/u, '') + CLAMP_ELLIPSIS;
  // Binary search for the most words that fit; one word always shows, even when it alone overflows.
  let lo = 1;
  let hi = words.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (fits(prefix(mid))) lo = mid;
    else hi = mid - 1;
  }
  return { shown: prefix(Math.max(lo, 1)), cut: true };
}

/** A run of the clamped text; `mark` runs render as `<mark>`. */
export interface ClampPiece {
  readonly text: string;
  readonly mark: boolean;
}

/** Writes the first `count` characters of `pieces` into `el`, marked runs as `<mark>` in the host's style scope. */
function renderPieces(el: HTMLElement, pieces: readonly ClampPiece[], count: number, ellipsis: boolean): void {
  const scope = [...el.attributes].find((attr) => attr.name.startsWith('_ngcontent-'))?.name;
  el.replaceChildren();
  let left = count;
  for (const piece of pieces) {
    if (left <= 0) break;
    const text = piece.text.slice(0, left);
    left -= text.length;
    if (!piece.mark) {
      el.append(text);
      continue;
    }
    const mark = document.createElement('mark');
    if (scope !== undefined) mark.setAttribute(scope, '');
    mark.textContent = text;
    el.append(mark);
  }
  if (ellipsis) el.append(CLAMP_ELLIPSIS);
}

/**
 * `uiClamp` (ISC-111): shows `text` on at most `lines` lines, cut at the last whole word that fits with "…" — CSS
 * `line-clamp` cuts mid-word. It owns the element's text, so the host leaves the element empty. `expanded` shows the
 * whole text; `cut()` says whether there is more to show, so the host can render its "more…" / "less" button outside
 * any link the element sits in (a control inside a link or option is a nested interactive element). Re-measures on
 * every width change. The element must lay out as a block (a grid or flex item is one).
 *
 * `pieces` (optional) is the same text split into marked and plain runs, as the palette's match highlight has it: the
 * directive then renders the kept part with each marked run as a `<mark>`, carrying the host's style scope.
 */
@Directive({
  selector: '[uiClamp]',
  exportAs: 'uiClamp',
  host: { '[attr.data-clamp]': 'cut() ? "cut" : expanded() ? "open" : "whole"' },
})
export class UiClamp {
  readonly text = input.required<string>({ alias: 'uiClamp' });
  readonly lines = input(2, { alias: 'uiClampLines' });
  readonly expanded = input(false, { alias: 'uiClampExpanded' });
  readonly pieces = input<readonly ClampPiece[] | null>(null, { alias: 'uiClampPieces' });

  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly width = signal(0);
  private readonly cutState = signal(false);
  private readonly overflowsState = signal(false);
  /** The text is shortened right now. */
  readonly cut = this.cutState.asReadonly();
  /** The whole text needs more than `lines` lines: a "more…" / "less" toggle has something to do. */
  readonly overflows = this.overflowsState.asReadonly();

  constructor() {
    // No ResizeObserver (a DOM emulation without layout): measured once, which there means the whole text.
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver((entries) => {
        for (const entry of entries) this.width.set(Math.round(entry.contentRect.width));
      });
      observer.observe(this.element);
      inject(DestroyRef).onDestroy(() => observer.disconnect());
    }

    afterRenderEffect({
      write: () => {
        this.width();
        const el = this.element;
        const text = this.text();
        const style = getComputedStyle(el);
        const lineHeight = Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.2;
        const limit = lineHeight * this.lines() + 1;
        const fits = (candidate: string): boolean => {
          el.textContent = candidate;
          return el.scrollHeight <= limit;
        };
        const fitted = fitWords(text, fits);
        this.overflowsState.set(fitted.cut);
        const open = this.expanded() || !fitted.cut;
        const shown = open ? text.trim() : fitted.shown;
        const pieces = this.pieces();
        if (pieces === null) el.textContent = shown;
        else renderPieces(el, pieces, open ? shown.length : shown.length - CLAMP_ELLIPSIS.length, !open);
        this.cutState.set(!open);
      },
    });
  }
}

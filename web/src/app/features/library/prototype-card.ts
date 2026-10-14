import { ChangeDetectionStrategy, Component, computed, inject, input, linkedSignal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import type { LibraryDoc } from '../../../../../core/src/files';
import { ApiClient } from '../../core/api.service';
import { UiIcon } from '../../shared/icons/icon';
import { UiCard } from '../../shared/ui/card/card';

/** The page a prototype opens on: listed first, the rest in core's name order (design.md 017 § 9, § 2.6, § 2c). */
const ENTRY_PAGE = 'index.html';

/** The pages in list order: `index.html` first, then the others as core lists them (name order). */
export function pageOrder(pages: readonly string[]): readonly string[] {
  return [...pages.filter((page) => page === ENTRY_PAGE), ...pages.filter((page) => page !== ENTRY_PAGE)];
}

/** A screenshot path below `specs/` as its spec names it (`004-x/.design/a.png` → `.design/a.png`). */
export function specRelative(path: string, spec: string): string {
  return path.startsWith(`${spec}/`) ? path.slice(spec.length + 1) : path;
}

/** One row of the page list: the file below the prototype folder and the server's read route for it. */
export interface PrototypePage {
  readonly file: string;
  readonly href: string;
}

/**
 * The prototype card in the library's reader (spec 017, T38, ISC-159; design.md 017 Mobile § 9, Tablet § 2.6, Desktop
 * § 2c, § Viewport-übergreifend): inside a `ui-card`, the preview (only when core names a screenshot in the spec's
 * `.design/`, through the library's file route, the figure gone without a placeholder when it does not load), the
 * eyebrow "Pages" with the count, and one row per HTML page: `app-window`, the file name in mono, `external-link`.
 * Each row is an `<a target="_blank" rel="noopener">` on the server's prototype read route (`ApiClient.prototypeUrl`),
 * at least 44 px high on every width; the list has two columns from 1120 px (shell container), one below. A footer
 * with `lock` says the page opens read-only from local files. No iframe, no edit control (Out of Scope).
 *
 * The reader's head carries the type tag, path and folder title; the card holds only what a prototype adds.
 */
@Component({
  selector: 'app-prototype-card',
  imports: [TranslocoPipe, UiCard, UiIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-library-prototype': '' },
  templateUrl: './prototype-card.html',
  styleUrl: './prototype-card.css',
})
export class PrototypeCard {
  private readonly api = inject(ApiClient);

  /** The workspace slug the routes name. */
  readonly workspace = input.required<string>();
  /** The `prototype` catalog document. */
  readonly doc = input.required<LibraryDoc>();

  /** Each page with its read route; a document the contract names no prototype folder for lists none. */
  protected readonly pages = computed<readonly PrototypePage[]>(() => {
    const ws = this.workspace();
    const doc = this.doc();
    return pageOrder(doc.pages ?? []).flatMap((file) => {
      const href = this.api.prototypeUrl(ws, doc, file);
      return href === null ? [] : [{ file, href }];
    });
  });

  /** The preview failed to load: the figure goes, as without a screenshot. Reset with every document. */
  protected readonly previewFailed = linkedSignal({ source: () => this.doc().preview ?? null, computation: () => false });

  /** The screenshot core names for this prototype, on the library's file route; null without one. */
  protected readonly preview = computed<{ readonly src: string; readonly caption: string } | null>(() => {
    const doc = this.doc();
    const path = doc.preview ?? null;
    if (path === null || this.previewFailed()) return null;
    return { src: this.api.libraryAssetUrl(this.workspace(), path), caption: specRelative(path, doc.spec) };
  });
}

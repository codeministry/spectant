import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { UiIcon } from '../../icons/icon';

/** The optional back link in front of the eyebrow: an in-app path and its accessible name, both already resolved. */
export interface PageHeadBack {
  /** The in-app path the link goes to, e.g. `/w/harbor/board`. */
  readonly href: string;
  /** The link's accessible name and tooltip, already translated, e.g. "Back to the board". */
  readonly label: string;
}

/**
 * The page head of every page without a spec breadcrumb (ISC-140, design 019 § Across viewports "one page head"):
 * one eyebrow row, 4 px, then the page's h1. One form at every tier, no tier variant.
 *
 * Inputs, the contract every page uses:
 * - `segments` (required): the eyebrow's segments in order, already translated, taken from the address only
 *   (`WORKSPACE · AREA · TAB/OBJECT`, `APP · HELP`, or a single segment such as "All workspaces · 2"). They render as one
 *   plain-text `<p class="type-eyebrow" data-page-eyebrow>`, never a link, joined by ` · ` separators in `aria-hidden`
 *   spans so a screen reader reads the segments and not the dots. The uppercase is CSS; the texts stay as given.
 *   The row never wraps: only the first segment (the workspace) shortens with an ellipsis (at most 40ch), the others
 *   keep their full width.
 * - `back` (optional): a `PageHeadBack` that puts an `arrow-left` icon link in front of the eyebrow, in the same row and
 *   the same place as the spec breadcrumb's `←` (24 × 24, 44 × 44 under `pointer: coarse`), named by `label`.
 *
 * Content: the page projects its own `<h1>` and gives it `class="type-page-title"`, so the page keeps its id, tabindex
 * and text; the head adds no heading of its own.
 *
 * ```html
 * <ui-page-head [segments]="[ws(), ('shell.pages.board' | transloco)]">
 *   <h1 class="type-page-title" id="board" tabindex="-1">Board</h1>
 * </ui-page-head>
 * ```
 */
@Component({
  selector: 'ui-page-head',
  imports: [RouterLink, UiIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './page-head.css',
  templateUrl: './page-head.html',
})
export class UiPageHead {
  /** The eyebrow's segments, already translated, in address order; only the first one may shorten. */
  readonly segments = input.required<readonly string[]>();
  /** The optional back link in front of the eyebrow. */
  readonly back = input<PageHeadBack>();
}

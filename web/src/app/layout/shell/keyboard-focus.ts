import { workspaceLink } from './areas';
import type { DashboardSection } from './keyboard-bindings';

/**
 * The DOM side of `KeyboardService`'s actions: where a section jump lands, which heading takes focus after a
 * navigation, the overview's column step and the dashboard's Specs panel. Free of Angular; each takes the document.
 */

/** How many frames a section jump waits for the new view's H2 before it settles for the page's H1. */
const HEADING_FRAMES = 30;

/** The overview's workspace columns and their spec rows (`features/overview`), for `h` / `l`. */
const COLUMN = '[data-ui="workspace-column"]';
const COLUMN_ROW = 'a.d-row';
/** The dashboard's Specs panel and its selected row (`features/dashboard/spec-table`), for `c` and `1`–`3`. */
const SPECS_PANEL = '[data-panel="specs"]';
const SELECTED_ROW = `${SPECS_PANEL} [data-spec-row][data-selected]`;

/** The page that holds `section` (the Specs page for the list, else the dashboard) as router link and URL path. */
export function sectionLink(ws: string, section: DashboardSection): { link: string[]; path: string } {
  const link = workspaceLink(ws, section === 'specs' ? 'specs' : 'dashboard');
  return { link, path: ['/w', ...link.slice(1).map(encodeURIComponent)].join('/') };
}

/** Focus the section's heading (its id); whether it took focus. */
export function focusSectionHeading(document: Document, section: DashboardSection): boolean {
  const heading = document.getElementById(section);
  if (heading === null) return false;
  if (!heading.hasAttribute('tabindex') && heading.tagName !== 'SUMMARY') heading.setAttribute('tabindex', '-1');
  heading.focus();
  return document.activeElement === heading;
}

/** After a navigation: the section heading once the page has rendered it, for up to `HEADING_FRAMES` frames. */
export function awaitSectionHeading(document: Document, section: DashboardSection, frames = 0): void {
  document.defaultView?.requestAnimationFrame(() => {
    if (!focusSectionHeading(document, section) && frames < HEADING_FRAMES) awaitSectionHeading(document, section, frames + 1);
  });
}

/** After a section jump: the new view's H2, for up to `HEADING_FRAMES` frames, else the page's H1. */
export function focusHeading(document: Document, frames = 0): void {
  const view = document.defaultView;
  if (!view) return;
  view.requestAnimationFrame(() => {
    // A dialog's heading (the gate sheet in the spec head) is never a section heading.
    const section = document.querySelector<HTMLElement>('main h2:not(dialog h2)');
    if (section === null && frames < HEADING_FRAMES) {
      focusHeading(document, frames + 1);
      return;
    }
    const heading = section ?? document.querySelector<HTMLElement>('main h1');
    if (heading === null) return;
    if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
    heading.focus();
  });
}

/** `f`: the page's search field, else the palette trigger once it can take focus. */
export function focusSearch(document: Document): boolean {
  const target =
    document.querySelector<HTMLElement>('main input[type="search"]') ?? document.querySelector<HTMLElement>('[data-control="palette"]');
  if (target === null) return false;
  target.focus();
  return document.activeElement === target;
}

/** `h` `l` on `/`: the same row index in the previous / next workspace column (the first column from nowhere). */
export function stepColumn(document: Document, delta: -1 | 1): boolean {
  const columns = [...document.querySelectorAll<HTMLElement>(COLUMN)];
  const active = document.activeElement;
  const current = active?.closest<HTMLElement>(COLUMN) ?? null;
  const from = current === null ? -1 : columns.indexOf(current);
  const to = from < 0 ? 0 : from + delta;
  // `at` reads a negative index from the end; `h` in the first column must stop, not wrap.
  const target = to < 0 ? undefined : columns.at(to);
  if (target === undefined) return false;
  const row = current === null ? 0 : Math.max(0, [...current.querySelectorAll(COLUMN_ROW)].indexOf(active as Element));
  const rows = [...target.querySelectorAll<HTMLElement>(COLUMN_ROW)];
  const next = (rows.length > 0 ? rows.at(Math.min(row, rows.length - 1)) : undefined) ?? target.querySelector<HTMLElement>('a[href]');
  if (next === null) return false;
  next.focus();
  return true;
}

/** The spec id of the Specs panel's selected row, else null. */
export function selectedSpecRow(document: Document): string | null {
  return document.querySelector(SELECTED_ROW)?.getAttribute('data-spec-row') ?? null;
}

/** Whether focus is inside the dashboard's Specs panel. */
export function specsPanelHasFocus(document: Document): boolean {
  return document.querySelector(SPECS_PANEL)?.contains(document.activeElement) === true;
}

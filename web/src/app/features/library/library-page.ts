import { afterNextRender, ChangeDetectionStrategy, Component, computed, ElementRef, inject, Injector, ViewEncapsulation } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { NotFound } from '../../layout/not-found/not-found';
import { specLink } from '../../layout/shell/areas';
import { ShellData } from '../../layout/shell/shell-data.service';
import { ShellState } from '../../layout/shell/shell-state.service';
import { UiIcon } from '../../shared/icons/icon';
import { UiTime } from '../../shared/time';
import { UiButton } from '../../shared/ui/button/button';
import { UiCard } from '../../shared/ui/card/card';
import { UiChip } from '../../shared/ui/chip/chip';
import { UiCommandChip } from '../../shared/ui/command-chip/command-chip';
import { UiMeter } from '../../shared/ui/meter/meter';
import { UiEmptyState } from '../../shared/ui/empty-state/empty-state';
import { UiFilterChips } from '../../shared/ui/filter-chips/filter-chips';
import { UiNotice } from '../../shared/ui/notice/notice';
import { UiPageHead } from '../../shared/ui/page-head/page-head';
import { UiSkeleton } from '../../shared/ui/skeleton/skeleton';
import { UiWsBadge } from '../../shared/ui/ws-badge/ws-badge';
import { specKey, specSlug, STATE_FILTERS, WORKSPACE_SPEC } from './library-model';
import { typeIcon } from './library-prose';
import { LibraryReader } from './library-reader';
import type { ControlView } from './library-view';
import { LibraryStore } from './library.store';

// The list's pure view helpers moved to `library-view.ts`, the reader's to `library-prose.ts` (spec 061, T13, T14);
// re-exported for this module's importers.
export {
  addressParams,
  type ControlKey,
  type ControlView,
  controlViews,
  groupHeadView,
  type GroupHeadView,
  SEARCH_DEBOUNCE_MS,
  showsPlaceholder,
  TECH_PLACEHOLDER,
  techPlaceholderOf,
} from './library-view';
export { fileName, missingCommand, typeIcon } from './library-prose';

/**
 * `/w/:ws/library` (spec 017, T27, ISC-156; spec 024's list and reader): the
 * workspace's catalog from the server's library route (`ApiClient.library`), grouped by `library-model.ts`:
 * workspace-wide first, then each spec once in ascending number, every row with its type tag (12 px icon, family
 * colour), title, the spec it belongs to and a meta line, a spec's evidence as one collapsed subgroup with its count
 * that reveals blocks of 50 and opens under a search or the type filter Evidence. A workspace without one document is
 * the empty state with `/spec init`. No demo chip and no demo data.
 *
 * The filter and the chosen document live in the address (T32, ISC-156.2): `?q=`, `?type=`, `?spec=`, `?state=` and
 * the document's path as the fragment `#path`. The page reads them from the route as signals and writes every change
 * back with `router.navigate` (`queryParamsHandling: merge`, `replaceUrl`), so reload, back and forward land on the
 * same selection. The shown filter is a `linkedSignal` of the address: a keystroke filters at once, and the address
 * replaces it whenever it changes from outside. The search matches titles and paths at once and, 200 ms after the
 * last keystroke, the full text through `ApiClient.librarySearch`; a row found by the server shows its snippet. The
 * state select (All · Outdated · Missing · Open) sits beside the spec select and writes the same `?state=` as the
 * control counts. The archived specs' documents are left out until the pill "Archived" beside the selects turns
 * `?archived=1` on; the spec select and the count follow it. The chosen document is shown by `app-library-reader`
 * (T34, ISC-156.3), which reports a followed cross reference back as a selection.
 *
 * The card's first row (`lib-head`, T30, ISC-156.1) holds the control counts "missing" (violet, `file-x`) and
 * "outdated" (orange, `triangle-alert`) from the catalog; a click sets `?state=missing|stale`, a second lifts it, and
 * at zero a count shows `circle-check` and filters nothing. Rows carry the chip of their state; a missing row is
 * dimmed by colour and form (muted title, dashed type tag), never by opacity, and its reader is the empty state with
 * the command that writes the file.
 *
 * From 1120 px (`wide`) list and reader sit side by side and the first match opens on its own; below, the page shows
 * the list or the reader, never both: opening a document scrolls to the top and focuses the reader, and the reader's
 * back button (or Escape) returns to the list at the scroll position it had and focuses the opened row (DS-APP-35).
 * At wide a chosen document moves the focus to the reader without scrolling (design.md 017 § 7 Tastatur und Fokus).
 *
 * The same component is the spec area Library at `/w/:ws/s/:id/library` (spec 017, T46, ISC-158): the route's spec id
 * narrows the catalog to that spec's documents, its missing entries and evidence included, plus the constitution
 * (`specScope`), the spec's group first and without its head (the spec head carries it), no spec select and no
 * "Archived" pill (an archived spec's own documents always show), the control
 * counts of the spec alone, no "Open in spec" in the reader (`context` `spec`), no page head of its own; the shell
 * draws no rail there (`SpecArea.noRail`) and the tab bar's Documents count is this list's (`LibraryTabCount`).
 *
 * The list's state lives in `LibraryStore`, one per page (spec 061, ISC-436); the page keeps the DOM work: scrolling,
 * focus and the way back below 1120 px.
 *
 * Not encapsulated: the row template's type tag is shared with the reader's head; every selector in the stylesheet
 * starts with `app-library-page`.
 */
@Component({
  selector: 'app-library-page',
  imports: [
    LibraryReader,
    NgTemplateOutlet,
    NotFound,
    RouterLink,
    TranslocoPipe,
    UiButton,
    UiCard,
    UiChip,
    UiCommandChip,
    UiMeter,
    UiEmptyState,
    UiFilterChips,
    UiIcon,
    UiNotice,
    UiPageHead,
    UiSkeleton,
    UiTime,
    UiWsBadge,
  ],
  providers: [LibraryStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  host: {
    'data-page': 'library',
    '[attr.data-tier]': 'state.tier()',
    '[attr.data-reading]': 'current() ? "" : null',
    '[attr.data-scope]': 'specScoped() ? "spec" : "workspace"',
  },
  templateUrl: './library-page.html',
  styleUrls: ['./library-page.css', './library-page.control.css', './library-page.heads.css'],
})
export class LibraryPage {
  protected readonly state = inject(ShellState);
  private readonly store = inject(LibraryStore);
  private readonly shell = inject(ShellData);
  private readonly transloco = inject(TranslocoService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly injector = inject(Injector);
  /** Below 1120 px: the list's scroll position and the row a document was opened from, for the way back (DS-APP-35). */
  private listReturn: { readonly top: number; readonly path: string } | null = null;

  protected readonly typeIcon = typeIcon;
  protected readonly stateOptions = STATE_FILTERS;

  // The store's state as the template reads it.
  protected readonly ws = this.store.ws;
  protected readonly wsName = this.store.wsName;
  /** The page badge's stored logo (spec 016), the initials without one. */
  protected readonly logo = computed(() => this.shell.wsImages().logo);
  protected readonly wide = this.store.wide;
  protected readonly specScoped = this.store.specScoped;
  protected readonly catalog = this.store.catalog;
  protected readonly missing = this.store.missing;
  protected readonly unavailable = this.store.unavailable;
  protected readonly failed = this.store.failed;
  protected readonly docs = this.store.docs;
  protected readonly archivedCount = this.store.archivedCount;
  protected readonly query = this.store.query;
  protected readonly type = this.store.type;
  protected readonly spec = this.store.spec;
  protected readonly stateFilter = this.store.stateFilter;
  protected readonly archived = this.store.archived;
  protected readonly listedCount = this.store.listedCount;
  protected readonly specs = this.store.specs;
  protected readonly controls = this.store.controls;
  protected readonly typeOptions = this.store.typeOptions;
  protected readonly shownCount = this.store.shownCount;
  protected readonly groups = this.store.groups;
  protected readonly fog = this.store.fog;
  protected readonly fogLines = this.store.fogLines;
  protected readonly current = this.store.current;

  /** The group's label: "‹ws› · workspace-wide", else the spec's number and slug ("017 · workspace-library"). */
  protected groupLabel(spec: string): string {
    if (spec === WORKSPACE_SPEC) return this.transloco.translate('library.wsWide', { ws: this.wsName() });
    return `${specKey(spec)} · ${specSlug(spec)}`;
  }

  protected setQuery(value: string): void {
    this.store.setQuery(value);
  }

  protected setType(value: string | undefined): void {
    this.store.setType(value);
  }

  protected setSpec(value: string): void {
    this.store.setSpec(value);
  }

  protected setState(value: string): void {
    this.store.setState(value);
  }

  protected toggleControl(control: ControlView): void {
    this.store.toggleControl(control);
  }

  protected toggleArchived(): void {
    this.store.toggleArchived();
  }

  protected clear(): void {
    this.store.clear();
  }

  protected toggleEvidence(key: string, open: boolean): void {
    this.store.toggleEvidence(key, open);
  }

  protected moreEvidence(key: string): void {
    this.store.moreEvidence(key);
  }

  /**
   * A row or a followed cross reference opens a document. Below 1120 px the list gives way to the reader: the list's
   * scroll position and the row are kept for the way back (when the list is what was shown), the page scrolls to its
   * top and the reader takes the focus; at wide the focus moves to the reader without scrolling.
   */
  protected open(path: string): void {
    const fromList = !this.wide() && this.current() === null;
    if (fromList) this.listReturn = { top: window.scrollY, path };
    this.store.select(path);
    if (!this.wide()) window.scrollTo({ top: 0 });
    this.afterRender(() => this.host.querySelector<HTMLElement>('[data-library-reader]')?.focus({ preventScroll: true }));
  }

  /**
   * The reader's way back below 1120 px (DS-APP-35): the list at the scroll position it had and the focus on the row
   * the document was opened from; the row of the document read last when a cross reference led elsewhere.
   */
  protected back(): void {
    const read = this.current()?.path ?? null;
    const saved = this.listReturn;
    this.listReturn = null;
    this.store.select(null);
    this.afterRender(() => {
      if (saved !== null) window.scrollTo({ top: saved.top });
      const row = (path: string | null | undefined): HTMLElement | null =>
        path == null
          ? null
          : this.host.querySelector<HTMLElement>(`[data-library-entry="${CSS.escape(path)}"], [data-library-placeholder="${CSS.escape(path)}"]`);
      const same = row(read) ?? row(saved?.path);
      // The row the list was left from is in view once the position is back; any other row scrolls into view.
      same?.focus({ preventScroll: saved !== null && (read === saved.path || row(read) === null) });
    });
  }

  /** The spec page a group head's number and slug lead to. */
  protected specPage(key: string): string[] {
    return specLink(this.ws(), key);
  }

  /** A group head's fog count leads to the filter "open" of that spec (`?state=open&spec=NNN`), no search, no type. */
  protected fogParams(key: string): Record<string, string | null> {
    return { state: 'open', spec: key, q: null, type: null };
  }

  /** A fog line opens its spec's spec.md, where `## Not yet specified` holds the line. */
  protected openFog(spec: string): void {
    this.open(`${spec}/spec.md`);
  }

  private afterRender(write: () => void): void {
    afterNextRender({ write }, { injector: this.injector });
  }
}

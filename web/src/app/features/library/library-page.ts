import { ChangeDetectionStrategy, Component, computed, inject, signal, ViewEncapsulation } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Location } from '@angular/common';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { renderMarkdown } from '../../../../../core/src/markdown';
import { specLink } from '../../layout/shell/areas';
import { ShellData } from '../../layout/shell/shell-data.service';
import { ShellState } from '../../layout/shell/shell-state.service';
import { UiIcon } from '../../shared/icons/icon';
import { DemoData, type DemoLibraryEntry, type DemoLibraryType } from '../../shared/demo/demo-data';
import { UiButton } from '../../shared/ui/button/button';
import { UiCard } from '../../shared/ui/card/card';
import { UiChip } from '../../shared/ui/chip/chip';
import { UiCommandChip } from '../../shared/ui/command-chip/command-chip';
import { UiWsBadge } from '../../shared/ui/ws-badge/ws-badge';
import { UiEmptyState } from '../../shared/ui/empty-state/empty-state';
import { type FilterOption, UiFilterChips } from '../../shared/ui/filter-chips/filter-chips';
import { UiNotice } from '../../shared/ui/notice/notice';
import { UiPageHead } from '../../shared/ui/page-head/page-head';
import {
  highlight,
  isImage,
  LIBRARY_TYPES,
  type LibraryFilter,
  matches,
  NO_FILTER,
  related,
  sharedRefs,
  snippet,
  specSlug,
  specsOf,
  type TextRun,
  WORKSPACE_WIDE,
} from './library-model';

interface RowView {
  readonly entry: DemoLibraryEntry;
  readonly title: readonly TextRun[];
  readonly snippet: readonly TextRun[];
  readonly xrefs: number;
}

interface GroupView {
  readonly spec: string;
  readonly rows: readonly RowView[];
}

const isType = (value: string): value is DemoLibraryType => (LIBRARY_TYPES as readonly string[]).includes(value);

/**
 * `/w/:ws/library` (spec 024, T51; prototype `library.js`, design.md § Library): every curated document of the
 * workspace's specs in one list, with search over title and full text, the type chips, the Spec select and the
 * "Only outdated" toggle, and a reader with the document's prose, its image preview, the stale notice and the cross
 * references (documents sharing a reference). A mock until spec 017: the documents come only from `DemoData.library`
 * (ISC-149.1), the page root is `[data-demo]` and its h1 row the `[data-demo-head]` holding the one demo chip. Nothing
 * here writes, stores or asks the API; `?q=`, `?spec=` and `#id` are read once and kept in the address with
 * `Location.replaceState`, which leaves the router (and every request it could start) untouched.
 *
 * From 1120 px (`wide`) list and reader sit side by side and the first match opens on its own; below, the page shows
 * the list or the reader, never both, and the reader's back button returns to the list.
 *
 * Not encapsulated: the prose is `[innerHTML]` from core's one renderer; every selector in the stylesheet starts with
 * `app-library-page`.
 */
@Component({
  selector: 'app-library-page',
  imports: [RouterLink, TranslocoPipe, UiButton, UiCard, UiChip, UiCommandChip, UiEmptyState, UiFilterChips, UiIcon, UiNotice, UiPageHead, UiWsBadge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  host: {
    'data-page': 'library',
    'data-demo': '',
    '[attr.data-tier]': 'state.tier()',
    '[attr.data-reading]': 'current() ? "" : null',
  },
  templateUrl: './library-page.html',
  styleUrl: './library-page.css',
})
export class LibraryPage {
  protected readonly state = inject(ShellState);
  private readonly demo = inject(DemoData);
  private readonly location = inject(Location);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly transloco = inject(TranslocoService);
  private readonly lang = toSignal(this.transloco.langChanges$, { initialValue: this.transloco.getActiveLang() });

  protected readonly ws = computed(() => this.state.ws() ?? '');
  protected readonly wide = computed(() => this.state.tier() === 'wide');
  protected readonly types = LIBRARY_TYPES;
  private readonly data = inject(ShellData);
  protected readonly all = computed(() => this.demo.libraryOf(this.ws(), this.data.workspaceList()[0]?.slug));
  protected readonly specs = computed(() => specsOf(this.all()));
  protected readonly staleCount = computed(() => this.all().filter((entry) => entry.stale !== undefined).length);

  private readonly filter = signal<LibraryFilter>(NO_FILTER);
  protected readonly query = computed(() => this.filter().query);
  protected readonly type = computed(() => this.filter().type);
  protected readonly spec = computed(() => this.filter().spec);
  protected readonly stale = computed(() => this.filter().stale);
  /** The document picked by a person (row, cross reference or `#id`); null until one is. */
  private readonly picked = signal<string | null>(null);

  /** The active catalogue: the chip labels are translated here, so they follow its (lazy) arrival and every switch. */
  private readonly catalogue = toSignal(this.transloco.selectTranslation());

  protected readonly typeOptions = computed<readonly FilterOption[]>(() => {
    this.catalogue();
    return [
      { key: 'all', label: this.transloco.translate('library.filters.all') },
      ...LIBRARY_TYPES.map((key) => ({ key, label: this.transloco.translate(`library.types.${key}`) })),
    ];
  });

  protected readonly shown = computed(() => this.all().filter((entry) => matches(entry, this.filter())));

  protected readonly groups = computed<readonly GroupView[]>(() => {
    const all = this.all();
    const query = this.query();
    const rows = this.shown().map((entry) => ({
      entry,
      title: highlight(entry.title, query),
      snippet: snippet(entry.body, query),
      xrefs: related(entry, all).length,
    }));
    // Rows keep the fixture's order (the hook contract); a group is a run of rows of one spec, so a spec whose
    // documents are not adjacent in the fixture heads more than one run.
    const groups: Array<{ spec: string; rows: RowView[] }> = [];
    for (const row of rows) {
      const last = groups.at(-1);
      if (last?.spec === row.entry.spec) last.rows.push(row);
      else groups.push({ spec: row.entry.spec, rows: [row] });
    }
    return groups;
  });

  /** The reader's document: the picked one, else at wide the first match (the prototype opens it on arrival). */
  protected readonly current = computed<DemoLibraryEntry | null>(() => {
    const id = this.picked();
    const picked = id === null ? undefined : this.all().find((entry) => entry.id === id);
    if (picked) return picked;
    return this.wide() ? (this.shown()[0] ?? null) : null;
  });

  protected readonly relatedDocs = computed(() => {
    const entry = this.current();
    return entry ? related(entry, this.all()).map((other) => ({ entry: other, shared: sharedRefs(entry, other).join(', ') })) : [];
  });

  /** Core's renderer escapes every text and passes no raw HTML (see `UiDocProse`), so its output is trusted here. */
  protected readonly prose = computed<SafeHtml | null>(() => {
    const entry = this.current();
    return entry ? this.sanitizer.bypassSecurityTrustHtml(renderMarkdown(entry.body, { idPrefix: 'lib-' }).html) : null;
  });

  private readonly dates = computed(
    () => new Intl.DateTimeFormat(this.lang(), { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }),
  );

  constructor() {
    const snapshot = inject(ActivatedRoute).snapshot;
    const q = snapshot.queryParamMap.get('q') ?? '';
    const spec = snapshot.queryParamMap.get('spec') ?? 'all';
    this.filter.set({ ...NO_FILTER, query: q, spec: spec === 'all' || specsOf(this.all()).includes(spec) ? spec : 'all' });
    const id = snapshot.fragment;
    if (id && this.all().some((entry) => entry.id === id)) this.picked.set(id);
  }

  protected specLabel(spec: string): string {
    if (spec === WORKSPACE_WIDE) return this.transloco.translate('library.wsWide', { ws: this.ws() });
    const entry = this.all().find((item) => item.spec === spec);
    const slug = entry ? specSlug(entry) : null;
    return slug ? `${spec} · ${slug}` : spec;
  }

  protected chipLabel(spec: string): string {
    return spec === WORKSPACE_WIDE ? this.ws() : spec;
  }

  protected date(iso: string): string {
    return this.dates().format(new Date(iso));
  }

  protected isImage(entry: DemoLibraryEntry): boolean {
    return isImage(entry);
  }

  /** The spec page the document belongs to: its tab of the same name; none for a workspace-wide document. */
  protected openLink(entry: DemoLibraryEntry): string[] | null {
    return entry.spec === WORKSPACE_WIDE ? null : specLink(this.ws(), entry.spec, entry.type);
  }

  protected setQuery(value: string): void {
    this.update({ query: value });
  }

  protected setType(value: string | undefined): void {
    if (value === 'all' || (value !== undefined && isType(value))) this.update({ type: value });
  }

  protected setSpec(value: string): void {
    this.update({ spec: value });
  }

  protected setStale(value: boolean): void {
    this.update({ stale: value });
  }

  protected clear(): void {
    this.filter.set(NO_FILTER);
    this.sync();
  }

  protected open(id: string): void {
    this.picked.set(id);
    this.sync();
    if (!this.wide()) window.scrollTo({ top: 0 });
  }

  protected back(): void {
    this.picked.set(null);
    this.sync();
  }

  /** A reference pill searches every document for it; below 1120 the list comes back to show the matches. */
  protected searchRef(ref: string): void {
    if (!this.wide()) this.picked.set(null);
    this.update({ query: ref });
  }

  private update(change: Partial<LibraryFilter>): void {
    this.filter.update((filter) => ({ ...filter, ...change }));
    this.sync();
  }

  /** `?q=`, `?spec=` and `#id` follow the state, replacing the history entry; the router does not navigate. */
  private sync(): void {
    const params = new URLSearchParams();
    const { query, spec } = this.filter();
    if (query !== '') params.set('q', query);
    if (spec !== 'all') params.set('spec', spec);
    const path = this.location.path(false).split(/[?#]/u)[0] ?? '';
    const search = params.toString();
    const id = this.picked();
    this.location.replaceState(`${path}${search ? `?${search}` : ''}${id ? `#${id}` : ''}`);
  }
}

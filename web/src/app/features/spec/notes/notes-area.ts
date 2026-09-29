import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  linkedSignal,
  resource,
  signal,
  untracked,
  ViewEncapsulation,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import { ActivatedRoute, NavigationEnd, Router, RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { filter } from 'rxjs';
import { renderMarkdown } from '../../../../../../core/src/markdown';
import type { Note, NoteDraft } from '../../../../../../server/src/notes.contract';
import { ApiClient } from '../../../core/api.service';
import { SettingsService } from '../../../core/settings.service';
import { ShellState } from '../../../layout/shell/shell-state.service';
import { UiIcon } from '../../../shared/icons/icon';
import { UiButton } from '../../../shared/ui/button/button';
import {
  type FilterOption,
  type SegmentedOption,
  UiDialog,
  UiEmptyState,
  UiFilterChips,
  UiIdChip,
  UiKbd,
  UiNotice,
  UiSegmented,
  UiSheet,
} from '../../../shared/ui';
import {
  anchorFromValue,
  anchorLabel,
  anchorValue,
  AUTOSAVE_MS,
  clockTime,
  draftOf,
  excerpt,
  filterNotes,
  isNoteFilter,
  isSavable,
  NEW_NOTE,
  nextSaveState,
  type NoteFilter,
  rowTime,
  saveLabel,
  type SaveEvent,
  type SaveState,
} from './notes-model';

/** Edit, Preview, or both side by side (wide only). */
type EditorView = 'edit' | 'preview' | 'split';

interface AnchorOption {
  readonly value: string;
  readonly label: string;
}

interface AnchorGroup {
  readonly key: 'claims' | 'tasks';
  readonly options: readonly AnchorOption[];
}

/**
 * The Notes area (T100, ISC-95): the spec's anchored notes with a Markdown editor and preview, at `…/notes` (the list),
 * `…/notes/new` and `…/notes/:noteId` (the editor). One component serves the three URLs: the note is the child route's
 * `noteId`, the list chip and search are the `filter` and `q` query params, so reload and back land on the same screen.
 *
 * - compact and medium stack the list and the editor as two views, the editor with a "← All notes (n)" back link;
 *   wide shows both panes in one card (a 320 px list, the editor filling the rest) and the side-by-side preview.
 * - The editor writes on its own: a debounced `POST` for a new note once its body has text (then the URL becomes the
 *   note's), a debounced `PUT` of the whole draft after that; the state reads "saved · 12:04" from the server's time.
 * - The import notice is dismissed through `/api/settings` (`notesImportDismissed`), never browser storage.
 * - The preview renders through core's one renderer (`core/src/markdown.ts`), which escapes raw HTML.
 *
 * Not encapsulated: the preview is `[innerHTML]`; every selector in the stylesheet starts with `app-notes-area`.
 */
@Component({
  selector: 'app-notes-area',
  imports: [RouterLink, TranslocoPipe, UiButton, UiDialog, UiEmptyState, UiFilterChips, UiIcon, UiIdChip, UiKbd, UiNotice, UiSegmented, UiSheet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  host: { 'data-view': 'notes', '[attr.data-tier]': 'tier()', '[attr.data-mode]': 'mode()' },
  templateUrl: './notes-area.html',
  styleUrl: './notes-area.css',
})
export class NotesArea {
  private readonly api = inject(ApiClient);
  private readonly shell = inject(ShellState);
  private readonly settings = inject(SettingsService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly transloco = inject(TranslocoService);
  private readonly translation = toSignal(this.transloco.selectTranslation());
  private readonly navigated = toSignal(this.router.events.pipe(filter((event) => event instanceof NavigationEnd)), { initialValue: null });

  protected readonly tier = this.shell.tier;
  protected readonly ws = computed(() => this.shell.ws() ?? '');
  /** The spec's canonical number, the anchor's `spec`: the head's id once the spec answered, else the route's. */
  protected readonly spec = computed(() => this.shell.specId() ?? '');

  // ─── Route state ───────────────────────────────────────────────────────────────────────────────────────────────
  protected readonly noteId = computed(() => {
    this.navigated();
    return this.route.snapshot.firstChild?.paramMap.get('noteId') ?? null;
  });
  private readonly query = computed(() => {
    this.navigated();
    return this.route.snapshot.queryParamMap;
  });
  protected readonly filter = computed<NoteFilter>(() => {
    const value = this.query().get('filter');
    return isNoteFilter(value) ? value : 'spec';
  });
  protected readonly search = computed(() => this.query().get('q') ?? '');
  protected readonly wide = computed(() => this.tier() === 'wide');
  protected readonly mode = computed(() => (this.wide() ? 'split' : this.noteId() === null ? 'list' : 'editor'));

  // ─── Data ──────────────────────────────────────────────────────────────────────────────────────────────────────
  private readonly listing = resource({
    params: () => (this.ws() === '' ? undefined : { ws: this.ws() }),
    loader: ({ params }) => this.api.notes(params.ws),
  });
  private readonly claimsModel = resource({
    params: () => (this.ws() === '' || this.spec() === '' ? undefined : { ws: this.ws(), id: this.spec() }),
    loader: ({ params }) => this.api.claims(params.ws, params.id),
  });
  private readonly tasksModel = resource({
    params: () => (this.ws() === '' || this.spec() === '' ? undefined : { ws: this.ws(), id: this.spec() }),
    loader: ({ params }) => this.api.tasks(params.ws, params.id),
  });

  /** The workspace's notes as the server listed them, then kept in step with every write of this view. */
  protected readonly notes = linkedSignal<readonly Note[]>(() => {
    const result = this.listing.hasValue() ? this.listing.value() : undefined;
    return result?.kind === 'ok' ? result.body : [];
  });
  protected readonly loaded = computed(() => this.listing.hasValue() || this.listing.error() !== undefined);
  protected readonly failed = computed(() => {
    const result = this.listing.hasValue() ? this.listing.value() : undefined;
    return this.listing.error() !== undefined || (result !== undefined && result.kind !== 'ok');
  });
  protected readonly visible = computed(() => filterNotes(this.notes(), this.filter(), this.spec(), this.search()));
  protected readonly selected = computed(() => this.notes().find((note) => note.id === this.noteId()));
  protected readonly editing = computed(() => this.noteId() === NEW_NOTE || this.selected() !== undefined);

  private readonly locale = computed(() => {
    this.translation();
    return this.transloco.getActiveLang() === 'de' ? 'de-DE' : 'en-GB';
  });

  protected readonly filterOptions = computed<readonly FilterOption[]>(() => {
    this.translation();
    const labels: Record<NoteFilter, string> =
      this.tier() === 'compact'
        ? { workspace: 'notes.filter.all', unanchored: 'notes.filter.unanchored', spec: 'notes.filter.byAnchor' }
        : { spec: 'notes.filter.spec', unanchored: 'notes.filter.unanchored', workspace: 'notes.filter.workspace' };
    const order: readonly NoteFilter[] = this.tier() === 'compact' ? ['workspace', 'unanchored', 'spec'] : ['spec', 'unanchored', 'workspace'];
    const all = this.notes();
    return order.map((key) => ({ key, label: this.transloco.translate(labels[key]), count: filterNotes(all, key, this.spec(), '').length }));
  });

  protected readonly rows = computed(() => {
    const now = new Date();
    const locale = this.locale();
    return this.visible().map((note) => ({
      note,
      title: note.title !== '' ? note.title : excerpt(note.body),
      line: note.title !== '' ? excerpt(note.body) : '',
      anchor: anchorLabel(note.anchor, this.spec()),
      time: rowTime(note.updated, now, locale),
    }));
  });

  // ─── Editor ────────────────────────────────────────────────────────────────────────────────────────────────────
  /** Which note the editor shows and whether it is loaded: a change re-seeds the draft and the save state. */
  private readonly editorKey = computed(() => `${this.noteId() ?? ''}|${this.editing() ? 1 : 0}`);
  /** The id `POST` just gave the new note: its draft carries over from `new` instead of being re-seeded. */
  private createdId: string | null = null;

  protected readonly draft = linkedSignal<string, NoteDraft>({
    source: () => this.editorKey(),
    computation: (_key, previous) => {
      const id = untracked(this.noteId);
      if (previous?.source.startsWith(`${NEW_NOTE}|`) && id !== null && id === this.createdId) return previous.value;
      const note = untracked(this.selected);
      const spec = untracked(this.spec);
      return note ? draftOf(note) : { anchor: spec === '' ? null : { kind: 'spec', spec }, title: '', body: '' };
    },
  });
  protected readonly saveState = linkedSignal<string, SaveState>({
    source: () => this.editorKey(),
    computation: (_key, previous) => {
      if (previous?.source.startsWith(`${NEW_NOTE}|`) && untracked(this.noteId) === this.createdId) return previous.value;
      const note = untracked(this.selected);
      return note ? { kind: 'saved', at: note.updated } : { kind: 'idle' };
    },
  });
  protected readonly saveText = computed(() => {
    this.translation();
    const label = saveLabel(this.saveState(), (iso) => clockTime(iso, this.locale()));
    return label ? this.transloco.translate(label.key, label.params) : '';
  });

  protected readonly view = signal<EditorView>('edit');
  protected readonly shownView = computed<EditorView>(() => (this.view() === 'split' && !this.wide() ? 'edit' : this.view()));
  protected readonly viewOptions = computed<readonly SegmentedOption[]>(() => {
    this.translation();
    const keys: readonly EditorView[] = this.wide() ? ['edit', 'preview', 'split'] : ['edit', 'preview'];
    return keys.map((key) => ({ key, label: this.transloco.translate(`notes.editor.view.${key}`) }));
  });
  protected readonly preview = computed<SafeHtml>(() => {
    // Trusted on purpose: core's renderer escapes every text and every raw HTML node (see the Docs tab).
    const { html } = renderMarkdown(this.draft().body, { idPrefix: 'note-preview-' });
    return this.sanitizer.bypassSecurityTrustHtml(html);
  });

  // ─── Anchor picker ─────────────────────────────────────────────────────────────────────────────────────────────
  protected readonly anchorValue = computed(() => anchorValue(this.draft().anchor));
  protected readonly anchorGroups = computed<readonly AnchorGroup[]>(() => {
    const spec = this.spec();
    const claims = this.claimsModel.hasValue() ? this.claimsModel.value() : undefined;
    const tasks = this.tasksModel.hasValue() ? this.tasksModel.value() : undefined;
    const option = (kind: 'claim' | 'task', id: string, text: string): AnchorOption => ({
      value: anchorValue({ kind, spec, id }),
      label: `${id} · ${text}`,
    });
    return [
      { key: 'claims', options: claims?.kind === 'ok' ? claims.body.claims.map((c) => option('claim', c.id, c.text)) : [] },
      { key: 'tasks', options: tasks?.kind === 'ok' && tasks.body ? tasks.body.tasks.map((t) => option('task', t.id, t.text)) : [] },
    ];
  });
  /** The note's anchor when it is outside this spec's lists (another spec's claim, a claim since removed). */
  protected readonly foreignAnchor = computed<AnchorOption | null>(() => {
    const value = this.anchorValue();
    const anchor = this.draft().anchor;
    if (anchor === null || value === `spec:${this.spec()}`) return null;
    if (this.anchorGroups().some((group) => group.options.some((option) => option.value === value))) return null;
    const label = anchorLabel(anchor, this.spec());
    return { value, label: label?.text ?? value };
  });
  protected readonly anchorChip = computed(() => anchorLabel(this.draft().anchor, this.spec()));
  protected readonly pickerOpen = signal(false);
  protected readonly pickerSearch = signal('');
  protected readonly pickerGroups = computed(() => {
    const needle = this.pickerSearch().trim().toLowerCase();
    return this.anchorGroups().map((group) => ({
      ...group,
      options: needle === '' ? group.options : group.options.filter((option) => option.label.toLowerCase().includes(needle)),
    }));
  });

  protected readonly confirmOpen = signal(false);

  // ─── Import notice ─────────────────────────────────────────────────────────────────────────────────────────────
  protected readonly importDismissed = computed(() => this.settings.settings().notesImportDismissed);

  private pending: { id: string; draft: NoteDraft } | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private inFlight = false;

  constructor() {
    void this.settings.load();
    // Leaving a note writes what is still pending for it (the job carries its own id).
    effect(() => {
      this.noteId();
      untracked(() => void this.flush());
    });
    inject(DestroyRef).onDestroy(() => void this.flush());
  }

  protected link(noteId?: string): string[] {
    const base = ['/w', this.ws(), 's', this.spec(), 'notes'];
    return noteId === undefined ? base : [...base, noteId];
  }

  protected setFilter(value: string | undefined): void {
    void this.router.navigate([], { relativeTo: this.route.firstChild ?? this.route, queryParams: { filter: value === 'spec' ? null : value }, queryParamsHandling: 'merge', replaceUrl: true });
  }

  protected setSearch(value: string): void {
    void this.router.navigate([], { relativeTo: this.route.firstChild ?? this.route, queryParams: { q: value === '' ? null : value }, queryParamsHandling: 'merge', replaceUrl: true });
  }

  protected setView(value: string | undefined): void {
    if (value === 'edit' || value === 'preview' || value === 'split') this.view.set(value);
  }

  protected edit(patch: Partial<NoteDraft>): void {
    const id = this.noteId();
    if (id === null) return;
    const draft = { ...this.draft(), ...patch };
    this.draft.set(draft);
    this.pending = { id, draft };
    this.step({ type: 'edit' });
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), AUTOSAVE_MS);
  }

  protected pickAnchor(value: string): void {
    this.edit({ anchor: anchorFromValue(value) });
    this.pickerOpen.set(false);
  }

  protected async dismissImport(): Promise<void> {
    await this.settings.update({ notesImportDismissed: true });
  }

  protected async confirmDelete(): Promise<void> {
    const id = this.noteId();
    this.confirmOpen.set(false);
    if (id === null) return;
    if (this.pending?.id === id) this.pending = null;
    if (id !== NEW_NOTE) {
      const result = await this.api.deleteNote(this.ws(), id);
      if (result.kind !== 'ok') {
        this.step({ type: 'fail' });
        return;
      }
      this.notes.update((notes) => notes.filter((note) => note.id !== id));
    }
    await this.router.navigate(this.link(), { queryParamsHandling: 'preserve' });
  }

  /** An edit made while the note was being created belongs to the id `POST` just gave it. */
  private rebindPending(id: string): void {
    if (this.pending?.id === NEW_NOTE) this.pending = { id, draft: this.pending.draft };
  }

  private hasPending(): boolean {
    return this.pending !== null;
  }

  private step(event: SaveEvent): void {
    this.saveState.update((state) => nextSaveState(state, event));
  }

  /** Writes the pending draft now: `POST` for a new note, else `PUT`; one write at a time, the newest draft last. */
  private async flush(): Promise<void> {
    clearTimeout(this.timer);
    const job = this.pending;
    if (job === null || this.inFlight || this.ws() === '') return;
    if (!isSavable(job.draft)) return;
    this.pending = null;
    this.inFlight = true;
    const current = job.id === this.noteId();
    if (current) this.step({ type: 'start' });
    const result = job.id === NEW_NOTE ? await this.api.createNote(this.ws(), job.draft) : await this.api.updateNote(this.ws(), job.id, job.draft);
    this.inFlight = false;
    if (result.kind !== 'ok') {
      if (current) this.step({ type: 'fail' });
    } else {
      const saved = result.note;
      this.notes.update((notes) => [saved, ...notes.filter((note) => note.id !== saved.id)]);
      if (job.id === NEW_NOTE) {
        this.createdId = saved.id;
        this.rebindPending(saved.id);
        if (this.noteId() === NEW_NOTE) {
          this.step({ type: 'saved', at: saved.updated });
          await this.router.navigate(this.link(saved.id), { replaceUrl: true, queryParamsHandling: 'preserve' });
        }
      } else if (current) {
        this.step({ type: 'saved', at: saved.updated });
      }
    }
    if (this.hasPending()) await this.flush();
  }
}

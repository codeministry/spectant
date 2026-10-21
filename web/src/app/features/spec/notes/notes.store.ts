import { computed, inject, Injectable, linkedSignal, resource, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, NavigationEnd, Router } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
import { filter } from 'rxjs';
import type { Note, NoteDraft } from '../../../../../../server/src/contracts/notes.contract';
import { ApiClient } from '../../../core/api.service';
import { SettingsService } from '../../../core/settings.service';
import { ShellState } from '../../../layout/shell/shell-state.service';
import type { FilterOption, SegmentedOption } from '../../../shared/ui';
import {
  anchorFromValue,
  anchorLabel,
  anchorValue,
  AUTOSAVE_MS,
  draftOf,
  excerpt,
  filterNotes,
  isNoteFilter,
  isSavable,
  NEW_NOTE,
  nextSaveState,
  type NoteFilter,
  saveLabel,
  type SaveEvent,
  type SaveState,
} from './notes-model';

/** Edit, Preview, or both side by side (wide only). */
export type EditorView = 'edit' | 'preview' | 'split';

interface AnchorOption {
  readonly value: string;
  readonly label: string;
}

interface AnchorGroup {
  readonly key: 'claims' | 'tasks';
  readonly options: readonly AnchorOption[];
}

/**
 * The Notes area's state (T100, ISC-95): the route's note, filter and search, the workspace's notes and the anchor
 * lists as resources, the editor's draft with its autosave, and the anchor picker's search. Provided by `NotesArea`,
 * so each instance of the page owns one; the popover, the preview's sanitizing and the dialogs stay in the page.
 *
 * - The editor writes on its own: a debounced `POST` for a new note once its body has text (then the URL becomes the
 *   note's), a debounced `PUT` of the whole draft after that; the state reads "saved · <instant>" from the server's time.
 * - The import notice is dismissed through `/api/settings` (`notesImportDismissed`), never browser storage.
 */
@Injectable()
export class NotesStore {
  private readonly api = inject(ApiClient);
  private readonly shell = inject(ShellState);
  private readonly settings = inject(SettingsService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly transloco = inject(TranslocoService);
  private readonly translation = toSignal(this.transloco.selectTranslation());
  private readonly navigated = toSignal(this.router.events.pipe(filter((event) => event instanceof NavigationEnd)), { initialValue: null });

  readonly tier = this.shell.tier;
  readonly ws = computed(() => this.shell.ws() ?? '');
  /** The spec's canonical number, the anchor's `spec`: the head's id once the spec answered, else the route's. */
  readonly spec = computed(() => this.shell.specId() ?? '');

  // ─── Route state ───────────────────────────────────────────────────────────────────────────────────────────────
  readonly noteId = computed(() => {
    this.navigated();
    return this.route.snapshot.firstChild?.paramMap.get('noteId') ?? null;
  });
  private readonly query = computed(() => {
    this.navigated();
    return this.route.snapshot.queryParamMap;
  });
  readonly filter = computed<NoteFilter>(() => {
    const value = this.query().get('filter');
    return isNoteFilter(value) ? value : 'spec';
  });
  readonly search = computed(() => this.query().get('q') ?? '');
  readonly wide = computed(() => this.tier() === 'wide');
  readonly mode = computed(() => (this.wide() ? 'split' : this.noteId() === null ? 'list' : 'editor'));

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
  readonly notes = linkedSignal<readonly Note[]>(() => {
    const result = this.listing.hasValue() ? this.listing.value() : undefined;
    return result?.kind === 'ok' ? result.body : [];
  });
  readonly loaded = computed(() => this.listing.hasValue() || this.listing.error() !== undefined);
  readonly failed = computed(() => {
    const result = this.listing.hasValue() ? this.listing.value() : undefined;
    return this.listing.error() !== undefined || (result !== undefined && result.kind !== 'ok');
  });
  readonly visible = computed(() => filterNotes(this.notes(), this.filter(), this.spec(), this.search()));
  readonly selected = computed(() => this.notes().find((note) => note.id === this.noteId()));
  readonly editing = computed(() => this.noteId() === NEW_NOTE || this.selected() !== undefined);

  readonly filterOptions = computed<readonly FilterOption[]>(() => {
    this.translation();
    const labels: Record<NoteFilter, string> =
      this.tier() === 'compact'
        ? { workspace: 'notes.filter.all', unanchored: 'notes.filter.unanchored', spec: 'notes.filter.byAnchor' }
        : { spec: 'notes.filter.spec', unanchored: 'notes.filter.unanchored', workspace: 'notes.filter.workspace' };
    const order: readonly NoteFilter[] = this.tier() === 'compact' ? ['workspace', 'unanchored', 'spec'] : ['spec', 'unanchored', 'workspace'];
    const all = this.notes();
    return order.map((key) => ({ key, label: this.transloco.translate(labels[key]), count: filterNotes(all, key, this.spec(), '').length }));
  });

  readonly rows = computed(() =>
    this.visible().map((note) => ({
      note,
      title: note.title !== '' ? note.title : excerpt(note.body),
      line: note.title !== '' ? excerpt(note.body) : '',
      anchor: anchorLabel(note.anchor, this.spec()),
    })),
  );

  // ─── Editor ────────────────────────────────────────────────────────────────────────────────────────────────────
  /** Which note the editor shows and whether it is loaded: a change re-seeds the draft and the save state. */
  private readonly editorKey = computed(() => `${this.noteId() ?? ''}|${this.editing() ? 1 : 0}`);
  /** The id `POST` just gave the new note: its draft carries over from `new` instead of being re-seeded. */
  private createdId: string | null = null;

  readonly draft = linkedSignal<string, NoteDraft>({
    source: () => this.editorKey(),
    computation: (_key, previous) => {
      const id = untracked(this.noteId);
      if (previous?.source.startsWith(`${NEW_NOTE}|`) && id !== null && id === this.createdId) return previous.value;
      const note = untracked(this.selected);
      const spec = untracked(this.spec);
      return note ? draftOf(note) : { anchor: spec === '' ? null : { kind: 'spec', spec }, title: '', body: '' };
    },
  });
  readonly saveState = linkedSignal<string, SaveState>({
    source: () => this.editorKey(),
    computation: (_key, previous) => {
      if (previous?.source.startsWith(`${NEW_NOTE}|`) && untracked(this.noteId) === this.createdId) return previous.value;
      const note = untracked(this.selected);
      return note ? { kind: 'saved', at: note.updated } : { kind: 'idle' };
    },
  });
  /** The autosave hint's key and, once saved, the raw instant `<ui-time-label>` formats. */
  readonly saveHint = computed(() => saveLabel(this.saveState()));

  readonly view = signal<EditorView>('edit');
  readonly shownView = computed<EditorView>(() => (this.view() === 'split' && !this.wide() ? 'edit' : this.view()));
  readonly viewOptions = computed<readonly SegmentedOption[]>(() => {
    this.translation();
    const keys: readonly EditorView[] = this.wide() ? ['edit', 'preview', 'split'] : ['edit', 'preview'];
    return keys.map((key) => ({ key, label: this.transloco.translate(`notes.editor.view.${key}`) }));
  });

  // ─── Anchor picker ─────────────────────────────────────────────────────────────────────────────────────────────
  readonly anchorValue = computed(() => anchorValue(this.draft().anchor));
  private readonly anchorGroups = computed<readonly AnchorGroup[]>(() => {
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
  readonly foreignAnchor = computed<AnchorOption | null>(() => {
    const value = this.anchorValue();
    const anchor = this.draft().anchor;
    if (anchor === null || value === `spec:${this.spec()}`) return null;
    if (this.anchorGroups().some((group) => group.options.some((option) => option.value === value))) return null;
    const label = anchorLabel(anchor, this.spec());
    return { value, label: label?.text ?? value };
  });
  readonly anchorChip = computed(() => anchorLabel(this.draft().anchor, this.spec()));
  /** The return button's spec (prototype `note-return`): the anchor's spec, else this one. */
  readonly returnSpec = computed(() => this.draft().anchor?.spec ?? this.spec());
  readonly pickerSearch = signal('');
  readonly pickerGroups = computed(() => {
    const needle = this.pickerSearch().trim().toLowerCase();
    return this.anchorGroups().map((group) => ({
      ...group,
      options: needle === '' ? group.options : group.options.filter((option) => option.label.toLowerCase().includes(needle)),
    }));
  });

  // ─── Import notice ─────────────────────────────────────────────────────────────────────────────────────────────
  readonly importDismissed = computed(() => this.settings.settings().notesImportDismissed);

  private pending: { id: string; draft: NoteDraft } | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private inFlight = false;

  /** Reads the settings the import notice hangs on. */
  load(): void {
    void this.settings.load();
  }

  link(noteId?: string): string[] {
    const base = ['/w', this.ws(), 's', this.spec(), 'notes'];
    return noteId === undefined ? base : [...base, noteId];
  }

  setFilter(value: string | undefined): void {
    void this.router.navigate([], { relativeTo: this.route.firstChild ?? this.route, queryParams: { filter: value === 'spec' ? null : value }, queryParamsHandling: 'merge', replaceUrl: true });
  }

  setSearch(value: string): void {
    void this.router.navigate([], { relativeTo: this.route.firstChild ?? this.route, queryParams: { q: value === '' ? null : value }, queryParamsHandling: 'merge', replaceUrl: true });
  }

  setView(value: string | undefined): void {
    if (value === 'edit' || value === 'preview' || value === 'split') this.view.set(value);
  }

  edit(patch: Partial<NoteDraft>): void {
    const id = this.noteId();
    if (id === null) return;
    const draft = { ...this.draft(), ...patch };
    this.draft.set(draft);
    this.pending = { id, draft };
    this.step({ type: 'edit' });
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), AUTOSAVE_MS);
  }

  /** Sets the draft's anchor from a picker value (`''`, `spec:<id>`, `claim:…`, `task:…`). */
  pickAnchor(value: string): void {
    this.edit({ anchor: anchorFromValue(value) });
  }

  async dismissImport(): Promise<void> {
    await this.settings.update({ notesImportDismissed: true });
  }

  /** Deletes the open note (a new one only drops its draft), then shows the list. */
  async deleteCurrent(): Promise<void> {
    const id = this.noteId();
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
  async flush(): Promise<void> {
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

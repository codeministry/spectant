import type { AnchorKind, Note, NoteAnchor, NoteDraft } from '../../../../../../server/src/contracts/notes.contract';

/**
 * The Notes area's pure helpers (T100, ISC-95): the list filter, the anchor chip and select value, the row excerpt and
 * the autosave state. No Angular here, so each is unit-tested on its own (`notes-model.spec.ts`).
 */

/** The list chips: notes anchored anywhere in this spec, the unanchored ones, or the whole workspace. */
export const NOTE_FILTERS = ['spec', 'unanchored', 'workspace'] as const;
export type NoteFilter = (typeof NOTE_FILTERS)[number];

export const isNoteFilter = (value: unknown): value is NoteFilter => (NOTE_FILTERS as readonly unknown[]).includes(value);

/** The route segment of the editor for a note not stored yet. */
export const NEW_NOTE = 'new';

/** How long the editor waits after the last keystroke before it writes (debounced `PUT`). */
export const AUTOSAVE_MS = 600;

/** The notes a chip and the search leave, in the server's order (newest first). The search matches title and body. */
export function filterNotes(notes: readonly Note[], filter: NoteFilter, spec: string, search: string): Note[] {
  const needle = search.trim().toLowerCase();
  return notes.filter((note) => {
    if (filter === 'spec' && note.anchor?.spec !== spec) return false;
    if (filter === 'unanchored' && note.anchor !== null) return false;
    return needle === '' || `${note.title}\n${note.body}`.toLowerCase().includes(needle);
  });
}

/** The anchor chip's content: the kind (for the spec word) and the id; another spec's claim or task names that spec. */
export interface AnchorLabel {
  readonly kind: AnchorKind;
  readonly text: string;
}

export function anchorLabel(anchor: NoteAnchor | null, spec: string): AnchorLabel | null {
  if (anchor === null) return null;
  if (anchor.kind === 'spec') return { kind: 'spec', text: anchor.spec };
  return { kind: anchor.kind, text: anchor.spec === spec ? anchor.id : `${anchor.spec} · ${anchor.id}` };
}

/** The anchor as one `<select>` value: '' for none, `spec:002`, `claim:002:ISC-51`, `task:002:T1`. */
export function anchorValue(anchor: NoteAnchor | null): string {
  if (anchor === null) return '';
  return anchor.kind === 'spec' ? `spec:${anchor.spec}` : `${anchor.kind}:${anchor.spec}:${anchor.id}`;
}

/** The inverse of `anchorValue`; null for '' and for anything it does not produce. */
export function anchorFromValue(value: string): NoteAnchor | null {
  const parts = value.split(':');
  if (parts.length < 2 || parts[1] === '') return null;
  const [kind, spec, ...rest] = parts as [string, string, ...string[]];
  if (kind === 'spec' && rest.length === 0) return { kind, spec };
  const id = rest.join(':');
  return (kind === 'claim' || kind === 'task') && id !== '' ? { kind, spec, id } : null;
}

/** The first line with text, without its Markdown heading, quote or list marker: a row's muted line and title fallback. */
export function excerpt(body: string): string {
  for (const line of body.split('\n')) {
    const text = line.replace(/^\s*(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+)?/, '').trim();
    if (text !== '') return text;
  }
  return '';
}

/** What the editor holds: exactly the `NoteDraft` a `POST` or `PUT` sends. */
export const draftOf = (note: Note): NoteDraft => ({ anchor: note.anchor, title: note.title, body: note.body });

/** The server refuses a blank body (`empty-body`), so a draft without one waits instead of being sent. */
export const isSavable = (draft: NoteDraft): boolean => draft.body.trim() !== '';

/** The autosave state shown next to "Local": nothing yet, unsaved edits, a write in flight, saved at a time, failed. */
export type SaveState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'pending' }
  | { readonly kind: 'saving' }
  | { readonly kind: 'saved'; readonly at: string }
  | { readonly kind: 'failed' };

export type SaveEvent = { readonly type: 'edit' } | { readonly type: 'start' } | { readonly type: 'saved'; readonly at: string } | { readonly type: 'fail' };

/**
 * The next autosave state. An edit while a write is in flight keeps the state `pending` when that write lands, so
 * "saved" is never shown over text the server has not seen yet.
 */
export function nextSaveState(state: SaveState, event: SaveEvent): SaveState {
  switch (event.type) {
    case 'edit':
      return { kind: 'pending' };
    case 'start':
      return { kind: 'saving' };
    case 'saved':
      return state.kind === 'saving' ? { kind: 'saved', at: event.at } : state;
    case 'fail':
      return { kind: 'failed' };
  }
}

/** What the autosave hint shows: the `notes.save.*` key and, for `saved`, the raw instant that `<ui-time-label>` formats. */
export interface SaveLabel {
  readonly key: string;
  readonly at: string | null;
}

/** The autosave hint for a state; null shows nothing. The time stays an ISO string: `shared/time` formats it (ISC-114.2). */
export function saveLabel(state: SaveState): SaveLabel | null {
  switch (state.kind) {
    case 'idle':
      return null;
    case 'saved':
      return { key: 'notes.save.saved', at: state.at };
    default:
      return { key: `notes.save.${state.kind}`, at: null };
  }
}

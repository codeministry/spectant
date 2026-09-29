/**
 * The notes contract (T94, ISC-94, ISC-95; plan 002 § Interfaces "HTTP", § Data Model).
 *
 * A note is the developer's own text, kept in `spectant.db` in the data directory (`db.ts`, migration 2) and nowhere
 * else: no code path behind these routes opens, writes or even resolves a path inside a registered repository, and a
 * note carries no path (ISC-94, ISC-15, ISC-3). Its anchor is a reference string into the parsed spec, resolved at read
 * time, never copied from the files (ISC-7).
 *
 * Consumers, building against this file without talking to each other:
 * 1. `server/src/notes.ts` (T95) stores `NoteRow`s, answers `NOTE_ROUTE_TABLE` with `matchNoteRoute`, and validates
 *    every body and query with the parsers below before touching the database.
 * 2. The web Notes area and the Claims tab's badge (T100, T101) build URLs with `noteRoutes`, type answers with
 *    `NoteRouteResponses` and read a claim's count with `noteCountFor`.
 *
 * Shape decisions against plan 002's sketch: the anchor is `{kind, spec, id?}`, not one `ref` string, because claim and
 * task ids repeat across specs (every spec has an `ISC-1`); updates are `PUT` (the draft is replaced whole), not
 * `PATCH`; `workspace` is `null` only for an orphan whose workspace was removed (ON DELETE SET NULL). `title` stays from
 * the plan and design.md (list rows show a title and the body's first line); `pinned` from the design is a boolean
 * (migration 3, T97, ISC-52): a `POST` without it creates an unpinned note, a `PUT` without it keeps the pin.
 *
 * Error spelling follows `spec-routes.contract.ts`: kebab-case `{error: "…"}`. Every 400 names one code of
 * `NOTE_VALIDATION_ERRORS`; the route codes are the API's own. Browser-safe: the only import is that contract.
 */
import { SPEC_API_ROOT, type Forbidden, type InvalidBody, type MethodNotAllowed, type NotFound } from './spec-routes.contract.ts';

// ─── Shape ───────────────────────────────────────────────────────────────────────────────────────────────────────

export const ANCHOR_KINDS = ['spec', 'claim', 'task'] as const;
export type AnchorKind = (typeof ANCHOR_KINDS)[number];

/** At most one of these per note. `spec` is the canonical `NNN` (the dashboard row's id); `id` a claim or task id. */
export type NoteAnchor =
  | { readonly kind: 'spec'; readonly spec: string }
  | { readonly kind: 'claim' | 'task'; readonly spec: string; readonly id: string };

export interface Note {
  /** Server-generated, a lowercase UUID (`crypto.randomUUID()`). */
  readonly id: string;
  /** The workspace slug; null for an orphan whose workspace was removed. */
  readonly workspace: string | null;
  readonly anchor: NoteAnchor | null;
  /** May be empty; at most `NOTE_TITLE_MAX` characters, trimmed. */
  readonly title: string;
  /** Markdown, never blank. */
  readonly body: string;
  /** Pinned to the top of the Notes list; false unless a draft set it. */
  readonly pinned: boolean;
  /** ISO 8601 UTC, `new Date().toISOString()`. */
  readonly created: string;
  readonly updated: string;
}

/** What a client sends and what `PUT` replaces whole: the workspace comes from the path, id and times from the server. */
export interface NoteDraft {
  readonly anchor: NoteAnchor | null;
  readonly title: string;
  readonly body: string;
  /** Absent: `POST` stores false, `PUT` keeps the stored pin, so a client that never shows pins cannot drop one. */
  readonly pinned?: boolean;
}

/** A draft bound to the workspace in the path: what `POST` inserts. */
export interface NewNote extends NoteDraft {
  readonly workspace: string;
}

/** `POST` and `PUT` bodies. `anchor` and `title` may be left out (no anchor, empty title). */
export interface NoteRequest {
  readonly anchor?: NoteAnchor | null;
  readonly title?: string;
  readonly body: string;
  readonly pinned?: boolean;
}

/** The per-anchor counts of one spec: the head's "n notes" pill (`total`) and the Claims tab's badge (ISC-95). */
export interface NoteCounts {
  readonly spec: string;
  /** Every note of the workspace anchored anywhere in the spec. */
  readonly total: number;
  /** Notes anchored to the spec itself. */
  readonly onSpec: number;
  /** Claim id → count; a claim without notes is absent. */
  readonly claims: Readonly<Record<string, number>>;
  /** Task id → count; a task without notes is absent. */
  readonly tasks: Readonly<Record<string, number>>;
}

/** The list filter: all of the workspace, one spec, one claim or task of a spec, the unanchored, or the orphans. */
export interface NotesQuery {
  readonly spec?: string;
  readonly claim?: string;
  readonly task?: string;
  readonly unanchored?: true;
  readonly orphans?: true;
}

export const NOTE_TITLE_MAX = 200;

// ─── Validation ──────────────────────────────────────────────────────────────────────────────────────────────────

/** Every 400 code, in the body `{error}`. */
export const NOTE_VALIDATION_ERRORS = [
  'invalid-body',
  'invalid-id',
  'invalid-workspace',
  'invalid-anchor',
  'multiple-anchors',
  'invalid-title',
  'empty-body',
  'invalid-query',
] as const;
export type NoteValidationError = (typeof NOTE_VALIDATION_ERRORS)[number];

/** Every code a notes route answers: the API's route codes plus the validation codes. */
export const NOTE_ERRORS = ['not-found', 'forbidden', 'method-not-allowed', ...NOTE_VALIDATION_ERRORS] as const;
export type NoteErrorCode = (typeof NOTE_ERRORS)[number];

export interface NoteInvalid {
  readonly error: NoteValidationError;
}

export type NoteCheck<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: NoteValidationError };

const SPEC_ID = /^\d{3}$/;
/** Claim ids (`ISC-94.1`, `H-AVAIL`, `C4`) and task ids (`T95`); resolved against the parsed spec at read time. */
const ANCHOR_ID = /^[A-Za-z][\w.-]{0,63}$/;
const NOTE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;
const NOT_IN_SLUG = /[/\\\p{Cc}]/u;

const ok = <T>(value: T): NoteCheck<T> => ({ ok: true, value });
const fail = (error: NoteValidationError): { readonly ok: false; readonly error: NoteValidationError } => ({ ok: false, error });

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function onlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

/** A registry slug: the repository's basename, maybe with `-2`; never empty, `.`, `..`, a separator or a control char. */
export function isWorkspaceSlug(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 255 && value !== '.' && value !== '..' && !NOT_IN_SLUG.test(value);
}

export function isNoteId(value: unknown): value is string {
  return typeof value === 'string' && NOTE_ID.test(value);
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && ISO_UTC.test(value) && !Number.isNaN(Date.parse(value));
}

/** null or absent → no anchor; a list → `multiple-anchors`; else exactly one `{kind, spec, id?}`. */
export function parseAnchor(value: unknown): NoteCheck<NoteAnchor | null> {
  if (value === undefined || value === null) return ok(null);
  if (Array.isArray(value)) return fail('multiple-anchors');
  if (!isPlainObject(value) || !onlyKeys(value, ['kind', 'spec', 'id'])) return fail('invalid-anchor');
  const { kind, spec, id } = value;
  if (typeof spec !== 'string' || !SPEC_ID.test(spec)) return fail('invalid-anchor');
  if (kind === 'spec') return id === undefined ? ok({ kind, spec }) : fail('invalid-anchor');
  if ((kind === 'claim' || kind === 'task') && typeof id === 'string' && ANCHOR_ID.test(id)) return ok({ kind, spec, id });
  return fail('invalid-anchor');
}

function parseTitle(value: unknown): NoteCheck<string> {
  if (value === undefined) return ok('');
  if (typeof value !== 'string') return fail('invalid-title');
  const title = value.trim();
  return title.length <= NOTE_TITLE_MAX ? ok(title) : fail('invalid-title');
}

function parseBody(value: unknown): NoteCheck<string> {
  if (value === undefined) return fail('empty-body');
  if (typeof value !== 'string') return fail('invalid-body');
  return value.trim() === '' ? fail('empty-body') : ok(value);
}

function parseFields(value: Record<string, unknown>): NoteCheck<NoteDraft> {
  const anchor = parseAnchor(value.anchor);
  if (!anchor.ok) return anchor;
  const title = parseTitle(value.title);
  if (!title.ok) return title;
  const body = parseBody(value.body);
  if (!body.ok) return body;
  const { pinned } = value;
  if (pinned !== undefined && typeof pinned !== 'boolean') return fail('invalid-body');
  const draft = { anchor: anchor.value, title: title.value, body: body.value };
  return ok(pinned === undefined ? draft : { ...draft, pinned });
}

/** A `POST` or `PUT` body. A second anchor (`anchors`) is `multiple-anchors`; any other extra key is `invalid-body`. */
export function parseNoteDraft(value: unknown): NoteCheck<NoteDraft> {
  if (!isPlainObject(value)) return fail('invalid-body');
  if (Object.hasOwn(value, 'anchors')) return fail('multiple-anchors');
  if (!onlyKeys(value, ['anchor', 'title', 'body', 'pinned'])) return fail('invalid-body');
  return parseFields(value);
}

/** A `POST` body bound to the path's workspace. */
export function parseNewNote(workspace: unknown, value: unknown): NoteCheck<NewNote> {
  if (!isWorkspaceSlug(workspace)) return fail('invalid-workspace');
  const draft = parseNoteDraft(value);
  return draft.ok ? ok({ workspace, ...draft.value }) : draft;
}

const NOTE_KEYS = ['id', 'workspace', 'anchor', 'title', 'body', 'pinned', 'created', 'updated'] as const;

/** A whole stored or answered note. `workspace` must be present: a slug, or null for an orphan. */
export function validateNote(value: unknown): NoteCheck<Note> {
  if (!isPlainObject(value)) return fail('invalid-body');
  if (Object.hasOwn(value, 'anchors')) return fail('multiple-anchors');
  if (!onlyKeys(value, NOTE_KEYS)) return fail('invalid-body');
  const { id, workspace, pinned, created, updated } = value;
  if (!isNoteId(id)) return fail('invalid-id');
  if (!Object.hasOwn(value, 'workspace') || (workspace !== null && !isWorkspaceSlug(workspace))) return fail('invalid-workspace');
  if (!Object.hasOwn(value, 'anchor')) return fail('invalid-anchor');
  const fields = parseFields(value);
  if (!fields.ok) return fields;
  if (typeof pinned !== 'boolean' || !isTimestamp(created) || !isTimestamp(updated)) return fail('invalid-body');
  return ok({ id, workspace, anchor: fields.value.anchor, title: fields.value.title, body: fields.value.body, pinned, created, updated });
}

const QUERY_KEYS = ['spec', 'claim', 'task', 'unanchored', 'orphans'] as const;

/** The list route's query (`URL.search` or its params). Each key at most once; claim and task need their spec. */
export function parseNotesQuery(search: string | URLSearchParams): NoteCheck<NotesQuery> {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search;
  const keys = [...params.keys()];
  if (new Set(keys).size !== keys.length || !keys.every((key) => (QUERY_KEYS as readonly string[]).includes(key))) return fail('invalid-query');
  const spec = params.get('spec');
  const claim = params.get('claim');
  const task = params.get('task');
  const unanchored = params.get('unanchored');
  const orphans = params.get('orphans');
  if (unanchored !== null) return unanchored === '1' && keys.length === 1 ? ok({ unanchored: true }) : fail('invalid-query');
  if (orphans !== null) return orphans === '1' && keys.length === 1 ? ok({ orphans: true }) : fail('invalid-query');
  if (spec === null) return keys.length === 0 ? ok({}) : fail('invalid-query');
  if (!SPEC_ID.test(spec) || (claim !== null && task !== null)) return fail('invalid-query');
  if (claim !== null) return ANCHOR_ID.test(claim) ? ok({ spec, claim }) : fail('invalid-query');
  if (task !== null) return ANCHOR_ID.test(task) ? ok({ spec, task }) : fail('invalid-query');
  return ok({ spec });
}

/** The counts route's query: exactly `?spec=NNN`. */
export function parseNoteCountsQuery(search: string | URLSearchParams): NoteCheck<{ readonly spec: string }> {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search;
  const keys = [...params.keys()];
  const spec = params.get('spec');
  return keys.length === 1 && spec !== null && SPEC_ID.test(spec) ? ok({ spec }) : fail('invalid-query');
}

/** A claim's, task's or the spec's own count from `NoteCounts`; 0 when absent or for another spec. Own keys only. */
export function noteCountFor(counts: NoteCounts, anchor: NoteAnchor): number {
  if (anchor.spec !== counts.spec) return 0;
  if (anchor.kind === 'spec') return counts.onSpec;
  const table = anchor.kind === 'claim' ? counts.claims : counts.tasks;
  return Object.hasOwn(table, anchor.id) ? (table[anchor.id] ?? 0) : 0;
}

// ─── Storage mapping ─────────────────────────────────────────────────────────────────────────────────────────────

/** One `note` row (`db.ts` migration 2). The anchor is one column triple, so a row cannot hold two. */
export interface NoteRow {
  readonly id: string;
  readonly workspace: string | null;
  readonly anchor_kind: AnchorKind | null;
  readonly anchor_spec: string | null;
  readonly anchor_id: string | null;
  readonly title: string;
  readonly body: string;
  readonly created_at: string;
  readonly updated_at: string;
  /** 0 or 1 (migration 3). */
  readonly pinned: number;
}

export type AnchorColumns = Pick<NoteRow, 'anchor_kind' | 'anchor_spec' | 'anchor_id'>;

export function anchorColumns(anchor: NoteAnchor | null): AnchorColumns {
  if (anchor === null) return { anchor_kind: null, anchor_spec: null, anchor_id: null };
  return { anchor_kind: anchor.kind, anchor_spec: anchor.spec, anchor_id: anchor.kind === 'spec' ? null : anchor.id };
}

/** The inverse of `anchorColumns`. Throws on a triple the schema's CHECK should have refused. */
export function anchorFromColumns(kind: string | null, spec: string | null, id: string | null): NoteAnchor | null {
  if (kind === null && spec === null && id === null) return null;
  const check = parseAnchor(id === null ? { kind, spec } : { kind, spec, id });
  if (!check.ok || check.value === null) throw new Error(`note row holds an invalid anchor (${String(kind)}, ${String(spec)}, ${String(id)})`);
  return check.value;
}

export function noteFromRow(row: NoteRow): Note {
  return {
    id: row.id,
    workspace: row.workspace,
    anchor: anchorFromColumns(row.anchor_kind, row.anchor_spec, row.anchor_id),
    title: row.title,
    body: row.body,
    pinned: row.pinned === 1,
    created: row.created_at,
    updated: row.updated_at,
  };
}

// ─── Routes ──────────────────────────────────────────────────────────────────────────────────────────────────────

export type NoteRouteName = 'list' | 'create' | 'update' | 'remove' | 'counts';
export type NoteRouteMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

export interface NoteRouteParams {
  list: { readonly ws: string };
  create: { readonly ws: string };
  update: { readonly ws: string; readonly id: string };
  remove: { readonly ws: string; readonly id: string };
  counts: { readonly ws: string };
}

export type NoteRouteMatch = { [R in NoteRouteName]: { readonly route: R; readonly params: NoteRouteParams[R] } }[NoteRouteName];

/** The 200/201 body of each route; `remove` answers 204 without one. */
export interface NoteRouteResponses {
  list: readonly Note[];
  create: Note;
  update: Note;
  remove: null;
  counts: NoteCounts;
}

/** Every non-2xx body a notes route sends. */
export type NoteRouteError = NoteInvalid | InvalidBody | NotFound | Forbidden | MethodNotAllowed;

export interface NoteRouteEntry {
  readonly route: NoteRouteName;
  /** `GET` routes also answer `HEAD`. */
  readonly method: NoteRouteMethod;
  readonly pattern: string;
  /** Every status the route answers, ascending. */
  readonly statuses: readonly number[];
  readonly response: string;
}

const enc = encodeURIComponent;
const wsRoot = (ws: string): string => `${SPEC_API_ROOT}/${enc(ws)}`;

function queryString(query: NotesQuery | undefined): string {
  if (query === undefined) return '';
  const pairs: string[] = [];
  for (const key of ['spec', 'claim', 'task'] as const) {
    const value = query[key];
    if (value !== undefined) pairs.push(`${key}=${enc(value)}`);
  }
  if (query.unanchored) pairs.push('unanchored=1');
  if (query.orphans) pairs.push('orphans=1');
  return pairs.length === 0 ? '' : `?${pairs.join('&')}`;
}

/** URL builders: each segment percent-encoded once; a path and query, no origin. */
export const noteRoutes = {
  list: (ws: string, query?: NotesQuery): string => `${wsRoot(ws)}/notes${queryString(query)}`,
  create: (ws: string): string => `${wsRoot(ws)}/notes`,
  update: (ws: string, id: string): string => `${wsRoot(ws)}/notes/${enc(id)}`,
  remove: (ws: string, id: string): string => `${wsRoot(ws)}/notes/${enc(id)}`,
  counts: (ws: string, spec: string): string => `${wsRoot(ws)}/note-counts?spec=${enc(spec)}`,
} as const;

const W = `${SPEC_API_ROOT}/:ws`;

/** Every notes route once. 404: unknown workspace or note id; 400: a `NoteInvalid` body. */
export const NOTE_ROUTE_TABLE: readonly NoteRouteEntry[] = [
  { route: 'list', method: 'GET', pattern: `${W}/notes`, statuses: [200, 304, 400, 403, 404, 405], response: 'Note[]' },
  { route: 'create', method: 'POST', pattern: `${W}/notes`, statuses: [201, 400, 403, 404, 405], response: 'Note' },
  { route: 'update', method: 'PUT', pattern: `${W}/notes/:id`, statuses: [200, 400, 403, 404, 405], response: 'Note' },
  { route: 'remove', method: 'DELETE', pattern: `${W}/notes/:id`, statuses: [204, 403, 404, 405], response: 'no body' },
  { route: 'counts', method: 'GET', pattern: `${W}/note-counts`, statuses: [200, 304, 400, 403, 404, 405], response: 'NoteCounts' },
];

type Resource = { readonly kind: 'collection' | 'counts'; readonly ws: string } | { readonly kind: 'item'; readonly ws: string; readonly id: string };

const ROOT_PARTS = SPEC_API_ROOT.split('/').slice(1);

function decodeOnce(segment: string | undefined): string | null {
  if (segment === undefined || segment === '') return null;
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

function resourceOf(pathname: string): Resource | null {
  const parts = pathname.split('/').slice(1);
  if (!ROOT_PARTS.every((part, i) => parts[i] === part)) return null;
  const [rawWs, section, rawId, ...rest] = parts.slice(ROOT_PARTS.length);
  const ws = decodeOnce(rawWs);
  if (ws === null || rest.length > 0) return null;
  if (section === 'note-counts' && rawId === undefined) return { kind: 'counts', ws };
  if (section !== 'notes') return null;
  if (rawId === undefined) return { kind: 'collection', ws };
  const id = decodeOnce(rawId);
  return id === null ? null : { kind: 'item', ws, id };
}

/** The route a pathname (`URL.pathname`, still encoded) and method name; `HEAD` counts as `GET`. Null otherwise. */
export function matchNoteRoute(pathname: string, method: string): NoteRouteMatch | null {
  const resource = resourceOf(pathname);
  if (resource === null) return null;
  const verb = method.toUpperCase() === 'HEAD' ? 'GET' : method.toUpperCase();
  if (resource.kind === 'item') {
    const params = { ws: resource.ws, id: resource.id };
    if (verb === 'PUT') return { route: 'update', params };
    return verb === 'DELETE' ? { route: 'remove', params } : null;
  }
  const params = { ws: resource.ws };
  if (resource.kind === 'counts') return verb === 'GET' ? { route: 'counts', params } : null;
  if (verb === 'GET') return { route: 'list', params };
  return verb === 'POST' ? { route: 'create', params } : null;
}

/** The `Allow` header of a 405 on a notes path; null when the path is no notes route at all. */
export function noteAllowFor(pathname: string): string | null {
  const resource = resourceOf(pathname);
  if (resource === null) return null;
  return { collection: 'GET, HEAD, POST', item: 'PUT, DELETE', counts: 'GET, HEAD' }[resource.kind];
}

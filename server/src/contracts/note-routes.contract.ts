/**
 * The notes routes and the row mapping (T94, ISC-94, ISC-95; plan 002 § Interfaces "HTTP", § Data Model), the second
 * half of the notes contract: the shape and the validation are in `notes.contract.ts`, which this file re-exports, so
 * one import still reaches the whole contract.
 *
 * Consumers: `server/src/notes.ts` (T95) stores `NoteRow`s and answers `NOTE_ROUTE_TABLE` with `matchNoteRoute`;
 * the web Notes area and the Claims tab's badge (T100, T101) build URLs with `noteRoutes` and type answers with
 * `NoteRouteResponses`.
 *
 * Browser-safe: the only imports are `notes.contract.ts` and `spec-routes.contract.ts`.
 */
import { SPEC_API_ROOT, type Forbidden, type InvalidBody, type MethodNotAllowed, type NotFound } from './spec-routes.contract.ts';
import { parseAnchor, type AnchorKind, type Note, type NoteAnchor, type NoteCounts, type NoteInvalid, type NotesQuery } from './notes.contract.ts';

export * from './notes.contract.ts';

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

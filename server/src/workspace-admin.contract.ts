/**
 * The workspace admin contract (spec 016, T1, ISC-303; plan 016 § Interfaces and § Data Model).
 *
 * This file is the seam between three consumers that build against it without talking to each other:
 *
 * 1. The server's admin routes (T2–T9) answer every route in `WORKSPACE_ADMIN_ROUTE_TABLE`: `matchWorkspaceAdminRoute`
 *    finds the route and its decoded params, `workspaceAdminAllowFor` names the 405's `Allow`, the parsers below admit
 *    the bodies, `sniffImageType` decides an upload's type, and the error interfaces name every refusal.
 * 2. `web/e2e/stub-api.ts` answers the same routes per session in memory, with the same statuses and bodies.
 * 3. The web `ApiClient` (T13) builds every URL with `workspaceAdminRoutes`, types every answer with
 *    `WorkspaceAdminResponses`, and the settings page sorts its rows with `compareWorkspaces`.
 *
 * Routes, all under the loopback guard of `settingsApi` (403 `{error: "forbidden"}` for a foreign `Host` or a
 * cross-site `Origin`), checked before anything else:
 *
 * | Route      | Method       | Path                               | Body                 | 2xx                         |
 * |------------|--------------|------------------------------------|----------------------|-----------------------------|
 * | `add`      | `POST`       | `/api/workspaces`                  | `{path, name?}`      | 201 `WorkspaceAdminSummary` |
 * | `rename`   | `PATCH`      | `/api/workspaces/:ws`              | `{name}`             | 200 `WorkspaceAdminSummary` |
 * | `rescan`   | `POST`       | `/api/workspaces/:ws/rescan`       | none                 | 200 `WorkspaceAdminSummary` |
 * | `remove`   | `DELETE`     | `/api/workspaces/:ws`              | none                 | 204, no body                |
 * | `putImage` | `PUT`        | `/api/workspaces/:ws/images/:kind` | raw bytes            | 200 `ImageStored`           |
 * | `getImage` | `GET`/`HEAD` | `/api/workspaces/:ws/images/:kind` | none                 | 200 the bytes               |
 *
 * `GET /api/workspaces` stays the list route of `api.ts` (same path, order and ETag behaviour); its body grows by the
 * fields of `WorkspaceSummaryAdded`. Every write touches only the registry and the app's data folder
 * (`<data>/workspaces/<slug>/` for the images), never a file of a registered repository (ISC-308). No answer carries an
 * absolute path: a summary names `pathTail` only, an image its loopback URL.
 *
 * Params: `:ws` is the workspace slug, `:kind` one of `IMAGE_KINDS`; a path whose `:kind` is anything else is no admin
 * route (the server's JSON 404). Builders percent-encode each segment once; the matcher decodes each once.
 *
 * Error spelling: kebab-case `{error: "…"}`, like every existing route.
 *
 * Browser-safe: no Bun or Node import; the only value import is `spec-routes.contract.ts`, the rest is `import type`.
 */
import type { DashboardKpis } from '../../core/src/dashboard-kpis.ts';
import {
  SPEC_API_ROOT,
  type Forbidden,
  type InvalidBody,
  type MethodNotAllowed,
  type NotFound,
  type UnreadableCode,
} from './spec-routes.contract.ts';

// ─── Images ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** The two images a workspace may carry, each stored as one file under `<data>/workspaces/<slug>/`. */
export const IMAGE_KINDS = ['logo', 'screenshot'] as const;
export type ImageKind = (typeof IMAGE_KINDS)[number];

export function isImageKind(value: string): value is ImageKind {
  return (IMAGE_KINDS as readonly string[]).includes(value);
}

/** The upload limit in bytes (2 MiB); a larger body is refused with 413 and nothing is stored. */
export const IMAGE_MAX_BYTES = 2 * 1024 * 1024;

export type ImageTypeName = 'png' | 'jpeg' | 'webp';

export interface ImageType {
  /** The fixed `Content-Type` the image route serves the file with; never taken from the upload's own header. */
  readonly contentType: string;
  /** The extension of the stored file, `<kind>.<ext>`. */
  readonly ext: string;
  /** The magic bytes by offset: every listed byte must match for the type to apply. */
  readonly magic: ReadonlyArray<{ readonly offset: number; readonly bytes: readonly number[] }>;
}

/**
 * The only image types an upload may be, decided by magic bytes alone (ISC-311). SVG is never one, whatever its
 * header says: it can carry script. Read by `sniffImageType`; the server serves the stored file with `contentType`.
 */
export const IMAGE_TYPES: Readonly<Record<ImageTypeName, ImageType>> = {
  png: { contentType: 'image/png', ext: 'png', magic: [{ offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] }] },
  jpeg: { contentType: 'image/jpeg', ext: 'jpg', magic: [{ offset: 0, bytes: [0xff, 0xd8, 0xff] }] },
  webp: {
    contentType: 'image/webp',
    ext: 'webp',
    magic: [
      { offset: 0, bytes: [0x52, 0x49, 0x46, 0x46] }, // "RIFF"
      { offset: 8, bytes: [0x57, 0x45, 0x42, 0x50] }, // "WEBP"
    ],
  },
};

const IMAGE_TYPE_NAMES = Object.keys(IMAGE_TYPES) as ImageTypeName[];

/** The image type the bytes start with, or null for anything else (SVG, text, a truncated header, garbage). */
export function sniffImageType(bytes: Uint8Array): ImageTypeName | null {
  for (const name of IMAGE_TYPE_NAMES) {
    const matches = IMAGE_TYPES[name].magic.every(({ offset, bytes: expected }) =>
      bytes.length >= offset + expected.length && expected.every((byte, i) => bytes[offset + i] === byte),
    );
    if (matches) return name;
  }
  return null;
}

/** The query parameter that carries an image's version in the summary's URL, so a new upload busts the cache. */
export const IMAGE_VERSION_PARAM = 'v';

// ─── Summary ─────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * What a row of the settings page shows (ISC-309): `missing` whenever the workspace cannot be read (the reason stays in
 * `error`), `empty` when it reads without a spec, `ok` otherwise.
 */
export const WORKSPACE_STATUSES = ['ok', 'empty', 'missing'] as const;
export type WorkspaceStatus = (typeof WORKSPACE_STATUSES)[number];

/** The status of a workspace from its read: `specCount` null (no counts) on a readable workspace counts as no spec. */
export function workspaceStatusOf(readable: boolean, specCount: number | null): WorkspaceStatus {
  if (!readable) return 'missing';
  return specCount === null || specCount === 0 ? 'empty' : 'ok';
}

/** The image URLs of one workspace: `workspaceAdminRoutes.imageUrl` with the stored version, or null without an image. */
export type WorkspaceImages = Readonly<Record<ImageKind, string | null>>;

/**
 * The fields spec 016 adds to the list entries of `GET /api/workspaces` (T4, T7). Declared here so the server, the stub
 * and the web type them from one place. No `addedAt`: a re-add would change the list bytes and ETag, which the ISC-7
 * rebuild pin holds equal; the list is already in registry order, which is the order of adding.
 */
export interface WorkspaceSummaryAdded {
  readonly status: WorkspaceStatus;
  readonly images: WorkspaceImages;
}

/**
 * The full summary every admin route answers and `GET /api/workspaces` lists once T4 and T7 land: today's
 * `WorkspaceSummary` (`{slug, name, pathTail, readable, error?, counts}`, restated here because the contract imports no
 * server runtime module) plus `WorkspaceSummaryAdded`. Never an absolute path.
 */
export interface WorkspaceAdminSummary extends WorkspaceSummaryAdded {
  readonly slug: string;
  readonly name: string;
  /** The last segment of the workspace path; the path itself never leaves the server. */
  readonly pathTail: string;
  readonly readable: boolean;
  /** Present only when `readable` is false. */
  readonly error?: UnreadableCode;
  readonly counts: DashboardKpis | null;
}

// ─── Sort ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The page's `?sort=` values (ISC-313); sorting is a client concern and sends no request. */
export const WORKSPACE_SORT_KEYS = ['name', 'status', 'added'] as const;
export type WorkspaceSortKey = (typeof WORKSPACE_SORT_KEYS)[number];
export const DEFAULT_WORKSPACE_SORT: WorkspaceSortKey = 'added';

/** The sort key a `?sort=` value names; the default for a missing or unknown one. */
export function workspaceSortKeyOf(value: string | null | undefined): WorkspaceSortKey {
  return (WORKSPACE_SORT_KEYS as ReadonlyArray<string | null | undefined>).includes(value) ? (value as WorkspaceSortKey) : DEFAULT_WORKSPACE_SORT;
}

const STATUS_ORDER: Readonly<Record<WorkspaceStatus, number>> = { missing: 0, empty: 1, ok: 2 };
const NAME_COLLATOR = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

type Sortable = Pick<WorkspaceAdminSummary, 'slug' | 'name' | 'status'>;

/** Name order without regard to case, then by slug so equal names keep one stable order on every machine. */
function byName(a: Sortable, b: Sortable): number {
  return NAME_COLLATOR.compare(a.name, b.name) || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0);
}

/**
 * The comparator for one sort key: `name` by name; `status` missing → empty → ok, ties by name; `added` keeps the
 * list as it came, the registry's order of adding (`Array.prototype.sort` is stable). Pure; the same order in the
 * browser, the stub and a test.
 */
export function compareWorkspaces(key: WorkspaceSortKey): (a: Sortable, b: Sortable) => number {
  switch (key) {
    case 'name':
      return byName;
    case 'status':
      return (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || byName(a, b);
    case 'added':
      return () => 0;
  }
}

// ─── Routes ──────────────────────────────────────────────────────────────────────────────────────────────────────

export type WorkspaceAdminRouteName = 'add' | 'rename' | 'rescan' | 'remove' | 'putImage' | 'getImage';

export interface WorkspaceAdminImageParams {
  readonly ws: string;
  readonly kind: ImageKind;
}

/** The decoded params of each admin route. */
export interface WorkspaceAdminRouteParams {
  add: Record<string, never>;
  rename: { readonly ws: string };
  rescan: { readonly ws: string };
  remove: { readonly ws: string };
  putImage: WorkspaceAdminImageParams;
  getImage: WorkspaceAdminImageParams;
}

/** What `matchWorkspaceAdminRoute` returns: the route and its decoded params, discriminated by `route`. */
export type WorkspaceAdminRouteMatch = {
  [R in WorkspaceAdminRouteName]: { readonly route: R; readonly params: WorkspaceAdminRouteParams[R] };
}[WorkspaceAdminRouteName];

const enc = encodeURIComponent;
const item = (ws: string): string => `${SPEC_API_ROOT}/${enc(ws)}`;
const image = (ws: string, kind: ImageKind): string => `${item(ws)}/images/${enc(kind)}`;

/** URL builders, one per route. Each segment is percent-encoded once; the result is a path (and query), no origin. */
export const workspaceAdminRoutes = {
  add: (): string => SPEC_API_ROOT,
  rename: item,
  rescan: (ws: string): string => `${item(ws)}/rescan`,
  remove: item,
  /** Both `PUT` and `GET` of one image. */
  image,
  /** The URL a summary's `images` carries: the image route plus the stored version, so a new upload reloads it. */
  imageUrl: (ws: string, kind: ImageKind, version: string): string => `${image(ws, kind)}?${IMAGE_VERSION_PARAM}=${enc(version)}`,
} as const;

export interface WorkspaceAdminRouteEntry {
  readonly route: WorkspaceAdminRouteName;
  /** `GET` also answers `HEAD` (same headers, no body). */
  readonly method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  readonly pattern: string;
  readonly statuses: readonly number[];
  /** The body the route takes, by type name; absent when it takes none. */
  readonly request?: string;
  /** The 2xx body, by type name, for docs and the stub. */
  readonly response: string;
}

const W = `${SPEC_API_ROOT}/:ws`;

/**
 * Every admin route once. 400: a body the parser refuses (`AddWorkspaceInvalid`, `RenameWorkspaceInvalid`); 403 the
 * guard; 404 an unknown workspace; 405 a method the path does not take (`workspaceAdminAllowFor`); 422 a path the
 * registry refuses (`AddWorkspaceRefused`); 413 an image over `IMAGE_MAX_BYTES`; 415 an image `sniffImageType`
 * refuses; 304 an image whose strong `ETag` matches `If-None-Match`.
 */
export const WORKSPACE_ADMIN_ROUTE_TABLE: readonly WorkspaceAdminRouteEntry[] = [
  { route: 'add', method: 'POST', pattern: SPEC_API_ROOT, statuses: [201, 400, 403, 405, 422], request: 'AddWorkspaceRequest', response: 'WorkspaceAdminSummary' },
  { route: 'rename', method: 'PATCH', pattern: W, statuses: [200, 400, 403, 404, 405], request: 'RenameWorkspaceRequest', response: 'WorkspaceAdminSummary' },
  { route: 'rescan', method: 'POST', pattern: `${W}/rescan`, statuses: [200, 403, 404, 405], response: 'WorkspaceAdminSummary' },
  { route: 'remove', method: 'DELETE', pattern: W, statuses: [204, 403, 404, 405], response: 'no body' },
  { route: 'putImage', method: 'PUT', pattern: `${W}/images/:kind`, statuses: [200, 403, 404, 405, 413, 415], request: 'image bytes', response: 'ImageStored' },
  { route: 'getImage', method: 'GET', pattern: `${W}/images/:kind`, statuses: [200, 304, 403, 404, 405], response: 'image bytes' },
];

type Resource =
  | { readonly kind: 'collection' }
  | { readonly kind: 'item' | 'rescan'; readonly ws: string }
  | { readonly kind: 'image'; readonly ws: string; readonly image: ImageKind };

const ROOT_PARTS = SPEC_API_ROOT.split('/').slice(1);

function decodeOnce(segment: string | undefined): string | null {
  if (segment === undefined || segment === '') return null;
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

/** The admin resource a pathname names (still percent-encoded, as `URL.pathname` gives it), or null. */
function resourceOf(pathname: string): Resource | null {
  const parts = pathname.split('/').slice(1);
  if (!ROOT_PARTS.every((part, i) => parts[i] === part)) return null;
  const rest = parts.slice(ROOT_PARTS.length);
  if (rest.length === 0) return { kind: 'collection' };
  const ws = decodeOnce(rest[0]);
  if (ws === null) return null;
  if (rest.length === 1) return { kind: 'item', ws };
  if (rest.length === 2 && rest[1] === 'rescan') return { kind: 'rescan', ws };
  if (rest.length === 3 && rest[1] === 'images') {
    const kind = decodeOnce(rest[2]);
    return kind !== null && isImageKind(kind) ? { kind: 'image', ws, image: kind } : null;
  }
  return null;
}

/**
 * The admin route a pathname and method name, or null: for any other path, and for a method the path does not take
 * (the server answers that with 405 and `workspaceAdminAllowFor`). `GET /api/workspaces` is null too: it is the list
 * route of `api.ts`.
 */
export function matchWorkspaceAdminRoute(pathname: string, method: string): WorkspaceAdminRouteMatch | null {
  const resource = resourceOf(pathname);
  if (resource === null) return null;
  const verb = method.toUpperCase() === 'HEAD' ? 'GET' : method.toUpperCase();
  switch (resource.kind) {
    case 'collection':
      return verb === 'POST' ? { route: 'add', params: {} } : null;
    case 'item':
      if (verb === 'PATCH') return { route: 'rename', params: { ws: resource.ws } };
      return verb === 'DELETE' ? { route: 'remove', params: { ws: resource.ws } } : null;
    case 'rescan':
      return verb === 'POST' ? { route: 'rescan', params: { ws: resource.ws } } : null;
    case 'image': {
      const params = { ws: resource.ws, kind: resource.image };
      if (verb === 'PUT') return { route: 'putImage', params };
      return verb === 'GET' ? { route: 'getImage', params } : null;
    }
  }
}

const ALLOW: Readonly<Record<Resource['kind'], string>> = {
  collection: 'GET, HEAD, POST',
  item: 'PATCH, DELETE',
  rescan: 'POST',
  image: 'GET, HEAD, PUT',
};

/** The `Allow` header of a 405 on an admin path, or null when the path is no admin path. */
export function workspaceAdminAllowFor(pathname: string): string | null {
  const resource = resourceOf(pathname);
  return resource === null ? null : ALLOW[resource.kind];
}

// ─── Bodies ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** `POST /api/workspaces`: the directory to register and an optional display name (else the registry's default). */
export interface AddWorkspaceRequest {
  readonly path: string;
  readonly name?: string;
}

/** `PATCH /api/workspaces/:ws`: the new display name; slug, `/w/<slug>`, notes and settings stay (ISC-305). */
export interface RenameWorkspaceRequest {
  readonly name: string;
}

/** A parser's answer: the normalized request, or the 400 code to refuse it with. */
export type Parsed<T, E extends string> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

const isRecord = (body: unknown): body is Record<string, unknown> => typeof body === 'object' && body !== null && !Array.isArray(body);

/**
 * Admits an add body: `invalid-body` when it is no object, `path` is no string or `name` is present and no string;
 * `invalid-path` when `path` is blank. `path` passes on as sent; a blank `name` counts as absent (`null`).
 */
export function parseAddWorkspaceRequest(body: unknown): Parsed<{ path: string; name: string | null }, AddWorkspaceInvalid['error']> {
  if (!isRecord(body)) return { ok: false, error: 'invalid-body' };
  const { path, name: rawName } = body;
  if (typeof path !== 'string') return { ok: false, error: 'invalid-body' };
  if (rawName !== undefined && typeof rawName !== 'string') return { ok: false, error: 'invalid-body' };
  if (path.trim() === '') return { ok: false, error: 'invalid-path' };
  const name = typeof rawName === 'string' ? rawName.trim() : '';
  return { ok: true, value: { path, name: name === '' ? null : name } };
}

/** Admits a rename body: `invalid-body` when it is no object or `name` is no string; `invalid-name` when it is blank. The name is trimmed. */
export function parseRenameWorkspaceRequest(body: unknown): Parsed<{ name: string }, RenameWorkspaceInvalid['error']> {
  if (!isRecord(body)) return { ok: false, error: 'invalid-body' };
  const { name: rawName } = body;
  if (typeof rawName !== 'string') return { ok: false, error: 'invalid-body' };
  const name = rawName.trim();
  return name === '' ? { ok: false, error: 'invalid-name' } : { ok: true, value: { name } };
}

export function isAddWorkspaceRequest(body: unknown): body is AddWorkspaceRequest {
  return parseAddWorkspaceRequest(body).ok;
}

export function isRenameWorkspaceRequest(body: unknown): body is RenameWorkspaceRequest {
  return parseRenameWorkspaceRequest(body).ok;
}

/** 200 of `PUT …/images/:kind`: the kind stored and its versioned URL (`workspaceAdminRoutes.imageUrl`). */
export interface ImageStored {
  readonly kind: ImageKind;
  readonly url: string;
}

/** The 2xx body of each route; `null` for the 204 and the image bytes. */
export interface WorkspaceAdminResponses {
  add: WorkspaceAdminSummary;
  rename: WorkspaceAdminSummary;
  rescan: WorkspaceAdminSummary;
  remove: null;
  putImage: ImageStored;
  getImage: null;
}

// ─── Error bodies ────────────────────────────────────────────────────────────────────────────────────────────────

/** The codes spec 016 adds to the API's own (`API_ERRORS` in `spec-routes.contract.ts`). */
export const WORKSPACE_ADMIN_ERRORS = ['invalid-path', 'invalid-name', 'not-a-directory', 'duplicate-path', 'too-large', 'unsupported-type'] as const;
export type WorkspaceAdminError = (typeof WORKSPACE_ADMIN_ERRORS)[number];

/** 400 of `add`: no JSON object or wrong field types (`invalid-body`), or a blank path (`invalid-path`). */
export type AddWorkspaceInvalid = InvalidBody | { readonly error: 'invalid-path' };

/** 400 of `rename`: no JSON object or `name` no string (`invalid-body`), or a blank name (`invalid-name`). */
export type RenameWorkspaceInvalid = InvalidBody | { readonly error: 'invalid-name' };

/**
 * 422 of `add`, the registry's `RegistryErrorCode`: the path names no existing directory (`not-a-directory`), or its
 * real path is registered already (`duplicate-path`, with the existing entry's `slug`). The registry is unchanged.
 */
export type AddWorkspaceRefused = { readonly error: 'not-a-directory' } | { readonly error: 'duplicate-path'; readonly slug: string };

/** 413 of `putImage`: the body is over `maxBytes` (`IMAGE_MAX_BYTES`); nothing is stored. */
export interface ImageTooLarge {
  readonly error: 'too-large';
  readonly maxBytes: number;
}

/** 415 of `putImage`: `sniffImageType` found no PNG, JPEG or WebP (SVG never is one); nothing is stored. */
export interface ImageUnsupported {
  readonly error: 'unsupported-type';
}

/** Every non-2xx body of each route (a 304 has none). */
export interface WorkspaceAdminErrors {
  add: Forbidden | MethodNotAllowed | AddWorkspaceInvalid | AddWorkspaceRefused;
  rename: Forbidden | MethodNotAllowed | NotFound | RenameWorkspaceInvalid;
  rescan: Forbidden | MethodNotAllowed | NotFound;
  remove: Forbidden | MethodNotAllowed | NotFound;
  putImage: Forbidden | MethodNotAllowed | NotFound | ImageTooLarge | ImageUnsupported;
  getImage: Forbidden | MethodNotAllowed | NotFound;
}

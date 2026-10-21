/**
 * The prototype route (part of `contracts/spec-routes.contract.ts`): `prototype`, `/proto/:ws/:spec/:folder/*`,
 * deliberately outside `/api/` so the relative links of a prototype's HTML (`styles.css`, `fonts/…`) resolve without
 * rewriting; it is a family of its own, not a workspace route, because its tail is a path of any depth.
 */
import type { LibraryDoc } from '../../../../core/src/files.ts';
import { decodeOnce } from '../guards.ts';
import { enc, READ } from './route-match.ts';

// ─── Prototype route (spec 017) ──────────────────────────────────────────────────────────────────────────────────

/**
 * The prototype route (spec 017, ISC-159): `GET`/`HEAD /proto/:ws/:spec/:folder/*` serves one file of a `prototype`
 * catalog document, outside `/api/` so a page's relative links resolve against the folder without rewriting.
 *
 * - `:ws` the workspace slug, `:spec` the spec folder (`LibraryDoc.spec`, `NNN-slug`), each decoded once.
 * - `:folder` the prototype's folder relative to the spec's `.design/`, decoded once from one segment: `prototype` for
 *   a prototype in `.design/prototype/` itself, `prototype/board` (sent as `prototype%2Fboard`) for one below it
 *   (`prototypeFolderOf`). Relative to `.design/` rather than `.design/prototype/` so the root folder has a name.
 *   Anything not `prototype` or below it is no match.
 * - `*` the file below the folder (`LibraryDoc.pages` entries, or what a page links), passed on raw like
 *   `evidencePathQuery`: core's resolver decodes it exactly once and refuses a second layer, `..`, an absolute path and
 *   a symlink out (ISC-159.1).
 *
 * Every answer carries `PROTOTYPE_CSP` (ISC-159.2). The route is no workspace route: its tail is a path of any depth,
 * which `matchSegments` does not match, and it sits outside `SPEC_API_ROOT`.
 */
export const PROTOTYPE_PREFIX = '/proto/';

/** The prototype root below a spec's `.design/`; every `:folder` is this or below it. */
export const PROTOTYPE_FOLDER_ROOT = 'prototype';

/** The decoded `ws`, `spec` and `folder`, and the still percent-encoded `file` (segments joined by `/`). */
export interface PrototypeParams {
  readonly ws: string;
  readonly spec: string;
  readonly folder: string;
  readonly file: string;
}

export interface PrototypeRouteMatch {
  readonly route: 'prototype';
  readonly params: PrototypeParams;
}

/**
 * The URL of one file of a prototype. `folder` as `prototypeFolderOf` gives it, `file` relative to the folder
 * (`index.html`, `pages/two.html`); each of its segments is encoded once, the slashes kept, so the page's relative
 * links resolve. A path, no origin.
 */
export function prototypeRoute(ws: string, spec: string, folder: string, file: string): string {
  return `${PROTOTYPE_PREFIX}${enc(ws)}/${enc(spec)}/${enc(folder)}/${file.split('/').map(enc).join('/')}`;
}

/**
 * The `:folder` of a `prototype` catalog document (`doc.path` minus `<spec>/.design/`, or minus
 * `archive/<spec>/.design/` for an archived one, ISC-187.1); null for any other path.
 */
export function prototypeFolderOf(doc: Pick<LibraryDoc, 'path' | 'spec' | 'archived'>): string | null {
  const head = `${doc.archived === true ? 'archive/' : ''}${doc.spec}/.design/`;
  if (!doc.path.startsWith(head)) return null;
  const folder = doc.path.slice(head.length);
  return isPrototypeFolder(folder) ? folder : null;
}

function isPrototypeFolder(folder: string): boolean {
  return folder === PROTOTYPE_FOLDER_ROOT || folder.startsWith(`${PROTOTYPE_FOLDER_ROOT}/`);
}

/** 200 or 304 by ETag; 403 host guard or a refused path; 404 unknown workspace, spec or file; 405; 409 unreadable workspace. */
export const PROTOTYPE_ROUTE = {
  route: 'prototype',
  method: 'GET',
  pattern: `${PROTOTYPE_PREFIX}:ws/:spec/:folder/*`,
  statuses: READ,
  response: 'file bytes',
} as const;

export const PROTOTYPE_ALLOW = 'GET, HEAD';

/**
 * The Content-Security-Policy of every prototype answer (plan 017 § Risks): the page's own files and inline code
 * only, no fetch, and a sandbox without `allow-same-origin`, so the page runs on an opaque origin and cannot call the
 * app's API.
 */
export const PROTOTYPE_CSP = "default-src 'self' 'unsafe-inline' data: blob:; connect-src 'none'; sandbox allow-scripts allow-popups";

/**
 * The prototype route a pathname names, whatever the method; null for any other path. Takes `URL.pathname` (still
 * percent-encoded). `ws`, `spec` and `folder` are decoded once (a malformed escape or an empty segment is no match,
 * a folder outside `prototype` too); the tail needs at least one segment and is returned raw. The server checks the
 * method itself (405 with `PROTOTYPE_ALLOW`).
 */
export function matchPrototypePath(pathname: string): PrototypeRouteMatch | null {
  if (!pathname.startsWith(PROTOTYPE_PREFIX)) return null;
  const parts = pathname.slice(PROTOTYPE_PREFIX.length).split('/');
  if (parts.length < 4) return null;
  const [ws, spec, folder] = parts.slice(0, 3).map(decodeOnce);
  const file = parts.slice(3).join('/');
  if (ws == null || spec == null || folder == null || file === '' || !isPrototypeFolder(folder)) return null;
  return { route: 'prototype', params: { ws, spec, folder, file } };
}

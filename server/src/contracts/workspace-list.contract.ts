/**
 * The workspace list half of the workspace admin contract (spec 016, T1, ISC-303; plan 016 § Data Model): what a row of
 * the settings page shows and how the page sorts it. The routes, bodies and errors are in `workspace-admin.contract.ts`,
 * which re-exports this file.
 *
 * - Images: the two kinds a workspace may carry, the upload limit, and `sniffImageType`, which decides an upload's type.
 * - Summary: `WorkspaceAdminSummary`, which every admin route answers, and the `status` and `images` spec 016 adds to
 *   the list entries of `GET /api/workspaces`. No answer carries an absolute path: a summary names `pathTail` only, an
 *   image its loopback URL.
 * - Sort: the settings page sorts its rows with `compareWorkspaces`, the same order in the browser, the stub and a test.
 *
 * Browser-safe: no Bun or Node import; both imports are `import type`.
 */
import type { DashboardKpis } from '../../../core/src/dashboard-kpis.ts';
import type { UnreadableCode } from './spec-routes.contract.ts';

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

// Resolution of a workspace slug and a spec ref (T13, ISC-71): exactly the entry the ref names, or not-found with a
// reason. There is no fallback: a ref that does not match is never answered with another spec.
//
// Server-only module. It reads the file system through `node:fs` and `node:path`, which is acceptable because the
// server is its only importer; it uses no Bun-only API, and files.ts deliberately does not re-export it so the browser
// bundle never pulls it in. Read-only: it lists directories and never writes.
//
// `SpecRef.dir` is the only absolute path that leaves this module. It is server-internal; the API layer maps it to a
// path tail before anything reaches a client.
import { readdirSync, type Dirent } from 'node:fs';
import { join, resolve } from 'node:path';

/** A spec folder that exists: `specs/NNN-slug/` or `specs/archive/NNN-slug/`. */
export interface SpecRef {
  readonly kind: 'spec';
  /** `NNN`. */
  readonly id: string;
  /** `NNN-slug`, the folder name (as in `SpecHead.slug`). */
  readonly slug: string;
  /** Absolute path of the spec folder. Server-internal, never sent to a client. */
  readonly dir: string;
  /** True for a folder under `specs/archive/`. */
  readonly archived: boolean;
}

export type SpecNotFoundReason = 'no-specs-dir' | 'unknown-id' | 'unknown-slug' | 'ambiguous';
export type WorkspaceNotFoundReason = 'unknown-workspace';
export type NotFoundReason = SpecNotFoundReason | WorkspaceNotFoundReason;

/** The ref named nothing, and why. The API answers it with 404 and `{error: "not_found"}`. */
export interface NotFound<R extends NotFoundReason = NotFoundReason> {
  readonly kind: 'not_found';
  /** The ref exactly as asked for. */
  readonly ref: string;
  readonly reason: R;
}

/** A registered workspace, as the server's registry holds it. */
export interface WorkspaceEntry {
  readonly slug: string;
  readonly path: string;
}

const SPEC_FOLDER = /^(\d{3})-(.+)$/;
const SPEC_ID = /^\d{3}$/;

/**
 * Every spec folder of the workspace at `workspaceRoot`, active ones in numeric order, then archived ones in numeric
 * order. One level each under `specs/` and `specs/archive/`; a missing `specs/` lists nothing.
 */
export function listSpecs(workspaceRoot: string): SpecRef[] {
  return scan(workspaceRoot) ?? [];
}

/**
 * The spec `ref` names in the workspace at `workspaceRoot`. `ref` is a three-digit id (`002`), a full folder name
 * (`002-web-console`) or a slug without its number (`web-console`); each form is matched exactly, active and archived
 * folders alike. A ref that matches no folder, or more than one, is `not_found`.
 */
export function resolveSpec(workspaceRoot: string, ref: string): SpecRef | NotFound<SpecNotFoundReason> {
  const specs = scan(workspaceRoot);
  if (specs === null) return notFound(ref, 'no-specs-dir');

  if (SPEC_ID.test(ref)) return single(ref, specs.filter((s) => s.id === ref), 'unknown-id');
  if (SPEC_FOLDER.test(ref)) {
    const byFolder = specs.filter((s) => s.slug === ref);
    if (byFolder.length > 0) return single(ref, byFolder, 'unknown-slug');
  }
  return single(ref, specs.filter((s) => s.slug.slice(s.id.length + 1) === ref), 'unknown-slug');
}

/** The registry entry whose slug equals `slug` exactly, or `not_found`. */
export function resolveWorkspace<W extends WorkspaceEntry>(
  registry: readonly W[],
  slug: string,
): W | NotFound<WorkspaceNotFoundReason> {
  return registry.find((entry) => entry.slug === slug) ?? notFound(slug, 'unknown-workspace');
}

function single(
  ref: string,
  matches: readonly SpecRef[],
  missing: 'unknown-id' | 'unknown-slug',
): SpecRef | NotFound<SpecNotFoundReason> {
  if (matches.length === 0) return notFound(ref, missing);
  if (matches.length > 1) return notFound(ref, 'ambiguous');
  return matches[0] as SpecRef;
}

function notFound<R extends NotFoundReason>(ref: string, reason: R): NotFound<R> {
  return { kind: 'not_found', ref, reason };
}

/** Spec folders sorted active-first, numeric; null when `<root>/specs` is not a directory. */
function scan(workspaceRoot: string): SpecRef[] | null {
  const specsDir = resolve(workspaceRoot, 'specs');
  const active = folders(specsDir);
  if (active === null) return null;
  const archiveDir = join(specsDir, 'archive');
  return [...refs(specsDir, active, false), ...refs(archiveDir, folders(archiveDir) ?? [], true)];
}

function refs(parent: string, names: readonly string[], archived: boolean): SpecRef[] {
  const out: SpecRef[] = [];
  for (const name of names) {
    const match = SPEC_FOLDER.exec(name);
    if (match?.[1] === undefined) continue;
    out.push({ kind: 'spec', id: match[1], slug: name, dir: join(parent, name), archived });
  }
  return out.sort((a, b) => Number(a.id) - Number(b.id) || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
}

/**
 * Names of the real subdirectories of `dir` (symlinks are not followed), or null when `dir` does not exist or is not
 * a directory. Any other read error propagates: an unreadable tree is a server error, not a missing spec.
 */
function folders(dir: string): string[] | null {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return null;
    throw error;
  }
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
}

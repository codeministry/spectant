// The evidence listing (T24, ISC-83): `artifacts/` and `.evidence/` of one spec folder, grouped by claim, each file
// with its media type; and the path confinement every served evidence file goes through.
//
// Reads only, with async node:fs/promises (no Bun API, so the plugin can reuse it): readdir, lstat, stat, realpath,
// readlink and one read of spec.md. Nothing is opened for writing, nothing is followed out of the two folders.
import { lstat, readFile, readdir, readlink, realpath, stat } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';

import { parseClaims } from './claims.ts';
import type { Diagnostic } from './diagnostics.ts';
import type {
  EvidenceFile,
  EvidenceGroup,
  EvidenceListing,
  EvidenceOptions,
  EvidencePathResult,
  EvidenceRefusal,
} from './files.ts';
import { FILE_KINDS, specFilePath } from './files.ts';

/** The two folders by their name on disk (`artifacts`, `.evidence`), from files.ts. */
const FOLDERS: ReadonlyArray<readonly [EvidenceGroup, string]> = (['artifacts', 'evidence'] as const).map(
  (group) => [group, FILE_KINDS[group].path.replace(/\/$/, '')] as const,
);
const FOLDER_NAMES = new Set(FOLDERS.map(([, name]) => name));

/** Media types by lower-case extension; everything else is `application/octet-stream`. */
const MEDIA_TYPES: ReadonlyMap<string, string> = new Map([
  ['md', 'text/markdown'],
  ['json', 'application/json'],
  ['har', 'application/json'],
  ['png', 'image/png'],
  ['jpg', 'image/jpeg'],
  ['jpeg', 'image/jpeg'],
  ['webp', 'image/webp'],
  ['log', 'text/plain'],
  ['txt', 'text/plain'],
  ['html', 'text/html'],
]);

/** The media type of a file name, from its extension (case-insensitive); the server's Content-Type for it. */
export function mediaTypeOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return (dot > 0 ? MEDIA_TYPES.get(name.slice(dot + 1).toLowerCase()) : undefined) ?? 'application/octet-stream';
}

// ─── Confinement ─────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The request as segments, or null when it is refused before the file system is asked: percent-encoding is decoded
 * exactly once (a malformed or second layer is refused), then a NUL or other control character, a backslash, an
 * absolute path, a drive letter or a `..` segment is refused. `.` and empty segments drop out. The first segment must
 * be `artifacts` or `.evidence`, with at least one segment below it.
 */
function normalise(requested: string): string[] | null {
  if (typeof requested !== 'string' || requested === '' || requested.length > 4096) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(requested);
  } catch {
    return null;
  }
  if (/%[0-9A-Fa-f]{2}/.test(decoded)) return null;
  // eslint-disable-next-line no-control-regex -- control characters are exactly what is refused here
  if (/[\u0000-\u001f\u007f\\]/.test(decoded)) return null;
  if (decoded.startsWith('/') || /^[A-Za-z]:/.test(decoded)) return null;
  const segments = decoded.split('/').filter((s) => s !== '' && s !== '.');
  if (segments.includes('..')) return null;
  if (segments.length < 2 || !FOLDER_NAMES.has(segments[0] ?? '')) return null;
  return segments;
}

/** `real` lies inside `<realSpec>/artifacts/` or `<realSpec>/.evidence/`, below the folder itself. */
function confined(realSpec: string, real: string): boolean {
  if (!real.startsWith(realSpec + sep)) return false;
  const parts = relative(realSpec, real).split(sep);
  return parts.length >= 2 && FOLDER_NAMES.has(parts[0] ?? '');
}

const code = (error: unknown): string | undefined => (error as NodeJS.ErrnoException | null)?.code;

/**
 * Resolve a requested evidence path against the spec folder `specDir`. The request is the raw value as the client sent
 * it (decoded here, once); the answer is the real path to open, or why nothing may be served. A lexically clean
 * request whose real path leaves `artifacts/` or `.evidence/` went through a symlink: `symlink-escape`. A dangling
 * symlink is `symlink-escape` when its target would lie outside, else `not-found`.
 */
export async function resolveEvidencePath(specDir: string, requested: string): Promise<EvidencePathResult> {
  const refuse = (reason: EvidenceRefusal): EvidencePathResult => ({ ok: false, reason });
  const segments = normalise(requested);
  if (!segments) return refuse('outside');
  let realSpec: string;
  try {
    realSpec = await realpath(specDir);
  } catch {
    return refuse('not-found');
  }
  const candidate = join(realSpec, ...segments);
  let real: string;
  try {
    real = await realpath(candidate);
  } catch (error) {
    if (code(error) !== 'ENOENT') return refuse('not-found');
    try {
      const link = await lstat(candidate);
      if (!link.isSymbolicLink()) return refuse('not-found');
      const target = resolve(dirname(candidate), await readlink(candidate));
      return refuse(confined(realSpec, target) ? 'not-found' : 'symlink-escape');
    } catch {
      return refuse('not-found');
    }
  }
  if (!confined(realSpec, real)) return refuse('symlink-escape');
  try {
    if (!(await stat(real)).isFile()) return refuse('not-a-file');
  } catch {
    return refuse('not-found');
  }
  return { ok: true, absolute: real, path: segments.join('/') };
}

// ─── Listing ─────────────────────────────────────────────────────────────────────────────────────────────────────

const TASK_NAME = /^(T\d+)(?=[-_.]|$)/;
const byPath = (a: EvidenceFile, b: EvidenceFile): number => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

interface Walked {
  readonly files: Array<Omit<EvidenceFile, 'claim'>>;
  readonly diagnostics: Diagnostic[];
}

/** Every regular file and symlink under one group folder, recursively; symlinked directories are not descended. */
async function walk(specDir: string, group: EvidenceGroup, folder: string): Promise<Walked> {
  const out: Walked = { files: [], diagnostics: [] };
  const top = join(specDir, folder);
  try {
    const st = await lstat(top);
    if (st.isSymbolicLink()) {
      out.diagnostics.push({
        severity: 'warning',
        code: 'evidence-folder-symlink',
        message: `${folder}/ is a symlink; it is not listed.`,
      });
      return out;
    }
    if (!st.isDirectory()) return out;
  } catch {
    return out;
  }

  const visit = async (dir: string, rel: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      out.diagnostics.push({ severity: 'warning', code: 'evidence-unreadable', message: `${rel}/ could not be read.` });
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const path = `${rel}/${entry.name}`;
      const absolute = join(dir, entry.name);
      const base = { group, path, name: entry.name, mediaType: mediaTypeOf(entry.name), task: TASK_NAME.exec(entry.name)?.[1] ?? null };
      if (entry.isDirectory()) await visit(absolute, path);
      else if (entry.isFile()) out.files.push({ ...base, bytes: (await lstat(absolute)).size });
      else if (entry.isSymbolicLink()) {
        const hit = await resolveEvidencePath(specDir, path);
        if (hit.ok) out.files.push({ ...base, bytes: (await stat(hit.absolute)).size, symlink: true });
        else {
          out.files.push({ ...base, bytes: 0, symlink: true, refused: hit.reason });
          if (hit.reason === 'symlink-escape') {
            out.diagnostics.push({
              severity: 'warning',
              code: 'evidence-symlink-escape',
              message: `${path} links outside artifacts/ and .evidence/; it is listed, never followed.`,
            });
          }
        }
      }
    }
  };
  await visit(top, folder);
  return out;
}

/**
 * The claim of one file: a claim ID a path segment is or starts with (`ISC-61`, `ISC-61-shot.png`, `ISC-61.png`;
 * the longest ID wins, so `ISC-60.1-x` is ISC-60.1, not ISC-60), else the first verification line that names the
 * file by its path relative to the spec folder or by its bare name, as a whole token.
 */
function claimOf(
  file: Pick<EvidenceFile, 'path' | 'name'>,
  ids: readonly string[],
  verification: ReadonlyArray<{ readonly id: string; readonly text: string }>,
): string | null {
  let best: string | null = null;
  for (const segment of file.path.split('/')) {
    for (const id of ids) {
      const hit = segment === id || (segment.startsWith(id) && /^[-_.]/.test(segment.slice(id.length)));
      if (hit && (best === null || id.length > best.length)) best = id;
    }
  }
  if (best) return best;
  const named = new RegExp(`(?<![\\w.-])(?:${escapeRegExp(file.path)}|${escapeRegExp(file.name)})(?![\\w.-])`);
  return verification.find((line) => named.test(line.text))?.id ?? null;
}

/**
 * List `artifacts/` and `.evidence/` of the spec folder `specDir`: results and raw files by path, grouped by claim.
 * A missing folder is an empty list. Dotfiles are skipped. Claims come from `spec.md` (`options.specText`, else read
 * from the folder); without it, nothing is grouped.
 */
export async function listEvidence(specDir: string, options: EvidenceOptions = {}): Promise<EvidenceListing> {
  let specText = options.specText;
  if (specText === undefined) {
    try {
      specText = await readFile(specFilePath(specDir, 'spec'), 'utf-8');
    } catch {
      specText = '';
    }
  }
  const doc = parseClaims(specText);
  const ids = doc.claims.map((c) => c.id).filter((id) => id !== '');

  const walked = await Promise.all(FOLDERS.map(([group, folder]) => walk(specDir, group, folder)));
  const [results, raw] = walked.map((w) =>
    w.files.map((f): EvidenceFile => ({ ...f, claim: claimOf(f, ids, doc.verification) })).sort(byPath),
  ) as [EvidenceFile[], EvidenceFile[]];

  const all = [...results, ...raw];
  const order = [...ids, ...doc.verification.map((v) => v.id)];
  const claims = [...new Set(all.map((f) => f.claim).filter((c): c is string => c !== null))].sort(
    (a, b) => order.indexOf(a) - order.indexOf(b),
  );
  const byClaim: Record<string, EvidenceFile[]> = {};
  for (const claim of claims) byClaim[claim] = all.filter((f) => f.claim === claim);

  return {
    results,
    raw,
    byClaim,
    ungrouped: all.filter((f) => f.claim === null),
    diagnostics: walked.flatMap((w) => w.diagnostics),
  };
}

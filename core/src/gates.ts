// The review and code-review marks (T36, ISC-15), ported from the old SpecGate tool. The reviewed mark holds a
// normalised sha256 of spec.md, plan.md and tasks.md; the code-reviewed mark holds the tree id of the working tree.
// Everything is computed in memory: this module never writes a mark, an index or a git object into the repository it
// reads, and it starts no process. The caller reads `.gates/*.json` and the files and passes the text in; for the
// code-reviewed mark the caller lists the worktree and `treeIdOf` turns that list into a tree id.
//
// Hashing uses `createHash` from `node:crypto`, synchronously. That makes this a server-side module: the barrel
// (`index.ts`) re-exports its types only, so the browser bundle never pulls `node:crypto` in.
import { createHash } from 'node:crypto';
import type { Diagnostic } from './diagnostics.ts';
import type { MarkState, TextFileKind } from './files.ts';

/** A mark's state lives in `files.ts`, so browser-safe modules type it without reaching this one; re-exported here. */
export type { MarkState } from './files.ts';

export type GateName = 'reviewed' | 'code-reviewed';

/** The files the reviewed mark hashes. */
export type ReviewedFile = 'spec.md' | 'plan.md' | 'tasks.md';

export const REVIEWED_FILES: readonly ReviewedFile[] = ['spec.md', 'plan.md', 'tasks.md'];

export interface ReviewedMark {
  readonly gate: 'reviewed';
  /** ISO 8601; empty when the mark carried no time (with a warning). */
  readonly at: string;
  /**
   * sha256 hex of the normalised text per file; null for a file that did not exist. A value that was no string in
   * the mark is kept as the empty string, so it matches neither a hash nor an absent file.
   */
  readonly files: Readonly<Record<ReviewedFile, string | null>>;
}

export interface CodeReviewedMark {
  readonly gate: 'code-reviewed';
  /** ISO 8601; empty when the mark carried no time (with a warning). */
  readonly at: string;
  /** The repository root the old skill recorded; null when absent. Informational only. */
  readonly root: string | null;
  /** The git tree id of the reviewed working tree. */
  readonly tree: string;
  readonly head: string | null;
  readonly branch: string | null;
  /** Accepted remainder of /code-review and /security-review, from `findings` or top-level `code`/`security`. */
  readonly findings: { readonly code: number; readonly security: number } | null;
  readonly note: string | null;
}

export type GateMark = ReviewedMark | CodeReviewedMark;

export interface GateMarkReading {
  /** Null when the text is not a mark of the named gate (with a diagnostic saying why). */
  readonly mark: GateMark | null;
  readonly diagnostics: readonly Diagnostic[];
}

/** What a mark is compared with. */
export interface GateCurrent {
  /** The current text of spec.md, plan.md and tasks.md; an absent key means the file does not exist. */
  readonly texts?: Readonly<Partial<Record<ReviewedFile, string>>>;
  /** The current worktree tree id, computed in memory by the caller; null or absent when it could not be computed. */
  readonly worktreeTree?: string | null;
}

export interface GateCheck {
  readonly gate: GateName;
  readonly state: MarkState;
  /** The mark's time; null when there is no mark or it carried none. */
  readonly at: string | null;
  /** Files whose hash no longer matches (reviewed), empty otherwise. */
  readonly changed: readonly string[];
  /** Why a mark could not be compared, when that is the reason it is stale. */
  readonly detail?: string;
}

// ── reading a mark ────────────────────────────────────────────────────────────────────────────────────

/** A git object id: 40 hex (SHA-1 repositories) or 64 hex (SHA-256 repositories). */
const OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const stringOrNull = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const count = (value: unknown): number | null => (typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null);

/** Parse the JSON text of `.gates/<gate>.json`. Never throws: what cannot be read is reported. */
export function readGateMark(gate: GateName, text: string): GateMarkReading {
  const diagnostics: Diagnostic[] = [];
  const fail = (code: string, message: string): GateMarkReading => ({ mark: null, diagnostics: [...diagnostics, { severity: 'error', code, message }] });
  const warn = (code: string, message: string) => diagnostics.push({ severity: 'warning', code, message });

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    return fail('gate-json-invalid', `The ${gate} mark is not valid JSON: ${error instanceof Error ? error.message : 'parse error'}.`);
  }
  if (!isRecord(data)) return fail('gate-not-object', `The ${gate} mark is not a JSON object.`);

  if (data.gate === undefined) warn('gate-name-missing', `The mark names no gate; read as ${gate} from its file name.`);
  else if (data.gate !== gate) return fail('gate-mismatch', `The mark names gate ${JSON.stringify(data.gate)}, expected ${gate}.`);

  let at = '';
  if (typeof data.at === 'string' && data.at !== '') at = data.at;
  else warn('gate-at-missing', `The ${gate} mark carries no time.`);

  if (gate === 'reviewed') {
    if (!isRecord(data.files)) return fail('gate-files-missing', 'The reviewed mark holds no files object.');
    const files = {} as Record<ReviewedFile, string | null>;
    for (const f of REVIEWED_FILES) {
      const value = data.files[f] ?? null; // the old skill's `m.files?.[f] ?? null`: an absent key is an absent file
      if (value === null) files[f] = null;
      else if (typeof value === 'string' && SHA256_HEX.test(value)) files[f] = value;
      else {
        warn('gate-file-hash-invalid', `The reviewed mark's hash for ${f} is not a sha256 hex; it can never match.`);
        files[f] = typeof value === 'string' ? value : '';
      }
    }
    return { mark: { gate, at, files }, diagnostics };
  }

  if (typeof data.tree !== 'string') return fail('gate-tree-missing', 'The code-reviewed mark holds no tree id.');
  if (!OBJECT_ID.test(data.tree)) return fail('gate-tree-invalid', `The code-reviewed mark's tree ${JSON.stringify(data.tree)} is not a git object id.`);

  // Two shapes: the old skill's `findings: {code, security}`, and top-level `code` / `security` counts.
  const source = isRecord(data.findings) ? data.findings : data;
  const code = count(source.code);
  const security = count(source.security);
  let findings: CodeReviewedMark['findings'] = null;
  if (code !== null || security !== null) findings = { code: code ?? 0, security: security ?? 0 };
  else if (data.findings !== undefined) warn('gate-findings-invalid', 'The code-reviewed mark holds findings without code or security counts.');

  return {
    mark: {
      gate,
      at,
      root: stringOrNull(data.root),
      tree: data.tree,
      head: stringOrNull(data.head),
      branch: stringOrNull(data.branch),
      findings,
      note: stringOrNull(data.note),
    },
    diagnostics,
  };
}

// ── comparing a mark ──────────────────────────────────────────────────────────────────────────────────

/** A mark against the current state: missing without a mark, stale when anything it holds changed, else fresh. */
export function gateState(gate: GateName, mark: GateMark | null, current: GateCurrent): GateCheck {
  if (mark?.gate !== gate) return { gate, state: 'missing', at: null, changed: [] };
  const at = mark.at === '' ? null : mark.at;

  if (mark.gate === 'reviewed') {
    const texts = current.texts ?? {};
    const changed = REVIEWED_FILES.filter((f) => {
      const text = texts[f];
      return mark.files[f] !== (text === undefined ? null : hashForGate(f, text));
    });
    return { gate, state: changed.length ? 'stale' : 'fresh', at, changed };
  }

  // A code-reviewed mark is fresh only when the tree is proven equal; an uncomputable tree proves nothing.
  const tree = current.worktreeTree ?? null;
  if (tree === null) return { gate, state: 'stale', at, changed: [], detail: 'worktree tree id unavailable' };
  return { gate, state: tree === mark.tree ? 'fresh' : 'stale', at, changed: [] };
}

/** The reviewed mark of one spec folder: its reading (null without the file) and its state against the folder's texts. */
export interface ReviewedGate {
  readonly reading: GateMarkReading | null;
  readonly check: GateCheck;
}

/**
 * The reviewed mark of one spec folder from its texts (`gateReviewed`, `spec`, `plan`, `tasks`), the one reading the
 * claim partition's review gate is fed from (ISC-99): the dashboard row, the Claims tab and the live frame all call it,
 * so they cannot disagree on whether a spec is reviewed.
 */
export function reviewedGate(texts: Readonly<Partial<Record<TextFileKind, string>>>): ReviewedGate {
  const reading = texts.gateReviewed === undefined ? null : readGateMark('reviewed', texts.gateReviewed);
  const current: Partial<Record<ReviewedFile, string>> = {};
  if (texts.spec !== undefined) current['spec.md'] = texts.spec;
  if (texts.plan !== undefined) current['plan.md'] = texts.plan;
  if (texts.tasks !== undefined) current['tasks.md'] = texts.tasks;
  return { reading, check: gateState('reviewed', reading?.mark ?? null, { texts: current }) };
}

// ── the reviewed digest ───────────────────────────────────────────────────────────────────────────────

/**
 * What a reviewer read, minus what an implementation round writes: frontmatter, checkbox states, struck tasks, and
 * spec.md's Not yet specified, Decisions and Verification sections. Byte-for-byte the old SpecGate `normalize`, so a
 * mark the old skill wrote verifies here.
 */
export function normalizeForGate(file: ReviewedFile, text: string): string {
  let s = text.replace(/\r\n?/g, '\n').replace(/^---\n[\s\S]*?\n---\n?/, '');
  s = s.replace(/^(\s*- )\[[ xX]\]/gm, '$1[ ]');
  if (file === 'tasks.md') s = s.replace(/~~/g, '');
  if (file === 'spec.md') {
    for (const heading of ['Not yet specified', 'Decisions', 'Verification']) {
      s = s.replace(new RegExp(`^## ${heading}\\b[^\\n]*\\n[\\s\\S]*?(?=^## |(?![\\s\\S]))`, 'm'), '');
    }
  }
  return s
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trim();
}

/** sha256 hex of `normalizeForGate(file, text)`, computed in memory with `node:crypto`. */
export function hashForGate(file: ReviewedFile, text: string): string {
  return createHash('sha256').update(normalizeForGate(file, text)).digest('hex');
}

// ── the worktree tree id ──────────────────────────────────────────────────────────────────────────────

/** Git's file modes: regular, executable, symbolic link (whose bytes are the link target). */
export type TreeEntryMode = '100644' | '100755' | '120000';

/** One file of the worktree as `git add -A` would stage it. */
export interface TreeEntry {
  /** Relative to the repository root, `/`-separated, no `.` or `..` segments. */
  readonly path: string;
  readonly mode: TreeEntryMode;
  readonly bytes: Uint8Array;
}

const MODES = new Set<string>(['100644', '100755', '120000']);

interface Dir {
  readonly files: Map<string, { mode: TreeEntryMode; bytes: Uint8Array }>;
  readonly dirs: Map<string, Dir>;
}

const newDir = (): Dir => ({ files: new Map(), dirs: new Map() });
const encoder = new TextEncoder();

/** The raw object id of a git object `<type> <length>\0<body>` (SHA-1, the default object format). */
function objectId(type: 'blob' | 'tree', body: Uint8Array): Buffer {
  return createHash('sha1').update(`${type} ${body.length}\0`).update(body).digest();
}

function treeObjectId(dir: Dir): Buffer {
  // `key` is what git sorts by: the name bytes, a directory compared as if its name ended in `/`.
  const entries: Array<{ key: Uint8Array; head: Uint8Array; id: Buffer }> = [];
  for (const [name, file] of dir.files) {
    entries.push({ key: encoder.encode(name), head: encoder.encode(`${file.mode} ${name}\0`), id: objectId('blob', file.bytes) });
  }
  for (const [name, sub] of dir.dirs) {
    entries.push({ key: encoder.encode(`${name}/`), head: encoder.encode(`40000 ${name}\0`), id: treeObjectId(sub) });
  }
  entries.sort((x, y) => Buffer.compare(x.key, y.key));
  return objectId('tree', Buffer.concat(entries.flatMap((e) => [e.head, e.id])));
}

/**
 * The git tree id of a set of files, computed in memory: what `git add -A && git write-tree` would print for them,
 * without an index and without a single object written. Blobs hash as `blob <len>\0<bytes>`, directories become nested
 * tree objects, entries sort as git sorts them. SHA-1 object format only.
 *
 * The caller lists the files: `.gitignore` applied, `.git/` excluded, bytes as git would store them. Clean filters
 * (`core.autocrlf`, LFS) are the caller's concern too; with such a filter the id differs from git's.
 *
 * Throws a RangeError on an entry git could not hold: an absolute, empty or dotted path segment, a duplicate path, a
 * path that is both a file and a directory, or an unknown mode. That is a programming error, not a reading.
 */
export function treeIdOf(entries: readonly TreeEntry[]): string {
  const root = newDir();
  for (const entry of entries) {
    if (!MODES.has(entry.mode)) throw new RangeError(`treeIdOf: unsupported mode ${entry.mode} for ${entry.path}`);
    const segments = entry.path.split('/');
    if (segments.some((s) => s === '' || s === '.' || s === '..' || s.includes('\0'))) {
      throw new RangeError(`treeIdOf: invalid path ${JSON.stringify(entry.path)}`);
    }
    const name = segments.pop() ?? '';
    let dir = root;
    for (const segment of segments) {
      if (dir.files.has(segment)) throw new RangeError(`treeIdOf: ${entry.path} lies under a file`);
      let sub = dir.dirs.get(segment);
      if (!sub) {
        sub = newDir();
        dir.dirs.set(segment, sub);
      }
      dir = sub;
    }
    if (dir.files.has(name) || dir.dirs.has(name)) throw new RangeError(`treeIdOf: duplicate path ${entry.path}`);
    dir.files.set(name, { mode: entry.mode, bytes: entry.bytes });
  }
  return treeObjectId(root).toString('hex');
}

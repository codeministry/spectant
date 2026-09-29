// The review and code-review marks (T36, ISC-15), ported from the old SpecGate tool. The reviewed mark holds a
// normalised sha256 of spec.md, plan.md and tasks.md; the code-reviewed mark holds the tree id of the working tree.
// Everything is computed in memory: this module never writes a mark, an index or a git object into the repository it
// reads. The caller reads `.gates/*.json` and passes the text in; the worktree tree id is computed by the caller.
// Stub from the T33 seam: the fill-in task replaces the bodies and keeps the exported names and types.
import type { Diagnostic } from './diagnostics.ts';
import type { GateState } from './files.ts';

export type GateName = 'reviewed' | 'code-reviewed';

/** A mark's state: fresh (matches), stale (content changed since), missing (no mark). */
export type MarkState = Extract<GateState, 'fresh' | 'stale' | 'missing'>;

/** The files the reviewed mark hashes. */
export type ReviewedFile = 'spec.md' | 'plan.md' | 'tasks.md';

export const REVIEWED_FILES: readonly ReviewedFile[] = ['spec.md', 'plan.md', 'tasks.md'];

export interface ReviewedMark {
  readonly gate: 'reviewed';
  /** ISO 8601. */
  readonly at: string;
  /** sha256 hex of the normalised text per file; null for a file that did not exist. */
  readonly files: Readonly<Record<ReviewedFile, string | null>>;
}

export interface CodeReviewedMark {
  readonly gate: 'code-reviewed';
  /** ISO 8601. */
  readonly at: string;
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
  /** The mark's time; null when there is no mark. */
  readonly at: string | null;
  /** Files whose hash no longer matches (reviewed), empty otherwise. */
  readonly changed: readonly string[];
}

/** Parse the JSON text of `.gates/<gate>.json`. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- stub parameters; the fill-in uses them and drops this line
export function readGateMark(_gate: GateName, _text: string): GateMarkReading {
  throw new Error('not implemented: readGateMark');
}

/** A mark against the current state: missing without a mark, stale when anything it holds changed, else fresh. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- stub parameters; the fill-in uses them and drops this line
export function gateState(_gate: GateName, _mark: GateMark | null, _current: GateCurrent): GateCheck {
  throw new Error('not implemented: gateState');
}

/**
 * What a reviewer read, minus what an implementation round writes: frontmatter, checkbox states, struck tasks, and
 * spec.md's Not yet specified, Decisions and Verification sections.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- stub parameters; the fill-in uses them and drops this line
export function normalizeForGate(_file: ReviewedFile, _text: string): string {
  throw new Error('not implemented: normalizeForGate');
}

/** sha256 hex of `normalizeForGate(file, text)`, computed in memory. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- stub parameters; the fill-in uses them and drops this line
export function hashForGate(_file: ReviewedFile, _text: string): string {
  throw new Error('not implemented: hashForGate');
}

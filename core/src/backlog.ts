// The feature backlog (spec 036, ISC-190 to ISC-191.1): `specs/backlog.md`, one line `- F<n> · P<1-4>` per feature
// block of the master, read into a rank and a priority per feature. The rank is the order, the priority an attribute
// beside it; the priority orders nothing. The file is the user's and may be kept by hand: the app reads it on every
// load and writes it only through the backlog route (`server/src/writes.ts`, `writeBacklog`), never the master.
//
// Reading (`parseBacklog`), in order:
// 1. A line `- F<n>` or `- F<n> · <priority>` is an entry; every other line (a heading, a blank line, prose, a list
//    line naming no feature id) is skipped, and so is everything inside an HTML comment `<!-- … -->`.
// 2. The entries the master knows, each feature once, are ranked 1, 2, … in file order: the line's position among
//    them is the feature's global rank. A feature the file does not list stands behind every listed one, in master
//    order. A missing priority is `P3`.
// 3. A line naming no feature block of the master, a second line of one feature and a priority other than `P1` to
//    `P4` are one warning each (`BacklogDiagnosticCode`, ISC-190.1): the first line of a feature counts, an invalid
//    priority reads as `P3`, and reading goes on.
//
// Browser-safe and pure: no file system, no Node or Bun API. The planning tree (`planning.ts`) and the server's write
// path call it over text the caller read.
import type { Diagnostic } from './diagnostics.ts';
import type { BacklogDiagnosticCode, Priority } from './files.ts';

/** A feature's priority in the backlog: the four values of a spec's `priority:` (FORMAT.md), `P3` when absent. */
export type BacklogPriority = Priority;

/** The four priorities, highest first. */
export const BACKLOG_PRIORITIES: readonly BacklogPriority[] = ['P1', 'P2', 'P3', 'P4'];

/** The priority of a feature whose line names none, or that the file does not list. */
export const DEFAULT_BACKLOG_PRIORITY: BacklogPriority = 'P3';

/** The backlog file relative to the repository root, as a diagnostic names it. */
export const BACKLOG_FILE = 'specs/backlog.md';

/** One feature block of the master with its place in the backlog. */
export interface BacklogEntry {
  /** `F8`, as the master's feature heading names it. */
  readonly feature: string;
  /** 1-based and global: listed features in file order, then the unlisted ones in master order. */
  readonly rank: number;
  readonly priority: BacklogPriority;
  /** The 1-based line of the entry in the file; null for a feature the file does not list. */
  readonly line: number | null;
}

export interface BacklogReading {
  /** Every feature the caller passed, exactly once, in rank order. */
  readonly entries: readonly BacklogEntry[];
  readonly diagnostics: readonly Diagnostic[];
}

/** An entry line: a list marker, a feature id, and an optional `·` with the priority after it. */
const ENTRY = /^\s*[-*]\s+(F\d+(?:\.\d+)?)(?:\s+·\s*(.*?))?\s*$/;
const COMMENT_OPEN = '<!--';
const COMMENT_CLOSE = '-->';

const isPriority = (value: string): value is BacklogPriority => (BACKLOG_PRIORITIES as readonly string[]).includes(value);

/** A raw entry line as written: the feature, the priority text (null without one) and its 1-based line. */
interface RawEntry {
  readonly feature: string;
  readonly priority: string | null;
  readonly line: number;
}

/** The entry lines of `text` in file order, comments skipped. */
function rawEntries(text: string): RawEntry[] {
  const out: RawEntry[] = [];
  let inComment = false;
  text.split('\n').forEach((raw, i) => {
    let line = raw.replace(/\r$/, '');
    // Strip every comment span on the line; an unclosed one runs on into the next lines.
    let visible = '';
    while (line.length > 0) {
      if (inComment) {
        const close = line.indexOf(COMMENT_CLOSE);
        if (close < 0) return;
        inComment = false;
        line = line.slice(close + COMMENT_CLOSE.length);
        continue;
      }
      const open = line.indexOf(COMMENT_OPEN);
      if (open < 0) {
        visible += line;
        break;
      }
      visible += line.slice(0, open);
      inComment = true;
      line = line.slice(open + COMMENT_OPEN.length);
    }
    const m = ENTRY.exec(visible);
    if (m?.[1] !== undefined) out.push({ feature: m[1], priority: m[2] === undefined || m[2] === '' ? null : m[2], line: i + 1 });
  });
  return out;
}

/**
 * The backlog of the feature blocks `featureIds` (master order) as `text` ranks them; null or empty text ranks every
 * feature in master order with `P3`. Never throws.
 */
export function parseBacklog(text: string | null, featureIds: readonly string[]): BacklogReading {
  const known = new Set(featureIds);
  const seen = new Set<string>();
  const listed: Array<Omit<BacklogEntry, 'rank'>> = [];
  const diagnostics: Diagnostic[] = [];
  const warn = (code: BacklogDiagnosticCode, message: string, line: number, subject: string): void => {
    diagnostics.push({ severity: 'warning', code, message, line, subject });
  };
  for (const raw of rawEntries(text ?? '')) {
    // One finding per line, the first that applies: an unknown or repeated id leaves its priority unread.
    if (!known.has(raw.feature)) {
      warn('backlog-unknown-feature', `${raw.feature} is not a feature block of the master; the line is skipped`, raw.line, raw.feature);
      continue;
    }
    if (seen.has(raw.feature)) {
      warn('backlog-duplicate', `${raw.feature} is listed more than once; its first line counts`, raw.line, raw.feature);
      continue;
    }
    seen.add(raw.feature);
    let priority = DEFAULT_BACKLOG_PRIORITY;
    if (raw.priority !== null) {
      if (isPriority(raw.priority)) priority = raw.priority;
      else warn('backlog-priority', `priority "${raw.priority}" of ${raw.feature} is none of P1 to P4; it reads as P3`, raw.line, raw.priority);
    }
    listed.push({ feature: raw.feature, priority, line: raw.line });
  }
  const unlisted = featureIds.filter((id, i) => !seen.has(id) && featureIds.indexOf(id) === i);
  const entries = [...listed, ...unlisted.map((feature) => ({ feature, priority: DEFAULT_BACKLOG_PRIORITY, line: null }))].map(
    (e, i): BacklogEntry => ({ ...e, rank: i + 1 }),
  );
  return { entries, diagnostics };
}

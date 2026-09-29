// Claim lines and the sections that talk about them: the claim section (`## Features`, `## Claims`, `## Criteria`)
// with its feature blocks, `## Not yet specified` fog lines, `## Test Strategy` rows and `## Verification` lines.
//
// Port of the old IsaFrontier claim parser (`- [ ] ISC-N: text (after: ISC-A, ISC-B)`, dotted IDs, `[DROPPED …]`
// tombstones, a trailing edge only, code spans ignored) and of SpecStatus's section readers (fog, Test Strategy
// columns, Verification IDs, the progress recount). Three deliberate differences, each a superset of the old reading:
// a checked box may be `[X]`; lines inside a fenced code block are neither claims nor headings; trailing marks
// `⟨?: …⟩` / `⟨resolved: …⟩` are lifted off a claim before its edge is read, so an edge followed by a mark still counts.
//
// Pure: text in, model out. No file system, no Bun API. Malformed input yields diagnostics, never a throw.
import type { Diagnostic } from './diagnostics.ts';
import type { ClaimKind, ProbeRow } from './files.ts';
import type { Progress } from './frontmatter.ts';

export interface Claim {
  /** `ISC-60.1`, also the other ID forms the old parser took (`H-AVAIL`, `C4`). */
  readonly id: string;
  readonly checked: boolean;
  readonly kind: ClaimKind;
  /** The claim text without its kind prefix, tombstone, trailing edge and trailing marks. */
  readonly text: string;
  /** Everything after the ID and its separator, exactly as written. */
  readonly raw: string;
  /** Claim IDs from the trailing `(after: …)`. */
  readonly after: readonly string[];
  /** Trailing marks as written, e.g. `⟨?: which flag⟩`, in line order. */
  readonly marks: readonly string[];
  /** A `[DROPPED …]` tombstone anywhere in the text: resolved, but not achieved. */
  readonly dropped: boolean;
  /** The words inside a leading tombstone (`see Decisions 2026-09-24`); null when there are none. */
  readonly droppedNote: string | null;
  /** The feature block the claim sits in, e.g. `F2`; null outside one. */
  readonly feature: string | null;
  /** Leading whitespace: 0 for a top-level claim, more for a nested leaf. */
  readonly indent: number;
  /** 1-based line in the parsed text. */
  readonly line: number;
}

export interface FeatureBlock {
  /** `F2`. */
  readonly id: string;
  /** The heading after `F2 ·`. */
  readonly name: string;
  /** The `Why:` line under the heading, without the prefix. */
  readonly why: string | null;
  readonly line: number;
  /** Claim IDs in the block, in file order. */
  readonly claims: readonly string[];
}

export interface FogLine {
  readonly text: string;
  readonly marks: readonly string[];
  readonly line: number;
}

/** One Test Strategy row; a short row has its missing columns as empty strings. */
export interface TestStrategyRow extends ProbeRow {
  /** Cells the row actually has; fewer than six means no `anchors_to` slot at all. */
  readonly cells: number;
  readonly line: number;
}

/** One `- ISC-N: …` line under `## Verification`. */
export interface VerificationLine {
  readonly id: string;
  readonly text: string;
  readonly line: number;
}

export interface ClaimsDocument {
  /** The claim section's heading text and line; null when the file has none. */
  readonly section: { readonly heading: string; readonly line: number } | null;
  readonly claims: readonly Claim[];
  readonly features: readonly FeatureBlock[];
  readonly fog: readonly FogLine[];
  readonly testStrategy: readonly TestStrategyRow[];
  readonly verification: readonly VerificationLine[];
  /** Recounted from the boxes: closed over live claims, tombstones leave both. */
  readonly counted: Progress;
  /** Checkbox lines in the claim section that carry no parseable ID: invisible to the graph. */
  readonly idlessBoxes: number;
  readonly diagnostics: readonly Diagnostic[];
}

// The ID forms of the old parser: ISC-N (dotted splits included), domain-prefixed (H-AVAIL), short (C1, EQ-12).
const ID = String.raw`(ISC-[\w.-]+|[A-Z]{1,6}-[A-Z0-9][\w.-]*|[A-Z]{1,4}-?\d+(?:\.\d+)*)`;
const CLAIM_LINE = new RegExp(String.raw`^(\s*)- \[([ xX])\]\s*${ID}\s*[:—–-]?\s*(.*)$`);
const CHECKBOX_LINE = /^\s*- \[[ xX]\]/;
const VERIFICATION_LINE = new RegExp(String.raw`^\s*-\s*${ID}(?:\s*\([^)]*\))?\s*[:—–-]?\s*(.*)$`);
const FOG_LINE = /^\s*-\s*fog:\s*(.*)$/i;

const CLAIM_HEADING = /^(?:##\s+(?:ISC\s+)?Criteria\b.*|##\s+Claims\b.*|##\s+IDEAL\s+STATE\s+CRITERIA\b.*|###\s+Criteria\b.*|##\s+Features\b.*)$/i;
const LEVEL_TWO = /^##\s+(?!#)/;
const RULE = /^---\s*$/;
const HEADING = /^(#{1,6})\s+(.*?)\s*$/;
const FEATURE_HEADING = /^###\s+(F\d+(?:\.\d+)?)\b\s*(?:[·:—–-]\s*)?(.*?)\s*$/;
const WHY_LINE = /^Why:\s*(.*?)\s*$/;
const FENCE = /^\s*(```|~~~)/;

const TRAILING_MARK = /\s*⟨[^⟨⟩]*⟩\s*$/;
const TRAILING_AFTER = /\s*\(after:\s*([^)]+)\)\s*\.?\s*$/i;
const CODE_SPAN = /`[^`]*`/g;
const LEADING_TOMBSTONE = /^\[DROPPED\b([^\]]*)\]\s*/i;
const KIND_PREFIX = /^(Anti|Antecedent):\s*/i;

interface Line {
  readonly text: string;
  /** Inside a fenced code block, or a fence line itself. */
  readonly fenced: boolean;
}

function scanLines(text: string): Line[] {
  const out: Line[] = [];
  let open: string | null = null;
  for (const raw of text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n')) {
    const fence = FENCE.exec(raw)?.[1] ?? null;
    if (open === null && fence !== null) {
      open = fence;
      out.push({ text: raw, fenced: true });
    } else if (open !== null) {
      if (fence === open) open = null;
      out.push({ text: raw, fenced: true });
    } else {
      out.push({ text: raw, fenced: false });
    }
  }
  return out;
}

/** Line indices [start, end) of the body of the first `## <name>` section; null when there is none. */
function section(lines: readonly Line[], name: string): [number, number] | null {
  const heading = new RegExp(String.raw`^##\s+${name}\b`, 'i');
  const start = lines.findIndex((l) => !l.fenced && heading.test(l.text));
  if (start < 0) return null;
  const end = lines.findIndex((l, i) => i > start && !l.fenced && LEVEL_TWO.test(l.text));
  return [start + 1, end < 0 ? lines.length : end];
}

/** Lift trailing marks and (optionally) a trailing `(after: …)` off `raw`; code spans never count. */
function liftTrailing(raw: string, withEdges: boolean): { head: string; after: string[]; marks: string[] } {
  const masked = raw.replace(CODE_SPAN, (span) => '\u0000'.repeat(span.length));
  let end = raw.length;
  let after: string[] = [];
  let edgeRead = !withEdges;
  const marks: string[] = [];
  for (;;) {
    const head = masked.slice(0, end);
    const mark = TRAILING_MARK.exec(head);
    if (mark) {
      marks.unshift(raw.slice(mark.index, end).trim());
      end = mark.index;
      continue;
    }
    const edge = edgeRead ? null : TRAILING_AFTER.exec(head);
    if (edge) {
      after = (edge[1] ?? '').split(/[\s,]+/).filter((id) => id !== '');
      end = edge.index;
      edgeRead = true;
      continue;
    }
    break;
  }
  return { head: raw.slice(0, end).trim(), after, marks };
}

function parseClaim(match: RegExpExecArray, feature: string | null, line: number): Claim {
  const raw = (match[4] ?? '').trim();
  const { head, after, marks } = liftTrailing(raw, true);
  let text = head;
  let droppedNote: string | null = null;
  const tomb = LEADING_TOMBSTONE.exec(text);
  if (tomb) {
    droppedNote = (tomb[1] ?? '').replace(/^[\s—–:-]+/, '').trim() || null;
    text = text.slice(tomb[0].length);
  }
  const prefix = KIND_PREFIX.exec(text);
  const kind: ClaimKind = !prefix ? 'normal' : prefix[1]?.toLowerCase() === 'anti' ? 'anti' : 'antecedent';
  if (prefix) text = text.slice(prefix[0].length);
  return {
    id: match[3] ?? '',
    checked: match[2] !== ' ',
    kind,
    text: text.trim(),
    raw,
    after,
    marks,
    dropped: /\[DROPPED/i.test(raw),
    droppedNote,
    feature,
    indent: (match[1] ?? '').length,
    line,
  };
}

/** Split a table row on unescaped pipes; `\|` reads as a literal pipe. */
function tableCells(row: string): string[] {
  const cells: string[] = [];
  let cell = '';
  const text = row.trim();
  for (let i = 0; i < text.length; i++) {
    const c = text.charAt(i);
    if (c === '\\' && text.charAt(i + 1) === '|') {
      cell += '|';
      i += 1;
    } else if (c === '|') {
      cells.push(cell.trim());
      cell = '';
    } else {
      cell += c;
    }
  }
  if (cell.trim() !== '') cells.push(cell.trim());
  return cells.slice(1);
}

function testStrategyRows(lines: readonly Line[]): TestStrategyRow[] {
  const range = section(lines, 'Test Strategy');
  if (!range) return [];
  const rows: TestStrategyRow[] = [];
  for (let i = range[0]; i < range[1]; i++) {
    const line = lines[i];
    if (!line || line.fenced || !/^\s*\|/.test(line.text)) continue;
    const cells = tableCells(line.text);
    const first = cells[0] ?? '';
    if (first === '' || /^:?-+:?$/.test(first) || /^isc$/i.test(first)) continue;
    const at = (n: number) => cells[n] ?? '';
    rows.push({
      isc: first,
      type: at(1),
      check: at(2),
      threshold: at(3),
      tool: at(4),
      anchorsTo: at(5),
      severity: at(6),
      cells: cells.length,
      line: i + 1,
    });
  }
  return rows;
}

function fogLines(lines: readonly Line[]): FogLine[] {
  const range = section(lines, 'Not yet specified');
  if (!range) return [];
  const out: FogLine[] = [];
  for (let i = range[0]; i < range[1]; i++) {
    const line = lines[i];
    const m = line && !line.fenced ? FOG_LINE.exec(line.text) : null;
    if (!m) continue;
    const { head, marks } = liftTrailing(m[1] ?? '', false);
    out.push({ text: head, marks, line: i + 1 });
  }
  return out;
}

function verificationLines(lines: readonly Line[]): VerificationLine[] {
  const range = section(lines, 'Verification');
  if (!range) return [];
  const out: VerificationLine[] = [];
  for (let i = range[0]; i < range[1]; i++) {
    const line = lines[i];
    const m = line && !line.fenced ? VERIFICATION_LINE.exec(line.text) : null;
    if (m) out.push({ id: m[1] ?? '', text: (m[2] ?? '').trim(), line: i + 1 });
  }
  return out;
}

/** Closed over live claims: a tombstone leaves the denominator, as in the old recount. */
export function countProgress(claims: readonly Claim[]): Progress {
  const live = claims.filter((c) => !c.dropped);
  return { closed: live.filter((c) => c.checked).length, total: live.length };
}

/** `M/N`, the frontmatter spelling. */
export function formatProgress(progress: Progress): string {
  return `${progress.closed}/${progress.total}`;
}

/** Parse the claim-related sections of a spec or master file. */
export function parseClaims(text: string): ClaimsDocument {
  const lines = scanLines(text);
  const diagnostics: Diagnostic[] = [];
  const claims: Claim[] = [];
  const features: Array<{ id: string; name: string; why: string | null; line: number; claims: string[] }> = [];
  let idlessBoxes = 0;

  const start = lines.findIndex((l) => !l.fenced && CLAIM_HEADING.test(l.text));
  const headingLine = lines[start];
  const sectionInfo = headingLine ? { heading: (HEADING.exec(headingLine.text)?.[2] ?? '').trim(), line: start + 1 } : null;

  if (sectionInfo) {
    const plain = lines.filter((l) => !l.fenced).map((l) => l.text);
    if (plain.some((l) => /^##\s+Claims\b/i.test(l)) && plain.some((l) => /^##\s+Features\b/i.test(l))) {
      diagnostics.push({
        severity: 'warning',
        code: 'claims-both-headings',
        message: 'The file carries both ## Claims and ## Features; only the first section is read.',
      });
    }

    let current: (typeof features)[number] | null = null;
    for (let i = start + 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line) break;
      if (line.fenced) continue;
      if (LEVEL_TWO.test(line.text) || RULE.test(line.text)) break;
      const lineNo = i + 1;

      const featureHead = FEATURE_HEADING.exec(line.text);
      if (featureHead) {
        current = { id: featureHead[1] ?? '', name: featureHead[2] ?? '', why: null, line: lineNo, claims: [] };
        features.push(current);
        continue;
      }
      const heading = HEADING.exec(line.text);
      if (heading && (heading[1] ?? '').length <= 3) {
        current = null;
        continue;
      }
      const why = current?.why === null && current.claims.length === 0 ? WHY_LINE.exec(line.text) : null;
      if (current && why) {
        current.why = why[1] ?? '';
        continue;
      }

      const m = CLAIM_LINE.exec(line.text);
      if (m) {
        const claim = parseClaim(m, current?.id ?? null, lineNo);
        claims.push(claim);
        current?.claims.push(claim.id);
      } else if (CHECKBOX_LINE.test(line.text)) {
        idlessBoxes += 1;
        diagnostics.push({ severity: 'warning', code: 'claim-no-id', message: 'A checkbox line carries no claim ID and is invisible to the graph.', line: lineNo });
      }
    }
  }

  return {
    section: sectionInfo,
    claims,
    features,
    fog: fogLines(lines),
    testStrategy: testStrategyRows(lines),
    verification: verificationLines(lines),
    counted: countProgress(claims),
    idlessBoxes,
    diagnostics,
  };
}

/** Edge integrity over one file's claims: duplicate IDs, self edges, unknown IDs, and the first dependency cycle. */
export function validateEdges(claims: readonly Claim[]): Diagnostic[] {
  const out: Diagnostic[] = [];
  const warn = (code: string, message: string, line?: number) =>
    out.push(line === undefined ? { severity: 'warning', code, message } : { severity: 'warning', code, message, line });
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const c of claims) {
    if (seen.has(c.id)) dupes.add(c.id);
    seen.add(c.id);
  }
  for (const id of dupes) warn('edge-duplicate', `duplicate claim ID: ${id}`);
  for (const c of claims) {
    for (const b of c.after) {
      if (b === c.id) warn('edge-self', `${c.id} blocks on itself`, c.line);
      else if (!seen.has(b)) warn('edge-unknown', `${c.id} blocks on unknown ID: ${b}`, c.line);
    }
  }

  const byId = new Map(claims.map((c) => [c.id, c]));
  const colour = new Map<string, 1 | 2>();
  const stack: string[] = [];
  const visit = (id: string): boolean => {
    colour.set(id, 1);
    stack.push(id);
    for (const b of byId.get(id)?.after ?? []) {
      if (!byId.has(b)) continue;
      const state = colour.get(b);
      if (state === 1) {
        warn('edge-cycle', `dependency cycle: ${[...stack.slice(stack.indexOf(b)), b].join(' → ')}`);
        return true;
      }
      if (state === undefined && visit(b)) return true;
    }
    stack.pop();
    colour.set(id, 2);
    return false;
  };
  for (const c of claims) {
    if (!colour.has(c.id) && visit(c.id)) break;
  }
  return out;
}

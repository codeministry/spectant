// The context pack of one task (spec 010, T1/T3, ISC-333): what a builder of an implement round reads instead of the
// whole `spec.md`. `spec-check pack <spec> T<k> --json` prints it as one compact JSON line.
//
// - The keys stand in a fixed order, top level and nested: `spec, goal, task, claim, probe, lane, decisions,
//   truncated`. The object literals below are built in that order, so `JSON.stringify` keeps it.
// - Everything is read through the existing parsers: the task row through tasks.ts `parseTaskLines`, the claim and its
//   Test Strategy row through claims.ts `parseClaims`, the goal through archive.ts `levelTwoSection`, the lane profile
//   through tasks.ts `laneProfileOf`. No claim, checkbox or table grammar lives here.
// - The goal is the whole `## Goal` (or `## Ziel`) section body, trimmed, its lines kept as written.
// - The size of a pack is the UTF-8 byte length of `JSON.stringify(pack)`; `capPack` holds it under `PACK_LIMIT`.
// - `decisions` (T15, ISC-337) are the `## Decisions` bullets of spec.md, then plan.md, that name the task or its
//   claim as a whole token (`decisionRows`, `mentions`). `capPack` (T18, ISC-339) drops the oldest of them first.
//
// Pure: text in, model out. No file system, no Bun API. An unknown task or a task whose claim spec.md lacks throws a
// `PackError` with its code; the CLI maps the code to its JSON error.
import { GOAL_HEADINGS, levelTwoSection } from './archive.ts';
import { parseClaims } from './claims.ts';
import type { ClaimKind } from './files.ts';
import { type LaneProfile, laneProfileOf, parseTaskLines } from './tasks.ts';

/** The cap of a pack in UTF-8 bytes of its compact JSON. */
export const PACK_LIMIT = 8192;

export interface PackTask {
  /** `T<k>`. */
  readonly id: string;
  /** The lane token of the task line; null when the line has none. */
  readonly lane: string | null;
  /** The display text: without `(after: …)` and without the path column. */
  readonly text: string;
  /** The path column, code spans unwrapped, in line order. */
  readonly paths: readonly string[];
}

export interface PackClaim {
  readonly id: string;
  /**
   * The claim text as written, its kind prefix kept (`Anti: …`, `Antecedent: …`), without its trailing edge and
   * trailing marks. Without the prefix a builder reads an Anti claim as its opposite.
   */
  readonly text: string;
  /** Claim IDs from the claim's trailing `(after: …)`. */
  readonly after: readonly string[];
}

/** The claim's `## Test Strategy` row, its cells as written. */
export interface PackProbe {
  readonly type: string;
  readonly check: string;
  readonly threshold: string;
  readonly tool: string;
}

/** The lane's row of the constitution's `## Lanes` table. */
export type PackLane = LaneProfile;

/** One Decisions row that names the task or its claim (T15). */
export interface PackDecision {
  readonly source: 'spec.md' | 'plan.md';
  readonly text: string;
}

export interface Pack {
  /** The spec folder name, `NNN-slug`. */
  readonly spec: string;
  /** The `## Goal` section body, verbatim. */
  readonly goal: string;
  readonly task: PackTask;
  readonly claim: PackClaim;
  /** Null when the claim has no Test Strategy row. */
  readonly probe: PackProbe | null;
  /** Null without a constitution, without a lane token or for a lane outside `## Lanes`. */
  readonly lane: PackLane | null;
  readonly decisions: readonly PackDecision[];
  /** How many decisions `capPack` dropped to stay under the limit. */
  readonly truncated: number;
}

export interface PackInput {
  /** The spec folder name, `NNN-slug`. */
  readonly slug: string;
  /** The text of `spec.md`. */
  readonly spec: string;
  /** The text of `tasks.md`. */
  readonly tasks: string;
  /** The text of `plan.md`; null when the folder has none. */
  readonly plan: string | null;
  /** The text of `specs/constitution.md`; null when the repository has none. */
  readonly constitution: string | null;
  /** `T<k>`. */
  readonly task: string;
}

export type PackErrorCode = 'unknown-task' | 'no-claim';

export class PackError extends Error {
  readonly code: PackErrorCode;

  constructor(code: PackErrorCode, message: string) {
    super(message);
    this.name = 'PackError';
    this.code = code;
  }
}

const unticked = (cell: string): string => cell.replace(/`/g, '').trim();

/** The prefix claims.ts strips for a claim's kind, put back so the pack reads as spec.md does. */
const KIND_PREFIX: Readonly<Record<ClaimKind, string>> = { normal: '', anti: 'Anti: ', antecedent: 'Antecedent: ' };

/** A top-level bullet line: `- `, `* ` or `+ ` at the start of the line, its text after the marker. */
const BULLET = /^[-*+]\s+(.*)$/;

/**
 * The bullets under `## Decisions` (T15, ISC-337), each with its continuation lines as one row, in file order. The
 * text is kept as written, without the leading `- `; a continuation line keeps its indentation, trailing spaces
 * trimmed. A non-blank line under a bullet that is no new top-level bullet (a nested bullet included) continues it;
 * after a blank line only an indented line does, and blank lines inside a row are dropped. Prose outside a bullet is
 * no row. No section, no rows.
 */
export function decisionRows(text: string): string[] {
  const section = levelTwoSection(text, ['Decisions']);
  if (section === null) return [];
  const rows: string[][] = [];
  let row: string[] | null = null;
  let gap = false;
  for (const line of section.split('\n').map((l) => l.trimEnd())) {
    const bullet = BULLET.exec(line);
    if (bullet !== null) {
      row = [bullet[1] ?? ''];
      rows.push(row);
      gap = false;
    } else if (line === '') {
      gap = row !== null;
    } else if (row !== null && (!gap || /^\s/.test(line))) {
      row.push(line);
      gap = false;
    } else {
      row = null;
    }
  }
  return rows.map((r) => r.join('\n'));
}

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Whether a Decisions row names the claim or the task as a whole token (T15, ISC-337). No letter, digit, `_` or `-`
 * stands right before the ID and no letter, digit or `_` right after it: `ISC-12` hits `ISC-12` and its sub-claim
 * `ISC-12.1`, never `ISC-120`; `ISC-1` never hits `ISC-12`; `T3` hits `T3`, never `T30` or `T3x`.
 */
export function mentions(row: string, claimId: string, taskId: string): boolean {
  return [claimId, taskId].some((id) => id !== '' && new RegExp(String.raw`(?<![\w-])${escapeRegExp(id)}(?!\w)`).test(row));
}

/** The Decisions rows of one file that name the claim or the task, in file order, tagged with their source. */
function decisionsOf(source: PackDecision['source'], text: string, claimId: string, taskId: string): PackDecision[] {
  return decisionRows(text)
    .filter((r) => mentions(r, claimId, taskId))
    .map((r) => ({ source, text: r }));
}

/**
 * The pack of `input.task`: keys in the fixed order, the decisions of spec.md first, then plan.md's (T15), and
 * `truncated` 0: the pack is uncapped until `capPack` holds it under the limit. Only this spec's two texts are read, so no other spec's Decisions can enter.
 */
export function buildPack(input: PackInput): Pack {
  const tab = parseTaskLines({ tasks: input.tasks, ...(input.constitution === null ? {} : { constitution: input.constitution }) });
  const row = tab.tasks.find((t) => t.id === input.task);
  if (row === undefined) throw new PackError('unknown-task', `${input.task} is no task line of ${input.slug}/tasks.md.`);

  const doc = parseClaims(input.spec);
  const claim = row.claim === '' ? undefined : doc.claims.find((c) => c.id === row.claim);
  if (claim === undefined) {
    throw new PackError('no-claim', `${input.task} names ${row.claim === '' ? 'no claim' : row.claim}, which ${input.slug}/spec.md does not carry.`);
  }
  const strategy = doc.testStrategy.find((r) => unticked(r.isc) === claim.id);
  const lane = row.lane === '' ? null : row.lane;

  return {
    spec: input.slug,
    goal: (levelTwoSection(input.spec, GOAL_HEADINGS) ?? '').trim(),
    task: { id: row.id, lane, text: row.text, paths: [...row.paths] },
    claim: { id: claim.id, text: `${KIND_PREFIX[claim.kind]}${claim.text}`, after: [...claim.after] },
    probe: strategy === undefined ? null : { type: strategy.type, check: strategy.check, threshold: strategy.threshold, tool: strategy.tool },
    lane: lane === null || input.constitution === null ? null : laneProfileOf(input.constitution, lane),
    decisions: [
      ...decisionsOf('spec.md', input.spec, claim.id, row.id),
      ...(input.plan === null ? [] : decisionsOf('plan.md', input.plan, claim.id, row.id)),
    ],
    truncated: 0,
  };
}

/** The UTF-8 byte length of a pack's compact JSON. TextEncoder, not Buffer: core stays browser-safe. */
const packBytes = (pack: Pack): number => new TextEncoder().encode(JSON.stringify(pack)).length;

/** The ISO date a Decisions row starts with; '' for a row without one, so it sorts as the oldest. */
const LEADING_DATE = /^\d{4}-\d{2}-\d{2}/;
const dateOf = (d: PackDecision): string => LEADING_DATE.exec(d.text)?.[0] ?? '';

/**
 * The pack held under `limit` UTF-8 bytes of compact JSON (T18, ISC-339). While it is over the limit and decisions
 * remain, the oldest decision goes first: the earliest leading `YYYY-MM-DD`, a row without a date before every dated
 * one, ties in pack order (spec.md before plan.md, top to bottom). Each dropped row counts in `truncated`; the kept
 * rows keep their order. Goal, task, claim, probe and lane are never cut: a pack still over the limit with no
 * decisions left comes back as it is. Returns a new object, keys in the same order; an in-limit pack comes back equal.
 */
export function capPack(pack: Pack, limit: number = PACK_LIMIT): Pack {
  const order = pack.decisions
    .map((d, i) => ({ date: dateOf(d), i }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.i - b.i))
    .map((e) => e.i);
  const dropped = new Set<number>();
  const at = (): Pack => ({
    spec: pack.spec,
    goal: pack.goal,
    task: pack.task,
    claim: pack.claim,
    probe: pack.probe,
    lane: pack.lane,
    decisions: pack.decisions.filter((_, i) => !dropped.has(i)),
    truncated: pack.truncated + dropped.size,
  });
  let capped = at();
  for (const i of order) {
    if (packBytes(capped) <= limit) break;
    dropped.add(i);
    capped = at();
  }
  return capped;
}

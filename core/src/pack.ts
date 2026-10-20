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
// - `decisions` (the plan's and the spec's Decisions rows that name the task or its claim) is T15; until then it is
//   empty. `capPack` is T18; until then it throws.
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

/** The pack of `input.task`: keys in the fixed order, `decisions` empty and `truncated` 0 until T15 and T18. */
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
    decisions: [],
    truncated: 0,
  };
}

/** The pack held under `limit` UTF-8 bytes of compact JSON: oldest decisions dropped first, counted in `truncated`. */
export function capPack(pack: Pack, limit: number = PACK_LIMIT): Pack {
  // T18 implements the cap; this round only lands the signature.
  throw new Error(`capPack: not implemented (spec 010, T18): ${pack.task.id}, ${limit} bytes`);
}

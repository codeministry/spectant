// A stage move planned in memory (spec 008, ISC-121 and ISC-31, the transition route): the workflow decides whether
// the move is allowed, and on yes `spec.md` with its `stage:` set plus the `events.jsonl` line to append. T71 plans the
// accepted move, T72 the refusal. Reads and writes nothing: `server/src/writes.ts` checks the hash, the locks, and
// writes. Browser-safe: no file system, no Node or Bun API.
//
// The move, in order (FORMAT.md § frontmatter `stage`, § workflow):
// 1. `from` is the spec's current stage as `stage.ts` gives it: the explicit `stage:` when it is a stage of the type's
//    row and equals the last event's `to` (`explicitStageOf`), else the stage derived from the files (`stageOf`).
// 2. The pair must be one the type's row lists (`rowTransitions`), or, under `code_review: feature`, the entry into the
//    `close-pending` detour from the stage that would move on to `code-review`.
// 3. The fixed gates: a move to any stage past `review` in the row (and to the detours) needs a fresh reviewed mark;
//    `done`, `close` and `close-pending` need no open claim; `close-pending` needs an open sibling of the spec's main
//    feature, and `code-review` under `code_review: feature` (or out of `close-pending`) needs none.
// A refusal's reason is a stage table phrase where one fits (`STAGE_RULES`, filled by its row's `explain`), led by what
// the move needs; its command is the stage table's next command for the spec as it stands. A refused plan carries no
// text and no event.
//
// `stage:` is set by a targeted edit of the raw text, not by a second frontmatter parser: `parseFrontmatter` locates the
// block (its `bodyLine`), the last top-level `stage:` line inside it is replaced (the one the parser's last-wins reads),
// or, without one, a `stage:` line is inserted as the block's last key, before its closing delimiter. Each edited line
// keeps the line ending of its neighbourhood, every other byte (a BOM, CRLF endings) stays. The result is read back
// through `parseFrontmatter`: unless it reads `stage: <to>` and the body is unchanged, the move is refused.
import { parseEvents, validateEventLine } from './events.ts';
import type { CodeReviewMode, EventLine, MarkState, SpecFiles, SpecType, SpecWait, TransitionPlan, Workflow, WorkflowStage } from './files.ts';
import { parseFrontmatter, type FrontmatterResult } from './frontmatter.ts';
import { specIdOf } from './spec-ref.ts';
import { mainFeatureOf } from './status.ts';
import { CLAIMLESS_RULE, type ClaimCounts, codeReviewOf, commandWith, defaultWorkflowRow, fillReason, isAllocationEntry, isWorkflowStage, nextCommandWithReason, ownRuleOf, rowTransitions, type Stage, type StageInput, stageOf, workflowStagesOf } from './stage.ts';

export interface TransitionInput {
  readonly files: SpecFiles;
  readonly workflow: Workflow;
  readonly to: WorkflowStage;
  /** The actor id recorded in the event line (actor grammar, `actor.ts`). */
  readonly actor: string;
  /** The event's `ts`. */
  readonly now: Date;
  readonly reviewed: MarkState;
  /** The code-reviewed mark's state, for deriving `from`; absent, `missing`. */
  readonly codeReviewed?: MarkState;
  /** The claim counts as the dashboard row counts them: a claim an open spec edge holds is open, not takeable (ISC-162.2). */
  readonly partition: ClaimCounts;
  /** Open sibling specs of the spec's main feature, for `code_review: feature` (`close-pending`). */
  readonly featureSiblingsOpen: readonly string[];
  /** The spec's row of `resolveEdges(…).waits` (spec 025), for the full hold on `blocked` (ISC-162.3); absent, nothing. */
  readonly waits?: SpecWait | null;
  /** The specs the open spec edges on otherwise takeable claims wait on (`StageInput.edgeHeld`); absent, none. */
  readonly edgeHeld?: readonly string[];
}

/** FORMAT.md's stage table, row 9 (`close-pending`); `STAGE_RULES` gains the row with spec 008, T49. */
const CLOSE_PENDING_REASON = 'every claim is closed and {feature} waits on {siblings}';

/** A top-level `stage:` key line starts so, as `parseFrontmatter` reads a key: no indentation, the key, a colon. */
const STAGE_KEY = 'stage:';

/** The stages a spec runs and how its code review is done: its type's row, or the untyped default. */
interface Lane {
  readonly type: SpecType | null;
  readonly stages: readonly WorkflowStage[];
  readonly codeReview: CodeReviewMode;
}

function laneOf(type: SpecType | null, workflow: Workflow): Lane {
  if (type === null) return { type, stages: workflowStagesOf(null, workflow), codeReview: 'spec' };
  const row = workflow.rows.find((r) => r.type === type) ?? defaultWorkflowRow(type);
  return { type, stages: row.stages, codeReview: row.codeReview };
}

/** Whether the lane lists `from → to`. `rowTransitions` reads the row's stages only, so an untyped lane passes a label. */
function listed(lane: Lane, from: WorkflowStage, to: WorkflowStage): boolean {
  const row = { type: lane.type ?? 'feature', stages: lane.stages, codeReview: lane.codeReview };
  return rowTransitions(row).some((p) => p.from === from && p.to === to);
}

/**
 * The moves out of the allocation entry (spec 055, ISC-328): from `plan` in a row that does not run it, every stage of
 * the row up to and including `review`, none behind it; `review → build` stays the reviewed mark's own write.
 */
function entryMoveAllowed(lane: Lane, from: WorkflowStage, to: WorkflowStage): boolean {
  if (!isAllocationEntry(from, lane.stages)) return false;
  const at = lane.stages.indexOf(to);
  return at >= 0 && at <= lane.stages.indexOf('review');
}

/**
 * The listed moves, the moves out of the allocation entry, plus, under `code_review: feature`, the entry into
 * `close-pending` in place of `code-review`.
 */
function moveAllowed(lane: Lane, from: WorkflowStage, to: WorkflowStage): boolean {
  if (listed(lane, from, to) || entryMoveAllowed(lane, from, to)) return true;
  return to === 'close-pending' && lane.codeReview === 'feature' && listed(lane, from, 'code-review');
}

/** The filled reason of the stage table row for `stage`, for the spec as it stands. */
function phrase(stage: Stage, input: StageInput): string {
  const rule = ownRuleOf(stage);
  if (!rule) throw new Error(`SPEC_RULES has no row ${stage}`);
  const { form = 0, values = {} } = rule.explain(input);
  return fillReason(rule.reasons[form] ?? '', values);
}

/** The stage table's command for a stage, with the spec number; null where the row names none. */
function commandOf(stage: WorkflowStage, number: string): string | null {
  const next = ownRuleOf(stage as Stage, true)?.next;
  return next === undefined || next === null ? null : commandWith(next, number);
}

/**
 * The command that makes the move `from → to` (spec 055): out of the allocation entry `plan` of a row without it, the
 * command of the row's stage before `to` (`/spec tasks` before `review`), or, onto the row's first stage, the claimless
 * row's (`/spec new NNN` gives the spec its claims); otherwise the stage table's for `from`, else for `to`.
 */
function moveCommandOf(lane: Lane, from: WorkflowStage, to: WorkflowStage, number: string): string | null {
  if (!isAllocationEntry(from, lane.stages)) return commandOf(from, number) ?? commandOf(to, number);
  const before = lane.stages[lane.stages.indexOf(to) - 1];
  if (before !== undefined) return commandOf(before, number);
  return CLAIMLESS_RULE.next === null ? null : commandWith(CLAIMLESS_RULE.next, number);
}

const list = (ids: readonly string[]): string => ids.join(', ');

/** The first fixed gate the move fails, as a reason; null when it passes every one. */
function gateRefusal(input: TransitionInput, lane: Lane, from: WorkflowStage, stageInput: StageInput, feature: string): string | null {
  const { to, partition, featureSiblingsOpen: siblings } = input;
  const pastReview = to === 'blocked' || to === 'close-pending' || lane.stages.indexOf(to) > lane.stages.indexOf('review');
  if (pastReview && input.reviewed !== 'fresh') return `${to} needs a fresh reviewed mark: ${phrase('review', stageInput)}`;
  const open = partition.takeable + partition.open;
  if ((to === 'done' || to === 'close' || to === 'close-pending') && open > 0) {
    return `${to} needs every claim closed: ${phrase(partition.takeable > 0 ? 'build' : 'blocked', stageInput)}`;
  }
  if (to === 'close-pending' && siblings.length === 0) return `close-pending needs an open sibling spec of ${feature}; none is open`;
  if (to === 'code-review' && (lane.codeReview === 'feature' || from === 'close-pending') && siblings.length > 0) {
    const waits = open === 0 ? fillReason(CLOSE_PENDING_REASON, { feature, siblings: list(siblings) }) : `${feature} waits on ${list(siblings)}`;
    return `code-review is one review for ${feature}: ${waits}`;
  }
  return null;
}

/** The stage input of the spec as it stands, as the dashboard builds it; the takeable IDs count through `partition`. */
function stageInputOf(input: TransitionInput, fm: FrontmatterResult, number: string): StageInput {
  const { texts } = input.files;
  const p = input.partition;
  const last = texts.events === undefined ? undefined : parseEvents(texts.events).events.at(-1);
  const lastTo = last?.to ?? null;
  const lastFrom = last?.from ?? null;
  return {
    number,
    type: fm.data.specType,
    phase: fm.data.phase,
    hasPlan: texts.plan !== undefined,
    hasTasks: texts.tasks !== undefined,
    claims: { closed: p.closed, total: p.takeable + p.open + p.closed },
    reviewed: input.reviewed,
    codeReviewed: input.codeReviewed ?? 'missing',
    takeable: [],
    partition: p,
    explicitStage: fm.data.stage,
    lastEventTo: lastTo !== null && isWorkflowStage(lastTo) ? lastTo : null,
    // A step back holds an explicit stage the files have overtaken (ISC-221.2).
    lastEventFrom: lastFrom !== null && isWorkflowStage(lastFrom) ? lastFrom : null,
    workflow: input.workflow,
    // The close-pending row (T49): the type's code review, the main feature and its open siblings as the caller saw them.
    codeReview: codeReviewOf(fm.data.specType, input.workflow),
    mainFeature: mainFeatureOf(fm.data.isaFeature),
    featureSiblingsOpen: input.featureSiblingsOpen,
    // The spec edges as the row reads them (spec 025): a full hold stands on `blocked` with `waits on {specs}`.
    waits: input.waits ?? null,
    edgeHeld: input.edgeHeld ?? [],
  };
}

/**
 * `text` with `stage: <stage>` set in its frontmatter block (see the header), or null when the edit does not read back
 * as exactly that: the key not `stage`, or the body moved.
 */
function withStage(text: string, stage: WorkflowStage, fm: FrontmatterResult): string | null {
  const lines = text.split('\n');
  // The closing delimiter's 0-based line: the body starts on the 1-based line after it.
  const close = fm.bodyLine - 2;
  const cr = (line: string | undefined): string => (line?.endsWith('\r') ? '\r' : '');
  let at = -1;
  for (let i = 1; i < close; i++) if ((lines[i] ?? '').startsWith(STAGE_KEY)) at = i;
  if (at >= 0) lines[at] = `stage: ${stage}${cr(lines[at])}`;
  else lines.splice(close, 0, `stage: ${stage}${cr(lines[close - 1])}`);
  const out = lines.join('\n');
  const back = parseFrontmatter(out);
  return back.data.stage === stage && back.body === fm.body ? out : null;
}

/** Plans the move of one spec to `to`: the new `spec.md` and its event line, or the reason it is refused. Pure. */
export function planTransition(input: TransitionInput): TransitionPlan {
  const { to, files } = input;
  const spec = files.texts.spec;
  // A folder without spec.md holds no spec yet: it stands before one, at `idea`.
  if (spec === undefined) return { ok: false, from: 'idea', to, reason: `${files.folder} has no spec.md`, command: null };
  const number = specIdOf(files.folder) ?? files.folder;
  const fm = parseFrontmatter(spec);
  const stageInput = stageInputOf(input, fm, number);
  const from: WorkflowStage = stageOf(stageInput);
  const refuse = (reason: string): TransitionPlan => ({ ok: false, from, to, reason, command: nextCommandWithReason(stageInput).command });

  if (!fm.present) return refuse('spec.md has no frontmatter block to hold stage:');
  const lane = laneOf(fm.data.specType, input.workflow);
  if (from === to) return refuse(`the spec already stands in ${to}`);
  if (!moveAllowed(lane, from, to)) return refuse(`the ${lane.type ?? 'untyped'} workflow lists no move ${from} → ${to}`);
  const gate = gateRefusal(input, lane, from, stageInput, fm.data.isaFeature ?? 'its main feature');
  if (gate !== null) return refuse(gate);

  const specText = withStage(spec, to, fm);
  if (specText === null) return refuse('spec.md does not read back with the new stage: line; its frontmatter is left as it is');
  // The command that makes the move is the one the stage table names for `from`; the detour out of close-pending,
  // which names none, is made by the feature's code review.
  const command = moveCommandOf(lane, from, to, number);
  if (command === null) return refuse(`no stage table command makes the move ${from} → ${to}`);
  if (Number.isNaN(input.now.getTime())) return refuse('the event time is not a valid date');
  const event: EventLine = { ts: input.now.toISOString(), from, to, command, actor: input.actor };
  const checked = validateEventLine(JSON.stringify(event));
  if (!checked.ok) return refuse(`the event line would be rejected: ${checked.diagnostic.message}`);
  return { ok: true, from, to, specText, event };
}

// ─── The catch-up (spec 031, T18, ISC-44) ───────────────────────────────────────────────────────────────────────────
//
// A subcommand writes the file that carries the spec on first (plan.md, tasks.md, the last claim's verification) and
// records the move after it. By then the files derive the spec in the next stage, an explicit `stage:` the last event
// confirmed is overtaken (ISC-221.2), and `planTransition` refuses the move ("already stands"). The catch-up records it
// late: when the spec stands in `to` (`stageOf`) and the last event entered an earlier stage `P` from which the lane
// lists `P → to` and the fixed gates pass, it plans `spec.md` with `stage: <to>` and the one event `P → to`, its
// command the stage table's for `P` as `planTransition` names it. A derived stage the last event already enters is
// nothing to do (`recorded`). Anything else, a target the files do not derive, no event to start from, a gap of more
// than one listed move, a move out of `review` (the reviewed mark's write appends that event itself), is refused with a
// reason and writes nothing. Pure, as `planTransition`.

/** What a late stage move amounts to: the one event to append, nothing to do, or the reason it is refused. */
export type CatchUpPlan =
  | {
      readonly kind: 'catch-up';
      readonly from: WorkflowStage;
      readonly to: WorkflowStage;
      readonly specText: string;
      readonly event: EventLine;
    }
  | { readonly kind: 'recorded'; readonly stage: WorkflowStage }
  | {
      readonly kind: 'refused';
      readonly from: WorkflowStage;
      readonly to: WorkflowStage;
      readonly reason: string;
      readonly command: string | null;
    };

/** Plans the late record of a move the files already made: the one event from the last recorded stage to `to`. Pure. */
export function planCatchUp(input: TransitionInput): CatchUpPlan {
  const { to, files } = input;
  const spec = files.texts.spec;
  if (spec === undefined) return { kind: 'refused', from: 'idea', to, reason: `${files.folder} has no spec.md`, command: null };
  const number = specIdOf(files.folder) ?? files.folder;
  const fm = parseFrontmatter(spec);
  const stageInput = stageInputOf(input, fm, number);
  const stands: WorkflowStage = stageOf(stageInput);
  const last = stageInput.lastEventTo;
  const refuse = (from: WorkflowStage, reason: string): CatchUpPlan => ({
    kind: 'refused',
    from,
    to,
    reason,
    command: nextCommandWithReason(stageInput).command,
  });

  if (stands !== to) return refuse(stands, `the files carry the spec to ${stands}, not ${to}`);
  if (last === to) return { kind: 'recorded', stage: to };
  if (last === null) return refuse(stands, `no events.jsonl line records a stage to catch up from to ${to}`);
  if (!fm.present) return refuse(last, 'spec.md has no frontmatter block to hold stage:');
  // The move out of review is the reviewed mark's own event, appended by the write that sets the mark (FORMAT.md §
  // events, "Mark reviewed"); a catch-up beside it would record the move twice.
  if (last === 'review') return refuse(last, `the move review → ${to} is recorded by the reviewed mark's write, not caught up`);
  const lane = laneOf(fm.data.specType, input.workflow);
  if (!moveAllowed(lane, last, to)) {
    return refuse(last, `the files carry the spec to ${to}, but the ${lane.type ?? 'untyped'} workflow lists no move ${last} → ${to} from the last recorded stage`);
  }
  const gate = gateRefusal(input, lane, last, stageInput, fm.data.isaFeature ?? 'its main feature');
  if (gate !== null) return refuse(last, gate);

  const specText = withStage(spec, to, fm);
  if (specText === null) return refuse(last, 'spec.md does not read back with the new stage: line; its frontmatter is left as it is');
  const command = moveCommandOf(lane, last, to, number);
  if (command === null) return refuse(last, `no stage table command makes the move ${last} → ${to}`);
  if (Number.isNaN(input.now.getTime())) return refuse(last, 'the event time is not a valid date');
  const event: EventLine = { ts: input.now.toISOString(), from: last, to, command, actor: input.actor };
  const checked = validateEventLine(JSON.stringify(event));
  if (!checked.ok) return refuse(last, `the event line would be rejected: ${checked.diagnostic.message}`);
  return { kind: 'catch-up', from: last, to, specText, event };
}

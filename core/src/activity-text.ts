// The activity line planner (spec 031, T9–T11, ISC-227): the lines a writer appends to `.spectant/activity.jsonl`,
// planned here so the plugin CLI (`spec-check`) writes exactly what `locks.ts` and `item-state.ts` read, the shape of
// FORMAT.md § Activity and lock lines. Pure and browser-safe: input in, one line of text out, no file system, no Node
// or Bun API; the caller appends the text and owns the clock.
//
// Every planner returns one JSON object and its newline, keys in the order the existing writers use:
//   claim, release                {ts, event, claim, task?, session, worktree?}                  (harbor's fixture lines)
//   run-start, run-end            {ts, event, run, command, session, spec | idea, outcome?}       (beacon's lines and the
//                                                                                                  app's run release)
//   dispatch, build, patch, apply {ts, event, claim?, task, session, worktree?}
//   probe                         {ts, event, claim, task, session, result, worktree?}
//   question                      {ts, event, claim?, task, session, text, worktree?}            (the skill's writer)
//
// A run-end repeats its start's `command`, `session` and target: the reader requires them on both lines, and the pair
// is matched by `run` alone. The target is a spec (`NNN` or the folder `NNN-slug`), an idea (the story's slug) or the
// literal `init`: `/spec init` works on the repository rather than one spec or idea, and the reader needs exactly one of
// the two, so it is written as the spec `init`, a name no spec folder carries; it pairs like any run and puts no item
// into `running`.
//
// The run id: the caller passes it to both lines. `newRunId` derives one deterministically from the start's inputs
// (time to the millisecond, session, command, target), so the CLI needs no randomness and a test can predict it: two
// sessions starting in the same millisecond get different ids, and only the same session starting the same command on
// the same target in the same millisecond would collide (the reader then skips the second start as a duplicate).
//
// Input the reader would skip or mark legacy is refused with an `ActivityTextError` instead, and nothing is planned:
// a session outside the actor grammar (legacy sessions are read, never written), a bad claim or task id, a time that is
// not a date, a field with a line break, a target of no known form, an outcome the reader does not know, a `patch` or
// `apply` without its worktree, a probe without a red or green result, an empty question.
import { parseActor } from './actor.ts';
import type { ProbeResult, RunEvent, RunOutcome } from './files.ts';
import { SPEC_FOLDER, SPEC_ID } from './spec-ref.ts';

export type ActivityTextErrorCode = 'bad-input' | 'bad-session' | 'bad-claim' | 'bad-task' | 'bad-ts' | 'multi-line' | 'bad-target' | 'bad-outcome';

/** A refused plan: the input would give a line the reader skips or reads as legacy. Nothing was planned. */
export class ActivityTextError extends Error {
  readonly code: ActivityTextErrorCode;

  constructor(code: ActivityTextErrorCode, message: string) {
    super(message);
    this.name = 'ActivityTextError';
    this.code = code;
  }
}

/** A claim held or let go (spec 002). `task` names the task working it; `worktree` where it is worked. */
export interface ClaimLineInput {
  readonly claim: string;
  readonly task?: string;
  readonly session: string;
  readonly worktree?: string;
  readonly ts: string;
}

/** The start of a command on a spec, an idea or the repository (spec 040). */
export interface RunStartInput {
  readonly run: string;
  /** A spec (`NNN` or `NNN-slug`), an idea's slug, or the literal `init`. */
  readonly target: string;
  /** The command as typed, e.g. `/spec tasks 037`. */
  readonly command: string;
  readonly session: string;
  readonly ts: string;
}

/** The end of a run: the start's fields again (the reader requires them), its outcome and the end's time. */
export interface RunEndInput extends RunStartInput {
  readonly outcome: RunOutcome;
}

/** One step of a task in an implement round (spec 027). `worktree` is required on `patch` and `apply`. */
export interface RunEventLineInput {
  readonly event: RunEvent;
  readonly task: string;
  readonly claim?: string;
  readonly session: string;
  readonly worktree?: string;
  readonly ts: string;
}

/** A run of a task's probe (spec 015). */
export interface ProbeLineInput {
  readonly task: string;
  readonly claim: string;
  readonly result: ProbeResult;
  readonly session: string;
  readonly worktree?: string;
  readonly ts: string;
}

/** A question the task's agent asks the person (spec 015); the text is kept to its first line, 200 characters. */
export interface QuestionLineInput {
  readonly task: string;
  readonly text: string;
  readonly claim?: string;
  readonly session: string;
  readonly worktree?: string;
  readonly ts: string;
}

/** The inputs a run id is derived from: the start's time, session, command and target. */
export interface RunIdInput {
  readonly ts: string;
  readonly session: string;
  readonly command: string;
  readonly target: string;
}

const CLAIM_ID = /^ISC-\d+(\.\d+)*$/u;
const TASK_ID = /^[TC]\d+$/u; // a tasks.md task `T<k>` or a frontier claim unit `C<k>` of a spec without tasks.md (spec 056)
const IDEA_SLUG = /^[a-z0-9][a-z0-9-]*$/u;
const INIT_TARGET = 'init';
const RUN_EVENTS: ReadonlySet<string> = new Set<RunEvent>(['dispatch', 'build', 'patch', 'apply']);
const OUTCOMES: ReadonlySet<string> = new Set<RunOutcome>(['ok', 'error', 'released']);
const PROBE_RESULTS: ReadonlySet<string> = new Set<ProbeResult>(['red', 'green']);
/** The reader's `QUESTION_TEXT_MAX` (locks.ts, which stays out of the browser bundle): planned text is never cut again. */
const QUESTION_TEXT_MAX = 200;
const GRAPHEMES = new Intl.Segmenter('en', { granularity: 'grapheme' });

function oneLine(value: string | undefined, what: string, required: boolean): void {
  if (value === undefined || value === '') {
    if (required || value === '') throw new ActivityTextError('bad-input', `${what} is empty`);
    return;
  }
  if (/[\r\n]/u.test(value)) throw new ActivityTextError('multi-line', `${what} must be one line`);
}

function checkTs(ts: string): void {
  oneLine(ts, 'the time', true);
  if (Number.isNaN(Date.parse(ts))) throw new ActivityTextError('bad-ts', `the time ${JSON.stringify(ts)} is not a date`);
}

function checkSession(session: string): void {
  oneLine(session, 'the session', true);
  if (parseActor(session).legacy) {
    throw new ActivityTextError('bad-session', `the session ${JSON.stringify(session)} is no actor: a:<kind>:<id>[/T<k>|/C<k>] or u:<8 hex>`);
  }
}

function checkClaim(claim: string | undefined, required: boolean): void {
  oneLine(claim, 'the claim', required);
  if (claim !== undefined && !CLAIM_ID.test(claim)) throw new ActivityTextError('bad-claim', `the claim ${JSON.stringify(claim)} is no ISC-N`);
}

function checkTask(task: string | undefined, required: boolean): void {
  oneLine(task, 'the task', required);
  if (task !== undefined && !TASK_ID.test(task)) throw new ActivityTextError('bad-task', `the task ${JSON.stringify(task)} is no T<k> or C<k>`);
}

/** The line's text: one JSON object and its newline. */
const lineOf = (entry: Record<string, string>): string => `${JSON.stringify(entry)}\n`;

const optional = (key: string, value: string | undefined): Record<string, string> => (value === undefined ? {} : { [key]: value });

/** The key a run's target is written under: a spec (`NNN`, `NNN-slug`, or `init`) or an idea slug. */
function targetOf(target: string): { spec: string } | { idea: string } {
  oneLine(target, 'the target', true);
  if (SPEC_ID.test(target) || SPEC_FOLDER.test(target) || target === INIT_TARGET) return { spec: target };
  if (IDEA_SLUG.test(target)) return { idea: target };
  throw new ActivityTextError('bad-target', `the target ${JSON.stringify(target)} is no spec NNN, idea slug or init`);
}

function claimEvent(event: 'claim' | 'release', input: ClaimLineInput): string {
  checkTs(input.ts);
  checkClaim(input.claim, true);
  checkTask(input.task, false);
  checkSession(input.session);
  oneLine(input.worktree, 'the worktree', false);
  return lineOf({ ts: input.ts, event, claim: input.claim, ...optional('task', input.task), session: input.session, ...optional('worktree', input.worktree) });
}

/** The line that holds `claim` for `session` from `ts` until a release (FORMAT.md § Activity and lock lines). */
export function claimLine(input: ClaimLineInput): string {
  return claimEvent('claim', input);
}

/** The line that lets `claim` go; the reader frees it only when `session` holds it. */
export function releaseLine(input: ClaimLineInput): string {
  return claimEvent('release', input);
}

function runEntry(event: 'run-start' | 'run-end', input: RunStartInput): Record<string, string> {
  checkTs(input.ts);
  oneLine(input.run, 'the run id', true);
  oneLine(input.command, 'the command', true);
  checkSession(input.session);
  return { ts: input.ts, event, run: input.run, command: input.command, session: input.session, ...targetOf(input.target) };
}

/** The line a command writes when it starts (spec 040): open until a `run-end` with the same `run`. */
export function runStartLine(input: RunStartInput): string {
  return lineOf(runEntry('run-start', input));
}

/** The line a command writes when it ends, also on an error (`outcome: error`); it closes the run of the same id. */
export function runEndLine(input: RunEndInput): string {
  const entry = runEntry('run-end', input);
  if (!OUTCOMES.has(input.outcome)) throw new ActivityTextError('bad-outcome', `the outcome ${JSON.stringify(input.outcome)} is none of ok, error or released`);
  return lineOf({ ...entry, outcome: input.outcome });
}

/** One step of a task's run (spec 027): `dispatch`, `build`, `patch` or `apply`. */
export function runEventLine(input: RunEventLineInput): string {
  if (!RUN_EVENTS.has(input.event)) throw new ActivityTextError('bad-input', `the event ${JSON.stringify(input.event)} is no run event`);
  checkTs(input.ts);
  checkClaim(input.claim, false);
  checkTask(input.task, true);
  checkSession(input.session);
  oneLine(input.worktree, 'the worktree', input.event === 'patch' || input.event === 'apply');
  return lineOf({ ts: input.ts, event: input.event, ...optional('claim', input.claim), task: input.task, session: input.session, ...optional('worktree', input.worktree) });
}

/** The line a task's agent writes after each run of its claim's probe (spec 015). */
export function probeLine(input: ProbeLineInput): string {
  checkTs(input.ts);
  checkClaim(input.claim, true);
  checkTask(input.task, true);
  checkSession(input.session);
  // The type says red or green; a caller passing a CLI argument through is checked at run time too.
  if (!PROBE_RESULTS.has(input.result)) throw new ActivityTextError('bad-input', 'a probe result is red or green');
  oneLine(input.worktree, 'the worktree', false);
  return lineOf({ ts: input.ts, event: 'probe', claim: input.claim, task: input.task, session: input.session, result: input.result, ...optional('worktree', input.worktree) });
}

/** The line a task's agent writes when it asks the person something (spec 015): the text's first line, 200 characters. */
export function questionLine(input: QuestionLineInput): string {
  checkTs(input.ts);
  checkClaim(input.claim, false);
  checkTask(input.task, true);
  checkSession(input.session);
  oneLine(input.worktree, 'the worktree', false);
  const first = (input.text.split(/\r?\n/u)[0] ?? '').trim();
  const text = [...GRAPHEMES.segment(first)].slice(0, QUESTION_TEXT_MAX).map((g) => g.segment).join('');
  if (text === '') throw new ActivityTextError('bad-input', 'a question needs text');
  return lineOf({ ts: input.ts, event: 'question', ...optional('claim', input.claim), task: input.task, session: input.session, text, ...optional('worktree', input.worktree) });
}

/** FNV-1a, 32 bit, as eight hex digits: a stable, dependency-free digest (not a security hash). */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/**
 * A run id derived from the start's inputs: `r-<UTC time to the millisecond>-<8 hex digest of session, command and
 * target>`, e.g. `r-20260308T120000123Z-1a2b3c4d`. Deterministic: the same inputs give the same id.
 */
export function newRunId(input: RunIdInput): string {
  checkTs(input.ts);
  const stamp = new Date(input.ts).toISOString().replace(/[-:.]/gu, '');
  return `r-${stamp}-${fnv1a([input.ts, input.session, input.command, input.target].join('\n'))}`;
}

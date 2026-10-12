// Stage per spec and the next command (T37, ISC-14), ported from the old SpecDashboard `stageOf()` and
// `nextCommand()`: one fixed chain (plan, tasks, review, implement, code review, complete), derived from the files
// on every read, never from the frontmatter `phase:` (which decides the first row's `done` and nothing else). A chore
// (spec 008) leaves the chain early: once every claim is closed it is done without a code review.
// FORMAT.md's stage table is held as data in STAGE_RULES, in table order, first match wins: every column (condition in
// words, command, reason templates) is a field, and core/tests/stage.test.ts compares each rule with its markdown row
// verbatim (spec 002 T11, ISC-79). A reason is always one of its row's templates, filled by `fillReason`.
//
// Spec 008 adds the workflow's defaults and what derives from a row: the default table (T42, read by workflow.ts, which
// imports it from here so the two modules form no import cycle), the allowed transitions (T45, ISC-29) and the explicit
// stage, a frontmatter `stage:` that wins over the derived one when the last event agrees with it (T47, ISC-120), and
// is one `stage-mismatch` diagnostic when it does not apply (T48). Row 7, `close-pending`, is the detour of
// `code_review: feature` (T49): a spec whose claims are all closed waits there while a sibling of its main feature is open.
import type { Diagnostic } from './diagnostics.ts';
import type { CodeReviewMode, MarkState, SpecType, StageSource, Workflow, WorkflowRow, WorkflowStage } from './files.ts';
import type { Progress } from './frontmatter.ts';

export type Stage = 'plan' | 'tasks' | 'review' | 'build' | 'blocked' | 'code-review' | 'close-pending' | 'close' | 'done';

/**
 * A spec's claims as disjoint counts, computed by the caller (status.ts `partitionClaims`, T34): `takeable` open and
 * workable now, `open` open but blocked by an edge or taken by a lock, `closed` checked, `dropped` tombstoned.
 */
export interface ClaimCounts {
  readonly takeable: number;
  readonly open: number;
  readonly closed: number;
  readonly dropped: number;
}

export interface StageInput {
  /** `NNN`. */
  readonly number: string;
  readonly type: SpecType | null;
  readonly phase: string | null;
  readonly hasPlan: boolean;
  readonly hasTasks: boolean;
  /** Live claims, closed over total. Used for the counts only when `partition` is absent. */
  readonly claims: Progress;
  readonly reviewed: MarkState;
  readonly codeReviewed: MarkState;
  /** Claim IDs takeable now; named in the reason. Their number counts only when `partition` is absent. */
  readonly takeable: readonly string[];
  /**
   * The claim partition. When present it decides every count, as the old SpecStatus counted: every claim line
   * (dropped ones included) toward the three-claim threshold, and "every claim closed" once none is open.
   */
  readonly partition?: ClaimCounts;
  /** Frontmatter `stage:` as written, unvalidated (`SpecFrontmatter.stage`, T40); null without the key. */
  readonly explicitStage: string | null;
  /** The `to` of the last valid `events.jsonl` line, in file order; null without events. */
  readonly lastEventTo: WorkflowStage | null;
  /** The workspace's workflow; absent, the default table (FORMAT.md § workflow). Decides which stages are explicit. */
  readonly workflow?: Workflow;
  /** How the spec type's code review is done: its row of `workflow` (`codeReviewOf`). Row 7 needs `feature`. */
  readonly codeReview: CodeReviewMode;
  /**
   * The spec's main feature, the first word of `isa_feature:` (`mainFeatureOf` in status.ts), e.g. `F6`; null when it
   * names none. Row 7's `{feature}`.
   */
  readonly mainFeature: string | null;
  /**
   * The ids (`NNN`) of the other specs of the main feature that are open: active (not archived, not `phase: complete`)
   * and holding at least one open claim, in id order. Empty without a main feature. Row 7's `{siblings}`.
   */
  readonly featureSiblingsOpen: readonly string[];
}

/** The type router: which files a spec type needs besides spec.md. An unknown type needs neither. */
export const TYPE_NEEDS: Readonly<Record<SpecType, { readonly plan: boolean; readonly tasks: boolean }>> = {
  bug: { plan: false, tasks: false },
  spike: { plan: false, tasks: false },
  refactor: { plan: false, tasks: true },
  feature: { plan: true, tasks: true },
  project: { plan: true, tasks: true },
  infra: { plan: true, tasks: false },
  // spec 008: a chore carries spec.md only (FORMAT.md § The thirteen file kinds).
  chore: { plan: false, tasks: false },
};

/** Below this many claims a spec needs no tasks.md, whatever its type. */
const TASKS_THRESHOLD = 3;

interface Counts {
  readonly total: number;
  readonly takeable: number;
  readonly open: number;
  readonly allClosed: boolean;
}

function countsOf(input: StageInput): Counts {
  const p = input.partition;
  if (p) {
    const open = p.takeable + p.open;
    const total = open + p.closed + p.dropped;
    return { total, takeable: p.takeable, open, allClosed: total > 0 && open === 0 };
  }
  const { closed, total } = input.claims;
  return { total, takeable: input.takeable.length, open: total - closed, allClosed: total > 0 && closed === total };
}

const needs = (input: StageInput, file: 'plan' | 'tasks'): boolean => (input.type ? TYPE_NEEDS[input.type][file] : false);

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

/** `{ids}` of the build row: the takeable IDs, the first two and a count past two, or a count when none are given. */
function takeableIds(input: StageInput, count: number): string {
  const ids = input.takeable;
  if (ids.length === 0) return plural(count, 'claim');
  if (ids.length === 1) return ids[0] ?? '';
  if (ids.length === 2) return `${ids[0] ?? ''} and ${ids[1] ?? ''}`;
  return `${ids[0] ?? ''}, ${ids[1] ?? ''} and ${ids.length - 2} more`;
}

/** `{siblings}` of row 7: `spec 005`, `specs 005 and 006`, or `specs 005, 006 and 2 more`. */
function siblingList(ids: readonly string[]): string {
  if (ids.length === 1) return `spec ${ids[0] ?? ''}`;
  if (ids.length === 2) return `specs ${ids[0] ?? ''} and ${ids[1] ?? ''}`;
  return `specs ${ids[0] ?? ''}, ${ids[1] ?? ''} and ${ids.length - 2} more`;
}

/** Which of a row's reason templates applies and the values of its placeholders. */
export interface ReasonFill {
  /** Index into the row's `reasons`; 0 when the row has one. */
  readonly form?: number;
  readonly values?: Readonly<Record<string, string>>;
}

/**
 * One row of FORMAT.md's stage table, every column as data: `core/tests/stage.test.ts` renders each rule as its
 * markdown row and compares it verbatim with FORMAT.md, so the contract and the code cannot disagree.
 */
export interface StageRule {
  readonly stage: Stage;
  /** The row's condition in words, as FORMAT.md's Condition cell. The rows before it are known not to match. */
  readonly condition: string;
  /** The row's condition as code. */
  readonly when: (input: StageInput) => boolean;
  /** The command without the spec number (FORMAT.md writes it with `NNN`); null for `done`. */
  readonly next: string | null;
  /** The reasons this row can give, `{placeholder}` templates as FORMAT.md's Reason cell lists them. */
  readonly reasons: readonly string[];
  /** Which reason applies to `input` and what fills it; the reason is never free text. */
  readonly explain: (input: StageInput) => ReasonFill;
}

/** Fills every `{placeholder}` of `template`; throws on one without a value, so no row emits a half-filled reason. */
export function fillReason(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(/\{([a-zA-Z]+)\}/g, (placeholder, name: string) => {
    const value = values[name];
    if (value === undefined) throw new Error(`stage reason "${template}": no value for ${placeholder}`);
    return value;
  });
}

/** The status contract, FORMAT.md § "The stage table", first match wins. `blocked` is the fallback. */
export const STAGE_RULES: readonly StageRule[] = [
  {
    stage: 'done',
    condition: '`phase: complete`',
    when: (input) => input.phase === 'complete',
    next: null,
    reasons: ['phase: complete'],
    explain: () => ({}),
  },
  {
    stage: 'plan',
    condition: 'the type needs `plan.md` and it is missing',
    when: (input) => needs(input, 'plan') && !input.hasPlan,
    next: '/spec-plan',
    reasons: ['a {type} spec needs plan.md and it is missing'],
    explain: (input) => ({ values: { type: input.type ?? 'typed' } }),
  },
  {
    stage: 'tasks',
    condition: 'the type needs `tasks.md`, the spec has three or more claims, and `tasks.md` is missing',
    when: (input) => needs(input, 'tasks') && countsOf(input).total >= TASKS_THRESHOLD && !input.hasTasks,
    next: '/spec-tasks',
    reasons: ['{claims} and no tasks.md'],
    explain: (input) => ({ values: { claims: plural(countsOf(input).total, 'claim') } }),
  },
  {
    stage: 'review',
    condition: 'the reviewed mark is not fresh',
    when: (input) => input.reviewed !== 'fresh',
    next: '/spec-review',
    reasons: ['the reviewed mark is {state}'],
    explain: (input) => ({ values: { state: input.reviewed } }),
  },
  {
    stage: 'build',
    condition: 'at least one claim is takeable',
    when: (input) => countsOf(input).takeable > 0,
    next: '/spec-implement',
    reasons: ['{ids} {is} takeable'],
    explain: (input) => {
      const count = countsOf(input).takeable;
      const many = input.takeable.length === 0 ? count !== 1 : input.takeable.length > 1;
      return { values: { ids: takeableIds(input, count), is: many ? 'are' : 'is' } };
    },
  },
  {
    stage: 'done',
    condition: 'the type is `chore` and every claim is closed',
    when: (input) => input.type === 'chore' && countsOf(input).allClosed,
    next: null,
    reasons: ['every claim of the chore is closed'],
    explain: () => ({}),
  },
  {
    stage: 'close-pending',
    condition:
      "every claim is closed, the type's workflow has `code_review: feature`, and at least one other spec of the spec's main feature is still open",
    when: (input) => countsOf(input).allClosed && input.codeReview === 'feature' && input.featureSiblingsOpen.length > 0,
    next: null,
    reasons: ['every claim is closed and {feature} waits on {siblings}'],
    explain: (input) => ({ values: { feature: input.mainFeature ?? 'the feature', siblings: siblingList(input.featureSiblingsOpen) } }),
  },
  {
    stage: 'code-review',
    condition: 'every claim is closed and the code-reviewed mark is not fresh',
    when: (input) => countsOf(input).allClosed && input.codeReviewed !== 'fresh',
    next: '/spec-code-review',
    reasons: ['every claim is closed and the code-reviewed mark is {state}'],
    explain: (input) => ({ values: { state: input.codeReviewed } }),
  },
  {
    stage: 'close',
    condition: 'every claim is closed and the code-reviewed mark is fresh',
    when: (input) => countsOf(input).allClosed && input.codeReviewed === 'fresh',
    next: '/spec-complete',
    reasons: ['every claim is closed and code-reviewed'],
    explain: () => ({}),
  },
  {
    stage: 'blocked',
    condition: 'anything else: open claims none of which is takeable, or no claims yet',
    when: () => true,
    next: '/spec-status',
    reasons: ['{open}, none takeable', 'no claims yet'],
    explain: (input) => {
      const { open } = countsOf(input);
      return open > 0 ? { form: 0, values: { open: plural(open, 'open claim') } } : { form: 1 };
    },
  },
];

function ruleOf(input: StageInput): StageRule {
  const rule = STAGE_RULES.find((r) => r.when(input));
  if (!rule) throw new Error('STAGE_RULES has no fallback row');
  return rule;
}

export interface NextStep {
  /** The explicit stage when one applies (`explicitStageOf`), else the matching row's. */
  readonly stage: Stage;
  /** `explicit` when the frontmatter `stage:` decided `stage`, `derived` when the stage table did (T47). */
  readonly stageSource: StageSource;
  /** E.g. `/spec-implement 002`; null where the row names none (`done`, `close-pending`). */
  readonly command: string | null;
  /** One of the row's reasons, filled, e.g. `ISC-334 is takeable`. */
  readonly reason: string;
}

/**
 * The stage, the one command it needs next and why: the matching row's command and one of its reasons. An explicit
 * stage replaces the row's stage only; the command and the reason stay the stage table's, since they say what the
 * files still need (FORMAT.md, frontmatter `stage`).
 */
export function nextCommandWithReason(input: StageInput): NextStep {
  const rule = ruleOf(input);
  const { form = 0, values = {} } = rule.explain(input);
  const template = rule.reasons[form];
  if (template === undefined) throw new Error(`stage row ${rule.stage} has no reason ${form}`);
  const explicit = explicitStageOf(input);
  return {
    stage: explicit ?? rule.stage,
    stageSource: explicit === null ? 'derived' : 'explicit',
    command: rule.next === null ? null : `${rule.next} ${input.number}`,
    reason: fillReason(template, values),
  };
}

/** The one command a spec needs next, e.g. `/spec-implement 002`; null for a complete spec. */
export function nextCommand(input: StageInput): string | null {
  return nextCommandWithReason(input).command;
}

/**
 * The spec's stage: the explicit one when it applies, else the stage the next command stands for (`blocked` when no
 * command in the chain applies, `done` when complete).
 */
export function stageOf(input: StageInput): Stage {
  return explicitStageOf(input) ?? ruleOf(input).stage;
}

// ─── The workflow's default rows (spec 008, T42) ────────────────────────────────────────────────────────────────────

/** Every stage a workflow knows, `WorkflowStage` in board order: `idea`, the stage table's, and `close-pending`. */
const WORKFLOW_STAGE_KEYS = {
  idea: true,
  plan: true,
  tasks: true,
  review: true,
  build: true,
  blocked: true,
  'code-review': true,
  'close-pending': true,
  close: true,
  done: true,
} as const satisfies Record<WorkflowStage, true>;

/** Every `WorkflowStage`, checked exhaustive by the compiler. */
export const WORKFLOW_STAGES: readonly WorkflowStage[] = Object.keys(WORKFLOW_STAGE_KEYS) as WorkflowStage[];

export const isWorkflowStage = (value: string): value is WorkflowStage => Object.hasOwn(WORKFLOW_STAGE_KEYS, value);

const TABLE_STAGES: ReadonlySet<string> = new Set(STAGE_RULES.map((rule) => rule.stage));
const isStage = (value: string): value is Stage => TABLE_STAGES.has(value);

/** The spec types in row order: FORMAT.md § workflow's default table. */
export const WORKFLOW_TYPES: readonly SpecType[] = ['feature', 'project', 'infra', 'refactor', 'bug', 'spike', 'chore'];

/** The default code review: one mark per spec, none for a chore. */
const defaultCodeReview = (type: SpecType | null): CodeReviewMode => (type === 'chore' ? 'none' : 'spec');

/** The stages that exist only for a code review: a type with `code_review: none` goes from `build` to `done`. */
const CODE_REVIEW_STAGES: ReadonlySet<WorkflowStage> = new Set(['code-review', 'close']);

/** The detours every type has and no row lists: the default rows leave both out. */
const DETOURS: ReadonlySet<WorkflowStage> = new Set(['blocked', 'close-pending']);

/**
 * The default stages of a type: the stage table in its order, `done` last and the `blocked` detour left out, keeping
 * `plan` and `tasks` only where TYPE_NEEDS asks for the file and the code-review stages only where the type has a
 * review. A spec without a type needs neither file and has a review: `review · build · code-review · close · done`.
 */
function defaultStages(type: SpecType | null): WorkflowStage[] {
  const needs = type === null ? { plan: false, tasks: false } : TYPE_NEEDS[type];
  const codeReview = defaultCodeReview(type);
  const keep = (stage: WorkflowStage): boolean => {
    if (DETOURS.has(stage) || stage === 'done') return false;
    if (stage === 'plan') return needs.plan;
    if (stage === 'tasks') return needs.tasks;
    return codeReview !== 'none' || !CODE_REVIEW_STAGES.has(stage);
  };
  return [...STAGE_RULES.map((rule) => rule.stage).filter(keep), 'done'];
}

/** A type's default row (FORMAT.md § workflow). */
export function defaultWorkflowRow(type: SpecType): WorkflowRow {
  return { type, stages: defaultStages(type), codeReview: defaultCodeReview(type) };
}

/** The default table, applied when `specs/workflow.md` is missing (FORMAT.md § workflow). */
export const DEFAULT_WORKFLOW: readonly WorkflowRow[] = WORKFLOW_TYPES.map(defaultWorkflowRow);

const DEFAULT: Workflow = { rows: DEFAULT_WORKFLOW, source: 'default', diagnostics: [] };

/** The row a type runs under `workflow`: its own, else its default row. */
const rowOf = (type: SpecType, workflow: Workflow): WorkflowRow => workflow.rows.find((r) => r.type === type) ?? defaultWorkflowRow(type);

/** How a spec type's code review is done under `workflow` (the default table when absent); untyped, `spec`. */
export function codeReviewOf(type: SpecType | null, workflow: Workflow = DEFAULT): CodeReviewMode {
  return type === null ? defaultCodeReview(null) : rowOf(type, workflow).codeReview;
}

/** The stages a spec runs: its type's row in `workflow` (the default table when absent); untyped, the untyped default. */
export function workflowStagesOf(type: SpecType | null, workflow: Workflow = DEFAULT): readonly WorkflowStage[] {
  return type === null ? defaultStages(null) : rowOf(type, workflow).stages;
}

// ─── Transitions (spec 008, T45, ISC-29) ────────────────────────────────────────────────────────────────────────────

/** One allowed stage move. */
export interface StageTransition {
  readonly from: WorkflowStage;
  readonly to: WorkflowStage;
}

/**
 * The moves a row allows, and no other: each stage to its successor in the row, the `blocked` detour from `build` and
 * back for every type, `build → close-pending` where the row has `code_review: feature` (T49), and
 * `close-pending → code-review` where the row has `code-review`. A backward move (`build → review`) or a skip
 * (`review → done`) is not listed, so it is refused.
 */
export function rowTransitions(row: WorkflowRow): readonly StageTransition[] {
  const pairs: StageTransition[] = [];
  const add = (from: WorkflowStage, to: WorkflowStage): void => {
    if (!pairs.some((p) => p.from === from && p.to === to)) pairs.push({ from, to });
  };
  row.stages.forEach((stage, i) => {
    const next = row.stages[i + 1];
    if (next !== undefined) add(stage, next);
  });
  add('build', 'blocked');
  add('blocked', 'build');
  if (row.codeReview === 'feature') add('build', 'close-pending');
  if (row.stages.includes('code-review')) add('close-pending', 'code-review');
  return pairs;
}

/** The allowed moves per spec type under `workflow`. */
export function transitionsOf(workflow: Workflow): Readonly<Record<SpecType, readonly StageTransition[]>> {
  return Object.fromEntries(WORKFLOW_TYPES.map((type) => [type, rowTransitions(rowOf(type, workflow))])) as Record<SpecType, readonly StageTransition[]>;
}

/** The allowed moves per spec type under the default table, as data. */
export const TRANSITIONS: Readonly<Record<SpecType, readonly StageTransition[]>> = transitionsOf(DEFAULT);

/** Whether a spec of `type` may move `from` → `to` under `workflow`: true exactly for the pairs its row lists. */
export function allowedTransition(from: WorkflowStage, to: WorkflowStage, type: SpecType, workflow: Workflow): boolean {
  return rowTransitions(rowOf(type, workflow)).some((p) => p.from === from && p.to === to);
}

// ─── The explicit stage (spec 008, T47 and T48, ISC-120) ────────────────────────────────────────────────────────────

/** What a frontmatter `stage:` amounts to: none written, it applies, or why it does not. */
type ExplicitVerdict =
  | { readonly kind: 'none' }
  | { readonly kind: 'applies'; readonly stage: Stage }
  | { readonly kind: 'outside'; readonly value: string }
  | { readonly kind: 'contradicted'; readonly value: string };

function explicitVerdict(input: StageInput): ExplicitVerdict {
  const value = input.explicitStage;
  if (value === null) return { kind: 'none' };
  // A detour (`blocked`, `close-pending`), `idea` or an unknown word is in no row, so it is outside as well.
  if (!isStage(value) || !workflowStagesOf(input.type, input.workflow).some((s) => s === value)) return { kind: 'outside', value };
  if (value !== input.lastEventTo) return { kind: 'contradicted', value };
  return { kind: 'applies', stage: value };
}

/**
 * The frontmatter `stage:` when it applies: a stage of the spec type's workflow row that equals the last event's `to`;
 * null otherwise, and the stage table decides (`stageSource: derived`); `stageMismatchOf` then names why.
 */
export function explicitStageOf(input: StageInput): Stage | null {
  const verdict = explicitVerdict(input);
  return verdict.kind === 'applies' ? verdict.stage : null;
}

/**
 * The one `stage-mismatch` warning of a `stage:` that does not apply (T48, ISC-120.1): a value outside the type's
 * workflow row, or one the last event's `to` contradicts (a file without any event included: nothing confirms it).
 * `subject` is the value as written, `line` the key's line in spec.md when the caller knows it. Null without the key
 * and for a value that applies. The derived stage applies either way.
 */
export function stageMismatchOf(input: StageInput, line?: number): Diagnostic | null {
  const verdict = explicitVerdict(input);
  if (verdict.kind === 'none' || verdict.kind === 'applies') return null;
  const why =
    verdict.kind === 'outside'
      ? `is not a stage of the ${input.type ?? 'untyped'} workflow (${workflowStagesOf(input.type, input.workflow).join(' · ')})`
      : input.lastEventTo === null
        ? 'is entered by no events.jsonl line'
        : `is contradicted by the last events.jsonl line, which enters "${input.lastEventTo}"`;
  return {
    severity: 'warning',
    code: 'stage-mismatch',
    message: `stage "${verdict.value}" ${why}; the derived stage applies.`,
    ...(line === undefined ? {} : { line }),
    subject: verdict.value,
  };
}

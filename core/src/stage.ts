// Stage per spec and the next command (T37, ISC-14), ported from the old SpecDashboard `stageOf()` and
// `nextCommand()`: one fixed chain (plan, tasks, review, implement, code review, complete), derived from the files
// on every read, never from the frontmatter `phase:` (which decides the `done` of row 2 and nothing else). A chore
// (spec 008) leaves the chain early: once every claim is closed it is done without a code review.
// FORMAT.md's stage table is held as data in STAGE_RULES, in table order, first match wins: every column (condition in
// words, command, reason templates) is a field, and core/tests/stage.test.ts compares each rule with its markdown row
// verbatim (spec 002 T11, ISC-79). A reason is always one of its row's templates, filled by `fillReason`, and every surface
// reads it through `reasonOf` (T58). Row 1, `idea`, is the story row (T54): a story file stands in it, its command takes
// the slug where a spec row takes the number, and a spec folder is tried against SPEC_RULES, rows 2 to 11, only.
//
// Spec 008 adds the workflow's defaults and what derives from a row: the default table (T42, read by workflow.ts, which
// imports it from here so the two modules form no import cycle), the allowed transitions (T45, ISC-29) and the explicit
// stage, a frontmatter `stage:` that wins over the derived one when the last event agrees with it (T47, ISC-120), and
// is one `stage-mismatch` diagnostic when it does not apply (T48). Spec 040 (T68, ISC-221.2): a confirmed `stage:` that
// the derived stage has overtaken along the type's row yields to it without a diagnostic, unless the last event was a
// step back, which holds; the allocation (`from: null`) is no step back. Row 8, `close-pending`, is the detour of
// `code_review: feature` (T49): a spec whose claims are all closed waits there while a sibling of its main feature is open.
//
// Spec 025 (T14, ISC-162.3): a spec whose whole open work hangs on open spec edges (`SpecWait.full`, spec-edges.ts) is
// not on `build` even with a takeable claim; it falls through to row 11, `blocked`, with the reason `waits on {specs}`.
// A spec with takeable work beside the held keeps its stage. A claim an open spec edge holds is not takeable
// (`StageInput.edgeHeld`, ISC-162.2): when only such claims would be takeable, the spec stands in row 11 the same way.
//
// Spec 040 (T8, ISC-221): every row names the item state it yields while no run is open (`StageRule.state`): `waiting`
// for `close-pending` and `blocked`, `done` for both `done` rows, `open` with the row's command for every other row.
import type { Diagnostic } from './diagnostics.ts';
import type { CodeReviewMode, ItemState, MarkState, SpecType, SpecWait, StageSource, Workflow, WorkflowRow, WorkflowStage } from './files.ts';
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
  /**
   * The `from` of that same line (spec 040, ISC-221.2); null for the allocation (`from: null`) and without events. A
   * step back (`to` before `from` in the type's row) holds an explicit stage the files have overtaken.
   */
  readonly lastEventFrom: WorkflowStage | null;
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
  /**
   * What the spec waits on, its row of `resolveEdges(…).waits` (spec-edges.ts, spec 025); absent or null, nothing.
   * When `full`, row 6 does not apply and row 11 names the blockers (ISC-162.3).
   */
  readonly waits?: SpecWait | null;
  /**
   * The specs (`NNN`, ascending) that open spec edges on would-be-takeable claims wait on; the caller has already
   * taken those claims out of `takeable` and `partition.takeable` (ISC-162.2). When that leaves nothing takeable, the
   * spec's open takeable work all waits on spec edges: row 11 reads `waits on {specs}` with these (ISC-162.3).
   * Absent or empty, no claim was held so.
   */
  readonly edgeHeld?: readonly string[];
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

/** The spec numbers holding every piece of the spec's open work (ISC-162.3); empty unless the wait is full. */
/**
 * The specs a full hold waits on: every open piece of work hangs on an open spec edge (`SpecWait.full`), or the only
 * claims that would be takeable are held by one (`edgeHeld`, nothing takeable left). Empty when there is no full hold.
 */
function fullHoldOf(input: StageInput): readonly string[] {
  if (input.waits?.full === true) return input.waits.blockers;
  const held = input.edgeHeld ?? [];
  return held.length > 0 && countsOf(input).takeable === 0 ? held : [];
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
 * What a row of the stage table stands for: a spec folder, whose command takes the spec number (FORMAT.md writes
 * `NNN`), or a story file of `specs/ideas/` (row 1, `idea`), whose command takes its slug (FORMAT.md writes `<slug>`).
 */
export type StageSubject = 'spec' | 'story';

/**
 * The item state a row of the stage table yields while no run is open on the item (spec 040, T8, ISC-221): `open` where
 * a command lies with the user, `waiting` where the spec hangs on other items, `done` on the two done rows. A run is
 * never a row's state; `itemStates` (item-state.ts) lays it over this one.
 */
export type RuleState = Extract<ItemState, 'open' | 'waiting' | 'done'>;

/** The columns every row has. */
interface StageRuleColumns {
  readonly subject: StageSubject;
  /** The row's condition in words, as FORMAT.md's Condition cell. The rows before it are known not to match. */
  readonly condition: string;
  /** The command without its argument (the spec number, or the story's slug); null where the row names none. */
  readonly next: string | null;
  /** The reasons this row can give, `{placeholder}` templates as FORMAT.md's Reason cell lists them. */
  readonly reasons: readonly string[];
  /**
   * The state the row yields without a run (spec 040, T8): `waiting` for `close-pending` (feature siblings) and
   * `blocked` (spec edges, claims), `done` for both `done` rows, `open` with the row's command for every other row and
   * the story row. The state table (ISC-228) is checked against it.
   */
  readonly state: RuleState;
}

/** A row a spec folder stands in: tried in table order over the spec's `StageInput`, first match wins. */
export interface SpecStageRule extends StageRuleColumns {
  readonly subject: 'spec';
  readonly stage: Stage;
  /** The row's condition as code. */
  readonly when: (input: StageInput) => boolean;
  /** Which reason applies to `input` and what fills it; the reason is never free text. */
  readonly explain: (input: StageInput) => ReasonFill;
}

/**
 * Row 1: every story file stands in `idea` (spec 008, T54), so the row needs no condition as code and its one reason no
 * placeholder. A spec folder never matches it: a story has no folder yet, and a spec is never a story.
 */
export interface StoryStageRule extends StageRuleColumns {
  readonly subject: 'story';
  readonly stage: 'idea';
  readonly next: string;
}

/**
 * One row of FORMAT.md's stage table, every column as data: `core/tests/stage.test.ts` renders each rule as its
 * markdown row and compares it verbatim with FORMAT.md, so the contract and the code cannot disagree.
 */
export type StageRule = SpecStageRule | StoryStageRule;

/** Fills every `{placeholder}` of `template`; throws on one without a value, so no row emits a half-filled reason. */
export function fillReason(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(/\{([a-zA-Z]+)\}/g, (placeholder, name: string) => {
    const value = values[name];
    if (value === undefined) throw new Error(`stage reason "${template}": no value for ${placeholder}`);
    return value;
  });
}

/** Row 1 of the stage table: a story, the stage before its spec folder exists (FORMAT.md § idea). */
export const STORY_RULE: StoryStageRule = {
  subject: 'story',
  stage: 'idea',
  state: 'open',
  condition: 'a story file under `specs/ideas/`, no folder yet',
  next: '/spec new',
  reasons: ['the story is shaped but has no spec'],
};

/** Rows 2 to 11, the rows a spec folder stands in, first match wins. `blocked` is the fallback. */
export const SPEC_RULES: readonly SpecStageRule[] = [
  {
    subject: 'spec',
    stage: 'done',
    state: 'done',
    condition: '`phase: complete`',
    when: (input) => input.phase === 'complete',
    next: null,
    reasons: ['phase: complete'],
    explain: () => ({}),
  },
  {
    subject: 'spec',
    stage: 'plan',
    state: 'open',
    condition: 'the type needs `plan.md` and it is missing',
    when: (input) => needs(input, 'plan') && !input.hasPlan,
    next: '/spec-plan',
    reasons: ['a {type} spec needs plan.md and it is missing'],
    explain: (input) => ({ values: { type: input.type ?? 'typed' } }),
  },
  {
    subject: 'spec',
    stage: 'tasks',
    state: 'open',
    condition: 'the type needs `tasks.md`, the spec has three or more claims, and `tasks.md` is missing',
    when: (input) => needs(input, 'tasks') && countsOf(input).total >= TASKS_THRESHOLD && !input.hasTasks,
    next: '/spec-tasks',
    reasons: ['{claims} and no tasks.md'],
    explain: (input) => ({ values: { claims: plural(countsOf(input).total, 'claim') } }),
  },
  {
    subject: 'spec',
    stage: 'review',
    state: 'open',
    condition: 'the reviewed mark is not fresh',
    when: (input) => input.reviewed !== 'fresh',
    next: '/spec-review',
    reasons: ['the reviewed mark is {state}'],
    explain: (input) => ({ values: { state: input.reviewed } }),
  },
  {
    subject: 'spec',
    stage: 'build',
    state: 'open',
    condition: 'at least one claim is takeable and not all open work waits on an open spec edge',
    when: (input) => countsOf(input).takeable > 0 && fullHoldOf(input).length === 0,
    next: '/spec-implement',
    reasons: ['{ids} {is} takeable'],
    explain: (input) => {
      const count = countsOf(input).takeable;
      const many = input.takeable.length === 0 ? count !== 1 : input.takeable.length > 1;
      return { values: { ids: takeableIds(input, count), is: many ? 'are' : 'is' } };
    },
  },
  {
    subject: 'spec',
    stage: 'done',
    state: 'done',
    condition: 'the type is `chore` and every claim is closed',
    when: (input) => input.type === 'chore' && countsOf(input).allClosed,
    next: null,
    reasons: ['every claim of the chore is closed'],
    explain: () => ({}),
  },
  {
    subject: 'spec',
    stage: 'close-pending',
    state: 'waiting',
    condition:
      "every claim is closed, the type's workflow has `code_review: feature`, and at least one other spec of the spec's main feature is still open",
    when: (input) => countsOf(input).allClosed && input.codeReview === 'feature' && input.featureSiblingsOpen.length > 0,
    next: null,
    reasons: ['every claim is closed and {feature} waits on {siblings}'],
    explain: (input) => ({ values: { feature: input.mainFeature ?? 'the feature', siblings: siblingList(input.featureSiblingsOpen) } }),
  },
  {
    subject: 'spec',
    stage: 'code-review',
    state: 'open',
    condition: "every claim is closed, the type's workflow has a code review, and the code-reviewed mark is not fresh",
    when: (input) => countsOf(input).allClosed && input.codeReview !== 'none' && input.codeReviewed !== 'fresh',
    next: '/spec-code-review',
    reasons: ['every claim is closed and the code-reviewed mark is {state}'],
    explain: (input) => ({ values: { state: input.codeReviewed } }),
  },
  {
    subject: 'spec',
    stage: 'close',
    state: 'open',
    condition: "every claim is closed and either the code-reviewed mark is fresh or the type's workflow has `code_review: none`",
    when: (input) => countsOf(input).allClosed && (input.codeReviewed === 'fresh' || input.codeReview === 'none'),
    next: '/spec-complete',
    reasons: ['every claim is closed and code-reviewed', 'every claim is closed and the workflow has no code review'],
    // Spec 028 (ISC-183.1): under `none` the mode picks the phrase, so a voluntary mark changes nothing.
    explain: (input) => ({ form: input.codeReview === 'none' ? 1 : 0 }),
  },
  {
    subject: 'spec',
    stage: 'blocked',
    state: 'waiting',
    condition: 'anything else: all open work waits on an open spec edge, open claims none of which is takeable, or no claims yet',
    when: () => true,
    next: '/spec-status',
    reasons: ['{open}, none takeable', 'no claims yet', 'waits on {specs}'],
    explain: (input): ReasonFill => {
      const held = fullHoldOf(input);
      if (held.length > 0) return { form: 2, values: { specs: held.join(', ') } };
      const { open } = countsOf(input);
      return open > 0 ? { form: 0, values: { open: plural(open, 'open claim') } } : { form: 1 };
    },
  },
];

/** The status contract, FORMAT.md § "The stage table", in table order: the story row, then the spec rows. */
export const STAGE_RULES: readonly StageRule[] = [STORY_RULE, ...SPEC_RULES];

function ruleOf(input: StageInput): SpecStageRule {
  const rule = SPEC_RULES.find((r) => r.when(input));
  if (!rule) throw new Error('SPEC_RULES has no fallback row');
  return rule;
}

/** The row number FORMAT.md gives a rule: its 1-based place in STAGE_RULES. */
const rowNumberOf = (rule: StageRule): number => STAGE_RULES.indexOf(rule) + 1;

export interface NextStep {
  /** The explicit stage when one applies (`explicitStageOf`), else the matching row's. */
  readonly stage: Stage;
  /** `explicit` when the frontmatter `stage:` decided `stage`, `derived` when the stage table did (T47). */
  readonly stageSource: StageSource;
  /** E.g. `/spec-implement 002`; null where the row names none (`done`, `close-pending`). */
  readonly command: string | null;
  /** One of the row's reasons, filled, e.g. `ISC-334 is takeable`. Surfaces read it through `reasonOf`. */
  readonly reason: string;
  /** The matching row's number in FORMAT.md's stage table, 2 to 11. */
  readonly row: number;
}

/** A story's step (row 1): it stands in `idea`, and `/spec new <slug>` starts its spec. */
export interface StoryStep {
  readonly stage: 'idea';
  /** E.g. `/spec new console-audit-log`. */
  readonly command: string;
  readonly reason: string;
  /** Row 1. */
  readonly row: number;
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
    row: rowNumberOf(rule),
  };
}

/** The step of a story file, `<slug>.md` under `specs/ideas/`: row 1 with the slug where a spec row has its number. */
export function storyStep(slug: string): StoryStep {
  return { stage: 'idea', command: `${STORY_RULE.next} ${slug}`, reason: STORY_RULE.reasons[0] ?? '', row: rowNumberOf(STORY_RULE) };
}

// ─── The one reason phrase (spec 008, T58, ISC-122.3) ───────────────────────────────────────────────────────────────

/**
 * The rows a spec waits in, on a person or on another spec: each shows why with exactly one phrase of its row, the same
 * on every surface (the dashboard row, the spec head, the board).
 */
export const WAITING_STAGES: ReadonlySet<Stage> = new Set<Stage>(['review', 'blocked', 'close-pending', 'code-review', 'close']);

const escapeRe = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The placeholders with a closed set of values (FORMAT.md's legend); every other one is some non-empty text. */
const CLOSED_PLACEHOLDERS: Readonly<Record<string, string>> = { is: '(?:is|are)', state: '(?:missing|stale)' };

/**
 * Whether `phrase` is `template` with every `{placeholder}` filled: `{is}` and `{state}` by one of their words, every
 * other one by some non-empty text. The closed sets keep the templates apart (`{ids} {is} takeable` never reads
 * `3 open claims, none takeable`).
 */
export function fillsTemplate(template: string, phrase: string): boolean {
  const parts = template.split(/(\{[a-zA-Z]+\})/);
  const pattern = parts.map((part, i) => (i % 2 === 0 ? escapeRe(part) : (CLOSED_PLACEHOLDERS[part.slice(1, -1)] ?? '.+'))).join('');
  return new RegExp(`^${pattern}$`).test(phrase);
}

/**
 * The one reason phrase of a step: its row's template, filled, which every surface shows unchanged (the dashboard row's
 * `nextReason`, the spec head's `nextReason` and first `next.reasons` entry). It is exactly one of the row's
 * templates, never two phrases joined and never free text; a step whose reason is not throws, since only code in
 * `core/` builds steps and such a step is a defect there, not malformed input.
 */
export function reasonOf(step: NextStep | StoryStep): string {
  const rule = STAGE_RULES[step.row - 1];
  if (!rule?.reasons.some((template) => fillsTemplate(template, step.reason))) {
    throw new Error(`stage row ${step.row}: "${step.reason}" is not one of its reasons`);
  }
  return step.reason;
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

const TABLE_STAGES: ReadonlySet<string> = new Set(SPEC_RULES.map((rule) => rule.stage));
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
  return [...SPEC_RULES.map((rule) => rule.stage).filter(keep), 'done'];
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
  | { readonly kind: 'contradicted'; readonly value: string }
  | { readonly kind: 'overtaken'; readonly value: string };

/**
 * A stage's place along a workflow row (ISC-221.2): its index; the detours sit at `build` (`blocked`) or just past it
 * (`close-pending`, on the way to the code review); -1 for a stage the row does not run.
 */
function placeOf(stage: Stage | WorkflowStage, row: readonly WorkflowStage[]): number {
  const build = row.indexOf('build');
  if (stage === 'blocked') return build;
  if (stage === 'close-pending') return build < 0 ? -1 : build + 0.5;
  return row.indexOf(stage);
}

function explicitVerdict(input: StageInput): ExplicitVerdict {
  const value = input.explicitStage;
  if (value === null) return { kind: 'none' };
  const row = workflowStagesOf(input.type, input.workflow);
  // A detour (`blocked`, `close-pending`), `idea` or an unknown word is in no row, so it is outside as well.
  if (!isStage(value) || !row.some((s) => s === value)) return { kind: 'outside', value };
  if (value !== input.lastEventTo) return { kind: 'contradicted', value };
  // ISC-221.2: the files overtook the allocation or a forward move; only a step back holds against them.
  const stepBack = input.lastEventFrom !== null && placeOf(value, row) < placeOf(input.lastEventFrom, row);
  if (!stepBack && placeOf(ruleOf(input).stage, row) > placeOf(value, row)) return { kind: 'overtaken', value };
  return { kind: 'applies', stage: value };
}

/**
 * The frontmatter `stage:` when it applies: a stage of the spec type's workflow row that equals the last event's `to`,
 * unless the derived stage lies further along the row and that event was no step back (ISC-221.2, overtaken); null
 * otherwise, and the stage table decides (`stageSource: derived`); `stageMismatchOf` then names why.
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
  // An overtaken value is no mismatch (ISC-221.2): the event confirmed it, the files have since moved on.
  if (verdict.kind === 'none' || verdict.kind === 'applies' || verdict.kind === 'overtaken') return null;
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

// Stage per spec and the next command (T37, ISC-14), ported from the old SpecDashboard `stageOf()` and
// `nextCommand()`: one fixed chain (plan, tasks, review, implement, code review, complete), derived from the files
// on every read, never from the frontmatter `phase:` (which decides `done` and nothing else).
// FORMAT.md's stage table is held as data in STAGE_RULES, in table order, first match wins: every column (condition in
// words, command, reason templates) is a field, and core/tests/stage.test.ts compares each rule with its markdown row
// verbatim (spec 002 T11, ISC-79). A reason is always one of its row's templates, filled by `fillReason`.
import type { SpecType } from './files.ts';
import type { Progress } from './frontmatter.ts';
import type { MarkState } from './gates.ts';

export type Stage = 'plan' | 'tasks' | 'review' | 'build' | 'blocked' | 'code-review' | 'close' | 'done';

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
}

/** The type router: which files a spec type needs besides spec.md. An unknown type needs neither. */
export const TYPE_NEEDS: Readonly<Record<SpecType, { readonly plan: boolean; readonly tasks: boolean }>> = {
  bug: { plan: false, tasks: false },
  spike: { plan: false, tasks: false },
  refactor: { plan: false, tasks: true },
  feature: { plan: true, tasks: true },
  project: { plan: true, tasks: true },
  infra: { plan: true, tasks: false },
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
  readonly stage: Stage;
  /** E.g. `/spec-implement 002`; null for a complete spec. */
  readonly command: string | null;
  /** One of the row's reasons, filled, e.g. `ISC-334 is takeable`. */
  readonly reason: string;
}

/** The stage, the one command it needs next and why: the matching row's command and one of its reasons. */
export function nextCommandWithReason(input: StageInput): NextStep {
  const rule = ruleOf(input);
  const { form = 0, values = {} } = rule.explain(input);
  const template = rule.reasons[form];
  if (template === undefined) throw new Error(`stage row ${rule.stage} has no reason ${form}`);
  return {
    stage: rule.stage,
    command: rule.next === null ? null : `${rule.next} ${input.number}`,
    reason: fillReason(template, values),
  };
}

/** The one command a spec needs next, e.g. `/spec-implement 002`; null for a complete spec. */
export function nextCommand(input: StageInput): string | null {
  return nextCommandWithReason(input).command;
}

/** The stage the next command stands for; `blocked` when no command in the chain applies, `done` when complete. */
export function stageOf(input: StageInput): Stage {
  return ruleOf(input).stage;
}

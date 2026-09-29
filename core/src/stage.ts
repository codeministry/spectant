// Stage per spec and the next command (T37, ISC-14), ported from the old SpecDashboard `stageOf()` and
// `nextCommand()`: one fixed chain (plan, tasks, review, implement, code review, complete), derived from the files
// on every read, never from the frontmatter `phase:` (which decides `done` and nothing else).
// The status contract of the old SpecFormat.md is held as data in STAGE_RULES, in table order, first match wins, so
// spec 002's T11 can compare it row by row with FORMAT.md.
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

function takeableReason(input: StageInput, count: number): string {
  const ids = input.takeable;
  if (ids.length === 0) return `${plural(count, 'claim')} ${count === 1 ? 'is' : 'are'} takeable`;
  if (ids.length === 1) return `${ids[0] ?? ''} is takeable`;
  if (ids.length === 2) return `${ids[0] ?? ''} and ${ids[1] ?? ''} are takeable`;
  return `${ids[0] ?? ''}, ${ids[1] ?? ''} and ${ids.length - 2} more are takeable`;
}

export interface StageRule {
  readonly stage: Stage;
  /** The row's condition; the rows before it are known not to match. */
  readonly when: (input: StageInput) => boolean;
  /** The command without the spec number; null for `done`. */
  readonly next: string | null;
  /** Why this row matched, one phrase for the dashboard row and spec 002's status block. */
  readonly explain: (input: StageInput) => string;
}

/** The status contract, first match wins. `blocked` is the fallback: open claims, none takeable, or no claims yet. */
export const STAGE_RULES: readonly StageRule[] = [
  {
    stage: 'done',
    when: (input) => input.phase === 'complete',
    next: null,
    explain: () => 'phase: complete',
  },
  {
    stage: 'plan',
    when: (input) => needs(input, 'plan') && !input.hasPlan,
    next: '/spec-plan',
    explain: (input) => `a ${input.type ?? 'typed'} spec needs plan.md and it is missing`,
  },
  {
    stage: 'tasks',
    when: (input) => needs(input, 'tasks') && countsOf(input).total >= TASKS_THRESHOLD && !input.hasTasks,
    next: '/spec-tasks',
    explain: (input) => `${plural(countsOf(input).total, 'claim')} and no tasks.md`,
  },
  {
    stage: 'review',
    when: (input) => input.reviewed !== 'fresh',
    next: '/spec-review',
    explain: (input) => `the reviewed mark is ${input.reviewed}`,
  },
  {
    stage: 'build',
    when: (input) => countsOf(input).takeable > 0,
    next: '/spec-implement',
    explain: (input) => takeableReason(input, countsOf(input).takeable),
  },
  {
    stage: 'code-review',
    when: (input) => countsOf(input).allClosed && input.codeReviewed !== 'fresh',
    next: '/spec-code-review',
    explain: (input) => `every claim is closed and the code-reviewed mark is ${input.codeReviewed}`,
  },
  {
    stage: 'close',
    when: (input) => countsOf(input).allClosed && input.codeReviewed === 'fresh',
    next: '/spec-complete',
    explain: () => 'every claim is closed and code-reviewed',
  },
  {
    stage: 'blocked',
    when: () => true,
    next: '/spec-status',
    explain: (input) => {
      const { open } = countsOf(input);
      return open > 0 ? `${plural(open, 'open claim')}, none takeable` : 'no claims yet';
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
  /** E.g. `ISC-334 is takeable`. */
  readonly reason: string;
}

/** The stage, the one command it needs next and why. */
export function nextCommandWithReason(input: StageInput): NextStep {
  const rule = ruleOf(input);
  return {
    stage: rule.stage,
    command: rule.next === null ? null : `${rule.next} ${input.number}`,
    reason: rule.explain(input),
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

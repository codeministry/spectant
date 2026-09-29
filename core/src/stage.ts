// Stage per spec and the next command (T37, ISC-14), ported from the old SpecDashboard `stageOf()` and
// `nextCommand()`: one fixed chain (plan, tasks, review, implement, code review, complete), derived from the files
// on every read, never from the frontmatter `phase:`. Spec 002's T11 extends this file with the FORMAT.md table.
// Stub from the T33 seam: the fill-in task replaces the bodies and keeps the exported names and types.
import type { SpecType } from './files.ts';
import type { Progress } from './frontmatter.ts';
import type { MarkState } from './gates.ts';

export type Stage = 'plan' | 'tasks' | 'review' | 'build' | 'blocked' | 'code-review' | 'close' | 'done';

export interface StageInput {
  /** `NNN`. */
  readonly number: string;
  readonly type: SpecType | null;
  readonly phase: string | null;
  readonly hasPlan: boolean;
  readonly hasTasks: boolean;
  /** Live claims, closed over total. */
  readonly claims: Progress;
  readonly reviewed: MarkState;
  readonly codeReviewed: MarkState;
  /** Claim IDs takeable now. */
  readonly takeable: readonly string[];
}

/** The one command a spec needs next, e.g. `/spec-implement 002`; null for a complete spec. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- stub parameters; the fill-in uses them and drops this line
export function nextCommand(_input: StageInput): string | null {
  throw new Error('not implemented: nextCommand');
}

/** The stage the next command stands for; `blocked` when no command in the chain applies, `done` when complete. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- stub parameters; the fill-in uses them and drops this line
export function stageOf(_input: StageInput): Stage {
  throw new Error('not implemented: stageOf');
}

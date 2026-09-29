// The diagram verdict (T38, ISC-16), ported from the old SpecStatus `diagramVerdict()`: feature, infra and project
// specs need a mermaid fence in spec.md and plan.md, a refactor only warns without one in spec.md, a complete spec
// is never held to it.
// Stub from the T33 seam: the fill-in task replaces the body and keeps the exported name and types.
import type { SpecType } from './files.ts';

export type DiagramLevel = 'fail' | 'warn' | 'ok' | 'skip';

export interface DiagramInput {
  readonly type: SpecType | null;
  readonly phase: string | null;
  /** spec.md text. */
  readonly spec: string;
  /** plan.md text; null when the spec has no plan. */
  readonly plan: string | null;
}

export interface DiagramVerdict {
  readonly level: DiagramLevel;
  /** The files without a mermaid fence. */
  readonly missing: ReadonlyArray<'spec.md' | 'plan.md'>;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- stub parameters; the fill-in uses them and drops this line
export function diagramVerdict(_input: DiagramInput): DiagramVerdict {
  throw new Error('not implemented: diagramVerdict');
}

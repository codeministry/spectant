// The diagram verdict (T38, ISC-16), ported from the old SpecStatus `diagramVerdict()`: feature, infra and project
// specs need a mermaid fence in spec.md and plan.md, a refactor only warns without one in spec.md, a complete spec
// is never held to it.
//
// Pure: text in, verdict out. No file system, no Bun API.
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

/** An opening fence line whose info string is exactly `mermaid`, backticks or tildes. */
const MERMAID = /^\s*(```|~~~)\s*mermaid\s*$/m;

/** The types that must carry a diagram in both files (SpecFormat § Diagrams). */
const REQUIRED: ReadonlySet<SpecType> = new Set(['feature', 'infra', 'project']);

export function diagramVerdict(input: DiagramInput): DiagramVerdict {
  // A complete spec is history and is never held to a rule written after it closed.
  if (input.phase === 'complete' || input.type === null) return { level: 'skip', missing: [] };
  const required = REQUIRED.has(input.type);
  if (!required && input.type !== 'refactor') return { level: 'skip', missing: [] };
  const missing: Array<'spec.md' | 'plan.md'> = [];
  if (!MERMAID.test(input.spec)) missing.push('spec.md');
  if (required && !(input.plan !== null && MERMAID.test(input.plan))) missing.push('plan.md');
  if (missing.length === 0) return { level: 'ok', missing };
  return { level: required ? 'fail' : 'warn', missing };
}

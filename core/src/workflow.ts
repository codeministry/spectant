// The workflow table `specs/workflow.md` (spec 008, ISC-122): per spec type the ordered stages and the code review.
// Seam T37 holds the signature; T42 parses the table and builds the default from STAGE_RULES, T43 checks the fixed
// gates, T44 adds `boardStages`. Browser-safe: no file system, the caller passes the text in.
import type { Workflow } from './files.ts';

/**
 * Parses `specs/workflow.md`; `text` is null when the file does not exist, and then every type runs the default
 * table (FORMAT.md § workflow).
 */
export function parseWorkflow(text: string | null): Workflow {
  // stub (spec 008, T42): no rows yet; `source` already says whether the file was there.
  return { rows: [], source: text === null ? 'default' : 'file', diagnostics: [] };
}

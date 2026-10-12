// The workflow table `specs/workflow.md` (spec 008, ISC-122): per spec type the ordered stages and the code review.
// T42 parses the table and builds the default from STAGE_RULES and TYPE_NEEDS; T43 checks the fixed gates (and the
// stage names) as `workflow-gate`, T44 adds `boardStages`. Browser-safe: no file system, the caller passes the text in.
//
// The reader never fails the file. A row it cannot use is one `workflow-…` diagnostic and its type runs the default
// row; the rows always come back one per spec type, in WORKFLOW_TYPES order, whatever order the file lists them in.
import type { Diagnostic } from './diagnostics.ts';
import type { CodeReviewMode, SpecType, Workflow, WorkflowRow, WorkflowStage } from './files.ts';
import { TABLE_SEP, tableCells } from './markdown.ts';
import { STAGE_RULES, TYPE_NEEDS } from './stage.ts';

/** The spec types in row order: FORMAT.md § workflow's default table. */
export const WORKFLOW_TYPES: readonly SpecType[] = ['feature', 'project', 'infra', 'refactor', 'bug', 'spike', 'chore'];

const CODE_REVIEW_MODES: readonly CodeReviewMode[] = ['spec', 'feature', 'none'];

/** The default code review: one mark per spec, none for a chore. */
const DEFAULT_CODE_REVIEW = (type: SpecType): CodeReviewMode => (type === 'chore' ? 'none' : 'spec');

/** The stages that exist only for a code review: a type with `code_review: none` goes from `build` to `done`. */
const CODE_REVIEW_STAGES: ReadonlySet<WorkflowStage> = new Set(['code-review', 'close']);

/**
 * A type's default row: the stage table in its order, `done` last and the `blocked` detour left out, keeping `plan`
 * and `tasks` only where TYPE_NEEDS asks for the file and the code-review stages only where the type has a review.
 */
export function defaultWorkflowRow(type: SpecType): WorkflowRow {
  const needs = TYPE_NEEDS[type];
  const codeReview = DEFAULT_CODE_REVIEW(type);
  const keep = (stage: WorkflowStage): boolean => {
    if (stage === 'blocked' || stage === 'done') return false;
    if (stage === 'plan') return needs.plan;
    if (stage === 'tasks') return needs.tasks;
    return codeReview !== 'none' || !CODE_REVIEW_STAGES.has(stage);
  };
  const stages: WorkflowStage[] = [...STAGE_RULES.map((rule) => rule.stage).filter(keep), 'done'];
  return { type, stages, codeReview };
}

/** The default table, applied when `specs/workflow.md` is missing (FORMAT.md § workflow). */
export const DEFAULT_WORKFLOW: readonly WorkflowRow[] = WORKFLOW_TYPES.map(defaultWorkflowRow);

const HEADER = ['type', 'stages', 'code_review'];
const FENCE = /^\s*(```|~~~)/;
/** A cell value without its code spans' backticks. */
const plain = (cell: string): string => cell.replace(/`/g, '').trim();

/** A row the file names for a type, before duplicates are resolved. */
interface FileRow {
  readonly row: WorkflowRow;
  readonly line: number;
}

/**
 * Parses `specs/workflow.md`; `text` is null when the file does not exist, and then every type runs the default
 * table (FORMAT.md § workflow). Diagnostics: `workflow-table` (no `| type | stages | code_review |` table outside a
 * fence, or one without its separator row), `workflow-row` (a row without exactly three cells or with an empty stage),
 * `workflow-type` (a type no spec has), `workflow-code-review` (a mode outside `spec | feature | none`) and
 * `workflow-duplicate` (a type listed twice: neither row is taken). Stage names and the fixed gates are T43.
 */
export function parseWorkflow(text: string | null): Workflow {
  if (text === null) return { rows: DEFAULT_WORKFLOW, source: 'default', diagnostics: [] };
  const diagnostics: Diagnostic[] = [];
  const warn = (code: string, message: string, line: number, subject?: string): void => {
    diagnostics.push(subject === undefined ? { severity: 'warning', code, message, line } : { severity: 'warning', code, message, line, subject });
  };

  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const header = findHeader(lines);
  const byType = new Map<SpecType, FileRow[]>();
  if (header === null) {
    warn('workflow-table', 'specs/workflow.md has no table | type | stages | code_review |; every type runs its default row.', 1);
  } else if (!TABLE_SEP.test(lines[header + 1] ?? '')) {
    warn('workflow-table', 'the workflow table has no separator row under its header; every type runs its default row.', header + 1);
  } else {
    for (let i = header + 2; i < lines.length && /^\s*\|/.test(lines[i] ?? ''); i++) {
      const parsed = parseRow(lines[i] ?? '', i + 1, warn);
      if (parsed) byType.set(parsed.row.type, [...(byType.get(parsed.row.type) ?? []), parsed]);
    }
  }

  const rows = WORKFLOW_TYPES.map((type) => {
    const found = byType.get(type) ?? [];
    for (const dup of found.slice(1)) {
      warn('workflow-duplicate', `type ${type} has more than one row; it runs its default row.`, dup.line, type);
    }
    return found.length === 1 && found[0] ? found[0].row : defaultWorkflowRow(type);
  });
  diagnostics.sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
  return { rows, source: 'file', diagnostics };
}

/** The 0-based line of the first `| type | stages | code_review |` header outside a fence; null when there is none. */
function findHeader(lines: readonly string[]): number | null {
  let fenced = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (FENCE.test(line)) fenced = !fenced;
    else if (!fenced && /^\s*\|/.test(line) && tableCells(line).map((c) => plain(c).toLowerCase()).join('|') === HEADER.join('|')) return i;
  }
  return null;
}

/** One body row, or null after its diagnostic. The stage names are kept as written; T43 checks them. */
function parseRow(text: string, line: number, warn: (code: string, message: string, line: number, subject?: string) => void): FileRow | null {
  const cells = tableCells(text).map(plain);
  if (cells.length !== HEADER.length) {
    warn('workflow-row', `a workflow row needs the three cells type, stages and code_review; it has ${cells.length}.`, line);
    return null;
  }
  const [typeCell = '', stagesCell = '', modeCell = ''] = cells;
  const type = WORKFLOW_TYPES.find((t) => t === typeCell);
  if (!type) {
    warn('workflow-type', `type ${typeCell} is none of ${WORKFLOW_TYPES.join(', ')}; the row is ignored.`, line, typeCell);
    return null;
  }
  const stages = stagesCell.split('·').map((s) => s.trim());
  if (stages.some((s) => s === '')) {
    warn('workflow-row', `the stages of type ${type} hold an empty stage; it runs its default row.`, line, type);
    return null;
  }
  const codeReview = CODE_REVIEW_MODES.find((m) => m === modeCell);
  if (!codeReview) {
    warn('workflow-code-review', `code_review ${modeCell} of type ${type} is none of ${CODE_REVIEW_MODES.join(', ')}; it runs its default row.`, line, modeCell);
    return null;
  }
  return { row: { type, stages: stages as WorkflowStage[], codeReview }, line };
}

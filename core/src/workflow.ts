// The workflow table `specs/workflow.md` (spec 008, ISC-122): per spec type the ordered stages and the code review.
// T42 parses the table; the default rows (built from STAGE_RULES and TYPE_NEEDS) live in stage.ts beside the
// transitions and the explicit stage that read them, and are re-exported here. T43 checks the fixed gates (and the
// stage names) as `workflow-gate`, T44 adds `boardStages`. Browser-safe: no file system, the caller passes the text in.
//
// The reader never fails the file. A row it cannot use is one `workflow-…` diagnostic and its type runs the default
// row; the rows always come back one per spec type, in WORKFLOW_TYPES order, whatever order the file lists them in.
import type { Diagnostic } from './diagnostics.ts';
import type { CodeReviewMode, SpecType, Workflow, WorkflowRow, WorkflowStage } from './files.ts';
import { TABLE_SEP, tableCells } from './markdown.ts';
import { DEFAULT_WORKFLOW, WORKFLOW_TYPES, defaultWorkflowRow } from './stage.ts';

export { DEFAULT_WORKFLOW, WORKFLOW_TYPES, defaultWorkflowRow };

const CODE_REVIEW_MODES: readonly CodeReviewMode[] = ['spec', 'feature', 'none'];

/**
 * Every stage core knows (`WorkflowStage`), true where a workflow row may list it. `blocked` and `close-pending` are
 * detours every type has and no row lists; `idea` is a story's stage, before a spec exists. A Record, so a stage
 * added to `WorkflowStage` fails to compile here until it is placed.
 */
const ROW_STAGE: Readonly<Record<WorkflowStage, boolean>> = {
  idea: false,
  plan: true,
  tasks: true,
  review: true,
  build: true,
  blocked: false,
  'close-pending': false,
  'code-review': true,
  close: true,
  done: true,
};

/** The fixed gates (FORMAT.md § workflow): in every row, each exactly once, `review` before `build`, `done` last. */
const FIXED_GATES: readonly WorkflowStage[] = ['review', 'build', 'done'];

const knownStage = (stage: string): stage is WorkflowStage => Object.hasOwn(ROW_STAGE, stage);

/**
 * The first fixed-gate violation of a row's stages as a phrase, or null when the row keeps every gate. A violation is
 * a stage no row may list (unknown to core, or a detour), any stage listed twice, a fixed gate left out, `review`
 * after `build`, or a stage after `done`. The optional stages may be left out or reordered freely.
 */
function gateViolation(stages: readonly string[]): string | null {
  const foreign = stages.find((s) => !knownStage(s) || !ROW_STAGE[s]);
  if (foreign !== undefined) {
    return knownStage(foreign) ? `list ${foreign}, a detour no workflow row lists` : `list ${foreign}, a stage core does not know`;
  }
  const twice = stages.find((s, i) => stages.indexOf(s) !== i);
  if (twice !== undefined) return `list ${twice} twice`;
  const missing = FIXED_GATES.find((gate) => !stages.includes(gate));
  if (missing !== undefined) return `leave out the fixed gate ${missing}`;
  if (stages.indexOf('review') > stages.indexOf('build')) return 'put the fixed gate review after build';
  const last = stages.at(-1) ?? '';
  if (last !== 'done') return `list ${last} after the fixed gate done`;
  return null;
}

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
 * `workflow-duplicate` (a type listed twice: neither row is taken) and `workflow-gate` (T43: a type's one row moves a
 * fixed gate or lists a stage no row may list, see `gateViolation`). A duplicated type is `workflow-duplicate` only:
 * neither of its rows is taken, so neither is gate-checked.
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
    const only = found.length === 1 ? found[0] : undefined;
    if (!only) return defaultWorkflowRow(type);
    const violation = gateViolation(only.row.stages);
    if (violation === null) return only.row;
    warn('workflow-gate', `the stages of type ${type} ${violation}; it runs its default row.`, only.line, type);
    return defaultWorkflowRow(type);
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

/** One body row, or null after its diagnostic. The stage names are kept as written; `gateViolation` checks them. */
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

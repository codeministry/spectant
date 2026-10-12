/**
 * The Stage-3 board seam of the stub `/api` (spec 008, T119, ISC-129): the pieces `stub-api.ts` serves the board, the
 * story page and the two board writes with. Nothing here parses the spec format: the planning tree is the golden
 * (`core/fixtures/<golden>.planning.golden.json`), a story page is core's `renderDocsMarkdown` over the fixture's own
 * story file (as `server/src/api.ts` renders it), the moves a workflow row lists are core's `rowTransitions`, and the
 * commands are core's stage table (`SPEC_RULES`). Core is loaded at runtime by a computed path, as in `stub-api.ts`,
 * because its module graph does not type-check under the web/e2e tsconfig; the shapes used are declared below.
 *
 * The in-memory mutations are pure: every function returns a new `PlanningModel` and leaves the golden untouched.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import type { ClaimLock, DocName, DocsPage, IdeaRef, SpecType, Workflow, WorkflowRow, WorkflowStage } from '../../core/src/files';
import type { PlanningHolder, PlanningModel } from '../../core/src/planning';

/** A stage a spec can stand in: every `WorkflowStage` but `idea`, which only a story holds. */
export type SpecStage = NonNullable<PlanningHolder['stage']>;

/** Core's options for one Docs page render (`core/src/markdown-docs.ts` `DocsOptions`), opaque here. */
type DocsOptions = Readonly<Record<string, unknown>>;

export type BoardCore = {
  renderDocsMarkdown: (markdown: string, options?: DocsOptions) => DocsPage;
  docsRenderOptions: (root: string, docPath: string, name: DocName) => DocsOptions;
  rowTransitions: (row: WorkflowRow) => ReadonlyArray<{ from: WorkflowStage; to: WorkflowStage }>;
  defaultWorkflowRow: (type: SpecType) => WorkflowRow;
  SPEC_RULES: ReadonlyArray<{ stage: string; next: string | null }>;
  /** `server/src/writes.contract.ts`: the 409 bodies, the 423 choice, the allocation paths, the fallback actor. */
  specConflict: (sent: string, now: string) => StaleBody | null;
  ideaConflict: (path: string, sent: string, now: string) => StaleBody | null;
  blockingLock: (locks: readonly ClaimLock[], claim: string | null) => { error: 'locked'; lock: ClaimLock } | null;
  writePathsOf: (op: 'allocate', folder: string, slug: string) => { writes: readonly string[]; removes: readonly string[] };
  VIEWER_ACTOR_FALLBACK: string;
};

/** A write's 409 `hash-mismatch` (`StaleSpec`, `StaleIdea`): the file named and its raw hash now. */
export type StaleBody = { error: 'hash-mismatch'; files: readonly string[]; expected: Readonly<Record<string, string>> };

/** Core's renderer, the docs options, the stage table and the write contract's helpers, loaded by a computed path (see the header). */
export function loadBoardCore(): BoardCore {
  const load = createRequire(import.meta.url);
  const src = join(import.meta.dir, '..', '..', 'core', 'src');
  const docs = load(join(src, 'markdown-docs.ts')) as Pick<BoardCore, 'renderDocsMarkdown'>;
  const evidence = load(join(src, 'evidence.ts')) as Pick<BoardCore, 'docsRenderOptions'>;
  const stage = load(join(src, 'stage.ts')) as Pick<BoardCore, 'rowTransitions' | 'defaultWorkflowRow' | 'SPEC_RULES'>;
  const writes = load(join(import.meta.dir, '..', '..', 'server', 'src', 'writes.contract.ts')) as Pick<
    BoardCore,
    'specConflict' | 'ideaConflict' | 'blockingLock' | 'writePathsOf' | 'VIEWER_ACTOR_FALLBACK'
  >;
  return { ...docs, ...evidence, ...stage, ...writes };
}

/** One story of the fixture tree: the planning golden's `IdeaRef`, the file's bytes as text, its raw sha256, the page. */
export type StoryFile = { idea: IdeaRef; hash: string; page: DocsPage };

/** The raw sha256 hex of a file's bytes, as `server/src/writes.ts` `rawSha256` hashes it. */
export const rawSha256 = (bytes: Uint8Array | string): string => new Bun.CryptoHasher('sha256').update(bytes).digest('hex');

/**
 * Every story the planning golden lists, read from the fixture tree once: the page as `GET …/ideas/:slug` renders it
 * (a Docs tab that is not the Design tab, images confined to the workspace) and the hash `allocate` compares.
 */
export function readStories(core: BoardCore, root: string, planning: PlanningModel): ReadonlyMap<string, StoryFile> {
  return new Map(
    planning.ideas.map((idea): [string, StoryFile] => {
      const path = join(root, idea.path);
      let bytes: Buffer;
      try {
        bytes = readFileSync(path);
      } catch {
        throw new Error(`stub-api: no story file ${idea.path} in the fixture tree`);
      }
      const page = core.renderDocsMarkdown(bytes.toString('utf8'), core.docsRenderOptions(root, path, 'plan'));
      return [idea.slug, { idea, hash: rawSha256(bytes), page }];
    }),
  );
}

/** The first holder entry of an active spec folder (`NNN-slug`) in the tree: a feature's, else a milestone's. */
export function holderOf(model: PlanningModel, slug: string): PlanningHolder | null {
  for (const feature of model.features) {
    const found = feature.holders.find((h) => h.slug === slug);
    if (found) return found;
  }
  for (const milestone of model.milestones) {
    const found = milestone.specs.find((h) => h.slug === slug);
    if (found) return found;
  }
  return null;
}

/** `stageCounts` with one spec or story moved from `from` to `to`; a stage the board has no column for counts nowhere. */
function recounted(counts: PlanningModel['stageCounts'], from: WorkflowStage | null, to: WorkflowStage): PlanningModel['stageCounts'] {
  const next: Partial<Record<WorkflowStage, number>> = { ...counts };
  if (from !== null && typeof next[from] === 'number') next[from] = Math.max(0, (next[from] ?? 0) - 1);
  if (typeof next[to] === 'number') next[to] = (next[to] ?? 0) + 1;
  return next;
}

/**
 * The tree after a stage move of the spec folder `slug`: every holder entry of it (each feature it holds claims of and
 * its milestone) at `to`, `stageSource: explicit` (the move writes `stage:`), `hash` the new raw hash, and the column
 * counts recounted. The golden is never touched.
 */
export function movedPlanning(model: PlanningModel, slug: string, from: WorkflowStage, to: SpecStage, hash: string): PlanningModel {
  const move = (h: PlanningHolder): PlanningHolder => (h.slug === slug ? { ...h, stage: to, stageSource: 'explicit', hash } : h);
  return {
    ...model,
    stageCounts: recounted(model.stageCounts, from, to),
    features: model.features.map((f) => ({ ...f, holders: f.holders.map(move) })),
    milestones: model.milestones.map((m) => ({ ...m, specs: m.specs.map(move) })),
  };
}

const byHolderOrder = (a: PlanningHolder, b: PlanningHolder): number =>
  a.archived === b.archived ? a.id.localeCompare(b.id, 'en', { numeric: true }) : a.archived ? 1 : -1;

/**
 * The tree after a story became the spec `holder` (the allocation): the story gone from `ideas`, from its feature's and
 * from its milestone's; the new spec at `plan` (what `allocationOf` writes) under the story's feature (`main`, `held:
 * 0`) and in its milestone's `specs` (`main: false`); `idea` counts one less and `plan` one more.
 *
 * Divergence, on purpose: the real `buildPlanning` lists a feature holder only with `held > 0`, so a claimless new
 * spec shows on the real server in its milestone and `stageCounts` alone. The stub adds it under the feature too, so
 * the board's card has a row to land in until the board names where a claimless spec goes.
 */
export function allocatedPlanning(model: PlanningModel, story: IdeaRef, holder: PlanningHolder): PlanningModel {
  const keep = (ideas: readonly IdeaRef[]): IdeaRef[] => ideas.filter((i) => i.slug !== story.slug);
  return {
    ...model,
    stageCounts: recounted(model.stageCounts, 'idea', 'plan'),
    ideas: keep(model.ideas),
    features: model.features.map((f) => ({
      ...f,
      ideas: keep(f.ideas),
      holders: f.id === story.feature ? [...f.holders, { ...holder, main: true, held: 0 }].sort(byHolderOrder) : f.holders,
    })),
    milestones: model.milestones.map((m) => ({
      ...m,
      ideas: keep(m.ideas),
      specs: m.name === story.milestone ? [...m.specs, { ...holder, main: false, held: 0 }].sort(byHolderOrder) : m.specs,
    })),
  };
}

/** The workflow row a spec type runs: its own, else core's default; an untyped spec runs the `feature` row. */
export function rowFor(core: BoardCore, workflow: Workflow, type: SpecType | null): WorkflowRow {
  const wanted: SpecType = type ?? 'feature';
  return workflow.rows.find((r) => r.type === wanted) ?? core.defaultWorkflowRow(wanted);
}

/**
 * Why the stub refuses `from → to` (the 422 `transition-refused` reason), or null when the row allows it. The stub
 * models the workflow's table only, with the phrases of core's `planTransition` for the same two refusals: the spec
 * already there, and a move the row does not list (the `close-pending` entry under `code_review: feature` included).
 * The fixed gates (a fresh reviewed mark, every claim closed, an open sibling) are not modelled.
 */
export function refusalOf(core: BoardCore, row: WorkflowRow, type: SpecType | null, from: WorkflowStage, to: WorkflowStage): string | null {
  if (from === to) return `the spec already stands in ${to}`;
  const listed = (a: WorkflowStage, b: WorkflowStage): boolean => core.rowTransitions(row).some((p) => p.from === a && p.to === b);
  const allowed = listed(from, to) || (to === 'close-pending' && row.codeReview === 'feature' && listed(from, 'code-review'));
  return allowed ? null : `the ${type ?? 'untyped'} workflow lists no move ${from} → ${to}`;
}

/** The stage table's command for a stage, with the spec number (`planTransition`'s `commandOf`); null where none. */
export function commandFor(core: BoardCore, stage: WorkflowStage, number: string): string | null {
  const next = core.SPEC_RULES.find((r) => r.stage === stage && r.next !== null)?.next;
  return next === undefined || next === null ? null : `${next} ${number}`;
}

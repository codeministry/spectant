/**
 * The Stage-3 board seam of the stub `/api` (spec 008, T119, ISC-129), and the worktree overlay of spec 027 (T33, at the end): the pieces `stub-api.ts` serves the board, the
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

import type {
  ClaimLock,
  DocName,
  DocsPage,
  IdeaRef,
  LiveCard,
  LiveFrame,
  LiveRound,
  MainCopy,
  Priority,
  RunCounts,
  RunState,
  SpecPageModel,
  SpecSource,
  SpecType,
  SpecWarning,
  TaskRun,
  TimelineEntry,
  TimelineWorktreeInput,
  WarningKind,
  Workflow,
  WorkflowRow,
  WorkflowStage,
  Worktree,
} from '../../core/src/files';
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
  /** `server/src/writes.contract.ts` and `core/src/backlog.ts` (spec 036): the backlog write's 409 and its plan. */
  backlogConflict: (sent: string, now: string) => StaleBody | null;
  backlogFeatures: (master: string) => ReadonlyArray<{ id: string; milestone: string | null }>;
  planBacklogMove: (input: BacklogPlanInput & { before: string | null }) => BacklogPlanResult;
  planBacklogPriority: (input: BacklogPlanInput & { priority: string }) => BacklogPlanResult;
  parseBacklog: (text: string | null, featureIds: readonly string[]) => { entries: ReadonlyArray<{ feature: string; rank: number; priority: Priority }> };
};

/** What core's backlog planners take (`core/src/backlog.ts`), opaque past the fields the stub passes. */
type BacklogPlanInput = {
  text: string | null;
  features: ReadonlyArray<{ id: string; milestone: string | null }>;
  feature: string;
  actor: string;
  now: Date;
};
/** Core's `BacklogPlan`: the new text and its event, or the reason. */
export type BacklogPlanResult = { ok: true; text: string; event: Readonly<Record<string, unknown>> } | { ok: false; reason: string };

/** A write's 409 `hash-mismatch` (`StaleSpec`, `StaleIdea`): the file named and its raw hash now. */
export type StaleBody = { error: 'hash-mismatch'; files: readonly string[]; expected: Readonly<Record<string, string>> };

/**
 * The planning tree with a session's `specs/backlog.md` applied as core's `buildPlanning` applies it (spec 036): every
 * feature's rank and priority from `parseBacklog` over the master's feature ids, then the features, each milestone's
 * shares and `featureIds` and the no-milestone group re-sorted by rank. A backlog write moves nothing but ranks and
 * priorities, so the next read shows it as the real route does without rebuilding the tree (spec 037, T26).
 */
export function withBacklogText(core: Pick<BoardCore, 'parseBacklog'>, model: PlanningModel, text: string | null, masterIds: readonly string[]): PlanningModel {
  const place = new Map(core.parseBacklog(text, masterIds).entries.map((entry) => [entry.feature, entry]));
  const rank = (id: string): number => place.get(id)?.rank ?? Infinity;
  const byRank = (a: string, b: string): number => rank(a) - rank(b);
  const features = model.features
    .map((feature) => ({ ...feature, rank: rank(feature.id), priority: place.get(feature.id)?.priority ?? feature.priority }))
    .sort((a, b) => a.rank - b.rank);
  const milestones = model.milestones.map((milestone) => ({
    ...milestone,
    features: [...milestone.features].sort((a, b) => byRank(a.id, b.id)),
    ...(milestone.featureIds === undefined ? {} : { featureIds: [...milestone.featureIds].sort(byRank) }),
  }));
  const unassigned = model.unassignedFeatures === undefined ? {} : { unassignedFeatures: [...model.unassignedFeatures].sort(byRank) };
  return { ...model, features, milestones, ...unassigned };
}

/** Core's renderer, the docs options, the stage table and the write contract's helpers, loaded by a computed path (see the header). */
export function loadBoardCore(): BoardCore {
  const load = createRequire(import.meta.url);
  const src = join(import.meta.dir, '..', '..', 'core', 'src');
  const docs = load(join(src, 'markdown-docs.ts')) as Pick<BoardCore, 'renderDocsMarkdown'>;
  const evidence = load(join(src, 'evidence.ts')) as Pick<BoardCore, 'docsRenderOptions'>;
  const stage = load(join(src, 'stage.ts')) as Pick<BoardCore, 'rowTransitions' | 'defaultWorkflowRow' | 'SPEC_RULES'>;
  const writes = load(join(import.meta.dir, '..', '..', 'server', 'src', 'writes.contract.ts')) as Pick<
    BoardCore,
    'specConflict' | 'ideaConflict' | 'blockingLock' | 'writePathsOf' | 'VIEWER_ACTOR_FALLBACK' | 'backlogConflict'
  >;
  const backlog = load(join(src, 'backlog.ts')) as Pick<BoardCore, 'backlogFeatures' | 'planBacklogMove' | 'planBacklogPriority' | 'parseBacklog'>;
  return { ...docs, ...evidence, ...stage, ...writes, ...backlog };
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

// ---- the worktree overlay (spec 027, T33: ISC-175, ISC-175.1, ISC-179, ISC-181) -----------------------------------
//
// What the worktree live view shows on top of a golden, for the e2e suites that send `X-Spectant-Stub-Worktrees: on`
// (`worktree -g chip|tasks`, the timeline, offline). The fixture trees have no git, so the goldens hold no worktree,
// no run but harbor 002's two and no `worktree` timeline entry; the stub lays these facts over the harbor goldens when
// it is built, in memory only. Each fact has the shape core emits for it, typed by core's own types, so a drifted shape
// fails the typecheck. Under `off` (the default) nothing here applies, and every other suite and the parity half see
// the goldens unchanged.

/** The fixture tree the overlay belongs to. */
export const OVERLAY_GOLDEN = 'harbor';

/**
 * Per spec number, the worktree its dashboard row and spec head carry, as `assignWorktrees` assigns it: 002 dirty and
 * two commits ahead of `main`, 009 clean with nothing ahead, 003 on another spec's branch (the path wins, `STUB_MISMATCH`).
 * Every other spec: null, and no chip.
 */
export const STUB_WORKTREES: Readonly<Record<string, Worktree>> = {
  '002': { path: '.worktrees/002-web-console', branch: 'feature/002-web-console', spec: '002', ahead: 2, dirty: true, kind: 'spec' },
  '003': { path: '.worktrees/003-config-loader', branch: 'feature/005-config-format-choice', spec: '003', ahead: 1, dirty: false, kind: 'spec' },
  '009': { path: '.worktrees/009-chunked-upload-limits', branch: 'feature/009-chunked-upload-limits', spec: '009', ahead: 0, dirty: false, kind: 'spec' },
};

/** The one `worktree-branch-mismatch` (ISC-174.1): the worktree of spec 003 is on the branch of spec 005. */
export const STUB_MISMATCH = { spec: '003', branchSpec: '005' } as const;

/** The row warning core's dashboard makes of the mismatch: `assignWorktrees`' sentence (`worktrees.ts`), the path as `ref`. */
export function mismatchWarning(worktree: Worktree, branchSpec: string): SpecWarning {
  return {
    kind: 'worktree-branch-mismatch',
    text:
      `Worktree ${worktree.path ?? ''} is on branch ${worktree.branch ?? ''}, which names spec ${branchSpec}; ` +
      `its path names spec ${worktree.spec ?? ''}, and the path wins.`,
    ...(worktree.path === null ? {} : { ref: worktree.path }),
  };
}

/** Per spec number, the main checkout's copy beside a spec read from its worktree copy (`source: 'worktree'`, ISC-181). */
export const STUB_MAIN_COPIES: Readonly<Record<string, MainCopy>> = {
  '002': { stage: 'build', progress: { closed: 23, total: 30 } },
};

/**
 * Per spec number, the runs laid on its live frame (ISC-179.1). Harbor 002's golden has T26 `applied` and T28
 * `applied-open`; these add the three states it lacks, so every state is on screen: T27 `patched` (its session still
 * holds the claim), T29 `building` (its builder asked a question), T32 `dispatched`.
 */
export const STUB_RUNS: Readonly<Record<string, readonly TaskRun[]>> = {
  '002': [
    { task: 'T27', state: 'patched', session: 'a:claude:sess-2/T27', worktree: 'wt-7', ts: '2026-03-08T14:50:00Z' },
    { task: 'T29', state: 'building', session: 'a:claude:sess-2/T29', worktree: 'wt-10', ts: '2026-03-08T14:40:00Z' },
    { task: 'T32', state: 'dispatched', session: 'a:claude:sess-2/T32', worktree: 'wt-12', ts: '2026-03-08T14:55:00Z' },
  ],
};

/**
 * Per spec number, the git state of its worktree as the timeline's join reads it (ISC-175.1): 007's branch merged into
 * `main` between two of its dated entries, 006's worktree removed while its branch is not merged.
 */
export const STUB_TIMELINE_WORKTREES: Readonly<Record<string, TimelineWorktreeInput>> = {
  '007': {
    merged: { at: '2026-03-09T08:45:00Z', commit: '4f1c2ab9e07d' },
    removed: false,
    branch: 'feature/007-rotate-mirror-token',
    path: '.worktrees/007-rotate-mirror-token',
  },
  '006': { merged: null, removed: true, branch: 'feature/006-partial-push', path: '.worktrees/006-partial-push' },
};

/** The worktree facts of one spec number: its worktree, where it is read, the main copy and the mismatch warning. */
export function worktreeFacts(id: string): { worktree: Worktree | null; source: SpecSource; main: MainCopy | null; warning: SpecWarning | null } {
  const worktree = STUB_WORKTREES[id] ?? null;
  const main = STUB_MAIN_COPIES[id] ?? null;
  const warning = worktree !== null && id === STUB_MISMATCH.spec ? mismatchWarning(worktree, STUB_MISMATCH.branchSpec) : null;
  return { worktree, source: main === null ? 'main' : 'worktree', main, warning };
}

type OverlayRow = Readonly<Record<string, unknown>> & { readonly id: string; readonly warnings: readonly SpecWarning[] };
type OverlayGroup = { readonly kind: WarningKind; readonly items: ReadonlyArray<{ readonly spec: string; readonly warning: SpecWarning }> };
/** The part of core's `DashboardModel` the overlay touches (`dashboard.ts` does not type-check under this tsconfig). */
type OverlayModel = {
  readonly kpis: Readonly<Record<string, unknown>> & { readonly warnings: number; readonly attention: number };
  readonly specs: readonly OverlayRow[];
  readonly warningGroups: readonly OverlayGroup[];
};

/**
 * A dashboard model with the worktree facts on its rows (`worktree`, `source`, `main`, the mismatch warning last), the
 * mismatch group last in the warnings panel (`WARNING_ORDER` ends with it) and the counts (`warnings`, `attention`)
 * raised by it. The model passed in is never touched.
 */
export function overlaidDashboard(model: unknown): unknown {
  const base = model as OverlayModel;
  const items: Array<{ spec: string; warning: SpecWarning }> = [];
  const specs = base.specs.map((row): OverlayRow => {
    const facts = worktreeFacts(row.id);
    if (facts.warning !== null) items.push({ spec: row.id, warning: facts.warning });
    const warnings = facts.warning === null ? row.warnings : [...row.warnings, facts.warning];
    return { ...row, warnings, worktree: facts.worktree, source: facts.source, main: facts.main };
  });
  if (items.length === 0) return { ...base, specs };
  const kpis = { ...base.kpis, warnings: base.kpis.warnings + items.length, attention: base.kpis.attention + items.length };
  return { ...base, kpis, specs, warningGroups: [...base.warningGroups, { kind: 'worktree-branch-mismatch', items }] };
}

/** A spec page with its row's worktree facts in the head, the mismatch warning last, and the status counts raised. */
export function overlaidPage(page: SpecPageModel, id: string, addedEntries: number): SpecPageModel {
  const facts = worktreeFacts(id);
  const warnings = facts.warning === null ? page.warnings : [...page.warnings, facts.warning];
  const status = page.areas.status;
  return {
    ...page,
    head: { ...page.head, worktree: facts.worktree, source: facts.source, main: facts.main },
    warnings,
    areas: {
      ...page.areas,
      status: { ...status, timelineEntries: status.timelineEntries + addedEntries, warnings: status.warnings + (facts.warning === null ? 0 : 1) },
    },
  };
}

/** Core's `worktreeEntry` (`timeline.ts`) with the id `withId` gives it, keys in core's order; null for an open branch. */
export function worktreeEntry(input: TimelineWorktreeInput): TimelineEntry | null {
  const branch = input.branch ?? null;
  const path = input.path ?? null;
  if (input.merged) {
    const commit = input.merged.commit ? input.merged.commit.slice(0, 7) : null;
    const title = branch ? `Merged into main · ${branch}` : 'Merged into main';
    return { ts: input.merged.at, kind: 'worktree', derived: true, title, ref: 'merged', id: 'worktree-merged', actor: null, worktree: { state: 'merged', branch, path, commit } };
  }
  if (!input.removed) return null;
  const title = path ? `Worktree removed · ${path}` : 'Worktree removed';
  const worktree = { state: 'removed', branch, path, commit: null } as const;
  return { ts: '', kind: 'worktree', derived: true, title, ref: 'removed', id: 'worktree-removed', actor: null, undated: true, worktree };
}

/**
 * The timeline (newest first) with the worktree entry where core's sort puts it: `merged` at its own instant, after
 * every other kind of that instant; `removed` at the newest instant of the timeline, after every entry of it.
 */
export function withWorktreeEntry(timeline: readonly TimelineEntry[], input: TimelineWorktreeInput): TimelineEntry[] {
  const entry = worktreeEntry(input);
  if (entry === null) return [...timeline];
  const dated = timeline.filter((e) => e.ts !== '').map((e) => Date.parse(e.ts));
  const at = entry.undated === true ? Math.max(...dated) : Date.parse(entry.ts);
  const index = Number.isFinite(at) ? timeline.findIndex((e) => e.ts !== '' && Date.parse(e.ts) < at) : -1;
  return index === -1 ? [...timeline, entry] : [...timeline.slice(0, index), entry, ...timeline.slice(index)];
}

/** Core's round states (`live.ts` `ROUND_STATES`), in run order. */
const ROUND_STATES: readonly RunState[] = ['dispatched', 'building', 'patched', 'applied-open'];

/** Core's `roundOf` (`live.ts`): the cards with a run whose task tasks.md has not ticked, furthest along first. */
export function roundOf(cards: readonly LiveCard[], ticked: ReadonlySet<string>, round: number): LiveRound {
  const inRound = cards.filter((c) => c.run && !ticked.has(c.task));
  const counts = (of: readonly LiveCard[]): RunCounts =>
    Object.fromEntries(ROUND_STATES.map((s) => [s, of.filter((c) => c.run?.state === s).length] as const).filter(([, n]) => n > 0));
  const lanes = [...new Set(inRound.map((c) => c.lane))];
  return {
    round: inRound.length === 0 ? null : round,
    cards: [...ROUND_STATES].reverse().flatMap((s) => inRound.filter((c) => c.run?.state === s)),
    lanes: Object.fromEntries(lanes.map((lane) => [lane, counts(inRound.filter((c) => c.lane === lane))])),
    total: counts(inRound),
  };
}

/**
 * A live frame with `runs` laid on its cards by task (`run` stays the card's last key, as core writes it; an `absent`
 * card takes none), on the needs-you copies of those cards, and the round group redone. The frame passed in is never
 * touched; with no run to lay it is returned as it is.
 */
export function withRuns(live: LiveFrame, runs: ReadonlyMap<string, TaskRun>, ticked: ReadonlySet<string>): LiveFrame {
  if (runs.size === 0) return live;
  const lay = (card: LiveCard): LiveCard => {
    const run = runs.get(card.task);
    return run === undefined || card.state === 'absent' ? card : { ...card, run };
  };
  const cards = live.cards.map(lay);
  return { ...live, cards, needsYou: live.needsYou.map(lay), inRound: roundOf(cards, ticked, live.inRound?.round ?? (live.round ?? 0) + 1) };
}

/** The run chain `POST /api/__stub/bump-run` walks: one run event per call (`dispatch`, `build`, `patch`, `apply`). */
const RUN_CHAIN: readonly RunState[] = ['dispatched', 'building', 'patched', 'applied-open'];

/**
 * A task's run `steps` run events on: none → dispatched → building → patched → applied-open, `applied` when tasks.md
 * has ticked the task; the last state stays. The same run object when nothing moves, so the frame's ETag holds.
 */
export function advancedRun(run: TaskRun | null, task: string, steps: number, ticked: boolean, ts: string): TaskRun | null {
  const last = RUN_CHAIN.length - 1;
  const from = run === null ? -1 : run.state === 'applied' ? last : RUN_CHAIN.indexOf(run.state);
  const to = Math.min(from + steps, last);
  if (to <= from) return run;
  const state: RunState = to === last && ticked ? 'applied' : (RUN_CHAIN[to] ?? 'dispatched');
  return { task, state, session: run?.session ?? `a:claude:sess-2/${task}`, worktree: run?.worktree ?? `wt-${task.slice(1)}`, ts };
}

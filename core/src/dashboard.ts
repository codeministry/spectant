// The dashboard model (T39, ISC-16): the seam between `core/`, `server/` and `web/`. The server returns it from
// `GET /api/workspaces/:slug/dashboard` (plan.md § Interfaces), the web app renders it, and each fixture's golden
// snapshot is one of these. It never carries an absolute path: a workspace is its slug, a spec its id and folder name,
// a file a path relative to the repository root (ISC-3).
//
// `buildDashboard` is pure over text the caller read, and composes the other modules only; it parses nothing itself.
// The chain per spec, as the old SpecDashboard `collect()` ran it: frontmatter and claims → partitionClaims → the two
// gate marks → stage and next command → driftReport against the master → diagramVerdict → warnings. Then the TL;DR
// state, the archive listing, the KPIs and the rows in action order. Malformed input becomes a FileDiagnostic, never
// a throw. Spec 025 adds the spec edges' warnings across rows: the edge diagnostics as `spec-edge` and, read from the
// plans' `## Affected Files and Modules` and the tasks' path columns, a `spec-overlap` per pair of open specs that
// change the same file without an edge between them (ISC-164).
//
// The web app imports this file's types only (`import type`, and the barrel re-exports types only), so the runtime
// imports below (gates hashing through `node:crypto`, for one) never reach the browser bundle.
import { listArchive, specTitle } from './archive.ts';
import type { ArchivedSpec } from './archive.ts';
import { assigneeOf } from './assignee.ts';
import { parseClaims } from './claims.ts';
import type { ClaimsDocument } from './claims.ts';
import type { Diagnostic } from './diagnostics.ts';
import { diagramVerdict } from './diagrams.ts';
import { closedAtOf, parseEvents } from './events.ts';
import type { DiagramVerdict } from './diagrams.ts';
import { specFilePath } from './files.ts';
import type {
  ActorRef,
  AgentLockSource,
  ClaimLock,
  FileDiagnostic,
  FileKind,
  GateView,
  Guidance,
  IdeaFiles,
  ItemStateInfo,
  LockDiagnostic,
  LockReading,
  MainCopy,
  MergeState,
  OpenRun,
  Priority,
  ProbeResult,
  RunEvent,
  RepoFileSource,
  SpecFiles,
  SpecGates,
  SpecRead,
  SpecSource,
  SpecEdge,
  SpecOverlap,
  SpecType,
  SpecWait,
  SpecWarning,
  StageSource,
  WarningKind,
  Workflow,
  WorkflowStage,
  Worktree,
} from './files.ts';
import { parseFrontmatter } from './frontmatter.ts';
import type { Progress } from './frontmatter.ts';
import { gateState, readGateMark, reviewedGate } from './gates.ts';
import { readIdeas } from './ideas.ts';
import type { GateCheck, GateMarkReading, GateName, ReviewedFile } from './gates.ts';
import { TABLE_SEP, tableCells } from './markdown.ts';
import { resolveEdges } from './spec-edges.ts';
import type { ResolvedSpecEdges } from './spec-edges.ts';
import { runSpecOf, specIdOf } from './spec-ref.ts';
import { codeReviewOf, commandFor, commandKey, isWorkflowStage, pluginCommand, nextCommandWithReason, reasonOf, stageMismatchOf } from './stage.ts';
import type { Stage, StageInput } from './stage.ts';
import { driftReport, hasDrift, heldLocks, mainFeatureOf, masterProgressMismatch, partitionClaims, specEdgeHolds } from './status.ts';
import type { DriftClass, DriftReport } from './status.ts';
import { parseTaskLines } from './tasks.ts';
import { parseTldr, tldrState } from './tldr.ts';
import type { WorktreeAssignment } from './worktrees.ts';

import type { DashboardKpis, StageGroup } from './dashboard-kpis.ts';
export type { StageGroup } from './dashboard-kpis.ts';

/** The stage groups in lifecycle order, the order the tile's split and the filter's chips list them in. */
export const STAGE_GROUPS: readonly StageGroup[] = ['scoping', 'building', 'complete'];

export type { DashboardKpis } from './dashboard-kpis.ts';

/**
 * A claim of the spec a session holds, as the live frame names it (spec 002 T115, ISC-90): from the same lock reading and
 * the same selection (status.ts `heldLocks`), so the board and the row never disagree on the session.
 */
export interface DashboardTakenClaim {
  /** The claim ID, `ISC-74`. */
  readonly id: string;
  /** The session name the lock carries. */
  readonly session: string;
  /** ISO 8601: when the lock was taken. */
  readonly since: string;
  /** Where the lock was read: a LifeOS frontier lock file or `.spectant/activity.jsonl`. */
  readonly source: AgentLockSource;
}

/** One active spec, as a row of the Specs panel and an entry of Next up. */
export interface DashboardSpecRow {
  /** The folder's numeric prefix (`specIdOf`), `NNN` for every folder the loader lists; the whole folder name when it has none. */
  readonly id: string;
  /** `NNN-slug`. */
  readonly slug: string;
  /** Frontmatter `task:`, falling back to the slug without its number. */
  readonly title: string;
  readonly type: SpecType | null;
  /** ISO 8601 of the last transition to `done` in the spec's events.jsonl (`closedAtOf`); null otherwise (spec 071, ISC-592). */
  readonly closedAt: string | null;
  /** Frontmatter `priority:`, `P3` when absent or invalid (T39); the spec head carries the same value (T67, ISC-118). */
  readonly priority: Priority;
  /** The main feature, the first word of frontmatter `isa_feature:` (`F<n>`); null when the spec names none. */
  readonly feature: string | null;
  /** The master block's heading after `F<n> ·` (`FeatureBlock.name`); null without `feature` or a block of that id. */
  readonly featureName: string | null;
  /** Frontmatter `milestone:` as written; null when the spec belongs to no milestone. */
  readonly milestone: string | null;
  /** Frontmatter `phase:` as written: a tooltip only, the stage is derived. */
  readonly phase: string | null;
  readonly stage: Stage;
  /**
   * The stage group of `stage` (spec 021, ISC-245): what the spec list filters by and the Specs tile's split counts,
   * one derivation for both (`stageGroupOf`).
   */
  readonly stageGroup: StageGroup;
  /** Whether `stage` is the frontmatter `stage:` (`explicit`) or the stage table's (`derived`), T47. */
  readonly stageSource: StageSource;
  /** Live claims, closed over total. */
  readonly progress: Progress;
  /** Null when the spec has no tasks.md. */
  readonly tasks: { readonly landed: number; readonly total: number } | null;
  /** E.g. `/spec implement 002`; null for a complete spec. */
  readonly nextCommand: string | null;
  /** Why that command is next, one phrase (e.g. `ISC-334 is takeable`). */
  readonly nextReason: string;
  /** Claim IDs takeable now. */
  readonly takeable: readonly string[];
  /** Claims of this spec a lock holds, one entry per claim, in claim-ID order; empty without locks. Additive (T115). */
  readonly taken: readonly DashboardTakenClaim[];
  /**
   * Who the spec is assigned to (spec 008, T65, ISC-131, `assigneeOf` in `assignee.ts`): the actor of the newest lock
   * on one of its claims, else the actor of its last event, else null. The spec head carries the same value.
   */
  readonly assignee: ActorRef | null;
  readonly warnings: readonly SpecWarning[];
  readonly gates: SpecGates;
  readonly fog: number;
  /** Frontmatter `updated:`. */
  readonly updated: string | null;
  /** ISO 8601 of the newest `rounds.jsonl` line; null without rounds. */
  readonly lastRound: string | null;
  /** The first prose paragraph under `## Goal`, on one line. */
  readonly goal: string;
  /**
   * The spec's worktree with the git facts of its chip, branch, `ahead` and `dirty` (spec 027, T12, ISC-175): the first
   * worktree of kind `spec` that `DashboardInput.worktrees` assigns to this spec, in git's order; null without one, and
   * then no chip. Additive: null on every row of an input without worktrees.
   */
  readonly worktree: Worktree | null;
  /** Where the row's files were read (`SpecRead.source`, ISC-181); `main` unless the server read its worktree copy. */
  readonly source: SpecSource;
  /**
   * The main checkout's stage and claim progress beside the worktree copy's (the source note, ISC-181), computed from
   * `SpecRead.main` with the workspace's tree; null unless `source` is `worktree` and the main copy has a spec.md.
   */
  readonly main: MainCopy | null;
  /**
   * What the spec waits on (spec 025, ISC-163): its row of `resolveEdges(…).waits` while at least one open spec edge
   * holds open work, the web's `waits on NNN` on the row, the board card and the spec head; null when nothing waits,
   * so the display goes once the edge is met. Additive: null on every row of a workspace without spec edges.
   */
  readonly waits: SpecWait | null;
  /**
   * The spec's own item state with its details (spec 040, ISC-224): `open`, `waiting`, `running`, `aborted` or `done`,
   * set by item-state.ts `withItemStates` from `itemStates` at the caller's clock. `buildDashboard` has no clock and
   * sets none; the server's loader always does. Its marks, claims and tasks ride the spec page's claims and tasks.
   */
  readonly state?: ItemStateInfo;
  /**
   * The spec's open run (spec 070, ISC-570, ISC-572), see `DashboardOpenRun`; absent while no run is open on it, so a
   * workspace without open runs reads byte for byte as before.
   */
  readonly run?: DashboardOpenRun;
}

/**
 * The newest step of an `implement` run on its spec (spec 070, ISC-572): the newest run event (`dispatch`, `build`,
 * `patch`, `apply`) or `probe` of `.spectant/activity.jsonl` on the spec at or after the run's start, whatever its
 * session: the hooks write the parent's own session id, not the run's. A line counts for the spec as on the live frame:
 * by its claim when it names one, else by its spec session or spec worktree (ISC-213). A `question` is no step: it waits
 * on the person. The web reads a `probe` as the testing step; core gives the kind only.
 */
export interface DashboardRunStep {
  readonly kind: RunEvent | 'probe';
  /** ISO 8601: the step line's `ts`. */
  readonly at: string;
  /** The task id the line names, `T12` or `C2`. */
  readonly task: string;
  /** The claim the line names; absent on a claimless run event. */
  readonly claim?: string;
  /** The line's session as written: the hook's parent session, a builder's `<parent>/<task>` or the round's parent. */
  readonly session: string;
  /** A probe's result; absent on a run event. */
  readonly result?: ProbeResult;
}

/**
 * The open run of a spec (spec 070, ISC-570): the newest `run-start` on it without a `run-end` (`LockReading.openRuns`),
 * matched by number or folder name. Set on the row while such a run is open, whatever its age: the abort age is the
 * item state's business (`state`). A run of `/spec init` names no spec and lands on no row.
 */
export interface DashboardOpenRun {
  /** The run id as written. */
  readonly run: string;
  /**
   * The `/spec` subcommand of `command` (`plan`, `tasks`, `review`, `implement`, `done` …), an old skill name mapped
   * (`commandKey`; the code review reads `review`); null for a command the plugin has no subcommand for.
   */
  readonly phase: string | null;
  /** The command in the plugin's form (`/spec review 006 code`), an old skill name mapped (`pluginCommand`). */
  readonly command: string;
  /** ISO 8601: the `run-start` line's `ts`. */
  readonly since: string;
  /** The `run-start` line's session, as written. */
  readonly session: string;
  /** Only on an `implement` run, and only when a step followed its start. */
  readonly step?: DashboardRunStep;
}

/** Warnings of one kind across specs, for the warnings panel. */
export interface WarningGroup {
  readonly kind: WarningKind;
  readonly items: ReadonlyArray<{ readonly spec: string; readonly warning: SpecWarning }>;
}

/** The TL;DR shown below the key numbers; the web app renders the markdown with `markdown.ts`. */
export interface DashboardBrief {
  /** The file's body without its frontmatter. */
  readonly markdown: string;
  readonly generated: string | null;
  readonly stale: boolean;
  /** Markdown per `<!-- section: key -->`, so the overview can stand in view and the rest fold away. */
  readonly sections: Readonly<Record<string, string>>;
  /** The spec worktree `specs/tldr.md` was read from (spec 039, ISC-209); absent when read from the main checkout. */
  readonly source?: RepoFileSource;
  /**
   * The brief's primary language from the frontmatter `lang:` of `specs/tldr.md`, a BCP 47 tag such as `de` (spec 021,
   * ISC-247); null when the file names none. The web app compares it with the interface language: on a mismatch the
   * TL;DR card carries a language chip and its text block the `lang` attribute; null shows neither.
   */
  readonly lang: string | null;
}

/** A local listener that belongs to the workspace, for the live indicator (loopback only). */
export interface LocalService {
  readonly port: number;
  readonly url: string;
  readonly process: string;
  /** From the constitution's `dev_services:` (`4200=Web dev`); null when unnamed. */
  readonly label: string | null;
  /** True when the process runs inside one of the workspace's worktrees; absent when unknown. */
  readonly worktree?: boolean;
  /**
   * The spec number `NNN` when the process runs in the spec worktree `.worktrees/NNN-slug` (spec 027, ISC-177); absent
   * in a builder worktree, in a worktree whose name is no spec, and outside every worktree.
   */
  readonly spec?: string;
}

/** A parse finding per file lives in `files.ts`, so `planning.ts` types it without reaching this module. */
export type { FileDiagnostic } from './files.ts';

/** A story of `specs/ideas/` as the dashboard's disclosure and the palette list it (spec 008, T70, ISC-124.2). */
export interface DashboardIdea {
  /** Frontmatter `feature:`, `F<n>`; null when the story belongs to no feature. */
  readonly feature: string | null;
  /** The master block's heading after `F<n> ·`; null without `feature` or a block of that id. */
  readonly featureName: string | null;
  /** Frontmatter `milestone:`; null when the story belongs to no milestone. */
  readonly milestone: string | null;
  /** The file name without `.md`; `/spec new <slug>` starts its spec. */
  readonly slug: string;
  /** The first prose line under `## Goal`, else the slug. */
  readonly title: string;
  readonly priority: Priority;
  /** The story's item state (spec 040, ISC-224), set by `withItemStates` as on a spec row; absent without a clock. */
  readonly state?: ItemStateInfo;
}

/** The stories of the workspace, counted apart from specs and claims. */
export interface DashboardIdeas {
  readonly count: number;
  /** In file-name order, as `readIdeas` lists them. */
  readonly list: readonly DashboardIdea[];
}

export interface DashboardModel {
  readonly kpis: DashboardKpis;
  readonly stageCounts: Readonly<Record<Stage, number>>;
  /** Active specs in action order: nearest to done first, done last. */
  readonly specs: readonly DashboardSpecRow[];
  /** Next up: the ids of the first three rows that have a next command, in row order. */
  readonly nextUp: readonly string[];
  readonly warningGroups: readonly WarningGroup[];
  readonly archive: readonly ArchivedSpec[];
  /** Null when the workspace has no `specs/tldr.md`. */
  readonly brief: DashboardBrief | null;
  readonly services: readonly LocalService[];
  readonly diagnostics: readonly FileDiagnostic[];
  /**
   * The stories (`specs/ideas/`, stage `idea`, spec 008, T70), empty without any. Their `ideas-…` findings belong to
   * the planning tree (`planning.ts`) and are not listed here a second time.
   */
  readonly ideas: DashboardIdeas;
  /**
   * What waits on the principal and what is next, workspace-wide (spec 020, ISC-237): `guidanceOf` over the item
   * states, set by `withGuidance` at the caller's clock. `buildDashboard` has no clock and sets none; the server's
   * loader always does.
   */
  readonly guidance?: Guidance;
}

/** Everything the model is built from, read by the caller; pure over it. */
export interface DashboardInput {
  /** `ISA.md` at the repository root; null when absent. */
  readonly master: string | null;
  /** `specs/constitution.md`; null when absent. */
  readonly constitution: string | null;
  /** `specs/tldr.md`; null when absent. */
  readonly tldr: string | null;
  /** Where `tldr` was read (spec 039, ISC-209); absent means the main checkout. */
  readonly tldrSource?: RepoFileSource;
  /**
   * The findings of the repository files' read sources (spec 039, ISC-209.1): one `worktree-file-conflict` per file two
   * spec worktrees changed differently, already one per file; they join the model's `diagnostics` as they are.
   */
  readonly sourceDiagnostics?: readonly FileDiagnostic[];
  /** Folders directly under `specs/`. */
  readonly specs: readonly SpecFiles[];
  /** Folders under `specs/archive/`. */
  readonly archived: readonly SpecFiles[];
  /**
   * The main checkout's tree id, computed in memory for the code-reviewed mark; null when it could not be computed. It
   * is every spec's tree unless `perSpec` names one of the spec's own (spec 027, ISC-176).
   */
  readonly worktreeTree?: string | null;
  /**
   * The workspace's worktrees as `assignWorktrees` (`worktrees.ts`) assigned them, `ahead` and `dirty` read by the server
   * in each spec worktree (spec 027, T12, ISC-175). Each row takes its spec's worktree; each `worktree-branch-mismatch`
   * diagnostic becomes a warning on the row its `subject` names. Absent: no worktree, no chip, as before spec 027.
   */
  readonly worktrees?: WorktreeAssignment;
  /**
   * How the server read each spec, keyed by folder name (`NNN-slug`): its own tree id, its read source and the main
   * checkout's copy (`SpecRead`). A folder without an entry, and every field an entry leaves out, keeps the defaults:
   * the workspace's `worktreeTree`, source `main`, no main copy. Additive (spec 027, T12).
   */
  readonly perSpec?: Readonly<Record<string, SpecRead>>;
  readonly locks?: LockReading;
  readonly services?: readonly LocalService[];
  /**
   * `specs/workflow.md` as `parseWorkflow` read it (the server's loader, T78); absent, the default table. It decides
   * each spec's code review (row 9, `close-pending`, T49) and which stages may stand explicitly (T47).
   */
  readonly workflow?: Workflow;
  /** The story folder `specs/ideas/` as `readIdeas` takes it (file name to text); absent or empty without stories. */
  readonly ideas?: IdeaFiles;
  /**
   * The merge state of the spec numbers as the server read it from git (spec 025, ISC-162.1), which `resolveEdges`
   * meets the spec edges against; absent, each target's frontmatter and the archive decide. A spec whose whole open
   * work waits on open spec edges stands on `blocked` (ISC-162.3).
   */
  readonly mergeState?: readonly MergeState[];
}

/** The stage table's order, for the stage counts. */
const STAGES: readonly Stage[] = ['plan', 'tasks', 'review', 'build', 'blocked', 'code-review', 'close-pending', 'close', 'done'];

/**
 * The order the lists show specs in: the action they need, nearest to done first, done last (old ACTION_ORDER).
 * `close-pending` needs no action on the spec itself (row 9 names no command), so it sits with done, just before it.
 */
export const ACTION_ORDER: readonly Stage[] = ['close', 'code-review', 'review', 'build', 'blocked', 'tasks', 'plan', 'close-pending', 'done'];

/** Stages counted as building on the KPI split (`close-pending` waits on a sibling's build); every other but done is scoping. */
const BUILDING: ReadonlySet<Stage> = new Set<Stage>(['build', 'blocked', 'code-review', 'close-pending']);

/** The stage group of a derived stage (spec 021, ISC-245): the one derivation the Specs tile and the spec filter share. */
export const stageGroupOf = (stage: Stage): StageGroup => (stage === 'done' ? 'complete' : BUILDING.has(stage) ? 'building' : 'scoping');

/**
 * Warning kinds in the order the old dashboard listed them on a row, the two of the spec edges (spec 025, ISC-164,
 * ISC-162.4) after the other file warnings and before the lock readings; the worktree mismatch (spec 027, ISC-174.1),
 * a git fact rather than a file's, is its own group, last. A row lists its warnings in the same order.
 */
const WARNING_ORDER: readonly WarningKind[] = ['drift', 'review', 'diagrams', 'closed', 'fog', 'spec-overlap', 'spec-edge', 'locks', 'worktree-branch-mismatch'];

/** Kinds a row lists after the spec edges' warnings: the lock readings and the worktree mismatch. */
const AFTER_EDGE_WARNINGS: ReadonlySet<WarningKind> = new Set<WarningKind>(['locks', 'worktree-branch-mismatch']);

const NEXT_UP = 3;

const MASTER_FILE = 'ISA.md';
const CONSTITUTION_FILE = 'specs/constitution.md';
const TLDR_FILE = 'specs/tldr.md';

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

/** A file of a spec folder, relative to the repository root. */
const fileOf = (base: string, folder: string, kind: FileKind): string => specFilePath(`${base}/${folder}`, kind);

// ── services ──────────────────────────────────────────────────────────────────────────────────────────

/** The constitution's `dev_services: 4200=Web dev, 8080=API` as port → label, in written order. */
export function devServiceLabels(constitution: string): Map<number, string> {
  const labels = new Map<number, string>();
  const value = parseFrontmatter(constitution).values.dev_services ?? '';
  for (const entry of value.split(',')) {
    const at = entry.indexOf('=');
    const port = Number(entry.slice(0, at).trim());
    const label = entry.slice(at + 1).trim();
    if (at > 0 && Number.isInteger(port) && port > 0 && port < 65536 && label !== '') labels.set(port, label);
  }
  return labels;
}

/** What the server's local-listener probe reports for a port (its `DevService`), structurally. */
export interface ProbedService {
  readonly port: number;
  /** The process kind (`node`, `java`, `bun`, …). */
  readonly kind: string;
  readonly label?: string;
  readonly worktree?: boolean;
  /** The spec number `NNN` the server read from the worktree's folder name `.worktrees/NNN-slug` (spec 027, ISC-177). */
  readonly spec?: string;
}

/**
 * A probed listener as the model's LocalService: a loopback URL, labelled only when the constitution names the port.
 * `worktree` and `spec` pass through unchanged, and each stays absent when the probe left it out.
 */
export function toLocalService(service: ProbedService, labels: ReadonlyMap<number, string>): LocalService {
  return {
    port: service.port,
    url: `http://localhost:${service.port}`,
    process: service.kind,
    label: labels.get(service.port) ?? null,
    ...(service.worktree === undefined ? {} : { worktree: service.worktree }),
    ...(service.spec === undefined ? {} : { spec: service.spec }),
  };
}

// ── one spec ──────────────────────────────────────────────────────────────────────────────────────────

/** A mark read from its text when the file exists; null when it does not. */
function readMark(gate: GateName, text: string | undefined): GateMarkReading | null {
  return text === undefined ? null : readGateMark(gate, text);
}

/** The newest `ts` over the rounds lines; lines that are not JSON objects become diagnostics. */
function newestRound(text: string | undefined): { ts: string | null; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  let ts: string | null = null;
  (text ?? '').split(/\r?\n/).forEach((line, i) => {
    if (line.trim() === '') return;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      diagnostics.push({ severity: 'warning', code: 'rounds-line-invalid', message: 'The line is not JSON; the round is skipped.', line: i + 1 });
      return;
    }
    const at = typeof value === 'object' && value !== null && 'ts' in value ? value.ts : undefined;
    if (typeof at !== 'string' || Number.isNaN(Date.parse(at))) {
      diagnostics.push({ severity: 'warning', code: 'rounds-ts-missing', message: 'The round carries no ISO 8601 `ts`.', line: i + 1 });
      return;
    }
    if (ts === null || Date.parse(at) > Date.parse(ts)) ts = at;
  });
  return { ts, diagnostics };
}

function reviewedView(check: GateCheck, reading: GateMarkReading | null): GateView {
  const at = check.at === null ? {} : { at: check.at };
  if (check.state === 'missing') return { state: 'missing', detail: 'no reviewed mark' };
  if (check.state === 'stale') {
    const detail = check.changed.length > 0 ? `changed since the review: ${check.changed.join(', ')}` : 'the mark cannot be compared';
    return { state: 'stale', detail, ...at, files: check.changed };
  }
  const mark = reading?.mark;
  const files = mark?.gate === 'reviewed' ? (Object.keys(mark.files) as ReviewedFile[]).filter((f) => mark.files[f] !== null) : [];
  return { state: 'fresh', detail: `matches ${files.join(', ')}`, ...at, files };
}

function codeReviewedView(check: GateCheck): GateView {
  const at = check.at === null ? {} : { at: check.at };
  if (check.state === 'missing') return { state: 'missing', detail: 'no code-reviewed mark' };
  if (check.state === 'stale') return { state: 'stale', detail: check.detail ?? 'the working tree changed since the code review', ...at };
  return { state: 'fresh', detail: 'matches the working tree', ...at };
}

/** The drift classes that are not clean, in the report's key order. */
function driftClasses(report: DriftReport): DriftClass[] {
  return (Object.keys(report) as DriftClass[]).filter((key) => {
    const value = report[key];
    return Array.isArray(value) ? value.length > 0 : typeof value === 'number' ? value > 0 : value !== null;
  });
}

function driftView(report: DriftReport | null): GateView {
  if (report === null) return { state: 'na', detail: 'no master ISA.md' };
  if (!hasDrift(report)) return { state: 'ok', detail: 'in step with the master' };
  return { state: 'warn', detail: `drift: ${driftClasses(report).join(', ')}` };
}

function diagramsView(verdict: DiagramVerdict): GateView {
  if (verdict.level === 'skip') return { state: 'na', detail: 'no diagram required' };
  if (verdict.level === 'ok') return { state: 'ok', detail: 'mermaid diagram present' };
  return { state: 'warn', detail: `no mermaid diagram in ${verdict.missing.join(', ')}`, files: verdict.missing };
}

interface SpecContext {
  readonly master: ClaimsDocument | null;
  /** Claim IDs per folder, active and archived, for `missing_in_spec`. */
  readonly idsByFolder: ReadonlyMap<string, ReadonlySet<string>>;
  readonly locks: readonly ClaimLock[];
  /** The lock reading's diagnostics, routed to rows as `locks` warnings. */
  readonly lockDiagnostics: readonly LockDiagnostic[];
  /** The main checkout's tree: every spec's unless `perSpec` names its own. */
  readonly worktreeTree: string | null;
  /** How the server read each spec, by folder (spec 027, T12). */
  readonly perSpec: Readonly<Record<string, SpecRead>>;
  /** The workspace's worktrees, builders included. */
  readonly worktrees: readonly Worktree[];
  /** The `worktree-branch-mismatch` diagnostics, routed to the row their `subject` names. */
  readonly worktreeDiagnostics: readonly Diagnostic[];
  readonly workflow: Workflow | undefined;
  /** Main feature → the ids of its open active specs (row 9's siblings), in folder order. */
  readonly openByFeature: ReadonlyMap<string, readonly string[]>;
  /** What each active spec waits on, by number (`resolveEdges`, spec 025): the stage reads its full hold (ISC-162.3). */
  readonly waits: ReadonlyMap<string, SpecWait>;
  /** The resolved spec edges each active spec carries, by number: an open one on a claim holds it (ISC-162.2). */
  readonly specEdges: ReadonlyMap<string, readonly SpecEdge[]>;
  /** The lock reading's open runs, run events and step events, for each row's open run (spec 070, ISC-570). */
  readonly activity: Pick<LockReading, 'openRuns' | 'runs' | 'steps'>;
}

/**
 * The open run of one spec (spec 070, ISC-570, ISC-572), or null: the newest open run naming the spec by number or
 * folder name, its phase the subcommand of its command; on an `implement` run, the newest step on the spec's claims (or,
 * claimless, its spec session or worktree) at or after the run's start.
 */
function openRunOf(activity: SpecContext['activity'], id: string, slug: string, claims: ReadonlySet<string>): DashboardOpenRun | null {
  const ours = (activity.openRuns ?? []).filter((r: OpenRun) => r.spec !== undefined && (r.spec === id || r.spec === slug || specIdOf(r.spec) === id));
  const newest = ours.reduce<OpenRun | null>((best, r) => (best === null || Date.parse(r.since) >= Date.parse(best.since) ? r : best), null);
  if (newest === null) return null;
  const key = commandKey(newest.command);
  const phase = key === null ? null : (key.split(' ')[0] ?? null);
  const base: DashboardOpenRun = { run: newest.run, phase, command: pluginCommand(newest.command), since: newest.since, session: newest.session };
  if (phase !== 'implement') return base;
  const from = Date.parse(newest.since);
  const onSpec = (l: { readonly claim?: string; readonly session: string; readonly worktree?: string; readonly ts: string }): boolean =>
    Date.parse(l.ts) >= from && (l.claim === undefined ? runSpecOf(l) === id : claims.has(l.claim));
  const steps: DashboardRunStep[] = [
    ...(activity.runs ?? []).filter(onSpec).map((r): DashboardRunStep => ({ kind: r.event, at: r.ts, task: r.task, ...(r.claim === undefined ? {} : { claim: r.claim }), session: r.session })),
    ...(activity.steps ?? []).flatMap((s): DashboardRunStep[] => (s.event === 'probe' && onSpec(s) ? [{ kind: 'probe', at: s.ts, task: s.task, claim: s.claim, session: s.session, result: s.result }] : [])),
  ];
  // The newest by time; on a tie the later of the two lists, the probe, since a builder probes after its build.
  const step = steps.reduce<DashboardRunStep | null>((best, s) => (best === null || Date.parse(s.at) >= Date.parse(best.at) ? s : best), null);
  return step === null ? base : { ...base, step };
}

/** Whether an active spec holds a feature's code review back (row 9): not `phase: complete`, at least one open claim. */
function holdsFeatureOpen(phase: string | null, doc: ClaimsDocument): boolean {
  return phase !== 'complete' && doc.claims.some((c) => !c.checked && !c.dropped);
}

const ACTIVITY_FILE = '.spectant/activity.jsonl';

/**
 * A lock diagnostic as a row warning: the source file (and line) first, then the reader's sentence; `ref` is the claim
 * it names, else the activity file when it came from there.
 */
function lockWarning(d: LockDiagnostic): SpecWarning {
  // The activity log's diagnostics: the `locks-activity-*` codes and the unknown-event warning (spec 027, ISC-179),
  // which carries the line it was raised at; everything else came from a frontier lock file.
  const activity = d.code.startsWith('locks-activity') || d.code === 'activity-event-unknown';
  const where = activity ? `${ACTIVITY_FILE}${d.line === undefined ? '' : ` line ${d.line}`}` : 'LifeOS frontier locks';
  const ref = d.claim ?? (activity ? ACTIVITY_FILE : undefined);
  return { kind: 'locks', text: `${where}: ${d.message}`, ...(ref === undefined ? {} : { ref }) };
}

/**
 * A `worktree-branch-mismatch` diagnostic as a row warning (spec 027, ISC-174.1): `assignWorktrees`'s sentence, which
 * names both specs and the branch, and `ref` the worktree's path; the chip turns to the warning tone on it.
 */
function worktreeWarning(d: Diagnostic, worktree: Worktree | null): SpecWarning {
  return { kind: 'worktree-branch-mismatch', text: d.message, ...(worktree?.path == null ? {} : { ref: worktree.path }) };
}

/**
 * The main checkout's stage and progress of a spec read from its worktree (spec 027, ISC-181; spec 041, ISC-218): the
 * stage basis of its files with the main checkout's tree, without building a row. Its findings are not listed: the page
 * and the row show the worktree copy, and its files are the ones read.
 */
function mainCopyOf(files: SpecFiles, ctx: SpecContext): MainCopy | null {
  const spec = files.texts.spec;
  if (spec === undefined) return null;
  const basis = stageBasisOf(files, spec, specIdOf(files.folder) ?? files.folder, ctx, ctx.worktreeTree);
  return { stage: nextCommandWithReason(basis.input).stage, progress: basis.doc.counted };
}

/** What a spec folder's stage is derived from, with the parsed pieces its row also shows. */
interface StageBasis {
  readonly fm: ReturnType<typeof parseFrontmatter>;
  readonly doc: ReturnType<typeof parseClaims>;
  readonly plan: string | null;
  readonly reviewedMark: ReturnType<typeof reviewedGate>['reading'];
  readonly reviewed: ReturnType<typeof reviewedGate>['check'];
  readonly partition: ReturnType<typeof partitionClaims>;
  readonly takeable: ReturnType<typeof partitionClaims>['takeable'];
  readonly codeMark: ReturnType<typeof readMark>;
  readonly codeReviewed: ReturnType<typeof gateState>;
  readonly events: ReturnType<typeof parseEvents>['events'];
  readonly input: StageInput;
}

/**
 * The stage input of one spec folder (ISC-218): the one derivation the row and the main copy share, so both read the
 * same stage from the same files. `tree` is the worktree tree the code-reviewed mark is checked against.
 */
function stageBasisOf(f: SpecFiles, spec: string, id: string, ctx: SpecContext, tree: string | null): StageBasis {
  const plan = f.texts.plan ?? null;
  const fm = parseFrontmatter(spec);
  const doc = parseClaims(spec);
  // The review gate first: the partition takes the reviewed mark's state (ISC-99), so every count below follows it.
  const { reading: reviewedMark, check: reviewed } = reviewedGate(f.texts);
  const partition = partitionClaims(doc.claims, ctx.locks, reviewed.state);
  // A claim an open spec edge holds is not takeable: it counts where the Claims tab shows it, blocked (ISC-162.2, ISC-72).
  const edgeHeld = specEdgeHolds(partition.takeable, ctx.specEdges.get(id) ?? []);
  const takeable = partition.takeable.filter((c) => !edgeHeld.has(c));
  const codeMark = readMark('code-reviewed', f.texts.gateCodeReviewed);
  const codeReviewed = gateState('code-reviewed', codeMark?.mark ?? null, { worktreeTree: tree });

  const { specType: type, phase } = fm.data;
  // The explicit stage needs the last recorded transition; the events' own diagnostics belong to the timeline.
  const events = f.texts.events === undefined ? [] : parseEvents(f.texts.events).events;
  const lastTo = events.at(-1)?.to ?? null;
  const lastEventTo: WorkflowStage | null = lastTo !== null && isWorkflowStage(lastTo) ? lastTo : null;
  // Its `from` tells a step back from a forward move or the allocation (ISC-221.2).
  const lastFrom = events.at(-1)?.from ?? null;
  const lastEventFrom: WorkflowStage | null = lastFrom !== null && isWorkflowStage(lastFrom) ? lastFrom : null;
  // Row 9 (T49): the type's code review under the workspace's workflow and the open siblings of the main feature.
  const mainFeature = mainFeatureOf(fm.data.isaFeature);
  const featureSiblingsOpen = mainFeature === null ? [] : (ctx.openByFeature.get(mainFeature) ?? []).filter((other) => other !== id);
  const input: StageInput = {
    number: id,
    type,
    phase,
    hasPlan: plan !== null,
    hasTasks: f.texts.tasks !== undefined,
    claims: doc.counted,
    reviewed: reviewed.state,
    codeReviewed: codeReviewed.state,
    takeable,
    partition: {
      takeable: takeable.length,
      open: partition.open.length - takeable.length,
      closed: partition.closed.length - partition.dropped.length,
      dropped: partition.dropped.length,
    },
    explicitStage: fm.data.stage,
    lastEventTo,
    lastEventFrom,
    ...(ctx.workflow === undefined ? {} : { workflow: ctx.workflow }),
    codeReview: codeReviewOf(type, ctx.workflow),
    mainFeature,
    featureSiblingsOpen,
    waits: ctx.waits.get(id) ?? null,
    edgeHeld: [...new Set([...edgeHeld.values()].flat())].sort(),
  };
  return { fm, doc, plan, reviewedMark, reviewed, partition, takeable, codeMark, codeReviewed, events, input };
}

function heldElsewhere(ctx: SpecContext, folder: string): Set<string> {
  const held = new Set<string>();
  for (const [other, ids] of ctx.idsByFolder) if (other !== folder) ids.forEach((id) => held.add(id));
  return held;
}

/** One active spec's row, or null (with a diagnostic) for a folder without spec.md. */
function specRow(f: SpecFiles, ctx: SpecContext, diagnostics: FileDiagnostic[]): DashboardSpecRow | null {
  const note = (kind: FileKind, list: readonly Diagnostic[]) => list.forEach((diagnostic) => diagnostics.push({ file: fileOf('specs', f.folder, kind), diagnostic }));
  const spec = f.texts.spec;
  if (spec === undefined) {
    note('spec', [{ severity: 'error', code: 'spec-missing', message: 'The folder has no spec.md, so it is not a spec and gets no row.' }]);
    return null;
  }
  const id = specIdOf(f.folder) ?? f.folder;
  // How the server read the spec (spec 027, T12).
  const read: SpecRead = ctx.perSpec[f.folder] ?? {};
  // The tree of the spec's own worktree when the server computed one (ISC-176), else the main checkout's.
  const tree = read.tree === undefined ? ctx.worktreeTree : read.tree;
  const { fm, doc, plan, reviewedMark, reviewed, partition, takeable, codeMark, codeReviewed, events, input: stageInput } = stageBasisOf(f, spec, id, ctx, tree);
  const ids = new Set(doc.claims.map((c) => c.id));
  const taken = heldLocks(ctx.locks, ids).map((l): DashboardTakenClaim => ({ id: l.claim, session: l.session, since: l.since, source: l.source }));
  // The gate's own diagnostic is not a file warning: the row's stage and reason already name the mark (`review`).
  const partitionWarnings = partition.diagnostics.filter((d) => d.code !== 'status-review-gate');
  note('spec', [...fm.diagnostics, ...doc.diagnostics, ...partitionWarnings]);

  note('gateReviewed', reviewedMark?.diagnostics ?? []);
  note('gateCodeReviewed', codeMark?.diagnostics ?? []);

  const { specType: type, phase } = fm.data;
  const next = nextCommandWithReason(stageInput);
  // A `stage:` that does not apply is one warning on spec.md, at the key's line (T48, ISC-120.1).
  const mismatch = stageMismatchOf(stageInput, fm.keyLines.stage);
  if (mismatch !== null) note('spec', [mismatch]);

  const drift = ctx.master === null ? null : driftReport({ frontmatter: fm, spec: doc, master: ctx.master, heldElsewhere: heldElsewhere(ctx, f.folder) });
  const diagrams = diagramVerdict({ type, phase, spec, plan });
  const fog = doc.fog.length;
  const rounds = newestRound(f.texts.rounds);
  note('rounds', rounds.diagnostics);
  // events.jsonl's findings: rejected lines, old words and the one actor-legacy warning of the file (spec 008, T61).
  if (f.texts.events !== undefined) note('events', parseEvents(f.texts.events).diagnostics);

  // As the old collect(): drift always; the rest only while the spec is open, since completing it closed them.
  const warnings: SpecWarning[] = [];
  if (drift !== null && hasDrift(drift)) {
    warnings.push({ kind: 'drift', text: `drift to the master: ${driftClasses(drift).join(', ')}`, command: commandFor(null, id) });
  }
  if (phase !== 'complete') {
    if (reviewed.state !== 'fresh') {
      const text = reviewed.state === 'stale' ? `reviewed mark is stale (${reviewed.changed.join(', ') || 'unreadable'})` : 'no reviewed mark yet';
      warnings.push({ kind: 'review', text, command: commandFor('review', id) });
    }
    // Only the files that exist: a missing plan is the next command's business, not a diagram warning.
    const missing = diagrams.missing.filter((file) => file === 'spec.md' || plan !== null);
    if (diagrams.level === 'fail' && missing.length > 0) {
      warnings.push({ kind: 'diagrams', text: `diagram missing in ${missing.join(', ')}`, ref: missing.join(', ') });
    }
    // Only while the stage table still names a command: a chore done by row 8 and a spec waiting in row 9
    // (`close-pending`) have every claim closed and nothing left to do on the spec itself (T49, T50).
    if (doc.counted.total > 0 && doc.counted.closed === doc.counted.total && next.command !== null) {
      warnings.push({ kind: 'closed', text: 'every claim closed, phase not complete' });
    }
    if (fog > 0) warnings.push({ kind: 'fog', text: plural(fog, 'open fog line') });
    // A diagnostic naming a claim concerns that claim's row only, so one naming an archived or unknown claim lands on no
    // open row (spec 035). One without a claim (an unreadable source, a line without a claim) may hide a lock from every
    // open spec, so each open row carries it.
    for (const d of ctx.lockDiagnostics) {
      if (d.claim === undefined || ids.has(d.claim)) warnings.push(lockWarning(d));
    }
  }
  // The worktree (spec 027, T12): a git fact, so it holds whatever the phase, like drift.
  const worktree = ctx.worktrees.find((w) => w.kind === 'spec' && w.spec === id) ?? null;
  for (const d of ctx.worktreeDiagnostics) if (d.subject === id) warnings.push(worktreeWarning(d, worktree));
  const source: SpecSource = read.source ?? 'main';
  const main = source === 'worktree' && read.main !== undefined ? mainCopyOf(read.main, ctx) : null;

  // The archive listing's summary of a folder (title fallback, task counts, goal) serves an active folder as well.
  const summary = listArchive([f])[0];
  const run = openRunOf(ctx.activity, id, f.folder, ids);
  return {
    id,
    slug: f.folder,
    title: specTitle(summary, f.folder),
    type,
    priority: fm.data.priority,
    feature: stageInput.mainFeature,
    featureName: featureNameOf(ctx.master, stageInput.mainFeature),
    milestone: fm.data.milestone,
    phase,
    stage: next.stage,
    stageGroup: stageGroupOf(next.stage),
    stageSource: next.stageSource,
    progress: doc.counted,
    tasks: f.texts.tasks === undefined ? null : (summary?.tasks ?? { landed: 0, total: 0 }),
    nextCommand: next.command,
    // The one phrase of the step, as every surface shows it (T58, T69, ISC-122.3); the spec head reads it from here.
    nextReason: reasonOf(next),
    takeable,
    taken,
    assignee: assigneeOf({ claims: ids, locks: ctx.locks, events }),
    warnings,
    gates: {
      reviewed: reviewedView(reviewed, reviewedMark),
      codeReviewed: codeReviewedView(codeReviewed),
      drift: driftView(drift),
      diagrams: diagramsView(diagrams),
    },
    fog,
    updated: fm.data.updated,
    lastRound: rounds.ts,
    closedAt: closedAtOf(f.texts.events),
    goal: summary?.goal ?? '',
    worktree,
    source,
    main,
    waits: waitsOf(ctx.waits.get(id)),
    ...(run === null ? {} : { run }),
  };
}

/** A spec's wait as a row shows it (ISC-163): only while an open spec edge holds something, else null. */
const waitsOf = (wait: SpecWait | undefined): SpecWait | null => (wait === undefined || wait.blockers.length === 0 ? null : wait);

/** The resolved spec edges grouped by the spec that carries them. */
function edgesBySpec(edges: readonly SpecEdge[]): Map<string, SpecEdge[]> {
  const by = new Map<string, SpecEdge[]>();
  for (const e of edges) by.set(e.fromSpec, [...(by.get(e.fromSpec) ?? []), e]);
  return by;
}

// ── spec overlap and edge warnings (spec 025) ─────────────────────────────────────────────────────────

/** One open spec as the overlap reads it (ISC-164): its row's stage and claim progress, and the paths it changes. */
export interface OverlapSpec {
  /** `NNN`. */
  readonly num: string;
  readonly stage: Stage;
  readonly progress: Progress;
  /** The paths of its plan's `## Affected Files and Modules` table and of its tasks' path column, as written. */
  readonly paths: readonly string[];
}

const AFFECTED_HEADING = /^##\s+Affected Files and Modules\s*$/i;
/** A bare cell or path token that reads as a path: no blank, no backtick, a slash or a dot in it. */
const PATH_LIKE = /^[^\s`]*[/.][^\s`]*$/;

/**
 * The paths of a plan's `## Affected Files and Modules` table (ISC-164): from the first cell of every body row, each
 * code span in it, or the whole cell when it holds none and reads as a path. The header row (`Path`, `Pfad`) reads as
 * none. Lines inside a code fence are skipped.
 */
export function affectedPaths(plan: string): string[] {
  const out: string[] = [];
  let inside = false;
  let fenced = false;
  for (const line of plan.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    if (fenced) continue;
    if (/^##\s/.test(line)) {
      inside = AFFECTED_HEADING.test(line.trim());
      continue;
    }
    if (!inside || !line.trim().startsWith('|') || TABLE_SEP.test(line)) continue;
    const cell = tableCells(line)[0] ?? '';
    const spans = [...cell.matchAll(/`([^`]+)`/g)].map((m) => (m[1] ?? '').trim()).filter((p) => p !== '');
    if (spans.length > 0) out.push(...spans);
    else if (PATH_LIKE.test(cell)) out.push(cell);
  }
  return out;
}

/** A path for comparing: slashes forward, no leading `./`, no doubled slash. */
const normalisePath = (path: string): string => path.trim().replace(/\\/g, '/').replace(/^(\.\/)+/, '').replace(/\/{2,}/g, '/');

/**
 * The constitution's `shared_files:` (ISC-164): files every spec may touch, such as a message catalogue or the
 * lockfile, as `[a, b]` or `a, b`; each entry may be a glob. Absent key: none, so every path counts.
 */
export function sharedFilesOf(constitution: string | null): string[] {
  if (constitution === null) return [];
  const raw = parseFrontmatter(constitution).values.shared_files;
  if (raw === undefined) return [];
  return raw
    .trim()
    .replace(/^\[/, '')
    .replace(/\]$/, '')
    .split(',')
    .map((entry) => normalisePath(entry.trim().replace(/^["'`]|["'`]$/g, '')))
    .filter((entry) => entry !== '');
}

/** A glob as a whole-path pattern: `**` crosses folders, `*` and `?` stay inside one. */
function globPattern(glob: string): RegExp {
  let source = '';
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i] as string;
    if (c === '*' && glob[i + 1] === '*') {
      source += '.*';
      i += 1;
    } else if (c === '*') source += '[^/]*';
    else if (c === '?') source += '[^/]';
    else source += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${source}$`, 'u');
}

/**
 * Whether `pattern` covers `path` (both normalised): the same path; a folder (ending in `/`) covers every path under
 * it; a path with `*` or `?` is a glob over whole paths. Two globs cover each other only when written the same.
 */
function covers(pattern: string, path: string): boolean {
  if (pattern === path) return true;
  if (pattern.endsWith('/')) return path.startsWith(pattern);
  return /[*?]/.test(pattern) && globPattern(pattern).test(path);
}

/** The paths two specs both change: each match once, as its more specific side, in path order. */
function commonPaths(a: readonly string[], b: readonly string[]): string[] {
  const out = new Set<string>();
  for (const pa of a) {
    for (const pb of b) {
      if (pa === pb) out.add(pa);
      else if (covers(pa, pb)) out.add(pb);
      else if (covers(pb, pa)) out.add(pa);
    }
  }
  return [...out].sort();
}

/** How far a stage stands along the workflow, for who waits; `blocked` stands with `build`, `close-pending` with `close`. */
const STAGE_RANK: Readonly<Record<Stage, number>> = {
  plan: 0,
  tasks: 1,
  review: 2,
  build: 3,
  blocked: 3,
  'code-review': 4,
  close: 5,
  'close-pending': 5,
  done: 6,
};

const ratio = (p: Progress): number => (p.total === 0 ? 0 : p.closed / p.total);

/** Who of a pair waits (plan.md § Approach): the earlier stage, then the lower claim progress, then the higher number. */
function waitingOf(a: OverlapSpec, b: OverlapSpec): OverlapSpec {
  const byStage = STAGE_RANK[a.stage] - STAGE_RANK[b.stage];
  if (byStage !== 0) return byStage < 0 ? a : b;
  const byProgress = ratio(a.progress) - ratio(b.progress);
  if (byProgress !== 0) return byProgress < 0 ? a : b;
  return a.num > b.num ? a : b;
}

/**
 * Every overlap between the given open specs (ISC-164): one per pair that both change a path, minus what
 * `sharedFiles` covers, and that no spec edge joins in either direction, met or open. Pairs in number order.
 */
export function specOverlaps(
  specs: readonly OverlapSpec[],
  edges: ReadonlyArray<Pick<SpecEdge, 'fromSpec' | 'toSpec'>>,
  sharedFiles: readonly string[],
): SpecOverlap[] {
  const joined = new Set(edges.flatMap((e) => [`${e.fromSpec}>${e.toSpec}`, `${e.toSpec}>${e.fromSpec}`]));
  const shared = sharedFiles.map(normalisePath);
  const sorted = [...specs].sort((a, b) => (a.num < b.num ? -1 : a.num > b.num ? 1 : 0));
  const pathsOf = new Map(sorted.map((s) => [s.num, [...new Set(s.paths.map(normalisePath).filter((p) => p !== ''))]]));
  const out: SpecOverlap[] = [];
  sorted.forEach((a, i) => {
    for (const b of sorted.slice(i + 1)) {
      if (a.num === b.num || joined.has(`${a.num}>${b.num}`)) continue;
      const paths = commonPaths(pathsOf.get(a.num) ?? [], pathsOf.get(b.num) ?? []).filter((p) => !shared.some((s) => covers(s, p)));
      if (paths.length === 0) continue;
      const waiting = waitingOf(a, b);
      const other = waiting === a ? b : a;
      out.push({ specs: [a.num, b.num], paths, waiting: waiting.num, edge: `(after: ${other.num})` });
    }
  });
  return out;
}

/** The base name of a repository-relative file, as a warning's `ref`. */
const baseName = (file: string): string => file.slice(file.lastIndexOf('/') + 1);

/**
 * The warnings of the spec edges per row id (spec 025): a `spec-edge` per edge diagnostic on the row of the folder
 * the edge sits in (ISC-162.4), and a `spec-overlap` per overlapping pair of open rows on the row that waits
 * (ISC-164). A row is open unless its stage is `done`; an archived spec has no row and so counts for none.
 */
function edgeWarnings(rows: readonly DashboardSpecRow[], active: readonly SpecFiles[], edges: ResolvedSpecEdges, constitution: string | null): Map<string, SpecWarning[]> {
  const out = new Map<string, SpecWarning[]>();
  const add = (id: string, warning: SpecWarning): void => void out.set(id, [...(out.get(id) ?? []), warning]);
  const idOf = new Map(rows.map((r) => [r.slug, r.id]));
  for (const { file, diagnostic } of edges.diagnostics) {
    const id = idOf.get(file.split('/')[1] ?? '');
    if (id !== undefined) add(id, { kind: 'spec-edge', text: diagnostic.message, ref: baseName(file) });
  }
  const filesOf = new Map(active.map((f) => [f.folder, f]));
  const open = rows.flatMap((r): OverlapSpec[] => {
    const texts = filesOf.get(r.slug)?.texts;
    if (r.stage === 'done' || texts === undefined) return [];
    const tasks = texts.tasks === undefined ? [] : parseTaskLines(constitution === null ? { tasks: texts.tasks } : { tasks: texts.tasks, constitution }).tasks;
    return [{ num: r.id, stage: r.stage, progress: r.progress, paths: [...affectedPaths(texts.plan ?? ''), ...tasks.flatMap((t) => t.paths)] }];
  });
  for (const overlap of specOverlaps(open, edges.edges, sharedFilesOf(constitution))) {
    const other = overlap.specs[0] === overlap.waiting ? overlap.specs[1] : overlap.specs[0];
    add(overlap.waiting, { kind: 'spec-overlap', text: `shares ${plural(overlap.paths.length, 'file')} with ${other}, no edge`, overlap });
  }
  return out;
}

// ── the workspace ─────────────────────────────────────────────────────────────────────────────────────

const byFolder = (a: SpecFiles, b: SpecFiles): number => (a.folder < b.folder ? -1 : a.folder > b.folder ? 1 : 0);

const byAction = (a: DashboardSpecRow, b: DashboardSpecRow): number =>
  ACTION_ORDER.indexOf(a.stage) - ACTION_ORDER.indexOf(b.stage) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0);

const sum = (rows: readonly DashboardSpecRow[], of: (r: DashboardSpecRow) => number): number => rows.reduce((n, r) => n + of(r), 0);

export function buildDashboard(input: DashboardInput): DashboardModel {
  const diagnostics: FileDiagnostic[] = [];
  const note = (file: string, list: readonly Diagnostic[]) => list.forEach((diagnostic) => diagnostics.push({ file, diagnostic }));

  // The master: its recount is the hero number, its claims the reference for every spec's drift.
  let master: ClaimsDocument | null = null;
  let masterFog = 0;
  if (input.master !== null) {
    const fm = parseFrontmatter(input.master);
    master = parseClaims(input.master);
    masterFog = master.fog.length;
    note(MASTER_FILE, [...fm.diagnostics, ...master.diagnostics]);
    const mismatch = fm.present && master.section !== null ? masterProgressMismatch(fm, master, MASTER_FILE) : null;
    if (mismatch) {
      note(MASTER_FILE, [
        { severity: 'warning', code: 'master-progress-mismatch', message: `progress ${mismatch.declared ?? '(none)'} disagrees with the recount ${mismatch.counted}.` },
      ]);
    }
  }

  let labels = new Map<number, string>();
  if (input.constitution !== null) {
    note(CONSTITUTION_FILE, parseFrontmatter(input.constitution).diagnostics);
    labels = devServiceLabels(input.constitution);
  }

  const active = [...input.specs].sort(byFolder);
  const archived = [...input.archived].sort(byFolder);
  const idsByFolder = new Map<string, ReadonlySet<string>>();
  // Row 9's siblings: the active specs of each main feature that still hold it open; an archived one never does.
  const openByFeature = new Map<string, string[]>();
  for (const f of [...active, ...archived]) {
    if (f.texts.spec === undefined) continue;
    const doc = parseClaims(f.texts.spec);
    idsByFolder.set(f.folder, new Set(doc.claims.map((c) => c.id)));
    if (!active.includes(f)) continue;
    const fm = parseFrontmatter(f.texts.spec).data;
    const feature = mainFeatureOf(fm.isaFeature);
    if (feature !== null && holdsFeatureOpen(fm.phase, doc)) openByFeature.set(feature, [...(openByFeature.get(feature) ?? []), specIdOf(f.folder) ?? f.folder]);
  }
  const edges = resolveEdges({ specs: active, archived, constitution: input.constitution }, input.mergeState ?? []);
  const ctx: SpecContext = {
    master,
    idsByFolder,
    locks: input.locks?.locks ?? [],
    lockDiagnostics: input.locks?.diagnostics ?? [],
    worktreeTree: input.worktreeTree ?? null,
    perSpec: input.perSpec ?? {},
    worktrees: input.worktrees?.worktrees ?? [],
    worktreeDiagnostics: input.worktrees?.diagnostics ?? [],
    workflow: input.workflow,
    openByFeature,
    waits: new Map(edges.waits.map((w) => [w.spec, w])),
    specEdges: edgesBySpec(edges.edges),
    activity: { openRuns: input.locks?.openRuns ?? [], runs: input.locks?.runs ?? [], steps: input.locks?.steps ?? [] },
  };

  // The rows first: who waits in an overlap reads their stage and progress (T15). The edge warnings go before the locks.
  const built = active.flatMap((f) => specRow(f, ctx, diagnostics) ?? []).sort(byAction);
  const extra = edgeWarnings(built, active, edges, input.constitution);
  const rows = built.map((r) => {
    const more = extra.get(r.id);
    if (more === undefined) return r;
    const at = r.warnings.findIndex((w) => AFTER_EDGE_WARNINGS.has(w.kind));
    const cut = at === -1 ? r.warnings.length : at;
    return { ...r, warnings: [...r.warnings.slice(0, cut), ...more, ...r.warnings.slice(cut)] };
  });
  for (const f of archived) {
    if (f.texts.spec === undefined) {
      note(fileOf('specs/archive', f.folder, 'spec'), [{ severity: 'error', code: 'spec-missing', message: 'The archived folder has no spec.md and is not listed.' }]);
    }
  }
  const archive = listArchive(archived);

  let brief: DashboardBrief | null = null;
  if (input.tldr !== null) {
    const tldr = parseTldr(input.tldr);
    note(TLDR_FILE, tldr.diagnostics);
    const state = tldrState({ tldr, specs: rows.map((r) => ({ number: r.id, updated: r.updated, phase: r.phase, lastRound: r.lastRound })) });
    brief = {
      markdown: parseFrontmatter(input.tldr).body.trim(),
      generated: tldr.generated,
      stale: state.stale,
      sections: tldr.sections,
      lang: tldr.lang,
      // Only a worktree copy is named (spec 039, ISC-209), so a brief read from the main checkout stays as it was.
      ...(input.tldrSource?.kind === 'worktree' ? { source: input.tldrSource } : {}),
    };
  }

  const stageCounts = Object.fromEntries(STAGES.map((stage) => [stage, rows.filter((r) => r.stage === stage).length])) as Record<Stage, number>;
  const open = rows.filter((r) => r.stage !== 'done');
  const warnings = sum(rows, (r) => r.warnings.length);
  const fog = masterFog + sum(rows, (r) => r.fog);
  const stageGroups = Object.fromEntries(STAGE_GROUPS.map((g) => [g, rows.filter((r) => r.stageGroup === g).length])) as Record<StageGroup, number>;
  const masterCount = master !== null && master.section !== null ? master.counted : null;
  const types = [...new Set(rows.flatMap((r) => (r.type === null ? [] : [r.type])))].sort();
  const byType = Object.fromEntries(types.map((t) => [t, rows.filter((r) => r.type === t).length])) as Partial<Record<SpecType, number>>;
  const kpis: DashboardKpis = {
    specs: rows.length,
    building: stageGroups.building,
    scoping: stageGroups.scoping,
    stageGroups,
    master: masterCount,
    masterOpen: masterCount === null ? null : Math.max(0, masterCount.total - masterCount.closed),
    masterPercent: masterCount === null || masterCount.total === 0 ? null : Math.floor((masterCount.closed / masterCount.total) * 100),
    byType,
    claims: { closed: sum(open, (r) => r.progress.closed), total: sum(open, (r) => r.progress.total) },
    tasks: { landed: sum(open, (r) => r.tasks?.landed ?? 0), total: sum(open, (r) => r.tasks?.total ?? 0) },
    takeable: sum(rows, (r) => r.takeable.length),
    openClaims: sum(rows, (r) => r.progress.total - r.progress.closed),
    warnings,
    specsWithWarnings: rows.filter((r) => r.warnings.length > 0).length,
    fog,
    specsWithFog: rows.filter((r) => r.fog > 0).length,
    masterFog,
    attention: warnings + fog,
    archived: archive.length,
  };

  const warningGroups: WarningGroup[] = WARNING_ORDER.map((kind) => ({
    kind,
    items: rows.flatMap((r) => r.warnings.filter((w) => w.kind === kind).map((warning) => ({ spec: r.id, warning }))),
  })).filter((g) => g.items.length > 0);

  const services = [...(input.services ?? [])]
    .sort((a, b) => a.port - b.port)
    .map((s) => (s.label === null && labels.has(s.port) ? { ...s, label: labels.get(s.port) ?? null } : s));

  diagnostics.push(...(input.sourceDiagnostics ?? []));
  return {
    kpis,
    stageCounts,
    specs: rows,
    nextUp: rows.filter((r) => r.nextCommand !== null).slice(0, NEXT_UP).map((r) => r.id),
    warningGroups,
    archive,
    brief,
    services,
    diagnostics,
    ideas: ideasOf(input.ideas, master),
  };
}

/** A feature block's name from the master, as a row shows it beside the block's id. */
const featureNameOf = (master: ClaimsDocument | null, feature: string | null): string | null =>
  feature === null ? null : (master?.features.find((block) => block.id === feature)?.name ?? null);

/** The stories for the disclosure and the palette: what each needs to be listed and started, nothing more. */
function ideasOf(files: IdeaFiles | undefined, master: ClaimsDocument | null): DashboardIdeas {
  const list = readIdeas(files ?? {}).ideas.map(({ feature, milestone, slug, title, priority }) => ({ feature, featureName: featureNameOf(master, feature), milestone, slug, title, priority }));
  return { count: list.length, list };
}

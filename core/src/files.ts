// The file contract of a spec folder and the model types of spec 002 (T1, the core seam).
//
// This module is pure TypeScript with no runtime import: the server, the plugin and the web bundle all import it.
// It holds the file kinds, one path helper and types only. The functions that build the models live one per module
// (spec.ts, timeline.ts, derived-stages.ts, events.ts, frames.ts, recut.ts, matrix.ts, locks.ts, live.ts,
// claim-view.ts, tasks.ts, evidence.ts, markdown-docs.ts) and are deliberately not re-exported here: several of them
// read the file system, and a re-export would pull that into the browser bundle.
//
// Names are stable: the server's route contract (T44) and the web client import them. FORMAT.md (T2) has one section
// per kind below, and scripts/check-format-doc.ts (T3) compares the two.

import type { Diagnostic } from './diagnostics.ts';

// ─── File kinds ──────────────────────────────────────────────────────────────────────────────────────────────────

/** Every file kind the app reads for a spec, keyed by a stable name. */
export type FileKind =
  | 'spec'
  | 'plan'
  | 'tasks'
  | 'context'
  | 'design'
  | 'constitution'
  | 'rounds'
  | 'events'
  | 'gateReviewed'
  | 'gateCodeReviewed'
  | 'artifacts'
  | 'evidence'
  | 'master';

export interface FileKindInfo {
  /** Path relative to the spec folder `specs/NNN-slug/`, POSIX separators; a directory ends in `/`. */
  readonly path: string;
  /** One line: what the file holds, for FORMAT.md and diagnostics. */
  readonly description: string;
  /** A spec folder without this file is not a spec. Only `spec.md` is required; the rest depend on type and stage. */
  readonly required: boolean;
  /** The kind is a directory, listed rather than read. */
  readonly directory: boolean;
}

export const FILE_KINDS: Readonly<Record<FileKind, FileKindInfo>> = {
  spec: {
    path: 'spec.md',
    description: 'the what: frontmatter, goal, Test Strategy, claims with stable IDs and (after: …) edges, decisions',
    required: true,
    directory: false,
  },
  plan: {
    path: 'plan.md',
    description: 'the how: approach, affected files, interfaces, risks, open points',
    required: false,
    directory: false,
  },
  tasks: {
    path: 'tasks.md',
    description: 'atomic task lines anchored to one claim each, with flags, lane, edges and paths, plus the probe mapping',
    required: false,
    directory: false,
  },
  context: {
    path: 'context.md',
    description: 'the context log: question rounds and dated decisions',
    required: false,
    directory: false,
  },
  design: {
    path: 'design.md',
    description: 'the design pass per viewport for a UI spec',
    required: false,
    directory: false,
  },
  constitution: {
    path: '../constitution.md',
    description: 'the repository constitution shared by every spec: binding rules, lanes, conformance baseline',
    required: false,
    directory: false,
  },
  rounds: {
    path: 'rounds.jsonl',
    description: 'one JSON line per implementation round: the whole board after that round',
    required: false,
    directory: false,
  },
  events: {
    path: 'events.jsonl',
    description: 'one JSON line per recorded stage transition {ts, from, to, command, actor}',
    required: false,
    directory: false,
  },
  gateReviewed: {
    path: '.gates/reviewed.json',
    description: 'the reviewed mark: hashes of spec.md, plan.md and tasks.md at release time',
    required: false,
    directory: false,
  },
  gateCodeReviewed: {
    path: '.gates/code-reviewed.json',
    description: 'the code-reviewed mark: tree and head of the reviewed working tree',
    required: false,
    directory: false,
  },
  artifacts: {
    path: 'artifacts/',
    description: 'files the tasks produced, grouped by claim',
    required: false,
    directory: true,
  },
  evidence: {
    path: '.evidence/',
    description: 'probe output that closed a claim, grouped by claim',
    required: false,
    directory: true,
  },
  master: {
    path: '../../ISA.md',
    description: 'the master ISA the spec derives from; untracked in a public repository',
    required: false,
    directory: false,
  },
};

/** The file kinds read as text (every kind but the two directories). */
export type TextFileKind = Exclude<FileKind, 'artifacts' | 'evidence'>;

/**
 * Path of a file kind for the spec folder `specDir`, normalised (`..` resolved), POSIX separators, no trailing
 * slash. Pure string work, no `node:path`, so the browser bundle can use it. `specDir` may be absolute or relative.
 */
export function specFilePath(specDir: string, kind: FileKind): string {
  const absolute = specDir.startsWith('/');
  const out: string[] = [];
  for (const segment of `${specDir}/${FILE_KINDS[kind].path}`.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..' && out.length > 0 && out[out.length - 1] !== '..') out.pop();
    else if (segment !== '..' || !absolute) out.push(segment);
  }
  return (absolute ? '/' : '') + out.join('/');
}

/** The Docs area's tabs and the file kind each renders. */
export type DocName = 'plan' | 'design' | 'decisions' | 'constitution';

export const DOC_FILES: Readonly<Record<DocName, TextFileKind>> = {
  plan: 'plan',
  design: 'design',
  decisions: 'context',
  constitution: 'constitution',
};

// ─── Inputs shared by the model functions ────────────────────────────────────────────────────────────────────────

/**
 * The raw text of one spec folder's files, read by the caller. Model functions are pure over this: a missing key
 * means the file does not exist. Never carries an absolute path.
 */
export interface SpecFiles {
  /** The spec folder name, `NNN-slug`. */
  readonly folder: string;
  readonly texts: Readonly<Partial<Record<TextFileKind, string>>>;
}

/** A commit touching the spec folder, as the server's read-only `git log` passes it in (core runs no subprocess). */
export interface CommitRecord {
  readonly sha: string;
  /** ISO 8601. */
  readonly ts: string;
  readonly subject: string;
}

// ─── Spec page (spec.ts) ─────────────────────────────────────────────────────────────────────────────────────────

export type SpecType = 'feature' | 'bug' | 'refactor' | 'spike' | 'infra' | 'project';

/** A stage name from the stage table (stage.ts, FORMAT.md); kept open here so the table stays the one authority. */
export type StageName = string;

export interface SpecHead {
  /** `NNN`. */
  readonly id: string;
  /** `NNN-slug`, the folder name. */
  readonly slug: string;
  /** The H1 without its `NNN —` prefix; the dashboard row's title when the file has no H1. */
  readonly title: string;
  /** Null when `spec_type:` is absent or unknown (the dashboard row's type). */
  readonly type: SpecType | null;
  readonly stage: StageName;
  /** The next command, e.g. `/spec-implement 002`; null when the spec is done. */
  readonly nextCommand: string | null;
  /** Why that command is next, one sentence. */
  readonly nextReason: string;
  /** Frontmatter `phase:` as written: a tooltip only, the stage is derived. */
  readonly phase: string | null;
  /** Frontmatter `started:` and `updated:` as written (ISO 8601). */
  readonly started: string | null;
  readonly updated: string | null;
  /** The highest round number in rounds.jsonl; null without rounds. */
  readonly round: number | null;
  /** ISO 8601 of the newest rounds.jsonl line; null without rounds. */
  readonly lastRound: string | null;
  /** Uncommitted files in the spec folder: a git fact only the server has, so always null from `core/`. */
  readonly uncommittedFiles: number | null;
}

/** Where the idea quote came from: the first sentence of `## Goal`, or frontmatter `task:`. */
export type IdeaSource = 'goal' | 'task';

/** The "Next step" card: the command, why, and since when the spec stands where it stands. */
export interface SpecNextStep {
  /** Equal to `head.nextCommand`. */
  readonly command: string | null;
  /**
   * At most three: the stage rule's reason first (equal to `head.nextReason`), then facts the stage table already
   * implies (the reviewed mark is fresh past the review row) and how many items wait on the principal.
   */
  readonly reasons: readonly string[];
  /** ISO 8601 of the newest events.jsonl line into the current stage; null without one. */
  readonly since: string | null;
  /** That line's `command`; null without one. */
  readonly via: string | null;
}

/** The area tiles under "Inside this spec", in this order. */
export type SpecAreaName = 'status' | 'live' | 'data' | 'docs' | 'notes' | 'board';

export const SPEC_AREAS: readonly SpecAreaName[] = ['status', 'live', 'data', 'docs', 'notes', 'board'];

/** The facts each area tile shows under its name. */
export interface SpecAreas {
  /** Timeline entries (decisions, rounds, gate marks, the commits passed in) and the spec's warnings. */
  readonly status: { readonly timelineEntries: number; readonly warnings: number };
  /** The lock source read, the sessions holding a claim of this spec, and the newest such lock. */
  readonly live: { readonly lockSource: LockSource; readonly agentsWorking: number; readonly lock: ClaimLock | null };
  /** Claims closed over live claims; tasks landed over total, null without tasks.md. */
  readonly data: {
    readonly claims: { readonly closed: number; readonly total: number };
    readonly tasks: { readonly landed: number; readonly total: number } | null;
  };
  /** Which docs exist; decisions are the context.md decision entries of the timeline. */
  readonly docs: { readonly plan: boolean; readonly design: boolean; readonly constitution: boolean; readonly decisions: number };
  /** Notes live in the server's notes table: always null from `core/`. */
  readonly notes: { readonly count: number | null };
  /** Rounds recorded, and the newest round's stop reason when it stopped early. */
  readonly board: { readonly rounds: number; readonly stop: string | null };
}

/** This spec's slice of `specs/tldr.md`. */
export interface SpecTldr {
  /** The `per-spec` items that name this spec's number, as markdown; null when none does. */
  readonly brief: string | null;
  readonly generated: string | null;
  /** This spec's `updated:` or newest round is later than `generated:` (tldr.ts `tldrState` over this spec alone). */
  readonly stale: boolean;
}

export interface KeyNumbers {
  readonly claims: { readonly closed: number; readonly total: number; readonly open: number; readonly takeable: number };
  readonly tasks: { readonly landed: number; readonly total: number };
  /** Rounds recorded in rounds.jsonl, and agents holding a lock right now. */
  readonly rounds: { readonly count: number; readonly agentsWorking: number };
  /** Gates in state fresh or ok, out of the four gates. */
  readonly gates: { readonly ok: number; readonly total: number };
  readonly waiting: number;
}

export interface LaneProgress {
  readonly name: string;
  readonly landed: number;
  readonly total: number;
}

/** fresh | stale | missing for the two marks; ok | warn | na for drift and diagrams. */
export type GateState = 'fresh' | 'stale' | 'missing' | 'ok' | 'warn' | 'na';

export interface GateView {
  readonly state: GateState;
  /** One line shown under the gate. */
  readonly detail: string;
  /** ISO 8601 time of the mark, when there is one. */
  readonly at?: string;
  /** The files a stale mark no longer matches, or the files the reviewed mark hashes. */
  readonly files?: readonly string[];
}

export interface SpecGates {
  readonly reviewed: GateView;
  readonly codeReviewed: GateView;
  readonly drift: GateView;
  readonly diagrams: GateView;
}

export type WarningKind = 'review' | 'diagrams' | 'closed' | 'fog' | 'drift';

export interface SpecWarning {
  readonly kind: WarningKind;
  readonly text: string;
  /** The command that clears it, when one does. */
  readonly command?: string;
  /** A claim ID or file the warning names. */
  readonly ref?: string;
}

export interface WaitingItem {
  readonly kind: 'operator' | 'manual' | 'question';
  /** A task id (`T17`) or claim ID (`ISC-338`). */
  readonly ref: string;
  readonly title: string;
  /** For an operator task: its checkbox. */
  readonly checked?: boolean;
}

export interface SpecPageModel {
  readonly head: SpecHead;
  readonly keyNumbers: KeyNumbers;
  /** First sentence of `## Goal`, falling back to frontmatter `task:`; null when neither exists. */
  readonly ideaQuote: string | null;
  /** Which of the two the quote came from; null with the quote. `principal_stated_goal` is never a source. */
  readonly ideaSource: IdeaSource | null;
  readonly next: SpecNextStep;
  /** One row per constitution lane in its table order, lanes only tasks.md names next, `operator` last; empty without tasks.md. */
  readonly lanes: readonly LaneProgress[];
  readonly gates: SpecGates;
  /** The dashboard row's warnings, same kinds and order. */
  readonly warnings: readonly SpecWarning[];
  /** Open operator tasks, open claims with a `manual` probe, then the newest round's questions. */
  readonly waitingOnYou: readonly WaitingItem[];
  readonly areas: SpecAreas;
  /** Null when the workspace has no `specs/tldr.md`. */
  readonly tldr: SpecTldr | null;
}

export interface SpecPageInput {
  /** The spec folder; `texts.master` and `texts.constitution` are read when present. */
  readonly files: SpecFiles;
  /** Lock sources for `agentsWorking`; absent means none were read. */
  readonly locks?: LockReading;
  /**
   * Every other spec folder of the workspace, active and archived: drift's claims held elsewhere, as the dashboard
   * row sees them. Absent means none.
   */
  readonly others?: readonly SpecFiles[];
  /** `specs/tldr.md`; absent or null when the workspace has none. */
  readonly tldr?: string | null;
  /** The worktree tree id for the code-reviewed mark, as the dashboard gets it; absent or null when not computed. */
  readonly worktreeTree?: string | null;
  /** Commits touching the spec folder, for the Status tile's timeline count; absent means none were read. */
  readonly commits?: readonly CommitRecord[];
}

// ─── Timeline (timeline.ts, derived-stages.ts, events.ts) ────────────────────────────────────────────────────────

export type TimelineKind = 'decision' | 'round' | 'gate' | 'commit' | 'stage';

export interface TimelineEntry {
  /** ISO 8601 as the source wrote it (a date alone is allowed); empty on an undated derived stage transition. */
  readonly ts: string;
  readonly kind: TimelineKind;
  /** True for a stage transition inferred from the files; false for anything recorded. */
  readonly derived: boolean;
  readonly title: string;
  readonly body?: string;
  /**
   * What the entry points at: a round number (`3`), a question id (`R1.Q2`, `goal` for the goal lock), a gate name
   * (`reviewed`, `code-reviewed`), a commit sha or a claim ID.
   */
  readonly ref?: string;
  /**
   * Stable id within the spec's timeline, safe in a URL fragment (`#t/<id>`): `<kind>-<ref>`, e.g. `decision-R1.Q2`,
   * `round-3`, `gate-reviewed`, `commit-<sha>`; a repeated id gets `-2`, `-3`, … in list order.
   */
  readonly id?: string;
  /**
   * Who the event came from, when the source records it: a decision's `- From:` line, a round's builders, an
   * events.jsonl line's `actor`. Null on a derived stage transition: nobody recorded it.
   */
  readonly actor?: string | null;
  /** True on the one decision entry built from context.md's `## Goal — confirmed <ts>` block. */
  readonly goalLock?: boolean;
  /** Stage entries: the stage before the transition; null on the first derived one, the spec's creation. */
  readonly from?: StageName | null;
  /** Stage entries: the stage the transition enters. */
  readonly to?: StageName;
  /** Stage entries from events.jsonl: the command that made the transition. */
  readonly command?: string;
  /**
   * Derived stage entries whose date the files do not give: `ts` is empty and the entry sorts right after the dated
   * transition before it (derived-stages.ts).
   */
  readonly undated?: boolean;
}

export interface TimelineInput {
  readonly files: SpecFiles;
  readonly commits: readonly CommitRecord[];
  /**
   * The validated lines of the spec's events.jsonl (T16's validator), in file order. Present and non-empty, they are
   * the stage entries and nothing is derived; absent or empty, the stage transitions are derived from the files.
   */
  readonly events?: readonly EventLine[];
}

/** One line of `events.jsonl`. */
export interface EventLine {
  readonly ts: string;
  readonly from: StageName;
  readonly to: StageName;
  readonly command: string;
  readonly actor: string;
}

export type EventValidation =
  | { readonly ok: true; readonly event: EventLine }
  | { readonly ok: false; readonly error: string };

// ─── Frames, re-cut, matrix, live (frames.ts, recut.ts, matrix.ts, live.ts) ──────────────────────────────────────

export type FrameKind = 'dispatch' | 'result' | 'live';

/** The eleven card states of the round board (ISC-88). */
export type CardState =
  | 'waiting'
  | 'dispatched'
  | 'running'
  | 'question'
  | 'concerns'
  | 'fail'
  | 'done'
  | 'closed'
  | 'absent'
  | 'operatorOpen'
  | 'operatorDone';

/** Where a lock was read: a LifeOS frontier lock file, `.spectant/activity.jsonl`, or no source at all. */
export type LockSource = 'frontier' | 'activity' | 'none';

/** A source that can actually hold a lock. */
export type AgentLockSource = Exclude<LockSource, 'none'>;

export interface ClaimLock {
  readonly source: AgentLockSource;
  readonly claim: string;
  /** The session name the lock carries. */
  readonly session: string;
  /** ISO 8601. */
  readonly since: string;
}

export interface LockReading {
  /** The source the page names: frontier when present, else activity, else none. */
  readonly source: LockSource;
  /** Every source that was present and read, frontier first. Empty when `source` is `none`. */
  readonly sources: readonly AgentLockSource[];
  /**
   * The held claims, one entry per source that holds them: activity entries first, then frontier entries, each in
   * claim-ID order. A claim held in both sources appears twice; a consumer keyed by claim with last-wins (status.ts
   * `partitionClaims`) therefore takes the frontier lock, as the page names frontier before activity.
   */
  readonly locks: readonly ClaimLock[];
  /**
   * What could not be read: a malformed lock file or activity line, a release without a claim, a stale frontier lock.
   * Never a throw. Optional so a hand-built reading (tests, other models) may omit it; `readLockSources` always sets it.
   */
  readonly diagnostics?: readonly Diagnostic[];
}

export interface LockReadInput {
  /** The repository root: `<repoRoot>/ISA.md` keys the frontier locks, `<repoRoot>/.spectant/activity.jsonl` is read. */
  readonly repoRoot: string;
  /** The LifeOS state directory when LifeOS is present; null or absent means no LifeOS path is read (ISC-37). */
  readonly lifeosStateDir?: string | null;
  /** The clock for frontier staleness; defaults to the current time. */
  readonly now?: Date;
}

export interface FrameCard {
  /** Task id, `T12`. */
  readonly task: string;
  readonly claim: string;
  readonly lane: string;
  readonly text: string;
  readonly parallel: boolean;
  readonly seam: boolean;
  readonly state: CardState;
  readonly builder?: string;
  /** The second-look reader, when one ran. */
  readonly reader?: string;
  readonly verdict?: string;
  /** Dispatches of this task so far, 1 on the first. */
  readonly tries: number;
  /** Why the card is in its state (a waiting reason, a hold reason, a fail reason). */
  readonly reason?: string;
  readonly note?: string;
  readonly lock?: { readonly source: AgentLockSource; readonly session: string };
}

export interface Frame {
  /** Position on the scrubber, 0-based. */
  readonly index: number;
  readonly kind: FrameKind;
  /** The round number; null for the live frame. */
  readonly round: number | null;
  /** ISO 8601; the live frame carries the newest file time the parser saw, never the clock. */
  readonly ts: string;
  /** Scrubber label, e.g. `R2` or `Live`. */
  readonly label: string;
  /** The worst card state in the frame. */
  readonly worst: CardState;
  readonly cards: readonly FrameCard[];
  readonly progress: {
    readonly claims: { readonly closed: number; readonly total: number };
    readonly tasks: { readonly landed: number; readonly total: number };
  };
  /** The round's stop reason, when it stopped early. */
  readonly stop?: string;
}

export interface RecutMarker {
  /** Scrubber position the marker sits before (the first frame after the re-cut). */
  readonly beforeFrame: number;
  readonly fromRound: number;
  readonly toRound: number;
  /** Task ids present before and gone after. */
  readonly struck: readonly string[];
  readonly added: readonly string[];
  /** Ids present on both sides whose text changed: renumbered, so no state carries over. */
  readonly changed: readonly string[];
}

export type MatrixColumnKind = FrameKind | 'recut';

export interface MatrixColumn {
  readonly kind: MatrixColumnKind;
  /** The frame index; null for a re-cut column. */
  readonly frame: number | null;
  readonly label: string;
}

export interface MatrixCell {
  readonly task: string;
  /** Column index into `Matrix.columns`. */
  readonly column: number;
  /** The frame the cell jumps to; null for a re-cut column. */
  readonly frame: number | null;
  /** Null where the task is absent from that frame (a dashed cell). */
  readonly state: CardState | null;
}

export interface Matrix {
  /** Task ids, one row each, in tasks.md order. */
  readonly rows: readonly string[];
  readonly columns: readonly MatrixColumn[];
  /** `cells[row][column]`. */
  readonly cells: ReadonlyArray<readonly MatrixCell[]>;
}

export interface LiveFrame extends Frame {
  readonly kind: 'live';
  readonly lockSource: LockSource;
  readonly locks: readonly ClaimLock[];
}

export interface LiveFrameInput {
  readonly files: SpecFiles;
  readonly frames: readonly Frame[];
  readonly locks: LockReading;
}

// ─── Claims and tasks (claim-view.ts, tasks.ts) ──────────────────────────────────────────────────────────────────

/** The six claim glyph states (ISC-81). */
export type ClaimGlyphState = 'open' | 'takeable' | 'taken' | 'blocked' | 'closed' | 'dropped';

export type ClaimKind = 'normal' | 'anti' | 'antecedent';

/** One row of the Test Strategy table: `isc | type | check | threshold | tool | anchors_to | severity`. */
export interface ProbeRow {
  readonly isc: string;
  readonly type: string;
  readonly check: string;
  readonly threshold: string;
  readonly tool: string;
  readonly anchorsTo: string;
  readonly severity: string;
}

export interface ClaimView {
  readonly id: string;
  readonly text: string;
  /** Feature heading the claim sits under, e.g. `F7`; null outside a feature block. */
  readonly feature: string | null;
  readonly state: ClaimGlyphState;
  readonly kind: ClaimKind;
  /** Claim IDs from `(after: …)`. */
  readonly edges: readonly string[];
  readonly probe: ProbeRow | null;
  /** The claim's line under `## Verification`, when it has one. */
  readonly verification: string | null;
  readonly noteCount: number;
}

export interface ClaimViewInput {
  readonly files: SpecFiles;
  /** For the `taken` state. */
  readonly locks?: LockReading;
  /** Notes per claim ID, from the server's notes table. */
  readonly noteCounts?: Readonly<Record<string, number>>;
}

export type TaskState = 'open' | 'done' | 'struck';

export interface TaskView {
  /** `T12`. */
  readonly id: string;
  readonly claim: string;
  readonly flags: { readonly parallel: boolean; readonly seam: boolean };
  readonly lane: string;
  readonly state: TaskState;
  /** Task ids from `(after: …)`. */
  readonly edges: readonly string[];
  readonly paths: readonly string[];
  readonly text: string;
  /** 1-based line in tasks.md, for the checkbox write. */
  readonly line: number;
}

/** One row of tasks.md § Probe Mapping. */
export interface ProbeMappingRow {
  readonly tasks: readonly string[];
  readonly claim: string;
  readonly probe: string;
}

export interface TasksModel {
  readonly tasks: readonly TaskView[];
  readonly probeMapping: readonly ProbeMappingRow[];
}

export interface TaskParseInput {
  readonly tasks: string;
  /** The constitution's text, for the lane table; absent means the lane is taken from the line as written. */
  readonly constitution?: string;
}

// ─── Evidence (evidence.ts) ──────────────────────────────────────────────────────────────────────────────────────

export interface EvidenceFile {
  /** The claim ID the file belongs to; null when its path names no claim. */
  readonly group: string | null;
  readonly dir: 'artifacts' | 'evidence';
  /** Relative to the spec folder, POSIX separators, never absolute. */
  readonly path: string;
  readonly mediaType: string;
  /** Bytes. */
  readonly size: number;
}

// ─── Docs markdown (markdown-docs.ts) ────────────────────────────────────────────────────────────────────────────

export interface TocEntry {
  readonly level: number;
  readonly text: string;
  readonly anchor: string;
}

export interface DocsPage {
  readonly html: string;
  readonly toc: readonly TocEntry[];
}

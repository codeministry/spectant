// The file contract of a spec folder and the model types of spec 002 (T1, the core seam).
//
// This module is pure TypeScript with no runtime import: the server, the plugin and the web bundle all import it.
// It holds the file kinds, one path helper and types only. The functions that build the models live one per module
// (spec.ts, timeline.ts, derived-stages.ts, events.ts, frames.ts, recut.ts, matrix.ts, locks.ts, live.ts,
// claim-view.ts, tasks.ts, evidence.ts, markdown-docs.ts) and are deliberately not re-exported here: several of them
// read the file system, and a re-export would pull that into the browser bundle.
//
// It also holds the few shared types a browser-safe module needs from a server-side one: `MarkState` (the gate marks
// of `gates.ts`) and `FileDiagnostic` (the per-file finding of `dashboard.ts`). Both modules re-export them, so their
// importers are unchanged, while `stage.ts` and `planning.ts` type-import them from here and never reach `gates.ts`
// (`node:crypto`, `Buffer`) or `dashboard.ts` in a browser typecheck (spec 003 T18).
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

/** A parse finding in one file of the workspace, relative to the repository root (`dashboard.ts` re-exports it). */
export interface FileDiagnostic {
  readonly file: string;
  readonly diagnostic: Diagnostic;
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

/** A mark's state: fresh (matches), stale (content changed since), missing (no mark). `gates.ts` re-exports it. */
export type MarkState = Extract<GateState, 'fresh' | 'stale' | 'missing'>;

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

/** `locks`: a lock source could not be read cleanly (spec 002 T115); see LockDiagnostic. */
export type WarningKind = 'review' | 'diagrams' | 'closed' | 'fog' | 'drift' | 'locks';

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

/**
 * One validated line of `events.jsonl` (events.ts, T16), keys in schema order. `from` and `to` are stage-table names
 * (stage.ts), an older lifecycle word already normalised; `from` is null only on the creation, the file's first event.
 */
export interface EventLine {
  /** ISO 8601 date-time with a zone (`Z` or an offset). */
  readonly ts: string;
  readonly from: StageName | null;
  readonly to: StageName;
  /** The command that made the transition, e.g. `/spec-review 002`; never empty. */
  readonly command: string;
  /** Who ran it, e.g. `principal`; never empty. */
  readonly actor: string;
}

/**
 * One line checked: the normalised event with the warnings its old words raised, or the one diagnostic that rejects
 * it (`event-…`; severity `warning` only for an old-word line that normalises to no transition).
 */
export type EventValidation =
  | { readonly ok: true; readonly event: EventLine; readonly warnings: readonly Diagnostic[] }
  | { readonly ok: false; readonly diagnostic: Diagnostic };

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
  readonly diagnostics?: readonly LockDiagnostic[];
}

/**
 * A lock-source diagnostic: a Diagnostic that names the claim it concerns when it concerns one (a malformed, foreign or
 * stale lock file, an activity line with a claim), so the dashboard can put it on that claim's row (spec 002 T115).
 */
export interface LockDiagnostic extends Diagnostic {
  readonly claim?: string;
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
  /** The round number; the live frame carries the last recorded round, null when rounds.jsonl has none. */
  readonly round: number | null;
  /** ISO 8601; the live frame carries the `now` its caller passed (core reads no clock). */
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
  /** The claims this frame closed: a result frame's `closed_this_round`; empty on a dispatch frame. */
  readonly closedClaims?: readonly string[];
  /**
   * Set on the dispatch frame of the first round after tasks.md changed between two rounds: ids and texts of the
   * previous line compared with this one. The hook `detectRecut` (T18, ISC-91) turns into scrubber markers.
   */
  readonly recut?: FrameRecut;
}

/** A tasks.md change seen between two consecutive rounds.jsonl lines, by task id. */
export interface FrameRecut {
  /** Ids on the previous line and gone from this one, in the previous line's order. */
  readonly struck: readonly string[];
  /** Ids new on this line, in its order. */
  readonly added: readonly string[];
  /** Ids on both lines whose text differs: renumbered or reworded, so no state carries over. In this line's order. */
  readonly changed: readonly string[];
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
  /** Null where the task has no card in that frame, and on every re-cut cell. */
  readonly state: CardState | null;
  /**
   * Why a frame cell has no card: `none` before the task's first card (an empty cell), `absent` once it had one (a
   * dashed cell: struck, or gone in a re-cut). Unset on a cell with a card and on a re-cut cell.
   */
  readonly gap?: 'none' | 'absent';
  /** On a re-cut cell: how the re-cut touched this row's id. Unset for an id the re-cut left alone. */
  readonly recut?: 'struck' | 'added' | 'changed';
}

/** One matrix row: a task id with its latest card's claim, lane and text. */
export interface MatrixRow {
  readonly task: string;
  readonly claim: string;
  readonly lane: string;
  readonly text: string;
}

export interface Matrix {
  /**
   * Task ids, one row each: every task that ever had a card, grouped by lane (the constitution's lanes in table order,
   * then lanes only the cards name, `operator` last), first seen within a lane.
   */
  readonly rows: readonly string[];
  /** `details[row]`: the row's task, claim, lane and text, in `rows` order. */
  readonly details: readonly MatrixRow[];
  readonly columns: readonly MatrixColumn[];
  /** `cells[row][column]`. */
  readonly cells: ReadonlyArray<readonly MatrixCell[]>;
}

/** A card of the live frame: a `running` card also carries its lock's time and whether it went quiet too long. */
export interface LiveCard extends FrameCard {
  /** ISO 8601: when the lock was taken. Set on `running` cards only. */
  readonly since?: string;
  /** `now − since` in milliseconds, never negative. Set on `running` cards only. */
  readonly elapsedMs?: number;
  /** No release for longer than `staleAfterMs`: the agent may have died. Set on `running` cards only. */
  readonly stale?: boolean;
}

/** One session holding locks on this spec's claims: an entry of the "This frame" rail. */
export interface LiveAgent {
  readonly session: string;
  readonly source: AgentLockSource;
  /** The claims the session holds here, in claim-ID order. */
  readonly claims: readonly string[];
  /** ISO 8601: the session's oldest lock here. */
  readonly since: string;
  readonly elapsedMs: number;
  readonly stale: boolean;
}

export interface LiveFrame extends Frame {
  readonly kind: 'live';
  readonly cards: readonly LiveCard[];
  /** The source the reading names: `frontier`, `activity` or `none`. */
  readonly lockSource: LockSource;
  /** The locks on this spec's claims, one per claim (the frontier entry wins over activity), in claim-ID order. */
  readonly locks: readonly ClaimLock[];
  /** The sessions holding those locks, oldest lock first. */
  readonly agents: readonly LiveAgent[];
  /** The cards waiting on the principal: question, then concerns, then open operator steps; board order within each. */
  readonly needsYou: readonly LiveCard[];
  /** The threshold `stale` was computed with. */
  readonly staleAfterMs: number;
}

export interface LiveFrameInput {
  /** The spec folder's texts; `constitution` (for the lane table) is read when present. */
  readonly files: SpecFiles;
  /** `buildFrames(files)` when the caller already holds it; absent means the live frame builds it. */
  readonly frames?: readonly Frame[];
  /** The lock reading of the repository (`readLockSources`); locks on other specs' claims are ignored. */
  readonly locks: LockReading;
  /** The clock: the frame's `ts` and every `elapsedMs` are measured against it. */
  readonly now: Date;
  /** A lock held longer than this without a release is stale; defaults to `LIVE_STALE_MS` (45 minutes). */
  readonly staleAfterMs?: number;
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
  /**
   * The edges still unresolved (open, or an ID the file does not hold), in edge order; non-empty exactly when the
   * state is `blocked`. Empty for a closed or dropped claim.
   */
  readonly blockedBy: readonly string[];
  readonly probe: ProbeRow | null;
  /** The claim's line under `## Verification`, when it has one. */
  readonly verification: string | null;
  /** The lock holding a `taken` claim; null in every other state. `since` is ISO 8601, elapsed time is the web's. */
  readonly lock: { readonly source: AgentLockSource; readonly session: string; readonly since: string } | null;
  /** A `[DROPPED …]` tombstone and its words (`see Decisions 2026-09-24`); null unless the state is `dropped`. */
  readonly dropped: { readonly note: string | null } | null;
  readonly noteCount: number;
  /** 1-based line in spec.md. */
  readonly line: number;
}

/** A feature heading the Claims tab groups cards under. */
export interface ClaimFeatureView {
  /** `F2`. */
  readonly id: string;
  /** The heading after `F2 ·`. */
  readonly title: string;
  /** The `Why:` line, without the prefix; null when the block has none. */
  readonly why: string | null;
  /** Claim IDs in the block, in file order. */
  readonly claims: readonly string[];
}

/** One `- fog: <question> — <what must resolve it>` line under `## Not yet specified`. */
export interface FogView {
  /** The question: the text before the first spaced em or en dash, or the whole line without one. */
  readonly text: string;
  /** What must resolve it: the text after that dash; null without one. */
  readonly resolves: string | null;
  /** The round named by `since round N` (or `since RN`) in the line; null when the line names none. */
  readonly sinceRound: number | null;
  /** Trailing marks as written. */
  readonly marks: readonly string[];
  /** 1-based line in spec.md. */
  readonly line: number;
}

/**
 * The Claims tab's counts: one per glyph state (the filter row), `all` over every card, `open` as the aggregate of
 * takeable, taken and blocked, and one per kind. Equal to the dashboard row: `closed` is `progress.closed`,
 * `all - dropped` is `progress.total`, `takeable` is `takeable.length` (ISC-72).
 */
export interface ClaimViewCounts {
  readonly all: number;
  readonly open: number;
  readonly takeable: number;
  readonly taken: number;
  readonly blocked: number;
  readonly closed: number;
  readonly dropped: number;
  readonly normal: number;
  readonly anti: number;
  readonly antecedent: number;
}

/** The Claims tab (ISC-81): cards in file order, the feature headings, the fog list and the filter counts. */
export interface ClaimViewModel {
  readonly claims: readonly ClaimView[];
  readonly features: readonly ClaimFeatureView[];
  readonly fog: readonly FogView[];
  readonly counts: ClaimViewCounts;
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
  /** The first cell's task ids, ranges (`T3–T8`) expanded. */
  readonly tasks: readonly string[];
  readonly claim: string;
  /** The probe cell as written, `\|` unescaped. */
  readonly probe: string;
  /** 1-based line in tasks.md. */
  readonly line: number;
}

/** What `takeable.ts` reads: the task lines and the probe mapping. `parseTaskLines` returns the richer `TasksTab`. */
export interface TasksModel {
  readonly tasks: readonly TaskView[];
  readonly probeMapping: readonly ProbeMappingRow[];
}

/**
 * A task's state on the Tasks tab (ISC-82): the newest rounds.jsonl result card of the same task (same id, same
 * text) where one exists, else the checkbox (`open` / `done`); `struck` for a struck bullet. A checked box outranks a
 * round that left the task unfinished (the box was ticked after it); an operator task the round held is `open`.
 */
export type TaskStatus = 'open' | 'dispatched' | 'held' | 'question' | 'concerns' | 'fail' | 'done' | 'closed' | 'struck';

/** One task line as the Tasks tab renders it: the grammar fields of `TaskView` plus the round state. */
export interface TaskRow extends TaskView {
  readonly status: TaskStatus;
  /** The round whose result card decided `status`; null when the checkbox or the strike decided it. */
  readonly round: number | null;
  /** The builder the deciding round card names. */
  readonly builder: string | null;
  /** The deciding round card's reason (a hold, fail or question reason). */
  readonly reason: string | null;
  /** A struck task's note after `~~ — `, e.g. `struck 2026-09-29: …`. */
  readonly note: string | null;
  /** A path column that names no file, e.g. `probe only, Interceptor` from `· (probe only, Interceptor)`. */
  readonly pathNote: string | null;
}

/** A filter chip: a lane or status and how many rows carry it. */
export interface TaskCount {
  readonly name: string;
  readonly count: number;
}

export interface TasksTab extends TasksModel {
  readonly tasks: readonly TaskRow[];
  readonly counts: {
    /** Every row, struck ones included. */
    readonly rows: number;
    /** The checkbox lines only (struck bullets are none): the fraction archive.ts and the dashboard count. */
    readonly boxes: { readonly landed: number; readonly total: number };
    /** Constitution lanes in table order, then lanes only tasks.md names (first seen), `operator` last; only lanes with rows. */
    readonly byLane: readonly TaskCount[];
    /** `TaskStatus` order, only statuses with rows. */
    readonly byStatus: readonly TaskCount[];
  };
  /** Malformed lines, unknown lanes, dangling edges and probe-mapping gaps; the parser never throws. */
  readonly diagnostics: readonly Diagnostic[];
}

export interface TaskParseInput {
  readonly tasks: string;
  /** The constitution's text, for the lane table; absent means the lane is taken from the line as written. */
  readonly constitution?: string;
  /** rounds.jsonl, for the round state of each task; absent means the checkboxes decide. */
  readonly rounds?: string;
}

// ─── Evidence (evidence.ts) ──────────────────────────────────────────────────────────────────────────────────────

/** The two listed folders: `artifacts/` (task results) and `.evidence/` (raw probe output), by file kind name. */
export type EvidenceGroup = Extract<FileKind, 'artifacts' | 'evidence'>;

/** Why a requested evidence path does not resolve. `outside` and `symlink-escape` are refusals; the rest are absences. */
export type EvidenceRefusal = 'outside' | 'not-found' | 'not-a-file' | 'symlink-escape';

export interface EvidenceFile {
  readonly group: EvidenceGroup;
  /** Relative to the spec folder, POSIX separators, never absolute: `artifacts/T12-dashboard-model.md`. */
  readonly path: string;
  /** The last path segment. */
  readonly name: string;
  /** Size of the file, or of a symlink's confined target; 0 for a refused symlink. */
  readonly bytes: number;
  /** From the extension; `application/octet-stream` when unknown. */
  readonly mediaType: string;
  /** `T<n>` when the file name starts with it (`T12-dashboard-model.md`); else null. */
  readonly task: string | null;
  /**
   * The claim the file belongs to: a claim ID of the spec that a path segment is, or starts with (`ISC-61/…`,
   * `ISC-61-shot.png`, the longest ID wins); else the first `## Verification` line naming the file by its path or bare
   * name. Null when neither does.
   */
  readonly claim: string | null;
  /** Set on a symbolic link; it is never followed out of `artifacts/` or `.evidence/`. */
  readonly symlink?: true;
  /** Set on a symlink that does not resolve inside the two folders; such a file is listed, never served. */
  readonly refused?: EvidenceRefusal;
}

/** The Evidence tab's model (evidence.ts `listEvidence`). No mtime: dates would make the golden move with a checkout. */
export interface EvidenceListing {
  /** `artifacts/`, sorted by path. */
  readonly results: readonly EvidenceFile[];
  /** `.evidence/`, sorted by path. */
  readonly raw: readonly EvidenceFile[];
  /** Files with a claim, keyed by claim ID in the spec's claim order; results before raw, each by path. */
  readonly byClaim: Readonly<Record<string, readonly EvidenceFile[]>>;
  /** Files without a claim, results before raw. */
  readonly ungrouped: readonly EvidenceFile[];
  /** A folder or symlink that was not listed or not followed. Never an absolute path. */
  readonly diagnostics: readonly Diagnostic[];
}

export interface EvidenceOptions {
  /** `spec.md` as the caller already read it; absent means `listEvidence` reads it from the spec folder. */
  readonly specText?: string;
}

/** `resolveEvidencePath`: the real path to serve, and the normalised request, or why nothing is served. */
export type EvidencePathResult =
  | { readonly ok: true; readonly absolute: string; readonly path: string }
  | { readonly ok: false; readonly reason: EvidenceRefusal };

// ─── Docs markdown (markdown-docs.ts) ────────────────────────────────────────────────────────────────────────────

export interface TocEntry {
  readonly level: number;
  readonly text: string;
  readonly anchor: string;
}

/**
 * A numbered figure of a rendered document; `index` is its `data-figure` attribute, 1-based in document order.
 * A mermaid figure carries its source for the web app to draw client-side; nothing is rendered in core.
 */
export interface MermaidFigure {
  readonly index: number;
  readonly kind: 'mermaid';
  /** The diagram keyword on the first content line: `flowchart`, `erDiagram`, `sequenceDiagram`, … */
  readonly diagram: string;
  /** The fence body verbatim (unescaped). */
  readonly source: string;
  /** The mermaid `title:`, else the heading the figure sits under, else the diagram keyword. */
  readonly caption: string;
}

/** A standalone image paragraph. The file is never read: the caller only says whether it exists. */
export interface ImageFigure {
  readonly index: number;
  readonly kind: 'image';
  /** As written: relative to the document's folder, or an address off the machine (`remote`). */
  readonly src: string;
  readonly alt: string;
  /** The alt text, else the file name. */
  readonly caption: string;
  /** The caller said the file does not exist: no `<img>` is emitted. Absent when present or not asked. */
  readonly missing?: true;
  /** The source is not a relative path: never loaded, only linked. */
  readonly remote?: true;
}

export type DocsFigure = MermaidFigure | ImageFigure;

/** Every heading of a document, in order, every level. */
export interface DocsSection {
  readonly id: string;
  readonly heading: string;
  readonly level: number;
}

/** What the one renderer (`markdown.ts`) returns: sanitised HTML, every heading, and the figures it numbered. */
export interface RenderedMarkdown {
  readonly html: string;
  /** Every heading, every level (the Brief shows them all). */
  readonly toc: readonly TocEntry[];
  /** Empty unless rendered in document mode. */
  readonly figures: readonly DocsFigure[];
}

/** One Docs tab page (`markdown-docs.ts`). */
export interface DocsPage {
  /** Sanitised: every text escaped, raw HTML never passed through, only the renderer's own tags. */
  readonly html: string;
  /** h2 and h3 only, ids unique within the page. */
  readonly toc: readonly TocEntry[];
  /** The flat `key: value` frontmatter, values unquoted, in file order; null when the file has none. */
  readonly frontmatter: Readonly<Record<string, string>> | null;
  readonly figures: readonly DocsFigure[];
  readonly sections: readonly DocsSection[];
  /** Words of prose: code blocks and diagram sources not counted. */
  readonly wordCount: number;
}

/** Whether a Docs tab belongs to a spec type's workflow, and the command that writes its file (no spec number). */
export interface DocAvailability {
  readonly applies: boolean;
  readonly command: string | null;
}

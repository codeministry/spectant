// The dashboard model (T39, ISC-16): the seam between `core/`, `server/` and `web/`. The server returns it from
// `GET /api/workspaces/:slug/dashboard` (plan.md § Interfaces), the web app renders it, and each fixture's golden
// snapshot is one of these. It never carries an absolute path: a workspace is its slug, a spec its id and folder name,
// a file a path relative to the repository root (ISC-3).
//
// `buildDashboard` is pure over text the caller read, and composes the other modules only; it parses nothing itself.
// The chain per spec, as the old SpecDashboard `collect()` ran it: frontmatter and claims → partitionClaims → the two
// gate marks → stage and next command → driftReport against the master → diagramVerdict → warnings. Then the TL;DR
// state, the archive listing, the KPIs and the rows in action order. Malformed input becomes a FileDiagnostic, never
// a throw.
//
// The web app imports this file's types only (`import type`, and the barrel re-exports types only), so the runtime
// imports below (gates hashing through `node:crypto`, for one) never reach the browser bundle.
import { listArchive } from './archive.ts';
import type { ArchivedSpec } from './archive.ts';
import { parseClaims } from './claims.ts';
import type { ClaimsDocument } from './claims.ts';
import type { Diagnostic } from './diagnostics.ts';
import { diagramVerdict } from './diagrams.ts';
import type { DiagramVerdict } from './diagrams.ts';
import { specFilePath } from './files.ts';
import type { AgentLockSource, ClaimLock, FileDiagnostic, FileKind, GateView, LockDiagnostic, LockReading, SpecFiles, SpecGates, SpecType, SpecWarning, WarningKind } from './files.ts';
import { parseFrontmatter } from './frontmatter.ts';
import type { Progress } from './frontmatter.ts';
import { gateState, readGateMark, reviewedGate } from './gates.ts';
import type { GateCheck, GateMarkReading, GateName, ReviewedFile } from './gates.ts';
import { specIdOf, specSlugOf } from './spec-ref.ts';
import { nextCommandWithReason } from './stage.ts';
import type { Stage } from './stage.ts';
import { driftReport, hasDrift, heldLocks, masterProgressMismatch, partitionClaims } from './status.ts';
import type { DriftClass, DriftReport } from './status.ts';
import { parseTldr, tldrState } from './tldr.ts';

/** The key numbers above the spec list. */
export interface DashboardKpis {
  /** Active (not archived) spec folders. */
  readonly specs: number;
  /** Active specs at stage build, blocked or code-review. */
  readonly building: number;
  /** Active specs at any other stage but done. */
  readonly scoping: number;
  /** The master's recounted progress, e.g. 101/124; null without a master or without a claim section in it. */
  readonly master: Progress | null;
  /** Live claims over the open (active, not done) specs. */
  readonly claims: Progress;
  /** Tasks over the open specs. */
  readonly tasks: { readonly landed: number; readonly total: number };
  /** Takeable claims over the active specs. */
  readonly takeable: number;
  /** Warnings over the active specs. */
  readonly warnings: number;
  /** Fog lines over the master and the active specs. */
  readonly fog: number;
  /** The Attention tile: warnings plus open fog. */
  readonly attention: number;
  /** Folders under `specs/archive/`. */
  readonly archived: number;
}

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
  /** Frontmatter `phase:` as written: a tooltip only, the stage is derived. */
  readonly phase: string | null;
  readonly stage: Stage;
  /** Live claims, closed over total. */
  readonly progress: Progress;
  /** Null when the spec has no tasks.md. */
  readonly tasks: { readonly landed: number; readonly total: number } | null;
  /** E.g. `/spec-implement 002`; null for a complete spec. */
  readonly nextCommand: string | null;
  /** Why that command is next, one phrase (e.g. `ISC-334 is takeable`). */
  readonly nextReason: string;
  /** Claim IDs takeable now. */
  readonly takeable: readonly string[];
  /** Claims of this spec a lock holds, one entry per claim, in claim-ID order; empty without locks. Additive (T115). */
  readonly taken: readonly DashboardTakenClaim[];
  readonly warnings: readonly SpecWarning[];
  readonly gates: SpecGates;
  readonly fog: number;
  /** Frontmatter `updated:`. */
  readonly updated: string | null;
  /** ISO 8601 of the newest `rounds.jsonl` line; null without rounds. */
  readonly lastRound: string | null;
  /** The first prose paragraph under `## Goal`, on one line. */
  readonly goal: string;
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
}

/** A parse finding per file lives in `files.ts`, so `planning.ts` types it without reaching this module. */
export type { FileDiagnostic } from './files.ts';

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
}

/** Everything the model is built from, read by the caller; pure over it. */
export interface DashboardInput {
  /** `ISA.md` at the repository root; null when absent. */
  readonly master: string | null;
  /** `specs/constitution.md`; null when absent. */
  readonly constitution: string | null;
  /** `specs/tldr.md`; null when absent. */
  readonly tldr: string | null;
  /** Folders directly under `specs/`. */
  readonly specs: readonly SpecFiles[];
  /** Folders under `specs/archive/`. */
  readonly archived: readonly SpecFiles[];
  /** The worktree tree id computed in memory for the code-reviewed mark; null when it could not be computed. */
  readonly worktreeTree?: string | null;
  readonly locks?: LockReading;
  readonly services?: readonly LocalService[];
}

/** The stage table's order, for the stage counts. */
const STAGES: readonly Stage[] = ['plan', 'tasks', 'review', 'build', 'blocked', 'code-review', 'close', 'done'];

/** The order the lists show specs in: the action they need, nearest to done first, done last (old ACTION_ORDER). */
export const ACTION_ORDER: readonly Stage[] = ['close', 'code-review', 'review', 'build', 'blocked', 'tasks', 'plan', 'done'];

/** Stages counted as building on the KPI split; every other stage but done is scoping. */
const BUILDING: ReadonlySet<Stage> = new Set<Stage>(['build', 'blocked', 'code-review']);

/** Warning kinds in the order the old dashboard listed them on a row. */
const WARNING_ORDER: readonly WarningKind[] = ['drift', 'review', 'diagrams', 'closed', 'fog', 'locks'];

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
}

/** A probed listener as the model's LocalService: a loopback URL, labelled only when the constitution names the port. */
export function toLocalService(service: ProbedService, labels: ReadonlyMap<number, string>): LocalService {
  return {
    port: service.port,
    url: `http://localhost:${service.port}`,
    process: service.kind,
    label: labels.get(service.port) ?? null,
    ...(service.worktree === undefined ? {} : { worktree: service.worktree }),
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
  /** Claim IDs of the active folders: a lock diagnostic naming one of them lands on its row only. */
  readonly activeIds: ReadonlySet<string>;
  readonly worktreeTree: string | null;
}

const ACTIVITY_FILE = '.spectant/activity.jsonl';

/**
 * A lock diagnostic as a row warning: the source file (and line) first, then the reader's sentence; `ref` is the claim
 * it names, else the activity file when it came from there.
 */
function lockWarning(d: LockDiagnostic): SpecWarning {
  const activity = d.code.startsWith('locks-activity');
  const where = activity ? `${ACTIVITY_FILE}${d.line === undefined ? '' : ` line ${d.line}`}` : 'LifeOS frontier locks';
  const ref = d.claim ?? (activity ? ACTIVITY_FILE : undefined);
  return { kind: 'locks', text: `${where}: ${d.message}`, ...(ref === undefined ? {} : { ref }) };
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
  const plan = f.texts.plan ?? null;
  const fm = parseFrontmatter(spec);
  const doc = parseClaims(spec);
  // The review gate first: the partition takes the reviewed mark's state (ISC-99), so every count below follows it.
  const { reading: reviewedMark, check: reviewed } = reviewedGate(f.texts);
  const partition = partitionClaims(doc.claims, ctx.locks, reviewed.state);
  const ids = new Set(doc.claims.map((c) => c.id));
  const taken = heldLocks(ctx.locks, ids).map((l): DashboardTakenClaim => ({ id: l.claim, session: l.session, since: l.since, source: l.source }));
  // The gate's own diagnostic is not a file warning: the row's stage and reason already name the mark (`review`).
  const partitionWarnings = partition.diagnostics.filter((d) => d.code !== 'status-review-gate');
  note('spec', [...fm.diagnostics, ...doc.diagnostics, ...partitionWarnings]);

  const codeMark = readMark('code-reviewed', f.texts.gateCodeReviewed);
  note('gateReviewed', reviewedMark?.diagnostics ?? []);
  note('gateCodeReviewed', codeMark?.diagnostics ?? []);
  const codeReviewed = gateState('code-reviewed', codeMark?.mark ?? null, { worktreeTree: ctx.worktreeTree });

  const { specType: type, phase } = fm.data;
  const next = nextCommandWithReason({
    number: id,
    type,
    phase,
    hasPlan: plan !== null,
    hasTasks: f.texts.tasks !== undefined,
    claims: doc.counted,
    reviewed: reviewed.state,
    codeReviewed: codeReviewed.state,
    takeable: partition.takeable,
    partition: {
      takeable: partition.takeable.length,
      open: partition.open.length - partition.takeable.length,
      closed: partition.closed.length - partition.dropped.length,
      dropped: partition.dropped.length,
    },
  });

  const drift = ctx.master === null ? null : driftReport({ frontmatter: fm, spec: doc, master: ctx.master, heldElsewhere: heldElsewhere(ctx, f.folder) });
  const diagrams = diagramVerdict({ type, phase, spec, plan });
  const fog = doc.fog.length;
  const rounds = newestRound(f.texts.rounds);
  note('rounds', rounds.diagnostics);

  // As the old collect(): drift always; the rest only while the spec is open, since completing it closed them.
  const warnings: SpecWarning[] = [];
  if (drift !== null && hasDrift(drift)) {
    warnings.push({ kind: 'drift', text: `drift to the master: ${driftClasses(drift).join(', ')}`, command: `/spec-sync ${id}` });
  }
  if (phase !== 'complete') {
    if (reviewed.state !== 'fresh') {
      const text = reviewed.state === 'stale' ? `reviewed mark is stale (${reviewed.changed.join(', ') || 'unreadable'})` : 'no reviewed mark yet';
      warnings.push({ kind: 'review', text, command: `/spec-review ${id}` });
    }
    // Only the files that exist: a missing plan is the next command's business, not a diagram warning.
    const missing = diagrams.missing.filter((file) => file === 'spec.md' || plan !== null);
    if (diagrams.level === 'fail' && missing.length > 0) {
      warnings.push({ kind: 'diagrams', text: `diagram missing in ${missing.join(', ')}`, ref: missing.join(', ') });
    }
    if (doc.counted.total > 0 && doc.counted.closed === doc.counted.total) {
      warnings.push({ kind: 'closed', text: 'every claim closed, phase not complete' });
    }
    if (fog > 0) warnings.push({ kind: 'fog', text: plural(fog, 'open fog line') });
    // A diagnostic naming an active claim concerns that claim's row; any other one (an unreadable source, a line without
    // a claim) may hide a lock from every open spec, so each open row carries it.
    for (const d of ctx.lockDiagnostics) {
      if (d.claim === undefined || !ctx.activeIds.has(d.claim) || ids.has(d.claim)) warnings.push(lockWarning(d));
    }
  }

  // The archive listing's summary of a folder (title fallback, task counts, goal) serves an active folder as well.
  const summary = listArchive([f])[0];
  return {
    id,
    slug: f.folder,
    title: summary?.title ?? specSlugOf(f.folder),
    type,
    phase,
    stage: next.stage,
    progress: doc.counted,
    tasks: f.texts.tasks === undefined ? null : (summary?.tasks ?? { landed: 0, total: 0 }),
    nextCommand: next.command,
    nextReason: next.reason,
    takeable: partition.takeable,
    taken,
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
    goal: summary?.goal ?? '',
  };
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
  for (const f of [...active, ...archived]) {
    if (f.texts.spec !== undefined) idsByFolder.set(f.folder, new Set(parseClaims(f.texts.spec).claims.map((c) => c.id)));
  }
  const activeIds = new Set(active.flatMap((f) => [...(idsByFolder.get(f.folder) ?? [])]));
  const ctx: SpecContext = {
    master,
    idsByFolder,
    locks: input.locks?.locks ?? [],
    lockDiagnostics: input.locks?.diagnostics ?? [],
    activeIds,
    worktreeTree: input.worktreeTree ?? null,
  };

  const rows = active.flatMap((f) => specRow(f, ctx, diagnostics) ?? []).sort(byAction);
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
    brief = { markdown: parseFrontmatter(input.tldr).body.trim(), generated: tldr.generated, stale: state.stale, sections: tldr.sections };
  }

  const stageCounts = Object.fromEntries(STAGES.map((stage) => [stage, rows.filter((r) => r.stage === stage).length])) as Record<Stage, number>;
  const open = rows.filter((r) => r.stage !== 'done');
  const warnings = sum(rows, (r) => r.warnings.length);
  const fog = masterFog + sum(rows, (r) => r.fog);
  const kpis: DashboardKpis = {
    specs: rows.length,
    building: rows.filter((r) => BUILDING.has(r.stage)).length,
    scoping: open.filter((r) => !BUILDING.has(r.stage)).length,
    master: master !== null && master.section !== null ? master.counted : null,
    claims: { closed: sum(open, (r) => r.progress.closed), total: sum(open, (r) => r.progress.total) },
    tasks: { landed: sum(open, (r) => r.tasks?.landed ?? 0), total: sum(open, (r) => r.tasks?.total ?? 0) },
    takeable: sum(rows, (r) => r.takeable.length),
    warnings,
    fog,
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
  };
}

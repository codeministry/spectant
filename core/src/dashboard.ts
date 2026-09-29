// The dashboard model (T39, ISC-16): the seam between `core/`, `server/` and `web/`. The server returns it from
// `GET /api/workspaces/:slug/dashboard` (plan.md § Interfaces), the web app renders it, and each fixture's golden
// snapshot is one of these. It never carries an absolute path.
//
// The types are imported by the browser bundle: every import here is `import type`, so nothing of the assembling
// modules (gates hashing, for one) reaches the web app through this file.
// Stub from the T33 seam: the fill-in task replaces the body and keeps the exported names and types.
import type { ArchivedSpec } from './archive.ts';
import type { Diagnostic } from './diagnostics.ts';
import type { LockReading, SpecFiles, SpecGates, SpecType, SpecWarning, WarningKind } from './files.ts';
import type { Progress } from './frontmatter.ts';
import type { Stage } from './stage.ts';

/** The key numbers above the spec list. */
export interface DashboardKpis {
  /** Active (not archived) spec folders. */
  readonly specs: number;
  /** The master's recounted progress, e.g. 101/124; null without a master. */
  readonly master: Progress | null;
  /** Live claims over the active specs. */
  readonly claims: Progress;
  readonly tasks: { readonly landed: number; readonly total: number };
  /** Takeable claims over the active specs. */
  readonly takeable: number;
  /** Warnings over the active specs. */
  readonly warnings: number;
  /** Fog lines over the master and the active specs. */
  readonly fog: number;
}

/** One active spec, as a row of the Specs panel and an entry of Next up. */
export interface DashboardSpecRow {
  /** `NNN`. */
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
  /** Claim IDs takeable now. */
  readonly takeable: readonly string[];
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
  readonly markdown: string;
  readonly generated: string | null;
  readonly stale: boolean;
}

/** A local listener that belongs to the workspace, for the live indicator (loopback only). */
export interface LocalService {
  readonly port: number;
  readonly url: string;
  readonly process: string;
  /** From the constitution's `dev_services:` (`4200=Web dev`); null when unnamed. */
  readonly label: string | null;
}

/** A parse finding in one file of the workspace, relative to the repository root. */
export interface FileDiagnostic {
  readonly file: string;
  readonly diagnostic: Diagnostic;
}

export interface DashboardModel {
  readonly kpis: DashboardKpis;
  readonly stageCounts: Readonly<Record<Stage, number>>;
  /** Active specs in action order: nearest to done first, done last. */
  readonly specs: readonly DashboardSpecRow[];
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

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- stub parameters; the fill-in uses them and drops this line
export function buildDashboard(_input: DashboardInput): DashboardModel {
  throw new Error('not implemented: buildDashboard');
}

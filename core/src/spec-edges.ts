// Spec edges resolved (spec 025): a three-digit number in the `(after: …)` of a task or a claim waits on the whole spec
// with that number (ISC-162). `resolveEdges` turns every such edge of the active specs into a `SpecEdge`, `open` or
// `met`, and sums per spec what waits (`SpecWait`).
//
// When an edge is met (ISC-162.1): the server reads git, read-only and without a fetch, and hands the merge state in as
// `MergeState` rows; `core/` runs no git. An edge is met when the target spec has a branch (`feature/`, `fix/`,
// `spike/` or `infra/` plus `NNN-slug`) and that branch is an ancestor of `main`; without such a branch, when the
// target carries `phase: complete` or lives under `specs/archive/`; else it is open. A target the rows leave out is
// read from the model: no branch, `complete` from its frontmatter, `archived` from the archive list.
//
// What is wrong is a warning, never a stop (ISC-162.4): an edge on a number no spec carries and a cycle over spec edges
// each give one `Diagnostic` of level warning, and an edge in a cycle stays open whatever the merge state says.
//
// Pure: texts in, model out, no file system, no Node or Bun API, so it rides the barrel.
import { parseClaims } from './claims.ts';
import type { Diagnostic } from './diagnostics.ts';
import { specFilePath } from './files.ts';
import type { FileDiagnostic, MergeState, SpecEdge, SpecFiles, SpecWait } from './files.ts';
import { parseFrontmatter } from './frontmatter.ts';
import { specIdOf } from './spec-ref.ts';
import { parseTaskLines } from './tasks.ts';

/** What `resolveEdges` reads: the folders of the workspace, as `DashboardInput` carries them. */
export interface SpecEdgesModel {
  /** Folders directly under `specs/`: the specs whose edges are read. */
  readonly specs: readonly SpecFiles[];
  /** Folders under `specs/archive/`: targets only; an archived spec's own edges are not read. */
  readonly archived: readonly SpecFiles[];
  /** `specs/constitution.md`, for the task lanes; null or absent when missing. */
  readonly constitution?: string | null;
}

export interface ResolvedSpecEdges {
  /** Every spec edge of the active specs: spec order, then claims in line order, then tasks in line order. */
  readonly edges: readonly SpecEdge[];
  /** One row per active spec, in spec order, also for a spec that waits on nothing. */
  readonly waits: readonly SpecWait[];
  /** `spec-edge-unknown` and `spec-edge-cycle`, each of level warning; see `edgeDiagnostics` for count and place. */
  readonly diagnostics: readonly FileDiagnostic[];
}

/** One edge as read, with its carrier's place; the line feeds the diagnostics. */
interface ReadEdge {
  readonly fromSpec: string;
  readonly fromKind: 'task' | 'claim';
  readonly fromId: string;
  readonly toSpec: string;
  /** The folder of the carrying spec and the file kind the edge sits in. */
  readonly folder: string;
  readonly line: number;
}

/** One active spec, parsed once: its edges, its open claims and open tasks. */
interface ReadSpec {
  readonly num: string;
  readonly folder: string;
  readonly edges: readonly ReadEdge[];
  /** Open claims (unchecked, not dropped), by ID. */
  readonly openClaims: readonly string[];
  /** Open tasks (`state: open`): id and claim; their own edges are in `edges`. */
  readonly openTasks: ReadonlyArray<{ readonly id: string; readonly claim: string }>;
}

function readSpec(files: SpecFiles, num: string, constitution: string | undefined): ReadSpec {
  const edges: ReadEdge[] = [];
  const openClaims: string[] = [];
  const openTasks: Array<{ id: string; claim: string }> = [];
  const specText = files.texts.spec;
  if (specText !== undefined) {
    for (const claim of parseClaims(specText).claims) {
      if (!claim.checked && !claim.dropped) openClaims.push(claim.id);
      for (const toSpec of claim.afterSpecs) {
        edges.push({ fromSpec: num, fromKind: 'claim', fromId: claim.id, toSpec, folder: files.folder, line: claim.line });
      }
    }
  }
  const tasksText = files.texts.tasks;
  if (tasksText !== undefined) {
    const tab = parseTaskLines(constitution === undefined ? { tasks: tasksText } : { tasks: tasksText, constitution });
    for (const task of tab.tasks) {
      if (task.state === 'open') openTasks.push({ id: task.id, claim: task.claim });
      for (const toSpec of task.afterSpecs ?? []) {
        edges.push({ fromSpec: num, fromKind: 'task', fromId: task.id, toSpec, folder: files.folder, line: task.line });
      }
    }
  }
  return { num, folder: files.folder, edges, openClaims, openTasks };
}

/**
 * Whether a spec edge on `target` is met by its merge state (ISC-162.1): with a branch, only a merged one meets it;
 * without one, `phase: complete` or the archive does.
 */
export function edgeMet(target: MergeState): boolean {
  return target.branch !== null ? target.merged : target.complete || target.archived;
}

/** The merge state of every known spec number: the server's rows first, the model's frontmatter and archive after. */
function mergeStates(model: SpecEdgesModel, rows: readonly MergeState[]): Map<string, MergeState> {
  const states = new Map<string, MergeState>();
  for (const row of rows) if (!states.has(row.spec)) states.set(row.spec, row);
  const fromModel = (files: SpecFiles, archived: boolean): void => {
    const spec = specIdOf(files.folder);
    if (spec === null || states.has(spec)) return;
    const complete = files.texts.spec !== undefined && parseFrontmatter(files.texts.spec).data.phase === 'complete';
    states.set(spec, { spec, branch: null, merged: false, complete, archived });
  };
  for (const files of model.specs) fromModel(files, false);
  for (const files of model.archived) fromModel(files, true);
  return states;
}

/** The active specs of the model with a `NNN-` folder, each number once (the first folder wins). */
function activeSpecs(model: SpecEdgesModel): ReadSpec[] {
  const seen = new Set<string>();
  const out: ReadSpec[] = [];
  for (const files of model.specs) {
    const num = specIdOf(files.folder);
    if (num === null || seen.has(num)) continue;
    seen.add(num);
    out.push(readSpec(files, num, model.constitution ?? undefined));
  }
  return out;
}

/**
 * Resolve every spec edge of the active specs against the merge state (ISC-162.1) and sum per spec what waits.
 * `mergeState` holds the server's rows; a spec it leaves out is read from the model (see the file header). An edge on a
 * number no spec carries stays open, and so does an edge between two specs of one cycle (ISC-162.4).
 *
 * `SpecWait`: `blockers` are the targets of the open edges on open work (an open claim or an open task), ascending,
 * each once. `heldTasks` counts the open tasks with an open edge of their own or on their claim. `full` holds when the
 * spec has open tasks and every one is held, or, with no open task, when it has open claims and every one carries an
 * open edge.
 */
export function resolveEdges(model: SpecEdgesModel, mergeState: readonly MergeState[]): ResolvedSpecEdges {
  const states = mergeStates(model, mergeState);
  const specs = activeSpecs(model);
  const cycles = findCycles(specs);
  const cycleOf = new Map<string, Cycle>();
  for (const cycle of cycles) for (const num of cycle.members) cycleOf.set(num, cycle);

  const isOpen = (edge: ReadEdge): boolean => {
    if (cycleOf.get(edge.fromSpec)?.members.has(edge.toSpec) === true) return true;
    const target = states.get(edge.toSpec);
    return target === undefined || !edgeMet(target);
  };

  const edges: SpecEdge[] = [];
  const waits: SpecWait[] = [];
  for (const spec of specs) {
    const openEdges = new Map<string, string[]>();
    for (const edge of spec.edges) {
      const open = isOpen(edge);
      edges.push({ fromSpec: edge.fromSpec, fromKind: edge.fromKind, fromId: edge.fromId, toSpec: edge.toSpec, state: open ? 'open' : 'met' });
      if (!open) continue;
      const key = `${edge.fromKind}:${edge.fromId}`;
      openEdges.set(key, [...(openEdges.get(key) ?? []), edge.toSpec]);
    }
    const blockers = new Set<string>();
    const heldClaims = new Set<string>();
    for (const id of spec.openClaims) {
      const on = openEdges.get(`claim:${id}`);
      if (on === undefined) continue;
      heldClaims.add(id);
      on.forEach((n) => blockers.add(n));
    }
    let heldTasks = 0;
    for (const task of spec.openTasks) {
      const own = openEdges.get(`task:${task.id}`) ?? [];
      own.forEach((n) => blockers.add(n));
      if (own.length > 0 || heldClaims.has(task.claim)) heldTasks += 1;
    }
    const openTasks = spec.openTasks.length;
    const full = openTasks > 0 ? heldTasks === openTasks : spec.openClaims.length > 0 && heldClaims.size === spec.openClaims.length;
    waits.push({ spec: spec.num, blockers: [...blockers].sort(), heldTasks, openTasks, full });
  }
  return { edges, waits, diagnostics: edgeDiagnostics(model, specs, cycles) };
}

// ─── diagnostics (ISC-162.4) ─────────────────────────────────────────────────────────────────────────────────────

/** One cycle over spec edges: a strongly connected group of active specs, with the path the warning names. */
interface Cycle {
  readonly members: ReadonlySet<string>;
  /** The lowest number in the group, which carries the warning. */
  readonly carrier: string;
  /** A shortest path from the carrier back to itself, `[carrier, …, carrier]`. */
  readonly path: readonly string[];
}

/**
 * Every cycle over the spec edges of the active specs: each strongly connected group of two or more specs, and each
 * spec with an edge on its own number. Tarjan's algorithm; the groups come out ordered by their carrier.
 */
function findCycles(specs: readonly ReadSpec[]): Cycle[] {
  const next = new Map<string, string[]>();
  for (const spec of specs) next.set(spec.num, []);
  for (const spec of specs) {
    for (const edge of spec.edges) {
      const out = next.get(spec.num) ?? [];
      if (next.has(edge.toSpec) && !out.includes(edge.toSpec)) out.push(edge.toSpec);
    }
  }

  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const groups: string[][] = [];
  let counter = 0;
  const visit = (v: string): void => {
    index.set(v, counter);
    low.set(v, counter);
    counter += 1;
    stack.push(v);
    onStack.add(v);
    for (const w of next.get(v) ?? []) {
      if (!index.has(w)) {
        visit(w);
        low.set(v, Math.min(low.get(v) ?? 0, low.get(w) ?? 0));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v) ?? 0, index.get(w) ?? 0));
      }
    }
    if (low.get(v) !== index.get(v)) return;
    const group: string[] = [];
    let w: string | undefined;
    do {
      w = stack.pop();
      if (w === undefined) break;
      onStack.delete(w);
      group.push(w);
    } while (w !== v);
    groups.push(group);
  };
  for (const v of next.keys()) if (!index.has(v)) visit(v);

  const cycles: Cycle[] = [];
  for (const group of groups) {
    const carrier = [...group].sort()[0] as string;
    const members = new Set(group);
    if (group.length === 1 && !(next.get(carrier) ?? []).includes(carrier)) continue;
    cycles.push({ members, carrier, path: shortestLoop(carrier, members, next) });
  }
  return cycles.sort((a, b) => a.carrier.localeCompare(b.carrier));
}

/** The shortest path from `start` back to `start` inside `members` (breadth first, neighbours in ascending order). */
function shortestLoop(start: string, members: ReadonlySet<string>, next: ReadonlyMap<string, readonly string[]>): string[] {
  const from = new Map<string, string>();
  const queue: string[] = [start];
  // The queue grows while it is walked; an array iterator reads the length on every step.
  for (const v of queue) {
    for (const w of [...(next.get(v) ?? [])].sort()) {
      if (!members.has(w)) continue;
      if (w === start) {
        const path = [start];
        for (let at: string | undefined = v; at !== undefined && at !== start; at = from.get(at)) path.splice(1, 0, at);
        return [...path, start];
      }
      if (from.has(w)) continue;
      from.set(w, v);
      queue.push(w);
    }
  }
  return [start, start];
}

/** The file of the workspace an edge sits in, relative to the repository root. */
function fileOfEdge(edge: ReadEdge): string {
  return specFilePath(`specs/${edge.folder}`, edge.fromKind === 'claim' ? 'spec' : 'tasks');
}

/**
 * The warnings of the spec edges (ISC-162.4), never an error, and resolving goes on past them: first one
 * `spec-edge-unknown` per edge on a number no spec carries, active or archived, in edge order, on the edge's line with
 * the number as `subject`; then one `spec-edge-cycle` per cycle, not one per edge in it, ordered by carrier. The
 * carrier is the lowest number in the cycle; the warning sits on its first edge into the cycle and names a shortest
 * path round it as `subject` (`005 → 006 → 005`).
 */
function edgeDiagnostics(model: SpecEdgesModel, specs: readonly ReadSpec[], cycles: readonly Cycle[]): FileDiagnostic[] {
  const known = new Set<string>();
  for (const files of [...model.specs, ...model.archived]) {
    const num = specIdOf(files.folder);
    if (num !== null) known.add(num);
  }
  const out: FileDiagnostic[] = [];
  for (const spec of specs) {
    for (const edge of spec.edges) {
      if (known.has(edge.toSpec)) continue;
      const diagnostic: Diagnostic = {
        severity: 'warning',
        code: 'spec-edge-unknown',
        message: `The spec edge (after: ${edge.toSpec}) on ${edge.fromId} names no spec, active or archived; it stays open.`,
        line: edge.line,
        subject: edge.toSpec,
      };
      out.push({ file: fileOfEdge(edge), diagnostic });
    }
  }
  const bySpec = new Map(specs.map((s) => [s.num, s]));
  for (const cycle of cycles) {
    const step = cycle.path[1] as string;
    const edge = bySpec.get(cycle.carrier)?.edges.find((e) => e.toSpec === step);
    if (edge === undefined) continue;
    const path = cycle.path.join(' → ');
    const diagnostic: Diagnostic = {
      severity: 'warning',
      code: 'spec-edge-cycle',
      message: `Spec edges form the cycle ${path}; every edge in it stays open.`,
      line: edge.line,
      subject: path,
    };
    out.push({ file: fileOfEdge(edge), diagnostic });
  }
  return out;
}

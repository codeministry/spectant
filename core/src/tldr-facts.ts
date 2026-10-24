// The facts the TL;DR is drafted from (spec 074, ISC-621), ported from the old SpecTldr `facts`: per open spec its
// number, title, stage, claim progress, open claim count, `- fog:` lines and the prototype and artifact paths the caller
// listed. The plugin's `spec-check tldr facts --json` prints what this returns.
//
// One derivation: stage, title and progress are the rows of `buildDashboard`, the same model `spec-check status` reads,
// and the fog lines are `parseClaims(…).fog`; this module parses nothing itself.
//
// Pure: text in, model out. No file system, no Bun API, no clock. It imports `dashboard.ts`, which reaches `gates.ts`
// (`node:crypto`), so like `buildDashboard` it stays off the browser-safe barrel: `index.ts` re-exports its types only
// and a caller imports `tldrFacts` from this module.
import { parseClaims } from './claims.ts';
import { buildDashboard } from './dashboard.ts';
import type { LockReading, SpecFiles, Workflow } from './files.ts';

/**
 * One spec folder as the caller read it from disk: `SpecFiles` (folder name and texts, at least `spec`; give `tasks`,
 * `plan`, `events`, `rounds`, `gateReviewed` and `gateCodeReviewed` as well where they exist, since the stage reads
 * them), whether it sits under `specs/archive/`, and the two path lists the caller listed.
 *
 * ⟨?: decided for the plugin side: the paths are relative to `specs/` and include the spec folder, e.g.
 * `074-repo-docs-commands/.design/prototype/index.html` and `074-repo-docs-commands/artifacts/report.json`. The caller
 * decides which files under `.design/` count as prototypes (the old tool took every `index.html`); core passes both
 * lists through, sorted, and never touches the file system to check them.⟩
 */
export interface TldrFactsSpec extends SpecFiles {
  readonly archived: boolean;
  /** Prototype files under the spec's `.design/`, relative to `specs/`. */
  readonly prototypes: readonly string[];
  /** Files under the spec's `artifacts/`, relative to `specs/`. */
  readonly artifacts: readonly string[];
}

/**
 * What `tldrFacts` reads. `specs` lists every spec folder, archived ones flagged; the optional workspace texts are what
 * `spec-check status` hands `buildDashboard` as well, so the stage here is the stage there: the master (`ISA.md`) and
 * `specs/constitution.md` as texts, `specs/workflow.md` as `parseWorkflow` read it, the lock reading and the checkout's
 * tree id for the code-reviewed mark. Left out, each takes the dashboard's default (no master, the default workflow,
 * no locks, no tree).
 */
export interface TldrFactsInput {
  readonly specs: readonly TldrFactsSpec[];
  readonly master?: string | null;
  readonly constitution?: string | null;
  readonly workflow?: Workflow;
  readonly locks?: LockReading;
  readonly worktreeTree?: string | null;
}

/** One open spec's facts. */
export interface TldrFact {
  /** The folder's number, `NNN`. */
  readonly number: string;
  /** Frontmatter `task:`, falling back to the slug without its number (the dashboard row's title). */
  readonly title: string;
  /** The derived stage, as `spec-check status` shows it. */
  readonly stage: string;
  /** Live claims, closed over total, `M/N`. */
  readonly progress: string;
  /** Live claims not yet closed. */
  readonly openClaims: number;
  /** The `- fog:` lines under `## Not yet specified`, their text without trailing `⟨?: …⟩` marks. */
  readonly fog: readonly string[];
  /** As the caller listed them, sorted. */
  readonly prototypes: readonly string[];
  /** As the caller listed them, sorted. */
  readonly artifacts: readonly string[];
}

export interface TldrFacts {
  /** Open specs only (not `phase: complete`, not archived, with a spec.md), sorted by number. */
  readonly specs: readonly TldrFact[];
}

const sorted = (paths: readonly string[]): string[] => [...paths].sort();

/** The facts over every open spec of `input`; archived, complete and spec.md-less folders are left out. */
export function tldrFacts(input: TldrFactsInput): TldrFacts {
  const active = input.specs.filter((s) => !s.archived);
  const model = buildDashboard({
    master: input.master ?? null,
    constitution: input.constitution ?? null,
    tldr: null,
    specs: active.map(({ folder, texts }) => ({ folder, texts })),
    archived: input.specs.filter((s) => s.archived).map(({ folder, texts }) => ({ folder, texts })),
    ...(input.worktreeTree === undefined ? {} : { worktreeTree: input.worktreeTree }),
    ...(input.workflow === undefined ? {} : { workflow: input.workflow }),
    ...(input.locks === undefined ? {} : { locks: input.locks }),
  });
  const byFolder = new Map(active.map((s) => [s.folder, s]));
  const specs = model.specs
    .filter((row) => row.phase !== 'complete')
    .map((row): TldrFact => {
      const files = byFolder.get(row.slug);
      return {
        number: row.id,
        title: row.title,
        stage: row.stage,
        progress: `${row.progress.closed}/${row.progress.total}`,
        openClaims: row.progress.total - row.progress.closed,
        fog: parseClaims(files?.texts.spec ?? '').fog.map((f) => f.text),
        prototypes: sorted(files?.prototypes ?? []),
        artifacts: sorted(files?.artifacts ?? []),
      };
    })
    .sort((a, b) => (a.number < b.number ? -1 : a.number > b.number ? 1 : 0));
  return { specs };
}

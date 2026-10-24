// The repository documents of `/spec doc` and `/spec tldr` (spec 074): `specs/tech.md` and `specs/tldr.md`. This module
// only finds, reads and copies files; what they mean comes from `core/`: `readTech` for tech.md's four sections,
// `parseTldr` and `tldrState` for the TL;DR, and the dashboard rows for each open spec's number, `updated:`, `phase:`
// and newest round, as the app derives them, and `tldrFacts` for the facts a TL;DR is drafted from. The one file any
// function here writes is `specs/tech.prev.md`, and only `docTarget` without `keep`. Every result is a plain JSON value,
// since `spec-check … --json` prints it as it is.
import { copyFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { readIfExists as readText, specFiles } from './spec-files.ts';
import { specReadDirs, worktreeListing, worktreeOnlyRefs } from './worktree-source.ts';
import { buildDashboard } from '../../core/src/dashboard.ts';
import { FILE_KINDS } from '../../core/src/files.ts';
import type { SpecFiles, TextFileKind } from '../../core/src/files.ts';
import { readLockSources } from '../../core/src/locks.ts';
import { listSpecs } from '../../core/src/resolve.ts';
import type { SpecRef } from '../../core/src/resolve.ts';
import { readTech } from '../../core/src/tech.ts';
import { tldrFacts as coreTldrFacts } from '../../core/src/tldr-facts.ts';
import type { TldrFacts, TldrFactsSpec } from '../../core/src/tldr-facts.ts';
import { parseTldr, tldrState } from '../../core/src/tldr.ts';
import type { TldrStateInput } from '../../core/src/tldr.ts';
import { parseWorkflow } from '../../core/src/workflow.ts';
import { withWorktreeOnly } from '../../core/src/worktrees.ts';

/** tech.md from the repository root, the target of `/spec doc`. */
export const TECH_TARGET = 'specs/tech.md';
/** The copy of the tech.md a run of `/spec doc` replaces, so the agent can carry hand-written prose over. */
export const TECH_PREVIOUS = 'specs/tech.prev.md';
/** tldr.md from the repository root, the target of `/spec tldr`. */
export const TLDR_TARGET = 'specs/tldr.md';

/** One reason a document is not complete: a code, the key, spec number or file it concerns, and one sentence. */
export interface RepoDocFinding {
  readonly code: string;
  readonly subject: string | null;
  readonly message: string;
}

export interface DocTargetResult {
  readonly target: typeof TECH_TARGET;
  /** `specs/tech.prev.md` when an existing tech.md was copied there by this call; null otherwise. */
  readonly previous: typeof TECH_PREVIOUS | null;
  readonly keep: boolean;
}

export interface DocCheckResult {
  readonly ok: boolean;
  readonly findings: readonly RepoDocFinding[];
}

export interface TldrTargetResult {
  readonly target: typeof TLDR_TARGET;
}

export interface TldrCheckResult {
  readonly ok: boolean;
  /** Whether `tldrState` calls the TL;DR stale (a spec's `updated:` or newest round after `generated:`); false when absent. */
  readonly stale: boolean;
  readonly findings: readonly RepoDocFinding[];
}

const readIfExists = (path: string): string | undefined => (existsSync(path) ? readFileSync(path, 'utf8') : undefined);

const missingFile = (file: string): RepoDocFinding => ({ code: 'missing-file', subject: file, message: `${file} does not exist.` });

/**
 * `spec-check doc target`: names `specs/tech.md` as the target. An existing tech.md is first copied byte for byte to
 * `specs/tech.prev.md`, replacing an older copy; without a tech.md, or with `keep`, nothing is written.
 */
export function docTarget(root: string, options: { readonly keep?: boolean } = {}): DocTargetResult {
  const keep = options.keep ?? false;
  const source = join(root, TECH_TARGET);
  if (keep || !existsSync(source)) return { target: TECH_TARGET, previous: null, keep };
  copyFileSync(source, join(root, TECH_PREVIOUS));
  return { target: TECH_TARGET, previous: TECH_PREVIOUS, keep };
}

/**
 * `spec-check doc check`: `specs/tech.md` through core's `readTech`. A missing file is one finding; each of the four
 * keys `overview`, `stack`, `architecture` and `risks` without its section marker is one (core's `tech-section`).
 */
export function docCheck(root: string): DocCheckResult {
  const tech = readIfExists(join(root, TECH_TARGET));
  if (tech === undefined) return { ok: false, findings: [missingFile(TECH_TARGET)] };
  const findings = readTech({ tech, specs: [] })
    .diagnostics.filter((d) => d.diagnostic.code === 'tech-section')
    .map(({ diagnostic }): RepoDocFinding => ({ code: diagnostic.code, subject: diagnostic.subject ?? null, message: diagnostic.message }));
  return { ok: findings.length === 0, findings };
}

/** `spec-check tldr target`: names `specs/tldr.md` as the target and writes nothing. */
export function tldrTarget(): TldrTargetResult {
  return { target: TLDR_TARGET };
}

/**
 * Every spec folder of the repository as `spec-check status` lists it: the main checkout's folders and those only a
 * live spec worktree carries, merged by core's `withWorktreeOnly`, each active one with `dir` at its read source.
 */
function specFolders(root: string): SpecRef[] {
  const main = listSpecs(root);
  const porcelain = worktreeListing(root);
  const refs = withWorktreeOnly(main, worktreeOnlyRefs(root, main, porcelain));
  const dirs = specReadDirs(root, refs, porcelain);
  return refs.map((ref) => {
    const dir = ref.archived ? undefined : dirs.get(ref.slug);
    return dir === undefined ? ref : { ...ref, dir };
  });
}

/** The text kinds the TL;DR's spec facts need: spec.md for `updated:` and `phase:`, rounds.jsonl for the newest round. */
const TLDR_KINDS: readonly TextFileKind[] = ['spec', 'rounds'];

/**
 * The active specs as `tldrState` takes them, read as `spec-check status` reads them: the main checkout's folders and
 * those only a live spec worktree carries, each at its read source, then core's dashboard rows for number,
 * `updated:`, `phase:` and the newest round, the same values the app's brief judges the TL;DR by.
 */
export function tldrSpecs(root: string): TldrStateInput['specs'] {
  const specs = specFolders(root)
    .filter((ref) => !ref.archived)
    .map(({ dir, slug: folder }): SpecFiles => {
      const texts: Partial<Record<TextFileKind, string>> = {};
      for (const kind of TLDR_KINDS) {
        const text = readIfExists(join(dir, FILE_KINDS[kind].path));
        if (text !== undefined) texts[kind] = text;
      }
      return { folder, texts };
    });
  const model = buildDashboard({ master: null, constitution: null, tldr: null, specs, archived: [] });
  return model.specs.map((row) => ({ number: row.id, updated: row.updated, phase: row.phase, lastRound: row.lastRound }));
}

/**
 * `spec-check tldr check`: `specs/tldr.md` through core's `parseTldr` and `tldrState`. Findings: a missing file, each
 * missing section key, a missing or invalid `generated:` (core's diagnostics), and each open spec the TL;DR never names.
 */
export function tldrCheck(root: string): TldrCheckResult {
  const text = readIfExists(join(root, TLDR_TARGET));
  if (text === undefined) return { ok: false, stale: false, findings: [missingFile(TLDR_TARGET)] };
  const tldr = parseTldr(text);
  const state = tldrState({ tldr, specs: tldrSpecs(root) });
  const findings: RepoDocFinding[] = [
    ...state.missingSections.map((key): RepoDocFinding => ({
      code: 'tldr-section',
      subject: key,
      message: `${TLDR_TARGET} has no \`<!-- section: ${key} -->\` marker.`,
    })),
    ...tldr.diagnostics
      .filter((d) => d.code === 'tldr-generated-missing' || d.code === 'tldr-generated-invalid')
      .map((d): RepoDocFinding => ({ code: d.code, subject: 'generated', message: d.message })),
    ...state.unnamedSpecs.map((number): RepoDocFinding => ({
      code: 'tldr-unnamed-spec',
      subject: number,
      message: `${TLDR_TARGET} never names the open spec ${number}.`,
    })),
  ];
  return { ok: findings.length === 0, stale: state.stale, findings };
}

/** Every file under `dir`, recursively, as `<folder>/<path below the spec folder>` with forward slashes; none when absent. */
function filesUnder(specDir: string, folder: string, dir: string): string[] {
  const base = join(specDir, dir);
  if (!existsSync(base)) return [];
  return readdirSync(base, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => `${folder}/${relative(specDir, join(entry.parentPath, entry.name)).split(sep).join('/')}`);
}

/** The `.design/` subfolder of a spec, where `/spec design` puts its prototypes. */
const DESIGN_DIR = '.design';
/** The `artifacts/` subfolder of a spec. */
const ARTIFACTS_DIR = 'artifacts';
/** The file that makes a page under `.design/` a prototype, as the old SpecTldr counted them. */
const PROTOTYPE_FILE = 'index.html'; // no-html: allow — a name matched while listing, never written

/**
 * `spec-check tldr facts`: per open spec its number, title, stage, progress, open claims, `- fog:` lines, prototypes and
 * artifacts, from core's `tldrFacts`. Each spec folder is read as `spec-check status` reads it (the same folders, read
 * sources and file kinds, with the master, the constitution, `specs/workflow.md` and the lock reading); this function
 * only lists every `PROTOTYPE_FILE` under `.design/` as a prototype and every file under `artifacts/` as artifacts, paths relative to
 * `specs/`. Writes nothing.
 */
export async function tldrFacts(root: string): Promise<TldrFacts> {
  const specs = specFolders(root).map((ref): TldrFactsSpec => {
    const files = specFiles(ref);
    if (ref.archived) return { ...files, archived: true, prototypes: [], artifacts: [] };
    return {
      ...files,
      archived: false,
      prototypes: filesUnder(ref.dir, ref.slug, DESIGN_DIR).filter((path) => path.endsWith(`/${PROTOTYPE_FILE}`)),
      artifacts: filesUnder(ref.dir, ref.slug, ARTIFACTS_DIR),
    };
  });
  return coreTldrFacts({
    specs,
    master: readText(join(root, 'ISA.md')),
    constitution: readText(join(root, 'specs', 'constitution.md')),
    workflow: parseWorkflow(readText(join(root, 'specs', 'workflow.md'))),
    locks: await readLockSources({ repoRoot: root }),
  });
}

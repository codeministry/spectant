// Stage parity with the old Spec skill (spec 001 T41, ISC-14): for every spec folder of every local tree listed in
// SPECTANT_PARITY_TREES, the stage in the row `buildDashboard` produces equals the stage the old skill derives.
//
// Contract (both variables local to the principal's machine, never committed, never printed beyond a basename):
//
//   SPECTANT_PARITY_TREES    `:`-separated list (like PATH) of repository roots, each holding `specs/NNN-slug/`
//                            folders. Copies of real trees; they stay outside this repository.
//   SPECTANT_SPEC_SKILL_DIR  the old Spec skill's directory, holding `Tools/SpecDashboard.ts`, which exports
//                              specState(dir: string): NextInput   dir = absolute path of one `specs/NNN-slug/`
//                              stageOf(s: NextInput): Stage         plan|tasks|review|build|blocked|code-review|close|done
//                            and is imported dynamically. During each call the working directory is the tree root.
//
// Behaviour: SPECTANT_PARITY_TREES unset → skipped, never passed. Set, but nothing compared (empty list, unreadable
// trees, no spec folders, SPECTANT_SPEC_SKILL_DIR unset or not loadable) → fails and says what was found. Set and
// compared → one test per spec (tree basename, slug, old vs new stage) and a final count > 0.
//
// A folder counts as a spec when it matches `NNN-*` directly under `specs/` and holds spec.md; `specs/archive/` is
// not compared (archived specs have no row). Rows are matched by slug, so two folders sharing a number stay apart.
//
// The code-reviewed mark is fresh only against the current worktree tree id, which the old skill took from git.
// So the test lists the enclosing git worktree read-only (`git ls-files`, GIT_OPTIONAL_LOCKS=0: no index refresh,
// no lock file, no object) and hands `treeIdOf` the bytes; outside git, or when git is missing, the id stays null.
import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, readlinkSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';

import { buildDashboard } from '../src/dashboard.ts';
import type { DashboardModel } from '../src/dashboard.ts';
import { folders, readTreeAt } from './helpers/read-tree.ts';
import { treeIdOf } from '../src/gates.ts';
import type { TreeEntry } from '../src/gates.ts';

const TREES_VAR = 'SPECTANT_PARITY_TREES';
const SKILL_VAR = 'SPECTANT_SPEC_SKILL_DIR';
const treesEnv = process.env[TREES_VAR];
const skillEnv = process.env[SKILL_VAR];

// ── the worktree tree id, read-only ───────────────────────────────────────────────────────────────────────────

function git(cwd: string, ...args: string[]): string | null {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } });
  return r.status === 0 ? r.stdout : null;
}

/** What `git add -A && git write-tree` would print for the worktree enclosing `root`; null when not computable. */
function worktreeTreeOf(root: string): string | null {
  const top = git(root, 'rev-parse', '--show-toplevel')?.trim();
  if (!top) return null;
  const listed = git(top, 'ls-files', '-z', '--cached', '--others', '--exclude-standard');
  if (listed === null) return null;
  const entries: TreeEntry[] = [];
  for (const path of new Set(listed.split('\0').filter((p) => p !== ''))) {
    const abs = join(top, path);
    let st;
    try {
      st = lstatSync(abs);
    } catch {
      continue; // tracked but deleted: `add -A` drops it
    }
    if (st.isSymbolicLink()) entries.push({ path, mode: '120000', bytes: new TextEncoder().encode(readlinkSync(abs)) });
    else if (st.isFile()) entries.push({ path, mode: st.mode & 0o100 ? '100755' : '100644', bytes: readFileSync(abs) });
    else return null; // a submodule or nested repository: a gitlink treeIdOf cannot hold
  }
  try {
    return treeIdOf(entries);
  } catch {
    return null;
  }
}

// ── the old derivation ───────────────────────────────────────────────────────────────────────────────────────

interface OldSkill {
  specState(dir: string): unknown;
  stageOf(state: unknown): unknown;
}

function isOldSkill(mod: unknown): mod is OldSkill {
  if (typeof mod !== 'object' || mod === null) return false;
  const m = mod as Record<string, unknown>;
  return typeof m.specState === 'function' && typeof m.stageOf === 'function';
}

/** Every absolute path this test knows, replaced by a placeholder, so no message carries more than a basename. */
function scrub(text: string, roots: readonly string[]): string {
  const pairs: Array<[string, string]> = roots.map((p) => [p, `<${basename(p)}>`]);
  if (skillEnv) pairs.push([resolve(skillEnv), `<${SKILL_VAR}>`]);
  if (homedir().length > 1) pairs.push([homedir(), '<home>']);
  pairs.sort((a, b) => b[0].length - a[0].length); // the longest path first, so home never splits a known root
  return pairs.reduce((out, [path, placeholder]) => out.split(path).join(placeholder), text);
}

async function loadOldSkill(roots: readonly string[]): Promise<{ skill: OldSkill | null; why: string }> {
  if (!skillEnv) return { skill: null, why: `${SKILL_VAR} is unset` };
  const file = join(resolve(skillEnv), 'Tools', 'SpecDashboard.ts');
  if (!existsSync(file)) return { skill: null, why: `${SKILL_VAR} holds no Tools/SpecDashboard.ts` };
  try {
    const mod: unknown = await import(file);
    if (isOldSkill(mod)) return { skill: mod, why: 'loaded' };
    return { skill: null, why: `Tools/SpecDashboard.ts does not export specState and stageOf` };
  } catch (e) {
    return { skill: null, why: `Tools/SpecDashboard.ts failed to load: ${scrub(String(e), roots)}` };
  }
}

// ── collecting the comparisons ───────────────────────────────────────────────────────────────────────────────

interface Comparison {
  readonly tree: string;
  readonly slug: string;
  /** The old stage, or `error: …` when the old tool threw. */
  readonly old: string;
  /** The stage in the dashboard row, or `(no row)`. */
  readonly now: string;
}

interface Collected {
  readonly comparisons: readonly Comparison[];
  readonly found: string;
}

async function oldStage(skill: OldSkill, root: string, specDir: string, roots: readonly string[]): Promise<string> {
  const cwd = process.cwd();
  try {
    process.chdir(root);
    const state: unknown = await Promise.resolve(skill.specState(specDir));
    const stage: unknown = await Promise.resolve(skill.stageOf(state));
    return typeof stage === 'string' ? stage : `error: stageOf returned ${typeof stage}`;
  } catch (e) {
    return `error: ${scrub(String(e), roots)}`;
  } finally {
    process.chdir(cwd);
  }
}

async function collect(env: string): Promise<Collected> {
  const roots = env
    .split(':')
    .filter((p) => p.trim() !== '')
    .map((p) => resolve(p));
  const names = new Map<string, number>();
  const trees = roots.map((root) => {
    const base = basename(root);
    const seen = (names.get(base) ?? 0) + 1;
    names.set(base, seen);
    return { root, name: seen === 1 ? base : `${base} (${seen})` };
  });

  const readable = trees.filter((t) => existsSync(join(t.root, 'specs')) && statSync(join(t.root, 'specs')).isDirectory());
  const specsPerTree = readable.map((t) => ({
    ...t,
    slugs: folders(join(t.root, 'specs'))
      .filter((f) => f.texts.spec !== undefined)
      .map((f) => f.folder),
  }));
  const specCount = specsPerTree.reduce((n, t) => n + t.slugs.length, 0);
  const { skill, why } = await loadOldSkill(roots);
  const found =
    `${trees.length} tree(s) listed in ${TREES_VAR}` +
    (trees.length ? ` (${trees.map((t) => t.name).join(', ')})` : '') +
    `, ${readable.length} readable (a specs/ folder), ${specCount} spec folder(s) with spec.md; old skill: ${why}`;
  if (!skill) return { comparisons: [], found };

  const comparisons: Comparison[] = [];
  for (const t of specsPerTree) {
    if (t.slugs.length === 0) continue;
    const model: DashboardModel = buildDashboard(readTreeAt(t.root, worktreeTreeOf(t.root)));
    for (const slug of t.slugs) {
      const now = model.specs.find((r) => r.slug === slug)?.stage ?? '(no row)';
      const old = await oldStage(skill, t.root, join(t.root, 'specs', slug), roots);
      comparisons.push({ tree: t.name, slug, old, now });
    }
  }
  return { comparisons, found };
}

// ── the probe ────────────────────────────────────────────────────────────────────────────────────────────────

const collected: Collected = treesEnv === undefined ? { comparisons: [], found: '' } : await collect(treesEnv);

describe('stage parity with the old Spec skill (ISC-14)', () => {
  test.skipIf(treesEnv === undefined)(
    `compares at least one spec (needs ${TREES_VAR} and ${SKILL_VAR}; skipped when ${TREES_VAR} is unset)`,
    () => {
      const compared = collected.comparisons.filter((c) => !c.old.startsWith('error: ')).length;
      if (compared === 0) throw new Error(`nothing compared: ${collected.found}`);
      expect(compared).toBeGreaterThan(0);
    },
  );

  for (const c of collected.comparisons) {
    test(`${c.tree} ${c.slug}: old ${c.old} = new ${c.now}`, () => {
      expect(c.now).toBe(c.old);
    });
  }
});

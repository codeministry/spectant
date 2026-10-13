// The git fixture repository of spec 027 (T18; ISC-175, ISC-176, ISC-181, ISC-182): a registered repository with a
// spec worktree and a builder worktree, built at test time.
//
// A repository with `.git/` and linked worktrees cannot live in the tree (a committed `.git/` is no repository, and a
// linked worktree's admin files hold absolute paths), so this module is a builder, not a folder: `plantWorktreeRepo`
// copies `core/fixtures/harbor` into a fresh temp directory and makes a real repository of it with real git.
//
//   <base>/harbor                             the main checkout on `main`: harbor's ISA.md, specs/, .spectant/,
//                                             generate.ts, plus one code file `src/console.ts`
//   <base>/harbor/.worktrees/002-web-console  the spec worktree on `feature/002-web-console`, two commits ahead of
//                                             `main` (each edits code), one uncommitted file `src/draft.ts`
//   <base>/harbor/.claude/worktrees/agent-a1b2 a builder worktree, detached at the spec branch's tip
//
// `.worktrees/`, `.claude/` and `.spectant/` are ignored by the fixture's `.gitignore`, as are the gate marks
// `specs/*/.gates/` (they stay outside the tree the code-review mark names). Two shapes of `specs/`:
//
// - `trackedSpecs: false` (the default, this repository's own rule): `specs/` and `ISA.md` are ignored and untracked in
//   the main checkout, and the spec worktree links both to the main checkout's (`specs -> ../../specs`,
//   `ISA.md -> ../../ISA.md`), so `git ls-files -- specs/002-web-console` answers nothing.
// - `trackedSpecs: true`: `specs/` and `ISA.md` are committed on `main`, and the spec worktree's own copy of
//   `specs/002-web-console/` differs from the main checkout's: the first commit ticks task T27 in `tasks.md`, the second
//   moves `stage:` in `spec.md` from `build` to `code-review`. The copy also carries the main checkout's ignored
//   `.gates/` of the spec, so both read as reviewed.
//
// `merged: true` merges the spec branch into `main` with a merge commit (ahead 0); `removeWorktree: true` removes the
// spec worktree with `git worktree remove --force` (the path is gone, `git worktree list` no longer names it, the
// branch stays). Both apply in that order.
//
// Deterministic: every git call runs under a minimal environment of its own (PATH, a HOME inside the temp directory,
// an empty global config, no system config) with a fixed identity and fixed dates, so the commit and tree ids are the
// same on every run and machine for the same harbor content; `process.env` is never changed. The temp directory
// is the only absolute path, it exists only at runtime, and no committed byte names it (the links are relative).
import { cpSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** The fixture the main checkout is copied from. */
const HARBOR = join(import.meta.dir, "..", "..", "core", "fixtures", "harbor");

/** The spec with a worktree; every other harbor spec has none. */
export const SPEC_FOLDER = "002-web-console";
export const SPEC_ID = "002";
export const SPEC_BRANCH = `feature/${SPEC_FOLDER}`;
/** The spec worktree and the builder worktree, relative to the main checkout, as `assignWorktrees` names them. */
export const SPEC_WORKTREE = `.worktrees/${SPEC_FOLDER}`;
export const BUILDER_WORKTREE = ".claude/worktrees/agent-a1b2";
/** The one uncommitted file in the spec worktree, relative to it. */
export const UNCOMMITTED = "src/draft.ts";

/** The identity of every commit. */
export const IDENTITY = { name: "Spectant Fixture", email: "fixture@example.com" } as const;

/** The author and committer date of each commit; `later` is for a commit a test makes itself. */
export const DATES = {
  initial: "2026-03-01T09:00:00Z",
  first: "2026-03-02T10:00:00Z",
  second: "2026-03-03T10:00:00Z",
  merge: "2026-03-04T10:00:00Z",
  later: "2026-03-05T10:00:00Z",
} as const;

export interface WorktreeRepoOptions {
  /** Commit `specs/` and `ISA.md` on `main` and give the worktree a differing copy; default false (ignored, linked). */
  readonly trackedSpecs?: boolean;
  /** Merge the spec branch into `main` with a merge commit at `DATES.merge`; default false. */
  readonly merged?: boolean;
  /** Remove the spec worktree with `git worktree remove --force` (after the merge, if both); default false. */
  readonly removeWorktree?: boolean;
  /** The directory the temp directory is made in; default the OS temp directory. */
  readonly parent?: string;
}

/** One git run: its exit code and its output, untrimmed. */
export interface FixtureGitRun {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface PlantedWorktreeRepo {
  /** The temp directory holding everything; the caller removes it. */
  readonly base: string;
  /** The main checkout, `<base>/harbor` (absolute), the root a workspace registers. */
  readonly root: string;
  /** The two linked worktrees, absolute; `spec` no longer exists after `removeWorktree`. */
  readonly worktrees: { readonly spec: string; readonly builder: string };
  /** What a reader of the repository should find. */
  readonly expected: {
    /** `aheadOfMain(worktrees.spec, SPEC_BRANCH)`: 2, 0 once merged, null once the worktree is removed. */
    readonly ahead: number | null;
    /** `dirty(worktrees.spec)`: true (the uncommitted file), null once the worktree is removed. */
    readonly dirty: boolean | null;
    /** Builder worktrees under `.claude/worktrees/`. */
    readonly builders: number;
    /** Whether `git ls-files -- specs/002-web-console` in the main checkout lists files. */
    readonly trackedSpecs: boolean;
  };
  /** The commit ids: the initial commit on main, the two on the spec branch, and the merge commit (null unmerged). */
  readonly commits: { readonly initial: string; readonly first: string; readonly second: string; readonly merge: string | null };
  /** Runs git in `cwd` under the fixture's environment, dated `DATES.later`; never throws on a non-zero exit. */
  readonly git: (cwd: string, ...args: string[]) => Promise<FixtureGitRun>;
}

/** The minimal, hermetic environment of every fixture git call: nothing of the host's git configuration reaches it. */
function fixtureEnv(base: string, date: string): Record<string, string> {
  return {
    PATH: process.env.PATH ?? "",
    // HOME inside the temp directory: no `~/.config/git/attributes` or `ignore` of the host applies either.
    HOME: base,
    LC_ALL: "C",
    GIT_CONFIG_GLOBAL: join(base, "gitconfig"),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
    GIT_MERGE_AUTOEDIT: "no",
    GIT_AUTHOR_NAME: IDENTITY.name,
    GIT_AUTHOR_EMAIL: IDENTITY.email,
    GIT_COMMITTER_NAME: IDENTITY.name,
    GIT_COMMITTER_EMAIL: IDENTITY.email,
    GIT_AUTHOR_DATE: date,
    GIT_COMMITTER_DATE: date,
  };
}

async function runGit(env: Record<string, string>, cwd: string, args: readonly string[]): Promise<FixtureGitRun> {
  const proc = Bun.spawn(["git", ...args], { cwd, env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  return { code, stdout, stderr };
}

/** The fixture's `.gitignore`: worktrees, activity and gate marks always; `specs` and `ISA.md` when untracked. */
function ignoreFile(trackedSpecs: boolean): string {
  const always = ".worktrees/\n.claude/\n.spectant/\nspecs/*/.gates/\n";
  // No trailing slash: a directory pattern never matches the worktree's `specs` link.
  return trackedSpecs ? always : `${always}/specs\n/ISA.md\n`;
}

/** Replaces `from` in the file at `path` once; throws when harbor no longer holds it, so a difference never vanishes. */
function replaceOnce(path: string, from: RegExp, to: string): void {
  const text = readFileSync(path, "utf8");
  if (!from.test(text)) throw new Error(`worktree fixture: ${from.source} not found in ${path}`);
  writeFileSync(path, text.replace(from, to));
}

/**
 * Builds the repository described at the top of this file in a new temp directory below `options.parent` and returns
 * its paths, commit ids and the numbers a reader should find. Every call builds a fresh repository; the caller removes
 * `base` when done.
 */
export async function plantWorktreeRepo(options: WorktreeRepoOptions = {}): Promise<PlantedWorktreeRepo> {
  const trackedSpecs = options.trackedSpecs ?? false;
  const merged = options.merged ?? false;
  const removeWorktree = options.removeWorktree ?? false;

  const base = mkdtempSync(join(options.parent ?? tmpdir(), "spectant-worktree-repo-"));
  writeFileSync(join(base, "gitconfig"), "");
  const git = async (date: string, cwd: string, ...args: string[]): Promise<string> => {
    const run = await runGit(fixtureEnv(base, date), cwd, args);
    if (run.code !== 0) throw new Error(`worktree fixture: git ${args.join(" ")} exited ${run.code}: ${run.stderr}`);
    return run.stdout.trim();
  };

  // The main checkout: harbor plus one code file, committed on main.
  const root = join(base, "harbor");
  cpSync(HARBOR, root, { recursive: true });
  writeFileSync(join(root, ".gitignore"), ignoreFile(trackedSpecs));
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src", "console.ts"), "// The web console: the sync runs.\nexport const runs = (): string[] => [];\n");
  await git(DATES.initial, root, "init", "-q", "-b", "main");
  await git(DATES.initial, root, "add", "-A");
  await git(DATES.initial, root, "commit", "-q", "-m", "harbor: main checkout");
  const initial = await git(DATES.initial, root, "rev-parse", "HEAD");

  // The spec worktree on its branch, two commits ahead of main, one uncommitted file.
  const spec = join(root, SPEC_WORKTREE);
  await git(DATES.first, root, "worktree", "add", "-q", "-b", SPEC_BRANCH, SPEC_WORKTREE);
  const specFolder = join(spec, "specs", SPEC_FOLDER);
  if (trackedSpecs) {
    cpSync(join(root, "specs", SPEC_FOLDER, ".gates"), join(specFolder, ".gates"), { recursive: true });
  } else {
    symlinkSync("../../specs", join(spec, "specs"));
    symlinkSync("../../ISA.md", join(spec, "ISA.md"));
  }

  writeFileSync(join(spec, "src", "console.ts"), "// The web console: the sync runs.\nexport const runs = (): string[] => [\"nightly\"];\n");
  const firstPaths = ["src/console.ts"];
  if (trackedSpecs) {
    replaceOnce(join(specFolder, "tasks.md"), /^- \[ \] T27 ·/m, "- [x] T27 ·");
    firstPaths.push(`specs/${SPEC_FOLDER}/tasks.md`);
  }
  await git(DATES.first, spec, "add", "--", ...firstPaths);
  await git(DATES.first, spec, "commit", "-q", "-m", "console: list the nightly run");
  const first = await git(DATES.first, spec, "rev-parse", "HEAD");

  writeFileSync(join(spec, "src", "history.ts"), "// The web console: the failure history.\nexport const failures = (): string[] => [];\n");
  const secondPaths = ["src/history.ts"];
  if (trackedSpecs) {
    replaceOnce(join(specFolder, "spec.md"), /^stage: build$/m, "stage: code-review");
    secondPaths.push(`specs/${SPEC_FOLDER}/spec.md`);
  }
  await git(DATES.second, spec, "add", "--", ...secondPaths);
  await git(DATES.second, spec, "commit", "-q", "-m", "console: failure history");
  const second = await git(DATES.second, spec, "rev-parse", "HEAD");

  writeFileSync(join(spec, UNCOMMITTED), "// Draft: retry a failed sync from the console.\n");

  // The builder worktree, detached at the spec branch's tip, as the Agent tool starts one from the spec's worktree.
  const builder = join(root, BUILDER_WORKTREE);
  await git(DATES.second, root, "worktree", "add", "-q", "--detach", BUILDER_WORKTREE, SPEC_BRANCH);

  let merge: string | null = null;
  if (merged) {
    await git(DATES.merge, root, "merge", "-q", "--no-ff", "-m", `Merge branch '${SPEC_BRANCH}'`, SPEC_BRANCH);
    merge = await git(DATES.merge, root, "rev-parse", "HEAD");
  }
  if (removeWorktree) await git(DATES.merge, root, "worktree", "remove", "--force", SPEC_WORKTREE);

  return {
    base,
    root,
    worktrees: { spec, builder },
    expected: {
      ahead: removeWorktree ? null : merged ? 0 : 2,
      dirty: removeWorktree ? null : true,
      builders: 1,
      trackedSpecs,
    },
    commits: { initial, first, second, merge },
    git: (cwd, ...args) => runGit(fixtureEnv(base, DATES.later), cwd, args),
  };
}

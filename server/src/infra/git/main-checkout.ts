// The main checkout of the repository a command line starts in (spec 062, ISC-442): `rev-parse --git-common-dir`,
// which only reads the repository's `.git` file and directory, takes no lock and writes nothing (`GIT_OPTIONAL_LOCKS=0`
// besides, as for every read here); no fetch, no network. The rule that names the main checkout from git's answer is
// `core/`'s `mainCheckoutFrom`, which the plugin's `repoRoot` applies too (spec 062, ISC-443); only the git call and
// the file system facts are read here.
import { mainCheckoutFrom } from "../../../../core/src/worktree-facts.ts";
import { realPath } from "../fs/list.ts";
import type { UserEmailOptions } from "./refs.ts";
import { DEFAULT_TIMEOUT_MS, defaultGitRunner, firstLine, gitEnv, hasOwnGit, readWithin } from "./runner.ts";

/** Both paths name the same folder once links are resolved; false when either cannot be resolved. */
function sameFolder(a: string, b: string): boolean {
  try {
    return realPath(a) === realPath(b);
  } catch {
    return false;
  }
}

/**
 * The main checkout of the checkout at `cwd` (absolute): the parent of the repository's common git directory, which
 * for a linked worktree is the main checkout's `.git` and for the main checkout its own. The server CLI's root when no
 * `--root` is given (spec 062, ISC-442), so `gate code-reviewed` and `tokens` started in a spec worktree read and write
 * exactly as from the main checkout. The root rule of every read here holds: discovery stops at `cwd`, so only a
 * checkout's own top folder is normalized, and git is not asked from a folder without a `.git` of its own.
 * Never throws: `cwd` itself, spelled as given, when it has no `.git` of its own, when git is missing, fails or hits the
 * deadline, when the common directory is not a `.git` folder whose parent is a checkout (a bare or submodule layout),
 * and when `cwd` already is the main checkout.
 */
export async function mainCheckoutOf(cwd: string, options: UserEmailOptions = {}): Promise<string> {
  if (!hasOwnGit(cwd)) return cwd;
  const runner = options.runner ?? defaultGitRunner;
  return readWithin(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, cwd, async (signal) => {
    const run = await runner(["-C", cwd, "rev-parse", "--git-common-dir"], gitEnv(cwd), signal);
    const commonDir = run?.code !== 0 || signal.aborted ? null : firstLine(run.stdout);
    return mainCheckoutFrom({ cwd, commonDir, holdsGit: hasOwnGit, sameFolder });
  });
}

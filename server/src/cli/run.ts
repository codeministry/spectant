/**
 * The `spectant` command line (T11, ISC-8): `serve` (the default, `serve.ts`), the workspace commands `add`, `list` and
 * `remove` (T44, ISC-13, `workspace-commands.ts`) and `--version`.
 *
 * `import-notes` and `export-notes` live in the `notes/` slice, `db rollback` (T98, ISC-53) in `rollback.ts`; `args.ts`
 * parses them. `gate code-reviewed F<n> [--root DIR] [--yes]` (spec 008, T93, ISC-122.2) is `feature-gate-command.ts`
 * over the `writes/` slice: the feature-level code-review mark; without `--yes` it only prints. `tokens [--root DIR]
 * [--transcripts DIR] [--yes]` (spec 009, T8, ISC-135) lives in the `tokens/` slice: the token measurement, written to
 * `specs/tokens.jsonl` with `--yes` and only printed without it. These two are the only writes into a repository the
 * CLI makes.
 *
 * `--version` (also `-v`, `-V`; T13, ISC-9) prints exactly `spectant <VERSION>` and a newline on stdout and nothing
 * else, so `scripts/check-version.ts` can compare the binary byte for byte with `package.json`. It short-circuits
 * the rest of the command line.
 *
 * `run` returns the process exit code: 0 on success, 1 when serving or a workspace command fails, 2 on a usage error.
 * For `serve` it resolves only once the server has stopped on SIGINT, SIGTERM or `options.signal`. The manifest is passed in, because
 * only `main.ts` may import the generated `server/embedded.gen.ts`. `options` lets tests pin the environment (for the
 * data directory), the working directory and the browser runner, and stop `serve` with a signal; all default to the
 * process's own.
 */
import { resolve } from "node:path";
import type { EmbeddedManifest } from "../contracts/assets.contract.ts";
import { mainCheckoutOf } from "../infra/git/index.ts";
import { dataDir } from "../infra/paths.ts";
import { VERSION } from "../infra/version.ts";
import { exportNotesCommand, importNotesCommand } from "../notes/index.ts";
import { tokensCommand } from "../tokens/index.ts";
import { type Command, UsageError, parse } from "./args.ts";
import { featureGateCommand } from "./feature-gate-command.ts";
import type { RunOptions } from "./options.ts";
import { rollbackCommand } from "./rollback.ts";
import { serveUntilSignal } from "./serve.ts";
import { USAGE } from "./usage.ts";
import { workspaceCommand } from "./workspace-commands.ts";

/**
 * The repository `gate code-reviewed` and `tokens` work on: an explicit `--root` exactly as given (relative to
 * `cwd`), else the main checkout of the checkout `cwd` is (spec 062, ISC-442), so a call from a spec worktree finds
 * the same specs, read sources and `specs/tokens.jsonl` as one from the main checkout; outside git, `cwd` itself.
 */
async function repositoryRoot(cwd: string, root: string | null): Promise<string> {
  return root === null ? mainCheckoutOf(resolve(cwd)) : resolve(cwd, root);
}

export async function run(argv: string[], manifest: EmbeddedManifest, options: RunOptions = {}): Promise<number> {
  let command: Command;
  try {
    command = parse(argv);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    console.error(`spectant: ${error.message}\n\n${USAGE}`);
    return 2;
  }
  switch (command.kind) {
    case "version":
      console.log(`spectant ${VERSION}`);
      return 0;
    case "help":
      console.log(USAGE);
      return 0;
    case "serve":
      return serveUntilSignal(manifest, command, options);
    case "add":
    case "list":
    case "remove":
      return workspaceCommand(command, options);
    case "import-notes":
      return importNotesCommand(dataDir(options.env ?? process.env), resolve(options.cwd ?? process.cwd(), command.file), command.file);
    case "export-notes":
      return exportNotesCommand(dataDir(options.env ?? process.env), resolve(options.cwd ?? process.cwd(), command.file), command.file);
    case "db-rollback":
      return rollbackCommand(dataDir(options.env ?? process.env), command.target, command.yes);
    case "gate-code-reviewed":
      return featureGateCommand(await repositoryRoot(options.cwd ?? process.cwd(), command.root), command.feature, command.yes);
    case "tokens": {
      const cwd = options.cwd ?? process.cwd();
      return tokensCommand(await repositoryRoot(cwd, command.root), {
        transcripts: command.transcripts === null ? null : resolve(cwd, command.transcripts),
        yes: command.yes,
        env: options.env ?? process.env,
      });
    }
  }
}

/** The help text of the `spectant` command line, printed by `--help` and after every usage error (exit 2). */
import { SCHEMA_VERSION } from "../infra/db/db.ts";
import { DEFAULT_PORT, LOOPBACK_HOST, PORT_ATTEMPTS } from "../infra/http/server.ts";

export const USAGE = `Usage: spectant [command] [options]

Commands:
  serve            serve the dashboard on ${LOOPBACK_HOST} (the default command)
  add <path>       register a repository with specs
  list             list the registered repositories
  remove <path|slug>
                   unregister a repository (its files are never touched)
  import-notes <file>
                   import the old notes page's JSON export (a second run skips what is there)
  export-notes <file>
                   write every note to <file> in the same JSON shape
  db rollback <version> --yes
                   undo the newer schema migrations (1 to ${SCHEMA_VERSION - 1}); without --yes it only says
                   what would be lost
  gate code-reviewed F<n> [--root <dir>] [--yes]
                   write the feature-level code-review mark into every spec of main feature
                   F<n> once all its claims are closed; without --yes it only prints the plan
  tokens [--root <dir>] [--transcripts <dir>] [--yes]
                   measure the token use of the repository's Claude Code sessions per /spec call,
                   spec, stage and round into specs/tokens.jsonl; without --yes it only prints it

Options:
  --port <n>       port to listen on (default ${DEFAULT_PORT}; 0 picks a free port); a busy port falls
                   forward to the next free one, up to ${PORT_ATTEMPTS} ports in all
  --strict-port    fail instead of falling forward when the port is busy
  --no-browser     do not open the browser
  --yes            confirm db rollback, gate code-reviewed or tokens
  --root <dir>     the repository gate code-reviewed and tokens work on (default: the working
                   directory)
  --transcripts <dir>
                   the Claude Code project folder tokens reads (default: projects/<encoded root>
                   in $CLAUDE_CONFIG_DIR or ~/.claude); its agent worktrees' folders beside it too
  -v, -V, --version
                   print the version and exit
  -h, --help       print this help and exit`;

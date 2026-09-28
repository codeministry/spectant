/**
 * The `spectant` command line (T11, ISC-8). Minimal on purpose: T44 adds the workspace commands (`add`, `list`,
 * `remove`), T50 the port fall-forward and opening the browser.
 *
 * `--version` (also `-v`, `-V`; T13, ISC-9) prints exactly `spectant <VERSION>` and a newline on stdout and nothing
 * else, so `scripts/check-version.ts` can compare the binary byte for byte with `package.json`. It short-circuits
 * the rest of the command line. `--no-browser` is accepted and ignored for now; opening the browser arrives with T50.
 *
 * `run` returns the process exit code: 0 on success, 1 when serving fails, 2 on a usage error. For `serve` it resolves
 * only once the server has stopped on SIGINT or SIGTERM. The manifest is passed in, because only `main.ts` may import
 * the generated `server/embedded.gen.ts`.
 */
import type { EmbeddedManifest } from "./assets.contract.ts";
import { DEFAULT_PORT, LOOPBACK_HOST, serve } from "./http.ts";
import { VERSION } from "./version.ts";

const USAGE = `Usage: spectant [command] [options]

Commands:
  serve            serve the dashboard on ${LOOPBACK_HOST} (the default command)
  add, list, remove
                   manage registered repositories (coming with later tasks)

Options:
  --port <n>       port to listen on (default ${DEFAULT_PORT}; 0 picks a free port)
  --no-browser     do not open the browser (accepted; opening the browser arrives with T50)
  -v, -V, --version
                   print the version and exit
  -h, --help       print this help and exit`;

class UsageError extends Error {}

type Command = { kind: "version" } | { kind: "help" } | { kind: "serve"; port: number };

function parsePort(value: string | undefined): number {
  if (value === undefined || !/^\d{1,5}$/.test(value) || Number(value) > 65535) {
    throw new UsageError(`--port needs a number from 0 to 65535, got ${value === undefined ? "nothing" : JSON.stringify(value)}`);
  }
  return Number(value);
}

function parse(argv: string[]): Command {
  let port = DEFAULT_PORT;
  let command: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    if (arg === "--version" || arg === "-v" || arg === "-V") return { kind: "version" };
    if (arg === "--help" || arg === "-h") return { kind: "help" };
    if (arg === "--no-browser") continue; // a no-op until T50 opens the browser
    if (arg === "--port") port = parsePort(argv[++i]);
    else if (arg.startsWith("--port=")) port = parsePort(arg.slice("--port=".length));
    else if (arg.startsWith("-")) throw new UsageError(`unknown option ${arg}`);
    else if (command === undefined) command = arg;
    else throw new UsageError(`unexpected argument ${arg}`);
  }
  if (command === undefined || command === "serve") return { kind: "serve", port };
  throw new UsageError(`unknown command ${command}`);
}

/** Serves until SIGINT or SIGTERM, then stops the server and resolves 0. A bind failure resolves 1 at once. */
function serveUntilSignal(manifest: EmbeddedManifest, port: number): Promise<number> {
  let server: ReturnType<typeof serve>;
  try {
    server = serve({ manifest, port });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`spectant: cannot listen on ${LOOPBACK_HOST}:${port}: ${reason}`);
    return Promise.resolve(1);
  }
  console.log(`spectant listening on http://${LOOPBACK_HOST}:${server.port}`);
  return new Promise((resolve) => {
    const stop = () => {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
      server.stop();
      resolve(0);
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  });
}

export async function run(argv: string[], manifest: EmbeddedManifest): Promise<number> {
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
      return serveUntilSignal(manifest, command.port);
  }
}

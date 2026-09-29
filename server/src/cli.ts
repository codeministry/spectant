/**
 * The `spectant` command line (T11, ISC-8): `serve` (the default), the workspace commands `add`, `list` and `remove`
 * (T44, ISC-13) and `--version`. T50 adds the port fall-forward and opening the browser.
 *
 * `--version` (also `-v`, `-V`; T13, ISC-9) prints exactly `spectant <VERSION>` and a newline on stdout and nothing
 * else, so `scripts/check-version.ts` can compare the binary byte for byte with `package.json`. It short-circuits
 * the rest of the command line. `--no-browser` is accepted and ignored for now; opening the browser arrives with T50.
 *
 * The workspace commands work on the registry in the data directory from `paths.ts` (`$XDG_DATA_HOME/spectant` or
 * `~/.spectant`). They print a workspace by its slug and its path tail only, never its absolute path (ISC-3), and they
 * never write into the repository itself (ISC-15). A relative path resolves against the working directory.
 *
 * `run` returns the process exit code: 0 on success, 1 when serving or a workspace command fails, 2 on a usage error.
 * For `serve` it resolves only once the server has stopped on SIGINT or SIGTERM. The manifest is passed in, because
 * only `main.ts` may import the generated `server/embedded.gen.ts`. `options` lets tests pin the environment (for the
 * data directory) and the working directory; both default to the process's own.
 */
import { realpathSync } from "node:fs";
import { basename, resolve } from "node:path";
import type { EmbeddedManifest } from "./assets.contract.ts";
import { DEFAULT_PORT, LOOPBACK_HOST, serve } from "./http.ts";
import { dataDir } from "./paths.ts";
import { openRegistry, type Registry, RegistryError, type Workspace } from "./registry.ts";
import { VERSION } from "./version.ts";

const USAGE = `Usage: spectant [command] [options]

Commands:
  serve            serve the dashboard on ${LOOPBACK_HOST} (the default command)
  add <path>       register a repository with specs
  list             list the registered repositories
  remove <path|slug>
                   unregister a repository (its files are never touched)

Options:
  --port <n>       port to listen on (default ${DEFAULT_PORT}; 0 picks a free port)
  --no-browser     do not open the browser (accepted; opening the browser arrives with T50)
  -v, -V, --version
                   print the version and exit
  -h, --help       print this help and exit`;

class UsageError extends Error {}

type Command =
  | { kind: "version" }
  | { kind: "help" }
  | { kind: "serve"; port: number }
  | { kind: "add"; path: string }
  | { kind: "list" }
  | { kind: "remove"; ref: string };

export type RunOptions = {
  /** The environment the data directory is resolved from (`XDG_DATA_HOME`). Defaults to `process.env`. */
  env?: Record<string, string | undefined>;
  /** The directory a relative `add` or `remove` path resolves against. Defaults to `process.cwd()`. */
  cwd?: string;
};

function parsePort(value: string | undefined): number {
  if (value === undefined || !/^\d{1,5}$/.test(value) || Number(value) > 65535) {
    throw new UsageError(`--port needs a number from 0 to 65535, got ${value === undefined ? "nothing" : JSON.stringify(value)}`);
  }
  return Number(value);
}

function parse(argv: string[]): Command {
  let port: number | undefined;
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    if (arg === "--version" || arg === "-v" || arg === "-V") return { kind: "version" };
    if (arg === "--help" || arg === "-h") return { kind: "help" };
    if (arg === "--no-browser") continue; // a no-op until T50 opens the browser
    if (arg === "--port") port = parsePort(argv[++i]);
    else if (arg.startsWith("--port=")) port = parsePort(arg.slice("--port=".length));
    else if (arg.startsWith("-")) throw new UsageError(`unknown option ${arg}`);
    else positional.push(arg);
  }
  const [command, ...rest] = positional;
  if (command !== undefined && command !== "serve" && port !== undefined) {
    throw new UsageError(`--port only applies to serve, not to ${command}`);
  }
  const arity = (count: number, what: string): string[] => {
    if (rest.length < count) throw new UsageError(`${command ?? "serve"} needs ${what}`);
    if (rest.length > count) throw new UsageError(`unexpected argument ${rest[count] ?? ""}`);
    return rest;
  };
  switch (command) {
    case undefined:
    case "serve":
      arity(0, "");
      return { kind: "serve", port: port ?? DEFAULT_PORT };
    case "add":
      return { kind: "add", path: arity(1, "a path")[0] ?? "" };
    case "list":
      arity(0, "");
      return { kind: "list" };
    case "remove":
      return { kind: "remove", ref: arity(1, "a path or a slug")[0] ?? "" };
    default:
      throw new UsageError(`unknown command ${command}`);
  }
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

/** The last path segment: the only piece of a workspace path that is ever printed (ISC-3). */
function pathTail(workspace: Workspace): string {
  return basename(workspace.path);
}

/** The stored paths `ref` could mean: its realpath when it exists, and the plain absolute path. */
function candidatePaths(absolute: string): string[] {
  try {
    return [realpathSync(absolute), absolute];
  } catch {
    return [absolute];
  }
}

function add(registry: Registry, arg: string, cwd: string): number {
  const absolute = resolve(cwd, arg);
  try {
    const workspace = registry.add(absolute);
    console.log(`added ${workspace.slug} · ${pathTail(workspace)}`);
    return 0;
  } catch (error) {
    if (!(error instanceof RegistryError)) throw error;
    if (error.code === "duplicate-path") {
      const paths = candidatePaths(absolute);
      const existing = registry.list().find((w) => paths.includes(w.path));
      console.error(`spectant: ${arg} is already registered as ${existing?.slug ?? "another workspace"}`);
    } else {
      console.error(`spectant: ${arg} is not a directory`);
    }
    return 1;
  }
}

function list(registry: Registry): number {
  const workspaces = registry.list();
  const width = Math.max(0, ...workspaces.map((w) => w.slug.length));
  for (const workspace of workspaces) console.log(`${workspace.slug.padEnd(width)}  ${pathTail(workspace)}`);
  return 0;
}

function remove(registry: Registry, ref: string, cwd: string): number {
  const paths = candidatePaths(resolve(cwd, ref));
  const workspace = registry.get(ref) ?? registry.list().find((w) => paths.includes(w.path));
  if (workspace === undefined || !registry.remove(workspace.slug)) {
    console.error(`spectant: ${ref} is not registered`);
    return 1;
  }
  console.log(`removed ${workspace.slug}`);
  return 0;
}

function workspaceCommand(command: Command & { kind: "add" | "list" | "remove" }, options: RunOptions): number {
  const cwd = options.cwd ?? process.cwd();
  const registry = openRegistry(dataDir(options.env ?? process.env));
  try {
    switch (command.kind) {
      case "add":
        return add(registry, command.path, cwd);
      case "list":
        return list(registry);
      case "remove":
        return remove(registry, command.ref, cwd);
    }
  } finally {
    registry.close();
  }
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
      return serveUntilSignal(manifest, command.port);
    case "add":
    case "list":
    case "remove":
      return workspaceCommand(command, options);
  }
}

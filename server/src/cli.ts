/**
 * The `spectant` command line (T11, ISC-8): `serve` (the default), the workspace commands `add`, `list` and `remove`
 * (T44, ISC-13) and `--version`.
 *
 * `--version` (also `-v`, `-V`; T13, ISC-9) prints exactly `spectant <VERSION>` and a newline on stdout and nothing
 * else, so `scripts/check-version.ts` can compare the binary byte for byte with `package.json`. It short-circuits
 * the rest of the command line.
 *
 * `serve` (T50, ISC-20) listens on `DEFAULT_PORT` (7717) or `--port N`, falling forward to the next free port when it
 * is taken (`serveWithFallback`), unless `--strict-port` pins it. Once listening it prints exactly one line on stdout,
 * `spectant · http://127.0.0.1:<port>`, and opens that URL in the browser unless `--no-browser` is given. It serves
 * the settings API (`/api/settings`, T43), the workspace routes (`/api/workspaces`, T47, `api.ts`) and the spec
 * routes (`/api/workspaces/:ws/specs/:id…`, T45, `spec-routes.ts`) from `spectant.db` in the data directory, and
 * `/api/lifeos` (T51, `lifeos.ts`) from `SPECTANT_LIFEOS_STATE_DIR` in the environment, detected once at start.
 *
 * The workspace commands work on the registry in the data directory from `paths.ts` (`$XDG_DATA_HOME/spectant` or
 * `~/.spectant`). They print a workspace by its slug and its path tail only, never its absolute path (ISC-3), and they
 * never write into the repository itself (ISC-15). A relative path resolves against the working directory.
 *
 * `run` returns the process exit code: 0 on success, 1 when serving or a workspace command fails, 2 on a usage error.
 * For `serve` it resolves only once the server has stopped on SIGINT, SIGTERM or `options.signal`. The manifest is passed in, because
 * only `main.ts` may import the generated `server/embedded.gen.ts`. `options` lets tests pin the environment (for the
 * data directory), the working directory and the browser runner, and stop `serve` with a signal; all default to the
 * process's own.
 */
import { realpathSync } from "node:fs";
import { basename, resolve } from "node:path";
import { composeApi, dashboardApi } from "./api.ts";
import type { EmbeddedManifest } from "./assets.contract.ts";
import { openDatabase } from "./db.ts";
import { DEFAULT_PORT, LOOPBACK_HOST, PORT_ATTEMPTS, type RunningServer, serveWithFallback } from "./http.ts";
import { CommitCache } from "./git.ts";
import { detectLifeos, lifeosApi } from "./lifeos.ts";
import { notesApi, openNotes } from "./notes.ts";
import { type CommandRunner, openBrowser, spawnRunner } from "./open-browser.ts";
import { dataDir } from "./paths.ts";
import { openRegistry, type Registry, RegistryError, type Workspace } from "./registry.ts";
import { openSettings, settingsApi } from "./settings.ts";
import { specRoutesApi } from "./spec-routes.ts";
import { VERSION } from "./version.ts";

const USAGE = `Usage: spectant [command] [options]

Commands:
  serve            serve the dashboard on ${LOOPBACK_HOST} (the default command)
  add <path>       register a repository with specs
  list             list the registered repositories
  remove <path|slug>
                   unregister a repository (its files are never touched)

Options:
  --port <n>       port to listen on (default ${DEFAULT_PORT}; 0 picks a free port); a busy port falls
                   forward to the next free one, up to ${PORT_ATTEMPTS} ports in all
  --strict-port    fail instead of falling forward when the port is busy
  --no-browser     do not open the browser
  -v, -V, --version
                   print the version and exit
  -h, --help       print this help and exit`;

class UsageError extends Error {}

type Command =
  | { kind: "version" }
  | { kind: "help" }
  | { kind: "serve"; port: number; strictPort: boolean; openBrowser: boolean }
  | { kind: "add"; path: string }
  | { kind: "list" }
  | { kind: "remove"; ref: string };

export type RunOptions = {
  /**
   * The environment the data directory (`XDG_DATA_HOME`) and the LifeOS state directory (`SPECTANT_LIFEOS_STATE_DIR`)
   * are resolved from. Defaults to `process.env`.
   */
  env?: Record<string, string | undefined>;
  /** The directory a relative `add` or `remove` path resolves against. Defaults to `process.cwd()`. */
  cwd?: string;
  /** Runs the browser opener (`open` / `xdg-open`). Defaults to spawning it; tests record the call instead. */
  browserRunner?: CommandRunner;
  /** Stops `serve` like SIGINT does when aborted, so tests and embedders can end the run. */
  signal?: AbortSignal;
};

function parsePort(value: string | undefined): number {
  if (value === undefined || !/^\d{1,5}$/.test(value) || Number(value) > 65535) {
    throw new UsageError(`--port needs a number from 0 to 65535, got ${value === undefined ? "nothing" : JSON.stringify(value)}`);
  }
  return Number(value);
}

function parse(argv: string[]): Command {
  let port: number | undefined;
  let strictPort = false;
  let browser = true;
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    if (arg === "--version" || arg === "-v" || arg === "-V") return { kind: "version" };
    if (arg === "--help" || arg === "-h") return { kind: "help" };
    if (arg === "--no-browser") browser = false;
    else if (arg === "--strict-port") strictPort = true;
    else if (arg === "--port") port = parsePort(argv[++i]);
    else if (arg.startsWith("--port=")) port = parsePort(arg.slice("--port=".length));
    else if (arg.startsWith("-")) throw new UsageError(`unknown option ${arg}`);
    else positional.push(arg);
  }
  const [command, ...rest] = positional;
  if (command !== undefined && command !== "serve") {
    if (port !== undefined) throw new UsageError(`--port only applies to serve, not to ${command}`);
    if (strictPort) throw new UsageError(`--strict-port only applies to serve, not to ${command}`);
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
      return { kind: "serve", port: port ?? DEFAULT_PORT, strictPort, openBrowser: browser };
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

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Serves until SIGINT, SIGTERM or `options.signal`, then stops the server, closes the database and resolves 0. A
 * database or bind failure resolves 1 at once, with one line on stderr.
 */
function serveUntilSignal(manifest: EmbeddedManifest, command: Command & { kind: "serve" }, options: RunOptions): Promise<number> {
  let db: ReturnType<typeof openDatabase>;
  let registry: Registry;
  try {
    const dir = dataDir(options.env ?? process.env);
    db = openDatabase(dir);
    registry = openRegistry(dir);
  } catch (error) {
    console.error(`spectant: cannot open the data directory: ${reason(error)}`);
    return Promise.resolve(1);
  }
  let server: RunningServer;
  try {
    const lifeos = detectLifeos(options.env ?? process.env);
    // One commit cache for the process (T46): the timeline and the spec page skip `git log` while HEAD is unchanged.
    const specs = specRoutesApi({ registry, lifeos, commitCache: new CommitCache() });
    const api = composeApi(settingsApi(openSettings(db)), lifeosApi(lifeos), dashboardApi({ registry, lifeos }), notesApi({ store: openNotes(db), registry }), specs);
    server = serveWithFallback({ manifest, port: command.port, strict: command.strictPort, api });
  } catch (error) {
    registry.close();
    db.close();
    const tried = command.strictPort || command.port === 0 ? "" : ` or the ${PORT_ATTEMPTS - 1} ports above it`;
    console.error(`spectant: cannot listen on ${LOOPBACK_HOST}:${command.port}${tried}: ${reason(error)}`);
    return Promise.resolve(1);
  }
  const url = `http://${LOOPBACK_HOST}:${server.port}`;
  console.log(`spectant · ${url}`);
  if (command.openBrowser) void openBrowser(url, { platform: process.platform, run: options.browserRunner ?? spawnRunner });
  return new Promise((resolve) => {
    const stop = () => {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
      options.signal?.removeEventListener("abort", stop);
      server.stop();
      registry.close();
      db.close();
      resolve(0);
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    if (options.signal?.aborted) stop();
    else options.signal?.addEventListener("abort", stop, { once: true });
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
      return serveUntilSignal(manifest, command, options);
    case "add":
    case "list":
    case "remove":
      return workspaceCommand(command, options);
  }
}

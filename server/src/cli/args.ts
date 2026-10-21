/**
 * The command line of `spectant`, parsed into one `Command`. A malformed line throws `UsageError`, which `run` turns
 * into exit code 2 with the usage text. `--version` (also `-v`, `-V`) and `--help` short-circuit the rest of the line.
 */
import { SCHEMA_VERSION } from "../infra/db/db.ts";
import { DEFAULT_PORT } from "../infra/http/server.ts";
import { FEATURE_ARG } from "../writes/index.ts";

export class UsageError extends Error {}

export type Command =
  | { kind: "version" }
  | { kind: "help" }
  | { kind: "serve"; port: number; strictPort: boolean; openBrowser: boolean }
  | { kind: "add"; path: string }
  | { kind: "list" }
  | { kind: "remove"; ref: string }
  | { kind: "import-notes" | "export-notes"; file: string }
  | { kind: "db-rollback"; target: number; yes: boolean }
  | { kind: "gate-code-reviewed"; feature: string; root: string | null; yes: boolean }
  | { kind: "tokens"; root: string | null; transcripts: string | null; yes: boolean };

function parsePort(value: string | undefined): number {
  if (value === undefined || !/^\d{1,5}$/.test(value) || Number(value) > 65535) {
    throw new UsageError(`--port needs a number from 0 to 65535, got ${value === undefined ? "nothing" : JSON.stringify(value)}`);
  }
  return Number(value);
}

export function parse(argv: string[]): Command {
  let port: number | undefined;
  let strictPort = false;
  let browser = true;
  let yes = false;
  let root: string | undefined;
  let transcripts: string | undefined;
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    if (arg === "--version" || arg === "-v" || arg === "-V") return { kind: "version" };
    if (arg === "--help" || arg === "-h") return { kind: "help" };
    if (arg === "--no-browser") browser = false;
    else if (arg === "--yes") yes = true;
    else if (arg === "--strict-port") strictPort = true;
    else if (arg === "--port") port = parsePort(argv[++i]);
    else if (arg.startsWith("--port=")) port = parsePort(arg.slice("--port=".length));
    else if (arg === "--root" || arg.startsWith("--root=")) {
      root = arg === "--root" ? argv[++i] : arg.slice("--root=".length);
      if (root === undefined || root === "") throw new UsageError("--root needs a directory");
    } else if (arg === "--transcripts" || arg.startsWith("--transcripts=")) {
      transcripts = arg === "--transcripts" ? argv[++i] : arg.slice("--transcripts=".length);
      if (transcripts === undefined || transcripts === "") throw new UsageError("--transcripts needs a directory");
    }
    else if (arg.startsWith("-")) throw new UsageError(`unknown option ${arg}`);
    else positional.push(arg);
  }
  const [command, ...rest] = positional;
  if (command !== undefined && command !== "serve") {
    if (port !== undefined) throw new UsageError(`--port only applies to serve, not to ${command}`);
    if (strictPort) throw new UsageError(`--strict-port only applies to serve, not to ${command}`);
  }
  if (yes && command !== "db" && command !== "gate" && command !== "tokens") {
    throw new UsageError(`--yes only applies to db rollback, gate and tokens, not to ${command ?? "serve"}`);
  }
  if (root !== undefined && command !== "gate" && command !== "tokens") {
    throw new UsageError(`--root only applies to gate and tokens, not to ${command ?? "serve"}`);
  }
  if (transcripts !== undefined && command !== "tokens") throw new UsageError(`--transcripts only applies to tokens, not to ${command ?? "serve"}`);
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
    case "import-notes":
    case "export-notes":
      return { kind: command, file: arity(1, "a file")[0] ?? "" };
    case "db": {
      const [sub, version] = arity(2, "rollback and a schema version");
      if (sub !== "rollback") throw new UsageError(`unknown db command ${sub ?? ""}`);
      const target = /^\d{1,3}$/.test(version ?? "") ? Number(version) : Number.NaN;
      if (!(target >= 1 && target < SCHEMA_VERSION)) {
        throw new UsageError(`db rollback needs a schema version from 1 to ${SCHEMA_VERSION - 1}, got ${JSON.stringify(version)}`);
      }
      return { kind: "db-rollback", target, yes };
    }
    case "gate": {
      const [gate, feature = ""] = arity(2, "code-reviewed and a feature id F<n>");
      if (gate !== "code-reviewed") throw new UsageError(`unknown gate ${gate ?? ""}; the CLI writes only code-reviewed`);
      if (!FEATURE_ARG.test(feature)) throw new UsageError(`gate code-reviewed needs a feature id F<n>, got ${JSON.stringify(feature)}`);
      return { kind: "gate-code-reviewed", feature, root: root ?? null, yes };
    }
    case "tokens":
      arity(0, "");
      return { kind: "tokens", root: root ?? null, transcripts: transcripts ?? null, yes };
    default:
      throw new UsageError(`unknown command ${command}`);
  }
}

// The CLI golden master of spec 059 (T4, ISC-406): the `spectant` command line driven in process through `run`, as
// `tests/cli.test.ts` drives it, with each invocation's argv, exit code, stdout and stderr compared byte for byte with
// the recording `tests/fixtures/golden/cli.json`, taken on the server code before the slice refactor began.
//
// Covered: `--help`, `-h`, the version flags, the help of every subcommand (`serve`, `add`, `list`, `remove`,
// `import-notes`, `export-notes`, `db rollback`, `gate code-reviewed`, `tokens`), an unknown command and unknown
// options, every usage error of the parser (port values, options outside their command, missing and extra
// arguments, schema versions, gate names and feature ids), every error case `tests/cli.test.ts` exercises (busy
// port with `--strict-port`, `tokens` without `specs/` and without a transcript folder) and a data directory that
// cannot open, and the happy and refused paths of each command on temp fixtures: serve on port 0, the workspace
// commands, the notes import and export, `db rollback`, `gate code-reviewed` (refusals, the plan and the write) and
// `tokens` (the plan and the write).
//
// Determinism: `TZ=UTC`, `HOME`, `GIT_CONFIG_GLOBAL` and `XDG_CONFIG_HOME` point at a temp config, the data
// directory and `CLAUDE_CONFIG_DIR` are temp folders passed through `run`'s `env`, and the gate's git fixture is
// committed with a fixed identity and date. What still varies is normalised, in argv and in output alike, and
// nothing else: the temp root (`<tmp>`, `<home>` for the temp HOME, `<tmp-encoded>` in Claude Code's project folder
// name), 40-hex git ids (`<sha>`, the gate's tree and head), loopback ports (`<port>`, `<busy-port>` for the blocked
// one) and the version (`<VERSION>`, read from `package.json`).
//
// The test fails when the recording is missing or any entry differs. To re-record, on purpose and only on code whose
// output is known to be right:
//
//   GOLDEN_RECORD=1 bun test ./tests/golden-cli.test.ts
//
// A re-recording is a reviewed change of `cli.json`, never a way to make this test pass.
import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// The one import list of `server/src/` in this suite, so a module move touches one spot.
import type { EmbeddedManifest } from "../server/src/contracts/assets.contract.ts";
import { type RunOptions, run } from "../server/src/cli/index.ts";

const FILE = join(import.meta.dir, "fixtures", "golden", "cli.json");
const RECORD = process.env.GOLDEN_RECORD === "1";
const HARBOR = join(import.meta.dir, "..", "core", "fixtures", "harbor");
const PACKAGE = join(import.meta.dir, "..", "package.json");
/** The viewer's address in the gate's git fixture (reserved `.test` domain). */
const VIEWER_EMAIL = "viewer@example.test";
/** The fixed commit date of the gate's git fixture. */
const GIT_DATE = "2026-03-01T09:00:00Z";
const ENV_KEYS = ["TZ", "HOME", "GIT_CONFIG_GLOBAL", "XDG_CONFIG_HOME"] as const;

/** One recorded invocation. `stdout` and `stderr` are the bytes written, each console line with its newline. */
interface CliEntry {
  readonly name: string;
  readonly argv: readonly string[];
  readonly exit: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Claude Code's project folder name of a path: every non-alphanumeric character becomes `-`. */
const encoded = (path: string): string => path.replace(/[^A-Za-z0-9]/g, "-");

function gitIn(repo: string, ...args: string[]): void {
  const env = {
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"].includes(key))),
    GIT_AUTHOR_DATE: GIT_DATE,
    GIT_COMMITTER_DATE: GIT_DATE,
  };
  const result = Bun.spawnSync(["git", "-C", repo, ...args], { env, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr.toString()}`);
}

/** Ticks ISC-131 in the master and in 009's spec.md, so feature F6 has no open claim left. */
function closeF6(repo: string): void {
  for (const file of [join(repo, "ISA.md"), join(repo, "specs", "009-chunked-upload-limits", "spec.md")]) {
    const text = readFileSync(file, "utf8");
    const ticked = text.replace("- [ ] ISC-131:", "- [x] ISC-131:"); // single-core: allow — test setup ticks one known line
    if (ticked === text) throw new Error(`ISC-131 is not open in ${file}`);
    writeFileSync(file, ticked);
  }
}

/** A copy of harbor at `<parent>/harbor`; `closed` ticks F6's last claim, `git` commits it as a repository of its own. */
function harbor(parent: string, options: { closed: boolean; git: boolean }): string {
  const repo = join(parent, "harbor");
  mkdirSync(parent, { recursive: true });
  cpSync(HARBOR, repo, { recursive: true });
  if (options.closed) closeF6(repo);
  if (options.git) {
    gitIn(repo, "init", "--quiet", "--initial-branch=main");
    gitIn(repo, "config", "user.email", VIEWER_EMAIL);
    writeFileSync(join(repo, ".git", "info", "exclude"), "specs/*/.gates/\n");
    gitIn(repo, "add", "-A");
    gitIn(repo, "-c", "user.name=Viewer", "commit", "--quiet", "-m", "harbor");
  }
  return repo;
}

function put(path: string, text: string): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
}

describe("ISC-406 golden cli: help, usage errors, exit codes and output of every command", () => {
  const saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  let base = "";
  let made = "";
  let home = "";
  let manifest: EmbeddedManifest;
  let env: Record<string, string>;
  let version = "";

  beforeAll(async () => {
    made = mkdtempSync(join(tmpdir(), "spectant-golden-cli-"));
    base = realpathSync(made);
    home = join(base, "home");
    mkdirSync(home, { recursive: true });
    const gitconfig = join(home, ".gitconfig");
    writeFileSync(gitconfig, "[user]\n\tname = Golden Viewer\n");
    process.env.TZ = "UTC";
    process.env.HOME = home;
    process.env.GIT_CONFIG_GLOBAL = gitconfig;
    process.env.XDG_CONFIG_HOME = join(home, ".config");
    const index = join(base, "web", "index.html");
    put(index, "<!doctype html><title>spectant</title>\n");
    manifest = { generatedAt: "2026-03-01T09:00:00.000Z", index, assets: [] };
    env = { XDG_DATA_HOME: join(base, "xdg"), CLAUDE_CONFIG_DIR: join(base, "claude"), HOME: home };
    version = ((await Bun.file(PACKAGE).json()) as { version: string }).version;
  });
  afterAll(() => {
    for (const key of ENV_KEYS) {
      const value = saved[key];
      if (value === undefined) Reflect.deleteProperty(process.env, key);
      else process.env[key] = value;
    }
    rmSync(base, { recursive: true, force: true });
  });

  /** The normalised text: temp paths, git ids, loopback ports and the version; `extra` first, longest match first. */
  function normalise(text: string, extra: ReadonlyArray<readonly [string, string]> = []): string {
    let out = text;
    for (const [from, to] of extra) out = out.replaceAll(from, to);
    const paths: Array<readonly [string, string]> = [
      [home, "<home>"],
      [base, "<tmp>"],
      [made, "<tmp>"],
      [encoded(base), "<tmp-encoded>"],
      [encoded(made), "<tmp-encoded>"],
    ];
    for (const [from, to] of paths) out = out.replaceAll(from, to);
    return out
      .replace(/\b[0-9a-f]{40}\b/g, "<sha>")
      .replace(/(127\.0\.0\.1|localhost):\d+/g, "$1:<port>")
      .replaceAll(`spectant ${version}`, "spectant <VERSION>");
  }

  type Invocation = { readonly options?: RunOptions; readonly serve?: boolean; readonly extra?: ReadonlyArray<readonly [string, string]> };

  /** Runs `argv` through `run` with every console and stream write captured; a `serve` call is stopped once it listens. */
  async function invoke(name: string, argv: string[], invocation: Invocation = {}): Promise<CliEntry> {
    let stdout = "";
    let stderr = "";
    const toOut = (...args: unknown[]): void => void (stdout += `${args.join(" ")}\n`);
    const toErr = (...args: unknown[]): void => void (stderr += `${args.join(" ")}\n`);
    const writeTo = (sink: (text: string) => void) => (chunk: string | Uint8Array): boolean => {
      sink(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk));
      return true;
    };
    const spies = [
      spyOn(console, "log").mockImplementation(toOut),
      spyOn(console, "info").mockImplementation(toOut),
      spyOn(console, "error").mockImplementation(toErr),
      spyOn(console, "warn").mockImplementation(toErr),
      spyOn(process.stdout, "write").mockImplementation(writeTo((text) => (stdout += text))),
      spyOn(process.stderr, "write").mockImplementation(writeTo((text) => (stderr += text))),
    ];
    const abort = new AbortController();
    const browserRunner = (): Promise<number> => Promise.resolve(0);
    try {
      const done = run(argv, manifest, { env, browserRunner, signal: abort.signal, ...invocation.options });
      if (invocation.serve === true) {
        const state = { settled: false };
        void done.then(() => (state.settled = true));
        const deadline = Date.now() + 5_000;
        while (!state.settled && !stdout.includes("spectant · ")) {
          if (Date.now() > deadline) throw new Error(`${name}: no URL line; stderr: ${stderr}`);
          await Bun.sleep(5);
        }
        abort.abort();
      }
      const exit = await done;
      const extra = invocation.extra ?? [];
      return { name, argv: argv.map((arg) => normalise(arg, extra)), exit, stdout: normalise(stdout, extra), stderr: normalise(stderr, extra) };
    } finally {
      abort.abort();
      for (const spy of spies) spy.mockRestore();
    }
  }

  test("golden cli: every invocation equals the recording", async () => {
    const entries: CliEntry[] = [];
    const call = async (name: string, argv: string[], invocation?: Invocation): Promise<void> => {
      entries.push(await invoke(name, argv, invocation));
    };

    // ── help and version ─────────────────────────────────────────────────────────────────────────────────────
    await call("help --help", ["--help"]);
    await call("help -h", ["-h"]);
    await call("version --version", ["--version"]);
    await call("version -v", ["-v"]);
    await call("version -V", ["-V"]);
    await call("version before --no-browser", ["-V", "--no-browser"]);
    await call("version after --no-browser", ["--no-browser", "--version"]);
    await call("version wins over help", ["--version", "--help"]);
    for (const sub of [["serve"], ["add"], ["list"], ["remove"], ["import-notes"], ["export-notes"], ["db"], ["db", "rollback"], ["gate"], ["gate", "code-reviewed"], ["tokens"]]) {
      await call(`help ${sub.join(" ")} --help`, [...sub, "--help"]);
      await call(`help ${sub.join(" ")} -h`, [...sub, "-h"]);
    }

    // ── unknown commands and options ─────────────────────────────────────────────────────────────────────────
    await call("unknown command", ["frobnicate"]);
    await call("unknown command help", ["help"]);
    await call("unknown option", ["--bogus"]);
    await call("unknown short option", ["-x"]);
    await call("unknown option on list", ["list", "--bogus"]);
    await call("unknown option before help", ["--bogus", "--help"]);

    // ── port values ──────────────────────────────────────────────────────────────────────────────────────────
    await call("port missing value", ["--port"]);
    await call("port not a number", ["serve", "--port", "http"]);
    await call("port too large", ["--port=70000"]);
    await call("port negative", ["--port", "-1"]);
    await call("port empty", ["--port="]);
    await call("port six digits", ["--port", "123456"]);

    // ── options outside their command ────────────────────────────────────────────────────────────────────────
    await call("port on list", ["list", "--port", "1"]);
    await call("strict-port on list", ["list", "--strict-port"]);
    await call("yes on list", ["list", "--yes"]);
    await call("yes on serve", ["--yes"]);
    await call("root on list", ["list", "--root", "x"]);
    await call("root on serve", ["--root", "x"]);
    await call("root missing value", ["tokens", "--root"]);
    await call("root empty", ["gate", "code-reviewed", "F1", "--root="]);
    await call("transcripts on serve", ["serve", "--transcripts", "x"]);
    await call("transcripts on list", ["list", "--transcripts", "x"]);
    await call("transcripts on gate", ["gate", "code-reviewed", "F1", "--transcripts", "x"]);
    await call("transcripts missing value", ["tokens", "--transcripts"]);
    await call("transcripts empty", ["tokens", "--transcripts="]);
    await call("tokens unknown option", ["tokens", "--bogus"]);

    // ── arguments ────────────────────────────────────────────────────────────────────────────────────────────
    await call("serve extra argument", ["serve", "extra"]);
    await call("add without a path", ["add"]);
    await call("add two paths", ["add", "a", "b"]);
    await call("list extra argument", ["list", "extra"]);
    await call("remove without a ref", ["remove"]);
    await call("remove two refs", ["remove", "a", "b"]);
    await call("import-notes without a file", ["import-notes"]);
    await call("export-notes two files", ["export-notes", "a", "b"]);
    await call("db without arguments", ["db"]);
    await call("db rollback without a version", ["db", "rollback"]);
    await call("db unknown command", ["db", "frob", "1"]);
    await call("db rollback 0", ["db", "rollback", "0"]);
    await call("db rollback past the schema", ["db", "rollback", "99"]);
    await call("db rollback not a number", ["db", "rollback", "x"]);
    await call("db rollback extra argument", ["db", "rollback", "1", "2"]);
    await call("gate without arguments", ["gate"]);
    await call("gate code-reviewed without a feature", ["gate", "code-reviewed"]);
    await call("gate unknown gate", ["gate", "reviewed", "F6"]);
    await call("gate bad feature id", ["gate", "code-reviewed", "6"]);
    await call("gate lower-case feature id", ["gate", "code-reviewed", "f6"]);
    await call("tokens extra argument", ["tokens", "extra"]);

    // ── serve ────────────────────────────────────────────────────────────────────────────────────────────────
    await call("serve on port 0", ["--port", "0", "--no-browser"], { serve: true });
    await call("serve on port 0 opening the browser", ["serve", "--port=0"], { serve: true });
    const blocker = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data: () => undefined } });
    try {
      const busy: ReadonlyArray<readonly [string, string]> = [[`127.0.0.1:${blocker.port}`, "127.0.0.1:<busy-port>"], [String(blocker.port), "<busy-port>"]];
      await call("serve busy port strict", ["serve", "--strict-port", "--port", String(blocker.port)], { extra: busy });
      await call("serve busy port strict, flags first", ["--no-browser", "--strict-port", "--port", String(blocker.port)], { extra: busy });
      await call("serve busy port falls forward", ["--port", String(blocker.port), "--no-browser"], { serve: true, extra: busy });
    } finally {
      blocker.stop(true);
    }
    const notADir = join(base, "not-a-dir");
    writeFileSync(notADir, "a file where the data directory should be\n");
    await call("serve data directory cannot open", ["--port", "0", "--no-browser"], { options: { env: { ...env, XDG_DATA_HOME: notADir } } });

    // ── workspace commands ───────────────────────────────────────────────────────────────────────────────────
    const ws = join(base, "ws");
    mkdirSync(join(ws, "alpha"), { recursive: true });
    mkdirSync(join(ws, "beta-repo"), { recursive: true });
    mkdirSync(join(ws, "nested", "alpha"), { recursive: true });
    const inWs = { options: { cwd: ws } };
    await call("list empty", ["list"], inWs);
    await call("add relative", ["add", "alpha"], inWs);
    await call("add duplicate", ["add", "./alpha"], inWs);
    await call("add missing", ["add", "missing"], inWs);
    await call("add a file", ["add", join(base, "not-a-dir")], inWs);
    await call("add absolute", ["add", join(ws, "beta-repo")], inWs);
    await call("add same basename", ["add", "nested/alpha"], inWs);
    await call("list three", ["list"], inWs);
    await call("remove unknown", ["remove", "gamma"], inWs);
    await call("remove by slug", ["remove", "alpha-2"], inWs);
    await call("remove by path", ["remove", "beta-repo"], inWs);
    await call("remove again", ["remove", "beta-repo"], inWs);
    await call("list one", ["list"], inWs);

    // ── notes ────────────────────────────────────────────────────────────────────────────────────────────────
    const notes = join(base, "notes");
    put(
      join(notes, "old.json"),
      JSON.stringify({
        v: 1,
        notes: [
          { id: "old-1", title: "First", body: "Body", repo: "alpha", spec: "001-start", ref: "ISC-1", created: "2026-01-01T00:00:00Z", updated: "2026-01-02T00:00:00Z" },
          { id: "old-2", title: "Lost", body: "", repo: "nowhere", created: "2026-01-01T00:00:00Z" },
          { title: "No id", repo: "alpha" },
        ],
      }),
    );
    put(join(notes, "bad.json"), "{not json");
    put(join(notes, "shape.json"), '{"v":2}');
    const inNotes = { options: { cwd: notes } };
    await call("export-notes empty", ["export-notes", "empty.json"], inNotes);
    await call("import-notes", ["import-notes", "old.json"], inNotes);
    await call("import-notes again", ["import-notes", "old.json"], inNotes);
    await call("import-notes missing file", ["import-notes", "missing.json"], inNotes);
    await call("import-notes not json", ["import-notes", "bad.json"], inNotes);
    await call("import-notes wrong shape", ["import-notes", "shape.json"], inNotes);
    await call("import-notes a directory", ["import-notes", "."], inNotes);
    await call("export-notes", ["export-notes", "out.json"], inNotes);
    await call("export-notes into a missing folder", ["export-notes", "nowhere/out.json"], inNotes);

    // ── gate code-reviewed ───────────────────────────────────────────────────────────────────────────────────
    const empty = join(base, "gate", "empty");
    mkdirSync(empty, { recursive: true });
    const open = harbor(join(base, "gate", "open"), { closed: false, git: false });
    const plain = harbor(join(base, "gate", "plain"), { closed: true, git: false });
    const gated = harbor(join(base, "gate", "git"), { closed: true, git: true });
    await call("gate root without a master", ["gate", "code-reviewed", "F1", "--root", empty]);
    await call("gate open claims", ["gate", "code-reviewed", "F6", "--root", open]);
    await call("gate unknown feature", ["gate", "code-reviewed", "F99", "--root", plain, "--yes"]);
    await call("gate without a tree id", ["gate", "code-reviewed", "F6", "--root", plain, "--yes"]);
    await call("gate plan", ["gate", "code-reviewed", "F6", "--root", gated]);
    await call("gate plan relative root", ["gate", "code-reviewed", "F6", "--root=harbor"], { options: { cwd: join(base, "gate", "git") } });
    await call("gate write", ["gate", "code-reviewed", "F6", "--root", gated, "--yes"]);
    await call("gate write again", ["gate", "code-reviewed", "F6", "--yes"], { options: { cwd: gated } });

    // ── tokens ───────────────────────────────────────────────────────────────────────────────────────────────
    const noSpecs = join(base, "tokens", "no-specs");
    mkdirSync(noSpecs, { recursive: true });
    const lonely = join(base, "tokens", "lonely");
    mkdirSync(join(lonely, "specs"), { recursive: true });
    const measured = join(base, "tokens", "measured");
    mkdirSync(join(measured, "specs"), { recursive: true });
    put(join(base, "claude", "projects", encoded(measured), "s.jsonl"), "{}\n");
    const transcripts = join(base, "transcripts", "-elsewhere");
    put(join(transcripts, "t.jsonl"), "{}\n");
    await call("tokens without specs", ["tokens", "--root", noSpecs, "--transcripts", transcripts]);
    await call("tokens without a transcript folder", ["tokens", "--root", lonely]);
    await call("tokens with a missing --transcripts", ["tokens", "--root", lonely, "--transcripts", join(base, "transcripts", "-none")]);
    await call("tokens plan", ["tokens", "--root", measured]);
    await call("tokens plan with --transcripts", ["tokens", "--transcripts", transcripts], { options: { cwd: measured } });
    await call("tokens write", ["tokens", "--root", measured, "--yes"]);

    // ── db rollback, last: it lowers the schema of the shared data directory ─────────────────────────────────
    await call("db rollback refused without --yes", ["db", "rollback", "1"]);
    await call("db rollback 5 --yes", ["db", "rollback", "5", "--yes"]);
    await call("db rollback 5 again", ["db", "rollback", "5"]);

    if (RECORD) {
      put(FILE, `${JSON.stringify(entries, null, 2)}\n`);
      return;
    }
    expect(existsSync(FILE)).toBe(true);
    const recorded = JSON.parse(readFileSync(FILE, "utf8")) as CliEntry[];
    expect(entries.map((e) => e.name)).toEqual(recorded.map((e) => e.name));
    for (const [i, entry] of entries.entries()) expect(entry).toEqual(recorded[i] as CliEntry);
  }, 60_000);
});

// `spectant tokens` end to end over the hand-written transcript fixture (spec 009). The command runs through its seam,
// `tokensCommand`, against a temp copy of the harbor fixture's `specs/` and a temp copy of the transcript fixture, so
// no embedded web build is needed and the operator's own Claude Code config is never read.
//
// - `robust` (ISC-135.4, T14): a line that is not JSON, a transcript without usage and an unknown spec number are each
//   one diagnostic on stderr; the run ends with exit 0 and still writes the file with `--yes`. A transcript folder that
//   cannot be read is the one failure that stays exit 1.
// - `deterministic` (ISC-136, T15): the same transcripts measured twice give a byte-identical `specs/tokens.jsonl`,
//   equal to the golden, whatever order the folder lists its files in and whatever the clock or time zone says.
import { afterEach, beforeEach, describe, expect, setSystemTime, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { TOKENS_PATH, tokensCommand } from "../server/src/tokens-cli.ts";

const HARBOR_SPECS = join(import.meta.dir, "..", "core", "fixtures", "harbor", "specs");
const TRANSCRIPTS = join(import.meta.dir, "..", "core", "tests", "fixtures", "transcripts");
const GOLDEN = join(import.meta.dir, "..", "core", "tests", "fixtures", "tokens.golden.jsonl");

/** The main session of the fixture and the line in it that is not JSON. */
const MAIN_SESSION = "5e1f0c2a-7b3d-4e8f-9a10-2b3c4d5e6f70.jsonl";
const BROKEN_LINE = 30;

const made: string[] = [];
const out: string[] = [];
const err: string[] = [];
const restore: Array<() => void> = [];

function temp(prefix: string): string {
  const dir = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), prefix)));
  made.push(dir);
  return dir;
}

function put(path: string, text: string | Uint8Array): void {
  fs.mkdirSync(dirname(path), { recursive: true });
  fs.writeFileSync(path, text);
}

/** Every file below `dir`, as paths relative to it, in byte order. */
function filesBelow(dir: string): string[] {
  const found: string[] = [];
  const walk = (at: string): void => {
    for (const entry of fs.readdirSync(at, { withFileTypes: true })) {
      const path = join(at, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) found.push(relative(dir, path));
    }
  };
  walk(dir);
  return found.sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
}

/** A fresh repository root: the harbor fixture's `specs/`, without a `specs/tokens.jsonl` of its own. */
function harborRoot(): string {
  const root = temp("spectant-tokens-cli-root-");
  fs.cpSync(HARBOR_SPECS, join(root, "specs"), { recursive: true });
  fs.rmSync(join(root, TOKENS_PATH), { force: true });
  return root;
}

/**
 * A copy of the transcript fixture under a temp `projects/` folder, the main folder `harbor` beside its worktree
 * sibling; answers the main folder, the one `--transcripts` names. `reverse` creates every folder and file in the
 * opposite order, so whatever order the file system keeps entries in, the two copies start out differently.
 */
function transcriptCopy(reverse = false): string {
  const projects = temp("spectant-tokens-cli-projects-");
  const files = filesBelow(TRANSCRIPTS);
  for (const file of reverse ? [...files].reverse() : files) put(join(projects, file), fs.readFileSync(join(TRANSCRIPTS, file)));
  return join(projects, "harbor");
}

const tokensText = (root: string): string => fs.readFileSync(join(root, TOKENS_PATH), "utf8");
const tokensBytes = (root: string): Buffer => fs.readFileSync(join(root, TOKENS_PATH));

async function measure(root: string, transcripts: string, yes: boolean): Promise<number> {
  return tokensCommand(root, { transcripts, yes, env: {}, home: temp("spectant-tokens-cli-home-") });
}

/** Transcript lines as Claude Code writes them, reduced to what the measurement reads. */
const userLine = (ts: string, content: string): string => JSON.stringify({ type: "user", timestamp: ts, message: { role: "user", content } });
const commandLine = (ts: string, name: string, args: string): string =>
  userLine(ts, `<command-message>${name.slice(1)}</command-message>\n<command-name>${name}</command-name>\n<command-args>${args}</command-args>`);
const usageLine = (ts: string, requestId: string, input: number): string =>
  JSON.stringify({
    type: "assistant",
    timestamp: ts,
    requestId,
    version: "2.1.42",
    message: {
      id: `msg_${requestId}`,
      role: "assistant",
      content: [{ type: "text", text: "ok" }],
      usage: { input_tokens: input, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    },
  });

const kindsOf = (text: string): string[] =>
  text
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => (JSON.parse(line) as { kind: string }).kind);

beforeEach(() => {
  out.length = 0;
  err.length = 0;
  const log = spyOn(console, "log").mockImplementation((...args: unknown[]) => void out.push(args.join(" ")));
  const error = spyOn(console, "error").mockImplementation((...args: unknown[]) => void err.push(args.join(" ")));
  restore.push(
    () => log.mockRestore(),
    () => error.mockRestore(),
  );
});

afterEach(() => {
  for (const undo of restore.splice(0).reverse()) undo();
  for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("robust", () => {
  test("a line that is not JSON is one stderr diagnostic with its file and line; exit 0, the file is written", async () => {
    const root = harborRoot();
    expect(await measure(root, transcriptCopy(), true)).toBe(0);
    const notJson = err.filter((line) => line.includes("tokens-line-not-json"));
    expect(notJson).toHaveLength(1);
    expect(notJson[0]).toStartWith(`spectant: tokens: warning ${MAIN_SESSION} line ${BROKEN_LINE}: tokens-line-not-json: `);
    expect(out.join("\n")).not.toContain("tokens-");
    expect(out[0]).toStartWith(`tokens wrote ${TOKENS_PATH}`);
    // The turns without a /spec reference land in exactly one unassigned line.
    expect(kindsOf(tokensText(root)).filter((kind) => kind === "unassigned")).toHaveLength(1);
  });

  test("a transcript without usage is one stderr diagnostic; exit 0, the file is written", async () => {
    const root = harborRoot();
    const transcripts = transcriptCopy();
    put(join(transcripts, "talk-only.jsonl"), `${[userLine("2026-03-09T09:00:00.000Z", "only talk"), userLine("2026-03-09T09:01:00.000Z", "still talk")].join("\n")}\n`);
    expect(await measure(root, transcripts, true)).toBe(0);
    const noUsage = err.filter((line) => line.includes("tokens-transcript-no-usage"));
    expect(noUsage).toHaveLength(1);
    expect(noUsage[0]).toContain("talk-only.jsonl");
    expect(fs.existsSync(join(root, TOKENS_PATH))).toBe(true);
  });

  test("an unknown spec number is one stderr diagnostic; exit 0, the invocation is written with no spec", async () => {
    const root = harborRoot();
    const transcripts = transcriptCopy();
    put(join(transcripts, "unknown-spec.jsonl"), `${[commandLine("2026-03-09T10:00:00.000Z", "/spec-plan", "999"), usageLine("2026-03-09T10:00:05.000Z", "req_unknown_spec", 5)].join("\n")}\n`);
    expect(await measure(root, transcripts, true)).toBe(0);
    const unknown = err.filter((line) => line.includes("tokens-spec-unknown"));
    expect(unknown).toHaveLength(1);
    expect(unknown[0]).toContain("unknown-spec.jsonl");
    const written = tokensText(root)
      .split("\n")
      .filter((line) => line.includes('"ts":"2026-03-09T10:00:00.000Z"'));
    expect(written).toHaveLength(1);
    expect(JSON.parse(written[0] ?? "{}")).toMatchObject({ kind: "invocation", command: "/spec-plan", spec: null, requests: 1, input: 5 });
  });

  test("all three at once without --yes: every finding on stderr, exit 0, nothing written", async () => {
    const root = harborRoot();
    const transcripts = transcriptCopy();
    put(join(transcripts, "talk-only.jsonl"), `${userLine("2026-03-09T09:00:00.000Z", "only talk")}\n`);
    put(join(transcripts, "unknown-spec.jsonl"), `${[commandLine("2026-03-09T10:00:00.000Z", "/spec-plan", "999"), usageLine("2026-03-09T10:00:05.000Z", "req_unknown_spec", 5)].join("\n")}\n`);
    expect(await measure(root, transcripts, false)).toBe(0);
    const text = err.join("\n");
    for (const code of ["tokens-line-not-json", "tokens-transcript-no-usage", "tokens-spec-unknown"]) expect(text).toContain(code);
    expect(out.at(-1)).toBe("run it again with --yes to write");
    expect(fs.existsSync(join(root, TOKENS_PATH))).toBe(false);
  });

  test("a transcript folder that cannot be read stays exit 1 and writes nothing", async () => {
    const root = harborRoot();
    const missing = join(temp("spectant-tokens-cli-projects-"), "harbor");
    expect(await measure(root, missing, true)).toBe(1);
    expect(err.at(-1)).toMatch(/^spectant: tokens: the transcript folder harbor cannot be read \(/);
    expect(fs.existsSync(join(root, TOKENS_PATH))).toBe(false);
  });
});

describe("deterministic", () => {
  const timeZone = process.env.TZ;
  afterEach(() => {
    setSystemTime();
    if (timeZone === undefined) delete process.env.TZ;
    else process.env.TZ = timeZone;
  });

  test("the same transcripts measured twice with --yes give byte-identical files, equal to the golden", async () => {
    const root = harborRoot();
    const transcripts = transcriptCopy();
    expect(await measure(root, transcripts, true)).toBe(0);
    const first = tokensBytes(root);
    expect(first.toString("utf8")).toBe(fs.readFileSync(GOLDEN, "utf8"));
    // The second run reads the file it wrote back, keeps its baseline line and adds none for the same state.
    expect(await measure(root, transcripts, true)).toBe(0);
    expect(tokensBytes(root).equals(first)).toBe(true);
  });

  test("byte-identical across reversed file order, another clock and another time zone", async () => {
    // Run A: files created in byte order, the folders listed as the file system lists them, an early clock in UTC.
    process.env.TZ = "UTC";
    setSystemTime(new Date("1999-01-02T03:04:05.000Z"));
    const rootA = harborRoot();
    expect(await measure(rootA, transcriptCopy(), true)).toBe(0);
    const a = tokensBytes(rootA);

    // Run B: files created in reverse order and every folder listed back to front, a late clock, a far time zone.
    process.env.TZ = "Pacific/Chatham";
    setSystemTime(new Date("2041-07-08T09:10:11.000Z"));
    const rootB = harborRoot();
    const transcriptsB = transcriptCopy(true);
    const readdir = fs.readdirSync;
    const reversed = spyOn(fs, "readdirSync").mockImplementation(((...args: Parameters<typeof readdir>) =>
      (readdir(...args) as unknown[]).reverse()) as typeof readdir);
    restore.push(() => reversed.mockRestore());
    expect(await measure(rootB, transcriptsB, true)).toBe(0);
    expect(reversed.mock.calls.length).toBeGreaterThan(0);
    expect(await measure(rootB, transcriptsB, true)).toBe(0);
    const b = tokensBytes(rootB);

    expect(b.equals(a)).toBe(true);
    expect(a.toString("utf8")).toBe(fs.readFileSync(GOLDEN, "utf8"));
    // No wall-clock content: neither faked year appears anywhere in the file.
    for (const year of ["1999", "2041"]) expect(a.toString("utf8")).not.toContain(year);
  });
});

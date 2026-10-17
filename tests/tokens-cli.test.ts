// `spectant tokens` end to end over the hand-written transcript fixture (spec 009). The command runs through its seam,
// `tokensCommand`, against a temp copy of the harbor fixture's `specs/` and a temp copy of the transcript fixture, so
// no embedded web build is needed and the operator's own Claude Code config is never read.
//
// - `robust` (ISC-135.4, T14): a line that is not JSON, a transcript without usage and an unknown spec number are each
//   one diagnostic on stderr; the run ends with exit 0 and still writes the file with `--yes`. A transcript folder that
//   cannot be read is the one failure that stays exit 1.
// - `deterministic` (ISC-136, T15): the same transcripts measured twice give a byte-identical `specs/tokens.jsonl`,
//   equal to the golden, whatever order the folder lists its files in and whatever the clock or time zone says.
// - `leak` (ISC-137.2, T22): none of the fixture's bait values (working directory, branch, e-mail, a person's name,
//   prompt and answer text, the `/spec-idea` argument, the model name) reaches `specs/tokens.jsonl`; every line carries
//   exactly the keys of its row kind and every string value has one of the allowed shapes. A generated case injects
//   random baits into every free-text field of a transcript copy.
// - `offline` (ISC-137.3, T23): with every network entry point of the process stubbed to record and fail, the command
//   makes zero calls, with and without `--yes`, and the app's data directory stays empty.
// - `worktrees` (ISC-178, T28): the project folder of a spec worktree inside the repository, `<folder>--worktrees-NNN-slug`,
//   is read like the older sibling `<folder>-NNN` (main sessions and their sub-agents), both patterns stay, and no
//   look-alike, a nested agent worktree above all, is taken for one; the measured file is the golden. A slug with
//   capital letters (`mixed case slug`, ISC-219, T36) is read like its lower-case form.
import * as sqlite from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, setSystemTime, spyOn, test } from "bun:test";
import * as dns from "node:dns";
import * as fs from "node:fs";
import * as http from "node:http";
import * as https from "node:https";
import * as net from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import * as tls from "node:tls";
import { EVENT_STAGES } from "../core/src/events.ts";
import { BASELINE_COMMAND_KEYS, TOKEN_COUNTERS, TOKEN_ROW_KEYS, TOKEN_ROW_KINDS, type TokenRowKind } from "../core/src/tokens.ts";
import * as paths from "../server/src/paths.ts";
import { TOKENS_PATH, discoverTranscripts, encodeProjectPath, tokensCommand } from "../server/src/tokens-cli.ts";

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
 * and spec-worktree siblings (`harbor--claude-worktrees-agent-…`, `harbor--worktrees-012-harbor`, `harbor-012`);
 * answers the main folder, the one `--transcripts` names, and the run finds every sibling next to it. `reverse` creates every folder and file in the
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

describe("worktrees", () => {
  /** The fixture's spec worktree inside the repository, `.worktrees/012-harbor`: its project folder and its one session. */
  const IN_REPO = "harbor--worktrees-012-harbor";
  const IN_REPO_SESSION = "7d2e4f60-1a3b-4c5d-8e9f-0a1b2c3d4e5f";

  const seen = (folder: string): Array<{ role: string; label: string }> => discoverTranscripts(folder).files.map(({ role, label }) => ({ role, label }));

  test("`<folder>--worktrees-NNN-slug` is read: its session as main, labelled relative to the folder, no diagnostic", () => {
    const { files, diagnostics } = discoverTranscripts(transcriptCopy());
    expect(diagnostics).toEqual([]);
    expect(files.filter((f) => f.label.startsWith(`../${IN_REPO}/`)).map(({ role, session, label }) => ({ role, session, label }))).toEqual([
      { role: "main", session: IN_REPO_SESSION, label: `../${IN_REPO}/${IN_REPO_SESSION}.jsonl` },
    ]);
  });

  test("read like `<folder>-NNN`: a sub-agent below its session is role subagent with its meta file's toolUseId", () => {
    const transcripts = transcriptCopy();
    const subagents = join(dirname(transcripts), IN_REPO, IN_REPO_SESSION, "subagents");
    put(join(subagents, "agent-b1c2d3.jsonl"), `${usageLine("2026-03-09T08:00:09.000Z", "req_in_repo_sub", 3)}\n`);
    put(join(subagents, "agent-b1c2d3.meta.json"), JSON.stringify({ toolUseId: "toolu_01InRepoT1" }));
    const files = discoverTranscripts(transcripts).files.filter((f) => f.label.startsWith(`../${IN_REPO}/`));
    expect(files.map(({ role, session, label, toolUseId }) => ({ role, session, label, toolUseId: toolUseId ?? null }))).toEqual([
      { role: "subagent", session: IN_REPO_SESSION, label: `../${IN_REPO}/${IN_REPO_SESSION}/subagents/agent-b1c2d3.jsonl`, toolUseId: "toolu_01InRepoT1" },
      { role: "main", session: IN_REPO_SESSION, label: `../${IN_REPO}/${IN_REPO_SESSION}.jsonl`, toolUseId: null },
    ]);
  });

  test("both patterns stay: the older sibling `<folder>-NNN` is still read, every folder in byte order", () => {
    expect(seen(transcriptCopy())).toEqual([
      { role: "subagent", label: "5e1f0c2a-7b3d-4e8f-9a10-2b3c4d5e6f70/subagents/agent-a5d4c3b2a1f0e9d87.jsonl" },
      { role: "main", label: "5e1f0c2a-7b3d-4e8f-9a10-2b3c4d5e6f70.jsonl" },
      { role: "worktree", label: "../harbor--claude-worktrees-agent-a0f1e2d3c4b5a6978/9c8b7a65-4321-4fed-8cba-0987654321ab.jsonl" },
      { role: "main", label: `../${IN_REPO}/${IN_REPO_SESSION}.jsonl` },
      { role: "subagent", label: "../harbor-012/3a7c9e21-6b4d-4f80-8e12-5d6c7b8a9f01/subagents/agent-a7e6d5c4b3a2f1e09.jsonl" },
      { role: "main", label: "../harbor-012/3a7c9e21-6b4d-4f80-8e12-5d6c7b8a9f01.jsonl" },
    ]);
  });

  /**
   * Sibling folders that resemble a spec worktree's and are none: a nested agent worktree, a bad number, a bad slug.
   * None differs from `IN_REPO` by letter case alone, which a case-insensitive file system would fold into it.
   */
  const LOOK_ALIKES = [
    `${IN_REPO}--claude-worktrees-agent-x`,
    "harbor-012--claude-worktrees-agent-x",
    "harbor--worktrees-12-harbor",
    "harbor--worktrees-0123-harbor",
    "harbor--worktrees-abc-harbor",
    "harbor--worktrees-012",
    "harbor--worktrees-012-",
    "harbor--worktrees-012-harbor-",
    "harbor--worktrees-012--harbor",
    "harborx--worktrees-012-harbor",
  ] as const;

  test("no look-alike is taken for a spec worktree, and an agent worktree `<folder>--claude-worktrees-agent-x` stays one", () => {
    const transcripts = transcriptCopy();
    const before = seen(transcripts);
    const projects = dirname(transcripts);
    const session = fs.readFileSync(join(projects, IN_REPO, `${IN_REPO_SESSION}.jsonl`));
    for (const name of [...LOOK_ALIKES, "harbor--claude-worktrees-agent-x"]) put(join(projects, name, "s.jsonl"), session);
    const known = new Set(before.map((file) => file.label));
    expect(seen(transcripts).filter((file) => !known.has(file.label))).toEqual([{ role: "worktree", label: "../harbor--claude-worktrees-agent-x/s.jsonl" }]);
  });

  test("no double count: copies of the in-repo session in every look-alike leave the measured file equal to the golden", async () => {
    const root = harborRoot();
    const transcripts = transcriptCopy();
    const projects = dirname(transcripts);
    const session = fs.readFileSync(join(projects, IN_REPO, `${IN_REPO_SESSION}.jsonl`));
    for (const name of LOOK_ALIKES) put(join(projects, name, `${IN_REPO_SESSION}.jsonl`), session);
    expect(await measure(root, transcripts, true)).toBe(0);
    expect(tokensText(root)).toBe(fs.readFileSync(GOLDEN, "utf8"));
  });

  test("the fixture with the in-repo spec worktree measures to exactly the golden, its invocation included", async () => {
    const root = harborRoot();
    expect(await measure(root, transcriptCopy(), true)).toBe(0);
    const text = tokensText(root);
    expect(text).toBe(fs.readFileSync(GOLDEN, "utf8"));
    const invocation = text.split("\n").find((line) => line.includes(`"id":"a:claude:${IN_REPO_SESSION}#1"`));
    expect(JSON.parse(invocation ?? "{}")).toMatchObject({ kind: "invocation", command: "/spec-plan", spec: "003-config-loader", requests: 2 });
  });

  test("mixed case slug: `<folder>--worktrees-042-Mixed-Case` is read exactly like its lower-case form", () => {
    /** One transcript copy with the in-repo session also in `slugFolder`; separate copies, as a case-insensitive file system folds the two names. */
    const withSlug = (slugFolder: string): Array<{ role: string; label: string }> => {
      const transcripts = transcriptCopy();
      const projects = dirname(transcripts);
      const session = fs.readFileSync(join(projects, IN_REPO, `${IN_REPO_SESSION}.jsonl`));
      put(join(projects, slugFolder, "s.jsonl"), session);
      put(join(projects, slugFolder, "s", "subagents", "agent-c1d2e3.jsonl"), `${usageLine("2026-03-09T08:00:09.000Z", "req_mixed_sub", 3)}\n`);
      const { files, diagnostics } = discoverTranscripts(transcripts);
      expect(diagnostics).toEqual([]);
      return files.filter((f) => f.label.startsWith(`../${slugFolder}/`)).map(({ role, label }) => ({ role, label }));
    };
    const lower = withSlug("harbor--worktrees-042-mixed-case");
    expect(lower).toEqual([
      { role: "subagent", label: "../harbor--worktrees-042-mixed-case/s/subagents/agent-c1d2e3.jsonl" },
      { role: "main", label: "../harbor--worktrees-042-mixed-case/s.jsonl" },
    ]);
    const mixed = withSlug("harbor--worktrees-042-Mixed-Case");
    expect(mixed).toEqual(lower.map(({ role, label }) => ({ role, label: label.replace("mixed-case", "Mixed-Case") })));
  });

  test("mixed case slug: a nested agent worktree below a mixed-case spec worktree is still not one", () => {
    const transcripts = transcriptCopy();
    const before = new Set(seen(transcripts).map((file) => file.label));
    const projects = dirname(transcripts);
    const session = fs.readFileSync(join(projects, IN_REPO, `${IN_REPO_SESSION}.jsonl`));
    for (const name of ["harbor--worktrees-042-Mixed-Case--claude-worktrees-agent-x", "harbor--worktrees-042-Mixed--Case"]) put(join(projects, name, "s.jsonl"), session);
    expect(seen(transcripts).filter((file) => !before.has(file.label))).toEqual([]);
  });
});

/** Every bait value planted in the transcript fixture; none may reach the written file. */
const BAITS = [
  "/srv/bait-harbor-checkout",
  "/srv/bait-harbor-checkout/.claude/worktrees/agent-a0f1e2d3c4b5a6978",
  "quill.ferret@bait.example.invalid",
  "Ottoline Quastbridge",
  "zephyr-quokka",
  "marmalade-orbit",
  "feature/bait-quokka-branch",
  "claude-fixture-model-1",
] as const;

/** Fragments of the baits, so a bait that is cut or re-cased still shows up. */
const BAIT_FRAGMENTS = [
  "/srv",
  "bait-harbor",
  "checkout",
  "worktrees",
  "a0f1e2d3c4b5a6978",
  "quill",
  "ferret",
  "bait.example",
  "ottoline",
  "quastbridge",
  "zephyr",
  "quokka",
  "marmalade",
  "orbit",
  "tide clock",
  "fixture-model",
];

/** Every transcript of the fixture as one text: the baits must really be in the input, or the probe is vacuous. */
const fixtureText = (): string =>
  filesBelow(TRANSCRIPTS)
    .map((file) => fs.readFileSync(join(TRANSCRIPTS, file), "utf8"))
    .join("\n");

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const COMMAND = /^\/spec(-[a-z]+)*$/;
const SLUG = /^\d{3}-[a-z0-9]+(-[a-z0-9]+)*$/;
const ACTOR = /^a:claude:[A-Za-z0-9-]+#\d+$/;
const VERSION = /^\d+\.\d+\.\d+$/;

/** The one whitelist every string of the file must pass: a kind, a timestamp, a command, a slug, a stage, an id, a version. */
function allowedString(value: string): boolean {
  return (
    (TOKEN_ROW_KINDS as readonly string[]).includes(value) ||
    ISO.test(value) ||
    COMMAND.test(value) ||
    SLUG.test(value) ||
    EVENT_STAGES.includes(value) ||
    ACTOR.test(value) ||
    VERSION.test(value)
  );
}

/** Every structural finding of one file text: wrong keys, a disallowed value, a slash, an `@`, whitespace. Empty is clean. */
function shapeFindings(text: string): string[] {
  const findings: string[] = [];
  const value = (where: string, v: unknown): void => {
    if (v === null || typeof v === "number") return;
    if (typeof v === "string") {
      if (!allowedString(v)) findings.push(`${where}: string ${JSON.stringify(v)} has no allowed shape`);
      return;
    }
    if (Array.isArray(v)) {
      v.forEach((item: unknown, i) => {
        value(`${where}[${i}]`, item);
      });
      return;
    }
    findings.push(`${where}: unexpected ${typeof v}`);
  };
  const keys = (where: string, record: Record<string, unknown>, expected: readonly string[]): void => {
    if (JSON.stringify(Object.keys(record)) !== JSON.stringify(expected)) findings.push(`${where}: keys ${Object.keys(record).join(",")}`);
  };
  const command = (where: string, name: string, entry: Record<string, unknown>): void => {
    if (!COMMAND.test(name)) findings.push(`${where}: command key ${JSON.stringify(name)}`);
    keys(`${where} ${name}`, entry, BASELINE_COMMAND_KEYS);
    for (const [k, n] of Object.entries(entry)) {
      if (k !== "mean") {
        if (typeof n !== "number") findings.push(`${where}: ${name}.${k} ${JSON.stringify(n)}`);
        continue;
      }
      const mean = n as Record<string, unknown>;
      keys(`${where} ${name} mean`, mean, TOKEN_COUNTERS);
      for (const m of Object.values(mean)) if (typeof m !== "number") findings.push(`${where}: mean ${JSON.stringify(m)}`);
    }
  };
  const lines = text.split("\n");
  if (lines.at(-1) !== "") findings.push("the file does not end in a newline");
  lines.slice(0, -1).forEach((line, i) => {
    const where = `line ${i + 1}`;
    if (/\s/.test(line)) findings.push(`${where}: whitespace`);
    if (line.includes("@")) findings.push(`${where}: @`);
    if (line.replace(/"\/spec/g, '"').includes("/")) findings.push(`${where}: a slash outside a command name`);
    const row = JSON.parse(line) as Record<string, unknown>;
    const kind = row.kind;
    if (typeof kind !== "string" || !(TOKEN_ROW_KINDS as readonly string[]).includes(kind)) {
      findings.push(`${where}: kind ${JSON.stringify(kind)}`);
      return;
    }
    keys(where, row, TOKEN_ROW_KEYS[kind as TokenRowKind]);
    for (const [key, v] of Object.entries(row)) {
      if (kind === "baseline" && key === "commands") {
        for (const [name, entry] of Object.entries(v as Record<string, Record<string, unknown>>)) command(where, name, entry);
      } else value(`${where} ${key}`, v);
    }
  });
  return findings;
}

/** Every bait or bait fragment found in `text`, case-insensitively; empty is clean. */
const baitsIn = (text: string, baits: readonly string[]): string[] => baits.filter((bait) => text.toLowerCase().includes(bait.toLowerCase()));

/** A small seeded generator (mulberry32), so a failing generated case can be replayed from its seed. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A bait word that cannot occur by chance in the file: `zq` (no hex digit, kind, stage or command) plus ten letters. */
function baitWord(random: () => number): string {
  let word = "zq";
  for (let i = 0; i < 10; i += 1) word += String.fromCharCode(0x61 + Math.floor(random() * 26));
  return word;
}

/** A prompt with baits: the `/spec-idea` argument replaced, other command lines kept, free text extended. */
function baitPrompt(content: string, bait: () => string): string {
  if (content.includes("<command-name>/spec-idea</command-name>")) {
    return content.replace(/<command-args>[\s\S]*?<\/command-args>/, `<command-args>${bait()} told ${bait()}@bait.example.invalid</command-args>`);
  }
  if (content.includes("<command-name>")) return content;
  return `${content} ${bait()} ${bait()}@bait.example.invalid`;
}

/**
 * Rewrites one transcript line with fresh baits in every free-text field: `cwd`, `gitBranch`, user prompt text, the
 * `/spec-idea` argument, assistant text, tool inputs and tool results. A line that is not JSON stays as it is.
 */
function injectBaits(line: string, next: () => string, planted: string[]): string {
  let record: Record<string, unknown>;
  try {
    record = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return line;
  }
  const bait = (): string => {
    const word = next();
    planted.push(word);
    return word;
  };
  if (typeof record.cwd === "string") record.cwd = `/srv/${bait()}/checkout`;
  if (typeof record.gitBranch === "string") record.gitBranch = `feature/${bait()}`;
  const message = record.message as { content?: unknown } | undefined;
  if (message !== undefined && typeof message.content === "string") message.content = baitPrompt(message.content, bait);
  else if (message !== undefined && Array.isArray(message.content)) {
    for (const block of message.content as Array<Record<string, unknown>>) {
      if (typeof block.text === "string") block.text = `${block.text} ${bait()}`;
      if (typeof block.input === "object" && block.input !== null) (block.input as Record<string, unknown>).note = `${bait()} /srv/${bait()}`;
      if (typeof block.content === "string") block.content = `${block.content} ${bait()}`;
    }
  }
  return JSON.stringify(record);
}

describe("leak", () => {
  test("the baits are really in the fixture, so the probes below are not vacuous", () => {
    const text = fixtureText();
    for (const bait of BAITS) expect({ bait, present: text.includes(bait) }).toEqual({ bait, present: true });
    expect(text).toContain("<command-name>/spec-idea</command-name>");
  });

  test("no bait and no bait fragment reaches specs/tokens.jsonl or the printed plan", async () => {
    const root = harborRoot();
    expect(await measure(root, transcriptCopy(), true)).toBe(0);
    const text = tokensText(root);
    expect(kindsOf(text)).toContain("invocation");
    expect(baitsIn(text, [...BAITS, ...BAIT_FRAGMENTS])).toEqual([]);
    expect(await measure(root, transcriptCopy(), false)).toBe(0);
    expect(baitsIn(out.join("\n"), BAITS)).toEqual([]);
  });

  test("every line carries exactly the keys of its row kind and only whitelisted values", async () => {
    const root = harborRoot();
    expect(await measure(root, transcriptCopy(), true)).toBe(0);
    const text = tokensText(root);
    expect(new Set(kindsOf(text))).toEqual(new Set(TOKEN_ROW_KINDS));
    expect(shapeFindings(text)).toEqual([]);
  });

  test("the whitelist itself refuses a path, an e-mail, a name, prose and a foreign key", () => {
    const line = (last: string): string => `{"v":1,"kind":"unassigned","requests":0,"input":0,"output":0,"cache_read":0,"cache_write":${last}}\n`;
    expect(shapeFindings(line("0"))).toEqual([]);
    for (const leak of ['"/srv/x"', '"a@b.invalid"', '"Ottoline Quastbridge"', '"zephyr-quokka"']) expect(shapeFindings(line(leak))).not.toEqual([]);
    expect(shapeFindings(`{"v":1,"kind":"unassigned","cwd":"x","requests":0,"input":0,"output":0,"cache_read":0,"cache_write":0}\n`)).not.toEqual([]);
  });

  test("generated: random baits in prompts, answers, tool inputs, cwd and gitBranch never leak", async () => {
    for (const seed of [1, 7, 42, 1009, 65537]) {
      const random = seeded(seed);
      const planted: string[] = [];
      const transcripts = transcriptCopy();
      const projects = dirname(transcripts);
      for (const file of filesBelow(projects).filter((name) => name.endsWith(".jsonl"))) {
        const path = join(projects, file);
        const lines = fs.readFileSync(path, "utf8").split("\n");
        fs.writeFileSync(path, lines.map((line) => (line === "" ? line : injectBaits(line, () => baitWord(random), planted))).join("\n"));
      }
      const input = filesBelow(projects)
        .map((file) => fs.readFileSync(join(projects, file), "utf8"))
        .join("\n");
      expect(planted.length).toBeGreaterThan(50);
      expect(baitsIn(input, planted)).toEqual(planted);

      const root = harborRoot();
      expect(await measure(root, transcripts, true)).toBe(0);
      const text = tokensText(root);
      expect(kindsOf(text).filter((kind) => kind === "invocation")).toHaveLength(8);
      expect({ seed, leaked: baitsIn(text, [...planted, "zq", "bait.example"]) }).toEqual({ seed, leaked: [] });
      expect({ seed, findings: shapeFindings(text) }).toEqual({ seed, findings: [] });
    }
  });
});

describe("offline", () => {
  /** Every network entry point of the process and the app's data-directory and database seams, each a failing recorder. */
  function stubNetwork(): string[] {
    const calls: string[] = [];
    const fail =
      (name: string) =>
      (): never => {
        calls.push(name);
        throw new Error(`a forbidden call in spectant tokens: ${name}`);
      };
    const targets: Array<[object, string, string]> = [
      [globalThis, "fetch", "fetch"],
      [Bun, "connect", "Bun.connect"],
      [Bun, "listen", "Bun.listen"],
      [Bun, "serve", "Bun.serve"],
      [Bun, "udpSocket", "Bun.udpSocket"],
      [net, "connect", "net.connect"],
      [net, "createConnection", "net.createConnection"],
      [net, "createServer", "net.createServer"],
      [tls, "connect", "tls.connect"],
      [http, "request", "http.request"],
      [http, "get", "http.get"],
      [https, "request", "https.request"],
      [https, "get", "https.get"],
      [dns, "lookup", "dns.lookup"],
      [dns, "resolve", "dns.resolve"],
      [paths, "dataDir", "paths.dataDir"],
      [paths, "dbPath", "paths.dbPath"],
      [paths, "ensureDataDir", "paths.ensureDataDir"],
      [sqlite, "Database", "sqlite.Database"],
    ];
    for (const [owner, key, name] of targets) {
      const spy = spyOn(owner as Record<string, () => unknown>, key).mockImplementation(fail(name));
      restore.push(() => spy.mockRestore());
    }
    return calls;
  }

  /** Points the process's own data-directory variables at `xdg` and `home` for one test; restored afterwards. */
  function isolateEnv(xdg: string, home: string): void {
    const saved = { XDG_DATA_HOME: process.env.XDG_DATA_HOME, HOME: process.env.HOME };
    process.env.XDG_DATA_HOME = xdg;
    process.env.HOME = home;
    restore.push(() => {
      if (saved.XDG_DATA_HOME === undefined) delete process.env.XDG_DATA_HOME;
      else process.env.XDG_DATA_HOME = saved.XDG_DATA_HOME;
      if (saved.HOME === undefined) delete process.env.HOME;
      else process.env.HOME = saved.HOME;
    });
  }

  test("the stubs are live: a call to any of them is recorded and fails", () => {
    const calls = stubNetwork();
    expect(() => fetch("http://127.0.0.1:9/")).toThrow();
    expect(() => net.connect(9, "127.0.0.1")).toThrow();
    expect(() => paths.dataDir()).toThrow();
    expect(() => new sqlite.Database(":memory:")).toThrow();
    expect(calls).toEqual(["fetch", "net.connect", "paths.dataDir", "sqlite.Database"]);
  });

  test("with and without --yes: zero network calls, the data directory stays empty, no database appears", async () => {
    const xdg = temp("spectant-tokens-cli-xdg-");
    const home = temp("spectant-tokens-cli-home-");
    isolateEnv(xdg, home);
    const root = harborRoot();
    const transcripts = transcriptCopy();
    const env = { XDG_DATA_HOME: xdg, HOME: home };
    const calls = stubNetwork();

    expect(await tokensCommand(root, { transcripts, yes: false, env, home })).toBe(0);
    expect(fs.existsSync(join(root, TOKENS_PATH))).toBe(false);
    expect(await tokensCommand(root, { transcripts, yes: true, env, home })).toBe(0);
    expect(fs.existsSync(join(root, TOKENS_PATH))).toBe(true);

    expect(calls).toEqual([]);
    expect(fs.readdirSync(xdg)).toEqual([]);
    expect(fs.readdirSync(home)).toEqual([]);
  });

  test("the default transcript folder below the home: zero network calls, no data directory, no database", async () => {
    const xdg = temp("spectant-tokens-cli-xdg-");
    const home = temp("spectant-tokens-cli-home-");
    isolateEnv(xdg, home);
    const root = harborRoot();
    fs.cpSync(join(TRANSCRIPTS, "harbor"), join(home, ".claude", "projects", encodeProjectPath(root)), { recursive: true });
    const before = filesBelow(home);
    const calls = stubNetwork();

    for (const yes of [false, true]) expect(await tokensCommand(root, { transcripts: null, yes, env: { XDG_DATA_HOME: xdg, HOME: home }, home })).toBe(0);
    expect(kindsOf(tokensText(root))).toContain("invocation");

    expect(calls).toEqual([]);
    expect(fs.readdirSync(xdg)).toEqual([]);
    expect(filesBelow(home)).toEqual(before);
    expect(fs.existsSync(join(home, ".spectant"))).toBe(false);
  });
});

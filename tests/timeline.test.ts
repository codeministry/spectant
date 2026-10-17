// The timeline route and its stage entries (T50, ISC-36): `GET /api/workspaces/:ws/specs/:id/timeline` through the
// real spec routes, over temp copies of harbor so a test may write the spec's events.jsonl without touching a fixture.
//
// The contract under test (core/src/timeline.ts, derived-stages.ts, events.ts): without events.jsonl every stage
// transition the files imply is one `kind: 'stage'` entry with `derived: true` and `actor: null`, placed among the
// decisions, rounds and gates at the instant its source dates it; with events.jsonl its valid lines are the stage
// entries (`derived: false`, their `actor` and `command`) and nothing is derived. An invalid line is dropped from the
// timeline, which carries no diagnostics; parseEvents reports it. A file whose lines are all invalid derives as if absent.
//
// Harbor 002 carries a recorded events.jsonl since spec 008 (T27). Every test here starts from 002's derived state,
// so `workspace()` removes that file from the copy; a test that wants recorded transitions writes its own.
//
// The temp workspaces are no git repository of their own, so the route answers no commits and the plain body-hash ETag.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseActor } from "../core/src/actor.ts";
import { EVENT_STAGES, parseEvents } from "../core/src/events.ts";
import type { TimelineEntry } from "../core/src/files.ts";
import { buildTimeline } from "../core/src/timeline.ts";
import type { ApiHandler } from "../server/src/http.ts";
import { LIFEOS_ABSENT } from "../server/src/lifeos.ts";
import { type Registry, openRegistry } from "../server/src/registry.ts";
import { specRoutes } from "../server/src/spec-routes.contract.ts";
import { specRoutesApi } from "../server/src/spec-routes.ts";
import { readSpecFiles, readWorkspaceInput, readWorktreeView } from "../server/src/workspace-loader.ts";
import { DATES, IDENTITY, type PlantedWorktreeRepo, SPEC_ID, SPEC_WORKTREE, UNCOMMITTED, type WorktreeRepoOptions, plantWorktreeRepo } from "./fixtures/worktree-repo.ts";

const FIXTURES = join(import.meta.dir, "..", "core", "fixtures");
const HARBOR = join(FIXTURES, "harbor");
const KEY = "specs/002-web-console";
const HOST = { Host: "127.0.0.1:7717" };

/** Three valid transitions in the stage table's vocabulary and one line naming no stage (line 3). */
const EVENTS = [
  { ts: "2026-03-03T10:00:00Z", from: null, to: "plan", command: "/spec-feature web-console", actor: "principal" },
  { ts: "2026-03-04T09:00:00Z", from: "plan", to: "tasks", command: "/spec-plan 002", actor: "principal" },
  { ts: "2026-03-05T09:00:00Z", from: "tasks", to: "shipping", command: "/spec-tasks 002", actor: "agent" },
  { ts: "2026-03-05T09:30:00Z", from: "tasks", to: "review", command: "/spec-tasks 002", actor: "agent" },
] as const;
const VALID = [EVENTS[0], EVENTS[1], EVENTS[3]];

let root: string;
const registries: Registry[] = [];

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "spectant-timeline-"));
});

afterAll(() => {
  for (const registry of registries.splice(0)) registry.close();
  rmSync(root, { recursive: true, force: true });
});

/**
 * A fresh copy of harbor at `root/<slug>` without 002's events.jsonl (see the header), registered alone; the handler
 * answers the spec routes for it.
 */
function workspace(slug: string): { dir: string; handler: ApiHandler } {
  const dir = join(root, slug);
  cpSync(HARBOR, dir, { recursive: true });
  rmSync(join(dir, KEY, "events.jsonl"));
  const registry = openRegistry(mkdtempSync(join(root, "data-")));
  registries.push(registry);
  registry.add(dir);
  return { dir, handler: specRoutesApi({ registry, lifeos: LIFEOS_ABSENT }) };
}

async function timeline(handler: ApiHandler, ws: string, id: string, headers: Record<string, string> = {}): Promise<Response> {
  const path = specRoutes.timeline(ws, id);
  const url = new URL(`http://127.0.0.1:7717${path}`);
  const res = await handler(new Request(url.href, { headers: { ...HOST, ...headers } }), url);
  if (res === null) throw new Error(`the spec routes declined ${path}`);
  return res;
}

async function body(res: Response): Promise<{ text: string; entries: TimelineEntry[] }> {
  expect(res.status).toBe(200);
  const text = await res.text();
  return { text, entries: JSON.parse(text) as TimelineEntry[] };
}

const stagesOf = (entries: readonly TimelineEntry[]): TimelineEntry[] => entries.filter((e) => e.kind === "stage");
const label = (e: TimelineEntry): string => `${e.kind}:${e.ref ?? ""}`;
const bodyHash = (text: string): string => `"${new Bun.CryptoHasher("sha256").update(text).digest("base64url")}"`;

/** Every entry with a parseable `ts` is at or before the dated entry above it: the list is newest first. */
function expectNewestFirst(entries: readonly TimelineEntry[]): void {
  const dated = entries.map((e) => Date.parse(e.ts)).filter((t) => Number.isFinite(t));
  expect(dated).toEqual([...dated].sort((a, b) => b - a));
}

describe("timeline route (T50, ISC-36)", () => {
  test("without events.jsonl: harbor 002's stage transitions are derived, in date order among decisions, rounds and gates", async () => {
    const { dir, handler } = workspace("dock");
    const { entries: all } = await body(await timeline(handler, "dock", "002"));
    // Spec 024: the route joins the held locks as running `agent` entries (and the app's notes as `note`) onto core's file
    // timeline; harbor's live fixture holds ISC-74 for sess-2, the store has no note for 002.
    expect(all.filter((e) => e.kind === "agent").map((e) => ({ ref: e.ref, running: e.running }))).toEqual([{ ref: "ISC-74", running: true }]);
    const entries = all.filter((e) => e.kind !== "note" && e.kind !== "agent");
    // The route answers exactly what core builds from the files without events.jsonl.
    const built = buildTimeline({ files: readSpecFiles({ dir: join(dir, KEY), slug: "002-web-console" }), commits: [] });
    expect(entries).toEqual(JSON.parse(JSON.stringify(built)) as TimelineEntry[]);
    // The golden holds 002's recorded stages; every other entry is the golden's, in the golden's order.
    const golden = JSON.parse(readFileSync(join(FIXTURES, "harbor.timeline.golden.json"), "utf8")) as Record<string, TimelineEntry[]>;
    expect(entries.filter((e) => e.kind !== "stage")).toEqual((golden[KEY] ?? []).filter((e) => e.kind !== "stage"));

    // Every stage entry is derived and nobody's; every other entry is recorded.
    const stages = stagesOf(entries);
    expect(stages.length).toBeGreaterThan(0);
    for (const e of stages) expect({ id: e.id, derived: e.derived, actor: e.actor, command: e.command }).toEqual({ id: e.id, derived: true, actor: null, command: undefined });
    for (const e of entries.filter((x) => x.kind !== "stage")) expect({ id: e.id, derived: e.derived }).toEqual({ id: e.id, derived: false });

    // One chain from the creation, oldest last in the list: created → plan → tasks → review → build.
    expect(stages.map((e) => [e.from, e.to]).reverse()).toEqual([
      [null, "plan"],
      ["plan", "tasks"],
      ["tasks", "review"],
      ["review", "build"],
    ]);
    expectNewestFirst(entries);
    // The transition the review mark caused sits at the mark's instant, directly above it.
    const build = entries.findIndex((e) => e.id === "stage-build");
    expect(entries[build + 1]?.id).toBe("gate-reviewed");
    expect(entries[build]?.ts).toBe(entries[build + 1]?.ts ?? "");
    // The undated transitions carry `ts: ''` and `undated: true`; the dated ones do not.
    expect(stages.filter((e) => e.undated).map((e) => e.ts)).toEqual(["", ""]);
  });

  test("without events.jsonl: a spec with spec.md alone shows exactly one derived stage entry, between its decisions", async () => {
    const { dir, handler } = workspace("berth");
    const spec = join(dir, "specs", "010-bare-spec");
    mkdirSync(spec);
    writeFileSync(join(spec, "spec.md"), "---\nslug: 010-bare-spec\nspec_type: feature\ncreated: 2026-03-10T09:00:00Z\n---\n# 010 — Bare spec\n");
    writeFileSync(
      join(spec, "context.md"),
      "# Context\n\n## Goal — confirmed 2026-03-10T09:00:00Z\n\nA bare spec.\n\n## Round 1 — shaping, 2026-03-11T10:00:00Z\n\n### Q1 · Which store?\n\n- From: principal\n\nThe file.\n",
    );

    const { entries } = await body(await timeline(handler, "berth", "010"));
    const stages = stagesOf(entries);
    expect(stages).toHaveLength(1);
    expect(stages[0]).toMatchObject({ kind: "stage", derived: true, actor: null, from: null, to: "plan", ts: "2026-03-10T09:00:00Z" });
    expect(EVENT_STAGES).toContain(stages[0]?.to ?? "");
    // Newest first; at one instant the transition sorts above the decision beside it.
    expect(entries.map(label)).toEqual(["decision:R1.Q1", "stage:plan", "decision:goal"]);
    expectNewestFirst(entries);
  });

  test("with events.jsonl: the recorded transitions in order with their source, nothing derived, the invalid line dropped", async () => {
    const { dir, handler } = workspace("quay");
    const folder = join(dir, "specs", "002-web-console");
    const derived = (await body(await timeline(handler, "quay", "002"))).entries.filter((e) => e.kind !== "note" && e.kind !== "agent");
    const text = `${EVENTS.map((e) => JSON.stringify(e)).join("\n")}\n`;
    writeFileSync(join(folder, "events.jsonl"), text);

    // The core contract for the file: three events in file order, line 3 one diagnostic naming the unknown stage, and
    // one actor-legacy warning for the file at its first legacy actor (spec 008, T61).
    const parsed = parseEvents(text);
    expect(parsed.events).toEqual(VALID.map((e) => ({ ...e, actorRef: parseActor(e.actor) })));
    expect(parsed.diagnostics.map((d) => ({ severity: d.severity, code: d.code, line: d.line }))).toEqual([
      { severity: "error", code: "event-stage", line: 3 },
      { severity: "warning", code: "actor-legacy", line: 1 },
    ]);

    // Spec 024: the server's joins (`agent` for held locks, `note`) sit beside core's file timeline; compared without them.
    const entries = (await body(await timeline(handler, "quay", "002"))).entries.filter((e) => e.kind !== "note" && e.kind !== "agent");
    const stages = stagesOf(entries);
    expect(entries.some((e) => e.derived)).toBe(false);
    // Oldest last in the list; each carries the event's source: its actor, its command, its instant.
    expect(stages.map((e) => ({ ts: e.ts, from: e.from, to: e.to, command: e.command, actor: e.actor })).reverse()).toEqual(VALID.map((e) => ({ ...e })));
    for (const e of stages) expect(e.body).toBe(`- Command: ${e.command ?? ""}`);
    expect(stages.map((e) => e.title).reverse()).toEqual(["created → plan", "plan → tasks", "tasks → review"]);
    // The timeline carries no diagnostics: the invalid line is absent, not an entry.
    expect(entries.some((e) => e.to === ("shipping" as string) || e.ts === EVENTS[2].ts)).toBe(false);
    expectNewestFirst(entries);
    // Only the stage entries changed; every recorded entry of the derived state is still there, in the same order.
    expect(entries.filter((e) => e.kind !== "stage")).toEqual(derived.filter((e) => e.kind !== "stage"));
    // The route answers exactly what core builds from the files it read (no repository of its own: no commits).
    const built = buildTimeline({ files: readSpecFiles({ dir: folder, slug: "002-web-console" }), commits: [] });
    expect(entries).toEqual(JSON.parse(JSON.stringify(built)) as TimelineEntry[]);
  });

  test("an events.jsonl whose every line is invalid derives as if it were absent", async () => {
    const { dir, handler } = workspace("slip");
    const before = await body(await timeline(handler, "slip", "002"));
    writeFileSync(join(dir, "specs", "002-web-console", "events.jsonl"), `${JSON.stringify(EVENTS[2])}\nnot json\n`);
    const after = await body(await timeline(handler, "slip", "002"));
    expect(after.text).toBe(before.text);
    expect(stagesOf(after.entries).every((e) => e.derived)).toBe(true);
  });

  test("the ETag differs between the derived and the recorded state, and a matching conditional GET answers 304", async () => {
    const { dir, handler } = workspace("pier");
    const first = await timeline(handler, "pier", "002");
    const derived = await body(first);
    const derivedTag = first.headers.get("etag") ?? "";
    // No repository of its own: no HEAD to fold in, the plain body hash of every other route.
    expect(derivedTag).toBe(bodyHash(derived.text));
    expect((await timeline(handler, "pier", "002", { "If-None-Match": derivedTag })).status).toBe(304);

    writeFileSync(join(dir, "specs", "002-web-console", "events.jsonl"), `${EVENTS.map((e) => JSON.stringify(e)).join("\n")}\n`);
    const second = await timeline(handler, "pier", "002");
    const recorded = await body(second);
    const recordedTag = second.headers.get("etag") ?? "";
    expect(recordedTag).toBe(bodyHash(recorded.text));
    expect(recordedTag).not.toBe(derivedTag);

    // The old tag no longer matches: the recorded body comes back in full; the new one answers 304 with no body.
    const stale = await timeline(handler, "pier", "002", { "If-None-Match": derivedTag });
    expect(stale.status).toBe(200);
    expect(await stale.text()).toBe(recorded.text);
    const fresh = await timeline(handler, "pier", "002", { "If-None-Match": recordedTag });
    expect(fresh.status).toBe(304);
    expect(await fresh.text()).toBe("");
    expect(fresh.headers.get("etag")).toBe(recordedTag);
  });
});

// The worktree entry of the timeline against the dashboard model (spec 041, ISC-214), over the git fixture of spec 027
// (`tests/fixtures/worktree-repo.ts`). The dashboard shows a spec's worktree as a chip while it is live and drops it once
// it has ended (`liveWorktrees`); the timeline names the end as one derived `worktree` entry. The comparable facts: a
// chip and an entry never stand together, an ended worktree without a chip has exactly one entry, and where the shared
// view still lists the ended worktree, the entry's state (`merged`, else `removed`) and path are the view's.

/** The fixture's hermetic git environment with author and committer dated `date`, so a test may date a commit. */
function fixtureGitEnv(repo: PlantedWorktreeRepo, date: string): Record<string, string> {
  return {
    PATH: process.env.PATH ?? "",
    HOME: repo.base,
    LC_ALL: "C",
    GIT_CONFIG_GLOBAL: join(repo.base, "gitconfig"),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
    GIT_MERGE_AUTOEDIT: "no",
    GIT_AUTHOR_NAME: IDENTITY.name,
    GIT_AUTHOR_EMAIL: IDENTITY.email,
    GIT_COMMITTER_NAME: IDENTITY.name,
    GIT_COMMITTER_EMAIL: IDENTITY.email,
    GIT_AUTHOR_DATE: date,
    GIT_COMMITTER_DATE: date,
  };
}

/** Runs git in `cwd` dated `date`; throws on a non-zero exit, so a fixture step never fails silently. */
function gitAt(repo: PlantedWorktreeRepo, date: string, cwd: string, ...args: string[]): string {
  const run = Bun.spawnSync(["git", ...args], { cwd, env: fixtureGitEnv(repo, date), stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  if (run.exitCode !== 0) throw new Error(`git ${args.join(" ")} exited ${run.exitCode}: ${run.stderr.toString()}`);
  return run.stdout.toString().trim();
}

/** The two ends the timeline names. */
type EndState = "merged" | "removed";

/** What the dashboard model and the timeline route say about spec 002's worktree in `repo`. */
async function worktreeReadings(repo: PlantedWorktreeRepo): Promise<{
  chip: string[];
  ended: Array<{ state: EndState; path: string }>;
  entries: TimelineEntry[];
}> {
  const reading = await readWorkspaceInput(repo.root);
  if (!reading.readable) throw new Error("the fixture workspace is unreadable");
  const chip = (reading.input.worktrees?.worktrees ?? []).filter((w) => w.kind === "spec" && w.spec === SPEC_ID).map((w) => w.path);
  const { view } = await readWorktreeView(repo.root);
  const ended = view.ended
    .filter((e) => e.worktree.kind === "spec" && e.worktree.spec === SPEC_ID)
    .map((e) => ({ state: e.reason === "merged" ? ("merged" as const) : ("removed" as const), path: e.worktree.path }));
  const registry = openRegistry(mkdtempSync(join(root, "data-")));
  registries.push(registry);
  registry.add(repo.root);
  const res = await timeline(specRoutesApi({ registry, lifeos: LIFEOS_ABSENT }), "harbor", SPEC_ID);
  const entries = (await body(res)).entries.filter((e) => e.kind === "worktree");
  return { chip, ended, entries };
}

describe("ISC-214 worktree: the timeline's worktree entry is the dashboard model's, and merged is dated topologically", () => {
  const cases: Array<{ name: string; options: WorktreeRepoOptions; prepare?: (repo: PlantedWorktreeRepo) => void; state: EndState | null }> = [
    { name: "open with its worktree", options: {}, state: null },
    { name: "merged, the worktree present and clean", options: { merged: true }, prepare: (repo) => rmSync(join(repo.worktrees.spec, UNCOMMITTED)), state: "merged" },
    // A merged worktree still holding uncommitted work is the spec's (ISC-212.2): chip, no entry.
    { name: "merged, the worktree present with uncommitted work", options: { merged: true }, state: null },
    { name: "merged, the worktree removed", options: { merged: true, removeWorktree: true }, state: "merged" },
    { name: "the worktree removed, the branch open", options: { removeWorktree: true }, state: "removed" },
    { name: "the worktree folder deleted (prunable)", options: {}, prepare: (repo) => rmSync(repo.worktrees.spec, { recursive: true, force: true }), state: "removed" },
  ];
  for (const c of cases) {
    test(`worktree agreement, ${c.name}: chip and entry never together, the entry is the view's ended worktree`, async () => {
      const repo = await plantWorktreeRepo({ ...c.options, parent: root });
      c.prepare?.(repo);
      const { chip, ended, entries } = await worktreeReadings(repo);
      // The dashboard's chip stands exactly while the timeline names no end.
      expect(chip.length > 0).toBe(entries.length === 0);
      expect(entries.map((e) => e.worktree?.state ?? null)).toEqual(c.state === null ? [] : [c.state]);
      if (c.state === null) expect(chip).toEqual([SPEC_WORKTREE]);
      // Where the shared view still lists the ended worktree, the timeline names it with the view's state and path.
      if (ended.length > 0) expect(entries.map((e) => ({ state: e.worktree?.state, path: e.worktree?.path }))).toEqual(ended);
    });
  }

  test("worktree merged through two merge commits in deviating date order → dated by the topologically first", async () => {
    // main's first-parent line: M1 (merges feature/002-web-console, dated DATES.merge) → M2 (merges topic/other, its
    // committer clock a day behind M1's) → M3 (merges topic/side, the newest). topic/other and topic/side both start at
    // M1. All three are merge commits on the line with the branch tip as ancestor; M1 is the oldest in topology and the
    // one that brought the spec in (FORMAT.md § Worktrees). A walk in date order reaches M1 through topic/side before
    // M2 and lists M2 behind M1, so the last hit in date order is M2; the first in `--topo-order --reverse` is M1.
    const repo = await plantWorktreeRepo({ merged: true, parent: root });
    rmSync(join(repo.worktrees.spec, UNCOMMITTED)); // clean, so the merged worktree has ended (ISC-212.2)
    const skewed = "2026-03-03T12:00:00Z";
    const newest = "2026-03-05T11:00:00Z";
    const branchOff = (name: string, file: string): void => {
      gitAt(repo, DATES.later, repo.root, "switch", "-q", "-c", name, "main");
      writeFileSync(join(repo.root, "src", file), `// ${name}: one change after the spec's merge.\nexport const changed = true;\n`);
      gitAt(repo, DATES.later, repo.root, "add", "--", `src/${file}`);
      gitAt(repo, DATES.later, repo.root, "commit", "-q", "-m", `${name}: one change`);
      gitAt(repo, DATES.later, repo.root, "switch", "-q", "main");
    };
    branchOff("topic/other", "other.ts");
    branchOff("topic/side", "side.ts");
    gitAt(repo, skewed, repo.root, "merge", "-q", "--no-ff", "-m", "Merge branch 'topic/other'", "topic/other");
    gitAt(repo, newest, repo.root, "merge", "-q", "--no-ff", "-m", "Merge branch 'topic/side'", "topic/side");
    // The skew is real: M2 is a child of M1 and yet dated before it.
    expect(gitAt(repo, newest, repo.root, "log", "-1", "--format=%cI", "main~1").startsWith("2026-03-03T12:00:00")).toBe(true);
    expect(gitAt(repo, newest, repo.root, "rev-parse", "main~2")).toBe(repo.commits.merge ?? "");

    const { chip, entries } = await worktreeReadings(repo);
    expect(chip).toEqual([]);
    expect(entries).toHaveLength(1);
    const [entry] = entries;
    expect(entry?.worktree?.state).toBe("merged");
    expect(entry?.worktree?.commit).toBe(repo.commits.merge?.slice(0, 7) ?? null);
    expect(Date.parse(entry?.ts ?? "")).toBe(Date.parse(DATES.merge));
  });
});

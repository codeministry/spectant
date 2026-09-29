// The timeline route and its stage entries (T50, ISC-36): `GET /api/workspaces/:ws/specs/:id/timeline` through the
// real spec routes, over temp copies of harbor so a test may write the spec's events.jsonl without touching a fixture.
//
// The contract under test (core/src/timeline.ts, derived-stages.ts, events.ts): without events.jsonl every stage
// transition the files imply is one `kind: 'stage'` entry with `derived: true` and `actor: null`, placed among the
// decisions, rounds and gates at the instant its source dates it; with events.jsonl its valid lines are the stage
// entries (`derived: false`, their `actor` and `command`) and nothing is derived. An invalid line is dropped from the
// timeline, which carries no diagnostics; parseEvents reports it. A file whose lines are all invalid derives as if absent.
//
// The temp workspaces are no git repository of their own, so the route answers no commits and the plain body-hash ETag.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EVENT_STAGES, parseEvents } from "../core/src/events.ts";
import type { TimelineEntry } from "../core/src/files.ts";
import { buildTimeline } from "../core/src/timeline.ts";
import type { ApiHandler } from "../server/src/http.ts";
import { LIFEOS_ABSENT } from "../server/src/lifeos.ts";
import { type Registry, openRegistry } from "../server/src/registry.ts";
import { specRoutes } from "../server/src/spec-routes.contract.ts";
import { specRoutesApi } from "../server/src/spec-routes.ts";
import { readSpecFiles } from "../server/src/workspace-loader.ts";

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

/** A fresh copy of harbor at `root/<slug>`, registered alone; the handler answers the spec routes for it. */
function workspace(slug: string): { dir: string; handler: ApiHandler } {
  const dir = join(root, slug);
  cpSync(HARBOR, dir, { recursive: true });
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
    const { handler } = workspace("dock");
    const { entries } = await body(await timeline(handler, "dock", "002"));
    const golden = JSON.parse(readFileSync(join(FIXTURES, "harbor.timeline.golden.json"), "utf8")) as Record<string, unknown>;
    expect(entries).toEqual(golden[KEY] as TimelineEntry[]);

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
    const spec = join(dir, "specs", "008-bare-spec");
    mkdirSync(spec);
    writeFileSync(join(spec, "spec.md"), "---\nslug: 008-bare-spec\nspec_type: feature\ncreated: 2026-03-10T09:00:00Z\n---\n# 008 — Bare spec\n");
    writeFileSync(
      join(spec, "context.md"),
      "# Context\n\n## Goal — confirmed 2026-03-10T09:00:00Z\n\nA bare spec.\n\n## Round 1 — shaping, 2026-03-11T10:00:00Z\n\n### Q1 · Which store?\n\n- From: principal\n\nThe file.\n",
    );

    const { entries } = await body(await timeline(handler, "berth", "008"));
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
    const derived = (await body(await timeline(handler, "quay", "002"))).entries;
    const text = `${EVENTS.map((e) => JSON.stringify(e)).join("\n")}\n`;
    writeFileSync(join(folder, "events.jsonl"), text);

    // The core contract for the file: three events in file order, line 3 one diagnostic naming the unknown stage.
    const parsed = parseEvents(text);
    expect(parsed.events).toEqual(VALID.map((e) => ({ ...e })));
    expect(parsed.diagnostics.map((d) => ({ severity: d.severity, code: d.code, line: d.line }))).toEqual([{ severity: "error", code: "event-stage", line: 3 }]);

    const { entries } = await body(await timeline(handler, "quay", "002"));
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

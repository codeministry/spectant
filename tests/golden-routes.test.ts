// The GET golden master of spec 059 (T2, ISC-403): every read route of the server, answered by the real CLI on the
// fixture workspaces of `tests/fixtures/golden/harness.ts`, compared byte for byte (status, headers, body) with the
// recording `tests/fixtures/golden/routes.json`, taken on the server code before the slice refactor began.
//
// Covered: the static shell (`/`, one manifest asset, the `/w/…` index fallback, a missing asset, a non-GET 405), the
// unclaimed `/api/*` and `/proto/*` paths, the live stream (`/api/events`: its first `update` frame after one fixed
// file change, its `HEAD` 405 and its 403), settings, actors, LifeOS, the workspace list, dashboard and images, the
// planning, idea, board-query and favourites reads, the library (catalog, document, search, asset), the notes and
// their counts, every spec read route (spec, timeline, claims, tasks, evidence file, frames, live) and an unknown tab,
// the prototype route; each GET also once as HEAD, the 405 (with its `Allow`) of every route family, and the 403 for
// a foreign `Host` and a foreign `Origin`. Write routes are not part of this recording.
//
// The test fails when the recording is missing or any entry differs. To re-record, on purpose and only on code whose
// answers are known to be right:
//
//   GOLDEN_RECORD=1 bun test ./tests/golden-routes.test.ts
//
// A re-recording is a reviewed change of `routes.json`, never a way to make this test pass.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type GoldenEntry,
  type GoldenRequest,
  type GoldenServer,
  callGolden,
  changeFile,
  eventsGolden,
  goldenContext,
  readGolden,
  setGoldenClock,
  setupCall,
  startGolden,
  writeGolden,
} from "./fixtures/golden/harness.ts";

const FILE = join(import.meta.dir, "fixtures", "golden", "routes.json");
const RECORD = process.env.GOLDEN_RECORD === "1";
const ARCH_PNG = readFileSync(join(import.meta.dir, "..", "core", "fixtures", "library", "specs", "tech", "arch.png"));

const W = "/api/workspaces";
const H = `${W}/harbor`;
const L = `${W}/library`;
const FOREIGN_HOST = { Host: "evil.example" };
const FOREIGN_ORIGIN = { Origin: "http://evil.example" };

/** A read: once as GET, once as HEAD. */
const read = (name: string, path: string): GoldenRequest[] => [
  { name, path },
  { name: `${name} HEAD`, method: "HEAD", path },
];
const other = (name: string, method: string, path: string, headers?: Record<string, string>): GoldenRequest => ({ name, method, path, headers });

/** The spec read routes of one spec, each as GET and HEAD. */
const specReads = (ws: string, id: string, evidence: readonly string[]): GoldenRequest[] => {
  const s = `${W}/${ws}/specs/${id}`;
  return [
    ...read(`spec ${ws} ${id}`, s),
    ...read(`timeline ${ws} ${id}`, `${s}/timeline`),
    ...read(`claims ${ws} ${id}`, `${s}/claims`),
    ...read(`tasks ${ws} ${id}`, `${s}/tasks`),
    ...evidence.flatMap((path) => read(`evidenceFile ${ws} ${id} ${path}`, `${s}/evidence/file?path=${encodeURIComponent(path)}`)),
    ...read(`frames ${ws} ${id}`, `${s}/frames`),
    ...read(`live ${ws} ${id}`, `${s}/live`),
  ];
};

const REQUESTS: readonly GoldenRequest[] = [
  // static shell and unclaimed paths
  ...read("static index", "/"),
  ...read("static asset", "/main-GOLDEN01.js"),
  ...read("static fallback", "/w/harbor/specs/002"),
  { name: "static missing asset", path: "/missing-GOLDEN02.js" },
  other("static 405", "POST", "/"),
  { name: "unclaimed api", path: "/api/x" },
  { name: "unclaimed proto", path: "/proto/x" },
  // events (the frame itself is recorded last, after every read)
  other("events 405", "HEAD", "/api/events"),
  other("events 405 POST", "POST", "/api/events"),
  other("events 403 host", "GET", "/api/events", FOREIGN_HOST),
  // settings, actors, lifeos
  ...read("settings", "/api/settings"),
  other("settings 405", "DELETE", "/api/settings"),
  other("settings 403 host", "GET", "/api/settings", FOREIGN_HOST),
  other("settings 403 origin", "GET", "/api/settings", FOREIGN_ORIGIN),
  ...read("actors", "/api/actors"),
  other("actors 405", "POST", "/api/actors"),
  other("actors 403 origin", "GET", "/api/actors", FOREIGN_ORIGIN),
  ...read("lifeos", "/api/lifeos"),
  other("lifeos 405", "POST", "/api/lifeos"),
  other("lifeos 403 host", "GET", "/api/lifeos", FOREIGN_HOST),
  // workspaces, dashboard, images, admin paths
  ...read("workspaces", W),
  other("workspaces 405", "PUT", W),
  other("workspaces 403 host", "GET", W, FOREIGN_HOST),
  other("workspaces 403 origin", "GET", W, FOREIGN_ORIGIN),
  ...read("dashboard harbor", `${H}/dashboard`),
  ...read("dashboard library", `${L}/dashboard`),
  { name: "dashboard unknown", path: `${W}/nowhere/dashboard` },
  other("dashboard 405", "POST", `${H}/dashboard`),
  other("dashboard 403 host", "GET", `${H}/dashboard`, FOREIGN_HOST),
  ...read("image logo", `${H}/images/logo`),
  { name: "image screenshot missing", path: `${H}/images/screenshot` },
  { name: "image unknown kind", path: `${H}/images/banner` },
  other("image 405", "POST", `${H}/images/logo`),
  { name: "workspace item GET", path: H },
  { name: "workspace rescan GET", path: `${H}/rescan` },
  other("workspace item 405", "POST", H),
  other("workspace rescan 405", "PUT", `${H}/rescan`),
  other("workspace item 403 host", "PATCH", H, FOREIGN_HOST),
  // planning, ideas, board query, favourites, the write-only workspace routes
  ...read("planning harbor", `${H}/planning`),
  ...read("planning library", `${L}/planning`),
  other("planning 405", "POST", `${H}/planning`),
  other("planning 403 origin", "GET", `${H}/planning`, FOREIGN_ORIGIN),
  ...read("idea harbor console-audit-log", `${H}/ideas/console-audit-log`),
  ...read("idea harbor registry-webhooks", `${H}/ideas/registry-webhooks`),
  { name: "idea unknown", path: `${H}/ideas/no-such-story` },
  other("idea 405", "POST", `${H}/ideas/console-audit-log`),
  ...read("board-query harbor", `${H}/board-query`),
  ...read("board-query library", `${L}/board-query`),
  other("board-query 405", "POST", `${H}/board-query`),
  ...read("favorites harbor", `${H}/favorites`),
  ...read("favorites library", `${L}/favorites`),
  other("favorites 405", "POST", `${H}/favorites`),
  other("favorite 405", "GET", `${H}/favorites/002-web-console`),
  other("allocate 405", "GET", `${H}/ideas/console-audit-log/allocate`),
  other("backlog 405", "GET", `${H}/backlog`),
  other("runRelease 405", "GET", `${H}/runs/r1/release`),
  // library
  ...read("library harbor", `${H}/library`),
  ...read("library library", `${L}/library`),
  ...read("libraryDoc library tech.md", `${L}/library/doc?path=tech.md`),
  ...read("libraryDoc library plan", `${L}/library/doc?path=${encodeURIComponent("001-lighthouse-map/plan.md")}`),
  ...read("libraryDoc harbor tech.md", `${H}/library/doc?path=tech.md`),
  { name: "libraryDoc missing", path: `${L}/library/doc?path=nothing.md` },
  ...read("librarySearch library", `${L}/library/search?q=lighthouse`),
  ...read("librarySearch harbor", `${H}/library/search?q=console`),
  ...read("libraryAsset library", `${L}/library/asset?path=${encodeURIComponent("tech/arch.png")}`),
  { name: "libraryAsset missing", path: `${L}/library/asset?path=${encodeURIComponent("tech/none.png")}` },
  other("library 405", "POST", `${L}/library`),
  other("libraryDoc 405", "POST", `${L}/library/doc?path=tech.md`),
  other("librarySearch 405", "POST", `${L}/library/search?q=x`),
  other("libraryAsset 405", "POST", `${L}/library/asset?path=tech%2Farch.png`),
  // notes
  ...read("notes harbor", `${H}/notes`),
  ...read("notes harbor spec 002", `${H}/notes?spec=002`),
  ...read("notes library", `${L}/notes`),
  ...read("note-counts harbor 002", `${H}/note-counts?spec=002`),
  { name: "notes unknown", path: `${W}/nowhere/notes` },
  other("notes 405", "DELETE", `${H}/notes`),
  other("note item 405", "GET", `${H}/notes/00000000-0000-4000-8000-000000000000`),
  other("note-counts 405", "POST", `${H}/note-counts?spec=002`),
  other("notes 403 origin", "GET", `${H}/notes`, FOREIGN_ORIGIN),
  // spec reads
  ...specReads("harbor", "002", ["artifacts/T13-routes.md", ".evidence/kpi-band-390.png"]),
  ...specReads("harbor", "006", []),
  ...specReads("harbor", "001", []),
  ...specReads("library", "001", ["artifacts/map-overview.png", "artifacts/data.json"]),
  { name: "spec unknown id", path: `${H}/specs/999` },
  { name: "spec unknown tab", path: `${H}/specs/002/bogus` },
  { name: "evidenceFile escape", path: `${H}/specs/002/evidence/file?path=${encodeURIComponent("../../ISA.md")}` },
  other("spec 405", "POST", `${H}/specs/002`),
  other("tasks 405", "POST", `${H}/specs/002/tasks`),
  other("gateReviewed 405", "GET", `${H}/specs/002/gate/reviewed`),
  other("taskCheck 405", "GET", `${H}/specs/002/tasks/T1/check`),
  other("transition 405", "GET", `${H}/specs/002/transition`),
  other("spec 403 host", "GET", `${H}/specs/002`, FOREIGN_HOST),
  // prototype
  ...read("prototype index", "/proto/library/002-tide-board/prototype%2Fboard/index.html"),
  ...read("prototype css", "/proto/library/002-tide-board/prototype%2Fboard/styles.css"),
  { name: "prototype missing", path: "/proto/library/002-tide-board/prototype%2Fboard/none.html" },
  { name: "prototype unknown ws", path: "/proto/nowhere/002-tide-board/prototype%2Fboard/index.html" },
  other("prototype 405", "POST", "/proto/library/002-tide-board/prototype%2Fboard/index.html"),
  other("prototype 403 host", "GET", "/proto/library/002-tide-board/prototype%2Fboard/index.html", FOREIGN_HOST),
];

/** The database writes the reads then show; their answers are not part of this recording. */
async function setup(server: GoldenServer): Promise<void> {
  const json = { "Content-Type": "application/json" };
  const actors = [{ id: "u:3f9c0a7d", displayName: "Harbor Master", gitIdentities: ["harbor@example.org"] }];
  await setupCall(server, { name: "actors", method: "PUT", path: "/api/actors", headers: json, body: JSON.stringify(actors) });
  await setupCall(server, { name: "board query", method: "PUT", path: `${H}/board-query`, headers: json, body: JSON.stringify({ query: "stage:build" }) });
  await setupCall(server, { name: "favourite", method: "PUT", path: `${H}/favorites/002-web-console` });
  // Each note at its own minute before the frozen now: notes of one timestamp would be ordered by their random ids.
  const note = { anchor: { kind: "spec", spec: "002" }, title: "Golden note", body: "Pinned for the golden master.", pinned: true };
  setGoldenClock(-120_000);
  await setupCall(server, { name: "note", method: "POST", path: `${H}/notes`, headers: json, body: JSON.stringify(note) });
  const claimNote = { anchor: { kind: "claim", spec: "002", id: "ISC-74" }, body: "A claim note." };
  setGoldenClock(-60_000);
  await setupCall(server, { name: "claim note", method: "POST", path: `${H}/notes`, headers: json, body: JSON.stringify(claimNote) });
  setGoldenClock(0);
  await setupCall(server, { name: "logo", method: "PUT", path: `${H}/images/logo`, headers: { "Content-Type": "image/png" }, body: ARCH_PNG });
}

/** Every entry in list order, the events frame last (its change alters the library's spec 004). */
async function recordAll(server: GoldenServer): Promise<GoldenEntry[]> {
  const context = goldenContext();
  const entries: GoldenEntry[] = [];
  for (const req of REQUESTS) entries.push(await callGolden(server, req, context));
  const file = join(server.repos.library, "specs", "004-fog-horn", "spec.md");
  const text = readFileSync(file, "utf8");
  entries.push(await eventsGolden(server, "events update frame", "/api/events", () => changeFile(file, `${text}\nOne line the golden change appends.\n`), context));
  return entries;
}

describe("golden: GET routes (spec 059, ISC-403)", () => {
  let server: GoldenServer;
  beforeAll(async () => {
    server = await startGolden();
    await setup(server);
  });
  afterAll(async () => {
    await server.stop();
  });

  test("every read route answers byte for byte as recorded", async () => {
    const live = await recordAll(server);
    expect(new Set(live.map((e) => e.name)).size).toBe(live.length);
    if (RECORD) writeGolden(FILE, live);
    const recorded = readGolden(FILE);
    expect({ file: "tests/fixtures/golden/routes.json", present: recorded !== null }).toEqual({ file: "tests/fixtures/golden/routes.json", present: true });
    const byName = new Map((recorded ?? []).map((e) => [e.name, e]));
    const differing = live.filter((e) => JSON.stringify(e) !== JSON.stringify(byName.get(e.name))).map((e) => e.name);
    const missing = (recorded ?? []).filter((e) => !live.some((l) => l.name === e.name)).map((e) => e.name);
    expect({ differing, missing }).toEqual({ differing: [], missing: [] });
    expect(live).toEqual(recorded ?? []);
  }, 60_000);
});

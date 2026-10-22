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
// a foreign `Host` and a foreign `Origin`. Write routes are not part of this recording; the second describe below
// records them in `writes.json` (T3, ISC-404).
//
// The test fails when the recording is missing or any entry differs. To re-record, on purpose and only on code whose
// answers are known to be right:
//
//   GOLDEN_RECORD=1 bun test ./tests/golden-routes.test.ts
//
// A re-recording is a reviewed change of `routes.json`, never a way to make this test pass.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  GOLDEN_NOW,
  type GoldenEntry,
  type GoldenRequest,
  type GoldenServer,
  NORMALISED,
  WRITE_PATHS,
  callGolden,
  changeFile,
  eventsGolden,
  goldenContext,
  normaliseText,
  readGolden,
  readGoldenJson,
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

// ── the write golden (T3, ISC-404) ───────────────────────────────────────────────────────────────────────────────
//
// Every route that writes, the six route writes of `WRITE_PATHS` and the database-only writes, each case on a fresh
// server over fresh fixtures (a new `startGolden` per case, so neither a file nor the database carries one case into
// the next), recorded as the read entries are (status, filtered headers, normalised body) plus `sent`, the request
// body, and `diff`, what the request changed in the two registered repositories, `.git/` and the worktrees included:
// each added, removed or changed path with its new content (an append as the appended text, a large rewrite as its
// changed line range, a large added file by sha256), and `touched`, the paths whose mtime alone moved. The recording
// also pins `WRITE_PATHS` as a JSON snapshot. Stored in `tests/fixtures/golden/writes.json`, re-recorded with the
// same flag:
//
//   GOLDEN_RECORD=1 bun test ./tests/golden-routes.test.ts -t "golden: write routes"
//
// Normalised beyond the read entries: the temp directories the fixtures live in (`<base>`), in bodies, headers and
// file contents. Every event `ts` comes from the frozen clock, so it stays as written.

const WRITES_FILE = join(import.meta.dir, "fixtures", "golden", "writes.json");
/** A file up to this size is recorded whole; a larger one by sha256 and size (added) or its changed lines (changed). */
const INLINE_BYTES = 4_096;
const JSON_TYPE = { "Content-Type": "application/json" };
const ZERO = "0".repeat(64);
/** `GOLDEN_NOW` minus `minutes`, as an ISO string: run lines relative to the frozen clock. */
const minutesBefore = (minutes: number): string => new Date(GOLDEN_NOW.getTime() - minutes * 60_000).toISOString();

interface FileState {
  readonly kind: "file" | "dir" | "link";
  readonly mode: number;
  readonly mtimeMs: number;
  readonly bytes: Buffer | null;
  readonly digest: string;
}
type Tree = Map<string, FileState>;

const sha256 = (bytes: Uint8Array | string): string => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");

/** Every path under `root`, `.git/` included, with kind, mode, mtime and bytes (as `snapshot` in readonly.test.ts). */
function tree(root: string, prefix = "", out: Tree = new Map()): Tree {
  for (const name of readdirSync(join(root, prefix)).sort()) {
    const path = prefix === "" ? name : `${prefix}/${name}`;
    const absolute = join(root, path);
    const stat = lstatSync(absolute);
    const base = { mode: stat.mode & 0o7777, mtimeMs: stat.mtimeMs };
    if (stat.isSymbolicLink()) {
      const target = readlinkSync(absolute, { encoding: "buffer" });
      out.set(path, { kind: "link", ...base, bytes: target, digest: sha256(target) });
    } else if (stat.isDirectory()) {
      out.set(path, { kind: "dir", ...base, bytes: null, digest: "" });
      tree(root, path, out);
    } else {
      const bytes = readFileSync(absolute);
      out.set(path, { kind: "file", ...base, bytes, digest: sha256(bytes) });
    }
  }
  return out;
}

type Normalise = (text: string) => string;

/** An added file as the diff shows it: whole when small and UTF-8, by sha256 and size otherwise. */
function shown(bytes: Buffer, normalise: Normalise): Record<string, unknown> {
  const text = bytes.toString("utf8");
  if (bytes.length <= INLINE_BYTES && Buffer.from(text, "utf8").equals(bytes)) return { content: normalise(text) };
  return { size: bytes.length, sha256: sha256(bytes) };
}

/** A changed file: the appended text when the old bytes are a prefix, else the new content or its changed line range. */
function changeOf(before: Buffer, after: Buffer, normalise: Normalise): Record<string, unknown> {
  if (after.length > before.length && after.subarray(0, before.length).equals(before)) {
    return { change: "appended", appended: normalise(after.subarray(before.length).toString("utf8")), sha256: sha256(after) };
  }
  if (after.length <= INLINE_BYTES) return { change: "changed", content: normalise(after.toString("utf8")) };
  const a = before.toString("utf8").split("\n");
  const b = after.toString("utf8").split("\n");
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const removed = a.slice(head, a.length - tail).map(normalise);
  const added = b.slice(head, b.length - tail).map(normalise);
  return { change: "changed", line: head + 1, removed, added, sha256: sha256(after) };
}

interface RepoDiff {
  readonly changes: Record<string, unknown>;
  readonly touched: string[];
}

/** What changed between two trees of one repository: `changes` by path, `touched` the paths whose mtime alone moved. */
function diffOf(before: Tree, after: Tree, normalise: Normalise): RepoDiff {
  const changes: Record<string, unknown> = {};
  const touched: string[] = [];
  for (const path of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    const a = before.get(path);
    const b = after.get(path);
    if (b === undefined) changes[path] = { change: "removed", kind: a?.kind };
    else if (a === undefined) changes[path] = { change: "added", kind: b.kind, mode: b.mode.toString(8), ...(b.bytes === null ? {} : shown(b.bytes, normalise)) };
    else if (a.kind !== b.kind || a.mode !== b.mode) changes[path] = { change: "kind-or-mode", from: `${a.kind} ${a.mode.toString(8)}`, to: `${b.kind} ${b.mode.toString(8)}` };
    else if (a.digest !== b.digest && a.bytes !== null && b.bytes !== null) changes[path] = changeOf(a.bytes, b.bytes, normalise);
    else if (a.mtimeMs !== b.mtimeMs) touched.push(path);
  }
  return { changes, touched };
}

/** One recorded write: the answer as a read entry records it, the body sent, and what changed in each repository. */
interface WriteEntry extends GoldenEntry {
  readonly sent: string | { readonly size: number; readonly sha256: string } | null;
  readonly diff: Readonly<Record<"harbor" | "library", RepoDiff>>;
}

interface WriteRecording {
  /** `WRITE_PATHS` of `server/src/writes.contract.ts`, as JSON. */
  readonly writePaths: unknown;
  readonly entries: readonly WriteEntry[];
}

/** One case: what it plants after the server is up (not recorded), and the request it sends, built on live reads. */
interface WriteCase {
  readonly name: string;
  /** False: no actor mapping is stored before the request. Default true, as the read golden's setup. */
  readonly actors?: boolean;
  readonly prepare?: (server: GoldenServer) => Promise<void> | void;
  readonly request: (server: GoldenServer) => Promise<GoldenRequest> | GoldenRequest;
}

const ACTORS = [{ id: "u:3f9c0a7d", displayName: "Harbor Master", gitIdentities: ["harbor@example.org"] }];
const PNG = ARCH_PNG;

const get = (server: GoldenServer, path: string): Promise<Response> => fetch(`${server.url}${path}`);
const headerOf = async (server: GoldenServer, path: string, name: string): Promise<string> => (await get(server, path)).headers.get(name) ?? "";
const bodyOf = async <T>(server: GoldenServer, path: string): Promise<T> => (await (await get(server, path)).json()) as T;
const send = (name: string, method: string, path: string, body?: unknown, headers: Record<string, string> = JSON_TYPE): GoldenRequest => ({
  name,
  method,
  path,
  headers,
  ...(body === undefined ? {} : { body: typeof body === "string" || body instanceof Uint8Array ? body : JSON.stringify(body) }),
});
const post = (name: string, path: string, body?: unknown, headers: Record<string, string> = JSON_TYPE): GoldenRequest => send(name, "POST", path, body, headers);

/** The three gate hashes of the spec page's `X-Spectant-Reviewed-Hashes` (`spec=…, plan=-, tasks=…`), `-` as null. */
async function reviewedHashes(server: GoldenServer, id: string): Promise<Record<string, string | null>> {
  const header = await headerOf(server, `${H}/specs/${id}`, "x-spectant-reviewed-hashes");
  const pairs = header.split(",").map((item) => item.trim().split("="));
  return Object.fromEntries(pairs.map(([key = "", hash = ""]) => [key, hash === "-" ? null : hash]));
}
const specHash = (server: GoldenServer, id: string): Promise<string> => headerOf(server, `${H}/specs/${id}`, "x-spectant-spec-hash");
const tasksHash = (server: GoldenServer, id: string): Promise<string> => headerOf(server, `${H}/specs/${id}/tasks`, "x-spectant-tasks-hash");
const storyHash = async (server: GoldenServer, slug: string): Promise<string> => (await bodyOf<{ hash: string }>(server, `${H}/ideas/${slug}`)).hash;
const backlogHash = async (server: GoldenServer): Promise<string> => (await bodyOf<{ backlogHash: string }>(server, `${H}/planning`)).backlogHash;
const activityHash = (server: GoldenServer): Promise<string> => headerOf(server, `${H}/dashboard`, "x-spectant-activity-hash");

/** Appends `run-start` lines to harbor's activity log and gives the file back its golden mtime. */
function plantRuns(server: GoldenServer, runs: ReadonlyArray<Record<string, string>>): void {
  const file = join(server.repos.harbor, ".spectant", "activity.jsonl");
  const lines = runs.map((r) => `${JSON.stringify({ ts: r.ts, event: "run-start", session: "a:claude:sess-9", ...r })}\n`).join("");
  changeFile(file, `${readFileSync(file, "utf8")}${lines}`);
}
const runOn = (minutes: number, run: string, command: string, item: Record<string, string>): Record<string, string> => ({ ts: minutesBefore(minutes), run, command, ...item });

/** A note created before the request, so the update and remove cases have one to name; its id. */
async function plantNote(server: GoldenServer): Promise<string> {
  const draft = { anchor: { kind: "spec", spec: "002" }, title: "Golden note", body: "Pinned for the golden master." };
  setGoldenClock(-60_000);
  const res = await setupCall(server, { name: "note", method: "POST", path: `${H}/notes`, headers: JSON_TYPE, body: JSON.stringify(draft) });
  setGoldenClock(0);
  return ((await res.json()) as { id: string }).id;
}
let plantedNote = "";
const spareDir = (server: GoldenServer): string => join(dirname(server.repos.library), "spare");

const SPEC_WRITES: readonly WriteCase[] = [
  // the reviewed mark: 006 is in review with a stale mark, 002 holds the open claim ISC-74
  { name: "gateReviewed valid 006", request: async (s) => post("gateReviewed valid 006", `${H}/specs/006/gate/reviewed`, { hashes: await reviewedHashes(s, "006") }) },
  { name: "gateReviewed valid 003 creates .gates", request: async (s) => post("gateReviewed valid 003 creates .gates", `${H}/specs/003/gate/reviewed`, { hashes: await reviewedHashes(s, "003") }) },
  { name: "gateReviewed wrong hash 006", request: async (s) => post("gateReviewed wrong hash 006", `${H}/specs/006/gate/reviewed`, { hashes: { ...(await reviewedHashes(s, "006")), spec: ZERO } }) },
  { name: "gateReviewed locked 002", request: async (s) => post("gateReviewed locked 002", `${H}/specs/002/gate/reviewed`, { hashes: await reviewedHashes(s, "002") }) },
  {
    name: "gateReviewed run-locked 006",
    prepare: (s) => plantRuns(s, [runOn(5, "r-006", "/spec review 006", { spec: "006" })]),
    request: async (s) => post("gateReviewed run-locked 006", `${H}/specs/006/gate/reviewed`, { hashes: await reviewedHashes(s, "006") }),
  },
  { name: "gateReviewed unknown spec", request: () => post("gateReviewed unknown spec", `${H}/specs/999/gate/reviewed`, { hashes: { spec: ZERO, plan: null, tasks: null } }) },
  { name: "gateReviewed bad body", request: () => post("gateReviewed bad body", `${H}/specs/006/gate/reviewed`, "not json") },
  { name: "gateReviewed missing hashes", request: () => post("gateReviewed missing hashes", `${H}/specs/006/gate/reviewed`, {}) },
  {
    name: "gateReviewed 403 origin",
    request: async (s) => post("gateReviewed 403 origin", `${H}/specs/006/gate/reviewed`, { hashes: await reviewedHashes(s, "006") }, { ...JSON_TYPE, ...FOREIGN_ORIGIN }),
  },
  // one task checkbox: 004 T1 is ticked, 002 T27 belongs to the open claim ISC-74
  { name: "taskCheck valid 004 T1", request: async (s) => post("taskCheck valid 004 T1", `${H}/specs/004/tasks/T1/check`, { checked: false, hash: await tasksHash(s, "004") }) },
  { name: "taskCheck unchanged 004 T1", request: async (s) => post("taskCheck unchanged 004 T1", `${H}/specs/004/tasks/T1/check`, { checked: true, hash: await tasksHash(s, "004") }) },
  { name: "taskCheck wrong hash 004 T1", request: () => post("taskCheck wrong hash 004 T1", `${H}/specs/004/tasks/T1/check`, { checked: false, hash: ZERO }) },
  { name: "taskCheck locked 002 T27", request: async (s) => post("taskCheck locked 002 T27", `${H}/specs/002/tasks/T27/check`, { checked: true, hash: await tasksHash(s, "002") }) },
  {
    name: "taskCheck run-locked 004 T1",
    prepare: (s) => plantRuns(s, [runOn(5, "r-004", "/spec implement 004", { spec: "004" })]),
    request: async (s) => post("taskCheck run-locked 004 T1", `${H}/specs/004/tasks/T1/check`, { checked: false, hash: await tasksHash(s, "004") }),
  },
  { name: "taskCheck unknown task", request: async (s) => post("taskCheck unknown task", `${H}/specs/004/tasks/T99/check`, { checked: true, hash: await tasksHash(s, "004") }) },
  { name: "taskCheck bad body", request: () => post("taskCheck bad body", `${H}/specs/004/tasks/T1/check`, { checked: "yes" }) },
  // the stage move
  { name: "transition valid 003 review", request: async (s) => post("transition valid 003 review", `${H}/specs/003/transition`, { to: "review", hash: await specHash(s, "003") }) },
  { name: "transition wrong hash 003", request: () => post("transition wrong hash 003", `${H}/specs/003/transition`, { to: "review", hash: ZERO }) },
  { name: "transition locked 002", request: async (s) => post("transition locked 002", `${H}/specs/002/transition`, { to: "code-review", hash: await specHash(s, "002") }) },
  {
    name: "transition run-locked 003",
    prepare: (s) => plantRuns(s, [runOn(5, "r-003", "/spec tasks 003", { spec: "003" })]),
    request: async (s) => post("transition run-locked 003", `${H}/specs/003/transition`, { to: "review", hash: await specHash(s, "003") }),
  },
  {
    name: "transition aborted run 003",
    prepare: (s) => plantRuns(s, [runOn(600, "r-old", "/spec tasks 003", { spec: "003" })]),
    request: async (s) => post("transition aborted run 003", `${H}/specs/003/transition`, { to: "review", hash: await specHash(s, "003") }),
  },
  { name: "transition refused 003 done", request: async (s) => post("transition refused 003 done", `${H}/specs/003/transition`, { to: "done", hash: await specHash(s, "003") }) },
  { name: "transition refused 003 same", request: async (s) => post("transition refused 003 same", `${H}/specs/003/transition`, { to: "tasks", hash: await specHash(s, "003") }) },
  { name: "transition unknown stage", request: async (s) => post("transition unknown stage", `${H}/specs/003/transition`, { to: "bogus", hash: await specHash(s, "003") }) },
  { name: "transition unknown spec", request: () => post("transition unknown spec", `${H}/specs/999/transition`, { to: "review", hash: ZERO }) },
  { name: "transition bad body", request: () => post("transition bad body", `${H}/specs/003/transition`, "not json") },
  // the allocation of a story
  {
    name: "allocate valid console-audit-log",
    request: async (s) => post("allocate valid console-audit-log", `${H}/ideas/console-audit-log/allocate`, { hash: await storyHash(s, "console-audit-log") }),
  },
  { name: "allocate wrong hash", request: () => post("allocate wrong hash", `${H}/ideas/console-audit-log/allocate`, { hash: ZERO }) },
  {
    name: "allocate run-locked",
    prepare: (s) => plantRuns(s, [runOn(5, "r-idea", "/spec new console-audit-log", { idea: "console-audit-log" })]),
    request: async (s) => post("allocate run-locked", `${H}/ideas/console-audit-log/allocate`, { hash: await storyHash(s, "console-audit-log") }),
  },
  {
    name: "allocate refused not-in-index",
    request: async (s) => post("allocate refused not-in-index", `${H}/ideas/registry-webhooks/allocate`, { hash: await storyHash(s, "registry-webhooks") }),
  },
  { name: "allocate unknown story", request: () => post("allocate unknown story", `${H}/ideas/tide-tables/allocate`, { hash: ZERO }) },
  { name: "allocate bad body", request: () => post("allocate bad body", `${H}/ideas/console-audit-log/allocate`, "not json") },
  { name: "allocate unknown workspace", request: () => post("allocate unknown workspace", `${W}/nowhere/ideas/console-audit-log/allocate`, { hash: ZERO }) },
  // the feature backlog (no lock source, so no 423)
  { name: "backlog valid move", request: async (s) => post("backlog valid move", `${H}/backlog`, { op: "move", feature: "F2", before: "F1", hash: await backlogHash(s) }) },
  { name: "backlog valid move last", request: async (s) => post("backlog valid move last", `${H}/backlog`, { op: "move", feature: "F0", before: null, hash: await backlogHash(s) }) },
  { name: "backlog valid priority", request: async (s) => post("backlog valid priority", `${H}/backlog`, { op: "priority", feature: "F1", priority: "P1", hash: await backlogHash(s) }) },
  { name: "backlog wrong hash", request: () => post("backlog wrong hash", `${H}/backlog`, { op: "priority", feature: "F1", priority: "P1", hash: ZERO }) },
  { name: "backlog refused priority", request: async (s) => post("backlog refused priority", `${H}/backlog`, { op: "priority", feature: "F1", priority: "P9", hash: await backlogHash(s) }) },
  {
    name: "backlog refused unknown feature",
    request: async (s) => post("backlog refused unknown feature", `${H}/backlog`, { op: "move", feature: "F9", before: "F1", hash: await backlogHash(s) }),
  },
  { name: "backlog bad body", request: () => post("backlog bad body", `${H}/backlog`, { op: "swap", feature: "F1", hash: ZERO }) },
  { name: "backlog unknown workspace", request: () => post("backlog unknown workspace", `${W}/nowhere/backlog`, { op: "priority", feature: "F1", priority: "P1", hash: ZERO }) },
];

/** The two runs every release case plants: r-003 running, r-old aborted (older than `runAbortMinutes`). */
const releaseRuns = (s: GoldenServer): void => plantRuns(s, [runOn(5, "r-003", "/spec tasks 003", { spec: "003" }), runOn(600, "r-old", "/spec review 004", { spec: "004" })]);
/** The no-viewer case: the temp global config of the harness loses its `user.email`, so the viewer has no `u:` id. */
const noEmail = (s: GoldenServer): void => {
  releaseRuns(s);
  writeFileSync(join(process.env.HOME ?? "", ".gitconfig"), "[user]\n\tname = Harbor Master\n");
};
const release = (name: string, run: string, hash: (s: GoldenServer) => Promise<string | null>, viewer = true): WriteCase => ({
  name,
  prepare: viewer ? releaseRuns : noEmail,
  request: async (s) => {
    const sent = await hash(s);
    return post(name, `${H}/runs/${run}/release`, undefined, sent === null ? {} : { "X-Spectant-Activity-Hash": sent });
  },
});

const RELEASE_WRITES: readonly WriteCase[] = [
  release("runRelease valid r-003", "r-003", activityHash),
  release("runRelease missing hash", "r-003", () => Promise.resolve(null)),
  release("runRelease unknown run", "r-none", activityHash),
  release("runRelease wrong hash", "r-003", () => Promise.resolve(ZERO)),
  release("runRelease refused aborted", "r-old", activityHash),
  release("runRelease refused no-viewer", "r-003", activityHash, false),
];

const DATABASE_WRITES: readonly WriteCase[] = [
  // settings, actors, the board query, favourites
  { name: "settings valid", request: () => send("settings valid", "PUT", "/api/settings", { theme: "dark", runAbortMinutes: 90 }) },
  { name: "settings invalid value", request: () => send("settings invalid value", "PUT", "/api/settings", { theme: "neon" }) },
  { name: "settings unknown key", request: () => send("settings unknown key", "PUT", "/api/settings", { colour: "red" }) },
  { name: "settings bad body", request: () => send("settings bad body", "PUT", "/api/settings", "not json") },
  { name: "settings 403 origin", request: () => send("settings 403 origin", "PUT", "/api/settings", { theme: "dark" }, { ...JSON_TYPE, ...FOREIGN_ORIGIN }) },
  { name: "actors valid", actors: false, request: () => send("actors valid", "PUT", "/api/actors", ACTORS) },
  { name: "actors duplicate ids", request: () => send("actors duplicate ids", "PUT", "/api/actors", [...ACTORS, ...ACTORS]) },
  { name: "actors bad body", request: () => send("actors bad body", "PUT", "/api/actors", "not json") },
  { name: "boardQuery valid", request: () => send("boardQuery valid", "PUT", `${H}/board-query`, { query: "stage:build" }) },
  { name: "boardQuery invalid", request: () => send("boardQuery invalid", "PUT", `${H}/board-query`, { query: "?stage:build" }) },
  { name: "boardQuery bad body", request: () => send("boardQuery bad body", "PUT", `${H}/board-query`, "not json") },
  { name: "boardQuery unknown workspace", request: () => send("boardQuery unknown workspace", "PUT", `${W}/nowhere/board-query`, { query: "" }) },
  { name: "favorite put valid", request: () => send("favorite put valid", "PUT", `${H}/favorites/002-web-console`) },
  { name: "favorite put invalid", request: () => send("favorite put invalid", "PUT", `${H}/favorites/retention`) },
  { name: "favorite put unknown workspace", request: () => send("favorite put unknown workspace", "PUT", `${W}/nowhere/favorites/002-web-console`) },
  {
    name: "favorite delete valid",
    prepare: async (s) => {
      await setupCall(s, { name: "favourite", method: "PUT", path: `${H}/favorites/002-web-console` });
    },
    request: () => send("favorite delete valid", "DELETE", `${H}/favorites/002-web-console`),
  },
  // Spec 064 T50: the idea favourite beside the spec favourite, the database alone.
  { name: "ideaFavorite put valid", request: () => send("ideaFavorite put valid", "PUT", `${H}/favorites/idea/tide-alerts`) },
  { name: "ideaFavorite put invalid", request: () => send("ideaFavorite put invalid", "PUT", `${H}/favorites/idea/Tide_Alerts`) },
  { name: "ideaFavorite put unknown workspace", request: () => send("ideaFavorite put unknown workspace", "PUT", `${W}/nowhere/favorites/idea/tide-alerts`) },
  {
    name: "ideaFavorite delete valid",
    prepare: async (s) => {
      await setupCall(s, { name: "idea favourite", method: "PUT", path: `${H}/favorites/idea/tide-alerts` });
    },
    request: () => send("ideaFavorite delete valid", "DELETE", `${H}/favorites/idea/tide-alerts`),
  },
  { name: "favorite delete unknown workspace", request: () => send("favorite delete unknown workspace", "DELETE", `${W}/nowhere/favorites/002-web-console`) },
  // notes
  {
    name: "note create valid",
    request: () => post("note create valid", `${H}/notes`, { anchor: { kind: "claim", spec: "002", id: "ISC-74" }, title: "", body: "A claim note.", pinned: true }),
  },
  { name: "note create blank body", request: () => post("note create blank body", `${H}/notes`, { anchor: null, title: "", body: "  " }) },
  { name: "note create bad body", request: () => post("note create bad body", `${H}/notes`, "not json") },
  { name: "note create unknown workspace", request: () => post("note create unknown workspace", `${W}/nowhere/notes`, { anchor: null, title: "", body: "x" }) },
  {
    name: "note update valid",
    prepare: async (s) => void (plantedNote = await plantNote(s)),
    request: () => send("note update valid", "PUT", `${H}/notes/${plantedNote}`, { anchor: null, title: "Renamed", body: "Edited body." }),
  },
  {
    name: "note update invalid",
    prepare: async (s) => void (plantedNote = await plantNote(s)),
    request: () => send("note update invalid", "PUT", `${H}/notes/${plantedNote}`, { anchor: { kind: "shelf", spec: "002" }, title: "", body: "x" }),
  },
  { name: "note update unknown note", request: () => send("note update unknown note", "PUT", `${H}/notes/00000000-0000-4000-8000-000000000000`, { anchor: null, title: "", body: "x" }) },
  { name: "note remove valid", prepare: async (s) => void (plantedNote = await plantNote(s)), request: () => send("note remove valid", "DELETE", `${H}/notes/${plantedNote}`) },
  { name: "note remove unknown note", request: () => send("note remove unknown note", "DELETE", `${H}/notes/00000000-0000-4000-8000-000000000000`) },
  // images
  { name: "image put valid logo", request: () => send("image put valid logo", "PUT", `${H}/images/logo`, PNG, { "Content-Type": "image/png" }) },
  { name: "image put valid screenshot", request: () => send("image put valid screenshot", "PUT", `${H}/images/screenshot`, PNG, { "Content-Type": "image/png" }) },
  { name: "image put unsupported type", request: () => send("image put unsupported type", "PUT", `${H}/images/logo`, "plain text, no image", { "Content-Type": "image/png" }) },
  { name: "image put too large", request: () => send("image put too large", "PUT", `${H}/images/logo`, new Uint8Array(2 * 1024 * 1024 + 1), { "Content-Type": "image/png" }) },
  { name: "image put unknown kind", request: () => send("image put unknown kind", "PUT", `${H}/images/banner`, PNG, { "Content-Type": "image/png" }) },
  { name: "image put unknown workspace", request: () => send("image put unknown workspace", "PUT", `${W}/nowhere/images/logo`, PNG, { "Content-Type": "image/png" }) },
  // the workspace registry
  {
    name: "workspace add valid",
    prepare: (s) => void mkdirSync(join(spareDir(s), "specs"), { recursive: true }),
    request: (s) => post("workspace add valid", W, { path: spareDir(s), name: "Spare" }),
  },
  { name: "workspace add duplicate", request: (s) => post("workspace add duplicate", W, { path: s.repos.harbor }) },
  { name: "workspace add missing path", request: (s) => post("workspace add missing path", W, { path: join(spareDir(s), "absent") }) },
  { name: "workspace add relative path", request: () => post("workspace add relative path", W, { path: "relative/dir" }) },
  { name: "workspace add bad body", request: () => post("workspace add bad body", W, "not json") },
  { name: "workspace add 403 origin", request: (s) => post("workspace add 403 origin", W, { path: s.repos.harbor }, { ...JSON_TYPE, ...FOREIGN_ORIGIN }) },
  { name: "workspace rename valid", request: () => send("workspace rename valid", "PATCH", H, { name: "Harbour" }) },
  { name: "workspace rename blank", request: () => send("workspace rename blank", "PATCH", H, { name: "  " }) },
  { name: "workspace rename unknown", request: () => send("workspace rename unknown", "PATCH", `${W}/nowhere`, { name: "Nowhere" }) },
  { name: "workspace remove valid", request: () => send("workspace remove valid", "DELETE", L) },
  { name: "workspace remove unknown", request: () => send("workspace remove unknown", "DELETE", `${W}/nowhere`) },
  { name: "workspace rescan valid", request: () => post("workspace rescan valid", `${H}/rescan`) },
  { name: "workspace rescan unknown", request: () => post("workspace rescan unknown", `${W}/nowhere/rescan`) },
];

const WRITE_CASES: readonly WriteCase[] = [...SPEC_WRITES, ...RELEASE_WRITES, ...DATABASE_WRITES];

/** The body as sent: text as it is, bytes by size and sha256. */
function sentOf(body: GoldenRequest["body"], normalise: Normalise): WriteEntry["sent"] {
  if (body === undefined) return null;
  if (typeof body === "string") return normalise(body);
  return { size: body.length, sha256: sha256(body) };
}

/** One case on a fresh server: plant, snapshot, send, snapshot, stop. */
async function recordWrite(c: WriteCase): Promise<WriteEntry> {
  const server = await startGolden();
  try {
    const prefixes = [dirname(server.repos.harbor), dirname(server.repos.library)].sort((a, b) => b.length - a.length);
    const context = goldenContext();
    const unbased = (text: string): string => prefixes.reduce((t, p) => t.replaceAll(p, "<base>"), text);
    const normalise: Normalise = (text) => normaliseText(unbased(text), server.port, context.ids, false).text;
    if (c.actors !== false) await setupCall(server, { name: "actors", method: "PUT", path: "/api/actors", headers: JSON_TYPE, body: JSON.stringify(ACTORS) });
    await c.prepare?.(server);
    const req = await c.request(server);
    const before = { harbor: tree(server.repos.harbor), library: tree(server.repos.library) };
    const entry = await callGolden(server, req, context);
    const diff = {
      harbor: diffOf(before.harbor, tree(server.repos.harbor), normalise),
      library: diffOf(before.library, tree(server.repos.library), normalise),
    };
    const holdsBase = prefixes.some((p) => entry.body.includes(p) || Object.values(entry.headers).some((v) => v.includes(p)));
    const headers = Object.fromEntries(Object.entries(entry.headers).map(([k, v]) => [k, unbased(v)]));
    if (holdsBase && headers.etag !== undefined) headers.etag = NORMALISED;
    const body = entry.encoding === "utf8" ? unbased(entry.body) : entry.body;
    return { ...entry, headers, body, sent: sentOf(req.body, normalise), diff };
  } finally {
    await server.stop();
  }
}

describe("golden: write routes (spec 059, ISC-404)", () => {
  test("every write route answers and changes the repository as recorded, and WRITE_PATHS is unchanged", async () => {
    const live: WriteEntry[] = [];
    for (const c of WRITE_CASES) live.push(await recordWrite(c));
    expect(new Set(live.map((e) => e.name)).size).toBe(live.length);
    const recording: WriteRecording = { writePaths: JSON.parse(JSON.stringify(WRITE_PATHS)), entries: live };
    if (RECORD) writeGolden(WRITES_FILE, recording);
    const recorded = readGoldenJson(WRITES_FILE) as WriteRecording | null;
    expect({ file: "tests/fixtures/golden/writes.json", present: recorded !== null }).toEqual({ file: "tests/fixtures/golden/writes.json", present: true });
    expect(recording.writePaths).toEqual(recorded?.writePaths);
    const byName = new Map((recorded?.entries ?? []).map((e) => [e.name, e]));
    const differing = live.filter((e) => JSON.stringify(e) !== JSON.stringify(byName.get(e.name))).map((e) => e.name);
    const missing = (recorded?.entries ?? []).filter((e) => !live.some((l) => l.name === e.name)).map((e) => e.name);
    expect({ differing, missing }).toEqual({ differing: [], missing: [] });
    expect(JSON.parse(JSON.stringify(recording))).toEqual(recorded ?? {});
  }, 600_000);
});

// The notes store (T95, T96, ISC-94): a note lives in the `note` table of `spectant.db` in the data directory, with its
// workspace and at most one anchor (spec, claim or task), and the registered repository stays byte-identical.
//
// The repository under test is a temp git copy of `core/fixtures/harbor` (one commit). Every HTTP call goes through
// `call`, which hashes the whole copy, `.git/` included (path, kind, mode, bytes and mtime), before and after, and
// fails on any difference. `git status` runs with `--no-optional-locks`, so the probe itself never refreshes the index.
// The store gets a stepping clock, so the list order (`updated` descending) is deterministic.
//
// Every test name carries "store": `bun test tests/notes.test.ts -t "store"` is the ISC-94 probe.
import type { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { cpSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type EmbeddedManifest, embeddedAssetFor } from "../server/src/assets.contract.ts";
import { run } from "../server/src/cli.ts";
import { openDatabase, openDatabaseUnmigrated, schemaVersion } from "../server/src/db.ts";
import type { ApiHandler } from "../server/src/http.ts";
import { type Note, type NoteCounts, type NoteRow, noteRoutes, validateNote } from "../server/src/notes.contract.ts";
import { type NoteStore, notesApi, openNotes } from "../server/src/notes.ts";
import { type Registry, openRegistry } from "../server/src/registry.ts";

const FIXTURE = join(import.meta.dir, "..", "core", "fixtures", "harbor");
const WS = "harbor";
const ORIGIN = "http://127.0.0.1:7717";

const sha256 = (bytes: Uint8Array | string): string => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");

/** Every entry below `dir`: path, kind, mode, mtime and the sha256 of its bytes (or link target), node:fs only. */
function walk(dir: string, prefix = "", out: string[] = []): string[] {
  for (const name of readdirSync(dir).sort()) {
    const absolute = join(dir, name);
    const path = prefix === "" ? name : `${prefix}/${name}`;
    const stat = lstatSync(absolute);
    const head = `${path}\0${(stat.mode & 0o7777).toString(8)}\0${stat.mtimeMs}`;
    if (stat.isSymbolicLink()) out.push(`${head}\0link\0${sha256(readlinkSync(absolute, { encoding: "buffer" }))}`);
    else if (stat.isDirectory()) {
      out.push(`${head}\0dir`);
      walk(absolute, path, out);
    } else out.push(`${head}\0file\0${sha256(readFileSync(absolute))}`);
  }
  return out;
}

/** The recursive hash of `root`, `.git/` included. */
const treeHash = (root: string): string => sha256(walk(root).join("\n"));

function git(cwd: string, ...args: string[]): string {
  const result = Bun.spawnSync(["git", ...args], {
    cwd,
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_AUTHOR_NAME: "Spectant Test",
      GIT_AUTHOR_EMAIL: "notes@example.com",
      GIT_COMMITTER_NAME: "Spectant Test",
      GIT_COMMITTER_EMAIL: "notes@example.com",
      GIT_AUTHOR_DATE: "2026-09-29T12:00:00Z",
      GIT_COMMITTER_DATE: "2026-09-29T12:00:00Z",
    },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr.toString()}`);
  return result.stdout.toString().trim();
}

let root: string;
let repo: string;
let other: string;
let registry: Registry;
let db: Database;
let store: NoteStore;
let api: ApiHandler;
let baseline: string;
let tick = 0;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "spectant-notes-"));
  repo = join(root, WS);
  other = join(root, "other");
  cpSync(FIXTURE, repo, { recursive: true });
  mkdirSync(other);
  git(repo, "init", "-q", "-b", "main");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "harbor fixture");
  const data = join(root, "data");
  registry = openRegistry(data);
  registry.add(repo);
  registry.add(other);
  db = openDatabase(data);
  store = openNotes(db, { now: () => new Date(Date.UTC(2026, 8, 29, 10, 0, tick++)) });
  api = notesApi({ store, registry });
  baseline = treeHash(repo);
});

afterAll(() => {
  db.close();
  registry.close();
  rmSync(root, { recursive: true, force: true });
});

type Call = { status: number; body: unknown; headers: Headers };

/** One request through the handler; the harbor copy must hash the same before and after, and git must report it clean. */
async function call(method: string, path: string, init: { body?: unknown; headers?: Record<string, string> } = {}): Promise<Call> {
  const before = treeHash(repo);
  const headers: Record<string, string> = { Host: "127.0.0.1:7717", ...init.headers };
  const raw = init.body === undefined ? undefined : typeof init.body === "string" ? init.body : JSON.stringify(init.body);
  const req = new Request(`${ORIGIN}${path}`, { method, headers, body: raw });
  const answer = api(req, new URL(req.url));
  if (answer === null) throw new Error(`no notes route answered ${method} ${path}`);
  const res = await answer;
  const text = await res.text();
  expect(treeHash(repo)).toBe(before);
  expect(treeHash(repo)).toBe(baseline);
  return { status: res.status, body: text === "" ? null : (JSON.parse(text) as unknown), headers: res.headers };
}

const rowCount = (): number => db.query<{ n: number }, []>("SELECT count(*) AS n FROM note").get()?.n ?? 0;
const row = (id: string): NoteRow | null => db.query<NoteRow, [string]>("SELECT * FROM note WHERE id = ?").get(id);
const ids = (body: unknown): string[] => (body as Note[]).map((n) => n.id);

const created: Record<"none" | "spec" | "claim" | "task", Note> = {} as never;

describe("notes store", () => {
  test("store: a note with no anchor and one of each kind is a row in the data directory, the repository unchanged", async () => {
    const drafts = {
      none: { title: "  Loose thought  ", body: "no anchor" },
      spec: { anchor: { kind: "spec", spec: "002" }, body: "on the spec" },
      claim: { anchor: { kind: "claim", spec: "002", id: "ISC-94" }, title: "claim", body: "on a claim" },
      task: { anchor: { kind: "task", spec: "002", id: "T95" }, body: "on a task" },
    } as const;
    for (const [key, draft] of Object.entries(drafts) as Array<[keyof typeof drafts, (typeof drafts)[keyof typeof drafts]]>) {
      const res = await call("POST", noteRoutes.create(WS), { body: draft });
      expect(res.status).toBe(201);
      const check = validateNote(res.body);
      expect(check.ok).toBe(true);
      const note = res.body as Note;
      expect(note.workspace).toBe(WS);
      expect(note.anchor).toEqual("anchor" in draft ? draft.anchor : null);
      expect(note.created).toBe(note.updated);
      const stored = row(note.id);
      expect(stored?.workspace).toBe(WS);
      expect(stored?.anchor_kind ?? null).toBe("anchor" in draft ? draft.anchor.kind : null);
      created[key] = note;
    }
    expect(created.none.title).toBe("Loose thought");
    expect(rowCount()).toBe(4);
    expect(git(repo, "--no-optional-locks", "status", "--porcelain")).toBe("");
  });

  test("store: a second anchor is refused with 400 multiple-anchors and nothing is stored", async () => {
    const two = [
      { kind: "spec", spec: "002" },
      { kind: "claim", spec: "002", id: "ISC-94" },
    ];
    expect(await call("POST", noteRoutes.create(WS), { body: { anchors: two, body: "x" } })).toMatchObject({
      status: 400,
      body: { error: "multiple-anchors" },
    });
    expect(await call("POST", noteRoutes.create(WS), { body: { anchor: two, body: "x" } })).toMatchObject({
      status: 400,
      body: { error: "multiple-anchors" },
    });
    expect((await call("POST", noteRoutes.create(WS), { body: { body: "  " } })).body).toEqual({ error: "empty-body" });
    expect((await call("POST", noteRoutes.create(WS), { body: "{not json" })).body).toEqual({ error: "invalid-body" });
    expect(rowCount()).toBe(4);
  });

  test("store: the list filters by spec, claim, task, unanchored and orphans, newest update first", async () => {
    const all = await call("GET", noteRoutes.list(WS));
    expect(all.status).toBe(200);
    expect(ids(all.body)).toEqual([created.task.id, created.claim.id, created.spec.id, created.none.id]);
    expect(ids((await call("GET", noteRoutes.list(WS, { spec: "002" }))).body)).toEqual([created.task.id, created.claim.id, created.spec.id]);
    expect(ids((await call("GET", noteRoutes.list(WS, { spec: "002", claim: "ISC-94" }))).body)).toEqual([created.claim.id]);
    expect(ids((await call("GET", noteRoutes.list(WS, { spec: "002", task: "T95" }))).body)).toEqual([created.task.id]);
    expect(ids((await call("GET", noteRoutes.list(WS, { spec: "003" }))).body)).toEqual([]);
    expect(ids((await call("GET", noteRoutes.list(WS, { unanchored: true }))).body)).toEqual([created.none.id]);
    expect(ids((await call("GET", noteRoutes.list(WS, { orphans: true }))).body)).toEqual([]);
    expect(ids((await call("GET", noteRoutes.list("other"))).body)).toEqual([]);
    expect(await call("GET", `${noteRoutes.list(WS)}?claim=ISC-94`)).toMatchObject({ status: 400, body: { error: "invalid-query" } });
  });

  test("store: the GETs carry an ETag, answer 304 on a match and HEAD without a body", async () => {
    const first = await call("GET", noteRoutes.list(WS));
    const etag = first.headers.get("ETag");
    expect(etag).toBeTruthy();
    const again = await call("GET", noteRoutes.list(WS), { headers: { "If-None-Match": etag ?? "" } });
    expect(again.status).toBe(304);
    const head = await call("HEAD", noteRoutes.counts(WS, "002"));
    expect(head).toMatchObject({ status: 200, body: null });
    expect(head.headers.get("ETag")).toBeTruthy();
  });

  test("store: PUT replaces the whole draft, keeps id, workspace and created, and moves updated", async () => {
    const res = await call("PUT", noteRoutes.update(WS, created.claim.id), { body: { body: "rewritten" } });
    expect(res.status).toBe(200);
    const note = res.body as Note;
    expect(note).toMatchObject({ id: created.claim.id, workspace: WS, anchor: null, title: "", body: "rewritten", created: created.claim.created });
    expect(note.updated > created.claim.updated).toBe(true);
    expect(row(note.id)).toMatchObject({ anchor_kind: null, anchor_spec: null, anchor_id: null, title: "", body: "rewritten" });
    expect(ids((await call("GET", noteRoutes.list(WS))).body)[0]).toBe(created.claim.id);
    const moved = await call("PUT", noteRoutes.update(WS, created.claim.id), {
      body: { anchor: { kind: "claim", spec: "002", id: "ISC-94" }, title: "claim", body: "on a claim, again" },
    });
    expect((moved.body as Note).anchor).toEqual({ kind: "claim", spec: "002", id: "ISC-94" });
    expect(await call("PUT", noteRoutes.update(WS, created.claim.id), { body: { body: "" } })).toMatchObject({
      status: 400,
      body: { error: "empty-body" },
    });
    expect((await call("PUT", noteRoutes.update(WS, crypto.randomUUID()), { body: { body: "x" } })).status).toBe(404);
    expect((await call("PUT", noteRoutes.update("other", created.claim.id), { body: { body: "x" } })).status).toBe(404);
  });

  test("store: the counts group a spec's notes per anchor", async () => {
    await call("POST", noteRoutes.create(WS), { body: { anchor: { kind: "claim", spec: "002", id: "ISC-94" }, body: "second" } });
    await call("POST", noteRoutes.create(WS), { body: { anchor: { kind: "claim", spec: "003", id: "ISC-94" }, body: "other spec" } });
    const res = await call("GET", noteRoutes.counts(WS, "002"));
    expect(res.status).toBe(200);
    expect(res.body as NoteCounts).toEqual({ spec: "002", total: 4, onSpec: 1, claims: { "ISC-94": 2 }, tasks: { T95: 1 } });
    expect((await call("GET", noteRoutes.counts(WS, "009"))).body).toEqual({ spec: "009", total: 0, onSpec: 0, claims: {}, tasks: {} });
    expect(await call("GET", `${noteRoutes.counts(WS, "002")}&spec=003`)).toMatchObject({ status: 400, body: { error: "invalid-query" } });
    expect(store.counts(WS, "003")).toEqual({ spec: "003", total: 1, onSpec: 0, claims: { "ISC-94": 1 }, tasks: {} });
  });

  test("store: DELETE answers 204, then 404, and the row is gone", async () => {
    const before = rowCount();
    const res = await call("DELETE", noteRoutes.remove(WS, created.task.id));
    expect(res).toMatchObject({ status: 204, body: null });
    expect(row(created.task.id)).toBeNull();
    expect(rowCount()).toBe(before - 1);
    expect(await call("DELETE", noteRoutes.remove(WS, created.task.id))).toMatchObject({ status: 404, body: { error: "not-found" } });
    expect((await call("DELETE", noteRoutes.remove(WS, "not-a-uuid"))).status).toBe(404);
  });

  test("store: the route guards answer 404, 403 and 405 the API's way", async () => {
    expect(await call("GET", noteRoutes.list("nobody"))).toMatchObject({ status: 404, body: { error: "not-found" } });
    expect(await call("POST", noteRoutes.create("nobody"), { body: { body: "x" } })).toMatchObject({ status: 404 });
    expect(await call("GET", noteRoutes.list(WS), { headers: { Host: "evil.example" } })).toMatchObject({
      status: 403,
      body: { error: "forbidden" },
    });
    expect(await call("POST", noteRoutes.create(WS), { body: { body: "x" }, headers: { Origin: "https://evil.example" } })).toMatchObject({
      status: 403,
    });
    const patch = await call("PATCH", noteRoutes.list(WS));
    expect(patch).toMatchObject({ status: 405, body: { error: "method-not-allowed" } });
    expect(patch.headers.get("Allow")).toBe("GET, HEAD, POST");
    expect((await call("GET", noteRoutes.update(WS, created.none.id))).headers.get("Allow")).toBe("PUT, DELETE");
    expect((await call("POST", noteRoutes.counts(WS, "002"))).headers.get("Allow")).toBe("GET, HEAD");
    const other = new Request(`${ORIGIN}/api/workspaces/${WS}/dashboard`, { headers: { Host: "127.0.0.1:7717" } });
    expect(api(other, new URL(other.url))).toBeNull();
  });

  test("store: removing the workspace through the registry orphans its notes, the repository unchanged", async () => {
    const mine = ids((await call("GET", noteRoutes.list(WS))).body);
    expect(mine.length).toBeGreaterThan(0);
    expect(registry.remove(WS)).toBe(true);
    expect(treeHash(repo)).toBe(baseline);
    expect(db.query<{ n: number }, []>("SELECT count(*) AS n FROM note WHERE workspace IS NOT NULL").get()?.n).toBe(0);
    expect(rowCount()).toBe(mine.length);
    expect((await call("GET", noteRoutes.list(WS))).status).toBe(404);
    const orphans = await call("GET", noteRoutes.list("other", { orphans: true }));
    expect(new Set(ids(orphans.body))).toEqual(new Set(mine));
    expect((orphans.body as Note[]).every((n) => n.workspace === null && validateNote(n).ok)).toBe(true);
    expect(ids((await call("GET", noteRoutes.list("other"))).body)).toEqual([]);
    const [first, second] = mine;
    const kept = await call("PUT", noteRoutes.update("other", first ?? ""), { body: { body: "orphan, edited" } });
    expect(kept).toMatchObject({ status: 200, body: { id: first, workspace: null, body: "orphan, edited" } });
    expect((await call("DELETE", noteRoutes.remove("other", second ?? ""))).status).toBe(204);
    expect(rowCount()).toBe(mine.length - 1);
    expect(git(repo, "--no-optional-locks", "status", "--porcelain")).toBe("");
    expect(treeHash(repo)).toBe(baseline);
  });

  test("store: the served app answers the notes routes through the CLI's API chain", async () => {
    const env = { XDG_DATA_HOME: mkdtempSync(join(root, "xdg-")) };
    const index = join(root, "index.html");
    writeFileSync(index, "<!doctype html><title>spectant</title>");
    const manifest: EmbeddedManifest = { generatedAt: "2026-09-29T10:00:00.000Z", assets: [{ ...embeddedAssetFor("index.html"), file: index }], index };
    const lines: string[] = [];
    const log = spyOn(console, "log").mockImplementation((...args: unknown[]) => void lines.push(args.join(" ")));
    const stop = new AbortController();
    try {
      expect(await run(["add", repo], manifest, { env })).toBe(0);
      const done = run(["--port", "0", "--no-browser"], manifest, { env, signal: stop.signal });
      const deadline = Date.now() + 5_000;
      let url = "";
      while (url === "") {
        url = /^spectant · (http:\/\/127\.0\.0\.1:\d+)$/.exec(lines.find((l) => l.startsWith("spectant · ")) ?? "")?.[1] ?? "";
        if (Date.now() > deadline) throw new Error(`no URL line: ${lines.join(" | ")}`);
        if (url === "") await Bun.sleep(5);
      }
      const posted = await fetch(`${url}${noteRoutes.create(WS)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ anchor: { kind: "task", spec: "002", id: "T96" }, body: "served" }),
      });
      expect(posted.status).toBe(201);
      const listed = (await (await fetch(`${url}${noteRoutes.list(WS, { spec: "002", task: "T96" })}`)).json()) as Note[];
      expect(listed.map((n) => n.body)).toEqual(["served"]);
      expect((await fetch(`${url}${noteRoutes.counts(WS, "002")}`)).status).toBe(200);
      stop.abort();
      expect(await done).toBe(0);
    } finally {
      stop.abort();
      log.mockRestore();
    }
    expect(git(repo, "--no-optional-locks", "status", "--porcelain")).toBe("");
    expect(treeHash(repo)).toBe(baseline);
  });
});

// ─── The CLI over a data directory of its own (T97, T98, T99) ────────────────────────────────────────────────────

type Env = { XDG_DATA_HOME: string };
type CliRun = { code: number; out: string[]; err: string[] };

function testManifest(): EmbeddedManifest {
  const index = join(root, "index.html");
  writeFileSync(index, "<!doctype html><title>spectant</title>");
  return { generatedAt: "2026-09-29T10:00:00.000Z", assets: [{ ...embeddedAssetFor("index.html"), file: index }], index };
}

const freshEnv = (tag: string): Env => ({ XDG_DATA_HOME: mkdtempSync(join(root, `xdg-${tag}-`)) });

/** One CLI command that returns at once (not `serve`), with stdout and stderr captured line by line. */
async function cli(argv: string[], env: Env): Promise<CliRun> {
  const out: string[] = [];
  const err: string[] = [];
  const log = spyOn(console, "log").mockImplementation((...args: unknown[]) => void out.push(args.join(" ")));
  const error = spyOn(console, "error").mockImplementation((...args: unknown[]) => void err.push(args.join(" ")));
  try {
    return { code: await run(argv, testManifest(), { env, cwd: root }), out, err };
  } finally {
    log.mockRestore();
    error.mockRestore();
  }
}

/** `spectant --port 0 --no-browser` on `env`'s data directory until `stop()`, which resolves once the server is down. */
async function serve(env: Env): Promise<{ url: string; stop: () => Promise<number> }> {
  const lines: string[] = [];
  const log = spyOn(console, "log").mockImplementation((...args: unknown[]) => void lines.push(args.join(" ")));
  const abort = new AbortController();
  const done = run(["--port", "0", "--no-browser"], testManifest(), { env, signal: abort.signal });
  try {
    const deadline = Date.now() + 5_000;
    for (;;) {
      const url = /^spectant · (http:\/\/127\.0\.0\.1:\d+)$/.exec(lines.find((l) => l.startsWith("spectant · ")) ?? "")?.[1];
      if (url !== undefined) return { url, stop: () => (abort.abort(), done) };
      if (Date.now() > deadline) throw new Error(`no URL line: ${lines.join(" | ")}`);
      await Bun.sleep(5);
    }
  } finally {
    log.mockRestore();
  }
}

/** Every note in `env`'s data directory, orphans included, read straight from `spectant.db`. */
function notesIn(env: Env): Note[] {
  const database = openDatabase(join(env.XDG_DATA_HOME, "spectant"));
  try {
    return openNotes(database).all();
  } finally {
    database.close();
  }
}

const send = (url: string, method: string, body: unknown): Promise<Response> =>
  fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

describe("notes persist", () => {
  test("persist: a note created, edited and pinned in the app is unchanged after the app restarts", async () => {
    const env = freshEnv("persist");
    expect((await cli(["add", repo], env)).code).toBe(0);
    const anchor = { kind: "claim", spec: "002", id: "ISC-52" };
    const first = await serve(env);
    let before = "";
    let id = "";
    try {
      const created = await send(`${first.url}${noteRoutes.create(WS)}`, "POST", { anchor, title: "Persist", body: "first draft" });
      expect(created.status).toBe(201);
      const note = (await created.json()) as Note;
      expect(note.pinned).toBe(false);
      id = note.id;
      const edited = await send(`${first.url}${noteRoutes.update(WS, id)}`, "PUT", { anchor, title: "Persist", body: "edited draft" });
      expect(edited.status).toBe(200);
      const pinned = await send(`${first.url}${noteRoutes.update(WS, id)}`, "PUT", { anchor, title: "Persist", body: "edited draft", pinned: true });
      expect(pinned.status).toBe(200);
      expect((await pinned.json()) as Note).toMatchObject({ id, body: "edited draft", pinned: true, created: note.created });
      expect((await send(`${first.url}${noteRoutes.create(WS)}`, "POST", { body: "left unpinned" })).status).toBe(201);
      before = await (await fetch(`${first.url}${noteRoutes.list(WS)}`)).text();
    } finally {
      expect(await first.stop()).toBe(0);
    }
    const listed = JSON.parse(before) as Note[];
    expect(listed.map((n) => [n.body, n.pinned])).toEqual([
      ["left unpinned", false],
      ["edited draft", true],
    ]);
    expect(listed.every((n) => validateNote(n).ok)).toBe(true);

    const second = await serve(env);
    try {
      expect(await (await fetch(`${second.url}${noteRoutes.list(WS)}`)).text()).toBe(before);
      // A PUT that leaves `pinned` out keeps the pin; a non-boolean pin is refused before the database is touched.
      const kept = await send(`${second.url}${noteRoutes.update(WS, id)}`, "PUT", { anchor, title: "Persist", body: "edited again" });
      expect(((await kept.json()) as Note).pinned).toBe(true);
      const bad = await send(`${second.url}${noteRoutes.update(WS, id)}`, "PUT", { body: "x", pinned: "yes" });
      expect({ status: bad.status, body: await bad.json() }).toEqual({ status: 400, body: { error: "invalid-body" } });
    } finally {
      expect(await second.stop()).toBe(0);
    }
    expect(treeHash(repo)).toBe(baseline);
  });
});

const EXPORT_FIXTURE = join(import.meta.dir, "fixtures", "notes-export.json");
type OldNote = { id: string; body: string; title?: string; created?: string; updated?: string };

describe("notes import", () => {
  const env = {} as Env;
  const oldNotes = (JSON.parse(readFileSync(EXPORT_FIXTURE, "utf8")) as { notes: OldNote[] }).notes;
  const byBody = (body: string): Note | undefined => notesIn(env).find((n) => n.body === body);

  beforeAll(async () => {
    Object.assign(env, freshEnv("import"));
    expect((await cli(["add", repo], env)).code).toBe(0);
  });

  test("import: import-notes imports the old notes page's export with the same number of notes", async () => {
    expect(await cli(["import-notes", EXPORT_FIXTURE], env)).toEqual({ code: 0, out: ["imported 3, skipped 0"], err: [] });
    expect(notesIn(env).length).toBe(oldNotes.length);
  });

  test("import: repo, spec, ref and pinned map to workspace, anchor and pin; title and times are kept", () => {
    const [index, loose, probe] = oldNotes.map((old) => byBody(old.body));
    expect(index).toMatchObject({ workspace: WS, anchor: { kind: "spec", spec: "002" }, title: "Covering index", pinned: false });
    expect(index).toMatchObject({ created: oldNotes[0]?.created, updated: oldNotes[0]?.updated });
    expect(loose).toMatchObject({ workspace: null, anchor: null, title: "", pinned: false });
    expect(probe).toMatchObject({ workspace: null, anchor: { kind: "claim", spec: "002", id: "ISC-52" }, pinned: true });
    expect(notesIn(env).every((n) => validateNote(n).ok)).toBe(true);
  });

  test("import: a second run skips every note by its old id", async () => {
    expect(await cli(["import-notes", EXPORT_FIXTURE], env)).toMatchObject({ code: 0, out: ["imported 0, skipped 3"] });
    expect(notesIn(env).length).toBe(oldNotes.length);
  });

  test("import: a bare array, the repo's specs folder as repo, a task ref, an unknown ref and a blank body", async () => {
    const file = join(env.XDG_DATA_HOME, "array.json");
    const at = "2026-09-06T12:00:00.000Z";
    writeFileSync(
      file,
      JSON.stringify([
        { id: "old-task", title: "Task", body: "on a task", repo: join(repo, "specs"), spec: "002-notes", ref: "T97", created: at, updated: at },
        { id: "old-blank", title: "Blank", body: "   ", repo: null, spec: null, created: at, updated: at },
        { id: "old-odd", title: "", body: "odd ref", repo, spec: "notes", ref: "whatever", created: at, updated: at },
      ]),
    );
    const res = await cli(["import-notes", file], env);
    expect(res).toMatchObject({ code: 0, out: ["imported 2, skipped 1"] });
    expect(res.err.join("\n")).toContain("old-blank");
    expect(byBody("on a task")).toMatchObject({ workspace: WS, anchor: { kind: "task", spec: "002", id: "T97" } });
    expect(byBody("odd ref")).toMatchObject({ workspace: WS, anchor: null });
  });

  test("import: export-notes writes the old shape without a path, and importing it into a fresh data directory is lossless", async () => {
    const file = join(env.XDG_DATA_HOME, "export.json");
    const all = notesIn(env);
    expect(await cli(["export-notes", file], env)).toMatchObject({ code: 0, out: [`exported ${all.length}`] });
    const text = readFileSync(file, "utf8");
    expect(text).not.toContain(root);
    const exported = JSON.parse(text) as { v: number; notes: Array<Record<string, unknown>> };
    expect(exported.v).toBe(1);
    expect(exported.notes.map((n) => n.id).sort()).toEqual(all.map((n) => n.id).sort());
    for (const key of ["id", "title", "body", "repo", "spec", "created", "updated"]) expect(exported.notes.every((n) => key in n)).toBe(true);

    const copy = freshEnv("import-copy");
    expect((await cli(["add", repo], copy)).code).toBe(0);
    expect(await cli(["import-notes", file], copy)).toMatchObject({ code: 0, out: [`imported ${all.length}, skipped 0`] });
    expect(notesIn(copy)).toEqual(all);
  });

  test("import: usage errors exit 2; a missing or foreign file exits 1 and imports nothing", async () => {
    const before = notesIn(env).length;
    expect((await cli(["import-notes"], env)).code).toBe(2);
    expect((await cli(["export-notes"], env)).code).toBe(2);
    expect((await cli(["import-notes", "a.json", "b.json"], env)).code).toBe(2);
    expect((await cli(["import-notes", "--yes", EXPORT_FIXTURE], env)).code).toBe(2);
    expect((await cli(["import-notes", join(env.XDG_DATA_HOME, "missing.json")], env)).code).toBe(1);
    for (const [name, content] of [["object.json", "{}"], ["newer.json", '{"v":2,"notes":[]}'], ["broken.json", "{not json"]] as const) {
      const file = join(env.XDG_DATA_HOME, name);
      writeFileSync(file, content);
      const res = await cli(["import-notes", file], env);
      expect(res.code).toBe(1);
      expect(res.err.length).toBeGreaterThan(0);
    }
    expect(notesIn(env).length).toBe(before);
  });
});

describe("notes db rollback", () => {
  test("rollback: db rollback needs --yes, reverses the newest migrations and exits 2 on an unknown target", async () => {
    const env = freshEnv("rollback");
    expect(await cli(["import-notes", EXPORT_FIXTURE], env)).toMatchObject({ code: 0 });
    const refused = await cli(["db", "rollback", "2"], env);
    expect(refused.code).toBe(1);
    expect(refused.err.join("\n")).toContain("--yes");
    expect(schemaVersion(openDatabaseUnmigratedFor(env))).toBe(3);
    for (const argv of [["db"], ["db", "rollback"], ["db", "rollback", "0"], ["db", "rollback", "3"], ["db", "rollback", "x", "--yes"], ["db", "migrate"], ["list", "--yes"]]) {
      expect((await cli(argv, env)).code).toBe(2);
    }
    expect(await cli(["db", "rollback", "2", "--yes"], env)).toMatchObject({ code: 0, out: ["schema version 3 → 2"] });
    expect(schemaVersion(openDatabaseUnmigratedFor(env))).toBe(2);
    expect(await cli(["db", "rollback", "1", "--yes"], env)).toMatchObject({ code: 0, out: ["schema version 2 → 1"] });
    expect(schemaVersion(openDatabaseUnmigratedFor(env))).toBe(1);
  });
});

const unmigrated: Database[] = [];
afterAll(() => {
  for (const database of unmigrated.splice(0)) database.close();
});

function openDatabaseUnmigratedFor(env: Env): Database {
  const database = openDatabaseUnmigrated(join(env.XDG_DATA_HOME, "spectant"));
  unmigrated.push(database);
  return database;
}

// The two writes (spec 002 T68 to T70; ISC-24, ISC-25, ISC-26, ISC-27, ISC-86): `server/src/writes.ts` under the gate
// route and the checkbox route, driven through `specRoutesApi` against a temp copy of harbor the way a client drives
// them: render (GET, which carries the hash header), then POST the hash it rendered.
//
// One describe per probe name (`bun test tests/writes.test.ts -t "<name>"`):
//   reviewed   — the mark in the old skill's byte format plus exactly one `review → build` event (ISC-24)
//   checkbox   — exactly one task line of tasks.md changes, line endings kept (ISC-25)
//   cas        — a hash that no longer matches is 409 and the file stays byte-identical (ISC-26)
//   claim lock — an open claim in `.spectant/activity.jsonl` refuses the write with 423 (ISC-27)
//   frontier   — a LifeOS frontier lock is a 423; with no lock source the write proceeds under the hash check and the
//                answer says so (ISC-86)
//
// harbor's activity log leaves ISC-74 of spec 002 claimed (task T27). A test that wants an accepted write on 002
// removes the log; spec 004 (claims ISC-95 and up) is never held by it.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateEventLine } from "../core/src/events.ts";
import { readGateMark, reviewedGate } from "../core/src/gates.ts";
import { LIFEOS_ABSENT } from "../server/src/lifeos.ts";
import { type Registry, openRegistry } from "../server/src/registry.ts";
import { REVIEWED_HASHES_HEADER, type ReviewedHashes, TASKS_HASH_HEADER, parseReviewedHashes, specRoutes } from "../server/src/spec-routes.contract.ts";
import { specRoutesApi } from "../server/src/spec-routes.ts";
import { readSpecFiles } from "../server/src/workspace-loader.ts";
import { NO_AGENT_SOURCE, REVIEWED_EVENT, WRITE_ACTOR, hasAgentSource, reviewedMarkText, writeAnswerOf } from "../server/src/writes.contract.ts";
import type { ApiHandler } from "../server/src/http.ts";

const HARBOR = join(import.meta.dir, "..", "core", "fixtures", "harbor");
const HOST = { Host: "127.0.0.1:7717" };
const WEB = "specs/002-web-console";
const RETENTION = "specs/004-retention-policies";
const LOADER = "specs/003-config-loader";
const ISC_74_LOCK = { source: "activity", claim: "ISC-74", session: "spec-002-ISC-74", since: "2026-03-08T14:06:00Z" } as const;

let root: string;
const registries: Registry[] = [];

beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "spectant-writes-")));
});

afterAll(() => {
  for (const registry of registries.splice(0)) registry.close();
  rmSync(root, { recursive: true, force: true });
});

type Setup = { repo: string; api: ApiHandler };

/**
 * A fresh copy of harbor registered as `harbor`. `activity: false` removes its activity log; `frontier` names the
 * claims a LifeOS state directory holds fresh frontier locks on (the directory is then passed as `lifeos`).
 */
function setup(options: { activity?: boolean; frontier?: readonly string[] } = {}): Setup {
  const repo = join(mkdtempSync(join(root, "repo-")), "harbor");
  cpSync(HARBOR, repo, { recursive: true });
  if (options.activity === false) rmSync(join(repo, ".spectant"), { recursive: true, force: true });
  let lifeos = LIFEOS_ABSENT as { readonly present: boolean; readonly stateDir: string | null };
  if (options.frontier !== undefined) {
    const state = mkdtempSync(join(root, "state-"));
    const isa = join(repo, "ISA.md");
    const dir = join(state, "isa-locks", createHash("sha1").update(realpathSync(isa)).digest("hex").slice(0, 16));
    mkdirSync(dir, { recursive: true });
    const ts = new Date(Date.now() - 60_000).toISOString();
    for (const claim of options.frontier) writeFileSync(join(dir, `${claim}.lock`), `${JSON.stringify({ session: `frontier-${claim}`, ts, isa })}\n`);
    lifeos = { present: true, stateDir: state };
  }
  const registry = openRegistry(mkdtempSync(join(root, "data-")));
  registries.push(registry);
  registry.add(repo);
  return { repo, api: specRoutesApi({ registry, lifeos: lifeos as typeof LIFEOS_ABSENT }) };
}

async function call(api: ApiHandler, path: string, init: { method?: string; body?: string } = {}): Promise<Response> {
  const url = new URL(`http://127.0.0.1:7717${path}`);
  const req = new Request(url.href, {
    method: init.method ?? "GET",
    headers: { ...HOST, "Content-Type": "application/json" },
    ...(init.body === undefined ? {} : { body: init.body }),
  });
  const res = await api(req, url);
  if (res === null) throw new Error(`the spec routes declined ${path}`);
  return res;
}

const post = (api: ApiHandler, path: string, body: unknown): Promise<Response> =>
  call(api, path, { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) });

/** The hashes the spec page was rendered with (its `X-Spectant-Reviewed-Hashes`). */
async function renderedHashes(api: ApiHandler, id: string): Promise<ReviewedHashes> {
  const res = await call(api, specRoutes.spec("harbor", id));
  expect(res.status).toBe(200);
  const hashes = parseReviewedHashes(res.headers.get(REVIEWED_HASHES_HEADER));
  if (hashes === null) throw new Error("no reviewed hashes header");
  return hashes;
}

/** The raw tasks.md hash the Tasks tab was rendered with (its `X-Spectant-Tasks-Hash`). */
async function renderedTasksHash(api: ApiHandler, id: string): Promise<string> {
  const res = await call(api, specRoutes.tasks("harbor", id));
  expect(res.status).toBe(200);
  return res.headers.get(TASKS_HASH_HEADER) ?? "";
}

const sha256 = (bytes: Uint8Array | string): string => createHash("sha256").update(bytes).digest("hex");

/** Every file below `dir`, relative, with the sha256 of its bytes; directories as `dir`. */
function tree(dir: string, prefix = "", out = new Map<string, string>()): Map<string, string> {
  for (const name of readdirSync(dir)) {
    const path = prefix === "" ? name : `${prefix}/${name}`;
    const absolute = join(dir, name);
    if (statSync(absolute).isDirectory()) {
      out.set(path, "dir");
      tree(absolute, path, out);
    } else {
      out.set(path, sha256(readFileSync(absolute)));
    }
  }
  return out;
}

function changed(before: Map<string, string>, after: Map<string, string>): string[] {
  return [...new Set([...before.keys(), ...after.keys()])].sort().filter((p) => before.get(p) !== after.get(p));
}

const lines = (text: string): string[] => text.split("\n");

describe("ISC-24 reviewed: the mark in the old skill's format plus exactly one review → build event", () => {
  test("marking 002 writes .gates/reviewed.json as reviewedMarkText of the server's hashes and appends one event", async () => {
    const { repo, api } = setup({ activity: false });
    const hashes = await renderedHashes(api, "002");
    const before = tree(repo);
    const res = await post(api, specRoutes.gateReviewed("harbor", "002"), { hashes });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { at: string; hashes: ReviewedHashes; lockSource: string; event: Record<string, unknown> };
    expect(writeAnswerOf("gateReviewed", 200, body)).not.toBeNull();
    expect(body.hashes).toEqual(hashes);

    const mark = readFileSync(join(repo, WEB, ".gates", "reviewed.json"), "utf8");
    expect(mark).toBe(reviewedMarkText(body.at, hashes));
    expect(JSON.parse(mark)).toEqual({ gate: "reviewed", at: body.at, files: { "spec.md": hashes.spec, "plan.md": hashes.plan, "tasks.md": hashes.tasks } });
    expect(readGateMark("reviewed", mark).mark?.gate).toBe("reviewed");
    expect(reviewedGate(readSpecFiles({ dir: join(repo, WEB), slug: "002-web-console" }).texts).check.state).toBe("fresh");

    const events = readFileSync(join(repo, WEB, "events.jsonl"), "utf8");
    expect(lines(events.trimEnd())).toHaveLength(1);
    expect(validateEventLine(events.trimEnd()).ok).toBe(true);
    expect(JSON.parse(events)).toEqual(body.event);
    expect(body.event).toMatchObject({ ts: body.at, ...REVIEWED_EVENT, actor: WRITE_ACTOR });

    expect(changed(before, tree(repo))).toEqual([`${WEB}/.gates/reviewed.json`, `${WEB}/events.jsonl`]);
  });

  test("an existing events.jsonl gets one more line, never fused with its last one; .gates/ is created where missing", async () => {
    const { repo, api } = setup({ activity: false });
    const existing = '{"ts":"2026-03-01T10:00:00Z","from":"tasks","to":"review","command":"/spec-tasks","actor":"agent"}';
    writeFileSync(join(repo, LOADER, "events.jsonl"), existing); // no trailing newline
    expect(existsSync(join(repo, LOADER, ".gates"))).toBe(false);
    const hashes = await renderedHashes(api, "003");
    expect(hashes.tasks).toBeNull();
    const before = tree(repo);
    const res = await post(api, specRoutes.gateReviewed("harbor", "003"), { hashes });
    expect(res.status).toBe(200);

    const events = lines(readFileSync(join(repo, LOADER, "events.jsonl"), "utf8").trimEnd());
    expect(events).toHaveLength(2);
    expect(events[0]).toBe(existing);
    for (const line of events) expect(validateEventLine(line).ok).toBe(true);
    const mark = JSON.parse(readFileSync(join(repo, LOADER, ".gates", "reviewed.json"), "utf8")) as { files: Record<string, string | null> };
    expect(mark.files["tasks.md"]).toBeNull();
    expect(changed(before, tree(repo))).toEqual([`${LOADER}/.gates`, `${LOADER}/.gates/reviewed.json`, `${LOADER}/events.jsonl`]);
  });
});

describe("ISC-25 checkbox: exactly that task's line of tasks.md changes and nothing else", () => {
  test("ticking T28 of 002 flips its box and leaves every other line as it was", async () => {
    const { repo, api } = setup({ activity: false });
    const file = join(repo, WEB, "tasks.md");
    const before = readFileSync(file, "utf8");
    const beforeTree = tree(repo);
    const hash = await renderedTasksHash(api, "002");
    expect(hash).toBe(sha256(before));

    const res = await post(api, specRoutes.taskCheck("harbor", "002", "T28"), { checked: true, hash });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { task: string; checked: boolean; hash: string; lockSource: string; line: { number: number; text: string } };
    expect(writeAnswerOf("taskCheck", 200, body)).not.toBeNull();

    const after = readFileSync(file, "utf8");
    const a = lines(before);
    const b = lines(after);
    expect(b).toHaveLength(a.length);
    const diff = a.map((line, i) => (line === b[i] ? -1 : i)).filter((i) => i >= 0);
    expect(diff).toHaveLength(1);
    const index = diff[0] ?? -1;
    expect(a[index]?.startsWith("- [ ] T28 ")).toBe(true);
    expect(b[index]).toBe(a[index]?.replace("- [ ] T28", "- [x] T28"));
    expect(body).toMatchObject({ task: "T28", checked: true, hash: sha256(after), lockSource: "none", line: { number: index + 1, text: b[index] } });
    expect(await renderedTasksHash(api, "002")).toBe(body.hash);
    expect(changed(beforeTree, tree(repo))).toEqual([`${WEB}/tasks.md`]);
  });

  test("CRLF endings are kept: unticking T1 of 004 changes exactly the bytes of its box", async () => {
    const { repo, api } = setup();
    const file = join(repo, RETENTION, "tasks.md");
    writeFileSync(file, readFileSync(file, "utf8").replace(/\n/g, "\r\n"));
    const before = readFileSync(file, "utf8");
    const hash = await renderedTasksHash(api, "004");
    const res = await post(api, specRoutes.taskCheck("harbor", "004", "T1"), { checked: false, hash });
    expect(res.status).toBe(200);
    const after = readFileSync(file, "utf8");
    expect(after).toBe(before.replace("- [x] T1 ·", "- [ ] T1 ·"));
    expect(after.split("\r\n")).toHaveLength(before.split("\r\n").length);
    const body = (await res.json()) as { line: { text: string } };
    expect(body.line.text.startsWith("- [ ] T1 ·")).toBe(true);
    expect(body.line.text.includes("\r")).toBe(false);
  });

  test("a tick to the state the box already holds is a 200 with the unchanged line and no write", async () => {
    const { repo, api } = setup({ activity: false });
    const file = join(repo, WEB, "tasks.md");
    const bytes = readFileSync(file);
    const mtime = statSync(file).mtimeMs;
    const hash = await renderedTasksHash(api, "002");
    const res = await post(api, specRoutes.taskCheck("harbor", "002", "T1"), { checked: true, hash });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { hash: string; checked: boolean; line: { text: string } };
    expect(body.hash).toBe(hash);
    expect(body.checked).toBe(true);
    expect(body.line.text.startsWith("- [x] T1 ")).toBe(true);
    expect(readFileSync(file).equals(bytes)).toBe(true);
    expect(statSync(file).mtimeMs).toBe(mtime);
  });

  test("an unknown task is a 404, a body that is no request a 400, and nothing is written", async () => {
    const { repo, api } = setup({ activity: false });
    const before = tree(repo);
    const hash = await renderedTasksHash(api, "002");
    expect((await post(api, specRoutes.taskCheck("harbor", "002", "T999"), { checked: true, hash })).status).toBe(404);
    expect((await post(api, specRoutes.taskCheck("harbor", "003", "T1"), { checked: true, hash })).status).toBe(404);
    for (const bad of ["not json", { checked: "yes", hash }, { checked: true, hash: "abc" }]) {
      const res = await post(api, specRoutes.taskCheck("harbor", "002", "T28"), bad);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid-body" });
    }
    expect((await post(api, specRoutes.gateReviewed("harbor", "002"), { hashes: { spec: null } })).status).toBe(400);
    expect(changed(before, tree(repo))).toEqual([]);
  });
});

describe("ISC-26 cas: a hash that no longer matches is 409 and the file stays byte-identical", () => {
  test("gate: plan.md edited after render names plan.md, sends the hashes now, and writes nothing", async () => {
    const { repo, api } = setup({ activity: false });
    const rendered = await renderedHashes(api, "002");
    appendFileSync(join(repo, WEB, "plan.md"), "\nOne more paragraph written after the page was rendered.\n");
    const before = tree(repo);
    const res = await post(api, specRoutes.gateReviewed("harbor", "002"), { hashes: rendered });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; files: string[]; expected: ReviewedHashes };
    expect(writeAnswerOf("gateReviewed", 409, body)).not.toBeNull();
    expect(body.files).toEqual(["plan.md"]);
    expect(body.expected).toEqual(await renderedHashes(api, "002"));
    expect(changed(before, tree(repo))).toEqual([]);
  });

  test("checkbox: tasks.md ticked on disk after render is 409 with its raw hash now, and stays byte-identical", async () => {
    const { repo, api } = setup({ activity: false });
    const file = join(repo, WEB, "tasks.md");
    const rendered = await renderedTasksHash(api, "002");
    writeFileSync(file, readFileSync(file, "utf8").replace("- [ ] T28 ", "- [x] T28 "));
    const bytes = readFileSync(file);
    const before = tree(repo);
    const res = await post(api, specRoutes.taskCheck("harbor", "002", "T29"), { checked: true, hash: rendered });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; files: string[]; expected: { tasks: string } };
    expect(writeAnswerOf("taskCheck", 409, body)).not.toBeNull();
    expect(body).toEqual({ error: "hash-mismatch", files: ["tasks.md"], expected: { tasks: sha256(bytes) } });
    expect(readFileSync(file).equals(bytes)).toBe(true);
    expect(changed(before, tree(repo))).toEqual([]);
  });

  test("a hash that never matched is 409 as well; the accepted write goes in place (same inode, same mode)", async () => {
    const { repo, api } = setup({ activity: false });
    const file = join(repo, WEB, "tasks.md");
    const stale = await post(api, specRoutes.taskCheck("harbor", "002", "T28"), { checked: true, hash: "0".repeat(64) });
    expect(stale.status).toBe(409);
    const { ino, mode } = statSync(file);
    const ok = await post(api, specRoutes.taskCheck("harbor", "002", "T28"), { checked: true, hash: await renderedTasksHash(api, "002") });
    expect(ok.status).toBe(200);
    expect(statSync(file).ino).toBe(ino);
    expect(statSync(file).mode).toBe(mode);
  });
});

describe("ISC-27 claim lock: an open claim in .spectant/activity.jsonl refuses the write", () => {
  test("ticking T27 while ISC-74 is claimed is 423 with that lock; the tree is byte-identical", async () => {
    const { repo, api } = setup();
    const before = tree(repo);
    const res = await post(api, specRoutes.taskCheck("harbor", "002", "T27"), { checked: true, hash: await renderedTasksHash(api, "002") });
    expect(res.status).toBe(423);
    const body = await res.json();
    expect(writeAnswerOf("taskCheck", 423, body)).not.toBeNull();
    expect(body).toEqual({ error: "locked", lock: ISC_74_LOCK });
    expect(changed(before, tree(repo))).toEqual([]);
  });

  test("any open claim on the spec refuses both writes: another task's tick and the reviewed mark", async () => {
    const { repo, api } = setup();
    const before = tree(repo);
    const tick = await post(api, specRoutes.taskCheck("harbor", "002", "T28"), { checked: true, hash: await renderedTasksHash(api, "002") });
    expect([tick.status, await tick.json()]).toEqual([423, { error: "locked", lock: ISC_74_LOCK }]);
    const mark = await post(api, specRoutes.gateReviewed("harbor", "002"), { hashes: await renderedHashes(api, "002") });
    expect([mark.status, await mark.json()]).toEqual([423, { error: "locked", lock: ISC_74_LOCK }]);
    expect(changed(before, tree(repo))).toEqual([]);
  });

  test("a claim on another spec does not hold this one, and a released claim no longer refuses", async () => {
    const { repo, api } = setup();
    const other = await post(api, specRoutes.gateReviewed("harbor", "004"), { hashes: await renderedHashes(api, "004") });
    expect(other.status).toBe(200);
    expect(((await other.json()) as { lockSource: string }).lockSource).toBe("activity");
    appendFileSync(join(repo, ".spectant", "activity.jsonl"), '{"ts":"2026-03-08T16:00:00Z","event":"release","claim":"ISC-74","session":"spec-002-ISC-74"}\n');
    const tick = await post(api, specRoutes.taskCheck("harbor", "002", "T27"), { checked: true, hash: await renderedTasksHash(api, "002") });
    expect(tick.status).toBe(200);
  });
});

describe("ISC-86 frontier: a LifeOS lock is 423; with no lock source the write proceeds under the hash check", () => {
  test("a frontier lock on ISC-96 refuses the tick of T2 and the reviewed mark of 004 with source frontier", async () => {
    const { repo, api } = setup({ activity: false, frontier: ["ISC-96"] });
    const before = tree(repo);
    const tick = await post(api, specRoutes.taskCheck("harbor", "004", "T2"), { checked: false, hash: await renderedTasksHash(api, "004") });
    expect(tick.status).toBe(423);
    const body = (await tick.json()) as { lock: { source: string; claim: string; session: string } };
    expect(body.lock).toMatchObject({ source: "frontier", claim: "ISC-96", session: "frontier-ISC-96" });
    const mark = await post(api, specRoutes.gateReviewed("harbor", "004"), { hashes: await renderedHashes(api, "004") });
    expect(mark.status).toBe(423);
    expect(changed(before, tree(repo))).toEqual([]);
  });

  test("the 423 names the task's own claim first, a frontier lock before an activity one", async () => {
    const { api } = setup({ frontier: ["ISC-95", "ISC-96", "ISC-74"] });
    const hash = await renderedTasksHash(api, "004");
    const own = (await (await post(api, specRoutes.taskCheck("harbor", "004", "T1"), { checked: false, hash })).json()) as { lock: { claim: string } };
    expect(own.lock.claim).toBe("ISC-95");
    const web = (await (await post(api, specRoutes.taskCheck("harbor", "002", "T28"), { checked: true, hash: await renderedTasksHash(api, "002") })).json()) as {
      lock: { claim: string; source: string };
    };
    expect(web.lock).toMatchObject({ claim: "ISC-74", source: "frontier" });
  });

  test("no lock source: both writes answer lockSource none (the page's 'no agent source') and a stale hash is still 409", async () => {
    const { repo, api } = setup({ activity: false });
    const mark = await post(api, specRoutes.gateReviewed("harbor", "004"), { hashes: await renderedHashes(api, "004") });
    expect(mark.status).toBe(200);
    const markBody = (await mark.json()) as { lockSource: "none" };
    expect(markBody.lockSource).toBe("none");
    expect(hasAgentSource(markBody.lockSource)).toBe(false);
    expect(NO_AGENT_SOURCE).toBe("no agent source");
    const tick = await post(api, specRoutes.taskCheck("harbor", "004", "T2"), { checked: false, hash: await renderedTasksHash(api, "004") });
    expect([tick.status, ((await tick.json()) as { lockSource: string }).lockSource]).toEqual([200, "none"]);
    const bytes = readFileSync(join(repo, RETENTION, "tasks.md"));
    const stale = await post(api, specRoutes.taskCheck("harbor", "004", "T3"), { checked: false, hash: sha256("something else") });
    expect(stale.status).toBe(409);
    expect(readFileSync(join(repo, RETENTION, "tasks.md")).equals(bytes)).toBe(true);
  });

  test("a state directory without a lock on the spec is a source: the write proceeds and names frontier", async () => {
    const { api } = setup({ activity: false, frontier: ["ISC-74"] });
    const res = await post(api, specRoutes.taskCheck("harbor", "004", "T2"), { checked: false, hash: await renderedTasksHash(api, "004") });
    expect([res.status, ((await res.json()) as { lockSource: string }).lockSource]).toEqual([200, "frontier"]);
  });
});

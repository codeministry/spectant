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
import { appendFileSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateEventLine } from "../core/src/events.ts";
import { readGateMark, reviewedGate } from "../core/src/gates.ts";
import { LIFEOS_ABSENT } from "../server/src/lifeos.ts";
import { type Registry, openRegistry } from "../server/src/registry.ts";
import { REVIEWED_HASHES_HEADER, type ReviewedHashes, SPEC_HASH_HEADER, TASKS_HASH_HEADER, parseReviewedHashes, specRoutes } from "../server/src/spec-routes.contract.ts";
import { specRoutesApi } from "../server/src/spec-routes.ts";
import { readSpecFiles, readWorkspaceInput } from "../server/src/workspace-loader.ts";
import { buildDashboard } from "../core/src/dashboard.ts";
import { actorIdOf } from "../core/src/actor-id.ts";
import type { WorkflowStage } from "../core/src/files.ts";
import { parseFrontmatter } from "../core/src/frontmatter.ts";
import { allocationOf } from "../core/src/allocate.ts";
import { parseClaims } from "../core/src/claims.ts";
import { readIdeas } from "../core/src/ideas.ts";
import { gateHashes, writeAllocate, writeTransition } from "../server/src/writes.ts";
import {
  NO_AGENT_SOURCE,
  REVIEWED_EVENT,
  VIEWER_ACTOR_FALLBACK,
  WRITE_ACTOR,
  hasAgentSource,
  reviewedMarkText,
  writeAnswerOf,
} from "../server/src/writes.contract.ts";
import type { ApiHandler } from "../server/src/http.ts";
import { SPEC_FOLDER, SPEC_WORKTREE, plantWorktreeRepo } from "./fixtures/worktree-repo.ts";

const HARBOR = join(import.meta.dir, "..", "core", "fixtures", "harbor");
const HOST = { Host: "127.0.0.1:7717" };
const WEB = "specs/002-web-console";
const RETENTION = "specs/004-retention-policies";
const LOADER = "specs/003-config-loader";
const ISC_74_LOCK = { source: "activity", claim: "ISC-74", session: "a:claude:sess-2", actor: { raw: "a:claude:sess-2", kind: "agent", id: "a:claude:sess-2", legacy: false }, since: "2026-03-08T14:06:00Z" } as const;

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

/** A synthetic address (reserved `.test` domain): the viewer of the repository a test turns into one. */
const VIEWER_EMAIL = "viewer@example.test";

/** Runs git in `repo` (the test's own setup, never the server's), with the inherited repository variables dropped. */
function gitIn(repo: string, ...args: string[]): void {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"].includes(key)));
  const run = Bun.spawnSync(["git", "-C", repo, ...args], { env, stdout: "ignore", stderr: "pipe" });
  if (run.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${run.stderr.toString()}`);
}

describe("ISC-24 reviewed: the mark in the old skill's format plus exactly one review → build event", () => {
  test("marking 002 writes .gates/reviewed.json as reviewedMarkText of the server's hashes and appends one event", async () => {
    const { repo, api } = setup({ activity: false });
    const hashes = await renderedHashes(api, "002");
    // Harbor 002 already carries its stage history; the write appends one line after it and keeps it byte for byte.
    const prior = readFileSync(join(repo, WEB, "events.jsonl"), "utf8");
    expect(prior.endsWith("\n")).toBe(true);
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
    expect(events.startsWith(prior)).toBe(true);
    const appended = events.slice(prior.length);
    expect(lines(appended.trimEnd())).toHaveLength(1);
    expect(lines(events.trimEnd())).toHaveLength(lines(prior.trimEnd()).length + 1);
    expect(validateEventLine(appended.trimEnd()).ok).toBe(true);
    expect(JSON.parse(appended)).toEqual(body.event);
    // harbor's copy is no repository of its own, so no git address: the fallback agent id, never the legacy `app` (T80).
    expect(body.event).toMatchObject({ ts: body.at, ...REVIEWED_EVENT, actor: VIEWER_ACTOR_FALLBACK });
    expect(body.event.actor).not.toBe(WRITE_ACTOR);

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

  test("viewer: in a repository with a git address the event names the viewer's u: id (T80, ISC-119)", async () => {
    const { repo, api } = setup({ activity: false });
    gitIn(repo, "init", "-q");
    gitIn(repo, "config", "user.email", VIEWER_EMAIL);
    const hashes = await renderedHashes(api, "002");
    const before = tree(repo);
    const res = await post(api, specRoutes.gateReviewed("harbor", "002"), { hashes });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { event: { actor: string } };
    expect(body.event.actor).toBe(actorIdOf(VIEWER_EMAIL));
    expect(body.event.actor).toMatch(/^u:[0-9a-f]{8}$/);
    expect(writeAnswerOf("gateReviewed", 200, body)).not.toBeNull();
    expect(changed(before, tree(repo))).toEqual([`${WEB}/.gates/reviewed.json`, `${WEB}/events.jsonl`]);
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
    expect(a[index]?.startsWith("- [ ] T28 ")).toBe(true); // single-core: allow — test fixture asserts the one flipped line, no parsing
    expect(b[index]).toBe(a[index]?.replace("- [ ] T28", "- [x] T28")); // single-core: allow — test fixture asserts the one flipped line, no parsing
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
    expect(after).toBe(before.replace("- [x] T1 ·", "- [ ] T1 ·")); // single-core: allow — test fixture asserts the one flipped line, no parsing
    expect(after.split("\r\n")).toHaveLength(before.split("\r\n").length);
    const body = (await res.json()) as { line: { text: string } };
    expect(body.line.text.startsWith("- [ ] T1 ·")).toBe(true); // single-core: allow — test fixture asserts the one flipped line, no parsing
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
    expect(body.line.text.startsWith("- [x] T1 ")).toBe(true); // single-core: allow — test fixture asserts the one flipped line, no parsing
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
    writeFileSync(file, readFileSync(file, "utf8").replace("- [ ] T28 ", "- [x] T28 ")); // single-core: allow — test fixture asserts the one flipped line, no parsing
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
    appendFileSync(join(repo, ".spectant", "activity.jsonl"), '{"ts":"2026-03-08T16:00:00Z","event":"release","claim":"ISC-74","session":"a:claude:sess-2"}\n');
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

// The stage move (spec 008, T82, ISC-121): `writeTransition` driven directly, its route being T83. The client's hash
// is the raw sha256 of spec.md as it read it (`X-Spectant-Spec-Hash` once T83 sends it).
describe("ISC-121 transition: the workflow decides, spec.md and one event line are the only bytes written", () => {
  const NOW = new Date("2026-03-20T10:00:00Z");
  const move = (repo: string, folder: string, to: WorkflowStage, hash?: string) => {
    const dir = join(repo, folder);
    return writeTransition({
      root: repo,
      ref: { dir, slug: folder.split("/").pop() ?? "" },
      stateDir: null,
      now: NOW,
      body: { to, hash: hash ?? sha256(readFileSync(join(dir, "spec.md"))) },
    });
  };

  test("transition accepted: 003 tasks → review sets stage:, creates events.jsonl with one line; exactly those two files differ", async () => {
    const { repo } = setup();
    const spec = join(repo, LOADER, "spec.md");
    const prior = readFileSync(spec, "utf8");
    expect(existsSync(join(repo, LOADER, "events.jsonl"))).toBe(false);
    const before = tree(repo);
    const res = await move(repo, LOADER, "review");
    expect(res.status).toBe(200);
    if (res.status !== 200) return;
    const after = readFileSync(spec, "utf8");
    expect(res.body).toEqual({ from: "tasks", to: "review", hash: sha256(after), event: res.body.event, lockSource: "activity" });
    expect(parseFrontmatter(after).data.stage).toBe("review");
    expect(parseFrontmatter(after).body).toBe(parseFrontmatter(prior).body);
    expect(res.body.event).toEqual({ ts: NOW.toISOString(), from: "tasks", to: "review", command: res.body.event.command, actor: VIEWER_ACTOR_FALLBACK });
    const events = readFileSync(join(repo, LOADER, "events.jsonl"), "utf8");
    expect(events).toBe(`${JSON.stringify(res.body.event)}\n`);
    expect(validateEventLine(events.trimEnd()).ok).toBe(true);
    expect(changed(before, tree(repo))).toEqual([`${LOADER}/events.jsonl`, `${LOADER}/spec.md`]);
  });

  test("transition accepted on a folder with events: 009 build → blocked appends one line after the history", async () => {
    const { repo } = setup();
    const folder = "specs/009-chunked-upload-limits";
    const prior = readFileSync(join(repo, folder, "events.jsonl"), "utf8");
    const before = tree(repo);
    const res = await move(repo, folder, "blocked");
    expect(res.status).toBe(200);
    const events = readFileSync(join(repo, folder, "events.jsonl"), "utf8");
    expect(events.startsWith(prior)).toBe(true);
    expect(lines(events.slice(prior.length).trimEnd())).toHaveLength(1);
    expect(changed(before, tree(repo))).toEqual([`${folder}/events.jsonl`, `${folder}/spec.md`]);
  });

  test("transition stale: a hash that no longer matches is 409 StaleSpec with the current hash, nothing written", async () => {
    const { repo } = setup();
    const current = sha256(readFileSync(join(repo, LOADER, "spec.md")));
    const before = tree(repo);
    const res = await move(repo, LOADER, "review", sha256("an older spec.md"));
    expect(res).toEqual({ status: 409, body: { error: "hash-mismatch", files: ["spec.md"], expected: { spec: current } } });
    expect(changed(before, tree(repo))).toEqual([]);
  });

  test("transition locked: a session holding a claim of 002 is 423, before the workflow is asked, nothing written", async () => {
    const { repo } = setup();
    const before = tree(repo);
    const res = await move(repo, WEB, "blocked");
    expect(res).toEqual({ status: 423, body: { error: "locked", lock: ISC_74_LOCK } });
    expect(changed(before, tree(repo))).toEqual([]);
  });

  test("transition refused: 005 review → build without a fresh reviewed mark is 422 with reason and command, zero bytes changed", async () => {
    const { repo } = setup();
    const before = tree(repo);
    const res = await move(repo, "specs/005-config-format-choice", "build");
    expect(res.status).toBe(422);
    if (res.status !== 422) return;
    expect(res.body.error).toBe("transition-refused");
    expect(res.body.reason).toStartWith("build needs a fresh reviewed mark");
    expect(res.body.command).toBe("/spec review 005");
    expect(changed(before, tree(repo))).toEqual([]);
  });

  // T84 (ISC-130.1), `-t "transition refused"`: a refused drop changes zero bytes of the spec folder and appends zero
  // event lines; the folder is hashed file by file before and after, `events.jsonl` counted by line.
  const eventCount = (dir: string): number => {
    const path = join(dir, "events.jsonl");
    return existsSync(path) ? readFileSync(path, "utf8").split("\n").filter((l) => l.trim() !== "").length : 0;
  };

  test("transition refused: a drop to build without a fresh reviewed mark changes zero bytes and appends zero events", async () => {
    const { repo } = setup({ activity: false });
    const folder = "specs/005-config-format-choice";
    const dir = join(repo, folder);
    expect(reviewedGate(readSpecFiles({ dir, slug: "005-config-format-choice" }).texts).check.state).not.toBe("fresh");
    const before = tree(dir);
    const events = eventCount(dir);
    const res = await move(repo, folder, "build");
    expect(res.status).toBe(422);
    if (res.status !== 422) return;
    expect(res.body).toMatchObject({ error: "transition-refused", command: "/spec review 005" });
    expect(res.body.reason).toStartWith("build needs a fresh reviewed mark");
    expect(changed(before, tree(dir))).toEqual([]);
    expect(eventCount(dir)).toBe(events);
  });

  test("transition refused: a drop to done with an open claim changes zero bytes and appends zero events", async () => {
    // 007 is a chore building under a fresh reviewed mark, whose lane moves build → done. In the copy one of its claims
    // is reopened and the mark renewed over the files as they now stand, so the open claim is the only gate that fails;
    // a history line gives the event count something to keep.
    const { repo } = setup({ activity: false });
    const slug = "007-rotate-mirror-token";
    const folder = `specs/${slug}`;
    const dir = join(repo, folder);
    const spec = join(dir, "spec.md");
    writeFileSync(spec, readFileSync(spec, "utf8").replace("- [x] ISC-127", "- [ ] ISC-127")); // single-core: allow — test setup reopens one fixed claim line in a temp copy, no parsing
    writeFileSync(join(dir, ".gates", "reviewed.json"), reviewedMarkText("2026-03-19T10:00:00.000Z", gateHashes(readSpecFiles({ dir, slug }).texts)));
    writeFileSync(join(dir, "events.jsonl"), `${JSON.stringify({ ts: "2026-03-19T10:00:00.000Z", from: "review", to: "build", command: "/spec-implement 007", actor: VIEWER_ACTOR_FALLBACK })}\n`);
    expect(reviewedGate(readSpecFiles({ dir, slug }).texts).check.state).toBe("fresh");
    const before = tree(dir);
    const events = eventCount(dir);
    expect(events).toBe(1);
    const res = await move(repo, folder, "done");
    expect(res.status).toBe(422);
    if (res.status !== 422) return;
    expect(res.body.error).toBe("transition-refused");
    expect(res.body.reason).toStartWith("done needs every claim closed");
    expect(changed(before, tree(dir))).toEqual([]);
    expect(eventCount(dir)).toBe(events);
  });
});

// T86 (ISC-130.2), `-t allocate`: a story becomes a spec folder. On a harbor copy (no `.git`, so no number from git;
// folders 001 to 009, the highest active one 009) console-audit-log is in the index, registry-webhooks is not.
describe("ISC-130.2 allocate: a story becomes specs/NNN-slug/ with three files, and its story file is removed", () => {
  const NOW = new Date("2026-03-20T10:00:00Z");
  const STORY = "specs/ideas/console-audit-log.md";
  const FOLDER = "specs/010-console-audit-log";
  const SHAPING = "\n## Shaping record\n- Round 1: the audit page lists the newest line first (decided)\n";
  const storyHash = (repo: string, slug = "console-audit-log"): string => sha256(readFileSync(join(repo, "specs", "ideas", `${slug}.md`)));
  const allocate = (repo: string, slug: string, hash?: string) =>
    writeAllocate({ root: repo, slug, stateDir: null, now: NOW, body: { hash: hash ?? storyHash(repo, slug) } });

  test("allocate accepted: 010 is created with context.md, spec.md and events.jsonl from allocationOf; the story file is gone; nothing else differs", async () => {
    const { repo } = setup();
    appendFileSync(join(repo, STORY), SHAPING);
    const storyText = readFileSync(join(repo, STORY), "utf8");
    const ref = readIdeas({ "console-audit-log.md": storyText }).ideas[0];
    if (ref === undefined) throw new Error("the story did not read");
    const before = tree(repo);
    const res = await allocate(repo, "console-audit-log");
    expect(res).toEqual({
      status: 200,
      body: {
        id: "010",
        folder: `${FOLDER}/`,
        files: [`${FOLDER}/context.md`, `${FOLDER}/spec.md`, `${FOLDER}/events.jsonl`],
        removed: STORY,
        lockSource: "activity",
      },
    });
    const planned = allocationOf(ref, storyText, 10, NOW, VIEWER_ACTOR_FALLBACK);
    const spec = readFileSync(join(repo, FOLDER, "spec.md"), "utf8");
    const context = readFileSync(join(repo, FOLDER, "context.md"), "utf8");
    const events = readFileSync(join(repo, FOLDER, "events.jsonl"), "utf8");
    expect([spec, context, events]).toEqual([planned.specText, planned.contextText, `${JSON.stringify(planned.event)}\n`]);
    // The three files parse: the frontmatter through core, zero claims, the shaping record in Round 0, one valid event.
    const fm = parseFrontmatter(spec);
    expect(fm.data).toMatchObject({ slug: "010-console-audit-log", isaFeature: "F2", stage: "plan", phase: "scoping", started: NOW.toISOString() });
    expect(parseClaims(spec).claims).toEqual([]);
    expect(parseFrontmatter(context).present).toBe(true);
    expect(context).toContain("## Round 0 — the story");
    expect(context).toContain(SHAPING.trim());
    const line = validateEventLine(events.trimEnd());
    expect(line.ok && line.event).toMatchObject({ from: null, to: "plan", command: "/spec new console-audit-log", actor: VIEWER_ACTOR_FALLBACK });
    expect(existsSync(join(repo, STORY))).toBe(false);
    // Exactly the new folder, its three files and the removed story; the index (README.md) is not touched.
    expect(changed(before, tree(repo))).toEqual([FOLDER, `${FOLDER}/context.md`, `${FOLDER}/events.jsonl`, `${FOLDER}/spec.md`, STORY]);
  });

  test("allocate numbering: an archived folder and a branch name count; with no lock source the answer says none", async () => {
    const { repo } = setup({ activity: false });
    mkdirSync(join(repo, "specs", "archive", "030-old-mirror"));
    expect((await allocate(repo, "console-audit-log")).body).toMatchObject({ id: "031", folder: "specs/031-console-audit-log/", lockSource: "none" });

    // A repository whose branch names a higher number: one past it, whatever the folders say.
    const branched = setup({ activity: false }).repo;
    gitIn(branched, "init", "-q", "-b", "main");
    gitIn(branched, "-c", "user.name=Spectant Test", "-c", `user.email=${VIEWER_EMAIL}`, "-c", "commit.gpgsign=false", "commit", "-q", "--allow-empty", "-m", "empty");
    gitIn(branched, "branch", "feature/057-tide-tables");
    const res = await allocate(branched, "console-audit-log");
    expect(res.body).toMatchObject({ id: "058", folder: "specs/058-console-audit-log/" });
    expect(existsSync(join(branched, "specs", "058-console-audit-log", "spec.md"))).toBe(true);
  });

  test("allocate stale: a story changed since render is 409 StaleIdea with its path and raw hash now, nothing written", async () => {
    const { repo } = setup();
    const before = tree(repo);
    const res = await allocate(repo, "console-audit-log", sha256("an older story"));
    expect(res).toEqual({ status: 409, body: { error: "hash-mismatch", files: [STORY], expected: { idea: storyHash(repo) } } });
    expect(changed(before, tree(repo))).toEqual([]);
  });

  test("allocate refused: a story the index does not name is 422 not-in-index, nothing written", async () => {
    const { repo } = setup();
    const before = tree(repo);
    const res = await allocate(repo, "registry-webhooks");
    expect(res).toEqual({ status: 422, body: { error: "allocate-refused", reason: "not-in-index", folder: "specs/010-registry-webhooks/" } });
    expect(changed(before, tree(repo))).toEqual([]);
  });

  test("allocate refused: a path already at the folder's name is 422 folder-exists, nothing written", async () => {
    // A plain file is no spec folder, so it takes no number; the folder the next number names is then occupied.
    const { repo } = setup();
    writeFileSync(join(repo, FOLDER), "not a folder\n");
    const before = tree(repo);
    const res = await allocate(repo, "console-audit-log");
    expect(res).toEqual({ status: 422, body: { error: "allocate-refused", reason: "folder-exists", folder: `${FOLDER}/` } });
    expect(changed(before, tree(repo))).toEqual([]);
  });

  test("allocate unknown: a slug that names no story is 404, nothing written", async () => {
    const { repo } = setup();
    const before = tree(repo);
    for (const slug of ["tide-tables", "README", "../ideas/console-audit-log", ""]) {
      expect({ slug, res: await allocate(repo, slug, "0".repeat(64)) }).toEqual({ slug, res: { status: 404, body: { error: "not-found" } } });
    }
    expect(changed(before, tree(repo))).toEqual([]);
  });

  test("allocate viewer: in a repository with a git address the creation event names the viewer's u: id", async () => {
    const { repo } = setup();
    gitIn(repo, "init", "-q", "-b", "main");
    gitIn(repo, "config", "user.email", VIEWER_EMAIL);
    const res = await allocate(repo, "console-audit-log");
    expect(res.status).toBe(200);
    const events = readFileSync(join(repo, FOLDER, "events.jsonl"), "utf8");
    expect(JSON.parse(events.trimEnd())).toMatchObject({ actor: actorIdOf(VIEWER_EMAIL) });
  });
});

// Spec 027 (T22, ISC-181): with `specs/` tracked and a worktree of its own, spec 002 is read from the worktree copy
// (T21), so every hash the client renders is the copy's; the reviewed mark, the tick and the stage move then read,
// compare against and write that same copy, and the main checkout stays byte-identical. The fixture's `.spectant/` (an
// ignored folder there) is removed, so no claim holds 002. The allocation is not here: it always targets the main
// checkout (`allocate-route.ts`).
describe("ISC-181 worktree-copy: the reviewed mark, the tick and the stage move follow the spec's read source", () => {
  const WEB_ID = "002";
  type Planted = { root: string; api: ApiHandler; main: string; copy: string; git: (cwd: string, ...args: string[]) => Promise<{ code: number }> };

  /** The worktree fixture registered as `harbor`, without an activity log; `main` and `copy` are 002's two folders. */
  async function plantCopy(trackedSpecs: boolean): Promise<Planted> {
    const planted = await plantWorktreeRepo({ parent: root, trackedSpecs });
    rmSync(join(planted.root, ".spectant"), { recursive: true, force: true });
    const registry = openRegistry(mkdtempSync(join(root, "data-")));
    registries.push(registry);
    registry.add(planted.root);
    return {
      root: planted.root,
      api: specRoutesApi({ registry, lifeos: LIFEOS_ABSENT }),
      main: join(planted.root, "specs", SPEC_FOLDER),
      copy: join(planted.root, SPEC_WORKTREE, "specs", SPEC_FOLDER),
      git: planted.git,
    };
  }

  /** The indices of the lines that differ between two texts of the same line count. */
  const differingLines = (a: string, b: string): number[] => {
    const left = lines(a);
    const right = lines(b);
    expect(right.length).toBe(left.length);
    return left.flatMap((line, i) => (line === right[i] ? [] : [i]));
  };

  const renderedSpecHash = async (api: ApiHandler): Promise<string> => (await call(api, specRoutes.spec("harbor", WEB_ID))).headers.get(SPEC_HASH_HEADER) ?? "";

  test("worktree-copy checkbox: the copy's hash ticks one line of the copy's tasks.md; main's folder is byte-identical", async () => {
    const { api, main, copy } = await plantCopy(true);
    const mainBefore = tree(main);
    const text = readFileSync(join(copy, "tasks.md"), "utf8");
    const hash = await renderedTasksHash(api, WEB_ID);
    expect(hash).toBe(sha256(text));
    expect(hash).not.toBe(sha256(readFileSync(join(main, "tasks.md"))));

    const res = await post(api, specRoutes.taskCheck("harbor", WEB_ID, "T27"), { checked: false, hash });
    expect(res.status).toBe(200);
    const after = readFileSync(join(copy, "tasks.md"), "utf8");
    const changedLines = differingLines(text, after);
    expect(changedLines.length).toBe(1);
    expect(lines(after)[changedLines[0] ?? -1]).toContain("[ ] T27");
    expect(((await res.json()) as { hash: string }).hash).toBe(sha256(after));
    expect(changed(mainBefore, tree(main))).toEqual([]);
  });

  test("worktree-copy reviewed: the mark lands under the copy's .gates/, its event in the copy's events.jsonl; main untouched", async () => {
    const { api, main, copy } = await plantCopy(true);
    const mainBefore = tree(main);
    const copyBefore = tree(copy);
    const events = readFileSync(join(copy, "events.jsonl"), "utf8");
    const hashes = await renderedHashes(api, WEB_ID);
    expect(hashes).toEqual(gateHashes(readSpecFiles({ dir: copy, slug: SPEC_FOLDER }).texts));

    const res = await post(api, specRoutes.gateReviewed("harbor", WEB_ID), { hashes });
    expect(res.status).toBe(200);
    expect(changed(copyBefore, tree(copy))).toEqual([".gates/reviewed.json", "events.jsonl"]);
    expect(reviewedGate(readSpecFiles({ dir: copy, slug: SPEC_FOLDER }).texts).check.state).toBe("fresh");
    const appended = readFileSync(join(copy, "events.jsonl"), "utf8");
    expect(appended.startsWith(events)).toBe(true);
    expect(lines(appended.slice(events.length).trimEnd()).length).toBe(1);
    expect(changed(mainBefore, tree(main))).toEqual([]);
  });

  test("worktree-copy transition: stage: moves in the copy's spec.md, the event in the copy's events.jsonl; main untouched", async () => {
    const { api, main, copy } = await plantCopy(true);
    // The copy stands in code-review, whose one move (to done) needs every claim closed; the round in the worktree is
    // set back to build, which may move to blocked. A move past review needs a fresh reviewed mark of the copy's files.
    const specPath = join(copy, "spec.md");
    const atCodeReview = readFileSync(specPath, "utf8");
    expect(atCodeReview).toMatch(/^stage: code-review$/m);
    writeFileSync(specPath, atCodeReview.replace(/^stage: code-review$/m, "stage: build"));
    expect((await post(api, specRoutes.gateReviewed("harbor", WEB_ID), { hashes: await renderedHashes(api, WEB_ID) })).status).toBe(200);
    const mainBefore = tree(main);
    const copyBefore = tree(copy);
    const hash = await renderedSpecHash(api);
    expect(hash).toBe(sha256(readFileSync(join(copy, "spec.md"))));

    const res = await post(api, specRoutes.transition("harbor", WEB_ID), { to: "blocked", hash });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { from: string; to: string; hash: string };
    expect([body.from, body.to]).toEqual(["build", "blocked"]);
    const spec = readFileSync(specPath, "utf8");
    expect(body.hash).toBe(sha256(spec));
    expect(parseFrontmatter(spec).data.stage).toBe("blocked");
    expect(changed(copyBefore, tree(copy))).toEqual(["events.jsonl", "spec.md"]);
    expect(changed(mainBefore, tree(main))).toEqual([]);
  });

  test("worktree-copy cas: main's hashes against the copy are 409 with files, and nothing anywhere changes", async () => {
    const { root: repo, api, main, copy } = await plantCopy(true);
    const before = tree(repo);
    const tick = await post(api, specRoutes.taskCheck("harbor", WEB_ID, "T27"), { checked: false, hash: sha256(readFileSync(join(main, "tasks.md"))) });
    expect([tick.status, await tick.json()]).toEqual([409, { error: "hash-mismatch", files: ["tasks.md"], expected: { tasks: sha256(readFileSync(join(copy, "tasks.md"))) } }]);
    const move = await post(api, specRoutes.transition("harbor", WEB_ID), { to: "blocked", hash: sha256(readFileSync(join(main, "spec.md"))) });
    expect([move.status, await move.json()]).toEqual([409, { error: "hash-mismatch", files: ["spec.md"], expected: { spec: sha256(readFileSync(join(copy, "spec.md"))) } }]);
    expect(changed(before, tree(repo))).toEqual([]);
  });

  test("worktree-copy source switch: rendered from the copy, the worktree removed before the write, is 409 with files", async () => {
    const { root: repo, api, main, git } = await plantCopy(true);
    const tasksHash = await renderedTasksHash(api, WEB_ID);
    const specHash = await renderedSpecHash(api);
    expect((await git(repo, "worktree", "remove", "--force", SPEC_WORKTREE)).code).toBe(0);
    const mainBefore = tree(main);
    // The source is the main checkout now: the CAS compares the copy's hashes with main's files and refuses.
    const tick = await post(api, specRoutes.taskCheck("harbor", WEB_ID, "T27"), { checked: false, hash: tasksHash });
    expect([tick.status, await tick.json()]).toEqual([409, { error: "hash-mismatch", files: ["tasks.md"], expected: { tasks: sha256(readFileSync(join(main, "tasks.md"))) } }]);
    const move = await post(api, specRoutes.transition("harbor", WEB_ID), { to: "blocked", hash: specHash });
    expect([move.status, await move.json()]).toEqual([409, { error: "hash-mismatch", files: ["spec.md"], expected: { spec: sha256(readFileSync(join(main, "spec.md"))) } }]);
    expect(changed(mainBefore, tree(main))).toEqual([]);
  });

  test("worktree-copy untracked: with specs/ linked into the worktree, the tick lands once, in the main checkout", async () => {
    const { root: repo, api, main } = await plantCopy(false);
    const link = join(repo, SPEC_WORKTREE, "specs");
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    const text = readFileSync(join(main, "tasks.md"), "utf8");
    const hash = await renderedTasksHash(api, WEB_ID);
    expect(hash).toBe(sha256(text));

    const res = await post(api, specRoutes.taskCheck("harbor", WEB_ID, "T27"), { checked: true, hash });
    expect(res.status).toBe(200);
    const after = readFileSync(join(main, "tasks.md"), "utf8");
    const changedLines = differingLines(text, after);
    expect(changedLines.length).toBe(1);
    expect(lines(after)[changedLines[0] ?? -1]).toContain("[x] T27");
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
  });
});

// ISC-162.2 and ISC-162.3 on the stage move (spec 025): the transition derives `from` with the same spec edges the
// dashboard row reads (`resolveEdges` over the workspace and its merge state), so a fully held spec moves from
// `blocked`, a partially held one keeps its stage, and once the blocker is met the hold is gone. On a copy of the edges
// fixture (no git: a target's merge state is read from its frontmatter), 003 and 004 under a fresh reviewed mark.
describe("ISC-162.3 transition edge-aware: the move's from is the row's stage under open spec edges", () => {
  const EDGES = join(import.meta.dir, "..", "core", "fixtures", "edges");
  const NOW = new Date("2026-03-20T10:00:00Z");
  const STOP_SEARCH = "specs/002-stop-search";
  const ROUTE_MAP = "specs/003-route-map";
  const FARE_TABLE = "specs/004-fare-table";

  function plantEdges(): string {
    const repo = mkdtempSync(join(root, "edges-"));
    cpSync(EDGES, repo, { recursive: true });
    for (const folder of [ROUTE_MAP, FARE_TABLE]) {
      const dir = join(repo, folder);
      const slug = folder.split("/").pop() ?? "";
      mkdirSync(join(dir, ".gates"), { recursive: true });
      writeFileSync(join(dir, ".gates", "reviewed.json"), reviewedMarkText("2026-03-19T10:00:00.000Z", gateHashes(readSpecFiles({ dir, slug }).texts)));
    }
    return repo;
  }

  const move = (repo: string, folder: string, to: WorkflowStage) => {
    const dir = join(repo, folder);
    return writeTransition({
      root: repo,
      ref: { dir, slug: folder.split("/").pop() ?? "" },
      stateDir: null,
      now: NOW,
      body: { to, hash: sha256(readFileSync(join(dir, "spec.md"))) },
    });
  };

  /** The dashboard row's stage of `id` over the same workspace reading the transition takes. */
  async function rowStage(repo: string, id: string): Promise<string | undefined> {
    const reading = await readWorkspaceInput(repo, null);
    if (!reading.readable) throw new Error(reading.error);
    return buildDashboard(reading.input).specs.find((r) => r.id === id)?.stage;
  }

  test("edge-held fully: 004 stands on blocked as its row does, so → blocked is refused and → build moves from blocked", async () => {
    const repo = plantEdges();
    expect(await rowStage(repo, "004")).toBe("blocked");
    const before = tree(repo);
    const same = await move(repo, FARE_TABLE, "blocked");
    expect(same.status).toBe(422);
    if (same.status !== 422) return;
    expect(same.body.reason).toBe("the spec already stands in blocked");
    expect(changed(before, tree(repo))).toEqual([]);
    const res = await move(repo, FARE_TABLE, "build");
    expect(res.status).toBe(200);
    if (res.status !== 200) return;
    expect(res.body.from).toBe("blocked");
    expect(res.body.event.from).toBe("blocked");
  });

  test("edge-held partially: 003 keeps build as its row does, so → blocked moves from build", async () => {
    const repo = plantEdges();
    expect(await rowStage(repo, "003")).toBe("build");
    const res = await move(repo, ROUTE_MAP, "blocked");
    expect(res.status).toBe(200);
    if (res.status !== 200) return;
    expect(res.body.from).toBe("build");
  });

  test("edge met: with 002 complete the hold on 004 is gone, its row and its move stand on build", async () => {
    const repo = plantEdges();
    const spec = join(repo, STOP_SEARCH, "spec.md");
    writeFileSync(spec, readFileSync(spec, "utf8").replace(/^phase: .*$/m, "phase: complete")); // single-core: allow — test setup sets one frontmatter line in a temp copy, no parsing
    expect(await rowStage(repo, "004")).toBe("build");
    const res = await move(repo, FARE_TABLE, "blocked");
    expect(res.status).toBe(200);
    if (res.status !== 200) return;
    expect(res.body.from).toBe("build");
  });
});

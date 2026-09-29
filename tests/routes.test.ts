// The spec routes (T45, ISC-71; plan 002 § Interfaces "HTTP"): every read route of `spec-routes.contract.ts` answered
// from the files of a registered workspace, with the JSON conventions of `api.ts` (strong ETag, 304, HEAD, 405 +
// Allow, the loopback guard) and the two hash headers, and 404 without any fallback for what names nothing.
//
// Golden comparison: each 200 body equals the per-spec value of its golden family (`GOLDEN_FAMILY` in the contract,
// `core/fixtures/harbor.<family>.golden.json`), with one explicit difference. The goldens are built without lock
// sources; the routes read the repository's `.spectant/activity.jsonl` (ISC-37), which in harbor leaves ISC-74 of
// spec 002 claimed. The spec page and the claim view therefore differ from their goldens by exactly that lock, the
// same difference `tests/dashboard.test.ts` applies to the dashboard row, so the page and the row agree (ISC-72).
// The live golden is built with that same reading at a fixed clock, which the route gets through its `now` option.
import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { listEvidence } from "../core/src/evidence.ts";
import type { ClaimViewModel, DocName, SpecPageModel } from "../core/src/files.ts";
import { hashForGate } from "../core/src/gates.ts";
import { buildTimeline } from "../core/src/timeline.ts";
import { docsFor } from "../core/src/markdown-docs.ts";
import { composeApi, dashboardApi } from "../server/src/api.ts";
import { type EmbeddedManifest, embeddedAssetFor } from "../server/src/assets.contract.ts";
import { run } from "../server/src/cli.ts";
import { CommitCache, commitsFor } from "../server/src/git.ts";
import type { ApiHandler } from "../server/src/http.ts";
import { LIFEOS_ABSENT } from "../server/src/lifeos.ts";
import { type Registry, openRegistry } from "../server/src/registry.ts";
import {
  DOC_NAMES,
  JSON_ANSWER,
  REVIEWED_HASHES_HEADER,
  SPEC_ROUTE_TABLE,
  type SpecRouteName,
  TASKS_HASH_HEADER,
  allowFor,
  formatReviewedHashes,
  parseReviewedHashes,
  specRoutes,
} from "../server/src/spec-routes.contract.ts";
import { specRoutesApi, timelineEtag } from "../server/src/spec-routes.ts";
import { readSpecFiles } from "../server/src/workspace-loader.ts";

const FIXTURES = join(import.meta.dir, "..", "core", "fixtures");
const HARBOR = join(FIXTURES, "harbor");
const SPEC_DIR = join(HARBOR, "specs", "002-web-console");
const KEY = "specs/002-web-console";
const LANTERN_KEY = "specs/002-duplicate-links";
/** The clock the live golden was built at (core/tests/golden.test.ts `LIVE_NOW`). */
const LIVE_NOW = new Date("2026-03-08T15:00:00Z");
const HOST = { Host: "127.0.0.1:7717" };

const golden = (tree: string, family: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(FIXTURES, `${tree}.${family}.golden.json`), "utf8")) as Record<string, unknown>;

/** The lock ISC-74 carries from harbor's activity log. */
const ISC_74_LOCK = { source: "activity", claim: "ISC-74", session: "spec-002-ISC-74", since: "2026-03-08T14:06:00Z" } as const;

/** harbor 002's spec page golden with the activity lock applied (see the header). */
function expectedSpecPage(): SpecPageModel {
  const page = golden("harbor", "spec")[KEY] as SpecPageModel;
  const reason = "ISC-75, ISC-76 and 1 more are takeable";
  return {
    ...page,
    head: { ...page.head, nextReason: reason },
    keyNumbers: {
      ...page.keyNumbers,
      claims: { ...page.keyNumbers.claims, takeable: page.keyNumbers.claims.takeable - 1 },
      rounds: { ...page.keyNumbers.rounds, agentsWorking: 1 },
    },
    next: { ...page.next, reasons: [reason, ...page.next.reasons.slice(1)] },
    areas: { ...page.areas, live: { ...page.areas.live, lockSource: "activity", agentsWorking: 1, lock: ISC_74_LOCK } },
  };
}

/** harbor 002's claim view golden with ISC-74 taken by the activity lock. */
function expectedClaims(): ClaimViewModel {
  const model = golden("harbor", "claim-view")[KEY] as ClaimViewModel;
  const lock = { source: ISC_74_LOCK.source, session: ISC_74_LOCK.session, since: ISC_74_LOCK.since };
  return {
    ...model,
    claims: model.claims.map((c) => (c.id === "ISC-74" ? { ...c, state: "taken", lock } : c)),
    counts: { ...model.counts, takeable: model.counts.takeable - 1, taken: model.counts.taken + 1 },
  };
}

let root: string;
let twin: string;
const registries: Registry[] = [];

/** A registry in its own data directory with `paths` registered in that order. */
function registryWith(...paths: string[]): Registry {
  const registry = openRegistry(mkdtempSync(join(root, "data-")));
  registries.push(registry);
  for (const path of paths) registry.add(path);
  return registry;
}

let api: ApiHandler;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "spectant-routes-"));
  // A copy of harbor with a second folder numbered 002: the id `002` is then ambiguous there.
  twin = join(root, "twin");
  cpSync(HARBOR, twin, { recursive: true });
  mkdirSync(join(twin, "specs", "002-second-console"));
  writeFileSync(join(twin, "specs", "002-second-console", "spec.md"), "---\nspec_type: feature\n---\n# 002 — Second console\n");
  // A folder without spec.md is not a spec.
  mkdirSync(join(twin, "specs", "007-no-spec"));
  writeFileSync(join(twin, "specs", "007-no-spec", "plan.md"), "# Plan\n");
  api = specRoutesApi({ registry: registryWith(HARBOR, join(FIXTURES, "lantern"), twin), lifeos: LIFEOS_ABSENT, now: () => LIVE_NOW });
});

afterAll(() => {
  for (const registry of registries.splice(0)) registry.close();
  rmSync(root, { recursive: true, force: true });
});

async function call(path: string, init: { method?: string; headers?: Record<string, string>; handler?: ApiHandler } = {}): Promise<Response> {
  const url = new URL(`http://127.0.0.1:7717${path}`);
  const req = new Request(url.href, { method: init.method ?? "GET", headers: { ...HOST, ...init.headers } });
  const res = await (init.handler ?? api)(req, url);
  if (res === null) throw new Error(`the spec routes declined ${path}`);
  return res;
}

/** Every string anywhere in `value`, keys included. */
function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => strings(v, out));
  else if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      out.push(k);
      strings(v, out);
    }
  }
  return out;
}

/** The read routes of harbor 002 and the golden-derived body each must answer. */
function readRoutes(): Array<{ route: SpecRouteName; path: string; body: () => unknown }> {
  const docs = golden("harbor", "docs") as { constitution: unknown; specs: Record<string, Record<string, unknown>> };
  return [
    { route: "spec", path: specRoutes.spec("harbor", "002"), body: expectedSpecPage },
    { route: "timeline", path: specRoutes.timeline("harbor", "002"), body: () => golden("harbor", "timeline")[KEY] },
    { route: "claims", path: specRoutes.claims("harbor", "002"), body: expectedClaims },
    { route: "tasks", path: specRoutes.tasks("harbor", "002"), body: () => golden("harbor", "tasks")[KEY] },
    { route: "evidence", path: specRoutes.evidence("harbor", "002"), body: () => listEvidence(SPEC_DIR) },
    ...DOC_NAMES.filter((name) => name !== "design").map((name) => ({
      route: "docs" as const,
      path: specRoutes.docs("harbor", "002", name),
      body: () => (name === "constitution" ? docs.constitution : docs.specs[KEY]?.[name]),
    })),
    { route: "frames", path: specRoutes.frames("harbor", "002"), body: () => golden("harbor", "frames")[KEY] },
    { route: "live", path: specRoutes.live("harbor", "002"), body: () => golden("harbor", "live")[KEY] },
  ];
}

describe("every read route of harbor 002", () => {
  test("answers 200 with its golden family's value, JSON_ANSWER headers, no absolute path", async () => {
    for (const { route, path, body } of readRoutes()) {
      const res = await call(path);
      expect({ path, status: res.status }).toEqual({ path, status: 200 });
      expect(res.headers.get("content-type")).toBe(JSON_ANSWER.contentType);
      expect(res.headers.get("cache-control")).toBe(JSON_ANSWER.cacheControl);
      const text = await res.text();
      expect(res.headers.get("etag")).toBe(`"${new Bun.CryptoHasher("sha256").update(text).digest("base64url")}"`);
      const value: unknown = JSON.parse(text);
      expect({ route, path, value }).toEqual({ route, path, value: JSON.parse(JSON.stringify(await body())) });
      const leaks = strings(value).filter((s) => /^\/[^\s/]+\//.test(s) || [homedir(), tmpdir(), FIXTURES].some((d) => s.includes(d)));
      expect({ path, leaks }).toEqual({ path, leaks: [] });
    }
  });

  test("the id, the folder name and the bare slug name the same spec", async () => {
    const bodies = await Promise.all(["002", "002-web-console", "web-console"].map(async (id) => (await call(specRoutes.claims("harbor", id))).text()));
    expect(new Set(bodies).size).toBe(1);
  });

  test("ETag: a matching If-None-Match is a 304 without a body; HEAD sends the headers alone", async () => {
    for (const { path } of readRoutes()) {
      const first = await call(path);
      const etag = first.headers.get("etag") ?? "";
      expect(etag).toMatch(/^"[A-Za-z0-9_-]{43}"$/);
      const again = await call(path, { headers: { "If-None-Match": etag } });
      expect({ path, status: again.status }).toEqual({ path, status: 304 });
      expect(await again.text()).toBe("");
      expect(again.headers.get("etag")).toBe(etag);
      const head = await call(path, { method: "HEAD" });
      expect({ path, status: head.status }).toEqual({ path, status: 200 });
      expect(head.headers.get("etag")).toBe(etag);
      expect(await head.text()).toBe("");
    }
  });

  test("405 with Allow for a method the route does not take; the writes take POST only", async () => {
    for (const { route, path } of readRoutes()) {
      for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
        const res = await call(path, { method });
        expect({ path, method, status: res.status, allow: res.headers.get("allow") }).toEqual({ path, method, status: 405, allow: allowFor(route) });
        expect(await res.json()).toEqual({ error: "method-not-allowed" });
      }
    }
    const writes = SPEC_ROUTE_TABLE.filter((entry) => entry.method === "POST").map((entry) => entry.route);
    expect(writes).toEqual(["gateReviewed", "taskCheck"]);
    for (const path of [specRoutes.gateReviewed("harbor", "002"), specRoutes.taskCheck("harbor", "002", "T1")]) {
      const get = await call(path);
      expect([get.status, get.headers.get("allow")]).toEqual([405, "POST"]);
      for (const method of ["PUT", "DELETE", "PATCH"]) {
        const res = await call(path, { method });
        expect([res.status, res.headers.get("allow")]).toEqual([405, "POST"]);
      }
      // A POST is answered (tests/writes.test.ts covers the writes); one without a body is the contract's 400.
      const post = await call(path, { method: "POST" });
      expect(post.status).toBe(400);
      expect(await post.json()).toEqual({ error: "invalid-body" });
    }
  });

  test("a foreign Host or a cross-site Origin is a 403 before anything is read", async () => {
    const path = specRoutes.spec("harbor", "002");
    expect((await call(path, { headers: { Host: "evil.example" } })).status).toBe(403);
    const cross = await call(path, { headers: { Origin: "http://evil.example" } });
    expect(cross.status).toBe(403);
    expect(await cross.json()).toEqual({ error: "forbidden" });
  });
});

describe("hash headers", () => {
  const hashesOf = (dir: string) => {
    const read = (name: "spec.md" | "plan.md" | "tasks.md"): string | null => {
      try {
        return hashForGate(name, readFileSync(join(dir, name), "utf8"));
      } catch {
        return null;
      }
    };
    return { spec: read("spec.md"), plan: read("plan.md"), tasks: read("tasks.md") };
  };

  test("the spec route sends the reviewed hashes of spec.md, plan.md and tasks.md, on 200, 304 and HEAD", async () => {
    const path = specRoutes.spec("harbor", "002");
    const res = await call(path);
    const expected = formatReviewedHashes(hashesOf(SPEC_DIR));
    expect(res.headers.get(REVIEWED_HASHES_HEADER)).toBe(expected);
    expect(parseReviewedHashes(res.headers.get(REVIEWED_HASHES_HEADER))).toEqual(hashesOf(SPEC_DIR));
    const cached = await call(path, { headers: { "If-None-Match": res.headers.get("etag") ?? "" } });
    expect(cached.status).toBe(304);
    expect(cached.headers.get(REVIEWED_HASHES_HEADER)).toBe(expected);
    expect((await call(path, { method: "HEAD" })).headers.get(REVIEWED_HASHES_HEADER)).toBe(expected);
  });

  test("a missing file hashes as `-`: lantern 002 has no plan.md and no tasks.md", async () => {
    const res = await call(specRoutes.spec("lantern", "002"));
    expect(res.status).toBe(200);
    const hashes = parseReviewedHashes(res.headers.get(REVIEWED_HASHES_HEADER));
    expect(hashes?.plan).toBeNull();
    expect(hashes?.tasks).toBeNull();
    expect(hashes?.spec).toMatch(/^[0-9a-f]{64}$/);
  });

  test("the tasks route sends the sha256 hex of tasks.md's raw bytes; none without tasks.md", async () => {
    const res = await call(specRoutes.tasks("harbor", "002"));
    expect(res.headers.get(TASKS_HASH_HEADER)).toBe(new Bun.CryptoHasher("sha256").update(readFileSync(join(SPEC_DIR, "tasks.md"))).digest("hex"));
    const cached = await call(specRoutes.tasks("harbor", "002"), { headers: { "If-None-Match": res.headers.get("etag") ?? "" } });
    expect(cached.status).toBe(304);
    expect(cached.headers.get(TASKS_HASH_HEADER)).toBe(res.headers.get(TASKS_HASH_HEADER));
    const none = await call(specRoutes.tasks("lantern", "002"));
    expect(none.status).toBe(200);
    expect(none.headers.get(TASKS_HASH_HEADER)).toBeNull();
  });
});

describe("lantern 002: no rounds, no tasks.md", () => {
  test("frames are [], tasks null, the live frame has no agents and no lock source; the goldens agree", async () => {
    const frames: unknown = await (await call(specRoutes.frames("lantern", "002"))).json();
    const tasks: unknown = await (await call(specRoutes.tasks("lantern", "002"))).json();
    const live = (await (await call(specRoutes.live("lantern", "002"))).json()) as { agents: unknown[]; lockSource: string };
    expect(frames).toEqual([]);
    expect(tasks).toBeNull();
    expect(live.agents).toEqual([]);
    expect(live.lockSource).toBe("none");
    expect([frames, tasks, live]).toEqual([
      golden("lantern", "frames")[LANTERN_KEY],
      golden("lantern", "tasks")[LANTERN_KEY],
      golden("lantern", "live")[LANTERN_KEY],
    ]);
  });
});

describe("not found", () => {
  const NOT_FOUND = { error: "not-found" };

  test("not found: unknown workspace, unknown id, unknown slug, ambiguous id, a folder without spec.md, an unknown tab → 404, no fallback body", async () => {
    const paths = [
      specRoutes.spec("nope", "002"),
      specRoutes.claims("nope", "002"),
      specRoutes.spec("harbor", "099"),
      specRoutes.spec("harbor", "999-web-console"),
      specRoutes.spec("harbor", "no-such-slug"),
      specRoutes.timeline("harbor", "web"),
      specRoutes.spec("twin", "002"),
      specRoutes.live("twin", "002"),
      specRoutes.spec("twin", "007"),
      specRoutes.docs("twin", "007-no-spec", "plan"),
      specRoutes.evidenceFile("harbor", "099", "artifacts/T13-routes.md"),
      "/api/workspaces/harbor/specs/002/unknown",
      "/api/workspaces/harbor/specs/002/docs/spec",
      "/api/workspaces/harbor/specs/002/docs/context",
      "/api/workspaces/harbor/specs/002/",
      "/api/workspaces/harbor/specs",
      "/api/workspaces/harbor/specs/%E0%A4%A",
    ];
    for (const path of paths) {
      const res = await call(path);
      const text = await res.text();
      expect({ path, status: res.status, body: JSON.parse(text) as unknown }).toEqual({ path, status: 404, body: NOT_FOUND });
      expect(res.headers.get(REVIEWED_HASHES_HEADER)).toBeNull();
    }
    // The twin's other specs still answer: only the ambiguous ref is refused.
    expect((await call(specRoutes.spec("twin", "002-web-console"))).status).toBe(200);
    expect((await call(specRoutes.spec("twin", "second-console"))).status).toBe(200);
  });

  test("not found: an absent doc is 404 DocMissing with the type-aware availability, never another doc", async () => {
    const res = await call(specRoutes.docs("harbor", "002", "design"));
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string; doc: DocName; availability: unknown };
    expect(body).toEqual({ error: "not-found", doc: "design", availability: docsFor("feature").design });
    const plan = await call(specRoutes.docs("harbor", "005", "plan"));
    expect(plan.status).toBe(404);
    const type = (golden("harbor", "spec")["specs/005-config-format-choice"] as SpecPageModel).head.type;
    expect(await plan.json()).toEqual({ error: "not-found", doc: "plan", availability: docsFor(type).plan });
  });

  test("not found: a path outside the spec routes is declined for the server's own 404", () => {
    for (const path of ["/api/workspaces", "/api/workspaces/harbor/dashboard", "/api/lifeos", "/api/workspaces/harbor/notes"]) {
      const url = new URL(`http://127.0.0.1:7717${path}`);
      expect({ path, answer: api(new Request(url.href, { headers: HOST }), url) }).toEqual({ path, answer: null });
    }
  });
});

describe("the timeline from git (T46)", () => {
  /** Runs git in `cwd` with a fixed identity and clock; the repository is a temp copy, never a registered fixture. */
  const git = (cwd: string, ...args: string[]): string => {
    const date = "2026-03-08T12:00:00Z";
    const env = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.invalid", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.invalid", GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date };
    const out = Bun.spawnSync(["git", "-c", "init.defaultBranch=main", "-c", "commit.gpgsign=false", ...args], { cwd, env });
    if (out.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${out.stderr.toString()}`);
    return out.stdout.toString().trim();
  };

  test("a workspace that is a repository of its own: the folder's commits in the body, HEAD folded into the ETag, cached", async () => {
    const repo = join(root, "shelf");
    cpSync(join(FIXTURES, "lantern"), repo, { recursive: true });
    git(repo, "init", "-q");
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", "seed the reading list");
    const head = git(repo, "rev-parse", "HEAD");
    const cache = new CommitCache();
    const handler = specRoutesApi({ registry: registryWith(repo), lifeos: LIFEOS_ABSENT, commitCache: cache });
    const folder = "specs/001-reading-list";

    const res = await call(specRoutes.timeline("shelf", "001"), { handler });
    expect(res.status).toBe(200);
    const text = await res.text();
    const read = await commitsFor(repo, folder);
    expect(read.commits.map((c) => c.subject)).toEqual(["seed the reading list"]);
    const ref = { dir: join(repo, "specs", "001-reading-list"), slug: "001-reading-list" };
    expect(JSON.parse(text)).toEqual(JSON.parse(JSON.stringify(buildTimeline({ files: readSpecFiles(ref), commits: read.commits }))));
    expect(text).toContain(head);

    const etag = res.headers.get("etag");
    expect(etag).toBe(timelineEtag(JSON.parse(text), head));
    expect(etag).not.toBe(`"${new Bun.CryptoHasher("sha256").update(text).digest("base64url")}"`);
    // The registry keeps the real path (macOS /var is /private/var), the cache key with it.
    expect(cache.has(realpathSync(repo), folder)).toBe(true);
    const again = await call(specRoutes.timeline("shelf", "001"), { handler, headers: { "If-None-Match": etag ?? "" } });
    expect(again.status).toBe(304);
    expect((await call(specRoutes.timeline("shelf", "001"), { handler, method: "HEAD" })).headers.get("etag")).toBe(etag);

    // The spec page reads the same commits; the fixture repository answers none, as its goldens were built.
    expect((await call(specRoutes.spec("shelf", "001"), { handler })).status).toBe(200);
    expect(git(repo, "status", "--porcelain")).toBe("");
  });
});

describe("an unreadable workspace", () => {
  test("a registered workspace whose directory is gone answers 409 with its own summary, no path", async () => {
    const gone = join(root, "gone");
    cpSync(join(FIXTURES, "lantern"), gone, { recursive: true });
    const handler = specRoutesApi({ registry: registryWith(gone), lifeos: LIFEOS_ABSENT });
    rmSync(gone, { recursive: true, force: true });
    for (const path of [specRoutes.spec("gone", "001"), specRoutes.evidenceFile("gone", "001", "artifacts/x.md")]) {
      const res = await call(path, { handler });
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ slug: "gone", name: "gone", pathTail: "gone", readable: false, error: "missing", counts: null });
    }
  });

  test.skipIf(process.getuid?.() === 0)("a spec folder without read permission answers 409 permission-denied", async () => {
    const locked = join(root, "locked");
    cpSync(join(FIXTURES, "lantern"), locked, { recursive: true });
    const handler = specRoutesApi({ registry: registryWith(locked), lifeos: LIFEOS_ABSENT });
    const spec = join(locked, "specs", "001-reading-list", "spec.md");
    chmodSync(spec, 0o000);
    try {
      const res = await call(specRoutes.claims("locked", "001"), { handler });
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ slug: "locked", readable: false, error: "permission-denied" });
    } finally {
      chmodSync(spec, 0o644);
    }
  });
});

describe("the served app", () => {
  test("`spectant serve` composes the spec routes after the dashboard", async () => {
    const env = { XDG_DATA_HOME: mkdtempSync(join(root, "xdg-")) };
    const index = join(root, "index.html");
    writeFileSync(index, "<!doctype html><title>spectant</title>");
    const manifest: EmbeddedManifest = { generatedAt: "2026-09-29T10:00:00.000Z", assets: [{ ...embeddedAssetFor("index.html"), file: index }], index };
    const lines: string[] = [];
    const log = spyOn(console, "log").mockImplementation((...args: unknown[]) => void lines.push(args.join(" ")));
    const stop = new AbortController();
    try {
      expect(await run(["add", HARBOR], manifest, { env })).toBe(0);
      const done = run(["--port", "0", "--no-browser"], manifest, { env, signal: stop.signal });
      const deadline = Date.now() + 5_000;
      let url = "";
      while (url === "") {
        url = /^spectant · (http:\/\/127\.0\.0\.1:\d+)$/.exec(lines.find((l) => l.startsWith("spectant · ")) ?? "")?.[1] ?? "";
        if (Date.now() > deadline) throw new Error(`no URL line: ${lines.join(" | ")}`);
        if (url === "") await Bun.sleep(5);
      }
      const res = await fetch(`${url}${specRoutes.frames("harbor", "002")}`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(golden("harbor", "frames")[KEY]);
      expect((await fetch(`${url}${specRoutes.spec("harbor", "099")}`)).status).toBe(404);
      expect((await fetch(`${url}/api/workspaces/harbor/dashboard`)).status).toBe(200);
      stop.abort();
      expect(await done).toBe(0);
    } finally {
      stop.abort();
      log.mockRestore();
    }
  });

  test("composition order: the dashboard route still answers when both handlers are composed", async () => {
    const registry = registryWith(HARBOR);
    const composed = composeApi(dashboardApi({ registry, services: () => Promise.resolve([]) }), specRoutesApi({ registry }));
    expect((await call("/api/workspaces", { handler: composed })).status).toBe(200);
    expect((await call(specRoutes.tasks("harbor", "002"), { handler: composed })).status).toBe(200);
  });
});

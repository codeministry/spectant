// The status board route (spec 071, ISC-593; spec 073, ISC-613): `GET /api/status` answers one entry per registered
// workspace in the workspace picker's order (the order `GET /api/workspaces` answers): slug, path tail, readability and
// the listed specs, the open ones only (stage not `done`), never a closed or an archived spec however recently it
// closed, each with id, title, stage, claim progress, `closedAt` and item state. No field names an absolute path.
//
// Three fixture repositories in a temp directory, registered out of alphabetical order: `lantern` with an open spec
// and two closed ones (2 h and 30 h before the pinned request clock), `gone` whose folder is removed after it was
// registered (unreadable, `missing`), and `harbor` with an open spec and two archived ones closed 2 h and 30 h before.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { STATUS_ALLOW, STATUS_PATH, type StatusResponse } from "../server/src/contracts/status.contract.ts";
import { dashboardApi } from "../server/src/cli/dashboard-api.ts";
import { type Registry, openRegistry } from "../server/src/infra/db/registry.ts";
import { composeApi } from "../server/src/infra/http/json.ts";
import type { ApiHandler } from "../server/src/infra/http/server.ts";
import { statusApi } from "../server/src/status/index.ts";
import type { DevService } from "../server/src/workspace/index.ts";

const NOW = new Date("2026-10-23T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;
const HOST = { Host: "127.0.0.1:7717" };
const hoursAgo = (hours: number): string => new Date(NOW.getTime() - hours * HOUR).toISOString();

let root: string;
let registry: Registry;
let api: ApiHandler;
const probed: string[] = [];

type SpecFixture = { folder: string; title: string; stage: string; claims: readonly boolean[]; closedHoursAgo?: number };

/** One spec folder: front matter, a features list of claim checkboxes and an `events.jsonl` ending in `done` when closed. */
function plantSpec(dir: string, spec: SpecFixture): void {
  mkdirSync(dir, { recursive: true });
  const claims = spec.claims.map((closed, i) => `- [${closed ? "x" : " "}] ISC-${i + 1}: The fixture claim ${i + 1} holds.`).join("\n");
  writeFileSync(
    join(dir, "spec.md"),
    `---\ntask: "${spec.title}"\nslug: ${spec.folder}\nstage: ${spec.stage}\nstarted: ${hoursAgo(80)}\n---\n\n# ${spec.title}\n\n## Features\n\n${claims}\n`,
  );
  const opened = { ts: hoursAgo(72), from: null, to: "plan", command: "/spec new", actor: "u:3f9c0a7d" };
  const closed =
    spec.closedHoursAgo === undefined ? [] : [{ ts: hoursAgo(spec.closedHoursAgo), from: "close", to: "done", command: "/spec done", actor: "u:3f9c0a7d" }];
  writeFileSync(join(dir, "events.jsonl"), [opened, ...closed].map((e) => `${JSON.stringify(e)}\n`).join(""));
}

function plantRepo(name: string, specs: readonly SpecFixture[], archived: readonly SpecFixture[] = []): string {
  const dir = join(root, "repos", name);
  for (const spec of specs) plantSpec(join(dir, "specs", spec.folder), spec);
  for (const spec of archived) plantSpec(join(dir, "specs", "archive", spec.folder), spec);
  return dir;
}

async function call(init: { method?: string; headers?: Record<string, string>; path?: string } = {}): Promise<Response> {
  const url = new URL(`http://127.0.0.1:7717${init.path ?? STATUS_PATH}`);
  const res = await api(new Request(url.href, { method: init.method ?? "GET", headers: { ...HOST, ...init.headers } }), url);
  if (res === null) throw new Error(`declined ${url.pathname}`);
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

const hasAbsolutePath = (s: string): boolean => /^\/[^\s/]+\//.test(s) || [homedir(), tmpdir(), root].some((dir) => s.includes(dir));

beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "spectant-status-")));
  const lantern = plantRepo("lantern", [
    { folder: "001-open-lamp", title: "Open lamp", stage: "review", claims: [true, false, false] },
    { folder: "002-recent-wick", title: "Recent wick", stage: "done", claims: [true, true], closedHoursAgo: 2 },
    { folder: "003-old-glass", title: "Old glass", stage: "done", claims: [true], closedHoursAgo: 30 },
  ]);
  const gone = plantRepo("gone", [{ folder: "001-lost", title: "Lost", stage: "plan", claims: [false] }]);
  const harbor = plantRepo(
    "harbor",
    [{ folder: "006-new-pier", title: "New pier", stage: "review", claims: [false, false] }],
    [
      { folder: "004-recent-buoy", title: "Recent buoy", stage: "done", claims: [true, true, true], closedHoursAgo: 2 },
      { folder: "005-old-anchor", title: "Old anchor", stage: "done", claims: [true], closedHoursAgo: 30 },
    ],
  );
  registry = openRegistry(join(root, "data"));
  for (const path of [lantern, gone, harbor]) registry.add(path);
  rmSync(gone, { recursive: true, force: true });
  const options = {
    registry,
    now: () => NOW,
    services: (repoRoot: string): Promise<DevService[]> => {
      probed.push(repoRoot);
      return Promise.resolve([]);
    },
  };
  api = composeApi(dashboardApi(options), statusApi(options));
});

afterAll(() => {
  registry.close();
  rmSync(root, { recursive: true, force: true });
});

describe("GET /api/status (spec 071, ISC-593)", () => {
  test("one entry per registered workspace in picker order; only open specs, no closed or archived one even 2 h after; no absolute path", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    const body = (await res.json()) as StatusResponse;

    // The picker's order is the workspace list's.
    const list = (await (await call({ path: "/api/workspaces" })).json()) as Array<{ slug: string }>;
    expect(body.workspaces.map((w) => w.slug)).toEqual(list.map((w) => w.slug));
    expect(body.workspaces.map((w) => [w.slug, w.pathTail, w.readable, w.error])).toEqual([
      ["lantern", "lantern", true, null],
      ["gone", "gone", false, "missing"],
      ["harbor", "harbor", true, null],
    ]);

    const [lantern, gone, harbor] = body.workspaces;
    expect(lantern?.specs.map((s) => [s.id, s.title, s.stage, s.claims, s.closedAt, s.archived])).toEqual([
      ["001", "Open lamp", "review", { closed: 1, total: 3 }, null, false],
    ]);
    expect(gone?.specs).toEqual([]);
    expect(harbor?.specs.map((s) => [s.id, s.title, s.stage, s.claims, s.closedAt, s.archived])).toEqual([
      ["006", "New pier", "review", { closed: 0, total: 2 }, null, false],
    ]);
    // ISC-613: no listed spec is done or archived, the 2 h closed and the 2 h archived ones included.
    const listed = body.workspaces.flatMap((w) => w.specs);
    for (const spec of listed) expect(spec).toHaveProperty("state");
    expect(listed.filter((s) => s.stage === "done" || s.archived)).toEqual([]);
    expect(listed.map((s) => s.id)).not.toContain("002");
    expect(listed.map((s) => s.id)).not.toContain("004");
    expect(body.kpis).toEqual({ repos: 2, closed: 0, listed: 2, claimsClosed: 1, claimsTotal: 5 });

    // ISC-3: no field names an absolute path, and the board starts no services probe.
    expect(strings(body).filter(hasAbsolutePath)).toEqual([]);
    expect(probed).toEqual([]);
  });

  test("a strong ETag over the body, 304 on revalidation, HEAD without a body", async () => {
    const res = await call();
    const etag = res.headers.get("etag") ?? "";
    expect(etag).toMatch(/^"[A-Za-z0-9_-]{43}"$/);
    expect(res.headers.get("cache-control")).toBe("no-cache");
    const again = await call({ headers: { "If-None-Match": etag } });
    expect(again.status).toBe(304);
    expect(await again.text()).toBe("");
    const head = await call({ method: "HEAD" });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    expect(head.headers.get("etag")).toBe(etag);
  });

  test("405 with Allow for another method, 403 for a foreign Host or Origin", async () => {
    const post = await call({ method: "POST" });
    expect(post.status).toBe(405);
    expect(post.headers.get("allow")).toBe(STATUS_ALLOW);
    expect((await call({ headers: { Host: "evil.example" } })).status).toBe(403);
    expect((await call({ headers: { Origin: "http://evil.example" } })).status).toBe(403);
  });
});

// Spec 016: the writing workspace routes of the settings page (`server/src/workspace-admin-route.ts`, contract
// `server/src/workspace-admin.contract.ts`). Every case drives the served app (`spectant serve` through `run()`, the
// same composition a user starts) against a fresh data directory under a temp root; nothing touches `~/.spectant`.
//
// One `describe` per probe name of the spec's Test Strategy, so `-t "<name>"` selects exactly that case.
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EmbeddedManifest } from "../server/src/assets.contract.ts";
import { run } from "../server/src/cli.ts";
import { openRegistry } from "../server/src/registry.ts";
import { SPEC_API_ROOT } from "../server/src/spec-routes.contract.ts";
import { type WorkspaceAdminSummary, workspaceAdminRoutes } from "../server/src/workspace-admin.contract.ts";
import { LIVE_MS, openStream, serve } from "./fixtures/live-stream.ts";

const FIXTURE = join(import.meta.dir, "..", "core", "fixtures", "harbor");
// The CLI's list command never serves, so it never reads the manifest.
const manifest: EmbeddedManifest = { generatedAt: "2026-10-20T00:00:00.000Z", index: "", assets: [] };

let root: string;
let app: { url: string; stop: () => Promise<void> } | null = null;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "spectant-workspace-admin-")));
});

afterEach(async () => {
  await app?.stop();
  app = null;
  rmSync(root, { recursive: true, force: true });
});

/** A copy of the harbor fixture at `root/<name>`: a repository with specs. */
function fixtureCopy(name: string): string {
  const dir = join(root, name);
  cpSync(FIXTURE, dir, { recursive: true });
  return dir;
}

/** The data directory `serve` made under `root` (`XDG_DATA_HOME`). */
function xdgHome(): string {
  const dir = readdirSync(root).find((name) => name.startsWith("xdg-"));
  if (dir === undefined) throw new Error("serve made no data directory");
  return join(root, dir);
}

async function start(repos: readonly string[] = []): Promise<string> {
  app = await serve(root, repos);
  return app.url;
}

function post(base: string, body: unknown, raw = false): Promise<Response> {
  return fetch(`${base}${workspaceAdminRoutes.add()}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: raw ? (body as string) : JSON.stringify(body),
  });
}

async function list(base: string): Promise<WorkspaceAdminSummary[]> {
  const res = await fetch(`${base}${SPEC_API_ROOT}`);
  expect(res.status).toBe(200);
  return (await res.json()) as WorkspaceAdminSummary[];
}

/** `spectant list` against the served app's data directory: its stdout lines. */
async function cliList(): Promise<string[]> {
  const lines: string[] = [];
  const log = spyOn(console, "log").mockImplementation((...args: unknown[]) => void lines.push(args.join(" ")));
  try {
    expect(await run(["list"], manifest, { env: { XDG_DATA_HOME: xdgHome() }, cwd: root })).toBe(0);
  } finally {
    log.mockRestore();
  }
  return lines;
}

describe("workspace admin: add", () => {
  test("POST registers one entry that GET, `spectant list` and an open stream show at once", async () => {
    const base = await start();
    const repo = fixtureCopy("harbor");
    expect(await list(base)).toEqual([]);

    const stream = await openStream(base);
    try {
      const res = await post(base, { path: repo });
      expect(res.status).toBe(201);
      const text = await res.text();
      expect(text).not.toContain(root);
      const added = JSON.parse(text) as WorkspaceAdminSummary;
      expect(added).toMatchObject({ slug: "harbor", name: "harbor", pathTail: "harbor", readable: true });

      // The header's workspace menu reads the list the live frame carries: no restart, no heartbeat wait.
      const pushed = await stream.next(
        (update) =>
          update.ws === "harbor" &&
          update.views.some((view) => view.path === SPEC_API_ROOT && (view.body as WorkspaceAdminSummary[]).some((w) => w.slug === "harbor")),
        LIVE_MS,
      );
      expect(pushed).not.toBeNull();
      expect(stream.raw()).not.toContain(root);
    } finally {
      await stream.close();
    }

    const listed = await list(base);
    expect(listed.map((w) => w.slug)).toEqual(["harbor"]);
    expect(await cliList()).toEqual(["harbor  harbor"]);
  });
});

describe("workspace admin: invalid path", () => {
  test("a file, a missing folder, a registered path and a blank path are refused and the registry stays as it was", async () => {
    const repo = fixtureCopy("harbor");
    const base = await start([repo]);
    const file = join(root, "notes.txt");
    writeFileSync(file, "not a directory\n");
    mkdirSync(join(root, "other"));
    const before = await list(base);
    expect(before.map((w) => w.slug)).toEqual(["harbor"]);
    const cliBefore = await cliList();

    const refusals: Array<[unknown, number, Record<string, unknown>]> = [
      [{ path: file }, 422, { error: "not-a-directory" }],
      [{ path: join(root, "gone") }, 422, { error: "not-a-directory" }],
      [{ path: repo }, 422, { error: "duplicate-path", slug: "harbor" }],
      [{ path: `${repo}/` }, 422, { error: "duplicate-path", slug: "harbor" }],
      [{ path: join(root, "other", "..", "harbor") }, 422, { error: "duplicate-path", slug: "harbor" }],
      [{ path: "" }, 400, { error: "invalid-path" }],
      [{ path: "   " }, 400, { error: "invalid-path" }],
      [{}, 400, { error: "invalid-body" }],
      [{ path: 7 }, 400, { error: "invalid-body" }],
    ];
    for (const [body, status, answer] of refusals) {
      const res = await post(base, body);
      const text = await res.text();
      expect({ body, status: res.status, answer: JSON.parse(text) as unknown }).toEqual({ body, status, answer });
      expect(text).not.toContain(root);
    }
    const garbled = await post(base, "{not json", true);
    expect({ status: garbled.status, answer: await garbled.json() }).toEqual({ status: 400, answer: { error: "invalid-body" } });

    expect(await list(base)).toEqual(before);
    expect(await cliList()).toEqual(cliBefore);
  });
});

describe("workspace admin: status", () => {
  test("each row's status follows the read: ok with specs, empty without specs/, missing for a deleted folder", async () => {
    const withSpecs = fixtureCopy("harbor");
    const plain = join(root, "plain");
    mkdirSync(plain);
    writeFileSync(join(plain, "README.md"), "# plain\n");
    const gone = fixtureCopy("gone");
    const base = await start([withSpecs, plain, gone]);
    rmSync(gone, { recursive: true, force: true });

    const rows = await list(base);
    const registry = openRegistry(join(xdgHome(), "spectant"));
    const registered = registry.list();
    registry.close();
    expect(rows.map((w) => [w.slug, w.status, w.readable])).toEqual([
      ["harbor", "ok", true],
      ["plain", "empty", true],
      ["gone", "missing", false],
    ]);
    expect(rows.map((w) => w.slug)).toEqual(registered.map((w) => w.slug));
    for (const row of rows) {
      expect(row).not.toHaveProperty("addedAt");
      expect(row.images).toEqual({ logo: null, screenshot: null });
    }
    expect(JSON.stringify(rows)).not.toContain(root);

    // The add route answers the same row the list shows.
    const fresh = fixtureCopy("fresh");
    const res = await post(base, { path: fresh });
    expect(res.status).toBe(201);
    const added = (await res.json()) as WorkspaceAdminSummary;
    expect(added).toMatchObject({ slug: "fresh", status: "ok", images: { logo: null, screenshot: null } });
    expect((await list(base)).find((w) => w.slug === "fresh")).toEqual(added);
  });
});

// Spec 016: the writing workspace routes of the settings page (`server/src/workspace-admin-route.ts`, contract
// `server/src/workspace-admin.contract.ts`). Every case drives the served app (`spectant serve` through `run()`, the
// same composition a user starts) against a fresh data directory under a temp root; nothing touches `~/.spectant`.
//
// One `describe` per probe name of the spec's Test Strategy, so `-t "<name>"` selects exactly that case.
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type EmbeddedManifest, embeddedAssetFor } from "../server/src/assets.contract.ts";
import { run } from "../server/src/cli.ts";
import { noteRoutes } from "../server/src/notes.contract.ts";
import { openRegistry } from "../server/src/registry.ts";
import { SPEC_API_ROOT } from "../server/src/spec-routes.contract.ts";
import { IMAGE_MAX_BYTES, type ImageKind, type WorkspaceAdminSummary, workspaceAdminRoutes } from "../server/src/workspace-admin.contract.ts";
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

function patch(base: string, ws: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${base}${workspaceAdminRoutes.rename(ws)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

/** The registry as the data directory now holds it, read by a fresh open: what a restart would see. */
function registryNow(): Array<[string, string]> {
  const registry = openRegistry(join(xdgHome(), "spectant"));
  try {
    return registry.list().map((w) => [w.slug, w.name]);
  } finally {
    registry.close();
  }
}

describe("workspace admin: rename", () => {
  test("PATCH changes only the name: slug, the dashboard route and the notes stay, and the name survives a reopen", async () => {
    const repo = fixtureCopy("harbor");
    const base = await start([repo]);
    const created = await fetch(`${base}${noteRoutes.create("harbor")}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "kept", body: "a note keyed by the slug" }),
    });
    expect(created.status).toBe(201);
    const notesBefore: unknown = await (await fetch(`${base}${noteRoutes.list("harbor")}`)).json();
    expect((await fetch(`${base}${SPEC_API_ROOT}/harbor/dashboard`)).status).toBe(200);
    const [before] = await list(base);

    const res = await patch(base, "harbor", { name: "  Harbor Console  " });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(root);
    const renamed = JSON.parse(text) as WorkspaceAdminSummary;
    expect(renamed).toEqual({ ...before, name: "Harbor Console" } as WorkspaceAdminSummary);

    expect(await list(base)).toEqual([renamed]);
    expect((await fetch(`${base}${SPEC_API_ROOT}/harbor/dashboard`)).status).toBe(200);
    expect(await (await fetch(`${base}${noteRoutes.list("harbor")}`)).json()).toEqual(notesBefore);
    expect(registryNow()).toEqual([["harbor", "Harbor Console"]]);
    expect(await cliList()).toEqual(["harbor  harbor"]);

    // Refusals change nothing.
    const refusals: Array<[string, unknown, number, Record<string, unknown>]> = [
      ["harbor", { name: "   " }, 400, { error: "invalid-name" }],
      ["harbor", { name: 7 }, 400, { error: "invalid-body" }],
      ["harbor", [], 400, { error: "invalid-body" }],
      ["nowhere", { name: "Other" }, 404, { error: "not-found" }],
    ];
    for (const [ws, body, status, answer] of refusals) {
      const refused = await patch(base, ws, body);
      expect({ ws, body, status: refused.status, answer: await refused.json() }).toEqual({ ws, body, status, answer });
    }
    expect((await patch(base, "harbor", { name: "Evil" }, { Origin: "http://evil.example" })).status).toBe(403);
    const wrong = await fetch(`${base}${workspaceAdminRoutes.rename("harbor")}`, { method: "PUT" });
    expect(wrong.status).toBe(405);
    expect(wrong.headers.get("Allow")).toBe("PATCH, DELETE");
    expect(registryNow()).toEqual([["harbor", "Harbor Console"]]);
  });

  test("an add with a name registers it under that name, the slug still from the folder", async () => {
    const base = await start();
    const repo = fixtureCopy("harbor");
    const res = await post(base, { path: repo, name: " Harbor Mirror " });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ slug: "harbor", name: "Harbor Mirror", pathTail: "harbor" });
    expect(registryNow()).toEqual([["harbor", "Harbor Mirror"]]);
  });
});

describe("workspace admin: rescan", () => {
  test("a spec folder made between two reads is in the row's counts after the re-scan, without a restart", async () => {
    const repo = fixtureCopy("harbor");
    const base = await start([repo]);
    const [before] = await list(base);
    expect(before?.counts).not.toBeNull();
    const specsBefore = before?.counts?.specs ?? 0;

    cpSync(join(repo, "specs", "009-chunked-upload-limits"), join(repo, "specs", "010-rescan-probe"), { recursive: true });
    const res = await fetch(`${base}${workspaceAdminRoutes.rescan("harbor")}`, { method: "POST" });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(root);
    const rescanned = JSON.parse(text) as WorkspaceAdminSummary;
    expect(rescanned.slug).toBe("harbor");
    expect(rescanned.counts?.specs).toBe(specsBefore + 1);
    expect(await list(base)).toEqual([rescanned]);

    const unknown = await fetch(`${base}${workspaceAdminRoutes.rescan("nowhere")}`, { method: "POST" });
    expect({ status: unknown.status, answer: await unknown.json() }).toEqual({ status: 404, answer: { error: "not-found" } });
    const wrong = await fetch(`${base}${workspaceAdminRoutes.rescan("harbor")}`, { method: "PUT" });
    expect(wrong.status).toBe(405);
    expect(wrong.headers.get("Allow")).toBe("POST");
    const foreign = await fetch(`${base}${workspaceAdminRoutes.rescan("harbor")}`, { method: "POST", headers: { Origin: "http://evil.example" } });
    expect(foreign.status).toBe(403);
  });
});

/** `spectant serve` again on the data directory the first `start` made: a restart. */
async function restart(): Promise<string> {
  await app?.stop();
  app = null;
  const index = join(root, "index.html");
  writeFileSync(index, "<!doctype html><title>spectant</title>");
  const served: EmbeddedManifest = { generatedAt: "2026-10-20T00:00:00.000Z", assets: [{ ...embeddedAssetFor("index.html"), file: index }], index };
  const lines: string[] = [];
  const log = spyOn(console, "log").mockImplementation((...args: unknown[]) => void lines.push(args.join(" ")));
  const abort = new AbortController();
  const done = run(["--port", "0", "--no-browser"], served, { env: { XDG_DATA_HOME: xdgHome() }, signal: abort.signal });
  const stop = async (): Promise<void> => {
    abort.abort();
    const code = await done;
    log.mockRestore();
    expect(code).toBe(0);
  };
  const deadline = Date.now() + 5_000;
  let found = "";
  while (found === "") {
    found = /^spectant · (http:\/\/127\.0\.0\.1:\d+)$/.exec(lines.find((l) => l.startsWith("spectant · ")) ?? "")?.[1] ?? "";
    if (found === "" && Date.now() > deadline) {
      await stop();
      throw new Error(`no URL line: ${lines.join(" | ")}`);
    }
    if (found === "") await Bun.sleep(5);
  }
  app = { url: found, stop };
  return found;
}

/** Bytes that sniff as PNG (the magic) followed by `fill`, so two images differ. */
function png(fill: number, length = 64): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(length).fill(fill);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  return bytes;
}

const versionOf = (bytes: Uint8Array): string => new Bun.CryptoHasher("sha256").update(bytes).digest("hex").slice(0, 16);

function putImage(base: string, ws: string, kind: ImageKind, bytes: Uint8Array, type = "image/png"): Promise<Response> {
  return fetch(`${base}${workspaceAdminRoutes.image(ws, kind)}`, { method: "PUT", headers: { "Content-Type": type }, body: bytes });
}

describe("workspace admin: upload", () => {
  test("logo and screenshot upload apart, live under <data>/workspaces/<slug>/, are served byte-equal and survive a restart", async () => {
    const repo = fixtureCopy("harbor");
    let base = await start([repo]);
    const logo = png(1);
    const screenshot = png(2, 4096);
    expect((await fetch(`${base}${workspaceAdminRoutes.image("harbor", "logo")}`)).status).toBe(404);

    for (const [kind, bytes] of [["logo", logo], ["screenshot", screenshot]] as const) {
      const res = await putImage(base, "harbor", kind, bytes);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ kind, url: workspaceAdminRoutes.imageUrl("harbor", kind, versionOf(bytes)) });
    }
    const dir = join(xdgHome(), "spectant", "workspaces", "harbor");
    expect(readdirSync(dir).sort()).toEqual(["logo.png", "screenshot.png"]);
    const expected = { logo: workspaceAdminRoutes.imageUrl("harbor", "logo", versionOf(logo)), screenshot: workspaceAdminRoutes.imageUrl("harbor", "screenshot", versionOf(screenshot)) };

    const served = async (): Promise<void> => {
      const [row] = await list(base);
      expect(row?.images).toEqual(expected);
      expect(JSON.stringify(row)).not.toContain(root);
      for (const [kind, bytes] of [["logo", logo], ["screenshot", screenshot]] as const) {
        const res = await fetch(`${base}${expected[kind]}`);
        expect(res.status).toBe(200);
        expect(res.headers.get("Content-Type")).toBe("image/png");
        expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
        const etag = res.headers.get("ETag") ?? "";
        expect(etag).toMatch(/^"[^"]+"$/);
        expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
        const again = await fetch(`${base}${expected[kind]}`, { headers: { "If-None-Match": etag } });
        expect(again.status).toBe(304);
        const head = await fetch(`${base}${workspaceAdminRoutes.image("harbor", kind)}`, { method: "HEAD" });
        expect([head.status, head.headers.get("ETag")]).toEqual([200, etag]);
      }
    };
    await served();
    base = await restart();
    await served();

    // A new upload of the same kind replaces the file of the other type; refusals store nothing.
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
    expect((await putImage(base, "harbor", "logo", jpeg, "image/png")).status).toBe(200);
    expect(readdirSync(dir).sort()).toEqual(["logo.jpg", "screenshot.png"]);
    const replaced = await fetch(`${base}${workspaceAdminRoutes.image("harbor", "logo")}`);
    expect([replaced.headers.get("Content-Type"), new Uint8Array(await replaced.arrayBuffer())]).toEqual(["image/jpeg", jpeg]);
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    expect((await putImage(base, "harbor", "screenshot", svg, "image/png")).status).toBe(415);
    expect((await putImage(base, "harbor", "screenshot", png(3, IMAGE_MAX_BYTES + 1))).status).toBe(413);
    expect((await putImage(base, "nowhere", "logo", logo)).status).toBe(404);
    expect(readdirSync(dir).sort()).toEqual(["logo.jpg", "screenshot.png"]);
    const kept = await fetch(`${base}${workspaceAdminRoutes.image("harbor", "screenshot")}`);
    expect(new Uint8Array(await kept.arrayBuffer())).toEqual(screenshot);
    const foreign = await fetch(`${base}${workspaceAdminRoutes.image("harbor", "logo")}`, { method: "PUT", headers: { Origin: "http://evil.example" }, body: logo });
    expect(foreign.status).toBe(403);
    expect(readdirSync(dir).sort()).toEqual(["logo.jpg", "screenshot.png"]);
  });
});

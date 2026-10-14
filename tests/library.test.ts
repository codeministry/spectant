// The library catalog route (spec 017 T16, ISC-156): `GET|HEAD /api/workspaces/:ws/library` answered by `dashboardApi`
// from the files of a registered workspace: core's `readCatalog` as it is, metadata only, with the JSON conventions of
// `api.ts` (strong ETag, 304, HEAD, 405 + Allow, 404 unknown slug, 409 with the summary for an unreadable folder).
//
// Fixture: a temp copy of `core/fixtures/library` (every zone, a prototype, an archived spec), a workspace without
// `specs/` (the empty state) and a registered folder that is removed (409). Nothing in a workspace is ever written.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { docsRenderOptions } from "../core/src/evidence.ts";
import { hashForGate } from "../core/src/gates.ts";
import { readCatalog } from "../core/src/library.ts";
import { renderDocsMarkdown } from "../core/src/markdown-docs.ts";
import { dashboardApi } from "../server/src/api.ts";
import type { ApiHandler } from "../server/src/http.ts";
import { type Registry, openRegistry } from "../server/src/registry.ts";
import { type WorkspaceRouteResponses, allowForWorkspace, workspaceRoutes } from "../server/src/spec-routes.contract.ts";
import { SPEC_FOLDER, plantWorktreeRepo } from "./fixtures/worktree-repo.ts";

const LIBRARY = join(import.meta.dir, "..", "core", "fixtures", "library");
const HOST = { Host: "127.0.0.1:7717" };

let root: string;
let shelf: string;
let bare: string;
let gone: string;
let registry: Registry;
let api: ApiHandler;

/** Every file under `dir` with its size, mtime and sha256, so any write shows. */
function fingerprint(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const name of readdirSync(d).sort()) {
      const path = join(d, name);
      const st = statSync(path, { throwIfNoEntry: false });
      if (st === undefined) continue;
      if (st.isDirectory()) walk(path);
      else out.push(`${path.slice(dir.length)} ${st.size} ${st.mtimeMs} ${new Bun.CryptoHasher("sha256").update(readFileSync(path)).digest("hex")}`);
    }
  };
  walk(dir);
  return out;
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "spectant-library-"));
  shelf = join(root, "shelf");
  bare = join(root, "bare");
  gone = join(root, "gone");
  cpSync(LIBRARY, shelf, { recursive: true });
  mkdirSync(bare);
  writeFileSync(join(bare, "README.md"), "# A workspace without specs\n");
  mkdirSync(gone);
  registry = openRegistry(mkdtempSync(join(root, "data-")));
  registry.add(shelf);
  registry.add(bare);
  registry.add(gone);
  rmSync(gone, { recursive: true });
  api = dashboardApi({ registry, services: () => Promise.resolve([]) });
});

afterAll(() => {
  registry.close();
  rmSync(root, { recursive: true, force: true });
});

async function call(path: string, init: { method?: string; headers?: Record<string, string> } = {}): Promise<Response> {
  const url = new URL(`http://127.0.0.1:7717${path}`);
  const req = new Request(url.href, { method: init.method ?? "GET", headers: { ...HOST, ...init.headers } });
  const res = await api(req, url);
  if (res === null) throw new Error(`the workspace routes declined ${path}`);
  return res;
}

describe("GET /api/workspaces/:ws/library", () => {
  test("catalog: 200, the body exactly readCatalog over the workspace, metadata only, the archive left out", async () => {
    const res = await call(workspaceRoutes.library("shelf"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("etag")).toMatch(/^"[A-Za-z0-9_-]+"$/);
    const text = await res.text();
    expect(text).toBe(JSON.stringify(await readCatalog(shelf)));
    const catalog = JSON.parse(text) as WorkspaceRouteResponses["library"];
    expect(catalog.docs.length).toBeGreaterThan(0);
    // Every type of the fixture is present, each document once, with its spec, title and time.
    expect(new Set(catalog.docs.map((d) => d.type))).toEqual(
      new Set(["spec", "plan", "tasks", "design", "context", "artifact", "evidence", "prototype", "constitution", "tech", "tldr", "idea"]),
    );
    expect(new Set(catalog.docs.map((d) => d.path)).size).toBe(catalog.docs.length);
    for (const doc of catalog.docs) {
      expect(doc.title).not.toBe("");
      // A `missing` entry (ISC-155.2) names a file that does not exist, so it has no time.
      if (doc.state === "missing") expect(doc.modified).toBeNull();
      else expect(doc.modified).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(doc.spec === "workspace" || /^\d{3}-/.test(doc.spec)).toBe(true);
    }
    expect(catalog.docs.filter((d) => d.type === "evidence" && d.spec === "001-lighthouse-map").map((d) => d.path)).toEqual([
      "001-lighthouse-map/.evidence/ISC-1/map.png",
      "001-lighthouse-map/.evidence/ISC-2/notes.md",
      "001-lighthouse-map/.evidence/summary.md",
    ]);
    // Metadata only: no document's text, no absolute path, nothing from specs/archive/.
    expect(text).not.toContain(root);
    expect(text).not.toContain("archive/");
    expect(text).not.toContain("000-first-light");
    // The group heads carry a spec's goal and first approach paragraph as their own short Markdown (ISC-157); the
    // document entries carry no text.
    const entries = JSON.stringify(catalog.docs);
    const plan = readFileSync(join(shelf, "specs", "001-lighthouse-map", "plan.md"), "utf8").split("\n").filter((l) => l.length > 40);
    for (const line of plan) expect(entries).not.toContain(line);
  });

  test("a workspace without documents: 200 and an empty catalog", async () => {
    const res = await call(workspaceRoutes.library("bare"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ docs: [], groups: [], fog: [], missing: 0, stale: 0 });
  });

  test("304 on a matching If-None-Match; HEAD gets the headers without a body", async () => {
    const path = workspaceRoutes.library("shelf");
    const etag = (await call(path)).headers.get("etag") ?? "";
    const again = await call(path, { headers: { "If-None-Match": etag } });
    expect(again.status).toBe(304);
    expect(await again.text()).toBe("");
    const head = await call(path, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.headers.get("etag")).toBe(etag);
    expect(await head.text()).toBe("");
  });

  test("the ETag follows the files: an edited spec.md and a new evidence file are each a new tag", async () => {
    const path = workspaceRoutes.library("shelf");
    const before = (await call(path)).headers.get("etag") ?? "";
    const spec = join(shelf, "specs", "004-fog-horn", "spec.md");
    const original = readFileSync(spec);
    const stat = statSync(spec);
    try {
      writeFileSync(spec, `${original.toString("utf8")}\n`);
      utimesSync(spec, stat.atime, new Date(stat.mtimeMs + 60_000));
      const edited = await call(path, { headers: { "If-None-Match": before } });
      expect(edited.status).toBe(200);
      const tag = edited.headers.get("etag") ?? "";
      expect(tag).not.toBe(before);
      mkdirSync(join(shelf, "specs", "004-fog-horn", ".evidence"));
      writeFileSync(join(shelf, "specs", "004-fog-horn", ".evidence", "proof.md"), "# Proof\n");
      const added = await call(path, { headers: { "If-None-Match": tag } });
      expect(added.status).toBe(200);
      const catalog = (await added.json()) as WorkspaceRouteResponses["library"];
      expect(catalog.docs.find((d) => d.path === "004-fog-horn/.evidence/proof.md")?.title).toBe("Proof");
    } finally {
      rmSync(join(shelf, "specs", "004-fog-horn", ".evidence"), { recursive: true, force: true });
      writeFileSync(spec, original);
      utimesSync(spec, stat.atime, stat.mtime);
    }
  });

  test("404 for an unknown workspace, 409 for an unreadable one, 405 with Allow for another method, 403 off loopback", async () => {
    const missing = await call(workspaceRoutes.library("nowhere"));
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "not-found" });
    const unreadable = await call(workspaceRoutes.library("gone"));
    expect(unreadable.status).toBe(409);
    expect(await unreadable.json()).toEqual({ slug: "gone", name: "gone", pathTail: "gone", readable: false, error: "missing", counts: null });
    for (const method of ["POST", "PUT", "DELETE"]) {
      const res = await call(workspaceRoutes.library("shelf"), { method });
      expect({ method, status: res.status, allow: res.headers.get("allow") }).toEqual({ method, status: 405, allow: allowForWorkspace("library") });
      expect(await res.json()).toEqual({ error: "method-not-allowed" });
    }
    expect((await call(workspaceRoutes.library("shelf"), { headers: { Host: "evil.example" } })).status).toBe(403);
  });

  test("read-only: every answer above leaves the workspaces byte-identical", async () => {
    const before = [fingerprint(shelf), fingerprint(bare)];
    for (const ws of ["shelf", "bare", "gone"]) {
      await call(workspaceRoutes.library(ws));
      await call(workspaceRoutes.library(ws), { method: "HEAD" });
      await call(workspaceRoutes.library(ws), { method: "POST" });
    }
    expect([fingerprint(shelf), fingerprint(bare)]).toEqual(before);
  });
});

// ── the reader, the search and the asset (spec 017 T17, T18, ISC-156.2, ISC-156.3) ─────────────────────────────────

const docFile = (path: string): string => join(shelf, "specs", ...path.split("/"));
const nameOf = (type: string): "constitution" | "design" | "plan" => (type === "constitution" ? "constitution" : type === "design" ? "design" : "plan");

describe("GET /api/workspaces/:ws/library/doc", () => {
  test("doc: every readable Markdown document of the catalog is its Docs page, renderDocsMarkdown with docsRenderOptions by type", async () => {
    const catalog = await readCatalog(shelf);
    const readable = catalog.docs.filter((d) => d.media === "markdown" && d.state !== "missing");
    expect(new Set(readable.map((d) => d.type))).toEqual(
      new Set(["constitution", "tech", "tldr", "idea", "spec", "plan", "tasks", "design", "context", "artifact", "evidence"]),
    );
    for (const doc of readable) {
      const res = await call(workspaceRoutes.libraryDoc("shelf", doc.path));
      expect({ path: doc.path, status: res.status }).toEqual({ path: doc.path, status: 200 });
      expect(res.headers.get("etag")).toMatch(/^"[A-Za-z0-9_-]+"$/);
      const file = docFile(doc.path);
      const page = renderDocsMarkdown(readFileSync(file, "utf8"), docsRenderOptions(shelf, file, nameOf(doc.type)));
      expect({ path: doc.path, body: await res.text() }).toEqual({ path: doc.path, body: JSON.stringify(page) });
    }
    // The tech page's sections and image come through as on the former tech page: a TOC and a figure.
    const tech = (await (await call(workspaceRoutes.libraryDoc("shelf", "tech.md"))).json()) as WorkspaceRouteResponses["libraryDoc"];
    expect(tech.toc.map((t) => t.text)).toEqual(["Overview", "Stack", "Architecture", "Risks"]);
    expect(tech.html).toContain("tech/arch.png");
    expect(JSON.stringify(tech)).not.toContain(root);
  });

  test("doc: 404 for every path the catalog does not list as a readable Markdown document, never a read of the path", async () => {
    const refused = [
      "002-tide-board/plan.md", // missing: listed, but no file
      "001-lighthouse-map/artifacts/map-overview.png", // an image
      "001-lighthouse-map/.design/prototype", // a prototype
      "001-lighthouse-map/report.html", // not in the catalog
      "001-lighthouse-map/artifacts/data.json",
      "archive/000-first-light/plan.md", // archived
      "../README.md",
      "001-lighthouse-map/../../README.md",
      "/etc/hosts",
      "001-lighthouse-map/./plan.md", // not the listed spelling
    ];
    for (const path of refused) {
      const res = await call(workspaceRoutes.libraryDoc("shelf", path));
      expect({ path, status: res.status, body: await res.json() }).toEqual({ path, status: 404, body: { error: "not-found" } });
    }
    // A second encoding layer, a malformed escape and no path at all.
    for (const query of ["?path=001-lighthouse-map%252Fplan.md", "?path=%E0%A4%A", "", "?path="]) {
      const res = await call(`${workspaceRoutes.library("shelf")}/doc${query}`);
      expect({ query, status: res.status }).toEqual({ query, status: 404 });
    }
  });

  test("doc: 404 unknown workspace, 409 unreadable, 405 with Allow, 403 off loopback; HEAD and 304", async () => {
    const path = "001-lighthouse-map/plan.md";
    expect((await call(workspaceRoutes.libraryDoc("nowhere", path))).status).toBe(404);
    const unreadable = await call(workspaceRoutes.libraryDoc("gone", path));
    expect({ status: unreadable.status, body: await unreadable.json() }).toEqual({
      status: 409,
      body: { slug: "gone", name: "gone", pathTail: "gone", readable: false, error: "missing", counts: null },
    });
    const post = await call(workspaceRoutes.libraryDoc("shelf", path), { method: "POST" });
    expect({ status: post.status, allow: post.headers.get("allow") }).toEqual({ status: 405, allow: allowForWorkspace("libraryDoc") });
    expect((await call(workspaceRoutes.libraryDoc("shelf", path), { headers: { Host: "evil.example" } })).status).toBe(403);
    const etag = (await call(workspaceRoutes.libraryDoc("shelf", path))).headers.get("etag") ?? "";
    expect((await call(workspaceRoutes.libraryDoc("shelf", path), { headers: { "If-None-Match": etag } })).status).toBe(304);
    const head = await call(workspaceRoutes.libraryDoc("shelf", path), { method: "HEAD" });
    expect({ status: head.status, etag: head.headers.get("etag"), body: await head.text() }).toEqual({ status: 200, etag, body: "" });
  });
});

describe("GET /api/workspaces/:ws/library/search", () => {
  const search = async (q: string): Promise<WorkspaceRouteResponses["librarySearch"]> => {
    const res = await call(workspaceRoutes.librarySearch("shelf", q));
    expect(res.status).toBe(200);
    return (await res.json()) as WorkspaceRouteResponses["librarySearch"];
  };

  test("search: a blank query is an empty result, never 400", async () => {
    expect(await search("")).toEqual({ query: "", hits: [] });
    expect(await search("   ")).toEqual({ query: "", hits: [] });
    const bare = await call(`${workspaceRoutes.library("shelf")}/search`);
    expect({ status: bare.status, body: await bare.json() }).toEqual({ status: 200, body: { query: "", hits: [] } });
  });

  test("search: case-insensitive over the full text, the query trimmed, the snippet 40 before and 60 after with ellipses", async () => {
    const result = await search("  PROJECT EACH position ");
    expect(result.query).toBe("PROJECT EACH position");
    expect(result.hits.map((h) => h.path)).toEqual(["001-lighthouse-map/plan.md"]);
    // The page's plain text is "Plan 001 — lighthouse-map Approach Read the list once, project each position onto the
    // tile grid.": the match starts at 55, so the window opens 40 before it (cut: an ellipsis) and runs to the end.
    expect(result.hits[0]?.snippet).toBe("…thouse-map Approach Read the list once, project each position onto the tile grid.");
    // Every snippet holds its match and at most 40 characters before and 60 after it, plain text without tag or entity.
    for (const hit of (await search("lighthouse")).hits) {
      const inner = hit.snippet.replace(/^…/, "").replace(/…$/, "");
      expect(inner.toLowerCase()).toContain("lighthouse");
      expect(inner.length).toBeLessThanOrEqual(40 + "lighthouse".length + 60);
      expect(hit.snippet).not.toMatch(/<[a-z/]|&(?:amp|lt|gt|quot|#39);/);
    }
  });

  test("search: hits in catalog order, only readable Markdown documents, a title-only match gives the title", async () => {
    const catalog = await readCatalog(shelf);
    const order = catalog.docs.map((d) => d.path);
    const result = await search("lighthouse");
    expect(result.hits.length).toBeGreaterThan(1);
    const paths = result.hits.map((h) => h.path);
    expect(paths).toEqual([...paths].sort((a, b) => order.indexOf(a) - order.indexOf(b)));
    for (const path of paths) {
      const doc = catalog.docs.find((d) => d.path === path);
      expect({ path, media: doc?.media, missing: doc?.state === "missing" }).toEqual({ path, media: "markdown", missing: false });
    }
    // The evidence note's title is its file name, which its text never says.
    expect((await search("NOTES.MD")).hits).toEqual([{ path: "001-lighthouse-map/.evidence/ISC-2/notes.md", snippet: "notes.md" }]);
    // An image's name is never a hit.
    expect((await search("map-overview")).hits).toEqual([]);
    expect((await search("nothing-matches-this-query")).hits).toEqual([]);
  });

  test("search: the text is cached by path and mtime, and a changed mtime reads the file again", async () => {
    const file = docFile("001-lighthouse-map/.design/sketch.md");
    const original = readFileSync(file);
    const stat = statSync(file);
    // A whole-second mtime, so setting it again restores it exactly.
    const pinned = new Date(Math.floor(stat.mtimeMs / 1000) * 1000 - 3_600_000);
    try {
      utimesSync(file, stat.atime, pinned);
      expect((await search("labels second")).hits.map((h) => h.path)).toEqual(["001-lighthouse-map/.design/sketch.md"]);
      // Same size, same mtime: the cached text answers, the new words are not seen.
      const swapped = original.toString("utf8").replace("labels second", "lantern secon");
      expect(Buffer.byteLength(swapped)).toBe(original.length);
      writeFileSync(file, swapped);
      utimesSync(file, stat.atime, pinned);
      expect((await search("labels second")).hits.map((h) => h.path)).toEqual(["001-lighthouse-map/.design/sketch.md"]);
      expect((await search("lantern secon")).hits).toEqual([]);
      // A new mtime: rendered again from the file.
      utimesSync(file, stat.atime, new Date(pinned.getTime() + 60_000));
      expect((await search("labels second")).hits).toEqual([]);
      expect((await search("lantern secon")).hits.map((h) => h.path)).toEqual(["001-lighthouse-map/.design/sketch.md"]);
    } finally {
      writeFileSync(file, original);
      utimesSync(file, stat.atime, stat.mtime);
    }
    expect((await search("labels second")).hits.map((h) => h.path)).toEqual(["001-lighthouse-map/.design/sketch.md"]);
  });

  test("search: 404 unknown workspace, 409 unreadable, 405 with Allow, 403 off loopback", async () => {
    expect((await call(workspaceRoutes.librarySearch("nowhere", "x"))).status).toBe(404);
    expect((await call(workspaceRoutes.librarySearch("gone", "x"))).status).toBe(409);
    const post = await call(workspaceRoutes.librarySearch("shelf", "x"), { method: "POST" });
    expect({ status: post.status, allow: post.headers.get("allow") }).toEqual({ status: 405, allow: allowForWorkspace("librarySearch") });
    expect((await call(workspaceRoutes.librarySearch("shelf", "x"), { headers: { Host: "evil.example" } })).status).toBe(403);
  });

  test("search and doc: a document linked to a file outside specs/ is 404 and never a hit", async () => {
    const linked = join(root, "linked");
    cpSync(LIBRARY, linked, { recursive: true });
    writeFileSync(join(linked, "secret.md"), "# Secret\n\nwhalebone ledger\n");
    symlinkSync(join("..", "..", "..", "secret.md"), join(linked, "specs", "001-lighthouse-map", ".evidence", "leak.md"));
    registry.add(linked);
    const doc = await call(workspaceRoutes.libraryDoc("linked", "001-lighthouse-map/.evidence/leak.md"));
    expect({ status: doc.status, body: await doc.json() }).toEqual({ status: 404, body: { error: "not-found" } });
    const res = await call(workspaceRoutes.librarySearch("linked", "whalebone"));
    expect(await res.json()).toEqual({ query: "whalebone", hits: [] });
  });
});

// Code-review finding 7 (T59, ISC-156.4): a catalog document whose file name carries a space, a `%`, an umlaut or a
// literal percent sequence is listed, so it opens in the reader and the search finds it; the client encodes the listed
// path once, the route decodes it once and matches it against the catalog, and nothing decodes it a second time.
describe("encoded file names in the reader and the search (ISC-156.4)", () => {
  const EVIDENCE = "001-lighthouse-map/.evidence";
  const named: Record<string, string> = {
    "notes with space.md": "kelpwhistle",
    "100%.md": "barnaclequill",
    "Prüfung.md": "driftmarrow",
    "run%20retry.md": "tidewrack",
  };
  let coded: string;

  beforeAll(() => {
    coded = join(root, "coded");
    cpSync(LIBRARY, coded, { recursive: true });
    for (const [name, word] of Object.entries(named)) {
      writeFileSync(join(coded, "specs", EVIDENCE, name), `# Encoded ${word}\n\nThe ${word} line of ${name}.\n`);
    }
    writeFileSync(join(coded, "secret.md"), "# Secret\n\nwhalebone ledger\n");
    registry.add(coded);
  });

  test("encoded: every such document is listed, opens with 200 and is the one search hit for its word", async () => {
    const catalog = await readCatalog(coded);
    for (const [name, word] of Object.entries(named)) {
      const path = `${EVIDENCE}/${name}`;
      expect({ name, listed: catalog.docs.some((d) => d.path === path) }).toEqual({ name, listed: true });
      const res = await call(workspaceRoutes.libraryDoc("coded", path));
      const page = (await res.json()) as WorkspaceRouteResponses["libraryDoc"];
      expect({ name, status: res.status, has: page.html.includes(word) }).toEqual({ name, status: 200, has: true });
      const hits = (await (await call(workspaceRoutes.librarySearch("coded", word))).json()) as WorkspaceRouteResponses["librarySearch"];
      expect({ name, hits: hits.hits.map((h) => h.path) }).toEqual({ name, hits: [path] });
    }
  });

  test("encoded: traversal and a genuinely double-encoded path stay refused (403 or 404), never a read", async () => {
    const enc = encodeURIComponent;
    const doc = `${workspaceRoutes.library("coded")}/doc?path=`;
    const refused = [
      // Traversal, encoded once and raw.
      enc(`${EVIDENCE}/../../../secret.md`),
      `${EVIDENCE}/../../../secret.md`,
      enc("../secret.md"),
      "..%2Fsecret.md",
      "%2E%2E%2Fsecret.md",
      // A second encoding layer over each listed name.
      ...Object.keys(named).map((name) => enc(enc(`${EVIDENCE}/${name}`))),
      // A literal-percent name with one layer too many, and a bare `%` that is no escape.
      enc(enc(enc(`${EVIDENCE}/run%20retry.md`))),
      `${EVIDENCE}/100%.md`,
    ];
    for (const query of refused) {
      const res = await call(`${doc}${query}`);
      const body = await res.text();
      expect({ query, status: [403, 404].includes(res.status), leaked: body.includes("whalebone") }).toEqual({ query, status: true, leaked: false });
    }
  });
});

describe("GET /api/workspaces/:ws/library/asset", () => {
  test("asset: an image below specs/ by its path relative to specs/, images only, confined like techAsset", async () => {
    const res = await call(workspaceRoutes.libraryAsset("shelf", "tech/arch.png"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await res.arrayBuffer()).equals(readFileSync(join(shelf, "specs", "tech", "arch.png")))).toBe(true);
    expect((await call(workspaceRoutes.libraryAsset("shelf", "001-lighthouse-map/artifacts/map-overview.png"))).status).toBe(200);
    const statuses: Array<[string, number]> = [];
    for (const path of ["tech.md", "../README.md", "tech/none.png"]) statuses.push([path, (await call(workspaceRoutes.libraryAsset("shelf", path))).status]);
    expect(statuses).toEqual([
      ["tech.md", 403],
      ["../README.md", 403],
      ["tech/none.png", 404],
    ]);
    expect((await call(`${workspaceRoutes.library("shelf")}/asset?path=%252e%252e%2FREADME.md`)).status).toBe(403);
    expect((await call(workspaceRoutes.libraryAsset("nowhere", "tech/arch.png"))).status).toBe(404);
  });
});

describe("the catalog's group heads stand where the dashboard rows stand", () => {
  const git = (cwd: string, args: string[], env: Record<string, string> = {}): string => {
    const result = Bun.spawnSync(["git", ...args], { cwd, env: { ...process.env, ...env }, stdout: "pipe", stderr: "pipe" });
    if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr.toString()}`);
    return result.stdout.toString().trim();
  };

  test("stage pass-through: a spec with a fresh code-reviewed mark is `close` in the library as on the dashboard", async () => {
    const repo = join(root, "reviewed");
    mkdirSync(join(repo, "specs", "001-one", ".gates"), { recursive: true });
    git(repo, ["init", "--quiet"]);
    writeFileSync(join(repo, ".git", "info", "exclude"), "specs/*/.gates/\n");
    const spec = ["---", "task: one", "slug: 001-one", "spec_type: bug", "phase: build", "---", "", "# 001 — One", "", "## Goal", "", "One thing.", "", "## Claims", "", "- [x] ISC-1: It works.", ""].join("\n");
    writeFileSync(join(repo, "specs", "001-one", "spec.md"), spec);
    // Reviewed on the current spec.md (no plan.md, no tasks.md), so only the code review stands between it and close.
    const reviewed = { gate: "reviewed", at: "2026-09-28T10:00:00Z", files: { "spec.md": hashForGate("spec.md", spec), "plan.md": null, "tasks.md": null } };
    writeFileSync(join(repo, "specs", "001-one", ".gates", "reviewed.json"), JSON.stringify(reviewed));
    // What `git add -A && git write-tree` prints, through a throwaway index outside the repository.
    const index = join(root, "reviewed-index");
    git(repo, ["add", "-A"], { GIT_INDEX_FILE: index });
    const tree = git(repo, ["write-tree"], { GIT_INDEX_FILE: index });
    rmSync(index, { force: true });
    const mark = { gate: "code-reviewed", at: "2026-09-29T10:00:00Z", tree, head: null, code: 0, security: 0 };
    writeFileSync(join(repo, "specs", "001-one", ".gates", "code-reviewed.json"), JSON.stringify(mark));
    registry.add(repo);

    // core alone runs no git, so without the server's input the mark reads stale and the spec waits for a review.
    expect((await readCatalog(repo)).groups.map((g) => [g.spec, g.stage])).toEqual([["001-one", "code-review"]]);
    const before = fingerprint(repo);
    const library = (await (await call(workspaceRoutes.library("reviewed"))).json()) as WorkspaceRouteResponses["library"];
    const dashboard = (await (await call("/api/workspaces/reviewed/dashboard")).json()) as { specs: Array<{ slug: string; stage: string }> };
    expect(fingerprint(repo)).toEqual(before);
    expect(dashboard.specs.map((r) => [r.slug, r.stage])).toEqual([["001-one", "close"]]);
    expect(library.groups.map((g) => [g.spec, g.stage])).toEqual([["001-one", "close"]]);
  });
});

describe("read-only: the reader, the search and the asset", () => {
  test("every answer of the three routes leaves the workspaces byte-identical", async () => {
    const before = [fingerprint(shelf), fingerprint(bare)];
    for (const ws of ["shelf", "bare", "gone"]) {
      for (const method of ["GET", "HEAD", "POST"]) {
        await call(workspaceRoutes.libraryDoc(ws, "001-lighthouse-map/plan.md"), { method });
        await call(workspaceRoutes.libraryDoc(ws, "../README.md"), { method });
        await call(workspaceRoutes.librarySearch(ws, "lighthouse"), { method });
        await call(workspaceRoutes.libraryAsset(ws, "tech/arch.png"), { method });
      }
    }
    expect([fingerprint(shelf), fingerprint(bare)]).toEqual(before);
  });
});

describe("the library reads a spec's own documents from its read source (spec 027, ISC-181)", () => {
  /** A time of the copy's tasks.md alone, so the catalog shows which file it listed. */
  const COPY_TIME = new Date("2030-01-01T00:00:00Z");

  for (const trackedSpecs of [true, false]) {
    const what = trackedSpecs ? "tracked: 002's spec.md, plan.md and tasks.md from the worktree copy" : "untracked: from the main checkout";
    test(`library worktree-copy: specs/ ${what}, the catalog's time from the same file, every byte kept`, async () => {
      const planted = await plantWorktreeRepo({ parent: realpathSync(root), trackedSpecs });
      const reg = openRegistry(mkdtempSync(join(root, "data-")));
      try {
        const ws = reg.add(planted.root).slug;
        const handler = dashboardApi({ registry: reg, services: () => Promise.resolve([]) });
        const get = async (path: string): Promise<Response> => {
          const url = new URL(`http://127.0.0.1:7717${path}`);
          const res = await handler(new Request(url.href, { headers: HOST }), url);
          if (res === null) throw new Error(`the workspace routes declined ${path}`);
          return res;
        };
        const main = join(planted.root, "specs", SPEC_FOLDER);
        const copy = join(planted.worktrees.spec, "specs", SPEC_FOLDER);
        const source = trackedSpecs ? copy : main;
        if (trackedSpecs) {
          // The copy differs where the fixture says: one more ticked task, `stage: code-review`.
          expect(readFileSync(join(copy, "tasks.md"), "utf8")).not.toBe(readFileSync(join(main, "tasks.md"), "utf8"));
          expect(readFileSync(join(copy, "spec.md"), "utf8")).toContain("stage: code-review");
          utimesSync(join(copy, "tasks.md"), COPY_TIME, COPY_TIME);
        }
        const before = fingerprint(planted.root);
        for (const name of ["spec.md", "plan.md", "tasks.md"]) {
          const res = await get(workspaceRoutes.libraryDoc(ws, `${SPEC_FOLDER}/${name}`));
          // Read from the source, rendered against the main checkout's path, where `artifacts/` and `.design/` stay.
          const page = renderDocsMarkdown(readFileSync(join(source, name), "utf8"), docsRenderOptions(planted.root, join(main, name), "plan"));
          expect({ name, status: res.status, body: await res.text() }).toEqual({ name, status: 200, body: JSON.stringify(page) });
        }
        const catalog = (await (await get(workspaceRoutes.library(ws))).json()) as WorkspaceRouteResponses["library"];
        const tasks = catalog.docs.find((d) => d.path === `${SPEC_FOLDER}/tasks.md`);
        expect(tasks?.modified).toBe(statSync(join(source, "tasks.md")).mtime.toISOString());
        expect(tasks?.modified === COPY_TIME.toISOString()).toBe(trackedSpecs);
        expect(JSON.stringify(catalog)).not.toContain(planted.base);
        expect(fingerprint(planted.root)).toEqual(before);
      } finally {
        reg.close();
        rmSync(planted.base, { recursive: true, force: true });
      }
    }, 60_000);
  }
});

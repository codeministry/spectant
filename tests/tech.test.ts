// The tech page route (spec 023 T6, ISC-134.1): `GET|HEAD /api/workspaces/:ws/tech` answered by `dashboardApi` from
// the files of a registered workspace: core's `readTech` over `specs/tech.md` and the active spec folders, as it is,
// with the JSON conventions of `api.ts` (strong ETag, 304, HEAD, 405 + Allow, 404 unknown slug). An image tech.md
// names is checked against the real file under `specs/`, existence only; nothing in the workspace is written.
//
// Fixture: two temp copies of `core/fixtures/harbor`, one without `specs/tech.md` and one with an inline tech.md (the
// plain copy drops the harbor fixture's own tech.md; the documented one overwrites it with an inline file).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ImageFigure } from "../core/src/files.ts";
import { readTech } from "../core/src/tech.ts";
import { dashboardApi } from "../server/src/api.ts";
import type { ApiHandler } from "../server/src/http.ts";
import { type Registry, openRegistry } from "../server/src/registry.ts";
import { type WorkspaceRouteResponses, allowForWorkspace, workspaceRoutes } from "../server/src/spec-routes.contract.ts";
import { readWorkspaceInput } from "../server/src/workspace-loader.ts";

const HARBOR = join(import.meta.dir, "..", "core", "fixtures", "harbor");
const HOST = { Host: "127.0.0.1:7717" };

const TECH_MD = `---
generated: 2026-10-12T09:00:00Z
---

<!-- section: overview -->
Harbor mirrors container images between registries.

<!-- section: stack -->
- Bun and TypeScript

<!-- section: architecture -->
## Flow

![The flow](.tech/flow.png)

![Gone](.tech/gone.png)

![Escape](.tech/escape.png)

![Outside](../outside.png)

<!-- section: risks -->
- The upstream registry may throttle.
`;

let root: string;
let plain: string;
let documented: string;
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
  root = mkdtempSync(join(tmpdir(), "spectant-tech-"));
  plain = join(root, "plain");
  documented = join(root, "documented");
  cpSync(HARBOR, plain, { recursive: true });
  // harbor carries a tech.md (and its image folder) since T3; the plain copy is the workspace without one.
  rmSync(join(plain, "specs", "tech.md"), { force: true });
  rmSync(join(plain, "specs", "tech"), { recursive: true, force: true });
  cpSync(HARBOR, documented, { recursive: true });
  writeFileSync(join(documented, "specs", "tech.md"), TECH_MD);
  mkdirSync(join(documented, "specs", ".tech"));
  writeFileSync(join(documented, "specs", ".tech", "flow.png"), "png");
  writeFileSync(join(root, "secret.png"), "outside");
  symlinkSync(join(root, "secret.png"), join(documented, "specs", ".tech", "escape.png"));
  writeFileSync(join(documented, "outside.png"), "beside specs/");
  registry = openRegistry(mkdtempSync(join(root, "data-")));
  registry.add(plain);
  registry.add(documented);
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

const images = (model: WorkspaceRouteResponses["tech"]): ImageFigure[] =>
  (model.pages?.architecture.figures ?? []).filter((f): f is ImageFigure => f.kind === "image");

describe("GET /api/workspaces/:ws/tech", () => {
  test("without specs/tech.md: 200, pages null, the body exactly readTech over the workspace's spec folders", async () => {
    const res = await call(workspaceRoutes.tech("plain"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("etag")).toMatch(/^"[A-Za-z0-9_-]+"$/);
    const text = await res.text();
    const reading = await readWorkspaceInput(plain);
    if (!reading.readable) throw new Error("the plain copy should read");
    expect(text).toBe(JSON.stringify(readTech({ specs: reading.input.specs })));
    const model = JSON.parse(text) as WorkspaceRouteResponses["tech"];
    expect(model.pages).toBeNull();
    expect(Object.keys(model)).toEqual(["pages", "diagnostics", "specs"]);
    expect(model.specs.map((s) => s.slug)).toEqual(reading.input.specs.map((f) => f.folder).sort());
  });

  test("with specs/tech.md: the three pages, an image present only as a real file under specs/", async () => {
    const res = await call(workspaceRoutes.tech("documented"));
    expect(res.status).toBe(200);
    const model = (await res.json()) as WorkspaceRouteResponses["tech"];
    expect(Object.keys(model.pages ?? {})).toEqual(["overview", "architecture", "risks"]);
    expect(model.pages?.overview.html).toContain("Harbor mirrors container images");
    expect(model.pages?.overview.html).toContain("Bun and TypeScript");
    expect(model.pages?.risks.html).toContain("throttle");
    expect(model.diagnostics).toEqual([]);
    expect(images(model).map((f) => [f.src, f.missing === true])).toEqual([
      [".tech/flow.png", false],
      [".tech/gone.png", true],
      [".tech/escape.png", true],
      ["../outside.png", true],
    ]);
    expect(JSON.stringify(model)).not.toContain(root);
  });

  test("304 on a matching If-None-Match; HEAD gets the headers without a body", async () => {
    const path = workspaceRoutes.tech("documented");
    const etag = (await call(path)).headers.get("etag") ?? "";
    const again = await call(path, { headers: { "If-None-Match": etag } });
    expect(again.status).toBe(304);
    expect(await again.text()).toBe("");
    const head = await call(path, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.headers.get("etag")).toBe(etag);
    expect(await head.text()).toBe("");
  });

  test("the ETag follows the bytes: an edited tech.md is a new tag", async () => {
    const path = workspaceRoutes.tech("plain");
    const before = (await call(path)).headers.get("etag");
    const file = join(plain, "specs", "tech.md");
    writeFileSync(file, "<!-- section: overview -->\nNew.\n");
    try {
      const res = await call(path, { headers: { "If-None-Match": before ?? "" } });
      expect(res.status).toBe(200);
      expect(res.headers.get("etag")).not.toBe(before);
    } finally {
      rmSync(file);
    }
  });

  test("404 for an unknown workspace, 405 with Allow for another method, 403 off loopback", async () => {
    const missing = await call(workspaceRoutes.tech("nowhere"));
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "not-found" });
    for (const method of ["POST", "PUT", "DELETE"]) {
      const res = await call(workspaceRoutes.tech("documented"), { method });
      expect({ method, status: res.status, allow: res.headers.get("allow") }).toEqual({ method, status: 405, allow: allowForWorkspace("tech") });
      expect(await res.json()).toEqual({ error: "method-not-allowed" });
    }
    expect((await call(workspaceRoutes.tech("documented"), { headers: { Host: "evil.example" } })).status).toBe(403);
  });

  test("the asset route has no handler yet (T7): declined, so the server's JSON 404 applies", () => {
    const url = new URL(`http://127.0.0.1:7717${workspaceRoutes.techAsset("documented", ".tech/flow.png")}`);
    expect(api(new Request(url.href, { headers: HOST }), url)).toBeNull();
  });

  test("read-only: every answer above leaves both copies byte-identical", async () => {
    const before = [fingerprint(plain), fingerprint(documented)];
    for (const ws of ["plain", "documented"]) {
      await call(workspaceRoutes.tech(ws));
      await call(workspaceRoutes.tech(ws), { method: "HEAD" });
      await call(workspaceRoutes.tech(ws), { method: "POST" });
    }
    expect([fingerprint(plain), fingerprint(documented)]).toEqual(before);
  });
});

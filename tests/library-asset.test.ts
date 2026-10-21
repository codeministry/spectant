// The library's asset route (spec 017, ISC-156; formerly the tech page's `…/tech/asset`, spec 023 T7, ISC-134.3):
// `GET|HEAD /api/workspaces/:ws/library/asset?path=` relative to `specs/`, the evidence file route's resolver
// and answer with `specs/` as the root: the present image is served with the evidence headers, a missing one is 404,
// and `..`, a second encoding, an absolute path, the symlink out and a non-image are 403, nothing ever written.
//
// Fixture: a temp copy of `core/fixtures/harbor` whose tech.md is overwritten with an inline file and its images.
//
// The removed routes (spec 017, T51, T53; ISC-157.1, ISC-158): the tech page (`…/tech`, `…/tech/asset`), the evidence
// listing (`…/specs/:id/evidence`) and the Docs tabs (`…/specs/:id/docs/:name`) are no route any more; a request to one
// is the server's normal 404, as for any unknown API path.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { composeApi } from "../server/src/infra/http/json.ts";
import { dashboardApi } from "../server/src/cli/index.ts";
import type { ApiHandler } from "../server/src/infra/http/server.ts";
import { type Registry, openRegistry } from "../server/src/infra/db/registry.ts";
import { SPEC_API_ROOT, allowForWorkspace, workspaceRoutes } from "../server/src/contracts/spec-routes.contract.ts";
import { specRoutesApi } from "../server/src/spec/index.ts";

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
  root = mkdtempSync(join(tmpdir(), "spectant-library-asset-"));
  documented = join(root, "documented");
  cpSync(HARBOR, documented, { recursive: true });
  writeFileSync(join(documented, "specs", "tech.md"), TECH_MD);
  mkdirSync(join(documented, "specs", ".tech"));
  writeFileSync(join(documented, "specs", ".tech", "flow.png"), "png");
  writeFileSync(join(root, "secret.png"), "outside");
  symlinkSync(join(root, "secret.png"), join(documented, "specs", ".tech", "escape.png"));
  writeFileSync(join(documented, "outside.png"), "beside specs/");
  registry = openRegistry(mkdtempSync(join(root, "data-")));
  registry.add(documented);
  // The CLI's composition of the two workspace handlers (`cli.ts`): what neither claims is the server's 404.
  api = composeApi(dashboardApi({ registry, services: () => Promise.resolve([]) }), specRoutesApi({ registry }));
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

describe("GET /api/workspaces/:ws/library/asset?path=", () => {
  const asset = (path: string, ws = "documented"): string => workspaceRoutes.libraryAsset(ws, path);

  test("the present image: 200, its media type and bytes with the evidence headers and a weak ETag", async () => {
    const res = await call(asset(".tech/flow.png"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-disposition")).toStartWith("inline");
    expect(res.headers.get("etag")).toMatch(/^W\/"[0-9a-z]+-[0-9a-z]+"$/);
    expect(await res.text()).toBe("png");
  });

  test("HEAD gets the headers without a body; a matching If-None-Match is 304", async () => {
    const etag = (await call(asset(".tech/flow.png"))).headers.get("etag") ?? "";
    const head = await call(asset(".tech/flow.png"), { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.headers.get("etag")).toBe(etag);
    expect(head.headers.get("content-length")).toBe("3");
    expect(await head.text()).toBe("");
    const again = await call(asset(".tech/flow.png"), { headers: { "If-None-Match": etag } });
    expect(again.status).toBe(304);
    expect(await again.text()).toBe("");
  });

  test("404 for a missing image, a missing specs/ file and an unknown workspace", async () => {
    for (const path of [asset(".tech/gone.png"), asset("nowhere/flow.png"), asset(".tech/flow.png", "nowhere")]) {
      const res = await call(path);
      expect({ path, status: res.status }).toEqual({ path, status: 404 });
      expect(await res.json()).toEqual({ error: "not-found" });
    }
  });

  test("403 for .., a second encoding, an absolute path, the symlink out and a file that is not an image", async () => {
    const refused = [
      "../outside.png",
      ".tech/../../outside.png",
      "%2e%2e/outside.png",
      ".tech%252fflow.png",
      join(documented, "specs", ".tech", "flow.png"),
      ".tech/escape.png",
      "tech.md",
    ];
    for (const path of refused) {
      const res = await call(asset(path));
      expect({ path, status: res.status }).toEqual({ path, status: 403 });
      const text = await res.text();
      expect(JSON.parse(text)).toEqual({ error: "forbidden" });
      expect(text).not.toContain(root);
    }
  });

  test("405 with Allow for another method, 403 off loopback", async () => {
    for (const method of ["POST", "PUT", "DELETE"]) {
      const res = await call(asset(".tech/flow.png"), { method });
      expect({ method, status: res.status, allow: res.headers.get("allow") }).toEqual({ method, status: 405, allow: allowForWorkspace("libraryAsset") });
    }
    expect((await call(asset(".tech/flow.png"), { headers: { Host: "evil.example" } })).status).toBe(403);
  });

  test("read-only: served, missing and refused assets leave the copy byte-identical", async () => {
    const before = fingerprint(documented);
    for (const path of [".tech/flow.png", ".tech/gone.png", "../outside.png", ".tech/escape.png", "tech.md"]) {
      await call(asset(path));
      await call(asset(path), { method: "HEAD" });
    }
    expect(fingerprint(documented)).toEqual(before);
  });
});

describe("the removed routes (spec 017, T51, T53): the server's normal 404", () => {
  /** What `http.ts` `serve` sends when no handler claims an API path: the unknown API path's 404. */
  const served = async (path: string): Promise<Response> => {
    const url = new URL(`http://127.0.0.1:7717${path}`);
    return (await api(new Request(url.href, { headers: HOST }), url)) ?? Response.json({ error: "not found" }, { status: 404 });
  };
  const ws = `${SPEC_API_ROOT}/documented`;

  test.each([
    ["the tech page", `${ws}/tech`],
    ["the tech asset", `${ws}/tech/asset?path=.tech%2Fflow.png`],
    ["the Docs tab plan", `${ws}/specs/002/docs/plan`],
    ["the evidence listing", `${ws}/specs/002/evidence`],
  ])("%s: 404, never a body of the former route", async (_, path) => {
    const before = fingerprint(documented);
    const res = await served(path);
    expect({ path, status: res.status }).toEqual({ path, status: 404 });
    expect(Object.keys((await res.json()) as object)).toEqual(["error"]);
    expect(fingerprint(documented)).toEqual(before);
  });

  test("the evidence file route stays: a file below artifacts/ is still served", async () => {
    const res = await served(`${ws}/specs/002/evidence/file?path=artifacts%2FT12-dashboard-model.md`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toStartWith("text/markdown");
  });
});

// The evidence file route (T47, ISC-83; plan 002 § Interfaces "HTTP"): `GET …/evidence/file?path=` serves a file of the
// spec folder's `artifacts/` or `.evidence/` with `evidenceFileHeaders(mediaTypeOf(name))`, and nothing else. Anti:
// a path outside the spec folder, or outside those two folders inside it, is a 403 with no file byte and no path in
// the answer; a path that names no file is a 404.
//
// The workspace is a temp copy of the harbor fixture with planted files: an HTML report, a symlink out of the spec
// folder to a secret file beside the workspace, a symlink to the spec's own plan.md, a nested directory. The copy is
// hashed (every path, kind, mode, size and content) before and after, so serving is proven to write nothing; the secret
// beside it is compared byte for byte.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cpSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evidenceFileResponse } from "../server/src/evidence.ts";
import { LIFEOS_ABSENT } from "../server/src/lifeos.ts";
import { type Registry, openRegistry } from "../server/src/registry.ts";
import { evidenceFileHeaders, specRoutes } from "../server/src/spec-routes.contract.ts";
import { specRoutesApi } from "../server/src/spec-routes.ts";

const HARBOR = join(import.meta.dir, "..", "core", "fixtures", "harbor");
const HOST = { Host: "127.0.0.1:7717" };
const SECRET = "SECRET-BYTES-OUTSIDE-THE-SPEC-FOLDER";

let root: string;
let workspace: string;
let specDir: string;
let registry: Registry;
let api: ReturnType<typeof specRoutesApi>;

const sha256 = (bytes: Uint8Array | string): string => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");

/** One recursive hash over every path, kind, mode, size and content (link targets for symlinks); no git. */
function treeHash(dir: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  const walk = (at: string, prefix: string): void => {
    for (const name of readdirSync(at).sort()) {
      const absolute = join(at, name);
      const path = `${prefix}${name}`;
      const stat = lstatSync(absolute);
      if (stat.isSymbolicLink()) hasher.update(`L ${path} ${readlinkSync(absolute)}\n`);
      else if (stat.isDirectory()) {
        hasher.update(`D ${path} ${stat.mode & 0o7777}\n`);
        walk(absolute, `${path}/`);
      } else hasher.update(`F ${path} ${stat.mode & 0o7777} ${stat.size} ${sha256(readFileSync(absolute))}\n`);
    }
  };
  walk(dir, "");
  return hasher.digest("hex");
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "spectant-evidence-"));
  workspace = join(root, "harbor");
  cpSync(HARBOR, workspace, { recursive: true });
  specDir = join(workspace, "specs", "002-web-console");
  writeFileSync(join(root, "secret.log"), SECRET);
  writeFileSync(join(specDir, "artifacts", "T20-report.html"), "<!doctype html><script>alert(1)</script>");
  mkdirSync(join(specDir, "artifacts", "nested"));
  writeFileSync(join(specDir, "artifacts", "nested", "T21-deep.txt"), "deep\n");
  symlinkSync(join(root, "secret.log"), join(specDir, ".evidence", "escape.log"));
  symlinkSync("../plan.md", join(specDir, "artifacts", "plan-link.md"));
  symlinkSync("T12-dashboard-model.md", join(specDir, "artifacts", "inner-link.md"));
  registry = openRegistry(mkdtempSync(join(root, "data-")));
  registry.add(workspace);
  api = specRoutesApi({ registry, lifeos: LIFEOS_ABSENT });
});

afterAll(() => {
  registry.close();
  rmSync(root, { recursive: true, force: true });
});

/** GET the evidence file route with `rawPath` as the query value, sent exactly as given (no encoding here). */
async function fetchRaw(rawPath: string | null, init: { method?: string; headers?: Record<string, string> } = {}): Promise<Response> {
  const base = specRoutes.evidenceFile("harbor", "002", "x").replace(/\?.*$/, "");
  const url = new URL(`http://127.0.0.1:7717${base}${rawPath === null ? "" : `?path=${rawPath}`}`);
  const res = await api(new Request(url.href, { method: init.method ?? "GET", headers: { ...HOST, ...init.headers } }), url);
  if (res === null) throw new Error("the spec routes declined the evidence file route");
  return res;
}

const fetchPath = (path: string, init?: { method?: string; headers?: Record<string, string> }): Promise<Response> =>
  fetchRaw(encodeURIComponent(path), init);

describe("traversal", () => {
  test("traversal: `..`, double encoding, absolute paths, a symlink out, files outside the two folders → 403, nothing served", async () => {
    const before = treeHash(workspace);
    const refused: Array<string | null> = [
      "..%2Fspec.md",
      "../spec.md",
      "artifacts/../../spec.md",
      "artifacts%2F..%2F..%2Fspec.md",
      "%2e%2e/spec.md",
      "artifacts/%2e%2e/%2e%2e/spec.md",
      "%252e%252e%252fspec.md",
      "artifacts%252F..%252F..%252Fspec.md",
      "artifacts/%252e%252e/plan.md",
      encodeURIComponent(join(specDir, "spec.md")),
      "%2Fetc%2Fhosts",
      encodeURIComponent(join(root, "secret.log")),
      "C:%5Cwindows%5Cwin.ini",
      "artifacts%5C..%5C..%5Cspec.md",
      "artifacts/T12-dashboard-model.md%00.png",
      ".evidence%2Fescape.log",
      "artifacts%2Fplan-link.md",
      "plan.md",
      "spec.md",
      "tasks.md",
      ".gates%2Freviewed.json",
      "artifacts",
      ".evidence%2F",
      "",
      null,
    ];
    for (const raw of refused) {
      const res = await fetchRaw(raw);
      const text = await res.text();
      expect({ raw, status: res.status, body: text }).toEqual({ raw, status: 403, body: '{"error":"forbidden"}' });
      expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8");
      expect(res.headers.get("content-disposition")).toBeNull();
      for (const leak of [SECRET, root, workspace, "spec_type", "# "]) expect({ raw, leaked: text.includes(leak) }).toEqual({ raw, leaked: false });
    }
    // HEAD of a refused path is refused too, with no body.
    const head = await fetchRaw("../spec.md", { method: "HEAD" });
    expect(head.status).toBe(403);
    expect(await head.text()).toBe("");
    expect(treeHash(workspace)).toBe(before);
    expect(readFileSync(join(root, "secret.log"), "utf8")).toBe(SECRET);
  });

  test("traversal: evidenceFileResponse refuses on its own, whoever calls it", async () => {
    const req = new Request("http://127.0.0.1:7717/", { headers: HOST });
    for (const raw of ["../spec.md", "%252e%252e%252fspec.md", ".evidence%2Fescape.log", "plan.md"]) {
      const res = await evidenceFileResponse(req, specDir, `?path=${raw}`);
      expect({ raw, status: res.status }).toEqual({ raw, status: 403 });
    }
  });
});

describe("serving a file", () => {
  const cases = [
    { path: "artifacts/T12-dashboard-model.md", type: "text/markdown" },
    { path: ".evidence/kpi-band-390.png", type: "image/png" },
    { path: ".evidence/dashboard.har", type: "application/json" },
    { path: ".evidence/bun-test-r3.log", type: "text/plain" },
    { path: "artifacts/T20-report.html", type: "text/html" },
    { path: "artifacts/nested/T21-deep.txt", type: "text/plain" },
    { path: "artifacts/inner-link.md", type: "text/markdown", file: "artifacts/T12-dashboard-model.md" },
  ];

  test("a file of artifacts/ or .evidence/ is 200 with its bytes and evidenceFileHeaders of its media type", async () => {
    const before = treeHash(workspace);
    for (const { path, type, file } of cases) {
      const res = await fetchPath(path);
      expect({ path, status: res.status }).toEqual({ path, status: 200 });
      const bytes = new Uint8Array(await res.arrayBuffer());
      expect({ path, same: Buffer.from(bytes).equals(readFileSync(join(specDir, file ?? path))) }).toEqual({ path, same: true });
      for (const [name, value] of Object.entries(evidenceFileHeaders(type))) {
        expect({ path, name, value: res.headers.get(name) }).toEqual({ path, name, value });
      }
      expect(res.headers.get("etag")).toMatch(/^W\/"[0-9a-z]+-[0-9a-z]+"$/);
    }
    expect(treeHash(workspace)).toBe(before);
  });

  test("the headers per kind: charset for text, inline for markdown, images, logs and HAR, attachment and sandbox for HTML", async () => {
    const header = async (path: string): Promise<[string | null, string | null]> => {
      const res = await fetchPath(path);
      return [res.headers.get("content-type"), res.headers.get("content-disposition")];
    };
    expect(await header("artifacts/T12-dashboard-model.md")).toEqual(["text/markdown; charset=utf-8", "inline"]);
    expect(await header(".evidence/kpi-band-390.png")).toEqual(["image/png", "inline"]);
    expect(await header(".evidence/dashboard.har")).toEqual(["application/json; charset=utf-8", "inline"]);
    expect(await header(".evidence/bun-test-r3.log")).toEqual(["text/plain; charset=utf-8", "inline"]);
    expect(await header("artifacts/T20-report.html")).toEqual(["text/html; charset=utf-8", "attachment"]);
    const html = await fetchPath("artifacts/T20-report.html");
    expect(html.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    expect(html.headers.get("x-content-type-options")).toBe("nosniff");
  });

  test("ETag: a matching If-None-Match is a 304 without a body; HEAD sends the headers alone", async () => {
    const first = await fetchPath(".evidence/kpi-band-390.png");
    const etag = first.headers.get("etag") ?? "";
    const again = await fetchPath(".evidence/kpi-band-390.png", { headers: { "If-None-Match": etag } });
    expect(again.status).toBe(304);
    expect(await again.text()).toBe("");
    const head = await fetchPath(".evidence/kpi-band-390.png", { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.headers.get("etag")).toBe(etag);
    expect(head.headers.get("content-type")).toBe("image/png");
    expect(head.headers.get("content-length")).toBe(String(readFileSync(join(specDir, ".evidence", "kpi-band-390.png")).length));
    expect(await head.text()).toBe("");
  });

  test("a path inside the two folders that names no file is a 404, with no path in the answer", async () => {
    for (const path of ["artifacts/T99-missing.md", ".evidence/none.log", "artifacts/nested", "artifacts/nested/"]) {
      const res = await fetchPath(path);
      const text = await res.text();
      expect({ path, status: res.status, text }).toEqual({ path, status: 404, text: '{"error":"not-found"}' });
    }
  });
});

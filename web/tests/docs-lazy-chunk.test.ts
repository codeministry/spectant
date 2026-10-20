// The pinned `mermaid` package draws the Docs tabs' diagrams (T59, ISC-84). It is several hundred kB, so it must stay a
// lazy chunk: reached only through `import('mermaid')` in `shared/ui/doc-prose/mermaid.ts`, never in the initial bundle.
// The source check always runs; the build check reads `web/dist/browser/` when a build exists.
import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const WEB = join(import.meta.dir, "..");
const SRC = join(WEB, "src");
const DIST = join(WEB, "dist", "browser");
const MERMAID_VERSION = (JSON.parse(readFileSync(join(WEB, "package.json"), "utf8")) as { dependencies: Record<string, string> })
  .dependencies.mermaid;

function tsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return tsFiles(path);
    return entry.name.endsWith(".ts") ? [path] : [];
  });
}

/** The initial files: what index.html loads, plus every chunk they import statically (never `import(...)`). */
function initialFiles(): string[] {
  const html = readFileSync(join(DIST, "index.html"), "utf8");
  const queue = [...html.matchAll(/<(?:script[^>]*\bsrc|link[^>]*rel="modulepreload"[^>]*\bhref)="([^"]+\.js)"/g)].map((m) => m[1] ?? "");
  const seen = new Set<string>();
  while (queue.length > 0) {
    const file = queue.pop() ?? "";
    if (seen.has(file) || !existsSync(join(DIST, file))) continue;
    seen.add(file);
    const code = readFileSync(join(DIST, file), "utf8");
    for (const m of code.matchAll(/(?:\bfrom\s*|\bimport\s*)"\.\/([^"]+\.js)"/g)) queue.push(m[1] ?? "");
  }
  return [...seen];
}

describe("mermaid stays a lazy chunk", () => {
  test("is pinned to an exact version", () => {
    expect(MERMAID_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test("web/src imports it only dynamically, and only from the shared doc renderer", () => {
    const offenders: string[] = [];
    for (const file of tsFiles(SRC)) {
      const code = readFileSync(file, "utf8");
      const rel = relative(WEB, file);
      if (/from\s+['"]mermaid['"]|^\s*import\s+['"]mermaid['"]/m.test(code)) offenders.push(`${rel}: static import`);
      if (/import\(\s*['"]mermaid['"]\s*\)/.test(code) && rel !== join("src", "app", "shared", "ui", "doc-prose", "mermaid.ts")) {
        offenders.push(`${rel}: dynamic import outside the shared doc renderer`);
      }
    }
    expect(offenders).toEqual([]);
  });

  const noBuild = !existsSync(join(DIST, "index.html"));
  // Skipped when there is no build (a fresh checkout); `bun run --cwd web build` produces `web/dist/browser/`.
  test.skipIf(noBuild)("the initial bundle carries no mermaid code, a lazy chunk does (skipped without a build)", () => {
    const initial = initialFiles();
    expect(initial.length).toBeGreaterThan(0);
    const marker = new RegExp(`["'\x60]${(MERMAID_VERSION ?? "").replaceAll(".", "\\.")}["'\x60]`);
    for (const file of initial) expect(marker.test(readFileSync(join(DIST, file), "utf8")), file).toBe(false);
    const lazy = readdirSync(DIST).filter((file) => file.endsWith(".js") && !initial.includes(file));
    expect(lazy.some((file) => marker.test(readFileSync(join(DIST, file), "utf8")))).toBe(true);
  });
});

// The spec page (its head, gate button, overlaps and rail) is a route-level lazy chunk like every other page, so it does
// not weigh on the initial bundle and its 1 MB budget in angular.json (spec 021).
describe("the spec page stays a lazy chunk", () => {
  const ROUTES = join(SRC, "app", "app.routes.ts");

  test("app.routes.ts loads it through import(), never a static import", () => {
    const code = readFileSync(ROUTES, "utf8");
    expect(code).not.toMatch(/^\s*import\s[^;]*from\s+['"]\.\/features\/spec\/spec-page['"]/m);
    expect(code).toMatch(/loadComponent:\s*\(\)\s*=>\s*import\(\s*['"]\.\/features\/spec\/spec-page['"]\s*\)/);
  });

  const noBuild = !existsSync(join(DIST, "index.html"));
  test.skipIf(noBuild)("the initial bundle carries no spec head, a lazy chunk does (skipped without a build)", () => {
    const initial = initialFiles();
    expect(initial.length).toBeGreaterThan(0);
    const marker = /["'`]app-spec-head["'`]/;
    for (const file of initial) expect(marker.test(readFileSync(join(DIST, file), "utf8")), file).toBe(false);
    const lazy = readdirSync(DIST).filter((file) => file.endsWith(".js") && !initial.includes(file));
    expect(lazy.some((file) => marker.test(readFileSync(join(DIST, file), "utf8")))).toBe(true);
  });
});

// The not-found page is a lazy chunk (spec 024 review, spec 057): `app.routes.ts` imports `spec-area.routes.ts`
// statically, so a static `NotFound` import there pulls the page into the initial bundle.
describe("the notfound page stays a lazy chunk", () => {
  const ROUTE_FILES = [join(SRC, "app", "app.routes.ts"), join(SRC, "app", "features", "spec", "spec-area.routes.ts")];

  test("notfound: the route files load it through import(), never a static import", () => {
    for (const file of ROUTE_FILES) {
      expect(readFileSync(file, "utf8"), relative(WEB, file)).not.toMatch(/^\s*import\s[^;]*from\s+['"][^'"]*\/not-found\/not-found['"]/m);
    }
  });

  const noBuild = !existsSync(join(DIST, "index.html"));
  // The component definition (its selector list), not a template's `<app-not-found>` element, marks the page's code.
  test.skipIf(noBuild)("notfound: the initial bundle carries no NotFound component, a lazy chunk does (skipped without a build)", () => {
    const initial = initialFiles();
    expect(initial.length).toBeGreaterThan(0);
    const marker = /selectors:\[\[["'`]app-not-found["'`]\]\]/;
    for (const file of initial) expect(marker.test(readFileSync(join(DIST, file), "utf8")), file).toBe(false);
    const lazy = readdirSync(DIST).filter((file) => file.endsWith(".js") && !initial.includes(file));
    expect(lazy.some((file) => marker.test(readFileSync(join(DIST, file), "utf8")))).toBe(true);
  });
});

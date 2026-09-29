// The pinned `mermaid` package draws the Docs tabs' diagrams (T59, ISC-84). It is several hundred kB, so it must stay a
// lazy chunk: reached only through `import('mermaid')` in `features/spec/docs/mermaid.ts`, never in the initial bundle.
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

  test("web/src imports it only dynamically, and only from the docs feature", () => {
    const offenders: string[] = [];
    for (const file of tsFiles(SRC)) {
      const code = readFileSync(file, "utf8");
      const rel = relative(WEB, file);
      if (/from\s+['"]mermaid['"]|^\s*import\s+['"]mermaid['"]/m.test(code)) offenders.push(`${rel}: static import`);
      if (/import\(\s*['"]mermaid['"]\s*\)/.test(code) && rel !== join("src", "app", "features", "spec", "docs", "mermaid.ts")) {
        offenders.push(`${rel}: dynamic import outside the docs feature`);
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

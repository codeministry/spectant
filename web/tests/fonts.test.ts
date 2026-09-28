// Font guard for ISC-67 (T19): the app ships Inter Variable and JetBrains Mono as local woff2 assets. The files live
// in `web/public/fonts/` (Angular copies `public/` into the build root, so they are served from `/fonts/…`), each
// with its SIL OFL-1.1 text beside it; `web/src/styles/fonts.css` declares exactly one `@font-face` per file, and
// `web/src/index.html` preloads both. When a build exists, the embedded output must carry the same bytes.
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const WEB = join(import.meta.dir, "..");
const PUBLIC_FONTS = join(WEB, "public", "fonts");
const DIST_FONTS = join(WEB, "dist", "browser", "fonts");
const read = (...path: string[]) => readFileSync(join(WEB, ...path), "utf8");

const MIN_BYTES = 50 * 1024;
const MAX_BYTES = 600 * 1024;
const WOFF2_MAGIC = "wOF2";

const FACES = [
  { family: "Inter Variable", file: "inter-variable.woff2", license: "LICENSE-Inter.txt" },
  { family: "JetBrains Mono Variable", file: "jetbrains-mono-variable.woff2", license: "LICENSE-JetBrainsMono.txt" },
] as const;

/** The body of every `@font-face { … }` rule, comments stripped first so a commented-out rule does not count. */
function fontFaces(css: string): string[] {
  const code = css.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...code.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => m[1] ?? "");
}

/** The value of one declaration inside a rule body, trimmed, or undefined. */
function declaration(body: string, property: string): string | undefined {
  const match = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`).exec(body);
  return match?.[1]?.trim();
}

describe("local", () => {
  for (const face of FACES) {
    test(`${face.file} is a woff2 file of plausible size under web/public/fonts/`, () => {
      const path = join(PUBLIC_FONTS, face.file);
      expect(existsSync(path)).toBe(true);
      const bytes = readFileSync(path);
      expect(bytes.subarray(0, 4).toString("latin1")).toBe(WOFF2_MAGIC);
      expect(bytes.length).toBeGreaterThanOrEqual(MIN_BYTES);
      expect(bytes.length).toBeLessThanOrEqual(MAX_BYTES);
    });

    test(`${face.file} ships with its SIL Open Font License text`, () => {
      const path = join(PUBLIC_FONTS, face.license);
      expect(existsSync(path)).toBe(true);
      expect(readFileSync(path, "utf8")).toMatch(/SIL OPEN FONT LICENSE Version 1\.1/i);
    });
  }

  test("fonts.css declares exactly two @font-face rules, one per local file", () => {
    const faces = fontFaces(read("src", "styles", "fonts.css"));
    expect(faces).toHaveLength(FACES.length);

    for (const face of FACES) {
      const body = faces.find((b) => declaration(b, "font-family")?.replace(/["']/g, "") === face.family);
      expect(body, `@font-face for "${face.family}"`).toBeDefined();
      const rule = body ?? "";
      expect(declaration(rule, "src")).toBe(`url("/fonts/${face.file}") format("woff2")`);
      expect(declaration(rule, "font-weight")).toBe("100 900");
      expect(declaration(rule, "font-display")).toBe("swap");
    }
  });

  test("fonts.css sets the sans and mono stacks and tabular numbers on the body", () => {
    const css = read("src", "styles", "fonts.css");
    expect(css).toMatch(/--font-sans:\s*"Inter Variable",/);
    expect(css).toMatch(/--font-mono:\s*"JetBrains Mono Variable",/);
    expect(css).toMatch(/body\s*\{[^}]*font-family:\s*var\(--font-sans\)/);
    expect(css).toMatch(/body\s*\{[^}]*font-variant-numeric:\s*tabular-nums/);
  });

  test("styles.css imports fonts.css", () => {
    expect(read("src", "styles.css")).toMatch(/^@import "\.\/styles\/fonts\.css";$/m);
  });

  test("index.html preloads both faces as crossorigin woff2", () => {
    const html = read("src", "index.html");
    for (const face of FACES) {
      const link = new RegExp(`<link[^>]*href="/fonts/${face.file.replace(/\./g, "\\.")}"[^>]*>`).exec(html)?.[0];
      expect(link, `preload for ${face.file}`).toBeDefined();
      expect(link).toContain('rel="preload"');
      expect(link).toContain('as="font"');
      expect(link).toContain('type="font/woff2"');
      expect(link).toMatch(/\scrossorigin[\s>=]/);
    }
  });

  // Skipped when there is no build (a fresh checkout); `bun run --cwd web build` produces `web/dist/browser/`.
  const noBuild = !existsSync(DIST_FONTS);
  test.skipIf(noBuild)("the built output carries both files byte-for-byte (skipped without a build)", () => {
    for (const face of FACES) {
      const built = join(DIST_FONTS, face.file);
      expect(existsSync(built)).toBe(true);
      expect(statSync(built).size).toBe(statSync(join(PUBLIC_FONTS, face.file)).size);
      expect(readFileSync(built).equals(readFileSync(join(PUBLIC_FONTS, face.file)))).toBe(true);
    }
  });
});

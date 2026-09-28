// Font guard for ISC-67 (T19): the app ships Inter Variable and JetBrains Mono as local woff2 assets. The files live
// in `web/public/fonts/` (Angular copies `public/` into the build root, so they are served from `/fonts/…`), each
// with its SIL OFL-1.1 text beside it; `web/src/styles/fonts.css` declares exactly one `@font-face` per file, and
// `web/src/index.html` preloads both. When a build exists, the embedded output must carry the same bytes.
// The "external" block (ISC-67.1, T20) guards the other side: no stylesheet names a font URL off the app's origin.
import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

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

// Guard for ISC-67.1 (T20): no stylesheet the app serves declares a font URL outside the app's own origin. It scans
// every `*.css` under `web/src/`, the links and inline styles of `web/src/index.html`, and, when a build exists, every
// `*.css` under `web/dist/browser/` plus the built `index.html` (Angular inlines critical CSS there). A URL counts as
// external when it names a host (`scheme://…` or protocol-relative `//…`) or a known font CDN; root-relative
// `/fonts/…`, relative paths and bare package specifiers (`@import "tailwindcss"`) are served by the app itself.
const DIST_BROWSER = join(WEB, "dist", "browser");
const FONT_HOSTS = [
  "fonts.googleapis.com",
  "fonts.gstatic.com",
  "use.typekit.net",
  "fonts.bunny.net",
  "cdn.jsdelivr.net",
  "unpkg.com",
] as const;

/** True when fetching this URL leaves the machine: it carries an authority, or it names a known font host. */
function isExternal(url: string): boolean {
  const value = url.trim().toLowerCase();
  return /^(?:[a-z][a-z0-9+.-]*:)?\/\//.test(value) || FONT_HOSTS.some((host) => value.includes(host));
}

/** Every URL a stylesheet imports (`@import url(…)` / `@import "…"`) or loads inside an `@font-face` rule. */
function cssFontUrls(css: string): string[] {
  const code = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const imports = [...code.matchAll(/@import\s+(?:url\(\s*(["']?)([^"')]*)\1\s*\)|(["'])([^"']*)\3)/gi)].map(
    (m) => m[2] ?? m[4] ?? "",
  );
  const faceUrls = fontFaces(code).flatMap((body) =>
    [...body.matchAll(/url\(\s*(["']?)([^"')]*)\1\s*\)/gi)].map((m) => m[2] ?? ""),
  );
  return [...imports, ...faceUrls];
}

/** The external font and import URLs in one stylesheet. */
function externalCssUrls(css: string): string[] {
  return cssFontUrls(css).filter(isExternal);
}

/** The attributes of one start tag, names lower-cased, values unquoted. */
function attributes(tag: string): Map<string, string> {
  const attrs = new Map<string, string>();
  for (const m of tag.replace(/^<\w+/, "").matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
    attrs.set((m[1] ?? "").toLowerCase(), m[2] ?? m[3] ?? m[4] ?? "");
  }
  return attrs;
}

/** True for a `<link>` that fetches a stylesheet or a font, or opens a connection ahead of one. */
function isStyleOrFontLink(attrs: Map<string, string>): boolean {
  const rel = (attrs.get("rel") ?? "").toLowerCase().split(/\s+/);
  const as = (attrs.get("as") ?? "").toLowerCase();
  if (rel.includes("stylesheet") || rel.includes("preconnect") || rel.includes("dns-prefetch")) return true;
  return (rel.includes("preload") || rel.includes("prefetch")) && (as === "font" || as === "style");
}

/** The external font and stylesheet URLs in one HTML page: `<link>` hrefs and every inline `<style>` block. */
function externalHtmlUrls(html: string): string[] {
  const code = html.replace(/<!--[\s\S]*?-->/g, "");
  const links = [...code.matchAll(/<link\b[^>]*>/gi)]
    .map((m) => attributes(m[0]))
    .filter(isStyleOrFontLink)
    .map((attrs) => attrs.get("href") ?? "")
    .filter(isExternal);
  const inline = [...code.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].flatMap((m) => externalCssUrls(m[1] ?? ""));
  return [...links, ...inline];
}

/** Every `*.css` file under a directory, as paths relative to `web/`, sorted. */
function stylesheetsUnder(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((path) => path.endsWith(".css"))
    .map((path) => relative(WEB, join(dir, path)))
    .sort();
}

/** `{ file: [external URLs] }` for every file with at least one; empty when the tree is clean. */
function offenders(files: string[], scan: (text: string) => string[]): Record<string, string[]> {
  return Object.fromEntries(files.map((file) => [file, scan(read(file))] as const).filter(([, urls]) => urls.length > 0));
}

describe("external", () => {
  // Self-check: a scanner that finds nothing passes any tree, so it must first flag each synthetic offender.
  const OFFENDING_CSS = [
    '@import url("https://fonts.googleapis.com/css2?family=Inter");',
    "@import url(https://fonts.googleapis.com/css2?family=Inter);",
    "@import 'http://example.com/fonts.css';",
    '@import "//fonts.bunny.net/css?family=inter:400";',
    '@import "fonts.googleapis.com/css2?family=Inter";',
    '@font-face { font-family: "X"; src: url("https://fonts.gstatic.com/s/inter/v1/x.woff2") format("woff2"); }',
    "@font-face { font-family: X; src: local(X), url(//use.typekit.net/af/x.woff2) format('woff2'); }",
    '@font-face { font-family: "X"; src: url("https://cdn.jsdelivr.net/npm/inter-ui/x.woff2"); }',
    '@font-face { font-family: "X"; src: url("https://unpkg.com/inter-ui/x.woff2"); }',
  ] as const;

  for (const css of OFFENDING_CSS) {
    test(`the scanner flags a synthetic offending stylesheet: ${css}`, () => {
      expect(externalCssUrls(css)).toHaveLength(1);
    });
  }

  test("the scanner passes same-origin forms and ignores commented-out rules", () => {
    const clean = [
      '@import "tailwindcss";',
      '@import "./styles/fonts.css";',
      "@import url(tokens.css);",
      '@plugin "daisyui";',
      '@font-face { font-family: "Inter Variable"; src: url("/fonts/inter-variable.woff2") format("woff2"); }',
      '@font-face { font-family: "Mono"; src: local("Mono"), url(../fonts/mono.woff2) format("woff2"); }',
      '/* @import url("https://fonts.googleapis.com/css2?family=Inter"); */',
      'body { background: url("https://example.com/not-a-font.png"); }',
    ].join("\n");
    expect(cssFontUrls(clean)).toHaveLength(5);
    expect(externalCssUrls(clean)).toEqual([]);
  });

  test("the scanner flags a synthetic offending index.html", () => {
    const offending = [
      '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">',
      "<link href='//fonts.gstatic.com/s/inter/x.woff2' rel=preload as=font crossorigin>",
      '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
      '<style>@import url("https://fonts.bunny.net/css?family=inter");</style>',
    ];
    for (const line of offending) expect(externalHtmlUrls(line), line).toHaveLength(1);

    const clean = [
      '<link rel="icon" type="image/x-icon" href="favicon.ico">',
      '<link rel="preload" href="/fonts/inter-variable.woff2" as="font" type="font/woff2" crossorigin>',
      '<link rel="stylesheet" href="styles-ABC123.css">',
      '<!-- <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter"> -->',
      '<style>@font-face{font-family:"Inter Variable";src:url(/fonts/inter-variable.woff2) format("woff2")}</style>',
    ].join("\n");
    expect(externalHtmlUrls(clean)).toEqual([]);
  });

  test("no stylesheet under web/src declares an external font or import URL", () => {
    const sheets = stylesheetsUnder(join(WEB, "src"));
    expect(sheets).toContain(join("src", "styles", "fonts.css"));
    expect(offenders(sheets, externalCssUrls)).toEqual({});
  });

  test("web/src/index.html links no external stylesheet or font", () => {
    expect(externalHtmlUrls(read("src", "index.html"))).toEqual([]);
  });

  // Skipped when there is no build (a fresh checkout); `bun run --cwd web build` produces `web/dist/browser/`.
  const noBuild = !existsSync(join(DIST_BROWSER, "index.html"));
  test.skipIf(noBuild)("the built stylesheets and index.html carry no external font URL (skipped without a build)", () => {
    const sheets = stylesheetsUnder(DIST_BROWSER);
    expect(sheets.length).toBeGreaterThan(0);
    expect(offenders(sheets, externalCssUrls)).toEqual({});
    expect(externalHtmlUrls(read("dist", "browser", "index.html"))).toEqual([]);
  });
});

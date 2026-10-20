// CSS custom property guard (spec 057, ISC-389). A `var(--x)` whose property nobody defines resolves to the
// property's initial value without a sound: a text colour falls back to inherited, a border to none, a length to 0.
// Spec 024 shipped such a reference (`--lime-text`, a prototype ink the themes never carried), and no test noticed.
//
// The guard collects every custom property definition the app can see and every reference under `web/src`, and fails
// on a reference with no definition:
// - definitions: `--x:` in every own stylesheet under `web/src` (the theme and token files, `fonts.css`,
//   `primitives.css`, the `.css` files under `src/app` and the inline `styles` of components), `@property --x`, the
//   variables daisyUI's own stylesheets define (from the installed package), and properties the app sets from markup
//   or TypeScript: `style="--x: …"`, `[style.--x]` bindings (also as `host` keys) and `style.setProperty('--x', …)`;
// - references: every `var(--x` in those stylesheets, in templates (`style` attributes and `[style.*]` bindings) and in
//   the string literals of the app's TypeScript (a tone map such as `color: 'var(--ok-ink)'`), comments left out.
//
// A reference with a fallback, `var(--x, 4px)`, still counts: the fallback hides a misspelt name exactly as the
// silent initial value does, so the name must be defined somewhere. Specs (`*.spec.ts`) are left out.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { type Source, stylesheets, templates, walk } from "./sources";

const WEB = join(import.meta.dir, "..");
const SRC = join(WEB, "src");
const DAISY = join(WEB, "node_modules", "daisyui");

/** CSS and markup with comments left out (block and HTML comments; `//` line comments for TypeScript sources). */
function stripComments(text: string, ts = false): string {
  const blocks = text.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/<!--[\s\S]*?-->/gu, "");
  return ts ? blocks.replace(/^\s*\/\/.*$/gmu, "") : blocks;
}

/** The custom properties a source defines: declarations, `@property` rules, style bindings and `setProperty` calls. */
function definedIn(text: string): string[] {
  const code = stripComments(text, true);
  return [
    ...code.matchAll(/(?:^|[\s;{("'])(--[A-Za-z0-9_-]+)\s*:/gmu),
    ...code.matchAll(/@property\s+(--[A-Za-z0-9_-]+)/gu),
    ...code.matchAll(/\[style\.(--[A-Za-z0-9_-]+)(?:\.[a-z%]+)?\]/gu),
    ...code.matchAll(/setProperty\(\s*['"`](--[A-Za-z0-9_-]+)/gu),
  ].map((m) => m[1] ?? "");
}

/** The custom properties a source references through `var(`. */
function referencedIn(text: string): string[] {
  return [...stripComments(text, true).matchAll(/var\(\s*(--[A-Za-z0-9_-]+)/gu)].map((m) => m[1] ?? "");
}

/** References with no definition, as `file: --name`. Pure: the caller hands in the sources and the definition set. */
function undefinedVars(sources: readonly Source[], defined: ReadonlySet<string>): string[] {
  return sources.flatMap(({ file, text }) =>
    [...new Set(referencedIn(text))].filter((name) => !defined.has(name)).map((name) => `${file}: ${name}`),
  );
}

const own = stylesheets(SRC, WEB);
const markup = templates(join(SRC, "app"), WEB);
const scripts: Source[] = walk(join(SRC, "app"))
  .filter((path) => path.endsWith(".ts") && !path.endsWith(".spec.ts"))
  .map((path) => ({ file: relative(WEB, path), text: readFileSync(path, "utf8") }));
const daisyCss = walk(DAISY)
  .filter((path) => path.endsWith(".css"))
  .map((path) => readFileSync(path, "utf8"));

// Each file once: `.css` stylesheets, `.html` templates, and every TypeScript file whole (its inline `styles`,
// `template`, `host` and `*_STYLES` constants are in its text).
const sources: Source[] = [...own.filter(({ file }) => file.endsWith(".css")), ...markup.filter(({ file }) => file.endsWith(".html")), ...scripts];
const defined = new Set(sources.flatMap(({ text }) => definedIn(text)));
const daisyDefined = new Set(daisyCss.flatMap((css) => definedIn(css)));
const all = new Set([...defined, ...daisyDefined]);

describe("CSS custom properties are defined (spec 057, ISC-389)", () => {
  test("the definition sets are read", () => {
    for (const name of ["--color-base-100", "--muted", "--motion-duration-highlight", "--font-mono"]) expect(all.has(name), name).toBe(true);
    expect(daisyDefined.has("--btn-color"), "daisyUI's own variables").toBe(true);
  });

  test("a reference with no definition is a hit, a fallback does not excuse it", () => {
    const fixture: Source[] = [
      { file: "fixture/lime.css", text: ".tag { color: var(--lime-text); }" },
      { file: "fixture/inline.ts", text: "styles: `.x { gap: var(--gap-missing, 4px); border-color: var(--line); }`" },
      { file: "fixture/fine.css", text: "/* var(--commented-out) */ .y { --local: 1px; inset: var(--local); color: var(--muted); }" },
    ];
    const defs = new Set(["--line", "--muted", ...fixture.flatMap(({ text }) => definedIn(text))]);
    expect(undefinedVars(fixture, defs)).toEqual(["fixture/lime.css: --lime-text", "fixture/inline.ts: --gap-missing"]);
  });

  test("every var() under web/src names a defined custom property", () => {
    expect(sources.length).toBeGreaterThan(200);
    expect(undefinedVars(sources, all)).toEqual([]);
  });
});

// Token guard for ISC-133 (T142): the board, help and ideas features paint only with tokens. Every colour, font,
// radius and shadow in their styles is a `var(--…)` token (a card's edge and glow come from `ui-card`'s variants), so a
// stray value cannot drift from the two themes in `web/src/styles.css`. The guard reads each `.css` file and the inline
// `styles` of each component under the folders in FEATURES (specs excluded), plus every quoted string in `.ts` and
// `.html` files there (a colour bound through `[style.--x]` arrives as one), and fails on:
//
// - any hex colour or colour function (`rgb()`, `hsl()`, `hwb()`, `lab()`, `lch()`, `oklab()`, `oklch()`) in any
//   declaration, custom properties included;
// - a named colour in a colour property: after `var(--…)` is removed only keywords stay (transparent, currentColor,
//   border styles, gradient words, CSS system colours for forced-colors mode);
// - a `font-family` that is not one `var(--font-…)`, or a `font` shorthand;
// - a radius that is not `0`, `inherit` or `var(--radius-…)`;
// - a `box-shadow` or `text-shadow` other than `none` (or the focus halo), or a `drop-shadow()` filter.
//
// `color-no-hex` (stylelint, `.stylelintrc.json`) covers the same folders' `.css` files through its `web/src/**/*.css`
// glob; the last block proves that override list exempts none of them.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import stylelint from "stylelint";

const ROOT = join(import.meta.dir, "..", "..");
const SRC = join(import.meta.dir, "..", "src");
const FEATURES = ["app/features/board", "app/features/help", "app/features/ideas"];

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return filesUnder(path);
    return /\.(css|ts|html)$/.test(entry.name) && !entry.name.endsWith(".spec.ts") ? [path] : [];
  });
}

type Finding = string;

const HEX = /#[0-9a-f]{3,8}\b/i;
const COLOUR_FN = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/i;
const COLOUR_PROP =
  /^(?:color|background(?:-color|-image)?|border(?:-(?:block|inline|top|right|bottom|left)(?:-(?:start|end))?)?(?:-color)?|outline(?:-color)?|fill|stroke|caret-color|accent-color|text-decoration(?:-color)?|column-rule(?:-color)?|scrollbar-color)$/;
const SYSTEM_COLOURS = [
  "canvas", "canvastext", "linktext", "visitedtext", "activetext", "buttonface", "buttontext", "buttonborder", "field",
  "fieldtext", "highlight", "highlighttext", "selecteditem", "selecteditemtext", "mark", "marktext", "graytext",
  "accentcolor", "accentcolortext",
];
const KEYWORDS = new Set([
  "transparent", "currentcolor", "inherit", "initial", "unset", "revert", "auto", "none",
  "solid", "dashed", "dotted", "double", "hidden", "groove", "ridge", "inset", "outset", "thin", "medium", "thick",
  "linear-gradient", "repeating-linear-gradient", "to", "left", "right", "top", "bottom", "color-mix", "in", "srgb",
  "no-repeat", "center", "cover", "contain", "padding-box", "border-box", "content-box",
  "underline", "overline", "line-through", "wavy", "from-font",
  ...SYSTEM_COLOURS,
]);
const NUMBER = /^-?[\d.]+(?:[a-z]+|%)?$/i;
const FOCUS_HALO = "0 0 0 4px var(--focus-halo)";

/** The CSS a source carries: a stylesheet as it is, a component's backtick `styles` literal(s). */
function cssOf(path: string, text: string): string {
  if (path.endsWith(".css")) return text;
  if (!path.endsWith(".ts")) return "";
  return [...text.matchAll(/styles:\s*\[?\s*`([^`]*)`/g)].map((m) => m[1] ?? "").join("\n");
}

/** Every `property: value` of a stylesheet, comments removed; a selector's pseudo-class never ends in `;` or `}`. */
function declarations(css: string): Array<{ prop: string; value: string }> {
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...bare.matchAll(/(?<=[{;]\s*)(--[\w-]+|-?[a-z][a-z-]*)\s*:\s*([^;{}]+?)\s*(?=[;}])/gi)].map((m) => ({
    prop: (m[1] ?? "").toLowerCase(),
    value: m[2] ?? "",
  }));
}

/** The findings of one source file (`file` relative to `web/src`). The negative tests feed it too. */
function findings(file: string, text: string): Finding[] {
  const out: Finding[] = [];
  for (const { prop, value } of declarations(cssOf(file, text))) {
    const at = `${file}: ${prop}: ${value}`;
    const literal = HEX.test(value) || COLOUR_FN.test(value);
    if (literal) out.push(`${at} (literal colour)`);
    if (!literal && COLOUR_PROP.test(prop)) {
      // `var(--a, var(--b))` keeps only its fallback text, so a named colour hidden in a fallback is still seen.
      const rest = value.replace(/var\(\s*--[\w-]+\s*,?/g, "(").replace(/url\([^)]*\)/g, " ");
      const words = rest.split(/[\s,()/]+/).filter((w) => w !== "" && !NUMBER.test(w));
      const named = words.filter((w) => !KEYWORDS.has(w.toLowerCase()));
      if (named.length > 0) out.push(`${at} (named colour ${named.join(", ")})`);
    }
    if (prop === "font-family" && !/^(?:var\(--font-[\w-]+\)|inherit)$/.test(value)) out.push(`${at} (font not a token)`);
    if (prop === "font") out.push(`${at} (font shorthand)`);
    if (/^border(?:-[a-z-]+)?-radius$/.test(prop)) {
      const bad = value.split(/\s+/).filter((v) => !/^(?:0|inherit|var\(--radius-[\w-]+\))$/.test(v));
      if (bad.length > 0) out.push(`${at} (radius not a token)`);
    }
    if ((prop === "box-shadow" || prop === "text-shadow") && value !== "none" && value !== FOCUS_HALO) {
      out.push(`${at} (shadow outside ui-card)`);
    }
    if (prop === "filter" && value.includes("drop-shadow(")) out.push(`${at} (drop-shadow)`);
  }
  if (/\.(ts|html)$/.test(file)) {
    for (const m of text.matchAll(/(['"`])\s*(#[0-9a-f]{3,8}|(?:rgba?|hsla?|oklch|oklab)\([^'"`]*\))\s*\1/gi)) {
      out.push(`${file}: quoted literal colour ${m[2] ?? ""}`);
    }
  }
  return out;
}

const SOURCES = FEATURES.flatMap((folder) =>
  filesUnder(join(SRC, folder)).map((path) => ({ file: relative(SRC, path), text: readFileSync(path, "utf8") })),
);

describe("board, help and ideas paint with tokens only (ISC-133, T142)", () => {
  test("every folder is scanned and yields declarations", () => {
    for (const folder of FEATURES) {
      const own = SOURCES.filter(({ file }) => file.startsWith(`${folder}/`));
      expect(own.length, folder).toBeGreaterThan(0);
      expect(own.flatMap(({ file, text }) => declarations(cssOf(file, text))).length, folder).toBeGreaterThan(0);
    }
  });

  test("no literal colour, font, radius or shadow", () => {
    expect(SOURCES.flatMap(({ file, text }) => findings(file, text))).toEqual([]);
  });

  test("negative: a hex colour, a named colour, a literal font, radius or glow in features/board/x.css fails", () => {
    const file = "app/features/board/x.css";
    const cases = [
      ".x { color: #ff6188; }",
      ".x { border: 1px solid red; }",
      ".x { --edge: oklch(70% 0.1 200); }",
      ".x { font-family: Sora, sans-serif; }",
      ".x { border-radius: 999px; }",
      ".x { box-shadow: 0 0 24px var(--disp); }",
    ];
    for (const css of cases) expect(findings(file, css).length, css).toBe(1);
    expect(findings(file, ".x { color: var(--disp-ink); border-radius: var(--radius-box); }")).toEqual([]);
  });

  test("negative: a quoted hex bound from a component in features/board fails", () => {
    expect(findings("app/features/board/x.ts", "const EDGE = { done: '#a6e22e' };")).toHaveLength(1);
  });
});

describe("color-no-hex covers board, help and ideas (ISC-133, T142)", () => {
  const lint = async (file: string, code: string) => {
    const result = await stylelint.lint({ code, codeFilename: join(SRC, file), configFile: join(ROOT, ".stylelintrc.json") });
    return (result.results[0]?.warnings ?? []).filter((w) => w.rule === "color-no-hex").length;
  };

  test("negative: a hex colour in features/board/x.css, features/help/x.css and features/ideas/x.css is reported", async () => {
    for (const folder of FEATURES) expect(await lint(`${folder}/x.css`, ".x { color: #ff6188; }\n"), folder).toBe(1);
  });

  test("control: only the two theme files are exempt", async () => {
    expect(await lint("styles/tokens.css", ".x { color: #ff6188; }\n")).toBe(0);
    expect(await lint("app/features/board/x.css", ".x { color: var(--disp-ink); }\n")).toBe(0);
  });
});

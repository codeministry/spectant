// Colour guard for ISC-18 (T17; reference switched by spec 063, T13): the daisyUI themes `spec-light` and `spec-dark`
// in `web/src/styles.css` carry the app's light and dark colour slots. The reference is the app's own look snapshot
// `fixtures/look-snapshot.json` (spec 063), whose `tokens` part holds each slot's resolved 8-bit hex per theme; ISC-18
// stays closed. Every colour is written as `oklch(L C H)` with its source hex in a trailing comment; this guard
// converts each OKLCH value back to sRGB and measures it against the snapshot hex (and, for every colour in the theme
// blocks, against its own comment).
//
// Distance metric: ΔE_OK × 100, i.e. the Euclidean distance in OKLab scaled by 100 (OKLab L runs 0…1, so the
// scaled metric sits on roughly the same scale as CIE ΔE; ~2 is a just-noticeable difference). Threshold: 0.5.
// The OKLab matrices are Björn Ottosson's reference values; sRGB uses the IEC 61966-2-1 transfer function.
// The exact-value guard of every token, colours and the rest, is `look-snapshot.test.ts`.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseColour, readSnapshot, THEMES } from "./look-snapshot";

/** Narrow a regex capture or array slot without a `!` assertion; a miss is a broken fixture, so it throws. */
const must = <T,>(value: T | null | undefined, what = "value"): T => {
  if (value === null || value === undefined) throw new Error(`missing ${what}`);
  return value;
};

const MAX_DELTA_E = 0.5;
const STYLES = readFileSync(join(import.meta.dir, "..", "src", "styles.css"), "utf8");
const TOKENS_CSS = readFileSync(join(import.meta.dir, "..", "src", "styles", "tokens.css"), "utf8");
/** The daisyUI theme names; the snapshot keys them without the `spec-` prefix. */
const THEME_NAMES = THEMES.map((t) => `spec-${t}` as const);
type Theme = (typeof THEME_NAMES)[number];
const snapshotKey = (theme: Theme) => theme.slice("spec-".length) as (typeof THEMES)[number];

// ── Colour math (no dependencies). ──
type Rgb = [number, number, number]; // sRGB, 0…1, gamma-encoded
type Lab = [number, number, number]; // OKLab

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function srgbToOklab([r, g, b]: Rgb): Lab {
  const [lr, lg, lb] = [r, g, b].map(toLinear) as Rgb;
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function oklabToSrgb([L, a, b]: Lab): Rgb {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map(toGamma) as Rgb;
}

const oklchToOklab = (L: number, C: number, H: number): Lab => [
  L,
  C * Math.cos((H * Math.PI) / 180),
  C * Math.sin((H * Math.PI) / 180),
];

function hexToSrgb(hex: string): Rgb {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) throw new Error(`not a #rrggbb hex: ${hex}`);
  return [m[1], m[2], m[3]].map((h) => Number.parseInt(must(h), 16) / 255) as Rgb;
}

const deltaEok = (x: Lab, y: Lab) => 100 * Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);

type Oklch = { L: number; C: number; H: number; alpha: number };

function parseOklch(src: string): Oklch {
  const m = /^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+))?\s*\)$/.exec(src);
  if (!m) throw new Error(`unparseable oklch: ${src}`);
  const L = Number(m[1]) / (m[2] ? 100 : 1);
  return { L, C: Number(m[3]), H: Number(m[4]), alpha: m[5] === undefined ? 1 : Number(m[5]) };
}

/** OKLCH → sRGB (clamped to the gamut, as a browser paints it) → OKLab, measured against the reference sRGB. */
function roundTrip(value: Oklch, reference: Rgb): number {
  const painted = oklabToSrgb(oklchToOklab(value.L, value.C, value.H)).map((c) => Math.min(1, Math.max(0, c))) as Rgb;
  return deltaEok(srgbToOklab(painted), srgbToOklab(reference));
}

// ── CSS parsing: the theme blocks hold flat declarations only, so no CSS parser is needed. ──
type Decl = { name: string; value: string; comment: string | undefined };

function themeBlock(name: string): string {
  const blocks = [...STYLES.matchAll(/@plugin\s+"daisyui\/theme"\s*\{([^}]*)\}/g)].map((m) => must(m[1]));
  const found = blocks.filter((b) => new RegExp(`\\bname:\\s*"${name}"\\s*;`).test(b));
  if (found.length !== 1) throw new Error(`expected exactly one daisyUI theme block "${name}", found ${found.length}`);
  return must(found[0]);
}

/** One declaration per line, optional trailing comment; comment-only lines are skipped. */
function declarations(block: string): Decl[] {
  const decls: Decl[] = [];
  for (const line of block.split("\n")) {
    const m = /^\s*([\w-]+)\s*:\s*([^;]+);\s*(?:\/\*\s*(.*?)\s*\*\/)?\s*$/.exec(line);
    if (m) decls.push({ name: must(m[1]), value: must(m[2]).trim(), comment: m[3] });
  }
  return decls;
}

const decl = (decls: Decl[], name: string) => decls.find((d) => d.name === name);
const oklchValues = (value: string) => [...value.matchAll(/oklch\([^)]*\)/g)].map((m) => m[0]);

describe("styles.css", () => {
  test("daisyUI ships no stock theme", () => {
    expect(STYLES).toMatch(/@plugin\s+"daisyui"\s*\{[^}]*\bthemes:\s*false\s*;[^}]*\}/);
  });

  test("no prefers-color-scheme block of its own (data-theme is set by the pre-paint script)", () => {
    expect(STYLES).not.toMatch(/@media[^{]*prefers-color-scheme/);
  });
});

for (const theme of THEME_NAMES) {
  describe(`theme ${theme}`, () => {
    const load = () => declarations(themeBlock(theme));

    test("header: name, default, colour scheme", () => {
      const d = load();
      const dark = theme === "spec-dark";
      expect(decl(d, "color-scheme")?.value).toBe(dark ? "dark" : "light");
      expect(decl(d, "prefersdark")?.value).toBe(dark ? "true" : "false");
      if (!dark) expect(decl(d, "default")?.value).toBe("true");
    });

    test("--depth: 0 and --noise: 0 (no bevel, no grain)", () => {
      const d = load();
      expect(decl(d, "--depth")?.value).toBe("0");
      expect(decl(d, "--noise")?.value).toBe("0");
    });


    test("every colour is oklch with its source in a comment, all within ΔE 0.5", () => {
      const failures: string[] = [];
      for (const { name, value, comment } of load()) {
        if (/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i.test(value)) failures.push(`${name}: non-OKLCH colour ${value}`);
        const values = oklchValues(value);
        // `#rrggbbaa` (the shadow colour) counts as one source; its alpha is checked by the T84 block.
        const sources = [...(comment ?? "").matchAll(/#[0-9a-f]{8}\b|#[0-9a-f]{6}\b|rgba?\([^)]*\)/gi)].map((m) => m[0]);
        if (values.length === 0) {
          if (name.startsWith("--color-")) failures.push(`${name}: colour slot without oklch()`);
          if (sources.length > 0) failures.push(`${name}: ${sources.join(", ")} has no oklch() value`);
          continue;
        }
        if (sources.length !== values.length) {
          failures.push(`${name}: ${values.length} oklch() value(s) but ${sources.length} source colour(s) in the comment`);
          continue;
        }
        values.forEach((v, i) => {
          const source = must(sources[i]);
          const rgb: Rgb = source.startsWith("#")
            ? hexToSrgb(source.slice(0, 7))
            : (source.match(/[\d.]+/g)?.slice(0, 3).map((c) => Number(c) / 255) as Rgb);
          const dE = roundTrip(parseOklch(v), rgb);
          if (dE > MAX_DELTA_E) failures.push(`${name}: ${v} vs ${source} ΔE_OK×100 ${dE.toFixed(3)}`);
        });
      }
      expect(failures).toEqual([]);
    });
  });
}

/** Flat declarations of the `tokens.css` rule with exactly this selector. */
function tokensRule(selector: string): Decl[] {
  const found = [...TOKENS_CSS.matchAll(/^([^\n{}]+?)\s*\{([^{}]*)\}/gm)].filter((m) => must(m[1]).trim() === selector);
  if (found.length !== 1) throw new Error(`expected one "${selector}" rule in tokens.css, found ${found.length}`);
  return declarations(must(found[0]?.[2]));
}

/** The declaration of a custom property on the `data-theme` element: the tokens.css theme rule, the tokens.css shared
 * rule, then the daisyUI theme block, as the cascade resolves it. */
function findDecl(theme: Theme, name: string): Decl {
  const scopes = [tokensRule(`[data-theme="${theme}"]`), tokensRule("[data-theme]"), declarations(themeBlock(theme))];
  return must(scopes.map((s) => decl(s, name)).find(Boolean), `${name} for ${theme}`);
}

/** Resolve a custom property to its oklch() value, following `var()` aliases. */
function resolveOklch(theme: Theme, name: string, seen: string[] = []): Oklch {
  if (seen.includes(name)) throw new Error(`var() cycle: ${[...seen, name].join(" → ")}`);
  const found = findDecl(theme, name);
  const alias = /^var\(\s*(--[\w-]+)\s*\)$/.exec(found.value);
  if (alias) return resolveOklch(theme, must(alias[1]), [...seen, name]);
  return parseOklch(found.value);
}

/** An accent family: its colour slot(s), its tint and its text ink on the card or page. */
type Family = { accent: readonly string[]; tint: string; text: string };

const FAMILIES: readonly Family[] = [
  { accent: ["--color-primary", "--color-info"], tint: "--disp-t", text: "--disp-text" },
  { accent: ["--color-secondary"], tint: "--ques-t", text: "--ques-text" },
  { accent: ["--color-accent"], tint: "--clos-t", text: "--clos-text" },
  { accent: ["--color-success"], tint: "--done-t", text: "--done-text" },
  { accent: ["--conc"], tint: "--conc-t", text: "--conc-text" },
  { accent: ["--color-warning"], tint: "--hover-t", text: "--hover-text" },
  { accent: ["--color-error"], tint: "--fail-t", text: "--fail-text" },
];

/** Slots that hold one value under several names (a daisyUI slot and its custom-property twin); they must not drift. */
const TWINS: ReadonlyArray<readonly string[]> = [
  ["--color-primary", "--color-info"],
  ["--badge", "--color-neutral", "--badge-fill"],
  ["--color-neutral-content", "--badge-ink"],
];

/** Every colour slot of the theme blocks this guard measures: surfaces and text, the accent families, teal, badge. */
const SLOTS: readonly string[] = [
  "--color-base-200", "--color-base-100", "--color-base-300", "--lane", "--color-base-content", "--muted", "--line",
  "--track", "--scrim", "--shadow-color",
  ...FAMILIES.flatMap((f) => [...f.accent, f.tint, f.text]),
  "--teal", "--teal-content",
  ...TWINS.slice(1).flat(),
];

/** The snapshot's resolved hex of each slot, in `SLOTS` order; a slot the snapshot lacks has no entry. */
function snapshotColours(theme: Theme): Array<[string, string]> {
  const tokens = readSnapshot()?.tokens?.[snapshotKey(theme)] ?? {};
  return SLOTS.flatMap((slot) => {
    const hex = tokens[slot];
    return hex === undefined ? [] : [[slot, hex] as [string, string]];
  });
}

// The colour tokens the old pages lacked (T84): the themes had no slot for them, so they are declared in the
// daisyUI theme blocks themselves.
const ADDED = [
  "--disp-text", "--ques-text", "--clos-text", "--done-text", "--conc-text", "--hover-text", "--fail-text",
  "--teal", "--teal-content", "--shadow-color",
];

for (const theme of THEME_NAMES) {
  describe(`theme ${theme}: the app's palette (look snapshot)`, () => {
    test("the snapshot holds every colour slot as a hex colour", () => {
      const colours = new Map(snapshotColours(theme));
      const failures = SLOTS.filter((slot) => !/^#[0-9a-f]{6}([0-9a-f]{2})?$/.test(colours.get(slot) ?? ""));
      expect(failures).toEqual([]);
    });

    test("the tokens the themes lacked are declared in the daisyUI theme block", () => {
      const names = new Set(declarations(themeBlock(theme)).map((d) => d.name));
      expect(ADDED.filter((name) => !names.has(name))).toEqual([]);
    });

    test("twin slots hold one value in the snapshot", () => {
      const colours = new Map(snapshotColours(theme));
      const failures = TWINS.filter((twins) => new Set(twins.map((slot) => colours.get(slot))).size !== 1).map(
        (twins) => twins.map((slot) => `${slot} ${colours.get(slot) ?? "missing"}`).join(" / "),
      );
      expect(failures).toEqual([]);
    });

    test("every slot round-trips to its snapshot hex (ΔE_OK×100 ≤ 0.5, alpha within 1/255)", () => {
      const failures: string[] = [];
      for (const [slot, hex] of snapshotColours(theme)) {
        const reference = parseColour(hex);
        let value: Oklch;
        try {
          value = resolveOklch(theme, slot);
        } catch (error) {
          failures.push(`${slot}: ${(error as Error).message}`);
          continue;
        }
        const dE = roundTrip(value, reference.rgb);
        if (dE > MAX_DELTA_E) failures.push(`${slot}: ΔE_OK×100 ${dE.toFixed(3)} > ${MAX_DELTA_E}`);
        if (Math.abs(value.alpha - reference.alpha) > 1 / 255) {
          failures.push(`${slot}: alpha ${value.alpha} vs ${reference.alpha.toFixed(3)} (${hex})`);
        }
      }
      expect(failures).toEqual([]);
    });

    test("a slot written as oklch() names its snapshot hex at the start of its comment", () => {
      const failures: string[] = [];
      for (const [slot, hex] of snapshotColours(theme)) {
        const found = findDecl(theme, slot);
        if (!found.value.startsWith("oklch(")) continue;
        if (/^rgba?\(/.test(found.comment ?? "")) continue; // the scrim is noted as rgba(); its alpha is checked above
        const commentHex = /^#[0-9a-f]{6}([0-9a-f]{2})?\b/i.exec(found.comment ?? "")?.[0].toLowerCase();
        if (commentHex !== hex) failures.push(`${slot}: comment starts with ${commentHex ?? "no hex"}, expected ${hex}`);
      }
      expect(failures).toEqual([]);
    });

    test("a -text ink equal to its accent aliases that accent with var(), so it follows the palette", () => {
      const colours = new Map(snapshotColours(theme));
      const block = declarations(themeBlock(theme));
      const failures: string[] = [];
      for (const { accent, text } of FAMILIES) {
        const primary = must(accent[0], `accent of ${text}`);
        if (colours.get(text) === undefined || colours.get(text) !== colours.get(primary)) continue;
        const expected = `var(${primary})`;
        const found = decl(block, text)?.value;
        if (found !== expected) failures.push(`${text}: expected ${expected}, found ${found ?? "nothing"}`);
      }
      expect(failures).toEqual([]);
    });
  });
}

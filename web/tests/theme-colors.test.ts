// Colour guard for ISC-18 (T17): the daisyUI themes `spec-light` and `spec-dark` in `web/src/styles.css` carry the
// old pages' light and dark token values. Every colour there is written as `oklch(L C H)` with the inherited value
// in a trailing comment; this guard converts each OKLCH value back to sRGB and measures it against that value.
//
// Distance metric: ΔE_OK × 100, i.e. the Euclidean distance in OKLab scaled by 100 (OKLab L runs 0…1, so the
// scaled metric sits on roughly the same scale as CIE ΔE; ~2 is a just-noticeable difference). Threshold: 0.5.
// The OKLab matrices are Björn Ottosson's reference values; sRGB uses the IEC 61966-2-1 transfer function.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Narrow a regex capture or array slot without a `!` assertion; a miss is a broken fixture, so it throws. */
const must = <T,>(value: T | null | undefined, what = "value"): T => {
  if (value === null || value === undefined) throw new Error(`missing ${what}`);
  return value;
};

const MAX_DELTA_E = 0.5;
const STYLES = readFileSync(join(import.meta.dir, "..", "src", "styles.css"), "utf8");

// ── The old pages' two token blocks: the source of truth, copied verbatim. ──
const INHERITED = {
  "spec-light": {
    bg: "#f6f1ef", surface: "#fdfaf9", "surface-2": "#ede7e5", lane: "#f9f5f4", ink: "#29242a", muted: "#706b6e",
    line: "#dcd5d3", held: "#8a8489", "held-t": "#ede9e8", disp: "#1c8ca8", "disp-t": "#ddf0f4", badge: "#1c8ca8",
    hover: "#ad560c", ques: "#7058be", "ques-t": "#ebe5f8", conc: "#cc7a0a", "conc-t": "#fbedd4", fail: "#e14775",
    "fail-t": "#fbe3ea", done: "#269d69", "done-t": "#ddf3e8", clos: "#4c8a13", "clos-t": "#e3f0d6",
  },
  "spec-dark": {
    bg: "#221f22", surface: "#2d2a2e", "surface-2": "#403e41", lane: "#282629", ink: "#fcfcfa", muted: "#939293",
    line: "#4a474c", held: "#939293", "held-t": "#3a373b", disp: "#78dce8", "disp-t": "#24363a", badge: "#1d6878",
    hover: "#fc9867", ques: "#ab9df2", "ques-t": "#33303f", conc: "#ffd866", "conc-t": "#3e3826", fail: "#ff6188",
    "fail-t": "#422a33", done: "#a9dc9c", "done-t": "#2a3a2d", clos: "#a6e22e", "clos-t": "#2f3a24",
  },
} as const;

// The old `--shadow` values, as [r, g, b, alpha] per layer.
const INHERITED_SHADOW: Record<keyof typeof INHERITED, number[][]> = {
  "spec-light": [[41, 36, 42, 0.06], [41, 36, 42, 0.08]],
  "spec-dark": [[0, 0, 0, 0.4]],
};

// Where each inherited token lives in a theme block: a daisyUI slot, or its old name as a custom property.
const SLOTS: Record<string, string[]> = {
  bg: ["--color-base-200"],
  surface: ["--color-base-100"],
  "surface-2": ["--color-base-300"],
  ink: ["--color-base-content"],
  disp: ["--color-primary", "--color-info"],
  ques: ["--color-secondary"],
  clos: ["--color-accent"],
  badge: ["--color-neutral", "--badge"],
  done: ["--color-success"],
  hover: ["--color-warning"],
  fail: ["--color-error"],
};
const slotsOf = (token: string): string[] => SLOTS[token] ?? [`--${token}`];

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

for (const [theme, tokens] of Object.entries(INHERITED) as Array<[keyof typeof INHERITED, Record<string, string>]>) {
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

    test("carries all 23 inherited tokens, each round-tripping to the old hex", () => {
      expect(Object.keys(tokens)).toHaveLength(23);
      const d = load();
      const failures: string[] = [];
      for (const [token, hex] of Object.entries(tokens)) {
        for (const slot of slotsOf(token)) {
          const found = decl(d, slot);
          if (!found) {
            failures.push(`--${token}: ${slot} missing`);
            continue;
          }
          const values = oklchValues(found.value);
          if (values.length !== 1 || found.value !== values[0]) {
            failures.push(`--${token}: ${slot} is not a single oklch() value: ${found.value}`);
            continue;
          }
          const commentHex = /^#[0-9a-f]{6}\b/i.exec(found.comment ?? "")?.[0].toLowerCase();
          if (commentHex !== hex) {
            failures.push(`--${token}: ${slot} comment starts with ${commentHex ?? "no hex"}, expected ${hex}`);
          }
          const dE = roundTrip(parseOklch(values[0]), hexToSrgb(hex));
          if (dE > MAX_DELTA_E) failures.push(`--${token}: ${slot} ΔE_OK×100 ${dE.toFixed(3)} > ${MAX_DELTA_E}`);
        }
      }
      expect(failures).toEqual([]);
    });

    test("inherited --shadow keeps its layers, colours and alphas", () => {
      const shadow = decl(load(), "--shadow");
      expect(shadow).toBeDefined();
      const values = oklchValues(shadow?.value ?? "").map(parseOklch);
      const expected = INHERITED_SHADOW[theme];
      expect(values).toHaveLength(expected.length);
      expected.forEach(([r, g, b, alpha], i) => {
        const v = must(values[i]);
        expect(v.alpha).toBeCloseTo(must(alpha), 6);
        expect(roundTrip(v, [must(r), must(g), must(b)].map((c) => c / 255) as Rgb)).toBeLessThanOrEqual(
          MAX_DELTA_E,
        );
      });
    });

    test("every colour is oklch with its source in a comment, all within ΔE 0.5", () => {
      const failures: string[] = [];
      for (const { name, value, comment } of load()) {
        if (/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i.test(value)) failures.push(`${name}: non-OKLCH colour ${value}`);
        const values = oklchValues(value);
        const sources = [...(comment ?? "").matchAll(/#[0-9a-f]{6}\b|rgba?\([^)]*\)/gi)].map((m) => m[0]);
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
            ? hexToSrgb(source)
            : (source.match(/[\d.]+/g)?.slice(0, 3).map((c) => Number(c) / 255) as Rgb);
          const dE = roundTrip(parseOklch(v), rgb);
          if (dE > MAX_DELTA_E) failures.push(`${name}: ${v} vs ${source} ΔE_OK×100 ${dE.toFixed(3)}`);
        });
      }
      expect(failures).toEqual([]);
    });
  });
}

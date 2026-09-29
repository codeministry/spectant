// Contrast guard for ISC-65 (T18): the derived tokens in `web/src/styles/tokens.css` reach WCAG 2.x contrast on the
// surfaces of both daisyUI themes in `web/src/styles.css`. Text (`--muted-ink`, every `--*-ink`) needs 4.5:1 on the
// card (`--color-base-100`) and the page (`--color-base-200`); the `--track` mark needs 3:1 on both; badge text needs
// 4.5:1 on the badge fill. A `var()` value is resolved through the token block, then the shared block, then the
// theme block in `styles.css`, as the cascade does on the element that carries `data-theme`.
//
// The browser contrast spec (T30) settles ISC-65 on rendered pages; this guard keeps the token values honest.
//
// The OKLCH → sRGB conversion below is copied from `theme-colors.test.ts` (Björn Ottosson's matrices, IEC 61966-2-1
// transfer function). A shared helper belongs to a later cleanup.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const must = <T,>(value: T | null | undefined, what = "value"): T => {
  if (value === null || value === undefined) throw new Error(`missing ${what}`);
  return value;
};

const SRC = join(import.meta.dir, "..", "src");
const read = (path: string) => readFileSync(join(SRC, path), "utf8");

const TEXT_MIN = 4.5;
const MARK_MIN = 3;
const MAX_DELTA_E = 0.5;
const THEMES = ["spec-light", "spec-dark"] as const;
type Theme = (typeof THEMES)[number];
// Every accent of the palette (ISC-74, T34). Text in an accent colour uses its `--<accent>-ink`. The badge is the one
// accent that is a fill, never a text colour: its `--badge-ink` is the text on `--badge-fill`, checked there below.
const ACCENTS = ["disp", "ques", "clos", "done", "hover", "fail", "conc", "held", "badge"] as const;
const INKS = ACCENTS.filter((n) => n !== "badge").map((n) => `--${n}-ink`);

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

function hexToSrgb(hex: string): Rgb {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) throw new Error(`not a #rrggbb hex: ${hex}`);
  return [m[1], m[2], m[3]].map((h) => Number.parseInt(must(h), 16) / 255) as Rgb;
}

/** `oklch(L% C H)` → sRGB clamped to the gamut, as a browser paints it. */
function oklchToSrgb(src: string): Rgb {
  const m = /^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)\s*\)$/.exec(src);
  if (!m) throw new Error(`unparseable oklch: ${src}`);
  const L = Number(m[1]) / (m[2] ? 100 : 1);
  const [C, H] = [Number(m[3]), (Number(m[4]) * Math.PI) / 180];
  return oklabToSrgb([L, C * Math.cos(H), C * Math.sin(H)]).map((c) => Math.min(1, Math.max(0, c))) as Rgb;
}

/** The same colour after the 8-bit quantisation of a painted pixel. */
const quantise = (rgb: Rgb) => rgb.map((c) => Math.round(c * 255) / 255) as Rgb;

// ── WCAG 2.x relative luminance and contrast ratio. ──
const luminance = (rgb: Rgb) => {
  const [r, g, b] = rgb.map(toLinear) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

function contrast(a: Rgb, b: Rgb): number {
  const [la, lb] = [luminance(a), luminance(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Worst case over the exact and the quantised paint, so rounding can never lift a colour over the line. */
const worstContrast = (a: Rgb, b: Rgb) => Math.min(contrast(a, b), contrast(quantise(a), quantise(b)));

// ── CSS parsing: flat blocks, one declaration per line, optional trailing comment. ──
type Decl = { name: string; value: string; comment: string | undefined };

function declarations(block: string): Decl[] {
  const decls: Decl[] = [];
  for (const line of block.split("\n")) {
    const m = /^\s*([\w-]+)\s*:\s*([^;]+);\s*(?:\/\*\s*(.*?)\s*\*\/)?\s*$/.exec(line);
    if (m) decls.push({ name: must(m[1]), value: must(m[2]).trim(), comment: m[3] });
  }
  return decls;
}

/** Every `selector { … }` rule whose selector sits on the line of its opening brace. */
function rules(css: string): Array<{ selector: string; decls: Decl[] }> {
  return [...css.matchAll(/^([^\n{}]+?)\s*\{([^{}]*)\}/gm)].map((m) => ({
    selector: must(m[1]).trim(),
    decls: declarations(must(m[2])),
  }));
}

function themeBlock(css: string, theme: Theme): Decl[] {
  const blocks = [...css.matchAll(/@plugin\s+"daisyui\/theme"\s*\{([^}]*)\}/g)].map((m) => must(m[1]));
  const found = blocks.filter((b) => new RegExp(`\\bname:\\s*"${theme}"\\s*;`).test(b));
  if (found.length !== 1) throw new Error(`expected one daisyUI theme block "${theme}", found ${found.length}`);
  return declarations(must(found[0]));
}

const STYLES = read("styles.css");
const TOKENS = read("styles/tokens.css");
const TOKEN_RULES = rules(TOKENS);

const ruleFor = (selector: string) => {
  const found = TOKEN_RULES.filter((r) => r.selector === selector);
  if (found.length !== 1) throw new Error(`expected one "${selector}" rule in tokens.css, found ${found.length}`);
  return must(found[0]).decls;
};
const tokensOf = (theme: Theme) => ruleFor(`[data-theme="${theme}"]`);
const SHARED = () => ruleFor("[data-theme]");
const ROOT = () => ruleFor(":root");

/** Resolve a custom property to sRGB the way the cascade does on the `data-theme` element. */
function resolve(theme: Theme, name: string, seen: string[] = []): Rgb {
  if (seen.includes(name)) throw new Error(`var() cycle: ${[...seen, name].join(" → ")}`);
  const scopes = [tokensOf(theme), SHARED(), themeBlock(STYLES, theme)];
  const found = scopes.map((s) => s.find((d) => d.name === name)).find(Boolean);
  if (!found) throw new Error(`${name} is not defined for ${theme}`);
  const alias = /^var\(\s*(--[\w-]+)\s*\)$/.exec(found.value);
  if (alias) return resolve(theme, must(alias[1]), [...seen, name]);
  if (!found.value.startsWith("oklch(")) throw new Error(`${name} is not an oklch() or var() colour: ${found.value}`);
  return oklchToSrgb(found.value);
}

const surfaces = (theme: Theme) => ({
  card: resolve(theme, "--color-base-100"),
  page: resolve(theme, "--color-base-200"),
});

/** Failures of one token against both surfaces, as readable lines. */
function below(theme: Theme, name: string, min: number): string[] {
  const colour = resolve(theme, name);
  return Object.entries(surfaces(theme)).flatMap(([surface, rgb]) => {
    const ratio = worstContrast(colour, rgb);
    return ratio < min ? [`${theme} ${name} on ${surface}: ${ratio.toFixed(2)} < ${min}`] : [];
  });
}

describe("tokens.css", () => {
  test("styles.css imports it", () => {
    expect(STYLES).toMatch(/^@import\s+"\.\/styles\/tokens\.css";$/m);
  });

  test("both themes define the same token names", () => {
    const names = (theme: Theme) => tokensOf(theme).map((d) => d.name).sort();
    expect(names("spec-light")).toEqual(names("spec-dark"));
    const required = ["--track", "--muted-ink", "--badge-fill", ...INKS];
    expect(required.filter((name) => !names("spec-light").includes(name))).toEqual([]);
  });

  test("shared block: badge text, the focus helpers and the header glass", () => {
    const shared = SHARED();
    expect(shared.find((d) => d.name === "--focus-ring")?.value).toBe("var(--color-primary)");
    expect(shared.find((d) => d.name === "--focus-halo")?.value).toBe("var(--color-base-200)");
    expect(shared.find((d) => d.name === "--badge-ink")?.comment).toMatch(/^#fcfcfa\b/);
    // The prototype's `--page-glass`: the page colour at 85 % under the header's blur (design.md § Header).
    expect(shared.find((d) => d.name === "--page-glass")?.value).toBe(
      "color-mix(in srgb, var(--color-base-200) 85%, transparent)",
    );
  });

  test("every accent has an -ink in both themes (ISC-74)", () => {
    const missing = THEMES.flatMap((theme) =>
      ACCENTS.flatMap((accent) => {
        try {
          resolve(theme, `--${accent}-ink`);
          return [];
        } catch (error) {
          return [`${theme} --${accent}-ink: ${(error as Error).message}`];
        }
      }),
    );
    expect(missing).toEqual([]);
  });

  test("the prototype's tokens the old pages lack are theme slots in both themes (ISC-74)", () => {
    // Prototype hex per theme; the round trip itself is the ΔE check of `theme-colors.test.ts` over every slot.
    const expected: Record<Theme, Record<string, string>> = {
      "spec-light": { "--hover-t": "#fbedd4", "--scrim": "rgba(0,0,0,.4)" },
      "spec-dark": { "--hover-t": "#3a2f27", "--scrim": "rgba(0,0,0,.4)" },
    };
    for (const theme of THEMES) {
      const block = themeBlock(STYLES, theme);
      for (const [name, source] of Object.entries(expected[theme])) {
        const found = block.find((d) => d.name === name);
        expect(found?.value.startsWith("oklch(")).toBe(true);
        expect(found?.comment?.startsWith(source)).toBe(true);
      }
    }
  });

  test("container tier constants in :root", () => {
    const root = ROOT();
    expect(root.find((d) => d.name === "--tier-compact-max")?.value).toBe("639px");
    expect(root.find((d) => d.name === "--tier-medium-max")?.value).toBe("1119px");
  });

  test("every colour is oklch() or var(), each oklch() with a hex comment within ΔE_OK×100 0.5", () => {
    const failures: string[] = [];
    for (const { selector, decls } of TOKEN_RULES) {
      for (const { name, value, comment } of decls) {
        if (/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i.test(value)) failures.push(`${selector} ${name}: non-OKLCH ${value}`);
        if (!value.startsWith("oklch(")) continue;
        const hex = /^#[0-9a-f]{6}\b/i.exec(comment ?? "")?.[0];
        if (!hex) {
          failures.push(`${selector} ${name}: no hex at the start of the comment`);
          continue;
        }
        const painted = srgbToOklab(oklchToSrgb(value));
        const source = srgbToOklab(hexToSrgb(hex));
        const dE = 100 * Math.hypot(painted[0] - source[0], painted[1] - source[1], painted[2] - source[2]);
        if (dE > MAX_DELTA_E) failures.push(`${selector} ${name}: ${value} vs ${hex} ΔE_OK×100 ${dE.toFixed(3)}`);
      }
    }
    expect(failures).toEqual([]);
  });
});

for (const theme of THEMES) {
  describe(`contrast in ${theme} (WCAG 2.x)`, () => {
    test(`--muted-ink and every --*-ink reach ${TEXT_MIN}:1 on the card and the page`, () => {
      expect(["--muted-ink", ...INKS].flatMap((name) => below(theme, name, TEXT_MIN))).toEqual([]);
    });

    test(`--track reaches ${MARK_MIN}:1 on the card and the page`, () => {
      expect(below(theme, "--track", MARK_MIN)).toEqual([]);
    });

    test(`--badge-ink reaches ${TEXT_MIN}:1 on --badge-fill`, () => {
      const ratio = worstContrast(resolve(theme, "--badge-ink"), resolve(theme, "--badge-fill"));
      expect(ratio).toBeGreaterThanOrEqual(TEXT_MIN);
    });
  });
}

// design.md (spec 002, § Accessibility and contrast): "Two dark-theme values pass only narrowly: muted text on a card
// (#939293 on #2d2a2e, about 4.6:1) and the grey stage segment (#7f7d80, about 3.3:1). Neither may drift darker in the
// OKLCH conversion." Measured, they are 4.57:1 and 3.47:1. A palette edit that darkens either fails here, loudly, even
// while the generic 4.5 / 3 checks above would still pass by a hair.
describe("the two narrow dark values (design.md, ISC-65/74)", () => {
  const card = () => resolve("spec-dark", "--color-base-100");
  const narrow = [
    { token: "--muted-ink", what: "muted text", hex: "#939293", min: TEXT_MIN },
    { token: "--track", what: "grey stage segment", hex: "#7f7d80", min: MARK_MIN },
  ];

  test("the card is still #2d2a2e", () => {
    const painted = quantise(card());
    expect(painted.map((c) => Math.round(c * 255))).toEqual(hexToSrgb("#2d2a2e").map((c) => Math.round(c * 255)));
  });

  for (const { token, what, hex, min } of narrow) {
    test(`${what} (${token}) reaches ${min}:1 on the card`, () => {
      expect(worstContrast(resolve("spec-dark", token), card())).toBeGreaterThanOrEqual(min);
    });

    test(`${what} (${token}) paints no darker than ${hex}`, () => {
      // Compare the 8-bit paint, as the browser shows it, against design.md's hex.
      expect(luminance(quantise(resolve("spec-dark", token)))).toBeGreaterThanOrEqual(luminance(hexToSrgb(hex)));
    });
  }
});

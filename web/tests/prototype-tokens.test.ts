// Token-parity guard for ISC-146 (T15): every custom property the prototype's `styles.css` declares in `:root`,
// `[data-theme="spec-light"]` and `[data-theme="spec-dark"]` (the fixture `fixtures/prototype-reference.json`, written
// by `scripts/extract-prototype.ts`) has an app token with the same value in the same theme. The app names differ;
// `prototype-token-map.ts` is the one reviewed name map, and every prototype property must appear in it.
//
// Resolution. A value is resolved the way the cascade does on the element that carries `data-theme`: the
// `tokens.css` theme rule, the `tokens.css` shared `[data-theme]` rule, the daisyUI theme block in `styles.css`, then
// the top-level `:root` rules of `tokens.css`, `fonts.css` and `motion.css`. Every `var()` is substituted, on the
// prototype side through the fixture (`:root` plus the theme), so `color-mix(in srgb, var(--page) 85%, transparent)`
// meets the app's `color-mix(in srgb, var(--color-base-200) 85%, transparent)` as two resolved strings.
//
// Comparison. Colours (hex on the prototype side, `oklch()` on the app side, alpha included) are compared after the
// OKLCH → sRGB round trip, quantised to 8 bits per channel: the app colour must paint exactly the prototype hex, alpha
// within one 8-bit step. That is the claim's "gleich dem Hex-Wert" taken literally, stricter than the ΔE_OK×100 ≤ 0.5
// of `theme-colors.test.ts`. Everything around the colours (px, ms, cubic-bezier, font stacks, shadow geometry,
// `color-mix()` arguments) must be equal as a normalised string: whitespace collapsed, quotes unified, `.2` read as
// `0.2`. The OKLCH → sRGB conversion is copied from `theme-colors.test.ts` (Björn Ottosson's matrices,
// IEC 61966-2-1 transfer function).
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homesOf, PROTOTYPE_THEMES, PROTOTYPE_TOKEN_MAP, PROTOTYPE_TOKENS, type PrototypeTheme } from "./prototype-token-map";

const must = <T,>(value: T | null | undefined, what = "value"): T => {
  if (value === null || value === undefined) throw new Error(`missing ${what}`);
  return value;
};

const SRC = join(import.meta.dir, "..", "src");
const read = (path: string) => readFileSync(join(SRC, path), "utf8");

// ── Colour math (no dependencies). ──
type Rgb = [number, number, number]; // sRGB, 0…1, gamma-encoded
type Rgba = { rgb: Rgb; alpha: number };

const toGamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function oklchToSrgb(L: number, C: number, H: number): Rgb {
  const [a, b] = [C * Math.cos((H * Math.PI) / 180), C * Math.sin((H * Math.PI) / 180)];
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((c) => Math.min(1, Math.max(0, toGamma(c)))) as Rgb;
}

/** `oklch(L% C H [/ a])` → sRGB clamped to the gamut, as a browser paints it. */
function parseOklch(src: string): Rgba {
  const m = /^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+))?\s*\)$/.exec(src);
  if (!m) throw new Error(`unparseable oklch: ${src}`);
  const L = Number(m[1]) / (m[2] ? 100 : 1);
  return { rgb: oklchToSrgb(L, Number(m[3]), Number(m[4])), alpha: m[5] === undefined ? 1 : Number(m[5]) };
}

/** `#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa` → sRGB 0…1 plus alpha. */
function parseHex(hex: string): Rgba {
  const digits = must(/^#([0-9a-f]{3,8})$/i.exec(hex)?.[1], `hex ${hex}`);
  const full = digits.length <= 4 ? digits.replace(/./g, (d) => d + d) : digits;
  if (full.length !== 6 && full.length !== 8) throw new Error(`not a hex colour: ${hex}`);
  const channel = (i: number) => Number.parseInt(full.slice(i, i + 2), 16) / 255;
  return { rgb: [channel(0), channel(2), channel(4)], alpha: full.length === 8 ? channel(6) : 1 };
}

const parseColour = (src: string): Rgba => (src.startsWith("#") ? parseHex(src) : parseOklch(src));

/** The colour as the 8-bit hex a painted pixel carries, alpha appended when it is not opaque. */
function toHex({ rgb, alpha }: Rgba): string {
  const byte = (c: number) => Math.round(c * 255).toString(16).padStart(2, "0");
  return `#${rgb.map(byte).join("")}${Math.round(alpha * 255) === 255 ? "" : byte(alpha)}`;
}

// ── Values: colours lifted out, the rest normalised. ──
const COLOUR = /#[0-9a-f]{3,8}\b|oklch\([^)]*\)/gi;

/** Whitespace collapsed, quotes unified, `.2` read as `0.2`, trailing zeros of a decimal dropped. */
const normalise = (value: string) =>
  value
    .replace(/'/g, '"')
    .replace(/\s+/g, " ")
    .replace(/\s*([(),/])\s*/g, "$1")
    .replace(/(^|[^\w.])\.(\d)/g, "$10.$2")
    .replace(/(\d+\.\d*?)0+(?!\d)/g, "$1")
    .replace(/\.(?!\d)/g, "")
    .trim();

type Shape = { skeleton: string; colours: string[] };
const shape = (value: string): Shape => ({
  skeleton: normalise(value.replace(COLOUR, "<colour>")),
  colours: [...value.matchAll(COLOUR)].map((m) => toHex(parseColour(m[0]))),
});

// ── CSS: flat blocks, one declaration per line, optional trailing comment. ──
type Decl = { name: string; value: string };

function declarations(block: string): Decl[] {
  const decls: Decl[] = [];
  for (const line of block.split("\n")) {
    const m = /^\s*(--[\w-]+)\s*:\s*([^;]+);\s*(?:\/\*.*?\*\/)?\s*$/.exec(line);
    if (m) decls.push({ name: must(m[1]), value: must(m[2]).trim() });
  }
  return decls;
}

/** The one top-level rule (selector at the start of a line) with exactly this selector. */
function topRule(css: string, selector: string, file: string): Decl[] {
  const found = [...css.matchAll(/^([^\s\n{}][^\n{}]*?)\s*\{([^{}]*)\}/gm)].filter((m) => must(m[1]).trim() === selector);
  if (found.length !== 1) throw new Error(`expected one top-level "${selector}" rule in ${file}, found ${found.length}`);
  return declarations(must(found[0]?.[2]));
}

function themeBlock(css: string, theme: PrototypeTheme): Decl[] {
  const blocks = [...css.matchAll(/@plugin\s+"daisyui\/theme"\s*\{([^}]*)\}/g)].map((m) => must(m[1]));
  const found = blocks.filter((b) => new RegExp(`\\bname:\\s*"${theme}"\\s*;`).test(b));
  if (found.length !== 1) throw new Error(`expected one daisyUI theme block "${theme}", found ${found.length}`);
  return declarations(must(found[0]));
}

/** The app's declarations in cascade order on the `data-theme` element, read per call so a test sees the files. */
function appScopes(theme: PrototypeTheme): Decl[][] {
  const tokens = read("styles/tokens.css");
  return [
    topRule(tokens, `[data-theme="${theme}"]`, "tokens.css"),
    topRule(tokens, "[data-theme]", "tokens.css"),
    themeBlock(read("styles.css"), theme),
    topRule(tokens, ":root", "tokens.css"),
    topRule(read("styles/fonts.css"), ":root", "fonts.css"),
    topRule(read("styles/motion.css"), ":root", "motion.css"),
  ];
}

const VAR = /var\(\s*(--[\w-]+)\s*\)/g;

/** Substitute every `var()` in `value` through `lookup`, guarding against cycles. */
function substitute(value: string, lookup: (name: string) => string | undefined, seen: string[] = []): string {
  return value.replace(VAR, (_, name: string) => {
    if (seen.includes(name)) throw new Error(`var() cycle: ${[...seen, name].join(" → ")}`);
    const raw = lookup(name);
    if (raw === undefined) throw new Error(`${name} is not defined`);
    return substitute(raw, lookup, [...seen, name]);
  });
}

function resolveApp(theme: PrototypeTheme, name: string): string {
  const scopes = appScopes(theme);
  const lookup = (n: string) => scopes.map((s) => s.find((d) => d.name === n)).find(Boolean)?.value;
  return substitute(`var(${name})`, lookup);
}

function resolvePrototype(theme: PrototypeTheme, name: string): string {
  const lookup = (n: string) => PROTOTYPE_TOKENS[theme][n] ?? PROTOTYPE_TOKENS.root[n];
  return substitute(`var(${name})`, lookup);
}

/** Why `app` differs from `prototype`, or undefined when they are the same value. */
function difference(prototype: string, app: string): string | undefined {
  const [p, a] = [shape(prototype), shape(app)];
  if (p.skeleton !== a.skeleton) return `"${a.skeleton}" vs prototype "${p.skeleton}"`;
  const off = p.colours.map((hex, i) => (a.colours[i] === hex ? "" : `${a.colours[i] ?? "none"} vs prototype ${hex}`));
  return off.some(Boolean) ? off.filter(Boolean).join(", ") : undefined;
}

describe("the name map (prototype-token-map.ts)", () => {
  const prototypeNames = new Set(
    [PROTOTYPE_TOKENS.root, ...PROTOTYPE_THEMES.map((t) => PROTOTYPE_TOKENS[t])].flatMap((b) => Object.keys(b)),
  );

  test("the fixture carries the prototype's three blocks", () => {
    expect(Object.keys(PROTOTYPE_TOKENS.root).length).toBeGreaterThan(0);
    expect(Object.keys(PROTOTYPE_TOKENS["spec-light"]).sort()).toEqual(Object.keys(PROTOTYPE_TOKENS["spec-dark"]).sort());
  });

  test("every prototype custom property has an entry (no silent skip)", () => {
    expect([...prototypeNames].filter((name) => !(name in PROTOTYPE_TOKEN_MAP))).toEqual([]);
  });

  test("every entry names a prototype custom property (no stale entry)", () => {
    expect(Object.keys(PROTOTYPE_TOKEN_MAP).filter((name) => !prototypeNames.has(name))).toEqual([]);
  });
});

describe("normalise", () => {
  test("reads equal what only spelling separates", () => {
    expect(normalise("cubic-bezier(.2, 0, 0, 1)")).toBe(normalise("cubic-bezier(0.2,0,0,1)"));
    expect(normalise("'Sora', system-ui")).toBe(normalise('"Sora",  system-ui'));
    expect(normalise("0.50")).toBe(normalise(".5"));
  });

  test("keeps apart what differs", () => {
    expect(normalise("80ms")).not.toBe(normalise("800ms"));
    expect(normalise('"Manrope", system-ui')).not.toBe(normalise('"Manrope Variable", system-ui'));
  });
});

for (const theme of PROTOTYPE_THEMES) {
  for (const [block, tokens] of [
    [":root", PROTOTYPE_TOKENS.root],
    [`[data-theme="${theme}"]`, PROTOTYPE_TOKENS[theme]],
  ] as const) {
    describe(`${theme}: the prototype's ${block}`, () => {
      for (const name of Object.keys(tokens)) {
        test(`${name} has an app token with the prototype's value`, () => {
          const expected = resolvePrototype(theme, name);
          const failures: string[] = [];
          for (const home of homesOf(name)) {
            let actual: string;
            try {
              actual = resolveApp(theme, home);
            } catch (error) {
              failures.push(`${home}: ${(error as Error).message}`);
              continue;
            }
            const off = difference(expected, actual);
            if (off) failures.push(`${home}: ${off}`);
          }
          expect(failures).toEqual([]);
        });
      }
    });
  }
}

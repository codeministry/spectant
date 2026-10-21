// The app's look as a tracked snapshot (spec 063): `fixtures/look-snapshot.json` holds three parts, each written by
// one writer and guarded by tests, so the app itself is the reference of its look.
//
// - `tokens`: every custom property the app declares in the cascade on the element that carries `data-theme`, per
//   theme, resolved. The cascade is the `tokens.css` theme rule, the `tokens.css` shared `[data-theme]` rule, the
//   daisyUI theme block in `styles.css`, then the top-level `:root` rules of `tokens.css`, `fonts.css` and
//   `motion.css`; the first declaration in that order wins. Every `var()` is substituted, every colour (`#hex`,
//   `oklch()`, alpha included) becomes the 8-bit sRGB hex a painted pixel carries (alpha byte only when not opaque),
//   and the rest is normalised: whitespace collapsed, quotes unified, `.2` read as `0.2`, trailing zeros dropped.
//   The OKLCH → sRGB conversion uses Björn Ottosson's matrices and the IEC 61966-2-1 transfer function.
// - `icons`: the icon key map, key → Lucide name, as the app declares it.
// - `primitives`: the computed-style anatomy of the app's primitives per theme, written by the browser tier; this
//   module keeps that part untouched.
//
// Run directly: `bun web/tests/look-snapshot.ts` writes `tokens` and `icons`; `--check` writes nothing and exits 1
// when either part differs from a fresh resolution or the file is missing.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PROTOTYPE_ICON_MAP } from "../src/app/shared/icons/prototype-map";

export const THEMES = ["light", "dark"] as const;
export type Theme = (typeof THEMES)[number];

export const SNAPSHOT_PATH = join(import.meta.dir, "fixtures", "look-snapshot.json");

const SRC = join(import.meta.dir, "..", "src");

/** Reads a file under `web/src` by its relative path. */
export type SourceReader = (path: string) => string;
export const readSource: SourceReader = (path) => readFileSync(join(SRC, path), "utf8");

const must = <T,>(value: T | null | undefined, what = "value"): T => {
  if (value === null || value === undefined) throw new Error(`missing ${what}`);
  return value;
};

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

export const parseColour = (src: string): Rgba => (src.startsWith("#") ? parseHex(src) : parseOklch(src));

/** The colour as the 8-bit hex a painted pixel carries, alpha appended when it is not opaque. */
export function toHex({ rgb, alpha }: Rgba): string {
  const byte = (c: number) => Math.round(c * 255).toString(16).padStart(2, "0");
  return `#${rgb.map(byte).join("")}${Math.round(alpha * 255) === 255 ? "" : byte(alpha)}`;
}

// ── Values: colours as 8-bit hex, the rest normalised. ──
const COLOUR = /#[0-9a-f]{3,8}\b|oklch\([^)]*\)/gi;

/** Whitespace collapsed, quotes unified, `.2` read as `0.2`, trailing zeros of a decimal dropped. */
export const normalise = (value: string) =>
  value
    .replace(/'/g, '"')
    .replace(/\s+/g, " ")
    .replace(/\s*([(),/])\s*/g, "$1")
    .replace(/(^|[^\w.])\.(\d)/g, "$10.$2")
    .replace(/(\d+\.\d*?)0+(?!\d)/g, "$1")
    .replace(/\.(?!\d)/g, "")
    .trim();

/** A resolved value with every colour replaced by its 8-bit hex and everything else normalised. */
export const canonical = (value: string) => normalise(value.replace(COLOUR, (c) => toHex(parseColour(c))));

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

function themeBlock(css: string, dataTheme: string): Decl[] {
  const blocks = [...css.matchAll(/@plugin\s+"daisyui\/theme"\s*\{([^}]*)\}/g)].map((m) => must(m[1]));
  const found = blocks.filter((b) => new RegExp(`\\bname:\\s*"${dataTheme}"\\s*;`).test(b));
  if (found.length !== 1) throw new Error(`expected one daisyUI theme block "${dataTheme}", found ${found.length}`);
  return declarations(must(found[0]));
}

/** The app's declarations in cascade order on the `data-theme` element. */
function appScopes(theme: Theme, read: SourceReader): Decl[][] {
  const dataTheme = `spec-${theme}`;
  const tokens = read("styles/tokens.css");
  return [
    topRule(tokens, `[data-theme="${dataTheme}"]`, "tokens.css"),
    topRule(tokens, "[data-theme]", "tokens.css"),
    themeBlock(read("styles.css"), dataTheme),
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

/** Every custom property of the app's cascade for `theme`, resolved and canonical, keyed by name. */
export function resolveTokens(theme: Theme, read: SourceReader = readSource): Record<string, string> {
  const winners = new Map<string, string>();
  for (const scope of appScopes(theme, read)) {
    for (const { name, value } of scope) if (!winners.has(name)) winners.set(name, value);
  }
  const lookup = (name: string) => winners.get(name);
  const out: Record<string, string> = {};
  for (const [name, value] of winners) {
    try {
      out[name] = canonical(substitute(value, lookup, [name]));
    } catch (error) {
      throw new Error(`${theme} ${name}: ${(error as Error).message}`, { cause: error });
    }
  }
  return out;
}

/** The icon key map, key → Lucide name. */
export const iconKeys = (): Record<string, string> => ({ ...PROTOTYPE_ICON_MAP });

// ── The snapshot file. ──
export type Snapshot = {
  icons?: Record<string, string>;
  primitives?: Record<string, Record<string, Record<string, string>>>;
  tokens?: Record<string, Record<string, string>>;
};

/** JSON with keys sorted at every level, 2-space indent and a trailing newline: byte-stable for equal content. */
export function stableStringify(value: unknown): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (v !== null && typeof v === "object") {
      const entries = Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      return Object.fromEntries(entries.map(([k, inner]) => [k, sort(inner)]));
    }
    return v;
  };
  return `${JSON.stringify(sort(value), null, 2)}\n`;
}

/** The snapshot on disk, or undefined when the file is missing. */
export function readSnapshot(path = SNAPSHOT_PATH): Snapshot | undefined {
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Snapshot) : undefined;
}

/** Replace the given top-level parts in the snapshot file and write it back; other parts stay as they are. */
export function writeParts(parts: Snapshot, path = SNAPSHOT_PATH): void {
  writeFileSync(path, stableStringify({ ...readSnapshot(path), ...parts }));
}

/** A fresh `tokens` and `icons` from the app's sources. */
export function freshParts(read: SourceReader = readSource): Required<Pick<Snapshot, "icons" | "tokens">> {
  return {
    icons: iconKeys(),
    tokens: Object.fromEntries(THEMES.map((theme) => [theme, resolveTokens(theme, read)])),
  };
}

/** The keys (theme-qualified for tokens) whose values differ between two parts, in sorted order. */
function differingKeys(a: Record<string, unknown> | undefined, b: Record<string, unknown>, prefix = ""): string[] {
  const keys = [...new Set([...Object.keys(a ?? {}), ...Object.keys(b)])].sort();
  return keys.flatMap((key) => {
    const [x, y] = [a?.[key], b[key]];
    if (x !== null && typeof x === "object" && y !== null && typeof y === "object") {
      return differingKeys(x as Record<string, unknown>, y as Record<string, unknown>, `${prefix}${key}.`);
    }
    return stableStringify(x) === stableStringify(y) ? [] : [`${prefix}${key}`];
  });
}

if (import.meta.main) {
  const fresh = freshParts();
  if (process.argv.includes("--check")) {
    const onDisk = readSnapshot();
    if (!onDisk) {
      console.error(`look snapshot missing: ${SNAPSHOT_PATH}`);
      process.exit(1);
    }
    let failed = false;
    for (const part of ["icons", "tokens"] as const) {
      const off = differingKeys(onDisk[part], fresh[part]);
      if (off.length === 0) continue;
      failed = true;
      console.error(`look snapshot part "${part}" differs (${off.length}): ${off.slice(0, 5).join(", ")}${off.length > 5 ? ", …" : ""}`);
    }
    if (failed) process.exit(1);
    console.log("look snapshot: tokens and icons match the app");
  } else {
    writeParts(fresh);
    console.log(`look snapshot: wrote tokens and icons to ${SNAPSHOT_PATH}`);
  }
}

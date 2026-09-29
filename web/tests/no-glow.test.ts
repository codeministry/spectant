// No-glow guard for ISC-74 (T34). design.md (spec 002): "Surfaces are flat, with 12 px cards, a 1 px --line border and
// no glow", and the prototype's decorative `.card.glow` is ruled out. This guard reads every stylesheet and every
// component (inline `styles` and templates) under `web/src` and fails on:
//
// - a class named `glow`, as a selector or in a template;
// - a `box-shadow` layer outside the flat set: `none`, the inherited hairline `var(--shadow)` (never on a card), the
//   focus halo `0 0 0 4px var(--focus-halo)` (ISC-64) and blur-free `inset` edges (the 3 px accent edge);
// - a `text-shadow` or a `drop-shadow()` filter;
// - a `radial-gradient()`, the prototype's glow technique.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const SRC = join(import.meta.dir, "..", "src");

/** Every `.css`, `.ts` and `.html` file under `web/src`, specs excluded (they describe behaviour, they paint nothing). */
function sources(dir = SRC): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.(css|ts|html)$/.test(entry.name) && !entry.name.endsWith(".spec.ts") ? [path] : [];
  });
}

type Line = { file: string; line: number; text: string };

/** Code lines only: comment lines (`//`, `/*`, ` *`) are prose and may name a glow to rule it out. */
const LINES: Line[] = sources().flatMap((path) =>
  readFileSync(path, "utf8")
    .split("\n")
    .map((text, i) => ({ file: relative(SRC, path), line: i + 1, text }))
    .filter(({ text }) => !/^\s*(\/\/|\/\*|\*)/.test(text)),
);

const where = ({ file, line }: Line) => `${file}:${line}`;

/** Split a shadow list on its top-level commas, leaving the commas inside `var()`, `oklch()` and `color-mix()`. */
function layers(value: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of value) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(current.trim());
      current = "";
    } else current += ch;
  }
  out.push(current.trim());
  return out;
}

const FOCUS_HALO = "0 0 0 4px var(--focus-halo)";

/** A flat layer: none, the hairline token, the focus halo, or an inset edge with no blur. */
function flat(layer: string): boolean {
  if (layer === "none" || layer === "var(--shadow)" || layer === FOCUS_HALO) return true;
  const inset = /^inset\s+(-?[\d.]+(?:px)?)\s+(-?[\d.]+(?:px)?)\s+(-?[\d.]+(?:px)?)\s+(?:var\(--[\w-]+\)|CanvasText)$/.exec(
    layer,
  );
  return inset !== null && Number.parseFloat(inset[3] ?? "1") === 0;
}

// Spec 001's `ui-card` paints a decorative corner glow (a `radial-gradient` `::before`, 001 design.md), which spec
// 002's design.md rules out. Removing it changes 001's card and its hover affordance, which lies outside T34's lane
// (tokens and tests); it is recorded as a review item. When the glow goes, this list must be emptied, and the test
// below fails until it is, so the exception cannot outlive the glow.
const KNOWN_RADIAL_GLOWS = ["app/shared/ui/card/card.ts"];

describe("no glow (ISC-74, design.md § Surfaces)", () => {
  test("sources were found", () => {
    expect(LINES.some(({ file }) => file === "styles.css")).toBe(true);
    expect(LINES.some(({ file }) => file.endsWith("card/card.ts"))).toBe(true);
  });

  test("no class named glow", () => {
    const hits = LINES.filter(
      ({ text }) => /\.glow\b/.test(text) || /class(?:\.|=["'][^"']*\b)glow\b/.test(text),
    ).map(where);
    expect(hits).toEqual([]);
  });

  test("every box-shadow layer is flat: none, var(--shadow), the focus halo or a blur-free inset edge", () => {
    const hits = LINES.flatMap((line) =>
      [...line.text.matchAll(/box-shadow:\s*([^;}]+)/g)].flatMap((m) =>
        layers((m[1] ?? "").trim())
          .filter((layer) => !flat(layer))
          .map((layer) => `${where(line)}: ${layer}`),
      ),
    );
    expect(hits).toEqual([]);
  });

  test("cards carry no shadow token", () => {
    const hits = LINES.filter(({ file, text }) => file.endsWith("card/card.ts") && text.includes("var(--shadow)"));
    expect(hits.map(where)).toEqual([]);
  });

  test("no text-shadow and no drop-shadow() filter", () => {
    const hits = LINES.filter(({ text }) => /text-shadow\s*:|drop-shadow\(/.test(text)).map(where);
    expect(hits).toEqual([]);
  });

  test("no radial-gradient() glow beyond the known ui-card one", () => {
    const files = [...new Set(LINES.filter(({ text }) => text.includes("radial-gradient(")).map(({ file }) => file))];
    expect(files.sort()).toEqual(KNOWN_RADIAL_GLOWS);
  });
});

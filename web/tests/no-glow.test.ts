// Glow guard for design.md § Surfaces (spec 002), as amended by the master decision of 2026-09-29 ("Oberkante ja,
// Glow ja (wie im Prototyp)"): surfaces stay flat, with one exception, the prototype's corner glow (`.card.glow`,
// `styles.css:118-123`) on the card primitive's glow variant. This guard reads every stylesheet and every component
// (inline `styles` and templates) under `web/src` and fails on:
//
// - a class named `glow`, as a selector or in a template (the glow is `ui-card`'s `glow` input, never a class);
// - a `box-shadow` layer outside the flat set: `none`, the inherited hairline `var(--shadow)` (never on a card), the
//   focus halo `0 0 0 4px var(--focus-halo)` (ISC-64) and blur-free `inset` edges;
// - a `text-shadow` or a `drop-shadow()` filter;
// - a `radial-gradient()` anywhere but in `ui-card`'s glow variant, the `:host([data-glow])::after` rule (a scroll
//   region's edge fade is a `linear-gradient`, spec 002 design.md § Tables).
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const SRC = join(import.meta.dir, "..", "src");
const CARD = "app/shared/ui/card/card.ts";

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

/** The selector of the rule a line sits in: the nearest line above it (or itself) that opens a block. */
function ruleOf({ file, line }: Line): string {
  const own = LINES.filter((l) => l.file === file && l.line <= line && l.text.includes("{"));
  const opener = own.at(-1)?.text ?? "";
  return opener.slice(0, opener.indexOf("{")).trim();
}

describe("no glow outside ui-card's glow variant (design.md § Surfaces, amended 2026-09-29)", () => {
  test("sources were found", () => {
    expect(LINES.some(({ file }) => file === "styles.css")).toBe(true);
    expect(LINES.some(({ file }) => file === CARD)).toBe(true);
  });

  test("no class named glow", () => {
    const hits = LINES.filter(
      // `.glow(` is the card's signal input being read, never a selector.
      ({ text }) => /\.glow\b(?!\()/.test(text) || /class(?:\.|=["'][^"']*\b)glow\b/.test(text),
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
    const hits = LINES.filter(({ file, text }) => file === CARD && text.includes("var(--shadow)"));
    expect(hits.map(where)).toEqual([]);
  });

  test("no text-shadow and no drop-shadow() filter", () => {
    const hits = LINES.filter(({ text }) => /text-shadow\s*:|drop-shadow\(/.test(text)).map(where);
    expect(hits).toEqual([]);
  });

  test("the one radial-gradient() glow is ui-card's glow variant, the :host([data-glow])::after rule", () => {
    const glows = LINES.filter(({ text }) => text.includes("radial-gradient("));
    expect(glows.map(({ file }) => file)).toEqual([CARD]);
    expect(glows.map(ruleOf)).toEqual([":host([data-glow])::after"]);
  });
});

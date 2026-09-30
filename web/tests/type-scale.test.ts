// Type-scale guard for ISC-17 (T86): the prototype's type scale (spec 001 design.md § Prototype port,
// `.design/prototype/prototyp/public/spectant-ui/styles.css`, lines named per step below) lives in `web/src/styles.css`
// as Tailwind `@utility type-*` classes the ported components use. Each step is checked declaration by declaration,
// so a drifted size, leading, weight or tracking fails here before a visual baseline has to catch it.
// The steps reuse the self-hosted font variables of `styles/fonts.css`; none may bring a font URL (ISC-67, ISC-74).
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const STYLES = readFileSync(join(import.meta.dir, "..", "src", "styles.css"), "utf8");

/** The prototype's steps: utility name → the declarations it must carry, verbatim. */
const SCALE: Record<string, Record<string, string>> = {
  // `.eyebrow` l.64; secondary text reads in `--muted-ink` (ISC-65), the prototype's `--muted` value here.
  "type-eyebrow": {
    "font-size": "11px",
    "line-height": "16px",
    "font-weight": "600",
    "letter-spacing": "0.08em",
    "text-transform": "uppercase",
    color: "var(--muted-ink)",
  },
  // `.meta` l.65
  "type-meta": { "font-size": "12px", "line-height": "16px", color: "var(--muted-ink)" },
  // `.page-head h1` l.184; the page title is the one Sora heading (fonts.css, design.md "Tokens and type").
  "type-page-title": {
    "font-family": "var(--font-display)",
    "font-size": "24px",
    "line-height": "32px",
    "font-weight": "600",
    "letter-spacing": "-0.01em",
  },
  // `.section-head` l.100, `.spec-table .t-head h2` l.364
  "type-section-title": { "font-size": "16px", "line-height": "24px", "font-weight": "600" },
  // `.c-head h3, .sblock h3` l.570: `600 15px/24px var(--font-brand)`; the brand face is `--font-display` here.
  "type-card-title": {
    "font-family": "var(--font-display)",
    "font-size": "15px",
    "line-height": "24px",
    "font-weight": "600",
  },
  // `[data-ui="kpi-tile"] .val` l.301
  "type-kpi-value": { "font-size": "32px", "line-height": "40px", "font-weight": "600", "letter-spacing": "-0.02em" },
  // `.hero-val` l.309
  "type-hero-value": { "font-size": "40px", "line-height": "48px", "font-weight": "600", "letter-spacing": "-0.02em" },
  // `[data-ui="kpi-strip"] .val` l.473 over the kpi-tile `.val` it refines (weight and tracking cascade from l.301).
  "type-strip-value": {
    "font-size": "22px",
    "line-height": "28px",
    "font-weight": "600",
    "letter-spacing": "-0.02em",
  },
  // `[data-ui="ring"] .pct` l.274 and `.sm .pct` l.276
  "type-ring-pct": { "font-size": "22px", "line-height": "1", "font-weight": "600" },
  "type-ring-pct-sm": { "font-size": "15px", "line-height": "1", "font-weight": "600" },
  // `[data-ui="chip"]` l.253
  "type-chip": {
    "font-size": "11px",
    "font-weight": "600",
    "letter-spacing": "0.06em",
    "text-transform": "uppercase",
  },
};

/** The body of `@utility <name> { … }`, flat declarations only. */
function utility(name: string): Record<string, string> | undefined {
  const found = [...STYLES.matchAll(/@utility\s+([\w-]+)\s*\{([^{}]*)\}/g)].filter((m) => m[1] === name);
  if (found.length > 1) throw new Error(`@utility ${name} is declared ${found.length} times`);
  const body = found[0]?.[2];
  if (body === undefined) return undefined;
  const decls: Record<string, string> = {};
  for (const m of body.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([\w-]+)\s*:\s*([^;]+);/g)) {
    decls[m[1] ?? ""] = (m[2] ?? "").trim();
  }
  return decls;
}

describe("type scale (T86)", () => {
  for (const [name, expected] of Object.entries(SCALE)) {
    test(`@utility ${name}`, () => {
      expect(utility(name)).toEqual(expected);
    });
  }

  test("the scale uses only the self-hosted font variables, and styles.css names no font URL", () => {
    const families = Object.values(SCALE).flatMap((d) => (d["font-family"] ? [d["font-family"]] : []));
    expect(families.every((f) => ["var(--font-sans)", "var(--font-display)", "var(--font-mono)"].includes(f))).toBe(
      true,
    );
    expect(STYLES).not.toMatch(/@font-face|url\(|fonts\.(googleapis|gstatic)\.com/);
  });
});

// Motion guard for ISC-66 (T21): `web/src/styles/motion.css` holds the motion tokens with design.md's values, and
// under `prefers-reduced-motion: reduce` every duration token is `0ms` behind an `!important` safety net. Literal
// durations in `transition` / `animation` declarations are allowed in that file only; this guard mirrors the
// stylelint rule (`declaration-property-value-disallowed-list` in `.stylelintrc.json`) so it stands on its own.
//
// The browser spec (T31) settles ISC-66 on rendered pages; this guard keeps the tokens and the override honest.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

/** Narrow a regex capture or array slot without a `!` assertion; a miss is a broken fixture, so it throws. */
const must = <T,>(value: T | null | undefined, what = "value"): T => {
  if (value === null || value === undefined) throw new Error(`missing ${what}`);
  return value;
};

const SRC = join(import.meta.dir, "..", "src");
const MOTION = join(SRC, "styles", "motion.css");

const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

/** The body of the first `{ … }` block whose prelude matches `prelude`, braces balanced. */
function block(css: string, prelude: RegExp): string {
  const match = must(prelude.exec(css), `block ${prelude.source}`);
  const open = css.indexOf("{", match.index + match[0].length - 1);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) return css.slice(open + 1, i);
  }
  throw new Error(`unbalanced block ${prelude.source}`);
}

/** `name: value` pairs of a flat declaration block, whitespace collapsed. */
function declarations(body: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of body.split(";")) {
    const colon = part.indexOf(":");
    if (colon < 0) continue;
    out.set(part.slice(0, colon).trim(), part.slice(colon + 1).trim().replace(/\s+/g, " "));
  }
  return out;
}

// Mirror of the stylelint rule: a `transition*` / `animation*` property (vendor prefix allowed) whose value holds a
// literal time, `240ms`, `.2s`, `1s`, but not a token name such as `--motion-duration-2s`.
const MOTION_PROPERTY = /^(-[a-z]+-)?(transition|animation)/;
const LITERAL_TIME = /(?<![\w-])\d*\.?\d+m?s\b/;

/** Every `property: value` in `css` that sets a literal duration on a transition or animation. */
function literalDurations(css: string): string[] {
  const hits: string[] = [];
  for (const m of stripComments(css).matchAll(/([-a-z]+)\s*:\s*([^;{}]+)/g)) {
    const [, property = "", value = ""] = m;
    if (MOTION_PROPERTY.test(property) && LITERAL_TIME.test(value)) hits.push(`${property}: ${value.trim()}`);
  }
  return hits;
}

function stylesheets(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && /\.(css|scss)$/.test(e.name))
    .map((e) => join(e.parentPath, e.name));
}

// The prototype names hold the values (spec 024, ISC-146); the app names the components write alias them.
const TOKENS: Record<string, string> = {
  "--dur-hover": "80ms",
  "--dur-pop": "160ms",
  "--dur-sheet": "240ms",
  "--dur-morph": "400ms",
  "--dur-tint": "1200ms",
  "--ease": "cubic-bezier(.2, 0, 0, 1)",
  "--motion-duration-instant": "var(--dur-hover)",
  "--motion-duration-fast": "var(--dur-pop)",
  "--motion-duration-base": "var(--dur-sheet)",
  "--motion-duration-slow": "var(--dur-morph)",
  "--motion-duration-highlight": "var(--dur-tint)",
  "--motion-duration-skeleton": "1600ms",
  "--motion-ease-standard": "var(--ease)",
  "--motion-ease-emphasized": "cubic-bezier(.05, .7, .1, 1)",
  "--motion-ease-exit": "cubic-bezier(.3, 0, 1, 1)",
};
const DURATIONS = Object.keys(TOKENS).filter((name) => /^--(motion-duration|dur)-/.test(name));

/** motion.css without comments, read per test so a missing file fails each assertion rather than the load. */
const motion = () => stripComments(readFileSync(MOTION, "utf8"));

/** `cubic-bezier(0.2,0,0,1)` and `cubic-bezier(.2, 0, 0, 1)` compare equal. */
const normalise = (value: string) =>
  value.replace(/\s+/g, "").replace(/(^|[(,])0\./g, "$1.");

describe("motion.css tokens (ISC-66)", () => {
  // The top-level `:root` block comes first; the reduced-motion `:root` sits inside `@media`, after it.
  const root = () => declarations(block(motion().split(/@media/)[0] ?? "", /:root\s*\{/));

  for (const [name, value] of Object.entries(TOKENS)) {
    test(`${name} is ${value}`, () => {
      expect(normalise(must(root().get(name), name))).toBe(normalise(value));
    });
  }

  test("every token carries a comment naming its use", () => {
    const raw = readFileSync(MOTION, "utf8");
    for (const name of Object.keys(TOKENS)) {
      expect(raw).toMatch(new RegExp(`${name}\\s*:[^;]+;\\s*/\\*[^*]+\\*/`));
    }
  });
});

describe("motion.css under prefers-reduced-motion: reduce (ISC-66)", () => {
  const reduced = () => block(motion(), /@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)\s*\{/);

  test("every duration token is 0ms", () => {
    const root = declarations(block(reduced(), /:root\s*\{/));
    for (const name of DURATIONS) expect(root.get(name)).toBe("0ms");
  });

  test("the global safety net zeroes every animation and transition with !important", () => {
    const net = declarations(block(reduced(),/\*\s*,\s*\*::before\s*,\s*\*::after\s*\{/));
    expect(net.get("animation-duration")).toBe("0ms !important");
    expect(net.get("animation-iteration-count")).toBe("1 !important");
    expect(net.get("transition-duration")).toBe("0ms !important");
    expect(net.get("scroll-behavior")).toBe("auto !important");
  });

  test("the skeleton is static", () => {
    const skeleton = declarations(block(reduced(),/\.ui-skeleton\s*\{/));
    expect(must(skeleton.get("animation"), "animation")).toMatch(/^none\b/);
  });
});

describe("motion.css keyframes", () => {
  for (const name of ["ui-shimmer", "ui-spin", "ui-tint-fade"]) {
    test(`@keyframes ${name} exists`, () => {
      expect(motion()).toMatch(new RegExp(`@keyframes\\s+${name}\\s*\\{`));
    });
  }

  test("ui-tint-fade mixes the primary token and uses no hex", () => {
    const body = block(motion(),/@keyframes\s+ui-tint-fade\s*\{/);
    expect(body).toMatch(/color-mix\([^)]*var\(--color-primary\)/);
    expect(body).toMatch(/transparent/);
    expect(body).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });
});

describe("literal durations live in motion.css only", () => {
  test("the scanner catches a literal and lets a token through", () => {
    expect(literalDurations("a { transition: opacity 240ms ease; -webkit-animation: x .2s; }")).toHaveLength(2);
    expect(literalDurations("a { transition: opacity var(--motion-duration-base) var(--motion-ease-standard); }"))
      .toHaveLength(0);
  });

  test("styles.css imports motion.css", () => {
    expect(readFileSync(join(SRC, "styles.css"), "utf8")).toMatch(/@import\s+["']\.\/styles\/motion\.css["']\s*;/);
  });

  test("no other stylesheet under web/src sets a literal duration", () => {
    const offenders = stylesheets(SRC)
      .filter((path) => path !== MOTION)
      .flatMap((path) => literalDurations(readFileSync(path, "utf8")).map((hit) => `${relative(SRC, path)}: ${hit}`));
    expect(offenders).toEqual([]);
  });
});

// Spec 057 (ISC-377, review 024): stylelint reads only `.css`, so a component's inline `styles` and its Web Animations
// calls (`el.animate(…, { duration: 240, easing: 'cubic-bezier(…)' })`) slipped past the rule above. This guard reads
// every `.ts` under web/src/app (specs excluded: their fixtures may spell a value they assert) for the same literal
// durations, a numeric `duration:` and a literal `easing:` or `cubic-bezier(…)`; TypeScript reads the tokens instead.
const APP = join(SRC, "app");

function scripts(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && e.name.endsWith(".ts") && !e.name.endsWith(".spec.ts"))
    .map((e) => join(e.parentPath, e.name));
}

/** Every literal duration or easing in a TypeScript source: inline CSS and animation options alike. */
function literalMotionInTs(source: string): string[] {
  const code = stripComments(source).replace(/^\s*\/\/.*$/gm, "");
  const hits = literalDurations(code);
  for (const m of code.matchAll(/\bduration\s*:\s*\d[\d_.]*/g)) hits.push(m[0]);
  for (const m of code.matchAll(/\beasing\s*:\s*['"`][^'"`]*['"`]/g)) hits.push(m[0]);
  for (const m of code.matchAll(/cubic-bezier\([^)]*\)/g)) hits.push(m[0]);
  return hits;
}

describe("literal durations and easings in TypeScript (ISC-377)", () => {
  test("the TypeScript scanner catches inline CSS and animation options and lets tokens through", () => {
    expect(literalMotionInTs("styles: [`.dot { animation: pulse 1.6s var(--ease) infinite; }`]")).toHaveLength(1);
    expect(literalMotionInTs("el.animate(k, { duration: 240, easing: 'cubic-bezier(.2,0,0,1)' });")).toHaveLength(3);
    expect(literalMotionInTs("el.animate(k, { duration: tokenMs('--motion-duration-base'), easing: ease });")).toHaveLength(0);
    expect(literalMotionInTs("styles: [`.dot { animation: pulse var(--motion-duration-pulse) var(--ease); }`]")).toHaveLength(0);
  });

  test("no .ts file under web/src/app sets a literal duration or easing", () => {
    const offenders = scripts(APP).flatMap((path) =>
      literalMotionInTs(readFileSync(path, "utf8")).map((hit) => `${relative(SRC, path)}: ${hit}`));
    expect(offenders).toEqual([]);
  });
});

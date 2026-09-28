// Icon guard for ISC-18.2 (T22): every icon the app renders comes from the pinned `lucide-static` version the old
// pages used (1.48.0, spec.md Decisions 2026-09-28). The app may use icons the old pages did not, from that same
// version; it may not use any other source.
//
// Four checks hold the claim:
//   1. `web/package.json` pins `lucide-static` to exactly 1.48.0, and that is the version installed.
//   2. Every name in `ICON_NAMES` exists in the pinned package's `icons/` folder.
//   3. The committed `icons.ts` is byte-identical to a fresh in-process generation, so a hand edit, a stale file or an
//      icon pasted from elsewhere fails.
//   4. The sources under `web/src` render icons only through `<ui-icon>` with a name from the generated union, and
//      contain no hand-drawn `<svg>`. The renderer itself (`icon.ts`) and the generator are the only files allowed to
//      spell `<svg`; any other inline SVG that is not an icon (the progress ring of `ui-ring`, for one) must carry the
//      `data-icon-exempt` attribute on its opening tag to say so on purpose.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { ICON_NAMES } from "../src/app/shared/icons/icon-names.ts";
import { generate, ICONS_PATH, lucideDir, renderIconsModule } from "../src/app/shared/icons/generate-icons.ts";

const PINNED = "1.48.0";
const WEB = join(import.meta.dir, "..");
const SRC = join(WEB, "src");

type PackageJson = { dependencies?: Record<string, string>; devDependencies?: Record<string, string>; version?: string };
const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8")) as PackageJson;

// Files that may spell `<svg` without the exemption: the one renderer and the generator that strips the wrapper.
const SVG_ALLOWED = new Set(["app/shared/icons/icon.ts", "app/shared/icons/generate-icons.ts"]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && /\.(ts|html)$/.test(e.name))
    .map((e) => join(e.parentPath, e.name))
    .sort();
}

/** Icon names a source uses literally: `<ui-icon name="x">` and `<ui-icon [name]="'x'">`. */
function usedIconNames(text: string): string[] {
  const names: string[] = [];
  for (const tag of text.matchAll(/<ui-icon\b[^>]*>/g)) {
    const attrs = tag[0];
    for (const m of attrs.matchAll(/(?<![\w.[-])name\s*=\s*"([^"]*)"/g)) names.push(m[1] ?? "");
    for (const m of attrs.matchAll(/\[name\]\s*=\s*"\s*'([^']*)'\s*"/g)) names.push(m[1] ?? "");
  }
  return names;
}

/** Opening `<svg …>` tags that do not carry `data-icon-exempt`. */
function unexemptSvgs(text: string): string[] {
  return [...text.matchAll(/<svg\b[^>]*>/gi)].map((m) => m[0]).filter((tag) => !/\bdata-icon-exempt\b/.test(tag));
}

describe("ISC-18.2 pinned Lucide version", () => {
  test("web/package.json pins lucide-static to exactly 1.48.0 as a devDependency", () => {
    const pkg = readJson(join(WEB, "package.json"));
    expect(pkg.devDependencies?.["lucide-static"]).toBe(PINNED);
    expect(pkg.dependencies?.["lucide-static"]).toBeUndefined();
  });

  test("the installed lucide-static is the pinned version", () => {
    expect(readJson(join(lucideDir(), "package.json")).version).toBe(PINNED);
  });

  test("every name in ICON_NAMES exists in the pinned package", () => {
    const available = new Set(readdirSync(join(lucideDir(), "icons")).map((f) => f.replace(/\.svg$/, "")));
    const missing = ICON_NAMES.filter((n) => !available.has(n));
    expect(missing).toEqual([]);
  });
});

describe("ISC-18.2 generated icon map", () => {
  test("icons.ts is byte-identical to a fresh generation", () => {
    expect(readFileSync(ICONS_PATH, "utf8")).toBe(generate());
  });

  test("the header names the lucide-static version and says the file is generated", () => {
    const head = readFileSync(ICONS_PATH, "utf8").split("\n").slice(0, 4).join("\n");
    expect(head).toContain(`lucide-static ${PINNED}`);
    expect(head).toMatch(/generated/i);
  });

  test("the generator fails loudly on a name the pinned version does not have", () => {
    expect(() => renderIconsModule(["check", "not-a-lucide-icon"], PINNED)).toThrow(/not-a-lucide-icon/);
  });

  test("the generator rejects a wrapper that the renderer would draw differently", () => {
    const foreign = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor"><path d="M0 0h16v16H0z"/></svg>`;
    expect(() => renderIconsModule(["check"], PINNED, () => foreign)).toThrow(/check/);
  });

  test("the generator output is independent of the list order", () => {
    const read = (n: string) => readFileSync(join(lucideDir(), "icons", `${n}.svg`), "utf8");
    expect(renderIconsModule(["x", "check"], PINNED, read)).toBe(renderIconsModule(["check", "x"], PINNED, read));
  });
});

describe("ISC-18.2 icon usage in web/src", () => {
  const union = new Set<string>(ICON_NAMES);
  const files = sourceFiles(SRC);

  test("the scanner sees usages and hand-drawn svgs (not vacuous)", () => {
    expect(usedIconNames(`<ui-icon name="zap" /><ui-icon [name]="'rocket'" [size]="20" />`)).toEqual(["zap", "rocket"]);
    expect(unexemptSvgs(`<svg viewBox="0 0 24 24"><path d="M0 0"/></svg>`)).toHaveLength(1);
    expect(unexemptSvgs(`<svg data-icon-exempt viewBox="0 0 36 36"><circle r="16"/></svg>`)).toHaveLength(0);
    expect(files.length).toBeGreaterThan(0);
  });

  test("every literal <ui-icon> name is in the generated union", () => {
    const foreign = files.flatMap((f) =>
      usedIconNames(readFileSync(f, "utf8"))
        .filter((n) => !union.has(n))
        .map((n) => `${relative(SRC, f)}: ${n}`),
    );
    expect(foreign).toEqual([]);
  });

  test("no hand-drawn <svg> outside the renderer unless marked data-icon-exempt", () => {
    const raw = files
      .filter((f) => !SVG_ALLOWED.has(relative(SRC, f)))
      .flatMap((f) => unexemptSvgs(readFileSync(f, "utf8")).map((tag) => `${relative(SRC, f)}: ${tag}`));
    expect(raw).toEqual([]);
  });
});

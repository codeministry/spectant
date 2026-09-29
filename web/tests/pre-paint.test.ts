// Pre-paint guard for ISC-18.1 (T58): `web/src/index.html` carries one inline, parser-blocking script in `<head>`
// that sets `data-theme` on `<html>` before the first paint and before Angular boots. Its only source is synchronous
// (`matchMedia`): settings live server-side (`/api/settings`, ISC-18.3) and a script that must run before paint cannot
// await a fetch. The theme service takes over once the app starts; see `web/src/app/core/theme.service.ts`.
//
// The guard parses the file, checks the script's place and shape, then runs its body against a stub `document` and
// `matchMedia`, so the behaviour is tested, not just the text. It also keeps the house rules on the inline code: no
// hex colour, no literal duration, no storage and no network.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";

const WEB = join(import.meta.dir, "..");
const read = (...path: string[]) => readFileSync(join(WEB, ...path), "utf8");

const html = read("src", "index.html");
const styles = read("src", "styles.css");

/** Narrow a regex capture without a `!` assertion; a miss is a broken fixture, so it throws. */
const must = <T,>(value: T | null | undefined, what = "value"): T => {
  if (value === null || value === undefined) throw new Error(`missing ${what}`);
  return value;
};

const head = must(/<head>([\s\S]*?)<\/head>/.exec(html), "<head>")[1] ?? "";
const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)].map((m) => ({
  attrs: m[1] ?? "",
  body: m[2] ?? "",
  index: m.index,
}));
const inline = scripts.filter((s) => !/\bsrc\s*=/.test(s.attrs));
const prePaint = must(inline[0], "inline pre-paint script");

type Attributes = Record<string, string>;

/** Runs the script body with a stub `<html>` and a `matchMedia` answering `dark`, or throwing when `dark` is an Error. */
function run(dark: boolean | Error): { attributes: Attributes; queries: string[] } {
  const attributes: Attributes = {};
  const queries: string[] = [];
  const documentElement = {
    setAttribute: (name: string, value: string) => {
      attributes[name] = value;
    },
    dataset: new Proxy<Record<string, string>>(
      {},
      {
        set: (_target, key: string, value: string) => {
          attributes[`data-${key}`] = value;
          return true;
        },
      },
    ),
  };
  const matchMedia = (query: string) => {
    queries.push(query);
    if (dark instanceof Error) throw dark;
    return { matches: dark, media: query };
  };
  // A fresh context holding only `document` and `matchMedia`: a reference to `window`, `localStorage`, `fetch` or
  // any other browser global throws a ReferenceError, so the script's only inputs are the two it is allowed.
  runInNewContext(prePaint.body, { document: { documentElement }, matchMedia });
  return { attributes, queries };
}

const themeNames = [...styles.matchAll(/name:\s*"([^"]+)"/g)].map((m) => m[1]);

describe("pre-paint data-theme script (ISC-18.1)", () => {
  test("exactly one inline script, in <head>, before <app-root> and any bundle", () => {
    expect(inline).toHaveLength(1);
    expect(head).toContain(prePaint.body);
    expect(prePaint.index).toBeLessThan(html.indexOf("<app-root"));
    for (const external of scripts.filter((s) => s !== prePaint)) expect(prePaint.index).toBeLessThan(external.index);
  });

  test("runs synchronously: classic script, no async, defer or module", () => {
    expect(prePaint.attrs).not.toMatch(/\b(async|defer)\b/);
    expect(prePaint.attrs).not.toMatch(/type\s*=\s*["']?module/);
    expect(prePaint.body).not.toMatch(/\b(await|async|Promise|setTimeout|requestAnimationFrame|fetch|XMLHttpRequest)\b/);
  });

  test("sets spec-dark when the system prefers dark, spec-light otherwise", () => {
    const dark = run(true);
    expect(dark.queries).toEqual(["(prefers-color-scheme: dark)"]);
    expect(dark.attributes["data-theme"]).toBe("spec-dark");
    expect(run(false).attributes["data-theme"]).toBe("spec-light");
  });

  test("falls back to spec-light when matchMedia throws, never leaving <html> without a theme", () => {
    expect(run(new Error("no matchMedia")).attributes["data-theme"]).toBe("spec-light");
  });

  test("names only themes styles.css defines", () => {
    expect(themeNames).toEqual(["spec-light", "spec-dark"]);
    for (const value of prePaint.body.match(/spec-[a-z]+/g) ?? []) expect(themeNames).toContain(value);
  });

  test("keeps the house rules: no hex colour, no literal duration, no browser storage", () => {
    expect(prePaint.body).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(prePaint.body).not.toMatch(/(?<![\w-])\d*\.?\d+m?s\b/);
    expect(prePaint.body).not.toMatch(/\b(localStorage|sessionStorage|indexedDB|document\.cookie)\b/);
  });

  test("styles.css carries no prefers-color-scheme block: the script and the theme service own data-theme", () => {
    expect(styles.replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(/@media[^{]*prefers-color-scheme/);
  });
});

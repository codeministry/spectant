// Inline-declaration guard for ISC-422 (spec 060, T24) and ISC-429 (spec 061, T25): every component under
// `web/src/app/` keeps its template and styles in their own files (`templateUrl`, `styleUrl`). The rule lives in
// `eslint.config.js` (`@angular-eslint/component-max-inline-declarations` with `template: 0` and `styles: 0`); this
// guard runs the workspace ESLint config programmatically on fixture text, so it proves the config as `bun run lint`
// applies it. The type-aware project service only knows files that exist, so the fixture text is linted in place of
// a real file at each path; the file on disk is never read or changed.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { ESLint } from "eslint";

const ROOT = join(import.meta.dir, "..", "..");
const RULE = "@angular-eslint/component-max-inline-declarations";

// Existing files, one per place the scope must (or must not) reach.
const LAYOUT = join(ROOT, "web", "src", "app", "layout", "not-found", "not-found.ts");
const SHARED = join(ROOT, "web", "src", "app", "shared", "open-state.ts");
const CORE = join(ROOT, "web", "src", "app", "core", "api.service.ts");
const LAYOUT_SPEC = join(ROOT, "web", "src", "app", "layout", "tab-bar", "tab-bar.spec.ts");
const FEATURE = join(ROOT, "web", "src", "app", "features", "help", "help-page.ts");
const FEATURE_SPEC = join(ROOT, "web", "src", "app", "features", "help", "help-page.spec.ts");
const ROOT_FILE = join(ROOT, "web", "src", "app", "app.ts");

const eslint = new ESLint({ cwd: ROOT });

/** A minimal standalone component whose decorator carries `metadata`. */
function component(metadata: string): string {
  return [
    "import { ChangeDetectionStrategy, Component } from '@angular/core';",
    "",
    "@Component({",
    "  selector: 'app-fixture',",
    "  changeDetection: ChangeDetectionStrategy.OnPush,",
    `  ${metadata}`,
    "})",
    "export class Fixture {}",
    "",
  ].join("\n");
}

const INLINE_TEMPLATE = component("template: '<p>x</p>',");
const INLINE_STYLES = component("templateUrl: './x.html', styles: [':host { display: block; }'],");
const INLINE_STYLE_STRING = component("templateUrl: './x.html', styles: ':host { display: block; }',");
const EXTERNAL = component("templateUrl: './x.html', styleUrl: './x.css',");

/** The messages of the inline-declaration rule for `source`, linted as if it were the file at `filePath`. */
async function inlineHits(source: string, filePath: string): Promise<string[]> {
  const [result] = await eslint.lintText(source, { filePath });
  if (result === undefined) throw new Error("ESLint returned no result");
  const fatal = result.messages.filter((m) => m.fatal === true);
  if (fatal.length > 0) throw new Error(`ESLint could not parse the fixture: ${fatal.map((m) => m.message).join("; ")}`);
  return result.messages.filter((m) => m.ruleId === RULE).map((m) => m.message);
}

describe("inline template and styles are refused everywhere in the app (ISC-422, ISC-429)", () => {
  test("an inline template under layout/ is reported", async () => {
    const hits = await inlineHits(INLINE_TEMPLATE, LAYOUT);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toContain("`template`");
  }, 60_000);

  test("inline styles under layout/ are reported, as an array and as a string", async () => {
    for (const source of [INLINE_STYLES, INLINE_STYLE_STRING]) {
      const hits = await inlineHits(source, LAYOUT);
      expect(hits).toHaveLength(1);
      expect(hits[0]).toContain("`styles`");
    }
  }, 60_000);

  test("an inline template under shared/ and core/ is reported", async () => {
    expect(await inlineHits(INLINE_TEMPLATE, SHARED)).toHaveLength(1);
    expect(await inlineHits(INLINE_TEMPLATE, CORE)).toHaveLength(1);
  }, 60_000);

  test("templateUrl and styleUrl under layout/ pass", async () => {
    expect(await inlineHits(EXTERNAL, LAYOUT)).toEqual([]);
  }, 60_000);

  test("a spec file under layout/ may declare a test host inline", async () => {
    expect(await inlineHits(INLINE_TEMPLATE, LAYOUT_SPEC)).toEqual([]);
  }, 60_000);

  test("an inline template under features/ and in the app root is reported", async () => {
    expect(await inlineHits(INLINE_TEMPLATE, FEATURE)).toHaveLength(1);
    expect(await inlineHits(INLINE_TEMPLATE, ROOT_FILE)).toHaveLength(1);
  }, 60_000);

  test("a spec file under features/ may declare a test host inline", async () => {
    expect(await inlineHits(INLINE_TEMPLATE, FEATURE_SPEC)).toEqual([]);
  }, 60_000);
});

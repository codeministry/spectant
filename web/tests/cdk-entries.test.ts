// CDK entry guard for ISC-130 (T102): the app may import `@angular/cdk/drag-drop` and `@angular/cdk/scrolling` and
// nothing else from the CDK. Overlay, dialog, menu and focus (a11y) primitives exist once, in `shared/ui`; a second
// layer from the CDK would duplicate the drawer and popover stack. The rule lives in `eslint.config.js`
// (`no-restricted-imports` on `web/src/**/*.ts`); this guard runs the workspace ESLint config programmatically on
// fixture text placed at a real `web/src` path, so it proves the config as `bun run lint` applies it.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { ESLint } from "eslint";

const ROOT = join(import.meta.dir, "..", "..");
// An existing file, so the type-aware project service knows it; only the text passed below is linted.
const PROBE = join(ROOT, "web", "src", "main.ts");

const eslint = new ESLint({ cwd: ROOT });

/** The `no-restricted-imports` messages for one import line, linted as if it were `web/src/main.ts`. */
async function restricted(specifier: string): Promise<string[]> {
  const [result] = await eslint.lintText(`import '${specifier}';\n`, { filePath: PROBE });
  if (result === undefined) throw new Error("ESLint returned no result");
  return result.messages.filter((m) => m.ruleId === "no-restricted-imports").map((m) => m.message);
}

const ALLOWED = ["@angular/cdk/drag-drop", "@angular/cdk/scrolling"];
const FORBIDDEN = [
  "@angular/cdk",
  "@angular/cdk/overlay",
  "@angular/cdk/a11y",
  "@angular/cdk/dialog",
  "@angular/cdk/menu",
  "@angular/cdk/portal",
  "@angular/cdk/bidi",
  "@angular/cdk/drag-drop/testing",
];

describe("only the drag-drop and scrolling CDK entries are importable in web/src (ISC-130)", () => {
  test.each(ALLOWED)("%s passes", async (specifier) => {
    expect(await restricted(specifier)).toEqual([]);
  }, 60_000);

  test.each(FORBIDDEN)("%s is refused with the reason", async (specifier) => {
    const messages = await restricted(specifier);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("@angular/cdk/drag-drop");
    expect(messages[0]).toContain("@angular/cdk/scrolling");
    expect(messages[0]).toContain("shared/ui");
  }, 60_000);

  test("other @angular packages are untouched", async () => {
    expect(await restricted("@angular/core")).toEqual([]);
  }, 60_000);
});

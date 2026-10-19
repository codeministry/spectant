// daisyUI collision guard (spec 049, ISC-284). daisyUI styles its components by bare class names (`.toggle`, `.steps`,
// `.status`, `.loading`, …), and every one of them reaches any element that carries the class, whatever the component
// meant by it: a step toggle named `.toggle` became daisyUI's 40 × 24 px switch with a grey knob, a step list named
// `.steps` became its horizontal stepper with counter circles. This guard reads every own stylesheet under
// `web/src/app` (the `.css` files and the inline `styles` of components, specs excluded) and fails on a class selector
// daisyUI also defines, unless the class is in DELIBERATE: a daisyUI component the app uses on purpose, with its reason.
// The daisyUI class set comes from the installed package, so an upgrade that adds a component is caught here too.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const WEB = join(import.meta.dir, "..");
const APP = join(WEB, "src", "app");
const DAISY = join(WEB, "node_modules", "daisyui", "components");

/** The daisyUI classes the app styles on purpose: the class is daisyUI's component, the own rule refines it. */
const DELIBERATE: Readonly<Record<string, string>> = {
  alert: "the app's single toast (ui-toast) renders daisyUI's alert",
  toast: "the app's single toast (ui-toast) is daisyUI's toast placement",
  "btn-primary": "the gate button refines daisyUI's primary button fill (--btn-color)",
  checkbox: "task, operator-step and gallery checkboxes are daisyUI's checkbox, the own rules set size and tone",
};

/** Every class name daisyUI's component stylesheets define, modifiers included (`btn-primary`, `loading-spinner`). */
const daisyClasses = new Set(
  readdirSync(DAISY)
    .filter((name) => name.endsWith(".css"))
    .flatMap((name) => [...readFileSync(join(DAISY, name), "utf8").matchAll(/\.([a-z][a-z0-9-]*)/gu)].map((m) => m[1] ?? "")),
);

/** Own stylesheets: `.css` files and the `styles` template literal of components, specs excluded. */
function stylesheets(dir = APP): Array<{ file: string; css: string }> {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return stylesheets(path);
    if (entry.name.endsWith(".css")) return [{ file: relative(WEB, path), css: readFileSync(path, "utf8") }];
    if (!entry.name.endsWith(".ts") || entry.name.endsWith(".spec.ts")) return [];
    const inline = /styles:\s*`([\s\S]*?)`/u.exec(readFileSync(path, "utf8"));
    return inline?.[1] === undefined ? [] : [{ file: relative(WEB, path), css: inline[1] }];
  });
}

/** The class names a stylesheet's selectors name: every `.name` before a `{`, comments and declarations left out. */
function selectorClasses(css: string): string[] {
  const code = css.replace(/\/\*[\s\S]*?\*\//gu, "");
  return [...code.matchAll(/([^{}]*)\{/gu)].flatMap((m) =>
    // A selector part never holds a colon-value pair outside a pseudo; strip url() and numbers like `.5s` stay out.
    [...(m[1] ?? "").matchAll(/(?:^|[\s,>+~(&])\.([a-z][a-z0-9-]*)/gmu)].map((c) => c[1] ?? ""),
  );
}

describe("daisyUI class collisions (spec 049, ISC-284)", () => {
  test("the package's component classes are read", () => {
    expect(daisyClasses.has("toggle")).toBe(true);
    expect(daisyClasses.has("steps")).toBe(true);
  });

  test("no own stylesheet defines a class daisyUI also defines, unless it is deliberate", () => {
    const hits = stylesheets().flatMap(({ file, css }) =>
      [...new Set(selectorClasses(css))].filter((name) => daisyClasses.has(name) && !(name in DELIBERATE)).map((name) => `${file}: .${name}`),
    );
    expect(hits).toEqual([]);
  });

  test("every deliberate class is a daisyUI class and still used", () => {
    const used = new Set(stylesheets().flatMap(({ css }) => selectorClasses(css)));
    for (const name of Object.keys(DELIBERATE)) {
      expect(daisyClasses.has(name), `${name} is a daisyUI class`).toBe(true);
      expect(used.has(name), `${name} is still styled somewhere`).toBe(true);
    }
  });
});

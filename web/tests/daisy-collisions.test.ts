// daisyUI collision guard (spec 049, ISC-284; spec 057, ISC-388). daisyUI styles its components by bare class names
// (`.toggle`, `.steps`, `.status`, `.loading`, …), and every one of them reaches any element that carries the class,
// whatever the component meant by it: a step toggle named `.toggle` became daisyUI's 40 × 24 px switch with a grey
// knob, a step list named `.steps` became its horizontal stepper with counter circles.
//
// Two checks, both against the class set of the installed package (an upgrade that adds a component is caught too):
// - Stylesheets: every own stylesheet under `web/src/app` (`.css` files and the inline `styles` of components, specs
//   excluded) fails on a class selector daisyUI also defines, unless the class is in DELIBERATE.
// - Templates: every class an app template sets (`.html` files, inline `template`s and `host` objects, specs excluded)
//   fails when it is a daisyUI class with neither its own rule nor an entry in DELIBERATE. A class with its own rule
//   is the stylesheet check's case (a collision unless deliberate); a bare daisyUI class with no own rule is daisyUI's
//   component by accident, a `hero` or a `list` nobody meant.
//
// What a template sets: the tokens of a static `class="…"` (an `{{ }}` interpolation in it is cut out, its static
// tokens stay), each `[class.x]` binding, and the `class` / `[class.x]` keys of a component's `host`. Not read: a
// class computed from an expression (`[class]="…"`, `[ngClass]`, `[attr.class]`, `classList` from TypeScript); the
// last test keeps the first three out of the app, so no template class escapes the check.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type Source, stylesheets, templates } from "./sources";

const WEB = join(import.meta.dir, "..");
const APP = join(WEB, "src", "app");
const DAISY = join(WEB, "node_modules", "daisyui", "components");

const BUTTON = "the app's buttons are daisyUI's btn with its size and ghost modifiers; tokens.css sets the fills";
const BADGE = "the zen footer, the claims tab and ui-disclosure's count are daisyUI's small badge";
const CHECKBOX = "task, operator-step and gallery checkboxes are daisyUI's checkbox, the own rules set size and tone";
const LOADING = "running work shows daisyUI's extra-small spinner; motion.css holds it still under reduced motion";
const FIELD = "notes and help form fields are daisyUI's input, textarea and small select";
const LINK = "inline links in the status tab, the spec dashboard, notes and the board are daisyUI's hover link";
const TOAST = "the app's single toast (ui-toast) is daisyUI's toast placement";

/** The daisyUI classes the app uses on purpose, with the reason: styled by daisyUI alone, or refined by an own rule. */
const DELIBERATE: Readonly<Record<string, string>> = {
  alert:
    "ui-toast renders daisyUI's alert; the needs-you stale-agent notice uses it too, its own rule sets layout and edge",
  toast: TOAST,
  "toast-bottom": TOAST,
  "toast-end": TOAST,
  btn: BUTTON,
  "btn-primary": "the gate button refines daisyUI's primary button fill (--btn-color)",
  "btn-ghost": BUTTON,
  "btn-sm": BUTTON,
  "btn-xs": BUTTON,
  "btn-square": BUTTON,
  badge: BADGE,
  "badge-sm": BADGE,
  "badge-ghost": BADGE,
  checkbox: CHECKBOX,
  "checkbox-sm": CHECKBOX,
  "checkbox-success": CHECKBOX,
  loading: LOADING,
  "loading-spinner": LOADING,
  "loading-xs": LOADING,
  input: FIELD,
  textarea: FIELD,
  select: FIELD,
  "select-sm": FIELD,
  link: LINK,
  "link-hover": LINK,
  card: "the matrix tab's frame is daisyUI's card with base-100 fill and base-300 border",
};

/** Every class name daisyUI's component stylesheets define, modifiers included (`btn-primary`, `loading-spinner`). */
const daisyClasses = new Set(
  readdirSync(DAISY)
    .filter((name) => name.endsWith(".css"))
    .flatMap((name) => [...readFileSync(join(DAISY, name), "utf8").matchAll(/\.([a-z][a-z0-9-]*)/gu)].map((m) => m[1] ?? "")),
);

/** The class names a stylesheet's selectors name: every `.name` before a `{`, comments and declarations left out. */
function selectorClasses(css: string): string[] {
  const code = css.replace(/\/\*[\s\S]*?\*\//gu, "");
  return [...code.matchAll(/([^{}]*)\{/gu)].flatMap((m) =>
    // A selector part never holds a colon-value pair outside a pseudo; strip url() and numbers like `.5s` stay out.
    [...(m[1] ?? "").matchAll(/(?:^|[\s,>+~(&])\.([a-z][a-z0-9-]*)/gmu)].map((c) => c[1] ?? ""),
  );
}

/** The classes a template sets: static `class="…"` tokens, `[class.x]` bindings and a host object's `class` value. */
function templateClasses(markup: string): string[] {
  const code = markup.replace(/<!--[\s\S]*?-->/gu, "");
  const fixed = [...code.matchAll(/(?:^|[\s'"])class\s*=\s*(["'])([\s\S]*?)\1/gu)].flatMap((m) =>
    (m[2] ?? "").replace(/\{\{[\s\S]*?\}\}/gu, " ").split(/\s+/u),
  );
  const bound = [...code.matchAll(/\[class\.([A-Za-z0-9_-]+)\]/gu)].map((m) => m[1] ?? "");
  const host = [...code.matchAll(/(?:^|[\s,{])['"]?class['"]?\s*:\s*(['"])([^'"]*)\1/gu)].flatMap((m) => (m[2] ?? "").split(/\s+/u));
  return [...fixed, ...bound, ...host].filter((name) => name !== "");
}

/**
 * Template hits: a class a template sets that daisyUI defines, with no own rule (`ownRules`, the classes own
 * stylesheets name) and no entry in `deliberate`. Pure: the caller hands in templates, class sets and the list.
 */
function templateHits(
  sources: readonly Source[],
  daisy: ReadonlySet<string>,
  ownRules: ReadonlySet<string>,
  deliberate: Readonly<Record<string, string>>,
): string[] {
  return sources.flatMap(({ file, text }) =>
    [...new Set(templateClasses(text))]
      .filter((name) => daisy.has(name) && !ownRules.has(name) && !(name in deliberate))
      .map((name) => `${file}: ${name}`),
  );
}

const ownStyles = stylesheets(APP, WEB);
const appTemplates = templates(APP, WEB);
const ownRules = new Set(ownStyles.flatMap(({ text }) => selectorClasses(text)));

describe("daisyUI class collisions (spec 049, ISC-284)", () => {
  test("the package's component classes are read", () => {
    expect(daisyClasses.has("toggle")).toBe(true);
    expect(daisyClasses.has("steps")).toBe(true);
    expect(daisyClasses.has("hero")).toBe(true);
  });

  test("no own stylesheet defines a class daisyUI also defines, unless it is deliberate", () => {
    const hits = ownStyles.flatMap(({ file, text }) =>
      [...new Set(selectorClasses(text))].filter((name) => daisyClasses.has(name) && !(name in DELIBERATE)).map((name) => `${file}: .${name}`),
    );
    expect(hits).toEqual([]);
  });

  test("every deliberate class is a daisyUI class and still used", () => {
    const used = new Set([...ownRules, ...appTemplates.flatMap(({ text }) => templateClasses(text))]);
    for (const name of Object.keys(DELIBERATE)) {
      expect(daisyClasses.has(name), `${name} is a daisyUI class`).toBe(true);
      expect(used.has(name), `${name} is still set or styled somewhere`).toBe(true);
    }
  });
});

describe("daisyUI classes in templates (spec 057, ISC-388)", () => {
  test("a template that sets a bare daisyUI class is a hit, an own rule or a deliberate entry is not", () => {
    const fixture: Source[] = [
      { file: "fixture/hero.html", text: '<section class="hero intro">…</section>' },
      { file: "fixture/inline.ts", text: '<p [class.label]="on()" class="note {{ tone() }}">…</p>' },
      { file: "fixture/host.ts", text: " class: 'stat-box divider'" },
      { file: "fixture/fine.html", text: '<button class="btn btn-sm step">…</button><!-- class="hero" -->' },
    ];
    expect(templateHits(fixture, daisyClasses, new Set(["step"]), DELIBERATE)).toEqual([
      "fixture/hero.html: hero",
      "fixture/inline.ts: label",
      "fixture/host.ts: divider",
    ]);
  });

  test("no app template sets a daisyUI class without its own rule or a deliberate entry", () => {
    expect(appTemplates.length).toBeGreaterThan(40);
    expect(templateHits(appTemplates, daisyClasses, ownRules, DELIBERATE)).toEqual([]);
  });

  test("no app template computes its class list from an expression the check cannot read", () => {
    const unread = appTemplates.flatMap(({ file, text }) =>
      [...text.matchAll(/\[(?:class|ngClass|attr\.class)\]\s*=/gu)].map((m) => `${file}: ${m[0]}`),
    );
    expect(unread).toEqual([]);
  });
});

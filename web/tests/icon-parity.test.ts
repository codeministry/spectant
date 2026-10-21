// Icon-parity guard for ISC-147 (T11): every icon the prototype draws maps, by name, to the same symbol in the pinned
// `lucide-static`. The prototype carries an older Lucide, so its path data is never rendered; the app draws the pinned
// package's path for the mapped name (`icons.ts`, generated from `ICON_NAMES`).
//
// Four checks hold the claim:
//   1. Every icon key of the prototype reference (`fixtures/prototype-reference.json`, part `icons`) has an entry in
//      `ICON_KEY_MAP`, so no prototype icon is left unmapped.
//   2. The mapping has no key the fixture lacks, so it cannot drift from the prototype's icon tables.
//   3. Every mapped name exists in the pinned package's `icons/` folder, the version the fixture was measured against.
//   4. Every mapped name is in `ICON_NAMES`, so the app can render it through `<ui-icon>`.
// Whether a mapped name is the same symbol as the prototype's drawing is reviewed by hand in the spec's parity
// inventory; this guard holds completeness and the pin.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ICON_NAMES } from "../src/app/shared/icons/icon-names.ts";
import { lucideDir } from "../src/app/shared/icons/generate-icons.ts";
import { ICON_KEY_MAP } from "../src/app/shared/icons/icon-map.ts";

type IconEntry = { lucide?: string; source?: string };
type Reference = { icons?: Record<string, IconEntry>; lucide?: string };

/** Narrow a value without a `!` assertion; a miss is a broken fixture, so it throws. */
const must = <T,>(value: T | null | undefined, what = "value"): T => {
  if (value === null || value === undefined) throw new Error(`missing ${what}`);
  return value;
};

const reference = JSON.parse(
  readFileSync(join(import.meta.dir, "fixtures", "prototype-reference.json"), "utf8"),
) as Reference;
const fixtureKeys = Object.keys(must(reference.icons, "icons part of the prototype reference")).sort();
const mapped = Object.entries(ICON_KEY_MAP);
const pinned = (JSON.parse(readFileSync(join(lucideDir(), "package.json"), "utf8")) as { version?: string }).version;
const available = new Set(readdirSync(join(lucideDir(), "icons")).map((f) => f.replace(/\.svg$/, "")));

describe("ISC-147 prototype icon mapping", () => {
  test("the fixture has icon keys and was measured against the installed lucide-static (not vacuous)", () => {
    expect(fixtureKeys.length).toBeGreaterThan(0);
    expect(must(reference.lucide, "lucide version of the prototype reference")).toBe(must(pinned, "pinned version"));
  });

  test("every icon key of the prototype has an entry in the mapping", () => {
    const unmapped = fixtureKeys.filter((k) => !Object.hasOwn(ICON_KEY_MAP, k));
    expect(unmapped).toEqual([]);
  });

  test("the mapping has no key the prototype lacks", () => {
    const fixture = new Set(fixtureKeys);
    const extra = mapped.map(([k]) => k).filter((k) => !fixture.has(k));
    expect(extra).toEqual([]);
  });

  test("every mapped name exists in the pinned lucide-static", () => {
    const outside = mapped.filter(([, name]) => !available.has(name)).map(([k, name]) => `${k} -> ${name}`);
    expect(outside).toEqual([]);
  });

  test("every mapped name is in ICON_NAMES, so <ui-icon> can render it", () => {
    const names = new Set<string>(ICON_NAMES);
    const missing = mapped.filter(([, name]) => !names.has(name)).map(([k, name]) => `${k} -> ${name}`);
    expect(missing).toEqual([]);
  });
});

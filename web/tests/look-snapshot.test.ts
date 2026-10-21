// Look-snapshot guard for ISC-450 (spec 063): the app is the only reference of its own look. Every token the app's
// cascade declares on the `data-theme` element, resolved per theme by `look-snapshot.ts` from `web/src` alone, must
// equal the tracked `fixtures/look-snapshot.json`: the same token names, the same values. A token value changed in
// `tokens.css`, `styles.css`, `fonts.css` or `motion.css` without a new snapshot fails here, and the failure names
// the theme and each differing token with its snapshot and its current value.
//
// A deliberate look change updates the snapshot in the same commit: run `bun run look:snapshot` and review the diff of
// `fixtures/look-snapshot.json`.
//
// The mutation case proves the guard bites: it feeds the resolver the app's sources with one token value changed in
// memory (nothing on disk is touched) and expects the comparison to report exactly that token.
//
// The icon part holds ISC-452: every Lucide name of the app's icon key map (`icon-map.ts`) exists in the pinned
// `lucide-static` (an alias file there counts as its canonical icon) and in `ICON_NAMES`, so `<ui-icon>` can render
// it, and the map key → name equals the snapshot's `icons` part exactly. Its mutation cases change one name and invent
// one in memory and expect each to be reported.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { lucideDir } from "../src/app/shared/icons/generate-icons";
import { ICON_NAMES } from "../src/app/shared/icons/icon-names";
import { iconKeys, readSnapshot, readSource, resolveTokens, type SourceReader, THEMES } from "./look-snapshot";

/** One line per key whose value differs between the snapshot part and the app: missing, extra or changed. */
function differences(label: string, expected: Record<string, string>, actual: Record<string, string>): string[] {
  const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort();
  return keys.flatMap((key) => {
    const [want, got] = [expected[key], actual[key]];
    if (want === got) return [];
    if (want === undefined) return [`${label} ${key}: not in the snapshot, app has ${JSON.stringify(got)}`];
    if (got === undefined) return [`${label} ${key}: snapshot has ${JSON.stringify(want)}, app no longer declares it`];
    return [`${label} ${key}: snapshot ${JSON.stringify(want)}, app ${JSON.stringify(got)}`];
  });
}

const snapshot = readSnapshot();

describe("look snapshot: tokens", () => {
  test("the snapshot file exists and holds tokens for both themes", () => {
    expect(snapshot?.tokens && Object.keys(snapshot.tokens).sort()).toEqual([...THEMES].sort());
  });

  for (const theme of THEMES) {
    test(`every resolved ${theme} token equals the snapshot`, () => {
      const expected = snapshot?.tokens?.[theme] ?? {};
      expect(Object.keys(expected).length).toBeGreaterThan(0);
      expect(differences(theme, expected, resolveTokens(theme))).toEqual([]);
    });
  }

  test("mutation: one token value changed in a fixture source is reported, and only that token", () => {
    const original = "--track: oklch(62% 0.01 331);";
    const mutated = "--track: oklch(50% 0.01 331);";
    const tokensCss = readSource("styles/tokens.css");
    expect(tokensCss.split(original).length - 1).toBe(1);

    const reader: SourceReader = (path) =>
      path === "styles/tokens.css" ? tokensCss.replace(original, mutated) : readSource(path);

    const diff = differences("light", snapshot?.tokens?.light ?? {}, resolveTokens("light", reader));
    expect(diff).toHaveLength(1);
    expect(diff[0]).toStartWith("light --track: snapshot ");
    // The other theme reads the same mutated sources and stays equal: the change sits in the `spec-light` rule.
    expect(differences("dark", snapshot?.tokens?.dark ?? {}, resolveTokens("dark", reader))).toEqual([]);
  });
});

/** The names of the pinned `lucide-static`: one `icons/<name>.svg` per icon, alias files included. */
const lucideNames = new Set(readdirSync(join(lucideDir(), "icons")).map((file) => file.replace(/\.svg$/, "")));

/** One line per map entry whose Lucide name is not a file of the pinned package. */
const outsideLucide = (map: Record<string, string>, available: ReadonlySet<string>): string[] =>
  Object.entries(map)
    .filter(([, name]) => !available.has(name))
    .map(([key, name]) => `${key} -> ${name}: not in lucide-static`);

describe("look snapshot: icons", () => {
  const icons = iconKeys();

  test("the installed lucide-static is the version web/package.json pins, and the map is not empty", () => {
    type Manifest = { version?: string; devDependencies?: Record<string, string> };
    const read = (path: string) => JSON.parse(readFileSync(path, "utf8")) as Manifest;
    const pinned = read(join(import.meta.dir, "..", "package.json")).devDependencies?.["lucide-static"];
    expect(pinned).toBeString();
    expect(read(join(lucideDir(), "package.json")).version).toBe(pinned);
    expect(Object.keys(icons).length).toBeGreaterThan(0);
  });

  test("every Lucide name of the map exists in the pinned lucide-static", () => {
    expect(outsideLucide(icons, lucideNames)).toEqual([]);
  });

  test("every Lucide name of the map is in ICON_NAMES, so <ui-icon> can render it", () => {
    const names = new Set<string>(ICON_NAMES);
    expect(Object.entries(icons).filter(([, name]) => !names.has(name))).toEqual([]);
  });

  test("the map key → name equals the snapshot", () => {
    const expected = snapshot?.icons ?? {};
    expect(Object.keys(expected).length).toBeGreaterThan(0);
    expect(differences("icons", expected, icons)).toEqual([]);
  });

  test("mutation: a changed name and a name lucide-static lacks are each reported", () => {
    const [key, name] = Object.entries(icons).sort()[0] ?? ["", ""];
    const other = name === "anchor" ? "bot" : "anchor";
    const changed = { ...icons, [key]: other };
    expect(differences("icons", snapshot?.icons ?? {}, changed)).toEqual([
      `icons ${key}: snapshot ${JSON.stringify(name)}, app ${JSON.stringify(other)}`,
    ]);

    const invented = { ...icons, [key]: "no-such-icon" };
    expect(outsideLucide(invented, lucideNames)).toEqual([`${key} -> no-such-icon: not in lucide-static`]);
  });
});

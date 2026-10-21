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
import { describe, expect, test } from "bun:test";
import { readSnapshot, readSource, resolveTokens, type SourceReader, THEMES } from "./look-snapshot";

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

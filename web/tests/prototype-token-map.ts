// The one name map for ISC-146 (spec 024): every custom property the prototype's `styles.css` declares in `:root`,
// `[data-theme="spec-light"]` and `[data-theme="spec-dark"]`, as `fixtures/prototype-reference.json` carries them
// (`tokens.root`, `tokens.light`, `tokens.dark`), mapped to the app custom property, or properties, that hold the same
// value. `prototype-tokens.test.ts` (ISC-146) and `theme-colors.test.ts` (ISC-18) both read it, so a rename happens in
// one place.
//
// Rules of the map, reviewed:
// - Every prototype property has an entry; a property without one fails the guard instead of being skipped.
// - Where the app has a daisyUI slot or an older name for the value, the entry names it. The accents keep the old
//   pages' family names (cyan → disp, violet → ques, lime → clos, green → done, yellow → conc, orange → hover,
//   red → fail); the prototype's `--teal-t` is the ink on teal, so it is `--teal-content` (daisyUI's word for it).
// - Where one prototype value has several homes (a daisyUI slot and its custom-property twin), every home is listed
//   and every home must hold the value, so the twins cannot drift apart.
// - A prototype property without an app counterpart is a token of its own under the prototype's name (`--rail`,
//   `--space-*`, `--radius*`, `--dur-*`, `--ease`, `--font-ui`, `--font-brand`, `--shadow-hair`).
// - `--*-text` maps to the app's `--*-text` tokens, never to the `--*-ink` contrast tokens; those are ISC-146.1.
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const PROTOTYPE_THEMES = ["spec-light", "spec-dark"] as const;
export type PrototypeTheme = (typeof PROTOTYPE_THEMES)[number];

type Fixture = { tokens: { root: Record<string, string>; light: Record<string, string>; dark: Record<string, string> } };
const FIXTURE = JSON.parse(
  readFileSync(join(import.meta.dir, "fixtures", "prototype-reference.json"), "utf8"),
) as Fixture;

/** The prototype's custom properties: `root` holds `:root`, each theme its `[data-theme]` block. */
export const PROTOTYPE_TOKENS: Readonly<Record<"root" | PrototypeTheme, Readonly<Record<string, string>>>> = {
  root: FIXTURE.tokens.root,
  "spec-light": FIXTURE.tokens.light,
  "spec-dark": FIXTURE.tokens.dark,
};

/** Prototype custom property → the app custom properties that hold its value (first entry: the primary home). */
export const PROTOTYPE_TOKEN_MAP: Readonly<Record<string, readonly string[]>> = {
  // `:root`: motion (motion.css), type (fonts.css), shape and layout (tokens.css).
  "--dur-hover": ["--dur-hover"],
  "--dur-pop": ["--dur-pop"],
  "--dur-sheet": ["--dur-sheet"],
  "--dur-morph": ["--dur-morph"],
  "--dur-tint": ["--dur-tint"],
  "--ease": ["--ease", "--motion-ease-standard"],
  "--font-ui": ["--font-ui"],
  "--font-brand": ["--font-brand"],
  "--font-mono": ["--font-mono"],
  "--radius-sm": ["--radius-sm"],
  "--radius": ["--radius"],
  "--radius-card": ["--radius-card"],
  "--rail": ["--rail"],
  "--shadow-hair": ["--shadow-hair"],
  "--space-1": ["--space-1"],
  "--space-2": ["--space-2"],
  "--space-3": ["--space-3"],
  "--space-4": ["--space-4"],
  "--space-5": ["--space-5"],
  "--space-6": ["--space-6"],

  // Theme blocks: surfaces and text.
  "--page": ["--color-base-200"],
  "--page-glass": ["--page-glass"],
  "--card": ["--color-base-100"],
  "--raised": ["--color-base-300"],
  "--lane": ["--lane"],
  "--text": ["--color-base-content"],
  "--muted": ["--muted"],
  "--border": ["--line"],
  "--track": ["--track"],
  "--scrim": ["--scrim"],
  "--shadow-c": ["--shadow-color"],

  // Accents: the colour, its tint, its text.
  "--cyan": ["--color-primary", "--color-info"],
  "--cyan-t": ["--disp-t"],
  "--cyan-text": ["--disp-text"],
  "--violet": ["--color-secondary"],
  "--violet-t": ["--ques-t"],
  "--violet-text": ["--ques-text"],
  "--lime": ["--color-accent"],
  "--lime-t": ["--clos-t"],
  "--lime-text": ["--clos-text"],
  "--green": ["--color-success"],
  "--green-t": ["--done-t"],
  "--green-text": ["--done-text"],
  "--yellow": ["--conc"],
  "--yellow-t": ["--conc-t"],
  "--yellow-text": ["--conc-text"],
  "--orange": ["--color-warning"],
  "--orange-t": ["--hover-t"],
  "--orange-text": ["--hover-text"],
  "--red": ["--color-error"],
  "--red-t": ["--fail-t"],
  "--red-text": ["--fail-text"],
  "--teal": ["--teal"],
  "--teal-t": ["--teal-content"],
  "--badge": ["--badge", "--color-neutral", "--badge-fill"],
  "--badge-text": ["--color-neutral-content", "--badge-ink"],
};

/** The homes of a prototype property; a property the map lacks throws, so nothing is skipped silently. */
export function homesOf(name: string): readonly string[] {
  const homes = PROTOTYPE_TOKEN_MAP[name];
  if (!homes || homes.length === 0) throw new Error(`${name} has no entry in PROTOTYPE_TOKEN_MAP`);
  return homes;
}

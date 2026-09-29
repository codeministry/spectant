// ISC-88 guard (T60): the state vocabulary is complete. Every card state and every claim state has a glyph with its
// own (shape, tone) pair, and a `states.card.*` / `states.claim.*` word in both catalogues. The glyph tables are
// `Record`s over core's `CardState` and `ClaimGlyphState`, so the type check already fails on a state missing there;
// this test closes the loop to the catalogues, which no type reaches.
import { describe, expect, test } from "bun:test";
import de from "../src/i18n/de.json";
import en from "../src/i18n/en.json";
import { CARD_GLYPHS, CARD_STATES, CLAIM_GLYPHS, CLAIM_STATES, stateKey } from "../src/app/shared/ui/glyph/states";

type Catalogue = Record<string, unknown>;

const lookup = (catalogue: Catalogue, key: string): unknown =>
  key.split(".").reduce<unknown>((node, part) => (node && typeof node === "object" ? (node as Catalogue)[part] : undefined), catalogue);

const WORDS = [
  ...CARD_STATES.map((state) => stateKey(state, "card")),
  ...CLAIM_STATES.map((state) => stateKey(state, "claim")),
];

describe("state vocabulary (ISC-88)", () => {
  test("eleven card states and six claim states", () => {
    expect(CARD_STATES).toHaveLength(11);
    expect(CLAIM_STATES).toHaveLength(6);
    expect(new Set(WORDS).size).toBe(17);
  });

  test("no two of the seventeen states share a glyph shape and tone", () => {
    const pairs = [...Object.values(CARD_GLYPHS), ...Object.values(CLAIM_GLYPHS)].map((g) => `${g.shape}/${g.tone}`);
    expect(new Set(pairs).size).toBe(17);
  });

  for (const [name, catalogue] of [["en", en], ["de", de]] as const) {
    test(`${name}.json has a non-empty word for every state`, () => {
      const missing = WORDS.filter((key) => {
        const word = lookup(catalogue, key);
        return typeof word !== "string" || word.trim() === "";
      });
      expect(missing).toEqual([]);
    });
  }
});

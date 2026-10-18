// ISC-88 guard (T60): the state vocabulary is complete. Every card state and every claim state has a glyph with its
// own (shape, tone) pair, and a `states.card.*` / `states.claim.*` word in both catalogues. The glyph tables are
// `Record`s over core's `CardState` and `ClaimGlyphState`, so the type check already fails on a state missing there;
// this test closes the loop to the catalogues, which no type reaches.
//
// Spec 040 (ISC-224, T43/T44) adds the five item states (`states.item.*`). A card or claim word that means one of them
// (`ITEM_ALIASES`) shares its glyph and reads its word in both catalogues; every other word keeps a pair of its own.
import { describe, expect, test } from "bun:test";
import de from "../src/i18n/de.json";
import en from "../src/i18n/en.json";
import {
  CARD_GLYPHS,
  CARD_STATES,
  CLAIM_GLYPHS,
  CLAIM_STATES,
  type GlyphState,
  ITEM_GLYPHS,
  ITEM_STATES,
  itemStateOf,
  stateKey,
} from "../src/app/shared/ui/glyph/states";

type Catalogue = Record<string, unknown>;

const lookup = (catalogue: Catalogue, key: string): unknown =>
  key.split(".").reduce<unknown>((node, part) => (node && typeof node === "object" ? (node as Catalogue)[part] : undefined), catalogue);

const WORDS = [
  ...CARD_STATES.map((state) => stateKey(state, "card")),
  ...CLAIM_STATES.map((state) => stateKey(state, "claim")),
  ...ITEM_STATES.map((state) => stateKey(state, "item")),
];

/** Every glyph entry with the state it stands for: an alias stands for its item state. */
const ENTRIES: ReadonlyArray<readonly [string, string]> = (
  [
    ...Object.entries(CARD_GLYPHS).map(([state, g]) => [state, "card", g] as const),
    ...Object.entries(CLAIM_GLYPHS).map(([state, g]) => [state, "claim", g] as const),
    ...Object.entries(ITEM_GLYPHS).map(([state, g]) => [state, "item", g] as const),
  ] as const
).map(([state, family, g]) => {
  const item = itemStateOf(state as GlyphState, family);
  return [`${g.shape}/${g.tone}`, item === null ? `${family}:${state}` : `item:${item}`] as const;
});

describe("state vocabulary (ISC-88, ISC-224)", () => {
  test("eleven card states, six claim states and five item states", () => {
    expect(CARD_STATES).toHaveLength(11);
    expect(CLAIM_STATES).toHaveLength(6);
    expect(ITEM_STATES).toEqual(["open", "waiting", "running", "aborted", "done"]);
    expect(new Set(WORDS).size).toBe(22);
  });

  test("no (shape, tone) pair stands for two states, an alias counting as its item state", () => {
    const stateOf = new Map<string, Set<string>>();
    const pairOf = new Map<string, Set<string>>();
    for (const [pair, state] of ENTRIES) {
      stateOf.set(pair, (stateOf.get(pair) ?? new Set()).add(state));
      pairOf.set(state, (pairOf.get(state) ?? new Set()).add(pair));
    }
    expect([...stateOf].filter(([, states]) => states.size > 1)).toEqual([]);
    expect([...pairOf].filter(([, pairs]) => pairs.size > 1)).toEqual([]);
    // 14 card + 6 claim + 5 item entries; the card's waiting, running, closed and the claim's open, taken, blocked alias.
    expect(ENTRIES).toHaveLength(25);
    expect(stateOf.size).toBe(19);
  });

  test("aborted is the one warning glyph of the item family, on the retired ring-slash", () => {
    expect(ITEM_GLYPHS.aborted).toEqual({ shape: "ring-slash", tone: "warning" });
    expect(Object.values(ITEM_GLYPHS).filter((g) => g.tone === "warning")).toHaveLength(1);
    expect(Object.values(CLAIM_GLYPHS).filter((g) => g.shape === "ring-slash" && g.tone !== "warning")).toEqual([]);
  });

  for (const [name, catalogue] of [["en", en], ["de", de]] as const) {
    test(`${name}.json has a non-empty word for every state`, () => {
      const missing = WORDS.filter((key) => {
        const word = lookup(catalogue, key);
        return typeof word !== "string" || word.trim() === "";
      });
      expect(missing).toEqual([]);
    });

    test(`${name}.json gives an alias the word of its item state, and no other word one of the five`, () => {
      const itemWords = new Map(ITEM_STATES.map((state) => [lookup(catalogue, stateKey(state, "item")), state]));
      const wrong: string[] = [];
      for (const [family, states] of [["card", CARD_STATES], ["claim", CLAIM_STATES]] as const) {
        for (const state of states) {
          const word = lookup(catalogue, stateKey(state, family));
          const want = itemStateOf(state, family);
          if (want !== null && word !== lookup(catalogue, stateKey(want, "item"))) wrong.push(`${family}.${state} is ${String(word)}`);
          if (want === null && itemWords.has(word)) wrong.push(`${family}.${state} reads the item word ${String(word)}`);
        }
      }
      expect(wrong).toEqual([]);
    });
  }
});

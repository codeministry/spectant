import type { CardState, ClaimGlyphState, ItemState, RunState } from '../../../../../../core/src/files';
import type { Tone } from '../tone';

/**
 * The state vocabulary of spec 002 (ISC-88): the eleven card states of the round board and the six claim states of
 * the Claims tab. Each has its own glyph shape and tone, and no two of the seventeen share the (shape, tone) pair, so
 * a state never rests on colour alone (design.md § States). Pure TypeScript: `web/tests/states-complete.test.ts`
 * imports it under `bun test` to check both catalogues.
 *
 * Spec 027 (ISC-179.1) adds the run states of a task in a worktree to the card family: `patched`, `applied` and
 * `applied-open` are new entries, `dispatched` and `building` reuse `dispatched` and `running` (`runGlyphState`).
 * They are glyphs of a chip, not states a card of the round board takes, so `CARD_STATES` stays the eleven.
 *
 * Spec 040 (ISC-224) adds the family `item`: the five states every item takes (`ItemState`), one pair each. Where a
 * card or claim word means one of them, its entry *is* the item entry (`ITEM_ALIASES`) and the catalogues give it the
 * item word: the card's `waiting`, `running` (once "in flight") and `closed`, the claim's `open`, `taken` and `blocked`.
 * So `ring-slash` leaves the claim's `blocked` (now `waiting`) for `aborted`, and `lock` is retired with
 * `taken`. No (shape, tone) pair stands for two states; an alias is the same state, not a second one.
 *
 * `closed` is a word of the card and claim families, `open`, `waiting`, `running` and `done` also of the item
 * family; `family` tells them apart. `glyphFamily()` infers the card for a card word, the claim for `open` and the
 * other claim words, and the item only for `aborted`.
 */
export type GlyphFamily = 'card' | 'claim' | 'item';
/** The run states with a glyph of their own (spec 027, design.md decision 3). */
export type RunGlyphState = 'patched' | 'applied' | 'applied-open';
export type CardGlyphState = CardState | RunGlyphState;
export type GlyphState = CardGlyphState | ClaimGlyphState | ItemState;
export type GlyphShape =
  | 'dotted-ring'
  | 'ring-dot'
  | 'half'
  | 'diamond'
  | 'triangle'
  | 'disc-cross'
  | 'ring-check'
  | 'disc-check'
  | 'dashed-square'
  | 'square'
  | 'square-check'
  | 'ring'
  | 'ring-plus'
  | 'ring-slash'
  | 'disc'
  | 'ring-minus';

export interface GlyphSpec {
  readonly shape: GlyphShape;
  readonly tone: Tone;
  /** The glyph's own ink where it differs from the state chip's (the taken glyph is orange). */
  readonly ink?: Tone;
}

/**
 * The five item states (spec 040, ISC-224). `aborted` stands apart in warning, the family's one orange state: its
 * chip sits on `--hover-t` in `--hover-ink`, so an unreleased run never reads as running or done.
 */
export const ITEM_GLYPHS: Readonly<Record<ItemState, GlyphSpec>> = {
  open: { shape: 'ring', tone: 'secondary' },
  waiting: { shape: 'dotted-ring', tone: 'neutral' },
  running: { shape: 'half', tone: 'primary' },
  aborted: { shape: 'ring-slash', tone: 'warning' },
  done: { shape: 'disc-check', tone: 'accent' },
};

/** The card and claim words that mean an item state: they draw its glyph, and the catalogues give them its word. */
export const ITEM_ALIASES = {
  card: { waiting: 'waiting', running: 'running', closed: 'done' },
  claim: { open: 'open', taken: 'running', blocked: 'waiting' },
} as const satisfies {
  readonly card: Partial<Record<CardGlyphState, ItemState>>;
  readonly claim: Partial<Record<ClaimGlyphState, ItemState>>;
};

// `Record` keeps the tables exhaustive: a new state in core fails the type check here first. No (shape, tone) pair
// stands for two states across the families, an alias counting as its item state (`glyph.spec.ts`).
export const CARD_GLYPHS: Readonly<Record<CardGlyphState, GlyphSpec>> = {
  waiting: ITEM_GLYPHS[ITEM_ALIASES.card.waiting],
  dispatched: { shape: 'ring-dot', tone: 'primary' },
  running: ITEM_GLYPHS[ITEM_ALIASES.card.running],
  question: { shape: 'diamond', tone: 'secondary' },
  concerns: { shape: 'triangle', tone: 'concern' },
  fail: { shape: 'disc-cross', tone: 'error' },
  done: { shape: 'ring-check', tone: 'success' },
  closed: ITEM_GLYPHS[ITEM_ALIASES.card.closed],
  absent: { shape: 'dashed-square', tone: 'neutral' },
  operatorOpen: { shape: 'square', tone: 'warning' },
  operatorDone: { shape: 'square-check', tone: 'success' },
  // Fill order ring → half → full tells the progress; `applied` keeps `done`'s check in primary, and `applied-open`
  // is warning because the code is in the branch while tasks.md still lacks the tick.
  patched: { shape: 'disc', tone: 'primary' },
  applied: { shape: 'ring-check', tone: 'primary' },
  'applied-open': { shape: 'ring-check', tone: 'warning' },
};

/** The run state's word in the card family: `building` draws as `running`, every other run state as itself. */
const RUN_GLYPH_STATES: Readonly<Record<RunState, CardGlyphState>> = {
  dispatched: 'dispatched',
  building: 'running',
  patched: 'patched',
  applied: 'applied',
  'applied-open': 'applied-open',
};

export const runGlyphState = (run: RunState): CardGlyphState => RUN_GLYPH_STATES[run];

const RUN_ONLY: ReadonlySet<CardGlyphState> = new Set<RunGlyphState>(['patched', 'applied', 'applied-open']);

export const CLAIM_GLYPHS: Readonly<Record<ClaimGlyphState, GlyphSpec>> = {
  open: ITEM_GLYPHS[ITEM_ALIASES.claim.open],
  takeable: { shape: 'ring-plus', tone: 'accent' },
  taken: ITEM_GLYPHS[ITEM_ALIASES.claim.taken],
  blocked: ITEM_GLYPHS[ITEM_ALIASES.claim.blocked],
  closed: { shape: 'disc', tone: 'accent' },
  dropped: { shape: 'ring-minus', tone: 'neutral' },
};

/** The eleven states a card of the round board takes; the run-only glyphs are not among them. */
export const CARD_STATES: readonly CardState[] = (Object.keys(CARD_GLYPHS) as CardGlyphState[]).filter(
  (state): state is CardState => !RUN_ONLY.has(state),
);
export const CLAIM_STATES = Object.keys(CLAIM_GLYPHS) as readonly ClaimGlyphState[];
export const ITEM_STATES = Object.keys(ITEM_GLYPHS) as readonly ItemState[];

const CLAIM_ONLY: ReadonlySet<string> = new Set(CLAIM_STATES.filter((state) => !(state in CARD_GLYPHS)));
const ITEM_ONLY: ReadonlySet<string> = new Set(ITEM_STATES.filter((state) => !(state in CARD_GLYPHS) && !(state in CLAIM_GLYPHS)));

/** The family a state belongs to; a word of two families defaults to the card, then the claim (see above). */
export const glyphFamily = (state: GlyphState, family?: GlyphFamily): GlyphFamily =>
  family ?? (ITEM_ONLY.has(state) ? 'item' : CLAIM_ONLY.has(state) ? 'claim' : 'card');

const TABLES: Readonly<Record<GlyphFamily, Readonly<Partial<Record<string, GlyphSpec>>>>> = {
  card: CARD_GLYPHS,
  claim: CLAIM_GLYPHS,
  item: ITEM_GLYPHS,
};

/** The item state a word of `family` means, or `null` for a word of its own (`dispatched`, `takeable`). */
export function itemStateOf(state: GlyphState, family?: GlyphFamily): ItemState | null {
  const resolved = glyphFamily(state, family);
  if (resolved === 'item') return state as ItemState;
  const aliases: Readonly<Partial<Record<string, ItemState>>> = ITEM_ALIASES[resolved];
  return aliases[state] ?? null;
}

export function glyphSpec(state: GlyphState, family?: GlyphFamily): GlyphSpec {
  const resolved = glyphFamily(state, family);
  const table = TABLES[resolved];
  const spec = table[state];
  if (!spec) throw new Error(`no ${resolved} glyph for "${state}"`);
  return spec;
}

/** The Transloco key of a state word: `states.card.running`, `states.claim.takeable`, `states.item.aborted`. */
export const stateKey = (state: GlyphState, family?: GlyphFamily): string =>
  `states.${glyphFamily(state, family)}.${state}`;

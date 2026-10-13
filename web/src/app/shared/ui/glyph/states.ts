import type { CardState, ClaimGlyphState, RunState } from '../../../../../../core/src/files';
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
 * `closed` is a word of both families (a task whose claim is checked, and a checked claim); `family` tells them
 * apart. Every other word belongs to exactly one family, so `glyphFamily()` infers it.
 */
export type GlyphFamily = 'card' | 'claim';
/** The run states with a glyph of their own (spec 027, design.md decision 3). */
export type RunGlyphState = 'patched' | 'applied' | 'applied-open';
export type CardGlyphState = CardState | RunGlyphState;
export type GlyphState = CardGlyphState | ClaimGlyphState;
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
  | 'lock'
  | 'ring-slash'
  | 'disc'
  | 'ring-minus';

export interface GlyphSpec {
  readonly shape: GlyphShape;
  readonly tone: Tone;
  /** The glyph's own ink where the prototype draws it apart from the state chip (`.glyph.taken` is orange). */
  readonly ink?: Tone;
}

// `Record` keeps both tables exhaustive: a new state in core fails the type check here first. No (shape, tone) pair
// repeats within a family or across both (`glyph.spec.ts`).
export const CARD_GLYPHS: Readonly<Record<CardGlyphState, GlyphSpec>> = {
  waiting: { shape: 'dotted-ring', tone: 'neutral' },
  dispatched: { shape: 'ring-dot', tone: 'primary' },
  running: { shape: 'half', tone: 'primary' },
  question: { shape: 'diamond', tone: 'secondary' },
  concerns: { shape: 'triangle', tone: 'concern' },
  fail: { shape: 'disc-cross', tone: 'error' },
  done: { shape: 'ring-check', tone: 'success' },
  closed: { shape: 'disc-check', tone: 'accent' },
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
  open: { shape: 'ring', tone: 'neutral' },
  takeable: { shape: 'ring-plus', tone: 'accent' },
  taken: { shape: 'lock', tone: 'primary', ink: 'warning' },
  // Neutral like the prototype's `.st-blocked` chip (--raised / --muted; spec 024 ISC-148).
  blocked: { shape: 'ring-slash', tone: 'neutral' },
  closed: { shape: 'disc', tone: 'accent' },
  dropped: { shape: 'ring-minus', tone: 'neutral' },
};

/** The eleven states a card of the round board takes; the run-only glyphs are not among them. */
export const CARD_STATES: readonly CardState[] = (Object.keys(CARD_GLYPHS) as CardGlyphState[]).filter(
  (state): state is CardState => !RUN_ONLY.has(state),
);
export const CLAIM_STATES = Object.keys(CLAIM_GLYPHS) as readonly ClaimGlyphState[];

const CLAIM_ONLY: ReadonlySet<string> = new Set(CLAIM_STATES.filter((state) => !(state in CARD_GLYPHS)));

/** The family a state belongs to; only `closed` is ambiguous, and it defaults to the card. */
export const glyphFamily = (state: GlyphState, family?: GlyphFamily): GlyphFamily =>
  family ?? (CLAIM_ONLY.has(state) ? 'claim' : 'card');

export function glyphSpec(state: GlyphState, family?: GlyphFamily): GlyphSpec {
  const resolved = glyphFamily(state, family);
  const table: Readonly<Partial<Record<string, GlyphSpec>>> = resolved === 'claim' ? CLAIM_GLYPHS : CARD_GLYPHS;
  const spec = table[state];
  if (!spec) throw new Error(`no ${resolved} glyph for "${state}"`);
  return spec;
}

/** The Transloco key of a state word: `states.card.running`, `states.claim.takeable`. */
export const stateKey = (state: GlyphState, family?: GlyphFamily): string =>
  `states.${glyphFamily(state, family)}.${state}`;

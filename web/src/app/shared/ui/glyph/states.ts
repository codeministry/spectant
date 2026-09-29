import type { CardState, ClaimGlyphState } from '../../../../../../core/src/files';
import type { Tone } from '../tone';

/**
 * The state vocabulary of spec 002 (ISC-88): the eleven card states of the round board and the six claim states of
 * the Claims tab. Each has its own glyph shape and tone, and no two of the seventeen share the (shape, tone) pair, so
 * a state never rests on colour alone (design.md § States). Pure TypeScript: `web/tests/states-complete.test.ts`
 * imports it under `bun test` to check both catalogues.
 *
 * `closed` is a word of both families (a task whose claim is checked, and a checked claim); `family` tells them
 * apart. Every other word belongs to exactly one family, so `glyphFamily()` infers it.
 */
export type GlyphFamily = 'card' | 'claim';
export type GlyphState = CardState | ClaimGlyphState;
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
}

// `Record` keeps both tables exhaustive: a new state in core fails the type check here first.
export const CARD_GLYPHS: Readonly<Record<CardState, GlyphSpec>> = {
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
};

export const CLAIM_GLYPHS: Readonly<Record<ClaimGlyphState, GlyphSpec>> = {
  open: { shape: 'ring', tone: 'neutral' },
  takeable: { shape: 'ring-plus', tone: 'accent' },
  taken: { shape: 'lock', tone: 'primary' },
  blocked: { shape: 'ring-slash', tone: 'warning' },
  closed: { shape: 'disc', tone: 'accent' },
  dropped: { shape: 'ring-minus', tone: 'neutral' },
};

export const CARD_STATES = Object.keys(CARD_GLYPHS) as readonly CardState[];
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

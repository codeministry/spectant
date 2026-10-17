import { TestBed } from '@angular/core/testing';
import type { RunState } from '../../../../../../core/src/files';
import { UiGlyph } from './glyph';
import {
  CARD_GLYPHS,
  CARD_STATES,
  CLAIM_GLYPHS,
  CLAIM_STATES,
  ITEM_GLYPHS,
  ITEM_STATES,
  type CardGlyphState,
  type GlyphFamily,
  type GlyphSpec,
  type GlyphState,
  itemStateOf,
  runGlyphState,
} from './states';

// The run states of spec 027 (design.md, decision 3): a `Record` over core's `RunState`, so a new run state fails the
// type check here before it can reach a chip without a glyph.
const RUN_GLYPHS: Readonly<Record<RunState, readonly [CardGlyphState, GlyphSpec]>> = {
  dispatched: ['dispatched', { shape: 'ring-dot', tone: 'primary' }],
  building: ['running', { shape: 'half', tone: 'primary' }],
  patched: ['patched', { shape: 'disc', tone: 'primary' }],
  applied: ['applied', { shape: 'ring-check', tone: 'primary' }],
  'applied-open': ['applied-open', { shape: 'ring-check', tone: 'warning' }],
};

const pairsOf = (specs: readonly GlyphSpec[]) => specs.map((g) => `${g.shape}/${g.tone}`);

const ALL: ReadonlyArray<readonly [GlyphState, GlyphFamily]> = [
  ...CARD_STATES.map((state) => [state, 'card'] as const),
  ...CLAIM_STATES.map((state) => [state, 'claim'] as const),
  ...ITEM_STATES.map((state) => [state, 'item'] as const),
];

/** The state a word stands for: a card or claim word that means an item state is that state (spec 040). */
const identity = (state: GlyphState, family: GlyphFamily) => {
  const item = itemStateOf(state, family);
  return item === null ? `${family}:${state}` : `item:${item}`;
};

async function render(state: GlyphState, family?: GlyphFamily, size?: 14 | 20) {
  const fixture = TestBed.createComponent(UiGlyph);
  fixture.componentRef.setInput('state', state);
  if (family) fixture.componentRef.setInput('family', family);
  if (size) fixture.componentRef.setInput('size', size);
  await fixture.whenStable();
  const host = fixture.nativeElement as HTMLElement;
  const svg = host.querySelector('svg');
  if (!svg) throw new Error('svg missing');
  return { host, svg };
}

describe('UiGlyph', () => {
  it('renders an exempt, hidden SVG with data-state for every state of the card, claim and item families', async () => {
    const seen = new Set<string>();
    const states = new Set<string>();
    const shapes = new Set<string>();
    const drawings = new Set<string>();
    for (const [state, family] of ALL) {
      const { host, svg } = await render(state, family);
      expect(svg.getAttribute('data-state')).toBe(state);
      expect(svg.hasAttribute('data-icon-exempt')).toBe(true);
      expect(host.getAttribute('aria-hidden')).toBe('true');
      expect(svg.children.length).toBeGreaterThan(0);
      seen.add(`${host.getAttribute('data-shape') ?? ''}/${host.getAttribute('data-tone') ?? ''}`);
      states.add(identity(state, family));
      shapes.add(host.getAttribute('data-shape') ?? '');
      drawings.add(svg.innerHTML.replace(/<!--.*?-->/g, ''));
    }
    // One (shape, tone) pair per state, an alias being its item state; and every shape draws differently.
    expect(states.size).toBe(16); // the round board's eleven without the run-only glyphs, the claim's three own, aborted
    expect(seen.size).toBe(states.size);
    expect(drawings.size).toBe(shapes.size);
  });

  it('tells the card closed from the claim closed, and infers the family of claim-only words', async () => {
    const card = await render('closed');
    const claim = await render('closed', 'claim');
    const takeable = await render('takeable');

    expect(card.host.getAttribute('data-family')).toBe('card');
    expect(claim.host.getAttribute('data-family')).toBe('claim');
    expect(card.host.getAttribute('data-shape')).not.toBe(claim.host.getAttribute('data-shape'));
    expect(takeable.host.getAttribute('data-family')).toBe('claim');
  });

  it('takes its colour from the tone ink and sizes to 14 px in the prototype glyph, 20 px on cards, 14 px in cells', async () => {
    const glyph = await render('fail');
    const card = await render('fail', undefined, 20);
    const cell = await render('fail', undefined, 14);

    expect(card.host.style.getPropertyValue('--glyph-color')).toBe('var(--fail-ink)');
    expect(glyph.svg.getAttribute('width')).toBe('14');
    expect(glyph.host.hasAttribute('data-size')).toBe(false);
    expect(card.svg.getAttribute('width')).toBe('20');
    expect(cell.svg.getAttribute('width')).toBe('14');
  });

  it('draws absent as a dashed cell', async () => {
    const { svg } = await render('absent');
    expect(svg.querySelector('[stroke-dasharray]')).not.toBeNull();
  });

  it('renders patched, applied and applied-open in the card family with the shape and tone of the run table', async () => {
    for (const state of ['patched', 'applied', 'applied-open'] as const) {
      const { host, svg } = await render(state);
      const want = Object.values(RUN_GLYPHS).find(([word]) => word === state)?.[1];
      expect(svg.getAttribute('data-state')).toBe(state);
      expect(host.getAttribute('data-family')).toBe('card');
      expect(host.getAttribute('data-shape')).toBe(want?.shape);
      expect(host.getAttribute('data-tone')).toBe(want?.tone);
      expect(svg.children.length).toBeGreaterThan(0);
    }
  });

  it('repeats no (shape, tone) pair within a family, nor for two states across the whole vocabulary', () => {
    const card = pairsOf(Object.values(CARD_GLYPHS));
    const claim = pairsOf(Object.values(CLAIM_GLYPHS));
    const item = pairsOf(Object.values(ITEM_GLYPHS));
    const owner = new Map<string, string>();
    const clash: string[] = [];
    for (const [table, family] of [[CARD_GLYPHS, 'card'], [CLAIM_GLYPHS, 'claim'], [ITEM_GLYPHS, 'item']] as const) {
      for (const [state, g] of Object.entries(table)) {
        const pair = `${g.shape}/${g.tone}`;
        const who = identity(state as GlyphState, family);
        if ((owner.get(pair) ?? who) !== who) clash.push(`${pair}: ${owner.get(pair) ?? ''} and ${who}`);
        owner.set(pair, who);
      }
    }

    expect(card).toHaveLength(14);
    expect(new Set(card).size).toBe(card.length);
    expect(new Set(item).size).toBe(5);
    // The claim's taken and blocked read running and waiting, which the card's running and waiting read too.
    expect(new Set(claim).size).toBe(claim.length);
    expect(clash).toEqual([]);
  });

  it('draws the five item states as their spec 040 pairs, aborted alone in warning on the retired ring-slash', async () => {
    const want = {
      open: ['ring', 'secondary'],
      waiting: ['dotted-ring', 'neutral'],
      running: ['half', 'primary'],
      aborted: ['ring-slash', 'warning'],
      done: ['disc-check', 'accent'],
    } as const;
    for (const state of ITEM_STATES) {
      const { host } = await render(state, 'item');
      expect([host.getAttribute('data-shape'), host.getAttribute('data-tone')]).toEqual(want[state]);
      expect(host.getAttribute('data-family')).toBe('item');
    }
    const aborted = await render('aborted');
    expect(aborted.host.getAttribute('data-family')).toBe('item');
    expect(aborted.host.style.getPropertyValue('--glyph-color')).toBe('var(--hover-ink)');
    expect(CLAIM_GLYPHS.blocked).toBe(ITEM_GLYPHS.waiting);
    expect(CLAIM_GLYPHS.taken).toBe(ITEM_GLYPHS.running);
    expect(CARD_GLYPHS.running).toBe(ITEM_GLYPHS.running);
    expect(CARD_GLYPHS.closed).toBe(ITEM_GLYPHS.done);
  });

  it('maps every run state onto a card glyph, building onto running and the rest onto themselves', async () => {
    for (const [run, [word, spec]] of Object.entries(RUN_GLYPHS) as Array<[RunState, (typeof RUN_GLYPHS)[RunState]]>) {
      expect(runGlyphState(run)).toBe(word);
      expect(CARD_GLYPHS[runGlyphState(run)]).toEqual(spec);
      const { host } = await render(runGlyphState(run));
      expect(host.getAttribute('data-family')).toBe('card');
    }
  });

  it('keeps the eleven round-board states apart from the run-only states', () => {
    expect(CARD_STATES).toHaveLength(11);
    for (const state of ['patched', 'applied', 'applied-open']) expect(CARD_STATES).not.toContain(state);
  });
});

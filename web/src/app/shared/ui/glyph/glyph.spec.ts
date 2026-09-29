import { TestBed } from '@angular/core/testing';
import { UiGlyph } from './glyph';
import { CARD_STATES, CLAIM_STATES, type GlyphFamily, type GlyphState } from './states';

const ALL: ReadonlyArray<readonly [GlyphState, GlyphFamily]> = [
  ...CARD_STATES.map((state) => [state, 'card'] as const),
  ...CLAIM_STATES.map((state) => [state, 'claim'] as const),
];

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
  it('renders an exempt, hidden SVG with data-state for every one of the seventeen states', async () => {
    const seen = new Set<string>();
    const drawings = new Set<string>();
    for (const [state, family] of ALL) {
      const { host, svg } = await render(state, family);
      expect(svg.getAttribute('data-state')).toBe(state);
      expect(svg.hasAttribute('data-icon-exempt')).toBe(true);
      expect(host.getAttribute('aria-hidden')).toBe('true');
      expect(svg.children.length).toBeGreaterThan(0);
      seen.add(`${host.getAttribute('data-shape') ?? ''}/${host.getAttribute('data-tone') ?? ''}`);
      drawings.add(svg.innerHTML.replace(/<!--.*?-->/g, ''));
    }
    // No two states share the (shape, tone) pair, and every shape draws differently.
    expect(seen.size).toBe(17);
    expect(drawings.size).toBe(17);
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

  it('takes its colour from the tone ink and sizes to 20 px on cards, 14 px in matrix cells', async () => {
    const card = await render('fail');
    const cell = await render('fail', undefined, 14);

    expect(card.host.style.getPropertyValue('--glyph-color')).toBe('var(--fail-ink)');
    expect(card.svg.getAttribute('width')).toBe('20');
    expect(cell.svg.getAttribute('width')).toBe('14');
  });

  it('draws absent as a dashed cell', async () => {
    const { svg } = await render('absent');
    expect(svg.querySelector('[stroke-dasharray]')).not.toBeNull();
  });
});

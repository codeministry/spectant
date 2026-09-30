import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { UiCard } from './card';

/**
 * The card's own stylesheet as Angular compiled it (the encapsulated `:host` rules), whitespace collapsed and the
 * compiler's custom-property namespace placeholder (`var(--%NS%edge)`) removed.
 */
function cardStyles(): string {
  const styles = (UiCard as unknown as { ɵcmp: { styles: string[] } }).ɵcmp.styles;
  return styles.join('\n').replaceAll('%NS%', '').replace(/\s+/g, ' ').replace(/\( /g, '(');
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiCard],
  template: `<ui-card edge glow style="--edge: var(--color-accent)">lime tile</ui-card>`,
})
class LimeTile {}

describe('UiCard', () => {
  it('is a plain card without edge, glow or accent', async () => {
    const fixture = TestBed.createComponent(UiCard);
    const host = fixture.nativeElement as HTMLElement;
    await fixture.whenStable();
    expect(host.hasAttribute('data-edge')).toBe(false);
    expect(host.hasAttribute('data-glow')).toBe(false);
    expect(host.style.getPropertyValue('--edge')).toBe('');
  });

  it('turns the edge and the glow variant on independently', async () => {
    const fixture = TestBed.createComponent(UiCard);
    const host = fixture.nativeElement as HTMLElement;

    fixture.componentRef.setInput('edge', true);
    await fixture.whenStable();
    expect(host.hasAttribute('data-edge')).toBe(true);
    expect(host.hasAttribute('data-glow')).toBe(false);

    fixture.componentRef.setInput('edge', false);
    fixture.componentRef.setInput('glow', true);
    await fixture.whenStable();
    expect(host.hasAttribute('data-edge')).toBe(false);
    expect(host.hasAttribute('data-glow')).toBe(true);
  });

  it('sets --edge from an accent tone, which turns both variants on unless they are given', async () => {
    const fixture = TestBed.createComponent(UiCard);
    const host = fixture.nativeElement as HTMLElement;
    fixture.componentRef.setInput('accent', 'warning');
    fixture.componentRef.setInput('padding', 24);
    await fixture.whenStable();
    expect(host.getAttribute('data-accent')).toBe('warning');
    expect(host.style.getPropertyValue('--card-tone')).toBe('var(--color-warning)');
    expect(cardStyles()).toContain('[data-accent][_nghost-%COMP%] { --edge: var(--card-tone); }');
    expect(host.hasAttribute('data-edge')).toBe(true);
    expect(host.hasAttribute('data-glow')).toBe(true);
    expect(host.style.padding).toBe('24px');

    fixture.componentRef.setInput('glow', false);
    await fixture.whenStable();
    expect(host.hasAttribute('data-edge')).toBe(true);
    expect(host.hasAttribute('data-glow')).toBe(false);
  });

  it('keeps a --edge the consumer sets per use when no accent is given', async () => {
    const fixture = TestBed.createComponent(LimeTile);
    await fixture.whenStable();
    const card = (fixture.nativeElement as HTMLElement).querySelector('ui-card') as HTMLElement;
    expect(card.style.getPropertyValue('--edge')).toBe('var(--color-accent)');
    expect(card.hasAttribute('data-edge')).toBe(true);
    expect(card.hasAttribute('data-glow')).toBe(true);
  });

  it('marks an interactive card, whose hover raises the glow', async () => {
    const fixture = TestBed.createComponent(UiCard);
    const host = fixture.nativeElement as HTMLElement;
    fixture.componentRef.setInput('interactive', true);
    await fixture.whenStable();
    expect(host.hasAttribute('data-interactive')).toBe(true);
  });

  it('paints the edge as the prototype: a 3 px ::before bar in --edge, cyan by default, no shadow', () => {
    const css = cardStyles();
    expect(css).toMatch(/\[data-edge\][^{]*::before\s*\{[^}]*inset: 0 0 auto;[^}]*block-size: 3px;[^}]*background: var\(--edge, var\(--color-primary\)\);/);
    expect(css).not.toContain('box-shadow');
  });

  it('paints the glow as the prototype: a 140 px ::after in the corner, --edge at 14 %, opacity .7, 1 on hover', () => {
    const css = cardStyles();
    const glow = /\[data-glow\][^{]*::after\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(glow).toContain('inset: -40px -40px auto auto;');
    expect(glow).toContain('inline-size: 140px;');
    expect(glow).toContain('block-size: 140px;');
    expect(glow).toContain(
      'background: radial-gradient(closest-side, color-mix(in srgb, var(--edge, var(--color-primary)) 14%, transparent), transparent);',
    );
    expect(glow).toContain('opacity: 0.7;');
    expect(glow).toContain('transition: opacity var(--motion-duration-instant) var(--motion-ease-standard);');
    expect(css).toMatch(/@media \(hover: hover\) \{[^@]*\[data-interactive\][^{]*:hover::after\s*\{\s*opacity: 1;/);
    // One glow implementation: no second radial-gradient anywhere else in the card.
    expect(css.match(/radial-gradient\(/g)?.length).toBe(1);
  });
});

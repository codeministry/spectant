import { TestBed } from '@angular/core/testing';
import { UiCard } from './card';

describe('UiCard', () => {
  it('paints the accent edge and glow only when an accent is set', async () => {
    const fixture = TestBed.createComponent(UiCard);
    const host = fixture.nativeElement as HTMLElement;
    await fixture.whenStable();
    expect(host.hasAttribute('data-accent')).toBe(false);

    fixture.componentRef.setInput('accent', 'primary');
    fixture.componentRef.setInput('padding', 24);
    await fixture.whenStable();
    expect(host.getAttribute('data-accent')).toBe('primary');
    expect(host.style.getPropertyValue('--card-tone')).toBe('var(--color-primary)');
    expect(host.style.padding).toBe('24px');
  });
});

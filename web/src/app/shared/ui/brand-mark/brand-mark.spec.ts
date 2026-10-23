import { TestBed } from '@angular/core/testing';
import { UiBrandMark } from './brand-mark';

describe('UiBrandMark', () => {
  async function render(size?: 27 | 28) {
    const fixture = TestBed.createComponent(UiBrandMark);
    if (size !== undefined) fixture.componentRef.setInput('size', size);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  it('defaults to the 27 px header size and takes 28 for the widget', async () => {
    expect((await render()).style.getPropertyValue('--brand-mark-size')).toBe('27px');
    expect((await render(28)).style.getPropertyValue('--brand-mark-size')).toBe('28px');
  });

  it('is always decorative: hidden, not focusable, no role, no tab stop, exempt from the icon guard', async () => {
    const host = await render();
    const svg = host.querySelector('svg.mark');

    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.getAttribute('focusable')).toBe('false');
    expect(svg?.hasAttribute('data-icon-exempt')).toBe(true);
    expect(host.getAttribute('aria-hidden')).toBe('true');
    expect(host.hasAttribute('role')).toBe(false);
    expect(host.hasAttribute('tabindex')).toBe(false);
    expect(host.hasAttribute('aria-label')).toBe(false);
  });

  it('keeps the ring parts: track, two arcs and the dot', async () => {
    const host = await render();

    expect(host.querySelectorAll('.mark-track, .mark-arc-a, .mark-arc-b, .mark-dot')).toHaveLength(4);
  });
});

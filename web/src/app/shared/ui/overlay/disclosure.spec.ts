import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { UiDisclosure } from './disclosure';

// The `grid-template-rows` animation itself is measured on real browsers (T31, `bun run test:browser -- motion`);
// jsdom has no cascade. Here: the button contract, the inert region and that the motion runs on tokens only.

@Component({
  imports: [UiDisclosure],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ui-disclosure [(open)]="open">
      <span uiDisclosureSummary id="summary">TL;DR</span>
      <button uiDisclosureActions id="action" type="button">Copy</button>
      <p id="body">Prose</p>
      <a id="link" href="#x">Link</a>
    </ui-disclosure>
  `,
})
class Host {
  readonly open = signal(false);
}

async function render() {
  const fixture = TestBed.createComponent(Host);
  await fixture.whenStable();
  const root = fixture.nativeElement as HTMLElement;
  const el = (selector: string): HTMLElement =>
    root.querySelector<HTMLElement>(selector) ?? (() => { throw new Error(`${selector} missing`); })();
  return { fixture, el, toggle: () => el('button[aria-expanded]') };
}

describe('UiDisclosure', () => {
  it('starts collapsed: aria-expanded false, the controlled region inert', async () => {
    const { el, toggle } = await render();
    const region = el(`#${toggle().getAttribute('aria-controls') ?? ''}`);

    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(toggle().contains(el('#summary'))).toBe(true);
    expect(region.contains(el('#body'))).toBe(true);
    expect(region.hasAttribute('inert')).toBe(true);
  });

  it('toggles through the button and reports through the open model', async () => {
    const { fixture, el, toggle } = await render();
    const region = el(`#${toggle().getAttribute('aria-controls') ?? ''}`);

    toggle().click();
    await fixture.whenStable();
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(region.hasAttribute('inert')).toBe(false);
    expect(fixture.componentInstance.open()).toBe(true);
    expect(el('ui-disclosure').hasAttribute('data-open')).toBe(true);

    toggle().click();
    await fixture.whenStable();
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(region.hasAttribute('inert')).toBe(true);
    expect(fixture.componentInstance.open()).toBe(false);
  });

  it('follows the open model set by the consumer (router-driven state)', async () => {
    const { fixture, toggle } = await render();

    fixture.componentInstance.open.set(true);
    await fixture.whenStable();

    expect(toggle().getAttribute('aria-expanded')).toBe('true');
  });

  it('keeps actions outside the toggle button, so no interactive element nests in it', async () => {
    const { el, toggle } = await render();

    expect(toggle().contains(el('#action'))).toBe(false);
    expect(el('#action').closest('ui-disclosure')).not.toBeNull();
  });

  it('reduced motion: the rows animation and the chevron turn run on motion tokens only, so motion.css zeroes them', async () => {
    await render();
    const css = [...document.head.querySelectorAll('style')]
      .map((s) => s.textContent)
      .find((text) => text.includes('grid-template-rows'));
    if (css === undefined) throw new Error('disclosure stylesheet not attached');

    const transitions = [...css.matchAll(/transition[-a-z]*\s*:\s*([^;}]+)/g)].map((m) => m[1]);
    expect(transitions.length).toBeGreaterThan(0);
    for (const value of transitions) {
      expect(value).not.toMatch(/(?<![\w-])\d*\.?\d+m?s\b/);
    }
    expect(css).toContain('var(--motion-duration-base)');
    expect(css).toMatch(/grid-template-rows\s*:\s*0fr/);
    expect(css).toMatch(/grid-template-rows\s*:\s*1fr/);
  });
});

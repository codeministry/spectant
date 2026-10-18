import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { UiDisclosure, UiDisclosureDescription } from './disclosure';

// The `grid-template-rows` animation itself is measured on real browsers (T31, `bun run test:browser -- motion`);
// jsdom has no cascade. Here: the button contract, the inert region and that the motion runs on tokens only.

@Component({
  imports: [UiDisclosure],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ui-disclosure [(open)]="open" [count]="count()">
      <span uiDisclosureSummary id="summary">TL;DR</span>
      <button uiDisclosureActions id="action" type="button">Copy</button>
      <p id="body">Prose</p>
      <a id="link" href="#x">Link</a>
    </ui-disclosure>
  `,
})
class Host {
  readonly open = signal(false);
  readonly count = signal<number | null>(null);
}

@Component({
  imports: [UiDisclosure, UiDisclosureDescription],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ui-disclosure [headingLevel]="level()">
      <span uiDisclosureSummary id="summary">Goal</span>
      <button uiDisclosureActions id="action" type="button">Copy</button>
      <p uiDisclosureDescription id="description">The first sentence.</p>
      <p id="body">Prose</p>
    </ui-disclosure>
  `,
})
class HeadedHost {
  readonly level = signal<2 | 3 | 4 | 5 | 6 | null>(2);
}

/** Tag, classes and attribute names (values and Angular's scoping attributes left out); comment nodes drop out. */
function shape(node: Element): string {
  const classes = [...node.classList].map((c) => `.${c}`).join('');
  const attrs = node
    .getAttributeNames()
    .filter((name) => !name.startsWith('_ng') && name !== 'class')
    .sort();
  const head = `${node.tagName.toLowerCase()}${classes}${attrs.length > 0 ? `[${attrs.join(',')}]` : ''}`;
  if (node.tagName === 'UI-ICON') return head;
  const children = [...node.children].map(shape);
  return children.length > 0 ? `${head}(${children.join(' ')})` : head;
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

  it('shows an optional count inside the summary row, and none by default (spec 002: Probe, Contents, claim groups)', async () => {
    const { fixture, el, toggle } = await render();
    expect(toggle().querySelector('.count')).toBeNull();

    fixture.componentInstance.count.set(7);
    await fixture.whenStable();
    expect(toggle().querySelector('.count')?.textContent.trim()).toBe('7');
    expect(el('ui-disclosure').querySelector('button[aria-expanded="false"] .count')).not.toBeNull();
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

  it('without headingLevel and description renders the structure it always had (existing users unchanged)', async () => {
    const { el } = await render();

    expect(shape(el('ui-disclosure'))).toBe(
      'ui-disclosure(' +
        'div.head(button.summary[aria-controls,aria-expanded,type](ui-icon.chevron[data-icon,name] span[id,uidisclosuresummary]) ' +
        'button[id,type,uidisclosureactions]) ' +
        'div.region[id,inert](div.content(p[id] a[href,id])))',
    );
  });

  it('headingLevel wraps the toggle button in a heading of that level, actions stay outside it', async () => {
    const fixture = TestBed.createComponent(HeadedHost);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    const toggle = () => root.querySelector('button[aria-expanded]');

    expect(toggle()?.parentElement?.tagName).toBe('H2');
    expect(toggle()?.parentElement?.parentElement?.classList.contains('head')).toBe(true);
    expect(root.querySelector('h2')?.contains(root.querySelector('#action'))).toBe(false);

    for (const level of [3, 4, 5, 6] as const) {
      fixture.componentInstance.level.set(level);
      await fixture.whenStable();
      expect(toggle()?.parentElement?.tagName).toBe(`H${String(level)}`);
    }

    fixture.componentInstance.level.set(null);
    await fixture.whenStable();
    expect(toggle()?.parentElement?.classList.contains('head')).toBe(true);
    expect(root.querySelector('h2, h3, h4, h5, h6')).toBeNull();
  });

  it('the description sits under the head, outside the button: it describes the toggle, it does not name it', async () => {
    const fixture = TestBed.createComponent(HeadedHost);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    const toggle = root.querySelector('button[aria-expanded]');
    const description = root.querySelector('#description');
    const head = root.querySelector('.head');
    const region = root.querySelector('.region');

    expect(description).not.toBeNull();
    expect(toggle?.contains(description)).toBe(false);
    expect(toggle?.textContent.trim()).toBe('Goal');
    expect(head?.contains(description)).toBe(false);
    expect(region?.contains(description)).toBe(false);
    expect(head?.nextElementSibling).toBe(description);
    expect(description?.nextElementSibling).toBe(region);
    expect(toggle?.getAttribute('aria-describedby')).toBe(description?.id);
    expect(toggle?.hasAttribute('aria-label')).toBe(false);
    expect(toggle?.hasAttribute('aria-labelledby')).toBe(false);
  });

  it('reduced motion: no height transition and no chevron turn, switched off in the primitive itself', async () => {
    await render();
    const css = [...document.head.querySelectorAll('style')]
      .map((s) => s.textContent)
      .find((text) => text.includes('grid-template-rows'));
    if (css === undefined) throw new Error('disclosure stylesheet not attached');

    const block = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?\})\s*\}/.exec(css)?.[1] ?? '';
    expect(block).toMatch(/\.region/);
    expect(block).toMatch(/\.chevron/);
    expect(block).toMatch(/transition\s*:\s*none/);
  });
});

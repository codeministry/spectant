import { TestBed } from '@angular/core/testing';
import { UiFilterChips } from './filter-chips';

describe('UiFilterChips', () => {
  it('presses the selected chip and moves the value on click', async () => {
    const fixture = TestBed.createComponent(UiFilterChips);
    fixture.componentRef.setInput('options', [
      { key: 'all', label: 'All', count: 6 },
      { key: 'building', label: 'building', count: 2, tone: 'warning' },
    ]);
    fixture.componentRef.setInput('value', 'all');
    await fixture.whenStable();
    const buttons = (fixture.nativeElement as HTMLElement).querySelectorAll('button');
    expect(buttons[0].getAttribute('aria-pressed')).toBe('true');

    buttons[1].click();
    await fixture.whenStable();
    expect(fixture.componentInstance.value()).toBe('building');
    expect(buttons[1].getAttribute('aria-pressed')).toBe('true');
  });

  it('paints a success dot in the contrast-safe success mark (ISC-65)', async () => {
    const fixture = TestBed.createComponent(UiFilterChips);
    fixture.componentRef.setInput('options', [{ key: 'done', label: 'done', count: 1, tone: 'success' }]);
    await fixture.whenStable();
    const dot = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.dot');
    expect(dot?.style.background).toBe('var(--done-mark)');
  });

  it('gives a chip the accessible name its option carries, and none otherwise (spec 021, ISC-248)', async () => {
    const fixture = TestBed.createComponent(UiFilterChips);
    fixture.componentRef.setInput('options', [
      { key: 'all', label: 'All', count: 6, name: 'All 6 stages' },
      { key: 'building', label: 'building', count: 2 },
    ]);
    await fixture.whenStable();
    const buttons = (fixture.nativeElement as HTMLElement).querySelectorAll('button');
    expect(buttons[0].getAttribute('aria-label')).toBe('All 6 stages');
    expect(buttons[1].hasAttribute('aria-label')).toBe(false);
  });

  it('marks the host data-wrap only with `wrap`, the form whose row wraps instead of scrolling (spec 064, T41)', async () => {
    const fixture = TestBed.createComponent(UiFilterChips);
    fixture.componentRef.setInput('options', [{ key: 'all', label: 'All', count: 6 }]);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.hasAttribute('data-wrap')).toBe(false);
    fixture.componentRef.setInput('wrap', true);
    await fixture.whenStable();
    expect(host.hasAttribute('data-wrap')).toBe(true);
  });

  describe('multiple (spec 072, ISC-603)', () => {
    const options = [
      { key: 'alpha', label: 'alpha', count: 3 },
      { key: 'beta', label: 'a-very-long-workspace-path-ending', count: 1 },
      { key: 'gamma', label: 'gamma', count: 0, tone: 'warning' as const },
    ];

    async function setup(selected: readonly string[] = []) {
      const fixture = TestBed.createComponent(UiFilterChips);
      fixture.componentRef.setInput('options', options);
      fixture.componentRef.setInput('multiple', true);
      fixture.componentRef.setInput('selected', selected);
      await fixture.whenStable();
      const host = fixture.nativeElement as HTMLElement;
      return { fixture, host, buttons: host.querySelectorAll('button') };
    }

    function pressed(buttons: NodeListOf<HTMLButtonElement>): Array<string | null> {
      return [...buttons].map((button) => button.getAttribute('aria-pressed'));
    }

    it('marks the host data-multiple only with `multiple`', async () => {
      const single = TestBed.createComponent(UiFilterChips);
      single.componentRef.setInput('options', options);
      await single.whenStable();
      expect((single.nativeElement as HTMLElement).hasAttribute('data-multiple')).toBe(false);
      const { host } = await setup();
      expect(host.hasAttribute('data-multiple')).toBe(true);
    });

    it('gives each chip its own aria-pressed, all false on an empty selection', async () => {
      const { buttons } = await setup();
      expect(pressed(buttons)).toEqual(['false', 'false', 'false']);
    });

    it('toggles a chip on and off in `selected` and leaves `value` alone', async () => {
      const { fixture, buttons } = await setup();
      buttons[1].click();
      await fixture.whenStable();
      expect(fixture.componentInstance.selected()).toEqual(['beta']);
      expect(pressed(buttons)).toEqual(['false', 'true', 'false']);
      expect(fixture.componentInstance.value()).toBeUndefined();

      buttons[1].click();
      await fixture.whenStable();
      expect(fixture.componentInstance.selected()).toEqual([]);
      expect(pressed(buttons)).toEqual(['false', 'false', 'false']);
    });

    it('keeps two chips pressed at once', async () => {
      const { fixture, buttons } = await setup(['alpha']);
      buttons[2].click();
      await fixture.whenStable();
      expect(fixture.componentInstance.selected()).toEqual(['alpha', 'gamma']);
      expect(pressed(buttons)).toEqual(['true', 'false', 'true']);
    });

    it('carries the full label in `title`, and no title in the single mode', async () => {
      const { buttons } = await setup();
      expect(buttons[1].getAttribute('title')).toBe('a-very-long-workspace-path-ending');
      const single = TestBed.createComponent(UiFilterChips);
      single.componentRef.setInput('options', options);
      await single.whenStable();
      expect((single.nativeElement as HTMLElement).querySelector('button')?.hasAttribute('title')).toBe(false);
    });

    it('renders no All chip and no check glyph when a chip is pressed', async () => {
      const { fixture, host, buttons } = await setup();
      buttons[0].click();
      await fixture.whenStable();
      expect(host.querySelectorAll('button')).toHaveLength(3);
      expect(host.querySelector('svg, ui-icon')).toBeNull();
      expect(buttons[0].querySelector('.text')?.textContent).toBe('alpha');
      expect(buttons[0].textContent.trim()).toBe('alpha3');
    });
  });
});

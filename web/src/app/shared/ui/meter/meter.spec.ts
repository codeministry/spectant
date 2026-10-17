import { TestBed } from '@angular/core/testing';
import { UiMeter } from './meter';

describe('UiMeter', () => {
  it('is a meter scaled to value / max', async () => {
    const fixture = TestBed.createComponent(UiMeter);
    fixture.componentRef.setInput('value', 3);
    fixture.componentRef.setInput('max', 4);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.getAttribute('role')).toBe('meter');
    expect(host.querySelector<HTMLElement>('.fill')?.style.transform).toBe('scaleX(0.75)');
  });

  it('splits into proportional segments', async () => {
    const fixture = TestBed.createComponent(UiMeter);
    fixture.componentRef.setInput('segments', [
      { key: 'building', count: 2, tone: 'warning' },
      { key: 'scoping', count: 4, tone: 'secondary' },
    ]);
    await fixture.whenStable();
    const segs = (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('.seg');
    expect([...segs].map((s) => s.style.flexGrow)).toEqual(['2', '4']);
  });

  describe('valueText and size', () => {
    async function render(inputs: Record<string, unknown>): Promise<HTMLElement> {
      const fixture = TestBed.createComponent(UiMeter);
      for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
      await fixture.whenStable();
      return fixture.nativeElement as HTMLElement;
    }

    it('sets aria-valuetext in single mode', async () => {
      const host = await render({ value: 3, max: 4, valueText: '3 of 4 claims closed' });
      expect(host.getAttribute('aria-valuetext')).toBe('3 of 4 claims closed');
    });

    it('leaves aria-valuetext off in split mode', async () => {
      const host = await render({ segments: [{ key: 'a', count: 1, tone: 'warning' }], valueText: 'ignored' });
      expect(host.hasAttribute('aria-valuetext')).toBe(false);
    });

    it('renders size lg as an 8 px bar', async () => {
      const host = await render({ value: 1, size: 'lg' });
      expect(host.getAttribute('data-size')).toBe('lg');
      expect(host.hasAttribute('data-mini')).toBe(false);
      expect(getComputedStyle(host).blockSize).toBe('8px');
    });

    it('keeps mini at 4 px through the boolean input and through size', async () => {
      const byBoolean = await render({ value: 1, mini: true });
      expect(byBoolean.hasAttribute('data-mini')).toBe(true);
      expect(getComputedStyle(byBoolean).blockSize).toBe('4px');

      const bySize = await render({ value: 1, size: 'mini' });
      expect(bySize.hasAttribute('data-mini')).toBe(true);
      expect(bySize.getAttribute('data-size')).toBe('mini');
      expect(getComputedStyle(bySize).blockSize).toBe('4px');
    });

    it('keeps the defaults: 6 px, no data-size, no aria-valuetext', async () => {
      const host = await render({ value: 1 });
      expect(getComputedStyle(host).blockSize).toBe('6px');
      expect(host.hasAttribute('data-size')).toBe(false);
      expect(host.hasAttribute('aria-valuetext')).toBe(false);
    });
  });

  // Spec 037, ISC-193.1: a surface the default look fails sets the track and the fill through two custom properties.
  describe('colour hooks', () => {
    const TRACK = 'rgb(4, 5, 6)';
    const FILL = 'rgb(1, 2, 3)';

    async function hooked(inputs: Record<string, unknown>): Promise<HTMLElement> {
      const fixture = TestBed.createComponent(UiMeter);
      const host = fixture.nativeElement as HTMLElement;
      host.style.setProperty('--ui-meter-track', TRACK);
      host.style.setProperty('--ui-meter-fill', FILL);
      for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
      await fixture.whenStable();
      return host;
    }
    const fill = (host: HTMLElement): string => getComputedStyle(host.querySelector('.fill') ?? host).backgroundColor;

    it('paints the track and a partial fill from the hooks', async () => {
      const host = await hooked({ value: 1, max: 2 });
      expect(getComputedStyle(host).backgroundColor).toBe(TRACK);
      expect(fill(host)).toBe(FILL);
    });

    // The full state (`:host([data-full]) .fill`) is a descendant rule the DOM emulation does not resolve; the browser
    // tier proves it on the milestone header (`web/e2e/browser/contrast.spec.ts`).

    it('lets a tone win over the fill hook', async () => {
      const host = await hooked({ value: 1, max: 2, tone: 'warning' });
      expect(fill(host)).not.toBe(FILL);
    });

    it('falls back to the default look where the hooks are unset', async () => {
      const fixture = TestBed.createComponent(UiMeter);
      fixture.componentRef.setInput('value', 1);
      fixture.componentRef.setInput('max', 2);
      await fixture.whenStable();
      const host = fixture.nativeElement as HTMLElement;
      expect(getComputedStyle(host).backgroundColor).not.toBe(TRACK);
      expect(fill(host)).not.toBe(FILL);
    });
  });
});

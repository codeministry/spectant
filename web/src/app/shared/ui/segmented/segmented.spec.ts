import { TestBed } from '@angular/core/testing';
import { stripWraps, UiSegmented, watchColumns } from './segmented';

describe('UiSegmented', () => {
  it('is a radio group whose arrow keys move the selection with one tab stop', async () => {
    const fixture = TestBed.createComponent(UiSegmented);
    fixture.componentRef.setInput('options', [
      { key: 'system', label: 'System' },
      { key: 'light', label: 'Light' },
      { key: 'dark', label: 'Dark' },
    ]);
    fixture.componentRef.setInput('value', 'dark');
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;
    const radios = host.querySelectorAll<HTMLButtonElement>('[role="radio"]');
    expect(host.querySelector('[role="radiogroup"]')).not.toBeNull();

    radios[2].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await fixture.whenStable();
    expect(fixture.componentInstance.value()).toBe('system');
    expect([...radios].map((r) => r.tabIndex)).toEqual([0, -1, -1]);
  });
});

describe('UiSegmented, strip mode', () => {
  const STAGES = ['idea', 'plan', 'tasks', 'review', 'build', 'blocked', 'close-pending', 'code-review', 'close', 'done'];

  async function render(inputs: Record<string, unknown> = {}) {
    const fixture = TestBed.createComponent(UiSegmented);
    fixture.componentRef.setInput('mode', 'strip');
    fixture.componentRef.setInput(
      'options',
      STAGES.map((key, i) => ({ key, label: key, count: i, ariaLabel: `${key}, ${i} cards` })),
    );
    fixture.componentRef.setInput('label', 'Stages');
    for (const [key, value] of Object.entries(inputs)) fixture.componentRef.setInput(key, value);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;
    const segments = () => [...host.querySelectorAll<HTMLButtonElement>('button.sseg')];
    return { fixture, host, segments };
  }

  it('is a toolbar of plain buttons, one per column, with label, count and accessible name, never a radio', async () => {
    const { host, segments } = await render();

    expect(host.querySelector('[role="toolbar"]')?.getAttribute('aria-label')).toBe('Stages');
    expect(host.querySelector('[role="radiogroup"], [role="radio"], [aria-checked]')).toBeNull();
    expect(segments()).toHaveLength(10);
    expect(segments()[4].querySelector('.count')?.textContent.trim()).toBe('4');
    expect(segments()[4].getAttribute('aria-label')).toBe('build, 4 cards');
  });

  it('underlines the columns in view and keeps the one tab stop on the first of them', async () => {
    const { fixture, segments } = await render({ inView: ['review', 'build', 'blocked'] });

    expect(segments().map((s) => s.hasAttribute('data-inview'))).toEqual(STAGES.map((_, i) => i >= 3 && i <= 5));
    expect(segments().map((s) => s.tabIndex)).toEqual(STAGES.map((_, i) => (i === 3 ? 0 : -1)));

    fixture.componentRef.setInput('inView', ['done']);
    await fixture.whenStable();
    expect(segments()[9].tabIndex).toBe(0);
  });

  it('emits the column and scrolls the scroller to it on click, leaving the radio value alone', async () => {
    const scroller = document.createElement('div');
    const column = document.createElement('section');
    column.dataset['col'] = 'close';
    scroller.append(column);
    scroller.scrollLeft = 40;
    scroller.getBoundingClientRect = () => ({ left: 20 }) as DOMRect;
    column.getBoundingClientRect = () => ({ left: 320 }) as DOMRect;
    const scrollTo = vi.fn();
    scroller.scrollTo = scrollTo as typeof scroller.scrollTo;

    const { fixture, segments } = await render({ scroller });
    const jumps: string[] = [];
    fixture.componentInstance.jump.subscribe((key) => jumps.push(key));

    segments()[8].click();
    expect(jumps).toEqual(['close']);
    const [options] = scrollTo.mock.calls[0] as [ScrollToOptions];
    expect(options.left).toBe(340);
    expect(['auto', 'smooth']).toContain(options.behavior);
    expect(fixture.componentInstance.value()).toBeUndefined();
  });

  it('moves the highlighted segment with the arrow keys, wrapping, and scrolls along', async () => {
    const { fixture, segments } = await render({ inView: ['idea'] });
    const jumps: string[] = [];
    fixture.componentInstance.jump.subscribe((key) => jumps.push(key));

    segments()[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await fixture.whenStable();
    expect(segments()[1].tabIndex).toBe(0);
    expect(document.activeElement).toBe(segments()[1]);

    segments()[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    segments()[9].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await fixture.whenStable();
    expect(jumps).toEqual(['plan', 'done', 'idea']);
    expect(segments()[0].tabIndex).toBe(0);
  });

  it('wraps into rows of at most five once the segments overflow one line, and unwraps when they fit again', () => {
    expect(stripWraps(10, 600, 760)).toBe(true);
    expect(stripWraps(10, 800, 760)).toBe(false);
    expect(stripWraps(5, 300, 760)).toBe(false);
  });

  it('reports the columns in view from an IntersectionObserver the host wires, in column order', () => {
    const scroller = document.createElement('div');
    const cols = ['plan', 'tasks', 'review'].map((key) => {
      const col = document.createElement('section');
      col.dataset['col'] = key;
      scroller.append(col);
      return col;
    });
    let callback: IntersectionObserverCallback = () => undefined;
    const observed: Element[] = [];
    const disconnect = vi.fn();
    class FakeObserver {
      constructor(cb: IntersectionObserverCallback, options: IntersectionObserverInit) {
        callback = cb;
        expect(options.root).toBe(scroller);
      }
      observe(el: Element) {
        observed.push(el);
      }
      disconnect = disconnect;
    }
    const seen: string[][] = [];
    const stop = watchColumns(
      scroller,
      (keys) => seen.push([...keys]),
      FakeObserver as unknown as typeof IntersectionObserver,
    );

    expect(observed).toEqual(cols);
    const entry = (target: Element, isIntersecting: boolean) => ({ target, isIntersecting }) as IntersectionObserverEntry;
    callback([entry(cols[2], true), entry(cols[1], true)], {} as IntersectionObserver);
    callback([entry(cols[1], false), entry(cols[0], true)], {} as IntersectionObserver);
    expect(seen).toEqual([
      ['tasks', 'review'],
      ['plan', 'review'],
    ]);

    stop();
    expect(disconnect).toHaveBeenCalled();
  });
});

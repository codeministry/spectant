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
});

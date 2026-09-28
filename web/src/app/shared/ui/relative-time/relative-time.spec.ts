import { TestBed } from '@angular/core/testing';
import { relativeParts, UiRelativeTime } from './relative-time';

describe('UiRelativeTime', () => {
  it('buckets elapsed time into s, min, h and d', () => {
    const now = Date.UTC(2026, 8, 28, 12);
    expect(relativeParts(now - 12_000, now)).toEqual({ value: 12, unit: 's' });
    expect(relativeParts(now - 3 * 60_000, now)).toEqual({ value: 3, unit: 'min' });
    expect(relativeParts(now - 26 * 3_600_000, now)).toEqual({ value: 1, unit: 'd' });
  });

  it('renders a hidden time element with a machine-readable datetime', async () => {
    const fixture = TestBed.createComponent(UiRelativeTime);
    fixture.componentRef.setInput('date', new Date(Date.now() - 5_000));
    await fixture.whenStable();
    const time = (fixture.nativeElement as HTMLElement).querySelector('time');

    expect(time?.getAttribute('aria-hidden')).toBe('true');
    expect(time?.getAttribute('datetime')).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(time?.textContent).toMatch(/^\d+ s ago$/);
  });
});

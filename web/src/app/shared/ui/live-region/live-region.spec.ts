import { TestBed } from '@angular/core/testing';
import { UiLiveRegion } from './live-region';

describe('UiLiveRegion', () => {
  it('announces politely and changes the text when the same message repeats', async () => {
    const fixture = TestBed.createComponent(UiLiveRegion);
    const host = fixture.nativeElement as HTMLElement;
    fixture.componentInstance.announce('2 specs changed');
    await fixture.whenStable();
    expect(host.getAttribute('aria-live')).toBe('polite');
    const first = host.textContent;

    fixture.componentInstance.announce('2 specs changed');
    await fixture.whenStable();
    expect(host.textContent.trim()).toBe('2 specs changed');
    expect(host.textContent).not.toBe(first);
  });
});

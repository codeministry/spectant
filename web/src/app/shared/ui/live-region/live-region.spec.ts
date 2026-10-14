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

  it('bundles the parts of one tick into one announcement and stays silent without any', async () => {
    const fixture = TestBed.createComponent(UiLiveRegion);
    const host = fixture.nativeElement as HTMLElement;
    fixture.componentInstance.announceAll([]);
    await fixture.whenStable();
    expect(host.textContent.trim()).toBe('');

    fixture.componentInstance.announceAll(['T3: patch ready', 'T5: building']);
    await fixture.whenStable();
    expect(host.textContent.trim()).toBe('T3: patch ready; T5: building');
  });
});

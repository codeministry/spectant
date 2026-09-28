import { TestBed } from '@angular/core/testing';
import { UiNotice } from './notice';

describe('UiNotice', () => {
  it('is a polite status by default and an alert for errors, edged in its tone', async () => {
    const fixture = TestBed.createComponent(UiNotice);
    const host = fixture.nativeElement as HTMLElement;
    await fixture.whenStable();
    expect(host.getAttribute('role')).toBe('status');
    expect(host.style.getPropertyValue('--notice-color')).toBe('var(--color-warning)');

    fixture.componentRef.setInput('tone', 'error');
    await fixture.whenStable();
    expect(host.getAttribute('role')).toBe('alert');
  });
});

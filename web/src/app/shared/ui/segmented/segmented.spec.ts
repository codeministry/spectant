import { TestBed } from '@angular/core/testing';
import { UiSegmented } from './segmented';

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

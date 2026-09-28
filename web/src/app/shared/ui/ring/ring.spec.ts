import { TestBed } from '@angular/core/testing';
import { UiRing } from './ring';

describe('UiRing', () => {
  it('shows the percentage as real text and exempts its svg from the icon guard', async () => {
    const fixture = TestBed.createComponent(UiRing);
    fixture.componentRef.setInput('value', 99.4);
    fixture.componentRef.setInput('size', 112);
    fixture.componentRef.setInput('stroke', 10);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector('.text')?.textContent.replace(/\s+/g, '')).toBe('99%');
    expect(host.querySelector('svg')?.hasAttribute('data-icon-exempt')).toBe(true);
  });

  it('shows a dash when there is no value', async () => {
    const fixture = TestBed.createComponent(UiRing);
    fixture.componentRef.setInput('value', null);
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).querySelector('.text')?.textContent.trim()).toBe('—');
  });
});

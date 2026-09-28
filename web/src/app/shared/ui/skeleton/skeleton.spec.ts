import { TestBed } from '@angular/core/testing';
import { UiSkeleton } from './skeleton';

describe('UiSkeleton', () => {
  it('is hidden from assistive technology, sized, and carries the reduced-motion hook class', async () => {
    const fixture = TestBed.createComponent(UiSkeleton);
    fixture.componentRef.setInput('width', '120px');
    fixture.componentRef.setInput('height', '48px');
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.getAttribute('aria-hidden')).toBe('true');
    expect(host.classList.contains('ui-skeleton')).toBe(true);
    expect([host.style.inlineSize, host.style.blockSize]).toEqual(['120px', '48px']);
  });
});

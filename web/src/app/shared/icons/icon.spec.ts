import { TestBed } from '@angular/core/testing';
import { UiIcon } from './icon';

describe('UiIcon', () => {
  it('renders the pinned Lucide shapes, decorative by default', async () => {
    const fixture = TestBed.createComponent(UiIcon);
    fixture.componentRef.setInput('name', 'circle-check');
    await fixture.whenStable();
    const svg = (fixture.nativeElement as HTMLElement).querySelector('svg');

    expect(svg).not.toBeNull();
    expect(svg?.querySelector('path, circle')).not.toBeNull();
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.getAttribute('role')).toBeNull();
    expect(svg?.getAttribute('width')).toBe('16');
    expect(svg?.getAttribute('stroke')).toBe('currentColor');
  });

  it('becomes an image with an accessible name when labelled', async () => {
    const fixture = TestBed.createComponent(UiIcon);
    fixture.componentRef.setInput('name', 'zap');
    fixture.componentRef.setInput('label', 'Live');
    fixture.componentRef.setInput('size', 20);
    await fixture.whenStable();
    const svg = (fixture.nativeElement as HTMLElement).querySelector('svg');

    expect(svg?.getAttribute('role')).toBe('img');
    expect(svg?.getAttribute('aria-label')).toBe('Live');
    expect(svg?.getAttribute('aria-hidden')).toBeNull();
    expect(svg?.getAttribute('height')).toBe('20');
  });
});

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

describe('UiRing small text-less size (spec 071, ISC-585)', () => {
  async function render(value: number | null, size: 24 | 20 = 24) {
    const fixture = TestBed.createComponent(UiRing);
    fixture.componentRef.setInput('value', value);
    fixture.componentRef.setInput('size', size);
    fixture.componentRef.setInput('stroke', 3);
    fixture.componentRef.setInput('label', '3 of 4 claims closed');
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  it('renders no percentage text and exposes a progressbar with its value', async () => {
    const host = await render(75);

    expect(host.querySelector('.text')).toBeNull();
    expect(host.getAttribute('role')).toBe('progressbar');
    expect(host.getAttribute('aria-valuemin')).toBe('0');
    expect(host.getAttribute('aria-valuemax')).toBe('100');
    expect(host.getAttribute('aria-valuenow')).toBe('75');
    expect(host.getAttribute('aria-label')).toBe('3 of 4 claims closed');
    expect(host.hasAttribute('data-full')).toBe(false);
    expect(host.querySelector('svg')?.getAttribute('width')).toBe('24');
    expect(host.querySelector('circle.bar')?.getAttribute('stroke-width')).toBe('3');
  });

  it('marks a full ring so it paints solid lime instead of the gradient', async () => {
    const host = await render(100, 20);

    expect(host.getAttribute('aria-valuenow')).toBe('100');
    expect(host.hasAttribute('data-full')).toBe(true);
    expect(host.querySelector('circle.bar')?.hasAttribute('stroke')).toBe(false);
  });

  it('leaves aria-valuenow off when there is no value', async () => {
    const host = await render(null);

    expect(host.getAttribute('role')).toBe('progressbar');
    expect(host.hasAttribute('aria-valuenow')).toBe(false);
  });

  it('keeps the existing sizes unchanged: text, no role, no aria value, the gradient', async () => {
    const fixture = TestBed.createComponent(UiRing);
    fixture.componentRef.setInput('value', 100);
    fixture.componentRef.setInput('size', 40);
    fixture.componentRef.setInput('stroke', 6);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector('.text')?.textContent.replace(/\s+/g, '')).toBe('100%');
    expect(host.hasAttribute('role')).toBe(false);
    expect(host.hasAttribute('aria-valuenow')).toBe(false);
    expect(host.hasAttribute('data-full')).toBe(false);
    expect(host.querySelector('circle.bar')?.getAttribute('stroke')).toMatch(/^url\(#ui-ring-\d+\)$/);
  });
});

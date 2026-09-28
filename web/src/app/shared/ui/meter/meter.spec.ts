import { TestBed } from '@angular/core/testing';
import { UiMeter } from './meter';

describe('UiMeter', () => {
  it('is a meter scaled to value / max', async () => {
    const fixture = TestBed.createComponent(UiMeter);
    fixture.componentRef.setInput('value', 3);
    fixture.componentRef.setInput('max', 4);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.getAttribute('role')).toBe('meter');
    expect(host.querySelector<HTMLElement>('.fill')?.style.transform).toBe('scaleX(0.75)');
  });

  it('splits into proportional segments', async () => {
    const fixture = TestBed.createComponent(UiMeter);
    fixture.componentRef.setInput('segments', [
      { key: 'building', count: 2, tone: 'warning' },
      { key: 'scoping', count: 4, tone: 'secondary' },
    ]);
    await fixture.whenStable();
    const segs = (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('.seg');
    expect([...segs].map((s) => s.style.flexGrow)).toEqual(['2', '4']);
  });
});

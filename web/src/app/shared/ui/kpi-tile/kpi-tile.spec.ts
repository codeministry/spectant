import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { UiKpiTile } from './kpi-tile';

describe('UiKpiTile', () => {
  it('renders the fraction and becomes one link when href is set', async () => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(UiKpiTile);
    fixture.componentRef.setInput('label', 'Master claims');
    fixture.componentRef.setInput('value', 474);
    fixture.componentRef.setInput('denominator', 477);
    fixture.componentRef.setInput('href', '/w/demo');
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector('.figure')?.textContent.replace(/\s+/g, '')).toBe('474/477');
    expect(host.querySelector('a.tile')?.getAttribute('href')).toBe('/w/demo');
  });

  it('steps the fraction down past six digits', async () => {
    const fixture = TestBed.createComponent(UiKpiTile);
    fixture.componentRef.setInput('label', 'Claims');
    fixture.componentRef.setInput('value', 1234);
    fixture.componentRef.setInput('denominator', 5678);
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).querySelector('.figure.long')).not.toBeNull();
  });
});

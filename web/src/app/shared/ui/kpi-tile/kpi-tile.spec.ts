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

  it('carries query state on the link, so a tile can apply a filter as well as land on a section', async () => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(UiKpiTile);
    fixture.componentRef.setInput('label', 'Takeable');
    fixture.componentRef.setInput('value', 4);
    fixture.componentRef.setInput('href', '/w/demo');
    fixture.componentRef.setInput('queryParams', { sort: 'next', takeable: 1 });
    fixture.componentRef.setInput('fragment', 'specs');
    await fixture.whenStable();

    const link = (fixture.nativeElement as HTMLElement).querySelector('a.tile');
    expect(link?.getAttribute('href')).toBe('/w/demo?sort=next&takeable=1#specs');
  });

  it('steps the fraction down past six digits', async () => {
    const fixture = TestBed.createComponent(UiKpiTile);
    fixture.componentRef.setInput('label', 'Claims');
    fixture.componentRef.setInput('value', 1234);
    fixture.componentRef.setInput('denominator', 5678);
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).querySelector('.figure.long')).not.toBeNull();
  });

  it('passes explicit edge and glow to its card, so a tile can glow without an edge', async () => {
    const fixture = TestBed.createComponent(UiKpiTile);
    fixture.componentRef.setInput('label', 'Master claims');
    fixture.componentRef.setInput('value', 101);
    fixture.componentRef.setInput('glow', true);
    await fixture.whenStable();
    const card = (fixture.nativeElement as HTMLElement).querySelector('ui-card');

    expect(card?.hasAttribute('data-glow')).toBe(true);
    expect(card?.hasAttribute('data-edge')).toBe(false);

    fixture.componentRef.setInput('accent', 'accent');
    fixture.componentRef.setInput('edge', true);
    await fixture.whenStable();
    expect(card?.hasAttribute('data-edge')).toBe(true);
    expect(card?.getAttribute('data-accent')).toBe('accent');
  });
});

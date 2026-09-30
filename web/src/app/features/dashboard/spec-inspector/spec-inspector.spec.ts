import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { CATALOGUES, LANGS } from '../../../../i18n/catalogues';
import type { SpecTableRow } from '../spec-table/spec-table-model';
import { EXPLORE_TABS, SpecInspector } from './spec-inspector';

const ROW: SpecTableRow = {
  id: '002',
  title: 'Web console',
  type: 'feature',
  phase: 'building',
  stage: 'implementing',
  closed: 3,
  total: 4,
  nextCommand: '/spec-implement 002',
  takeable: ['ISC-7'],
  warnings: 1,
  fog: 2,
  description: 'See every agent at a glance.',
  agent: null,
};

describe('SpecInspector', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [
        TranslocoTestingModule.forRoot({
          langs: CATALOGUES,
          translocoConfig: { availableLangs: [...LANGS], defaultLang: 'en' },
          preloadLangs: true,
        }),
      ],
      providers: [provideRouter([])],
    });
  });

  async function render(prev: string | null, next: string | null) {
    const fixture = TestBed.createComponent(SpecInspector);
    fixture.componentRef.setInput('ws', 'harbor');
    fixture.componentRef.setInput('row', ROW);
    fixture.componentRef.setInput('warnings', [{ kind: 'drift', text: 'Master drift' }]);
    fixture.componentRef.setInput('prev', prev);
    fixture.componentRef.setInput('next', next);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  it('shows the spec, its claims, next command, takeable claims, warnings and fog', async () => {
    const el = await render('001', '003');
    expect(el.getAttribute('data-spec')).toBe('002');
    expect(el.querySelector('h2')?.textContent).toContain('Web console');
    expect(el.textContent).toContain('See every agent at a glance.');
    expect(el.textContent).toContain('3/4 · 75 %');
    expect(el.querySelector('ui-command-chip')?.textContent).toContain('/spec-implement 002');
    expect(el.textContent).toContain('ISC-7');
    expect(el.querySelector('[data-inspector="warnings"]')?.textContent).toContain('Master drift');
    expect(el.textContent).toContain('Open fog');
  });

  it('links Open to the spec page, the explore links to its tabs and [ ] to the neighbours as ?spec', async () => {
    const el = await render('001', '003');
    expect(el.querySelector('[data-action="open-spec"]')?.getAttribute('href')).toBe('/w/harbor/s/002');
    const tabs = [...el.querySelectorAll('.insp-explore-item')].map((a) => a.getAttribute('href'));
    expect(tabs).toEqual(EXPLORE_TABS.map((tab) => `/w/harbor/s/002/${tab}`));
    expect(el.querySelector('[data-action="prev-spec"]')?.getAttribute('href')).toBe('/?spec=001');
    expect(el.querySelector('[data-action="next-spec"]')?.getAttribute('href')).toBe('/?spec=003');
  });

  it('shows no step link past either end and emits back', async () => {
    const fixture = TestBed.createComponent(SpecInspector);
    fixture.componentRef.setInput('ws', 'harbor');
    fixture.componentRef.setInput('row', ROW);
    let backs = 0;
    fixture.componentInstance.back.subscribe(() => (backs += 1));
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-action="prev-spec"]')).toBeNull();
    expect(el.querySelector('[data-action="next-spec"]')).toBeNull();
    el.querySelector<HTMLButtonElement>('[data-action="back"]')?.click();
    expect(backs).toBe(1);
  });
});

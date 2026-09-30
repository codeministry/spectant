import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslocoTestingModule } from '@jsverse/transloco';
import type { PlanningHolder } from '../../../../../core/src/planning';
import { CATALOGUES, LANGS } from '../../../i18n/catalogues';
import { SpecChip } from './spec-chip';

const holder = (id: string, over: Partial<PlanningHolder> = {}): PlanningHolder => ({
  id,
  slug: `${id}-x`,
  title: 'x',
  archived: false,
  main: false,
  held: 1,
  stage: null,
  ...over,
});

@Component({
  imports: [SpecChip],
  template: `<app-spec-chip ws="harbor" [holder]="holder" feature="F2" [mainFeature]="mainFeature" />`,
})
class Host {
  holder = holder('002');
  mainFeature: string | null = null;
}

function render(h: PlanningHolder, mainFeature: string | null = null): HTMLElement {
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
  const fixture = TestBed.createComponent(Host);
  fixture.componentInstance.holder = h;
  fixture.componentInstance.mainFeature = mainFeature;
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}
const link = (root: HTMLElement): HTMLAnchorElement => root.querySelector('a.chip') as HTMLAnchorElement;
/** The visible words, one per flex item (the gap, not a space character, separates them). */
const text = (el: Element): string =>
  [...el.querySelectorAll('span:not(.dot)')].map((s) => s.textContent.trim()).join(' ');

describe('SpecChip (T31, ISC-103)', () => {
  it('main: dot, mono id, stage word, link to the spec', () => {
    const root = render(holder('002', { main: true, stage: 'build' }));
    const a = link(root);
    expect(a.dataset['variant']).toBe('main');
    expect(text(a)).toBe('002 Build');
    expect(a.getAttribute('aria-label')).toBe('002 Build, main feature');
    expect(a.getAttribute('href')).toBe('/w/harbor/s/002');
    expect(a.querySelector('.dot')).not.toBeNull();
    expect(root.querySelector('app-spec-chip')?.getAttribute('data-spec')).toBe('002');
  });

  it('other: outline, no dot, names the holder main feature', () => {
    const a = link(render(holder('005', { stage: 'plan' }), 'F7'));
    expect(a.dataset['variant']).toBe('other');
    expect(text(a)).toBe('005 Plan');
    expect(a.getAttribute('aria-label')).toBe('005 Plan, main feature F7');
    expect(a.querySelector('.dot')).toBeNull();
  });

  it('other with no stage drops the word cleanly', () => {
    const a = link(render(holder('005'), 'F7'));
    expect(text(a)).toBe('005');
    expect(a.getAttribute('aria-label')).toBe('005, main feature F7');
  });

  it('archived: archive glyph, word, no stage, same route shape', () => {
    const a = link(render(holder('001', { archived: true, stage: 'done' })));
    expect(a.dataset['variant']).toBe('archived');
    expect(text(a)).toBe('001 archived');
    expect(a.getAttribute('aria-label')).toBe('001, archived');
    expect(a.getAttribute('href')).toBe('/w/harbor/s/001');
    expect(a.querySelector('ui-icon')).not.toBeNull();
    expect(a.querySelector('.dot')).toBeNull();
  });
});

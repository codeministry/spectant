import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { CATALOGUES, LANGS } from '../../../i18n/catalogues';
import type { OverlapLine } from '../../features/dashboard/warnings-panel/overlap';
import { OverlapLines } from './overlap-lines';

// Spec 025 T29 (ISC-164.1): the overlap lines of the spec head and their short form in the spec context from 1120 px.

beforeEach(() => {
  TestBed.configureTestingModule({
    imports: [TranslocoTestingModule.forRoot({ langs: CATALOGUES, translocoConfig: { availableLangs: [...LANGS], defaultLang: 'en' }, preloadLangs: true })],
    providers: [provideRouter([])],
  });
});

const line = (other: string, waiting = false): OverlapLine => ({ other, paths: ['web/src/app/retention/'], edge: `(after: ${other})`, waiting });
const text = (el: Element | null): string => (el?.textContent ?? '').replace(/\s+/gu, ' ').trim();

async function render(lines: readonly OverlapLine[], form: 'full' | 'short' = 'full', anchors = true): Promise<HTMLElement> {
  const fixture = TestBed.createComponent(OverlapLines);
  fixture.componentRef.setInput('lines', lines);
  fixture.componentRef.setInput('ws', 'harbor');
  fixture.componentRef.setInput('form', form);
  fixture.componentRef.setInput('anchors', anchors);
  await fixture.whenStable();
  return fixture.nativeElement as HTMLElement;
}

describe('OverlapLines (T29, ISC-164.1)', () => {
  it('short form: the text and an anchor on the head line, no paths and no chip', async () => {
    const root = await render([line('004', true)], 'short');
    const short = root.querySelector('[data-overlap-short]') as HTMLElement;
    expect(text(short)).toContain('Shares 1 file with 004');
    expect(root.querySelector('[data-overlap-anchor]')?.getAttribute('href')).toBe('/#overlap-004');
    expect(root.querySelector('[data-overlap-path]')).toBeNull();
    expect(root.querySelector('ui-command-chip')).toBeNull();
  });

  it('full form: two lines open, the rest under "+n more overlaps", anchors only when asked', async () => {
    const root = await render([line('004'), line('006'), line('009')]);
    expect([...root.querySelectorAll('[data-overlap-line]')].map((l) => l.id)).toEqual(['overlap-004', 'overlap-006', 'overlap-009']);
    expect(text(root.querySelector('[data-overlaps-more] summary'))).toBe('+1 more overlap');
    expect(root.querySelector('[data-overlaps-more] [data-overlap-with="009"]')).not.toBeNull();
    const repeat = await render([line('004')], 'full', false);
    expect(repeat.querySelector('[data-overlap-line]')?.hasAttribute('id')).toBe(false);
  });
});

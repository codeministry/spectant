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
    expect(root.querySelector('[data-overlap-anchor]')?.getAttribute('href')).toBe('/?open=overlaps#overlap-004');
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

// Spec 021 T37 (ISC-250): inside the spec head's one overlaps disclosure the lines fold no further.
describe('OverlapLines unfolded (T37, ISC-250)', () => {
  const many = (other: string): OverlapLine => ({ ...line(other), paths: ['a/one.ts', 'a/two.ts', 'a/three.ts', 'a/four.ts', 'a/five.ts'] });

  it('fold off: every line and every path, no "+n more overlaps" and no "+n more"', async () => {
    const fixture = TestBed.createComponent(OverlapLines);
    fixture.componentRef.setInput('lines', [many('004'), many('006'), many('009')]);
    fixture.componentRef.setInput('ws', 'harbor');
    fixture.componentRef.setInput('fold', false);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    expect([...root.querySelectorAll('[data-overlap-line]')].map((l) => l.getAttribute('data-overlap-with'))).toEqual(['004', '006', '009']);
    expect(root.querySelector('[data-overlaps-more]')).toBeNull();
    expect(root.querySelector('[data-overlap-more]')).toBeNull();
    expect(root.querySelectorAll('[data-overlap-path]')).toHaveLength(15);
  });
});

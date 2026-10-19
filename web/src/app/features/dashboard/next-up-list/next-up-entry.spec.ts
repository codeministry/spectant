import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslocoService, TranslocoTestingModule } from '@jsverse/transloco';
import harbor from '../../../../../../core/fixtures/harbor.golden.json';
import type { DashboardView as DashboardModel, DashboardRowView as DashboardSpecRow } from '../context-rail/dashboard-view';
import { CATALOGUES, LANGS } from '../../../../i18n/catalogues';
import { stageIndex } from '../../spec/dashboard/dashboard-model';
import { NextUpEntry } from './next-up-entry';

const HARBOR = harbor as unknown as DashboardModel;
const LONG = 'A title long enough to need a second line in every Next up form';
const SHORT = 'Short title';
const LABELS = ['Idea', 'Spec', 'Plan', 'Build', 'Done'];

// A DOM emulation has no layout: a title "overflows" when its text is longer than the short one, so the clamp offers
// its toggle exactly where a real layout would. Restored after every test.
const descriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight');
const style = Object.getOwnPropertyDescriptor(window, 'getComputedStyle');

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList.contains('title') && this.textContent.length > SHORT.length + 4 ? 200 : 10;
    },
  });
  const real = window.getComputedStyle.bind(window);
  Object.defineProperty(window, 'getComputedStyle', {
    configurable: true,
    value: (el: Element) =>
      new Proxy(real(el), {
        get: (target, key) => (key === 'lineHeight' ? '20px' : key === 'fontSize' ? '14px' : (Reflect.get(target, key) as unknown)),
      }),
  });
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

afterEach(() => {
  if (descriptor) Object.defineProperty(HTMLElement.prototype, 'scrollHeight', descriptor);
  if (style) Object.defineProperty(window, 'getComputedStyle', style);
});

/** The accessible name as the accessibility tree computes it for a button: `aria-label`, else its non-hidden text. */
function accessibleName(el: Element): string {
  const label = el.getAttribute('aria-label');
  if (label !== null) return label.trim();
  const text = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
    if (node instanceof Element && node.getAttribute('aria-hidden') === 'true') return '';
    return [...node.childNodes].map(text).join('');
  };
  return text(el).replace(/\s+/g, ' ').trim();
}

async function render(title: string, form: 'card' | 'rail', lang: 'en' | 'de' = 'en') {
  TestBed.inject(TranslocoService).setActiveLang(lang);
  const base = HARBOR.specs[0];
  const row = { ...base, title } as DashboardSpecRow;
  const fixture = TestBed.createComponent(NextUpEntry);
  fixture.componentRef.setInput('row', row);
  fixture.componentRef.setInput('form', form);
  fixture.componentRef.setInput('labels', LABELS);
  await fixture.whenStable();
  const host = fixture.nativeElement as HTMLElement;
  const more = () => host.querySelector<HTMLButtonElement>('button[data-next-more]');
  return { fixture, host, more, id: row.id };
}

describe('NextUpEntry expand toggle names its entry (spec 021, T31, ISC-248)', () => {
  for (const form of ['card', 'rail'] as const) {
    it(`${form}: "More…" is named "More… <id> <title>", label in name`, async () => {
      const { more, id } = await render(LONG, form);
      expect(more()).not.toBeNull();
      expect(more()?.textContent.trim()).toBe('More…');
      expect(accessibleName(more() as HTMLButtonElement)).toBe(`More… ${id} ${LONG}, next up`);
    });

    it(`${form}: the open state "Less" is named "Less <id> <title>"`, async () => {
      const { fixture, more, id } = await render(LONG, form);
      more()?.click();
      await fixture.whenStable();
      expect(more()?.getAttribute('aria-expanded')).toBe('true');
      expect(more()?.textContent.trim()).toBe('Less');
      expect(accessibleName(more() as HTMLButtonElement)).toBe(`Less ${id} ${LONG}, next up`);
    });

    it(`${form}: the German names start with the visible text and name the entry`, async () => {
      const { fixture, more, id } = await render(LONG, form, 'de');
      expect(accessibleName(more() as HTMLButtonElement)).toBe(`Mehr… ${id} ${LONG}, Next up`);
      more()?.click();
      await fixture.whenStable();
      expect(accessibleName(more() as HTMLButtonElement)).toBe(`Weniger ${id} ${LONG}, Next up`);
    });

    it(`${form}: a title that fits gets no toggle`, async () => {
      const { more } = await render(SHORT, form);
      expect(more()).toBeNull();
    });
  }

  // Spec 021 (T79, P3 heights): the rail row has no labelled stage track; its title link names the stage after the
  // visible title, in both languages, and the title stays one line (the toggle opens it).
  for (const [lang, stage] of [['en', 'Stage'], ['de', 'Stage']] as const) {
    it(`rail (${lang}): the title link's name is "<title>, ${stage} n of 5: <label>", and there is no stage track`, async () => {
      const { host } = await render(SHORT, 'rail', lang);
      const link = host.querySelector('a[data-next-link]') as HTMLElement;
      const of = lang === 'en' ? 'of' : 'von';
      const index = Math.min(stageIndex(HARBOR.specs[0].stage), LABELS.length - 1) + 1;
      expect(accessibleName(link)).toBe(`${SHORT}, ${stage} ${index} ${of} 5: ${LABELS[index - 1]}`);
      expect(host.querySelector('ui-stage-track')).toBeNull();
      expect(host.querySelector('ui-card')).toBeNull();
      expect(host.querySelector('[data-next-row] h3 ui-id-chip')).not.toBeNull();
    });
  }

  it('two entries never share a toggle name', async () => {
    const a = await render(LONG, 'card');
    const nameA = accessibleName(a.more() as HTMLButtonElement);
    const other = HARBOR.specs[1];
    const fixture = TestBed.createComponent(NextUpEntry);
    fixture.componentRef.setInput('row', { ...other, title: LONG });
    fixture.componentRef.setInput('labels', LABELS);
    await fixture.whenStable();
    const b = (fixture.nativeElement as HTMLElement).querySelector('button[data-next-more]') as HTMLButtonElement;
    expect(accessibleName(b)).not.toBe(nameA);
  });
});

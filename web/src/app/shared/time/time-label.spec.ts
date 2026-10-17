import { TestBed } from '@angular/core/testing';
import { TranslocoService, TranslocoTestingModule } from '@jsverse/transloco';
import { CATALOGUES, LANGS } from '../../../i18n/catalogues';
import { formatDate, formatInstant } from './format';
import { TIME_SENTINEL, type TimeLabelParams, UiTimeLabel } from './time-label';
import type { UiTimeForm } from './time';

const ISO = '2026-10-01T12:05:00.000Z';

/** Every sentence key that carries a time (plan.md § Approach), with the parameter that holds it. */
const TIME_KEYS: Readonly<Record<string, 'time' | 'date'>> = {
  'brief.asOf': 'date',
  'status.gate.done': 'time',
  'status.gate.written': 'time',
  'status.gate.hint.stale': 'time',
  'status.where.since': 'time',
  'notes.save.saved': 'time',
  'specDashboard.next.since': 'time',
  'specDashboard.next.sinceVia': 'time',
  'library.reader.updated': 'date',
};

/** A catalogue text by its dotted key, nested or flat. */
function text(catalogue: unknown, key: string): unknown {
  const flat = (catalogue as Record<string, unknown>)[key];
  if (flat !== undefined) return flat;
  return key.split('.').reduce<unknown>((node, part) => (node !== null && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined), catalogue);
}

/** Every string of a catalogue, however deep. */
function strings(node: unknown): string[] {
  if (typeof node === 'string') return [node];
  if (node !== null && typeof node === 'object') return Object.values(node).flatMap(strings);
  return [];
}

describe('UiTimeLabel', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [
        TranslocoTestingModule.forRoot({
          langs: CATALOGUES,
          translocoConfig: { availableLangs: [...LANGS], defaultLang: 'en' },
          preloadLangs: true,
        }),
      ],
    });
  });

  interface Inputs {
    readonly key: string;
    readonly value: string;
    readonly params?: TimeLabelParams;
    readonly form?: UiTimeForm;
    readonly timeParam?: string;
  }

  async function render(inputs: Inputs) {
    const fixture = TestBed.createComponent(UiTimeLabel);
    for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
    await fixture.whenStable();
    return fixture;
  }

  const host = (fixture: { nativeElement: unknown }): HTMLElement => fixture.nativeElement as HTMLElement;

  it('splits the translated sentence around one ui-time whose datetime is the ISO value', async () => {
    const el = host(await render({ key: 'status.where.since', value: ISO, params: { via: 'cli' } }));
    const time = el.querySelector('ui-time time');

    expect(el.querySelectorAll('time')).toHaveLength(1);
    expect(time?.getAttribute('datetime')).toBe(ISO);
    expect(time?.textContent).toBe(formatInstant(ISO, 'en'));
    expect(el.textContent).toBe(`since ${formatInstant(ISO, 'en')} via cli`);
    expect(el.textContent).not.toContain(TIME_SENTINEL);
  });

  it('keeps the word order of the language and follows a language switch', async () => {
    const fixture = await render({ key: 'status.where.since', value: ISO, params: { via: 'cli' } });

    TestBed.inject(TranslocoService).setActiveLang('de');
    await fixture.whenStable();

    expect(host(fixture).textContent).toBe(`seit ${formatInstant(ISO, 'de')} über cli`);
    expect(host(fixture).querySelector('time')?.textContent).toBe(formatInstant(ISO, 'de'));
  });

  it('takes the time from another parameter and renders the given form', async () => {
    const el = host(await render({ key: 'brief.asOf', value: ISO, form: 'date', timeParam: 'date' }));

    expect(el.textContent).toBe(`as of ${formatDate(ISO, 'en')}`);
    expect(el.querySelector('time')?.getAttribute('datetime')).toBe(ISO);
  });

  it('puts the time after the text when the sentence has no placeholder', async () => {
    const el = host(await render({ key: 'common.back', value: ISO }));

    expect(el.textContent).toBe(`Back ${formatInstant(ISO, 'en')}`);
    expect(el.lastElementChild?.tagName.toLowerCase()).toBe('ui-time');
  });

  for (const lang of LANGS) {
    it(`finds exactly one {{time}} or {{date}} placeholder, the expected one, in every time key of ${lang}.json`, () => {
      for (const [key, param] of Object.entries(TIME_KEYS)) {
        const value = text(CATALOGUES[lang], key);
        expect(typeof value, `${lang} ${key}`).toBe('string');
        const placeholders = [...String(value).matchAll(/\{\{\s*(time|date)\s*\}\}/gu)].map((match) => match[1]);
        expect(placeholders, `${lang} ${key}`).toEqual([param]);
      }
    });

    it(`never meets the split character in ${lang}.json`, () => {
      expect(strings(CATALOGUES[lang]).filter((entry) => entry.includes(TIME_SENTINEL))).toEqual([]);
    });
  }
});

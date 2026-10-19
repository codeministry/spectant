import { TestBed } from '@angular/core/testing';
import { TranslocoService, TranslocoTestingModule } from '@jsverse/transloco';
import type { TaskStep } from '../../../../../../../core/src/files';
import { CATALOGUES, LANGS } from '../../../../../i18n/catalogues';
import { formatClockSeconds } from '../../../../shared/time';
import { StepTimeline } from './step-timeline';

const T0 = Date.parse('2026-10-19T12:00:00.000Z');
/** The ISO instant `seconds` after T0. */
const at = (seconds: number): string => new Date(T0 + seconds * 1000).toISOString();

const PARENT = 'a:claude:sess-2';
const BUILDER = 'a:claude:sess-2/T12';
const QUESTION = 'Should the release of a claim reuse the lock icon of the run, or does it need its own glyph?';

/** One task's timeline with every kind, in the time order core gives it (ISC-231). */
const STEPS: readonly TaskStep[] = [
  { kind: 'dispatch', ts: at(0), actor: PARENT },
  { kind: 'build', ts: at(45), actor: BUILDER },
  { kind: 'probe', result: 'red', ts: at(170), actor: BUILDER },
  { kind: 'question', ts: at(890), actor: BUILDER, text: QUESTION },
  { kind: 'probe', result: 'green', ts: at(5210), actor: BUILDER },
  { kind: 'patch', ts: at(5240), actor: BUILDER },
  { kind: 'apply', ts: at(5300), actor: PARENT },
  { kind: 'release', ts: at(5305), actor: PARENT },
];

describe('StepTimeline', () => {
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

  async function render(steps: readonly TaskStep[] = STEPS, lang: 'en' | 'de' = 'en'): Promise<HTMLElement> {
    TestBed.inject(TranslocoService).setActiveLang(lang);
    const fixture = TestBed.createComponent(StepTimeline);
    fixture.componentRef.setInput('steps', steps);
    fixture.componentRef.setInput('task', 'T12');
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  const items = (host: HTMLElement): HTMLElement[] => [...host.querySelectorAll<HTMLElement>('[data-step-timeline] > li')];
  const text = (el: Element | null | undefined): string => (el?.textContent ?? '').replace(/\s+/gu, ' ').trim();

  it('lists every step in the order given, oldest at the top, as an ordered list named after its task', async () => {
    const host = await render();
    const list = host.querySelector('ol[data-step-timeline]');

    expect(list?.getAttribute('aria-label')).toBe('Agent steps T12');
    expect(items(host).map((li) => li.dataset['stepKind'])).toEqual(STEPS.map((s) => s.kind));
    expect(items(host).map((li) => li.dataset['stepResult'] ?? null)).toEqual([null, null, 'red', null, 'green', null, null, null]);
  });

  it('names every kind with its visible word and its own lucide icon, the icon hidden from assistive technology', async () => {
    const host = await render();

    expect(items(host).map((li) => text(li.querySelector('[data-step-word]')))).toEqual([
      'Dispatched',
      'Started',
      'Probe red',
      'Question asked',
      'Probe green',
      'Patch ready',
      'Applied',
      'Claim released',
    ]);
    expect(items(host).map((li) => li.querySelector('[data-icon]')?.getAttribute('data-icon'))).toEqual([
      'send',
      'play',
      'circle-x',
      'message-circle-question',
      'circle-check',
      'file-diff',
      'git-merge',
      'lock-open',
    ]);
    for (const li of items(host)) {
      expect(li.querySelector('[data-icon] svg')?.getAttribute('aria-hidden')).toBe('true');
    }
  });

  it('reads the kinds in German too, in the formal catalogue', async () => {
    const host = await render(STEPS, 'de');

    expect(items(host).map((li) => text(li.querySelector('[data-step-word]')))).toEqual([
      'Dispatcht',
      'Gestartet',
      'Probe rot',
      'Frage gestellt',
      'Probe grün',
      'Patch fertig',
      'Angewendet',
      'Claim freigegeben',
    ]);
  });

  it('shows each time as HH:MM:SS in a time element and the duration since the previous step, the first a dash', async () => {
    const host = await render();

    for (const [i, li] of items(host).entries()) {
      const time = li.querySelector('[data-step-time] time');
      expect(time?.getAttribute('datetime')).toBe(STEPS[i]?.ts);
      expect(text(time)).toBe(formatClockSeconds(STEPS[i]?.ts ?? '', 'en'));
      expect(text(time)).toMatch(/^\d{2}:\d{2}:\d{2}$/u);
    }
    expect(items(host).map((li) => text(li.querySelector('[data-step-delta]')))).toEqual([
      '—',
      '+45 s',
      '+2 min 5 s',
      '+12 min',
      '+1 h 12 min',
      '+30 s',
      '+1 min',
      '+5 s',
    ]);
  });

  it('gives screen readers the long form of each duration, the first as the first step', async () => {
    const en = items(await render());
    expect(text(en[0]?.querySelector('[data-step-delta-long]'))).toBe('first step');
    expect(text(en[2]?.querySelector('[data-step-delta-long]'))).toBe('2 minutes 5 seconds after the previous step');

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [
        TranslocoTestingModule.forRoot({
          langs: CATALOGUES,
          translocoConfig: { availableLangs: [...LANGS], defaultLang: 'en' },
          preloadLangs: true,
        }),
      ],
    });
    const de = items(await render(STEPS, 'de'));
    expect(text(de[0]?.querySelector('[data-step-delta-long]'))).toBe('erster Schritt');
    expect(text(de[1]?.querySelector('[data-step-delta-long]'))).toBe('45 Sekunden nach dem vorigen Schritt');
  });

  it('names the actor only where it differs from the previous step', async () => {
    const host = await render();

    expect(items(host).map((li) => li.querySelectorAll('ui-actor-chip').length)).toEqual([1, 1, 0, 0, 0, 0, 1, 0]);
    expect(items(host)[1]?.querySelector('ui-actor-chip')?.getAttribute('title')).toBe(BUILDER);
    expect(items(host)[6]?.querySelector('ui-actor-chip')?.getAttribute('title')).toBe(PARENT);
  });

  it('marks the newest step, at the bottom, and only that one', async () => {
    const host = await render();

    expect(items(host).map((li) => li.hasAttribute('data-step-latest'))).toEqual([false, false, false, false, false, false, false, true]);
    expect(text(items(host)[7])).toContain('latest step');
  });

  it('shows the question text in full under its step', async () => {
    const host = await render();

    expect(text(items(host)[3]?.querySelector('[data-step-question]'))).toBe(QUESTION);
    expect(host.querySelectorAll('[data-step-question]')).toHaveLength(1);
  });

  it('labels the claim release apart from the run release of spec 040, in word and icon', async () => {
    const host = await render();
    const transloco = TestBed.inject(TranslocoService);
    const release = items(host).at(-1);

    expect(text(release?.querySelector('[data-step-word]'))).toBe(transloco.translate('steps.kind.release'));
    expect(transloco.translate('steps.kind.release')).not.toBe(transloco.translate('itemState.release.released'));
    expect(transloco.translate('steps.kind.release', {}, 'de')).not.toBe(transloco.translate('itemState.release.released', {}, 'de'));
    expect(release?.querySelector('[data-icon]')?.getAttribute('data-icon')).toBe('lock-open');
  });

  it('renders an empty list for a task without steps', async () => {
    const host = await render([]);

    expect(host.querySelector('ol[data-step-timeline]')).not.toBeNull();
    expect(items(host)).toHaveLength(0);
  });
});

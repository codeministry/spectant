import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslocoService, TranslocoTestingModule } from '@jsverse/transloco';
import type { SpecWait } from '../../../../../../core/src/files';
import { CATALOGUES, LANGS } from '../../../../i18n/catalogues';
import de from '../../../../i18n/de.json';
import en from '../../../../i18n/en.json';
import { UiWaitsChip } from './waits-chip';

// Spec 025, T21 · ISC-163: `dependency-chip.waits` — one linked chip per known blocker, at most two, then `+n`; an
// unknown blocker unlinked; the partial scope as separate `.meta` or in the accessible name; nothing more in the chip.

const wait = (blockers: string[], extra: Partial<SpecWait> = {}): SpecWait => ({
  spec: '009',
  blockers,
  heldTasks: 4,
  readyTasks: 1,
  openTasks: 5,
  full: false,
  ...extra,
});

async function render(value: SpecWait, opts: { meta?: boolean; titles?: Record<string, string> } = {}): Promise<HTMLElement> {
  const fixture = TestBed.createComponent(UiWaitsChip);
  fixture.componentRef.setInput('wait', value);
  fixture.componentRef.setInput('ws', 'harbor');
  if (opts.meta !== undefined) fixture.componentRef.setInput('meta', opts.meta);
  if (opts.titles) fixture.componentRef.setInput('titles', opts.titles);
  await fixture.whenStable();
  return fixture.nativeElement as HTMLElement;
}

const text = (el: Element | null): string => (el?.textContent ?? '').replace(/\s+/gu, ' ').trim();
const chips = (root: HTMLElement): HTMLElement[] => [...root.querySelectorAll<HTMLElement>('[data-waits]')];

describe('UiWaitsChip (T21, ISC-163)', () => {
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

  it('reads exactly "waits on NNN" with the clock, linked to the blocker spec and named by its title', async () => {
    const root = await render(wait(['002']), { titles: { '002': 'Web console' } });
    const [chip] = chips(root);
    expect(chips(root)).toHaveLength(1);
    expect(chip.tagName).toBe('A');
    expect(text(chip)).toBe('waits on 002');
    expect(chip.getAttribute('href')).toBe('/w/harbor/s/002');
    expect(chip.querySelector('ui-icon[name="clock"]')).not.toBeNull();
    expect(chip.getAttribute('aria-label')).toBe('Waits on spec 002, Web console, 4 waiting · 1 open');
    expect(chip.getAttribute('title')).toBe(chip.getAttribute('aria-label'));
    expect(root.querySelector('[data-waits-more]')).toBeNull();
  });

  it('shows two chips for two blockers and no +n', async () => {
    const root = await render(wait(['002', '006']));
    expect(chips(root).map(text)).toEqual(['waits on 002', 'waits on 006']);
    expect(chips(root).map((c) => c.getAttribute('href'))).toEqual(['/w/harbor/s/002', '/w/harbor/s/006']);
    expect(root.querySelector('[data-waits-more]')).toBeNull();
  });

  it('folds the third blocker on into +n, naming the rest in its tooltip and hidden text', async () => {
    const root = await render(wait(['002', '006', '007', '008']));
    expect(chips(root).map((c) => c.getAttribute('data-blocker'))).toEqual(['002', '006']);
    const more = root.querySelector<HTMLElement>('[data-waits-more]');
    expect(text(more?.querySelector('[aria-hidden="true"]') ?? null)).toBe('+2');
    expect(more?.getAttribute('title')).toBe('Also waits on 007, 008');
    expect(text(more?.querySelector('.visually-hidden') ?? null)).toBe('Also waits on 007, 008');
  });

  it('draws an unknown blocker without a link and says so in its name', async () => {
    const root = await render(wait(['002', '042'], { unknownBlockers: ['042'] }));
    const [known, unknown] = chips(root);
    expect(known.tagName).toBe('A');
    expect(unknown.tagName).toBe('SPAN');
    expect(unknown.hasAttribute('data-unknown')).toBe(true);
    expect(unknown.querySelector('a, [href]')).toBeNull();
    expect(text(unknown.querySelector('.chip-label'))).toBe('waits on 042');
    expect(text(unknown.querySelector('.visually-hidden'))).toBe('Waits on spec 042, no such spec');
  });

  it('puts the partial scope as separate meta behind the chip, never inside the chip text', async () => {
    const root = await render(wait(['006']), { meta: true });
    const meta = root.querySelector('[data-waits-meta]');
    expect(text(meta)).toBe('· 4 waiting · 1 open');
    expect(chips(root)[0].contains(meta)).toBe(false);
    expect(text(chips(root)[0])).toBe('waits on 006');
    expect(chips(root)[0].getAttribute('aria-label')).toBe('Waits on spec 006');
  });

  it('shows no scope at all for a full hold', async () => {
    const root = await render(wait(['002'], { full: true, heldTasks: 5, readyTasks: 0 }), { meta: true });
    expect(root.querySelector('[data-waits-meta]')).toBeNull();
    expect(root.hasAttribute('data-full')).toBe(true);
    expect(chips(root)[0].getAttribute('aria-label')).toBe('Waits on spec 002');
  });

  it('follows the language: "wartet auf NNN" in German', async () => {
    TestBed.inject(TranslocoService).setActiveLang('de');
    const root = await render(wait(['002']), { meta: true });
    expect(text(chips(root)[0])).toBe(`${de.waits.on} 002`);
    expect(text(root.querySelector('[data-waits-meta]'))).toBe('· 4 warten · 1 offen');
    expect(en.waits.on).toBe('waits on');
  });
});

import { TestBed } from '@angular/core/testing';
import { TranslocoService, TranslocoTestingModule } from '@jsverse/transloco';
import type { StatusSpec } from '../../../../../server/src/contracts/status.contract';
import { CATALOGUES, LANGS } from '../../../i18n/catalogues';
import { StatusWidgetRow } from './status-widget-row';

// Spec 071 (T28, ISC-585): one widget row shows the spec number, the title with its full text in `title`, the
// text-less ring as a progressbar, the closed/total counter and the stage chip with its catalogue word and tone; the
// whole row links to the spec.

const OPEN: StatusSpec = {
  id: '012',
  slug: '012-harbor-console',
  title: 'Harbor console with a very long title that ends in an ellipsis',
  stage: 'build',
  claims: { closed: 3, total: 9 },
  closedAt: null,
  state: 'open',
  archived: false,
};

const CLOSED: StatusSpec = {
  id: '007',
  slug: '007-audit-trail',
  title: 'Audit trail',
  stage: 'done',
  claims: { closed: 6, total: 6 },
  closedAt: '2026-10-23T08:00:00.000Z',
  state: 'done',
  archived: true,
};

const COPY = {
  en: { build: 'Build', done: 'Done', closedOpen: '3 of 9 claims closed', closedDone: '6 of 6 claims closed' },
  de: { build: 'Bauen', done: 'Fertig', closedOpen: '3 von 9 Claims geschlossen', closedDone: '6 von 6 Claims geschlossen' },
} as const;

async function render(spec: StatusSpec, lang: 'en' | 'de'): Promise<HTMLElement> {
  TestBed.configureTestingModule({
    imports: [TranslocoTestingModule.forRoot({ langs: CATALOGUES, translocoConfig: { availableLangs: [...LANGS], defaultLang: 'en' }, preloadLangs: true })],
  });
  TestBed.inject(TranslocoService).setActiveLang(lang);
  const fixture = TestBed.createComponent(StatusWidgetRow);
  fixture.componentRef.setInput('spec', spec);
  fixture.componentRef.setInput('ws', 'harbor');
  await fixture.whenStable();
  return fixture.nativeElement as HTMLElement;
}

describe('StatusWidgetRow (spec 071, T28, ISC-585)', () => {
  afterEach(() => TestBed.resetTestingModule());

  for (const lang of ['en', 'de'] as const) {
    it(`an open spec shows number, title, ring, counter and stage chip (${lang})`, async () => {
      const host = await render(OPEN, lang);
      const link = host.querySelector('a.entry') as HTMLAnchorElement;
      expect(link.getAttribute('href')).toBe('/w/harbor/s/012');
      expect(host.querySelector('.entry-id')?.textContent.trim()).toBe('012');
      const title = host.querySelector('.entry-title') as HTMLElement;
      expect(title.textContent.trim()).toBe(OPEN.title);
      expect(title.getAttribute('title')).toBe(OPEN.title);

      const ring = host.querySelector('ui-ring') as HTMLElement;
      expect(ring.getAttribute('role')).toBe('progressbar');
      expect(ring.getAttribute('aria-valuenow')).toBe('33');
      expect(ring.getAttribute('aria-label')).toBe(COPY[lang].closedOpen);
      expect(ring.hasAttribute('data-full')).toBe(false);

      expect(host.querySelector('.entry-count')?.textContent.trim()).toBe('3/9');
      const chip = host.querySelector('ui-chip.entry-stage') as HTMLElement;
      expect(chip.textContent.trim()).toBe(COPY[lang].build);
      expect(chip.getAttribute('data-tone')).toBe('primary');
      expect(chip.querySelector('.dot')).not.toBeNull();

      const name = link.getAttribute('aria-label') ?? '';
      expect(name.startsWith(`012 ${OPEN.title}`)).toBe(true);
      expect(name).toContain(COPY[lang].closedOpen);
      expect(name).toContain(COPY[lang].build);
    });

    it(`a closed spec shows the full lime ring and the done chip in its own tone (${lang})`, async () => {
      const host = await render(CLOSED, lang);
      expect((host.querySelector('a.entry') as HTMLAnchorElement).getAttribute('href')).toBe('/w/harbor/s/007');
      expect(host.querySelector('.entry-id')?.textContent.trim()).toBe('007');
      expect(host.querySelector('.entry-title')?.getAttribute('title')).toBe('Audit trail');

      const ring = host.querySelector('ui-ring') as HTMLElement;
      expect(ring.getAttribute('aria-valuenow')).toBe('100');
      expect(ring.hasAttribute('data-full')).toBe(true);
      expect(ring.getAttribute('aria-label')).toBe(COPY[lang].closedDone);

      expect(host.querySelector('.entry-count')?.textContent.trim()).toBe('6/6');
      const chip = host.querySelector('ui-chip.entry-stage') as HTMLElement;
      expect(chip.textContent.trim()).toBe(COPY[lang].done);
      expect(chip.getAttribute('data-tone')).toBe('success');
    });
  }

  it('a spec without claims leaves the ring without a value', async () => {
    const host = await render({ ...OPEN, claims: { closed: 0, total: 0 } }, 'en');
    const ring = host.querySelector('ui-ring') as HTMLElement;
    expect(ring.hasAttribute('aria-valuenow')).toBe(false);
    expect(host.querySelector('.entry-count')?.textContent.trim()).toBe('0/0');
  });
});

// Spec 071 (T29, ISC-594): a spec with an open agent run carries the decorative agent dot at the ring's corner and
// "agent running" in its row's name; one without a run carries neither. The dot stands still under reduced motion
// through the primitive's own rule (`ui-agent-dot`), which this row adds nothing to.
describe('StatusWidgetRow agent run (spec 071, T29, ISC-594)', () => {
  afterEach(() => TestBed.resetTestingModule());

  const RUNNING = { en: 'agent running', de: 'Agent läuft' } as const;

  for (const lang of ['en', 'de'] as const) {
    it(`a running spec shows the agent dot at its ring and names the run (${lang})`, async () => {
      const host = await render({ ...OPEN, state: 'running' }, lang);
      const dot = host.querySelector('.entry-ring ui-agent-dot') as HTMLElement;
      expect(dot).not.toBeNull();
      expect(dot.getAttribute('aria-hidden')).toBe('true');
      expect(host.querySelector('a.entry')?.getAttribute('aria-label')).toContain(RUNNING[lang]);
    });

    it(`a spec without a run shows no dot and no run in its name (${lang})`, async () => {
      for (const spec of [OPEN, CLOSED, { ...OPEN, state: null }]) {
        const host = await render(spec, lang);
        expect(host.querySelector('ui-agent-dot')).toBeNull();
        expect(host.querySelector('a.entry')?.getAttribute('aria-label')).not.toContain(RUNNING[lang]);
        TestBed.resetTestingModule();
      }
    });
  }
});

import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslocoService, TranslocoTestingModule } from '@jsverse/transloco';
import { CATALOGUES, LANGS } from '../../../../i18n/catalogues';
import { SpecRow } from './spec-row';
import { archivedTableRow, type SpecTableRow } from './spec-table-model';

const LABELS = ['Idea', 'Spec', 'Plan', 'Build', 'Done'];

/** An active row as the list builds it from the dashboard model, with a lock, a priority and a phase. */
const ACTIVE: SpecTableRow = {
  id: '002',
  title: 'Dashboard',
  type: 'feature',
  priority: 'P1',
  phase: 'building',
  stage: 'build',
  stageGroup: 'building',
  closed: 25,
  total: 30,
  nextCommand: '/spec implement 002',
  nextReason: '',
  takeable: [],
  warnings: 0,
  fog: 0,
  description: 'Serves the dashboard.',
  agent: 'a:claude:sess-2',
  waits: null,
};

const ARCHIVED = archivedTableRow({
  id: '017',
  slug: '017-old-board',
  title: 'Old board',
  type: 'feature',
  closed: 7,
  total: 9,
  goal: 'The board the dashboard replaced.',
  archived: '2026-10-01',
});

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

async function render(row: SpecTableRow, opts: { mark?: 'waits' | 'next' | null; first?: boolean; lang?: 'en' | 'de' } = {}) {
  TestBed.inject(TranslocoService).setActiveLang(opts.lang ?? 'en');
  const fixture = TestBed.createComponent(SpecRow);
  fixture.componentRef.setInput('row', row);
  fixture.componentRef.setInput('stageLabels', LABELS);
  fixture.componentRef.setInput('mark', opts.mark ?? null);
  if (opts.first !== undefined) fixture.componentRef.setInput('archivedFirst', opts.first);
  await fixture.whenStable();
  return fixture.nativeElement as HTMLElement;
}

describe('SpecRow archive branch (spec 050, T2, ISC-287)', () => {
  it('an archived row shows the archive chip with icon and word, and no priority, track, phase or agent dot', async () => {
    const host = await render(ARCHIVED);
    const chip = host.querySelector<HTMLElement>('ui-chip[data-archived-chip]');
    expect(chip).not.toBeNull();
    expect(chip?.querySelector('ui-icon')?.getAttribute('data-icon')).toBe('archive');
    expect(chip?.textContent.trim()).toBe('Archived');
    expect(host.querySelector('ui-priority')).toBeNull();
    expect(host.querySelector('ui-stage-track')).toBeNull();
    expect(host.querySelector('.phase')).toBeNull();
    expect(host.querySelector('.agent-dot')).toBeNull();
    expect(host.querySelector('[data-waits-mark], [data-next-mark], [data-row-waits]')).toBeNull();
    expect(host.querySelector('.frac')?.textContent.trim()).toBe('7/9');
    expect(host.hasAttribute('data-archived')).toBe(true);
  });

  it('a guidance mark never shows on an archived row', async () => {
    const host = await render(ARCHIVED, { mark: 'next' });
    expect(host.querySelector('[data-next-mark]')).toBeNull();
    expect(host.hasAttribute('data-mark')).toBe(false);
  });

  it('the archive date stands as <time datetime> and in the chip title, in the app language', async () => {
    const en = await render(ARCHIVED);
    expect(en.querySelector('time')?.getAttribute('datetime')).toBe('2026-10-01');
    expect(en.querySelector('ui-chip[data-archived-chip]')?.getAttribute('title')).toBe('Archived on 10/01/2026');
    const de = await render(ARCHIVED, { lang: 'de' });
    expect(de.querySelector('ui-chip[data-archived-chip]')?.textContent.trim()).toBe('Archiviert');
    expect(de.querySelector('ui-chip[data-archived-chip]')?.getAttribute('title')).toBe('Archiviert am 01.10.2026');
  });

  it('without an archive date there is no <time> and no title', async () => {
    const host = await render(archivedTableRow({ id: '018', slug: '018-x', title: 'X', type: null, closed: 0, total: 0, goal: '', archived: null }));
    expect(host.querySelector('time')).toBeNull();
    expect(host.querySelector('ui-chip[data-archived-chip]')?.hasAttribute('title')).toBe(false);
    expect(host.querySelector('.frac')?.textContent.trim()).toBe('0/0');
  });

  it('archivedFirst marks the host for the dashed boundary', async () => {
    expect((await render(ARCHIVED, { first: true })).hasAttribute('data-archived-first')).toBe(true);
    expect((await render(ARCHIVED)).hasAttribute('data-archived-first')).toBe(false);
  });

  it('an active row is unchanged: priority, track, phase chip and agent dot, no archive chip', async () => {
    const host = await render(ACTIVE, { mark: 'next' });
    expect(host.querySelector('ui-chip[data-archived-chip]')).toBeNull();
    expect(host.querySelector('time')).toBeNull();
    expect(host.querySelector('ui-priority')).not.toBeNull();
    expect(host.querySelector('ui-stage-track')).not.toBeNull();
    expect(host.querySelector('.phase')).not.toBeNull();
    expect(host.querySelector('.agent-dot')).not.toBeNull();
    expect(host.querySelector('[data-next-mark]')).not.toBeNull();
    expect(host.getAttribute('data-mark')).toBe('next');
    expect(host.hasAttribute('data-archived')).toBe(false);
    expect(host.querySelector('.frac')?.textContent.trim()).toBe('25/30');
  });
});

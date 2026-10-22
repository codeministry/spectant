import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslocoService, TranslocoTestingModule } from '@jsverse/transloco';
import { CATALOGUES, LANGS } from '../../../../i18n/catalogues';
import { UiStarToggle } from '../../../shared/ui/star-toggle/star-toggle';
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
    expect(host.querySelector('ui-agent-dot')).toBeNull();
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
    expect(host.querySelector('ui-agent-dot')).not.toBeNull();
    expect(host.querySelector('[data-next-mark]')).not.toBeNull();
    expect(host.getAttribute('data-mark')).toBe('next');
    expect(host.hasAttribute('data-archived')).toBe(false);
    expect(host.querySelector('.frac')?.textContent.trim()).toBe('25/30');
  });
});

describe('SpecRow agent dot (spec 064, T8, ISC-467)', () => {
  it('renders the shared ui-agent-dot in the agent cell, named and titled by the agent label', async () => {
    const host = await render(ACTIVE);
    const dot = host.querySelector('.ragent ui-agent-dot');
    expect(dot).not.toBeNull();
    expect(dot?.getAttribute('role')).toBe('img');
    expect(dot?.getAttribute('aria-label')).toBe('Agent a:claude:sess-2 working');
    expect(dot?.getAttribute('title')).toBe('Agent a:claude:sess-2 working');
    expect(dot?.querySelector('.ring')).not.toBeNull();
    expect(host.querySelector('span.agent-dot')).toBeNull();
  });

  it('a row without an agent keeps the empty cell and renders no dot', async () => {
    const host = await render({ ...ACTIVE, agent: null });
    expect(host.querySelector('.ragent')).not.toBeNull();
    expect(host.querySelector('ui-agent-dot')).toBeNull();
  });
});

/** The list's projection as spec-table writes it: the row link, then the star as its own button (spec 052 T17). */
@Component({
  imports: [SpecRow, UiStarToggle],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-spec-row [row]="row()" [stageLabels]="labels">
      <a class="row-link" href="#">{{ row().title }}</a>
      <button ui-star-toggle [label]="'Favorite: ' + row().id + ' ' + row().title"></button>
      @if (more()) {
        <button type="button" class="row-more" aria-label="More… 002 Dashboard">…</button>
      }
    </app-spec-row>
  `,
})
class ProjectingHost {
  readonly row = signal<SpecTableRow>(ACTIVE);
  readonly more = signal(false);
  readonly labels = LABELS;
}

async function renderProjected(row: SpecTableRow, more = false) {
  TestBed.inject(TranslocoService).setActiveLang('en');
  const fixture = TestBed.createComponent(ProjectingHost);
  fixture.componentInstance.row.set(row);
  fixture.componentInstance.more.set(more);
  await fixture.whenStable();
  return (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('app-spec-row') as HTMLElement;
}

describe('SpecRow star slot (spec 052, T17, ISC-300)', () => {
  it('projects the star button into its own cell, a sibling of the row link and never inside it', async () => {
    const host = await renderProjected(ACTIVE);
    const star = host.querySelector<HTMLElement>('button[ui-star-toggle]');
    expect(star).not.toBeNull();
    expect(star?.closest('a')).toBeNull();
    expect(star?.parentElement?.classList.contains('rstar')).toBe(true);
    expect(host.querySelector('.tline button[ui-star-toggle]')).toBeNull();
    expect(host.querySelector('.tline > a.row-link')).not.toBeNull();
    expect(star?.getAttribute('aria-label')).toBe('Favorite: 002 Dashboard');
  });

  it('an archived row shows no star, but keeps its empty cell so the columns line up', async () => {
    const host = await renderProjected(ARCHIVED);
    expect(host.querySelector('button[ui-star-toggle]')).toBeNull();
    expect(host.querySelector('.rstar')).not.toBeNull();
    expect(host.querySelector('.tline > a.row-link')).not.toBeNull();
  });
});

/** The row grid's named columns (spec 064, T45, ISC-487), in order; T47 maps the idea row onto them, T56 measures them. */
const CELLS = ['id', 'title', 'more', 'mark', 'agent', 'prio', 'track', 'phase', 'meter', 'star'];

/** The row's compiled stylesheet (the shared grid partial included), whitespace dropped. */
function rowCss(): string {
  const styles = (SpecRow as unknown as { ɵcmp: { styles: readonly string[] } }).ɵcmp.styles;
  return styles.join('').replace(/\s+/g, '').replaceAll('--%NS%', '--');
}

const cellsOf = (host: HTMLElement) => [...host.children].map((c) => c.getAttribute('data-cell'));

describe('SpecRow fixed columns (spec 064, T45, ISC-487)', () => {
  it('from 640 px the grid names ten fixed columns with the design widths', () => {
    const css = rowCss();
    expect(css).toMatch(/grid-template-areas:["']idtitlemoremarkagentpriotrackphasemeterstar["']/);
    expect(css).toContain('grid-template-columns:72pxminmax(0,1fr)24px136px8px48pxvar(--track-col,88px)104px120px32px');
  });

  it('maps every cell onto its own grid area by its data-cell name', () => {
    const css = rowCss();
    for (const name of CELLS) expect(css, name).toMatch(new RegExp(`\\[data-cell=["']?${name}["']?\\][^{}]*\\{grid-area:${name}[;}]`));
  });

  it('renders all ten cells in column order, a marked row as an unmarked one', async () => {
    for (const mark of ['waits', 'next', null] as const) {
      const host = await render(ACTIVE, { mark });
      expect(cellsOf(host), String(mark)).toEqual(CELLS);
    }
    expect(cellsOf(await render({ ...ACTIVE, agent: null, phase: null, description: null }))).toEqual(CELLS);
  });

  it('keeps the mark cell, empty, on a row without a mark; the mark sits in it on a marked row', async () => {
    const plain = await render(ACTIVE);
    const cell = plain.querySelector('[data-cell="mark"]');
    expect(cell).not.toBeNull();
    expect(cell?.children).toHaveLength(0);
    const waits = await render(ACTIVE, { mark: 'waits' });
    expect(waits.querySelector('[data-waits-mark]')?.parentElement?.getAttribute('data-cell')).toBe('mark');
    const next = await render(ACTIVE, { mark: 'next' });
    expect(next.querySelector('[data-next-mark]')?.parentElement?.getAttribute('data-cell')).toBe('mark');
  });

  it('splits the old track cell: agent dot, priority, stage track and phase chip each in its own cell', async () => {
    const host = await render(ACTIVE);
    expect(host.querySelector('ui-agent-dot')?.parentElement?.getAttribute('data-cell')).toBe('agent');
    expect(host.querySelector('ui-priority')?.parentElement?.getAttribute('data-cell')).toBe('prio');
    expect(host.querySelector('ui-stage-track')?.parentElement?.getAttribute('data-cell')).toBe('track');
    expect(host.querySelector('ui-chip.phase')?.parentElement?.getAttribute('data-cell')).toBe('phase');
  });

  it('keeps the archived row in the same columns: the date in the mark cell, the archive chip in the phase cell', async () => {
    const host = await render(ARCHIVED);
    expect(cellsOf(host)).toEqual(CELLS);
    expect(host.querySelector('time')?.closest('[data-cell]')?.getAttribute('data-cell')).toBe('mark');
    expect(host.querySelector('[data-archived-chip]')?.parentElement?.getAttribute('data-cell')).toBe('phase');
  });
});

describe('SpecRow more toggle cell (spec 064, T46, ISC-489)', () => {
  it("projects the list's toggle into its own more cell, outside the title, the id and the row link", async () => {
    const host = await renderProjected(ACTIVE, true);
    const more = host.querySelector<HTMLElement>('button.row-more');
    expect(more?.parentElement?.getAttribute('data-cell')).toBe('more');
    expect(more?.closest('a, .rtitle, .rid')).toBeNull();
    expect(cellsOf(host)).toEqual(CELLS);
  });

  it('without a toggle the more cell stays, empty', async () => {
    const host = await renderProjected(ACTIVE);
    expect(host.querySelector('[data-cell="more"]')?.children).toHaveLength(0);
  });

  it('anchors nothing to the description any more: no anchor-name on the title line or the description', async () => {
    const host = await render(ACTIVE);
    expect(host.querySelector('.tline')?.getAttribute('style') ?? '').not.toContain('anchor');
    expect(host.querySelector('.d')?.getAttribute('style') ?? '').not.toContain('anchor');
  });
});

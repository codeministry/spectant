import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { afterEach, describe, expect, it } from 'vitest';
import type { StatusResponse } from '../../../../../server/src/contracts/status.contract';
import { CATALOGUES, LANGS } from '../../../i18n/catalogues';
import { routes } from '../../app.routes';
import { ApiClient, type ApiResult } from '../../core/api.service';

// Spec 072 (T19, T20, ISC-603): below the head the page shows a filter of two multi-selections, workspace and stage.
// Without a selection everything shows; with one the list shows only the rows both selections match, and a workspace
// without a hit has no head. The options come from the unfiltered body: workspaces in picker order, stages in
// workflow order limited to the ones that occur.

type Spec = StatusResponse['workspaces'][number]['specs'][number];

const spec = (id: string, stage: Spec['stage']): Spec => ({
  id,
  slug: `${id}-item`,
  title: `Item ${id}`,
  stage,
  claims: { closed: 1, total: 3 },
  closedAt: null,
  state: stage === 'done' ? 'done' : 'open',
  archived: false,
  nextCommand: stage === 'done' ? null : `/spec implement ${id}`,
});

/** Three workspaces with mixed stages, one readable without specs, one unreadable, in picker order. */
const MIXED: StatusResponse = {
  kpis: { repos: 3, closed: 1, listed: 6, claimsClosed: 6, claimsTotal: 18 },
  workspaces: [
    { slug: 'harbor', pathTail: 'harbor-app', readable: true, error: null, specs: [spec('002', 'build'), spec('005', 'review'), spec('001', 'done')] },
    { slug: 'quiet', pathTail: 'quiet', readable: true, error: null, specs: [] },
    { slug: 'lantern', pathTail: 'lantern', readable: true, error: null, specs: [spec('010', 'plan'), spec('011', 'build')] },
    { slug: 'beacon', pathTail: 'beacon', readable: false, error: 'unreadable', specs: [] },
    { slug: 'reef', pathTail: 'reef', readable: true, error: null, specs: [spec('020', 'review')] },
  ],
};

/** No workspace lists a spec and every one is readable: no group, so no filter. */
const EMPTY: StatusResponse = {
  kpis: { repos: 0, closed: 0, listed: 0, claimsClosed: 0, claimsTotal: 0 },
  workspaces: [{ slug: 'harbor', pathTail: 'harbor-app', readable: true, error: null, specs: [] }],
};

describe('status widget filter (spec 072, T19, ISC-603)', () => {
  let harness: RouterTestingHarness;

  async function land(body: StatusResponse = MIXED, lang: (typeof LANGS)[number] = 'en'): Promise<HTMLElement> {
    const api: Partial<ApiClient> = {
      status: (): Promise<ApiResult<StatusResponse>> => Promise.resolve({ kind: 'ok', body, etag: '"s1"', notModified: false }),
    };
    TestBed.configureTestingModule({
      imports: [TranslocoTestingModule.forRoot({ langs: CATALOGUES, translocoConfig: { availableLangs: [...LANGS], defaultLang: lang }, preloadLangs: true })],
      providers: [provideRouter(routes), provideHttpClient(), provideHttpClientTesting(), { provide: ApiClient, useValue: api }],
    });
    harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/widget');
    await harness.fixture.whenStable();
    harness.detectChanges();
    return harness.routeNativeElement as HTMLElement;
  }

  afterEach(() => TestBed.resetTestingModule());

  /** The chip buttons of one dimension: 0 workspace, 1 stage. */
  const chips = (root: HTMLElement, row: 0 | 1): HTMLButtonElement[] => {
    const group = root.querySelectorAll('section.filter ui-filter-chips').item(row) as Element | null;
    return [...(group?.querySelectorAll<HTMLButtonElement>('button.chip') ?? [])];
  };

  const press = async (root: HTMLElement, row: 0 | 1, text: string): Promise<void> => {
    const chip = chips(root, row).find((button) => button.textContent.trim() === text);
    if (!chip) throw new Error(`no chip "${text}"`);
    chip.click();
    await harness.fixture.whenStable();
    harness.detectChanges();
  };

  /** The rendered groups as `slug: ids`, in DOM order; an unreadable group lists `!notice`. */
  const visible = (root: HTMLElement): string[] =>
    [...root.querySelectorAll<HTMLElement>('section.groups [data-workspace]')].map((group) => {
      const ids = [...group.querySelectorAll<HTMLElement>('[data-spec]')].map((row) => row.dataset['spec']);
      const notice = group.querySelector('ui-notice') ? ['!notice'] : [];
      const head = group.querySelector('h2.group-head') ? '' : '!nohead ';
      return `${head}${group.dataset['workspace'] ?? ''}: ${[...ids, ...notice].join(' ')}`;
    });

  it('stands between the head and the list, a labelled row per dimension, the labels hidden and named on the group', async () => {
    const root = await land();
    const order = [...(root.querySelector('main.widget .column')?.querySelectorAll(':scope > header, :scope > section') ?? [])];
    expect(order.map((el) => `${el.tagName.toLowerCase()}.${el.className}`)).toEqual(['header.head', 'section.filter', 'section.groups']);
    const labels = [...root.querySelectorAll<HTMLElement>('section.filter span.filter-label')];
    expect(labels.map((label) => [label.textContent.trim(), label.getAttribute('aria-hidden')])).toEqual([
      ['Workspace', 'true'],
      ['Stage', 'true'],
    ]);
    const rows = [...root.querySelectorAll<HTMLElement>('section.filter ui-filter-chips')];
    expect(rows.map((row) => [row.hasAttribute('data-multiple'), row.hasAttribute('data-wrap')])).toEqual([
      [true, true],
      [true, true],
    ]);
    expect(rows.map((row) => row.querySelector('[role="group"]')?.getAttribute('aria-label'))).toEqual(['Workspace', 'Stage']);
  });

  it('offers the workspaces in picker order by path tail, and the occurring stages in workflow order (en)', async () => {
    const root = await land();
    expect(chips(root, 0).map((chip) => chip.textContent.trim())).toEqual(['harbor-app', 'lantern', 'beacon', 'reef']);
    expect(chips(root, 0).map((chip) => chip.getAttribute('aria-label'))).toEqual([null, null, 'beacon, not readable', null]);
    expect(chips(root, 0).map((chip) => chip.querySelector('.dot') !== null)).toEqual([false, false, true, false]);
    expect(chips(root, 1).map((chip) => chip.textContent.trim())).toEqual(['Plan', 'Review', 'Build', 'Done']);
    expect(chips(root, 1).every((chip) => chip.querySelector('.dot') !== null)).toBe(true);
    expect([...chips(root, 0), ...chips(root, 1)].every((chip) => chip.getAttribute('aria-pressed') === 'false')).toBe(true);
  });

  it('words the labels, the stage chips and the unreadable name in German (de)', async () => {
    const root = await land(MIXED, 'de');
    expect(chips(root, 0).map((chip) => chip.textContent.trim())).toEqual(['harbor-app', 'lantern', 'beacon', 'reef']);
    expect(chips(root, 0)[2]?.getAttribute('aria-label')).toBe('beacon, nicht lesbar');
    expect(chips(root, 1).map((chip) => chip.textContent.trim())).toEqual(['Plan', 'Review', 'Bauen', 'Fertig']);
  });

  it('shows everything without a selection', async () => {
    const root = await land();
    expect(visible(root)).toEqual(['harbor: 002 005 001', 'lantern: 010 011', 'beacon: !notice', 'reef: 020']);
  });

  it('narrows to the pressed workspaces, and the options never change', async () => {
    const root = await land();
    await press(root, 0, 'lantern');
    expect(visible(root)).toEqual(['lantern: 010 011']);
    await press(root, 0, 'reef');
    expect(visible(root)).toEqual(['lantern: 010 011', 'reef: 020']);
    expect(chips(root, 0).map((chip) => chip.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false', 'true']);
    expect(chips(root, 1).map((chip) => chip.textContent.trim())).toEqual(['Plan', 'Review', 'Build', 'Done']);
    await press(root, 0, 'lantern');
    await press(root, 0, 'reef');
    expect(visible(root)).toEqual(['harbor: 002 005 001', 'lantern: 010 011', 'beacon: !notice', 'reef: 020']);
  });

  it('narrows to the pressed stages; a workspace without a hit has no head, the unreadable one stays', async () => {
    const root = await land();
    await press(root, 1, 'Review');
    expect(visible(root)).toEqual(['harbor: 005', 'beacon: !notice', 'reef: 020']);
    await press(root, 1, 'Plan');
    expect(visible(root)).toEqual(['harbor: 005', 'lantern: 010', 'beacon: !notice', 'reef: 020']);
    expect(root.querySelectorAll('section.groups h2.group-head')).toHaveLength(4);
  });

  it('shows the intersection of both selections, and drops the unreadable workspace once another is pressed', async () => {
    const root = await land();
    await press(root, 1, 'Build');
    await press(root, 0, 'harbor-app');
    await press(root, 0, 'lantern');
    expect(visible(root)).toEqual(['harbor: 002', 'lantern: 011']);
    await press(root, 0, 'reef');
    expect(visible(root)).toEqual(['harbor: 002', 'lantern: 011']);
    expect([...root.querySelectorAll('section.groups h2.group-head')].map((head) => head.textContent.trim())).toEqual(['harbor-app', 'lantern']);
    await press(root, 0, 'beacon');
    expect(visible(root)).toEqual(['harbor: 002', 'lantern: 011', 'beacon: !notice']);
  });

  it('has no filter without a listed spec, only the empty line', async () => {
    const root = await land(EMPTY);
    expect(root.querySelector('section.filter')).toBeNull();
    expect(root.querySelectorAll('section.groups .meta')).toHaveLength(1);
  });

  // Spec 072 (T24, ISC-604): the head counts exactly the visible rows; without a selection exactly the body's KPIs.
  /** The head's three figures as rendered: repos, closed/listed, claims closed/total. */
  const figures = (root: HTMLElement): string[] => [...root.querySelectorAll<HTMLElement>('header.head dl.kpis dd')].map((dd) => dd.textContent.trim());

  it('counts the listed specs without a selection, exactly the body KPIs (ISC-583 held)', async () => {
    const root = await land();
    const { repos, closed, listed, claimsClosed, claimsTotal } = MIXED.kpis;
    expect(figures(root)).toEqual([`${repos}`, `${closed}/${listed}`, `${claimsClosed}/${claimsTotal}`]);
  });

  it('counts only the rows a workspace, a stage or both selections leave visible', async () => {
    const root = await land();
    await press(root, 0, 'lantern');
    expect(figures(root)).toEqual(['1', '0/2', '2/6']);
    await press(root, 0, 'lantern');
    await press(root, 1, 'Review');
    expect(visible(root)).toEqual(['harbor: 005', 'beacon: !notice', 'reef: 020']);
    expect(figures(root)).toEqual(['2', '0/2', '2/6']);
    await press(root, 1, 'Review');
    await press(root, 1, 'Done');
    await press(root, 1, 'Build');
    await press(root, 0, 'harbor-app');
    expect(visible(root)).toEqual(['harbor: 002 001']);
    expect(figures(root)).toEqual(['1', '1/2', '2/6']);
  });

  // Spec 072 (T26, ISC-605): a selection without a hit shows one line with a reset button, never an empty area.
  it('shows one no-match line with a reset button and zero figures when nothing matches', async () => {
    const root = await land();
    await press(root, 1, 'Done');
    await press(root, 0, 'lantern');
    const groups = root.querySelector('section.groups');
    expect(groups?.querySelectorAll('.group')).toHaveLength(0);
    expect(groups?.children).toHaveLength(1);
    const line = groups?.querySelector('div.no-match');
    expect(line?.querySelector('p.meta')?.textContent.trim()).toBe('No spec matches this filter.');
    const buttons = [...(line?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
    expect(buttons.map((b) => [b.textContent.trim(), b.hasAttribute('ui-button'), b.dataset['variant'], b.classList.contains('btn-sm')])).toEqual([
      ['Reset filter', true, 'secondary', true],
    ]);
    expect(figures(root)).toEqual(['0', '0/0', '0/0']);
    expect(root.querySelector('section.filter')).not.toBeNull();
    expect(chips(root, 0).map((chip) => chip.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false', 'false']);
  });

  it('resets the filter from the no-match line and moves the focus to the first workspace chip', async () => {
    const root = await land();
    await press(root, 1, 'Done');
    await press(root, 0, 'reef');
    const reset = root.querySelector<HTMLButtonElement>('div.no-match button');
    if (!reset) throw new Error('no reset button');
    reset.focus();
    reset.click();
    await harness.fixture.whenStable();
    harness.detectChanges();
    expect(visible(root)).toEqual(['harbor: 002 005 001', 'lantern: 010 011', 'beacon: !notice', 'reef: 020']);
    expect([...chips(root, 0), ...chips(root, 1)].every((chip) => chip.getAttribute('aria-pressed') === 'false')).toBe(true);
    expect(root.querySelector('div.no-match')).toBeNull();
    expect(document.activeElement).toBe(chips(root, 0)[0]);
    expect(figures(root)).toEqual(['3', '1/6', '6/18']);
  });

  it('keeps the plain empty line without a button for a body that lists nothing', async () => {
    const root = await land(EMPTY);
    expect(root.querySelector('div.no-match')).toBeNull();
    expect(root.querySelectorAll('section.groups button')).toHaveLength(0);
    expect(root.querySelector('section.groups p.meta')?.textContent.trim()).toBe('No open or recently closed specs.');
  });
});

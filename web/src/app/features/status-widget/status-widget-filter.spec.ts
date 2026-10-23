import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StatusResponse } from '../../../../../server/src/contracts/status.contract';
import { CATALOGUES, LANGS } from '../../../i18n/catalogues';
import { routes } from '../../app.routes';
import { ApiClient, type ApiResult } from '../../core/api.service';
import { RefreshService } from '../../layout/shell/refresh.service';
import { WIDGET_FILTER_KEY } from './widget-filter';

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
  /** The body the stubbed status read answers; a live reload swaps it. */
  let served: StatusResponse = MIXED;

  async function land(body: StatusResponse = MIXED, lang: (typeof LANGS)[number] = 'en'): Promise<HTMLElement> {
    served = body;
    const api: Partial<ApiClient> = {
      status: (): Promise<ApiResult<StatusResponse>> => Promise.resolve({ kind: 'ok', body: served, etag: '"s1"', notModified: false }),
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

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    TestBed.resetTestingModule();
  });

  /** The chip buttons of one dimension: 0 workspace, 1 stage. */
  const chips = (root: HTMLElement, row: 0 | 1): HTMLButtonElement[] => {
    const group = root.querySelectorAll('section.filter ui-filter-chips').item(row) as Element | null;
    return [...(group?.querySelectorAll<HTMLButtonElement>('button.chip') ?? [])];
  };

  /** A chip's visible label, without its count. */
  const labelOf = (chip: HTMLButtonElement): string => chip.querySelector('.text')?.textContent.trim() ?? '';

  /** Each chip of one dimension as `label count`, or the label alone where the chip carries no number. */
  const counted = (root: HTMLElement, row: 0 | 1): string[] =>
    chips(root, row).map((chip) => {
      const count = chip.querySelector('.count')?.textContent.trim();
      return count === undefined ? labelOf(chip) : `${labelOf(chip)} ${count}`;
    });

  const press = async (root: HTMLElement, row: 0 | 1, text: string): Promise<void> => {
    const chip = chips(root, row).find((button) => labelOf(button) === text);
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
    expect(chips(root, 0).map(labelOf)).toEqual(['harbor-app', 'lantern', 'beacon', 'reef']);
    expect(chips(root, 0).map((chip) => chip.getAttribute('aria-label'))).toEqual([null, null, 'beacon, not readable', null]);
    expect(chips(root, 0).map((chip) => chip.querySelector('.dot') !== null)).toEqual([false, false, true, false]);
    expect(chips(root, 1).map(labelOf)).toEqual(['Plan', 'Review', 'Build', 'Done']);
    expect(chips(root, 1).every((chip) => chip.querySelector('.dot') !== null)).toBe(true);
    expect([...chips(root, 0), ...chips(root, 1)].every((chip) => chip.getAttribute('aria-pressed') === 'false')).toBe(true);
  });

  it('words the labels, the stage chips and the unreadable name in German (de)', async () => {
    const root = await land(MIXED, 'de');
    expect(chips(root, 0).map(labelOf)).toEqual(['harbor-app', 'lantern', 'beacon', 'reef']);
    expect(chips(root, 0)[2]?.getAttribute('aria-label')).toBe('beacon, nicht lesbar');
    expect(chips(root, 1).map(labelOf)).toEqual(['Plan', 'Review', 'Bauen', 'Fertig']);
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
    expect(chips(root, 1).map(labelOf)).toEqual(['Plan', 'Review', 'Build', 'Done']);
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

  // Spec 072 (T22, ISC-611): each chip counts the listed specs its option meets under the other dimension's selection,
  // never its own; a 0 chip stays visible and pressable, and an unreadable workspace carries no number.
  it('counts each option without a selection, and gives the unreadable workspace no number', async () => {
    const root = await land();
    expect(counted(root, 0)).toEqual(['harbor-app 3', 'lantern 2', 'beacon', 'reef 1']);
    expect(chips(root, 0)[2]?.querySelector('.count')).toBeNull();
    expect(counted(root, 1)).toEqual(['Plan 1', 'Review 2', 'Build 2', 'Done 1']);
  });

  it('narrows the stage counts on a workspace press and leaves the workspace counts unchanged', async () => {
    const root = await land();
    await press(root, 0, 'lantern');
    expect(counted(root, 0)).toEqual(['harbor-app 3', 'lantern 2', 'beacon', 'reef 1']);
    expect(counted(root, 1)).toEqual(['Plan 1', 'Review 0', 'Build 1', 'Done 0']);
  });

  it('narrows the workspace counts on a stage press and leaves the stage counts unchanged', async () => {
    const root = await land();
    await press(root, 1, 'Review');
    expect(counted(root, 0)).toEqual(['harbor-app 1', 'lantern 0', 'beacon', 'reef 1']);
    expect(counted(root, 1)).toEqual(['Plan 1', 'Review 2', 'Build 2', 'Done 1']);
  });

  it('counts each dimension under the other with both selections, and a 0 chip stays visible and pressable', async () => {
    const root = await land();
    await press(root, 0, 'lantern');
    await press(root, 1, 'Review');
    expect(chips(root, 1).map((chip) => chip.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false', 'false']);
    expect(root.querySelector('div.no-match')).not.toBeNull();
    expect(counted(root, 0)).toEqual(['harbor-app 1', 'lantern 0', 'beacon', 'reef 1']);
    expect(counted(root, 1)).toEqual(['Plan 1', 'Review 0', 'Build 1', 'Done 0']);
    await press(root, 0, 'beacon');
    expect(counted(root, 0)).toEqual(['harbor-app 1', 'lantern 0', 'beacon', 'reef 1']);
    expect(chips(root, 0).map((chip) => chip.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'true', 'false']);
  });

  // Spec 072 (T29, ISC-606): the selection survives a reload through storage and a live update through the prune; a
  // selected option that no longer occurs falls out, and a broken or throwing store starts without a selection.
  /** The stored selection, or null when nothing is stored. */
  const stored = (): unknown => JSON.parse(localStorage.getItem(WIDGET_FILTER_KEY) ?? 'null');
  const pressedOf = (root: HTMLElement, row: 0 | 1): Array<string | null> => chips(root, row).map((chip) => chip.getAttribute('aria-pressed'));

  /** Serves `body` from now on and runs one live refresh, as a frame or the poll would. */
  const reload = async (body: StatusResponse): Promise<void> => {
    served = body;
    TestBed.inject(RefreshService).refresh();
    await harness.fixture.whenStable();
    harness.detectChanges();
  };

  it('applies a stored selection on start and prunes a stored workspace the body no longer has', async () => {
    localStorage.setItem(WIDGET_FILTER_KEY, JSON.stringify({ workspaces: ['lantern', 'gone'], stages: ['build'] }));
    const root = await land();
    expect(visible(root)).toEqual(['lantern: 011']);
    expect(pressedOf(root, 0)).toEqual(['false', 'true', 'false', 'false']);
    expect(pressedOf(root, 1)).toEqual(['false', 'false', 'true', 'false']);
    expect(stored()).toEqual({ workspaces: ['lantern'], stages: ['build'] });
  });

  it('stores every press under spectant.statusWidget.filter', async () => {
    const root = await land();
    await press(root, 0, 'lantern');
    expect(stored()).toEqual({ workspaces: ['lantern'], stages: [] });
    await press(root, 1, 'Review');
    expect(stored()).toEqual({ workspaces: ['lantern'], stages: ['review'] });
  });

  it('keeps the selection through a live reload that adds a spec', async () => {
    const root = await land();
    await press(root, 0, 'lantern');
    await reload({
      ...MIXED,
      workspaces: MIXED.workspaces.map((ws) => (ws.slug === 'lantern' ? { ...ws, specs: [...ws.specs, spec('012', 'plan')] } : ws)),
    });
    expect(visible(root)).toEqual(['lantern: 010 011 012']);
    expect(pressedOf(root, 0)).toEqual(['false', 'true', 'false', 'false']);
    expect(stored()).toEqual({ workspaces: ['lantern'], stages: [] });
  });

  it('drops a selected workspace that vanished in a live reload, on screen and in storage', async () => {
    const root = await land();
    await press(root, 0, 'lantern');
    await press(root, 0, 'reef');
    await reload({ ...MIXED, workspaces: MIXED.workspaces.filter((ws) => ws.slug !== 'reef') });
    expect(chips(root, 0).map(labelOf)).toEqual(['harbor-app', 'lantern', 'beacon']);
    expect(pressedOf(root, 0)).toEqual(['false', 'true', 'false']);
    expect(visible(root)).toEqual(['lantern: 010 011']);
    expect(stored()).toEqual({ workspaces: ['lantern'], stages: [] });
  });

  it('starts without a selection from broken stored JSON', async () => {
    localStorage.setItem(WIDGET_FILTER_KEY, '{"workspaces": [');
    const root = await land();
    expect(visible(root)).toEqual(['harbor: 002 005 001', 'lantern: 010 011', 'beacon: !notice', 'reef: 020']);
    expect([...pressedOf(root, 0), ...pressedOf(root, 1)].every((pressed) => pressed === 'false')).toBe(true);
  });

  it('starts without a selection and keeps filtering when the storage throws', async () => {
    const fail = (): never => {
      throw new DOMException('denied', 'SecurityError');
    };
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(fail);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(fail);
    const root = await land();
    expect(visible(root)).toEqual(['harbor: 002 005 001', 'lantern: 010 011', 'beacon: !notice', 'reef: 020']);
    await press(root, 0, 'reef');
    expect(visible(root)).toEqual(['reef: 020']);
  });
});

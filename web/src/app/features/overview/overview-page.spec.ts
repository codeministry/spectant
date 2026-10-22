import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslocoTestingModule } from '@jsverse/transloco';
import harbor from '../../../../../core/fixtures/harbor.golden.json';
import lantern from '../../../../../core/fixtures/lantern.golden.json';
import { ApiClient, type ApiResult, type WorkspaceListEntry } from '../../core/api.service';
import { LockSourceService } from '../../core/lock-source.service';
import { ShellState } from '../../layout/shell/shell-state.service';
import { CATALOGUES, LANGS } from '../../../i18n/catalogues';
import { OverviewPage } from './overview-page';

const ok = <T>(body: T): ApiResult<T> => ({ kind: 'ok', body, etag: null, notModified: false });
const entry = (slug: string, readable = true, error?: string): WorkspaceListEntry => ({
  slug,
  name: slug,
  pathTail: `code/${slug}`,
  readable,
  counts: null,
  ...(error === undefined ? {} : { error }),
});
const BODIES: Readonly<Record<string, unknown>> = { harbor, lantern };

async function render(
  list: readonly WorkspaceListEntry[] | 'error',
  bodies: Readonly<Record<string, unknown>> = BODIES,
): Promise<{ root: HTMLElement; asked: string[] }> {
  const asked: string[] = [];
  const api = {
    workspaces: () => Promise.resolve(list === 'error' ? ({ kind: 'error', status: 0 } as const) : ok(list)),
    dashboard: (slug: string) => {
      asked.push(slug);
      return Promise.resolve(ok(bodies[slug] ?? {}));
    },
    planning: () => Promise.resolve({ kind: 'not-found', served: false } as const),
    spec: () => Promise.resolve({ kind: 'not-found', served: false } as const),
  };
  TestBed.configureTestingModule({
    imports: [
      TranslocoTestingModule.forRoot({
        langs: CATALOGUES,
        translocoConfig: { availableLangs: [...LANGS], defaultLang: 'en' },
        preloadLangs: true,
      }),
    ],
    providers: [
      provideRouter([]),
      { provide: ApiClient, useValue: api },
      { provide: ShellState, useValue: { ws: signal<string | null>(null), specId: signal<string | null>(null) } },
      { provide: LockSourceService, useValue: { connect: () => undefined } },
    ],
  });
  const fixture = TestBed.createComponent(OverviewPage);
  for (let i = 0; i < 4; i++) {
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return { root: fixture.nativeElement as HTMLElement, asked };
}

const text = (el: Element | null | undefined): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
/** harbor with one held lock on spec 004 (spec 064, ISC-461); the golden body carries `taken: []` on every row. */
const harborLocked = {
  ...harbor,
  specs: harbor.specs.map((row) =>
    row.id === '004' ? { ...row, taken: [{ claim: 'ISC-9', session: 'a:claude:spec-004/T2', since: '2026-10-21T10:00:00Z' }] } : row,
  ),
};
const titleOf = (id: string | undefined): string => harbor.specs.find((row) => row.id === id)?.title ?? '';

describe('OverviewPage (T65, ISC-16)', () => {
  it('heads the page with the workspace count and renders one column per workspace in list order', async () => {
    const { root, asked } = await render([entry('harbor'), entry('lantern')]);
    expect(root.getAttribute('data-page')).toBe('overview');
    expect(text(root.querySelector('[data-page-eyebrow]'))).toBe('All workspaces · 2');
    expect(root.querySelector('h1')).not.toBeNull();
    const columns = [...root.querySelectorAll('.overview [data-ui="workspace-column"]')];
    expect(columns.map((c) => c.getAttribute('data-ws'))).toEqual(['harbor', 'lantern']);
    expect([...asked].sort()).toEqual(['harbor', 'lantern']);
    // T54 (spec 024): one identity cover per column, a mock with its chip in the ws-head; the fixture holds no image
    // for harbor or lantern, so each shows the name pattern and no <img> appears.
    const covers = [...root.querySelectorAll('[data-ws-cover]')];
    expect(covers.map((cover) => cover.closest('[data-ui="workspace-column"]')?.getAttribute('data-ws'))).toEqual(['harbor', 'lantern']);
    for (const cover of covers) {
      const mock = cover.closest('[data-demo]');
      expect(mock?.querySelector('[data-demo-head] [data-demo-chip]')).not.toBeNull();
      expect(cover.querySelector('svg path')).not.toBeNull();
    }
    expect(root.querySelectorAll('[data-ws-badge]').length).toBe(covers.length);
    expect(root.querySelector('img')).toBeNull();
  });

  it('shows the ws-head: badge, name as h2, mono path and the updated time', async () => {
    const { root } = await render([entry('harbor')]);
    const head = root.querySelector('[data-ws="harbor"] .ws-head');
    expect(text(head?.querySelector('.ws-badge'))).toBe('HA');
    expect(text(head?.querySelector('h2'))).toBe('harbor');
    expect(text(head?.querySelector('.path'))).toBe('code/harbor');
    expect(head?.querySelector('a')?.getAttribute('href')).toBe('/w/harbor');
    expect(text(head?.querySelector('[data-updated]'))).toMatch(/^Updated /);
    // Spec 058 (ISC-395): every link of the workspace identity, the cover included, means the workspace, its dashboard.
    const identityLinks = [...root.querySelectorAll('[data-ws="harbor"] app-ws-identity a')].map((link) => link.getAttribute('href'));
    expect(identityLinks.length).toBeGreaterThanOrEqual(2);
    expect(new Set(identityLinks)).toEqual(new Set(['/w/harbor']));
  });

  it('fills the 2 × 2 kpi-strip: master ring and fraction, spec claims meter, specs split, warnings with an orange edge above 0', async () => {
    const { root } = await render([entry('harbor'), entry('lantern')]);
    const strip = (ws: string) => root.querySelector(`[data-ws="${ws}"] [data-ui="kpi-strip"]`);
    const h = strip('harbor');
    expect(h?.querySelectorAll('[data-ui="kpi-tile"]').length).toBe(4);
    const master = h?.querySelector('[data-kpi="master"]');
    expect(master?.querySelector('ui-ring')).not.toBeNull();
    const kpis = harbor.kpis;
    expect(text(master?.querySelector('.val'))).toBe(`${String(kpis.master.closed)}/${String(kpis.master.total)}`);
    const claims = h?.querySelector('[data-kpi="claims"]');
    expect(text(claims?.querySelector('.val'))).toBe(`${String(kpis.claims.closed)}/${String(kpis.claims.total)}`);
    expect(claims?.querySelector('ui-meter')).not.toBeNull();
    const specs = h?.querySelector('[data-kpi="specs"]');
    expect(text(specs?.querySelector('.val'))).toBe(String(kpis.specs));
    expect(specs?.querySelector('ui-meter')).not.toBeNull();
    const warnings = h?.querySelector('[data-kpi="warnings"]');
    expect(text(warnings?.querySelector('.val'))).toBe(String(kpis.warnings));
    expect(text(warnings?.querySelector('.meta'))).toBe(`Open fog · ${String(kpis.fog)}`);
    expect(warnings?.hasAttribute('data-edge')).toBe(true);
    expect(strip('lantern')?.querySelector('[data-kpi="warnings"]')?.hasAttribute('data-edge')).toBe(false);
  });

  // spec 024: overview without lists (principal 2026-10-13)
  it('shows per workspace only its identity and the four tiles: no Next up, no spec list, no open link; cover and name lead to the workspace', async () => {
    const { root } = await render([entry('harbor'), entry('lantern')]);
    for (const ws of ['harbor', 'lantern']) {
      const column = root.querySelector(`.overview [data-ws="${ws}"]`);
      expect(column).not.toBeNull();
      expect(column?.querySelectorAll('[data-ui="kpi-tile"]').length).toBe(4);
      expect(column?.querySelector('.next, .next-row, [data-next], .dense-list, .d-row, a.open-link, ui-empty-state')).toBeNull();
      expect(text(column)).not.toContain('Next up');
      // Spec 020 T16: the only spec links and the only chip on `/` sit in the block "Waits on you".
      const outside = (selector: string) => [...(column?.querySelectorAll(selector) ?? [])].filter((el) => !el.closest('[data-ui="waits-block"], ui-working-block'));
      expect(outside('ui-command-chip, a[href*="/s/"]')).toEqual([]);
      const links = outside('a[href]');
      expect(links.map((link) => link.getAttribute('href'))).toEqual([`/w/${ws}`, `/w/${ws}`]);
      expect(column?.querySelector('a [data-ws-cover]')).not.toBeNull();
      expect(column?.querySelector('.ws-head a h2')).not.toBeNull();
    }
    expect(root.querySelector('[data-footer-note]')).not.toBeNull();
  });

  // spec 020 T16 (ISC-238), spec 064 T19 (ISC-462, ISC-478)
  it('puts one lists wrapper between the identity and the kpi-strip: "Waits on you" as three flat tiles, "Show all n" to #waiting', async () => {
    const { root } = await render([entry('harbor'), entry('lantern')]);
    const column = root.querySelector('.overview [data-ws="harbor"]');
    const children = [...(column?.children ?? [])];
    expect(children.map((el) => el.tagName.toLowerCase())).toEqual(['app-ws-identity', 'div', 'div']);
    const lists = column?.querySelector('[data-lists]');
    expect(children[1]?.hasAttribute('data-lists')).toBe(true);
    expect(children[2]?.getAttribute('data-ui')).toBe('kpi-strip');
    const block = lists?.querySelector('[data-ui="waits-block"]');
    const waits = harbor.guidance.waits;
    expect(waits.length).toBe(7);
    expect(block?.getAttribute('data-count')).toBe('7');
    // ISC-478: every entry the same flat tile, no highlighted top card, the spec title as the main text.
    expect(block?.querySelector('[data-top], [data-row]')).toBeNull();
    const tiles = [...(block?.querySelectorAll('ol.tiles > li') ?? [])];
    expect(tiles.length).toBe(3);
    expect(tiles.every((tile) => tile.querySelector('ui-flat-tile') !== null)).toBe(true);
    expect(tiles.map((tile) => text(tile.querySelector('[data-tile-id]')))).toEqual(waits.slice(0, 3).map((e) => e.spec));
    expect(tiles.map((tile) => text(tile.querySelector('.title')))).toEqual(waits.slice(0, 3).map((e) => titleOf(e.spec)));
    expect(tiles[0]?.querySelector('a')?.getAttribute('href')).toBe(`/w/harbor/s/${waits[0]?.spec ?? ''}`);
    const more = block?.querySelector('a[data-more]');
    expect(text(more?.querySelector('[data-visible]'))).toBe('Show all 7');
    expect(more?.getAttribute('href')).toBe('/w/harbor#waiting');
    expect(block?.querySelector('ui-disclosure')).toBeNull();
    expect(block?.querySelector('h3')?.id).toBe('waits-harbor');
    expect(text(column)).not.toContain('Next up');
  });

  // spec 064 T19 (ISC-461, ISC-462)
  it('puts "In progress" under "Waits on you" in the same wrapper when a session holds a claim, with the dashboard working tile', async () => {
    const { root } = await render([entry('harbor'), entry('lantern')], { harbor: harborLocked, lantern });
    const column = root.querySelector('.overview [data-ws="harbor"]');
    const children = [...(column?.children ?? [])];
    expect(children.map((el) => el.tagName.toLowerCase())).toEqual(['app-ws-identity', 'div', 'div']);
    expect(children[2]?.getAttribute('data-ui')).toBe('kpi-strip');
    const lists = column?.querySelector('[data-lists]');
    expect([...(lists?.children ?? [])].map((el) => el.tagName.toLowerCase())).toEqual(['ui-waits-block', 'ui-working-block']);
    const working = lists?.querySelector('ui-working-block');
    expect(working?.querySelector('h3')?.id).toBe('working-harbor');
    const tiles = [...(working?.querySelectorAll('ol.tiles > li') ?? [])];
    expect(tiles.length).toBe(1);
    expect(tiles[0]?.querySelector('ui-flat-tile ui-agent-dot')).not.toBeNull();
    expect(text(tiles[0]?.querySelector('[data-id]'))).toBe('004');
    expect(text(tiles[0]?.querySelector('[data-title]'))).toBe(titleOf('004'));
    expect(text(tiles[0]?.querySelector('[data-agent]'))).toBe('a:claude:spec-004/T2');
    expect(tiles[0]?.querySelector('a')?.getAttribute('href')).toBe('/w/harbor/s/004/board');
  });

  // spec 064 T20 (ISC-462): without a held claim a column shows no element of "In progress", in either workspace (harbor
  // has waiting entries, lantern none); the golden bodies carry `taken: []` on every row.
  it('ISC-462: no In Arbeit element without a held claim', async () => {
    expect([...harbor.specs, ...lantern.specs].every((row) => row.taken.length === 0)).toBe(true);
    const { root } = await render([entry('harbor'), entry('lantern')]);
    for (const ws of ['harbor', 'lantern']) {
      const column = root.querySelector(`.overview [data-ws="${ws}"]`);
      expect(column).not.toBeNull();
      // The heading first: a block that drew its section header for 0 entries fails here.
      expect(column?.querySelector(`#working-${ws}, [id^="working-"]`)).toBeNull();
      const headings = [...(column?.querySelectorAll('h1, h2, h3, h4, [role="heading"]') ?? [])].map((el) => text(el));
      expect(headings.filter((heading) => heading.includes('In progress'))).toEqual([]);
      expect(column?.querySelector('ui-working-block')).toBeNull();
      // No tile list beyond the waits one (lantern's waits block shows its sentence and no list at all).
      const tiles = [...(column?.querySelectorAll('.tiles') ?? [])];
      expect(tiles.filter((list) => !list.closest('[data-ui="waits-block"]'))).toEqual([]);
      // Exactly three subgrid tracks: identity, the lists wrapper, the kpi-strip; the wrapper holds the waits block alone.
      const children = [...(column?.children ?? [])];
      expect(children.map((el) => el.tagName.toLowerCase())).toEqual(['app-ws-identity', 'div', 'div']);
      expect(children[1]?.hasAttribute('data-lists')).toBe(true);
      expect(children[2]?.getAttribute('data-ui')).toBe('kpi-strip');
      expect([...(children[1]?.children ?? [])].map((el) => el.tagName.toLowerCase())).toEqual(['ui-waits-block']);
    }
    expect(root.querySelectorAll('[data-ws="harbor"] [data-ui="waits-block"] .tiles').length).toBe(1);
  });

  it('says in one sentence that nothing waits, with no card and no link, when the workspace has no waiting entry', async () => {
    const { root } = await render([entry('lantern')]);
    const block = root.querySelector('[data-ws="lantern"] [data-ui="waits-block"]');
    expect(block?.getAttribute('data-count')).toBe('0');
    expect(text(block?.querySelector('[data-empty]'))).toBe('Nothing is waiting on you.');
    expect(block?.querySelector('[data-top], [data-row], [data-more], ui-command-chip')).toBeNull();
  });

  it('shows an unreadable workspace as a notice in its column and loads no dashboard for it', async () => {
    const { root, asked } = await render([entry('harbor'), entry('broken', false, 'permission denied')]);
    const column = root.querySelector('[data-ws="broken"]');
    expect(column?.querySelector('ui-notice')).not.toBeNull();
    expect(text(column)).toContain('permission denied');
    expect(column?.querySelector('[data-ui="kpi-strip"]')).toBeNull();
    expect(asked).toEqual(['harbor']);
  });

  it('shows the empty state with the add command when no workspace is registered', async () => {
    const { root } = await render([]);
    expect(root.querySelector('[data-ui="workspace-column"]')).toBeNull();
    // spec 024: the shared empty-state markup.
    const empty = root.querySelector('[data-overview-empty]');
    expect(text(empty)).toContain('Add your first workspace');
    expect(empty?.querySelector('ui-command-chip')).not.toBeNull();
  });

  it('says so when the workspace list cannot be loaded', async () => {
    const { root } = await render('error');
    expect(root.querySelector('ui-notice')).not.toBeNull();
    expect(root.querySelector('[data-ui="workspace-column"]')).toBeNull();
  });
});

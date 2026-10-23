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
    // T54 (spec 024): one identity head per column, core's data without a demo chip (ISC-149.1); the entries
    // carry no image, so no <img> appears. Spec 066 T10: the cover left the head for the tile's preview track.
    const heads = [...root.querySelectorAll('app-ws-identity[data-tile-block="head"]')];
    expect(heads.map((head) => head.closest('[data-ui="workspace-column"]')?.getAttribute('data-ws'))).toEqual(['harbor', 'lantern']);
    expect(root.querySelector('[data-demo], [data-demo-chip]')).toBeNull();
    expect(root.querySelectorAll('[data-ws-badge]').length).toBe(heads.length);
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

  // spec 066 T12 (ISC-516): one card per tile with the accent edge and no glow; inside, the four blocks in a fixed order
  it('frames each tile in one ui-card with the edge and no glow, holding head, preview, list and kpi in that order', async () => {
    const { root } = await render([entry('harbor'), entry('lantern')]);
    for (const ws of ['harbor', 'lantern']) {
      const tile = root.querySelector(`.overview [data-ui="workspace-column"][data-ws="${ws}"]`);
      // No part of the tile is a mock any more (ISC-149.1): no `[data-demo]` root.
      expect(tile?.hasAttribute('data-demo')).toBe(false);
      const cards = [...(tile?.querySelectorAll('ui-card') ?? [])];
      expect(cards.length).toBe(1);
      expect(cards[0]?.hasAttribute('data-edge')).toBe(true);
      expect(cards[0]?.hasAttribute('data-glow')).toBe(false);
      const blocks = [...(tile?.querySelectorAll('[data-tile-block]') ?? [])].map((el) => el.getAttribute('data-tile-block'));
      expect(blocks).toEqual(['head', 'preview', 'list', 'kpi']);
      expect(tile?.querySelector('[data-tile-block="preview"] ui-ws-cover[data-shape="tile"][data-ws-cover]')).not.toBeNull();
      expect(tile?.querySelector('[data-tile-block="preview"] a')?.getAttribute('href')).toBe(`/w/${ws}`);
      expect(tile?.querySelector('[data-tile-block="list"] app-tile-list')).not.toBeNull();
      expect(tile?.querySelector('[data-tile-block="kpi"] app-tile-kpis')).not.toBeNull();
      // The /w/<ws> blocks and the old 2 × 2 card strip are gone from `/`.
      expect(tile?.querySelector('ui-waits-block, ui-working-block, [data-ui="kpi-strip"], [data-lists]')).toBeNull();
    }
  });

  // spec 024: overview without lists (principal 2026-10-13); spec 066: the only spec links and chips sit in the list area
  it('shows no Next up, no spec list and no open link; head and preview lead to the workspace', async () => {
    const { root } = await render([entry('harbor'), entry('lantern')]);
    for (const ws of ['harbor', 'lantern']) {
      const column = root.querySelector(`.overview [data-ws="${ws}"]`);
      expect(column).not.toBeNull();
      expect(column?.querySelector('.next, .next-row, [data-next], .dense-list, .d-row, a.open-link, ui-empty-state')).toBeNull();
      expect(text(column)).not.toContain('Next up');
      const outside = (selector: string) => [...(column?.querySelectorAll(selector) ?? [])].filter((el) => !el.closest('app-tile-list'));
      expect(outside('ui-command-chip, a[href*="/s/"]')).toEqual([]);
      expect(outside('a[href]').map((link) => link.getAttribute('href'))).toEqual([`/w/${ws}`, `/w/${ws}`, `/w/${ws}`]);
    }
    expect(root.querySelector('[data-footer-note]')).not.toBeNull();
  });

  // spec 066 T12 (ISC-518): the list block renders the tile list, three rows, "Show all n" past three
  // spec 070 (ISC-568): harbor's seven waiting items stand as four entries, one per spec, so the count reads 4
  it('puts the tile list in the list block: three waiting rows of four, one per spec, and "Show all" to the workspace', async () => {
    const { root } = await render([entry('harbor'), entry('lantern')]);
    const list = root.querySelector('.overview [data-ws="harbor"] [data-tile-block="list"] app-tile-list');
    const waits = harbor.guidance.waits;
    expect(waits.map((e) => e.spec)).toEqual(['006', '002', '005', '004']);
    expect(text(list?.querySelector('[data-tile-count="waits"]'))).toMatch(/\b4$/);
    expect(text(list?.querySelector('[data-tile-count="working"]'))).toMatch(/\b0$/);
    const rows = [...(list?.querySelectorAll('li[data-tile-row]') ?? [])];
    expect(rows.map((row) => row.getAttribute('data-kind'))).toEqual(['waiting', 'waiting', 'waiting']);
    expect(rows.map((row) => row.getAttribute('data-id'))).toEqual(waits.slice(0, 3).map((e) => e.spec));
    expect(list?.querySelector('a[data-tile-more]')?.getAttribute('href')).toBe('/w/harbor');
  });

  // spec 064 (ISC-461), spec 066: a held claim is a working row, first in the list block
  it('puts a held claim first in the list block as a working row', async () => {
    const { root } = await render([entry('harbor'), entry('lantern')], { harbor: harborLocked, lantern });
    const list = root.querySelector('.overview [data-ws="harbor"] [data-tile-block="list"] app-tile-list');
    const first = list?.querySelector('li[data-tile-row]');
    expect(first?.getAttribute('data-kind')).toBe('working');
    expect(first?.getAttribute('data-id')).toBe('004');
    expect(text(first?.querySelector('[data-title]'))).toBe(titleOf('004'));
    expect(root.querySelector('ui-working-block')).toBeNull();
  });

  // spec 064 T20 (ISC-462): without a held claim no working row, in either workspace
  it('ISC-462: no In Arbeit row without a held claim', async () => {
    expect([...harbor.specs, ...lantern.specs].every((row) => row.taken.length === 0)).toBe(true);
    const { root } = await render([entry('harbor'), entry('lantern')]);
    for (const ws of ['harbor', 'lantern']) {
      const column = root.querySelector(`.overview [data-ws="${ws}"]`);
      expect(column?.querySelector('[data-tile-block="list"] app-tile-list')).not.toBeNull();
      expect(column?.querySelector('li[data-kind="working"], ui-working-block')).toBeNull();
    }
  });

  it('says in one line that nothing waits when the workspace has no entry', async () => {
    const { root } = await render([entry('lantern')]);
    const list = root.querySelector('[data-ws="lantern"] [data-tile-block="list"]');
    expect(text(list?.querySelector('[data-tile-empty]'))).toBe('Nothing is waiting on you.');
    expect(list?.querySelector('li[data-tile-row], a[data-tile-more], ui-command-chip')).toBeNull();
  });

  // spec 066 T14 (ISC-517): the unreadable tile in the same frame and blocks, the notice in the list block, "—" as kpi
  it('shows an unreadable workspace in the same frame: the notice in the list block, "—" in the kpi block, no dashboard', async () => {
    const { root, asked } = await render([entry('harbor'), entry('broken', false, 'permission denied')]);
    const tile = root.querySelector('[data-ui="workspace-column"][data-ws="broken"]');
    expect(tile?.hasAttribute('aria-busy')).toBe(false);
    expect(tile?.querySelectorAll('ui-card').length).toBe(1);
    expect(tile?.querySelector('ui-card')?.hasAttribute('data-edge')).toBe(true);
    expect(tile?.querySelector('ui-card')?.hasAttribute('data-glow')).toBe(false);
    const blocks = [...(tile?.querySelectorAll('[data-tile-block]') ?? [])].map((el) => el.getAttribute('data-tile-block'));
    expect(blocks).toEqual(['head', 'preview', 'list', 'kpi']);
    expect(text(tile?.querySelector('[data-tile-block="head"] h2'))).toBe('broken');
    const notice = tile?.querySelector('[data-tile-block="list"] ui-notice');
    expect(notice).not.toBeNull();
    expect(text(notice)).toContain('permission denied');
    expect(text(tile?.querySelector('[data-tile-block="kpi"]'))).toBe('—');
    expect(tile?.querySelector('app-tile-list, app-tile-kpis')).toBeNull();
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

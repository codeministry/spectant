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

async function render(list: readonly WorkspaceListEntry[] | 'error'): Promise<{ root: HTMLElement; asked: string[] }> {
  const asked: string[] = [];
  const api = {
    workspaces: () => Promise.resolve(list === 'error' ? ({ kind: 'error', status: 0 } as const) : ok(list)),
    dashboard: (slug: string) => {
      asked.push(slug);
      return Promise.resolve(ok(BODIES[slug] ?? {}));
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
      expect(column?.querySelector('.next, .next-row, [data-next], .dense-list, .d-row, a.open-link, ui-command-chip, ui-empty-state')).toBeNull();
      expect(text(column)).not.toContain('Next up');
      expect(column?.querySelector('a[href*="/s/"]')).toBeNull();
      const links = [...(column?.querySelectorAll('a[href]') ?? [])];
      expect(links.map((link) => link.getAttribute('href'))).toEqual([`/w/${ws}`, `/w/${ws}`]);
      expect(column?.querySelector('a [data-ws-cover]')).not.toBeNull();
      expect(column?.querySelector('.ws-head a h2')).not.toBeNull();
    }
    expect(root.querySelector('[data-footer-note]')).not.toBeNull();
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
    const empty = root.querySelector('ui-empty-state');
    expect(text(empty)).toContain('Add your first workspace');
    expect(empty?.querySelector('ui-command-chip')).not.toBeNull();
  });

  it('says so when the workspace list cannot be loaded', async () => {
    const { root } = await render('error');
    expect(root.querySelector('ui-notice')).not.toBeNull();
    expect(root.querySelector('[data-ui="workspace-column"]')).toBeNull();
  });
});

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
    expect(text(root.querySelector('[data-overview-eyebrow]'))).toBe('All workspaces · 2');
    expect(root.querySelector('h1')).not.toBeNull();
    const columns = [...root.querySelectorAll('.overview [data-ui="workspace-column"]')];
    expect(columns.map((c) => c.getAttribute('data-ws'))).toEqual(['harbor', 'lantern']);
    expect([...asked].sort()).toEqual(['harbor', 'lantern']);
    expect(root.querySelector('.ws-cover, img')).toBeNull();
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
    expect(text(master?.querySelector('.val'))).toBe('101/124');
    const claims = h?.querySelector('[data-kpi="claims"]');
    expect(text(claims?.querySelector('.val'))).toBe('55/78');
    expect(claims?.querySelector('ui-meter')).not.toBeNull();
    const specs = h?.querySelector('[data-kpi="specs"]');
    expect(text(specs?.querySelector('.val'))).toBe('5');
    expect(specs?.querySelector('ui-meter')).not.toBeNull();
    const warnings = h?.querySelector('[data-kpi="warnings"]');
    expect(text(warnings?.querySelector('.val'))).toBe('7');
    expect(text(warnings?.querySelector('.meta'))).toBe('Open fog · 4');
    expect(warnings?.hasAttribute('data-edge')).toBe(true);
    expect(strip('lantern')?.querySelector('[data-kpi="warnings"]')?.hasAttribute('data-edge')).toBe(false);
  });

  it('lists up to three Next up rows with their command chips, the dense spec list and the open link', async () => {
    const { root } = await render([entry('harbor')]);
    const column = root.querySelector('[data-ws="harbor"]');
    const next = [...(column?.querySelectorAll('.next-row') ?? [])];
    expect(next.map((row) => row.getAttribute('data-next'))).toEqual(['004', '005', '006']);
    expect(next[0]?.querySelector('ui-command-chip')).not.toBeNull();
    const rows = [...(column?.querySelectorAll('.dense-list .d-row') ?? [])];
    expect(rows.map((row) => text(row.querySelector('.id')))).toEqual(['004', '005', '006', '002', '003']);
    expect(rows[0]?.getAttribute('href')).toBe('/w/harbor/s/004');
    expect(text(rows[0]?.querySelector('ui-chip'))).toBe('building');
    const open = column?.querySelector('a.open-link');
    expect(text(open)).toBe('Open harbor →');
    expect(open?.getAttribute('href')).toBe('/w/harbor');
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

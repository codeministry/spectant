import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { ClaimGlyphState, ClaimView, ClaimViewModel } from '../../../../../core/src/files';
import { ApiClient, type ApiResult, type DashboardBody } from '../../core/api.service';
import { RefreshService } from '../../core/refresh.service';
import { ShellData } from '../shell/shell-data.service';
import { ShellState } from '../shell/shell-state.service';
import { CLAIM_LOAD_CONCURRENCY, OTHERS_WAIT_MS, PaletteIndex } from './palette-index';

const ok = <T>(body: T): ApiResult<T> => ({ kind: 'ok', body, etag: null, notModified: false });
const claim = (id: string, text: string, state: ClaimGlyphState): ClaimView => ({ id, text, state }) as unknown as ClaimView;
const model = (claims: readonly ClaimView[]): ClaimViewModel => ({ claims }) as unknown as ClaimViewModel;
const dashboard = (closed: number, extra = 0): DashboardBody => ({
    specs: [
      { id: '001', title: 'One', progress: { closed } },
      { id: '002', title: 'Two' },
      ...Array.from({ length: extra }, (_, i) => ({ id: `1${String(i).padStart(2, '0')}`, title: 'Extra' })),
    ],
    archive: [{ id: '000', title: 'Old', archived: '2026-09-01' }],
});

/** The claims every spec of the fixture answers with; `002` of lantern fails. */
const CLAIMS: Readonly<Partial<Record<string, readonly ClaimView[]>>> = {
  'harbor/001': [claim('ISC-1', 'first claim', 'closed'), claim('ISC-2', 'second claim', 'open')],
  'harbor/002': [claim('ISC-126', 'the mirror token restart', 'taken')],
  'harbor/000': [claim('ISC-9', 'archived claim', 'dropped')],
  'lantern/001': [claim('ISC-40', 'lantern claim', 'blocked')],
  'lantern/000': [],
};

/** `extra` adds readable workspaces after lantern; a dashboard read of a `held` one waits for `releaseDashboards()`. */
function setUp(open: string | null = 'harbor', options: { extra?: readonly string[]; held?: readonly string[] } = {}) {
  const ws = signal<string | null>(open);
  const current = signal<ApiResult<DashboardBody> | undefined>(ok(dashboard(1)));
  const calls: string[] = [];
  let inFlight = 0;
  let peak = 0;
  const pending: Array<() => void> = [];
  let hold = false;
  const heldDashboards: Array<() => void> = [];
  const api = {
    dashboard: async (slug: string): Promise<ApiResult<DashboardBody>> => {
      if (options.held?.includes(slug) === true) await new Promise<void>((resolve) => heldDashboards.push(resolve));
      return ok(dashboard(slug === 'lantern' ? 5 : 1));
    },
    claims: async (slug: string, id: string): Promise<ApiResult<ClaimViewModel>> => {
      calls.push(`${slug}/${id}`);
      inFlight++;
      peak = Math.max(peak, inFlight);
      if (hold) await new Promise<void>((resolve) => pending.push(resolve));
      await Promise.resolve();
      inFlight--;
      const claims = CLAIMS[`${slug}/${id}`];
      return claims === undefined ? { kind: 'error', status: 500 } : ok(model(claims));
    },
  };
  const data = {
    workspaces: { hasValue: () => true, status: () => 'resolved' },
    planning: { hasValue: () => true, status: () => 'resolved' },
    dashboard: { value: current, hasValue: () => current() !== undefined, status: () => 'resolved' },
    workspaceList: signal(
      ['harbor', 'lantern', ...(options.extra ?? [])].map((slug) => ({ slug, name: slug, readable: true })),
    ),
    workspaceName: (slug: string) => slug,
  };
  TestBed.configureTestingModule({
    providers: [
      { provide: ApiClient, useValue: api },
      { provide: ShellData, useValue: data },
      { provide: ShellState, useValue: { ws } },
      { provide: RefreshService, useValue: { refresh: () => undefined } },
    ],
  });
  return {
    index: TestBed.inject(PaletteIndex),
    current,
    calls,
    peak: () => peak,
    holdReads: (on: boolean) => (hold = on),
    release: () => pending.splice(0).forEach((resolve) => resolve()),
    releaseDashboards: () => heldDashboards.splice(0).forEach((resolve) => resolve()),
  };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  TestBed.tick();
}

describe('PaletteIndex.claimsFor (T3 · ISC-139)', () => {
  it('loads nothing before the first call, then every claim of every spec of the workspace in order', async () => {
    const { index, calls } = setUp();
    await settle();
    expect(calls).toEqual([]);

    const claims = index.claimsFor('harbor');
    await settle();
    expect([...calls].sort()).toEqual(['harbor/000', 'harbor/001', 'harbor/002']);
    expect(claims()).toEqual([
      { ws: 'harbor', specId: '001', isc: 'ISC-1', text: 'first claim', status: 'closed' },
      { ws: 'harbor', specId: '001', isc: 'ISC-2', text: 'second claim', status: 'open' },
      { ws: 'harbor', specId: '002', isc: 'ISC-126', text: 'the mirror token restart', status: 'taken' },
      { ws: 'harbor', specId: '000', isc: 'ISC-9', text: 'archived claim', status: 'dropped' },
    ]);
  });

  it('caches per session: the same signal, and an unchanged dashboard reloads no claims', async () => {
    const { index, current, calls } = setUp();
    const claims = index.claimsFor('harbor');
    await settle();
    expect(index.claimsFor('harbor')).toBe(claims);
    expect(calls).toHaveLength(3);

    // A live refresh that brings an equal body (a new object, the same rows) is not a change.
    current.set(ok(dashboard(1)));
    await settle();
    expect(calls).toHaveLength(3);
    expect(claims()).toHaveLength(4);
  });

  it('reloads when the workspace dashboard live-updates, keeping the last list while it loads', async () => {
    const { index, current, calls, holdReads, release } = setUp();
    const claims = index.claimsFor('harbor');
    await settle();
    const before = claims();
    expect(before).toHaveLength(4);

    holdReads(true);
    current.set(ok(dashboard(2)));
    await settle();
    expect(calls).toHaveLength(6);
    expect(claims()).toBe(before);

    holdReads(false);
    release();
    await settle();
    expect(claims()).toEqual(before);
    expect(claims()).not.toBe(before);
  });

  it('reads null for another workspace until the palette wants the index, then loads it; a failed spec is left out', async () => {
    const { index, calls } = setUp();
    const lantern = index.claimsFor('lantern');
    await settle();
    expect(lantern()).toBeNull();
    expect(calls).toEqual([]);

    index.want();
    await settle();
    expect([...calls].sort()).toEqual(['lantern/000', 'lantern/001', 'lantern/002']);
    expect(lantern()).toEqual([{ ws: 'lantern', specId: '001', isc: 'ISC-40', text: 'lantern claim', status: 'blocked' }]);
  });

  it('may be called from a computed, and caps the reads in flight', async () => {
    const { index, current, peak, calls } = setUp();
    current.set(ok(dashboard(1, 12)));
    const count = computed(() => index.claimsFor('harbor')()?.length ?? -1);
    expect(count()).toBe(-1);
    await settle();
    expect(count()).toBe(4);
    expect(calls).toHaveLength(15);
    expect(peak()).toBe(CLAIM_LOAD_CONCURRENCY);
  });
});

/** Spec 057 (ISC-373, review 024): one workspace that does not answer holds back no other workspace's entries. */
describe('PaletteIndex.workspaces and settled (spec 057 · ISC-373)', () => {
  const slugs = (index: PaletteIndex): string[] => index.workspaces().map((ws) => ws.slug);
  const waitOut = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, OTHERS_WAIT_MS + 20));
  // The template reads `settled` on every change, which starts the claim loads it waits on; a test reads it, then lets
  // them land.
  const drawn = async (index: PaletteIndex): Promise<boolean> => {
    index.settled();
    await settle();
    return index.settled();
  };

  it('palette progressive: of two other workspaces, the answering one is listed and drawn while the other never answers', async () => {
    const { index, releaseDashboards } = setUp('harbor', { extra: ['beacon'], held: ['beacon'] });
    index.want();
    await settle();
    expect(slugs(index)).toEqual(['harbor', 'lantern']);
    expect(index.workspaces()[1]?.specs.map((row) => row.id)).toEqual(['001', '002']);

    await waitOut();
    expect(await drawn(index)).toBe(true);
    expect(index.claimsFor('lantern')()).toEqual([{ ws: 'lantern', specId: '001', isc: 'ISC-40', text: 'lantern claim', status: 'blocked' }]);

    // The late one joins the list in list order when it answers, and the drawn list stays drawn.
    releaseDashboards();
    await settle();
    expect(slugs(index)).toEqual(['harbor', 'lantern', 'beacon']);
    expect(index.settled()).toBe(true);
  });

  it('palette progressive: when every workspace answers at once the list is drawn complete, before the wait runs out', async () => {
    const { index } = setUp('harbor', { extra: ['beacon'] });
    expect(index.settled()).toBe(false);
    index.want();
    await settle();
    expect(slugs(index)).toEqual(['harbor', 'lantern', 'beacon']);
    expect(await drawn(index)).toBe(true);
  });
});

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ApplicationRef, DOCUMENT, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslocoService } from '@jsverse/transloco';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { specRoutes, type LiveUpdate } from '../../../../server/src/spec-routes.contract';
import { ShellData } from '../layout/shell/shell-data.service';
import { ShellState } from '../layout/shell/shell-state.service';
import { ApiClient, dashboardUrl, planningUrl, WORKSPACES_URL } from './api.service';
import { LiveStreamService } from './live-stream.service';
import { diffDashboards, FALLBACK_POLL_MS, RefreshService } from './refresh.service';

const body = (closed: number, specs: ReadonlyArray<{ id: string; stage: string }>): unknown => ({
  kpis: { specs: specs.length, claims: { closed, total: 78 } },
  specs,
});

describe('diffDashboards', () => {
  it('names the changed KPI paths, the changed rows by id and the specs that are new', () => {
    const before = body(55, [{ id: '001', stage: 'plan' }, { id: '002', stage: 'build' }]);
    const after = body(56, [{ id: '001', stage: 'plan' }, { id: '002', stage: 'done' }, { id: '003', stage: 'plan' }]);
    expect(diffDashboards(before, after)).toEqual({
      kpis: ['claims.closed', 'specs'],
      rows: ['002'],
      added: ['003'],
    });
  });

  it('reports nothing for an equal body and treats a first body as no change', () => {
    const same = body(55, [{ id: '001', stage: 'plan' }]);
    expect(diffDashboards(same, structuredClone(same))).toEqual({ kpis: [], rows: [], added: [] });
    expect(diffDashboards(null, same)).toEqual({ kpis: [], rows: [], added: [] });
  });
});

describe('RefreshService', () => {
  const dashboardValue = signal<unknown>(undefined);
  const dashboardStatus = signal<'idle' | 'loading' | 'reloading' | 'resolved'>('resolved');
  const workspacesStatus = signal<'idle' | 'loading' | 'reloading' | 'resolved'>('resolved');
  const reloads = { workspaces: vi.fn(), dashboard: vi.fn(), planning: vi.fn(), spec: vi.fn() };
  const connected = signal(false);
  const listeners = new Set<(update: LiveUpdate) => void>();
  const push = (update: LiveUpdate): void => listeners.forEach((listener) => listener(update));
  const onUpdate = (listener: (update: LiveUpdate) => void): (() => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  const prime = vi.fn();
  const ws = signal<string | null>('harbor');
  const specId = signal<string | null>('002');
  let visibility: DocumentVisibilityState = 'visible';

  beforeEach(() => {
    vi.useFakeTimers();
    Object.values(reloads).forEach((fn) => fn.mockClear());
    prime.mockClear();
    dashboardValue.set({ kind: 'ok', body: body(55, [{ id: '001', stage: 'plan' }]) });
    dashboardStatus.set('resolved');
    workspacesStatus.set('resolved');
    connected.set(false);
    listeners.clear();
    ws.set('harbor');
    specId.set('002');
    visibility = 'visible';
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
    TestBed.configureTestingModule({
      providers: [
        { provide: DOCUMENT, useValue: document },
        { provide: TranslocoService, useValue: { translate: (key: string, params?: object) => `${key} ${JSON.stringify(params ?? {})}` } },
        {
          provide: ShellData,
          useValue: {
            workspaces: { reload: reloads.workspaces, status: workspacesStatus },
            dashboard: { reload: reloads.dashboard, value: dashboardValue, status: dashboardStatus },
            planning: { reload: reloads.planning },
            spec: { reload: reloads.spec },
          },
        },
        { provide: ShellState, useValue: { ws, specId } },
        { provide: ApiClient, useValue: { prime } },
        { provide: LiveStreamService, useValue: { connected, onUpdate } },
      ],
    });
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('polls as the fallback every 60 s while the stream is disconnected and the page is visible, not at 59 s (spec 053, ISC-317)', () => {
    expect(FALLBACK_POLL_MS).toBe(60_000);
    TestBed.inject(RefreshService);
    TestBed.tick();
    vi.advanceTimersByTime(59_000);
    expect(reloads.dashboard).not.toHaveBeenCalled();
    vi.advanceTimersByTime(999);
    expect(reloads.dashboard).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(reloads.workspaces).toHaveBeenCalledTimes(1);
    expect(reloads.dashboard).toHaveBeenCalledTimes(1);
    expect(reloads.planning).toHaveBeenCalledTimes(1);
    expect(reloads.spec).toHaveBeenCalledTimes(1);
  });

  it('counts each refresh for the page resources outside the shell (the library), never a settled dashboard read', () => {
    const service = TestBed.inject(RefreshService);
    TestBed.tick();
    expect(service.refreshes()).toBe(0);
    dashboardStatus.set('reloading');
    TestBed.tick();
    dashboardStatus.set('resolved');
    TestBed.tick();
    expect(service.refreshes()).toBe(0);
    vi.advanceTimersByTime(60_000);
    expect(service.refreshes()).toBe(1);
    service.refresh();
    expect(service.refreshes()).toBe(2);
  });

  it('skips the timer while the page is hidden and refreshes when it becomes visible again', () => {
    TestBed.inject(RefreshService);
    TestBed.tick();
    visibility = 'hidden';
    vi.advanceTimersByTime(60_000);
    expect(reloads.dashboard).not.toHaveBeenCalled();
    visibility = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
    expect(reloads.dashboard).toHaveBeenCalledTimes(1);
  });

  it('marks the changes of one refresh and announces them once', () => {
    const service = TestBed.inject(RefreshService);
    TestBed.tick();
    service.refresh();
    dashboardValue.set({ kind: 'ok', body: body(56, [{ id: '001', stage: 'plan' }, { id: '004', stage: 'plan' }]) });
    TestBed.tick();
    expect([...service.changedKpis()]).toEqual(['claims.closed', 'specs']);
    expect(service.newSpecs()).toBe(1);
    expect(service.changedRows().has('004')).toBe(false);
    const first = service.announcement();
    expect(first).toContain('refresh.announcement');
    dashboardValue.set({ kind: 'ok', body: body(56, [{ id: '001', stage: 'plan' }, { id: '004', stage: 'plan' }]) });
    TestBed.tick();
    expect(service.announcement()).toBe(first);
  });

  it('sets lastRefresh after response, never when the refresh starts (spec 057, ISC-370)', () => {
    const service = TestBed.inject(RefreshService);
    TestBed.tick();
    vi.advanceTimersByTime(5_000);
    const before = service.lastRefresh();
    service.refresh();
    dashboardStatus.set('reloading');
    TestBed.tick();
    vi.advanceTimersByTime(3_000);
    TestBed.tick();
    expect(service.lastRefresh()).toBe(before);
    const answered = Date.now();
    dashboardValue.set({ kind: 'ok', body: body(56, [{ id: '001', stage: 'plan' }]) });
    dashboardStatus.set('resolved');
    TestBed.tick();
    expect(service.lastRefresh()).toBe(answered);
  });

  it('sets lastRefresh after response on the start page, where the dashboard stays idle (spec 057, ISC-370)', () => {
    dashboardStatus.set('idle');
    const service = TestBed.inject(RefreshService);
    TestBed.tick();
    vi.advanceTimersByTime(5_000);
    const before = service.lastRefresh();
    service.refresh();
    workspacesStatus.set('reloading');
    TestBed.tick();
    expect(service.lastRefresh()).toBe(before);
    const answered = Date.now();
    workspacesStatus.set('resolved');
    TestBed.tick();
    expect(service.lastRefresh()).toBe(answered);
  });

  // ─── Spec 030 (T15, ISC-28): the live update stream is the primary path, the poll the fallback ──────────────────

  describe('on the live update stream (spec 030, T15, ISC-28)', () => {
    const DASHBOARD = dashboardUrl('harbor');
    const PLANNING = planningUrl('harbor');
    /** A stream frame as the server builds it: read route paths, their ETags and bodies. */
    const frame = (slug: string, paths: readonly string[]): LiveUpdate => ({
      ws: slug,
      views: paths.map((path, index) => ({ path, etag: `"u${String(index)}"`, body: { path } })),
    });
    const OPEN = [WORKSPACES_URL, DASHBOARD, PLANNING, specRoutes.spec('harbor', '002')];

    it('primes every view of an update into the ApiClient cache under its path, etag and body', () => {
      TestBed.inject(RefreshService);
      TestBed.tick();
      const update = frame('harbor', OPEN);
      push(update);
      TestBed.tick();
      expect(prime.mock.calls).toEqual(update.views.map((view) => [view.path, view.etag, view.body]));
    });

    it('reloads the open workspace\'s shell resources through that cache and counts it as a refresh', () => {
      const service = TestBed.inject(RefreshService);
      TestBed.tick();
      vi.advanceTimersByTime(5_000);
      const before = service.lastRefresh();
      push(frame('harbor', OPEN));
      dashboardStatus.set('reloading');
      TestBed.tick();
      dashboardStatus.set('resolved');
      TestBed.tick();
      expect(reloads.workspaces).toHaveBeenCalledTimes(1);
      expect(reloads.dashboard).toHaveBeenCalledTimes(1);
      expect(reloads.planning).toHaveBeenCalledTimes(1);
      expect(reloads.spec).toHaveBeenCalledTimes(1);
      expect(service.refreshes()).toBe(1);
      expect(service.lastRefresh()).toBeGreaterThan(before);
    });

    it('reloads the open spec also when no spec view matches its path (the route names it by folder or slug)', () => {
      specId.set('002-web-console');
      TestBed.inject(RefreshService);
      TestBed.tick();
      push(frame('harbor', [DASHBOARD, specRoutes.spec('harbor', '002')]));
      TestBed.tick();
      expect(reloads.spec).toHaveBeenCalledTimes(1);
    });

    it('marks the changed rows and KPIs of an update as a poll does', () => {
      const service = TestBed.inject(RefreshService);
      TestBed.tick();
      push(frame('harbor', [DASHBOARD]));
      TestBed.tick();
      dashboardStatus.set('reloading');
      TestBed.tick();
      dashboardValue.set({ kind: 'ok', body: body(56, [{ id: '001', stage: 'build' }]) });
      dashboardStatus.set('resolved');
      TestBed.tick();
      expect([...service.changedRows()]).toEqual(['001']);
      expect([...service.changedKpis()]).toEqual(['claims.closed']);
    });

    it('for another workspace primes the cache and reloads only the workspace list, never the open workspace\'s resources', () => {
      const service = TestBed.inject(RefreshService);
      TestBed.tick();
      const update = frame('beacon', [WORKSPACES_URL, dashboardUrl('beacon'), planningUrl('beacon')]);
      push(update);
      TestBed.tick();
      expect(prime).toHaveBeenCalledTimes(update.views.length);
      expect(reloads.workspaces).toHaveBeenCalledTimes(1);
      expect(reloads.dashboard).not.toHaveBeenCalled();
      expect(reloads.planning).not.toHaveBeenCalled();
      expect(reloads.spec).not.toHaveBeenCalled();
      expect(service.refreshes()).toBe(0);
    });

    it('rests the interval timer while the stream is connected, even 10 min long, and runs it again once it drops (spec 053, ISC-318)', () => {
      connected.set(true);
      TestBed.inject(RefreshService);
      TestBed.tick();
      vi.advanceTimersByTime(10 * 60_000);
      expect(reloads.dashboard).not.toHaveBeenCalled();
      connected.set(false);
      TestBed.tick();
      vi.advanceTimersByTime(FALLBACK_POLL_MS - 1);
      expect(reloads.dashboard).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(reloads.dashboard).toHaveBeenCalledTimes(1);
    });

    it('refreshes once when the stream reconnects, never on its first open', () => {
      TestBed.inject(RefreshService);
      TestBed.tick();
      connected.set(true);
      TestBed.tick();
      expect(reloads.dashboard).not.toHaveBeenCalled();
      connected.set(false);
      TestBed.tick();
      connected.set(true);
      TestBed.tick();
      expect(reloads.dashboard).toHaveBeenCalledTimes(1);
    });
  });
});

describe('RefreshService over the real ShellData and ApiClient (spec 030, T15, ISC-28)', () => {
  const connected = signal(true);
  const listeners = new Set<(update: LiveUpdate) => void>();
  const push = (update: LiveUpdate): void => listeners.forEach((listener) => listener(update));
  const onUpdate = (listener: (update: LiveUpdate) => void): (() => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  const ws = signal<string | null>('harbor');
  const specId = signal<string | null>('002');
  const DASHBOARD = dashboardUrl('harbor');
  const PLANNING = planningUrl('harbor');
  const SPEC = specRoutes.spec('harbor', '002');
  const specBody = (stage: string): unknown => ({ id: '002', stage, areas: { live: null } });
  let http: HttpTestingController;

  beforeEach(() => {
    connected.set(true);
    listeners.clear();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: TranslocoService, useValue: { translate: (key: string) => key } },
        { provide: ShellState, useValue: { ws, specId } },
        { provide: LiveStreamService, useValue: { connected, onUpdate } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
  });

  /** Answers every request in flight: a 200 with ETag `"p0"` from `bodies`, `{}` for a path it does not name. */
  const answerAll = (bodies: Readonly<Record<string, unknown>>): void => {
    for (const request of http.match(() => true)) request.flush(bodies[request.request.url] ?? {}, { headers: { ETag: '"p0"' } });
  };
  const settled = async (): Promise<void> => {
    await TestBed.inject(ApplicationRef).whenStable();
    TestBed.tick();
  };

  it('after an update the reads go out with If-None-Match set to its ETags, and a 304 renders the update\'s bodies', async () => {
    const data = TestBed.inject(ShellData);
    const service = TestBed.inject(RefreshService);
    TestBed.tick();
    answerAll({
      [WORKSPACES_URL]: [],
      [DASHBOARD]: body(55, [{ id: '001', stage: 'plan' }, { id: '002', stage: 'build' }]),
      [PLANNING]: { stages: [] },
      [SPEC]: specBody('build'),
    });
    await settled();

    const after = body(56, [{ id: '001', stage: 'plan' }, { id: '002', stage: 'done' }]);
    const update: LiveUpdate = {
      ws: 'harbor',
      views: [
        { path: WORKSPACES_URL, etag: '"w1"', body: [] },
        { path: DASHBOARD, etag: '"d1"', body: after },
        { path: PLANNING, etag: '"p1"', body: { stages: ['done'] } },
        { path: SPEC, etag: '"s1"', body: specBody('done') },
      ],
    };
    push(update);
    TestBed.tick();
    for (const view of update.views) {
      const request = http.expectOne(view.path);
      expect(request.request.headers.get('If-None-Match')).toBe(view.etag);
      request.flush(null, { status: 304, statusText: 'Not Modified' });
    }
    await settled();

    expect(data.dashboard.value()).toEqual({ kind: 'ok', body: after, etag: '"d1"', notModified: true });
    expect(data.planning.value()).toEqual({ kind: 'ok', body: { stages: ['done'] }, etag: '"p1"', notModified: true });
    expect(data.spec.value()).toEqual({ kind: 'ok', body: specBody('done'), etag: '"s1"', notModified: true });
    expect([...service.changedRows()]).toEqual(['002']);
    expect([...service.changedKpis()]).toEqual(['claims.closed']);
    expect(service.refreshes()).toBe(1);
  });
});

import { DOCUMENT, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslocoService } from '@jsverse/transloco';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ShellData } from '../layout/shell/shell-data.service';
import { diffDashboards, RefreshService } from './refresh.service';
import { DEFAULT_SETTINGS, SettingsService } from './settings.service';

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
  const reloads = { workspaces: vi.fn(), dashboard: vi.fn(), planning: vi.fn(), spec: vi.fn() };
  const settings = signal({ ...DEFAULT_SETTINGS, refreshSeconds: 10 });
  let visibility: DocumentVisibilityState = 'visible';

  beforeEach(() => {
    vi.useFakeTimers();
    Object.values(reloads).forEach((fn) => fn.mockClear());
    dashboardValue.set({ kind: 'ok', body: body(55, [{ id: '001', stage: 'plan' }]) });
    visibility = 'visible';
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
    TestBed.configureTestingModule({
      providers: [
        { provide: DOCUMENT, useValue: document },
        { provide: SettingsService, useValue: { settings } },
        { provide: TranslocoService, useValue: { translate: (key: string, params?: object) => `${key} ${JSON.stringify(params ?? {})}` } },
        {
          provide: ShellData,
          useValue: {
            workspaces: { reload: reloads.workspaces },
            dashboard: { reload: reloads.dashboard, value: dashboardValue, status: dashboardStatus },
            planning: { reload: reloads.planning },
            spec: { reload: reloads.spec },
          },
        },
      ],
    });
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('reloads every shell resource in place when the interval of settings.refreshSeconds elapses', () => {
    TestBed.inject(RefreshService);
    TestBed.tick();
    vi.advanceTimersByTime(9_999);
    expect(reloads.dashboard).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(reloads.workspaces).toHaveBeenCalledTimes(1);
    expect(reloads.dashboard).toHaveBeenCalledTimes(1);
    expect(reloads.planning).toHaveBeenCalledTimes(1);
    expect(reloads.spec).toHaveBeenCalledTimes(1);
  });

  it('skips the timer while the page is hidden and refreshes when it becomes visible again', () => {
    TestBed.inject(RefreshService);
    TestBed.tick();
    visibility = 'hidden';
    vi.advanceTimersByTime(10_000);
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
});

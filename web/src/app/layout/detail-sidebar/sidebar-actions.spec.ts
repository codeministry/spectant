import { signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import type { ItemStateInfo, Workflow, WorkflowStage } from '../../../../../core/src/files';
import type { Relation, RelationRef } from '../../../../../core/src/relations';
import { DEFAULT_WORKFLOW, WORKFLOW_STAGES } from '../../../../../core/src/stage';
import { CATALOGUES, LANGS } from '../../../i18n/catalogues';
import { ApiClient } from '../../core/api.service';
import { dropTargetsOf } from '../../core/model/board';
import { ToastService } from '../../shared/ui/toast/toast';
import { RefreshService } from '../shell/refresh.service';
import { ShellData } from '../shell/shell-data.service';
import { ShellState } from '../shell/shell-state.service';
import { SidebarActions } from './sidebar-actions';

const WORKFLOW: Workflow = { rows: DEFAULT_WORKFLOW, source: 'default', diagnostics: [] };
const HASH = 'a'.repeat(64);
const WRITTEN = 'b'.repeat(64);

const rel = (ref: RelationRef, extra: Partial<Relation> = {}): Relation => {
  const [type, ...rest] = ref.split(':');
  return { ref, type: type as Relation['type'], id: rest.join(':'), title: 'Title', closed: 0, total: 0, parents: [], children: [], blockers: [], ...extra };
};

/** The open run of a spec or story as the API serves it (spec 040). */
const running = (kind: 'spec' | 'idea'): ItemStateInfo =>
  ({
    kind,
    state: 'running',
    command: '/spec tasks 025',
    run: { source: 'run', run: 'r-1', command: '/spec tasks 025', actor: { kind: 'agent', id: 'a:claude:sess-1' }, since: '2026-10-22T10:00:00Z', elapsedMs: 60_000 },
  }) as unknown as ItemStateInfo;

const rowState = signal<ItemStateInfo | null>(null);
const dashboard = signal<unknown>(undefined);
const planningModel = signal<unknown>(undefined);
const transition = vi.fn();
const planningReload = vi.fn();
const dashboardReload = vi.fn();
const toast = vi.fn();

function serve(stage: WorkflowStage = 'build'): void {
  dashboard.set({
    kind: 'ok',
    body: { specs: [{ id: '025', slug: '025-edges', title: 'Title', type: 'feature', stage, ...(rowState() ? { state: rowState() } : {}) }] },
  });
  planningModel.set({
    features: [{ holders: [{ id: '025', slug: '025-edges', stage, hash: HASH, main: true, archived: false }] }],
    milestones: [],
  });
}

function mount(relation: Relation, run: ItemStateInfo | null = null): ComponentFixture<SidebarActions> {
  TestBed.configureTestingModule({
    imports: [
      TranslocoTestingModule.forRoot({
        langs: CATALOGUES,
        translocoConfig: { availableLangs: [...LANGS], defaultLang: 'en' },
        preloadLangs: true,
      }),
    ],
    providers: [
      { provide: ShellState, useValue: { ws: signal('harbor'), tier: signal('medium') } },
      {
        provide: ShellData,
        useValue: {
          workflow: signal(WORKFLOW),
          stages: signal(WORKFLOW_STAGES),
          planningModel,
          dashboard: { value: dashboard, reload: dashboardReload },
          planning: { reload: planningReload },
        },
      },
      { provide: ApiClient, useValue: { transition, activityHash: () => 'h', releaseRun: vi.fn() } },
      { provide: RefreshService, useValue: { refresh: vi.fn() } },
      { provide: ToastService, useValue: { show: toast } },
    ],
  });
  const fixture = TestBed.createComponent(SidebarActions);
  document.body.append(fixture.nativeElement as HTMLElement);
  fixture.componentRef.setInput('relation', relation);
  fixture.componentRef.setInput('running', run);
  fixture.detectChanges();
  return fixture;
}

const $ = (f: ComponentFixture<unknown>, sel: string): HTMLElement | null => (f.nativeElement as HTMLElement).querySelector<HTMLElement>(sel);
const $$ = (f: ComponentFixture<unknown>, sel: string): HTMLElement[] => [...(f.nativeElement as HTMLElement).querySelectorAll<HTMLElement>(sel)];

async function openList(f: ComponentFixture<SidebarActions>): Promise<void> {
  $(f, '[data-stage-change]')?.click();
  f.detectChanges();
  await f.whenStable();
}

const SPEC = rel('spec:025', { stage: 'build' });

describe('SidebarActions (spec 067, T28 ISC-533, T30 ISC-534)', () => {
  beforeEach(() => {
    rowState.set(null);
    transition.mockReset();
    planningReload.mockClear();
    dashboardReload.mockClear();
    toast.mockClear();
    serve();
  });

  it('opens the stage list inline with the board targets enabled and every other stage disabled with its reason', async () => {
    const f = mount(SPEC);
    const toggle = $(f, '[data-stage-change]');
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    expect($(f, '[data-stage-list]')).toBeNull();
    await openList(f);
    expect(toggle?.getAttribute('aria-expanded')).toBe('true');
    expect($(f, '[data-stage-list]')?.id).toBe(toggle?.getAttribute('aria-controls'));
    const entries = $$(f, '[data-move-to]');
    expect(entries.map((e) => e.dataset['moveTo'])).toEqual([...WORKFLOW_STAGES]);
    const enabled = entries.filter((e) => e.getAttribute('aria-disabled') === null).map((e) => e.dataset['moveTo']);
    expect(enabled).toEqual(dropTargetsOf({ kind: 'spec', type: 'feature', stage: 'build' }, WORKFLOW, WORKFLOW_STAGES));
    expect(enabled).toEqual(['blocked', 'code-review']);
    expect($(f, '[data-move-to="build"]')?.getAttribute('aria-current')).toBe('true');
    const plan = $(f, '[data-move-to="plan"]');
    expect(plan?.getAttribute('aria-disabled')).toBe('true');
    expect(plan?.textContent).toContain('not next from Build');
  });

  it('writes once through the transition with the holder hash, toasts, closes, keeps focus and shows the new stage', async () => {
    transition.mockResolvedValue({ kind: 'answer', answer: { status: 200, body: { to: 'code-review', hash: WRITTEN } } });
    const f = mount(SPEC);
    await openList(f);
    $(f, '[data-move-to="plan"]')?.click(); // disabled: nothing sent
    $(f, '[data-move-to="code-review"]')?.click();
    await f.whenStable();
    f.detectChanges();
    expect(transition).toHaveBeenCalledTimes(1);
    expect(transition).toHaveBeenCalledWith('harbor', '025', 'code-review', HASH);
    expect(toast).toHaveBeenCalledWith('025 → Code review');
    expect(planningReload).toHaveBeenCalled();
    expect($(f, '[data-stage-list]')).toBeNull();
    expect(document.activeElement).toBe($(f, '[data-stage-change]'));
    // Before the tree catches up, the list already stands on the new stage (live, no reload).
    await openList(f);
    expect($(f, '[data-move-to="code-review"]')?.getAttribute('aria-current')).toBe('true');
  });

  it('shows the refusal under the entry on a 409 and sends nothing more', async () => {
    transition.mockResolvedValue({ kind: 'answer', answer: { status: 409, body: { error: 'hash-mismatch' } } });
    const f = mount(SPEC);
    await openList(f);
    $(f, '[data-move-to="code-review"]')?.click();
    await f.whenStable();
    f.detectChanges();
    expect(transition).toHaveBeenCalledTimes(1);
    expect(toast).not.toHaveBeenCalled();
    expect($(f, '[data-stage-list]')).not.toBeNull();
    const notice = $(f, '[data-move-to="code-review"]')?.closest('li')?.querySelector('app-refusal-notice');
    expect(notice).not.toBeNull();
    expect(planningReload).toHaveBeenCalledTimes(1);
    $(f, '[data-move-to="plan"]')?.click();
    await f.whenStable();
    expect(transition).toHaveBeenCalledTimes(1);
  });

  it('holds a spec a run holds: every entry disabled, the run notice above the list, and offers the release', async () => {
    rowState.set(running('spec'));
    serve();
    const f = mount(SPEC, running('spec'));
    expect($(f, 'app-run-release')).not.toBeNull();
    expect($(f, '[data-release]')).not.toBeNull();
    expect($(f, '.acts')?.hasAttribute('data-single')).toBe(false);
    await openList(f);
    expect($$(f, '[data-move-to]').every((e) => e.getAttribute('aria-disabled') === 'true')).toBe(true);
    expect($(f, '[data-stage-run]')).not.toBeNull();
    $(f, '[data-move-to="code-review"]')?.click();
    await f.whenStable();
    expect(transition).not.toHaveBeenCalled();
  });

  it('shows the release only with an open run; one action alone takes the full width', () => {
    const f = mount(SPEC);
    expect($(f, 'app-run-release')).toBeNull();
    expect($(f, '.acts')?.hasAttribute('data-single')).toBe(true);
    expect((f.nativeElement as HTMLElement).dataset['count']).toBe('1');
  });

  it('offers a story only the release of its open run, and nothing without one', () => {
    const idea = rel('idea:graph-zoom');
    const f = mount(idea);
    expect((f.nativeElement as HTMLElement).hidden).toBe(true);
    expect($(f, '[data-stage-change]')).toBeNull();
    f.componentRef.setInput('running', running('idea'));
    f.detectChanges();
    expect($(f, '[data-stage-change]')).toBeNull();
    expect($(f, '[data-release]')).not.toBeNull();
    expect($(f, '.acts')?.hasAttribute('data-single')).toBe(true);
  });

  it('offers no stage change for an archived spec', () => {
    const f = mount(rel('spec:025', { stage: 'build', archived: true }));
    expect($(f, '[data-stage-change]')).toBeNull();
  });
});

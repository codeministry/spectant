import { signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import type { ItemStateInfo } from '../../../../../core/src/files';
import type { Relation, RelationRef } from '../../../../../core/src/relations';
import { DEFAULT_WORKFLOW, WORKFLOW_STAGES } from '../../../../../core/src/stage';
import { CATALOGUES, LANGS } from '../../../i18n/catalogues';
import { ApiClient } from '../../core/api.service';
import { ToastService } from '../../shared/ui/toast/toast';
import { RefreshService } from '../shell/refresh.service';
import { ShellData } from '../shell/shell-data.service';
import { ShellState } from '../shell/shell-state.service';
import { SidebarActions } from './sidebar-actions';

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

const transition = vi.fn();

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
        // The board's view of 025 as a stage action read it (spec 067), so a leftover action would render here.
        useValue: {
          workflow: signal({ rows: DEFAULT_WORKFLOW, source: 'default', diagnostics: [] }),
          stages: signal(WORKFLOW_STAGES),
          planningModel: signal({
            features: [{ holders: [{ id: '025', slug: '025-edges', stage: 'build', hash: 'a'.repeat(64), main: true, archived: false }] }],
            milestones: [],
          }),
          dashboard: {
            value: signal({ kind: 'ok', body: { specs: [{ id: '025', slug: '025-edges', title: 'Title', type: 'feature', stage: 'build' }] } }),
            reload: vi.fn(),
          },
          planning: { reload: vi.fn() },
        },
      },
      { provide: ApiClient, useValue: { transition, activityHash: () => 'h', releaseRun: vi.fn() } },
      { provide: RefreshService, useValue: { refresh: vi.fn() } },
      { provide: ToastService, useValue: { show: vi.fn() } },
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
/** Every trace of a stage change the sidebar offered until spec 068 (T15). */
const STAGE_CHANGE = ['[data-stage-change]', '[data-stage-list]', 'ul[ui-stage-targets]'];

const SPEC = rel('spec:025', { stage: 'build' });

describe('SidebarActions (spec 067, T30 ISC-534; spec 068, T16 ISC-548)', () => {
  beforeEach(() => {
    transition.mockReset();
  });

  // Spec 068 (T16, ISC-548): stage changes live on the board only; the sidebar's actions hold none and send none.
  it('offers a spec no stage change and sends no transition, with and without an open run (ISC-548)', async () => {
    for (const run of [null, running('spec')]) {
      const f = mount(SPEC, run);
      const host = f.nativeElement as HTMLElement;
      for (const sel of STAGE_CHANGE) expect(host.querySelectorAll(sel), `${sel}, ${run === null ? 'no run' : 'open run'}`).toHaveLength(0);
      // Every button that is not the release's own (whose dialog sends the release, never a transition).
      for (const button of host.querySelectorAll<HTMLElement>('button')) if (button.closest('app-run-release') === null) button.click();
      f.detectChanges();
      await f.whenStable();
      for (const sel of STAGE_CHANGE) expect(host.querySelectorAll(sel), `${sel}, ${run === null ? 'no run' : 'open run'}`).toHaveLength(0);
      TestBed.resetTestingModule();
    }
    expect(transition).not.toHaveBeenCalled();
  });

  it('hides the actions of a spec without an open run', () => {
    const f = mount(SPEC);
    const host = f.nativeElement as HTMLElement;
    expect(host.hidden).toBe(true);
    expect(host.dataset['count']).toBe('0');
    expect($(f, 'app-run-release')).toBeNull();
  });

  it('offers a spec with an open run the release alone, across the full width', () => {
    const f = mount(SPEC, running('spec'));
    const host = f.nativeElement as HTMLElement;
    expect(host.hidden).toBe(false);
    expect(host.dataset['count']).toBe('1');
    expect($(f, 'app-run-release')).not.toBeNull();
    expect($(f, '[data-release]')).not.toBeNull();
    expect($(f, '.acts')?.hasAttribute('data-single')).toBe(true);
  });

  it('offers a story only the release of its open run, and nothing without one', () => {
    const f = mount(rel('idea:graph-zoom'));
    expect((f.nativeElement as HTMLElement).hidden).toBe(true);
    f.componentRef.setInput('running', running('idea'));
    f.detectChanges();
    expect($(f, '[data-release]')).not.toBeNull();
    expect($(f, '.acts')?.hasAttribute('data-single')).toBe(true);
  });
});

import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslocoService, TranslocoTestingModule } from '@jsverse/transloco';
import type { ActorRef, ItemRun, ItemStateInfo } from '../../../../../../core/src/files';
import { CATALOGUES, LANGS } from '../../../../i18n/catalogues';
import { UiItemState } from './item-state';

// Spec 040, T45 · ISC-224, ISC-225.1: `ui-item-state` shows the five states with every detail the API carries: the
// command to copy for `open`, the waits as links for `waiting`, the locked command, the actor and the duration for
// `running`, start and actor on the warning chip for `aborted`, the date for `done`. The duration comes from
// `run.elapsedMs` in minutes; no own timer, no `aria-live`: the refresh tick re-renders it.

const agent: ActorRef = { raw: 'a:claude:sess-7', kind: 'agent', id: 'a:claude:sess-7', legacy: false };

const run = (extra: Partial<ItemRun> = {}): ItemRun => ({
  run: 'run-1',
  command: '/spec-tasks 037',
  session: 'a:claude:sess-7',
  actor: agent,
  since: '2026-10-17T14:02:00Z',
  elapsedMs: 3 * 60_000 + 5_000,
  openRuns: 1,
  source: 'run',
  ...extra,
});

const item = (extra: Partial<ItemStateInfo>): ItemStateInfo => ({ kind: 'spec', id: '037', state: 'open', stage: 'tasks', ...extra });

const MIN = 60_000;

async function render(info: ItemStateInfo, lang: 'en' | 'de' = 'en') {
  TestBed.inject(TranslocoService).setActiveLang(lang);
  const fixture = TestBed.createComponent(UiItemState);
  fixture.componentRef.setInput('info', info);
  fixture.componentRef.setInput('ws', 'harbor');
  await fixture.whenStable();
  return { fixture, root: fixture.nativeElement as HTMLElement };
}

const text = (el: Element | null): string => (el?.textContent ?? '').replace(/\s+/gu, ' ').trim();
const line = (root: HTMLElement): string => text(root.querySelector('[data-item-line]'));

describe('UiItemState (T45, ISC-224)', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [
        TranslocoTestingModule.forRoot({
          langs: CATALOGUES,
          translocoConfig: { availableLangs: [...LANGS], defaultLang: 'en' },
          preloadLangs: true,
        }),
      ],
      providers: [provideRouter([])],
    });
  });

  it('open: ring glyph, "Tasks · open" and the command as a copyable chip, the reason in the accessible text', async () => {
    const { root } = await render(item({ state: 'open', command: '/spec-tasks 037', reason: 'Plan approved; tasks missing' }));
    expect(root.getAttribute('data-state')).toBe('open');
    expect(root.querySelector('ui-glyph')?.getAttribute('data-shape')).toBe('ring');
    expect(line(root)).toBe('Tasks · open');
    const chip = root.querySelector('ui-command-chip');
    expect(text(chip?.querySelector('code') ?? null)).toBe('/spec-tasks 037');
    expect(chip?.querySelector('[data-locked]')).toBeNull();
    expect(chip?.querySelector('button')?.getAttribute('aria-label')).toBe('Copy /spec-tasks 037');
    expect(text(root)).toContain('Plan approved; tasks missing');
  });

  it('waiting: dotted ring, "Plan · waiting" and each spec it waits on as a link, no command', async () => {
    const { root } = await render(item({ state: 'waiting', stage: 'plan', waits: { specs: ['025'], claims: ['ISC-12'], siblings: [] } }));
    expect(root.querySelector('ui-glyph')?.getAttribute('data-shape')).toBe('dotted-ring');
    expect(line(root)).toBe('Plan · waiting');
    const link = root.querySelector<HTMLAnchorElement>('ui-waits-chip a[data-blocker="025"]');
    expect(link?.getAttribute('href')).toBe('/w/harbor/s/025');
    expect(text(root)).toContain('ISC-12');
    expect(root.querySelector('ui-command-chip')).toBeNull();
  });

  it('running: half glyph, "Tasks · running · since 3 min", the command locked and the agent chip', async () => {
    const { root } = await render(item({ state: 'running', run: run() }));
    expect(root.querySelector('ui-glyph')?.getAttribute('data-shape')).toBe('half');
    expect(line(root)).toBe('Tasks · running · since 3 min');
    const button = root.querySelector('ui-command-chip button');
    expect(button?.hasAttribute('data-locked')).toBe(true);
    expect(button?.getAttribute('aria-disabled')).toBe('true');
    expect(button?.querySelector('ui-icon')?.getAttribute('data-icon')).toBe('lock');
    const name = button?.getAttribute('aria-label') ?? '';
    expect(name).toContain('/spec-tasks 037');
    expect(name).toContain('a:claude:sess-7');
    expect(name).toContain('3 min');
    expect(root.querySelector('ui-actor-chip')?.getAttribute('data-kind')).toBe('agent');
    expect(root.querySelector('[aria-live]')).toBeNull();
    expect(root.querySelector('[data-runs]')).toBeNull();
  });

  it('formats the duration in minutes from elapsedMs, in English and German', async () => {
    const under = await render(item({ state: 'running', run: run({ elapsedMs: 40_000 }) }));
    expect(line(under.root)).toBe('Tasks · running · since < 1 min');
    const hours = await render(item({ state: 'running', run: run({ elapsedMs: 72 * MIN + 30_000 }) }));
    expect(line(hours.root)).toBe('Tasks · running · since 1 h 12 min');
    const de = await render(item({ state: 'running', run: run({ elapsedMs: 72 * MIN }) }), 'de');
    expect(line(de.root)).toBe('Tasks · läuft · seit 1 h 12 min');
    const deUnder = await render(item({ state: 'running', run: run({ elapsedMs: 0 }) }), 'de');
    expect(line(deUnder.root)).toBe('Tasks · läuft · seit < 1 min');
  });

  it('keeps no timer of its own: the duration changes only with the next input (the refresh tick)', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'Date'] });
    try {
      const { fixture, root } = await render(item({ state: 'running', run: run() }));
      vi.advanceTimersByTime(10 * MIN);
      fixture.detectChanges();
      expect(line(root)).toBe('Tasks · running · since 3 min');
      fixture.componentRef.setInput('info', item({ state: 'running', run: run({ elapsedMs: 13 * MIN }) }));
      await fixture.whenStable();
      expect(line(root)).toBe('Tasks · running · since 13 min');
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows "2 runs" when more than one run is open', async () => {
    const { root } = await render(item({ state: 'running', run: run({ openRuns: 2 }) }));
    expect(text(root.querySelector('[data-runs]'))).toBe('2 runs');
  });

  it('aborted: the warning chip, the start and the actor, the command copyable again', async () => {
    const { root } = await render(item({ state: 'aborted', run: run({ elapsedMs: 300 * MIN }) }));
    expect(root.querySelector('ui-glyph')?.getAttribute('data-shape')).toBe('ring-slash');
    expect(root.querySelector('ui-state-chip')?.getAttribute('data-state')).toBe('aborted');
    expect(line(root)).toBe('Tasks · aborted');
    const started = root.querySelector('[data-started]');
    expect(text(started)).toMatch(/^started /u);
    expect(started?.querySelector('time')?.getAttribute('datetime')).toBe('2026-10-17T14:02:00Z');
    expect(root.querySelector('ui-actor-chip')?.hasAttribute('data-stale')).toBe(true);
    expect(root.querySelector('ui-command-chip button')?.hasAttribute('data-locked')).toBe(false);
  });

  it('done: the date, and "dropped" / "struck" for an item closed without being done', async () => {
    const done = await render(item({ state: 'done', stage: 'review', doneAt: '2026-10-12' }));
    expect(done.root.querySelector('ui-glyph')?.getAttribute('data-shape')).toBe('disc-check');
    expect(line(done.root)).toBe('Review · done');
    expect(done.root.querySelector('[data-done] time')?.getAttribute('datetime')).toBe('2026-10-12');
    const dropped = await render(item({ kind: 'claim', id: 'ISC-9', spec: '037', stage: undefined, state: 'done', closedAs: 'dropped' }));
    expect(line(dropped.root)).toBe('done');
    expect(text(dropped.root.querySelector('[data-closed-as]'))).toBe('dropped');
    const struck = await render(item({ kind: 'task', id: 'T4', stage: undefined, state: 'done', closedAs: 'struck' }), 'de');
    expect(text(struck.root.querySelector('[data-closed-as]'))).toBe('gestrichen');
  });

  it('done in the done stage names the stage once', async () => {
    const { root } = await render(item({ state: 'done', stage: 'done', doneAt: '2026-10-12' }));
    expect(line(root)).toBe('Done');
  });

  it('takes a stage label from the caller over the stage key', async () => {
    TestBed.inject(TranslocoService).setActiveLang('en');
    const fixture = TestBed.createComponent(UiItemState);
    fixture.componentRef.setInput('info', item({ kind: 'idea', id: 'registry-webhooks', stage: 'idea', state: 'open', command: '/spec new registry-webhooks' }));
    fixture.componentRef.setInput('stageLabel', 'Story');
    await fixture.whenStable();
    expect(line(fixture.nativeElement as HTMLElement)).toBe('Story · open');
  });

  it('shows a diagnostic as the quiet note of the missing detail, never an invented command', async () => {
    const diagnostic = { severity: 'warning' as const, code: 'run-no-command', message: 'The run line names no command.' };
    const { root } = await render(item({ state: 'running', run: run({ command: null }), diagnostic }));
    expect(root.querySelector('ui-command-chip')).toBeNull();
    expect(text(root.querySelector('[data-diagnostic]'))).toBe('The run line names no command.');
    expect(line(root)).toBe('Tasks · running · since 3 min');
  });
});

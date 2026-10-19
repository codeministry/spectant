import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslocoService, TranslocoTestingModule } from '@jsverse/transloco';
import type { ActorRef, ItemRun, ItemStateInfo } from '../../../../../core/src/files';
import { CATALOGUES, LANGS } from '../../../i18n/catalogues';
import { ApiClient } from '../../core/api.service';
import { RefreshService } from '../../core/refresh.service';
import { ToastService } from '../../shared/ui/toast/toast';
import { ShellData } from '../shell/shell-data.service';
import { ShellState } from '../shell/shell-state.service';
import { releasableRun, RunRelease } from './run-release';

// Spec 040, T62 · ISC-226: "Release run" on an item whose run line's run is open. It confirms in a dialog ("Release" /
// "Keep", focus back on the button), posts the activity hash the dashboard carried, toasts and refreshes on 200,
// shows "The run changed · reloaded" and refreshes on a 409, and turns disabled with a visible reason on 422 no-viewer.

const HASH = 'a'.repeat(64);
const agent: ActorRef = { raw: 'a:claude:sess-32', kind: 'agent', id: 'a:claude:sess-32', legacy: false };
const run = (extra: Partial<ItemRun> = {}): ItemRun => ({
  run: 'r-0308-1452',
  command: '/spec tasks 003',
  session: 'a:claude:sess-32',
  actor: agent,
  since: '2026-03-08T14:52:00Z',
  elapsedMs: 8 * 60_000,
  openRuns: 1,
  source: 'run',
  ...extra,
});
const running = (extra: Partial<ItemStateInfo> = {}): ItemStateInfo => ({ kind: 'spec', id: '003', state: 'running', stage: 'tasks', run: run(), ...extra });

function stubDialogApi(): void {
  const proto = HTMLDialogElement.prototype as unknown as Record<string, unknown>;
  proto['showModal'] = function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  proto['close'] = function (this: HTMLDialogElement) {
    if (!this.hasAttribute('open')) return;
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
}

describe('RunRelease (T62, ISC-226)', () => {
  let releaseRun: ReturnType<typeof vi.fn>;
  let refresh: ReturnType<typeof vi.fn>;
  let show: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    stubDialogApi();
    releaseRun = vi.fn();
    refresh = vi.fn();
    show = vi.fn();
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
        { provide: ApiClient, useValue: { releaseRun, activityHash: () => HASH } },
        { provide: ShellData, useValue: { dashboard: { value: signal({ kind: 'ok' }) } } },
        { provide: ShellState, useValue: { ws: signal('beacon') } },
        { provide: RefreshService, useValue: { refresh } },
        { provide: ToastService, useValue: { show } },
      ],
    });
  });

  async function render(info: ItemStateInfo, lang: 'en' | 'de' = 'en') {
    TestBed.inject(TranslocoService).setActiveLang(lang);
    const fixture = TestBed.createComponent(RunRelease);
    fixture.componentRef.setInput('info', info);
    document.body.appendChild(fixture.nativeElement as HTMLElement);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    const q = (selector: string): HTMLElement | null => root.querySelector<HTMLElement>(selector);
    const el = (selector: string): HTMLElement => {
      const found = q(selector);
      if (found === null) throw new Error(`no ${selector}`);
      return found;
    };
    return { fixture, root, q, el };
  }

  it('shows only for a running item of a run line: not for open, aborted, a claim lock or a task run', () => {
    expect(releasableRun(running())).not.toBeNull();
    expect(releasableRun(running({ kind: 'idea', id: 'uptime-badges', stage: 'idea' }))).not.toBeNull();
    expect(releasableRun(running({ state: 'open', run: undefined, command: '/spec tasks 003' }))).toBeNull();
    expect(releasableRun(running({ state: 'aborted' }))).toBeNull();
    expect(releasableRun(running({ run: run({ source: 'lock' }) }))).toBeNull();
    expect(releasableRun(running({ kind: 'task', id: 'T3', run: run({ source: 'task-run' }) }))).toBeNull();
  });

  it('renders "Release run" as the outline warning button with lock-open; nothing for an open item', async () => {
    const { q } = await render(running());
    const button = q('[data-release]');
    expect(button?.textContent).toContain('Release run');
    expect(button?.dataset['variant']).toBe('outline');
    expect(button?.dataset['tone']).toBe('warning');
    expect(button?.querySelector('ui-icon')?.getAttribute('data-icon')).toBe('lock-open');
    const open = await render({ kind: 'spec', id: '003', state: 'open', stage: 'tasks', command: '/spec tasks 003' });
    expect(open.q('[data-release]')).toBeNull();
  });

  it('reads „Lauf freigeben" in German', async () => {
    const { q } = await render(running(), 'de');
    expect(q('[data-release]')?.textContent).toContain('Lauf freigeben');
  });

  it('confirms in a dialog: Keep closes it without a write and focus returns to the button', async () => {
    const { fixture, q, el } = await render(running());
    const button = el('[data-release]');
    button.focus();
    button.click();
    await fixture.whenStable();
    const dialog = el('dialog');
    expect(dialog.hasAttribute('open')).toBe(true);
    expect(dialog.textContent).toContain('Release the run?');
    expect(document.activeElement).toBe(q('[data-release-keep]'));
    el('[data-release-keep]').click();
    await fixture.whenStable();
    expect(dialog.hasAttribute('open')).toBe(false);
    expect(releaseRun).not.toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve));
    expect(document.activeElement).toBe(button);
  });

  it('Release posts the rendered activity hash for the run; 200 closes, toasts "Run released" and refreshes', async () => {
    releaseRun.mockResolvedValue({ kind: 'answer', answer: { status: 200, body: { hash: 'b'.repeat(64), event: {} } } });
    const { fixture, q, el } = await render(running());
    el('[data-release]').click();
    await fixture.whenStable();
    el('[data-release-confirm]').click();
    await fixture.whenStable();
    expect(releaseRun).toHaveBeenCalledWith('beacon', 'r-0308-1452', HASH);
    expect(el('dialog').hasAttribute('open')).toBe(false);
    expect(show).toHaveBeenCalledWith('Run released');
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(q('[data-release-changed]')).toBeNull();
  });

  it('a CAS 409 shows "The run changed · reloaded", refreshes and returns focus to the button', async () => {
    const stale = { error: 'hash-mismatch', files: ['.spectant/activity.jsonl'], expected: { activity: 'c'.repeat(64) } };
    releaseRun.mockResolvedValue({ kind: 'answer', answer: { status: 409, body: stale } });
    const { fixture, q, el } = await render(running());
    const button = el('[data-release]');
    button.focus();
    button.click();
    await fixture.whenStable();
    el('[data-release-confirm]').click();
    await fixture.whenStable();
    expect(q('[data-release-changed]')?.textContent).toContain('The run changed · reloaded');
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(show).not.toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve));
    expect(document.activeElement).toBe(button);
  });

  it('422 no-viewer disables the button with the reason as visible text, and opens no dialog again', async () => {
    releaseRun.mockResolvedValue({ kind: 'answer', answer: { status: 422, body: { error: 'release-refused', reason: 'no-viewer' } } });
    const { fixture, q, el } = await render(running());
    el('[data-release]').click();
    await fixture.whenStable();
    el('[data-release-confirm]').click();
    await fixture.whenStable();
    const button = el('[data-release]');
    expect(button.getAttribute('aria-disabled')).toBe('true');
    const reason = q('[data-release-no-viewer]');
    expect(reason?.textContent).toContain('person id');
    expect(button.getAttribute('aria-describedby')).toBe(reason?.id);
    expect(refresh).not.toHaveBeenCalled();
    button.click();
    await fixture.whenStable();
    expect(el('dialog').hasAttribute('open')).toBe(false);
  });
});

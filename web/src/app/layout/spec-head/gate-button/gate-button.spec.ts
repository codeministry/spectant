import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslocoService, TranslocoTestingModule } from '@jsverse/transloco';
import { CATALOGUES, LANGS } from '../../../../i18n/catalogues';
import specGolden from '../../../../../../core/fixtures/harbor.spec.golden.json';
import type { SpecPageModel } from '../../../../../../core/src/files';
import { ApiClient } from '../../../core/api.service';
import { formatInstant, formatInstantShort } from '../../../shared/time';
import { ShellData } from '../../shell/shell-data.service';
import { ShellState } from '../../shell/shell-state.service';
import { GateButton } from './gate-button';

// T10 · ISC-114.1: the gate button's three times (`status.gate.done`, `status.gate.hint.stale`, `status.gate.written`)
// go through the shared formatter as one `<time datetime>` each, in the active app language (spec 006).

const golden = specGolden as unknown as Partial<Record<string, SpecPageModel>>;
const model = (key: string): SpecPageModel => {
  const found = golden[key];
  if (!found) throw new Error(`no golden ${key}`);
  return found;
};
const DONE = model('specs/002-web-console');
const STALE = model('specs/006-partial-push');
const WRITTEN_AT = '2026-10-01T12:05:00.000Z';
const HASHES = { 'spec.md': 'a'.repeat(64), 'plan.md': 'b'.repeat(64), 'tasks.md': null };

/** What a test reaches past the template: the dialog's checklist and its confirm. */
interface GateInternals {
  toggleCheck(index: number): void;
  confirm(): Promise<void>;
}

function setUp(body: SpecPageModel): void {
  const spec = { value: signal({ kind: 'ok', body }), reload: () => undefined };
  TestBed.configureTestingModule({
    imports: [
      TranslocoTestingModule.forRoot({
        langs: CATALOGUES,
        translocoConfig: { availableLangs: [...LANGS], defaultLang: 'en' },
        preloadLangs: true,
      }),
    ],
    providers: [
      { provide: ShellData, useValue: { spec } },
      { provide: ShellState, useValue: { ws: signal('harbor'), specId: signal('002') } },
      {
        provide: ApiClient,
        useValue: {
          reviewedHashes: () => HASHES,
          gateReviewed: () => Promise.resolve({ kind: 'ok', body: { at: WRITTEN_AT } }),
        },
      },
    ],
  });
}

async function render(body: SpecPageModel) {
  setUp(body);
  const fixture = TestBed.createComponent(GateButton);
  await fixture.whenStable();
  return fixture;
}

const host = (fixture: { nativeElement: unknown }): HTMLElement => fixture.nativeElement as HTMLElement;
const text = (el: Element | null): string => (el?.textContent ?? '').replace(/\s+/gu, ' ').trim();

describe('GateButton times (T10, ISC-114.1)', () => {
  it('shows the done mark as one <time> with the shared instant format', async () => {
    const at = DONE.gates.reviewed.at ?? '';
    const hint = host(await render(DONE)).querySelector('[data-gate-hint]');
    const time = hint?.querySelector('ui-time time');

    expect(hint?.querySelectorAll('time')).toHaveLength(1);
    expect(time?.getAttribute('datetime')).toBe(at);
    expect(time?.textContent).toBe(formatInstant(at, 'en'));
    expect(text(hint)).toBe(`Reviewed ${formatInstant(at, 'en')}`);
  });

  it('shows the stale hint in the sentence of the active language and follows a switch', async () => {
    const at = STALE.gates.reviewed.at ?? '';
    const fixture = await render(STALE);
    const hint = (): Element | null => host(fixture).querySelector('[data-gate-hint]');

    expect(hint()?.querySelector('time')?.getAttribute('datetime')).toBe(at);
    expect(text(hint())).toBe(`reviewed ${formatInstant(at, 'en')} · changed since`);

    TestBed.inject(TranslocoService).setActiveLang('de');
    await fixture.whenStable();

    expect(hint()?.querySelector('time')?.textContent).toBe(formatInstant(at, 'de'));
  });

  it('shows the written line with the time the write answered', async () => {
    const fixture = await render(model('specs/003-config-loader'));
    const gate = fixture.componentInstance as unknown as GateInternals;
    for (const index of [0, 1, 2]) gate.toggleCheck(index);
    await gate.confirm();
    await fixture.whenStable();

    const line = host(fixture).querySelector('[data-gate-written]');
    expect(line?.querySelector('time')?.getAttribute('datetime')).toBe(WRITTEN_AT);
    expect(text(line)).toBe(`Reviewed mark written ${formatInstant(WRITTEN_AT, 'en')}.`);
  });
});

// Spec 045 · ISC-272 · ISC-274: the head's gate is a one-line pill in every state; the Status tab's block stays as it was.

const PAUSED: SpecPageModel = {
  ...DONE,
  areas: {
    ...DONE.areas,
    live: {
      ...DONE.areas.live,
      lock: { source: 'frontier', claim: 'ISC-74', session: 'a:claude:sess-2', actor: { kind: 'agent', agent: 'claude', id: 'sess-2' }, since: '2026-03-08T11:00:00Z' },
    } as unknown as SpecPageModel['areas']['live'],
  },
};

async function renderSized(body: SpecPageModel, size: 'block' | 'inline') {
  setUp(body);
  const fixture = TestBed.createComponent(GateButton);
  fixture.componentRef.setInput('size', size);
  await fixture.whenStable();
  return fixture;
}

const button = (root: HTMLElement): HTMLButtonElement | null => root.querySelector('[data-gate-action]');
/** The accessible name `aria-labelledby` composes: the referenced elements' text, in order. */
const labelledName = (root: HTMLElement): string =>
  (button(root)?.getAttribute('aria-labelledby') ?? '')
    .split(/\s+/u)
    .filter(Boolean)
    .map((id) => text(root.querySelector(`#${id}`)))
    .join(' ');

describe('GateButton pill in the head (spec 045, ISC-272)', () => {
  it('done: "Reviewed" with the short date and time, the full time in tooltip and name, a click opens the dialog', async () => {
    const at = DONE.gates.reviewed.at ?? '';
    const fixture = await renderSized(DONE, 'inline');
    const root = host(fixture);
    const gate = button(root);

    expect(text(gate?.querySelector('.gate-label') ?? null)).toBe(`Reviewed ${formatInstantShort(at, 'en')}`);
    expect(gate?.getAttribute('title')).toBe(`Reviewed ${formatInstant(at, 'en')}`);
    expect(labelledName(root)).toContain(formatInstant(at, 'en'));
    gate?.click();
    await fixture.whenStable();
    expect((fixture.componentInstance as unknown as { dialogOpen(): boolean }).dialogOpen()).toBe(true);
  });

  it('ready: "Mark reviewed", the hint in tooltip and name', async () => {
    const root = host(await renderSized(model('specs/003-config-loader'), 'inline'));
    const gate = button(root);
    expect(text(gate?.querySelector('.gate-label') ?? null)).toBe('Mark reviewed');
    expect(gate?.getAttribute('title')).toBe('no review mark · release for /spec implement');
    expect(labelledName(root)).toBe('Mark reviewed no review mark · release for /spec implement');
  });

  it('stale: "Review stale", the time and every changed file in tooltip and name', async () => {
    const at = STALE.gates.reviewed.at ?? '';
    const files = STALE.gates.reviewed.files ?? [];
    const root = host(await renderSized(STALE, 'inline'));
    const gate = button(root);
    expect(files.length).toBeGreaterThan(0);
    expect(text(gate?.querySelector('.gate-label') ?? null)).toBe('Review stale');
    for (const file of files) {
      expect(gate?.getAttribute('title')).toContain(file);
      expect(labelledName(root).replace(/\s/gu, '')).toContain(file);
    }
    expect(gate?.getAttribute('title')).toContain(formatInstant(at, 'en'));
  });

  it('paused: disabled, the shortened session in the pill, the full session in tooltip and name', async () => {
    const root = host(await renderSized(PAUSED, 'inline'));
    const gate = button(root);
    expect(gate?.disabled).toBe(true);
    expect(text(gate?.querySelector('.gate-label') ?? null)).toBe('Paused · sess-2');
    expect(gate?.getAttribute('title')).toContain('a:claude:sess-2');
    expect(labelledName(root)).toContain('a:claude:sess-2');
  });
});

describe('GateButton block in the Status tab stays (spec 045, ISC-274)', () => {
  it('stale: its own label, no tooltip, the hint and the changed files as visible elements beside the button', async () => {
    const root = host(await renderSized(STALE, 'block'));
    const gate = button(root);
    expect(root.getAttribute('data-size')).toBe('block');
    expect(text(gate?.querySelector('.gate-label') ?? null)).toBe('Review again');
    expect(gate?.hasAttribute('title')).toBe(false);
    expect(gate?.hasAttribute('aria-labelledby')).toBe(false);
    expect(root.querySelector('.gate-btn > [data-gate-hint]')).not.toBeNull();
    expect(root.querySelectorAll('.gate-btn > [data-changed-files] li')).toHaveLength((STALE.gates.reviewed.files ?? []).length);
  });

  it('done: "Re-mark" with the time line under it', async () => {
    const at = DONE.gates.reviewed.at ?? '';
    const root = host(await renderSized(DONE, 'block'));
    expect(text(button(root)?.querySelector('.gate-label') ?? null)).toBe('Re-mark');
    expect(text(root.querySelector('.gate-btn > [data-gate-hint]'))).toBe(`Reviewed ${formatInstant(at, 'en')}`);
  });
});

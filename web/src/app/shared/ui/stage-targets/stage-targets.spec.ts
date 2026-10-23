import { TestBed } from '@angular/core/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import type { WorkflowStage } from '../../../../../../core/src/files';
import { CATALOGUES, LANGS } from '../../../../i18n/catalogues';
import type { BoardRefusal } from '../refusal-notice/refusal';
import { UiStageTargets } from './stage-targets';

// Spec 067, T27 · ISC-533: the stage-target list of the board's "Move to…", shared so the detail sidebar renders the
// same entries inline. One entry per stage in the given order: the current one marked, the stages core's table admits
// enabled, every other one `aria-disabled` (still focusable) with its visible reason; an enabled entry emits its stage.

const STAGES: readonly WorkflowStage[] = ['plan', 'tasks', 'review', 'build', 'close', 'done'];

async function render(inputs: Record<string, unknown>) {
  TestBed.configureTestingModule({
    imports: [
      TranslocoTestingModule.forRoot({
        langs: CATALOGUES,
        translocoConfig: { availableLangs: [...LANGS], defaultLang: 'en' },
        preloadLangs: true,
      }),
    ],
  });
  const fixture = TestBed.createComponent(UiStageTargets);
  for (const [name, value] of Object.entries({ stages: STAGES, from: 'tasks', targets: ['plan'], ...inputs })) fixture.componentRef.setInput(name, value);
  await fixture.whenStable();
  const host = fixture.nativeElement as HTMLElement;
  const entry = (stage: WorkflowStage) => host.querySelector<HTMLButtonElement>(`[data-move-to="${stage}"]`);
  return { fixture, host, entry };
}

const text = (el: Element | null | undefined): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('UiStageTargets', () => {
  it('lists every stage in order: current marked, admitted ones enabled, the rest disabled with their reason', async () => {
    const { host, entry } = await render({});

    // TestBed renders an attribute-selector host into a `div`; the board's `<ul>` is covered by move-to-menu.spec.ts.
    expect(host.getAttribute('role')).toBe('list');
    expect([...host.querySelectorAll<HTMLElement>('[data-move-to]')].map((e) => e.dataset['moveTo'])).toEqual([...STAGES]);
    expect(entry('tasks')?.getAttribute('aria-current')).toBe('true');
    expect(text(entry('tasks'))).toBe('Tasks current');
    expect(entry('plan')?.getAttribute('aria-disabled')).toBeNull();
    expect(entry('plan')?.getAttribute('data-hint')).toBe('allowed');
    expect(entry('review')?.getAttribute('aria-disabled')).toBe('true');
    expect(entry('review')?.getAttribute('data-hint')).toBe('gate');
    expect(text(entry('review'))).toBe('Review gate');
    expect(entry('close')?.getAttribute('data-hint')).toBe('not-next');
    expect(text(entry('close'))).toBe('Close not next from Tasks');
    expect(entry('plan')?.hasAttribute('data-autofocus'), 'the first enabled entry takes focus').toBe(true);
    expect(host.querySelectorAll('[data-autofocus]').length).toBe(1);
  });

  it('emits the stage of an enabled entry and nothing for a disabled or the current one', async () => {
    const { fixture, entry } = await render({});
    const chosen: WorkflowStage[] = [];
    fixture.componentInstance.choose.subscribe((s) => chosen.push(s));

    entry('review')?.click();
    entry('tasks')?.click();
    entry('plan')?.click();
    expect(chosen).toEqual(['plan']);
  });

  it('disables every entry when the item may not move, focus then on the current one', async () => {
    const { host, entry } = await render({ movable: false });

    const entries = [...host.querySelectorAll<HTMLButtonElement>('[data-move-to]')];
    expect(entries.every((e) => e.getAttribute('aria-disabled') === 'true')).toBe(true);
    expect(entry('tasks')?.hasAttribute('data-autofocus')).toBe(true);
  });

  it('shows a refusal under the entry it was refused for and emits dismiss from its ✕', async () => {
    const refusal: BoardRefusal = { key: 'spec:003', id: '003', stage: 'tasks', to: 'plan', kind: 'stale' };
    const { fixture, host, entry } = await render({ refusal });
    let dismissed = 0;
    fixture.componentInstance.dismiss.subscribe(() => dismissed++);

    const notices = host.querySelectorAll('app-refusal-notice');
    expect(notices.length).toBe(1);
    expect(entry('plan')?.parentElement?.querySelector('app-refusal-notice')).toBe(notices[0]);
    notices[0].querySelector<HTMLButtonElement>('[data-dismiss]')?.click();
    expect(dismissed).toBe(1);
  });

  it('gives tall rows only when asked (the board sheet), marked on the host', async () => {
    const { host } = await render({ tall: true });
    expect(host.hasAttribute('data-tall')).toBe(true);
  });
});

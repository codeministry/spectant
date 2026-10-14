import { TestBed } from '@angular/core/testing';
import { TranslocoService, TranslocoTestingModule } from '@jsverse/transloco';
import type { WorkflowStage } from '../../../../../../core/src/files';
import { CATALOGUES, LANGS } from '../../../../i18n/catalogues';
import { UiStageTrack } from './stage-track';

const LABELS = ['Plan', 'Tasks', 'Review', 'Build', 'Close'];
/** The feature row of the harbor workflow (`core/fixtures/harbor.planning.golden.json`): seven main-path stages. */
const FEATURE: readonly WorkflowStage[] = ['plan', 'review', 'tasks', 'build', 'code-review', 'close', 'done'];
/** The spike row of the harbor workflow. */
const SPIKE: readonly WorkflowStage[] = ['review', 'build', 'code-review', 'close', 'done'];

beforeEach(() => {
  TestBed.configureTestingModule({
    imports: [
      TranslocoTestingModule.forRoot({
        langs: CATALOGUES,
        translocoConfig: { availableLangs: [...LANGS], defaultLang: 'en', reRenderOnLangChange: true },
        preloadLangs: true,
      }),
    ],
  });
});

async function render(inputs: Record<string, unknown>) {
  const fixture = TestBed.createComponent(UiStageTrack);
  for (const [key, value] of Object.entries(inputs)) fixture.componentRef.setInput(key, value);
  await fixture.whenStable();
  return { fixture, host: fixture.nativeElement as HTMLElement };
}

const states = (host: HTMLElement, selector = 'li') => [...host.querySelectorAll(selector)].map((el) => el.getAttribute('data-state'));

describe('UiStageTrack', () => {
  it('names the mini track and marks done, current and pending segments', async () => {
    const { host } = await render({ labels: LABELS, current: 3 });
    expect(host.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('Stage 4 of 5: Build');
    expect(states(host, '.bar')).toEqual(['done', 'done', 'done', 'current', 'pending']);
  });

  it('labels each step and marks the current one as the step', async () => {
    const { host } = await render({ labels: LABELS, current: 1, size: 'labelled' });
    expect(host.querySelector('li[aria-current="step"]')?.textContent.trim()).toBe('Tasks');
  });

  it('blocked: keeps the progress, turns the current segment blocked, says "Blocked" after the mini bars and in the name (spec 025)', async () => {
    const { host } = await render({ labels: LABELS, current: 3, blocked: true });
    expect(states(host, '.bar')).toEqual(['done', 'done', 'done', 'blocked', 'pending']);
    expect(host.querySelector('[data-blocked]')?.textContent.trim()).toBe('Blocked');
    expect(host.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('Stage 4 of 5: Build · Blocked');
  });

  it('not blocked: no word after the mini bars', async () => {
    const { host } = await render({ labels: LABELS, current: 3 });
    expect(host.querySelector('[data-blocked]')).toBeNull();
  });
});

describe('UiStageTrack from a workflow row (T110, ISC-122.3)', () => {
  it('draws one segment per main-path stage of the row, in row order, with the catalogue words', async () => {
    const { host } = await render({ stages: FEATURE, stage: 'build', size: 'labelled' });
    const items = [...host.querySelectorAll('li')];
    expect(items.map((li) => li.getAttribute('data-stage'))).toEqual([...FEATURE]);
    expect(items.map((li) => li.querySelector('.seg-label')?.textContent.trim())).toEqual([
      'Plan', 'Review', 'Tasks', 'Build', 'Code review', 'Close', 'Done',
    ]);
    expect(states(host)).toEqual(['done', 'done', 'done', 'current', 'pending', 'pending', 'pending']);
    expect(host.querySelector('ol')?.getAttribute('aria-label')).toBe('Stage 4 of 7: Build');
  });

  it('never draws a detour as a segment, and caps the main path at seven', async () => {
    const row = ['review', 'build', 'blocked', 'close-pending', 'code-review', 'close', 'done'] as const;
    const { host } = await render({ stages: row, stage: 'review', size: 'labelled' });
    expect([...host.querySelectorAll('li')].map((li) => li.getAttribute('data-stage'))).toEqual(['review', 'build', 'code-review', 'close', 'done']);

    const long = await render({ stages: [...FEATURE, 'idea'], stage: 'plan', size: 'mini' });
    expect(long.host.querySelectorAll('.bar')).toHaveLength(7);
  });

  it('reads done as every segment done', async () => {
    const { host } = await render({ stages: SPIKE, stage: 'done', size: 'labelled' });
    expect(states(host)).toEqual(['done', 'done', 'done', 'done', 'done']);
    expect(host.querySelector('li[aria-current="step"]')?.getAttribute('data-stage')).toBe('done');
  });

  it('marks a detour on the current segment in held grey, with its word, and names it', async () => {
    const { host } = await render({ stages: SPIKE, stage: 'code-review', detour: 'close-pending', size: 'labelled', marker: true });
    const current = host.querySelector<HTMLElement>('li[aria-current="step"]');
    expect(current?.getAttribute('data-stage')).toBe('code-review');
    expect(current?.getAttribute('data-state')).toBe('held');
    expect(current?.getAttribute('data-detour')).toBe('close-pending');
    expect(current?.querySelector('.detour')?.textContent.trim()).toBe('Close-pending');
    expect(host.querySelectorAll('[data-detour]')).toHaveLength(1);
    expect(states(host)).toEqual(['done', 'done', 'held', 'pending', 'pending']);
    expect(host.querySelector('ol')?.getAttribute('aria-label')).toBe('Stage 3 of 5: Code review · Close-pending');
  });

  it('marks blocked on the mini track too', async () => {
    const { host } = await render({ stages: FEATURE, stage: 'build', detour: 'blocked' });
    expect(states(host, '.bar')).toEqual(['done', 'done', 'done', 'held', 'pending', 'pending', 'pending']);
    expect(host.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('Stage 4 of 7: Build · Blocked');
  });

  it('shows only the current word under its segment in the compact variant', async () => {
    const { fixture, host } = await render({ stages: FEATURE, stage: 'build', size: 'compact' });
    expect(host.getAttribute('data-size')).toBe('compact');
    const words = [...host.querySelectorAll<HTMLElement>('.word')];
    expect(words).toHaveLength(1);
    expect(words[0]?.closest('li')?.getAttribute('aria-current')).toBe('step');
    expect(words[0]?.textContent.trim()).toBe('Build');
    // The other stage words stay for assistive technology only.
    expect(host.querySelectorAll('li .vh')).toHaveLength(6);

    fixture.componentRef.setInput('detour', 'blocked');
    TestBed.inject(TranslocoService).setActiveLang('de');
    await fixture.whenStable();
    expect(host.querySelector('.word')?.textContent.replace(/\s+/g, ' ').trim()).toBe('Bauen · Blockiert');
  });

  it('marks nothing current for a stage the row does not hold', async () => {
    const { host } = await render({ stages: SPIKE, stage: 'plan', size: 'labelled' });
    expect(states(host)).toEqual(['pending', 'pending', 'pending', 'pending', 'pending']);
    expect(host.querySelector('li[aria-current]')).toBeNull();
    expect(host.querySelector('ol')?.getAttribute('aria-label')).toBe('Plan');
  });
});

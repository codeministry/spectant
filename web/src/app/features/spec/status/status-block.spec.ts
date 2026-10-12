import { TestBed } from '@angular/core/testing';
import { TranslocoService, TranslocoTestingModule } from '@jsverse/transloco';
import type { SpecPageModel, Workflow } from '../../../../../../core/src/files';
import planningGolden from '../../../../../../core/fixtures/harbor.planning.golden.json';
import specGolden from '../../../../../../core/fixtures/harbor.spec.golden.json';
import type { ActorMapping } from '../../../../../../server/src/spec-routes.contract';
import { CATALOGUES, LANGS } from '../../../../i18n/catalogues';
import { StatusBlock } from './status-block';

const SPECS = specGolden as unknown as Record<string, SpecPageModel>;
const spec = (key: string): SpecPageModel => {
  const found = SPECS[`specs/${key}`] as SpecPageModel | undefined;
  if (!found) throw new Error(`harbor.spec.golden.json holds no ${key}`);
  return found;
};
const WORKFLOW = planningGolden.workflow as unknown as Workflow;
const ACTORS: readonly ActorMapping[] = [{ id: 'u:3f9c0a7d', displayName: 'Harbour Master', gitIdentities: [] }];

beforeEach(() => {
  TestBed.configureTestingModule({
    imports: [
      TranslocoTestingModule.forRoot({
        langs: CATALOGUES,
        translocoConfig: { availableLangs: [...LANGS], defaultLang: 'en' },
        preloadLangs: true,
      }),
    ],
  });
});

async function render(key: string, inputs: Record<string, unknown> = {}) {
  const m = spec(key);
  const fixture = TestBed.createComponent(StatusBlock);
  fixture.componentRef.setInput('head', m.head);
  fixture.componentRef.setInput('next', m.next);
  fixture.componentRef.setInput('workflow', WORKFLOW);
  fixture.componentRef.setInput('actors', ACTORS);
  for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
  await fixture.whenStable();
  return { m, host: fixture.nativeElement as HTMLElement };
}

const t = (key: string) => TestBed.inject(TranslocoService).translate(key);

describe('StatusBlock (T132, ISC-122.3)', () => {
  it('draws the feature row with build current, the phrase unclamped and the command chip (002)', async () => {
    const { m, host } = await render('002-web-console');
    const items = [...host.querySelectorAll('ui-stage-track li')];
    expect(items.map((li) => li.getAttribute('data-stage'))).toEqual(['plan', 'review', 'tasks', 'build', 'code-review', 'close', 'done']);
    expect(host.querySelector('ui-stage-track li[aria-current="step"]')?.getAttribute('data-stage')).toBe('build');
    expect(host.querySelector('ui-stage-track [data-detour]')).toBeNull();

    const reason = host.querySelector('ui-reason');
    expect(reason?.getAttribute('data-block')).toBe('');
    expect(reason?.querySelector('.phrase')?.textContent).toBe(m.next.reasons[0]);
    expect(reason?.querySelector('ui-command-chip code')?.textContent).toBe('/spec-implement 002');
    expect(host.querySelector('[data-next-command]')?.textContent).toContain('/spec-implement 002');

    const source = host.querySelector('[data-stage-source]');
    expect(source?.getAttribute('data-value')).toBe('explicit');
    expect(source?.textContent.trim()).toBe(t('status.stageSource.explicit'));
  });

  it('hands the command to the spec head at wide', async () => {
    const { host } = await render('002-web-console', { showCommand: false });
    expect(host.querySelector('ui-reason ui-command-chip')).toBeNull();
    expect(host.querySelector('ui-reason .phrase')).not.toBeNull();
  });

  it('draws the compact track with the current word under its segment', async () => {
    const { host } = await render('002-web-console', { compact: true });
    expect(host.querySelector('ui-stage-track')?.getAttribute('data-size')).toBe('compact');
    expect(host.querySelector('ui-stage-track .word')?.textContent.trim()).toBe('Build');
  });

  it('marks close-pending on the track and shows the phrase without a command (008)', async () => {
    const { m, host } = await render('008-referrers-support');
    const current = host.querySelector('ui-stage-track li[aria-current="step"]');
    expect(current?.getAttribute('data-stage')).toBe('code-review');
    expect(current?.getAttribute('data-detour')).toBe('close-pending');
    expect(current?.querySelector('.detour')?.textContent.trim()).toBe('Close-pending');
    expect(host.querySelector('ui-reason .phrase')?.textContent).toBe(m.next.reasons[0]);
    expect(host.querySelector('ui-command-chip')).toBeNull();
    expect(host.querySelector('[data-next-command]')).toBeNull();
    expect(host.querySelector('[data-done]')).toBeNull();
    expect(host.querySelector('[data-stage-source]')?.getAttribute('data-value')).toBe('derived');
  });

  it('shows the whole row done and the done line instead of a reason (007)', async () => {
    const { host } = await render('007-rotate-mirror-token');
    expect([...host.querySelectorAll('ui-stage-track li')].map((li) => li.getAttribute('data-state'))).toEqual(['done', 'done', 'done']);
    expect(host.querySelector('ui-reason')).toBeNull();
    expect(host.querySelector('[data-done]')?.textContent.trim()).toBe(t('status.where.done'));
    expect(host.querySelector('[data-stage-source]')?.textContent.trim()).toBe(t('status.stageSource.derived'));
  });
});

describe('StatusBlock assignee (T133, ISC-131)', () => {
  it('shows the assignee as an actor chip with the stored display name (002)', async () => {
    const { host } = await render('002-web-console');
    const chip = host.querySelector('[data-assignee] ui-actor-chip');
    expect(chip?.getAttribute('data-kind')).toBe('person');
    expect(chip?.querySelector('.label')?.textContent.trim()).toBe('Harbour Master');
    expect(host.querySelector('[data-unassigned]')).toBeNull();
  });

  it('shows the raw id in mono for an unmapped person (009)', async () => {
    const { host } = await render('009-chunked-upload-limits', { actors: [] });
    const label = host.querySelector('[data-assignee] ui-actor-chip .label');
    expect(label?.textContent.trim()).toBe('u:3f9c0a7d');
    expect(label?.classList.contains('mono')).toBe(true);
  });

  it('shows a muted unassigned label and no chip when nobody is assigned (003)', async () => {
    const { host } = await render('003-config-loader');
    expect(host.querySelector('ui-actor-chip')).toBeNull();
    expect(host.querySelector('[data-unassigned]')?.textContent.trim()).toBe(t('status.unassigned'));
  });
});

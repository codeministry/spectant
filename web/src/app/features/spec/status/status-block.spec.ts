import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslocoService, TranslocoTestingModule } from '@jsverse/transloco';
import type { SpecPageModel, Workflow } from '../../../../../../core/src/files';
import planningGolden from '../../../../../../core/fixtures/harbor.planning.golden.json';
import specGolden from '../../../../../../core/fixtures/harbor.spec.golden.json';
import beaconGolden from '../../../../../../core/fixtures/beacon.spec.golden.json';
import beaconPlanning from '../../../../../../core/fixtures/beacon.planning.golden.json';
import type { ActorMapping } from '../../../../../../server/src/spec-routes.contract';
import { CATALOGUES, LANGS } from '../../../../i18n/catalogues';
import { formatInstant } from '../../../shared/time';
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
    providers: [provideRouter([])],
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

/** The same spec with its head as a payload before spec 040 served it: no `state`. */
async function renderLegacy(key: string, inputs: Record<string, unknown> = {}) {
  const head = { ...spec(key).head, state: undefined };
  return render(key, { head, ...inputs });
}

const t = (key: string) => TestBed.inject(TranslocoService).translate(key);

describe('StatusBlock without an item state (T132, ISC-122.3; payloads before spec 040)', () => {
  it('draws the feature row with build current, the phrase unclamped and the command chip (002)', async () => {
    const { m, host } = await renderLegacy('002-web-console');
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
    const { host } = await renderLegacy('002-web-console', { showCommand: false });
    expect(host.querySelector('ui-reason ui-command-chip')).toBeNull();
    expect(host.querySelector('ui-reason .phrase')).not.toBeNull();
  });

  it('draws the compact track with the current word under its segment', async () => {
    const { host } = await renderLegacy('002-web-console', { compact: true });
    expect(host.querySelector('ui-stage-track')?.getAttribute('data-size')).toBe('compact');
    expect(host.querySelector('ui-stage-track .word')?.textContent.trim()).toBe('Build');
  });

  it('marks close-pending on the track and shows the phrase without a command (008)', async () => {
    const { m, host } = await renderLegacy('008-referrers-support');
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
    const { host } = await renderLegacy('007-rotate-mirror-token');
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

describe('StatusBlock since (T11, ISC-114.1)', () => {
  const AT = '2026-10-01T12:05:00.000Z';

  it('renders "since … via …" with the instant as a <time> through the shared formatter', async () => {
    const { host } = await render('002-web-console', { since: { at: AT, via: '/spec-review' } });
    const caption = host.querySelector('[data-since]');
    const time = caption?.querySelector('ui-time time');
    expect(time?.getAttribute('datetime')).toBe(AT);
    expect(time?.textContent).toBe(formatInstant(AT, 'en'));
    expect(caption?.textContent.replace(/\s+/g, ' ').trim()).toBe(`since ${formatInstant(AT, 'en')} via /spec-review`);
  });

  it('shows no caption without an event into the current stage', async () => {
    const { host } = await render('002-web-console', { since: null });
    expect(host.querySelector('[data-since]')).toBeNull();
  });
});

describe('StatusBlock item state (spec 040, T49, ISC-224)', () => {
  const BEACON = beaconGolden as unknown as Record<string, SpecPageModel>;
  const BEACON_WORKFLOW = beaconPlanning.workflow as unknown as Workflow;

  async function renderBeacon(key: string) {
    const m = BEACON[`specs/${key}`] as SpecPageModel | undefined;
    if (!m) throw new Error(`beacon.spec.golden.json holds no ${key}`);
    const fixture = TestBed.createComponent(StatusBlock);
    fixture.componentRef.setInput('head', m.head);
    fixture.componentRef.setInput('next', m.next);
    fixture.componentRef.setInput('workflow', BEACON_WORKFLOW);
    fixture.componentRef.setInput('ws', 'beacon');
    await fixture.whenStable();
    return { m, host: fixture.nativeElement as HTMLElement };
  }

  it('puts the state chip beside the stage chip and the block state line below (open, 002)', async () => {
    const { m, host } = await render('002-web-console');
    expect(host.querySelector('[data-state-chip]')?.getAttribute('data-state')).toBe('open');
    const line = host.querySelector('ui-item-state');
    expect(line?.getAttribute('data-block')).toBe('');
    expect(line?.getAttribute('data-state')).toBe('open');
    expect(line?.querySelector('ui-command-chip code')?.textContent).toBe('/spec-implement 002');
    expect(line?.textContent).toContain(m.head.state?.reason ?? '-');
    expect(host.querySelector('[data-next-command]')?.textContent).toContain('/spec-implement 002');
    expect(host.querySelector('ui-reason')).toBeNull();
  });

  it('leaves an open command to the spec head at wide', async () => {
    const { host } = await render('002-web-console', { showCommand: false });
    expect(host.querySelector('ui-item-state ui-command-chip')).toBeNull();
    expect(host.querySelector('ui-item-state')?.getAttribute('data-state')).toBe('open');
  });

  it('running: the locked command chip, the agent, "since 8 min" and the start (beacon 003)', async () => {
    const { m, host } = await renderBeacon('003-alert-rules');
    expect(host.querySelector('[data-state-chip]')?.getAttribute('data-state')).toBe('running');
    const line = host.querySelector('ui-item-state');
    expect(line?.getAttribute('data-state')).toBe('running');
    expect(line?.querySelector('ui-command-chip [data-locked]')).not.toBeNull();
    expect(line?.querySelector('ui-command-chip code')?.textContent).toBe('/spec-tasks 003');
    expect(line?.querySelector('ui-actor-chip')?.textContent).toContain('a:claude:sess-32');
    expect(line?.querySelector('[data-item-line]')?.textContent).toContain('since 8 min');
    const since = m.head.state?.run?.since ?? '';
    expect(Date.parse(line?.querySelector('[data-started] time')?.getAttribute('datetime') ?? '')).toBe(Date.parse(since));
  });

  it('aborted: the warning chip with start and actor, the command free again (beacon 006)', async () => {
    const { host } = await renderBeacon('006-retry-backoff');
    expect(host.querySelector('[data-state-chip]')?.getAttribute('data-state')).toBe('aborted');
    const line = host.querySelector('ui-item-state');
    expect(line?.getAttribute('data-state')).toBe('aborted');
    expect(line?.querySelector('[data-started]')).not.toBeNull();
    expect(line?.querySelector('ui-command-chip [data-locked]')).toBeNull();
  });

  it('waiting: what it waits on as a link, no command (beacon 011)', async () => {
    const { host } = await renderBeacon('011-maintenance-windows');
    const line = host.querySelector('ui-item-state');
    expect(line?.getAttribute('data-state')).toBe('waiting');
    expect(line?.querySelector('ui-waits-chip a')?.getAttribute('href')).toContain('/w/beacon/s/002');
    expect(line?.querySelector('ui-command-chip')).toBeNull();
  });

  it('done: the date, no second done chip beside the done stage (beacon 001)', async () => {
    const { host } = await renderBeacon('001-check-scheduler');
    expect(host.querySelector('[data-state-chip]')).toBeNull();
    expect(host.querySelector('ui-item-state [data-done] time')).not.toBeNull();
  });

  it('falls back to the reason block when the head carries no state (older payloads)', async () => {
    const head = { ...spec('002-web-console').head, state: undefined };
    const { host } = await render('002-web-console', { head });
    expect(host.querySelector('ui-item-state')).toBeNull();
    expect(host.querySelector('[data-state-chip]')).toBeNull();
    expect(host.querySelector('ui-reason ui-command-chip code')?.textContent).toBe('/spec-implement 002');
  });
});

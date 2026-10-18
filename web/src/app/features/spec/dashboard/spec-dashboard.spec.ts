import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslocoService, TranslocoTestingModule } from '@jsverse/transloco';
import type { GuidanceReason, SpecPageModel } from '../../../../../../core/src/files';
import specGolden from '../../../../../../core/fixtures/harbor.spec.golden.json';
import { CATALOGUES, LANGS } from '../../../../i18n/catalogues';
import { ShellData } from '../../../layout/shell/shell-data.service';
import { ShellState } from '../../../layout/shell/shell-state.service';
import type { Tier } from '../../../layout/shell/tier';
import { SpecDashboard } from './spec-dashboard';

const SPECS = specGolden as unknown as Record<string, SpecPageModel>;
const spec = (key: string): SpecPageModel => {
  const found = SPECS[`specs/${key}`] as SpecPageModel | undefined;
  if (!found) throw new Error(`harbor.spec.golden.json holds no ${key}`);
  return found;
};

function setup(key: string, tier: Tier) {
  const m = spec(key);
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
      {
        provide: ShellData,
        useValue: {
          spec: { value: signal({ kind: 'ok', body: m }), error: signal(undefined), reload: () => undefined },
          dashboard: { value: signal(undefined) },
        },
      },
      { provide: ShellState, useValue: { tier: signal<Tier>(tier), ws: signal('harbor'), specId: signal(m.head.id) } },
    ],
  });
  return m;
}

async function render(key: string, tier: Tier) {
  const m = setup(key, tier);
  const fixture = TestBed.createComponent(SpecDashboard);
  await fixture.whenStable();
  return { m, host: fixture.nativeElement as HTMLElement };
}

/** The reason's catalogue sentence, as `guidanceReason` reads it (the `state` values through their own words). */
function sentence(reason: GuidanceReason): string {
  const t = TestBed.inject(TranslocoService);
  const values = Object.fromEntries(
    Object.entries(reason.values).map(([name, value]) => {
      const word = t.translate(`guidance.value.${name}.${value}`);
      return [name, word === `guidance.value.${name}.${value}` ? value : word];
    }),
  );
  return t.translate(`guidance.reason.${reason.key}`, values);
}

/** The blocks of the page in DOM order, by their `data-section`. */
const order = (host: HTMLElement) => [...host.querySelectorAll('.page > [data-section], .page > .dash-2 > [data-section]')].map((el) => el.getAttribute('data-section'));

describe('SpecDashboard guidance below 1120 (T19, ISC-239)', () => {
  it('opens the page with the guidance spot: sentence, chip and the further waiting entries (harbor 002)', async () => {
    const { m, host } = await render('002-web-console', 'medium');
    expect(order(host)).toEqual(['next', 'kpi', 'idea', 'lanes', 'tldr', 'tiles']);

    const spot = host.querySelector('[data-guidance-spot]');
    expect(spot?.id).toBe('waiting');
    expect(spot?.getAttribute('data-form')).toBe('guide');
    const own = m.guidance?.next.find((e) => e.spec === '002' && e.item === 'spec');
    if (!own) throw new Error("harbor 002 has no own guidance entry");
    expect(spot?.querySelector('[data-guidance-reason]')?.textContent.trim()).toBe(sentence(own.reason));
    expect(spot?.querySelector('.reasons')).toBeNull();
    expect(spot?.querySelector('[data-guidance-command] code')?.textContent).toBe(m.next.command);
    // 002 is next, not waiting: no marker, but its three waiting items stand below with a chip on every row.
    expect(spot?.querySelector('[data-waits-mark]')).toBeNull();
    const block = spot?.querySelector('ui-waits-block[data-guidance-waits]');
    expect(block?.getAttribute('data-count')).toBe(String(m.guidance?.waits.length));
    expect(block?.querySelector('[data-more]')).toBeNull();
    expect(spot?.querySelector('ui-stage-track')).not.toBeNull();
    // `#waiting` is the guidance spot alone; the Spec context below holds no second one.
    expect(host.querySelectorAll('#waiting')).toHaveLength(1);
    expect(host.querySelector('[data-spec-context]')?.id).toBe('');
  });

  it('marks a spec that waits on you and lists only its other entries (harbor 005)', async () => {
    const { m, host } = await render('005-config-format-choice', 'compact');
    const spot = host.querySelector('[data-guidance-spot]');
    expect(spot?.hasAttribute('data-waits')).toBe(true);
    expect(spot?.querySelector('[data-waits-mark]')?.textContent.trim()).toBe('Waits on you');
    expect(spot?.querySelector('[data-guidance-command] code')?.textContent).toBe('/spec-review 005');
    const block = spot?.querySelector('ui-waits-block[data-guidance-waits]');
    expect(block?.getAttribute('data-count')).toBe(String((m.guidance?.waits.length ?? 0) - 1));
    expect(block?.textContent).toContain('ISC-94');
  });

  it('shows no waits block when nothing else waits (harbor 006)', async () => {
    const { host } = await render('006-partial-push', 'medium');
    const spot = host.querySelector('[data-guidance-spot]');
    expect(spot?.querySelector('[data-waits-mark]')).not.toBeNull();
    expect(spot?.querySelector('ui-waits-block')).toBeNull();
  });

  it('keeps the reasons where the guidance names no entry (harbor 007, done)', async () => {
    const { m, host } = await render('007-rotate-mirror-token', 'medium');
    const spot = host.querySelector('[data-guidance-spot]');
    expect(spot?.querySelector('[data-guidance-reason]')).toBeNull();
    expect([...(spot?.querySelectorAll('[data-reason]') ?? [])].map((li) => li.textContent.trim())).toEqual(m.next.reasons.slice(0, 3));
    expect(spot?.querySelector('ui-command-chip')).toBeNull();
  });

  it('turns the KPI Waiting on you secondary, labelled as everywhere, with a link to the guidance spot', async () => {
    const { host } = await render('002-web-console', 'medium');
    const tile = host.querySelector('[data-kpi="waiting"]');
    expect(tile?.textContent).toContain('Waits on you');
    expect(tile?.querySelector('ui-card')?.getAttribute('data-accent')).toBe('secondary');
    expect(tile?.querySelector('a')?.getAttribute('href')).toBe('/w/harbor/s/002#waiting');
  });
});

describe('SpecDashboard next step from 1120 (T19, ISC-239)', () => {
  it('puts the card right under the KPI band, before the idea, without a chip of its own', async () => {
    const { m, host } = await render('002-web-console', 'wide');
    expect(order(host)).toEqual(['kpi', 'next', 'lanes', 'idea', 'tldr', 'tiles']);
    const next = host.querySelector('[data-section="next"]');
    expect(next?.getAttribute('data-form')).toBe('card');
    expect(next?.id).toBe('');
    expect(next?.querySelector('ui-command-chip')).toBeNull();
    expect(next?.querySelector('ui-waits-block')).toBeNull();
    expect(next?.querySelector('[data-guidance-reason]')?.textContent.trim()).not.toBe('');
    const link = next?.querySelector('a[data-waits-link]');
    expect(link?.textContent.trim()).toBe(`Waits on you: ${String(m.guidance?.waits.length)}`);
    expect(link?.getAttribute('href')).toBe('/w/harbor/s/002#waiting');
  });

  it('shows no rail link when nothing of the spec waits (harbor 003)', async () => {
    const { host } = await render('003-config-loader', 'wide');
    expect(host.querySelector('[data-section="next"] [data-waits-link]')).toBeNull();
  });
});

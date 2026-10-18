import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, type Routes } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { describe, expect, it } from 'vitest';
import type { Guidance, GuidanceEntry, SpecPageModel } from '../../../../../../core/src/files';
import specGolden from '../../../../../../core/fixtures/harbor.spec.golden.json';
import { CATALOGUES, LANGS } from '../../../../i18n/catalogues';
import en from '../../../../i18n/en.json';
import { ApiClient, type ApiResult } from '../../../core/api.service';
import { LockSourceService } from '../../../core/lock-source.service';
import { ShellState } from '../../../layout/shell/shell-state.service';
import { SpecRail } from './spec-rail';

// T20 · ISC-239: from 1120 px the spec rail is the guidance spot of every tab it serves: "Next step" with the spec's
// catalogue sentence and its one chip on top, then the spec's waiting entries as `ui-waits-block` (scope `spec`: the
// reference instead of the spec number, the kind chip, a chip on every row, links to the Claims and Tasks rows), and no
// `operator` checkbox. Harbor 002's golden slice: the spec in `next`, ISC-77 / T31 / the question on T29 waiting.

const SPEC002 = (specGolden as unknown as Record<string, SpecPageModel>)['specs/002-web-console'];
const GUIDANCE = SPEC002.guidance as Guidance;

const ok = <T>(body: T): ApiResult<T> => ({ kind: 'ok', body, etag: null, notModified: false });
const routes: Routes = [{ path: 'w/:ws/s/:id/status', component: SpecRail, data: { area: 'status', tab: 'status' } }];

async function render(body: SpecPageModel = SPEC002): Promise<HTMLElement> {
  const api = {
    workspaces: () => Promise.resolve(ok([{ slug: 'harbor', name: 'harbor', pathTail: 'harbor', readable: true, counts: null }])),
    dashboard: () => Promise.resolve(ok({ specs: [], archive: [] })),
    planning: () => Promise.resolve({ kind: 'not-found', served: false } as const),
    spec: () => Promise.resolve(ok(body)),
    claims: () => Promise.resolve(ok({ claims: [] })),
    reviewedHashes: () => null,
  };
  TestBed.configureTestingModule({
    imports: [
      TranslocoTestingModule.forRoot({ langs: CATALOGUES, translocoConfig: { availableLangs: [...LANGS], defaultLang: 'en' }, preloadLangs: true }),
    ],
    providers: [
      provideRouter(routes),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: ApiClient, useValue: api },
      { provide: LockSourceService, useValue: { connect: () => undefined } },
    ],
  });
  const harness = await RouterTestingHarness.create();
  TestBed.inject(ShellState).tier.set('wide');
  await harness.navigateByUrl('/w/harbor/s/002/status');
  await harness.fixture.whenStable();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await harness.fixture.whenStable();
  return harness.fixture.nativeElement as HTMLElement;
}

const text = (el: Element | null | undefined): string => (el?.textContent ?? '').replace(/\s+/gu, ' ').trim();
const chipCommands = (el: Element | null | undefined): string[] =>
  [...(el?.querySelectorAll('ui-command-chip') ?? [])].map((c) => text(c.querySelector('code') ?? c));

describe('app-spec-rail as the guidance spot (T20, ISC-239)', () => {
  it('leads with Next step: the catalogue sentence and the one chip of the next command', async () => {
    const root = await render();
    const blocks = [...root.querySelectorAll('[data-spec-rail] > [data-rail-block], [data-spec-rail] > app-spec-rail-guide > [data-rail-block]')].map((el) => el.getAttribute('data-rail-block'));
    expect(blocks).toEqual(['next', 'waits', 'where']);
    const next = root.querySelector('[data-rail-block="next"]');
    expect(text(next?.querySelector('h2'))).toBe(en.guidance.next.step);
    expect(text(next?.querySelector('[data-rail-reason]'))).toBe(en.guidance.reason.stage.build['0']);
    expect(chipCommands(next)).toEqual(['/spec-implement 002']);
    expect(next?.querySelector('[data-rail-marker]')).toBeNull();
    // Where it stands no longer repeats the chip: one command, one chip in the rail's lead.
    expect(root.querySelector('[data-rail-block="where"] ui-command-chip')).toBeNull();
  });

  it("lists the spec's waiting entries by reference, with their kind, reason, chip and row link", async () => {
    const root = await render();
    const waits = root.querySelector('ui-waits-block[data-rail-block="waits"]');
    expect(waits?.getAttribute('data-count')).toBe('3');
    const top = waits?.querySelector('[data-top]');
    expect(text(top?.querySelector('a.id'))).toBe('ISC-77');
    expect(top?.querySelector('a.id')?.getAttribute('href')).toBe('/w/harbor/s/002/claims#claim-ISC-77');
    expect(text(top?.querySelector('[data-kind]'))).toBe(en.specDashboard.context.kinds.manual);
    expect(text(top?.querySelector('[data-reason]'))).toBe(en.guidance.reason.waiting.manual.replace('{{ref}}', 'ISC-77'));
    const rows = [...(waits?.querySelectorAll('[data-row]') ?? [])];
    expect(rows.map((row) => text(row.querySelector('.id')))).toEqual(['T31', 'T29']);
    expect(rows[0]?.querySelector('a.row')?.getAttribute('href')).toBe('/w/harbor/s/002/tasks#task-T31');
    expect(rows[1]?.querySelector('a.row')?.getAttribute('href')).toBe('/w/harbor/s/002');
    expect(rows.map((row) => text(row.querySelector('[data-kind]')))).toEqual([en.specDashboard.context.kinds.operator, en.specDashboard.context.kinds.question]);
    // A chip on every row; no spec number stands in for the reference.
    expect(chipCommands(waits)).toHaveLength(3);
    expect([...(waits?.querySelectorAll('.id') ?? [])].map(text)).not.toContain('002');
  });

  it('holds no operator checkbox: the Tasks tab ticks', async () => {
    const root = await render();
    expect(root.querySelector('[data-spec-rail] input[type="checkbox"]')).toBeNull();
    expect(root.querySelector('[data-rail-waiting]')).toBeNull();
  });

  it('caps the waits block at five rows past the top entry and links "+n more" to the dashboard', async () => {
    const many: GuidanceEntry[] = Array.from({ length: 8 }, (_, i) => ({ ...GUIDANCE.waits[1], ref: `T${40 + i}`, reason: { ...GUIDANCE.waits[1].reason, values: { ref: `T${40 + i}` } } }));
    const root = await render({ ...SPEC002, guidance: { waits: many, next: GUIDANCE.next } });
    const waits = root.querySelector('ui-waits-block[data-rail-block="waits"]');
    expect(waits?.querySelectorAll('[data-row]')).toHaveLength(5);
    const more = waits?.querySelector('a[data-more]');
    expect(text(more)).toBe('+2 more');
    expect(more?.getAttribute('href')).toBe('/w/harbor/s/002#waiting');
  });

  it('marks a spec that waits on you itself and keeps its chip once', async () => {
    const own: GuidanceEntry = { ...GUIDANCE.next[0], command: '/spec-review 002' };
    const root = await render({ ...SPEC002, guidance: { waits: [own], next: [] } });
    expect(text(root.querySelector('[data-rail-marker]'))).toBe(en.guidance.marker);
    expect(root.querySelector('ui-waits-block')).toBeNull();
    expect(chipCommands(root.querySelector('[data-spec-rail]'))).toEqual(['/spec-review 002']);
  });

  it("without guidance reads the model's next command and first reason", async () => {
    const bare: SpecPageModel = { ...SPEC002 };
    delete (bare as { guidance?: Guidance }).guidance;
    const root = await render(bare);
    const next = root.querySelector('[data-rail-block="next"]');
    expect(text(next?.querySelector('[data-rail-reason]'))).toBe(SPEC002.next.reasons[0]);
    expect(chipCommands(next)).toEqual([SPEC002.next.command]);
    expect(root.querySelector('ui-waits-block')).toBeNull();
  });
});

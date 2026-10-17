import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslocoTestingModule } from '@jsverse/transloco';
import type { GanttGroup, GanttLane, GanttModel } from '../../../../../../core/src/gantt';
import type { PlanningModel } from '../../../../../../core/src/planning';
import type { RelationRef } from '../../../../../../core/src/relations';
import backlogRanksGantt from '../../../../../../core/fixtures/backlog-ranks.gantt.golden.json';
import backlogRanks from '../../../../../../core/fixtures/backlog-ranks.planning.golden.json';
import harborGantt from '../../../../../../core/fixtures/harbor.gantt.golden.json';
import harbor from '../../../../../../core/fixtures/harbor.planning.golden.json';
import lanternGantt from '../../../../../../core/fixtures/lantern.gantt.golden.json';
import lantern from '../../../../../../core/fixtures/lantern.planning.golden.json';
import milestoneLinesGantt from '../../../../../../core/fixtures/milestone-lines.gantt.golden.json';
import milestoneLines from '../../../../../../core/fixtures/milestone-lines.planning.golden.json';
import { CATALOGUES, LANGS } from '../../../../i18n/catalogues';
import en from '../../../../i18n/en.json';
import { DetailSelection } from '../../../layout/detail-sidebar/selection';
import { ShellState } from '../../../layout/shell/shell-state.service';
import type { Tier } from '../../../layout/shell/tier';
import { formatDay } from '../../../shared/time';
import { PlanningGantt } from './planning-gantt';

// T10 · ISC-203 (spec 038): the Gantt lens against the planning goldens. Every group, lane and bar the lens draws is
// `planningGantt` of the golden's own planning model, and it must equal the `<tree>.gantt.golden.json` core wrote
// (core/tests/gantt.test.ts proves that one equal to the live tree's); the view adds only layout. harbor carries no
// `Milestone:` line, so its two milestones stand without lanes and every feature in the no-milestone group (no bar);
// backlog-ranks has two windows with bars, milestone-lines a complete milestone in the past segment. Probe:
// `bun run --cwd web test -- --filter "gantt"`.

const CASES = {
  harbor: { planning: harbor, gantt: harborGantt },
  'backlog-ranks': { planning: backlogRanks, gantt: backlogRanksGantt },
  'milestone-lines': { planning: milestoneLines, gantt: milestoneLinesGantt },
  lantern: { planning: lantern, gantt: lanternGantt },
} as unknown as Record<string, { planning: PlanningModel; gantt: GanttModel }>;

class FakeSelection {
  readonly current = signal<RelationRef | null>(null);
  readonly selected = this.current.asReadonly();
  readonly picks: RelationRef[] = [];
  docks = 0;
  dock(): void {
    this.docks += 1;
  }
  select(ref: RelationRef): Promise<boolean> {
    this.picks.push(ref);
    this.current.set(ref);
    return Promise.resolve(true);
  }
}

@Component({ imports: [PlanningGantt], template: `<app-planning-gantt [model]="model()" />` })
class Host {
  readonly model = signal<PlanningModel>(harbor as unknown as PlanningModel);
}

interface Rendered {
  el: HTMLElement;
  selection: FakeSelection;
  stable: () => Promise<void>;
}

async function render(model: PlanningModel, tier: Tier = 'wide'): Promise<Rendered> {
  const selection = new FakeSelection();
  TestBed.configureTestingModule({
    imports: [
      TranslocoTestingModule.forRoot({
        langs: CATALOGUES,
        translocoConfig: { availableLangs: [...LANGS], defaultLang: 'en' },
        preloadLangs: true,
      }),
    ],
    providers: [provideRouter([]), { provide: DetailSelection, useValue: selection }, { provide: ShellState, useValue: { tier: signal<Tier>(tier) } }],
  });
  const fixture = TestBed.createComponent(Host);
  fixture.componentInstance.model.set(model);
  await fixture.whenStable();
  return { el: fixture.nativeElement as HTMLElement, selection, stable: () => fixture.whenStable() };
}

const text = (node: Element | null | undefined): string => node?.textContent.replace(/\s+/gu, ' ').trim() ?? '';
const groupKey = (g: GanttGroup): string => g.ref ?? 'none';
const groups = (el: HTMLElement): HTMLElement[] => [...el.querySelectorAll<HTMLElement>('[data-group]')];
const lanesIn = (root: Element): HTMLElement[] => [...root.querySelectorAll<HTMLElement>('[data-lane]')];

/** One lane as the DOM shows it against the golden lane it must equal. */
function expectLane(node: HTMLElement, lane: GanttLane, group: GanttGroup): void {
  expect(node.tagName).toBe('BUTTON');
  expect(node.getAttribute('data-ref')).toBe(lane.ref);
  expect(node.getAttribute('data-mark')).toBe(lane.mark);
  expect(text(node.querySelector('[data-lane-id]'))).toBe(lane.id);
  expect(text(node.querySelector('[data-lane-name]'))).toBe(lane.name);
  expect(text(node.querySelector('[data-num]'))).toBe(`${String(lane.closed)}/${String(lane.total)}`);
  // The chip sits in the label column, not behind the bar (design.md § Across viewports).
  const chip = node.querySelector('[data-label] ui-priority');
  expect(chip?.getAttribute('data-level')).toBe(lane.priority);
  const bar = node.querySelector<HTMLElement>('[data-bar]');
  if (group.window === 'none') {
    expect(bar).toBeNull();
    return;
  }
  expect(bar?.getAttribute('data-window')).toBe(group.window);
  if (group.window === 'span') {
    expect([bar?.getAttribute('data-from'), bar?.getAttribute('data-to')]).toEqual([String(group.from), String(group.to)]);
  }
  const meter = bar?.querySelector('ui-meter');
  expect([meter?.getAttribute('aria-valuenow'), meter?.getAttribute('aria-valuemax')]).toEqual([String(lane.closed), String(lane.total)]);
}

/** The whole lens against the golden: groups in order, each with its lanes in order, each lane and bar equal. */
function expectGolden(el: HTMLElement, gantt: GanttModel): void {
  expect(groups(el).map((g) => g.getAttribute('data-group'))).toEqual(gantt.groups.map(groupKey));
  for (const group of gantt.groups) {
    const node = el.querySelector<HTMLElement>(`[data-group="${groupKey(group)}"]`);
    expect(node?.getAttribute('data-window')).toBe(group.window);
    const lanes = node === null ? [] : lanesIn(node);
    expect(lanes.map((l) => l.getAttribute('data-ref'))).toEqual(group.lanes.map((l) => l.ref));
    lanes.forEach((at, i) => {
      expectLane(at, group.lanes[i], group);
    });
  }
  expect(el.querySelectorAll('[data-bar]').length).toBe(gantt.groups.filter((g) => g.window !== 'none').reduce((n, g) => n + g.lanes.length, 0));
}

describe('planning-gantt', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  for (const tree of Object.keys(CASES)) {
    it(`gantt: ${tree} draws every group, lane and bar of its gantt golden and no spec`, async () => {
      const { planning, gantt } = CASES[tree];
      const { el } = await render(planning);
      expectGolden(el, gantt);
      expect(el.querySelectorAll('[data-ref^="spec:"], [data-card]').length).toBe(0);
      expect(el.textContent).not.toMatch(/\b\d{3}-[a-z]/u);
    });
  }

  it('gantt: one boundary line per dated milestone ahead, named with its target, and one today line', async () => {
    const { planning, gantt } = CASES['backlog-ranks'];
    const { el } = await render(planning);
    const spans = gantt.groups.filter((g) => g.window === 'span');
    const bounds = [...el.querySelectorAll<HTMLElement>('[data-axis] [data-boundary]')];
    expect(bounds.map((b) => b.getAttribute('data-boundary'))).toEqual(spans.map((g) => g.ref));
    bounds.forEach((b, i) => {
      const g = spans[i];
      expect(text(b)).toBe(`${g.name ?? ''} · ${formatDay(g.target ?? '', 'en')}`);
    });
    expect(el.querySelectorAll('[data-axis] [data-today]').length).toBe(1);
    expect(text(el.querySelector('[data-axis] [data-today]'))).toContain('Today');
    expect(el.querySelector('[data-axis]')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('gantt: the months of the axis are its golden months, the past segment stands only with a past milestone', async () => {
    const ranks = await render(CASES['backlog-ranks'].planning);
    expect([...ranks.el.querySelectorAll('[data-axis] [data-month]')].map((m) => m.getAttribute('data-month'))).toEqual(CASES['backlog-ranks'].gantt.axis?.months.map((m) => m.month));
    expect(ranks.el.querySelector('[data-gantt]')?.hasAttribute('data-past')).toBe(false);
    TestBed.resetTestingModule();
    const lines = await render(CASES['milestone-lines'].planning);
    expect(lines.el.querySelector('[data-gantt]')?.hasAttribute('data-past')).toBe(true);
    const past = lines.el.querySelector<HTMLElement>('[data-group="milestone:beacon-0-5"]');
    expect(past?.getAttribute('data-mark')).toBe('done');
    expect(text(past?.querySelector('[data-group-mark]'))).toBe(en.planning.gantt.done);
  });

  it('gantt: a late milestone marks its group head overdue with the clock-alert glyph and the word', async () => {
    const { el } = await render(CASES['harbor'].planning);
    const late = el.querySelector<HTMLElement>('[data-group="milestone:harbor-0-9"]');
    expect(late?.getAttribute('data-mark')).toBe('overdue');
    const mark = late?.querySelector('[data-group-mark]');
    expect(mark?.querySelector('ui-icon')?.getAttribute('data-icon')).toBe('clock-alert');
    expect(text(mark)).toBe(en.planning.gantt.overdue);
    expect(mark?.getAttribute('title')).toBe(en.planning.gantt.overdueSince.replace('{{date}}', formatDay('2026-03-15', 'en')));
  });

  it('gantt: without a dated milestone the lens shows the hint instead of an axis, every feature below', async () => {
    const { planning, gantt } = CASES['lantern'];
    const { el } = await render(planning);
    expect(el.querySelector('[data-axis]')).toBeNull();
    expect(text(el.querySelector('[data-gantt-empty-axis]'))).toContain(en.planning.gantt.emptyAxis.heading);
    expect(lanesIn(el).map((l) => l.getAttribute('data-ref'))).toEqual(gantt.groups.flatMap((g) => g.lanes.map((l) => l.ref)));
  });

  it('gantt: a lane is one button named by feature, claims, priority and milestone; its graphic is hidden', async () => {
    const { el } = await render(CASES['backlog-ranks'].planning);
    const lane = el.querySelector<HTMLElement>('[data-lane][data-ref="feature:F2"]');
    expect(lane?.getAttribute('aria-label')).toBe(`F2 ${CASES['backlog-ranks'].planning.features[0].name}, 2 of 2 claims closed, priority P1, milestone Ferry 1.0 until ${formatDay('2026-04-15', 'en')}`);
    expect(lane?.querySelector('[data-time]')?.getAttribute('aria-hidden')).toBe('true');
    const none = el.querySelector<HTMLElement>('[data-lane][data-ref="feature:F0"]');
    expect(none?.getAttribute('aria-label')).toMatch(/, no milestone$/u);
  });

  it('gantt: a click on a lane or on its bar selects the feature, aria-current and the row look follow', async () => {
    const r = await render(CASES['backlog-ranks'].planning);
    const lane = r.el.querySelector<HTMLElement>('[data-lane][data-ref="feature:F3"]');
    lane?.querySelector<HTMLElement>('[data-bar]')?.click();
    await r.stable();
    expect(r.selection.picks).toEqual(['feature:F3']);
    expect(lane?.getAttribute('aria-current')).toBe('true');
    expect(lane?.getAttribute('data-selected')).toBe('row');
    r.el.querySelector<HTMLElement>('[data-lane][data-ref="feature:F1"] [data-label]')?.click();
    await r.stable();
    expect(r.selection.picks).toEqual(['feature:F3', 'feature:F1']);
    expect(lane?.hasAttribute('aria-current')).toBe(false);
  });

  it('gantt: the lanes hold one tab stop, and the lens docks the sidebar for its lifetime', async () => {
    const r = await render(CASES['backlog-ranks'].planning);
    const tabbable = lanesIn(r.el).filter((l) => l.tabIndex === 0);
    expect(tabbable.length).toBe(1);
    expect(r.selection.docks).toBe(1);
  });

  it('gantt: every tier draws the same groups and lanes; compact has no label column and names the window-less lane', async () => {
    for (const tier of ['compact', 'medium', 'wide'] as const) {
      const { el } = await render(CASES['backlog-ranks'].planning, tier);
      expect(el.querySelector('[data-gantt]')?.getAttribute('data-tier')).toBe(tier);
      expectGolden(el, CASES['backlog-ranks'].gantt);
      const none = el.querySelector<HTMLElement>('[data-lane][data-ref="feature:F0"]');
      expect(none?.querySelector('[data-no-window]') !== null).toBe(tier === 'compact');
      TestBed.resetTestingModule();
    }
  });
});

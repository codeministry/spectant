import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { TranslocoTestingModule } from '@jsverse/transloco';
import type { PlanningModel } from '../../../../../../core/src/planning';
import { type LensCard, type MatrixLens, planningMatrix, type RelationRef } from '../../../../../../core/src/relations';
import emptyMaster from '../../../../../../core/fixtures/empty-master.planning.golden.json';
import harbor from '../../../../../../core/fixtures/harbor.planning.golden.json';
import lantern from '../../../../../../core/fixtures/lantern.planning.golden.json';
import leadgen from '../../../../../../core/fixtures/leadgen.planning.golden.json';
import milestoneLines from '../../../../../../core/fixtures/milestone-lines.planning.golden.json';
import spectant001 from '../../../../../../core/fixtures/spectant-001.planning.golden.json';
import { CATALOGUES, LANGS } from '../../../../i18n/catalogues';
import en from '../../../../i18n/en.json';
import { DetailSelection } from '../../../layout/detail-sidebar/selection';
import { ShellState } from '../../../layout/shell/shell-state.service';
import type { Tier } from '../../../layout/shell/tier';
import { PlanningMatrix } from './planning-matrix';

// T19 · ISC-169 and T21 · ISC-169.1: the matrix lens against every planning golden. Every lane, column, card and
// number the lens draws is `planningMatrix` of the golden's own (core derives it, `core/tests/relations.test.ts` proves
// it equal to the live tree's); the view adds only layout: one swimlane at a time over the milestone pills below 640,
// all lanes from 640, finished features folded to 44 px stripes until opened, archived cards hidden until the archive
// toggle shows them. Probes:
// `bun run --cwd web test -- --filter "planning-matrix"` and `… --filter "planning-matrix multi"`.

const FIXTURES = {
  'empty-master': emptyMaster,
  harbor,
  lantern,
  leadgen,
  'milestone-lines': milestoneLines,
  'spectant-001': spectant001,
} as unknown as Record<string, PlanningModel>;

const pair = (x: { closed: number; total: number }): string => `${String(x.closed)}/${String(x.total)}`;
const laneKey = (ref: RelationRef | null): string => ref ?? 'none';
const idOf = (ref: RelationRef): string => ref.slice(ref.indexOf(':') + 1);

class FakeSelection {
  readonly current = signal<RelationRef | null>(null);
  readonly selected = this.current.asReadonly();
  readonly picks: RelationRef[] = [];
  dock(): void {
    throw new Error('the matrix never docks the sidebar');
  }
  select(ref: RelationRef): Promise<boolean> {
    this.picks.push(ref);
    this.current.set(ref);
    return Promise.resolve(true);
  }
}

@Component({ imports: [PlanningMatrix], template: `<app-planning-matrix [model]="model()" />` })
class Host {
  readonly model = signal<PlanningModel>(harbor as unknown as PlanningModel);
}

interface Rendered {
  el: HTMLElement;
  selection: FakeSelection;
  router: Router;
  stable: () => Promise<void>;
}

async function render(model: PlanningModel, tier: Tier = 'wide', url = '/'): Promise<Rendered> {
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
  const router = TestBed.inject(Router);
  await router.navigateByUrl(url);
  const fixture = TestBed.createComponent(Host);
  fixture.componentInstance.model.set(model);
  await fixture.whenStable();
  return { el: fixture.nativeElement as HTMLElement, selection, router, stable: () => fixture.whenStable() };
}

const lanes = (el: HTMLElement): HTMLElement[] => [...el.querySelectorAll<HTMLElement>('[data-lane]')];
const lane = (el: HTMLElement, key: string): HTMLElement | null => el.querySelector<HTMLElement>(`[data-lane="${key}"]`);
const cardsIn = (root: Element): HTMLElement[] => [...root.querySelectorAll<HTMLElement>('[data-card]')];
const text = (node: Element | null | undefined): string => node?.textContent.replace(/\s+/gu, ' ').trim() ?? '';

/** One card as the DOM shows it against the core card it must equal. */
function expectCard(node: HTMLElement, card: LensCard): void {
  expect(node.getAttribute('data-ref')).toBe(card.ref);
  expect(node.tagName).toBe('BUTTON');
  expect(text(node.querySelector('[data-card-id]'))).toBe(card.id);
  expect(text(node.querySelector('[data-card-title]'))).toBe(card.title);
  expect(text(node.querySelector('[data-num]'))).toBe(pair(card));
  if (card.archived) {
    expect(node.hasAttribute('data-archived')).toBe(true);
    expect(text(node.querySelector('[data-archived-chip]'))).toBe(en.planning.features.archived);
    expect(node.querySelector('[data-stage-chip]')).toBeNull();
  } else {
    expect(node.hasAttribute('data-archived')).toBe(false);
    expect(node.querySelector('[data-stage-chip]')?.getAttribute('data-stage') ?? null).toBe(card.stage);
  }
  expect([...node.querySelectorAll('[data-other-feature]')].map((chip) => chip.getAttribute('data-other-feature'))).toEqual(card.otherFeatures);
}

/** The wide grid with archived cards and every finished column shown: the whole matrix of the golden, cell by cell. */
async function expectWholeMatrix(r: Rendered, matrix: MatrixLens): Promise<void> {
  const archive = r.el.querySelector<HTMLButtonElement>('[data-show-archived]');
  if (matrix.lanes.some((l) => l.cells.flat().some((c) => c.archived))) {
    expect(archive?.getAttribute('aria-pressed')).toBe('false');
    archive?.click();
    await r.stable();
    expect(archive?.getAttribute('aria-pressed')).toBe('true');
  }
  const toggle = r.el.querySelector<HTMLButtonElement>('[data-show-done]');
  if (matrix.columns.some((c) => c.done)) {
    expect(toggle).not.toBeNull();
    toggle?.click();
    await r.stable();
    expect(toggle?.getAttribute('aria-pressed')).toBe('true');
  }
  const heads = [...r.el.querySelectorAll<HTMLElement>('[data-column]')];
  expect(heads.map((h) => h.getAttribute('data-column'))).toEqual(matrix.columns.map((c) => c.ref));
  heads.forEach((head, i) => {
    const column = matrix.columns[i];
    expect(text(head.querySelector('[data-column-id]'))).toBe(column.id);
    expect(text(head.querySelector('[data-column-name]'))).toBe(column.name);
    expect(text(head.querySelector('[data-num]'))).toBe(pair(column));
  });
  expect(lanes(r.el).map((l) => l.getAttribute('data-lane'))).toEqual(matrix.lanes.map((l) => laneKey(l.ref)));
  for (const l of matrix.lanes) {
    const node = lane(r.el, laneKey(l.ref));
    expect(node).not.toBeNull();
    if (node === null) continue;
    const head = node.querySelector<HTMLElement>('[data-lane-head]');
    expect(text(head?.querySelector('[data-lane-name]'))).toBe(l.ref === null ? en.planning.tree.noMilestone : (l.name ?? ''));
    expect(text(head?.querySelector('[data-num]'))).toBe(pair(l));
    expect(head?.querySelector('[data-spec-count]')?.getAttribute('data-spec-count')).toBe(String(l.specCount));
    const cells = [...node.querySelectorAll<HTMLElement>('[data-cell]')];
    if (l.cells.flat().length === 0) {
      expect(node.querySelector('[data-lane-empty]')).not.toBeNull();
    } else {
      expect(cells.map((c) => c.getAttribute('data-cell'))).toEqual(matrix.columns.map((c) => c.ref));
      l.cells.forEach((cell, i) => {
        const shown = cardsIn(cells[i]);
        expect(shown.length).toBe(cell.length);
        shown.forEach((card, j) => expectCard(card, cell[j]));
      });
    }
    const bare = node.querySelector('[data-bare]');
    if (l.bare.length === 0) expect(bare).toBeNull();
    else {
      expect(bare?.getAttribute('data-bare')).toBe(String(l.bare.length));
      expect([...(bare?.querySelectorAll('[data-ref]') ?? [])].map((b) => b.getAttribute('data-ref'))).toEqual(l.bare);
    }
  }
}

describe('planning-matrix', () => {
  afterEach(() => TestBed.resetTestingModule());

  for (const [name, model] of Object.entries(FIXTURES)) {
    it(`${name}: lanes, columns, cards and numbers equal the golden's matrix (wide)`, async () => {
      const matrix = planningMatrix(model);
      const r = await render(model, 'wide');
      expect(r.el.querySelector('[data-lens-matrix]')?.getAttribute('data-layout')).toBe('grid');
      await expectWholeMatrix(r, matrix);
    });

    it(`${name}: the medium tier stacks every lane with its head as a band row`, async () => {
      const matrix = planningMatrix(model);
      const r = await render(model, 'medium');
      expect(r.el.querySelector('[data-lens-matrix]')?.getAttribute('data-layout')).toBe('bands');
      expect(r.el.querySelector('[data-corner]')).toBeNull();
      expect(lanes(r.el).map((l) => l.getAttribute('data-lane'))).toEqual(matrix.lanes.map((l) => laneKey(l.ref)));
      for (const l of lanes(r.el)) expect(l.querySelector('[data-lane-head]')?.getAttribute('data-band')).toBe('');
    });
  }

  it('wide: a sticky corner and lane-head column, the grid scrolls in its own container', async () => {
    const r = await render(harbor as unknown as PlanningModel, 'wide');
    expect(r.el.querySelector('[data-corner]')).not.toBeNull();
    const wrap = r.el.querySelector<HTMLElement>('[data-matrix-scroll]');
    expect(wrap).not.toBeNull();
    expect(wrap?.querySelector('[data-lane]')).not.toBeNull();
  });

  it('finished features fold to 44 px stripes without cards until opened; a stripe opens its column', async () => {
    const model = harbor as unknown as PlanningModel;
    const matrix = planningMatrix(model, { archived: false });
    const done = matrix.columns.filter((c) => c.done);
    expect(done.length).toBeGreaterThan(0);
    const r = await render(model, 'wide');
    const stripes = [...r.el.querySelectorAll<HTMLButtonElement>('button[data-stripe]')];
    expect(stripes.map((s) => s.getAttribute('data-stripe'))).toEqual(done.map((c) => c.ref));
    for (const c of done) expect(r.el.querySelector(`[data-column="${c.ref}"]`)).toBeNull();
    const doneCards = matrix.lanes.flatMap((l) => l.cells.flatMap((cell, i) => (matrix.columns[i].done ? cell : [])));
    for (const card of doneCards) expect(r.el.querySelector(`[data-card][data-ref="${card.ref}"]`)).toBeNull();
    stripes[0].click();
    await r.stable();
    expect(r.el.querySelector(`[data-column="${done[0].ref}"]`)).not.toBeNull();
    expect(r.el.querySelector(`button[data-stripe="${done[0].ref}"]`)).toBeNull();
  });

  it('archived cards stay hidden until the archive toggle shows them; a column only they hold drops with them', async () => {
    const model = harbor as unknown as PlanningModel;
    const hidden = planningMatrix(model, { archived: false });
    const archived = planningMatrix(model).lanes.flatMap((l) => l.cells.flat()).filter((c) => c.archived);
    expect(archived.length).toBeGreaterThan(0);
    const r = await render(model, 'wide');
    r.el.querySelector<HTMLButtonElement>('[data-show-done]')?.click();
    await r.stable();
    const toggle = r.el.querySelector<HTMLButtonElement>('[data-show-archived]');
    expect(text(toggle)).toBe(en.planning.page.showArchived);
    expect(toggle?.getAttribute('aria-pressed')).toBe('false');
    expect(cardsIn(r.el).some((c) => c.hasAttribute('data-archived'))).toBe(false);
    expect([...r.el.querySelectorAll('[data-column]')].map((h) => h.getAttribute('data-column'))).toEqual(hidden.columns.map((c) => c.ref));
    toggle?.click();
    await r.stable();
    expect(toggle?.getAttribute('aria-pressed')).toBe('true');
    expect(cardsIn(r.el).filter((c) => c.hasAttribute('data-archived')).map((c) => c.getAttribute('data-ref'))).toEqual(archived.map((c) => c.ref));
  });

  it('offers no archive toggle when the workspace holds no archived spec', async () => {
    const r = await render(lantern as unknown as PlanningModel, 'wide');
    expect(r.el.querySelector('[data-show-archived]')).toBeNull();
  });

  it('archived cards are marked by a dashed border and the archived chip, never by opacity', async () => {
    const r = await render(harbor as unknown as PlanningModel, 'wide');
    r.el.querySelector<HTMLButtonElement>('[data-show-archived]')?.click();
    await r.stable();
    r.el.querySelector<HTMLButtonElement>('[data-show-done]')?.click();
    await r.stable();
    const archived = cardsIn(r.el).filter((c) => c.hasAttribute('data-archived'));
    expect(archived.length).toBeGreaterThan(0);
    for (const card of archived) expect(card.style.opacity).toBe('');
  });

  it('selection: a card selects its spec, a lane head its milestone, a column head its feature; the selected card is marked', async () => {
    const model = harbor as unknown as PlanningModel;
    const matrix = planningMatrix(model);
    const r = await render(model, 'wide');
    const card = cardsIn(r.el)[0];
    card.click();
    await r.stable();
    expect(r.selection.picks.at(-1)).toBe(card.getAttribute('data-ref'));
    expect(card.getAttribute('data-selected')).toBe('card');
    expect(r.el.querySelector('[data-lens-matrix]')?.hasAttribute('data-has-selection')).toBe(true);
    const milestone = matrix.lanes.find((l) => l.ref !== null);
    lane(r.el, laneKey(milestone?.ref ?? null))?.querySelector<HTMLElement>('[data-lane-head] [data-ref]')?.click();
    expect(r.selection.picks.at(-1)).toBe(milestone?.ref);
    const open = matrix.columns.find((c) => !c.done);
    r.el.querySelector<HTMLElement>(`[data-column="${String(open?.ref)}"] [data-ref]`)?.click();
    expect(r.selection.picks.at(-1)).toBe(open?.ref);
  });

  it('compact: one swimlane at a time, the next due milestone by default, the pills switch it through ?m=', async () => {
    const model = harbor as unknown as PlanningModel;
    const matrix = planningMatrix(model);
    const r = await render(model, 'compact');
    expect(r.el.querySelector('[data-lens-matrix]')?.getAttribute('data-layout')).toBe('single');
    const pills = [...r.el.querySelectorAll<HTMLButtonElement>('[data-m]')];
    expect(pills.map((p) => p.getAttribute('data-m'))).toEqual(matrix.lanes.map((l) => (l.ref === null ? 'none' : idOf(l.ref))));
    pills.forEach((pill, i) => expect(text(pill.querySelector('[data-pill-count]'))).toBe(String(matrix.lanes[i].specCount)));
    // harbor-0-9 is late, not complete: it is the next due milestone.
    const next = model.milestones.find((m) => m.state !== 'complete');
    expect(lanes(r.el).map((l) => l.getAttribute('data-lane'))).toEqual([`milestone:${String(next?.slug)}`]);
    expect(r.el.querySelector(`[data-m="${String(next?.slug)}"]`)?.getAttribute('aria-pressed')).toBe('true');
    const none = r.el.querySelector<HTMLButtonElement>('[data-m="none"]');
    none?.click();
    await r.stable();
    expect(new URL(r.router.url, 'http://x').searchParams.get('m')).toBe('none');
    expect(lanes(r.el).map((l) => l.getAttribute('data-lane'))).toEqual(['none']);
    const shown = matrix.lanes.find((l) => l.ref === null);
    // Finished columns stay folded to a stripe row until opened, here as on the grid.
    const open = (cells: ReadonlyArray<readonly LensCard[]>, done: boolean): string[] =>
      cells.flatMap((cell, i) => (matrix.columns[i].done === done ? cell.map((c) => c.ref) : []));
    expect(cardsIn(r.el).map((c) => c.getAttribute('data-ref'))).toEqual(open(shown?.cells ?? [], false));
    const folded = [...r.el.querySelectorAll('[data-stripe]')].map((s) => s.getAttribute('data-stripe'));
    expect(folded).toEqual(matrix.columns.filter((c, i) => c.done && (shown?.cells[i].length ?? 0) > 0).map((c) => c.ref));
    r.el.querySelector<HTMLButtonElement>('[data-show-done]')?.click();
    await r.stable();
    expect(cardsIn(r.el).map((c) => c.getAttribute('data-ref'))).toEqual(shown?.cells.flat().map((c) => c.ref));
  });

  it('compact: a ?m= in the address picks the lane on load; an unknown one falls back to the next due', async () => {
    const model = harbor as unknown as PlanningModel;
    let r = await render(model, 'compact', '/?m=harbor-1-0');
    expect(lanes(r.el).map((l) => l.getAttribute('data-lane'))).toEqual(['milestone:harbor-1-0']);
    TestBed.resetTestingModule();
    r = await render(model, 'compact', '/?m=nope');
    expect(lanes(r.el).map((l) => l.getAttribute('data-lane'))).toEqual(['milestone:harbor-0-9']);
  });

  it('a workspace without milestones has only the no-milestone lane and no pills', async () => {
    const r = await render(lantern as unknown as PlanningModel, 'compact');
    expect(r.el.querySelectorAll('[data-m]').length).toBe(0);
    expect(lanes(r.el).map((l) => l.getAttribute('data-lane'))).toEqual(['none']);
  });

  describe('planning-matrix multi', () => {
    const multi = Object.entries(FIXTURES).filter(([, model]) => planningMatrix(model).lanes.some((l) => l.cells.flat().some((c) => c.otherFeatures.length > 0)));

    it('the goldens hold a spec with claims in two features', () => {
      expect([...multi.map(([name]) => name)].sort()).toEqual(['milestone-lines', 'spectant-001']);
    });

    for (const [name, model] of multi) {
      for (const tier of ['wide', 'compact'] as const) {
        it(`${name} (${tier}): one card per spec in each lane, in its main feature's column, a chip per other feature`, async () => {
          const index = model.relations ?? {};
          const matrix = planningMatrix(model);
          const r = await render(model, tier);
          r.el.querySelector<HTMLButtonElement>('[data-show-done]')?.click();
          await r.stable();
          expect(lanes(r.el).length).toBeGreaterThan(0);
          for (const node of lanes(r.el)) {
            const refs = cardsIn(node).map((c) => c.getAttribute('data-ref') ?? '');
            expect(new Set(refs).size).toBe(refs.length);
            for (const card of cardsIn(node)) {
              const ref = card.getAttribute('data-ref') as RelationRef;
              const [main, ...others] = index[ref].parents.filter((p) => p.startsWith('feature:'));
              expect(card.closest('[data-cell]')?.getAttribute('data-cell')).toBe(main);
              const chips = [...card.querySelectorAll('[data-other-feature]')];
              expect(chips.map((chip) => chip.getAttribute('data-other-feature'))).toEqual(others);
              expect(chips.map((chip) => text(chip))).toEqual(others.map((o) => `+${idOf(o)}`));
            }
          }
          const withOthers = cardsIn(r.el).filter((c) => c.querySelector('[data-other-feature]') !== null);
          const expected = (tier === 'wide' ? matrix.lanes : matrix.lanes.filter((l) => lanes(r.el).some((n) => n.getAttribute('data-lane') === laneKey(l.ref))))
            .flatMap((l) => l.cells.flat())
            .filter((c) => c.otherFeatures.length > 0);
          expect(withOthers.map((c) => c.getAttribute('data-ref'))).toEqual(expected.map((c) => c.ref));
        });
      }
    }
  });
});

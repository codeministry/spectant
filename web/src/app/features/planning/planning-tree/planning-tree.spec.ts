import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import type { PlanningModel } from '../../../../../../core/src/planning';
import type { Relation, RelationIndex, RelationRef } from '../../../../../../core/src/relations';
import emptyMaster from '../../../../../../core/fixtures/empty-master.planning.golden.json';
import harbor from '../../../../../../core/fixtures/harbor.planning.golden.json';
import lantern from '../../../../../../core/fixtures/lantern.planning.golden.json';
import leadgen from '../../../../../../core/fixtures/leadgen.planning.golden.json';
import milestoneLines from '../../../../../../core/fixtures/milestone-lines.planning.golden.json';
import spectant001 from '../../../../../../core/fixtures/spectant-001.planning.golden.json';
import { CATALOGUES, LANGS } from '../../../../i18n/catalogues';
import en from '../../../../i18n/en.json';
import { DetailSelection } from '../../../layout/detail-sidebar/selection';
import { PlanningTree } from './planning-tree';

// T17 · ISC-168: the tree lens against every planning golden, with and without milestones. Every number a row shows
// is the relation index's own (`closed/total` of the golden's `relations[ref]`), milestones stand in the model's
// target order, the "No milestone" group comes last, archived specs carry the chip, and a workspace without
// milestones starts at the features. Probe: `bun run --cwd web test -- --filter "planning-tree"`.

const FIXTURES = {
  'empty-master': emptyMaster,
  harbor,
  lantern,
  leadgen,
  'milestone-lines': milestoneLines,
  'spectant-001': spectant001,
} as unknown as Record<string, PlanningModel>;

const index = (model: PlanningModel): RelationIndex => model.relations ?? {};
const entry = (model: PlanningModel, ref: string): Relation => index(model)[ref as RelationRef];
const pair = (relation: { closed: number; total: number }): string => `${String(relation.closed)}/${String(relation.total)}`;
const childrenOf = (model: PlanningModel, ref: string, type: string): string[] => entry(model, ref).children.filter((child) => child.startsWith(`${type}:`));
const hasMilestoneParent = (model: PlanningModel, featureId: string): boolean =>
  entry(model, `feature:${featureId}`).parents.some((parent) => parent.startsWith('milestone:'));

class FakeSelection {
  readonly current = signal<RelationRef | null>(null);
  readonly selected = this.current.asReadonly();
  readonly picks: RelationRef[] = [];
  dock(): void {
    /* the tree docks the sidebar; nothing to record here */
  }
  select(ref: RelationRef): Promise<boolean> {
    this.picks.push(ref);
    this.current.set(ref);
    return Promise.resolve(true);
  }
}

@Component({ imports: [PlanningTree], template: `<app-planning-tree [model]="model()" />` })
class Host {
  readonly model = signal<PlanningModel>(harbor as unknown as PlanningModel);
}

async function render(model: PlanningModel, sel: RelationRef | null = null): Promise<{ el: HTMLElement; selection: FakeSelection; stable: () => Promise<void> }> {
  const selection = new FakeSelection();
  selection.current.set(sel);
  TestBed.configureTestingModule({
    imports: [
      TranslocoTestingModule.forRoot({
        langs: CATALOGUES,
        translocoConfig: { availableLangs: [...LANGS], defaultLang: 'en' },
        preloadLangs: true,
      }),
    ],
    providers: [{ provide: DetailSelection, useValue: selection }],
  });
  const fixture = TestBed.createComponent(Host);
  fixture.componentInstance.model.set(model);
  await fixture.whenStable();
  return { el: fixture.nativeElement as HTMLElement, selection, stable: () => fixture.whenStable() };
}

const rows = (el: HTMLElement, kind?: string): HTMLElement[] =>
  [...el.querySelectorAll<HTMLElement>(kind === undefined ? '[role="treeitem"]' : `[role="treeitem"][data-kind="${kind}"]`)];
const num = (row: HTMLElement): string => row.querySelector('[data-num]')?.textContent.trim() ?? '';

describe('planning-tree', () => {
  for (const [name, model] of Object.entries(FIXTURES)) {
    const milestones = model.milestones;
    const loose = model.features.filter((feature) => !hasMilestoneParent(model, feature.id));

    describe(name, () => {
      it('is a WAI-ARIA tree whose milestones stand in target order, each number the golden one', async () => {
        const { el } = await render(model);
        expect(el.querySelector('[role="tree"]')).not.toBeNull();
        const ms = rows(el, 'milestone');
        expect(ms.map((row) => row.dataset['ref'])).toEqual(milestones.map((m) => `milestone:${m.slug}`));
        const targets = milestones.map((m) => m.target).filter((t): t is string => t !== null);
        expect(targets).toEqual([...targets].sort());
        for (const row of ms) {
          expect(num(row)).toBe(pair(entry(model, row.dataset['ref'] ?? '')));
          expect(row.getAttribute('aria-level')).toBe('1');
          expect(row.getAttribute('aria-expanded')).toBe('true');
        }
      });

      it('opens milestones and closes features by default; the "No milestone" group comes last', async () => {
        const { el } = await render(model);
        const top = rows(el).filter((row) => row.getAttribute('aria-level') === '1');
        if (milestones.length === 0) {
          // A workspace without milestones starts the tree at the features, with the notice above it.
          expect(rows(el, 'milestone')).toHaveLength(0);
          expect(rows(el, 'group')).toHaveLength(0);
          expect(el.querySelector('[data-no-milestones]')?.textContent).toContain(en.planning.tree.noMilestones);
          expect(top.map((row) => row.dataset['ref'])).toEqual(model.features.map((f) => `feature:${f.id}`));
        } else if (loose.length > 0) {
          expect(top.at(-1)?.dataset['kind']).toBe('group');
          expect(top.at(-1)?.textContent).toContain(en.planning.tree.noMilestone);
          expect(top.at(-1)?.hasAttribute('data-ref')).toBe(false);
        } else {
          expect(rows(el, 'group')).toHaveLength(0);
        }
        const features = rows(el, 'feature');
        const expected = [
          ...milestones.flatMap((m) => childrenOf(model, `milestone:${m.slug}`, 'feature')),
          ...(milestones.length > 0 ? loose.map((f) => `feature:${f.id}`) : model.features.map((f) => `feature:${f.id}`)),
        ];
        expect(features.map((row) => row.dataset['ref'])).toEqual(expected);
        for (const row of features) {
          expect(num(row)).toBe(pair(entry(model, row.dataset['ref'] ?? '')));
          expect(row.getAttribute('aria-level')).toBe(milestones.length > 0 ? '2' : '1');
          if (row.hasAttribute('aria-expanded')) expect(row.getAttribute('aria-expanded')).toBe('false');
        }
        expect(rows(el, 'spec')).toHaveLength(0);
        expect(rows(el, 'claim')).toHaveLength(0);
      });

      it('expands every level with closed/total from the golden and marks archived specs with the chip', async () => {
        const { el, stable } = await render(model);
        el.querySelector<HTMLButtonElement>('[data-expand-all]')?.click();
        await stable();
        const specs = rows(el, 'spec');
        const expectedSpecs = rows(el, 'feature').flatMap((row) => childrenOf(model, row.dataset['ref'] ?? '', 'spec'));
        expect(specs.map((row) => row.dataset['ref']).sort()).toEqual([...expectedSpecs].sort());
        for (const row of specs) {
          const relation = entry(model, row.dataset['ref'] ?? '');
          expect(num(row)).toBe(pair(relation));
          const chip = row.querySelector('[data-archived]');
          if (relation.archived === true) {
            expect(chip?.textContent).toContain(en.planning.features.archived);
            expect(row.querySelector('ui-icon[data-icon="archive"]')).not.toBeNull();
          } else {
            expect(chip).toBeNull();
          }
        }
        const claims = rows(el, 'claim');
        for (const row of claims) {
          const relation = entry(model, row.dataset['ref'] ?? '');
          expect(row.querySelector('ui-icon')?.getAttribute('data-icon')).toBe(relation.closed === 1 ? 'circle-check' : 'circle-dashed');
          expect(row.hasAttribute('aria-expanded')).toBe(false);
        }
        // Under each feature: its specs' claims plus the claims no spec holds, so every live claim of the feature shows.
        for (const feature of model.features) {
          const ref = `feature:${feature.id}`;
          const live = childrenOf(model, ref, 'claim').filter((claim) => entry(model, claim).total > 0);
          const shown = new Set(claims.map((row) => row.dataset['ref']));
          if (rows(el, 'feature').some((row) => row.dataset['ref'] === ref)) for (const claim of live) expect(shown.has(claim)).toBe(true);
        }
      });
    });
  }

  it('has two targets per row: the chevron toggles, the rest of the row selects', async () => {
    const model = FIXTURES['harbor'];
    const { el, selection, stable } = await render(model);
    const feature = (): HTMLElement => rows(el, 'feature').find((row) => row.dataset['ref'] === 'feature:F3') as HTMLElement;
    feature().querySelector<HTMLElement>('[data-toggle]')?.click();
    await stable();
    expect(feature().getAttribute('aria-expanded')).toBe('true');
    expect(selection.picks).toEqual([]);
    expect(rows(el, 'spec').map((row) => row.dataset['ref'])).toEqual(childrenOf(model, 'feature:F3', 'spec'));
    feature().querySelector<HTMLElement>('.title')?.click();
    await stable();
    expect(selection.picks).toEqual(['feature:F3']);
    expect(feature().getAttribute('data-selected')).toBe('row');
    expect(feature().getAttribute('aria-selected')).toBe('true');
  });

  it('a deep link ?sel= opens the path to the selected claim', async () => {
    const model = FIXTURES['harbor'];
    const spec = childrenOf(model, 'feature:F3', 'spec')[0] ?? '';
    const claim = childrenOf(model, spec, 'claim')[0] as RelationRef;
    const { el } = await render(model, claim);
    const row = rows(el, 'claim').find((r) => r.dataset['ref'] === claim);
    expect(row?.getAttribute('data-selected')).toBe('row');
    expect(row?.getAttribute('tabindex')).toBe('0');
    expect(rows(el, 'spec').find((r) => r.dataset['ref'] === spec)?.getAttribute('aria-expanded')).toBe('true');
    expect(rows(el, 'feature').find((r) => r.dataset['ref'] === 'feature:F3')?.getAttribute('aria-expanded')).toBe('true');
  });

  it('moves with the arrow keys and selects with Enter', async () => {
    const model = FIXTURES['milestone-lines'];
    const { el, selection, stable } = await render(model);
    const tree = el.querySelector<HTMLElement>('[role="tree"]') as HTMLElement;
    const first = rows(el)[0];
    expect(first.getAttribute('tabindex')).toBe('0');
    first.focus();
    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    await stable();
    const second = rows(el)[1];
    expect(document.activeElement).toBe(second);
    second.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await stable();
    expect(rows(el)[1]?.getAttribute('aria-expanded')).toBe(second.hasAttribute('aria-expanded') ? 'true' : null);
    (rows(el)[1]).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await stable();
    expect(selection.picks).toEqual([rows(el)[1]?.dataset['ref']]);
    expect(tree.contains(document.activeElement)).toBe(true);
  });
});

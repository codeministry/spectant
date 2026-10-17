import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import type { PlanningModel } from '../../../../../../core/src/planning';
import type { Relation, RelationIndex, RelationRef } from '../../../../../../core/src/relations';
import backlogRanks from '../../../../../../core/fixtures/backlog-ranks.planning.golden.json';
import emptyMaster from '../../../../../../core/fixtures/empty-master.planning.golden.json';
import harbor from '../../../../../../core/fixtures/harbor.planning.golden.json';
import lantern from '../../../../../../core/fixtures/lantern.planning.golden.json';
import leadgen from '../../../../../../core/fixtures/leadgen.planning.golden.json';
import milestoneLines from '../../../../../../core/fixtures/milestone-lines.planning.golden.json';
import spectant001 from '../../../../../../core/fixtures/spectant-001.planning.golden.json';
import { CATALOGUES, LANGS } from '../../../../i18n/catalogues';
import en from '../../../../i18n/en.json';
import { DetailSelection } from '../../../layout/detail-sidebar/selection';
import { formatDay } from '../../../shared/time';
import { PlanningTree } from './planning-tree';

// T17 · ISC-168: the tree lens against every planning golden, with and without milestones. Every number a row shows
// is the relation index's own (`closed/total` of the golden's `relations[ref]`), milestones stand in the model's
// target order, the "No milestone" group comes last, archived specs stay hidden until the archive toggle shows them
// and then carry the chip, and a workspace without milestones starts at the features. Probe: `bun run --cwd web test -- --filter "planning-tree"`.

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
  readonly heldFocus = signal<RelationRef | null>(null);
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

      it('hides archived specs until the archive toggle shows them, offered only when the model holds one', async () => {
        const { el, stable } = await render(model);
        el.querySelector<HTMLButtonElement>('[data-expand-all]')?.click();
        await stable();
        const archived = Object.values(index(model)).filter((r) => r.type === 'spec' && r.archived === true);
        const toggle = el.querySelector<HTMLButtonElement>('[data-show-archived]');
        expect(rows(el, 'spec').some((row) => row.hasAttribute('data-archived-row'))).toBe(false);
        if (archived.length === 0) {
          expect(toggle).toBeNull();
          return;
        }
        expect(toggle?.textContent).toContain(en.planning.page.showArchived);
        expect(toggle?.getAttribute('aria-pressed')).toBe('false');
        toggle?.click();
        await stable();
        expect(toggle?.getAttribute('aria-pressed')).toBe('true');
        // A feature that held only archived specs had nothing to open before; expand again to reach it.
        el.querySelector<HTMLButtonElement>('[data-expand-all]')?.click();
        await stable();
        const shown = new Set(rows(el, 'spec').filter((row) => row.hasAttribute('data-archived-row')).map((row) => row.dataset['ref']));
        // Every archived spec a feature holds shows again (a spec without a feature has no row in any case).
        const held = archived.filter((r) => r.parents.some((parent) => parent.startsWith('feature:'))).map((r) => r.ref);
        expect([...shown].sort()).toEqual(held.sort());
      });

      it('hides the features without a spec row on the empty-feature toggle, offered only when the tree shows one', async () => {
        const { el, stable } = await render(model);
        const holdsSpec = (ref: string): boolean => childrenOf(model, ref, 'spec').some((spec) => entry(model, spec).archived !== true);
        const before = rows(el, 'feature').map((row) => row.dataset['ref'] ?? '');
        const toggle = el.querySelector<HTMLButtonElement>('[data-hide-empty]');
        if (before.every(holdsSpec)) {
          expect(toggle).toBeNull();
          return;
        }
        expect(toggle?.textContent).toContain(en.planning.tree.hideEmpty);
        expect(toggle?.getAttribute('aria-pressed')).toBe('false');
        toggle?.click();
        await stable();
        expect(toggle?.getAttribute('aria-pressed')).toBe('true');
        expect(rows(el, 'feature').map((row) => row.dataset['ref'])).toEqual(before.filter(holdsSpec));
        // Milestones stay, emptied or not; the "No milestone" group leaves with its last feature.
        expect(rows(el, 'milestone')).toHaveLength(milestones.length);
        if (!loose.some((f) => holdsSpec(`feature:${f.id}`))) expect(rows(el, 'group')).toHaveLength(0);
        toggle?.click();
        await stable();
        expect(rows(el, 'feature').map((row) => row.dataset['ref'])).toEqual(before);
      });

      it('expands every level with closed/total from the golden and marks archived specs with the chip', async () => {
        const { el, stable } = await render(model);
        el.querySelector<HTMLButtonElement>('[data-show-archived]')?.click();
        await stable();
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

  it('shows each milestone target as a calendar day: a <time> with the ISO day, in the short date form (ISC-114.3)', async () => {
    const model = harbor as unknown as PlanningModel;
    const { el } = await render(model);
    const targets = model.milestones.map((m) => m.target).filter((t): t is string => t !== null);
    const times = rows(el, 'milestone').map((row) => row.querySelector('.date time'));

    expect(targets.length).toBeGreaterThan(0);
    expect(times.map((time) => time?.getAttribute('datetime'))).toEqual(targets);
    expect(times.map((time) => time?.textContent)).toEqual(targets.map((target) => formatDay(target, 'en')));
  });
});

// T1 · ISC-193: the milestone header. A milestone row is a tinted header on its own grid (chevron, flag, name, date,
// then fraction and meter at the end, no "MILESTONE" overline, the accessible name starting with "Milestone"); the
// feature, spec and claim rows keep their grid on the card surface. The unit tier has no cascade, so the stylesheet
// half reads the component's compiled CSS as text: the tint, the 4 px bar and the display type sit on the milestone
// rule only, every colour is a theme token, and the stray `--cyan-text`, `--lime-text` and `var(--border)` are gone.
// Probe: `bun run --cwd web test -- --filter "milestone header"` plus `bun run lint:css`.

interface CssRule {
  readonly selectors: readonly string[];
  readonly body: string;
}

/**
 * The planning tree's own compiled stylesheet as Angular ships it (`ɵcmp.styles`), with comments, the encapsulation
 * attributes, the custom-property namespace placeholder (`--%NS%name`) and quotes stripped.
 */
function treeCss(): string {
  const styles = (PlanningTree as unknown as { ɵcmp: { styles: readonly string[] } }).ɵcmp.styles;
  return styles
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\[_ng(?:content|host)-[^\]]*\]/g, '')
    .replace(/%NS%/g, '')
    .replace(/["']/g, '');
}

/** Every innermost `selector { body }` block (rules inside `@container` and `@media` included), selectors normalised. */
function cssRules(css: string): CssRule[] {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selectors: m[1].split(',').map((s) => s.trim().replace(/\s+/g, ' ')),
    body: m[2].replace(/\s+/g, ' ').replace(/\s*:\s*/g, ': ').replace(/\s*;\s*/g, '; '),
  }));
}

const declared = (rules: readonly CssRule[], selector: string): string =>
  rules
    .filter((rule) => rule.selectors.includes(selector))
    .map((rule) => rule.body)
    .join(' ');

const MILESTONE = '.row[data-kind=milestone]';
const GROUP = '.row[data-kind=group]';

describe('planning-tree milestone header', () => {
  it('milestone header: a milestone row runs chevron, flag, name, date, then fraction and meter; the other rows keep their grid', async () => {
    const model = FIXTURES['harbor'];
    const { el, stable } = await render(model);
    el.querySelector<HTMLButtonElement>('[data-expand-all]')?.click();
    await stable();
    const order = (row: HTMLElement): string[] =>
      [...row.children].map((child) => ['chev', 'main', 'num', 'bar', 'guides', 'prio'].find((name) => child.classList.contains(name)) ?? child.tagName.toLowerCase());
    const part = (node: HTMLElement): string => (node.classList.contains('name') ? 'name' : node.classList.contains('date') ? 'date' : 'flag');

    const milestones = rows(el, 'milestone');
    expect(milestones.length).toBeGreaterThan(0);
    for (const row of milestones) {
      expect(order(row)).toEqual(['chev', 'main', 'num', 'bar']);
      const parts = [...row.querySelectorAll<HTMLElement>('.main ui-icon[data-icon="flag"], .main .name, .main .date')].map(part);
      expect(parts).toEqual(row.querySelector('.date') === null ? ['flag', 'name'] : ['flag', 'name', 'date']);
      expect(row.textContent).not.toMatch(/MILESTONE/);
      expect(row.textContent.trim().startsWith(en.planning.tree.milestone)).toBe(true);
    }
    for (const row of rows(el, 'group')) expect(order(row)).toEqual(['chev', 'main', 'num', 'bar']);
    const features = rows(el, 'feature');
    const specs = rows(el, 'spec');
    const claims = rows(el, 'claim');
    expect(features.length * specs.length * claims.length).toBeGreaterThan(0);
    for (const row of features) expect(order(row)).toEqual(['bar', 'num', 'guides', 'chev', 'main', 'prio']);
    for (const row of specs) expect(order(row)).toEqual(['bar', 'num', 'guides', 'chev', 'main']);
    for (const row of claims) expect(order(row)).toEqual(['guides', 'chev', 'main']);
  });

  it('milestone header: tint surface, 4 px primary bar and display type on the milestone rule only; the other rows stay on the card', () => {
    const css = treeCss();
    const rules = cssRules(css);
    expect(rules.length).toBeGreaterThan(0);

    const head = declared(rules, MILESTONE);
    expect(head).toMatch(/background(?:-color)?: var\(--disp-t\)/);
    expect(head).toMatch(/box-shadow: inset 4px 0 0 var\(--color-primary\)/);
    expect(head).toMatch(/min-block-size: 56px/);
    const name = declared(rules, '.name');
    expect(name).toMatch(/font-family: var\(--font-display\)/);
    expect(name).toMatch(/font-size: 16px/);
    expect(name).toMatch(/line-height: 24px/);
    expect(name).toMatch(/font-weight: 600/);
    // Text and icons on the tint stand in the content colour: the chevron, the flag, the date and the fraction.
    for (const piece of ['.chev', '.kind', '.date', '.num']) expect(declared(rules, `${MILESTONE} ${piece}`)).toMatch(/color: var\(--color-base-content\)/);
    // The ring sits inside, as the card clips everything outside; forced colours keep the 3 px CanvasText edge.
    expect(declared(rules, `${MILESTONE}:focus-visible`)).toMatch(/outline-offset: -2px/);
    expect(css).toMatch(/border-inline-start:\s*3px solid canvastext/i);

    // The tint belongs to the milestone row alone: no other row rule paints it, and hover never swaps it away.
    const rowRules = rules.filter((rule) => rule.selectors.some((s) => s.startsWith('.row') && !s.includes(' ')));
    for (const rule of rowRules) {
      if (rule.body.includes('background: var(--disp-t)')) expect(rule.selectors.every((s) => s.includes('milestone'))).toBe(true);
      if (rule.body.includes('background')) {
        for (const kind of ['feature', 'spec', 'claim']) expect(rule.selectors.some((s) => s.includes(`[data-kind=${kind}]`))).toBe(false);
      }
      if (rule.selectors.some((s) => s.includes(':hover')) && rule.body.includes('background') && !rule.body.includes('var(--disp-t)')) {
        expect(rule.selectors.every((s) => s.includes(':not([data-kind=milestone])'))).toBe(true);
      }
    }
    expect(declared(rules, '.row')).not.toMatch(/background/);
    expect(declared(rules, '.tree')).toMatch(/background: var\(--color-base-100\)/);

    // The neutral "No milestone" group: card surface, a track bar, the name in muted ink.
    const group = declared(rules, GROUP);
    expect(group).toMatch(/background(?:-color)?: var\(--color-base-100\)/);
    expect(group).toMatch(/box-shadow: inset 4px 0 0 var\(--track\)/);
    expect(group).toMatch(/border-block-start-style: dashed/);
    expect(declared(rules, `${GROUP} .name`)).toMatch(/color: var\(--muted-ink\)/);

    // Every colour is a theme token: the F-ID in `--disp-ink`, the tick and the full fraction in `--clos-ink`, the
    // hairlines in `--line`; nothing undefined and no hex literal.
    expect(declared(rules, '.fid')).toMatch(/color: var\(--disp-ink\)/);
    expect(declared(rules, '.done')).toMatch(/color: var\(--clos-ink\)/);
    expect(declared(rules, '.row[data-full] .num')).toMatch(/color: var\(--clos-ink\)/);
    expect(declared(rules, '.row')).toMatch(/border-block-start: 1px solid var\(--line\)/);
    expect(css).not.toMatch(/--cyan-text|--lime-text|var\(--border\)/);
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });
});

// T10 · ISC-194: the tree lens shows the features of every milestone and of the "No milestone" group in the rank order
// of the planning model, each with one priority chip `P1` to `P4` in its own column at the row's end. Probe:
// `bun run --cwd web test -- --filter "tree rank"`.
describe('planning-tree tree rank', () => {
  const BACKLOG = backlogRanks as unknown as PlanningModel;

  it('tree rank: the feature rows stand in rank order under each milestone and the group, as in the golden', async () => {
    const { el } = await render(BACKLOG);
    const shown = rows(el).filter((row) => ['milestone', 'group', 'feature'].includes(row.dataset['kind'] ?? ''));
    expect(shown.map((row) => (row.dataset['kind'] === 'feature' ? row.querySelector('.fid')?.textContent.trim() : row.dataset['key']))).toEqual([
      'milestone:ferry-1-0',
      ...(BACKLOG.milestones[0]?.featureIds ?? []),
      'milestone:ferry-2-0',
      ...(BACKLOG.milestones[1]?.featureIds ?? []),
      'group',
      ...(BACKLOG.unassignedFeatures ?? []),
    ]);
  });

  it('tree rank: every feature row carries one priority chip with its level, no other row carries one', async () => {
    const { el } = await render(BACKLOG);
    const levels = Object.fromEntries(BACKLOG.features.map((f) => [f.id, f.priority]));
    for (const row of rows(el, 'feature')) {
      const chips = row.querySelectorAll('.prio ui-priority');
      expect(chips).toHaveLength(1);
      expect(chips.item(0).getAttribute('data-level')).toBe(levels[row.querySelector('.fid')?.textContent.trim() ?? '']);
    }
    expect(rows(el, 'feature')).toHaveLength(BACKLOG.features.length);
    for (const kind of ['milestone', 'group', 'spec', 'claim']) for (const row of rows(el, kind)) expect(row.querySelector('ui-priority')).toBeNull();
  });
});

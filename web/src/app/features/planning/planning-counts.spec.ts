import { describe, expect, it } from 'vitest';
import type { PlanningModel } from '../../../../../core/src/planning';
import HARBOR from '../../../../../core/fixtures/harbor.planning.golden.json';
import { isPlanningLensId, PLANNING_LENSES, planningTabs } from '../../layout/shell/page-tabs';
import { planningCounts } from './planning-counts';

const harbor = HARBOR as unknown as PlanningModel;

describe('planning lenses (spec 026, ISC-167)', () => {
  it('registers Matrix, Tree and Graph in tab order, routed under /w/:ws/planning, keeping the query', () => {
    expect(PLANNING_LENSES).toEqual(['board', 'tree', 'graph']);
    const tabs = planningTabs('harbor');
    expect(tabs.map((tab) => tab.link)).toEqual([
      ['/w', 'harbor', 'planning', 'board'],
      ['/w', 'harbor', 'planning', 'tree'],
      ['/w', 'harbor', 'planning', 'graph'],
    ]);
    expect(tabs.map((tab) => tab.icon)).toEqual(['layout-grid', 'list-tree', 'share-2']);
    expect(tabs.map((tab) => tab.labelKey)).toEqual(['planning.page.lenses.board', 'planning.page.lenses.tree', 'planning.page.lenses.graph']);
    expect(tabs.every((tab) => tab.keepQuery === true)).toBe(true);
    expect(isPlanningLensId('board')).toBe(true);
    expect(isPlanningLensId('matrix')).toBe(false);
  });

  it('counts the levels of the harbor golden: named milestones, features, distinct specs, the recount', () => {
    const specs = new Set(harbor.features.flatMap((feature) => feature.holders.map((holder) => holder.slug)));
    expect(planningCounts(harbor)).toEqual({
      milestones: harbor.milestones.filter((milestone) => milestone.specs.length > 0).length,
      features: harbor.features.length,
      specs: specs.size,
      closed: harbor.recount?.closed,
      total: harbor.recount?.total,
    });
  });
});

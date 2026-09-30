// Test helper: the `planning` golden family (`<tree>.planning.golden.json`, spec 003 T8, ISC-100). `buildPlanning`
// over a fixture tree read as the server reads a workspace, with the clock pinned so the milestone state (late,
// upcoming, complete) does not move with the day the suite runs. One helper, so golden.test.ts and planning.test.ts
// build the very same model.
import { join } from 'node:path';

import { buildPlanning } from '../../src/planning.ts';
import type { PlanningModel } from '../../src/planning.ts';
import { FIXTURES, readTreeAt } from './read-tree.ts';

/**
 * The fixed "today" of every planning golden: after harbor's `Harbor 0.9` target (2026-03-15) and before
 * `Harbor 1.0` (2026-05-14), so the fixtures show one late and one upcoming milestone once milestones are derived.
 */
export const PLANNING_NOW = '2026-03-20';

/** The planning model of any tree root. */
export function planningModel(root: string): PlanningModel {
  const { master, specs, archived } = readTreeAt(root);
  return buildPlanning({ master, specs, archived, now: PLANNING_NOW });
}

/** The planning model of a fixture tree by name. */
export const planningOf = (tree: string): PlanningModel => planningModel(join(FIXTURES, tree));

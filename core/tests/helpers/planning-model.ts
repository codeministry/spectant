// Test helper: the `planning` golden family (`<tree>.planning.golden.json`, spec 003 T8, ISC-100). `buildPlanning`
// over a fixture tree read as the server reads a workspace, with the clock pinned so the milestone state (late,
// upcoming, complete) does not move with the day the suite runs. One helper, so golden.test.ts and planning.test.ts
// build the very same model.
//
// Spec 008 (T64): the tree also carries the board, so the helper passes what a caller holds and the browser-safe tree
// cannot derive: the workspace's workflow, and per active spec the dashboard row's stage and source (the dashboard of
// the same input, as its golden is built) with the raw sha256 of spec.md, the hash the server's writes compare.
import { createHash } from 'node:crypto';
import { join } from 'node:path';

import { buildDashboard } from '../../src/dashboard.ts';
import { buildPlanning } from '../../src/planning.ts';
import type { PlanningModel, PlanningSpecState } from '../../src/planning.ts';
import { FIXTURES, ideaFilesAt, readTreeAt } from './read-tree.ts';

/**
 * The fixed "today" of every planning golden: after harbor's `Harbor 0.9` target (2026-03-15) and before
 * `Harbor 1.0` (2026-05-14), so the fixtures show one late and one upcoming milestone once milestones are derived.
 */
export const PLANNING_NOW = '2026-03-20';

/** The planning model of any tree root, its story folder `specs/ideas/`, workflow and spec states included. */
export function planningModel(root: string): PlanningModel {
  const input = readTreeAt(root);
  const { master, specs, archived, workflow } = input;
  const texts = new Map(specs.map((f) => [f.folder, f.texts.spec]));
  const specStates = buildDashboard(input).specs.map((row): PlanningSpecState => {
    const spec = texts.get(row.slug);
    return { slug: row.slug, stage: row.stage, stageSource: row.stageSource, ...(spec === undefined ? {} : { hash: createHash('sha256').update(spec, 'utf8').digest('hex') }) };
  });
  return buildPlanning({ master, specs, archived, ideas: ideaFilesAt(root), now: PLANNING_NOW, ...(workflow === undefined ? {} : { workflow }), specStates });
}

/** The planning model of a fixture tree by name. */
export const planningOf = (tree: string): PlanningModel => planningModel(join(FIXTURES, tree));

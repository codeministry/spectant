// The `state` golden family (spec 040, T10, ISC-221): `itemStates` over a fixture tree at the live family's clock, with
// the tree's `.spectant/activity.jsonl` reading (no LifeOS state directory) and the default abort age of 120 minutes.
// The dashboard is built with that reading, so a claim a lock holds is taken there too; each spec's task runs are the
// ones its live frame folds (`LiveCard.run`), the single place the run events are matched to a spec's tasks.
import { join } from 'node:path';

import { buildDashboard } from '../../src/dashboard.ts';
import type { ItemStateInfo, LockReading, TaskRun } from '../../src/files.ts';
import { DEFAULT_ABORT_AFTER_MS, itemStates } from '../../src/item-state.ts';
import type { ItemStateInput } from '../../src/item-state.ts';
import { buildLiveFrame } from '../../src/live.ts';
import { readLockSources } from '../../src/locks.ts';
import { specIdOf } from '../../src/spec-ref.ts';
import { FIXTURES, fixtureTrees, readTreeAt } from './read-tree.ts';

/** The live family's clock (`LIVE_NOW` in golden.test.ts): beacon's "minutes before the clock" count from it. */
export const STATE_NOW = new Date('2026-03-08T15:00:00Z');

/** Each tree's lock reading from the real reader, read once up front since the golden families are synchronous. */
const LOCKS = new Map(await Promise.all(fixtureTrees().map(async (tree) => [join(FIXTURES, tree), await readLockSources({ repoRoot: join(FIXTURES, tree) })] as const)));

/** The item-state input of any fixture tree root. */
export function stateInputAt(root: string): ItemStateInput {
  const locks = LOCKS.get(root) as LockReading;
  const workspace = { ...readTreeAt(root), locks };
  const taskRuns: Record<string, readonly TaskRun[]> = {};
  for (const files of workspace.specs) {
    if (files.texts.spec === undefined) continue;
    const frame = buildLiveFrame({ files, locks, now: STATE_NOW });
    taskRuns[specIdOf(files.folder) ?? files.folder] = frame.cards.flatMap((card) => (card.run == null ? [] : [card.run]));
  }
  return { workspace, dashboard: buildDashboard(workspace), taskRuns, now: STATE_NOW, abortAfterMs: DEFAULT_ABORT_AFTER_MS };
}

/** The `state` family: every item's state of the tree. */
export const stateModel = (root: string): readonly ItemStateInfo[] => itemStates(stateInputAt(root));

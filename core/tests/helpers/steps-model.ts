// The `steps` model of a fixture tree (spec 015, ISC-231): `taskSteps` per spec folder in `listSpecs` order, keyed by
// tree-relative folder path, over one lock reading of the tree. golden.test.ts and steps.test.ts both build it here.
import { basename, dirname, relative, sep } from 'node:path';

import type { LockReading, SpecFiles, TaskSteps } from '../../src/files.ts';
import { listSpecs } from '../../src/resolve.ts';
import { taskSteps } from '../../src/steps.ts';
import { folders } from './read-tree.ts';

export function stepsModel(root: string, reading: LockReading): Record<string, TaskSteps> {
  const byParent = new Map<string, readonly SpecFiles[]>();
  const out: Record<string, TaskSteps> = {};
  for (const ref of listSpecs(root)) {
    const parent = dirname(ref.dir);
    const read = byParent.get(parent) ?? folders(parent);
    byParent.set(parent, read);
    const files = read.find((f) => f.folder === basename(ref.dir));
    if (files === undefined) throw new Error(`listSpecs and the fixture reader disagree on ${ref.dir}`);
    out[relative(root, ref.dir).split(sep).join('/')] = taskSteps(reading, files);
  }
  return out;
}

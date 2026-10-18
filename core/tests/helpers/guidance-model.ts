// The `guidance` model of a fixture tree (spec 020, ISC-237): `guidanceOf` over the item-state input of
// helpers/state-model.ts, so the guidance reads the same items at the same clock (`STATE_NOW`) and with the same
// activity reading as the `state` golden family. guidance.test.ts asserts it; the golden family `guidance` registers it.
import type { Guidance } from '../../src/files.ts';
import { guidanceOf } from '../../src/guidance.ts';
import { itemStates } from '../../src/item-state.ts';
import { stateInputAt } from './state-model.ts';

/** The workspace guidance of the fixture tree at `root`. */
export function guidanceModel(root: string): Guidance {
  const input = stateInputAt(root);
  return guidanceOf({ workspace: input.workspace, dashboard: input.dashboard, items: itemStates(input) });
}

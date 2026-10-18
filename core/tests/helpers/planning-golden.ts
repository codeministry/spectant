// Test helper: the model of the `planning` golden family (spec 040, ISC-224): `planningModel` with each story's `idea`
// item of the `state` family as `IdeaRef.state`, attached by `withIdeaStates` as the planning route attaches it. Apart
// from planning-model.ts because this module imports state-model.ts, whose lock readings are awaited at load, and the
// e2e stub requires planning-model.ts synchronously. A tree root that is no fixture tree has no state reading: its
// model carries no state.
import { join } from 'node:path';

import { withIdeaStates } from '../../src/item-state.ts';
import type { PlanningModel } from '../../src/planning.ts';
import { planningModel } from './planning-model.ts';
import { FIXTURES } from './read-tree.ts';
import { hasStateModel, stateModel } from './state-model.ts';

/** The planning golden's model of any tree root. */
export const planningGolden = (root: string): PlanningModel => (hasStateModel(root) ? withIdeaStates(planningModel(root), stateModel(root)) : planningModel(root));

/** The planning golden's model of a fixture tree by name. */
export const planningGoldenOf = (tree: string): PlanningModel => planningGolden(join(FIXTURES, tree));

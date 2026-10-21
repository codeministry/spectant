import { computed, type Signal } from '@angular/core';
import type { SpecPageModel } from '../../../../../core/src/files';
import { type GateAction, gateAction } from './spec-head-model';

/** The open spec's review gate: the live lock on it and what the gate button offers (`gateAction`). */
export interface ReviewGate {
  readonly lock: Signal<SpecPageModel['areas']['live']['lock'] | null>;
  readonly action: Signal<GateAction | null>;
}

/**
 * The review gate of a spec payload signal (spec 061): the gate button and the Status tab's store read the same lock
 * and the same action from it; null while there is no payload. Call it in a field initialiser.
 */
export function reviewGate(model: Signal<SpecPageModel | null>): ReviewGate {
  const lock = computed(() => model()?.areas.live.lock ?? null);
  const action = computed<GateAction | null>(() => {
    const current = model();
    return current ? gateAction(current.gates.reviewed, lock()) : null;
  });
  return { lock, action };
}

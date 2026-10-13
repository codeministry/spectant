import { ChangeDetectionStrategy, Component, computed, effect, inject, Injectable, input, signal } from '@angular/core';
import type { CardState, FrameCard, GateView, LiveCard, SpecPageModel } from '../../../../../core/src/files';
import { ShellData } from '../../layout/shell/shell-data.service';
import { GateButton } from '../../layout/spec-head/gate-button';
import type { ScrubberFrame, ScrubberMarker } from '../../shared/ui/scrubber/scrubber';

/**
 * Static sample inputs for the state galleries of `/__ui` (T55; prototype `states.html`, `board-states.html`). The
 * gallery is a dev surface, not a product page: these are literal inputs to the app's own components, never read from
 * a workspace, never written anywhere, and they carry no demo chip.
 */

const MINUTE = 60_000;

/** One board card in the given state; the other fields are the prototype's T12 sample. */
export function sampleCard(task: string, state: CardState, extra: Partial<FrameCard> = {}): FrameCard {
  return {
    task,
    claim: 'ISC-333',
    lane: 'web',
    text: 'Keep the ETag poll or move to SSE now?',
    parallel: false,
    seam: false,
    state,
    tries: 1,
    ...extra,
  };
}

/** Every card state, in the order of the prototype's "Every task state" mini, then the four the app adds. */
export const EVERY_CARD_STATE: readonly CardState[] = [
  'waiting',
  'dispatched',
  'running',
  'question',
  'concerns',
  'fail',
  'done',
  'closed',
  'absent',
  'operatorOpen',
  'operatorDone',
];

export const WAITING_CARDS: readonly FrameCard[] = ['T1', 'T2', 'T3', 'T4', 'T5'].map((task) =>
  sampleCard(task, 'waiting', { text: 'Waits for the plan', reason: 'plan not run yet', lane: 'core' }),
);

export const LANDED_CARDS: readonly FrameCard[] = ['T3', 'T9', 'T11'].map((task) =>
  sampleCard(task, 'done', { lane: 'core', text: 'Parser reads the stage line', builder: 'Engineer' }),
);

/** A running card whose lock is older than the stale threshold (prototype "Stale agent"). */
export const STALE_CARD: LiveCard = {
  ...sampleCard('T22', 'running', { claim: 'ISC-336', builder: 'Engineer', lock: { source: 'activity', session: 'spec-002-ISC-336' } }),
  since: new Date(Date.now() - 47 * MINUTE).toISOString(),
  elapsedMs: 47 * MINUTE,
  stale: true,
  agent: null,
  subagent: null,
};

export const ACTIVE_SINCE = new Date(Date.now() - 4 * MINUTE).toISOString();
export const STALE_SINCE = new Date(Date.now() - 47 * MINUTE).toISOString();

/** "No rounds yet": one hollow live tick. */
export const IDLE_FRAMES: readonly ScrubberFrame[] = [{ kind: 'live', label: 'Live · idle', caption: 'Live · idle' }];

/** "Re-cut marker": three rounds, tasks.md renumbered after R2. */
export const RECUT_FRAMES: readonly ScrubberFrame[] = [
  { kind: 'dispatch', label: 'R1 dispatch' },
  { kind: 'result', label: 'R1 result', tone: 'success', caption: 'R1' },
  { kind: 'dispatch', label: 'R2 dispatch' },
  { kind: 'result', label: 'R2 result', tone: 'success', caption: 'R2' },
  { kind: 'dispatch', label: 'R3 dispatch' },
  { kind: 'result', label: 'R3 result', tone: 'success', caption: 'R3' },
  { kind: 'live', label: 'Live', caption: 'Live' },
];
export const RECUT_MARKERS: readonly ScrubberMarker[] = [{ before: 4, label: 're-cut', title: 'tasks re-cut after R2 · 28 → 26 · T27 T28 struck' }];

export type GateSample = 'ready' | 'stale' | 'done' | 'paused';

const GATE_VIEWS: Readonly<Record<GateSample, GateView>> = {
  ready: { state: 'missing', detail: '' },
  stale: { state: 'stale', detail: '', at: new Date(Date.now() - 90 * MINUTE).toISOString(), files: ['specs/002-dashboard/plan.md', 'specs/002-dashboard/tasks.md'] },
  done: { state: 'fresh', detail: '', at: new Date(Date.now() - 12 * MINUTE).toISOString() },
  paused: { state: 'missing', detail: '' },
};

/** The one slice of `SpecPageModel` the gate button reads: the reviewed gate and the live lock. */
function gateModel(sample: GateSample): SpecPageModel {
  const lock = sample === 'paused' ? { source: 'activity', claim: 'ISC-333', session: 'spec-002-ISC-333', since: ACTIVE_SINCE } : null;
  return { gates: { reviewed: GATE_VIEWS[sample] }, areas: { live: { lock } } } as unknown as SpecPageModel;
}

/** A `ShellData` stand-in whose `spec` resource answers with a fixed model; no request is ever made. */
@Injectable()
class GallerySpecData {
  readonly body = signal<SpecPageModel | null>(null);
  readonly spec = {
    value: computed(() => {
      const body = this.body();
      return body ? { kind: 'ok' as const, body, etag: null, notModified: false } : undefined;
    }),
  };
}

/** The app's real gate button in one of its four states, fed by `GallerySpecData`. */
@Component({
  selector: 'app-gallery-gate',
  imports: [GateButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [GallerySpecData, { provide: ShellData, useExisting: GallerySpecData }],
  host: { '[attr.data-gate-sample]': 'state()' },
  template: `<app-gate-button />`,
})
export class GalleryGate {
  readonly state = input.required<GateSample>();
  private readonly data = inject(GallerySpecData);

  constructor() {
    effect(() => this.data.body.set(gateModel(this.state())));
  }
}

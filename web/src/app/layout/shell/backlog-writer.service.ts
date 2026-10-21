import { computed, inject, Injectable, InjectionToken, signal } from '@angular/core';
import type { Priority } from '../../../../../core/src/files';
import type { PlanningModel } from '../../../../../core/src/planning';
import { ApiClient, type BacklogOp } from '../../core/api.service';
import { ShellData } from './shell-data.service';
import { ShellState } from './shell-state.service';
import type { BacklogRefusal } from '../../shared/ui/refusal-notice/refusal';
import { featureOrder } from '../../core/model/feature-order';

export type { BacklogRefusal };

/**
 * How long a backlog write may go unanswered, in ms, before the writer settles it as `failed` with status 0 (T20,
 * ISC-198; plan 037 § Risks): the held row must never stay `aria-busy` for good. Tests provide a shorter one.
 */
export const BACKLOG_WRITE_TIMEOUT = new InjectionToken<number>('BACKLOG_WRITE_TIMEOUT', { providedIn: 'root', factory: () => 10_000 });

/** The race marker of a write that did not answer within `BACKLOG_WRITE_TIMEOUT`. */
const TIMED_OUT = Symbol('timed-out');

/** What a refusal says beyond its write: core's phrase, stale, or the status. */
type RefusalDetail = { readonly kind: 'refused'; readonly reason: string } | { readonly kind: 'stale' } | { readonly kind: 'failed'; readonly status: number };

/**
 * What one backlog write came to (spec 037): `written` on a 200, `refused` on a 422 (`BacklogRefused`), `stale` on a
 * 409 (`StaleBacklog`), `error` for any other answer, no answer, and a write never sent (no model, no hash, another
 * workspace, or a write for the same feature still pending).
 */
export type BacklogOutcome = 'written' | 'refused' | 'stale' | 'error';

/** An accepted write the planning tree may not show yet: the op, the hash it was sent with and the file's new hash. */
export interface BacklogWrite {
  readonly ws: string;
  readonly op: BacklogOp;
  /** The hash of `specs/backlog.md` the write sent. */
  readonly sent: string;
  /** `BacklogWritten.hash`, the file's hash after the write; the next write sends it. */
  readonly written: string;
  /** False once a later write of the same feature was refused (ISC-198): it still links the hash chain, but shows nothing. */
  readonly shown: boolean;
}

/**
 * The accepted writes still ahead of the served tree: the unbroken chain that starts at the write sent with the served
 * hash (`PlanningModel.backlogHash`), each next one sent with the previous one's written hash. Empty once the reloaded
 * tree carries the last written hash, or any hash no write of the chain was sent with: the server's tree is the truth
 * again.
 */
export function liveWrites(writes: readonly BacklogWrite[], ws: string | null, hash: string | undefined): readonly BacklogWrite[] {
  const own = writes.filter((write) => write.ws === ws);
  const start = own.findIndex((write) => write.sent === hash);
  if (hash === undefined || start < 0) return [];
  const chain: BacklogWrite[] = [];
  for (const write of own.slice(start)) {
    const last = chain.at(-1);
    if (last !== undefined && write.sent !== last.written) break;
    chain.push(write);
  }
  return chain;
}

/**
 * The move of one feature in front of `before` within its group (`featureOrder`), or behind the group's last one for
 * null: the group's members trade the global ranks they held, so no other group moves. A feature in no group, or a
 * `before` outside its group, leaves the model as it is (the server would have refused it).
 */
function applyMove(model: PlanningModel, feature: string, before: string | null): PlanningModel {
  const group = featureOrder(model).find((entry) => entry.ids.includes(feature));
  if (group === undefined || (before !== null && !group.ids.includes(before))) return model;
  const ids = group.ids.filter((id) => id !== feature);
  ids.splice(before === null ? ids.length : ids.indexOf(before), 0, feature);
  const rankOf = new Map(model.features.map((entry) => [entry.id, entry.rank]));
  const slots = group.ids.map((id) => rankOf.get(id) ?? Infinity).sort((a, b) => a - b);
  ids.forEach((id, i) => rankOf.set(id, slots[i] ?? Infinity));
  const rank = (id: string): number => rankOf.get(id) ?? Infinity;
  const byRank = (a: string, b: string): number => rank(a) - rank(b);
  const features = model.features.map((entry) => ({ ...entry, rank: rank(entry.id) })).sort((a, b) => a.rank - b.rank);
  const milestones = model.milestones.map((milestone) => ({
    ...milestone,
    features: [...milestone.features].sort((a, b) => byRank(a.id, b.id)),
    ...(milestone.featureIds === undefined ? {} : { featureIds: [...milestone.featureIds].sort(byRank) }),
  }));
  const unassigned = model.unassignedFeatures === undefined ? {} : { unassignedFeatures: [...model.unassignedFeatures].sort(byRank) };
  return { ...model, features, milestones, ...unassigned };
}

/**
 * The planning tree with accepted backlog writes applied in order (T17, T18), so a moved feature or a changed chip
 * shows on the 200 and not one reload later: a move rewrites the ranks of its group, a priority the feature's
 * `priority`. Generic so the served `PlanningBody` keeps its type.
 */
export function withBacklog<M extends PlanningModel>(model: M, ops: readonly BacklogOp[]): M {
  let next: PlanningModel = model;
  for (const op of ops) {
    next =
      op.op === 'move'
        ? applyMove(next, op.feature, op.before)
        : { ...next, features: next.features.map((entry) => (entry.id === op.feature ? { ...entry, priority: op.priority } : entry)) };
  }
  return next as M;
}

/**
 * The one backlog write of the tree lens and the board's feature swimlanes (spec 037, T17, T18, ISC-195, ISC-196): a
 * move and a priority through `ApiClient.backlog()` with the hash of the last read, the held move per feature, and the
 * accepted writes as an overlay over the planning tree.
 *
 * - **Hash:** the newest of the served `PlanningModel.backlogHash` and the last 200's `BacklogWritten.hash` while the
 *   reloaded tree has not caught up (`liveWrites`). Without a served model or its hash nothing is sent.
 * - **Held move:** while a feature's write is in flight, `held` carries its op (the view draws the row at its target,
 *   dashed, `aria-busy`) and a second write for that feature is refused locally, without a request.
 * - **200:** the write joins the overlay (`model`), so the new order or priority shows at once, and the planning tree
 *   reloads; the overlay goes inert once the reloaded tree carries the written hash, or any other.
 * - **409, 422, anything else, no answer within `BACKLOG_WRITE_TIMEOUT`:** the planning tree reloads and nothing
 *   anticipated stays: the held op is gone and the feature's overlay shows nothing more. The feature keeps a
 *   `BacklogRefusal` (T20, ISC-198) for `app-refusal-notice`: `refused` with core's phrase (422, fail tone), `stale`
 *   (409, warning tone), `failed` with the status (fail tone). The ✕ (`dismiss`) and the next write sent for that
 *   feature close it; refusals belong to the workspace they were earned in.
 */
@Injectable({ providedIn: 'root' })
export class BacklogWriter {
  private readonly api = inject(ApiClient);
  private readonly data = inject(ShellData);
  private readonly state = inject(ShellState);
  private readonly timeout = inject(BACKLOG_WRITE_TIMEOUT);

  /** The refusals with the workspace they were earned in; another workspace shows none of them. */
  private readonly stored = signal<{ readonly ws: string; readonly all: ReadonlyMap<string, BacklogRefusal> }>({ ws: '', all: new Map() });

  /** The refusal per feature of the current workspace (ISC-198); empty while every write was accepted or dismissed. */
  readonly refusals = computed<ReadonlyMap<string, BacklogRefusal>>(() => {
    const stored = this.stored();
    return stored.ws === this.state.ws() ? stored.all : new Map();
  });

  /** The feature's standing refusal, null when none stands. */
  refusalOf(feature: string): BacklogRefusal | null {
    return this.refusals().get(feature) ?? null;
  }

  /** The notice's ✕: forget the feature's refusal. */
  dismiss(feature: string): void {
    if (!this.stored().all.has(feature)) return;
    this.stored.update(({ ws, all }) => {
      const next = new Map(all);
      next.delete(feature);
      return { ws, all: next };
    });
  }

  /** The op in flight per feature (the held move); empty while no write is pending. */
  readonly held = signal<ReadonlyMap<string, BacklogOp>>(new Map());
  /** Accepted writes in answer order; `liveWrites` picks those the served tree does not show yet. */
  private readonly accepted = signal<readonly BacklogWrite[]>([]);

  private readonly live = computed(() => liveWrites(this.accepted(), this.state.ws(), this.data.planningModel()?.backlogHash));

  /** The served planning tree with the accepted writes applied; null while none is served. Views fold this into `featureOrder`. */
  readonly model = computed(() => {
    const served = this.data.planningModel();
    if (served === null) return null;
    const ops = this.live()
      .filter((write) => write.shown)
      .map((write) => write.op);
    return ops.length === 0 ? served : withBacklog(served, ops);
  });

  /** True while a write for `feature` is in flight. */
  pending(feature: string): boolean {
    return this.held().has(feature);
  }

  /**
   * True while any write is in flight. Every write sends the newest hash of the one file, so a second write before the
   * first answered would send a hash the first one changes and earn a 409; the views offer no move until then.
   */
  readonly busy = computed(() => this.held().size > 0);

  /** The feature's priority as `model` shows it; null when the model or the feature is missing. */
  priorityOf(feature: string): Priority | null {
    return this.model()?.features.find((entry) => entry.id === feature)?.priority ?? null;
  }

  /** T17 · ISC-195: move `feature` in front of `before` within its milestone, behind its last feature for null. */
  move(ws: string, feature: string, before: string | null): Promise<BacklogOutcome> {
    return this.write(ws, { op: 'move', feature, before });
  }

  /** T18 · ISC-196: set the feature's priority, `P1` to `P4`. */
  priority(ws: string, feature: string, priority: Priority): Promise<BacklogOutcome> {
    return this.write(ws, { op: 'priority', feature, priority });
  }

  private async write(ws: string, op: BacklogOp): Promise<BacklogOutcome> {
    const served = this.data.planningModel()?.backlogHash;
    if (served === undefined || ws !== this.state.ws() || this.busy()) return 'error';
    const sent = this.live().at(-1)?.written ?? served;
    this.held.update((all) => new Map(all).set(op.feature, op));
    // The next write sent for a feature closes its notice (design 037: "✕ und die nächste Bewegung schliessen").
    this.dismiss(op.feature);
    const call = this.api.backlog(ws, op, sent);
    const result = await this.answerOf(call);
    this.release(op.feature);
    if (result === TIMED_OUT) {
      // A late answer re-reads the tree once more: whatever the route did, the served tree is the truth.
      void call.then(() => this.data.planning.reload());
      return this.settle(ws, op, { kind: 'failed', status: 0 }, 'error');
    }
    if (result.kind === 'error') return this.settle(ws, op, { kind: 'failed', status: result.status }, 'error');
    const answer = result.answer;
    const status: number = answer.status;
    switch (answer.status) {
      case 200:
        // Writes the served tree already shows are dropped here, outside the computed.
        this.accepted.set([...this.live(), { ws, op, sent, written: answer.body.hash, shown: true }]);
        this.data.planning.reload();
        return 'written';
      case 409:
        return this.settle(ws, op, { kind: 'stale' }, 'stale');
      case 422:
        return this.settle(ws, op, { kind: 'refused', reason: answer.body.reason }, 'refused');
      default:
        return this.settle(ws, op, { kind: 'failed', status }, 'error');
    }
  }

  /** The route's answer, or `TIMED_OUT` once `BACKLOG_WRITE_TIMEOUT` has passed without one. */
  private async answerOf<T>(call: Promise<T>): Promise<T | typeof TIMED_OUT> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<typeof TIMED_OUT>((resolve) => {
      timer = setTimeout(() => resolve(TIMED_OUT), this.timeout);
    });
    try {
      return await Promise.race([call, expired]);
    } finally {
      clearTimeout(timer);
    }
  }

  private release(feature: string): void {
    this.held.update((all) => {
      const next = new Map(all);
      next.delete(feature);
      return next;
    });
  }

  /**
   * A write that was not accepted (T20, ISC-198): the feature's overlay shows nothing more, the planning tree reloads,
   * so the row stands at its re-read place, and the feature keeps the refusal for its notice.
   */
  private settle(ws: string, op: BacklogOp, detail: RefusalDetail, outcome: Exclude<BacklogOutcome, 'written'>): BacklogOutcome {
    const feature = op.feature;
    this.accepted.update((all) => all.map((write) => (write.op.feature === feature ? { ...write, shown: false } : write)));
    const refusal: BacklogRefusal = { op: op.op, feature, priority: op.op === 'priority' ? op.priority : null, ...detail };
    this.stored.update((stored) => ({ ws, all: new Map(stored.ws === ws ? stored.all : []).set(feature, refusal) }));
    this.data.planning.reload();
    return outcome;
  }
}

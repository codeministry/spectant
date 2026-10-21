import { computed, inject, Injectable, resource } from '@angular/core';
import { ApiClient } from '../../../core/api.service';
import { ShellData } from '../../../layout/shell/shell-data.service';
import { ShellState } from '../../../layout/shell/shell-state.service';
import { reviewGate } from '../../../layout/spec-head/review-gate';
import { claimsRatio, specBrief, specModel, specParams, specTabLink, specView } from '../spec-view';
import { openClaims } from './status-model';

/** Timeline entries shown under Activity; the Timeline tab holds the rest. */
const ACTIVITY_LIMIT = 5;
/** What is open, grouped in this order: takeable, taken, blocked, then anything else still open. */
const OPEN_ORDER: readonly string[] = ['takeable', 'taken', 'blocked', 'open'];

/**
 * The state of the Status tab (`StatusTab`, T54, ISC-79, spec 061): the spec payload the shell already loads
 * (`ShellData.spec`) as it is, and the Claims, Tasks and Timeline routes behind What is open and Activity. The stage,
 * the next command and its reasons are never derived here (ISC-72).
 */
@Injectable()
export class StatusStore {
  private readonly api = inject(ApiClient);
  private readonly data = inject(ShellData);
  private readonly state = inject(ShellState);

  readonly tier = this.state.tier;
  readonly ws = this.state.ws;

  readonly model = specModel(this.data);
  /** `loading` only before the first answer; a reload keeps the tab on screen. */
  readonly view = specView(this.data);

  private readonly params = specParams(this.state);

  /** What is open: the open claims and the fog, from the Claims route (core's `ClaimViewModel`). */
  readonly claims = resource({ params: () => this.params(), loader: ({ params }) => this.api.claims(params.ws, params.id) });
  /** What is open: the held tasks with their hold reason, from the Tasks route (core's `TaskRow`, `status: held`). */
  readonly tasks = resource({ params: () => this.params(), loader: ({ params }) => this.api.tasks(params.ws, params.id) });
  /** Activity: the newest timeline entries (core's `TimelineEntry[]`, newest first). */
  readonly timeline = resource({ params: () => this.params(), loader: ({ params }) => this.api.timeline(params.ws, params.id) });

  readonly open = computed(() => {
    const result = this.claims.value();
    return result?.kind === 'ok' ? { claims: openClaims(result.body.claims), fog: result.body.fog } : null;
  });

  /** The held line (`T16 held · seam T14 not landed`): every task a round held, with the round's reason. */
  readonly held = computed(() => {
    const result = this.tasks.value();
    return result?.kind === 'ok' && result.body !== null ? result.body.tasks.filter((task) => task.status === 'held') : [];
  });

  readonly openGroups = computed(() => {
    const claims = this.open()?.claims ?? [];
    const states = [...OPEN_ORDER, ...new Set(claims.map((claim) => claim.state).filter((state) => !OPEN_ORDER.includes(state)))];
    return states.map((state) => ({ state, claims: claims.filter((claim) => claim.state === state) })).filter((group) => group.claims.length > 0);
  });

  readonly activity = computed(() => {
    const result = this.timeline.value();
    return result?.kind === 'ok' ? result.body.slice(0, ACTIVITY_LIMIT) : null;
  });

  /** The `round-sum`: the newest round entry, its lead ("Round 3") bold, the rest after a middle dot. */
  readonly roundSummary = computed(() => {
    const round = this.activity()?.find((entry) => entry.kind === 'round');
    if (!round) return null;
    const [lead = '', ...rest] = round.title.split(' · ');
    return { lead, rest: rest.join(' · '), ts: round.ts };
  });

  link(tab: string): string[] {
    return specTabLink(this.state, tab);
  }

  readonly claimsRatio = claimsRatio(this.model);

  /** The workspace workflow (`ShellData.workflow`) and the person names (`ShellData.actorList`) for the status block. */
  readonly workflow = this.data.workflow;
  readonly actors = this.data.actorList;

  /** The review gate's lock and action, the same the gate button shows (`reviewGate`). */
  private readonly gate = reviewGate(this.model);
  readonly lock = this.gate.lock;
  readonly action = this.gate.action;

  /** The spec's slice of `specs/tldr.md` for the Activity card's TL;DR box; null when no TL;DR item names this spec. */
  readonly brief = specBrief(this.model);

  reload(): void {
    this.data.spec.reload();
  }
}

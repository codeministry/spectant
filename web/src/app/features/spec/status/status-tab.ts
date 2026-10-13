import { NgTemplateOutlet } from '@angular/common';
import { afterRenderEffect, ChangeDetectionStrategy, Component, computed, ElementRef, inject, resource } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import type { GateState, SpecPageModel, WaitingItem } from '../../../../../../core/src/files';
import { ApiClient } from '../../../core/api.service';
import { specLink } from '../../../layout/shell/areas';
import { ShellData } from '../../../layout/shell/shell-data.service';
import { ShellState } from '../../../layout/shell/shell-state.service';
import { GateButton } from '../../../layout/spec-head/gate-button';
import { type GateAction, gateAction, pathSegments } from '../../../layout/spec-head/spec-head-model';
import { UiIcon } from '../../../shared/icons/icon';
import { UiEmptyState } from '../../../shared/ui/empty-state/empty-state';
import { UiMeter } from '../../../shared/ui/meter/meter';
import { UiRing } from '../../../shared/ui/ring/ring';
import { UiSectionHeader } from '../../../shared/ui/section-header/section-header';
import { UiSkeleton } from '../../../shared/ui/skeleton/skeleton';
import type { Tone } from '../../../shared/ui/tone';
import { Brief, type BriefModel } from '../../dashboard/brief/brief';
import { AreaPlaceholder } from '../area-placeholder';
import { GATE_NAMES, GATE_TONE } from '../dashboard/dashboard-model';
import { StatusBlock } from './status-block';
import { openClaims } from './status-model';

/** The section headings a hash anchor lands on (the dashboard's Waiting and Gates tiles link there). */
const ANCHORS = ['waiting', 'gates'] as const;
/** Timeline entries shown under Activity; the Timeline tab holds the rest. */
const ACTIVITY_LIMIT = 5;
/** What is open, grouped as the prototype does: takeable, taken, blocked, then anything else still open. */
const OPEN_ORDER: readonly string[] = ['takeable', 'taken', 'blocked', 'open'];

/**
 * T54 · ISC-79 · ISC-85: the Status tab. It renders the spec payload the shell already loads (`ShellData.spec`) as it
 * is: the stage (`head.stage`), the next command (`next.command`) and its reasons (`next.reasons`) are never derived
 * here. Compact stacks Where it stands → Waiting on you → Gates → Warnings → What is open → Activity;
 * medium keeps Where it stands · Waiting on you · What is open · Activity with the gates and warnings inside the first
 * card (two columns from 900); wide is the bento (Why this next step and Progress by lane beside Gates and What is
 * open, Activity across both), the rail holding Where it stands (stage track, ring, next command, first takeable claim,
 * warnings, gate rows), Waiting on you and the key line: the shared `app-spec-rail`, which `SpecPage` registers for every
 * spec-detail tab (spec 024: the prototype's `whereCard` and `waitingCard`). What is open ends with the held tasks and
 * their hold reason from the Tasks route (the prototype's `.o-line.held`). The gate button and its dialog are the shared
 * `app-gate-button` (T78); the agent banner lives in the spec head above every area.
 */
@Component({
  selector: 'app-status-tab',
  imports: [
    AreaPlaceholder,
    Brief,
    GateButton,
    NgTemplateOutlet,
    RouterLink,
    StatusBlock,
    TranslocoPipe,
    UiEmptyState,
    UiIcon,
    UiMeter,
    UiRing,
    UiSectionHeader,
    UiSkeleton,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './status-tab.html',
  styleUrls: ['./status-tab.css', './status-rail.css'],
  host: { 'data-page': 'status', '[attr.data-tier]': 'tier()' },
})
export class StatusTab {
  private readonly api = inject(ApiClient);
  private readonly data = inject(ShellData);
  private readonly state = inject(ShellState);
  private readonly route = inject(ActivatedRoute);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly transloco = inject(TranslocoService);

  private readonly lang = toSignal(this.transloco.langChanges$, { initialValue: this.transloco.getActiveLang() });
  private readonly fragment = toSignal(this.route.fragment, { initialValue: this.route.snapshot.fragment });

  protected readonly tier = this.state.tier;
  protected readonly gateNames = GATE_NAMES;
  protected readonly segments = pathSegments;

  readonly model = computed<SpecPageModel | null>(() => {
    const result = this.data.spec.value();
    return result?.kind === 'ok' ? result.body : null;
  });

  /** `loading` only before the first answer; a reload keeps the tab on screen. */
  protected readonly view = computed<'loading' | 'ok' | 'unserved' | 'error'>(() => {
    const result = this.data.spec.value();
    if (result === undefined) return this.data.spec.error() ? 'error' : 'loading';
    if (result.kind === 'ok') return 'ok';
    if (result.kind === 'not-found' && !result.served) return 'unserved';
    return 'error';
  });

  private readonly params = computed(() => {
    const ws = this.state.ws();
    const id = this.state.specId();
    return ws === null || id === null ? undefined : { ws, id };
  });

  /** What is open: the open claims and the fog, from the Claims route (core's `ClaimViewModel`). */
  readonly claims = resource({ params: () => this.params(), loader: ({ params }) => this.api.claims(params.ws, params.id) });
  /** What is open: the held tasks with their hold reason, from the Tasks route (core's `TaskRow`, `status: held`). */
  readonly tasks = resource({ params: () => this.params(), loader: ({ params }) => this.api.tasks(params.ws, params.id) });
  /** Activity: the newest timeline entries (core's `TimelineEntry[]`, newest first). */
  readonly timeline = resource({ params: () => this.params(), loader: ({ params }) => this.api.timeline(params.ws, params.id) });

  protected readonly open = computed(() => {
    const result = this.claims.value();
    return result?.kind === 'ok' ? { claims: openClaims(result.body.claims), fog: result.body.fog } : null;
  });

  /** The prototype's held line (`T16 held · seam T14 not landed`): every task a round held, with the round's reason. */
  protected readonly held = computed(() => {
    const result = this.tasks.value();
    return result?.kind === 'ok' && result.body !== null ? result.body.tasks.filter((task) => task.status === 'held') : [];
  });

  protected readonly openGroups = computed(() => {
    const claims = this.open()?.claims ?? [];
    const states = [...OPEN_ORDER, ...new Set(claims.map((claim) => claim.state).filter((state) => !OPEN_ORDER.includes(state)))];
    return states.map((state) => ({ state, claims: claims.filter((claim) => claim.state === state) })).filter((group) => group.claims.length > 0);
  });

  /** The prototype's claim glyph: ◐ takeable, ○ blocked or open; a taken claim shows the lock icon instead. */
  protected glyph(state: string): string {
    return state === 'takeable' ? '◐' : '○';
  }

  /** The prototype's gate-card icon: check passed, alert stale or warning, flag for a missing review mark, x otherwise. */
  protected gateIcon(name: string, state: GateState): 'check' | 'triangle-alert' | 'flag' | 'x' {
    if (state === 'ok' || state === 'fresh') return 'check';
    if (state === 'stale' || state === 'warn') return 'triangle-alert';
    return name === 'reviewed' && state === 'missing' ? 'flag' : 'x';
  }

  /** The prototype's activity icons: clock for a round, server for an agent, file for a note or decision, git otherwise. */
  protected activityIcon(kind: string): 'clock' | 'server' | 'file' | 'git-commit-horizontal' {
    if (kind === 'round') return 'clock';
    if (kind === 'agent') return 'server';
    return kind === 'note' || kind === 'decision' ? 'file' : 'git-commit-horizontal';
  }

  protected readonly activity = computed(() => {
    const result = this.timeline.value();
    return result?.kind === 'ok' ? result.body.slice(0, ACTIVITY_LIMIT) : null;
  });

  /** The prototype's `round-sum`: the newest round entry, its lead ("Round 3") bold, the rest after a middle dot. */
  protected readonly roundSummary = computed(() => {
    const round = this.activity()?.find((entry) => entry.kind === 'round');
    if (!round) return null;
    const [lead = '', ...rest] = round.title.split(' · ');
    return { lead, rest: rest.join(' · '), ts: round.ts };
  });

  protected link(tab: string): string[] {
    return specLink(this.state.ws() ?? '', this.state.specId() ?? '', tab);
  }

  /** The ring's fill; decorative, the "n/m claims closed" text beside it carries the value. */
  protected readonly claimsRatio = computed(() => {
    const claims = this.model()?.keyNumbers.claims;
    return claims && claims.total > 0 ? (claims.closed / claims.total) * 100 : null;
  });

  /** The workspace workflow (`ShellData.workflow`) and the person names (`ShellData.actorList`) for the status block. */
  protected readonly workflow = this.data.workflow;
  protected readonly actors = this.data.actorList;

  protected readonly lock = computed(() => this.model()?.areas.live.lock ?? null);
  protected readonly action = computed<GateAction | null>(() => {
    const model = this.model();
    return model ? gateAction(model.gates.reviewed, this.lock()) : null;
  });

  private readonly timeFormat = computed(() => new Intl.DateTimeFormat(this.lang(), { dateStyle: 'medium', timeStyle: 'short' }));
  protected time(iso: string | null | undefined): string {
    if (!iso) return '';
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? iso : this.timeFormat().format(date);
  }

  protected gateTone(state: GateState): Tone {
    return GATE_TONE[state];
  }

  protected waitingKey(item: WaitingItem): string {
    return `${item.kind}-${item.ref}`;
  }

  protected reload(): void {
    this.data.spec.reload();
  }

  private landed: string | null = null;

  /** The spec's slice of `specs/tldr.md` for the Activity card's TL;DR box; null when no TL;DR item names this spec. */
  protected readonly brief = computed<BriefModel | null>(() => {
    const tldr = this.model()?.tldr;
    return tldr?.brief ? { markdown: tldr.brief, generated: tldr.generated, stale: tldr.stale } : null;
  });

  constructor() {
    // A hash anchor (`#waiting`, `#gates`) moves focus to its section heading once, after the heading has rendered.
    afterRenderEffect(() => {
      const fragment = this.fragment();
      if (fragment === null || this.view() !== 'ok' || this.landed === fragment) return;
      if (!(ANCHORS as readonly string[]).includes(fragment)) return;
      const heading = this.host.nativeElement.querySelector<HTMLElement>(`#${fragment}`);
      if (heading === null) return;
      this.landed = fragment;
      (heading as Partial<HTMLElement>).scrollIntoView?.({ block: 'start' });
      heading.focus({ preventScroll: true });
    });
  }
}

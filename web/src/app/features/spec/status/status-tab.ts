import { NgTemplateOutlet } from '@angular/common';
import { afterRenderEffect, ChangeDetectionStrategy, Component, computed, ElementRef, inject, resource, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import type { GateState, SpecPageModel, WaitingItem } from '../../../../../../core/src/files';
import { REVIEWED_HASH_FILES, type ReviewedHashFile } from '../../../../../../server/src/spec-routes.contract';
import { ApiClient } from '../../../core/api.service';
import { specLink } from '../../../layout/shell/areas';
import { ShellData } from '../../../layout/shell/shell-data.service';
import { ShellState } from '../../../layout/shell/shell-state.service';
import { UiIcon } from '../../../shared/icons/icon';
import { UiCommandChip } from '../../../shared/ui/command-chip/command-chip';
import { UiEmptyState } from '../../../shared/ui/empty-state/empty-state';
import { UiMeter } from '../../../shared/ui/meter/meter';
import { UiNotice } from '../../../shared/ui/notice/notice';
import { UiSheet } from '../../../shared/ui/overlay/sheet';
import { UiRing } from '../../../shared/ui/ring/ring';
import { UiSectionHeader } from '../../../shared/ui/section-header/section-header';
import { UiSkeleton } from '../../../shared/ui/skeleton/skeleton';
import { UiStageTrack } from '../../../shared/ui/stage-track/stage-track';
import { UiStateChip } from '../../../shared/ui/state-chip/state-chip';
import type { Tone } from '../../../shared/ui/tone';
import { AreaPlaceholder } from '../area-placeholder';
import { GATE_NAMES, GATE_TONE, stageIndex, TRACK_STAGES } from '../dashboard/dashboard-model';
import { type GateAction, gateAction, openClaims, pathSegments, shortHash } from './status-model';

/** The section headings a hash anchor lands on (the dashboard's Waiting and Gates tiles link there). */
const ANCHORS = ['waiting', 'gates'] as const;
/** Timeline entries shown under Activity; the Timeline tab holds the rest. */
const ACTIVITY_LIMIT = 5;
const HASH_FILES = Object.keys(REVIEWED_HASH_FILES) as ReviewedHashFile[];

/** Where the gate write stands inside the dialog; a 200 closes the dialog and shows `written` instead. */
type WriteState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'sending' }
  | { readonly kind: 'conflict' }
  | { readonly kind: 'locked'; readonly session: string; readonly claim: string }
  | { readonly kind: 'error'; readonly status: number };

/**
 * T54 · ISC-79 · ISC-85: the Status tab. It renders the spec payload the shell already loads (`ShellData.spec`) as it
 * is: the stage (`head.stage`), the next command (`next.command`) and its reasons (`next.reasons`) are never derived
 * here. Compact stacks agent banner → Where it stands → Waiting on you → Gates → Warnings → What is open → Activity;
 * medium keeps Where it stands · Waiting on you · What is open · Activity with the gates and warnings inside the first
 * card (two columns from 900); wide is the bento (Why this next step and Progress by lane beside Gates and What is
 * open, Activity across both), the rail holding Waiting on you and Warnings. The gate button posts the reviewed mark
 * with the hashes the spec response carried and answers 200 / 409 / 423 in its dialog.
 */
@Component({
  selector: 'app-status-tab',
  imports: [
    AreaPlaceholder,
    NgTemplateOutlet,
    RouterLink,
    TranslocoPipe,
    UiCommandChip,
    UiEmptyState,
    UiIcon,
    UiMeter,
    UiNotice,
    UiRing,
    UiSectionHeader,
    UiSheet,
    UiSkeleton,
    UiStageTrack,
    UiStateChip,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './status-tab.html',
  styleUrl: './status-tab.css',
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
  protected readonly hashFiles = HASH_FILES;
  protected readonly hashFileNames = REVIEWED_HASH_FILES;
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
  /** Activity: the newest timeline entries (core's `TimelineEntry[]`, newest first). */
  readonly timeline = resource({ params: () => this.params(), loader: ({ params }) => this.api.timeline(params.ws, params.id) });

  protected readonly open = computed(() => {
    const result = this.claims.value();
    return result?.kind === 'ok' ? { claims: openClaims(result.body.claims), fog: result.body.fog } : null;
  });

  protected readonly activity = computed(() => {
    const result = this.timeline.value();
    return result?.kind === 'ok' ? result.body.slice(0, ACTIVITY_LIMIT) : null;
  });

  protected link(tab: string): string[] {
    return specLink(this.state.ws() ?? '', this.state.specId() ?? '', tab);
  }

  /** The ring's fill; decorative, the "n/m claims closed" text beside it carries the value. */
  protected readonly claimsRatio = computed(() => {
    const claims = this.model()?.keyNumbers.claims;
    return claims && claims.total > 0 ? (claims.closed / claims.total) * 100 : null;
  });

  protected readonly stageLabels = computed(() => {
    this.lang();
    return TRACK_STAGES.map((stage) => this.transloco.translate(`stages.${stage}`));
  });
  protected readonly stageCurrent = computed(() => stageIndex(this.model()?.head.stage ?? ''));
  protected readonly stageAria = computed(() => {
    const labels = this.stageLabels();
    const index = Math.min(this.stageCurrent(), labels.length - 1);
    return this.transloco.translate('stages.position', { index: index + 1, total: labels.length, stage: labels[index] ?? '' });
  });

  protected readonly lock = computed(() => this.model()?.areas.live.lock ?? null);
  protected readonly action = computed<GateAction | null>(() => {
    const model = this.model();
    return model ? gateAction(model.gates.reviewed, this.lock()) : null;
  });

  /** The hashes `GET …/:id` carried; re-read whenever the spec answers again (a reload after a 409). */
  protected readonly hashes = computed(() => {
    this.data.spec.value();
    const params = this.params();
    return params ? this.api.reviewedHashes(params.ws, params.id) : null;
  });
  protected short(file: ReviewedHashFile): string | null {
    return shortHash(this.hashes()?.[file] ?? null);
  }

  protected readonly dialogOpen = signal(false);
  protected readonly write = signal<WriteState>({ kind: 'idle' });
  /** The `at` of the mark this page wrote, shown as the success line until the tab is left. */
  protected readonly written = signal<string | null>(null);

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

  protected openDialog(): void {
    this.write.set({ kind: 'idle' });
    this.dialogOpen.set(true);
  }

  protected async confirm(): Promise<void> {
    const params = this.params();
    const hashes = this.hashes();
    if (!params || !hashes || this.write().kind === 'sending') return;
    this.write.set({ kind: 'sending' });
    const result = await this.api.gateReviewed(params.ws, params.id, hashes);
    switch (result.kind) {
      case 'ok':
        this.written.set(result.body.at);
        this.write.set({ kind: 'idle' });
        this.dialogOpen.set(false);
        this.data.spec.reload();
        return;
      case 'conflict':
        this.write.set({ kind: 'conflict' });
        return;
      case 'locked':
        this.write.set({ kind: 'locked', session: result.lock.session, claim: result.lock.claim });
        return;
      case 'error':
        this.write.set({ kind: 'error', status: result.status });
    }
  }

  /** The 409's Reload: read the spec again (new hashes, new gate state) and let the reviewer confirm afresh. */
  protected reloadSpec(): void {
    this.write.set({ kind: 'idle' });
    this.data.spec.reload();
  }

  protected reload(): void {
    this.data.spec.reload();
  }

  private landed: string | null = null;

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

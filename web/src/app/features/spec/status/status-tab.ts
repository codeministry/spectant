import { NgTemplateOutlet } from '@angular/common';
import { afterRenderEffect, ChangeDetectionStrategy, Component, ElementRef, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import type { GateState, WaitingItem } from '../../../../../../core/src/files';
import { GateButton } from '../../../layout/spec-head/gate-button/gate-button';
import { UiPathBreaks } from '../../../shared/ui/path-breaks/path-breaks';
import { UiIcon } from '../../../shared/icons/icon';
import { UiTime } from '../../../shared/time';
import { UiButton } from '../../../shared/ui/button/button';
import { UiMeter } from '../../../shared/ui/meter/meter';
import { UiNotice } from '../../../shared/ui/notice/notice';
import { UiRing } from '../../../shared/ui/ring/ring';
import { UiSectionHeader } from '../../../shared/ui/section-header/section-header';
import { UiSkeleton } from '../../../shared/ui/skeleton/skeleton';
import type { Tone } from '../../../shared/ui/tone';
import { Brief } from '../../../shared/brief/brief';
import { AreaPlaceholder } from '../area-placeholder';
import { GATE_NAMES, GATE_TONE } from '../dashboard/dashboard-model';
import { StatusBlock } from './status-block';
import { StatusStore } from './status.store';

/** The section headings a hash anchor lands on (the dashboard's Waiting and Gates tiles link there). */
const ANCHORS = ['waiting', 'gates'] as const;

/**
 * T54 · ISC-79 · ISC-85: the Status tab. It renders the spec payload the shell already loads (`ShellData.spec`) as it
 * is: the stage (`head.stage`), the next command (`next.command`) and its reasons (`next.reasons`) are never derived
 * here. Compact stacks Where it stands → Waiting on you → Gates → Warnings → What is open → Activity;
 * medium keeps Where it stands · Waiting on you · What is open · Activity with the gates and warnings inside the first
 * card (two columns from 900); wide is the bento (Why this next step and Progress by lane beside Gates and What is
 * open, Activity across both), the rail holding Where it stands (stage track, ring, next command, first takeable claim,
 * warnings, gate rows), Waiting on you and the key line: the shared `app-spec-rail`, which `SpecPage` registers for every
 * spec-detail tab (spec 024: Where it stands and Waiting on you). What is open ends with the held tasks and
 * their hold reason from the Tasks route (the `.o-line.held`). The gate button and its dialog are the shared
 * `app-gate-button` (T78); the agent banner lives in the spec head above every area.
 */
@Component({
  selector: 'app-status-tab',
  imports: [
    UiButton,
    UiNotice,
    AreaPlaceholder,
    Brief,
    GateButton,
    NgTemplateOutlet,
    RouterLink,
    StatusBlock,
    TranslocoPipe,
    UiIcon,
    UiMeter,
    UiPathBreaks,
    UiRing,
    UiSectionHeader,
    UiSkeleton,
    UiTime,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './status-tab.html',
  styleUrls: ['./status-tab.css', './status-tab-open.css', './status-rail.css'],
  providers: [StatusStore],
  host: { 'data-page': 'status', '[attr.data-tier]': 'tier()' },
})
export class StatusTab {
  protected readonly store = inject(StatusStore);
  private readonly route = inject(ActivatedRoute);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly fragment = toSignal(this.route.fragment, { initialValue: this.route.snapshot.fragment });

  protected readonly tier = this.store.tier;
  protected readonly gateNames = GATE_NAMES;

  readonly model = this.store.model;
  readonly claims = this.store.claims;
  readonly tasks = this.store.tasks;
  readonly timeline = this.store.timeline;

  /** The claim glyph: ◐ takeable, ○ blocked or open; a taken claim shows the lock icon instead. */
  protected glyph(state: string): string {
    return state === 'takeable' ? '◐' : '○';
  }

  /** The gate-card icon: check passed, alert stale or warning, flag for a missing review mark, x otherwise. */
  protected gateIcon(name: string, state: GateState): 'check' | 'triangle-alert' | 'flag' | 'x' {
    if (state === 'ok' || state === 'fresh') return 'check';
    if (state === 'stale' || state === 'warn') return 'triangle-alert';
    return name === 'reviewed' && state === 'missing' ? 'flag' : 'x';
  }

  /** The activity icons: clock for a round, server for an agent, file for a note or decision, git otherwise. */
  protected activityIcon(kind: string): 'clock' | 'server' | 'file' | 'git-commit-horizontal' {
    if (kind === 'round') return 'clock';
    if (kind === 'agent') return 'server';
    return kind === 'note' || kind === 'decision' ? 'file' : 'git-commit-horizontal';
  }

  protected gateTone(state: GateState): Tone {
    return GATE_TONE[state];
  }

  protected waitingKey(item: WaitingItem): string {
    return `${item.kind}-${item.ref}`;
  }

  private landed: string | null = null;

  constructor() {
    // A hash anchor (`#waiting`, `#gates`) moves focus to its section heading once, after the heading has rendered.
    afterRenderEffect(() => {
      const fragment = this.fragment();
      if (fragment === null || this.store.view() !== 'ok' || this.landed === fragment) return;
      if (!(ANCHORS as readonly string[]).includes(fragment)) return;
      const heading = this.host.nativeElement.querySelector<HTMLElement>(`#${fragment}`);
      if (heading === null) return;
      this.landed = fragment;
      (heading as Partial<HTMLElement>).scrollIntoView?.({ block: 'start' });
      heading.focus({ preventScroll: true });
    });
  }
}

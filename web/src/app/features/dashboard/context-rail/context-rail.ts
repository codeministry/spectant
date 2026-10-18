import { DOCUMENT } from '@angular/common';
import { afterEveryRender, ChangeDetectionStrategy, Component, computed, DestroyRef, inject, input, signal, type TemplateRef, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslocoService } from '@jsverse/transloco';
import type { DashboardView } from './dashboard-view';
import { type RailBadge, RailContent } from '../../../layout/shell/rail-content';
import { ShellState } from '../../../layout/shell/shell-state.service';
import { NextUpList } from '../next-up-list/next-up-list';
import { WaitingSection } from './waiting-section';
import { WarningsPanel } from '../warnings-panel/warnings-panel';

/** Which parts render in place below wide; at wide the rail always holds both. */
export type ContextRailInline = 'all' | 'next-up' | 'warnings';

/** The id of the rail's Next up block at wide, which the context rail's host owns for assistive technology. */
export const RAIL_NEXT_UP = 'rail-next-up';

/**
 * The dashboard's context rail (T64, design.md § Desktop): Waits on you (spec 020 T17, the section `#waiting`, at wide
 * only: below wide the page puts it before the KPI card), Next up, then Warnings, nothing else. At wide it registers
 * both as rail blocks with spec 002's seam (`RailContent`, rendered by the shell's `app-rail-slot`), the way the board
 * does, plus the collapsed strip's two counts; below wide it renders them in place — Next up as one card, then
 * Warnings as the `#warnings` section after it at compact and medium alike (018-B15). `inline` lets a page split the
 * two parts across its slots below wide (the dashboard puts Warnings after the Specs, the prototype's `#warnings-n`).
 *
 * Spec 021 (ISC-246): Next up is read in the page's order at every tier, after the TL;DR and before the spec list. At
 * wide it stands only visually in the rail: the rail block is the one rendered copy (no hidden twin, no duplicate
 * ids, every control live for pointer and keyboard), and this host, which sits in the page's main column where Next
 * up stands below wide, claims it with `aria-owns`, so the accessibility tree reads it there and not in the rail's
 * landmark. The host owns the block only while the rail renders it (not in the collapsed strip, not while the docked
 * detail sidebar holds the slot), and an empty host stays in that tree (`display: contents`: no box, no grid gap).
 */
@Component({
  selector: 'app-context-rail',
  imports: [NextUpList, WaitingSection, WarningsPanel],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-context-rail': '', '[attr.data-tier]': 'tier()', '[attr.aria-owns]': 'owns()' },
  styles: `
    :host { display: grid; gap: 16px; min-inline-size: 0; }
    :host(:empty) { display: contents; }
  `,
  template: `
    <ng-template #railBlocks>
      @if (model().guidance; as guidance) {
        <app-waiting-section [entries]="guidance.waits" [workspace]="ws()" />
      }
      <app-next-up-list [id]="railNextUp" form="rail"[specs]="model().specs" [ids]="model().nextUp" [guidance]="model().guidance" />
      <app-warnings-panel form="rail" [specs]="model().specs" [kpis]="model().kpis" />
    </ng-template>
    @if (!wide()) {
      @if (inline() !== 'warnings') {
        <app-next-up-list form="card" [specs]="model().specs" [ids]="model().nextUp" [guidance]="model().guidance" />
      }
      @if (inline() !== 'next-up') {
        <app-warnings-panel form="section" [specs]="model().specs" [kpis]="model().kpis" />
      }
    }
  `,
})
export class ContextRail {
  readonly model = input.required<DashboardView>();
  readonly inline = input<ContextRailInline>('all');
  /** The workspace slug the waiting entries link into; the rail block `#waiting` needs it (spec 020 T17). */
  readonly ws = input('');

  private readonly state = inject(ShellState);
  private readonly transloco = inject(TranslocoService);
  private readonly lang = toSignal(this.transloco.langChanges$, { initialValue: this.transloco.getActiveLang() });

  protected readonly tier = computed(() => this.state.tier());
  protected readonly wide = computed(() => this.tier() === 'wide');

  protected readonly railNextUp = RAIL_NEXT_UP;
  private readonly document = inject(DOCUMENT);
  /** Whether the shell's rail slot rendered the Next up block after the last change (read back from the DOM). */
  private readonly railNextUpShown = signal(false);
  /** The host's `aria-owns`: the rail's Next up block at wide while it is shown and the page reads Next up here. */
  protected readonly owns = computed(() => (this.wide() && this.inline() !== 'warnings' && this.railNextUpShown() ? RAIL_NEXT_UP : null));

  private readonly railBlocks = viewChild<TemplateRef<unknown>>('railBlocks');
  private readonly badges = computed<readonly RailBadge[]>(() => {
    this.lang();
    const nextUp = this.model().nextUp.length;
    const warnings = this.model().kpis.warnings;
    return [
      { key: 'nextUp', count: nextUp, label: this.transloco.translate('nextUp.badge', { count: nextUp }) },
      { key: 'warnings', count: warnings, label: this.transloco.translate('shell.rail.warnings', { count: warnings }) },
    ];
  });

  constructor() {
    inject(RailContent).register(
      {
        blocks: computed(() => (this.wide() ? (this.railBlocks() ?? null) : null)),
        bar: computed(() => null),
        badges: this.badges,
      },
      inject(DestroyRef),
    );
    // After every render, not on a signal of this view: the shell's slot (strip, docked sidebar, zen) decides.
    afterEveryRender({ read: () => this.railNextUpShown.set(this.document.getElementById(RAIL_NEXT_UP) !== null) });
  }
}

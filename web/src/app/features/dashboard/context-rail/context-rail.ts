import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, input, type TemplateRef, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslocoService } from '@jsverse/transloco';
import type { DashboardView } from './dashboard-view';
import { type RailBadge, RailContent } from '../../../layout/shell/rail-content';
import { ShellState } from '../../../layout/shell/shell-state.service';
import { NextUpList } from '../next-up-list/next-up-list';
import { WarningsPanel } from '../warnings-panel/warnings-panel';

/** Which parts render in place below wide; at wide the rail always holds both. */
export type ContextRailInline = 'all' | 'next-up' | 'warnings';

/**
 * The dashboard's context rail (T64, design.md § Desktop): Next up, then Warnings, nothing else. At wide it registers
 * both as rail blocks with spec 002's seam (`RailContent`, rendered by the shell's `app-rail-slot`), the way the board
 * does, plus the collapsed strip's two counts; below wide it renders them in place as cards — Next up as one card,
 * Warnings as the `#warnings` section (medium) or a collapsed callout (compact). `inline` lets the page split the two
 * parts across its slots below wide (Next up under the Brief, Warnings after the Specs at medium).
 */
@Component({
  selector: 'app-context-rail',
  imports: [NextUpList, WarningsPanel],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-context-rail': '', '[attr.data-tier]': 'tier()' },
  styles: `
    :host { display: grid; gap: 16px; min-inline-size: 0; }
    :host(:empty) { display: none; }
  `,
  template: `
    <ng-template #railBlocks>
      <app-next-up-list form="rail" [specs]="model().specs" [ids]="model().nextUp" />
      <app-warnings-panel form="rail" [specs]="model().specs" [kpis]="model().kpis" />
    </ng-template>
    @if (!wide()) {
      @if (inline() !== 'warnings') {
        <app-next-up-list form="card" [specs]="model().specs" [ids]="model().nextUp" />
      }
      @if (inline() !== 'next-up') {
        <app-warnings-panel [form]="tier() === 'compact' ? 'callout' : 'section'" [specs]="model().specs" [kpis]="model().kpis" />
      }
    }
  `,
})
export class ContextRail {
  readonly model = input.required<DashboardView>();
  readonly inline = input<ContextRailInline>('all');
  /**
   * Rail content that stands in for Next up and Warnings at wide while it is set — the spec inspector while the page
   * previews a spec (`?spec=<id>`, T69). One registration keeps the rail the dashboard's, so clearing it brings the
   * two blocks back.
   */
  readonly replace = input<TemplateRef<unknown> | null>(null);

  private readonly state = inject(ShellState);
  private readonly transloco = inject(TranslocoService);
  private readonly lang = toSignal(this.transloco.langChanges$, { initialValue: this.transloco.getActiveLang() });

  protected readonly tier = computed(() => this.state.tier());
  protected readonly wide = computed(() => this.tier() === 'wide');

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
        blocks: computed(() => (this.wide() ? (this.replace() ?? this.railBlocks() ?? null) : null)),
        bar: computed(() => null),
        badges: this.badges,
      },
      inject(DestroyRef),
    );
  }
}

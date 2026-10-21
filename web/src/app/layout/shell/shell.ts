import { afterNextRender, ChangeDetectionStrategy, Component, computed, DestroyRef, ElementRef, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { KeyboardService } from './keyboard.service';
import { DetailSidebar } from '../detail-sidebar/detail-sidebar';
import { DetailSelection } from '../detail-sidebar/selection';
import { RailToggle } from '../zen/rail-toggle';
import { ZenFooter } from '../zen/zen-footer';
import { areaById } from './areas';
import { RailSlot } from './rail-slot';
import { ShellData } from './shell-data.service';
import { ShellHeader } from './shell-header';
import { ShellState } from './shell-state.service';
import { tierFor } from './tier';

/**
 * The one shell every route renders in (ISC-73, T35): the header, `main` with the router outlet, and the 352 px
 * context rail at wide (stacked below main at medium, absent at compact). The host is the `shell` size container the
 * CSS tiers query; a ResizeObserver mirrors the same width into `ShellState.tier` through `tierFor`, so the tab-bar
 * slot and the `data-tier` attribute agree with the CSS.
 */
@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, TranslocoPipe, DetailSidebar, ShellHeader, RailSlot, RailToggle, ZenFooter],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './shell.html',
  styleUrl: './shell.css',
  host: {
    '[attr.data-tier]': 'state.tier()',
    '[class.tier-compact]': "state.tier() === 'compact'",
    '[class.tier-medium]': "state.tier() === 'medium'",
    '[class.tier-wide]': "state.tier() === 'wide'",
    '[attr.data-zen]': "state.zen() ? '' : null",
    '[attr.data-rail-collapsed]': "state.railStrip() ? '' : null",
    // Outside a workspace (the overview `/`, settings) the page has no rail column at all; the
    // workspace board (spec 008), the Library and a spec area marked `noRail` (the spec's
    // Library, spec 017) have nothing for the rail either and take the full width.
    '[attr.data-no-rail]': "noRail() ? '' : null",
    '(document:keydown)': 'onKeydown($event)',
  },
})
export class ShellComponent {
  protected readonly state = inject(ShellState);
  protected readonly data = inject(ShellData);
  private readonly keyboard = inject(KeyboardService);
  private readonly selection = inject(DetailSelection);

  /**
   * Spec 038 (ISC-204): the Gantt lens docks the detail sidebar into the rail at wide while a feature is selected
   * (design.md § Desktop: the axis rescales to the rest of the width); without a selection it takes the full width.
   */
  private readonly ganttRail = computed(
    () => this.state.route().lens === 'gantt' && this.state.tier() === 'wide' && this.selection.entry() !== null && !this.data.workspaceMissing() && !this.data.planningMissing(),
  );

  /**
   * Spec 058 (ISC-393): the spec list docks the detail sidebar into the rail at wide while a selection is open, as the
   * Gantt does; without one, and below wide, it takes the full width.
   */
  private readonly specsRail = computed(
    () =>
      this.state.wsPage() === 'specs' &&
      this.state.tier() === 'wide' &&
      this.selection.entry() !== null &&
      !this.data.workspaceMissing() &&
      !this.data.workspaceUnavailable(),
  );

  /** No rail column at all: outside a workspace, on the full-width workspace pages, in a `noRail` area. */
  protected readonly noRail = computed(() => {
    const page = this.state.wsPage();
    // Spec 026: the planning page's graph takes the full width too, and the Gantt (spec 038) until a selection docks the
    // sidebar at wide; the tree lens has a rail.
    const planningWide = page === 'planning' && this.state.route().lens !== 'tree' && !this.ganttRail();
    // Spec 058 (ISC-392): the workspace dashboard is one column at every tier; the spec list until a selection docks.
    const specsWide = page === 'specs' && !this.specsRail();
    return this.state.ws() === null || page === 'dashboard' || page === 'board' || page === 'library' || planningWide || specsWide || this.specAreaNoRail();
  });

  /** The open spec area runs without the context column (`SpecArea.noRail`, the Library, spec 017 T46). */
  private readonly specAreaNoRail = computed(() => {
    const area = this.state.specId() === null ? null : this.state.area();
    return area !== null && areaById(area).noRail === true;
  });

  /**
   * The rail belongs to an open, existing spec (T54 fills its content, T38 adds the collapse toggle), to the planning
   * tree and Gantt at wide, and to the spec list at wide while a selection is docked (spec 058). The workspace
   * dashboard never draws one: its Next up and warnings stand in its own column (spec 058, ISC-392).
   */
  protected readonly showRail = computed(() => {
    if (this.state.notFound()) return false;
    if (this.state.specId() !== null) return !this.data.specMissing() && !this.specAreaNoRail();
    // Spec 026: the planning page's tree lens at wide (the overview, or the docked sidebar on a selection), the Gantt
    // at wide with a selection (spec 038); the graph never draws one.
    if (this.state.route().wsPage === 'planning') {
      if (this.ganttRail()) return true;
      return this.state.route().lens === 'tree' && this.state.tier() === 'wide' && !this.data.workspaceMissing() && !this.data.planningMissing();
    }
    // The spec list only, and only with a docked selection: the dashboard, the board and the Library draw no rail.
    return this.specsRail();
  });

  constructor() {
    const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      if (typeof ResizeObserver === 'undefined') return;
      const observer = new ResizeObserver((entries) => {
        const entry = entries.at(-1);
        if (entry) this.state.tier.set(tierFor(entry.contentRect.width));
      });
      observer.observe(host);
      destroyRef.onDestroy(() => {
        observer.disconnect();
      });
    });
  }

  protected onKeydown(event: KeyboardEvent): void {
    this.keyboard.handle(event);
  }
}

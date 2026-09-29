import { afterNextRender, ChangeDetectionStrategy, Component, computed, DestroyRef, ElementRef, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
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
  imports: [RouterOutlet, TranslocoPipe, ShellHeader, RailSlot],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './shell.html',
  styleUrl: './shell.css',
  host: {
    '[attr.data-tier]': 'state.tier()',
    '[class.tier-compact]': "state.tier() === 'compact'",
    '[class.tier-medium]': "state.tier() === 'medium'",
    '[class.tier-wide]': "state.tier() === 'wide'",
    '[attr.data-zen]': "state.zen() ? '' : null",
    '[attr.data-rail-collapsed]': "state.railCollapsed() ? '' : null",
    '(document:keydown)': 'onKeydown($event)',
  },
})
export class ShellComponent {
  protected readonly state = inject(ShellState);
  protected readonly data = inject(ShellData);

  /** The rail belongs to an open, existing spec; T54 and T38 fill its content and the collapse toggle. */
  protected readonly showRail = computed(
    () => this.state.specId() !== null && !this.state.notFound() && !this.data.specMissing(),
  );

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
    this.state.handleKey(event, this.data.specOrder());
  }
}

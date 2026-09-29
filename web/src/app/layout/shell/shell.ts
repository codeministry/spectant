import { afterNextRender, ChangeDetectionStrategy, Component, computed, DestroyRef, ElementRef, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { KeyboardService } from '../../core/keyboard.service';
import { RailToggle } from '../zen/rail-toggle';
import { ZenFooter } from '../zen/zen-footer';
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
  imports: [RouterOutlet, TranslocoPipe, ShellHeader, RailSlot, RailToggle, ZenFooter],
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
    '(document:keydown)': 'onKeydown($event)',
  },
})
export class ShellComponent {
  protected readonly state = inject(ShellState);
  protected readonly data = inject(ShellData);
  private readonly keyboard = inject(KeyboardService);

  /** The rail belongs to an open, existing spec; T54 fills its content, T38 adds the collapse toggle. */
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
    this.keyboard.handle(event);
  }
}

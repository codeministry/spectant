import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { LockSourceService } from '../../core/lock-source.service';
import { RefreshService } from '../../core/refresh.service';
import { SettingsService } from '../../core/settings.service';
import { UiIcon } from '../../shared/icons/icon';

/**
 * The header's status group (prototype `[data-ui="live-indicator"]`, spec 024 T34): one bordered 40 px group of the live
 * indicator, Refresh now and the refresh interval. The indicator (ISC-73) is `activity` with a 6 px dot in three states
 * from `LockSourceService.source` (none: the track colour; activity: lime; frontier: lime with an outline ring), never
 * colour alone, since the text alternative names the source; a link to the Live area while a spec is open (`link`), a
 * plain status otherwise. Refresh calls `RefreshService.refresh()` (as `r` and the palette do); the interval shows
 * `settings.refreshSeconds`. Below 640 px only the indicator stays. The "Updated … ago" label and the live and interval
 * popovers come with T40.
 */
@Component({
  selector: 'app-shell-live',
  imports: [RouterLink, TranslocoPipe, UiIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="group">
      @let key = 'shell.live.source.' + source();
      @if (link(); as target) {
        @let title = 'shell.live.open' | transloco: { source: (key | transloco) };
        <a class="part live" data-control="live" [routerLink]="target" [attr.data-source]="source()" [attr.title]="title">
          <ui-icon name="activity" [size]="16" />
          <span class="live-dot" aria-hidden="true"></span>
          <span class="visually-hidden">{{ title }}</span>
        </a>
      } @else {
        <span class="part live" data-control="live" [attr.data-source]="source()" [attr.title]="key | transloco">
          <ui-icon name="activity" [size]="16" />
          <span class="live-dot" aria-hidden="true"></span>
          <span class="visually-hidden">{{ key | transloco }}</span>
        </span>
      }
      <button
        type="button"
        class="part refresh"
        data-tool="refresh"
        [attr.aria-label]="'shell.refresh.now' | transloco"
        [attr.title]="'shell.refresh.now' | transloco"
        (click)="refresher.refresh()"
      >
        <ui-icon name="refresh-cw" [size]="16" />
      </button>
      <span class="part interval" data-tool="interval" [attr.title]="'shell.refresh.interval' | transloco">
        <ui-icon name="timer" [size]="16" />
        <span class="visually-hidden">{{ 'shell.refresh.interval' | transloco }}</span>
        <span class="seconds">{{ seconds() === 0 ? ('shell.refresh.off' | transloco) : ('shell.refresh.seconds' | transloco: { seconds: seconds() }) }}</span>
      </span>
    </div>
  `,
  styleUrl: './shell-live.css',
})
export class ShellLive {
  /** The Live area of the open spec, or null. */
  readonly link = input<readonly string[] | null>(null);
  protected readonly source = inject(LockSourceService).source;
  protected readonly refresher = inject(RefreshService);
  private readonly settings = inject(SettingsService);
  protected readonly seconds = computed(() => this.settings.settings().refreshSeconds);
}

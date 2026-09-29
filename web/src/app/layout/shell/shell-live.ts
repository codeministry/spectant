import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { LockSourceService } from '../../core/lock-source.service';

/**
 * The header's live indicator (ISC-73, design.md § Header): a 6 px dot in three states from `LockSourceService.source`
 * (none: the track colour; activity: accent; frontier: accent with an outline ring), never colour alone, since the text
 * alternative names the source. A link to the Live area while a spec is open (`link`), a plain status otherwise.
 */
@Component({
  selector: 'app-shell-live',
  imports: [RouterLink, TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let key = 'shell.live.source.' + source();
    @if (link(); as target) {
      @let title = 'shell.live.open' | transloco: { source: (key | transloco) };
      <a class="live" data-control="live" [routerLink]="target" [attr.data-source]="source()" [attr.title]="title">
        <span class="live-dot" aria-hidden="true"></span>
        <span class="visually-hidden">{{ title }}</span>
      </a>
    } @else {
      <span class="live" data-control="live" [attr.data-source]="source()" [attr.title]="key | transloco">
        <span class="live-dot" aria-hidden="true"></span>
        <span class="visually-hidden">{{ key | transloco }}</span>
      </span>
    }
  `,
  styleUrl: './shell-live.css',
})
export class ShellLive {
  /** The Live area of the open spec, or null. */
  readonly link = input<readonly string[] | null>(null);
  protected readonly source = inject(LockSourceService).source;
}

import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';

/**
 * The header's brand (design.md § Wordmark, ISC-73): the living ring and the Sora wordmark "spect" + "ant", one link to
 * all workspaces. The ring is a track, an almost closed arc and the violet dot in its gap, a plain inline SVG in role
 * tokens (no fragment ids, which a `<base href>` breaks in WebKit). The wordmark text is the first thing the header drops
 * when it gets tight and is never shown at compact. The host sits in the header grid's `brand` area.
 */
@Component({
  selector: 'app-shell-brand',
  imports: [RouterLink, TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <a class="brand" routerLink="/" data-control="brand" [attr.aria-label]="'shell.brand' | transloco">
      <svg class="mark" viewBox="0 0 28 28" aria-hidden="true" focusable="false" data-icon-exempt>
        <!-- The logo, not a lucide icon (data-icon-exempt, ISC-18.2). -->
        <circle class="mark-track" cx="14" cy="14" r="11" />
        <!-- 80 % of the circle; the gap is centred on one o'clock (-60°), where the dot sits. -->
        <circle class="mark-arc" cx="14" cy="14" r="11" pathLength="100" transform="rotate(-24 14 14)" />
        <circle class="mark-dot" cx="19.5" cy="4.47" r="2.6" />
      </svg>
      <span class="wordmark" aria-hidden="true"
        >{{ 'shell.wordmark.lead' | transloco }}<span class="wordmark-tail">{{ 'shell.wordmark.tail' | transloco }}</span></span
      >
    </a>
  `,
  styleUrl: './shell-brand.css',
})
export class ShellBrand {}

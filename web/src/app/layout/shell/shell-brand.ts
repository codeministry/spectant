import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { UiIcon } from '../../shared/icons/icon';

/**
 * The header's brand (design.md § Wordmark, ISC-73; prototype `.brand-mark`, spec 024 T34): the living ring, lime into cyan, and the Sora wordmark "spect" + "ant", one link to
 * all workspaces. The ring is a track, an almost closed arc and the violet dot in its gap, a plain inline SVG in role
 * tokens (no fragment ids, which a `<base href>` breaks in WebKit). The wordmark text is the first thing the header drops
 * below 640 px, where the ring stands alone in its 40 px rail. The host sits in the header grid's `brand` area.
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
        <circle class="mark-arc mark-arc-a" cx="14" cy="14" r="11" pathLength="100" transform="rotate(-24 14 14)" />
        <circle class="mark-arc mark-arc-b" cx="14" cy="14" r="11" pathLength="100" transform="rotate(-24 14 14)" />
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

/**
 * The brand rail's link to the workspace Library (prototype `app.js` `.rail-select.library-link`, spec 024 T53): a
 * divider, `book`, the label LIBRARY and "Docs" in cyan text, on the rail's bordered field after the selects. The
 * header shows it from 1120 px on every workspace page and hands it `/w/:ws/library`.
 */
@Component({
  selector: 'app-shell-library-link',
  imports: [RouterLink, RouterLinkActive, TranslocoPipe, UiIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="divider" aria-hidden="true"></span>
    <a
      class="library-link"
      data-library-link
      [routerLink]="href()"
      routerLinkActive="current"
      ariaCurrentWhenActive="page"
      [attr.aria-label]="'shell.libraryLink.label' | transloco"
      [attr.title]="'shell.libraryLink.pill' | transloco"
    >
      <ui-icon class="book" name="book" [size]="13" />
      <span class="pill-label">{{ 'shell.libraryLink.pill' | transloco }}</span>
      <span class="pill-value">{{ 'shell.libraryLink.value' | transloco }}</span>
    </a>
  `,
  styles: `
    :host {
      display: inline-flex;
      align-items: center;
    }

    .divider {
      flex-shrink: 0;
      inline-size: 1px;
      block-size: 18px;
      margin-inline: 2px;
      background: var(--line);
    }

    .library-link {
      display: inline-flex;
      gap: 7px;
      align-items: center;
      block-size: 38px;
      padding-inline: 10px;
      border-radius: calc(var(--radius) - 1px);
      color: inherit;
      text-decoration: none;
      transition: background-color var(--motion-duration-instant) var(--motion-ease-standard);
    }

    @media (hover: hover) {
      .library-link:hover {
        background: var(--color-base-200);
      }
    }

    .library-link.current {
      background: var(--color-base-200);
    }

    .book {
      color: var(--muted);
    }

    .pill-label {
      color: var(--muted-ink);
      font-family: var(--font-mono);
      font-size: 9px;
      font-weight: 600;
      line-height: 18px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    .pill-value {
      color: var(--disp-text);
      font-size: 13px;
      font-weight: 650;
      line-height: 18px;
      white-space: nowrap;
    }

    @media (pointer: coarse) {
      .library-link {
        block-size: 42px;
      }
    }
  `,
})
export class ShellLibraryLink {
  readonly href = input.required<string>();
}

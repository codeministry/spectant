import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { DEMO_BLOCK_ATTR, DemoData } from '../../shared/demo/demo-data';
import { UiChip } from '../../shared/ui/chip/chip';
import { UiWsBadge } from '../../shared/ui/ws-badge/ws-badge';
import { UiWsCover } from '../../shared/ui/ws-badge/ws-cover';

/**
 * The top of a workspace column on `/` (spec 024 T54, prototype `app.js` `wsColumn` with `identity.js`): the 16:5
 * cover (`[data-ws-cover]`, the fixture's screenshot or the name pattern) above the 56 px ws-head with the 30 px
 * badge (`[data-ws-badge]`, the fixture's logo or the initials on the accent tint), the name as h2 and the path tail;
 * the caller projects the head's end (the "Updated" time). The identity images are a mock (ISC-149.1): they read
 * `DemoData.identity()` only, so the block is a `[data-demo]` root whose ws-head is its `[data-demo-head]` with the
 * demo chip. A workspace the fixture does not know gets the prototype's stand-ins: the name pattern, the monogram and
 * the accent its name hash picks.
 */
@Component({
  selector: 'app-ws-identity',
  imports: [RouterLink, TranslocoPipe, UiChip, UiWsBadge, UiWsCover],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { [DEMO_BLOCK_ATTR]: '' },
  template: `
    @let id = identity();
    @if (link()) {
      <a class="ws-cover-link" [routerLink]="href()" [attr.aria-label]="'identity.open' | transloco: { workspace: name() }">
        <ui-ws-cover data-ws-cover [name]="name()" [accent]="id?.accent ?? null" [image]="id?.image ?? null" [alt]="'identity.screenshot' | transloco: { workspace: name() }" />
      </a>
    } @else {
      <ui-ws-cover data-ws-cover [name]="name()" [accent]="id?.accent ?? null" [image]="id?.image ?? null" [alt]="'identity.screenshot' | transloco: { workspace: name() }" />
    }
    <div class="ws-head" data-demo-head>
      @if (link()) {
        <a [routerLink]="href()">
          <ui-ws-badge data-ws-badge size="lg" [name]="name()" [monogram]="id?.monogram ?? null" [accent]="id?.accent ?? null" />
          <h2>{{ name() }}</h2>
          <span class="path">{{ pathTail() }}</span>
        </a>
      } @else {
        <span class="ident">
          <ui-ws-badge data-ws-badge size="lg" [name]="name()" [monogram]="id?.monogram ?? null" [accent]="id?.accent ?? null" />
          <h2>{{ name() }}</h2>
          <span class="path">{{ pathTail() }}</span>
        </span>
      }
      <span class="end">
        <ui-chip variant="demo" />
        <ng-content />
      </span>
    </div>
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 8px; min-inline-size: 0; }
    .ws-cover-link { display: block; border-radius: var(--radius-card); }
    .ws-head { display: flex; gap: 12px; align-items: center; justify-content: space-between; min-block-size: 56px; border-block-end: 1px solid var(--line); }
    .ws-head a, .ident { display: inline-flex; gap: 8px; align-items: center; min-inline-size: 0; border-radius: var(--radius-field); color: inherit; text-decoration: none; }
    h2 { overflow: hidden; margin: 0; font-size: 18px; font-weight: 600; line-height: 24px; text-overflow: ellipsis; white-space: nowrap; }
    .ws-head a:hover h2 { color: var(--disp-text); }
    .path { overflow: hidden; min-inline-size: 0; color: var(--muted-ink); font-family: var(--font-mono); font-size: 12px; line-height: 16px; text-overflow: ellipsis; white-space: nowrap; }
    .end { display: inline-flex; flex: none; gap: 8px; align-items: center; white-space: nowrap; }
  `,
})
export class WsIdentity {
  /** The workspace name as core reports it. */
  readonly name = input.required<string>();
  readonly slug = input.required<string>();
  readonly pathTail = input('');
  /** Whether cover and name link to the workspace (a loading or unreadable column does not). */
  readonly link = input(true);

  private readonly demo = inject(DemoData);

  protected readonly identity = computed(() => this.demo.identity(this.slug()) ?? this.demo.identity(this.name()));
  protected readonly href = computed(() => ['/w', this.slug()]);
}

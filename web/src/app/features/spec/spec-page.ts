import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { NotFound } from '../../layout/not-found/not-found';
import { ShellData } from '../../layout/shell/shell-data.service';
import { SpecHead } from '../../layout/spec-head/spec-head';
import { TabBarSlot } from '../../layout/tab-bar/tab-bar-slot';

/**
 * `/w/:ws/s/:id`: the spec head (`app-spec-head`, T78), the tab bar's main slot, then the tab's view. An unknown spec
 * renders the not-found page (ISC-71).
 */
@Component({
  selector: 'app-spec-page',
  imports: [RouterOutlet, NotFound, SpecHead, TabBarSlot],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { display: block; }
    app-tab-bar-slot { position: sticky; inset-block-start: 64px; z-index: 1; margin-block-end: 24px; border-block-end: 1px solid var(--line); background: var(--color-base-100); }
    app-tab-bar-slot:empty { display: none; }
  `,
  template: `
    @if (data.specMissing()) {
      <app-not-found />
    } @else {
      <app-spec-head />
      <app-tab-bar-slot placement="main" />
      <router-outlet />
    }
  `,
})
export class SpecPage {
  protected readonly data = inject(ShellData);
}

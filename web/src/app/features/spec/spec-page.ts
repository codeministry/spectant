import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { NotFound } from '../../layout/not-found/not-found';
import { ShellData } from '../../layout/shell/shell-data.service';
import { SpecHead } from '../../layout/spec-head/spec-head';
import { TabBarSlot } from '../../layout/tab-bar/tab-bar-slot';

/**
 * `/w/:ws/s/:id`: the spec head (`app-spec-head`, T78), the tab bar (sticky under the header on every width, spec 024), then the tab's view. An unknown spec
 * renders the not-found page (ISC-71).
 */
@Component({
  selector: 'app-spec-page',
  imports: [RouterOutlet, NotFound, SpecHead, TabBarSlot],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { display: block; }
  `,
  template: `
    @if (data.specMissing()) {
      <app-not-found />
    } @else {
      <app-spec-head />
      <app-tab-bar-slot />
      <router-outlet />
    }
  `,
})
export class SpecPage {
  protected readonly data = inject(ShellData);
}

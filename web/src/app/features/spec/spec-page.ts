import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, type TemplateRef, viewChild } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { NotFound } from '../../layout/not-found/not-found';
import { RailContent } from '../../layout/shell/rail-content';
import { ShellData } from '../../layout/shell/shell-data.service';
import { SpecHead } from '../../layout/spec-head/spec-head';
import { TabBarSlot } from '../../layout/tab-bar/tab-bar-slot';
import { SpecRail } from './rail/spec-rail';
import { SpecStore } from './spec.store';

/**
 * `/w/:ws/s/:id`: the spec head (`app-spec-head`, T78), the tab bar (sticky under the header on every width, spec 024), then the tab's view. An unknown spec
 * renders the not-found page (ISC-71). From 1120 px it registers the spec rail (`app-spec-rail`: Where it stands,
 * Waiting on you, the key line; spec 024) with `RailContent` for every tab of the Status, Data and Notes areas,
 * so the rail is the same on each of them; below 1120 px each tab keeps its own inline blocks. Its `SpecStore` decides
 * when the rail shows and loads the claims the rail's take chip reads.
 */
@Component({
  selector: 'app-spec-page',
  imports: [RouterOutlet, NotFound, SpecHead, SpecRail, TabBarSlot],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [SpecStore],
  styleUrl: './spec-page.css',
  templateUrl: './spec-page.html',
})
export class SpecPage {
  protected readonly data = inject(ShellData);
  protected readonly store = inject(SpecStore);
  private readonly railTpl = viewChild<TemplateRef<unknown>>('rail');

  constructor() {
    inject(RailContent).register(
      {
        blocks: computed(() => (this.store.railShown() ? (this.railTpl() ?? null) : null)),
        bar: computed(() => null),
        badges: computed(() => null),
      },
      inject(DestroyRef),
    );
  }
}

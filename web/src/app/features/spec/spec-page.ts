import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, type TemplateRef, viewChild } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { NotFound } from '../../layout/not-found/not-found';
import type { AreaId } from '../../layout/shell/areas';
import { RailContent } from '../../layout/shell/rail-content';
import { ShellData } from '../../layout/shell/shell-data.service';
import { ShellState } from '../../layout/shell/shell-state.service';
import { SpecHead } from '../../layout/spec-head/spec-head';
import { TabBarSlot } from '../../layout/tab-bar/tab-bar-slot';
import { SpecRail } from './rail/spec-rail';

/** The areas whose tabs share the spec rail; the dashboard and the live area register their own rail. */
const RAIL_AREAS: ReadonlySet<AreaId> = new Set(['status', 'data', 'docs', 'notes']);

/**
 * `/w/:ws/s/:id`: the spec head (`app-spec-head`, T78), the tab bar (sticky under the header on every width, spec 024), then the tab's view. An unknown spec
 * renders the not-found page (ISC-71). From 1120 px it registers the spec rail (`app-spec-rail`: Where it stands,
 * Waiting on you, the key line; spec 024) with `RailContent` for every tab of the Status, Data, Docs and Notes areas,
 * so the rail is the same on each of them; below 1120 px each tab keeps its own inline blocks.
 */
@Component({
  selector: 'app-spec-page',
  imports: [RouterOutlet, NotFound, SpecHead, SpecRail, TabBarSlot],
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
    <ng-template #rail><app-spec-rail /></ng-template>
  `,
})
export class SpecPage {
  protected readonly data = inject(ShellData);
  private readonly state = inject(ShellState);
  private readonly railTpl = viewChild<TemplateRef<unknown>>('rail');

  /** The rail only once the spec answered, at wide, on a tab of the rail areas. */
  private readonly railShown = computed(() => {
    const area = this.state.area();
    return this.state.tier() === 'wide' && area !== null && RAIL_AREAS.has(area) && this.data.spec.value()?.kind === 'ok';
  });

  constructor() {
    inject(RailContent).register(
      {
        blocks: computed(() => (this.railShown() ? (this.railTpl() ?? null) : null)),
        bar: computed(() => null),
        badges: computed(() => null),
      },
      inject(DestroyRef),
    );
  }
}

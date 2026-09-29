import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { areaById } from '../../layout/shell/areas';
import { ShellData } from '../../layout/shell/shell-data.service';
import { ShellState } from '../../layout/shell/shell-state.service';
import { UiCard } from '../../shared/ui/card/card';

/**
 * The view of a tab (or the spec dashboard) no feature has registered in `VIEW_LOADERS` yet: names the area or tab,
 * says an unbuilt area comes with later tasks, and says when the spec route is not served yet.
 */
@Component({
  selector: 'app-area-placeholder',
  imports: [TranslocoPipe, UiCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-page': 'placeholder', '[attr.data-area]': 'state.area()', '[attr.data-tab]': 'state.tab()' },
  styles: `
    :host { display: block; }
    h2 { margin: 0 0 8px; font-size: 17px; font-weight: 600; line-height: 24px; }
    p { margin: 0; font-size: 14px; line-height: 20px; }
    p + p { margin-block-start: 8px; color: var(--muted-ink); font-size: 13px; }
  `,
  template: `
    <ui-card [padding]="24">
      @if (tabKey(); as tabKey) {
        <h2>{{ tabKey | transloco }}</h2>
        <p>{{ 'shell.placeholder.tab' | transloco: { tab: (tabKey | transloco) } }}</p>
      } @else {
        <h2>{{ areaKey() | transloco }}</h2>
        <p>{{ 'shell.placeholder.area' | transloco: { area: (areaKey() | transloco) } }}</p>
      }
      @if (!built()) {
        <p>{{ 'shell.area.unbuilt' | transloco }}</p>
      }
      @if (data.specRouteUnserved()) {
        <p>{{ 'shell.placeholder.specRoute' | transloco }}</p>
      }
    </ui-card>
  `,
})
export class AreaPlaceholder {
  protected readonly state = inject(ShellState);
  protected readonly data = inject(ShellData);
  protected readonly areaKey = computed(() => `shell.areas.${this.state.area() ?? 'dashboard'}`);
  protected readonly tabKey = computed(() => {
    const tab = this.state.tab();
    return tab === null ? null : `shell.tabs.${tab}`;
  });
  protected readonly built = computed(() => areaById(this.state.area() ?? 'dashboard').built);
}

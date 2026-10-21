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
  styleUrl: './area-placeholder.css',
  templateUrl: './area-placeholder.html',
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

import { ChangeDetectionStrategy, Component, computed, inject, resource } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import type { StatusResponse } from '../../../../../server/src/contracts/status.contract';
import { ApiClient } from '../../core/api.service';

/**
 * The status widget page (spec 071, T25, ISC-582): `/widget`, its own browser window, rendered outside `app-shell`
 * like `/__ui`; theme and language come from the root providers that run for every route (the pre-paint script, the
 * settings initializer). The page is its own size container `widget`, a centred column up to 720 px on `--color-base-200`.
 *
 * A skeleton: it loads `GET /api/status` once through `ApiClient` and lists each workspace's slug and spec ids. The
 * KPI tiles (`section.kpis`), the group heads and rows (`section.groups`), the live updates, the unreadable and empty
 * states and the window bounds are later tasks, each building on `status`.
 */
@Component({
  selector: 'app-status-widget-page',
  imports: [TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './status-widget-page.html',
  styleUrl: './status-widget-page.css',
})
export class StatusWidgetPage {
  private readonly api = inject(ApiClient);

  /** The last `GET /api/status` answer, whatever its kind. */
  private readonly load = resource({ loader: () => this.api.status() });

  /** The status body once the route answered `ok`; null while loading or after any other answer. */
  readonly status = computed<StatusResponse | null>(() => {
    const result = this.load.hasValue() ? this.load.value() : undefined;
    return result?.kind === 'ok' ? result.body : null;
  });
}

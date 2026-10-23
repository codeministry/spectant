import { ChangeDetectionStrategy, Component, computed, inject, resource } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import type { StatusResponse, StatusWorkspace } from '../../../../../server/src/contracts/status.contract';
import { ApiClient } from '../../core/api.service';
import { UiKpiTile } from '../../shared/ui/kpi-tile/kpi-tile';
import { UiNotice } from '../../shared/ui/notice/notice';
import { StatusWidgetRow } from './status-widget-row';

/**
 * The status widget page (spec 071, T25, ISC-582): `/widget`, its own browser window, rendered outside `app-shell`
 * like `/__ui`; theme and language come from the root providers that run for every route (the pre-paint script, the
 * settings initializer). The page is its own size container `widget`, a centred column up to 720 px on `--color-base-200`.
 *
 * It loads `GET /api/status` once through `ApiClient`. Above the list stand three KPI tiles whose numbers the body
 * carries, computed by core over exactly the listed specs (T26, ISC-583), never recomputed here. Below, one group per
 * workspace that lists a spec, headed by its path tail (T27, ISC-584); an unreadable workspace keeps its head with a
 * warning notice, and with no group at all one empty line stands instead (T30, ISC-588). Each listed spec is one
 * `app-status-widget-row` (T28, ISC-585). The live updates and the window bounds are later tasks, each building on
 * `status`.
 */
@Component({
  selector: 'app-status-widget-page',
  imports: [TranslocoPipe, UiKpiTile, UiNotice, StatusWidgetRow],
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

  /**
   * The workspaces that get a group, in the body's (the picker's) order: each that lists a spec (ISC-584) and each
   * unreadable one, which shows its head and a notice instead of rows (ISC-588). None left is the empty line.
   */
  readonly groups = computed<readonly StatusWorkspace[]>(
    () => this.status()?.workspaces.filter((ws) => !ws.readable || ws.specs.length > 0) ?? [],
  );
}

import { ChangeDetectionStrategy, Component, computed, DestroyRef, DOCUMENT, inject, resource } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import type { StatusKpis, StatusResponse, StatusWorkspace } from '../../../../../server/src/contracts/status.contract';
import { ApiClient } from '../../core/api.service';
import { reloadOnRefresh } from '../../layout/shell/reload-on-refresh';
import { isTabMode, saveWidgetBounds } from '../../layout/shell/widget-window';
import { UiBrandMark } from '../../shared/ui/brand-mark/brand-mark';
import { UiNotice } from '../../shared/ui/notice/notice';
import { StatusWidgetRow } from './status-widget-row';

/** How long a resize must settle before the widget stores its bounds (T33, ISC-596). */
export const BOUNDS_SETTLE_MS = 400;

/**
 * The status widget page (spec 071, T25, ISC-582): `/widget`, its own browser window, rendered outside `app-shell`
 * like `/__ui`; theme and language come from the root providers that run for every route (the pre-paint script, the
 * settings initializer). The page is its own size container `widget`, a centred column up to 720 px on `--color-base-200`.
 *
 * It loads `GET /api/status` through `ApiClient`. Above the list stands the flat head (spec 072, T8, ISC-602): the
 * brand mark, then one `dl` row of three KPIs whose numbers the body carries, computed by core over exactly the
 * listed specs (T26, ISC-583), never recomputed here. Below, one group per
 * workspace that lists a spec, headed by its path tail (T27, ISC-584); an unreadable workspace keeps its head with a
 * warning notice, and with no group at all one empty line stands instead (T30, ISC-588). Each listed spec is one
 * `app-status-widget-row` (T28, ISC-585).
 *
 * It stays current over the app's own live path (T34, ISC-587): injecting `RefreshService` starts the root
 * `LiveStreamService` (one `EventSource`, in this window without a shell too) and its fallback poll; each frame's
 * views go into the ETag cache, `STATUS_PATH` among them, and every refresh reloads the status read, which answers 304
 * with the frame's body, or a fresh body on a poll. A reload keeps the last value, so nothing is torn down, and no
 * `aria-live` announces a tick. In popup mode the window stores its bounds once a resize settles and when it closes
 * (T33, ISC-596); in tab mode never (ISC-586.1).
 */
@Component({
  selector: 'app-status-widget-page',
  imports: [TranslocoPipe, UiBrandMark, UiNotice, StatusWidgetRow],
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

  /** The head's three figures (ISC-602); null before the first `ok` body, when the head shows the mark alone. */
  readonly kpis = computed<StatusKpis | null>(() => this.status()?.kpis ?? null);

  /**
   * The workspaces that get a group, in the body's (the picker's) order: each that lists a spec (ISC-584) and each
   * unreadable one, which shows its head and a notice instead of rows (ISC-588). None left is the empty line.
   */
  readonly groups = computed<readonly StatusWorkspace[]>(
    () => this.status()?.workspaces.filter((ws) => !ws.readable || ws.specs.length > 0) ?? [],
  );

  constructor() {
    reloadOnRefresh(() => this.load.reload());
    this.keepBounds();
  }

  /** Stores the window's bounds after each settled resize and on `pagehide`, unless it runs as a tab (ISC-596). */
  private keepBounds(): void {
    const win = inject(DOCUMENT).defaultView;
    if (win === null) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const save = (): void => {
      clearTimeout(timer);
      timer = undefined;
      if (isTabMode(win)) return;
      saveWidgetBounds({ width: win.outerWidth, height: win.outerHeight, left: win.screenX, top: win.screenY }, win);
    };
    const onResize = (): void => {
      clearTimeout(timer);
      timer = setTimeout(save, BOUNDS_SETTLE_MS);
    };
    win.addEventListener('resize', onResize);
    win.addEventListener('pagehide', save);
    inject(DestroyRef).onDestroy(() => {
      clearTimeout(timer);
      win.removeEventListener('resize', onResize);
      win.removeEventListener('pagehide', save);
    });
  }
}

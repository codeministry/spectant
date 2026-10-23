import { ChangeDetectionStrategy, Component, computed, DestroyRef, DOCUMENT, inject, resource, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import type { StatusKpis, StatusResponse, StatusWorkspace } from '../../../../../server/src/contracts/status.contract';
import { ApiClient } from '../../core/api.service';
import { reloadOnRefresh } from '../../layout/shell/reload-on-refresh';
import { isTabMode, saveWidgetBounds } from '../../layout/shell/widget-window';
import { UiBrandMark } from '../../shared/ui/brand-mark/brand-mark';
import { type FilterOption, UiFilterChips } from '../../shared/ui/filter-chips/filter-chips';
import { UiNotice } from '../../shared/ui/notice/notice';
import { isToneStage, toneOfStage } from '../../shared/ui/stage-tone';
import { StatusWidgetRow } from './status-widget-row';
import { EMPTY_FILTER, stageOptions, visibleGroups, type WidgetFilter, workspaceOptions } from './widget-filter';

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
 * Between head and list stands the filter (spec 072, T19, ISC-603): two multi-select chip rows, workspace and stage,
 * over the options of the unfiltered body (`widget-filter.ts`), so a toggle never removes the chip under the focus.
 * The list renders `visibleGroups` of the selection; an empty selection is the unfiltered list. Without a listed spec
 * there is no filter, only the empty line. `filter` is the selection's single source.
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
  imports: [TranslocoPipe, UiBrandMark, UiFilterChips, UiNotice, StatusWidgetRow],
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

  private readonly transloco = inject(TranslocoService);
  private readonly lang = toSignal(this.transloco.langChanges$, { initialValue: this.transloco.getActiveLang() });

  /** The filter selection (ISC-603); empty in both dimensions shows every group. */
  readonly filter = signal<WidgetFilter>(EMPTY_FILTER);

  /**
   * The workspaces that get a group, in the body's (the picker's) order, narrowed by the filter: each with a matching
   * row (ISC-584, ISC-603) and each unreadable one the workspace selection admits, which shows its head and a notice
   * instead of rows (ISC-588). None left is the empty line.
   */
  readonly groups = computed<readonly StatusWorkspace[]>(() => {
    const body = this.status();
    return body ? visibleGroups(body, this.filter()) : [];
  });

  /** Whether the filter shows: only while the body lists a spec. */
  readonly hasFilter = computed(() => this.status()?.workspaces.some((ws) => ws.specs.length > 0) ?? false);

  /** The workspace chips: the path tail, a warning dot and a "not readable" name on an unreadable one. */
  readonly workspaceChips = computed<readonly FilterOption[]>(() => {
    const body = this.status();
    this.lang();
    if (!body) return [];
    return workspaceOptions(body).map(({ key, pathTail, readable }) =>
      readable
        ? { key, label: pathTail }
        : { key, label: pathTail, tone: 'warning', name: this.transloco.translate('statusWidget.filter.unreadable', { name: pathTail }) },
    );
  });

  /** The stage chips: the occurring stages in workflow order, with the rows' badge words and tones. */
  readonly stageChips = computed<readonly FilterOption[]>(() => {
    const body = this.status();
    this.lang();
    if (!body) return [];
    return stageOptions(body).map((stage) => ({ key: stage, label: this.transloco.translate(`stages.${stage}`), tone: toneOfStage(stage) }));
  });

  /** Replaces the workspace selection. */
  selectWorkspaces(keys: readonly string[]): void {
    this.filter.update((filter) => ({ ...filter, workspaces: [...keys] }));
  }

  /** Replaces the stage selection; a key that is no stage is ignored. */
  selectStages(keys: readonly string[]): void {
    this.filter.update((filter) => ({ ...filter, stages: keys.filter(isToneStage) }));
  }

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

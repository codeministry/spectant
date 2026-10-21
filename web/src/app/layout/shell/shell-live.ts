import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, input, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import type { DashboardBody } from '../../core/api.service';
import { LockSourceService } from '../../core/lock-source.service';
import { RefreshService } from './refresh.service';
import { UiIcon } from '../../shared/icons/icon';
import { UiPopover } from '../../shared/ui/overlay/popover';
import { relativeParts } from '../../shared/ui/relative-time/relative-time';
import { readWorkspace } from '../command-palette/palette-index';
import { ShellData } from './shell-data.service';
import { ShellState } from './shell-state.service';

/**
 * The header's status group (spec 024 T34, T40): one bordered 40 px group of
 * the live indicator and Refresh now. The indicator (ISC-73) is `activity` followed by a 6 px
 * dot, lime while one of the workspace's dev services is up and the track colour otherwise, never colour alone, since
 * its name carries the agent source and the service count. It stays this narrow at every width: "Updated 12 s ago"
 * (the refresh service's `lastRefresh`) sits in the live popover, beside what is read and how often, the agent source,
 * the round board while a spec is open and the workspace's dev services or the empty line. Refresh calls
 * `RefreshService.refresh()` (as `r` and the palette do). Below 640 px only the indicator stays. The popover loads
 * after first render (`@defer`), like the header's menus.
 */
@Component({
  selector: 'app-shell-live',
  imports: [RouterLink, TranslocoPipe, UiIcon, UiPopover],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './shell-live.html',
  styleUrl: './shell-live.css',
})
export class ShellLive {
  /** The Live area of the open spec, or null. */
  readonly link = input<readonly string[] | null>(null);
  protected readonly source = inject(LockSourceService).source;
  protected readonly refresher = inject(RefreshService);
  private readonly data = inject(ShellData);
  private readonly state = inject(ShellState);

  /** Workspaces read: the open one, or every registered one outside a workspace. */
  protected readonly workspaceCount = computed(() => (this.state.ws() === null ? this.data.workspaceList().length : 1));

  /** The open workspace's dev services from its dashboard (`services`), read as the palette reads them. */
  protected readonly services = computed(() => {
    const ws = this.state.ws();
    const result = this.data.dashboard.value() as { kind?: string; body?: DashboardBody } | undefined;
    if (ws === null || result?.kind !== 'ok' || result.body === undefined) return [];
    return readWorkspace(ws, ws, result.body).services;
  });

  /** The clock the popover's "Updated" line reads, every 10 s like `ui-relative-time` (design.md: every 10 s). */
  private readonly now = signal(Date.now());
  /** "12 s ago": whole units since the refresh service's last refresh. */
  protected readonly ago = computed(() => relativeParts(this.refresher.lastRefresh(), Math.max(this.now(), this.refresher.lastRefresh())));

  constructor() {
    const timer = setInterval(() => {
      this.now.set(Date.now());
    }, 10_000);
    inject(DestroyRef).onDestroy(() => {
      clearInterval(timer);
    });
  }

  protected readonly livePop = viewChild<UiPopover>('livePop');
  private openAtPress: boolean | null = null;

  /** A press on the open popover's trigger light-dismisses it first; the state at press time decides (as `ShellMenus`). */
  protected press(): void {
    this.openAtPress = this.livePop()?.open() ?? false;
  }

  protected toggle(trigger: HTMLElement): void {
    const wasOpen = this.openAtPress ?? this.livePop()?.open() ?? false;
    this.openAtPress = null;
    if (wasOpen) {
      this.close();
      return;
    }
    // WebKit does not focus a clicked button; the popover returns focus to whatever had it on open.
    trigger.focus();
    this.livePop()?.show(trigger);
  }

  protected close(): void {
    this.livePop()?.close();
  }
}

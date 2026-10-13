import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, input, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import type { DashboardBody } from '../../core/api.service';
import { LockSourceService } from '../../core/lock-source.service';
import { RefreshService } from '../../core/refresh.service';
import { SettingsService } from '../../core/settings.service';
import { UiIcon } from '../../shared/icons/icon';
import { UiChip } from '../../shared/ui/chip/chip';
import { UiPopover } from '../../shared/ui/overlay/popover';
import { relativeParts } from '../../shared/ui/relative-time/relative-time';
import { readWorkspace } from '../command-palette/palette-index';
import { ShellData } from './shell-data.service';
import { ShellState } from './shell-state.service';

/** The interval popover's choices (prototype `pop-interval`); the setting allows 5 to 3600 s, so there is no "Off". */
const INTERVALS = [10, 30, 60] as const;

type Pop = 'live' | 'interval';

/**
 * The header's status group (prototype `[data-ui="live-indicator"]`, spec 024 T34, T40): one bordered 40 px group of
 * the live indicator, Refresh now and the refresh interval. The indicator (ISC-73) is `activity` followed by a 6 px
 * dot, lime while one of the workspace's dev services is up and the track colour otherwise, never colour alone, since
 * its name carries the agent source and the service count. It stays this narrow at every width: "Updated 12 s ago"
 * (the refresh service's `lastRefresh`) sits in the live popover, beside what is read and how often, the agent source,
 * the round board while a spec is open and the workspace's dev services or the empty line. The interval opens the
 * interval popover, which stores `settings.refreshSeconds`. Refresh calls
 * `RefreshService.refresh()` (as `r` and the palette do). Below 640 px only the indicator stays. The popovers load
 * after first render (`@defer`), like the header's menus.
 */
@Component({
  selector: 'app-shell-live',
  imports: [RouterLink, TranslocoPipe, UiChip, UiIcon, UiPopover],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="group">
      @let sourceText = 'shell.live.source.' + source() | transloco;
      @let servicesText =
        services().length === 0
          ? ('shell.live.servicesDown' | transloco)
          : ('shell.live.servicesUp' | transloco: { count: services().length });
      <button
        #liveTrigger
        type="button"
        class="part live"
        data-control="live"
        aria-haspopup="dialog"
        [attr.data-source]="source()"
        [attr.data-services]="services().length === 0 ? 'down' : 'up'"
        [attr.aria-expanded]="livePop()?.open() ?? false"
        [attr.aria-label]="'shell.live.status' | transloco: { source: sourceText, services: servicesText }"
        [attr.title]="sourceText + ' · ' + servicesText"
        (pointerdown)="press('live')"
        (click)="toggle('live', liveTrigger)"
      >
        <ui-icon name="activity" [size]="16" />
        <span class="live-dot" aria-hidden="true"></span>
      </button>
      <button
        type="button"
        class="part refresh"
        data-tool="refresh"
        [attr.aria-label]="'shell.refresh.now' | transloco"
        [attr.title]="'shell.refresh.now' | transloco"
        (click)="refresher.refresh()"
      >
        <ui-icon name="refresh-cw" [size]="16" />
      </button>
      @let secondsText = 'shell.refresh.seconds' | transloco: { seconds: seconds() };
      <button
        #intervalTrigger
        type="button"
        class="part interval"
        data-tool="interval"
        aria-haspopup="dialog"
        [attr.aria-expanded]="intervalPop()?.open() ?? false"
        [attr.aria-label]="('shell.refresh.interval' | transloco) + ': ' + secondsText"
        [attr.title]="'shell.refresh.interval' | transloco"
        (pointerdown)="press('interval')"
        (click)="toggle('interval', intervalTrigger)"
      >
        <ui-icon name="timer" [size]="16" />
        <span class="seconds" aria-hidden="true">{{ secondsText }}</span>
      </button>
    </div>

    @defer (on immediate) {
      <ui-popover #livePop class="live-pop" placement="end" [label]="'shell.live.heading' | transloco">
        <div class="pop-head">{{ 'shell.live.heading' | transloco }}</div>
        <div class="service" data-live-reading>
          <span class="status-dot" [attr.data-source]="source()" aria-hidden="true"></span>
          <span class="grow">{{ 'shell.live.reading' | transloco: { count: workspaceCount(), seconds: seconds() } }}</span>
        </div>
        <div class="service meta updated" data-live-updated>
          {{ 'shell.live.updated' | transloco }} {{ 'shell.live.ago' | transloco: ago() }}
        </div>
        <div class="service meta" data-live-source>{{ sourceText }}</div>
        @if (link(); as target) {
          <a class="pop-item" data-live-board data-autofocus [routerLink]="target" (click)="close('live')">
            <ui-icon name="workflow" [size]="16" />
            <span class="grow">{{ 'shell.live.board' | transloco }}</span>
            <ui-icon class="go" name="arrow-right" [size]="14" />
          </a>
        }
        <div class="pop-sep"></div>
        <div class="pop-head">{{ 'shell.live.services' | transloco }}</div>
        @for (service of services(); track service.port) {
          @let kind = service.label ?? service.process;
          <a
            class="service service-link"
            data-live-service
            target="_blank"
            rel="noopener noreferrer"
            [href]="service.url"
            [attr.aria-label]="'shell.live.openService' | transloco: { kind, port: service.port }"
          >
            <span class="status-dot" aria-hidden="true"></span>
            <span class="mono">{{ service.port }}</span>
            <span class="meta grow">{{ kind }}</span>
            <ui-icon class="go" name="arrow-right" [size]="13" />
          </a>
        } @empty {
          <div class="service meta" data-live-services-empty>{{ 'shell.live.noServices' | transloco }}</div>
        }
      </ui-popover>
      <ui-popover #intervalPop class="interval-pop" placement="end" [label]="'shell.refresh.interval' | transloco">
        <!-- The prototype's "Off": the setting allows 5 to 3600 s only, so it is shown disabled with the demo chip; only
             while the popover is open, so a page of real data carries no mock in its DOM (parity -g demo). -->
        @if (intervalPop.open()) {
          <button type="button" class="pop-item interval-off" data-interval="off" data-demo data-demo-head disabled>
            <span class="grow">{{ 'shell.refresh.off' | transloco }}</span>
            <ui-chip variant="demo" />
          </button>
        }
        @for (choice of intervals; track choice) {
          <button
            type="button"
            class="pop-item"
            [attr.data-interval]="choice"
            [attr.aria-current]="choice === seconds() ? 'true' : null"
            [attr.data-autofocus]="choice === seconds() ? '' : null"
            (click)="setInterval(choice)"
          >
            <span class="grow">{{ 'shell.refresh.seconds' | transloco: { seconds: choice } }}</span>
          </button>
        }
      </ui-popover>
    }
  `,
  styleUrl: './shell-live.css',
})
export class ShellLive {
  /** The Live area of the open spec, or null. */
  readonly link = input<readonly string[] | null>(null);
  protected readonly source = inject(LockSourceService).source;
  protected readonly refresher = inject(RefreshService);
  private readonly settings = inject(SettingsService);
  private readonly data = inject(ShellData);
  private readonly state = inject(ShellState);

  protected readonly intervals = INTERVALS;
  protected readonly seconds = computed(() => this.settings.settings().refreshSeconds);
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
  protected readonly intervalPop = viewChild<UiPopover>('intervalPop');
  private openAtPress: boolean | null = null;

  /** A press on an open popover's trigger light-dismisses it first; the state at press time decides (as `ShellMenus`). */
  protected press(kind: Pop): void {
    this.openAtPress = this.popover(kind)?.open() ?? false;
  }

  protected toggle(kind: Pop, trigger: HTMLElement): void {
    const wasOpen = this.openAtPress ?? this.popover(kind)?.open() ?? false;
    this.openAtPress = null;
    if (wasOpen) {
      this.close(kind);
      return;
    }
    // WebKit does not focus a clicked button; the popover returns focus to whatever had it on open.
    trigger.focus();
    this.popover(kind)?.show(trigger);
  }

  protected close(kind: Pop): void {
    this.popover(kind)?.close();
  }

  protected setInterval(seconds: number): void {
    void this.settings.update({ refreshSeconds: seconds });
    this.close('interval');
  }

  private popover(kind: Pop): UiPopover | undefined {
    return kind === 'live' ? this.livePop() : this.intervalPop();
  }
}

import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal, viewChild } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { type WorkspaceStatus, workspaceStatusOf } from '../../../../../server/src/workspace-admin.contract';
import type { WorkspaceListEntry } from '../../core/api.service';
import { ShellState } from '../../layout/shell/shell-state.service';
import { UiIconButton } from '../../shared/ui/button/icon-button';
import { UiPopover, UiPopoverTrigger } from '../../shared/ui/overlay/popover';
import { UiSheet } from '../../shared/ui/overlay/sheet';
import { WS_ACCENT_TOKENS, wsAccent } from '../../shared/ui/ws-badge/ws-identity';
import { UiWsBadge } from '../../shared/ui/ws-badge/ws-badge';
import { UiWsCover } from '../../shared/ui/ws-badge/ws-cover';

/** One count of the entry's dashboard KPIs, read narrowly: `WorkspaceListEntry.counts` is untyped in web. */
function countOf(counts: unknown, key: 'specs' | 'building'): number | null {
  if (typeof counts !== 'object' || counts === null) return null;
  const value: unknown = (counts as Readonly<Record<string, unknown>>)[key];
  return typeof value === 'number' ? value : null;
}

/**
 * One row of `/settings/workspaces` (spec 016, T15, ISC-309; design.md § Zeile on all three viewports): the screenshot
 * thumb (`ui-ws-cover`, 64 × 40, the name pattern without an image), the badge (`ui-ws-badge`, initials without a logo)
 * and the name as a link to `/w/<slug>`, the path tail (never an absolute path), the status as dot plus word from the
 * summary's `status`, the counts, and the ⋯ menu: a `ui-popover` from medium, a `ui-sheet tier="compact"` below, the
 * tier read from `ShellState`. The accent comes from the name hash as `ui-ws-badge` picks it, so it stays with the
 * workspace under every sort order.
 *
 * The row writes nothing: each menu entry but Open emits the entry, and the page wires the writes (T16 to T21). Open
 * is a plain link. Mounted on an `<li>` so the page's list keeps its list semantics.
 */
@Component({
  // eslint-disable-next-line @angular-eslint/component-selector -- an attribute on the page's <li>, so the list stays a list
  selector: 'li[app-workspace-row]',
  imports: [NgTemplateOutlet, RouterLink, TranslocoPipe, UiIconButton, UiPopover, UiPopoverTrigger, UiSheet, UiWsBadge, UiWsCover],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'ws-row',
    '[attr.data-ws-row]': 'entry().slug',
    '[attr.data-tier]': 'tier()',
    '[style.--ws]': 'tokens().mark',
    '[style.--ws-ink]': 'tokens().ink',
  },
  templateUrl: './workspace-row.html',
  styleUrl: './workspace-row.css',
})
export class WorkspaceRow {
  private readonly shell = inject(ShellState);

  readonly entry = input.required<WorkspaceListEntry>();
  /** The logo's loopback URL; null shows the initials. T18 passes the image route. */
  readonly logo = input<string | null>(null);
  /** The screenshot's loopback URL; null shows the name pattern. T19 passes the image route. */
  readonly screenshot = input<string | null>(null);

  readonly rename = output<WorkspaceListEntry>();
  readonly rescan = output<WorkspaceListEntry>();
  readonly uploadLogo = output<WorkspaceListEntry>();
  readonly uploadScreenshot = output<WorkspaceListEntry>();
  readonly remove = output<WorkspaceListEntry>();

  protected readonly tier = this.shell.tier;
  protected readonly compact = computed(() => this.tier() === 'compact');
  protected readonly tokens = computed(() => WS_ACCENT_TOKENS[wsAccent(this.entry().name)]);
  protected readonly specs = computed(() => countOf(this.entry().counts, 'specs'));
  protected readonly active = computed(() => countOf(this.entry().counts, 'building') ?? 0);
  protected readonly status = computed<WorkspaceStatus>(() => this.entry().status ?? workspaceStatusOf(this.entry().readable, this.specs()));
  protected readonly link = computed(() => ['/w', this.entry().slug]);

  /** The compact sheet's open state; the popover holds its own. */
  protected readonly sheetOpen = signal(false);
  private readonly popover = viewChild(UiPopover);

  /** Closes whichever menu is open, then emits the entry on the chosen output. */
  protected act(action: 'rename' | 'rescan' | 'uploadLogo' | 'uploadScreenshot' | 'remove'): void {
    this.close();
    this[action].emit(this.entry());
  }

  protected close(): void {
    this.popover()?.close();
    this.sheetOpen.set(false);
  }
}

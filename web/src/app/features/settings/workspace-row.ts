import { ChangeDetectionStrategy, Component, computed, type ElementRef, inject, input, output, signal, viewChild } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import {
  IMAGE_MAX_BYTES,
  IMAGE_TYPES,
  type ImageKind,
  sniffImageType,
  type WorkspaceStatus,
  workspaceStatusOf,
} from '../../../../../server/src/workspace-admin.contract';
import type { WorkspaceAdminResult, WorkspaceListEntry } from '../../core/api.service';
import { ShellData } from '../../layout/shell/shell-data.service';
import { ShellState } from '../../layout/shell/shell-state.service';
import { ToastService } from '../../shared/ui/toast/toast';
import { UiIconButton } from '../../shared/ui/button/icon-button';
import { UiNotice } from '../../shared/ui/notice/notice';
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

/** What the hidden file inputs accept: the contract's image types (PNG, JPEG, WebP), never SVG. */
const IMAGE_ACCEPT = Object.values(IMAGE_TYPES)
  .map((type) => type.contentType)
  .join(',');

/** The bytes the pre-check reads: enough for every signature in `IMAGE_TYPES` (WebP's ends at offset 12). */
const SNIFF_BYTES = 16;

/** One upload refusal under the row (T19): which image, why, and the limit in MB the text names. */
export interface UploadNotice {
  readonly kind: ImageKind;
  readonly reason: 'type' | 'size' | 'failed';
  readonly max: number;
}

const toMb = (bytes: number): number => Math.round(bytes / (1024 * 1024));

/**
 * The client pre-check (ISC-311): a file over the limit or one whose first bytes are no PNG, JPEG or WebP is refused
 * as the server would refuse it (413, 415), so nothing is sent; null lets the upload go.
 */
async function precheck(file: Blob): Promise<WorkspaceAdminResult<'putImage'> | null> {
  if (file.size > IMAGE_MAX_BYTES) return { kind: 'refused', status: 413, body: { error: 'too-large', maxBytes: IMAGE_MAX_BYTES } };
  const head = new Uint8Array(await file.slice(0, SNIFF_BYTES).arrayBuffer());
  if (sniffImageType(head) === null) return { kind: 'refused', status: 415, body: { error: 'unsupported-type' } };
  return null;
}

/** The notice an upload result leaves under the row, or null after a success. */
function noticeOf(kind: ImageKind, result: WorkspaceAdminResult<'putImage'>): UploadNotice | null {
  if (result.kind === 'ok') return null;
  const max = toMb(result.kind === 'refused' && 'maxBytes' in result.body ? result.body.maxBytes : IMAGE_MAX_BYTES);
  if (result.kind === 'refused' && result.body.error === 'too-large') return { kind, reason: 'size', max };
  if (result.kind === 'refused' && result.body.error === 'unsupported-type') return { kind, reason: 'type', max };
  return { kind, reason: 'failed', max };
}

/**
 * One row of `/settings/workspaces` (spec 016, T15, ISC-309; design.md § Zeile on all three viewports): the screenshot
 * thumb (`ui-ws-cover`, 64 × 40, the name pattern without an image), the badge (`ui-ws-badge`, initials without a logo)
 * and the name as a link to `/w/<slug>`, the path tail (never an absolute path), the status as dot plus word from the
 * summary's `status`, the counts, and the ⋯ menu: a `ui-popover` from medium, a `ui-sheet tier="compact"` below, the
 * tier read from `ShellState`. The accent comes from the name hash as `ui-ws-badge` picks it, so it stays with the
 * workspace under every sort order.
 *
 * Re-scan (T17, ISC-306) runs in the row through `ShellData.rescanWorkspace`: the row is `aria-busy`, "Re-reading…"
 * stands in the status slot on compact and a spinner with "re-reading…" in the counts cell from medium, the menu
 * entry is disabled; the list reload brings the fresh counts, and the result is spoken through the app's one
 * `ui-live-region` (`ToastService.announce`, no visible toast). Every other entry but Open emits the entry and the
 * page wires the write (T16, T21); re-scan still emits too. Upload (T18, ISC-310) runs in the row as well: one hidden
 * file input per kind, opened from the menu entries and, for the screenshot, from a click on the thumb, sends the file
 * through `ShellData.uploadWorkspaceImage`; the list reload brings the new versioned URL, which the badge and the
 * 16:10 thumb read from `entry().images`. The result is spoken through the same live region; the upload outputs still
 * emit. T19 (ISC-311) adds the client pre-check (size, then the first bytes) and one persistent `ui-notice tone="error"`
 * under the row, full row width on every tier, for a refusal by the client or the server, never a toast. Open is a
 * plain link. Mounted on an `<li>` so the page's list keeps its list semantics.
 */
@Component({
  // eslint-disable-next-line @angular-eslint/component-selector -- an attribute on the page's <li>, so the list stays a list
  selector: 'li[app-workspace-row]',
  imports: [NgTemplateOutlet, RouterLink, TranslocoPipe, UiIconButton, UiNotice, UiPopover, UiPopoverTrigger, UiSheet, UiWsBadge, UiWsCover],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'ws-row',
    '[attr.data-ws-row]': 'entry().slug',
    '[attr.data-tier]': 'tier()',
    '[attr.aria-busy]': 'busy() ? "true" : null',
    '[style.--ws]': 'tokens().mark',
    '[style.--ws-ink]': 'tokens().ink',
  },
  templateUrl: './workspace-row.html',
  styleUrl: './workspace-row.css',
})
export class WorkspaceRow {
  private readonly shell = inject(ShellState);
  private readonly data = inject(ShellData);
  private readonly toasts = inject(ToastService);
  private readonly transloco = inject(TranslocoService);

  readonly entry = input.required<WorkspaceListEntry>();

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
  /** The logo's versioned loopback URL from the list entry; null shows the initials. */
  protected readonly logo = computed(() => this.entry().images?.logo ?? null);
  /** The screenshot's versioned loopback URL from the list entry; null shows the name pattern. */
  protected readonly screenshot = computed(() => this.entry().images?.screenshot ?? null);
  protected readonly accept = IMAGE_ACCEPT;
  private readonly logoInput = viewChild.required<ElementRef<HTMLInputElement>>('logoInput');
  private readonly screenshotInput = viewChild.required<ElementRef<HTMLInputElement>>('screenshotInput');
  private readonly inputs = { logo: this.logoInput, screenshot: this.screenshotInput };

  /** The upload refusal shown under the row (T19), or null. */
  protected readonly notice = signal<UploadNotice | null>(null);

  /** True while this row's re-scan is in flight (T17). */
  protected readonly busy = signal(false);

  /** The compact sheet's open state; the popover holds its own. */
  protected readonly sheetOpen = signal(false);
  private readonly popover = viewChild(UiPopover);

  /** Closes whichever menu is open, then emits the entry on the chosen output. */
  protected act(action: 'rename' | 'rescan' | 'uploadLogo' | 'uploadScreenshot' | 'remove'): void {
    this.close();
    this[action].emit(this.entry());
    if (action === 'rescan') void this.runRescan();
    if (action === 'uploadLogo') this.pick('logo');
    if (action === 'uploadScreenshot') this.pick('screenshot');
  }

  /** Opens the file chooser of one kind (the menu entries and the thumb). */
  protected pick(kind: ImageKind): void {
    this.inputs[kind]().nativeElement.click();
  }

  /**
   * Sends the chosen file as the workspace's image of `kind` and speaks the result; the input is cleared for a retry.
   * The client pre-check (T19, ISC-311) refuses a file over `IMAGE_MAX_BYTES` or one whose first bytes `sniffImageType`
   * does not know (SVG, a renamed text file; the file's own type and name are not trusted) before any request. Every
   * refusal, the client's or the server's, stays under the row until dismissed or a later success of that kind.
   */
  protected async upload(kind: ImageKind): Promise<void> {
    const input = this.inputs[kind]().nativeElement;
    const file = input.files?.[0];
    input.value = '';
    if (file === undefined) return;
    const { slug, name } = this.entry();
    const refused = await precheck(file);
    const result = refused ?? (await this.data.uploadWorkspaceImage(slug, kind, file));
    this.toasts.announce(this.uploadText(kind, name, result));
    const notice = noticeOf(kind, result);
    if (notice !== null) this.notice.set(notice);
    else if (this.notice()?.kind === kind) this.notice.set(null);
  }

  private uploadText(kind: ImageKind, name: string, result: WorkspaceAdminResult<'putImage'>): string {
    const key = 'settingsWorkspaces.row.';
    if (result.kind === 'ok') return this.transloco.translate(`${key}${kind === 'logo' ? 'uploadedLogo' : 'uploadedScreenshot'}`, { name });
    if (result.kind === 'refused' && result.body.error === 'too-large') {
      const max = 'maxBytes' in result.body ? result.body.maxBytes : IMAGE_MAX_BYTES;
      return this.transloco.translate(`${key}uploadTooLarge`, { name, max: Math.round(max / (1024 * 1024)) });
    }
    if (result.kind === 'refused' && result.body.error === 'unsupported-type') return this.transloco.translate(`${key}uploadUnsupported`, { name });
    return this.transloco.translate(`${key}uploadFailed`, { name });
  }

  /** Re-reads the workspace from its files (ISC-306) and speaks the result; the list reload shows the fresh counts. */
  private async runRescan(): Promise<void> {
    if (this.busy()) return;
    const { slug, name } = this.entry();
    this.busy.set(true);
    try {
      const result = await this.data.rescanWorkspace(slug);
      this.toasts.announce(
        result.kind === 'ok'
          ? this.transloco.translate('settingsWorkspaces.row.rescanned', { name, counts: this.countsText(result.body.counts) })
          : this.transloco.translate('settingsWorkspaces.row.rescanFailed', { name }),
      );
    } finally {
      this.busy.set(false);
    }
  }

  /** The counts as the row prints them, for the announcement. */
  private countsText(counts: unknown): string {
    const specs = countOf(counts, 'specs');
    if (specs === null) return this.transloco.translate('settingsWorkspaces.row.noCounts');
    const key = specs === 1 ? 'settingsWorkspaces.row.countsOne' : 'settingsWorkspaces.row.counts';
    return this.transloco.translate(key, { specs, active: countOf(counts, 'building') ?? 0 });
  }

  protected close(): void {
    this.popover()?.close();
    this.sheetOpen.set(false);
  }
}

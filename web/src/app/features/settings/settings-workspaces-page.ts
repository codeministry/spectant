import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import type { WorkspaceListEntry } from '../../core/api.service';
import { ShellData } from '../../layout/shell/shell-data.service';
import { UiIcon } from '../../shared/icons/icon';
import { UiButton } from '../../shared/ui/button/button';
import { UiCard } from '../../shared/ui/card/card';
import { UiCommandChip } from '../../shared/ui/command-chip/command-chip';
import { UiEmptyState } from '../../shared/ui/empty-state/empty-state';
import { UiNotice } from '../../shared/ui/notice/notice';
import { UiDialog } from '../../shared/ui/overlay/dialog';
import { UiPageHead } from '../../shared/ui/page-head/page-head';
import { UiSkeleton } from '../../shared/ui/skeleton/skeleton';
import { WorkspaceRow } from './workspace-row';

/** How long the list may load before the skeleton rows show (design.md § Zustände), so a fast answer never flashes. */
const SKELETON_DELAY_MS = 150;

/** An add refusal shown inline under the path field, keyed like `settingsWorkspaces.add.error.*`. */
type AddError =
  | { readonly key: 'empty' | 'notADirectory' | 'failed' }
  | { readonly key: 'duplicatePath'; readonly name: string };

/**
 * `/settings/workspaces` (spec 016, T14, ISC-312): the registry's entries from `GET /api/workspaces` through
 * `ShellData.workspaces`, the resource the header's workspace menu reads too. The add form posts through
 * `ShellData.addWorkspace`, which reloads that resource, so a new entry shows here and in the header without a
 * restart (ISC-303). Loading shows three skeleton rows after 150 ms, an empty registry the empty state with the CLI
 * command, a failed read an error notice with Retry; the form stays usable in every state.
 *
 * Each entry renders as `app-workspace-row` (T15), which emits its menu actions. Later tasks own the rest: rename (T16), re-scan (T17), upload (T18, T19), the
 * sort control (T20) and the remove write (T21). Until then only Remove is wired, and its dialog only opens and closes.
 */
@Component({
  selector: 'app-settings-workspaces-page',
  imports: [
    TranslocoPipe,
    UiButton,
    UiCard,
    UiCommandChip,
    UiDialog,
    UiEmptyState,
    UiIcon,
    UiNotice,
    UiPageHead,
    UiSkeleton,
    WorkspaceRow,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-page': 'settings-workspaces' },
  templateUrl: './settings-workspaces-page.html',
  styleUrl: './settings-workspaces-page.css',
})
export class SettingsWorkspacesPage {
  private readonly data = inject(ShellData);

  /** The list read as served: undefined while the first read runs, else the `ApiResult`. */
  private readonly result = computed(() => (this.data.workspaces.hasValue() ? this.data.workspaces.value() : undefined));
  protected readonly view = computed<'loading' | 'error' | 'empty' | 'list'>(() => {
    const result = this.result();
    if (result === undefined) return this.data.workspaces.error() === undefined && this.data.workspaces.isLoading() ? 'loading' : 'error';
    if (result.kind !== 'ok') return 'error';
    return result.body.length === 0 ? 'empty' : 'list';
  });
  protected readonly rows = computed<readonly WorkspaceListEntry[]>(() => {
    const result = this.result();
    return result?.kind === 'ok' ? result.body : [];
  });
  protected readonly total = computed(() => this.rows().length);

  /** Set once the first read has run longer than `SKELETON_DELAY_MS`. */
  protected readonly slow = signal(false);
  protected readonly skeletons = [0, 1, 2];

  /** What the add form's fields hold; local to the page, never stored. */
  protected readonly path = signal('');
  protected readonly name = signal('');
  protected readonly busy = signal(false);
  protected readonly addError = signal<AddError | null>(null);

  /** The row the remove dialog asks about; the dialog changes nothing until T21 wires the write. */
  protected readonly removing = signal<WorkspaceListEntry | null>(null);
  protected readonly removeOpen = signal(false);

  protected readonly command = 'spectant add | list | remove';
  protected readonly addCommand = 'spectant add <path>';

  constructor() {
    const timer = setTimeout(() => this.slow.set(true), SKELETON_DELAY_MS);
    inject(DestroyRef).onDestroy(() => clearTimeout(timer));
  }

  protected setPath(value: string): void {
    this.path.set(value);
    this.addError.set(null);
  }

  protected retry(): void {
    this.data.workspaces.reload();
  }

  /**
   * The form's submit: an empty path is refused here without a request; otherwise `POST /api/workspaces` with the
   * path as typed and the name only when one is given. A refusal shows inline under the path field; an accepted add
   * empties the form, and `ShellData` reloads the list the page and the header read. No toast.
   */
  protected async add(event?: Event): Promise<void> {
    event?.preventDefault();
    if (this.busy()) return;
    const path = this.path().trim();
    if (path === '') {
      this.addError.set({ key: 'empty' });
      return;
    }
    const name = this.name().trim();
    this.busy.set(true);
    this.addError.set(null);
    try {
      const result = await this.data.addWorkspace(name === '' ? { path: this.path() } : { path: this.path(), name });
      if (result.kind === 'ok') {
        this.path.set('');
        this.name.set('');
      } else this.addError.set(this.errorOf(result));
    } finally {
      this.busy.set(false);
    }
  }

  private errorOf(result: Exclude<Awaited<ReturnType<ShellData['addWorkspace']>>, { readonly kind: 'ok' }>): AddError {
    if (result.kind !== 'refused') return { key: 'failed' };
    const body = result.body;
    switch (body.error) {
      case 'invalid-path':
        return { key: 'empty' };
      case 'not-a-directory':
        return { key: 'notADirectory' };
      case 'duplicate-path':
        return { key: 'duplicatePath', name: this.data.workspaceName(body.slug) };
      default:
        return { key: 'failed' };
    }
  }

  protected askRemove(entry: WorkspaceListEntry): void {
    this.removing.set(entry);
    this.removeOpen.set(true);
  }
}

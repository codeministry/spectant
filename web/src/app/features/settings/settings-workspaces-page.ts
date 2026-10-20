import { ChangeDetectionStrategy, Component, computed, DestroyRef, ElementRef, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import {
  compareWorkspaces,
  DEFAULT_WORKSPACE_SORT,
  WORKSPACE_SORT_KEYS,
  type WorkspaceSortKey,
  type WorkspaceStatus,
  workspaceSortKeyOf,
  workspaceStatusOf,
} from '../../../../../server/src/workspace-admin.contract';
import type { WorkspaceListEntry } from '../../core/api.service';
import { SettingsService } from '../../core/settings.service';
import { ShellData } from '../../layout/shell/shell-data.service';
import { ShellState } from '../../layout/shell/shell-state.service';
import { type SortOption, UiSortMenu } from '../../shared/ui/sort-menu/sort-menu';
import { UiIcon } from '../../shared/icons/icon';
import { UiButton } from '../../shared/ui/button/button';
import { UiCard } from '../../shared/ui/card/card';
import { UiCommandChip } from '../../shared/ui/command-chip/command-chip';
import { UiEmptyState } from '../../shared/ui/empty-state/empty-state';
import { UiNotice } from '../../shared/ui/notice/notice';
import { UiDialog } from '../../shared/ui/overlay/dialog';
import { UiPageHead } from '../../shared/ui/page-head/page-head';
import { UiSkeleton } from '../../shared/ui/skeleton/skeleton';
import { ToastService } from '../../shared/ui/toast/toast';
import { WorkspaceRow } from './workspace-row';

/** How long the list may load before the skeleton rows show (design.md § Zustände), so a fast answer never flashes. */
const SKELETON_DELAY_MS = 150;

/** An add refusal shown inline under the path field, keyed like `settingsWorkspaces.add.error.*`. */
type AddError =
  | { readonly key: 'empty' | 'notADirectory' | 'failed' }
  | { readonly key: 'duplicatePath'; readonly name: string };

/** A rename refusal shown inline in the dialog, keyed like `settingsWorkspaces.rename.error.*`. */
type RenameError = 'invalidName' | 'failed';

/** Why a remove did not land, shown in the dialog, keyed like `settingsWorkspaces.remove.error.*`; 0 is no answer. */
interface RemoveError {
  readonly key: 'notFound' | 'failed' | 'noAnswer';
  readonly status: number;
}

/** Typing targets: a key pressed here is text, never a shortcut (as `KeyboardService`). */
const TYPING = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';

/** An entry as the contract's comparator reads it; an entry without `status` derives it as the row shows it. */
function sortable(entry: WorkspaceListEntry): { slug: string; name: string; status: WorkspaceStatus } {
  const counts: unknown = entry.counts;
  const specs = typeof counts === 'object' && counts !== null ? (counts as Readonly<Record<string, unknown>>)['specs'] : undefined;
  const status = entry.status ?? workspaceStatusOf(entry.readable, typeof specs === 'number' ? specs : null);
  return { slug: entry.slug, name: entry.name, status };
}

/** How often and how long the focus return waits for the rename dialog to close before it moves focus. */
const FOCUS_TRIES = 20;
const FOCUS_STEP_MS = 16;

/**
 * `/settings/workspaces` (spec 016, T14, ISC-312): the registry's entries from `GET /api/workspaces` through
 * `ShellData.workspaces`, the resource the header's workspace menu reads too. The add form posts through
 * `ShellData.addWorkspace`, which reloads that resource, so a new entry shows here and in the header without a
 * restart (ISC-303). Loading shows three skeleton rows after 150 ms, an empty registry the empty state with the CLI
 * command, a failed read an error notice with Retry; the form stays usable in every state.
 *
 * Each entry renders as `app-workspace-row` (T15), which emits its menu actions. Rename (T16, ISC-305) opens a dialog
 * that sends the name only; `?sort=` (T20, ISC-313) orders the rows on the client with the contract's comparator.
 * Remove (T21, ISC-314) asks in a dialog that starts on Cancel and sends `DELETE` only after Confirm. Re-scan (T17)
 * and upload (T18, T19) are wired by their own tasks.
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
    UiSortMenu,
    WorkspaceRow,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-page': 'settings-workspaces', '(keydown)': 'onKey($event)' },
  templateUrl: './settings-workspaces-page.html',
  styleUrl: './settings-workspaces-page.css',
})
export class SettingsWorkspacesPage {
  private readonly data = inject(ShellData);
  private readonly settings = inject(SettingsService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly transloco = inject(TranslocoService);
  private readonly toast = inject(ToastService);
  private readonly params = toSignal(this.route.queryParamMap, { requireSync: true });
  private readonly lang = toSignal(this.transloco.langChanges$, { initialValue: this.transloco.getActiveLang() });

  /** The list read as served: undefined while the first read runs, else the `ApiResult`. */
  private readonly result = computed(() => (this.data.workspaces.hasValue() ? this.data.workspaces.value() : undefined));
  protected readonly view = computed<'loading' | 'error' | 'empty' | 'list'>(() => {
    const result = this.result();
    if (result === undefined) return this.data.workspaces.error() === undefined && this.data.workspaces.isLoading() ? 'loading' : 'error';
    if (result.kind !== 'ok') return 'error';
    return result.body.length === 0 ? 'empty' : 'list';
  });
  /** `?sort=` (T20, ISC-313): the router's query param, so reload and back keep it; `added` when missing or unknown. */
  protected readonly sort = computed<WorkspaceSortKey>(() => workspaceSortKeyOf(this.params().get('sort')));
  protected readonly sortOptions = computed<SortOption[]>(() => {
    this.lang();
    return WORKSPACE_SORT_KEYS.map((key) => ({ key, label: this.transloco.translate(`settingsWorkspaces.sort.${key}`) }));
  });
  protected readonly tier = inject(ShellState).tier;

  /** The registry's entries sorted on the client with the contract's comparator; sorting reads nothing anew. */
  protected readonly rows = computed<readonly WorkspaceListEntry[]>(() => {
    const result = this.result();
    if (result?.kind !== 'ok') return [];
    const compare = compareWorkspaces(this.sort());
    return [...result.body].sort((a, b) => compare(sortable(a), sortable(b)));
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

  /** The row the rename dialog renames, what its field holds, and its state (T16); local, never stored. */
  protected readonly renaming = signal<WorkspaceListEntry | null>(null);
  protected readonly renameOpen = signal(false);
  protected readonly renameName = signal('');
  protected readonly renameBusy = signal(false);
  protected readonly renameError = signal<RenameError | null>(null);
  private renameTrigger: HTMLElement | null = null;

  /** The row the remove dialog asks about and its state (T21); local, never stored. */
  protected readonly removing = signal<WorkspaceListEntry | null>(null);
  protected readonly removeOpen = signal(false);
  protected readonly removeBusy = signal(false);
  protected readonly removeError = signal<RemoveError | null>(null);
  private removeTrigger: HTMLElement | null = null;

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

  /**
   * Opens the rename dialog (T16, ISC-305) for one row, from its menu or from `e` on the focused row: the field holds
   * the name, the slug stands below it unchangeable. Focus goes back to the row's menu trigger when it closes.
   */
  protected askRename(entry: WorkspaceListEntry): void {
    this.renaming.set(entry);
    this.renameName.set(entry.name);
    this.renameError.set(null);
    this.renameTrigger = this.rowElement(entry.slug)?.querySelector<HTMLElement>('[data-row-menu]') ?? null;
    this.renameOpen.set(true);
  }

  protected setRenameName(value: string): void {
    this.renameName.set(value);
    this.renameError.set(null);
  }

  /** The dialog's open state; Esc, Cancel, the close button and a backdrop click land here and send nothing. */
  protected setRenameOpen(open: boolean): void {
    this.renameOpen.set(open);
    if (open) return;
    this.renameError.set(null);
    this.returnFocus();
  }

  /**
   * Save: `PATCH /api/workspaces/:ws` with the trimmed name and nothing else, through `ShellData`, which reloads the
   * list. A blank name is refused inline without a request; the server's `invalid-name` shows the same way.
   */
  protected async saveRename(event?: Event): Promise<void> {
    event?.preventDefault();
    const entry = this.renaming();
    if (entry === null || this.renameBusy()) return;
    const name = this.renameName().trim();
    if (name === '') {
      this.renameError.set('invalidName');
      return;
    }
    this.renameBusy.set(true);
    this.renameError.set(null);
    try {
      const result = await this.data.renameWorkspace(entry.slug, name);
      if (result.kind === 'ok') this.setRenameOpen(false);
      else this.renameError.set(result.kind === 'refused' && result.body.error === 'invalid-name' ? 'invalidName' : 'failed');
    } finally {
      this.renameBusy.set(false);
    }
  }

  /**
   * `e` on a focused row (the name link or the ⋯ trigger) opens the rename dialog, gated like every single-key
   * shortcut by the setting; a key typed into a field or with a modifier is never one.
   */
  protected onKey(event: KeyboardEvent): void {
    if (event.key !== 'e' || event.defaultPrevented || event.isComposing) return;
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (!this.settings.settings().singleKeyShortcuts) return;
    const target = event.target;
    if (!(target instanceof Element) || target.closest(TYPING) !== null) return;
    const slug = target.closest<HTMLElement>('[data-ws-row]')?.dataset['wsRow'];
    const entry = this.rows().find((row) => row.slug === slug);
    if (entry === undefined) return;
    event.preventDefault();
    this.askRename(entry);
  }

  private rowElement(slug: string): HTMLElement | undefined {
    return [...this.host.nativeElement.querySelectorAll<HTMLElement>('[data-ws-row]')].find((row) => row.dataset['wsRow'] === slug);
  }

  /**
   * Focus back on the row's ⋯ trigger once the native dialog has closed (the element cannot take focus while the
   * modal is open). The opener the dialog itself remembers may be an entry of the row's closed menu sheet.
   */
  private returnFocus(): void {
    const trigger = this.renameTrigger;
    this.renameTrigger = null;
    if (trigger !== null) this.focusOnceClosed('[data-ws-rename-dialog] dialog', () => trigger);
  }

  /** Moves focus to `target()` once the dialog under `selector` has closed; the target is looked up only then. */
  private focusOnceClosed(selector: string, target: () => HTMLElement | null | undefined): void {
    const dialog = this.host.nativeElement.querySelector<HTMLDialogElement>(selector);
    let tries = 0;
    const step = (): void => {
      if (dialog?.open === true && tries++ < FOCUS_TRIES) {
        setTimeout(step, FOCUS_STEP_MS);
        return;
      }
      const element = target();
      if (element?.isConnected === true) element.focus();
    };
    setTimeout(step, 0);
  }

  /**
   * A pick from `ui-sort-menu`: only `?sort=` changes, through the router with `replaceUrl`, so back leaves the page
   * rather than stepping through sort orders; the default drops the param. No request; the current key changes nothing.
   */
  protected setSort(value: string): void {
    const key = workspaceSortKeyOf(value);
    if (key !== value || key === this.sort()) return;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { sort: key === DEFAULT_WORKSPACE_SORT ? null : key },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  /**
   * Opens the remove dialog (T21, ISC-307, ISC-314) for one row: the focus starts on Cancel (`data-autofocus`), and
   * nothing is sent until Confirm. Focus goes back to the row's menu trigger when the dialog closes without removing.
   */
  protected askRemove(entry: WorkspaceListEntry): void {
    this.removing.set(entry);
    this.removeError.set(null);
    this.removeTrigger = this.rowElement(entry.slug)?.querySelector<HTMLElement>('[data-row-menu]') ?? null;
    this.removeOpen.set(true);
  }

  /** The dialog's open state; Esc, Cancel, the close button and a backdrop click land here and send nothing. */
  protected setRemoveOpen(open: boolean): void {
    this.removeOpen.set(open);
    if (open) return;
    this.removeError.set(null);
    const trigger = this.removeTrigger;
    this.removeTrigger = null;
    if (trigger !== null) this.focusOnceClosed('[data-ws-remove-dialog] dialog', () => trigger);
  }

  /**
   * Confirm: `DELETE /api/workspaces/:ws` through `ShellData`, which reloads the list on 204. Then the dialog closes,
   * the one toast names the workspace and focus moves to the next row's menu trigger (the previous one after the last
   * row), or to the add path field when no row is left. A 404 or any other failure stays in the dialog as an error
   * notice; the dialog stays open and the row stays.
   */
  protected async confirmRemove(): Promise<void> {
    const entry = this.removing();
    if (entry === null || this.removeBusy()) return;
    const rows = this.rows();
    const at = rows.findIndex((row) => row.slug === entry.slug);
    const next: string | undefined = rows.at(at + 1)?.slug ?? (at > 0 ? rows.at(at - 1)?.slug : undefined);
    this.removeBusy.set(true);
    this.removeError.set(null);
    try {
      const result = await this.data.removeWorkspace(entry.slug);
      if (result.kind === 'ok') {
        this.removeTrigger = null;
        this.setRemoveOpen(false);
        this.toast.show(this.transloco.translate('settingsWorkspaces.remove.removed', { name: entry.name }));
        this.focusOnceClosed('[data-ws-remove-dialog] dialog', () =>
          next === undefined
            ? this.host.nativeElement.querySelector<HTMLElement>('[data-ws-add-path]')
            : this.rowElement(next)?.querySelector<HTMLElement>('[data-row-menu]'),
        );
      } else if (result.kind === 'refused' && result.status === 404) this.removeError.set({ key: 'notFound', status: 404 });
      else this.removeError.set({ key: result.status === 0 ? 'noAnswer' : 'failed', status: result.status });
    } finally {
      this.removeBusy.set(false);
    }
  }
}

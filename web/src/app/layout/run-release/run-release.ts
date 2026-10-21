import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import type { ItemRun, ItemStateInfo } from '../../../../../core/src/files';
import { ApiClient } from '../../core/api.service';
import { RefreshService } from '../shell/refresh.service';
import { UiIcon } from '../../shared/icons/icon';
import { UiButton } from '../../shared/ui/button/button';
import { UiNotice } from '../../shared/ui/notice/notice';
import { UiDialog } from '../../shared/ui/overlay/dialog';
import { nextId } from '../../shared/ui/overlay/ids';
import { ToastService } from '../../shared/ui/toast/toast';
import { ShellData } from '../shell/shell-data.service';
import { ShellState } from '../shell/shell-state.service';

/** Where the release stands: a refusal or failure stays visible beside the button until the next attempt. */
type ReleaseState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'sending' }
  | { readonly kind: 'changed' }
  | { readonly kind: 'aborted' }
  | { readonly kind: 'no-viewer' }
  | { readonly kind: 'error'; readonly status: number };

/** The run a release may end: a run line's (a claim lock or a task run carries no run id the route knows), still running. */
export function releasableRun(info: ItemStateInfo | null | undefined): ItemRun | null {
  if (info?.state !== 'running' || (info.kind !== 'spec' && info.kind !== 'idea')) return null;
  return info.run?.source === 'run' ? info.run : null;
}

/**
 * Spec 040 (T62, ISC-226): "Release run" for an item whose run is open. Rendered only by the spec's status block and
 * the detail sidebar (a side panel, or the bottom sheet at compact), projected into `ui-item-state`'s
 * `[uiItemStateAction]` slot; never on a board card, which is one tap target. An outline button in the warning tone
 * with `lock-open`, 44 px tall, full width at compact. It opens a confirm dialog ("Release" / "Keep", focus on Keep);
 * the dialog returns focus to the button when it closes.
 *
 * Release posts `POST …/runs/:run/release` with the activity hash the dashboard carried (`ApiClient.activityHash`).
 * 200 closes the dialog, toasts "Run released" (the toast outlives this button, which the refresh removes) and
 * refreshes, so the item reads the state its files give. 409 shows "The run changed · reloaded" and refreshes; nothing
 * was written. 422 `run-aborted` does the same with its own line; 422 `no-viewer` disables the button with the reason
 * as visible text, as the payload names no viewer before the server is asked. The API serves the newest open run of
 * an item only, so with two open runs the button releases that one; the item's "2 runs" chip says more are open.
 */
@Component({
  selector: 'app-run-release',
  imports: [TranslocoPipe, UiButton, UiDialog, UiIcon, UiNotice],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-ui': 'run-release', '[attr.data-run]': 'run()?.run ?? null' },
  styleUrl: './run-release.css',
  templateUrl: './run-release.html',
})
export class RunRelease {
  /** The item as the API serves it; the button shows only while its run line's run is open. */
  readonly info = input.required<ItemStateInfo>();

  private readonly api = inject(ApiClient);
  private readonly data = inject(ShellData);
  private readonly shell = inject(ShellState);
  private readonly refresher = inject(RefreshService);
  private readonly toast = inject(ToastService);
  private readonly transloco = inject(TranslocoService);

  protected readonly run = computed(() => releasableRun(this.info()));
  protected readonly confirming = signal(false);
  protected readonly state = signal<ReleaseState>({ kind: 'idle' });
  protected readonly reasonId = nextId('run-release-reason');
  protected readonly errorStatus = computed(() => {
    const state = this.state();
    return state.kind === 'error' ? state.status : 0;
  });

  /** The activity hash of the dashboard read the page shows; re-read whenever the dashboard answers again. */
  private readonly hash = computed(() => {
    this.data.dashboard.value();
    const ws = this.shell.ws();
    return ws === null ? null : this.api.activityHash(ws);
  });

  protected ask(): void {
    if (this.state().kind === 'no-viewer' || this.state().kind === 'sending') return;
    this.state.set({ kind: 'idle' });
    this.confirming.set(true);
  }

  protected async release(run: ItemRun): Promise<void> {
    const ws = this.shell.ws();
    const hash = this.hash();
    if (ws === null || this.state().kind === 'sending') return;
    if (hash === null) {
      // No hash rendered yet: nothing can be compared, so read again before anyone may release.
      this.settle({ kind: 'changed' });
      return;
    }
    this.state.set({ kind: 'sending' });
    const result = await this.api.releaseRun(ws, run.run, hash);
    if (result.kind !== 'answer') {
      this.settle({ kind: 'error', status: result.status });
      return;
    }
    const { answer } = result;
    switch (answer.status) {
      case 200:
        this.state.set({ kind: 'idle' });
        this.confirming.set(false);
        this.toast.show(this.transloco.translate('itemState.release.released'));
        this.refresher.refresh();
        break;
      case 409:
        this.settle({ kind: 'changed' });
        break;
      case 422:
        if (answer.body.reason === 'no-viewer') this.settle({ kind: 'no-viewer' }, false);
        else this.settle({ kind: 'aborted' });
        break;
      default:
        this.settle({ kind: 'error', status: answer.status });
    }
  }

  /** Close the dialog (focus returns to the button), show why, and read again unless only the viewer is missing. */
  private settle(state: ReleaseState, refresh = true): void {
    this.state.set(state);
    this.confirming.set(false);
    if (refresh && state.kind !== 'error') this.refresher.refresh();
  }
}

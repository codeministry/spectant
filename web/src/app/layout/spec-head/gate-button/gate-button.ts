import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import type { SpecPageModel } from '../../../../../../core/src/files';
import { REVIEWED_HASH_FILES, type ReviewedHashFile } from '../../../../../../server/src/contracts/spec-routes.contract';
import { ApiClient } from '../../../core/api.service';
import { LanguageService } from '../../../core/language.service';
import { UiIcon } from '../../../shared/icons/icon';
import { formatInstant, UiTimeLabel } from '../../../shared/time';
import { UiNotice } from '../../../shared/ui/notice/notice';
import { UiPathBreaks } from '../../../shared/ui/path-breaks/path-breaks';
import { UiChip } from '../../../shared/ui/chip/chip';
import { UiKbd } from '../../../shared/ui/kbd/kbd';
import { UiDialog } from '../../../shared/ui/overlay/dialog';
import { ToastService } from '../../../shared/ui/toast/toast';
import { ShellData } from '../../shell/shell-data.service';
import { ShellState } from '../../shell/shell-state.service';
import { specModel } from '../../shell/spec-model';
import { reviewGate } from '../review-gate';
import { shortHash } from '../spec-head-model';

const HASH_FILES = Object.keys(REVIEWED_HASH_FILES) as ReviewedHashFile[];

let gateCount = 0;
/** The ids one gate's pill names itself by (spec 045, ISC-272). */
function gateIds(): { readonly label: string; readonly hint: string; readonly changed: string } {
  gateCount += 1;
  const id = `gate-${String(gateCount)}`;
  return { label: `${id}-label`, hint: `${id}-hint`, changed: `${id}-changed` };
}

/** Where the gate write stands inside the dialog; a 200 closes the dialog and shows `written` instead. */
type WriteState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'sending' }
  | { readonly kind: 'conflict' }
  | { readonly kind: 'locked'; readonly session: string; readonly claim: string }
  | { readonly kind: 'error'; readonly status: number };

/**
 * T78 · ISC-85 · ISC-86: the reviewed gate's button and its dialog, the one implementation the spec head and the
 * Status tab's Gates card both render. Four states from `gates.reviewed` and the lock source (`gateAction`): ready
 * (primary), stale (warning outline, the changed files listed under it), done (the mark's time) and paused (disabled,
 * the lock's session as visible text). The dialog lists the three hashed files with the hashes `GET …/:id` carried
 * and posts them; 200 closes it, 409 shows an inline alert with Reload (ISC-26), 423 names the lock's session.
 *
 * `size="block"` is the Status tab's full-width 48 px button; `size="inline"` the head's one-line 28 px pill in its
 * cluster (spec 045, ISC-271, ISC-272): round like the Notes pill, "Mark reviewed", "Review stale", "Reviewed <short
 * date and time>" or "Paused · <session>", with the hint, the full time or session and the changed files as its tooltip
 * and in its name (aria-labelledby), visually hidden under it; the dialog still lists the changed files.
 * `size="icon"` (spec 021 T70, ISC-250) is the compact head's 28 px square beside the title: the state icon and tone
 * stay visible, the label stays in the button as its accessible name, and the hint and the changed files stay in the
 * accessibility tree (visually hidden; the dialog lists the changed files again), so the button never wraps under the
 * title. 44 px under coarse pointers.
 */
@Component({
  selector: 'app-gate-button',
  imports: [TranslocoPipe, UiChip, UiIcon, UiKbd, UiNotice, UiDialog, UiPathBreaks, UiTimeLabel],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-size]': 'size()' },
  styleUrl: './gate-button.css',
  templateUrl: './gate-button.html',
})
export class GateButton {
  readonly size = input<'block' | 'inline' | 'icon'>('block');

  private readonly api = inject(ApiClient);
  private readonly data = inject(ShellData);
  private readonly state = inject(ShellState);

  private readonly toast = inject(ToastService);
  private readonly transloco = inject(TranslocoService);
  private readonly lang = inject(LanguageService).current;
  // Recomputes the tooltip once the active language's catalogue has loaded.
  private readonly translation = toSignal(this.transloco.selectTranslation());

  protected readonly specId = this.state.specId;
  protected readonly inline = computed(() => this.size() === 'inline');
  /** Spec 045 (ISC-272): the head's inline size is a one-line pill; `block` and `icon` keep their own forms. */
  protected readonly pill = this.inline;
  /** Per-instance ids: the head and the Status tab render a gate each on one page. */
  protected readonly ids = gateIds();
  protected readonly hashFiles = HASH_FILES;
  protected readonly hashFileNames = REVIEWED_HASH_FILES;

  protected readonly model = specModel(this.data);
  private readonly gate = reviewGate(this.model);
  protected readonly lock = this.gate.lock;
  readonly action = this.gate.action;

  /** The pill's name: its label, then the hint and, when stale, the list of changed files. */
  protected readonly labelledBy = computed(() => {
    const files = this.model()?.gates.reviewed.files ?? [];
    return [this.ids.label, this.ids.hint, ...(this.action() === 'stale' && files.length > 0 ? [this.ids.changed] : [])].join(' ');
  });

  /** The pill's tooltip: what the block shows under its button, with the full time and the full session. */
  protected readonly tooltip = computed(() => {
    this.translation();
    const model = this.model();
    if (!model) return null;
    const lang = this.lang();
    const t = (key: string, params: Record<string, unknown> = {}): string => this.transloco.translate(key, params, lang);
    const time = formatInstant(model.gates.reviewed.at ?? '', lang);
    switch (this.action()) {
      case 'paused':
        return t('status.gate.hint.paused', { session: this.lock()?.session ?? '' });
      case 'done':
        return t('status.gate.done', { time });
      case 'stale': {
        const files = model.gates.reviewed.files ?? [];
        const hint = t('status.gate.hint.stale', { time });
        return files.length > 0 ? `${hint}\n${t('status.gate.changed')}: ${files.join(', ')}` : hint;
      }
      default:
        return t('status.gate.hint.ready');
    }
  });

  /** The session the pill names: the actor without its `a:<kind>:` prefix (`a:claude:sess-2` → `sess-2`). */
  protected shortSession(session: string): string {
    return session.replace(/^[a-z]:[^:]+:/u, '');
  }

  private readonly params = computed(() => {
    const ws = this.state.ws();
    const id = this.state.specId();
    return ws === null || id === null ? undefined : { ws, id };
  });

  /** The hashes `GET …/:id` carried; re-read whenever the spec answers again (a reload after a 409). */
  protected readonly hashes = computed(() => {
    this.data.spec.value();
    const params = this.params();
    return params ? this.api.reviewedHashes(params.ws, params.id) : null;
  });
  protected short(file: ReviewedHashFile): string | null {
    return shortHash(this.hashes()?.[file] ?? null);
  }

  /** The "You confirm" checklist: UI confirmation only; the write path below is unchanged and runs once all three are ticked. */
  /** A hashed file the stale mark names as changed (prototype chip `changed` in the dialog's file rows). */
  protected changedFile(m: SpecPageModel, name: string): boolean {
    return m.gates.reviewed.state === 'stale' && (m.gates.reviewed.files ?? []).some((file) => file === name || file.endsWith(`/${name}`));
  }

  protected readonly checkItems = ['claims', 'approach', 'anchored'] as const;
  protected readonly checks = signal<readonly boolean[]>(this.checkItems.map(() => false));
  protected readonly allChecked = computed(() => this.checks().every(Boolean));
  protected toggleCheck(index: number): void {
    this.checks.update((checks) => checks.map((checked, i) => (i === index ? !checked : checked)));
  }

  protected readonly dialogOpen = signal(false);
  protected readonly write = signal<WriteState>({ kind: 'idle' });
  /** The `at` of the mark the block button wrote, shown as the success line until the page is left; the head toasts. */
  protected readonly written = signal<string | null>(null);

  protected openDialog(): void {
    this.write.set({ kind: 'idle' });
    this.checks.set(this.checkItems.map(() => false));
    this.dialogOpen.set(true);
  }

  protected async confirm(): Promise<void> {
    const params = this.params();
    const hashes = this.hashes();
    if (!params || !hashes || !this.allChecked() || this.write().kind === 'sending') return;
    this.write.set({ kind: 'sending' });
    const result = await this.api.gateReviewed(params.ws, params.id, hashes);
    switch (result.kind) {
      case 'ok':
        // Spec 045 (ISC-273): in the head the toast confirms the write, so no line stands under the pill or icon.
        if (this.size() === 'block') this.written.set(result.body.at);
        else this.toast.show(this.transloco.translate('status.gate.written', { time: formatInstant(result.body.at, this.lang()) }, this.lang()));
        this.write.set({ kind: 'idle' });
        this.dialogOpen.set(false);
        this.data.spec.reload();
        return;
      case 'conflict':
        this.write.set({ kind: 'conflict' });
        return;
      case 'locked':
        this.write.set({ kind: 'locked', session: result.lock.session, claim: result.lock.claim });
        return;
      case 'error':
        this.write.set({ kind: 'error', status: result.status });
    }
  }

  /** The 409's Reload: read the spec again (new hashes, new gate state) and let the reviewer confirm afresh. */
  protected reloadSpec(): void {
    this.write.set({ kind: 'idle' });
    this.data.spec.reload();
  }
}

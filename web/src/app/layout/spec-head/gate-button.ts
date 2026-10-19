import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import type { SpecPageModel } from '../../../../../core/src/files';
import { REVIEWED_HASH_FILES, type ReviewedHashFile } from '../../../../../server/src/spec-routes.contract';
import { ApiClient } from '../../core/api.service';
import { LanguageService } from '../../core/language.service';
import { UiIcon } from '../../shared/icons/icon';
import { formatInstant, UiTimeLabel } from '../../shared/time';
import { UiNotice } from '../../shared/ui/notice/notice';
import { UiChip } from '../../shared/ui/chip/chip';
import { UiKbd } from '../../shared/ui/kbd/kbd';
import { UiDialog } from '../../shared/ui/overlay/dialog';
import { ToastService } from '../../shared/ui/toast/toast';
import { ShellData } from '../shell/shell-data.service';
import { ShellState } from '../shell/shell-state.service';
import { type GateAction, gateAction, pathSegments, shortHash } from './spec-head-model';

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
  imports: [TranslocoPipe, UiChip, UiIcon, UiKbd, UiNotice, UiDialog, UiTimeLabel],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-size]': 'size()' },
  styles: `
    :host { display: grid; gap: 8px; min-inline-size: 0; }
    /* Prototype .gate-btn: the button with its 11 px hint under it, right-aligned in the head, left in a column. */
    .gate-btn { display: inline-flex; flex-direction: column; align-items: flex-end; gap: 2px; min-inline-size: 0; }
    :host([data-size='block']) .gate-btn { align-items: stretch; }
    .gate-button { display: inline-flex; gap: 8px; align-items: center; justify-content: center; min-block-size: 32px; margin: 0; }
    :host([data-size='block']) .gate-button { inline-size: 100%; min-block-size: 48px; }
    /* The primary fill of ui-button (light #007e9a, principal 2026-10-13 "Sichere Werte behalten"), not daisyUI's raw primary. */
    .btn-primary { --btn-color: var(--primary-fill); --btn-fg: var(--primary-fill-ink); }
    /* stale: prototype orange (--orange edge, --orange-t fill, --orange-text ink). */
    .gate-button.stale { --btn-bg: var(--hover-t); --btn-border: var(--hover); --btn-fg: var(--hover-ink); }
    /* done: the prototype's muted "Re-mark". */
    .gate-button.done { --btn-fg: var(--muted-ink); font-weight: 500; }
    .gate-hint { color: var(--muted-ink); font-size: 11px; line-height: 16px; overflow-wrap: anywhere; text-align: end; }
    :host([data-size='block']) .gate-hint { text-align: start; }
    .changed { display: flex; flex-wrap: wrap; gap: 2px 8px; justify-content: flex-end; margin: 0; padding: 0; list-style: none; }
    :host([data-size='block']) .changed { justify-content: flex-start; }
    .changed code { font-size: 11px; line-height: 16px; overflow-wrap: normal; word-break: normal; }
    /* size="icon": a 28 px square; label, hint and changed files visually hidden, still read. */
    :host([data-size='icon']) .gate-button { inline-size: 28px; min-block-size: 28px; block-size: 28px; padding: 0; }
    @media (pointer: coarse) { :host([data-size='icon']) .gate-button { inline-size: 44px; min-block-size: 44px; block-size: 44px; } }
    :host([data-size='icon']) :is(.gate-label, .gate-hint, .changed), :host([data-size='inline']) :is(.gate-hint, .changed) {
      position: absolute; inline-size: 1px; block-size: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap;
    }
    /* size="inline" (spec 045, ISC-271): the head's one-line pill, 28 px and round like the Notes pill beside it. */
    :host([data-size='inline']) .gate-button { --size: 28px; gap: 6px; min-block-size: 28px; block-size: 28px; padding-inline: 10px; border-radius: 999px; font-size: 12px; font-weight: 600; white-space: nowrap; }
    :host([data-size='inline']) .gate-button:is(.done, .stale) { --btn-border: transparent; }
    :host([data-size='inline']) .gate-button.done { --btn-bg: var(--done-t); --btn-fg: var(--done-ink); }
    /* Prototype [data-ui=confirm-dialog]: 520 px, 96 px from the top, card, radius-card, scrim with blur 4. */
    ui-dialog { --ui-dialog-size: 520px; --ui-dialog-top: 96px; --ui-dialog-padding: 24px; }
    .dialog-body { display: grid; gap: 16px; }
    .title { margin: 0; font: 600 17px/26px var(--font-brand); }
    .title code { font-size: 15px; }
    .intro { margin: 0; color: var(--muted-ink); font-size: 13px; line-height: 20px; }
    .files { margin: 0; padding: 0; border: 1px solid var(--line); border-radius: var(--radius-field); list-style: none; }
    .file-row { display: flex; flex-wrap: wrap; gap: 4px 10px; align-items: center; padding: 8px 12px; border-block-end: 1px solid var(--line); }
    .file-row:last-child { border-block-end: 0; }
    .file { flex: 1; min-inline-size: 0; font-size: 13px; }
    .hash-meta { color: var(--muted-ink); font-family: var(--font-mono); font-size: 12px; font-variant-numeric: tabular-nums; }
    .muted { margin: 0; color: var(--muted-ink); }
    .notice-title { display: block; font-weight: 600; }
    /* The prototype's "You confirm" checklist (spec-review-gate.html): three ticks before the mark can be written. */
    .checklist { display: grid; gap: 8px; min-inline-size: 0; margin: 0; padding: 0; border: 0; }
    .checklist legend { margin-block-end: 4px; padding: 0; color: var(--muted-ink); }
    .check-line { display: flex; gap: 8px; align-items: center; font-size: 14px; line-height: 20px; cursor: pointer; }
    .check-line input { flex: none; inline-size: 16px; block-size: 16px; margin: 0; accent-color: var(--color-primary); }
    @media (pointer: coarse) { .check-line { min-block-size: 44px; } }
    .dlg-actions { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; }
    /* Prototype .btn: 1 px --border on the card for the secondary "Not yet". */
    .dlg-actions [data-not-yet] { --btn-bg: var(--color-base-100); --btn-border: var(--line); border-width: 1px; border-style: solid; }
  `,
  template: `
    @if (model(); as m) {
      <span class="gate-btn" data-ui="mark-reviewed" [attr.data-gate-state]="action()">
        <!-- Spec 045 (ISC-272): as the head's pill the button carries the hint, the full time or session and the changed
             files as its tooltip and, through aria-labelledby, in its name; the block button keeps its own label. -->
        @switch (action()) {
          @case ('paused') {
            <button
              type="button"
              class="btn btn-primary btn-sm gate-button"
              data-gate-action
              data-state="paused"
              disabled
              [attr.title]="pill() ? tooltip() : null"
              [attr.aria-labelledby]="pill() ? labelledBy() : null"
            >
              <ui-icon name="lock" [size]="pill() ? 14 : 16" />
              <span class="gate-label" [id]="ids.label">
                @if (pill()) {
                  {{ 'status.gate.pill.paused' | transloco: { session: shortSession(lock()?.session ?? '') } }}
                } @else {
                  {{ 'status.gate.ready' | transloco }}
                }
              </span>
            </button>
            <span class="gate-hint" data-gate-hint [id]="ids.hint">{{ 'status.gate.hint.paused' | transloco: { session: lock()?.session ?? '' } }}</span>
          }
          @case ('done') {
            <button
              type="button"
              class="btn btn-sm gate-button done"
              data-gate-action
              data-state="done"
              [attr.title]="pill() ? tooltip() : null"
              [attr.aria-labelledby]="pill() ? labelledBy() : null"
              (click)="openDialog()"
            >
              <ui-icon name="check" [size]="pill() ? 14 : 16" />
              <span class="gate-label" [id]="ids.label">
                @if (pill()) {
                  <ui-time-label key="status.gate.done" form="instantShort" [value]="m.gates.reviewed.at ?? ''" />
                } @else {
                  {{ 'status.gate.remark' | transloco }}
                }
              </span>
            </button>
            <span class="gate-hint" data-gate-hint [id]="ids.hint"><ui-time-label key="status.gate.done" [value]="m.gates.reviewed.at ?? ''" /></span>
          }
          @case ('stale') {
            <button
              type="button"
              class="btn btn-sm gate-button stale"
              data-gate-action
              data-state="stale"
              [attr.title]="pill() ? tooltip() : null"
              [attr.aria-labelledby]="pill() ? labelledBy() : null"
              (click)="openDialog()"
            >
              <ui-icon name="triangle-alert" [size]="pill() ? 14 : 16" />
              <span class="gate-label" [id]="ids.label">{{ (pill() ? 'status.gate.pill.stale' : 'status.gate.stale') | transloco }}</span>
            </button>
            <span class="gate-hint" data-gate-hint [id]="ids.hint"><ui-time-label key="status.gate.hint.stale" [value]="m.gates.reviewed.at ?? ''" /></span>
            @if (m.gates.reviewed.files?.length) {
              <ul class="changed" data-changed-files [id]="ids.changed" [attr.aria-label]="'status.gate.changed' | transloco">
                @for (file of m.gates.reviewed.files; track file) {
                  <li><code>@for (segment of segments(file); track $index) { <span>{{ segment }}</span><wbr /> }</code></li>
                }
              </ul>
            }
          }
          @default {
            <button
              type="button"
              class="btn btn-primary btn-sm gate-button"
              data-gate-action
              data-state="ready"
              [attr.title]="pill() ? tooltip() : null"
              [attr.aria-labelledby]="pill() ? labelledBy() : null"
              (click)="openDialog()"
            >
              <ui-icon name="flag" [size]="pill() ? 14 : 16" />
              <span class="gate-label" [id]="ids.label">{{ (pill() ? 'status.gate.pill.ready' : 'status.gate.ready') | transloco }}</span>
            </button>
            <span class="gate-hint" data-gate-hint [id]="ids.hint">{{ 'status.gate.hint.ready' | transloco }}</span>
          }
        }
      </span>
      @if (written(); as at) {
        <ui-notice tone="info" icon="circle-check" data-gate-written><ui-time-label key="status.gate.written" [value]="at" /></ui-notice>
      }

      <ui-dialog [(open)]="dialogOpen" [label]="'status.dialog.heading' | transloco">
        <div class="dialog-body" data-gate-dialog>
          <h2 class="title">{{ 'status.dialog.title' | transloco: { id: specId() ?? '' } }} <code>/spec implement</code>?</h2>
          <p class="intro">{{ 'status.dialog.intro' | transloco }}</p>
          @switch (write().kind) {
            @case ('conflict') {
              <ui-notice tone="error" icon="triangle-alert" data-write-conflict>
                <span class="notice-title">{{ 'status.dialog.conflict' | transloco }}</span>
                <button action type="button" class="btn btn-sm" data-reload (click)="reloadSpec()">
                  <ui-icon name="refresh-cw" [size]="16" />
                  {{ 'status.dialog.reload' | transloco }}
                </button>
              </ui-notice>
            }
            @case ('locked') {
              @if (write(); as w) {
                @if (w.kind === 'locked') {
                  <ui-notice tone="warning" icon="lock" data-write-locked>
                    {{ 'status.dialog.locked' | transloco: { session: w.session, claim: w.claim } }}
                  </ui-notice>
                }
              }
            }
            @case ('error') {
              @if (write(); as w) {
                @if (w.kind === 'error') {
                  <ui-notice tone="error" data-write-error>{{ 'status.dialog.error' | transloco: { status: w.status } }}</ui-notice>
                }
              }
            }
          }
          <ul class="files">
            @for (file of hashFiles; track file) {
              <li class="file-row" data-hashed-file [attr.data-file]="file">
                <code class="file">{{ hashFileNames[file] }}</code>
                <span class="hash-meta">@if (short(file)) {sha256 }<code data-hash>{{ short(file) ?? ('status.dialog.absent' | transloco) }}</code></span>
                @if (changedFile(m, hashFileNames[file])) {
                  <ui-chip tone="warning" data-file-changed>{{ 'status.dialog.changed' | transloco }}</ui-chip>
                }
              </li>
            }
          </ul>
          @if (hashes() === null) {
            <p class="muted">{{ 'status.dialog.noHashes' | transloco }}</p>
          }
          @if (m.areas.live.lockSource === 'none') {
            <ui-notice tone="info" icon="activity" data-no-agent-source>{{ 'status.dialog.noAgentSource' | transloco }}</ui-notice>
          }
          <fieldset class="checklist" data-gate-checklist>
            <legend class="type-eyebrow">{{ 'status.dialog.checklist.legend' | transloco }}</legend>
            @for (item of checkItems; track item; let i = $index, first = $first) {
              <label class="check-line">
                <input
                  type="checkbox"
                  data-gate-check
                  [attr.data-autofocus]="first ? '' : null"
                  [checked]="checks()[i]"
                  [disabled]="write().kind === 'conflict'"
                  (change)="toggleCheck(i)"
                />
                <span>{{ 'status.dialog.checklist.' + item | transloco }}</span>
              </label>
            }
          </fieldset>
          <div class="dlg-actions">
            <button type="button" class="btn btn-sm" data-not-yet (click)="dialogOpen.set(false)">
              {{ 'status.dialog.notYet' | transloco }}
              <!-- Only while open: a closed dialog's key hint would be the page's first, hidden kbd. -->
              @if (dialogOpen()) {
                <ui-kbd>Esc</ui-kbd>
              }
            </button>
            <button
              type="button"
              class="btn btn-primary btn-sm"
              data-confirm
              [disabled]="hashes() === null || write().kind === 'sending' || !allChecked()"
              (click)="confirm()"
            >
              {{ (write().kind === 'sending' ? 'status.dialog.sending' : 'status.dialog.confirm') | transloco }}
            </button>
          </div>
        </div>
      </ui-dialog>
    }
  `,
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
  protected readonly segments = pathSegments;

  protected readonly model = computed<SpecPageModel | null>(() => {
    const result = this.data.spec.value();
    return result?.kind === 'ok' ? result.body : null;
  });
  protected readonly lock = computed(() => this.model()?.areas.live.lock ?? null);
  readonly action = computed<GateAction | null>(() => {
    const model = this.model();
    return model ? gateAction(model.gates.reviewed, this.lock()) : null;
  });

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

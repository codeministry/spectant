import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import type { SpecPageModel } from '../../../../../core/src/files';
import { REVIEWED_HASH_FILES, type ReviewedHashFile } from '../../../../../server/src/spec-routes.contract';
import { ApiClient } from '../../core/api.service';
import { UiIcon } from '../../shared/icons/icon';
import { UiTimeLabel } from '../../shared/time';
import { UiNotice } from '../../shared/ui/notice/notice';
import { UiChip } from '../../shared/ui/chip/chip';
import { UiKbd } from '../../shared/ui/kbd/kbd';
import { UiDialog } from '../../shared/ui/overlay/dialog';
import { ShellData } from '../shell/shell-data.service';
import { ShellState } from '../shell/shell-state.service';
import { type GateAction, gateAction, pathSegments, shortHash } from './spec-head-model';

const HASH_FILES = Object.keys(REVIEWED_HASH_FILES) as ReviewedHashFile[];

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
 * `size="block"` is the Status tab's full-width 48 px button; `size="inline"` the head's 32 px one in its cluster.
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
        @switch (action()) {
          @case ('paused') {
            <button type="button" class="btn btn-primary btn-sm gate-button" data-gate-action data-state="paused" disabled>
              <ui-icon name="lock" [size]="16" />
              {{ 'status.gate.ready' | transloco }}
            </button>
            <span class="gate-hint" data-gate-hint>{{ 'status.gate.hint.paused' | transloco: { session: lock()?.session ?? '' } }}</span>
          }
          @case ('done') {
            <button type="button" class="btn btn-sm gate-button done" data-gate-action data-state="done" (click)="openDialog()">
              <ui-icon name="check" [size]="16" />
              {{ 'status.gate.remark' | transloco }}
            </button>
            <span class="gate-hint" data-gate-hint><ui-time-label key="status.gate.done" [value]="m.gates.reviewed.at ?? ''" /></span>
          }
          @case ('stale') {
            <button type="button" class="btn btn-sm gate-button stale" data-gate-action data-state="stale" (click)="openDialog()">
              <ui-icon name="triangle-alert" [size]="16" />
              {{ 'status.gate.stale' | transloco }}
            </button>
            <span class="gate-hint" data-gate-hint><ui-time-label key="status.gate.hint.stale" [value]="m.gates.reviewed.at ?? ''" /></span>
            @if (m.gates.reviewed.files?.length) {
              <ul class="changed" data-changed-files [attr.aria-label]="'status.gate.changed' | transloco">
                @for (file of m.gates.reviewed.files; track file) {
                  <li><code>@for (segment of segments(file); track $index) { <span>{{ segment }}</span><wbr /> }</code></li>
                }
              </ul>
            }
          }
          @default {
            <button type="button" class="btn btn-primary btn-sm gate-button" data-gate-action data-state="ready" (click)="openDialog()">
              <ui-icon name="flag" [size]="16" />
              {{ 'status.gate.ready' | transloco }}
            </button>
            <span class="gate-hint" data-gate-hint>{{ 'status.gate.hint.ready' | transloco }}</span>
          }
        }
      </span>
      @if (written(); as at) {
        <ui-notice tone="info" icon="circle-check" data-gate-written><ui-time-label key="status.gate.written" [value]="at" /></ui-notice>
      }

      <ui-dialog [(open)]="dialogOpen" [label]="'status.dialog.heading' | transloco">
        <div class="dialog-body" data-gate-dialog>
          <h2 class="title">{{ 'status.dialog.title' | transloco: { id: specId() ?? '' } }} <code>/spec-implement</code>?</h2>
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
  readonly size = input<'block' | 'inline'>('block');

  private readonly api = inject(ApiClient);
  private readonly data = inject(ShellData);
  private readonly state = inject(ShellState);

  protected readonly specId = this.state.specId;
  protected readonly inline = computed(() => this.size() === 'inline');
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
  /** The `at` of the mark this button wrote, shown as the success line until the page is left. */
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
        this.written.set(result.body.at);
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

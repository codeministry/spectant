import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import type { SpecPageModel } from '../../../../../core/src/files';
import { REVIEWED_HASH_FILES, type ReviewedHashFile } from '../../../../../server/src/spec-routes.contract';
import { ApiClient } from '../../core/api.service';
import { UiIcon } from '../../shared/icons/icon';
import { UiNotice } from '../../shared/ui/notice/notice';
import { UiSheet } from '../../shared/ui/overlay/sheet';
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
  imports: [TranslocoPipe, UiIcon, UiNotice, UiSheet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-size]': 'size()' },
  styles: `
    :host { display: grid; gap: 8px; min-inline-size: 0; }
    :host([data-size='inline']) { display: inline-flex; flex-wrap: wrap; gap: 4px 8px; align-items: center; }
    .gate-button { display: flex; gap: 8px; align-items: center; justify-content: center; inline-size: 100%; min-block-size: 48px; margin: 0; }
    :host([data-size='inline']) .gate-button { inline-size: auto; min-block-size: 32px; }
    .gate-button.stale { border-color: var(--color-warning); color: var(--hover-ink); }
    .gate-button.done {
      padding: 8px 16px; border: 1px solid var(--color-accent); border-radius: var(--radius-field);
      color: var(--clos-ink); font-weight: 600;
    }
    :host([data-size='inline']) .gate-button.done { padding: 4px 8px; font-size: 13px; line-height: 20px; }
    .gate-button[data-state='paused'] { color: var(--color-base-content); }
    .changed { display: grid; gap: 4px; min-inline-size: 0; }
    :host([data-size='inline']) .changed { display: flex; flex-wrap: wrap; gap: 4px 8px; align-items: baseline; }
    .changed-label { margin: 0; color: var(--hover-ink); font-size: 12px; font-weight: 600; line-height: 16px; }
    .files { display: grid; gap: 4px; margin: 0; padding: 0; list-style: none; }
    :host([data-size='inline']) .files { display: flex; flex-wrap: wrap; gap: 4px 8px; }
    .files code { font-size: 12px; line-height: 16px; overflow-wrap: normal; word-break: normal; }
    .dialog-body { display: grid; gap: 16px; padding: 16px 16px 0; }
    .intro { margin: 0; font-size: 14px; line-height: 20px; }
    .hashed { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
    .hashed li { display: flex; flex-wrap: wrap; gap: 4px 16px; justify-content: space-between; }
    .hash { color: var(--muted-ink); font-variant-numeric: tabular-nums; }
    .muted { margin: 0; color: var(--muted-ink); }
    .confirm-bar { position: sticky; inset-block-end: 0; padding: 16px 0; background: var(--color-base-100); }
  `,
  template: `
    @if (model(); as m) {
      @switch (action()) {
        @case ('paused') {
          <button type="button" class="btn gate-button" [class.btn-sm]="inline()" data-gate-action data-state="paused" disabled>
            <ui-icon name="lock" [size]="16" />
            <span>{{ 'status.gate.paused' | transloco: { session: lock()?.session ?? '' } }}</span>
          </button>
        }
        @case ('done') {
          <p class="gate-button done" data-gate-action data-state="done">
            <ui-icon name="circle-check" [size]="16" />
            <span>{{ 'status.gate.done' | transloco: { time: time(m.gates.reviewed.at) } }}</span>
          </p>
        }
        @case ('stale') {
          <button
            type="button"
            class="btn btn-outline gate-button stale"
            [class.btn-sm]="inline()"
            data-gate-action
            data-state="stale"
            (click)="openDialog()"
          >
            {{ 'status.gate.stale' | transloco }}
          </button>
          @if (m.gates.reviewed.files?.length) {
            <div class="changed">
              <p class="changed-label">{{ 'status.gate.changed' | transloco }}</p>
              <ul class="files" data-changed-files>
                @for (file of m.gates.reviewed.files; track file) {
                  <li><code>@for (segment of segments(file); track $index) { <span>{{ segment }}</span><wbr /> }</code></li>
                }
              </ul>
            </div>
          }
        }
        @default {
          <button type="button" class="btn btn-primary gate-button" [class.btn-sm]="inline()" data-gate-action data-state="ready" (click)="openDialog()">
            {{ 'status.gate.ready' | transloco }}
          </button>
        }
      }
      @if (written(); as at) {
        <ui-notice tone="info" icon="circle-check" data-gate-written>{{ 'status.gate.written' | transloco: { time: time(at) } }}</ui-notice>
      }

      <ui-sheet [(open)]="dialogOpen" [tier]="tier()" [heading]="'status.dialog.heading' | transloco">
        <div class="dialog-body" data-gate-dialog>
          <p class="intro">{{ 'status.dialog.intro' | transloco }}</p>
          <ul class="hashed">
            @for (file of hashFiles; track file) {
              <li data-hashed-file [attr.data-file]="file">
                <code class="file">{{ hashFileNames[file] }}</code>
                <code class="hash" data-hash>{{ short(file) ?? ('status.dialog.absent' | transloco) }}</code>
              </li>
            }
          </ul>
          @if (hashes() === null) {
            <p class="muted">{{ 'status.dialog.noHashes' | transloco }}</p>
          }
          @if (m.areas.live.lockSource === 'none') {
            <ui-notice tone="info" icon="activity" data-no-agent-source>{{ 'status.dialog.noAgentSource' | transloco }}</ui-notice>
          }
          @switch (write().kind) {
            @case ('conflict') {
              <ui-notice tone="error" data-write-conflict>
                {{ 'status.dialog.conflict' | transloco }}
                <button action type="button" class="btn btn-sm" data-reload (click)="reloadSpec()">
                  <ui-icon name="rotate-cw" [size]="16" />
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
          <div class="confirm-bar">
            <button
              type="button"
              class="btn btn-primary btn-block"
              data-confirm
              data-autofocus
              [disabled]="hashes() === null || write().kind === 'sending'"
              (click)="confirm()"
            >
              {{ (write().kind === 'sending' ? 'status.dialog.sending' : 'status.dialog.confirm') | transloco }}
            </button>
          </div>
        </div>
      </ui-sheet>
    }
  `,
})
export class GateButton {
  readonly size = input<'block' | 'inline'>('block');

  private readonly api = inject(ApiClient);
  private readonly data = inject(ShellData);
  private readonly state = inject(ShellState);
  private readonly transloco = inject(TranslocoService);
  private readonly lang = toSignal(this.transloco.langChanges$, { initialValue: this.transloco.getActiveLang() });

  protected readonly tier = this.state.tier;
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

  protected readonly dialogOpen = signal(false);
  protected readonly write = signal<WriteState>({ kind: 'idle' });
  /** The `at` of the mark this button wrote, shown as the success line until the page is left. */
  protected readonly written = signal<string | null>(null);

  private readonly timeFormat = computed(() => new Intl.DateTimeFormat(this.lang(), { dateStyle: 'medium', timeStyle: 'short' }));
  protected time(iso: string | null | undefined): string {
    if (!iso) return '';
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? iso : this.timeFormat().format(date);
  }

  protected openDialog(): void {
    this.write.set({ kind: 'idle' });
    this.dialogOpen.set(true);
  }

  protected async confirm(): Promise<void> {
    const params = this.params();
    const hashes = this.hashes();
    if (!params || !hashes || this.write().kind === 'sending') return;
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

import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  type ElementRef,
  inject,
  input,
  linkedSignal,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import type { ItemRun } from '../../../../../../core/src/files';
import { LanguageService } from '../../../core/language.service';
import { UiIcon } from '../../icons/icon';
import { elapsedText } from '../item-state/duration';
import { UiLiveRegion } from '../live-region/live-region';

/**
 * Copies `text`: the Clipboard API first, then a hidden textarea with the legacy copy command (WKWebView may refuse
 * the API, design.md § WebKit). Returns false when both fail. Focus goes back to where it was.
 */
export async function writeClipboard(text: string, doc: Document): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Refused or absent (insecure context, WebKit web view): fall through to the textarea.
  }
  const previous = doc.activeElement instanceof HTMLElement ? doc.activeElement : null;
  const area = doc.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  doc.body.append(area);
  area.select();
  try {
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- the only synchronous fallback where the Clipboard API is refused
    return doc.execCommand('copy');
  } catch {
    return false;
  } finally {
    area.remove();
    previous?.focus();
  }
}

/** `--motion-duration-highlight` in ms, read from the root so reduced motion (0ms) is honoured. */
function highlightMs(doc: Document): number {
  const raw = getComputedStyle(doc.documentElement).getPropertyValue('--motion-duration-highlight').trim();
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value)) return 0;
  return raw.endsWith('ms') ? value : value * 1000;
}

/**
 * A mono command with a copy button (`/spec implement 012`, `spectant add <path-to-repo>`). On success the icon
 * swaps copy → check for `--motion-duration-highlight` (under reduced motion, where that token is 0ms, the check
 * holds until the button loses focus) and `copied` emits the command. The clipboard gets the command trimmed, never a
 * space before or after it, and the chip's own polite `ui-live-region` announces it ("Copied /spec implement 012",
 * `common.copied`; spec 020, ISC-241), so every surface confirms a copy the same way, without a toast. When every
 * copy path fails the command text is selected and `manualHint` ("Select and press ⌘C") is shown.
 *
 * The button's accessible name names its command (`orientation.copyCommand`: "Copy /spec implement 012"; ISC-142),
 * so no two chips of a view share a name; `copyLabel` stays the tooltip, `copiedLabel` the name while the check shows.
 *
 * `lockedBy` (spec 040, T47, ISC-225.1): while a run on the item is running the chip is locked. `lock` replaces
 * `copy`, the chip goes `--muted-ink` on `--color-base-300`, the button is `aria-disabled` but stays focusable, and its
 * accessible name names the run's command, actor and duration ("Locked · /spec tasks 037 is running · a:claude:sess-7
 * · since 3 min"). Copying is refused; a press (a tap on touch, which has no tooltip) toggles the hint line "Running
 * for 3 min · copyable once it ends", which is also the tooltip. The duration comes from the run's `elapsedMs`.
 *
 * TODO(T23): `copyLabel`, `copiedLabel` and `manualHint` come from Transloco; the defaults are English fallbacks.
 * TODO(T24): swap the plain button to `ui-icon-button`; the focus ring and the coarse-pointer hit area come with it.
 */
@Component({
  selector: 'ui-command-chip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe, UiIcon, UiLiveRegion],
  styles: `
    :host { display: inline-flex; flex-wrap: wrap; gap: 4px 8px; align-items: center; max-inline-size: 100%; }
    /* The prototype's command chip (ISC-148): 28 px, 1 px border, radius 6, --lane, mono 400 12/1. A host may round it
       through --ui-command-chip-radius (the spec head, spec 045), and the copy button follows. */
    .chip { display: inline-flex; gap: 2px; align-items: center; min-inline-size: 0; block-size: 28px; padding-inline: 8px 0; border: 1px solid var(--line); border-radius: var(--ui-command-chip-radius, var(--radius-sm)); background: var(--lane); font-family: var(--font-mono); font-size: 12px; font-weight: 400; line-height: 12px; }
    code { overflow: hidden; color: var(--color-base-content); font: inherit; text-overflow: ellipsis; white-space: nowrap; }
    .copy { inline-size: 26px; block-size: 26px; min-block-size: 26px; padding: 0; border-radius: var(--ui-command-chip-radius, 5px); color: var(--muted-ink); }
    .copy[data-copied] { color: var(--done-ink); }
    .hint { color: var(--muted-ink); font-size: 12px; line-height: 16px; }
    .chip[data-locked] { background: var(--color-base-300); }
    .chip[data-locked] code { color: var(--muted-ink); }
    /* daisyUI drops pointer events on an aria-disabled .btn; the locked button stays pressable for its hint line. */
    .copy[data-locked] { pointer-events: auto; cursor: not-allowed; }
  `,
  template: `
    <span class="chip" [attr.data-locked]="lockedBy() ? '' : null">
      <code #code>{{ command() }}</code>
      @if (lockedBy()) {
        <button
          type="button"
          class="btn btn-ghost btn-xs btn-square copy"
          data-locked
          aria-disabled="true"
          [attr.aria-label]="lockedName()"
          [title]="lockedHint()"
          (click)="hintOpen.set(!hintOpen())"
        >
          <ui-icon name="lock" [size]="14" />
        </button>
      } @else {
        <button
          type="button"
          class="btn btn-ghost btn-xs btn-square copy"
          [attr.data-copied]="state() === 'copied' ? '' : null"
          [attr.aria-label]="state() === 'copied' ? copiedLabel() : ('orientation.copyCommand' | transloco: { command: command() })"
          [title]="copyLabel()"
          (click)="copy()"
          (blur)="onBlur()"
        >
          @if (state() === 'copied') {
            <ui-icon name="check" [size]="14" />
          } @else {
            <ui-icon name="copy" [size]="14" />
          }
        </button>
      }
    </span>
    @if (state() === 'manual') {
      <span class="hint">{{ manualHint() }}</span>
    }
    @if (lockedBy()) {
      @if (hintOpen()) {
        <span class="hint" data-locked-hint>{{ lockedHint() }}</span>
      }
    } @else {
      <!-- A locked chip copies nothing, so it carries no live region (an item-state line has none, spec 040). -->
      <ui-live-region data-copy-announcer />
    }
  `,
})
export class UiCommandChip {
  readonly command = input.required<string>();
  readonly copyLabel = input('Copy command');
  readonly copiedLabel = input('Copied');
  readonly manualHint = input('Select and press ⌘C');
  readonly copied = output<string>();
  /** The run that holds the item (spec 040, ISC-225.1): the chip is locked while it is set. */
  readonly lockedBy = input<ItemRun | null>(null);

  private readonly transloco = inject(TranslocoService);
  private readonly lang = inject(LanguageService).current;
  /** The hint line under a locked chip; closed again whenever the lock changes. */
  protected readonly hintOpen = linkedSignal({ source: this.lockedBy, computation: () => false });
  private readonly duration = computed(() => {
    const run = this.lockedBy();
    if (!run) return '';
    const { key, params } = elapsedText(run.elapsedMs);
    return this.transloco.translate(key, params, this.lang());
  });
  protected readonly lockedName = computed(() => {
    const run = this.lockedBy();
    if (!run) return '';
    const lang = this.lang();
    const locked = this.transloco.translate('itemState.locked.chip', { command: run.command ?? this.command(), actor: run.actor.id }, lang);
    return `${locked} · ${this.transloco.translate('itemState.since', { duration: this.duration() }, lang)}`;
  });
  protected readonly lockedHint = computed(() => this.transloco.translate('itemState.locked.hint', { duration: this.duration() }, this.lang()));

  protected readonly state = signal<'idle' | 'copied' | 'manual'>('idle');
  private readonly code = viewChild.required<ElementRef<HTMLElement>>('code');
  private readonly region = viewChild(UiLiveRegion);
  private readonly doc = inject(DOCUMENT);
  private timer: ReturnType<typeof setTimeout> | undefined;
  private holdUntilBlur = false;

  constructor() {
    inject(DestroyRef).onDestroy(() => clearTimeout(this.timer));
  }

  protected async copy(): Promise<void> {
    const text = this.command().trim();
    clearTimeout(this.timer);
    if (await writeClipboard(text, this.doc)) {
      this.state.set('copied');
      this.region()?.announce(this.transloco.translate('common.copied', { command: text }, this.lang()));
      this.copied.emit(text);
      const ms = highlightMs(this.doc);
      this.holdUntilBlur = ms === 0;
      if (ms > 0) this.timer = setTimeout(() => this.state.set('idle'), ms);
      return;
    }
    const selection = this.doc.getSelection();
    selection?.selectAllChildren(this.code().nativeElement);
    this.state.set('manual');
  }

  protected onBlur(): void {
    if (this.holdUntilBlur && this.state() === 'copied') this.state.set('idle');
  }
}

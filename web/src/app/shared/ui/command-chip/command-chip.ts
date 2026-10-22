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
import { ToastService } from '../toast/toast';

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
 * copy path fails the command text is selected and `manualHint` ("Select and press ⌘C") is shown, under the chip or, with `hint="toast"`, as the app
 * toast (spec 064, T12). Under a coarse pointer the copy button gets the 44 × 44 hit area of `_hit-area.css`.
 *
 * The button's accessible name names its command (`orientation.copyCommand`: "Copy /spec implement 012"; ISC-142),
 * plus, through `context`, what it stands for there (`orientation.copyCommandFor`: "Copy /spec review 006 · next up for
 * 006"; spec 057, ISC-354), so no two chips of a view share a name; `copyLabel` stays the tooltip, `copiedLabel` the name while the check shows.
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
  styleUrl: './command-chip.css',
  templateUrl: './command-chip.html',
})
export class UiCommandChip {
  readonly command = input.required<string>();
  readonly copyLabel = input('Copy command');
  readonly copiedLabel = input('Copied');
  readonly manualHint = input('Select and press ⌘C');
  /**
   * Where the manual hint goes when every copy path fails (spec 064, T12): `inline` (the default) under the chip,
   * `toast` to the app's `ui-toast`, so a chip inside a fixed-height tile never wraps.
   */
  readonly hint = input<'inline' | 'toast'>('inline');
  /**
   * What the command stands for on its surface (spec 057, ISC-354), already translated: "next up for 006", "waits on
   * you: 002 ISC-77", "warning 2 of 2 on 006". It joins the command in the accessible name, so two chips with the same
   * command on one page still differ; null keeps the bare "Copy {command}".
   */
  readonly context = input<string | null>(null);
  readonly copied = output<string>();
  /** The run that holds the item (spec 040, ISC-225.1): the chip is locked while it is set. */
  readonly lockedBy = input<ItemRun | null>(null);

  private readonly transloco = inject(TranslocoService);
  private readonly toasts = inject(ToastService);
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
    if (this.hint() === 'toast') {
      this.state.set('idle');
      this.toasts.show(this.manualHint());
      return;
    }
    this.state.set('manual');
  }

  protected onBlur(): void {
    if (this.holdUntilBlur && this.state() === 'copied') this.state.set('idle');
  }
}

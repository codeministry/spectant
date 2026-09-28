import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  type ElementRef,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { UiIcon } from '../../icons/icon';

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
 * A mono command with a copy button (`/spec-implement 012`, `spectant add <path-to-repo>`). On success the icon
 * swaps copy → check for `--motion-duration-highlight` (under reduced motion, where that token is 0ms, the check
 * holds until the button loses focus) and `copied` emits the command for the page's live region. When every copy
 * path fails the command text is selected and `manualHint` ("Select and press ⌘C") is shown.
 *
 * TODO(T23): `copyLabel`, `copiedLabel` and `manualHint` come from Transloco; the defaults are English fallbacks.
 * TODO(T24): swap the plain button to `ui-icon-button`; the focus ring and the coarse-pointer hit area come with it.
 */
@Component({
  selector: 'ui-command-chip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiIcon],
  styles: `
    :host { display: inline-flex; flex-wrap: wrap; gap: 4px 8px; align-items: center; max-inline-size: 100%; }
    .chip { display: inline-flex; gap: 4px; align-items: center; min-inline-size: 0; padding-inline: 8px 2px; border: 1px solid var(--line); border-radius: var(--radius-field); background: var(--color-base-200); }
    code { overflow: hidden; color: var(--color-base-content); font-family: var(--font-mono); font-size: 13px; line-height: 20px; text-overflow: ellipsis; white-space: nowrap; }
    .copy { color: var(--muted-ink); }
    .copy[data-copied] { color: var(--done-ink); }
    .hint { color: var(--muted-ink); font-size: 12px; line-height: 16px; }
  `,
  template: `
    <span class="chip">
      <code #code>{{ command() }}</code>
      <button
        type="button"
        class="btn btn-ghost btn-xs btn-square copy"
        [attr.data-copied]="state() === 'copied' ? '' : null"
        [attr.aria-label]="state() === 'copied' ? copiedLabel() : copyLabel()"
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
    </span>
    @if (state() === 'manual') {
      <span class="hint">{{ manualHint() }}</span>
    }
  `,
})
export class UiCommandChip {
  readonly command = input.required<string>();
  readonly copyLabel = input('Copy command');
  readonly copiedLabel = input('Copied');
  readonly manualHint = input('Select and press ⌘C');
  readonly copied = output<string>();

  protected readonly state = signal<'idle' | 'copied' | 'manual'>('idle');
  private readonly code = viewChild.required<ElementRef<HTMLElement>>('code');
  private readonly doc = inject(DOCUMENT);
  private timer: ReturnType<typeof setTimeout> | undefined;
  private holdUntilBlur = false;

  constructor() {
    inject(DestroyRef).onDestroy(() => clearTimeout(this.timer));
  }

  protected async copy(): Promise<void> {
    const text = this.command();
    clearTimeout(this.timer);
    if (await writeClipboard(text, this.doc)) {
      this.state.set('copied');
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

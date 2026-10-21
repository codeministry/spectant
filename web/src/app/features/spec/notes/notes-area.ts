import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
  ViewEncapsulation,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { renderMarkdown } from '../../../../../../core/src/markdown';
import { UiIcon } from '../../../shared/icons/icon';
import { UiButton } from '../../../shared/ui/button/button';
import { UiTime, UiTimeLabel } from '../../../shared/time';
import { UiIconButton } from '../../../shared/ui/button/icon-button';
import {
  UiChip,
  UiCommandChip,
  UiDialog,
  UiEmptyState,
  UiFilterChips,
  UiKbd,
  UiNotice,
  UiPopover,
  UiSegmented,
  UiSheet,
} from '../../../shared/ui';
import { NotesStore } from './notes.store';

/**
 * The Notes area (T100, ISC-95): the spec's anchored notes with a Markdown editor and preview, at `…/notes` (the list),
 * `…/notes/new` and `…/notes/:noteId` (the editor). One component serves the three URLs: the note is the child route's
 * `noteId`, the list chip and search are the `filter` and `q` query params, so reload and back land on the same screen.
 * The state, the reads and the autosave live in `NotesStore`, which this page provides; the page keeps the popover,
 * the dialogs and the preview's rendering.
 *
 * - compact and medium stack the list and the editor as two views, the editor with a "← All notes (n)" back link;
 *   wide shows both panes in one card (a 320 px list, the editor filling the rest) and the side-by-side preview.
 * - The preview renders through core's one renderer (`core/src/markdown.ts`), which escapes raw HTML.
 *
 * Not encapsulated: the preview is `[innerHTML]`; every selector in the stylesheets starts with `app-notes-area`.
 */
@Component({
  selector: 'app-notes-area',
  imports: [
    NgTemplateOutlet,
    RouterLink,
    TranslocoPipe,
    UiButton,
    UiChip,
    UiCommandChip,
    UiDialog,
    UiEmptyState,
    UiFilterChips,
    UiIcon,
    UiIconButton,
    UiKbd,
    UiNotice,
    UiPopover,
    UiSegmented,
    UiSheet,
    UiTime,
    UiTimeLabel,
  ],
  providers: [NotesStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  host: { 'data-view': 'notes', '[attr.data-tier]': 'store.tier()', '[attr.data-mode]': 'store.mode()' },
  templateUrl: './notes-area.html',
  styleUrls: ['./notes-area.css', './notes-area-content.css'],
})
export class NotesArea {
  protected readonly store = inject(NotesStore);
  private readonly sanitizer = inject(DomSanitizer);

  protected readonly preview = computed<SafeHtml>(() => {
    // Trusted on purpose: core's renderer escapes every text and every raw HTML node (see the Docs tab).
    const { html } = renderMarkdown(this.store.draft().body, { idPrefix: 'note-preview-' });
    return this.sanitizer.bypassSecurityTrustHtml(html);
  });

  /** The anchor picker: a popover from 640 px, the bottom sheet below (design.md § Across viewports). */
  protected readonly pickerOpen = signal(false);
  protected readonly popOpen = signal(false);
  private readonly anchorPop = viewChild<UiPopover>('anchorPop');
  /** The CLI command the import notice offers (`server/src/cli.ts`). */
  protected readonly importCommand = 'spectant import-notes <file>';

  protected readonly confirmOpen = signal(false);

  constructor() {
    this.store.load();
    // Leaving a note writes what is still pending for it (the job carries its own id).
    effect(() => {
      this.store.noteId();
      untracked(() => void this.store.flush());
    });
    inject(DestroyRef).onDestroy(() => void this.store.flush());
  }

  protected openPicker(trigger: HTMLElement): void {
    if (this.store.tier() === 'compact') this.pickerOpen.set(true);
    else this.anchorPop()?.show(trigger);
  }

  protected pickAnchor(value: string): void {
    this.store.pickAnchor(value);
    this.pickerOpen.set(false);
    this.anchorPop()?.close();
  }

  protected async confirmDelete(): Promise<void> {
    this.confirmOpen.set(false);
    await this.store.deleteCurrent();
  }
}

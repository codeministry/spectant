import { ChangeDetectionStrategy, Component, ElementRef, signal, viewChild } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { UiIconButton } from '../../../shared/ui/button/icon-button';

/**
 * The favourites select (spec 069, ISC-553): a 40 px icon button that shows only the star, named
 * `shell.favorites.trigger`, with `aria-haspopup="dialog"` and an `aria-expanded` that follows `open`. The list it
 * opens (a `ui-popover` from 640 px, a `ui-sheet` below) attaches later to `open` and anchors on `anchor()`, as the
 * shell menus anchor on their trigger.
 */
@Component({
  selector: 'app-favorites-select',
  imports: [TranslocoPipe, UiIconButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './favorites-select.html',
  styleUrl: './favorites-select.css',
})
export class FavoritesSelect {
  /** The list is open; the trigger's `aria-expanded` reads it. */
  readonly open = signal(false);

  private readonly trigger = viewChild.required<string, ElementRef<HTMLButtonElement>>('trigger', { read: ElementRef });

  /** The trigger element: the anchor of the list's popover and where focus returns when the list closes. */
  anchor(): HTMLButtonElement {
    return this.trigger().nativeElement;
  }

  toggle(): void {
    this.open.update((open) => !open);
  }

  close(): void {
    this.open.set(false);
  }
}

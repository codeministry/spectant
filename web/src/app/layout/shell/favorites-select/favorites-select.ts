import { ChangeDetectionStrategy, Component, effect, ElementRef, signal, viewChild } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { UiIconButton } from '../../../shared/ui/button/icon-button';
import { FavoritesList } from './favorites-list';

/**
 * The favourites select (spec 069): a 40 px icon button that shows only the star, named `shell.favorites.trigger`,
 * with `aria-haspopup="dialog"` and an `aria-expanded` that follows `open` (ISC-553). Only the trigger is eager; the
 * list of the favourite specs and ideas of every workspace (`app-favorites-list`, ISC-557) loads in a `@defer` block
 * after first render, as the shell's menus do (`shell-nav.html`), so its overlay primitives stay out of the initial
 * bundle. A click before the list has loaded opens it as soon as it arrives.
 */
@Component({
  selector: 'app-favorites-select',
  imports: [TranslocoPipe, UiIconButton, FavoritesList],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './favorites-select.html',
  styleUrl: './favorites-select.css',
})
export class FavoritesSelect {
  /** The list is open; the trigger's `aria-expanded` reads it, the deferred list writes it through `[(open)]`. */
  readonly open = signal(false);

  private readonly trigger = viewChild.required<string, ElementRef<HTMLButtonElement>>('trigger', { read: ElementRef });
  // A string locator: a value reference to FavoritesList outside the @defer block would pull it into the initial chunk.
  private readonly list = viewChild<FavoritesList>('list');
  private openAtPress: boolean | null = null;
  /** A click that came before the deferred list had loaded; the list opens as soon as it arrives (no lost click). */
  private pending = false;

  constructor() {
    effect(() => {
      const list = this.list();
      if (list === undefined || !this.pending) return;
      this.pending = false;
      // After the list's own first render, so its popover or sheet exists when the queued click opens it.
      setTimeout(() => {
        const trigger = this.anchor();
        if (trigger.isConnected && !this.open()) list.show(trigger);
      });
    });
  }

  /** The trigger element: the anchor of the list's popover and where focus returns when the list closes. */
  anchor(): HTMLButtonElement {
    return this.trigger().nativeElement;
  }

  /** A press while the popover is open light-dismisses it before the click; the state at press time decides. */
  press(): void {
    this.openAtPress = this.open();
  }

  toggle(): void {
    const wasOpen = this.openAtPress ?? this.open();
    this.openAtPress = null;
    if (wasOpen) this.close();
    else this.show();
  }

  close(): void {
    this.pending = false;
    this.open.set(false);
  }

  private show(): void {
    const trigger = this.anchor();
    // WebKit does not focus a clicked button; the popover and the sheet return focus to whatever had it on open.
    trigger.focus();
    const list = this.list();
    if (list === undefined) this.pending = true;
    else list.show(trigger);
  }
}

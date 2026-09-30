import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { KeyboardService } from './core/keyboard.service';
import { ShortcutSheet } from './features/shortcuts/shortcut-sheet';
import { CommandPalette } from './layout/command-palette/command-palette';
import { UiToast } from './shared/ui/toast/toast';

/**
 * The root: the router outlet, plus the app's single toast host, the shortcut sheet (T102) and the command palette
 * (spec 001 T66), mounted once here so they outlive route changes and never render twice. Sheet and palette are
 * deferred until first opened (`?` or the settings help entry; ⌘K / Ctrl+K / `/` or the header trigger), so their
 * overlays stay out of the initial bundle.
 */
@Component({
  selector: 'app-root',
  imports: [RouterOutlet, CommandPalette, ShortcutSheet, UiToast],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <router-outlet />
    @defer (when keyboard.sheetOpen()) {
      <app-shortcut-sheet />
    }
    @defer (when keyboard.paletteOpen()) {
      <app-command-palette />
    }
    <ui-toast />
  `,
})
export class App {
  protected readonly keyboard = inject(KeyboardService);
}

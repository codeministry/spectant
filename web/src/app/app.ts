import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { KeyboardService } from './core/keyboard.service';
import { ShortcutSheet } from './features/shortcuts/shortcut-sheet';
import { UiToast } from './shared/ui/toast/toast';

/**
 * The root: the router outlet, plus the app's single toast host and the shortcut sheet (T102), mounted once here so
 * both outlive route changes and never render twice. The sheet is deferred until it is first opened (`?` or the
 * settings help entry), so its overlay and the binding table stay out of the initial bundle.
 */
@Component({
  selector: 'app-root',
  imports: [RouterOutlet, ShortcutSheet, UiToast],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <router-outlet />
    @defer (when keyboard.sheetOpen()) {
      <app-shortcut-sheet />
    }
    <ui-toast />
  `,
})
export class App {
  protected readonly keyboard = inject(KeyboardService);
}

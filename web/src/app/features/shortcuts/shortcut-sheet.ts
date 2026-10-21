import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { keyLabel } from '../../layout/shell/keyboard-bindings';
import { SHORTCUT_SHEET } from '../../layout/shell/shortcut-sheet-contexts';
import { KeyboardService } from '../../layout/shell/keyboard.service';
import { SettingsService } from '../../core/settings.service';
import { UiKbd } from '../../shared/ui/kbd/kbd';
import { UiIconButton } from '../../shared/ui/button/icon-button';
import { UiIcon } from '../../shared/icons/icon';
import { UiDialog } from '../../shared/ui/overlay/dialog';


/**
 * The shortcut sheet (ISC-97, T102; spec 001 T67; restyled by spec 024): every binding of
 * `SHORTCUTS`, per context (workspace, spec, everywhere) and group, each row the action left and its key caps right,
 * the rows in the `.keys` grid (two columns from 528 px, 32 px apart). Opened by `?` and from the settings
 * help entry through `KeyboardService.sheetOpen`; mounted once by the app root. A centred 640 px dialog 96 px from the
 * top on every tier, listed on every tier even where key hints are hidden.
 */
@Component({
  selector: 'app-shortcut-sheet',
  imports: [RouterLink, TranslocoPipe, UiDialog, UiIcon, UiIconButton, UiKbd],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './shortcut-sheet.css',
  templateUrl: './shortcut-sheet.html',
})
export class ShortcutSheet {
  protected readonly keyboard = inject(KeyboardService);
  private readonly settings = inject(SettingsService);

  protected readonly contexts = SHORTCUT_SHEET;
  protected readonly keyLabel = keyLabel;
  protected readonly singleKeys = computed(() => this.settings.settings().singleKeyShortcuts);
}

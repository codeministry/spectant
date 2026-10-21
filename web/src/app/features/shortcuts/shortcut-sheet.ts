import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import {
  GROUP_CONTEXT,
  keyLabel,
  type Shortcut,
  SHORTCUT_CONTEXTS,
  SHORTCUT_GROUPS,
  type ShortcutContext,
  type ShortcutGroup,
  SHORTCUTS,
} from '../../layout/shell/keyboard-bindings';
import { KeyboardService } from '../../layout/shell/keyboard.service';
import { SettingsService } from '../../core/settings.service';
import { UiKbd } from '../../shared/ui/kbd/kbd';
import { UiIconButton } from '../../shared/ui/button/icon-button';
import { UiIcon } from '../../shared/icons/icon';
import { UiDialog } from '../../shared/ui/overlay/dialog';

interface SheetGroup {
  readonly id: ShortcutGroup;
  readonly bindings: readonly Shortcut[];
}

interface SheetContext {
  readonly id: ShortcutContext;
  readonly groups: readonly SheetGroup[];
  /** A context of one group names it once, in the context heading. */
  readonly titled: boolean;
}

/** `SHORTCUTS` in table order, grouped, and the groups by context; the table order is already context and group order. */
const CONTEXTS: readonly SheetContext[] = SHORTCUT_CONTEXTS.map((context) => {
  const groups = SHORTCUT_GROUPS.filter((group) => GROUP_CONTEXT[group] === context).map((id) => ({
    id,
    bindings: SHORTCUTS.filter((binding) => binding.group === id),
  }));
  return { id: context, groups, titled: groups.length > 1 };
});

/**
 * The shortcut sheet (ISC-97, T102; spec 001 T67; spec 024 aligns it with the prototype `#dlg-keys`): every binding of
 * `SHORTCUTS`, per context (workspace, spec, everywhere) and group, each row the action left and its key caps right,
 * the rows in the prototype `.keys` grid (two columns from 528 px, 32 px apart). Opened by `?` and from the settings
 * help entry through `KeyboardService.sheetOpen`; mounted once by the app root. A centred 640 px dialog 96 px from the
 * top on every tier (prototype `[data-ui="dialog"]`), listed on every tier even where key hints are hidden.
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

  protected readonly contexts = CONTEXTS;
  protected readonly keyLabel = keyLabel;
  protected readonly singleKeys = computed(() => this.settings.settings().singleKeyShortcuts);
}

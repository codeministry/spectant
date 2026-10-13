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
} from '../../core/keyboard-bindings';
import { KeyboardService } from '../../core/keyboard.service';
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
  styles: `
    ui-dialog { --ui-dialog-size: 640px; --ui-dialog-top: 96px; --ui-dialog-padding: 0; }
    .sheet { display: flex; flex-direction: column; max-block-size: calc(100dvh - 130px); min-block-size: 0; }
    .sheet-head { display: flex; gap: 16px; align-items: center; justify-content: space-between; padding: 24px 24px 0; }
    h2 { margin: 0; font-size: 16px; font-weight: 600; line-height: 24px; }
    .sheet-scroll { min-block-size: 0; overflow: auto; padding: 16px 24px 24px; }
    .off { margin: 0 0 16px; color: var(--muted); font-size: 13px; line-height: 20px; }
    .context + .context { margin-block-start: 24px; }
    .group + .group { margin-block-start: 12px; }
    h3, h4 { margin: 0 0 4px; color: var(--muted); font-family: var(--font-mono); font-size: 11px; font-weight: 600; letter-spacing: 0.08em; line-height: 16px; text-transform: uppercase; }
    h4 { font-weight: 500; letter-spacing: 0.04em; }
    .keys { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 0 32px; }
    .row { display: flex; gap: 16px; align-items: center; justify-content: space-between; min-block-size: 37px; padding-block: 8px; border-block-end: 1px solid var(--line); font-size: 13px; line-height: 20px; }
    .action { min-inline-size: 0; }
    .k { display: inline-flex; flex: none; flex-wrap: wrap; gap: 4px; justify-content: flex-end; }
    .footer { margin: 16px 0 0; }
    .footer a { display: inline-flex; gap: 4px; align-items: center; min-block-size: 24px; color: var(--disp-text); font-size: 13px; font-weight: 500; }
    .footer a:hover { text-decoration: underline; }
  `,
  template: `
    <ui-dialog [label]="'shortcuts.title' | transloco" [(open)]="keyboard.sheetOpen">
      <div class="sheet" data-ui="shortcut-sheet">
        <div class="sheet-head">
          <h2>{{ 'shortcuts.title' | transloco }}</h2>
          <button ui-icon-button icon="x" size="sm" [label]="'common.close' | transloco" (click)="keyboard.sheetOpen.set(false)"></button>
        </div>
        <div class="sheet-scroll">
          @if (!singleKeys()) {
            <p class="off" data-shortcuts-off>{{ 'shortcuts.off' | transloco }}</p>
          }
          @for (context of contexts; track context.id) {
            <section class="context" [attr.data-context]="context.id">
              <h3>{{ 'shortcuts.contexts.' + context.id | transloco }}</h3>
              @for (group of context.groups; track group.id) {
                <section class="group" [attr.data-group]="group.id">
                  @if (context.titled) {
                    <h4>{{ 'shortcuts.groups.' + group.id | transloco }}</h4>
                  }
                  <div class="keys">
                    @for (binding of group.bindings; track binding.id) {
                      <div class="row" [attr.data-binding]="binding.id">
                        <span class="action">{{ binding.label | transloco: { target: binding.target ? (binding.target | transloco) : '' } }}</span>
                        <span class="k">
                          @for (key of binding.keys; track $index) {
                            <ui-kbd>{{ keyLabel(key) }}</ui-kbd>
                          }
                        </span>
                      </div>
                    }
                  </div>
                </section>
              }
            </section>
          }
          <p class="footer">
            <a routerLink="/help" data-sheet-help (click)="keyboard.sheetOpen.set(false)"
              >{{ 'settings.keyboard.guide' | transloco }}<ui-icon name="arrow-right" [size]="14"
            /></a>
          </p>
        </div>
      </div>
    </ui-dialog>
  `,
})
export class ShortcutSheet {
  protected readonly keyboard = inject(KeyboardService);
  private readonly settings = inject(SettingsService);

  protected readonly contexts = CONTEXTS;
  protected readonly keyLabel = keyLabel;
  protected readonly singleKeys = computed(() => this.settings.settings().singleKeyShortcuts);
}

import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
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
import { ShellState } from '../../layout/shell/shell-state.service';
import { UiKbd } from '../../shared/ui/kbd/kbd';
import { UiSheet } from '../../shared/ui/overlay/sheet';

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
 * The shortcut sheet (ISC-97, T102; spec 001 T67): every binding of `SHORTCUTS`, per context (workspace, spec,
 * everywhere) and group, each with its key caps. Opened by `?` and from the settings help entry through
 * `KeyboardService.sheetOpen`; mounted once by the app root. A side sheet at medium and wide, a bottom sheet at compact,
 * and listed on every tier even where key hints are hidden (design.md).
 */
@Component({
  selector: 'app-shortcut-sheet',
  imports: [TranslocoPipe, UiKbd, UiSheet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .off { margin: 0 0 16px; color: var(--muted-ink); font-size: 14px; line-height: 20px; }
    .context + .context { margin-block-start: 32px; }
    .group + .group { margin-block-start: 16px; }
    h3 { margin: 0 0 8px; font-size: 14px; font-weight: 600; line-height: 20px; }
    h4 { margin: 0 0 8px; color: var(--muted-ink); font-size: 12px; font-weight: 600; letter-spacing: 0.04em; line-height: 16px; text-transform: uppercase; }
    dl { margin: 0; }
    .row { display: grid; grid-template-columns: 72px 1fr; gap: 12px; align-items: baseline; padding-block: 6px; border-block-end: 1px solid var(--line); }
    .row:last-child { border-block-end: 0; }
    dt { display: flex; gap: 4px; }
    dd { margin: 0; font-size: 14px; line-height: 20px; }
  `,
  template: `
    <ui-sheet [tier]="tier()" [heading]="'shortcuts.title' | transloco" [(open)]="keyboard.sheetOpen">
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
              <dl>
                @for (binding of group.bindings; track binding.id) {
                  <div class="row" [attr.data-binding]="binding.id">
                    <dt>
                      @for (key of binding.keys; track $index) {
                        <ui-kbd>{{ keyLabel(key) }}</ui-kbd>
                      }
                    </dt>
                    <dd>{{ binding.label | transloco: { target: binding.target ? (binding.target | transloco) : '' } }}</dd>
                  </div>
                }
              </dl>
            </section>
          }
        </section>
      }
    </ui-sheet>
  `,
})
export class ShortcutSheet {
  protected readonly keyboard = inject(KeyboardService);
  private readonly shell = inject(ShellState);
  private readonly settings = inject(SettingsService);

  protected readonly contexts = CONTEXTS;
  protected readonly keyLabel = keyLabel;
  protected readonly tier = computed(() => this.shell.tier());
  protected readonly singleKeys = computed(() => this.settings.settings().singleKeyShortcuts);
}

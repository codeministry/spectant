import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, output, signal, viewChild } from '@angular/core';
import { UiIcon } from '../../icons/icon';
import { type PopoverPlacement, UiPopover, UiPopoverTrigger } from '../overlay/popover';
import { type SheetTier, UiSheet } from '../overlay/sheet';

/** One sort key and its translated label, in the order the menu lists them. */
export interface SortOption {
  readonly key: string;
  readonly label: string;
}

/**
 * The sort menu (spec 016, T12; drawn from the spec table's own, spec 021): a ghost trigger with `arrow-up-down` and
 * the current key's label, named "<label>: <current>", that opens one list of the keys — in a `ui-popover` at `medium`
 * / `wide` and in a bottom `ui-sheet` at `compact` (`tier`, fed by the shell as on `ui-sheet`). Each key is a button
 * with `aria-pressed`; the current one carries `data-autofocus`, so focus lands on it when the menu opens, and focus
 * returns to the trigger on close. A pick closes the menu and emits the key through `choose`, the current one too: the
 * consumer turns it into its `?sort=` and skips a pick that changes nothing. No literal text: labels arrive translated.
 */
@Component({
  selector: 'ui-sort-menu',
  imports: [NgTemplateOutlet, UiIcon, UiPopover, UiPopoverTrigger, UiSheet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './sort-menu.css',
  template: `
    <ng-template #menu>
      <div class="sort-menu" role="group" [attr.aria-label]="label()">
        @for (option of options(); track option.key) {
          <button
            type="button"
            class="pop-item"
            [attr.data-sort]="option.key"
            [attr.aria-pressed]="option.key === value()"
            [attr.data-autofocus]="option.key === value() ? '' : null"
            (click)="pick(option.key)"
          >
            {{ option.label }}
          </button>
        }
      </div>
    </ng-template>

    @if (tier() === 'compact') {
      <button
        type="button"
        class="btn btn-sm btn-ghost trigger"
        data-control="sort"
        aria-haspopup="dialog"
        [attr.aria-label]="name()"
        [attr.aria-expanded]="sheetOpen()"
        (click)="sheetOpen.set(true)"
      >
        <ui-icon name="arrow-up-down" [size]="16" />
        <span>{{ current() }}</span>
      </button>
      <ui-sheet tier="compact" [(open)]="sheetOpen" [label]="label()">
        <ng-container [ngTemplateOutlet]="menu" />
      </ui-sheet>
    } @else {
      <button type="button" class="btn btn-sm btn-ghost trigger" data-control="sort" [attr.aria-label]="name()" [uiPopoverTrigger]="pop">
        <ui-icon name="arrow-up-down" [size]="16" />
        <span>{{ current() }}</span>
      </button>
      <ui-popover #pop class="sort-popover" [placement]="placement()" [label]="label()">
        <ng-container [ngTemplateOutlet]="menu" />
      </ui-popover>
    }
  `,
})
export class UiSortMenu {
  /** The keys with their translated labels, in menu order. */
  readonly options = input.required<readonly SortOption[]>();
  /** The current key, the one the list marks pressed and the trigger names. */
  readonly value = input.required<string>();
  /** The menu's translated name ("Sort"): the group's and the overlay's label, and the trigger's prefix. */
  readonly label = input.required<string>();
  /** The shell's tier: `compact` opens the list as a bottom sheet, `medium` / `wide` as a popover. */
  readonly tier = input<SheetTier>('medium');
  /** Where the popover opens; the sort sits at the inline end of a head, so `end`. */
  readonly placement = input<PopoverPlacement>('end');
  /** The key picked, on every pick. */
  readonly choose = output<string>();

  protected readonly sheetOpen = signal(false);
  private readonly popover = viewChild(UiPopover);

  /** The current key's label; the key itself when no option names it. */
  protected readonly current = computed(() => this.options().find((option) => option.key === this.value())?.label ?? this.value());
  protected readonly name = computed(() => `${this.label()}: ${this.current()}`);

  protected pick(key: string): void {
    this.popover()?.close();
    this.sheetOpen.set(false);
    this.choose.emit(key);
  }
}

import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, type ElementRef, inject, input, output, signal, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import type { Priority } from '../../../../../core/src/files';
import { ShellState } from '../../layout/shell/shell-state.service';
import { UiIcon } from '../../shared/icons/icon';
import { UiPopover } from '../../shared/ui/overlay/popover';
import { UiSheet } from '../../shared/ui/overlay/sheet';
import { UiPriority } from '../../shared/ui/priority/priority';
import { UiRovingItem, UiRovingList } from '../../shared/ui/roving-list.directive';

const LEVELS: readonly Priority[] = ['P1', 'P2', 'P3', 'P4'];

/**
 * A feature's priority chip and its menu (spec 037, T29, ISC-196; design 037 § Prioritäts-Chip und Menü): a button
 * around `ui-priority` with a 12 px caret, named "Change priority P3 of F8", `aria-haspopup="dialog"` and
 * `aria-expanded`. It opens four native entries P1…P4, each the level's chip and its short word (`priority.hint.*`);
 * the current one carries a check and `aria-current`, there is no `role="menu"`. ↑ / ↓ move, Enter picks, Esc closes,
 * and focus returns to the chip. Picking another level closes the menu and emits `chosen`; picking the current one
 * only closes. While the host's write runs (`busy`) the chip is `aria-busy` and does not open; the chip shows the new
 * value once the host passes it in after the route's 200.
 *
 * At compact a `ui-sheet` bottom sheet (56 px rows, the feature's title under the heading); at medium and wide a
 * 200 px `ui-popover`, right-aligned under the chip.
 */
@Component({
  selector: 'app-priority-menu',
  imports: [NgTemplateOutlet, TranslocoPipe, UiIcon, UiPopover, UiPriority, UiRovingItem, UiRovingList, UiSheet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './priority-menu.css',
  template: `
    <button
      #chip
      type="button"
      class="chip"
      data-priority-chip
      aria-haspopup="dialog"
      [attr.aria-label]="label()"
      [attr.aria-expanded]="open()"
      [attr.aria-busy]="busy() ? 'true' : null"
      [attr.tabindex]="tabbable() ? null : -1"
      (pointerdown)="openAtPress = open()"
      (click)="toggle()"
    >
      <ui-priority [value]="priority()" />
      <ui-icon class="caret" name="chevron-down" [size]="12" />
    </button>

    @if (tier() === 'compact') {
      <ui-sheet tier="compact" [open]="open()" [heading]="heading()" (openChange)="onOpenChange($event)">
        @if (featureTitle(); as title) {
          <p class="sub" data-feature-title>{{ title }}</p>
        }
        <ng-container [ngTemplateOutlet]="list" [ngTemplateOutletContext]="{ $implicit: 'sheet' }" />
      </ui-sheet>
    } @else {
      <ui-popover class="priority-popover" placement="end" [label]="heading()" (openChange)="onOpenChange($event)">
        <ng-container [ngTemplateOutlet]="list" [ngTemplateOutletContext]="{ $implicit: 'popover' }" />
      </ui-popover>
    }

    <ng-template #list let-surface>
      @if (open()) {
        <ul class="entries" role="list" uiRovingList data-priority-menu [attr.data-surface]="surface" [attr.data-tier]="tier()">
          @for (level of levels; track level) {
            <li>
              <button
                type="button"
                class="entry"
                uiRovingItem
                [attr.data-level-entry]="level"
                [attr.aria-current]="level === priority() ? 'true' : null"
                [attr.data-autofocus]="level === priority() ? '' : null"
                (click)="choose(level)"
              >
                <ui-priority [value]="level" />&ngsp;
                <span class="word">{{ 'priority.hint.' + level | transloco }}</span>
                @if (level === priority()) {
                  <ui-icon class="check" name="check" [size]="16" data-check />
                }
              </button>
            </li>
          }
        </ul>
      }
    </ng-template>
  `,
})
export class PriorityMenu {
  /** The feature's id (`F8`). */
  readonly feature = input.required<string>();
  readonly priority = input.required<Priority>();
  /** The feature's title, shown muted under the sheet's heading at compact. */
  readonly featureTitle = input<string | null>(null);
  /** A priority write is running: the chip is `aria-busy` and the menu stays closed. */
  readonly busy = input(false);
  /** In the tab order; a roving host (the tree lens) keeps only the active row's chip there. */
  readonly tabbable = input(true);
  /** The level picked, when it differs from `priority`. */
  readonly chosen = output<Priority>();

  protected readonly levels = LEVELS;
  protected readonly tier = inject(ShellState).tier;
  private readonly transloco = inject(TranslocoService);
  private readonly lang = toSignal(this.transloco.langChanges$, { initialValue: this.transloco.getActiveLang() });
  private readonly popover = viewChild(UiPopover);
  private readonly chip = viewChild.required<ElementRef<HTMLButtonElement>>('chip');

  protected readonly open = signal(false);
  /** The open state at press time: a press on the chip light-dismisses an open popover before the click arrives. */
  protected openAtPress: boolean | null = null;

  protected readonly label = computed(() =>
    this.transloco.translate('backlog.priority.label', { level: this.priority(), id: this.feature() }, this.lang()),
  );
  protected readonly heading = computed(() => this.transloco.translate('backlog.priority.title', { id: this.feature() }, this.lang()));

  protected toggle(): void {
    const wasOpen = this.openAtPress ?? this.open();
    this.openAtPress = null;
    if (wasOpen) this.close();
    else this.show();
  }

  private show(): void {
    if (this.busy()) return;
    const chip = this.chip().nativeElement;
    chip.focus();
    this.open.set(true);
    if (this.tier() !== 'compact') this.popover()?.show(chip);
  }

  private close(): void {
    const popover = this.popover();
    if (popover) popover.close();
    else this.open.set(false);
  }

  protected onOpenChange(open: boolean): void {
    this.open.set(open);
  }

  protected choose(level: Priority): void {
    this.close();
    if (level !== this.priority()) this.chosen.emit(level);
  }
}

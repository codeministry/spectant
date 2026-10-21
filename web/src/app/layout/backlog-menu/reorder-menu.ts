import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, DOCUMENT, inject, input, output, signal, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslocoService } from '@jsverse/transloco';
import { ShellState } from '../shell/shell-state.service';
import { UiKbd } from '../../shared/ui/kbd/kbd';
import { UiPopover } from '../../shared/ui/overlay/popover';
import { UiSheet } from '../../shared/ui/overlay/sheet';
import { UiRovingItem, UiRovingList } from '../../shared/ui/roving-list.directive';
import { closeMenu } from './close-menu';

/** One move of a feature inside its group: one place up or down, to the top, to the end. */
export type ReorderStep = 'up' | 'down' | 'first' | 'last';

/** macOS, iPadOS and iOS, where the Alt key is the Option key and reads ⌥ (the keyboard service tests the same). */
export function isApplePlatform(userAgent: string): boolean {
  return /Mac|iPhone|iPad/u.test(userAgent);
}

/** The visible key cap of Alt+↑ / Alt+↓: ⌥↑ / ⌥↓ on Apple platforms. */
export function stepCap(apple: boolean, step: 'up' | 'down'): string {
  return `${apple ? '⌥' : 'Alt+'}${step === 'up' ? '↑' : '↓'}`;
}

const SHORTCUT: Readonly<Record<'up' | 'down', string>> = { up: 'Alt+ArrowUp', down: 'Alt+ArrowDown' };

interface ReorderEntry {
  readonly step: ReorderStep;
  readonly enabled: boolean;
  readonly label: string;
  /** Why a disabled entry does nothing ("already first"); null when enabled. */
  readonly reason: string | null;
  /** The key cap of the entry's shortcut, up and down only. */
  readonly cap: string | null;
  readonly shortcut: string | null;
}

/**
 * "Move" for a feature (spec 037, T22, ISC-195; design 037 § Griff, § Viewport-übergreifend): the single-pointer and
 * keyboard path to the move a drag of the feature's grip makes (WCAG 2.5.7), the pattern of the board's "Move to…".
 * Four entries, up, down, to the top and to the end of the group, the first two with their Alt+↑ / Alt+↓ key caps
 * (⌥↑ / ⌥↓ on Apple platforms) and `aria-keyshortcuts`. At the group's edge (`canUp` / `canDown` false) the entries
 * that would do nothing are `aria-disabled`, still focusable, and name their reason. ↑ / ↓ move between the entries.
 *
 * The host owns the trigger, a grip button that is also the drag handle: on a plain click it calls `show(grip)`; the
 * menu owns no drag behaviour. An entry emits `step`, closes the menu and focus returns to the grip; the host runs the
 * backlog write and moves the row on success. `expanded` is the open state for the trigger's `aria-expanded`.
 *
 * At compact a `ui-sheet` bottom sheet (56 px rows, the position line under the title); at medium and wide a
 * `ui-popover` anchored to the grip. Esc closes either one and focus returns to the grip.
 */
@Component({
  selector: 'app-reorder-menu',
  imports: [NgTemplateOutlet, UiKbd, UiPopover, UiRovingItem, UiRovingList, UiSheet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './reorder-menu.css',
  templateUrl: './reorder-menu.html',
})
export class ReorderMenu {
  /** The feature's id (`F8`). */
  readonly feature = input.required<string>();
  /** The milestone's display name; null for the group without a milestone. */
  readonly group = input<string | null>(null);
  readonly canUp = input(false);
  readonly canDown = input(false);
  /** 1-based place in the group and the group's size, for the line under the sheet's title; null shows none. */
  readonly position = input<number | null>(null);
  readonly count = input<number | null>(null);
  /** The chosen move; emitted once per enabled entry, after the menu closed. */
  readonly step = output<ReorderStep>();

  protected readonly tier = inject(ShellState).tier;
  private readonly transloco = inject(TranslocoService);
  private readonly lang = toSignal(this.transloco.langChanges$, { initialValue: this.transloco.getActiveLang() });
  private readonly apple = isApplePlatform(inject(DOCUMENT).defaultView?.navigator.userAgent ?? '');
  private readonly popover = viewChild(UiPopover);

  protected readonly open = signal(false);
  /** Whether the menu is open: the trigger's `aria-expanded`. */
  readonly expanded = this.open.asReadonly();
  /** The grip the popover is anchored to; its `anchor-name` is taken back when another grip opens the menu. */
  private anchor: HTMLElement | null = null;

  private t(key: string, params: Record<string, unknown> = {}): string {
    return this.transloco.translate(`backlog.reorder.${key}`, params, this.lang());
  }

  protected readonly heading = computed(() => {
    const group = this.group();
    return group === null ? this.t('titleNone', { id: this.feature() }) : this.t('title', { id: this.feature(), group });
  });

  protected readonly positionLine = computed(() => {
    const position = this.position();
    const count = this.count();
    return position === null || count === null ? null : this.t('position', { position, count });
  });

  protected readonly entries = computed<readonly ReorderEntry[]>(() => {
    const group = this.group();
    const up = this.canUp();
    const down = this.canDown();
    const atFirst = up ? null : this.t('atFirst');
    const atLast = down ? null : this.t('atLast');
    return [
      { step: 'up', enabled: up, label: this.t('up'), reason: atFirst, cap: stepCap(this.apple, 'up'), shortcut: SHORTCUT.up },
      { step: 'down', enabled: down, label: this.t('down'), reason: atLast, cap: stepCap(this.apple, 'down'), shortcut: SHORTCUT.down },
      { step: 'first', enabled: up, label: this.t('first'), reason: atFirst, cap: null, shortcut: null },
      {
        step: 'last',
        enabled: down,
        label: group === null ? this.t('lastNone') : this.t('last', { group }),
        reason: atLast,
        cap: null,
        shortcut: null,
      },
    ];
  });

  /** The first enabled entry takes focus on open; the first entry when none is. */
  protected readonly focusStep = computed<ReorderStep>(() => this.entries().find((e) => e.enabled)?.step ?? 'up');

  /** Opens the menu for the grip `anchor`: focuses it (focus returns there on close), anchors the popover to it. */
  show(anchor: HTMLElement): void {
    anchor.focus();
    this.open.set(true);
    if (this.tier() === 'compact') return;
    if (this.anchor !== null && this.anchor !== anchor) this.anchor.style.removeProperty('anchor-name');
    this.anchor = anchor;
    this.popover()?.show(anchor);
  }

  close(): void {
    closeMenu(this.popover, this.open);
  }

  protected onOpenChange(open: boolean): void {
    this.open.set(open);
  }

  protected choose(entry: ReorderEntry): void {
    if (!entry.enabled) return;
    this.close();
    this.step.emit(entry.step);
  }
}

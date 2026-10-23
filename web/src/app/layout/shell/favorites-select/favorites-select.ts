import { NgTemplateOutlet } from '@angular/common';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  Injector,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { SettingsService } from '../../../core/settings.service';
import { UiIcon } from '../../../shared/icons/icon';
import { UiIconButton } from '../../../shared/ui/button/icon-button';
import { UiChip } from '../../../shared/ui/chip/chip';
import { chipIcon } from '../../../shared/ui/chip/chip-icons';
import { UiPopover } from '../../../shared/ui/overlay/popover';
import { UiSheet } from '../../../shared/ui/overlay/sheet';
import { UiRovingCompanion, UiRovingItem, UiRovingList } from '../../../shared/ui/roving-list.directive';
import { toneOfStage } from '../../../shared/ui/stage-tone';
import { UiStarToggle } from '../../../shared/ui/star-toggle/star-toggle';
import type { Tone } from '../../../shared/ui/tone';
import { UiWsBadge } from '../../../shared/ui/ws-badge/ws-badge';
import { ShellState } from '../shell-state.service';
import { type FavoriteGroup, favoriteIdeaLink, FavoritesIndex, favoriteSpecLink } from './favorites-index.service';

/**
 * The favourites select (spec 069): a 40 px icon button that shows only the star, named `shell.favorites.trigger`,
 * with `aria-haspopup="dialog"` and an `aria-expanded` that follows `open` (ISC-553). It opens the list of the
 * favourite specs and ideas of every workspace (ISC-557, T10): a `ui-popover` anchored on the trigger from 640 px, a
 * `ui-sheet` at compact whose height stays as it opened. Each workspace with a favourite is a group, its head the
 * badge and name, then its spec rows (ID, title, stage chip, star) and, behind a hairline, its idea rows; without any
 * favourite the empty state `shell.favorites.empty`. There is no "Spec overview" link. Every open reloads the index;
 * a row click, Esc and a light dismiss close the list, and focus returns to the trigger.
 */
@Component({
  selector: 'app-favorites-select',
  imports: [
    NgTemplateOutlet,
    RouterLink,
    TranslocoPipe,
    UiChip,
    UiIcon,
    UiIconButton,
    UiPopover,
    UiRovingCompanion,
    UiRovingItem,
    UiRovingList,
    UiSheet,
    UiStarToggle,
    UiWsBadge,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './favorites-select.html',
  styleUrl: './favorites-select.css',
})
export class FavoritesSelect {
  protected readonly index = inject(FavoritesIndex);
  protected readonly state = inject(ShellState);
  private readonly settings = inject(SettingsService);
  private readonly injector = inject(Injector);

  /** The list is open; the trigger's `aria-expanded` reads it. */
  readonly open = signal(false);

  protected readonly compact = computed(() => this.state.tier() === 'compact');
  protected readonly singleKeys = computed(() => this.settings.settings().singleKeyShortcuts);
  protected readonly specLink = favoriteSpecLink;
  protected readonly ideaLink = favoriteIdeaLink;
  /** The stage chip of a spec row, its tone and icon, as in the spec select (spec 064, ISC-501). */
  protected readonly stageTone = (stage: string): Tone => toneOfStage(stage);
  protected readonly stageIcon = chipIcon;

  /** The row focus lands on: the open spec when it is listed, else the first row (`<ws>/<kind>/<key>`). */
  protected readonly focusKey = computed<string | null>(() => {
    const groups = this.index.groups();
    const ws = this.state.ws();
    const id = this.state.specId();
    if (ws !== null && id !== null && groups.some((group) => group.ws === ws && group.specs.some((spec) => spec.id === id))) {
      return `${ws}/spec/${id}`;
    }
    const first = groups.at(0);
    if (first === undefined) return null;
    const spec = first.specs.at(0);
    if (spec !== undefined) return `${first.ws}/spec/${spec.id}`;
    const idea = first.ideas.at(0);
    return idea === undefined ? null : `${first.ws}/idea/${idea.slug}`;
  });

  /**
   * The sheet's height as it opened, in px, held as its `min-block-size` while it stays open (as the spec select's,
   * spec 052 T21): the bottom-anchored sheet must not shrink under the finger when a row leaves it.
   */
  protected readonly sheetHeight = signal<number | null>(null);

  private readonly trigger = viewChild.required<string, ElementRef<HTMLButtonElement>>('trigger', { read: ElementRef });
  private readonly popover = viewChild(UiPopover);
  private readonly nav = viewChild<ElementRef<HTMLElement>>('favoritesNav');
  private openAtPress: boolean | null = null;

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
    this.open.set(false);
  }

  /** The popover or the sheet closed itself (Esc, light dismiss, backdrop): follow it. */
  protected openChange(open: boolean): void {
    if (!open) this.close();
  }

  /** Spec 069 T14 wires the star; until then a press only stays on the row without following its link. */
  protected unstar(_group: FavoriteGroup, _kind: 'spec' | 'idea', _id: string, event: MouseEvent): void {
    event.stopPropagation();
    event.preventDefault();
  }

  private show(): void {
    const trigger = this.anchor();
    // WebKit does not focus a clicked button; the popover and the sheet return focus to whatever had it on open.
    trigger.focus();
    void this.index.load();
    if (this.compact()) {
      this.open.set(true);
      this.freezeSheet();
      return;
    }
    this.popover()?.show(trigger);
    this.open.set(true);
  }

  /** Measures the sheet once it has opened; each open starts from its own height. */
  private freezeSheet(): void {
    this.sheetHeight.set(null);
    afterNextRender(
      () => {
        const nav = this.nav()?.nativeElement;
        if (nav && this.open() && this.compact()) this.sheetHeight.set(nav.getBoundingClientRect().height || null);
      },
      { injector: this.injector },
    );
  }
}

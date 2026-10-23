import { DOCUMENT, NgTemplateOutlet } from '@angular/common';
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
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { SettingsService } from '../../../core/settings.service';
import { UiIcon } from '../../../shared/icons/icon';
import { UiIconButton } from '../../../shared/ui/button/icon-button';
import { UiChip } from '../../../shared/ui/chip/chip';
import { chipIcon } from '../../../shared/ui/chip/chip-icons';
import { UiLiveRegion } from '../../../shared/ui/live-region/live-region';
import { UiPopover } from '../../../shared/ui/overlay/popover';
import { UiSheet } from '../../../shared/ui/overlay/sheet';
import { UiRovingCompanion, UiRovingItem, UiRovingList } from '../../../shared/ui/roving-list.directive';
import { toneOfStage } from '../../../shared/ui/stage-tone';
import { UiStarToggle } from '../../../shared/ui/star-toggle/star-toggle';
import type { Tone } from '../../../shared/ui/tone';
import { UiWsBadge } from '../../../shared/ui/ws-badge/ws-badge';
import { switchSpecLink } from '../areas';
import type { IdeaFavoriteView, SpecRowView } from '../shell-data.service';
import { ShellState } from '../shell-state.service';
import { type FavoriteGroup, favoriteIdeaLink, FavoritesIndex } from './favorites-index.service';

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
    UiLiveRegion,
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
  private readonly doc = inject(DOCUMENT);
  private readonly transloco = inject(TranslocoService);

  /** The list is open; the trigger's `aria-expanded` reads it. */
  readonly open = signal(false);

  protected readonly compact = computed(() => this.state.tier() === 'compact');
  protected readonly singleKeys = computed(() => this.settings.settings().singleKeyShortcuts);
  protected readonly ideaLink = favoriteIdeaLink;

  /**
   * A spec row's target (ISC-566, as the spec select's entries did, spec 051 ISC-291 to ISC-295): the open tab of the
   * route in the row's own workspace, the note editor's tab being the note list; no query and no fragment go along.
   * Without an open tab (the spec dashboard, a page without a spec, a former Docs or Evidence tab) the chosen spec's
   * dashboard. `href` and click both read it.
   */
  protected specLink(ws: string, id: string): string[] {
    return switchSpecLink(ws, id, this.state.tab());
  }
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
  private readonly announcer = viewChild(UiLiveRegion);
  private openAtPress: boolean | null = null;
  /** The element the popover or the sheet focused on open: focus follows the mark only while it rests there. */
  private placed: Element | null = null;

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

  /** A spec row's star (T14, ISC-559): unsets the favourite in the row's own workspace, by the spec's folder. */
  protected unstarSpec(group: FavoriteGroup, spec: SpecRowView, event: MouseEvent): void {
    this.unstarRow(group.ws, spec.id, spec.id, event, () => this.index.unstar(group.ws, 'specs', spec.slug ?? spec.id));
  }

  /** An idea row's star, as `unstarSpec`; its star's key is `idea:<slug>`, its name the title. */
  protected unstarIdea(group: FavoriteGroup, idea: IdeaFavoriteView, event: MouseEvent): void {
    this.unstarRow(group.ws, `idea:${idea.slug}`, idea.title, event, () => this.index.unstar(group.ws, 'ideas', idea.slug));
  }

  /**
   * Unsets the favourite whose star carries `data-star="<star>"` in the group of `ws`, as the spec select's star does
   * (spec 052 T21, ISC-301): no navigation, the list stays open and the row leaves it, a group without a row drops its
   * head, and the last row overall leaves the empty state. Focus moves to the star of the row that moves up, else the
   * row above, else the empty state; the removal is announced. The second click of a double click is ignored.
   */
  private unstarRow(ws: string, star: string, name: string, event: MouseEvent, write: () => Promise<boolean>): void {
    event.stopPropagation();
    event.preventDefault();
    if (event.detail > 1) return;
    const nav = this.nav()?.nativeElement;
    if (this.compact() && !this.sheetHeight() && nav) this.sheetHeight.set(nav.getBoundingClientRect().height || null);
    const stars = this.index
      .groups()
      .flatMap((group) => [...group.specs.map((spec) => spec.id), ...group.ideas.map((idea) => `idea:${idea.slug}`)].map((key) => ({ ws: group.ws, key })));
    const at = stars.findIndex((entry) => entry.ws === ws && entry.key === star);
    // `at()` because index 0 must not wrap to the last row.
    const next = at < 0 ? undefined : (stars.at(at + 1) ?? (at > 0 ? stars.at(at - 1) : undefined));
    void write();
    this.announcer()?.announce(this.transloco.translate('favorites.removed', { id: name }));
    afterNextRender(
      () => {
        const target = next
          ? nav?.querySelector(`[data-favorites-group="${next.ws}"] [data-star="${next.key}"]`)
          : (nav?.querySelector('.picker-empty') ?? this.anchor());
        if (target instanceof HTMLElement) target.focus();
      },
      { injector: this.injector },
    );
  }

  private show(): void {
    const trigger = this.anchor();
    // WebKit does not focus a clicked button; the popover and the sheet return focus to whatever had it on open.
    trigger.focus();
    const loaded = this.index.load();
    if (this.compact()) {
      this.open.set(true);
      this.freezeSheet();
    } else {
      this.popover()?.show(trigger);
      this.open.set(true);
    }
    // Read after the overlay focused its mark (its own after-render step), then follow once the answers are in.
    this.placed = null;
    afterNextRender({ read: () => (this.placed = this.doc.activeElement) }, { injector: this.injector });
    void loaded.then(() => this.followMark());
  }

  /**
   * The other workspaces answer after the list opened (T12, ISC-562): a group that lands above moves the mark
   * (`data-autofocus`, the open spec or else the first row) to another row; focus follows it while it still rests
   * where the open put it, so a row the viewer moved to keeps the focus.
   */
  private followMark(): void {
    afterNextRender(
      {
        read: () => {
          const mark = this.nav()?.nativeElement.querySelector<HTMLElement>('[data-autofocus]');
          if (this.open() && mark && this.placed !== null && this.placed !== mark && this.doc.activeElement === this.placed) mark.focus();
        },
      },
      { injector: this.injector },
    );
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

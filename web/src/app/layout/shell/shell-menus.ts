import { NgTemplateOutlet } from '@angular/common';
import { afterNextRender, ChangeDetectionStrategy, Component, computed, inject, Injector, input, signal, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { KeyboardService } from '../../core/keyboard.service';
import { LanguageService } from '../../core/language.service';
import { SettingsService } from '../../core/settings.service';
import { ThemeService } from '../../core/theme.service';
import { UiIcon } from '../../shared/icons/icon';
import { UiChip } from '../../shared/ui/chip/chip';
import { chipIcon } from '../../shared/ui/chip/chip-icons';
import { UiKbd } from '../../shared/ui/kbd/kbd';
import { UiWsBadge } from '../../shared/ui/ws-badge/ws-badge';
import type { Tone } from '../../shared/ui/tone';
import { UiPopover } from '../../shared/ui/overlay/popover';
import { UiSheet } from '../../shared/ui/overlay/sheet';
import { UiRovingItem, UiRovingList } from '../../shared/ui/roving-list.directive';
import { type SegmentedOption, UiSegmented } from '../../shared/ui/segmented/segmented';
import { AreaMenu } from '../area-menu/area-menu';
import { AssistantDot } from '../assistant/assistant.service';
import { Mascot } from '../assistant/mascot';
import { specLink } from './areas';
import { ShellData } from './shell-data.service';
import { ShellState } from './shell-state.service';

/**
 * The header's menus: the two pickers, the page menu (spec 024 T80), the area menu, the overflow menu `⋯` (below
 * 1120 px) and the settings panel (spec 024 T76, T40).
 */
export type MenuKind = 'workspace' | 'page' | 'spec' | 'area' | 'more' | 'settings';

/** The menus with their own panel here (the page and area menus are `AreaMenu`'s). */
type PanelKind = Exclude<MenuKind, 'area' | 'page'>;

/** The area entry the overflow menu shows below 1120 px on a spec page, resolved by `ShellNav` as for its wide pill. */
export interface AreaEntry {
  /** The current area, or the disabled entry's label (translation key). */
  readonly valueKey: string;
  /** The accessible name (translation key; `area` takes the translated value), as on the pill. */
  readonly ariaKey: string;
  /** Set when there is nothing to switch: the reason (translation key), shown as text. */
  readonly reasonKey: string | null;
}

/** One row of the workspace picker. */
interface WorkspaceEntry {
  readonly slug: string;
  readonly name: string;
  readonly readable: boolean;
  /** Active specs (`counts.specs`, core's `DashboardKpis`); null when the workspace cannot be read. */
  readonly specs: number | null;
  readonly current: boolean;
}

/** `counts.specs` read narrowly: `WorkspaceListEntry.counts` is untyped in web (api.service.ts). */
const specCountOf = (counts: unknown): number | null => {
  if (typeof counts !== 'object' || counts === null) return null;
  const specs = (counts as Readonly<Record<string, unknown>>)['specs'];
  return typeof specs === 'number' ? specs : null;
};

const THEMES = ['system', 'light', 'dark'] as const;

/** The phase tones of the dashboard's spec table (`PHASE_TONES`), for the spec picker's chip. */
const PHASE_TONE: Readonly<Partial<Record<string, Tone>>> = { scoping: 'secondary', building: 'primary', climbing: 'warning', complete: 'accent' };
const LANGS = ['en', 'de'] as const;

/**
 * The header's menus (ISC-73, ISC-76, ISC-97), loaded after first render (`@defer (on immediate)` in `ShellNav`) so the
 * overlay primitives and the list styles stay out of the initial bundle; until then a picker anchor simply navigates.
 *
 * - **Workspace picker** (prototype `pop-ws`): the head "All workspaces (n)", every workspace from `ShellData.workspaces()`
 *   as a link with its badge and spec count (or "cannot be read"), the current one marked, then "Show all n workspaces"
 *   (`g a`) and "Manage workspaces" → `/settings`.
 * - **Spec picker** (prototype `pop-specs`): the head "Specs · <workspace>", the workspace's specs (muted id, title, phase
 *   chip, else the stage), the open one marked, then "Spec overview" (`g s`) → the dashboard's Specs panel.
 * - **Page menu** (spec 024 T80, ISC-150.2): `app-area-menu scope="page"`, the workspace pages, on every workspace route.
 * - **Area menu**: `app-area-menu` (`layout/area-menu/`, T37), the spec areas, on a spec page.
 * - **Overflow menu** `⋯` (spec 024 T76, below 1120 px): Area, Zen, Assistant, Settings and Help, each item carrying the
 *   `data-control` (or `data-tool`) of the header control it stands for. Area and Settings open their own panel,
 *   anchored to `⋯`.
 * - **Settings panel** (prototype `pop-settings`, T40): theme and language segmented, "Workspaces…" → `/settings`,
 *   "Help & guide" → `/help`, and the single-key switch; every change goes through `/api/settings`.
 * - Each is a `ui-popover` at medium and wide and a bottom `ui-sheet` at compact; focus lands on the current entry.
 *
 * The host is taken out of the header grid (`position: absolute`); the panels live in the top layer.
 */
@Component({
  selector: 'app-shell-menus',
  imports: [
    NgTemplateOutlet,
    RouterLink,
    TranslocoPipe,
    UiIcon,
    UiChip,
    UiKbd,
    UiWsBadge,
    UiPopover,
    UiSheet,
    UiRovingItem,
    UiRovingList,
    UiSegmented,
    AreaMenu,
    Mascot,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './shell-menus.html',
  styleUrl: './shell-menus.css',
})
export class ShellMenus {
  protected readonly state = inject(ShellState);
  protected readonly data = inject(ShellData);
  protected readonly keyboard = inject(KeyboardService);
  /** The assistant dot (T53): its overflow entry opens the panel, focus returns to `⋯`. */
  protected readonly assistant = inject(AssistantDot);
  private readonly settings = inject(SettingsService);
  private readonly theme = inject(ThemeService);
  private readonly language = inject(LanguageService);
  private readonly transloco = inject(TranslocoService);
  private readonly injector = inject(Injector);

  /** The overflow menu's area entry; null off a spec page, where the wide header shows no area select either. */
  readonly area = input<AreaEntry | null>(null);

  protected readonly compact = computed(() => this.state.tier() === 'compact');
  protected readonly singleKeys = computed(() => this.settings.settings().singleKeyShortcuts);
  protected readonly specOpen = computed(() => this.state.specId() !== null && !this.data.specMissing());
  protected readonly workspaceName = computed(() => {
    const ws = this.state.ws();
    return ws === null ? null : this.data.workspaceName(ws);
  });

  protected readonly workspaceEntries = computed<readonly WorkspaceEntry[]>(() => {
    const ws = this.state.ws();
    return this.data.workspaceList().map((entry) => ({
      slug: entry.slug,
      name: entry.name,
      readable: entry.readable,
      specs: entry.readable ? specCountOf(entry.counts) : null,
      current: entry.slug === ws,
    }));
  });

  protected readonly themeMode = this.theme.mode;
  protected readonly lang = this.language.current;
  /** The catalogue as loaded: the labels re-read once it arrives (a translate before that returns the key). */
  private readonly catalogue = toSignal(this.transloco.selectTranslation());
  protected readonly themeOptions = computed<readonly SegmentedOption[]>(() => {
    this.language.current();
    this.catalogue();
    return THEMES.map((key) => ({ key, label: this.transloco.translate(`settings.theme.${key}`) }));
  });
  protected readonly langOptions: readonly SegmentedOption[] = LANGS.map((key) => ({ key, label: key.toUpperCase() }));

  /** The phase chip of a spec row (prototype `pop-specs`: `chip(phaseOf(s))`), its tone and icon. */
  protected readonly phaseTone = (phase: string): Tone => PHASE_TONE[phase] ?? 'neutral';
  protected readonly phaseIcon = chipIcon;

  /** Which menu's bottom sheet is open (compact only; the popovers keep their own state). */
  protected readonly sheet = signal<PanelKind | null>(null);
  private openAtPress: boolean | null = null;
  /** The `⋯` trigger: the anchor of the area menu and the settings panel opened from the overflow menu. */
  private moreTrigger: HTMLElement | null = null;
  private readonly workspacePopover = viewChild<UiPopover>('workspacePopover');
  private readonly specPopover = viewChild<UiPopover>('specPopover');
  private readonly morePopover = viewChild<UiPopover>('morePopover');
  private readonly settingsPopover = viewChild<UiPopover>('settingsPopover');
  private readonly areaMenu = viewChild<AreaMenu>('areaMenu');
  private readonly pageMenu = viewChild<AreaMenu>('pageMenu');

  readonly expanded = computed<Record<MenuKind, boolean>>(() => ({
    workspace: this.sheet() === 'workspace' || (this.workspacePopover()?.open() ?? false),
    page: this.pageMenu()?.expanded() ?? false,
    spec: this.sheet() === 'spec' || (this.specPopover()?.open() ?? false),
    area: this.areaMenu()?.expanded() ?? false,
    more: this.sheet() === 'more' || (this.morePopover()?.open() ?? false),
    settings: this.sheet() === 'settings' || (this.settingsPopover()?.open() ?? false),
  }));

  /**
   * A press on a trigger while its popover is open light-dismisses it before the click arrives; the state at press time
   * decides, so that click closes instead of reopening (as `UiPopoverTrigger` does).
   */
  press(kind: MenuKind): void {
    this.openAtPress = this.expanded()[kind];
  }

  /** Opens `kind`'s menu anchored to `trigger`, or closes it when it was open. */
  toggle(kind: MenuKind, trigger: HTMLElement): void {
    const wasOpen = this.openAtPress ?? this.expanded()[kind];
    this.openAtPress = null;
    if (wasOpen) {
      this.close(kind);
      return;
    }
    if (kind === 'more') this.moreTrigger = trigger;
    this.show(kind, trigger);
  }

  protected close(kind: MenuKind): void {
    if (kind === 'area' || kind === 'page') {
      this.menuOf(kind)?.close();
      return;
    }
    if (this.sheet() === kind) this.sheet.set(null);
    this.popover(kind)?.close();
  }

  protected sheetOpenChange(kind: PanelKind, open: boolean): void {
    if (!open && this.sheet() === kind) this.sheet.set(null);
  }

  /** An overflow entry that opens its own panel (area menu, settings): the overflow menu gives way to it. */
  protected openFromMore(kind: 'area' | 'settings'): void {
    const trigger = this.moreTrigger;
    const fromSheet = this.sheet() === 'more';
    this.close('more');
    if (trigger === null) return;
    if (!fromSheet) {
      this.show(kind, trigger);
      return;
    }
    // A modal sheet keeps focus inside until it has closed; the next panel opens once focus is back on `⋯`, so it
    // returns there when it closes.
    afterNextRender(() => setTimeout(() => this.show(kind, trigger)), { injector: this.injector });
  }

  /** The overflow entry of the assistant dot: the menu gives way, the panel opens once focus is back on `⋯`. */
  protected openAssistant(): void {
    const trigger = this.moreTrigger;
    const fromSheet = this.sheet() === 'more';
    this.close('more');
    if (!fromSheet) {
      this.assistant.show(trigger);
      return;
    }
    afterNextRender(() => setTimeout(() => this.assistant.show(trigger)), { injector: this.injector });
  }

  protected toggleZen(): void {
    this.state.toggleZen();
    this.close('more');
  }

  protected openShortcuts(): void {
    this.close('more');
    this.close('settings');
    this.keyboard.openSheet();
  }

  protected setTheme(mode: string | undefined): void {
    const next = THEMES.find((key) => key === mode);
    if (next !== undefined) void this.theme.setMode(next);
  }

  protected setLanguage(lang: string | undefined): void {
    const next = LANGS.find((key) => key === lang);
    if (next === undefined) return;
    this.language.set(next);
    void this.settings.update({ language: next });
  }

  protected toggleSingleKeys(): void {
    void this.settings.update({ singleKeyShortcuts: !this.singleKeys() });
  }

  protected specEntryLink(id: string): string[] {
    return specLink(this.state.ws() ?? '', id);
  }

  private show(kind: MenuKind, trigger: HTMLElement, retry = true): void {
    // WebKit does not focus a clicked link; the popover and the sheet return focus to whatever had it on open.
    trigger.focus();
    // A click right after this deferred block mounted, before its panels rendered (spec 024): open after that render.
    const later = (): void => {
      if (retry) afterNextRender(() => this.show(kind, trigger, false), { injector: this.injector });
    };
    if (kind === 'area' || kind === 'page') {
      const menu = this.menuOf(kind);
      if (menu) menu.show(trigger);
      else later();
      return;
    }
    if (this.compact()) {
      this.sheet.set(kind);
      return;
    }
    const popover = this.popover(kind);
    if (popover) popover.show(trigger);
    else later();
  }

  private menuOf(kind: 'area' | 'page'): AreaMenu | undefined {
    return kind === 'area' ? this.areaMenu() : this.pageMenu();
  }

  private popover(kind: PanelKind): UiPopover | undefined {
    return {
      workspace: this.workspacePopover,
      spec: this.specPopover,
      more: this.morePopover,
      settings: this.settingsPopover,
    }[kind]();
  }
}

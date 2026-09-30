import { computed, DOCUMENT, inject, Injectable, InjectionToken, signal } from '@angular/core';
import { Router } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
import { areaById, areaPath, specLink } from '../layout/shell/areas';
import { ShellData } from '../layout/shell/shell-data.service';
import { ShellState } from '../layout/shell/shell-state.service';
import { PaletteIndex } from '../layout/command-palette/palette-index';
import { writeClipboard } from '../shared/ui/command-chip/command-chip';
import { ToastService } from '../shared/ui/toast/toast';
import {
  type DashboardSection,
  G_WINDOW_MS,
  GO_PREFIX,
  GROUP_CONTEXT,
  type Shortcut,
  type ShortcutAction,
  type ShortcutContext,
  SHORTCUTS,
} from './keyboard-bindings';
import { RefreshService } from './refresh.service';
import { SettingsService } from './settings.service';

/** Key hints show only where a keyboard is likely (design.md § Interaction and accessibility). */
export const HINT_QUERY = '(any-hover: hover) and (any-pointer: fine)';

/** Milliseconds for the `g` window; a token so the unit tests drive time without fake timers. */
export const KEYBOARD_CLOCK = new InjectionToken<() => number>('KEYBOARD_CLOCK', {
  providedIn: 'root',
  factory: () => () => performance.now(),
});

/** Typing targets: a key pressed here is text, never a shortcut (as `UiRovingList` and `ShellState`). */
const TYPING = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';
/** How many frames a section jump waits for the new view's H2 before it settles for the page's H1. */
const HEADING_FRAMES = 30;

/** The overview's workspace columns and their spec rows (`features/overview`), for `h` / `l`. */
const COLUMN = '[data-ui="workspace-column"]';
const COLUMN_ROW = 'a.d-row';
/** The dashboard's Specs panel and its selected row (`features/dashboard/spec-table`), for `c` and `1`–`3`. */
const SPECS_PANEL = '[data-panel="specs"]';
const SELECTED_ROW = `${SPECS_PANEL} [data-spec-row][data-selected]`;

const MOD = 'Mod+';

/** The bindings of `list` by their `key`; one key holds one binding per context (`GROUP_CONTEXT`). */
function byKey(list: readonly Shortcut[], key: (binding: Shortcut) => string | undefined): ReadonlyMap<string, readonly Shortcut[]> {
  const map = new Map<string, Shortcut[]>();
  for (const binding of list) {
    const k = key(binding);
    if (k !== undefined) map.set(k, [...(map.get(k) ?? []), binding]);
  }
  return map;
}

const chord = byKey(
  SHORTCUTS.filter((b) => b.keys.length === 1 && b.keys[0]?.startsWith(MOD)),
  (b) => b.keys[0],
);
const singleKey = byKey(
  SHORTCUTS.filter((b) => b.keys.length === 1 && !b.keys[0]?.startsWith(MOD)),
  (b) => b.keys[0],
);
const goKey = byKey(
  SHORTCUTS.filter((b) => b.keys.length === 2 && b.keys[0] === GO_PREFIX),
  (b) => b.keys[1],
);

/**
 * The app's keyboard (ISC-97, T102): one document `keydown` handler, called by the shell, dispatching the bindings of
 * `SHORTCUTS`. Keys typed into a field, pressed with Ctrl / ⌘ / Alt, or pressed while a dialog or popover is open are
 * never shortcuts (the overlay primitives own Esc then). With the single-key setting off only Esc stays.
 *
 * `g` opens a `G_WINDOW_MS` window for its second key; a section jump then moves focus to the new view's heading
 * (`tabindex="-1"`, web/CLAUDE.md § Accessibility). `[` `]` keep the tab, `v` and `◂ ▸` write the board's `view` and
 * `frame` query params (the board reads them when it lands). `showHints` is the one signal key hints consume.
 */
@Injectable({ providedIn: 'root' })
export class KeyboardService {
  private readonly router = inject(Router);
  private readonly state = inject(ShellState);
  private readonly data = inject(ShellData);
  /** The palette's view of the open dashboard (next commands) and its Refresh now, shared with `c` and `r`. */
  private readonly index = inject(PaletteIndex);
  private readonly settings = inject(SettingsService);
  /** Injected here, in the root `KeyboardService`, so the live refresh's timer runs from app start (T68). */
  private readonly refresher = inject(RefreshService);
  private readonly toast = inject(ToastService);
  private readonly transloco = inject(TranslocoService);
  private readonly clock = inject(KEYBOARD_CLOCK);
  private readonly document = inject(DOCUMENT);
  /** macOS, where Ctrl is an editing modifier in text fields and ⌘ is the command key. */
  private readonly mac = /Mac|iPhone|iPad/u.test(this.document.defaultView?.navigator.userAgent ?? '');

  /** The shortcut sheet's `open` model (`app-shortcut-sheet`). */
  readonly sheetOpen = signal(false);
  /** The command palette's `open` model (`app-command-palette`, T66): ⌘K / Ctrl+K, `/` and the header trigger. */
  readonly paletteOpen = signal(false);

  private readonly pointerFine = signal(true);
  /** Whether key hints render: a hovering fine pointer and single-key shortcuts on. */
  readonly showHints = computed(() => this.pointerFine() && this.settings.settings().singleKeyShortcuts);

  private goAt: number | null = null;

  constructor() {
    const view = this.document.defaultView;
    if (typeof view?.matchMedia !== 'function') return;
    const query = view.matchMedia(HINT_QUERY);
    this.pointerFine.set(query.matches);
    query.addEventListener('change', (event) => {
      this.pointerFine.set(event.matches);
    });
  }

  openSheet(): void {
    this.sheetOpen.set(true);
  }

  openPalette(): void {
    this.paletteOpen.set(true);
  }

  /** Handles one document `keydown`; returns whether a binding took it (and then prevents its default). */
  handle(event: KeyboardEvent): boolean {
    if (event.defaultPrevented || event.isComposing) return false;
    if (event.ctrlKey || event.metaKey) return event.altKey || event.shiftKey ? false : this.onChord(event);
    if (event.altKey) return false;
    if (event.target instanceof Element && event.target.closest(TYPING)) {
      this.goAt = null;
      return false;
    }
    if (this.overlayOpen()) return false;
    if (event.key === 'Escape') return this.fire(this.pick(singleKey, 'Escape'), event);
    if (!this.settings.settings().singleKeyShortcuts) return false;

    const now = this.clock();
    const pending = this.goAt;
    this.goAt = null;
    if (pending !== null && now - pending <= G_WINDOW_MS && goKey.has(event.key)) return this.fire(this.pick(goKey, event.key), event);
    if (event.key === GO_PREFIX && this.goContext()) {
      this.goAt = now;
      event.preventDefault();
      return true;
    }
    return this.fire(this.pick(singleKey, event.key), event);
  }

  /**
   * The page's context (spec 001 T67): a spec open, a workspace dashboard or the all-workspaces page, or neither
   * (settings, not found), where only the `any` bindings fire.
   */
  private context(): ShortcutContext | null {
    if (this.spec() !== null) return 'spec';
    if (this.state.ws() !== null || this.router.url.split(/[?#]/u)[0] === '/') return 'workspace';
    return null;
  }

  /** The binding `key` has in the current context, else its `any` one. */
  private pick(map: ReadonlyMap<string, readonly Shortcut[]>, key: string): Shortcut | undefined {
    const here = this.context();
    return map.get(key)?.find((binding) => {
      const context = GROUP_CONTEXT[binding.group];
      return context === 'any' || context === here;
    });
  }

  /** `g` is a prefix wherever a `g` sequence is bound: inside a spec and on a workspace dashboard. */
  private goContext(): boolean {
    return this.spec() !== null || this.state.ws() !== null;
  }

  /**
   * ⌘ / Ctrl + key: only the `Mod+` bindings, also from a field (the palette input included, where the chord closes the
   * palette again). Another open dialog or popover still owns the keyboard.
   */
  private onChord(event: KeyboardEvent): boolean {
    const binding = this.pick(chord, `${MOD}${chordKey(event)}`);
    if (binding === undefined) return false;
    // In a text field on macOS Ctrl+K is the editing chord "kill to end of line"; there only ⌘K opens the palette.
    if (event.ctrlKey && !event.metaKey && this.mac && event.target instanceof Element && event.target.closest(TYPING)) {
      return false;
    }
    if (binding.action.kind === 'open-palette' && this.paletteOpen()) {
      this.paletteOpen.set(false);
      event.preventDefault();
      return true;
    }
    if (this.overlayOpen()) return false;
    return this.fire(binding, event);
  }

  private fire(binding: Shortcut | undefined, event: KeyboardEvent): boolean {
    if (binding === undefined || !this.run(binding.action)) return false;
    event.preventDefault();
    return true;
  }

  private run(action: ShortcutAction): boolean {
    switch (action.kind) {
      case 'toggle-zen':
        this.state.toggleZen();
        return true;
      case 'refresh':
        this.refresher.refresh();
        return true;
      case 'open-sheet':
        this.openSheet();
        return true;
      case 'open-palette':
        this.openPalette();
        return true;
      case 'focus-search':
        return this.focusSearch();
      case 'go-all':
        if (this.workspace() === null) return false;
        void this.router.navigate(['/']);
        return true;
      case 'go-section':
        return this.focusSection(action.section);
      case 'copy-next':
        return this.copyNext();
      case 'move-selection':
        return false;
      case 'step-column':
        return this.stepColumn(action.delta);
      case 'phase-filter':
        return this.phaseFilter(action.phase);
      default:
        return this.runInSpec(action);
    }
  }

  /** The open workspace while no spec is open (the dashboard `/w/:ws`), else null. */
  private workspace(): string | null {
    return this.spec() === null ? this.state.ws() : null;
  }

  /** `g s` `g n` `g w` on a dashboard: focus the section's heading (its id), wherever the tier put it. */
  private focusSection(section: DashboardSection): boolean {
    if (this.workspace() === null) return false;
    const heading = this.document.getElementById(section);
    if (heading === null) return false;
    if (!heading.hasAttribute('tabindex') && heading.tagName !== 'SUMMARY') heading.setAttribute('tabindex', '-1');
    heading.focus();
    return this.document.activeElement === heading;
  }

  /** `c`: copy the selected spec's next command — the previewed one (`?spec=`), else the Specs panel's selection. */
  private copyNext(): boolean {
    if (this.workspace() === null) return false;
    const preview: unknown = this.router.parseUrl(this.router.url).queryParams['spec'];
    const id =
      typeof preview === 'string' && preview !== ''
        ? preview
        : (this.document.querySelector(SELECTED_ROW)?.getAttribute('data-spec-row') ?? null);
    const command = id === null ? null : (this.index.current()?.specs.find((row) => row.id === id)?.nextCommand ?? null);
    if (command === null) return false;
    void writeClipboard(command, this.document).then((done) => {
      this.toast.show(this.transloco.translate(done ? 'common.copied' : 'common.copyFallback', { command }));
    });
    return true;
  }

  /** `h` `l` on `/`: the same row index in the previous / next workspace column (the first column from nowhere). */
  private stepColumn(delta: -1 | 1): boolean {
    if (this.state.ws() !== null) return false;
    const columns = [...this.document.querySelectorAll<HTMLElement>(COLUMN)];
    const active = this.document.activeElement;
    const current = active?.closest<HTMLElement>(COLUMN) ?? null;
    const from = current === null ? -1 : columns.indexOf(current);
    const to = from < 0 ? 0 : from + delta;
    // `at` reads a negative index from the end; `h` in the first column must stop, not wrap.
    const target = to < 0 ? undefined : columns.at(to);
    if (target === undefined) return false;
    const row = current === null ? 0 : Math.max(0, [...current.querySelectorAll(COLUMN_ROW)].indexOf(active as Element));
    const rows = [...target.querySelectorAll<HTMLElement>(COLUMN_ROW)];
    const next = (rows.length > 0 ? rows.at(Math.min(row, rows.length - 1)) : undefined) ?? target.querySelector<HTMLElement>('a[href]');
    if (next === null) return false;
    next.focus();
    return true;
  }

  /** `1`–`3` while the Specs panel has focus: its `phase` query param (All removes it). */
  private phaseFilter(phase: string | null): boolean {
    const ws = this.workspace();
    if (ws === null || this.document.querySelector(SPECS_PANEL)?.contains(this.document.activeElement) !== true) return false;
    void this.router.navigate(['/w', ws], { queryParams: { phase }, queryParamsHandling: 'merge' });
    return true;
  }

  /** The bindings that need an open spec. */
  private runInSpec(action: ShortcutAction): boolean {
    const spec = this.spec();
    if (spec === null) return false;
    const { ws, id } = spec;
    switch (action.kind) {
      case 'go-area':
        return this.jump(specLink(ws, id, areaPath(areaById(action.area))));
      case 'go-tab':
        return this.jump(specLink(ws, id, action.tab));
      case 'open-notes':
        return this.jump(specLink(ws, id, 'notes'));
      case 'leave-spec':
        void this.router.navigate(['/w', ws]);
        return true;
      case 'step-spec': {
        const order = this.data.specOrder();
        const index = order.indexOf(id);
        const next = index < 0 ? undefined : order[index + action.delta];
        if (next === undefined) return false;
        void this.router.navigate(specLink(ws, next, this.state.tab() ?? ''));
        return true;
      }
      case 'mark-reviewed':
        this.toast.show(this.transloco.translate('shortcuts.later'));
        return true;
      case 'toggle-view':
      case 'step-frame':
        return this.onBoard(ws, id, action);
      default:
        return false;
    }
  }

  /** `v` and `◂ ▸`: only on the board tab; they rewrite its query params and keep the others. */
  private onBoard(ws: string, id: string, action: Extract<ShortcutAction, { kind: 'toggle-view' | 'step-frame' }>): boolean {
    if (this.state.tab() !== 'board') return false;
    const params = this.router.parseUrl(this.router.url).queryParams;
    let queryParams: Record<string, string>;
    if (action.kind === 'toggle-view') {
      queryParams = { view: params['view'] === 'flow' ? 'lanes' : 'flow' };
    } else {
      const frame = Number.parseInt(String(params['frame'] ?? '0'), 10);
      const next = (Number.isFinite(frame) && frame > 0 ? frame : 0) + action.delta;
      if (next < 0) return false;
      queryParams = { frame: String(next) };
    }
    void this.router.navigate(specLink(ws, id, 'board'), { queryParamsHandling: 'merge', queryParams });
    return true;
  }

  /** A section jump: navigate, then move focus to the new view's heading. */
  private jump(link: string[]): boolean {
    void this.router.navigate(link).then((done) => {
      if (done) this.focusHeading();
    });
    return true;
  }

  private focusHeading(frames = 0): void {
    const view = this.document.defaultView;
    if (!view) return;
    view.requestAnimationFrame(() => {
      // A dialog's heading (the gate sheet in the spec head) is never a section heading.
      const section = this.document.querySelector<HTMLElement>('main h2:not(dialog h2)');
      if (section === null && frames < HEADING_FRAMES) {
        this.focusHeading(frames + 1);
        return;
      }
      const heading = section ?? this.document.querySelector<HTMLElement>('main h1');
      if (heading === null) return;
      if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
      heading.focus();
    });
  }

  /** `f`: the page's search field, else the palette trigger once it can take focus. */
  private focusSearch(): boolean {
    const target =
      this.document.querySelector<HTMLElement>('main input[type="search"]') ??
      this.document.querySelector<HTMLElement>('[data-control="palette"]');
    if (target === null) return false;
    target.focus();
    return this.document.activeElement === target;
  }

  private spec(): { ws: string; id: string } | null {
    const ws = this.state.ws();
    const id = this.state.specId();
    return ws === null || id === null ? null : { ws, id };
  }

  /** An open `<dialog>` or popover owns the keyboard; `:popover-open` throws where it is unknown. */
  private overlayOpen(): boolean {
    try {
      return this.document.querySelector('dialog[open], [popover]:popover-open') !== null;
    } catch {
      return this.document.querySelector('dialog[open]') !== null;
    }
  }
}

/**
 * The letter of a chord from the physical key (`KeyK` → `k`), so a non-Latin layout (`л`, `κ`) still reaches the
 * binding its `aria-keyshortcuts` announces; any other key falls back to its produced value.
 */
function chordKey(event: KeyboardEvent): string {
  return /^Key[A-Z]$/u.test(event.code) ? event.code.slice(3).toLowerCase() : event.key.toLowerCase();
}

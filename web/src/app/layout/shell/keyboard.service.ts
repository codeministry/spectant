import { computed, DOCUMENT, inject, Injectable, InjectionToken, signal } from '@angular/core';
import { NavigationCancel, NavigationEnd, NavigationError, NavigationSkipped, Router } from '@angular/router';
import { first } from 'rxjs';
import { TranslocoService } from '@jsverse/transloco';
import { areaById, areaPath, specLink, workspaceLink } from './areas';
import { ShellData } from './shell-data.service';
import { ShellState, stepSpec } from './shell-state.service';
import { PaletteIndex } from '../command-palette/palette-index';
import { writeClipboard } from '../../shared/ui/command-chip/command-chip';
import { ToastService } from '../../shared/ui/toast/toast';
import { altTyped, type DashboardSection, G_WINDOW_MS, GO_PREFIX, type Shortcut, type ShortcutAction, type ShortcutContext } from './keyboard-bindings';
import { type BindingMap, chord, chordKey, goKey, inTypingTarget, MOD, overlayOpen, pickBinding, singleKey } from './keyboard-keys';
import {
  awaitSectionHeading,
  focusHeading,
  focusSearch,
  focusSectionHeading,
  sectionLink,
  selectedSpecRow,
  specsPanelHasFocus,
  stepColumn,
} from './keyboard-focus';
import { RefreshService } from './refresh.service';
import { SettingsService } from '../../core/settings.service';

/** Key hints show only where a keyboard is likely (design.md § Interaction and accessibility). */
export const HINT_QUERY = '(any-hover: hover) and (any-pointer: fine)';

/** Milliseconds for the `g` window; a token so the unit tests drive time without fake timers. */
export const KEYBOARD_CLOCK = new InjectionToken<() => number>('KEYBOARD_CLOCK', {
  providedIn: 'root',
  factory: () => () => performance.now(),
});

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
    if (!altTyped(event)) {
      if (event.ctrlKey || event.metaKey) return event.altKey || event.shiftKey ? false : this.onChord(event);
      if (event.altKey) return false;
    }
    if (inTypingTarget(event)) {
      this.goAt = null;
      return false;
    }
    if (overlayOpen(this.document)) return false;
    if (event.key === 'Escape') return this.fire(this.pick(singleKey, 'Escape'), event);
    if (!this.settings.settings().singleKeyShortcuts) return false;

    const now = this.clock();
    const pending = this.goAt;
    this.goAt = null;
    if (pending !== null && now - pending <= G_WINDOW_MS && goKey.has(event.key)) return this.fire(this.pick(goKey, event.key), event);
    if (event.key === GO_PREFIX) {
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
  private pick(map: BindingMap, key: string): Shortcut | undefined {
    return pickBinding(map, key, this.context());
  }

  /**
   * ⌘ / Ctrl + key: only the `Mod+` bindings, also from a field (the palette input included, where the chord closes the
   * palette again). Another open dialog or popover still owns the keyboard.
   */
  private onChord(event: KeyboardEvent): boolean {
    const binding = this.pick(chord, `${MOD}${chordKey(event)}`);
    if (binding === undefined) return false;
    // In a text field on macOS Ctrl+K is the editing chord "kill to end of line"; there only ⌘K opens the palette.
    if (event.ctrlKey && !event.metaKey && this.mac && inTypingTarget(event)) {
      return false;
    }
    if (binding.action.kind === 'open-palette' && this.paletteOpen()) {
      this.paletteOpen.set(false);
      event.preventDefault();
      return true;
    }
    if (overlayOpen(this.document)) return false;
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
        return focusSearch(this.document);
      case 'go-all':
        // Everywhere but on the all-workspaces page itself.
        if (this.router.url.split(/[?#]/u)[0] === '/') return false;
        void this.router.navigate(['/']);
        return true;
      case 'go-section':
        return this.focusSection(action.section);
      case 'go-page': {
        const ws = this.workspace();
        return ws === null ? false : this.jump(workspaceLink(ws, action.page));
      }
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

  /**
   * `g s` `g n` `g w` in a workspace: focus the section's heading (its id), wherever the tier put it. Spec 058
   * (ISC-395): the spec list lives on the Specs page `/w/:ws/specs`, Next up and the warnings on the dashboard `/w/:ws`;
   * from any other page the jump opens the section's page first and focuses the heading once it has rendered.
   */
  private focusSection(section: DashboardSection): boolean {
    const ws = this.workspace();
    if (ws === null) return false;
    const { link, path } = sectionLink(ws, section);
    if (this.router.url.split(/[?#]/u)[0] === path) return focusSectionHeading(this.document, section);
    void this.router.navigate(link).then((done) => {
      if (done) awaitSectionHeading(this.document, section);
    });
    return true;
  }

  /**
   * Spec 058 (ISC-395, T45): a click on a link to a section's page (the spec select's "show all") that its
   * `routerLink` navigates is a section jump like `g s`: when that navigation has ended, focus moves to the section
   * heading. A click `routerLink` leaves to the browser (a modifier or another button than the primary) is none.
   */
  followSectionLink(event: MouseEvent, ws: string, section: DashboardSection): void {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    if (this.router.url.split(/[?#]/u)[0] === sectionLink(ws, section).path) {
      awaitSectionHeading(this.document, section);
      return;
    }
    this.router.events
      .pipe(
        first(
          (e) => e instanceof NavigationEnd || e instanceof NavigationCancel || e instanceof NavigationError || e instanceof NavigationSkipped,
        ),
      )
      .subscribe((e) => {
        if (e instanceof NavigationEnd) awaitSectionHeading(this.document, section);
      });
  }

  /** `c`: copy the selected spec's next command — the one in the detail sidebar (`?sel=spec:`), else the Specs panel's selection. */
  private copyNext(): boolean {
    if (this.workspace() === null) return false;
    const sel: unknown = this.router.parseUrl(this.router.url).queryParams['sel'];
    const preview: unknown = typeof sel === 'string' && sel.startsWith('spec:') ? sel.slice('spec:'.length) : undefined;
    const id = typeof preview === 'string' && preview !== '' ? preview : selectedSpecRow(this.document);
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
    return stepColumn(this.document, delta);
  }

  /** `1`–`3` while the Specs panel has focus: its `phase` query param (All removes it). */
  private phaseFilter(phase: string | null): boolean {
    const ws = this.workspace();
    if (ws === null || !specsPanelHasFocus(this.document)) return false;
    // Spec 058 (ISC-395): the phase filter belongs to the spec list, on the Specs page.
    void this.router.navigate(workspaceLink(ws, 'specs'), { queryParams: { phase }, queryParamsHandling: 'merge' });
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
        // Spec 052 (ISC-331): with favourites the step walks them only, from a starred spec or not.
        const favorites = this.data.favoriteRows().map((row) => row.id);
        const next = stepSpec(this.data.specOrder(), favorites, id, action.delta);
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
      if (done) focusHeading(this.document);
    });
    return true;
  }

  private spec(): { ws: string; id: string } | null {
    const ws = this.state.ws();
    const id = this.state.specId();
    return ws === null || id === null ? null : { ws, id };
  }
}

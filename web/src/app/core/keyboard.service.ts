import { computed, DOCUMENT, inject, Injectable, InjectionToken, signal } from '@angular/core';
import { Router } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
import { areaById, areaPath, specLink } from '../layout/shell/areas';
import { ShellData } from '../layout/shell/shell-data.service';
import { ShellState } from '../layout/shell/shell-state.service';
import { ToastService } from '../shared/ui/toast/toast';
import { G_WINDOW_MS, GO_PREFIX, type Shortcut, type ShortcutAction, SHORTCUTS } from './keyboard-bindings';
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

const singleKey = new Map(SHORTCUTS.filter((b) => b.keys.length === 1).map((b) => [b.keys[0], b]));
const goKey = new Map(SHORTCUTS.filter((b) => b.keys.length === 2 && b.keys[0] === GO_PREFIX).map((b) => [b.keys[1], b]));

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
  private readonly settings = inject(SettingsService);
  private readonly toast = inject(ToastService);
  private readonly transloco = inject(TranslocoService);
  private readonly clock = inject(KEYBOARD_CLOCK);
  private readonly document = inject(DOCUMENT);

  /** The shortcut sheet's `open` model (`app-shortcut-sheet`). */
  readonly sheetOpen = signal(false);

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

  /** Handles one document `keydown`; returns whether a binding took it (and then prevents its default). */
  handle(event: KeyboardEvent): boolean {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return false;
    if (event.target instanceof Element && event.target.closest(TYPING)) {
      this.goAt = null;
      return false;
    }
    if (this.overlayOpen()) return false;
    if (event.key === 'Escape') return this.fire(singleKey.get('Escape'), event);
    if (!this.settings.settings().singleKeyShortcuts) return false;

    const now = this.clock();
    const pending = this.goAt;
    this.goAt = null;
    if (pending !== null && now - pending <= G_WINDOW_MS && goKey.has(event.key)) return this.fire(goKey.get(event.key), event);
    if (event.key === GO_PREFIX && this.spec() !== null) {
      this.goAt = now;
      event.preventDefault();
      return true;
    }
    return this.fire(singleKey.get(event.key), event);
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
      case 'open-sheet':
        this.openSheet();
        return true;
      case 'focus-search':
        return this.focusSearch();
      default:
        return this.runInSpec(action);
    }
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
      const section = this.document.querySelector<HTMLElement>('main h2');
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

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DefaultUrlSerializer, Router } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
import { areaById, areaPath, SPEC_AREAS, specLink, TAB_IDS, type TabId } from '../layout/shell/areas';
import { PaletteIndex } from '../layout/command-palette/palette-index';
import { RefreshService } from './refresh.service';
import { ShellData } from '../layout/shell/shell-data.service';
import { ShellState } from '../layout/shell/shell-state.service';
import { ToastService } from '../shared/ui/toast/toast';
import { G_WINDOW_MS, GO_PREFIX, GROUP_CONTEXT, SHORTCUTS, TAB_GO_KEYS } from './keyboard-bindings';
import { HINT_QUERY, KEYBOARD_CLOCK, KeyboardService } from './keyboard.service';
import { DEFAULT_SETTINGS, SettingsService } from './settings.service';

interface Setup {
  readonly url?: string;
  readonly ws?: string | null;
  readonly specId?: string | null;
  readonly tab?: TabId | null;
  readonly singleKeys?: boolean;
  readonly fine?: boolean;
}

/** A `MediaQueryList` the test drives, as in theme.service.spec.ts. */
class FakeMediaQueryList extends EventTarget {
  constructor(
    readonly media: string,
    public matches: boolean,
  ) {
    super();
  }

  set(matches: boolean): void {
    this.matches = matches;
    this.dispatchEvent(Object.assign(new Event('change'), { matches, media: this.media }));
  }
}

function setup(options: Setup = {}) {
  let now = 1000;
  const media = new FakeMediaQueryList(HINT_QUERY, options.fine ?? true);
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => media),
  );
  const navigate = vi.fn<(...args: unknown[]) => Promise<boolean>>(() => Promise.resolve(true));
  const serializer = new DefaultUrlSerializer();
  const router = { url: options.url ?? '/w/harbor/s/002', navigate, parseUrl: (url: string) => serializer.parse(url) };
  const state = {
    ws: signal<string | null>(options.ws === undefined ? 'harbor' : options.ws),
    specId: signal(options.specId === undefined ? '002' : options.specId),
    tab: signal<TabId | null>(options.tab ?? null),
    toggleZen: vi.fn(),
  };
  const settings = { settings: signal({ ...DEFAULT_SETTINGS, singleKeyShortcuts: options.singleKeys ?? true }) };
  const toast = { show: vi.fn() };
  const refresher = { refresh: vi.fn() };
  const index = { refresh: vi.fn(), current: signal({ specs: [{ id: '002', nextCommand: '/spec-implement 002' }] }) };
  TestBed.configureTestingModule({
    providers: [
      { provide: Router, useValue: router },
      { provide: ShellState, useValue: state },
      { provide: ShellData, useValue: { specOrder: signal(['001', '002', '003']) } },
      { provide: PaletteIndex, useValue: index },
      { provide: RefreshService, useValue: refresher },
      { provide: SettingsService, useValue: settings },
      { provide: ToastService, useValue: toast },
      { provide: TranslocoService, useValue: { translate: (key: string) => `t:${key}` } },
      { provide: KEYBOARD_CLOCK, useValue: () => now },
    ],
  });
  const service = TestBed.inject(KeyboardService);
  const press = (key: string, init: KeyboardEventInit = {}, target?: Element): KeyboardEvent => {
    const event = new KeyboardEvent('keydown', { key, cancelable: true, bubbles: true, ...init });
    if (target) {
      target.addEventListener('keydown', (e) => service.handle(e as KeyboardEvent), { once: true });
      target.dispatchEvent(event);
    } else {
      service.handle(event);
    }
    return event;
  };
  const advance = (ms: number): void => {
    now += ms;
  };
  return { service, refresher, navigate, state, settings, toast, index, media, press, advance };
}

describe('KeyboardService', () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.unstubAllGlobals();
  });

  describe('binding table', () => {
    it('has no two bindings on the same key sequence in one context, and none beside an any binding', () => {
      for (const [i, a] of SHORTCUTS.entries()) {
        for (const b of SHORTCUTS.slice(i + 1)) {
          if (a.keys.join(' ') !== b.keys.join(' ')) continue;
          const [ca, cb] = [GROUP_CONTEXT[a.group], GROUP_CONTEXT[b.group]];
          expect(ca !== cb && ca !== 'any' && cb !== 'any', `${a.id} ${b.id}`).toBe(true);
        }
      }
    });

    it('reaches every area and every tab through a g sequence', () => {
      const go = SHORTCUTS.filter((binding) => binding.keys[0] === GO_PREFIX && binding.keys.length === 2);
      for (const area of SPEC_AREAS) {
        expect(
          go.some((binding) => binding.action.kind === 'go-area' && binding.action.area === area.id),
          area.id,
        ).toBe(true);
      }
      for (const tab of TAB_IDS) {
        const reached = go.some(
          (binding) =>
            (binding.action.kind === 'go-tab' && binding.action.tab === tab) ||
            (binding.action.kind === 'go-area' && areaPath(areaById(binding.action.area)) === tab),
        );
        expect(reached, tab).toBe(true);
      }
    });

    it('lists [ ], v, z, the arrows, m, n, f, ? and Esc', () => {
      const singles = SHORTCUTS.filter((binding) => binding.keys.length === 1).map((binding) => binding.keys[0]);
      expect(singles).toEqual(
        expect.arrayContaining(['[', ']', 'v', 'z', 'ArrowLeft', 'ArrowRight', 'm', 'n', 'f', '?', 'Escape']),
      );
    });
  });

  describe('g sequences', () => {
    it('g then an area key opens that area on its first tab and prevents the default', () => {
      for (const area of SPEC_AREAS) {
        const { press, navigate } = setup();
        const binding = SHORTCUTS.find((b) => b.action.kind === 'go-area' && b.action.area === area.id);
        expect(press('g').defaultPrevented).toBe(true);
        expect(press(binding?.keys[1] ?? '').defaultPrevented).toBe(true);
        expect(navigate).toHaveBeenCalledWith(specLink('harbor', '002', areaPath(area)));
        TestBed.resetTestingModule();
      }
    });

    it('g then a tab key opens that tab', () => {
      for (const [tab, key] of Object.entries(TAB_GO_KEYS)) {
        const { press, navigate } = setup();
        press('g');
        press(key);
        expect(navigate).toHaveBeenCalledWith(specLink('harbor', '002', tab));
        TestBed.resetTestingModule();
      }
    });

    it('holds the prefix for exactly the window', () => {
      const { press, navigate, advance } = setup();
      press('g');
      advance(G_WINDOW_MS);
      press('d');
      expect(navigate).toHaveBeenCalledTimes(1);

      press('g');
      advance(G_WINDOW_MS + 1);
      expect(press('d').defaultPrevented).toBe(false);
      expect(navigate).toHaveBeenCalledTimes(1);
    });

    it('does nothing outside a spec and a workspace', () => {
      const { press, navigate } = setup({ url: '/settings', ws: null, specId: null });
      expect(press('g').defaultPrevented).toBe(false);
      press('d');
      expect(navigate).not.toHaveBeenCalled();
    });
  });

  describe('ignored contexts', () => {
    it('ignores keys typed into an input, a textarea or a contenteditable', () => {
      const { press, navigate, service } = setup();
      const input = document.body.appendChild(document.createElement('input'));
      const text = document.body.appendChild(document.createElement('textarea'));
      const editable = document.body.appendChild(document.createElement('div'));
      editable.setAttribute('contenteditable', '');
      for (const target of [input, text, editable]) {
        press('g', {}, target);
        press('d', {}, target);
        press('?', {}, target);
      }
      expect(navigate).not.toHaveBeenCalled();
      expect(service.sheetOpen()).toBe(false);
    });

    it('ignores every key while a dialog is open (the overlay owns Esc)', () => {
      const { press, navigate, state } = setup();
      document.body.appendChild(document.createElement('dialog')).setAttribute('open', '');
      press('z');
      press('Escape');
      expect(state.toggleZen).not.toHaveBeenCalled();
      expect(navigate).not.toHaveBeenCalled();
    });

    it('ignores modified keys', () => {
      const { press, state } = setup();
      press('z', { ctrlKey: true });
      press('z', { metaKey: true });
      press('z', { altKey: true });
      expect(state.toggleZen).not.toHaveBeenCalled();
    });

    it('keeps only Esc when single-key shortcuts are off', () => {
      const { press, navigate, state } = setup({ singleKeys: false });
      press('g');
      press('d');
      press('z');
      expect(navigate).not.toHaveBeenCalled();
      expect(state.toggleZen).not.toHaveBeenCalled();
      press('Escape');
      expect(navigate).toHaveBeenCalledWith(['/w', 'harbor']);
    });
  });

  describe('single keys', () => {
    it('] and [ step through the dashboard order on the same tab', () => {
      const { press, navigate } = setup({ tab: 'claims' });
      press(']');
      expect(navigate).toHaveBeenLastCalledWith(specLink('harbor', '003', 'claims'));
      press('[');
      expect(navigate).toHaveBeenLastCalledWith(specLink('harbor', '001', 'claims'));
    });

    it('[ at the first spec is not handled', () => {
      const { press, navigate } = setup({ specId: '001' });
      expect(press('[').defaultPrevented).toBe(false);
      expect(navigate).not.toHaveBeenCalled();
    });

    it('v toggles the view query param on the board only', () => {
      const board = specLink('harbor', '002', 'board');
      let s = setup({ tab: 'board', url: '/w/harbor/s/002/board' });
      s.press('v');
      expect(s.navigate).toHaveBeenCalledWith(board, { queryParamsHandling: 'merge', queryParams: { view: 'flow' } });
      TestBed.resetTestingModule();
      s = setup({ tab: 'board', url: '/w/harbor/s/002/board?view=flow' });
      s.press('v');
      expect(s.navigate).toHaveBeenCalledWith(board, { queryParamsHandling: 'merge', queryParams: { view: 'lanes' } });
      TestBed.resetTestingModule();
      s = setup({ tab: 'claims' });
      expect(s.press('v').defaultPrevented).toBe(false);
    });

    it('the arrows step the frame query param on the board, never below 0', () => {
      const board = specLink('harbor', '002', 'board');
      const s = setup({ tab: 'board', url: '/w/harbor/s/002/board?frame=2' });
      s.press('ArrowRight');
      expect(s.navigate).toHaveBeenLastCalledWith(board, { queryParamsHandling: 'merge', queryParams: { frame: '3' } });
      s.press('ArrowLeft');
      expect(s.navigate).toHaveBeenLastCalledWith(board, { queryParamsHandling: 'merge', queryParams: { frame: '1' } });
      TestBed.resetTestingModule();
      const start = setup({ tab: 'board', url: '/w/harbor/s/002/board' });
      expect(start.press('ArrowLeft').defaultPrevented).toBe(false);
    });

    it('z toggles zen, m shows the later toast, n opens notes, ? opens the sheet, Esc leaves the spec', () => {
      const { press, navigate, state, toast, service } = setup();
      press('z');
      expect(state.toggleZen).toHaveBeenCalledTimes(1);
      press('m');
      expect(toast.show).toHaveBeenCalledWith('t:shortcuts.later');
      press('n');
      expect(navigate).toHaveBeenLastCalledWith(specLink('harbor', '002', 'notes'));
      press('?', { shiftKey: true });
      expect(service.sheetOpen()).toBe(true);
      press('Escape');
      expect(navigate).toHaveBeenLastCalledWith(['/w', 'harbor']);
    });

    it('f focuses the search field in main', () => {
      const { press } = setup();
      const main = document.body.appendChild(document.createElement('main'));
      const search = main.appendChild(document.createElement('input'));
      search.type = 'search';
      expect(press('f').defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(search);
    });
  });

  describe('showHints', () => {
    it('follows the pointer query and the single-key setting', () => {
      const { service, media, settings } = setup({ fine: true });
      expect(service.showHints()).toBe(true);
      media.set(false);
      expect(service.showHints()).toBe(false);
      media.set(true);
      settings.settings.set({ ...DEFAULT_SETTINGS, singleKeyShortcuts: false });
      expect(service.showHints()).toBe(false);
    });
  });

  describe('the workspace context (spec 001 T67)', () => {
    const onDashboard = () => setup({ url: '/w/harbor', specId: null });

    it('g s, g n and g w focus the section headings; g a goes to all workspaces', () => {
      const { press, navigate } = onDashboard();
      document.body.innerHTML = '<h2 id="specs">S</h2><h2 id="next-up">N</h2><details><summary id="warnings">W</summary></details>';
      for (const [key, id] of [['s', 'specs'], ['n', 'next-up'], ['w', 'warnings']] as const) {
        press('g');
        expect(press(key).defaultPrevented, id).toBe(true);
        expect(document.activeElement?.id).toBe(id);
      }
      expect(document.getElementById('specs')?.getAttribute('tabindex')).toBe('-1');
      press('g');
      press('a');
      expect(navigate).toHaveBeenCalledWith(['/']);
    });

    it('keeps g s and g n on the spec areas inside a spec', () => {
      const { press, navigate } = setup();
      document.body.innerHTML = '<h2 id="specs">S</h2>';
      press('g');
      press('s');
      expect(navigate).toHaveBeenCalledWith(specLink('harbor', '002', areaPath(areaById('status'))));
      expect(document.activeElement?.id).not.toBe('specs');
    });

    it('c copies the selected row next command, r refreshes, j k stay with the roving list', async () => {
      const writeText = vi.fn(() => Promise.resolve());
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
      const { press, toast, refresher } = onDashboard();
      document.body.innerHTML = '<div data-panel="specs"><div data-spec-row="001"></div><div data-spec-row="002" data-selected></div></div>';
      expect(press('c').defaultPrevented).toBe(true);
      await Promise.resolve();
      await Promise.resolve();
      expect(writeText).toHaveBeenCalledWith('/spec-implement 002');
      expect(toast.show).toHaveBeenCalledWith('t:common.copied');
      expect(press('r').defaultPrevented).toBe(true);
      expect(refresher.refresh).toHaveBeenCalledTimes(1);
      expect(press('j').defaultPrevented).toBe(false);
    });

    it('1 to 3 set the phase query only while the Specs panel has focus', () => {
      const { press, navigate } = onDashboard();
      document.body.innerHTML = '<div data-panel="specs"><button type="button">row</button></div>';
      expect(press('2').defaultPrevented).toBe(false);
      document.querySelector('button')?.focus();
      press('2');
      expect(navigate).toHaveBeenLastCalledWith(['/w', 'harbor'], { queryParams: { phase: 'building' }, queryParamsHandling: 'merge' });
      press('1');
      expect(navigate).toHaveBeenLastCalledWith(['/w', 'harbor'], { queryParams: { phase: null }, queryParamsHandling: 'merge' });
    });

    it('h and l keep the row index across the workspace columns on /', () => {
      const { press } = setup({ url: '/', ws: null, specId: null });
      const column = (ws: string, rows: number) =>
        `<section data-ui="workspace-column" data-ws="${ws}">${'<a class="d-row" href="#">r</a>'.repeat(rows)}</section>`;
      document.body.innerHTML = column('a', 3) + column('b', 3) + column('c', 1);
      const rows = (i: number) => [...(document.querySelectorAll('[data-ui="workspace-column"]').item(i) as Element | null)?.querySelectorAll('a') ?? []];
      rows(0)[1]?.focus();
      press('l');
      expect(document.activeElement).toBe(rows(1)[1]);
      press('l');
      expect(document.activeElement).toBe(rows(2)[0]);
      expect(press('l').defaultPrevented).toBe(false);
      press('h');
      expect(document.activeElement).toBe(rows(1)[0]);
      rows(0)[0]?.focus();
      expect(press('h').defaultPrevented).toBe(false);
    });
  });

  describe('the palette chord (T66, review 2026-09-30)', () => {
    it('matches Mod+k by the physical key, so a Cyrillic or Greek layout still opens the palette', () => {
      const { press, service } = setup();
      press('л', { code: 'KeyK', metaKey: true });
      expect(service.paletteOpen()).toBe(true);
    });

    it('leaves Ctrl+K to the text field on macOS (kill to end of line) and still opens with ⌘K there', () => {
      const platform = vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)');
      const { press, service } = setup();
      const field = document.body.appendChild(document.createElement('input'));
      const ctrl = press('k', { code: 'KeyK', ctrlKey: true }, field);
      expect(ctrl.defaultPrevented).toBe(false);
      expect(service.paletteOpen()).toBe(false);
      press('k', { code: 'KeyK', metaKey: true }, field);
      expect(service.paletteOpen()).toBe(true);
      field.remove();
      platform.mockRestore();
    });
  });
});

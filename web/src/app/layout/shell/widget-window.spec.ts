import {
  isTabMode,
  openWidget,
  readWidgetBounds,
  saveWidgetBounds,
  WIDGET_BOUNDS_KEY,
  WIDGET_WINDOW_NAME,
  type WidgetBounds,
} from './widget-window';

/** A `Storage` over a map; `throws` makes every access (the accessor included) fail, as in a blocked private window. */
function fakeStorage(initial: Record<string, string> = {}): Storage {
  const items = new Map(Object.entries(initial));
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key: string) => items.get(key) ?? null,
    key: (index: number) => [...items.keys()][index] ?? null,
    removeItem: (key: string) => items.delete(key),
    setItem: (key: string, value: string) => items.set(key, value),
  };
}

interface FakeWindow {
  readonly win: Window;
  readonly open: ReturnType<typeof vi.fn<Window['open']>>;
  readonly focus: ReturnType<typeof vi.fn<() => void>>;
  readonly storage: Storage;
}

/** A window whose `open` returns a handle with a spied `focus`; `storage: 'throws'` makes the `localStorage` accessor throw. */
function fakeWindow(storage: Storage | 'throws' = fakeStorage(), size = { outer: 1200, avail: 1440 }): FakeWindow {
  const focus = vi.fn<() => void>();
  const open = vi.fn<Window['open']>(() => ({ focus }) as unknown as Window);
  const target = { open, outerWidth: size.outer, screen: { availWidth: size.avail } } as Record<string, unknown>;
  Object.defineProperty(target, 'localStorage', {
    get: () => {
      if (storage === 'throws') throw new DOMException('denied', 'SecurityError');
      return storage;
    },
  });
  return { win: target as unknown as Window, open, focus, storage: storage === 'throws' ? fakeStorage() : storage };
}

const stored = (value: string): Storage => fakeStorage({ [WIDGET_BOUNDS_KEY]: value });

/** Spec 071 T23 (ISC-581): one synchronous `window.open` on a fixed name, without `noopener`, then the handle is focused. */
describe('openWidget (spec 071, ISC-581)', () => {
  it('opens /widget once under the fixed window name as a popup and focuses the returned handle', () => {
    const { win, open, focus } = fakeWindow();
    openWidget(win);
    expect(open).toHaveBeenCalledTimes(1);
    const [url, name, features] = open.mock.calls[0] ?? [];
    expect(url).toBe('/widget');
    expect(name).toBe('spectant-status');
    expect(name).toBe(WIDGET_WINDOW_NAME);
    expect(features?.split(',')[0]).toBe('popup');
    expect(features).not.toMatch(/noopener|noreferrer/);
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it('a second call reuses the same window name, so the browser re-targets the open window', () => {
    const { win, open, focus } = fakeWindow();
    openWidget(win);
    openWidget(win);
    expect(open.mock.calls.map((call) => call[1])).toEqual([WIDGET_WINDOW_NAME, WIDGET_WINDOW_NAME]);
    expect(focus).toHaveBeenCalledTimes(2);
  });

  it('survives a blocked popup (a null handle)', () => {
    const { win, open } = fakeWindow();
    open.mockReturnValue(null);
    expect(() => openWidget(win)).not.toThrow();
  });
});

/** Spec 071 T24 (ISC-596): the stored bounds, else 480 × 720 for missing, broken or unreadable values. */
describe('widget bounds (spec 071, ISC-596)', () => {
  const features = (fake: FakeWindow): string => {
    openWidget(fake.win);
    return fake.open.mock.calls[0]?.[2] ?? '';
  };

  it('opens with the stored width, height and position', () => {
    const fake = fakeWindow(stored(JSON.stringify({ width: 520, height: 800, left: 40, top: 60 })));
    expect(features(fake)).toBe('popup,width=520,height=800,left=40,top=60');
  });

  it('opens with 480 × 720 and no position when nothing is stored', () => {
    expect(features(fakeWindow())).toBe('popup,width=480,height=720');
  });

  it.each([
    ['not JSON', '{width:'],
    ['not an object', '"wide"'],
    ['null', 'null'],
    ['an array', '[520, 800]'],
    ['a string width', JSON.stringify({ width: '520', height: 800, left: 0, top: 0 })],
    ['a missing height', JSON.stringify({ width: 520, left: 0, top: 0 })],
    ['a zero width', JSON.stringify({ width: 0, height: 800, left: 0, top: 0 })],
    ['a negative height', JSON.stringify({ width: 520, height: -5, left: 0, top: 0 })],
    ['a missing position', JSON.stringify({ width: 520, height: 800 })],
    ['a non-numeric position', JSON.stringify({ width: 520, height: 800, left: 'x', top: 0 })],
  ])('opens with 480 × 720 when the stored value is %s', (_name, value) => {
    expect(readWidgetBounds(fakeWindow(stored(value)).win)).toBeNull();
    expect(features(fakeWindow(stored(value)))).toBe('popup,width=480,height=720');
  });

  it('opens with 480 × 720 when localStorage throws', () => {
    const fake = fakeWindow('throws');
    expect(readWidgetBounds(fake.win)).toBeNull();
    expect(features(fake)).toBe('popup,width=480,height=720');
  });

  it('opens with 480 × 720 when getItem throws', () => {
    const storage = fakeStorage();
    storage.getItem = () => {
      throw new Error('blocked');
    };
    expect(features(fakeWindow(storage))).toBe('popup,width=480,height=720');
  });

  it('saves bounds rounded, reads them back, and never throws on a failing store', () => {
    const fake = fakeWindow();
    const bounds: WidgetBounds = { width: 500.4, height: 700.6, left: 10, top: -20 };
    saveWidgetBounds(bounds, fake.win);
    expect(JSON.parse(fake.storage.getItem(WIDGET_BOUNDS_KEY) ?? 'null')).toEqual({ width: 500, height: 701, left: 10, top: -20 });
    expect(readWidgetBounds(fake.win)).toEqual({ width: 500, height: 701, left: 10, top: -20 });

    expect(() => saveWidgetBounds(bounds, fakeWindow('throws').win)).not.toThrow();
    const full = fakeStorage();
    full.setItem = () => {
      throw new DOMException('full', 'QuotaExceededError');
    };
    expect(() => saveWidgetBounds(bounds, fakeWindow(full).win)).not.toThrow();
  });

  it('the key is spectant.statusWidget.bounds', () => {
    expect(WIDGET_BOUNDS_KEY).toBe('spectant.statusWidget.bounds');
  });
});

/** Spec 071 (ISC-596, ISC-586.1): a window as wide as the screen's available width is a tab, not a popup. */
describe('isTabMode (spec 071)', () => {
  it.each([
    [1440, 1440, true],
    [1500, 1440, true],
    [480, 1440, false],
  ])('outerWidth %i against availWidth %i is tab mode: %s', (outer, avail, expected) => {
    expect(isTabMode(fakeWindow(fakeStorage(), { outer, avail }).win)).toBe(expected);
  });
});

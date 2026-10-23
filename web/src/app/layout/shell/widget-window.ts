/**
 * The status widget's own browser window (spec 071, ISC-581, ISC-596). `openWidget()` opens `/widget` synchronously
 * inside the click gesture, so no popup blocker stops it, under one fixed window name: a second call re-targets the
 * open window instead of opening another, and focusing the returned handle brings it to the front. It passes no
 * `noopener`, since the widget's rows need `window.opener`. The window's last bounds are a per-viewer convenience in
 * `localStorage` (web/CLAUDE.md § State); every access is wrapped, and missing, broken or unreadable bounds open it at
 * 480 × 720. Saving them is the widget page's job, never in tab mode (ISC-586.1).
 */

/** The fixed window name every open targets. */
export const WIDGET_WINDOW_NAME = 'spectant-status';
/** The `localStorage` key of the widget window's last bounds. */
export const WIDGET_BOUNDS_KEY = 'spectant.statusWidget.bounds';
/** The widget's route. */
export const WIDGET_PATH = '/widget';

/** The widget window's size and position in CSS pixels. */
export interface WidgetBounds {
  readonly width: number;
  readonly height: number;
  readonly left: number;
  readonly top: number;
}

/** The size the widget opens with when no usable bounds are stored. */
export const WIDGET_DEFAULT_SIZE = { width: 480, height: 720 } as const;

const isSize = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;
const isPosition = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** The stored bounds, or null when none are stored, they do not parse into four numbers, or the store throws. */
export function readWidgetBounds(win: Window = window): WidgetBounds | null {
  try {
    const raw = win.localStorage.getItem(WIDGET_BOUNDS_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    const { width, height, left, top } = parsed as Partial<Record<keyof WidgetBounds, unknown>>;
    if (!isSize(width) || !isSize(height) || !isPosition(left) || !isPosition(top)) return null;
    return { width: Math.round(width), height: Math.round(height), left: Math.round(left), top: Math.round(top) };
  } catch {
    return null;
  }
}

/** Stores the bounds, rounded to whole pixels; a full or blocked store only loses the convenience. */
export function saveWidgetBounds(bounds: WidgetBounds, win: Window = window): void {
  const { width, height, left, top } = bounds;
  const rounded = { width: Math.round(width), height: Math.round(height), left: Math.round(left), top: Math.round(top) };
  try {
    win.localStorage.setItem(WIDGET_BOUNDS_KEY, JSON.stringify(rounded));
  } catch {
    // Nothing to do: the next open falls back to 480 × 720.
  }
}

/** A window as wide as the screen's available width runs as a tab (a phone, or a popup the browser refused to size). */
export function isTabMode(win: Window): boolean {
  return win.outerWidth >= win.screen.availWidth;
}

/** The `window.open` features: a popup at the stored bounds, else 480 × 720 where the browser places it. */
export function widgetFeatures(bounds: WidgetBounds | null): string {
  if (bounds === null) return `popup,width=${WIDGET_DEFAULT_SIZE.width},height=${WIDGET_DEFAULT_SIZE.height}`;
  return `popup,width=${bounds.width},height=${bounds.height},left=${bounds.left},top=${bounds.top}`;
}

/** Opens (or re-targets) the widget window and brings it to the front; null when the browser blocked it. */
export function openWidget(win: Window = window): Window | null {
  const handle = win.open(WIDGET_PATH, WIDGET_WINDOW_NAME, widgetFeatures(readWidgetBounds(win)));
  handle?.focus();
  return handle;
}

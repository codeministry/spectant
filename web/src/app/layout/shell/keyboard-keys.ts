import { GO_PREFIX, GROUP_CONTEXT, type Shortcut, type ShortcutContext, SHORTCUTS } from './keyboard-bindings';

/**
 * Key matching for `KeyboardService`: the `SHORTCUTS` table indexed by key (chords, single keys, `g` sequences), the
 * binding a key has in a context, and the document states in which a key is never a shortcut. Free of Angular.
 */

/** Typing targets: a key pressed here is text, never a shortcut (as `UiRovingList` and `ShellState`). */
export const TYPING = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';

export const MOD = 'Mod+';

export type BindingMap = ReadonlyMap<string, readonly Shortcut[]>;

/** The bindings of `list` by their `key`; one key holds one binding per context (`GROUP_CONTEXT`). */
function byKey(list: readonly Shortcut[], key: (binding: Shortcut) => string | undefined): BindingMap {
  const map = new Map<string, Shortcut[]>();
  for (const binding of list) {
    const k = key(binding);
    if (k !== undefined) map.set(k, [...(map.get(k) ?? []), binding]);
  }
  return map;
}

export const chord = byKey(
  SHORTCUTS.filter((b) => b.keys.length === 1 && b.keys[0]?.startsWith(MOD)),
  (b) => b.keys[0],
);
export const singleKey = byKey(
  SHORTCUTS.filter((b) => b.keys.length === 1 && !b.keys[0]?.startsWith(MOD)),
  (b) => b.keys[0],
);
export const goKey = byKey(
  SHORTCUTS.filter((b) => b.keys.length === 2 && b.keys[0] === GO_PREFIX),
  (b) => b.keys[1],
);

/** The binding `key` has in the context `here`, else its `any` one. */
export function pickBinding(map: BindingMap, key: string, here: ShortcutContext | null): Shortcut | undefined {
  return map.get(key)?.find((binding) => {
    const context = GROUP_CONTEXT[binding.group];
    return context === 'any' || context === here;
  });
}

/**
 * The letter of a chord from the physical key (`KeyK` → `k`), so a non-Latin layout (`л`, `κ`) still reaches the
 * binding its `aria-keyshortcuts` announces; any other key falls back to its produced value.
 */
export function chordKey(event: KeyboardEvent): string {
  return /^Key[A-Z]$/u.test(event.code) ? event.code.slice(3).toLowerCase() : event.key.toLowerCase();
}

/** Whether the event's target is a typing target (`TYPING`). */
export function inTypingTarget(event: KeyboardEvent): boolean {
  return event.target instanceof Element && event.target.closest(TYPING) !== null;
}

/** An open `<dialog>` or popover owns the keyboard; `:popover-open` throws where it is unknown. */
export function overlayOpen(document: Document): boolean {
  try {
    return document.querySelector('dialog[open], [popover]:popover-open') !== null;
  } catch {
    return document.querySelector('dialog[open]') !== null;
  }
}

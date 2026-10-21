import {
  GROUP_CONTEXT,
  type Shortcut,
  SHORTCUT_CONTEXTS,
  SHORTCUT_GROUPS,
  type ShortcutContext,
  type ShortcutGroup,
  SHORTCUTS,
} from './keyboard-bindings';

/** One group of `SHORTCUTS` as the `?` sheet and the Help page's Keyboard section list it. */
export interface ShortcutSheetGroup {
  readonly id: ShortcutGroup;
  readonly bindings: readonly Shortcut[];
}

/** One context of the sheet with its groups. */
export interface ShortcutSheetContext {
  readonly id: ShortcutContext;
  readonly groups: readonly ShortcutSheetGroup[];
  /** A context of one group names it once, in the context heading. */
  readonly titled: boolean;
}

/**
 * `SHORTCUTS` in table order, grouped, and the groups by context (the table order is already context and group order):
 * the one grouping the `?` sheet and the Help page's Keyboard section both list.
 */
export const SHORTCUT_SHEET: readonly ShortcutSheetContext[] = SHORTCUT_CONTEXTS.map((context) => {
  const groups = SHORTCUT_GROUPS.filter((group) => GROUP_CONTEXT[group] === context).map((id) => ({
    id,
    bindings: SHORTCUTS.filter((binding) => binding.group === id),
  }));
  return { id: context, groups, titled: groups.length > 1 };
});

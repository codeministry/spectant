import { type AreaId, SPEC_AREAS, type TabId } from '../layout/shell/areas';

/**
 * The app's keyboard bindings (ISC-97, T102) as data: `KeyboardService` dispatches from this table, the shortcut sheet
 * renders it, and the unit and e2e tests read it, so a binding cannot work without being listed or be listed without
 * working. Kept free of Angular so `web/e2e/keyboard.spec.ts` imports it directly.
 *
 * Keys are `KeyboardEvent.key` values; a two-key entry is a `g` sequence (the second key within `G_WINDOW_MS`).
 */

/** The prefix of every section jump. */
export const GO_PREFIX = 'g';
/** How long the `g` prefix waits for its second key. */
export const G_WINDOW_MS = 1500;
/**
 * The palette chord (T66): `k` with ⌘ (macOS) or Ctrl (Linux, and where cmux claims ⌘K). A `Mod+` entry is the one
 * kind of binding that fires with a modifier held, from inside a field, and with single-key shortcuts off.
 */
export const PALETTE_CHORD = 'Mod+k';
/** `SPEC_AREAS` gives the dashboard no `goKey`; `g h` ("home") reaches it. */
export const DASHBOARD_GO_KEY = 'h';

/**
 * Second keys for the tabs an area key does not already reach (`g s` `g l` `g d` `g o` `g n` open each area on its
 * first tab: status, board, claims, plan, notes). None clashes with an area key or with another tab.
 */
export const TAB_GO_KEYS: Readonly<Partial<Record<TabId, string>>> = {
  timeline: 't',
  matrix: 'x',
  tasks: 'k',
  evidence: 'e',
  design: 'i',
  decisions: 'r',
  constitution: 'c',
};

export const SHORTCUT_GROUPS = ['navigate', 'spec', 'board', 'general'] as const;
export type ShortcutGroup = (typeof SHORTCUT_GROUPS)[number];

export type ShortcutAction =
  | { readonly kind: 'go-area'; readonly area: AreaId }
  | { readonly kind: 'go-tab'; readonly tab: TabId }
  | { readonly kind: 'step-spec'; readonly delta: -1 | 1 }
  | { readonly kind: 'toggle-view' }
  | { readonly kind: 'step-frame'; readonly delta: -1 | 1 }
  | { readonly kind: 'toggle-zen' }
  | { readonly kind: 'mark-reviewed' }
  | { readonly kind: 'open-notes' }
  | { readonly kind: 'focus-search' }
  | { readonly kind: 'open-sheet' }
  | { readonly kind: 'open-palette' }
  | { readonly kind: 'leave-spec' };

export interface Shortcut {
  /** Stable id: `data-binding` in the sheet. */
  readonly id: string;
  readonly keys: readonly string[];
  readonly group: ShortcutGroup;
  readonly action: ShortcutAction;
  /** Transloco key of the description; `{{target}}` is filled with the translated `target` key. */
  readonly label: string;
  readonly target?: string;
}

const areaShortcuts: Shortcut[] = SPEC_AREAS.map((area) => ({
  id: `go-${area.id}`,
  keys: [GO_PREFIX, area.goKey ?? DASHBOARD_GO_KEY],
  group: 'navigate',
  action: { kind: 'go-area', area: area.id },
  label: 'shortcuts.actions.goTo',
  target: `shell.areas.${area.id}`,
}));

const tabShortcuts: Shortcut[] = SPEC_AREAS.flatMap((area) =>
  area.tabs.flatMap((tab): Shortcut[] => {
    const key = TAB_GO_KEYS[tab];
    return key === undefined
      ? []
      : [
          {
            id: `go-tab-${tab}`,
            keys: [GO_PREFIX, key],
            group: 'navigate',
            action: { kind: 'go-tab', tab },
            label: 'shortcuts.actions.goTo',
            target: `shell.tabs.${tab}`,
          },
        ];
  }),
);

export const SHORTCUTS: readonly Shortcut[] = [
  ...areaShortcuts,
  ...tabShortcuts,
  { id: 'prev-spec', keys: ['['], group: 'spec', action: { kind: 'step-spec', delta: -1 }, label: 'shortcuts.actions.prevSpec' },
  { id: 'next-spec', keys: [']'], group: 'spec', action: { kind: 'step-spec', delta: 1 }, label: 'shortcuts.actions.nextSpec' },
  { id: 'notes', keys: ['n'], group: 'spec', action: { kind: 'open-notes' }, label: 'shortcuts.actions.notes' },
  { id: 'mark-reviewed', keys: ['m'], group: 'spec', action: { kind: 'mark-reviewed' }, label: 'shortcuts.actions.markReviewed' },
  { id: 'leave-spec', keys: ['Escape'], group: 'spec', action: { kind: 'leave-spec' }, label: 'shortcuts.actions.leaveSpec' },
  { id: 'view', keys: ['v'], group: 'board', action: { kind: 'toggle-view' }, label: 'shortcuts.actions.view' },
  { id: 'prev-frame', keys: ['ArrowLeft'], group: 'board', action: { kind: 'step-frame', delta: -1 }, label: 'shortcuts.actions.prevFrame' },
  { id: 'next-frame', keys: ['ArrowRight'], group: 'board', action: { kind: 'step-frame', delta: 1 }, label: 'shortcuts.actions.nextFrame' },
  { id: 'zen', keys: ['z'], group: 'general', action: { kind: 'toggle-zen' }, label: 'shortcuts.actions.zen' },
  { id: 'search', keys: ['f'], group: 'general', action: { kind: 'focus-search' }, label: 'shortcuts.actions.search' },
  { id: 'palette', keys: [PALETTE_CHORD], group: 'general', action: { kind: 'open-palette' }, label: 'shortcuts.actions.palette' },
  { id: 'palette-slash', keys: ['/'], group: 'general', action: { kind: 'open-palette' }, label: 'shortcuts.actions.palette' },
  { id: 'sheet', keys: ['?'], group: 'general', action: { kind: 'open-sheet' }, label: 'shortcuts.actions.sheet' },
];

const KEY_LABELS: Readonly<Record<string, string>> = {
  ArrowLeft: '◂',
  ArrowRight: '▸',
  Escape: 'Esc',
  [PALETTE_CHORD]: '⌘K / Ctrl K',
};

/** What a key cap shows: the key itself, or its symbol for the arrows and Esc. */
export const keyLabel = (key: string): string => KEY_LABELS[key] ?? key;

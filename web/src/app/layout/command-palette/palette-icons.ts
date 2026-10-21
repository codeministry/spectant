import type { PaletteEntry } from '../../core/palette-sources';
import type { IconName } from '../../shared/icons/icons';

/** The lead icon per group (spec 024 T40); a group with an id chip leads with the chip. */
const GROUP_ICONS: Readonly<Partial<Record<string, IconName>>> = {
  recent: 'clock',
  nextUp: 'terminal',
  workspaces: 'folder',
  services: 'server',
  actions: 'layers',
};

/** The Actions group's icons by entry id; any other action takes the group's `layers`. */
const ACTION_ICONS: Readonly<Partial<Record<string, IconName>>> = {
  'action/all-workspaces': 'layers',
  'action/copy-next': 'copy',
  'action/open-board': 'layers',
  'action/open-library': 'book',
  'action/help': 'circle-help',
  'action/open-assistant': 'message-circle-more',
  'action/refresh': 'refresh-cw',
  'action/theme': 'settings',
  'action/language': 'settings',
  'action/shortcuts': 'circle-help',
};

/** Groups whose labels are commands or ports, set in mono (`Next up`, `Services`). */
export const MONO_GROUPS: ReadonlySet<string> = new Set(['nextUp', 'services']);

/**
 * The option's lead icon: Recent's `clock` always; otherwise null where the entry leads with its chip (a spec, claim,
 * idea or archive id) or the group has no icon of its own.
 */
export function leadIcon(group: string, entry: PaletteEntry): IconName | null {
  if (group === 'recent') return 'clock';
  // Next up leads with `terminal` and the command; the id stays a search key.
  if (group === 'nextUp') return 'terminal';
  if (entry.chip) return null;
  if (group === 'actions') return ACTION_ICONS[entry.id] ?? 'layers';
  return GROUP_ICONS[group] ?? null;
}

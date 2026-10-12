import type { IconName } from '../../icons/icons';

/**
 * The prototype's `CHIP_ICON` (`app.js`), word for word (spec 024 design.md § Fundament, Icons): the key a chip shows
 * (a spec type, a stage, a state) to the Lucide icon in front of its word, the prototype keys resolved through
 * `icons/prototype-map.ts` (`flask` → `flask-conical`, `checkCircle` → `circle-check`, `octagon` → `octagon-x`,
 * `alert` → `triangle-alert`, `loader` → `loader-circle`, `gitBranch` → `git-branch`).
 */
export const CHIP_ICON = {
  feature: 'sparkles',
  bugfix: 'bug',
  fix: 'bug',
  refactor: 'shuffle',
  spike: 'flask-conical',
  scoping: 'compass',
  specified: 'compass',
  planned: 'list',
  tasked: 'list',
  building: 'hammer',
  implementing: 'hammer',
  'code-reviewed': 'search',
  done: 'circle-check',
  closed: 'circle-check',
  approved: 'circle-check',
  blocked: 'octagon-x',
  stale: 'clock',
  changed: 'clock',
  warn: 'triangle-alert',
  take: 'hand',
  takeable: 'hand',
  taken: 'loader-circle',
  dispatched: 'loader-circle',
  'lane-chip': 'git-branch',
} as const satisfies Record<string, IconName>;

export type ChipIconKey = keyof typeof CHIP_ICON;

/** The icon of a chip key, `undefined` for a key the prototype shows without one (a mono chip, an ID). */
export const chipIcon = (key: string): IconName | undefined =>
  Object.hasOwn(CHIP_ICON, key) ? CHIP_ICON[key as ChipIconKey] : undefined;

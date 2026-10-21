// The app's icon keys by name (ISC-147, ISC-452): each short key the app's icon tables use, mapped to the Lucide
// symbol it draws. `<ui-icon>` renders the pinned `lucide-static` path of the mapped name, so every value must exist
// in that version and in `ICON_NAMES`. A trailing comment says why a value differs from the first name proposed for the
// key or how a low-confidence key was decided. `web/tests/look-snapshot.test.ts` holds the map against the pinned
// package and the tracked snapshot `web/tests/fixtures/look-snapshot.json` (part `icons`).
import type { IconName } from './icons';

export const ICON_KEY_MAP: Readonly<Record<string, IconName>> = {
  activity: 'activity',
  alert: 'triangle-alert',
  anchor: 'anchor',
  arrowLeft: 'arrow-left',
  arrowRight: 'arrow-right',
  book: 'book',
  bot: 'bot',
  bug: 'bug',
  check: 'check',
  checkCircle: 'circle-check',
  chevronDown: 'chevron-down',
  chevronRight: 'chevron-right',
  clock: 'clock',
  cloud: 'cloud',
  compass: 'compass',
  copy: 'copy',
  external: 'external-link',
  eye: 'eye',
  file: 'file',
  flag: 'flag', // low confidence: the older Lucide flag (pole plus waving cloth); 1.48 redraws the same symbol
  flask: 'flask-conical', // proposal flask-round: the drawing is the conical flask with a fill line, as the demo chip
  folder: 'folder',
  git: 'git-commit-horizontal',
  gitBranch: 'git-branch',
  grip: 'grip-vertical', // proposal grip: six dots in two columns is grip-vertical; grip is the 3x3 grid
  hammer: 'hammer',
  hand: 'hand',
  help: 'circle-help', // proposal circle-question-mark: same paths in the pin, circle-help is the name the app uses
  image: 'image',
  layers: 'layers',
  list: 'list', // low confidence: dots at x=3 and lines from x=8, the older list drawn as lines; same symbol
  loader: 'loader-circle',
  lock: 'lock',
  message: 'message-circle-more', // low confidence: round speech bubble with three dots, the older path
  more: 'ellipsis',
  note: 'sticky-note', // low confidence: square sheet with a folded corner at the top right, the older sticky-note
  octagon: 'octagon-x', // proposal octagon: the drawing is an octagon crossed by an x, as the board's stop glyph
  plus: 'plus',
  refresh: 'refresh-cw',
  rows: 'rows-3', // proposal rows-2: two dividers at y=9 and y=15 make three rows
  search: 'search',
  send: 'rocket', // proposal send: the drawing is the rocket (body plus exhaust), not a paper plane
  server: 'server',
  settings: 'settings',
  shuffle: 'shuffle',
  sort: 'arrow-down-up',
  sparkles: 'sparkles', // low confidence: four-point star with a tail toward (4,20); sparkles carries the same star
  split: 'split',
  terminal: 'terminal', // low confidence: prompt chevron plus underline written as polyline and line; same symbol
  timer: 'timer',
  trash: 'trash',
  wifiOff: 'wifi-off',
  workflow: 'workflow',
  wrench: 'wrench',
  x: 'x',
};

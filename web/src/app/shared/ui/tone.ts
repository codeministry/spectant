/**
 * The tones every coloured primitive takes, mapped once onto the theme's custom properties (`styles.css`,
 * `styles/tokens.css`). `color` is the inherited accent for edges, glows, fills and dots; `tint` the soft background;
 * `ink` the text colour that clears 4.5:1 (ISC-65). Components bind these as `var()` strings, so no colour is spelled
 * outside the theme files and both themes follow automatically.
 */
// `concern` is the yellow `--conc` of the concerns card state (spec 002, ISC-88); it has its own tint and ink.
export type Tone = 'neutral' | 'primary' | 'secondary' | 'accent' | 'success' | 'warning' | 'error' | 'concern';

const COLOR: Record<Tone, string> = {
  neutral: 'var(--muted)', // #706b6e: the prototype's --muted; --held (#8a8489) gives 2.99:1 as a dot on the neutral --raised ground (spec 024)
  primary: 'var(--color-primary)',
  secondary: 'var(--color-secondary)',
  accent: 'var(--color-accent)',
  success: 'var(--color-success)',
  warning: 'var(--color-warning)',
  error: 'var(--color-error)',
  concern: 'var(--conc)',
};

// `warning` takes the prototype's orange tint `--hover-t` (`--orange-t`, spec 024 ISC-148: stale and warn chips).
const TINT: Record<Tone, string> = {
  neutral: 'var(--color-base-300)', // the prototype's --raised, the neutral chip's ground (spec 024 ISC-148)
  primary: 'var(--disp-t)',
  secondary: 'var(--ques-t)',
  accent: 'var(--clos-t)',
  success: 'var(--done-t)',
  warning: 'var(--hover-t)',
  error: 'var(--fail-t)',
  concern: 'var(--conc-t)',
};

const INK: Record<Tone, string> = {
  neutral: 'var(--color-base-content)',
  primary: 'var(--disp-ink)',
  secondary: 'var(--ques-ink)',
  accent: 'var(--clos-ink)',
  success: 'var(--done-ink)',
  warning: 'var(--hover-ink)',
  error: 'var(--fail-ink)',
  concern: 'var(--conc-ink)',
};

// Dots: a mark that must reach 3:1 on the tint it sits on (ISC-65). Every accent passes there except light success,
// which takes the derived `--done-mark` (the accent itself in dark).
const MARK: Record<Tone, string> = { ...COLOR, success: 'var(--done-mark)' };

export const toneColor = (tone: Tone): string => COLOR[tone];
export const toneMark = (tone: Tone): string => MARK[tone];
export const toneTint = (tone: Tone): string => TINT[tone];
export const toneInk = (tone: Tone): string => INK[tone];

/**
 * The tones every coloured primitive takes, mapped once onto the theme's custom properties (`styles.css`,
 * `styles/tokens.css`). `color` is the inherited accent for edges, glows, fills and dots; `tint` the soft background;
 * `ink` the text colour that clears 4.5:1 (ISC-65). Components bind these as `var()` strings, so no colour is spelled
 * outside the theme files and both themes follow automatically.
 */
export type Tone = 'neutral' | 'primary' | 'secondary' | 'accent' | 'success' | 'warning' | 'error';

const COLOR: Record<Tone, string> = {
  neutral: 'var(--held)',
  primary: 'var(--color-primary)',
  secondary: 'var(--color-secondary)',
  accent: 'var(--color-accent)',
  success: 'var(--color-success)',
  warning: 'var(--color-warning)',
  error: 'var(--color-error)',
};

// `--hover` (warning) has no inherited `-t` tint; it is mixed from the accent the way the old tints were made.
const TINT: Record<Tone, string> = {
  neutral: 'var(--held-t)',
  primary: 'var(--disp-t)',
  secondary: 'var(--ques-t)',
  accent: 'var(--clos-t)',
  success: 'var(--done-t)',
  warning: 'color-mix(in oklch, var(--color-warning) 16%, var(--color-base-100))',
  error: 'var(--fail-t)',
};

const INK: Record<Tone, string> = {
  neutral: 'var(--color-base-content)',
  primary: 'var(--disp-ink)',
  secondary: 'var(--ques-ink)',
  accent: 'var(--clos-ink)',
  success: 'var(--done-ink)',
  warning: 'var(--hover-ink)',
  error: 'var(--fail-ink)',
};

// Dots: a mark that must reach 3:1 on the tint it sits on (ISC-65). Every accent passes there except light success,
// which takes the derived `--done-mark` (the accent itself in dark).
const MARK: Record<Tone, string> = { ...COLOR, success: 'var(--done-mark)' };

export const toneColor = (tone: Tone): string => COLOR[tone];
export const toneMark = (tone: Tone): string => MARK[tone];
export const toneTint = (tone: Tone): string => TINT[tone];
export const toneInk = (tone: Tone): string => INK[tone];

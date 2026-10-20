/**
 * Workspace identity, the display half (spec 024 T54, prototype `identity.js`): the accent names, the monogram, the
 * name hash and the name pattern that stands in where no screenshot exists. Pure functions only; where an identity
 * comes from (core's workspace name, or the demo fixture through `DemoData`) is the caller's business.
 */

/** The prototype's accent token names (`identity.js` `TOKENS`). */
export type WsAccent = 'teal' | 'cyan' | 'lime' | 'violet' | 'orange' | 'yellow' | 'green' | 'red';

const ACCENTS: readonly WsAccent[] = ['teal', 'cyan', 'lime', 'violet', 'orange', 'yellow', 'green', 'red'];

/**
 * Each prototype accent on the app's tokens (`web/tests/prototype-token-map.ts`): `mark` is the colour itself (tint,
 * ring, cover edge), `ink` its contrast-tuned text (`--*-text`; teal has none, its ink is `--teal-content`).
 */
export const WS_ACCENT_TOKENS: Readonly<Record<WsAccent, { readonly mark: string; readonly ink: string }>> = {
  teal: { mark: 'var(--teal)', ink: 'var(--teal-content)' },
  cyan: { mark: 'var(--color-primary)', ink: 'var(--disp-text)' },
  lime: { mark: 'var(--color-accent)', ink: 'var(--clos-text)' },
  violet: { mark: 'var(--color-secondary)', ink: 'var(--ques-text)' },
  orange: { mark: 'var(--color-warning)', ink: 'var(--hover-text)' },
  yellow: { mark: 'var(--conc)', ink: 'var(--conc-text)' },
  green: { mark: 'var(--color-success)', ink: 'var(--done-text)' },
  red: { mark: 'var(--color-error)', ink: 'var(--fail-text)' },
};

/** FNV-1a over the name, as the prototype's `hash`. */
export function wsHash(name: string): number {
  let h = 2166136261;
  for (const c of name) h = Math.imul(h ^ (c.codePointAt(0) ?? 0), 16777619);
  return h >>> 0;
}

/** The accent a name gets without a stored one: one of the first five tokens by its hash (prototype `accent`). */
export function wsAccent(name: string): WsAccent {
  return ACCENTS[wsHash(name) % 5] ?? 'cyan';
}

/** Two initials: the first letters of the first two words, else the first two letters (prototype `mono`). */
export function wsMonogram(name: string): string {
  const words = name.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (words.length === 0) return '?';
  const lead = words.length > 1 ? words.slice(0, 2).map((word) => word.charAt(0)).join('') : words.join('').slice(0, 2);
  return lead.toUpperCase();
}

/** The name pattern's geometry in a 360 × 120 box: one open arc and one dot, placed from the name hash. */
export interface WsPattern {
  readonly arc: string;
  readonly dot: { readonly cx: string; readonly cy: string };
}

export function wsPattern(name: string): WsPattern {
  const h = wsHash(name);
  const a = h % 360;
  const gap = 40 + ((h >> 8) % 50);
  const r = 34;
  const cx = 120 + ((h >> 4) % 120);
  const cy = 50 + ((h >> 12) % 30);
  const at = (deg: number): readonly [string, string] => [
    (cx + r * Math.cos((deg * Math.PI) / 180)).toFixed(1),
    (cy + r * Math.sin((deg * Math.PI) / 180)).toFixed(1),
  ];
  const [x1, y1] = at(a + gap / 2);
  const [x2, y2] = at(a - gap / 2 + 360);
  const [dx, dy] = at(a);
  return { arc: `M${x1} ${y1} A${String(r)} ${String(r)} 0 1 1 ${x2} ${y2}`, dot: { cx: dx, cy: dy } };
}

/**
 * A same-origin image path the badge and the cover may load, or null: a bundled asset (`assets/…`) or the loopback
 * image route with its cache-bust (`/api/workspaces/<ws>/images/<kind>?v=<hex>`, spec 016 T18). Anything with a
 * scheme (`https:`, `data:`, `javascript:`) or a protocol-relative start (`//`, `/\`) is remote and refused, so no
 * image request leaves the machine.
 */
export function wsLocalImage(src: string | null): string | null {
  if (src === null) return null;
  const trimmed = src.trim();
  if (trimmed === '' || /^(?:[a-z][a-z\d+.-]*:|[/\\]{2})/iu.test(trimmed)) return null;
  return trimmed;
}

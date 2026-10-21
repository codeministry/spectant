/**
 * ISC-148: the shared primitives carry the anatomy of their prototype counterpart in both themes (spec 024, T24).
 *
 *   bun run test:browser -- primitives
 *
 * The reference is `web/tests/fixtures/prototype-reference.json` → `primitives`: 41 parts, each measured by
 * `scripts/extract-prototype.ts` on a harness page that renders the prototype's markup with placeholder content
 * ("Ag", "12/3", "o", "K") inside a 640 px block, read with `getComputedStyle` per theme and normalised (whole px,
 * letter-spacing to 0.01 px, rgb()/rgba() as hex, long decimals to three places). This spec renders the app's
 * counterpart of every part in the primitives gallery (`/__ui?theme=light|dark`, section "Prototype anatomy", one
 * 640 px block `[data-anatomy="<part with . as ->"]` per part (a literal `.glow` in a template trips web/tests/no-glow.test.ts) with the same placeholder content), reads the same properties from
 * the same element (or pseudo-element) and normalises them by the same rules.
 *
 * Compared: everything the claim names — radius, padding and gap, border, shadow, font family, size and weight —
 * plus the box the content sets (height, min-width, width where the fixture has it, line-height, letter-spacing,
 * text-transform), the surface (background-color, background-image: tints, the edge bar and the glow), opacity and
 * the text `color`: every `--*-ink` aliases the prototype's `--*-text`, so text colour matches the prototype too.
 * `border-style` and `border-color` are compared only where the fixture draws a border (a non-zero `border-width`):
 * with no width the style paints nothing (Tailwind's preflight resets every element to `0 solid`, the prototype
 * leaves `none`) and the colour is `currentColor`, the text colour above.
 *
 * Not compared: the fixture parts `seam-badge` and `seam-badge.seam`. ISC-148 does not name them; they are the
 * live-board card's seam flag (`features/spec/live/card`, no shared primitive), checked with that card in the parity
 * inventory, so they are left out here.
 *
 * Colours: the app's tokens are OKLCH (web/CLAUDE.md § Design system), which Chromium serialises as `oklch()`, and
 * `color-mix()` resolves to `color(srgb …)`; both are converted to sRGB hex here like the extractor's `rgb()`, and
 * a colour matches within 2 per channel (alpha included), the rounding of a hex value written as OKLCH
 * with three decimals (the focus spec allows 3). Everything around the colours must match exactly.
 *
 * Part → app element (the selector inside the part's gallery block; a pseudo-element comes from the part's name):
 *
 * | fixture part                  | app element                                                        |
 * |-------------------------------|--------------------------------------------------------------------|
 * | card, card.edge, card.glow    | `ui-card` with `padding="0"` (the prototype `.card` has none), `edge` / `glow` |
 * | card.edge::before             | `ui-card[edge]::before` (the 3 px bar)                             |
 * | card.glow::after              | `ui-card[glow]::after` (the 140 px spot)                           |
 * | chip                          | `ui-chip` (neutral, icon)                                          |
 * | chip.building / scoping / done / stale / warn | `ui-chip` tone primary / secondary / success / warning / warning, stage icon |
 * | chip.plain                    | `ui-chip variant="plain"`                                          |
 * | chip.take                     | `ui-chip variant="take"` (lime, mono, `hand`)                      |
 * | chip.mono-chip                | `ui-chip variant="mono"`                                           |
 * | chip.st-<state>               | `ui-state-chip` → its inner `ui-chip` (closed, takeable, taken, blocked: claim family; concerns, question, fail: card family) |
 * | chip .icon                    | the `svg` inside a building `ui-chip`                              |
 * | command-chip                  | `ui-command-chip` → `.chip` with command `ab`                      |
 * | pill                          | `ui-chip variant="pill"` (secondary)                               |
 * | badge (prototype .count-badge)| `ui-chip variant="count"` (secondary), content `3`                 |
 * | kpi-tile (+ .eyebrow, .val, .val small) | `ui-kpi-tile` label `Ag`, value 12, denominator 3, meta `Ag` in a 960 px band of 120 px rows → its `ui-card` (the tile), `.eyebrow`, `.figure`, `.den` (T27) |
 * | glyph, glyph.take / taken / closed | `ui-glyph` claim states open / takeable / taken / closed (T28)   |
 * | glyph .icon                   | the `svg` inside the taken `ui-glyph` (T28)                        |
 * | seg, seg button, seg button[aria-pressed] | `ui-segmented fill` (the stretched form) with two options → `.group`, the unchecked and the checked `.seg` (T28) |
 * | kbd                           | `ui-kbd` → its `kbd`, content `K` (T28)                            |
 * | section-head                  | `ui-section-header` heading `Ag` → its `h2` (T28)                  |
 *
 * Threshold: zero differing properties on every part in both themes. Each part is its own soft assertion, so one run
 * lists every part that differs, with fixture and app values side by side.
 *
 * Write mode (spec 063): `LOOK_SNAPSHOT=write bun run test:browser -- primitives` skips the comparison and records
 * the app's own anatomy instead. One test measures every part above in both themes (same selectors, pseudo-elements,
 * property set and normalisation; the RETONED colours too, since the snapshot holds what the app paints) and writes
 * `{ <part>: { light, dark } }` as the `primitives` part of `web/tests/fixtures/look-snapshot.json`. Every other part
 * of that file is kept; the whole file is written back with sorted keys, two-space indent and a trailing newline, so
 * the output is byte-stable.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { awaitReady, expect, test } from '../fixtures';

type Measurement = Record<string, string>;
type Fixture = { primitives: Record<string, { light: Measurement; dark: Measurement }> };

const FIXTURE = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../tests/fixtures/prototype-reference.json', import.meta.url)), 'utf8'),
) as Fixture;

/** The element measured inside each part's gallery block. */
const SELECTOR: Record<string, string> = {
  card: 'ui-card',
  'card.edge': 'ui-card',
  'card.edge::before': 'ui-card',
  'card.glow': 'ui-card',
  'card.glow::after': 'ui-card',
  'chip .icon': 'ui-chip svg',
  'command-chip': 'ui-command-chip .chip',
  pill: 'ui-chip',
  badge: 'ui-chip',
  'kpi-tile': 'ui-kpi-tile ui-card',
  'kpi-tile .eyebrow': 'ui-kpi-tile .eyebrow',
  'kpi-tile .val': 'ui-kpi-tile .figure',
  'kpi-tile .val small': 'ui-kpi-tile .den',
  glyph: 'ui-glyph',
  'glyph.take': 'ui-glyph',
  'glyph.taken': 'ui-glyph',
  'glyph.closed': 'ui-glyph',
  'glyph .icon': 'ui-glyph svg',
  seg: 'ui-segmented[data-fill] .group',
  'seg button': 'ui-segmented[data-fill] .seg[aria-checked="false"]',
  'seg button[aria-pressed]': 'ui-segmented[data-fill] .seg[aria-checked="true"]',
  kbd: 'ui-kbd kbd',
  'section-head': 'ui-section-header h2',
};
const selectorOf = (part: string): string => SELECTOR[part] ?? 'ui-chip';
const pseudoOf = (part: string): string | null => /::(before|after)$/.exec(part)?.[0] ?? null;

/** The fixture parts this spec leaves out (see the header): the live-board card's seam flag. */
const NOT_PRIMITIVES = new Set(['seam-badge', 'seam-badge.seam']);

/**
 * Re-toned on purpose by spec 040 (ISC-224): the claim words that name an item state share that state's glyph in the
 * family `item` (`ITEM_ALIASES`, web/src/app/shared/ui/glyph/states.ts), so claim `open` reads secondary and `taken`
 * (now "running") primary, where the prototype drew them neutral and warning. Only their text colour is left out here;
 * shape, size and every other property still match the prototype.
 */
const RETONED: Readonly<Record<string, readonly string[]>> = { glyph: ['color'], 'glyph.taken': ['color'], 'glyph .icon': ['color'] };

const round = (n: number, places: number): number => Math.round(n * 10 ** places) / 10 ** places;

/** Per-channel tolerance (0–255) for a colour, the OKLCH round-trip of a token written with three decimals. */
const TOLERANCE = 2;

const hexOf = (rgb: readonly number[], alpha: number): string => {
  const h = (n: number): string => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0');
  return `#${rgb.map(h).join('')}${alpha >= 1 ? '' : h(alpha * 255)}`;
};

const encode = (x: number): number => 255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055);

/** OKLCH (L 0–1 or %, C, H in degrees) to sRGB bytes, by the reference matrices of CSS Color 4. */
function oklchToRgb(l: number, c: number, hDeg: number): number[] {
  const h = (hDeg * Math.PI) / 180;
  const a = c * Math.cos(h);
  const b = c * Math.sin(h);
  const l3 = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m3 = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s3 = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3,
    -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3,
    -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3,
  ].map(encode);
}

const num = (v: string): number => (v.endsWith('%') ? Number(v.slice(0, -1)) / 100 : Number(v));
const alphaOf = (a: string | undefined): number => (a === undefined ? 1 : num(a));

/** `oklch()` and `color(srgb …)` as hex, so both sides spell colours alike. */
function hexColours(value: string): string {
  return value
    .replace(/oklch\(\s*([\d.]+%?)\s+([\d.]+)\s+([\d.]+|none)(?:\s*\/\s*([\d.]+%?))?\s*\)/g, (_m, l: string, c: string, h: string, a?: string) =>
      hexOf(oklchToRgb(num(l), Number(c), h === 'none' ? 0 : Number(h)), alphaOf(a)),
    )
    .replace(/color\(srgb\s+([\d.e-]+)\s+([\d.e-]+)\s+([\d.e-]+)(?:\s*\/\s*([\d.]+%?))?\s*\)/g, (_m, r: string, g: string, b: string, a?: string) =>
      hexOf([r, g, b].map((x) => Number(x) * 255), alphaOf(a)),
    );
}

const HEX = /#[0-9a-f]{6}(?:[0-9a-f]{2})?\b/g;
const channels = (hex: string): number[] => {
  const out = [1, 3, 5, 7].map((i) => parseInt(hex.slice(i, i + 2), 16));
  out[3] = Number.isNaN(out[3]) ? 255 : (out[3] ?? 255);
  return out;
};

/** Equal outside the colours, and every colour within the tolerance. */
function same(expected: string, actual: string): boolean {
  if (expected.replace(HEX, '#') !== actual.replace(HEX, '#')) return false;
  const e = expected.match(HEX) ?? [];
  const a = actual.match(HEX) ?? [];
  return e.every((hex, i) => {
    const other = a[i];
    if (other === undefined) return false;
    const x = channels(hex);
    const y = channels(other);
    return x.every((v, k) => Math.abs(v - (y[k] ?? -1)) <= TOLERANCE);
  });
}

/** The normalisation of `scripts/extract-prototype.ts` (`normaliseValue`), so both sides read alike. */
function normalise(prop: string, value: string): string {
  const h = (n: number): string => Math.round(n).toString(16).padStart(2, '0');
  let v = hexColours(value).replace(
    /rgba?\(\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\s*\)/g,
    (_m, r: string, g: string, b: string, a?: string) =>
      `#${h(Number(r))}${h(Number(g))}${h(Number(b))}${a === undefined || Number(a) >= 1 ? '' : h(Number(a) * 255)}`,
  );
  v = v.replace(/(-?\d*\.?\d+)px/g, (_m, n: string) => `${prop === 'letter-spacing' ? round(Number(n), 2) : Math.round(Number(n))}px`);
  return v.replace(/(?<![#\w])(-?\d+\.\d{4,})/g, (_m, n: string) => String(round(Number(n), 3)));
}

/** A border is drawn when any side's width is not zero. */
const draws = (width: string | undefined): boolean => (width ?? '0px').split(/\s+/).some((w) => w !== '0px');

/** `LOOK_SNAPSHOT=write` records the app's anatomy into the look snapshot instead of comparing it. */
const WRITE = process.env['LOOK_SNAPSHOT'] === 'write';
const SNAPSHOT = fileURLToPath(new URL('../../tests/fixtures/look-snapshot.json', import.meta.url));

/** Keys sorted at every level, so the same data always serialises to the same bytes. */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value === null || typeof value !== 'object') return value;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return Object.fromEntries(entries.map(([k, v]) => [k, sortKeys(v)]));
}
const stableStringify = (value: unknown): string => `${JSON.stringify(sortKeys(value), null, 2)}\n`;

/** Replaces only the `primitives` part of the look snapshot, keeping every other part. */
function writePrimitives(primitives: Record<string, { light: Measurement; dark: Measurement }>): void {
  const current = existsSync(SNAPSHOT) ? (JSON.parse(readFileSync(SNAPSHOT, 'utf8')) as Record<string, unknown>) : {};
  writeFileSync(SNAPSHOT, stableStringify({ ...current, primitives }));
}

/** The raw computed values of every part's properties in the gallery, or null where the block or element is missing. */
async function measure(page: Page, theme: 'light' | 'dark', parts: readonly string[]): Promise<Record<string, Measurement | null>> {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/__ui?theme=${theme}`);
  await awaitReady(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', `spec-${theme}`);
  await page.evaluate(() => document.fonts.ready.then(() => true));

  const request = parts.map((part) => ({
    part,
    selector: selectorOf(part),
    pseudo: pseudoOf(part),
    props: Object.keys(FIXTURE.primitives[part]?.[theme] ?? {}),
  }));
  return page.evaluate((req) => {
    const out: Record<string, Record<string, string> | null> = {};
    for (const r of req) {
      const block = [...document.querySelectorAll('[data-anatomy]')].find((el) => el.getAttribute('data-anatomy') === r.part.replaceAll('.', '-'));
      const el = block?.querySelector(r.selector);
      if (!el) {
        out[r.part] = null;
        continue;
      }
      const cs = getComputedStyle(el, r.pseudo);
      out[r.part] = Object.fromEntries(r.props.map((p) => [p, cs.getPropertyValue(p)]));
    }
    return out;
  }, request);
}

test.describe('primitives', () => {
  const measured = Object.keys(FIXTURE.primitives);
  const parts = measured.filter((part) => !NOT_PRIMITIVES.has(part));

  test('the fixture holds the 41 measured parts, 39 of them primitives', () => {
    expect(measured.length).toBe(41);
    expect(parts.length).toBe(39);
  });

  test('writes the primitives part of the look snapshot', async ({ page }) => {
    test.skip(!WRITE, 'only under LOOK_SNAPSHOT=write');
    const snapshot: Record<string, { light: Measurement; dark: Measurement }> = {};
    for (const theme of ['light', 'dark'] as const) {
      const rows = await measure(page, theme, parts);
      const missing = parts.filter((part) => !rows[part]);
      expect(missing, `${theme}: parts without an app element`).toEqual([]);
      for (const part of parts) {
        const got = rows[part] ?? {};
        const entry = (snapshot[part] ??= { light: {}, dark: {} });
        entry[theme] = Object.fromEntries(Object.entries(got).map(([prop, value]) => [prop, normalise(prop, value)]));
      }
    }
    writePrimitives(snapshot);
    console.log(`[primitives] wrote ${String(Object.keys(snapshot).length)} parts to the look snapshot`);
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`anatomy of every primitive matches the prototype · ${theme}`, async ({ page }) => {
      test.skip(WRITE, 'LOOK_SNAPSHOT=write records the snapshot instead');
      const rows = await measure(page, theme, parts);

      const summary: string[] = [];
      for (const part of parts) {
        const want = FIXTURE.primitives[part]?.[theme] ?? {};
        const got = rows[part];
        const diffs: string[] = [];
        if (!got) diffs.push('no app element');
        else {
          for (const [prop, expected] of Object.entries(want)) {
            if ((prop === 'border-color' || prop === 'border-style') && !draws(want['border-width'])) continue;
            if (RETONED[part]?.includes(prop)) continue;
            const wanted = normalise(prop, expected);
            const actual = normalise(prop, got[prop] ?? '');
            if (!same(wanted, actual)) diffs.push(`${prop}: prototype ${expected} · app ${actual}`);
          }
        }
        summary.push(`${diffs.length === 0 ? 'PASS' : 'FAIL'} ${part} (${String(diffs.length)})`);
        expect.soft(diffs, `${theme} · ${part}`).toEqual([]);
      }
      test.info().annotations.push({ type: 'parts', description: `${theme}:\n${summary.join('\n')}` });
      console.log(`[primitives ${theme}]\n${summary.join('\n')}`);
    });
  }
});

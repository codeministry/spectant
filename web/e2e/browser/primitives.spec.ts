/**
 * ISC-148, ISC-451, ISC-585: the shared primitives keep their anatomy in both themes, held against the app's own look
 * snapshot (spec 024 T24, spec 063 T8, spec 071 T18).
 *
 *   bun run test:browser -- primitives
 *
 * The reference is `web/tests/fixtures/look-snapshot.json` → `primitives`: 44 parts, each a computed-style
 * measurement of the app itself per theme. This spec renders every part in the primitives gallery
 * (`/__ui?theme=light|dark`, section "Anatomy", one 640 px block `[data-anatomy="<part with . as ->"]` per part, with
 * the placeholder content "Ag", "12/3", "o", "K"; a literal `.glow` in a template trips web/tests/no-glow.test.ts),
 * reads every property the snapshot holds for that part from the same element (or pseudo-element) and normalises it
 * (whole px, letter-spacing to 0.01 px, `rgb()`/`rgba()`, `oklch()` and `color(srgb …)` as hex, long decimals to three
 * places).
 *
 * Measured: radius, padding and gap, border (width, style, colour), shadow, font family, size and weight, the box the
 * content sets (height, min-width, width on the fixed-size parts, line-height, letter-spacing, text-transform), the
 * surface (background-color, background-image: tints, the edge bar and the glow), opacity and the text `color`. The
 * ring's circles also record `fill`, `stroke`, `stroke-width` and `stroke-linecap`; the bar's gradient reference
 * `url("#ui-ring-<n>")` reads as `url(#ui-ring)`, since `<n>` counts the rings rendered before it.
 *
 * Part → app element (the selector inside the part's gallery block; a pseudo-element comes from the part's name):
 *
 * | part                          | app element                                                        |
 * |-------------------------------|--------------------------------------------------------------------|
 * | card, card.edge, card.glow    | `ui-card` with `padding="0"`, `edge` / `glow`                      |
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
 * | badge                         | `ui-chip variant="count"` (secondary), content `3`                 |
 * | kpi-tile (+ .eyebrow, .val, .val small) | `ui-kpi-tile` label `Ag`, value 12, denominator 3, meta `Ag` in a 960 px band of 120 px rows → its `ui-card` (the tile), `.eyebrow`, `.figure`, `.den` (T27) |
 * | glyph, glyph.take / taken / closed | `ui-glyph` claim states open / takeable / taken / closed (T28)   |
 * | glyph .icon                   | the `svg` inside the taken `ui-glyph` (T28)                        |
 * | seg, seg button, seg button[aria-pressed] | `ui-segmented fill` (the stretched form) with two options → `.group`, the unchecked and the checked `.seg` (T28) |
 * | kbd                           | `ui-kbd` → its `kbd`, content `K` (T28)                            |
 * | section-head                  | `ui-section-header` heading `Ag` → its `h2` (T28)                  |
 * | ring, ring.full               | the text-less `ui-ring`, stroke 3: size 24 at 50 % (open) and size 20 at 100 % (full, `data-full`) (spec 071) |
 * | ring .track, ring .bar        | the open ring's `.track` and `.bar` circles (spec 071)            |
 * | ring.full .bar                | the full ring's `.bar` circle, solid lime (spec 071)               |
 *
 * Threshold: zero differing properties on every part in both themes, compared exactly (the measurement is
 * deterministic, so no tolerance). Each part is its own soft assertion, so one run lists every part that differs,
 * with snapshot and app values side by side. A mutation case injects a changed `ui-card` radius into the gallery and
 * expects the comparison to name exactly that property, so the guard is shown to bite.
 *
 * Updating the reference after an intended change of a primitive: `LOOK_SNAPSHOT=write bun run test:browser --
 * primitives` skips the comparison and records the app's anatomy instead. One test measures every part above in both
 * themes (same selectors, pseudo-elements, property set and normalisation) and writes `{ <part>: { light, dark } }`
 * as the `primitives` part of the snapshot. Every other part of that file is kept; the whole file is written back
 * with sorted keys, two-space indent and a trailing newline, so the output is byte-stable. The `tokens` and `icons`
 * parts are written by `bun run look:snapshot` (web/tests/look-snapshot.ts).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { awaitReady, expect, test } from '../fixtures';

type Measurement = Record<string, string>;
type Primitives = Record<string, { light: Measurement; dark: Measurement }>;
type Theme = 'light' | 'dark';

/** Every part the gallery renders for the guard, in gallery order. */
const PARTS: readonly string[] = [
  'card',
  'card.edge',
  'card.edge::before',
  'card.glow',
  'card.glow::after',
  'chip',
  'chip.building',
  'chip.scoping',
  'chip.done',
  'chip.stale',
  'chip.warn',
  'chip.plain',
  'chip.take',
  'chip.mono-chip',
  'chip.st-closed',
  'chip.st-takeable',
  'chip.st-taken',
  'chip.st-blocked',
  'chip.st-concerns',
  'chip.st-question',
  'chip.st-fail',
  'chip .icon',
  'command-chip',
  'pill',
  'badge',
  'kpi-tile',
  'kpi-tile .eyebrow',
  'kpi-tile .val',
  'kpi-tile .val small',
  'glyph',
  'glyph.take',
  'glyph.taken',
  'glyph.closed',
  'glyph .icon',
  'seg',
  'seg button',
  'seg button[aria-pressed]',
  'kbd',
  'section-head',
  'ring',
  'ring .track',
  'ring .bar',
  'ring.full',
  'ring.full .bar',
];

/** The computed properties read from every part. */
const PROPS: readonly string[] = [
  'background-color',
  'background-image',
  'border-color',
  'border-radius',
  'border-style',
  'border-width',
  'box-shadow',
  'color',
  'font-family',
  'font-size',
  'font-weight',
  'gap',
  'height',
  'letter-spacing',
  'line-height',
  'min-width',
  'opacity',
  'padding',
  'text-transform',
];

/** The fixed-size parts, whose `width` is set by the primitive rather than by the content, also record it. */
const WITH_WIDTH = new Set([
  'badge',
  'card.edge::before',
  'card.glow::after',
  'chip .icon',
  'glyph',
  'glyph .icon',
  'glyph.closed',
  'glyph.take',
  'glyph.taken',
  'kbd',
  'ring',
  'ring.full',
]);
/** The ring's SVG circles, whose look is their paint rather than a box, also record it (spec 071, ISC-585). */
const WITH_STROKE = new Set(['ring .track', 'ring .bar', 'ring.full .bar']);
const STROKE_PROPS: readonly string[] = ['fill', 'stroke', 'stroke-linecap', 'stroke-width'];
const propsOf = (part: string): readonly string[] => [
  ...PROPS,
  ...(WITH_WIDTH.has(part) ? ['width'] : []),
  ...(WITH_STROKE.has(part) ? STROKE_PROPS : []),
];

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
  ring: 'ui-ring',
  'ring .track': 'ui-ring .track',
  'ring .bar': 'ui-ring .bar',
  'ring.full': 'ui-ring',
  'ring.full .bar': 'ui-ring .bar',
};
const selectorOf = (part: string): string => SELECTOR[part] ?? 'ui-chip';
const pseudoOf = (part: string): string | null => /::(before|after)$/.exec(part)?.[0] ?? null;

const round = (n: number, places: number): number => Math.round(n * 10 ** places) / 10 ** places;

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

/** `oklch()` and `color(srgb …)` as hex, so every colour is spelled alike. */
function hexColours(value: string): string {
  return value
    .replace(/oklch\(\s*([\d.]+%?)\s+([\d.]+)\s+([\d.]+|none)(?:\s*\/\s*([\d.]+%?))?\s*\)/g, (_m, l: string, c: string, h: string, a?: string) =>
      hexOf(oklchToRgb(num(l), Number(c), h === 'none' ? 0 : Number(h)), alphaOf(a)),
    )
    .replace(/color\(srgb\s+([\d.e-]+)\s+([\d.e-]+)\s+([\d.e-]+)(?:\s*\/\s*([\d.]+%?))?\s*\)/g, (_m, r: string, g: string, b: string, a?: string) =>
      hexOf([r, g, b].map((x) => Number(x) * 255), alphaOf(a)),
    );
}

/** Whole px, letter-spacing to 0.01 px, every colour as hex, long decimals to three places, the ring gradient unnumbered. */
function normalise(prop: string, value: string): string {
  const h = (n: number): string => Math.round(n).toString(16).padStart(2, '0');
  let v = hexColours(value.replace(/url\("?#ui-ring-\d+"?\)/g, 'url(#ui-ring)')).replace(
    /rgba?\(\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\s*\)/g,
    (_m, r: string, g: string, b: string, a?: string) =>
      `#${h(Number(r))}${h(Number(g))}${h(Number(b))}${a === undefined || Number(a) >= 1 ? '' : h(Number(a) * 255)}`,
  );
  v = v.replace(/(-?\d*\.?\d+)px/g, (_m, n: string) => `${prop === 'letter-spacing' ? round(Number(n), 2) : Math.round(Number(n))}px`);
  return v.replace(/(?<![#\w])(-?\d+\.\d{4,})/g, (_m, n: string) => String(round(Number(n), 3)));
}

/** `LOOK_SNAPSHOT=write` records the app's anatomy into the look snapshot instead of comparing it. */
const WRITE = process.env['LOOK_SNAPSHOT'] === 'write';
const SNAPSHOT = fileURLToPath(new URL('../../tests/fixtures/look-snapshot.json', import.meta.url));

/** The `primitives` part of the snapshot on disk, empty when the file or the part is missing. */
const readPrimitives = (): Primitives =>
  existsSync(SNAPSHOT) ? ((JSON.parse(readFileSync(SNAPSHOT, 'utf8')) as { primitives?: Primitives }).primitives ?? {}) : {};

/** Keys sorted at every level, so the same data always serialises to the same bytes. */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value === null || typeof value !== 'object') return value;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return Object.fromEntries(entries.map(([k, v]) => [k, sortKeys(v)]));
}
const stableStringify = (value: unknown): string => `${JSON.stringify(sortKeys(value), null, 2)}\n`;

/** Replaces only the `primitives` part of the look snapshot, keeping every other part. */
function writePrimitives(primitives: Primitives): void {
  const current = existsSync(SNAPSHOT) ? (JSON.parse(readFileSync(SNAPSHOT, 'utf8')) as Record<string, unknown>) : {};
  writeFileSync(SNAPSHOT, stableStringify({ ...current, primitives }));
}

/**
 * The normalised computed values of every part's properties in the gallery, or null where the block or element is
 * missing. `css`, when given, is injected into the page before measuring (the mutation case).
 */
async function measure(page: Page, theme: Theme, parts: readonly string[], css?: string): Promise<Record<string, Measurement | null>> {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/__ui?theme=${theme}`);
  await awaitReady(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', `spec-${theme}`);
  if (css !== undefined) await page.addStyleTag({ content: css });
  await page.evaluate(() => document.fonts.ready.then(() => true));

  const request = parts.map((part) => ({ part, selector: selectorOf(part), pseudo: pseudoOf(part), props: [...propsOf(part)] }));
  const raw = await page.evaluate((req) => {
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
  return Object.fromEntries(
    Object.entries(raw).map(([part, got]) => [
      part,
      got && Object.fromEntries(Object.entries(got).map(([prop, value]) => [prop, normalise(prop, value)])),
    ]),
  );
}

/** Every property of `want` the app paints differently, as `<prop>: snapshot <value> · app <value>`. */
function differences(want: Measurement, got: Measurement | null): string[] {
  if (!got) return ['no app element'];
  return Object.entries(want)
    .filter(([prop, expected]) => got[prop] !== expected)
    .map(([prop, expected]) => `${prop}: snapshot ${expected} · app ${got[prop] ?? '(not measured)'}`);
}

test.describe('primitives', () => {
  test('the snapshot holds every gallery part with the properties the guard reads', () => {
    test.skip(WRITE, 'LOOK_SNAPSHOT=write records the snapshot instead');
    const snapshot = readPrimitives();
    expect(Object.keys(snapshot).sort()).toEqual([...PARTS].sort());
    for (const part of PARTS) {
      for (const theme of ['light', 'dark'] as const) {
        expect(Object.keys(snapshot[part]?.[theme] ?? {}).sort(), `${theme} · ${part}`).toEqual([...propsOf(part)].sort());
      }
    }
  });

  test('writes the primitives part of the look snapshot', async ({ page }) => {
    test.skip(!WRITE, 'only under LOOK_SNAPSHOT=write');
    const snapshot: Primitives = {};
    for (const theme of ['light', 'dark'] as const) {
      const rows = await measure(page, theme, PARTS);
      const missing = PARTS.filter((part) => !rows[part]);
      expect(missing, `${theme}: parts without an app element`).toEqual([]);
      for (const part of PARTS) {
        const entry = (snapshot[part] ??= { light: {}, dark: {} });
        entry[theme] = rows[part] ?? {};
      }
    }
    writePrimitives(snapshot);
    console.log(`[primitives] wrote ${String(Object.keys(snapshot).length)} parts to the look snapshot`);
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`anatomy of every primitive matches the look snapshot · ${theme}`, async ({ page }) => {
      test.skip(WRITE, 'LOOK_SNAPSHOT=write records the snapshot instead');
      const snapshot = readPrimitives();
      const parts = Object.keys(snapshot);
      const rows = await measure(page, theme, parts);

      const summary: string[] = [];
      for (const part of parts) {
        const diffs = differences(snapshot[part]?.[theme] ?? {}, rows[part] ?? null);
        summary.push(`${diffs.length === 0 ? 'PASS' : 'FAIL'} ${part} (${String(diffs.length)})`);
        expect.soft(diffs, `${theme} · ${part}`).toEqual([]);
      }
      test.info().annotations.push({ type: 'parts', description: `${theme}:\n${summary.join('\n')}` });
      console.log(`[primitives ${theme}]\n${summary.join('\n')}`);
    });
  }

  test('a changed radius without a new snapshot is reported (mutation case)', async ({ page }) => {
    test.skip(WRITE, 'LOOK_SNAPSHOT=write records the snapshot instead');
    const snapshot = readPrimitives();
    const want = snapshot['card']?.light ?? {};
    expect(want['border-radius'], 'the snapshot records the card radius').toBe('12px');

    const intact = await measure(page, 'light', ['card']);
    expect(differences(want, intact['card'] ?? null)).toEqual([]);

    const mutated = await measure(page, 'light', ['card'], '[data-anatomy="card"] ui-card { border-radius: 3px !important; }');
    expect(differences(want, mutated['card'] ?? null)).toEqual(['border-radius: snapshot 12px · app 3px']);
  });
});

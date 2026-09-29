/**
 * ISC-64: every interactive element shows the brand focus ring under keyboard focus, in both themes (T29).
 *
 *   bun run test:browser -- focus
 *
 * Runs against the primitives gallery (`/__ui?theme=light|dark`, `web/src/app/dev/ui-gallery/`), which renders every
 * exported primitive in every interactive state, because no dashboard exists yet to test against. Per theme it
 * collects every visible, non-inert focusable element and focuses each one by keyboard:
 *
 * 1. A real `Tab` walk from the first element: every element `Tab` reaches is measured where it lands, including
 *    anything the selector below would miss.
 * 2. Elements `Tab` cannot reach (the roving-tabindex rows and segments, `tabindex="-1"` while inactive; arrow keys
 *    reach them in the product) are focused with `element.focus()` right after a real key press. Chromium's
 *    `:focus-visible` heuristic matches a programmatic focus that follows keyboard interaction, which is exactly the
 *    arrow-key path; `locator.focus()` alone is not used, since without a preceding key it may not match.
 *
 * Each focused element must match `:focus-visible` and compute to the brand ring: a 2 px solid outline in the
 * primary accent at a 2 px offset plus a 0 0 0 4 px box-shadow halo in the page colour; `[data-focus="inset"]`
 * elements (rows, scroll containers) draw the same outline at -2 px and no halo (styles/primitives.css). The expected
 * colours are the design values (design.md § Focus: `--disp` and `--bg` of each theme), not the tokens, so a broken
 * token fails the spec. Colours are compared as painted sRGB bytes, within 3 per channel for the OKLCH round-trip.
 * Every failing element is reported by its `data-gallery` name. Zero failures is the threshold.
 */
import { awaitReady, expect, test } from '../fixtures';

type Page = Parameters<typeof awaitReady>[0];

/** The brand ring per theme: `--disp` and `--bg` of the old pages (design.md, "Focus (ISC-64)"). */
const BRAND = {
  light: { ring: [0x1c, 0x8c, 0xa8], halo: [0xf6, 0xf1, 0xef] },
  dark: { ring: [0x78, 0xdc, 0xe8], halo: [0x22, 0x1f, 0x22] },
} as const;

type Rgb = readonly [number, number, number];
const TOLERANCE = 3;

/** The interactive elements (task T29); `summary` joins them because the global rule covers it too. */
const FOCUSABLE =
  'a[href], button, input, select, textarea, summary, [tabindex]:not([tabindex="-1"]), [role="button"]';

/** Below this the gallery did not render; a green run over nothing proves nothing. */
const MIN_ELEMENTS = 40;

type Shadow = { rgb: number[] | null; lengths: number[]; inset: boolean };

type Measurement = {
  probe: string | null;
  name: string;
  focusVisible: boolean;
  inset: boolean;
  outlineStyle: string;
  outlineWidth: string;
  outlineOffset: string;
  outlineRgb: number[] | null;
  shadows: Shadow[];
  boxShadow: string;
};

/**
 * Runs in the page: optionally focuses the element tagged `data-focus-probe=<focusId>`, then measures
 * `document.activeElement`. Self-contained, because Playwright serialises the function source.
 */
async function measure(focusId: string | null): Promise<Measurement | null> {
  if (focusId !== null) document.querySelector<HTMLElement>(`[data-focus-probe="${focusId}"]`)?.focus();
  const el = document.activeElement;
  if (!(el instanceof HTMLElement) || el === document.body) return null;
  // The ring is judged at rest: daisyUI's `btn` transitions `box-shadow`, so a read right after focus would catch
  // the halo mid-flight. Whether motion may run at all is ISC-66's question (the motion spec), not this one.
  await Promise.all(el.getAnimations().map((animation) => animation.finished.catch(() => undefined)));

  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  /** Paints a computed colour and reads the sRGB bytes back; `null` when the canvas rejects the syntax. */
  const toRgb = (color: string): number[] | null => {
    if (!ctx) return null;
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = 'rgb(1, 2, 3)';
    ctx.fillStyle = color;
    if (ctx.fillStyle === 'rgb(1, 2, 3)' || ctx.fillStyle === '#010203') return null;
    ctx.fillRect(0, 0, 1, 1);
    return [...ctx.getImageData(0, 0, 1, 1).data.slice(0, 3)];
  };

  /** Splits a computed `box-shadow` at top-level commas and reads colour, lengths and `inset` of each layer. */
  const shadows = (value: string): Shadow[] => {
    if (value === 'none') return [];
    const layers: string[] = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < value.length; i++) {
      const ch = value[i];
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      else if (ch === ',' && depth === 0) {
        layers.push(value.slice(start, i));
        start = i + 1;
      }
    }
    layers.push(value.slice(start));
    return layers.map((layer) => {
      const color = /[a-z-]+\([^)]*\)|#[0-9a-f]+|transparent|currentcolor/i.exec(layer)?.[0] ?? '';
      const rest = layer.replace(color, '');
      const lengths = [...rest.matchAll(/(-?[\d.]+)px/g)].map((m) => Number(m[1]));
      return { rgb: color ? toRgb(color) : null, lengths, inset: /\binset\b/.test(rest) };
    });
  };

  const owner = el.closest('[data-gallery]');
  const ownName = el.getAttribute('data-gallery');
  const label = (el.getAttribute('aria-label') ?? el.textContent).replace(/\s+/g, ' ').trim().slice(0, 32);
  const name =
    ownName ??
    `${owner?.getAttribute('data-gallery') ?? '(no data-gallery)'} > ${el.tagName.toLowerCase()}${label ? ` "${label}"` : ''}`;

  const style = getComputedStyle(el);
  return {
    probe: el.getAttribute('data-focus-probe'),
    name,
    focusVisible: el.matches(':focus-visible'),
    inset: el.matches('[data-focus="inset"]'),
    outlineStyle: style.outlineStyle,
    outlineWidth: style.outlineWidth,
    outlineOffset: style.outlineOffset,
    outlineRgb: toRgb(style.outlineColor),
    shadows: shadows(style.boxShadow),
    boxShadow: style.boxShadow,
  };
}

const near = (actual: readonly number[] | null, expected: Rgb): boolean =>
  actual?.every((v, i) => Math.abs(v - (expected[i] ?? 0)) <= TOLERANCE) ?? false;

const hex = (rgb: readonly number[] | null): string =>
  rgb === null ? 'unparsed' : `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`;

/** Every way `m` differs from the brand ring of `theme`; empty when it matches. */
function problems(m: Measurement, theme: keyof typeof BRAND): string[] {
  const { ring, halo } = BRAND[theme];
  const out: string[] = [];
  if (!m.focusVisible) out.push('not :focus-visible');
  if (m.outlineStyle !== 'solid') out.push(`outline-style ${m.outlineStyle}`);
  if (m.outlineWidth !== '2px') out.push(`outline-width ${m.outlineWidth}`);
  const offset = m.inset ? '-2px' : '2px';
  if (m.outlineOffset !== offset) out.push(`outline-offset ${m.outlineOffset} (want ${offset})`);
  if (!near(m.outlineRgb, ring)) out.push(`outline-color ${hex(m.outlineRgb)} (want ${hex(ring)})`);
  if (m.inset) {
    if (m.shadows.length > 0) out.push('inset ring carries a box-shadow halo');
  } else {
    const haloLayer = m.shadows.find(
      (s) => !s.inset && s.lengths.length === 4 && s.lengths.slice(0, 3).every((v) => v === 0) && s.lengths[3] === 4,
    );
    if (!haloLayer) out.push(`no 0 0 0 4px halo (box-shadow: ${m.boxShadow})`);
    else if (!near(haloLayer.rgb, halo)) out.push(`halo ${hex(haloLayer.rgb)} (want ${hex(halo)})`);
  }
  return out;
}

/** Tags every visible, non-inert, enabled focusable element with `data-focus-probe` and returns their ids. */
async function collect(page: Page): Promise<string[]> {
  return page.evaluate((selector) => {
    const found = [...document.querySelectorAll<HTMLElement>(selector)].filter(
      (el) =>
        !el.closest('[inert]') &&
        el.checkVisibility({ visibilityProperty: true }) &&
        !(el as HTMLElement & { disabled?: boolean }).disabled,
    );
    return found.map((el, i) => {
      el.setAttribute('data-focus-probe', String(i));
      return String(i);
    });
  }, FOCUSABLE);
}

test.describe('focus', () => {
  for (const theme of ['light', 'dark'] as const) {
    test(`brand ring on every interactive element · ${theme}`, async ({ page }) => {
      await page.goto(`/__ui?theme=${theme}`);
      await awaitReady(page);
      await expect(page.locator('html')).toHaveAttribute('data-theme', `spec-${theme}`);
      await expect(page.locator('[data-ui="gallery"]')).toBeVisible();

      const ids = await collect(page);
      expect(ids.length, 'focusable elements in the gallery').toBeGreaterThanOrEqual(MIN_ELEMENTS);

      const measured = new Map<string, Measurement>();
      const failures: string[] = [];
      const check = (m: Measurement, how: string): void => {
        const found = problems(m, theme);
        if (found.length > 0) failures.push(`${m.name} [${how}]: ${found.join('; ')}`);
      };

      // 1. The Tab walk. Start on the first element (a key press first, so the programmatic focus is keyboard
      //    modality), then Tab until focus leaves the page or comes back round.
      await page.keyboard.press('Shift');
      const first = await page.evaluate(measure, ids[0] ?? null);
      const seen = new Set<string>();
      if (first?.probe != null) {
        measured.set(first.probe, first);
        seen.add(first.probe);
        check(first, 'key + focus()');
      }
      let tabbed = 0;
      for (let step = 0; step < ids.length * 2 + 8; step++) {
        await page.keyboard.press('Tab');
        const m = await page.evaluate(measure, null);
        if (m === null) break; // focus left the document
        const key = m.probe ?? `untagged:${m.name}`;
        if (seen.has(key)) break;
        seen.add(key);
        tabbed++;
        if (m.probe === null) {
          // Tab reached something the selector missed: it is interactive by definition, so it is measured too.
          check(m, 'Tab, outside the selector');
          continue;
        }
        if (!measured.has(m.probe)) {
          measured.set(m.probe, m);
          check(m, 'Tab');
        }
      }

      // 2. What Tab cannot reach (roving tabindex): a real key press, then focus() on the element.
      let programmatic = 0;
      for (const id of ids) {
        if (measured.has(id)) continue;
        await page.keyboard.press('Shift');
        const m = await page.evaluate(measure, id);
        if (m?.probe !== id) {
          failures.push(`probe ${id} (${m?.name ?? 'nothing'}): does not take focus`);
          continue;
        }
        measured.set(id, m);
        programmatic++;
        check(m, 'key + focus()');
      }

      test.info().annotations.push({
        type: 'focus',
        description: `${theme}: ${String(ids.length)} elements, ${String(tabbed)} reached by Tab, ${String(programmatic)} by key + focus()`,
      });
      expect(measured.size).toBe(ids.length);
      expect(failures, `elements without the brand ring (${theme}):\n${failures.join('\n')}`).toEqual([]);
    });
  }
});

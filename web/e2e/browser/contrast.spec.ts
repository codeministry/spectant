/**
 * ISC-65: text reaches 4.5:1 and marks (ring track, bars, legend dots) 3:1 against their surface, in both themes (T30).
 *
 *   bun run test:browser -- contrast
 *
 * Runs against the primitives gallery (`/__ui?theme=light|dark`, `web/src/app/dev/ui-gallery/`), like the focus spec,
 * because no dashboard exists yet. Contrast is WCAG 2.x: relative luminance of the painted sRGB bytes,
 * `(L1 + 0.05) / (L2 + 0.05)`.
 *
 * Text: every element that owns a visible, non-whitespace text node inside the gallery root. Skipped: anything under
 * `aria-hidden="true"`, not visible by `checkVisibility` (display, visibility, opacity, content-visibility), a text box
 * of at most 1 px (visually hidden text), and disabled controls, which WCAG 1.4.3 exempts as inactive components.
 * Threshold 4.5:1; the WCAG large-text rule applies (3:1 from 24 px, or from 18.66 px at weight 700 and above).
 *
 * Marks, addressed by `data-gallery`: the ring's track stroke and gradient stops (`ring-*`, stops only when the ring
 * shows a value), the meter track and its fill or segments (`meter*`), every stage-track segment (`stage-track-*`),
 * and the chip legend dots (`chip-*-dot .dot`). A gradient fill is judged by each of its colour stops. Threshold 3:1.
 * The focus ring is ISC-64's (focus spec).
 *
 * Colours come from the cascade, not from screenshot pixels: the ancestor chain from `<html>` to the element is
 * painted in software, each element's `background-color` then its child into the element's own group, and the group
 * composited with the element's `opacity` (premultiplied source-over in sRGB, as CSS stacks opacity groups), onto
 * the white canvas. The foreground is the text or mark colour painted on top of that chain; the surface is the same
 * chain without it, ending at the element itself for text and at the mark's parent for marks (for a meter's fill and
 * segments, the meter's parent, since the meter's own background is the track they sit on). Tints, translucent
 * colours (daisyUI's `color-mix(… transparent)`) and inherited opacity therefore count as painted. A gradient
 * background in the chain is not modelled and is reported as a note, so a gradient surface cannot pass unseen.
 *
 * Every failing element is reported as `<data-gallery or text snippet>: <ratio> (<fg> on <bg>)`, plus the colour it
 * was painted from when opacity or alpha changed it. Zero failures is the threshold. The two known-narrow values
 * (design.md § Contrast: muted text ≈ 4.6:1, the unfilled track ≈ 3.3:1) are asserted to be present and printed as
 * annotations and on stdout.
 */
import { awaitReady, expect, test } from '../fixtures';

type Page = Parameters<typeof awaitReady>[0];

/** WCAG 2.x thresholds. */
const TEXT_MIN = 4.5;
const LARGE_TEXT_MIN = 3;
const MARK_MIN = 3;

/** Below these the gallery did not render; a green run over nothing proves nothing. */
const MIN_TEXT = 60;
const MIN_MARKS = 40;

type Sample = {
  /** `data-gallery` owner plus a text snippet or the mark's part. */
  name: string;
  kind: 'text' | 'track' | 'fill' | 'stop' | 'segment' | 'dot';
  fg: number[];
  bg: number[];
  /** The element's own colour before compositing, to recognise the muted and track tokens. */
  own: number[];
  large: boolean;
  notes: string[];
};

type Scan = { samples: Sample[]; exempt: string[]; tokens: { muted: number[]; track: number[] } };

/**
 * Runs in the page and measures every text and mark sample of the gallery. Self-contained, because Playwright
 * serialises the function source.
 */
function scan(): Scan {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('no 2d canvas');

  const read = (): number[] => [...ctx.getImageData(0, 0, 1, 1).data];
  /** RGBA bytes of a computed colour, alpha 0 to 255; `null` when the canvas rejects the syntax. */
  const rgba = (color: string): number[] | null => {
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'copy';
    ctx.fillStyle = 'rgb(1, 2, 3)';
    ctx.fillStyle = color;
    if (ctx.fillStyle === 'rgb(1, 2, 3)' || ctx.fillStyle === '#010203') return null;
    ctx.fillRect(0, 0, 1, 1);
    ctx.globalCompositeOperation = 'source-over';
    return read();
  };
  type Premul = [number, number, number, number];
  /** Source-over on premultiplied RGBA in 0..1, the blend the browser uses in sRGB space. */
  const over = (src: Premul, dst: Premul): Premul => {
    const k = 1 - src[3];
    return [src[0] + dst[0] * k, src[1] + dst[1] * k, src[2] + dst[2] * k, src[3] + dst[3] * k];
  };
  const premul = (bytes: readonly number[]): Premul => {
    const a = (bytes[3] ?? 0) / 255;
    return [((bytes[0] ?? 0) / 255) * a, ((bytes[1] ?? 0) / 255) * a, ((bytes[2] ?? 0) / 255) * a, a];
  };
  const transparent = (color: string): boolean => (rgba(color)?.[3] ?? 0) === 0;

  /**
   * The painted colour at one pixel covered by every element of `chain` (root first): each element paints its
   * `background-color`, then its child along the chain, then (for the last element) `top`, into its own group,
   * and the group is composited with the element's `opacity`, as CSS stacks opacity groups. The result lands on
   * the white UA canvas and comes back as opaque sRGB bytes.
   */
  const paint = (chain: readonly Element[], top: string | null, notes: string[]): number[] => {
    const group = (i: number): Premul => {
      const el = chain[i];
      if (!el) return [0, 0, 0, 0];
      const style = getComputedStyle(el);
      // daisyUI's noise layer (`url(data:…)`, painted at `--noise: 0`) is not a surface; a gradient is.
      if (style.backgroundImage.includes('gradient(')) {
        const note = `gradient background on ${el.tagName.toLowerCase()}`;
        if (!notes.includes(note)) notes.push(note);
      }
      let buf: Premul = [0, 0, 0, 0];
      const bg = rgba(style.backgroundColor);
      if (bg) buf = over(premul(bg), buf);
      if (i + 1 < chain.length) buf = over(group(i + 1), buf);
      else if (top !== null) buf = over(premul(rgba(top) ?? [0, 0, 0, 0]), buf);
      const opacity = Number(style.opacity);
      return [buf[0] * opacity, buf[1] * opacity, buf[2] * opacity, buf[3] * opacity];
    };
    const out = over(group(0), [1, 1, 1, 1]);
    return out.slice(0, 3).map((v) => Math.round(v * 255));
  };

  /** Root-first ancestor chain ending at `el`. */
  const chainTo = (el: Element | null): Element[] => {
    const chain: Element[] = [];
    for (let at = el; at; at = at.parentElement) chain.unshift(at);
    return chain;
  };

  /**
   * One text or mark sample: `color` painted as the topmost layer of `at` (inside every opacity group above it),
   * against the surface painted by the chain ending at `surfaceOf`.
   */
  const sample = (
    name: string,
    kind: Sample['kind'],
    color: string,
    at: Element,
    surfaceOf: Element | null,
    large = false,
  ): Sample | null => {
    const own = rgba(color);
    if (own === null || own[3] === 0) return null;
    const notes: string[] = [];
    const fg = paint(chainTo(at), color, notes);
    const bg = paint(chainTo(surfaceOf), null, notes);
    return { name, kind, fg, bg, own: own.slice(0, 3), large, notes };
  };

  const root = document.querySelector('[data-ui="gallery"]');
  if (!root) throw new Error('gallery root missing');
  const visible = (el: Element): boolean =>
    el.checkVisibility({ visibilityProperty: true, opacityProperty: true, contentVisibilityAuto: true });
  const galleryName = (el: Element): string => el.closest('[data-gallery]')?.getAttribute('data-gallery') ?? '(page)';

  const samples: Sample[] = [];
  const exempt: string[] = [];

  // Text: one sample per element that owns a visible text node.
  const owners = new Set<Element>();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent?.trim() ?? '';
    const el = node.parentElement;
    if (!text || !el || owners.has(el)) continue;
    if (el.closest('[aria-hidden="true"]') || !visible(el)) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    const box = range.getBoundingClientRect();
    if (box.width <= 1 || box.height <= 1) continue;
    owners.add(el);
    const snippet = `"${el.textContent.replace(/\s+/g, ' ').trim().slice(0, 24)}"`;
    const name = `${galleryName(el)} ${snippet}`;
    if (el.closest(':disabled, [aria-disabled="true"]')) {
      exempt.push(name);
      continue;
    }
    const style = getComputedStyle(el);
    const size = parseFloat(style.fontSize);
    const large = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700);
    const s = sample(name, 'text', style.color, el, el, large);
    if (s) samples.push(s);
  }

  // Marks.
  const gradientStops = (image: string): string[] =>
    image === 'none' ? [] : [...image.matchAll(/(?:rgba?|oklch|oklab|lab|lch|hsla?|color)\([^()]*\)/g)].map((m) => m[0]);
  const sized = (el: Element): boolean => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && visible(el);
  };

  for (const ring of root.querySelectorAll('[data-gallery^="ring-"]')) {
    const name = ring.getAttribute('data-gallery') ?? 'ring';
    const track = ring.querySelector('circle.track');
    if (track) {
      const s = sample(`${name} track`, 'track', getComputedStyle(track).stroke, track, ring);
      if (s) samples.push(s);
    }
    // Stops only when the ring shows a value: `null` and 0 draw no bar.
    const text = ring.querySelector('.text')?.textContent.replace(/\s+/g, '') ?? '';
    const bar = ring.querySelector('circle.bar');
    if (bar && /^[1-9]\d*%$/.test(text)) {
      for (const [i, stop] of [...ring.querySelectorAll('stop')].entries()) {
        const s = sample(`${name} stop ${String(i)}`, 'stop', getComputedStyle(stop).stopColor, bar, ring);
        if (s) samples.push(s);
      }
    }
  }

  for (const meter of root.querySelectorAll('ui-meter[data-gallery^="meter"]')) {
    const name = meter.getAttribute('data-gallery') ?? 'meter';
    const s = sample(`${name} track`, 'track', getComputedStyle(meter).backgroundColor, meter, meter.parentElement);
    if (s) samples.push(s);
    for (const [i, part] of [...meter.querySelectorAll('.fill, .seg')].filter(sized).entries()) {
      const style = getComputedStyle(part);
      const kind = part.classList.contains('seg') ? 'segment' : 'fill';
      const colors = transparent(style.backgroundColor) ? gradientStops(style.backgroundImage) : [style.backgroundColor];
      for (const [j, color] of colors.entries()) {
        const label = colors.length > 1 ? `${kind} ${String(i)} stop ${String(j)}` : `${kind} ${String(i)}`;
        const m = sample(`${name} ${label}`, kind, color, part, meter.parentElement);
        if (m) samples.push(m);
      }
    }
  }

  for (const track of root.querySelectorAll('[data-gallery^="stage-track-"]')) {
    const name = track.getAttribute('data-gallery') ?? 'stage-track';
    for (const [i, bar] of [...track.querySelectorAll('.bar')].filter(sized).entries()) {
      const state = bar.getAttribute('data-state') ?? bar.parentElement?.getAttribute('data-state') ?? '?';
      const s = sample(`${name} segment ${String(i)} (${state})`, 'segment', getComputedStyle(bar).backgroundColor, bar, bar.parentElement);
      if (s) samples.push(s);
    }
  }

  for (const chip of root.querySelectorAll('[data-gallery^="chip-"][data-gallery$="-dot"]')) {
    const dot = chip.querySelector('.dot');
    if (!dot || !sized(dot)) continue;
    const s = sample(`${chip.getAttribute('data-gallery') ?? 'chip'} dot`, 'dot', getComputedStyle(dot).backgroundColor, dot, dot.parentElement);
    if (s) samples.push(s);
  }

  // The resolved tokens, to single out the known-narrow samples.
  const probe = document.createElement('span');
  root.append(probe);
  probe.style.color = 'var(--muted-ink)';
  const muted = rgba(getComputedStyle(probe).color)?.slice(0, 3) ?? [];
  probe.style.color = 'var(--track)';
  const trackRgb = rgba(getComputedStyle(probe).color)?.slice(0, 3) ?? [];
  probe.remove();

  return { samples, exempt, tokens: { muted, track: trackRgb } };
}

/** WCAG 2.x relative luminance of sRGB bytes. */
function luminance(rgb: readonly number[]): number {
  const [r = 0, g = 0, b = 0] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: readonly number[], b: readonly number[]): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

const hex = (rgb: readonly number[]): string => `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
const same = (a: readonly number[], b: readonly number[]): boolean =>
  a.length === 3 && a.every((v, i) => Math.abs(v - (b[i] ?? -99)) <= 1);

/** `<name>: <ratio> (<fg> on <bg>)`, plus the unpainted colour when opacity or alpha changed it, plus notes. */
const line = (s: Sample, ratio: number): string =>
  `${s.name}: ${ratio.toFixed(2)} (${hex(s.fg)} on ${hex(s.bg)})` +
  (same(s.fg, s.own) ? '' : ` painted from ${hex(s.own)}`) +
  (s.notes.length > 0 ? ` [${s.notes.join('; ')}]` : '');

async function open(page: Page, theme: 'light' | 'dark'): Promise<Scan> {
  await page.goto(`/__ui?theme=${theme}`);
  await awaitReady(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', `spec-${theme}`);
  await expect(page.locator('[data-ui="gallery"]')).toBeVisible();
  // Colours are judged at rest: a theme transition still running would be measured mid-flight. Endless animations
  // (the skeleton shimmer) never finish and carry no text or mark, so only finite ones are awaited.
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming().endTime !== Infinity)
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );
  return page.evaluate(scan);
}

/**
 * The known-narrow token (muted text, the unfilled track): how many samples paint it, the lowest ratio where it is
 * painted as the token itself (no opacity or alpha on the way), and the lowest ratio overall.
 */
function narrow(label: string, samples: readonly Sample[], token: readonly number[]): string {
  const of = samples.filter((s) => same(s.own, token)).map((s) => ({ s, ratio: contrast(s.fg, s.bg) }));
  expect(of.length, `${label} (${hex(token)}) samples`).toBeGreaterThan(0);
  const lowest = (list: typeof of): string => {
    const min = list.reduce<(typeof of)[number] | null>((a, b) => (a === null || b.ratio < a.ratio ? b : a), null);
    return min === null ? 'none' : line(min.s, min.ratio);
  };
  const plain = of.filter(({ s }) => same(s.fg, s.own));
  return `${label} ${hex(token)}: ${String(of.length)} samples; as the token ${lowest(plain)}; lowest painted ${lowest(of)}`;
}

test.describe('contrast', () => {
  for (const theme of ['light', 'dark'] as const) {
    test(`text reaches 4.5:1 · ${theme}`, async ({ page }) => {
      const { samples, exempt, tokens } = await open(page, theme);
      const text = samples.filter((s) => s.kind === 'text');
      expect(text.length, 'text samples in the gallery').toBeGreaterThanOrEqual(MIN_TEXT);

      const failures = text.flatMap((s) => {
        const ratio = contrast(s.fg, s.bg);
        return ratio < (s.large ? LARGE_TEXT_MIN : TEXT_MIN) ? [line(s, ratio)] : [];
      });

      const large = text.filter((s) => s.large).length;
      const summary = `${theme}: ${String(text.length)} text samples (${String(large)} large), ${String(exempt.length)} disabled exempt`;
      const muted = `${theme}: ${narrow('muted', text, tokens.muted)}`;
      test.info().annotations.push({ type: 'contrast', description: summary }, { type: 'muted', description: muted });
      console.log(`[contrast] ${summary}\n[contrast] ${muted}`);
      expect(failures, `text below threshold (${theme}):\n${failures.join('\n')}`).toEqual([]);
    });

    test(`marks reach 3:1 · ${theme}`, async ({ page }) => {
      const { samples, tokens } = await open(page, theme);
      const marks = samples.filter((s) => s.kind !== 'text');
      expect(marks.length, 'mark samples in the gallery').toBeGreaterThanOrEqual(MIN_MARKS);
      for (const kind of ['track', 'fill', 'stop', 'segment', 'dot'] as const) {
        expect(marks.filter((s) => s.kind === kind).length, `${kind} marks`).toBeGreaterThan(0);
      }

      const failures = marks.flatMap((s) => {
        const ratio = contrast(s.fg, s.bg);
        return ratio < MARK_MIN ? [line(s, ratio)] : [];
      });

      // The unfilled track: ring and meter tracks and pending stage segments (a neutral dot or fill may share the hex).
      const unfilled = marks.filter((s) => s.kind === 'track' || s.name.endsWith('(pending)'));
      const summary = `${theme}: ${String(marks.length)} mark samples`;
      const track = `${theme}: ${narrow('track', unfilled, tokens.track)}`;
      test.info().annotations.push({ type: 'contrast', description: summary }, { type: 'track', description: track });
      console.log(`[contrast] ${summary}\n[contrast] ${track}`);
      expect(failures, `marks below threshold (${theme}):\n${failures.join('\n')}`).toEqual([]);
    });
  }
});

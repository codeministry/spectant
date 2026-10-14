/**
 * ISC-154: every mermaid diagram `ui-doc-prose` draws carries the anatomy of the Help page's workflow figures
 * (`features/help/workflow-figure.*`), in both themes (spec 024, T77).
 *
 *   bun run test:browser -- diagrams
 *
 * Three pages of the stub API, each with a flowchart drawn client-side: the Library reader on harbor `specs/tech.md`
 * at its architecture section, the Library reader on harbor 002's `plan.md` (two subgraphs, so clusters), and the idea page of
 * `console-audit-log`, whose story has no diagram: its response gets the plan's figure appended here, in the browser
 * (`page.route`), so no fixture and no golden changes.
 *
 * Anatomy, read with `getComputedStyle` from the rendered SVG and compared with the token resolved on the same page
 * (both sides painted to sRGB bytes on a canvas, so OKLCH and hex compare equal when they are the same colour):
 * - node shape: `fill` `--color-base-100`, `stroke` `--track`, `stroke-width` 1px, `rx` 8px on a rect;
 * - node accent: a 3-unit `g.node-accent > rect` inside each node, `fill` `--color-primary` (the Help figure's role bar);
 * - node label: `font-family` of `--font-sans` (Manrope), `font-size` 13px, `font-weight` 600, colour
 *   `--color-base-content`;
 * - edges: `stroke` `--track`, `stroke-width` 1.5px; arrowheads (every `marker` path): `fill` `--track`;
 * - clusters: `fill` `--lane`.
 * Every deviation is reported as `<page> <part> <property>: <actual> ≠ <expected>`; the threshold is zero.
 */
import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { expect, test } from '../fixtures';
import { THEMES } from '../env';

interface DocsFigure {
  readonly index: number;
  readonly kind: string;
  readonly source: string;
  readonly caption: string;
}
interface DocsPage {
  readonly html: string;
  readonly figures: readonly DocsFigure[];
}

const DOCS = JSON.parse(readFileSync(new URL('../../../core/fixtures/harbor.docs.golden.json', import.meta.url), 'utf8')) as {
  specs: Record<string, { plan: DocsPage | null }>;
};
const PLAN = DOCS.specs['specs/002-web-console']?.plan;
const PLAN_FIGURE = PLAN?.figures.find((figure) => figure.kind === 'mermaid');
if (!PLAN || !PLAN_FIGURE) throw new Error('diagrams.spec: harbor 002 has no plan with a mermaid figure');
const FIGURE_HTML = /<figure class="mermaid-figure"[\s\S]*?<\/figure>/.exec(PLAN.html)?.[0];
if (!FIGURE_HTML) throw new Error('diagrams.spec: the harbor 002 plan html has no mermaid figure');
/** The plan's figure as the idea page's figure 99 (no clash with the story's own indices). */
const IDEA_FIGURE: DocsFigure = { ...PLAN_FIGURE, index: 99 };
const IDEA_FIGURE_HTML = FIGURE_HTML.replace('data-figure="1"', 'data-figure="99"');

const IDEA = 'console-audit-log';
const PAGES = [
  // Spec 017 (ISC-158): the former Tech page and Docs tab live in the Library's reader.
  { name: 'library tech.md', url: '/w/harbor/library?section=architecture#tech.md', scope: '[data-library-reader] [data-library-prose]' },
  { name: 'library plan.md', url: '/w/harbor/library#002-web-console/plan.md', scope: '[data-library-reader] [data-library-prose]' },
  { name: 'idea', url: `/w/harbor/ideas/${IDEA}`, scope: 'ui-doc-prose' },
] as const;

/** Appends the plan's figure to the idea page's body. */
async function ideaWithDiagram(page: Page): Promise<void> {
  await page.route(`**/api/workspaces/harbor/ideas/${IDEA}`, async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as { page: DocsPage & Record<string, unknown> };
    body.page = {
      ...body.page,
      html: `${body.page.html}\n${IDEA_FIGURE_HTML}`,
      figures: [...body.page.figures, IDEA_FIGURE],
    };
    await route.fulfill({ response, json: body });
  });
}

interface Report {
  readonly deviations: string[];
  readonly nodes: number;
  readonly edges: number;
  readonly markers: number;
  readonly clusters: number;
}

/** Reads the anatomy of every drawn diagram under `scope` against the page's own tokens. */
async function anatomy(page: Page, scope: string, name: string): Promise<Report> {
  return page.evaluate(
    ({ scope, name }) => {
      const root = document.querySelector(scope);
      if (!root) return { deviations: [`${name}: no ${scope}`], nodes: 0, edges: 0, markers: 0, clusters: 0 };
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('no 2d canvas');
      const rgb = (css: string): string => {
        if (css === '' || css === 'none') return css;
        context.clearRect(0, 0, 1, 1);
        context.fillStyle = '#000';
        context.fillStyle = css;
        context.fillRect(0, 0, 1, 1);
        const [r = 0, g = 0, b = 0, a = 0] = context.getImageData(0, 0, 1, 1).data;
        return `rgba(${r}, ${g}, ${b}, ${a})`;
      };
      const probe = document.createElement('div');
      root.append(probe);
      const token = (name: string): string => {
        probe.style.color = `var(${name})`;
        return rgb(getComputedStyle(probe).color);
      };
      probe.style.fontFamily = 'var(--font-sans)';
      const sans = getComputedStyle(probe).fontFamily;
      const expected = {
        card: token('--color-base-100'),
        track: token('--track'),
        accent: token('--color-primary'),
        ink: token('--color-base-content'),
        lane: token('--lane'),
      };
      probe.remove();

      const deviations: string[] = [];
      const check = (part: string, property: string, actual: string, want: string): void => {
        if (actual !== want) deviations.push(`${name} ${part} ${property}: ${actual} ≠ ${want}`);
      };
      const svgs = [...root.querySelectorAll<SVGSVGElement>('figure.mermaid-figure[data-rendered] .mermaid-svg svg')];
      if (svgs.length === 0) deviations.push(`${name}: no rendered mermaid svg`);
      let nodes = 0;
      let edges = 0;
      let markers = 0;
      let clusters = 0;
      for (const svg of svgs) {
        for (const node of svg.querySelectorAll<SVGGElement>('g.node')) {
          nodes += 1;
          const part = `node ${node.id}`;
          const shape = node.querySelector<SVGGraphicsElement>(':scope > :is(rect, path, polygon, circle, ellipse), :scope > g:not(.node-accent) > :is(rect, path, polygon, circle, ellipse)');
          if (!shape) {
            deviations.push(`${name} ${part}: no shape`);
            continue;
          }
          const s = getComputedStyle(shape);
          check(part, 'fill', rgb(s.fill), expected.card);
          check(part, 'stroke', rgb(s.stroke), expected.track);
          check(part, 'stroke-width', s.strokeWidth, '1px');
          if (shape.localName === 'rect') check(part, 'rx', s.getPropertyValue('rx'), '8px');
          const accent = node.querySelector<SVGRectElement>(':scope > g.node-accent > rect');
          if (!accent) deviations.push(`${name} ${part}: no accent edge`);
          else {
            check(part, 'accent width', accent.getAttribute('width') ?? '', '3');
            check(part, 'accent fill', rgb(getComputedStyle(accent).fill), expected.accent);
          }
          const html = node.querySelector<HTMLElement>('.nodeLabel');
          const text = node.querySelector<SVGTextElement>('text');
          const label = html ?? text;
          if (!label) {
            deviations.push(`${name} ${part}: no label`);
            continue;
          }
          const l = getComputedStyle(label);
          check(part, 'label font-family', l.fontFamily, sans);
          check(part, 'label font-size', l.fontSize, '13px');
          check(part, 'label font-weight', l.fontWeight, '600');
          check(part, 'label colour', rgb(html ? l.color : l.fill), expected.ink);
        }
        for (const edge of svg.querySelectorAll<SVGPathElement>('.edgePaths path, path.flowchart-link')) {
          edges += 1;
          const e = getComputedStyle(edge);
          check(`edge ${edge.id}`, 'stroke', rgb(e.stroke), expected.track);
          check(`edge ${edge.id}`, 'stroke-width', e.strokeWidth, '1.5px');
        }
        for (const head of svg.querySelectorAll<SVGElement>('marker :is(path, polygon)')) {
          markers += 1;
          const marker = head.closest('marker')?.id ?? '?';
          check(`marker ${marker}`, 'fill', rgb(getComputedStyle(head).fill), expected.track);
        }
        for (const cluster of svg.querySelectorAll<SVGRectElement>('g.cluster > rect')) {
          clusters += 1;
          check(`cluster ${cluster.parentElement?.id ?? '?'}`, 'fill', rgb(getComputedStyle(cluster).fill), expected.lane);
        }
      }
      return { deviations, nodes, edges, markers, clusters };
    },
    { scope, name },
  );
}

test.describe('diagrams', () => {
  for (const theme of THEMES) {
    test.describe(theme, () => {
      test.use({ colorScheme: theme });

      test(`mermaid figures on library reader and idea carry the help figure anatomy (${theme})`, async ({ page }) => {
        let clusters = 0;
        for (const target of PAGES) {
          if (target.name === 'idea') await ideaWithDiagram(page);
          await page.goto(target.url);
          await expect(page.locator('html')).toHaveAttribute('data-theme', `spec-${theme}`);
          const svg = page.locator(`${target.scope} figure.mermaid-figure[data-rendered] .mermaid-svg svg`).first();
          await expect(svg).toBeVisible();
          await expect(svg.locator('g.node').first()).toBeVisible();
          const report = await anatomy(page, target.scope, target.name);
          expect(report.nodes, `${target.name}: nodes`).toBeGreaterThan(0);
          expect(report.edges, `${target.name}: edges`).toBeGreaterThan(0);
          expect(report.markers, `${target.name}: arrowheads`).toBeGreaterThan(0);
          clusters += report.clusters;
          expect(report.deviations, `${target.name} (${theme})`).toEqual([]);
        }
        expect(clusters, 'clusters across the three pages').toBeGreaterThan(0);
      });
    });
  }
});

/**
 * ISC-154.1: every mermaid figure `ui-doc-prose` draws carries the diagram toolbar of design.md § Mermaid toolbar
 * (spec 024, T81), on the same three pages, at 390 / 820 / 1440 and in both themes.
 *
 *   bun run test:browser -- diagrams -g controls
 *
 * Per figure: four buttons named "Zoom out", "Zoom in", "Reset zoom" and "Full screen" with the pinned icons
 * `zoom-out`, `zoom-in`, `rotate-ccw` and `maximize-2` (`ui-icon[data-icon]`) and the level label `100 %`; the steps
 * 50 · 75 · 100 · 125 · 150 · 200 · 300 % with the bound's button disabled; a zoomed figure scrolls inside its frame
 * while the page never scrolls sideways; "Full screen" opens a modal dialog over the whole viewport with the same
 * toolbar and `minimize-2` "Exit full screen", Esc closes it and focus returns to "Full screen"; Tab reaches every
 * button. With a fine pointer the toolbar is transparent until hover or focus-within; with a coarse pointer
 * (`hasTouch` + `isMobile`, `(pointer: coarse)`) it always shows.
 */
const STEPS = [50, 75, 100, 125, 150, 200, 300] as const;
const TOOLS = [
  { name: 'Zoom out', icon: 'zoom-out' },
  { name: 'Zoom in', icon: 'zoom-in' },
  { name: 'Reset zoom', icon: 'rotate-ccw' },
  { name: 'Full screen', icon: 'maximize-2' },
] as const;
const CONTROL_WIDTHS = [390, 820, 1440] as const;
const HEIGHTS: Readonly<Record<number, number>> = { 390: 844, 820: 1180, 1440: 900 };

type Target = (typeof PAGES)[number];

async function openFigure(page: Page, target: Target) {
  if (target.name === 'idea') await ideaWithDiagram(page);
  await page.goto(target.url);
  const figure = page.locator(`${target.scope} figure.mermaid-figure[data-rendered]`).first();
  await expect(figure.locator('.mermaid-svg svg')).toBeVisible();
  return figure;
}

const toolbarOf = (scope: ReturnType<Page['locator']>) => scope.getByRole('toolbar', { name: 'Diagram controls' });

async function expectToolbar(toolbar: ReturnType<Page['locator']>, context: string, fullscreen = false): Promise<void> {
  for (const tool of TOOLS) {
    const name = fullscreen && tool.icon === 'maximize-2' ? 'Exit full screen' : tool.name;
    const icon = fullscreen && tool.icon === 'maximize-2' ? 'minimize-2' : tool.icon;
    const button = toolbar.getByRole('button', { name, exact: true });
    await expect(button, `${context}: ${name}`).toHaveCount(1);
    await expect(button.locator(`ui-icon[data-icon="${icon}"]`), `${context}: ${name} icon`).toHaveCount(1);
  }
  await expect(toolbar.getByRole('button'), `${context}: four buttons`).toHaveCount(4);
  await expect(toolbar.locator('[data-zoom-level]'), `${context}: level`).toHaveText('100 %');
}

/** The drawn size of a figure's SVG against its viewBox, its frame and the figure around it. */
async function fittedState(figure: ReturnType<Page['locator']>) {
  return figure.evaluate((el) => {
    const frame = el.querySelector<HTMLElement>('.mermaid-svg');
    const svg = frame?.querySelector('svg');
    if (!frame || !svg) throw new Error('no drawn diagram');
    const [, , vw = 0, vh = 0] = (svg.getAttribute('viewBox') ?? '').split(/[\s,]+/).map(Number);
    const box = svg.getBoundingClientRect();
    const style = getComputedStyle(el);
    const caption = el.querySelector('figcaption');
    const captionBlock = caption ? caption.getBoundingClientRect().height + Number.parseFloat(getComputedStyle(caption).marginBlockStart) : 0;
    const chrome = Number.parseFloat(style.paddingBlockStart) + Number.parseFloat(style.paddingBlockEnd)
      + Number.parseFloat(style.borderBlockStartWidth) + Number.parseFloat(style.borderBlockEndWidth) + captionBlock;
    return {
      naturalWidth: vw,
      naturalHeight: vh,
      svgWidth: box.width,
      svgHeight: box.height,
      frameWidth: frame.clientWidth,
      keepsNatural: frame.hasAttribute('data-natural'),
      figureHeight: el.getBoundingClientRect().height,
      chrome,
    };
  });
}

async function pageScrollsSideways(page: Page): Promise<boolean> {
  return page.evaluate(() => (document.scrollingElement?.scrollWidth ?? 0) > window.innerWidth);
}

test.describe('controls', () => {
  for (const theme of THEMES) {
    for (const width of CONTROL_WIDTHS) {
      test.describe(`${theme} ${width}`, () => {
        test.use({ colorScheme: theme, viewport: { width, height: HEIGHTS[width] ?? 900 } });

        test(`mermaid figures carry zoom and full screen controls (fine pointer, ${theme}, ${width})`, async ({ page }) => {
          for (const target of PAGES) {
            const context = `${target.name} ${theme} ${width}`;
            const figure = await openFigure(page, target);
            await expect(page.locator('html')).toHaveAttribute('data-theme', `spec-${theme}`);
            const toolbar = toolbarOf(figure);
            await expectToolbar(toolbar, context);
            const zoomIn = toolbar.getByRole('button', { name: 'Zoom in', exact: true });
            const zoomOut = toolbar.getByRole('button', { name: 'Zoom out', exact: true });
            const reset = toolbar.getByRole('button', { name: 'Reset zoom', exact: true });
            const full = toolbar.getByRole('button', { name: 'Full screen', exact: true });
            const level = toolbar.locator('[data-zoom-level]');

            // 100 % is the fitted state (principal 2026-10-13: the plan figure drew a huge canvas): the SVG is never wider
            // than its natural viewBox width nor than its frame (unless fitMermaid keeps the natural width, then it is
            // exactly that), its height follows the viewBox ratio, and the figure is no taller than the drawn diagram
            // plus its padding, border, caption and a scrollbar.
            const fitted = await fittedState(figure);
            expect(fitted.svgWidth, `${context}: svg ≤ natural width (${JSON.stringify(fitted)})`).toBeLessThanOrEqual(fitted.naturalWidth + 1);
            if (fitted.keepsNatural) expect(Math.abs(fitted.svgWidth - fitted.naturalWidth), `${context}: natural width`).toBeLessThanOrEqual(1);
            else expect(fitted.svgWidth, `${context}: svg ≤ column (${JSON.stringify(fitted)})`).toBeLessThanOrEqual(fitted.frameWidth + 1);
            expect(Math.abs(fitted.svgHeight - (fitted.svgWidth * fitted.naturalHeight) / fitted.naturalWidth), `${context}: aspect`).toBeLessThanOrEqual(1.5);
            expect(fitted.svgHeight, `${context}: svg ≤ natural height`).toBeLessThanOrEqual(fitted.naturalHeight + 1);
            expect(fitted.figureHeight, `${context}: figure ≤ diagram + padding (${JSON.stringify(fitted)})`).toBeLessThanOrEqual(fitted.svgHeight + fitted.chrome + 20);

            // Fine pointer: transparent until hover or focus-within.
            expect(await page.evaluate(() => matchMedia('(pointer: fine)').matches), `${context}: fine pointer`).toBe(true);
            await page.mouse.move(0, 0);
            await expect.poll(() => toolbar.evaluate((el) => getComputedStyle(el).opacity), `${context}: hidden at rest`).toBe('0');
            await figure.hover();
            await expect.poll(() => toolbar.evaluate((el) => getComputedStyle(el).opacity), `${context}: shown on hover`).toBe('1');
            await page.mouse.move(0, 0);
            await expect.poll(() => toolbar.evaluate((el) => getComputedStyle(el).opacity), `${context}: hidden again`).toBe('0');

            // Keyboard: from the figure, Tab reaches each button in order; focus-within shows the toolbar.
            await figure.evaluate((el) => {
              el.setAttribute('tabindex', '-1');
              (el as HTMLElement).focus();
            });
            for (const tool of TOOLS) {
              await page.keyboard.press('Tab');
              await expect(toolbar.getByRole('button', { name: tool.name, exact: true }), `${context}: Tab to ${tool.name}`).toBeFocused();
            }
            await expect.poll(() => toolbar.evaluate((el) => getComputedStyle(el).opacity), `${context}: shown on focus`).toBe('1');
            await figure.evaluate((el) => el.removeAttribute('tabindex'));

            // Zoom steps and bounds.
            const svg = figure.locator('.mermaid-svg svg');
            const frame = figure.locator('.mermaid-svg');
            const base = (await svg.boundingBox())?.width ?? 0;
            expect(base, `${context}: drawn width`).toBeGreaterThan(0);
            for (const step of STEPS.slice(STEPS.indexOf(100) + 1)) {
              await expect(zoomIn, `${context}: zoom in enabled below 300`).toBeEnabled();
              await zoomIn.click();
              await expect(level, `${context}: step`).toHaveText(`${step} %`);
              const drawn = (await svg.boundingBox())?.width ?? 0;
              expect(Math.abs(drawn - (base * step) / 100), `${context}: ${step} % width ${drawn} vs ${base}`).toBeLessThanOrEqual(1.5);
            }
            await expect(zoomIn, `${context}: zoom in disabled at 300`).toBeDisabled();
            await zoomIn.click({ force: true });
            await expect(level).toHaveText('300 %');
            const scroll = await frame.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth, overflow: getComputedStyle(el).overflowX }));
            expect(scroll.scroll, `${context}: zoomed figure overflows its frame`).toBeGreaterThan(scroll.client);
            expect(['auto', 'scroll'], `${context}: frame scrolls`).toContain(scroll.overflow);
            expect(await pageScrollsSideways(page), `${context}: page scrolls sideways at 300 %`).toBe(false);
            await reset.click();
            await expect(level).toHaveText('100 %');
            for (const step of [...STEPS.slice(0, STEPS.indexOf(100))].reverse()) {
              await zoomOut.click();
              await expect(level, `${context}: step`).toHaveText(`${step} %`);
            }
            await expect(zoomOut, `${context}: zoom out disabled at 50`).toBeDisabled();
            await expect(zoomIn, `${context}: zoom in enabled at 50`).toBeEnabled();
            await reset.click();
            await expect(level).toHaveText('100 %');
            expect(Math.abs(((await svg.boundingBox())?.width ?? 0) - base), `${context}: reset width`).toBeLessThanOrEqual(1.5);

            // Full screen: a modal dialog over the whole viewport, the same toolbar, Esc closes, focus returns.
            await full.click();
            const dialog = page.getByRole('dialog');
            await expect(dialog, `${context}: dialog`).toBeVisible();
            // The dialog rises 8 px on entry (ui-dialog): measure once it has landed.
            await expect.poll(async () => Math.round((await dialog.boundingBox())?.y ?? -1), `${context}: dialog landed`).toBe(0);
            const box = await dialog.boundingBox();
            const viewport = page.viewportSize() ?? { width, height: 900 };
            expect(box, `${context}: dialog box`).not.toBeNull();
            if (box) {
              expect(Math.round(box.x), `${context}: dialog x`).toBe(0);
              expect(Math.round(box.y), `${context}: dialog y`).toBe(0);
              expect(Math.round(box.width), `${context}: dialog width`).toBe(viewport.width);
              expect(Math.round(box.height), `${context}: dialog height`).toBe(viewport.height);
            }
            expect(await dialog.evaluate((el) => el.matches(':modal')), `${context}: modal`).toBe(true);
            const dialogToolbar = toolbarOf(dialog);
            await expectToolbar(dialogToolbar, `${context} full screen`, true);
            await expect(dialog.locator('svg[viewBox] g.node').first(), `${context}: diagram in the dialog`).toBeVisible();
            await expect.poll(() => dialogToolbar.evaluate((el) => getComputedStyle(el).opacity), `${context}: dialog toolbar shown`).toBe('1');
            const inDialog = await dialog.locator('.diagram-dialog-frame').evaluate((frame) => {
              const svg = frame.querySelector('svg');
              const [, , vw = 0, vh = 0] = (svg?.getAttribute('viewBox') ?? '').split(/[\s,]+/).map(Number);
              const box = svg?.getBoundingClientRect();
              return { vw, vh, w: box?.width ?? 0, h: box?.height ?? 0, fw: frame.clientWidth, fh: frame.clientHeight };
            });
            expect(inDialog.w, `${context}: full screen width fits (${JSON.stringify(inDialog)})`).toBeLessThanOrEqual(inDialog.fw + 1);
            expect(inDialog.h, `${context}: full screen height fits`).toBeLessThanOrEqual(inDialog.fh + 1);
            expect(inDialog.w, `${context}: full screen not upscaled`).toBeLessThanOrEqual(inDialog.vw + 1);
            expect(Math.min(Math.abs(inDialog.fw - inDialog.w), Math.abs(inDialog.fh - inDialog.h), Math.abs(inDialog.vw - inDialog.w)), `${context}: full screen fitted (one bound tight)`).toBeLessThanOrEqual(1.5);
            await dialogToolbar.getByRole('button', { name: 'Zoom in', exact: true }).click();
            await expect(dialogToolbar.locator('[data-zoom-level]')).toHaveText('125 %');
            expect(await pageScrollsSideways(page), `${context}: page scrolls sideways in full screen`).toBe(false);
            await page.keyboard.press('Escape');
            await expect(dialog, `${context}: Esc closes`).toBeHidden();
            await expect(full, `${context}: focus returns to Full screen`).toBeFocused();

            // The exit button closes too.
            await full.click();
            await expect(dialog).toBeVisible();
            await dialogToolbar.getByRole('button', { name: 'Exit full screen', exact: true }).click();
            await expect(dialog, `${context}: Exit full screen closes`).toBeHidden();
            await expect(full, `${context}: focus returns after exit`).toBeFocused();
            expect(await pageScrollsSideways(page), `${context}: page scrolls sideways`).toBe(false);
          }
        });
      });
    }
  }

  test.describe('coarse pointer', () => {
    test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

    for (const theme of THEMES) {
      test(`the toolbar always shows with a coarse pointer (${theme})`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: theme });
        for (const target of PAGES) {
          const context = `${target.name} ${theme} coarse`;
          const figure = await openFigure(page, target);
          expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches), `${context}: coarse pointer`).toBe(true);
          const toolbar = toolbarOf(figure);
          await expectToolbar(toolbar, context);
          await expect.poll(() => toolbar.evaluate((el) => getComputedStyle(el).opacity), `${context}: always shown`).toBe('1');
          for (const tool of TOOLS) {
            const target = await toolbar.getByRole('button', { name: tool.name, exact: true }).boundingBox();
            expect(Math.min(target?.width ?? 0, target?.height ?? 0), `${context}: ${tool.name} hit area`).toBeGreaterThanOrEqual(44);
          }
        }
      });
    }
  });
});

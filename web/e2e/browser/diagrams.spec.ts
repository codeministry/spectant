/**
 * ISC-154: every mermaid diagram `ui-doc-prose` draws carries the anatomy of the Help page's workflow figures
 * (`features/help/workflow-figure.*`), in both themes (spec 024, T77).
 *
 *   bun run test:browser -- diagrams
 *
 * Three pages of the stub API, each with a flowchart drawn client-side: the Tech page's architecture tab (harbor
 * `specs/tech.md`), the Docs plan tab of harbor 002 (two subgraphs, so clusters), and the idea page of
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
  { name: 'tech', url: '/w/harbor/tech/architecture', scope: 'app-tech-docs-tab' },
  { name: 'docs', url: '/w/harbor/s/002/plan', scope: 'app-docs-tab[data-doc="plan"]' },
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

      test(`mermaid figures on tech, docs and idea carry the help figure anatomy (${theme})`, async ({ page }) => {
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

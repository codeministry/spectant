/**
 * Spec 066 · helpers of the overview grid's browser probes (T8): five workspaces on `/` through `page.route`, and the
 * measurement of each workspace tile and the tops of its four blocks, grouped by row.
 *
 *   await fiveWorkspaces(page, { waits: [null, 0, 1, 3, 16] });   // harbor as served, four copies with 0, 1, 3, 16
 *   await openOverview(page, 5);
 *   for (const row of byRow(await tileMetrics(page))) …
 *
 * The routes answer 200 without an ETag and forward no `If-None-Match`, so ApiClient's ETag cache never turns an
 * answer into a 304 the route did not see. The tile hooks are the ones of the spec's hook contract:
 * `[data-ui="workspace-column"]` holding `[data-tile-block="head|preview|list|kpi"]` in that DOM order.
 */
import type { Page, Request, Route } from '@playwright/test';

import { expect } from '../fixtures';
import { WAITS_HEADER } from '../stub-api';

/** The four blocks of a tile, in DOM order. */
export const TILE_BLOCKS = ['head', 'preview', 'list', 'kpi'] as const;
export type TileBlock = (typeof TILE_BLOCKS)[number];

/** Rows and blocks align within this many CSS pixels (ISC-516). */
export const ROW_TOLERANCE = 1;

/** The slugs of the four copies `fiveWorkspaces` adds after harbor. */
export const COPY_SLUGS = ['ws-a', 'ws-b', 'ws-c', 'ws-d'] as const;
export type CopySlug = (typeof COPY_SLUGS)[number];
/** The five slugs `fiveWorkspaces` lists, in list order. */
export const FIVE_SLUGS = ['harbor', ...COPY_SLUGS] as const;

export interface FiveWorkspacesOptions {
  /**
   * The number of waiting entries (`guidance.waits`) per workspace, in list order (harbor, ws-a … ws-d); `null` keeps
   * harbor's as served. Fewer than served slices them, more repeats them with their own refs. Default: harbor as served,
   * then 0, 1, 3 and 16.
   */
  readonly waits?: ReadonlyArray<number | null>;
  /** Keep the "In Arbeit" entries (the specs' held locks) the harbor answer carries. Default: true. */
  readonly working?: boolean;
  /** Which workspaces carry a stored screenshot, in list order. Default: none. */
  readonly screenshots?: readonly boolean[];
}

const DEFAULT_WAITS: ReadonlyArray<number | null> = [null, 0, 1, 3, 16];
const JSON_TYPE = 'application/json; charset=utf-8';
/** A 1×1 PNG, served as every copy's stored screenshot. */
const PIXEL_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mN8sP7/fwAI3wN4M2bQCQAAAABJRU5ErkJggg==', 'base64');

type Loose = Record<string, unknown>;
const isLoose = (value: unknown): value is Loose => typeof value === 'object' && value !== null && !Array.isArray(value);

const screenshotUrl = (slug: string): string => `/api/workspaces/${slug}/images/screenshot?v=066`;

/** The request's headers without the ETag revalidation and without the waits variant, so harbor is always listed. */
function forwardHeaders(request: Request): Record<string, string> {
  const dropped = new Set(['if-none-match', WAITS_HEADER.toLowerCase()]);
  return Object.fromEntries(Object.entries(request.headers()).filter(([name]) => !dropped.has(name)));
}

/** The stub's own answer for `path` (same origin as `request`), parsed, fetched with the forwarded headers. */
async function stubJson(route: Route, path: string): Promise<unknown> {
  const url = new URL(path, route.request().url()).toString();
  const answer = await route.fetch({ url, method: 'GET', headers: forwardHeaders(route.request()) });
  expect(answer.status(), `stub ${path}`).toBe(200);
  return answer.json();
}

const fulfilJson = (route: Route, body: unknown): Promise<void> =>
  route.fulfill({ status: 200, headers: { 'content-type': JSON_TYPE, 'cache-control': 'no-store' }, body: JSON.stringify(body) });

/** `n` waiting entries cut from or repeated out of `served`; a repeat carries its own ref so every row is distinct. */
export function waitsOf(served: readonly unknown[], n: number): unknown[] {
  if (served.length === 0) return [];
  return Array.from({ length: n }, (_, i) => {
    const entry = served[i % served.length];
    const round = Math.floor(i / served.length);
    if (round === 0 || !isLoose(entry)) return entry;
    const title = typeof entry['title'] === 'string' ? entry['title'] : '';
    return { ...entry, item: 'task', ref: `T${String(900 + i)}`, title: `${title} (${String(round + 1)})` };
  });
}

/** Harbor's dashboard body with `waits` waiting entries (null: as served) and, unless `working`, no held locks. */
function shapedDashboard(body: unknown, waits: number | null, working: boolean): unknown {
  if (!isLoose(body)) return body;
  const out: Loose = { ...body };
  const guidance = body['guidance'];
  if (waits !== null && isLoose(guidance)) {
    const served = Array.isArray(guidance['waits']) ? (guidance['waits'] as unknown[]) : [];
    out['guidance'] = { ...guidance, waits: waitsOf(served, waits) };
  }
  if (!working && Array.isArray(body['specs'])) {
    out['specs'] = (body['specs'] as unknown[]).map((row) => (isLoose(row) ? { ...row, taken: [] } : row));
  }
  return out;
}

/**
 * Routes `/` to five readable workspaces: harbor and the copies `ws-a` … `ws-d` (their own slug and name), each copy's
 * dashboard harbor's answer with its own number of waiting entries, every other workspace route of a copy forwarded to
 * harbor's. Call before `page.goto('/')`. Honours the context's stub headers (`X-Spectant-Stub-Locks` and the like)
 * except `X-Spectant-Stub-Waits`, which would drop harbor from the list.
 */
export async function fiveWorkspaces(page: Page, opts: FiveWorkspacesOptions = {}): Promise<void> {
  const waits = opts.waits ?? DEFAULT_WAITS;
  const working = opts.working ?? true;
  const shots = opts.screenshots ?? [];
  const indexOf = (slug: string): number => FIVE_SLUGS.indexOf(slug as (typeof FIVE_SLUGS)[number]);

  await page.route(/\/api\/workspaces(\?.*)?$/, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const list = await stubJson(route, '/api/workspaces');
    const entries: unknown[] = Array.isArray(list) ? (list as unknown[]) : [];
    const harbor = entries.find((entry) => isLoose(entry) && entry['slug'] === 'harbor');
    expect(isLoose(harbor), 'harbor in the stub list').toBe(true);
    const base = harbor as Loose;
    const images = isLoose(base['images']) ? base['images'] : { logo: null, screenshot: null };
    const five = FIVE_SLUGS.map((slug, i) => ({
      ...base,
      slug,
      name: slug,
      pathTail: slug === 'harbor' ? base['pathTail'] : `code/${slug}`,
      images: { ...images, screenshot: shots[i] === true ? screenshotUrl(slug) : null },
    }));
    return fulfilJson(route, five);
  });

  await page.route(/\/api\/workspaces\/(harbor|ws-[a-d])\/(.+)$/, async (route) => {
    const url = new URL(route.request().url());
    const [, slug = '', rest = ''] = /\/api\/workspaces\/([^/]+)\/(.+)$/.exec(url.pathname) ?? [];
    const i = indexOf(slug);
    if (rest.startsWith('images/screenshot')) {
      return route.fulfill({ status: 200, headers: { 'content-type': 'image/png', 'cache-control': 'no-store' }, body: PIXEL_PNG });
    }
    if (rest === 'dashboard' && route.request().method() === 'GET') {
      const body = await stubJson(route, '/api/workspaces/harbor/dashboard');
      return fulfilJson(route, shapedDashboard(body, waits[i] ?? null, working));
    }
    if (slug === 'harbor') return route.fallback();
    url.pathname = `/api/workspaces/harbor/${rest}`;
    return route.fallback({ url: url.toString(), headers: forwardHeaders(route.request()) });
  });
}

/** Opens `/` and waits until `count` tiles are rendered and none is still loading. */
export async function openOverview(page: Page, count?: number): Promise<void> {
  await page.goto('/');
  const tiles = page.locator('[data-ui="workspace-column"]');
  await expect(tiles.first()).toBeVisible();
  if (count !== undefined) await expect(tiles).toHaveCount(count);
  await expect(page.locator('[data-ui="workspace-column"][aria-busy="true"]')).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
}

export interface TileMetric {
  readonly slug: string;
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
  /** The top of each block of the hook contract; null when the tile carries no such block. */
  readonly blocks: Readonly<Record<TileBlock, number | null>>;
}

/** Every workspace tile on the page with its box and the top of each of its four blocks, in DOM order. */
export async function tileMetrics(page: Page): Promise<TileMetric[]> {
  return page.evaluate((names) => {
    return [...document.querySelectorAll<HTMLElement>('[data-ui="workspace-column"]')].map((tile) => {
      const r = tile.getBoundingClientRect();
      const blocks: Record<string, number | null> = {};
      for (const name of names) {
        const block = tile.querySelector(`[data-tile-block="${name}"]`);
        blocks[name] = block === null ? null : block.getBoundingClientRect().top;
      }
      return { slug: tile.dataset['ws'] ?? '', top: r.top, left: r.left, width: r.width, height: r.height, blocks };
    });
  }, TILE_BLOCKS as readonly string[]) as Promise<TileMetric[]>;
}

/** The tiles grouped into rows by their top (within `ROW_TOLERANCE`), rows top to bottom, tiles left to right. */
export function byRow(metrics: readonly TileMetric[]): TileMetric[][] {
  const rows: TileMetric[][] = [];
  for (const tile of [...metrics].sort((a, b) => a.top - b.top || a.left - b.left)) {
    const row = rows.find((r) => Math.abs((r[0]?.top ?? Number.NaN) - tile.top) <= ROW_TOLERANCE);
    if (row) row.push(tile);
    else rows.push([tile]);
  }
  return rows.map((row) => row.sort((a, b) => a.left - b.left));
}

/** Max minus min; 0 for an empty list. */
export const spread = (values: readonly number[]): number => (values.length === 0 ? 0 : Math.max(...values) - Math.min(...values));

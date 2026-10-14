#!/usr/bin/env bun
/**
 * extract-prototype — ISC-145 (spec 024): the prototype reference the parity work measures the app against.
 *
 * Usage: bun scripts/extract-prototype.ts [--root DIR] [--prototype DIR] [--out FILE]   (writes the fixture)
 *        bun scripts/extract-prototype.ts --check [--root DIR] [--prototype DIR] [--out FILE]
 *
 * The prototype is private, untracked design material at `specs/001-app-skeleton/.design/prototype/spectant-ui/`
 * (or `specs/archive/001-app-skeleton/…` once spec 001 is archived; the active folder wins) below the root (default: the repository this script lives in; `--prototype` names another directory, resolved
 * against the working directory). Without it — no `styles.css` there — the script prints `sources absent` and exits
 * 0, like `scripts/check-coverage.ts`. It never copies text of the prototype into the fixture: only custom-property
 * values, icon keys, Lucide names, scores and computed style measurements, and no path outside the repository.
 *
 * Three parts, each read from the prototype:
 *
 *   tokens      the custom properties (`--name: value;`) of the three token blocks of `styles.css`: `:root`,
 *               `[data-theme="spec-light"]`, `[data-theme="spec-dark"]` (the first rule with exactly that selector).
 *   icons       the icon tables of the prototype scripts: every object entry `key: '<path …/>…'` whose value is SVG
 *               child markup (`P` in app.js, `MORE` in pages.js, `IC` in assistant.js), and every
 *               `const key = \`<svg …>…</svg>\`` without interpolation (board.js). Per key a Lucide name is proposed
 *               from the pinned `lucide-static` (web/node_modules): name score = token Dice of the kebab-cased key
 *               against every icon file name (alias files, which draw exactly what a canonical icon draws, count
 *               for that canonical name), path score = character-trigram Dice of the order-independent normalised
 *               child markup. The prototype draws an older Lucide, so paths rarely match exactly; the proposal is
 *               the argmax of score = 1 for an identical drawing, else (name + path) / 2.
 *   primitives  computed styles of the prototype primitives, measured with the pinned Playwright (web's
 *               `@playwright/test`, its installed Chromium) on a harness page that loads only the prototype
 *               `styles.css` plus an @font-face override pointing at the local woff2 in `web/public/fonts/`. Every
 *               request is answered by a route from disk or aborted; nothing leaves the machine. The harness
 *               content is placeholder text of this script, never prototype text. Both themes via `data-theme`.
 *               Lengths are rounded to whole px (letter-spacing to 0.01px), colours written as hex.
 *
 * Fixture shape (`--out`, default `web/tests/fixtures/prototype-reference.json`; keys sorted at every level):
 *
 *   {
 *     "lucide": "<pinned lucide-static version>",
 *     "tokens": { "root": {name: value}, "light": {name: value}, "dark": {name: value} },
 *     "icons": { key: { "source": "<file basename>", "lucide": "<canonical name>", "score": 0..1,
 *                       "name": 0..1, "path": 0..1, "exact": bool, "alias"?: "<file name that matched>",
 *                       "nearest"?: "<icon drawing closest, when not the proposal>", "nearestPath"?: 0..1 } },
 *     "primitives": { name: { "light": {css-property: value}, "dark": {css-property: value} } }
 *   }
 *
 * --check extracts afresh and compares with the file at `--out`: exit 0 when identical, 1 when it differs (the
 * differing top-level parts are named) or is missing. `sources absent` and exit 0 when the prototype is missing.
 * Exit 2 on a usage error or when the measurement cannot run.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, normalize, resolve, sep } from 'node:path';

const PROTOTYPE = 'specs/001-app-skeleton/.design/prototype/spectant-ui';
// Once spec 001 is archived, the prototype moves one level down with its folder.
const ARCHIVED_PROTOTYPE = 'specs/archive/001-app-skeleton/.design/prototype/spectant-ui';
const OUT = 'web/tests/fixtures/prototype-reference.json';
const LUCIDE = 'web/node_modules/lucide-static';
const PLAYWRIGHT = 'web/node_modules/@playwright/test/index.mjs';
const FONTS = 'web/public/fonts';
const ORIGIN = 'http://prototype.invalid';
/** Below this combined score a Lucide proposal is reported as low confidence. */
export const CONFIDENCE = 0.6;

export type TokenBlocks = { root: Record<string, string>; light: Record<string, string>; dark: Record<string, string> };
export type IconProposal = {
  source: string;
  lucide: string;
  score: number;
  name: number;
  path: number;
  exact: boolean;
  alias?: string;
  nearest?: string;
  nearestPath?: number;
};
export type Measurement = Record<string, string>;
export type Fixture = {
  lucide: string;
  tokens: TokenBlocks;
  icons: Record<string, IconProposal>;
  primitives: Record<string, { light: Measurement; dark: Measurement }>;
};

function isFile(path: string): boolean {
  return existsSync(path) && statSync(path).isFile();
}

const round = (n: number, places = 2): number => Math.round(n * 10 ** places) / 10 ** places;

// ---------------------------------------------------------------------------------------------------------------
// T1 · tokens
// ---------------------------------------------------------------------------------------------------------------

/** The body of the first rule whose selector is exactly `selector` (at a line start), braces matched. */
export function ruleBody(css: string, selector: string): string | undefined {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const head = new RegExp(`^${escaped}\\s*\\{`, 'm').exec(css);
  if (!head) return undefined;
  let depth = 1;
  const start = head.index + head[0].length;
  for (let i = start; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) return css.slice(start, i);
  }
  return undefined;
}

export function customProperties(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of body.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    out[m[1] ?? ''] = (m[2] ?? '').trim().replace(/\s+/g, ' ');
  }
  return out;
}

export function readTokens(css: string): TokenBlocks {
  return {
    root: customProperties(ruleBody(css, ':root') ?? ''),
    light: customProperties(ruleBody(css, '[data-theme="spec-light"]') ?? ''),
    dark: customProperties(ruleBody(css, '[data-theme="spec-dark"]') ?? ''),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// T2 · icons
// ---------------------------------------------------------------------------------------------------------------

type SvgNode = [string, Record<string, string>];

const ICON_FILES = ['app.js', 'assistant.js', 'board.js', 'identity.js', 'library.js', 'pages.js'];
const SHAPES = 'path|circle|rect|line|polyline|polygon|ellipse';

/** SVG child markup → nodes. */
export function parseNodes(markup: string): SvgNode[] {
  const nodes: SvgNode[] = [];
  for (const el of markup.matchAll(/<(\w+)((?:\s+[\w-]+\s*=\s*"[^"]*")*)\s*\/?>/g)) {
    const tag = el[1] ?? '';
    if (tag === 'svg') continue;
    const attrs: Record<string, string> = {};
    for (const a of (el[2] ?? '').matchAll(/([\w-]+)\s*=\s*"([^"]*)"/g)) attrs[a[1] ?? ''] = a[2] ?? '';
    nodes.push([tag, attrs]);
  }
  return nodes;
}

/** Icon tables of one prototype script: `key: '<shape …/>'` entries and interpolation-free `const key = \`<svg>\``. */
export function iconEntries(js: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const entry = new RegExp(`(?:^|[\\s,{])([A-Za-z_$][\\w$]*)\\s*:\\s*(?:'(<(?:${SHAPES})\\b[^']*)'|"(<(?:${SHAPES})\\b[^"]*)")`, 'gm');
  for (const m of js.matchAll(entry)) out.push([m[1] ?? '', m[2] ?? m[3] ?? '']);
  for (const m of js.matchAll(/const\s+([A-Za-z_$][\w$]*)\s*=\s*`<svg\b[^>]*>([^`]*?)<\/svg>`/g)) {
    if (!(m[2] ?? '').includes('${')) out.push([m[1] ?? '', m[2] ?? '']);
  }
  return out;
}

const num = (s: string): string => s.replace(/-?\d*\.?\d+/g, (n) => String(round(Number(n), 2)));

/** Order-independent normalised signature of an icon's children. */
export function signature(nodes: SvgNode[]): string {
  return nodes
    .map(([tag, attrs]) => `${tag}(${Object.keys(attrs).sort().map((k) => `${k}=${num(attrs[k] ?? '')}`).join(' ')})`)
    .sort()
    .join(';');
}

function trigrams(s: string): Map<string, number> {
  const out = new Map<string, number>();
  for (let i = 0; i + 3 <= s.length; i++) {
    const g = s.slice(i, i + 3);
    out.set(g, (out.get(g) ?? 0) + 1);
  }
  return out;
}

function dice(a: Map<string, number>, b: Map<string, number>): number {
  let shared = 0;
  let total = 0;
  for (const [g, n] of a) {
    shared += Math.min(n, b.get(g) ?? 0);
    total += n;
  }
  for (const n of b.values()) total += n;
  return total === 0 ? 0 : (2 * shared) / total;
}

export const kebab = (key: string): string => key.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

export function nameScore(key: string, file: string): number {
  const k = kebab(key);
  if (k === file) return 1;
  const a = new Set(k.split('-'));
  const b = new Set(file.split('-'));
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  return (2 * shared) / (a.size + b.size);
}

type LucideIcon = { name: string; files: string[]; sig: string; grams: Map<string, number> };

export function readLucide(dir: string): { version: string; icons: LucideIcon[] } {
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { version: string };
  const nodes = JSON.parse(readFileSync(join(dir, 'icon-nodes.json'), 'utf8')) as Record<string, SvgNode[]>;
  const files = new Map<string, string[]>(Object.keys(nodes).map((n) => [n, [n]]));
  // An alias file (an older name kept by lucide-static) draws exactly what its canonical icon draws.
  const bySig = new Map(Object.entries(nodes).map(([n, v]) => [signature(v), n]));
  for (const f of readdirSync(join(dir, 'icons')).filter((x) => x.endsWith('.svg')).sort()) {
    const name = f.slice(0, -4);
    if (files.has(name)) continue;
    const canonical = bySig.get(signature(parseNodes(readFileSync(join(dir, 'icons', f), 'utf8'))));
    if (canonical) files.get(canonical)?.push(name);
  }
  const icons = Object.entries(nodes).map(([name, n]) => {
    const sig = signature(n);
    return { name, files: files.get(name) ?? [name], sig, grams: trigrams(sig) };
  });
  return { version: pkg.version, icons };
}

export function proposeIcon(key: string, markup: string, lucide: LucideIcon[]): Omit<IconProposal, 'source'> {
  const sig = signature(parseNodes(markup));
  const grams = trigrams(sig);
  let best: Omit<IconProposal, 'source'> = { lucide: '', score: -1, name: 0, path: 0, exact: false };
  let near = { lucide: '', path: -1 };
  for (const icon of lucide) {
    let name = 0;
    let via = icon.name;
    for (const f of icon.files) {
      const s = nameScore(key, f);
      if (s > name) [name, via] = [s, f];
    }
    const exact = icon.sig === sig;
    const path = exact ? 1 : dice(grams, icon.grams);
    if (path > near.path) near = { lucide: icon.name, path };
    // An identical drawing is the strongest evidence; otherwise name and path weigh equally.
    const score = exact ? 1 : (name + path) / 2;
    if (score > best.score) {
      best = { lucide: icon.name, score, name, path, exact };
      if (via !== icon.name && name > 0) best.alias = via;
    }
  }
  if (near.lucide !== best.lucide && near.path > best.path) [best.nearest, best.nearestPath] = [near.lucide, round(near.path)];
  return { ...best, score: round(best.score), name: round(best.name), path: round(best.path) };
}

export function readIcons(protoDir: string, lucide: LucideIcon[]): Record<string, IconProposal> {
  const out: Record<string, IconProposal> = {};
  const seen = new Map<string, string>();
  for (const file of ICON_FILES) {
    const path = join(protoDir, file);
    if (!isFile(path)) continue;
    for (const [key, markup] of iconEntries(readFileSync(path, 'utf8'))) {
      const sig = signature(parseNodes(markup));
      if (seen.get(key) === sig) continue;
      const id = seen.has(key) ? `${key}@${file}` : key;
      seen.set(key, sig);
      out[id] = { source: file, ...proposeIcon(key, markup, lucide) };
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// T3 · primitives
// ---------------------------------------------------------------------------------------------------------------

/** A primitive: harness markup, the element measured (`[data-m]` inside it), an optional pseudo-element. */
type Primitive = { name: string; html: string; pseudo?: '::before' | '::after'; width?: boolean };

const ICON = '<svg class="icon" viewBox="0 0 24 24"></svg>';
const chip = (cls: string): string => `<span data-m data-ui="chip" class="${cls}">${ICON}Ag</span>`;
const CHIPS = ['', 'building', 'scoping', 'done', 'stale', 'warn', 'plain', 'take', 'mono-chip', 'st-closed', 'st-takeable', 'st-taken', 'st-blocked', 'st-concerns', 'st-question', 'st-fail'];
const KPI = (mark: string): string =>
  `<div data-ui="kpi-band" style="width:960px"><div class="card edge glow" data-ui="kpi-tile"${mark === 'tile' ? ' data-m' : ''}>` +
  `<div class="eyebrow"${mark === 'eyebrow' ? ' data-m' : ''}>Ag</div>` +
  `<div class="val"${mark === 'val' ? ' data-m' : ''}>12<small${mark === 'small' ? ' data-m' : ''}>/3</small></div>` +
  `<div class="foot">Ag</div></div></div>`;
const SEG = (pressed: boolean): string =>
  `<div class="seg" role="group"><button aria-pressed="true"${pressed ? ' data-m' : ''}>Ag</button><button aria-pressed="false"${pressed ? '' : ' data-m'}>Ag</button></div>`;

export const PRIMITIVES: Primitive[] = [
  { name: 'card', html: '<div data-m class="card">Ag</div>' },
  { name: 'card.edge', html: '<div data-m class="card edge">Ag</div>' },
  { name: 'card.edge::before', html: '<div data-m class="card edge">Ag</div>', pseudo: '::before', width: true },
  { name: 'card.glow', html: '<div data-m class="card glow">Ag</div>' },
  { name: 'card.glow::after', html: '<div data-m class="card glow">Ag</div>', pseudo: '::after', width: true },
  ...CHIPS.map((c) => ({ name: c ? `chip.${c}` : 'chip', html: chip(c) })),
  { name: 'chip .icon', html: `<span data-ui="chip" class="building"><svg data-m class="icon" viewBox="0 0 24 24"></svg>Ag</span>`, width: true },
  { name: 'command-chip', html: `<span data-m data-ui="command-chip"><code>ab</code><button class="copy">${ICON}</button></span>` },
  { name: 'pill', html: '<span data-m class="pill">Ag</span>' },
  { name: 'badge', html: '<span data-m class="count-badge">3</span>', width: true },
  { name: 'seam-badge', html: '<span data-m data-ui="seam-badge">Ag</span>' },
  { name: 'seam-badge.seam', html: '<span data-m data-ui="seam-badge" class="seam">Ag</span>' },
  { name: 'kpi-tile', html: KPI('tile') },
  { name: 'kpi-tile .eyebrow', html: KPI('eyebrow') },
  { name: 'kpi-tile .val', html: KPI('val') },
  { name: 'kpi-tile .val small', html: KPI('small') },
  { name: 'glyph', html: '<span data-m class="glyph">o</span>', width: true },
  { name: 'glyph.take', html: '<span data-m class="glyph take">o</span>', width: true },
  { name: 'glyph.taken', html: '<span data-m class="glyph taken">o</span>', width: true },
  { name: 'glyph.closed', html: '<span data-m class="glyph closed">o</span>', width: true },
  { name: 'glyph .icon', html: `<span class="glyph taken"><svg data-m class="icon" viewBox="0 0 24 24"></svg></span>`, width: true },
  { name: 'seg', html: `<div data-m class="seg" role="group"><button aria-pressed="true">Ag</button><button aria-pressed="false">Ag</button></div>` },
  { name: 'seg button', html: SEG(false) },
  { name: 'seg button[aria-pressed]', html: SEG(true) },
  { name: 'kbd', html: '<kbd data-m data-ui="kbd">K</kbd>', width: true },
  { name: 'section-head', html: '<h2 data-m class="section-head">Ag</h2>' },
];

const PROPS = [
  'height', 'min-width', 'padding', 'gap', 'border-width', 'border-style', 'border-color', 'border-radius', 'box-shadow',
  'background-color', 'background-image', 'color', 'opacity', 'font-family', 'font-size', 'font-weight', 'line-height',
  'letter-spacing', 'text-transform',
];

function hex(r: string, g: string, b: string, a?: string): string {
  const h = (n: number): string => Math.round(n).toString(16).padStart(2, '0');
  const alpha = a === undefined ? '' : Number(a) >= 1 ? '' : h(Number(a) * 255);
  return `#${h(Number(r))}${h(Number(g))}${h(Number(b))}${alpha}`;
}

/** Whole px, letter-spacing to 0.01px, rgb()/rgba() as hex, other decimals to three places. */
export function normaliseValue(prop: string, value: string): string {
  let v = value.replace(/rgba?\(\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\s*\)/g, (_m, r: string, g: string, b: string, a?: string) =>
    hex(r, g, b, a),
  );
  v = v.replace(/(-?\d*\.?\d+)px/g, (_m, n: string) => `${prop === 'letter-spacing' ? round(Number(n), 2) : Math.round(Number(n))}px`);
  return v.replace(/(?<![#\w])(-?\d+\.\d{4,})/g, (_m, n: string) => String(round(Number(n), 3)));
}

type Route = {
  request(): { url(): string };
  fulfill(o: { status: number; contentType: string; body: Buffer | string }): Promise<void>;
  abort(): Promise<void>;
};
type Page = {
  route(url: string, handler: (route: Route) => Promise<void>): Promise<void>;
  goto(url: string): Promise<unknown>;
  evaluate(expression: string): Promise<unknown>;
};
type Browser = { newPage(o: { viewport: { width: number; height: number } }): Promise<Page>; close(): Promise<void> };
type PlaywrightModule = { chromium: { launch(o: { headless: boolean }): Promise<Browser> } };

const TYPES: Record<string, string> = { '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png' };

function harness(): string {
  const face = (family: string, file: string): string =>
    `@font-face{font-family:"${family}";src:url("/__fonts/${file}") format("woff2");font-weight:100 900;font-style:normal}`;
  const blocks = PRIMITIVES.map((p, i) => `<div data-p="${i}" style="margin:8px;width:640px">${p.html}</div>`).join('');
  return (
    '<!doctype html><html data-theme="spec-light"><head><meta charset="utf-8">' +
    '<link rel="stylesheet" href="/styles.css">' +
    `<style>${face('Manrope', 'manrope-variable.woff2')}${face('Sora', 'sora-variable.woff2')}${face('JetBrains Mono', 'jetbrains-mono-variable.woff2')}</style>` +
    `</head><body>${blocks}</body></html>`
  );
}

/** Runs in the page: computed styles of every primitive's `[data-m]` element (or its pseudo-element). */
function measureScript(): string {
  const spec = JSON.stringify(PRIMITIVES.map((p) => ({ pseudo: p.pseudo ?? null, width: p.width ?? false })));
  return `(() => {
    const spec = ${spec}; const props = ${JSON.stringify(PROPS)};
    return spec.map((p, i) => {
      const el = document.querySelector('[data-p="' + i + '"] [data-m]');
      if (!el) return null;
      const cs = getComputedStyle(el, p.pseudo);
      const out = {};
      for (const prop of p.width ? props.concat('width') : props) out[prop] = cs.getPropertyValue(prop);
      return out;
    });
  })()`;
}

export async function measure(root: string, protoDir: string): Promise<Fixture['primitives']> {
  const pw = (await import(join(root, PLAYWRIGHT))) as PlaywrightModule;
  const browser = await pw.chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== ORIGIN) return route.abort();
      if (url.pathname === '/__harness.html') return route.fulfill({ status: 200, contentType: 'text/html', body: harness() });
      const [base, rel] = url.pathname.startsWith('/__fonts/')
        ? [join(root, FONTS), url.pathname.slice('/__fonts/'.length)]
        : [protoDir, url.pathname.slice(1)];
      const file = normalize(join(base, decodeURIComponent(rel)));
      if (!file.startsWith(base + sep) || !isFile(file)) return route.abort();
      const ext = /\.\w+$/.exec(file)?.[0] ?? '';
      return route.fulfill({ status: 200, contentType: TYPES[ext] ?? 'application/octet-stream', body: readFileSync(file) });
    });
    await page.goto(`${ORIGIN}/__harness.html`);
    await page.evaluate('document.fonts.ready.then(() => true)');
    const out: Fixture['primitives'] = {};
    for (const theme of ['light', 'dark'] as const) {
      await page.evaluate(`document.documentElement.dataset.theme = "spec-${theme}"`);
      const rows = (await page.evaluate(measureScript())) as Array<Record<string, string> | null>;
      PRIMITIVES.forEach((p, i) => {
        const row = rows[i];
        if (!row) throw new Error(`primitive ${p.name} not rendered`);
        const m: Measurement = {};
        for (const [prop, value] of Object.entries(row)) m[prop] = normaliseValue(prop, value);
        (out[p.name] ??= { light: {}, dark: {} })[theme] = m;
      });
    }
    return out;
  } finally {
    await browser.close();
  }
}

// ---------------------------------------------------------------------------------------------------------------
// T4 · fixture
// ---------------------------------------------------------------------------------------------------------------

/** Keys sorted at every level, arrays kept in order. */
export function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(obj).sort().map((k) => [k, stable(obj[k])]));
  }
  return value;
}

export const serialise = (fixture: Fixture): string => `${JSON.stringify(stable(fixture), null, 2)}\n`;

export async function extract(root: string, protoDir: string): Promise<Fixture> {
  const lucide = readLucide(join(root, LUCIDE));
  return {
    lucide: lucide.version,
    tokens: readTokens(readFileSync(join(protoDir, 'styles.css'), 'utf8')),
    icons: readIcons(protoDir, lucide.icons),
    primitives: await measure(root, protoDir),
  };
}

function summary(f: Fixture): string {
  const low = Object.values(f.icons).filter((i) => i.score < CONFIDENCE).length;
  const exact = Object.values(f.icons).filter((i) => i.exact).length;
  const t = f.tokens;
  return (
    `tokens: root ${Object.keys(t.root).length}, light ${Object.keys(t.light).length}, dark ${Object.keys(t.dark).length}\n` +
    `icons: ${Object.keys(f.icons).length} (${exact} exact, ${low} below ${CONFIDENCE})\n` +
    `primitives: ${Object.keys(f.primitives).length} x 2 themes`
  );
}

// ---------------------------------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------------------------------

const USAGE = `Usage: bun scripts/extract-prototype.ts [--check] [--root DIR] [--prototype DIR] [--out FILE]

Reads the prototype (${PROTOTYPE} below the root) and writes its token, icon and primitive reference to
${OUT}; with --check, compares a fresh extraction with that file instead.
Prints "sources absent" and exits 0 without the prototype. Exit 0 clean, 1 when --check differs, 2 on a usage error.`;

function usageError(message: string): number {
  console.error(`extract-prototype: ${message}`);
  console.error(USAGE);
  return 2;
}

export async function main(argv: string[]): Promise<number> {
  let root = resolve(import.meta.dir, '..');
  let proto: string | undefined;
  let out: string | undefined;
  let check = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      console.log(USAGE);
      return 0;
    }
    if (arg === '--check') check = true;
    else if (arg === '--root' || arg === '--prototype' || arg === '--out') {
      const value = argv[++i];
      if (value === undefined) return usageError(`${arg} needs a path`);
      if (arg === '--root') root = resolve(value);
      else if (arg === '--prototype') proto = resolve(value);
      else out = resolve(value);
    } else return usageError(`unknown argument ${arg ?? ''}`);
  }
  const protoDir =
    proto ?? [PROTOTYPE, ARCHIVED_PROTOTYPE].map((p) => join(root, p)).find((p) => isFile(join(p, 'styles.css'))) ?? join(root, PROTOTYPE);
  if (!isFile(join(protoDir, 'styles.css'))) {
    console.log('sources absent');
    return 0;
  }
  const outFile = out ?? join(root, OUT);
  let fixture: Fixture;
  try {
    fixture = await extract(root, protoDir);
  } catch (e) {
    console.error(`extract-prototype: ${e instanceof Error ? e.message : String(e)}`);
    return 2;
  }
  const text = serialise(fixture);
  if (check) {
    const current = isFile(outFile) ? readFileSync(outFile, 'utf8') : undefined;
    if (current === text) {
      console.log(`${basename(outFile)}: up to date\n${summary(fixture)}`);
      return 0;
    }
    if (current === undefined) {
      console.log(`${basename(outFile)}: missing`);
      return 1;
    }
    const old = JSON.parse(current) as Record<string, unknown>;
    const fresh = JSON.parse(text) as Record<string, unknown>;
    const parts = Object.keys(fresh).filter((k) => JSON.stringify(old[k]) !== JSON.stringify(fresh[k]));
    console.log(`${basename(outFile)}: differs (${parts.join(', ') || 'formatting'})`);
    return 1;
  }
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, text);
  console.log(`${basename(outFile)}: written\n${summary(fixture)}`);
  return 0;
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));

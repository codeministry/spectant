// Generates `icons.ts` from the pinned `lucide-static` package (ISC-18.2). Build-time only: run with Bun
// (`bun run --cwd web icons:generate`); it is excluded from `tsconfig.app.json` and never shipped. The guard
// `web/tests/icons.test.ts` imports `generate()` and compares its output with the committed file byte for byte.
//
// For each name in `ICON_NAMES` it reads `lucide-static/icons/<name>.svg`, checks that the `<svg>` wrapper draws the
// way `ui-icon` draws (24 × 24 viewBox, 2 px round stroke in currentColor, no fill), drops the wrapper and the
// `class` / `xmlns` attributes, and keeps only the shape elements. A missing name, a foreign wrapper or any element
// other than a plain shape fails loudly; the output is sorted by name, so it does not depend on the list order.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ICON_NAMES } from './icon-names';

const WEB_DIR = join(import.meta.dir, '..', '..', '..', '..');
export const ICONS_PATH = join(import.meta.dir, 'icons.ts');

/** The wrapper attributes `ui-icon` hard-codes; an icon drawn with other values would render wrong. */
const WRAPPER: Readonly<Record<string, string>> = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  'stroke-width': '2',
  'stroke-linecap': 'round',
  'stroke-linejoin': 'round',
};
/** Wrapper attributes that are dropped: the renderer sets its own size, and class / xmlns carry nothing we need. */
const DROPPED = new Set(['class', 'xmlns', 'width', 'height']);
const SHAPE = /<(path|circle|rect|line|polyline|polygon|ellipse)\b([^<>]*?)\s*\/>/g;
const ATTR = /([\w:-]+)="([^"]*)"/g;

/** The installed `lucide-static` package directory, resolved from `web/` the way the package manager links it. */
export function lucideDir(): string {
  return dirname(Bun.resolveSync('lucide-static/package.json', WEB_DIR));
}

export function readLucideSvg(name: string): string {
  const file = join(lucideDir(), 'icons', `${name}.svg`);
  try {
    return readFileSync(file, 'utf8');
  } catch {
    throw new Error(`icon "${name}" does not exist in the pinned lucide-static (${file})`);
  }
}

const attrs = (text: string) => [...text.matchAll(ATTR)].map((m) => [m[1] ?? '', m[2] ?? ''] as const);

/** The shape elements inside the `<svg>` wrapper, without `class` / `xmlns`, one normalised element each. */
export function innerMarkup(name: string, svg: string): string {
  const fail = (why: string): never => {
    throw new Error(`icon "${name}": ${why}`);
  };
  const body = svg.replace(/<!--[\s\S]*?-->/g, '').trim();
  const open = /^<svg\b([^>]*)>([\s\S]*)<\/svg>$/.exec(body) ?? fail('not a single <svg> element');
  const wrapper = new Map(attrs(open[1] ?? ''));
  for (const [key, want] of Object.entries(WRAPPER)) {
    if (wrapper.get(key) !== want) fail(`wrapper ${key}="${wrapper.get(key) ?? ''}", expected "${want}"`);
  }
  for (const key of wrapper.keys()) {
    if (!(key in WRAPPER) && !DROPPED.has(key)) fail(`unexpected wrapper attribute ${key}`);
  }
  const inner = open[2] ?? '';
  if (inner.replace(SHAPE, '').trim() !== '') fail('contains something other than plain shape elements');
  const shapes = [...inner.matchAll(SHAPE)].map((m) => {
    const kept = attrs(m[2] ?? '').filter(([key]) => key !== 'class' && key !== 'xmlns');
    return `<${m[1] ?? ''}${kept.map(([key, value]) => ` ${key}="${value}"`).join('')}/>`;
  });
  if (shapes.length === 0) fail('has no shape elements');
  const markup = shapes.join('');
  if (/['\\\n]/.test(markup)) fail('markup would need escaping in a single-quoted string');
  return markup;
}

const key = (name: string) => (/^[a-z][a-z0-9]*$/.test(name) ? name : `'${name}'`);

/** The full `icons.ts` source for `names`, drawn from `read` (the pinned package by default). */
export function renderIconsModule(
  names: readonly string[],
  version: string,
  read: (name: string) => string = readLucideSvg,
): string {
  const sorted = [...names].sort();
  const duplicate = sorted.find((name, i) => sorted[i - 1] === name);
  if (duplicate !== undefined) throw new Error(`icon "${duplicate}" is listed twice in ICON_NAMES`);
  const entries = sorted.map((name) => `  ${key(name)}: '${innerMarkup(name, read(name))}',`);
  return [
    `// Generated from lucide-static ${version} by generate-icons.ts. Do not edit by hand:`,
    '// change icon-names.ts and run `bun run --cwd web icons:generate` (ISC-18.2).',
    '// Lucide icons: ISC License, Copyright (c) Lucide Contributors (https://lucide.dev).',
    '',
    'export type IconName =',
    ...sorted.map((name, i) => `  | '${name}'${i === sorted.length - 1 ? ';' : ''}`),
    '',
    '/** Inner SVG markup (shape elements only) of each icon, drawn by `ui-icon` in a 24 × 24 stroked wrapper. */',
    'export const ICONS: Record<IconName, string> = {',
    ...entries,
    '};',
    '',
  ].join('\n');
}

type PackageJson = { version?: string; devDependencies?: Record<string, string> };

/** Regenerates `icons.ts` in memory, after checking the installed package is the version `web/package.json` pins. */
export function generate(): string {
  const read = (path: string) => JSON.parse(readFileSync(path, 'utf8')) as PackageJson;
  const pinned = read(join(WEB_DIR, 'package.json')).devDependencies?.['lucide-static'];
  const installed = read(join(lucideDir(), 'package.json')).version;
  if (pinned === undefined || installed !== pinned) {
    throw new Error(`lucide-static: web/package.json pins ${pinned ?? 'nothing'}, installed is ${installed ?? 'nothing'}`);
  }
  return renderIconsModule(ICON_NAMES, installed);
}

if (import.meta.main) {
  writeFileSync(ICONS_PATH, generate());
  console.log(`wrote ${ICONS_PATH} (${ICON_NAMES.length} icons)`);
}

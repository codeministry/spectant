import { InjectionToken } from '@angular/core';
import type { ResolvedTheme } from '../../../core/theme.service';

/** The slice of the mermaid API the Docs tabs use. */
export interface MermaidApi {
  initialize(config: Record<string, unknown>): void;
  render(id: string, source: string): Promise<{ readonly svg: string }>;
}

/**
 * Loads the pinned `mermaid` package. A dynamic `import()` on purpose: mermaid and its diagram modules are several
 * hundred kB and must stay lazy chunks, fetched only when a Docs tab shows a diagram, never in the initial bundle
 * (`web/tests/docs-lazy-chunk.test.ts`). A token so a spec can hold the import open or hand in a fake.
 */
export const MERMAID_LOADER = new InjectionToken<() => Promise<MermaidApi>>('MERMAID_LOADER', {
  providedIn: 'root',
  factory: () => () => import('mermaid').then((module) => module.default as unknown as MermaidApi),
});

/** Token → mermaid theme variable. The tokens are OKLCH; mermaid's colour parser reads only hex / rgb / hsl. */
const THEME_TOKENS: Readonly<Record<string, string>> = {
  background: '--color-base-100',
  mainBkg: '--color-base-200',
  primaryColor: '--color-base-200',
  primaryTextColor: '--color-base-content',
  primaryBorderColor: '--line',
  secondaryColor: '--color-base-300',
  tertiaryColor: '--color-base-100',
  lineColor: '--muted-ink',
  textColor: '--color-base-content',
  nodeBorder: '--line',
  clusterBkg: '--color-base-100',
  clusterBorder: '--line',
  edgeLabelBackground: '--color-base-100',
  titleColor: '--color-base-content',
};

/**
 * Resolves each token to `#rrggbb` by painting one pixel: canvas converts any CSS colour (OKLCH included) to sRGB.
 * Returns `{}` where there is no 2D canvas (a DOM emulation); mermaid then keeps its base theme.
 */
export function themeVariables(host: Element): Record<string, string> {
  const canvas = host.ownerDocument.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  let context: CanvasRenderingContext2D | null = null;
  try {
    context = canvas.getContext('2d', { willReadFrequently: true });
  } catch {
    context = null;
  }
  if (!context) return {};
  const style = getComputedStyle(host);
  const variables: Record<string, string> = {};
  for (const [name, token] of Object.entries(THEME_TOKENS)) {
    const value = style.getPropertyValue(token).trim();
    if (!value) continue;
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = value;
    context.fillRect(0, 0, 1, 1);
    const [r = 0, g = 0, b = 0] = context.getImageData(0, 0, 1, 1).data;
    variables[name] = `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
  }
  return variables;
}

/** Mermaid's configuration for one theme: strict security (no HTML labels, no click handlers), never auto-start. */
export function mermaidConfig(theme: ResolvedTheme, variables: Record<string, string>): Record<string, unknown> {
  return {
    startOnLoad: false,
    securityLevel: 'strict',
    theme: 'base',
    darkMode: theme === 'dark',
    fontFamily: 'inherit',
    themeVariables: { ...variables, darkMode: theme === 'dark' },
  };
}

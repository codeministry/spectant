/**
 * The two environment switches of the Playwright layout, parsed once for the config and the fixtures.
 *
 * `E2E_SUITE` (`e2e` | `visual` | `browser`, unset = all) is set by `run.ts`; `E2E_THEME` (`light` | `dark`, default
 * `light`) is set by `run.ts` from `--theme <mode>` or directly in the environment.
 */
export const SUITES = ['e2e', 'visual', 'browser'] as const;
export type Suite = (typeof SUITES)[number];
export const THEMES = ['light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

export function oneOf<T extends string>(name: string, value: string | undefined, allowed: readonly T[]): T | undefined {
  if (value === undefined || value === '') return undefined;
  if ((allowed as readonly string[]).includes(value)) return value as T;
  throw new Error(`${name}=${value} is not one of ${allowed.join(', ')}`);
}

export const suite: Suite | undefined = oneOf('E2E_SUITE', process.env['E2E_SUITE'], SUITES);
export const theme: Theme = oneOf('E2E_THEME', process.env['E2E_THEME'], THEMES) ?? 'light';

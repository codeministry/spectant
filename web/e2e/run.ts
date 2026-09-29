/**
 * Turns the Test Strategy's command shapes into one `playwright test` call (T28). The `web/package.json` scripts
 * `e2e`, `test:visual`, `test:browser` and `test:e2e:webkit` call it; everything after `--` arrives here.
 *
 *   bun run e2e -- palette -g open                 → playwright test --project=chromium palette -g open
 *   bun run e2e -- --project webkit smoke          → playwright test --project=webkit smoke
 *   bun run test:visual -- dashboard               → playwright test --project=chromium -g dashboard      (E2E_SUITE=visual)
 *   bun run test:visual -- overview --theme dark   → playwright test --project=chromium -g overview       (E2E_THEME=dark)
 *   bun run test:browser -- contrast               → playwright test --project=chromium contrast          (E2E_SUITE=browser)
 *
 * Three rules, nothing else is rewritten:
 * 1. `--theme <light|dark>` is not a Playwright flag; it becomes `E2E_THEME`.
 * 2. Without an explicit `--project`, the chromium project runs (webkit is the smoke project, ISC-19.1); an explicit
 *    `--project <name>` is bound as `--project=<name>`, since Playwright's flag would swallow the next file filter.
 * 3. In the visual suite the leading bare words name `test.describe` groups of `visual.spec.ts` (`dashboard`,
 *    `overview`), so they become `-g`; in the other suites they stay file filters (`palette`, `contrast`).
 */
import { join } from 'node:path';

import { oneOf, SUITES, THEMES } from './env';

const WEB = join(import.meta.dir, '..');
const CONFIG = join(import.meta.dir, 'playwright.config.ts');

export type Invocation = { args: string[]; env: Record<string, string> };

export function translate(suite: string, argv: readonly string[]): Invocation {
  const env: Record<string, string> = { E2E_SUITE: oneOf('suite', suite, SUITES) ?? 'e2e' };
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? '';
    if (arg === '--theme' || arg.startsWith('--theme=')) {
      const value = arg === '--theme' ? argv[++i] : arg.slice('--theme='.length);
      env['E2E_THEME'] = oneOf('--theme', value ?? '', THEMES) ?? 'light';
    } else if (arg === '--project' && i + 1 < argv.length) {
      // Playwright's `--project` is variadic: `--project webkit smoke` would read `smoke` as a second project.
      rest.push(`--project=${argv[++i] ?? ''}`);
    } else {
      rest.push(arg);
    }
  }

  const args: string[] = [];
  if (!rest.some((a) => a === '--project' || a.startsWith('--project='))) args.push('--project=chromium');

  if (env['E2E_SUITE'] === 'visual') {
    const firstFlag = rest.findIndex((a) => a.startsWith('-'));
    const groups = firstFlag === -1 ? rest : rest.slice(0, firstFlag);
    const flags = firstFlag === -1 ? [] : rest.slice(firstFlag);
    if (groups.length > 0) args.push('-g', groups.length === 1 ? (groups[0] ?? '') : `(${groups.join('|')})`);
    args.push(...flags);
  } else {
    args.push(...rest);
  }
  return { args, env };
}

if (import.meta.main) {
  const [suite = 'e2e', ...argv] = process.argv.slice(2);
  const { args, env } = translate(suite, argv);
  const PATH = [join(WEB, 'node_modules', '.bin'), join(WEB, '..', 'node_modules', '.bin'), process.env['PATH']].join(':');
  const playwright = Bun.which('playwright', { PATH });
  if (playwright === null) {
    console.error('run: the playwright CLI is not installed; run `bun install --frozen-lockfile` at the repository root');
    process.exit(1);
  }
  const child = Bun.spawn([playwright, 'test', '--config', CONFIG, ...args], {
    cwd: WEB,
    env: { ...process.env, ...env },
    stdio: ['inherit', 'inherit', 'inherit'],
  });
  process.exit(await child.exited);
}

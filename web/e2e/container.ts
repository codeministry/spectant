/**
 * Runs a Playwright suite inside the pinned Linux container (T28). Baselines are recorded and compared only here.
 *
 *   bun web/e2e/container.ts <e2e|visual|browser> [args…]     same args as `bun run e2e` / `test:visual` / `test:browser`
 *   bun run test:visual:ci -- dashboard --theme dark
 *   bun run test:visual:ci -- -u                               record or update the baselines
 *
 * The repository is bind-mounted at /work; every workspace's `node_modules` and the Angular cache are masked with
 * anonymous volumes so the host's macOS binaries never reach Linux, and `bun install --frozen-lockfile` fills them
 * from a named cache volume. The platform is `linux/amd64` everywhere (Rosetta on Apple Silicon), because Chromium
 * on arm64 does not rasterise byte for byte like the amd64 CI runner; `E2E_PLATFORM` overrides it for a quick look.
 */
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..', '..');
const DOCKERFILE = join(import.meta.dir, 'Dockerfile');
const PLATFORM = process.env['E2E_PLATFORM'] ?? 'linux/amd64';

async function pinnedVersions(): Promise<{ image: string; pkg: string }> {
  const dockerfile = await Bun.file(DOCKERFILE).text();
  const image = /mcr\.microsoft\.com\/playwright:v(\d+\.\d+\.\d+)-/.exec(dockerfile)?.[1];
  const web = (await Bun.file(join(ROOT, 'web', 'package.json')).json()) as { devDependencies?: Record<string, string> };
  const pkg = web.devDependencies?.['@playwright/test'];
  if (image === undefined || pkg === undefined) throw new Error('container: cannot read the pinned Playwright versions');
  return { image, pkg };
}

async function docker(args: string[], stdin?: Blob): Promise<number> {
  const child = Bun.spawn(['docker', ...args], {
    cwd: ROOT,
    stdin: stdin ?? 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  });
  return child.exited;
}

if (import.meta.main) {
  const [suite, ...args] = process.argv.slice(2);
  if (suite !== 'e2e' && suite !== 'visual' && suite !== 'browser') {
    console.error('usage: bun web/e2e/container.ts <e2e|visual|browser> [args…]');
    process.exit(2);
  }

  const { image, pkg } = await pinnedVersions();
  if (image !== pkg) {
    console.error(`container: the image pins Playwright ${image} but web/package.json has @playwright/test ${pkg}`);
    process.exit(1);
  }
  const tag = `spectant-e2e:${image}`;

  // No build context: the Dockerfile copies nothing from the repository.
  const built = await docker(['build', '--quiet', '--platform', PLATFORM, '--tag', tag, '-'], Bun.file(DOCKERFILE));
  if (built !== 0) process.exit(built);

  const root = (await Bun.file(join(ROOT, 'package.json')).json()) as { workspaces?: string[] };
  const masks = ['node_modules', ...(root.workspaces ?? []).map((w) => `${w}/node_modules`), 'web/.angular'];

  const run = [
    'run',
    '--rm',
    '--init',
    '--ipc=host',
    '--platform',
    PLATFORM,
    ...(process.stdout.isTTY ? ['--tty'] : []),
    '--volume',
    `${ROOT}:/work`,
    ...masks.flatMap((m) => ['--volume', `/work/${m}`]),
    '--volume',
    'spectant-e2e-bun-cache:/root/.bun/install/cache',
    '--workdir',
    '/work',
    ...['CI', 'E2E_THEME'].flatMap((name) => (process.env[name] === undefined ? [] : ['--env', name])),
    tag,
    'bash',
    '-c',
    'bun install --frozen-lockfile >/dev/null && exec bun web/e2e/run.ts "$@"',
    'run',
    suite,
    ...args,
  ];
  process.exit(await docker(run));
}

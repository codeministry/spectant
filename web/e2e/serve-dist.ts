/**
 * Serves the built dashboard (`web/dist/browser`) on loopback for the Playwright suites (T28).
 *
 *   bun e2e/serve-dist.ts            (from web/; the Playwright `webServer` runs it after `bun run build`)
 *   E2E_PORT=4180 bun e2e/serve-dist.ts
 *
 * A static server of its own rather than the `spectant` binary: the binary embeds `web/dist` only after
 * `scripts/build.ts` compiles it, which would put a four-target build in front of every e2e run. The `/api` it
 * answers is a seam: `serveDist({ api })` takes a fetch handler, and the stub API fed from
 * `core/fixtures/*.golden.json` (`stub-api.ts`, a later task) plugs in there. Without one, `/api/*` is a 404.
 *
 * Loopback only (ISC-2), no path outside the root is ever read, and every unknown path without a file extension
 * falls back to `index.html`, so the router-driven URLs (`/w/:ws`, `/w/:ws/s/:id`) load on reload.
 */
import { extname, join, resolve, sep } from 'node:path';

export type ApiHandler = (request: Request, url: URL) => Response | Promise<Response>;

export type ServeDistOptions = {
  /** Directory holding `index.html`; default `web/dist/browser`. */
  root?: string;
  /** Default `E2E_PORT`, else 4173. */
  port?: number;
  api?: ApiHandler;
};

const HOSTNAME = '127.0.0.1';

export function serveDist(options: ServeDistOptions = {}): ReturnType<typeof Bun.serve> {
  const root = resolve(options.root ?? join(import.meta.dir, '..', 'dist', 'browser'));
  const index = join(root, 'index.html');
  const port = options.port ?? Number(process.env['E2E_PORT'] ?? 4173);
  const api = options.api;

  return Bun.serve({
    hostname: HOSTNAME,
    port,
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
        if (api) return api(request, url);
        return Response.json({ error: 'no stub API is wired into serve-dist' }, { status: 404 });
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return new Response('method not allowed', { status: 405 });
      }

      let path: string;
      try {
        path = resolve(root, `.${decodeURIComponent(url.pathname)}`);
      } catch {
        return new Response('bad request', { status: 400 });
      }
      if (path !== root && !path.startsWith(root + sep)) return new Response('not found', { status: 404 });

      const file = Bun.file(path);
      if (path !== root && (await file.exists())) return new Response(file);
      // An asset that is missing is a real 404; a route without an extension is the SPA's.
      if (extname(url.pathname) !== '') return new Response('not found', { status: 404 });
      return new Response(Bun.file(index), { headers: { 'content-type': 'text/html; charset=utf-8' } });
    },
  });
}

if (import.meta.main) {
  const root = join(import.meta.dir, '..', 'dist', 'browser');
  if (!(await Bun.file(join(root, 'index.html')).exists())) {
    console.error(`serve-dist: ${root}/index.html is missing; run \`bun run --cwd web build\` first`);
    process.exit(1);
  }
  const server = serveDist({ root });
  console.log(`serve-dist: ${root} on ${server.url.href}`);
}

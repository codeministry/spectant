// serve-dist.ts: loopback only, SPA fallback, no path outside the root, `/api` only through the seam.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { serveDist } from './serve-dist';

let dir = '';
let root = '';
let server: ReturnType<typeof serveDist> | undefined;
let plain: ReturnType<typeof serveDist> | undefined;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'serve-dist-'));
  root = join(dir, 'browser');
  await mkdir(join(root, 'fonts'), { recursive: true });
  await writeFile(join(root, 'index.html'), '<!doctype html><title>app</title>');
  await writeFile(join(root, 'main.js'), 'console.log(1)');
  await writeFile(join(dir, 'secret.txt'), 'outside the root');
  server = serveDist({ root, port: 0, api: (_req, url) => Response.json({ path: url.pathname }) });
  plain = serveDist({ root, port: 0 });
});

afterAll(async () => {
  await server?.stop(true);
  await plain?.stop(true);
  await rm(dir, { recursive: true, force: true });
});

const at = (path: string, s = server): string => `http://127.0.0.1:${String(s?.port)}${path}`;

describe('serve-dist', () => {
  test('binds loopback only', () => {
    expect(server?.hostname).toBe('127.0.0.1');
  });

  test('serves files and falls back to index.html for router URLs', async () => {
    expect(await (await fetch(at('/main.js'))).text()).toBe('console.log(1)');
    const route = await fetch(at('/w/demo/s/001'));
    expect(route.status).toBe(200);
    expect(await route.text()).toContain('<title>app</title>');
    expect((await fetch(at('/'))).status).toBe(200);
  });

  test('a missing asset is a 404, not the app shell', async () => {
    expect((await fetch(at('/fonts/missing.woff2'))).status).toBe(404);
  });

  test('never reads outside the root', async () => {
    const res = await fetch(at('/..%2Fsecret.txt'));
    expect(await res.text()).not.toContain('outside the root');
  });

  test('routes /api to the handler, and without one answers 404', async () => {
    expect(await (await fetch(at('/api/settings'))).json()).toEqual({ path: '/api/settings' });
    expect((await fetch(at('/api/settings', plain))).status).toBe(404);
  });
});

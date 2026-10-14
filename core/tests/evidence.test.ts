// The evidence listing and its path confinement (spec 002 T24, ISC-83): `artifacts/` and `.evidence/` of one spec
// folder, grouped by claim, each file with its media type; nothing outside those two folders is ever resolved.
//
// This file is the core half of the ISC-83 probe `bun test tests/evidence.test.ts -t "traversal"`: the `traversal`
// test below proves the confinement rules on a temp copy of harbor, and the server's route test (T47) joins under
// `tests/evidence.test.ts` with the same name to prove the 403. The listing runs against harbor 002, whose synthetic
// `artifacts/` and `.evidence/` come from `core/fixtures/harbor/generate.ts`. The prototype root (spec 017, T19,
// ISC-159.1) runs on a temp copy of the library fixture: its tests are the core half of
// `bun test tests/prototype.test.ts -t traversal`.
import { afterAll, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { cpSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';

import { listEvidence, mediaTypeOf, prototypeMediaTypeOf, resolveEvidencePath, resolvePrototypePath } from '../src/evidence.ts';
import type { EvidenceFile } from '../src/files.ts';
import { FIXTURES } from './helpers/read-tree.ts';

const HARBOR = join(FIXTURES, 'harbor');
const HARBOR_002 = join(HARBOR, 'specs', '002-web-console');

const temps: string[] = [];
afterAll(() => temps.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

/** A temp copy of the harbor tree: `<tmp>/ISA.md`, `<tmp>/specs/…`. Returns the copy's 002 folder. */
function harborCopy(): { root: string; spec: string } {
  const root = mkdtempSync(join(tmpdir(), 'spectant-evidence-'));
  temps.push(root);
  cpSync(HARBOR, root, { recursive: true });
  return { root, spec: join(root, 'specs', '002-web-console') };
}

/** One digest over every entry under `dir`: path, type, and content or link target. Symlinks are never followed. */
function treeHash(dir: string): string {
  const hash = createHash('sha256');
  const walk = (at: string, rel: string): void => {
    for (const name of readdirSync(at).sort()) {
      const path = join(at, name);
      const r = rel ? `${rel}/${name}` : name;
      const st = lstatSync(path);
      if (st.isSymbolicLink()) hash.update(`L ${r} -> ${readlinkSync(path)}\n`);
      else if (st.isDirectory()) {
        hash.update(`D ${r}\n`);
        walk(path, r);
      } else hash.update(`F ${r} ${st.size} ${st.mtimeMs}\n`).update(readFileSync(path));
    }
  };
  walk(dir, '');
  return hash.digest('hex');
}

const paths = (files: readonly EvidenceFile[]): string[] => files.map((f) => f.path);

describe('listEvidence on harbor 002', () => {
  test('three results in artifacts/ and three raw files in .evidence/, sorted by path, posix and relative', async () => {
    const listing = await listEvidence(HARBOR_002);
    expect(paths(listing.results)).toEqual([
      'artifacts/T12-dashboard-model.md',
      'artifacts/T13-routes.md',
      'artifacts/T18-e2e-report.md',
    ]);
    expect(paths(listing.raw)).toEqual(['.evidence/bun-test-r3.log', '.evidence/dashboard.har', '.evidence/kpi-band-390.png']);
    expect(listing.results.every((f) => f.group === 'artifacts')).toBe(true);
    expect(listing.raw.every((f) => f.group === 'evidence')).toBe(true);
    expect(listing.diagnostics).toEqual([]);
    for (const f of [...listing.results, ...listing.raw]) {
      expect(f.path.startsWith('/')).toBe(false);
      expect(f.path.includes(sep === '/' ? '\\' : sep)).toBe(false);
      expect(f.name).toBe(f.path.slice(f.path.lastIndexOf('/') + 1));
      expect(f.bytes).toBe(lstatSync(join(HARBOR_002, f.path)).size);
      expect(f.symlink).toBeUndefined();
      expect(f.refused).toBeUndefined();
    }
  });

  test('media types from the extension', async () => {
    const listing = await listEvidence(HARBOR_002);
    const types = Object.fromEntries([...listing.results, ...listing.raw].map((f) => [f.name, f.mediaType]));
    expect(types).toEqual({
      'T12-dashboard-model.md': 'text/markdown',
      'T13-routes.md': 'text/markdown',
      'T18-e2e-report.md': 'text/markdown',
      'bun-test-r3.log': 'text/plain',
      'dashboard.har': 'application/json',
      'kpi-band-390.png': 'image/png',
    });
  });

  test('the task id from the file name; the claim from the verification line naming the file', async () => {
    const listing = await listEvidence(HARBOR_002);
    const facts = [...listing.results, ...listing.raw].map((f) => [f.name, f.task, f.claim]);
    expect(facts).toEqual([
      ['T12-dashboard-model.md', 'T12', 'ISC-60.1'],
      ['T13-routes.md', 'T13', 'ISC-60.2'],
      ['T18-e2e-report.md', 'T18', 'ISC-65'],
      // named by its bare file name on ISC-72's line
      ['bun-test-r3.log', null, 'ISC-72'],
      // named by no line
      ['dashboard.har', null, null],
      ['kpi-band-390.png', null, 'ISC-61'],
    ]);
  });

  test('grouped by claim in the spec order of the claims; the unnamed file is ungrouped', async () => {
    const listing = await listEvidence(HARBOR_002);
    expect(Object.keys(listing.byClaim)).toEqual(['ISC-60.1', 'ISC-60.2', 'ISC-61', 'ISC-65', 'ISC-72']);
    expect(Object.fromEntries(Object.entries(listing.byClaim).map(([claim, files]) => [claim, paths(files)]))).toEqual({
      'ISC-60.1': ['artifacts/T12-dashboard-model.md'],
      'ISC-60.2': ['artifacts/T13-routes.md'],
      'ISC-61': ['.evidence/kpi-band-390.png'],
      'ISC-65': ['artifacts/T18-e2e-report.md'],
      'ISC-72': ['.evidence/bun-test-r3.log'],
    });
    expect(paths(listing.ungrouped)).toEqual(['.evidence/dashboard.har']);
  });

  test('the spec text may be passed in instead of read', async () => {
    const listing = await listEvidence(HARBOR_002, { specText: '# 002\n\n## Claims\n\n- [ ] ISC-1: x\n' });
    expect(Object.keys(listing.byClaim)).toEqual([]);
    expect(listing.ungrouped).toHaveLength(6);
  });
});

describe('listEvidence edge cases', () => {
  test('missing folders and empty folders give empty lists, no diagnostic', async () => {
    const { spec } = harborCopy();
    rmSync(join(spec, 'artifacts'), { recursive: true });
    rmSync(join(spec, '.evidence'), { recursive: true });
    const missing = await listEvidence(spec);
    expect(missing).toEqual({ results: [], raw: [], byClaim: {}, ungrouped: [], diagnostics: [] });
    mkdirSync(join(spec, 'artifacts'));
    mkdirSync(join(spec, '.evidence'));
    expect(await listEvidence(spec)).toEqual({ results: [], raw: [], byClaim: {}, ungrouped: [], diagnostics: [] });
  });

  test('recursive within the two folders; a claim folder groups its files; dotfiles and unknown types', async () => {
    const { spec } = harborCopy();
    mkdirSync(join(spec, 'artifacts', 'ISC-58', 'deep'), { recursive: true });
    writeFileSync(join(spec, 'artifacts', 'ISC-58', 'deep', 'empty.webp'), 'x');
    writeFileSync(join(spec, 'artifacts', 'ISC-60.1-notes.txt'), 'x');
    writeFileSync(join(spec, 'artifacts', 'T7_blob.bin'), 'x');
    writeFileSync(join(spec, 'artifacts', '.DS_Store'), 'x');
    writeFileSync(join(spec, 'artifacts', 'T9.constructor'), 'x');
    writeFileSync(join(spec, 'artifacts', 'SHOT.PNG'), 'x');
    const listing = await listEvidence(spec);
    const byPath = Object.fromEntries(listing.results.map((f) => [f.path, [f.mediaType, f.task, f.claim]]));
    expect(byPath['artifacts/ISC-58/deep/empty.webp']).toEqual(['image/webp', null, 'ISC-58']);
    // the longest claim ID wins: ISC-60.1, not ISC-60
    expect(byPath['artifacts/ISC-60.1-notes.txt']).toEqual(['text/plain', null, 'ISC-60.1']);
    expect(byPath['artifacts/T7_blob.bin']).toEqual(['application/octet-stream', 'T7', null]);
    // an extension that is an Object.prototype key is still unknown; extensions are case-insensitive
    expect(byPath['artifacts/T9.constructor']).toEqual(['application/octet-stream', 'T9', null]);
    expect(byPath['artifacts/SHOT.PNG']).toEqual(['image/png', null, null]);
    expect(Object.keys(byPath)).not.toContain('artifacts/.DS_Store');
    expect(paths(listing.results)).toEqual([...paths(listing.results)].sort());
  });

  test('symlinks are listed, flagged, and never followed out of the two folders', async () => {
    const { root, spec } = harborCopy();
    symlinkSync('../../../ISA.md', join(spec, '.evidence', 'master.md'));
    symlinkSync('../plan.md', join(spec, '.evidence', 'plan-link.md'));
    symlinkSync('kpi-band-390.png', join(spec, '.evidence', 'kpi-link.png'));
    symlinkSync(join(root, 'specs'), join(spec, 'artifacts', 'specs-dir'));
    const before = treeHash(root);
    const listing = await listEvidence(spec);
    const links = listing.raw.concat(listing.results).filter((f) => f.symlink);
    expect(links.map((f) => [f.path, f.refused ?? 'ok', f.bytes])).toEqual([
      ['.evidence/kpi-link.png', 'ok', lstatSync(join(spec, '.evidence', 'kpi-band-390.png')).size],
      ['.evidence/master.md', 'symlink-escape', 0],
      ['.evidence/plan-link.md', 'symlink-escape', 0],
      ['artifacts/specs-dir', 'symlink-escape', 0],
    ]);
    // the linked directory is not descended into
    expect(listing.results.some((f) => f.path.startsWith('artifacts/specs-dir/'))).toBe(false);
    expect(listing.diagnostics.map((d) => d.code)).toEqual(['evidence-symlink-escape', 'evidence-symlink-escape', 'evidence-symlink-escape']);
    expect(listing.diagnostics.every((d) => !d.message.includes(root))).toBe(true);
    expect(treeHash(root)).toBe(before);
  });

  test('a group folder that is itself a symlink is not listed', async () => {
    const { root, spec } = harborCopy();
    rmSync(join(spec, 'artifacts'), { recursive: true });
    symlinkSync(join(root, 'specs'), join(spec, 'artifacts'));
    const listing = await listEvidence(spec);
    expect(listing.results).toEqual([]);
    expect(listing.diagnostics.map((d) => d.code)).toEqual(['evidence-folder-symlink']);
  });
});

describe('resolveEvidencePath', () => {
  test('traversal: nothing outside artifacts/ and .evidence/ of the spec folder resolves, and nothing is written', async () => {
    const { root, spec } = harborCopy();
    // symlinks inside .evidence/: to the repository's master, to `specs/ISA.md` (absent, but outside: dangling out),
    // to a spec file beside the two folders, dangling out of the tree, absolute, and dangling but inside
    symlinkSync('../../../ISA.md', join(spec, '.evidence', 'master.md'));
    symlinkSync('../../ISA.md', join(spec, '.evidence', 'up-two.md'));
    symlinkSync('../plan.md', join(spec, '.evidence', 'plan-link.md'));
    symlinkSync('../../../../nowhere.md', join(spec, '.evidence', 'dangling.md'));
    symlinkSync(join(root, 'ISA.md'), join(spec, '.evidence', 'absolute.md'));
    symlinkSync('not-there.png', join(spec, '.evidence', 'missing-link.png'));
    mkdirSync(join(spec, '.evidence', 'sub'));
    const before = treeHash(root);

    const refused: Array<[string, string]> = [
      ['../spec.md', 'outside'],
      ['artifacts/../../spec.md', 'outside'],
      ['..%2F..%2FISA.md', 'outside'],
      ['artifacts%2F..%2F..%2FISA.md', 'outside'],
      ['%252e%252e/', 'outside'],
      ['%252e%252e%252fISA.md', 'outside'],
      ['%2e%2e/spec.md', 'outside'],
      ['artifacts/%E0%A4%A', 'outside'],
      [join(root, 'ISA.md'), 'outside'],
      [join(spec, 'artifacts', 'T13-routes.md'), 'outside'],
      ['/etc/passwd', 'outside'],
      ['C:/Windows/win.ini', 'outside'],
      ['c:artifacts/T13-routes.md', 'outside'],
      ['artifacts\\..\\spec.md', 'outside'],
      ['artifacts/T13-routes.md\u0000.png', 'outside'],
      ['artifacts/T13-routes.md%00', 'outside'],
      ['plan.md', 'outside'],
      ['spec.md', 'outside'],
      ['.gates/reviewed.json', 'outside'],
      ['artifacts', 'outside'],
      ['.evidence/', 'outside'],
      ['', 'outside'],
      ['.evidence/master.md', 'symlink-escape'],
      ['.evidence/plan-link.md', 'symlink-escape'],
      ['.evidence/dangling.md', 'symlink-escape'],
      ['.evidence/absolute.md', 'symlink-escape'],
      ['.evidence/up-two.md', 'symlink-escape'],
      ['.evidence/missing-link.png', 'not-found'],
      ['artifacts/nope.md', 'not-found'],
      ['.evidence/sub', 'not-a-file'],
    ];
    const got = await Promise.all(refused.map(async ([req]) => [req, await resolveEvidencePath(spec, req)] as const));
    expect(got.map(([req, r]) => [req, r.ok ? 'ok' : r.reason])).toEqual(refused);

    const valid = await resolveEvidencePath(spec, 'artifacts/T13-routes.md');
    expect(valid).toEqual({ ok: true, absolute: join(realpathSync(spec), 'artifacts', 'T13-routes.md'), path: 'artifacts/T13-routes.md' });
    // one layer of percent-encoding is decoded; `./` and doubled slashes normalise away
    expect(await resolveEvidencePath(spec, '.evidence%2Fkpi-band-390.png')).toMatchObject({ ok: true, path: '.evidence/kpi-band-390.png' });
    expect(await resolveEvidencePath(spec, './.evidence//dashboard.har')).toMatchObject({ ok: true, path: '.evidence/dashboard.har' });

    expect(treeHash(root)).toBe(before);
  });

  test('a spec folder reached through a symlink still confines to its real path', async () => {
    const { root, spec } = harborCopy();
    const alias = join(root, 'alias-002');
    symlinkSync(spec, alias);
    expect(await resolveEvidencePath(alias, 'artifacts/T12-dashboard-model.md')).toMatchObject({ ok: true });
    expect(await resolveEvidencePath(alias, '../ISA.md')).toEqual({ ok: false, reason: 'outside' });
  });

  test('a missing spec folder resolves nothing', async () => {
    expect(await resolveEvidencePath(join(tmpdir(), 'spectant-evidence-no-such-dir'), 'artifacts/x.md')).toEqual({ ok: false, reason: 'not-found' });
  });
});

// ─── The prototype root (spec 017, T19, ISC-159.1) ─────────────────────────────────────────────────────────────────

const LIBRARY = join(FIXTURES, 'library');

/** A temp copy of the library fixture; `spec` is 002-tide-board (prototype `board`), `other` 001-lighthouse-map. */
function libraryCopy(): { root: string; spec: string; other: string } {
  const root = mkdtempSync(join(tmpdir(), 'spectant-prototype-'));
  temps.push(root);
  cpSync(LIBRARY, root, { recursive: true });
  return { root, spec: join(root, 'specs', '002-tide-board'), other: join(root, 'specs', '001-lighthouse-map') };
}

describe('resolvePrototypePath', () => {
  test('traversal: nothing outside the requested folder below the spec own .design/prototype/ resolves, and nothing is written', async () => {
    const { root, spec, other } = libraryCopy();
    const board = join(spec, '.design', 'prototype', 'board');
    // symlinks inside the board folder: up to spec.md, to the sibling code folder, to another spec's prototype page
    // (absolute), dangling out of the tree, and dangling but inside
    symlinkSync('../../../spec.md', join(board, 'escape.md'));
    symlinkSync('../src/main.ts', join(board, 'sibling.ts'));
    symlinkSync(join(other, '.design', 'prototype', 'index.html'), join(board, 'other.html'));
    symlinkSync('../../../../../../nowhere.html', join(board, 'dangling.html'));
    symlinkSync('not-there.css', join(board, 'missing-link.css'));
    // a folder below .design/prototype/ that is itself a symlink to another spec's prototype
    symlinkSync(join(other, '.design', 'prototype'), join(spec, '.design', 'prototype', 'alias'));
    const before = treeHash(root);

    const refused: Array<[string, string, string]> = [
      // the file tail: decoded once, then lexically clean or refused
      ['prototype/board', '../index.html', 'outside'],
      ['prototype/board', 'img/../../src/main.ts', 'outside'],
      ['prototype/board', '..%2F..%2F..%2Fspec.md', 'outside'],
      ['prototype/board', '%2e%2e/%2e%2e/%2e%2e/spec.md', 'outside'],
      ['prototype/board', '%252e%252e/%252e%252e/spec.md', 'outside'],
      ['prototype/board', 'index%252ehtml', 'outside'],
      ['prototype/board', 'img/%E0%A4%A', 'outside'],
      ['prototype/board', join(spec, 'spec.md'), 'outside'],
      ['prototype/board', join(board, 'index.html'), 'outside'],
      ['prototype/board', '/etc/passwd', 'outside'],
      ['prototype/board', 'C:/Windows/win.ini', 'outside'],
      ['prototype/board', 'img\\..\\..\\spec.md', 'outside'],
      ['prototype/board', 'index.html\u0000.png', 'outside'],
      ['prototype/board', 'index.html%00', 'outside'],
      ['prototype/board', '', 'outside'],
      // the folder: `prototype` or a canonical path below it, already decoded once by the route
      ['', 'index.html', 'outside'],
      ['.', 'prototype/board/index.html', 'outside'],
      ['..', '002-tide-board/spec.md', 'outside'],
      ['views', 'index.html', 'outside'],
      ['prototype-board', 'index.html', 'outside'],
      ['prototype/..', 'spec.md', 'outside'],
      ['prototype/../..', 'spec.md', 'outside'],
      ['prototype/../../../001-lighthouse-map/.design/prototype', 'index.html', 'outside'],
      ['prototype/./board', 'index.html', 'outside'],
      ['prototype//board', 'index.html', 'outside'],
      ['prototype/', 'board/index.html', 'outside'],
      ['/prototype/board', 'index.html', 'outside'],
      [join(other, '.design', 'prototype'), 'index.html', 'outside'],
      ['prototype%2Fboard', 'index.html', 'outside'],
      ['prototype/%2e%2e', 'spec.md', 'outside'],
      ['prototype\\board', 'index.html', 'outside'],
      ['prototype/board\u0000', 'index.html', 'outside'],
      // symlinks: out of the folder, to a sibling folder, to another spec, dangling out, and a symlinked folder
      ['prototype/board', 'escape.md', 'symlink-escape'],
      ['prototype/board', 'sibling.ts', 'symlink-escape'],
      ['prototype/board', 'other.html', 'symlink-escape'],
      ['prototype/board', 'dangling.html', 'symlink-escape'],
      ['prototype/alias', 'index.html', 'symlink-escape'],
      // absences
      ['prototype/board', 'missing-link.css', 'not-found'],
      ['prototype/board', 'nope.html', 'not-found'],
      ['prototype/nope', 'index.html', 'not-found'],
      ['prototype/board/index.html', 'x.css', 'not-found'],
      ['prototype/board', 'img', 'not-a-file'],
    ];
    const got = await Promise.all(
      refused.map(async ([folder, file]) => [folder, file, await resolvePrototypePath(spec, folder, file)] as const),
    );
    expect(got.map(([folder, file, r]) => [folder, file, r.ok ? 'ok' : r.reason])).toEqual(refused);

    // the folder's own files, at any depth below it, each relative to the folder
    const real = realpathSync(board);
    expect(await resolvePrototypePath(spec, 'prototype/board', 'index.html')).toEqual({ ok: true, absolute: join(real, 'index.html'), path: 'index.html' });
    expect(await resolvePrototypePath(spec, 'prototype/board', 'img%2Fbadge.png')).toMatchObject({ ok: true, path: 'img/badge.png' });
    expect(await resolvePrototypePath(spec, 'prototype/board', './styles.css')).toMatchObject({ ok: true, path: 'styles.css' });
    expect(await resolvePrototypePath(other, 'prototype', 'assets/logo.png')).toMatchObject({ ok: true, path: 'assets/logo.png' });
    // `prototype` itself is a folder too: everything below .design/prototype/ belongs to it
    expect(await resolvePrototypePath(spec, 'prototype', 'board/app.js')).toEqual({ ok: true, absolute: join(real, 'app.js'), path: 'board/app.js' });

    expect(treeHash(root)).toBe(before);
  });

  test('a .design/ or .design/prototype/ that is itself a symlink resolves nothing, even into another spec of the tree', async () => {
    const { spec, other } = libraryCopy();
    rmSync(join(other, '.design', 'prototype'), { recursive: true });
    symlinkSync(join(spec, '.design', 'prototype', 'board'), join(other, '.design', 'prototype'));
    expect(await resolvePrototypePath(other, 'prototype', 'index.html')).toEqual({ ok: false, reason: 'symlink-escape' });
    rmSync(join(spec, '.design'), { recursive: true });
    symlinkSync(join(other, '.design'), join(spec, '.design'));
    expect(await resolvePrototypePath(spec, 'prototype', 'index.html')).toEqual({ ok: false, reason: 'symlink-escape' });
  });

  test('a spec folder reached through a symlink still confines to its real path', async () => {
    const { root, spec } = libraryCopy();
    const alias = join(root, 'alias-002');
    symlinkSync(spec, alias);
    expect(await resolvePrototypePath(alias, 'prototype/board', 'detail.html')).toMatchObject({ ok: true, path: 'detail.html' });
    expect(await resolvePrototypePath(alias, 'prototype/board', '../../../spec.md')).toEqual({ ok: false, reason: 'outside' });
    expect(await resolvePrototypePath(join(tmpdir(), 'spectant-prototype-no-such-dir'), 'prototype', 'index.html')).toEqual({ ok: false, reason: 'not-found' });
  });
});

describe('prototypeMediaTypeOf', () => {
  test('a prototype page loads its styles, scripts and fonts with their own types; evidence serving keeps its table', () => {
    const names = ['styles.css', 'app.js', 'module.mjs', 'index.html', 'page.HTM', 'face.woff', 'face.woff2', 'face.ttf', 'face.otf', 'badge.png', 'logo.svg', 'data.json', 'main.ts', 'blob.bin'];
    expect(names.map((name) => [name, prototypeMediaTypeOf(name)])).toEqual([
      ['styles.css', 'text/css'],
      ['app.js', 'text/javascript'],
      ['module.mjs', 'text/javascript'],
      ['index.html', 'text/html'],
      ['page.HTM', 'text/html'],
      ['face.woff', 'font/woff'],
      ['face.woff2', 'font/woff2'],
      ['face.ttf', 'font/ttf'],
      ['face.otf', 'font/otf'],
      ['badge.png', 'image/png'],
      ['logo.svg', 'image/svg+xml'],
      ['data.json', 'application/json'],
      ['main.ts', 'application/octet-stream'],
      ['blob.bin', 'application/octet-stream'],
    ]);
    // the evidence route and the catalog read `mediaTypeOf`, which stays as it was
    expect(['styles.css', 'app.js', 'face.woff2', 'page.htm'].map(mediaTypeOf)).toEqual(Array<string>(4).fill('application/octet-stream'));
  });
});

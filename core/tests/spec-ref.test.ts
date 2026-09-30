// The spec-reference forms (review round 2, finding 8): one pure definition of the three refs a spec route accepts —
// the id `NNN`, the folder `NNN-slug` and the bare slug — shared by `resolveSpec` and the web app.
import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { listSpecs, resolveSpec } from '../src/resolve.ts';
import { SPEC_FOLDER, SPEC_ID, specIdOf, specRefMatches, specSlugOf } from '../src/spec-ref.ts';

describe('SPEC_FOLDER and SPEC_ID', () => {
  test('the folder shape the loader lists: three digits, a hyphen and a slug', () => {
    for (const name of ['002-web-console', '003-2-step', '007-123']) expect(SPEC_FOLDER.test(name)).toBe(true);
    for (const name of ['1024-big-tree', '02-short', '003', '003-', 'web-console', '']) expect(SPEC_FOLDER.test(name)).toBe(false);
  });

  test('an id ref is exactly three digits', () => {
    for (const ref of ['002', '123']) expect(SPEC_ID.test(ref)).toBe(true);
    for (const ref of ['2', '1024', '002-web-console', 'web-console', '']) expect(SPEC_ID.test(ref)).toBe(false);
  });
});

describe('specIdOf', () => {
  test('the numeric prefix before the first "-"', () => {
    expect(specIdOf('002-web-console')).toBe('002');
    expect(specIdOf('1024-big-tree')).toBe('1024');
    expect(specIdOf('003-2-step')).toBe('003');
  });

  test('null for a folder without a slug or without a numeric prefix', () => {
    expect(specIdOf('003')).toBeNull();
    expect(specIdOf('web-console')).toBeNull();
    expect(specIdOf('')).toBeNull();
    expect(specIdOf('-slug')).toBeNull();
  });
});

describe('specSlugOf', () => {
  test('the folder without its numeric prefix', () => {
    expect(specSlugOf('002-web-console')).toBe('web-console');
    expect(specSlugOf('1024-big-tree')).toBe('big-tree');
    expect(specSlugOf('003-2-step')).toBe('2-step');
  });

  test('a folder without a numeric prefix, or without a slug, is its own slug', () => {
    expect(specSlugOf('web-console')).toBe('web-console');
    expect(specSlugOf('003')).toBe('003');
  });
});

describe('specRefMatches', () => {
  test('the id, the folder and the bare slug each match', () => {
    for (const ref of ['002', '002-web-console', 'web-console']) expect(specRefMatches('002-web-console', ref)).toBe(true);
    for (const ref of ['1024', '1024-big-tree', 'big-tree']) expect(specRefMatches('1024-big-tree', ref)).toBe(true);
  });

  test('anything else does not: other ids, partial slugs, an unpadded id', () => {
    for (const ref of ['2', '003', 'web', 'console', '002-web', 'Web-Console', ' 002']) {
      expect(specRefMatches('002-web-console', ref)).toBe(false);
    }
  });

  test('a three-digit ref is an id only, never a slug: resolveSpec reads it the same way', () => {
    expect(specRefMatches('007-123', '123')).toBe(false);
    expect(specRefMatches('007-123', '007')).toBe(true);
    expect(specRefMatches('007-123', '007-123')).toBe(true);
    expect(specRefMatches('123-x', '123')).toBe(true);
  });

  test('a numeric slug of another width still matches as a slug, as resolveSpec resolves it', () => {
    expect(specRefMatches('007-1234', '1234')).toBe(true);
    expect(specRefMatches('007-12', '12')).toBe(true);
  });

  test('a folder without a numeric prefix matches its own name; one without a slug has no id to match', () => {
    expect(specRefMatches('web-console', 'web-console')).toBe(true);
    expect(specRefMatches('003', '003')).toBe(false);
    expect(specRefMatches('003', '03')).toBe(false);
  });

  test('an empty ref never matches, not even a folder with an empty slug', () => {
    expect(specRefMatches('002-web-console', '')).toBe(false);
    expect(specRefMatches('002-', '')).toBe(false);
    expect(specRefMatches('', '')).toBe(false);
  });
});

// resolveSpec reads refs through these helpers: every form of every fixture folder resolves to that folder, and
// specRefMatches agrees for each.
describe('resolveSpec parity', () => {
  test.each(['harbor', 'lantern'])('each form of each %s folder resolves to it and matches it', (name) => {
    const root = join(import.meta.dir, '..', 'fixtures', name);
    const specs = listSpecs(root);
    expect(specs.length).toBeGreaterThan(0);
    for (const spec of specs) {
      for (const ref of [spec.id, spec.slug, specSlugOf(spec.slug)]) {
        expect(specRefMatches(spec.slug, ref)).toBe(true);
        expect(resolveSpec(root, ref)).toMatchObject({ kind: 'spec', slug: spec.slug });
      }
      expect(specIdOf(spec.slug)).toBe(spec.id);
    }
  });

  test('numeric slugs: resolveSpec and specRefMatches agree on every ref', () => {
    const root = mkdtempSync(join(tmpdir(), 'spectant-spec-ref-'));
    try {
      for (const folder of ['007-123', '008-1234']) mkdirSync(join(root, 'specs', folder), { recursive: true });
      expect(resolveSpec(root, '123')).toEqual({ kind: 'not_found', ref: '123', reason: 'unknown-id' });
      expect(resolveSpec(root, '007')).toMatchObject({ kind: 'spec', slug: '007-123' });
      expect(resolveSpec(root, '007-123')).toMatchObject({ kind: 'spec', slug: '007-123' });
      expect(resolveSpec(root, '1234')).toMatchObject({ kind: 'spec', slug: '008-1234' });
      const folders = listSpecs(root).map((s) => s.slug);
      for (const ref of ['123', '007', '007-123', '1234', '008', '008-1234']) {
        const resolved = resolveSpec(root, ref);
        for (const folder of folders) {
          expect(specRefMatches(folder, ref)).toBe(resolved.kind === 'spec' && resolved.slug === folder);
        }
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

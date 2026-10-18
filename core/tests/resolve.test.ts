// T13 (spec 002, ISC-71): a workspace slug or spec ref resolves to exactly the entry it names, or to not-found with a
// reason. Never to another spec. The server's 404 (T45) and the web's not-found page (T48) sit on top of this.
import { describe, expect, test } from 'bun:test';
import { join, resolve, sep } from 'node:path';

import { listSpecs, resolveSpec, resolveWorkspace, specIdOfPath } from '../src/resolve.ts';

const FIXTURES = join(import.meta.dir, '..', 'fixtures');
const HARBOR = join(FIXTURES, 'harbor');
const LANTERN = join(FIXTURES, 'lantern');
const EMPTY_MASTER = join(FIXTURES, 'empty-master');

describe('resolveSpec on harbor', () => {
  test('a three-digit id resolves to its active folder', () => {
    expect(resolveSpec(HARBOR, '002')).toEqual({
      kind: 'spec',
      id: '002',
      slug: '002-web-console',
      dir: resolve(HARBOR, 'specs', '002-web-console'),
      archived: false,
    });
  });

  test('an id found only under specs/archive/ resolves with archived: true', () => {
    expect(resolveSpec(HARBOR, '001')).toEqual({
      kind: 'spec',
      id: '001',
      slug: '001-manifest-sync',
      dir: resolve(HARBOR, 'specs', 'archive', '001-manifest-sync'),
      archived: true,
    });
  });

  test('a full folder name resolves to that folder', () => {
    const ref = resolveSpec(HARBOR, '004-retention-policies');
    expect(ref).toMatchObject({ kind: 'spec', id: '004', slug: '004-retention-policies', archived: false });
  });

  test('a slug without its number resolves by exact match', () => {
    const ref = resolveSpec(HARBOR, 'web-console');
    expect(ref).toMatchObject({ kind: 'spec', id: '002', slug: '002-web-console', archived: false });
  });

  test('an archived slug without its number resolves with archived: true', () => {
    expect(resolveSpec(HARBOR, 'manifest-sync')).toMatchObject({ kind: 'spec', id: '001', archived: true });
  });

  test('an unknown id is not found with reason unknown-id', () => {
    expect(resolveSpec(HARBOR, '999')).toEqual({ kind: 'not_found', ref: '999', reason: 'unknown-id' });
  });

  test('an unknown slug is not found with reason unknown-slug', () => {
    expect(resolveSpec(HARBOR, 'nope')).toEqual({ kind: 'not_found', ref: 'nope', reason: 'unknown-slug' });
  });
});

describe('resolveSpec never falls back to another spec', () => {
  const misses = [
    '002-wrong-name', // a known id with the wrong slug must not resolve to 002
    '002-web', // a prefix of a real folder name
    'web', // a prefix of a real slug
    'WEB-CONSOLE', // case differs
    '02', // not three digits
    '0002',
    '',
    '.',
    '..',
    'archive', // the archive folder itself is not a spec
    'constitution.md',
    '../harbor/specs/002-web-console',
    'archive/001-manifest-sync',
  ];

  for (const miss of misses) {
    test(`"${miss}" is not found`, () => {
      const result = resolveSpec(HARBOR, miss);
      expect(result.kind).toBe('not_found');
      expect(result).toMatchObject({ ref: miss });
    });
  }

  test('a known id with the wrong slug reports unknown-slug, not the id match', () => {
    expect(resolveSpec(HARBOR, '002-wrong-name')).toEqual({
      kind: 'not_found',
      ref: '002-wrong-name',
      reason: 'unknown-slug',
    });
  });
});

describe('resolveSpec without specs', () => {
  test('empty-master has specs/ with no spec folder: 001 is unknown-id', () => {
    // The tree holds specs/constitution.md and nothing else, so the specs directory exists and the id is absent.
    expect(resolveSpec(EMPTY_MASTER, '001')).toEqual({ kind: 'not_found', ref: '001', reason: 'unknown-id' });
  });

  test('a root without specs/ is not found with reason no-specs-dir', () => {
    // core/fixtures/ itself holds fixture trees but no specs/ directory.
    expect(resolveSpec(FIXTURES, '001')).toEqual({ kind: 'not_found', ref: '001', reason: 'no-specs-dir' });
    expect(resolveSpec(join(FIXTURES, 'does-not-exist'), 'web-console')).toEqual({
      kind: 'not_found',
      ref: 'web-console',
      reason: 'no-specs-dir',
    });
  });
});

describe('listSpecs', () => {
  test('lantern lists its specs in numeric order', () => {
    expect(listSpecs(LANTERN).map((s) => s.slug)).toEqual(['001-reading-list', '002-duplicate-links']);
  });

  test('harbor lists active specs in numeric order and archived ones last', () => {
    const specs = listSpecs(HARBOR);
    expect(specs.map((s) => [s.slug, s.archived])).toEqual([
      ['002-web-console', false],
      ['003-config-loader', false],
      ['004-retention-policies', false],
      ['005-config-format-choice', false],
      ['006-partial-push', false],
      ['007-rotate-mirror-token', false],
      ['008-referrers-support', false],
      ['009-chunked-upload-limits', false],
      ['001-manifest-sync', true],
    ]);
    for (const spec of specs) expect(spec.kind).toBe('spec');
  });

  test('a tree without spec folders lists nothing', () => {
    expect(listSpecs(EMPTY_MASTER)).toEqual([]);
    expect(listSpecs(FIXTURES)).toEqual([]);
  });
});

describe('resolveWorkspace', () => {
  const registry = [
    { slug: 'harbor', path: HARBOR },
    { slug: 'lantern', path: LANTERN },
  ] as const;

  test('a registered slug returns its entry', () => {
    expect(resolveWorkspace(registry, 'lantern')).toBe(registry[1]);
  });

  test('a missing slug is not found with reason unknown-workspace', () => {
    expect(resolveWorkspace(registry, 'nope')).toEqual({ kind: 'not_found', ref: 'nope', reason: 'unknown-workspace' });
  });

  test('no near miss resolves: case, prefix and empty slug are not found', () => {
    for (const miss of ['Harbor', 'harb', 'harbor ', '']) {
      expect(resolveWorkspace(registry, miss)).toEqual({ kind: 'not_found', ref: miss, reason: 'unknown-workspace' });
    }
  });

  test('an empty registry finds nothing', () => {
    expect(resolveWorkspace([], 'harbor')).toMatchObject({ kind: 'not_found', reason: 'unknown-workspace' });
  });
});

// T2 (spec 030, ISC-28): the watcher maps a changed path to the spec it belongs to, by the folder rule `listSpecs`
// reads with, so the server keeps no second rule. Paths are relative to a repository root or a spec worktree root.
describe('specIdOfPath', () => {
  const owned: ReadonlyArray<readonly [string, string]> = [
    ['specs/030-live-update-sse/tasks.md', '030'],
    ['specs/030-live-update-sse/spec.md', '030'],
    ['specs/030-live-update-sse/.design/board.md', '030'],
    ['specs/002-web-console/.gates/reviewed.json', '002'],
    ['specs/002-web-console/events.jsonl', '002'],
    ['specs/archive/001-manifest-sync/spec.md', '001'],
    ['specs/archive/001-manifest-sync/.gates/code-reviewed.json', '001'],
    // The folder itself, as a recursive watch reports a created, renamed or archived folder.
    ['specs/030-live-update-sse', '030'],
    ['specs/archive/001-manifest-sync', '001'],
    ['specs/030-live-update-sse/', '030'],
  ];

  for (const [path, id] of owned) {
    test(`"${path}" belongs to ${id}`, () => {
      expect(specIdOfPath(path)).toBe(id);
    });
  }

  test('the platform separator is accepted as well as /', () => {
    expect(specIdOfPath(join('specs', '030-live-update-sse', 'tasks.md'))).toBe('030');
    expect(specIdOfPath(join('specs', 'archive', '001-manifest-sync', '.gates', 'reviewed.json'))).toBe('001');
    expect(specIdOfPath(['specs', '002-web-console', 'plan.md'].join(sep))).toBe('002');
  });

  const unowned = [
    'ISA.md',
    'specs/ideas/faster-sync.md',
    'specs/ideas',
    'specs/tldr.md',
    'specs/tech.md',
    'specs/constitution.md',
    'specs/backlog.md',
    'specs/backlog.events.jsonl',
    'specs/tokens.jsonl',
    'specs',
    'specs/archive',
    'specs/archive/README.md',
    '.spectant/activity.jsonl',
    '',
    // Not the folder rule: no three-digit id, or not one level under specs/ or specs/archive/.
    'specs/30-short/spec.md',
    'specs/0030-wide/spec.md',
    'specs/030-/spec.md',
    'specs/archive/archive/001-manifest-sync/spec.md',
    'specs/ideas/030-nested/spec.md',
    'docs/specs/030-live-update-sse/spec.md',
    '030-live-update-sse/spec.md',
    'Specs/030-live-update-sse/spec.md',
    // Absolute or escaping paths are not repository-relative.
    '/specs/030-live-update-sse/spec.md',
    '../specs/030-live-update-sse/spec.md',
  ];

  for (const path of unowned) {
    test(`"${path}" belongs to no spec`, () => {
      expect(specIdOfPath(path)).toBeNull();
    });
  }
});

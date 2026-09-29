// The archive listing (spec 001 T38, ISC-16): one row per folder under `specs/archive/`, the number kept, the archive
// date and reason from the frontmatter, claims and tasks counted, the goal on one line. Harbor archives 001 (all 46
// claims closed, archived 2026-03-05), leadgen archives 013, lantern archives nothing.
import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { listArchive } from '../src/archive.ts';
import type { SpecFiles, TextFileKind } from '../src/files.ts';

const FIXTURES = join(import.meta.dir, '..', 'fixtures');

/** The archived folders of a fixture tree, read as the server reads them. */
function archived(tree: string): SpecFiles[] {
  const root = join(FIXTURES, tree, 'specs', 'archive');
  if (!existsSync(root)) return [];
  return readdirSync(root).map((folder) => {
    const texts: Partial<Record<TextFileKind, string>> = {};
    for (const [kind, file] of [['spec', 'spec.md'], ['plan', 'plan.md'], ['tasks', 'tasks.md']] as const) {
      const path = join(root, folder, file);
      if (existsSync(path)) texts[kind] = readFileSync(path, 'utf8');
    }
    return { folder, texts };
  });
}

describe('fixtures', () => {
  test('harbor: archive/001 with its date, all claims closed', () => {
    const rows = listArchive(archived('harbor'));
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row).toMatchObject({
      id: '001',
      slug: '001-manifest-sync',
      title: 'Mirror every listed manifest into the team registry with one command',
      type: 'feature',
      archived: '2026-03-05',
      archivedReason: null,
      claims: { closed: 46, total: 46 },
    });
    expect(row?.tasks.total).toBeGreaterThan(0);
    expect(row?.tasks.landed).toBe(row?.tasks.total);
    expect(row?.goal).not.toBe('');
    expect(row?.goal).not.toContain('\n');
  });

  test('leadgen: archive/013, a refactor archived on 2026-09-27', () => {
    const rows = listArchive(archived('leadgen'));
    expect(rows.map((r) => [r.id, r.slug, r.type, r.archived])).toEqual([['013', '013-tech-debt', 'refactor', '2026-09-27']]);
    expect(rows[0]?.claims).toEqual({ closed: 14, total: 14 });
  });

  test('lantern: no archive, no rows', () => {
    expect(listArchive(archived('lantern'))).toEqual([]);
  });
});

describe('the row', () => {
  test('reason, title fallback, goal paragraph, folder order, a folder without spec.md skipped', () => {
    const rows = listArchive([
      {
        folder: '010-late',
        texts: {
          spec: '---\nspec_type: bug\narchived: 2026-03-09\narchived_reason: "superseded by 011"\n---\n\n# 010\n\n## Goal\n\n<!-- a note -->\n\nStop the\ncrash.\n\nSecond paragraph.\n\n## Claims\n\n- [x] ISC-1: a\n- [ ] ISC-2: b\n- [ ] ISC-3: [DROPPED] c\n',
          tasks: '- [x] T1 · ISC-1 · core — a\n- [ ] T2 · ISC-2 · core — b\n',
        },
      },
      { folder: '004-empty', texts: {} },
      { folder: '002-no-frontmatter', texts: { spec: '# 002\n' } },
    ]);
    expect(rows.map((r) => r.slug)).toEqual(['002-no-frontmatter', '010-late']);
    expect(rows[0]).toEqual({
      id: '002',
      slug: '002-no-frontmatter',
      title: 'no-frontmatter',
      type: null,
      archived: null,
      archivedReason: null,
      claims: { closed: 0, total: 0 },
      tasks: { landed: 0, total: 0 },
      goal: '',
    });
    expect(rows[1]).toMatchObject({
      title: 'late',
      type: 'bug',
      archived: '2026-03-09',
      archivedReason: 'superseded by 011',
      claims: { closed: 1, total: 2 },
      tasks: { landed: 1, total: 2 },
      goal: 'Stop the crash.',
    });
  });
});

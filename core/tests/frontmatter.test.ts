// Frontmatter parser (spec 001 T33, seam for ISC-6): every fixture's `---` block parses into typed keys with no
// error diagnostic, and malformed input yields diagnostics instead of a throw. Port of the old skill's SpecLib
// `parseFrontmatter` (flat keys, quoted values, trailing ` # comment` dropped).
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { parseFrontmatter } from '../src/frontmatter.ts';

const FIXTURES = join(import.meta.dir, '..', 'fixtures');

function read(rel: string): string {
  return readFileSync(join(FIXTURES, rel), 'utf8');
}

/** Every markdown file under the fixtures, relative to `core/fixtures/`. */
function markdownFiles(dir = FIXTURES): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...markdownFiles(path));
    else if (entry.isFile() && entry.name.endsWith('.md')) out.push(relative(FIXTURES, path));
  }
  return out.sort();
}

describe('fixtures', () => {
  const files = markdownFiles();

  test('the corpus holds the spec and master files the parsers are measured on', () => {
    expect(files.filter((f) => f.endsWith('/spec.md') || f.endsWith('/ISA.md')).length).toBe(17);
  });

  test.each(files)('%s parses without an error diagnostic', (rel) => {
    const fm = parseFrontmatter(read(rel));
    expect(fm.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  });

  test.each(files.filter((f) => f.endsWith('/spec.md')))('%s carries a typed spec head', (rel) => {
    const fm = parseFrontmatter(read(rel));
    expect(fm.present).toBe(true);
    expect(fm.diagnostics).toEqual([]);
    expect(fm.data.slug).toMatch(/^\d{3}-[a-z0-9-]+$/);
    expect(fm.data.specType).not.toBeNull();
    expect(fm.data.progress).not.toBeNull();
    expect(fm.data.phase).not.toBeNull();
    expect(typeof fm.data.contextSufficient).toBe('boolean');
    expect(typeof fm.data.interviewInvoked).toBe('boolean');
  });

  test('harbor master: progress 101/124, project kept in rest', () => {
    const fm = parseFrontmatter(read('harbor/ISA.md'));
    expect(fm.data.progress).toEqual({ closed: 101, total: 124 });
    expect(fm.data.task).toBe('Mirror container manifests between registries with Harbor');
    expect(fm.data.slug).toBe('20260302-harbor');
    expect(fm.data.phase).toBe('climbing');
    expect(fm.data.started).toBe('2026-03-02T08:00:00Z');
    expect(fm.data.updated).toBe('2026-03-09T17:30:00Z');
    expect(fm.data.specType).toBeNull();
    expect(fm.rest).toEqual({ project: 'harbor' });
    expect(fm.body.startsWith('\n# Harbor')).toBe(true);
    expect(fm.bodyLine).toBe(10);
  });

  test('harbor 002: every typed key of a feature spec', () => {
    const fm = parseFrontmatter(read('harbor/specs/002-web-console/spec.md'));
    expect(fm.data).toMatchObject({
      slug: '002-web-console',
      specType: 'feature',
      isaMaster: '../../ISA.md',
      isaFeature: 'F2',
      constitution: '../constitution.md',
      phase: 'building',
      progress: { closed: 25, total: 30 },
      contextSufficient: true,
      interviewInvoked: false,
      contextLog: 'context.md',
      archived: null,
    });
    expect(fm.rest).toEqual({});
  });

  test('harbor archive/001: archived date, isa_master left unchanged', () => {
    const fm = parseFrontmatter(read('harbor/specs/archive/001-manifest-sync/spec.md'));
    expect(fm.data.archived).toBe('2026-03-05');
    expect(fm.data.isaMaster).toBe('../../ISA.md');
    expect(fm.data.phase).toBe('complete');
    expect(fm.data.progress).toEqual({ closed: 46, total: 46 });
  });

  test('leadgen archive/013: the principal_stated_goal family and a refactor type', () => {
    const fm = parseFrontmatter(read('leadgen/specs/archive/013-tech-debt/spec.md'));
    expect(fm.data.specType).toBe('refactor');
    expect(fm.data.principalStatedGoal).toBe('lombok muss auch integriert werden, damit der code schlanker wird. weiter ideen?');
    expect(fm.data.principalStatedGoalSource).toBe('prompt');
    expect(fm.data.principalStatedGoalSignal).toBe(2);
    expect(fm.data.principalStatedGoalLocked).toBe('2026-09-24T15:45:00Z');
    expect(fm.data.archived).toBe('2026-09-27');
    expect(fm.data.isaMaster).toBe('../../../ISA.md');
    expect(fm.data.progress).toEqual({ closed: 14, total: 14 });
  });

  test('leadgen 012: a quoted value keeps its inner spacing', () => {
    const fm = parseFrontmatter(read('leadgen/specs/012-pwa-install/spec.md'));
    expect(fm.data.principalStatedGoal?.endsWith('farben, etc. ')).toBe(true);
    expect(fm.data.principalStatedGoalSignal).toBe(3);
  });

  test('spectant-001: the frozen spec of this repository', () => {
    const fm = parseFrontmatter(read('spectant-001/specs/001-app-skeleton/spec.md'));
    expect(fm.data.slug).toBe('001-app-skeleton');
    expect(fm.data.progress).toEqual({ closed: 14, total: 47 });
    expect(fm.data.interviewInvoked).toBe(true);
  });

  test('tldr.md: a non-spec key lands in rest', () => {
    const fm = parseFrontmatter(read('harbor/specs/tldr.md'));
    expect(fm.rest).toEqual({ generated: '2026-03-07T18:00:00Z' });
    expect(fm.values).toEqual({ generated: '2026-03-07T18:00:00Z' });
  });
});

describe('values', () => {
  const fm = (lines: string[]) => parseFrontmatter(['---', ...lines, '---', '', '# Body'].join('\n'));

  test('a trailing # comment is dropped from an unquoted value, kept inside quotes', () => {
    const r = fm(['progress: 3/5 # counted by hand', 'isa_master: ../../ISA.md   # the master', 'task: "a # b"']);
    expect(r.data.progress).toEqual({ closed: 3, total: 5 });
    expect(r.data.isaMaster).toBe('../../ISA.md');
    expect(r.data.task).toBe('a # b');
    expect(r.values.progress).toBe('3/5');
  });

  test('double quotes unescape \\", single quotes are literal', () => {
    const r = fm(['task: "say \\"hi\\""', "slug: 'it\\'s'"]);
    expect(r.data.task).toBe('say "hi"');
    expect(r.data.slug).toBe("it\\");
  });

  test('migrated_from, archived_reason and an empty value', () => {
    const r = fm(['migrated_from: docs/old.md', 'archived_reason: superseded by 009', 'context_log:']);
    expect(r.data.migratedFrom).toBe('docs/old.md');
    expect(r.data.archivedReason).toBe('superseded by 009');
    expect(r.data.contextLog).toBe('');
  });

  test('CRLF line endings and a byte order mark parse like LF', () => {
    const r = parseFrontmatter('\uFEFF---\r\nslug: 001-x\r\nphase: scoping\r\n---\r\nbody\r\n');
    expect(r.data.slug).toBe('001-x');
    expect(r.data.phase).toBe('scoping');
    expect(r.body).toBe('body\n');
    expect(r.diagnostics).toEqual([]);
  });

  test('an empty block is present and empty', () => {
    const r = parseFrontmatter('---\n---\n# T\n');
    expect(r.present).toBe(true);
    expect(r.values).toEqual({});
    expect(r.body).toBe('# T\n');
    expect(r.bodyLine).toBe(3);
  });

  test('no frontmatter: not present, body is the whole text, no diagnostic', () => {
    const r = parseFrontmatter('# Title\n\ntext\n');
    expect(r.present).toBe(false);
    expect(r.body).toBe('# Title\n\ntext\n');
    expect(r.bodyLine).toBe(1);
    expect(r.diagnostics).toEqual([]);
    expect(r.data.slug).toBeNull();
  });
});

describe('diagnostics instead of throws', () => {
  const codes = (text: string) => parseFrontmatter(text).diagnostics.map((d) => `${d.severity}:${d.code}@${d.line ?? '-'}`);

  test('an unclosed block is an error and nothing is read from it', () => {
    const r = parseFrontmatter('---\nslug: 001-x\n# Title\n');
    expect(codes('---\nslug: 001-x\n# Title\n')).toEqual(['error:frontmatter-unclosed@1']);
    expect(r.present).toBe(false);
    expect(r.values).toEqual({});
    expect(r.body).toBe('---\nslug: 001-x\n# Title\n');
  });

  test('malformed progress, boolean and spec_type are warnings; the raw value stays readable', () => {
    const text = '---\nprogress: most/all\ncontext_sufficient: yes\nspec_type: epic\n---\n';
    expect(codes(text)).toEqual([
      'warning:frontmatter-progress@2',
      'warning:frontmatter-boolean@3',
      'warning:frontmatter-spec-type@4',
    ]);
    const r = parseFrontmatter(text);
    expect(r.data.progress).toBeNull();
    expect(r.data.contextSufficient).toBeNull();
    expect(r.data.specType).toBeNull();
    expect(r.values).toEqual({ progress: 'most/all', context_sufficient: 'yes', spec_type: 'epic' });
  });

  test('a line that is no key, a nested line, a duplicate key and an unterminated quote', () => {
    const text = '---\nslug: 001-a\njust words\n  nested: value\nslug: 001-b\ntask: "open\n---\n';
    expect(codes(text)).toEqual([
      'warning:frontmatter-line@3',
      'warning:frontmatter-nested@4',
      'warning:frontmatter-duplicate@5',
      'warning:frontmatter-quote@6',
    ]);
    const r = parseFrontmatter(text);
    expect(r.data.slug).toBe('001-b');
    expect(r.data.task).toBe('open');
  });

  test('a principal_stated_goal_signal that is no number is a warning', () => {
    expect(codes('---\nprincipal_stated_goal_signal: high\n---\n')).toEqual(['warning:frontmatter-number@2']);
  });

  test('a progress whose closed count exceeds its total is a warning', () => {
    expect(codes('---\nprogress: 5/3\n---\n')).toEqual(['warning:frontmatter-progress@2']);
  });

  test('comment and blank lines inside the block are ignored', () => {
    expect(codes('---\n# a comment\n\nslug: 001-x\n---\n')).toEqual([]);
  });
});

describe('milestone key', () => {
  test('a milestone name parses as a string; a spec without the key yields null and no diagnostic', () => {
    const withKey = parseFrontmatter('---\nslug: 004-x\nmilestone: Harbor 1.0\n---\n# X\n');
    expect(withKey.data.milestone).toBe('Harbor 1.0');
    expect(withKey.diagnostics).toEqual([]);
    const without = parseFrontmatter('---\nslug: 004-x\n---\n# X\n');
    expect(without.data.milestone).toBeNull();
    expect(without.diagnostics).toEqual([]);
  });
});

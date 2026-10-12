// The story folder `specs/ideas/` (spec 008): the stories as `IdeaRef`s (ISC-124, T51), the README index checked
// against the files in both directions (ISC-125, T52), and this repository's own shaped ideas (ISC-128.1, T53). Probes
// by name: "story" (T51), "index" (T52), "shaped" (T53). The folder is read here, in the test; `readIdeas` stays pure.
import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { readIdeas } from '../src/ideas.ts';
import type { IdeaRef, IdeasReading } from '../src/files.ts';
import { FIXTURES, ideaFilesAt } from './helpers/read-tree.ts';

const harbor = (): Record<string, string> => ideaFilesAt(join(FIXTURES, 'harbor'));

/** `file: code subject` for every diagnostic of a reading. */
const codes = (reading: IdeasReading): string[] =>
  reading.diagnostics.map((d) => `${d.file}: ${d.diagnostic.code}${d.diagnostic.subject === undefined ? '' : ` ${d.diagnostic.subject}`}`);

describe('ideas: story (T51, ISC-124)', () => {
  test('story: harbor has two stories with slug, title, type, feature, milestone, priority and path', () => {
    const expected: IdeaRef[] = [
      {
        slug: 'console-audit-log',
        title: 'Every change made in the web console is written to an audit log a teammate can read back.',
        type: 'feature',
        feature: 'F2',
        milestone: 'Harbor 2.0',
        priority: 'P3',
        path: 'specs/ideas/console-audit-log.md',
      },
      {
        slug: 'registry-webhooks',
        title: 'A push to an upstream repository triggers a sync of that repository within a minute, without waiting for the schedule.',
        type: 'feature',
        feature: 'F7',
        milestone: 'Harbor 1.0',
        priority: 'P2',
        path: 'specs/ideas/registry-webhooks.md',
      },
    ];
    expect(readIdeas(harbor()).ideas).toEqual(expected);
  });

  test('story: the README is the index, never a story', () => {
    expect(readIdeas(harbor()).ideas.some((i) => i.slug === 'README')).toBe(false);
  });

  test('story: a file without frontmatter is skipped with one file-keyed ideas-frontmatter warning', () => {
    const reading = readIdeas({ ...harbor(), 'loose-notes.md': '# Loose notes\n\nNot shaped yet.\n' });
    expect(reading.ideas.map((i) => i.slug)).toEqual(['console-audit-log', 'registry-webhooks']);
    const skipped = reading.diagnostics.filter((d) => d.diagnostic.code === 'ideas-frontmatter');
    expect(skipped).toHaveLength(1);
    expect(skipped[0]).toMatchObject({ file: 'specs/ideas/loose-notes.md', diagnostic: { severity: 'warning', subject: 'loose-notes' } });
  });

  test('story: absent keys read as null and P3, an unknown type as null; frontmatter findings are carried per file', () => {
    const files = {
      'README.md': '| Story | Milestone | Priority | Spec |\n|---|---|---|---|\n| bare | — | P3 | — |\n| odd | — | P3 | — |\n',
      'bare.md': '---\nstatus: idea\n---\n## Goal (one sentence)\n<!-- one sentence -->\n\nA bare story.\n',
      'odd.md': '---\ntype: epic\npriority: high\n---\nNo goal heading here.\n',
    };
    const reading = readIdeas(files);
    expect(reading.ideas).toEqual([
      { slug: 'bare', title: 'A bare story.', type: null, feature: null, milestone: null, priority: 'P3', path: 'specs/ideas/bare.md' },
      { slug: 'odd', title: 'odd', type: null, feature: null, milestone: null, priority: 'P3', path: 'specs/ideas/odd.md' },
    ]);
    expect(codes(reading)).toEqual(['specs/ideas/odd.md: frontmatter-priority']);
  });

  test('story: an empty folder gives no ideas and no diagnostics', () => {
    expect(readIdeas({})).toEqual({ ideas: [], diagnostics: [] });
  });

  test('story: only `<slug>.md` files directly in the folder are read', () => {
    expect(readIdeas({ 'README.md': '', 'notes.txt': '---\ntype: bug\n---\n', '.DS_Store': 'x', 'sub/deep.md': '---\n---\n' })).toEqual({
      ideas: [],
      diagnostics: [],
    });
  });
});

describe('ideas: index (T52, ISC-125)', () => {
  test('index: harbor has exactly one ideas-index warning, for registry-webhooks', () => {
    const index = readIdeas(harbor()).diagnostics.filter((d) => d.diagnostic.code === 'ideas-index');
    expect(index).toHaveLength(1);
    expect(index[0]).toMatchObject({ file: 'specs/ideas/README.md', diagnostic: { severity: 'warning', subject: 'registry-webhooks' } });
  });

  test('index: a name in the index without a file is one ideas-index warning', () => {
    const files = harbor();
    const reading = readIdeas({ ...files, 'README.md': `${files['README.md'] ?? ''}| ghost-story | — | P4 | — |\n` });
    expect(codes(reading)).toEqual(['specs/ideas/README.md: ideas-index registry-webhooks', 'specs/ideas/README.md: ideas-index ghost-story']);
  });

  test('index: a started story (its Spec column names a number) needs no file; links and backticks name the slug', () => {
    const files = {
      'README.md': [
        '# Ideas',
        '',
        '## F1 · One',
        '',
        '| Story | Milestone | Priority | Spec |',
        '|-------|-----------|----------|------|',
        '| [linked](linked.md) | — | P3 | — |',
        '| `ticked` | — | P3 | — |',
        '| started-story | — | P2 | 012 |',
        '',
        '## F2 · Two',
        '',
        '| Story | Milestone | Priority | Spec |',
        '|-------|-----------|----------|------|',
        '| second-table | — | P3 | — |',
        '',
      ].join('\n'),
      'linked.md': '---\nfeature: F1\n---\n',
      'ticked.md': '---\nfeature: F1\n---\n',
      'second-table.md': '---\nfeature: F2\n---\n',
    };
    expect(readIdeas(files).diagnostics).toEqual([]);
  });

  test('index: a missing README leaves every story unnamed, one ideas-index warning each', () => {
    const files = harbor();
    delete files['README.md'];
    expect(codes(readIdeas(files))).toEqual([
      'specs/ideas/README.md: ideas-index console-audit-log',
      'specs/ideas/README.md: ideas-index registry-webhooks',
    ]);
  });
});

// T53 (ISC-128.1): this repository's own `specs/ideas/` is untracked planning material, so the test reads it at run
// time and skips where it is absent (a fresh clone, an agent worktree). Nothing from those files is quoted here.
// A shaped idea is in one of two forms (FORMAT.md § idea, Allocation): still a story, parsed by `readIdeas` with its
// `## Shaping record` in the file; or started, its file removed, the index's row naming the spec (so no `ideas-index`
// warning), and the record carried into the new spec folder's `context.md` or `spec.md`.
const REPO_ROOT = join(import.meta.dir, '..', '..');
const SPECS = join(REPO_ROOT, 'specs');
const SHAPED = ['answer-in-app', 'mcp-endpoint', 'model-panel', 'agent-step-feed'];
const SHAPING = /^#{2,3} Shaping record\b/m;

/** The texts of the started spec folder `specs/NNN-<slug>/` that may carry the record; empty when there is none. */
function startedTexts(slug: string): string[] {
  const folder = readdirSync(SPECS).find((name) => /^\d{3}-/.test(name) && name.slice(4) === slug);
  if (folder === undefined) return [];
  return ['context.md', 'spec.md'].map((f) => join(SPECS, folder, f)).filter((p) => existsSync(p)).map((p) => readFileSync(p, 'utf8'));
}

describe('ideas: shaped (T53, ISC-128.1)', () => {
  test.skipIf(!existsSync(join(SPECS, 'ideas')))('shaped: the four shaped ideas parse as stories, or were started, and keep their Shaping record', () => {
    const files = ideaFilesAt(REPO_ROOT);
    const reading = readIdeas(files);
    for (const slug of SHAPED) {
      const idea = reading.ideas.find((i) => i.slug === slug);
      if (idea !== undefined) {
        expect({ slug, titled: idea.title !== slug, shaping: SHAPING.test(files[`${slug}.md`] ?? '') }).toEqual({ slug, titled: true, shaping: true });
        expect(reading.diagnostics.filter((d) => d.file === idea.path && d.diagnostic.severity === 'error')).toEqual([]);
      } else {
        const texts = startedTexts(slug);
        expect({ slug, started: texts.length > 0, shaping: texts.some((t) => SHAPING.test(t)) }).toEqual({ slug, started: true, shaping: true });
      }
      expect({ slug, indexed: !reading.diagnostics.some((d) => d.diagnostic.code === 'ideas-index' && d.diagnostic.subject === slug) }).toEqual({
        slug,
        indexed: true,
      });
    }
  });
});

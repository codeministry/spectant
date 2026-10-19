// The templates `/spec init` fills: the project master `ISA.md` and `specs/constitution.md` (spec 031, T30, ISC-40).
// Each template is rendered with sample values and read back through core's own parsers, so a file `/spec init`
// writes from it is one the dashboard and every later subcommand can read. No second parser here: frontmatter and
// claims go through `core/`, table rows through core's `tableCells`.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseClaims } from '../../core/src/claims.ts';
import { parseFrontmatter } from '../../core/src/frontmatter.ts';
import { tableCells } from '../../core/src/markdown.ts';

const DIR = join(import.meta.dir, '..', 'spectant', 'skills', 'spec', 'templates');
const read = (name: string): string => readFileSync(join(DIR, name), 'utf8');

const PLACEHOLDER = /\{\{([a-z_]+)\}\}/g;

/** One sample value per placeholder the templates may use; README.md lists the same names. */
const SAMPLE: Readonly<Record<string, string>> = {
  project: 'quill',
  title: 'Quill',
  task: 'Turn meeting notes into a weekly digest with Quill',
  stated_goal: 'Every Monday I want last week\'s notes as one digest that fits on one screen.',
  slug: '20260304-quill',
  now: '2026-03-04T08:00:00Z',
  today: '2026-03-04',
  problem: 'Meeting notes pile up in one folder and nobody reads them again.',
  vision: 'One command turns a week of notes into one digest.',
  out_of_scope: 'A hosted service.',
  principle: 'Notes stay on the machine they were written on.',
  constraint: 'Bun and TypeScript only.',
  goal: 'Every Monday, the notes of the week before become one digest that fits on one screen.',
  cross_cutting_why: 'what would break trust in any release, whichever feature slipped.',
  repo: 'quill',
  standards_version: 'none',
  design_track: 'none',
  stack: '[bun, typescript]',
  prose_language: 'English',
  sources_note: 'No house standards were available; every row below is a repo source.',
  claude_md_governs: 'conventions, hard limits, the commit rule',
  rule: 'R-01 bun only',
  rule_source: 'repo `CLAUDE.md`',
  rule_probe: '`bun run check:static`',
  static_command: '`bun run check:static`',
  quick_command: '`bun run verify:quick`',
  full_command: '`bun run verify`',
  lane: 'cli',
  lane_paths: '`src/`, `tests/`',
  lane_context: '`CLAUDE.md`',
  lane_probe: '`bun test`',
};

function render(template: string): string {
  return template.replace(PLACEHOLDER, (whole, name: string) => SAMPLE[name] ?? whole);
}

function placeholders(text: string): string[] {
  return [...new Set([...text.matchAll(PLACEHOLDER)].map((m) => m[1] ?? ''))].sort();
}

/** Level-two headings in file order. */
function headings(text: string): string[] {
  return text
    .split('\n')
    .filter((l) => l.startsWith('## '))
    .map((l) => l.slice(3).trim());
}

/** The first table row after the given level-two heading, before the next one. */
function firstTableRow(text: string, heading: string): string | null {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l.trim() === `## ${heading}`);
  if (start < 0) return null;
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('## ')) return null;
    if (/^\s*\|/.test(line)) return line;
  }
  return null;
}

const ISA_SECTIONS = [
  'Problem',
  'Vision',
  'Out of Scope',
  'Principles',
  'Constraints',
  'Goal',
  'Not yet specified',
  'Test Strategy',
  'Features',
  'Decisions',
  'Verification',
  'Remaining Work',
];

const CONSTITUTION_SECTIONS = [
  'What a spec may contain',
  'Binding sources',
  'Non-negotiables',
  'Adaptations',
  'Conformance baseline',
  'Gates',
  'Lanes',
  'How specs are held to it',
];

const PROBE_COLUMNS = ['isc', 'type', 'check', 'threshold', 'tool', 'anchors_to', 'severity'];

describe('ISA template (ISC-40)', () => {
  const raw = read('master.md');
  const text = render(raw);

  test('every placeholder has a sample value, so the render leaves none behind', () => {
    expect(placeholders(text)).toEqual([]);
  });

  test('the frontmatter parses without a diagnostic and starts at 0/0', () => {
    const fm = parseFrontmatter(text);
    expect(fm.present).toBe(true);
    expect(fm.diagnostics).toEqual([]);
    expect(fm.data.task).toBe(SAMPLE.task ?? null);
    expect(fm.data.slug).toBe(SAMPLE.slug ?? null);
    expect(fm.data.phase).toBe('scoping');
    expect(fm.data.progress).toEqual({ closed: 0, total: 0 });
    expect(fm.data.principalStatedGoal).toBe(SAMPLE.stated_goal ?? null);
    expect(fm.rest.project).toBe(SAMPLE.project);
  });

  test('the master sections stand in order', () => {
    expect(headings(text)).toEqual(ISA_SECTIONS);
  });

  test('the claims section parses to 0 claims, with the F0 block and no diagnostic', () => {
    const doc = parseClaims(text);
    expect(doc.diagnostics).toEqual([]);
    expect(doc.section?.heading).toBe('Features');
    expect(doc.claims).toHaveLength(0);
    expect(doc.counted).toEqual({ closed: 0, total: 0 });
    expect(doc.features.map((f) => [f.id, f.name, f.why])).toEqual([['F0', 'Cross-cutting', SAMPLE.cross_cutting_why ?? null]]);
    expect(doc.testStrategy).toHaveLength(0);
    expect(doc.verification).toHaveLength(0);
    expect(doc.idlessBoxes).toBe(0);
  });

  test('the Test Strategy header has exactly the seven positional columns', () => {
    const header = firstTableRow(text, 'Test Strategy');
    expect(header).not.toBeNull();
    expect(tableCells(header ?? '')).toEqual(PROBE_COLUMNS);
  });
});

describe('constitution template (ISC-40)', () => {
  const raw = read('constitution.md');
  const text = render(raw);

  test('every placeholder has a sample value, so the render leaves none behind', () => {
    expect(placeholders(text)).toEqual([]);
  });

  test('the frontmatter parses without a diagnostic', () => {
    const fm = parseFrontmatter(text);
    expect(fm.present).toBe(true);
    expect(fm.diagnostics).toEqual([]);
    expect(fm.rest.repo).toBe(SAMPLE.repo);
    expect(fm.rest.derived).toBe(SAMPLE.now);
    expect(fm.rest.standards_version).toBe(SAMPLE.standards_version);
  });

  test('the constitution sections stand in order', () => {
    expect(headings(text)).toEqual(CONSTITUTION_SECTIONS);
  });

  test('the body holds no claim and no diagnostic', () => {
    const doc = parseClaims(text);
    expect(doc.diagnostics).toEqual([]);
    expect(doc.claims).toHaveLength(0);
    expect(doc.idlessBoxes).toBe(0);
  });

  test('Gates names the static, quick and full tiers; Lanes has the four columns the task grammar reads', () => {
    expect(tableCells(firstTableRow(text, 'Gates') ?? '')).toEqual(['Tier', 'Command', 'Runs when']);
    expect(tableCells(firstTableRow(text, 'Lanes') ?? '')).toEqual(['Lane', 'Path prefixes', 'Context a worker loads', 'Lane probe']);
    const tiers = text
      .split('\n')
      .filter((l) => /^\| (static|quick|full) \|/.test(l))
      .map((l) => tableCells(l)[0]);
    expect(tiers).toEqual(['static', 'quick', 'full']);
  });
});

describe('templates README', () => {
  const readme = read('README.md');

  test('lists every placeholder the two templates use, and no other', () => {
    const used = placeholders(read('master.md') + read('constitution.md'));
    expect(placeholders(readme)).toEqual(used);
  });

  test('every listed placeholder has a sample value here', () => {
    expect(placeholders(readme).filter((name) => !(name in SAMPLE))).toEqual([]);
  });
});

describe('templates are generic', () => {
  test('no home path, no private tooling, no html', () => {
    for (const name of ['master.md', 'constitution.md', 'README.md']) {
      const text = read(name);
      expect(text).not.toMatch(/~\/|\/Users\/|\/home\/|LIFEOS|LifeOS|\.html\b/);
    }
  });
});

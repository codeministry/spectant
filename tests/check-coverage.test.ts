// check:coverage (spec 008, T2, ISC-126 and ISC-128): every heading of the three planning sources and every view and
// doc of the prototype is mapped in `specs/008-spectant-complete/artifacts/coverage.md`; `--free-specs` proves each
// Free story has its spec folder. The sources are private and untracked, so every case here builds a synthetic tree
// in a temp directory and runs the real script against it with `--root`; the pure helpers get small strings.
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { headingsOf, normaliseHeading, parseCoverage } from '../scripts/check-coverage.ts';

const SCRIPT = join(import.meta.dir, '..', 'scripts', 'check-coverage.ts');
const COVERAGE = 'specs/008-spectant-complete/artifacts/coverage.md';
const PROTO = 'specs/001-app-skeleton/.design/prototype/spectant-ui';

const tmp = mkdtempSync(join(tmpdir(), 'check-coverage-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

let counter = 0;
/** A fresh tree under the temp directory with the given files (repository-relative path → text). */
function tree(files: Record<string, string>): string {
  counter += 1;
  const root = join(tmp, `t${counter}`);
  mkdirSync(root, { recursive: true });
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

function run(root: string, ...args: string[]): { code: number; stdout: string; stderr: string; out: string } {
  // cwd is the temp tree too, so a missing --root would still not see this repository's own sources.
  const proc = Bun.spawnSync(['bun', SCRIPT, '--root', root, ...args], { cwd: root });
  const stdout = proc.stdout.toString();
  const stderr = proc.stderr.toString();
  return { code: proc.exitCode, stdout, stderr, out: stdout + stderr };
}

const ROADMAP = [
  '# Product ideas',
  '',
  '## 1. Guard rails',
  '',
  '```markdown',
  '## Not a heading inside a fence',
  '```',
  '',
  '#### - [ ] A1 Measure the baseline · tool · Free',
  '#### - [x] A2 Ship the CLI · tool · Free · belongs to F4',
  '#not-a-heading',
  '',
].join('\n');
const OUTLINE = ['### Workflow', '', '#### Steps & Status', '', '## Licence FREE | PRO | MAX', ''].join('\n');
const NOTES = ['---', 'title: x', '# yaml comment, not a heading', '---', '## Notes', ''].join('\n');

function without(files: Record<string, string>, path: string): Record<string, string> {
  return Object.fromEntries(Object.entries(files).filter(([p]) => p !== path));
}

/** Every source present, fully mapped. */
function fullTree(extra: Record<string, string> = {}, rows?: string[]): Record<string, string> {
  const mapping = rows ?? [
    '| roadmap | Product ideas | drop | the title |',
    '| roadmap | 1. Guard rails | decision:2026-10-11 | |',
    '| roadmap | A1 Measure the baseline | story:token-baseline | |',
    '| roadmap | `A2 Ship the CLI` | F14, story:core-cli | |',
    '| outline | workflow | F10 | |',
    '| outline | Steps & Status | F10 | |',
    '| outline | Licence FREE \\| PRO \\| MAX | F20 | |',
    '| notes | Notes | drop | the section title |',
    '| view | board-flow.html | spec:008 | |',
    '| view | `help.html` | F22 | |',
    '| doc | 01-VIEWS.md | spec:001 | |',
    '| doc | 03-DATA.md | spec:002 | |',
  ];
  return {
    'spectant-produktideen.md': ROADMAP,
    'specs/notes/outline.md': OUTLINE,
    'specs/notes/notizen.md': NOTES,
    [`${PROTO}/board-flow.html`]: '<html></html>',
    [`${PROTO}/help.html`]: '<html></html>',
    [`${PROTO}/styles.css`]: 'body {}',
    [`${PROTO}/docs/00-START.md`]: '# Start',
    [`${PROTO}/docs/01-VIEWS.md`]: '# Views',
    [`${PROTO}/docs/03-DATA.md`]: '# Data',
    [`${PROTO}/docs/04-DESIGN.md`]: '# Design',
    [COVERAGE]: ['# Coverage', '', '| Source | Entry | Target | Reason |', '|---|---|---|---|', ...mapping, ''].join('\n'),
    ...extra,
  };
}

describe('normaliseHeading and headingsOf', () => {
  test('strips hashes, checkbox markers, the trailing annotation and case', () => {
    expect(normaliseHeading('#### - [ ] A1 Measure  the baseline · tool · Free')).toBe('a1 measure the baseline');
    expect(normaliseHeading('## - [x] Done thing ##')).toBe('done thing');
    expect(normaliseHeading('  ### Workflow  ')).toBe('workflow');
    expect(normaliseHeading('Licence FREE | PRO | MAX')).toBe('licence free | pro | max');
  });

  test('finds headings outside fences and frontmatter, with their line numbers', () => {
    expect(headingsOf(ROADMAP).map((h) => h.line)).toEqual([1, 3, 9, 10]);
    expect(headingsOf(NOTES)).toEqual([{ line: 5, entry: 'notes' }]);
  });

  test('a leading thematic break is not frontmatter and hides no heading', () => {
    expect(headingsOf('---\n\n## One\n\n---\n\n## Two\n').map((h) => h.line)).toEqual([3, 7]);
  });

  test('parses the mapping table, unescapes pipes and rejects bad rows', () => {
    const text = [
      '| Other | Table |',
      '|---|---|',
      '| roadmap | ignored, not the coverage table |',
      '',
      '| Source | Entry | Target | Reason |',
      '| --- | --- | --- | --- |',
      '| outline | A \\| B | F1 | |',
      '| view | x.html | drop | |',
      '| shelf | y | F1 | |',
      '| notes | z | nowhere | |',
    ].join('\n');
    const { rows, problems } = parseCoverage(text);
    expect(rows).toEqual([{ line: 7, source: 'outline', entry: 'a | b' }]);
    expect(problems).toEqual(['coverage.md:8: drop without reason', 'coverage.md:9: unknown source', 'coverage.md:10: invalid target']);
  });
});

describe('check-coverage', () => {
  test('sources absent: exit 0 and says so', () => {
    const { code, stdout } = run(tree({ 'README.md': '# x' }));
    expect(stdout).toContain('sources absent');
    expect(code).toBe(0);
  });

  test('every heading, view and doc mapped: exit 0 with counts per source', () => {
    const { code, out } = run(tree(fullTree()));
    expect(out).toContain('roadmap: 4 entries, 4 mapped');
    expect(out).toContain('outline: 3 entries, 3 mapped');
    expect(out).toContain('notes: 1 entry, 1 mapped');
    expect(out).toContain('view: 2 entries, 2 mapped');
    expect(out).toContain('doc: 2 entries, 2 mapped');
    expect(out).not.toContain(': unmapped');
    expect(out).toContain('unmapped: 0');
    expect(code).toBe(0);
  });

  test('an unmapped heading and an unmapped view fail by line, never by text', () => {
    const extra = { 'specs/notes/outline.md': `${OUTLINE}\n### Secret customer heading\n`, [`${PROTO}/zeta.html`]: '' };
    const { code, out } = run(tree(fullTree(extra)));
    expect(out).toContain('outline: 4 entries, 3 mapped');
    expect(out).toContain('outline:7: unmapped');
    expect(out).toContain('view: 3 entries, 2 mapped');
    expect(out).toContain('view:3: unmapped');
    expect(out).toContain('unmapped: 2');
    expect(out.toLowerCase()).not.toContain('secret');
    expect(out).not.toContain('zeta');
    expect(code).toBe(1);
  });

  test('a row whose entry no present source carries is stale', () => {
    const rows = [...(fullTree()[COVERAGE] ?? '').split('\n').filter((l) => l.startsWith('| ') && !l.startsWith('| Source')), '| notes | Gone private heading | F1 | |'];
    const { code, out } = run(tree(fullTree({}, rows)));
    expect(out).toMatch(/coverage\.md:\d+: stale/);
    expect(out.toLowerCase()).not.toContain('gone private');
    expect(code).toBe(1);
  });

  test('some sources absent: checks the rest, lists the missing ones, keeps their rows', () => {
    const { code, out } = run(tree(without(fullTree(), 'specs/notes/notizen.md')));
    expect(out).toContain('notes: absent');
    expect(out).toContain('roadmap: 4 entries, 4 mapped');
    expect(out).not.toContain(': stale');
    expect(out).toContain('stale: 0');
    expect(code).toBe(0);
  });

  test('sources present but no coverage.md: every entry unmapped', () => {
    const { code, out } = run(tree(without(fullTree(), COVERAGE)));
    expect(out).toContain('coverage.md: absent');
    expect(out).toContain('roadmap: 4 entries, 0 mapped');
    expect(code).toBe(1);
  });

  test('spec 008 archived: the mapping is read from specs/archive/', () => {
    const full = fullTree();
    const archived = { ...without(full, COVERAGE), [`specs/archive/${COVERAGE.slice('specs/'.length)}`]: full[COVERAGE] ?? '' };
    const { code, out } = run(tree(archived));
    expect(out).not.toContain('coverage.md: absent');
    expect(out).toContain('roadmap: 4 entries, 4 mapped');
    expect(out).toContain('unmapped: 0');
    expect(code).toBe(0);
  });

  test('spec 001 archived: views and docs are read from specs/archive/', () => {
    const archived = Object.fromEntries(
      Object.entries(fullTree()).map(([p, t]) => [p.startsWith(PROTO) ? `specs/archive/${p.slice('specs/'.length)}` : p, t]),
    );
    const { code, out } = run(tree(archived));
    expect(out).toContain('view: 2 entries, 2 mapped');
    expect(out).toContain('doc: 2 entries, 2 mapped');
    expect(code).toBe(0);
  });

  test('a usage error exits 2', () => {
    expect(run(tree({}), '--bogus').code).toBe(2);
  });
});

describe('check-coverage --free-specs', () => {
  const story = (milestone: string): string => `---\ntype: feature\nfeature: F15\nmilestone: ${milestone}\npriority: P2\nstatus: idea\n---\n/spec\n`;

  test('no specs/ideas: sources absent, exit 0', () => {
    const { code, stdout } = run(tree({ 'README.md': '# x' }), '--free-specs');
    expect(stdout).toContain('sources absent');
    expect(code).toBe(0);
  });

  /** `specs/ideas/README.md`: one table per feature block, columns Story | Milestone | Priority | Spec (T164). */
  const index = (...blocks: ReadonlyArray<readonly string[]>): string =>
    [
      '# Ideas',
      '',
      ...blocks.flatMap((rows, i) => [`## F${i + 1} · Block`, '', '| Story | Milestone | Priority | Spec |', '|-------|-----------|----------|------|', ...rows, '']),
    ].join('\n');

  test('Free rows across every table: a story file, or an allocated row whose folder has context.md and a claimless spec.md: exit 0', () => {
    const root = tree({
      'specs/ideas/README.md': index(
        ['| alpha | Free | P2 | 009 |', '| beta | Pro | P3 | — |'],
        ['| `gamma` | `Free` | P2 | [010](../010-gamma/) |', '| [delta](delta.md) | Free | P1 | — |', '| epsilon | Free | P2 | 011-epsilon |'],
      ),
      'specs/ideas/beta.md': story('Pro'),
      'specs/ideas/delta.md': story('"Free"'),
      'specs/009-alpha/context.md': '# ctx',
      'specs/009-alpha/spec.md': '---\nmilestone: Free\n---\n## Acceptance\n- one criterion as prose\n',
      'specs/010-gamma/context.md': '# ctx',
      'specs/010-gamma/spec.md': '# gamma\n',
      'specs/011-epsilon/context.md': '# ctx',
      'specs/011-epsilon/spec.md': '# epsilon\n',
    });
    const { code, out } = run(root, '--free-specs');
    expect(out).toContain('free-specs: 4 Free stories checked, 0 problems');
    expect(code).toBe(0);
  });

  test('an allocated row without its folder fails, and so does a row with neither story file nor spec', () => {
    const root = tree({
      'specs/ideas/README.md': index(['| alpha | Free | P2 | 012 |', '| beta | Free | P2 | — |', '| gamma | Free | P2 | |']),
      'specs/ideas/gamma.md': story('Free'),
    });
    const { code, out } = run(root, '--free-specs');
    expect(out).toContain('specs/ideas/README.md:7: alpha: spec 012 has no folder in specs/');
    expect(out).toContain('specs/ideas/README.md:8: beta: no story file and no spec');
    expect(out).not.toContain('gamma');
    expect(out).toContain('free-specs: 3 Free stories checked, 2 problems');
    expect(code).toBe(1);
  });

  test('an allocated folder without context.md, or whose spec.md has claims, fails', () => {
    const root = tree({
      'specs/ideas/README.md': index(['| beta | Free | P2 | 011 |', '| gamma | Free | P2 | 012-gamma |']),
      'specs/011-beta/spec.md': '# beta\n',
      'specs/012-gamma/context.md': '# ctx',
      'specs/012-gamma/spec.md': '# gamma\n\n## Claims\n\n- [ ] ISC-1: a claim\n',
    });
    const { code, out } = run(root, '--free-specs');
    expect(out).toContain('specs/011-beta: no context.md');
    expect(out).toContain('specs/012-gamma/spec.md: 1 claim');
    expect(out).toContain('free-specs: 2 Free stories checked, 2 problems');
    expect(code).toBe(1);
  });

  test('a Free story file the index does not name fails; an unnamed story of another milestone does not', () => {
    const root = tree({
      'specs/ideas/README.md': index(['| alpha | Free | P2 | — |']),
      'specs/ideas/alpha.md': story('Free'),
      'specs/ideas/zeta.md': story('Free'),
      'specs/ideas/eta.md': story('Pro'),
    });
    const { code, out } = run(root, '--free-specs');
    expect(out).toContain('specs/ideas/zeta.md: a Free story the index does not name');
    expect(out).not.toContain('ideas/eta.md');
    expect(out).toContain('free-specs: 2 Free stories checked, 1 problem');
    expect(code).toBe(1);
  });

  test('without an index every Free story file is unnamed', () => {
    const root = tree({ 'specs/ideas/alpha.md': story('Free') });
    const { code, out } = run(root, '--free-specs');
    expect(out).toContain('specs/ideas/alpha.md: a Free story the index does not name');
    expect(code).toBe(1);
  });
});

// The templates `/spec init` fills: the project master `ISA.md` and `specs/constitution.md` (spec 031, T30, ISC-40),
// and the six type templates `/spec new <type>` and `/spec idea` show and fill (T32, ISC-41).
// Each template is rendered with sample values and read back through core's own parsers, so a file `/spec init`
// writes from it is one the dashboard and every later subcommand can read. No second parser here: frontmatter and
// claims go through `core/`, table rows through core's `tableCells`.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseClaims } from '../../core/src/claims.ts';
import { parseFrontmatter } from '../../core/src/frontmatter.ts';
import { tableCells } from '../../core/src/markdown.ts';
import { specFolderText, type SpecTextType } from '../../core/src/spec-text.ts';

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
  number: '001',
  spec: '001-weekly-digest',
  feature: 'F1',
  fog: 'whether a digest of an empty week is sent at all',
  rollback: 'switch the timer off again; the notes folder is never changed, so nothing is lost',
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

const TYPES = ['bug', 'spike', 'refactor', 'feature', 'infra', 'project'] as const satisfies readonly SpecTextType[];
type Type = (typeof TYPES)[number];
const typeFile = (type: Type): string => `${type}.md`;

/** The sections each type's `spec.md` must carry (the type router). */
const REQUIRED_SECTIONS: Readonly<Record<Type, readonly string[]>> = {
  bug: ['Goal', 'Claims', 'Test Strategy'],
  spike: ['Problem', 'Goal', 'Not yet specified', 'Claims'],
  refactor: ['Problem', 'Out of Scope', 'Goal', 'Claims', 'Test Strategy'],
  feature: ['Problem', 'Vision', 'Out of Scope', 'Constraints', 'Goal', 'Claims', 'Test Strategy'],
  infra: ['Problem', 'Constraints', 'Goal', 'Claims', 'Test Strategy'],
  project: ['Problem', 'Vision', 'Out of Scope', 'Principles', 'Constraints', 'Goal', 'Claims', 'Test Strategy'],
};

/** The fields of each type's fill-in prompt, in order. `Goal (one sentence)` and `Open points` are in every one. */
const PROMPT_FIELDS: Readonly<Record<Type, readonly string[]>> = {
  bug: ['Type', 'Repo', 'Goal (one sentence)', 'Reproduction', 'Which promise broke', 'Must never happen again', 'Suspected cause (optional)', 'Open points'],
  spike: ['Type', 'Repo', 'The decision this spike makes possible', 'Goal (one sentence)', 'Problem', 'Candidates', 'How we find out', 'Already known or ruled out', 'Open points'],
  refactor: ['Type', 'Repo', 'Goal (one sentence)', 'Problem', 'Affected area', 'Behaviour that stays the same', 'Target structure (observable)', 'Out', 'Open points', 'Mode'],
  feature: ['Type', 'Repo', 'Goal (one sentence)', 'Problem', 'Vision', 'In', 'Out', 'Done looks like (observable)', 'Guard rails', 'What the repository does not know', 'Open points', 'Mode'],
  infra: ['Type', 'Repo', 'Goal (one sentence)', 'Problem', 'Affected systems', 'Done looks like (checked by a command)', 'Rollback', 'Guard rails', 'Open points', 'Mode'],
  project: ['Type', 'Repo', 'Goal (one sentence)', 'Problem and for whom', 'Vision', 'In and out', 'First signs of success', 'Guard rails', 'Already decided', 'Open points', 'Mode'],
};

/** The fenced block (four backticks, `markdown`) under the given level-two heading of a type template. */
function block(text: string, heading: string): string | null {
  const lines = text.split('\n');
  const at = lines.findIndex((l) => l.trim() === `## ${heading}`);
  if (at < 0) return null;
  const open = lines.findIndex((l, i) => i > at && l === '````markdown');
  if (open < 0) return null;
  const close = lines.findIndex((l, i) => i > open && l === '````');
  return close < 0 ? null : lines.slice(open + 1, close).join('\n');
}

/** The text with every fenced block's lines (fences included) left out: the template's own structure. */
function unfenced(text: string): string {
  let open = false;
  return text
    .split('\n')
    .filter((line) => {
      if (line.startsWith('````')) {
        open = !open;
        return false;
      }
      return !open;
    })
    .join('\n');
}

describe('type templates (ISC-41)', () => {
  for (const type of TYPES) {
    describe(type, () => {
      const raw = read(typeFile(type));
      const text = render(raw);
      const prompt = block(raw, 'Prompt') ?? '';
      const skeleton = block(text, 'spec.md') ?? '';

      test('holds the fill-in prompt and the spec.md skeleton, each in its own fenced block', () => {
        expect(headings(unfenced(raw))).toEqual(['Prompt', 'spec.md']);
        expect(block(raw, 'Prompt')).not.toBeNull();
        expect(block(raw, 'spec.md')).not.toBeNull();
      });

      test('the prompt opens with its command, names its type and asks the fields of its type', () => {
        const lines = prompt.split('\n');
        expect(lines[0]).toBe(`/spec new ${type}`);
        expect(headings(prompt)).toEqual([...PROMPT_FIELDS[type]]);
        const typeAt = lines.indexOf('## Type');
        expect(lines[typeAt + 1]).toBe(type);
      });

      test('the prompt carries example values, no placeholder, and a comment under every field but its fixed type', () => {
        expect(placeholders(prompt)).toEqual([]);
        const lines = prompt.split('\n');
        lines.forEach((line, i) => {
          if (!line.startsWith('## ') || line === '## Type') return;
          const next = lines.findIndex((l, j) => j > i && l.startsWith('## '));
          const field = lines.slice(i + 1, next < 0 ? lines.length : next).join('\n');
          expect({ field: line, comment: /<!--[\s\S]*-->/.test(field) }).toEqual({ field: line, comment: true });
        });
      });

      test('every placeholder has a sample value, so the render leaves none behind', () => {
        expect(placeholders(text)).toEqual([]);
      });

      test('the skeleton parses through core without a diagnostic, claimless at 0/0', () => {
        const fm = parseFrontmatter(skeleton);
        expect(fm.present).toBe(true);
        expect(fm.diagnostics).toEqual([]);
        expect(fm.data.specType).toBe(type);
        expect(fm.data.stage).toBe('plan');
        expect(fm.data.phase).toBe('scoping');
        expect(fm.data.progress).toEqual({ closed: 0, total: 0 });
        expect(fm.data.slug).toBe(SAMPLE.spec ?? null);
        const doc = parseClaims(skeleton);
        expect(doc.diagnostics).toEqual([]);
        expect(doc.section?.heading).toBe('Claims');
        expect(doc.claims).toHaveLength(0);
        expect(doc.idlessBoxes).toBe(0);
        expect(doc.testStrategy).toHaveLength(0);
      });

      test('the skeleton carries the sections its type requires, in the order core plans them', () => {
        const planned = specFolderText({
          type,
          number: 1,
          slug: 'weekly-digest',
          title: SAMPLE.task ?? '',
          goal: SAMPLE.goal ?? '',
          feature: SAMPLE.feature ?? '',
          now: new Date(SAMPLE.now ?? ''),
          actor: 'u:test',
        }).files['spec.md'];
        const own = headings(skeleton);
        expect(own).toEqual(headings(planned));
        for (const name of REQUIRED_SECTIONS[type]) expect(own).toContain(name);
        expect(Object.keys(parseFrontmatter(skeleton).values)).toEqual(Object.keys(parseFrontmatter(planned).values));
      });

      test('the Test Strategy header has exactly the seven positional columns', () => {
        expect(tableCells(firstTableRow(skeleton, 'Test Strategy') ?? '')).toEqual(PROBE_COLUMNS);
      });
    });
  }

  test('infra asks for the rollback and writes it into the skeleton; spike turns its open points into fog', () => {
    expect(block(render(read('infra.md')), 'spec.md')).toContain(`- Rollback: ${SAMPLE.rollback ?? ''}`);
    expect(parseClaims(block(render(read('spike.md')), 'spec.md') ?? '').fog.map((f) => f.text)).toEqual([SAMPLE.fog ?? '']);
  });
});

describe('templates README', () => {
  const readme = read('README.md');

  test('lists every placeholder the templates use, and no other', () => {
    const used = placeholders(read('master.md') + read('constitution.md') + TYPES.map((t) => read(typeFile(t))).join(''));
    expect(placeholders(readme)).toEqual(used);
  });

  test('names each of the six type templates', () => {
    for (const type of TYPES) expect(readme).toContain(`| \`${type}.md\` |`);
  });

  test('every listed placeholder has a sample value here', () => {
    expect(placeholders(readme).filter((name) => !(name in SAMPLE))).toEqual([]);
  });
});

describe('templates are generic', () => {
  test('no home path, no private tooling, no html', () => {
    for (const name of ['master.md', 'constitution.md', 'README.md', ...TYPES.map(typeFile)]) {
      const text = read(name);
      expect(text).not.toMatch(/~\/|\/Users\/|\/home\/|LIFEOS|LifeOS|\.html\b/);
    }
  });
});

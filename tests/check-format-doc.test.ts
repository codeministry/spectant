// check:format-doc (spec 002, T2/T3, ISC-68.1): FORMAT.md has one section per file kind of core/src/files.ts, in
// that order, each with a fenced example that is either copied verbatim from a fixture or openly marked as having
// no fixture yet. Runs the real script against the real file, against a mutated copy missing one section, and the
// pure checker against small synthetic documents.
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FILE_KINDS, type FileKind } from '../core/src/files.ts';
import { checkFormatDoc } from '../scripts/check-format-doc.ts';

const ROOT = join(import.meta.dir, '..');
const SCRIPT = join(ROOT, 'scripts', 'check-format-doc.ts');
const FORMAT = join(ROOT, 'FORMAT.md');
const KINDS = Object.keys(FILE_KINDS) as FileKind[];

const tmp = mkdtempSync(join(tmpdir(), 'format-doc-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function run(file?: string): { code: number; stdout: string; stderr: string } {
  const proc = Bun.spawnSync(['bun', SCRIPT, ...(file === undefined ? [] : [file])], { cwd: ROOT });
  return { code: proc.exitCode, stdout: proc.stdout.toString(), stderr: proc.stderr.toString() };
}

/**
 * FORMAT.md without the section of `kind`: its heading up to the next kind heading. A plain `## ` search would stop
 * at a heading quoted inside the section's own fenced example and leave that fence open.
 */
function withoutSection(text: string, kind: FileKind): string {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l.startsWith(`## \`${kind}\``));
  if (start < 0) throw new Error(`FORMAT.md has no section for ${kind}`);
  const next = lines.findIndex((l, i) => i > start && l.startsWith('## `'));
  return [...lines.slice(0, start), ...lines.slice(next < 0 ? lines.length : next)].join('\n');
}

/** A minimal document: one section per kind, each with a no-fixture marker and a fenced block. */
function synthetic(kinds: readonly FileKind[], body: (kind: FileKind) => string = () => '**No fixture yet.**\n\n```text\nx\n```'): string {
  return kinds.map((k) => `## \`${k}\` — \`${FILE_KINDS[k].path}\`\n\n${body(k)}\n`).join('\n');
}

const fixtures: Record<string, string> = { 'core/fixtures/demo/spec.md': '---\ntask: "demo"\n---\n\n# 001 — Demo\n' };
const readFixture = (path: string): string | null => fixtures[path] ?? null;

describe('the real FORMAT.md', () => {
  test('documents every kind of files.ts and the script exits 0', () => {
    const { code, stdout, stderr } = run();
    expect(stderr).toBe('');
    expect(stdout).toStartWith(`format-doc: ${KINDS.length} kinds documented`);
    expect(code).toBe(0);
  });

  test('a copy missing one section fails and names the kind', () => {
    const copy = join(tmp, 'FORMAT.md');
    writeFileSync(copy, withoutSection(readFileSync(FORMAT, 'utf8'), 'plan'));
    const { code, stderr } = run(copy);
    expect(code).toBe(1);
    expect(stderr).toContain('plan: no section');
    expect(stderr).toContain(`${KINDS.length - 1} of ${KINDS.length} kinds documented`);
  });
});

describe('checkFormatDoc', () => {
  test('a complete synthetic document passes and lists the kinds without a fixture', () => {
    const report = checkFormatDoc(synthetic(KINDS), readFixture);
    expect(report.problems).toEqual([]);
    expect(report.documented).toEqual(KINDS);
    expect(report.noFixture).toEqual(KINDS);
  });

  test('a verbatim example is checked against its fixture', () => {
    const good = synthetic(KINDS, (k) =>
      k === 'spec' ? 'From `core/fixtures/demo/spec.md`:\n\n```markdown\ntask: "demo"\n---\n```' : '**No fixture yet.**\n\n```text\nx\n```',
    );
    const report = checkFormatDoc(good, readFixture);
    expect(report.problems).toEqual([]);
    expect(report.verbatim).toBe(1);
    expect(report.noFixture).not.toContain('spec');

    const drifted = good.replace('task: "demo"', 'task: "other"');
    const driftedProblems = checkFormatDoc(drifted, readFixture).problems;
    expect(driftedProblems).toHaveLength(1);
    expect(driftedProblems[0]).toContain('spec: example is not verbatim');
  });

  test('a fixture path that does not exist is a problem', () => {
    const doc = synthetic(KINDS, (k) => (k === 'plan' ? 'From `core/fixtures/demo/plan.md`:\n\n```markdown\nx\n```' : '**No fixture yet.**\n\n```text\nx\n```'));
    expect(checkFormatDoc(doc, readFixture).problems).toEqual(['plan: fixture core/fixtures/demo/plan.md does not exist']);
  });

  test('a section without a fenced example, or without a fixture or marker, is a problem', () => {
    const noFence = synthetic(KINDS, (k) => (k === 'tasks' ? '**No fixture yet.**' : '**No fixture yet.**\n\n```text\nx\n```'));
    expect(checkFormatDoc(noFence, readFixture).problems).toEqual(['tasks: no fenced example']);

    const noSource = synthetic(KINDS, (k) => (k === 'rounds' ? '```json\n{}\n```' : '**No fixture yet.**\n\n```text\nx\n```'));
    expect(checkFormatDoc(noSource, readFixture).problems).toEqual(['rounds: no verbatim fixture example and no "No fixture yet." marker']);
  });

  test('the heading must name the kind path from files.ts', () => {
    const doc = synthetic(KINDS).replace('## `master` — `../../ISA.md`', '## `master` — `ISA.md`');
    expect(checkFormatDoc(doc, readFixture).problems).toEqual(['master: section does not name its path `../../ISA.md`']);
  });

  test('unknown, duplicate and out-of-order kind headings are problems', () => {
    const unknown = `${synthetic(KINDS)}\n## \`notes\` — \`notes.md\`\n\n**No fixture yet.**\n\n\`\`\`text\nx\n\`\`\`\n`;
    expect(checkFormatDoc(unknown, readFixture).problems).toEqual(['notes: section for a kind files.ts does not have']);

    const dup = synthetic([...KINDS, 'spec']);
    expect(checkFormatDoc(dup, readFixture).problems).toContain('spec: more than one section');

    const swapped = synthetic(['plan', 'spec', ...KINDS.slice(2)]);
    expect(checkFormatDoc(swapped, readFixture).problems).toEqual(['spec: section out of files.ts order (expected before plan)']);
  });

  test('a heading inside a fenced block is not a section', () => {
    const doc = synthetic(KINDS.filter((k) => k !== 'evidence'), (k) =>
      k === 'artifacts' ? '**No fixture yet.**\n\n````markdown\n## `evidence` — `.evidence/`\n```text\nx\n```\n````' : '**No fixture yet.**\n\n```text\nx\n```',
    );
    const report = checkFormatDoc(doc, readFixture);
    expect(report.missing).toEqual(['evidence']);
    expect(report.problems).toEqual(['evidence: no section']);
  });
});

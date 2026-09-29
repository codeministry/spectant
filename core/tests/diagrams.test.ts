// The diagram verdict (spec 001 T38, ISC-16), per SpecFormat § Diagrams as the old SpecStatus `diagramVerdict()` read
// it: feature, infra and project need a mermaid fence in spec.md and plan.md (fail without), a refactor warns without
// one in spec.md, bug and spike are skipped, and a complete spec is never held to the rule. Measured on the fixtures
// against the verdicts core/fixtures/README.md states.
import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { diagramVerdict, type DiagramVerdict } from '../src/diagrams.ts';
import { parseFrontmatter } from '../src/frontmatter.ts';

const FIXTURES = join(import.meta.dir, '..', 'fixtures');

function verdictOf(rel: string): DiagramVerdict {
  const dir = join(FIXTURES, rel);
  const spec = readFileSync(join(dir, 'spec.md'), 'utf8');
  const plan = existsSync(join(dir, 'plan.md')) ? readFileSync(join(dir, 'plan.md'), 'utf8') : null;
  const { data } = parseFrontmatter(spec);
  return diagramVerdict({ type: data.specType, phase: data.phase, spec, plan });
}

describe('fixtures', () => {
  const cases: Array<[string, DiagramVerdict]> = [
    ['harbor/specs/002-web-console', { level: 'ok', missing: [] }],
    ['harbor/specs/003-config-loader', { level: 'warn', missing: ['spec.md'] }],
    ['harbor/specs/004-retention-policies', { level: 'fail', missing: ['plan.md'] }],
    ['harbor/specs/005-config-format-choice', { level: 'skip', missing: [] }],
    ['harbor/specs/006-partial-push', { level: 'skip', missing: [] }],
    ['harbor/specs/archive/001-manifest-sync', { level: 'skip', missing: [] }],
    ['lantern/specs/001-reading-list', { level: 'ok', missing: [] }],
    ['lantern/specs/002-duplicate-links', { level: 'skip', missing: [] }],
    ['leadgen/specs/012-pwa-install', { level: 'ok', missing: [] }],
    ['leadgen/specs/archive/013-tech-debt', { level: 'skip', missing: [] }],
    ['spectant-001/specs/001-app-skeleton', { level: 'ok', missing: [] }],
  ];
  for (const [rel, expected] of cases) {
    test(rel, () => expect(verdictOf(rel)).toEqual(expected));
  }
});

describe('the rule', () => {
  const fence = '# X\n\n```mermaid\nflowchart LR\n  a --> b\n```\n';
  const tilde = '# X\n\n~~~ mermaid\nflowchart LR\n~~~\n';
  const bare = '# X\n\nNo diagram, only `mermaid` in a code span.\n\n```ts\nconst mermaid = 1;\n```\n';

  test('feature, infra and project fail without a fence in either file, and name both', () => {
    for (const type of ['feature', 'infra', 'project'] as const) {
      expect(diagramVerdict({ type, phase: 'building', spec: bare, plan: bare })).toEqual({ level: 'fail', missing: ['spec.md', 'plan.md'] });
      expect(diagramVerdict({ type, phase: 'building', spec: fence, plan: null })).toEqual({ level: 'fail', missing: ['plan.md'] });
      expect(diagramVerdict({ type, phase: 'building', spec: tilde, plan: fence })).toEqual({ level: 'ok', missing: [] });
    }
  });

  test('a refactor warns without a fence in spec.md and never asks for one in plan.md', () => {
    expect(diagramVerdict({ type: 'refactor', phase: 'scoping', spec: bare, plan: bare })).toEqual({ level: 'warn', missing: ['spec.md'] });
    expect(diagramVerdict({ type: 'refactor', phase: 'scoping', spec: fence, plan: null })).toEqual({ level: 'ok', missing: [] });
  });

  test('bug, spike, an unknown type and a complete spec are skipped', () => {
    expect(diagramVerdict({ type: 'bug', phase: 'scoping', spec: bare, plan: null }).level).toBe('skip');
    expect(diagramVerdict({ type: 'spike', phase: 'scoping', spec: bare, plan: null }).level).toBe('skip');
    expect(diagramVerdict({ type: null, phase: 'scoping', spec: bare, plan: null }).level).toBe('skip');
    expect(diagramVerdict({ type: 'feature', phase: 'complete', spec: bare, plan: null })).toEqual({ level: 'skip', missing: [] });
  });
});

// The TL;DR facts (spec 074, ISC-621, T6): `tldrFacts` over the spec folders' texts names exactly the open specs, with
// the same stage and progress `buildDashboard` gives them, their `- fog:` lines and the caller's prototype and
// artifact paths. Pure: no file is read or written.
import { describe, expect, test } from 'bun:test';
import { buildDashboard } from '../src/dashboard.ts';
import { tldrFacts, type TldrFactsSpec } from '../src/tldr-facts.ts';

function spec(folder: string, opts: { title: string; phase: string; claims: string[]; fog?: string[] }): string {
  return [
    '---',
    `task: "${opts.title}"`,
    `slug: ${folder}`,
    'spec_type: feature',
    `phase: ${opts.phase}`,
    'updated: 2026-03-08T16:45:00Z',
    '---',
    '',
    `# ${folder}`,
    '',
    '## Goal',
    '',
    'A goal.',
    '',
    '## Claims',
    '',
    ...opts.claims,
    '',
    '## Not yet specified',
    '',
    ...(opts.fog ?? []).map((f) => `- fog: ${f}`),
    '',
  ].join('\n');
}

const folder = (name: string, text: string, extra: Partial<TldrFactsSpec> = {}): TldrFactsSpec => ({
  folder: name,
  texts: { spec: text },
  archived: false,
  prototypes: [],
  artifacts: [],
  ...extra,
});

const specs: TldrFactsSpec[] = [
  // Out of number order on purpose: the facts come sorted.
  folder(
    '003-gamma',
    spec('003-gamma', { title: 'Gamma', phase: 'building', claims: ['- [x] ISC-5: five', '- [ ] ISC-6: six'] }),
    { artifacts: ['003-gamma/artifacts/report.json', '003-gamma/artifacts/a.txt'] },
  ),
  folder(
    '001-alpha',
    spec('001-alpha', {
      title: 'Alpha',
      phase: 'building',
      claims: ['- [x] ISC-1: one', '- [ ] ISC-2: two', '- [ ] ISC-3: three'],
      fog: ['Which store? — a benchmark decides ⟨?: since round 1⟩', 'How many retries? — the owner'],
    }),
    { prototypes: ['001-alpha/.design/prototype/index.html'] },
  ),
  folder('002-beta', spec('002-beta', { title: 'Beta', phase: 'planning', claims: ['- [ ] ISC-4: four'] })),
  folder('004-delta', spec('004-delta', { title: 'Delta', phase: 'complete', claims: ['- [x] ISC-7: seven'], fog: ['closed fog — none'] })),
  folder('005-eps', spec('005-eps', { title: 'Epsilon', phase: 'building', claims: ['- [ ] ISC-8: eight'] }), { archived: true }),
];

describe('tldr facts', () => {
  const facts = tldrFacts({ specs });

  test('tldr facts names exactly the open specs, sorted by number', () => {
    expect(facts.specs.map((s) => s.number)).toEqual(['001', '002', '003']);
  });

  test('tldr facts carries title, progress and open claims', () => {
    const alpha = facts.specs[0];
    expect(alpha?.title).toBe('Alpha');
    expect(alpha?.progress).toBe('1/3');
    expect(alpha?.openClaims).toBe(2);
    expect(facts.specs[1]?.progress).toBe('0/1');
    expect(facts.specs[1]?.openClaims).toBe(1);
  });

  test('tldr facts derives the stage as the dashboard does', () => {
    const model = buildDashboard({ master: null, constitution: null, tldr: null, specs: specs.filter((s) => !s.archived), archived: [] });
    for (const fact of facts.specs) {
      expect(fact.stage).toBe(model.specs.find((r) => r.id === fact.number)?.stage ?? 'missing');
    }
  });

  test('tldr facts reads the fog lines without their marks', () => {
    expect(facts.specs[0]?.fog).toEqual(['Which store? — a benchmark decides', 'How many retries? — the owner']);
    expect(facts.specs[1]?.fog).toEqual([]);
  });

  test('tldr facts passes the prototype and artifact paths through, sorted', () => {
    expect(facts.specs[0]?.prototypes).toEqual(['001-alpha/.design/prototype/index.html']);
    expect(facts.specs[2]?.artifacts).toEqual(['003-gamma/artifacts/a.txt', '003-gamma/artifacts/report.json']);
    expect(facts.specs[1]?.prototypes).toEqual([]);
  });

  test('tldr facts skips a folder without spec.md and an empty input', () => {
    expect(tldrFacts({ specs: [{ folder: '009-empty', texts: {}, archived: false, prototypes: [], artifacts: [] }] }).specs).toEqual([]);
    expect(tldrFacts({ specs: [] }).specs).toEqual([]);
  });
});

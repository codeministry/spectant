// The dashboard model (spec 001 T39, ISC-16): `buildDashboard` over the fixture trees, the README's Expected column
// asserted per harbor spec, and the per-spec model assertions. The golden snapshots `core/fixtures/<name>.golden.json`
// are checked once, in the golden test `core/tests/fixtures.test.ts` (ISC-6).
//
// The files are read by the test helper `helpers/read-tree.ts`, as the server reads them; `buildDashboard` stays pure
// over the text.
import { describe, expect, test } from 'bun:test';
import { homedir } from 'node:os';

import { buildDashboard, devServiceLabels, toLocalService } from '../src/dashboard.ts';
import type { DashboardModel, DashboardSpecRow } from '../src/dashboard.ts';
import { FIXTURES, fixtureTrees, readTree } from './helpers/read-tree.ts';

const model = (name: string): DashboardModel => buildDashboard(readTree(name));

function row(m: DashboardModel, id: string): DashboardSpecRow {
  const found = m.specs.find((r) => r.id === id);
  if (!found) throw new Error(`no row ${id} in ${m.specs.map((r) => r.id).join(', ')}`);
  return found;
}

const kinds = (r: DashboardSpecRow): string[] => r.warnings.map((w) => w.kind);

/** Every string anywhere in `value`, keys included. */
function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => strings(v, out));
  else if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.push(k);
      strings(v, out);
    }
  }
  return out;
}

describe('harbor: the README Expected column', () => {
  const m = model('harbor');

  test('the master fraction is the three-digit/three-digit 101/124', () => {
    expect(m.kpis.master).toEqual({ closed: 101, total: 124 });
  });

  test('stages per spec as the old skill derives them', () => {
    expect(Object.fromEntries(m.specs.map((r) => [r.id, r.stage]))).toEqual({
      '002': 'build',
      '003': 'tasks',
      '004': 'code-review',
      '005': 'review',
      '006': 'review',
    });
  });

  test('warnings per spec, in the old order drift, review, diagrams, closed, fog', () => {
    expect(kinds(row(m, '002'))).toEqual([]);
    expect(kinds(row(m, '003'))).toEqual(['review']);
    expect(row(m, '003').warnings[0]?.text).toContain('no reviewed mark');
    expect(kinds(row(m, '004'))).toEqual(['diagrams', 'closed']);
    expect(row(m, '004').warnings[0]?.ref).toBe('plan.md');
    expect(kinds(row(m, '005'))).toEqual(['review', 'fog']);
    expect(kinds(row(m, '006'))).toEqual(['drift', 'review']);
    const drift = row(m, '006').warnings[0];
    expect(drift?.text).toContain('unknown_to_master');
    expect(drift?.text).toContain('missing_in_spec');
    expect(drift?.command).toBe('/spec-sync 006');
    expect(row(m, '006').warnings[1]?.text).toContain('stale');
  });

  test('003 is a refactor: its diagram verdict warns on the gate but never lists a warning', () => {
    expect(row(m, '003').gates.diagrams.state).toBe('warn');
    expect(kinds(row(m, '003'))).not.toContain('diagrams');
  });

  test('the TL;DR is stale, archive/001 is listed and counted', () => {
    expect(m.brief?.stale).toBe(true);
    expect(m.brief?.generated).toBe('2026-03-07T18:00:00Z');
    expect(m.archive.map((a) => a.slug)).toEqual(['001-manifest-sync']);
    expect(m.kpis.archived).toBe(1);
  });

  test('rows in action order (nearest to done first), Next up the top three with a command', () => {
    expect(m.specs.map((r) => r.id)).toEqual(['004', '005', '006', '002', '003']);
    expect(m.nextUp).toEqual(['004', '005', '006']);
    expect(row(m, '002').nextCommand).toBe('/spec-implement 002');
    expect(row(m, '002').takeable.length).toBeGreaterThan(0);
  });

  test('KPIs: specs split building and scoping, attention is warnings plus open fog', () => {
    const { kpis } = m;
    expect(kpis.specs).toBe(5);
    expect(kpis.building).toBe(2); // 002 build, 004 code-review
    expect(kpis.scoping).toBe(3); // 003 tasks, 005 and 006 review
    expect(kpis.warnings).toBe(7);
    expect(kpis.attention).toBe(kpis.warnings + kpis.fog);
    expect(kpis.takeable).toBe(m.specs.reduce((n, r) => n + r.takeable.length, 0));
    expect(kpis.claims).toEqual(
      m.specs.filter((r) => r.stage !== 'done').reduce((a, r) => ({ closed: a.closed + r.progress.closed, total: a.total + r.progress.total }), { closed: 0, total: 0 }),
    );
    expect(m.stageCounts).toMatchObject({ build: 1, tasks: 1, 'code-review': 1, review: 2, done: 0 });
  });

  test('warnings grouped by kind, each item naming its spec', () => {
    const groups = Object.fromEntries(m.warningGroups.map((g) => [g.kind, g.items.map((i) => i.spec)]));
    expect(groups).toEqual({ drift: ['006'], review: ['005', '006', '003'], diagrams: ['004'], closed: ['004'], fog: ['005'] });
  });

  test('gates: 004 reviewed fresh and code-reviewed stale, 006 reviewed stale, 003 reviewed missing', () => {
    expect(row(m, '004').gates.reviewed.state).toBe('fresh');
    expect(row(m, '004').gates.codeReviewed.state).toBe('stale');
    expect(row(m, '006').gates.reviewed.state).toBe('stale');
    expect(row(m, '006').gates.drift.state).toBe('warn');
    expect(row(m, '003').gates.reviewed.state).toBe('missing');
    expect(row(m, '002').gates.drift.state).toBe('ok');
  });

  test('002 carries its newest round', () => {
    expect(row(m, '002').lastRound).not.toBeNull();
  });
});

describe('lantern, empty-master and the frozen corpora', () => {
  test('lantern: two specs, both reviewed, no warning, no archive, no TL;DR', () => {
    const m = model('lantern');
    expect(m.specs.map((r) => r.id).sort()).toEqual(['001', '002']);
    expect(m.specs.every((r) => r.gates.reviewed.state === 'fresh')).toBe(true);
    expect(m.specs.flatMap((r) => r.warnings)).toEqual([]);
    expect(m.warningGroups).toEqual([]);
    expect(m.archive).toEqual([]);
    expect(m.brief).toBeNull();
    expect(m.kpis.master?.total).toBe(12);
  });

  test('empty-master: zero specs, no throw', () => {
    const m = model('empty-master');
    expect(m.specs).toEqual([]);
    expect(m.kpis.specs).toBe(0);
    expect(m.kpis.claims).toEqual({ closed: 0, total: 0 });
    expect(m.nextUp).toEqual([]);
    expect(m.archive).toEqual([]);
  });

  test('leadgen: a complete spec is done, has no next command and stays out of the open-spec claims', () => {
    const m = model('leadgen');
    const done = row(m, '022');
    expect(done.stage).toBe('done');
    expect(done.nextCommand).toBeNull();
    expect(done.warnings.filter((w) => w.kind !== 'drift')).toEqual([]);
    expect(m.specs[m.specs.length - 1]?.id).toBe('022');
    expect(m.kpis.claims).toEqual(row(m, '012').progress);
    expect(m.archive.map((a) => a.id)).toEqual(['013']);
  });

  test('spectant-001: one feature spec, listed with a stage and a next command', () => {
    const m = model('spectant-001');
    expect(m.specs.map((r) => r.slug)).toEqual(['001-app-skeleton']);
    expect(row(m, '001').type).toBe('feature');
    expect(row(m, '001').nextCommand).not.toBeNull();
  });
});

describe('ISC-3: no absolute path in the model', () => {
  test.each(fixtureTrees())('%s', (name) => {
    const all = strings(model(name));
    const leaks = all.filter((s) => s.includes(FIXTURES) || s.includes(homedir()) || /^[A-Za-z]:\\/.test(s));
    expect(leaks).toEqual([]);
  });
});

describe('diagnostics, never a throw', () => {
  test('malformed files become FileDiagnostics with repository-relative paths', () => {
    const m = buildDashboard({
      master: '---\nprogress: 1/1\n\n# no close\n',
      constitution: null,
      tldr: '# no frontmatter\n',
      specs: [
        { folder: '007-broken', texts: { spec: '---\nspec_type: feature\n# never closed\n', gateReviewed: '{not json', rounds: '{"ts":"2026-03-01T00:00:00Z"}\nnot json\n' } },
        { folder: '008-no-spec', texts: { plan: '# plan only\n' } },
      ],
      archived: [],
    });
    const files = [...new Set(m.diagnostics.map((d) => d.file))].sort();
    expect(files).toEqual(['ISA.md', 'specs/007-broken/.gates/reviewed.json', 'specs/007-broken/rounds.jsonl', 'specs/007-broken/spec.md', 'specs/008-no-spec/spec.md', 'specs/tldr.md']);
    expect(m.specs.map((r) => r.id)).toEqual(['007']);
    expect(row(m, '007').lastRound).toBe('2026-03-01T00:00:00Z');
    expect(m.kpis.master).toBeNull();
  });
});

describe('services', () => {
  test('a DevService maps to a loopback LocalService, labelled only when the constitution names its port', () => {
    const labels = devServiceLabels(readTree('harbor').constitution ?? '');
    expect([...labels]).toEqual([
      [4200, 'Web dev'],
      [8080, 'API'],
    ]);
    expect(toLocalService({ port: 4200, kind: 'node', label: 'Web dev' }, labels)).toEqual({ port: 4200, url: 'http://localhost:4200', process: 'node', label: 'Web dev' });
    expect(toLocalService({ port: 5173, kind: 'bun', label: 'bun', worktree: true }, labels)).toEqual({ port: 5173, url: 'http://localhost:5173', process: 'bun', label: null, worktree: true });
  });

  test('services pass through the model sorted by port', () => {
    const input = readTree('lantern');
    const m = buildDashboard({
      ...input,
      services: [
        { port: 8080, url: 'http://localhost:8080', process: 'java', label: 'API' },
        { port: 4200, url: 'http://localhost:4200', process: 'node', label: null },
      ],
    });
    expect(m.services.map((s) => s.port)).toEqual([4200, 8080]);
  });
});

describe('multi-workspace', () => {
  test('two workspaces built side by side each list their own specs, nothing crosses over', () => {
    const harbor = model('harbor');
    const lantern = model('lantern');
    expect(harbor.specs.map((r) => r.slug).sort()).toEqual(['002-web-console', '003-config-loader', '004-retention-policies', '005-config-format-choice', '006-partial-push']);
    expect(lantern.specs.map((r) => r.slug).sort()).toEqual(['001-reading-list', '002-duplicate-links']);
    expect(harbor.kpis.master).toEqual({ closed: 101, total: 124 });
    expect(lantern.kpis.master?.total).toBe(12);
    // pure: building one never changes the other
    expect(JSON.stringify(model('harbor'))).toBe(JSON.stringify(harbor));
  });
});

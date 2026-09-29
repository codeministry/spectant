// The spec page model (spec 002 T12, ISC-78): `buildSpecPage` over the fixture trees, exact numbers per harbor spec
// and for spectant-001, and the ISC-72 guard: every counter the page shares with the dashboard row of the same spec
// (stage, progress, tasks, next command and reason, takeable, warnings, gates) is equal to that row, for every spec of
// every fixture tree, with and without a lock. The golden snapshot is the `spec` family in golden.test.ts.
import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';

import { buildDashboard } from '../src/dashboard.ts';
import type { DashboardInput, DashboardSpecRow } from '../src/dashboard.ts';
import type { ClaimLock, LockReading, SpecFiles, SpecPageInput, SpecPageModel } from '../src/files.ts';
import { SPEC_AREAS } from '../src/files.ts';
import { buildSpecPage } from '../src/spec.ts';
import { FIXTURES, fixtureTrees, readTree } from './helpers/read-tree.ts';

/** The page input of one folder of a tree, as the server would assemble it: master, constitution, siblings, TL;DR. */
function pageInput(tree: DashboardInput, folder: string, extra: Partial<SpecPageInput> = {}): SpecPageInput {
  const all = [...tree.specs, ...tree.archived];
  const files = all.find((f) => f.folder === folder);
  if (!files) throw new Error(`no folder ${folder} in ${all.map((f) => f.folder).join(', ')}`);
  const texts: SpecFiles['texts'] = {
    ...files.texts,
    ...(tree.master === null ? {} : { master: tree.master }),
    ...(tree.constitution === null ? {} : { constitution: tree.constitution }),
  };
  return {
    files: { folder, texts },
    others: all.filter((f) => f !== files),
    tldr: tree.tldr,
    worktreeTree: tree.worktreeTree ?? null,
    ...extra,
  };
}

const page = (name: string, folder: string, extra: Partial<SpecPageInput> = {}): SpecPageModel => buildSpecPage(pageInput(readTree(name), folder, extra));

const NO_LOCKS: LockReading = { source: 'none', sources: [], locks: [] };

/** The activity line of harbor's `.spectant/activity.jsonl` that is still open (ISC-74, never released). */
const HARBOR_LOCK: ClaimLock = { source: 'activity', claim: 'ISC-74', session: 'spec-002-ISC-74', since: '2026-03-08T14:06:00Z' };
const HARBOR_LOCKS: LockReading = { source: 'activity', sources: ['activity'], locks: [HARBOR_LOCK] };

describe('harbor 002: the richest spec (round 3, all three kinds waiting on you)', () => {
  const p = page('harbor', '002-web-console');

  test('head', () => {
    expect(p.head).toEqual({
      id: '002',
      slug: '002-web-console',
      title: 'Web console',
      type: 'feature',
      stage: 'build',
      nextCommand: '/spec-implement 002',
      nextReason: 'ISC-74, ISC-75 and 2 more are takeable',
      phase: 'building',
      started: '2026-03-03T10:00:00Z',
      updated: '2026-03-08T16:45:00Z',
      round: 3,
      lastRound: '2026-03-08T16:30:00Z',
      uncommittedFiles: null,
    });
  });

  test('key numbers', () => {
    expect(p.keyNumbers).toEqual({
      claims: { closed: 25, total: 30, open: 5, takeable: 4 },
      tasks: { landed: 27, total: 32 },
      rounds: { count: 3, agentsWorking: 0 },
      gates: { ok: 3, total: 4 },
      waiting: 3,
    });
  });

  test('the idea quote is the first sentence of § Goal', () => {
    expect(p.ideaSource).toBe('goal');
    expect(p.ideaQuote).toBe(
      'A teammate opens the console, finds any mirrored repository in two steps, and sees each sync run with its failures, on a phone-sized screen and with the keyboard alone.',
    );
  });

  test('next step: the rule reason first, then what the stage table implies, then the waiting count', () => {
    expect(p.next).toEqual({
      command: '/spec-implement 002',
      reasons: ['ISC-74, ISC-75 and 2 more are takeable', 'the reviewed mark is fresh', '3 items wait on you'],
      since: null,
      via: null,
    });
  });

  test('lanes: the constitution order cli, api, web, then operator; the fractions add up to the task count', () => {
    expect(p.lanes).toEqual([
      { name: 'cli', landed: 0, total: 0 },
      { name: 'api', landed: 1, total: 1 },
      { name: 'web', landed: 25, total: 29 },
      { name: 'operator', landed: 1, total: 2 },
    ]);
    expect(p.lanes.reduce((n, l) => n + l.total, 0)).toBe(p.keyNumbers.tasks.total);
    expect(p.lanes.reduce((n, l) => n + l.landed, 0)).toBe(p.keyNumbers.tasks.landed);
  });

  test('gates', () => {
    const { reviewed, codeReviewed, drift, diagrams } = p.gates;
    expect({ reviewed: reviewed.state, codeReviewed: codeReviewed.state, drift: drift.state, diagrams: diagrams.state }).toEqual({
      reviewed: 'fresh',
      codeReviewed: 'missing',
      drift: 'ok',
      diagrams: 'ok',
    });
  });

  test('waiting on you: the open operator task, the open manual claim, the newest round question', () => {
    expect(p.warnings).toEqual([]);
    expect(p.waitingOnYou).toEqual([
      { kind: 'operator', ref: 'T31', title: 'screen-reader pass over the sync history (ISC-77)', checked: false },
      { kind: 'manual', ref: 'ISC-77', title: 'Every interactive element in the error banner is reachable by keyboard and shows a focus ring.' },
      { kind: 'question', ref: 'T29', title: 'should the empty state link to the sync docs or to the settings page?' },
    ]);
  });

  test('area tiles', () => {
    expect(Object.keys(p.areas)).toEqual([...SPEC_AREAS]);
    expect(p.areas).toEqual({
      status: { timelineEntries: 9, warnings: 0 },
      live: { lockSource: 'none', agentsWorking: 0, lock: null },
      data: { claims: { closed: 25, total: 30 }, tasks: { landed: 27, total: 32 } },
      docs: { plan: true, design: false, constitution: true, decisions: 1 },
      notes: { count: null },
      board: { rounds: 3, stop: 'a decision only the principal can make' },
    });
  });

  test('TL;DR: the per-spec line naming 002, stale because 002 moved after it was generated', () => {
    expect(p.tldr).toEqual({
      brief: '- **002** Web console: 25 of 30 closed; one question open about the empty state.',
      generated: '2026-03-07T18:00:00Z',
      stale: true,
    });
  });

  test('a lock: one agent working, the Live tile names it, the locked claim is no longer takeable', () => {
    const locked = page('harbor', '002-web-console', { locks: HARBOR_LOCKS });
    expect(locked.keyNumbers.rounds).toEqual({ count: 3, agentsWorking: 1 });
    expect(locked.keyNumbers.claims).toEqual({ closed: 25, total: 30, open: 5, takeable: 3 });
    expect(locked.areas.live).toEqual({ lockSource: 'activity', agentsWorking: 1, lock: HARBOR_LOCK });
    expect(locked.head.nextReason).toBe('ISC-75, ISC-76 and 1 more are takeable');
  });

  test('a lock on a claim of another spec is no agent working here', () => {
    const elsewhere: LockReading = { ...HARBOR_LOCKS, locks: [{ ...HARBOR_LOCK, claim: 'ISC-999' }] };
    expect(page('harbor', '002-web-console', { locks: elsewhere }).keyNumbers.rounds.agentsWorking).toBe(0);
    expect(page('harbor', '002-web-console', { locks: NO_LOCKS }).areas.live.lockSource).toBe('none');
  });

  test('events.jsonl: the newest transition into the current stage is the since/via line', () => {
    const tree = readTree('harbor');
    const input = pageInput(tree, '002-web-console');
    const events = [
      '{"ts":"2026-03-05T09:00:00Z","from":"tasks","to":"review","command":"/spec-tasks 002","actor":"principal"}',
      '{"ts":"2026-03-05T09:55:00Z","from":"review","to":"build","command":"/spec-review 002","actor":"principal"}',
      'not json',
      '{"ts":"2026-03-06T08:00:00Z","from":"review","to":"build","command":"/spec-implement 002","actor":"agent"}',
      '{"ts":"2026-03-07T08:00:00Z","from":"build","to":"blocked","command":"/spec-status 002","actor":"agent"}',
    ].join('\n');
    const p2 = buildSpecPage({ ...input, files: { ...input.files, texts: { ...input.files.texts, events } } });
    expect(p2.next.since).toBe('2026-03-06T08:00:00Z');
    expect(p2.next.via).toBe('/spec-implement 002');
  });
});

describe('harbor: the other active specs', () => {
  test('004: every claim closed, waiting for its code review; no waiting item, two gates short', () => {
    const p = page('harbor', '004-retention-policies');
    expect(p.head.stage).toBe('code-review');
    expect(p.head.round).toBeNull();
    expect(p.keyNumbers).toEqual({
      claims: { closed: 30, total: 30, open: 0, takeable: 0 },
      tasks: { landed: 30, total: 30 },
      rounds: { count: 0, agentsWorking: 0 },
      gates: { ok: 2, total: 4 },
      waiting: 0,
    });
    expect(p.next.reasons).toEqual(['every claim is closed and the code-reviewed mark is stale', 'the reviewed mark is fresh']);
    expect(p.lanes).toEqual([
      { name: 'cli', landed: 0, total: 0 },
      { name: 'api', landed: 20, total: 20 },
      { name: 'web', landed: 10, total: 10 },
      { name: 'operator', landed: 0, total: 0 },
    ]);
    expect(p.warnings.map((w) => w.kind)).toEqual(['diagrams', 'closed']);
    expect(p.areas.status).toEqual({ timelineEntries: 9, warnings: 2 });
    expect(p.areas.board).toEqual({ rounds: 0, stop: null });
    expect(p.tldr?.brief).toBe('- **004** Retention policies: all 30 closed; the plan still lacks its diagram.');
    expect(p.tldr?.stale).toBe(true);
  });

  test('005: one antecedent claim with a manual probe waits on you; no tasks.md, so no lanes', () => {
    const p = page('harbor', '005-config-format-choice');
    expect(p.head.stage).toBe('review');
    expect(p.keyNumbers).toEqual({
      claims: { closed: 0, total: 1, open: 1, takeable: 0 },
      tasks: { landed: 0, total: 0 },
      rounds: { count: 0, agentsWorking: 0 },
      gates: { ok: 1, total: 4 },
      waiting: 1,
    });
    expect(p.waitingOnYou.map((w) => `${w.kind} ${w.ref}`)).toEqual(['manual ISC-94']);
    expect(p.next.reasons).toEqual(['the reviewed mark is missing', '1 item waits on you']);
    expect(p.lanes).toEqual([]);
    expect(p.areas.data.tasks).toBeNull();
    expect(p.areas.docs).toEqual({ plan: false, design: false, constitution: true, decisions: 1 });
    expect(p.ideaQuote).toBe('A recorded decision names the config format for version 2 and the one trade-off that decided it.');
    expect(p.warnings.map((w) => w.kind)).toEqual(['review', 'fog']);
  });

  test('006: drift to the master, the reviewed mark stale, no gate passes', () => {
    const p = page('harbor', '006-partial-push');
    expect(p.head.stage).toBe('review');
    expect(p.keyNumbers.claims).toEqual({ closed: 0, total: 4, open: 4, takeable: 0 });
    expect(p.keyNumbers.gates).toEqual({ ok: 0, total: 4 });
    expect(p.gates.drift.state).toBe('warn');
    expect(p.warnings.map((w) => w.kind)).toEqual(['drift', 'review']);
    expect(p.waitingOnYou).toEqual([]);
    expect(p.next.reasons).toEqual(['the reviewed mark is stale']);
    // 006 is newer than the TL;DR and never named in its per-spec list.
    expect(p.tldr).toEqual({ brief: null, generated: '2026-03-07T18:00:00Z', stale: true });
  });

  test('003: thirteen claims and no tasks.md', () => {
    const p = page('harbor', '003-config-loader');
    expect(p.head).toMatchObject({ stage: 'tasks', nextCommand: '/spec-tasks 003', title: 'Config loader rewrite' });
    expect(p.keyNumbers).toEqual({
      claims: { closed: 0, total: 13, open: 13, takeable: 0 },
      tasks: { landed: 0, total: 0 },
      rounds: { count: 0, agentsWorking: 0 },
      gates: { ok: 1, total: 4 },
      waiting: 0,
    });
    expect(p.next.reasons).toEqual(['13 claims and no tasks.md']);
  });
});

describe('spectant-001: the frozen real spec', () => {
  const p = page('spectant-001', '001-app-skeleton');

  test('head and key numbers', () => {
    expect(p.head).toMatchObject({ id: '001', title: 'App skeleton and dashboard', stage: 'review', round: 9 });
    expect(p.keyNumbers).toMatchObject({
      claims: { closed: 14, total: 47, open: 33, takeable: 0 },
      tasks: { landed: 27, total: 83 },
      rounds: { count: 9, agentsWorking: 0 },
    });
  });

  test('lanes: core, server, web, plugin, repo from the constitution, then operator', () => {
    expect(p.lanes).toEqual([
      { name: 'core', landed: 2, total: 11 },
      { name: 'server', landed: 11, total: 22 },
      { name: 'web', landed: 11, total: 43 },
      { name: 'plugin', landed: 0, total: 0 },
      { name: 'repo', landed: 3, total: 5 },
      { name: 'operator', landed: 0, total: 2 },
    ]);
  });

  test('the idea quote is the goal sentence, never principal_stated_goal', () => {
    expect(p.ideaSource).toBe('goal');
    expect(p.ideaQuote).toStartWith('A fresh macOS or Linux user installs spectant with one line');
    expect(p.ideaQuote).toEndWith('nothing written into either repository.');
  });
});

describe('the idea quote', () => {
  const base = (spec: string): SpecPageModel => buildSpecPage({ files: { folder: '009-x', texts: { spec } } });

  test('first sentence only: a period inside a word or before a lower-case word does not end it', () => {
    const spec = '---\ntask: "the task"\n---\n\n# 009 — X\n\n## Goal\n\nThe `plan.md` file, e.g. a plan, is read. Then more follows.\n';
    expect(base(spec).ideaQuote).toBe('The `plan.md` file, e.g. a plan, is read.');
  });

  test('falls back to task: when § Goal is missing, and to null without either', () => {
    const withTask = base('---\ntask: "Ship the thing"\nprincipal_stated_goal: "never shown"\n---\n\n# 009 — X\n');
    expect([withTask.ideaQuote, withTask.ideaSource]).toEqual(['Ship the thing', 'task']);
    const neither = base('---\nprincipal_stated_goal: "never shown"\n---\n\n# 009 — X\n');
    expect([neither.ideaQuote, neither.ideaSource]).toEqual([null, null]);
  });

  test('a spec without an H1 takes the row title', () => {
    expect(base('---\ntask: "Ship the thing"\n---\n\n## Goal\n\nIt ships.\n').head.title).toBe('Ship the thing');
  });
});

describe('ISC-72: the page agrees with the dashboard row of the same spec, in every fixture tree', () => {
  const cases = fixtureTrees().flatMap((tree) => {
    const input = readTree(tree);
    return input.specs.map((f) => [tree, f.folder] as const);
  });

  test('the fixtures hold specs to compare', () => {
    expect(cases.length).toBeGreaterThanOrEqual(10);
  });

  for (const locks of [undefined, HARBOR_LOCKS]) {
    test.each(cases)(`%s %s ${locks ? 'with' : 'without'} a lock`, (tree, folder) => {
      const input = readTree(tree);
      const dash = buildDashboard({ ...input, ...(locks ? { locks } : {}) });
      const row = dash.specs.find((r) => r.slug === folder) as DashboardSpecRow;
      const p = buildSpecPage(pageInput(input, folder, locks ? { locks } : {}));
      expect({
        stage: p.head.stage,
        type: p.head.type,
        phase: p.head.phase,
        updated: p.head.updated,
        lastRound: p.head.lastRound,
        progress: { closed: p.keyNumbers.claims.closed, total: p.keyNumbers.claims.total },
        tasks: p.areas.data.tasks,
        nextCommand: p.head.nextCommand,
        nextReason: p.head.nextReason,
        takeable: p.keyNumbers.claims.takeable,
        warnings: p.warnings,
        gates: p.gates,
      }).toEqual({
        stage: row.stage,
        type: row.type,
        phase: row.phase,
        updated: row.updated,
        lastRound: row.lastRound,
        progress: row.progress,
        tasks: row.tasks,
        nextCommand: row.nextCommand,
        nextReason: row.nextReason,
        takeable: row.takeable.length,
        warnings: row.warnings,
        gates: row.gates,
      });
      expect(p.next.command).toBe(row.nextCommand);
      expect(p.next.reasons[0]).toBe(row.nextReason);
      expect(p.keyNumbers.tasks).toEqual(row.tasks ?? { landed: 0, total: 0 });
      expect(p.keyNumbers.waiting).toBe(p.waitingOnYou.length);
      const { reviewed, codeReviewed, drift, diagrams } = p.gates;
      expect(p.keyNumbers.gates.ok).toBe([reviewed, codeReviewed, drift, diagrams].filter((g) => g.state === 'fresh' || g.state === 'ok').length);
      expect(p.lanes.reduce((n, l) => n + l.total, 0)).toBe(row.tasks?.total ?? 0);
      expect(p.lanes.reduce((n, l) => n + l.landed, 0)).toBe(row.tasks?.landed ?? 0);
      expect(p.next.reasons.length).toBeLessThanOrEqual(3);
    });
  }
});

describe('purity', () => {
  test('the same input builds the same model; the input is not mutated', () => {
    const input = pageInput(readTree('harbor'), '002-web-console');
    const before = JSON.stringify(input);
    expect(JSON.stringify(buildSpecPage(input))).toBe(JSON.stringify(buildSpecPage(input)));
    expect(JSON.stringify(input)).toBe(before);
  });

  test('no string in the model carries the fixture directory', () => {
    expect(JSON.stringify(page('harbor', '002-web-console'))).not.toContain(join(FIXTURES, 'harbor'));
  });
});

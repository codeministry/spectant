// T14 (spec 002, ISC-80): the merged timeline. context.md decisions, rounds.jsonl rounds, gate marks and the commits
// the server passes in become one newest-first list with one entry per source event.
// T15 (ISC-36): stage entries join it — derived from the files and marked `derived` without events.jsonl, replaced by
// the recorded events when the caller passes them. The `sources` block reads only the four recorded kinds (no
// spec.md), so it sees no stage entries; the `stage transitions` block reads whole folders.
// T26 (ISC-80): the `sources merged in order` block proves the merge over whole folders: per-kind counts taken from
// the raw files, commits interleaved between rounds, the order property on every fixture spec, one entry per event
// when sources share an instant, events beside commits, and harbor 002's exact list as the regression anchor.
// The fixture files are read here with node:fs; timeline.ts itself stays pure over the text.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, test } from 'bun:test';

import { deriveStages, stageInstants } from '../src/derived-stages.ts';
import {
  FILE_KINDS,
  type CommitRecord,
  type EventLine,
  type SpecFiles,
  type TextFileKind,
  type TimelineEntry,
} from '../src/files.ts';
import { buildTimeline } from '../src/timeline.ts';
import { fixtureTrees, folders } from './helpers/read-tree.ts';

const FIXTURES = join(import.meta.dir, '..', 'fixtures');
const TIMELINE_KINDS: readonly TextFileKind[] = ['context', 'rounds', 'gateReviewed', 'gateCodeReviewed'];

function readSpec(relDir: string, omit: readonly TextFileKind[] = []): SpecFiles {
  const dir = join(FIXTURES, relDir);
  const texts: Partial<Record<TextFileKind, string>> = {};
  for (const kind of TIMELINE_KINDS) {
    const path = join(dir, FILE_KINDS[kind].path);
    if (!omit.includes(kind) && existsSync(path)) texts[kind] = readFileSync(path, 'utf8');
  }
  return { folder: relDir.split('/').pop() ?? relDir, texts };
}

const SPECTANT_001 = 'spectant-001/specs/001-app-skeleton';
const HARBOR_002 = 'harbor/specs/002-web-console';
const HARBOR_004 = 'harbor/specs/004-retention-policies';
const LEADGEN_012 = 'leadgen/specs/012-pwa-install';

// Two synthetic commits per fixture. One carries a +02:00 offset as `git log --format=%cI` prints it: 08:00+02:00 is
// 06:00Z, older than Round 0 (07:30Z) although it is lexically larger — the order must follow the instant.
const COMMITS_001: readonly CommitRecord[] = [
  { sha: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678', ts: '2026-09-28T13:10:00Z', subject: 'feat(001): round 9' },
  { sha: 'ffeeddccbbaa99887766554433221100aabbccdd', ts: '2026-09-28T08:00:00+02:00', subject: 'chore: scaffold 001' },
];
const COMMITS_HARBOR: readonly CommitRecord[] = [
  { sha: '1111111111111111111111111111111111111111', ts: '2026-03-06T09:00:00Z', subject: 'docs(002): plan and tasks' },
  { sha: '2222222222222222222222222222222222222222', ts: '2026-03-08T17:00:00Z', subject: 'feat(002): round 3' },
];

const SOURCE_RANK: Readonly<Record<string, number>> = { decision: 0, round: 1, gate: 2, commit: 3 };

function countByKind(entries: readonly TimelineEntry[]): Record<string, number> {
  const counts: Record<string, number> = { decision: 0, round: 0, gate: 0, commit: 0 };
  for (const e of entries) counts[e.kind] = (counts[e.kind] ?? 0) + 1;
  return counts;
}

/** Newest first by instant; equal instants keep the source order decision < round < gate < commit. */
function expectOrdered(entries: readonly TimelineEntry[]): void {
  for (let i = 1; i < entries.length; i++) {
    const a = entries[i - 1];
    const b = entries[i];
    if (!a || !b) throw new Error('unreachable');
    const ta = Date.parse(a.ts);
    const tb = Date.parse(b.ts);
    expect(Number.isFinite(ta) && Number.isFinite(tb)).toBe(true);
    expect(ta).toBeGreaterThanOrEqual(tb);
    if (ta === tb) expect(SOURCE_RANK[a.kind] ?? 9).toBeLessThanOrEqual(SOURCE_RANK[b.kind] ?? 9);
  }
}

function expectWellFormed(entries: readonly TimelineEntry[]): void {
  const ids = entries.map((e) => e.id);
  expect(ids.every((id) => typeof id === 'string' && /^[A-Za-z0-9._-]+$/.test(id))).toBe(true);
  expect(new Set(ids).size).toBe(ids.length);
  for (const e of entries) {
    expect(e.derived).toBe(false);
    expect(e.kind).not.toBe('stage');
    expect(e.title.length).toBeGreaterThan(0);
    expect(e.title).not.toContain('\n');
    expect(typeof e.ref).toBe('string');
  }
}

describe('sources', () => {
  test('spectant-001: 11 decisions + 9 rounds + 0 gates + 2 commits = 22 entries, newest first', () => {
    const entries = buildTimeline({ files: readSpec(SPECTANT_001), commits: COMMITS_001 });

    expect(countByKind(entries)).toEqual({ decision: 11, round: 9, gate: 0, commit: 2 });
    expect(entries).toHaveLength(22);
    expectOrdered(entries);
    expectWellFormed(entries);

    // Newest is the round-9 commit, oldest the offset commit (06:00Z) — before Round 0's 07:30Z decisions.
    expect(entries[0]?.ref).toBe(COMMITS_001[0]?.sha);
    expect(entries.at(-1)?.ref).toBe(COMMITS_001[1]?.sha);
  });

  test('one decision entry per Q block, keyed R<round>.Q<n>, with the round header time', () => {
    const decisions = buildTimeline({ files: readSpec(SPECTANT_001), commits: [] }).filter((e) => e.kind === 'decision');
    const refs = decisions.map((e) => e.ref).sort();
    expect(refs).toEqual(
      ['goal', 'R0.Q1', 'R0.Q2', 'R0.Q3', 'R0.Q4', 'R1.Q1', 'R2.Q1', 'R3.Q1', 'R3.Q2', 'R3.Q3', 'R3.Q4'].sort(),
    );

    const q = decisions.find((e) => e.ref === 'R0.Q2');
    expect(q?.title).toBe('Which stack does the app run on?');
    expect(q?.ts).toBe('2026-09-28T07:30:00Z');
    expect(q?.id).toBe('decision-R0.Q2');
    expect(q?.body).toContain('- Chosen: Bun + TypeScript single binary');
    expect(q?.body).toContain('- Landed in: master § Constraints; ISC-8, ISC-9');
  });

  test('the goal lock is the first decision of its kind: exactly one, ahead of every decision at its time', () => {
    const entries = buildTimeline({ files: readSpec(SPECTANT_001), commits: [] });
    const locks = entries.filter((e) => e.goalLock === true);
    expect(locks).toHaveLength(1);
    const goal = locks[0];
    expect(goal?.kind).toBe('decision');
    expect(goal?.ref).toBe('goal');
    expect(goal?.ts).toBe('2026-09-28T09:40:00Z');
    expect(goal?.body).toContain('installs spectant with one line');

    // Round 1 shares the goal's time; the goal lock comes first within that instant.
    const sameInstant = entries.filter((e) => e.kind === 'decision' && e.ts === goal?.ts);
    expect(sameInstant.map((e) => e.ref)).toEqual(['goal', 'R1.Q1']);
    expect(entries.filter((e) => e.kind === 'decision' && e.goalLock !== true).every((e) => e.goalLock === undefined)).toBe(
      true,
    );
  });

  test('a round entry carries its number, dispatched ids, closed claims, held count and stop', () => {
    const rounds = buildTimeline({ files: readSpec(HARBOR_002), commits: [] }).filter((e) => e.kind === 'round');
    expect(rounds.map((e) => e.ref)).toEqual(['3', '2', '1']);

    const r3 = rounds[0];
    expect(r3?.ts).toBe('2026-03-08T16:30:00Z');
    expect(r3?.id).toBe('round-3');
    expect(r3?.title).toContain('Round 3');
    expect(r3?.title).toContain('a decision only the principal can make');
    expect(r3?.body).toContain('T12, T13, T14, T17, T19, T21, T24, T25, T26, T27');
    expect(r3?.body).toContain('ISC-60.1, ISC-60.2, ISC-61, ISC-64, ISC-66, ISC-68');
    expect(r3?.body).toContain('Held: 4');
    expect(r3?.body).toContain('Stop: a decision only the principal can make');
    expect(r3?.actor).toBe('Engineer, Anvil');

    const r1 = rounds[2];
    expect(r1?.body).not.toContain('Stop:');
  });

  test('harbor 002: 1 decision + 3 rounds + 1 gate + 2 commits = 7 entries, the reviewed mark at its `at`', () => {
    const entries = buildTimeline({ files: readSpec(HARBOR_002), commits: COMMITS_HARBOR });
    expect(countByKind(entries)).toEqual({ decision: 1, round: 3, gate: 1, commit: 2 });
    expect(entries).toHaveLength(7);
    expectOrdered(entries);
    expectWellFormed(entries);

    const gate = entries.find((e) => e.kind === 'gate');
    expect(gate).toMatchObject({ ts: '2026-03-07T15:30:00Z', ref: 'reviewed', id: 'gate-reviewed', derived: false });
    expect(entries.map((e) => e.id)).toEqual([
      `commit-${COMMITS_HARBOR[1]?.sha ?? '?'}`,
      'round-3',
      'gate-reviewed',
      'round-2',
      'round-1',
      `commit-${COMMITS_HARBOR[0]?.sha ?? '?'}`,
      'decision-goal',
    ]);
  });

  test('gate entries come from both mark files when both are present', () => {
    const entries = buildTimeline({ files: readSpec(HARBOR_004), commits: [] });
    const gates = entries.filter((e) => e.kind === 'gate');
    expect(gates.map((e) => [e.ref, e.ts])).toEqual([
      ['code-reviewed', '2026-03-08T11:00:00Z'],
      ['reviewed', '2026-03-04T10:00:00Z'],
    ]);
    expectOrdered(entries);
    expectWellFormed(entries);
  });

  test('unnumbered Q blocks still get one entry each with distinct refs', () => {
    const entries = buildTimeline({ files: readSpec(LEADGEN_012), commits: [] });
    const decisions = entries.filter((e) => e.kind === 'decision');
    // Goal + Round 1 Q1–Q3 + Round 2 Q1 + Round 3's two `### Q ·` blocks; `## Still open` holds none.
    expect(decisions).toHaveLength(7);
    expect(decisions.filter((e) => e.ref?.startsWith('R3.'))).toHaveLength(2);
    expectWellFormed(entries);
  });

  test('a spec without context.md yields only rounds, gates and commits, and does not throw', () => {
    const entries = buildTimeline({ files: readSpec(HARBOR_002, ['context']), commits: COMMITS_HARBOR });
    expect(countByKind(entries)).toEqual({ decision: 0, round: 3, gate: 1, commit: 2 });
    expect(entries).toHaveLength(6);
    expectOrdered(entries);
  });

  test('an empty spec folder and no commits yield an empty timeline', () => {
    expect(buildTimeline({ files: { folder: '009-empty', texts: {} }, commits: [] })).toEqual([]);
  });
});

// ─── T15 · ISC-36: stage transitions ─────────────────────────────────────────────────────────────────────────────

/** A whole spec folder, every kind it holds (spec.md, plan.md, tasks.md included), as the tree reader reads it. */
function readFolder(relDir: string): SpecFiles {
  const dir = join(FIXTURES, relDir);
  const name = relDir.split('/').pop() ?? relDir;
  const files = folders(dirname(dir)).find((f) => f.folder === name);
  if (!files) throw new Error(`no fixture folder ${relDir}`);
  return files;
}

/** Every spec folder of every fixture tree, active and archived, as `tree/specs/…` paths. */
function everyFixtureFolder(): string[] {
  return fixtureTrees().flatMap((tree) =>
    ['specs', 'specs/archive'].flatMap((base) => folders(join(FIXTURES, tree, base)).map((f) => `${tree}/${base}/${f.folder}`)),
  );
}

/** `[from, to, ts]` per transition, the shape the expectations below are written in. */
const steps = (entries: readonly TimelineEntry[]): Array<[string | null | undefined, string | undefined, string]> =>
  entries.map((e) => [e.from, e.to, e.ts]);

const HARBOR_003 = 'harbor/specs/003-config-loader';
const HARBOR_006 = 'harbor/specs/006-partial-push';
const HARBOR_001 = 'harbor/specs/archive/001-manifest-sync';

// A synthetic events.jsonl for harbor 002, already validated (T16 is the validator); stage names from the stage table.
const EVENTS_002: readonly EventLine[] = [
  { ts: '2026-03-03T11:00:00Z', from: 'plan', to: 'tasks', command: '/spec-plan 002', actor: 'principal' },
  { ts: '2026-03-06T08:00:00Z', from: 'tasks', to: 'review', command: '/spec-tasks 002', actor: 'principal' },
  { ts: '2026-03-07T15:30:00Z', from: 'review', to: 'build', command: '/spec-review 002', actor: 'principal' },
];

describe('stage transitions (T15, ISC-36)', () => {
  test('harbor 002 without events.jsonl: four derived transitions, dated from its files, in stage-table order', () => {
    const stages = deriveStages(readFolder(HARBOR_002));
    expect(steps(stages)).toEqual([
      [null, 'plan', '2026-03-03T10:00:00Z'], // spec.md `started:`
      ['plan', 'tasks', ''], // plan.md exists; no `created:`, no "before the plan" round
      ['tasks', 'review', ''], // tasks.md exists; no `created:`, no "before the tasks" round
      ['review', 'build', '2026-03-07T15:30:00Z'], // .gates/reviewed.json `at`
    ]);
    for (const e of stages) {
      expect(e).toMatchObject({ kind: 'stage', derived: true, actor: null });
      expect(e.command).toBeUndefined();
    }
    expect(stages.map((e) => e.undated === true)).toEqual([false, true, true, false]);
    expect(stages[0]?.title).toBe('created → plan');
    expect(stages[3]?.title).toBe('review → build');
    expect(stages[0]?.body).toContain('spec.md `started:`');
    expect(stages[1]?.body).toContain('plan.md exists');
  });

  test('harbor 002 merged: stage entries join the timeline newest first, undated ones right after their dated predecessor', () => {
    const entries = buildTimeline({ files: readFolder(HARBOR_002), commits: COMMITS_HARBOR });
    expect(entries.map((e) => e.id)).toEqual([
      `commit-${COMMITS_HARBOR[1]?.sha ?? '?'}`,
      'round-3',
      'stage-build', // the transition the reviewed mark caused, above the mark at the same instant
      'gate-reviewed',
      'round-2',
      'round-1',
      `commit-${COMMITS_HARBOR[0]?.sha ?? '?'}`,
      'stage-review', // undated: after plan → tasks, which is itself after the creation
      'stage-tasks', // undated: right after the creation, the last dated transition before it
      'stage-plan',
      'decision-goal',
    ]);
    expect(entries.filter((e) => e.kind === 'stage').every((e) => e.derived && e.actor === null)).toBe(true);
    expect(entries.filter((e) => e.kind !== 'stage').every((e) => !e.derived)).toBe(true);
  });

  test('with events the recorded transitions replace the derived ones', () => {
    const files = readFolder(HARBOR_002);
    const stages = deriveStages(files, EVENTS_002);
    expect(stages).toHaveLength(EVENTS_002.length);
    expect(steps(stages)).toEqual(EVENTS_002.map((e) => [e.from, e.to, e.ts]));
    for (const [i, e] of stages.entries()) {
      expect(e).toMatchObject({ kind: 'stage', derived: false, actor: 'principal', command: EVENTS_002[i]?.command });
      expect(e.undated).toBeUndefined();
    }

    const entries = buildTimeline({ files, commits: [], events: EVENTS_002 });
    const stageEntries = entries.filter((e) => e.kind === 'stage');
    expect(stageEntries.map((e) => [e.id, e.ts])).toEqual([
      ['stage-build', '2026-03-07T15:30:00Z'],
      ['stage-review', '2026-03-06T08:00:00Z'],
      ['stage-tasks', '2026-03-03T11:00:00Z'],
    ]);
    expect(entries.some((e) => e.derived)).toBe(false);
    // Every other source is untouched: 1 decision + 3 rounds + 1 gate.
    expect(entries).toHaveLength(EVENTS_002.length + 5);
  });

  test('an empty events array derives; events without spec.md are still listed; neither yields nothing', () => {
    const files = readFolder(HARBOR_002);
    expect(deriveStages(files, [])).toEqual(deriveStages(files));
    expect(deriveStages({ folder: '009-empty', texts: {} })).toEqual([]);
    expect(deriveStages({ folder: '009-empty', texts: {} }, EVENTS_002)).toHaveLength(EVENTS_002.length);
  });

  test('a spec whose type needs no plan has no plan transition, even with plan.md present', () => {
    // harbor 003 is a refactor: plan.md exists but the stage table never waits on it; tasks.md is still missing.
    expect(steps(deriveStages(readFolder(HARBOR_003)))).toEqual([[null, 'tasks', '2026-03-06T09:00:00Z']]);
    // harbor 006 is a bug without plan.md: straight to review, then build at its reviewed mark.
    expect(steps(deriveStages(readFolder(HARBOR_006)))).toEqual([
      [null, 'review', '2026-03-08T09:00:00Z'],
      ['review', 'build', '2026-03-08T12:00:00Z'],
    ]);
    for (const relDir of [HARBOR_003, HARBOR_006]) {
      const stages = deriveStages(readFolder(relDir));
      expect(stages.some((e) => e.from === 'plan' || e.to === 'plan')).toBe(false);
    }
  });

  test('the whole chain of a complete spec: code review implied undated, done at `updated:`', () => {
    const stages = deriveStages(readFolder(HARBOR_001));
    expect(steps(stages)).toEqual([
      [null, 'plan', '2026-03-02T09:00:00Z'],
      ['plan', 'tasks', ''],
      ['tasks', 'review', ''],
      ['review', 'build', '2026-03-02T11:00:00Z'],
      ['build', 'code-review', ''], // every claim closed: the files give no date, the code-reviewed mark proves it happened
      ['code-review', 'close', '2026-03-05T14:30:00Z'], // .gates/code-reviewed.json `at`
      ['close', 'done', '2026-03-05T15:00:00Z'], // phase: complete, spec.md `updated:`
    ]);
    const ids = buildTimeline({ files: readFolder(HARBOR_001), commits: [] }).map((e) => e.id);
    // build → code-review sits right after review → build, the last dated transition before it.
    expect(ids.indexOf('stage-code-review')).toBe(ids.indexOf('stage-build') - 1);
  });

  test('undated: empty ts and `undated: true` together, never on a dated entry', () => {
    const all = everyFixtureFolder().flatMap((relDir) => deriveStages(readFolder(relDir)));
    const undated = all.filter((e) => e.undated === true);
    expect(undated.length).toBeGreaterThan(0);
    expect(undated.every((e) => e.ts === '' && e.derived)).toBe(true);
    const dated = all.filter((e) => e.undated !== true);
    expect(dated.every((e) => e.ts !== '' && Number.isFinite(Date.parse(e.ts)) && e.undated === undefined)).toBe(true);
  });

  test('a date without a time on the same day as the transition before it sorts after that transition', () => {
    // leadgen 012: created at `started:` 16:40Z, planned at its "Round 2 — before the plan, 2026-09-24" (midnight UTC
    // as an instant, but only a day as written).
    const stages = deriveStages(readFolder(LEADGEN_012));
    expect(steps(stages).slice(0, 2)).toEqual([
      [null, 'plan', '2026-09-24T16:40:00Z'],
      ['plan', 'tasks', '2026-09-24'],
    ]);
    const ids = buildTimeline({ files: readFolder(LEADGEN_012), commits: [] }).map((e) => e.id);
    expect(ids.indexOf('stage-tasks')).toBe(ids.indexOf('stage-plan') - 1);
  });

  test('every fixture spec: one continuous derived chain, listed newest first in its timeline', () => {
    const checked: string[] = [];
    for (const relDir of everyFixtureFolder()) {
      const files = readFolder(relDir);
      const stages = deriveStages(files);
      if (files.texts.spec === undefined) {
        expect(stages).toEqual([]);
        continue;
      }
      expect(stages.length).toBeGreaterThan(0);
      expect(stages[0]?.from).toBeNull();
      for (let i = 1; i < stages.length; i++) expect(stages[i]?.from).toBe(stages[i - 1]?.to);
      for (const e of stages) expect(e).toMatchObject({ kind: 'stage', derived: true, actor: null, ref: e.to });

      const merged = buildTimeline({ files, commits: [] }).filter((e) => e.kind === 'stage');
      expect(merged.map((e) => [e.from, e.to])).toEqual(stages.map((e) => [e.from, e.to]).reverse());
      checked.push(relDir);
    }
    expect(checked.length).toBeGreaterThanOrEqual(10);
  });

  test("the last derived transition enters the stage the stage table gives today, where the marks are not stale", () => {
    const last = (relDir: string): string | undefined => deriveStages(readFolder(relDir)).at(-1)?.to;
    expect(last(HARBOR_002)).toBe('build');
    expect(last(HARBOR_003)).toBe('tasks');
    expect(last('harbor/specs/005-config-format-choice')).toBe('review');
    expect(last(HARBOR_001)).toBe('done');
    expect(last(SPECTANT_001)).toBe('review'); // no reviewed mark: rounds alone do not move a spec out of review
    expect(last('leadgen/specs/archive/013-tech-debt')).toBe('done');
  });
});

// ─── T26 · ISC-80: sources merged in order, one entry per source event ───────────────────────────────────────────

type SourceKind = 'decision' | 'round' | 'gate' | 'stage';

/**
 * The source events of one spec folder, counted from its raw files without timeline.ts, by FORMAT.md's reading:
 * context.md's goal lock and its `### Q` blocks under a timed `## Round` (fences skipped), every rounds.jsonl line
 * with a `round` number and a string `ts`, every `.gates/*.json` mark with a string `at`. Stage transitions come
 * from `deriveStages`, the one module that derives them.
 */
function sourceRefs(relDir: string): Record<SourceKind, string[]> {
  const dir = join(FIXTURES, relDir);
  const read = (rel: string): string => (existsSync(join(dir, rel)) ? readFileSync(join(dir, rel), 'utf8') : '');

  const decision: string[] = [];
  let round: { n: string; ordinal: number } | null = null;
  let fenced = false;
  for (const line of read('context.md').split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    if (fenced) continue;
    if (line.startsWith('## ')) {
      if (/^## Goal\s+[—–-]+\s+confirmed\s+\d{4}-\d{2}-\d{2}\S*\s*$/.test(line)) decision.push('goal');
      const timed = /^## Round (\d+)\b.*,\s*\d{4}-\d{2}-\d{2}\S*\s*$/.exec(line);
      round = timed?.[1] === undefined ? null : { n: timed[1], ordinal: 0 };
      continue;
    }
    const q = /^### Q(\d*)\s*·/.exec(line);
    if (q && round) {
      round.ordinal += 1;
      const n = q[1] === undefined || q[1] === '' ? String(round.ordinal) : q[1]; // `### Q ·` counts by position
      decision.push(`R${round.n}.Q${n}`);
    }
  }

  const rounds: string[] = [];
  for (const raw of read('rounds.jsonl').split('\n')) {
    if (raw.trim() === '') continue;
    let line: unknown;
    try {
      line = JSON.parse(raw);
    } catch {
      continue;
    }
    const rec = line as { round?: unknown; ts?: unknown } | null;
    if (rec && typeof rec.round === 'number' && typeof rec.ts === 'string') rounds.push(String(rec.round));
  }

  const gate: string[] = [];
  const gatesDir = join(dir, '.gates');
  if (existsSync(gatesDir)) {
    for (const name of readdirSync(gatesDir).filter((n) => n.endsWith('.json'))) {
      const mark = JSON.parse(readFileSync(join(gatesDir, name), 'utf8')) as { at?: unknown };
      if (typeof mark.at === 'string') gate.push(name.replace(/\.json$/, ''));
    }
  }

  const stage = deriveStages(readFolder(relDir)).map((e) => e.to ?? '?');
  return { decision, round: rounds, gate, stage };
}

/** A commit touching the spec folder as T46's reader passes it; `files` rides along beside today's CommitRecord. */
type SyntheticCommit = CommitRecord & { readonly files: readonly string[] };

const refsOf = (entries: readonly TimelineEntry[], kind: string): string[] =>
  entries
    .filter((e) => e.kind === kind)
    .map((e) => e.ref ?? '?')
    .sort();

/** Per-kind counts, stage entries included. */
const kindCounts = (entries: readonly TimelineEntry[]): Record<string, number> => ({
  ...countByKind(entries),
  stage: entries.filter((e) => e.kind === 'stage').length,
});

// Harbor 002's source events: goal 03-03T10:00Z, round 1 03-06T09:10Z, round 2 03-07T11:20Z, reviewed mark (and its
// review → build) 03-07T15:30Z, round 3 03-08T16:30Z. Three commits between them, passed in shuffled order; the middle
// one names the reviewed mark's instant with a +02:00 offset (17:30+02:00 = 15:30Z).
const C_BETWEEN_1_2: SyntheticCommit = {
  sha: '3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a',
  ts: '2026-03-06T18:00:00Z',
  subject: 'fix(002): round 1 findings\n\nbody lines stay out of the title',
  files: ['specs/002-web-console/tasks.md'],
};
const C_AT_GATE: SyntheticCommit = {
  sha: '4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b',
  ts: '2026-03-07T17:30:00+02:00',
  subject: 'chore(002): record the review mark',
  files: ['specs/002-web-console/.gates/reviewed.json'],
};
const C_AFTER_3: SyntheticCommit = {
  sha: '5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c5c',
  ts: '2026-03-08T17:05:00Z',
  subject: 'feat(002): round 3',
  files: ['specs/002-web-console/rounds.jsonl', 'specs/002-web-console/tasks.md'],
};
const THREE_COMMITS: readonly SyntheticCommit[] = [C_AT_GATE, C_AFTER_3, C_BETWEEN_1_2];

const LEADGEN_022 = 'leadgen/specs/022-chat-turn-status-and-bulk-delete';

/** The instant each stage entry sorts at, by its `to`, as `stageInstants` gives it. */
function stageSortInstants(files: SpecFiles): Map<string, number> {
  const stages = deriveStages(files);
  const at = stageInstants(stages);
  return new Map(stages.map((e, i) => [e.to ?? '?', at[i] ?? Number.NaN]));
}

describe('sources merged in order, one entry per source event (T26, ISC-80)', () => {
  // Per kind, counted from the raw files, plus the one synthetic commit each test passes.
  const PINNED: ReadonlyArray<readonly [string, Readonly<Record<string, number>>]> = [
    [HARBOR_002, { decision: 1, round: 3, gate: 1, commit: 1, stage: 4 }],
    [SPECTANT_001, { decision: 11, round: 9, gate: 0, commit: 1, stage: 3 }],
    [LEADGEN_022, { decision: 6, round: 5, gate: 2, commit: 1, stage: 7 }],
  ];
  const ONE_COMMIT: CommitRecord = { sha: 'c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00', ts: '2026-01-01T00:00:00Z', subject: 'x' };

  for (const [relDir, pinned] of PINNED) {
    test(`${relDir}: exactly one entry per source event, counted from the raw files`, () => {
      const raw = sourceRefs(relDir);
      const entries = buildTimeline({ files: readFolder(relDir), commits: [ONE_COMMIT] });

      // The independent count is the pinned one, and the timeline holds exactly those events, ref for ref.
      const rawCounts: Record<string, number> = {
        decision: raw.decision.length,
        round: raw.round.length,
        gate: raw.gate.length,
        commit: 1,
        stage: raw.stage.length,
      };
      expect(rawCounts).toEqual({ ...pinned });
      expect(kindCounts(entries)).toEqual({ ...pinned });
      for (const kind of ['decision', 'round', 'gate', 'stage'] as const) expect(refsOf(entries, kind)).toEqual([...raw[kind]].sort());
      expect(refsOf(entries, 'commit')).toEqual([ONE_COMMIT.sha]);

      const total = Object.values(pinned).reduce((a, b) => a + b, 0);
      expect(entries).toHaveLength(total);
      expect(new Set(entries.map((e) => e.id)).size).toBe(total);
    });
  }

  test('three commits interleaved between harbor 002 rounds land at their instants, newest first, ids commit-<sha>', () => {
    const entries = buildTimeline({ files: readFolder(HARBOR_002), commits: THREE_COMMITS });
    expect(entries.map((e) => e.id)).toEqual([
      `commit-${C_AFTER_3.sha}`,
      'round-3',
      'stage-build',
      'gate-reviewed',
      `commit-${C_AT_GATE.sha}`, // the mark's instant in another offset: the commit sorts after the gate (rank rule)
      'round-2',
      `commit-${C_BETWEEN_1_2.sha}`,
      'round-1',
      'stage-review',
      'stage-tasks',
      'stage-plan',
      'decision-goal',
    ]);

    const commits = entries.filter((e) => e.kind === 'commit');
    expect(commits).toHaveLength(3);
    for (const c of THREE_COMMITS) {
      expect(commits.find((e) => e.ref === c.sha)).toEqual({
        ts: c.ts, // as the source wrote it, offset included
        kind: 'commit',
        derived: false,
        title: c.subject.split('\n')[0] ?? '',
        ref: c.sha,
        id: `commit-${c.sha}`,
      });
    }
    // The input order does not matter.
    const reversed = buildTimeline({ files: readFolder(HARBOR_002), commits: [...THREE_COMMITS].reverse() });
    expect(reversed.map((e) => e.id)).toEqual(entries.map((e) => e.id));
  });

  test('every fixture spec: ts non-increasing, rank order at equal instants, rule-placed stages right after their predecessor', () => {
    const RANK: Readonly<Record<string, number>> = { stage: -1, ...SOURCE_RANK };
    let placedByRule = 0;
    let checked = 0;
    for (const relDir of everyFixtureFolder()) {
      const files = readFolder(relDir);
      const entries = buildTimeline({ files, commits: COMMITS_HARBOR });
      const instants = stageSortInstants(files);

      // T15's rule: an undated stage, or a date-only one on its predecessor's day, sorts at its predecessor's instant.
      const byRule = (e: TimelineEntry): boolean =>
        e.kind === 'stage' && (e.undated === true || instants.get(e.to ?? '?') !== Date.parse(e.ts));

      const timed = entries.filter((e) => !byRule(e));
      for (let i = 1; i < timed.length; i++) {
        const a = timed[i - 1];
        const b = timed[i];
        if (!a || !b) throw new Error('unreachable');
        const ta = Date.parse(a.ts);
        const tb = Date.parse(b.ts);
        const where = [relDir, a.id, b.id];
        expect([...where, Number.isFinite(ta) && Number.isFinite(tb)]).toEqual([...where, true]);
        expect([...where, ta >= tb]).toEqual([...where, true]);
        if (ta === tb) expect([...where, (RANK[a.kind] ?? 9) <= (RANK[b.kind] ?? 9)]).toEqual([...where, true]);
      }

      entries.forEach((e, i) => {
        if (!byRule(e)) return;
        placedByRule += 1;
        // Right after (in time) the transition it follows: the next, older entry in the list is that stage entry.
        const next = entries[i + 1];
        const placement: unknown[] = [relDir, e.id, next?.kind, next?.to];
        expect(placement).toEqual([relDir, e.id, 'stage', e.from]);
      });
      checked += 1;
    }
    expect(checked).toBeGreaterThanOrEqual(10);
    expect(placedByRule).toBeGreaterThan(0);
  });

  test('two sources at the same moment stay two entries: reviewed mark and review → build, round and decision', () => {
    const harbor = buildTimeline({ files: readFolder(HARBOR_002), commits: [] });
    expect(harbor.filter((e) => e.ts === '2026-03-07T15:30:00Z').map((e) => [e.kind, e.ref, e.derived])).toEqual([
      ['stage', 'build', true],
      ['gate', 'reviewed', false],
    ]);

    // A synthetic folder where two decisions, a round, a gate mark and a commit share one instant, and a round number
    // is recorded twice: every event is its own entry, the repeated ref gets `-2`; blank, malformed and round-less
    // lines are no events.
    const at = '2026-05-01T10:00:00Z';
    const files: SpecFiles = {
      folder: '099-same-moment',
      texts: {
        context: `## Round 1 — during build, ${at}\n\n### Q1 · Same moment?\n\n- Chosen: yes\n\n### Q2 · Still?\n`,
        rounds: [
          JSON.stringify({ round: 1, ts: at }),
          '',
          'not json',
          JSON.stringify({ round: 1, ts: '2026-05-01T11:00:00Z' }),
          JSON.stringify({ ts: at }),
        ].join('\n'),
        gateReviewed: JSON.stringify({ gate: 'reviewed', at }),
      },
    };
    const entries = buildTimeline({ files, commits: [{ sha: 'abc1234', ts: at, subject: 'same moment' }] });
    expect(entries.map((e) => e.id)).toEqual([
      'round-1', // the 11:00 line, newest
      'decision-R1.Q1',
      'decision-R1.Q2',
      'round-1-2',
      'gate-reviewed',
      'commit-abc1234',
    ]);
    expect(entries.slice(1).every((e) => e.ts === at)).toBe(true);
  });

  test('events and commits together: both kinds present, recorded stages only, nothing derived', () => {
    const entries = buildTimeline({ files: readFolder(HARBOR_002), commits: THREE_COMMITS, events: EVENTS_002 });
    expect(kindCounts(entries)).toEqual({ decision: 1, round: 3, gate: 1, commit: 3, stage: EVENTS_002.length });
    expect(entries.some((e) => e.derived)).toBe(false);
    expect(entries.filter((e) => e.kind === 'stage').every((e) => e.actor === 'principal' && e.command !== undefined)).toBe(true);
    // At the mark's instant: the recorded transition, then the mark, then the commit.
    const i = entries.findIndex((e) => e.id === 'stage-build');
    expect(entries.slice(i, i + 3).map((e) => e.id)).toEqual(['stage-build', 'gate-reviewed', `commit-${C_AT_GATE.sha}`]);
    expect(new Set(entries.map((e) => e.id)).size).toBe(entries.length);
  });

  test('harbor 002 anchor: the exact merged list, kind, ref and ts in order', () => {
    const entries = buildTimeline({ files: readFolder(HARBOR_002), commits: [] });
    expect(entries.map((e) => [e.kind, e.ref, e.ts])).toEqual([
      ['round', '3', '2026-03-08T16:30:00Z'],
      ['stage', 'build', '2026-03-07T15:30:00Z'],
      ['gate', 'reviewed', '2026-03-07T15:30:00Z'],
      ['round', '2', '2026-03-07T11:20:00Z'],
      ['round', '1', '2026-03-06T09:10:00Z'],
      ['stage', 'review', ''],
      ['stage', 'tasks', ''],
      ['stage', 'plan', '2026-03-03T10:00:00Z'],
      ['decision', 'goal', '2026-03-03T10:00:00Z'],
    ]);
  });
});

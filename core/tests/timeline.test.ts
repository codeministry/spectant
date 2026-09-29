// T14 (spec 002, ISC-80): the merged timeline. context.md decisions, rounds.jsonl rounds, gate marks and the commits
// the server passes in become one newest-first list with one entry per source event. Stage entries are T15's.
// The fixture files are read here with node:fs; timeline.ts itself stays pure over the text.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';

import { FILE_KINDS, type CommitRecord, type SpecFiles, type TextFileKind, type TimelineEntry } from '../src/files.ts';
import { buildTimeline } from '../src/timeline.ts';

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
    expect(r3?.title).toContain('a question is open');
    expect(r3?.body).toContain('T19, T20, T21, T22, T23, T24, T25, T26, T27');
    expect(r3?.body).toContain('ISC-66, ISC-67, ISC-68');
    expect(r3?.body).toContain('Held: 4');
    expect(r3?.body).toContain('Stop: a question is open');
    expect(r3?.actor).toBe('Engineer');

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
    expect(gate).toMatchObject({ ts: '2026-03-06T08:45:00Z', ref: 'reviewed', id: 'gate-reviewed', derived: false });
    expect(entries.map((e) => e.id)).toEqual([
      `commit-${COMMITS_HARBOR[1]?.sha ?? '?'}`,
      'round-3',
      'round-2',
      'round-1',
      `commit-${COMMITS_HARBOR[0]?.sha ?? '?'}`,
      'gate-reviewed',
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

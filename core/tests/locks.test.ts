// The holder of a lock in the actor grammar (spec 008, T63, ISC-119). `readLockSources` runs every `session` it reads
// through `parseActor` and carries the result as `ClaimLock.actor`; a session outside the grammar is legacy: read,
// counted like any other, and flagged with one `actor-legacy` warning per file — once for `.spectant/activity.jsonl`,
// at its first legacy line, and once per frontier lock file. Harbor's log carries only grammar sessions.
//
// Every tree here is a fresh temp dir with synthetic sessions; no real state directory or session enters the tree.
import { afterAll, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseActor } from '../src/actor.ts';
import { readLockSources } from '../src/locks.ts';
import { FIXTURES } from './helpers/read-tree.ts';

const HARBOR = join(FIXTURES, 'harbor');
const NOW = new Date('2026-03-08T16:00:00Z');

const temps: string[] = [];
afterAll(() => temps.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

function tempDir(label: string): string {
  const dir = mkdtempSync(join(tmpdir(), `spectant-actor-locks-${label}-`));
  temps.push(dir);
  return dir;
}

function tempRepo(activity?: readonly object[]): string {
  const repo = tempDir('repo');
  cpSync(join(HARBOR, 'ISA.md'), join(repo, 'ISA.md'));
  if (activity !== undefined) {
    mkdirSync(join(repo, '.spectant'));
    writeFileSync(join(repo, '.spectant', 'activity.jsonl'), activity.map((l) => `${JSON.stringify(l)}\n`).join(''));
  }
  return repo;
}

function stateWithLocks(repo: string, sessions: Record<string, string>): string {
  const state = tempDir('state');
  const isa = join(repo, 'ISA.md');
  const dir = join(state, 'isa-locks', createHash('sha1').update(realpathSync(isa)).digest('hex').slice(0, 16));
  mkdirSync(dir, { recursive: true });
  for (const [claim, session] of Object.entries(sessions)) {
    writeFileSync(join(dir, `${claim}.lock`), `${JSON.stringify({ session, ts: '2026-03-08T15:30:00.000Z', isa })}\n`);
  }
  return state;
}

const claimLine = (claim: string, session: string, ts: string) => ({ ts, event: 'claim', claim, session });

describe('ClaimLock.actor: the session in the actor grammar', () => {
  test('harbor: every activity lock carries its session parsed, none legacy, no actor-legacy', async () => {
    const r = await readLockSources({ repoRoot: HARBOR });
    expect(r.locks).toEqual([
      { source: 'activity', claim: 'ISC-74', session: 'a:claude:sess-2', actor: parseActor('a:claude:sess-2'), since: '2026-03-08T14:06:00Z' },
    ]);
    expect(r.locks[0]?.actor).toEqual({ raw: 'a:claude:sess-2', kind: 'agent', id: 'a:claude:sess-2', legacy: false });
    expect(r.diagnostics).toEqual([]);
  });

  test('a sub-agent session reads as the sub-agent of its session on the task', async () => {
    const repo = tempRepo([claimLine('ISC-53', 'a:claude:sess-2/T4', '2026-03-06T09:12:00Z')]);
    const r = await readLockSources({ repoRoot: repo });
    expect(r.locks.map((l) => l.actor)).toEqual([{ raw: 'a:claude:sess-2/T4', kind: 'subagent', id: 'a:claude:sess-2', task: 'T4', legacy: false }]);
    expect(r.diagnostics).toEqual([]);
  });
});

describe('legacy sessions: one actor-legacy warning per file, the value still read', () => {
  test('legacy: the activity log warns once, at its first legacy line and claim, and every lock is still held', async () => {
    const repo = tempRepo([
      claimLine('ISC-72', 'a:claude:sess-2', '2026-03-08T14:05:00Z'),
      claimLine('ISC-73', 'spec-002-ISC-73', '2026-03-08T14:06:00Z'),
      claimLine('ISC-74', 'agent', '2026-03-08T14:07:00Z'),
      { ts: '2026-03-08T14:08:00Z', event: 'release', claim: 'ISC-74', session: 'agent' },
      claimLine('ISC-75', 'spec-002-ISC-75', '2026-03-08T14:09:00Z'),
    ]);
    const r = await readLockSources({ repoRoot: repo });
    expect(r.locks.map((l) => [l.claim, l.session, l.actor.kind, l.actor.legacy])).toEqual([
      ['ISC-72', 'a:claude:sess-2', 'agent', false],
      ['ISC-73', 'spec-002-ISC-73', 'legacy', true],
      ['ISC-75', 'spec-002-ISC-75', 'legacy', true],
    ]);
    expect(r.diagnostics).toEqual([
      expect.objectContaining({ severity: 'warning', code: 'actor-legacy', line: 2, claim: 'ISC-73', subject: 'spec-002-ISC-73' }),
    ]);
    expect(r.diagnostics?.[0]?.message).toContain('4 sessions');
    expect(r.diagnostics?.[0]?.message).toContain('"spec-002-ISC-73"');
  });

  test('legacy: each frontier lock file with a legacy session warns once, naming its claim; the lock still counts', async () => {
    const repo = tempRepo();
    const state = stateWithLocks(repo, { 'ISC-75': 'spec-002-ISC-75', 'ISC-76': 'a:lifeos:sess-9', 'ISC-77': 'principal' });
    const r = await readLockSources({ repoRoot: repo, lifeosStateDir: state, now: NOW });
    expect(r.locks.map((l) => [l.claim, l.actor.legacy])).toEqual([
      ['ISC-75', true],
      ['ISC-76', false],
      ['ISC-77', true],
    ]);
    expect(r.locks[0]?.actor).toEqual(parseActor('spec-002-ISC-75'));
    expect(r.diagnostics?.map((d) => [d.code, d.claim, d.subject])).toEqual([
      ['actor-legacy', 'ISC-75', 'spec-002-ISC-75'],
      ['actor-legacy', 'ISC-77', 'principal'],
    ]);
    expect(r.diagnostics?.[0]?.message).toStartWith('The frontier lock for ISC-75 carries 1 session ');
    expect(r.diagnostics?.every((d) => d.line === undefined)).toBe(true);
  });

  test('legacy: a lock skipped as foreign raises no actor-legacy; a malformed line is not counted', async () => {
    const repo = tempRepo([
      { ts: '2026-03-08T14:05:00Z', event: 'claim', claim: 'ISC-72' },
      claimLine('ISC-74', 'a:claude:sess-2', '2026-03-08T14:06:00Z'),
    ]);
    const state = tempDir('foreign');
    const isa = join(repo, 'ISA.md');
    const dir = join(state, 'isa-locks', createHash('sha1').update(realpathSync(isa)).digest('hex').slice(0, 16));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'ISC-75.lock'), JSON.stringify({ session: 'principal', ts: '2026-03-08T15:30:00.000Z', isa: join(state, 'other', 'ISA.md') }));
    const r = await readLockSources({ repoRoot: repo, lifeosStateDir: state, now: NOW });
    expect(r.diagnostics?.map((d) => d.code)).toEqual(['locks-frontier-foreign', 'locks-activity-malformed']);
  });
});

// Lock sources (spec 002 T20, ISC-37): LifeOS frontier locks when a LifeOS state directory is given, the
// `.spectant/activity.jsonl` claim/release lines when present, `none` when neither exists — and then no path outside
// the repository is touched.
//
// The frontier locks are synthetic: every LifeOS state directory here is a fresh temp dir, laid out the way LifeOS
// lays out its own (`isa-locks/<first 16 hex of sha1(realpath(ISA.md))>/<claim-id>.lock`, content
// `{"session","ts","isa"}`). No real state directory, session or path enters the repository.
import { afterAll, afterEach, describe, expect, spyOn, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import * as fsp from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';

import { parseClaims } from '../src/claims.ts';
import type { ClaimLock, LockReading } from '../src/files.ts';
import { FRONTIER_STALE_MS, readLockSources } from '../src/locks.ts';
import { partitionClaims } from '../src/status.ts';
import { FIXTURES } from './helpers/read-tree.ts';

const HARBOR = join(FIXTURES, 'harbor');
const HARBOR_002_SPEC = join(HARBOR, 'specs', '002-web-console', 'spec.md');
/** A fixed clock, a few minutes after the synthetic locks below were taken. */
const NOW = new Date('2026-03-08T16:00:00Z');

const temps: string[] = [];
afterAll(() => temps.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

function tempDir(label: string): string {
  const dir = mkdtempSync(join(tmpdir(), `spectant-locks-${label}-`));
  temps.push(dir);
  return dir;
}

/** A repository with harbor's master and, optionally, an activity log of the given lines. */
function tempRepo(activity?: readonly string[]): string {
  const repo = tempDir('repo');
  cpSync(join(HARBOR, 'ISA.md'), join(repo, 'ISA.md'));
  if (activity !== undefined) {
    mkdirSync(join(repo, '.spectant'));
    writeFileSync(join(repo, '.spectant', 'activity.jsonl'), activity.map((l) => `${l}\n`).join(''));
  }
  return repo;
}

/** The lock directory LifeOS uses for an ISA: sha1 of the ISA's real path, first 16 hex digits. */
function frontierDir(stateDir: string, isaPath: string): string {
  const hash = createHash('sha1').update(realpathSync(isaPath)).digest('hex').slice(0, 16);
  return join(stateDir, 'isa-locks', hash);
}

/** A LifeOS state directory holding the given lock files (claim → raw file content) for the repository's ISA.md. */
function stateWithLocks(repo: string, files: Record<string, string>): string {
  const state = tempDir('state');
  const dir = frontierDir(state, join(repo, 'ISA.md'));
  mkdirSync(dir, { recursive: true });
  for (const [claim, content] of Object.entries(files)) writeFileSync(join(dir, `${claim}.lock`), content);
  return state;
}

function lockFile(session: string, ts: string, isa: string): string {
  return `${JSON.stringify({ session, ts, isa })}\n`;
}

const codes = (r: LockReading) => (r.diagnostics ?? []).map((d) => d.code);

describe('frontier locks (LifeOS present)', () => {
  test('lock files for this ISA are listed with claim, session and since', async () => {
    const repo = tempRepo();
    const isa = join(repo, 'ISA.md');
    const state = stateWithLocks(repo, {
      'ISC-76': lockFile('spec-002-ISC-76', '2026-03-08T15:40:00.000Z', isa),
      'ISC-75': lockFile('spec-002-ISC-75', '2026-03-08T15:30:00.000Z', isa),
    });
    const r = await readLockSources({ repoRoot: repo, lifeosStateDir: state, now: NOW });
    expect(r.source).toBe('frontier');
    expect(r.sources).toEqual(['frontier']);
    expect(r.locks).toEqual([
      { source: 'frontier', claim: 'ISC-75', session: 'spec-002-ISC-75', since: '2026-03-08T15:30:00.000Z' },
      { source: 'frontier', claim: 'ISC-76', session: 'spec-002-ISC-76', since: '2026-03-08T15:40:00.000Z' },
    ]);
    expect(r.diagnostics).toEqual([]);
  });

  test('the repository reached through a symbolic link finds the same lock directory', async () => {
    const repo = tempRepo();
    const state = stateWithLocks(repo, { 'ISC-75': lockFile('spec-002-ISC-75', '2026-03-08T15:30:00.000Z', join(repo, 'ISA.md')) });
    const link = join(tempDir('link'), 'repo');
    symlinkSync(repo, link);
    const r = await readLockSources({ repoRoot: link, lifeosStateDir: state, now: NOW });
    expect(r.locks.map((l) => l.claim)).toEqual(['ISC-75']);
    expect(r.diagnostics).toEqual([]);
  });

  test('locks of another ISA are not read, and LifeOS without a lock for this ISA is still the frontier source', async () => {
    const repo = tempRepo();
    const other = tempRepo();
    const state = stateWithLocks(other, { 'ISC-75': lockFile('spec-002-ISC-75', '2026-03-08T15:30:00.000Z', join(other, 'ISA.md')) });
    const r = await readLockSources({ repoRoot: repo, lifeosStateDir: state, now: NOW });
    expect(r.source).toBe('frontier');
    expect(r.sources).toEqual(['frontier']);
    expect(r.locks).toEqual([]);
    expect(r.diagnostics).toEqual([]);
  });

  test('a lock whose isa field names another file is skipped with a diagnostic', async () => {
    const repo = tempRepo();
    const state = stateWithLocks(repo, { 'ISC-75': lockFile('spec-002-ISC-75', '2026-03-08T15:30:00.000Z', join(tempDir('elsewhere'), 'ISA.md')) });
    const r = await readLockSources({ repoRoot: repo, lifeosStateDir: state, now: NOW });
    expect(r.locks).toEqual([]);
    expect(codes(r)).toEqual(['locks-frontier-foreign']);
  });

  test('a lock older than the LifeOS stale TTL is not held; it is reported', async () => {
    const repo = tempRepo();
    const old = new Date(NOW.getTime() - FRONTIER_STALE_MS - 1000).toISOString();
    const state = stateWithLocks(repo, {
      'ISC-75': lockFile('spec-002-ISC-75', old, join(repo, 'ISA.md')),
      'ISC-76': lockFile('spec-002-ISC-76', '2026-03-08T15:40:00.000Z', join(repo, 'ISA.md')),
    });
    const r = await readLockSources({ repoRoot: repo, lifeosStateDir: state, now: NOW });
    expect(FRONTIER_STALE_MS).toBe(2 * 60 * 60 * 1000);
    expect(r.locks.map((l) => l.claim)).toEqual(['ISC-76']);
    expect(codes(r)).toEqual(['locks-frontier-stale']);
    expect(r.diagnostics?.[0]?.message).toContain('ISC-75');
  });

  test('malformed lock files are diagnostics, never a throw; files that are not .lock are ignored', async () => {
    const repo = tempRepo();
    const isa = join(repo, 'ISA.md');
    const state = stateWithLocks(repo, {
      'ISC-70': '{not json',
      'ISC-71': JSON.stringify(['an', 'array']),
      'ISC-72': JSON.stringify({ ts: '2026-03-08T15:30:00.000Z', isa }),
      'ISC-73': JSON.stringify({ session: 'spec-002-ISC-73', ts: 'yesterday', isa }),
      'ISC-76': lockFile('spec-002-ISC-76', '2026-03-08T15:40:00.000Z', isa),
    });
    // A LifeOS steal tombstone sits beside the locks and is not a lock.
    writeFileSync(join(frontierDir(state, isa), 'ISC-76.steal.0a1b2c3d'), 'x');
    const r = await readLockSources({ repoRoot: repo, lifeosStateDir: state, now: NOW });
    expect(r.locks.map((l) => l.claim)).toEqual(['ISC-76']);
    expect(codes(r)).toEqual(['locks-frontier-malformed', 'locks-frontier-malformed', 'locks-frontier-malformed', 'locks-frontier-malformed']);
    expect((r.diagnostics ?? []).every((d) => d.severity === 'warning')).toBe(true);
  });

  test('a LifeOS state directory that does not exist: no throw, no frontier source', async () => {
    const missing = join(tempDir('gone'), 'no-such-state');
    const r = await readLockSources({ repoRoot: HARBOR, lifeosStateDir: missing, now: NOW });
    expect(r.sources).toEqual(['activity']);
    expect(r.source).toBe('activity');
    expect(r.diagnostics).toEqual([]);
  });
});

describe('activity lines (.spectant/activity.jsonl)', () => {
  test("harbor's fixture: ISC-72 was claimed and released, ISC-74 is held", async () => {
    const r = await readLockSources({ repoRoot: HARBOR });
    expect(r.source).toBe('activity');
    expect(r.sources).toEqual(['activity']);
    expect(r.locks).toEqual([{ source: 'activity', claim: 'ISC-74', session: 'spec-002-ISC-74', since: '2026-03-08T14:06:00Z' }]);
    expect(r.diagnostics).toEqual([]);
  });

  test('malformed lines, unknown events and a release without a claim are diagnostics with line numbers', async () => {
    const repo = tempRepo([
      '{"ts":"2026-03-08T14:05:00Z","event":"claim","claim":"ISC-72","session":"s-72"}',
      'not json at all',
      '',
      '{"ts":"2026-03-08T14:06:00Z","event":"heartbeat","claim":"ISC-72","session":"s-72"}',
      '{"ts":"2026-03-08T14:07:00Z","event":"claim","session":"s-no-claim"}',
      '{"ts":"2026-03-08T14:08:00Z","event":"release","claim":"ISC-99","session":"s-99"}',
      '{"ts":"2026-03-08T14:09:00Z","event":"claim","claim":"ISC-74","session":"s-74"}',
    ]);
    const r = await readLockSources({ repoRoot: repo });
    expect(r.locks.map((l) => [l.claim, l.session])).toEqual([
      ['ISC-72', 's-72'],
      ['ISC-74', 's-74'],
    ]);
    expect((r.diagnostics ?? []).map((d) => [d.code, d.line])).toEqual([
      ['locks-activity-malformed', 2],
      ['locks-activity-malformed', 4],
      ['locks-activity-malformed', 5],
      ['locks-activity-release-unclaimed', 6],
    ]);
  });

  test('a claim taken over by another session moves to it; a release by a non-holder releases nothing', async () => {
    const repo = tempRepo([
      '{"ts":"2026-03-08T14:05:00Z","event":"claim","claim":"ISC-72","session":"s-a"}',
      '{"ts":"2026-03-08T14:06:00Z","event":"claim","claim":"ISC-72","session":"s-a"}',
      '{"ts":"2026-03-08T14:07:00Z","event":"claim","claim":"ISC-74","session":"s-a"}',
      '{"ts":"2026-03-08T14:08:00Z","event":"claim","claim":"ISC-74","session":"s-b"}',
      '{"ts":"2026-03-08T14:09:00Z","event":"release","claim":"ISC-72","session":"s-b"}',
    ]);
    const r = await readLockSources({ repoRoot: repo });
    expect(r.locks).toEqual([
      // A repeated claim by the holder keeps the first `since`.
      { source: 'activity', claim: 'ISC-72', session: 's-a', since: '2026-03-08T14:05:00Z' },
      { source: 'activity', claim: 'ISC-74', session: 's-b', since: '2026-03-08T14:08:00Z' },
    ]);
    expect((r.diagnostics ?? []).map((d) => [d.code, d.line])).toEqual([
      ['locks-activity-takeover', 4],
      ['locks-activity-release-foreign', 5],
    ]);
  });
});

describe('both sources', () => {
  test('the union keeps one entry per source; activity first, frontier last, so frontier wins a shared claim', async () => {
    const repo = tempRepo([
      '{"ts":"2026-03-08T14:06:00Z","event":"claim","claim":"ISC-74","task":"T27","session":"spec-002-ISC-74","worktree":"wt-7"}',
      '{"ts":"2026-03-08T14:10:00Z","event":"claim","claim":"ISC-76","task":"T29","session":"plugin-76","worktree":"wt-8"}',
    ]);
    const state = stateWithLocks(repo, {
      'ISC-75': lockFile('spec-002-ISC-75', '2026-03-08T15:30:00.000Z', join(repo, 'ISA.md')),
      'ISC-76': lockFile('spec-002-ISC-76', '2026-03-08T15:40:00.000Z', join(repo, 'ISA.md')),
    });
    const r = await readLockSources({ repoRoot: repo, lifeosStateDir: state, now: NOW });
    expect(r.source).toBe('frontier');
    expect(r.sources).toEqual(['frontier', 'activity']);
    expect(r.locks.map((l) => [l.source, l.claim, l.session])).toEqual([
      ['activity', 'ISC-74', 'spec-002-ISC-74'],
      ['activity', 'ISC-76', 'plugin-76'],
      ['frontier', 'ISC-75', 'spec-002-ISC-75'],
      ['frontier', 'ISC-76', 'spec-002-ISC-76'],
    ]);

    const p = partitionClaims(parseClaims(readFileSync(HARBOR_002_SPEC, 'utf8')).claims, r.locks);
    const taken = new Map(p.taken.map((t) => [t.id, t.session]));
    expect(taken.get('ISC-76')).toBe('spec-002-ISC-76');
    expect(taken.get('ISC-74')).toBe('spec-002-ISC-74');
  });
});

describe('the reading feeds the claim partition', () => {
  test('harbor 002 with the activity reading: ISC-74 is taken, not takeable', async () => {
    const r = await readLockSources({ repoRoot: HARBOR });
    const p = partitionClaims(parseClaims(readFileSync(HARBOR_002_SPEC, 'utf8')).claims, r.locks);
    expect(p.taken).toEqual([{ id: 'ISC-74', session: 'spec-002-ISC-74', since: '2026-03-08T14:06:00Z' }]);
    expect(p.takeable).not.toContain('ISC-74');
    expect([p.closed.length, p.takeable.length, p.blocked.length, p.taken.length]).toEqual([25, 3, 1, 1]);
  });
});

describe('neither source (ISC-37 anti-case)', () => {
  type Spied = 'readFile' | 'readdir' | 'realpath' | 'stat' | 'lstat' | 'access' | 'open' | 'opendir';
  const names: Spied[] = ['readFile', 'readdir', 'realpath', 'stat', 'lstat', 'access', 'open', 'opendir'];
  /** The part of a bun:test spy this block uses. */
  interface Spy {
    readonly mock: { readonly calls: ReadonlyArray<readonly unknown[]> };
    mockRestore(): void;
  }
  let spies: Spy[] = [];
  afterEach(() => {
    spies.forEach((s) => s.mockRestore());
    spies = [];
  });

  /** Every path handed to node:fs/promises while `run` runs. */
  async function touched(run: () => Promise<unknown>): Promise<string[]> {
    spies = names.map((name) => spyOn(fsp, name));
    await run();
    return spies.flatMap((s) => s.mock.calls.map((call) => String(call[0])));
  }

  test('no LifeOS and no activity log: source none, no lock, no diagnostic, nothing outside the repository touched', async () => {
    const repo = tempRepo();
    let r: LockReading | undefined;
    const paths = await touched(async () => {
      r = await readLockSources({ repoRoot: repo });
    });
    expect(r).toEqual({ source: 'none', sources: [], locks: [] as ClaimLock[], diagnostics: [] });
    expect(paths.length).toBeGreaterThan(0);
    for (const p of paths) expect(p.startsWith(repo + sep)).toBe(true);
  });

  test('null lifeosStateDir on harbor: only harbor paths are read', async () => {
    const paths = await touched(() => readLockSources({ repoRoot: HARBOR, lifeosStateDir: null }));
    expect(paths).toEqual([join(HARBOR, '.spectant', 'activity.jsonl')]);
  });

  test('nothing is written: the repository tree is unchanged after a read with both sources', async () => {
    const repo = tempRepo(['{"ts":"2026-03-08T14:06:00Z","event":"claim","claim":"ISC-74","session":"s-74"}']);
    const state = stateWithLocks(repo, { 'ISC-75': lockFile('spec-002-ISC-75', '2026-03-08T15:30:00.000Z', join(repo, 'ISA.md')) });
    const before = await fsp.readdir(repo, { recursive: true });
    const writes = ['writeFile', 'appendFile', 'mkdir', 'mkdtemp', 'rename', 'rm', 'unlink'].map((name) => spyOn(fsp, name as 'writeFile'));
    try {
      await readLockSources({ repoRoot: repo, lifeosStateDir: state, now: NOW });
      expect(writes.map((s) => s.mock.calls.length)).toEqual([0, 0, 0, 0, 0, 0, 0]);
    } finally {
      writes.forEach((s) => s.mockRestore());
    }
    expect((await fsp.readdir(repo, { recursive: true })).sort()).toEqual(before.sort());
  });
});

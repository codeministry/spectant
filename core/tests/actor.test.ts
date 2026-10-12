// The actor grammar (spec 008, T59, ISC-119). `core/src/actor.ts` reads one `actor` value into an ActorRef: `u:<8 hex>`
// a person, `a:<kind>:<id>` an agent, `a:<kind>:<id>/<task>` its sub-agent on one task, anything else legacy (kept,
// flagged, never rejected). `core/src/actor-id.ts` derives the person id from an e-mail address; it hashes with
// `node:crypto`, so it stays off the browser-safe barrel like `gates.ts`.
//
// The fixture walk reads every file of the harbor fixture that carries an actor — each `events.jsonl`, the
// `.spectant/activity.jsonl` (its `session` is the actor), every `.gates/*.json` mark and every `*.lock` file — and
// requires 0 values outside the three forms. Only synthetic addresses (`example.com`) appear here.
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';

import * as core from '../src/index.ts';
import { parseActor } from '../src/actor.ts';
import { actorIdOf } from '../src/actor-id.ts';

const HARBOR = join(import.meta.dir, '..', 'fixtures', 'harbor');
const SRC = join(import.meta.dir, '..', 'src');

type Source = 'events' | 'activity' | 'gate' | 'lock';

/** The source a harbor file is scanned as, or null when it carries no actor. */
function sourceOf(rel: string): Source | null {
  const name = basename(rel);
  if (name === 'events.jsonl') return 'events';
  if (rel === join('.spectant', 'activity.jsonl')) return 'activity';
  if (basename(dirname(rel)) === '.gates' && name.endsWith('.json')) return 'gate';
  if (name.endsWith('.lock')) return 'lock';
  return null;
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

/** Every actor value of one file: `actor` of an event line or mark, `session` of an activity line or lock. */
function actorsIn(source: Source, text: string): string[] {
  const objects: unknown[] = source === 'events' || source === 'activity'
    ? text.split('\n').filter((line) => line.trim() !== '').map((line) => JSON.parse(line) as unknown)
    : [JSON.parse(text) as unknown];
  const key = source === 'activity' || source === 'lock' ? 'session' : 'actor';
  return objects.map((value) => (value as Record<string, unknown>)[key]).filter((v): v is string => typeof v === 'string');
}

const scanned = walk(HARBOR)
  .map((path) => ({ rel: relative(HARBOR, path), path }))
  .flatMap(({ rel, path }) => {
    const source = sourceOf(rel);
    return source ? [{ rel, source, actors: actorsIn(source, readFileSync(path, 'utf8')) }] : [];
  })
  .sort((a, b) => a.rel.localeCompare(b.rel));

describe('actor grammar on the harbor fixture', () => {
  test('scans every events, activity, gate-mark and lock file of harbor', () => {
    // Harbor carries no frontier `*.lock` file (those live under the LifeOS state directory, built per test in
    // lifeos-optional.test.ts); its claim locks are the activity lines.
    expect(scanned.map(({ rel }) => rel.split('\\').join('/'))).toEqual([
      '.spectant/activity.jsonl',
      'specs/002-web-console/.gates/reviewed.json',
      'specs/002-web-console/events.jsonl',
      'specs/004-retention-policies/.gates/code-reviewed.json',
      'specs/004-retention-policies/.gates/reviewed.json',
      'specs/006-partial-push/.gates/reviewed.json',
      'specs/006-partial-push/events.jsonl',
      'specs/archive/001-manifest-sync/.gates/code-reviewed.json',
      'specs/archive/001-manifest-sync/.gates/reviewed.json',
      'specs/archive/001-manifest-sync/events.jsonl',
    ]);
    expect(scanned.filter(({ source }) => source === 'lock')).toEqual([]);
  });

  test('every file carries actors and 0 values fall outside the three forms', () => {
    for (const { rel, actors } of scanned) expect({ rel, count: actors.length > 0 }).toEqual({ rel, count: true });
    const values = scanned.flatMap(({ rel, actors }) => actors.map((raw) => ({ rel, raw, ref: parseActor(raw) })));
    expect(values.length).toBe(24);
    expect(values.filter(({ ref }) => ref.legacy).map(({ rel, raw }) => `${rel}: ${raw}`)).toEqual([]);
    const kinds = new Set(values.map(({ ref }) => ref.kind));
    expect([...kinds].sort()).toEqual(['agent', 'person', 'subagent']);
  });
});

describe('parseActor', () => {
  test('u:<8 hex> is a person', () => {
    expect(parseActor('u:3f9c0a7d')).toEqual({ raw: 'u:3f9c0a7d', kind: 'person', id: 'u:3f9c0a7d', legacy: false });
  });

  test('a:<kind>:<id> is an agent', () => {
    expect(parseActor('a:claude:sess-7')).toEqual({ raw: 'a:claude:sess-7', kind: 'agent', id: 'a:claude:sess-7', legacy: false });
  });

  test('a:<kind>:<id>/<task> is a sub-agent of that agent on the task', () => {
    expect(parseActor('a:claude:sess-7/T12')).toEqual({
      raw: 'a:claude:sess-7/T12',
      kind: 'subagent',
      id: 'a:claude:sess-7',
      task: 'T12',
      legacy: false,
    });
  });

  test('legacy: a bare word is kept as its own id and flagged', () => {
    for (const raw of ['principal', 'agent', 'spec-002-ISC-75']) {
      expect(parseActor(raw)).toEqual({ raw, kind: 'legacy', id: raw, legacy: true });
    }
  });

  test('legacy: near misses of the grammar are legacy, never rejected', () => {
    for (const raw of [
      '', ' u:3f9c0a7d', 'u:3f9c0a7d ', 'u:3F9C0A7D', 'u:3f9c0a7', 'u:3f9c0a7d0', 'u:', 'a:claude', 'a:claude:',
      'a::sess-7', 'a:Claude:sess-7', 'a:claude:Sess-7', 'a:claude:-sess', 'a:claude:sess-7/', 'a:claude:sess-7/t12',
      'a:claude:sess-7/T12/T13', 'a:claude:sess:7', 'dev@example.com',
    ]) {
      expect(parseActor(raw)).toEqual({ raw, kind: 'legacy', id: raw, legacy: true });
    }
  });
});

describe('actorIdOf', () => {
  test('u: plus the first eight hex digits of sha256 over the address, unsalted by default', () => {
    // printf '%s' 'dev@example.com' | shasum -a 256 → eb2b6c0d…
    expect(actorIdOf('dev@example.com')).toBe('u:eb2b6c0d');
    expect(parseActor(actorIdOf('dev@example.com')).kind).toBe('person');
  });

  test('the address is lower-cased and trimmed before hashing', () => {
    expect(actorIdOf('Dev@Example.COM')).toBe('u:eb2b6c0d');
    expect(actorIdOf('  dev@example.com\n')).toBe('u:eb2b6c0d');
  });

  test('a salt is prepended to the normalised address', () => {
    // printf '%s' 'pepperdev@example.com' | shasum -a 256 → 23bc14f2…
    expect(actorIdOf('DEV@example.com', 'pepper')).toBe('u:23bc14f2');
    expect(actorIdOf('dev@example.com', '')).toBe('u:eb2b6c0d');
  });

  test('stays off the browser-safe barrel; actor.ts imports no Node or Bun API', () => {
    expect((core as Record<string, unknown>).actorIdOf).toBeUndefined();
    expect(typeof (core as Record<string, unknown>).parseActor).toBe('function');
    const source = readFileSync(join(SRC, 'actor.ts'), 'utf8');
    expect(source).not.toMatch(/from ['"](node:|bun)/);
    expect(readFileSync(join(SRC, 'index.ts'), 'utf8')).not.toContain('actor-id');
  });
});

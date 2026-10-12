// The live frame (T21 + T28, ISC-90): tasks.md's current boxes over the last result frame, then the lock sources on
// top; a task whose claim a session holds is in flight (`running`) with that session's name.
//
// Three sources: the harbor fixture's own `.spectant/activity.jsonl` (read through `readLockSources`, no LifeOS
// state directory, so nothing outside the fixture is read), a hand-made frontier reading, and none. The clock is
// always passed in; nothing here reads the time of day.
import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseActor } from '../src/actor.ts';
import type { ClaimLock, LiveFrame, LockReading, SpecFiles } from '../src/files.ts';
import { hashForGate } from '../src/gates.ts';
import { buildFrames } from '../src/frames.ts';
import { buildLiveFrame, LIVE_STALE_MS } from '../src/live.ts';
import { readLockSources } from '../src/locks.ts';
import { FIXTURES, readTreeAt } from './helpers/read-tree.ts';

const HARBOR = join(FIXTURES, 'harbor');
const MIN = 60_000;
/** The activity line of the fixture: T27's claim ISC-74, taken at 14:06 and never released. */
const T27_SINCE = '2026-03-08T14:06:00Z';
const at = (minutesAfterClaim: number): Date => new Date(Date.parse(T27_SINCE) + minutesAfterClaim * MIN);

/** Harbor 002's texts with the tree's constitution, as the server passes them. */
function harbor002(): SpecFiles {
  const tree = readTreeAt(HARBOR);
  const files = tree.specs.find((s) => s.folder === '002-web-console');
  if (!files) throw new Error('harbor 002 missing');
  return { folder: files.folder, texts: { ...files.texts, ...(tree.constitution === null ? {} : { constitution: tree.constitution }) } };
}

/** `files` with one text replaced by `edit` of it. */
function edited(files: SpecFiles, kind: 'tasks' | 'spec', edit: (text: string) => string): SpecFiles {
  return { folder: files.folder, texts: { ...files.texts, [kind]: edit(files.texts[kind] ?? '') } };
}

/** The folder with a reviewed mark fresh over its current texts: an edit that a review has since accepted (ISC-99). */
function remarked(files: SpecFiles): SpecFiles {
  const t = files.texts;
  const hash = (f: 'spec.md' | 'plan.md' | 'tasks.md', text: string | undefined) => (text === undefined ? null : hashForGate(f, text));
  const mark = { gate: 'reviewed', at: '2026-03-09T09:00:00Z', files: { 'spec.md': hash('spec.md', t.spec), 'plan.md': hash('plan.md', t.plan), 'tasks.md': hash('tasks.md', t.tasks) } };
  return { folder: files.folder, texts: { ...t, gateReviewed: JSON.stringify(mark) } };
}

const NONE: LockReading = { source: 'none', sources: [], locks: [] };

const card = (frame: LiveFrame, id: string) => {
  const hit = frame.cards.find((c) => c.task === id);
  if (!hit) throw new Error(`${id} not on the live frame`);
  return hit;
};

/** The fixture tree's own reading: its activity log, no LifeOS state directory. */
const HARBOR_LOCKS = await readLockSources({ repoRoot: HARBOR });

describe('activity source (harbor 002, the fixture log)', () => {
  const locks = HARBOR_LOCKS;
  const files = harbor002();

  test('the reading is the activity log: ISC-74 held, ISC-72 released', () => {
    expect(locks.source).toBe('activity');
    expect(locks.locks.map((l) => [l.claim, l.session])).toEqual([['ISC-74', 'a:claude:sess-2']]);
  });

  test('T27 carries ISC-74 and is in flight with the session name, 30 minutes in, not stale', () => {
    const live = buildLiveFrame({ files, locks, now: at(30) });
    const t27 = card(live, 'T27');
    expect(t27.claim).toBe('ISC-74');
    expect(t27.state).toBe('running');
    expect(t27.lock).toEqual({ source: 'activity', session: 'a:claude:sess-2' });
    expect(t27.since).toBe(T27_SINCE);
    expect(t27.elapsedMs).toBe(30 * MIN);
    expect(t27.stale).toBe(false);
    expect(live.cards.filter((c) => c.state === 'running').map((c) => c.task)).toEqual(['T27']);
  });

  test('at 60 minutes without a release the card and its agent are stale (default 45 min)', () => {
    expect(LIVE_STALE_MS).toBe(45 * MIN);
    const live = buildLiveFrame({ files, locks, now: at(60) });
    expect(card(live, 'T27')).toMatchObject({ state: 'running', elapsedMs: 60 * MIN, stale: true });
    expect(live.agents).toEqual([
      { session: 'a:claude:sess-2', source: 'activity', claims: ['ISC-74'], since: T27_SINCE, elapsedMs: 60 * MIN, stale: true },
    ]);
    expect(live.staleAfterMs).toBe(LIVE_STALE_MS);
  });

  test('the stale threshold is an option', () => {
    const live = buildLiveFrame({ files, locks, now: at(60), staleAfterMs: 90 * MIN });
    expect(card(live, 'T27').stale).toBe(false);
    expect(live.staleAfterMs).toBe(90 * MIN);
  });

  test('the frame head: live kind, last round, now as ts, the lock source, no closed claims', () => {
    const frames = buildFrames(files);
    const live = buildLiveFrame({ files, locks, now: at(30) });
    expect(live).toMatchObject({
      index: frames.length,
      kind: 'live',
      round: 3,
      ts: at(30).toISOString(),
      label: 'Live',
      lockSource: 'activity',
      closedClaims: [],
    });
    expect(live.locks).toEqual([{ source: 'activity', claim: 'ISC-74', session: 'a:claude:sess-2', actor: parseActor('a:claude:sess-2'), since: T27_SINCE }]);
    // spec.md: 25 of 30 claims checked; the board: 27 landed (26 closed + the operator's T30) of 32.
    expect(live.progress).toEqual({ claims: { closed: 25, total: 30 }, tasks: { landed: 27, total: 32 } });
    expect(live.worst).toBe('question');
  });

  test('needs you: the question, then the open operator step', () => {
    const live = buildLiveFrame({ files, locks, now: at(30) });
    expect(live.needsYou.map((c) => [c.task, c.state])).toEqual([
      ['T29', 'question'],
      ['T31', 'operatorOpen'],
    ]);
  });

  test('passing the frames in gives the same frame as letting the live frame build them', () => {
    const now = at(30);
    expect(buildLiveFrame({ files, frames: buildFrames(files), locks, now })).toEqual(buildLiveFrame({ files, locks, now }));
  });
});

describe('frontier source (hand-made reading)', () => {
  const files = harbor002();
  const activity: ClaimLock = { source: 'activity', claim: 'ISC-74', session: 'a:claude:sess-2', actor: parseActor('a:claude:sess-2'), since: T27_SINCE };
  const frontier: ClaimLock = { source: 'frontier', claim: 'ISC-75', session: 'spec-002-ISC-75', actor: parseActor('spec-002-ISC-75'), since: '2026-03-08T14:30:00.000Z' };
  const reading: LockReading = { source: 'frontier', sources: ['frontier', 'activity'], locks: [activity, frontier] };

  test('both sessions are on the rail; the frame names frontier; T28 runs under the frontier lock', () => {
    const live = buildLiveFrame({ files, locks: reading, now: at(30) });
    expect(live.lockSource).toBe('frontier');
    expect(live.agents.map((a) => [a.session, a.source, a.claims, a.elapsedMs])).toEqual([
      ['a:claude:sess-2', 'activity', ['ISC-74'], 30 * MIN],
      ['spec-002-ISC-75', 'frontier', ['ISC-75'], 6 * MIN],
    ]);
    expect(card(live, 'T28')).toMatchObject({ state: 'running', lock: { source: 'frontier', session: 'spec-002-ISC-75' }, elapsedMs: 6 * MIN, stale: false });
    // T28 was held for width in round 3; the lock replaces that reason with the session.
    expect(card(live, 'T28').reason).toBeUndefined();
    expect(live.cards.filter((c) => c.state === 'running').map((c) => c.task)).toEqual(['T27', 'T28']);
  });

  test('a claim held in both sources shows the frontier session', () => {
    const both: LockReading = {
      source: 'frontier',
      sources: ['frontier', 'activity'],
      locks: [activity, { source: 'frontier', claim: 'ISC-74', session: 'spec-002-ISC-74-b', actor: parseActor('spec-002-ISC-74-b'), since: '2026-03-08T14:20:00Z' }],
    };
    const live = buildLiveFrame({ files, locks: both, now: at(30) });
    expect(card(live, 'T27').lock).toEqual({ source: 'frontier', session: 'spec-002-ISC-74-b' });
    expect(live.locks).toHaveLength(1);
    expect(live.agents.map((a) => a.session)).toEqual(['spec-002-ISC-74-b']);
  });

  test('a lock on a claim of another spec, and an operator step under a lock, stay out of flight', () => {
    const other: ClaimLock = { source: 'frontier', claim: 'ISC-999', session: 'spec-009-ISC-999', actor: parseActor('spec-009-ISC-999'), since: T27_SINCE };
    const onOperator: ClaimLock = { source: 'frontier', claim: 'ISC-77', session: 'spec-002-ISC-77', actor: parseActor('spec-002-ISC-77'), since: T27_SINCE };
    const live = buildLiveFrame({ files, locks: { source: 'frontier', sources: ['frontier'], locks: [other, onOperator] }, now: at(30) });
    expect(live.locks.map((l) => l.claim)).toEqual(['ISC-77']);
    // T31 is the principal's own step on ISC-77: an agent's lock does not put it in flight.
    expect(card(live, 'T31').state).toBe('operatorOpen');
    expect(live.cards.some((c) => c.state === 'running')).toBe(false);
    // The session still holds the claim, so the rail shows it.
    expect(live.agents.map((a) => a.session)).toEqual(['spec-002-ISC-77']);
  });
});

describe('no source', () => {
  const files = harbor002();

  test('no running card, lockSource none, and the cards are the last result frame under the current boxes', () => {
    const live = buildLiveFrame({ files, locks: NONE, now: at(30) });
    expect(live.lockSource).toBe('none');
    expect(live.agents).toEqual([]);
    expect(live.locks).toEqual([]);
    expect(live.cards.some((c) => c.state === 'running')).toBe(false);
    // tasks.md matches round 3's board box for box (T27 still open and dispatched), so nothing moves but T34, held in
    // round 3 and struck since: it stays on the board as absent, with its strike note in place of the hold reason.
    const last = buildFrames(files).at(-1);
    expect(last?.kind).toBe('result');
    const struck = { state: 'absent' as const, note: "struck 2026-03-08: covered by T32's keyboard probe" };
    // Nobody works a card without a lock (T66): agent and sub-agent are null on every card.
    const idle = { agent: null, subagent: null };
    expect(live.cards).toEqual((last?.cards ?? []).map(({ reason, ...c }) => (c.task === 'T34' ? { ...c, ...struck, ...idle } : { ...c, ...(reason === undefined ? {} : { reason }), ...idle })));
  });

  test('without rounds every open task waits with its hold reason, every checked box is landed', () => {
    const bare: SpecFiles = { folder: files.folder, texts: { ...files.texts, rounds: undefined } };
    const live = buildLiveFrame({ files: bare, locks: NONE, now: at(30) });
    expect(live.round).toBeNull();
    expect(live.index).toBe(0);
    expect(card(live, 'T1')).toMatchObject({ state: 'closed', tries: 0 });
    expect(card(live, 'T30').state).toBe('operatorDone');
    expect(card(live, 'T27')).toMatchObject({ state: 'waiting', tries: 0, reason: 'claim takeable, edges closed' });
    expect(card(live, 'T31')).toMatchObject({ state: 'operatorOpen', reason: "operator lane — the principal's own action, never auto-dispatched" });
    // takeable.ts's order: the claim's own edge (ISC-78 after ISC-77) holds before the task edge (after: T31).
    expect(card(live, 'T32')).toMatchObject({ state: 'waiting', reason: 'claim blocked by ISC-77' });
  });

  test('without tasks.md the last result frame carries over unchanged', () => {
    const noTasks: SpecFiles = { folder: files.folder, texts: { ...files.texts, tasks: undefined } };
    expect(buildLiveFrame({ files: noTasks, locks: NONE, now: at(30) }).cards).toEqual((buildFrames(files).at(-1)?.cards ?? []).map((c) => ({ ...c, agent: null, subagent: null })));
  });

  test('an empty folder gives an empty live frame', () => {
    const live = buildLiveFrame({ files: { folder: '009-empty', texts: {} }, locks: NONE, now: at(0) });
    expect(live).toMatchObject({ index: 0, round: null, cards: [], worst: 'closed', needsYou: [], agents: [] });
  });
});

describe('tasks.md overlays the last round', () => {
  const files = harbor002();
  const tick = (id: string) => (text: string) => text.replace(`- [ ] ${id} `, `- [x] ${id} `);

  test('a box checked after the last round flips the card to done while its claim is open', () => {
    const live = buildLiveFrame({ files: edited(files, 'tasks', tick('T28')), locks: NONE, now: at(30) });
    expect(card(live, 'T28')).toMatchObject({ state: 'done', tries: 0 });
    expect(card(live, 'T28').reason).toBeUndefined();
  });

  test('… and to closed once the claim is checked; a landed card leaves flight even under a lock', async () => {
    const locks = await readLockSources({ repoRoot: HARBOR });
    const ticked = edited(edited(files, 'tasks', tick('T27')), 'spec', (t) => t.replace('- [ ] ISC-74:', '- [x] ISC-74:'));
    const live = buildLiveFrame({ files: ticked, locks, now: at(30) });
    // Dispatched in round 3, so the try and the builder carry over.
    expect(card(live, 'T27')).toMatchObject({ state: 'closed', tries: 1, builder: 'Engineer' });
    expect(live.cards.some((c) => c.state === 'running')).toBe(false);
    expect(live.agents.map((a) => a.claims)).toEqual([['ISC-74']]);
  });

  test('an operator box checked after the last round is operator done', () => {
    const live = buildLiveFrame({ files: edited(files, 'tasks', tick('T31')), locks: NONE, now: at(30) });
    expect(card(live, 'T31').state).toBe('operatorDone');
    expect(live.needsYou.map((c) => c.task)).toEqual(['T29']);
  });

  test('a struck task on the last board is absent; one never on a board has no card', () => {
    const struck = edited(files, 'tasks', (text) =>
      text
        .replace(/^- \[ \] (T28 .*)$/m, '- ~~$1~~ — struck 2026-03-09: folded into T29')
        .replace(/^(- \[ \] T32 .*)$/m, '$1\n- ~~T33 · ISC-78 · web — theme-switch: contrast · `web/src/app/theme-switch/`~~ — struck'),
    );
    const live = buildLiveFrame({ files: struck, locks: { source: 'frontier', sources: ['frontier'], locks: [{ source: 'frontier', claim: 'ISC-75', session: 's', actor: parseActor('s'), since: T27_SINCE }] }, now: at(30) });
    expect(card(live, 'T28')).toMatchObject({ state: 'absent', note: 'struck 2026-03-09: folded into T29' });
    expect(live.cards.some((c) => c.task === 'T33')).toBe(false);
    // Absent counts in no total and is never put in flight.
    expect(live.progress.tasks.total).toBe(31);
  });

  test('a task added after the last round waits with its hold reason; a reworded id carries no state', () => {
    const added = edited(files, 'tasks', (text) =>
      text
        .replace('search-box: keyboard reach and focus ring (ISC-75)', 'search-box: keyboard reach, focus ring and skip link (ISC-75)')
        .replace(/^(- \[ \] T32 .*)$/m, '$1\n- [ ] T33 · ISC-75 · web — search-box: contrast check (after: T28) · `web/src/app/search-box/`'),
    );
    // The added line makes the reviewed mark stale: until a review accepts it, the gate is the reason (ISC-99).
    expect(card(buildLiveFrame({ files: added, locks: NONE, now: at(30) }), 'T33')).toMatchObject({ state: 'waiting', reason: 'spec not reviewed — the reviewed mark is stale' });
    const live = buildLiveFrame({ files: remarked(added), locks: NONE, now: at(30) });
    expect(card(live, 'T33')).toMatchObject({ state: 'waiting', tries: 0, reason: 'after T28 still open' });
    expect(card(live, 'T33').text).toBe('search-box: contrast check');
    // T28 was held for width in round 3 under its old text: renumbered or reworded, it starts fresh.
    expect(card(live, 'T28')).toMatchObject({ state: 'waiting', tries: 0, text: 'search-box: keyboard reach, focus ring and skip link (ISC-75)' });
    expect(card(live, 'T28').reason).not.toBe('width 10 reached');
    // Board order is tasks.md order.
    expect(live.cards.map((c) => c.task).slice(-4)).toEqual(['T31', 'T32', 'T33', 'T34']);
  });
});

describe('who works a task (spec 008, T66, ISC-131.1)', () => {
  const files = harbor002();
  const SESS2 = parseActor('a:claude:sess-2');
  const SUB_T4 = parseActor('a:claude:sess-2/T4');
  const workers = (frame: LiveFrame) => frame.cards.filter((c) => c.agent !== null || c.subagent !== null).map((c) => [c.task, c.agent?.raw ?? null, c.subagent?.raw ?? null]);
  const lockOn = (claim: string, session: string): LockReading => ({ source: 'activity', sources: ['activity'], locks: [{ source: 'activity', claim, session, actor: parseActor(session), since: T27_SINCE }] });

  /** Harbor's own activity lines, filtered, as the log of a temp repository: read back through the real reader. */
  async function harborActivity(keep: (entry: { event: string }) => boolean): Promise<LockReading> {
    const lines = readFileSync(join(HARBOR, '.spectant', 'activity.jsonl'), 'utf8').split('\n').filter((l) => l.trim() !== '' && keep(JSON.parse(l) as { event: string }));
    const root = mkdtempSync(join(tmpdir(), 'spectant-live-t66-'));
    mkdirSync(join(root, '.spectant'));
    try {
      writeFileSync(join(root, '.spectant', 'activity.jsonl'), `${lines.join('\n')}\n`);
      return await readLockSources({ repoRoot: root });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  test("harbor's log as it stands: T27 is worked by the agent a:claude:sess-2, no sub-agent; every other card by nobody", () => {
    const live = buildLiveFrame({ files, locks: HARBOR_LOCKS, now: at(30) });
    expect(card(live, 'T27')).toMatchObject({ state: 'running', agent: SESS2, subagent: null });
    expect(card(live, 'T27').agent).toEqual({ raw: 'a:claude:sess-2', kind: 'agent', id: 'a:claude:sess-2', legacy: false });
    expect(workers(live)).toEqual([['T27', 'a:claude:sess-2', null]]);
  });

  test("harbor's claim lines without their releases: T4 by the sub-agent a:claude:sess-2/T4 under its parent, T25 and T27 by the agent", async () => {
    const locks = await harborActivity((e) => e.event === 'claim');
    expect(locks.locks.map((l) => [l.claim, l.session])).toEqual([
      ['ISC-53', 'a:claude:sess-2/T4'],
      ['ISC-72', 'a:claude:sess-2'],
      ['ISC-74', 'a:claude:sess-2'],
    ]);
    // Without rounds and with T4 and T25 open again, all three claims' cards are in flight.
    const open = edited({ folder: files.folder, texts: { ...files.texts, rounds: undefined } }, 'tasks', (t) => t.replace('- [x] T4 ', '- [ ] T4 ').replace('- [x] T25 ', '- [ ] T25 '));
    const live = buildLiveFrame({ files: open, locks, now: at(30) });
    expect(live.cards.filter((c) => c.state === 'running').map((c) => c.task)).toEqual(['T4', 'T25', 'T27']);
    expect(card(live, 'T4')).toMatchObject({ agent: SESS2, subagent: SUB_T4 });
    expect(card(live, 'T4').subagent).toEqual({ raw: 'a:claude:sess-2/T4', kind: 'subagent', id: 'a:claude:sess-2', task: 'T4', legacy: false });
    expect(workers(live)).toEqual([
      ['T4', 'a:claude:sess-2', 'a:claude:sess-2/T4'],
      ['T25', 'a:claude:sess-2', null],
      ['T27', 'a:claude:sess-2', null],
    ]);
  });

  test('a sub-agent on another task of the claim names its parent as the agent, but not itself as the sub-agent', () => {
    const live = buildLiveFrame({ files, locks: lockOn('ISC-74', 'a:claude:sess-2/T9'), now: at(30) });
    expect(card(live, 'T27')).toMatchObject({ state: 'running', agent: SESS2, subagent: null });
  });

  test('a person holding the claim (u:) is no agent: running, agent null, sub-agent null', () => {
    const live = buildLiveFrame({ files, locks: lockOn('ISC-74', 'u:3f9c0a7d'), now: at(30) });
    expect(card(live, 'T27')).toMatchObject({ state: 'running', lock: { source: 'activity', session: 'u:3f9c0a7d' }, agent: null, subagent: null });
    expect(workers(live)).toEqual([]);
  });

  test('a legacy session is no agent either: running, agent null, sub-agent null', () => {
    const live = buildLiveFrame({ files, locks: lockOn('ISC-75', 'spec-002-ISC-75'), now: at(30) });
    expect(card(live, 'T28')).toMatchObject({ state: 'running', lock: { source: 'activity', session: 'spec-002-ISC-75' }, agent: null, subagent: null });
    expect(workers(live)).toEqual([]);
  });

  test('a landed card under a lock is worked by nobody', () => {
    const ticked = edited(edited(files, 'tasks', (t) => t.replace('- [ ] T27 ', '- [x] T27 ')), 'spec', (t) => t.replace('- [ ] ISC-74:', '- [x] ISC-74:'));
    const live = buildLiveFrame({ files: ticked, locks: HARBOR_LOCKS, now: at(30) });
    expect(card(live, 'T27')).toMatchObject({ state: 'closed', agent: null, subagent: null });
  });
});

describe('purity', () => {
  test('the same input twice gives deep-equal frames and leaves the input untouched', async () => {
    const files = harbor002();
    const locks = await readLockSources({ repoRoot: HARBOR });
    const frames = buildFrames(files);
    const input = { files, frames, locks, now: at(30) };
    const before = structuredClone({ files, frames, locks });
    const nowBefore = input.now.getTime();
    const a = buildLiveFrame(input);
    const b = buildLiveFrame(input);
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
    expect({ files, frames, locks }).toEqual(before);
    expect(input.now.getTime()).toBe(nowBefore);
  });

  test('live.ts imports no runtime module outside core/src and reads no clock', async () => {
    const source = await Bun.file(join(import.meta.dir, '..', 'src', 'live.ts')).text();
    expect(source).not.toMatch(/from ['"](node:|bun)/);
    expect(source).not.toMatch(/Date\.now\(|new Date\(\s*\)/);
  });
});

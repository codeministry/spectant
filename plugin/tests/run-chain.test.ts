// The whole chain of one implement round (spec 032, T17, ISC-33.1): who writes which line of a task to
// `.spectant/activity.jsonl`. The plugin's hooks (`handleHook`, driven with the captured payload fixtures) write
// `claim`, `dispatch`, `build` and `release` from the marker line of each builder's brief; the parent of the round
// writes `patch` and `apply` through the activity tool (`spec-check activity patch|apply --claim …`), as
// `workflows/implement.md` tells it to, and nothing else.
//
// Per task the run events come in the order dispatch, build, patch, apply; every line of the chain carries its claim
// and is exactly core's plan for its fields; no `claim`, `release`, `dispatch` or `build` line carries the parent's
// actor. The implement workflow's own text is pinned to the same split: it never tells the parent to run `claim`,
// `release`, `activity dispatch` or `activity build`, and it tells it to write `patch` and `apply` with `--claim`.
//
// Every round runs in a fresh git repository under the system temp directory, the parent in a linked worktree of it
// (`.worktrees/001-digest`), as `/spec implement` runs from the spec's own worktree; never in this repository.
import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claimLine, releaseLine, runEventLine } from '../../core/src/activity-text.ts';
import type { RunEvent } from '../../core/src/files.ts';
import { handleHook } from '../src/hook.ts';
import { markerLine } from '../src/marker.ts';

const CLI = join(import.meta.dir, '..', 'src', 'spec-check.ts');
const FIXTURES = join(import.meta.dir, 'fixtures', 'payloads');
const IMPLEMENT = join(import.meta.dir, '..', 'spectant', 'skills', 'spec', 'workflows', 'implement.md');
const LOG = '.spectant/activity.jsonl';
/** The actor the hooks write: `a:claude:` and the first 8 characters of the fixtures' `session_id`. */
const HOOK = 'a:claude:00000000';
/** The actor the parent of the round passes to the activity tool. */
const PARENT = 'a:claude:spec-001';
const NOW = new Date('2026-10-19T10:00:00.000Z');

type Payload = Record<string, unknown>;

/** One builder of the round: its agent id and the task and claim its brief's marker names. */
interface Builder {
  readonly agent: string;
  readonly task: string;
  readonly claim: string;
}

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  dirs.push(dir);
  return dir;
}

function git(cwd: string, args: readonly string[]): void {
  const r = Bun.spawnSync(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' });
  if (r.exitCode !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr.toString()}`);
}

/** A git repository with one commit and the parent's linked worktree; returns both paths. */
function repoWithWorktree(): { root: string; tree: string } {
  const root = tempDir('spectant-chain-repo-');
  git(root, ['init', '-q', '-b', 'main']);
  writeFileSync(join(root, 'README.md'), '# Fixture\n');
  git(root, ['add', 'README.md']);
  git(root, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-q', '-m', 'init']);
  const tree = join(root, '.worktrees', '001-digest');
  git(root, ['worktree', 'add', '-q', tree, '-b', 'feature/001-digest']);
  return { root, tree };
}

/** A captured fixture, rewritten for one builder: its marker line, its agent id. */
function payload(name: string, builder: Builder): Payload {
  const p = JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), 'utf8')) as Payload;
  const prompt = `${markerLine({ spec: '001', task: builder.task, claim: builder.claim })}\n\nImplement task ${builder.task} of spec 001 in this worktree.`;
  if (p.tool_input !== undefined) p.tool_input = { ...(p.tool_input as Payload), prompt };
  if (p.tool_response !== undefined) p.tool_response = { ...(p.tool_response as Payload), agentId: builder.agent, prompt };
  if (p.agent_id !== undefined) p.agent_id = builder.agent;
  return p;
}

const builderTree = (root: string, builder: Builder): string => join(root, '.claude', 'worktrees', `agent-${builder.agent}`);

/** The parent's activity tool, run from its worktree as the implement workflow does. */
function parentWrites(tree: string, root: string, event: 'patch' | 'apply', builder: Builder): void {
  const args = ['activity', event, '--task', builder.task, '--claim', builder.claim, '--session', PARENT, '--worktree', builderTree(root, builder)];
  const r = Bun.spawnSync(['bun', CLI, ...args], { cwd: tree, stdout: 'pipe', stderr: 'pipe' });
  if (r.exitCode !== 0) throw new Error(`spec-check ${args.join(' ')} exited ${String(r.exitCode)}: ${r.stderr.toString()}`);
}

/**
 * One round with two background builders. The hooks see each builder's `PreToolUse(Agent)`, `SubagentStart` and
 * `PostToolUse(Agent, async_launched)`; then, per builder, either its `SubagentStop` comes first and the parent pulls
 * and applies its patch after (the order of a live round), or the parent writes both tasks' patch and apply before the
 * stops arrive. Returns the log's lines, parsed, in file order.
 */
function round(builders: readonly Builder[], stopsFirst: boolean): { raw: string[]; lines: Payload[] } {
  const { root, tree } = repoWithWorktree();
  const data = tempDir('spectant-chain-data-');
  const hook = (p: Payload): string[] => handleHook(p, { projectDir: tree, dataDir: data, now: NOW });
  for (const b of builders) {
    hook(payload('pre-tool-use-agent', b));
    hook(payload('subagent-start', b));
    hook(payload('post-tool-use-agent-async', b));
  }
  for (const b of builders) {
    if (stopsFirst) hook(payload('subagent-stop', b));
    parentWrites(tree, root, 'patch', b);
    parentWrites(tree, root, 'apply', b);
  }
  if (!stopsFirst) for (const b of builders) hook(payload('subagent-stop', b));
  const raw = readFileSync(join(root, LOG), 'utf8').split('\n').filter((l) => l !== '');
  return { raw, lines: raw.map((l) => JSON.parse(l) as Payload) };
}

const RUN_EVENTS = new Set(['dispatch', 'build', 'patch', 'apply']);
const HOOK_EVENTS = new Set(['claim', 'release', 'dispatch', 'build']);
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

/** Core's plan for the fields a line carries: the line's form is exactly the one the shared writer produces. */
function replanned(line: Payload): string {
  const ts = String(line.ts);
  const claim = String(line.claim);
  const session = String(line.session);
  const task = str(line.task);
  const worktree = str(line.worktree);
  if (line.event === 'claim') return claimLine({ claim, session, ts, ...(task === undefined ? {} : { task }) }).trimEnd();
  if (line.event === 'release') return releaseLine({ claim, session, ts, ...(task === undefined ? {} : { task }) }).trimEnd();
  return runEventLine({ event: line.event as RunEvent, claim, task: String(task), session, ts, ...(worktree === undefined ? {} : { worktree }) }).trimEnd();
}

function expectChain(builders: readonly Builder[], stopsFirst: boolean): void {
  const { raw, lines } = round(builders, stopsFirst);
  for (const b of builders) {
    const runs = lines.filter((l) => l.task === b.task && RUN_EVENTS.has(String(l.event)));
    expect(runs.map((l) => l.event)).toEqual(['dispatch', 'build', 'patch', 'apply']);
    expect(runs.every((l) => l.claim === b.claim)).toBe(true);
  }
  for (const claim of new Set(builders.map((b) => b.claim))) {
    expect(lines.filter((l) => l.event === 'claim' && l.claim === claim)).toHaveLength(1);
    expect(lines.filter((l) => l.event === 'release' && l.claim === claim)).toHaveLength(1);
  }
  expect(lines.every((l) => typeof l.claim === 'string' && l.claim !== '')).toBe(true);
  expect(lines.filter((l) => HOOK_EVENTS.has(String(l.event)) && l.session === PARENT)).toEqual([]);
  expect(lines.filter((l) => HOOK_EVENTS.has(String(l.event))).every((l) => l.session === HOOK)).toBe(true);
  expect(lines.filter((l) => l.event === 'patch' || l.event === 'apply').every((l) => l.session === PARENT)).toBe(true);
  expect(raw).toEqual(lines.map(replanned));
}

describe('run-chain: hooks write claim, dispatch, build and release; the parent writes patch and apply', () => {
  test('two builders on two claims, each stop before its patch: per task dispatch, build, patch, apply', () => {
    expectChain(
      [
        { agent: 'a1b2c3d4e5f6a7b8c', task: 'T1', claim: 'ISC-1' },
        { agent: 'a0123456789abcdef', task: 'T2', claim: 'ISC-2' },
      ],
      true,
    );
  });

  test('two builders of one claim, patches before the stops: one claim, one release, per task the same order', () => {
    expectChain(
      [
        { agent: 'a1b2c3d4e5f6a7b8c', task: 'T1', claim: 'ISC-1' },
        { agent: 'a0123456789abcdef', task: 'T2', claim: 'ISC-1' },
      ],
      false,
    );
  });
});

describe('run-chain: the implement workflow leaves claim, release, dispatch and build to the hooks', () => {
  const text = readFileSync(IMPLEMENT, 'utf8');

  test('it never tells the parent to run claim, release, activity dispatch or activity build', () => {
    expect(text.match(/spec-check (?:claim|release) ISC-/gu) ?? []).toEqual([]);
    expect(text.match(/activity (?:dispatch|build) --/gu) ?? []).toEqual([]);
  });

  test('it tells the parent to write patch and apply through the activity tool, each with --claim', () => {
    expect(text).toMatch(/spec-check activity patch --task T<k> --claim ISC-N --session <parent actor>/u);
    expect(text).toMatch(/spec-check activity apply --task T<k> --claim ISC-N --session <parent actor>/u);
  });
});

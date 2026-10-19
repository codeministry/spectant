// The activity hooks (spec 032, T6, ISC-33): `spec-check hook` reads one hook payload and writes the lock lines of a
// builder's task to `.spectant/activity.jsonl`. `PreToolUse(Agent)` with a marker line in the prompt claims the task's
// claim for the parent session (`a:claude:<first 8 of session_id>`); `PostToolUse(Agent)` of a background builder
// (`async_launched`) maps its agent id to the marker; `SubagentStop` of that builder releases the claim when it was the
// last mapped builder of it; `PostToolUse(Agent)` with `status: completed` (a foreground run) releases from its own
// prompt. A payload without a marker writes nothing, and so does a claim held by another session.
//
// `handleHook` is driven with the captured payload fixtures (`fixtures/payloads/`) in a fresh git repository under the
// system temp directory, never in this repository; one test pipes a fixture into the CLI the way Claude Code calls it.
import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claimLine } from '../../core/src/activity-text.ts';
import { handleHook } from '../src/hook.ts';

const CLI = join(import.meta.dir, '..', 'src', 'spec-check.ts');
const FIXTURES = join(import.meta.dir, 'fixtures', 'payloads');
const LOG = '.spectant/activity.jsonl';
const ACTOR = 'a:claude:00000000';
const NOW = new Date('2026-10-19T10:00:00.000Z');
const BUILDER = 'a1b2c3d4e5f6a7b8c';
const SECOND = 'a0123456789abcdef';

type Payload = Record<string, unknown>;

const dirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  dirs.push(dir);
  return dir;
}

function git(cwd: string, args: readonly string[]): void {
  const r = Bun.spawnSync(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' });
  if (r.exitCode !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr.toString()}`);
}

/** A git repository with one commit, so a linked worktree can be added to it. */
function gitRepo(): string {
  const root = tempDir('spectant-hooks-repo-');
  git(root, ['init', '-q', '-b', 'main']);
  writeFileSync(join(root, 'README.md'), '# Fixture\n');
  git(root, ['add', 'README.md']);
  git(root, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-q', '-m', 'init']);
  return root;
}

function fixture(name: string): Payload {
  return JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), 'utf8')) as Payload;
}

/** The second builder of the same claim: its own agent id, task T2, the same marker claim. */
function second(name: string): Payload {
  const payload = fixture(name);
  const prompt = 'spectant: spec=001 task=T2 claim=ISC-1\n\nImplement task T2 of spec 001 in this worktree.';
  if (name.startsWith('pre-') || name.startsWith('post-')) payload.tool_input = { ...(payload.tool_input as Payload), prompt };
  if (name.startsWith('post-')) payload.tool_response = { ...(payload.tool_response as Payload), agentId: SECOND, prompt };
  if (name === 'subagent-stop') payload.agent_id = SECOND;
  return payload;
}

function lines(root: string): Payload[] {
  const path = join(root, LOG);
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split('\n').filter((l) => l !== '').map((l) => JSON.parse(l) as Payload);
}

const events = (root: string): string[] => lines(root).map((l) => `${String(l.event)} ${String(l.claim)} ${String(l.task)} ${String(l.session)}`);

function setup(): { root: string; data: string; run: (payload: unknown) => string[] } {
  const root = gitRepo();
  const data = tempDir('spectant-hooks-data-');
  return { root, data, run: (payload) => handleHook(payload, { projectDir: root, dataDir: data, now: NOW }) };
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('handleHook: a background builder', () => {
  test('PreToolUse(Agent) with a marker line writes one claim line for the parent session', () => {
    const { root, run } = setup();
    expect(run(fixture('pre-tool-use-agent'))).toHaveLength(1);
    expect(lines(root)).toEqual([{ ts: NOW.toISOString(), event: 'claim', claim: 'ISC-1', task: 'T1', session: ACTOR }]);
  });

  test('the whole round: claim at PreToolUse, release at SubagentStop of the same builder, nothing in between', () => {
    const { root, data, run } = setup();
    run(fixture('pre-tool-use-agent'));
    expect(run(fixture('subagent-start'))).toEqual([]);
    expect(run(fixture('post-tool-use-agent-async'))).toEqual([]);
    expect(readdirSync(join(data, 'agents'))).toEqual([`${BUILDER}.json`]);
    expect(run(fixture('pre-tool-use-bash-in-subagent'))).toEqual([]);
    expect(events(root)).toEqual([`claim ISC-1 T1 ${ACTOR}`]);

    expect(run(fixture('subagent-stop'))).toHaveLength(1);
    expect(events(root)).toEqual([`claim ISC-1 T1 ${ACTOR}`, `release ISC-1 T1 ${ACTOR}`]);
    expect(readdirSync(join(data, 'agents'))).toEqual([]);
    expect(run(fixture('subagent-stop'))).toEqual([]);
  });

  test('two builders of one claim: one claim line, one release after the second stop', () => {
    const { root, run } = setup();
    run(fixture('pre-tool-use-agent'));
    run(second('pre-tool-use-agent'));
    run(fixture('post-tool-use-agent-async'));
    run(second('post-tool-use-agent-async'));
    expect(events(root)).toEqual([`claim ISC-1 T1 ${ACTOR}`]);

    expect(run(fixture('subagent-stop'))).toEqual([]);
    expect(events(root)).toEqual([`claim ISC-1 T1 ${ACTOR}`]);
    run(second('subagent-stop'));
    expect(events(root)).toEqual([`claim ISC-1 T1 ${ACTOR}`, `release ISC-1 T2 ${ACTOR}`]);
  });

  test('a SubagentStop of a builder that was never mapped writes nothing', () => {
    const { root, run } = setup();
    run(fixture('pre-tool-use-agent'));
    expect(run(fixture('subagent-stop'))).toEqual([]);
    expect(events(root)).toEqual([`claim ISC-1 T1 ${ACTOR}`]);
  });
});

describe('handleHook: no marker, no line', () => {
  test('PreToolUse(Agent) without a marker line writes nothing and creates no log', () => {
    const { root, run } = setup();
    expect(run(fixture('pre-tool-use-agent-no-marker'))).toEqual([]);
    expect(existsSync(join(root, LOG))).toBe(false);
  });

  test('a launch and a completion without a marker write nothing', () => {
    const { root, data, run } = setup();
    const plain = 'Summarise the open tasks of spec 001 in three lines.';
    for (const name of ['post-tool-use-agent-async', 'post-tool-use-agent-completed']) {
      const payload = fixture(name);
      payload.tool_input = { ...(payload.tool_input as Payload), prompt: plain };
      payload.tool_response = { ...(payload.tool_response as Payload), prompt: plain };
      expect(run(payload)).toEqual([]);
    }
    expect(existsSync(join(root, LOG))).toBe(false);
    expect(existsSync(join(data, 'agents'))).toBe(false);
  });

  test('a malformed payload or an unset project directory writes nothing and never throws', () => {
    const { root, data, run } = setup();
    for (const payload of [null, 'PreToolUse', 42, [], {}, { hook_event_name: 'PreToolUse' }, { ...fixture('pre-tool-use-agent'), session_id: 7 }]) {
      expect(run(payload)).toEqual([]);
    }
    expect(handleHook(fixture('pre-tool-use-agent'), { projectDir: undefined, dataDir: data, now: NOW })).toEqual([]);
    expect(handleHook(fixture('pre-tool-use-agent'), { projectDir: '', dataDir: data, now: NOW })).toEqual([]);
    expect(existsSync(join(root, LOG))).toBe(false);
  });
});

describe('handleHook: the fallback of a foreground run', () => {
  test('PostToolUse(Agent) with status completed releases the claim from its own prompt, no map needed', () => {
    const { root, data, run } = setup();
    run(fixture('pre-tool-use-agent'));
    expect(run(fixture('post-tool-use-agent-completed'))).toHaveLength(1);
    expect(events(root)).toEqual([`claim ISC-1 T1 ${ACTOR}`, `release ISC-1 T1 ${ACTOR}`]);
    expect(existsSync(join(data, 'agents'))).toBe(false);
  });

  test('PostToolUse(Agent) with status async_launched never releases', () => {
    const { root, run } = setup();
    run(fixture('pre-tool-use-agent'));
    run(fixture('post-tool-use-agent-async'));
    expect(events(root)).toEqual([`claim ISC-1 T1 ${ACTOR}`]);
  });

  test('a completion while a background builder of the same claim still runs keeps the claim', () => {
    const { root, run } = setup();
    run(fixture('pre-tool-use-agent'));
    run(second('post-tool-use-agent-async'));
    expect(run(fixture('post-tool-use-agent-completed'))).toEqual([]);
    expect(events(root)).toEqual([`claim ISC-1 T1 ${ACTOR}`]);
  });
});

describe('handleHook: the lock and the root', () => {
  test('a claim held by another session: neither claim nor release is written', () => {
    const { root, run } = setup();
    const other = claimLine({ claim: 'ISC-1', session: 'a:claude:ffffffff', ts: '2026-10-19T09:00:00.000Z' });
    mkdirSync(join(root, '.spectant'));
    writeFileSync(join(root, LOG), other);
    expect(run(fixture('pre-tool-use-agent'))).toEqual([]);
    run(fixture('post-tool-use-agent-async'));
    expect(run(fixture('subagent-stop'))).toEqual([]);
    expect(readFileSync(join(root, LOG), 'utf8')).toBe(other);
  });

  test('a project directory that is a linked worktree writes into the main checkout, never the worktree', () => {
    const root = gitRepo();
    const worktree = join(root, '.worktrees', 'parent');
    git(root, ['worktree', 'add', '-q', worktree, '-b', 'feature/parent']);
    const data = tempDir('spectant-hooks-data-');
    handleHook(fixture('pre-tool-use-agent'), { projectDir: worktree, dataDir: data, now: NOW });
    expect(events(root)).toEqual([`claim ISC-1 T1 ${ACTOR}`]);
    expect(existsSync(join(worktree, LOG))).toBe(false);
  });
});

describe('spec-check hook', () => {
  function hook(stdin: string, env: Record<string, string>): { code: number; stdout: string } {
    const r = Bun.spawnSync(['bun', CLI, 'hook'], { stdin: Buffer.from(stdin), stdout: 'pipe', stderr: 'pipe', env: { ...process.env, ...env } });
    return { code: r.exitCode, stdout: r.stdout.toString() };
  }

  test('reads the payload from stdin, writes the claim line, prints nothing and exits 0', () => {
    const root = gitRepo();
    const data = tempDir('spectant-hooks-data-');
    const r = hook(readFileSync(join(FIXTURES, 'pre-tool-use-agent.json'), 'utf8'), { CLAUDE_PROJECT_DIR: root, CLAUDE_PLUGIN_DATA: data });
    expect(r).toEqual({ code: 0, stdout: '' });
    expect(events(root)).toEqual([`claim ISC-1 T1 ${ACTOR}`]);
  });

  test('a payload that is no JSON exits 0, prints nothing and writes nothing', () => {
    const root = gitRepo();
    const data = tempDir('spectant-hooks-data-');
    expect(hook('{not json', { CLAUDE_PROJECT_DIR: root, CLAUDE_PLUGIN_DATA: data })).toEqual({ code: 0, stdout: '' });
    expect(existsSync(join(root, LOG))).toBe(false);
  });
});

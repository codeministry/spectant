// The activity hooks (spec 032, T6 and T11, ISC-33 and ISC-33.1): `spec-check hook` reads one hook payload and writes
// the lock and run lines of a builder's task to `.spectant/activity.jsonl`. `PreToolUse(Agent)` with a marker line in
// the prompt claims the task's claim for the parent session (`a:claude:<first 8 of session_id>`) and writes the task's
// `dispatch`; `PostToolUse(Agent)` of a background builder (`async_launched`) writes its `build` and maps its agent id
// to the marker; `SubagentStart` writes nothing; `SubagentStop` of that builder releases the claim when it was the last
// mapped builder of it; `PostToolUse(Agent)` with `status: completed` (a foreground run) writes `build` and releases
// from its own prompt. Every dispatch and build line carries its claim and is core's plan (`runEventLine`). A payload
// without a marker writes nothing, and so does a claim held by another session.
//
// `handleHook` is driven with the captured payload fixtures (`fixtures/payloads/`) in a fresh git repository under the
// system temp directory, never in this repository; one test pipes a fixture into the CLI the way Claude Code calls it.
import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claimLine, runEventLine } from '../../core/src/activity-text.ts';
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

const rawLines = (root: string): string[] => {
  const path = join(root, LOG);
  return existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter((l) => l !== '') : [];
};

const lines = (root: string): Payload[] => rawLines(root).map((l) => JSON.parse(l) as Payload);

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
  test('PreToolUse(Agent) with a marker line writes one claim and one dispatch line for the parent session', () => {
    const { root, run } = setup();
    expect(run(fixture('pre-tool-use-agent'))).toHaveLength(2);
    expect(lines(root)).toEqual([
      { ts: NOW.toISOString(), event: 'claim', claim: 'ISC-1', task: 'T1', session: ACTOR },
      { ts: NOW.toISOString(), event: 'dispatch', claim: 'ISC-1', task: 'T1', session: ACTOR },
    ]);
  });

  test('the whole round: claim and dispatch at PreToolUse, build at the launch, release at SubagentStop', () => {
    const { root, data, run } = setup();
    run(fixture('pre-tool-use-agent'));
    expect(run(fixture('subagent-start'))).toEqual([]);
    expect(run(fixture('post-tool-use-agent-async'))).toHaveLength(1);
    expect(readdirSync(join(data, 'agents'))).toEqual([`${BUILDER}.json`]);
    expect(run(fixture('pre-tool-use-bash-in-subagent'))).toEqual([]);
    expect(events(root)).toEqual([`claim ISC-1 T1 ${ACTOR}`, `dispatch ISC-1 T1 ${ACTOR}`, `build ISC-1 T1 ${ACTOR}`]);

    expect(run(fixture('subagent-stop'))).toHaveLength(1);
    expect(events(root)).toEqual([`claim ISC-1 T1 ${ACTOR}`, `dispatch ISC-1 T1 ${ACTOR}`, `build ISC-1 T1 ${ACTOR}`, `release ISC-1 T1 ${ACTOR}`]);
    expect(readdirSync(join(data, 'agents'))).toEqual([]);
    expect(run(fixture('subagent-stop'))).toEqual([]);
  });

  test('the dispatch and build lines are core\'s plan, each with its claim', () => {
    const { root, run } = setup();
    run(fixture('pre-tool-use-agent'));
    run(fixture('subagent-start'));
    run(fixture('post-tool-use-agent-async'));
    const ts = NOW.toISOString();
    const [, dispatch, build] = rawLines(root);
    expect(dispatch).toBe(runEventLine({ event: 'dispatch', claim: 'ISC-1', task: 'T1', session: ACTOR, ts }).trimEnd());
    expect(build).toBe(runEventLine({ event: 'build', claim: 'ISC-1', task: 'T1', session: ACTOR, ts }).trimEnd());
    for (const line of lines(root)) expect(line.claim).toBe('ISC-1');
  });

  test('two builders of one claim: one claim line, dispatch and build per task, one release after the second stop', () => {
    const { root, run } = setup();
    run(fixture('pre-tool-use-agent'));
    expect(run(second('pre-tool-use-agent'))).toHaveLength(1);
    run(fixture('post-tool-use-agent-async'));
    expect(run(second('post-tool-use-agent-async'))).toHaveLength(1);
    const round = [
      `claim ISC-1 T1 ${ACTOR}`,
      `dispatch ISC-1 T1 ${ACTOR}`,
      `dispatch ISC-1 T2 ${ACTOR}`,
      `build ISC-1 T1 ${ACTOR}`,
      `build ISC-1 T2 ${ACTOR}`,
    ];
    expect(events(root)).toEqual(round);

    expect(run(fixture('subagent-stop'))).toEqual([]);
    expect(events(root)).toEqual(round);
    run(second('subagent-stop'));
    expect(events(root)).toEqual([...round, `release ISC-1 T2 ${ACTOR}`]);
    for (const line of lines(root)) expect(line.claim).toBe('ISC-1');
  });

  test('a claim unit C2 of a spec without tasks.md: claim, dispatch, build and release, like a task T<n> (spec 056, ISC-346)', () => {
    const { root, run } = setup();
    const prompt = 'spectant: spec=056 task=C2 claim=ISC-346\n\nBuild claim unit C2 of spec 056 in this worktree.';
    const unit = (name: string): Payload => {
      const payload = fixture(name);
      if (name.startsWith('pre-') || name.startsWith('post-')) payload.tool_input = { ...(payload.tool_input as Payload), prompt };
      if (name.startsWith('post-')) payload.tool_response = { ...(payload.tool_response as Payload), prompt };
      return payload;
    };
    expect(run(unit('pre-tool-use-agent'))).toHaveLength(2);
    expect(run(unit('post-tool-use-agent-async'))).toHaveLength(1);
    expect(run(fixture('subagent-stop'))).toHaveLength(1);
    expect(events(root)).toEqual([
      `claim ISC-346 C2 ${ACTOR}`,
      `dispatch ISC-346 C2 ${ACTOR}`,
      `build ISC-346 C2 ${ACTOR}`,
      `release ISC-346 C2 ${ACTOR}`,
    ]);
  });

  test('a SubagentStop of a builder that was never mapped writes nothing', () => {
    const { root, run } = setup();
    run(fixture('pre-tool-use-agent'));
    expect(run(fixture('subagent-stop'))).toEqual([]);
    expect(events(root)).toEqual([`claim ISC-1 T1 ${ACTOR}`, `dispatch ISC-1 T1 ${ACTOR}`]);
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

  test('SubagentStart writes no line, before or after the claim', () => {
    const { root, run } = setup();
    expect(run(fixture('subagent-start'))).toEqual([]);
    expect(existsSync(join(root, LOG))).toBe(false);
    run(fixture('pre-tool-use-agent'));
    expect(run(fixture('subagent-start'))).toEqual([]);
    expect(events(root)).toEqual([`claim ISC-1 T1 ${ACTOR}`, `dispatch ISC-1 T1 ${ACTOR}`]);
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
  test('PostToolUse(Agent) with status completed writes build, then releases the claim from its own prompt', () => {
    const { root, data, run } = setup();
    run(fixture('pre-tool-use-agent'));
    expect(run(fixture('post-tool-use-agent-completed'))).toHaveLength(2);
    expect(events(root)).toEqual([`claim ISC-1 T1 ${ACTOR}`, `dispatch ISC-1 T1 ${ACTOR}`, `build ISC-1 T1 ${ACTOR}`, `release ISC-1 T1 ${ACTOR}`]);
    expect(existsSync(join(data, 'agents'))).toBe(false);
  });

  test('a completion of an agent mapped at its launch writes no second build', () => {
    const { root, run } = setup();
    run(fixture('pre-tool-use-agent'));
    run(fixture('post-tool-use-agent-async'));
    expect(run(fixture('post-tool-use-agent-completed'))).toHaveLength(1);
    expect(events(root)).toEqual([`claim ISC-1 T1 ${ACTOR}`, `dispatch ISC-1 T1 ${ACTOR}`, `build ISC-1 T1 ${ACTOR}`, `release ISC-1 T1 ${ACTOR}`]);
  });

  test('PostToolUse(Agent) with status async_launched never releases', () => {
    const { root, run } = setup();
    run(fixture('pre-tool-use-agent'));
    run(fixture('post-tool-use-agent-async'));
    expect(events(root)).toEqual([`claim ISC-1 T1 ${ACTOR}`, `dispatch ISC-1 T1 ${ACTOR}`, `build ISC-1 T1 ${ACTOR}`]);
  });

  test('a completion while a background builder of the same claim still runs writes its build and keeps the claim', () => {
    const { root, run } = setup();
    run(fixture('pre-tool-use-agent'));
    run(second('post-tool-use-agent-async'));
    expect(run(fixture('post-tool-use-agent-completed'))).toHaveLength(1);
    expect(events(root)).toEqual([`claim ISC-1 T1 ${ACTOR}`, `dispatch ISC-1 T1 ${ACTOR}`, `build ISC-1 T2 ${ACTOR}`, `build ISC-1 T1 ${ACTOR}`]);
  });
});

// The Pack brief (spec 010, T22, ISC-340): `workflows/implement.md` Step 5 and the Workflow script put the task's pack
// on a `PACK:` line right below the marker. The hooks read only the marker line, so a Pack brief writes byte for byte
// the lines a classic brief writes; a marker-shaped string inside the pack JSON is no second marker.
describe('handleHook: a Pack brief writes the same lines as a classic brief', () => {
  const PACK = JSON.stringify({
    spec: '001-fixture',
    goal: 'The goal.',
    task: { id: 'T1', lane: 'plugin', text: 'Implement task T1.', paths: ['src/x.ts'] },
    claim: { id: 'ISC-1', text: 'Not a marker: spectant: spec=999 task=T9 claim=ISC-9', after: [] },
    probe: { type: 'bun-test', check: 'the check', threshold: '', tool: '`bun test`' },
    lane: { name: 'plugin', context: ['CLAUDE.md'], probe: 'bun test' },
    decisions: [],
    truncated: 0,
  });
  const BRIEF = [
    'spectant: spec=001 task=T1 claim=ISC-1',
    `PACK:      ${PACK}`,
    'SPEC:      /repo/specs/001-fixture/spec.md   (fallback only: read it to answer a question the pack cannot)',
    'TASK:      T1 · plugin — Implement task T1. · src/x.ts',
  ].join('\n');

  /** A fixture whose Agent prompt is the Pack brief, in the tool input and, after the call, the tool response. */
  function packed(name: string): Payload {
    const payload = fixture(name);
    if (name.startsWith('pre-') || name.startsWith('post-')) payload.tool_input = { ...(payload.tool_input as Payload), prompt: BRIEF };
    if (name.startsWith('post-')) payload.tool_response = { ...(payload.tool_response as Payload), prompt: BRIEF };
    return payload;
  }

  /** Every line one round writes, from the given payload source. */
  function round(source: (name: string) => Payload, names: readonly string[]): string[] {
    const { root, run } = setup();
    for (const name of names) run(source(name));
    return rawLines(root);
  }

  test('a background builder with a Pack brief: the same claim, dispatch, build and release lines', () => {
    const names = ['pre-tool-use-agent', 'subagent-start', 'post-tool-use-agent-async', 'subagent-stop'];
    const got = round(packed, names);
    expect(got).toEqual(round(fixture, names));
    expect(got.map((l) => (JSON.parse(l) as Payload).event)).toEqual(['claim', 'dispatch', 'build', 'release']);
    for (const line of got) expect(JSON.parse(line) as Payload).toMatchObject({ claim: 'ISC-1', session: ACTOR });
  });

  test('a foreground builder with a Pack brief: the same lines through the completion fallback', () => {
    const names = ['pre-tool-use-agent', 'post-tool-use-agent-completed'];
    const got = round(packed, names);
    expect(got).toEqual(round(fixture, names));
    expect(got).toHaveLength(4);
  });
});

describe('handleHook: the lock and the root', () => {
  test('a claim held by another session: no claim, dispatch, build or release is written', () => {
    const { root, run } = setup();
    const other = claimLine({ claim: 'ISC-1', session: 'a:claude:ffffffff', ts: '2026-10-19T09:00:00.000Z' });
    mkdirSync(join(root, '.spectant'));
    writeFileSync(join(root, LOG), other);
    expect(run(fixture('pre-tool-use-agent'))).toEqual([]);
    expect(run(fixture('post-tool-use-agent-async'))).toEqual([]);
    expect(run(fixture('subagent-stop'))).toEqual([]);
    expect(run(fixture('post-tool-use-agent-completed'))).toEqual([]);
    expect(readFileSync(join(root, LOG), 'utf8')).toBe(other);
  });

  test('a project directory that is a linked worktree writes into the main checkout, never the worktree', () => {
    const root = gitRepo();
    const worktree = join(root, '.worktrees', 'parent');
    git(root, ['worktree', 'add', '-q', worktree, '-b', 'feature/parent']);
    const data = tempDir('spectant-hooks-data-');
    handleHook(fixture('pre-tool-use-agent'), { projectDir: worktree, dataDir: data, now: NOW });
    expect(events(root)).toEqual([`claim ISC-1 T1 ${ACTOR}`, `dispatch ISC-1 T1 ${ACTOR}`]);
    expect(existsSync(join(worktree, LOG))).toBe(false);
  });
});

describe('spec-check hook', () => {
  function hook(stdin: string, env: Record<string, string>): { code: number; stdout: string } {
    const r = Bun.spawnSync(['bun', CLI, 'hook'], { stdin: Buffer.from(stdin), stdout: 'pipe', stderr: 'pipe', env: { ...process.env, ...env } });
    return { code: r.exitCode, stdout: r.stdout.toString() };
  }

  test('reads the payload from stdin, writes the claim and dispatch lines, prints nothing and exits 0', () => {
    const root = gitRepo();
    const data = tempDir('spectant-hooks-data-');
    const r = hook(readFileSync(join(FIXTURES, 'pre-tool-use-agent.json'), 'utf8'), { CLAUDE_PROJECT_DIR: root, CLAUDE_PLUGIN_DATA: data });
    expect(r).toEqual({ code: 0, stdout: '' });
    expect(events(root)).toEqual([`claim ISC-1 T1 ${ACTOR}`, `dispatch ISC-1 T1 ${ACTOR}`]);
  });

  test('a payload that is no JSON exits 0, prints nothing and writes nothing', () => {
    const root = gitRepo();
    const data = tempDir('spectant-hooks-data-');
    expect(hook('{not json', { CLAUDE_PROJECT_DIR: root, CLAUDE_PLUGIN_DATA: data })).toEqual({ code: 0, stdout: '' });
    expect(existsSync(join(root, LOG))).toBe(false);
  });
});

// A parent session started in a spec worktree (spec 062, ISC-441): `CLAUDE_PROJECT_DIR` is `.worktrees/001-digest` on
// `feature/001-digest`, a linked worktree of a repository with `specs/` committed. Every claim, dispatch, build and
// release line lands in the main checkout's `.spectant/activity.jsonl`, and no other file changes: not a byte of the
// main checkout (`.git/` included) and not a byte of the worktree, which never gets a `.spectant/` of its own.
describe('worktree project dir', () => {
  const MARKER_PROMPT = 'spectant: spec=001 task=C1 claim=ISC-1\n\nBuild claim unit C1 of spec 001 in this worktree.';

  /** A repository with `specs/001-digest/` committed and the spec worktree `.worktrees/001-digest` inside it. */
  function specWorktree(): { root: string; worktree: string } {
    const root = gitRepo();
    mkdirSync(join(root, 'specs', '001-digest'), { recursive: true });
    writeFileSync(join(root, 'specs', '001-digest', 'spec.md'), '---\nstage: implement\n---\n# 001 Digest\n');
    writeFileSync(join(root, 'specs', '001-digest', 'tasks.md'), '# Tasks\n\n- [ ] C1 the digest\n');
    writeFileSync(join(root, '.gitignore'), '.worktrees/\n');
    git(root, ['add', '.']);
    git(root, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-q', '-m', 'specs']);
    const worktree = join(root, '.worktrees', '001-digest');
    git(root, ['worktree', 'add', '-q', worktree, '-b', 'feature/001-digest']);
    return { root, worktree };
  }

  /** A fixture whose Agent prompt carries the C1 marker and whose `cwd` is the spec worktree. */
  function inWorktree(name: string, worktree: string): Payload {
    const payload: Payload = { ...fixture(name), cwd: worktree };
    if (name.startsWith('pre-') || name.startsWith('post-')) payload.tool_input = { ...(payload.tool_input as Payload), prompt: MARKER_PROMPT };
    if (name.startsWith('post-')) payload.tool_response = { ...(payload.tool_response as Payload), prompt: MARKER_PROMPT };
    return payload;
  }

  /** Every file under `dir`, `.git/` and the nested worktree included, as its bytes in hex; `skip` left out. */
  function snapshot(dir: string, skip: string): Map<string, string> {
    const files = new Map<string, string>();
    const walk = (rel: string): void => {
      for (const entry of readdirSync(join(dir, rel), { withFileTypes: true })) {
        const path = rel === '' ? entry.name : `${rel}/${entry.name}`;
        if (path === skip) continue;
        if (entry.isDirectory()) walk(path);
        else files.set(path, readFileSync(join(dir, path)).toString('hex'));
      }
    };
    walk('');
    return files;
  }

  const ROUND = [`claim ISC-1 C1 ${ACTOR}`, `dispatch ISC-1 C1 ${ACTOR}`, `build ISC-1 C1 ${ACTOR}`, `release ISC-1 C1 ${ACTOR}`];
  const NAMES = ['pre-tool-use-agent', 'subagent-start', 'post-tool-use-agent-async', 'subagent-stop'];

  /** Drives one background round with `drive`, then checks the main log grew by exactly the round and nothing else moved. */
  function expectOnlyMainLogGrows(drive: (payload: Payload, worktree: string, data: string) => void): void {
    const { root, worktree } = specWorktree();
    const data = tempDir('spectant-hooks-data-');
    const before = snapshot(root, LOG);
    const worktreeBefore = snapshot(worktree, '');
    expect(existsSync(join(root, LOG))).toBe(false);
    for (const name of NAMES) drive(inWorktree(name, worktree), worktree, data);
    expect(events(root)).toEqual(ROUND);
    expect(snapshot(root, LOG)).toEqual(before);
    expect(snapshot(worktree, '')).toEqual(worktreeBefore);
    expect(existsSync(join(worktree, '.spectant'))).toBe(false);
  }

  test('claim, dispatch, build and release go to the main checkout log alone; the worktree stays byte-identical (spec 062, ISC-441)', () => {
    expectOnlyMainLogGrows((payload, worktree, data) => {
      handleHook(payload, { projectDir: worktree, dataDir: data, now: NOW });
    });
  });

  test('through `spec-check hook` with CLAUDE_PROJECT_DIR in the worktree: the same lines, the same untouched tree (spec 062, ISC-441)', () => {
    expectOnlyMainLogGrows((payload, worktree, data) => {
      const r = Bun.spawnSync(['bun', CLI, 'hook'], {
        stdin: Buffer.from(JSON.stringify(payload)),
        stdout: 'pipe',
        stderr: 'pipe',
        env: { ...process.env, CLAUDE_PROJECT_DIR: worktree, CLAUDE_PLUGIN_DATA: data },
      });
      expect({ code: r.exitCode, stdout: r.stdout.toString(), stderr: r.stderr.toString() }).toEqual({ code: 0, stdout: '', stderr: '' });
    });
  });
});

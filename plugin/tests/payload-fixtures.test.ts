// The hook payload fixtures (spec 032, T4, ISC-33): synthetic copies of the payloads Claude Code handed to a debug hook
// during the T1 probe round (two background builders with worktree isolation). Field names, nesting and value types are
// the captured ones; paths, ids and texts are neutral. The hook tests (T5 and later) feed these files to
// `spec-check hook`, so this test pins what they rely on: every fixture parses and names its event, one builder keeps
// one agent id across every event, the builder's cwd is its own worktree, and nothing individual survived the
// replacement (no home path, no leak-checker hit, none of the probe's real ids, which are named here only by their
// sha256 so the real values never enter a tracked file).
import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { scanText } from '../../scripts/check-leak.ts';

const DIR = join(import.meta.dir, 'fixtures', 'payloads');
const MARKER = 'spectant: spec=001 task=T1 claim=ISC-1';

type Payload = Record<string, unknown>;

// Each fixture with its event and the top-level keys the probe captured for that event.
const FIXTURES: Record<string, { event: string; keys: string[] }> = {
  'pre-tool-use-agent.json': {
    event: 'PreToolUse',
    keys: ['cwd', 'effort', 'hook_event_name', 'permission_mode', 'prompt_id', 'scratchpad_dir', 'session_id',
      'tool_input', 'tool_name', 'tool_use_id', 'transcript_path'],
  },
  'pre-tool-use-agent-no-marker.json': {
    event: 'PreToolUse',
    keys: ['cwd', 'effort', 'hook_event_name', 'permission_mode', 'prompt_id', 'scratchpad_dir', 'session_id',
      'tool_input', 'tool_name', 'tool_use_id', 'transcript_path'],
  },
  'subagent-start.json': {
    event: 'SubagentStart',
    keys: ['agent_id', 'agent_type', 'cwd', 'hook_event_name', 'prompt_id', 'scratchpad_dir', 'session_id',
      'transcript_path'],
  },
  'post-tool-use-agent-async.json': {
    event: 'PostToolUse',
    keys: ['cwd', 'duration_ms', 'effort', 'hook_event_name', 'permission_mode', 'prompt_id', 'scratchpad_dir',
      'session_id', 'tool_input', 'tool_name', 'tool_response', 'tool_use_id', 'transcript_path'],
  },
  'post-tool-use-agent-completed.json': {
    event: 'PostToolUse',
    keys: ['cwd', 'duration_ms', 'effort', 'hook_event_name', 'permission_mode', 'prompt_id', 'scratchpad_dir',
      'session_id', 'tool_input', 'tool_name', 'tool_response', 'tool_use_id', 'transcript_path'],
  },
  'pre-tool-use-bash-in-subagent.json': {
    event: 'PreToolUse',
    keys: ['agent_id', 'agent_type', 'cwd', 'effort', 'hook_event_name', 'permission_mode', 'prompt_id',
      'scratchpad_dir', 'session_id', 'tool_input', 'tool_name', 'tool_use_id', 'transcript_path'],
  },
  'subagent-stop.json': {
    event: 'SubagentStop',
    keys: ['agent_id', 'agent_transcript_path', 'agent_type', 'background_tasks', 'cwd', 'effort', 'hook_event_name',
      'permission_mode', 'prompt_id', 'scratchpad_dir', 'session_crons', 'session_id', 'stop_hook_active',
      'transcript_path'],
  },
};

// sha256 of the probe's real session, prompt, agent and tool-use ids.
const REAL_ID_HASHES = new Set([
  'fce523037a84da42709827609f06e8da828c07c33e2bf86919a90b04f6165988',
  '04da02212fa8404f5108983a079123b23d7e1a8cdeedadb50ed5dd4887b96f43',
  '2f56d64e7e2a30e093ddd56f32bbf515314dec009452b6a1984a02654f50fe63',
  'ff9b9db584a8a6d8108c6586d399ff5b8ad4405b6533b4d007a6a69d1756c556',
  'c220d9faa40fb67abf28f6fd9cada41ab56016cde9efc5a37aaef8dcd366ed6c',
  'e59bda21f6dfe799fd30be2023d94502773a1ef9b7753d29e217765494bfe78d',
  'd198bbfefc922ecddb3075e3132d7a59cfe4b50b45926141f2f63a1ac0d41b84',
]);
const ID_TOKEN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\ba[0-9a-f]{16}\b|toolu_[A-Za-z0-9]+/g;

const text = (name: string): string => readFileSync(join(DIR, name), 'utf8');
const load = (name: string): Payload => JSON.parse(text(name)) as Payload;
const field = (p: Payload, key: string): Payload => p[key] as Payload;

describe('hook payload fixtures', () => {
  test('every fixture parses as one object, names its event and keeps the captured top-level keys', () => {
    for (const [name, { event, keys }] of Object.entries(FIXTURES)) {
      expect(existsSync(join(DIR, name))).toBe(true);
      const payload = load(name);
      expect(typeof payload).toBe('object');
      expect(Array.isArray(payload)).toBe(false);
      expect(payload.hook_event_name).toBe(event);
      expect(Object.keys(payload).sort()).toEqual(keys);
    }
  });

  test('the README lists every fixture', () => {
    const readme = text('README.md');
    for (const name of Object.keys(FIXTURES)) expect(readme).toContain(name);
  });

  test('one builder keeps one agent id across start, launch, its own tool calls and stop', () => {
    const start = load('subagent-start.json');
    const launched = load('post-tool-use-agent-async.json');
    const completed = load('post-tool-use-agent-completed.json');
    const bash = load('pre-tool-use-bash-in-subagent.json');
    const stop = load('subagent-stop.json');
    const agentId = field(launched, 'tool_response').agentId;

    expect(typeof agentId).toBe('string');
    expect(start.agent_id).toBe(agentId);
    expect(stop.agent_id).toBe(agentId);
    expect(bash.agent_id).toBe(agentId);
    expect(field(completed, 'tool_response').agentId).toBe(agentId);
    expect((stop.background_tasks as Payload[]).some((t) => t.id === agentId)).toBe(true);

    const worktree = `/repo/.claude/worktrees/agent-${String(agentId)}`;
    for (const builderEvent of [start, bash, stop]) expect(builderEvent.cwd).toBe(worktree);
    for (const parentEvent of [launched, completed, load('pre-tool-use-agent.json')]) expect(parentEvent.cwd).toBe('/repo');
  });

  test('the Agent call carries the marker line, its tool_use_id and the launch status', () => {
    const pre = load('pre-tool-use-agent.json');
    const bare = load('pre-tool-use-agent-no-marker.json');
    const launched = load('post-tool-use-agent-async.json');
    const completed = load('post-tool-use-agent-completed.json');

    expect(pre.tool_name).toBe('Agent');
    expect(pre.agent_id).toBeUndefined();
    expect(String(field(pre, 'tool_input').prompt).split('\n')[0]).toBe(MARKER);
    expect(String(field(bare, 'tool_input').prompt)).not.toContain('spectant:');
    expect(launched.tool_use_id).toBe(pre.tool_use_id);
    expect(completed.tool_use_id).toBe(pre.tool_use_id);
    expect(field(launched, 'tool_response').status).toBe('async_launched');
    expect(String(field(launched, 'tool_response').prompt).split('\n')[0]).toBe(MARKER);
    expect(field(completed, 'tool_response').status).toBe('completed');
    expect(String(field(completed, 'tool_response').prompt).split('\n')[0]).toBe(MARKER);
  });

  test('nothing individual survives: no home path, no leak-checker hit, none of the real ids', () => {
    for (const name of [...Object.keys(FIXTURES), 'README.md']) {
      const body = text(name);
      expect(body).not.toContain('/Users/');
      expect(scanText(name, body, null).hits).toEqual([]);
      const leaked = [...body.matchAll(ID_TOKEN)].filter((m) =>
        REAL_ID_HASHES.has(createHash('sha256').update(m[0]).digest('hex')));
      expect(leaked).toEqual([]);
    }
  });
});

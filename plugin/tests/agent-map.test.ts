// The agent map of the activity hooks (spec 032, T5, ISC-33): `PostToolUse(Agent)` of a background builder is the only
// event that carries both the builder's `agentId` and its prompt with the marker line, while `SubagentStop` carries the
// agent id alone. `plugin/src/agent-map.ts` keeps that link under the plugin's data directory, one small JSON file per
// agent, written from `tool_response` at launch and taken back (read and removed) at the stop.
//
// Every test works in a fresh directory under the system temp directory, never in this repository.
import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agentsOf, isAgentId, pluginDataDir, recordLaunch, takeAgent } from '../src/agent-map.ts';

const FIXTURES = join(import.meta.dir, 'fixtures', 'payloads');
const ACTOR = 'a:claude:00000000';
const OTHER = 'a0123456789abcdef';

const dirs: string[] = [];

function tempDir(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'spectant-agent-map-')));
  dirs.push(dir);
  return dir;
}

/** The `tool_response` of the captured `PostToolUse(Agent, async_launched)`. */
function launched(): Record<string, unknown> {
  const payload = JSON.parse(readFileSync(join(FIXTURES, 'post-tool-use-agent-async.json'), 'utf8')) as Record<string, unknown>;
  return payload.tool_response as Record<string, unknown>;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('recordLaunch and takeAgent', () => {
  test('the launch maps the agent id to the marker of its prompt; the stop takes it back once', () => {
    const data = tempDir();
    expect(recordLaunch(data, launched(), ACTOR)).toEqual({ spec: '001', task: 'T1', claim: 'ISC-1', session: ACTOR });
    expect(readdirSync(join(data, 'agents'))).toEqual(['a1b2c3d4e5f6a7b8c.json']);

    expect(takeAgent(data, 'a1b2c3d4e5f6a7b8c')).toEqual({ spec: '001', task: 'T1', claim: 'ISC-1', session: ACTOR });
    expect(readdirSync(join(data, 'agents'))).toEqual([]);
    expect(takeAgent(data, 'a1b2c3d4e5f6a7b8c')).toBeNull();
  });

  test('a prompt without a marker line maps nothing', () => {
    const data = tempDir();
    const response = { ...launched(), prompt: 'Summarise the open tasks in three lines.' };
    expect(recordLaunch(data, response, ACTOR)).toBeNull();
    expect(existsSync(join(data, 'agents'))).toBe(false);
  });

  test('an agent id that is no plain word is never used as a file name', () => {
    const data = tempDir();
    for (const agentId of ['../escape', 'a/b', '', 'a.json', 42]) {
      expect(recordLaunch(data, { ...launched(), agentId }, ACTOR)).toBeNull();
    }
    expect(existsSync(join(data, 'agents'))).toBe(false);
    expect(takeAgent(data, '../escape')).toBeNull();
    expect(isAgentId('a1b2c3d4e5f6a7b8c')).toBe(true);
    expect(isAgentId('../a')).toBe(false);
  });

  test('a response that is no object, or lacks the agent id or the prompt, maps nothing', () => {
    const data = tempDir();
    expect(recordLaunch(data, null, ACTOR)).toBeNull();
    expect(recordLaunch(data, 'launched', ACTOR)).toBeNull();
    for (const key of ['agentId', 'prompt']) {
      const response = Object.fromEntries(Object.entries(launched()).filter(([k]) => k !== key));
      expect(recordLaunch(data, response, ACTOR)).toBeNull();
    }
    expect(existsSync(join(data, 'agents'))).toBe(false);
  });

  test('a malformed map file reads as no entry and is removed', () => {
    const data = tempDir();
    mkdirSync(join(data, 'agents'), { recursive: true });
    writeFileSync(join(data, 'agents', `${OTHER}.json`), '{not json');
    expect(takeAgent(data, OTHER)).toBeNull();
    expect(existsSync(join(data, 'agents', `${OTHER}.json`))).toBe(false);
  });
});

describe('agentsOf', () => {
  test('lists the mapped agents of one claim and one session, nothing else', () => {
    const data = tempDir();
    recordLaunch(data, launched(), ACTOR);
    recordLaunch(data, { ...launched(), agentId: OTHER, prompt: 'spectant: spec=001 task=T2 claim=ISC-1\n\nT2.' }, ACTOR);
    recordLaunch(data, { ...launched(), agentId: 'a2222222222222222', prompt: 'spectant: spec=001 task=T3 claim=ISC-2\n\nT3.' }, ACTOR);
    recordLaunch(data, { ...launched(), agentId: 'a3333333333333333' }, 'a:claude:11111111');

    expect(agentsOf(data, 'ISC-1', ACTOR).sort()).toEqual([OTHER, 'a1b2c3d4e5f6a7b8c']);
    takeAgent(data, 'a1b2c3d4e5f6a7b8c');
    expect(agentsOf(data, 'ISC-1', ACTOR)).toEqual([OTHER]);
    expect(agentsOf(data, 'ISC-2', ACTOR)).toEqual(['a2222222222222222']);
    expect(agentsOf(data, 'ISC-9', ACTOR)).toEqual([]);
  });

  test('an absent data directory has no agents', () => {
    expect(agentsOf(join(tempDir(), 'missing'), 'ISC-1', ACTOR)).toEqual([]);
  });
});

describe('pluginDataDir', () => {
  test('is CLAUDE_PLUGIN_DATA when set, else a folder under the system temp directory', () => {
    expect(pluginDataDir({ CLAUDE_PLUGIN_DATA: '/data/spectant' })).toBe('/data/spectant');
    expect(pluginDataDir({})).toBe(join(tmpdir(), 'spectant-plugin-data'));
    expect(pluginDataDir({ CLAUDE_PLUGIN_DATA: '' })).toBe(join(tmpdir(), 'spectant-plugin-data'));
  });
});

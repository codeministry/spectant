// agent-map — which task a running builder works on (spec 032, T5, ISC-33), kept for the hook command.
//
// `SubagentStop` names the stopping builder by `agent_id` alone, and no hook field names its task or claim. The one
// event that links both is `PostToolUse(Agent)` of a background builder (`status: async_launched`): its
// `tool_response` carries the `agentId` and the prompt with the marker line. The hook writes that link here at launch
// and takes it back at the stop. The map lives under the plugin's data directory (`CLAUDE_PLUGIN_DATA`), one small JSON
// file per agent (`<data>/agents/<agentId>.json`), so hooks of builders running side by side never race on one file. An
// agent id is used as a file name only when it is a plain word (`/^[a-z0-9]+$/i`); anything else maps nothing.
import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseMarker } from './marker.ts';
import type { Marker } from './marker.ts';

/** One mapped builder: the marker of its brief and the parent session's actor that dispatched it. */
export interface AgentEntry extends Marker {
  /** The actor of the parent session (`a:claude:<id>`), the holder of the claim's lock. */
  session: string;
}

const AGENT_ID = /^[a-z0-9]+$/iu;

/** True when `value` is an agent id that is safe as a file name. */
export const isAgentId = (value: unknown): value is string => typeof value === 'string' && AGENT_ID.test(value);

/** The plugin's data directory: `CLAUDE_PLUGIN_DATA`, else a folder under the system temp directory. */
export function pluginDataDir(env: Readonly<Record<string, string | undefined>>): string {
  const data = env.CLAUDE_PLUGIN_DATA;
  return data === undefined || data === '' ? join(tmpdir(), 'spectant-plugin-data') : data;
}

const agentsDir = (dataDir: string): string => join(dataDir, 'agents');
const agentFile = (dataDir: string, agentId: string): string => join(agentsDir(dataDir), `${agentId}.json`);

function entryOf(value: unknown): AgentEntry | null {
  if (typeof value !== 'object' || value === null) return null;
  const { spec, task, claim, session } = value as Record<string, unknown>;
  if (typeof spec !== 'string' || typeof task !== 'string' || typeof claim !== 'string' || typeof session !== 'string') return null;
  return { spec, task, claim, session };
}

function readEntry(path: string): AgentEntry | null {
  try {
    return entryOf(JSON.parse(readFileSync(path, 'utf8')));
  } catch {
    return null;
  }
}

/**
 * Maps the builder a `PostToolUse(Agent)` response launched to the marker of its prompt, for `session`, and returns the
 * entry; null and nothing written when the response has no plain agent id or its prompt no marker line. The file is
 * written beside its final name and renamed, so a reader never sees half of it.
 */
export function recordLaunch(dataDir: string, response: unknown, session: string): AgentEntry | null {
  if (typeof response !== 'object' || response === null) return null;
  const { agentId, prompt } = response as Record<string, unknown>;
  if (!isAgentId(agentId) || typeof prompt !== 'string') return null;
  const marker = parseMarker(prompt);
  if (marker === null) return null;
  const entry: AgentEntry = { ...marker, session };
  const path = agentFile(dataDir, agentId);
  mkdirSync(agentsDir(dataDir), { recursive: true });
  writeFileSync(`${path}.${process.pid}.tmp`, `${JSON.stringify(entry)}\n`);
  renameSync(`${path}.${process.pid}.tmp`, path);
  return entry;
}

/** The entry of a stopping builder, removed from the map; null when it was never mapped or its file is malformed. */
export function takeAgent(dataDir: string, agentId: string): AgentEntry | null {
  if (!isAgentId(agentId)) return null;
  const path = agentFile(dataDir, agentId);
  const entry = readEntry(path);
  rmSync(path, { force: true });
  return entry;
}

/** The agent ids still mapped to `claim` for `session`; empty when the data directory is absent. */
export function agentsOf(dataDir: string, claim: string, session: string): string[] {
  let names: string[];
  try {
    names = readdirSync(agentsDir(dataDir));
  } catch {
    return [];
  }
  return names
    .filter((name) => name.endsWith('.json') && isAgentId(name.slice(0, -'.json'.length)))
    .filter((name) => {
      const entry = readEntry(join(agentsDir(dataDir), name));
      return entry !== null && entry.claim === claim && entry.session === session;
    })
    .map((name) => name.slice(0, -'.json'.length));
}

// hook — the activity hooks of the Spec plugin (spec 032, T7 and T12, ISC-33 and ISC-33.1): `spec-check hook`, called
// by `plugin/spectant/hooks/hooks.json` for `PreToolUse(Agent)`, `PostToolUse(Agent)`, `SubagentStart` and
// `SubagentStop`.
//
// A builder's brief opens with the marker line (`marker.ts`), the only place its task and claim are named. The parent
// session holds the claim's lock: its actor is `a:claude:<first 8 characters of session_id>`, and every hook payload,
// a builder's events included, carries the parent's `session_id`. What each event writes:
//
//  - `PreToolUse(Agent)` with a marker in `tool_input.prompt`: one `claim` line, unless the claim is held already, then
//    the task's `dispatch`. Held by this session (a further task of the same claim): `dispatch` alone; held by another
//    session: nothing written;
//  - `PostToolUse(Agent)` with `status: async_launched`: the task's `build`, and the agent id is mapped to the marker
//    (`agent-map.ts`);
//  - `SubagentStart`: nothing; it arrives before the launch and names no marker;
//  - `SubagentStop`: the mapped entry is taken back, and `release` is written when it was the last mapped builder of
//    its claim for this session and the session still holds the claim;
//  - `PostToolUse(Agent)` with `status: completed` (a foreground run, which never launches): the task's `build`, then
//    `release` from the marker of `tool_response.prompt`, under the same last-one rule. A run whose agent id was mapped
//    at an `async_launched` had its `build` written then, so a completion that takes a mapped entry back writes none;
//  - everything else, a payload without a marker and a malformed payload: nothing.
//
// So one task's lines come in the order claim, dispatch, build, …, release. `dispatch` and `build` go through the
// shared run-event writer and carry the marker's claim; both are written only while this session holds the claim.
//
// The lines go to the repository of `CLAUDE_PROJECT_DIR` (through `repoRoot`, so a parent running in a linked worktree
// writes into the main checkout), never to the payload's `cwd`, which is the builder's own worktree; without
// `CLAUDE_PROJECT_DIR` nothing is written. The hook never blocks or fails the tool call: `runHook` swallows every error,
// prints nothing on stdout (Claude Code may read a hook's stdout) and reports only on stderr.
import { appendClaim, appendRelease, appendRunEvent, holderOf, repoRoot } from './activity-log.ts';
import { agentsOf, pluginDataDir, recordLaunch, takeAgent } from './agent-map.ts';
import { parseMarker } from './marker.ts';
import type { Marker } from './marker.ts';

/** Where a hook writes, and when. */
export interface HookEnv {
  /** `CLAUDE_PROJECT_DIR`: the directory the parent session started in; unset or empty writes nothing. */
  readonly projectDir: string | undefined;
  /** The plugin's data directory, home of the agent map. */
  readonly dataDir: string;
  readonly now: Date;
}

type Fields = Record<string, unknown>;

const fieldsOf = (value: unknown): Fields | null => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Fields) : null);

const ACTOR_ID = /^[a-z0-9][a-z0-9_-]*$/u;

/** The parent session's actor, `a:claude:<first 8 of session_id>` in lower case, or null when it would not parse. */
function actorOf(sessionId: unknown): string | null {
  if (typeof sessionId !== 'string') return null;
  const id = sessionId.slice(0, 8).toLowerCase();
  return ACTOR_ID.test(id) ? `a:claude:${id}` : null;
}

const markerOf = (prompt: unknown): Marker | null => (typeof prompt === 'string' ? parseMarker(prompt) : null);

/** `claim` unless this session holds it already, then the task's `dispatch`; nothing when another session holds it. */
function claimAndDispatch(env: HookEnv, marker: Marker, session: string): string[] {
  const root = repoRoot(env.projectDir ?? '');
  const ts = env.now.toISOString();
  const outcome = appendClaim(root, { claim: marker.claim, task: marker.task, session, ts });
  if (outcome.done === 'other') return [];
  const dispatch = appendRunEvent(root, { event: 'dispatch', claim: marker.claim, task: marker.task, session, ts });
  return outcome.done === 'written' ? [outcome.line, dispatch] : [dispatch];
}

/** The task's `build` while this session holds the claim; nothing when another session or none holds it. */
function build(env: HookEnv, marker: Marker, session: string): string[] {
  const root = repoRoot(env.projectDir ?? '');
  if (holderOf(root, marker.claim) !== session) return [];
  return [appendRunEvent(root, { event: 'build', claim: marker.claim, task: marker.task, session, ts: env.now.toISOString() })];
}

/** `release` of the claim when no other builder of it is still mapped for the session. */
function releaseIfLast(env: HookEnv, marker: Marker, session: string): string[] {
  if (agentsOf(env.dataDir, marker.claim, session).length > 0) return [];
  const outcome = appendRelease(repoRoot(env.projectDir ?? ''), { claim: marker.claim, task: marker.task, session, ts: env.now.toISOString() });
  return outcome.done === 'written' ? [outcome.line] : [];
}

/** Handles one hook payload and returns the lines it appended to `.spectant/activity.jsonl` (usually none). */
export function handleHook(payload: unknown, env: HookEnv): string[] {
  const fields = fieldsOf(payload);
  if (fields === null || env.projectDir === undefined || env.projectDir === '') return [];
  const session = actorOf(fields.session_id);
  if (session === null) return [];
  const event = fields.hook_event_name;
  if (event === 'SubagentStop') {
    const agentId = fields.agent_id;
    const entry = typeof agentId === 'string' ? takeAgent(env.dataDir, agentId) : null;
    return entry === null ? [] : releaseIfLast(env, entry, entry.session);
  }
  if (fields.tool_name !== 'Agent') return [];
  if (event === 'PreToolUse') {
    const marker = markerOf(fieldsOf(fields.tool_input)?.prompt);
    return marker === null ? [] : claimAndDispatch(env, marker, session);
  }
  if (event === 'PostToolUse') {
    const response = fieldsOf(fields.tool_response);
    const marker = markerOf(response?.prompt) ?? markerOf(fieldsOf(fields.tool_input)?.prompt);
    if (response?.status === 'async_launched') {
      recordLaunch(env.dataDir, response, session);
      return marker === null ? [] : build(env, marker, session);
    }
    if (response?.status === 'completed') {
      // A foreground run is never mapped; should it be, its own entry must not count as a builder still running, and
      // its build was written at that launch already.
      const launched = typeof response.agentId === 'string' ? takeAgent(env.dataDir, response.agentId) : null;
      if (marker === null) return [];
      return [...(launched === null ? build(env, marker, session) : []), ...releaseIfLast(env, marker, session)];
    }
  }
  return [];
}

/**
 * `spec-check hook`: the payload Claude Code passed on stdin, handled with `CLAUDE_PROJECT_DIR` and
 * `CLAUDE_PLUGIN_DATA` from `env`. Never throws: a payload that is no JSON or any failure is reported on stderr only.
 */
export function runHook(stdin: string, env: Readonly<Record<string, string | undefined>>, now: Date): void {
  try {
    handleHook(JSON.parse(stdin) as unknown, { projectDir: env.CLAUDE_PROJECT_DIR, dataDir: pluginDataDir(env), now });
  } catch (error) {
    process.stderr.write(`spec-check hook: ${error instanceof Error ? error.message : String(error)}; nothing written\n`);
  }
}

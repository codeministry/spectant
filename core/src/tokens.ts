// The token baseline (spec 009, T1 — the core seam): types, line layout and signatures for `specs/tokens.jsonl`.
//
// `spectant tokens` (server/) finds the Claude Code transcripts of a repository, reads them and the repository's
// `events.jsonl` and `rounds.jsonl` texts, and hands everything to this module as text. Everything between reading and
// writing lives here as pure functions: parse a transcript, count every API request once, cut the `/spec` invocation
// windows, attribute each request to an invocation, a spec, a stage and an implement round, sum, merge the baseline
// lines of earlier runs, serialise, and read the file back. No file system, no clock, no Bun or Node API, so the
// barrel may export it.
//
// The counters are the transcripts' own `usage` numbers, never a tokenisation of ours. The file holds numbers,
// timestamps, command names, spec slugs, stage names, round numbers and neutral actor IDs only: no path, no working
// directory, no name, no address, no prompt or answer text, and never the arguments of a command — only the spec
// number read from them.
//
// T5 (parseTranscript), T6 (tokenRows, serializeTokens), T16 (mergeBaselines) and T17 (readTokens) are implemented.

import type { Diagnostic } from './diagnostics.ts';
import { EVENT_STAGES, parseEvents } from './events.ts';
import { commandKey } from './stage.ts';
import { roundLines } from './timeline.ts';

// ─── The file ────────────────────────────────────────────────────────────────────────────────────────────────────

/** The `v` every line of `specs/tokens.jsonl` carries. */
export const TOKENS_VERSION = 1;

/** The four counters, in the order every line carries them. */
export const TOKEN_COUNTERS = ['input', 'output', 'cache_read', 'cache_write'] as const;

export type TokenCounter = (typeof TOKEN_COUNTERS)[number];

/**
 * The four counters as the transcripts' `usage` fields give them: `input` is `input_tokens`, `output` is
 * `output_tokens`, `cache_read` is `cache_read_input_tokens`, `cache_write` is `cache_creation_input_tokens`.
 */
export type TokenCounters = Readonly<Record<TokenCounter, number>>;

/** The line kinds, in the order the file holds them. */
export const TOKEN_ROW_KINDS = ['baseline', 'invocation', 'spec', 'stage', 'round', 'unassigned'] as const;

export type TokenRowKind = (typeof TOKEN_ROW_KINDS)[number];

/** Per `/spec` command in a baseline line: how many invocations, their sums and their means rounded to whole tokens. */
export interface BaselineCommand extends TokenCounters {
  readonly count: number;
  /** Per counter, the sum divided by `count`, rounded to a whole token so the file stays deterministic. */
  readonly mean: TokenCounters;
}

/** One measuring run. Kept across runs, even when its transcripts are gone; the same state adds no second line. */
export interface BaselineRow {
  readonly v: typeof TOKENS_VERSION;
  readonly kind: 'baseline';
  /** ISO 8601 timestamp of the newest measured turn; never the wall clock. */
  readonly measured_through: string;
  /** The Claude Code versions the measured transcripts name, sorted, each once. */
  readonly claude_code: readonly string[];
  /** Keyed by command name (`/spec plan`), in key order. */
  readonly commands: Readonly<Record<string, BaselineCommand>>;
}

/** One `/spec` invocation: a `/spec` command up to the next slash command or the end of its session, its sub-agents included. */
export interface InvocationRow extends TokenCounters {
  readonly v: typeof TOKENS_VERSION;
  readonly kind: 'invocation';
  /** `a:claude:<session>#<n>`: the neutral actor ID of the session and the invocation's 1-based position in it. */
  readonly id: string;
  /** The command name only, `/spec plan`; its arguments are never stored. */
  readonly command: string;
  /** The spec slug `NNN-slug` read from the arguments' number; null when they name none or an unknown one. */
  readonly spec: string | null;
  /** ISO 8601 timestamp of the invocation's first turn. */
  readonly ts: string;
  /** Distinct API requests counted. */
  readonly requests: number;
  /** Sub-agent transcripts attributed through their `toolUseId`. */
  readonly subagents: number;
}

/** Every request attributed to one spec. */
export interface SpecTotalRow extends TokenCounters {
  readonly v: typeof TOKENS_VERSION;
  readonly kind: 'spec';
  readonly spec: string;
  readonly requests: number;
}

/** Every request of one spec made while the spec stood in one stage. */
export interface StageTotalRow extends TokenCounters {
  readonly v: typeof TOKENS_VERSION;
  readonly kind: 'stage';
  readonly spec: string;
  /** A stage name of the stage table (`StageName`); lines sort in the stage table's order. */
  readonly stage: string;
  readonly requests: number;
}

/** Every request of a `/spec implement` invocation that falls into one round of `rounds.jsonl`. */
export interface RoundTotalRow extends TokenCounters {
  readonly v: typeof TOKENS_VERSION;
  readonly kind: 'round';
  readonly spec: string;
  readonly round: number;
  readonly requests: number;
}

/** Every request outside a `/spec` invocation, in exactly one line. */
export interface UnassignedRow extends TokenCounters {
  readonly v: typeof TOKENS_VERSION;
  readonly kind: 'unassigned';
  readonly requests: number;
}

export type TokenRow = BaselineRow | InvocationRow | SpecTotalRow | StageTotalRow | RoundTotalRow | UnassignedRow;

/** The keys of each line kind, in the order a line carries them; a line holds these keys and no other. */
export const TOKEN_ROW_KEYS: Readonly<Record<TokenRowKind, readonly string[]>> = {
  baseline: ['v', 'kind', 'measured_through', 'claude_code', 'commands'],
  invocation: ['v', 'kind', 'id', 'command', 'spec', 'ts', 'requests', 'subagents', ...TOKEN_COUNTERS],
  spec: ['v', 'kind', 'spec', 'requests', ...TOKEN_COUNTERS],
  stage: ['v', 'kind', 'spec', 'stage', 'requests', ...TOKEN_COUNTERS],
  round: ['v', 'kind', 'spec', 'round', 'requests', ...TOKEN_COUNTERS],
  unassigned: ['v', 'kind', 'requests', ...TOKEN_COUNTERS],
};

/** The keys of a baseline line's per-command entry, in order. */
export const BASELINE_COMMAND_KEYS = ['count', ...TOKEN_COUNTERS, 'mean'] as const;

/**
 * A finding of a measuring run: a line that is not JSON, a transcript without `usage`, a request without a dedup key,
 * a sub-agent without `.meta.json`, an unknown spec number. Never a throw; the CLI prints it on stderr and ends with
 * exit 0. `source` names the transcript by the label its caller gave it (`TranscriptFile.label`); it is never written
 * into `specs/tokens.jsonl`.
 */
export interface TokenDiagnostic extends Diagnostic {
  readonly source?: string;
}

// ─── Input: transcript texts and the repository side ────────────────────────────────────────────────────────────

/**
 * Where a transcript sits in the project folder: the main session `<session>.jsonl`, a sub-agent
 * `<session>/subagents/agent-*.jsonl`, or the main session of an agent worktree's own project folder
 * (`<encoded root>--claude-worktrees-agent-*`).
 */
export type TranscriptRole = 'main' | 'subagent' | 'worktree';

/** One transcript file as the server read it. */
export interface TranscriptFile {
  readonly role: TranscriptRole;
  /** The session ID the file belongs to (for a sub-agent, its parent session); only ever written as `a:claude:<id>`. */
  readonly session: string;
  /** A label for diagnostics only, e.g. the file name relative to the transcript folder; never written to the file. */
  readonly label: string;
  /** The file's text, JSON lines. */
  readonly text: string;
  /**
   * A sub-agent's `toolUseId` from its `.meta.json`: the tool call in the parent session that started it. Null when the
   * meta file is missing or carries none (its requests stay `unassigned`, with a diagnostic); absent for other roles.
   */
  readonly toolUseId?: string | null;
}

/** One spec folder of the repository as the attribution needs it. */
export interface TokenSpecInput {
  /** The folder name `NNN-slug`; the number in a command's arguments resolves against it. */
  readonly slug: string;
  /** `events.jsonl` as read, null when the spec has none; read through `parseEvents` (events.ts). */
  readonly events: string | null;
  /** `rounds.jsonl` as read, null when the spec has none; read through `roundLines` (timeline.ts). */
  readonly rounds: string | null;
  /** The derived stage, for a turn before the spec's first event or a spec without events; null when unknown. */
  readonly derivedStage: string | null;
}

export interface TokenInput {
  /** Every transcript the discovery found, in any order; the result does not depend on it. */
  readonly transcripts: readonly TranscriptFile[];
  readonly specs: readonly TokenSpecInput[];
}

// ─── Intermediate: one parsed transcript ────────────────────────────────────────────────────────────────────────

/** A user line that starts a `/spec` invocation (`<command-name>/spec…`). */
export interface TranscriptCommand {
  readonly type: 'command';
  readonly ts: string;
  readonly command: string;
  /** The three-digit spec number in `<command-args>`, or null; the arguments themselves are dropped here. */
  readonly specNumber: string | null;
}

/**
 * A user line with a slash command that is no `/spec` command (`/clear`, `/model`, …); it ends an open invocation and
 * opens none. Prose prompts, task notifications, local-command output, tool results and `isMeta` lines are no entry.
 */
export interface TranscriptInput {
  readonly type: 'input';
  readonly ts: string;
}

/** An assistant line carrying `usage`. Lines repeating the same request share `requestId`. */
export interface TranscriptUsage extends TokenCounters {
  readonly type: 'usage';
  readonly ts: string;
  /** The dedup key: `requestId`, else `message.id`; null when the line has neither (counted alone, with a diagnostic). */
  readonly requestId: string | null;
  /** The `tool_use` IDs this line starts, which sub-agents point at through their `toolUseId`. */
  readonly toolUseIds: readonly string[];
  /** The Claude Code version the line names, or null. */
  readonly version: string | null;
}

export type TranscriptEntry = TranscriptCommand | TranscriptInput | TranscriptUsage;

export interface ParsedTranscript {
  readonly role: TranscriptRole;
  readonly session: string;
  readonly label: string;
  readonly toolUseId: string | null;
  /** The entries in file order. */
  readonly entries: readonly TranscriptEntry[];
  readonly diagnostics: readonly TokenDiagnostic[];
}

// ─── Output ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** One measuring run before the merge with the existing file. */
export interface TokenRun {
  /** The invocation, spec, stage, round and unassigned lines; no baseline line. */
  readonly rows: ReadonlyArray<Exclude<TokenRow, BaselineRow>>;
  /** This run's baseline line; null when no turn was measured. */
  readonly baseline: BaselineRow | null;
  readonly diagnostics: readonly TokenDiagnostic[];
}

export interface TokensReading {
  readonly rows: readonly TokenRow[];
  readonly diagnostics: readonly TokenDiagnostic[];
}

// ─── Reading a transcript (T5) ──────────────────────────────────────────────────────────────────────────────────

type JsonRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonRecord => typeof value === 'object' && value !== null && !Array.isArray(value);

const stringOf = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);

const countOf = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0);

/** A `/spec` command name: `/spec` itself or `/spec-<name>`; any other slash command only ends a window. */
const SPEC_COMMAND = /^\/spec(?:-[a-z0-9-]+)?$/;

const COMMAND_NAME = /<command-name>\s*([^<\s]+)\s*<\/command-name>/;

const COMMAND_ARGS = /<command-args>([\s\S]*?)<\/command-args>/;

/**
 * The command name an invocation stores: the transcript's name, and for the plugin's `/spec` its subcommand word too
 * (`/spec implement`), so its rounds and its baseline entry stand apart; never any other argument.
 */
function commandNameOf(name: string, args: string): string {
  const word = args.trim().split(/\s+/)[0] ?? '';
  return commandKey(name) === null && commandKey(`${name} ${word}`) !== null ? `${name} ${word}` : name;
}

/** The first three-digit number standing alone in a command's arguments. */
const SPEC_NUMBER = /(?<!\d)(\d{3})(?!\d)/;

/** The text of a user line's content; null when the content is only tool results (or nothing a user typed). */
function userText(content: unknown): string | null {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return null;
  const blocks = content.filter(isRecord);
  if (blocks.length === 0 || blocks.every((block) => block.type === 'tool_result')) return null;
  return blocks.map((block) => (typeof block.text === 'string' ? block.text : '')).join('\n');
}

/** The `tool_use` IDs an assistant line starts. */
function toolUseIdsOf(content: unknown): string[] {
  if (!Array.isArray(content)) return [];
  return content.filter(isRecord).flatMap((block) => (block.type === 'tool_use' ? (stringOf(block.id) ?? []) : []));
}

/**
 * Reads one transcript defensively: every line that is not JSON or carries nothing countable is skipped with a
 * diagnostic, never a throw (T5). Kept: `/spec` commands (name and spec number only), other slash commands (they end a
 * window) and assistant lines with `usage`. Every other user line (prose, task notifications, local-command output,
 * tool results, `isMeta` lines) and every other line kind (system, summary, snapshots) is passed over silently.
 */
export function parseTranscript(file: TranscriptFile): ParsedTranscript {
  const entries: TranscriptEntry[] = [];
  const diagnostics: TokenDiagnostic[] = [];
  const warn = (code: string, message: string, line?: number): void => {
    diagnostics.push({ severity: 'warning', code, message, ...(line === undefined ? {} : { line }), source: file.label });
  };

  file.text.split(/\r?\n/).forEach((raw, i) => {
    const line = i + 1;
    if (raw.trim() === '') return;
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      warn('tokens-line-not-json', 'The line is not JSON; it is skipped.', line);
      return;
    }
    if (!isRecord(value)) {
      warn('tokens-line-not-object', 'The line is not a JSON object; it is skipped.', line);
      return;
    }
    if (value.type !== 'user' && value.type !== 'assistant') return;
    const ts = stringOf(value.timestamp);
    const message = isRecord(value.message) ? value.message : {};
    if (value.type === 'assistant') {
      const usage = isRecord(message.usage) ? message.usage : null;
      if (usage === null) {
        warn('tokens-usage-missing', 'The assistant line carries no `usage`; it is not counted.', line);
        return;
      }
      if (ts === null) {
        warn('tokens-timestamp-missing', 'The assistant line carries no `timestamp`; it is not counted.', line);
        return;
      }
      const requestId = stringOf(value.requestId) ?? stringOf(message.id);
      if (requestId === null) warn('tokens-request-key-missing', 'The line has neither `requestId` nor `message.id`; it is counted alone.', line);
      entries.push({
        type: 'usage',
        ts,
        requestId,
        toolUseIds: toolUseIdsOf(message.content),
        version: stringOf(value.version),
        input: countOf(usage.input_tokens),
        output: countOf(usage.output_tokens),
        cache_read: countOf(usage.cache_read_input_tokens),
        cache_write: countOf(usage.cache_creation_input_tokens),
      });
      return;
    }
    if (value.isMeta === true) return;
    const text = userText(message.content);
    if (text === null) return;
    if (ts === null) {
      warn('tokens-timestamp-missing', 'The user line carries no `timestamp`; it is skipped.', line);
      return;
    }
    // Only a slash command touches the window: a `/spec` one opens its own, any other ends the open one. Prose
    // prompts, task notifications and the output of local commands carry no `<command-name>` and belong to it.
    const command = COMMAND_NAME.exec(text)?.[1] ?? null;
    if (command === null) return;
    if (SPEC_COMMAND.test(command)) {
      const args = COMMAND_ARGS.exec(text)?.[1] ?? '';
      entries.push({ type: 'command', ts, command: commandNameOf(command, args), specNumber: SPEC_NUMBER.exec(args)?.[1] ?? null });
    } else {
      entries.push({ type: 'input', ts });
    }
  });

  if (!entries.some((entry) => entry.type === 'usage')) warn('tokens-transcript-no-usage', 'The transcript carries no `usage`; nothing in it is counted.');
  return { role: file.role, session: file.session, label: file.label, toolUseId: file.role === 'subagent' ? (file.toolUseId ?? null) : null, entries, diagnostics };
}

// ─── Measuring (T5, T6) ─────────────────────────────────────────────────────────────────────────────────────────

const ROLE_RANK: Readonly<Record<TranscriptRole, number>> = { main: 0, worktree: 1, subagent: 2 };


/** Byte-independent, locale-free string order. */
const plainOrder = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const timeOf = (ts: string): number => new Date(ts).getTime();

const zero = (): Record<TokenCounter, number> => ({ input: 0, output: 0, cache_read: 0, cache_write: 0 });

interface Invocation {
  readonly id: string;
  readonly command: string;
  readonly spec: string | null;
  readonly ts: string;
  subagents: number;
}

/** One API request, counted once: the first line seen in the fixed file order, its counters the maximum over all. */
interface Request {
  readonly ts: string;
  readonly version: string | null;
  readonly invocation: Invocation | null;
  readonly counters: Record<TokenCounter, number>;
}

interface Sum extends Record<TokenCounter, number> {
  requests: number;
}

function addTo(sums: Map<string, Sum>, key: string, request: Request): void {
  let sum = sums.get(key);
  if (sum === undefined) {
    sum = { requests: 0, ...zero() };
    sums.set(key, sum);
  }
  sum.requests += 1;
  for (const counter of TOKEN_COUNTERS) sum[counter] += request.counters[counter];
}

/** A spec's stage and round timeline: events through `parseEvents`, rounds through `roundLines`, no second parser. */
interface SpecTimeline {
  readonly events: ReadonlyArray<{ readonly at: number; readonly to: string }>;
  readonly rounds: ReadonlyArray<{ readonly at: number; readonly round: number }>;
  readonly derivedStage: string | null;
}

function timelineOf(spec: TokenSpecInput): SpecTimeline {
  return {
    events: spec.events === null ? [] : parseEvents(spec.events).events.map((event) => ({ at: timeOf(event.ts), to: event.to })),
    rounds: roundLines(spec.rounds ?? undefined).map((line) => ({ at: timeOf(line.ts), round: line.round })),
    derivedStage: spec.derivedStage,
  };
}

/** The `to` of the latest transition at or before the turn; without one, the derived stage. */
function stageAt(timeline: SpecTimeline, at: number): string | null {
  let best: { at: number; to: string } | null = null;
  for (const event of timeline.events) if (event.at <= at && (best === null || event.at >= best.at)) best = event;
  return best?.to ?? timeline.derivedStage;
}

/** The first round (file order) whose `ts` is not before the turn; null after the last round. */
function roundAt(timeline: SpecTimeline, at: number): number | null {
  return timeline.rounds.find((round) => round.at >= at)?.round ?? null;
}

const stageRank = (stage: string): number => {
  const i = EVENT_STAGES.indexOf(stage);
  return i < 0 ? EVENT_STAGES.length : i;
};

/**
 * Measures: parses every transcript, counts each request once across all files, cuts the invocation windows, attaches
 * sub-agents through `toolUseId`, attributes spec, stage and round, and sums into lines (T5, T6). The files are put
 * into a fixed order first (role, session, label), so the result does not depend on the order they came in.
 */
export function tokenRows(input: TokenInput): TokenRun {
  const diagnostics: TokenDiagnostic[] = [];
  const parsed = input.transcripts
    .map(parseTranscript)
    .sort((a, b) => ROLE_RANK[a.role] - ROLE_RANK[b.role] || plainOrder(a.session, b.session) || plainOrder(a.label, b.label));
  for (const transcript of parsed) diagnostics.push(...transcript.diagnostics);

  const slugs = [...input.specs].map((spec) => spec.slug).sort(plainOrder);
  const resolveSpec = (number: string | null, source: string): string | null => {
    if (number === null) return null;
    const slug = slugs.find((s) => s.startsWith(`${number}-`)) ?? null;
    if (slug === null) {
      diagnostics.push({ severity: 'warning', code: 'tokens-spec-unknown', message: `No spec folder carries the number ${number}; the invocation counts to no spec.`, subject: number, source });
    }
    return slug;
  };

  // Invocation windows in the sessions (main and worktree): a `/spec` command opens one, the next slash command of any
  // kind or the end of the session's file closes it. Every usage line gets the invocation open at it, every tool_use
  // ID too.
  const invocations: Invocation[] = [];
  const perSession = new Map<string, number>();
  const lineInvocations = new Map<ParsedTranscript, Array<Invocation | null>>();
  const toolUses = new Map<string, Invocation | null>();
  for (const transcript of parsed) {
    if (transcript.role === 'subagent') continue;
    let open: Invocation | null = null;
    const owners: Array<Invocation | null> = [];
    for (const entry of transcript.entries) {
      if (entry.type === 'command') {
        const n = (perSession.get(transcript.session) ?? 0) + 1;
        perSession.set(transcript.session, n);
        open = { id: `a:claude:${transcript.session}#${n}`, command: entry.command, spec: resolveSpec(entry.specNumber, transcript.label), ts: entry.ts, subagents: 0 };
        invocations.push(open);
      } else if (entry.type === 'input') {
        open = null;
      } else {
        for (const id of entry.toolUseIds) toolUses.set(id, open);
      }
      owners.push(open);
    }
    lineInvocations.set(transcript, owners);
  }

  // Sub-agents: each belongs to the invocation of the tool call that started it; a sub-agent started by another
  // sub-agent resolves once its parent has, so the loop runs until nothing new resolves.
  const pending = new Set(parsed.filter((t) => t.role === 'subagent'));
  for (const transcript of pending) {
    if (transcript.toolUseId === null) {
      diagnostics.push({ severity: 'warning', code: 'tokens-subagent-no-meta', message: 'The sub-agent has no `toolUseId` in a `.meta.json`; its requests count as unassigned.', source: transcript.label });
    }
  }
  let resolved = true;
  while (resolved) {
    resolved = false;
    for (const transcript of pending) {
      if (transcript.toolUseId === null || !toolUses.has(transcript.toolUseId)) continue;
      const owner = toolUses.get(transcript.toolUseId) ?? null;
      if (owner !== null) owner.subagents += 1;
      lineInvocations.set(transcript, transcript.entries.map(() => owner));
      for (const entry of transcript.entries) if (entry.type === 'usage') for (const id of entry.toolUseIds) toolUses.set(id, owner);
      pending.delete(transcript);
      resolved = true;
    }
  }
  for (const transcript of pending) {
    if (transcript.toolUseId !== null) {
      diagnostics.push({ severity: 'warning', code: 'tokens-subagent-parent-unknown', message: 'No session starts the tool call the sub-agent names; its requests count as unassigned.', source: transcript.label });
    }
    lineInvocations.set(transcript, transcript.entries.map(() => null));
  }

  // Every request once, across all files: the first line in the fixed order is the one counted.
  const requests: Request[] = [];
  const byKey = new Map<string, Request>();
  for (const transcript of parsed) {
    const owners = lineInvocations.get(transcript) ?? [];
    transcript.entries.forEach((entry, i) => {
      if (entry.type !== 'usage') return;
      const seen = entry.requestId === null ? undefined : byKey.get(entry.requestId);
      if (seen !== undefined) {
        for (const counter of TOKEN_COUNTERS) seen.counters[counter] = Math.max(seen.counters[counter], entry[counter]);
        return;
      }
      const request: Request = { ts: entry.ts, version: entry.version, invocation: owners[i] ?? null, counters: { input: entry.input, output: entry.output, cache_read: entry.cache_read, cache_write: entry.cache_write } };
      requests.push(request);
      if (entry.requestId !== null) byKey.set(entry.requestId, request);
    });
  }

  // Sums: per invocation, per spec, per spec and stage, per spec and implement round, and the rest.
  const timelines = new Map(input.specs.map((spec) => [spec.slug, timelineOf(spec)]));
  const perInvocation = new Map<string, Sum>();
  const perSpec = new Map<string, Sum>();
  const perStage = new Map<string, Sum>();
  const perRound = new Map<string, Sum>();
  const unassigned = new Map<string, Sum>();
  const stageKeys = new Map<string, { spec: string; stage: string }>();
  const roundKeys = new Map<string, { spec: string; round: number }>();
  for (const request of requests) {
    const invocation = request.invocation;
    if (invocation === null) {
      addTo(unassigned, '', request);
      continue;
    }
    addTo(perInvocation, invocation.id, request);
    const spec = invocation.spec;
    if (spec === null) continue;
    addTo(perSpec, spec, request);
    const timeline = timelines.get(spec);
    if (timeline === undefined) continue;
    const at = timeOf(request.ts);
    const stage = stageAt(timeline, at);
    if (stage !== null) {
      const key = JSON.stringify([spec, stage]);
      stageKeys.set(key, { spec, stage });
      addTo(perStage, key, request);
    }
    const round = commandKey(invocation.command) === 'implement' ? roundAt(timeline, at) : null;
    if (round !== null) {
      const key = JSON.stringify([spec, round]);
      roundKeys.set(key, { spec, round });
      addTo(perRound, key, request);
    }
  }

  const counters = (sum: Sum | undefined): TokenCounters => {
    const out = zero();
    for (const counter of TOKEN_COUNTERS) out[counter] = sum?.[counter] ?? 0;
    return out;
  };
  const rows: Array<Exclude<TokenRow, BaselineRow>> = [];
  for (const invocation of invocations) {
    const sum = perInvocation.get(invocation.id);
    rows.push({ v: TOKENS_VERSION, kind: 'invocation', id: invocation.id, command: invocation.command, spec: invocation.spec, ts: invocation.ts, requests: sum?.requests ?? 0, subagents: invocation.subagents, ...counters(sum) });
  }
  for (const [spec, sum] of perSpec) rows.push({ v: TOKENS_VERSION, kind: 'spec', spec, requests: sum.requests, ...counters(sum) });
  for (const [key, sum] of perStage) {
    const { spec, stage } = stageKeys.get(key) ?? { spec: '', stage: '' };
    rows.push({ v: TOKENS_VERSION, kind: 'stage', spec, stage, requests: sum.requests, ...counters(sum) });
  }
  for (const [key, sum] of perRound) {
    const { spec, round } = roundKeys.get(key) ?? { spec: '', round: 0 };
    rows.push({ v: TOKENS_VERSION, kind: 'round', spec, round, requests: sum.requests, ...counters(sum) });
  }
  const rest = unassigned.get('');
  rows.push({ v: TOKENS_VERSION, kind: 'unassigned', requests: rest?.requests ?? 0, ...counters(rest) });
  rows.sort(compareRows);

  return { rows, baseline: baselineOf(requests, rows), diagnostics };
}

/** This run's baseline line: newest counted turn, Claude Code versions, per command the sums and rounded means. */
function baselineOf(requests: readonly Request[], rows: ReadonlyArray<Exclude<TokenRow, BaselineRow>>): BaselineRow | null {
  if (requests.length === 0) return null;
  let newest = requests[0]?.ts ?? '';
  for (const request of requests) if (timeOf(request.ts) > timeOf(newest)) newest = request.ts;
  const versions = [...new Set(requests.flatMap((request) => request.version ?? []))].sort(plainOrder);
  const sums = new Map<string, { count: number } & Record<TokenCounter, number>>();
  for (const row of rows) {
    if (row.kind !== 'invocation') continue;
    const sum = sums.get(row.command) ?? { count: 0, ...zero() };
    sum.count += 1;
    for (const counter of TOKEN_COUNTERS) sum[counter] += row[counter];
    sums.set(row.command, sum);
  }
  const commands: Record<string, BaselineCommand> = {};
  for (const command of [...sums.keys()].sort(plainOrder)) {
    const sum = sums.get(command) ?? { count: 0, ...zero() };
    const mean = zero();
    for (const counter of TOKEN_COUNTERS) mean[counter] = sum.count === 0 ? 0 : Math.round(sum[counter] / sum.count);
    commands[command] = { ...sum, mean };
  }
  return { v: TOKENS_VERSION, kind: 'baseline', measured_through: newest, claude_code: versions, commands };
}

// ─── Writing (T6) ───────────────────────────────────────────────────────────────────────────────────────────────

/** The file's line order: kind first, then per kind as FORMAT.md § `tokens` names it. */
function compareRows(a: TokenRow, b: TokenRow): number {
  const byKind = TOKEN_ROW_KINDS.indexOf(a.kind) - TOKEN_ROW_KINDS.indexOf(b.kind);
  if (byKind !== 0) return byKind;
  if (a.kind === 'baseline' && b.kind === 'baseline') return timeOf(a.measured_through) - timeOf(b.measured_through) || plainOrder(a.measured_through, b.measured_through);
  if (a.kind === 'invocation' && b.kind === 'invocation') return timeOf(a.ts) - timeOf(b.ts) || plainOrder(a.id, b.id);
  if (a.kind === 'spec' && b.kind === 'spec') return plainOrder(a.spec, b.spec);
  if (a.kind === 'stage' && b.kind === 'stage') return plainOrder(a.spec, b.spec) || stageRank(a.stage) - stageRank(b.stage) || plainOrder(a.stage, b.stage);
  if (a.kind === 'round' && b.kind === 'round') return plainOrder(a.spec, b.spec) || a.round - b.round;
  return 0;
}

/** A plain object with exactly `keys`, in that order, read from `source`. */
function ordered(source: object, keys: readonly string[]): JsonRecord {
  const record = source as JsonRecord;
  const out: JsonRecord = {};
  for (const key of keys) out[key] = record[key];
  return out;
}

function lineOf(row: TokenRow): JsonRecord {
  const line = ordered(row, TOKEN_ROW_KEYS[row.kind]);
  if (row.kind !== 'baseline') return line;
  const commands: JsonRecord = {};
  for (const command of Object.keys(row.commands).sort(plainOrder)) {
    const entry = row.commands[command];
    if (entry === undefined) continue;
    commands[command] = { ...ordered(entry, BASELINE_COMMAND_KEYS), mean: ordered(entry.mean, TOKEN_COUNTERS) };
  }
  return { ...line, claude_code: [...row.claude_code], commands };
}

/** The file text: lines in the fixed order of `TOKEN_ROW_KINDS`, keys in the order of `TOKEN_ROW_KEYS`, `\n` after each (T6). */
export function serializeTokens(rows: readonly TokenRow[]): string {
  return [...rows]
    .sort(compareRows)
    .map((row) => `${JSON.stringify(lineOf(row))}\n`)
    .join('');
}

// ─── Merging the baseline lines (T16) ───────────────────────────────────────────────────────────────────────────

/** Two `measured_through` values name the same state when they are the same string or the same instant. */
const sameState = (a: string, b: string): boolean => a === b || timeOf(a) === timeOf(b);

/**
 * The baseline lines to write: every earlier line kept as read, plus `next` unless a line with the same state is
 * already there, all in `measured_through` order (T16). The state is `measured_through`, the newest measured turn:
 * when an earlier line carries it, that line is kept and `next` dropped, even if their numbers differ. A baseline line
 * is a record of what was measured then, never recomputed; a later run over the same newest turn can only have lost
 * transcripts since (Claude Code deletes old ones), so the line already in the file is the fuller one. `next` null (a
 * run that measured no turn) leaves the earlier lines as they are. Neither argument is changed.
 */
export function mergeBaselines(previous: readonly BaselineRow[], next: BaselineRow | null): BaselineRow[] {
  const lines = [...previous];
  if (next !== null && !lines.some((line) => sameState(line.measured_through, next.measured_through))) lines.push(next);
  return lines.sort(compareRows);
}

// ─── Reading the file back (T17) ────────────────────────────────────────────────────────────────────────────────

const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0;

const isText = (value: unknown): value is string => typeof value === 'string' && value !== '';

const isCounters = (value: unknown): value is JsonRecord => isRecord(value) && TOKEN_COUNTERS.every((counter) => isCount(value[counter]));

const isCommandEntry = (value: unknown): boolean => isCounters(value) && isCount(value.count) && isCounters(value.mean);

/** Per key, the values a line may hold there; `spec` is checked per kind (an invocation's may be null). */
const VALUE_CHECKS: Readonly<Record<string, (value: unknown) => boolean>> = {
  measured_through: isText,
  claude_code: (value) => Array.isArray(value) && value.every(isText),
  commands: (value) => isRecord(value) && Object.values(value).every(isCommandEntry),
  id: isText,
  command: isText,
  ts: isText,
  stage: isText,
  round: isCount,
  requests: isCount,
  subagents: isCount,
  ...Object.fromEntries(TOKEN_COUNTERS.map((counter) => [counter, isCount])),
};

const validValue = (kind: TokenRowKind, key: string, value: unknown): boolean =>
  key === 'spec' ? isText(value) || (kind === 'invocation' && value === null) : (VALUE_CHECKS[key]?.(value) ?? false);

const isRowKind = (value: unknown): value is TokenRowKind => typeof value === 'string' && (TOKEN_ROW_KINDS as readonly string[]).includes(value);

/** A checked line as a row: its keys in order, a baseline's commands and means rebuilt key by key. */
function rowOf(record: JsonRecord, kind: TokenRowKind): TokenRow {
  if (kind !== 'baseline') return ordered(record, TOKEN_ROW_KEYS[kind]) as unknown as TokenRow;
  const source = record.commands as Record<string, JsonRecord>;
  const commands: Record<string, BaselineCommand> = {};
  for (const command of Object.keys(source).sort(plainOrder)) {
    const entry = source[command] ?? {};
    commands[command] = { ...ordered(entry, BASELINE_COMMAND_KEYS), mean: ordered(entry.mean as JsonRecord, TOKEN_COUNTERS) } as unknown as BaselineCommand;
  }
  return { v: TOKENS_VERSION, kind, measured_through: record.measured_through as string, claude_code: [...(record.claude_code as string[])], commands };
}

/**
 * Reads `specs/tokens.jsonl` back into the lines `serializeTokens` wrote: `serializeTokens(readTokens(text).rows)` is
 * `text` for every file it wrote (T17). Never throws. A blank line is skipped; a line that is not a JSON object, has
 * another `v` or an unknown `kind`, lacks a key of its kind or holds a value of the wrong shape is left out, with a
 * diagnostic naming its 1-based line (and the key in `subject`). A key the kind does not name is dropped, with a
 * diagnostic, and the line is kept.
 */
export function readTokens(text: string): TokensReading {
  const rows: TokenRow[] = [];
  const diagnostics: TokenDiagnostic[] = [];
  const warn = (code: string, message: string, line: number, subject?: string): void => {
    diagnostics.push({ severity: 'warning', code, message, line, ...(subject === undefined ? {} : { subject }) });
  };

  text.split(/\r?\n/).forEach((raw, i) => {
    const line = i + 1;
    if (raw.trim() === '') return;
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      warn('tokens-line-not-json', 'The line is not JSON; it is skipped.', line);
      return;
    }
    if (!isRecord(value)) {
      warn('tokens-line-not-object', 'The line is not a JSON object; it is skipped.', line);
      return;
    }
    if (value.v !== TOKENS_VERSION) {
      warn('tokens-version-unknown', `The line does not carry \`v: ${TOKENS_VERSION}\`; it is skipped.`, line);
      return;
    }
    const kind = value.kind;
    if (!isRowKind(kind)) {
      warn('tokens-kind-unknown', 'The line carries no known `kind`; it is skipped.', line, typeof kind === 'string' ? kind : undefined);
      return;
    }
    const keys = TOKEN_ROW_KEYS[kind];
    for (const key of keys.slice(2)) {
      if (!(key in value)) {
        warn('tokens-key-missing', `The ${kind} line lacks \`${key}\`; it is skipped.`, line, key);
        return;
      }
      if (!validValue(kind, key, value[key])) {
        warn('tokens-value-invalid', `The ${kind} line's \`${key}\` has the wrong shape; it is skipped.`, line, key);
        return;
      }
    }
    for (const key of Object.keys(value)) {
      if (!keys.includes(key)) warn('tokens-key-unknown', `The ${kind} line carries \`${key}\`, which its kind does not name; the key is dropped.`, line, key);
    }
    rows.push(rowOf(value, kind));
  });

  return { rows, diagnostics };
}

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
// The stubs below name themselves (`not implemented: <name>`); T5 (parseTranscript), T6 (tokenRows, serializeTokens),
// T16 (mergeBaselines) and T17 (readTokens) replace them without changing a signature.

import type { Diagnostic } from './diagnostics.ts';

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
  /** Keyed by command name (`/spec-plan`), in key order. */
  readonly commands: Readonly<Record<string, BaselineCommand>>;
}

/** One `/spec` invocation: a slash command up to the next real user input, its sub-agents included. */
export interface InvocationRow extends TokenCounters {
  readonly v: typeof TOKENS_VERSION;
  readonly kind: 'invocation';
  /** `a:claude:<session>#<n>`: the neutral actor ID of the session and the invocation's 1-based position in it. */
  readonly id: string;
  /** The command name only, `/spec-plan`; its arguments are never stored. */
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

/** Every request of a `/spec-implement` invocation that falls into one round of `rounds.jsonl`. */
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

/** A real user input that is no command; it ends an open invocation. A tool result is not one. */
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

// ─── Functions (stubs until T5, T6, T16, T17) ───────────────────────────────────────────────────────────────────

/** A stub's throw; the input rides along as the cause, so a caller debugging the seam sees what reached it. */
function notImplemented(name: string, input: unknown): never {
  throw new Error(`not implemented: ${name}`, { cause: input });
}

/**
 * Reads one transcript defensively: every line that is not JSON or carries nothing countable is skipped with a
 * diagnostic, never a throw (T5).
 */
export function parseTranscript(file: TranscriptFile): ParsedTranscript {
  return notImplemented('parseTranscript', file);
}

/**
 * Measures: parses every transcript, counts each request once across all files, cuts the invocation windows, attaches
 * sub-agents through `toolUseId`, attributes spec, stage and round, and sums into lines (T5, T6).
 */
export function tokenRows(input: TokenInput): TokenRun {
  return notImplemented('tokenRows', input);
}

/**
 * The baseline lines to write: every earlier line kept as read, plus `next` unless a line with the same state is
 * already there (T16).
 */
export function mergeBaselines(previous: readonly BaselineRow[], next: BaselineRow | null): BaselineRow[] {
  return notImplemented('mergeBaselines', [previous, next]);
}

/** The file text: lines in the fixed order of `TOKEN_ROW_KINDS`, keys in the order of `TOKEN_ROW_KEYS`, `\n` after each (T6). */
export function serializeTokens(rows: readonly TokenRow[]): string {
  return notImplemented('serializeTokens', rows);
}

/** Reads `specs/tokens.jsonl` back into the lines `serializeTokens` wrote; a bad line is a diagnostic (T17). */
export function readTokens(text: string): TokensReading {
  return notImplemented('readTokens', text);
}

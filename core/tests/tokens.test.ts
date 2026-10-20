// Spec 009, the token baseline: `tokenRows` over the hand-written transcript fixture and harbor's specs, serialised,
// equals the hand-computed golden `core/tests/fixtures/tokens.golden.jsonl` byte for byte (ISC-135, group `rows`).
//
// The test does the reading, as `spectant tokens` (server/src/tokens-cli.ts) does it for a real repository: the main
// sessions `<session>.jsonl`, the sub-agents `<session>/subagents/agent-<id>.jsonl` with the `toolUseId` of their
// `.meta.json`, the sessions of the sibling agent-worktree folders, the spec-worktree folders `<project>-NNN` and
// `<project>--worktrees-NNN-slug` read like the project folder (ISC-178), and per spec folder its `events.jsonl` and
// `rounds.jsonl` texts plus the stage the dashboard model derives for it. `core/src/tokens.ts` reads no file.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';

import { buildDashboard } from '../src/dashboard.ts';
import {
  type BaselineRow,
  type InvocationRow,
  type RoundTotalRow,
  type SpecTotalRow,
  type StageTotalRow,
  TOKEN_COUNTERS,
  type TokenCounters,
  type TokenInput,
  type TokenRun,
  type TokenSpecInput,
  type TranscriptFile,
  type TranscriptRole,
  type TokenRow,
  type UnassignedRow,
  mergeBaselines,
  readTokens,
  serializeTokens,
  tokenRows,
} from '../src/tokens.ts';
import { readTree } from './helpers/read-tree.ts';

const TRANSCRIPTS = join(import.meta.dir, 'fixtures', 'transcripts');
const PROJECT = 'harbor';
const WORKTREE_INFIX = '--claude-worktrees-agent-';
/** What follows the project name in a spec worktree's project folder: `-` and exactly three digits. */
const SPEC_WORKTREE = /^-\d{3}$/;
/**
 * What follows the project name in the project folder of a spec worktree inside the repository (`.worktrees/NNN-slug`
 * encodes to `--worktrees-NNN-slug`): three digits and a kebab-case slug without `--`, so a nested agent worktree
 * (`…--claude-worktrees-agent-<id>`) is not one (ISC-178).
 */
const IN_REPO_SPEC_WORKTREE = /^--worktrees-\d{3}-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const GOLDEN = join(import.meta.dir, 'fixtures', 'tokens.golden.jsonl');

const byteOrder = (a: string, b: string): number => Buffer.compare(Buffer.from(a), Buffer.from(b));
const sortedNames = (dir: string): string[] => readdirSync(dir).sort(byteOrder);

function toolUseIdOf(path: string): string | null {
  if (!existsSync(path)) return null;
  const meta: unknown = JSON.parse(readFileSync(path, 'utf8'));
  const id = typeof meta === 'object' && meta !== null ? (meta as { toolUseId?: unknown }).toolUseId : undefined;
  return typeof id === 'string' && id !== '' ? id : null;
}

/** The main sessions of one project folder and their sub-agents; `prefix` goes before every label. */
function sessionsOf(folder: string, prefix: string): TranscriptFile[] {
  const files: TranscriptFile[] = [];
  for (const name of sortedNames(folder)) {
    if (name.endsWith('.jsonl')) {
      files.push({ role: 'main', session: name.slice(0, -'.jsonl'.length), label: `${prefix}${name}`, text: readFileSync(join(folder, name), 'utf8') });
      continue;
    }
    const subagents = join(folder, name, 'subagents');
    if (!existsSync(subagents)) continue;
    for (const file of sortedNames(subagents)) {
      const match = /^(agent-.+)\.jsonl$/.exec(file);
      if (match === null) continue;
      files.push({
        role: 'subagent',
        session: name,
        label: `${prefix}${name}/subagents/${file}`,
        text: readFileSync(join(subagents, file), 'utf8'),
        toolUseId: toolUseIdOf(join(subagents, `${match[1] ?? ''}.meta.json`)),
      });
    }
  }
  return files;
}

/**
 * Every transcript of the project folder, of its agent-worktree siblings and of its spec-worktree siblings
 * (`<project>-NNN` and `<project>--worktrees-NNN-slug`, both read like the project folder itself), as the CLI's
 * discovery lists them.
 */
function transcriptsOf(root: string, project: string): TranscriptFile[] {
  const files = sessionsOf(join(root, project), '');
  for (const sibling of sortedNames(root)) {
    const rest = sibling.slice(project.length);
    if (sibling.startsWith(project) && (SPEC_WORKTREE.test(rest) || IN_REPO_SPEC_WORKTREE.test(rest))) {
      files.push(...sessionsOf(join(root, sibling), `../${sibling}/`));
      continue;
    }
    if (!sibling.startsWith(`${project}${WORKTREE_INFIX}`)) continue;
    for (const name of sortedNames(join(root, sibling))) {
      if (!name.endsWith('.jsonl')) continue;
      const label = `../${sibling}/${name}`;
      files.push({ role: 'worktree', session: name.slice(0, -'.jsonl'.length), label, text: readFileSync(join(root, sibling, name), 'utf8') });
    }
  }
  return files;
}

/** harbor's spec folders as the CLI hands them to core: texts as read, derived stage from the dashboard model. */
function harborSpecs(): TokenSpecInput[] {
  const input = readTree('harbor');
  const stages = new Map(buildDashboard({ ...input, services: [] }).specs.map((row) => [row.slug, row.stage]));
  return [...input.specs, ...input.archived]
    .map((files) => ({
      slug: files.folder,
      events: files.texts.events ?? null,
      rounds: files.texts.rounds ?? null,
      derivedStage: stages.get(files.folder) ?? null,
    }))
    .sort((a, b) => byteOrder(a.slug, b.slug));
}

const fixtureInput = (): TokenInput => ({ transcripts: transcriptsOf(TRANSCRIPTS, PROJECT), specs: harborSpecs() });

describe('rows', () => {
  test('the fixture is read as six transcripts: root sub-agent and session, agent worktree, in-repo spec worktree session, sibling spec worktree sub-agent and session', () => {
    const files = transcriptsOf(TRANSCRIPTS, PROJECT);
    expect(files.map((f) => f.role)).toEqual(['subagent', 'main', 'worktree', 'main', 'subagent', 'main']);
    expect(files.map((f) => f.toolUseId ?? null)).toEqual(['toolu_01HarborI1', null, null, null, 'toolu_01HarborT1', null]);
    expect(files[3]?.label).toBe('../harbor--worktrees-012-harbor/7d2e4f60-1a3b-4c5d-8e9f-0a1b2c3d4e5f.jsonl');
    expect(files[4]?.session).toBe('3a7c9e21-6b4d-4f80-8e12-5d6c7b8a9f01');
    expect(files[5]?.session).toBe(files[4]?.session);
  });

  // ISC-178: the spec worktree `.worktrees/012-harbor` inside the repository keeps its sessions in the project folder
  // `harbor--worktrees-012-harbor`; it is read like the older sibling `harbor-012`, and both patterns stay.
  test('both spec-worktree folder patterns are read: `<project>--worktrees-NNN-slug` and `<project>-NNN`', () => {
    const labels = transcriptsOf(TRANSCRIPTS, PROJECT).map((f) => f.label);
    expect(labels.filter((label) => label.startsWith('../harbor--worktrees-012-harbor/'))).toEqual(['../harbor--worktrees-012-harbor/7d2e4f60-1a3b-4c5d-8e9f-0a1b2c3d4e5f.jsonl']);
    expect(labels.filter((label) => label.startsWith('../harbor-012/'))).toHaveLength(2);
    const ids = tokenRows(fixtureInput()).rows.flatMap((row) => (row.kind === 'invocation' ? [row.id] : []));
    expect(ids).toContain('a:claude:7d2e4f60-1a3b-4c5d-8e9f-0a1b2c3d4e5f#1');
    expect(ids).toContain('a:claude:3a7c9e21-6b4d-4f80-8e12-5d6c7b8a9f01#1');
  });

  test('a measuring run over the fixture transcript yields exactly the golden lines', () => {
    const run = tokenRows(fixtureInput());
    expect(run.baseline).not.toBeNull();
    const built = serializeTokens([...(run.baseline === null ? [] : [run.baseline]), ...run.rows]);
    expect(built.split('\n')).toEqual(readFileSync(GOLDEN, 'utf8').split('\n'));
    expect(built).toBe(readFileSync(GOLDEN, 'utf8'));
  });

  test('the result does not depend on the order of the transcripts', () => {
    const input = fixtureInput();
    const reversed: TokenInput = { ...input, transcripts: [...input.transcripts].reverse() };
    const run = tokenRows(reversed);
    const built = serializeTokens([...(run.baseline === null ? [] : [run.baseline]), ...run.rows]);
    expect(built).toBe(readFileSync(GOLDEN, 'utf8'));
  });
});

// ─── Small in-test transcripts (T9–T13) ─────────────────────────────────────────────────────────────────────────
//
// Each group below builds its transcripts inline from these helpers, in the line shapes Claude Code writes: a user
// line per input or `/spec` command, an assistant line per streamed content block with the request's `usage`, a
// user line with `tool_result` blocks for every tool answer.

/** input, output, cache_read, cache_write — the order of `TOKEN_COUNTERS`. */
type Counts = readonly [number, number, number, number];

const T0 = Date.UTC(2026, 2, 10, 9, 0, 0);

/** The ISO timestamp `minute` minutes after a fixed start; whole minutes keep the windows easy to read. */
const at = (minute: number): string => new Date(T0 + minute * 60_000).toISOString();

const userLine = (ts: string, content: unknown): string => JSON.stringify({ type: 'user', timestamp: ts, message: { role: 'user', content } });

const commandLine = (ts: string, name: string, args: string): string =>
  userLine(ts, `<command-message>${name.slice(1)} is running…</command-message>\n<command-name>${name}</command-name>\n<command-args>${args}</command-args>`);

const toolResultLine = (ts: string, toolUseId: string): string => userLine(ts, [{ type: 'tool_result', tool_use_id: toolUseId, content: 'done' }]);

const usageLine = (ts: string, requestId: string, counts: Counts, toolUses: readonly string[] = []): string =>
  JSON.stringify({
    type: 'assistant',
    timestamp: ts,
    requestId,
    version: '2.1.40',
    message: {
      id: `msg_${requestId}`,
      role: 'assistant',
      content: [{ type: 'text', text: 'ok' }, ...toolUses.map((id) => ({ type: 'tool_use', id, name: 'Task', input: {} }))],
      usage: { input_tokens: counts[0], output_tokens: counts[1], cache_read_input_tokens: counts[2], cache_creation_input_tokens: counts[3] },
    },
  });

function transcript(role: TranscriptRole, session: string, lines: readonly string[], toolUseId?: string | null): TranscriptFile {
  const label = role === 'subagent' ? `${session}/subagents/agent-${toolUseId ?? 'nometa'}.jsonl` : `${role}/${session}.jsonl`;
  return { role, session, label, text: `${lines.join('\n')}\n`, ...(role === 'subagent' ? { toolUseId: toolUseId ?? null } : {}) };
}

const eventLine = (ts: string, from: string | null, to: string): string => JSON.stringify({ ts, from, to, command: '/spec-plan 002', actor: 'u:3f9c0a7d' });

const roundLine = (round: number, ts: string): string => JSON.stringify({ v: 1, round, ts });

function specInput(slug: string, parts: { events?: readonly string[]; rounds?: readonly string[]; derivedStage?: string | null } = {}): TokenSpecInput {
  return {
    slug,
    events: parts.events === undefined ? null : `${parts.events.join('\n')}\n`,
    rounds: parts.rounds === undefined ? null : `${parts.rounds.join('\n')}\n`,
    derivedStage: parts.derivedStage ?? null,
  };
}

const countsOf = (row: TokenCounters): Counts => [row.input, row.output, row.cache_read, row.cache_write];

const addCounts = (a: Counts, b: Counts): Counts => [a[0] + b[0], a[1] + b[1], a[2] + b[2], a[3] + b[3]];

const ZERO: Counts = [0, 0, 0, 0];

const sumRows = (rows: readonly TokenCounters[]): Counts => rows.reduce<Counts>((sum, row) => addCounts(sum, countsOf(row)), ZERO);

const invocationsOf = (run: TokenRun): InvocationRow[] => run.rows.filter((row): row is InvocationRow => row.kind === 'invocation');
const stagesOf = (run: TokenRun): StageTotalRow[] => run.rows.filter((row): row is StageTotalRow => row.kind === 'stage');
const roundsOf = (run: TokenRun): RoundTotalRow[] => run.rows.filter((row): row is RoundTotalRow => row.kind === 'round');
const unassignedOf = (run: TokenRun): UnassignedRow[] => run.rows.filter((row): row is UnassignedRow => row.kind === 'unassigned');
const codesOf = (run: TokenRun): string[] => run.diagnostics.map((d) => d.code);

const specRowOf = (run: TokenRun, spec: string): SpecTotalRow | undefined => run.rows.find((row): row is SpecTotalRow => row.kind === 'spec' && row.spec === spec);

/**
 * The oracle for the sum invariant, read straight from the transcript texts and independent of `tokens.ts`: every
 * assistant line with `usage` and a timestamp, one entry per `requestId` (else `message.id`), each counter the
 * maximum over the lines repeating it.
 */
function dedupedUsage(files: readonly TranscriptFile[]): { requests: number; counts: Counts } {
  const byKey = new Map<string, Counts>();
  let alone = 0;
  const num = (v: unknown): number => (typeof v === 'number' ? v : 0);
  for (const file of files) {
    for (const raw of file.text.split(/\r?\n/)) {
      let value: unknown;
      try {
        value = JSON.parse(raw);
      } catch {
        continue;
      }
      if (typeof value !== 'object' || value === null) continue;
      const line = value as { type?: unknown; timestamp?: unknown; requestId?: unknown; message?: { id?: unknown; usage?: Record<string, unknown> } };
      const usage = line.message?.usage;
      if (line.type !== 'assistant' || usage === undefined || typeof line.timestamp !== 'string') continue;
      const counts: Counts = [num(usage.input_tokens), num(usage.output_tokens), num(usage.cache_read_input_tokens), num(usage.cache_creation_input_tokens)];
      const key = typeof line.requestId === 'string' ? line.requestId : typeof line.message?.id === 'string' ? line.message.id : `alone-${alone++}`;
      const seen = byKey.get(key);
      byKey.set(key, seen === undefined ? counts : [Math.max(seen[0], counts[0]), Math.max(seen[1], counts[1]), Math.max(seen[2], counts[2]), Math.max(seen[3], counts[3])]);
    }
  }
  return { requests: byKey.size, counts: [...byKey.values()].reduce(addCounts, ZERO) };
}

/** The sum invariant of ISC-135.3: invocation lines plus the one `unassigned` line equal the deduplicated usage. */
function expectSumInvariant(input: TokenInput, run: TokenRun): void {
  const oracle = dedupedUsage(input.transcripts);
  const lines = [...invocationsOf(run), ...unassignedOf(run)];
  expect(lines.reduce((n, row) => n + row.requests, 0)).toBe(oracle.requests);
  const sums = sumRows(lines);
  const differences = Object.fromEntries(TOKEN_COUNTERS.map((counter, i) => [counter, (sums[i] ?? 0) - (oracle.counts[i] ?? 0)]));
  expect(differences).toEqual({ input: 0, output: 0, cache_read: 0, cache_write: 0 });
}

// ─── ISC-135.1 · invocation windows (T9) ────────────────────────────────────────────────────────────────────────

describe('invocation', () => {
  test('tool results, prose prompts, task notifications and local-command output do not end the window', () => {
    const run = tokenRows({
      transcripts: [
        transcript('main', 'm', [
          usageLine(at(0), 'r0', [8, 80, 800, 8000]),
          commandLine(at(1), '/spec-plan', '002'),
          usageLine(at(2), 'r1', [1, 10, 100, 1000], ['toolu_a']),
          toolResultLine(at(3), 'toolu_a'),
          usageLine(at(4), 'r2', [2, 20, 200, 2000]),
          userLine(at(5), [{ type: 'text', text: 'thanks, now something else' }]),
          usageLine(at(6), 'r3', [4, 40, 400, 4000]),
          userLine(at(7), '<task-notification>\n<task-id>t1</task-id>\n<status>completed</status>\n</task-notification>'),
          usageLine(at(8), 'r4', [16, 160, 1600, 16000]),
          userLine(at(9), '<local-command-stdout>ok</local-command-stdout>'),
          usageLine(at(10), 'r5', [32, 320, 3200, 32000]),
        ]),
      ],
      specs: [specInput('002-alpha')],
    });
    // The turn before the first command stays unassigned; everything after it belongs to the window.
    expect(invocationsOf(run).map((row) => [row.requests, ...countsOf(row)])).toEqual([[5, 55, 550, 5500, 55000]]);
    expect(unassignedOf(run).map((row) => [row.requests, ...countsOf(row)])).toEqual([[1, 8, 80, 800, 8000]]);
  });

  test('a non-/spec slash command ends the window and opens none; the turns after it stay unassigned', () => {
    const run = tokenRows({
      transcripts: [
        transcript('main', 'm', [
          commandLine(at(0), '/spec-plan', '002'),
          usageLine(at(1), 'r1', [1, 0, 0, 0]),
          commandLine(at(2), '/clear', ''),
          usageLine(at(3), 'r2', [2, 0, 0, 0]),
          userLine(at(4), 'a prose prompt opens nothing'),
          usageLine(at(5), 'r3', [4, 0, 0, 0]),
          commandLine(at(6), '/spec-tasks', '002'),
          usageLine(at(7), 'r4', [8, 0, 0, 0]),
          commandLine(at(8), '/model', 'opus'),
          userLine(at(9), '<local-command-stdout>Set model to opus</local-command-stdout>'),
          usageLine(at(10), 'r5', [16, 0, 0, 0]),
        ]),
      ],
      specs: [specInput('002-alpha')],
    });
    expect(invocationsOf(run).map((row) => [row.id, row.command, row.requests, row.input])).toEqual([
      ['a:claude:m#1', '/spec-plan', 1, 1],
      ['a:claude:m#2', '/spec-tasks', 1, 8],
    ]);
    expect(unassignedOf(run).map((row) => [row.requests, row.input])).toEqual([[3, 22]]);
  });

  test('a window runs to the end of its session file and never into another session', () => {
    const run = tokenRows({
      transcripts: [
        transcript('main', 'm', [commandLine(at(0), '/spec-plan', '002'), usageLine(at(1), 'r1', [1, 0, 0, 0]), userLine(at(2), 'more'), usageLine(at(30), 'r2', [2, 0, 0, 0])]),
        transcript('main', 'n', [userLine(at(3), 'unrelated'), usageLine(at(4), 'r3', [4, 0, 0, 0])]),
      ],
      specs: [specInput('002-alpha')],
    });
    expect(invocationsOf(run).map((row) => [row.requests, row.input])).toEqual([[2, 3]]);
    expect(unassignedOf(run).map((row) => [row.requests, row.input])).toEqual([[1, 4]]);
  });

  test('a meta line (the loaded skill text) does not end the window either', () => {
    const meta = JSON.stringify({ type: 'user', isMeta: true, timestamp: at(1), message: { role: 'user', content: [{ type: 'text', text: 'Base directory for this skill' }] } });
    const run = tokenRows({
      transcripts: [transcript('main', 'm', [commandLine(at(0), '/spec-plan', '002'), meta, usageLine(at(2), 'r1', [1, 1, 1, 1])])],
      specs: [specInput('002-alpha')],
    });
    expect(invocationsOf(run).map((row) => row.requests)).toEqual([1]);
    expect(unassignedOf(run).map((row) => row.requests)).toEqual([0]);
  });

  test('the next /spec command ends the window and opens its own', () => {
    const run = tokenRows({
      transcripts: [
        transcript('main', 'm', [
          commandLine(at(0), '/spec-plan', '002'),
          usageLine(at(1), 'r1', [1, 1, 1, 1]),
          commandLine(at(2), '/spec-tasks', '002'),
          usageLine(at(3), 'r2', [2, 2, 2, 2]),
        ]),
      ],
      specs: [specInput('002-alpha')],
    });
    expect(invocationsOf(run).map((row) => [row.id, row.command, row.requests, row.input])).toEqual([
      ['a:claude:m#1', '/spec-plan', 1, 1],
      ['a:claude:m#2', '/spec-tasks', 1, 2],
    ]);
  });

  test('a sub-agent counts to the invocation of its toolUseId, not to the one open at its time, nested ones too', () => {
    const run = tokenRows({
      transcripts: [
        transcript('main', 'm', [
          commandLine(at(0), '/spec-implement', '002'),
          usageLine(at(1), 'r1', [1, 0, 0, 0], ['toolu_first']),
          userLine(at(2), 'also start one for the docs'),
          usageLine(at(3), 'r1b', [1000, 0, 0, 0], ['toolu_late']),
          commandLine(at(4), '/spec-plan', '003'),
          usageLine(at(5), 'r2', [2, 0, 0, 0]),
        ]),
        // The sub-agents keep running after their invocation ended; their turns still belong to the first one,
        // including the one started after a prose prompt inside the window.
        transcript('subagent', 'm', [usageLine(at(6), 's1', [10, 0, 0, 0], ['toolu_nested']), usageLine(at(7), 's2', [20, 0, 0, 0])], 'toolu_first'),
        transcript('subagent', 'm', [usageLine(at(8), 's3', [100, 0, 0, 0])], 'toolu_nested'),
        transcript('subagent', 'm', [usageLine(at(9), 's4', [10000, 0, 0, 0])], 'toolu_late'),
      ],
      specs: [specInput('002-alpha'), specInput('003-beta')],
    });
    expect(invocationsOf(run).map((row) => [row.command, row.spec, row.requests, row.subagents, row.input])).toEqual([
      ['/spec-implement', '002-alpha', 6, 3, 11131],
      ['/spec-plan', '003-beta', 1, 0, 2],
    ]);
    expect(unassignedOf(run).map((row) => row.requests)).toEqual([0]);
  });

  test('an agent-worktree session is an invocation of its own, numbered in its own session', () => {
    const run = tokenRows({
      transcripts: [
        transcript('main', 'm', [commandLine(at(0), '/spec-implement', '002'), usageLine(at(1), 'r1', [1, 0, 0, 0])]),
        transcript('worktree', 'w', [commandLine(at(2), '/spec-implement', '002'), usageLine(at(3), 'r2', [2, 0, 0, 0])]),
      ],
      specs: [specInput('002-alpha')],
    });
    expect(invocationsOf(run).map((row) => [row.id, row.requests, row.input])).toEqual([
      ['a:claude:m#1', 1, 1],
      ['a:claude:w#1', 1, 2],
    ]);
  });

  test('the same requestId counts once: on several lines of one file and across two files', () => {
    const repeated = usageLine(at(1), 'r1', [5, 50, 500, 5000], ['toolu_x']);
    const files = [
      transcript('main', 'm', [commandLine(at(0), '/spec-implement', '002'), repeated, repeated, toolResultLine(at(2), 'toolu_x')]),
      transcript('worktree', 'w', [userLine(at(3), 'unrelated'), repeated, usageLine(at(4), 'r2', [1, 1, 1, 1])]),
    ];
    for (const transcripts of [files, [...files].reverse()]) {
      const run = tokenRows({ transcripts, specs: [specInput('002-alpha')] });
      expect(invocationsOf(run).map((row) => [row.requests, ...countsOf(row)])).toEqual([[1, 5, 50, 500, 5000]]);
      expect(unassignedOf(run).map((row) => [row.requests, ...countsOf(row)])).toEqual([[1, 1, 1, 1, 1]]);
    }
  });
});

// ─── ISC-135.2 · spec, stage and round (T10) ────────────────────────────────────────────────────────────────────

describe('attribution', () => {
  test('the spec is the first standalone three-digit number in <command-args>; the arguments never reach the file', () => {
    const run = tokenRows({
      transcripts: [
        transcript('main', 'm', [
          commandLine(at(0), '/spec-plan', 'after 1234 issues, take 003 then 002'),
          usageLine(at(1), 'r1', [1, 0, 0, 0]),
          commandLine(at(2), '/spec-idea', 'a dashboard for quokkas'),
          usageLine(at(3), 'r2', [2, 0, 0, 0]),
        ]),
      ],
      specs: [specInput('002-alpha'), specInput('003-beta')],
    });
    expect(invocationsOf(run).map((row) => [row.command, row.spec])).toEqual([
      ['/spec-plan', '003-beta'],
      ['/spec-idea', null],
    ]);
    expect(run.rows.flatMap((row) => (row.kind === 'spec' ? [[row.spec, row.requests]] : []))).toEqual([['003-beta', 1]]);
    const text = serializeTokens(run.rows);
    for (const word of ['1234', 'quokka', 'take', 'issues']) expect(text).not.toContain(word);
  });

  test('the stage is the `to` of the last transition before the turn; before any event, the derived stage', () => {
    const events = [eventLine(at(10), null, 'plan'), eventLine(at(20), 'plan', 'tasks'), eventLine(at(30), 'tasks', 'review'), eventLine(at(40), 'review', 'build')];
    const run = tokenRows({
      transcripts: [
        transcript('main', 'm', [
          commandLine(at(0), '/spec-plan', '002'),
          usageLine(at(5), 'r0', [1, 0, 0, 0]),
          usageLine(at(15), 'r1', [2, 0, 0, 0]),
          usageLine(at(25), 'r2', [4, 0, 0, 0]),
          usageLine(at(35), 'r3', [8, 0, 0, 0]),
          usageLine(at(45), 'r4', [16, 0, 0, 0]),
          usageLine(at(46), 'r5', [32, 0, 0, 0]),
          commandLine(at(50), '/spec-plan', '003'),
          usageLine(at(51), 'r6', [64, 0, 0, 0]),
        ]),
      ],
      specs: [specInput('002-alpha', { events, derivedStage: 'idea' }), specInput('003-beta', { derivedStage: 'tasks' })],
    });
    expect(stagesOf(run).map((row) => [row.spec, row.stage, row.requests, row.input])).toEqual([
      ['002-alpha', 'idea', 1, 1],
      ['002-alpha', 'plan', 1, 2],
      ['002-alpha', 'tasks', 1, 4],
      ['002-alpha', 'review', 1, 8],
      ['002-alpha', 'build', 2, 48],
      ['003-beta', 'tasks', 1, 64],
    ]);
  });

  test('an implement turn belongs to the first round whose ts is not before it; after the last round to no round', () => {
    const rounds = [roundLine(1, at(20)), roundLine(2, at(40))];
    const run = tokenRows({
      transcripts: [
        transcript('main', 'm', [
          commandLine(at(0), '/spec-implement', '002'),
          usageLine(at(10), 'r1', [1, 0, 0, 0]),
          usageLine(at(20), 'r2', [2, 0, 0, 0]),
          usageLine(at(30), 'r3', [4, 0, 0, 0]),
          usageLine(at(50), 'r4', [8, 0, 0, 0]),
          // Not an implement invocation: inside round 2's window in time, counted to no round.
          commandLine(at(31), '/spec-review', '002'),
          usageLine(at(32), 'r5', [16, 0, 0, 0]),
        ]),
      ],
      specs: [specInput('002-alpha', { events: [eventLine(at(0), null, 'build')], rounds })],
    });
    expect(roundsOf(run).map((row) => [row.spec, row.round, row.requests, row.input])).toEqual([
      ['002-alpha', 1, 2, 3],
      ['002-alpha', 2, 1, 4],
    ]);
    // The turn after the last round still counts to its spec and its stage.
    const spec = specRowOf(run, '002-alpha');
    expect(spec === undefined ? null : countsOf(spec)).toEqual([31, 0, 0, 0]);
    expect(stagesOf(run).map((row) => [row.stage, row.input])).toEqual([['build', 31]]);
  });

  test('over the fixture, the spec, stage and round lines equal the golden', () => {
    const run = tokenRows(fixtureInput());
    const kinds = new Set<string>(['spec', 'stage', 'round']);
    const golden = readFileSync(GOLDEN, 'utf8')
      .split('\n')
      .filter((line) => line !== '' && kinds.has((JSON.parse(line) as { kind: string }).kind));
    expect(golden.length).toBeGreaterThan(0);
    const built = serializeTokens(run.rows.filter((row) => kinds.has(row.kind)));
    expect(built.split('\n').filter((line) => line !== '')).toEqual(golden);
  });
});

// ─── ISC-135.3 · the sum invariant (T11) ────────────────────────────────────────────────────────────────────────

/** A small seeded PRNG (mulberry32), so every composed case is the same on every run. */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Owner {
  readonly id: string;
  readonly command: string;
  readonly spec: string | null;
}

interface WindowSum {
  readonly requests: number;
  readonly counts: Counts;
}

interface Composed {
  readonly input: TokenInput;
  /** Per invocation ID, the requests the generator put into its window. */
  readonly invocations: ReadonlyMap<string, WindowSum>;
  /** Per `spec#round`, the implement requests whose minute falls into the round's window. */
  readonly rounds: ReadonlyMap<string, WindowSum>;
}

const SLUGS: Readonly<Record<string, string>> = { '002': '002-alpha', '003': '003-beta' };

/**
 * Composes random sessions — free input, non-spec slash commands, `/spec` commands with known and unknown numbers,
 * tool calls with their results, sub-agents (some without meta), lines repeated in the same file and main-session
 * lines copied into a sub-agent file — and records, while writing, which invocation and round each request belongs to.
 */
function compose(seed: number): Composed {
  const random = seeded(seed);
  const int = (max: number): number => Math.floor(random() * max);
  const pick = <T,>(items: readonly T[]): T => items[int(items.length)] as T;
  let minute = 0;
  const tick = (): number => ++minute;
  let nextRequest = 0;
  let nextTool = 0;
  const files: TranscriptFile[] = [];
  const requests: Array<{ owner: Owner | null; minute: number; counts: Counts }> = [];
  const copyable: string[] = [];

  const usage = (owner: Owner | null, lines: string[], toolUses: readonly string[], copyFrom: boolean): void => {
    const when = tick();
    const counts: Counts = [int(40), int(3000), int(80000), int(9000)];
    const line = usageLine(at(when), `req_${seed}_${nextRequest++}`, counts, toolUses);
    requests.push({ owner, minute: when, counts });
    lines.push(line);
    if (random() < 0.3) lines.push(line);
    if (copyFrom && toolUses.length === 0) copyable.push(line);
  };

  const sessions: Array<[TranscriptRole, string]> = [
    ['main', `main-${seed}-a`],
    ['main', `main-${seed}-b`],
    ['worktree', `wt-${seed}`],
  ];
  for (const [role, session] of sessions) {
    const lines: string[] = [];
    let owner: Owner | null = null;
    let n = 0;
    for (let step = 0, steps = 4 + int(6); step < steps; step++) {
      const r = random();
      if (r < 0.25) {
        lines.push(userLine(at(tick()), 'free text')); // a prose prompt continues the open window
      } else if (r < 0.35) {
        lines.push(commandLine(at(tick()), '/clear', ''));
        owner = null;
      } else if (r < 0.85) {
        const number = pick(['002', '003', '999', '']);
        const command = pick(['/spec-plan', '/spec-implement', '/spec-implement', '/spec-review']);
        n += 1;
        owner = { id: `a:claude:${session}#${n}`, command, spec: SLUGS[number] ?? null };
        lines.push(commandLine(at(tick()), command, number === '' ? 'everything open' : `${number} please`));
      }
      for (let turn = 0, turns = int(4); turn < turns; turn++) {
        if (random() < 0.3) {
          const tool = `toolu_${seed}_${nextTool++}`;
          usage(owner, lines, [tool], false);
          const hasMeta = random() < 0.85;
          const agentLines: string[] = [];
          for (let k = 0, ks = 1 + int(3); k < ks; k++) usage(hasMeta ? owner : null, agentLines, [], false);
          // A main-session line copied into the sub-agent file: counted once, where the main session has it.
          if (copyable.length > 0 && random() < 0.4) agentLines.push(pick(copyable));
          files.push(transcript('subagent', session, agentLines, hasMeta ? tool : null));
          lines.push(toolResultLine(at(tick()), tool));
        } else {
          usage(owner, lines, [], role === 'main');
        }
      }
    }
    files.push(transcript(role, session, lines));
  }

  // Timelines over the composed span: events and rounds in time order, at random minutes.
  const span = minute + 5;
  const sortedMinutes = (count: number): number[] => Array.from({ length: count }, () => 1 + int(span)).sort((a, b) => a - b);
  const roundMinutes = new Map<string, number[]>();
  const stages = ['plan', 'tasks', 'review', 'build'];
  const specs: TokenSpecInput[] = Object.values(SLUGS).map((slug) => {
    const events = sortedMinutes(4).map((m, i) => eventLine(at(m), i === 0 ? null : (stages[i - 1] ?? null), stages[i] ?? 'build'));
    const rounds = sortedMinutes(1 + int(3));
    roundMinutes.set(slug, rounds);
    return specInput(slug, { events, rounds: rounds.map((m, i) => roundLine(i + 1, at(m))), derivedStage: 'idea' });
  });

  const add = (map: Map<string, WindowSum>, key: string, counts: Counts): void => {
    const sum = map.get(key) ?? { requests: 0, counts: ZERO };
    map.set(key, { requests: sum.requests + 1, counts: addCounts(sum.counts, counts) });
  };
  const invocations = new Map<string, WindowSum>();
  const rounds = new Map<string, WindowSum>();
  for (const request of requests) {
    if (request.owner === null) continue;
    add(invocations, request.owner.id, request.counts);
    const spec = request.owner.spec;
    if (request.owner.command !== '/spec-implement' || spec === null) continue;
    const index = (roundMinutes.get(spec) ?? []).findIndex((m) => m >= request.minute);
    if (index >= 0) add(rounds, `${spec}#${index + 1}`, request.counts);
  }
  return { input: { transcripts: files, specs }, invocations, rounds };
}

describe('sums', () => {
  test('over the fixture: invocation lines plus unassigned equal the deduplicated usage, difference 0 per counter', () => {
    const input = fixtureInput();
    expectSumInvariant(input, tokenRows(input));
  });

  test('over the fixture: the stage lines of a spec add up to its spec line', () => {
    const run = tokenRows(fixtureInput());
    for (const row of run.rows) {
      if (row.kind !== 'spec') continue;
      expect(sumRows(stagesOf(run).filter((stage) => stage.spec === row.spec))).toEqual(countsOf(row));
    }
  });

  const SEEDS = Array.from({ length: 25 }, (_, i) => i + 1);

  test.each(SEEDS)('over composed transcripts (seed %d): the sum invariant holds, difference 0 per counter', (seed) => {
    const { input } = compose(seed);
    expect(dedupedUsage(input.transcripts).requests).toBeGreaterThan(0);
    expectSumInvariant(input, tokenRows(input));
  });

  test.each(SEEDS)('over composed transcripts (seed %d): every invocation and every round line equals the sum of its window', (seed) => {
    const composed = compose(seed);
    const run = tokenRows(composed.input);
    const invocations = Object.fromEntries(invocationsOf(run).map((row) => [row.id, { requests: row.requests, counts: countsOf(row) }]));
    const expected = Object.fromEntries(Object.keys(invocations).map((id) => [id, composed.invocations.get(id) ?? { requests: 0, counts: ZERO }]));
    expect(invocations).toEqual(expected);
    expect([...composed.invocations.keys()].filter((id) => !(id in invocations))).toEqual([]);
    const rounds = Object.fromEntries(roundsOf(run).map((row) => [`${row.spec}#${row.round}`, { requests: row.requests, counts: countsOf(row) }]));
    expect(rounds).toEqual(Object.fromEntries(composed.rounds));
  });
});

// ─── ISC-135.4 · unassigned and robustness (T13) ────────────────────────────────────────────────────────────────

describe('unassigned', () => {
  test('turns without a /spec reference land in exactly one unassigned line, from every source', () => {
    const run = tokenRows({
      transcripts: [
        transcript('main', 'm', [
          usageLine(at(0), 'r1', [1, 0, 0, 0]),
          commandLine(at(1), '/spec-plan', '002'),
          usageLine(at(2), 'r2', [2, 0, 0, 0], ['toolu_known']),
          commandLine(at(3), '/model', 'opus'),
          usageLine(at(4), 'r3', [4, 0, 0, 0]),
        ]),
        transcript('worktree', 'w', [userLine(at(5), 'hello'), usageLine(at(6), 'r4', [8, 0, 0, 0])]),
        transcript('subagent', 'm', [usageLine(at(7), 's1', [16, 0, 0, 0])], null),
        transcript('subagent', 'm', [usageLine(at(8), 's2', [32, 0, 0, 0])], 'toolu_nobody'),
      ],
      specs: [specInput('002-alpha')],
    });
    expect(unassignedOf(run).map((row) => [row.requests, row.input])).toEqual([[5, 61]]);
    for (const code of ['tokens-subagent-no-meta', 'tokens-subagent-parent-unknown']) expect(codesOf(run)).toContain(code);
  });

  test('a run with nothing unassigned still carries exactly one unassigned line, all zero', () => {
    const run = tokenRows({
      transcripts: [transcript('main', 'm', [commandLine(at(0), '/spec-plan', '002'), usageLine(at(1), 'r1', [1, 1, 1, 1])])],
      specs: [specInput('002-alpha')],
    });
    expect(unassignedOf(run).map((row) => [row.requests, ...countsOf(row)])).toEqual([[0, 0, 0, 0, 0]]);
  });

  test('a line that is not JSON is one diagnostic with its source and line, and the rest is still counted', () => {
    const run = tokenRows({
      transcripts: [transcript('main', 'm', [commandLine(at(0), '/spec-plan', '002'), '{"type":"assistant", broken', usageLine(at(1), 'r1', [3, 3, 3, 3])])],
      specs: [specInput('002-alpha')],
    });
    expect(run.diagnostics.filter((d) => d.code === 'tokens-line-not-json').map((d) => [d.source, d.line])).toEqual([['main/m.jsonl', 2]]);
    expect(invocationsOf(run).map((row) => [row.requests, row.input])).toEqual([[1, 3]]);
  });

  test('a transcript without usage is one diagnostic and counts nothing', () => {
    const run = tokenRows({
      transcripts: [
        transcript('main', 'm', [commandLine(at(0), '/spec-plan', '002'), usageLine(at(1), 'r1', [1, 0, 0, 0])]),
        transcript('worktree', 'w', [userLine(at(2), 'only talk'), JSON.stringify({ type: 'system', timestamp: at(3) })]),
      ],
      specs: [specInput('002-alpha')],
    });
    expect(run.diagnostics.filter((d) => d.code === 'tokens-transcript-no-usage').map((d) => d.source)).toEqual(['worktree/w.jsonl']);
    expect([...invocationsOf(run), ...unassignedOf(run)].reduce((n, row) => n + row.requests, 0)).toBe(1);
  });

  test('an unknown spec number is one diagnostic; the invocation stays, with no spec, and adds to no spec line', () => {
    const run = tokenRows({
      transcripts: [transcript('main', 'm', [commandLine(at(0), '/spec-implement', '999'), usageLine(at(1), 'r1', [7, 0, 0, 0])])],
      specs: [specInput('002-alpha')],
    });
    expect(run.diagnostics.filter((d) => d.code === 'tokens-spec-unknown').map((d) => d.subject)).toEqual(['999']);
    expect(invocationsOf(run).map((row) => [row.spec, row.requests, row.input])).toEqual([[null, 1, 7]]);
    expect(run.rows.filter((row) => row.kind === 'spec' || row.kind === 'stage' || row.kind === 'round')).toEqual([]);
  });

  test('all three at once: the run does not throw, names each finding, and the sums still hold', () => {
    const input: TokenInput = {
      transcripts: [
        transcript('main', 'm', ['not json at all', commandLine(at(0), '/spec-plan', '404'), usageLine(at(1), 'r1', [1, 2, 3, 4]), commandLine(at(2), '/clear', ''), usageLine(at(3), 'r2', [5, 6, 7, 8])]),
        transcript('worktree', 'w', [userLine(at(4), 'nothing to count')]),
      ],
      specs: [specInput('002-alpha')],
    };
    const run = tokenRows(input);
    for (const code of ['tokens-line-not-json', 'tokens-spec-unknown', 'tokens-transcript-no-usage']) expect(codesOf(run)).toContain(code);
    expect(unassignedOf(run).map((row) => row.requests)).toEqual([1]);
    expectSumInvariant(input, run);
  });
});

// ─── ISC-136.1 · baseline lines across runs (T16) ───────────────────────────────────────────────────────────────

/**
 * One session grown to `segments` invocations, alternating `/spec-plan` and `/spec-implement` on spec 002, ten minutes
 * apart, each with two requests; its newest turn is `at(10 * (segments - 1) + 2)`. A longer session is a later state
 * of the same transcripts. The third invocation's `cache_write` of 3 makes the `/spec-plan` mean round (1.5 → 2).
 */
function sessionLines(segments: number): string[] {
  const lines: string[] = [];
  for (let k = 0; k < segments; k += 1) {
    lines.push(
      commandLine(at(10 * k), k % 2 === 0 ? '/spec-plan' : '/spec-implement', '002'),
      usageLine(at(10 * k + 1), `b${k}a`, [1 + k, 10, 100, k === 2 ? 3 : 0]),
      usageLine(at(10 * k + 2), `b${k}b`, [2, 5, 50, 0]),
    );
  }
  return lines;
}

const stateInput = (segments: number, extra: readonly TranscriptFile[] = []): TokenInput => ({
  transcripts: [transcript('main', 'b', sessionLines(segments)), ...extra],
  specs: [specInput('002-alpha')],
});

function baselineOfRun(run: TokenRun): BaselineRow {
  expect(run.baseline).not.toBeNull();
  return run.baseline as BaselineRow;
}

const stateBaseline = (segments: number): BaselineRow => baselineOfRun(tokenRows(stateInput(segments)));

/** The newest timestamp of an assistant line with `usage`, read straight from the texts (independent of tokens.ts). */
function newestUsageTs(files: readonly TranscriptFile[]): string {
  let newest = '';
  for (const file of files) {
    for (const raw of file.text.split(/\r?\n/)) {
      let value: unknown;
      try {
        value = JSON.parse(raw);
      } catch {
        continue;
      }
      if (typeof value !== 'object' || value === null) continue;
      const line = value as { type?: unknown; timestamp?: unknown; message?: { usage?: unknown } };
      if (line.type !== 'assistant' || line.message?.usage === undefined || typeof line.timestamp !== 'string') continue;
      if (newest === '' || Date.parse(line.timestamp) > Date.parse(newest)) newest = line.timestamp;
    }
  }
  return newest;
}

/** The CLI's order (server/src/tokens-cli.ts): read the file back, keep its baseline lines, measure, merge, serialise. */
function measureInto(existing: string | null, input: TokenInput): string {
  const previous = existing === null ? [] : readTokens(existing).rows.filter((row): row is BaselineRow => row.kind === 'baseline');
  const run = tokenRows(input);
  return serializeTokens([...mergeBaselines(previous, run.baseline), ...run.rows]);
}

const baselineLinesOf = (text: string): string[] => text.split('\n').filter((line) => line.includes('"kind":"baseline"'));

describe('baseline', () => {
  test('a run yields one baseline line: newest measured turn, versions, per /spec command count, sums and rounded mean', () => {
    const baseline = stateBaseline(3);
    expect(baseline.measured_through).toBe(at(22));
    expect(baseline.claude_code).toEqual(['2.1.40']);
    expect(baseline.commands).toEqual({
      '/spec-implement': { count: 1, input: 4, output: 15, cache_read: 150, cache_write: 0, mean: { input: 4, output: 15, cache_read: 150, cache_write: 0 } },
      '/spec-plan': { count: 2, input: 8, output: 30, cache_read: 300, cache_write: 3, mean: { input: 4, output: 15, cache_read: 150, cache_write: 2 } },
    });
  });

  test('over the fixture: measured_through is the newest usage turn, every version is named, every mean is the rounded quotient', () => {
    const input = fixtureInput();
    const run = tokenRows(input);
    const baseline = baselineOfRun(run);
    expect(baseline.measured_through).toBe(newestUsageTs(input.transcripts));
    expect(baseline.claude_code).toEqual(['2.1.38', '2.1.40', '2.1.42']);
    const invocations = invocationsOf(run);
    expect(Object.keys(baseline.commands)).toEqual([...new Set(invocations.map((row) => row.command))].sort());
    for (const [command, entry] of Object.entries(baseline.commands)) {
      const mine = invocations.filter((row) => row.command === command);
      expect(entry.count).toBe(mine.length);
      expect(countsOf(entry)).toEqual(sumRows(mine));
      for (const counter of TOKEN_COUNTERS) expect(entry.mean[counter]).toBe(Math.round(entry[counter] / entry.count));
    }
  });

  test('n earlier lines plus a run over a new state give n+1 lines, the earlier ones kept as they were', () => {
    let lines: BaselineRow[] = [];
    for (let n = 1; n <= 4; n += 1) {
      const before = structuredClone(lines);
      const merged = mergeBaselines(lines, stateBaseline(n));
      expect(merged).toHaveLength(n);
      expect(merged.slice(0, n - 1)).toEqual(before);
      expect(merged.map((row) => row.measured_through)).toEqual([...merged.map((row) => row.measured_through)].sort());
      lines = merged;
    }
  });

  test('the same state again adds no second line', () => {
    const lines = mergeBaselines(mergeBaselines([], stateBaseline(1)), stateBaseline(2));
    const again = mergeBaselines(lines, stateBaseline(2));
    expect(again).toHaveLength(2);
    expect(again).toEqual(lines);
    expect(mergeBaselines(again, stateBaseline(1))).toEqual(lines);
  });

  test('the same measured_through with other numbers (a transcript deleted since): the line already there is kept', () => {
    const older = transcript('main', 'a', [commandLine(at(0), '/spec-plan', '002'), usageLine(at(1), 'old1', [900, 900, 900, 900])]);
    const first = baselineOfRun(tokenRows(stateInput(3, [older])));
    const later = stateBaseline(3);
    expect(later.measured_through).toBe(first.measured_through);
    expect(later.commands).not.toEqual(first.commands);
    expect(mergeBaselines([first], later)).toEqual([first]);
  });

  test('a line older than every kept one still adds, in measured_through order', () => {
    const merged = mergeBaselines([stateBaseline(3)], stateBaseline(1));
    expect(merged.map((row) => row.measured_through)).toEqual([at(2), at(22)]);
  });

  test('a run that measured nothing keeps every earlier line unchanged', () => {
    const lines = mergeBaselines(mergeBaselines([], stateBaseline(1)), stateBaseline(2));
    const empty = tokenRows({ transcripts: [], specs: [specInput('002-alpha')] });
    expect(empty.baseline).toBeNull();
    expect(mergeBaselines(lines, empty.baseline)).toEqual(lines);
    const talkOnly = tokenRows({ transcripts: [transcript('main', 'c', [userLine(at(0), 'hello')])], specs: [] });
    expect(talkOnly.baseline).toBeNull();
    expect(mergeBaselines(lines, talkOnly.baseline)).toEqual(lines);
    expect(mergeBaselines([], null)).toEqual([]);
  });

  test('neither argument is changed', () => {
    const previous = Object.freeze([Object.freeze(stateBaseline(1))]);
    const next = Object.freeze(stateBaseline(2));
    const snapshot = structuredClone([previous, next]);
    const merged = mergeBaselines(previous, next);
    expect(merged).not.toBe(previous);
    expect([previous, next]).toEqual(snapshot);
  });

  test('through the file: n+1 lines after a new state, n after the same, and earlier lines outlive their transcripts', () => {
    const first = measureInto(null, stateInput(2));
    expect(baselineLinesOf(first)).toHaveLength(1);
    const second = measureInto(first, stateInput(3));
    expect(baselineLinesOf(second)).toHaveLength(2);
    expect(baselineLinesOf(second)[0]).toBe(baselineLinesOf(first)[0]);
    expect(measureInto(second, stateInput(3))).toBe(second);
    const gone = measureInto(second, { transcripts: [], specs: [specInput('002-alpha')] });
    expect(baselineLinesOf(gone)).toEqual(baselineLinesOf(second));
    expect(gone.split('\n').filter((line) => line !== '' && !line.includes('"kind":"baseline"'))).toEqual([
      '{"v":1,"kind":"unassigned","requests":0,"input":0,"output":0,"cache_read":0,"cache_write":0}',
    ]);
  });
});

// ─── ISC-137 · reading the file back (T17) ──────────────────────────────────────────────────────────────────────

/** A run's lines as the file holds them: the merged baseline lines first, then the rest as `tokenRows` sorted them. */
const linesOfRun = (run: TokenRun, earlier: readonly BaselineRow[] = []): TokenRow[] => [...mergeBaselines(earlier, run.baseline), ...run.rows];

describe('roundtrip', () => {
  test('the golden reads back without a diagnostic and serialises to the same bytes', () => {
    const golden = readFileSync(GOLDEN, 'utf8');
    const reading = readTokens(golden);
    expect(reading.diagnostics).toEqual([]);
    expect(reading.rows).toHaveLength(golden.split('\n').filter((line) => line !== '').length);
    expect(serializeTokens(reading.rows)).toBe(golden);
  });

  // ISC-137: harbor/generate.ts writes harbor's `specs/tokens.jsonl` from the same transcript fixture, and FORMAT.md
  // quotes it verbatim; the generated file is the golden byte for byte and reads back into the same bytes.
  test("harbor's specs/tokens.jsonl, written by generate.ts, is the golden and reads back to the same bytes", () => {
    const generated = readFileSync(join(import.meta.dir, '..', 'fixtures', 'harbor', 'specs', 'tokens.jsonl'), 'utf8');
    expect(generated).toBe(readFileSync(GOLDEN, 'utf8'));
    const reading = readTokens(generated);
    expect(reading.diagnostics).toEqual([]);
    expect(serializeTokens(reading.rows)).toBe(generated);
  });

  test('the fixture run reads back into the very lines it was written from', () => {
    const rows = linesOfRun(tokenRows(fixtureInput()));
    const reading = readTokens(serializeTokens(rows));
    expect(reading.diagnostics).toEqual([]);
    expect(reading.rows).toEqual(rows);
  });

  test('generated runs, with earlier baseline lines and null specs, read back into the same lines', () => {
    let earlier: BaselineRow[] = [];
    for (let seed = 1; seed <= 25; seed += 1) {
      const rows = linesOfRun(tokenRows(compose(seed).input), earlier);
      const reading = readTokens(serializeTokens(rows));
      expect(reading.diagnostics).toEqual([]);
      expect(reading.rows).toEqual(rows);
      earlier = rows.filter((row): row is BaselineRow => row.kind === 'baseline');
    }
    expect(earlier.length).toBeGreaterThan(1);
  });

  test('blank lines are skipped and CRLF reads like LF', () => {
    const text = serializeTokens(linesOfRun(tokenRows(stateInput(2))));
    const expected = readTokens(text).rows;
    expect(expected.length).toBeGreaterThan(0);
    expect(readTokens(`\n${text.replaceAll('\n', '\n\n')}  \n`)).toEqual({ rows: expected, diagnostics: [] });
    expect(readTokens(text.replaceAll('\n', '\r\n'))).toEqual({ rows: expected, diagnostics: [] });
    expect(readTokens('')).toEqual({ rows: [], diagnostics: [] });
  });

  test('a malformed line is a diagnostic with its line number, never a throw, and the good lines still read', () => {
    const good = '{"v":1,"kind":"spec","spec":"002-alpha","requests":1,"input":1,"output":2,"cache_read":3,"cache_write":4}';
    const last = '{"v":1,"kind":"unassigned","requests":0,"input":0,"output":0,"cache_read":0,"cache_write":0}';
    const lines = [
      good,
      'not json at all',
      '',
      '[1,2,3]',
      '{"v":1,"kind":"session","requests":1}',
      '{"v":2,"kind":"unassigned","requests":0,"input":0,"output":0,"cache_read":0,"cache_write":0}',
      '{"v":1,"kind":"spec","spec":"002-alpha","input":1,"output":2,"cache_read":3,"cache_write":4}',
      '{"v":1,"kind":"spec","spec":"002-alpha","requests":1,"input":"1","output":2,"cache_read":3,"cache_write":4}',
      '{"v":1,"kind":"round","spec":"002-alpha","round":1.5,"requests":1,"input":1,"output":2,"cache_read":3,"cache_write":4}',
      '{"v":1,"kind":"baseline","measured_through":"2026-03-10T09:00:00.000Z","claude_code":["2.1.40"],"commands":{"/spec-plan":{"count":1,"input":1,"output":1,"cache_read":1,"cache_write":1}}}',
      '{"v":1,"kind":"invocation","id":"a:claude:b#1","command":"/spec-plan","spec":7,"ts":"2026-03-10T09:00:00.000Z","requests":1,"subagents":0,"input":1,"output":1,"cache_read":1,"cache_write":1}',
      'null',
      '{"kind":"spec"}',
      last,
    ];
    let reading: ReturnType<typeof readTokens> = { rows: [], diagnostics: [] };
    expect(() => {
      reading = readTokens(`${lines.join('\n')}\n`);
    }).not.toThrow();
    expect(serializeTokens(reading.rows)).toBe(`${good}\n${last}\n`);
    expect(reading.diagnostics.map((d) => [d.line, d.code])).toEqual([
      [2, 'tokens-line-not-json'],
      [4, 'tokens-line-not-object'],
      [5, 'tokens-kind-unknown'],
      [6, 'tokens-version-unknown'],
      [7, 'tokens-key-missing'],
      [8, 'tokens-value-invalid'],
      [9, 'tokens-value-invalid'],
      [10, 'tokens-value-invalid'],
      [11, 'tokens-value-invalid'],
      [12, 'tokens-line-not-object'],
      [13, 'tokens-version-unknown'],
    ]);
    expect(reading.diagnostics.find((d) => d.line === 7)?.subject).toBe('requests');
    expect(reading.diagnostics.find((d) => d.line === 9)?.subject).toBe('round');
    expect(reading.diagnostics.find((d) => d.line === 10)?.subject).toBe('commands');
  });

  test('an unknown extra key is a diagnostic; the line is kept without it', () => {
    const line = '{"v":1,"kind":"unassigned","requests":0,"input":0,"output":0,"cache_read":0,"cache_write":0,"skill":"9.9.9"}';
    const reading = readTokens(`${line}\n`);
    expect(reading.diagnostics.map((d) => [d.line, d.code, d.subject])).toEqual([[1, 'tokens-key-unknown', 'skill']]);
    expect(serializeTokens(reading.rows)).toBe('{"v":1,"kind":"unassigned","requests":0,"input":0,"output":0,"cache_read":0,"cache_write":0}\n');
  });
});

// ─── Spec 010 · plugin invocations (T12, ISC-345) and plugin versions (T13, ISC-336) ────────────────────────────
//
// Its own transcript folder `fixtures/transcripts-plugin/`, so the ISC-135 golden above stays untouched: two main
// sessions of a repository where the plugin runs `/spectant:spec implement 010` twice (from the marketplace cache,
// versions 0.1.0 and 0.2.0), `/spectant:spec plan 010` once from a checkout (no version in the skill's base
// directory) and the old skill's `/spec-review 010` once. Its golden `transcripts-plugin/tokens.golden.jsonl` is
// computed by hand from those lines.

const PLUGIN_TRANSCRIPTS = join(import.meta.dir, 'fixtures', 'transcripts-plugin');
const PLUGIN_GOLDEN = join(PLUGIN_TRANSCRIPTS, 'tokens.golden.jsonl');
const PLUGIN_SPEC = '010-core-cli-context-pack';

/** Spec 010 as the CLI would hand it over: build from 08:00, code review from 10:35, rounds 1 to 3. */
const pluginInput = (): TokenInput => ({
  transcripts: sessionsOf(join(PLUGIN_TRANSCRIPTS, 'spectant'), ''),
  specs: [
    specInput(PLUGIN_SPEC, {
      events: [eventLine('2026-10-20T08:00:00.000Z', 'tasks', 'build'), eventLine('2026-10-20T10:35:00.000Z', 'build', 'code-review')],
      rounds: [roundLine(1, '2026-10-20T09:10:00.000Z'), roundLine(2, '2026-10-20T09:30:00.000Z'), roundLine(3, '2026-10-20T10:30:00.000Z')],
      derivedStage: 'code-review',
    }),
  ],
});

const pluginLines = (run: TokenRun): string => serializeTokens([...(run.baseline === null ? [] : [run.baseline]), ...run.rows]);

/** A meta user line loading a skill from `base`, as Claude Code writes it after the command line. */
const skillLine = (ts: string, base: string): string =>
  JSON.stringify({ type: 'user', isMeta: true, timestamp: ts, message: { role: 'user', content: [{ type: 'text', text: `Base directory for this skill: ${base}\n\n# Spec` }] } });

describe('tokens: plugin invocations (ISC-345)', () => {
  test('`/spectant:spec implement 010` is a `/spec implement` invocation of spec 010 with its round lines, and nothing lands in unassigned', () => {
    const input = pluginInput();
    const run = tokenRows(input);
    expect(invocationsOf(run).map((row) => [row.command, row.spec, row.requests])).toEqual([
      ['/spec implement', PLUGIN_SPEC, 3],
      ['/spec implement', PLUGIN_SPEC, 2],
      ['/spec plan', PLUGIN_SPEC, 1],
      ['/spec-review', PLUGIN_SPEC, 1],
    ]);
    expect(roundsOf(run).map((row) => [row.spec, row.round, row.requests])).toEqual([
      [PLUGIN_SPEC, 1, 2],
      [PLUGIN_SPEC, 2, 1],
      [PLUGIN_SPEC, 3, 2],
    ]);
    expect(unassignedOf(run).map((row) => [row.requests, ...countsOf(row)])).toEqual([[0, 0, 0, 0, 0]]);
    expect(specRowOf(run, PLUGIN_SPEC)?.requests).toBe(7);
    expectSumInvariant(input, run);
  });

  test('any `/<plugin>:spec` is stored as `/spec <subcommand>`, without one as `/spec`; another plugin command only ends the window', () => {
    const run = tokenRows({
      transcripts: [
        transcript('main', 'p', [
          commandLine(at(0), '/other-plugin:spec', 'tasks 002 --force'),
          usageLine(at(1), 'p1', [1, 1, 1, 1]),
          commandLine(at(2), '/spectant:spec', ''),
          usageLine(at(3), 'p2', [1, 1, 1, 1]),
          commandLine(at(4), '/spectant:status', ''),
          usageLine(at(5), 'p3', [1, 1, 1, 1]),
        ]),
      ],
      specs: [specInput('002-alpha')],
    });
    expect(invocationsOf(run).map((row) => [row.command, row.spec, row.requests])).toEqual([
      ['/spec tasks', '002-alpha', 1],
      ['/spec', null, 1],
    ]);
    expect(unassignedOf(run).map((row) => row.requests)).toEqual([1]);
  });
});

describe('tokens: plugin versions in the baseline line (ISC-336)', () => {
  test('a run over the plugin fixture yields exactly the plugin golden', () => {
    const built = pluginLines(tokenRows(pluginInput()));
    expect(built.split('\n')).toEqual(readFileSync(PLUGIN_GOLDEN, 'utf8').split('\n'));
    expect(built).toBe(readFileSync(PLUGIN_GOLDEN, 'utf8'));
  });

  test('per /spec command the versions of its invocations, sorted and each once, `unknown` without one; the old skill commands carry none', () => {
    const baseline = baselineOfRun(tokenRows(pluginInput()));
    expect(baseline.commands['/spec implement']?.plugin).toEqual(['0.1.0', '0.2.0']);
    expect(baseline.commands['/spec plan']?.plugin).toEqual(['unknown']);
    expect(baseline.commands['/spec-review']).toBeDefined();
    expect(Object.keys(baseline.commands['/spec-review'] ?? {})).not.toContain('plugin');
    // The same version twice is named once; an invocation without a skill line, or with another skill's, is `unknown`.
    const cache = '/srv/bait/.claude/plugins/cache/spectant/spectant/0.3.0/skills';
    const run = tokenRows({
      transcripts: [
        transcript('main', 'v', [
          commandLine(at(0), '/spectant:spec', 'plan 002'),
          skillLine(at(0), `${cache}/spec`),
          usageLine(at(1), 'v1', [1, 1, 1, 1]),
          commandLine(at(2), '/spectant:spec', 'plan 002'),
          skillLine(at(2), `${cache}/spec`),
          usageLine(at(3), 'v2', [1, 1, 1, 1]),
          commandLine(at(4), '/spec', 'plan 002'),
          usageLine(at(5), 'v3', [1, 1, 1, 1]),
          commandLine(at(6), '/spectant:spec', 'tasks 002'),
          skillLine(at(6), `${cache}/archify`),
          usageLine(at(7), 'v4', [1, 1, 1, 1]),
        ]),
      ],
      specs: [specInput('002-alpha')],
    });
    const commands = baselineOfRun(run).commands;
    expect(commands['/spec plan']?.plugin).toEqual(['0.3.0', 'unknown']);
    expect(commands['/spec tasks']?.plugin).toEqual(['unknown']);
  });

  test('only the version segment reaches the file, never the skill path', () => {
    const built = pluginLines(tokenRows(pluginInput()));
    for (const bait of ['/srv', 'bait', 'plugins/', '/cache/', 'skills/', 'checkout', '.claude']) expect(built).not.toContain(bait);
  });

  test('the plugin golden reads back without a diagnostic and serialises to the same bytes', () => {
    const golden = readFileSync(PLUGIN_GOLDEN, 'utf8');
    const reading = readTokens(golden);
    expect(reading.diagnostics).toEqual([]);
    expect(serializeTokens(reading.rows)).toBe(golden);
  });

  test('a baseline line of an earlier run without `plugin` reads back and serialises byte-identical, and the same state again adds no second line', () => {
    const old = baselineLinesOf(readFileSync(GOLDEN, 'utf8'))[0] ?? '';
    expect(old).not.toContain('"plugin"');
    expect(serializeTokens(readTokens(`${old}\n`).rows)).toBe(`${old}\n`);
    // The plugin fixture's own state as a run before the field wrote it: same measured_through, no `plugin` anywhere.
    const before = readFileSync(PLUGIN_GOLDEN, 'utf8').replace(/,"plugin":\[[^\]]*\]/g, '');
    expect(before).not.toContain('"plugin"');
    expect(readTokens(before).diagnostics).toEqual([]);
    const after = measureInto(before, pluginInput());
    expect(baselineLinesOf(after)).toEqual(baselineLinesOf(before));
    expect(after).toBe(before);
  });

  test('a `plugin` value of the wrong shape is a diagnostic and its line is left out', () => {
    const line = baselineLinesOf(readFileSync(PLUGIN_GOLDEN, 'utf8'))[0] ?? '';
    const reading = readTokens(`${line.replace('"plugin":["unknown"]', '"plugin":"unknown"')}\n`);
    expect(reading.rows).toEqual([]);
    expect(reading.diagnostics.map((d) => [d.line, d.code, d.subject])).toEqual([[1, 'tokens-value-invalid', 'commands']]);
  });
});

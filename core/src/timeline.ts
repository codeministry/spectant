// The merged timeline (T14, ISC-80): context.md decisions, rounds, gate marks and the commits the server passes
// in, one entry per source event, time-ordered.
//
// Pure over text the caller read: no `node:*`, no subprocess, so the web bundle may import the types beside it.
// Stage entries (`kind: 'stage'`) come from derived-stages.ts (T15, ISC-36): the input's events when it carries any,
// else the transitions derived from the files, marked `derived`. Without `input.events` the spec's own events.jsonl
// is read through events.ts (T16, ISC-32): its valid lines are the recorded transitions, its rejected lines are
// dropped here (the timeline carries no diagnostics), and a file with no valid line derives as if it were absent.
//
// Order: newest first by the instant each `ts` names, then by source (stage < decision < round < gate < commit), then
// by position in the source. A stage entry sorts at the instant `stageInstants` gives it (an undated one right after
// the dated transition before it) and above every other entry of that instant: the transition is what the gate mark
// or decision beside it caused. Stage entries of one instant list the later transition first. Instants are compared
// as `Date.parse` epochs, not as strings: `git log --format=%cI` prints the committer's offset (`08:00:00+02:00`), and
// mixed precision (`…29Z` vs `…29.277Z`) breaks a lexical compare as well. A `ts` that does not parse sorts after
// every one that does, lexically among its peers.
//
// The server joins two sources the files do not hold (spec 024, the note and agent marks): the
// app's notes of the spec (`note`, at the note's creation) and the lock sessions holding one of its claims (`agent`,
// at the lock's `since`, `running` while held). They sort after every file source of the same instant.
//
// The third join is the git state of the spec's worktree (spec 027, T14, ISC-175.1, `input.worktree`): a branch
// merged into `main` is one `worktree` entry `merged` at the merge commit's date; a worktree gone while its branch is
// not merged is one entry `removed`, undated (`ts: ''`, `undated: true`) as git gives no date. Both are `derived: true`
// and `actor: null` like a derived stage transition (ISC-36): no event records them, and none is written. The undated
// rule places `removed` at the instant of the entry before it, which for a removal is the newest of the timeline (it
// follows everything recorded while the worktree lived); it sorts after every entry of that instant, never first, so
// the web's day groups keep it beside that entry. Merged wins over removed; an open branch yields nothing.
import { blocksOf, parseQuestion, QUESTION_HEADER } from './context-log.ts';
import { deriveStages, GOAL_HEADER, ROUND_HEADER, stageInstants } from './derived-stages.ts';
import { parseEvents } from './events.ts';
import type {
  CommitRecord,
  DecisionQuestion,
  SpecFiles,
  TimelineEntry,
  TimelineInput,
  TimelineKind,
  TimelineWorktreeInput,
} from './files.ts';

type RecordedKind = Exclude<TimelineKind, 'stage'>;

const SOURCE_RANK: Readonly<Record<TimelineKind, number>> = { stage: -1, decision: 0, round: 1, gate: 2, commit: 3, note: 4, agent: 5, worktree: 6 };

/** A note of the app's notes store anchored to the spec (or one of its claims or tasks), as the server passes it. */
export interface TimelineNote {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  /** ISO 8601. */
  readonly created: string;
}

/** A held lock on one of the spec's claims, as the server reads it from the lock sources. */
export interface TimelineSession {
  readonly claim: string;
  readonly session: string;
  /** ISO 8601. */
  readonly since: string;
}

/** The files' input plus the server's joins; both default to none, so a files-only timeline is unchanged. */
export interface TimelineActivityInput extends TimelineInput {
  readonly notes?: readonly TimelineNote[];
  readonly sessions?: readonly TimelineSession[];
}

/** An entry before ordering, with its id base (made unique after sorting). */
interface Draft {
  readonly kind: RecordedKind;
  readonly ts: string;
  readonly title: string;
  readonly ref: string;
  readonly body?: string;
  readonly actor?: string;
  readonly goalLock?: true;
  readonly question?: DecisionQuestion;
  readonly running?: true;
}

/** An entry placed for sorting: the instant it sorts at, its source rank and its position within the source. */
interface Placed {
  readonly entry: TimelineEntry;
  readonly at: number;
  readonly seq: number;
}

export function buildTimeline(input: TimelineActivityInput): TimelineEntry[] {
  const drafts: Draft[] = [
    ...decisionsOf(input.files.texts.context),
    ...roundsOf(input.files.texts.rounds),
    ...gatesOf(input.files),
    ...commitsOf(input.commits),
    ...notesOf(input.notes ?? []),
    ...sessionsOf(input.sessions ?? []),
  ];
  const recorded = input.files.texts.events;
  const events = input.events ?? (recorded === undefined ? undefined : parseEvents(recorded).events);
  const stages = deriveStages(input.files, events, input.codeReview);
  const instants = stageInstants(stages);
  const placed: Placed[] = [
    ...drafts.map((draft, seq) => ({ entry: recordedEntry(draft), at: Date.parse(draft.ts), seq })),
    // Oldest first from deriveStages; the negative position lists the later transition first within an instant.
    ...stages.map((entry, i) => ({ entry, at: instants[i] ?? Number.NaN, seq: -i })),
  ];
  const worktree = worktreeEntry(input.worktree);
  if (worktree) placed.push({ entry: worktree, at: worktreeInstant(worktree, placed), seq: 0 });
  const ordered = placed.sort(
    (a, b) => compareInstant(a.at, b.at, a.entry.ts, b.entry.ts) || SOURCE_RANK[a.entry.kind] - SOURCE_RANK[b.entry.kind] || a.seq - b.seq,
  );

  const seen = new Map<string, number>();
  return ordered.map(({ entry }) => {
    const base = `${entry.kind}-${fragmentSafe(entry.ref ?? '')}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return withId(entry, n === 1 ? base : `${base}-${n}`);
  });
}

function recordedEntry(draft: Draft): TimelineEntry {
  return {
    ts: draft.ts,
    kind: draft.kind,
    derived: false,
    title: draft.title,
    ...(draft.body === undefined ? {} : { body: draft.body }),
    ref: draft.ref,
    ...(draft.actor === undefined ? {} : { actor: draft.actor }),
    ...(draft.goalLock ? { goalLock: true } : {}),
    ...(draft.question === undefined ? {} : { question: draft.question }),
    ...(draft.running ? { running: true } : {}),
  };
}

/** The entry with its id, keys in one fixed order for every kind (the golden snapshots compare bytes). */
function withId(entry: TimelineEntry, id: string): TimelineEntry {
  const { ts, kind, derived, title, body, ref, actor, goalLock, from, to, command, undated, question, running, worktree } = entry;
  return {
    ts,
    kind,
    derived,
    title,
    ...(body === undefined ? {} : { body }),
    ...(ref === undefined ? {} : { ref }),
    id,
    ...(actor === undefined ? {} : { actor }),
    ...(goalLock ? { goalLock: true } : {}),
    ...(to === undefined ? {} : { from: from ?? null, to }),
    ...(command === undefined ? {} : { command }),
    ...(undated ? { undated: true } : {}),
    ...(question === undefined ? {} : { question }),
    ...(running ? { running: true } : {}),
    ...(worktree === undefined ? {} : { worktree }),
  };
}

/** Newest first; a parsed instant before an unparsed one; unparsed ones newest-first by string. */
function compareInstant(a: number, b: number, rawA: string, rawB: string): number {
  const okA = Number.isFinite(a);
  const okB = Number.isFinite(b);
  if (okA && okB) return b - a;
  if (okA !== okB) return okA ? -1 : 1;
  return rawA < rawB ? 1 : rawA > rawB ? -1 : 0;
}

function fragmentSafe(ref: string): string {
  return ref.replace(/[^A-Za-z0-9._-]+/g, '_');
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

// ─── context.md ──────────────────────────────────────────────────────────────────────────────────────────────────

// GOAL_HEADER and ROUND_HEADER live in derived-stages.ts, which dates the creation from the same headers.
const FROM_LINE = /^-\s+From:\s*(.+?)\s*$/;

function bodyOf(lines: readonly string[]): string | undefined {
  const body = lines.join('\n').trim();
  return body === '' ? undefined : body;
}

/**
 * One decision per `### Q` block under a `## Round N — …, <ts>` header, timed by that header; the `## Goal —
 * confirmed <ts>` block is one decision with `goalLock`. Q blocks under any other `##` header (`## Still open`) or
 * under a round header without a time are not events and are skipped. Prose rounds without Q blocks yield nothing.
 */
function decisionsOf(text: string | undefined): Draft[] {
  if (text === undefined) return [];
  const out: Draft[] = [];
  let round: { n: string; ts: string | null; ordinal: number } | null = null;
  for (const block of blocksOf(text)) {
    if (block.header.startsWith('## ')) {
      round = null;
      const goal = GOAL_HEADER.exec(block.header);
      if (goal?.[1]) {
        const body = bodyOf(block.lines);
        out.push({ kind: 'decision', ts: goal[1], title: 'Goal confirmed', ref: 'goal', goalLock: true, ...(body ? { body } : {}) });
        continue;
      }
      const header = ROUND_HEADER.exec(block.header);
      const n = header?.[1] ?? /^## Round (\d+)\b/.exec(block.header)?.[1];
      if (n !== undefined) round = { n, ts: header?.[2] ?? null, ordinal: 0 };
      continue;
    }
    const q = QUESTION_HEADER.exec(block.header);
    if (!q || !round) continue;
    round.ordinal += 1;
    if (round.ts === null) continue;
    const body = bodyOf(block.lines);
    const actor = block.lines.map((l) => FROM_LINE.exec(l)?.[1]).find((v) => v !== undefined);
    out.push({
      kind: 'decision',
      ts: round.ts,
      title: oneLine(q[2] ?? ''),
      ref: `R${round.n}.Q${q[1] === undefined || q[1] === '' ? String(round.ordinal) : q[1]}`,
      ...(body ? { body } : {}),
      ...(actor ? { actor } : {}),
      question: parseQuestion(block, q[1] ?? ''),
    });
  }
  return out;
}

// ─── rounds.jsonl ────────────────────────────────────────────────────────────────────────────────────────────────

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/** A rounds.jsonl line that carries a `round` number and a string `ts`; every other field unchecked. */
export type RoundLine = Record<string, unknown> & { readonly round: number; readonly ts: string };

/**
 * The line reader of rounds.jsonl, shared with frames.ts: every parseable object line with a `round` number and a
 * string `ts`, in file order. Blank and malformed lines are skipped.
 */
export function roundLines(text: string | undefined): RoundLine[] {
  if (text === undefined) return [];
  const out: RoundLine[] = [];
  for (const raw of text.split(/\r?\n/)) {
    if (raw.trim() === '') continue;
    let line: unknown;
    try {
      line = JSON.parse(raw);
    } catch {
      continue;
    }
    if (isRecord(line) && typeof line.round === 'number' && typeof line.ts === 'string') out.push(line as RoundLine);
  }
  return out;
}

/** One round entry per parseable line with a `round` number and a `ts`; blank and malformed lines are skipped. */
function roundsOf(text: string | undefined): Draft[] {
  const out: Draft[] = [];
  for (const line of roundLines(text)) {
    const dispatched = strings(line.dispatched);
    const closed = strings(isRecord(line.claims) ? line.claims.closed_this_round : undefined);
    const tasks = Array.isArray(line.tasks) ? (line.tasks as unknown[]).filter(isRecord) : [];
    const held = tasks.filter((t) => t.state === 'held').length;
    const builders = [
      ...new Set(
        tasks
          .filter((t) => typeof t.id === 'string' && dispatched.includes(t.id))
          .map((t) => t.builder)
          .filter((b): b is string => typeof b === 'string' && b !== ''),
      ),
    ];
    const stop = typeof line.stop === 'string' && line.stop !== '' ? line.stop : undefined;

    const title = [
      `Round ${line.round}`,
      `${dispatched.length} dispatched`,
      `${closed.length} closed`,
      ...(stop ? [`stopped: ${oneLine(stop)}`] : []),
    ].join(' · ');
    const body = [
      `- Dispatched: ${dispatched.length ? dispatched.join(', ') : 'none'}`,
      `- Closed this round: ${closed.length ? closed.join(', ') : 'none'}`,
      `- Held: ${held}`,
      ...(stop ? [`- Stop: ${stop}`] : []),
    ].join('\n');
    out.push({
      kind: 'round',
      ts: line.ts,
      title,
      ref: String(line.round),
      body,
      ...(builders.length ? { actor: builders.join(', ') } : {}),
    });
  }
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

// ─── .gates/ ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** One gate entry per mark file whose JSON carries a string `at`; a missing or malformed mark yields nothing. */
function gatesOf(files: SpecFiles): Draft[] {
  const out: Draft[] = [];
  const marks = [
    { text: files.texts.gateReviewed, ref: 'reviewed', title: 'Reviewed' },
    { text: files.texts.gateCodeReviewed, ref: 'code-reviewed', title: 'Code reviewed' },
  ] as const;
  for (const mark of marks) {
    if (mark.text === undefined) continue;
    let json: unknown;
    try {
      json = JSON.parse(mark.text);
    } catch {
      continue;
    }
    if (!isRecord(json) || typeof json.at !== 'string') continue;
    const body = gateBody(json);
    out.push({ kind: 'gate', ts: json.at, title: mark.title, ref: mark.ref, ...(body ? { body } : {}) });
  }
  return out;
}

function gateBody(mark: Record<string, unknown>): string | undefined {
  const lines: string[] = [];
  if (isRecord(mark.files)) lines.push(`- Files: ${Object.keys(mark.files).join(', ')}`);
  if (typeof mark.head === 'string') lines.push(`- Head: \`${mark.head}\``);
  if (typeof mark.branch === 'string') lines.push(`- Branch: \`${mark.branch}\``);
  if (typeof mark.note === 'string') lines.push(`- Note: ${mark.note}`);
  return lines.length ? lines.join('\n') : undefined;
}

// ─── commits ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** One entry per commit the server passed in; the subject's first line is the title. */
function commitsOf(commits: readonly CommitRecord[]): Draft[] {
  return commits.map((c) => ({
    kind: 'commit',
    ts: c.ts,
    title: oneLine(c.subject.split(/\r?\n/, 1)[0] ?? '') || c.sha.slice(0, 7),
    ref: c.sha,
  }));
}

// ─── the server's joins: notes and lock sessions ─────────────────────────────────────────────────────────────────

/** One entry per note: titled by its title, else its body's first line; the body is the note's Markdown. */
function notesOf(notes: readonly TimelineNote[]): Draft[] {
  return notes.map((note) => {
    const title = oneLine(note.title) || oneLine(note.body.split(/\r?\n/, 1)[0] ?? '');
    return { kind: 'note', ts: note.created, title, ref: note.id, ...(note.body.trim() === '' ? {} : { body: note.body.trim() }) };
  });
}

/** One running agent entry per held lock: the claim it works on, the session as the actor. */
function sessionsOf(sessions: readonly TimelineSession[]): Draft[] {
  return sessions.map((s) => ({ kind: 'agent', ts: s.since, title: s.claim, ref: s.claim, actor: s.session, running: true }));
}

// ─── the server's join: the spec's worktree (spec 027, T14, ISC-175.1) ───────────────────────────────────────────

/**
 * The derived `worktree` entry, no body (the web shows no disclosure for it): `merged` at the merge commit's date with
 * its short sha, `removed` undated; null for no input or an open branch. Merged wins when both are given: the merge is
 * the fact, the worktree's removal its cleanup. The title is neutral English; the web words it from `worktree.state`.
 */
function worktreeEntry(input: TimelineWorktreeInput | null | undefined): TimelineEntry | null {
  if (!input) return null;
  const branch = input.branch ?? null;
  const path = input.path ?? null;
  if (input.merged) {
    const commit = input.merged.commit ? input.merged.commit.slice(0, 7) : null;
    return {
      ts: input.merged.at,
      kind: 'worktree',
      derived: true,
      title: branch ? `Merged into main · ${branch}` : 'Merged into main',
      ref: 'merged',
      actor: null,
      worktree: { state: 'merged', branch, path, commit },
    };
  }
  if (!input.removed) return null;
  return {
    ts: '',
    kind: 'worktree',
    derived: true,
    title: path ? `Worktree removed · ${path}` : 'Worktree removed',
    ref: 'removed',
    actor: null,
    undated: true,
    worktree: { state: 'removed', branch, path, commit: null },
  };
}

/** `merged`: its own instant. `removed`: the newest instant placed so far, NaN when none (the undated rule). */
function worktreeInstant(entry: TimelineEntry, placed: readonly Placed[]): number {
  if (entry.undated !== true) return Date.parse(entry.ts);
  let newest = Number.NaN;
  for (const p of placed) if (Number.isFinite(p.at) && (Number.isNaN(newest) || p.at > newest)) newest = p.at;
  return newest;
}

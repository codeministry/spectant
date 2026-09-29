// The task line grammar in full (T23, ISC-82): flags, lane, state, edges, paths, struck bullets, plus the probe
// mapping table, and the round state and filter counts of the Tasks tab.
//
//   - [ ] T<n> · <claim ID> · [ [P] · ][ [seam] · ]<lane> — <text> [(after: T<a>, T<b>)] · <paths>
//   - ~~T<n> · <claim ID> · … — <text> · <paths>~~ — <note>
//
// - The box is `[ ]`, `[x]` or `[X]`; indent is allowed. Every such line with a `T<n>` id is a task row, malformed or
//   not, so the box count always equals archive.ts's. A struck bullet has no box and counts in no fraction.
// - The head, up to the first ` — ` outside code spans, is ` · `-separated: the claim ID (the forms claims.ts takes),
//   the flags `[P]` and `[seam]` in either order, then the lane token. The lane is checked against the constitution's
//   `## Lanes` table when one is given; a token outside it is kept with a diagnostic, and `operator` is always valid.
// - `(after: …)` may stand anywhere in the text; it is removed from the display text. Ranges `T3–T5` expand.
// - The paths follow the last ` · ` outside code spans, split on `, ` outside code spans and parentheses: a code span
//   (or a bare token with a `/` or `.`) is a path, a parenthesised item such as `(probe only)` is the path note. A tail
//   with anything else is not a path column, and the text keeps everything.
// - Fenced lines are skipped. Headers, prose, table rows and non-task bullets are no tasks.
// - `## Probe Mapping`: the table `Task | Claim | Probe`, first cell one or more task ids or ranges.
// - The Tasks tab's status comes from the newest rounds.jsonl result card of the same task (frames.ts, same id and
//   text), else from the box. A checked box outranks an unfinished round state.
//
// Pure: text in, model out. No file system, no Bun API; never throws.
import type { Diagnostic } from './diagnostics.ts';
import type { CardState, FrameCard, ProbeMappingRow, TaskCount, TaskParseInput, TaskRow, TaskStatus, TasksTab } from './files.ts';
import { buildFrames } from './frames.ts';

const OPERATOR = 'operator';

/** The claim ID forms of claims.ts: ISC-N (dotted splits included), domain-prefixed (H-AVAIL), short (C1, EQ-12). */
const CLAIM_ID = /^(?:ISC-[\w.-]+|[A-Z]{1,6}-[A-Z0-9][\w.-]*|[A-Z]{1,4}-?\d+(?:\.\d+)*)$/;
export const BOX_LINE = /^\s*- \[([ xX])\]\s*(T\d+)\b(.*)$/;
/** A struck bullet: `- ~~T<n> …~~`, then an optional ` — <note>`. The closing `~~` is the one before the note. */
const STRUCK_LINE = /^\s*- ~~(T\d+)\b(.*?)~~(?:\s*[—–-]\s*(.*?))?\s*$/;
const FENCE = /^\s*(```|~~~)/;
const AFTER = /\(after:\s*([^)]*)\)/gi;
const TASK_ID = /^T\d+$/;
const TASK_RANGE = /^T(\d+)\s*[–—-]\s*T?(\d+)$/;
const FLAG = /^\[[^\]]*\]$/;
const LANE_TOKEN = /^[\w-]+$/;

const STATUS_ORDER: readonly TaskStatus[] = ['open', 'dispatched', 'held', 'question', 'concerns', 'fail', 'done', 'closed', 'struck'];
const LANDED: ReadonlySet<TaskStatus> = new Set(['done', 'closed']);

/** The frame card states as the Tasks tab reads them; an operator step still open is `open`. */
const CARD_STATUS: Readonly<Record<CardState, TaskStatus | null>> = {
  waiting: 'held',
  dispatched: 'dispatched',
  running: 'dispatched',
  question: 'question',
  concerns: 'concerns',
  fail: 'fail',
  done: 'done',
  closed: 'closed',
  operatorOpen: 'open',
  operatorDone: 'done',
  absent: null,
};

// ── code spans ────────────────────────────────────────────────────────────────────────────────────────────────────

/** Per character: inside a code span (backticks included). A backtick run without its closing run is literal. */
function codeMask(s: string): boolean[] {
  const mask = new Array<boolean>(s.length).fill(false);
  let i = 0;
  while (i < s.length) {
    if (s[i] !== '`') {
      i++;
      continue;
    }
    let n = 0;
    while (s[i + n] === '`') n++;
    const run = '`'.repeat(n);
    let close = s.indexOf(run, i + n);
    while (close >= 0 && s[close + n] === '`') close = s.indexOf(run, close + n + 1);
    if (close < 0) {
      i += n;
      continue;
    }
    for (let k = i; k < close + n; k++) mask[k] = true;
    i = close + n;
  }
  return mask;
}

/** Every start index of `sep` in `s` outside code spans. */
function indexesOutside(s: string, sep: string, mask = codeMask(s)): number[] {
  const out: number[] = [];
  for (let i = s.indexOf(sep); i >= 0; i = s.indexOf(sep, i + 1)) if (!mask[i]) out.push(i);
  return out;
}

/** `s` split on `, ` outside code spans and parentheses. */
function splitItems(s: string): string[] {
  const mask = codeMask(s);
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    if (mask[i]) continue;
    if (s[i] === '(') depth++;
    else if (s[i] === ')') depth = Math.max(0, depth - 1);
    else if (depth === 0 && s[i] === ',' && s[i + 1] === ' ') {
      out.push(s.slice(start, i).trim());
      start = i + 2;
    }
  }
  out.push(s.slice(start).trim());
  return out.filter((item) => item !== '');
}

/** `(after: …)` groups outside code spans: their ids, and the text without them. */
function takeEdges(s: string): { text: string; tokens: string[] } {
  const mask = codeMask(s);
  const tokens: string[] = [];
  let text = '';
  let last = 0;
  for (const m of s.matchAll(AFTER)) {
    if (mask[m.index]) continue;
    tokens.push(...(m[1] ?? '').split(/\s*,\s*/).map((t) => t.trim()).filter((t) => t !== ''));
    text += s.slice(last, m.index);
    last = m.index + m[0].length;
  }
  text += s.slice(last);
  return { text: text.replace(/\s{2,}/g, ' ').trim(), tokens };
}

/** Task ids of a list cell or edge group, `T3–T5` expanded; tokens that are neither come back as `bad`. */
function taskIds(tokens: readonly string[]): { ids: string[]; bad: string[] } {
  const ids: string[] = [];
  const bad: string[] = [];
  for (const token of tokens) {
    const range = TASK_RANGE.exec(token);
    if (range) {
      const from = Number(range[1]);
      const to = Number(range[2]);
      if (to >= from && to - from < 1000) for (let n = from; n <= to; n++) ids.push(`T${n}`);
      else bad.push(token);
    } else if (TASK_ID.test(token)) ids.push(token);
    else bad.push(token);
  }
  return { ids, bad };
}

/** The path column after the last ` · ` outside code spans; null when the tail is not one. */
function pathColumn(tail: string): { paths: string[]; note: string | null } | null {
  const paths: string[] = [];
  const notes: string[] = [];
  for (const item of splitItems(tail)) {
    const span = /^(`+)(.+?)\1$/.exec(item);
    if (span && !(span[2] ?? '').includes('`')) paths.push((span[2] ?? '').trim());
    else if (/^\(.*\)$/.test(item)) notes.push(item.slice(1, -1).trim());
    else if (/^[^\s`]*[/.][^\s`]*$/.test(item)) paths.push(item);
    else return null;
  }
  return paths.length + notes.length === 0 ? null : { paths, note: notes.length === 0 ? null : notes.join(', ') };
}

// ── the constitution ──────────────────────────────────────────────────────────────────────────────────────────────

/** Table cells of a markdown row, split on unescaped pipes, `\|` unescaped, trimmed. */
function cells(row: string): string[] {
  const body = row.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '');
  return body.split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, '|').trim());
}

const SEPARATOR_ROW = /^\|?[\s:|-]+$/;

/** The lines of a level-two section, 1-based line numbers kept; empty when the heading is absent. */
function section(lines: readonly string[], heading: RegExp): Array<{ text: string; line: number }> {
  const start = lines.findIndex((l) => heading.test(l));
  if (start < 0) return [];
  const out: Array<{ text: string; line: number }> = [];
  for (let i = start + 1; i < lines.length && !/^##\s+(?!#)/.test(lines[i] ?? ''); i++) out.push({ text: lines[i] ?? '', line: i + 1 });
  return out;
}

/** The first column of the constitution's `## Lanes` table, in table order, backticks stripped. */
export function lanesOf(constitution: string): string[] {
  const rows = section(constitution.replace(/\r\n?/g, '\n').split('\n'), /^## Lanes\s*$/).filter((l) => l.text.trim().startsWith('|'));
  return rows
    .slice(1)
    .filter((row) => !SEPARATOR_ROW.test(row.text.trim()))
    .map((row) => (cells(row.text)[0] ?? '').replace(/`/g, '').trim())
    .filter((name) => name !== '');
}

// ── task lines ────────────────────────────────────────────────────────────────────────────────────────────────────

interface Parsed {
  readonly claim: string;
  readonly parallel: boolean;
  readonly seam: boolean;
  readonly lane: string;
  readonly text: string;
  readonly edgeTokens: readonly string[];
  readonly paths: readonly string[];
  readonly pathNote: string | null;
}

/** Everything after `T<n>`: head segments, text, edges, paths. Findings go to `warn`. */
function parseBody(rest: string, warn: (code: string, message: string) => void): Parsed {
  const body = rest.replace(/^\s*·\s*/, '');
  const mask = codeMask(body);
  const dash = indexesOutside(body, ' — ', mask)[0];
  let segments: string[];
  let textPart: string;
  if (dash === undefined) {
    warn('task-malformed', 'The task line has no ` — ` between its head (claim, flags, lane) and its text.');
    const parts = body.split(' · ');
    const first = (parts[0] ?? '').trim();
    segments = CLAIM_ID.test(first) ? [first] : [];
    textPart = CLAIM_ID.test(first) ? parts.slice(1).join(' · ') : body;
  } else {
    segments = body.slice(0, dash).split('·').map((s) => s.trim()).filter((s) => s !== '');
    textPart = body.slice(dash + 3);
  }

  let claim = '';
  if (segments.length > 0 && CLAIM_ID.test(segments[0] ?? '')) claim = segments.shift() ?? '';
  else if (dash !== undefined) {
    warn('task-no-claim', `The task line names no claim ID: "${segments[0] ?? ''}".`);
    // The claim's place holds something else; a lone segment is the lane.
    if (segments.length > 1) segments.shift();
  }
  let parallel = false;
  let seam = false;
  let lane = '';
  const last = segments[segments.length - 1];
  if (last !== undefined && !FLAG.test(last) && LANE_TOKEN.test(last)) lane = segments.pop() ?? '';
  else if (dash !== undefined) warn('task-no-lane', 'The task line has no lane token before ` — `.');
  for (const seg of segments) {
    if (seg === '[P]') parallel = true;
    else if (seg === '[seam]') seam = true;
    else if (FLAG.test(seg)) warn('task-flag-unknown', `Unknown task flag ${seg}; the flags are [P] and [seam].`);
    else warn('task-malformed', `Unexpected head segment "${seg}" between the claim and the lane.`);
  }

  const { text: noEdges, tokens } = takeEdges(textPart.trim());
  let text = noEdges;
  let paths: string[] = [];
  let pathNote: string | null = null;
  const sep = indexesOutside(noEdges, ' · ').at(-1);
  if (sep !== undefined) {
    const column = pathColumn(noEdges.slice(sep + 3).trim());
    if (column !== null) {
      text = noEdges.slice(0, sep).trim();
      paths = column.paths;
      pathNote = column.note;
    }
  }
  return { claim, parallel, seam, lane, text, edgeTokens: tokens, paths, pathNote };
}

// ── rounds ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** A round card's text as the task line's display text: without `(after: …)` and without a trailing path note. */
function comparable(text: string): string {
  const { text: noEdges } = takeEdges(text);
  const sep = indexesOutside(noEdges, ' · ').at(-1);
  if (sep !== undefined && pathColumn(noEdges.slice(sep + 3).trim()) !== null) return noEdges.slice(0, sep).trim();
  return noEdges;
}

/** The newest result card per task id, with its round. */
function newestCards(rounds: string | undefined): Map<string, { card: FrameCard; round: number }> {
  const out = new Map<string, { card: FrameCard; round: number }>();
  if (rounds === undefined) return out;
  for (const frame of buildFrames({ folder: '', texts: { rounds } })) {
    if (frame.kind !== 'result' || frame.round === null) continue;
    for (const card of frame.cards) out.set(card.task, { card, round: frame.round });
  }
  return out;
}

// ── the model ─────────────────────────────────────────────────────────────────────────────────────────────────────

export function parseTaskLines(input: TaskParseInput): TasksTab {
  const lines = input.tasks.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
  const diagnostics: Diagnostic[] = [];
  const cards = newestCards(input.rounds);
  const tableLanes = input.constitution === undefined ? [] : lanesOf(input.constitution);

  interface Draft extends Omit<TaskRow, 'edges'> {
    readonly edgeTokens: readonly string[];
  }
  const drafts: Draft[] = [];
  const seen = new Set<string>();
  let fenced = false;

  lines.forEach((raw, index) => {
    const line = index + 1;
    if (FENCE.test(raw)) {
      fenced = !fenced;
      return;
    }
    if (fenced) return;
    const box = BOX_LINE.exec(raw);
    const struck = box ? null : STRUCK_LINE.exec(raw);
    if (!box && !struck) return;
    const id = (box ? box[2] : struck?.[1]) ?? '';
    const warn = (code: string, message: string): void => {
      diagnostics.push({ severity: 'warning', code, message: `${id}: ${message}`, line });
    };
    const parsed = parseBody((box ? box[3] : struck?.[2]) ?? '', warn);
    if (seen.has(id)) warn('task-duplicate-id', `The id ${id} is used by an earlier task line.`);
    seen.add(id);
    if (parsed.lane !== '' && parsed.lane !== OPERATOR && tableLanes.length > 0 && !tableLanes.includes(parsed.lane)) {
      warn('task-lane-unknown', `The lane "${parsed.lane}" is not in the constitution's lane table (${tableLanes.join(', ')}).`);
    }

    const state = struck ? 'struck' : box?.[1] === ' ' ? 'open' : 'done';
    let status: TaskStatus = state;
    let round: number | null = null;
    let builder: string | null = null;
    let reason: string | null = null;
    const hit = struck ? undefined : cards.get(id);
    const fromRound = hit ? CARD_STATUS[hit.card.state] : null;
    if (hit && fromRound !== null && comparable(hit.card.text) === parsed.text && !(state === 'done' && !LANDED.has(fromRound))) {
      status = fromRound;
      round = hit.round;
      builder = hit.card.builder ?? null;
      reason = hit.card.reason ?? null;
    }

    drafts.push({
      id,
      claim: parsed.claim,
      flags: { parallel: parsed.parallel, seam: parsed.seam },
      lane: parsed.lane,
      state,
      edgeTokens: parsed.edgeTokens,
      paths: parsed.paths,
      text: parsed.text,
      line,
      status,
      round,
      builder,
      reason,
      note: struck ? (struck[3] ?? '').trim() || null : null,
      pathNote: parsed.pathNote,
    });
  });

  // Edges resolve against the whole list, so a task may name one further down.
  const tasks: TaskRow[] = drafts.map(({ edgeTokens, ...draft }) => {
    const { ids, bad } = taskIds(edgeTokens);
    const at = (code: string, message: string): void => {
      diagnostics.push({ severity: 'warning', code, message: `${draft.id}: ${message}`, line: draft.line });
    };
    if (bad.length > 0) at('task-edge-not-task', `(after: …) names ${bad.join(', ')}, which are no task ids; edges name tasks, not claims.`);
    const unknown = ids.filter((e) => !seen.has(e));
    if (unknown.length > 0) at('task-edge-unknown', `(after: …) names ${unknown.join(', ')}, which no task line carries.`);
    return { ...draft, edges: ids };
  });

  const probeMapping = parseMapping(lines, tasks, diagnostics);
  diagnostics.sort((a, b) => (a.line ?? 0) - (b.line ?? 0));

  const boxes = tasks.filter((t) => t.state !== 'struck');
  return {
    tasks,
    probeMapping,
    counts: {
      rows: tasks.length,
      boxes: { landed: boxes.filter((t) => t.state === 'done').length, total: boxes.length },
      byLane: laneCounts(tasks, tableLanes),
      byStatus: STATUS_ORDER.map((name) => ({ name, count: tasks.filter((t) => t.status === name).length })).filter((c) => c.count > 0),
    },
    diagnostics,
  };
}

/** Constitution lanes in table order, then lanes only tasks.md names (first seen), `operator` last; rows only. */
function laneCounts(tasks: readonly TaskRow[], tableLanes: readonly string[]): TaskCount[] {
  const order = tableLanes.filter((l) => l !== OPERATOR);
  for (const t of tasks) if (t.lane !== '' && t.lane !== OPERATOR && !order.includes(t.lane)) order.push(t.lane);
  order.push(OPERATOR);
  return order.map((name) => ({ name, count: tasks.filter((t) => t.lane === name).length })).filter((c) => c.count > 0);
}

/** `## Probe Mapping`: one row per table line, plus the diagnostics that tie it to the task list. */
function parseMapping(lines: readonly string[], tasks: readonly TaskRow[], diagnostics: Diagnostic[]): ProbeMappingRow[] {
  const body = section(lines, /^##\s+Probe Mapping\b/i);
  if (body.length === 0) return [];
  const table = body.filter((l) => l.text.trim().startsWith('|'));
  const warn = (code: string, message: string, line: number): void => {
    diagnostics.push({ severity: 'warning', code, message, line });
  };
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const rows: ProbeMappingRow[] = [];
  for (const row of table) {
    const [first = '', claim = '', ...rest] = cells(row.text);
    if (SEPARATOR_ROW.test(row.text.trim()) || /^tasks?$/i.test(first)) continue;
    const { ids, bad } = taskIds(first.replace(/`/g, '').split(/\s*,\s*/).filter((t) => t !== ''));
    if (bad.length > 0) warn('mapping-bad-task', `Probe mapping: ${bad.join(', ')} is no task id or range.`, row.line);
    const id = claim.replace(/`/g, '').trim();
    rows.push({ tasks: ids, claim: id, probe: rest.join(' | ').trim(), line: row.line });
    for (const t of ids) {
      const task = byId.get(t);
      if (task === undefined) warn('mapping-unknown-task', `Probe mapping names ${t}, which no task line carries.`, row.line);
      else if (task.state === 'struck') warn('mapping-struck-task', `Probe mapping names ${t}, which is struck.`, row.line);
      else if (task.claim !== '' && task.claim !== id) warn('mapping-claim-mismatch', `Probe mapping puts ${t} under ${id}; its task line names ${task.claim}.`, row.line);
    }
  }
  const mapped = new Set(rows.flatMap((r) => r.tasks));
  for (const t of tasks) {
    if (t.state !== 'struck' && !mapped.has(t.id)) warn('mapping-missing', `${t.id} has no row in the probe mapping.`, t.line);
  }
  return rows;
}

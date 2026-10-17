// The feature backlog (spec 036, ISC-190 to ISC-191.1): `specs/backlog.md`, one line `- F<n> · P<1-4>` per feature
// block of the master, read into a rank and a priority per feature. The rank is the order, the priority an attribute
// beside it; the priority orders nothing. The file is the user's and may be kept by hand: the app reads it on every
// load and writes it only through the backlog route (`server/src/writes.ts`, `writeBacklog`), never the master.
//
// Reading (`parseBacklog`), in order:
// 1. A line `- F<n>` or `- F<n> · <priority>` is an entry; every other line (a heading, a blank line, prose, a list
//    line naming no feature id) is skipped, and so is everything inside an HTML comment `<!-- … -->`.
// 2. The entries the master knows, each feature once, are ranked 1, 2, … in file order: the line's position among
//    them is the feature's global rank. A feature the file does not list stands behind every listed one, in master
//    order. A missing priority is `P3`.
// 3. A line naming no feature block of the master, a second line of one feature and a priority other than `P1` to
//    `P4` are one warning each (`BacklogDiagnosticCode`, ISC-190.1): the first line of a feature counts, an invalid
//    priority reads as `P3`, and reading goes on.
//
// Writing (`planBacklogMove`, `planBacklogPriority`, ISC-191 and ISC-191.1) is planned in memory, as
// `transition.ts` plans a stage move: the whole new text plus the one event line for `specs/backlog.events.jsonl`, or
// the reason the write is refused, with neither text nor event. The new text is the full list in rank order with each
// feature's effective priority (`renderBacklog`): the first write materializes every feature of the master, and the
// unknown, repeated and invalid lines drop out. What stands before the first entry line (a heading, a comment) is kept;
// any other line between or after the entries is not. A move takes a feature before another feature of its own
// milestone, or behind the last one (`before: null`), and reorders only that milestone's features among the ranks they
// already hold, so no feature of another milestone changes its rank. A feature's milestone is its `Milestone:` line in
// the master, never the backlog's to change. `server/src/writes.ts` checks the hash and writes; nothing here reads a lock.
//
// Browser-safe and pure: no file system, no Node or Bun API. The planning tree (`planning.ts`) and the server's write
// path call it over text the caller read.
import { parseActor } from './actor.ts';
import { parseClaims } from './claims.ts';
import type { Diagnostic } from './diagnostics.ts';
import type { BacklogDiagnosticCode, Priority } from './files.ts';
import { parseMilestones } from './milestones.ts';

/** A feature's priority in the backlog: the four values of a spec's `priority:` (FORMAT.md), `P3` when absent. */
export type BacklogPriority = Priority;

/** The four priorities, highest first. */
export const BACKLOG_PRIORITIES: readonly BacklogPriority[] = ['P1', 'P2', 'P3', 'P4'];

/** The priority of a feature whose line names none, or that the file does not list. */
export const DEFAULT_BACKLOG_PRIORITY: BacklogPriority = 'P3';

/** The backlog file relative to the repository root, as a diagnostic names it. */
export const BACKLOG_FILE = 'specs/backlog.md';

/** The backlog's event log relative to the repository root: one JSON line per accepted write. */
export const BACKLOG_EVENTS_FILE = 'specs/backlog.events.jsonl';

/** The heading a backlog gets when the first write creates the file. */
const NEW_PREAMBLE = '# Backlog\n';

/** One feature block of the master with its place in the backlog. */
export interface BacklogEntry {
  /** `F8`, as the master's feature heading names it. */
  readonly feature: string;
  /** 1-based and global: listed features in file order, then the unlisted ones in master order. */
  readonly rank: number;
  readonly priority: BacklogPriority;
  /** The 1-based line of the entry in the file; null for a feature the file does not list. */
  readonly line: number | null;
}

export interface BacklogReading {
  /** Every feature the caller passed, exactly once, in rank order. */
  readonly entries: readonly BacklogEntry[];
  readonly diagnostics: readonly Diagnostic[];
}

/** An entry line: a list marker, a feature id, and an optional `·` with the priority after it. */
const ENTRY = /^\s*[-*]\s+(F\d+(?:\.\d+)?)(?:\s+·\s*(.*?))?\s*$/;
const COMMENT_OPEN = '<!--';
const COMMENT_CLOSE = '-->';

const isPriority = (value: string): value is BacklogPriority => (BACKLOG_PRIORITIES as readonly string[]).includes(value);

/** A raw entry line as written: the feature, the priority text (null without one) and its 1-based line. */
interface RawEntry {
  readonly feature: string;
  readonly priority: string | null;
  readonly line: number;
}

/** The entry lines of `text` in file order, comments skipped. */
function rawEntries(text: string): RawEntry[] {
  const out: RawEntry[] = [];
  let inComment = false;
  text.split('\n').forEach((raw, i) => {
    let line = raw.replace(/\r$/, '');
    // Strip every comment span on the line; an unclosed one runs on into the next lines.
    let visible = '';
    while (line.length > 0) {
      if (inComment) {
        const close = line.indexOf(COMMENT_CLOSE);
        if (close < 0) return;
        inComment = false;
        line = line.slice(close + COMMENT_CLOSE.length);
        continue;
      }
      const open = line.indexOf(COMMENT_OPEN);
      if (open < 0) {
        visible += line;
        break;
      }
      visible += line.slice(0, open);
      inComment = true;
      line = line.slice(open + COMMENT_OPEN.length);
    }
    const m = ENTRY.exec(visible);
    if (m?.[1] !== undefined) out.push({ feature: m[1], priority: m[2] === undefined || m[2] === '' ? null : m[2], line: i + 1 });
  });
  return out;
}

/**
 * The backlog of the feature blocks `featureIds` (master order) as `text` ranks them; null or empty text ranks every
 * feature in master order with `P3`. Never throws.
 */
export function parseBacklog(text: string | null, featureIds: readonly string[]): BacklogReading {
  const known = new Set(featureIds);
  const seen = new Set<string>();
  const listed: Array<Omit<BacklogEntry, 'rank'>> = [];
  const diagnostics: Diagnostic[] = [];
  const warn = (code: BacklogDiagnosticCode, message: string, line: number, subject: string): void => {
    diagnostics.push({ severity: 'warning', code, message, line, subject });
  };
  for (const raw of rawEntries(text ?? '')) {
    // One finding per line, the first that applies: an unknown or repeated id leaves its priority unread.
    if (!known.has(raw.feature)) {
      warn('backlog-unknown-feature', `${raw.feature} is not a feature block of the master; the line is skipped`, raw.line, raw.feature);
      continue;
    }
    if (seen.has(raw.feature)) {
      warn('backlog-duplicate', `${raw.feature} is listed more than once; its first line counts`, raw.line, raw.feature);
      continue;
    }
    seen.add(raw.feature);
    let priority = DEFAULT_BACKLOG_PRIORITY;
    if (raw.priority !== null) {
      if (isPriority(raw.priority)) priority = raw.priority;
      else warn('backlog-priority', `priority "${raw.priority}" of ${raw.feature} is none of P1 to P4; it reads as P3`, raw.line, raw.priority);
    }
    listed.push({ feature: raw.feature, priority, line: raw.line });
  }
  const unlisted = featureIds.filter((id, i) => !seen.has(id) && featureIds.indexOf(id) === i);
  const entries = [...listed, ...unlisted.map((feature) => ({ feature, priority: DEFAULT_BACKLOG_PRIORITY, line: null }))].map(
    (e, i): BacklogEntry => ({ ...e, rank: i + 1 }),
  );
  return { entries, diagnostics };
}

/** A feature block of the master with the milestone it moves within: its `Milestone:` line, null for the no-milestone group. */
export interface BacklogFeature {
  readonly id: string;
  /** The name of a valid `## Milestones` entry the block's line names; null without a line or for an unknown name. */
  readonly milestone: string | null;
}

/**
 * The feature blocks of `master` in master order, each id once, with its milestone group as the planning tree groups
 * it: a `Milestone:` line naming a valid entry of `## Milestones`, else the no-milestone group.
 */
export function backlogFeatures(master: string): BacklogFeature[] {
  const valid = new Set(parseMilestones(master).milestones.map((m) => m.name));
  const seen = new Set<string>();
  return parseClaims(master).features.flatMap((f): BacklogFeature[] => {
    if (seen.has(f.id)) return [];
    seen.add(f.id);
    return [{ id: f.id, milestone: f.milestone !== null && valid.has(f.milestone) ? f.milestone : null }];
  });
}

/**
 * One line of `specs/backlog.events.jsonl`, keys in this order: when, who (actor grammar, ISC-119), which write, the
 * feature, and the value before and after: the global rank for a `move`, the priority for a `priority`.
 */
export type BacklogEvent =
  | { readonly ts: string; readonly actor: string; readonly kind: 'move'; readonly feature: string; readonly from: number; readonly to: number }
  | { readonly ts: string; readonly actor: string; readonly kind: 'priority'; readonly feature: string; readonly from: BacklogPriority; readonly to: BacklogPriority };

/** A planned backlog write: the whole new `specs/backlog.md` and its event, or why it is refused. */
export type BacklogPlan =
  | {
      readonly ok: true;
      readonly text: string;
      readonly event: BacklogEvent;
      /** `event` serialized as the line to append, newline included. */
      readonly line: string;
    }
  | { readonly ok: false; readonly reason: string };

interface BacklogWriteBase {
  /** The current `specs/backlog.md`; null without the file. */
  readonly text: string | null;
  /** The master's feature blocks, `backlogFeatures(master)`. */
  readonly features: readonly BacklogFeature[];
  readonly feature: string;
  /** The actor id recorded in the event (actor grammar, `actor.ts`); a legacy value is refused. */
  readonly actor: string;
  /** The event's `ts`. */
  readonly now: Date;
}

export interface BacklogMoveInput extends BacklogWriteBase {
  /** The feature of the same milestone to stand before; null to stand behind the milestone's last feature. */
  readonly before: string | null;
}

export interface BacklogPriorityInput extends BacklogWriteBase {
  /** The new priority; anything but `P1` to `P4` is refused. */
  readonly priority: string;
}

/** `specs/backlog.md` for `entries` in their order: `preamble` (a heading, a comment), a blank line, one line each. */
export function renderBacklog(entries: ReadonlyArray<Pick<BacklogEntry, 'feature' | 'priority'>>, preamble: string = NEW_PREAMBLE): string {
  const head = preamble.replace(/\s+$/, '');
  const lines = entries.map((e) => `- ${e.feature} · ${e.priority}`);
  return `${head === '' ? '' : `${head}\n\n`}${lines.join('\n')}\n`;
}

/** The text before the first entry line of `text`, line endings as LF; the new-file heading when there is no text. */
function preambleOf(text: string | null): string {
  if (text === null || text.trim() === '') return NEW_PREAMBLE;
  const first = rawEntries(text)[0];
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  return first === undefined ? lines.join('\n') : lines.slice(0, first.line - 1).join('\n');
}

const groupName = (milestone: string | null): string => milestone ?? 'no milestone';

/** What every write checks first: the actor, the time, and the feature; null when all pass. */
function baseRefusal(input: BacklogWriteBase, known: ReadonlyMap<string, BacklogFeature>): string | null {
  if (!known.has(input.feature)) return `${input.feature} is not a feature block of the master`;
  if (parseActor(input.actor).legacy) return `the actor "${input.actor}" is outside the actor grammar`;
  if (Number.isNaN(input.now.getTime())) return 'the event time is not a valid date';
  return null;
}

function accepted(text: string, event: BacklogEvent): BacklogPlan {
  return { ok: true, text, event, line: `${JSON.stringify(event)}\n` };
}

/** Plans moving `feature` before `before` (same milestone) or behind its milestone's last feature. Pure. */
export function planBacklogMove(input: BacklogMoveInput): BacklogPlan {
  const known = new Map(input.features.map((f) => [f.id, f]));
  const base = baseRefusal(input, known);
  if (base !== null) return { ok: false, reason: base };
  const own = known.get(input.feature);
  if (input.before !== null) {
    const target = known.get(input.before);
    if (target === undefined) return { ok: false, reason: `${input.before} is not a feature block of the master` };
    if (input.before === input.feature) return { ok: false, reason: `${input.feature} cannot move before itself` };
    if (target.milestone !== own?.milestone) {
      const from = own?.milestone ?? null;
      return {
        ok: false,
        reason: `${input.feature} belongs to ${groupName(from)} and ${input.before} to ${groupName(target.milestone)}: a feature moves only within its milestone`,
      };
    }
  }
  const { entries } = parseBacklog(input.text, input.features.map((f) => f.id));
  const moved = entries.find((e) => e.feature === input.feature);
  if (moved === undefined) return { ok: false, reason: `${input.feature} is not a feature block of the master` };
  // The move reorders the milestone's own features within the ranks they hold: every other feature keeps its rank.
  const group = own?.milestone ?? null;
  const slots = entries.flatMap((e, i) => (known.get(e.feature)?.milestone === group ? [i] : []));
  const members = slots.map((i) => entries[i] as BacklogEntry).filter((e) => e !== moved);
  const at = input.before === null ? members.length : members.findIndex((e) => e.feature === input.before);
  const reordered = [...members.slice(0, at), moved, ...members.slice(at)];
  const order = [...entries];
  slots.forEach((slot, k) => {
    order[slot] = reordered[k] as BacklogEntry;
  });
  const to = order.indexOf(moved) + 1;
  if (to === moved.rank) return { ok: false, reason: `${input.feature} already stands there: nothing to move` };
  return accepted(renderBacklog(order, preambleOf(input.text)), { ts: input.now.toISOString(), actor: input.actor, kind: 'move', feature: input.feature, from: moved.rank, to });
}

/** Plans setting `feature`'s priority, the order unchanged. Pure. */
export function planBacklogPriority(input: BacklogPriorityInput): BacklogPlan {
  const known = new Map(input.features.map((f) => [f.id, f]));
  const base = baseRefusal(input, known);
  if (base !== null) return { ok: false, reason: base };
  const priority = input.priority;
  if (!isPriority(priority)) return { ok: false, reason: `priority "${priority}" is none of P1 to P4` };
  const { entries } = parseBacklog(input.text, input.features.map((f) => f.id));
  const entry = entries.find((e) => e.feature === input.feature);
  if (entry === undefined) return { ok: false, reason: `${input.feature} is not a feature block of the master` };
  if (entry.priority === priority) return { ok: false, reason: `${input.feature} already has ${priority}` };
  const order = entries.map((e) => (e === entry ? { ...e, priority } : e));
  return accepted(renderBacklog(order, preambleOf(input.text)), { ts: input.now.toISOString(), actor: input.actor, kind: 'priority', feature: input.feature, from: entry.priority, to: priority });
}

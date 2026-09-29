// The events.jsonl line validator (T16, ISC-32): every line against `{ts, from, to, command, actor}`, the valid lines
// normalised to the stage table's vocabulary, every other line a diagnostic instead of a throw.
//
// Pure over text the caller read: no `node:*`, so the web bundle may import it beside timeline.ts.
//
// One vocabulary (principal decision 2026-09-29): `from` and `to` are the stage names of stage.ts (`plan | tasks |
// review | build | blocked | code-review | close | done`), as timeline and stage use them. The older lifecycle words
// the old skill wrote (ISC-24's `specified → planned → tasked → reviewed → implementing → code-reviewed → done`) are
// read through EVENT_VOCABULARY_ALIASES and normalised, each with a warning naming the old word, so an old file still
// parses and everything downstream sees stage names only. A stage names what the spec waits for, so an old word
// naming what just happened maps to the stage after it: `reviewed` (the review happened) is `build`.
//
// A line is rejected with exactly one diagnostic, the first rule it breaks, in this order:
//
// | code               | rule                                                                                        |
// |--------------------|---------------------------------------------------------------------------------------------|
// | `event-json`       | the line parses as JSON                                                                     |
// | `event-not-object` | it is a JSON object (not an array, a string, a number or null)                              |
// | `event-missing-key`| it has all five keys                                                                        |
// | `event-extra-key`  | it has no other key                                                                         |
// | `event-type`       | every value is a string; `from` may also be null (the creation), `to` never                 |
// | `event-ts`         | `ts` is an ISO 8601 date-time with a zone (`Z` or `±hh:mm`) on a real calendar day          |
// | `event-empty`      | `command` and `actor` are not empty or blank                                                |
// | `event-stage`      | `from` and `to` are stage names, or old words that map to one (`to` never to the creation)  |
// | `event-same-stage` | `from` and `to` differ after mapping; severity `warning` when only the mapping made them equal |
// | `event-null-from`  | (parseEvents) a null `from` stands only on the creation, the file's first event            |
//
// Blank lines are skipped. A file whose lines are all rejected yields no events, and the timeline then derives.
import type { Diagnostic, DiagnosticSeverity } from './diagnostics.ts';
import type { EventLine, EventValidation, StageName } from './files.ts';

/** The stage table's names (stage.ts `Stage`), in lifecycle order: the one vocabulary of `from` and `to`. */
export const EVENT_STAGES: readonly StageName[] = ['plan', 'tasks', 'review', 'build', 'blocked', 'code-review', 'close', 'done'];

/**
 * The older lifecycle words (ISC-24's wording, written by the old skill) and the stage name each is read as; `idea`
 * is the creation (a null `from`). `done` is the same word in both vocabularies and needs no alias.
 *
 * | old word        | stage         | why                                                                          |
 * |-----------------|---------------|------------------------------------------------------------------------------|
 * | `idea`          | null          | the spec did not exist yet: the creation                                     |
 * | `specified`     | `plan`        | spec.md written, the plan is next                                            |
 * | `planned`       | `tasks`       | plan.md written, the tasks are next                                          |
 * | `tasked`        | `review`      | tasks.md written, the review is next                                         |
 * | `reviewed`      | `build`       | the reviewed mark written, the build is next                                 |
 * | `implementing`  | `build`       | building                                                                     |
 * | `code-reviewed` | `close`       | the code-reviewed mark written, the close is next                            |
 */
export const EVENT_VOCABULARY_ALIASES: Readonly<Record<string, StageName | null>> = {
  idea: null,
  specified: 'plan',
  planned: 'tasks',
  tasked: 'review',
  reviewed: 'build',
  implementing: 'build',
  'code-reviewed': 'close',
};

/** The schema's keys, in the order a normalised event carries them. */
const KEYS = ['ts', 'from', 'to', 'command', 'actor'] as const;

/** ISO 8601 date-time with a zone: `2026-03-07T15:30:00Z`, `…15:30Z`, `…15:30:00.277+02:00`. */
const ISO_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|([+-])(\d{2}):(\d{2}))$/;

/** Checks one line of events.jsonl; `lineNo` (1-based) goes into the diagnostics. Never throws. */
export function validateEventLine(line: string, lineNo?: number): EventValidation {
  const at = lineNo === undefined ? {} : { line: lineNo };
  const reject = (code: string, message: string, severity: DiagnosticSeverity = 'error'): EventValidation => ({
    ok: false,
    diagnostic: { severity, code, message, ...at },
  });

  let json: unknown;
  try {
    json = JSON.parse(typeof line === 'string' ? line : '');
  } catch {
    return reject('event-json', 'The line is not valid JSON.');
  }
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    return reject('event-not-object', 'The line is JSON but not an object {ts, from, to, command, actor}.');
  }
  const record = json as Record<string, unknown>;

  const missing = KEYS.filter((k) => !Object.hasOwn(record, k));
  if (missing.length > 0) return reject('event-missing-key', `The event lacks ${names(missing)}.`);
  const extra = Object.keys(record).filter((k) => !(KEYS as readonly string[]).includes(k));
  if (extra.length > 0) return reject('event-extra-key', `The event carries ${names(extra)}, which the schema does not have.`);

  const wrong = KEYS.filter((k) => typeof record[k] !== 'string' && !(k === 'from' && record[k] === null));
  if (wrong.length > 0) return reject('event-type', `${names(wrong)} must be a string${wrong.includes('from') ? ' (`from` may be null)' : ''}.`);
  // Every value is a string now, `from` possibly null.
  const { ts, to, command, actor } = record as Record<(typeof KEYS)[number], string>;
  const fromWord = record.from as string | null;

  if (!isIsoDateTime(ts)) return reject('event-ts', `\`ts\` "${ts}" is not an ISO 8601 date-time with a zone.`);
  const blank = (['command', 'actor'] as const).filter((k) => (k === 'command' ? command : actor).trim() === '');
  if (blank.length > 0) return reject('event-empty', `${names(blank)} must not be empty.`);

  const warnings: Diagnostic[] = [];
  const read = (key: 'from' | 'to', word: string | null): StageName | null | undefined => {
    if (word === null) return null;
    if (EVENT_STAGES.includes(word)) return word;
    if (!Object.hasOwn(EVENT_VOCABULARY_ALIASES, word)) return undefined;
    const stage = EVENT_VOCABULARY_ALIASES[word] ?? null;
    warnings.push({
      severity: 'warning',
      code: 'event-alias',
      message: `\`${key}\` "${word}" is an older lifecycle word, read as ${stage === null ? 'the creation (null)' : `the stage "${stage}"`}.`,
      ...at,
    });
    return stage;
  };
  const fromStage = read('from', fromWord);
  const toStage = read('to', to);
  if (fromStage === undefined) return reject('event-stage', `\`from\` "${fromWord ?? ''}" is not a stage name (${EVENT_STAGES.join(', ')}).`);
  if (toStage === undefined) return reject('event-stage', `\`to\` "${to}" is not a stage name (${EVENT_STAGES.join(', ')}).`);
  if (toStage === null) return reject('event-stage', `\`to\` "${to}" names the creation; a transition enters a stage.`);

  if (fromStage === toStage) {
    return fromWord === to
      ? reject('event-same-stage', `\`from\` and \`to\` are both "${to}": no transition.`)
      : reject('event-same-stage', `"${fromWord ?? ''} → ${to}" is "${toStage} → ${toStage}" in the stage table: no transition, skipped.`, 'warning');
  }

  return { ok: true, event: { ts, from: fromStage, to: toStage, command, actor }, warnings };
}

/**
 * Every line of an events.jsonl text: the valid ones as events in file order, every other one and every old-word
 * warning as diagnostics with its 1-based line. Blank lines are skipped. A null `from` counts only on the first event
 * of the file (the creation); later it is rejected with `event-null-from`.
 */
export function parseEvents(text: string): { events: EventLine[]; diagnostics: Diagnostic[] } {
  const events: EventLine[] = [];
  const diagnostics: Diagnostic[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    if (raw.trim() === '') return;
    const v = validateEventLine(raw, i + 1);
    if (!v.ok) {
      diagnostics.push(v.diagnostic);
      return;
    }
    if (v.event.from === null && events.length > 0) {
      diagnostics.push({
        severity: 'error',
        code: 'event-null-from',
        message: `A null \`from\` marks the creation and stands only on the first event; this line enters "${v.event.to}" after ${events.length} event${events.length === 1 ? '' : 's'}.`,
        line: i + 1,
      });
      return;
    }
    diagnostics.push(...v.warnings);
    events.push(v.event);
  });
  return { events, diagnostics };
}

function names(keys: readonly string[]): string {
  return keys.map((k) => `\`${k}\``).join(', ');
}

/** ISO 8601 date-time with a zone whose day exists and whose clock and offset are in range. */
function isIsoDateTime(value: string): boolean {
  const m = ISO_DATE_TIME.exec(value);
  if (!m) return false;
  const [year, month, day, hour, minute, second, , offH, offM] = m.slice(1).map((v: string | undefined) => Number(v ?? 0));
  const date = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1));
  const realDay = date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day;
  const inRange = (hour ?? 0) <= 23 && (minute ?? 0) <= 59 && (second ?? 0) <= 59 && (offH ?? 0) <= 23 && (offM ?? 0) <= 59;
  return realDay && inRange && Number.isFinite(Date.parse(value));
}

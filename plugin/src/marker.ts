// The marker line of a builder brief (spec 032, T2, ISC-33): `spectant: spec=<NNN> task=<Tn> claim=<ISC-N>`.
//
// The implement subcommand writes it as the first line of every builder's prompt; the hook command reads it back from
// the Agent tool's `prompt`, because no hook field names the task or the claim a subagent works on. Both sides use this
// one module, so the format has a single owner. A prompt without the line, or with a garbled one, is no task: the
// parser returns null and never throws, and the hook then writes nothing.
//
// The parser is lenient about whitespace (blank lines before the marker, runs of spaces or tabs, a trailing `\r`) and
// strict about the keys: exactly `spec`, `task` and `claim`, in that order, with a three-digit spec number, a task id
// `T<n>` (a task of tasks.md) or `C<n>` (frontier's claim unit of a spec without tasks.md, spec 056) and a claim id
// `ISC-<n>` with optional `.<n>` parts, the ids core's activity lines accept. The module imports nothing, so the hook
// stays cheap to bundle.

/** The task a builder brief names. */
export interface Marker {
  /** The spec number, three digits (`032`). */
  spec: string;
  /** The task id (`T2`), or the claim unit of a spec without tasks.md (`C2`). */
  task: string;
  /** The claim id (`ISC-33`, `ISC-33.1`). */
  claim: string;
}

/** A marker field the parser would reject; the writer refuses it rather than write a line nobody reads. */
export class MarkerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MarkerError';
  }
}

const SPEC = /^\d{3}$/u;
const TASK = /^[TC]\d+$/u;
const CLAIM = /^ISC-\d+(?:\.\d+)*$/u; // single-core: allow — the marker line of a brief, not the spec format
const LINE = /^spectant:[ \t]+spec=(\d{3})[ \t]+task=([TC]\d+)[ \t]+claim=(ISC-\d+(?:\.\d+)*)$/u; // single-core: allow — the marker line of a brief

/** The marker line for one task, without a line break. Throws `MarkerError` on a field `parseMarker` would reject. */
export function markerLine(marker: Marker): string {
  if (!SPEC.test(marker.spec)) throw new MarkerError(`spec must be three digits, got "${marker.spec}"`);
  if (!TASK.test(marker.task)) throw new MarkerError(`task must be T<n> or C<n>, got "${marker.task}"`);
  if (!CLAIM.test(marker.claim)) throw new MarkerError(`claim must be ISC-<n>[.<n>], got "${marker.claim}"`);
  return `spectant: spec=${marker.spec} task=${marker.task} claim=${marker.claim}`;
}

/** The marker from the first non-blank line of a prompt, or null when that line is missing or garbled. */
export function parseMarker(prompt: string): Marker | null {
  const first = prompt.trimStart().split('\n', 1)[0]?.trim() ?? '';
  const match = LINE.exec(first);
  if (!match) return null;
  const [, spec, task, claim] = match;
  if (spec === undefined || task === undefined || claim === undefined) return null;
  return { spec, task, claim };
}

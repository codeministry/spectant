// The text planners behind the plugin CLI `spec-check` (spec 031, ISC-41): a new spec folder, claims minted in the
// master and projected into a spec, a Verification line and a Decisions row. Each takes the file's text and returns
// the new text; the CLI writes it. The order the CLI keeps is the old skill's: claims are minted in the master first
// (`mintClaimsText`), then the same lines go into the spec (`projectClaimsText`), so a spec never holds an ID the
// master does not; evidence is written before the checkmark is set (`appendVerificationText` does both in one text).
//
// Every planner reads the file through core's own parsers (`parseClaims`) to find claims, IDs and blocks, so a line
// inside a fence, an ID in backticks or prose, or a Verification line never counts as a claim. Lines the planner does
// not touch stay byte-identical; the line ending is the file's own.
//
// Pure and browser-safe: texts in, texts out. No file system, no Node or Bun API, nothing written.
import { formatProgress, parseClaims, type ClaimsDocument } from './claims.ts';
import type { SpecType } from './files.ts';
import { SPEC_TYPES } from './frontmatter.ts';

/** One spec type of the format (`feature`, `bug`, …). */
export type SpecTextType = SpecType;

/** One Test Strategy row without its `isc` cell: the planner fills in the claim's ID. Columns as in FORMAT.md. */
export interface SpecTextRow {
  readonly type: string;
  readonly check: string;
  readonly threshold: string;
  readonly tool: string;
  readonly anchorsTo: string;
  readonly severity?: string;
}

/** A claim to mint: the ID is assigned unless given (a dotted split, say), `after` names its claim edges. */
export interface SpecTextClaim {
  readonly id?: string;
  /** The claim text, an `Anti:` or `Antecedent:` prefix included where it has one. One line. */
  readonly text: string;
  readonly after?: readonly string[];
}

/** A claim the master already holds, projected into a spec. */
export interface ProjectedClaim extends SpecTextClaim {
  readonly id: string;
}

export interface SpecFolderInput {
  readonly type: SpecTextType;
  /** The spec number, 1 to 999 (the CLI takes it from `nextSpecNumber`). */
  readonly number: number;
  /** Lower-case kebab case, without the number. */
  readonly slug: string;
  /** One line: the spec's `task:` and its H1. */
  readonly title: string;
  /** The confirmed goal: the first paragraph of `## Goal` and the goal lock in `context.md`. */
  readonly goal: string;
  /** The master's feature block that owns the claims (`F3`); left out for a spec that has none. */
  readonly feature?: string;
  readonly now: Date;
  /** The creation event's actor (FORMAT.md § events, the actor grammar). */
  readonly actor: string;
}

/** A planned spec folder: its path under the repository root and its three first files. */
export interface SpecFolderText {
  /** `specs/NNN-slug`. */
  readonly dir: string;
  readonly files: { readonly 'spec.md': string; readonly 'context.md': string; readonly 'events.jsonl': string };
}

export type SpecTextErrorCode = 'bad-input' | 'multi-line' | 'unknown-id' | 'dropped-claim' | 'duplicate-id' | 'unknown-feature' | 'no-claim-section';

/** A refused plan: the caller's input does not fit the file. Nothing was planned. */
export class SpecTextError extends Error {
  readonly code: SpecTextErrorCode;

  constructor(code: SpecTextErrorCode, message: string) {
    super(message);
    this.name = 'SpecTextError';
    this.code = code;
  }
}

/** The sections a new `spec.md` opens with, per type, in the format's order (claims before Test Strategy). */
const SECTIONS: Readonly<Record<SpecTextType, readonly string[]>> = {
  feature: ['Problem', 'Vision', 'Out of Scope', 'Constraints', 'Goal', 'Not yet specified', 'Claims', 'Test Strategy', 'Decisions', 'Verification'],
  project: ['Problem', 'Vision', 'Out of Scope', 'Principles', 'Constraints', 'Goal', 'Not yet specified', 'Claims', 'Test Strategy', 'Decisions', 'Verification'],
  refactor: ['Problem', 'Out of Scope', 'Goal', 'Claims', 'Test Strategy', 'Decisions', 'Verification'],
  infra: ['Problem', 'Constraints', 'Goal', 'Claims', 'Test Strategy', 'Decisions', 'Verification'],
  spike: ['Problem', 'Goal', 'Not yet specified', 'Claims', 'Test Strategy', 'Decisions', 'Verification'],
  bug: ['Problem', 'Goal', 'Claims', 'Test Strategy', 'Decisions', 'Verification'],
  chore: ['Problem', 'Goal', 'Claims', 'Test Strategy', 'Decisions', 'Verification'],
};

const TABLE_HEAD = ['| isc | type | check | threshold | tool | anchors_to | severity |', '|-----|------|-------|-----------|------|------------|----------|'];
const LEVEL_TWO = /^##\s+(?!#)/;
const RULE = /^---\s*$/;
const HEADING_UP_TO_THREE = /^#{1,3}\s/;
const FENCE = /^\s*(```|~~~)/;
const ISC_NUMBER = /^ISC-(\d+)/;
const DATED = /^\d{4}-\d{2}-\d{2}\b/;

// ---------------------------------------------------------------------------------------------------------------------
// Lines

interface Lines {
  readonly lines: string[];
  /** Inside a fenced block, or a fence line itself: never a heading. */
  readonly fenced: boolean[];
  readonly eol: string;
}

function linesOf(text: string): Lines {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r\n|\r|\n/);
  const fenced: boolean[] = [];
  let open: string | null = null;
  for (const line of lines) {
    const fence = FENCE.exec(line)?.[1] ?? null;
    if (open === null && fence !== null) {
      open = fence;
      fenced.push(true);
    } else if (open !== null) {
      if (fence === open) open = null;
      fenced.push(true);
    } else {
      fenced.push(false);
    }
  }
  return { lines, fenced, eol };
}

function textOf(doc: Lines): string {
  return doc.lines.join(doc.eol);
}

/** Inserts `block` at index `at`, keeping one blank line on either side where a non-blank line would touch it. */
function insertBlock(doc: Lines, at: number, block: readonly string[]): void {
  const before = at > 0 && (doc.lines[at - 1] ?? '').trim() !== '' ? [''] : [];
  const after = at < doc.lines.length && (doc.lines[at] ?? '').trim() !== '' ? [''] : [];
  const added = [...before, ...block, ...after];
  doc.lines.splice(at, 0, ...added);
  doc.fenced.splice(at, 0, ...added.map(() => false));
}

/** Inserts `block` directly after line index `anchor`, no blank line in between. */
function insertAfterLine(doc: Lines, anchor: number, block: readonly string[]): void {
  doc.lines.splice(anchor + 1, 0, ...block);
  doc.fenced.splice(anchor + 1, 0, ...block.map(() => false));
}

/** [heading index, end index) of the first `## <name>` section; the end is the next level-two heading or EOF. */
function sectionRange(doc: Lines, name: string): [number, number] | null {
  const heading = new RegExp(String.raw`^##\s+${name}\s*$`, 'i');
  const start = doc.lines.findIndex((l, i) => !doc.fenced[i] && heading.test(l));
  if (start < 0) return null;
  const end = doc.lines.findIndex((l, i) => i > start && !doc.fenced[i] && LEVEL_TWO.test(l));
  return [start, end < 0 ? doc.lines.length : end];
}

/** The last non-blank line index in (from, to), or `from` when there is none. */
function lastContent(doc: Lines, from: number, to: number): number {
  for (let i = to - 1; i > from; i--) if ((doc.lines[i] ?? '').trim() !== '') return i;
  return from;
}

/** Appends `block` at the end of the section's content (after its last non-blank line), blank-line separated. */
function appendToSection(doc: Lines, range: [number, number], block: readonly string[], tight: boolean): void {
  const last = lastContent(doc, range[0], range[1]);
  if (tight && last > range[0]) insertAfterLine(doc, last, block);
  else insertBlock(doc, last + 1, block);
}

/** The index where a new level-two section goes: before the first of `beforeNames`, else at the end of the text. */
function newSectionAt(doc: Lines, beforeNames: readonly string[]): number {
  const found = beforeNames.map((n) => sectionRange(doc, n)?.[0]).filter((i): i is number => i !== undefined);
  if (found.length > 0) return Math.min(...found);
  return doc.lines.length > 0 && doc.lines[doc.lines.length - 1] === '' ? doc.lines.length - 1 : doc.lines.length;
}

/** The index just past the end of the named section (the next level-two heading or EOF), or null without it. */
function afterSection(doc: Lines, name: string): number | null {
  const range = sectionRange(doc, name);
  if (!range) return null;
  const end = range[1];
  return end === doc.lines.length && doc.lines[end - 1] === '' ? end - 1 : end;
}

// ---------------------------------------------------------------------------------------------------------------------
// Frontmatter keys

/** Sets `key: value` in the frontmatter block: the last line of that key replaced, or a new last key when `insert`. */
function setKey(doc: Lines, key: string, value: string, insert: boolean): void {
  if ((doc.lines[0] ?? '').replace(/^\uFEFF/, '').trim() !== '---') return;
  const close = doc.lines.findIndex((l, i) => i > 0 && l.trim() === '---');
  if (close < 0) return;
  const pattern = new RegExp(String.raw`^${key}\s*:`);
  let at = -1;
  for (let i = 1; i < close; i++) if (pattern.test(doc.lines[i] ?? '')) at = i;
  if (at >= 0) doc.lines[at] = `${key}: ${value}`;
  else if (insert) {
    doc.lines.splice(close, 0, `${key}: ${value}`);
    doc.fenced.splice(close, 0, false);
  }
}

/** Recounts `progress:` from the boxes as they now stand. */
function recount(doc: Lines, insert: boolean): void {
  setKey(doc, 'progress', formatProgress(parseClaims(textOf(doc)).counted), insert);
}

// ---------------------------------------------------------------------------------------------------------------------
// Input checks

function oneLine(value: string, what: string): string {
  if (/[\r\n]/.test(value)) throw new SpecTextError('multi-line', `${what} must be one line`);
  return value;
}

function validDate(now: Date): string {
  if (Number.isNaN(now.getTime())) throw new SpecTextError('bad-input', 'the time is not a valid date');
  return now.toISOString();
}

/** A table cell: one line, its pipes escaped so the row stays positional. */
function cell(value: string, what: string): string {
  return oneLine(value, what).trim().replace(/(?<!\\)\|/g, '\\|');
}

function claimLine(id: string, claim: SpecTextClaim): string {
  const text = oneLine(claim.text, `the text of ${id}`).trim();
  if (text === '') throw new SpecTextError('bad-input', `${id} has no text`);
  const after = claim.after ?? [];
  return `- [ ] ${id}: ${text}${after.length > 0 ? ` (after: ${after.join(', ')})` : ''}`;
}

function rowLine(id: string, row: SpecTextRow): string {
  const cells = [id, row.type, row.check, row.threshold, row.tool, row.anchorsTo].map((v) => cell(v, `a Test Strategy cell of ${id}`));
  const severity = cell(row.severity ?? '', `the severity of ${id}`);
  return `| ${[...cells, severity].join(' | ')} |`;
}

function rowLines(ids: readonly string[], rows: ReadonlyArray<SpecTextRow | null | undefined>): string[] {
  if (rows.length > ids.length) throw new SpecTextError('bad-input', `${rows.length} Test Strategy rows for ${ids.length} claims`);
  return rows.flatMap((row, i) => (row ? [rowLine(ids[i] ?? '', row)] : []));
}

// ---------------------------------------------------------------------------------------------------------------------
// Claims and rows into a file

/** The claim section's [heading, end): ends at the next level-two heading or a `---` rule, as `parseClaims` reads it. */
function claimSectionRange(doc: Lines, parsed: ClaimsDocument): [number, number] | null {
  if (!parsed.section) return null;
  const start = parsed.section.line - 1;
  const end = doc.lines.findIndex((l, i) => i > start && !doc.fenced[i] && (LEVEL_TWO.test(l) || RULE.test(l)));
  return [start, end < 0 ? doc.lines.length : end];
}

/** The claim lines go after the last claim in [from, to), else after the last non-blank line there. */
function insertClaims(doc: Lines, parsed: ClaimsDocument, range: [number, number], block: readonly string[], feature: string | null): void {
  const inRange = parsed.claims.filter((c) => c.line - 1 > range[0] && c.line - 1 < range[1] && (feature === null || c.feature === feature));
  const lastClaim = inRange.reduce((max, c) => Math.max(max, c.line - 1), -1);
  if (lastClaim >= 0) insertAfterLine(doc, lastClaim, block);
  else appendToSection(doc, range, block, false);
}

/** The rows go after the last table line of `## Test Strategy`; the section or its table is created when missing. */
function insertRows(doc: Lines, rows: readonly string[], claimSection: [number, number] | null): void {
  if (rows.length === 0) return;
  const range = sectionRange(doc, 'Test Strategy');
  if (range) {
    let lastRow = -1;
    for (let i = range[0] + 1; i < range[1]; i++) if (!doc.fenced[i] && /^\s*\|/.test(doc.lines[i] ?? '')) lastRow = i;
    if (lastRow >= 0) insertAfterLine(doc, lastRow, rows);
    else appendToSection(doc, range, [...TABLE_HEAD, ...rows], false);
    return;
  }
  const at = claimSection ? claimSection[1] : newSectionAt(doc, ['Decisions', 'Changelog', 'Verification']);
  insertBlock(doc, at, ['## Test Strategy', '', ...TABLE_HEAD, ...rows]);
}

/**
 * Mints `claims` into the master: each without an `id` gets the next free `ISC-N` (one past the highest top-level
 * number any claim line carries, tombstones included, so a dropped ID is never handed out again; IDs in prose, code
 * spans, Test Strategy rows or Verification lines do not count). The claim lines go to the end of the `### <feature>`
 * block, or to the end of a flat claim section when the master has no feature blocks; `rows[i]` (when given) becomes
 * the Test Strategy row of `claims[i]`, appended to the table. `progress:` is recounted. A feature the master's blocks
 * do not name is refused unless `opts.featureName` opens a new block for it at the end of the claim section.
 */
export function mintClaimsText(
  master: string,
  feature: string,
  claims: readonly SpecTextClaim[],
  rows: ReadonlyArray<SpecTextRow | null | undefined>,
  opts: { readonly featureName?: string; readonly why?: string } = {},
): { text: string; ids: string[] } {
  if (claims.length === 0) throw new SpecTextError('bad-input', 'no claim to mint');
  const parsed = parseClaims(master);
  const taken = new Set(parsed.claims.map((c) => c.id));
  let highest = 0;
  const bump = (id: string) => {
    const n = Number(ISC_NUMBER.exec(id)?.[1] ?? 0);
    if (n > highest) highest = n;
  };
  for (const c of parsed.claims) bump(c.id);
  for (const c of claims) if (c.id !== undefined) bump(c.id);
  const ids = claims.map((c) => {
    if (c.id === undefined) {
      highest += 1;
      return `ISC-${highest}`;
    }
    if (taken.has(c.id)) throw new SpecTextError('duplicate-id', `the master already holds ${c.id}`);
    return c.id;
  });
  if (new Set(ids).size !== ids.length) throw new SpecTextError('duplicate-id', 'two claims carry the same ID');
  const block = claims.map((c, i) => claimLine(ids[i] ?? '', c));
  const newRows = rowLines(ids, rows);

  const doc = linesOf(master);
  const section = claimSectionRange(doc, parsed);
  if (!section) throw new SpecTextError('no-claim-section', 'the master has no claim section (## Features or ## Claims)');
  const target = parsed.features.find((f) => f.id === feature);
  if (target) {
    const head = target.line - 1;
    let end = doc.lines.findIndex((l, i) => i > head && !doc.fenced[i] && HEADING_UP_TO_THREE.test(l));
    if (end < 0 || end > section[1]) end = section[1];
    insertClaims(doc, parsed, [head, end], block, feature);
  } else if (parsed.features.length === 0) {
    insertClaims(doc, parsed, section, block, null);
  } else if (opts.featureName !== undefined) {
    const heading = `### ${feature} · ${oneLine(opts.featureName, 'the feature name').trim()}`;
    const why = opts.why === undefined ? [] : [`Why: ${oneLine(opts.why, 'the Why line').trim()}`];
    appendToSection(doc, section, [heading, ...why, '', ...block], false);
  } else {
    throw new SpecTextError('unknown-feature', `the master has no feature block ${feature}`);
  }
  insertRows(doc, newRows, claimSectionRange(doc, parseClaims(textOf(doc))));
  recount(doc, true);
  return { text: textOf(doc), ids };
}

/**
 * Projects claims the master already holds into a spec: the same claim lines at the end of the spec's claim section
 * (`## Claims` is created before `## Test Strategy`, `## Decisions` or `## Verification` when the spec has none), the
 * same rows at the end of its Test Strategy table, `progress:` recounted. Call it after `mintClaimsText`, with its IDs.
 */
export function projectClaimsText(spec: string, claims: readonly ProjectedClaim[], rows: ReadonlyArray<SpecTextRow | null | undefined>): string {
  if (claims.length === 0) throw new SpecTextError('bad-input', 'no claim to project');
  const parsed = parseClaims(spec);
  const held = new Set(parsed.claims.map((c) => c.id));
  for (const c of claims) if (held.has(c.id)) throw new SpecTextError('duplicate-id', `the spec already holds ${c.id}`);
  const ids = claims.map((c) => c.id);
  if (new Set(ids).size !== ids.length) throw new SpecTextError('duplicate-id', 'two claims carry the same ID');
  const block = claims.map((c) => claimLine(c.id, c));
  const newRows = rowLines(ids, rows);

  const doc = linesOf(spec);
  const section = claimSectionRange(doc, parsed);
  if (section) insertClaims(doc, parsed, section, block, null);
  else insertBlock(doc, newSectionAt(doc, ['Test Strategy', 'Decisions', 'Changelog', 'Verification']), ['## Claims', '', ...block]);
  insertRows(doc, newRows, claimSectionRange(doc, parseClaims(textOf(doc))));
  recount(doc, true);
  return textOf(doc);
}

/**
 * Writes the evidence for `id` and closes it, in spec and master alike: `- <id>: <type> — <stub>` appended to
 * `## Verification` (the section created after `## Changelog` or `## Decisions`, else at the end, when missing), the
 * claim's box ticked, `progress:` recounted and `updated:` set to `now`. Refuses a multi-line stub, an ID no claim line
 * carries and a dropped claim.
 */
export function appendVerificationText(text: string, id: string, type: string, stub: string, now: Date): string {
  oneLine(stub, 'the verification stub');
  oneLine(type, 'the verification type');
  if (stub.trim() === '') throw new SpecTextError('bad-input', 'the verification stub is empty');
  const updated = validDate(now);
  const parsed = parseClaims(text);
  const claim = parsed.claims.find((c) => c.id === id);
  if (!claim) throw new SpecTextError('unknown-id', `no claim line carries ${id}`);
  if (claim.dropped) throw new SpecTextError('dropped-claim', `${id} is dropped and takes no evidence`);

  const doc = linesOf(text);
  const entry = `- ${id}: ${type.trim()} — ${stub.trim()}`;
  // Evidence before the checkmark: the line is placed first, the box ticked after.
  const range = sectionRange(doc, 'Verification');
  if (range) appendToSection(doc, range, [entry], true);
  else insertBlock(doc, afterSection(doc, 'Changelog') ?? afterSection(doc, 'Decisions') ?? newSectionAt(doc, []), ['## Verification', '', entry]);
  const reparsed = parseClaims(textOf(doc)).claims.find((c) => c.id === id);
  const at = (reparsed?.line ?? claim.line) - 1;
  doc.lines[at] = (doc.lines[at] ?? '').replace(/^(\s*- \[) \]/, '$1x]');
  recount(doc, true);
  setKey(doc, 'updated', updated, true);
  return textOf(doc);
}

/**
 * Appends one row `- <date>: <line>` at the end of `## Decisions` (the date left off when the line starts with one);
 * the section is created before `## Changelog` or `## Verification`, else at the end, when missing. An existing
 * `updated:` is set to `now` and an existing `progress:` recounted; a file without them gets neither.
 */
export function appendDecisionText(text: string, line: string, now: Date): string {
  const body = oneLine(line, 'the decision').trim();
  if (body === '') throw new SpecTextError('bad-input', 'the decision is empty');
  const updated = validDate(now);
  const entry = `- ${DATED.test(body) ? body : `${updated.slice(0, 10)}: ${body}`}`;
  const doc = linesOf(text);
  const range = sectionRange(doc, 'Decisions');
  if (range) appendToSection(doc, range, [entry], true);
  else insertBlock(doc, newSectionAt(doc, ['Changelog', 'Verification']), ['## Decisions', '', entry]);
  recount(doc, false);
  setKey(doc, 'updated', updated, false);
  return textOf(doc);
}

// ---------------------------------------------------------------------------------------------------------------------
// A new spec folder

function quoted(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * Plans `specs/NNN-slug/` for a new spec: `spec.md` with the frontmatter FORMAT.md describes (`task`, `slug`,
 * `spec_type`, `isa_master: ../../ISA.md`, `isa_feature` when given, `stage: plan`, `phase: scoping`, `progress: 0/0`,
 * `started`/`updated` at `now`, `context_log`), the derived-view header and the type's sections, claimless, the goal
 * under `## Goal` and the Test Strategy's head row; `context.md` with the goal lock; and `events.jsonl` with the one
 * creation event `{ts, from: null, to: 'plan', command, actor}` that `validateEventLine` accepts. Writes nothing.
 */
export function specFolderText(input: SpecFolderInput): SpecFolderText {
  const { type, number, slug, feature } = input;
  if (!SPEC_TYPES.includes(type)) throw new SpecTextError('bad-input', `"${type}" is no spec type`);
  if (!Number.isInteger(number) || number < 1 || number > 999) throw new SpecTextError('bad-input', `spec number ${number} is outside 1 to 999`);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) throw new SpecTextError('bad-input', `"${slug}" is no kebab-case slug`);
  if (feature !== undefined && !/^F\d+(?:\.\d+)?$/.test(feature)) throw new SpecTextError('bad-input', `"${feature}" is no feature block id`);
  const title = oneLine(input.title, 'the title').trim();
  const goal = input.goal.trim();
  if (title === '' || goal === '') throw new SpecTextError('bad-input', 'the title and the goal must not be empty');
  if (input.actor.trim() === '') throw new SpecTextError('bad-input', 'the actor must not be empty');
  const ts = validDate(input.now);
  const id = String(number).padStart(3, '0');
  const folder = `${id}-${slug}`;

  const frontmatter = [
    '---',
    `task: ${quoted(title)}`,
    `slug: ${folder}`,
    `spec_type: ${type}`,
    'isa_master: ../../ISA.md',
    ...(feature === undefined ? [] : [`isa_feature: ${feature}`]),
    'stage: plan',
    'phase: scoping',
    'progress: 0/0',
    `started: ${ts}`,
    `updated: ${ts}`,
    'context_log: context.md',
    '---',
  ];
  const owner = feature === undefined ? '' : ` (feature ${feature})`;
  const sections = SECTIONS[type].flatMap((name) => {
    if (name === 'Goal') return [`## ${name}`, '', goal, ''];
    if (name === 'Test Strategy') return [`## ${name}`, '', ...TABLE_HEAD, ''];
    return [`## ${name}`, ''];
  });
  const spec = [
    ...frontmatter,
    '',
    `<!-- SPEC — a derived view of ../../ISA.md${owner}. Claim IDs belong to the master: minted there first, then`,
    '     projected here. Never edit the master from this file. -->',
    '',
    `# ${id} — ${title}`,
    '',
    ...sections,
  ].join('\n');

  const context = [
    '---',
    `spec: ${folder}`,
    `created: ${ts}`,
    `updated: ${ts}`,
    'rounds: 0',
    '---',
    '',
    '<!-- CONTEXT LOG — a record, not an authority. Nothing here gates anything and nothing',
    '     reads it back. Every answer that changes the build lives in spec.md or plan.md. -->',
    '',
    `# Context ${id} — ${title}`,
    '',
    `## Goal — confirmed ${ts}`,
    '',
    goal,
    '',
  ].join('\n');

  const event = { ts, from: null, to: 'plan', command: `/spec new ${slug}`, actor: input.actor };
  return { dir: `specs/${folder}`, files: { 'spec.md': spec, 'context.md': context, 'events.jsonl': `${JSON.stringify(event)}\n` } };
}

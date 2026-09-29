// The frontmatter of a spec, master, constitution or TL;DR file: the `---` block at the top, flat `key: value` lines.
// Port of the old Spec skill's SpecLib `parseFrontmatter` (quoted values up to the closing quote, `\"` unescaped in
// double quotes, a trailing ` # comment` dropped from an unquoted value). Nested YAML stays out of scope, as there.
//
// Pure: text in, model out. No file system, no Bun API. Malformed input yields diagnostics, never a throw.
import type { Diagnostic } from './diagnostics.ts';
import type { SpecType } from './files.ts';

/** `progress: M/N` — closed claims over live claims. */
export interface Progress {
  readonly closed: number;
  readonly total: number;
}

/** The keys the spec format defines, typed. A key that is absent (or unreadable, with a diagnostic) is null. */
export interface SpecFrontmatter {
  readonly task: string | null;
  readonly slug: string | null;
  readonly specType: SpecType | null;
  readonly isaMaster: string | null;
  readonly isaFeature: string | null;
  readonly constitution: string | null;
  readonly phase: string | null;
  readonly progress: Progress | null;
  /** ISO 8601 as written. */
  readonly started: string | null;
  /** ISO 8601 as written. */
  readonly updated: string | null;
  readonly principalStatedGoal: string | null;
  readonly principalStatedGoalSource: string | null;
  readonly principalStatedGoalSignal: number | null;
  readonly principalStatedGoalLocked: string | null;
  readonly contextSufficient: boolean | null;
  readonly interviewInvoked: boolean | null;
  readonly contextLog: string | null;
  readonly migratedFrom: string | null;
  readonly archivedReason: string | null;
  /** The archive date `YYYY-MM-DD` as written; set only on a folder under `specs/archive/`. */
  readonly archived: string | null;
}

export interface FrontmatterResult {
  /** A closed `---` block opens the file. */
  readonly present: boolean;
  readonly data: SpecFrontmatter;
  /** Every key as its unquoted string value, in file order: what the old skill's flat map held. */
  readonly values: Readonly<Record<string, string>>;
  /** The keys the format does not define (`project`, `generated`, …). */
  readonly rest: Readonly<Record<string, string>>;
  /** The text after the closing `---` line; the whole text when no block is present. Line endings normalised to LF. */
  readonly body: string;
  /** 1-based line of the text where `body` starts. */
  readonly bodyLine: number;
  readonly diagnostics: readonly Diagnostic[];
}

export const SPEC_TYPES: readonly SpecType[] = ['feature', 'bug', 'refactor', 'spike', 'infra', 'project'];

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
type Kind = 'string' | 'specType' | 'progress' | 'boolean' | 'number';

/** Frontmatter key → typed field and how its value is read. */
const KEYS: Readonly<Record<string, readonly [keyof SpecFrontmatter, Kind]>> = {
  task: ['task', 'string'],
  slug: ['slug', 'string'],
  spec_type: ['specType', 'specType'],
  isa_master: ['isaMaster', 'string'],
  isa_feature: ['isaFeature', 'string'],
  constitution: ['constitution', 'string'],
  phase: ['phase', 'string'],
  progress: ['progress', 'progress'],
  started: ['started', 'string'],
  updated: ['updated', 'string'],
  principal_stated_goal: ['principalStatedGoal', 'string'],
  principal_stated_goal_source: ['principalStatedGoalSource', 'string'],
  principal_stated_goal_signal: ['principalStatedGoalSignal', 'number'],
  principal_stated_goal_locked: ['principalStatedGoalLocked', 'string'],
  context_sufficient: ['contextSufficient', 'boolean'],
  interview_invoked: ['interviewInvoked', 'boolean'],
  context_log: ['contextLog', 'string'],
  migrated_from: ['migratedFrom', 'string'],
  archived_reason: ['archivedReason', 'string'],
  archived: ['archived', 'string'],
};

function emptyData(): Mutable<SpecFrontmatter> {
  return {
    task: null,
    slug: null,
    specType: null,
    isaMaster: null,
    isaFeature: null,
    constitution: null,
    phase: null,
    progress: null,
    started: null,
    updated: null,
    principalStatedGoal: null,
    principalStatedGoalSource: null,
    principalStatedGoalSignal: null,
    principalStatedGoalLocked: null,
    contextSufficient: null,
    interviewInvoked: null,
    contextLog: null,
    migratedFrom: null,
    archivedReason: null,
    archived: null,
  };
}

/** Parse `M/N`; null when it is not two counts with M ≤ N. */
export function parseProgress(value: string): Progress | null {
  const m = /^(\d+)\s*\/\s*(\d+)$/.exec(value.trim());
  if (!m) return null;
  const closed = Number(m[1]);
  const total = Number(m[2]);
  return closed <= total ? { closed, total } : null;
}

/** A raw value: quoted → up to the closing quote; unquoted → trimmed, a trailing ` # comment` removed. */
function unquote(raw: string): { value: string; unterminated: boolean } {
  const v = raw.trim();
  const quote = v[0];
  if (quote !== '"' && quote !== "'") return { value: v.replace(/\s+#.*$/, '').trim(), unterminated: false };
  let out = '';
  for (let i = 1; i < v.length; i++) {
    const c = v.charAt(i);
    if (c === '\\' && quote === '"' && i + 1 < v.length) {
      i += 1;
      out += v.charAt(i);
      continue;
    }
    if (c === quote) return { value: out, unterminated: false };
    out += c;
  }
  return { value: v.slice(1), unterminated: true };
}

const DELIMITER = '---';

/** Read the frontmatter block of `text`. */
export function parseFrontmatter(text: string): FrontmatterResult {
  const normalised = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const lines = normalised.split('\n');
  const diagnostics: Diagnostic[] = [];
  const data = emptyData();
  const values: Record<string, string> = {};
  const rest: Record<string, string> = {};
  const none = (): FrontmatterResult => ({ present: false, data, values, rest, body: normalised, bodyLine: 1, diagnostics });

  if (lines[0]?.trimEnd() !== DELIMITER) return none();
  const close = lines.findIndex((line, i) => i > 0 && line.trimEnd() === DELIMITER);
  if (close < 0) {
    diagnostics.push({ severity: 'error', code: 'frontmatter-unclosed', message: 'The frontmatter block opened on line 1 is never closed by a `---` line.', line: 1 });
    return none();
  }

  const warn = (code: string, message: string, line: number) => diagnostics.push({ severity: 'warning', code, message, line });
  for (let i = 1; i < close; i++) {
    const raw = lines[i] ?? '';
    const lineNo = i + 1;
    if (raw.trim() === '' || raw.trimStart().startsWith('#')) continue;
    if (/^\s/.test(raw)) {
      warn('frontmatter-nested', 'Nested YAML is not part of the format; the line is ignored.', lineNo);
      continue;
    }
    const kv = /^([\w-]+):\s*(.*)$/.exec(raw);
    if (!kv) {
      warn('frontmatter-line', 'The line is not `key: value`; it is ignored.', lineNo);
      continue;
    }
    const key = kv[1] ?? '';
    const { value, unterminated } = unquote(kv[2] ?? '');
    if (key in values) warn('frontmatter-duplicate', `The key ${key} is set twice; the last value wins.`, lineNo);
    if (unterminated) warn('frontmatter-quote', `The quoted value of ${key} is never closed.`, lineNo);
    values[key] = value;

    const known = KEYS[key];
    if (!known) {
      rest[key] = value;
      continue;
    }
    const [field, kind] = known;
    switch (kind) {
      case 'string':
        (data as Record<string, unknown>)[field] = value;
        break;
      case 'specType': {
        const type = SPEC_TYPES.find((t) => t === value) ?? null;
        if (!type) warn('frontmatter-spec-type', `spec_type ${value} is none of ${SPEC_TYPES.join(', ')}.`, lineNo);
        data.specType = type;
        break;
      }
      case 'progress':
        data.progress = parseProgress(value);
        if (!data.progress) warn('frontmatter-progress', `progress ${value} is not M/N with M ≤ N.`, lineNo);
        break;
      case 'boolean': {
        const bool = value === 'true' ? true : value === 'false' ? false : null;
        if (bool === null) warn('frontmatter-boolean', `${key} ${value} is neither true nor false.`, lineNo);
        (data as Record<string, unknown>)[field] = bool;
        break;
      }
      case 'number': {
        const num = /^-?\d+(?:\.\d+)?$/.test(value) ? Number(value) : null;
        if (num === null) warn('frontmatter-number', `${key} ${value} is not a number.`, lineNo);
        (data as Record<string, unknown>)[field] = num;
        break;
      }
    }
  }

  return {
    present: true,
    data,
    values,
    rest,
    body: lines.slice(close + 1).join('\n'),
    bodyLine: close + 2,
    diagnostics,
  };
}

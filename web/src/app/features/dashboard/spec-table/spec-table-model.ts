import type { Tone } from '../../../shared/ui/tone';

/**
 * The Specs panel's view of the dashboard model (T63, ISC-61). Nothing here counts or derives a spec's state: every
 * field is read from the rows `core/src/dashboard.ts` built (the body stays `unknown` in web until core's dashboard
 * types move to a browser-safe module, see `DashboardBody`), and the helpers only filter and order those rows by the
 * query state the URL carries (`?phase=&type=&sort=&takeable=`, design.md § Routes and state).
 */

/** One active spec as the panel renders it: the fields of `DashboardSpecRow` the row shows. */
export interface SpecTableRow {
  readonly id: string;
  readonly title: string;
  readonly type: string | null;
  /** Frontmatter `phase:` as written. */
  readonly phase: string | null;
  /** The derived stage (`plan` … `done`). */
  readonly stage: string;
  readonly closed: number;
  readonly total: number;
  readonly nextCommand: string | null;
  readonly takeable: readonly string[];
  /** How many warnings the spec carries. */
  readonly warnings: number;
  readonly fog: number;
  /** The one-line description under the title: the `## Goal` line the model carries; null when it is empty. */
  readonly description: string | null;
  /** The session holding a lock on one of the spec's claims (the first in claim order); null without locks. */
  readonly agent: string | null;
}

/** One archived spec, as the archive fold lists it. */
export interface ArchiveRow {
  readonly id: string;
  /** `NNN-slug`; the footer shows it without the number, as the prototype does. */
  readonly slug: string;
  readonly title: string;
  readonly type: string | null;
}

export const SORT_KEYS = ['stage', 'next', 'id', 'progress'] as const;
export type SortKey = (typeof SORT_KEYS)[number];
/** The sorts the panel's sort menu offers (prototype: Stage / ID / Progress); `?sort=next` still parses. */
export const SORT_MENU: readonly SortKey[] = ['stage', 'id', 'progress'];

/** The panel's query state. `phase` is a frontmatter phase or `fog`; null means all. */
export interface ListQuery {
  readonly phase: string | null;
  readonly type: string | null;
  readonly sort: SortKey;
  readonly takeable: boolean;
}

export const DEFAULT_QUERY: ListQuery = { phase: null, type: null, sort: 'stage', takeable: false };

/** The filter chip key for "every phase" and for "has open fog". */
export const ALL = 'all';
export const FOG = 'fog';

/** Phases in lifecycle order; a phase outside this list follows them alphabetically. */
const PHASE_ORDER = ['scoping', 'building', 'climbing', 'complete'];

export const PHASE_TONES: Readonly<Partial<Record<string, Tone>>> = {
  scoping: 'secondary',
  building: 'primary',
  climbing: 'warning',
  complete: 'success',
  fog: 'neutral',
};

export interface ListOption {
  readonly key: string;
  readonly count: number;
}

type Loose = Readonly<Record<string, unknown>>;
const isLoose = (value: unknown): value is Loose => typeof value === 'object' && value !== null;
const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const count = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
const listOf = (body: unknown, key: string): Loose[] => {
  const list = isLoose(body) ? body[key] : null;
  return Array.isArray(list) ? list.filter(isLoose) : [];
};

export function readSpecRows(body: unknown): SpecTableRow[] {
  return listOf(body, 'specs').flatMap((row): SpecTableRow[] => {
    const id = text(row['id']);
    if (id === null) return [];
    const progress = isLoose(row['progress']) ? row['progress'] : {};
    const takeable = Array.isArray(row['takeable']) ? row['takeable'].flatMap((claim) => text(claim) ?? []) : [];
    const goal = text(row['goal'])?.trim() ?? '';
    const holder = Array.isArray(row['taken']) ? row['taken'].find(isLoose) : undefined;
    return [
      {
        id,
        title: text(row['title']) ?? id,
        type: text(row['type']),
        phase: text(row['phase']),
        stage: text(row['stage']) ?? 'plan',
        closed: count(progress['closed']),
        total: count(progress['total']),
        nextCommand: text(row['nextCommand']),
        takeable,
        warnings: Array.isArray(row['warnings']) ? row['warnings'].length : 0,
        fog: count(row['fog']),
        description: goal === '' ? null : goal,
        agent: holder === undefined ? null : text(holder['session']),
      },
    ];
  });
}

export function readArchiveRows(body: unknown): ArchiveRow[] {
  return listOf(body, 'archive').flatMap((row): ArchiveRow[] => {
    const id = text(row['id']);
    return id === null ? [] : [{ id, slug: text(row['slug']) ?? id, title: text(row['title']) ?? id, type: text(row['type']) }];
  });
}

/** Reads the query state from anything with `get` (the router's `ParamMap`); unknown values fall back to defaults. */
export function parseListQuery(params: { get(name: string): string | null }): ListQuery {
  const phase = params.get('phase');
  const type = params.get('type');
  const sort = params.get('sort');
  return {
    phase: phase === null || phase === '' || phase === ALL ? null : phase,
    type: type === null || type === '' || type === ALL ? null : type,
    sort: SORT_KEYS.find((key) => key === sort) ?? DEFAULT_QUERY.sort,
    takeable: params.get('takeable') === '1',
  };
}

/** The query params for `query`; a default is null, so the URL carries only what differs. */
export function listQueryParams(query: ListQuery): Record<'phase' | 'type' | 'sort' | 'takeable', string | null> {
  return {
    phase: query.phase,
    type: query.type,
    sort: query.sort === DEFAULT_QUERY.sort ? null : query.sort,
    takeable: query.takeable ? '1' : null,
  };
}

const ratio = (row: SpecTableRow): number => (row.total > 0 ? row.closed / row.total : 0);
const nextRank = (row: SpecTableRow): number => (row.takeable.length > 0 ? 0 : row.nextCommand !== null ? 1 : 2);
const byId = (a: SpecTableRow, b: SpecTableRow): number => a.id.localeCompare(b.id, 'en', { numeric: true });

function matchesPhase(row: SpecTableRow, phase: string | null): boolean {
  if (phase === null) return true;
  return phase === FOG ? row.fog > 0 : row.phase === phase;
}

/** The rows the panel shows for `query`: filtered, then ordered; `Array.prototype.sort` is stable on the model order. */
export function applyListQuery(rows: readonly SpecTableRow[], query: ListQuery): SpecTableRow[] {
  const kept = rows.filter(
    (row) =>
      matchesPhase(row, query.phase) &&
      (query.type === null || row.type === query.type) &&
      (!query.takeable || row.takeable.length > 0),
  );
  switch (query.sort) {
    case 'stage':
      return kept;
    case 'id':
      return kept.sort(byId);
    case 'progress':
      return kept.sort((a, b) => ratio(b) - ratio(a));
    case 'next':
      return kept.sort((a, b) => nextRank(a) - nextRank(b));
  }
}

/**
 * New specs never reflow under the reader (design.md § Live update, ISC-62.1): of the active rows, `shown` keeps the
 * ones in `seen` (every row while `seen` is null, the first load) in model order, and `pending` names the rest, which
 * wait behind the "n new specs · show" pill until the reader applies them.
 */
export function holdNewRows(rows: readonly SpecTableRow[], seen: ReadonlySet<string> | null): { shown: readonly SpecTableRow[]; pending: readonly string[] } {
  if (seen === null) return { shown: rows, pending: [] };
  const shown: SpecTableRow[] = [];
  const pending: string[] = [];
  for (const row of rows) {
    if (seen.has(row.id)) shown.push(row);
    else pending.push(row.id);
  }
  return { shown, pending };
}

function phaseRank(phase: string): number {
  const index = PHASE_ORDER.indexOf(phase);
  return index === -1 ? PHASE_ORDER.length : index;
}

/** The phase chips: All, each phase present in lifecycle order, then fog when a spec has open fog. */
export function phaseOptions(rows: readonly SpecTableRow[]): ListOption[] {
  const counts = new Map<string, number>();
  for (const row of rows) if (row.phase !== null) counts.set(row.phase, (counts.get(row.phase) ?? 0) + 1);
  const phases = [...counts.keys()].sort((a, b) => phaseRank(a) - phaseRank(b) || a.localeCompare(b));
  const fog = rows.filter((row) => row.fog > 0).length;
  return [
    { key: ALL, count: rows.length },
    ...phases.map((key) => ({ key, count: counts.get(key) ?? 0 })),
    ...(fog > 0 ? [{ key: FOG, count: fog }] : []),
  ];
}

/** The type chips, alphabetical; none when the workspace holds fewer than two types (design.md § Tablet). */
export function typeOptions(rows: readonly SpecTableRow[]): ListOption[] {
  const counts = new Map<string, number>();
  for (const row of rows) if (row.type !== null) counts.set(row.type, (counts.get(row.type) ?? 0) + 1);
  if (counts.size < 2) return [];
  const types = [...counts.keys()].sort((a, b) => a.localeCompare(b));
  return [{ key: ALL, count: rows.length }, ...types.map((key) => ({ key, count: counts.get(key) ?? 0 }))];
}

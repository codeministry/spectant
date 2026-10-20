import type { Priority, SpecWait } from '../../../../../../core/src/files';
import type { Tone } from '../../../shared/ui/tone';

/**
 * The Specs panel's view of the dashboard model (T63, ISC-61). Nothing here counts or derives a spec's state: every
 * field is read from the rows `core/src/dashboard.ts` built (the body stays `unknown` in web until core's dashboard
 * types move to a browser-safe module, see `DashboardBody`), and the helpers only filter and order those rows by the
 * query state the URL carries (`?phase=&type=&sort=&takeable=&archived=`, design.md § Routes and state).
 */

/** One active spec as the panel renders it: the fields of `DashboardSpecRow` the row shows. */
export interface SpecTableRow {
  readonly id: string;
  readonly title: string;
  readonly type: string | null;
  /** Frontmatter `priority:` as core reads it (`P3` when absent or invalid); null only when the row carries none. */
  readonly priority: Priority | null;
  /** Frontmatter `phase:` as written. */
  readonly phase: string | null;
  /** The derived stage (`plan` … `done`). */
  readonly stage: string;
  /** The row's stage group as core derives it (`stageGroup`): what the phase chips filter by; null when absent. */
  readonly stageGroup: StageGroup | null;
  readonly closed: number;
  readonly total: number;
  readonly nextCommand: string | null;
  /** The stage table's phrase for why that command is next (`nextReason`), shown verbatim; empty when absent. */
  readonly nextReason: string;
  readonly takeable: readonly string[];
  /** How many warnings the spec carries. */
  readonly warnings: number;
  readonly fog: number;
  /**
   * The one-line description under the title: the `## Goal` line the model carries; null when it is empty or does not
   * differ from the title after normalizing whitespace and trailing punctuation (ISC-249), so the sentence stands once.
   */
  readonly description: string | null;
  /** The session holding a lock on one of the spec's claims (the first in claim order); null without locks. */
  readonly agent: string | null;
  /** What the spec waits on, the row's `waits` (spec 025, T24, ISC-163); null when no open spec edge holds its work. */
  readonly waits: SpecWait | null;
  /**
   * Spec 050 (T1, ISC-287): the archive mark. Absent on every active row; present on a row built from the archive
   * (`archivedTableRow`), carrying the archive date (`YYYY-MM-DD`, null when the folder records none).
   */
  readonly archived?: { readonly on: string | null };
}

/** One archived spec, as the model's `archive` part carries it (`ArchivedSpec` in `core/src/archive.ts`). */
export interface ArchiveRow {
  readonly id: string;
  /** `NNN-slug`. */
  readonly slug: string;
  readonly title: string;
  readonly type: string | null;
  /** Spec 050 (T1, ISC-287): the live claims closed, from the wire's `claims`. */
  readonly closed: number;
  /** Spec 050 (T1, ISC-287): the live claims in total, from the wire's `claims`. */
  readonly total: number;
  /** Spec 050 (T1, ISC-287): the `## Goal` line as core gives it, trimmed; empty when there is none. */
  readonly goal: string;
  /** Spec 050 (T1, ISC-287): frontmatter `archived:` (`YYYY-MM-DD`); null when the folder carries none. */
  readonly archived: string | null;
}

export const SORT_KEYS = ['stage', 'next', 'id', 'progress'] as const;
export type SortKey = (typeof SORT_KEYS)[number];
/** The sorts the panel's sort menu offers (prototype: Stage / ID / Progress); `?sort=next` still parses. */
export const SORT_MENU: readonly SortKey[] = ['stage', 'id', 'progress'];

/**
 * The panel's query state. `phase` is a stage group or `fog`; null means all. A `?phase=` value that is neither (an
 * old frontmatter phase such as `climbing`) parses as all.
 */
export interface ListQuery {
  readonly phase: string | null;
  readonly type: string | null;
  readonly sort: SortKey;
  readonly takeable: boolean;
  /** Spec 050 (T1, ISC-287): the archived specs show under the active ones (`?archived=1`); off by default. */
  readonly archived: boolean;
}

export const DEFAULT_QUERY: ListQuery = { phase: null, type: null, sort: 'stage', takeable: false, archived: false };

/** The filter chip key for "every phase" and for "has open fog". */
export const ALL = 'all';
export const FOG = 'fog';

/** The stage groups core derives (`StageGroup` in `core/src/dashboard.ts`), in lifecycle order: the phase chips' keys. */
export const STAGE_GROUPS = ['scoping', 'building', 'complete'] as const;
export type StageGroup = (typeof STAGE_GROUPS)[number];
const stageGroupOf = (value: unknown): StageGroup | null => STAGE_GROUPS.find((group) => group === value) ?? null;

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

/**
 * The counts the filter chips show, every one a field of the model's `kpis` (spec 021, ISC-255): the panel counts no
 * rows itself, so a chip and the Specs tile read the same number (`stageGroups`).
 */
export interface SpecListCounts {
  /** Every active spec: the `all` chips. */
  readonly specs: number;
  readonly stageGroups: Readonly<Record<StageGroup, number>>;
  /** The active specs with open fog: the fog chip. */
  readonly specsWithFog: number;
  /** The active specs per type present: the type chips. */
  readonly byType: Readonly<Record<string, number>>;
}

type Loose = Readonly<Record<string, unknown>>;
const isLoose = (value: unknown): value is Loose => typeof value === 'object' && value !== null;
const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const PRIORITIES: readonly Priority[] = ['P1', 'P2', 'P3', 'P4'];
const priorityOf = (value: unknown): Priority | null => PRIORITIES.find((level) => level === value) ?? null;
const count = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
const listOf = (body: unknown, key: string): Loose[] => {
  const list = isLoose(body) ? body[key] : null;
  return Array.isArray(list) ? list.filter(isLoose) : [];
};

/** A line as the title comparison sees it: whitespace runs collapsed, the ends trimmed, trailing punctuation dropped. */
const compared = (line: string): string =>
  line
    .replace(/\s+/gu, ' ')
    .trim()
    .replace(/[\s\p{P}]+$/u, '');

/**
 * The description the row shows (ISC-249): the goal line as core gives it, or null when it is empty or says nothing
 * the title does not, compared after normalizing whitespace and trailing punctuation; the shown text is never changed.
 */
const descriptionOf = (goal: string, title: string): string | null =>
  goal === '' || compared(goal) === compared(title) ? null : goal;

/** The row's `waits` as core sends it (`SpecWait`), passed through; null unless it names at least one blocker. */
const waitsOf = (value: unknown): SpecWait | null =>
  isLoose(value) && Array.isArray(value['blockers']) && value['blockers'].length > 0 ? (value as unknown as SpecWait) : null;

export function readSpecRows(body: unknown): SpecTableRow[] {
  return listOf(body, 'specs').flatMap((row): SpecTableRow[] => {
    const id = text(row['id']);
    if (id === null) return [];
    const progress = isLoose(row['progress']) ? row['progress'] : {};
    const takeable = Array.isArray(row['takeable']) ? row['takeable'].flatMap((claim) => text(claim) ?? []) : [];
    const goal = text(row['goal'])?.trim() ?? '';
    const holder = Array.isArray(row['taken']) ? row['taken'].find(isLoose) : undefined;
    const title = text(row['title']) ?? id;
    return [
      {
        id,
        title,
        type: text(row['type']),
        priority: priorityOf(row['priority']),
        phase: text(row['phase']),
        stage: text(row['stage']) ?? 'plan',
        stageGroup: stageGroupOf(row['stageGroup']),
        closed: count(progress['closed']),
        total: count(progress['total']),
        nextCommand: text(row['nextCommand']),
        nextReason: text(row['nextReason']) ?? '',
        takeable,
        warnings: Array.isArray(row['warnings']) ? row['warnings'].length : 0,
        fog: count(row['fog']),
        description: descriptionOf(goal, title),
        agent: holder === undefined ? null : text(holder['session']),
        waits: waitsOf(row['waits']),
      },
    ];
  });
}

/** The archive rows in model order, with their claims, goal and archive date (spec 050, T1, ISC-287). */
export function readArchiveRows(body: unknown): ArchiveRow[] {
  return listOf(body, 'archive').flatMap((row): ArchiveRow[] => {
    const id = text(row['id']);
    if (id === null) return [];
    const claims = isLoose(row['claims']) ? row['claims'] : {};
    return [
      {
        id,
        slug: text(row['slug']) ?? id,
        title: text(row['title']) ?? id,
        type: text(row['type']),
        closed: count(claims['closed']),
        total: count(claims['total']),
        goal: text(row['goal'])?.trim() ?? '',
        archived: text(row['archived']),
      },
    ];
  });
}

/**
 * Spec 050 (T1, ISC-287): an archived spec as a row of the list. It is done and carries no priority, stage group,
 * phase, next step, lock or wait; its meter reads the live claims and its description the goal (ISC-249), and the
 * archive mark sets it apart from every active row.
 */
export function archivedTableRow(row: ArchiveRow): SpecTableRow {
  return {
    id: row.id,
    title: row.title,
    type: row.type,
    priority: null,
    phase: null,
    stage: 'done',
    stageGroup: null,
    closed: row.closed,
    total: row.total,
    nextCommand: null,
    nextReason: '',
    takeable: [],
    warnings: 0,
    fog: 0,
    description: descriptionOf(row.goal, row.title),
    agent: null,
    waits: null,
    archived: { on: row.archived },
  };
}

/** The chip counts from the model's `kpis`, passed through; null when the body carries none. */
export function readListCounts(body: unknown): SpecListCounts | null {
  const kpis = isLoose(body) ? body['kpis'] : null;
  if (!isLoose(kpis)) return null;
  const groups = isLoose(kpis['stageGroups']) ? kpis['stageGroups'] : {};
  const types = isLoose(kpis['byType']) ? kpis['byType'] : {};
  return {
    specs: count(kpis['specs']),
    stageGroups: { scoping: count(groups['scoping']), building: count(groups['building']), complete: count(groups['complete']) },
    specsWithFog: count(kpis['specsWithFog']),
    byType: Object.fromEntries(Object.entries(types).flatMap(([type, n]) => (typeof n === 'number' && Number.isFinite(n) ? [[type, n]] : []))),
  };
}

/** Reads the query state from anything with `get` (the router's `ParamMap`); unknown values fall back to defaults. */
export function parseListQuery(params: { get(name: string): string | null }): ListQuery {
  const phase = params.get('phase');
  const type = params.get('type');
  const sort = params.get('sort');
  return {
    phase: phase === FOG ? FOG : stageGroupOf(phase),
    type: type === null || type === '' || type === ALL ? null : type,
    sort: SORT_KEYS.find((key) => key === sort) ?? DEFAULT_QUERY.sort,
    takeable: params.get('takeable') === '1',
    archived: params.get('archived') === '1',
  };
}

/** The query params for `query`; a default is null, so the URL carries only what differs. */
export function listQueryParams(query: ListQuery): Record<'phase' | 'type' | 'sort' | 'takeable', string | null> & { readonly archived: '1' | null } {
  return {
    phase: query.phase,
    type: query.type,
    sort: query.sort === DEFAULT_QUERY.sort ? null : query.sort,
    takeable: query.takeable ? '1' : null,
    archived: query.archived ? '1' : null,
  };
}

const ratio = (row: SpecTableRow): number => (row.total > 0 ? row.closed / row.total : 0);
const nextRank = (row: SpecTableRow): number => (row.takeable.length > 0 ? 0 : row.nextCommand !== null ? 1 : 2);
const byId = (a: SpecTableRow, b: SpecTableRow): number => a.id.localeCompare(b.id, 'en', { numeric: true });

function matchesPhase(row: SpecTableRow, phase: string | null): boolean {
  if (phase === null) return true;
  return phase === FOG ? row.fog > 0 : row.stageGroup === phase;
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

/**
 * The phase chips: All, each stage group with a spec in lifecycle order, then fog when a spec has open fog; every count
 * is the model's (`kpis.specs`, `kpis.stageGroups`, `kpis.specsWithFog`), none without the model.
 */
export function phaseOptions(counts: SpecListCounts | null): ListOption[] {
  if (counts === null) return [];
  return [
    { key: ALL, count: counts.specs },
    ...STAGE_GROUPS.filter((group) => counts.stageGroups[group] > 0).map((key) => ({ key, count: counts.stageGroups[key] })),
    ...(counts.specsWithFog > 0 ? [{ key: FOG, count: counts.specsWithFog }] : []),
  ];
}

/**
 * The type chips, alphabetical, with the model's counts (`kpis.byType`, `kpis.specs` for All); none when the workspace
 * holds fewer than two types (design.md § Tablet) or without the model.
 */
export function typeOptions(counts: SpecListCounts | null): ListOption[] {
  if (counts === null) return [];
  const types = Object.keys(counts.byType).sort((a, b) => a.localeCompare(b));
  if (types.length < 2) return [];
  return [{ key: ALL, count: counts.specs }, ...types.map((key) => ({ key, count: counts.byType[key] ?? 0 }))];
}

import type { Priority, SpecWait } from '../../../../../../core/src/files';
import { holderOf } from '../../../core/model/working';
import { STAGE_ORDER } from '../../../shared/ui/stage-tone';
import { ALL, FOG, stagesOf } from './stage-filter';
import { featureOf, type FeatureFields } from './feature-fields';
import type { Tone } from '../../../shared/ui/tone';
import { count, isLoose, type Loose, text } from '../../../layout/shell/loose';

/**
 * The Specs panel's view of the dashboard model (T63, ISC-61). Nothing here counts or derives a spec's state: every
 * field is read from the rows `core/src/dashboard.ts` built (the body stays `unknown` in web until core's dashboard
 * types move to a browser-safe module, see `DashboardBody`), and the helpers only filter and order those rows by the
 * query state the URL carries (`?stage=&type=&sort=&takeable=&working=&archived=`, design.md § Routes and state).
 */

/** One active spec as the panel renders it: the fields of `DashboardSpecRow` the row shows (the feature ones optional). */
export interface SpecTableRow extends Partial<FeatureFields> {
  readonly id: string;
  /**
   * The folder name (`NNN-slug`), the key a favourite is stored under (spec 052, T18, ISC-300). Optional so hand-built
   * rows in specs need not name it, as `SpecRowView.slug`.
   */
  readonly slug?: string;
  readonly title: string;
  readonly type: string | null;
  /** Frontmatter `priority:` as core reads it (`P3` when absent or invalid); null only when the row carries none. */
  readonly priority: Priority | null;
  /** Frontmatter `phase:` as written. */
  readonly phase: string | null;
  /** The derived stage (`plan` … `done`). */
  readonly stage: string;
  /** The row's stage group as core derives it (`stageGroup`); null when absent. The stage chips filter by `stage`. */
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
  /**
   * The session holding a lock on one of the spec's claims (the first in claim order); null without locks. Read through
   * `holderOf`, the source the "In Arbeit" list (`workingOf`) reads too (spec 064, T2, ISC-466).
   */
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
/** The sorts the panel's sort menu offers (Stage / ID / Progress); `?sort=next` still parses. */
export const SORT_MENU: readonly SortKey[] = ['stage', 'id', 'progress'];

/**
 * The panel's query state. `stage` lists the stages a row may stand in (`STAGE_ORDER`), plus `fog` (open fog) and
 * `idea` (the ideas, spec 064, ISC-480), in `STAGE_FILTERS` order (spec 064, T62, ISC-503); null means all. The URL
 * carries it as `?stage=<stage>[,<stage>…]`; an old `?phase=` address is mapped onto it by the router (`stagesOfPhase`).
 */
export interface ListQuery {
  readonly stage: readonly string[] | null;
  /** Spec 064 (T39, ISC-480): the search `?q=`, trimmed; absent when empty. The URL keeps it (the page merges params). */
  readonly q?: string;
  readonly type: string | null;
  readonly sort: SortKey;
  readonly takeable: boolean;
  /**
   * Spec 064 (T3, ISC-465): only the specs with an agent, the rows `holderOf` gives a lock holder (`?working=1`), the
   * list "In Arbeit" links to; off by default.
   */
  readonly working: boolean;
  /** Spec 050 (T1, ISC-287): the archived specs show under the active ones (`?archived=1`); off by default. */
  readonly archived: boolean;
}

export const DEFAULT_QUERY: ListQuery = { stage: null, type: null, sort: 'stage', takeable: false, working: false, archived: false };

export { ALL, FOG, IDEA, STAGE_FILTERS, stagesOfPhase } from './stage-filter';

/** The stage groups core derives (`StageGroup` in `core/src/dashboard.ts`), in lifecycle order. */
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
 * The counts the filter chips show, every one the model's (spec 021, ISC-255): `kpis` and the active specs per stage
 * `stageCounts`, the numbers the Specs tile's split shows too (spec 064, ISC-502, ISC-503).
 */
export interface SpecListCounts {
  /** Every active spec: the `all` chips. */
  readonly specs: number;
  /** The active specs per stage (`DashboardModel.stageCounts`; counted from the body's rows only when it has none). */
  readonly stages: Readonly<Partial<Record<string, number>>>;
  /** The active specs with open fog: the fog chip. */
  readonly specsWithFog: number;
  /** The active specs per type present: the type chips. */
  readonly byType: Readonly<Record<string, number>>;
}

const PRIORITIES: readonly Priority[] = ['P1', 'P2', 'P3', 'P4'];
const priorityOf = (value: unknown): Priority | null => PRIORITIES.find((level) => level === value) ?? null;
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
    const title = text(row['title']) ?? id;
    const slug = text(row['slug']);
    return [
      {
        id,
        ...(slug !== null ? { slug } : {}),
        title,
        type: text(row['type']),
        priority: priorityOf(row['priority']),
        ...featureOf(row),
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
        agent: holderOf(row)?.session ?? null,
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
  const types = isLoose(kpis['byType']) ? kpis['byType'] : {};
  const served = isLoose(body) && isLoose(body['stageCounts']) ? body['stageCounts'] : null;
  const counted = (stage: string): number => listOf(body, 'specs').filter((row) => row['stage'] === stage).length;
  return {
    specs: count(kpis['specs']),
    stages: Object.fromEntries(STAGE_ORDER.map((stage) => [stage, served === null ? counted(stage) : count(served[stage])])),
    specsWithFog: count(kpis['specsWithFog']),
    byType: Object.fromEntries(Object.entries(types).flatMap(([type, n]) => (typeof n === 'number' && Number.isFinite(n) ? [[type, n]] : []))),
  };
}

/** Reads the query state from anything with `get` (the router's `ParamMap`); unknown values fall back to defaults. */
export function parseListQuery(params: { get(name: string): string | null }): ListQuery {
  const type = params.get('type');
  const sort = params.get('sort');
  const q = params.get('q')?.trim() ?? '';
  return {
    stage: stagesOf(params.get('stage')),
    ...(q !== '' ? { q } : {}),
    type: type === null || type === '' || type === ALL ? null : type,
    sort: SORT_KEYS.find((key) => key === sort) ?? DEFAULT_QUERY.sort,
    takeable: params.get('takeable') === '1',
    working: params.get('working') === '1',
    archived: params.get('archived') === '1',
  };
}

/**
 * Spec 058 (T5, ISC-396): every query param the spec list reads or writes: its filters and sort (`listQueryParams`),
 * the search `q`, the "show all" fold `all` and the row density, and `phase` as an input only, which the router maps
 * onto `stage` (spec 064, T62). A workspace address carrying one of them means the
 * list, so the router sends it on to the Specs page with the same query. `sel` is never one: the dashboard keeps its
 * own selection (ISC-400).
 */
export const LIST_QUERY_KEYS = ['stage', 'phase', 'type', 'sort', 'takeable', 'working', 'archived', 'q', 'all', 'density'] as const;
export type ListQueryKey = (typeof LIST_QUERY_KEYS)[number];

/** The query params for `query`; a default is null, so the URL carries only what differs. Every key is a list key. */
export function listQueryParams(
  query: ListQuery,
): Pick<Record<ListQueryKey, string | null>, 'stage' | 'type' | 'sort' | 'takeable'> & { readonly working: '1' | null; readonly archived: '1' | null } {
  return {
    stage: query.stage === null ? null : query.stage.join(','),
    type: query.type,
    sort: query.sort === DEFAULT_QUERY.sort ? null : query.sort,
    takeable: query.takeable ? '1' : null,
    working: query.working ? '1' : null,
    archived: query.archived ? '1' : null,
  };
}

const ratio = (row: SpecTableRow): number => (row.total > 0 ? row.closed / row.total : 0);
const nextRank = (row: SpecTableRow): number => (row.takeable.length > 0 ? 0 : row.nextCommand !== null ? 1 : 2);
const byId = (a: SpecTableRow, b: SpecTableRow): number => a.id.localeCompare(b.id, 'en', { numeric: true });

/** A row stands in one of the listed stages, or has open fog with `fog` listed; `idea` alone keeps no spec row. */
function matchesStage(row: SpecTableRow, stages: readonly string[] | null): boolean {
  if (stages === null) return true;
  return stages.includes(row.stage) || (stages.includes(FOG) && row.fog > 0);
}

/** The rows the panel shows for `query`: filtered, then ordered; `Array.prototype.sort` is stable on the model order. */
export function applyListQuery(rows: readonly SpecTableRow[], query: ListQuery): SpecTableRow[] {
  const kept = rows.filter(
    (row) =>
      matchesStage(row, query.stage) &&
      (query.type === null || row.type === query.type) &&
      (!query.takeable || row.takeable.length > 0) &&
      (!query.working || row.agent !== null),
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
 * Spec 050 (T5, ISC-288): the archived rows the panel shows under the active ones for `query` (design.md § Across
 * viewports). None while the switch is off, under a stage, fog or idea chip, with takeable on or with working on (an archived
 * spec holds no lock, spec 064, ISC-465); the type filter reaches them.
 * The block orders on its own, never interleaved with the active rows: Stage and Next by ID descending (the last
 * archived at the boundary), ID ascending, Progress by claim ratio descending, ties by ID descending. An empty archive
 * yields none, so `?archived=1` alone changes nothing.
 */
export function applyArchivedQuery(rows: readonly ArchiveRow[], query: ListQuery): SpecTableRow[] {
  if (!query.archived || query.stage !== null || query.takeable || query.working) return [];
  const kept = rows.map(archivedTableRow).filter((row) => query.type === null || row.type === query.type);
  switch (query.sort) {
    case 'stage':
    case 'next':
      return kept.sort((a, b) => byId(b, a));
    case 'id':
      return kept.sort(byId);
    case 'progress':
      return kept.sort((a, b) => ratio(b) - ratio(a) || byId(b, a));
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
 * The stage chips (spec 064, T62, ISC-503): All, each stage with a spec in workflow order (`STAGE_ORDER`), then fog when
 * a spec has open fog; every count is the model's (`kpis.specs`, `stageCounts`, `kpis.specsWithFog`), none without it.
 * All counts what it shows (ISC-512): the active specs plus the `ideas` the list receives; a stage chip only its specs.
 */
export function stageOptions(counts: SpecListCounts | null, ideas = 0): ListOption[] {
  if (counts === null) return [];
  return [
    { key: ALL, count: counts.specs + ideas },
    ...STAGE_ORDER.flatMap((key) => ((counts.stages[key] ?? 0) > 0 ? [{ key, count: counts.stages[key] ?? 0 }] : [])),
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

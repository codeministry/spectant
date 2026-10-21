import type { SpecType, WorkflowStage } from '../../../../../core/src/files';
import { isWorkflowStage, WORKFLOW_TYPES } from '../../../../../core/src/stage';

/**
 * The board query (spec 008, ISC-129.1): `?feature=…&milestone=…&type=…&assignee=…&group=…&col=…` parsed and serialised
 * here, so the router and the remembered `board-query` share one grammar. The board's view model is `board.ts`.
 */

// ─── The query (ISC-129.1) ──────────────────────────────────────────────────────────────────────────────────────────

export const BOARD_GROUPS = ['none', 'feature', 'milestone'] as const;
export type BoardGroup = (typeof BOARD_GROUPS)[number];

/** A card's type for the Type filter: a spec type, or `idea` for every story whatever its `type:`. */
export type BoardCardType = SpecType | 'idea';

/** The filter value for a card without a feature or a milestone, and for an unassigned card. */
export const NO_FEATURE = 'none';
export const NO_MILESTONE = 'none';
export const UNASSIGNED = 'unassigned';

/** The board's URL state: four filters (values OR'ed within a key, keys AND'ed), the swimlane group, `?col` and the folds. */
export interface BoardQueryState {
  /** Main feature ids (`F6`), or `none`. */
  readonly feature: readonly string[];
  /** Milestone names as written, or `none`. */
  readonly milestone: readonly string[];
  readonly type: readonly BoardCardType[];
  /** Actor ids (`u:…`, `a:…`), or `unassigned`. */
  readonly assignee: readonly string[];
  readonly group: BoardGroup;
  /** The visible column at compact; null for the default. */
  readonly col: WorkflowStage | null;
  /** Columns without a shown card the viewer opened (`?open=`); such a column is folded by default. */
  readonly open: readonly WorkflowStage[];
  /** Columns with cards the viewer folded (`?fold=`); such a column is open by default. */
  readonly fold: readonly WorkflowStage[];
  /** Free text over id, slug, title and feature (`?q=`, spec 024 toolbar search); absent when blank. */
  readonly q?: string;
}

export const EMPTY_BOARD_QUERY: BoardQueryState = { feature: [], milestone: [], type: [], assignee: [], group: 'none', col: null, open: [], fold: [] };

const LIST_KEYS = ['feature', 'milestone', 'type', 'assignee'] as const;
export const CARD_TYPES: readonly BoardCardType[] = [...WORKFLOW_TYPES, 'idea'];
const isCardType = (value: string): value is BoardCardType => CARD_TYPES.some((t) => t === value);
const isGroup = (value: string): value is BoardGroup => BOARD_GROUPS.some((g) => g === value);

/** A query source: the router's query params (a value or a repeated key's array), a `URLSearchParams`, or its string. */
export type BoardQuerySource = Readonly<Record<string, unknown>> | URLSearchParams | string;

function valuesOf(source: BoardQuerySource, key: string): string[] {
  if (typeof source === 'string') return new URLSearchParams(source).getAll(key);
  if (source instanceof URLSearchParams) return source.getAll(key);
  const value = source[key];
  if (typeof value === 'string') return [value];
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/** Unique non-blank values in first-seen order. */
const distinct = (values: readonly string[]): string[] => [...new Set(values.filter((v) => v.trim() !== ''))];

/** The board query of a URL: unknown types, groups and columns and blank or repeated values are dropped. */
export function parseBoardQuery(source: BoardQuerySource): BoardQueryState {
  const group = valuesOf(source, 'group').find(isGroup) ?? 'none';
  const col = valuesOf(source, 'col').find(isWorkflowStage) ?? null;
  const q = valuesOf(source, 'q').map((v) => v.trim()).find((v) => v !== '');
  return {
    ...(q === undefined ? {} : { q }),
    feature: distinct(valuesOf(source, 'feature')),
    milestone: distinct(valuesOf(source, 'milestone')),
    type: distinct(valuesOf(source, 'type')).filter(isCardType),
    assignee: distinct(valuesOf(source, 'assignee')),
    group,
    col,
    open: distinct(valuesOf(source, 'open')).filter(isWorkflowStage),
    fold: distinct(valuesOf(source, 'fold')).filter(isWorkflowStage),
  };
}

/**
 * The query as router `queryParams`, defaults left out: a list key is an array, which the router writes as one repeated
 * key per value (so a value may hold any character, a comma included); `group: none` and `col: null` are absent.
 */
export function boardQueryParams(query: BoardQueryState): Record<string, string | string[]> {
  const params: Record<string, string | string[]> = {};
  for (const key of LIST_KEYS) {
    const values = distinct(query[key]);
    if (values.length > 0) params[key] = values;
  }
  if (query.group !== 'none') params['group'] = query.group;
  if (query.col !== null) params['col'] = query.col;
  if (query.q !== undefined && query.q.trim() !== '') params['q'] = query.q.trim();
  for (const key of ['open', 'fold'] as const) {
    const stages = distinct(query[key]);
    if (stages.length > 0) params[key] = stages;
  }
  return params;
}

/** The query as the string `board-query` stores (without `?`), keys in a fixed order; `''` for the defaults. */
export function boardQueryString(query: BoardQueryState): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(boardQueryParams(query))) {
    for (const v of typeof value === 'string' ? [value] : value) search.append(key, v);
  }
  return search.toString();
}

/** How many filter values are set; the group and the column are not filters. */
export const activeFilterCount = (query: BoardQueryState): number =>
  LIST_KEYS.reduce((n, key) => n + query[key].length, 0) + (query.q !== undefined && query.q.trim() !== '' ? 1 : 0);

/** The four filter keys of the board query, in toolbar order. */
export type BoardFilterKey = (typeof LIST_KEYS)[number];
export const BOARD_FILTER_KEYS: readonly BoardFilterKey[] = LIST_KEYS;

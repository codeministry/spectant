import type { ItemStateInfo } from '../../../../../../core/src/files';
import { isLoose, text } from '../../../layout/shell/loose';
import { featureOf } from './feature-fields';
import { IDEA, type ListOption, type ListQuery, type SpecTableRow } from './spec-table-model';

/**
 * Spec 064 (T37, T39; ISC-479, ISC-480): the Specs list's view of the backlog's stories, read from the dashboard body's
 * `ideas.list` as served (nothing derived here), and filtered by the list's query state beside the spec rows of
 * `spec-table-model.ts`.
 */

/** One story as `DashboardModel.ideas.list` carries it; only these fields are read. */
export interface DashboardIdea {
  readonly slug: string;
  readonly title: string;
  readonly feature: string | null;
  /** The feature block's name from the master; optional so hand-built stories in specs need not name it. */
  readonly featureName?: string | null;
  readonly milestone: string | null;
  readonly priority: string;
  /** The story's item state (spec 040, ISC-224); absent when the server read it without a clock. */
  readonly state?: ItemStateInfo;
}

/**
 * The stories of the body's `ideas.list` as the list's idea rows, in model order; none when `ideas` is missing or
 * malformed. A story without a slug is skipped, its title falls back to the slug and its priority to `P3`; a `state`
 * object passes through as served.
 */
export function readIdeaRows(body: unknown): readonly DashboardIdea[] {
  const ideas = isLoose(body) ? body['ideas'] : null;
  const list = isLoose(ideas) ? ideas['list'] : null;
  if (!Array.isArray(list)) return [];
  return list.filter(isLoose).flatMap((row): DashboardIdea[] => {
    const slug = text(row['slug']);
    if (slug === null) return [];
    const state = isLoose(row['state']) ? { state: row['state'] as unknown as ItemStateInfo } : {};
    return [{ slug, title: text(row['title']) ?? slug, ...featureOf(row), priority: text(row['priority']) ?? 'P3', ...state }];
  });
}

/** Every word of `q` in `title`, case-insensitive (the board's search match, `core/model/board.ts`); true without one. */
function titleMatches(title: string, q: string | undefined): boolean {
  const folded = title.toLowerCase();
  return (q ?? '').toLowerCase().split(/\s+/u).every((word) => folded.includes(word));
}

/**
 * The ideas the list shows for `query`, in model order: all of them with no stage filter or with `idea` among the
 * stages (`?stage=idea`, under which alone `applyListQuery` keeps no spec row, spec 064, T62), none under a stage
 * filter without it, under takeable or working (an idea has no stage, claim or lock), and none under any type filter
 * (T41), as a story carries no type. The search `q` narrows them by title.
 */
export function applyIdeaQuery(ideas: readonly DashboardIdea[], query: ListQuery): readonly DashboardIdea[] {
  if ((query.stage !== null && !query.stage.includes(IDEA)) || query.type !== null || query.takeable || query.working) return [];
  return ideas.filter((idea) => titleMatches(idea.title, query.q));
}

/** The stage chips with the chip "ideas" closing them (T41, T62) while the workspace holds a story; none without chips. */
export function withIdeaOption(options: readonly ListOption[], ideas: number): ListOption[] {
  return [...options, ...(ideas > 0 && options.length > 0 ? [{ key: IDEA, count: ideas }] : [])];
}

/** The ideas' place among the list's entries (T41): one entry, in whose place the idea rows render, no heading (T49). */
export const IDEAS_GROUP = { id: 'group:ideas', group: 'ideas' } as const;
export type ListEntry = SpecTableRow | typeof IDEAS_GROUP;

/**
 * The list's entries (spec 064, T41, ISC-479): the active rows, the ideas' entry when there is one, then the archived
 * rows, split into those always in view and those behind "show all N" right after the `cap`-th spec row, so the cap
 * counts spec rows only and the group stands in whichever part holds the row after the last active one.
 */
export function listEntries(active: readonly SpecTableRow[], ideas: number, archived: readonly SpecTableRow[], cap: number): { head: ListEntry[]; rest: ListEntry[] } {
  const entries: ListEntry[] = [...active, ...(ideas > 0 ? [IDEAS_GROUP] : []), ...archived];
  let specs = 0;
  const split = entries.findIndex((entry) => entry !== IDEAS_GROUP && ++specs > cap);
  return split < 0 ? { head: entries, rest: [] } : { head: entries.slice(0, split), rest: entries.slice(split) };
}

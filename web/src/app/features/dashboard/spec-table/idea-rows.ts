import type { ItemStateInfo } from '../../../../../../core/src/files';
import { isLoose, text } from '../../../layout/shell/loose';
import { IDEA, type ListQuery } from './spec-table-model';

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
    const [feature, milestone] = [text(row['feature']), text(row['milestone'])];
    return [{ slug, title: text(row['title']) ?? slug, feature, milestone, priority: text(row['priority']) ?? 'P3', ...state }];
  });
}

/** Every word of `q` in `title`, case-insensitive (the board's search match, `core/model/board.ts`); true without one. */
function titleMatches(title: string, q: string | undefined): boolean {
  const folded = title.toLowerCase();
  return (q ?? '').toLowerCase().split(/\s+/u).every((word) => folded.includes(word));
}

/**
 * The ideas the list shows for `query`, in model order: all of them with no phase or the phase `idea` (under which
 * `applyListQuery` keeps no spec row, as no stage group is `idea`), none under any other phase, fog, takeable or
 * working (an idea has no stage, claim or lock). The search `q` narrows them by title; the type filter does not reach
 * them, as a story carries no type.
 */
export function applyIdeaQuery(ideas: readonly DashboardIdea[], query: ListQuery): readonly DashboardIdea[] {
  if ((query.phase !== null && query.phase !== IDEA) || query.takeable || query.working) return [];
  return ideas.filter((idea) => titleMatches(idea.title, query.q));
}

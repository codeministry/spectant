import { computed, inject, Injectable, signal, untracked } from '@angular/core';
import type { Favorites } from '../../../../../../server/src/contracts/spec-routes.contract';
import { ApiClient, type ApiResult, type DashboardBody } from '../../../core/api.service';
import { type IdeaFavoriteView, ideasOf, rowsOf, ShellData, type SpecRowView } from '../shell-data.service';
import { ShellState } from '../shell-state.service';

/**
 * One workspace's block in the header's favourites select (spec 069, ISC-557): its slug and name for the head, its
 * favourite specs in the order of its spec list, then its favourite stories in dashboard order. Only a workspace with
 * at least one favourite has a group.
 */
export interface FavoriteGroup {
  readonly ws: string;
  readonly name: string;
  readonly specs: readonly SpecRowView[];
  readonly ideas: readonly IdeaFavoriteView[];
}

/** A favourite spec row's target, in its own workspace: `/w/<ws>/s/<id>`. */
export const favoriteSpecLink = (ws: string, id: string): readonly string[] => ['/w', ws, 's', id];

/** A favourite story row's target, in its own workspace: `/w/<ws>/ideas/<slug>`. */
export const favoriteIdeaLink = (ws: string, slug: string): readonly string[] => ['/w', ws, 'ideas', slug];

/** One other workspace's favourites as its answers give them: the stored sets narrowed to what its dashboard lists. */
interface Listed {
  readonly specs: readonly SpecRowView[];
  readonly ideas: readonly IdeaFavoriteView[];
}

/**
 * The stored sets of `favorites` narrowed by `dashboard` (ISC-561): a spec folder that is no open spec row (archived,
 * deleted, renamed) and a slug the dashboard lists no story for drop out. Null when either answer is not `ok`: such a
 * workspace has no group, and the others keep theirs.
 */
function listed(favorites: ApiResult<Favorites>, dashboard: ApiResult<DashboardBody>): Listed | null {
  if (favorites.kind !== 'ok' || dashboard.kind !== 'ok') return null;
  const specIds = new Set(favorites.body.specs);
  const ideaSlugs = new Set(favorites.body.ideas);
  return {
    specs: rowsOf(dashboard.body, 'specs').filter((row) => specIds.has(row.slug ?? row.id)),
    ideas: ideasOf(dashboard.body).filter((idea) => ideaSlugs.has(idea.slug)),
  };
}

/**
 * The favourites of every registered, readable workspace for the header's favourites select (spec 069, T1, T3). The
 * web app gathers them alone, without a server route: the open workspace's sets come from `ShellData` (`favoriteRows`,
 * `favoriteIdeas`) and follow every star at once; each other workspace's come from its own `favorites` and `dashboard`
 * answers over `ApiClient` (ETag cache), read on every `load()` and not before the first, so nothing loads at app start.
 */
@Injectable({ providedIn: 'root' })
export class FavoritesIndex {
  private readonly api = inject(ApiClient);
  private readonly data = inject(ShellData);
  private readonly state = inject(ShellState);

  /** Each other workspace's last answer (`null`: unreadable); a reload keeps it until the new one lands. */
  private readonly answers = signal<ReadonlyMap<string, Listed | null>>(new Map());
  private readonly pending = signal(0);
  private loads = 0;

  /** A load of the other workspaces runs. */
  readonly loading = computed(() => this.pending() > 0);

  /**
   * The groups in the order of the workspace list (the picker's), an unreadable entry skipped; a workspace without a
   * favourite, or not answered yet, has none. Empty is the select's empty state.
   */
  readonly groups = computed<readonly FavoriteGroup[]>(() => {
    const open = this.state.ws();
    const answers = this.answers();
    return this.data.workspaceList().flatMap((entry): FavoriteGroup[] => {
      if (!entry.readable) return [];
      const sets = entry.slug === open ? { specs: this.data.favoriteRows(), ideas: this.data.favoriteIdeas() } : answers.get(entry.slug);
      if (sets === undefined || sets === null || sets.specs.length + sets.ideas.length === 0) return [];
      return [{ ws: entry.slug, name: entry.name, specs: sets.specs, ideas: sets.ideas }];
    });
  });

  /**
   * Reads every other readable workspace's favourites and dashboard, called on every open of the select. Each answer
   * lands on its own; an answer of an older load is dropped. Resolves when this load's answers are in.
   */
  load(): Promise<void> {
    return untracked(() => this.loadOthers());
  }

  private async loadOthers(): Promise<void> {
    const load = ++this.loads;
    const open = this.state.ws();
    const slugs = this.data
      .workspaceList()
      .filter((entry) => entry.readable && entry.slug !== open)
      .map((entry) => entry.slug);
    this.answers.update((answers) => new Map([...answers].filter(([slug]) => slugs.includes(slug))));
    this.pending.set(slugs.length);
    await Promise.all(
      slugs.map(async (slug) => {
        const value = await Promise.all([this.api.favorites(slug), this.api.dashboard(slug)]).then(
          ([favorites, dashboard]) => listed(favorites, dashboard),
          () => null,
        );
        if (load !== this.loads) return;
        this.answers.update((answers) => new Map(answers).set(slug, value));
        this.pending.update((count) => count - 1);
      }),
    );
  }
}

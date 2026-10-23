import { computed, inject, Injectable, signal, untracked } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import type { Favorites } from '../../../../../../server/src/contracts/spec-routes.contract';
import { ApiClient, type ApiResult, type DashboardBody, type PutResult } from '../../../core/api.service';
import { ToastService } from '../../../shared/ui/toast/toast';
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

/** `listed` without the rows `drop` names: a spec row by its folder, a story by its slug. */
function narrowed(listed: Listed, drop: (kind: keyof Favorites, id: string) => boolean): Listed {
  return {
    specs: listed.specs.filter((row) => !drop('specs', row.slug ?? row.id)),
    ideas: listed.ideas.filter((idea) => !drop('ideas', idea.slug)),
  };
}

/** The key of a row an unstar in flight hides: workspace, kind and id. */
const hiddenKey = (ws: string, kind: keyof Favorites, id: string): string => `${ws} ${kind} ${id}`;

/** What a rejected DELETE counts as: a failed write. */
const failed: PutResult<Favorites> = { kind: 'error', status: 0, error: null };

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
  private readonly toast = inject(ToastService);
  private readonly transloco = inject(TranslocoService);

  /** Each other workspace's last answer (`null`: unreadable); a reload keeps it until the new one lands. */
  private readonly answers = signal<ReadonlyMap<string, Listed | null>>(new Map());
  /** The rows of other workspaces whose DELETE is in flight (`hiddenKey`): out of their group until it answers. */
  private readonly hidden = signal<ReadonlySet<string>>(new Set());
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
    const hidden = this.hidden();
    return this.data.workspaceList().flatMap((entry): FavoriteGroup[] => {
      if (!entry.readable) return [];
      const answer = answers.get(entry.slug);
      const sets =
        entry.slug === open
          ? { specs: this.data.favoriteRows(), ideas: this.data.favoriteIdeas() }
          : answer && narrowed(answer, (kind, id) => hidden.has(hiddenKey(entry.slug, kind, id)));
      if (sets === undefined || sets === null || sets.specs.length + sets.ideas.length === 0) return [];
      return [{ ws: entry.slug, name: entry.name, specs: sets.specs, ideas: sets.ideas }];
    });
  });

  /**
   * Unsets the favourite `id` (a spec folder or a story slug) of `ws` from a row's star (spec 069, T5, T7; ISC-559,
   * ISC-560). The open workspace's goes through `ShellData`, so every star on its pages flips with it; it never stars,
   * so a row that is no favourite any more sends nothing. Another workspace's row leaves its group at once while the
   * DELETE runs on that workspace's own route; on a failure it comes back at its place and the toast says
   * `favorites.failed`. A group left without a row drops out of `groups`. Resolves true when the server accepted it.
   */
  async unstar(ws: string, kind: keyof Favorites, id: string): Promise<boolean> {
    if (ws === this.state.ws()) {
      if (kind === 'specs') return this.data.isFavorite(id) ? this.data.toggleFavorite(id) : false;
      return this.data.isIdeaFavorite(id) ? this.data.toggleIdeaFavorite(id) : false;
    }
    const key = hiddenKey(ws, kind, id);
    if (this.hidden().has(key)) return false;
    this.hidden.update((keys) => new Set(keys).add(key));
    const write = kind === 'specs' ? this.api.deleteFavorite(ws, id) : this.api.deleteIdeaFavorite(ws, id);
    const result = await write.catch(() => failed);
    if (result.kind === 'ok') {
      this.answers.update((answers) => {
        const answer = answers.get(ws);
        return answer ? new Map(answers).set(ws, narrowed(answer, (dropKind, dropId) => dropKind === kind && dropId === id)) : answers;
      });
    }
    this.hidden.update((keys) => new Set([...keys].filter((entry) => entry !== key)));
    if (result.kind === 'ok') return true;
    this.toast.show(this.transloco.translate('favorites.failed'));
    return false;
  }

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

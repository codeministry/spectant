/**
 * The favourites' share of the workspace scan (spec 057 T1, ISC-352): after a watcher change of workspace `ws`, every
 * `spec_favorite` row whose spec the main checkout no longer has as an open folder under `specs/` (archived under
 * `specs/archive/`, or gone) and no live spec worktree carries as its own folder (`readWorktreeView`'s `worktreeOnly`,
 * spec 039) is deleted, so a spec brought back from the archive carries no old star. The live stream runs it before
 * each build (`eventsApi`'s `scan`, wired by the CLI through `watch.ts`); no GET handler calls it (ISC-353). A
 * workspace whose `specs/` cannot be listed (not there, mid-checkout, unmounted) prunes nothing: an unreadable tree is
 * no proof a spec left.
 *
 * The same scan settles the idea favourites (spec 064 T52, ISC-496): an `idea_favorite` row whose story
 * `specs/ideas/<slug>.md` the workspace no longer has (`readIdeaSources`, the stories the dashboard lists) moves to the
 * open spec `NNN-<slug>` with the same slug, the allocation in the app or through `/spec new`, and lapses without one;
 * an archived spec is no target. A story that is still there keeps its star.
 */
import { join } from "node:path";
import { listSpecs } from "../../../core/src/resolve.ts";
import { specSlugOf } from "../../../core/src/spec-ref.ts";
import type { Db } from "../infra/db/db.ts";
import { listIdeaFavorites, pruneFavorites, settleIdeaFavorites } from "../infra/db/prefs-store.ts";
import type { Registry } from "../infra/db/registry.ts";
import { existsFollowing } from "../infra/fs/exists.ts";
import { readIdeaSources, readWorktreeView } from "../workspace/index.ts";

/** The scan over one change; it reads the change's workspace slug alone (a `LiveChange` of `watch.ts`). */
export function favoritesScan(options: {
  readonly db: Db;
  readonly registry: Pick<Registry, "get">;
}): (change: { readonly ws: string }) => Promise<void> {
  return async (change) => {
    const workspace = options.registry.get(change.ws);
    if (workspace === undefined) return;
    const specsDir = join(workspace.path, "specs");
    if (!existsFollowing(specsDir)) return;
    let open: string[];
    let stories: ReadonlySet<string>;
    try {
      const listed = listSpecs(workspace.path);
      const view = await readWorktreeView(workspace.path, listed);
      open = [...listed.flatMap((ref) => (ref.archived ? [] : [ref.slug])), ...view.worktreeOnly.map((ref) => ref.slug)];
      stories = new Set(Object.keys((await readIdeaSources(workspace.path, view)).files));
    } catch {
      return;
    }
    // `listSpecs` reads a missing `specs/` as no specs at all; one removed during the read must not empty the set.
    if (!existsFollowing(specsDir)) return;
    settleIdeaFavorites(options.db, change.ws, ideasGone(listIdeaFavorites(options.db, change.ws), stories, open));
    pruneFavorites(options.db, change.ws, open);
  };
}

/** Each starred slug without its story, with the open spec of the same slug it became (the highest number), or null. */
function ideasGone(starred: readonly string[], stories: ReadonlySet<string>, open: readonly string[]): Array<{ slug: string; spec: string | null }> {
  const sorted = [...open].sort();
  return starred
    .filter((slug) => !stories.has(`${slug}.md`))
    .map((slug) => ({ slug, spec: sorted.findLast((folder) => specSlugOf(folder) === slug) ?? null }));
}

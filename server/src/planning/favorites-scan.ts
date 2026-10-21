/**
 * The favourites' share of the workspace scan (spec 057 T1, ISC-352): after a watcher change of workspace `ws`, every
 * `spec_favorite` row whose spec the main checkout no longer has as an open folder under `specs/` (archived under
 * `specs/archive/`, or gone) and no live spec worktree carries as its own folder (`readWorktreeView`'s `worktreeOnly`,
 * spec 039) is deleted, so a spec brought back from the archive carries no old star. The live stream runs it before
 * each build (`eventsApi`'s `scan`, wired by the CLI through `watch.ts`); no GET handler calls it (ISC-353). A
 * workspace whose `specs/` cannot be listed (not there, mid-checkout, unmounted) prunes nothing: an unreadable tree is
 * no proof a spec left.
 */
import { join } from "node:path";
import { listSpecs } from "../../../core/src/resolve.ts";
import type { Db } from "../infra/db/db.ts";
import { pruneFavorites } from "../infra/db/prefs-store.ts";
import type { Registry } from "../infra/db/registry.ts";
import { existsFollowing } from "../infra/fs/exists.ts";
import { readWorktreeView } from "../workspace/index.ts";

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
    try {
      const listed = listSpecs(workspace.path);
      const { worktreeOnly } = await readWorktreeView(workspace.path, listed);
      open = [...listed.flatMap((ref) => (ref.archived ? [] : [ref.slug])), ...worktreeOnly.map((ref) => ref.slug)];
    } catch {
      return;
    }
    // `listSpecs` reads a missing `specs/` as no specs at all; one removed during the read must not empty the set.
    if (!existsFollowing(specsDir)) return;
    pruneFavorites(options.db, change.ws, open);
  };
}

/**
 * The server's route families in the order they answer (spec 059, ISC-412): the live stream, the writing workspace
 * routes (before the workspace list, whose path they share), the settings, the actors, LifeOS, the workspace routes,
 * the notes, the spec routes and the prototype files. `serve.ts` joins them with every slice's handlers into one
 * router, so `createRouter`'s checks cover every route: each named once, each with exactly one handler.
 */
import { EVENTS_FAMILY } from "../live/index.ts";
import { NOTES_FAMILY } from "../notes/index.ts";
import { PROTOTYPE_FAMILY } from "../prototype/index.ts";
import { ACTORS_FAMILY, LIFEOS_FAMILY, SETTINGS_FAMILY } from "../settings/index.ts";
import { SPEC_FAMILY } from "../spec/index.ts";
import { WORKSPACE_ADMIN_FAMILY } from "../workspace-admin/index.ts";
import { workspaceFamily } from "../workspace/index.ts";

/** Every family, first claim first; `db`: the server has the app database, so the database routes are served. */
export function routeFamilies(options: { readonly db: boolean }) {
  return [
    EVENTS_FAMILY,
    WORKSPACE_ADMIN_FAMILY,
    SETTINGS_FAMILY,
    ACTORS_FAMILY,
    LIFEOS_FAMILY,
    workspaceFamily({ db: options.db }),
    NOTES_FAMILY,
    SPEC_FAMILY,
    PROTOTYPE_FAMILY,
  ] as const;
}

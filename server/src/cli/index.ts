/**
 * The cli slice (spec 059): the `spectant` command line and the server's composition root. Only `main.ts` imports it;
 * `run` and `RunOptions` are its one public surface, beside `dashboardApi`, the workspace routes' composition, which
 * the tests import to build it alone.
 */
export { dashboardApi } from "./dashboard-api.ts";
export type { RunOptions } from "./options.ts";
export { run } from "./run.ts";

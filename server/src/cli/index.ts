/**
 * The cli slice (spec 059): the `spectant` command line and the server's composition root. Only `main.ts` imports it;
 * `run` and `RunOptions` are its one public surface.
 */
export type { RunOptions } from "./options.ts";
export { run } from "./run.ts";

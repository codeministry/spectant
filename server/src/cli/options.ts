/** What `run` takes beside the command line, so tests and embedders can pin what defaults to the process's own. */
import type { CommandRunner } from "../infra/process/open-browser.ts";

export type RunOptions = {
  /**
   * The environment the data directory (`XDG_DATA_HOME`) and the LifeOS state directory (`SPECTANT_LIFEOS_STATE_DIR`)
   * are resolved from. Defaults to `process.env`.
   */
  env?: Record<string, string | undefined>;
  /** The directory a relative `add` or `remove` path resolves against. Defaults to `process.cwd()`. */
  cwd?: string;
  /** Runs the browser opener (`open` / `xdg-open`). Defaults to spawning it; tests record the call instead. */
  browserRunner?: CommandRunner;
  /** Stops `serve` like SIGINT does when aborted, so tests and embedders can end the run. */
  signal?: AbortSignal;
};

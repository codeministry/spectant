/**
 * `spectant serve` (T50, ISC-20), the default command: it listens on `DEFAULT_PORT` (7717) or `--port N`, falling
 * forward to the next free port when it is taken (`serveWithFallback`), unless `--strict-port` pins it. Once listening
 * it prints exactly one line on stdout, `spectant · http://127.0.0.1:<port>`, and opens that URL in the browser unless
 * `--no-browser` is given. It serves the settings API (`/api/settings`, T43), the workspace routes (`/api/workspaces`,
 * T47) and the spec routes (`/api/workspaces/:ws/specs/:id…`, T45, the `spec/` slice) from `spectant.db` in the data
 * directory, and `/api/lifeos` (T51) from `SPECTANT_LIFEOS_STATE_DIR` in the environment, detected once at start.
 *
 * This is the composition root of the server: every slice's handler is built and composed here.
 */
import { detectLifeos } from "../infra/lifeos.ts";
import { actorsApi, lifeosApi, openSettings, settingsApi } from "../settings/index.ts";
import type { EmbeddedManifest } from "../contracts/assets.contract.ts";
import { openDatabase } from "../infra/db/db.ts";
import { openRegistry, type Registry } from "../infra/db/registry.ts";
import { CommitCache } from "../infra/git/index.ts";
import { composeApi } from "../infra/http/json.ts";
import { LOOPBACK_HOST, PORT_ATTEMPTS, type RunningServer, serveWithFallback } from "../infra/http/server.ts";
import { dataDir } from "../infra/paths.ts";
import { openBrowser, spawnRunner } from "../infra/process/open-browser.ts";
import { createWatchHub, eventsApi } from "../live/index.ts";
import { notesApi, openNotes } from "../notes/index.ts";
import { favoritesScan } from "../planning/index.ts";
import { prototypeApi } from "../prototype/index.ts";
import { specRoutesApi } from "../spec/index.ts";
import { openImageStore, workspaceAdminApi } from "../workspace-admin/index.ts";
import { workspaceSummaryReader } from "../workspace/index.ts";
import type { Command } from "./args.ts";
import { dashboardApi } from "./dashboard-api.ts";
import type { RunOptions } from "./options.ts";

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Serves until SIGINT, SIGTERM or `options.signal`, then stops the server, closes the database and resolves 0. A
 * database or bind failure resolves 1 at once, with one line on stderr.
 */
export function serveUntilSignal(manifest: EmbeddedManifest, command: Command & { kind: "serve" }, options: RunOptions): Promise<number> {
  let db: ReturnType<typeof openDatabase>;
  let registry: Registry;
  try {
    const dir = dataDir(options.env ?? process.env);
    db = openDatabase(dir);
    registry = openRegistry(dir);
  } catch (error) {
    console.error(`spectant: cannot open the data directory: ${reason(error)}`);
    return Promise.resolve(1);
  }
  let server: RunningServer;
  try {
    const lifeos = detectLifeos(options.env ?? process.env);
    // One commit cache for the process (T46): the timeline and the spec page skip `git log` while HEAD is unchanged.
    const notes = openNotes(db);
    // The workspace images (spec 016, ISC-310) live in the data folder beside the database, never in a repository.
    const images = openImageStore(dataDir(options.env ?? process.env));
    const settings = openSettings(db);
    // The run lock's abort age (spec 040, ISC-225), read per write so a changed `runAbortMinutes` applies at once.
    const abortAfterMs = (): number => settings.get().runAbortMinutes * 60_000;
    // The claim stale age (spec 032, ISC-35), read per request so a changed `staleMinutes` shows on the next frame.
    const staleAfterMs = (): number => settings.get().staleMinutes * 60_000;
    const specs = specRoutesApi({ registry, lifeos, commitCache: new CommitCache(), notes, abortAfterMs, staleAfterMs });
    const reads = composeApi(
      settingsApi(settings),
      actorsApi(db),
      lifeosApi(lifeos),
      dashboardApi({ registry, lifeos, db, abortAfterMs, staleAfterMs, imagesOf: images.imagesOf }),
      notesApi({ store: notes, registry }),
      specs,
      prototypeApi({ registry }),
    );
    // The live update stream (spec 030, ISC-28) answers its views through the same read handlers a poll reaches.
    const hub = createWatchHub({ registry });
    // The writing workspace routes (spec 016) come before the list route of `dashboardApi`, which answers 405 for
    // every write on its path, and announce each registry write on the same hub, so open streams show it at once.
    const admin = workspaceAdminApi({ registry, summaryOf: workspaceSummaryReader({ lifeos, imagesOf: images.imagesOf }), live: hub, images });
    // The favourites are pruned in the scan after a watcher change, never in a GET (spec 057, ISC-352, ISC-353).
    const api = composeApi(eventsApi({ hub, reads, scan: favoritesScan({ db, registry }) }), admin, reads);
    server = serveWithFallback({ manifest, port: command.port, strict: command.strictPort, api });
  } catch (error) {
    registry.close();
    db.close();
    const tried = command.strictPort || command.port === 0 ? "" : ` or the ${PORT_ATTEMPTS - 1} ports above it`;
    console.error(`spectant: cannot listen on ${LOOPBACK_HOST}:${command.port}${tried}: ${reason(error)}`);
    return Promise.resolve(1);
  }
  const url = `http://${LOOPBACK_HOST}:${server.port}`;
  console.log(`spectant · ${url}`);
  if (command.openBrowser) void openBrowser(url, { platform: process.platform, run: options.browserRunner ?? spawnRunner });
  return new Promise((resolve) => {
    const stop = () => {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
      options.signal?.removeEventListener("abort", stop);
      server.stop();
      registry.close();
      db.close();
      resolve(0);
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    if (options.signal?.aborted) stop();
    else options.signal?.addEventListener("abort", stop, { once: true });
  });
}

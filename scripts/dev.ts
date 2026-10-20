/**
 * `bun run dev`: the server from source plus the Angular dev server with live reload, for working on the app.
 *
 *   bun run dev                                  (from the repository root)
 *   SPECTANT_DEV_API_PORT=7720 SPECTANT_DEV_WEB_PORT=4310 bun run dev
 *
 * The API runs as `bun --watch server/src/main.ts` on 127.0.0.1:7718 (not 7717, so an installed spectant keeps its
 * port) and restarts on every server or core change. `ng serve` runs on 127.0.0.1:4300 and forwards `/api` to it
 * through `web/proxy.conf.mjs`; open that URL. The server still needs a loadable `server/embedded.gen.ts` to start, so
 * a checkout without one, or with a stale one, gets a web build and an embed first; the embedded copy is never what
 * the browser sees here. Stale means the manifest imports a web file that no longer exists: `bun run e2e` builds the
 * web app again, which replaces the hashed chunks an earlier embed named (`manifestStatus` in `scripts/embed.ts`).
 *
 * The data directory is the normal one (`$XDG_DATA_HOME/spectant`, else `~/.spectant/`); set `XDG_DATA_HOME` to keep a
 * separate dev registry. Loopback only, like the app itself: both listeners bind 127.0.0.1.
 */
import { join } from "node:path";
import { manifestStatus } from "./embed.ts";

const ROOT = join(import.meta.dir, "..");
const EMBED_SCRIPT = join(import.meta.dir, "embed.ts");

/** Runs one command to completion; the dev start passes one that exits the process on failure. */
export type Step = (cmd: string[], cwd: string) => Promise<void>;

/**
 * Builds the web app and embeds it when the manifest under `root` is missing or stale, and returns what it found.
 * A current manifest is left alone, so a normal start stays fast.
 */
export async function ensureEmbedded(root: string, step: Step): Promise<ReturnType<typeof manifestStatus>> {
  const status = manifestStatus(root);
  if (status === "current") return status;
  const why = status === "missing" ? "is missing" : "imports web files a later build replaced";
  console.log(`dev: server/embedded.gen.ts ${why}; building the web app and embedding it once`);
  await step(["bun", "run", "--cwd", "web", "build"], root);
  await step(["bun", EMBED_SCRIPT, "--root", root], root);
  return status;
}

async function step(cmd: string[], cwd: string): Promise<void> {
  const code = await Bun.spawn(cmd, { cwd, stdio: ["inherit", "inherit", "inherit"] }).exited;
  if (code !== 0) {
    console.error(`dev: \`${cmd.join(" ")}\` exited with ${code}`);
    process.exit(code);
  }
}

async function main(): Promise<number> {
  const apiPort = process.env.SPECTANT_DEV_API_PORT ?? "7718";
  const webPort = process.env.SPECTANT_DEV_WEB_PORT ?? "4300";
  await ensureEmbedded(ROOT, step);

  const env = { ...process.env, SPECTANT_DEV_API_PORT: apiPort };
  const children = [
    Bun.spawn(["bun", "--watch", "server/src/main.ts", "--no-browser", "--port", apiPort], {
      cwd: ROOT,
      env,
      stdio: ["ignore", "inherit", "inherit"],
    }),
    Bun.spawn(
      ["bun", "run", "start", "--", "--host", "127.0.0.1", "--port", webPort, "--proxy-config", "proxy.conf.mjs"],
      { cwd: join(ROOT, "web"), env, stdio: ["ignore", "inherit", "inherit"] },
    ),
  ];
  console.log(`dev: API on http://127.0.0.1:${apiPort}, app with live reload on http://127.0.0.1:${webPort}`);

  const stop = (): void => {
    for (const child of children) child.kill();
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  // One child ending ends the other, so a crashed server never leaves a dev server proxying into nothing.
  const first = await Promise.race(children.map((child) => child.exited));
  stop();
  await Promise.all(children.map((child) => child.exited));
  return first;
}

// Imported by tests/embed.test.ts for `ensureEmbedded`; only `bun scripts/dev.ts` starts anything.
if (import.meta.main) process.exit(await main());

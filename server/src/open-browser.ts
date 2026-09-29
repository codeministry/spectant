/**
 * Opens the dashboard in the default browser on start-up (T50, ISC-20; plan 001 § Affected Files): `open <url>` on
 * macOS, `xdg-open <url>` on Linux. The CLI skips it under `--no-browser`.
 *
 * Opening the browser is a convenience, never a requirement: the URL is already printed, so an opener that is
 * missing, fails or runs on an unsupported platform is logged to stderr and the server keeps running. The command
 * runner is injected, so tests record the call instead of opening a real browser. The URL is always the loopback
 * URL the server bound; nothing here reaches beyond the machine (ISC-2).
 */

/** Runs one command and resolves its exit code. It may reject when the command cannot be started at all. */
export type CommandRunner = (command: string[]) => Promise<number>;

export interface OpenBrowserOptions {
  platform: NodeJS.Platform;
  run: CommandRunner;
}

/** The opener for a platform, or `undefined` off macOS and Linux. */
function openerFor(platform: NodeJS.Platform): string | undefined {
  if (platform === "darwin") return "open";
  if (platform === "linux") return "xdg-open";
  return undefined;
}

/** The real runner: spawns the command detached from our stdio and waits for its exit code. */
export const spawnRunner: CommandRunner = (command) =>
  Bun.spawn(command, { stdin: "ignore", stdout: "ignore", stderr: "ignore" }).exited;

/**
 * Asks the platform opener to open `url`. The runner is called synchronously, before the first `await`, so a caller
 * that does not await still has the call made. Never rejects.
 */
export async function openBrowser(url: string, { platform, run }: OpenBrowserOptions): Promise<void> {
  const opener = openerFor(platform);
  if (opener === undefined) {
    console.error(`spectant: cannot open a browser on ${platform}; open ${url} yourself`);
    return;
  }
  try {
    const code = await run([opener, url]);
    if (code !== 0) console.error(`spectant: ${opener} exited with ${code}; open ${url} yourself`);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`spectant: cannot run ${opener} (${reason}); open ${url} yourself`);
  }
}

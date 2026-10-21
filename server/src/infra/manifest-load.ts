/**
 * Why `server/src/main.ts` could not load the generated manifest, `server/embedded.gen.ts`, and the hint it prints.
 * Kept apart from `main.ts`, whose import runs the CLI, so the selection is testable (tests/embed.test.ts).
 *
 * Bun reports a failed resolution as a `ResolveMessage`, which is not an `Error` subclass, hence `String()`:
 *   missing: Cannot find module '../embedded.gen.ts' from '…/server/src/main.ts'
 *   stale:   Cannot find module '../web/dist/browser/chunk-X.js' from '…/server/embedded.gen.ts'
 * The stale case follows a web build after the last embed, which replaced the hashed chunks the manifest imports.
 */
export type ManifestFailure = "missing" | "stale";

const MISSING = /Cannot find module ["'][^"']*embedded\.gen\.ts["']/;
const STALE = /Cannot find module ["'][^"']+["'] from ["'][^"']*embedded\.gen\.ts["']/;

/** `missing` or `stale` for the two resolution failures above; `undefined` for anything else, which is a real bug. */
export function manifestFailure(error: unknown): ManifestFailure | undefined {
  const text = String(error);
  if (MISSING.test(text)) return "missing";
  if (STALE.test(text)) return "stale";
  return undefined;
}

const REBUILD = "  bun run --cwd web build && bun scripts/embed.ts\nor build the binaries with `bun run build`.";

/** The message `main.ts` prints before it exits 1. */
export function manifestHint(failure: ManifestFailure): string {
  if (failure === "missing") {
    return `spectant: server/embedded.gen.ts is missing; build the web app and embed it first:\n${REBUILD}`;
  }
  return (
    "spectant: server/embedded.gen.ts is out of date; it imports a web file that a later web build replaced. " +
    `Rebuild the web app and embed it again:\n${REBUILD}`
  );
}

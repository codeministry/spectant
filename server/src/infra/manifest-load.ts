/**
 * Why `server/src/main.ts` could not load the generated manifest, `server/embedded.gen.ts`, and the hint it prints.
 * Kept apart from `main.ts`, whose import runs the CLI, so the selection is testable (tests/embed.test.ts).
 *
 * Bun reports a failed resolution as a `ResolveMessage` (not an `Error` subclass) with `code` `ERR_MODULE_NOT_FOUND`,
 * the `specifier` it could not resolve and the `referrer` that imported it:
 *   missing: specifier `../embedded.gen.ts`, referrer `…/server/src/main.ts`
 *   stale:   specifier `../web/dist/browser/chunk-X.js`, referrer `…/server/embedded.gen.ts`
 * The stale case follows a web build after the last embed, which replaced the hashed chunks the manifest imports.
 * The selection reads those fields, never the message: its wording is Bun's to change (1.4 turned
 * `… from '<referrer>'` into `… imported from <referrer>`), the fields stayed.
 */
export type ManifestFailure = "missing" | "stale";

const GENERATED = /(?:^|[\\/])embedded\.gen\.ts$/;

type ResolveFailure = { code?: unknown; specifier?: unknown; referrer?: unknown };

/** `missing` or `stale` for the two resolution failures above; `undefined` for anything else, which is a real bug. */
export function manifestFailure(error: unknown): ManifestFailure | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const { code, specifier, referrer } = error as ResolveFailure;
  if (code !== "ERR_MODULE_NOT_FOUND" || typeof specifier !== "string") return undefined;
  if (GENERATED.test(specifier)) return "missing";
  if (typeof referrer === "string" && GENERATED.test(referrer)) return "stale";
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

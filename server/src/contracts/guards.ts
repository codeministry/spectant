/**
 * The guards every contract shares (spec 059): the segments of a pathname below a root and their once-decode, the
 * plain-record check of a body and the lowercase sha256 hex pattern. The contracts, `settings.ts` and `cli-notes.ts`
 * import these instead of keeping copies. Browser-safe: this file imports nothing. Internal: no contract barrel
 * re-exports it.
 */

/**
 * The segments of a pathname below `root` (both as `URL.pathname` gives them, still percent-encoded), or null when the
 * pathname is not below it. Each segment still needs its `decodeOnce`.
 */
export function segmentsBelow(pathname: string, root: string): string[] | null {
  const rootParts = root.split('/').slice(1);
  const parts = pathname.split('/').slice(1);
  return rootParts.every((part, i) => parts[i] === part) ? parts.slice(rootParts.length) : null;
}

/** A path segment decoded once; null for a missing or empty segment or a malformed escape. */
export function decodeOnce(segment: string | undefined): string | null {
  if (segment === undefined || segment === '') return null;
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

/** A plain record: an object that is neither null nor an array. */
export const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** A sha256 digest as 64 lowercase hex digits. */
export const HEX64 = /^[0-9a-f]{64}$/;

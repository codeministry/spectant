/**
 * The spec routes contract's own helpers (part of `contracts/spec-routes.contract.ts`): the one segment matcher both
 * route families share, the once-decode the prototype route uses too, the status lists more than one family answers,
 * and the record guards of the body validators. Internal: the barrel does not re-export this file, so none of it is
 * part of the contract's public surface.
 */

/** Percent-encodes one segment; every builder encodes each segment exactly once. */
export const enc = encodeURIComponent;

/** 200 or 304 by ETag; 403 host or origin guard; 404 unknown workspace or spec; 405 wrong method; 409 unreadable workspace. */
export const READ = [200, 304, 403, 404, 405, 409] as const;
/** 200 written; 400 invalid body; 403 guard; 404 unknown workspace, spec or task; 405; 409 hash mismatch or unreadable; 423 locked. */
export const WRITE = [200, 400, 403, 404, 405, 409, 423] as const;
/**
 * A write the workflow or the index may refuse: `WRITE` plus 422. 404 is the unknown workspace, spec or story; 409 is
 * `hash-mismatch` or the unreadable workspace's `Unavailable`.
 */
export const REFUSABLE_WRITE = [200, 400, 403, 404, 405, 409, 422, 423] as const;

/**
 * The decoded params of a pathname's segments against a pattern's, or null. A literal segment must be equal; a param
 * segment is decoded once, and a malformed escape or an empty segment is no match.
 * Shared by both route families, so a slug decodes the same way in each.
 */
export function matchSegments(segments: readonly string[], parts: readonly string[]): Record<string, string> | null {
  if (segments.length !== parts.length) return null;
  const params: Record<string, string> = {};
  for (const [i, segment] of segments.entries()) {
    const part = parts[i] ?? '';
    if (!segment.startsWith(':')) {
      if (segment !== part) return null;
      continue;
    }
    const value = decodeOnce(part);
    if (value === null) return null;
    params[segment.slice(1)] = value;
  }
  return params;
}

export function decodeOnce(segment: string): string | null {
  if (segment === '') return null;
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

export const isPlainRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
export const hasOnlyKeys = (v: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(v).every((key) => keys.includes(key));

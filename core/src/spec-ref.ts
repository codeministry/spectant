// The spec-reference forms (review round 2, finding 8): the single definition of the three refs a spec route
// accepts for a folder `NNN-slug` — its id `NNN`, the folder name itself, and its bare slug. `resolve.ts` resolves
// through these helpers and the web app matches holders with them, so the forms cannot drift apart.
//
// The loader lists `NNN-slug` folders only: `resolve.ts` scans `specs/` and `specs/archive/` with `SPEC_FOLDER` below
// (FORMAT.md: three digits, a hyphen and a slug), so every folder the dashboard, the archive or the planning tree
// carries has a three-digit id. `specIdOf` and `specSlugOf` accept a prefix of any width; other widths reach them only
// through direct callers.
//
// Pure and browser-safe: string in, string out, no file system, no Node or Bun API. That is why it lives apart from
// `resolve.ts`, which reads directories and stays out of the browser bundle.

/** The folder shape the loader lists: three digits, a hyphen and a non-empty slug (`002-web-console`). */
export const SPEC_FOLDER = /^(\d{3})-(.+)$/u;

/** A ref read as an id: exactly three digits (`002`). It never names a folder by its slug. */
export const SPEC_ID = /^\d{3}$/u;

const ID_PREFIX = /^(\d+)-/u;

/** The numeric prefix before the first `-` (`002-web-console` → `002`), or null when the folder has none. */
export function specIdOf(folder: string): string | null {
  return ID_PREFIX.exec(folder)?.[1] ?? null;
}

/** The folder without its numeric prefix (`002-web-console` → `web-console`); a folder without one is returned as is. */
export function specSlugOf(folder: string): string {
  return folder.replace(ID_PREFIX, '');
}

/**
 * True when `ref` names `folder` in one of the three forms: its id, the folder name or its bare slug. Each form is
 * matched exactly and case-sensitively; an empty ref never matches. A three-digit ref (`SPEC_ID`) is an id only and
 * never matches a slug, the precedence `resolveSpec` reads it with: `123` does not name `007-123`, whose route would
 * answer `unknown-id`.
 */
export function specRefMatches(folder: string, ref: string): boolean {
  if (ref === '') return false;
  if (SPEC_ID.test(ref)) return ref === specIdOf(folder);
  return ref === folder || ref === specIdOf(folder) || ref === specSlugOf(folder);
}

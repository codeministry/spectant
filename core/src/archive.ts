// The archive listing (T38, ISC-16), ported from the old dashboard's archived rows (SpecArchive keeps the folder's
// location as the fact): every folder under `specs/archive/`, listed and counted, never offered a next step or a
// warning, because archiving closed it.
// Stub from the T33 seam: the fill-in task replaces the body and keeps the exported name and types.
import type { SpecFiles, SpecType } from './files.ts';
import type { Progress } from './frontmatter.ts';

export interface ArchivedSpec {
  /** `NNN`. */
  readonly id: string;
  /** `NNN-slug`. */
  readonly slug: string;
  /** Frontmatter `task:`, falling back to the slug without its number. */
  readonly title: string;
  readonly type: SpecType | null;
  /** Frontmatter `archived:` (`YYYY-MM-DD`); null when the folder carries none. */
  readonly archived: string | null;
  readonly archivedReason: string | null;
  /** Live claims, closed over total. */
  readonly claims: Progress;
  readonly tasks: { readonly landed: number; readonly total: number };
  /** The first prose paragraph under `## Goal`, on one line; empty when there is none. */
  readonly goal: string;
}

/** One row per archived folder, in folder order. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- stub parameters; the fill-in uses them and drops this line
export function listArchive(_folders: readonly SpecFiles[]): ArchivedSpec[] {
  throw new Error('not implemented: listArchive');
}
